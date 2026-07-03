#!/usr/bin/env python3
"""
Procedural asset generator for the WWII Tanks Defold project.

Produces:
  - Low-poly Collada (.dae) meshes with flat (per-face) normals and texcoords,
    which the Defold model importer consumes directly.
  - Solid-colour PNG textures (stdlib only, no Pillow) used by the built-in
    Defold model material's `tex0` sampler.

Coordinate convention (matches the Defold runtime scripts):
  - Y is up.
  - +Z is "forward" for a tank hull / turret barrel.
  - Origins are chosen so game objects parent cleanly (hull sits on the ground
    plane at y=0; the turret pivot is at its own local origin).
"""

import base64
import json
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# --------------------------------------------------------------------------
# PNG writer (solid colour, stdlib only)
# --------------------------------------------------------------------------
def write_png(path, rgb, size=8):
    r, g, b = rgb
    # One row of RGBA pixels, prefixed with the PNG filter byte (0 = none).
    row = b"\x00" + bytes([r, g, b, 255]) * size
    raw = row * size
    comp = zlib.compress(raw, 9)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        c += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        return c

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # RGBA, 8-bit
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", ihdr)
    png += chunk(b"IDAT", comp)
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", os.path.relpath(path, ROOT))


# --------------------------------------------------------------------------
# Collada writer
# --------------------------------------------------------------------------
# A "box" is (cx, cy, cz, sx, sy, sz): centre + full extents.
# Each box contributes 24 unique vertices (flat shading) and 12 triangles.

# Face definition: 4 corner offsets (unit cube -0.5..0.5) + outward normal.
_FACES = [
    # +X
    ([(0.5, -0.5, -0.5), (0.5, 0.5, -0.5), (0.5, 0.5, 0.5), (0.5, -0.5, 0.5)], (1, 0, 0)),
    # -X
    ([(-0.5, -0.5, 0.5), (-0.5, 0.5, 0.5), (-0.5, 0.5, -0.5), (-0.5, -0.5, -0.5)], (-1, 0, 0)),
    # +Y
    ([(-0.5, 0.5, -0.5), (-0.5, 0.5, 0.5), (0.5, 0.5, 0.5), (0.5, 0.5, -0.5)], (0, 1, 0)),
    # -Y
    ([(-0.5, -0.5, 0.5), (-0.5, -0.5, -0.5), (0.5, -0.5, -0.5), (0.5, -0.5, 0.5)], (0, -1, 0)),
    # +Z
    ([(-0.5, -0.5, 0.5), (0.5, -0.5, 0.5), (0.5, 0.5, 0.5), (-0.5, 0.5, 0.5)], (0, 0, 1)),
    # -Z
    ([(0.5, -0.5, -0.5), (-0.5, -0.5, -0.5), (-0.5, 0.5, -0.5), (0.5, 0.5, -0.5)], (0, 0, -1)),
]


def box_geometry(boxes):
    """Return (positions, normals, texcoords, indices) for a list of boxes."""
    positions, normals, texcoords, indices = [], [], [], []
    idx = 0
    for (cx, cy, cz, sx, sy, sz) in boxes:
        for corners, n in _FACES:
            base = idx
            for (ox, oy, oz) in corners:
                positions.append((cx + ox * sx, cy + oy * sy, cz + oz * sz))
                normals.append(n)
            # simple planar UVs for the four corners
            texcoords.extend([(0, 0), (1, 0), (1, 1), (0, 1)])
            indices.extend([base, base + 1, base + 2, base, base + 2, base + 3])
            idx += 4
    return positions, normals, texcoords, indices


_DAE_TEMPLATE = """<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset>
    <up_axis>Y_UP</up_axis>
  </asset>
  <library_geometries>
    <geometry id="{name}-mesh" name="{name}">
      <mesh>
        <source id="{name}-positions">
          <float_array id="{name}-positions-array" count="{npos}">{positions}</float_array>
          <technique_common>
            <accessor source="#{name}-positions-array" count="{nvert}" stride="3">
              <param name="X" type="float"/>
              <param name="Y" type="float"/>
              <param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <source id="{name}-normals">
          <float_array id="{name}-normals-array" count="{nnorm}">{normals}</float_array>
          <technique_common>
            <accessor source="#{name}-normals-array" count="{nvert}" stride="3">
              <param name="X" type="float"/>
              <param name="Y" type="float"/>
              <param name="Z" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <source id="{name}-texcoords">
          <float_array id="{name}-texcoords-array" count="{ntex}">{texcoords}</float_array>
          <technique_common>
            <accessor source="#{name}-texcoords-array" count="{nvert}" stride="2">
              <param name="S" type="float"/>
              <param name="T" type="float"/>
            </accessor>
          </technique_common>
        </source>
        <vertices id="{name}-vertices">
          <input semantic="POSITION" source="#{name}-positions"/>
        </vertices>
        <triangles count="{ntri}">
          <input semantic="VERTEX" source="#{name}-vertices" offset="0"/>
          <input semantic="NORMAL" source="#{name}-normals" offset="1"/>
          <input semantic="TEXCOORD" source="#{name}-texcoords" offset="2" set="0"/>
          <p>{indices}</p>
        </triangles>
      </mesh>
    </geometry>
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="Scene" name="Scene">
      <node id="{name}-node" name="{name}" type="NODE">
        <matrix sid="transform">1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1</matrix>
        <instance_geometry url="#{name}-mesh"/>
      </node>
    </visual_scene>
  </library_visual_scenes>
  <scene>
    <instance_visual_scene url="#Scene"/>
  </scene>
</COLLADA>
"""


def write_dae(path, name, boxes):
    positions, normals, texcoords, indices = box_geometry(boxes)
    nvert = len(positions)
    ntri = len(indices) // 3

    def flat(seq):
        out = []
        for t in seq:
            out.extend(t)
        return " ".join("{:.4f}".format(v) for v in out)

    # interleaved index list: vertex/normal/texcoord all share the same index
    p = []
    for i in indices:
        p.extend([i, i, i])

    xml = _DAE_TEMPLATE.format(
        name=name,
        positions=flat(positions),
        normals=flat(normals),
        texcoords=flat(texcoords),
        indices=" ".join(str(v) for v in p),
        npos=nvert * 3,
        nnorm=nvert * 3,
        ntex=nvert * 2,
        nvert=nvert,
        ntri=ntri,
    )
    with open(path, "w") as f:
        f.write(xml)
    print("wrote", os.path.relpath(path, ROOT), "({} tris)".format(ntri))


# --------------------------------------------------------------------------
# glTF 2.0 writer (self-contained, base64 embedded buffer)
# --------------------------------------------------------------------------
def write_gltf(path, name, boxes):
    positions, normals, texcoords, indices = box_geometry(boxes)
    nvert = len(positions)
    nidx = len(indices)

    # pack a single binary blob: indices (u16, padded to 4) then float arrays
    idx_bytes = b"".join(struct.pack("<H", i) for i in indices)
    while len(idx_bytes) % 4 != 0:
        idx_bytes += b"\x00"
    pos_bytes = b"".join(struct.pack("<fff", *p) for p in positions)
    nrm_bytes = b"".join(struct.pack("<fff", *n) for n in normals)
    tex_bytes = b"".join(struct.pack("<ff", *t) for t in texcoords)

    pos_ofs = len(idx_bytes)
    nrm_ofs = pos_ofs + len(pos_bytes)
    tex_ofs = nrm_ofs + len(nrm_bytes)
    blob = idx_bytes + pos_bytes + nrm_bytes + tex_bytes

    xs = [p[0] for p in positions]
    ys = [p[1] for p in positions]
    zs = [p[2] for p in positions]

    gltf = {
        "asset": {"version": "2.0", "generator": "wwiitanks-gen"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "meshes": [{
            "name": name,
            "primitives": [{
                "attributes": {"POSITION": 1, "NORMAL": 2, "TEXCOORD_0": 3},
                "indices": 0,
                "mode": 4,
            }],
        }],
        "buffers": [{
            "byteLength": len(blob),
            "uri": "data:application/octet-stream;base64," +
                   base64.b64encode(blob).decode("ascii"),
        }],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0,       "byteLength": len(idx_bytes), "target": 34963},
            {"buffer": 0, "byteOffset": pos_ofs, "byteLength": len(pos_bytes), "target": 34962},
            {"buffer": 0, "byteOffset": nrm_ofs, "byteLength": len(nrm_bytes), "target": 34962},
            {"buffer": 0, "byteOffset": tex_ofs, "byteLength": len(tex_bytes), "target": 34962},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5123, "count": nidx, "type": "SCALAR"},
            {"bufferView": 1, "componentType": 5126, "count": nvert, "type": "VEC3",
             "min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]},
            {"bufferView": 2, "componentType": 5126, "count": nvert, "type": "VEC3"},
            {"bufferView": 3, "componentType": 5126, "count": nvert, "type": "VEC2"},
        ],
    }
    with open(path, "w") as f:
        json.dump(gltf, f)
    print("wrote", os.path.relpath(path, ROOT), "({} tris, glTF)".format(nidx // 3))


# --------------------------------------------------------------------------
# Asset definitions
# --------------------------------------------------------------------------
def main():
    tex = os.path.join(ROOT, "textures")
    tanks = os.path.join(ROOT, "tanks")
    props = os.path.join(ROOT, "props")

    # ---- textures -------------------------------------------------------
    write_png(os.path.join(tex, "olive.png"), (74, 88, 52))       # US olive drab
    write_png(os.path.join(tex, "grey.png"), (96, 100, 104))      # German panzer grey
    write_png(os.path.join(tex, "track.png"), (38, 38, 40))       # dark tracks
    write_png(os.path.join(tex, "ground.png"), (86, 104, 58))     # battlefield grass
    write_png(os.path.join(tex, "dirt.png"), (108, 88, 60))       # cover / craters
    write_png(os.path.join(tex, "shell.png"), (222, 190, 70))     # tracer shell
    write_png(os.path.join(tex, "fire.png"), (230, 120, 40))      # explosion

    # Emit both Collada (.dae, legacy) and glTF (.gltf, preferred by modern
    # Defold). The .model files reference the .gltf; the .dae is kept as a
    # drop-in fallback for older editors.
    def emit(subdir, name, boxes):
        write_dae(os.path.join(subdir, name + ".dae"), name, boxes)
        write_gltf(os.path.join(subdir, name + ".gltf"), name, boxes)

    # ---- hull (shared shape for both factions) --------------------------
    # Origin at ground contact (y=0). Forward is +Z.
    hull_boxes = [
        (0.0, 0.40, 0.00, 2.00, 0.50, 3.00),   # lower hull
        (0.0, 0.78, 0.15, 1.55, 0.34, 2.30),   # upper hull / superstructure
        (0.0, 0.85, 1.35, 1.20, 0.28, 0.60),   # sloped front glacis block
        (-1.02, 0.32, 0.0, 0.42, 0.64, 3.25),  # left track
        (1.02, 0.32, 0.0, 0.42, 0.64, 3.25),   # right track
    ]
    emit(tanks, "hull", hull_boxes)

    # ---- US turret (Sherman-ish: rounded-ish blocky turret, long barrel) -
    us_turret = [
        (0.0, 0.28, 0.00, 1.35, 0.55, 1.45),   # turret body
        (0.0, 0.30, 1.30, 0.20, 0.20, 2.00),   # main gun barrel (+Z)
        (0.0, 0.60, -0.35, 0.35, 0.20, 0.35),  # commander cupola
    ]
    emit(tanks, "turret_us", us_turret)

    # ---- German turret (Panzer/Tiger-ish: boxier, thicker barrel) --------
    de_turret = [
        (0.0, 0.30, 0.00, 1.55, 0.58, 1.55),   # turret body
        (0.0, 0.30, 1.45, 0.26, 0.26, 2.30),   # main gun barrel (+Z)
        (0.0, 0.62, -0.45, 0.40, 0.22, 0.40),  # cupola
    ]
    emit(tanks, "turret_de", de_turret)

    # ---- shell / projectile --------------------------------------------
    emit(props, "shell", [(0.0, 0.0, 0.0, 0.18, 0.18, 0.45)])

    # ---- explosion primitive (unit cube, scaled at runtime) -------------
    emit(props, "blast", [(0.0, 0.0, 0.0, 1.0, 1.0, 1.0)])

    # ---- ground plane (large flat slab) --------------------------------
    emit(props, "ground", [(0.0, -0.1, 0.0, 200.0, 0.2, 200.0)])

    # ---- cover / obstacle block ----------------------------------------
    emit(props, "cover", [(0.0, 0.75, 0.0, 3.0, 1.5, 3.0)])


if __name__ == "__main__":
    main()
