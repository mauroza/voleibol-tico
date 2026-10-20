import * as THREE from 'three';
import { mergeParts, placed, type Part } from './merge';
import type { JointName } from './pose';
import { OUTLINE, toon, toonVertexColors } from './toon';

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

export interface Rig {
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
    m.transparent = true;
    backMaterials.set(key, m);
  }
  return m;
}

// ---------- geometrías compartidas (redondeadas, sin detalles) ----------

const limb = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 3, 8);
const shared = {
  head: new THREE.SphereGeometry(0.145, 16, 12),
  torso: limb(0.14, 0.4),
  pelvis: new THREE.SphereGeometry(0.13, 10, 8),
  upperArm: limb(0.058, DIMS.upperArm - 0.06),
  forearm: limb(0.055, DIMS.forearm - 0.02),
  thigh: limb(0.078, DIMS.thigh - 0.06),
  shin: limb(0.07, DIMS.shin - 0.04),
  foot: limb(0.06, 0.12),
  neck: new THREE.CylinderGeometry(0.048, 0.055, 0.12, 10),
  /** Manga corta de la camisa y pierna de la pantaloneta. */
  sleeve: limb(0.075, 0.13),
  /** Hombro de la camisa: cubre la unión del brazo con el tronco en cualquier ángulo. */
  shoulderCap: new THREE.SphereGeometry(0.085, 12, 10),
  shortsLeg: new THREE.CylinderGeometry(0.104, 0.095, 0.22, 12),
  /** Rodillera: una banda acolchada que envuelve la rodilla. */
  kneePad: new THREE.CylinderGeometry(0.094, 0.088, 0.14, 14),
  /** Mangas de compresión (un poco más gruesas que la piel que cubren). */
  armSleeveUpper: limb(0.064, DIMS.upperArm - 0.12),
  armSleeveLower: limb(0.061, DIMS.forearm - 0.12),
  legSleeveUpper: limb(0.085, DIMS.thigh - 0.3),
  legSleeveLower: limb(0.077, DIMS.shin - 0.16),
  /** Pelo: casquete sobre la cabeza. */
  hair: new THREE.SphereGeometry(0.153, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45),
  eye: new THREE.SphereGeometry(0.021, 8, 6),
  mouth: new THREE.CapsuleGeometry(0.008, 0.04, 2, 6),
  brow: new THREE.CapsuleGeometry(0.0055, 0.035, 2, 4),
};

/** Número del pecho (en el plano frontal del tronco) y espalda con nombre y número. */
const CHEST_NUMBER = new THREE.PlaneGeometry(0.17, 0.17);
const BACK_PRINT = new THREE.PlaneGeometry(0.27, 0.27);
const FACE_INK = '#24160f';
const SHOE = '#f4f4f4';
const PAD = '#22252b';

function joint(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  const j = new THREE.Object3D();
  j.position.set(x, y, z);
  parent.add(j);
  return j;
}

/** Fusiona las piezas de una articulación en una malla toon (color por vértice) con contorno. */
function attach(parent: THREE.Object3D, parts: Part[]): void {
  const geometry = mergeParts(parts);
  const mesh = new THREE.Mesh(geometry, toonVertexColors());
  mesh.add(new THREE.Mesh(geometry, OUTLINE));
  parent.add(mesh);
}

/**
 * Jugador estilizado: piel, camisa de manga corta con número y apellido, pantaloneta, rodilleras, zapatos,
 * pelo y una cara sencilla. Una malla fusionada (color por vértice) por articulación: pocas llamadas de dibujo.
 */
export function buildCharacter(look: Look): Rig {
  const { shirt, shorts, skin } = look;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hips = joint(body, 0, DIMS.thigh + DIMS.shin + DIMS.foot, 0);
  attach(hips, [{ geometry: shared.pelvis, color: shorts, matrix: placed(0, 0.02, 0, [0, 0, 0], [1.2, 0.85, 0.9]) }]);

  const spine = joint(hips, 0, 0.06, 0);
  attach(spine, [{ geometry: shared.torso, color: shirt, matrix: placed(0, 0.26, 0, [0, 0, 0], [1.1, 1, 0.85]) }]);
  const ink = contrast(shirt);
  const number = new THREE.Mesh(CHEST_NUMBER, numberMaterial(look.number, ink));
  number.position.set(0, 0.32, 0.124);
  const back = new THREE.Mesh(BACK_PRINT, backMaterial(look.name, look.number, ink));
  back.position.set(0, 0.33, -0.125);
  back.rotation.y = Math.PI;
  spine.add(number, back);

  // Cabeza con cuello, pelo y cara (ojos, cejas y boca) mirando hacia +z.
  const neck = joint(spine, 0, 0.56, 0);
  const head: Part[] = [
    { geometry: shared.neck, color: skin, matrix: placed(0, -0.02, 0) },
    { geometry: shared.head, color: skin, matrix: placed(0, 0.16, 0.01) },
    { geometry: shared.eye, color: FACE_INK, matrix: placed(0.05, 0.18, 0.138, [0, 0, 0], [1, 1.25, 0.6]) },
    { geometry: shared.eye, color: FACE_INK, matrix: placed(-0.05, 0.18, 0.138, [0, 0, 0], [1, 1.25, 0.6]) },
    { geometry: shared.brow, color: FACE_INK, matrix: placed(0.05, 0.228, 0.128, [0, 0, Math.PI / 2 - 0.12]) },
    { geometry: shared.brow, color: FACE_INK, matrix: placed(-0.05, 0.228, 0.128, [0, 0, Math.PI / 2 + 0.12]) },
    { geometry: shared.mouth, color: '#5a2420', matrix: placed(0, 0.1, 0.14, [0, 0, Math.PI / 2], [1, 1, 0.6]) },
  ];
  if (look.hair) head.push({ geometry: shared.hair, color: look.hair, matrix: placed(0, 0.165, -0.005, [-0.42, 0, 0]) });
  attach(neck, head);

  const arm = (side: 1 | -1) => {
    const sleeve = side === 1 ? look.armSleeve.L : look.armSleeve.R;
    const shoulder = joint(spine, side * 0.2, 0.46, 0);
    const upper: Part[] = [
      { geometry: shared.upperArm, color: skin, matrix: placed(0, -DIMS.upperArm / 2, 0) },
      { geometry: shared.sleeve, color: shirt, matrix: placed(0, -0.06, 0) },
      { geometry: shared.shoulderCap, color: shirt, matrix: placed(0, 0, 0) },
    ];
    if (sleeve) upper.push({ geometry: shared.armSleeveUpper, color: look.sleeve, matrix: placed(0, -DIMS.upperArm / 2 - 0.03, 0) });
    attach(shoulder, upper);
    const elbow = joint(shoulder, 0, -DIMS.upperArm, 0);
    const lower: Part[] = [{ geometry: shared.forearm, color: skin, matrix: placed(0, -DIMS.forearm / 2, 0) }];
    // La manga llega a la muñeca: la mano queda descubierta.
    if (sleeve) lower.push({ geometry: shared.armSleeveLower, color: look.sleeve, matrix: placed(0, -(DIMS.forearm - 0.1) / 2, 0) });
    attach(elbow, lower);
    return { shoulder, elbow };
  };
  const L = arm(1);
  const R = arm(-1);

  const leg = (side: 1 | -1) => {
    const sleeve = side === 1 ? look.legSleeve.L : look.legSleeve.R;
    const hip = joint(hips, side * 0.1, -0.02, 0);
    const upper: Part[] = [
      { geometry: shared.thigh, color: skin, matrix: placed(0, -DIMS.thigh / 2, 0) },
      { geometry: shared.shortsLeg, color: shorts, matrix: placed(0, -0.09, 0) },
    ];
    if (sleeve) upper.push({ geometry: shared.legSleeveUpper, color: look.sleeve, matrix: placed(0, -DIMS.thigh + 0.13, 0) });
    attach(hip, upper);
    const knee = joint(hip, 0, -DIMS.thigh, 0);
    const lower: Part[] = [{ geometry: shared.shin, color: skin, matrix: placed(0, -DIMS.shin / 2, 0) }];
    if (sleeve) lower.push({ geometry: shared.legSleeveLower, color: look.sleeve, matrix: placed(0, -DIMS.shin / 2 + 0.02, 0) });
    attach(knee, [
      ...lower,
      // La rodillera envuelve la rodilla (centrada un poco debajo de la articulación).
      { geometry: shared.kneePad, color: PAD, matrix: placed(0, -0.03, 0.006) },
      { geometry: shared.foot, color: SHOE, matrix: placed(0, -DIMS.shin - DIMS.foot / 2 + 0.03, 0.06, [Math.PI / 2, 0, 0]) },
    ]);
    return { hip, knee };
  };
  const LL = leg(1);
  const RL = leg(-1);

  return {
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
