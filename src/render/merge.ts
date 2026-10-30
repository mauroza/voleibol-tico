import * as THREE from 'three';

export interface Part {
  geometry: THREE.BufferGeometry;
  color: THREE.ColorRepresentation;
  /** Transformación local de la pieza respecto de su articulación. */
  matrix: THREE.Matrix4;
}

/**
 * Une varias piezas indexadas en una sola geometría con color por vértice.
 * Una malla por articulación en lugar de una por pieza: muchas menos llamadas de dibujo.
 */
export function mergeParts(parts: readonly Part[]): THREE.BufferGeometry {
  let vertices = 0;
  let indices = 0;
  for (const p of parts) {
    vertices += p.geometry.attributes.position.count;
    indices += p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count;
  }
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const color = new Float32Array(vertices * 3);
  const uv = new Float32Array(vertices * 2);
  const index = new Uint32Array(indices);
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  const c = new THREE.Color();
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    const g = p.geometry;
    const pos = g.attributes.position;
    const nrm = g.attributes.normal;
    const tex = g.attributes.uv;
    nm.getNormalMatrix(p.matrix);
    c.set(p.color);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(p.matrix);
      position.set([v.x, v.y, v.z], (vo + i) * 3);
      v.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
      normal.set([v.x, v.y, v.z], (vo + i) * 3);
      color.set([c.r, c.g, c.b], (vo + i) * 3);
      if (tex) uv.set([tex.getX(i), tex.getY(i)], (vo + i) * 2);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) index[io + i] = g.index.getX(i) + vo;
    else for (let i = 0; i < pos.count; i++) index[io + i] = vo + i;
    io += g.index ? g.index.count : pos.count;
    vo += pos.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setAttribute('color', new THREE.BufferAttribute(color, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

/**
 * Une las geometrías de cada articulación (ya en el espacio del personaje) en una sola, con el hueso de cada vértice
 * (`skinIndex`, peso 1): todo el personaje se dibuja en una sola llamada y los huesos lo deforman en la GPU.
 */
export function mergeSkinned(pieces: readonly { geometry: THREE.BufferGeometry; bone: number }[]): THREE.BufferGeometry {
  let vertices = 0;
  let indices = 0;
  for (const p of pieces) {
    vertices += p.geometry.attributes.position.count;
    indices += p.geometry.index!.count;
  }
  const out = new THREE.BufferGeometry();
  const attr = (size: number) => new Float32Array(vertices * size);
  const position = attr(3);
  const normal = attr(3);
  const color = attr(3);
  const uv = attr(2);
  const skinIndex = new Uint16Array(vertices * 4);
  const skinWeight = new Float32Array(vertices * 4);
  const index = new Uint32Array(indices);
  let vo = 0;
  let io = 0;
  for (const p of pieces) {
    const g = p.geometry;
    const n = g.attributes.position.count;
    position.set(g.attributes.position.array as Float32Array, vo * 3);
    normal.set(g.attributes.normal.array as Float32Array, vo * 3);
    color.set(g.attributes.color.array as Float32Array, vo * 3);
    uv.set(g.attributes.uv.array as Float32Array, vo * 2);
    for (let i = 0; i < n; i++) {
      skinIndex[(vo + i) * 4] = p.bone;
      skinWeight[(vo + i) * 4] = 1;
    }
    const src = g.index!;
    for (let i = 0; i < src.count; i++) index[io + i] = src.getX(i) + vo;
    io += src.count;
    vo += n;
  }
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setAttribute('color', new THREE.BufferAttribute(color, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

/** Matriz de una pieza: posición, rotación (Euler) y escala. */
export function placed(x: number, y: number, z: number, rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
    new THREE.Vector3(...scale),
  );
}
