"""Atlas world kit: ten low-poly tokens for the globe view.

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

ORDER = ["person", "guest", "phone", "light", "sensor",
         "group", "edge", "site", "tailnet", "job"]


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
    "screen": (srgb("#101418"), 0.25),
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


def box(size, loc, mat, bevel=0.018, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    ob = to_object(bm, mat)
    ob.rotation_euler = rot
    ob.location = loc
    if bevel:
        add_bevel(ob, bevel)
    return ob


def prism(outline, depth, mat, axis="Z"):
    """Extrude a closed 2D outline. axis Z: outline is XY, extruded up from 0.
    axis Y: outline is XZ, extruded through y = -depth/2 .. depth/2."""
    bm = bmesh.new()
    if axis == "Z":
        lo = [bm.verts.new((x, y, 0)) for x, y in outline]
        hi = [bm.verts.new((x, y, depth)) for x, y in outline]
    else:
        lo = [bm.verts.new((x, -depth / 2, z)) for x, z in outline]
        hi = [bm.verts.new((x, depth / 2, z)) for x, z in outline]
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bm.faces.new(lo)
    bm.faces.new(hi)
    return to_object(bm, mat)


def torus(R, r, mat, seg=10, sides=6):
    bm = bmesh.new()
    grid = []
    for i in range(seg):
        u = 2 * math.pi * i / seg
        row = []
        for k in range(sides):
            v = 2 * math.pi * k / sides + math.pi / sides
            d = R + r * math.cos(v)
            row.append(bm.verts.new((d * math.cos(u), d * math.sin(u), r * math.sin(v))))
        grid.append(row)
    for i in range(seg):
        for k in range(sides):
            a, b = grid[i], grid[(i + 1) % seg]
            k2 = (k + 1) % sides
            bm.faces.new((a[k], b[k], b[k2], a[k2]))
    return to_object(bm, mat)


def ico(radius, loc, mat):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=radius)
    ob = to_object(bm, mat)
    ob.location = loc
    return ob


def add_bevel(ob, width, angle=40):
    mod = ob.modifiers.new("bevel", "BEVEL")
    mod.width = width
    mod.segments = 1
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(angle)
    mod.harden_normals = False


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

def figure(scale=1.0, base=True):
    """Shared visitor figure: disc base, flared skirt, waist, broad shoulders, head."""
    s = scale
    parts = []
    if base:
        parts.append(lathe([(0, 0), (0.32 * s, 0), (0.32 * s, 0.05 * s),
                            (0.29 * s, 0.08 * s), (0, 0.08 * s)], "trim", seg=10))
    z0 = 0.08 * s if base else 0
    parts.append(lathe([(0, 0), (0.23 * s, 0), (0.20 * s, 0.14 * s), (0.145 * s, 0.30 * s),
                        (0.19 * s, 0.42 * s), (0.20 * s, 0.46 * s), (0.15 * s, 0.53 * s),
                        (0.07 * s, 0.56 * s), (0, 0.56 * s)],
                       "body", seg=10, loc=(0, 0, z0)))
    parts.append(lathe([(0, 0), (0.06 * s, 0), (0.06 * s, 0.06 * s), (0, 0.06 * s)],
                       "body", seg=6, loc=(0, 0, z0 + 0.54 * s)))
    r = 0.135 * s
    parts.append(lathe([(0, -r), (0.6 * r, -0.8 * r), (0.95 * r, -0.3 * r), (0.95 * r, 0.3 * r),
                        (0.6 * r, 0.8 * r), (0, r)], "body", seg=10,
                       loc=(0, 0, z0 + 0.71 * s)))
    return parts


def build_person():
    return figure()


def build_guest():
    s = 0.86
    parts = figure(s)
    z0 = 0.08 * s
    # Raised right arm holding a phone up beside the head.
    sh = Vector((0.16 * s, 0, z0 + 0.46 * s))
    hand = Vector((0.30 * s, -0.06 * s, z0 + 0.86 * s))
    d = hand - sh
    arm = box((0.075 * s, 0.075 * s, d.length), (sh + hand) / 2, "body", bevel=0)
    arm.rotation_mode = "QUATERNION"
    arm.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    parts.append(arm)
    ph = hand + Vector((0.0, -0.02 * s, 0.10 * s))
    tilt = (math.radians(-12), 0, math.radians(-15))
    parts.append(box((0.15 * s, 0.035 * s, 0.25 * s), ph, "trim", bevel=0.01, rot=tilt))
    scr = ph + Matrix.Rotation(tilt[2], 3, "Z") @ Matrix.Rotation(tilt[0], 3, "X") @ Vector((0, -0.02 * s, 0))
    parts.append(box((0.12 * s, 0.01 * s, 0.20 * s), scr, "screen", bevel=0, rot=tilt))
    # Visitor badge on the chest.
    parts.append(box((0.10 * s, 0.03 * s, 0.075 * s), (-0.07 * s, -0.17 * s, z0 + 0.36 * s),
                     "accent", bevel=0, rot=(math.radians(-10), 0, math.radians(-20))))
    return parts


def build_phone():
    parts = [box((0.56, 0.40, 0.07), (0, 0.02, 0.035), "trim", bevel=0.02)]
    # Front lip that stops the slab sliding.
    parts.append(box((0.56, 0.06, 0.06), (0, -0.15, 0.09), "trim", bevel=0.015))
    tilt = math.radians(-14)
    rot = Matrix.Rotation(tilt, 3, "X")
    pivot = Vector((0, -0.09, 0.07))
    centre = pivot + rot @ Vector((0, 0.03, 0.45))
    parts.append(box((0.48, 0.055, 0.90), centre, "body", bevel=0.025, rot=(tilt, 0, 0)))
    parts.append(box((0.41, 0.01, 0.76), centre + rot @ Vector((0, -0.028, 0.02)),
                     "screen", bevel=0, rot=(tilt, 0, 0)))
    parts.append(box((0.09, 0.012, 0.02), centre + rot @ Vector((0, -0.028, 0.415)),
                     "trim", bevel=0, rot=(tilt, 0, 0)))
    # Back leg of the stand.
    parts.append(box((0.30, 0.05, 0.42), (0, 0.17, 0.25), "trim", bevel=0.015,
                     rot=(math.radians(-30), 0, 0)))
    return parts


def build_light():
    parts = [lathe([(0, 0), (0.25, 0), (0.27, 0.02), (0.27, 0.06), (0.24, 0.09), (0, 0.09)],
                   "trim", seg=12)]
    parts.append(lathe([(0, 0.09), (0.13, 0.09), (0.13, 0.12), (0.148, 0.15), (0.13, 0.18),
                        (0.148, 0.21), (0.13, 0.24), (0.13, 0.29), (0, 0.29)], "body", seg=8))
    parts.append(lathe([(0, 0.29), (0.125, 0.29), (0.15, 0.38), (0.23, 0.49), (0.285, 0.60),
                        (0.295, 0.70), (0.26, 0.81), (0.18, 0.90), (0.09, 0.94), (0, 0.95)],
                       "led", seg=10))
    return parts


def build_sensor():
    parts = [lathe([(0, 0), (0.48, 0), (0.48, 0.17), (0.44, 0.22), (0, 0.22)],
                   "body", seg=14)]
    parts.append(lathe([(0, 0.21), (0.27, 0.21), (0.27, 0.25), (0.23, 0.26), (0, 0.26)],
                       "trim", seg=12))
    parts.append(lathe([(0, 0.25), (0.22, 0.25), (0.205, 0.31), (0.16, 0.37), (0.085, 0.405),
                        (0, 0.415)], "led", seg=12))
    return parts


def container(length, width, height, mat, ribs=5):
    d, e = 0.018, 0.06
    pitch = (length - 2 * e) / ribs
    xs = []
    for i in range(ribs):
        a = -length / 2 + e + i * pitch + pitch * 0.18
        b = a + pitch * 0.64
        xs.append((a, b))
    w2 = width / 2
    out = [(-length / 2, -w2)]
    for a, b in xs:
        out += [(a, -w2), (a + 0.02, -w2 - d), (b - 0.02, -w2 - d), (b, -w2)]
    out += [(length / 2, -w2), (length / 2, w2)]
    for a, b in reversed(xs):
        out += [(b, w2), (b - 0.02, w2 + d), (a + 0.02, w2 + d), (a, w2)]
    out += [(-length / 2, w2)]
    parts = [prism(out, height, mat)]
    p = 0.05
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(box((p, p, height + 0.01),
                             (sx * (length / 2 - p / 2 + 0.005), sy * (w2 + 0.003), height / 2),
                             "trim", bevel=0))
    return parts


def place(parts, loc, rz=0.0):
    m = Matrix.Translation(loc) @ Matrix.Rotation(rz, 4, "Z")
    for p in parts:
        bpy.context.view_layer.update()
        p.matrix_world = m @ p.matrix_world
    return parts


def build_group():
    L, W, H = 0.92, 0.36, 0.36
    parts = []
    parts += place(container(L, W, H, "body"), Vector((0, -0.195, 0)))
    parts += place(container(L, W, H, "trim"), Vector((0, 0.195, 0)))
    parts += place(container(L, W, H, "accent"), Vector((0.16, 0.0, H + 0.005)),
                   math.radians(7))
    return parts


def build_edge():
    parts = [box((1.04, 0.36, 0.07), (0, 0, 0.035), "trim", bevel=0.02)]
    for sx in (-1, 1):
        parts.append(box((0.18, 0.18, 0.80), (sx * 0.36, 0, 0.07 + 0.40), "body", bevel=0.02))
        parts.append(box((0.22, 0.22, 0.05), (sx * 0.36, 0, 0.07 + 0.025), "body", bevel=0.012))
    parts.append(box((1.12, 0.26, 0.13), (0, 0, 0.87 + 0.065), "body", bevel=0.022))
    parts.append(box((0.80, 0.16, 0.05), (0, 0, 0.82 + 0.025), "trim", bevel=0.01))
    parts.append(box((0.56, 0.07, 0.10), (0, 0, 0.42), "accent", bevel=0.012))
    parts.append(box((0.16, 0.02, 0.05), (0, -0.135, 0.935), "led", bevel=0))
    return parts


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


def build_tailnet():
    parts = [box((1.10, 0.34, 0.07), (0, 0, 0.035), "trim", bevel=0.02)]
    R, r = 0.20, 0.045
    h = 0.07 + R + r
    a = torus(R, r, "accent")
    a.rotation_euler = (math.pi / 2, 0, math.radians(10))
    a.location = (-0.30, 0, h)
    b = torus(R, r, "accent")
    b.rotation_euler = (0, math.radians(-8), 0)
    b.location = (0, 0, h)
    c = torus(R, r, "accent")
    c.rotation_euler = (math.pi / 2, 0, math.radians(-10))
    c.location = (0.30, 0, h)
    parts += [a, b, c]
    return parts


def build_job():
    parts = [box((0.80, 0.34, 0.08), (0, 0, 0.04), "trim", bevel=0.02)]
    # Cradle blocks either side of the cog's foot.
    for sx in (-1, 1):
        parts.append(box((0.10, 0.26, 0.10), (sx * 0.30, 0, 0.08 + 0.05), "trim", bevel=0.015))
    n, ro, rr = 10, 0.44, 0.35
    cz = 0.08 + ro - 0.03
    pitch = 2 * math.pi / n
    pts = []
    for k in range(n):
        t = k * pitch
        for ang, r in ((t - 0.27 * pitch, rr), (t - 0.16 * pitch, ro),
                       (t + 0.16 * pitch, ro), (t + 0.27 * pitch, rr)):
            pts.append((r * math.sin(ang), cz + r * math.cos(ang)))
    gear = prism(pts, 0.14, "body", axis="Y")
    parts.append(gear)
    hub = lathe([(0, 0), (0.13, 0), (0.13, 0.22), (0, 0.22)], "trim", seg=10)
    hub.rotation_euler = (math.pi / 2, 0, 0)
    hub.location = (0, 0.11, cz)
    parts.append(hub)
    led = lathe([(0, 0), (0.08, 0), (0.07, 0.03), (0, 0.03)], "led", seg=10)
    led.rotation_euler = (math.pi / 2, 0, 0)
    led.location = (0, -0.11, cz)
    parts.append(led)
    return parts


BUILDERS = {
    "person": build_person, "guest": build_guest, "phone": build_phone,
    "light": build_light, "sensor": build_sensor, "group": build_group,
    "edge": build_edge, "site": build_site, "tailnet": build_tailnet, "job": build_job,
}


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
    cam_data.ortho_scale = len(ORDER) * spacing + 0.2
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
    sc.render.resolution_x, sc.render.resolution_y = 1600, 500
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
