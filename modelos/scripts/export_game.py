"""Exporta el jugador para el juego: una sola malla con esqueleto (mismas articulaciones que el juego), color por
"ranura" (piel, camiseta, ...) para pintar cada equipo, y un peinado de cada estilo.
Uso: blender -b juego.blend --python export_game.py -- salida.bin"""
import bpy, json, struct, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
scene = bpy.context.scene
RAW = json.loads(bpy.data.objects['jugador']['juego'])
J = {k: Vector(v) for k, v in RAW.items() if k not in ('prints', 'floor')}
PRINTS = RAW['prints']
# brazos y piernas simétricos
for a, b in (('shoulderL', 'shoulderR'), ('elbowL', 'elbowR'), ('wristL', 'wristR'), ('hipL', 'hipR'), ('kneeL', 'kneeR'), ('ankleL', 'ankleR')):
    x = (J[a].x - J[b].x) / 2
    y = (J[a].y + J[b].y) / 2
    z = (J[a].z + J[b].z) / 2
    J[a] = Vector((x, y, z))
    J[b] = Vector((-x, y, z))

SLOTS = ['piel', 'camiseta', 'panel', 'ribete', 'pantaloneta', 'franja', 'medias', 'rodilleras', 'tenis', 'suela',
         'detalle_tenis', 'pelo', 'ojos', 'cejas', 'boca']
BONES = ['hips', 'spine', 'neck', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'hipL', 'kneeL', 'hipR', 'kneeR']
BI = {n: i for i, n in enumerate(BONES)}
# triángulos máximos por pieza (el resto se simplifica)
BUDGET = {'pelo_': 2200, 'cuerpo': 2600, 'piernas': 1900, 'cabeza': 900, 'boca': 120, 'ceja_': 160, 'ojo_': 200,
          'tenis_': 500, 'suela_': 300, 'franja_': 60, 'mano_': 190, 'pulgar_': 90}


def sm(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


ARM_IN = J['shoulderL'].x - 0.075  # borde de adentro del brazo


def arm_w(p, side):
    """Hombro / codo a lo largo del brazo: el codo se reparte en una franja, como tela."""
    s, e, w = J['shoulder' + side], J['elbow' + side], J['wrist' + side]
    d = w - s
    t = (p - s).dot(d) / d.length_squared
    te = (e - s).dot(d) / d.length_squared
    we = sm(te - 0.12, te + 0.12, t)
    return {'shoulder' + side: 1 - we, 'elbow' + side: we}


def leg_w(p):
    hz, kz = J['hipL'].z, J['kneeL'].z
    wl = sm(-0.05, 0.05, p.x)        # la entrepierna se reparte entre las dos piernas
    wleg = sm(hz + 0.12, hz - 0.06, p.z)
    wk = sm(kz + 0.06, kz - 0.06, p.z)
    out = {'hips': 1 - wleg}
    for side, f in (('L', wl), ('R', 1 - wl)):
        out['hip' + side] = wleg * f * (1 - wk)
        out['knee' + side] = wleg * f * wk
    return out


def weights(name, p):
    side = 'L' if p.x > 0 else 'R'
    if name.startswith(('cabeza', 'oreja', 'pelo_', 'ojo_', 'ceja_', 'boca')):
        return {'neck': 1}
    if name == 'garganta':
        w = sm(J['neck'].z - 0.07, J['neck'].z + 0.02, p.z)
        return {'spine': 1 - w, 'neck': w}
    if name == 'cuerpo':
        wa = sm(ARM_IN - 0.05, ARM_IN + 0.04, abs(p.x))
        out = {k: v * wa for k, v in arm_w(p, side).items()}
        wh = sm(J['spine'].z + 0.04, J['spine'].z - 0.08, p.z)
        out['spine'] = (1 - wa) * (1 - wh)
        out['hips'] = (1 - wa) * wh
        return out
    if name in ('piernas', 'rodilleras'):
        return leg_w(p)
    if name.startswith(('mano_', 'pulgar_')):
        return {'elbow' + side: 1}
    if name.startswith(('tenis_', 'suela_', 'franja_')):
        return {'knee' + side: 1}
    raise ValueError(name)


def game(v):  # Blender (z arriba, frente -y) -> juego (y arriba, frente +z)
    return (v.x, v.z, -v.y)


pos, nrm, slot, sidx, swt = [], [], [], [], []
groups = {}
stats = {}
for o in sorted(scene.objects, key=lambda o: o.name):
    if o.type != 'MESH' or o.name.startswith('numero_'):
        continue
    budget = next((v for k, v in BUDGET.items() if o.name.startswith(k)), None)
    dg = bpy.context.evaluated_depsgraph_get()
    e = o.evaluated_get(dg)
    me = e.to_mesh()
    me.calc_loop_triangles()
    if budget and len(me.loop_triangles) > budget:
        ratio = budget / len(me.loop_triangles) * 0.98
        e.to_mesh_clear()
        dec = o.modifiers.new('juego', 'DECIMATE')
        dec.ratio = ratio
        dg = bpy.context.evaluated_depsgraph_get()
        e = o.evaluated_get(dg)
        me = e.to_mesh()
        me.calc_loop_triangles()
    mw = e.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    mats = [m.name.split('.')[0] if m else 'piel' for m in me.materials] or ['piel']
    if o.name.startswith('pelo_'):
        g = o.name
    elif any(m in ('ojos', 'cejas', 'boca') for m in mats):
        g = 'cara'
    else:
        g = 'cuerpo'
    tris = groups.setdefault(g, [])
    remap = {}
    for t in me.loop_triangles:
        mi = SLOTS.index(mats[min(t.material_index, len(mats) - 1)])
        tri = []
        for vi in t.vertices:
            key = (vi, mi)
            if key not in remap:
                v = me.vertices[vi]
                p = mw @ v.co
                n = (nm @ v.normal).normalized()
                w = sorted(((BI[b], x) for b, x in weights(o.name, p).items() if x > 1e-3), key=lambda q: -q[1])[:4]
                tot = sum(x for _, x in w)
                w = [(b, x / tot) for b, x in w] + [(0, 0.0)] * (4 - len(w))
                q = [round(x * 255) for _, x in w]
                q[0] += 255 - sum(q)
                remap[key] = len(slot)
                pos.append(game(p))
                nrm.append(game(n))
                slot.append(mi)
                sidx.append([b for b, _ in w])
                swt.append(q)
            tri.append(remap[key])
        tris.append(tri)
    stats[o.name] = len(me.loop_triangles)
    e.to_mesh_clear()

order = ['cuerpo', 'cara'] + sorted(k for k in groups if k.startswith('pelo_'))
index, ranges = [], {}
for g in order:
    ranges[g] = [len(index), len(groups[g]) * 3]
    for t in groups[g]:
        index += t
n = len(pos)
assert n < 65536, n
D = {
    'thigh': J['hipL'].z - J['kneeL'].z, 'shin': J['kneeL'].z - J['ankleL'].z, 'foot': J['ankleL'].z,
    'upperArm': (J['elbowL'] - J['shoulderL']).length, 'forearm': (J['wristL'] - J['elbowL']).length,
}
meta = {
    'vertexCount': n, 'indexCount': len(index), 'slots': SLOTS, 'bones': BONES,
    'joints': {k: list(game(v)) for k, v in J.items()}, 'dims': D, 'ranges': ranges,
    'prints': {k: [*game(Vector(l)), s] for k, (l, s) in PRINTS.items()},
}
js = json.dumps(meta).encode('utf-8')
js += b' ' * ((4 - len(js) % 4) % 4)
with open(OUT, 'wb') as f:
    f.write(b'VTJ1')
    f.write(struct.pack('<I', len(js)))
    f.write(js)
    f.write(struct.pack(f'<{n * 3}f', *[c for p in pos for c in p]))
    f.write(struct.pack(f'<{n * 4}b', *[c for v in nrm for c in (round(v[0] * 127), round(v[1] * 127), round(v[2] * 127), 0)]))
    f.write(bytes(slot) + b'\0' * ((4 - n % 4) % 4))
    f.write(bytes(c for s in sidx for c in s))
    f.write(bytes(c for s in swt for c in s))
    f.write(struct.pack(f'<{len(index)}H', *index))
print("STATS", json.dumps(stats))
print("EXPORT verts", n, "tris", len(index) // 3, "ranges", {k: v[1] // 3 for k, v in ranges.items()},
      "dims", {k: round(v, 3) for k, v in D.items()})
