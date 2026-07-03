# WWII Tanks — 3D Isometric Tank Simulator

A low-poly, World War II–era tank battle built with the **[Defold](https://defold.com)**
game engine and deployed as an HTML5 build on **Vercel**.

You command an American (olive drab) tank against a company of German (panzer
grey) tanks on an open battlefield. Drive, rotate the hull, aim the turret with
the mouse, and fire. The camera is a fully controllable isometric camera — orbit,
zoom, and pan around the action.

> **MVP scope.** This is a self-contained minimum-viable build: procedurally
> generated low-poly models, arcade-realistic vehicle physics, basic enemy AI,
> shell ballistics, and explosions. See [Roadmap](#roadmap) for what a fuller
> version would add.

---

## Controls

| Action | Input |
| --- | --- |
| Drive forward / reverse | `W` / `S` |
| Steer (pivot) hull | `A` / `D` |
| Aim turret | Move the **mouse** (turret tracks the cursor on the ground) |
| Fire main gun | **Left mouse button** or `Space` |
| Orbit camera | Hold **right mouse button** + drag |
| Pan camera | Hold **middle mouse button** + drag, or `Q`/`E`/`R`/`F` |
| Zoom | **Mouse wheel** |

Destroy all four enemy tanks to win. Take too many hits and your tank is
knocked out.

---

## Project layout

```
game.project              Defold project configuration + bootstrap
input/game.input_binding  Keyboard/mouse action bindings

main/
  main.collection         The battlefield: ground, tanks, camera, HUD, spawns
  tanks.render(_script)   Custom 3D render pipeline (depth-tested model pass + 2D HUD)
  *.go / *.factory        Game objects and projectile/explosion factories

scripts/
  camera.script           Isometric orbit/zoom/pan camera + mouse->ground picking
  player.script           Player hull physics + firing
  turret.script           Independent, cursor-tracking player turret
  enemy.script            German tank AI (chase, aim, fire)
  projectile.script       Shell flight + hit resolution
  explosion.script        Expanding fireball effect
  world.lua               Shared tank registry used for hit detection

materials/
  tank.material/.vp/.fp   Custom lit material for the low-poly models

models/*.model            Mesh + material + texture bindings
tanks/  props/            Geometry: glTF 2.0 (primary) + Collada (.dae fallback)
textures/                 Solid-colour PNG palettes (olive, grey, ground, ...)
hud/                      On-screen HUD (controls, hull integrity, win/lose)

tools/
  gen_assets.py           Regenerates all meshes + textures
  build_html5.sh          Downloads Defold `bob` and builds the HTML5 bundle
vercel.json               Vercel static-hosting config for the built bundle
```

All 3D geometry and textures are **generated procedurally** by
`tools/gen_assets.py` (Python standard library only) — there are no binary
art assets to manage. Re-run it any time you tweak a shape:

```bash
python3 tools/gen_assets.py
```

---

## Running it in the Defold editor

1. Install the [Defold editor](https://defold.com/download/) (free).
2. **File -> Open Project** and select this repository's `game.project`.
3. Press **Project -> Build** (or `Ctrl/Cmd+B`) to run the game locally.

The project targets desktop and HTML5. No external dependencies or asset
imports are required — everything is in the repo.

---

## Building the HTML5 bundle

A helper script downloads the matching Defold `bob` build tool and produces a
static site in `./dist`:

```bash
./tools/build_html5.sh
```

Requirements: **Java 11+** and network access to `d.defold.com`. The output in
`./dist` is a self-contained folder (`index.html`, `.wasm`, `.js`, assets).

Preview it locally:

```bash
npx serve dist
```

---

## Deploying to Vercel

The build is a static site, so any static host works. For Vercel:

**Option A — deploy the built folder directly (simplest):**

```bash
./tools/build_html5.sh
vercel deploy ./dist --prod
```

**Option B — CI build + deploy on push.** `.github/workflows/build.yml` builds
the bundle on every push and, if a `VERCEL_TOKEN` repository secret is present,
deploys it to production automatically.

`vercel.json` sets the correct `application/wasm` content type and the
cross-origin isolation headers Defold's WebAssembly runtime prefers.

> Note: Vercel's own build container does not run Defold. Either build locally /
> in CI and deploy the resulting `dist/` (as above), or commit `dist/` and point
> Vercel at it as a static output directory.

---

## How it works

- **Isometric 3D camera** (`camera.script`): an orthographic projection at the
  classic 35.264° isometric pitch. It orbits, zooms, and pans, follows the
  player, feeds its view/projection matrices to the render script each frame,
  and unprojects the mouse cursor onto the ground plane so the turret can aim.
- **Custom render pipeline** (`tanks.render_script`): Defold's default renderer
  is 2D, so this project ships a 3D render script — a depth-tested, back-face
  culled model pass followed by a 2D overlay pass for the HUD.
- **Vehicle physics** (`player.script`): longitudinal acceleration / braking /
  friction, speed-dependent steering grip, firing recoil, and battlefield
  bounds — integrated per frame for a rigid-body feel.
- **Independent turret** (`turret.script`): a separate game object riding on the
  hull so the gun can track the mouse regardless of the driving direction.
- **Combat** (`projectile.script` + `world.lua`): shells resolve hits against a
  shared registry of live tanks (sphere overlap), apply damage, and spawn an
  explosion. Keeping collision in-script makes the MVP deterministic and free of
  physics-engine coupling.
- **Enemy AI** (`enemy.script`): each German tank turns toward the player,
  advances to firing range, and shells it on a cooldown when lined up.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for a deeper tour.

---

## Roadmap

Natural next steps beyond the MVP:

- Bullet-based 3D rigid-body physics with real terrain collision and tank
  suspension.
- Independent enemy turrets and smarter AI (flanking, cover use, line-of-sight).
- Particle-system explosions, muzzle flashes, tracks/decals, and engine audio.
- Destructible cover, varied maps, and a mission/score loop.
- Higher-fidelity models imported from Blender as glTF.
