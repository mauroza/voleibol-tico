import * as THREE from 'three';
import { JOINTS, type JointName } from './pose';
import type { Dims, Look, Rig } from './character';
import { OUTLINE_SKINNED, toonVertexColors } from './toon';
import modelUrl from '../assets/jugador.bin?url';

/**
 * Jugador modelado en Blender (modelos/personaje.blend → src/assets/jugador.bin): una sola malla con esqueleto y
 * las mismas articulaciones que el juego, así que todas las animaciones (remate, saque, bloqueo, plancha…) sirven igual.
 * Cada vértice dice qué es (piel, camiseta, panel, …): los colores de cada equipo se pintan al armar al jugador.
 *
 * Formato del archivo (lo escribe `_tmp/export_game.py`): "VTJ1", largo del JSON, JSON, y luego posiciones (f32 ×3),
 * normales (i8 ×4), ranura (u8, relleno a 4), huesos (u8 ×4), pesos (u8 ×4) e índices (u16).
 */

export type ModelHair = 'mechones' | 'rizado' | 'corto' | 'rapado';
export const MODEL_HAIRS: readonly ModelHair[] = ['mechones', 'rizado', 'corto', 'rapado'];

export interface ModelMeta {
  vertexCount: number;
  indexCount: number;
  slots: string[];
  bones: string[];
  /** Articulaciones en el espacio del personaje (y arriba, mira hacia +z, pies en y = 0). */
  joints: Record<string, [number, number, number]>;
  dims: Dims;
  /** [inicio, cantidad] de índices: cuerpo, cara y un peinado de cada estilo. */
  ranges: Record<string, [number, number]>;
  /** Donde van el número del pecho y la espalda: [x, y, z, tamaño]. */
  prints: Record<string, [number, number, number, number]>;
}

export interface ModelData {
  meta: ModelMeta;
  position: Float32Array;
  normal: Float32Array;
  slot: Uint8Array;
  skinIndex: Uint8Array;
  skinWeight: Uint8Array;
  index: Uint16Array;
}

export function parseModel(buf: ArrayBuffer): ModelData {
  const magic = new TextDecoder().decode(new Uint8Array(buf, 0, 4));
  if (magic !== 'VTJ1') throw new Error(`modelo: formato desconocido (${magic})`);
  const jsonLen = new DataView(buf).getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, jsonLen))) as ModelMeta;
  const n = meta.vertexCount;
  let o = 8 + jsonLen;
  const take = <T>(make: (o: number) => T, bytes: number): T => {
    const out = make(o);
    o += bytes;
    return out;
  };
  const position = take((at) => new Float32Array(buf.slice(at, at + n * 12)), n * 12);
  const packed = take((at) => new Int8Array(buf, at, n * 4), n * 4);
  const normal = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) normal[i * 3 + k] = packed[i * 4 + k] / 127;
  }
  const slot = take((at) => new Uint8Array(buf.slice(at, at + n)), n + ((4 - (n % 4)) % 4));
  const skinIndex = take((at) => new Uint8Array(buf.slice(at, at + n * 4)), n * 4);
  const skinWeight = take((at) => new Uint8Array(buf.slice(at, at + n * 4)), n * 4);
  const index = take((at) => new Uint16Array(buf.slice(at, at + meta.indexCount * 2)), meta.indexCount * 2);
  return { meta, position, normal, slot, skinIndex, skinWeight, index };
}

/** Geometría compartida por todos los jugadores (solo cambia el color) e índices por peinado. */
interface Shared {
  data: ModelData;
  attrs: Record<'position' | 'normal' | 'skinIndex' | 'skinWeight', THREE.BufferAttribute>;
  /** Cuerpo + cara + pelo, y el contorno (sin la cara: si no, rayas alrededor de ojos y cejas). */
  index: Map<ModelHair, { mesh: THREE.BufferAttribute; outline: THREE.BufferAttribute }>;
}

let shared: Shared | null = null;
let loading: Promise<boolean> | null = null;

export function useModel(data: ModelData): void {
  const attrs = {
    position: new THREE.BufferAttribute(data.position, 3),
    normal: new THREE.BufferAttribute(data.normal, 3),
    skinIndex: new THREE.BufferAttribute(data.skinIndex, 4),
    skinWeight: new THREE.BufferAttribute(data.skinWeight, 4, true),
  };
  const part = (name: string) => {
    const [start, count] = data.meta.ranges[name];
    return data.index.subarray(start, start + count);
  };
  const index = new Map<ModelHair, { mesh: THREE.BufferAttribute; outline: THREE.BufferAttribute }>();
  for (const h of MODEL_HAIRS) {
    const hair = part(`pelo_${h}`);
    const body = part('cuerpo');
    const face = part('cara');
    const mesh = new Uint16Array(body.length + face.length + hair.length);
    mesh.set(body);
    mesh.set(face, body.length);
    mesh.set(hair, body.length + face.length);
    const outline = new Uint16Array(body.length + hair.length);
    outline.set(body);
    outline.set(hair, body.length);
    index.set(h, { mesh: new THREE.BufferAttribute(mesh, 1), outline: new THREE.BufferAttribute(outline, 1) });
  }
  shared = { data, attrs, index };
}

/** El archivo del modelo: en el build del Artifact viene dentro del código (data:), si no se baja aparte. */
async function modelBytes(url: string): Promise<ArrayBuffer> {
  if (url.startsWith('data:')) {
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`modelo: ${r.status}`);
  return r.arrayBuffer();
}

/** Carga el modelo una sola vez. Si falla (sin red), el juego sigue con el cuerpo de bloques. */
export function loadPlayerModel(url: string = modelUrl): Promise<boolean> {
  loading ??= modelBytes(url)
    .then((buf) => {
      useModel(parseModel(buf));
      return true;
    })
    .catch((err) => {
      console.warn('No se pudo cargar el modelo del jugador; se usan los bloques.', err);
      return false;
    });
  return loading;
}

export const modelReady = (): boolean => shared !== null;

export interface ModelColors {
  shirt: string;
  shorts: string;
  skin: string;
  hair: string;
  trim: string;
}

/** Color de cada ranura del modelo para este jugador. */
function slotColors(c: ModelColors): Record<string, string> {
  return {
    piel: c.skin,
    camiseta: c.shirt,
    // Paneles al costado y franja de la pantaloneta: el otro color del uniforme (como el gris del dibujo del 10).
    panel: c.shorts,
    ribete: c.trim,
    pantaloneta: c.shorts,
    franja: c.shirt,
    medias: '#f2f2f2',
    rodilleras: '#22252b',
    tenis: '#f6f6f6',
    suela: '#e2e2e6',
    detalle_tenis: '#1c1c22',
    pelo: c.hair,
    ojos: '#120e0e',
    cejas: '#1e1614',
    boca: '#5a2420',
    // Cuero cabelludo bajo el pelo: del color del pelo, así no asoma piel entre los mechones.
    cuero: c.hair,
  };
}

/** Peinado del modelo: rapado si no tiene pelo; si no, uno fijo por jugador. */
export function modelHairFor(look: Pick<Look, 'hair' | 'name' | 'number'>): ModelHair {
  if (!look.hair) return 'rapado';
  let h = look.number * 7;
  for (const ch of look.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (['mechones', 'mechones', 'corto', 'rizado', 'mechones', 'corto'] as const)[h % 6];
}

/** Cuánto se cierran los brazos respecto del modelo (rad). */
const ARMS_IN = 0.11;

const BONE_PARENT: Record<string, string | null> = {
  hips: null, spine: 'hips', neck: 'spine',
  shoulderL: 'spine', elbowL: 'shoulderL', shoulderR: 'spine', elbowR: 'shoulderR',
  hipL: 'hips', kneeL: 'hipL', hipR: 'hips', kneeR: 'hipR',
};

/**
 * Arma un jugador con el modelo. Los huesos del juego no tienen giro en reposo (las poses se aplican como ángulos
 * directos); los brazos del modelo cuelgan un poco abiertos, así que entre hombro y codo hay un hueso fijo con esa
 * inclinación: el codo se dobla en el plano del brazo y la mano queda en (0, −antebrazo, 0) del codo, como en el juego.
 */
export function buildModelCharacter(look: Look, colors: ModelColors, prints: (spine: THREE.Bone, at: Record<string, [number, number, number, number]>) => void): Rig {
  if (!shared) throw new Error('modelo sin cargar');
  const { data, attrs } = shared;
  const { meta } = data;
  const J = meta.joints;
  const v = (n: string) => new THREE.Vector3(...J[n]);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const bones = new Map<string, THREE.Bone>();
  const tilts: [THREE.Bone, 1 | -1][] = [];
  const world = new Map<string, THREE.Vector3>();
  for (const name of meta.bones) {
    const b = new THREE.Bone();
    b.name = name;
    bones.set(name, b);
    world.set(name, v(name));
  }
  for (const name of meta.bones) {
    const b = bones.get(name)!;
    const parent = BONE_PARENT[name];
    if (!parent) {
      b.position.copy(world.get(name)!);
      body.add(b);
      continue;
    }
    if (name.startsWith('elbow')) {
      // Hueso fijo con la inclinación del brazo, y el codo a lo largo de él.
      const side = name.slice(-1);
      const shoulder = world.get(`shoulder${side}`)!;
      const dir = world.get(name)!.clone().sub(shoulder);
      const tilt = new THREE.Bone();
      tilt.name = `arm${side}`;
      tilt.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize());
      bones.get(parent)!.add(tilt);
      tilts.push([tilt, side === 'L' ? 1 : -1]);
      b.position.set(0, -dir.length(), 0);
      tilt.add(b);
      continue;
    }
    b.position.copy(world.get(name)!).sub(world.get(parent)!);
    bones.get(parent)!.add(b);
  }

  // Color por vértice de este jugador; el resto de la geometría es la misma para todos.
  const palette = slotColors(colors);
  const slotRGB = meta.slots.map((s) => new THREE.Color(palette[s] ?? '#ff00ff'));
  const n = meta.vertexCount;
  const color = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = slotRGB[data.slot[i]];
    color[i * 3] = c.r;
    color[i * 3 + 1] = c.g;
    color[i * 3 + 2] = c.b;
  }
  const colorAttr = new THREE.BufferAttribute(color, 3);
  const idx = shared.index.get(modelHairFor(look))!;
  const geometry = (index: THREE.BufferAttribute, withColor: boolean) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', attrs.position);
    g.setAttribute('normal', attrs.normal);
    g.setAttribute('skinIndex', attrs.skinIndex);
    g.setAttribute('skinWeight', attrs.skinWeight);
    if (withColor) g.setAttribute('color', colorAttr);
    g.setIndex(index);
    return g;
  };
  const mesh = new THREE.SkinnedMesh(geometry(idx.mesh, true), toonVertexColors());
  const outline = new THREE.SkinnedMesh(geometry(idx.outline, false), OUTLINE_SKINNED);
  root.add(mesh, outline);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(meta.bones.map((b) => bones.get(b)!));
  mesh.bind(skeleton);
  outline.bind(skeleton, mesh.bindMatrix);
  // Ya atado: los brazos se arriman al cuerpo (el modelo los tiene abiertos y en las filas chocaban con el vecino).
  for (const [tilt, side] of tilts) tilt.rotateZ(-side * ARMS_IN);
  // Esfera holgada (los huesos mueven la malla: saltos, planchas), como el cuerpo de bloques.
  const bounds = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2.4);
  mesh.boundingSphere = bounds;
  outline.boundingSphere = bounds;

  const spine = bones.get('spine')!;
  if (look.number > 0) prints(spine, Object.fromEntries(Object.entries(meta.prints).map(([k, p]) => {
    const s = world.get('spine')!;
    return [k, [p[0] - s.x, p[1] - s.y, p[2] - s.z, p[3]]];
  })));

  const joints = {} as Record<JointName, THREE.Object3D>;
  for (const j of JOINTS) joints[j] = bones.get(j)!;
  return { dims: { ...meta.dims }, root, body, hips: bones.get('hips')!, joints };
}
