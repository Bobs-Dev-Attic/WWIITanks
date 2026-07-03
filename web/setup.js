// Setup screen: pick battlefield + weather, deploy both tank rosters on
// minimaps, then launch the match with startGame(config).

import { VERSION, LOCATIONS, WEATHER, TANK_TYPES, startGame } from "./game.js";

document.getElementById("ver").textContent = "v" + VERSION;

// ---- populate selects ------------------------------------------------------
const selLoc = document.getElementById("sel-location");
const selWx = document.getElementById("sel-weather");
for (const [k, v] of Object.entries(LOCATIONS)) selLoc.add(new Option(v.name, k));
for (const [k, v] of Object.entries(WEATHER)) selWx.add(new Option(v.name, k));
selLoc.value = "normandy";
selWx.value = "clear";

const locDesc = document.getElementById("loc-desc");
function describe() {
  const L = LOCATIONS[selLoc.value], W = WEATHER[selWx.value];
  locDesc.innerHTML =
    `<b>${L.name}</b> — ${L.river ? "a river cuts the field; cross at the bridges. " : ""}` +
    `${L.buildings} buildings, ${L.ruins} ruins, ${L.trees} trees, ${L.rocks} rocks, plus barbed wire and anti-tank hedgehogs.<br><br>` +
    `<b>${W.name}</b> weather.`;
}
selLoc.onchange = selWx.onchange = describe;
describe();

// ---- tabs ------------------------------------------------------------------
for (const tab of document.querySelectorAll(".tab")) {
  tab.onclick = () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === tab.dataset.tab));
  };
}

// ---- minimap deployment ----------------------------------------------------
const TYPE_COLORS = { stuart: "#8fd06a", sherman: "#5f9e3a", pershing: "#3f6f28", panzer2: "#c9b08a", panzer4: "#9a8f72", tiger: "#6f6552" };
const WORLD = 95; // half-extent

function makeDeployer(team, canvasId, palId, cntId, clrId, autoId, autoN) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext("2d");
  const size = canvas.width;
  const types = Object.entries(TANK_TYPES[team]);
  let selType = types[0][0];
  const placed = [];

  // south (allies) uses lower half (z<0 -> bottom of canvas); axis upper half
  const zoneAllies = team === "allies";

  // palette chips
  const pal = document.getElementById(palId);
  types.forEach(([key, spec], i) => {
    const chip = document.createElement("div");
    chip.className = "chip" + (i === 0 ? " sel" : "");
    chip.innerHTML = `${spec.name}<br><small>HP ${spec.health} · RLD ${spec.reload}s · SPD ${spec.maxFwd}</small>`;
    chip.onclick = () => { selType = key; pal.querySelectorAll(".chip").forEach((c) => c.classList.remove("sel")); chip.classList.add("sel"); };
    pal.appendChild(chip);
  });

  const worldToPx = (x) => (x / WORLD * 0.5 + 0.5) * size;
  const worldToPy = (z) => (0.5 - z / WORLD * 0.5) * size; // +z up
  const pxToWorldX = (px) => (px / size - 0.5) * 2 * WORLD;
  const pyToWorldZ = (py) => (0.5 - py / size) * 2 * WORLD;

  function draw() {
    ctx.clearRect(0, 0, size, size);
    // ground
    ctx.fillStyle = "#141a10"; ctx.fillRect(0, 0, size, size);
    // deployment zone highlight
    ctx.fillStyle = zoneAllies ? "rgba(122,199,79,.12)" : "rgba(201,138,138,.12)";
    if (zoneAllies) ctx.fillRect(0, size * 0.55, size, size * 0.45);
    else ctx.fillRect(0, 0, size, size * 0.45);
    // river band (if location has one) around z 6..18 -> screen
    if (LOCATIONS[selLoc.value].river) {
      const y1 = worldToPy(18), y2 = worldToPy(6);
      ctx.fillStyle = "rgba(60,110,150,.5)"; ctx.fillRect(0, y1, size, y2 - y1);
      // bridges at x=-32,26
      ctx.fillStyle = "#6b4f32";
      for (const bx of [-32, 26]) ctx.fillRect(worldToPx(bx) - 7, y1, 14, y2 - y1);
    }
    // center line
    ctx.strokeStyle = "rgba(255,255,255,.15)"; ctx.beginPath(); ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2); ctx.stroke();
    // placed tanks
    for (const t of placed) {
      ctx.fillStyle = TYPE_COLORS[t.type] || "#ccc";
      ctx.fillRect(worldToPx(t.x) - 4, worldToPy(t.z) - 4, 8, 8);
    }
    document.getElementById(cntId).textContent = placed.length;
  }

  function inZone(z) { return zoneAllies ? z < -6 : z > 6; }

  function addAt(px, py) {
    const x = Math.max(-WORLD, Math.min(WORLD, pxToWorldX(px)));
    let z = Math.max(-WORLD, Math.min(WORLD, pyToWorldZ(py)));
    if (!inZone(z)) z = zoneAllies ? -12 : 12;
    placed.push({ type: selType, x: Math.round(x), z: Math.round(z) });
    draw();
  }

  canvas.addEventListener("pointerdown", (e) => {
    const r = canvas.getBoundingClientRect();
    addAt(e.clientX - r.left, e.clientY - r.top);
  });
  document.getElementById(clrId).onclick = () => { placed.length = 0; draw(); };
  document.getElementById(autoId).onclick = () => { placed.length = 0; autofill(autoN); draw(); };

  function autofill(n) {
    const keys = types.map(([k]) => k);
    for (let i = 0; i < n; i++) {
      const type = keys[i % keys.length];
      const x = -40 + (i / Math.max(1, n - 1)) * 80;
      const z = zoneAllies ? -34 + (i % 2) * -8 : 40 + (i % 2) * 8;
      placed.push({ type, x: Math.round(x), z });
    }
  }

  // seed a sensible default
  autofill(autoN); draw();
  // redraw when the river toggles with location
  selLoc.addEventListener("change", draw);

  return { placed };
}

const alliesDep = makeDeployer("allies", "map-allies", "pal-allies", "cnt-allies", "clr-allies", "auto-allies", 4);
const axisDep = makeDeployer("germans", "map-axis", "pal-axis", "cnt-axis", "clr-axis", "auto-axis", 5);

function summary() {
  document.getElementById("foot-summary").textContent =
    `${LOCATIONS[selLoc.value].name} · ${WEATHER[selWx.value].name} · Allies ${alliesDep.placed.length} vs Axis ${axisDep.placed.length}`;
}
setInterval(summary, 300); summary();

// ---- launch ----------------------------------------------------------------
document.getElementById("start").onclick = () => {
  const config = {
    location: selLoc.value,
    weather: selWx.value,
    allies: { tanks: alliesDep.placed.slice() },
    axis: { tanks: axisDep.placed.slice() },
  };
  document.getElementById("setup").style.display = "none";
  document.getElementById("hud").style.display = "block";
  startGame(config);
};

// expose for smoke tests
window.__setup = { start: () => document.getElementById("start").click(),
  setLocation: (l) => { selLoc.value = l; describe(); }, setWeather: (w) => { selWx.value = w; } };
