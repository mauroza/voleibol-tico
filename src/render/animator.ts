import * as THREE from 'three';
import type { ContactKind } from '../sim/events';
import type { Simulation } from '../sim/rally';
import { DIMS, type Rig } from './character';
import { JOINTS, POSES, TRACKS, blendPose, ease, hipHeight, jumpOffset, runPose, sampleTrack, shufflePose, type Key, type Pose } from './pose';

const DOWN = new THREE.Vector3(0, -1, 0);
/** El remate llega al ápice justo en el contacto; el bloqueo, un instante después del remate rival. */
const SPIKE_AIR = 0.82;
const BLOCK_AIR = 0.64;
const BLOCK_DELAY = 0.12;

/** Gesto en curso: una pista anclada a un instante clave de la simulación. */
interface Action {
  track: readonly Key[];
  at: number;
}

const trackFor = (kind: ContactKind, low: boolean): readonly Key[] => {
  switch (kind) {
    case 'attack': return TRACKS.spike;
    case 'set': return TRACKS.set;
    case 'block': return TRACKS.block;
    case 'serve': return TRACKS.serve;
    default: return low ? TRACKS.dive : TRACKS.bump;
  }
};

/**
 * Anima un personaje a partir del estado de la simulación, en tiempo de simulación (la cámara lenta también
 * ralentiza la animación). Prioridad: el gesto del próximo contacto propio, luego el bloqueo preparado, luego el
 * gesto que sigue al último contacto, y por debajo la locomoción.
 */
export class Animator {
  private lastTime: number | null = null;
  private readonly prev = new THREE.Vector3();
  private yaw: number;
  private runPhase = 0;
  private speed = 0;
  private vx = 0;
  private vz = 0;
  private action: Action | null = null;
  private mood: { pose: Pose; until: number } | null = null;
  private jump: { apex: number; air: number; peak: number } | null = null;

  constructor(
    readonly key: string,
    readonly rig: Rig,
    private readonly sim: Simulation,
  ) {
    const p = sim.player(key);
    this.prev.set(p.pos.x, 0, p.pos.z);
    this.yaw = this.netYaw();
  }

  onContact(kind: ContactKind, time: number): void {
    this.action = { track: trackFor(kind, this.sim.ballPos.y < 0.6), at: time };
  }

  onPoint(won: boolean, time: number): void {
    this.mood = { pose: won ? POSES.celebrate : POSES.sad, until: time + 1.4 };
  }

  update(): void {
    const sim = this.sim;
    const now = sim.time;
    const p = sim.player(this.key);
    const dt = this.lastTime === null ? 0 : Math.max(0, now - this.lastTime);
    this.lastTime = now;

    // Velocidad (suavizada) y ciclo de pasos
    const dx = p.pos.x - this.prev.x;
    const dz = p.pos.z - this.prev.z;
    this.prev.set(p.pos.x, 0, p.pos.z);
    const teleport = Math.hypot(dx, dz) > 1;
    const k = Math.min(1, dt * 12);
    this.vx += ((dt > 0 && !teleport ? dx / dt : 0) - this.vx) * k;
    this.vz += ((dt > 0 && !teleport ? dz / dt : 0) - this.vz) * k;
    this.speed = Math.hypot(this.vx, this.vz);
    this.runPhase += dt * (6 + this.speed * 2.2);

    const court = sim.court(p.team);
    const onCourt = court.includes(this.key);
    const inPlay = sim.phase === 'inPlay';

    // ---- Locomoción ----
    let pose: Pose = onCourt ? POSES.ready : POSES.idle;
    if (this.speed > 0.3) {
      const fwd = this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
      const side = this.vx * Math.cos(this.yaw) - this.vz * Math.sin(this.yaw);
      const amount = Math.min(1, this.speed / 1.2);
      const gait = Math.abs(side) > Math.abs(fwd) * 1.2
        ? shufflePose(this.runPhase, Math.min(1, this.speed / 3))
        : runPose(this.runPhase, Math.max(0.4, Math.min(1, this.speed / 5)), fwd < 0 ? -1 : 1);
      pose = blendPose(pose, gait, amount);
    }

    // ---- Gesto técnico ----
    const peak = 0.5 + 0.35 * (p.def.attrs.jump / 100);
    const up = sim.upcoming;
    const block = sim.blockers;
    let active: Action | null = null;
    let aim: THREE.Vector3 | null = null;
    if (up && inPlay && up.key === this.key && up.kind !== 'block') {
      active = { track: trackFor(up.kind, up.point.y < 0.6), at: up.time };
      if (up.kind === 'attack') this.startJump(up.time + 0.01, SPIKE_AIR, peak);
      if (up.kind === 'reception' || up.kind === 'dig' || up.kind === 'free') aim = new THREE.Vector3(up.point.x, up.point.y, up.point.z);
    } else if (block && inPlay && block.keys.includes(this.key)) {
      const apex = block.attackTime + BLOCK_DELAY;
      // Se guarda como gesto propio: la simulación libera el bloqueo al rematar, pero el salto debe terminar.
      if (this.action?.track !== TRACKS.block || Math.abs(this.action.at - apex) > 0.05) this.action = { track: TRACKS.block, at: apex };
      active = this.action;
      this.startJump(apex, BLOCK_AIR, peak * 0.7);
    } else if (sim.phase === 'preServe' && court[0] === this.key && sim.match.serving === p.team) {
      // Sacador: lanzamiento sincronizado con el saque de la IA; con el usuario, pelota en la mano hasta que decida.
      const countdown = sim.serveCountdown;
      active = { track: TRACKS.serve, at: countdown === null ? Infinity : now + countdown };
    } else if (this.action) {
      active = this.action;
    }

    if (active) {
      const [start, end] = [active.track[0].t, active.track[active.track.length - 1].t];
      const rel = active.at === Infinity ? start : now - active.at;
      if (rel <= end) {
        // Entrada suave al gesto durante 0.15 s antes de su primer keyframe.
        const w = ease((rel - start + 0.15) / 0.15);
        if (w > 0) pose = blendPose(pose, sampleTrack(active.track, rel), w);
      } else if (active === this.action) {
        this.action = null;
      }
    }

    // ---- Celebración o lamento entre rallies ----
    if (this.mood) {
      if (now < this.mood.until && !inPlay && onCourt) pose = blendPose(pose, this.mood.pose, 0.85);
      else if (now >= this.mood.until) this.mood = null;
    }

    this.applyPose(pose);

    // ---- Salto ----
    let lift = 0;
    if (this.jump) {
      lift = jumpOffset(now, this.jump.apex, this.jump.air, this.jump.peak);
      if (now > this.jump.apex + this.jump.air / 2) this.jump = null;
    }
    this.rig.body.position.y = lift;

    // ---- Orientación ----
    let targetYaw: number;
    const b = sim.ballPos;
    if (!onCourt) targetYaw = 0;
    else if (sim.phase === 'preServe') {
      // Antes del saque: el equipo que saca mira a la red; el que recibe mira al sacador.
      targetYaw = sim.match.serving === p.team ? this.netYaw() : Math.atan2(b.x - p.pos.x, b.z - p.pos.z);
    } else if (block && block.keys.includes(this.key)) targetYaw = this.netYaw();
    else if (this.speed > 2.6 && !(up && up.key === this.key && up.kind === 'attack')) targetYaw = Math.atan2(this.vx, this.vz);
    else targetYaw = Math.atan2(b.x - p.pos.x, b.z - p.pos.z);
    let diff = targetYaw - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * Math.min(1, dt * 8 || 1);
    this.rig.root.position.set(p.pos.x, 0, p.pos.z);
    this.rig.root.rotation.y = this.yaw;

    if (aim && up) this.aimArms(aim, ease(1 - (up.time - now) / 0.4) * 0.5);
  }

  /** Mirando a la red: el equipo A hacia +x, el B hacia −x. */
  private netYaw(): number {
    return this.sim.player(this.key).team === 'A' ? Math.PI / 2 : -Math.PI / 2;
  }

  private startJump(apex: number, air: number, peak: number): void {
    const j = this.jump;
    if (j && Math.abs(j.apex - apex) < 0.05) return;
    // No reiniciar un salto que ya está en el aire.
    if (j && this.sim.time > j.apex - j.air / 2 && this.sim.time < j.apex + j.air / 2) return;
    this.jump = { apex, air, peak };
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

  /** Lleva la plataforma de los brazos hacia la pelota en la recepción. */
  private aimArms(target: THREE.Vector3, weight: number): void {
    if (weight <= 0) return;
    this.rig.root.updateMatrixWorld(true);
    for (const s of ['L', 'R'] as const) {
      const shoulder = this.rig.joints[`shoulder${s}`];
      const local = shoulder.parent!.worldToLocal(target.clone()).sub(shoulder.position);
      if (local.lengthSq() < 1e-6) continue;
      shoulder.quaternion.slerp(new THREE.Quaternion().setFromUnitVectors(DOWN, local.normalize()), weight);
    }
  }
}
