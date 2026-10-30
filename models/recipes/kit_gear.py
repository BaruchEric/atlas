"""Atlas gear kit: ten low-poly network-device tokens for the globe view, built from scratch.

Run it on the factory as a script job; the source is the job's code:

  submit_job(kind="script", code=<this file>, args=["--review"])

Writes to OUT_DIR (default /tmp):
  kit-gear.glb         the ten pieces, each a single mesh node named by kind, all at the origin
  kit-gear.blend       the same pieces laid out in a row, with labels, camera and lights
  kit-gear-stats.json  triangles per piece and each piece's size before normalising
  kit-gear-review.png  an eevee render of that row (only with --review)

Every piece has its origin at its bottom centre, its front facing -Y (glTF +Z), and is scaled
so the largest side of its bounding box is 1.0. All pieces share five materials: body, trim,
accent, led and screen. Atlas re-tints them from theme tokens.
"""

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

OUT = os.environ.get("OUT_DIR", "/tmp")
REVIEW = "--review" in sys.argv or os.environ.get("REVIEW") == "1"

KINDS = ["router", "satellite", "host", "device", "media",
         "moca", "switch", "power", "hub", "plug"]

COLORS = {
    "body": ("#ECE9E2", 0.55),
    "trim": ("#3A3D43", 0.6),
    "accent": ("#0F7A63", 0.45),
    "led": ("#3DDC84", 0.3),
    "screen": ("#121417", 0.25),
}
SLOTS = list(COLORS)
BODY, TRIM, ACCENT, LED, SCREEN = range(5)

# --- materials ---------------------------------------------------------------


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def make_materials():
    mats = []
    for name, (hexc, rough) in COLORS.items():
        rgb = [srgb_to_linear(int(hexc[i:i + 2], 16) / 255) for i in (1, 3, 5)]
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = (*rgb, 1)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = 0.0
        m.diffuse_color = (*rgb, 1)
        m.roughness = rough
        mats.append(m)
    return mats


# --- geometry helpers ----------------------------------------------------------
# Every solid is a loft: rings of 2D points stacked along local z, capped at both ends.
# A matrix places it; Rx(90) turns local z into -Y so a part sticks out of a front face.

RX_FRONT = Matrix.Rotation(math.radians(90), 4, 'X')    # local z -> -Y, local y -> +Z
RX_BACK = Matrix.Rotation(math.radians(-90), 4, 'X')    # local z -> +Y, local y -> -Z


def area(pts):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(pts, pts[1:] + pts[:1])) / 2


def loft(bm, levels, mat, M=None):
    """levels: [(z, [(x, y), ...]), ...], every ring the same length."""
    M = M or Matrix()
    if area(levels[0][1]) < 0:
        levels = [(z, list(reversed(p))) for z, p in levels]
    rings = [[bm.verts.new(M @ Vector((x, y, z))) for x, y in pts] for z, pts in levels]
    faces = []
    n = len(rings[0])
    for lo, hi in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            faces.append(bm.faces.new((lo[i], lo[j], hi[j], hi[i])))
    faces.append(bm.faces.new(list(reversed(rings[0]))))
    faces.append(bm.faces.new(rings[-1]))
    for f in faces:
        f.material_index = mat
    return faces


def rrect(w, d, r, seg, cx=0.0, cy=0.0):
    """Rounded rectangle, counter-clockwise. seg=0 gives sharp corners."""
    hw, hd = w / 2, d / 2
    if seg == 0:
        return [(cx + hw, cy + hd), (cx - hw, cy + hd), (cx - hw, cy - hd), (cx + hw, cy - hd)]
    r = max(min(r, hw - 1e-4, hd - 1e-4), 2e-3)
    pts = []
    for k, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
        ox, oy = cx + sx * (hw - r), cy + sy * (hd - r)
        for s in range(seg + 1):
            a = math.radians(90 * k + 90 * s / seg)
            pts.append((ox + r * math.cos(a), oy + r * math.sin(a)))
    return pts


def circle(r, n, cx=0.0, cy=0.0, rot=0.0):
    return [(cx + r * math.cos(rot + 2 * math.pi * i / n), cy + r * math.sin(rot + 2 * math.pi * i / n))
            for i in range(n)]


def solid(bm, prof, z0, h, mat, ct=0.0, cb=0.0, taper=1.0, M=None):
    """prof(inset, t) -> ring. ct/cb chamfer the top/bottom cap edges; taper scales the top."""
    def ring(z, inset):
        return prof(inset, 1 - (1 - taper) * (z - z0) / h)
    z1 = z0 + h
    levels = [(z0, ring(z0, cb)), (z0 + cb, ring(z0 + cb, 0))] if cb else [(z0, ring(z0, 0))]
    levels += [(z1 - ct, ring(z1 - ct, 0)), (z1, ring(z1, ct))] if ct else [(z1, ring(z1, 0))]
    return loft(bm, levels, mat, M)


def rbox(bm, w, d, h, mat, r=0.0, seg=0, cx=0.0, cy=0.0, z0=0.0, ct=0.0, cb=0.0, taper=1.0, M=None):
    return solid(bm, lambda i, t: rrect(w * t - 2 * i, d * t - 2 * i, r * t - i, seg, cx, cy),
                 z0, h, mat, ct, cb, taper, M)


def cyl(bm, r, h, mat, n=16, cx=0.0, cy=0.0, z0=0.0, ct=0.0, cb=0.0, rot=0.0, M=None):
    return solid(bm, lambda i, t: circle(r * t - i, n, cx, cy, rot), z0, h, mat, ct, cb, 1.0, M)


def at_front(x, y, z):
    return Matrix.Translation((x, y, z)) @ RX_FRONT


def fbox(bm, x, z, w, h, face_y, proud, mat, r=0.0, seg=0, ch=0.0, embed=0.02):
    """A plate standing proud of a front face at y=face_y, centred at (x, z)."""
    rbox(bm, w, h, embed + proud, mat, r, seg, z0=-embed, ct=ch, M=at_front(x, face_y, z))


def fdot(bm, x, z, r, face_y, proud, mat, n=10, embed=0.02):
    cyl(bm, r, embed + proud, mat, n, z0=-embed, ct=min(proud * 0.5, r * 0.3), M=at_front(x, face_y, z))


def fcut(bm, x, z, w, h, face_y, depth, r=0.0, seg=0):
    """A cutter for a hole of *depth* into a front face."""
    rbox(bm, w, h, depth + 0.1, TRIM, r, seg, z0=-depth, M=at_front(x, face_y, z))


def fcut_round(bm, x, z, r, face_y, depth, n=10):
    cyl(bm, r, depth + 0.1, TRIM, n, z0=-depth, M=at_front(x, face_y, z))


def prism_front(bm, pts, x, z, face_y, proud, mat, embed=0.02):
    loft(bm, [(-embed, pts), (proud, pts)], mat, at_front(x, face_y, z))


# --- pieces ------------------------------------------------------------------
# Each builder fills bm with the solid parts and may fill cut with cutters, which are subtracted
# from bm. A builder that cuts returns a function that then adds the parts inside or over the holes.


def tower(bm, H, W, r, taper, vents, accent_band, led_z):
    rbox(bm, W, W, H, BODY, r, 2, ct=0.035, cb=0.015, taper=taper)

    def band(z0, h, grow, mat):
        t0 = 1 - (1 - taper) * z0 / H
        t1 = 1 - (1 - taper) * (z0 + h) / H
        rbox(bm, W * t0 + grow, W * t0 + grow, h, mat, r * t0 + grow / 2, 2, z0=z0, taper=t1 / t0)

    for z in vents:
        band(z, 0.022, 0.014, TRIM)
    if accent_band:
        band(accent_band[0], accent_band[1], 0.012, ACCENT)
    # Top grille plate.
    tt = taper
    rbox(bm, W * tt - 0.13, W * tt - 0.13, 0.014, TRIM, r * tt - 0.065, 2, z0=H - 0.004, ct=0.006)
    face_y = -(W * (1 - (1 - taper) * led_z / H)) / 2
    fdot(bm, 0, led_z, 0.022, face_y, 0.012, LED)


def build_router(bm, cut):
    tower(bm, 1.0, 0.44, 0.12, 0.86, vents=(0.79, 0.828, 0.866), accent_band=(0.10, 0.045), led_z=0.58)


def build_satellite(bm, cut):
    tower(bm, 0.75, 0.44, 0.12, 0.9, vents=(0.60, 0.638), accent_band=(0.08, 0.03), led_z=0.43)


def build_host(bm, cut):
    W, D, H = 0.62, 0.78, 0.74
    fy = -D / 2
    rbox(bm, W, D, H, BODY, 0.035, 1, ct=0.03, cb=0.015)
    for i in range(4):
        x = 0.045 + (i - 1.5) * 0.125
        fcut(cut, x, 0.40, 0.105, 0.5, fy, 0.035)
    return lambda b: host_after(b, W, fy)


def host_after(bm, W, fy):
    for i in range(4):
        x = 0.045 + (i - 1.5) * 0.125
        # Drive tray face, set back inside the bay, with a latch tab.
        fbox(bm, x, 0.40, 0.085, 0.47, fy + 0.02, 0.0, TRIM, embed=0.02)
        fbox(bm, x, 0.20, 0.05, 0.03, fy + 0.02, 0.012, BODY, embed=0.0)
    fbox(bm, -0.245, 0.40, 0.024, 0.44, fy, 0.008, LED, r=0.011, seg=1)
    fbox(bm, 0.0, 0.07, 0.52, 0.026, fy, 0.006, ACCENT)


def build_device(bm, cut):
    W, D, H = 0.86, 0.58, 0.2
    fy = -D / 2
    rbox(bm, W, D, H, BODY, 0.06, 2, ct=0.03, cb=0.012)
    for sx in (-1, 1):
        M = Matrix.Translation((sx * 0.31, 0.19, H - 0.02)) @ Matrix.Rotation(math.radians(sx * 14), 4, 'Y')
        cyl(bm, 0.036, 0.29, TRIM, 8, ct=0.018, M=M)
        cyl(bm, 0.05, 0.03, TRIM, 8, M=Matrix.Translation((sx * 0.31, 0.19, H - 0.01)))
    for i in range(5):
        fbox(bm, (i - 2) * 0.09, 0.135, 0.04, 0.026, fy, 0.009, LED, r=0.008, seg=1)
    fbox(bm, 0.0, 0.065, 0.66, 0.02, fy, 0.006, ACCENT)


def build_media(bm, cut):
    W, H, D, Z0 = 1.0, 0.58, 0.045, 0.2
    rbox(bm, W, D, H, BODY, 0.02, 1, z0=Z0, ct=0.012, cb=0.012)
    rbox(bm, 0.6, 0.05, 0.34, BODY, 0.03, 1, cy=0.03, z0=Z0 + 0.1, ct=0.02)
    fbox(bm, 0.0, Z0 + 0.305, 0.94, 0.49, -D / 2, 0.004, SCREEN, embed=0.01)
    fdot(bm, 0.0, Z0 + 0.03, 0.009, -D / 2, 0.006, LED, n=8, embed=0.01)
    rbox(bm, 0.07, 0.04, Z0 + 0.12, TRIM, cy=0.03)
    rbox(bm, 0.42, 0.22, 0.03, TRIM, 0.06, 2, cy=0.03, ct=0.012)


def build_moca(bm, cut):
    W, D, H = 0.34, 0.26, 0.46
    rbox(bm, W, D, H, BODY, 0.05, 2, ct=0.03, cb=0.012)
    rbox(bm, W + 0.012, D + 0.012, 0.03, ACCENT, 0.056, 2, z0=0.075)
    cyl(bm, 0.075, 0.06, TRIM, 6, z0=H - 0.01, ct=0.008, rot=math.pi / 6)
    cyl(bm, 0.046, 0.12, TRIM, 12, z0=H + 0.04, ct=0.01)
    cyl(bm, 0.012, 0.03, BODY, 6, z0=H + 0.15)
    fdot(bm, 0.0, 0.36, 0.022, -D / 2, 0.012, LED)


def build_switch(bm, cut):
    W, D, H = 1.0, 0.42, 0.17
    fy = -D / 2
    rbox(bm, W, D, H, BODY, 0.03, 1, ct=0.02, cb=0.01)
    for i in range(8):
        fcut(cut, 0.03 + (i - 3.5) * 0.095, 0.072, 0.072, 0.066, fy, 0.05)
    return lambda b: switch_after(b, fy)


def switch_after(bm, fy):
    for i in range(8):
        fbox(bm, 0.03 + (i - 3.5) * 0.095, 0.135, 0.024, 0.016, fy, 0.006, LED)
    fbox(bm, -0.425, 0.095, 0.05, 0.05, fy, 0.006, ACCENT, r=0.012, seg=1)


BOLT = [(0.18, 0.5), (-0.26, -0.04), (0.0, -0.04), (-0.16, -0.5), (0.28, 0.08), (0.03, 0.08)]


def build_power(bm, cut):
    W, D, H = 0.46, 0.72, 0.6
    fy = -D / 2
    rbox(bm, W, D, H, BODY, 0.05, 2, ct=0.035, cb=0.015)
    fbox(bm, 0.0, 0.48, 0.3, 0.15, fy, 0.006, TRIM, r=0.02, seg=1)
    fbox(bm, 0.0, 0.48, 0.25, 0.1, fy, 0.011, SCREEN)
    prism_front(bm, [(x * 0.38, y * 0.24) for x, y in BOLT], 0.0, 0.24, fy, 0.016, ACCENT)
    fdot(bm, 0.155, 0.365, 0.018, fy, 0.01, LED, n=8)
    rbox(bm, W + 0.01, D + 0.01, 0.025, TRIM, 0.055, 2, z0=0.0, cb=0.008)


def build_hub(bm, cut):
    n = 20
    cyl(bm, 0.44, 0.03, TRIM, n)
    cyl(bm, 0.5, 0.13, BODY, n, z0=0.02, ct=0.035, cb=0.015)
    cyl(bm, 0.37, 0.009, ACCENT, n, z0=0.147)
    cyl(bm, 0.31, 0.013, BODY, n, z0=0.147)
    cyl(bm, 0.07, 0.022, LED, 12, z0=0.148, ct=0.006)
    fdot(bm, 0.0, 0.085, 0.016, -0.495, 0.01, LED, n=8)


def build_plug(bm, cut):
    W, D, H = 0.5, 0.44, 0.5
    fy = -D / 2
    rbox(bm, W, D, H, BODY, 0.1, 2, ct=0.06, cb=0.03)
    for sx in (-1, 1):
        fcut(cut, sx * 0.065, 0.27, 0.026, 0.085, fy, 0.03)
    fcut_round(cut, 0.0, 0.15, 0.026, fy, 0.03)
    return lambda b: plug_after(b, W, D, H, fy)


def plug_after(bm, W, D, H, fy):
    back = Matrix.Translation((0, D / 2, 0)) @ RX_BACK
    for sx in (-1, 1):
        rbox(bm, 0.022, 0.09, 0.18, TRIM, cx=sx * 0.065, cy=-0.27, z0=-0.02, ct=0.008, M=back)
    cyl(bm, 0.026, 0.2, TRIM, 10, cy=-0.15, z0=-0.02, ct=0.01, M=back)
    fdot(bm, 0.0, 0.41, 0.02, fy + 0.01, 0.012, LED, n=10)
    cyl(bm, 0.075, 0.02, ACCENT, 16, z0=H - 0.012, ct=0.008)


BUILDERS = {k: globals()["build_" + k] for k in KINDS}
# Largest side of each piece before normalising, in the builders' units (router height = 1.0).
# The satellite is 0.75: Atlas can scale by these to keep relative sizes.
NATIVE = {}

# --- assembly ----------------------------------------------------------------


def mesh_object(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def subtract(bm, cut, mats):
    """Boolean-difference cut from bm, keeping the cutter's trim material on the hole walls."""
    target = mesh_object("_target", bm, mats)
    cutter = mesh_object("_cutter", cut, mats)
    mod = target.modifiers.new("cut", 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.material_mode = 'INDEX'
    mod.object = cutter
    cutter.hide_render = True
    dg = bpy.context.evaluated_depsgraph_get()
    dg.update()
    out = bmesh.new()
    out.from_object(target, dg)
    for ob in (target, cutter):
        me = ob.data
        bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.meshes.remove(me)
    return out


def finish(kind, bm, mats):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    lo = Vector([min(v.co[i] for v in bm.verts) for i in range(3)])
    hi = Vector([max(v.co[i] for v in bm.verts) for i in range(3)])
    size = hi - lo
    NATIVE[kind] = round(max(size), 4)
    s = 1.0 / max(size)
    bm.transform(Matrix.Scale(s, 4) @ Matrix.Translation((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z)))
    for f in bm.faces:
        f.smooth = False
    ob = mesh_object(kind, bm, mats)
    ob.data.shade_flat()
    return ob


def build_kit(mats):
    pieces = []
    for kind in KINDS:
        bm, cut = bmesh.new(), bmesh.new()
        after = BUILDERS[kind](bm, cut)
        if cut.verts:
            bm = subtract(bm, cut, mats)
        else:
            cut.free()
        if after:
            after(bm)
        pieces.append(finish(kind, bm, mats))
    return pieces


def reset_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for block in list(coll):
            coll.remove(block)


def export(pieces, path):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in pieces:
        ob.location = (0, 0, 0)
        ob.rotation_euler = (0, 0, 0)
        ob.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True,
        export_apply=True, export_normals=True, export_texcoords=False, export_tangents=False,
        export_materials='EXPORT', export_vertex_color='NONE', export_image_format='NONE',
        export_animations=False, export_cameras=False, export_lights=False, export_skins=False,
        export_morph=False, export_extras=False, export_draco_mesh_compression_enable=False)


def stage(pieces, mats):
    """Lay the pieces out in a row with labels, a ground, a sun and an orthographic camera."""
    gap = 1.45
    for i, ob in enumerate(pieces):
        ob.location = (i * gap, 0, 0)
        ob.rotation_euler = (0, 0, math.radians(-22))
        txt = bpy.data.curves.new("label_" + ob.name, 'FONT')
        txt.body = ob.name
        txt.align_x = 'CENTER'
        txt.size = 0.2
        txt.materials.append(mats[TRIM])
        lab = bpy.data.objects.new("label_" + ob.name, txt)
        lab.location = (i * gap, -1.6, 0.06)
        lab.rotation_euler = (math.radians(90), 0, 0)
        bpy.context.scene.collection.objects.link(lab)

    ground_me = bpy.data.meshes.new("ground")
    bm = bmesh.new()
    rbox(bm, 40, 20, 0.01, BODY, z0=-0.01)
    bm.to_mesh(ground_me)
    gmat = bpy.data.materials.new("review_ground")
    gmat.use_nodes = True
    gmat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.5, 0.52, 0.55, 1)
    ground_me.materials.append(gmat)
    ground = bpy.data.objects.new("ground", ground_me)
    bpy.context.scene.collection.objects.link(ground)

    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", 'SUN'))
    sun.data.energy = 3.5
    sun.data.angle = math.radians(8)
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    bpy.context.scene.collection.objects.link(sun)

    cam_data = bpy.data.cameras.new("camera")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 14.8
    cam = bpy.data.objects.new("camera", cam_data)
    elev = math.radians(18)
    cx = (len(pieces) - 1) * gap / 2
    cam.location = (cx, -30 * math.cos(elev), 0.3 + 30 * math.sin(elev))
    cam.rotation_euler = (math.radians(90) - elev, 0, 0)
    bpy.context.scene.collection.objects.link(cam)

    scene = bpy.context.scene
    scene.camera = cam
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 1600, 500
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'Standard'
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.62, 0.64, 0.67, 1)
    bg.inputs["Strength"].default_value = 0.9


def triangles(pieces):
    return {ob.name: sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in pieces}


def main():
    reset_scene()
    mats = make_materials()
    pieces = build_kit(mats)
    export(pieces, os.path.join(OUT, "kit-gear.glb"))
    stage(pieces, mats)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "kit-gear.blend"))
    if REVIEW:
        bpy.context.scene.render.filepath = os.path.join(OUT, "kit-gear-review.png")
        bpy.ops.render.render(write_still=True)
    return triangles(pieces)


tris = main()
stats = {"triangles": tris, "total": sum(tris.values()), "native_size": NATIVE}
with open(os.path.join(OUT, "kit-gear-stats.json"), "w") as fh:
    json.dump(stats, fh, indent=1)
print("kit-gear", json.dumps(stats))
