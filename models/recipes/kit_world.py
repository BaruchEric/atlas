"""Atlas world kit: the flag that marks home on the globe sheet.

Run as a factory script job (submit_job kind="script"). Writes kit-world.glb,
kit-world.blend and kit-world-review.png into OUT_DIR (default /tmp).
Each piece is one mesh object named by kind, origin at its bottom center,
front facing -Y, largest bounding-box side exactly 1.0.
"""

import math
import os
import shutil

import bmesh
import bpy
from mathutils import Matrix, Vector

OUT = os.environ.get("OUT_DIR", "/tmp")
REVIEW = os.environ.get("REVIEW", "1") != "0"

# The globe sheet's flag on home is the only piece left. The others stood on the globe
# when it wrapped a sheet onto the sphere; git history has them.
ORDER = ["site"]


def srgb(h):
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return tuple(lin(int(h[i:i + 2], 16)) for i in (1, 3, 5))


PALETTE = {
    "body": (srgb("#ecebe6"), 0.55),
    "trim": (srgb("#3a3d42"), 0.6),
    "accent": (srgb("#0f7a63"), 0.45),
    "led": (srgb("#3ddc84"), 0.3),
}


def reset_scene():
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.materials,
                 bpy.data.cameras, bpy.data.lights):
        for block in list(coll):
            coll.remove(block)


def make_materials():
    mats = {}
    for name, (rgb, rough) in PALETTE.items():
        m = bpy.data.materials.new(name)
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = 0.0
        m.diffuse_color = (*rgb, 1.0)
        m.roughness = rough
        # Single sided in glTF, and the review render shows any flipped face.
        m.use_backface_culling = True
        mats[name] = m
    return mats


M = {}


# ---------- mesh helpers ----------

def to_object(bm, mat, name="part"):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M[mat])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def lathe(profile, mat, seg=12, loc=(0, 0, 0)):
    """Revolve (r, z) points, bottom to top, around Z. r=0 closes the end."""
    bm = bmesh.new()
    step = 2 * math.pi / seg
    # Offset half a step so a flat facet faces -Y.
    angs = [-math.pi / 2 + step / 2 + i * step for i in range(seg)]
    rings = []
    for r, z in profile:
        if r < 1e-6:
            rings.append([bm.verts.new((loc[0], loc[1], loc[2] + z))])
        else:
            rings.append([bm.verts.new((loc[0] + r * math.cos(a),
                                        loc[1] + r * math.sin(a),
                                        loc[2] + z)) for a in angs])
    for a, b in zip(rings, rings[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                bm.faces.new((a[0], b[i], b[j]))
            elif len(b) == 1:
                bm.faces.new((a[i], a[j], b[0]))
            else:
                bm.faces.new((a[i], a[j], b[j], b[i]))
    if len(rings[0]) > 1:
        bm.faces.new(rings[0])
    if len(rings[-1]) > 1:
        bm.faces.new(rings[-1])
    return to_object(bm, mat)


def ico(radius, loc, mat):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=radius)
    ob = to_object(bm, mat)
    ob.location = loc
    return ob


def apply_modifiers(ob):
    if not ob.modifiers:
        return
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def join(parts, name):
    """Merge parts into one mesh object at the origin, normalised to a max side
    of 1.0 with its origin at the bottom center."""
    bpy.context.view_layer.update()
    mats, bm = [], bmesh.new()
    for p in parts:
        apply_modifiers(p)
        me = p.data.copy()
        me.transform(p.matrix_world)
        remap = []
        for m in me.materials:
            if m not in mats:
                mats.append(m)
            remap.append(mats.index(m))
        for poly in me.polygons:
            poly.material_index = remap[poly.material_index]
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        old = p.data
        bpy.data.objects.remove(p)
        bpy.data.meshes.remove(old)
    lo = Vector([min(v.co[i] for v in bm.verts) for i in range(3)])
    hi = Vector([max(v.co[i] for v in bm.verts) for i in range(3)])
    s = 1.0 / max(hi - lo)
    base = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    bm.transform(Matrix.Scale(s, 4) @ Matrix.Translation(-base))
    for f in bm.faces:
        f.smooth = False
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


# ---------- pieces ----------

def build_site():
    parts = [lathe([(0, 0), (0.17, 0), (0.19, 0.02), (0.19, 0.05), (0.16, 0.07), (0, 0.07)],
                   "trim", seg=10)]
    parts.append(lathe([(0, 0.07), (0.035, 0.07), (0.028, 0.93), (0, 0.93)], "body", seg=6))
    parts.append(ico(0.065, (0, 0, 0.975), "led"))
    # Pennant: a three-fold strip from the mast out to a point, given thickness.
    bm = bmesh.new()
    top, bot, tip = 0.90, 0.60, (0.56, 0.74)
    folds = [(0.0, 0.0), (0.2, -0.035), (0.4, 0.025), (0.56, 0.0)]
    rows = []
    for x, y in folds:
        t = x / tip[0]
        zt = top + (tip[1] - top) * t
        zb = bot + (tip[1] - bot) * t
        if t >= 1:
            rows.append([bm.verts.new((x + 0.02, y, zt))])
        else:
            rows.append([bm.verts.new((x + 0.02, y, zb)), bm.verts.new((x + 0.02, y, zt))])
    for a, b in zip(rows, rows[1:]):
        if len(b) == 1:
            bm.faces.new((a[0], b[0], a[1]))
        else:
            bm.faces.new((a[0], b[0], b[1], a[1]))
    flag = to_object(bm, "accent")
    sol = flag.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = 0.03
    sol.offset = 0.0
    parts.append(flag)
    return parts


BUILDERS = {"site": build_site}


def build_kit():
    reset_scene()
    M.update(make_materials())
    kit = {}
    for kind in ORDER:
        kit[kind] = join(BUILDERS[kind](), kind)
    return kit


def export(kit):
    for ob in bpy.context.scene.objects:
        ob.select_set(ob.name in kit)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, "kit-world.glb"),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_normals=True,
        export_texcoords=False,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="NONE",
        export_vertex_color="NONE",
        export_attributes=False,
        export_animations=False,
        export_morph=False,
        export_skins=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_draco_mesh_compression_enable=False,
    )
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "kit-world.blend"))


def stats(kit):
    out = {}
    for kind, ob in kit.items():
        me = ob.data
        me.calc_loop_triangles()
        xs = [v.co for v in me.vertices]
        lo = [round(min(c[i] for c in xs), 4) for i in range(3)]
        hi = [round(max(c[i] for c in xs), 4) for i in range(3)]
        out[kind] = {"tris": len(me.loop_triangles), "min": lo, "max": hi,
                     "mats": [m.name for m in me.materials]}
    out["total_tris"] = sum(v["tris"] for v in out.values())
    return out


def stage_review(kit, spacing=1.25):
    for i, kind in enumerate(ORDER):
        kit[kind].location = (i * spacing, 0, 0)
        kit[kind].rotation_euler = (0, 0, math.radians(-22))
    mid = (len(ORDER) - 1) * spacing / 2
    bpy.ops.mesh.primitive_plane_add(size=60, location=(mid, 0, 0))
    ground = bpy.context.active_object
    gm = bpy.data.materials.new("review-ground")
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.42, 0.43, 0.45, 1)
    ground.data.materials.append(gm)
    cam_data = bpy.data.cameras.new("review-cam")
    cam_data.type = "ORTHO"
    # Never narrower than one piece and its margin, so a single piece isn't cropped.
    cam_data.ortho_scale = max(len(ORDER) * spacing + 0.2, 1.6)
    cam = bpy.data.objects.new("review-cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = (mid, -23.3, 0.45 + 8.96)
    cam.rotation_euler = (math.radians(69), 0, 0)
    bpy.context.scene.camera = cam
    sun_data = bpy.data.lights.new("review-sun", "SUN")
    sun_data.energy = 3.5
    sun_data.angle = math.radians(8)
    sun = bpy.data.objects.new("review-sun", sun_data)
    bpy.context.scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    world = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.6, 0.62, 0.65, 1)
    bg.inputs["Strength"].default_value = 0.9
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    # A row of pieces renders wide; a single one renders square.
    sc.render.resolution_x, sc.render.resolution_y = (1600, 500) if len(ORDER) > 3 else (640, 640)
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "Standard"
    sc.render.filepath = os.path.join(OUT, "kit-world-review.png")


def main():
    if "__file__" in globals():
        # Keep the exact source that produced these outputs beside them.
        shutil.copy(__file__, os.path.join(OUT, "kit_world.py"))
    kit = build_kit()
    export(kit)
    info = stats(kit)
    if REVIEW:
        stage_review(kit)
        if bpy.app.background and not os.environ.get("NO_RENDER"):
            bpy.ops.render.render(write_still=True)
    print("KIT_STATS", info)
    return info


result = main()
