# Architecture

A tour of how the WWII Tanks MVP is put together in Defold.

## Coordinate system

- **Y is up.** The battlefield lies on the `y = 0` plane; tanks drive in X/Z.
- **+Z is "forward"** for a hull and for a turret barrel. A yaw angle `a` maps to
  the direction `vec3(sin(a), 0, cos(a))`, which is exactly what
  `vmath.quat_rotation_y(a)` produces when applied to `+Z`. Every script uses
  this convention, so headings, aiming, and shell velocities all agree.

## Rendering (`main/tanks.render_script`)

Defold's stock renderer is orthographic 2D with no depth buffer. This project
replaces it (see `[bootstrap] render` in `game.project`) with a two-pass 3D
pipeline:

1. **Model pass** — clears colour + depth, applies the camera's view/projection,
   enables depth test and back-face culling, and draws the `model` predicate.
2. **HUD pass** — an identity view with a screen-space orthographic projection,
   alpha blending on, drawing the `text` and `gui` predicates.

The camera never touches the renderer directly; it posts a `set_view_projection`
message to `@render:` every frame.

## Camera (`scripts/camera.script`)

An orthographic isometric camera parameterised by `azimuth`, `pitch`,
`distance`, and `size` (zoom). Each frame it:

1. Lerps its focus toward the player (plus any user pan offset).
2. Builds `look_at` view + `orthographic` projection matrices and sends them to
   the renderer.
3. **Unprojects** the mouse cursor: it inverts `projection * view`, builds a ray
   through the cursor's normalised device coordinates, intersects it with the
   `y = 0` plane, and posts the resulting world point to the turret as an
   `aim_point`.

Input: right-drag orbits, middle-drag pans, the wheel zooms, and `Q/E/R/F` pan
via the keyboard.

## Player (`scripts/player.script` + `scripts/turret.script`)

The player is two game objects:

- **Hull** — integrates a simple longitudinal model (accelerate / brake /
  coast with friction, clamped to forward/reverse maxima) and yaw steering whose
  rate scales with speed. Firing applies a backward recoil impulse and a camera
  shake.
- **Turret** — a separate object that copies the hull position each frame and
  slews toward the camera's `aim_point`, so the gun aims at the cursor
  independently of the driving direction. Firing reads the turret's world
  rotation to launch the shell.

## Combat (`scripts/projectile.script`, `scripts/world.lua`)

Rather than couple the MVP to a physics engine, hit detection uses a shared Lua
registry (`world.lua`, enabled by `shared_state = 1`). Every live tank registers
its URL, team, and radius. A shell:

1. Is spawned by a `factory` at the muzzle and given a direction + team via a
   `launch` message.
2. Flies straight at high speed, each frame testing `world.hit_test` (sphere
   overlap against enemy-team tanks).
3. On a hit, posts a `damage` message and detonates; on timeout or leaving the
   field it simply detonates.

Explosions (`scripts/explosion.script`) are factory-spawned fireball blocks that
punch out and shrink away before deleting themselves.

## Enemy AI (`scripts/enemy.script`)

Each German tank queries `world.nearest_enemy` for the player, turns its hull
toward it, advances until inside a stand-off range, and fires on a cooldown when
the player is within the firing cone and range. On death it spawns an explosion,
unregisters, tells the HUD, and deletes itself. The HUD counts kills and shows
the victory banner when the last enemy falls.

## Assets (`tools/gen_assets.py`)

Everything visual is generated from box primitives:

- **Meshes** are emitted as **glTF 2.0** (`.gltf`, the format modern Defold
  imports best) with a Collada (`.dae`) copy kept as a fallback. Each box gets
  flat per-face normals (24 verts / 12 tris) for a crisp low-poly look.
- **Textures** are 8×8 solid-colour PNGs written with only `zlib` + `struct`.
- A custom material (`materials/tank.*`) lights the models in **world space**
  with a fixed directional "sun" plus ambient fill, so shading stays put as the
  camera orbits.

To change a tank's silhouette, edit the box lists in `gen_assets.py` and re-run
it; no external modelling tools are needed.
