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

/** Figura tipo pictograma: un solo color por jugador y su número en el pecho. */
export interface Look {
  color: string;
  number: number;
}

export interface Rig {
  root: THREE.Group;
  /** Hijo de root: se desplaza en y para los saltos. */
  body: THREE.Group;
  hips: THREE.Object3D;
  joints: Record<JointName, THREE.Object3D>;
}

/** Color del equipo; el líbero usa el color secundario para distinguirse. */
export function lookFor(number: number, primary: string, secondary: string, libero: boolean): Look {
  return { color: libero ? secondary : primary, number };
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
};

/** Número del pecho (en el plano frontal del tronco). */
const CHEST_NUMBER = new THREE.PlaneGeometry(0.17, 0.17);

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
 * Figura humana tipo pictograma: cabeza separada del tronco, extremidades redondeadas, todo de un color.
 * Una malla fusionada por articulación (unas 22 llamadas de dibujo por jugador).
 */
export function buildCharacter(look: Look): Rig {
  const c = look.color;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hips = joint(body, 0, DIMS.thigh + DIMS.shin + DIMS.foot, 0);
  attach(hips, [{ geometry: shared.pelvis, color: c, matrix: placed(0, 0.02, 0, [0, 0, 0], [1.15, 0.8, 0.85]) }]);

  const spine = joint(hips, 0, 0.06, 0);
  attach(spine, [{ geometry: shared.torso, color: c, matrix: placed(0, 0.26, 0, [0, 0, 0], [1.1, 1, 0.85]) }]);
  const number = new THREE.Mesh(CHEST_NUMBER, numberMaterial(look.number, contrast(c)));
  number.position.set(0, 0.32, 0.124);
  spine.add(number);

  // La cabeza queda separada del tronco, como en un pictograma.
  const neck = joint(spine, 0, 0.56, 0);
  attach(neck, [{ geometry: shared.head, color: c, matrix: placed(0, 0.16, 0.01) }]);

  const arm = (side: 1 | -1) => {
    const shoulder = joint(spine, side * 0.2, 0.46, 0);
    attach(shoulder, [{ geometry: shared.upperArm, color: c, matrix: placed(0, -DIMS.upperArm / 2, 0) }]);
    const elbow = joint(shoulder, 0, -DIMS.upperArm, 0);
    attach(elbow, [{ geometry: shared.forearm, color: c, matrix: placed(0, -DIMS.forearm / 2, 0) }]);
    return { shoulder, elbow };
  };
  const L = arm(1);
  const R = arm(-1);

  const leg = (side: 1 | -1) => {
    const hip = joint(hips, side * 0.1, -0.02, 0);
    attach(hip, [{ geometry: shared.thigh, color: c, matrix: placed(0, -DIMS.thigh / 2, 0) }]);
    const knee = joint(hip, 0, -DIMS.thigh, 0);
    attach(knee, [
      { geometry: shared.shin, color: c, matrix: placed(0, -DIMS.shin / 2, 0) },
      { geometry: shared.foot, color: c, matrix: placed(0, -DIMS.shin - DIMS.foot / 2 + 0.02, 0.06, [Math.PI / 2, 0, 0]) },
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
