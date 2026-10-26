from __future__ import annotations

import json
import math
import random
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Vector

OUT = Path(__file__).resolve().parent
RNG = random.Random(20261024)
TAU = math.tau
CURRENT = None
MAT = {}
ASSETS = {}

COLS = 16
ROWS = 12
MODEL_IDS = ("house", "well", "farm", "workshop", "market", "generator", "park")
NEW_MODEL_IDS = ("path", "road", "factory", "warehouse", "water_plant", "tower", "depot", "tram", "maint_center", "greenhouse", "recycler")
CATALOG_IDS = MODEL_IDS + NEW_MODEL_IDS
TRANSPORT_IDS = ("path", "road", "tram")
VARIANT_NAMES = ("end", "straight", "corner", "tee", "cross")
GAME_SMOKE = {
    "generator": (-0.285, 1.60, -0.225),
    "factory": (-0.28, 1.47, -0.18),
}
ROTOR_ANCHOR = (0.20, 0.70, -0.05)


def linear_channel(value):
    value = value / 255.0
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def color(hex_value):
    value = hex_value.lstrip("#")
    return tuple(linear_channel(int(value[i:i + 2], 16)) for i in (0, 2, 4)) + (1.0,)


def material(name, hex_value, roughness=0.82, metallic=0.0, emission=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    rgba = color(hex_value)
    mat.diffuse_color = rgba
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = rgba
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if emission:
        shader.inputs["Emission Color"].default_value = rgba
        shader.inputs["Emission Strength"].default_value = emission
    MAT[name] = mat
    return mat


def make_palette():
    values = {
        "plaster": ("F0D8AE", 0.92, 0.0),
        "plaster_light": ("FFE8C0", 0.9, 0.0),
        "plaster_rose": ("DDA68A", 0.92, 0.0),
        "wood": ("49302A", 0.88, 0.0),
        "wood_light": ("795039", 0.88, 0.0),
        "barn_red": ("9B5542", 0.9, 0.0),
        "tile": ("B9533B", 0.88, 0.0),
        "tile_light": ("D57650", 0.88, 0.0),
        "tile_dark": ("873D32", 0.9, 0.0),
        "copper": ("4E8880", 0.67, 0.28),
        "copper_light": ("7DA99A", 0.72, 0.18),
        "metal": ("34494B", 0.64, 0.45),
        "stone": ("8F9182", 0.95, 0.0),
        "stone_light": ("BBB8A2", 0.95, 0.0),
        "stone_dark": ("626A63", 0.95, 0.0),
        "soil": ("76513A", 1.0, 0.0),
        "soil_dark": ("513D31", 1.0, 0.0),
        "clay_layer": ("A77350", 1.0, 0.0),
        "grass": ("829B63", 1.0, 0.0),
        "grass_light": ("91A870", 1.0, 0.0),
        "grass_dark": ("748D5B", 1.0, 0.0),
        "forest_floor": ("74885B", 1.0, 0.0),
        "fertile": ("99835A", 1.0, 0.0),
        "path": ("C9AD7F", 1.0, 0.0),
        "path_edge": ("A58D66", 1.0, 0.0),
        "asphalt": ("536064", 0.96, 0.0),
        "road_line": ("E7D9B5", 0.94, 0.0),
        "leaf": ("50784F", 0.96, 0.0),
        "leaf_light": ("75965A", 0.96, 0.0),
        "leaf_dark": ("355F48", 0.96, 0.0),
        "crop": ("D4B65C", 0.95, 0.0),
        "flower": ("E8A06F", 0.9, 0.0),
        "flower_light": ("F4D59A", 0.9, 0.0),
        "fruit_red": ("C95C43", 0.86, 0.0),
        "fruit_gold": ("E3B94F", 0.86, 0.0),
        "window": ("315F65", 0.38, 0.12),
        "water": ("428F96", 0.3, 0.08),
        "water_light": ("8BC5BD", 0.42, 0.0),
        "riverbed": ("587673", 1.0, 0.0),
        "ground": ("D6C4A6", 1.0, 0.0),
        "lantern": ("F4C76D", 0.65, 0.0),
    }
    for name, (hex_value, roughness, metallic) in values.items():
        material(name, hex_value, roughness, metallic, 0.18 if name == "lantern" else 0.0)
    meadow = material("meadow", "FFFFFF", 0.96)
    meadow.diffuse_color = color("829B63")
    tint = meadow.node_tree.nodes.new("ShaderNodeVertexColor")
    tint.layer_name = "TerrainTint"
    meadow.node_tree.links.new(tint.outputs["Color"], meadow.node_tree.nodes.get("Principled BSDF").inputs["Base Color"])
    glass = material("glass", "A9D4C6", 0.24, 0.05)
    shader = glass.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Alpha"].default_value = 0.42
    shader.inputs["Transmission Weight"].default_value = 0.12
    glass.surface_render_method = "DITHERED"


def move_to_collection(obj, collection=None):
    collection = collection or CURRENT
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    collection.objects.link(obj)
    return obj


def finish(obj, name, mat):
    obj.name = name
    if mat:
        obj.data.materials.append(MAT[mat] if isinstance(mat, str) else mat)
    return obj


def bevel(obj, width, segments=2):
    if width > 0:
        mod = obj.modifiers.new("Adoucissement", "BEVEL")
        mod.width = width
        mod.segments = segments
    return obj


def box(name, loc, dims, mat, edge=0.012, rot=None):
    x, y, z = (v / 2 for v in dims)
    verts = [
        (-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z),
        (-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z),
    ]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    CURRENT.objects.link(obj)
    obj.location = loc
    if rot:
        obj.rotation_euler = rot
    finish(obj, name, mat)
    return bevel(obj, min(edge, min(dims) * 0.24), 3 if edge > 0.025 else 2)


def cylinder(name, loc, radius, depth, mat, vertices=16, radius_top=None, rot=None, edge=0.006):
    radius_top = radius if radius_top is None else radius_top
    verts = []
    for z, r in ((-depth / 2, radius), (depth / 2, radius_top)):
        verts.extend((r * math.cos(TAU * i / vertices), r * math.sin(TAU * i / vertices), z) for i in range(vertices))
    faces = [tuple(reversed(range(vertices))), tuple(range(vertices, vertices * 2))]
    faces.extend((i, (i + 1) % vertices, (i + 1) % vertices + vertices, i + vertices) for i in range(vertices))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    CURRENT.objects.link(obj)
    obj.location = loc
    if rot:
        obj.rotation_euler = rot
    finish(obj, name, mat)
    for polygon in mesh.polygons:
        polygon.use_smooth = polygon.index >= 2
    return bevel(obj, min(edge, depth * 0.15, radius * 0.15), 2)


def beam(name, start, end, width, mat, edge=0.006):
    start, end = Vector(start), Vector(end)
    direction = end - start
    obj = box(name, (start + end) / 2, (width, width, direction.length), mat, edge)
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    return obj


def tube(name, start, end, radius, mat, vertices=12):
    start, end = Vector(start), Vector(end)
    direction = end - start
    obj = cylinder(name, (start + end) / 2, radius, direction.length, mat, vertices, edge=0.003)
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    return obj


def ico(name, loc, scale, mat, subdivisions=2, smooth=True):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1, location=loc)
    obj = bpy.context.object
    move_to_collection(obj)
    obj.scale = scale
    obj.rotation_euler = (RNG.uniform(-0.12, 0.12), RNG.uniform(-0.12, 0.12), RNG.uniform(0, TAU))
    finish(obj, name, mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = smooth
    return obj


def torus(name, loc, major, minor, mat, rot=None, major_segments=20):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major,
        minor_radius=minor,
        major_segments=major_segments,
        minor_segments=6,
        location=loc,
        rotation=rot or (0, 0, 0),
    )
    obj = bpy.context.object
    move_to_collection(obj)
    finish(obj, name, mat)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def pipe(name, points, radius, mat):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 2
    curve.bevel_depth = radius
    curve.bevel_resolution = 3
    curve.resolution_u = 12
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, co in zip(spline.bezier_points, points):
        point.co = co
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    CURRENT.objects.link(obj)
    return finish(obj, name, mat)


def gable_roof(name, center, width, depth, eave, rise, mat="tile", detailed=True):
    cx, cy = center
    w, d = width / 2, depth / 2
    verts = [
        (cx - w, cy - d, eave), (cx + w, cy - d, eave), (cx, cy - d, eave + rise),
        (cx - w, cy + d, eave), (cx + w, cy + d, eave), (cx, cy + d, eave + rise),
    ]
    faces = [(0, 1, 2), (5, 4, 3), (0, 2, 5, 3), (2, 1, 4, 5), (0, 3, 4, 1)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    CURRENT.objects.link(obj)
    finish(obj, name, mat)
    bevel(obj, 0.012, 2)
    if detailed:
        slope = math.atan2(rise, w)
        length = math.hypot(w, rise)
        for side in (-1, 1):
            for row in range(5):
                t = (row + 0.5) / 5
                x = cx + side * w * (1 - t)
                z = eave + rise * t + 0.009
                strip = box(
                    f"{name} · rang {side}/{row}",
                    (x, cy, z),
                    (length / 5 + 0.018, depth + 0.012, 0.018),
                    ("tile_light" if (row + (side == 1)) % 3 == 0 else mat),
                    0.005,
                    (0, side * slope, 0),
                )
            for column in range(1, 6):
                y = cy - d + depth * column / 6
                tube(
                    f"{name} · nervure {side}/{column}",
                    (cx + side * (w - 0.025), y, eave + 0.02),
                    (cx + side * 0.025, y, eave + rise + 0.02),
                    0.010,
                    "tile_dark" if column % 3 == 0 else mat,
                    8,
                )
    tube(f"{name} · faitage", (cx, cy - d - 0.018, eave + rise + 0.025), (cx, cy + d + 0.018, eave + rise + 0.025), 0.032, "tile_light", 12)
    return obj


def front_window(name, x, y, z, width=0.16, height=0.18, shutters=False, flowers=False):
    box(f"{name} · cadre", (x, y, z), (width + 0.045, 0.035, height + 0.045), "wood", 0.008)
    box(f"{name} · vitre", (x, y - 0.020, z), (width, 0.018, height), "window", 0.005)
    box(f"{name} · meneau", (x, y - 0.033, z), (0.018, 0.014, height), "plaster_light", 0.003)
    box(f"{name} · traverse", (x, y - 0.033, z), (width, 0.014, 0.018), "plaster_light", 0.003)
    box(f"{name} · appui", (x, y - 0.025, z - height / 2 - 0.035), (width + 0.075, 0.075, 0.035), "stone_light", 0.008)
    if shutters:
        for side in (-1, 1):
            sx = x + side * (width / 2 + 0.055)
            box(f"{name} · volet", (sx, y - 0.003, z), (0.065, 0.026, height + 0.025), "copper", 0.006)
            for dz in (-0.045, 0.0, 0.045):
                box(f"{name} · lamelle", (sx, y - 0.019, z + dz), (0.052, 0.012, 0.012), "copper_light", 0.002)
    if flowers:
        box(f"{name} · jardiniere", (x, y - 0.07, z - height / 2 - 0.075), (width + 0.055, 0.11, 0.075), "wood_light", 0.009)
        for i in range(4):
            fx = x - width * 0.4 + i * width * 0.27
            ico(f"{name} · feuillage", (fx, y - 0.08, z - height / 2 - 0.025), (0.045, 0.038, 0.035), "leaf", 1, False)
            ico(f"{name} · fleur", (fx, y - 0.095, z - height / 2 + 0.002), (0.022, 0.022, 0.018), "flower" if i % 2 else "flower_light", 1, False)


def rear_window(name, x, y, z, width=0.14, height=0.17, shutters=False):
    box(f"{name} · cadre", (x, y, z), (width + 0.045, 0.035, height + 0.045), "wood", 0.007)
    box(f"{name} · vitre", (x, y + 0.020, z), (width, 0.018, height), "window", 0.004)
    box(f"{name} · meneau", (x, y + 0.033, z), (0.016, 0.014, height), "plaster_light", 0.002)
    box(f"{name} · traverse", (x, y + 0.033, z), (width, 0.014, 0.016), "plaster_light", 0.002)
    box(f"{name} · appui", (x, y + 0.025, z - height / 2 - 0.030), (width + 0.07, 0.065, 0.03), "stone_light", 0.007)
    if shutters:
        for side in (-1, 1):
            sx = x + side * (width / 2 + 0.052)
            box(f"{name} · volet", (sx, y + 0.003, z), (0.06, 0.026, height + 0.02), "copper", 0.005)
            for dz in (-0.04, 0.0, 0.04):
                box(f"{name} · lamelle", (sx, y + 0.019, z + dz), (0.048, 0.012, 0.010), "copper_light", 0.002)


def rear_industrial_window(name, x, y, z, width=0.14, height=0.15):
    box(f"{name} · cadre", (x, y, z), (width + 0.04, 0.03, height + 0.04), "metal", 0.005)
    box(f"{name} · vitre", (x, y + 0.018, z), (width, 0.014, height), "window", 0)
    box(f"{name} · meneau", (x, y + 0.028, z), (0.014, 0.012, height), "copper", 0)
    box(f"{name} · appui", (x, y + 0.022, z - height / 2 - 0.025), (width + 0.06, 0.06, 0.025), "stone", 0.005)


def rear_vent(name, x, y, z, width=0.13, height=0.12):
    box(f"{name} · cadre", (x, y, z), (width + 0.035, 0.03, height + 0.035), "metal", 0.005)
    box(f"{name} · fond", (x, y + 0.018, z), (width, 0.014, height), "window", 0)
    for dz in (-0.03, 0, 0.03):
        box(f"{name} · lame", (x, y + 0.029, z + dz), (width - 0.01, 0.012, 0.010), "copper_light", 0.002)


def rear_service_door(name, x, y, bottom, width=0.17, height=0.31, mat="copper", trim="copper_light"):
    box(f"{name} · cadre", (x, y, bottom + height / 2), (width + 0.045, 0.04, height + 0.04), "metal", 0.007)
    box(f"{name} · porte", (x, y + 0.024, bottom + height / 2), (width, 0.022, height), mat, 0.005)
    for z in (bottom + 0.07, bottom + height - 0.07):
        box(f"{name} · renfort", (x, y + 0.039, z), (width - 0.025, 0.012, 0.018), trim, 0.002)
    cylinder(f"{name} · poignee", (x + width * 0.30, y + 0.047, bottom + height * 0.52), 0.009, 0.015, trim, 8, rot=(math.pi / 2, 0, 0), edge=0.002)


def crate(name, loc, size=(0.22, 0.18, 0.14), fruit=None):
    x, y, z = loc
    w, d, h = size
    box(f"{name} · fond", (x, y, z + 0.015), (w, d, 0.03), "wood_light", 0.005)
    for side in (-1, 1):
        for level in (0.045, 0.10):
            box(f"{name} · planche x", (x, y + side * d / 2, z + level), (w + 0.015, 0.022, 0.035), "wood_light", 0.004)
            box(f"{name} · planche y", (x + side * w / 2, y, z + level), (0.022, d, 0.035), "wood", 0.004)
    if fruit:
        for ix in range(3):
            for iy in range(2):
                ico(f"{name} · produit", (x + (ix - 1) * w * 0.25, y + (iy - 0.5) * d * 0.34, z + h * 0.78), (0.035, 0.035, 0.033), fruit, 1, False)


def striped_awning(name, cx, width, y_front, y_back, z_front, z_back, colors):
    count = 6
    length = math.hypot(y_back - y_front, z_back - z_front)
    angle = math.atan2(z_back - z_front, y_back - y_front)
    for i in range(count):
        x = cx - width / 2 + width * (i + 0.5) / count
        box(
            f"{name} · bande {i}",
            (x, (y_front + y_back) / 2, (z_front + z_back) / 2),
            (width / count + 0.006, length, 0.026),
            colors[i % len(colors)],
            0.006,
            (angle, 0, 0),
        )
        box(f"{name} · lambrequin {i}", (x, y_front - 0.004, z_front - 0.035), (width / count + 0.004, 0.025, 0.075), colors[i % len(colors)], 0.008)
    tube(f"{name} · barre frontale", (cx - width / 2, y_front, z_front), (cx + width / 2, y_front, z_front), 0.018, "wood")


def new_asset(name):
    global CURRENT
    collection = bpy.data.collections.new(f"ASSET · {name}")
    collection.use_fake_user = True
    ASSETS[name] = collection
    CURRENT = collection
    return collection


def build_house():
    new_asset("house")
    box("Maison · soubassement", (0.015, 0, 0.04), (0.80, 0.66, 0.08), "stone", 0.025)
    box("Maison · corps", (0.04, 0, 0.34), (0.68, 0.58, 0.52), "plaster", 0.035)
    box("Maison · annexe fondation", (-0.36, 0.075, 0.035), (0.23, 0.43, 0.07), "stone", 0.018)
    box("Maison · annexe", (-0.365, 0.075, 0.25), (0.21, 0.40, 0.36), "plaster_rose", 0.025)
    box("Maison · toit annexe", (-0.36, 0.075, 0.49), (0.24, 0.47, 0.04), "tile_dark", 0.012, (0, -0.20, 0))
    for x in (-0.26, 0.34):
        box("Maison · colombage vertical", (x, -0.299, 0.35), (0.042, 0.035, 0.48), "wood", 0.006)
    for z in (0.14, 0.53):
        box("Maison · colombage horizontal", (0.04, -0.302, z), (0.64, 0.035, 0.04), "wood", 0.006)
    beam("Maison · colombage pignon", (-0.24, -0.306, 0.59), (0.04, -0.306, 0.82), 0.032, "wood")
    beam("Maison · colombage pignon", (0.32, -0.306, 0.59), (0.04, -0.306, 0.82), 0.032, "wood")
    gable_roof("Maison · tuiles", (0.04, 0), 0.82, 0.72, 0.60, 0.27)
    box("Maison · porte", (0.055, -0.314, 0.265), (0.17, 0.045, 0.35), "wood", 0.016)
    box("Maison · porte vitree", (0.055, -0.342, 0.33), (0.105, 0.016, 0.12), "copper", 0.008)
    cylinder("Maison · poignee", (0.11, -0.35, 0.24), 0.012, 0.018, "copper_light", 10, rot=(math.pi / 2, 0, 0))
    box("Maison · seuil", (0.055, -0.39, 0.045), (0.28, 0.17, 0.09), "stone_light", 0.018)
    box("Maison · marche", (0.055, -0.455, 0.02), (0.33, 0.12, 0.04), "stone", 0.012)
    front_window("Maison · fenetre gauche", -0.17, -0.318, 0.37, 0.14, 0.17, True, True)
    front_window("Maison · fenetre droite", 0.255, -0.318, 0.37, 0.115, 0.17, False, False)
    cylinder("Maison · oculus cadre", (0.04, -0.367, 0.705), 0.071, 0.035, "wood", 20, rot=(math.pi / 2, 0, 0))
    cylinder("Maison · oculus vitre", (0.04, -0.389, 0.705), 0.049, 0.018, "window", 20, rot=(math.pi / 2, 0, 0))
    box("Maison · cheminee", (0.245, 0.14, 0.91), (0.12, 0.13, 0.37), "plaster_rose", 0.012)
    for z in (0.80, 0.90, 1.0):
        box("Maison · brique", (0.245, 0.071, z), (0.12, 0.012, 0.018), "tile_dark", 0.002)
    box("Maison · chapeau cheminee", (0.245, 0.14, 1.105), (0.17, 0.18, 0.045), "stone_dark", 0.01)
    front_window("Maison · annexe fenetre", -0.365, -0.135, 0.28, 0.10, 0.14, False, False)
    rear_window("Maison · arriere gauche", -0.13, 0.296, 0.36, 0.12, 0.16, True)
    rear_window("Maison · arriere droite", 0.20, 0.296, 0.36, 0.12, 0.16, False)


def build_well():
    new_asset("well")
    cylinder("Puits · dalle", (0, 0, 0.04), 0.36, 0.08, "stone_light", 16, edge=0.015)
    cylinder("Puits · obscurite", (0, 0, 0.17), 0.205, 0.12, "soil_dark", 20, edge=0)
    for i in range(12):
        a = TAU * i / 12
        for level in range(2):
            aa = a + (level % 2) * TAU / 24
            obj = box(
                f"Puits · pierre {i}/{level}",
                (0.25 * math.cos(aa), 0.25 * math.sin(aa), 0.14 + level * 0.12),
                (0.14, 0.115, 0.105),
                "stone" if (i + level) % 3 else "stone_light",
                0.016,
                (0, 0, aa + math.pi / 2),
            )
    torus("Puits · margelle", (0, 0, 0.315), 0.25, 0.048, "stone_light", major_segments=24)
    for x in (-0.255, 0.255):
        box("Puits · poteau", (x, 0.035, 0.535), (0.065, 0.075, 0.54), "wood", 0.012)
        beam("Puits · contre-fiche", (x, 0.035, 0.64), (x * 0.55, 0.035, 0.79), 0.035, "wood_light")
    box("Puits · linteau", (0, 0.035, 0.78), (0.62, 0.08, 0.075), "wood", 0.012)
    gable_roof("Puits · toit", (0, 0.02), 0.74, 0.66, 0.79, 0.18)
    tube("Puits · axe", (-0.30, -0.015, 0.60), (0.32, -0.015, 0.60), 0.022, "metal")
    torus("Puits · poulie", (0, -0.015, 0.60), 0.085, 0.018, "wood_light", (0, math.pi / 2, 0))
    tube("Puits · corde", (0, -0.092, 0.59), (0, -0.092, 0.245), 0.009, "crop", 8)
    cylinder("Puits · seau", (0, -0.092, 0.255), 0.060, 0.105, "wood_light", 12, radius_top=0.074, edge=0.005)
    torus("Puits · cercle seau", (0, -0.092, 0.303), 0.070, 0.008, "metal")
    tube("Puits · manivelle", (0.32, -0.015, 0.60), (0.32, -0.015, 0.51), 0.018, "metal")
    tube("Puits · poignee manivelle", (0.32, -0.015, 0.51), (0.39, -0.015, 0.51), 0.024, "wood")


def build_farm():
    new_asset("farm")
    box("Ferme · plateforme", (0, 0, 0.018), (0.91, 0.91, 0.036), "grass_dark", 0.045)
    box("Ferme · grange", (0.13, 0.13, 0.26), (0.52, 0.43, 0.43), "barn_red", 0.022)
    for x in (-0.09, 0.35):
        box("Ferme · poteau grange", (x, -0.091, 0.27), (0.04, 0.035, 0.41), "wood", 0.006)
    gable_roof("Ferme · toit grange", (0.13, 0.13), 0.62, 0.53, 0.48, 0.23, "tile_dark")
    box("Ferme · double porte", (0.13, -0.098, 0.23), (0.27, 0.035, 0.32), "wood", 0.009)
    for x in (0.065, 0.195):
        box("Ferme · porte rouge", (x, -0.12, 0.23), (0.117, 0.018, 0.28), "barn_red", 0.004)
    beam("Ferme · croix porte", (0.015, -0.137, 0.10), (0.245, -0.137, 0.36), 0.022, "wood_light")
    beam("Ferme · croix porte", (0.245, -0.138, 0.10), (0.015, -0.138, 0.36), 0.022, "wood_light")
    front_window("Ferme · lucarne", 0.13, -0.142, 0.53, 0.11, 0.11, False, False)
    cylinder("Ferme · silo", (-0.275, 0.17, 0.315), 0.135, 0.53, "copper", 16, edge=0.012)
    cylinder("Ferme · silo haut", (-0.275, 0.17, 0.645), 0.16, 0.14, "copper_light", 16, radius_top=0.025, edge=0.006)
    for z in (0.14, 0.35, 0.54):
        torus("Ferme · ceinture silo", (-0.275, 0.17, z), 0.136, 0.012, "metal")
    tube("Ferme · echelle silo", (-0.39, 0.09, 0.09), (-0.39, 0.09, 0.57), 0.012, "wood")
    tube("Ferme · echelle silo", (-0.39, 0.22, 0.09), (-0.39, 0.22, 0.57), 0.012, "wood")
    for z in (0.14, 0.23, 0.32, 0.41, 0.50):
        tube("Ferme · barreau silo", (-0.39, 0.09, z), (-0.39, 0.22, z), 0.010, "wood")
    for x in (-0.18, 0.17):
        box("Ferme · planche culture", (x, -0.29, 0.046), (0.28, 0.25, 0.04), "soil", 0.025)
        for row in range(3):
            yy = -0.37 + row * 0.08
            box("Ferme · sillon", (x, yy, 0.069), (0.25, 0.025, 0.015), "soil_dark", 0.006)
            for col in range(3):
                xx = x + (col - 1) * 0.075
                ico("Ferme · plant", (xx, yy, 0.10), (0.042, 0.035, 0.045), "leaf_light" if row % 2 else "leaf", 1, False)
                if x > 0:
                    ico("Ferme · legume", (xx, yy, 0.078), (0.018, 0.018, 0.028), "fruit_gold", 1, False)
    fence_points = [(-0.43, -0.43), (-0.22, -0.43), (0, -0.43), (0.22, -0.43), (0.43, -0.43), (0.43, -0.20), (0.43, 0.03)]
    for x, y in fence_points:
        box("Ferme · piquet", (x, y, 0.14), (0.035, 0.035, 0.24), "wood_light", 0.006)
    for a, b in zip(fence_points, fence_points[1:]):
        for z in (0.11, 0.21):
            beam("Ferme · lisse", (a[0], a[1], z), (b[0], b[1], z), 0.025, "wood_light")
    cylinder("Ferme · botte paille", (0.325, -0.20, 0.12), 0.075, 0.16, "crop", 12, rot=(0, math.pi / 2, 0), edge=0.01)
    torus("Ferme · ficelle paille", (0.325, -0.20, 0.12), 0.076, 0.008, "wood", (0, math.pi / 2, 0))
    rear_window("Grange · arriere gauche", 0.02, 0.351, 0.31, 0.11, 0.15, False)
    rear_window("Grange · arriere droite", 0.25, 0.351, 0.31, 0.11, 0.15, False)
    simplify_bevels("farm")


def build_workshop():
    new_asset("workshop")
    box("Atelier · fondation", (0, 0.02, 0.04), (0.78, 0.65, 0.08), "stone", 0.025)
    box("Atelier · maconnerie", (0, 0.04, 0.30), (0.68, 0.54, 0.46), "plaster", 0.028)
    box("Atelier · rez-de-chaussee pierre", (0, -0.238, 0.14), (0.69, 0.035, 0.16), "stone_light", 0.01)
    gable_roof("Atelier · toit cuivre", (0, 0.04), 0.82, 0.66, 0.54, 0.20, "copper")
    box("Atelier · grande ouverture", (0.07, -0.242, 0.32), (0.40, 0.035, 0.29), "wood", 0.012)
    box("Atelier · interieur", (0.07, -0.264, 0.32), (0.33, 0.018, 0.22), "metal", 0.006)
    box("Atelier · linteau", (0.07, -0.282, 0.48), (0.46, 0.07, 0.065), "wood_light", 0.01)
    box("Atelier · porte laterale", (-0.25, -0.259, 0.27), (0.14, 0.04, 0.32), "copper", 0.01)
    front_window("Atelier · fenetre", 0.265, -0.251, 0.34, 0.10, 0.15, False, False)
    striped_awning("Atelier · auvent", 0.055, 0.57, -0.46, -0.20, 0.43, 0.56, ("copper", "plaster_light"))
    for x in (-0.20, 0.31):
        tube("Atelier · support auvent", (x, -0.435, 0.05), (x, -0.435, 0.44), 0.018, "wood")
    box("Atelier · etabli plateau", (0.055, -0.355, 0.19), (0.43, 0.18, 0.065), "wood_light", 0.012)
    for x in (-0.11, 0.22):
        for y in (-0.405, -0.305):
            box("Atelier · pied etabli", (x, y, 0.10), (0.035, 0.035, 0.17), "wood", 0.005)
    box("Atelier · etau", (0.20, -0.37, 0.245), (0.09, 0.07, 0.06), "metal", 0.008)
    tube("Atelier · manche outil", (-0.10, -0.38, 0.23), (0.015, -0.34, 0.23), 0.013, "wood_light")
    box("Atelier · marteau", (-0.11, -0.385, 0.235), (0.07, 0.035, 0.035), "metal", 0.006)
    box("Atelier · cheminee", (0.255, 0.18, 0.80), (0.14, 0.15, 0.54), "tile_dark", 0.015)
    for z in (0.62, 0.76, 0.90):
        box("Atelier · ceinture cheminee", (0.255, 0.18, z), (0.15, 0.16, 0.025), "stone_dark", 0.005)
    box("Atelier · chapeau", (0.255, 0.18, 1.085), (0.20, 0.21, 0.05), "stone_dark", 0.012)
    for i in range(4):
        cylinder("Atelier · grume", (-0.32, 0.08 + i * 0.075, 0.13), 0.04, 0.30, "wood_light", 10, rot=(0, math.pi / 2, 0), edge=0.006)
    rear_window("Atelier · arriere fenetre", -0.17, 0.316, 0.34, 0.13, 0.15, False)
    rear_service_door("Atelier · porte service", 0.17, 0.318, 0.08, 0.16, 0.32, "copper", "metal")


def build_market():
    new_asset("market")
    box("Marche · place", (0, 0, 0.025), (0.90, 0.86, 0.05), "stone_light", 0.045)
    for x in (-0.40, 0, 0.40):
        for y in (-0.30, 0.30):
            bottom = 0.04
            top = 0.72 + (y + 0.39) * 0.15 / 0.76 - 0.012
            box("Marche · poteau", (x, y, (bottom + top) / 2), (0.038, 0.038, top - bottom), "wood", 0.007)
    for cx, colors in ((-0.215, ("tile", "plaster_light")), (0.215, ("copper", "plaster_light"))):
        box("Marche · comptoir", (cx, -0.015, 0.27), (0.36, 0.56, 0.075), "wood_light", 0.012)
        for x in (cx - 0.14, cx + 0.14):
            for y in (-0.23, 0.20):
                box("Marche · pied comptoir", (x, y, 0.15), (0.035, 0.035, 0.23), "wood", 0.006)
        striped_awning("Marche · auvent", cx, 0.41, -0.39, 0.37, 0.72, 0.87, colors)
        crate("Marche · cagette comptoir", (cx, -0.10, 0.315), (0.27, 0.20, 0.13), "fruit_red" if cx < 0 else "fruit_gold")
        crate("Marche · cagette reserve", (cx, 0.15, 0.315), (0.25, 0.17, 0.12), "leaf_light" if cx < 0 else "fruit_red")
    crate("Marche · cagette sol", (-0.25, -0.32, 0.052), (0.22, 0.15, 0.12), "fruit_gold")
    crate("Marche · cagette empile", (0.26, -0.32, 0.052), (0.22, 0.15, 0.12), None)
    tube("Marche · enseigne", (-0.09, -0.325, 0.61), (0.09, -0.325, 0.61), 0.018, "wood")
    box("Marche · pancarte", (0, -0.337, 0.55), (0.20, 0.025, 0.12), "copper", 0.015)
    for x in (-0.055, 0, 0.055):
        ico("Marche · embleme", (x, -0.354, 0.55), (0.022, 0.012, 0.028), "fruit_gold", 1, False)


def build_generator():
    new_asset("generator")
    box("Centrale · dalle", (0, 0, 0.04), (0.92, 0.88, 0.08), "stone_dark", 0.035)
    box("Centrale · bati", (-0.145, 0.10, 0.37), (0.50, 0.49, 0.58), "plaster", 0.028)
    box("Centrale · couronnement", (-0.145, 0.10, 0.685), (0.57, 0.56, 0.08), "copper", 0.018)
    box("Centrale · porte", (-0.15, -0.157, 0.29), (0.22, 0.04, 0.38), "metal", 0.012)
    for z in (0.18, 0.25, 0.32):
        box("Centrale · grille porte", (-0.15, -0.182, z), (0.16, 0.018, 0.018), "copper_light", 0.003)
    box("Centrale · panneau", (0.035, -0.159, 0.47), (0.09, 0.035, 0.16), "copper", 0.008)
    cylinder("Centrale · cadran", (0.035, -0.184, 0.50), 0.030, 0.016, "plaster_light", 16, rot=(math.pi / 2, 0, 0))
    beam("Centrale · aiguille", (0.035, -0.196, 0.50), (0.048, -0.196, 0.515), 0.005, "metal", 0.001)
    for y in (-0.005, 0.265):
        cylinder("Centrale · cuve", (0.265, y, 0.37), 0.135, 0.54, "copper", 20, edge=0.015)
        ico("Centrale · dome", (0.265, y, 0.64), (0.135, 0.135, 0.075), "copper_light", 2, True)
        cylinder("Centrale · pied cuve", (0.265, y, 0.105), 0.15, 0.07, "metal", 16, edge=0.008)
        for z in (0.18, 0.49):
            torus("Centrale · collier cuve", (0.265, y, z), 0.137, 0.015, "metal")
    pipe("Centrale · conduite principale", [(0.265, -0.005, 0.66), (0.265, -0.005, 0.78), (-0.08, -0.005, 0.78), (-0.08, -0.005, 0.70)], 0.035, "copper_light")
    pipe("Centrale · conduite avant", [(0.265, -0.005, 0.22), (0.40, -0.005, 0.22), (0.40, -0.30, 0.22), (0.20, -0.34, 0.22), (0.06, -0.22, 0.22)], 0.032, "copper")
    for x in (0.23, 0.31):
        torus("Centrale · bride", (x, -0.005, 0.66), 0.045, 0.012, "metal")
    cylinder("Centrale · cheminee base", (-0.285, 0.225, 0.80), 0.11, 0.20, "metal", 16, edge=0.01)
    cylinder("Centrale · cheminee", (-0.285, 0.225, 1.18), 0.075, 0.72, "tile_dark", 20, radius_top=0.057, edge=0.008)
    for z in (0.94, 1.20, 1.46):
        torus("Centrale · bague cheminee", (-0.285, 0.225, z), 0.071, 0.013, "metal")
    cylinder("Centrale · sortie cheminee", (-0.285, 0.225, 1.565), 0.085, 0.07, "metal", 20, edge=0.008)
    cylinder("Centrale · event", (0.01, 0.20, 0.80), 0.06, 0.17, "metal", 16, edge=0.008)
    cylinder("Centrale · chapeau event", (0.01, 0.20, 0.89), 0.085, 0.035, "copper_light", 16, edge=0.006)
    for i in range(3):
        box("Centrale · grille", (-0.32 + i * 0.10, -0.161, 0.56), (0.065, 0.025, 0.10), "window", 0.005)
    rear_service_door("Centrale · acces arriere", -0.19, 0.352, 0.08, 0.18, 0.34, "metal")
    rear_vent("Centrale · ventilation arriere", 0.015, 0.352, 0.50, 0.10, 0.12)


def foliage_seed(name):
    return sum((index + 1) * ord(char) for index, char in enumerate(name))


def foliage_lobe(name, loc, radii, mat):
    rng = random.Random(foliage_seed(name))
    segments = 9
    rings = [(-0.82, 0.40), (-0.48, 0.82), (-0.02, 1.0), (0.46, 0.82), (0.82, 0.38)]
    phase = rng.uniform(0, TAU)
    verts = []
    for level, (z, radius) in enumerate(rings):
        for i in range(segments):
            angle = TAU * i / segments + (level % 2) * 0.055
            variation = 0.93 + 0.08 * math.sin(angle * 3 + phase) + 0.05 * math.cos(angle * 5 - phase) + rng.uniform(-0.035, 0.035)
            r = radius * variation
            verts.append((math.cos(angle) * r + 0.035 * math.sin(level + phase), math.sin(angle) * r + 0.03 * math.cos(level + phase), z + rng.uniform(-0.045, 0.045)))
    verts.extend(((0.035, -0.025, 1.0), (0, 0, -0.90)))
    max_x = max(abs(v[0]) for v in verts)
    max_y = max(abs(v[1]) for v in verts)
    sx, sy, sz = radii
    vertices = [(loc[0] + v[0] / max_x * sx, loc[1] + v[1] / max_y * sy, loc[2] + v[2] * sz) for v in verts]
    faces = []
    for level in range(len(rings) - 1):
        for i in range(segments):
            a = level * segments + i
            b = level * segments + (i + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    top = len(verts) - 2
    bottom = len(verts) - 1
    for i in range(segments):
        faces.append(((len(rings) - 1) * segments + i, (len(rings) - 1) * segments + (i + 1) % segments, top))
        faces.append(((i + 1) % segments, i, bottom))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    CURRENT.objects.link(obj)
    return finish(obj, name, mat)


def conifer_skirt(name, x, y, z, radius, depth, mat):
    rng = random.Random(foliage_seed(name))
    segments = 12
    phase = rng.uniform(0, TAU)
    rings = ((0.50, 0.035), (0.16, 0.44), (-0.14, 0.79), (-0.43, 1.0))
    verts = []
    for level, (height, spread) in enumerate(rings):
        for i in range(segments):
            angle = TAU * i / segments + phase
            tooth = 0.07 if i % 2 == 0 else -0.035
            r = radius * spread * (0.96 + tooth + rng.uniform(-0.035, 0.035))
            droop = (0.075 if i % 2 == 0 else 0.015) if level == len(rings) - 1 else 0
            jitter = rng.uniform(-0.018, 0.018) if level else 0.0
            verts.append((x + math.cos(angle) * r, y + math.sin(angle) * r, z + depth * (height - droop + jitter)))
    verts.append((x, y, z + depth * 0.50))
    verts.append((x, y, z - depth * 0.37))
    faces = []
    for level in range(len(rings) - 1):
        for i in range(segments):
            a = level * segments + i
            b = level * segments + (i + 1) % segments
            faces.append((a, b, b + segments, a + segments))
    for i in range(segments):
        faces.append(((len(rings) - 1) * segments + i, (len(rings) - 1) * segments + (i + 1) % segments, len(verts) - 2))
        faces.append(((i + 1) % segments, i, len(verts) - 1))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    CURRENT.objects.link(obj)
    return finish(obj, name, mat)


def tree(name, x, y, base=0.0, scale=1.0, pine=False):
    if pine:
        cylinder(f"{name} · tronc", (x, y, base + 0.23 * scale), 0.04 * scale, 0.46 * scale, "wood", 10, radius_top=0.025 * scale, edge=0.005)
        cylinder(f"{name} · souche", (x, y, base + 0.04 * scale), 0.06 * scale, 0.08 * scale, "wood", 10, radius_top=0.042 * scale, edge=0.004)
        for angle in (0.2, 2.3, 4.4):
            tube(f"{name} · branche nue", (x, y, base + 0.17 * scale), (x + math.cos(angle) * 0.12 * scale, y + math.sin(angle) * 0.12 * scale, base + 0.27 * scale), 0.012 * scale, "wood", 8)
        for i, (z, radius, depth) in enumerate(((0.43, 0.25, 0.40), (0.65, 0.20, 0.36), (0.84, 0.14, 0.30))):
            conifer_skirt(f"{name} · jupe {i}", x, y, base + z * scale, radius * scale, depth * scale, "leaf_dark" if i == 0 else ("leaf" if i == 1 else "leaf_light"))
    else:
        cylinder(f"{name} · tronc", (x, y, base + 0.25 * scale), 0.047 * scale, 0.50 * scale, "wood_light", 10, radius_top=0.028 * scale, edge=0.006)
        cylinder(f"{name} · souche", (x, y, base + 0.04 * scale), 0.062 * scale, 0.08 * scale, "wood_light", 10, radius_top=0.045 * scale, edge=0.004)
        lobes = (
            ((0, 0, 0.61), (0.24, 0.22, 0.19), "leaf"),
            ((0.03, 0.025, 0.76), (0.20, 0.18, 0.18), "leaf_light"),
            ((-0.16, -0.03, 0.66), (0.15, 0.16, 0.15), "leaf"),
            ((0.16, 0.04, 0.69), (0.15, 0.15, 0.18), "leaf_dark"),
            ((-0.03, -0.14, 0.69), (0.16, 0.09, 0.14), "leaf"),
        )
        for index, (center, radii, mat) in enumerate(lobes):
            cx, cy, cz = center
            tube(f"{name} · branche {index}", (x, y, base + (0.30 + index * 0.018) * scale), (x + cx * scale, y + cy * scale, base + (cz - 0.025) * scale), (0.022 if index < 2 else 0.016) * scale, "wood_light", 10)
            foliage_lobe(f"{name} · lobe {index}", (x + cx * scale, y + cy * scale, base + cz * scale), tuple(value * scale for value in radii), mat)
        for side in (-1, 1):
            tube(f"{name} · fourche basse", (x, y - 0.01 * scale, base + 0.27 * scale), (x + side * 0.21 * scale, y - 0.025 * scale, base + 0.44 * scale), 0.022 * scale, "wood_light", 10)
        for _ in range(9):
            RNG.random()


def build_park():
    new_asset("park")
    box("Parc · socle", (0, 0, 0.02), (0.92, 0.92, 0.04), "grass_light", 0.065)
    box("Parc · allee", (0, -0.04, 0.043), (0.18, 0.80, 0.012), "path", 0.035)
    cylinder("Parc · rond-point", (0, -0.03, 0.048), 0.20, 0.015, "path", 24, edge=0.004)
    tree("Parc · tilleul", -0.205, 0.17, 0.04, 0.86, False)
    tree("Parc · sapin", 0.215, 0.19, 0.04, 0.92, True)
    for x in (0.08, 0.32):
        for y in (-0.30, -0.19):
            box("Parc · pied banc", (x, y, 0.11), (0.025, 0.025, 0.14), "metal", 0.004)
    for y in (-0.30, -0.255, -0.21):
        box("Parc · lame assise", (0.20, y, 0.18), (0.36, 0.035, 0.025), "wood_light", 0.005)
    for z in (0.25, 0.31):
        box("Parc · dossier banc", (0.20, -0.185, z), (0.36, 0.025, 0.045), "wood_light", 0.005)
    for x in (0.055, 0.345):
        beam("Parc · support dossier", (x, -0.19, 0.11), (x, -0.17, 0.34), 0.018, "metal")
    cylinder("Parc · lampadaire", (-0.29, -0.25, 0.30), 0.018, 0.54, "metal", 12, edge=0.003)
    cylinder("Parc · pied lampadaire", (-0.29, -0.25, 0.065), 0.05, 0.07, "metal", 12, edge=0.006)
    box("Parc · lanterne", (-0.29, -0.25, 0.58), (0.10, 0.10, 0.14), "lantern", 0.012)
    cylinder("Parc · chapeau lanterne", (-0.29, -0.25, 0.68), 0.085, 0.07, "copper", 4, radius_top=0.015, rot=(0, 0, math.pi / 4), edge=0.004)
    for x in (-0.34, -0.25, -0.16):
        ico("Parc · massif", (x, -0.05, 0.075), (0.075, 0.065, 0.055), "leaf_dark", 1, False)
        ico("Parc · fleur", (x, -0.065, 0.13), (0.030, 0.030, 0.025), "flower", 1, False)
    for x, y in ((-0.37, 0.34), (0.34, -0.36), (0.36, 0.37)):
        ico("Parc · rocher", (x, y, 0.07), (0.075, 0.06, 0.055), "stone", 1, False)


def tile_center(c, r):
    return c - 7.5, -(r - 5.5)


def make_map():
    grid = [["." for _ in range(COLS)] for _ in range(ROWS)]
    river = {
        0: (11,), 1: (10, 11), 2: (10,), 3: (10,), 4: (10, 11), 5: (11,),
        6: (11,), 7: (10, 11), 8: (10,), 9: (9, 10), 10: (9,), 11: (8, 9),
    }
    for r, columns in river.items():
        for c in columns:
            grid[r][c] = "W"
    forests = [(3, 0), (4, 0), (5, 0), (2, 1), (3, 1), (4, 1), (5, 1), (3, 2), (4, 2), (0, 9), (0, 10), (1, 10), (0, 11), (1, 11), (15, 2), (15, 3), (15, 7)]
    hills = [(12, 8), (13, 8), (12, 9), (13, 9), (12, 10), (13, 10)]
    hill_rocks = [(14, 8), (15, 8), (14, 9), (15, 9), (14, 10), (15, 10), (14, 11), (15, 11)]
    for c, r in forests + hill_rocks:
        grid[r][c] = "T"
    for c, r in hills:
        grid[r][c] = "H"
    for r in (5, 6, 7):
        for c in (2, 3, 4):
            if grid[r][c] == ".":
                grid[r][c] = "F"
    for c in range(3, 11):
        if grid[5][c] != "W":
            grid[5][c] = "P"
    for c in (12, 13, 14):
        grid[5][c] = "P"
    for r in range(2, 10):
        if grid[r][6] == ".":
            grid[r][6] = "P"
    for c in range(6, 10):
        if grid[8][c] == ".":
            grid[8][c] = "P"
    for r in (4, 6):
        grid[r][14] = "P"
    initial = [
        {"id": "house", "c": 4, "r": 4, "rotation": 0},
        {"id": "house", "c": 7, "r": 4, "rotation": 0},
        {"id": "house", "c": 5, "r": 6, "rotation": math.pi},
        {"id": "house", "c": 8, "r": 6, "rotation": math.pi},
        {"id": "house", "c": 2, "r": 3, "rotation": 0.18},
        {"id": "well", "c": 5, "r": 4, "rotation": 0},
        {"id": "well", "c": 3, "r": 4, "rotation": -0.12},
        {"id": "farm", "c": 3, "r": 6, "rotation": math.pi},
        {"id": "workshop", "c": 8, "r": 4, "rotation": 0},
        {"id": "market", "c": 7, "r": 6, "rotation": math.pi},
        {"id": "market", "c": 12, "r": 4, "rotation": 0.12},
        {"id": "generator", "c": 13, "r": 4, "rotation": 0},
        {"id": "park", "c": 9, "r": 4, "rotation": 0},
        {"id": "park", "c": 5, "r": 7, "rotation": -0.20},
        {"id": "park", "c": 12, "r": 6, "rotation": math.pi},
    ]
    rows_data = ["".join(row) for row in grid]
    assert len(rows_data) == ROWS and all(len(row) == COLS for row in rows_data)
    occupied = set()
    for item in initial:
        assert item["id"] in MODEL_IDS
        assert grid[item["r"]][item["c"]] in ".FH", item
        assert (item["c"], item["r"]) not in occupied
        occupied.add((item["c"], item["r"]))
    assert {item["id"] for item in initial} == set(MODEL_IDS)
    data = {"cols": COLS, "rows": ROWS, "rowsData": rows_data, "initial": initial}
    (OUT / "map.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return data


def terrain_tint(x, y):
    t = 0.5 + 0.24 * math.sin(x * 0.83 + y * 0.37) + 0.20 * math.sin(y * 1.12 - x * 0.29) + 0.06 * math.cos(x * 2.1 + y * 1.7)
    t = max(0.0, min(1.0, t))
    low = color("7F9460")
    high = color("899D69")
    return tuple(low[i] * (1.0 - t) + high[i] * t for i in range(3)) + (1.0,)


def terrain_prism(name, c, r, top, top_mat):
    cx, cy = tile_center(c, r)
    x0, x1 = cx - 0.5, cx + 0.5
    y0, y1 = cy - 0.5, cy + 0.5
    bottom = -0.18
    verts = [(x0, y0, bottom), (x1, y0, bottom), (x1, y1, bottom), (x0, y1, bottom), (x0, y0, top), (x1, y0, top), (x1, y1, top), (x0, y1, top)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(MAT[top_mat])
    mesh.materials.append(MAT["soil"])
    for polygon in mesh.polygons:
        polygon.material_index = 0 if polygon.index == 1 else 1
    if top_mat == "meadow":
        tint = mesh.color_attributes.new(name="TerrainTint", type="FLOAT_COLOR", domain="POINT")
        for index, vertex in enumerate(mesh.vertices):
            tint.data[index].color = terrain_tint(vertex.co.x, vertex.co.y)
    obj = bpy.data.objects.new(name, mesh)
    CURRENT.objects.link(obj)
    return obj


def path_patch(name, c, r, links, half_width, z, mat):
    cx, cy = tile_center(c, r)
    a = half_width
    rectangles = [(cx - a, cx + a, cy - a, cy + a)]
    for dc, dr in links:
        if dc == 1:
            rectangles.append((cx + a, cx + 0.5, cy - a, cy + a))
        elif dc == -1:
            rectangles.append((cx - 0.5, cx - a, cy - a, cy + a))
        elif dr == 1:
            rectangles.append((cx - a, cx + a, cy + a, cy + 0.5))
        elif dr == -1:
            rectangles.append((cx - a, cx + a, cy - 0.5, cy - a))
    verts, faces = [], []
    for x0, x1, y0, y1 in rectangles:
        start = len(verts)
        verts.extend(((x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)))
        faces.append((start, start + 1, start + 2, start + 3))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    CURRENT.objects.link(obj)
    return finish(obj, name, mat)


def build_bridge():
    y = tile_center(0, 5)[1]
    for i in range(13):
        x = 2.72 + i * 0.13
        arch = 0.045 + 0.07 * math.sin(math.pi * i / 12)
        box("Pont · madrier", (x, y, arch), (0.118, 0.61, 0.055), "wood_light" if i % 3 else "wood", 0.009)
    for side in (-1, 1):
        yy = y + side * 0.32
        for x in (2.72, 3.24, 3.76, 4.28):
            box("Pont · balustre", (x, yy, 0.235), (0.045, 0.045, 0.38), "wood", 0.008)
            cylinder("Pont · pommeau", (x, yy, 0.445), 0.038, 0.055, "copper", 8, radius_top=0.012, edge=0.005)
        tube("Pont · rambarde", (2.68, yy, 0.39), (4.32, yy, 0.39), 0.025, "wood_light")
        tube("Pont · poutre", (2.70, yy * 0.98, 0.015), (4.30, yy * 0.98, 0.015), 0.042, "wood")
    for x in (2.61, 4.39):
        box("Pont · abord", (x, y, 0.018), (0.22, 0.65, 0.036), "stone_light", 0.018)


def terrain_floor_patch(name, x, y, radius, mat):
    count = 14
    verts = []
    for i in range(count):
        angle = TAU * i / count
        r = radius * RNG.uniform(0.86, 1.0)
        verts.append((x + r * math.cos(angle), y + r * 0.84 * math.sin(angle), 0.0015))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], [tuple(range(count))])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    CURRENT.objects.link(obj)
    return finish(obj, name, mat)


def grass_tuft(name, x, y, base=0.0, scale=1.0):
    verts, faces = [], []
    for i in range(5):
        angle = RNG.uniform(0, TAU)
        distance = RNG.uniform(0.0, 0.032) * scale
        bx = x + math.cos(angle) * distance
        by = y + math.sin(angle) * distance
        height = RNG.uniform(0.065, 0.125) * scale
        width = RNG.uniform(0.008, 0.014) * scale
        tx = -math.sin(angle) * width
        ty = math.cos(angle) * width
        lean = RNG.uniform(0.012, 0.035) * scale
        start = len(verts)
        verts.extend(((bx - tx, by - ty, base), (bx + tx, by + ty, base), (bx + math.cos(angle) * lean, by + math.sin(angle) * lean, base + height)))
        faces.append((start, start + 1, start + 2))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    CURRENT.objects.link(obj)
    return finish(obj, name, RNG.choice(("grass_dark", "leaf_light", "leaf")))


def flower_patch(name, x, y, scale=1.0):
    grass_tuft(f"{name} · herbe", x, y, 0, 0.55 * scale)
    for i in range(3):
        xx = x + RNG.uniform(-0.045, 0.045) * scale
        yy = y + RNG.uniform(-0.045, 0.045) * scale
        height = RNG.uniform(0.055, 0.085) * scale
        tube(f"{name} · tige", (xx, yy, 0), (xx, yy, height), 0.0035 * scale, "leaf_dark", 6)
        ico(f"{name} · fleur", (xx, yy, height), (0.019 * scale, 0.019 * scale, 0.013 * scale), "flower" if i % 2 else "flower_light", 1, False)


def add_terrain_details(map_data):
    occupied = {(item["c"], item["r"]) for item in map_data["initial"]}
    hill_tiles = {(14, 8), (15, 8), (14, 9), (15, 9), (14, 10), (15, 10), (14, 11), (15, 11)}
    for r, row in enumerate(map_data["rowsData"]):
        for c, kind in enumerate(row):
            if kind == "W" or (c, r) in hill_tiles:
                continue
            cx, cy = tile_center(c, r)
            if kind == "T":
                terrain_floor_patch("Lisiere · sol organique", cx, cy, 0.46, "forest_floor")
                for i in range(3):
                    grass_tuft("Lisiere · herbes", cx + RNG.uniform(-0.34, 0.34), cy + RNG.uniform(-0.32, 0.32), 0.002, RNG.uniform(0.65, 1.05))
                if RNG.random() < 0.45:
                    flower_patch("Lisiere · fleurs", cx + RNG.uniform(-0.28, 0.28), cy + RNG.uniform(-0.28, 0.28), 0.85)
                if RNG.random() < 0.35:
                    ico("Lisiere · pierre", (cx - 0.29, cy + 0.25, 0.04), (0.09, 0.07, 0.055), "stone", 1, False)
            elif kind == "P":
                if (c, r) not in {(10, 5), (12, 5)} and RNG.random() < 0.45:
                    sx, sy = RNG.choice(((-1, -1), (-1, 1), (1, -1), (1, 1)))
                    grass_tuft("Chemin · bordure herbue", cx + sx * 0.38, cy + sy * 0.38, 0, 0.65)
            elif kind == "H" and (c, r) not in occupied:
                grass_tuft("Colline · herbe", cx - 0.35, cy + 0.30, 0, 0.85)
                ico("Colline · petit rocher", (cx + 0.34, cy - 0.33, 0.04), (0.075, 0.065, 0.055), "stone_light", 1, False)
            elif kind == "F" and (c, r) not in occupied:
                for j in range(3):
                    for i in range(2):
                        ico("Culture · jeune pousse", (cx + (i - 0.5) * 0.34, cy + (j - 1) * 0.16, 0.035), (0.028, 0.024, 0.040), "leaf_light", 1, False)
                if RNG.random() < 0.35:
                    grass_tuft("Culture · lisiere", cx + 0.39, cy + 0.36, 0, 0.60)
            elif kind == "." and (c, r) not in occupied:
                outer = c in (0, COLS - 1) or r in (0, ROWS - 1)
                if RNG.random() < (0.78 if outer else 0.28):
                    sx, sy = RNG.choice(((-1, -1), (-1, 1), (1, -1), (1, 1)))
                    x, y = cx + sx * 0.38, cy + sy * 0.38
                    grass_tuft("Prairie · touffe", x, y, 0, RNG.uniform(0.70, 1.15))
                    if RNG.random() < 0.25:
                        flower_patch("Prairie · fleurs", x - sx * 0.055, y - sy * 0.055, 0.80)
                    if outer and RNG.random() < 0.35:
                        ico("Prairie · pierre de bord", (cx + sx * 0.40, cy - sy * 0.35, 0.035), (0.075, 0.060, 0.045), "stone", 1, False)
    for r, row in enumerate(map_data["rowsData"]):
        for c, kind in enumerate(row):
            if kind != "W":
                continue
            cx, cy = tile_center(c, r)
            for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nc, nr = c + dc, r + dr
                if not (0 <= nc < COLS and 0 <= nr < ROWS) or map_data["rowsData"][nr][nc] in "WP":
                    continue
                if RNG.random() < 0.28:
                    if dc:
                        x, y = cx + dc * 0.54, cy + RNG.uniform(-0.30, 0.30)
                    else:
                        x, y = cx + RNG.uniform(-0.30, 0.30), cy - dr * 0.54
                    grass_tuft("Berge · herbe", x, y, 0, 0.70)
                    if RNG.random() < 0.22:
                        ico("Berge · galet", (x + 0.04, y, 0.025), (0.055, 0.045, 0.035), "stone_light", 1, False)


def build_terrain(map_data):
    global CURRENT
    collection = bpy.data.collections.new("TERRAIN · carte 16 × 12")
    CURRENT = collection
    ASSETS["terrain"] = collection
    box("Terrain · socle sombre", (0, 0, -0.585), (15.96, 11.96, 0.13), "soil_dark", 0.12)
    box("Terrain · terre", (0, 0, -0.385), (16.10, 12.10, 0.47), "soil", 0.12)
    box("Terrain · strate argile", (0, 0, -0.215), (16.06, 12.06, 0.085), "clay_layer", 0.035)
    for r, row in enumerate(map_data["rowsData"]):
        for c, kind in enumerate(row):
            if kind == "W":
                terrain_prism(f"Terrain · lit {c}/{r}", c, r, -0.15, "riverbed")
                cx, cy = tile_center(c, r)
                box(f"Riviere · eau {c}/{r}", (cx, cy, -0.105), (1.0, 1.0, 0.025), "water", 0)
                if (c + r) % 3 == 0:
                    for offset in (-0.16, 0.13):
                        box("Riviere · reflet", (cx + offset, cy, -0.089), (0.18, 0.025, 0.006), "water_light", 0.008, (0, 0, 0.25))
            else:
                RNG.choice(("grass", "grass", "grass_light", "grass_dark"))
                terrain_prism(f"Terrain · parcelle {c}/{r} {kind}", c, r, 0, "meadow")
                if kind == "F":
                    cx, cy = tile_center(c, r)
                    for j in range(4):
                        box("Terrain · sillon fertile", (cx, cy + (j - 1.5) * 0.16, 0.005), (0.72, 0.055, 0.008), "soil", 0.003)
    path_cells = {(c, r) for r, row in enumerate(map_data["rowsData"]) for c, kind in enumerate(row) if kind == "P"}
    for c, r in sorted(path_cells, key=lambda p: (p[1], p[0])):
        links = []
        for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (c + dc, r + dr)
            bridge_link = r == 5 and q == (11, 5) and c in (10, 12)
            if q in path_cells or bridge_link:
                links.append((dc, -dr))
        path_patch("Chemin · bord", c, r, links, 0.235, 0.004, "path_edge")
        path_patch("Chemin · terre battue", c, r, links, 0.19, 0.009, "path")
    hill_tiles = {(14, 8), (15, 8), (14, 9), (15, 9), (14, 10), (15, 10), (14, 11), (15, 11)}
    for c, r in sorted(hill_tiles, key=lambda p: (p[1], p[0])):
        cx, cy = tile_center(c, r)
        height = 0.16 + 0.055 * (c - 14) + 0.035 * (10 - min(r, 10))
        ico("Colline · roche-mere", (cx + 0.07, cy + 0.04, height * 0.25), (0.49, 0.47, height), "grass_dark", 2, False)
        ico("Colline · affleurement", (cx + 0.14, cy + 0.07, height * 0.75), (0.23, 0.20, 0.16), "stone", 1, False)
        if (c + r) % 2 == 0:
            tree("Colline · pin", cx - 0.15, cy + 0.10, height * 0.65, 0.64, True)
    for r, row in enumerate(map_data["rowsData"]):
        for c, kind in enumerate(row):
            if kind != "T" or (c, r) in hill_tiles:
                continue
            cx, cy = tile_center(c, r)
            count = 2 if RNG.random() < 0.38 else 1
            for i in range(count):
                x = cx + RNG.uniform(-0.20, 0.20)
                y = cy + RNG.uniform(-0.20, 0.20)
                tree(f"Foret · arbre {c}/{r}/{i}", x, y, 0, RNG.uniform(0.67, 0.96), RNG.random() < 0.40)
            if RNG.random() < 0.55:
                ico("Foret · rocher", (cx + 0.23, cy - 0.20, 0.075), (0.16, 0.12, 0.10), "stone", 1, False)
            for i in range(2):
                ico("Foret · buisson", (cx + RNG.uniform(-0.32, 0.32), cy + RNG.uniform(-0.32, 0.32), 0.08), (0.11, 0.10, 0.09), "leaf_light", 1, False)
    for c, r in ((11, 0), (10, 2), (10, 4), (11, 6), (10, 8), (9, 10)):
        cx, cy = tile_center(c, r)
        for i in range(3):
            x = cx - 0.34 + i * 0.055
            y = cy + 0.30
            tube("Riviere · roseau", (x, y, -0.10), (x + 0.02, y, 0.10 + i * 0.025), 0.008, "leaf_dark", 6)
            cylinder("Riviere · quenouille", (x + 0.02, y, 0.10 + i * 0.025), 0.015, 0.055, "wood", 8, edge=0.003)
    for c, r in ((12, 8), (13, 9), (12, 10)):
        cx, cy = tile_center(c, r)
        ico("Colline · borne", (cx + 0.37, cy + 0.35, 0.07), (0.12, 0.10, 0.09), "stone_light", 1, False)
    build_bridge()
    add_terrain_details(map_data)
    bpy.context.scene.collection.children.link(collection)
    return collection


def export_collection(name):
    collection = ASSETS[name]
    scene = bpy.context.scene
    source_linked = collection.name in scene.collection.children
    if not source_linked:
        scene.collection.children.link(collection)
    temp = bpy.data.collections.new(f"EXPORT · {name}")
    scene.collection.children.link(temp)
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in list(collection.objects):
        if obj.type not in {"MESH", "CURVE", "FONT", "SURFACE"}:
            continue
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph), preserve_all_data_layers=True, depsgraph=depsgraph)
        duplicate = bpy.data.objects.new(obj.name, mesh)
        duplicate.matrix_world = obj.matrix_world.copy()
        temp.objects.link(duplicate)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in temp.objects:
        obj.select_set(True)
    if not temp.objects:
        raise RuntimeError(f"Aucune géométrie pour {name}")
    bpy.context.view_layer.objects.active = next(iter(temp.objects))
    bpy.ops.object.join()
    joined = bpy.context.object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    materials = {slot.material for slot in joined.material_slots if slot.material}
    if len(materials) > 1:
        bpy.ops.mesh.separate(type="MATERIAL")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in temp.objects:
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        obj.name = f"{name} · {obj.active_material.name if obj.active_material else 'surface'}"
    bpy.ops.export_scene.gltf(
        filepath=str(OUT / f"{name}.glb"),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
        export_materials="EXPORT",
        export_extras=False,
    )
    bpy.ops.object.select_all(action="DESELECT")
    for obj in list(temp.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(temp)
    if not source_linked:
        scene.collection.children.unlink(collection)


def point_camera(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_area(scene, name, loc, energy, size, hex_value):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    data.color = color(hex_value)[:3]
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = loc
    point_camera(obj, (0, 0, 0))


def configure_render(scene, width, height):
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 40
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 3
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new(f"{scene.name} · monde")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = color("D8E2DE")
    background.inputs["Strength"].default_value = 0.65
    scene.view_settings.view_transform = "AgX"
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    scene.view_settings.exposure = 0.45


def create_presentation(map_data):
    scene = bpy.context.scene
    scene.name = "01 · Village composé"
    configure_render(scene, 1800, 1400)
    for name in MODEL_IDS:
        scene_for_asset = bpy.data.scenes.new(f"Asset · {name}")
        scene_for_asset.collection.children.link(ASSETS[name])
    for item in map_data["initial"]:
        x, y = tile_center(item["c"], item["r"])
        obj = bpy.data.objects.new(f"Village · {item['id']} · {item['c']}/{item['r']}", None)
        obj.instance_type = "COLLECTION"
        obj.instance_collection = ASSETS[item["id"]]
        obj.location = (x, y, 0)
        obj.rotation_euler.z = item["rotation"]
        scene.collection.objects.link(obj)
    ground = bpy.data.collections.new("PRESENTATION · sol et camera")
    scene.collection.children.link(ground)
    global CURRENT
    CURRENT = ground
    box("Presentation · fond", (0, 0, -0.70), (200, 200, 0.08), "ground", 0)
    camera_data = bpy.data.cameras.new("Camera village")
    camera = bpy.data.objects.new("Camera village", camera_data)
    ground.objects.link(camera)
    camera.location = (18.5, -23.5, 22.0)
    point_camera(camera, (0, 0, 0.10))
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 22.7
    scene.camera = camera
    add_area(scene, "Lumiere · grande cle", (-9, -11, 18), 1900, 9, "FFE2B7")
    add_area(scene, "Lumiere · ciel", (8, 6, 15), 1450, 11, "C6E1E2")
    add_area(scene, "Lumiere · douce", (2, -4, 10), 500, 8, "FFF0D8")
    return scene


def create_asset_sheet():
    scene = bpy.data.scenes.new("02 · Galerie des sept assets")
    configure_render(scene, 1800, 1100)
    global CURRENT
    collection = bpy.data.collections.new("PRESENTATION · galerie")
    scene.collection.children.link(collection)
    CURRENT = collection
    placements = [(-3.3, 1.25), (-1.1, 1.25), (1.1, 1.25), (3.3, 1.25), (-2.2, -1.35), (0, -1.35), (2.2, -1.35)]
    for name, (x, y) in zip(MODEL_IDS, placements):
        box(f"Galerie · socle {name}", (x, y, -0.055), (1.65, 1.65, 0.11), "plaster_light", 0.09)
        obj = bpy.data.objects.new(f"Galerie · {name}", None)
        obj.instance_type = "COLLECTION"
        obj.instance_collection = ASSETS[name]
        obj.location = (x, y, 0)
        collection.objects.link(obj)
    box("Galerie · fond", (0, 0, -0.14), (200, 200, 0.08), "ground", 0)
    camera_data = bpy.data.cameras.new("Camera galerie")
    camera = bpy.data.objects.new("Camera galerie", camera_data)
    collection.objects.link(camera)
    camera.location = (5.5, -9.5, 8.0)
    point_camera(camera, (0, 0, 0.28))
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 10.2
    scene.camera = camera
    add_area(scene, "Galerie · cle", (-4, -5, 9), 1050, 7, "FFE2B7")
    add_area(scene, "Galerie · ciel", (5, 4, 8), 850, 8, "D1E6E2")
    return scene


def mat_mul(a, b):
    return [sum(a[k * 4 + i] * b[j * 4 + k] for k in range(4)) for j in range(4) for i in range(4)]


def node_matrix(node):
    if "matrix" in node:
        return node["matrix"]
    translation = node.get("translation", (0, 0, 0))
    qx, qy, qz, qw = node.get("rotation", (0, 0, 0, 1))
    sx, sy, sz = node.get("scale", (1, 1, 1))
    matrix = [
        1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw), 0,
        2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw), 0,
        2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy), 0,
        0, 0, 0, 1,
    ]
    for i in range(3):
        matrix[i] *= sx
        matrix[4 + i] *= sy
        matrix[8 + i] *= sz
    matrix[12:15] = translation
    return matrix


def transform_point(matrix, point):
    x, y, z = point
    return tuple(matrix[i] * x + matrix[4 + i] * y + matrix[8 + i] * z + matrix[12 + i] for i in range(3))


def glb_bounds(document):
    identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    minimum = [math.inf] * 3
    maximum = [-math.inf] * 3

    def visit(index, parent):
        node = document["nodes"][index]
        world = mat_mul(parent, node_matrix(node))
        if "mesh" in node:
            for primitive in document["meshes"][node["mesh"]]["primitives"]:
                accessor = document["accessors"][primitive["attributes"]["POSITION"]]
                lo, hi = accessor["min"], accessor["max"]
                corners = [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
                for point in corners:
                    p = transform_point(world, point)
                    for axis in range(3):
                        minimum[axis] = min(minimum[axis], p[axis])
                        maximum[axis] = max(maximum[axis], p[axis])
        for child in node.get("children", []):
            visit(child, world)

    scene = document["scenes"][document.get("scene", 0)]
    for root in scene["nodes"]:
        visit(root, identity)
    return minimum, maximum


def validate_glb(path, name):
    raw = path.read_bytes()
    magic, version, total_length = struct.unpack_from("<4sII", raw, 0)
    assert magic == b"glTF" and version == 2 and total_length == len(raw), name
    json_length, chunk_type = struct.unpack_from("<II", raw, 12)
    assert chunk_type == 0x4E4F534A, name
    document = json.loads(raw[20:20 + json_length].decode("utf-8"))
    assert document.get("meshes") and document.get("materials"), name
    assert not any("uri" in item for item in document.get("images", [])), name
    assert not any("uri" in item for item in document.get("buffers", [])), name
    minimum, maximum = glb_bounds(document)
    dims = [maximum[i] - minimum[i] for i in range(3)]
    if name not in {"terrain", "terrain-game"}:
        assert dims[0] <= 0.951 and dims[2] <= 0.951, f"{name}: footprint {dims}"
        assert -0.002 <= minimum[1] <= 0.005, f"{name}: base Y={minimum[1]}"
        height_limit = 2.10 if name == "tower" else 1.70
        minimum_height = 0.45 if name in CATALOG_IDS and name not in {"path", "road"} else 0.001
        assert minimum_height <= maximum[1] <= height_limit, f"{name}: hauteur {maximum[1]}"
        assert len(document["meshes"]) <= 24, f"{name}: trop de meshes ({len(document['meshes'])})"
    else:
        assert abs(minimum[1] + 0.65) < 0.015, f"terrain: base {minimum[1]}"
        assert dims[0] >= 16 and dims[2] >= 12, f"terrain: dimensions {dims}"
        assert any("COLOR_0" in primitive["attributes"] for mesh in document["meshes"] for primitive in mesh["primitives"]), "terrain: teinte continue absente"
    triangles = 0
    for mesh in document["meshes"]:
        for primitive in mesh["primitives"]:
            if "indices" in primitive:
                triangles += document["accessors"][primitive["indices"]]["count"] // 3
    if name not in {"terrain", "terrain-game"}:
        assert triangles <= 25000, f"{name}: budget triangles {triangles}"
    if name in NEW_MODEL_IDS and (len(document["meshes"]) > 12 or triangles > 12000):
        print(f"BUDGET A OPTIMISER {name}: {len(document['meshes'])} meshes, {triangles} triangles")
    print(f"VALIDE {name:16s} | {len(raw) / 1024:8.1f} Kio | {len(document['meshes']):2d} meshes | {triangles:6d} tris | dimensions X/Y/Z {dims[0]:.3f}/{dims[1]:.3f}/{dims[2]:.3f} | minY {minimum[1]:.3f}")
    return {"min": minimum, "max": maximum, "dims": dims, "meshes": len(document["meshes"]), "triangles": triangles}


def validate_terrain_heights(map_data):
    scene = bpy.context.scene
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    buildable = 0
    river = 0
    for r, row in enumerate(map_data["rowsData"]):
        for c, kind in enumerate(row):
            if kind not in ".FHW":
                continue
            x, y = tile_center(c, r)
            sample_y = y + 0.42 if (c, r) == (11, 5) else y
            hit, location, _, _, _, _ = scene.ray_cast(depsgraph, Vector((x, sample_y, 2.0)), Vector((0, 0, -1.0)))
            assert hit, f"Aucune surface à {c}/{r}"
            if kind == "W":
                assert -0.14 < location.z < -0.07, f"Rivière non en retrait à {c}/{r}: {location.z}"
                river += 1
            else:
                assert abs(location.z) < 0.0001, f"Surface constructible non nulle à {c}/{r}: {location.z}"
                buildable += 1
    print(f"VALIDE hauteurs terrain | {buildable} centres constructibles Y=0 | {river} centres de rivière en retrait")


def shed_roof(name, cx, cy, width, depth, low, high, mat="copper", seams=5):
    run = width
    rise = high - low
    length = math.hypot(run, rise)
    angle = -math.atan2(rise, run)
    box(name, (cx, cy, (low + high) / 2), (length + 0.025, depth, 0.04), mat, 0.009, (0, angle, 0))
    for i in range(1, seams):
        x = cx - run / 2 + run * i / seams
        z = low + rise * i / seams + 0.025
        tube(f"{name} · joint", (x, cy - depth / 2, z), (x, cy + depth / 2, z), 0.009, "metal", 8)


def rollup_door(name, x, y, bottom, width, height, mat="copper"):
    box(f"{name} · cadre", (x, y, bottom + height / 2), (width + 0.05, 0.045, height + 0.045), "metal", 0.008)
    box(f"{name} · porte", (x, y - 0.026, bottom + height / 2), (width, 0.022, height), mat, 0.006)
    for i in range(1, 6):
        z = bottom + height * i / 6
        box(f"{name} · lame", (x, y - 0.041, z), (width - 0.015, 0.012, 0.012), "metal", 0.002)
    box(f"{name} · seuil", (x, y - 0.045, bottom - 0.015), (width + 0.08, 0.12, 0.04), "stone", 0.009)


def pallet(name, x, y, z=0.0, loaded=True):
    for yy in (-0.055, 0.055):
        box(f"{name} · semelle", (x, y + yy, z + 0.018), (0.23, 0.025, 0.035), "wood", 0.004)
    for xx in (-0.075, 0, 0.075):
        box(f"{name} · planche", (x + xx, y, z + 0.045), (0.055, 0.16, 0.025), "wood_light", 0.004)
    if loaded:
        crate(f"{name} · caisse", (x, y, z + 0.06), (0.20, 0.15, 0.13))


def valve(name, x, y, z, radius=0.045):
    torus(name, (x, y, z), radius, 0.009, "tile", (math.pi / 2, 0, 0), 16)
    tube(f"{name} · croix", (x - radius, y, z), (x + radius, y, z), 0.006, "tile", 8)
    tube(f"{name} · croix", (x, y, z - radius), (x, y, z + radius), 0.006, "tile", 8)


def industrial_window(name, x, y, z, width, height):
    box(f"{name} · cadre", (x, y, z), (width + 0.04, 0.03, height + 0.04), "metal", 0.005)
    box(f"{name} · vitre", (x, y - 0.018, z), (width, 0.014, height), "window", 0)
    box(f"{name} · meneau", (x, y - 0.028, z), (0.014, 0.012, height), "copper", 0)
    box(f"{name} · appui", (x, y - 0.022, z - height / 2 - 0.025), (width + 0.06, 0.06, 0.025), "stone", 0.005)


def simplify_bevels(name):
    for obj in ASSETS[name].objects:
        for modifier in obj.modifiers:
            if modifier.type == "BEVEL":
                modifier.segments = 1


def build_factory():
    new_asset("factory")
    box("Usine · dalle", (0, 0, 0.04), (0.91, 0.84, 0.08), "stone_dark", 0.025)
    box("Usine · hall principal", (-0.08, 0.06, 0.30), (0.64, 0.56, 0.44), "plaster", 0.022)
    box("Usine · aile", (0.27, 0.12, 0.25), (0.28, 0.43, 0.34), "plaster", 0.02)
    for cx in (-0.245, 0.105):
        shed_roof("Usine · shed", cx, 0.055, 0.35, 0.64, 0.54, 0.68, "copper", 4)
    for x in (-0.07, 0.28):
        box("Usine · claire-voie", (x, 0.055, 0.61), (0.018, 0.56, 0.14), "window", 0.003)
        for y in (-0.16, 0.0, 0.16):
            box("Usine · meneau claire-voie", (x - 0.012, y, 0.61), (0.018, 0.018, 0.15), "metal", 0.002)
    shed_roof("Usine · toit annexe", 0.27, 0.12, 0.34, 0.49, 0.45, 0.57, "copper", 4)
    rollup_door("Usine · quai", -0.10, -0.232, 0.10, 0.29, 0.34, "metal")
    industrial_window("Usine · fenetre", -0.32, -0.232, 0.34, 0.11, 0.15)
    industrial_window("Usine · fenetre", 0.15, -0.232, 0.34, 0.10, 0.15)
    for x, top in ((-0.28, 1.47), (0.12, 1.20)):
        bottom = 0.60
        cylinder("Usine · cheminee", (x, 0.18 if x < 0 else 0.22, (bottom + top) / 2), 0.055, top - bottom, "tile_dark", 16, radius_top=0.043, edge=0.006)
        for z in (bottom + 0.10, top - 0.10):
            torus("Usine · bague", (x, 0.18 if x < 0 else 0.22, z), 0.052, 0.011, "metal")
        cylinder("Usine · couronne", (x, 0.18 if x < 0 else 0.22, top - 0.015), 0.068, 0.03, "metal", 16, edge=0.004)
    pipe("Usine · conduite", [(0.34, 0.25, 0.18), (0.40, 0.20, 0.18), (0.40, -0.17, 0.18), (0.28, -0.22, 0.18)], 0.027, "copper_light")
    valve("Usine · vanne", 0.40, -0.19, 0.27, 0.042)
    for x in (-0.30, 0.08):
        cylinder("Usine · borne", (x, -0.37, 0.13), 0.025, 0.18, "crop", 10, edge=0.005)
        cylinder("Usine · bande borne", (x, -0.37, 0.15), 0.026, 0.035, "metal", 10, edge=0.002)
    rear_industrial_window("Usine · arriere fenetre", -0.28, 0.346, 0.33, 0.13, 0.14)
    rear_industrial_window("Usine · arriere fenetre", -0.05, 0.346, 0.33, 0.13, 0.14)
    rear_service_door("Usine · porte service", 0.27, 0.341, 0.08, 0.15, 0.28)
    tube("Usine · descente cuivre", (0.39, 0.35, 0.10), (0.39, 0.35, 0.43), 0.018, "copper_light")


def build_warehouse():
    new_asset("warehouse")
    box("Entrepot · dalle", (0, 0, 0.04), (0.91, 0.85, 0.08), "stone", 0.025)
    box("Entrepot · hall", (0, 0.05, 0.31), (0.78, 0.58, 0.46), "plaster", 0.022)
    gable_roof("Entrepot · toit", (0, 0.05), 0.88, 0.68, 0.54, 0.22, "copper", False)
    for y in (-0.22, -0.05, 0.12, 0.29):
        for side in (-1, 1):
            tube("Entrepot · couvre-joint", (side * 0.43, y, 0.56), (0, y, 0.785), 0.009, "metal", 8)
    for x in (-0.25, 0, 0.25):
        rollup_door("Entrepot · quai", x, -0.252, 0.12, 0.18, 0.29, "copper")
        box("Entrepot · auvent quai", (x, -0.34, 0.47), (0.23, 0.24, 0.035), "metal", 0.007, (0.12, 0, 0))
        cylinder("Entrepot · borne", (x + 0.105, -0.40, 0.12), 0.018, 0.16, "crop", 8, edge=0.004)
    front_window("Entrepot · imposte", 0, -0.255, 0.61, 0.16, 0.10, False, False)
    pallet("Entrepot · palette", -0.31, -0.36, 0.08, True)
    pallet("Entrepot · palette", 0.31, -0.36, 0.08, True)
    box("Entrepot · enseigne", (0.31, -0.259, 0.50), (0.12, 0.025, 0.07), "copper_light", 0.006)
    rear_industrial_window("Entrepot · arriere gauche", -0.24, 0.346, 0.34, 0.15, 0.14)
    rear_industrial_window("Entrepot · arriere droite", 0.24, 0.346, 0.34, 0.15, 0.14)
    rear_service_door("Entrepot · porte service", 0, 0.347, 0.08, 0.18, 0.30)


def build_water_plant():
    new_asset("water_plant")
    box("Station eau · dalle", (0, 0, 0.035), (0.92, 0.86, 0.07), "stone", 0.025)
    for cx in (-0.215, 0.205):
        cylinder("Station eau · fond reservoir", (cx, 0.11, 0.075), 0.205, 0.07, "metal", 20, edge=0.008)
        for i in range(16):
            a = TAU * i / 16
            box("Station eau · cuve", (cx + 0.185 * math.cos(a), 0.11 + 0.185 * math.sin(a), 0.245), (0.074, 0.035, 0.32), "copper", 0.005, (0, 0, a + math.pi / 2))
        cylinder("Station eau · eau", (cx, 0.11, 0.355), 0.172, 0.018, "water", 24, edge=0)
        torus("Station eau · margelle", (cx, 0.11, 0.415), 0.19, 0.025, "copper_light", major_segments=24)
        for z in (0.13, 0.32):
            torus("Station eau · ceinture", (cx, 0.11, z), 0.199, 0.012, "metal", major_segments=24)
        for i in range(8):
            a = TAU * i / 8
            x, y = cx + 0.205 * math.cos(a), 0.11 + 0.205 * math.sin(a)
            tube("Station eau · garde-corps", (x, y, 0.42), (x, y, 0.54), 0.008, "metal", 8)
        torus("Station eau · main courante", (cx, 0.11, 0.54), 0.205, 0.009, "metal", major_segments=24)
    box("Station eau · pompe", (0, -0.265, 0.21), (0.49, 0.24, 0.30), "plaster", 0.018)
    shed_roof("Station eau · toit pompe", 0, -0.265, 0.57, 0.30, 0.37, 0.45, "copper", 5)
    rollup_door("Station eau · acces", -0.10, -0.392, 0.08, 0.15, 0.23, "copper")
    front_window("Station eau · controle", 0.13, -0.392, 0.24, 0.11, 0.12, False, False)
    for cx in (-0.215, 0.205):
        pipe("Station eau · refoulement", [(cx, -0.07, 0.20), (cx, -0.14, 0.20), (cx * 0.55, -0.18, 0.20)], 0.026, "copper_light")
    pipe("Station eau · collecteur", [(-0.20, -0.18, 0.20), (0, -0.18, 0.20), (0.20, -0.18, 0.20)], 0.032, "copper")
    valve("Station eau · vanne", 0.02, -0.205, 0.29, 0.045)
    cylinder("Station eau · ventouse", (0.13, -0.24, 0.55), 0.035, 0.22, "metal", 12, edge=0.005)
    cylinder("Station eau · chapeau", (0.13, -0.24, 0.67), 0.055, 0.035, "copper_light", 12, edge=0.005)
    rear_industrial_window("Station eau · controle arriere", 0.10, -0.139, 0.24, 0.11, 0.12)
    rear_vent("Station eau · grille arriere", -0.13, -0.139, 0.23, 0.11, 0.11)
    simplify_bevels("water_plant")


def build_tower():
    new_asset("tower")
    box("Tour · socle", (0, 0, 0.04), (0.84, 0.72, 0.08), "stone", 0.025)
    box("Tour · volume principal", (0.06, 0.04, 0.835), (0.56, 0.52, 1.55), "plaster", 0.024)
    box("Tour · aile", (-0.27, 0.08, 0.585), (0.22, 0.44, 1.05), "plaster_rose", 0.022)
    box("Tour · attique", (0.08, 0.07, 1.76), (0.40, 0.40, 0.30), "plaster_rose", 0.018)
    box("Tour · toit terrasse", (0.08, 0.07, 1.94), (0.48, 0.48, 0.06), "copper", 0.012)
    box("Tour · toit aile", (-0.27, 0.08, 1.13), (0.28, 0.50, 0.06), "copper", 0.012)
    for z in (0.19, 0.56, 0.93, 1.30):
        box("Tour · bandeau", (0.06, -0.224, z), (0.56, 0.025, 0.035), "wood", 0.004)
    for floor, z in enumerate((0.36, 0.73, 1.10, 1.47)):
        for x in (-0.12, 0.24):
            front_window("Tour · fenetre", x, -0.226, z, 0.11, 0.19, False, False)
        box("Tour · porte balcon", (0.06, -0.238, z - 0.015), (0.12, 0.03, 0.23), "window", 0.006)
        if floor < 3:
            box("Tour · balcon", (0.06, -0.29, z - 0.145), (0.46, 0.16, 0.035), "plaster_rose", 0.007)
            for x in (-0.15, -0.06, 0.03, 0.12, 0.21, 0.27):
                tube("Tour · balustre", (x, -0.36, z - 0.125), (x, -0.36, z - 0.035), 0.006, "metal", 6)
            tube("Tour · rambarde", (-0.17, -0.36, z - 0.035), (0.29, -0.36, z - 0.035), 0.009, "metal", 8)
            if floor == 1:
                box("Tour · jardiniere", (0.19, -0.32, z - 0.09), (0.15, 0.08, 0.06), "wood_light", 0.006)
                for x in (0.14, 0.19, 0.24):
                    ico("Tour · plante", (x, -0.32, z - 0.045), (0.035, 0.03, 0.04), "leaf", 1, False)
    for z in (0.30, 0.60, 0.90):
        front_window("Tour · fenetre aile", -0.27, -0.146, z, 0.11, 0.16, False, False)
    for x in (-0.06, 0.08, 0.22):
        front_window("Tour · fenetre attique", x, -0.136, 1.77, 0.09, 0.15, False, False)
    for x in (-0.13, 0.29):
        tube("Tour · garde-corps toit", (x, -0.14, 1.97), (x, -0.14, 2.04), 0.008, "metal", 8)
    tube("Tour · rail toit", (-0.13, -0.14, 2.04), (0.29, -0.14, 2.04), 0.009, "metal", 8)
    cylinder("Tour · ventilateur", (0.08, 0.10, 2.005), 0.065, 0.09, "metal", 16, edge=0.006)
    torus("Tour · grille ventilateur", (0.08, 0.10, 2.052), 0.052, 0.007, "copper_light")
    for z in (0.36, 0.73, 1.10, 1.47):
        for x in (-0.08, 0.22):
            rear_window("Tour · arriere fenetre", x, 0.306, z, 0.11, 0.18, False)
    for z in (0.30, 0.60, 0.90):
        rear_window("Tour · arriere aile", -0.27, 0.306, z, 0.11, 0.16, False)
    for x in (0, 0.16):
        rear_window("Tour · arriere attique", x, 0.276, 1.77, 0.09, 0.15, False)
    simplify_bevels("tower")


def build_depot():
    new_asset("depot")
    box("Depot · dalle", (0, 0, 0.035), (0.82, 0.76, 0.07), "stone", 0.025)
    box("Depot · hall", (-0.04, 0.07, 0.26), (0.58, 0.46, 0.40), "plaster_rose", 0.022)
    gable_roof("Depot · toit", (-0.04, 0.07), 0.68, 0.55, 0.47, 0.17, "copper", False)
    rollup_door("Depot · quai", -0.08, -0.169, 0.09, 0.26, 0.29, "copper")
    front_window("Depot · fenetre", 0.20, -0.169, 0.31, 0.10, 0.13, False, False)
    box("Depot · auvent", (-0.08, -0.27, 0.42), (0.37, 0.25, 0.035), "wood_light", 0.008, (0.10, 0, 0))
    pallet("Depot · palette", 0.27, -0.25, 0.07, True)
    crate("Depot · petite caisse", (-0.31, -0.28, 0.07), (0.17, 0.15, 0.12))
    box("Depot · pancarte", (-0.28, -0.176, 0.42), (0.12, 0.025, 0.08), "copper_light", 0.006)
    rear_window("Depot · arriere fenetre", -0.13, 0.306, 0.31, 0.12, 0.14, False)
    rear_vent("Depot · grille arriere", 0.15, 0.306, 0.34, 0.11, 0.10)


def build_tram_car():
    new_asset("tram_car")
    for x in (-0.25, 0.25):
        for y in (-0.13, 0.13):
            cylinder("Rame · roue", (x, y, 0.055), 0.055, 0.032, "metal", 12, rot=(math.pi / 2, 0, 0), edge=0.005)
    box("Rame · châssis", (0, 0, 0.12), (0.78, 0.27, 0.08), "metal", 0.025)
    box("Rame · caisse", (0, 0, 0.255), (0.80, 0.28, 0.24), "copper", 0.045)
    box("Rame · bande creme", (0, -0.146, 0.18), (0.72, 0.018, 0.055), "plaster_light", 0.006)
    for x in (-0.27, -0.09, 0.09, 0.27):
        box("Rame · vitre", (x, -0.146, 0.29), (0.13, 0.018, 0.11), "window", 0.008)
        box("Rame · vitre arriere", (x, 0.146, 0.29), (0.13, 0.018, 0.11), "window", 0.008)
    for x in (-0.39, 0.39):
        box("Rame · face", (x, 0, 0.28), (0.018, 0.20, 0.12), "window", 0.008)
        for y in (-0.085, 0.085):
            cylinder("Rame · phare", (x, y, 0.18), 0.018, 0.018, "lantern", 12, rot=(0, math.pi / 2, 0), edge=0.003)
    box("Rame · toit", (0, 0, 0.405), (0.82, 0.31, 0.055), "copper_light", 0.025)
    for x in (-0.08, 0.08):
        beam("Rame · pantographe", (x - 0.05, 0, 0.435), (x + 0.05, 0, 0.55), 0.012, "metal")
    tube("Rame · perche", (-0.13, 0, 0.55), (0.13, 0, 0.55), 0.012, "metal")


def build_tram():
    car = ASSETS["tram_car"]
    new_asset("tram")
    collection = ASSETS["tram"]
    box("Tram · ballast", (0, 0.04, 0.01), (0.94, 0.34, 0.02), "stone_dark", 0.015)
    for y in (-0.08, 0.08):
        box("Tram · rail", (0, y, 0.035), (0.94, 0.018, 0.025), "metal", 0.004)
    for x in (-0.40, -0.28, -0.16, -0.04, 0.08, 0.20, 0.32, 0.42):
        box("Tram · traverse", (x, 0.04, 0.02), (0.035, 0.28, 0.025), "wood", 0.004)
    box("Tram · quai", (0, -0.325, 0.045), (0.91, 0.25, 0.09), "stone_light", 0.02)
    box("Tram · ligne quai", (0, -0.215, 0.094), (0.87, 0.025, 0.008), "road_line", 0.002)
    for x in (-0.39, 0.39):
        for y in (-0.40, -0.24):
            box("Tram · poteau", (x, y, 0.405), (0.032, 0.032, 0.66), "copper", 0.005)
    striped_awning("Tram · marquise", 0, 0.91, -0.46, -0.19, 0.72, 0.84, ("copper", "plaster_light"))
    for y in (-0.35, -0.31):
        box("Tram · banc", (0.20, y, 0.18), (0.31, 0.03, 0.03), "wood_light", 0.005)
    for x in (0.07, 0.33):
        box("Tram · pied banc", (x, -0.33, 0.13), (0.025, 0.06, 0.10), "metal", 0.004)
    box("Tram · totem", (-0.32, -0.31, 0.31), (0.12, 0.06, 0.43), "copper", 0.01)
    box("Tram · signe", (-0.32, -0.345, 0.42), (0.09, 0.015, 0.12), "plaster_light", 0.006)
    cylinder("Tram · horloge", (-0.32, -0.357, 0.42), 0.036, 0.012, "window", 16, rot=(math.pi / 2, 0, 0), edge=0.003)
    for obj in car.objects:
        collection.objects.link(obj)


def build_maint_center():
    new_asset("maint_center")
    box("Maintenance · dalle", (0, 0, 0.04), (0.91, 0.85, 0.08), "stone", 0.025)
    box("Maintenance · garage", (-0.07, 0.07, 0.32), (0.63, 0.52, 0.46), "plaster", 0.022)
    gable_roof("Maintenance · toit", (-0.07, 0.07), 0.74, 0.62, 0.56, 0.16, "copper", False)
    box("Maintenance · ouverture", (-0.10, -0.197, 0.31), (0.43, 0.035, 0.34), "metal", 0.01)
    box("Maintenance · linteau", (-0.10, -0.22, 0.50), (0.49, 0.06, 0.065), "crop", 0.008)
    for x in (-0.29, -0.19, -0.09, 0.01, 0.11):
        box("Maintenance · marquage", (x, -0.255, 0.50), (0.045, 0.012, 0.06), "metal", 0.002, (0, -0.35, 0))
    front_window("Maintenance · fenetre", 0.20, -0.197, 0.36, 0.10, 0.14, False, False)
    box("Maintenance · etabli", (-0.20, -0.29, 0.18), (0.28, 0.16, 0.055), "wood_light", 0.009)
    for x in (-0.30, -0.10):
        box("Maintenance · pied etabli", (x, -0.29, 0.105), (0.03, 0.10, 0.13), "metal", 0.004)
    box("Maintenance · vehicule", (0.08, -0.27, 0.19), (0.25, 0.18, 0.13), "copper_light", 0.025)
    for x in (-0.005, 0.165):
        for y in (-0.35, -0.19):
            cylinder("Maintenance · roue", (x, y, 0.11), 0.045, 0.025, "metal", 12, rot=(math.pi / 2, 0, 0), edge=0.004)
    box("Maintenance · vitre vehicule", (0.08, -0.27, 0.28), (0.14, 0.14, 0.09), "window", 0.015)
    cylinder("Maintenance · grue colonne", (0.34, -0.02, 0.58), 0.04, 1.04, "copper", 12, edge=0.006)
    beam("Maintenance · grue fleche", (0.34, -0.02, 1.12), (-0.28, -0.02, 1.12), 0.055, "crop")
    beam("Maintenance · grue contre-fleche", (0.34, -0.02, 0.90), (0.05, -0.02, 1.12), 0.025, "metal")
    tube("Maintenance · cable", (-0.20, -0.02, 1.10), (-0.20, -0.02, 0.73), 0.008, "metal", 8)
    torus("Maintenance · crochet", (-0.20, -0.02, 0.70), 0.028, 0.008, "metal", (math.pi / 2, 0, 0), 12)
    cylinder("Maintenance · grue embase", (0.34, -0.02, 0.08), 0.085, 0.10, "metal", 16, edge=0.008)
    rear_window("Maintenance · arriere fenetre", -0.22, 0.336, 0.35, 0.12, 0.14, False)
    rear_vent("Maintenance · grille arriere", 0.10, 0.336, 0.38, 0.12, 0.11)


def build_greenhouse():
    new_asset("greenhouse")
    box("Serre · dalle", (0, 0, 0.025), (0.89, 0.83, 0.05), "stone", 0.025)
    for x in (-0.17, 0.17):
        box("Serre · planche", (x, 0.02, 0.075), (0.22, 0.50, 0.055), "soil", 0.015)
        for y in (-0.16, 0, 0.16):
            for xx in (-0.045, 0.045):
                ico("Serre · culture", (x + xx, y + 0.02, 0.14), (0.055, 0.045, 0.07), "leaf_light" if y == 0 else "leaf", 1, False)
                ico("Serre · fruit", (x + xx, y - 0.005, 0.14), (0.018, 0.018, 0.022), "fruit_gold", 1, False)
    for x in (-0.36, 0.36):
        box("Serre · vitre laterale", (x, 0, 0.25), (0.012, 0.62, 0.34), "glass", 0)
        for y in (-0.31, 0, 0.31):
            box("Serre · montant", (x, y, 0.25), (0.025, 0.025, 0.40), "copper", 0.004)
    for y in (-0.31, 0.31):
        for x in (-0.24, 0, 0.24):
            box("Serre · vitre face", (x, y, 0.25), (0.22, 0.012, 0.34), "glass", 0)
        for x in (-0.36, -0.12, 0.12, 0.36):
            box("Serre · montant face", (x, y, 0.25), (0.025, 0.025, 0.40), "copper", 0.004)
        box("Serre · traverse", (0, y, 0.43), (0.75, 0.025, 0.025), "copper", 0.004)
    for side in (-1, 1):
        run, rise = 0.36, 0.26
        length = math.hypot(run, rise)
        angle = side * math.atan2(rise, run)
        box("Serre · vitre toit", (side * 0.18, 0, 0.56), (length, 0.64, 0.012), "glass", 0, (0, angle, 0))
        for y in (-0.32, 0, 0.32):
            tube("Serre · ferme toit", (side * 0.36, y, 0.43), (0, y, 0.69), 0.013, "copper", 8)
    tube("Serre · faitage", (0, -0.34, 0.69), (0, 0.34, 0.69), 0.018, "copper")
    box("Serre · porte", (0, -0.325, 0.235), (0.20, 0.025, 0.35), "copper", 0.006)
    box("Serre · porte vitree", (0, -0.342, 0.25), (0.15, 0.012, 0.27), "glass", 0)
    cylinder("Serre · poignee", (0.06, -0.355, 0.22), 0.009, 0.015, "metal", 8, rot=(math.pi / 2, 0, 0), edge=0.002)
    box("Serre · lanterneau", (0, 0.08, 0.735), (0.20, 0.25, 0.09), "glass", 0.004)
    box("Serre · capot", (0, 0.08, 0.79), (0.24, 0.29, 0.025), "copper", 0.006)
    cylinder("Serre · recuperateur", (0.36, 0.20, 0.17), 0.065, 0.25, "water", 14, edge=0.008)
    torus("Serre · cercle recuperateur", (0.36, 0.20, 0.20), 0.066, 0.008, "metal")


def build_recycler_rotor():
    new_asset("recycler_rotor")
    cylinder("Rotor · moyeu", (0, 0, 0.06), 0.05, 0.12, "metal", 16, edge=0.006)
    for i in range(6):
        a = TAU * i / 6
        x, y = 0.09 * math.cos(a), 0.09 * math.sin(a)
        box("Rotor · bras", (x, y, 0.065), (0.17, 0.035, 0.035), "copper_light", 0.005, (0, 0, a))
        box("Rotor · pale", (0.16 * math.cos(a), 0.16 * math.sin(a), 0.075), (0.065, 0.055, 0.07), "copper", 0.007, (0, 0, a))
    cylinder("Rotor · capuchon", (0, 0, 0.13), 0.035, 0.025, "copper_light", 16, edge=0.004)


def build_recycler():
    rotor = ASSETS["recycler_rotor"]
    new_asset("recycler")
    collection = ASSETS["recycler"]
    box("Recyclage · dalle", (0, 0, 0.04), (0.92, 0.86, 0.08), "stone_dark", 0.025)
    box("Recyclage · hall", (-0.10, 0.08, 0.29), (0.56, 0.48, 0.42), "plaster", 0.022)
    gable_roof("Recyclage · toit", (-0.10, 0.08), 0.66, 0.57, 0.51, 0.16, "copper", False)
    rollup_door("Recyclage · acces", -0.14, -0.169, 0.09, 0.23, 0.30, "copper")
    industrial_window("Recyclage · fenetre", 0.10, -0.169, 0.35, 0.10, 0.13)
    for x, mat in ((-0.29, "copper"), (0, "leaf"), (0.29, "crop")):
        box("Recyclage · container", (x, -0.31, 0.18), (0.20, 0.22, 0.25), mat, 0.018)
        box("Recyclage · couvercle", (x, -0.31, 0.325), (0.22, 0.24, 0.045), "metal", 0.009, (0.08, 0, 0))
        box("Recyclage · etiquette", (x, -0.427, 0.21), (0.075, 0.012, 0.075), "plaster", 0.006)
        tube("Recyclage · symbole", (x - 0.025, -0.437, 0.21), (x + 0.025, -0.437, 0.21), 0.006, mat, 6)
    box("Recyclage · tapis", (0.345, -0.10, 0.30), (0.18, 0.56, 0.04), "asphalt", 0.008, (0.70, 0, 0))
    for x in (0.25, 0.44):
        tube("Recyclage · rail convoyeur", (x, -0.36, 0.12), (x, 0.15, 0.49), 0.015, "metal")
    for i in range(5):
        y = -0.31 + i * 0.10
        z = 0.15 + i * 0.075
        tube("Recyclage · rouleau", (0.26, y, z), (0.43, y, z), 0.018, "copper_light")
    cylinder("Recyclage · support rotor", (0.20, 0.05, 0.63), 0.055, 0.14, "metal", 16, edge=0.006)
    for obj in rotor.objects:
        duplicate = obj.copy()
        duplicate.data = obj.data
        collection.objects.link(duplicate)
        duplicate.location += Vector((0.20, 0.05, 0.70))
    cylinder("Recyclage · event", (-0.27, 0.17, 0.79), 0.045, 0.25, "metal", 14, edge=0.006)
    cylinder("Recyclage · chapeau event", (-0.27, 0.17, 0.925), 0.065, 0.035, "copper_light", 14, edge=0.005)
    rear_industrial_window("Recyclage · arriere fenetre", -0.20, 0.326, 0.34, 0.12, 0.13)
    rear_vent("Recyclage · grille arriere", 0.02, 0.326, 0.34, 0.11, 0.11)
    tube("Recyclage · conduit arriere", (0.15, 0.34, 0.12), (0.15, 0.34, 0.48), 0.016, "copper_light")


def variant_links(variant):
    return {
        "end": ((1, 0),),
        "straight": ((1, 0), (-1, 0)),
        "corner": ((1, 0), (0, -1)),
        "tee": ((1, 0), (-1, 0), (0, -1)),
        "cross": ((1, 0), (-1, 0), (0, -1), (0, 1)),
    }[variant]


def transport_mesh(name, links, half_width, top, thickness, mat):
    a = half_width
    rectangles = [(-a, a, -a, a)]
    for dx, dy in links:
        if dx == 1:
            rectangles.append((a, 0.475, -a, a))
        elif dx == -1:
            rectangles.append((-0.475, -a, -a, a))
        elif dy == 1:
            rectangles.append((-a, a, a, 0.475))
        else:
            rectangles.append((-a, a, -0.475, -a))
    verts, faces = [], []
    for x0, x1, y0, y1 in rectangles:
        start = len(verts)
        verts.extend(((x0, y0, top), (x1, y0, top), (x1, y1, top), (x0, y1, top)))
        faces.append((start, start + 1, start + 2, start + 3))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    CURRENT.objects.link(obj)
    finish(obj, name, mat)
    solid = obj.modifiers.new("Epaisseur", "SOLIDIFY")
    solid.thickness = thickness
    solid.offset = -1
    return obj


def path_surface(links):
    transport_mesh("Chemin · bord", links, 0.24, 0.010, 0.010, "path_edge")
    transport_mesh("Chemin · surface", links, 0.20, 0.016, 0.006, "path")
    for dx, dy in links:
        distance = 0.30
        box("Chemin · pas", (dx * distance, dy * distance, 0.020), (0.09 if dx else 0.055, 0.055 if dx else 0.09, 0.008), "stone_light", 0.012)


def road_surface(links):
    transport_mesh("Route · accotement", links, 0.36, 0.012, 0.012, "stone_dark")
    transport_mesh("Route · chaussée", links, 0.31, 0.020, 0.008, "asphalt")
    for dx, dy in links:
        for distance in ((0.25, 0.40) if len(links) <= 2 else (0.34,)):
            box("Route · marquage", (dx * distance, dy * distance, 0.024), (0.10 if dx else 0.025, 0.025 if dx else 0.10, 0.006), "road_line", 0.003)


def build_path():
    new_asset("path")
    path_surface(variant_links("straight"))
    box("Chemin · poteau", (-0.31, 0.31, 0.17), (0.035, 0.035, 0.34), "wood", 0.006)
    box("Chemin · panneau", (-0.27, 0.31, 0.29), (0.19, 0.035, 0.075), "copper", 0.009)
    box("Chemin · panneau", (-0.29, 0.31, 0.20), (0.15, 0.035, 0.06), "wood_light", 0.008)
    cylinder("Chemin · borne", (-0.31, 0.31, 0.025), 0.055, 0.05, "stone", 12, edge=0.006)


def build_road():
    new_asset("road")
    road_surface(variant_links("straight"))
    for x, y in ((-0.34, 0.40), (0.34, -0.40)):
        cylinder("Route · borne", (x, y, 0.09), 0.025, 0.18, "metal", 10, edge=0.004)
        cylinder("Route · bande", (x, y, 0.13), 0.026, 0.04, "crop", 10, edge=0.002)


def tram_arm(dx, dy, start=0.0):
    end = 0.475
    if dx:
        for y in (-0.08, 0.08):
            tube("Rail · file", (dx * start, y, 0.043), (dx * end, y, 0.043), 0.012, "metal")
        for distance in (0.12, 0.24, 0.36, 0.455):
            if distance >= start:
                box("Rail · traverse", (dx * distance, 0, 0.026), (0.032, 0.26, 0.026), "wood", 0.004)
    else:
        for x in (-0.08, 0.08):
            tube("Rail · file", (x, dy * start, 0.043), (x, dy * end, 0.043), 0.012, "metal")
        for distance in (0.12, 0.24, 0.36, 0.455):
            if distance >= start:
                box("Rail · traverse", (0, dy * distance, 0.026), (0.26, 0.032, 0.026), "wood", 0.004)


def build_transport_variant(kind, variant):
    new_asset(f"{kind}_{variant}")
    links = variant_links(variant)
    if kind == "path":
        path_surface(links)
        return
    if kind == "road":
        road_surface(links)
        return
    transport_mesh("Tram · ballast bord", links, 0.24, 0.010, 0.010, "stone_dark")
    transport_mesh("Tram · ballast", links, 0.20, 0.017, 0.007, "stone")
    if variant == "corner":
        for radius in (0.14, 0.30):
            points = []
            for i in range(9):
                angle = math.pi / 2 + math.pi / 2 * i / 8
                points.append((0.22 + radius * math.cos(angle), -0.22 + radius * math.sin(angle), 0.043))
            pipe("Rail · courbe", points, 0.012, "metal")
        for y in (-0.08, 0.08):
            tube("Rail · est", (0.22, y, 0.043), (0.475, y, 0.043), 0.012, "metal")
        for x in (-0.08, 0.08):
            tube("Rail · sud", (x, -0.22, 0.043), (x, -0.475, 0.043), 0.012, "metal")
        box("Rail · traverse", (0.36, 0, 0.026), (0.032, 0.26, 0.026), "wood", 0.004)
        box("Rail · traverse", (0, -0.36, 0.026), (0.26, 0.032, 0.026), "wood", 0.004)
    else:
        for dx, dy in links:
            tram_arm(dx, dy)
    if variant == "end":
        for y in (-0.13, 0.13):
            box("Tram · butoir", (-0.04, y, 0.075), (0.035, 0.035, 0.13), "metal", 0.005)
        box("Tram · butoir traverse", (-0.04, 0, 0.13), (0.045, 0.33, 0.035), "wood", 0.005)


def build_forest():
    new_asset("forest")
    tree("Decor foret · grand", -0.16, 0.08, 0, 0.74, False)
    tree("Decor foret · sapin", 0.20, 0.14, 0, 0.69, True)
    rock = ico("Decor foret · rocher", (0.20, -0.25, 0.09), (0.15, 0.11, 0.085), "stone", 1, False)
    rock.rotation_euler.x = rock.rotation_euler.y = 0
    for x, y in ((-0.30, -0.23), (0.02, -0.28), (0.32, -0.12)):
        shrub = ico("Decor foret · buisson", (x, y, 0.085), (0.10, 0.09, 0.08), "leaf_light", 1, False)
        shrub.rotation_euler.x = shrub.rotation_euler.y = 0
        grass_tuft("Decor foret · herbe", x, y, 0, 0.75)


def build_hill():
    new_asset("hill")
    mound = ico("Decor colline · motte", (0, 0.03, 0.15), (0.43, 0.39, 0.15), "grass_dark", 2, False)
    mound.rotation_euler = (0, 0, 0)
    ico("Decor colline · roche", (0.12, 0.07, 0.24), (0.22, 0.18, 0.15), "stone", 1, False)
    ico("Decor colline · roche", (-0.19, -0.10, 0.16), (0.15, 0.13, 0.10), "stone_light", 1, False)
    grass_tuft("Decor colline · herbe", -0.25, 0.20, 0.19, 0.80)
    grass_tuft("Decor colline · herbe", 0.25, -0.16, 0.14, 0.70)


def build_fertile():
    new_asset("fertile")
    for j in range(4):
        y = (j - 1.5) * 0.18
        box("Decor fertile · sillon", (0, y, 0.012), (0.86, 0.065, 0.024), "soil", 0.009)
        for i in range(4):
            x = (i - 1.5) * 0.20
            ico("Decor fertile · pousse", (x, y, 0.06), (0.035, 0.030, 0.05), "leaf_light" if j % 2 else "leaf", 1, False)
            if j == 1:
                ico("Decor fertile · graine", (x, y, 0.075), (0.014, 0.014, 0.022), "crop", 1, False)


def load_game_map():
    data = json.loads((OUT / "game-map.json").read_text(encoding="utf-8"))
    assert set(data) == {"cols", "rows", "terrain"}
    assert data["cols"] == COLS and data["rows"] == ROWS
    assert len(data["terrain"]) == ROWS
    assert all(len(row) == COLS and all(value in (0, 1, 2, 3, 4) for value in row) for row in data["terrain"])
    return data


def build_game_terrain(data):
    global CURRENT
    collection = bpy.data.collections.new("GAME TERRAIN · La Vallée")
    CURRENT = collection
    ASSETS["terrain-game"] = collection
    box("Jeu · socle sombre", (0, 0, -0.585), (15.96, 11.96, 0.13), "soil_dark", 0.12)
    box("Jeu · terre", (0, 0, -0.385), (16.10, 12.10, 0.47), "soil", 0.12)
    box("Jeu · strate", (0, 0, -0.215), (16.06, 12.06, 0.085), "clay_layer", 0.035)
    for r, row in enumerate(data["terrain"]):
        for c, kind in enumerate(row):
            cx, cy = tile_center(c, r)
            if kind == 1:
                terrain_prism(f"Jeu · lit {c}/{r}", c, r, -0.15, "riverbed")
                box("Jeu · eau", (cx, cy, -0.105), (1, 1, 0.025), "water", 0)
                if (c + r) % 3 == 0:
                    box("Jeu · reflet", (cx - 0.13, cy + 0.08, -0.089), (0.22, 0.026, 0.006), "water_light", 0.006, (0, 0, 0.25))
                if (c + r) % 4 == 0:
                    for i in range(2):
                        x, y = cx - 0.32 + i * 0.06, cy + 0.30
                        tube("Jeu · roseau", (x, y, -0.10), (x + 0.015, y, 0.09 + i * 0.03), 0.007, "leaf_dark", 6)
            else:
                terrain_prism(f"Jeu · sol {c}/{r}", c, r, 0, "meadow")
                if kind == 0 and (c in (0, COLS - 1) or r in (0, ROWS - 1)) and RNG.random() < 0.40:
                    sx, sy = RNG.choice(((-1, -1), (-1, 1), (1, -1), (1, 1)))
                    grass_tuft("Jeu · herbe de bord", cx + sx * 0.38, cy + sy * 0.38, 0, 0.70)
    for r, row in enumerate(data["terrain"]):
        for c, kind in enumerate(row):
            if kind != 1:
                continue
            cx, cy = tile_center(c, r)
            for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nc, nr = c + dc, r + dr
                if not (0 <= nc < COLS and 0 <= nr < ROWS) or data["terrain"][nr][nc] == 1 or RNG.random() > 0.24:
                    continue
                if dc:
                    x, y = cx + dc * 0.54, cy + RNG.uniform(-0.28, 0.28)
                else:
                    x, y = cx + RNG.uniform(-0.28, 0.28), cy - dr * 0.54
                grass_tuft("Jeu · berge", x, y, 0, 0.65)
                if RNG.random() < 0.25:
                    ico("Jeu · galet", (x + 0.035, y, 0.025), (0.05, 0.04, 0.03), "stone_light", 1, False)
    return collection


def validate_game_terrain_heights(data):
    scene = bpy.context.scene
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    counts = {0: 0, 1: 0, 2: 0, 3: 0, 4: 0}
    for r, row in enumerate(data["terrain"]):
        for c, kind in enumerate(row):
            x, y = tile_center(c, r)
            hit, location, _, _, _, _ = scene.ray_cast(depsgraph, Vector((x, y, 2.0)), Vector((0, 0, -1.0)))
            assert hit, f"Jeu: surface absente à {c}/{r}"
            if kind == 1:
                assert -0.14 < location.z < -0.07, f"Jeu: rivière à {c}/{r} = {location.z}"
            else:
                assert abs(location.z) < 0.0001, f"Jeu: cellule {kind} à {c}/{r} = {location.z}"
            counts[kind] += 1
    print(f"VALIDE terrain jeu | {sum(counts.values()) - counts[1]} centres constructibles Y=0 | {counts[1]} centres rivière")


def instance_at(scene, name, asset, c, r, rotation=0):
    x, y = tile_center(c, r)
    obj = bpy.data.objects.new(name, None)
    obj.instance_type = "COLLECTION"
    obj.instance_collection = ASSETS[asset]
    obj.location = (x, y, 0)
    obj.rotation_euler.z = rotation
    scene.collection.objects.link(obj)
    return obj


def create_catalog_gallery():
    scene = bpy.data.scenes.new("03 · Catalogue des 18 assets")
    configure_render(scene, 2800, 1900)
    global CURRENT
    collection = bpy.data.collections.new("PRESENTATION · catalogue 18")
    scene.collection.children.link(collection)
    CURRENT = collection
    order = (
        "tower", "factory", "warehouse", "water_plant", "generator", "maint_center",
        "house", "well", "farm", "workshop", "market", "greenhouse",
        "park", "path", "road", "depot", "tram", "recycler",
    )
    assert set(order) == set(CATALOG_IDS)
    for index, name in enumerate(order):
        row, col = divmod(index, 6)
        x, y = (col - 2.5) * 1.70, 2.05 - row * 2.05
        box(f"Catalogue · socle {name}", (x, y, -0.05), (1.56, 1.56, 0.10), "plaster_light", 0.07)
        obj = bpy.data.objects.new(f"Catalogue · {name}", None)
        obj.instance_type = "COLLECTION"
        obj.instance_collection = ASSETS[name]
        obj.location = (x, y, 0)
        collection.objects.link(obj)
    box("Catalogue · fond", (0, 0, -0.13), (200, 200, 0.08), "ground", 0)
    camera_data = bpy.data.cameras.new("Camera catalogue 18")
    camera = bpy.data.objects.new("Camera catalogue 18", camera_data)
    collection.objects.link(camera)
    camera.location = (7.5, -11.5, 10.5)
    point_camera(camera, (0, 0, 0.40))
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 12.5
    scene.camera = camera
    add_area(scene, "Catalogue · cle", (-5, -6, 11), 1350, 8, "FFE2B7")
    add_area(scene, "Catalogue · ciel", (6, 4, 10), 1100, 9, "D1E6E2")
    for name in (*NEW_MODEL_IDS, "tram_car", "recycler_rotor", "forest", "hill", "fertile"):
        if f"Asset · {name}" not in bpy.data.scenes:
            source_scene = bpy.data.scenes.new(f"Asset · {name}")
            source_scene.collection.children.link(ASSETS[name])
    return scene


def create_game_presentation(data):
    scene = bpy.data.scenes.new("04 · La Vallée du jeu")
    scene.collection.children.link(ASSETS["terrain-game"])
    bpy.context.window.scene = scene
    configure_render(scene, 2100, 1550)
    validate_game_terrain_heights(data)
    placements = [
        ("house", 3, 0, 0), ("well", 5, 1, 0), ("farm", 2, 8, math.pi),
        ("workshop", 4, 6, 0), ("market", 6, 5, 0), ("generator", 12, 0, 0),
        ("park", 9, 8, 0), ("path", 5, 6, 0), ("road", 7, 5, 0),
        ("factory", 13, 1, 0), ("warehouse", 11, 1, 0), ("water_plant", 9, 3, 0),
        ("tower", 8, 1, 0), ("depot", 10, 5, 0), ("tram", 11, 6, 0),
        ("maint_center", 12, 4, 0), ("greenhouse", 4, 9, math.pi), ("recycler", 8, 6, 0),
    ]
    assert {item[0] for item in placements} == set(CATALOG_IDS)
    occupied = set()
    for name, c, r, rotation in placements:
        assert data["terrain"][r][c] != 1 and (c, r) not in occupied, (name, c, r)
        occupied.add((c, r))
        instance_at(scene, f"Jeu · {name} {c}/{r}", name, c, r, rotation)
    for r, row in enumerate(data["terrain"]):
        for c, kind in enumerate(row):
            if (c, r) in occupied or kind not in (2, 3, 4):
                continue
            asset = {2: "fertile", 3: "hill", 4: "forest"}[kind]
            instance_at(scene, f"Decor · {asset} {c}/{r}", asset, c, r, ((c * 3 + r) % 4) * math.pi / 2)
    instance_at(scene, "Jeu · route est 8/5", "road_straight", 8, 5)
    instance_at(scene, "Jeu · route est 9/5", "road_straight", 9, 5)
    instance_at(scene, "Jeu · rails 11/5", "tram_straight", 11, 5)
    global CURRENT
    collection = bpy.data.collections.new("PRESENTATION · vraie vallée")
    scene.collection.children.link(collection)
    CURRENT = collection
    box("Jeu · fond", (0, 0, -0.70), (200, 200, 0.08), "ground", 0)
    camera_data = bpy.data.cameras.new("Camera vraie vallée")
    camera = bpy.data.objects.new("Camera vraie vallée", camera_data)
    collection.objects.link(camera)
    camera.location = (18.5, -23.5, 22.0)
    point_camera(camera, (0, 0, 0.15))
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 22.8
    scene.camera = camera
    add_area(scene, "Jeu · cle", (-9, -11, 18), 1900, 9, "FFE2B7")
    add_area(scene, "Jeu · ciel", (8, 6, 15), 1450, 11, "C6E1E2")
    add_area(scene, "Jeu · douce", (2, -4, 10), 500, 8, "FFF0D8")
    return scene


def create_vegetation_preview():
    scene = bpy.data.scenes.new("05 · Étude de végétation")
    configure_render(scene, 1900, 1150)
    global CURRENT
    collection = bpy.data.collections.new("PRESENTATION · specimens arbres")
    scene.collection.children.link(collection)
    CURRENT = collection
    specimens = (
        ("Chene sculpte", -2.35, 0.15, 1.25, False),
        ("Tilleul asymetrique", -0.78, 0.05, 1.08, False),
        ("Sapin dentele", 0.82, 0.15, 1.30, True),
        ("Pin elance", 2.35, 0.05, 1.10, True),
    )
    for name, x, y, scale, pine in specimens:
        cylinder(f"Specimen · sol {name}", (x, y, -0.03), 0.64, 0.06, "grass_dark", 32, edge=0.015)
        tree(f"Specimen · {name}", x, y, 0, scale, pine)
        for angle in (0.4, 2.5, 4.6):
            gx, gy = x + math.cos(angle) * 0.48, y + math.sin(angle) * 0.48
            grass_tuft("Specimen · herbe", gx, gy, 0, 0.85)
        ico("Specimen · rocher", (x + 0.38, y - 0.31, 0.04), (0.09, 0.07, 0.05), "stone", 1, False)
    box("Specimen · fond", (0, 0, -0.075), (200, 200, 0.06), "ground", 0)
    camera_data = bpy.data.cameras.new("Camera végétation")
    camera = bpy.data.objects.new("Camera végétation", camera_data)
    collection.objects.link(camera)
    camera.location = (4.0, -7.5, 4.3)
    point_camera(camera, (0, 0, 0.52))
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 6.65
    scene.camera = camera
    add_area(scene, "Specimen · cle", (-4, -4, 8), 900, 6, "FFE2B7")
    add_area(scene, "Specimen · ciel", (4, 3, 7), 750, 7, "D1E6E2")
    return scene


def create_rear_preview():
    scene = bpy.data.scenes.new("06 · Façades arrière")
    configure_render(scene, 2200, 1600)
    global CURRENT
    collection = bpy.data.collections.new("PRESENTATION · facades arriere")
    scene.collection.children.link(collection)
    CURRENT = collection
    order = (
        "tower", "factory", "generator", "warehouse",
        "house", "farm", "workshop", "maint_center",
        "depot", "water_plant", "recycler", "greenhouse",
    )
    for index, name in enumerate(order):
        row, col = divmod(index, 4)
        x, y = (col - 1.5) * 1.65, 2.0 - row * 2.0
        box(f"Arriere · socle {name}", (x, y, -0.05), (1.50, 1.50, 0.10), "plaster_light", 0.07)
        obj = bpy.data.objects.new(f"Arriere · {name}", None)
        obj.instance_type = "COLLECTION"
        obj.instance_collection = ASSETS[name]
        obj.location = (x, y, 0)
        collection.objects.link(obj)
    box("Arriere · fond", (0, 0, -0.13), (200, 200, 0.08), "ground", 0)
    camera_data = bpy.data.cameras.new("Camera façades arrière")
    camera = bpy.data.objects.new("Camera façades arrière", camera_data)
    collection.objects.link(camera)
    camera.location = (6.5, 10.0, 8.0)
    point_camera(camera, (0, 0, 0.45))
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 9.7
    scene.camera = camera
    add_area(scene, "Arriere · cle", (-4, 6, 10), 1200, 7, "FFE2B7")
    add_area(scene, "Arriere · ciel", (5, -4, 8), 850, 8, "D1E6E2")
    return scene


def write_manifest(stats):
    models = {}
    for name in CATALOG_IDS:
        entry = {
            "file": f"{name}.glb",
            "footprint": 0.95,
            "height": round(stats[name]["max"][1], 3),
            "smoke": GAME_SMOKE.get(name),
        }
        if name == "recycler":
            entry["rotor"] = {"file": "recycler_rotor.glb", "anchor": ROTOR_ANCHOR, "axis": "y"}
        if name == "tram":
            entry["car"] = {"file": "tram_car.glb", "anchor": [0, 0, 0]}
        models[name] = entry
    variants = {}
    for kind in TRANSPORT_IDS:
        variants[kind] = {variant: f"{kind}_{variant}.glb" for variant in VARIANT_NAMES}
    manifest = {
        "terrain": "terrain-game.glb",
        "models": models,
        "transportVariants": variants,
        "decor": {"forest": "forest.glb", "hill": "hill.glb", "fertile": "fertile.glb"},
    }
    (OUT / "asset-manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    make_palette()
    for builder in (build_house, build_well, build_farm, build_workshop, build_market, build_generator, build_park):
        print(f"ETAPE {builder.__name__}", flush=True)
        builder()
    map_data = make_map()
    print("ETAPE terrain démo", flush=True)
    build_terrain(map_data)
    for builder in (
        build_factory, build_warehouse, build_water_plant, build_tower, build_depot,
        build_tram_car, build_tram, build_maint_center, build_greenhouse,
        build_recycler_rotor, build_recycler, build_path, build_road,
    ):
        print(f"ETAPE {builder.__name__}", flush=True)
        builder()
    for kind in TRANSPORT_IDS:
        for variant in VARIANT_NAMES:
            build_transport_variant(kind, variant)
    build_forest()
    build_hill()
    build_fertile()
    game_data = load_game_map()
    print("ETAPE terrain jeu", flush=True)
    build_game_terrain(game_data)
    variant_files = [f"{kind}_{variant}" for kind in TRANSPORT_IDS for variant in VARIANT_NAMES]
    export_names = [
        *MODEL_IDS, "terrain", *NEW_MODEL_IDS, "tram_car", "recycler_rotor",
        *variant_files, "forest", "hill", "fertile", "terrain-game",
    ]
    assert len(export_names) == 40 and len(set(export_names)) == 40
    for name in export_names:
        print(f"EXPORT {name}", flush=True)
        export_collection(name)
    validate_terrain_heights(map_data)
    village = create_presentation(map_data)
    gallery = create_asset_sheet()
    catalog = create_catalog_gallery()
    game_scene = create_game_presentation(game_data)
    vegetation_scene = create_vegetation_preview()
    rear_scene = create_rear_preview()
    bpy.context.window.scene = village
    bpy.ops.object.select_all(action="DESELECT")
    stats = {name: validate_glb(OUT / f"{name}.glb", name) for name in export_names}
    write_manifest(stats)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "palimpsity-diorama.blend"))
    if "--skip-render" not in sys.argv:
        for scene, filename in (
            (village, "preview.png"),
            (gallery, "assets-preview.png"),
            (catalog, "assets-preview-18.png"),
            (game_scene, "game-terrain-preview.png"),
            (vegetation_scene, "vegetation-preview.png"),
            (rear_scene, "rear-preview.png"),
        ):
            bpy.context.window.scene = scene
            scene.render.filepath = str(OUT / filename)
            bpy.ops.render.render(write_still=True, scene=scene.name)
        bpy.context.window.scene = village
        bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "palimpsity-diorama.blend"))
    print(f"DIORAMA PRET: {OUT} | 18 modèles, 15 variantes, 40 GLB")


if __name__ == "__main__":
    main()
