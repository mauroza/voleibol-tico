"""Pone varios jugadores lado a lado y saca una foto. Uso: blender -b base.blend --python lineup.py -- salida.png otro1.blend otro2.blend ..."""
import bpy, sys
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
out, others = argv[0], argv[1:]
scene = bpy.context.scene
engine = "EEVEE"
roots = [bpy.data.objects['jugador']]
for path in others:
    with bpy.data.libraries.load(path) as (src, dst):
        dst.objects = list(src.objects)
    objs = [o for o in dst.objects if o and o.type in ('MESH', 'EMPTY') and not o.name.startswith('shotcam')]
    for o in objs:
        scene.collection.objects.link(o)
    roots.append(next(o for o in objs if o.type == 'EMPTY' and o.name.startswith('jugador')))
for i, r in enumerate(roots):
    r.location.x = (i - (len(roots) - 1) / 2) * 1.25
bpy.context.view_layer.update()
scene = bpy.context.scene
engine = "EEVEE"
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

cam_data.ortho_scale = (mx.x - mn.x) * 1.15
scene.render.resolution_x = 1400; scene.render.resolution_y = 800
dv = Vector((0.35, -1, 0.12)).normalized()
cam.location = c + dv * h * 3
cam.rotation_euler = (-dv).to_track_quat('-Z', 'Y').to_euler()
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
