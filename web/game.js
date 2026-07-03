// WWII Tanks — isometric tank combat, Three.js web build.
//
// Low-poly American (+ allies) vs German tanks on a destructible battlefield.
// Systems: orbit/zoom/pan camera, mouse-aimed turret, arcade vehicle physics,
// location-based tank damage (track breaks, turret blow-off, parts falling
// off), destructible trees/rocks/crates with pass-through shells and flying
// debris that sinks into the ground over ~30s, reload indicators, and crews
// that bail out of disabled tanks to shoot and throw grenades.
//
// Pure static ES module — no build step, so Vercel serves it directly.

import * as THREE from "three";

// ===========================================================================
// Renderer / scene / camera / lights
// ===========================================================================
const app = document.getElementById("app");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb7d6);
scene.fog = new THREE.Fog(0x8fb7d6, 140, 340);

const camera = new THREE.OrthographicCamera(-30, 30, 18, -18, 0.1, 1000);
camera.up.set(0, 1, 0);

scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a5238, 0.9));
const sun = new THREE.DirectionalLight(0xfff2d6, 1.05);
sun.position.set(60, 90, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
{
  const sc = sun.shadow.camera;
  sc.left = -120; sc.right = 120; sc.top = 120; sc.bottom = -120;
  sc.near = 1; sc.far = 400;
}
scene.add(sun, sun.target);

const BOUND = 95;
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: 0x56682f, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(400, 80, 0x3c4a22, 0x44502a);
grid.position.y = 0.02;
grid.material.opacity = 0.3;
grid.material.transparent = true;
scene.add(grid);

// ===========================================================================
// Small helpers
// ===========================================================================
const TEAM = { ALLIES: "allies", GERMANS: "germans" };
const opposing = (t) => (t === TEAM.ALLIES ? TEAM.GERMANS : TEAM.ALLIES);
const clamp = THREE.MathUtils.clamp;
const deg = THREE.MathUtils.degToRad;
const rand = (a, b) => a + Math.random() * (b - a);

function shortAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function box(w, h, d, color, rough = 0.85) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.08 })
  );
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Entity registries
const tanks = [];
const obstacles = [];
const projectiles = [];
const grenades = [];
const crews = [];
const debris = [];
const fx = []; // sparks + flashes

// ===========================================================================
// Debris system  (flies, lands, rests, then sinks into the ground + fades)
// ===========================================================================
const DEBRIS_LIFE = 30;      // total seconds on the field
const SINK_TIME = 5;         // final seconds spent sinking + fading
const MAX_DEBRIS = 520;

function addDebris(mesh, vel, opts = {}) {
  if (debris.length >= MAX_DEBRIS) {
    const old = debris.shift();
    scene.remove(old.mesh);
  }
  mesh.castShadow = true;
  debris.push({
    mesh,
    v: vel || new THREE.Vector3(),
    spin: new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)),
    life: opts.life || DEBRIS_LIFE,
    rest: false,
    restY: opts.restY != null ? opts.restY : 0.06,
  });
}

// spawn a burst of small chips at a point (colour depends on material hit)
function spawnChips(pos, color, count = 8, power = 6) {
  const geo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1 }));
    m.position.copy(pos);
    m.scale.setScalar(rand(0.5, 1.4));
    const v = new THREE.Vector3(rand(-1, 1), rand(0.4, 1.3), rand(-1, 1))
      .normalize().multiplyScalar(power * rand(0.5, 1.2));
    scene.add(m);
    addDebris(m, v);
  }
}

function updateDebris(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.life -= dt;
    if (!d.rest) {
      d.v.y -= 24 * dt;
      d.mesh.position.addScaledVector(d.v, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      if (d.mesh.position.y <= d.restY) {
        d.mesh.position.y = d.restY;
        d.v.multiplyScalar(0.35);
        d.v.y = 0;
        if (d.v.lengthSq() < 0.4) { d.rest = true; d.v.set(0, 0, 0); }
        else d.v.y = 0;
      }
    }
    // sink + fade during the final SINK_TIME seconds
    if (d.life <= SINK_TIME) {
      const k = clamp(d.life / SINK_TIME, 0, 1); // 1 -> 0
      d.mesh.position.y = d.restY - (1 - k) * 1.2;
      const mats = Array.isArray(d.mesh.material) ? d.mesh.material : [d.mesh.material];
      for (const mat of mats) { mat.transparent = true; mat.opacity = k; }
    }
    if (d.life <= 0) {
      scene.remove(d.mesh);
      debris.splice(i, 1);
    }
  }
}

// Detach a mesh from a tank and turn it into physics debris (keeps world xform)
function detachAsDebris(mesh, extraVel, life) {
  const wp = new THREE.Vector3();
  mesh.getWorldPosition(wp);
  scene.attach(mesh); // preserves world transform
  const v = new THREE.Vector3(rand(-2, 2), rand(3, 7), rand(-2, 2));
  if (extraVel) v.add(extraVel);
  addDebris(mesh, v, { life: life || DEBRIS_LIFE, restY: 0.15 });
}

// ===========================================================================
// Explosions (sparks + flash) and area damage
// ===========================================================================
function explode(pos, big = false) {
  const n = big ? 24 : 14;
  const geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
  for (let i = 0; i < n; i++) {
    const hot = Math.random() < 0.55;
    const mat = new THREE.MeshStandardMaterial({
      color: hot ? 0xff7a1a : 0x2c2c2c,
      emissive: hot ? 0xff5500 : 0x000000,
      emissiveIntensity: hot ? 1.5 : 0,
      roughness: 1,
    });
    const p = new THREE.Mesh(geo, mat);
    p.position.copy(pos);
    const v = new THREE.Vector3(rand(-1, 1), rand(0.2, 1.1), rand(-1, 1))
      .normalize().multiplyScalar((big ? 12 : 8) * rand(0.5, 1.3));
    scene.add(p);
    fx.push({ mesh: p, v, life: rand(0.5, 1.0), spin: rand(-10, 10) });
  }
  const flash = new THREE.PointLight(0xffa040, big ? 16 : 9, big ? 34 : 22, 2);
  flash.position.copy(pos).add(new THREE.Vector3(0, 1.5, 0));
  scene.add(flash);
  fx.push({ light: flash, life: big ? 0.24 : 0.16 });
}

function updateFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const p = fx[i];
    p.life -= dt;
    if (p.mesh) {
      p.v.y -= 22 * dt;
      p.mesh.position.addScaledVector(p.v, dt);
      if (p.mesh.position.y < 0.1) { p.mesh.position.y = 0.1; p.v.set(p.v.x * 0.5, 0, p.v.z * 0.5); }
      p.mesh.rotation.x += p.spin * dt;
      p.mesh.scale.setScalar(Math.max(0.01, p.life * 1.5));
    }
    if (p.light) p.light.intensity *= Math.pow(0.0015, dt);
    if (p.life <= 0) {
      if (p.mesh) scene.remove(p.mesh);
      if (p.light) scene.remove(p.light);
      fx.splice(i, 1);
    }
  }
}

function areaDamage(pos, radius, amount, team) {
  for (const t of tanks) {
    if (!t.alive || t.team === team) continue;
    const d = t.group.position.distanceTo(pos);
    if (d < radius) hitTank(t, { type: "he", team }, pos.clone(), amount * (1 - d / radius));
  }
  for (const c of crews) {
    if (!c.alive || c.team === team) continue;
    const d = c.group.position.distanceTo(pos);
    if (d < radius) hurtCrew(c, amount * 1.5 * (1 - d / radius));
  }
}

// ===========================================================================
// Obstacles: trees, rocks, crates  (shells pass THROUGH but chip + destroy)
// ===========================================================================
function makeTree(x, z) {
  const g = new THREE.Group();
  const trunk = box(0.5, 2.2, 0.5, 0x5b4327); trunk.position.y = 1.1; g.add(trunk);
  const f1 = box(2.4, 1.6, 2.4, 0x2f5a2a); f1.position.y = 2.7; g.add(f1);
  const f2 = box(1.7, 1.4, 1.7, 0x376930); f2.position.y = 3.6; g.add(f2);
  g.position.set(x, 0, z);
  scene.add(g);
  return { group: g, pos: g.position, radius: 1.6, health: 55, maxHealth: 55,
           type: "tree", parts: { trunk, foliage: [f1, f2] }, destroyed: false, chip: 0x3a6b32 };
}

function makeRock(x, z) {
  const g = new THREE.Group();
  const s = rand(1.4, 2.4);
  const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0),
    new THREE.MeshStandardMaterial({ color: 0x808079, roughness: 1, flatShading: true }));
  r.castShadow = r.receiveShadow = true; r.position.y = s * 0.6; g.add(r);
  g.position.set(x, 0, z);
  g.rotation.y = rand(0, 6.28);
  scene.add(g);
  return { group: g, pos: g.position, radius: s * 0.9, health: 120, maxHealth: 120,
           type: "rock", parts: {}, destroyed: false, chip: 0x8a8a82 };
}

function makeCrate(x, z, w = 3, h = 3, d = 3) {
  const g = new THREE.Group();
  const c = box(w, h, d, 0x6c5a3c); c.position.y = h / 2; g.add(c);
  g.position.set(x, 0, z);
  scene.add(g);
  return { group: g, pos: g.position, radius: Math.max(w, d) * 0.6, health: 40, maxHealth: 40,
           type: "crate", parts: {}, destroyed: false, chip: 0x7a6540 };
}

function damageObstacle(o, amount, at) {
  if (o.destroyed) return;
  o.health -= amount;
  spawnChips(at.clone().setY(clamp(at.y, 0.4, 4)), o.chip, 6, 5);
  // shake
  o.group.position.x = o.pos.x + rand(-0.05, 0.05);
  if (o.health <= 0) destroyObstacle(o);
}

function destroyObstacle(o) {
  o.destroyed = true;
  if (o.type === "tree") {
    // foliage bursts into debris, trunk topples
    for (const f of o.parts.foliage) detachAsDebris(f, new THREE.Vector3(rand(-3, 3), rand(2, 5), rand(-3, 3)));
    const trunk = o.parts.trunk;
    detachAsDebris(trunk, new THREE.Vector3(rand(-2, 2), 1, rand(-2, 2)));
    spawnChips(o.pos.clone().setY(1.2), o.chip, 10, 6);
    o.radius = 0; // stump gone; no longer collides
  } else if (o.type === "rock") {
    spawnChips(o.pos.clone().setY(1), o.chip, 22, 8);
    scene.remove(o.group);
    o.radius = 0;
  } else { // crate -> planks
    for (let i = 0; i < 8; i++) {
      const plank = box(rand(0.4, 1.6), 0.2, rand(0.4, 1.4), o.chip);
      plank.position.copy(o.pos).add(new THREE.Vector3(rand(-1, 1), rand(0.5, 2), rand(-1, 1)));
      scene.add(plank);
      addDebris(plank, new THREE.Vector3(rand(-4, 4), rand(2, 6), rand(-4, 4)));
    }
    scene.remove(o.group);
    o.radius = 0;
  }
}

// push a moving circle (radius rr) out of solid obstacles
function resolveObstacles(pos, rr) {
  for (const o of obstacles) {
    if (o.destroyed || o.radius <= 0) continue;
    const dx = pos.x - o.pos.x, dz = pos.z - o.pos.z;
    const dist = Math.hypot(dx, dz);
    const min = o.radius + rr;
    if (dist < min && dist > 1e-3) {
      const push = (min - dist);
      pos.x += (dx / dist) * push;
      pos.z += (dz / dist) * push;
    }
  }
}

// scatter a battlefield of obstacles
(function seedObstacles() {
  const spots = [];
  const tries = 46;
  for (let i = 0; i < tries; i++) {
    const x = rand(-88, 88), z = rand(-88, 88);
    if (Math.abs(x) < 6 && z < -20 && z > -45) continue; // keep player spawn clear
    if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 9)) continue;
    spots.push({ x, z });
    const r = Math.random();
    if (r < 0.5) obstacles.push(makeTree(x, z));
    else if (r < 0.8) obstacles.push(makeRock(x, z));
    else obstacles.push(makeCrate(x, z, rand(2, 4), rand(2, 4), rand(2, 4)));
  }
})();

// ===========================================================================
// Tanks
// ===========================================================================
const US_COLOR = 0x4a5834;
const ALLY_COLOR = 0x556b2f;
const DE_COLOR = 0x606468;

function buildTank(bodyColor, big) {
  const track = 0x262626;
  const group = new THREE.Group();
  const parts = {};

  parts.lower = box(2.0, 0.5, 3.0, bodyColor); parts.lower.position.y = 0.4; group.add(parts.lower);
  parts.upper = box(1.55, 0.34, 2.3, bodyColor); parts.upper.position.set(0, 0.78, 0.15); group.add(parts.upper);
  parts.glacis = box(1.2, 0.28, 0.6, bodyColor); parts.glacis.position.set(0, 0.85, 1.35); parts.glacis.rotation.x = -0.5; group.add(parts.glacis);
  parts.leftTrack = box(0.42, 0.64, 3.25, track); parts.leftTrack.position.set(-1.02, 0.32, 0); group.add(parts.leftTrack);
  parts.rightTrack = box(0.42, 0.64, 3.25, track); parts.rightTrack.position.set(1.02, 0.32, 0); group.add(parts.rightTrack);
  parts.fender = box(2.2, 0.08, 3.1, bodyColor); parts.fender.position.set(0, 0.66, 0); group.add(parts.fender);

  const turret = new THREE.Group();
  turret.position.set(0, 1.0, 0);
  const tw = big ? 1.55 : 1.35;
  parts.turretBody = box(tw, big ? 0.58 : 0.55, big ? 1.55 : 1.45, bodyColor); parts.turretBody.position.y = 0.28; turret.add(parts.turretBody);
  const barrelLen = big ? 2.3 : 2.0;
  parts.barrel = box(big ? 0.26 : 0.2, big ? 0.26 : 0.2, barrelLen, 0x33352f); parts.barrel.position.set(0, 0.3, barrelLen / 2 + 0.5); turret.add(parts.barrel);
  parts.cupola = box(0.36, 0.22, 0.36, bodyColor); parts.cupola.position.set(0, 0.6, -0.4); turret.add(parts.cupola);
  group.add(turret);

  return { group, turret, parts, barrelTip: barrelLen + 0.9 };
}

// camera-facing status bars above each tank
function makeBar(color, y, width) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ color, depthTest: false, depthWrite: false }));
  s.center.set(0, 0.5);
  s.position.set(-width / 2, y, 0);
  s.scale.set(width, 0.22, 1);
  s.renderOrder = 999;
  return s;
}

function makeTank(team, color, x, z, opts = {}) {
  const built = buildTank(color, opts.big);
  built.group.position.set(x, 0, z);
  built.group.rotation.y = opts.yaw || 0;
  scene.add(built.group);

  const bars = new THREE.Group();
  bars.position.y = 3.3;
  const W = 2.2;
  const hpBg = makeBar(0x111111, 0, W);
  const hpFill = makeBar(0x7ac74f, 0, W);
  const rlBg = makeBar(0x111111, -0.32, W);
  const rlFill = makeBar(0xffd24a, -0.32, W);
  bars.add(hpBg, hpFill, rlBg, rlFill);
  built.group.add(bars);

  const t = {
    team, kind: opts.kind || "ai", group: built.group, turret: built.turret, parts: built.parts,
    yaw: opts.yaw || 0, turretYaw: 0, speed: 0,
    health: opts.health || 100, maxHealth: opts.health || 100, radius: 1.8,
    cooldown: 0, reload: opts.reload || 1.0, barrelTip: built.barrelTip,
    leftTrackBroken: false, rightTrackBroken: false, turretGone: false,
    alive: true, disabled: false, crewCount: opts.crew != null ? opts.crew : 3,
    hasGrenades: opts.grenades != null ? opts.grenades : Math.random() < 0.6,
    bars, hpFill, rlFill, rlBg, big: !!opts.big,
  };
  tanks.push(t);
  return t;
}

function updateTankBars(t) {
  // billboard handled automatically by Sprite; just resize fills + toggle reload
  const hp = clamp(t.health / t.maxHealth, 0, 1);
  t.hpFill.scale.x = 2.2 * hp;
  t.hpFill.material.color.setHex(hp <= 0.3 ? 0xe0574a : hp <= 0.6 ? 0xffd24a : 0x7ac74f);
  const reloading = t.cooldown > 0 && !t.turretGone;
  t.rlBg.visible = reloading;
  t.rlFill.visible = reloading;
  if (reloading) {
    const p = clamp(1 - t.cooldown / t.reload, 0, 1);
    t.rlFill.scale.x = 2.2 * p;
    t.rlFill.material.color.setHex(p > 0.85 ? 0x8ef08a : 0xffd24a);
  }
  t.bars.visible = t.alive && !t.disabled;
  t.bars.rotation.y = -t.group.rotation.y; // keep bars world-aligned as the hull turns
}

// ---------------------------------------------------------------------------
// Combatants
// ---------------------------------------------------------------------------
const player = makeTank(TEAM.ALLIES, US_COLOR, 0, -32, { kind: "player", health: 120, reload: 0.9, crew: 4, grenades: true });

const allies = [
  makeTank(TEAM.ALLIES, ALLY_COLOR, -12, -30, { health: 90, reload: 1.3, crew: 3 }),
  makeTank(TEAM.ALLIES, ALLY_COLOR, 12, -30, { health: 90, reload: 1.3, crew: 3 }),
];

const enemySpecs = [[-18, 26], [22, 32], [-6, 46], [16, 50], [0, 66]];
const enemies = enemySpecs.map(([x, z]) => makeTank(TEAM.GERMANS, DE_COLOR, x, z, { big: true, health: 80, reload: 1.6, yaw: Math.PI }));
let enemiesLeft = enemies.length;
let alliesLeft = allies.length + 1;

// ===========================================================================
// Crew (tankers): bail out of disabled tanks, flee, shoot, throw grenades
// ===========================================================================
function makeCrewFigure(color) {
  const g = new THREE.Group();
  const torso = box(0.5, 0.7, 0.35, color); torso.position.y = 1.0; g.add(torso);
  const head = box(0.32, 0.32, 0.32, 0xd8b98a); head.position.y = 1.55; g.add(head);
  const helmet = box(0.38, 0.16, 0.4, color); helmet.position.y = 1.72; g.add(helmet);
  const lleg = box(0.2, 0.6, 0.2, 0x2c2c2c); lleg.position.set(-0.14, 0.4, 0); g.add(lleg);
  const rleg = box(0.2, 0.6, 0.2, 0x2c2c2c); rleg.position.set(0.14, 0.4, 0); g.add(rleg);
  const rifle = box(0.08, 0.08, 0.9, 0x241c12); rifle.position.set(0.28, 1.05, 0.3); g.add(rifle);
  return { g, legs: [lleg, rleg] };
}

function spawnCrew(tank) {
  const n = tank.crewCount;
  const color = tank.team === TEAM.GERMANS ? 0x5a5c50 : 0x6b7040;
  for (let i = 0; i < n; i++) {
    const fig = makeCrewFigure(color);
    const off = new THREE.Vector3(rand(-1.5, 1.5), 0, rand(-1.5, 1.5));
    fig.g.position.copy(tank.group.position).add(off);
    fig.g.position.y = 0;
    scene.add(fig.g);
    crews.push({
      team: tank.team, group: fig.g, legs: fig.legs, yaw: 0,
      health: 24, alive: true, speed: rand(6.5, 9),
      weapon: (tank.hasGrenades && i === 0) ? "grenade" : "rifle",
      grenades: tank.hasGrenades && i === 0 ? 3 : 0,
      cooldown: rand(0.5, 1.5), bob: Math.random() * 6, panic: rand(0.6, 1.4),
    });
  }
}

function hurtCrew(c, amount) {
  if (!c.alive) return;
  c.health -= amount;
  spawnChips(c.group.position.clone().setY(1), 0x7a2b22, 4, 4);
  if (c.health <= 0) {
    c.alive = false;
    spawnChips(c.group.position.clone().setY(0.8), 0x5a5c50, 6, 4);
    scene.remove(c.group);
  }
}

function nearestEnemyEntity(pos, team, range = Infinity) {
  let best = null, bd = range;
  const scan = (arr) => {
    for (const e of arr) {
      if (!e.alive || e.team === team) continue;
      if (e.disabled) continue;
      const d = e.group.position.distanceTo(pos);
      if (d < bd) { bd = d; best = e; }
    }
  };
  scan(tanks); scan(crews);
  return { target: best, dist: bd };
}

function updateCrew(dt) {
  for (const c of crews) {
    if (!c.alive) continue;
    if (c.cooldown > 0) c.cooldown -= dt;

    const threat = nearestEnemyEntity(c.group.position, c.team, 120).target;
    // flee vector: away from nearest threat, biased toward the map edge behind them
    let dir;
    if (threat) {
      dir = c.group.position.clone().sub(threat.group.position).setY(0);
      if (dir.lengthSq() < 0.01) dir.set(rand(-1, 1), 0, rand(-1, 1));
      dir.normalize();
    } else {
      dir = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
    }
    const np = c.group.position.clone().addScaledVector(dir, c.speed * dt);
    np.x = clamp(np.x, -BOUND, BOUND); np.z = clamp(np.z, -BOUND, BOUND); np.y = 0;
    resolveObstacles(np, 0.5);
    c.group.position.copy(np);
    c.yaw = Math.atan2(dir.x, dir.z);
    c.group.rotation.y = c.yaw;

    // run cycle
    c.bob += dt * 12;
    c.legs[0].rotation.x = Math.sin(c.bob) * 0.7;
    c.legs[1].rotation.x = -Math.sin(c.bob) * 0.7;

    // fight back
    if (threat && c.cooldown <= 0) {
      const td = threat.group.position.distanceTo(c.group.position);
      if (c.weapon === "grenade" && c.grenades > 0 && td < 34 && td > 6) {
        c.grenades--;
        c.cooldown = 2.6;
        throwGrenade(c.group.position.clone().setY(1.4), threat.group.position.clone(), c.team);
        if (c.grenades === 0) c.weapon = "rifle";
      } else if (td < 46) {
        c.cooldown = rand(0.5, 1.1);
        const from = c.group.position.clone().setY(1.1);
        const aim = threat.group.position.clone().setY(1.0).sub(from).normalize();
        aim.x += rand(-0.05, 0.05); aim.z += rand(-0.05, 0.05);
        fireProjectile(from, aim.normalize(), c.team, "mg");
      }
    }
  }
}

// ===========================================================================
// Projectiles (ap shells, mg bullets) + grenades
// ===========================================================================
const shellGeo = new THREE.SphereGeometry(0.22, 8, 8);
const shellMat = new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0x5a3d00, roughness: 0.5 });
const mgGeo = new THREE.SphereGeometry(0.1, 6, 6);
const mgMat = new THREE.MeshStandardMaterial({ color: 0xfff2a0, emissive: new THREE.Color(0x665500), roughness: 0.4 });

const PROJ = {
  ap: { speed: 78, life: 2.5, geo: shellGeo, mat: shellMat, tankDmg: 40, crewDmg: 100, obsDmg: 55, big: true, tracer: 0xffb020 },
  mg: { speed: 62, life: 1.6, geo: mgGeo, mat: mgMat, tankDmg: 5, crewDmg: 22, obsDmg: 8, big: false, tracer: 0xfff0a0 },
};

function fireProjectile(from, dir, team, type) {
  const spec = PROJ[type];
  const mesh = new THREE.Mesh(spec.geo, spec.mat);
  mesh.position.copy(from);
  scene.add(mesh);
  projectiles.push({ mesh, dir: dir.clone().normalize(), team, type, life: spec.life, spec, hitObs: new Set() });
}

function fireProjectileTank(t) {
  if (t.turretGone || t.cooldown > 0 || !t.alive) return false;
  t.cooldown = t.reload;
  const yaw = t.yaw + t.turretYaw;
  const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const from = t.group.position.clone().add(new THREE.Vector3(0, 1.35, 0)).addScaledVector(dir, 3.6);
  fireProjectile(from, dir, t.team, "ap");
  t.speed -= 3; // recoil
  if (t === player) cam.shake = Math.min(1.6, cam.shake + 0.5);
  return true;
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const s = projectiles[i];
    s.life -= dt;
    s.mesh.position.addScaledVector(s.dir, s.spec.speed * dt);
    const p = s.mesh.position;
    let done = false;

    // pass THROUGH obstacles, chipping them
    for (const o of obstacles) {
      if (o.destroyed || o.radius <= 0 || s.hitObs.has(o)) continue;
      if (Math.hypot(p.x - o.pos.x, p.z - o.pos.z) < o.radius && p.y < 4.2) {
        s.hitObs.add(o);
        damageObstacle(o, s.spec.obsDmg, p.clone());
      }
    }
    // hit opposing tanks
    for (const t of tanks) {
      if (!t.alive || t.team === s.team) continue;
      if (p.distanceTo(t.group.position.clone().setY(1)) < t.radius + 0.5) {
        hitTank(t, s, p.clone());
        explode(p.clone(), s.spec.big);
        done = true; break;
      }
    }
    // hit opposing crew
    if (!done) {
      for (const c of crews) {
        if (!c.alive || c.team === s.team) continue;
        if (p.distanceTo(c.group.position.clone().setY(1)) < 0.7) {
          hurtCrew(c, s.spec.crewDmg);
          if (s.spec.big) explode(p.clone());
          done = true; break;
        }
      }
    }
    if (done || s.life <= 0 || p.y < 0 || Math.abs(p.x) > 110 || Math.abs(p.z) > 110) {
      if (!done && s.spec.big) explode(p.clone());
      scene.remove(s.mesh);
      projectiles.splice(i, 1);
    }
  }
}

// ---- grenades (lobbed, arc, area explosion) --------------------------------
const grenadeGeo = new THREE.SphereGeometry(0.18, 8, 8);
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x3b4022, roughness: 0.7 });

function throwGrenade(from, target, team) {
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
  mesh.position.copy(from);
  scene.add(mesh);
  const flat = target.clone().sub(from).setY(0);
  const dist = flat.length();
  const t = clamp(dist / 16, 0.7, 1.6); // time of flight
  const v = flat.multiplyScalar(1 / t);
  v.y = 0.5 * 24 * t; // counter gravity to land near target
  grenades.push({ mesh, v, team, fuse: t + 0.05 });
}

function updateGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.fuse -= dt;
    g.v.y -= 24 * dt;
    g.mesh.position.addScaledVector(g.v, dt);
    g.mesh.rotation.x += dt * 8;
    if (g.mesh.position.y <= 0.2 || g.fuse <= 0) {
      const pos = g.mesh.position.clone().setY(0.3);
      explode(pos, true);
      spawnChips(pos, 0x3b4022, 10, 7);
      areaDamage(pos, 6.5, 55, g.team);
      scene.remove(g.mesh);
      grenades.splice(i, 1);
    }
  }
}

// ===========================================================================
// Tank damage resolution (location-based: tracks, turret, parts)
// ===========================================================================
function hitTank(t, proj, hitPos, overrideDmg) {
  if (!t.alive) return;
  const spec = proj.spec || { tankDmg: overrideDmg || 30 };
  let dmg = overrideDmg != null ? overrideDmg : spec.tankDmg;

  // where did it hit, in the tank's local frame?
  const local = t.group.worldToLocal(hitPos.clone());
  const side = Math.abs(local.x) > 0.7;
  const high = local.y > 0.85;
  const heavy = proj.type === "ap" || proj.type === "he";

  if (proj.type === "mg") {
    // small arms mostly bounce off armour
    dmg *= 0.5;
    spawnChips(hitPos.clone(), 0xffe08a, 3, 3);
  }

  t.health -= dmg;

  // --- track hit: break a track, disabling movement that way ---------------
  if (heavy && side && local.y < 0.75 && !(local.x < 0 ? t.leftTrackBroken : t.rightTrackBroken)) {
    if (Math.random() < 0.7) {
      const left = local.x < 0;
      if (left) { t.leftTrackBroken = true; detachAsDebris(t.parts.leftTrack); }
      else { t.rightTrackBroken = true; detachAsDebris(t.parts.rightTrack); }
      spawnChips(hitPos.clone(), 0x222222, 8, 5);
    }
  }

  // --- turret hit: chance to blow the turret clean off ---------------------
  if (heavy && !t.turretGone && (high || t.health <= t.maxHealth * 0.35) && Math.random() < (high ? 0.5 : 0.25)) {
    blowTurret(t);
  }

  // --- glancing part loss --------------------------------------------------
  if (heavy && !high && Math.random() < 0.3 && t.parts.cupola.parent) {
    detachAsDebris(t.parts.cupola, new THREE.Vector3(rand(-2, 2), 4, rand(-2, 2)));
  }
  if (heavy && Math.random() < 0.25 && t.parts.fender && t.parts.fender.parent) {
    detachAsDebris(t.parts.fender, new THREE.Vector3(rand(-3, 3), 2, rand(-3, 3)));
  }

  if (t.health <= 0) disableTank(t);
  else if (t === player) flashHud();
}

function blowTurret(t) {
  if (t.turretGone) return;
  t.turretGone = true;
  const wp = new THREE.Vector3();
  t.turret.getWorldPosition(wp);
  detachAsDebris(t.turret, new THREE.Vector3(rand(-3, 3), rand(9, 14), rand(-3, 3)), DEBRIS_LIFE);
  explode(wp, true);
  if (t === player) cam.shake = Math.min(2, cam.shake + 1);
}

function disableTank(t) {
  if (t.disabled) return;
  t.disabled = true;
  t.alive = false;
  t.speed = 0;
  explode(t.group.position.clone().setY(1), true);
  // scorch the hull
  for (const key of ["lower", "upper", "glacis", "turretBody"]) {
    const m = t.parts[key];
    if (m && m.parent && m.material) { m.material.color.multiplyScalar(0.4); }
  }
  t.bars.visible = false;
  spawnCrew(t);

  if (t.team === TEAM.GERMANS) {
    enemiesLeft = Math.max(0, enemiesLeft - 1);
    if (enemiesLeft === 0 && !gameOver) setBanner("VICTORY", "All enemy tanks knocked out", true);
  } else {
    alliesLeft = Math.max(0, alliesLeft - 1);
    if (t === player) setBanner("KNOCKED OUT", "Your tank is disabled — crew bailing out", false);
  }
  updateHUD();
}

// ===========================================================================
// Camera controller (orbit / pan / zoom, follows player)
// ===========================================================================
const cam = {
  azimuth: Math.PI / 4, pitch: deg(35.264), distance: 160, size: 42,
  focus: new THREE.Vector3(0, 0, -18), pan: new THREE.Vector3(), shake: 0,
};
const MIN_SIZE = 12, MAX_SIZE = 75;

function updateCamera(dt) {
  const kx = (keys["arrowright"] ? 1 : 0) - (keys["arrowleft"] ? 1 : 0);
  const kz = (keys["arrowup"] ? 1 : 0) - (keys["arrowdown"] ? 1 : 0);
  if (kx || kz) {
    const right = new THREE.Vector3(Math.cos(cam.azimuth), 0, -Math.sin(cam.azimuth));
    const fwd = new THREE.Vector3(Math.sin(cam.azimuth), 0, Math.cos(cam.azimuth));
    cam.pan.addScaledVector(right, kx * 42 * dt).addScaledVector(fwd, kz * 42 * dt);
  }
  const follow = player.group.position.clone().add(cam.pan);
  cam.focus.lerp(follow, 1 - Math.pow(0.0015, dt));

  const dir = new THREE.Vector3(
    Math.cos(cam.pitch) * Math.sin(cam.azimuth),
    Math.sin(cam.pitch),
    Math.cos(cam.pitch) * Math.cos(cam.azimuth)
  );
  const eye = cam.focus.clone().addScaledVector(dir, cam.distance);
  if (cam.shake > 0.001) {
    cam.shake *= Math.pow(0.02, dt);
    eye.add(new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(cam.shake));
  }
  camera.position.copy(eye);
  camera.lookAt(cam.focus);

  const aspect = window.innerWidth / window.innerHeight;
  camera.left = -cam.size * aspect; camera.right = cam.size * aspect;
  camera.top = cam.size; camera.bottom = -cam.size;
  camera.near = 0.1; camera.far = 1000;
  camera.updateProjectionMatrix();

  sun.target.position.copy(cam.focus);
  sun.position.copy(cam.focus).add(new THREE.Vector3(60, 90, 40));
}

// ===========================================================================
// Input
// ===========================================================================
const keys = {};
addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === " ") { e.preventDefault(); tryFirePlayer(); }
});
addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

let orbiting = false, panning = false;
const mouseNDC = new THREE.Vector2(0, 0);
const aimPoint = new THREE.Vector3(0, 0, -10);
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();

const canvas = renderer.domElement;
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("mousedown", (e) => {
  if (e.button === 0) tryFirePlayer();
  else if (e.button === 2) orbiting = true;
  else if (e.button === 1) { panning = true; e.preventDefault(); }
});
addEventListener("mouseup", (e) => {
  if (e.button === 2) orbiting = false;
  if (e.button === 1) panning = false;
});
addEventListener("mousemove", (e) => {
  mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  if (orbiting) {
    cam.azimuth -= e.movementX * 0.006;
    cam.pitch = clamp(cam.pitch - e.movementY * 0.006, deg(12), deg(82));
  }
  if (panning) {
    const right = new THREE.Vector3(Math.cos(cam.azimuth), 0, -Math.sin(cam.azimuth));
    const fwd = new THREE.Vector3(Math.sin(cam.azimuth), 0, Math.cos(cam.azimuth));
    const k = cam.size * 0.006;
    cam.pan.addScaledVector(right, -e.movementX * k).addScaledVector(fwd, -e.movementY * k);
  }
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  cam.size = clamp(cam.size * (e.deltaY > 0 ? 1.1 : 1 / 1.1), MIN_SIZE, MAX_SIZE);
}, { passive: false });

function updateAim() {
  raycaster.setFromCamera(mouseNDC, camera);
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, hit)) aimPoint.copy(hit);
}

function tryFirePlayer() {
  if (!player.alive || gameOver) return;
  fireProjectileTank(player);
}

// ===========================================================================
// Movement / AI
// ===========================================================================
function driveTank(t, throttle, steer, dt) {
  // broken tracks change how the hull moves
  let maxFwd = t.big ? 10 : 12, maxRev = 5;
  if (t.leftTrackBroken && t.rightTrackBroken) { t.speed *= Math.pow(0.02, dt); throttle = 0; steer = 0; }
  else if (t.leftTrackBroken || t.rightTrackBroken) {
    maxFwd *= 0.5; maxRev *= 0.5;
    // the working track drags the hull around toward the dead side
    t.yaw += (t.leftTrackBroken ? 1 : -1) * deg(35) * (Math.abs(t.speed) / maxFwd + 0.2) * dt;
  }

  if (throttle > 0) t.speed += 14 * dt;
  else if (throttle < 0) t.speed -= 20 * dt;
  else t.speed -= Math.sign(t.speed) * Math.min(Math.abs(t.speed), 7 * dt);
  t.speed = clamp(t.speed, -maxRev, maxFwd);

  if (steer && !(t.leftTrackBroken && t.rightTrackBroken)) {
    const grip = 0.4 + 0.6 * Math.min(1, Math.abs(t.speed) / maxFwd);
    t.yaw -= steer * deg(75) * grip * dt;
  }
  t.group.rotation.y = t.yaw;

  const fwd = new THREE.Vector3(Math.sin(t.yaw), 0, Math.cos(t.yaw));
  const np = t.group.position.clone().addScaledVector(fwd, t.speed * dt);
  np.x = clamp(np.x, -BOUND, BOUND); np.z = clamp(np.z, -BOUND, BOUND); np.y = 0;
  resolveObstacles(np, t.radius);
  t.group.position.copy(np);
}

function updatePlayer(dt) {
  if (!player.alive) return;
  if (player.cooldown > 0) player.cooldown -= dt;
  const throttle = (keys["w"] ? 1 : 0) - (keys["s"] ? 1 : 0);
  const steer = (keys["d"] ? 1 : 0) - (keys["a"] ? 1 : 0);
  driveTank(player, throttle, steer, dt);

  if (!player.turretGone) {
    const dx = aimPoint.x - player.group.position.x;
    const dz = aimPoint.z - player.group.position.z;
    if (dx * dx + dz * dz > 0.5) {
      const worldYaw = Math.atan2(dx, dz);
      const rel = worldYaw - player.yaw;
      const step = shortAngle(player.turretYaw, rel);
      const max = deg(240) * dt;
      player.turretYaw += clamp(step, -max, max);
      player.turret.rotation.y = player.turretYaw;
    }
  }
}

function updateAITank(t, dt) {
  if (!t.alive) return;
  if (t.cooldown > 0) t.cooldown -= dt;

  const { target, dist } = nearestEnemyEntity(t.group.position, t.team, 200);
  if (!target) { driveTank(t, 0, 0, dt); return; }

  const dx = target.group.position.x - t.group.position.x;
  const dz = target.group.position.z - t.group.position.z;
  const want = Math.atan2(dx, dz);
  const step = shortAngle(t.yaw, want);
  const steer = clamp(-step * 2, -1, 1);

  let throttle = 0;
  if (dist > 34) throttle = 1;
  else if (dist < 22) throttle = -1;
  driveTank(t, throttle, steer, dt);

  // aim turret at target
  if (!t.turretGone) {
    const rel = want - t.yaw;
    const s = shortAngle(t.turretYaw, rel);
    t.turretYaw += clamp(s, -deg(140) * dt, deg(140) * dt);
    t.turret.rotation.y = t.turretYaw;
    if (t.cooldown <= 0 && dist < 80 && Math.abs(shortAngle(t.yaw + t.turretYaw, want)) < deg(8)) {
      fireProjectileTank(t);
    }
  }
}

// ===========================================================================
// HUD
// ===========================================================================
const elStatus = document.getElementById("status");
const elFill = document.getElementById("hpfill");
const elBanner = document.getElementById("banner");
let gameOver = false;

// reload readout in the HUD
const elReload = document.createElement("div");
elReload.id = "reload";
elReload.style.cssText =
  "position:absolute;top:176px;left:18px;width:240px;height:10px;border:1px solid rgba(255,255,255,.3);border-radius:3px;overflow:hidden;background:rgba(0,0,0,.35)";
const elReloadFill = document.createElement("div");
elReloadFill.style.cssText = "height:100%;width:0%;background:linear-gradient(90deg,#e0a12a,#ffe08a);transition:width .05s linear";
const elReloadLabel = document.createElement("div");
elReloadLabel.style.cssText = "position:absolute;top:190px;left:18px;font-size:11px;letter-spacing:1px;opacity:.85";
elReload.appendChild(elReloadFill);
document.getElementById("hud").append(elReload, elReloadLabel);

function updateHUD() {
  const pct = Math.max(0, Math.round(100 * player.health / player.maxHealth));
  const flags = [];
  if (player.leftTrackBroken) flags.push("L-TRACK");
  if (player.rightTrackBroken) flags.push("R-TRACK");
  if (player.turretGone) flags.push("NO GUN");
  elStatus.textContent = `HULL ${pct}%   ALLIES ${alliesLeft}   ENEMIES ${enemiesLeft}` + (flags.length ? "   [" + flags.join(" ") + "]" : "");
  elFill.style.width = pct + "%";
  elFill.style.background = pct <= 30 ? "linear-gradient(90deg,#e0574a,#ff8a6a)" : "linear-gradient(90deg,#7ac74f,#b6e36a)";
}
function updateReloadHud() {
  if (!player.alive || player.turretGone) { elReloadFill.style.width = "0%"; elReloadLabel.textContent = player.turretGone ? "GUN DISABLED" : ""; return; }
  if (player.cooldown > 0) {
    const p = clamp(1 - player.cooldown / player.reload, 0, 1);
    elReloadFill.style.width = (p * 100) + "%";
    elReloadFill.style.background = p > 0.85 ? "linear-gradient(90deg,#5fbf4f,#8ef08a)" : "linear-gradient(90deg,#e0a12a,#ffe08a)";
    elReloadLabel.textContent = `RELOADING ${(player.cooldown).toFixed(1)}s`;
  } else {
    elReloadFill.style.width = "100%";
    elReloadFill.style.background = "linear-gradient(90deg,#5fbf4f,#8ef08a)";
    elReloadLabel.textContent = "GUN READY";
  }
}
let hudFlash = 0;
function flashHud() { hudFlash = 0.25; }
function setBanner(title, sub, win) {
  if (gameOver) return;
  gameOver = true;
  elBanner.innerHTML = `${title}<small>${sub} — refresh to replay</small>`;
  elBanner.style.color = win ? "#8ef08a" : "#ff8a6a";
  elBanner.style.opacity = 1;
}
updateHUD();

// ===========================================================================
// Main loop
// ===========================================================================
addEventListener("resize", () => renderer.setSize(window.innerWidth, window.innerHeight));

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);

  updateAim();
  updatePlayer(dt);
  for (const t of tanks) if (t.kind === "ai") updateAITank(t, dt);
  updateCrew(dt);
  updateProjectiles(dt);
  updateGrenades(dt);
  updateFx(dt);
  updateDebris(dt);
  for (const t of tanks) updateTankBars(t);
  updateReloadHud();
  updateCamera(dt);

  if (hudFlash > 0) { hudFlash -= dt; app.style.filter = `brightness(${1 + hudFlash * 2})`; }
  else app.style.filter = "";

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();

// expose for smoke tests
window.__game = {
  tanks, crews, obstacles, projectiles, grenades, debris,
  get enemiesLeft() { return enemiesLeft; },
  get gameOver() { return gameOver; },
  killEnemy() { const e = enemies.find((t) => t.alive); if (e) disableTank(e); },
  hitPlayerTrack() { hitTank(player, { type: "ap", spec: PROJ.ap }, player.group.position.clone().add(new THREE.Vector3(1.1, 0.4, 0))); },
};
