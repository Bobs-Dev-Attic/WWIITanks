// WWII Tanks — isometric tank combat, Three.js web build.
//
// A faithful web port of the Defold MVP in this repo: low-poly American vs
// German tanks, an orbit/zoom/pan isometric camera, mouse-aimed turret,
// arcade vehicle physics, shells, and explosions. Pure static ES module —
// no build step, so Vercel serves it directly.

import * as THREE from "three";

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------
const app = document.getElementById("app");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fb7d6);
scene.fog = new THREE.Fog(0x8fb7d6, 120, 320);

// Isometric orthographic camera, driven by the controller below.
const camera = new THREE.OrthographicCamera(-30, 30, 18, -18, 0.1, 1000);
camera.up.set(0, 1, 0);

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a5238, 0.9));
const sun = new THREE.DirectionalLight(0xfff2d6, 1.05);
sun.position.set(60, 90, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -120; sc.right = 120; sc.top = 120; sc.bottom = -120;
sc.near = 1; sc.far = 400;
scene.add(sun);
scene.add(sun.target);

// ---------------------------------------------------------------------------
// Battlefield
// ---------------------------------------------------------------------------
const BOUND = 95;
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: 0x56682f, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// subtle grid for scale / motion reference
const grid = new THREE.GridHelper(400, 80, 0x3c4a22, 0x44502a);
grid.position.y = 0.02;
grid.material.opacity = 0.35;
grid.material.transparent = true;
scene.add(grid);

// scattered cover blocks
function addCover(x, z, w, h, d) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: 0x6c5a3c, roughness: 1 })
  );
  m.position.set(x, h / 2, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
}
addCover(-32, 5, 6, 3, 6);
addCover(30, 18, 8, 3, 4);
addCover(4, 28, 5, 4, 5);
addCover(-18, -12, 4, 3, 9);

// ---------------------------------------------------------------------------
// Tank construction (low-poly boxes)
// ---------------------------------------------------------------------------
function box(w, h, d, color, rough = 0.85) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.1 })
  );
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Returns { group, turret } — turret is a child group that yaws independently.
function buildTank(bodyColor, opts = {}) {
  const track = 0x262626;
  const group = new THREE.Group();

  const lower = box(2.0, 0.5, 3.0, bodyColor);   lower.position.y = 0.4;  group.add(lower);
  const upper = box(1.55, 0.34, 2.3, bodyColor); upper.position.set(0, 0.78, 0.15); group.add(upper);
  const glacis = box(1.2, 0.28, 0.6, bodyColor); glacis.position.set(0, 0.85, 1.35); glacis.rotation.x = -0.5; group.add(glacis);
  const lt = box(0.42, 0.64, 3.25, track); lt.position.set(-1.02, 0.32, 0); group.add(lt);
  const rt = box(0.42, 0.64, 3.25, track); rt.position.set(1.02, 0.32, 0); group.add(rt);

  const turret = new THREE.Group();
  turret.position.set(0, 1.0, 0);
  const tw = opts.big ? 1.55 : 1.35;
  const body = box(tw, opts.big ? 0.58 : 0.55, opts.big ? 1.55 : 1.45, bodyColor);
  body.position.y = 0.28; turret.add(body);
  const barrelLen = opts.big ? 2.3 : 2.0;
  const barrel = box(opts.big ? 0.26 : 0.2, opts.big ? 0.26 : 0.2, barrelLen, 0x33352f);
  barrel.position.set(0, 0.3, barrelLen / 2 + 0.5); turret.add(barrel);
  const cupola = box(0.36, 0.22, 0.36, bodyColor); cupola.position.set(0, 0.6, -0.4); turret.add(cupola);
  group.add(turret);

  group.userData.barrelTip = barrelLen + 0.9; // z distance from turret pivot to muzzle
  return { group, turret };
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
const US_COLOR = 0x4a5834;
const DE_COLOR = 0x606468;

const tanks = []; // all living tanks (player + enemies)

function makeTank(team, color, x, z, opts) {
  const built = buildTank(color, opts);
  built.group.position.set(x, 0, z);
  scene.add(built.group);
  const t = {
    team, group: built.group, turret: built.turret,
    yaw: 0, turretYaw: 0, speed: 0, health: opts && opts.health || 100,
    maxHealth: opts && opts.health || 100, radius: 1.8, cooldown: 0,
    barrelTip: built.group.userData.barrelTip, alive: true,
  };
  tanks.push(t);
  return t;
}

const player = makeTank("allies", US_COLOR, 0, -32, { health: 100 });

const enemySpecs = [
  [-18, 24], [20, 30], [-6, 42], [15, 46],
];
const enemies = enemySpecs.map(([x, z]) => makeTank("germans", DE_COLOR, x, z, { big: true, health: 70 }));
let enemiesLeft = enemies.length;

// ---------------------------------------------------------------------------
// Projectiles + explosions
// ---------------------------------------------------------------------------
const shellGeo = new THREE.SphereGeometry(0.22, 8, 8);
const shellMat = new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0x5a3d00, roughness: 0.5 });
const shells = [];

function fireShell(from, dir, team) {
  const mesh = new THREE.Mesh(shellGeo, shellMat);
  mesh.position.copy(from);
  scene.add(mesh);
  shells.push({ mesh, dir: dir.clone().normalize(), team, life: 2.5 });
}

const particles = [];
function explode(pos, big = false) {
  const n = big ? 26 : 16;
  const geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
  for (let i = 0; i < n; i++) {
    const hot = Math.random() < 0.5;
    const mat = new THREE.MeshStandardMaterial({
      color: hot ? 0xff7a1a : 0x3a3a3a,
      emissive: hot ? 0xff5500 : 0x000000,
      emissiveIntensity: hot ? 1.4 : 0,
      roughness: 1,
    });
    const p = new THREE.Mesh(geo, mat);
    p.position.copy(pos);
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.2, Math.random() - 0.5)
      .normalize().multiplyScalar((big ? 12 : 8) * (0.5 + Math.random()));
    scene.add(p);
    particles.push({ mesh: p, v, life: 0.6 + Math.random() * 0.4, spin: (Math.random() - 0.5) * 10 });
  }
  // flash
  const flash = new THREE.PointLight(0xffa040, big ? 14 : 9, big ? 30 : 22, 2);
  flash.position.copy(pos).add(new THREE.Vector3(0, 1.5, 0));
  scene.add(flash);
  particles.push({ light: flash, life: 0.18, v: new THREE.Vector3(), spin: 0 });
}

// ---------------------------------------------------------------------------
// Camera controller (orbit / pan / zoom, follows the player)
// ---------------------------------------------------------------------------
const cam = {
  azimuth: Math.PI / 4,
  pitch: THREE.MathUtils.degToRad(35.264),
  distance: 160,
  size: 40,
  focus: new THREE.Vector3(0, 0, -20),
  pan: new THREE.Vector3(0, 0, 0),
  shake: 0,
};
const MIN_SIZE = 10, MAX_SIZE = 70;

function updateCamera(dt) {
  // keyboard pan relative to azimuth
  const kx = (keys["arrowright"] ? 1 : 0) - (keys["arrowleft"] ? 1 : 0);
  const kz = (keys["arrowup"] ? 1 : 0) - (keys["arrowdown"] ? 1 : 0);
  if (kx || kz) {
    const right = new THREE.Vector3(Math.cos(cam.azimuth), 0, -Math.sin(cam.azimuth));
    const fwd = new THREE.Vector3(Math.sin(cam.azimuth), 0, Math.cos(cam.azimuth));
    cam.pan.add(right.multiplyScalar(kx * 40 * dt)).add(fwd.multiplyScalar(kz * 40 * dt));
  }

  const targetFocus = player.alive
    ? player.group.position.clone().add(cam.pan)
    : cam.focus.clone();
  cam.focus.lerp(targetFocus, 1 - Math.pow(0.001, dt));

  const dir = new THREE.Vector3(
    Math.cos(cam.pitch) * Math.sin(cam.azimuth),
    Math.sin(cam.pitch),
    Math.cos(cam.pitch) * Math.cos(cam.azimuth)
  );
  const eye = cam.focus.clone().add(dir.multiplyScalar(cam.distance));

  if (cam.shake > 0.001) {
    cam.shake *= Math.pow(0.02, dt);
    eye.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(cam.shake));
  }

  camera.position.copy(eye);
  camera.lookAt(cam.focus);

  const aspect = window.innerWidth / window.innerHeight;
  camera.left = -cam.size * aspect;
  camera.right = cam.size * aspect;
  camera.top = cam.size;
  camera.bottom = -cam.size;
  camera.near = 0.1;
  camera.far = 1000;
  camera.updateProjectionMatrix();

  // keep the sun shadow frustum centered on the action
  sun.target.position.copy(cam.focus);
  sun.position.copy(cam.focus).add(new THREE.Vector3(60, 90, 40));
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = {};
addEventListener("keydown", (e) => { keys[e.key.toLowerCase()] = true; if (e.key === " ") { e.preventDefault(); tryFirePlayer(); } });
addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

let orbiting = false, panning = false;
const mouseNDC = new THREE.Vector2(0, 0);
const aimPoint = new THREE.Vector3(0, 0, -30);
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
    cam.pitch = THREE.MathUtils.clamp(cam.pitch - e.movementY * 0.006, THREE.MathUtils.degToRad(12), THREE.MathUtils.degToRad(82));
  }
  if (panning) {
    const right = new THREE.Vector3(Math.cos(cam.azimuth), 0, -Math.sin(cam.azimuth));
    const fwd = new THREE.Vector3(Math.sin(cam.azimuth), 0, Math.cos(cam.azimuth));
    const k = cam.size * 0.006;
    cam.pan.add(right.multiplyScalar(-e.movementX * k)).add(fwd.multiplyScalar(-e.movementY * k));
  }
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  cam.size = THREE.MathUtils.clamp(cam.size * (e.deltaY > 0 ? 1.1 : 1 / 1.1), MIN_SIZE, MAX_SIZE);
}, { passive: false });

function updateAim() {
  raycaster.setFromCamera(mouseNDC, camera);
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, hit)) aimPoint.copy(hit);
}

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------
function muzzle(t) {
  const dir = new THREE.Vector3(Math.sin(t.yaw + t.turretYaw), 0, Math.cos(t.yaw + t.turretYaw));
  const from = t.group.position.clone().add(new THREE.Vector3(0, 1.35, 0)).add(dir.clone().multiplyScalar(3.6));
  return { dir, from };
}
function tryFirePlayer() {
  if (!player.alive || player.cooldown > 0 || gameOver) return;
  player.cooldown = 0.9;
  const { dir, from } = muzzle(player);
  fireShell(from, dir, "allies");
  player.speed -= 3; // recoil
  cam.shake = Math.min(1.6, cam.shake + 0.5);
}

// ---------------------------------------------------------------------------
// Physics / update
// ---------------------------------------------------------------------------
function shortAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function updatePlayer(dt) {
  if (!player.alive) return;
  if (player.cooldown > 0) player.cooldown -= dt;

  const throttle = (keys["w"] ? 1 : 0) - (keys["s"] ? 1 : 0);
  const steer = (keys["d"] ? 1 : 0) - (keys["a"] ? 1 : 0);

  if (throttle > 0) player.speed += 14 * dt;
  else if (throttle < 0) player.speed -= 20 * dt;
  else player.speed -= Math.sign(player.speed) * Math.min(Math.abs(player.speed), 7 * dt);
  player.speed = THREE.MathUtils.clamp(player.speed, -5, 12);

  if (steer) {
    const grip = 0.4 + 0.6 * Math.min(1, Math.abs(player.speed) / 12);
    player.yaw -= steer * THREE.MathUtils.degToRad(75) * grip * dt;
  }
  player.group.rotation.y = player.yaw;

  const fwd = new THREE.Vector3(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  const p = player.group.position.clone().add(fwd.multiplyScalar(player.speed * dt));
  p.x = THREE.MathUtils.clamp(p.x, -BOUND, BOUND);
  p.z = THREE.MathUtils.clamp(p.z, -BOUND, BOUND);
  player.group.position.copy(p);

  // turret tracks the mouse aim point (world yaw), stored relative to hull
  const dx = aimPoint.x - player.group.position.x;
  const dz = aimPoint.z - player.group.position.z;
  if (dx * dx + dz * dz > 0.5) {
    const worldYaw = Math.atan2(dx, dz);
    const rel = worldYaw - player.yaw;
    const step = shortAngle(player.turretYaw, rel);
    const max = THREE.MathUtils.degToRad(240) * dt;
    player.turretYaw += THREE.MathUtils.clamp(step, -max, max);
    player.turret.rotation.y = player.turretYaw;
  }
}

function updateEnemies(dt) {
  for (const e of enemies) {
    if (!e.alive) continue;
    if (e.cooldown > 0) e.cooldown -= dt;
    if (!player.alive) { e.speed = Math.max(0, e.speed - 8 * dt); continue; }

    const dx = player.group.position.x - e.group.position.x;
    const dz = player.group.position.z - e.group.position.z;
    const dist = Math.hypot(dx, dz);
    const want = Math.atan2(dx, dz);
    const step = shortAngle(e.yaw, want);
    e.yaw += THREE.MathUtils.clamp(step, -THREE.MathUtils.degToRad(55) * dt, THREE.MathUtils.degToRad(55) * dt);
    e.group.rotation.y = e.yaw;

    if (dist > 32 && dist < 95) e.speed = Math.min(6, e.speed + 8 * dt);
    else e.speed = Math.max(0, e.speed - 8 * dt);

    const fwd = new THREE.Vector3(Math.sin(e.yaw), 0, Math.cos(e.yaw));
    const p = e.group.position.clone().add(fwd.multiplyScalar(e.speed * dt));
    p.x = THREE.MathUtils.clamp(p.x, -BOUND, BOUND);
    p.z = THREE.MathUtils.clamp(p.z, -BOUND, BOUND);
    e.group.position.copy(p);

    if (e.cooldown <= 0 && dist < 62 && Math.abs(step) < THREE.MathUtils.degToRad(12)) {
      e.cooldown = 1.8 + Math.random() * 0.6;
      const { dir, from } = muzzle(e);
      fireShell(from, dir, "germans");
    }
  }
}

function damage(t, amount) {
  if (!t.alive) return;
  t.health -= amount;
  if (t.health <= 0) {
    t.alive = false;
    explode(t.group.position.clone().add(new THREE.Vector3(0, 1, 0)), true);
    scene.remove(t.group);
    if (t.team === "allies") { setBanner("KNOCKED OUT", "Your tank was destroyed", false); gameOver = true; }
    else {
      enemiesLeft--;
      if (enemiesLeft <= 0 && !gameOver) { setBanner("VICTORY", "All enemy tanks destroyed", true); gameOver = true; }
    }
  }
  updateHUD();
}

function updateShells(dt) {
  for (let i = shells.length - 1; i >= 0; i--) {
    const s = shells[i];
    s.life -= dt;
    s.mesh.position.add(s.dir.clone().multiplyScalar(75 * dt));
    let hit = null;
    for (const t of tanks) {
      if (!t.alive || t.team === s.team) continue;
      if (s.mesh.position.distanceTo(t.group.position.clone().setY(1)) < t.radius + 0.6) { hit = t; break; }
    }
    if (hit) {
      damage(hit, 34);
      explode(s.mesh.position.clone());
      scene.remove(s.mesh); shells.splice(i, 1); continue;
    }
    if (s.life <= 0 || s.mesh.position.y < 0 || Math.abs(s.mesh.position.x) > 110 || Math.abs(s.mesh.position.z) > 110) {
      explode(s.mesh.position.clone());
      scene.remove(s.mesh); shells.splice(i, 1);
    }
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.mesh) {
      p.v.y -= 22 * dt;
      p.mesh.position.add(p.v.clone().multiplyScalar(dt));
      if (p.mesh.position.y < 0.1) { p.mesh.position.y = 0.1; p.v.y = 0; p.v.multiplyScalar(0.6); }
      p.mesh.rotation.x += p.spin * dt; p.mesh.rotation.y += p.spin * dt;
      p.mesh.scale.setScalar(Math.max(0.01, p.life * 1.5));
    }
    if (p.light) p.light.intensity *= Math.pow(0.001, dt);
    if (p.life <= 0) {
      if (p.mesh) scene.remove(p.mesh);
      if (p.light) scene.remove(p.light);
      particles.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const elStatus = document.getElementById("status");
const elFill = document.getElementById("hpfill");
const elBanner = document.getElementById("banner");
let gameOver = false;

function updateHUD() {
  const pct = Math.max(0, Math.round(100 * player.health / player.maxHealth));
  elStatus.textContent = `HULL ${pct}%   ENEMIES ${enemiesLeft}`;
  elFill.style.width = pct + "%";
  elFill.style.background = pct <= 30
    ? "linear-gradient(90deg,#e0574a,#ff8a6a)"
    : "linear-gradient(90deg,#7ac74f,#b6e36a)";
}
function setBanner(title, sub, win) {
  elBanner.innerHTML = `${title}<small>${sub} — refresh to replay</small>`;
  elBanner.style.color = win ? "#8ef08a" : "#ff8a6a";
  elBanner.style.opacity = 1;
}
updateHUD();

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  updateAim();
  updatePlayer(dt);
  updateEnemies(dt);
  updateShells(dt);
  updateParticles(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();

// expose a tiny bit for debugging / smoke tests
window.__game = { tanks, shells, get gameOver() { return gameOver; } };
