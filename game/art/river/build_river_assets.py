from __future__ import annotations

import importlib.util
import json
import math
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Vector

OUT = Path(__file__).resolve().parent
DIORAMA = OUT.parent / "diorama"
MANIFEST_PATH = DIORAMA / "asset-manifest.json"
LAYERS_SOURCE = OUT.parent / "living-layers" / "build_living_layers.py"
SPEC = importlib.util.spec_from_file_location("living_layers_river_kit", LAYERS_SOURCE)
kit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(kit)
kit.EXPORT_DIR = DIORAMA
kit.MAT = {}
kit.ASSETS = {}
kit.CURRENT = None

ASSET_KEYS = ("river_quay", "river_barge", "river_cargo_food", "river_cargo_water")


def new_asset(key):
    kit.new_asset(key)


def torus(name, loc, major, minor, mat, rot=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=16, minor_segments=6, location=loc, rotation=rot or (0, 0, 0))
    obj = bpy.context.object
    kit.move_to_current(obj)
    return kit.finish(obj, name, mat)


def crate(name, center, dims):
    x, y, z = center
    width, depth, height = dims
    kit.box(f"{name} body", center, dims, "weathered_wood")
    for side in (-1, 1):
        kit.box(f"{name} vertical batten", (x + side * (width / 2 - 0.018), y - depth / 2 - 0.008, z), (0.025, 0.016, height), "wood")
        kit.box(f"{name} side batten", (x - width / 2 - 0.008, y + side * (depth / 2 - 0.018), z), (0.016, 0.025, height), "wood")
    for dz in (-height * 0.30, height * 0.30):
        kit.box(f"{name} face slat", (x, y - depth / 2 - 0.012, z + dz), (width, 0.018, 0.018), "copper")
    kit.box(f"{name} lid", (x, y, z + height / 2 + 0.009), (width + 0.015, depth + 0.015, 0.018), "wood")
    kit.box(f"{name} food mark", (x, y - depth / 2 - 0.023, z), (0.045, 0.008, 0.045), "ochre", rot=(0, math.pi / 4, 0))


def barrel(name, x, y, bottom=0.0, radius=0.075, height=0.19):
    center = bottom + height / 2
    kit.cylinder(f"{name} staves", (x, y, center), radius, height, "weathered_wood", 16, radius_top=radius * 0.94)
    for z in (bottom + 0.025, bottom + height * 0.50, bottom + height - 0.025):
        kit.cylinder(f"{name} copper hoop", (x, y, z), radius + 0.005, 0.016, "copper", 16)
    kit.cylinder(f"{name} lid", (x, y, bottom + height + 0.005), radius * 0.90, 0.012, "wood", 16)
    kit.cylinder(f"{name} bung", (x + 0.018, y, bottom + height + 0.015), 0.013, 0.012, "ochre", 10)
    for index in range(8):
        angle = math.tau * index / 8
        sx, sy = x + math.cos(angle) * (radius + 0.001), y + math.sin(angle) * (radius + 0.001)
        kit.tube(f"{name} stave joint", (sx, sy, bottom + 0.035), (sx, sy, bottom + height - 0.035), 0.0025, "wood", 6)


def build_river_quay():
    new_asset("river_quay")
    kit.box("Quay land foundation", (0, 0.245, 0.05), (0.90, 0.45, 0.10), "soil")
    kit.box("Quay land paving", (0, 0.245, 0.115), (0.90, 0.44, 0.03), "mist")
    for x in (-0.28, 0.28):
        kit.box("Dock longitudinal beam", (x, -0.14, 0.145), (0.055, 0.64, 0.07), "ink")
    for index in range(10):
        y = -0.425 + index * 0.062
        kit.box("Dock deck board", (0, y, 0.19), (0.70, 0.052, 0.035), "weathered_wood")
        for x in (-0.27, 0.27):
            kit.cylinder("Deck iron nail", (x, y, 0.209), 0.006, 0.004, "ink", 8)
    for x in (-0.29, 0.29):
        for y in (-0.39, -0.13, 0.10):
            kit.cylinder("Dock pile", (x, y, 0.10), 0.035, 0.20, "wood", 12)
            kit.cylinder("Dock pile cap", (x, y, 0.215), 0.042, 0.035, "copper", 12)
    for x in (-0.25, 0.25):
        kit.cylinder("Mooring bollard", (x, -0.34, 0.255), 0.022, 0.10, "ink", 12)
        kit.tube("Mooring bollard cross", (x - 0.035, -0.34, 0.285), (x + 0.035, -0.34, 0.285), 0.012, "ochre", 10)
    for x in (0.02, 0.36):
        for y in (0.13, 0.37):
            kit.box("Loading shelter post", (x, y, 0.32), (0.035, 0.035, 0.40), "wood")
            kit.box("Loading shelter foot", (x, y, 0.14), (0.065, 0.065, 0.04), "ink")
    kit.box("Shelter lintel", (0.19, 0.13, 0.51), (0.43, 0.045, 0.05), "ink")
    kit.box("Shelter rear beam", (0.19, 0.37, 0.51), (0.43, 0.045, 0.05), "ink")
    roof_vertices = [
        (-0.055, 0.075, 0.53), (0.435, 0.075, 0.53), (0.435, 0.425, 0.53), (-0.055, 0.425, 0.53),
        (-0.055, 0.25, 0.66), (0.435, 0.25, 0.66),
    ]
    kit.mesh_object("Shelter copper roof", roof_vertices, [(0, 1, 4), (1, 2, 5, 4), (2, 3, 5), (3, 0, 4, 5), (0, 3, 2, 1)], "copper")
    for x in (0.02, 0.19, 0.36):
        kit.tube("Shelter roof seam", (x, 0.075, 0.535), (x, 0.25, 0.665), 0.007, "ink", 8)
        kit.tube("Shelter roof seam", (x, 0.25, 0.665), (x, 0.425, 0.535), 0.007, "ink", 8)
    kit.box("Winch upright", (-0.23, -0.14, 0.39), (0.05, 0.05, 0.38), "ink")
    kit.beam("Winch boom", (-0.23, -0.14, 0.57), (-0.23, -0.42, 0.57), 0.04, "weathered_wood")
    kit.beam("Winch brace", (-0.23, -0.14, 0.43), (-0.23, -0.34, 0.57), 0.025, "ochre")
    kit.cylinder("Winch drum", (-0.23, -0.14, 0.40), 0.055, 0.12, "copper", 16, rot=(0, math.pi / 2, 0))
    kit.tube("Winch crank", (-0.30, -0.14, 0.40), (-0.30, -0.14, 0.46), 0.012, "ochre", 10)
    kit.tube("Winch crank handle", (-0.30, -0.14, 0.46), (-0.34, -0.14, 0.46), 0.014, "wood", 10)
    kit.tube("Winch cable", (-0.23, -0.405, 0.56), (-0.23, -0.405, 0.31), 0.006, "ink", 8)
    torus("Winch hook", (-0.23, -0.405, 0.29), 0.022, 0.006, "ochre", rot=(math.pi / 2, 0, 0))
    crate("Quay loading crate", (0.16, 0.25, 0.22), (0.18, 0.18, 0.18))


def build_river_barge():
    new_asset("river_barge")
    outline = [(-0.38, -0.15), (-0.29, -0.21), (0.19, -0.21), (0.38, 0), (0.19, 0.21), (-0.29, 0.21), (-0.38, 0.15)]
    verts = [(x * 0.84, y * 0.82, 0) for x, y in outline] + [(x, y, 0.10) for x, y in outline]
    count = len(outline)
    faces = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
    faces.extend((index, (index + 1) % count, (index + 1) % count + count, index + count) for index in range(count))
    kit.mesh_object("Barge ink hull", verts, faces, "ink")
    kit.mesh_object("Barge wooden deck", [(x * 0.93, y * 0.91, 0.104) for x, y in outline], [tuple(range(count))], "weathered_wood")
    for index, start in enumerate(outline):
        end = outline[(index + 1) % count]
        kit.tube("Barge copper gunwale", (*start, 0.125), (*end, 0.125), 0.014, "copper", 10)
    for y in (-0.12, -0.06, 0, 0.06, 0.12):
        kit.box("Barge deck plank", (-0.055, y, 0.111), (0.49, 0.008, 0.008), "wood")
    for x in (-0.25, 0.20):
        for y in (-0.13, 0.13):
            kit.box("Cargo deck socket", (x, y, 0.125), (0.035, 0.035, 0.025), "ochre")
    kit.box("Barge stern tiller", (-0.29, 0, 0.19), (0.035, 0.035, 0.15), "wood", rot=(0, -0.20, 0))
    kit.tube("Barge tiller handle", (-0.29, 0, 0.25), (-0.36, 0, 0.25), 0.012, "ochre", 10)
    kit.tube("Barge bow cleat", (0.25, -0.04, 0.15), (0.25, 0.04, 0.15), 0.012, "ochre", 10)


def build_river_cargo_food():
    new_asset("river_cargo_food")
    crate("Food crate large", (-0.09, -0.025, 0.085), (0.20, 0.23, 0.17))
    crate("Food crate small", (0.105, 0.025, 0.07), (0.15, 0.18, 0.14))
    crate("Food crate upper", (-0.075, -0.01, 0.225), (0.16, 0.18, 0.11))


def build_river_cargo_water():
    new_asset("river_cargo_water")
    barrel("Water barrel one", -0.105, -0.065)
    barrel("Water barrel two", 0.075, -0.055, radius=0.072, height=0.18)
    barrel("Water barrel three", -0.005, 0.105, radius=0.070, height=0.175)


def validate_glb(key):
    path = DIORAMA / f"{key}.glb"
    raw = path.read_bytes()
    magic, version, total_length = struct.unpack_from("<4sII", raw, 0)
    assert magic == b"glTF" and version == 2 and total_length == len(raw), key
    json_length, chunk_type = struct.unpack_from("<II", raw, 12)
    assert chunk_type == 0x4E4F534A, key
    document = json.loads(raw[20:20 + json_length].decode("utf-8"))
    assert document.get("meshes") and document.get("materials"), key
    assert not any("uri" in item for item in document.get("images", [])), key
    assert not any("uri" in item for item in document.get("buffers", [])), key
    minimum, maximum = kit.glb_bounds(document)
    dims = [maximum[i] - minimum[i] for i in range(3)]
    limit = 0.95 if key == "river_quay" else 0.80 if key == "river_barge" else 0.45
    centered = limit / 2 + 0.0001
    assert dims[0] <= limit + 0.0001 and dims[2] <= limit + 0.0001, f"{key}: footprint {dims}"
    assert minimum[0] >= -centered and maximum[0] <= centered, f"{key}: X bounds"
    assert minimum[2] >= -centered and maximum[2] <= centered, f"{key}: Z bounds"
    assert abs(minimum[1]) <= 0.0001, f"{key}: base Y {minimum[1]}"
    if key == "river_barge":
        assert maximum[1] <= 0.30, f"{key}: barge too tall {maximum[1]}"
    elif key == "river_quay":
        assert 0.45 <= maximum[1] <= 0.85, f"{key}: unexpected quay height {maximum[1]}"
    else:
        assert maximum[1] <= 0.35, f"{key}: cargo too tall {maximum[1]}"
    triangles = 0
    for mesh in document["meshes"]:
        for primitive in mesh["primitives"]:
            if "indices" in primitive:
                triangles += document["accessors"][primitive["indices"]]["count"] // 3
    assert triangles <= 8000, f"{key}: {triangles} triangles"
    assert len(document["meshes"]) <= 16, f"{key}: {len(document['meshes'])} meshes"
    assert len(raw) <= 384 * 1024, f"{key}: {len(raw)} bytes"
    print(f"VALID {key:20s} {len(raw) / 1024:7.1f} KiB {len(document['meshes']):2d} meshes {triangles:5d} tris XYZ {dims[0]:.3f}/{dims[1]:.3f}/{dims[2]:.3f}", flush=True)
    return maximum[1], len(raw), triangles


def update_manifest(quay_height):
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    manifest["models"]["river_quay"] = {"file": "river_quay.glb", "footprint": 0.95, "height": round(quay_height, 3)}
    manifest["riverAssets"] = {
        "barge": {"file": "river_barge.glb"},
        "cargoFood": {"file": "river_cargo_food.glb"},
        "cargoWater": {"file": "river_cargo_water.glb"},
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def point_camera(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def create_preview():
    scene = bpy.data.scenes.new("River assets check")
    bpy.context.window.scene = scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1700
    scene.render.resolution_y = 1150
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world = bpy.data.worlds.new("River world")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = kit.color("DFE5E2")
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.75
    collection = bpy.data.collections.new("River preview")
    scene.collection.children.link(collection)
    kit.CURRENT = collection
    positions = {"river_quay": (-0.85, 0.30, 0), "river_barge": (0.65, -0.40, 0.03), "river_cargo_food": (0.20, 0.70, 0), "river_cargo_water": (0.85, 0.70, 0)}
    for key, location in positions.items():
        obj = bpy.data.objects.new(key, None)
        obj.instance_type = "COLLECTION"
        obj.instance_collection = kit.ASSETS[key]
        obj.location = location
        collection.objects.link(obj)
    kit.box("River preview water", (0.25, -0.65, -0.025), (2.5, 1.20, 0.04), "water")
    kit.box("River preview land", (-0.85, 0.55, -0.03), (1.20, 1.10, 0.05), "mist")
    kit.box("Cargo preview pad", (0.52, 0.70, -0.025), (1.25, 0.65, 0.04), "plaster")
    camera_data = bpy.data.cameras.new("River camera")
    camera = bpy.data.objects.new("River camera", camera_data)
    collection.objects.link(camera)
    camera.location = (3.2, -4.8, 3.5)
    point_camera(camera, (0, 0, 0.18))
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 3.9
    scene.camera = camera
    for name, loc, energy, size, tint in (("Key", (-3, -4, 6), 700, 4, "FFE4C4"), ("Fill", (4, 2, 5), 500, 4, "C5E0EA")):
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light_data.color = kit.color(tint)[:3]
        light = bpy.data.objects.new(name, light_data)
        collection.objects.link(light)
        light.location = loc
        point_camera(light, (0, 0, 0.2))
    scene.view_settings.view_transform = "Standard"
    scene.render.filepath = str(DIORAMA / "river-preview.png")
    bpy.ops.render.render(write_still=True, scene=scene.name)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    kit.make_palette()
    kit.make_material("weathered_wood", "756F60", 0.88, 0.0)
    kit.make_material("copper", "4F9DA6", 0.58, 0.28)
    for builder in (build_river_quay, build_river_barge, build_river_cargo_food, build_river_cargo_water):
        builder()
    assert set(ASSET_KEYS) == set(kit.ASSETS)
    stats = {}
    for key in ASSET_KEYS:
        print(f"EXPORT {key}", flush=True)
        kit.export_asset(key)
        stats[key] = validate_glb(key)
    update_manifest(stats["river_quay"][0])
    print(f"SUMMARY 4 river assets, {sum(item[1] for item in stats.values()) / 1024:.1f} KiB, {sum(item[2] for item in stats.values())} triangles", flush=True)
    if "--skip-render" not in sys.argv:
        create_preview()
    print("RIVER ASSETS READY", flush=True)


if __name__ == "__main__":
    main()
