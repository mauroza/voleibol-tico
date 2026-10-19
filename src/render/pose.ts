/**
 * Matemática pura de animación. Convenciones del rig (ver plan de fase 3):
 * el personaje mira a +z; brazos y piernas cuelgan hacia −y; x negativo en hombro/cadera = hacia adelante;
 * rodilla flexiona con x positivo; codo flexiona con x negativo; columna x positivo = inclinarse adelante.
 */

export type JointName =
  | 'spine' | 'neck'
  | 'shoulderL' | 'elbowL' | 'shoulderR' | 'elbowR'
  | 'hipL' | 'kneeL' | 'hipR' | 'kneeR';

export const JOINTS: readonly JointName[] = ['spine', 'neck', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'hipL', 'kneeL', 'hipR', 'kneeR'];

export type Euler3 = readonly [number, number, number];
export type Pose = Partial<Record<JointName, Euler3>>;

const ZERO: Euler3 = [0, 0, 0];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function blendPose(a: Pose, b: Pose, t: number): Pose {
  const out: Pose = {};
  for (const j of JOINTS) {
    const pa = a[j] ?? ZERO;
    const pb = b[j] ?? ZERO;
    if (!a[j] && !b[j]) continue;
    out[j] = [lerp(pa[0], pb[0], t), lerp(pa[1], pb[1], t), lerp(pa[2], pb[2], t)];
  }
  return out;
}

/** Suaviza la entrada a una pose: 0 → 1 con aceleración y frenado. */
export const ease = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/**
 * IK de dos huesos en el plano. Devuelve el ángulo del primer hueso respecto de la línea al objetivo (root)
 * y la flexión del segundo respecto del primero (bend). Fuera de alcance, el brazo queda estirado.
 */
export function twoBoneIK(l1: number, l2: number, distance: number): { root: number; bend: number } {
  const d = Math.min(l1 + l2 - 1e-6, Math.max(Math.abs(l1 - l2) + 1e-6, distance));
  const cosBend = (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2);
  const cosRoot = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  return {
    bend: Math.PI - Math.acos(Math.min(1, Math.max(-1, cosBend))),
    root: Math.acos(Math.min(1, Math.max(-1, cosRoot))),
  };
}

/** Altura de salto: parábola con ápice en `apexTime`; 0 fuera del tiempo de vuelo. */
export function jumpOffset(now: number, apexTime: number, airTime: number, peak: number): number {
  const x = (now - apexTime) / (airTime / 2);
  return Math.abs(x) >= 1 ? 0 : peak * (1 - x * x);
}

/** Altura de la cadera para que el pie toque el piso con esos ángulos de cadera y rodilla. */
export function hipHeight(thigh: number, shin: number, hip: number, knee: number): number {
  return thigh * Math.cos(hip) + shin * Math.cos(hip + knee);
}

/** Ciclo de carrera; `k` (0..1) escala la amplitud. */
export function runPose(phase: number, k: number): Pose {
  const s = Math.sin(phase);
  const legL = -0.75 * s * k;
  const legR = 0.75 * s * k;
  return {
    spine: [0.25 * k, 0, 0],
    hipL: [legL, 0, 0],
    kneeL: [Math.max(0, Math.sin(phase + Math.PI / 2)) * 1.1 * k + 0.15, 0, 0],
    hipR: [legR, 0, 0],
    kneeR: [Math.max(0, Math.sin(phase - Math.PI / 2)) * 1.1 * k + 0.15, 0, 0],
    shoulderL: [0.7 * s * k, 0, 0.12],
    elbowL: [-1.3 * k - 0.2, 0, 0],
    shoulderR: [-0.7 * s * k, 0, -0.12],
    elbowR: [-1.3 * k - 0.2, 0, 0],
  };
}

export type PoseName =
  | 'idle' | 'ready' | 'bump' | 'dive' | 'set' | 'spikeLoad' | 'spikeHit'
  | 'block' | 'serveToss' | 'serveHit' | 'celebrate' | 'sad';

export const POSES: Record<PoseName, Pose> = {
  idle: {
    shoulderL: [0, 0, 0.1], shoulderR: [0, 0, -0.1], elbowL: [-0.15, 0, 0], elbowR: [-0.15, 0, 0],
    hipL: [-0.05, 0, 0.03], hipR: [0.05, 0, -0.03], kneeL: [0.1, 0, 0], kneeR: [0.05, 0, 0],
  },
  ready: {
    spine: [0.3, 0, 0], neck: [-0.25, 0, 0],
    shoulderL: [-0.55, 0, 0.15], shoulderR: [-0.55, 0, -0.15], elbowL: [-0.7, 0, 0], elbowR: [-0.7, 0, 0],
    hipL: [-0.55, 0, 0.12], hipR: [-0.55, 0, -0.12], kneeL: [0.95, 0, 0], kneeR: [0.95, 0, 0],
  },
  bump: {
    spine: [0.4, 0, 0], neck: [-0.35, 0, 0],
    shoulderL: [-0.95, 0, -0.32], shoulderR: [-0.95, 0, 0.32], elbowL: [0, 0, 0], elbowR: [0, 0, 0],
    hipL: [-0.75, 0, 0.18], hipR: [-0.75, 0, -0.18], kneeL: [1.2, 0, 0], kneeR: [1.2, 0, 0],
  },
  dive: {
    spine: [0.75, 0, 0], neck: [-0.6, 0, 0],
    shoulderL: [-1.3, 0, -0.3], shoulderR: [-1.3, 0, 0.3], elbowL: [0, 0, 0], elbowR: [0, 0, 0],
    hipL: [-1.2, 0, 0.25], hipR: [-0.6, 0, -0.2], kneeL: [1.7, 0, 0], kneeR: [1.4, 0, 0],
  },
  set: {
    spine: [-0.1, 0, 0], neck: [-0.35, 0, 0],
    shoulderL: [-2.65, 0, 0.35], shoulderR: [-2.65, 0, -0.35], elbowL: [-1.15, 0, 0], elbowR: [-1.15, 0, 0],
    hipL: [-0.25, 0, 0.08], hipR: [-0.25, 0, -0.08], kneeL: [0.4, 0, 0], kneeR: [0.4, 0, 0],
  },
  spikeLoad: {
    spine: [-0.35, 0, 0], neck: [-0.3, 0, 0],
    shoulderL: [-2.5, 0, 0.2], elbowL: [-0.4, 0, 0],
    shoulderR: [-2.9, 0, -0.45], elbowR: [-1.9, 0, 0],
    hipL: [-0.6, 0, 0.1], hipR: [-0.3, 0, -0.1], kneeL: [1.2, 0, 0], kneeR: [1.4, 0, 0],
  },
  spikeHit: {
    spine: [0.45, 0, 0], neck: [-0.4, 0, 0],
    shoulderL: [-0.7, 0, 0.3], elbowL: [-1.0, 0, 0],
    shoulderR: [-2.4, 0, -0.15], elbowR: [-0.05, 0, 0],
    hipL: [-0.5, 0, 0.1], hipR: [-0.6, 0, -0.1], kneeL: [0.8, 0, 0], kneeR: [0.9, 0, 0],
  },
  block: {
    spine: [0.05, 0, 0], neck: [-0.15, 0, 0],
    shoulderL: [-3.0, 0, 0.12], shoulderR: [-3.0, 0, -0.12], elbowL: [-0.05, 0, 0], elbowR: [-0.05, 0, 0],
    hipL: [-0.15, 0, 0.05], hipR: [-0.15, 0, -0.05], kneeL: [0.25, 0, 0], kneeR: [0.25, 0, 0],
  },
  serveToss: {
    spine: [-0.15, 0, 0], neck: [-0.4, 0, 0],
    shoulderL: [-2.7, 0, 0.1], elbowL: [-0.1, 0, 0],
    shoulderR: [-2.5, 0, -0.5], elbowR: [-1.8, 0, 0],
    hipL: [-0.35, 0, 0.1], hipR: [0.15, 0, -0.08], kneeL: [0.35, 0, 0], kneeR: [0.25, 0, 0],
  },
  serveHit: {
    spine: [0.35, 0, 0], neck: [-0.3, 0, 0],
    shoulderL: [-0.5, 0, 0.3], elbowL: [-0.8, 0, 0],
    shoulderR: [-2.5, 0, -0.1], elbowR: [-0.05, 0, 0],
    hipL: [-0.45, 0, 0.1], hipR: [0.25, 0, -0.08], kneeL: [0.3, 0, 0], kneeR: [0.35, 0, 0],
  },
  celebrate: {
    spine: [-0.2, 0, 0], neck: [-0.4, 0, 0],
    shoulderL: [-2.7, 0, 0.55], shoulderR: [-2.7, 0, -0.55], elbowL: [-0.25, 0, 0], elbowR: [-0.25, 0, 0],
    hipL: [-0.1, 0, 0.12], hipR: [-0.1, 0, -0.12], kneeL: [0.15, 0, 0], kneeR: [0.15, 0, 0],
  },
  sad: {
    spine: [0.25, 0, 0], neck: [0.55, 0, 0],
    shoulderL: [0.05, 0, 0.05], shoulderR: [0.05, 0, -0.05], elbowL: [-0.1, 0, 0], elbowR: [-0.1, 0, 0],
    hipL: [-0.1, 0, 0.04], hipR: [-0.1, 0, -0.04], kneeL: [0.2, 0, 0], kneeR: [0.2, 0, 0],
  },
};
