import * as THREE from 'three';
import type { ContactKind } from '../sim/events';
import { isFrontIndex } from '../sim/match';
import type { Simulation } from '../sim/rally';
import { DIMS, type Rig } from './character';
import { JOINTS, POSES, blendPose, ease, hipHeight, jumpOffset, runPose, type Pose, type PoseName } from './pose';

const FOLLOW: Record<ContactKind, PoseName> = {
  serve: 'serveHit',
  reception: 'bump',
  dig: 'bump',
  set: 'set',
  attack: 'spikeHit',
  block: 'block',
  free: 'bump',
};
const FOLLOW_TIME = 0.35;
const DOWN = new THREE.Vector3(0, -1, 0);

/** Brazos a apuntar hacia un punto (mundo) con un peso 0..1. */
interface ArmAim {
  target: THREE.Vector3;
  arms: 'both' | 'right';
  weight: number;
}

/**
 * Anima un personaje a partir del estado de la simulación. Todo se mide en tiempo de simulación,
 * así que la cámara lenta también ralentiza la animación.
 */
export class Animator {
  private lastTime: number | null = null;
  private readonly prev = new THREE.Vector3();
  private yaw: number;
  private runPhase = 0;
  private speed = 0;
  private follow: { pose: PoseName; until: number } | null = null;
  private mood: { pose: PoseName; until: number } | null = null;
  private jump: { apex: number; air: number; peak: number } | null = null;

  constructor(
    readonly key: string,
    readonly rig: Rig,
    private readonly sim: Simulation,
  ) {
    const p = sim.player(key);
    this.prev.set(p.pos.x, 0, p.pos.z);
    this.yaw = p.team === 'A' ? Math.PI / 2 : -Math.PI / 2;
  }

  onContact(kind: ContactKind, time: number): void {
    const low = this.sim.ballPos.y < 0.6;
    this.follow = { pose: low && (kind === 'dig' || kind === 'reception') ? 'dive' : FOLLOW[kind], until: time + FOLLOW_TIME };
  }

  onPoint(won: boolean, time: number): void {
    this.mood = { pose: won ? 'celebrate' : 'sad', until: time + 1.4 };
  }

  update(): void {
    const sim = this.sim;
    const now = sim.time;
    const p = sim.player(this.key);
    const dt = this.lastTime === null ? 0 : Math.max(0, now - this.lastTime);
    this.lastTime = now;

    // Velocidad y ciclo de carrera
    const dx = p.pos.x - this.prev.x;
    const dz = p.pos.z - this.prev.z;
    this.prev.set(p.pos.x, 0, p.pos.z);
    const moved = Math.hypot(dx, dz);
    const raw = dt > 0 && moved < 1 ? moved / dt : 0; // un salto grande = reposición entre rallies
    this.speed += (raw - this.speed) * Math.min(1, dt * 12);
    this.runPhase += dt * (5 + this.speed * 1.8);

    const court = sim.court(p.team);
    const idx = court.indexOf(this.key);
    const onCourt = idx >= 0;
    let pose: Pose = onCourt ? POSES.ready : POSES.idle;
    if (this.speed > 0.3) {
      pose = blendPose(pose, runPose(this.runPhase, Math.max(0.35, Math.min(1, this.speed / 4))), Math.min(1, this.speed / 1.5));
    }

    let aim: ArmAim | null = null;
    const up = sim.upcoming;
    const inPlay = sim.phase === 'inPlay';
    const jumpPeak = 0.5 + 0.35 * (p.def.attrs.jump / 100);

    // Anticipación del contacto propio
    if (up && inPlay && up.key === this.key) {
      const lead = up.time - now;
      const target = new THREE.Vector3(up.point.x, up.point.y, up.point.z);
      switch (up.kind) {
        case 'attack':
          this.startJump(up.time, 0.9, jumpPeak);
          pose = blendPose(pose, lead > 0.16 ? POSES.spikeLoad : POSES.spikeHit, ease(1 - lead / 0.7));
          if (lead < 0.2) aim = { target, arms: 'right', weight: ease(1 - lead / 0.2) * 0.7 };
          break;
        case 'set':
          pose = blendPose(pose, POSES.set, ease(1 - lead / 0.6));
          break;
        case 'block':
          this.startJump(up.time, 0.7, jumpPeak * 0.75);
          pose = blendPose(pose, POSES.block, ease(1 - lead / 0.45));
          break;
        default:
          pose = blendPose(pose, up.point.y < 0.6 ? POSES.dive : POSES.bump, ease(1 - lead / 0.6));
          aim = { target, arms: 'both', weight: ease(1 - lead / 0.5) * 0.8 };
      }
    }

    // Bloqueo como delantero ante el remate rival
    if (up && inPlay && onCourt && up.kind === 'attack' && up.team !== p.team && isFrontIndex(idx) && p.def.role !== 'L'
      && Math.abs(p.pos.z - up.point.z) < 2.2) {
      const apex = up.time + 0.12;
      this.startJump(apex, 0.7, jumpPeak * 0.75);
      pose = blendPose(pose, POSES.block, ease(1 - (apex - now) / 0.5));
    }

    // Saque: preparación con la pelota
    if (sim.phase === 'preServe' && court[0] === this.key && sim.match.serving === p.team) {
      pose = blendPose(pose, POSES.serveToss, 0.85);
    }

    // Gesto posterior al contacto
    if (this.follow) {
      if (now < this.follow.until) pose = blendPose(pose, POSES[this.follow.pose], ease((this.follow.until - now) / FOLLOW_TIME * 1.6));
      else this.follow = null;
    }

    // Celebración o lamento entre rallies
    if (this.mood) {
      if (now < this.mood.until && !inPlay && onCourt) pose = blendPose(pose, POSES[this.mood.pose], 0.9);
      else if (now >= this.mood.until) this.mood = null;
    }

    this.applyPose(pose);

    // Salto
    let lift = 0;
    if (this.jump) {
      lift = jumpOffset(now, this.jump.apex, this.jump.air, this.jump.peak);
      if (now > this.jump.apex + this.jump.air / 2) this.jump = null;
    }
    this.rig.body.position.y = lift;

    // Orientación
    let targetYaw: number;
    if (!onCourt) targetYaw = 0;
    else if (this.speed > 2.4) targetYaw = Math.atan2(dx, dz);
    else {
      const b = sim.ballPos;
      targetYaw = Math.atan2(b.x - p.pos.x, b.z - p.pos.z);
    }
    let diff = targetYaw - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * Math.min(1, dt * 10 || 1);
    this.rig.root.position.set(p.pos.x, 0, p.pos.z);
    this.rig.root.rotation.y = this.yaw;

    if (aim && aim.weight > 0) this.aimArms(aim);
  }

  private startJump(apex: number, air: number, peak: number): void {
    if (!this.jump || Math.abs(this.jump.apex - apex) > 0.05) {
      // No reiniciar un salto ya en el aire hacia otro ápice cercano.
      if (this.jump && this.sim.time > this.jump.apex - this.jump.air / 2 && this.sim.time < this.jump.apex + this.jump.air / 2) return;
      this.jump = { apex, air, peak };
    }
  }

  private applyPose(pose: Pose): void {
    for (const j of JOINTS) {
      const e = pose[j];
      this.rig.joints[j].rotation.set(e ? e[0] : 0, e ? e[1] : 0, e ? e[2] : 0);
    }
    const legL = hipHeight(DIMS.thigh, DIMS.shin, this.rig.joints.hipL.rotation.x, this.rig.joints.kneeL.rotation.x);
    const legR = hipHeight(DIMS.thigh, DIMS.shin, this.rig.joints.hipR.rotation.x, this.rig.joints.kneeR.rotation.x);
    this.rig.hips.position.y = DIMS.foot + Math.max(legL, legR);
  }

  /** Apunta los brazos estirados hacia el objetivo (recepción, remate). */
  private aimArms(aim: ArmAim): void {
    this.rig.root.updateMatrixWorld(true);
    const sides = aim.arms === 'both' ? (['L', 'R'] as const) : (['R'] as const);
    for (const s of sides) {
      const shoulder = this.rig.joints[`shoulder${s}`];
      const elbow = this.rig.joints[`elbow${s}`];
      const local = shoulder.parent!.worldToLocal(aim.target.clone()).sub(shoulder.position);
      if (local.lengthSq() < 1e-6) continue;
      const q = new THREE.Quaternion().setFromUnitVectors(DOWN, local.normalize());
      shoulder.quaternion.slerp(q, aim.weight);
      elbow.rotation.x *= 1 - aim.weight;
    }
  }
}
