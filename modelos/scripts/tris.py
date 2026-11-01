import bpy
dg = bpy.context.evaluated_depsgraph_get()
tot = 0
for o in sorted(bpy.context.scene.objects, key=lambda o: o.name):
    if o.type != 'MESH': continue
    e = o.evaluated_get(dg); me = e.to_mesh(); me.calc_loop_triangles()
    n = len(me.loop_triangles); tot += n
    print(f"TRIS {o.name:20s} {n:7d} verts {len(me.vertices)}")
    e.to_mesh_clear()
print("TRIS TOTAL", tot)
