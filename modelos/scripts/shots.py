"""Fotos del personaje: frente, lado, espalda y 3/4. Uso: blender -b file.blend --python shots.py -- outprefix [engine]"""
import bpy, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = argv[0] if argv else "//shot"
engine = argv[1] if len(argv) > 1 else "WORKBENCH"

scene = bpy.context.scene
dg = bpy.context.evaluated_depsgraph_get()
mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
for o in scene.objects:
    if o.type != 'MESH' or o.hide_render:
        continue
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    for v in me.vertices:
        w = ev.matrix_world @ v.co
        mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
    ev.to_mesh_clear()
c = (mn + mx) / 2
h = max(mx.z - mn.z, mx.x - mn.x, mx.y - mn.y)
print("BBOX", tuple(round(x, 3) for x in mn), tuple(round(x, 3) for x in mx))

cam_data = bpy.data.cameras.new("shotcam")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = h * 1.1
cam = bpy.data.objects.new("shotcam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
scene.render.resolution_x = 700
scene.render.resolution_y = 800
scene.render.film_transparent = False
if engine == "WORKBENCH":
    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_shadows = False
    sh.show_cavity = False
else:
    for e in ('BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'):
        try:
            scene.render.engine = e
            break
        except Exception:
            pass
    for o in [o for o in scene.objects if o.type == 'LIGHT']:
        bpy.data.objects.remove(o)
    # luz de estudio como la hoja: principal cálida, relleno suave y contraluz frío
    for rot, energy, col in (((0.85, 0.15, -0.55), 3.2, (1.0, 0.95, 0.88)), ((1.25, 0, 0.9), 1.0, (0.85, 0.9, 1.0)),
                             ((1.9, 0, 2.9), 3.0, (0.75, 0.82, 1.0))):
        ld = bpy.data.lights.new("sol", 'SUN'); ld.energy = energy; ld.angle = 0.5; ld.color = col
        lo = bpy.data.objects.new("sol", ld); lo.rotation_euler = rot
        scene.collection.objects.link(lo)
world = scene.world or bpy.data.worlds.new("w")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
if bg:
    bg.inputs[0].default_value = (0.03, 0.035, 0.06, 1)
    bg.inputs[1].default_value = 1.0
scene.view_settings.view_transform = 'AgX'
try:
    scene.view_settings.look = 'AgX - Medium High Contrast'
except Exception:
    pass
for attr, val in (("use_gtao", True), ("gtao_distance", 0.3), ("use_shadows", True)):
    if hasattr(scene.eevee, attr):
        setattr(scene.eevee, attr, val)

d = h * 3
views = {"frente": (0, -1, 0.08), "lado": (1, 0, 0.05), "espalda": (0, 1, 0.08), "tres_cuartos": (0.75, -1, 0.25), "tres_cuartos_izq": (-0.8, -1, 0.15)}
for name, dirv in views.items():
    dv = Vector(dirv).normalized()
    cam.location = c + dv * d
    cam.rotation_euler = (-dv).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = f"{out}_{name}.png"
    bpy.ops.render.render(write_still=True)

# primer plano de la cabeza
cam_data.ortho_scale = h * 0.42
dv = Vector((0.45, -1, 0.12)).normalized()
cc = Vector((c.x, c.y, mn.z + (mx.z - mn.z) * 0.8))
cam.location = cc + dv * d
cam.rotation_euler = (-dv).to_track_quat('-Z', 'Y').to_euler()
scene.render.resolution_x = 700; scene.render.resolution_y = 700
scene.render.filepath = f"{out}_cara.png"
bpy.ops.render.render(write_still=True)

# axila de cerca (lado izquierdo de la imagen)
cam_data.ortho_scale = h * 0.3
for nm, dvv in (("axila", (-0.9, -0.6, -0.15)), ("axila_atras", (-0.9, 0.6, -0.15))):
    dv = Vector(dvv).normalized()
    cc = Vector((mn.x + (mx.x - mn.x) * 0.3, c.y, mn.z + (mx.z - mn.z) * 0.6))
    cam.location = cc + dv * d
    cam.rotation_euler = (-dv).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = f"{out}_{nm}.png"
    bpy.ops.render.render(write_still=True)

# tenis de cerca
cam_data.ortho_scale = h * 0.32
dv = Vector((-0.8, -1, 0.3)).normalized()
cc = Vector((c.x, c.y, mn.z + (mx.z - mn.z) * 0.08))
cam.location = cc + dv * d
cam.rotation_euler = (-dv).to_track_quat('-Z', 'Y').to_euler()
scene.render.filepath = f"{out}_tenis.png"
bpy.ops.render.render(write_still=True)
