/**
 * Matemática pura de animación. Convenciones del rig:
 * el personaje mira a +z; brazos y piernas cuelgan hacia −y; x negativo en hombro/cadera = hacia adelante
 * (−π = brazo arriba); rodilla flexiona con x positivo; codo flexiona con x negativo; columna x positivo = inclinarse
 * adelante; columna y positivo = girar el hombro derecho hacia atrás (armar el brazo).
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
    if (!a[j] && !b[j]) continue;
    const pa = a[j] ?? ZERO;
    const pb = b[j] ?? ZERO;
    out[j] = [lerp(pa[0], pb[0], t), lerp(pa[1], pb[1], t), lerp(pa[2], pb[2], t)];
  }
  return out;
}

/** Suaviza la entrada a una pose: 0 → 1 con aceleración y frenado. */
export const ease = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** Keyframe de una pista: tiempo relativo al momento clave (contacto, ápice del salto o saque). */
export interface Key {
  t: number;
  pose: Pose;
}

/** Pose de una pista en el tiempo relativo `t`, con interpolación suave entre keyframes. */
export function sampleTrack(track: readonly Key[], t: number): Pose {
  if (t <= track[0].t) return track[0].pose;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    if (t <= b.t) return blendPose(a.pose, b.pose, ease((t - a.t) / (b.t - a.t)));
  }
  return track[track.length - 1].pose;
}

/** Duración de la pista (desde el primer hasta el último keyframe). */
export const trackSpan = (track: readonly Key[]): [number, number] => [track[0].t, track[track.length - 1].t];

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

/**
 * Carrera: piernas opuestas a los brazos, codos doblados a ~90°, la rodilla de la pierna que avanza se flexiona y
 * el tronco se inclina hacia adelante. `k` (0..1) escala la amplitud; `dir` = −1 para correr hacia atrás.
 */
export function runPose(phase: number, k: number, dir: 1 | -1 = 1): Pose {
  const s = Math.sin(phase) * dir;
  const c = Math.cos(phase);
  const swingL = -0.85 * s * k;
  const swingR = 0.85 * s * k;
  return {
    spine: [(dir === 1 ? 0.3 : 0.05) * k + 0.05, 0.08 * s * k, 0],
    neck: [-0.25 * k, 0, 0],
    hipL: [swingL, 0, 0.04],
    kneeL: [0.25 + Math.max(0, c) * 1.25 * k, 0, 0],
    hipR: [swingR, 0, -0.04],
    kneeR: [0.25 + Math.max(0, -c) * 1.25 * k, 0, 0],
    shoulderL: [0.75 * s * k - 0.1, 0, 0.1],
    elbowL: [-1.5, 0, 0],
    shoulderR: [-0.75 * s * k - 0.1, 0, -0.1],
    elbowR: [-1.5, 0, 0],
  };
}

/** Caminata: pasos cortos, brazos colgando que se balancean, cuerpo erguido. `dir` -1 = hacia atrás. */
export function walkPose(phase: number, k: number, dir: 1 | -1 = 1): Pose {
  const s = Math.sin(phase) * dir;
  const c = Math.cos(phase);
  return {
    spine: [0.04, 0.05 * s * k, 0],
    neck: [-0.04, 0, 0],
    hipL: [-0.45 * s * k, 0, 0.03],
    kneeL: [0.08 + Math.max(0, c) * 0.55 * k, 0, 0],
    hipR: [0.45 * s * k, 0, -0.03],
    kneeR: [0.08 + Math.max(0, -c) * 0.55 * k, 0, 0],
    shoulderL: [0.35 * s * k, 0, 0.08],
    elbowL: [-0.25, 0, 0],
    shoulderR: [-0.35 * s * k, 0, -0.08],
    elbowR: [-0.25, 0, 0],
  };
}

/** Desplazamiento lateral de defensa: piernas que se abren y cierran, rodillas flexionadas, sin cruzar los pies. */
export function shufflePose(phase: number, k: number): Pose {
  const open = (0.5 + 0.5 * Math.sin(phase)) * 0.35 * k;
  return {
    spine: [0.3, 0, 0],
    neck: [-0.3, 0, 0],
    hipL: [-0.5, 0, 0.1 + open],
    kneeL: [0.9, 0, 0],
    hipR: [-0.5, 0, -0.1 - open],
    kneeR: [0.9, 0, 0],
    shoulderL: [-0.6, 0, 0.2],
    elbowL: [-0.7, 0, 0],
    shoulderR: [-0.6, 0, -0.2],
    elbowR: [-0.7, 0, 0],
  };
}

export const POSES = {
  idle: {
    shoulderL: [0, 0, 0.1], shoulderR: [0, 0, -0.1], elbowL: [-0.15, 0, 0], elbowR: [-0.15, 0, 0],
    hipL: [-0.05, 0, 0.04], hipR: [0.05, 0, -0.04], kneeL: [0.1, 0, 0], kneeR: [0.05, 0, 0],
  },
  ready: {
    spine: [0.32, 0, 0], neck: [-0.3, 0, 0],
    shoulderL: [-0.6, 0, 0.18], shoulderR: [-0.6, 0, -0.18], elbowL: [-0.75, 0, 0], elbowR: [-0.75, 0, 0],
    hipL: [-0.55, 0, 0.14], hipR: [-0.55, 0, -0.14], kneeL: [0.95, 0, 0], kneeR: [0.95, 0, 0],
  },
  /** Sentado en la banca: muslos horizontales, manos sobre las rodillas. */
  sit: {
    spine: [0.12, 0, 0], neck: [-0.15, 0, 0],
    shoulderL: [-0.55, 0, 0.12], shoulderR: [-0.55, 0, -0.12], elbowL: [-1.1, 0, 0], elbowR: [-1.1, 0, 0],
    hipL: [-1.5, 0, 0.12], hipR: [-1.5, 0, -0.12], kneeL: [1.5, 0, 0], kneeR: [1.5, 0, 0],
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
} satisfies Record<string, Pose>;

const both = (x: number, z: number, elbow: number): Pose => ({
  shoulderL: [x, 0, z], shoulderR: [x, 0, -z], elbowL: [elbow, 0, 0], elbowR: [elbow, 0, 0],
});
const legs = (hip: number, knee: number, spread = 0.1): Pose => ({
  hipL: [hip, 0, spread], hipR: [hip, 0, -spread], kneeL: [knee, 0, 0], kneeR: [knee, 0, 0],
});

/**
 * Pistas de gestos técnicos. Tiempos relativos al momento clave:
 * remate, colocación y recepción → contacto; bloqueo → ápice del salto; saque → golpe.
 */
export const TRACKS: Record<'spike' | 'block' | 'set' | 'bump' | 'dive' | 'plancha' | 'serve' | 'serveFloat', readonly Key[]> = {
  // Carrera, penúltimo paso con brazos atrás, impulso con braceo, "arco y flecha", golpe, seguimiento y caída.
  spike: [
    { t: -0.62, pose: { spine: [0.35, 0, 0], neck: [-0.35, 0, 0], ...both(0.3, 0.1, -0.3), ...legs(-0.5, 0.7) } },
    { t: -0.5, pose: { spine: [0.6, 0, 0], neck: [-0.45, 0, 0], ...both(1.25, 0.12, -0.15), ...legs(-1.05, 1.55, 0.14) } },
    { t: -0.4, pose: { spine: [0.05, 0, 0], neck: [-0.3, 0, 0], ...both(-1.9, 0.1, -0.4), ...legs(-0.15, 0.25) } },
    {
      t: -0.2,
      pose: {
        spine: [-0.35, 0.22, 0], neck: [-0.35, 0, 0],
        shoulderL: [-2.75, 0, 0.15], elbowL: [-0.2, 0, 0],
        shoulderR: [-2.95, 0, -0.6], elbowR: [-2.1, 0, 0],
        hipL: [-0.75, 0, 0.1], kneeL: [1.25, 0, 0], hipR: [-0.3, 0, -0.1], kneeR: [1.5, 0, 0],
      },
    },
    {
      t: 0,
      pose: {
        spine: [0.12, -0.08, 0], neck: [-0.3, 0, 0],
        shoulderL: [-0.9, 0, 0.3], elbowL: [-1.0, 0, 0],
        shoulderR: [-2.95, 0, -0.12], elbowR: [-0.03, 0, 0],
        ...legs(-0.45, 0.9),
      },
    },
    {
      t: 0.15,
      pose: {
        spine: [0.5, -0.18, 0], neck: [-0.25, 0, 0],
        shoulderL: [-0.3, 0, 0.2], elbowL: [-0.8, 0, 0],
        shoulderR: [-0.6, 0, 0.45], elbowR: [-0.6, 0, 0],
        ...legs(-0.4, 0.7),
      },
    },
    { t: 0.42, pose: { spine: [0.5, 0, 0], neck: [-0.3, 0, 0], ...both(-0.6, 0.2, -0.5), ...legs(-1.0, 1.5, 0.14) } },
    { t: 0.75, pose: POSES.ready },
  ],
  // Piernas flexionadas con manos a la altura de los hombros, salto y brazos que pasan sobre la red, caída flexionada.
  block: [
    { t: -0.55, pose: { spine: [0.15, 0, 0], neck: [-0.2, 0, 0], ...both(-1.5, 0.1, -1.7), ...legs(-0.75, 1.25, 0.14) } },
    // Impulso con los brazos casi verticales: mientras el cuerpo está bajo, las manos no tocan la red.
    { t: -0.32, pose: { spine: [0.05, 0, 0], neck: [-0.15, 0, 0], ...both(-2.8, 0.12, -0.3), ...legs(-0.2, 0.3) } },
    // Ápice: con las manos ya sobre la cinta, se inclinan hacia el campo rival (bloqueo invasivo).
    { t: 0, pose: { spine: [0.15, 0, 0], neck: [-0.2, 0, 0], ...both(-2.55, 0.1, -0.05), ...legs(-0.25, 0.4) } },
    { t: 0.3, pose: { spine: [0.2, 0, 0], neck: [-0.2, 0, 0], ...both(-1.8, 0.15, -1.0), ...legs(-0.8, 1.3, 0.14) } },
    { t: 0.6, pose: POSES.ready },
  ],
  // Manos que suben a la frente, extensión de brazos y piernas en el contacto.
  set: [
    { t: -0.45, pose: { spine: [0, 0, 0], neck: [-0.45, 0, 0], ...both(-2.3, 0.35, -1.7), ...legs(-0.45, 0.75) } },
    { t: 0, pose: { spine: [-0.05, 0, 0], neck: [-0.45, 0, 0], ...both(-2.75, 0.3, -0.6), ...legs(-0.2, 0.35) } },
    { t: 0.2, pose: { spine: [-0.05, 0, 0], neck: [-0.35, 0, 0], ...both(-3.0, 0.2, -0.1), ...legs(-0.1, 0.15) } },
    { t: 0.5, pose: POSES.ready },
  ],
  // Plataforma con los brazos juntos y estirados, piernas flexionadas que empujan en el contacto.
  bump: [
    { t: -0.5, pose: { spine: [0.45, 0, 0], neck: [-0.35, 0, 0], ...both(-0.7, -0.3, 0), ...legs(-0.85, 1.35, 0.18) } },
    { t: 0, pose: { spine: [0.35, 0, 0], neck: [-0.35, 0, 0], ...both(-1.0, -0.3, 0), ...legs(-0.7, 1.1, 0.18) } },
    { t: 0.25, pose: { spine: [0.2, 0, 0], neck: [-0.3, 0, 0], ...both(-1.25, -0.28, 0), ...legs(-0.45, 0.7, 0.16) } },
    { t: 0.55, pose: POSES.ready },
  ],
  // Defensa baja: zancada profunda y brazos estirados hacia el piso.
  dive: [
    { t: -0.45, pose: { spine: [0.55, 0, 0], neck: [-0.5, 0, 0], ...both(-1.0, -0.3, 0), hipL: [-1.15, 0, 0.25], kneeL: [1.7, 0, 0], hipR: [-0.5, 0, -0.2], kneeR: [1.3, 0, 0] } },
    { t: 0, pose: { spine: [0.9, 0, 0], neck: [-0.7, 0, 0], ...both(0.4, -0.3, 0), hipL: [-1.4, 0, 0.25], kneeL: [2.1, 0, 0], hipR: [-1.0, 0, -0.2], kneeR: [1.9, 0, 0] } },
    { t: 0.4, pose: { spine: [0.5, 0, 0], neck: [-0.4, 0, 0], ...both(-0.9, 0.1, -0.3), ...legs(-0.9, 1.4, 0.18) } },
    { t: 0.8, pose: POSES.ready },
  ],
  // Plancha: carrera agachada, lanzamiento, cuerpo estirado y horizontal con los brazos al frente, y a levantarse.
  plancha: [
    { t: -0.42, pose: { spine: [0.6, 0, 0], neck: [-0.5, 0, 0], ...both(-0.4, -0.3, 0), ...legs(-0.9, 1.3, 0.15) } },
    { t: -0.14, pose: { spine: [1.1, 0, 0], neck: [-0.9, 0, 0], ...both(-2.4, -0.15, 0), hipL: [0.2, 0, 0.12], kneeL: [0.4, 0, 0], hipR: [-0.5, 0, -0.12], kneeR: [0.9, 0, 0] } },
    { t: 0, pose: { spine: [1.45, 0, 0], neck: [-1.15, 0, 0], ...both(-2.95, -0.1, 0), hipL: [1.25, 0, 0.12], kneeL: [0.2, 0, 0], hipR: [1.15, 0, -0.12], kneeR: [0.35, 0, 0] } },
    { t: 0.45, pose: { spine: [1.5, 0, 0], neck: [-1.1, 0, 0], ...both(-2.7, -0.2, 0), hipL: [1.3, 0, 0.12], kneeL: [0.3, 0, 0], hipR: [1.25, 0, -0.12], kneeR: [0.5, 0, 0] } },
    { t: 0.9, pose: { spine: [0.9, 0, 0], neck: [-0.6, 0, 0], ...both(-0.6, -0.3, 0), ...legs(-1.2, 2.0, 0.2) } },
    { t: 1.35, pose: POSES.ready },
  ],
  // Flotado en salto: dos pasos, saltito, brazo recto que golpea seco y se frena (sin seguimiento).
  serveFloat: [
    { t: -1.0, pose: { spine: [0.1, 0, 0], neck: [-0.2, 0, 0], shoulderL: [-1.1, 0, 0.1], elbowL: [-0.3, 0, 0], shoulderR: [-0.3, 0, -0.1], elbowR: [-0.4, 0, 0], ...legs(-0.3, 0.35, 0.1) } },
    { t: -0.6, pose: { spine: [0.0, 0.15, 0], neck: [-0.4, 0, 0], shoulderL: [-2.6, 0, 0.1], elbowL: [0, 0, 0], shoulderR: [-1.0, 0, -0.2], elbowR: [-0.6, 0, 0], hipL: [-0.6, 0, 0.1], kneeL: [0.7, 0, 0], hipR: [0.3, 0, -0.1], kneeR: [0.3, 0, 0] } },
    { t: -0.25, pose: { spine: [-0.2, 0.3, 0], neck: [-0.5, 0, 0], shoulderL: [-2.4, 0, 0.2], elbowL: [-0.2, 0, 0], shoulderR: [-2.9, 0, -0.4], elbowR: [-1.6, 0, 0], ...legs(-0.7, 1.0, 0.12) } },
    { t: 0, pose: { spine: [0.05, -0.1, 0], neck: [-0.4, 0, 0], shoulderL: [-1.2, 0, 0.3], elbowL: [-0.6, 0, 0], shoulderR: [-2.95, 0, -0.1], elbowR: [-0.02, 0, 0], ...legs(-0.25, 0.3, 0.12) } },
    { t: 0.25, pose: { spine: [0.1, -0.1, 0], neck: [-0.35, 0, 0], shoulderL: [-0.8, 0, 0.3], elbowL: [-0.6, 0, 0], shoulderR: [-2.6, 0, -0.05], elbowR: [-0.1, 0, 0], ...legs(-0.6, 0.9, 0.12) } },
    { t: 0.8, pose: POSES.ready },
  ],
  // Saque: pelota en la mano izquierda, lanzamiento, brazo armado, golpe y seguimiento.
  serve: [
    { t: -0.9, pose: { spine: [0.1, 0, 0], neck: [-0.2, 0, 0], shoulderL: [-1.1, 0, 0.1], elbowL: [-0.3, 0, 0], shoulderR: [-0.2, 0, -0.1], elbowR: [-0.3, 0, 0], hipL: [-0.3, 0, 0.1], hipR: [0.15, 0, -0.08], kneeL: [0.3, 0, 0], kneeR: [0.25, 0, 0] } },
    { t: -0.55, pose: { spine: [-0.2, 0.2, 0], neck: [-0.45, 0, 0], shoulderL: [-2.9, 0, 0.1], elbowL: [0, 0, 0], shoulderR: [-2.6, 0, -0.4], elbowR: [-1.9, 0, 0], hipL: [-0.3, 0, 0.1], hipR: [0.15, 0, -0.08], kneeL: [0.45, 0, 0], kneeR: [0.4, 0, 0] } },
    { t: -0.08, pose: { spine: [-0.3, 0.35, 0], neck: [-0.45, 0, 0], shoulderL: [-2.2, 0, 0.2], elbowL: [-0.2, 0, 0], shoulderR: [-3.0, 0, -0.5], elbowR: [-2.2, 0, 0], hipL: [-0.35, 0, 0.1], hipR: [0.2, 0, -0.08], kneeL: [0.3, 0, 0], kneeR: [0.3, 0, 0] } },
    { t: 0, pose: { spine: [0.25, -0.2, 0], neck: [-0.35, 0, 0], shoulderL: [-1.0, 0, 0.3], elbowL: [-0.8, 0, 0], shoulderR: [-2.7, 0, -0.1], elbowR: [-0.05, 0, 0], hipL: [-0.45, 0, 0.1], hipR: [0.25, 0, -0.08], kneeL: [0.25, 0, 0], kneeR: [0.35, 0, 0] } },
    { t: 0.3, pose: { spine: [0.35, -0.3, 0], neck: [-0.3, 0, 0], shoulderL: [-0.2, 0, 0.2], elbowL: [-0.6, 0, 0], shoulderR: [-0.5, 0, 0.35], elbowR: [-0.5, 0, 0], hipL: [-0.5, 0, 0.1], hipR: [-0.2, 0, -0.1], kneeL: [0.6, 0, 0], kneeR: [0.6, 0, 0] } },
    { t: 0.8, pose: POSES.ready },
  ],
};
