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
EXPORT_DIR = DIORAMA / "environment"
MANIFEST_PATH = DIORAMA / "asset-manifest.json"
LAYERS_SOURCE = OUT.parent / "living-layers" / "build_living_layers.py"
SPEC = importlib.util.spec_from_file_location("living_layers_kit", LAYERS_SOURCE)
kit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(kit)
kit.EXPORT_DIR = EXPORT_DIR
kit.MAT = {}
kit.ASSETS = {}
kit.CURRENT = None

KEYS = (
    "bank_straight", "bank_corner_inner", "bank_corner_outer", "quay_straight",
    "ground_path", "ground_soil", "ground_fertile", "ground_planted",
    "civic_plaza", "vegetation_reeds", "vegetation_flowers",
    "furniture_bench", "furniture_lamp", "furniture_planter",
)


def new_asset(key):
    kit.new_asset(key)


def reed_clump(x, y, bottom, scale=1.0):
    offsets = ((-0.035, -0.02), (0.025, -0.025), (-0.01, 0.025), (0.045, 0.035), (-0.05, 0.04))
    for index, (dx, dy) in enumerate(offsets):
        height = scale * (0.13 + 0.018 * (index % 3))
        kit.tube("Reed stem", (x + dx, y + dy, bottom), (x + dx * 0.8, y + dy, bottom + height), 0.006, "pine", 7)
        kit.ico("Reed leaf", (x + dx * 0.85, y + dy, bottom + height * 0.55), (0.016, 0.026, height * 0.42), "leaf")


def shore_stones(points):
    # Small stones embedded in the original land, not a second terrain tile.
    for index, (x, y) in enumerate(points):
        obj = kit.ico("Bank limestone", (x, y, 0.018), (0.041, 0.025, 0.028), "mist")
        obj.rotation_euler.z = (index % 3 - 1) * 0.22


def build_bank_straight():
    new_asset("bank_straight")
    # Original terrain: one-unit cells, land Z=0, water Z=-0.0925.
    # Tangent ends meet exactly; the outer face hides the land cliff without
    # adding water or raising the buildable part of the cell.
    kit.box("Bank edge", (0, -0.461, -0.046), (1.0, 0.082, 0.108), "soil")
    shore_stones([(x, -0.455 + 0.008 * (index % 2)) for index, x in enumerate((-0.43, -0.27, -0.10, 0.08, 0.25, 0.42))])


def build_bank_corner_inner():
    new_asset("bank_corner_inner")
    # Union of two identical narrow edge strips: no coplanar overlap at bend.
    outline = [(-0.502, -0.502), (0.5, -0.502), (0.5, -0.42),
               (-0.42, -0.42), (-0.42, 0.5), (-0.502, 0.5)]
    verts = [(x, y, z) for z in (-0.10, 0.008) for x, y in outline]
    faces = [tuple(reversed(range(6))), tuple(range(6, 12))]
    faces += [(i, (i + 1) % 6, (i + 1) % 6 + 6, i + 6) for i in range(6)]
    kit.mesh_object("Inner bank edge", verts, faces, "soil")
    shore_stones([(x, -0.455) for x in (-0.42, -0.22, 0.0, 0.22, 0.42)]
                 + [(-0.455, y) for y in (-0.22, 0.0, 0.22, 0.42)])
    reed_clump(-0.37, -0.37, 0, 0.70)


def build_bank_corner_outer():
    new_asset("bank_corner_outer")
    # Only diagonal water: land remains square. Canonical corner is NE in glTF.
    shore_stones([(0.42, 0.42), (0.32, 0.44), (0.44, 0.31)])
    reed_clump(0.32, 0.31, 0, 0.70)


def build_quay_straight():
    new_asset("quay_straight")
    kit.box("Quay wall", (0, -0.461, -0.046), (1.0, 0.082, 0.108), "ink")
    for index in range(8):
        x = -0.4375 + index * 0.125
        kit.box("Quay coping", (x, -0.461, 0.012), (0.121, 0.082, 0.016), "plaster")


def ground_base(name, mat="soil"):
    kit.box(f"{name} base", (0, 0, 0.02), (0.95, 0.95, 0.04), mat)


def build_ground_path():
    new_asset("ground_path")
    ground_base("Footpath")
    kit.box("Footpath surface", (0, 0, 0.0475), (0.32, 0.95, 0.015), "mist")
    for side in (-1, 1):
        for index in range(6):
            kit.box("Footpath edging", (side * 0.18, -0.395 + index * 0.158, 0.052), (0.035, 0.145, 0.025), "plaster")
    for index in range(5):
        kit.box("Footpath joint", (0, -0.38 + index * 0.19, 0.056), (0.30, 0.008, 0.006), "patina")


def build_ground_soil():
    new_asset("ground_soil")
    ground_base("Bare soil")
    for index, (x, y) in enumerate(((-0.31, -0.25), (0.23, -0.31), (-0.08, 0.12), (0.32, 0.26), (-0.34, 0.33))):
        kit.ico("Soil clod", (x, y, 0.052), (0.035, 0.026, 0.016), "wood" if index % 2 else "soil")


def furrows(planted):
    for row, x in enumerate((-0.30, -0.10, 0.10, 0.30)):
        kit.box("Cultivated furrow", (x, 0, 0.0475), (0.095, 0.82, 0.025), "soil")
        kit.box("Fertile ridge", (x - 0.055, 0, 0.044), (0.018, 0.84, 0.02), "wood")
        if planted:
            for y in (-0.30, -0.10, 0.10, 0.30):
                kit.ico("Crop leaves", (x, y, 0.09), (0.038, 0.032, 0.045), "pine" if row % 2 else "leaf")
                kit.tube("Crop stem", (x, y, 0.055), (x, y, 0.12), 0.006, "pine", 7)


def build_ground_fertile():
    new_asset("ground_fertile")
    ground_base("Fertile soil")
    furrows(False)


def build_ground_planted():
    new_asset("ground_planted")
    ground_base("Planted soil")
    furrows(True)


def build_civic_plaza():
    new_asset("civic_plaza")
    ground_base("Civic plaza", "mist")
    for offset in (-0.30, -0.15, 0, 0.15, 0.30):
        kit.box("Plaza paving joint", (offset, 0, 0.043), (0.008, 0.92, 0.006), "patina")
        kit.box("Plaza paving joint", (0, offset, 0.043), (0.92, 0.008, 0.006), "patina")
    kit.cylinder("Plaza medallion", (0, 0, 0.052), 0.23, 0.018, "plum", 32)
    kit.cylinder("Plaza medallion inset", (0, 0, 0.064), 0.145, 0.012, "ochre", 24)
    for x in (-0.39, 0.39):
        for y in (-0.39, 0.39):
            kit.box("Plaza corner stone", (x, y, 0.052), (0.10, 0.10, 0.018), "plaster")


def build_vegetation_reeds():
    new_asset("vegetation_reeds")
    # Thin line of roots placed 0.42 toward water by the renderer. No soil bed:
    # every stem is planted in the real land, never on a floating brown square.
    for x, y, scale in ((-0.25, 0.005, 1.0), (-0.05, -0.005, 0.85), (0.22, 0, 1.15)):
        reed_clump(x, y, 0, scale)


def build_vegetation_flowers():
    new_asset("vegetation_flowers")
    kit.box("Flower meadow", (0, 0, 0.015), (0.85, 0.85, 0.03), "pine")
    points = ((-0.28, -0.27), (-0.05, -0.30), (0.22, -0.25), (-0.32, -0.02), (-0.10, 0), (0.14, -0.03), (0.32, 0.05), (-0.25, 0.25), (0.02, 0.27), (0.27, 0.29))
    for index, (x, y) in enumerate(points):
        height = 0.09 + 0.015 * (index % 3)
        kit.tube("Flower stem", (x, y, 0.03), (x, y, height), 0.005, "pine", 7)
        kit.ico("Flower leaves", (x, y, 0.065), (0.035, 0.026, 0.025), "leaf")
        kit.ico("Flower bloom", (x, y, height + 0.015), (0.025, 0.025, 0.018), "plum" if index % 3 else "ochre")


def build_furniture_bench():
    new_asset("furniture_bench")
    for x in (-0.26, 0.26):
        for y in (-0.10, 0.10):
            kit.box("Bench leg", (x, y, 0.09), (0.035, 0.035, 0.18), "ink")
        kit.box("Bench back post", (x, 0.12, 0.25), (0.03, 0.03, 0.34), "ink")
    for y in (-0.105, -0.035, 0.035, 0.105):
        kit.box("Bench seat slat", (0, y, 0.19), (0.68, 0.055, 0.025), "wood")
    for z in (0.29, 0.37):
        kit.box("Bench back slat", (0, 0.13, z), (0.68, 0.025, 0.055), "wood")
    for x in (-0.32, 0.32):
        kit.box("Bench armrest", (x, 0, 0.29), (0.035, 0.29, 0.025), "ochre")


def build_furniture_lamp():
    new_asset("furniture_lamp")
    kit.cylinder("Lamp foot", (0, 0, 0.025), 0.09, 0.05, "ink", 16)
    kit.cylinder("Lamp post", (0, 0, 0.28), 0.025, 0.48, "ink", 12)
    kit.cylinder("Lamp brass collar", (0, 0, 0.49), 0.045, 0.05, "ochre", 12)
    kit.box("Lamp glass", (0, 0, 0.565), (0.14, 0.14, 0.15), "glass")
    for x in (-0.075, 0.075):
        for y in (-0.075, 0.075):
            kit.box("Lamp frame", (x, y, 0.565), (0.015, 0.015, 0.17), "ink")
    kit.box("Lamp lower frame", (0, 0, 0.485), (0.17, 0.17, 0.025), "ochre")
    kit.cylinder("Lamp cap", (0, 0, 0.66), 0.115, 0.04, "ink", 16, radius_top=0.035)
    kit.cylinder("Lamp finial", (0, 0, 0.70), 0.018, 0.055, "ochre", 10)


def build_furniture_planter():
    new_asset("furniture_planter")
    kit.box("Planter body", (0, 0, 0.10), (0.50, 0.50, 0.20), "plum")
    kit.box("Planter rim", (0, 0, 0.215), (0.58, 0.58, 0.05), "patina")
    kit.box("Planter soil", (0, 0, 0.245), (0.47, 0.47, 0.02), "soil")
    for index, (x, y) in enumerate(((-0.13, -0.12), (0.12, -0.10), (-0.10, 0.13), (0.14, 0.14), (0, 0))):
        kit.ico("Planter foliage", (x, y, 0.32 + 0.025 * (index % 2)), (0.13, 0.12, 0.11), "pine" if index % 2 else "leaf")
        if index in (1, 3):
            kit.ico("Planter flower", (x, y, 0.43), (0.035, 0.035, 0.025), "ochre")


def validate_glb(key):
    path = EXPORT_DIR / f"{key}.glb"
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
    shoreline = key.startswith("bank_") or key == "quay_straight"
    limit = 0.5021 if shoreline else 0.4751
    for axis in (0, 2):
        assert minimum[axis] >= -limit and maximum[axis] <= limit, f"{key}: footprint {minimum}, {maximum}"
    if shoreline:
        assert minimum[1] >= -0.1001 and maximum[1] <= 0.20, f"{key}: shoreline height {minimum}, {maximum}"
        assert not any(mat.get("name") == "water" for mat in document["materials"]), key
    elif key == "vegetation_reeds":
        assert abs(minimum[1]) <= 0.001, f"{key}: root Y {minimum[1]}"
        assert not any(mat.get("name") == "soil" for mat in document["materials"]), key
    else:
        assert abs(minimum[1]) <= 0.0001, f"{key}: base Y {minimum[1]}"
    assert maximum[1] > 0.01, f"{key}: empty height"
    triangles = 0
    for mesh in document["meshes"]:
        for primitive in mesh["primitives"]:
            if "indices" in primitive:
                triangles += document["accessors"][primitive["indices"]]["count"] // 3
    assert triangles <= 8000, f"{key}: {triangles} triangles"
    assert len(document["meshes"]) <= 20, f"{key}: {len(document['meshes'])} meshes"
    assert len(raw) <= 384 * 1024, f"{key}: {len(raw)} bytes"
    print(f"VALID {key:24s} {len(raw) / 1024:7.1f} KiB {len(document['meshes']):2d} meshes {triangles:5d} tris XYZ {dims[0]:.3f}/{dims[1]:.3f}/{dims[2]:.3f}", flush=True)
    return len(raw), triangles


def update_manifest():
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    manifest["environment"] = {"modules": {key: {"file": f"environment/{key}.glb"} for key in KEYS}}
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def point_camera(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def create_preview():
    scene = bpy.data.scenes.new("Environment assembly check")
    bpy.context.window.scene = scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1500
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world = bpy.data.worlds.new("Environment world")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = kit.color("DFE5E2")
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.75
    collection = bpy.data.collections.new("Environment preview")
    scene.collection.children.link(collection)
    kit.CURRENT = collection
    for index, key in enumerate(KEYS):
        row, col = divmod(index, 4)
        x, y = (col - 1.5) * 1.16, (1.5 - row) * 1.16
        obj = bpy.data.objects.new(key, None)
        obj.instance_type = "COLLECTION"
        obj.instance_collection = kit.ASSETS[key]
        obj.location = (x, y, 0)
        collection.objects.link(obj)
        kit.box("Environment preview tile", (x, y, -0.025), (1.02, 1.02, 0.04), "plaster")
    kit.box("Environment preview ground", (0, 0, -0.065), (200, 200, 0.06), "mist")
    camera_data = bpy.data.cameras.new("Environment camera")
    camera = bpy.data.objects.new("Environment camera", camera_data)
    collection.objects.link(camera)
    camera.location = (5.7, -7.8, 6.5)
    point_camera(camera, (0, 0, 0.08))
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 6.2
    scene.camera = camera
    for name, loc, energy, size, tint in (("Key", (-3, -4, 7), 900, 5, "FFE4C4"), ("Fill", (4, 2, 6), 650, 5, "C5E0EA")):
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
    scene.render.filepath = str(DIORAMA / "environment-preview.png")
    bpy.ops.render.render(write_still=True, scene=scene.name)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    kit.make_palette()
    for builder in (
        build_bank_straight, build_bank_corner_inner, build_bank_corner_outer, build_quay_straight,
        build_ground_path, build_ground_soil, build_ground_fertile, build_ground_planted,
        build_civic_plaza, build_vegetation_reeds, build_vegetation_flowers,
        build_furniture_bench, build_furniture_lamp, build_furniture_planter,
    ):
        builder()
    assert len(KEYS) == 14 and set(KEYS) == set(kit.ASSETS)
    for key in KEYS:
        print(f"EXPORT {key}", flush=True)
        kit.export_asset(key)
    stats = [validate_glb(key) for key in KEYS]
    update_manifest()
    print(f"SUMMARY {len(KEYS)} environment modules, {sum(item[0] for item in stats) / 1024:.1f} KiB, {sum(item[1] for item in stats)} triangles", flush=True)
    if "--skip-render" not in sys.argv:
        create_preview()
    print(f"ENVIRONMENT READY {EXPORT_DIR}", flush=True)


if __name__ == "__main__":
    main()
