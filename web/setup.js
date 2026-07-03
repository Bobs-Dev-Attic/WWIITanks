// Setup screen + in-game menu bar.
//
// Pick battlefield + weather, set the COUNT of each tank type per faction (and
// optionally fine-place them on the minimap), then launch. The top menu bar
// lets the player re-open setup, restart, pause, view help, or leave.

import { VERSION, LOCATIONS, WEATHER, TANK_TYPES, FIELD, BRIDGE_XS, startGame } from "./game.js";

document.getElementById("ver").textContent = "v" + VERSION;
document.getElementById("mb-ver").textContent = "v" + VERSION;

// ---- selects ---------------------------------------------------------------
const selLoc = document.getElementById("sel-location");
const selWx = document.getElementById("sel-weather");
for (const [k, v] of Object.entries(LOCATIONS)) selLoc.add(new Option(v.name, k));
for (const [k, v] of Object.entries(WEATHER)) selWx.add(new Option(v.name, k));
selLoc.value = "normandy"; selWx.value = "clear";

const locDesc = document.getElementById("loc-desc");
let battleNote = "";
function describe() {
  const L = LOCATIONS[selLoc.value], W = WEATHER[selWx.value];
  locDesc.innerHTML =
    `<b>${L.name}</b> — ${L.river ? "a river cuts the field; cross at the bridges. " : ""}` +
    `${L.buildings} buildings, ${L.ruins} ruins, ${L.trees} trees, ${L.rocks} rocks, plus barbed wire and anti-tank hedgehogs.<br><br><b>${W.name}</b> weather.` +
    (battleNote ? `<br><br><i style="opacity:.85">${battleNote}</i>` : "");
}
selLoc.onchange = selWx.onchange = describe;
describe();

// ---- fire-support counts ---------------------------------------------------
const supSel = { aArty: "sup-a-arty", aAir: "sup-a-air", xArty: "sup-x-arty", xAir: "sup-x-air" };
for (const id of Object.values(supSel)) { const el = document.getElementById(id); for (let n = 0; n <= 5; n++) el.add(new Option(String(n), String(n))); }
document.getElementById(supSel.aArty).value = "2";
document.getElementById(supSel.aAir).value = "1";
document.getElementById(supSel.xArty).value = "2";
document.getElementById(supSel.xAir).value = "1";
const supVal = (id) => parseInt(document.getElementById(id).value, 10) || 0;

// ---- tabs ------------------------------------------------------------------
for (const tab of document.querySelectorAll(".tab")) {
  tab.onclick = () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === tab.dataset.tab));
  };
}

// ---- deployment (per-type counts + minimap placement) ----------------------
const TYPE_COLORS = { stuart: "#8fd06a", sherman: "#5f9e3a", pershing: "#3f6f28", panzer2: "#c9b08a", panzer4: "#9a8f72", tiger: "#6f6552" };
const WORLD = FIELD, CAP = 14;
const cl = (v) => Math.max(-WORLD, Math.min(WORLD, v));

function makeDeployer(team, canvasId, palId, cntId, clrId, autoId, autoN) {
  const canvas = document.getElementById(canvasId), ctx = canvas.getContext("2d"), size = canvas.width;
  const types = Object.entries(TANK_TYPES[team]);
  const zoneAllies = team === "allies";
  let selType = types[0][0];
  const placed = [];
  const rowEls = {};

  const pal = document.getElementById(palId);
  types.forEach(([key, spec], i) => {
    const row = document.createElement("div");
    row.className = "urow" + (i === 0 ? " sel" : ""); row.dataset.type = key;
    const name = document.createElement("span"); name.className = "uname"; name.textContent = spec.name;
    const stat = document.createElement("span"); stat.className = "ustat"; stat.textContent = `HP ${spec.health} · RLD ${spec.reload}s · SPD ${spec.maxFwd} · DMG ${spec.dmg}`;
    const step = document.createElement("span"); step.className = "ustep";
    const minus = document.createElement("button"); minus.textContent = "−";
    const cnt = document.createElement("b"); cnt.className = "ucount"; cnt.textContent = "0";
    const plus = document.createElement("button"); plus.textContent = "+";
    step.append(minus, cnt, plus); row.append(name, stat, step); pal.appendChild(row);
    row.onclick = (e) => { if (e.target === minus || e.target === plus) return; select(key); };
    minus.onclick = (e) => { e.stopPropagation(); removeOne(key); };
    plus.onclick = (e) => { e.stopPropagation(); addOne(key); select(key); };
    rowEls[key] = { row, cnt };
  });
  function select(key) { selType = key; for (const k in rowEls) rowEls[k].row.classList.toggle("sel", k === key); }
  const countOf = (key) => placed.filter((p) => p.type === key).length;
  function refresh() { for (const k in rowEls) rowEls[k].cnt.textContent = countOf(k); document.getElementById(cntId).textContent = placed.length; draw(); }

  function autoPos(key) {
    const c = countOf(key), col = c % 6, rowi = Math.floor(c / 6);
    return { x: Math.round(-90 + col * 36), z: zoneAllies ? -45 - rowi * 10 : 60 + rowi * 10 };
  }
  function addOne(key) { if (placed.length >= CAP) return; const p = autoPos(key); placed.push({ type: key, x: p.x, z: p.z }); refresh(); }
  function removeOne(key) { for (let i = placed.length - 1; i >= 0; i--) if (placed[i].type === key) { placed.splice(i, 1); break; } refresh(); }

  const w2px = (x) => (x / WORLD * 0.5 + 0.5) * size;
  const w2py = (z) => (0.5 - z / WORLD * 0.5) * size;
  const px2x = (px) => (px / size - 0.5) * 2 * WORLD;
  const py2z = (py) => (0.5 - py / size) * 2 * WORLD;
  const inZone = (z) => (zoneAllies ? z < -6 : z > 6);

  function draw() {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#141a10"; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = zoneAllies ? "rgba(122,199,79,.12)" : "rgba(201,138,138,.12)";
    if (zoneAllies) ctx.fillRect(0, size * 0.55, size, size * 0.45); else ctx.fillRect(0, 0, size, size * 0.45);
    if (LOCATIONS[selLoc.value].river) {
      const y1 = w2py(18), y2 = w2py(6);
      ctx.fillStyle = "rgba(60,110,150,.5)"; ctx.fillRect(0, y1, size, y2 - y1);
      ctx.fillStyle = "#6b4f32"; for (const bx of BRIDGE_XS) ctx.fillRect(w2px(bx) - 6, y1, 12, y2 - y1);
    }
    ctx.strokeStyle = "rgba(255,255,255,.15)"; ctx.beginPath(); ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2); ctx.stroke();
    for (const t of placed) { ctx.fillStyle = TYPE_COLORS[t.type] || "#ccc"; ctx.fillRect(w2px(t.x) - 4, w2py(t.z) - 4, 8, 8); }
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (placed.length >= CAP) return;
    const r = canvas.getBoundingClientRect();
    const x = cl(px2x(e.clientX - r.left)); let z = cl(py2z(e.clientY - r.top));
    if (!inZone(z)) z = zoneAllies ? -12 : 12;
    placed.push({ type: selType, x: Math.round(x), z: Math.round(z) }); refresh();
  });
  document.getElementById(clrId).onclick = () => { placed.length = 0; refresh(); };
  document.getElementById(autoId).onclick = () => { placed.length = 0; autofill(autoN); refresh(); };
  function autofill(n) { const keys = types.map(([k]) => k); for (let i = 0; i < n; i++) { const key = keys[i % keys.length]; const p = autoPos(key); placed.push({ type: key, x: p.x, z: p.z }); } }

  autofill(autoN); refresh();
  selLoc.addEventListener("change", draw);
  return { placed, addOne, removeOne, count: () => placed.length };
}

const alliesDep = makeDeployer("allies", "map-allies", "pal-allies", "cnt-allies", "clr-allies", "auto-allies", 4);
const axisDep = makeDeployer("germans", "map-axis", "pal-axis", "cnt-axis", "clr-axis", "auto-axis", 5);

// ---- terrain editor: add structures/objects anywhere on the field ----------
const OBJ_TYPES = [
  ["building", "Building", "#b2a184"], ["ruin", "Ruin", "#9a8f7c"], ["tree", "Tree", "#3a6b32"],
  ["rock", "Rock", "#8a8a82"], ["hedgehog", "Hedgehog", "#555a5e"], ["wire", "Barbed Wire", "#6a6a6a"],
];
function makeTerrainEditor() {
  const canvas = document.getElementById("map-terrain"), ctx = canvas.getContext("2d"), size = canvas.width;
  const pal = document.getElementById("pal-terrain"); let sel = OBJ_TYPES[0][0]; const props = [];
  const colorOf = (k) => (OBJ_TYPES.find((t) => t[0] === k) || [])[2] || "#ccc";
  OBJ_TYPES.forEach(([key, label], i) => {
    const c = document.createElement("div"); c.className = "tchip" + (i === 0 ? " sel" : ""); c.textContent = label;
    c.onclick = () => { sel = key; pal.querySelectorAll(".tchip").forEach((x) => x.classList.remove("sel")); c.classList.add("sel"); };
    pal.appendChild(c);
  });
  const w2px = (x) => (x / WORLD * 0.5 + 0.5) * size, w2py = (z) => (0.5 - z / WORLD * 0.5) * size;
  const px2x = (px) => (px / size - 0.5) * 2 * WORLD, py2z = (py) => (0.5 - py / size) * 2 * WORLD;
  function draw() {
    ctx.clearRect(0, 0, size, size); ctx.fillStyle = "#141a10"; ctx.fillRect(0, 0, size, size);
    if (LOCATIONS[selLoc.value].river) {
      const y1 = w2py(18), y2 = w2py(6);
      ctx.fillStyle = "rgba(60,110,150,.5)"; ctx.fillRect(0, y1, size, y2 - y1);
      ctx.fillStyle = "#6b4f32"; for (const bx of BRIDGE_XS) ctx.fillRect(w2px(bx) - 6, y1, 12, y2 - y1);
    }
    ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.beginPath(); ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2); ctx.stroke();
    for (const p of props) { ctx.fillStyle = colorOf(p.type); ctx.fillRect(w2px(p.x) - 4, w2py(p.z) - 4, 8, 8); }
    document.getElementById("cnt-terrain").textContent = props.length;
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (props.length >= 40) return;
    const r = canvas.getBoundingClientRect();
    props.push({ type: sel, x: Math.round(cl(px2x(e.clientX - r.left))), z: Math.round(cl(py2z(e.clientY - r.top))) });
    draw();
  });
  document.getElementById("clr-terrain").onclick = () => { props.length = 0; draw(); };
  selLoc.addEventListener("change", draw); draw();
  return { props };
}
const terrainEd = makeTerrainEditor();

// ---- historical battles ----------------------------------------------------
// Approximated with the game's US-vs-German low-poly roster; Eastern-Front
// Soviet forces are represented by the "Allied" tanks.
const BATTLES = {
  villers_bocage: { name: "Villers-Bocage (1944)", location: "normandy", weather: "clear",
    allies: [["sherman", 8], ["stuart", 3]], axis: [["tiger", 2], ["panzer4", 2]], sup: { a: [1, 1], x: [0, 0] },
    desc: "13 Jun 1944 — Wittmann's Tigers ambush a strung-out British armoured column in the Normandy bocage: a few heavies maul a much larger force." },
  goodwood: { name: "Operation Goodwood (1944)", location: "normandy", weather: "overcast",
    allies: [["sherman", 9], ["stuart", 3]], axis: [["panzer4", 4], ["tiger", 3]], sup: { a: [2, 2], x: [1, 0] },
    desc: "18 Jul 1944 — massed Allied armour pushes out of the Normandy beachhead into layered German anti-tank defences." },
  arracourt: { name: "Arracourt (1944)", location: "eastern_front", weather: "fog",
    allies: [["sherman", 10], ["stuart", 2]], axis: [["tiger", 3], ["panzer4", 4]], sup: { a: [2, 1], x: [1, 0] },
    desc: "Sep 1944 — in Lorraine fog, outgunned US Shermans use maneuver and flanking to defeat German Panther brigades." },
  bulge: { name: "Battle of the Bulge (1944)", location: "ardennes", weather: "snow",
    allies: [["sherman", 6], ["pershing", 2], ["stuart", 2]], axis: [["panzer4", 5], ["tiger", 4]], sup: { a: [1, 0], x: [2, 1] },
    desc: "Dec 1944 — German armour attacks through the snowbound Ardennes forest; foul weather grounds Allied airpower." },
  el_alamein: { name: "El Alamein (1942)", location: "north_africa", weather: "clear",
    allies: [["sherman", 8], ["stuart", 4]], axis: [["panzer4", 5], ["panzer2", 3]], sup: { a: [2, 2], x: [1, 0] },
    desc: "Oct 1942 — the desert turning point: a large, well-supplied Allied force grinds down Rommel's Afrika Korps armour." },
  kasserine: { name: "Kasserine Pass (1943)", location: "north_africa", weather: "clear",
    allies: [["stuart", 6], ["sherman", 4]], axis: [["panzer4", 5], ["tiger", 2]], sup: { a: [1, 0], x: [1, 1] },
    desc: "Feb 1943 — green US units meet veteran German armour (and the first Tigers) in the Tunisian passes." },
  prokhorovka: { name: "Prokhorovka / Kursk (1943)", location: "eastern_front", weather: "overcast",
    allies: [["sherman", 10], ["stuart", 4]], axis: [["panzer4", 6], ["tiger", 5]], sup: { a: [2, 1], x: [2, 1] },
    desc: "12 Jul 1943 — one of history's largest tank clashes: massed Soviet armour charges into German Panzer and Tiger formations." },
  brody: { name: "Battle of Brody (1941)", location: "eastern_front", weather: "clear",
    allies: [["sherman", 12], ["stuart", 2]], axis: [["panzer2", 6], ["panzer4", 5]], sup: { a: [0, 0], x: [1, 2] },
    desc: "Jun 1941 — huge but disorganised Soviet armour counterattacks German spearheads under total Luftwaffe air superiority." },
};

const selBattle = document.getElementById("sel-battle");
selBattle.add(new Option("Custom Battle", "custom"));
for (const [k, v] of Object.entries(BATTLES)) selBattle.add(new Option(v.name, k));
selBattle.value = "custom";

const setSup = (a) => { document.getElementById(supSel.aArty).value = a.a[0]; document.getElementById(supSel.aAir).value = a.a[1];
  document.getElementById(supSel.xArty).value = a.x[0]; document.getElementById(supSel.xAir).value = a.x[1]; };
const fillRoster = (dep, list) => { dep.placed.length = 0; for (const [type, n] of list) for (let i = 0; i < n; i++) dep.addOne(type); };

function applyBattle(key) {
  const bt = BATTLES[key]; if (!bt) return;
  selLoc.value = bt.location; selWx.value = bt.weather; setSup(bt.sup);
  fillRoster(alliesDep, bt.allies); fillRoster(axisDep, bt.axis);
  battleNote = bt.desc;
  selLoc.dispatchEvent(new Event("change")); selWx.dispatchEvent(new Event("change")); describe();
}
selBattle.onchange = () => { if (selBattle.value !== "custom") applyBattle(selBattle.value); else { battleNote = ""; describe(); } };

// ---- randomize everything --------------------------------------------------
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function randomize() {
  selBattle.value = "custom"; battleNote = "";
  selLoc.value = pick(Object.keys(LOCATIONS));
  selWx.value = pick(Object.keys(WEATHER));
  for (const id of Object.values(supSel)) document.getElementById(id).value = String(Math.floor(Math.random() * 4));
  const aKeys = Object.keys(TANK_TYPES.allies), xKeys = Object.keys(TANK_TYPES.germans);
  fillRoster(alliesDep, [[pick(aKeys), 2 + Math.floor(Math.random() * 6)], [pick(aKeys), 1 + Math.floor(Math.random() * 4)]]);
  fillRoster(axisDep, [[pick(xKeys), 2 + Math.floor(Math.random() * 6)], [pick(xKeys), 1 + Math.floor(Math.random() * 4)]]);
  // a few random extra structures/objects
  terrainEd.props.length = 0;
  selLoc.dispatchEvent(new Event("change")); selWx.dispatchEvent(new Event("change")); describe();
}
document.getElementById("randomize").onclick = randomize;

function summary() {
  document.getElementById("foot-summary").textContent =
    `${LOCATIONS[selLoc.value].name} · ${WEATHER[selWx.value].name} · Allies ${alliesDep.count()} vs Axis ${axisDep.count()} (max ${CAP}/side)`;
}
setInterval(summary, 300); summary();

// ---- lifecycle + menu bar --------------------------------------------------
let gameHandle = null, lastConfig = null;
const $ = (id) => document.getElementById(id);

function buildConfig() {
  return { location: selLoc.value, weather: selWx.value,
    allies: { tanks: alliesDep.placed.slice() }, axis: { tanks: axisDep.placed.slice() },
    props: terrainEd.props.slice(),
    support: { allies: { arty: supVal(supSel.aArty), air: supVal(supSel.aAir) },
               axis: { arty: supVal(supSel.xArty), air: supVal(supSel.xAir) } } };
}
function show(setupVisible) {
  $("setup").style.display = setupVisible ? "flex" : "none";
  $("hud").style.display = setupVisible ? "none" : "block";
  $("menubar").style.display = setupVisible ? "none" : "flex";
  if (setupVisible) $("help").style.display = "none";
}
function startBattle() {
  lastConfig = buildConfig();
  show(false);
  gameHandle = startGame(lastConfig);
  syncPause();
}
function leaveToSetup() { if (gameHandle) { gameHandle.dispose(); gameHandle = null; } show(true); }
function restart() {
  if (gameHandle) gameHandle.dispose();
  $("help").style.display = "none";
  gameHandle = startGame(lastConfig || buildConfig());
  syncPause();
}
function syncPause() {
  const btn = [...document.querySelectorAll("#menubar button")].find((b) => b.dataset.act === "pause");
  const p = !!(gameHandle && gameHandle.paused);
  if (btn) btn.textContent = p ? "▶ Resume" : "⏸ Pause";
  $("app").style.opacity = p ? 0.6 : 1;
}

$("start").onclick = startBattle;
$("menubar").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const act = b.dataset.act;
  if (act === "setup" || act === "leave") leaveToSetup();
  else if (act === "restart") restart();
  else if (act === "pause") { if (gameHandle) gameHandle.togglePause(); syncPause(); }
  else if (act === "help") { $("help").style.display = $("help").style.display === "flex" ? "none" : "flex"; }
});
$("help").addEventListener("click", (e) => {
  if (e.target.id === "help" || e.target.closest('[data-act="closehelp"]')) $("help").style.display = "none";
});

// expose for smoke tests
window.__setup = {
  start: startBattle, leave: leaveToSetup, restart,
  pause: () => { if (gameHandle) gameHandle.togglePause(); syncPause(); return gameHandle && gameHandle.paused; },
  allies: alliesDep, axis: axisDep, terrain: terrainEd,
  battles: Object.keys(BATTLES), applyBattle, randomize,
  buildConfig, get battleSel() { return selBattle.value; },
  setLocation: (l) => { selLoc.value = l; describe(); }, setWeather: (w) => { selWx.value = w; },
  get handle() { return gameHandle; },
};
