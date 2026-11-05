from __future__ import annotations

import json
import math
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Vector

OUT = Path(__file__).resolve().parent
DIORAMA = OUT.parent / "diorama"
EXPORT_DIR = DIORAMA / "layers"
MANIFEST_PATH = DIORAMA / "asset-manifest.json"
FLOOR_HEIGHT = 0.48
FAMILIES = ("banks", "works", "gardens")
CURRENT = None
MAT = {}
ASSETS = {}
TAU = math.tau


def linear_channel(value):
    value = value / 255.0
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def color(value):
    value = value.lstrip("#")
    return tuple(linear_channel(int(value[i:i + 2], 16)) for i in (0, 2, 4)) + (1.0,)


def make_material(name, value, roughness=0.8, metallic=0.0, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    rgba = color(value)
    mat.diffuse_color = rgba[:3] + (alpha,)
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = rgba
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Alpha"].default_value = alpha
    if alpha < 1:
        mat.surface_render_method = "DITHERED"
        shader.inputs["Transmission Weight"].default_value = 0.08
    MAT[name] = mat


def make_palette():
    values = {
        "ink": ("35394A", 0.72, 0.12),
        "mist": ("E0D8C6", 0.86, 0.0),
        "clay": ("A4523E", 0.9, 0.0),
        "ochre": ("D9A047", 0.78, 0.0),
        "plum": ("806484", 0.86, 0.0),
        "pine": ("82A48B", 0.94, 0.0),
        "river": ("4F9DA6", 0.34, 0.08),
        "plaster": ("DFE5E2", 0.94, 0.0),
        "brick": ("A4523E", 0.94, 0.0),
        "mortar": ("E0D8C6", 0.96, 0.0),
        "wood": ("675143", 0.9, 0.0),
        "patina": ("806484", 0.9, 0.0),
        "slate": ("465F78", 0.78, 0.05),
        "steel": ("35394A", 0.55, 0.48),
        "soil": ("5C4C3E", 1.0, 0.0),
        "leaf": ("82A48B", 0.96, 0.0),
        "glass": ("A7C4D2", 0.24, 0.08),
        "water": ("4F9DA6", 0.28, 0.06),
        "solar": ("35394A", 0.3, 0.34),
    }
    for name, (value, roughness, metallic) in values.items():
        make_material(name, value, roughness, metallic)


def move_to_current(obj):
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    CURRENT.objects.link(obj)
    return obj


def finish(obj, name, mat):
    obj.name = name
    if mat:
        obj.data.materials.append(MAT[mat])
    return obj


def bevel(obj, width=0.005, segments=2):
    if width:
        mod = obj.modifiers.new("Edge highlights", "BEVEL")
        mod.width = width
        mod.segments = segments
    return obj


def box(name, loc, dims, mat, edge=0.0, rot=None):
    x, y, z = (value / 2 for value in dims)
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
    return bevel(obj, min(edge, min(dims) * 0.2))


def cylinder(name, loc, radius, depth, mat, vertices=12, radius_top=None, rot=None):
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
    return obj


def beam(name, start, end, width, mat):
    start, end = Vector(start), Vector(end)
    direction = end - start
    obj = box(name, (start + end) / 2, (width, width, direction.length), mat)
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    return obj


def tube(name, start, end, radius, mat, vertices=10):
    start, end = Vector(start), Vector(end)
    direction = end - start
    obj = cylinder(name, (start + end) / 2, radius, direction.length, mat, vertices)
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    return obj


def ico(name, loc, scale, mat, subdivisions=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1, location=loc)
    obj = bpy.context.object
    move_to_current(obj)
    obj.scale = scale
    finish(obj, name, mat)
    return obj


def mesh_object(name, verts, faces, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    CURRENT.objects.link(obj)
    return finish(obj, name, mat)


def new_asset(key):
    global CURRENT
    collection = bpy.data.collections.new(key)
    bpy.context.scene.collection.children.link(collection)
    CURRENT = collection
    ASSETS[key] = collection


def family_style(family):
    return {
        "banks": ("plaster", "wood", "river"),
        "works": ("brick", "ink", "ochre"),
        "gardens": ("mist", "patina", "pine"),
    }[family]


def front_window(name, x, front, z, width=0.16, height=0.22, trim="wood", shutters=False, divisions=2):
    box(f"{name} glass", (x, front - 0.012, z), (width, 0.018, height), "glass")
    for dx in (-width / 2, width / 2):
        box(f"{name} jamb", (x + dx, front - 0.026, z), (0.018, 0.022, height + 0.035), trim)
    for dz in (-height / 2, height / 2):
        box(f"{name} rail", (x, front - 0.026, z + dz), (width + 0.035, 0.022, 0.018), trim)
    for index in range(1, divisions):
        dx = -width / 2 + width * index / divisions
        box(f"{name} mullion", (x + dx, front - 0.03, z), (0.01, 0.014, height), trim)
    box(f"{name} transom", (x, front - 0.031, z + height * 0.08), (width, 0.014, 0.01), trim)
    box(f"{name} sill", (x, front - 0.042, z - height / 2 - 0.022), (width + 0.065, 0.065, 0.025), trim)
    if shutters:
        for side in (-1, 1):
            sx = x + side * (width * 0.5 + 0.055)
            box(f"{name} shutter", (sx, front - 0.025, z), (0.075, 0.018, height), "river" if trim == "wood" else "pine")
            for offset in (-0.065, 0, 0.065):
                box(f"{name} shutter slat", (sx, front - 0.037, z + offset), (0.064, 0.008, 0.009), trim)


def side_window(name, side, plane, y, z, width=0.15, height=0.2, trim="wood"):
    x = side * (plane + 0.012)
    box(f"{name} glass", (x, y, z), (0.018, width, height), "glass")
    for dy in (-width / 2, width / 2):
        box(f"{name} jamb", (side * (plane + 0.026), y + dy, z), (0.022, 0.018, height + 0.03), trim)
    for dz in (-height / 2, height / 2):
        box(f"{name} rail", (side * (plane + 0.026), y, z + dz), (0.022, width + 0.03, 0.018), trim)
    box(f"{name} mullion", (side * (plane + 0.03), y, z), (0.014, 0.01, height), trim)


def front_door(name, x, front, bottom=0.05, width=0.17, height=0.32, mat="wood", glazed=True):
    z = bottom + height / 2
    box(f"{name} leaf", (x, front - 0.016, z), (width, 0.025, height), mat)
    for dx in (-width / 2 - 0.012, width / 2 + 0.012):
        box(f"{name} jamb", (x + dx, front - 0.03, z), (0.025, 0.035, height + (0.035 if bottom else 0.0)), "ink")
    box(f"{name} lintel", (x, front - 0.03, bottom + height + 0.018), (width + 0.06, 0.04, 0.035), "ink")
    if glazed:
        box(f"{name} light", (x, front - 0.032, bottom + height * 0.7), (width * 0.58, 0.012, height * 0.32), "glass")
    cylinder(f"{name} handle", (x + width * 0.3, front - 0.045, bottom + height * 0.43), 0.012, 0.018, "ochre", 10, rot=(math.pi / 2, 0, 0))
    box(f"{name} step", (x, front - 0.04, max(0.018, bottom - 0.018)), (width + 0.09, 0.08, 0.036), "mist")


def floor_deck(name, width, depth, mat="ink"):
    box(f"{name} cap", (0, 0, 0.4675), (width + 0.035, depth + 0.035, 0.025), mat)


def wall_shell(name, width, depth, wall, ground):
    bottom = 0.05 if ground else 0.0
    if ground:
        box(f"{name} plinth", (0, 0, 0.025), (width + 0.055, depth + 0.055, 0.05), "mist", 0.008)
        for x in (-0.29, 0, 0.29):
            if abs(x) < width / 2:
                box(f"{name} plinth joint", (x, -depth / 2 - 0.029, 0.025), (0.008, 0.006, 0.036), "ink")
    box(f"{name} walls", (0, 0, (bottom + 0.455) / 2), (width, depth, 0.455 - bottom), wall, 0.006)
    floor_deck(name, width, depth)
    return -depth / 2


def brick_courses(name, width, front, bottom=0.06, top=0.43):
    for row in range(5):
        z = bottom + (top - bottom) * row / 4
        box(f"{name} mortar course", (0, front - 0.004, z), (width - 0.025, 0.006, 0.006), "mortar")
    for x in (-width / 2 + 0.055, width / 2 - 0.055):
        for row in range(4):
            box(f"{name} quoin", (x, front - 0.011, 0.105 + row * 0.09), (0.09, 0.015, 0.035), "clay")


def timber_frame(name, width, front, bottom=0.05):
    for x in (-width / 2 + 0.025, 0, width / 2 - 0.025):
        box(f"{name} post", (x, front - 0.018, (bottom + 0.45) / 2), (0.032, 0.035, 0.45 - bottom), "wood")
    for z in (bottom + 0.025, 0.435):
        box(f"{name} beam", (0, front - 0.018, z), (width, 0.035, 0.032), "wood")
    if width > 0.7:
        beam(f"{name} brace", (-width / 2 + 0.05, front - 0.037, 0.34), (-0.05, front - 0.037, 0.43), 0.022, "wood")


def planter(name, x, y, bottom, width=0.22, flowers=False):
    box(f"{name} box", (x, y, bottom + 0.035), (width, 0.12, 0.07), "clay", 0.005)
    box(f"{name} soil", (x, y, bottom + 0.072), (width - 0.025, 0.095, 0.012), "soil")
    for index in range(4):
        px = x - width * 0.34 + index * width * 0.22
        ico(f"{name} leaves", (px, y, bottom + 0.105), (0.035, 0.034, 0.045), "pine" if index % 2 else "leaf")
        if flowers and index % 2:
            ico(f"{name} bloom", (px, y - 0.01, bottom + 0.142), (0.018, 0.018, 0.018), "plum")


def trellis(name, x, front, bottom=0.05, height=0.36, width=0.22):
    for dx in (-width / 2, 0, width / 2):
        box(f"{name} upright", (x + dx, front, bottom + height / 2), (0.014, 0.018, height), "patina")
    for index in range(5):
        z = bottom + 0.006 + (height - 0.012) * index / 4
        box(f"{name} cross", (x, front - 0.004, z), (width, 0.014, 0.012), "patina")
    for index in range(6):
        z = bottom + 0.035 + index * (height - 0.07) / 5
        dx = math.sin(index * 1.7) * width * 0.32
        ico(f"{name} vine", (x + dx, front - 0.025, z), (0.035, 0.02, 0.027), "pine")


def rainwater(name, x, front, bottom=0.05):
    tube(f"{name} downpipe", (x, front, bottom + 0.02), (x, front, 0.45), 0.012, "river")
    cylinder(f"{name} barrel", (x, front - 0.045, bottom + 0.055), 0.052, 0.11, "river", 14)
    for z in (bottom + 0.02, bottom + 0.09):
        cylinder(f"{name} hoop", (x, front - 0.045, z), 0.055, 0.012, "ink", 14)


def house_details(family, variant, width, front, ground):
    wall, trim, accent = family_style(family)
    bottom = 0.05 if ground else 0.0
    if family == "works":
        brick_courses("Works masonry", width, front, bottom + 0.01)
    elif family == "banks" and variant != 1:
        timber_frame("Banks timber", width, front, bottom)
    if variant == 0:
        front_door("Gallery entry", -0.19, front, bottom, mat=trim)
        front_window("Gallery window", 0.17, front, bottom + 0.215, 0.28 if family == "works" else 0.22, 0.25 if family == "works" else 0.23, trim, family == "banks", 2 if family == "works" else 3)
        if family == "banks":
            for x in (-0.34, 0.34):
                box("Gallery post", (x, front - 0.09, bottom + 0.19), (0.03, 0.03, 0.38), "wood")
            box("Gallery rail", (0, front - 0.1, bottom + 0.11), (0.72, 0.025, 0.025), "wood")
            for x in (-0.27, -0.09, 0.09, 0.27):
                box("Gallery baluster", (x, front - 0.1, bottom + 0.065), (0.015, 0.018, 0.09), "wood")
            rainwater("Banks rain chain", 0.365, front - 0.02, bottom)
        elif family == "gardens":
            box("Gardens terrace", (0, front - 0.06, bottom + 0.012), (0.70, 0.12, 0.024), "patina")
            trellis("Gallery espalier", 0.31, front - 0.035, bottom, 0.33, 0.15)
            planter("Gallery herbs", -0.02, front - 0.09, bottom, 0.25, True)
        else:
            for x in (-0.34, 0.34):
                box("Works steel column", (x, front - 0.025, bottom + 0.2), (0.035, 0.04, 0.4), "ink")
                for z in (bottom + 0.04, bottom + 0.35):
                    cylinder("Column rivet", (x, front - 0.05, z), 0.01, 0.008, "ochre", 8, rot=(math.pi / 2, 0, 0))
    elif variant == 1:
        front_door("Bay entry", -0.22, front, bottom, 0.15, 0.31, trim)
        bay_x = 0.13
        box("Projecting bay", (bay_x, front - 0.025, bottom + 0.19), (0.32, 0.05, 0.3), wall, 0.004)
        front_window("Bay front", bay_x, front - 0.052, bottom + 0.21, 0.28 if family == "works" else 0.24, 0.24 if family == "works" else 0.22, trim, False, 2 if family == "works" else 3)
        box("Bay cap", (bay_x, front - 0.03, bottom + 0.365), (0.36, 0.10, 0.025), accent)
        if family == "banks":
            box("Bay balcony", (bay_x, front - 0.075, bottom + 0.075), (0.39, 0.12, 0.025), "wood")
            for x in (-0.02, 0.09, 0.2, 0.31):
                box("Bay spindle", (x, front - 0.12, bottom + 0.125), (0.013, 0.013, 0.10), "wood")
            box("Bay handrail", (0.145, front - 0.12, bottom + 0.18), (0.38, 0.022, 0.02), "wood")
        elif family == "gardens":
            planter("Bay flowers", bay_x, front - 0.075, bottom + 0.07, 0.31, True)
        else:
            box("Bay canopy", (bay_x, front - 0.055, bottom + 0.385), (0.38, 0.10, 0.025), "steel")
    else:
        front_door("Townhouse entry", -0.27, front, bottom, 0.16, 0.35, trim)
        front_window("Townhouse pair", 0.02, front, bottom + 0.22, 0.26 if family == "works" else 0.21, 0.26, trim, family == "banks", 2 if family == "works" else 3)
        front_window("Townhouse narrow", 0.28, front, bottom + 0.22, 0.14 if family == "works" else 0.11, 0.26, trim, False, 1)
        box("Townhouse string course", (0, front - 0.022, bottom + 0.365), (width, 0.035, 0.025), accent)
        if family == "gardens":
            box("Townhouse terrace", (0.06, front - 0.04, bottom + 0.012), (0.42, 0.08, 0.024), "patina")
            trellis("Townhouse trellis", 0.37, front - 0.035, bottom, 0.36, 0.12)
        elif family == "banks":
            for x in (-0.37, 0.37):
                box("Townhouse pilaster", (x, front - 0.025, bottom + 0.19), (0.055, 0.045, 0.38), "plaster")
    side_window("Side light", 1, width / 2, 0.08, bottom + 0.22, 0.22 if family == "works" else 0.16, 0.23 if family == "works" else 0.2, trim)


def build_house(family, variant, ground=True):
    key = f"base_house_{family}_{variant}" if ground else f"floor_{family}_{variant}"
    new_asset(key)
    width, depth = ((0.78, 0.64), (0.68, 0.68), (0.82, 0.58))[variant]
    wall, _, _ = family_style(family)
    front = wall_shell(key, width, depth, wall, ground)
    house_details(family, variant, width, front, ground)


def workshop_details(family, variant, width, front):
    wall, trim, accent = family_style(family)
    bottom = 0.05
    door_width = 0.38 if variant == 0 else 0.30
    door_x = -0.12 if variant == 0 else -0.18
    box("Workshop loading door", (door_x, front - 0.016, 0.22), (door_width, 0.03, 0.34), trim)
    for index in range(5):
        box("Loading door slat", (door_x, front - 0.035, 0.075 + index * 0.07), (door_width - 0.02, 0.012, 0.012), accent)
    for x in (door_x - door_width / 2 - 0.025, door_x + door_width / 2 + 0.025):
        box("Loading jamb", (x, front - 0.025, 0.225), (0.04, 0.045, 0.39), "ink")
    front_window("Workshop task light", 0.25, front, 0.245, 0.18, 0.25, trim, False, 3)
    if variant == 1:
        box("Workshop awning", (0, front - 0.06, 0.41), (0.77, 0.12, 0.025), accent, rot=(0.10, 0, 0))
        for x in (-0.34, 0.34):
            beam("Awning brace", (x, front - 0.02, 0.30), (x, front - 0.10, 0.40), 0.018, "ink")
    if family == "works":
        brick_courses("Workshop brick", width, front)
        cylinder("Workshop vent", (0.29, 0.16, 0.43), 0.07, 0.05, "steel", 16)
        for index in range(5):
            box("Vent louvre", (0.29, 0.16, 0.456), (0.10, 0.012, 0.008), "ink", rot=(0, 0, index * math.pi / 5))
    elif family == "banks":
        timber_frame("Workshop frame", width, front)
        beam("Repair hoist", (-0.35, front - 0.04, 0.41), (-0.35, front - 0.12, 0.41), 0.03, "wood")
        tube("Hoist rope", (-0.35, front - 0.11, 0.40), (-0.35, front - 0.11, 0.26), 0.008, "ink", 8)
    else:
        trellis("Workshop green screen", 0.35, front - 0.035, bottom, 0.34, 0.13)
        planter("Workshop seedlings", 0.05, front - 0.07, bottom, 0.22)


def build_workshop(family, variant):
    new_asset(f"base_workshop_{family}_{variant}")
    width, depth = (0.82, 0.66) if variant == 0 else (0.76, 0.68)
    wall, _, _ = family_style(family)
    front = wall_shell("Workshop", width, depth, wall, True)
    workshop_details(family, variant, width, front)


def build_warehouse(family):
    new_asset(f"base_warehouse_{family}")
    width, depth = 0.88, 0.76
    wall, trim, accent = family_style(family)
    front = wall_shell("Warehouse", width, depth, wall, True)
    for x in (-0.22, 0.22):
        box("Warehouse loading bay", (x, front - 0.018, 0.225), (0.34, 0.035, 0.35), trim)
        for z in (0.09, 0.17, 0.25, 0.33):
            box("Warehouse bay slat", (x, front - 0.039, z), (0.30, 0.012, 0.012), accent)
        box("Warehouse dock", (x, front - 0.04, 0.045), (0.37, 0.08, 0.07), "ink")
    box("Warehouse clerestory", (0, front - 0.014, 0.415), (0.68, 0.022, 0.055), "glass")
    for x in (-0.30, -0.15, 0, 0.15, 0.30):
        box("Clerestory mullion", (x, front - 0.03, 0.415), (0.012, 0.015, 0.06), trim)
    if family == "works":
        brick_courses("Warehouse brick", width, front)
    elif family == "banks":
        rainwater("Warehouse water", 0.40, front + 0.02)
    else:
        planter("Warehouse garden", 0, front - 0.035, 0.08, 0.25, True)


def build_shop(family):
    new_asset(f"base_shop_{family}")
    width, depth = 0.78, 0.64
    wall, trim, accent = family_style(family)
    front = wall_shell("Shop", width, depth, wall, True)
    front_door("Shop door", -0.25, front, 0.05, 0.15, 0.32, trim)
    front_window("Shop display", 0.09, front, 0.225, 0.43, 0.27, trim, False, 3)
    box("Shop fascia", (0, front - 0.035, 0.405), (0.74, 0.055, 0.075), accent)
    for x in (-0.20, 0, 0.20):
        box("Shop sign mark", (x, front - 0.066, 0.405), (0.08, 0.012, 0.022), "plaster")
    for index in range(8):
        x = -0.315 + index * 0.09
        box("Shop striped awning", (x, front - 0.072, 0.35), (0.088, 0.15, 0.018), accent if index % 2 else "plaster", rot=(0.12, 0, 0))
    if family == "gardens":
        planter("Shop flowers", 0.25, front - 0.075, 0.055, 0.18, True)
    elif family == "works":
        brick_courses("Shop brick", width, front)


def build_civic():
    new_asset("base_civic")
    box("Civic foundation", (0, 0, 0.035), (0.92, 0.86, 0.07), "mist", 0.01)
    box("Civic hall", (0, 0.03, 0.35), (0.78, 0.66, 0.63), "plaster", 0.008)
    for x in (-0.30, -0.10, 0.10, 0.30):
        box("Civic portico column", (x, -0.36, 0.32), (0.055, 0.055, 0.50), "plaster")
        box("Civic column foot", (x, -0.36, 0.085), (0.085, 0.085, 0.05), "mist")
        box("Civic capital", (x, -0.36, 0.56), (0.085, 0.085, 0.05), "mist")
    box("Civic entablature", (0, -0.35, 0.61), (0.82, 0.16, 0.10), "ochre")
    front_door("Civic door", 0, -0.31, 0.07, 0.24, 0.43, "wood")
    for x in (-0.25, 0.25):
        front_window("Civic window", x, -0.305, 0.37, 0.15, 0.27, "wood")
    box("Civic tower", (0, 0.10, 0.77), (0.30, 0.30, 0.30), "clay", 0.006)
    cylinder("Civic clock", (0, -0.058, 0.79), 0.105, 0.025, "plaster", 24, rot=(math.pi / 2, 0, 0))
    tube("Clock hand", (0, -0.076, 0.79), (0, -0.076, 0.86), 0.009, "ink", 8)
    tube("Clock hand", (0, -0.077, 0.79), (0.055, -0.077, 0.765), 0.009, "ink", 8)
    hip_roof("Civic roof", 0, 0.02, 0.90, 0.78, 0.665, 0.22, "slate")
    cylinder("Civic finial", (0, 0.10, 0.99), 0.035, 0.18, "ochre", 12, radius_top=0.008)


def gable_roof(name, cx, cy, width, depth, base, rise, mat, seams=True):
    w, d = width / 2, depth / 2
    verts = [
        (cx - w, cy - d, base), (cx + w, cy - d, base), (cx, cy - d, base + rise),
        (cx - w, cy + d, base), (cx + w, cy + d, base), (cx, cy + d, base + rise),
    ]
    mesh_object(name, verts, [(0, 1, 2), (5, 4, 3), (0, 2, 5, 3), (2, 1, 4, 5), (0, 3, 4, 1)], mat)
    if seams:
        for side in (-1, 1):
            for index in range(1, 6):
                t = index / 6
                x = cx + side * w * t
                z = base + rise * (1 - t) + 0.008
                tube(f"{name} standing seam", (x, cy - d, z), (x, cy + d, z), 0.006, "ink" if mat == "steel" else mat, 8)
        tube(f"{name} ridge", (cx, cy - d - 0.005, base + rise + 0.008), (cx, cy + d + 0.005, base + rise + 0.008), 0.012, mat, 10)


def hip_roof(name, cx, cy, width, depth, base, rise, mat):
    w, d = width / 2, depth / 2
    ridge = max(0.0, d - w * 0.65)
    verts = [
        (cx - w, cy - d, base), (cx + w, cy - d, base), (cx + w, cy + d, base), (cx - w, cy + d, base),
        (cx, cy - ridge, base + rise), (cx, cy + ridge, base + rise),
    ]
    mesh_object(name, verts, [(0, 1, 4), (1, 2, 5, 4), (2, 3, 5), (3, 0, 4, 5), (0, 3, 2, 1)], mat)
    tube(f"{name} ridge", (cx, cy - ridge, base + rise + 0.007), (cx, cy + ridge, base + rise + 0.007), 0.01, mat, 10)
    for x in (-w * 0.65, 0, w * 0.65):
        z = base + rise * (1 - abs(x) / w) + 0.006
        tube(f"{name} hip seam", (cx + x, cy - d, base + 0.008), (cx, cy - ridge, z + rise * 0.15), 0.005, mat, 8)


def dormer(name, x, front, base, mat="plaster", roof_mat="slate"):
    box(f"{name} face", (x, front, base + 0.07), (0.18, 0.14, 0.14), mat)
    front_window(f"{name} light", x, front - 0.075, base + 0.075, 0.11, 0.09, "wood", False, 1)
    gable_roof(f"{name} cap", x, front - 0.005, 0.22, 0.18, base + 0.14, 0.08, roof_mat, False)


def build_traditional_roof(family, variant):
    new_asset(f"roof_traditional_{family}_{variant}")
    if family == "banks":
        if variant == 0:
            gable_roof("Banks slate gable", 0, 0, 0.90, 0.76, 0, 0.28, "slate")
            box("Banks chimney", (0.25, 0.16, 0.25), (0.11, 0.12, 0.24), "clay")
            box("Chimney cap", (0.25, 0.16, 0.375), (0.14, 0.15, 0.025), "ink")
            tube("Banks gutter", (-0.45, -0.385, 0.015), (0.45, -0.385, 0.015), 0.012, "river")
        else:
            hip_roof("Banks hipped slate", 0, 0, 0.90, 0.78, 0, 0.25, "slate")
            dormer("Banks dormer", 0, -0.29, 0.07)
    elif family == "works":
        if variant == 0:
            for index in range(3):
                x = -0.30 + index * 0.30
                verts = [
                    (x - 0.15, -0.38, 0), (x + 0.15, -0.38, 0.20), (x + 0.15, -0.38, 0),
                    (x - 0.15, 0.38, 0), (x + 0.15, 0.38, 0.20), (x + 0.15, 0.38, 0),
                ]
                mesh_object("Works sawtooth", verts, [(0, 1, 4, 3), (1, 2, 5, 4), (0, 3, 5, 2, 1)], "steel")
                mesh_object("Works northlight", [(x + 0.151, -0.36, 0.015), (x + 0.151, 0.36, 0.015), (x + 0.151, 0.36, 0.19), (x + 0.151, -0.36, 0.19)], [(0, 1, 2, 3)], "glass")
                for y in (-0.25, 0, 0.25):
                    box("Northlight mullion", (x + 0.155, y, 0.10), (0.012, 0.015, 0.18), "ink")
        else:
            gable_roof("Works steel gable", 0, 0, 0.90, 0.78, 0, 0.22, "steel")
            box("Works roof monitor", (0, 0.04, 0.24), (0.38, 0.40, 0.12), "glass")
            for x in (-0.18, 0, 0.18):
                box("Monitor frame", (x, -0.17, 0.24), (0.018, 0.025, 0.13), "ink")
            gable_roof("Monitor cap", 0, 0.04, 0.44, 0.46, 0.30, 0.10, "steel")
    else:
        if variant == 0:
            gable_roof("Gardens plum gable", 0, 0, 0.90, 0.76, 0, 0.24, "plum")
            for x in (-0.30, -0.15, 0, 0.15, 0.30):
                tube("Gardens tile roll", (x, -0.38, 0.24 * (1 - abs(x) / 0.45) + 0.008), (x, 0.38, 0.24 * (1 - abs(x) / 0.45) + 0.008), 0.012, "plum", 10)
        else:
            hip_roof("Gardens pavilion hip", 0, 0, 0.90, 0.78, 0, 0.21, "patina")
            dormer("Gardens skylight dormer", -0.12, -0.28, 0.06, "mist", "plum")
            planter("Gardens roof planter", 0.27, 0.03, 0.04, 0.18, True)


def roof_deck(name, mat="patina"):
    box(f"{name} deck", (0, 0, 0.015), (0.90, 0.80, 0.03), mat)
    for y in (-0.385, 0.385):
        box(f"{name} parapet", (0, y, 0.065), (0.90, 0.03, 0.10), mat)
    for x in (-0.435, 0.435):
        box(f"{name} parapet", (x, 0, 0.065), (0.03, 0.75, 0.10), mat)


def solar_panel(name, x, y, z, width=0.32, depth=0.28):
    angle = 0.22
    box(f"{name} panel", (x, y, z), (width, depth, 0.018), "solar", rot=(angle, 0, 0))
    for dx in (-width / 3, 0, width / 3):
        box(f"{name} cell bus", (x + dx, y, z + 0.012), (0.006, depth - 0.02, 0.006), "mist", rot=(angle, 0, 0))
    for dy in (-depth / 4, 0, depth / 4):
        box(f"{name} cell row", (x, y + dy, z + 0.012 + math.sin(angle) * dy), (width - 0.02, 0.006, 0.006), "mist", rot=(angle, 0, 0))
    for dx in (-width * 0.35, width * 0.35):
        beam(f"{name} support", (x + dx, y, 0.03), (x + dx, y, z - 0.02), 0.018, "steel")


def build_garden_roof(family):
    new_asset(f"roof_garden_{family}")
    roof_deck("Roof garden", "patina" if family == "gardens" else "ink")
    for x, y in ((-0.25, -0.18), (0.22, -0.18), (-0.22, 0.19)):
        planter("Roof crops", x, y, 0.03, 0.28, family == "gardens")
        for index in range(3):
            ico("Roof crop top", (x - 0.08 + index * 0.08, y, 0.19), (0.035, 0.04, 0.055), "leaf")
    if family == "banks":
        cylinder("Roof garden cistern", (0.27, 0.20, 0.14), 0.12, 0.22, "river", 16)
        tube("Cistern overflow", (0.27, 0.20, 0.25), (0.39, 0.20, 0.25), 0.015, "river")
    elif family == "works":
        box("Roof garden tool locker", (0.25, 0.20, 0.13), (0.25, 0.22, 0.20), "steel")
        for z in (0.08, 0.13, 0.18):
            box("Locker louvre", (0.25, 0.084, z), (0.18, 0.012, 0.012), "ink")
    else:
        for x in (0.12, 0.36):
            box("Roof pergola post", (x, 0.20, 0.18), (0.025, 0.025, 0.30), "patina")
        for y in (0.08, 0.20, 0.32):
            box("Roof pergola slat", (0.24, y, 0.33), (0.32, 0.025, 0.025), "patina")
        ico("Pergola vine", (0.23, 0.19, 0.31), (0.17, 0.13, 0.055), "pine")


def build_productive_roof(family):
    new_asset(f"roof_productive_{family}")
    roof_deck("Productive roof", "ink" if family == "works" else "patina")
    if family == "gardens":
        box("Greenhouse base", (0, 0, 0.055), (0.65, 0.52, 0.05), "mist")
        for x in (-0.31, 0.31):
            box("Greenhouse wall", (x, 0, 0.19), (0.018, 0.50, 0.27), "glass")
        for y in (-0.25, 0.25):
            box("Greenhouse end", (0, y, 0.19), (0.62, 0.018, 0.27), "glass")
        for x in (-0.31, 0, 0.31):
            for y in (-0.25, 0.25):
                box("Greenhouse frame", (x, y, 0.19), (0.018, 0.018, 0.29), "pine")
        gable_roof("Greenhouse glass roof", 0, 0, 0.68, 0.56, 0.32, 0.16, "glass", False)
        tube("Greenhouse ridge", (0, -0.29, 0.48), (0, 0.29, 0.48), 0.014, "pine")
        for y in (-0.20, 0, 0.20):
            beam("Greenhouse rafter", (-0.34, y, 0.32), (0, y, 0.48), 0.014, "pine")
            beam("Greenhouse rafter", (0.34, y, 0.32), (0, y, 0.48), 0.014, "pine")
        for x in (-0.17, 0.17):
            planter("Greenhouse bed", x, 0, 0.08, 0.20)
    else:
        solar_panel("Solar west", -0.20, -0.08, 0.18)
        solar_panel("Solar east", 0.20, -0.08, 0.18)
        if family == "banks":
            cylinder("Productive water tank", (0.24, 0.23, 0.17), 0.12, 0.28, "river", 16)
            cylinder("Tank cap", (0.24, 0.23, 0.315), 0.13, 0.025, "ink", 16)
            tube("Tank feed", (0.24, 0.23, 0.04), (0.37, 0.23, 0.04), 0.015, "river")
        else:
            cylinder("Works exhaust", (-0.25, 0.24, 0.18), 0.075, 0.30, "steel", 14)
            cylinder("Exhaust cowl", (-0.25, 0.24, 0.34), 0.11, 0.035, "ink", 14)
            box("Inverter", (0.22, 0.25, 0.13), (0.20, 0.12, 0.18), "mist")


def build_conversion_workshop():
    new_asset("conversion_workshop_repair")
    front = wall_shell("Repair hall", 0.86, 0.70, "clay", True)
    workshop_details("works", 1, 0.86, front)
    box("Repair tool board", (0.29, front - 0.06, 0.19), (0.18, 0.035, 0.22), "wood")
    for index in range(4):
        tube("Repair tool", (0.23 + index * 0.04, front - 0.085, 0.12), (0.23 + index * 0.04, front - 0.085, 0.25), 0.009, "steel", 8)
    cylinder("Repair cable reel", (-0.32, front - 0.065, 0.13), 0.075, 0.08, "ochre", 14, rot=(math.pi / 2, 0, 0))


def build_conversion_warehouse():
    new_asset("conversion_warehouse_hall")
    width, depth = 0.89, 0.78
    front = wall_shell("Public hall", width, depth, "mist", True)
    for x in (-0.25, 0, 0.25):
        front_door("Hall entry", x, front, 0.05, 0.18, 0.34, "patina")
    box("Hall clerestory", (0, front - 0.02, 0.415), (0.78, 0.03, 0.065), "glass")
    for x in (-0.34, -0.17, 0, 0.17, 0.34):
        box("Hall clerestory frame", (x, front - 0.042, 0.415), (0.015, 0.015, 0.07), "ink")
    for index in range(9):
        x = -0.36 + index * 0.09
        box("Hall canopy", (x, front - 0.04, 0.36), (0.088, 0.08, 0.02), "ochre" if index % 2 else "plaster")


def export_asset(key):
    collection = ASSETS[key]
    temp = bpy.data.collections.new(f"EXPORT {key}")
    bpy.context.scene.collection.children.link(temp)
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in list(collection.objects):
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph), preserve_all_data_layers=True, depsgraph=depsgraph)
        duplicate = bpy.data.objects.new(obj.name, mesh)
        duplicate.matrix_world = obj.matrix_world.copy()
        temp.objects.link(duplicate)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in temp.objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = next(iter(temp.objects))
    bpy.ops.object.join()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.mesh.separate(type="MATERIAL")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in temp.objects:
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        obj.name = f"{key} {obj.active_material.name}"
    bpy.ops.export_scene.gltf(
        filepath=str(EXPORT_DIR / f"{key}.glb"),
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
        2 * (qx * qz + qy * qz), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy), 0,
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
                for x in (lo[0], hi[0]):
                    for y in (lo[1], hi[1]):
                        for z in (lo[2], hi[2]):
                            point = transform_point(world, (x, y, z))
                            for axis in range(3):
                                minimum[axis] = min(minimum[axis], point[axis])
                                maximum[axis] = max(maximum[axis], point[axis])
        for child in node.get("children", []):
            visit(child, world)

    for root in document["scenes"][document.get("scene", 0)]["nodes"]:
        visit(root, identity)
    return minimum, maximum


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
    minimum, maximum = glb_bounds(document)
    dims = [maximum[i] - minimum[i] for i in range(3)]
    assert dims[0] <= 0.9501 and dims[2] <= 0.9501, f"{key}: footprint {dims}"
    assert minimum[0] >= -0.4751 and maximum[0] <= 0.4751, f"{key}: X bounds {minimum[0]}, {maximum[0]}"
    assert minimum[2] >= -0.4751 and maximum[2] <= 0.4751, f"{key}: Z bounds {minimum[2]}, {maximum[2]}"
    assert abs(minimum[1]) <= 0.0001, f"{key}: base Y {minimum[1]}"
    is_level = key.startswith("floor_") or (key.startswith("base_") and key != "base_civic") or key.startswith("conversion_")
    if is_level:
        assert abs(maximum[1] - FLOOR_HEIGHT) <= 0.0001, f"{key}: top Y {maximum[1]}"
    else:
        assert maximum[1] > 0.08, f"{key}: roof/civic height {maximum[1]}"
    triangles = 0
    for mesh in document["meshes"]:
        for primitive in mesh["primitives"]:
            if "indices" in primitive:
                triangles += document["accessors"][primitive["indices"]]["count"] // 3
    assert triangles <= 12000, f"{key}: {triangles} triangles"
    assert len(document["meshes"]) <= 20, f"{key}: {len(document['meshes'])} meshes"
    assert len(raw) <= 512 * 1024, f"{key}: {len(raw)} bytes"
    print(f"VALID {key:34s} {len(raw) / 1024:7.1f} KiB {len(document['meshes']):2d} meshes {triangles:5d} tris XYZ {dims[0]:.3f}/{dims[1]:.3f}/{dims[2]:.3f} minY {minimum[1]:.5f}", flush=True)
    return {"bytes": len(raw), "triangles": triangles, "meshes": len(document["meshes"])}


def module_keys():
    keys = [f"base_house_{family}_{variant}" for family in FAMILIES for variant in range(3)]
    keys += [f"base_workshop_{family}_{variant}" for family in FAMILIES for variant in range(2)]
    keys += [f"base_warehouse_{family}" for family in FAMILIES]
    keys += [f"base_shop_{family}" for family in FAMILIES]
    keys += ["base_civic"]
    keys += [f"floor_{family}_{variant}" for family in FAMILIES for variant in range(3)]
    keys += [f"roof_traditional_{family}_{variant}" for family in FAMILIES for variant in range(2)]
    keys += [f"roof_garden_{family}" for family in FAMILIES]
    keys += [f"roof_productive_{family}" for family in FAMILIES]
    keys += ["conversion_workshop_repair", "conversion_warehouse_hall"]
    assert len(keys) == 45 and len(set(keys)) == 45
    return keys


def update_manifest(keys):
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    manifest["layers"] = {
        "floorHeight": FLOOR_HEIGHT,
        "modules": {key: {"file": f"layers/{key}.glb"} for key in keys},
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def point_camera(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def create_preview():
    scene = bpy.data.scenes.new("Living Layers assembly check")
    bpy.context.window.scene = scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1350
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.world = bpy.data.worlds.new("Living Layers world")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = color("D8E3E5")
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.7
    global CURRENT
    collection = bpy.data.collections.new("Assembly preview")
    scene.collection.children.link(collection)
    CURRENT = collection
    for row, family in enumerate(FAMILIES):
        for variant in range(3):
            x, y = (variant - 1) * 1.25, (1 - row) * 1.30
            for suffix, z in (("base", 0), ("floor", 0.48)):
                key = f"base_house_{family}_{variant}" if suffix == "base" else f"floor_{family}_{variant}"
                obj = bpy.data.objects.new(key, None)
                obj.instance_type = "COLLECTION"
                obj.instance_collection = ASSETS[key]
                obj.location = (x, y, z)
                collection.objects.link(obj)
            roof_key = f"roof_traditional_{family}_{variant % 2}"
            obj = bpy.data.objects.new(roof_key, None)
            obj.instance_type = "COLLECTION"
            obj.instance_collection = ASSETS[roof_key]
            obj.location = (x, y, 0.96)
            collection.objects.link(obj)
            box("Preview plinth", (x, y, -0.035), (1.05, 1.05, 0.06), "plaster", 0.025)
    box("Preview ground", (0, 0, -0.09), (200, 200, 0.08), "mist")
    camera_data = bpy.data.cameras.new("Assembly camera")
    camera = bpy.data.objects.new("Assembly camera", camera_data)
    collection.objects.link(camera)
    camera.location = (4.6, -7.8, 5.4)
    point_camera(camera, (0, 0, 0.45))
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 5.5
    scene.camera = camera
    for name, loc, energy, size, tint in (
        ("Key", (-3, -4, 7), 850, 5, "FFE4C4"),
        ("Fill", (4, 2, 6), 650, 5, "C5E0EA"),
    ):
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light_data.color = color(tint)[:3]
        light = bpy.data.objects.new(name, light_data)
        collection.objects.link(light)
        light.location = loc
        point_camera(light, (0, 0, 0.3))
    scene.view_settings.view_transform = "Standard"
    scene.render.filepath = str(DIORAMA / "layers-preview.png")
    bpy.ops.render.render(write_still=True, scene=scene.name)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    make_palette()
    for family in FAMILIES:
        for variant in range(3):
            build_house(family, variant, True)
            build_house(family, variant, False)
        for variant in range(2):
            build_workshop(family, variant)
            build_traditional_roof(family, variant)
        build_warehouse(family)
        build_shop(family)
        build_garden_roof(family)
        build_productive_roof(family)
    build_civic()
    build_conversion_workshop()
    build_conversion_warehouse()
    keys = module_keys()
    assert set(keys) == set(ASSETS), (set(keys) - set(ASSETS), set(ASSETS) - set(keys))
    for key in keys:
        print(f"EXPORT {key}", flush=True)
        export_asset(key)
    stats = {key: validate_glb(key) for key in keys}
    update_manifest(keys)
    print(f"SUMMARY {len(keys)} modules, {sum(item['bytes'] for item in stats.values()) / 1024:.1f} KiB, {sum(item['triangles'] for item in stats.values())} triangles", flush=True)
    if "--skip-render" not in sys.argv:
        create_preview()
    print(f"LIVING LAYERS READY {EXPORT_DIR}", flush=True)


if __name__ == "__main__":
    main()
