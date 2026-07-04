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

## Two builds in this repo

| Build | Where | Runs on Vercel? |
| --- | --- | --- |
| **Web build (Three.js)** | [`web/`](web/) | ✅ Yes — pure static files, no build step. This is what deploys to Vercel and what you can play instantly in a browser. |
| **Defold source** | `game.project`, `main/`, `scripts/`, … | ⚠️ Not directly — Vercel can't run the Defold engine. Build it in the Defold editor (`Project → Bundle → HTML5`) and deploy that bundle separately. |

The web build is a faithful port of the Defold MVP (same tanks, camera,
controls, combat) written so it can actually be hosted and verified end-to-end.
The Defold project remains the canonical engine implementation described below.

The setup screen has a **🎲 Randomize** button (top-right) that rolls every
setting, and a **Historical Battle** dropdown that recreates famous WWII tank
engagements — Villers-Bocage, Operation Goodwood, Arracourt, the Battle of the
Bulge, El Alamein, Kasserine Pass, Prokhorovka/Kursk, and Brody — approximated
with the game's roster (location, weather, both sides' tank mixes, and fire
support), with a short historical note.

The web build opens on a **setup screen** (tabbed): a **Battlefield** tab to
choose location + weather (with the version number), and **Allies**/**Axis**
tabs where you set the **count of each tank type** (− / + steppers) and can
fine-place them on a minimap in your deployment zone. In battle, a **top menu
bar** (Setup Battle · Restart · Pause · Help · Leave) runs the match, and
**Tab** takes command of any friendly tank.

The web build has since grown well beyond the MVP with these battlefield systems:

- **Allied tanks** fight the German company alongside the player; a generic
  team-based AI drives every non-player tank.
- **Destructible cover** — trees, rocks, and crates. Shells **pass through**
  them, chipping them and flinging **debris**; enough hits topple/shatter them.
- **Debris physics** — chunks fly, bounce, rest on the ground, then **sink into
  the earth and fade out over ~30 seconds**.
- **Location-based tank damage** — a hit's effect depends on where and what it
  is: **tracks break** (disabling movement to one side so the tank slews), the
  **turret can be blown clean off**, and cupolas/fenders can be knocked loose.
  Machine-gun fire mostly pings off armour; AP shells and grenades do the work.
- **Reload indicators** — a HUD reload bar/timer plus a floating reload bar over
  every tank while its gun is cooling down.
- **Bailing crews** — when a tank is disabled the tankers **climb out**, run for
  the nearest **cover**, go **prone**, and fight with **rifles / pistols /
  grenades** (minimal damage to armour, but they duel enemy infantry too).
- **Rich terrain** — buildings, ruins, trees, rocks, **rivers with bridges** you
  must cross, **barbed wire** (blocks/hurts infantry), and **anti-tank
  hedgehogs**. Location + weather change the ground, props, fog, and light.
- **Tank types & rosters** — Light/Medium/Heavy per faction (Stuart/Sherman/
  Pershing vs Panzer II/Panzer IV/Tiger), each with distinct armour, speed, and
  gun, deployed from the setup minimaps.
- **Soft vehicles** — deployable alongside the tanks: **personnel carriers**
  (M3 Half-track / Sd.Kfz. 251) that carry infantry and **unload a squad when
  knocked out**, **MG jeeps** (Willys .50-cal / Kübelwagen), and **motorcycles**
  (with sidecar MG). They're fast and **machine-gun armed but unarmoured** — no
  main gun, and MG fire shreds them — so their AI raids, harasses, and dodges
  tanks. You can Tab into and drive them too.
- **Probabilistic hit quality** — a shell entering a target's collider rolls on
  a progressive scale: **MISS**, **GLANCE** (a scratch that barely dents the
  armour), **HIT**, **SOLID HIT**, or a rare **PENETRATION!** — with the chance
  of a clean direct hit kept deliberately low (~8–10%). Miss odds climb with
  range and the firer's own speed, so a moving tank shooting on the move is far
  less accurate. Shots also **disperse** — the gun cone widens the faster you're
  driving. The controlled tank flashes the outcome (GLANCE / SOLID HIT / …) on
  each strike.
- **Zoom-based level of detail** — as you scroll in, vehicles reveal
  progressively finer models and come alive: at a distance they're clean
  low-poly silhouettes; zoom to medium and they gain stowage, exhausts,
  headlights, gun mantlets and coaxial MGs; zoom right in and out come the
  road wheels, drive sprockets, a commander in the open cupola, and a radio
  antenna — **animated**: the wheels roll with the tank's speed, the antenna
  sways, the commander bobs, exhausts puff smoke, and the main gun **recoils**
  when it fires. Detail is culled when you zoom back out so the wide view stays
  fast.
- **Solid tank-vs-tank collisions** — vehicles never overlap, and a ramming
  tank **yields to the one it hits instead of shoving it aside**; separation of
  any residual pile-up is **mass-weighted**, so a Stuart can't bulldoze a Tiger.
- **Navigating AI** — AI tanks route to and cross **bridges** to reach the
  enemy, steer around solid obstacles (buildings, ruins, rocks, and — for all
  but heavies — anti-tank hedgehogs), and **drive straight through** what they
  can knock over (trees, crates, barbed wire; heavies also flatten hedgehogs).
- **Terrain editor** — a setup **Terrain** tab to add your own buildings, ruins,
  trees, rocks, hedgehogs, and barbed wire anywhere on the field, on top of the
  location's generated terrain.
- **Fire support (if available)** — call in **artillery barrages** (`Q`) and
  **air strikes** (`E`) at the mouse point, from a limited pool set per side in
  the setup **Fire Support** panel. A barrage walks a spread of shells over the
  target after a short spotting delay; an air strike sends a plane on a
  bombing/strafing run. Both are **danger close** (they hit friend and foe), and
  the **enemy calls its own** on your tank clusters. The HUD shows your
  remaining `◎ ARTY` / `✈ AIR`.
- **WWII armour tactics** — the AI fights by doctrine, not just "drive at the
  enemy":
  - **Roles by class** — light tanks **scout & flank** (swing to the side/rear),
    mediums **bound forward with overwatch** (alternating fire-and-movement) and
    keep **mutual support** (won't charge in alone), heavies **stand off and
    support by fire**, keeping their glacis to the enemy.
  - **Hull-down / shoot-and-scoot** — tanks tuck behind hard cover to reload,
    then peek to fire.
  - **Withdraw under smoke** — a badly damaged tank reverses in good order,
    facing the enemy, popping smoke to break contact.
  - **Real armour facing** — the thick sloped **frontal glacis bounces shots**;
    **sides and rear are weak**, so flanking a tank actually pays off.
  - **Real cover** — shells punch through foliage but are **stopped by masonry
    and rock**, so buildings/ruins/boulders give genuine protection and block
    line-of-sight (as does smoke).
- **Atmosphere & effects** — damaged buildings **smoke**, destroyed structures
  and knocked-out tanks **burn** with fire and rising smoke, and **dust blows**
  across the field (kicked up by moving tanks; heaviest in the desert).
- **Machine guns** — hold **F** for the coaxial MG (rapid, low-damage,
  anti-infantry); AI tanks rake nearby enemy infantry with theirs.
- **Smoke grenades** — press **G** to lob a smoke screen; bailed crews pop smoke
  to cover their retreat. Smoke actually **blocks AI line-of-sight**, so gunners
  can't fire through it.
- **Shoot anything** — a player-controlled tank's shells hit *anything* you aim
  at: structures and terrain, and tanks/crew of **either side** (friendly fire).
  AI shells still respect their own team.
- **Large battlefield** — a wide play area (≈300×300 units) with denser terrain
  and multiple river bridges. The camera is clamped to the battlefield so you
  can't pan off into empty space, and zooms out far enough to survey the field.

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
game.appmanifest          Strips the unused physics engine to shrink the build
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

> **Important:** Vercel's build container **cannot build a Defold project** —
> there is no Defold engine there. You must build the HTML5 bundle yourself
> (Defold editor or `bob`) and hand the finished static files to Vercel. If you
> connect the repo to Vercel and just let it "build", it produces empty output
> and every URL returns **404**.

The quickest way to produce the bundle is the **Defold editor**:
`Project → Bundle → HTML5 Application…`. It uses the engine the editor already
has (no `bob` download needed). The result is a folder containing `index.html`,
a `.wasm`, a `.js` loader, and the packed assets.

Then pick one route:

**Option A — deploy the built folder directly (simplest, no repo changes):**

```bash
# after bundling in the editor, or:  ./tools/build_html5.sh
vercel deploy ./dist --prod
```

This uploads the actual static files, independent of any git integration. The
folder you pass must have `index.html` at its top level (the `build_html5.sh`
script flattens Defold's title-named subfolder into `./dist` for exactly this).

**Option B — commit the bundle so the git integration serves it.** If your
Vercel project is connected to GitHub, commit the built bundle into `./dist`
(it is intentionally **not** git-ignored) and push:

```bash
./tools/build_html5.sh          # or copy the editor bundle into ./dist
git add dist && git commit -m "Deploy: update HTML5 bundle" && git push
```

`vercel.json` sets `outputDirectory: dist` with no build step, so Vercel serves
those committed files as-is. Re-run the build and re-commit whenever the game
changes.

**Option C — CI build + deploy on push.** `.github/workflows/build.yml` runs
`build_html5.sh` on every push and, if a `VERCEL_TOKEN` repository secret is
present, deploys the bundle with `vercel deploy ./dist --prod`. This needs the
GitHub runner to reach `d.defold.com` to download `bob`.

`vercel.json` also sets the correct `application/wasm` content type and the
cross-origin isolation headers Defold's WebAssembly runtime prefers.

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
