import * as THREE from 'three';
import { COURT, sideSign, type TeamId } from '../sim/court';
import type { PointReason } from '../sim/events';
import type { Simulation } from '../sim/rally';
import { DIMS, SKIN_TONES, buildCharacter, type Look, type Rig } from './character';
import { JOINTS, POSES, blendPose, hipHeight, type Pose } from './pose';
import { toon } from './toon';

/** Ropa de pantalón y manga larga: las mangas "de compresión" en las cuatro extremidades hacen de traje. */
function suit(shirt: string, pants: string, skin: number, hair: string | null): Look {
  return {
    shirt,
    shorts: pants,
    skin: SKIN_TONES[skin],
    hair,
    number: 0,
    name: '',
    armSleeve: { L: true, R: true },
    legSleeve: { L: true, R: true },
    sleeve: pants,
  };
}

function applyPose(rig: Rig, pose: Pose): void {
  for (const j of JOINTS) {
    const e = pose[j];
    rig.joints[j].rotation.set(e ? e[0] : 0, e ? e[1] : 0, e ? e[2] : 0);
  }
  const legL = hipHeight(DIMS.thigh, DIMS.shin, rig.joints.hipL.rotation.x, rig.joints.kneeL.rotation.x);
  const legR = hipHeight(DIMS.thigh, DIMS.shin, rig.joints.hipR.rotation.x, rig.joints.kneeR.rotation.x);
  rig.hips.position.y = DIMS.foot + Math.max(legL, legR);
}

/** Señas: brazo extendido al lado que saca, bandera arriba (fuera), abajo (dentro), arriba sacudiendo (toque). */
const SIGNAL: Record<string, Pose> = {
  stand: { spine: [0.05, 0, 0], shoulderL: [0, 0, 0.12], shoulderR: [0, 0, -0.12], elbowL: [-0.15, 0, 0], elbowR: [-0.15, 0, 0] },
  pointLeft: { spine: [0, 0, 0], shoulderL: [0, 0, 1.5], elbowL: [0, 0, 0], shoulderR: [0, 0, -0.12], elbowR: [-0.15, 0, 0] },
  pointRight: { spine: [0, 0, 0], shoulderR: [0, 0, -1.5], elbowR: [0, 0, 0], shoulderL: [0, 0, 0.12], elbowL: [-0.15, 0, 0] },
  flagUp: { spine: [0, 0, 0], shoulderR: [-3.0, 0, -0.1], elbowR: [0, 0, 0], shoulderL: [0, 0, 0.12], elbowL: [-0.15, 0, 0] },
  flagDown: { spine: [0.15, 0, 0], shoulderR: [-0.5, 0, -0.25], elbowR: [0, 0, 0], shoulderL: [0, 0, 0.12], elbowL: [-0.15, 0, 0] },
  touch: { spine: [0, 0, 0], shoulderR: [-3.0, 0, -0.1], elbowR: [0, 0, 0], shoulderL: [-2.4, 0, 0.3], elbowL: [-1.4, 0, 0] },
  coachClap: { spine: [0.1, 0, 0], shoulderL: [-1.3, 0, -0.35], shoulderR: [-1.3, 0, 0.35], elbowL: [-0.9, 0, 0], elbowR: [-0.9, 0, 0] },
  coachArms: { spine: [0.05, 0, 0], shoulderL: [-0.5, 0, -0.6], shoulderR: [-0.5, 0, 0.6], elbowL: [-1.9, 0, 0], elbowR: [-1.9, 0, 0] },
};

interface Official {
  rig: Rig;
  base: Pose;
  signal: Pose | null;
  until: number;
  /** Para los jueces de línea: esquina que cuidan. */
  corner?: { x: number; z: number };
  coachOf?: TeamId;
}

/**
 * Árbitros y cuerpo técnico: primer árbitro en su silla junto al poste, segundo árbitro del otro lado, cuatro jueces
 * de línea con bandera en las esquinas y un entrenador (DT) por equipo junto a su banca. Hacen las señas de cada punto.
 */
export class Officials {
  readonly group = new THREE.Group();
  private readonly people: Official[] = [];

  constructor(private readonly sim: Simulation) {
    const L = COURT.halfLength;
    const W = COURT.halfWidth;
    const ref = (look: Look, x: number, y: number, z: number, yaw: number, extra: Partial<Official> = {}) => {
      const rig = buildCharacter(look);
      rig.root.position.set(x, y, z);
      rig.root.rotation.y = yaw;
      this.group.add(rig.root);
      const o: Official = { rig, base: SIGNAL.stand, signal: null, until: 0, ...extra };
      this.people.push(o);
      return o;
    };
    // Silla del primer árbitro, del lado lejano junto al poste.
    const chairZ = -(W + 1.6);
    const chair = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.5, 0.8), toon('#3a3f4c'));
    chair.position.set(0, 0.75, chairZ);
    this.group.add(chair);
    ref(suit('#1d2330', '#1d2330', 1, '#1b1512'), 0, 1.5, chairZ, 0);
    // Segundo árbitro, de pie del lado de la cámara.
    ref(suit('#1d2330', '#1d2330', 3, '#3a2618'), 0, 0, W + 1.4, Math.PI);
    // Jueces de línea con bandera, en las cuatro esquinas, mirando la cancha.
    const flagLook = suit('#e9edf3', '#1d2330', 2, null);
    for (const [cx, cz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
      const x = cx * (L + 1.1);
      const z = cz * (W + 0.9);
      const o = ref(flagLook, x, 0, z, Math.atan2(-x, -z), { corner: { x: cx * L, z: cz * W } });
      this.addFlag(o.rig);
    }
    // DT de cada equipo, junto a su banca (del lado de la red), con la camisa del equipo.
    for (const team of ['A', 'B'] as const) {
      const side = team === 'A' ? -1 : 1;
      const color = sim.teams[team].primary;
      ref(suit(color, '#22252c', team === 'A' ? 2 : 4, '#1b1512'), side * 1.75, 0, -6.4, 0, { coachOf: team, base: SIGNAL.coachArms });
    }
    sim.bus.on((e) => {
      // En jugada cerrada señalan lo que vieron (puede estar mal); tras el challenge, lo correcto.
      if (e.type === 'call') this.onPoint(e.calledWinner, e.calledReason, true);
      if (e.type === 'point') this.onPoint(e.winner, e.reason);
    });
  }

  /** Bandera roja y amarilla en la mano derecha del juez de línea. */
  private addFlag(rig: Rig): void {
    const hand = new THREE.Group();
    hand.position.set(0, -DIMS.forearm - 0.04, 0.02);
    rig.joints.elbowR.add(hand);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), toon('#2a2a2a'));
    stick.position.y = -0.2;
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#e01e2d';
    g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#ffd23f';
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(16, 16);
    g.lineTo(0, 16);
    g.fill();
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.25), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    flag.position.set(0, -0.32, 0.15);
    flag.rotation.y = Math.PI / 2;
    hand.add(stick, flag);
  }

  /** Señas del punto: el primer árbitro marca quién saca, el juez de la esquina más cercana dice dentro o fuera. */
  private onPoint(winner: TeamId, reason: PointReason, byCall = false): void {
    const now = performance.now() / 1000;
    const b = this.sim.ballPos;
    const inCourt = !byCall && Math.abs(b.x) <= COURT.halfLength + 0.05 && Math.abs(b.z) <= COURT.halfWidth + 0.05;
    const first = this.people[0];
    // Mirando la cancha desde su silla (z negativo), el equipo A (x negativo) le queda a la derecha.
    first.signal = sideSign(winner) < 0 ? SIGNAL.pointRight : SIGNAL.pointLeft;
    first.until = now + 2.2;
    const judges = this.people.filter((o) => o.corner);
    const nearest = judges.sort((a, c) => len(a.corner!, b) - len(c.corner!, b))[0];
    if (reason === 'blockOut') nearest.signal = SIGNAL.touch;
    else if (reason === 'kill' || reason === 'ace' || reason === 'landed' || reason === 'blockKill' || inCourt) nearest.signal = SIGNAL.flagDown;
    else nearest.signal = SIGNAL.flagUp;
    nearest.until = now + 2.2;
    for (const o of this.people) {
      if (!o.coachOf) continue;
      o.signal = o.coachOf === winner ? SIGNAL.coachClap : null;
      o.until = now + 1.6;
    }
  }

  update(): void {
    const now = performance.now() / 1000;
    for (const o of this.people) {
      // Los DT cambian de banca con su equipo.
      if (o.coachOf) o.rig.root.position.x = sideSign(o.coachOf) * 1.75;
      let pose = o.base;
      if (o.signal && now < o.until) pose = blendPose(o.base, o.signal, Math.min(1, (o.until - now) * 4, (now - (o.until - 2.2)) * 6 + 0.2));
      // Un poco de vida: respiran y el DT camina en su lugar.
      const t = now + o.rig.root.position.x;
      const breathe = Math.sin(t * 1.5) * 0.03;
      const sp = pose.spine ?? [0, 0, 0];
      applyPose(o.rig, { ...pose, spine: [sp[0] + breathe, sp[1] + (o.coachOf ? Math.sin(t * 0.7) * 0.25 : 0), sp[2]] });
    }
  }
}

const len = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** Señas disponibles (para pruebas visuales). */
export const OFFICIAL_POSES = { ...SIGNAL, ready: POSES.ready };
