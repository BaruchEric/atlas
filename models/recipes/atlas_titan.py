"""Atlas titan: a kneeling figure holding up a radius-1 globe, on a stepped plinth.

Runs from Blender's factory scene (script job or live session). Writes atlas-titan.glb and
atlas-titan.blend to OUT_DIR. Pass "--review" after "--" to also render titan-review.png
(front 3/4) and titan-front.png with a stand-in globe in place.

Units: globe radius 1.0, plinth bottom at z=0, figure faces -Y, his right is -X.
The figure is metaballs (blended muscle masses), meshed, then decimated for flat facets.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Vector

OUT_DIR = os.environ.get("OUT_DIR", "/tmp")
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
REVIEW = "--review" in ARGS

PLINTH_TOP = 0.22
TITAN_TRIS = 2600  # few enough for facets that read at app scale; flat shading splits vertices per face, so this keeps the GLB small
META_RES = 0.014
FIGURE_SCALE = 1.12  # as large as the 2.0-2.4 globe height allows
K = 1.0 / 0.574  # metaball radius whose lone surface has radius 1 (threshold 0.6, stiffness 2)


# ---------------------------------------------------------------- figure

def S(p):
    """Scale a figure point about the plinth top centre."""
    return (p[0] * FIGURE_SCALE, p[1] * FIGURE_SCALE, PLINTH_TOP + (p[2] - PLINTH_TOP) * FIGURE_SCALE)


def figure_parts():
    """Torso, legs and head. Each part is (kind, args), sizes are surface radii."""
    T = PLINTH_TOP
    parts = [
        # torso, leaning well forward so the upper back faces the globe
        ("ell", (0, 0.10, 0.74), (0.18, 0.13, 0.12)),  # pelvis
        ("ball", (-0.09, 0.19, 0.70), 0.10),  # glutes
        ("ball", (0.09, 0.18, 0.71), 0.10),
        ("ell", (0, 0.03, 0.88), (0.15, 0.12, 0.13), (-30, 0, 0)),  # abdomen
        ("ell", (0, -0.05, 1.02), (0.23, 0.16, 0.16), (-38, 0, 0)),  # ribcage
        ("ell", (0, 0.00, 1.13), (0.24, 0.14, 0.10), (-38, 0, 0)),  # upper back, takes the globe
        ("ell", (-0.11, -0.18, 1.03), (0.10, 0.06, 0.08), (-38, 0, 0)),  # pecs
        ("ell", (0.11, -0.18, 1.03), (0.10, 0.06, 0.08), (-38, 0, 0)),
        ("ell", (-0.17, 0.04, 0.97), (0.08, 0.10, 0.15), (-30, 0, 0)),  # lats
        ("ell", (0.17, 0.04, 0.97), (0.08, 0.10, 0.15), (-30, 0, 0)),
        ("ball", (-0.32, -0.07, 1.14), 0.105),  # deltoids
        ("ball", (0.32, -0.07, 1.14), 0.105),
        # head bowed forward and down, in front of the globe
        ("cap", (0, -0.10, 1.12), (0, -0.26, 1.10), 0.07),  # neck
        ("ball", (0, -0.36, 1.06), 0.105),  # head
        ("ell", (0, -0.43, 0.99), (0.065, 0.05, 0.06), (-45, 0, 0)),  # beard
        # right leg: knee down, shin and foot behind
        ("cap", (-0.13, 0.10, 0.72), (-0.18, -0.03, T + 0.095), 0.10),
        ("ell", (-0.16, 0.01, 0.53), (0.10, 0.09, 0.16), (15, 0, 0)),  # quad
        ("cap", (-0.18, -0.03, T + 0.095), (-0.18, 0.40, T + 0.075), 0.06),
        ("ell", (-0.18, 0.12, T + 0.135), (0.075, 0.12, 0.07)),  # calf
        ("cap", (-0.18, 0.40, T + 0.075), (-0.18, 0.54, T + 0.055), 0.055),  # foot, toes tucked
        # left leg: forward, knee up, foot planted
        ("cap", (0.13, 0.06, 0.74), (0.21, -0.36, 0.72), 0.10),
        ("ell", (0.17, -0.16, 0.79), (0.10, 0.16, 0.09)),  # quad
        ("cap", (0.21, -0.36, 0.72), (0.22, -0.40, T + 0.09), 0.06),
        ("ell", (0.22, -0.31, 0.55), (0.07, 0.075, 0.12)),  # calf
        ("cap", (0.22, -0.38, T + 0.055), (0.23, -0.57, T + 0.05), 0.055),  # foot
    ]
    out = []
    for kind, *args in parts:
        if kind == "cap":
            out.append((kind, S(args[0]), S(args[1]), args[2] * FIGURE_SCALE))
        elif kind == "ball":
            out.append((kind, S(args[0]), args[1] * FIGURE_SCALE))
        else:
            out.append((kind, S(args[0]), tuple(r * FIGURE_SCALE for r in args[1]), *args[2:]))
    return out


def arm_parts(center, s):
    """One arm reaching up and back to press the globe's lower side. s=-1 right, +1 left."""

    def on_globe(direction, lift):
        return tuple(center + Vector(direction).normalized() * (1.0 + lift))

    f = FIGURE_SCALE
    shoulder = S((s * 0.32, -0.07, 1.14))
    elbow = S((s * 0.60, -0.14, 1.24))
    hand_dir = Vector((s * 0.74, -0.18, -0.65)).normalized()
    wrist = on_globe((s * 0.66, -0.17, -0.74), 0.075)
    return [
        ("cap", shoulder, elbow, 0.085 * f),
        ("ell", S((s * 0.45, -0.10, 1.21)), (0.115 * f, 0.08 * f, 0.08 * f)),  # bicep
        ("cap", elbow, wrist, 0.065 * f),
        ("ball", S((s * 0.64, -0.16, 1.33)), 0.08 * f),  # forearm mass
        ("mitt", on_globe(hand_dir, 0.035), hand_dir, (0.09, 0.075, 0.035)),  # hand flat on the globe
    ]


# ---------------------------------------------------------------- helpers

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def make_material(name, srgb):
    mat = bpy.data.materials.new(name)
    lin = tuple(srgb_to_linear(c) for c in srgb) + (1.0,)
    mat.diffuse_color = lin
    mat.roughness = 0.85
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = lin
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def tri_count(mesh):
    return sum(len(p.vertices) - 2 for p in mesh.polygons)


def add_part(mb, kind, *args):
    if kind == "cap":
        a, b, r = Vector(args[0]), Vector(args[1]), args[2]
        e = mb.elements.new(type="CAPSULE")
        e.co = (a + b) / 2
        e.size_x = (b - a).length / 2
        e.rotation = Vector((1, 0, 0)).rotation_difference((b - a).normalized())
        e.radius = r * K
    elif kind == "ball":
        e = mb.elements.new(type="BALL")
        e.co = args[0]
        e.radius = args[1] * K
    else:  # "ell" with an Euler in degrees, or "mitt" with local Z along a normal
        c, orient, radii = (args[0], args[1], args[2]) if kind == "mitt" else (args[0], None, args[1])
        m = max(radii)
        e = mb.elements.new(type="ELLIPSOID")
        e.co = c
        e.radius = m * K
        e.size_x, e.size_y, e.size_z = (r / m for r in radii)
        if kind == "mitt":
            e.rotation = Vector((0, 0, 1)).rotation_difference(Vector(orient))
        elif len(args) > 2:
            e.rotation = Euler([math.radians(a) for a in args[2]]).to_quaternion()


def meta_mesh(name, parts, res):
    mb = bpy.data.metaballs.new(name)
    mb.resolution = res
    mb.render_resolution = res
    mb.threshold = 0.6
    obj = link(bpy.data.objects.new(name, mb))
    for part in parts:
        add_part(mb, *part)
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    bpy.data.objects.remove(obj)
    bpy.data.metaballs.remove(mb)
    return mesh


def resting_center(mesh):
    """Height where a radius-1 sphere centred on the z axis comes to rest on the mesh."""
    best = -1e9
    for v in mesh.vertices:
        r2 = v.co.x ** 2 + v.co.y ** 2
        if r2 < 1.0:
            best = max(best, v.co.z + math.sqrt(1.0 - r2))
    return best


def decimate(obj, target):
    mod = obj.modifiers.new("Decimate", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = min(1.0, target / max(1, tri_count(obj.data)))
    mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    old = obj.data
    obj.modifiers.clear()
    obj.data = mesh
    bpy.data.meshes.remove(old)
    mesh.name = obj.name


# ---------------------------------------------------------------- build

bpy.ops.wm.read_homefile(use_factory_startup=True)
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
for mat in list(bpy.data.materials):
    bpy.data.materials.remove(mat)

stone = make_material("stone", (0.80, 0.77, 0.72))
plinth_mat = make_material("plinth", (0.60, 0.58, 0.55))

# Rest the globe on the torso and head first, then reach the arms out to it.
probe = meta_mesh("probe", figure_parts(), 0.03)
globe_z = resting_center(probe) - 0.015  # sink slightly so the contact is unmistakable
bpy.data.meshes.remove(probe)
center = Vector((0.0, 0.0, globe_z))

parts = figure_parts() + arm_parts(center, -1) + arm_parts(center, 1)
titan = link(bpy.data.objects.new("titan", meta_mesh("titan", parts, META_RES)))
raw_tris = tri_count(titan.data)
decimate(titan, TITAN_TRIS)
titan.data.materials.append(stone)

# Plinth: two octagonal steps with flat sides facing the axes.
bm = bmesh.new()
for apothem, z0, z1 in [(1.30, 0.0, 0.12), (1.10, 0.12, PLINTH_TOP)]:
    radius = apothem / math.cos(math.pi / 8)
    ring0, ring1 = [], []
    for i in range(8):
        a = math.pi / 8 + i * math.pi / 4
        x, y = radius * math.cos(a), radius * math.sin(a)
        ring0.append(bm.verts.new((x, y, z0)))
        ring1.append(bm.verts.new((x, y, z1)))
    bm.faces.new(list(reversed(ring0)))
    bm.faces.new(ring1)
    for i in range(8):
        j = (i + 1) % 8
        bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
plinth_mesh = bpy.data.meshes.new("plinth")
bm.to_mesh(plinth_mesh)
bm.free()
plinth = link(bpy.data.objects.new("plinth", plinth_mesh))
plinth.data.materials.append(plinth_mat)

for obj in (titan, plinth):
    for p in obj.data.polygons:
        p.use_smooth = False

anchor = link(bpy.data.objects.new("globe_anchor", None))
anchor.empty_display_type = "SPHERE"
anchor.empty_display_size = 1.0
anchor.location = center
anchor["radius"] = 1.0

# How far the hands and back sit from the globe surface (negative is inside).
gaps = [((v.co - center).length - 1.0, v.co.x) for v in titan.data.vertices]
report = {
    "globe_z": round(globe_z, 4),
    "raw_tris": raw_tris,
    "titan_tris": tri_count(titan.data),
    "plinth_tris": tri_count(plinth.data),
    "deepest_penetration": round(-min(g for g, _ in gaps), 4),
    "right_hand_gap": round(min(g for g, x in gaps if x < -0.45), 4),
    "left_hand_gap": round(min(g for g, x in gaps if x > 0.45), 4),
    "back_gap": round(min(g for g, x in gaps if abs(x) < 0.4), 4),
    "titan_z_range": (round(min(v.co.z for v in titan.data.vertices), 4),
                      round(max(v.co.z for v in titan.data.vertices), 4)),
}
print("ATLAS_TITAN", report)

# ---------------------------------------------------------------- export

os.makedirs(OUT_DIR, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT_DIR, "atlas-titan.glb"),
    export_format="GLB",
    export_yup=True,
    export_apply=True,
    export_extras=True,
    export_normals=True,
    export_texcoords=False,
    export_tangents=False,
    export_attributes=False,
    export_materials="EXPORT",
    export_image_format="NONE",
    export_animations=False,
    export_morph=False,
    export_skins=False,
    export_cameras=False,
    export_lights=False,
    export_draco_mesh_compression_enable=False,
)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, "atlas-titan.blend"))

# ---------------------------------------------------------------- review render


def aim(cam, location, target=(0.0, 0.0, 1.25)):
    cam.location = location
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()


def stage_review():
    globe = bpy.data.meshes.new("review_globe")
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=1.0)
    bm.to_mesh(globe)
    bm.free()
    g = link(bpy.data.objects.new("review_globe", globe))
    g.location = center
    for p in globe.polygons:
        p.use_smooth = True
    globe.materials.append(make_material("review_globe", (0.45, 0.55, 0.70)))

    cam = link(bpy.data.objects.new("review_cam", bpy.data.cameras.new("review_cam")))
    cam.data.lens = 50
    aim(cam, (3.4, -5.6, 2.0))
    bpy.context.scene.camera = cam

    sun = link(bpy.data.objects.new("review_sun", bpy.data.lights.new("review_sun", "SUN")))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(55), math.radians(10), math.radians(-30))

    world = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.12, 0.12, 0.13, 1)
    bg.inputs["Strength"].default_value = 1.0

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 960
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    return cam


if REVIEW:
    cam = stage_review()
    for name, location in [("titan-review.png", (3.4, -5.6, 2.0)), ("titan-front.png", (0.0, -6.6, 1.6))]:
        aim(cam, location)
        bpy.context.scene.render.filepath = os.path.join(OUT_DIR, name)
        bpy.ops.render.render(write_still=True)
