import * as THREE from 'three';
import { mergeParts, mergeSkinned, placed, type Part } from './merge';
import type { JointName } from './pose';
import { OUTLINE_SKINNED, applyCharShading, toon, toonVertexColors } from './toon';
import { charStyle, type CharStyle, type HairStyle } from './style';

/** Medidas del personaje (metros). */
export const DIMS = {
  thigh: 0.47,
  shin: 0.47,
  foot: 0.06,
  upperArm: 0.3,
  forearm: 0.29,
} as const;

/** Uniforme y apariencia de un jugador. */
export interface Look {
  shirt: string;
  shorts: string;
  skin: string;
  /** null: rapado. */
  hair: string | null;
  number: number;
  name: string;
  /** Mangas de compresión por lado (L, R) y su color. */
  armSleeve: { L: boolean; R: boolean };
  legSleeve: { L: boolean; R: boolean };
  sleeve: string;
}

/** Tonos de piel, de claro a muy oscuro. */
export const SKIN_TONES = ['#f3d2b3', '#e2b48c', '#c98e62', '#a06a42', '#6e4428', '#43281a'] as const;
/** Pelo: naturales primero, después los llamativos estilo anime (rubio platino, blanco, rosado, azul, rojo, verde, morado). */
export const HAIR_COLORS = ['#1b1512', '#3a2618', '#5e3b22', '#f2e6b8', '#f4f4f6', '#ff7ab8', '#3d8bff', '#e8322e', '#33d17a', '#9b5cff', '#ff9a1f'] as const;
/** Índice de pelo para "rapado". */
export const SHAVED = HAIR_COLORS.length;

/** Medidas de un personaje (las del estilo: las piernas de bloque pueden ser más cortas). */
export type Dims = { thigh: number; shin: number; foot: number; upperArm: number; forearm: number };

/**
 * Medidas según el estilo: `legs` acorta muslo y pierna (el tronco crece lo mismo, así los hombros y el alcance de los
 * brazos quedan a la misma altura que en la simulación).
 */
export function dimsFor(st: CharStyle): Dims {
  return { ...DIMS, thigh: DIMS.thigh * st.legs, shin: DIMS.shin * st.legs };
}

/** Cuánto crece el tronco para compensar las piernas más cortas (m). */
const torsoLift = (D: Dims): number => DIMS.thigh + DIMS.shin - D.thigh - D.shin;

export interface Rig {
  /** Medidas de este personaje (las animaciones las usan para doblar piernas y apoyar los pies). */
  dims: Dims;
  root: THREE.Group;
  /** Hijo de root: se desplaza en y para los saltos. */
  body: THREE.Group;
  hips: THREE.Object3D;
  joints: Record<JointName, THREE.Object3D>;
}

/** Camisa del color del equipo (el líbero, del secundario) y pantaloneta que contraste. */
export function lookFor(
  p: { number: number; skin: number; hair: number; armSleeve: number; legSleeve: number; sleeveColor: number },
  name: string,
  primary: string,
  secondary: string,
  libero: boolean,
): Look {
  const sides = (n: number) => ({ L: n === 1 || n === 3, R: n === 2 || n === 3 });
  return {
    armSleeve: sides(p.armSleeve),
    legSleeve: sides(p.legSleeve),
    sleeve: p.sleeveColor === 1 ? '#f2f2f2' : '#15161a',
    shirt: libero ? secondary : primary,
    shorts: shortsFor(primary, secondary),
    skin: SKIN_TONES[Math.min(SKIN_TONES.length - 1, Math.max(0, p.skin))],
    hair: p.hair >= SHAVED ? null : HAIR_COLORS[p.hair],
    number: p.number,
    name,
  };
}

/** La pantaloneta usa el secundario si contrasta con la camisa; si no, azul marino. */
function shortsFor(primary: string, secondary: string): string {
  const a = new THREE.Color(primary);
  const b = new THREE.Color(secondary);
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) > 0.6 ? secondary : '#1c2440';
}

/** Color legible sobre el color del jugador. */
function contrast(hex: string): string {
  const c = new THREE.Color(hex);
  return c.r * 0.3 + c.g * 0.59 + c.b * 0.11 > 0.45 ? '#141414' : '#ffffff';
}

const numberMaterials = new Map<string, THREE.MeshToonMaterial>();
function numberMaterial(n: number, ink: string): THREE.MeshToonMaterial {
  const key = `${n}:${ink}`;
  let m = numberMaterials.get(key);
  if (!m) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = ink;
    g.font = 'bold 96px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), 64, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    m = toon('#fff', t);
    // Recorte por alfa en vez de transparencia: se dibuja como sólido (sin ordenar ni mezclar), mucho más barato.
    m.transparent = false;
    m.alphaTest = 0.5;
    numberMaterials.set(key, m);
  }
  return m;
}

const backMaterials = new Map<string, THREE.MeshToonMaterial>();
/** Espalda de la camisa: apellido arriba y número grande debajo, como en la liga. */
function backMaterial(name: string, n: number, ink: string): THREE.MeshToonMaterial {
  const key = `${name}:${n}:${ink}`;
  let m = backMaterials.get(key);
  if (!m) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 46;
    g.font = `bold ${size}px system-ui, sans-serif`;
    while (g.measureText(name).width > 236 && size > 20) g.font = `bold ${(size -= 2)}px system-ui, sans-serif`;
    g.fillText(name, 128, 42);
    g.font = 'bold 150px system-ui, sans-serif';
    g.fillText(String(n), 128, 165);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    m = toon('#fff', t);
    m.transparent = false;
    m.alphaTest = 0.5;
    backMaterials.set(key, m);
  }
  return m;
}

// ---------- geometrías compartidas (según el estilo; se reutilizan entre jugadores) ----------

interface Kit {
  head: THREE.BufferGeometry;
  torso: THREE.BufferGeometry;
  /** Escala del tronco (la cápsula se aplana; el de atleta ya tiene su forma). */
  torsoScale: [number, number, number];
  /** Profundidad del pecho y la espalda a la altura del número (z). */
  chestZ: number;
  backZ: number;
  /** Separación de los hombros (x). */
  shoulderX: number;
  /** Separación de las caderas (x): piernas juntas o separadas. */
  hipX: number;
  pelvis: THREE.BufferGeometry;
  upperArm: THREE.BufferGeometry;
  forearm: THREE.BufferGeometry;
  hand: THREE.BufferGeometry;
  thigh: THREE.BufferGeometry;
  shin: THREE.BufferGeometry;
  foot: THREE.BufferGeometry;
  neck: THREE.BufferGeometry;
  sleeve: THREE.BufferGeometry;
  shoulderCap: THREE.BufferGeometry;
  shortsLeg: THREE.BufferGeometry;
  kneePad: THREE.BufferGeometry;
  armSleeveUpper: THREE.BufferGeometry;
  armSleeveLower: THREE.BufferGeometry;
  legSleeveUpper: THREE.BufferGeometry;
  legSleeveLower: THREE.BufferGeometry;
  hair: THREE.BufferGeometry;
  spike: THREE.BufferGeometry;
  tuft: THREE.BufferGeometry;
  eye: THREE.BufferGeometry;
  shine: THREE.BufferGeometry;
  mouth: THREE.BufferGeometry;
  brow: THREE.BufferGeometry;
  /** Solo en el cuerpo de bloques: media, suela y ribete de la manga. */
  sock: THREE.BufferGeometry | null;
  sole: THREE.BufferGeometry | null;
  trim: THREE.BufferGeometry | null;
  /** Bisagra del codo (cuerpo de bloques): rellena la unión cuando el brazo se dobla. */
  hinge: THREE.BufferGeometry | null;
  /** Puño (cuerpo de bloques): dedos doblados y pulgar sobre la palma. */
  fingers: THREE.BufferGeometry | null;
  tip: THREE.BufferGeometry | null;
  thumb: THREE.BufferGeometry | null;
  /** Brazo y pierna de una sola pieza (cuerpo de bloques). */
  arm: THREE.BufferGeometry | null;
  leg: THREE.BufferGeometry | null;
  /** Pelo de la cabeza cúbica: tapa arriba y nuca (en vez del casquete redondo). */
  hairCap: THREE.BufferGeometry | null;
  hairBack: THREE.BufferGeometry | null;
}

const kits = new Map<string, Kit>();

/**
 * Tronco de atleta: perfil girado (más ancho en los hombros, cintura fina, pecho redondeado arriba y abajo).
 * Devuelve la geometría y el radio a la altura del número.
 */
function athleteTorso(shoulders: number, waist: number, segments: number): { geometry: THREE.BufferGeometry; chestR: number } {
  const s = 0.155 * shoulders;
  const w = 0.155 * waist;
  const profile: [number, number][] = [
    [0, -0.07], [w * 0.7, -0.06], [w * 0.95, -0.02], [w, 0.06], [w * 1.03, 0.16],
    [(w + s) / 2, 0.26], [s * 0.97, 0.36], [s, 0.44], [s * 0.93, 0.51], [s * 0.7, 0.57], [s * 0.35, 0.6], [0, 0.61],
  ];
  // Curva suave por el perfil (sin quiebres entre los puntos).
  const curve = new THREE.SplineCurve(profile.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getPoints(10 + segments * 3).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
  pts[0].x = 0;
  pts[pts.length - 1].x = 0;
  const geometry = new THREE.LatheGeometry(pts, segments);
  return { geometry, chestR: (s * 0.97 + (w + s) / 2) / 2 };
}

function kitFor(st: CharStyle): Kit {
  const d = Math.max(1, Math.min(4, Math.round(st.detail)));
  const D = dimsFor(st);
  const key = [st.body, d, st.torso, st.shoulders, st.waist, st.limbs, st.legs, st.legGap].join('|');
  let kit = kits.get(key);
  if (kit) return kit;
  const cap = 2 + (d - 1) * 2;
  const rad = 8 + (d - 1) * 4;
  const limb = (r: number, len: number) => new THREE.CapsuleGeometry(r * st.limbs, len, cap, rad);
  const ball = (r: number, w: number, h: number) => new THREE.SphereGeometry(r, w + (d - 1) * Math.ceil(w * 0.6), h + (d - 1) * Math.ceil(h * 0.6));
  const cyl = (top: number, bottom: number, h: number, open = false) => new THREE.CylinderGeometry(top, bottom, h, 8 + (d - 1) * 4, 1, open);
  const athlete = st.torso === 'atleta';
  const torso = athlete ? athleteTorso(st.shoulders, st.waist, 10 + (d - 1) * 6) : null;
  // Atleta: el pecho se aplana un poco (más ancho que profundo); la cápsula, como antes.
  const torsoScale: [number, number, number] = athlete ? [1.08, 1, 0.74] : [1.1, 1, 0.85];
  const chestR = torso ? torso.chestR * torsoScale[2] : 0.14 * 0.85;
  kit = {
    head: ball(0.145, 14, 10),
    torso: torso ? torso.geometry : limb(0.14 / st.limbs, 0.4),
    torsoScale,
    chestZ: chestR - (athlete ? 0.002 : 0.016),
    backZ: -chestR + (athlete ? 0.002 : 0.015),
    shoulderX: 0.2 * (athlete ? st.shoulders : 1),
    hipX: 0.1,
    pelvis: ball(0.13, 8, 6),
    upperArm: limb(0.058, D.upperArm - 0.06),
    forearm: limb(0.055, D.forearm - 0.02),
    hand: ball(0.048 * st.limbs, 8, 6),
    thigh: limb(0.078, D.thigh - 0.06),
    shin: limb(0.07, D.shin - 0.04),
    foot: limb(0.06, 0.12),
    neck: cyl(0.048, 0.055, 0.12, true),
    sleeve: limb(0.075, 0.13),
    shoulderCap: ball(0.085 * st.limbs, 8, 6),
    shortsLeg: cyl(0.104 * st.limbs, 0.095 * st.limbs, 0.22),
    kneePad: cyl(0.094 * st.limbs, 0.088 * st.limbs, 0.14),
    armSleeveUpper: limb(0.064, D.upperArm - 0.12),
    armSleeveLower: limb(0.061, D.forearm - 0.12),
    legSleeveUpper: limb(0.085, D.thigh - 0.3),
    legSleeveLower: limb(0.077, D.shin - 0.16),
    hair: new THREE.SphereGeometry(0.153, 14 + (d - 1) * 8, 6 + (d - 1) * 3, 0, Math.PI * 2, 0, Math.PI * 0.45),
    spike: new THREE.ConeGeometry(0.05, 0.14, 5 + d),
    tuft: ball(0.06, 8, 6),
    eye: ball(0.021, 6, 4),
    shine: ball(0.0075, 5, 3),
    mouth: new THREE.CapsuleGeometry(0.008, 0.04, 1, 4),
    brow: new THREE.CapsuleGeometry(0.0055, 0.035, 1, 3),
    sock: null,
    sole: null,
    trim: null,
    hairCap: null,
    hairBack: null,
    hinge: null,
    fingers: null,
    tip: null,
    thumb: null,
    arm: null,
    leg: null,
  };
  if (st.body === 'bloque') Object.assign(kit, blockKit(st, d, D));
  // El Probador crea una variante por cada valor del deslizador: se guardan solo las últimas.
  if (kits.size >= 6) kits.delete(kits.keys().next().value!);
  kits.set(key, kit);
  return kit;
}

/**
 * Caja de esquinas redondeadas barata: una esfera deformada en "supercuadro" (|x|^e). Con `r` chico respecto de la
 * caja queda casi cuadrada; con `r` grande, casi una esfera. Unos 400 vértices (una caja redondeada de three.js con
 * la misma suavidad usa más de mil). Normales exactas de la forma, sin costuras.
 */
function roundedBar(w: number, len: number, depth: number, r: number, d: number, taper = 1, capR?: number): THREE.BufferGeometry {
  // Cápsula con la sección redondeada-cuadrada: lados rectos a lo largo y solo las puntas redondas. Brazos y piernas de
  // bloque (antes eran supercuadros enteros: gordos al medio y finos en las puntas, como salchichas). Lleva anillos
  // cada 3 cm a lo largo: el brazo entero es una sola pieza que se dobla en el codo. `taper`: ancho abajo / arriba.
  const rr = Math.min(w, depth) / 2;
  // Puntas: semiesferas (o aplanadas con `capR` chico: un anillo de bordes planos, como el ribete de la manga).
  const cr = Math.min(capR ?? rr, len / 2);
  const straight = Math.max(0.001, len - 2 * cr);
  const profile: THREE.Vector2[] = [];
  const capN = 3 + d;
  for (let k = 0; k <= capN; k++) {
    const a = -Math.PI / 2 + (k / capN) * (Math.PI / 2);
    profile.push(new THREE.Vector2(rr * Math.cos(a), -straight / 2 + cr * Math.sin(a)));
  }
  const rings = Math.max(1, Math.ceil(straight / 0.03));
  for (let k = 1; k < rings; k++) profile.push(new THREE.Vector2(rr, -straight / 2 + (k / rings) * straight));
  for (let k = 0; k <= capN; k++) {
    const a = (k / capN) * (Math.PI / 2);
    profile.push(new THREE.Vector2(rr * Math.cos(a), straight / 2 + cr * Math.sin(a)));
  }
  profile[0].x = 0;
  profile[profile.length - 1].x = 0;
  const g = new THREE.LatheGeometry(profile, 10 + d * 4);
  const e = THREE.MathUtils.clamp((2 * r) / Math.min(w, depth), 0.12, 1);
  const sx = w / 2 / rr;
  const sz = depth / 2 / rr;
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const rho = Math.hypot(x, z);
    if (rho < 1e-6) continue;
    const ux = x / rho;
    const uz = z / rho;
    const px = Math.sign(ux) * Math.abs(ux) ** e;
    const pz = Math.sign(uz) * Math.abs(uz) ** e;
    pos.setX(i, px * rho * sx);
    pos.setZ(i, pz * rho * sz);
    // Normal: la de la sección cuadrada-redondeada, con la misma inclinación vertical que la de la cápsula.
    const nx = nrm.getX(i);
    const ny = nrm.getY(i);
    const nz = nrm.getZ(i);
    const flat = Math.hypot(nx, nz);
    let gx = (Math.sign(ux) * Math.abs(ux) ** (2 - e)) / sx;
    let gz = (Math.sign(uz) * Math.abs(uz) ** (2 - e)) / sz;
    const gl = Math.hypot(gx, gz) || 1;
    gx = (gx / gl) * flat;
    gz = (gz / gl) * flat;
    const len3 = Math.hypot(gx, ny, gz) || 1;
    nrm.setXYZ(i, gx / len3, ny / len3, gz / len3);
  }
  if (taper !== 1) {
    for (let i = 0; i < pos.count; i++) {
      const k = 1 + (taper - 1) * (0.5 - pos.getY(i) / len);
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
    }
  }
  return g;
}

function roundedBlock(w: number, h: number, depth: number, r: number, d: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 10 + d * 4, 8 + d * 3);
  const half = [w / 2, h / 2, depth / 2];
  const e = THREE.MathUtils.clamp((2 * r) / Math.min(w, h, depth), 0.12, 1);
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const p = [0, 0, 0];
  const n = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    const v = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    for (let k = 0; k < 3; k++) {
      const s = Math.sign(v[k]);
      const m = Math.abs(v[k]) ** e;
      p[k] = s * m * half[k];
      // Gradiente de la superficie |x/a|^(2/e) + …: la normal de la forma (suave en todas las esquinas).
      n[k] = (s * m ** (2 / e - 1)) / half[k];
    }
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    pos.setXYZ(i, p[0], p[1], p[2]);
    nrm.setXYZ(i, n[0] / len, n[1] / len, n[2] / len);
  }
  return g;
}

/** Cadera de cada pierna (x): media pierna más la mitad del espacio entre las dos. */
const hipX = (st: CharStyle): number => 0.075 * st.limbs + st.legGap / 2;

/**
 * Cuerpo de bloques redondeados (como el dibujo del 10): cabeza cúbica, tronco y pantaloneta de caja, brazos y
 * piernas cuadrados, puños, rodilleras, medias y zapatillas gruesas con suela. Mismas articulaciones y medidas que el
 * cuerpo redondo: las animaciones y los pies sobre el piso no cambian.
 */
function blockKit(st: CharStyle, d: number, D: Dims): Partial<Kit> {
  const lift = torsoLift(D);
  const box = (w: number, h: number, depth: number, r: number) => roundedBlock(w, h, depth, r, d);
  const bar = (w: number, len: number, depth: number, r: number, taper = 1, capR?: number) => roundedBar(w, len, depth, r, d, taper, capR);
  const t = st.limbs;
  const s = st.shoulders;
  return {
    head: box(0.3, 0.29, 0.28, 0.075),
    // Tronco de camiseta: más ancho en los hombros que en la cintura y con hombros casi rectos (las mangas cuelgan de
    // sus esquinas, como en la camiseta del 10).
    torso: bar(0.4 * s, 0.66 + lift, 0.25, 0.09, 0.86, 0.07),
    chestZ: 0.125 * 0.97,
    backZ: -0.125 * 0.97,
    // El brazo cuelga separado del tronco y de la pierna (como en el dibujo): borde del tronco + medio brazo + aire.
    shoulderX: 0.18 * s + 0.06 * t + 0.03,
    hipX: hipX(st),
    pelvis: box(Math.max(0.33, 2 * hipX(st) + 0.17 * t), 0.2, 0.25, 0.06),
    // Brazo y antebrazo del mismo grosor y más largos que el hueso: se meten uno en el otro en el codo (y el antebrazo en
    // el puño), así el brazo estirado parece un solo cilindro. La bisagra rellena el codo cuando se dobla.
    // Brazo y pierna enteros, de una sola pieza (se doblan en el codo y la rodilla): sin uniones ni rayas.
    arm: bar(0.108 * t, D.upperArm + D.forearm + 0.06, 0.108 * t, 0.04, 1.12),
    leg: bar(0.15 * t, D.thigh + D.shin + 0.04, 0.15 * t, 0.05, 0.9),
    upperArm: bar(0.115 * t, D.upperArm + 0.1, 0.115 * t, 0.04),
    forearm: bar(0.112 * t, D.forearm + 0.08, 0.112 * t, 0.04),
    // Mano como mitón: palma alta que sigue al antebrazo, dedos doblados abajo hacia adentro (con la punta que sube) y el
    // pulgar arriba; entre la punta de los dedos y el pulgar queda la muesca del puño cerrado.
    // La mano sigue al antebrazo con el mismo ancho y termina redonda abajo (el borde de afuera baja y se curva hacia
    // adentro, como una J); los dedos doblados cruzan por abajo y su punta asoma del lado del cuerpo, con la muesca encima.
    hand: bar(0.114 * t, 0.27, 0.114 * t, 0.045, 1.07),
    fingers: box(0.095 * t, 0.058, 0.108 * t, 0.026),
    tip: box(0.046 * t, 0.062, 0.098 * t, 0.021),
    thumb: null,
    thigh: bar(0.155 * t, D.thigh + 0.08, 0.155 * t, 0.05),
    shin: bar(0.14 * t, D.shin + 0.06, 0.14 * t, 0.045),
    hinge: box(0.112 * t, 0.112 * t, 0.112 * t, 0.056 * t),
    // Zapatilla grande y apoyada: la suela toca el piso, la media sale de su boca.
    foot: box(0.17, 0.12, 0.3, 0.05),
    // Manga corta que se abre un poco hacia el borde (como la camiseta del 10), con el ribete pegado al borde.
    sleeve: bar(0.148 * t, 0.2, 0.148 * t, 0.05, 1.12),
    shoulderCap: box(0.16 * t, 0.16, 0.16 * t, 0.06),
    shortsLeg: box(0.19 * t, 0.24, 0.2 * t, 0.06),
    kneePad: box(0.18 * t, 0.16, 0.18 * t, 0.06),
    sock: bar(0.158 * t, 0.2, 0.158 * t, 0.05),
    sole: box(0.176, 0.032, 0.306, 0.014),
    trim: bar(0.168 * t, 0.034, 0.168 * t, 0.05, 1, 0.012),
    tuft: box(0.11, 0.09, 0.11, 0.04),
    hairCap: box(0.322, 0.1, 0.302, 0.045),
    hairBack: box(0.322, 0.2, 0.07, 0.035),
    eye: box(0.032, 0.05, 0.012, 0.012),
    brow: box(0.065, 0.016, 0.012, 0.007),
    mouth: box(0.032, 0.01, 0.008, 0.004),
  };
}

/** Peinado de cada jugador cuando el estilo es "variado" (siempre el mismo para el mismo jugador). */
function hairOf(look: Look, st: CharStyle): Exclude<HairStyle, 'variado'> {
  if (st.hair !== 'variado') return st.hair;
  let h = look.number * 7;
  for (const ch of look.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (['puntas', 'puntas', 'mechones', 'mechones', 'casquete', 'cola'] as const)[h % 6];
}

/** Matriz de una pieza en `at`, apuntando su eje y hacia `dir`, con escala uniforme `s`. */
function aimed(at: THREE.Vector3, dir: THREE.Vector3, s: number, stretch = 1): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return new THREE.Matrix4().compose(at, q, new THREE.Vector3(s, s * stretch, s));
}

/**
 * Volumen del pelo: agranda cada mechón, punta o cola en su lugar. Las primeras `base` piezas (casquete, o tapa y
 * nuca en la cabeza cúbica) quedan igual: siempre calzan en la cabeza.
 */
function bulk(parts: Part[], volume: number, base: number): Part[] {
  if (Math.abs(volume - 1) < 1e-3) return parts;
  const pos = new THREE.Vector3();
  return parts.map((p, i) => {
    if (i < base) return p;
    pos.setFromMatrixPosition(p.matrix);
    const m = new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z)
      .multiply(new THREE.Matrix4().makeScale(volume, volume, volume))
      .multiply(new THREE.Matrix4().makeTranslation(-pos.x, -pos.y, -pos.z))
      .multiply(p.matrix);
    return { ...p, matrix: m };
  });
}

/** Pelo: casquete y, según el peinado, puntas anime, mechones o cola. */
function hairParts(kit: Kit, style: Exclude<HairStyle, 'variado'>, color: string, c: THREE.Vector3, h: number): Part[] {
  if (kit.hairCap && kit.hairBack) return blockHair(kit, style, color, c, h);
  const parts: Part[] = [{ geometry: kit.hair, color, matrix: placed(c.x, c.y + 0.005 * h, c.z - 0.015 * h, [-0.42, 0, 0], [h, h, h]) }];
  const R = 0.145 * h;
  // Punto de la superficie de la cabeza: elevación (desde el ecuador) y azimut (0 = la frente, π = la nuca).
  const surface = (elev: number, az: number, out = 1) => {
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev));
    return { dir, at: c.clone().addScaledVector(dir, R * out) };
  };
  if (style === 'puntas') {
    const tips: [number, number][] = [[1.25, 0], [0.95, 0.9], [0.95, -0.9], [0.75, 2.0], [0.75, -2.0], [0.7, Math.PI], [1.05, 2.7], [1.05, -2.7], [0.45, 1.6], [0.45, -1.6]];
    for (const [e, a] of tips) {
      const { dir, at } = surface(e, a, 0.92);
      // Las puntas se inclinan hacia atrás y hacia arriba, como en el anime.
      const tilt = dir.clone().add(new THREE.Vector3(0, 0.55, -0.45)).normalize();
      parts.push({ geometry: kit.spike, color, matrix: aimed(at, tilt, h, 1.1) });
    }
    // Flequillo: tres puntas cortas que caen sobre la frente.
    for (const a of [-0.35, 0, 0.35]) {
      const { at } = surface(0.75, a, 0.95);
      parts.push({ geometry: kit.spike, color, matrix: aimed(at, new THREE.Vector3(Math.sin(a) * 0.3, -0.75, 0.6), h * 0.75, 0.9) });
    }
  } else if (style === 'mechones') {
    const tufts: [number, number, number][] = [[1.2, 0, 1], [0.85, 1.0, 0.95], [0.85, -1.0, 0.95], [0.75, 2.2, 1], [0.75, -2.2, 1], [0.55, Math.PI, 1], [1.0, Math.PI, 1.05]];
    for (const [e, a, k] of tufts) {
      const { at } = surface(e, a, 0.9);
      parts.push({ geometry: kit.tuft, color, matrix: placed(at.x, at.y, at.z, [0, 0, 0], [h * k, h * k * 0.85, h * k]) });
    }
    for (const a of [-0.45, 0, 0.45]) {
      const { at } = surface(0.82, a, 0.98);
      parts.push({ geometry: kit.tuft, color, matrix: placed(at.x, at.y - 0.01, at.z, [0.5, 0, 0], [h * 0.75, h * 0.5, h * 0.55]) });
    }
  } else if (style === 'cola') {
    const { at } = surface(0.75, Math.PI, 1);
    parts.push({ geometry: kit.tuft, color, matrix: placed(at.x, at.y, at.z - 0.01, [0, 0, 0], [h * 0.7, h * 0.7, h * 0.7]) });
    parts.push({ geometry: kit.spike, color, matrix: aimed(at.clone().add(new THREE.Vector3(0, -0.11 * h, -0.04 * h)), new THREE.Vector3(0, 1, 0.25), h * 1.1, 1.6) });
  }
  return parts;
}

/**
 * Pelo de la cabeza cúbica (como el dibujo del 10): tapa y nuca de bloques, y encima mechones sueltos y flequillo
 * (mechones), puntas, una cola o nada más (corto).
 */
function blockHair(kit: Kit, style: Exclude<HairStyle, 'variado'>, color: string, c: THREE.Vector3, h: number): Part[] {
  const at = (x: number, y: number, z: number) => [c.x + x * h, c.y + y * h, c.z + z * h] as const;
  const parts: Part[] = [];
  const add = (g: THREE.BufferGeometry, [x, y, z]: readonly [number, number, number], rot: [number, number, number] = [0, 0, 0], k = 1) =>
    parts.push({ geometry: g, color, matrix: placed(x, y, z, rot, [h * k, h * k, h * k]) });
  add(kit.hairCap!, at(0, 0.115, -0.005));
  add(kit.hairBack!, at(0, 0.02, -0.12));
  if (style === 'mechones') {
    // Mechones revueltos arriba (cada uno girado distinto) y un flequillo que cae sobre la frente.
    const top: [number, number, number, number][] = [[-0.09, 0.07, 0.4, 1], [0.07, 0.08, -0.5, 1.05], [0, -0.02, 0.2, 1.1], [-0.1, -0.09, -0.3, 1], [0.1, -0.07, 0.6, 1], [0.01, -0.12, -0.1, 0.95]];
    for (const [x, z, r, k] of top) add(kit.tuft, at(x, 0.175, z), [r * 0.4, r, r * 0.3], k);
    for (const [x, r] of [[-0.09, -0.25], [0, 0.1], [0.09, 0.3]] as const) add(kit.tuft, at(x, 0.1, 0.13), [0.7, r, 0], 0.8);
    for (const s of [-1, 1]) add(kit.tuft, at(s * 0.15, 0.06, -0.02), [0, 0, s * 0.3], 0.75);
  } else if (style === 'puntas') {
    const tips: [number, number, number, number][] = [[0, 0.04, -0.4, 0], [-0.08, -0.05, -0.6, 0.35], [0.08, -0.05, -0.6, -0.35], [0, -0.1, -0.9, 0], [-0.1, 0.06, -0.2, 0.45], [0.1, 0.06, -0.2, -0.45]];
    for (const [x, z, rx, rz] of tips) add(kit.spike, at(x, 0.21, z), [rx, 0, rz], 1.1);
  } else if (style === 'cola') {
    add(kit.tuft, at(0, 0.06, -0.17), [0, 0, 0], 0.7);
    parts.push({ geometry: kit.spike, color, matrix: aimed(new THREE.Vector3(...at(0, -0.06, -0.2)), new THREE.Vector3(0, 1, 0.25), h * 1.1, 1.6) });
  }
  return parts;
}

/** Número del pecho (en el plano frontal del tronco) y espalda con nombre y número. */
const CHEST_NUMBER = new THREE.PlaneGeometry(0.17, 0.17);
const BACK_PRINT = new THREE.PlaneGeometry(0.27, 0.27);
const FACE_INK = '#24160f';
const SHOE = '#f4f4f4';
const PAD = '#22252b';
const SOCK = '#f2f2f2';

/** Piezas de cada articulación del personaje que se está armando (se unen al final en una sola malla). */
let pending: { bone: THREE.Bone; parts: Part[]; blend?: { bone: THREE.Bone; at: number } }[] = [];

function joint(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Bone {
  const j = new THREE.Bone();
  j.position.set(x, y, z);
  parent.add(j);
  return j;
}

/** Piezas que se mueven con una articulación (color por vértice). */
function attach(parent: THREE.Bone, parts: Part[]): void {
  pending.push({ bone: parent, parts });
}

/**
 * Pieza continua entre dos articulaciones (brazo de hombro a muñeca): arriba de `at` (y local del primer hueso) la
 * mueve el primero, abajo el segundo, y en una franja alrededor del codo se reparte suave entre los dos.
 */
function attachBlend(parent: THREE.Bone, parts: Part[], next: THREE.Bone, at: number): void {
  pending.push({ bone: parent, parts, blend: { bone: next, at } });
}

/** Ancho (m) de la franja del codo o la rodilla donde el peso pasa de un hueso al otro. */
const BLEND_BAND = 0.07;

/**
 * Todo el cuerpo en una sola malla con esqueleto (cada articulación es un hueso) y su contorno: 2 llamadas de dibujo
 * por personaje en vez de ~24. Muchas menos llamadas = sin tirones, también en el teléfono.
 */
function skinCharacter(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const bones = [...new Set(pending.flatMap((p) => (p.blend ? [p.bone, p.blend.bone] : [p.bone])))];
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  // El contorno se arma sin los detalles internos (dedos, pulgar): si no, su contorno raya la mano por dentro.
  const piecesFor = (forOutline: boolean) => pending.flatMap((p) => {
    const parts = forOutline ? p.parts.filter((q) => q.outline !== false) : p.parts;
    if (!parts.length) return [];
    const geometry = mergeParts(parts);
    let weights: Float32Array | undefined;
    if (p.blend) {
      const pos = geometry.attributes.position;
      weights = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        const t = THREE.MathUtils.clamp((p.blend.at + BLEND_BAND / 2 - pos.getY(i)) / BLEND_BAND, 0, 1);
        weights[i] = t * t * (3 - 2 * t);
      }
    }
    geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, p.bone.matrixWorld));
    return [{ geometry, bone: bones.indexOf(p.bone), ...(p.blend ? { bone2: bones.indexOf(p.blend.bone), weights } : {}) }];
  });
  const meshPieces = piecesFor(false);
  const outlinePieces = piecesFor(true);
  pending = [];
  const geometry = mergeSkinned(meshPieces);
  const outlineGeometry = mergeSkinned(outlinePieces);
  for (const p of [...meshPieces, ...outlinePieces]) p.geometry.dispose();
  const skeleton = new THREE.Skeleton(bones);
  const mesh = new THREE.SkinnedMesh(geometry, toonVertexColors());
  const outline = new THREE.SkinnedMesh(outlineGeometry, OUTLINE_SKINNED);
  root.add(mesh, outline);
  root.updateMatrixWorld(true);
  mesh.bind(skeleton);
  outline.bind(skeleton, mesh.bindMatrix);
  // Los huesos mueven la malla (saltos, planchas): una esfera holgada alrededor del cuerpo en vez de la de la pose
  // inicial. Así los que quedan fuera de cámara (banca, el otro campo al apuntar) no se dibujan.
  const bounds = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2.4);
  mesh.boundingSphere = bounds;
  outline.boundingSphere = bounds;
}

/**
 * Jugador estilizado: piel, camisa de manga corta con número y apellido, pantaloneta, rodilleras, zapatos,
 * pelo y una cara sencilla. La forma (cuerpo, cabeza, ojos, peinado) sale del estilo del Probador.
 */
export function buildCharacter(look: Look, st: CharStyle = charStyle()): Rig {
  applyCharShading(st);
  const kit = kitFor(st);
  const D = dimsFor(st);
  const lift = st.body === 'bloque' ? torsoLift(D) : 0;
  const { shirt, shorts, skin } = look;
  const shoe = st.shoes;
  const trim = contrast(shirt) === '#ffffff' ? '#e9ecf2' : '#2a2e36';
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hips = joint(body, 0, D.thigh + D.shin + D.foot, 0);
  const athlete = st.torso === 'atleta';
  attach(hips, [{ geometry: kit.pelvis, color: shorts, matrix: st.body === 'bloque' ? placed(0, 0.03, 0) : placed(0, 0.02, 0, [0, 0, 0], athlete ? [1.15 * st.waist + 0.15, 0.85, 0.85] : [1.2, 0.85, 0.9]) }]);

  const spine = joint(hips, 0, 0.06, 0);
  const block = st.body === 'bloque';
  if (block) attach(spine, [{ geometry: kit.torso, color: shirt, matrix: placed(0, 0.26 + lift / 2, 0) }]);
  else attach(spine, [{ geometry: kit.torso, color: shirt, matrix: placed(0, athlete ? -0.01 : 0.26, 0, [0, 0, 0], kit.torsoScale) }]);
  const ink = contrast(shirt);
  // Árbitros, jueces y entrenadores (número 0) no llevan número ni nombre.
  if (look.number > 0) {
    const number = new THREE.Mesh(CHEST_NUMBER, numberMaterial(look.number, ink));
    number.position.set(0, 0.32 + lift * 0.8, kit.chestZ + 0.01);
    const back = new THREE.Mesh(BACK_PRINT, backMaterial(look.name, look.number, ink));
    back.position.set(0, 0.33 + lift * 0.8, kit.backZ - 0.011);
    back.rotation.y = Math.PI;
    spine.add(number, back);
  }

  // Cabeza con cuello, pelo y cara (ojos, cejas y boca) mirando hacia +z. La cara crece con la cabeza.
  const neck = joint(spine, 0, 0.56 + lift, 0);
  const h = st.head;
  const e = st.eyes;
  const c = new THREE.Vector3(0, 0.16 + (h - 1) * 0.12, 0.01);
  const face = (x: number, y: number, z: number) => [c.x + x * h, c.y + y * h, c.z + z * h] as const;
  const eyeAt = (side: 1 | -1) => face(side * 0.05, 0.02 + (e - 1) * 0.005, 0.128);
  const head: Part[] = [
    { geometry: kit.neck, color: skin, matrix: placed(0, -0.02, 0) },
    { geometry: kit.head, color: skin, matrix: placed(c.x, c.y, c.z, [0, 0, 0], [h, h * 1.04, h]) },
  ];
  for (const side of [1, -1] as const) {
    const [x, y, z] = eyeAt(side);
    head.push({ geometry: kit.eye, color: FACE_INK, matrix: placed(x, y, z + (block ? 0.012 : 0), [0, 0, 0], block ? [h * e, h * e, h] : [h * e, h * 1.25 * e * (st.eyeShine ? 1.15 : 1), 0.6 * h]) });
    // Brillo anime: un punto blanco arriba y hacia afuera del ojo.
    if (st.eyeShine) head.push({ geometry: kit.shine, color: '#ffffff', matrix: placed(x + side * 0.006 * h * e, y + 0.009 * h * e, z + 0.011 * h, [0, 0, 0], [h * e, h * e, 0.6 * h]) });
    const [bx, by, bz] = face(side * 0.05, 0.068 + (e - 1) * 0.02, 0.118);
    // Bloque: cejas gruesas y serias (bajan hacia adentro), como en el dibujo.
    // Cejas: positivo baja hacia adentro (serio), negativo sube hacia adentro (alegre o preocupado).
    if (block) head.push({ geometry: kit.brow, color: FACE_INK, matrix: placed(bx, by - 0.008 * h, bz + 0.018, [0, 0, side * st.brows], [h, h, h]) });
    else head.push({ geometry: kit.brow, color: FACE_INK, matrix: placed(bx, by, bz, [0, 0, Math.PI / 2 + side * st.brows], [h, h, h]) });
  }
  const [mx, my, mz] = face(0, -0.06, 0.13);
  if (st.body === 'bloque') head.push({ geometry: kit.mouth, color: '#5a2420', matrix: placed(mx, my - 0.005, mz + 0.012, [0, 0, 0], [h, h, h]) });
  else head.push({ geometry: kit.mouth, color: '#5a2420', matrix: placed(mx, my, mz, [0, 0, Math.PI / 2], [h, h, 0.6 * h]) });
  if (look.hair) head.push(...bulk(hairParts(kit, hairOf(look, st), look.hair, c, h), st.hairVolume, kit.hairBack ? 2 : 1));
  attach(neck, head);

  const arm = (side: 1 | -1) => {
    const sleeve = side === 1 ? look.armSleeve.L : look.armSleeve.R;
    const shoulder = joint(spine, side * kit.shoulderX, 0.46 + lift, 0);
    const upper: Part[] = [
      ...(kit.arm ? [] : [{ geometry: kit.upperArm, color: skin, matrix: placed(0, -D.upperArm / 2, 0) }]),
      { geometry: kit.sleeve, color: shirt, matrix: block ? placed(-side * 0.025, -0.075, 0, [0, 0, -side * 0.12]) : placed(0, -0.06, 0) },
      // Bloques: sin hombrera (era una bola sobre el hombro); la manga entra en el tronco y el hombro baja suave.
      ...(block ? [] : [{ geometry: kit.shoulderCap, color: shirt, matrix: placed(0, 0, 0) }]),
    ];
    // Ribete claro en el borde de la manga (como las camisetas del dibujo).
    if (kit.trim) upper.push({ geometry: kit.trim, color: trim, matrix: placed(0, -0.158, 0) });
    if (sleeve && !kit.arm) upper.push({ geometry: kit.armSleeveUpper, color: look.sleeve, matrix: placed(0, -D.upperArm / 2 - 0.03, 0) });
    attach(shoulder, upper);
    const elbow = joint(shoulder, 0, -D.upperArm, 0);
    // Brazo entero (bloques): de dentro del hombro hasta dentro de la palma, una sola pieza que se dobla en el codo.
    // La manga de compresión (si tiene) es el mismo brazo pintado de la manga hasta la muñeca: sin tramos ni bordes.
    if (kit.arm) attachBlend(shoulder, [{ geometry: kit.arm, color: skin, matrix: placed(0, -(D.upperArm + D.forearm) / 2 + 0.005, 0), band: sleeve ? { from: -0.12, to: -(D.upperArm + D.forearm) + 0.015, color: look.sleeve } : undefined }], elbow, -D.upperArm);
    const lower: Part[] = kit.arm ? [] : [{ geometry: kit.forearm, color: skin, matrix: placed(0, -D.forearm / 2, 0) }];
    // La manga llega a la muñeca: la mano queda descubierta.
    if (sleeve && !kit.arm) lower.push({ geometry: kit.armSleeveLower, color: look.sleeve, matrix: placed(0, -(D.forearm - 0.1) / 2, 0) });
    if (st.hands && block && kit.fingers && kit.tip) {
      // Mitón: la palma (mira hacia el cuerpo) sale de la muñeca; abajo los dedos doblados hacia adentro y su punta que
      // sube; arriba de la muesca, el pulgar. Dedos y pulgar sin contorno: el pliegue se ve por la sombra, sin rayas.
      const f = st.fist;
      const inner = -side;
      const w = -D.forearm;
      const at = (x: number, y: number, z: number) => [inner * x * f, w + y * f, z * f] as const;
      const part = (geometry: THREE.BufferGeometry, [x, y, z]: readonly [number, number, number], rot: [number, number, number], outline = true): Part =>
        ({ geometry, color: skin, matrix: placed(x, y, z, rot, [f, f, f]), outline });
      // Toda la mano sin contorno: así no queda una raya donde la palma sale del antebrazo.
      lower.push(
        part(kit.hand, at(0, -0.02, 0.002), [0, 0, 0], false),
        part(kit.fingers, at(0.038, -0.125, 0.004), [0, 0, inner * 0.4], false),
        part(kit.tip, at(0.084, -0.104, 0.004), [0, 0, inner * -0.2], false),
      );
    } else if (st.hands) lower.push({ geometry: kit.hand, color: skin, matrix: block ? placed(0, -D.forearm - 0.045, 0.005) : placed(0, -D.forearm - 0.035, 0.005, [0, 0, 0], [0.85, 1.3, 0.62]) });
    attach(elbow, lower);
    return { shoulder, elbow };
  };
  const L = arm(1);
  const R = arm(-1);

  const leg = (side: 1 | -1) => {
    const sleeve = side === 1 ? look.legSleeve.L : look.legSleeve.R;
    const hip = joint(hips, side * kit.hipX, -0.02, 0);
    const upper: Part[] = [
      ...(kit.leg ? [] : [{ geometry: kit.thigh, color: skin, matrix: placed(0, -D.thigh / 2, 0) }]),
      { geometry: kit.shortsLeg, color: shorts, matrix: placed(0, -0.09, 0) },
    ];
    if (sleeve && !kit.leg) upper.push({ geometry: kit.legSleeveUpper, color: look.sleeve, matrix: placed(0, -D.thigh + 0.13, 0) });
    attach(hip, upper);
    const knee = joint(hip, 0, -D.thigh, 0);
    if (kit.leg) attachBlend(hip, [{ geometry: kit.leg, color: skin, matrix: placed(0, -(D.thigh + D.shin) / 2 + 0.01, 0), band: sleeve ? { from: -0.16, to: -(D.thigh + D.shin) + 0.2, color: look.sleeve } : undefined }], knee, -D.thigh);
    const lower: Part[] = kit.leg ? [] : [{ geometry: kit.shin, color: skin, matrix: placed(0, -D.shin / 2, 0) }];
    if (sleeve && !kit.leg) lower.push({ geometry: kit.legSleeveLower, color: look.sleeve, matrix: placed(0, -D.shin / 2 + 0.02, 0) });
    attach(knee, [
      ...lower,
      // La rodillera envuelve la rodilla (centrada un poco debajo de la articulación).
      { geometry: kit.kneePad, color: PAD, matrix: placed(0, -0.03, 0.006) },
      // Zapatilla: un poco más plana y larga que antes cuando el estilo es de atleta; de bloque, gruesa y con suela.
      block
        ? { geometry: kit.foot, color: SHOE, matrix: placed(0, -D.shin - D.foot + 0.06 * shoe, 0.05 + (shoe - 1) * 0.07, [0, 0, 0], [shoe, shoe, shoe]) }
        : { geometry: kit.foot, color: SHOE, matrix: placed(0, -D.shin - D.foot / 2 + 0.03 + (shoe - 1) * 0.03, 0.06 + (shoe - 1) * 0.07, [Math.PI / 2, 0, 0], (athlete ? [1.05, 1.08, 0.82] : [1, 1, 1]).map((v) => v * shoe) as [number, number, number]) },
      ...(kit.sole ? [{ geometry: kit.sole, color: PAD, matrix: placed(0, -D.shin - D.foot + 0.016, 0.05 + (shoe - 1) * 0.07, [0, 0, 0], [shoe, 1, shoe]) }] : []),
      // Media blanca entre la rodillera y la zapatilla.
      ...(kit.sock && st.socks ? [{ geometry: kit.sock, color: SOCK, matrix: placed(0, -D.shin + 0.1 + (shoe - 1) * 0.06, 0) }] : []),
    ]);
    return { hip, knee };
  };
  const LL = leg(1);
  const RL = leg(-1);

  skinCharacter(root);
  return {
    dims: D,
    root,
    body,
    hips,
    joints: {
      spine, neck,
      shoulderL: L.shoulder, elbowL: L.elbow, shoulderR: R.shoulder, elbowR: R.elbow,
      hipL: LL.hip, kneeL: LL.knee, hipR: RL.hip, kneeR: RL.knee,
    },
  };
}
