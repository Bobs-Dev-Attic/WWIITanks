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

export const VERSION = "0.14.1";

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

// cls "tank" = turreted armour; "apc"/"jeep"/"moto" = soft MG-armed vehicles
export const TANK_TYPES = {
  allies: {
    stuart:    { name: "M5 Stuart (Light)",    health: 70,  reload: 0.8, maxFwd: 9,   big: false, color: 0x4a5834, dmg: 30, cls: "tank", turret: 40 },
    sherman:   { name: "M4 Sherman (Medium)",  health: 115, reload: 1.1, maxFwd: 7,   big: false, color: 0x556b2f, dmg: 42, cls: "tank", turret: 24 },
    pershing:  { name: "M26 Pershing (Heavy)", health: 175, reload: 1.7, maxFwd: 5.5, big: true,  color: 0x4d5a3a, dmg: 56, cls: "tank", turret: 18 },
    halftrack: { name: "M3 Half-track (APC)",  health: 60,  maxFwd: 10, color: 0x4a5834, cls: "apc",  crew: 6 },
    jeep:      { name: "Willys Jeep (.50 cal)",health: 26,  maxFwd: 14, color: 0x4a5834, cls: "jeep", crew: 2 },
    moto:      { name: "Motorcycle",           health: 15,  maxFwd: 16, color: 0x37372e, cls: "moto", crew: 1 },
  },
  germans: {
    panzer2:   { name: "Panzer II (Light)",    health: 65,  reload: 0.85,maxFwd: 9,   big: false, color: 0x6a6e72, dmg: 28, cls: "tank", turret: 36 },
    panzer4:   { name: "Panzer IV (Medium)",   health: 120, reload: 1.2, maxFwd: 6.5, big: true,  color: 0x606468, dmg: 44, cls: "tank", turret: 20 },
    tiger:     { name: "Tiger I (Heavy)",      health: 205, reload: 1.9, maxFwd: 5,   big: true,  color: 0x585c60, dmg: 62, cls: "tank", turret: 15 },
    halftrack: { name: "Sd.Kfz. 251 (APC)",    health: 58,  maxFwd: 10, color: 0x5a5c60, cls: "apc",  crew: 6 },
    kubelwagen:{ name: "Kübelwagen (MG)",      health: 24,  maxFwd: 14, color: 0x5a5c60, cls: "jeep", crew: 2 },
    moto:      { name: "Motorcycle + Sidecar", health: 16,  maxFwd: 16, color: 0x45453d, cls: "moto", crew: 2 },
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
  // low-poly cylinder (road wheels, sprockets) — axis along local Y by default
  function cyl(r, h, color, seg = 12) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, h, seg),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.08 })
    );
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  // Entity registries
  const tanks = [], obstacles = [], projectiles = [], grenades = [], crews = [], debris = [], fx = [];
  const puffs = [], burners = [], smokeScreens = []; // smoke/fire/dust particles
  const aircraft = [], muns = [], timers = [], strikeMarks = []; // fire support
  const bridges = []; // {x, z0, z1, halfW}

  // fire-support inventory ("if available") per side
  const sc = config.support || {};
  const support = {
    allies: { arty: (sc.allies && sc.allies.arty) || 0, air: (sc.allies && sc.allies.air) || 0 },
    germans: { arty: (sc.axis && sc.axis.arty) || 0, air: (sc.axis && sc.axis.air) || 0 },
  };
  const aiSupport = { germans: 10 }; // enemy support cooldown timer

  // wind: drifts smoke and dust; stronger in the desert
  const windAngle = 0.7;
  const windSpeed = config.location === "north_africa" ? 7 : (wx.precip ? 4 : 2.5);
  const wind = new THREE.Vector3(Math.cos(windAngle), 0, Math.sin(windAngle)).multiplyScalar(windSpeed);
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
  // Smoke / fire / dust particle system  (camera-facing soft sprites)
  // ===========================================================================
  const softTex = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"); const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.6, "rgba(255,255,255,0.55)"); grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();

  function spawnPuff(pos, o = {}) {
    if (puffs.length > 360) { const old = puffs.shift(); scene.remove(old.s); }
    const mat = new THREE.SpriteMaterial({ map: softTex, color: o.color != null ? o.color : 0x555555,
      transparent: true, opacity: 0, depthWrite: false, blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending });
    const s = new THREE.Sprite(mat); s.position.copy(pos);
    const sz = o.size || 3; s.scale.set(sz, sz, 1);
    scene.add(s);
    puffs.push({ s, v: new THREE.Vector3((Math.random() - .5) * (o.spread || 1), o.rise != null ? o.rise : 1.4, (Math.random() - .5) * (o.spread || 1)),
      life: o.life || 3, max: o.life || 3, grow: o.grow != null ? o.grow : 2.2, peak: o.peak != null ? o.peak : 0.55, drift: o.drift != null ? o.drift : 0.5 });
  }
  function updatePuffs(dt) {
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i]; p.life -= dt;
      p.s.position.addScaledVector(p.v, dt); p.s.position.addScaledVector(wind, dt * p.drift);
      const sc = p.s.scale.x + p.grow * dt; p.s.scale.set(sc, sc, 1);
      const age = 1 - p.life / p.max; // 0 -> 1
      p.s.material.opacity = p.peak * (age < 0.15 ? age / 0.15 : (1 - age) / 0.85);
      if (p.life <= 0) { scene.remove(p.s); puffs.splice(i, 1); }
    }
  }

  // burning objects emit smoke (+ fire for level 2)
  function addBurner(pos, level, ttl) {
    let fire = null;
    if (level >= 2) {
      fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0xff7a1a, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
      fire.position.copy(pos).add(new THREE.Vector3(0, 1.3, 0)); fire.scale.set(2.6, 3.4, 1); scene.add(fire);
    }
    burners.push({ pos: pos.clone(), level, fire, t: Math.random() * 3, emit: 0, ttl: ttl == null ? Infinity : ttl });
  }
  function updateBurners(dt) {
    for (let i = burners.length - 1; i >= 0; i--) {
      const b = burners[i]; b.t += dt;
      if (b.ttl !== Infinity) { b.ttl -= dt; if (b.ttl <= 0) { if (b.fire) scene.remove(b.fire); burners.splice(i, 1); continue; } }
      b.emit -= dt;
      if (b.emit <= 0) {
        b.emit = b.level >= 2 ? 0.16 : 0.5;
        spawnPuff(b.pos.clone().add(new THREE.Vector3(0, b.level >= 2 ? 1.4 : 0.9, 0)),
          { color: b.level >= 2 ? 0x282828 : 0x8a8a8a, size: 2.4, rise: 2.4, life: b.level >= 2 ? 4.2 : 3, grow: b.level >= 2 ? 3.2 : 2, peak: b.level >= 2 ? 0.7 : 0.4, drift: 0.7 });
      }
      if (b.fire) { const f = 1 + Math.sin(b.t * 20) * 0.15 + Math.random() * 0.12; b.fire.scale.set(2.3 * f, 3.1 * f, 1); b.fire.material.opacity = 0.65 + Math.random() * 0.3; }
    }
  }

  // smoke grenades create a screen that also blocks AI line-of-sight
  function addSmokeScreen(pos) { smokeScreens.push({ pos: pos.clone().setY(0), r: 10, ttl: 11, emit: 0 }); }
  function updateSmokeScreens(dt) {
    for (let i = smokeScreens.length - 1; i >= 0; i--) {
      const s = smokeScreens[i]; s.ttl -= dt; s.emit -= dt;
      if (s.emit <= 0 && s.ttl > 1.5) {
        s.emit = 0.12;
        for (let k = 0; k < 2; k++) spawnPuff(s.pos.clone().add(new THREE.Vector3((Math.random() - .5) * s.r, Math.random() * 1.5, (Math.random() - .5) * s.r)),
          { color: 0xbfbfbf, size: 5, rise: 0.9, life: 4.5, grow: 3.4, peak: 0.75, drift: 0.35, spread: 0.6 });
      }
      if (s.ttl <= 0) smokeScreens.splice(i, 1);
    }
  }
  function smokeBlocks(a, b) {
    for (const s of smokeScreens) {
      if (s.ttl < 1) continue;
      const abx = b.x - a.x, abz = b.z - a.z, len2 = abx * abx + abz * abz;
      let t = len2 > 0 ? ((s.pos.x - a.x) * abx + (s.pos.z - a.z) * abz) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const dx = a.x + abx * t - s.pos.x, dz = a.z + abz * t - s.pos.z;
      if (dx * dx + dz * dz < (s.r * 0.85) * (s.r * 0.85)) return true;
    }
    return false;
  }

  // ambient blowing dust
  const dustBase = config.location === "north_africa" ? 0.12 : (wx.snowGround ? 0.5 : 0.32);
  let dustTimer = 0;
  function updateDust(dt) {
    dustTimer -= dt;
    if (dustTimer > 0) return;
    dustTimer = dustBase;
    const n = config.location === "north_africa" ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const off = new THREE.Vector3((Math.random() - .5) * cam.size * 2.4, Math.random() * 2 + 0.2, (Math.random() - .5) * cam.size * 2.4);
      const at = cam.focus.clone().add(off); at.y = Math.max(0.2, off.y);
      spawnPuff(at, { color: wx.snowGround ? 0xdfe6ea : 0xc2ad86, size: 2.4, rise: 0.15, life: 4.5, grow: 1.6, peak: wx.snowGround ? 0.16 : 0.2, drift: 1.4, spread: 0.4 });
    }
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
    // a battered building starts smoking before it collapses
    if ((o.type === "building" || o.type === "ruin") && !o.smoking && o.health < (o.type === "building" ? 160 : 90)) {
      o.smoking = true; addBurner(o.pos.clone().add(new THREE.Vector3(0, o.type === "building" ? 3 : 1.5, 0)), 1);
    }
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
        // collapse into a burning rubble pile
        for (let i = 0; i < 14; i++) { const r = box(rand(0.6, 1.6), rand(0.4, 0.9), rand(0.6, 1.6), o.chip);
          r.position.copy(o.pos).add(new THREE.Vector3(rand(-3, 3), rand(0.5, 3), rand(-3, 3))); scene.add(r);
          addDebris(r, new THREE.Vector3(rand(-4, 4), rand(2, 6), rand(-4, 4)), { life: DEBRIS_LIFE * 1.5 }); }
        addBurner(o.pos.clone().setY(0.6), 2, 26); // wreckage burns for a while
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
        // keep bridge approach lanes clear so vehicles can actually cross
        if (river && z > river.z0 - 16 && z < river.z1 + 16 && BRIDGE_XS.some((bx) => Math.abs(x - bx) < 11)) continue;
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

    // ---- Level-of-detail dressing --------------------------------------------
    // lodMid: shown once you zoom past the far silhouette; lodNear: fine parts &
    // animated bits that only appear (and move) when you're zoomed right in.
    const lodMid = [], lodNear = [], anim = { wheels: [] };
    const dark = 0x2b2c28, metal = 0x33352f;
    // hull stowage, exhaust, tools, headlights (medium detail)
    for (const sx of [-0.5, 0.5]) { const stow = box(0.5, 0.3, 0.55, mixShade(bodyColor, 0.85)); stow.position.set(sx, 0.9, -1.35); group.add(stow); lodMid.push(stow); }
    const exhaust = box(0.16, 0.16, 0.5, dark); exhaust.position.set(0.78, 0.5, -1.45); group.add(exhaust); lodMid.push(exhaust);
    anim.exhaust = new THREE.Vector3(0.78, 0.62, -1.72); // local muzzle of the exhaust for smoke
    for (const sx of [-0.58, 0.58]) { const hl = box(0.14, 0.14, 0.1, 0xffe9a8); hl.position.set(sx, 0.72, 1.62); group.add(hl); lodMid.push(hl); }
    const spareTrack = box(1.0, 0.12, 0.16, track); spareTrack.position.set(0, 1.06, 1.32); group.add(spareTrack); lodMid.push(spareTrack); // spare links on the glacis
    // turret dressing: gun mantlet + coaxial MG (medium detail)
    const mantlet = box(big ? 0.6 : 0.5, big ? 0.5 : 0.42, 0.35, mixShade(bodyColor, 0.9)); mantlet.position.set(0, 0.3, 0.65); turret.add(mantlet); lodMid.push(mantlet);
    const coax = box(0.08, 0.08, 0.85, metal); coax.position.set(0.3, 0.34, 0.95); turret.add(coax); lodMid.push(coax);

    // road wheels / sprockets / idlers — near detail, and they spin (anim.wheels)
    const wr = 0.34, wz = [-1.35, -0.68, 0, 0.68, 1.35];
    // geometry pre-rotated so the axle lies along X — spin via rotation.x rolls them
    for (const sx of [-1.0, 1.0]) {
      for (const z of wz) { const w = cyl(wr, 0.16, dark, 10); w.geometry.rotateZ(Math.PI / 2); w.position.set(sx * 1.22, 0.3, z); group.add(w); lodNear.push(w); anim.wheels.push(w); }
      const spr = cyl(0.3, 0.18, 0x3a3b36, 8); spr.geometry.rotateZ(Math.PI / 2); spr.position.set(sx * 1.22, 0.42, 1.55); group.add(spr); lodNear.push(spr); anim.wheels.push(spr);
      const idl = cyl(0.3, 0.18, 0x3a3b36, 8); idl.geometry.rotateZ(Math.PI / 2); idl.position.set(sx * 1.22, 0.42, -1.55); group.add(idl); lodNear.push(idl); anim.wheels.push(idl);
    }
    // commander in the open cupola hatch (near detail, bobs a little)
    const commander = new THREE.Group();
    const head = box(0.22, 0.24, 0.22, 0x6a5b45); head.position.y = 0.2; commander.add(head);
    const torso = box(0.34, 0.3, 0.3, mixShade(bodyColor, 0.7)); commander.add(torso);
    commander.position.set(0, 0.78, -0.4); turret.add(commander); lodNear.push(commander); anim.commander = commander;
    // radio antenna (near detail, sways with speed)
    const antenna = new THREE.Group();
    const rod = box(0.03, 2.0, 0.03, 0x1a1a1a); rod.position.y = 1.0; antenna.add(rod);
    antenna.position.set(-0.55, 0.35, -0.55); turret.add(antenna); lodNear.push(antenna); anim.antenna = antenna;

    for (const m of lodMid) m.visible = false;
    for (const m of lodNear) m.visible = false;
    return { group, turret, parts, lodMid, lodNear, anim };
  }
  // shade a hex colour by a multiplier (for subtle two-tone detail meshes)
  function mixShade(hex, k) { const c = new THREE.Color(hex); c.multiplyScalar(k); return c.getHex(); }
  function makeBar(color, y, width) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ color, depthTest: false, depthWrite: false }));
    s.center.set(0, 0.5); s.position.set(-width / 2, y, 0); s.scale.set(width, 0.22, 1); s.renderOrder = 999; return s;
  }

  // low-poly soft vehicles: APC (half-track), MG jeep, motorcycle. The "turret"
  // group here is the pintle/MG mount so the aiming/MG code works unchanged.
  function buildVehicle(cls, color) {
    const group = new THREE.Group(), parts = {}, wheel = 0x1c1c1c, turret = new THREE.Group();
    const lodMid = [], lodNear = [], anim = { wheels: [] };
    // a round hub cylinder on a wheel box, revealed & spun only at near zoom
    const hub = (x, y, z, r) => { const h = cyl(r, 0.22, 0x0d0d0d, 10); h.geometry.rotateZ(Math.PI / 2); h.position.set(x, y, z); group.add(h); lodNear.push(h); anim.wheels.push(h); };
    if (cls === "apc") {
      parts.lower = box(2.0, 0.55, 4.0, color); parts.lower.position.y = 0.55; group.add(parts.lower);
      const cab = box(2.0, 0.5, 1.3, color); cab.position.set(0, 1.0, 1.2); group.add(cab);
      const bed = box(1.7, 0.5, 2.3, color); bed.position.set(0, 1.05, -0.6); group.add(bed); // open troop bay walls
      const wsh = box(1.8, 0.5, 0.08, 0x2b2f33); wsh.position.set(0, 1.15, 1.85); group.add(wsh);
      for (const sx of [-1.02, 1.02]) { const tr = box(0.4, 0.5, 2.2, wheel); tr.position.set(sx, 0.3, -0.7); group.add(tr); } // rear tracks
      for (const sx of [-0.95, 0.95]) { const w = box(0.4, 0.5, 0.5, wheel); w.position.set(sx, 0.3, 1.5); group.add(w); hub(sx, 0.3, 1.5, 0.28); }  // front wheels
      for (const sx of [-1.06, 1.06]) for (const z of [-1.4, -0.7, 0]) hub(sx, 0.3, z, 0.26); // near: road wheels peeking from the tracks
      turret.position.set(0, 1.35, -0.6);
      const mg = box(0.12, 0.12, 1.1, 0x24201a); mg.position.z = 0.5; turret.add(mg);
      const shield = box(0.7, 0.5, 0.1, color); shield.position.z = -0.1; turret.add(shield);
    } else if (cls === "jeep") {
      parts.lower = box(1.5, 0.4, 2.7, color); parts.lower.position.y = 0.5; group.add(parts.lower);
      const hood = box(1.4, 0.35, 0.9, color); hood.position.set(0, 0.72, 0.95); group.add(hood);
      const wsh = box(1.4, 0.5, 0.06, 0x2b2f33); wsh.position.set(0, 0.95, 0.5); group.add(wsh);
      for (const sx of [-0.8, 0.8]) for (const sz of [-1.05, 1.05]) { const w = box(0.35, 0.55, 0.55, wheel); w.position.set(sx, 0.3, sz); group.add(w); hub(sx, 0.3, sz, 0.3); }
      for (const sx of [-0.6, 0.6]) { const hl = box(0.12, 0.12, 0.08, 0xffe9a8); hl.position.set(sx, 0.72, 1.42); group.add(hl); lodMid.push(hl); }
      turret.position.set(0, 0.9, -0.7);
      const post = box(0.1, 0.5, 0.1, 0x333333); post.position.y = -0.1; turret.add(post);
      const mg = box(0.1, 0.1, 1.0, 0x24201a); mg.position.set(0, 0.2, 0.45); turret.add(mg);
    } else { // moto
      parts.lower = box(0.35, 0.35, 1.9, color); parts.lower.position.y = 0.55; group.add(parts.lower);
      const seat = box(0.4, 0.2, 0.6, 0x1a1a1a); seat.position.set(0, 0.78, -0.3); group.add(seat);
      for (const sz of [-0.85, 0.85]) { const w = box(0.18, 0.7, 0.7, wheel); w.position.set(0, 0.35, sz); group.add(w); hub(0, 0.35, sz, 0.34); }
      const bar = box(0.7, 0.08, 0.08, 0x222222); bar.position.set(0, 0.95, 0.8); group.add(bar);
      const rider = box(0.4, 0.7, 0.4, 0x5a5c50); rider.position.set(0, 1.1, -0.2); group.add(rider); anim.rider = rider;
      const side = box(0.6, 0.4, 1.3, color); side.position.set(0.7, 0.45, -0.1); group.add(side); // sidecar
      const sw = box(0.16, 0.6, 0.6, wheel); sw.position.set(0.7, 0.32, -0.6); group.add(sw); hub(0.7, 0.32, -0.6, 0.29);
      turret.position.set(0.7, 0.85, 0.2);
      const mg = box(0.09, 0.09, 0.9, 0x24201a); mg.position.z = 0.4; turret.add(mg);
    }
    group.add(turret);
    group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    for (const m of lodMid) m.visible = false;
    for (const m of lodNear) m.visible = false;
    return { group, turret, parts, lodMid, lodNear, anim };
  }

  function spawnTank(team, typeKey, x, z, yaw) {
    const spec = TANK_TYPES[team][typeKey] || Object.values(TANK_TYPES[team])[0];
    const cls = spec.cls || "tank";
    const isTank = cls === "tank";
    const built = isTank ? buildTank(spec.color, spec.big) : buildVehicle(cls, spec.color);
    built.group.position.set(x, 0, z); built.group.rotation.y = yaw || 0; scene.add(built.group);
    const bars = new THREE.Group(); bars.position.y = isTank ? 3.3 : 2.4;
    const hpBg = makeBar(0x111111, 0, 2.2), hpFill = makeBar(0x7ac74f, 0, 2.2);
    const rlBg = makeBar(0x111111, -0.32, 2.2), rlFill = makeBar(0xffd24a, -0.32, 2.2);
    bars.add(hpBg, hpFill, rlBg, rlFill); built.group.add(bars);
    // role/doctrine: fast lights scout & flank, heavies support by fire, mediums
    // form the line; soft vehicles raid (jeep/moto) or carry troops (apc).
    const role = !isTank ? (cls === "apc" ? "apc" : "raider")
      : (spec.maxFwd >= 8 ? "scout" : (spec.health >= 170 ? "support" : "line"));
    const radius = isTank ? 1.8 : (cls === "apc" ? 1.5 : cls === "jeep" ? 1.1 : 0.9);
    const t = { team, typeKey, name: spec.name, group: built.group, turret: built.turret, parts: built.parts,
      yaw: yaw || 0, turretYaw: 0, speed: 0, health: spec.health, maxHealth: spec.health, radius,
      cooldown: 0, reload: spec.reload || 1, maxFwd: spec.maxFwd, dmg: spec.dmg || 0, big: !!spec.big, mgCd: 0, smokeCd: 0,
      // turret traverse in deg/s — historical powered rates for tanks; a pintle
      // MG a gunner hand-swings is much faster.
      turretSpeed: spec.turret || (isTank ? (spec.big ? 16 : (spec.maxFwd >= 8 ? 38 : 24)) : 100),
      cls, armored: isTank, mainGun: isTank, mgOnly: !isTank,
      mass: isTank ? (spec.big ? 2.6 : (spec.maxFwd >= 8 ? 1.2 : 1.7)) : (cls === "apc" ? 1.2 : cls === "jeep" ? 0.5 : 0.35),
      role, bound: tanks.length % 2, smoked: false,
      leftTrackBroken: false, rightTrackBroken: false, turretGone: false, alive: true, disabled: false,
      crewCount: spec.crew != null ? spec.crew : (spec.big ? 4 : 3), hasGrenades: Math.random() < 0.6, bars, hpFill, rlFill, rlBg,
      lodMid: built.lodMid || [], lodNear: built.lodNear || [], anim: built.anim || null,
      barrelRestZ: built.parts.barrel ? built.parts.barrel.position.z : 0, recoil: 0, wheelPhase: Math.random() * Math.PI * 2 };
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
  // take command of the nearest surviving friendly tank (used when yours is knocked out)
  function controlNearest(fromPos) {
    let best = null, bd = Infinity;
    for (const a of allyTanks) { if (!a.alive) continue; const d = a.group.position.distanceTo(fromPos); if (d < bd) { bd = d; best = a; } }
    controlled = best;
    cam.pan.set(0, 0, 0);
    if (best) banner(`CONTROL: ${best.name}`, 1.4);
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
        smoke: (i === 0 || Math.random() < 0.35) ? 1 : 0, smokeCd: rand(1, 3),
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
      if (c.smokeCd > 0) c.smokeCd -= dt;
      const threat = nearestEnemyEntity(c.group.position, c.team, 120).target;
      const threatDist = threat ? threat.group.position.distanceTo(c.group.position) : Infinity;

      // pop a smoke grenade to cover a bail-out under fire
      if (threat && threatDist < 26 && c.smoke > 0 && c.smokeCd <= 0) {
        c.smoke--; c.smokeCd = 8;
        const mid = c.group.position.clone().lerp(threat.group.position, 0.5).setY(1);
        throwSmoke(c.group.position.clone().setY(1.2), mid, c.team);
      }

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
  function fireProjectile(from, dir, team, type, dmg, owner, ff) {
    const spec = PROJ[type];
    const mesh = new THREE.Mesh(spec.geo, spec.mat); mesh.position.copy(from); scene.add(mesh);
    projectiles.push({ mesh, dir: dir.clone().normalize(), team, type, life: spec.life, spec, dmg, owner: owner || null, ff: !!ff, origin: from.clone(), hitObs: new Set() });
  }
  function fireTank(t) {
    if (!t.mainGun || t.turretGone || t.cooldown > 0 || !t.alive) return false;
    t.cooldown = t.reload;
    // gun dispersion — shots aren't laser-perfect (worse for a tank on the move)
    const spread = deg(1.3) + Math.min(Math.abs(t.speed), t.maxFwd) / t.maxFwd * deg(1.6);
    const yaw = t.yaw + t.turretYaw + rand(-spread, spread);
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const from = t.group.position.clone().add(new THREE.Vector3(0, 1.35, 0)).addScaledVector(dir, 3.6);
    // the player can shoot anything — their shells ignore team (friendly fire)
    fireProjectile(from, dir, t.team, "ap", t.dmg, t, t === controlled);
    t.recoil = 1; // gun kicks back, eases forward (visible when zoomed in)
    t.speed -= 3;
    if (t === controlled) cam.shake = Math.min(1.6, cam.shake + 0.5);
    return true;
  }
  // coaxial machine gun: rapid, low damage, mostly anti-infantry
  function fireMG(t, targetPos, ff) {
    if (t.turretGone || t.mgCd > 0 || !t.alive) return;
    t.mgCd = 0.09;
    const from = t.group.position.clone().add(new THREE.Vector3(0, 1.5, 0));
    const dir = new THREE.Vector3(targetPos.x - from.x, targetPos.y - from.y, targetPos.z - from.z).normalize();
    dir.x += rand(-0.05, 0.05); dir.z += rand(-0.05, 0.05); dir.normalize();
    const muzzle = from.addScaledVector(dir, 3.2);
    fireProjectile(muzzle, dir, t.team, "mg", null, t, ff);
  }
  // As an AP round reaches a tank, roll its outcome: mostly misses/glances,
  // graduated partial damage, and a low chance of a clean penetration. Range,
  // target motion and size shift the odds; soft vehicles are wrecked or missed.
  function rollShellOutcome(origin, t) {
    if (t.mgOnly) return Math.random() < 0.25 ? { mult: 0, label: "MISS" } : { mult: 1.3, label: "HIT", pen: true };
    const range = Math.hypot(t.group.position.x - origin.x, t.group.position.z - origin.z);
    const missChance = clamp(0.15 + clamp(range / 170, 0, 0.44)
      + clamp(Math.abs(t.speed) / (t.maxFwd || 12) * 0.2, 0, 0.2)
      + (t.big ? -0.05 : 0.02), 0.1, 0.7);
    const r = Math.random();
    if (r < missChance) return { mult: 0, label: "MISS" };
    const q = (r - missChance) / (1 - missChance);
    if (q < 0.30) return { mult: rand(0.12, 0.3), label: "GLANCE", pen: false };   // scratched the armour
    if (q < 0.62) return { mult: rand(0.45, 0.75), label: "HIT", pen: false };
    if (q < 0.85) return { mult: rand(0.85, 1.15), label: "SOLID HIT", pen: true };
    return { mult: rand(1.4, 1.9), label: "PENETRATION!", pen: true };            // rare clean kill-shot
  }

  function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const s = projectiles[i]; s.life -= dt;
      s.mesh.position.addScaledVector(s.dir, s.spec.speed * dt);
      const p = s.mesh.position; let done = false;
      for (const o of obstacles) {
        if (o.destroyed || o.radius <= 0 || o.type === "wire") continue;
        if (Math.hypot(p.x - o.pos.x, p.z - o.pos.z) < o.radius && p.y < 5) {
          if (hardCover(o)) { damageObstacle(o, s.spec.obsDmg, p.clone()); done = true; break; } // masonry/rock stops the round → real cover
          else if (!s.hitObs.has(o)) { s.hitObs.add(o); damageObstacle(o, s.spec.obsDmg, p.clone()); } // foliage/wire: punch through
        }
      }
      if (!done) for (const t of tanks) { if (!t.alive || t === s.owner) continue; if (!s.ff && t.team === s.team) continue;
        if (p.distanceTo(t.group.position.clone().setY(1)) < t.radius + 0.5) {
          if (s.type === "ap") {
            const out = rollShellOutcome(s.origin, t);
            if (out.mult <= 0) { spawnChips(p.clone(), 0xffe08a, 8, 6); explode(p.clone(), false); } // deflect / near miss — sparks, no damage
            else { s.pen = out.pen; const base = s.dmg != null ? s.dmg : (s.spec.tankDmg || 30);
                   hitTank(t, s, p.clone(), base * out.mult); explode(p.clone(), s.spec.big); }
            if (s.owner === controlled) banner(out.label, 0.8);
          } else { hitTank(t, s, p.clone()); explode(p.clone(), s.spec.big); }
          done = true; break;
        } }
      if (!done) for (const c of crews) { if (!c.alive) continue; if (!s.ff && c.team === s.team) continue;
        if (p.distanceTo(c.group.position.clone().setY(0.9)) < 0.7) { hurtCrew(c, s.spec.crewDmg); if (s.spec.big) explode(p.clone()); done = true; break; } }
      if (done || s.life <= 0 || p.y < 0 || Math.abs(p.x) > BOUND + 15 || Math.abs(p.z) > BOUND + 15) {
        if (!done && s.spec.big) explode(p.clone());
        scene.remove(s.mesh); projectiles.splice(i, 1);
      }
    }
  }
  const grenadeGeo = new THREE.SphereGeometry(0.18, 8, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x3b4022, roughness: 0.7 });
  const smokeGrenMat = new THREE.MeshStandardMaterial({ color: 0x4a4f52, roughness: 0.8 });
  function throwGrenade(from, target, team, smoke) {
    const mesh = new THREE.Mesh(grenadeGeo, smoke ? smokeGrenMat : grenadeMat); mesh.position.copy(from); scene.add(mesh);
    const flat = target.clone().sub(from).setY(0), dist = flat.length(), t = clamp(dist / 16, 0.7, 1.6);
    const v = flat.multiplyScalar(1 / t); v.y = 0.5 * 24 * t;
    grenades.push({ mesh, v, team, fuse: t + 0.05, smoke: !!smoke });
  }
  const throwSmoke = (from, target, team) => throwGrenade(from, target, team, true);
  function updateGrenades(dt) {
    for (let i = grenades.length - 1; i >= 0; i--) {
      const g = grenades[i]; g.fuse -= dt; g.v.y -= 24 * dt;
      g.mesh.position.addScaledVector(g.v, dt); g.mesh.rotation.x += dt * 8;
      if (g.mesh.position.y <= 0.2 || g.fuse <= 0) {
        const pos = g.mesh.position.clone().setY(0.3);
        if (g.smoke) { addSmokeScreen(pos); spawnPuff(pos.clone().setY(0.6), { color: 0xcccccc, size: 4, rise: 1.5, life: 2, grow: 4, peak: 0.7 }); }
        else { explode(pos, true); spawnChips(pos, 0x3b4022, 10, 7); areaDamage(pos, 6, 45, g.team); }
        scene.remove(g.mesh); grenades.splice(i, 1);
      }
    }
  }

  // ===========================================================================
  // Fire support: artillery barrages + air strikes (limited, "if available")
  // ===========================================================================
  function controlledTeam() { return controlled ? controlled.team : TEAM.ALLIES; }
  function schedule(delay, fn) { timers.push({ t: delay, fn }); }
  function updateTimers(dt) {
    for (let i = timers.length - 1; i >= 0; i--) { timers[i].t -= dt; if (timers[i].t <= 0) { const fn = timers[i].fn; timers.splice(i, 1); fn(); } }
  }
  // blast that damages EVERYONE in radius (danger close — friend and foe)
  function areaBlast(pos, radius, amount) {
    for (const t of tanks) { if (!t.alive) continue; const d = t.group.position.distanceTo(pos); if (d < radius) hitTank(t, { type: "he", top: true }, pos.clone().setY(1), amount * (1 - d / radius)); }
    for (const c of crews) { if (!c.alive) continue; const d = c.group.position.distanceTo(pos); if (d < radius) hurtCrew(c, amount * 1.6 * (1 - d / radius)); }
  }
  // a plunging shell/bomb that detonates on the ground
  function dropMunition(x, z, o = {}) {
    const mesh = box(0.4, 1.1, 0.4, 0x2a2a2a); mesh.position.set(x, o.height || 60, z); scene.add(mesh);
    muns.push({ mesh, vy: -(o.speed || 55), x, z, dmg: o.dmg || 60, radius: o.radius || 8 });
  }
  function updateMuns(dt) {
    for (let i = muns.length - 1; i >= 0; i--) {
      const m = muns[i]; m.mesh.position.y += m.vy * dt; m.mesh.rotation.x += dt * 5;
      if (m.mesh.position.y <= 0.4) {
        const pos = new THREE.Vector3(m.x, 0.5, m.z);
        explode(pos, true); spawnChips(pos, 0x6a5a3a, 14, 9); areaBlast(pos, m.radius, m.dmg);
        scene.remove(m.mesh); muns.splice(i, 1);
      }
    }
  }
  function addStrikeMark(pos, ttl, color) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 3.2, 20), new THREE.MeshBasicMaterial({ color: color || 0xff5a3a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(pos.x, 0.2, pos.z); scene.add(ring);
    strikeMarks.push({ ring, ttl, t: 0 });
  }
  function updateStrikeMarks(dt) {
    for (let i = strikeMarks.length - 1; i >= 0; i--) { const m = strikeMarks[i]; m.ttl -= dt; m.t += dt;
      const s = 1 + Math.sin(m.t * 6) * 0.15; m.ring.scale.set(s, s, s); m.ring.material.opacity = 0.4 + 0.4 * Math.abs(Math.sin(m.t * 4));
      if (m.ttl <= 0) { scene.remove(m.ring); strikeMarks.splice(i, 1); } }
  }

  function callArtillery(team, target) {
    if (support[team].arty <= 0) return false;
    support[team].arty--;
    const cx = target.x, cz = target.z;
    addStrikeMark(new THREE.Vector3(cx, 0, cz), 4.6, 0xffb020);
    for (let i = 0; i < 12; i++) {
      const delay = 1.8 + i * 0.24 + Math.random() * 0.18;
      const ox = cx + rand(-14, 14), oz = cz + rand(-14, 14);
      schedule(delay, () => dropMunition(ox, oz, { dmg: 58, radius: 8, height: 62, speed: 58 }));
    }
    if (team === controlledTeam()) banner("ARTILLERY INBOUND", 1.6);
    updateHUD();
    return true;
  }

  function buildPlane(team) {
    const g = new THREE.Group();
    const col = team === TEAM.ALLIES ? 0x4a5834 : 0x5a5c60;
    const fus = box(0.9, 0.8, 5.5, col); g.add(fus);
    const wing = box(7.5, 0.25, 1.3, col); wing.position.y = 0.1; g.add(wing);
    const tail = box(2.6, 0.2, 0.9, col); tail.position.set(0, 0.2, -2.4); g.add(tail);
    const fin = box(0.2, 1.0, 0.9, col); fin.position.set(0, 0.5, -2.4); g.add(fin);
    const nose = box(0.7, 0.7, 0.7, 0x222222); nose.position.z = 2.9; g.add(nose);
    scene.add(g); return g;
  }
  function callAir(team, target) {
    if (support[team].air <= 0) return false;
    support[team].air--;
    const dir = team === TEAM.ALLIES ? 1 : -1; // allies run south→north, axis north→south
    const g = buildPlane(team);
    g.position.set(target.x + rand(-6, 6), 34, target.z - dir * 190);
    g.rotation.y = dir > 0 ? Math.PI : 0;
    aircraft.push({ g, dir, tx: target.x, tz: target.z, team, dropped: 0, strafeCd: 0.3 });
    addStrikeMark(new THREE.Vector3(target.x, 0, target.z), 3.5, 0x5ac8ff);
    if (team === controlledTeam()) banner("AIR STRIKE INBOUND", 1.6);
    updateHUD();
    return true;
  }
  function updateAircraft(dt) {
    for (let i = aircraft.length - 1; i >= 0; i--) {
      const a = aircraft[i];
      a.g.position.z += a.dir * 78 * dt;
      a.g.position.x += Math.sin(a.g.position.z * 0.05) * 0.2; // gentle weave
      a.g.rotation.z = Math.sin(a.g.position.z * 0.08) * 0.15;
      if (Math.abs(a.g.position.z - a.tz) < 44) {
        a.strafeCd -= dt;
        if (a.strafeCd <= 0) { a.strafeCd = 0.07; // strafing run
          const from = a.g.position.clone();
          const dir = new THREE.Vector3(rand(-0.05, 0.05), -0.75, a.dir * 0.66).normalize();
          fireProjectile(from, dir, a.team, "mg", null, null, false);
        }
        if (a.dropped < 6 && Math.random() < 0.5) { a.dropped++; dropMunition(a.g.position.x + rand(-3, 3), a.g.position.z + a.dir * 3, { dmg: 52, radius: 7, height: a.g.position.y, speed: 64 }); }
      }
      if (Math.abs(a.g.position.z) > BOUND + 210) { scene.remove(a.g); aircraft.splice(i, 1); }
    }
  }

  // enemy AI spends its own support on clusters of allied armour
  function updateAiSupport(dt) {
    for (const team of [TEAM.GERMANS]) {
      if (support[team].arty <= 0 && support[team].air <= 0) continue;
      aiSupport[team] -= dt;
      if (aiSupport[team] > 0) continue;
      aiSupport[team] = 16 + Math.random() * 10;
      // aim at the biggest cluster of the opposing team's tanks
      const foes = tanks.filter((t) => t.alive && !t.disabled && t.team !== team);
      if (foes.length === 0) { aiSupport[team] = 6; continue; }
      let best = foes[0], bestN = 0;
      for (const f of foes) { let n = 0; for (const g of foes) if (g.group.position.distanceTo(f.group.position) < 18) n++; if (n > bestN) { bestN = n; best = f; } }
      const tgt = best.group.position.clone();
      if (support[team].air > 0 && (support[team].arty <= 0 || Math.random() < 0.4)) callAir(team, tgt);
      else callArtillery(team, tgt);
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
    // armour facing: thick sloped glacis up front bounces shots; sides & rear are weak
    let facing = 1;
    if (heavy && !proj.top && t.armored) { // plunging fire ignores hull facing; soft vehicles have no armour
      if (local.z > 0.5 && local.z > Math.abs(local.x)) facing = 0.55;      // frontal
      else if (local.z < -0.4) facing = 1.5;                                // rear
      else facing = 1.2;                                                    // side
      dmg *= facing;
      if (facing < 0.6 && Math.random() < 0.4) { spawnChips(hitPos.clone(), 0xffe08a, 5, 5); dmg *= 0.4; } // ricochet off the glacis
    }
    // MG mostly pings off tank armour, but shreds soft-skinned vehicles and crew
    if (proj.type === "mg") { if (t.armored) dmg *= 0.5; spawnChips(hitPos.clone(), 0xffe08a, 3, 3); }
    t.health -= dmg;
    const pen = proj.pen !== false; // only real penetrations knock off tracks/turrets
    if (pen && t.armored && heavy && side && local.y < 0.75 && !(local.x < 0 ? t.leftTrackBroken : t.rightTrackBroken) && Math.random() < 0.6) {
      const left = local.x < 0;
      if (left) { t.leftTrackBroken = true; detachAsDebris(t.parts.leftTrack); } else { t.rightTrackBroken = true; detachAsDebris(t.parts.rightTrack); }
      spawnChips(hitPos.clone(), 0x222222, 8, 5);
    }
    if (pen && t.armored && heavy && !t.turretGone && (high || t.health <= t.maxHealth * 0.35) && Math.random() < (high ? 0.5 : 0.25)) blowTurret(t);
    if (pen && t.armored && heavy && !high && Math.random() < 0.3 && t.parts.cupola && t.parts.cupola.parent) detachAsDebris(t.parts.cupola, new THREE.Vector3(rand(-2, 2), 4, rand(-2, 2)));
    if (pen && t.armored && heavy && Math.random() < 0.25 && t.parts.fender && t.parts.fender.parent) detachAsDebris(t.parts.fender, new THREE.Vector3(rand(-3, 3), 2, rand(-3, 3)));
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
    addBurner(t.group.position.clone().setY(0.9), 2); // the knocked-out hull burns and smokes
    t.bars.visible = false; spawnCrew(t);
    if (t.team === TEAM.GERMANS) { enemiesLeft = Math.max(0, enemiesLeft - 1); if (enemiesLeft === 0) banner("VICTORY", 0, true, "All Axis armour knocked out"); }
    else {
      alliesLeft = Math.max(0, alliesLeft - 1);
      if (t === controlled) controlNearest(t.group.position);
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
  // Level of detail — reveal fine models + animation as the player zooms in.
  // cam.size is the orthographic half-height: small = zoomed in, large = out.
  // ===========================================================================
  const LOD_NEAR = 24, LOD_MID = 58, LOD_HYST = 6; // switch bands (with hysteresis)
  let lodLevel = -1;
  function targetLOD() {
    const s = cam.size;
    const near = LOD_NEAR + (lodLevel === 2 ? LOD_HYST : 0);
    const mid = LOD_MID + (lodLevel >= 1 ? LOD_HYST : 0);
    if (s < near) return 2;   // zoomed right in: fine parts + animation
    if (s < mid) return 1;    // medium: extra dressing, no fine wheels/crew
    return 0;                 // far: base silhouette only
  }
  function applyLOD(level) {
    const midOn = level >= 1, nearOn = level >= 2;
    for (const t of tanks) {
      for (const m of t.lodMid) m.visible = midOn;
      for (const m of t.lodNear) m.visible = nearOn;
    }
  }
  function animateDetails(dt) {
    const time = _t0;
    for (const t of tanks) {
      const a = t.anim; if (!a) continue;
      if (a.wheels.length) { const spin = t.speed * dt / 0.34; for (const w of a.wheels) w.rotation.x -= spin; }
      if (!t.alive) continue;
      const spd = Math.min(Math.abs(t.speed), 14);
      if (a.antenna && !t.turretGone) {
        a.antenna.rotation.z = Math.sin(time * 3 + t.wheelPhase) * (0.04 + spd * 0.006);
        a.antenna.rotation.x = Math.cos(time * 2.3 + t.wheelPhase) * 0.03;
      }
      if (a.commander && !t.turretGone) a.commander.position.y = 0.78 + Math.sin(time * 3.5 + t.wheelPhase) * 0.02;
      if (a.rider) a.rider.rotation.x = -0.04 + Math.sin(time * 6 + t.wheelPhase) * 0.03 * Math.min(1, spd / 8);
      if (a.exhaust && Math.abs(t.speed) > 3 && Math.random() < 0.2) {
        const yaw = t.group.rotation.y, cos = Math.cos(yaw), sin = Math.sin(yaw), L = a.exhaust;
        const wp = new THREE.Vector3(t.group.position.x + (L.x * cos + L.z * sin), L.y, t.group.position.z + (-L.x * sin + L.z * cos));
        spawnPuff(wp, { color: 0x3a3a38, size: 0.7, rise: 0.9, life: 0.9, grow: 1.4, peak: 0.3, drift: 0.6, spread: 0.2 });
      }
    }
  }
  function updateLOD(dt) {
    const want = targetLOD();
    if (want !== lodLevel) { lodLevel = want; applyLOD(want); }
    // barrel recoil eases back regardless of zoom (cheap, reads at any distance)
    for (const t of tanks) if (t.recoil > 0 && t.parts.barrel) { t.recoil = Math.max(0, t.recoil - dt * 4); t.parts.barrel.position.z = t.barrelRestZ - t.recoil * 0.6; }
    if (lodLevel >= 2) animateDetails(dt);
  }

  // ===========================================================================
  // Input
  // ===========================================================================
  const keys = {};
  addEventListener("keydown", (e) => {
    if (e.key === "Tab") { e.preventDefault(); cycleControl(e.shiftKey ? -1 : 1); return; }
    keys[e.key.toLowerCase()] = true;
    if (e.key === " ") { e.preventDefault(); tryFire(); }
    if (e.key.toLowerCase() === "g") { e.preventDefault(); if (controlled && controlled.alive && !gameOver) deploySmoke(controlled); }
    if (e.key.toLowerCase() === "q" && !gameOver) { e.preventDefault(); callArtillery(controlledTeam(), aimPoint.clone()); }
    if (e.key.toLowerCase() === "e" && !gameOver) { e.preventDefault(); callAir(controlledTeam(), aimPoint.clone()); }
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
  let aimLock = null; // test-only: pin the aim point so traverse can be measured
  function updateAim() { if (aimLock) { aimPoint.copy(aimLock); return; } raycaster.setFromCamera(mouseNDC, camera); const hit = new THREE.Vector3(); if (raycaster.ray.intersectPlane(groundPlane, hit)) aimPoint.copy(hit); }
  function tryFire() { if (controlled && controlled.alive && !gameOver) fireTank(controlled); }

  // ===========================================================================
  // Movement / AI
  // ===========================================================================
  function driveTank(t, throttle, steer, dt) {
    let maxFwd = t.maxFwd, maxRev = 3;
    if (t.leftTrackBroken && t.rightTrackBroken) { t.speed *= Math.pow(0.02, dt); throttle = 0; steer = 0; }
    else if (t.leftTrackBroken || t.rightTrackBroken) { maxFwd *= 0.5; maxRev *= 0.5; t.yaw += (t.leftTrackBroken ? 1 : -1) * deg(35) * (Math.abs(t.speed) / maxFwd + 0.2) * dt; }
    // engines pull heavy hulls up to speed gradually — no instant top speed
    if (throttle > 0) t.speed += 4.5 * dt; else if (throttle < 0) t.speed -= 6 * dt;
    else t.speed -= Math.sign(t.speed) * Math.min(Math.abs(t.speed), 4 * dt);
    t.speed = clamp(t.speed, -maxRev, maxFwd);
    if (steer && !(t.leftTrackBroken && t.rightTrackBroken)) { const grip = 0.4 + 0.6 * Math.min(1, Math.abs(t.speed) / maxFwd); t.yaw -= steer * deg(72) * grip * dt; }
    t.group.rotation.y = t.yaw;
    const fwd = new THREE.Vector3(Math.sin(t.yaw), 0, Math.cos(t.yaw));
    const prev = t.group.position.clone();
    const np = prev.clone().addScaledVector(fwd, t.speed * dt);
    np.x = clamp(np.x, -BOUND, BOUND); np.z = clamp(np.z, -BOUND, BOUND); np.y = 0;
    resolveObstacles(np, t.radius, false, t);            // t crushes what it can, is blocked by the rest
    const w = wireBlocksInfantry(np); if (w) flattenWire(w); // tanks flatten barbed wire they roll over
    // a moving vehicle is blocked by other vehicles (it yields, rather than bulldozing them)
    for (const o of tanks) {
      if (o === t) continue;
      const dx = np.x - o.group.position.x, dz = np.z - o.group.position.z, d = Math.hypot(dx, dz);
      const min = (t.radius + o.radius) * 1.02; // block a touch earlier than the global pass fires
      if (d < min) {
        if (d > 1e-3) { const push = min - d; np.x += (dx / d) * push; np.z += (dz / d) * push; }
        else { np.x += rand(-0.4, 0.4); np.z += rand(-0.4, 0.4); }
        if (Math.abs(t.speed) > 2) t.speed *= 0.5; // the collision bleeds momentum
      }
    }
    if (inRiver(np) && !onBridge(np)) { t.speed *= 0.2; np.copy(prev); } // blocked by river except at bridges
    t.group.position.copy(np);
    // kick up dust/track spray while rolling
    if (Math.abs(t.speed) > 2.5 && Math.random() < 0.3) {
      const back = fwd.clone().multiplyScalar(-1.6);
      spawnPuff(t.group.position.clone().add(back).setY(0.3),
        { color: wx.snowGround ? 0xe6ecef : 0xb59f7d, size: 1.8, rise: 0.5, life: 1.6, grow: 1.8, peak: 0.28, drift: 0.8, spread: 0.5 });
    }
  }
  function deploySmoke(t) {
    if (!t || !t.alive || t.smokeCd > 0) return;
    t.smokeCd = 7;
    const yaw = t.turretGone ? t.yaw : t.yaw + t.turretYaw;
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const from = t.group.position.clone().add(new THREE.Vector3(0, 1.4, 0));
    throwSmoke(from, t.group.position.clone().addScaledVector(dir, 24), t.team);
  }
  // No two vehicles may occupy the same space: relax overlapping tank/wreck
  // pairs apart (moving both), then keep each out of the map edge, rivers, and
  // hard obstacles it was shoved into.
  function separateTanks() {
    const prev = tanks.map((t) => t.group.position.clone()); // valid positions from driveTank
    // residual-overlap cleanup (driveTank already blocks a mover from overlapping,
    // so this mainly resolves dense clusters). Heavier tanks yield a little less.
    for (let iter = 0; iter < 4; iter++) {
      for (let i = 0; i < tanks.length; i++) {
        for (let j = i + 1; j < tanks.length; j++) {
          const A = tanks[i], B = tanks[j], a = A.group.position, b = B.group.position;
          let dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
          const min = (A.radius + B.radius) * 0.9; // fires below driveTank's block, so held pairs aren't nudged
          if (d < min) {
            if (d < 1e-3) { dx = rand(-1, 1); dz = rand(-1, 1); d = Math.hypot(dx, dz) || 1; }
            const sum = A.mass + B.mass, total = min - d, nx = dx / d, nz = dz / d;
            a.x -= nx * total * (B.mass / sum); a.z -= nz * total * (B.mass / sum);
            b.x += nx * total * (A.mass / sum); b.z += nz * total * (A.mass / sum);
          }
        }
      }
    }
    for (let i = 0; i < tanks.length; i++) {
      const t = tanks[i], p = t.group.position;
      p.x = clamp(p.x, -BOUND, BOUND); p.z = clamp(p.z, -BOUND, BOUND);
      resolveObstacles(p, t.radius, false, null);       // pushed into a wall? slide out (don't crush from a nudge)
      if (inRiver(p) && !onBridge(p)) p.copy(prev[i]);   // never let separation shove a vehicle into the river
    }
  }
  function updateControlled(dt) {
    const t = controlled; if (!t || !t.alive) return;
    if (t.cooldown > 0) t.cooldown -= dt;
    if (t.mgCd > 0) t.mgCd -= dt;
    if (t.smokeCd > 0) t.smokeCd -= dt;
    const throttle = (keys["w"] ? 1 : 0) - (keys["s"] ? 1 : 0), steer = (keys["d"] ? 1 : 0) - (keys["a"] ? 1 : 0);
    driveTank(t, throttle, steer, dt);
    if (!t.turretGone) {
      const dx = aimPoint.x - t.group.position.x, dz = aimPoint.z - t.group.position.z;
      if (dx * dx + dz * dz > 0.5) { const worldYaw = Math.atan2(dx, dz), rel = worldYaw - t.yaw, step = shortAngle(t.turretYaw, rel), max = deg(t.turretSpeed) * dt;
        t.turretYaw += clamp(step, -max, max); t.turret.rotation.y = t.turretYaw; }
      if (keys["f"]) fireMG(t, aimPoint.clone().setY(1), true); // hold F: player MG (hits anything)
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

  // ---- tactical helpers ---------------------------------------------------
  const hardCover = (o) => (o.type === "building" || o.type === "ruin" || o.type === "rock") && o.solid && !o.destroyed;
  function terrainBlocks(a, b) { // hard cover on the line of sight
    for (const o of obstacles) {
      if (!hardCover(o) || o.radius <= 0) continue;
      const abx = b.x - a.x, abz = b.z - a.z, len2 = abx * abx + abz * abz;
      let u = len2 > 0 ? ((o.pos.x - a.x) * abx + (o.pos.z - a.z) * abz) / len2 : 0; u = Math.max(0.05, Math.min(0.95, u));
      const dx = a.x + abx * u - o.pos.x, dz = a.z + abz * u - o.pos.z;
      if (dx * dx + dz * dz < o.radius * o.radius) return true;
    }
    return false;
  }
  function nearestHardCover(pos, maxD) {
    let best = null, bd = maxD;
    for (const o of obstacles) { if (!hardCover(o) || o.radius <= 0) continue; const d = o.pos.distanceTo(pos); if (d < bd) { bd = d; best = o; } }
    return best;
  }
  function coverPoint(o, fromPos, extra) { // a spot on the far side of cover from a threat
    const d = new THREE.Vector3(o.pos.x - fromPos.x, 0, o.pos.z - fromPos.z);
    if (d.lengthSq() < 0.01) d.set(1, 0, 0); d.normalize();
    return new THREE.Vector3(o.pos.x + d.x * (o.radius + extra), 0, o.pos.z + d.z * (o.radius + extra));
  }
  function flankPoint(t, target) { // reach the enemy's side/rear, not its glacis
    const f = new THREE.Vector3(Math.sin(target.yaw), 0, Math.cos(target.yaw));
    const perp = new THREE.Vector3(f.z, 0, -f.x);
    const rel = new THREE.Vector3(t.group.position.x - target.group.position.x, 0, t.group.position.z - target.group.position.z);
    const s = (rel.x * perp.x + rel.z * perp.z) >= 0 ? 1 : -1;
    return new THREE.Vector3(target.group.position.x - f.x * 6 + perp.x * s * 24, 0, target.group.position.z - f.z * 6 + perp.z * s * 24);
  }
  function nearestEnemyTank(t) {
    let best = null, bd = 260;
    for (const e of tanks) { if (!e.alive || e.disabled || e.team === t.team) continue; const d = e.group.position.distanceTo(t.group.position); if (d < bd) { bd = d; best = e; } }
    return { target: best, dist: bd };
  }
  function countNear(pos, team, r, same) {
    let n = 0; for (const e of tanks) { if (!e.alive || e.disabled) continue; if (same ? e.team !== team : e.team === team) continue; if (e.group.position.distanceTo(pos) < r) n++; }
    return n;
  }

  // ---- role-based WWII armour AI -----------------------------------------
  // Soft MG vehicles: raiders (jeep/moto) dash in, rake with the MG and keep
  // their distance from tanks; APCs push up, machine-gun, and unload infantry.
  function updateVehicleAI(t, dt) {
    const pos = t.group.position;
    const { target } = nearestEnemyEntity(pos, t.team, 220);
    if (!target) { driveTank(t, 0, 0, dt); return; }
    const tp = target.group.position, dist = Math.hypot(tp.x - pos.x, tp.z - pos.z);
    const aimYaw = Math.atan2(tp.x - pos.x, tp.z - pos.z);
    // dodge enemy tanks (they'd shred us); otherwise close to MG range
    const nearTank = nearestEnemyTank(t);
    const flee = nearTank.target && nearTank.dist < (t.cls === "apc" ? 16 : 24);
    let faceYaw, throttle;
    if (flee) { const away = new THREE.Vector3(pos.x - nearTank.target.group.position.x, 0, pos.z - nearTank.target.group.position.z);
      faceYaw = navHeading(t, pos.clone().add(away)); throttle = 1; }
    else if (dist > 30) { faceYaw = navHeading(t, tp); throttle = 1; }
    else { faceYaw = aimYaw; throttle = t.cls === "moto" ? 0.6 : 0.2; } // keep moving (harder to hit)
    const step = shortAngle(t.yaw, faceYaw);
    driveTank(t, throttle, clamp(-step * 2.2, -1, 1), dt);
    // swing the pintle MG onto the target and fire
    const rel = aimYaw - t.yaw, s = shortAngle(t.turretYaw, rel);
    const mgMax = deg(t.turretSpeed) * dt; t.turretYaw += clamp(s, -mgMax, mgMax); t.turret.rotation.y = t.turretYaw;
    if (t.mgCd <= 0 && dist < 44 && !smokeBlocks(pos, tp) && !terrainBlocks(pos, tp)) fireMG(t, tp.clone().setY(1), false);
  }

  function updateAITank(t, dt) {
    if (!t.alive) return;
    if (t.cooldown > 0) t.cooldown -= dt; if (t.mgCd > 0) t.mgCd -= dt; if (t.smokeCd > 0) t.smokeCd -= dt;
    if (t.mgOnly) { updateVehicleAI(t, dt); return; }
    const pos = t.group.position;
    const { target: enemyTank, dist: tankDist } = nearestEnemyTank(t);
    const foot = nearestEnemyEntity(pos, t.team, 42, true).target;
    const target = enemyTank || nearestEnemyEntity(pos, t.team, 220).target;
    if (!target) { driveTank(t, 0, 0, dt); return; }
    const tp = target.group.position;
    const dist = Math.hypot(tp.x - pos.x, tp.z - pos.z);
    const aimYaw = Math.atan2(tp.x - pos.x, tp.z - pos.z);
    const hf = t.health / t.maxHealth;
    const reloading = t.cooldown > t.reload * 0.35;

    let faceYaw = aimYaw, throttle = 0, fireRange = 80;

    if (hf < 0.32) {
      // WITHDRAW: reverse in good order, facing the enemy, under smoke
      if (!t.smoked && t.smokeCd <= 0 && dist < 55) { deploySmoke(t); t.smoked = true; }
      faceYaw = aimYaw; throttle = -1;
    } else if (t.role === "scout") {
      // FLANK: swing wide to the enemy's side/rear, avoid frontal duels with heavies
      fireRange = 60;
      const fg = flankPoint(t, target);
      const dg = Math.hypot(fg.x - pos.x, fg.z - pos.z);
      if (dist < 16 && target.big) { faceYaw = navHeading(t, fg); throttle = 1; }        // don't sit in front of a heavy
      else if (dg > 10) { faceYaw = navHeading(t, fg); throttle = 1; }                    // race to the flank
      else { faceYaw = aimYaw; throttle = dist < 22 ? -0.5 : 0.1; }                       // engage from the side
    } else if (t.role === "support") {
      // SUPPORT BY FIRE: stand off, keep the glacis to the enemy, use cover
      fireRange = 95;
      if (dist < 30) { faceYaw = aimYaw; throttle = -1; }                                 // open the range
      else if (dist > 72) { faceYaw = navHeading(t, tp); throttle = 0.6; }
      else {
        const cov = nearestHardCover(pos, 16);
        if (reloading && cov) { faceYaw = navHeading(t, coverPoint(cov, tp, 3)); throttle = 0.6; } // tuck behind cover to reload
        else { faceYaw = aimYaw; throttle = 0; }
      }
    } else {
      // LINE: bounding overwatch + hull-down + mutual support
      const moving = (Math.floor(_t0 / 4) % 2) === t.bound;
      const friends = countNear(pos, t.team, 46, true), foes = countNear(pos, t.team, 40, false);
      const alone = friends === 0 && foes >= 1 && dist < 42; // don't charge in alone
      const cov = nearestHardCover(pos, 15);
      if (reloading && cov) { faceYaw = navHeading(t, coverPoint(cov, tp, 2.5)); throttle = 0.7; } // shoot-and-scoot behind cover
      else if (dist > 50 && moving && !alone) { faceYaw = navHeading(t, tp); throttle = 1; }       // bound forward
      else if (dist < 22) { faceYaw = aimYaw; throttle = -0.7; }                                     // back off if crowded
      else { faceYaw = aimYaw; throttle = 0; }                                                       // overwatch: hold & fire
    }

    const step = shortAngle(t.yaw, faceYaw), steer = clamp(-step * 2.2, -1, 1);
    driveTank(t, throttle, steer, dt);

    if (!t.turretGone) {
      const rel = aimYaw - t.yaw, s = shortAngle(t.turretYaw, rel);
      const tMax = deg(t.turretSpeed) * dt; t.turretYaw += clamp(s, -tMax, tMax); t.turret.rotation.y = t.turretYaw;
      const aligned = Math.abs(shortAngle(t.yaw + t.turretYaw, aimYaw)) < deg(7);
      const clearLOS = !smokeBlocks(pos, tp) && !terrainBlocks(pos, tp);
      if (enemyTank && t.cooldown <= 0 && dist < fireRange && aligned && clearLOS) fireTank(t);
      if (foot && t.mgCd <= 0 && !smokeBlocks(pos, foot.group.position) && !terrainBlocks(pos, foot.group.position))
        fireMG(t, foot.group.position.clone().setY(1), false);
    }
    if (hf >= 0.32) t.smoked = false; // reset once healthy again
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
  const elSupport = document.createElement("div"); elSupport.style.cssText = "position:absolute;top:242px;left:18px;font-size:12px;letter-spacing:1px;opacity:.9";
  hud.append(elSupport);
  // track HUD nodes we created so dispose() can remove them
  const ownHudNodes = [elReload, elReloadLabel, elSupport];

  function updateHUD() {
    if (!controlled) { elStatus.textContent = `ALLIES ${alliesLeft}   ENEMIES ${enemiesLeft}`; elFill.style.width = "0%"; return; }
    const t = controlled, pct = Math.max(0, Math.round(100 * t.health / t.maxHealth)), flags = [];
    if (t.leftTrackBroken) flags.push("L-TRK"); if (t.rightTrackBroken) flags.push("R-TRK"); if (t.turretGone) flags.push("NO GUN");
    elStatus.textContent = `${t.name}  ${pct}%   ALLIES ${alliesLeft}   ENEMIES ${enemiesLeft}` + (flags.length ? "  [" + flags.join(" ") + "]" : "");
    elFill.style.width = pct + "%";
    elFill.style.background = pct <= 30 ? "linear-gradient(90deg,#e0574a,#ff8a6a)" : "linear-gradient(90deg,#7ac74f,#b6e36a)";
    const s = support[controlledTeam()];
    elSupport.innerHTML = `<span style="color:#ffb020">◎ ARTY ×${s.arty}</span> <span style="opacity:.5">[Q]</span> &nbsp; <span style="color:#5ac8ff">✈ AIR ×${s.air}</span> <span style="opacity:.5">[E]</span>`;
  }
  function updateReloadHud() {
    const t = controlled;
    if (t && t.mgOnly) { elReloadFill.style.width = "100%"; elReloadFill.style.background = "linear-gradient(90deg,#6a86c0,#9fb4e0)"; elReloadLabel.textContent = "MACHINE GUN (F) — NO MAIN GUN"; return; }
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
    separateTanks();
    updateCrew(dt);
    updateProjectiles(dt); updateGrenades(dt); updateFx(dt); updateDebris(dt); updatePrecip(dt);
    updatePuffs(dt); updateBurners(dt); updateSmokeScreens(dt); updateDust(dt);
    updateMuns(dt); updateAircraft(dt); updateTimers(dt); updateStrikeMarks(dt); updateAiSupport(dt);
    for (const tk of tanks) updateTankBars(tk);
    updateReloadHud(); updateHUD(); updateCamera(dt); updateLOD(dt);
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
    get camFocus() { return cam.focus.clone(); }, FIELD, puffs, burners, smokeScreens,
    smokeBlocksAt(ax, az, bx, bz) { return smokeBlocks({ x: ax, z: az }, { x: bx, z: bz }); },
    get keyF() { return !!keys["f"]; }, mgFireNow() { if (controlled) fireMG(controlled, aimPoint.clone().setY(1), true); },
    smokeNow() { if (controlled) deploySmoke(controlled); },
    terrainBlocksAt(ax, az, bx, bz) { return terrainBlocks({ x: ax, z: az }, { x: bx, z: bz }); },
    get support() { return support; }, get muns() { return muns; }, get aircraft() { return aircraft; },
    disableControlled() { if (controlled) disableTank(controlled); },
    sampleOutcomes(idx, dist, n) { const t = tanks[idx]; const o = { x: t.group.position.x - (dist || 40), z: t.group.position.z };
      const c = {}; for (let k = 0; k < (n || 1000); k++) { const r = rollShellOutcome(o, t); c[r.label] = (c[r.label] || 0) + 1; } return c; },
    callArty(x, z, team) { return callArtillery(team || TEAM.ALLIES, new THREE.Vector3(x, 0, z)); },
    callAirstrike(x, z, team) { return callAir(team || TEAM.ALLIES, new THREE.Vector3(x, 0, z)); },
    testFacing(idx, where) { const tk = tanks[idx]; if (!tk) return null; const before = tk.health;
      const off = where === "front" ? new THREE.Vector3(0, 0.4, 1.3) : where === "rear" ? new THREE.Vector3(0, 0.4, -1.3) : new THREE.Vector3(1.3, 0.4, 0);
      const wp = tk.group.localToWorld(off.clone());
      hitTank(tk, { type: "ap", spec: PROJ.ap, dmg: 50 }, wp, 50); return Math.round((before - tk.health) * 10) / 10; },
    testShell(x, z, ff) { if (!controlled) return; const pos = controlled.group.position;
      const dir = new THREE.Vector3(x - pos.x, 0, z - pos.z); if (dir.lengthSq() < 1e-6) return; dir.normalize();
      const from = pos.clone().add(new THREE.Vector3(0, 1.35, 0)).addScaledVector(dir, 3.6);
      fireProjectile(from, dir, controlled.team, "ap", controlled.dmg, controlled, ff); },
    killEnemy() { const e = enemyTanks.find((t) => t.alive); if (e) disableTank(e); },
    // LOD test surface: set the zoom, read the current level, count visible detail
    setZoom(size) { cam.size = clamp(size, MIN_SIZE, MAX_SIZE); updateLOD(0.016); return cam.size; },
    get lodLevel() { return lodLevel; }, get camSize() { return cam.size; },
    detailCount(idx) { const t = tanks[idx]; if (!t) return null;
      return { mid: t.lodMid.length, midVisible: t.lodMid.filter((m) => m.visible).length,
        near: t.lodNear.length, nearVisible: t.lodNear.filter((m) => m.visible).length,
        wheels: t.anim ? t.anim.wheels.length : 0 }; },
    wheelSpin(idx) { const t = tanks[idx]; return t && t.anim && t.anim.wheels[0] ? t.anim.wheels[0].rotation.x : null; },
    // turret-traverse test surface
    lockAim(x, z) { aimLock = new THREE.Vector3(x, 0, z); },
    get turretDeg() { return controlled ? controlled.turretYaw * 180 / Math.PI : null; },
    turretSpeedOf(idx) { const t = tanks[idx]; return t ? t.turretSpeed : null; },
  };
  window.__game = handle;
  return handle;
}
