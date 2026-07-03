// WWII Tanks — isometric tank combat, Three.js web build.
//
// Exposes startGame(config) so the setup screen (setup.js) can configure the
// battlefield, weather, and both tank rosters before the match begins.
//
// Systems: orbit/zoom/pan camera; Tab-cycle control across friendly tanks;
// arcade vehicle physics; location-based tank damage (track breaks, turret
// blow-off, parts falling off); destructible cover; debris that sinks into the
// ground over ~30s; reload indicators; and crews that bail out, seek cover, go
// prone, and fight with rifles/pistols/grenades — including enemy infantry.
//
// Pure static ES module — no build step, so Vercel serves it directly.

import * as THREE from "three";

export const VERSION = "0.6.0";

// Half-extent of the playable battlefield (world units). Shared with the setup
// minimaps so deployment coordinates line up with the in-game bounds.
export const FIELD = 150;

// X positions of the river bridges (shared so the setup minimap matches).
export const BRIDGE_XS = [-95, -35, 35, 95];

// ---------------------------------------------------------------------------
// Configuration catalogues (shared with the setup UI)
// ---------------------------------------------------------------------------
export const LOCATIONS = {
  normandy:      { name: "Normandy Bocage", ground: 0x56682f, trees: 34, rocks: 12, buildings: 9,  ruins: 5,  river: true },
  ardennes:      { name: "Ardennes Forest", ground: 0x4a5a34, trees: 56, rocks: 14, buildings: 5,  ruins: 4,  river: false },
  north_africa:  { name: "North Africa",    ground: 0xb9a05b, trees: 5,  rocks: 30, buildings: 4,  ruins: 9,  river: false },
  eastern_front: { name: "Eastern Front",   ground: 0x6d7440, trees: 18, rocks: 14, buildings: 8,  ruins: 11, river: true },
};

export const WEATHER = {
  clear:    { name: "Clear",    sky: 0x8fb7d6, fog: [160, 360], sun: 1.1,  amb: 0.9,  tint: 1.0,  precip: null },
  overcast: { name: "Overcast", sky: 0x9aa2a8, fog: [120, 300], sun: 0.6,  amb: 0.8,  tint: 0.85, precip: null },
  rain:     { name: "Rain",     sky: 0x6b7278, fog: [95, 260],  sun: 0.45, amb: 0.7,  tint: 0.7,  precip: "rain" },
  snow:     { name: "Snow",     sky: 0xc4ccd2, fog: [90, 240],  sun: 0.8,  amb: 0.95, tint: 1.1,  precip: "snow", snowGround: true },
  fog:      { name: "Heavy Fog",sky: 0xb7bcc0, fog: [40, 130],  sun: 0.5,  amb: 0.85, tint: 0.9,  precip: null },
};

export const TANK_TYPES = {
  allies: {
    stuart:   { name: "M5 Stuart (Light)",   health: 70,  reload: 0.8, maxFwd: 15, big: false, color: 0x4a5834, dmg: 30 },
    sherman:  { name: "M4 Sherman (Medium)", health: 115, reload: 1.1, maxFwd: 12, big: false, color: 0x556b2f, dmg: 42 },
    pershing: { name: "M26 Pershing (Heavy)",health: 175, reload: 1.7, maxFwd: 9,  big: true,  color: 0x4d5a3a, dmg: 56 },
  },
  germans: {
    panzer2:  { name: "Panzer II (Light)",   health: 65,  reload: 0.85,maxFwd: 15, big: false, color: 0x6a6e72, dmg: 28 },
    panzer4:  { name: "Panzer IV (Medium)",  health: 120, reload: 1.2, maxFwd: 11, big: true,  color: 0x606468, dmg: 44 },
    tiger:    { name: "Tiger I (Heavy)",     health: 205, reload: 1.9, maxFwd: 8,  big: true,  color: 0x585c60, dmg: 62 },
  },
};

// ===========================================================================
export function startGame(config) {
  const TEAM = { ALLIES: "allies", GERMANS: "germans" };
  const opposing = (t) => (t === TEAM.ALLIES ? TEAM.GERMANS : TEAM.ALLIES);
  const clamp = THREE.MathUtils.clamp;
  const deg = THREE.MathUtils.degToRad;
  const rand = (a, b) => a + Math.random() * (b - a);
  const loc = LOCATIONS[config.location] || LOCATIONS.normandy;
  const wx = WEATHER[config.weather] || WEATHER.clear;

  function shortAngle(from, to) {
    let d = (to - from) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  // ---- renderer / scene / camera / lights ---------------------------------
  const app = document.getElementById("app");
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  app.appendChild(renderer.domElement);

  // lifecycle: one AbortController removes every listener on dispose()
  const ac = new AbortController();
  const sig = ac.signal;
  let paused = false, rafId = 0, disposed = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(wx.sky);
  scene.fog = new THREE.Fog(wx.sky, wx.fog[0], wx.fog[1]);

  const camera = new THREE.OrthographicCamera(-30, 30, 18, -18, 0.1, 1000);
  camera.up.set(0, 1, 0);

  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a5238, wx.amb));
  const sun = new THREE.DirectionalLight(0xfff2d6, wx.sun);
  sun.position.set(60, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  {
    const sc = sun.shadow.camera;
    sc.left = -120; sc.right = 120; sc.top = 120; sc.bottom = -120;
    sc.near = 1; sc.far = 400;
  }
  scene.add(sun, sun.target);

  const BOUND = FIELD;
  const GSPAN = FIELD * 2 + 140; // ground overscan beyond the play area
  let groundColor = new THREE.Color(loc.ground);
  if (wx.snowGround) groundColor.lerp(new THREE.Color(0xdfe6ea), 0.6);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GSPAN, GSPAN),
    new THREE.MeshStandardMaterial({ color: groundColor, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ---- helpers ------------------------------------------------------------
  function box(w, h, d, color, rough = 0.85) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.08 })
    );
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  // Entity registries
  const tanks = [], obstacles = [], projectiles = [], grenades = [], crews = [], debris = [], fx = [];
  const bridges = []; // {x, z0, z1, halfW}
  let river = null;   // {z0, z1}

  // ===========================================================================
  // Debris (flies, lands, rests, then sinks into ground + fades over ~30s)
  // ===========================================================================
  const DEBRIS_LIFE = 30, SINK_TIME = 5, MAX_DEBRIS = 560;
  function addDebris(mesh, vel, opts = {}) {
    if (debris.length >= MAX_DEBRIS) scene.remove(debris.shift().mesh);
    mesh.castShadow = true;
    debris.push({ mesh, v: vel || new THREE.Vector3(),
      spin: new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)),
      life: opts.life || DEBRIS_LIFE, rest: false, restY: opts.restY != null ? opts.restY : 0.06 });
  }
  function spawnChips(pos, color, count = 8, power = 6) {
    const geo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1 }));
      m.position.copy(pos); m.scale.setScalar(rand(0.5, 1.4));
      const v = new THREE.Vector3(rand(-1, 1), rand(0.4, 1.3), rand(-1, 1)).normalize().multiplyScalar(power * rand(0.5, 1.2));
      scene.add(m); addDebris(m, v);
    }
  }
  function updateDebris(dt) {
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      d.life -= dt;
      if (!d.rest) {
        d.v.y -= 24 * dt;
        d.mesh.position.addScaledVector(d.v, dt);
        d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.mesh.rotation.z += d.spin.z * dt;
        if (d.mesh.position.y <= d.restY) {
          d.mesh.position.y = d.restY; d.v.multiplyScalar(0.35); d.v.y = 0;
          if (d.v.lengthSq() < 0.4) { d.rest = true; d.v.set(0, 0, 0); }
        }
      }
      if (d.life <= SINK_TIME) {
        const k = clamp(d.life / SINK_TIME, 0, 1);
        d.mesh.position.y = d.restY - (1 - k) * 1.2;
        const mats = Array.isArray(d.mesh.material) ? d.mesh.material : [d.mesh.material];
        for (const m of mats) { m.transparent = true; m.opacity = k; }
      }
      if (d.life <= 0) { scene.remove(d.mesh); debris.splice(i, 1); }
    }
  }
  function detachAsDebris(mesh, extraVel, life) {
    scene.attach(mesh);
    const v = new THREE.Vector3(rand(-2, 2), rand(3, 7), rand(-2, 2));
    if (extraVel) v.add(extraVel);
    addDebris(mesh, v, { life: life || DEBRIS_LIFE, restY: 0.15 });
  }

  // ===========================================================================
  // Explosions + area damage
  // ===========================================================================
  function explode(pos, big = false) {
    const n = big ? 24 : 14;
    const geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    for (let i = 0; i < n; i++) {
      const hot = Math.random() < 0.55;
      const mat = new THREE.MeshStandardMaterial({ color: hot ? 0xff7a1a : 0x2c2c2c,
        emissive: hot ? 0xff5500 : 0x000000, emissiveIntensity: hot ? 1.5 : 0, roughness: 1 });
      const p = new THREE.Mesh(geo, mat); p.position.copy(pos);
      const v = new THREE.Vector3(rand(-1, 1), rand(0.2, 1.1), rand(-1, 1)).normalize().multiplyScalar((big ? 12 : 8) * rand(0.5, 1.3));
      scene.add(p); fx.push({ mesh: p, v, life: rand(0.5, 1.0), spin: rand(-10, 10) });
    }
    const flash = new THREE.PointLight(0xffa040, big ? 16 : 9, big ? 34 : 22, 2);
    flash.position.copy(pos).add(new THREE.Vector3(0, 1.5, 0));
    scene.add(flash); fx.push({ light: flash, life: big ? 0.24 : 0.16 });
  }
  function updateFx(dt) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const p = fx[i]; p.life -= dt;
      if (p.mesh) {
        p.v.y -= 22 * dt; p.mesh.position.addScaledVector(p.v, dt);
        if (p.mesh.position.y < 0.1) { p.mesh.position.y = 0.1; p.v.set(p.v.x * 0.5, 0, p.v.z * 0.5); }
        p.mesh.rotation.x += p.spin * dt; p.mesh.scale.setScalar(Math.max(0.01, p.life * 1.5));
      }
      if (p.light) p.light.intensity *= Math.pow(0.0015, dt);
      if (p.life <= 0) { if (p.mesh) scene.remove(p.mesh); if (p.light) scene.remove(p.light); fx.splice(i, 1); }
    }
  }
  function areaDamage(pos, radius, amount, team) {
    for (const t of tanks) { if (!t.alive || t.team === team) continue;
      const d = t.group.position.distanceTo(pos); if (d < radius) hitTank(t, { type: "he", team }, pos.clone(), amount * (1 - d / radius)); }
    for (const c of crews) { if (!c.alive || c.team === team) continue;
      const d = c.group.position.distanceTo(pos); if (d < radius) hurtCrew(c, amount * 1.5 * (1 - d / radius)); }
  }

  // ===========================================================================
  // Environment: obstacles, buildings, ruins, river+bridges, wire, hedgehogs
  // ===========================================================================
  function reg(o) { obstacles.push(o); return o; }

  function makeTree(x, z) {
    const g = new THREE.Group();
    const trunk = box(0.5, 2.2, 0.5, 0x5b4327); trunk.position.y = 1.1; g.add(trunk);
    const f1 = box(2.4, 1.6, 2.4, wx.snowGround ? 0x5a6e52 : 0x2f5a2a); f1.position.y = 2.7; g.add(f1);
    const f2 = box(1.7, 1.4, 1.7, wx.snowGround ? 0x66785e : 0x376930); f2.position.y = 3.6; g.add(f2);
    g.position.set(x, 0, z); scene.add(g);
    return reg({ group: g, pos: g.position, radius: 1.5, health: 55, type: "tree",
      parts: { trunk, foliage: [f1, f2] }, destroyed: false, solid: true, chip: 0x3a6b32 });
  }
  function makeRock(x, z) {
    const g = new THREE.Group(); const s = rand(1.4, 2.4);
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0),
      new THREE.MeshStandardMaterial({ color: 0x808079, roughness: 1, flatShading: true }));
    r.castShadow = r.receiveShadow = true; r.position.y = s * 0.6; g.add(r);
    g.position.set(x, 0, z); g.rotation.y = rand(0, 6.28); scene.add(g);
    return reg({ group: g, pos: g.position, radius: s * 0.9, health: 130, type: "rock", parts: {}, destroyed: false, solid: true, chip: 0x8a8a82 });
  }
  function makeBuilding(x, z) {
    const g = new THREE.Group();
    const w = rand(5, 9), d = rand(5, 9), h = rand(4, 7);
    const wallCol = 0xb2a184, roofCol = 0x7a3b2a;
    const walls = box(w, h, d, wallCol); walls.position.y = h / 2; g.add(walls);
    const roof = box(w + 0.6, 0.6, d + 0.6, roofCol); roof.position.y = h + 0.3; g.add(roof);
    // a couple of windows
    for (let i = 0; i < 3; i++) { const win = box(0.9, 1.1, 0.05, 0x2b2f33); win.position.set(rand(-w/2+1, w/2-1), rand(1.2, h-1), d / 2 + 0.03); g.add(win); }
    g.position.set(x, 0, z); scene.add(g);
    return reg({ group: g, pos: g.position, radius: Math.max(w, d) * 0.62, health: 260, type: "building", parts: { walls, roof }, destroyed: false, solid: true, chip: 0xb2a184 });
  }
  function makeRuin(x, z) {
    const g = new THREE.Group();
    const segs = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < segs; i++) {
      const w = rand(1.5, 4), h = rand(1, 3.5);
      const seg = box(w, h, 0.6, 0x9a8f7c); seg.position.set(rand(-3, 3), h / 2, rand(-3, 3)); seg.rotation.y = rand(0, 3.14); g.add(seg);
    }
    // rubble
    for (let i = 0; i < 6; i++) { const r = box(rand(0.4, 1), rand(0.3, 0.7), rand(0.4, 1), 0x8a8172); r.position.set(rand(-3.5, 3.5), 0.3, rand(-3.5, 3.5)); g.add(r); }
    g.position.set(x, 0, z); scene.add(g);
    return reg({ group: g, pos: g.position, radius: 3.2, health: 140, type: "ruin", parts: {}, destroyed: false, solid: true, chip: 0x9a8f7c });
  }
  function makeHedgehog(x, z) { // Czech hedgehog anti-tank obstacle
    const g = new THREE.Group();
    const col = 0x555a5e;
    for (const rot of [[0, 0], [Math.PI / 2, 0], [0, Math.PI / 2]]) {
      const beam = box(0.22, 0.22, 2.6, col); beam.rotation.set(rot[0], rot[1], Math.PI / 4); g.add(beam);
    }
    g.position.set(x, 0.9, z); scene.add(g);
    return reg({ group: g, pos: new THREE.Vector3(x, 0, z), radius: 1.2, health: 90, type: "hedgehog", parts: {}, destroyed: false, solid: true, chip: 0x555a5e });
  }
  function makeWire(x, z, len, angle) { // barbed wire: blocks infantry, hurts them
    const g = new THREE.Group();
    const posts = Math.max(2, Math.round(len / 2));
    for (let i = 0; i <= posts; i++) {
      const p = box(0.12, 1.0, 0.12, 0x3a3a3a); p.position.set(-len / 2 + (len / posts) * i, 0.5, 0); g.add(p);
    }
    const wire = box(len, 0.06, 0.06, 0x6a6a6a); wire.position.y = 0.8; g.add(wire);
    const wire2 = box(len, 0.06, 0.06, 0x6a6a6a); wire2.position.y = 0.5; g.add(wire2);
    g.position.set(x, 0, z); g.rotation.y = angle; scene.add(g);
    return reg({ group: g, pos: g.position, radius: 0.6, halfLen: len / 2, angle, type: "wire", destroyed: false, solid: false, infantry: true, chip: 0x6a6a6a });
  }

  function makeRiverAndBridges() {
    river = { z0: 6, z1: 18 };
    const water = new THREE.Mesh(new THREE.PlaneGeometry(GSPAN, river.z1 - river.z0),
      new THREE.MeshStandardMaterial({ color: 0x2f5568, roughness: 0.3, metalness: 0.2, transparent: true, opacity: 0.9 }));
    water.rotation.x = -Math.PI / 2; water.position.set(0, -0.15, (river.z0 + river.z1) / 2);
    scene.add(water);
    // banks
    for (const bz of [river.z0, river.z1]) {
      const bank = box(GSPAN, 0.4, 0.6, 0x5a4a30); bank.position.set(0, 0.1, bz); scene.add(bank);
    }
    for (const bx of BRIDGE_XS) {
      const halfW = 6;
      const deck = box(halfW * 2, 0.5, river.z1 - river.z0 + 1.5, 0x6b4f32);
      deck.position.set(bx, 0.35, (river.z0 + river.z1) / 2); scene.add(deck);
      for (const sx of [-halfW, halfW]) { const rail = box(0.3, 0.7, river.z1 - river.z0 + 1.5, 0x4a3722); rail.position.set(bx + sx, 0.7, (river.z0 + river.z1) / 2); scene.add(rail); }
      bridges.push({ x: bx, halfW });
    }
  }

  function inRiver(p) { return river && p.z > river.z0 - 0.4 && p.z < river.z1 + 0.4; }
  function onBridge(p) { return bridges.some((b) => Math.abs(p.x - b.x) < b.halfW - 0.4); }

  function damageObstacle(o, amount, at) {
    if (o.destroyed || o.type === "wire") return;
    o.health -= amount;
    spawnChips(at.clone().setY(clamp(at.y, 0.4, 4)), o.chip, 6, 5);
    o.group.position.x = o.pos.x + rand(-0.05, 0.05);
    if (o.health <= 0) destroyObstacle(o);
  }
  function destroyObstacle(o) {
    o.destroyed = true;
    if (o.type === "tree") {
      for (const f of o.parts.foliage) detachAsDebris(f, new THREE.Vector3(rand(-3, 3), rand(2, 5), rand(-3, 3)));
      detachAsDebris(o.parts.trunk, new THREE.Vector3(rand(-2, 2), 1, rand(-2, 2)));
      spawnChips(o.pos.clone().setY(1.2), o.chip, 10, 6); o.radius = 0; o.solid = false;
    } else if (o.type === "building" || o.type === "ruin" || o.type === "hedgehog" || o.type === "rock") {
      const big = o.type === "building";
      spawnChips(o.pos.clone().setY(1), o.chip, big ? 30 : 18, 8);
      if (big) { explode(o.pos.clone().setY(2), true);
        // collapse into rubble pile
        for (let i = 0; i < 14; i++) { const r = box(rand(0.6, 1.6), rand(0.4, 0.9), rand(0.6, 1.6), o.chip);
          r.position.copy(o.pos).add(new THREE.Vector3(rand(-3, 3), rand(0.5, 3), rand(-3, 3))); scene.add(r);
          addDebris(r, new THREE.Vector3(rand(-4, 4), rand(2, 6), rand(-4, 4)), { life: DEBRIS_LIFE * 1.5 }); }
      }
      scene.remove(o.group);
      o.radius = o.type === "ruin" ? o.radius : 0; o.solid = o.type === "ruin"; // ruins leave low rubble collider
      if (o.type === "ruin") o.radius = 1.6;
    }
  }

  // What a given tank can simply drive through, toppling it.
  function crushableBy(o, tank) {
    if (!tank) return false;
    if (o.type === "tree" || o.type === "crate") return true;   // knocked flat by any tank
    if (o.type === "hedgehog") return !!tank.big;                // only heavies shove these aside
    return false;
  }
  function crush(o, tank) { destroyObstacle(o); if (tank) tank.speed *= 0.55; }
  function flattenWire(o) { if (o.destroyed) return; o.destroyed = true; spawnChips(o.pos.clone().setY(0.6), o.chip, 6, 3); scene.remove(o.group); }

  // Push a moving circle out of solid obstacles. If `crusher` is a tank that can
  // knock the obstacle over, it drives through and topples it instead of stopping.
  function resolveObstacles(pos, rr, infantry, crusher) {
    for (const o of obstacles) {
      if (o.destroyed || o.radius <= 0) continue;
      if (o.type === "wire") continue; // handled separately
      if (!o.solid && !(infantry && o.infantry)) continue;
      const dx = pos.x - o.pos.x, dz = pos.z - o.pos.z, dist = Math.hypot(dx, dz), min = o.radius + rr;
      if (dist < min && dist > 1e-3) {
        if (crusher && crushableBy(o, crusher)) { crush(o, crusher); continue; }
        const push = min - dist; pos.x += (dx / dist) * push; pos.z += (dz / dist) * push;
      }
    }
  }
  // barbed wire: block + hurt infantry crossing
  function wireBlocksInfantry(pos) {
    for (const o of obstacles) {
      if (o.type !== "wire" || o.destroyed) continue;
      // distance from point to wire segment
      const c = Math.cos(o.angle), s = Math.sin(o.angle);
      const lx = (pos.x - o.pos.x) * c + (pos.z - o.pos.z) * s;
      const lz = -(pos.x - o.pos.x) * s + (pos.z - o.pos.z) * c;
      if (Math.abs(lx) < o.halfLen && Math.abs(lz) < 0.8) return o;
    }
    return null;
  }

  function seedEnvironment() {
    if (loc.river) makeRiverAndBridges();
    const placed = [];
    const tooClose = (x, z, d) => placed.some((p) => Math.hypot(p.x - x, p.z - z) < d) ||
      (inRiver({ x, z }) && !onBridge({ x, z }));
    const R = BOUND - 8;
    const spot = (minGap) => {
      for (let k = 0; k < 40; k++) { const x = rand(-R, R), z = rand(-R, R);
        if (Math.abs(x) < 10 && z < -30 && z > -70) continue; // keep allied start clear
        if (!tooClose(x, z, minGap)) { placed.push({ x, z }); return [x, z]; } }
      return null;
    };
    const put = (fn, gap) => { const s = spot(gap); if (s) fn(s[0], s[1]); };
    for (let i = 0; i < loc.buildings; i++) put(makeBuilding, 16);
    for (let i = 0; i < loc.ruins; i++) put(makeRuin, 12);
    for (let i = 0; i < loc.trees; i++) put(makeTree, 7);
    for (let i = 0; i < loc.rocks; i++) put(makeRock, 7);
    // anti-tank belt + wire near the river / mid-field
    for (let i = 0; i < 18; i++) put(makeHedgehog, 5);
    for (let i = 0; i < 12; i++) { const s = spot(9); if (s) makeWire(s[0], s[1], rand(6, 12), rand(0, 3.14)); }
    // user-placed structures/objects (added on top of the generated terrain)
    for (const p of (config.props || [])) {
      const x = clamp(p.x, -BOUND, BOUND), z = clamp(p.z, -BOUND, BOUND);
      if (p.type === "building") makeBuilding(x, z);
      else if (p.type === "ruin") makeRuin(x, z);
      else if (p.type === "tree") makeTree(x, z);
      else if (p.type === "rock") makeRock(x, z);
      else if (p.type === "hedgehog") makeHedgehog(x, z);
      else if (p.type === "wire") makeWire(x, z, 9, p.a || 0);
    }
  }
  seedEnvironment();

  // weather precipitation
  let precip = null;
  if (wx.precip) {
    const N = wx.precip === "rain" ? 1400 : 900;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { pos[i*3] = rand(-90, 90); pos[i*3+1] = rand(0, 90); pos[i*3+2] = rand(-90, 90); }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: wx.precip === "rain" ? 0x9fb4c4 : 0xffffff,
      size: wx.precip === "rain" ? 0.35 : 0.5, transparent: true, opacity: 0.8 });
    precip = new THREE.Points(geo, mat); scene.add(precip);
    precip.userData.speed = wx.precip === "rain" ? 60 : 12;
  }
  function updatePrecip(dt) {
    if (!precip) return;
    const p = precip.geometry.attributes.position; const sp = precip.userData.speed;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) - sp * dt;
      if (y < 0) { y = 90; p.setX(i, cam.focus.x + rand(-90, 90)); p.setZ(i, cam.focus.z + rand(-90, 90)); }
      p.setY(i, y);
    }
    p.needsUpdate = true;
  }

  // ===========================================================================
  // Tanks
  // ===========================================================================
  function buildTank(bodyColor, big) {
    const track = 0x262626, group = new THREE.Group(), parts = {};
    parts.lower = box(2.0, 0.5, 3.0, bodyColor); parts.lower.position.y = 0.4; group.add(parts.lower);
    parts.upper = box(1.55, 0.34, 2.3, bodyColor); parts.upper.position.set(0, 0.78, 0.15); group.add(parts.upper);
    parts.glacis = box(1.2, 0.28, 0.6, bodyColor); parts.glacis.position.set(0, 0.85, 1.35); parts.glacis.rotation.x = -0.5; group.add(parts.glacis);
    parts.leftTrack = box(0.42, 0.64, 3.25, track); parts.leftTrack.position.set(-1.02, 0.32, 0); group.add(parts.leftTrack);
    parts.rightTrack = box(0.42, 0.64, 3.25, track); parts.rightTrack.position.set(1.02, 0.32, 0); group.add(parts.rightTrack);
    parts.fender = box(2.2, 0.08, 3.1, bodyColor); parts.fender.position.set(0, 0.66, 0); group.add(parts.fender);
    const turret = new THREE.Group(); turret.position.set(0, 1.0, 0);
    const tw = big ? 1.6 : 1.35;
    parts.turretBody = box(tw, big ? 0.6 : 0.55, big ? 1.6 : 1.45, bodyColor); parts.turretBody.position.y = 0.28; turret.add(parts.turretBody);
    const barrelLen = big ? 2.5 : 2.0;
    parts.barrel = box(big ? 0.28 : 0.2, big ? 0.28 : 0.2, barrelLen, 0x33352f); parts.barrel.position.set(0, 0.3, barrelLen / 2 + 0.5); turret.add(parts.barrel);
    parts.cupola = box(0.36, 0.22, 0.36, bodyColor); parts.cupola.position.set(0, 0.6, -0.4); turret.add(parts.cupola);
    group.add(turret);
    return { group, turret, parts };
  }
  function makeBar(color, y, width) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ color, depthTest: false, depthWrite: false }));
    s.center.set(0, 0.5); s.position.set(-width / 2, y, 0); s.scale.set(width, 0.22, 1); s.renderOrder = 999; return s;
  }
  function spawnTank(team, typeKey, x, z, yaw) {
    const spec = TANK_TYPES[team][typeKey] || Object.values(TANK_TYPES[team])[0];
    const built = buildTank(spec.color, spec.big);
    built.group.position.set(x, 0, z); built.group.rotation.y = yaw || 0; scene.add(built.group);
    const bars = new THREE.Group(); bars.position.y = 3.3;
    const hpBg = makeBar(0x111111, 0, 2.2), hpFill = makeBar(0x7ac74f, 0, 2.2);
    const rlBg = makeBar(0x111111, -0.32, 2.2), rlFill = makeBar(0xffd24a, -0.32, 2.2);
    bars.add(hpBg, hpFill, rlBg, rlFill); built.group.add(bars);
    const t = { team, typeKey, name: spec.name, group: built.group, turret: built.turret, parts: built.parts,
      yaw: yaw || 0, turretYaw: 0, speed: 0, health: spec.health, maxHealth: spec.health, radius: 1.8,
      cooldown: 0, reload: spec.reload, maxFwd: spec.maxFwd, dmg: spec.dmg, big: spec.big,
      leftTrackBroken: false, rightTrackBroken: false, turretGone: false, alive: true, disabled: false,
      crewCount: spec.big ? 4 : 3, hasGrenades: Math.random() < 0.6, bars, hpFill, rlFill, rlBg };
    tanks.push(t); return t;
  }

  function updateTankBars(t) {
    const hp = clamp(t.health / t.maxHealth, 0, 1);
    t.hpFill.scale.x = 2.2 * hp;
    t.hpFill.material.color.setHex(hp <= 0.3 ? 0xe0574a : hp <= 0.6 ? 0xffd24a : 0x7ac74f);
    const reloading = t.cooldown > 0 && !t.turretGone;
    t.rlBg.visible = reloading; t.rlFill.visible = reloading;
    if (reloading) { const p = clamp(1 - t.cooldown / t.reload, 0, 1); t.rlFill.scale.x = 2.2 * p; t.rlFill.material.color.setHex(p > 0.85 ? 0x8ef08a : 0xffd24a); }
    t.bars.visible = t.alive && !t.disabled;
    t.bars.rotation.y = -t.group.rotation.y;
  }

  // ---- spawn rosters from config -----------------------------------------
  function roster(team, list, defaultZ, yaw) {
    const out = [];
    (list && list.length ? list : null || []).forEach(() => {});
    const arr = (list && list.length) ? list : [];
    for (const item of arr) out.push(spawnTank(team, item.type, item.x, item.z, yaw));
    return out;
  }
  const allyTanks = roster(TEAM.ALLIES, config.allies && config.allies.tanks, -32, 0);
  const enemyTanks = roster(TEAM.GERMANS, config.axis && config.axis.tanks, 40, Math.PI);

  // safety net: ensure at least one tank per side
  if (allyTanks.length === 0) allyTanks.push(spawnTank(TEAM.ALLIES, "sherman", 0, -32, 0));
  if (enemyTanks.length === 0) enemyTanks.push(spawnTank(TEAM.GERMANS, "panzer4", 0, 44, Math.PI));

  let enemiesLeft = enemyTanks.length;
  let alliesLeft = allyTanks.length;

  // controllable tank + selection marker
  let controlled = allyTanks[0];
  const marker = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.0, 4),
    new THREE.MeshBasicMaterial({ color: 0xffe14a }));
  marker.rotation.x = Math.PI; marker.position.y = 4.1; scene.add(marker);

  function cycleControl(dir = 1) {
    const alive = allyTanks.filter((t) => t.alive);
    if (!alive.length) { controlled = null; return; }
    let idx = alive.indexOf(controlled);
    idx = (idx + dir + alive.length) % alive.length;
    controlled = alive[idx];
    cam.pan.set(0, 0, 0);
    banner(`CONTROL: ${controlled.name}`, 1.2);
  }

  // ===========================================================================
  // Crew: bail out, seek cover, go prone, fight (rifles/pistols/grenades)
  // ===========================================================================
  function makeCrewFigure(color, weapon) {
    const g = new THREE.Group();
    const torso = box(0.5, 0.7, 0.35, color); torso.position.y = 1.0; g.add(torso);
    const head = box(0.32, 0.32, 0.32, 0xd8b98a); head.position.y = 1.55; g.add(head);
    const helmet = box(0.38, 0.16, 0.4, color); helmet.position.y = 1.72; g.add(helmet);
    const lleg = box(0.2, 0.6, 0.2, 0x2c2c2c); lleg.position.set(-0.14, 0.4, 0); g.add(lleg);
    const rleg = box(0.2, 0.6, 0.2, 0x2c2c2c); rleg.position.set(0.14, 0.4, 0); g.add(rleg);
    const gunLen = weapon === "pistol" ? 0.35 : 0.9;
    const gun = box(0.08, 0.08, gunLen, 0x241c12); gun.position.set(0.28, weapon === "pistol" ? 1.15 : 1.05, 0.3); g.add(gun);
    return { g, legs: [lleg, rleg] };
  }
  function spawnCrew(tank) {
    const color = tank.team === TEAM.GERMANS ? 0x5a5c50 : 0x6b7040;
    for (let i = 0; i < tank.crewCount; i++) {
      const weapon = (tank.hasGrenades && i === 0) ? "grenade" : (i === 1 ? "pistol" : "rifle");
      const fig = makeCrewFigure(color, weapon);
      fig.g.position.copy(tank.group.position).add(new THREE.Vector3(rand(-1.5, 1.5), 0, rand(-1.5, 1.5)));
      fig.g.position.y = 0; scene.add(fig.g);
      crews.push({ team: tank.team, group: fig.g, legs: fig.legs, torso: fig.g.children[0], yaw: 0,
        health: 24, alive: true, speed: rand(6, 8.5), weapon, grenades: weapon === "grenade" ? 3 : 0,
        cooldown: rand(0.4, 1.4), bob: Math.random() * 6, state: "seek", cover: null, prone: false });
    }
  }
  function hurtCrew(c, amount) {
    if (!c.alive) return; c.health -= amount;
    spawnChips(c.group.position.clone().setY(1), 0x7a2b22, 4, 4);
    if (c.health <= 0) { c.alive = false; spawnChips(c.group.position.clone().setY(0.8), 0x5a5c50, 6, 4); scene.remove(c.group); }
  }
  function nearestEnemyEntity(pos, team, range = Infinity, crewOnly = false) {
    let best = null, bd = range;
    const scan = (arr) => { for (const e of arr) { if (!e.alive || e.team === team || e.disabled) continue;
      const d = e.group.position.distanceTo(pos); if (d < bd) { bd = d; best = e; } } };
    if (!crewOnly) scan(tanks); scan(crews);
    return { target: best, dist: bd };
  }
  function nearestCover(pos, awayFrom) {
    let best = null, bd = 40;
    for (const o of obstacles) { if (o.destroyed || o.radius <= 0 || !o.solid) continue;
      const d = o.pos.distanceTo(pos); if (d < bd) { bd = d; best = o; } }
    if (!best) return null;
    // point on the far side of the cover from the threat
    const dir = best.pos.clone().sub(awayFrom).setY(0);
    if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
    dir.normalize();
    return best.pos.clone().addScaledVector(dir, best.radius + 1.2).setY(0);
  }
  function updateCrew(dt) {
    for (const c of crews) {
      if (!c.alive) continue;
      if (c.cooldown > 0) c.cooldown -= dt;
      const threat = nearestEnemyEntity(c.group.position, c.team, 120).target;
      const threatDist = threat ? threat.group.position.distanceTo(c.group.position) : Infinity;

      // decide state
      if (threat && threatDist < 9) c.state = "flee";
      else if (threat) { if (!c.cover || c.cover.distanceTo(c.group.position) < 1.6) { const cv = nearestCover(c.group.position, threat.group.position); c.state = cv ? "cover" : "fight"; c.cover = cv; } }
      else c.state = "idle";

      let move = null;
      if (c.state === "flee") { move = c.group.position.clone().sub(threat.group.position).setY(0).normalize(); c.prone = false; }
      else if (c.state === "cover" && c.cover) {
        const toCover = c.cover.clone().sub(c.group.position).setY(0);
        if (toCover.length() > 1.4) move = toCover.normalize();
        else { c.prone = true; move = null; } // reached cover → go prone
      } else if (c.state === "fight") { c.prone = true; move = null; }
      else { c.prone = false; }

      if (move) {
        const np = c.group.position.clone().addScaledVector(move, c.speed * dt);
        np.x = clamp(np.x, -BOUND, BOUND); np.z = clamp(np.z, -BOUND, BOUND); np.y = 0;
        resolveObstacles(np, 0.4, true);
        const w = wireBlocksInfantry(np);
        if (w) { hurtCrew(c, 6 * dt); } else { c.group.position.copy(np); }
        c.yaw = Math.atan2(move.x, move.z);
      } else if (threat) {
        c.yaw = Math.atan2(threat.group.position.x - c.group.position.x, threat.group.position.z - c.group.position.z);
      }

      // pose
      c.group.rotation.y = c.yaw;
      if (c.prone) { c.group.rotation.x = -1.15; c.group.position.y = 0.15; }
      else { c.group.rotation.x = 0; c.group.position.y = 0;
        c.bob += dt * 12; c.legs[0].rotation.x = Math.sin(c.bob) * 0.7; c.legs[1].rotation.x = -Math.sin(c.bob) * 0.7; }

      // fire (rifles/pistols minimal damage; grenades area). Attacks tanks AND crew.
      if (threat && c.cooldown <= 0 && c.state !== "flee") {
        const range = c.weapon === "pistol" ? 22 : 48;
        if (c.weapon === "grenade" && c.grenades > 0 && threatDist < 34 && threatDist > 6) {
          c.grenades--; c.cooldown = 2.8;
          throwGrenade(c.group.position.clone().setY(1.2), threat.group.position.clone(), c.team);
          if (c.grenades === 0) c.weapon = "rifle";
        } else if (threatDist < range) {
          c.cooldown = c.weapon === "pistol" ? rand(0.35, 0.7) : rand(0.6, 1.2);
          const from = c.group.position.clone().setY(c.prone ? 0.6 : 1.1);
          const aim = threat.group.position.clone().setY(0.9).sub(from).normalize();
          aim.x += rand(-0.06, 0.06); aim.z += rand(-0.06, 0.06);
          fireProjectile(from, aim.normalize(), c.team, "mg");
        }
      }
    }
  }

  // ===========================================================================
  // Projectiles + grenades
  // ===========================================================================
  const shellGeo = new THREE.SphereGeometry(0.22, 8, 8);
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0x5a3d00, roughness: 0.5 });
  const mgGeo = new THREE.SphereGeometry(0.1, 6, 6);
  const mgMat = new THREE.MeshStandardMaterial({ color: 0xfff2a0, emissive: new THREE.Color(0x665500), roughness: 0.4 });
  const PROJ = {
    ap: { speed: 78, life: 2.5, geo: shellGeo, mat: shellMat, crewDmg: 100, obsDmg: 55, big: true },
    mg: { speed: 60, life: 1.5, geo: mgGeo, mat: mgMat, tankDmg: 4, crewDmg: 14, obsDmg: 6, big: false },
  };
  function fireProjectile(from, dir, team, type, dmg) {
    const spec = PROJ[type];
    const mesh = new THREE.Mesh(spec.geo, spec.mat); mesh.position.copy(from); scene.add(mesh);
    projectiles.push({ mesh, dir: dir.clone().normalize(), team, type, life: spec.life, spec, dmg, hitObs: new Set() });
  }
  function fireTank(t) {
    if (t.turretGone || t.cooldown > 0 || !t.alive) return false;
    t.cooldown = t.reload;
    const yaw = t.yaw + t.turretYaw, dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const from = t.group.position.clone().add(new THREE.Vector3(0, 1.35, 0)).addScaledVector(dir, 3.6);
    fireProjectile(from, dir, t.team, "ap", t.dmg);
    t.speed -= 3;
    if (t === controlled) cam.shake = Math.min(1.6, cam.shake + 0.5);
    return true;
  }
  function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const s = projectiles[i]; s.life -= dt;
      s.mesh.position.addScaledVector(s.dir, s.spec.speed * dt);
      const p = s.mesh.position; let done = false;
      for (const o of obstacles) { if (o.destroyed || o.radius <= 0 || s.hitObs.has(o) || o.type === "wire") continue;
        if (Math.hypot(p.x - o.pos.x, p.z - o.pos.z) < o.radius && p.y < 5) { s.hitObs.add(o); damageObstacle(o, s.spec.obsDmg, p.clone()); } }
      for (const t of tanks) { if (!t.alive || t.team === s.team) continue;
        if (p.distanceTo(t.group.position.clone().setY(1)) < t.radius + 0.5) { hitTank(t, s, p.clone()); explode(p.clone(), s.spec.big); done = true; break; } }
      if (!done) for (const c of crews) { if (!c.alive || c.team === s.team) continue;
        if (p.distanceTo(c.group.position.clone().setY(0.9)) < 0.7) { hurtCrew(c, s.spec.crewDmg); if (s.spec.big) explode(p.clone()); done = true; break; } }
      if (done || s.life <= 0 || p.y < 0 || Math.abs(p.x) > BOUND + 15 || Math.abs(p.z) > BOUND + 15) {
        if (!done && s.spec.big) explode(p.clone());
        scene.remove(s.mesh); projectiles.splice(i, 1);
      }
    }
  }
  const grenadeGeo = new THREE.SphereGeometry(0.18, 8, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x3b4022, roughness: 0.7 });
  function throwGrenade(from, target, team) {
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat); mesh.position.copy(from); scene.add(mesh);
    const flat = target.clone().sub(from).setY(0), dist = flat.length(), t = clamp(dist / 16, 0.7, 1.6);
    const v = flat.multiplyScalar(1 / t); v.y = 0.5 * 24 * t;
    grenades.push({ mesh, v, team, fuse: t + 0.05 });
  }
  function updateGrenades(dt) {
    for (let i = grenades.length - 1; i >= 0; i--) {
      const g = grenades[i]; g.fuse -= dt; g.v.y -= 24 * dt;
      g.mesh.position.addScaledVector(g.v, dt); g.mesh.rotation.x += dt * 8;
      if (g.mesh.position.y <= 0.2 || g.fuse <= 0) {
        const pos = g.mesh.position.clone().setY(0.3);
        explode(pos, true); spawnChips(pos, 0x3b4022, 10, 7); areaDamage(pos, 6, 45, g.team);
        scene.remove(g.mesh); grenades.splice(i, 1);
      }
    }
  }

  // ===========================================================================
  // Tank damage (location-based)
  // ===========================================================================
  function hitTank(t, proj, hitPos, overrideDmg) {
    if (!t.alive) return;
    const spec = proj.spec || {};
    let dmg = overrideDmg != null ? overrideDmg : (proj.dmg != null ? proj.dmg : (spec.tankDmg != null ? spec.tankDmg : 30));
    const local = t.group.worldToLocal(hitPos.clone());
    const side = Math.abs(local.x) > 0.7, high = local.y > 0.85;
    const heavy = proj.type === "ap" || proj.type === "he";
    if (proj.type === "mg") { dmg *= 0.5; spawnChips(hitPos.clone(), 0xffe08a, 3, 3); }
    t.health -= dmg;
    if (heavy && side && local.y < 0.75 && !(local.x < 0 ? t.leftTrackBroken : t.rightTrackBroken) && Math.random() < 0.7) {
      const left = local.x < 0;
      if (left) { t.leftTrackBroken = true; detachAsDebris(t.parts.leftTrack); } else { t.rightTrackBroken = true; detachAsDebris(t.parts.rightTrack); }
      spawnChips(hitPos.clone(), 0x222222, 8, 5);
    }
    if (heavy && !t.turretGone && (high || t.health <= t.maxHealth * 0.35) && Math.random() < (high ? 0.5 : 0.25)) blowTurret(t);
    if (heavy && !high && Math.random() < 0.3 && t.parts.cupola.parent) detachAsDebris(t.parts.cupola, new THREE.Vector3(rand(-2, 2), 4, rand(-2, 2)));
    if (heavy && Math.random() < 0.25 && t.parts.fender && t.parts.fender.parent) detachAsDebris(t.parts.fender, new THREE.Vector3(rand(-3, 3), 2, rand(-3, 3)));
    if (t.health <= 0) disableTank(t);
    else if (t === controlled) flashHud();
  }
  function blowTurret(t) {
    if (t.turretGone) return; t.turretGone = true;
    const wp = new THREE.Vector3(); t.turret.getWorldPosition(wp);
    detachAsDebris(t.turret, new THREE.Vector3(rand(-3, 3), rand(9, 14), rand(-3, 3)), DEBRIS_LIFE);
    explode(wp, true); if (t === controlled) cam.shake = Math.min(2, cam.shake + 1);
  }
  function disableTank(t) {
    if (t.disabled) return; t.disabled = true; t.alive = false; t.speed = 0;
    explode(t.group.position.clone().setY(1), true);
    for (const key of ["lower", "upper", "glacis", "turretBody"]) { const m = t.parts[key]; if (m && m.parent && m.material) m.material.color.multiplyScalar(0.4); }
    t.bars.visible = false; spawnCrew(t);
    if (t.team === TEAM.GERMANS) { enemiesLeft = Math.max(0, enemiesLeft - 1); if (enemiesLeft === 0) banner("VICTORY", 0, true, "All Axis armour knocked out"); }
    else {
      alliesLeft = Math.max(0, alliesLeft - 1);
      if (t === controlled) cycleControl(1);
      if (alliesLeft === 0) banner("DEFEAT", 0, false, "All Allied armour knocked out");
    }
    updateHUD();
  }

  // ===========================================================================
  // Camera
  // ===========================================================================
  const cam = { azimuth: Math.PI / 4, pitch: deg(35.264), distance: 160, size: 42,
    focus: controlled ? controlled.group.position.clone() : new THREE.Vector3(), pan: new THREE.Vector3(), shake: 0 };
  const MIN_SIZE = 12, MAX_SIZE = 130;
  function updateCamera(dt) {
    const kx = (keys["arrowright"] ? 1 : 0) - (keys["arrowleft"] ? 1 : 0);
    const kz = (keys["arrowup"] ? 1 : 0) - (keys["arrowdown"] ? 1 : 0);
    if (kx || kz) { const right = new THREE.Vector3(Math.cos(cam.azimuth), 0, -Math.sin(cam.azimuth)), fwd = new THREE.Vector3(Math.sin(cam.azimuth), 0, Math.cos(cam.azimuth));
      cam.pan.addScaledVector(right, kx * 90 * dt).addScaledVector(fwd, kz * 90 * dt); }
    // keep the camera focus over the battlefield — clamp so you can't pan into the void
    const anchor = controlled ? controlled.group.position.clone() : cam.focus.clone();
    const LIMIT = BOUND + 12;
    const desired = anchor.clone().add(cam.pan);
    desired.x = clamp(desired.x, -LIMIT, LIMIT); desired.z = clamp(desired.z, -LIMIT, LIMIT); desired.y = 0;
    cam.pan.set(desired.x - anchor.x, 0, desired.z - anchor.z); // absorb the clamp so pan can't run away past the edge
    cam.focus.lerp(desired, 1 - Math.pow(0.0015, dt));
    const dir = new THREE.Vector3(Math.cos(cam.pitch) * Math.sin(cam.azimuth), Math.sin(cam.pitch), Math.cos(cam.pitch) * Math.cos(cam.azimuth));
    const eye = cam.focus.clone().addScaledVector(dir, cam.distance);
    if (cam.shake > 0.001) { cam.shake *= Math.pow(0.02, dt); eye.add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(cam.shake)); }
    camera.position.copy(eye); camera.lookAt(cam.focus);
    const aspect = window.innerWidth / window.innerHeight;
    camera.left = -cam.size * aspect; camera.right = cam.size * aspect; camera.top = cam.size; camera.bottom = -cam.size;
    camera.near = 0.1; camera.far = 1000; camera.updateProjectionMatrix();
    sun.target.position.copy(cam.focus); sun.position.copy(cam.focus).add(new THREE.Vector3(60, 90, 40));
    if (controlled) { marker.visible = true; marker.position.set(controlled.group.position.x, 4.1 + Math.sin(performance_now() * 0.004) * 0.15, controlled.group.position.z); }
    else marker.visible = false;
  }
  // performance.now without Date (safe)
  let _t0 = 0; function performance_now() { return _t0; }

  // ===========================================================================
  // Input
  // ===========================================================================
  const keys = {};
  addEventListener("keydown", (e) => {
    if (e.key === "Tab") { e.preventDefault(); cycleControl(e.shiftKey ? -1 : 1); return; }
    keys[e.key.toLowerCase()] = true;
    if (e.key === " ") { e.preventDefault(); tryFire(); }
  }, { signal: sig });
  addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; }, { signal: sig });

  let orbiting = false, panning = false;
  const mouseNDC = new THREE.Vector2(), aimPoint = new THREE.Vector3(0, 0, -10);
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), raycaster = new THREE.Raycaster();
  const canvas = renderer.domElement;
  canvas.addEventListener("contextmenu", (e) => e.preventDefault(), { signal: sig });
  canvas.addEventListener("mousedown", (e) => { if (e.button === 0) tryFire(); else if (e.button === 2) orbiting = true; else if (e.button === 1) { panning = true; e.preventDefault(); } }, { signal: sig });
  addEventListener("mouseup", (e) => { if (e.button === 2) orbiting = false; if (e.button === 1) panning = false; }, { signal: sig });
  addEventListener("mousemove", (e) => {
    mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1; mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
    if (orbiting) { cam.azimuth -= e.movementX * 0.006; cam.pitch = clamp(cam.pitch - e.movementY * 0.006, deg(12), deg(82)); }
    if (panning) { const right = new THREE.Vector3(Math.cos(cam.azimuth), 0, -Math.sin(cam.azimuth)), fwd = new THREE.Vector3(Math.sin(cam.azimuth), 0, Math.cos(cam.azimuth)), k = cam.size * 0.006;
      cam.pan.addScaledVector(right, -e.movementX * k).addScaledVector(fwd, -e.movementY * k); }
  }, { signal: sig });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); cam.size = clamp(cam.size * (e.deltaY > 0 ? 1.1 : 1 / 1.1), MIN_SIZE, MAX_SIZE); }, { passive: false, signal: sig });
  function updateAim() { raycaster.setFromCamera(mouseNDC, camera); const hit = new THREE.Vector3(); if (raycaster.ray.intersectPlane(groundPlane, hit)) aimPoint.copy(hit); }
  function tryFire() { if (controlled && controlled.alive && !gameOver) fireTank(controlled); }

  // ===========================================================================
  // Movement / AI
  // ===========================================================================
  function driveTank(t, throttle, steer, dt) {
    let maxFwd = t.maxFwd, maxRev = 5;
    if (t.leftTrackBroken && t.rightTrackBroken) { t.speed *= Math.pow(0.02, dt); throttle = 0; steer = 0; }
    else if (t.leftTrackBroken || t.rightTrackBroken) { maxFwd *= 0.5; maxRev *= 0.5; t.yaw += (t.leftTrackBroken ? 1 : -1) * deg(35) * (Math.abs(t.speed) / maxFwd + 0.2) * dt; }
    if (throttle > 0) t.speed += 14 * dt; else if (throttle < 0) t.speed -= 20 * dt;
    else t.speed -= Math.sign(t.speed) * Math.min(Math.abs(t.speed), 7 * dt);
    t.speed = clamp(t.speed, -maxRev, maxFwd);
    if (steer && !(t.leftTrackBroken && t.rightTrackBroken)) { const grip = 0.4 + 0.6 * Math.min(1, Math.abs(t.speed) / maxFwd); t.yaw -= steer * deg(72) * grip * dt; }
    t.group.rotation.y = t.yaw;
    const fwd = new THREE.Vector3(Math.sin(t.yaw), 0, Math.cos(t.yaw));
    const prev = t.group.position.clone();
    const np = prev.clone().addScaledVector(fwd, t.speed * dt);
    np.x = clamp(np.x, -BOUND, BOUND); np.z = clamp(np.z, -BOUND, BOUND); np.y = 0;
    resolveObstacles(np, t.radius, false, t);            // t crushes what it can, is blocked by the rest
    const w = wireBlocksInfantry(np); if (w) flattenWire(w); // tanks flatten barbed wire they roll over
    if (inRiver(np) && !onBridge(np)) { t.speed *= 0.2; np.copy(prev); } // blocked by river except at bridges
    t.group.position.copy(np);
  }
  function updateControlled(dt) {
    const t = controlled; if (!t || !t.alive) return;
    if (t.cooldown > 0) t.cooldown -= dt;
    const throttle = (keys["w"] ? 1 : 0) - (keys["s"] ? 1 : 0), steer = (keys["d"] ? 1 : 0) - (keys["a"] ? 1 : 0);
    driveTank(t, throttle, steer, dt);
    if (!t.turretGone) {
      const dx = aimPoint.x - t.group.position.x, dz = aimPoint.z - t.group.position.z;
      if (dx * dx + dz * dz > 0.5) { const worldYaw = Math.atan2(dx, dz), rel = worldYaw - t.yaw, step = shortAngle(t.turretYaw, rel), max = deg(240) * dt;
        t.turretYaw += clamp(step, -max, max); t.turret.rotation.y = t.turretYaw; }
    }
  }
  // Desired driving heading: head for the target, but route to a bridge when a
  // river is in the way and steer around solid obstacles we can't drive over.
  function navHeading(t, targetPos) {
    const pos = t.group.position;
    const dir = new THREE.Vector3(targetPos.x - pos.x, 0, targetPos.z - pos.z);
    if (dir.lengthSq() > 0) dir.normalize();

    if (river) {
      const mid = (river.z0 + river.z1) / 2;
      const nearSide = pos.z < mid, targetSide = targetPos.z < mid;
      if (nearSide !== targetSide) {                       // must cross the river
        let b = null, bd = Infinity;
        for (const br of bridges) { const d = Math.abs(br.x - pos.x); if (d < bd) { bd = d; b = br; } }
        if (b) {
          if (Math.abs(pos.x - b.x) > b.halfW - 1.2) dir.set(b.x - pos.x, 0, mid - pos.z); // line up with the bridge
          else dir.set((b.x - pos.x) * 0.25, 0, nearSide ? 1 : -1);                        // drive straight across
          if (dir.lengthSq() > 0) dir.normalize();
        }
      }
    }

    // repel from solid obstacles the tank cannot simply topple
    for (const o of obstacles) {
      if (o.destroyed || o.radius <= 0 || !o.solid || crushableBy(o, t)) continue;
      const ax = pos.x - o.pos.x, az = pos.z - o.pos.z, d = Math.hypot(ax, az);
      const range = o.radius + t.radius + 8;
      if (d < range && d > 0.1) { const w = (range - d) / range * 5 / d; dir.x += ax * w; dir.z += az * w; }
    }
    if (dir.lengthSq() > 0) dir.normalize();
    return Math.atan2(dir.x, dir.z);
  }

  function updateAITank(t, dt) {
    if (!t.alive) return; if (t.cooldown > 0) t.cooldown -= dt;
    const { target, dist } = nearestEnemyEntity(t.group.position, t.team, 220);
    if (!target) { driveTank(t, 0, 0, dt); return; }
    const dx = target.group.position.x - t.group.position.x, dz = target.group.position.z - t.group.position.z;
    const aimYaw = Math.atan2(dx, dz);                     // turret tracks the target directly
    const navYaw = navHeading(t, target.group.position);  // hull follows the navigated route
    const step = shortAngle(t.yaw, navYaw), steer = clamp(-step * 2, -1, 1);
    let throttle = 1;
    if (dist < 20) throttle = -1;
    else if (dist < 32 && Math.abs(step) < deg(35)) throttle = 0.35; // ease off in range, but keep maneuvering
    driveTank(t, throttle, steer, dt);
    if (!t.turretGone) { const rel = aimYaw - t.yaw, s = shortAngle(t.turretYaw, rel);
      t.turretYaw += clamp(s, -deg(140) * dt, deg(140) * dt); t.turret.rotation.y = t.turretYaw;
      if (t.cooldown <= 0 && dist < 85 && Math.abs(shortAngle(t.yaw + t.turretYaw, aimYaw)) < deg(8)) fireTank(t); }
  }

  // ===========================================================================
  // HUD
  // ===========================================================================
  const elStatus = document.getElementById("status"), elFill = document.getElementById("hpfill"), elBanner = document.getElementById("banner");
  let gameOver = false;
  const hud = document.getElementById("hud");
  const elReload = document.createElement("div"); elReload.style.cssText = "position:absolute;top:210px;left:18px;width:240px;height:10px;border:1px solid rgba(255,255,255,.3);border-radius:3px;overflow:hidden;background:rgba(0,0,0,.35)";
  const elReloadFill = document.createElement("div"); elReloadFill.style.cssText = "height:100%;width:0%;background:linear-gradient(90deg,#e0a12a,#ffe08a)";
  const elReloadLabel = document.createElement("div"); elReloadLabel.style.cssText = "position:absolute;top:224px;left:18px;font-size:11px;letter-spacing:1px;opacity:.85";
  elReload.appendChild(elReloadFill); hud.append(elReload, elReloadLabel);
  // track HUD nodes we created so dispose() can remove them
  const ownHudNodes = [elReload, elReloadLabel];

  function updateHUD() {
    if (!controlled) { elStatus.textContent = `ALLIES ${alliesLeft}   ENEMIES ${enemiesLeft}`; elFill.style.width = "0%"; return; }
    const t = controlled, pct = Math.max(0, Math.round(100 * t.health / t.maxHealth)), flags = [];
    if (t.leftTrackBroken) flags.push("L-TRK"); if (t.rightTrackBroken) flags.push("R-TRK"); if (t.turretGone) flags.push("NO GUN");
    elStatus.textContent = `${t.name}  ${pct}%   ALLIES ${alliesLeft}   ENEMIES ${enemiesLeft}` + (flags.length ? "  [" + flags.join(" ") + "]" : "");
    elFill.style.width = pct + "%";
    elFill.style.background = pct <= 30 ? "linear-gradient(90deg,#e0574a,#ff8a6a)" : "linear-gradient(90deg,#7ac74f,#b6e36a)";
  }
  function updateReloadHud() {
    const t = controlled;
    if (!t || !t.alive || t.turretGone) { elReloadFill.style.width = "0%"; elReloadLabel.textContent = t && t.turretGone ? "GUN DISABLED" : ""; return; }
    if (t.cooldown > 0) { const p = clamp(1 - t.cooldown / t.reload, 0, 1); elReloadFill.style.width = (p * 100) + "%";
      elReloadFill.style.background = p > 0.85 ? "linear-gradient(90deg,#5fbf4f,#8ef08a)" : "linear-gradient(90deg,#e0a12a,#ffe08a)"; elReloadLabel.textContent = `RELOADING ${t.cooldown.toFixed(1)}s`; }
    else { elReloadFill.style.width = "100%"; elReloadFill.style.background = "linear-gradient(90deg,#5fbf4f,#8ef08a)"; elReloadLabel.textContent = "GUN READY"; }
  }
  let hudFlash = 0; function flashHud() { hudFlash = 0.25; }
  let bannerTimer = 0;
  function banner(title, secs, win, sub) {
    if (secs === 0) { if (gameOver) return; gameOver = true; elBanner.innerHTML = `${title}<small>${sub || ""} — refresh to replay</small>`; elBanner.style.color = win ? "#8ef08a" : "#ff8a6a"; elBanner.style.opacity = 1; return; }
    elBanner.innerHTML = `<span style="font-size:26px">${title}</span>`; elBanner.style.color = "#ffe08a"; elBanner.style.opacity = 1; bannerTimer = secs;
  }
  updateHUD();

  // ===========================================================================
  // Main loop
  // ===========================================================================
  addEventListener("resize", () => renderer.setSize(window.innerWidth, window.innerHeight), { signal: sig });
  let last = 0;
  function frame(now) {
    if (disposed) return;
    rafId = requestAnimationFrame(frame);
    const t = now || 0; const dt = Math.min((t - last) / 1000 || 0.016, 0.05); last = t; _t0 = t / 1000;
    if (paused) { renderer.render(scene, camera); return; }
    updateAim();
    updateControlled(dt);
    for (const tk of tanks) if (tk !== controlled) updateAITank(tk, dt);
    updateCrew(dt);
    updateProjectiles(dt); updateGrenades(dt); updateFx(dt); updateDebris(dt); updatePrecip(dt);
    for (const tk of tanks) updateTankBars(tk);
    updateReloadHud(); updateHUD(); updateCamera(dt);
    if (bannerTimer > 0 && !gameOver) { bannerTimer -= dt; if (bannerTimer <= 0) elBanner.style.opacity = 0; }
    if (hudFlash > 0) { hudFlash -= dt; app.style.filter = `brightness(${1 + hudFlash * 2})`; } else app.style.filter = "";
    renderer.render(scene, camera);
  }
  rafId = requestAnimationFrame(frame);

  // ---- lifecycle handle ---------------------------------------------------
  function dispose() {
    if (disposed) return;
    disposed = true;
    ac.abort();
    cancelAnimationFrame(rafId);
    for (const n of ownHudNodes) n.remove();
    app.style.filter = "";
    scene.traverse((o) => { if (o.geometry) o.geometry.dispose?.(); });
    renderer.dispose();
    if (renderer.forceContextLoss) renderer.forceContextLoss();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  const handle = {
    dispose,
    pause() { paused = true; return true; },
    resume() { paused = false; last = 0; return false; },
    togglePause() { paused = !paused; if (!paused) last = 0; return paused; },
    // smoke-test surface
    tanks, crews, obstacles, projectiles, grenades, debris, bridges,
    get controlled() { return controlled; }, get enemiesLeft() { return enemiesLeft; }, get alliesLeft() { return alliesLeft; },
    get gameOver() { return gameOver; }, get paused() { return paused; }, cycleControl,
    get camFocus() { return cam.focus.clone(); }, FIELD,
    killEnemy() { const e = enemyTanks.find((t) => t.alive); if (e) disableTank(e); },
  };
  window.__game = handle;
  return handle;
}
