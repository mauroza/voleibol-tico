import * as THREE from 'three';
import type { JointName } from './pose';
import { mergeParts, placed, type Part } from './merge';
import { OUTLINE, toon, toonVertexColors } from './toon';

/** Medidas del personaje (metros). Proporciones anime: piernas largas, cabeza algo grande. */
export const DIMS = {
  thigh: 0.47,
  shin: 0.47,
  foot: 0.06,
  upperArm: 0.3,
  forearm: 0.29,
} as const;

export interface Look {
  primary: string;
  secondary: string;
  skin: string;
  hair: string;
  eyes: string;
  number: number;
  hairStyle: number;
}

export interface Rig {
  root: THREE.Group;
  /** Hijo de root: se desplaza en y para los saltos. */
  body: THREE.Group;
  hips: THREE.Object3D;
  joints: Record<JointName, THREE.Object3D>;
}

const SKINS = ['#f6d3b3', '#eebf98', '#d9a477', '#b97f55', '#8a5a3b'];
const HAIRS = ['#16131c', '#2c1d16', '#4a2e1f', '#7a4b2a', '#c9a15d', '#23324f', '#3a2550', '#9c2f2f'];
const EYES = ['#3b2414', '#1f4f8a', '#2f6b3a', '#6a2f8a', '#8a5a14'];

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Apariencia estable por jugador: tono de piel, pelo, ojos y peinado salen del hash de su clave. */
export function lookFor(key: string, number: number, primary: string, secondary: string, libero: boolean): Look {
  const h = hash(key);
  return {
    primary: libero ? secondary : primary,
    secondary: libero ? primary : secondary,
    skin: SKINS[h % SKINS.length],
    hair: HAIRS[(h >>> 4) % HAIRS.length],
    eyes: EYES[(h >>> 9) % EYES.length],
    number,
    hairStyle: (h >>> 13) % 3,
  };
}

// ---------- texturas dibujadas con canvas ----------

const textureCache = new Map<string, THREE.CanvasTexture>();

function canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  let t = textureCache.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(key, t);
  }
  return t;
}

/** Ojo anime: contorno grueso arriba, iris grande con degradé, pupila y dos brillos. */
function eyeTexture(iris: string): THREE.CanvasTexture {
  return canvasTexture(`eye:${iris}`, 64, 80, (g) => {
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(32, 44, 26, 32, 0, 0, Math.PI * 2);
    g.fill();
    const grad = g.createLinearGradient(0, 18, 0, 76);
    grad.addColorStop(0, '#111');
    grad.addColorStop(0.35, iris);
    grad.addColorStop(1, '#ffffffaa');
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(32, 48, 18, 26, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#0b0b10';
    g.beginPath();
    g.ellipse(32, 50, 8, 12, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.ellipse(24, 36, 6, 8, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(40, 60, 3, 3, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#120c14';
    g.lineWidth = 7;
    g.beginPath();
    g.ellipse(32, 44, 26, 32, 0, Math.PI * 1.08, Math.PI * 1.92);
    g.stroke();
  });
}

function numberTexture(n: number, color: string): THREE.CanvasTexture {
  return canvasTexture(`num:${n}:${color}`, 128, 128, (g) => {
    g.fillStyle = color;
    g.font = 'bold 96px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n), 64, 70);
  });
}

/** Color legible sobre el color de la camiseta. */
function contrast(hex: string): string {
  const c = new THREE.Color(hex);
  return c.r * 0.3 + c.g * 0.59 + c.b * 0.11 > 0.55 ? '#141414' : '#ffffff';
}

// ---------- geometrías compartidas (pocos segmentos: estilo low-poly y menos triángulos) ----------

const limb = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 3, 8);
const shared = {
  upperArm: limb(0.06, DIMS.upperArm - 0.08),
  sleeve: new THREE.CylinderGeometry(0.078, 0.072, 0.15, 10),
  forearm: limb(0.052, DIMS.forearm - 0.07),
  hand: new THREE.SphereGeometry(0.058, 8, 6),
  thigh: limb(0.088, DIMS.thigh - 0.1),
  shortsLeg: new THREE.CylinderGeometry(0.105, 0.098, 0.2, 10),
  shin: limb(0.066, DIMS.shin - 0.1),
  kneepad: new THREE.CylinderGeometry(0.08, 0.076, 0.11, 10),
  sock: new THREE.CylinderGeometry(0.068, 0.064, 0.12, 8),
  shoe: new THREE.BoxGeometry(0.12, 0.075, 0.26),
  pelvis: limb(0.13, 0.08),
  chest: limb(0.15, 0.26),
  neck: new THREE.CylinderGeometry(0.052, 0.058, 0.1, 8),
  head: new THREE.SphereGeometry(0.135, 16, 12),
  hairCap: new THREE.SphereGeometry(0.15, 16, 9, 0, Math.PI * 2, 0, Math.PI * 0.58),
  spike: new THREE.ConeGeometry(0.05, 0.16, 5),
  mouth: new THREE.PlaneGeometry(0.035, 0.008),
};

/** Dos ojos en una sola geometría (mismo material con la textura del ojo). */
const EYES_GEO = (() => {
  const g = new THREE.PlaneGeometry(0.074, 0.094);
  return mergeParts([-1, 1].map((side) => ({ geometry: g, color: '#ffffff', matrix: placed(side * 0.045, -0.012, 0.126, [0, side * 0.24, 0]) })));
})();

/** Número de espalda (grande) y de pecho (chico) en una sola geometría. */
const NUMBERS_GEO = (() => {
  const g = new THREE.PlaneGeometry(0.2, 0.2);
  return mergeParts([
    { geometry: g, color: '#ffffff', matrix: placed(0, 0.24, -0.125, [0, Math.PI, 0]) },
    { geometry: g, color: '#ffffff', matrix: placed(0.07, 0.3, 0.125, [0, 0, 0], [0.45, 0.45, 0.45]) },
  ]);
})();

const texturedCache = new Map<string, THREE.MeshToonMaterial>();
function texturedToon(key: string, make: () => THREE.Texture): THREE.MeshToonMaterial {
  let m = texturedCache.get(key);
  if (!m) {
    m = toon('#fff', make());
    texturedCache.set(key, m);
  }
  return m;
}

function joint(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  const j = new THREE.Object3D();
  j.position.set(x, y, z);
  parent.add(j);
  return j;
}

/** Fusiona las piezas de una articulación en una malla toon con contorno. */
function attach(parent: THREE.Object3D, parts: Part[]): void {
  const geometry = mergeParts(parts);
  const mesh = new THREE.Mesh(geometry, toonVertexColors());
  mesh.add(new THREE.Mesh(geometry, OUTLINE));
  parent.add(mesh);
}

/** Peinados: posiciones (en la cabeza) y orientación de los mechones puntiagudos. */
const HAIR_SPIKES: [number, number, number, number, number][][] = [
  // [x, y, z, rotX, rotZ]
  [[0, 0.13, 0.08, 0.9, 0], [0.07, 0.12, 0.06, 0.8, -0.5], [-0.07, 0.12, 0.06, 0.8, 0.5], [0, 0.15, -0.02, 0.2, 0], [0.1, 0.07, -0.04, 0, -1.2], [-0.1, 0.07, -0.04, 0, 1.2], [0, 0.08, -0.12, -1.0, 0]],
  [[0.04, 0.14, 0.07, 1.1, -0.3], [-0.05, 0.13, 0.08, 1.2, 0.3], [0.11, 0.06, 0.02, 0.3, -1.4], [-0.11, 0.06, 0.02, 0.3, 1.4], [0.03, 0.15, -0.05, -0.4, -0.2], [-0.04, 0.12, -0.1, -0.9, 0.3]],
  [[0, 0.16, 0.0, 0, 0], [0.06, 0.15, 0.02, 0.2, -0.4], [-0.06, 0.15, 0.02, 0.2, 0.4], [0.04, 0.13, -0.08, -0.5, -0.2], [-0.04, 0.13, -0.08, -0.5, 0.2], [0, 0.1, 0.11, 1.3, 0]],
];

/**
 * Personaje anime: una malla fusionada (color por vértice) por articulación, más ojos y números texturizados.
 * Unas 26 llamadas de dibujo por personaje en lugar de ~65.
 */
export function buildCharacter(look: Look): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hips = joint(body, 0, DIMS.thigh + DIMS.shin + DIMS.foot, 0);
  attach(hips, [{ geometry: shared.pelvis, color: look.secondary, matrix: placed(0, 0.02, 0, [0, 0, 0], [1.1, 1, 0.8]) }]);

  // Torso con números
  const spine = joint(hips, 0, 0.08, 0);
  attach(spine, [{ geometry: shared.chest, color: look.primary, matrix: placed(0, 0.2, 0, [0, 0, 0], [1.25, 1, 0.78]) }]);
  const ink = contrast(look.primary);
  spine.add(new THREE.Mesh(NUMBERS_GEO, texturedToon(`num:${look.number}:${ink}`, () => numberTexture(look.number, ink))));

  // Cuello y cabeza (la cabeza va algo escalada: más alta que ancha)
  const neck = joint(spine, 0, 0.47, 0);
  attach(neck, [{ geometry: shared.neck, color: look.skin, matrix: placed(0, 0.03, 0) }]);
  const head = joint(neck, 0, 0.16, 0.01);
  head.scale.set(0.96, 1.08, 1);
  attach(head, [
    { geometry: shared.head, color: look.skin, matrix: new THREE.Matrix4() },
    { geometry: shared.hairCap, color: look.hair, matrix: placed(0, 0.012, -0.012, [-0.35, 0, 0]) },
    ...HAIR_SPIKES[look.hairStyle].map(([x, y, z, rx, rz]): Part => ({ geometry: shared.spike, color: look.hair, matrix: placed(x, y, z, [rx, 0, rz]) })),
    { geometry: shared.mouth, color: '#5a2a2a', matrix: placed(0, -0.07, 0.129) },
  ]);
  head.add(new THREE.Mesh(EYES_GEO, texturedToon(`eye:${look.eyes}`, () => eyeTexture(look.eyes))));

  // Brazos (L = +x)
  const arm = (side: 1 | -1) => {
    const shoulder = joint(spine, side * 0.2, 0.38, 0);
    attach(shoulder, [
      { geometry: shared.sleeve, color: look.primary, matrix: placed(0, -0.05, 0) },
      { geometry: shared.upperArm, color: look.skin, matrix: placed(0, -DIMS.upperArm / 2, 0) },
    ]);
    const elbow = joint(shoulder, 0, -DIMS.upperArm, 0);
    attach(elbow, [
      { geometry: shared.forearm, color: look.skin, matrix: placed(0, -DIMS.forearm / 2, 0) },
      { geometry: shared.hand, color: look.skin, matrix: placed(0, -DIMS.forearm, 0) },
    ]);
    return { shoulder, elbow };
  };
  const L = arm(1);
  const R = arm(-1);

  // Piernas
  const leg = (side: 1 | -1) => {
    const hip = joint(hips, side * 0.1, -0.02, 0);
    attach(hip, [
      { geometry: shared.shortsLeg, color: look.secondary, matrix: placed(0, -0.08, 0) },
      { geometry: shared.thigh, color: look.skin, matrix: placed(0, -DIMS.thigh / 2, 0) },
    ]);
    const knee = joint(hip, 0, -DIMS.thigh, 0);
    attach(knee, [
      { geometry: shared.kneepad, color: '#f2f2f2', matrix: placed(0, -0.02, 0.012) },
      { geometry: shared.shin, color: look.skin, matrix: placed(0, -DIMS.shin / 2, 0) },
      { geometry: shared.sock, color: '#f2f2f2', matrix: placed(0, -DIMS.shin + 0.06, 0) },
      { geometry: shared.shoe, color: '#22252e', matrix: placed(0, -DIMS.shin - DIMS.foot / 2 + 0.01, 0.05) },
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
