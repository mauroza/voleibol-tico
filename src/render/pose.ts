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

/**
 * Memoria reutilizable para las poses del cuadro: mezclar poses de 30 personajes creaba cientos de miles de objetos por
 * segundo y el recolector de basura frenaba el juego cada tanto (los "tirones"). Se reinicia al empezar cada cuadro
 * (`resetPosePool`); una pose mezclada vale solo durante ese cuadro.
 */
const vecPool: number[][] = [];
let vecUsed = 0;
const posePool: Record<string, Euler3 | undefined>[] = [];
let poseUsed = 0;

export function resetPosePool(): void {
  vecUsed = 0;
  poseUsed = 0;
}

function vec(x: number, y: number, z: number): Euler3 {
  let a = vecPool[vecUsed];
  if (!a) vecPool[vecUsed] = a = [0, 0, 0];
  vecUsed++;
  a[0] = x;
  a[1] = y;
  a[2] = z;
  return a as unknown as Euler3;
}

function freshPose(): Record<string, Euler3 | undefined> {
  let o = posePool[poseUsed];
  if (!o) posePool[poseUsed] = o = {};
  else for (const j of JOINTS) o[j] = undefined;
  poseUsed++;
  return o;
}

/** Pose del cuadro (de la memoria reutilizable) con los valores de `p` y lo de `over` encima. */
export function framePose(p: Pose, over?: Pose): Pose {
  const o = freshPose();
  for (const j of JOINTS) {
    const e = over?.[j] ?? p[j];
    if (e) o[j] = e;
  }
  return o as Pose;
}

export function blendPose(a: Pose, b: Pose, t: number): Pose {
  const out = freshPose();
  for (const j of JOINTS) {
    const pa = a[j];
    const pb = b[j];
    if (!pa && !pb) continue;
    const x = pa ?? ZERO;
    const y = pb ?? ZERO;
    out[j] = vec(lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t));
  }
  return out as Pose;
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
  const o = freshPose();
  o.spine = vec((dir === 1 ? 0.3 : 0.05) * k + 0.05, 0.08 * s * k, 0);
  o.neck = vec(-0.25 * k, 0, 0);
  o.hipL = vec(swingL, 0, 0.04);
  o.kneeL = vec(0.25 + Math.max(0, c) * 1.25 * k, 0, 0);
  o.hipR = vec(swingR, 0, -0.04);
  o.kneeR = vec(0.25 + Math.max(0, -c) * 1.25 * k, 0, 0);
  o.shoulderL = vec(0.75 * s * k - 0.1, 0, 0.1);
  o.elbowL = vec(-1.5, 0, 0);
  o.shoulderR = vec(-0.75 * s * k - 0.1, 0, -0.1);
  o.elbowR = vec(-1.5, 0, 0);
  return o as Pose;
}

/** Caminata: pasos cortos, brazos colgando que se balancean, cuerpo erguido. `dir` -1 = hacia atrás. */
export function walkPose(phase: number, k: number, dir: 1 | -1 = 1): Pose {
  const s = Math.sin(phase) * dir;
  const c = Math.cos(phase);
  const o = freshPose();
  o.spine = vec(0.04, 0.05 * s * k, 0);
  o.neck = vec(-0.04, 0, 0);
  o.hipL = vec(-0.45 * s * k, 0, 0.03);
  o.kneeL = vec(0.08 + Math.max(0, c) * 0.55 * k, 0, 0);
  o.hipR = vec(0.45 * s * k, 0, -0.03);
  o.kneeR = vec(0.08 + Math.max(0, -c) * 0.55 * k, 0, 0);
  o.shoulderL = vec(0.35 * s * k, 0, 0.08);
  o.elbowL = vec(-0.25, 0, 0);
  o.shoulderR = vec(-0.35 * s * k, 0, -0.08);
  o.elbowR = vec(-0.25, 0, 0);
  return o as Pose;
}

/** Desplazamiento lateral de defensa: piernas que se abren y cierran, rodillas flexionadas, sin cruzar los pies. */
export function shufflePose(phase: number, k: number): Pose {
  const open = (0.5 + 0.5 * Math.sin(phase)) * 0.35 * k;
  const o = freshPose();
  o.spine = vec(0.3, 0, 0);
  o.neck = vec(-0.3, 0, 0);
  o.hipL = vec(-0.5, 0, 0.1 + open);
  o.kneeL = vec(0.9, 0, 0);
  o.hipR = vec(-0.5, 0, -0.1 - open);
  o.kneeR = vec(0.9, 0, 0);
  o.shoulderL = vec(-0.6, 0, 0.2);
  o.elbowL = vec(-0.7, 0, 0);
  o.shoulderR = vec(-0.6, 0, -0.2);
  o.elbowR = vec(-0.7, 0, 0);
  return o as Pose;
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
  // Colocación (como en los manuales): agachado, las manos suben y arman el marco adelante y arriba de la frente, juntas
  // (brazos hacia adentro: con la cabeza grande, si no, quedaban a los costados), mirando la pelota; en el contacto
  // empujan las piernas y los brazos se estiran juntos hacia arriba y adelante.
  set: [
    { t: -0.6, pose: { spine: [0.18, 0, 0], neck: [-0.35, 0, 0], ...both(-1.4, -0.15, -1.1), ...legs(-0.65, 1.05, 0.14) } },
    { t: -0.28, pose: { spine: [0.06, 0, 0], neck: [-0.6, 0, 0], ...both(-2.5, -0.4, -0.7), ...legs(-0.6, 1.0, 0.14) } },
    { t: 0, pose: { spine: [-0.02, 0, 0], neck: [-0.6, 0, 0], ...both(-2.65, -0.35, -0.35), ...legs(-0.35, 0.55, 0.12) } },
    { t: 0.16, pose: { spine: [-0.08, 0, 0], neck: [-0.45, 0, 0], ...both(-2.95, -0.2, -0.05), ...legs(-0.05, 0.1, 0.1) } },
    { t: 0.55, pose: POSES.ready },
  ],
  // Recepción: la plataforma (brazos estirados y juntos) se arma antes de que llegue la pelota, bien abajo y con las
  // rodillas flexionadas; en el contacto empujan las piernas y los brazos casi no suben (nunca sobre los hombros).
  bump: [
    { t: -0.6, pose: { spine: [0.3, 0, 0], neck: [-0.3, 0, 0], ...both(-0.45, -0.2, -0.6), ...legs(-0.7, 1.1, 0.2) } },
    { t: -0.3, pose: { spine: [0.45, 0, 0], neck: [-0.45, 0, 0], ...both(-0.85, -0.42, -0.05), ...legs(-0.95, 1.45, 0.2) } },
    { t: 0, pose: { spine: [0.38, 0, 0], neck: [-0.45, 0, 0], ...both(-0.95, -0.42, 0), ...legs(-0.75, 1.15, 0.2) } },
    { t: 0.2, pose: { spine: [0.25, 0, 0], neck: [-0.35, 0, 0], ...both(-1.1, -0.4, 0), ...legs(-0.45, 0.65, 0.18) } },
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
