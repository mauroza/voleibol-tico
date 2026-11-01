"""Viste y pinta el personaje del usuario. Uso: blender -b personaje_original.blend --python build.py -- salida.blend [jugador.json]
El json opcional cambia piel, pelo, peinado, colores del uniforme, número, altura y complexión (ver CFG)."""
import bpy, bmesh, sys, math, random, json
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
CFG = {
    'piel': (236, 170, 128), 'pelo': (58, 36, 26), 'peinado': 'mechones',  # mechones | rizado | corto | rapado
    'camiseta': (30, 31, 37), 'panel': (168, 170, 180), 'ribete': (196, 198, 206),
    'pantaloneta': (30, 31, 37), 'franja': (168, 170, 180), 'numero_color': (245, 245, 247), 'numero': '10',
    'rodilleras': (28, 28, 32), 'medias': (246, 246, 246), 'tenis': (248, 248, 248), 'detalle_tenis': (26, 26, 30),
    'altura': 1.9,       # metros
    'complexion': 1.0,   # ancho del cuerpo (0.9 delgado, 1.1 fornido); la cabeza no cambia
    'semilla': 10,
    'lod': 3,            # subdivisión del cuerpo y las piezas: 3 para fotos, 1 para el juego
    'peinados': None,    # lista de peinados: se arma uno por cada uno (pelo_<peinado>), para el juego
}
if len(argv) > 1:
    with open(argv[1], encoding='utf-8') as f:
        CFG.update(json.load(f))
random.seed(CFG['semilla'])
scene = bpy.context.scene
FRONT = -1  # el frente mira a -Y

# ---------- materiales ----------
def mat(name, rgb, rough=0.55, sheen=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if b is None:
        b = nt.nodes.new('ShaderNodeBsdfPrincipled')
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(b.outputs[0], out.inputs[0])
    col = tuple(c / 255 for c in rgb)
    lin = tuple(c ** 2.2 for c in col)
    b.inputs["Base Color"].default_value = (*lin, 1)
    b.inputs["Roughness"].default_value = rough
    m.diffuse_color = (*lin, 1)
    return m

M = {
    # paleta de la hoja del 10: piel durazno, negro carbón con paneles gris claro, blanco limpio
    'piel': mat('piel', CFG['piel'], 0.5),
    'camiseta': mat('camiseta', CFG['camiseta'], 0.75),
    'panel': mat('panel', CFG['panel'], 0.7),
    'ribete': mat('ribete', CFG['ribete'], 0.6),
    'pantaloneta': mat('pantaloneta', CFG['pantaloneta'], 0.75),
    'franja': mat('franja', CFG['franja'], 0.7),
    'numero': mat('numero', CFG['numero_color'], 0.6),
    'medias': mat('medias', CFG['medias'], 0.85),
    'rodilleras': mat('rodilleras', CFG['rodilleras'], 0.55),
    'tenis': mat('tenis', CFG['tenis'], 0.45),
    'suela': mat('suela', (236, 236, 238), 0.6),
    'detalle_tenis': mat('detalle_tenis', CFG['detalle_tenis'], 0.5),
    'pelo': mat('pelo', CFG['pelo'], 0.55),
    'ojos': mat('ojos', (14, 12, 12), 0.45),
    'cejas': mat('cejas', (26, 20, 18), 0.6),
    'boca': mat('boca', (92, 48, 38), 0.6),
}
# piel con un poco de luz por dentro, como el render de la hoja
_b = next(n for n in M['piel'].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
for k, v in (("Subsurface Weight", 0.25), ("Subsurface Scale", 0.03)):
    if k in _b.inputs:
        _b.inputs[k].default_value = v
for k in ('camiseta', 'pantaloneta', 'medias'):
    _c = next(n for n in M[k].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    if "Sheen Weight" in _c.inputs:
        _c.inputs["Sheen Weight"].default_value = 0.4

def setmats(obj, names):
    obj.data.materials.clear()
    for n in names:
        obj.data.materials.append(M[n])

def link(obj):
    scene.collection.objects.link(obj)
    return obj

def activate(obj):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

# ---------- base: aplicar escala y espejo (soldado al centro), luego posición; subdivisión ----------
for o in list(scene.objects):
    if o.type != 'MESH':
        continue
    activate(o)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    for m in list(o.modifiers):
        if m.type == 'MIRROR':
            m.use_mirror_merge = True
            m.merge_threshold = 0.06
            bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    for m in list(o.modifiers):
        if m.type == 'SUBSURF':
            # el tronco se ve bien con poca subdivisión; cabeza, orejas y piernas necesitan al menos 2
            m.levels = m.render_levels = CFG['lod'] if o.name == 'cuerpo' else max(2, CFG['lod'])
            if o.name in ('cuerpo', 'piernas'):
                bpy.ops.object.modifier_apply(modifier=m.name)
    for p in o.data.polygons:
        p.use_smooth = True

head = bpy.data.objects['cabeza']; body = bpy.data.objects['cuerpo']; neck = bpy.data.objects['garganta']
ear = bpy.data.objects['oreja']; legs = bpy.data.objects['piernas']

def bbox(obj):
    ev = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    ps = [ev.matrix_world @ v.co for v in me.vertices]
    ev.to_mesh_clear()
    return Vector([min(p[i] for p in ps) for i in range(3)]), Vector([max(p[i] for p in ps) for i in range(3)]), ps

HEAD_K = 1.07  # cabeza un poco más grande que el cuerpo, estilo juguete
# Cabeza más cuadrada (casi tan alta como ancha) y cuello más corto: crece hacia arriba desde la barbilla.
hmn0, hmx0, _ = bbox(head)
pivot = Vector(((hmn0.x + hmx0.x) / 2, (hmn0.y + hmx0.y) / 2, hmn0.z))
sq = Matrix.Translation(pivot) @ Matrix.Diagonal((0.96 * HEAD_K, HEAD_K, 1.13 * HEAD_K, 1.0)) @ Matrix.Translation(-pivot)
drop = Matrix.Translation((0, 0, -0.05))
for o in (head, ear):
    o.data.transform(drop @ sq)
# orejas un poco más chicas, cada una sobre su propio centro
hcx = pivot.x
for sd in (-1, 1):
    vs = [v for v in ear.data.vertices if (v.co.x - hcx) * sd > 0]
    ec = sum((v.co for v in vs), Vector()) / len(vs)
    for v in vs:
        v.co = ec + (v.co - ec) * 0.82
# cada oreja pegada al costado de la cabeza (metida un poco), a la misma altura en los dos lados
_, _, hp = bbox(head)
ear.data.update()
for sd in (-1, 1):
    vs = [v for v in ear.data.vertices if (v.co.x - hcx) * sd > 0]
    ez = sum(v.co.z for v in vs) / len(vs); ey = sum(v.co.y for v in vs) / len(vs)
    near = [q for q in hp if abs(q.z - ez) < 0.08 and abs(q.y - ey) < 0.12]
    side_x = max(q.x * sd for q in near) * sd
    inner = min(v.co.x * sd for v in vs) * sd
    dx = (side_x - sd * 0.04) - inner
    for v in vs:
        v.co.x += dx
neck.data.transform(Matrix.Translation((0, 0, 0.78 * 0.2)) @ Matrix.Diagonal((1, 1, 0.8, 1)))

dg = bpy.context.evaluated_depsgraph_get()

def evaluated_copy(obj, name):
    ev = obj.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    me.transform(obj.matrix_world)
    o = bpy.data.objects.new(name, me)
    return link(o)

tmn, tmx, bps = bbox(body)
CX = sum(p.x for p in bps if p.z > 0.5) / max(1, len([p for p in bps if p.z > 0.5]))
CY = (tmn.y + tmx.y) / 2
print("CX", CX, "CY", CY)
TORSO_R = 0.52  # |x-CX| menor que esto es tronco

for o in (head, neck, ear):
    setmats(o, ['piel'])

def cut(bm, co, no):
    """Corte recto: agrega aristas sobre el plano para que los bordes de la ropa queden limpios."""
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector(co), plane_no=Vector(no).normalized(), dist=0.0005)

# ---------- ropa pintada sobre el mismo cuerpo: nunca se abre ni deja ver piel ----------
def paint(obj, mats, cuts, assign, lift):
    """Corta la malla por planos, pinta cada cara con assign(centro, normal) y levanta un poco la tela (lift[índice])
    para que tenga relieve; los vértices del borde con la piel no se mueven, así no queda ninguna rendija."""
    setmats(obj, mats)  # antes de pintar: vaciar la lista de materiales borra los índices
    bm = bmesh.new(); bm.from_mesh(obj.data)
    for co, no in cuts:
        cut(bm, co, no)
    bm.normal_update()
    for f in bm.faces:
        f.material_index = assign(f.calc_center_median(), f.normal)
        f.smooth = True
    moves = []
    for v in bm.verts:
        ls = [lift[f.material_index] for f in v.link_faces]
        if ls and min(ls) > 0 and v.normal.z > -0.35:  # la entrepierna no se levanta
            moves.append((v, v.normal.copy() * (sum(ls) / len(ls))))
    for v, d in moves:
        v.co += d
    bm.to_mesh(obj.data); bm.free()

NECK_TOP = tmx.z
V0, VS, VW = 0.6, 1.25, 0.26      # punta de la V, pendiente, medio ancho arriba
SLEEVE = 0.22
COLLAR = NECK_TOP - 0.07
TR = 0.04                         # ancho del ribete
PANEL_TOP = 0.62
def front(c):
    return (c.y - CY) * FRONT > 0
def vline(dx):
    return V0 + dx * VS
PANEL, PK = 0.36, 0.7
def panel_u(c):
    return abs(c.x - CX) - PK * abs(c.y - CY)
shirt_cuts = [((CX + sd * PANEL, CY, 0), (sd, fb * PK, 0)) for sd in (-1, 1) for fb in (-1, 1)]
shirt_cuts += [((CX + sd * TORSO_R, 0, 0), (1, 0, 0)) for sd in (-1, 1)]
shirt_cuts += [((0, 0, z), (0, 0, 1)) for z in (PANEL_TOP, SLEEVE, SLEEVE + TR, COLLAR, COLLAR - TR)]
shirt_cuts += [((CX + sd * w, 0, 0), (1, 0, 0)) for sd in (-1, 1) for w in (0.22, 0.26, VW, VW + TR)]
for side in (-1, 1):
    for d in (0, TR):
        shirt_cuts.append(((CX, 0, V0 - d), (-VS * side, 0, 1)))  # plano de la V
shirt_cuts.append(((0, CY, 0), (0, 1, 0)))
# índices: 0 piel, 1 camiseta, 2 panel, 3 ribete
def shirt_assign(c, n):
    dx = abs(c.x - CX)
    arm = dx > TORSO_R
    if arm and c.z < SLEEVE:
        return 0
    if front(c) and dx < VW and c.z > vline(dx):
        return 0
    if not front(c) and dx < 0.22 and c.z > COLLAR:
        return 0
    if arm and c.z < SLEEVE + TR:
        return 3
    if front(c) and dx < VW + TR and c.z > vline(dx) - TR:
        return 3
    if not front(c) and dx < 0.26 and c.z > COLLAR - TR:
        return 3
    if not arm and panel_u(c) > PANEL and c.z < PANEL_TOP:
        return 2
    return 1
paint(body, ['piel', 'camiseta', 'panel', 'ribete'], shirt_cuts, shirt_assign, [0, 0.014, 0.014, 0.02])

# piernas: piel, medias, pantaloneta con franja al costado
lmn, lmx, lps = bbox(legs)
HEM, SOCK = -0.95, -1.5
STRIPE = 0.05
legs_cuts = [((0, 0, z), (0, 0, 1)) for z in (HEM, SOCK)]
legs_cuts += [((0, CY + d, 0), (0, 1, 0)) for d in (-STRIPE, STRIPE)]
legs_cuts += [((CX + sd * 0.3, 0, 0), (1, 0, 0)) for sd in (-1, 1)]
def legs_assign(c, n):
    if c.z > HEM:
        if abs(c.x - CX) > 0.3 and abs(c.y - CY) < STRIPE:
            return 3
        return 2
    return 1 if c.z < SOCK else 0
SHORTS_LIFT = 0.07
paint(legs, ['piel', 'medias', 'pantaloneta', 'franja'], legs_cuts, legs_assign, [0, 0.008, SHORTS_LIFT, SHORTS_LIFT])
# vuelo de la pantaloneta: más ancha abajo, ajustada en la cintura
bm = bmesh.new(); bm.from_mesh(legs.data); bm.normal_update()
for v in bm.verts:
    if v.co.z > HEM + 0.001 and v.normal.z > -0.35 and all(f.material_index >= 2 for f in v.link_faces):
        t = min(1, max(0, (-0.45 - v.co.z) / 0.5))
        v.co += v.normal * (0.05 * t - 0.03 * (1 - t))
bm.to_mesh(legs.data); bm.free()

def shell(src, name, cuts, keep, offset, mats, assign=None, solid=0.012):
    """Copia las caras de `src` que cumplen keep(centro, normal) tras los cortes, las infla `offset(p)` y les da grosor."""
    o = evaluated_copy(src, name)
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
    for co, no in cuts:
        cut(bm, co, no)
    bm.normal_update()
    drop = [f for f in bm.faces if not keep(f.calc_center_median(), f.normal)]
    bmesh.ops.delete(bm, geom=drop, context='FACES')
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * offset(v.co)
    setmats(o, mats)
    if assign:
        for f in bm.faces:
            f.material_index = assign(f.calc_center_median(), f.normal)
    bm.to_mesh(o.data); bm.free()
    for p in o.data.polygons:
        p.use_smooth = True
    if solid:
        s = o.modifiers.new("grosor", 'SOLIDIFY'); s.thickness = solid; s.offset = -1
    return o

KNEE = -1.2
knee = shell(legs, 'rodilleras', [((0, 0, KNEE - 0.17), (0, 0, 1)), ((0, 0, KNEE + 0.17), (0, 0, 1))],
             lambda c, n: KNEE - 0.17 < c.z < KNEE + 0.17, lambda p: 0.075 - 0.9 * max(0, abs(p.z - KNEE) - 0.1) ** 1, ['rodilleras'], None, 0.03)

# ---------- manos (puño tipo mitón) ----------
def rounded_box(name, size, loc, mats, levels=2, bevel=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    if bevel:
        # caja de esquinas redondeadas y caras planas (zapatilla de bloque)
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=6, profile=0.5, affect='EDGES', clamp_overlap=True)
    bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me))
    o.location = loc
    if not bevel:
        s = o.modifiers.new("Subdivisión", 'SUBSURF'); s.levels = levels; s.render_levels = levels
    for p in me.polygons:
        p.use_smooth = True
    setmats(o, mats)
    return o

hands = []
WRIST = {}
for side in (-1, 1):
    tip = [p for p in bps if (p.x - CX) * side > TORSO_R and p.z < tmn.z + 0.12]
    hx = sum(p.x for p in tip) / len(tip); hy = sum(p.y for p in tip) / len(tip)
    hz = tmn.z
    WRIST[side] = Vector((hx, hy, hz + 0.08))
    fist = rounded_box(f'mano_{"I" if side < 0 else "D"}', (0.41, 0.4, 0.42), (hx, hy, hz - 0.1), ['piel'])
    thumb = rounded_box(f'pulgar_{"I" if side < 0 else "D"}', (0.14, 0.16, 0.22), (hx - side * 0.17, hy + FRONT * 0.13, hz - 0.04), ['piel'])
    thumb.rotation_euler = (0, side * 0.25, 0)
    hands += [fist, thumb]

# ---------- tenis ----------
def soft_box(name, size, loc, mats, cuts=2, shape=None, levels=3):
    levels = min(levels, CFG['lod'] + 1)
    """Caja subdividida + Subsurf: forma blanda y redonda; shape(co, f) deforma (f=0 talón, 1 punta)."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for v in bm.verts:
        co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
        if shape:
            co = shape(co, v.co.y * FRONT + 0.5, v.co.z + 0.5)
        v.co = co
    bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me))
    o.location = loc
    s = o.modifiers.new("Subdivisión", 'SUBSURF'); s.levels = levels; s.render_levels = levels
    for p in me.polygons:
        p.use_smooth = True
    setmats(o, mats)
    return o

def upper_shape(co, f, h):
    # empeine que baja hacia la punta redonda; talón alto atrás
    if h > 0.5:
        co.z -= (h - 0.5) * 2 * size_up[2] * 0.38 * f ** 1.2
    # punta un poco más angosta y redonda
    co.x *= 1 - 0.08 * f ** 2
    return co

feet = []
FOOT = {}
for side in (-1, 1):
    bot = [p for p in lps if (p.x - CX) * side > 0 and p.z < lmn.z + 0.15]
    fx = sum(p.x for p in bot) / len(bot); fy = sum(p.y for p in bot) / len(bot)
    FOOT[side] = Vector((fx, fy, lmn.z))
    tag = "I" if side < 0 else "D"
    # zapatilla redonda y acolchada: capellada blanda, suela gruesa y franja negra al costado
    size_up = (0.47, 0.76, 0.42)
    shoe = soft_box(f'tenis_{tag}', size_up, (fx, fy + FRONT * 0.1, lmn.z - 0.01), ['tenis'], cuts=1, shape=upper_shape)
    sole = soft_box(f'suela_{tag}', (0.47, 0.77, 0.13), (fx, fy + FRONT * 0.1, lmn.z - 0.15), ['suela'], cuts=1)
    feet += [shoe, sole]
    for s2 in (-1, 1):
        stripe = soft_box(f'franja_{tag}{s2}', (0.04, 0.32, 0.065), (fx + s2 * 0.225, fy - FRONT * 0.0, lmn.z - 0.04),
                          ['detalle_tenis'], cuts=1, levels=2 if CFG['lod'] >= 3 else 1)
        stripe.rotation_euler = (-FRONT * 0.32, 0, 0)
        feet.append(stripe)

# ---------- cara ----------
hmn, hmx, hps = bbox(head)
HX = CX
def head_hit(x, z):
    """Punto y normal en el frente de la cabeza (rayo desde adelante)."""
    ev = head.evaluated_get(bpy.context.evaluated_depsgraph_get())
    inv = ev.matrix_world.inverted()
    origin = Vector((x, CY + FRONT * 3, z))
    ok, loc, nor, _ = ev.ray_cast(inv @ origin, inv.to_3x3() @ Vector((0, -FRONT, 0)))
    if not ok:
        return Vector((x, hmn.y, z)), Vector((0, FRONT, 0))
    return ev.matrix_world @ loc, (ev.matrix_world.to_3x3() @ nor).normalized()

def blob(name, size, x, z, mats, push=0.0, rot=0.0, pill=False):
    """Pieza de la cara pegada al frente de la cabeza: óvalo, o pastilla (caja redondeada) si pill."""
    p, n = head_hit(x, z)
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    if pill:
        bmesh.ops.create_cube(bm, size=2.0)
    else:
        bmesh.ops.create_uvsphere(bm, u_segments=24 if CFG['lod'] >= 3 else 14, v_segments=16 if CFG['lod'] >= 3 else 9, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    if pill:
        # bordes redondeados pero caras planas: cuadrado suave como en el dibujo
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=size[2] * 0.95, segments=6 if CFG['lod'] >= 3 else 3, profile=0.5, affect='EDGES', clamp_overlap=True)
    bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me))
    q = (n).to_track_quat('-Y' if FRONT < 0 else 'Y', 'Z')
    o.rotation_euler = (q.to_matrix() @ Matrix.Rotation(rot, 3, 'Y')).to_euler()
    o.location = p + n * push
    for pl in me.polygons:
        pl.use_smooth = True
    setmats(o, mats)
    return o

def line_on_face(name, pts, radius, mats):
    """Trazo fino (boca) que sigue la superficie de la cabeza."""
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    cu.bevel_depth = radius; cu.bevel_resolution = 3 if CFG['lod'] >= 3 else 1; cu.resolution_u = 12 if CFG['lod'] >= 3 else 4; cu.use_fill_caps = True
    sp = cu.splines.new('NURBS'); sp.points.add(len(pts) - 1)
    for i, (x, z) in enumerate(pts):
        p, n = head_hit(x, z)
        sp.points[i].co = (*(p + n * radius * 0.4), 1)
    sp.use_endpoint_u = True; sp.order_u = 3
    o = link(bpy.data.objects.new(name, cu))
    activate(o); bpy.ops.object.convert(target='MESH')
    o = bpy.context.view_layer.objects.active
    for pl in o.data.polygons:
        pl.use_smooth = True
    setmats(o, mats)
    return o

hh = hmx.z - hmn.z
face = []
EYE_Z = hmn.z + hh * 0.44
for side in (-1, 1):
    tag = "I" if side < 0 else "D"
    ex = HX + side * 0.215
    # ojos: óvalos altos negros, sin brillo
    face.append(blob(f'ojo_{tag}', (0.062, 0.022, 0.125), ex, EYE_Z, ['ojos'], -0.004))
    # cejas: gruesas, rectas y bajando hacia el centro (cara de concentrado)
    face.append(blob(f'ceja_{tag}', (0.13, 0.024, 0.05), ex, EYE_Z + 0.177, ['cejas'], 0.006, rot=-side * 0.32, pill=True))
# boca: sonrisa fina y chiquita
MZ = EYE_Z - 0.25
face.append(line_on_face('boca', [(HX + t * 0.085, MZ + 0.022 * t * t) for t in (-1, -0.5, 0, 0.5, 1)], 0.009, ['boca']))

# ---------- número ----------
FONT = 'C:/Windows/Fonts/ariblk.ttf'
PRINTS = {}
def number(name, target, x, z, size, back=False):
    cu = bpy.data.curves.new(name, 'FONT'); cu.body = str(CFG['numero']); cu.size = size
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.extrude = 0.004
    try:
        cu.font = bpy.data.fonts.load(FONT, check_existing=True)
    except Exception:
        pass
    o = link(bpy.data.objects.new(name, cu))
    ev = target.evaluated_get(bpy.context.evaluated_depsgraph_get())
    dirn = -FRONT if back else FRONT
    ok, loc, nor, _ = ev.ray_cast(Vector((x, CY + dirn * 3, z)), Vector((0, -dirn, 0)))
    o.location = loc + nor * 0.014
    PRINTS[name] = (loc.copy(), size)
    o.rotation_euler = (math.pi / 2, 0, math.pi if back else 0)
    activate(o); bpy.ops.object.convert(target='MESH')
    o = bpy.context.view_layer.objects.active
    setmats(o, ['numero'])
    return o
number('numero_pecho', body, CX, 0.3, 0.42)
number('numero_espalda', body, CX, 0.28, 0.5, back=True)
number('numero_short', legs, CX - 0.34, -0.75, 0.14)

# ---------- pelo (metaballs) ----------
# por peinado: separación, radio y despegue de las bolitas; mechones = óvalos largos peinados hacia atrás
HAIR = {
    'mechones': dict(sep=0.08, r=(0.14, 0.16), off=(0.0, 0.025), front=0.86, side=0.68, tuft=True),
    'rizado': dict(sep=0.085, r=(0.15, 0.2), off=(0.03, 0.08), front=0.86, side=0.68, tuft=False),
    'corto': dict(sep=0.08, r=(0.11, 0.13), off=(-0.01, 0.01), front=0.9, side=0.72, tuft=False),
    'rapado': dict(sep=0.07, r=(0.09, 0.1), off=(-0.03, -0.02), front=0.92, side=0.74, tuft=False),
}
def make_hair(style, name):
    H = HAIR[style]
    mb = bpy.data.metaballs.new('pelo')
    mb.resolution = mb.render_resolution = 0.03 if CFG['lod'] >= 3 else 0.05; mb.threshold = 0.6
    hair = link(bpy.data.objects.new('pelo', mb))
    # puntos de la cabeza bien subdividida (el pelo sale igual de tupido con cualquier lod)
    hm = next((m for m in head.modifiers if m.type == 'SUBSURF'), None)
    if hm:
        hm.levels = 3
    ev = head.evaluated_get(bpy.context.evaluated_depsgraph_get())
    hme = ev.to_mesh()
    cand = []
    for v in hme.vertices:
        p = ev.matrix_world @ v.co
        n = (ev.matrix_world.to_3x3() @ v.normal).normalized()
        rel = (p.z - hmn.z) / hh
        front = n.y * FRONT > 0.55
        if front and rel < H['front']:
            continue  # cara libre; solo un flequillo arriba
        if rel < H['side'] and not (n.y * FRONT < -0.45):  # costados: por encima de las orejas, que se vean enteras
            continue
        if rel < 0.22:
            continue
        cand.append((p, n, rel))
    ev.to_mesh_clear()
    if hm:
        hm.levels = max(2, CFG['lod'])
    random.shuffle(cand)
    placed = []
    for p, n, rel in cand:
        if all((p - q).length > H['sep'] for q in placed):
            placed.append(p)
            el = mb.elements.new()
            el.co = p + n * random.uniform(*H['off'])
            el.radius = random.uniform(*H['r'])
    def lock(name, p, n, d, L, W, T):
        """Mechón: gota larga que sale de p, sigue la dirección d sobre la cabeza y se afina en la punta."""
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=10, radius=1.0)
        side = n.cross(d).normalized()
        for v in bm.verts:
            u = v.co.x                                  # -1 raíz, 1 punta
            k = 0.45 + 0.55 * (1 - (u + 1) / 2) ** 0.7  # más fino hacia la punta
            along = (u + 1) / 2 * L
            v.co = p + d * along + side * (v.co.y * W * k) + n * (v.co.z * T * k - 0.35 * T * ((u + 1) / 2) ** 2)
        bm.to_mesh(me); bm.free()
        o = link(bpy.data.objects.new(name, me))
        for pl in me.polygons:
            pl.use_smooth = True
        return o
    locks = []
    if H['tuft']:
        # mechones definidos encima del casco: peinados hacia atrás; en el flequillo caen hacia adelante
        roots = []
        for p, n, rel in cand:
            if rel < 0.6 or not all((p - q).length > 0.17 for q in roots):
                continue
            roots.append(p)
            fringe = n.y * FRONT > 0.25 and rel > 0.82
            d = Vector((random.uniform(-0.25, 0.25), FRONT * (0.8 if fringe else -1), -0.35 if fringe else -0.55))
            d = (d - n * d.dot(n)).normalized()
            L = random.uniform(0.3, 0.4) if not fringe else random.uniform(0.22, 0.28)
            locks.append(lock(f'mechon{len(roots)}', p + n * 0.05 - d * 0.05, n, d, L, random.uniform(0.1, 0.13), 0.07))
    print("pelo", style, len(mb.elements))
    activate(hair)
    bpy.ops.object.convert(target='MESH')
    hair = bpy.context.view_layer.objects.active
    hair.name = name
    if locks:
        activate(hair)
        for o in locks:
            o.select_set(True)
        bpy.ops.object.join()
        hair = bpy.context.view_layer.objects.active
    setmats(hair, ['pelo'])
    for p in hair.data.polygons:
        p.use_smooth = True
    return hair

if CFG['peinados']:
    for st in CFG['peinados']:
        make_hair(st, f'pelo_{st}')
else:
    make_hair(CFG['peinado'], 'pelo')

# ---------- quitar objetos sobrantes, agrupar, escalar a 1,90 m ----------
for n in ('Vacío',):
    if n in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[n])
root = link(bpy.data.objects.new('jugador', None))
mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
dg = bpy.context.evaluated_depsgraph_get()
for o in scene.objects:
    if o.type != 'MESH' or o.name.startswith('pelo_'):
        continue
    e = o.evaluated_get(dg); me = e.to_mesh()
    for v in me.vertices:
        w = e.matrix_world @ v.co
        mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
    e.to_mesh_clear()
height = mx.z - mn.z
k = CFG['altura'] / height
print("altura", height, "escala", k)
root.location = (0, 0, 0)
# complexión: ensancha cuerpo, brazos y piernas alrededor del eje; la cabeza queda igual pero se recentra
C = CFG['complexion']
wide = Matrix.Translation((CX, CY, 0)) @ Matrix.Diagonal((C, C, 1, 1)) @ Matrix.Translation((-CX, -CY, 0))
HEAD_PARTS = ('cabeza', 'oreja', 'pelo', 'ojo_', 'ceja_', 'boca')
for o in scene.objects:
    if o.type == 'MESH':
        mw = o.matrix_world.copy()
        if not o.name.startswith(HEAD_PARTS):
            mw = wide @ mw
        o.parent = root
        o.matrix_world = Matrix.Translation((-CX * k, -CY * k, -mn.z * k)) @ Matrix.Scale(k, 4) @ mw
# articulaciones para el juego (mismas que el esqueleto del juego), ya en las coordenadas finales
F = Matrix.Translation((-CX * k, -CY * k, -mn.z * k)) @ Matrix.Scale(k, 4) @ wide
arm_r = 0.2
J = {'neck': Vector((CX, CY, NECK_TOP - 0.06))}
HIP_Z = lmx.z - 0.4
J['hips'] = Vector((CX, CY, HIP_Z))
J['spine'] = Vector((CX, CY, HIP_Z + 0.15))
for side, tag in ((1, 'L'), (-1, 'R')):
    arm = [p for p in bps if (p.x - CX) * side > TORSO_R + 0.05]
    top = max(p.z for p in arm)
    near = [p for p in arm if p.z > top - 0.3]
    sh = Vector((sum(p.x for p in near) / len(near), CY, top - arm_r))
    J['shoulder' + tag] = sh
    J['wrist' + tag] = WRIST[side]
    J['elbow' + tag] = (sh + WRIST[side]) / 2
    f = FOOT[side]
    J['hip' + tag] = Vector((f.x, CY, HIP_Z))
    J['knee' + tag] = Vector((f.x, CY, KNEE))
    J['ankle' + tag] = Vector((f.x, CY, lmn.z + 0.1))
out = {n: list(F @ v) for n, v in J.items()}
out['floor'] = 0.0
out['prints'] = {n: [list(F @ l), sz * k] for n, (l, sz) in PRINTS.items()}
root['juego'] = json.dumps(out)
print("JOINTS", json.dumps({n: [round(x, 3) for x in v] for n, v in out.items() if n not in ('prints', 'floor')}))
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print("SAVED", OUT)
