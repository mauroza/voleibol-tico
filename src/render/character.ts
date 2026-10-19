import * as THREE from 'three';
import type { JointName } from './pose';
import { toon, toonMesh } from './toon';

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

// ---------- geometrías compartidas ----------

const geo = {
  limb: (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 4, 10),
  sphere: (r: number) => new THREE.SphereGeometry(r, 20, 14),
};
const shared = {
  upperArm: geo.limb(0.06, DIMS.upperArm - 0.08),
  sleeve: new THREE.CylinderGeometry(0.078, 0.072, 0.15, 12),
  forearm: geo.limb(0.052, DIMS.forearm - 0.07),
  hand: geo.sphere(0.058),
  thigh: geo.limb(0.088, DIMS.thigh - 0.1),
  shortsLeg: new THREE.CylinderGeometry(0.105, 0.098, 0.2, 12),
  shin: geo.limb(0.066, DIMS.shin - 0.1),
  kneepad: new THREE.CylinderGeometry(0.08, 0.076, 0.11, 12),
  sock: new THREE.CylinderGeometry(0.068, 0.064, 0.12, 10),
  shoe: new THREE.BoxGeometry(0.12, 0.075, 0.26),
  pelvis: geo.limb(0.13, 0.08),
  chest: geo.limb(0.15, 0.26),
  neck: new THREE.CylinderGeometry(0.052, 0.058, 0.1, 10),
  head: geo.sphere(0.135),
  hairCap: new THREE.SphereGeometry(0.15, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
  spike: new THREE.ConeGeometry(0.05, 0.16, 6),
  eye: new THREE.PlaneGeometry(0.074, 0.094),
  mouth: new THREE.PlaneGeometry(0.035, 0.008),
  number: new THREE.PlaneGeometry(0.2, 0.2),
};

const at = (o: THREE.Object3D, x: number, y: number, z: number) => {
  o.position.set(x, y, z);
  return o;
};

function joint(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  const j = at(new THREE.Object3D(), x, y, z);
  parent.add(j);
  return j;
}

/** Peinados: posiciones (en la cabeza) y orientación de los mechones puntiagudos. */
const HAIR_SPIKES: [number, number, number, number, number][][] = [
  // [x, y, z, rotX, rotZ]
  [[0, 0.13, 0.08, 0.9, 0], [0.07, 0.12, 0.06, 0.8, -0.5], [-0.07, 0.12, 0.06, 0.8, 0.5], [0, 0.15, -0.02, 0.2, 0], [0.1, 0.07, -0.04, 0, -1.2], [-0.1, 0.07, -0.04, 0, 1.2], [0, 0.08, -0.12, -1.0, 0]],
  [[0.04, 0.14, 0.07, 1.1, -0.3], [-0.05, 0.13, 0.08, 1.2, 0.3], [0.11, 0.06, 0.02, 0.3, -1.4], [-0.11, 0.06, 0.02, 0.3, 1.4], [0.03, 0.15, -0.05, -0.4, -0.2], [-0.04, 0.12, -0.1, -0.9, 0.3]],
  [[0, 0.16, 0.0, 0, 0], [0.06, 0.15, 0.02, 0.2, -0.4], [-0.06, 0.15, 0.02, 0.2, 0.4], [0.04, 0.13, -0.08, -0.5, -0.2], [-0.04, 0.13, -0.08, -0.5, 0.2], [0, 0.1, 0.11, 1.3, 0]],
];

export function buildCharacter(look: Look): Rig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const hipsY = DIMS.thigh + DIMS.shin + DIMS.foot;
  const hips = joint(body, 0, hipsY, 0);
  hips.add(at(toonMesh(shared.pelvis, look.secondary), 0, 0.02, 0)).scale.set(1.1, 1, 0.8);

  // Torso
  const spine = joint(hips, 0, 0.08, 0);
  const chest = at(toonMesh(shared.chest, look.primary), 0, 0.2, 0);
  chest.scale.set(1.25, 1, 0.78);
  spine.add(chest);
  const back = new THREE.Mesh(shared.number, toon('#fff', numberTexture(look.number, contrast(look.primary))));
  back.rotation.y = Math.PI;
  spine.add(at(back, 0, 0.24, -0.125));
  const front = new THREE.Mesh(shared.number, toon('#fff', numberTexture(look.number, contrast(look.primary))));
  front.scale.setScalar(0.45);
  spine.add(at(front, 0.07, 0.3, 0.125));

  // Cabeza
  const neck = joint(spine, 0, 0.47, 0);
  neck.add(at(toonMesh(shared.neck, look.skin), 0, 0.03, 0));
  const head = at(toonMesh(shared.head, look.skin), 0, 0.16, 0.01);
  head.scale.set(0.96, 1.08, 1);
  neck.add(head);
  const hair = toonMesh(shared.hairCap, look.hair);
  hair.rotation.x = -0.35;
  head.add(at(hair, 0, 0.012, -0.012));
  for (const [x, y, z, rx, rz] of HAIR_SPIKES[look.hairStyle]) {
    const s = toonMesh(shared.spike, look.hair);
    s.rotation.set(rx, 0, rz);
    head.add(at(s, x, y, z));
  }
  const eyeMat = toon('#fff', eyeTexture(look.eyes));
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(shared.eye, eyeMat);
    eye.rotation.y = side * 0.24;
    head.add(at(eye, side * 0.045, -0.012, 0.126));
  }
  head.add(at(new THREE.Mesh(shared.mouth, toon('#5a2a2a')), 0, -0.07, 0.129));

  // Brazos (L = +x)
  const arm = (side: 1 | -1) => {
    const shoulder = joint(spine, side * 0.2, 0.38, 0);
    shoulder.add(at(toonMesh(shared.sleeve, look.primary), 0, -0.05, 0));
    shoulder.add(at(toonMesh(shared.upperArm, look.skin), 0, -DIMS.upperArm / 2, 0));
    const elbow = joint(shoulder, 0, -DIMS.upperArm, 0);
    elbow.add(at(toonMesh(shared.forearm, look.skin), 0, -DIMS.forearm / 2, 0));
    elbow.add(at(toonMesh(shared.hand, look.skin), 0, -DIMS.forearm, 0));
    return { shoulder, elbow };
  };
  const L = arm(1);
  const R = arm(-1);

  // Piernas
  const leg = (side: 1 | -1) => {
    const hip = joint(hips, side * 0.1, -0.02, 0);
    hip.add(at(toonMesh(shared.shortsLeg, look.secondary), 0, -0.08, 0));
    hip.add(at(toonMesh(shared.thigh, look.skin), 0, -DIMS.thigh / 2, 0));
    const knee = joint(hip, 0, -DIMS.thigh, 0);
    knee.add(at(toonMesh(shared.kneepad, '#f2f2f2'), 0, -0.02, 0.012));
    knee.add(at(toonMesh(shared.shin, look.skin), 0, -DIMS.shin / 2, 0));
    knee.add(at(toonMesh(shared.sock, '#f2f2f2'), 0, -DIMS.shin + 0.06, 0));
    knee.add(at(toonMesh(shared.shoe, '#22252e'), 0, -DIMS.shin - DIMS.foot / 2 + 0.01, 0.05));
    return { hip, knee };
  };
  const LL = leg(1);
  const RL = leg(-1);

  root.traverse((o) => { o.castShadow = false; });
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
