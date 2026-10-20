import * as THREE from 'three';
import type { ContactKind } from '../sim/events';
import { attackContactHeight, blockReach } from '../sim/players';
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
/** Talón, planta y punta del zapato, en el espacio de la rodilla (ver `buildCharacter`). */
const SOLE_POINTS = [
  new THREE.Vector3(0, -DIMS.shin - DIMS.foot, -0.04),
  new THREE.Vector3(0, -DIMS.shin - DIMS.foot, 0.08),
  new THREE.Vector3(0, -DIMS.shin - DIMS.foot + 0.02, 0.17),
];

export class Animator {
  private readonly tmp = new THREE.Vector3();
  private lastTime: number | null = null;
  private readonly prev = new THREE.Vector3();
  private yaw: number;
  private runPhase = 0;
  private speed = 0;
  private vx = 0;
  private vz = 0;
  private action: Action | null = null;
  /** Pelota en el instante del contacto: los brazos la siguen unos cuadros después del golpe. */
  private contactAim: { target: THREE.Vector3; arms: 'both' | 'right'; at: number } | null = null;
  private mood: { pose: Pose; until: number } | null = null;
  /** `broad`: salto largo hacia la red (ataque de zaguero tipo pipe). */
  private jump: { apex: number; air: number; peak: number; broad?: boolean } | null = null;

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
    const b = this.sim.ballPos;
    if (kind !== 'serve') this.contactAim = { target: new THREE.Vector3(b.x, b.y, b.z), arms: kind === 'attack' ? 'right' : 'both', at: time };
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
    const up = sim.upcoming;
    const block = sim.blockers;
    let active: Action | null = null;
    let aim: { target: THREE.Vector3; arms: 'both' | 'right'; weight: number } | null = null;
    if (up && inPlay && up.key === this.key && up.kind !== 'block') {
      active = { track: trackFor(up.kind, up.point.y < 0.6), at: up.time };
      const target = new THREE.Vector3(up.point.x, up.point.y, up.point.z);
      const lead = up.time - now;
      if (up.kind === 'attack') {
        // Salto justo para que la mano llegue a la pelota en el punto más alto.
        if (!this.jump) {
          // Zaguero (pipe): despega detrás de la línea de 3 m y cae adelante.
          const broad = Math.abs(up.point.x) > 2.9;
          this.startJump(up.time + 0.01, broad ? SPIKE_AIR * 1.3 : SPIKE_AIR, this.liftToReach(TRACKS.spike, 'R', up.point.y, 0.3, 1.9), broad);
        }
        aim = { target, arms: 'right', weight: ease(1 - lead / 0.14) * 0.9 };
      } else if (up.kind === 'set') {
        // Colocación en salto corto si la pelota viene más alta de lo que alcanzan las manos.
        if (!this.jump) {
          const lift = this.liftToReach(TRACKS.set, 'L', up.point.y, 0, 0.45);
          if (lift > 0.05) this.startJump(up.time, 0.55, lift);
        }
        aim = { target, arms: 'both', weight: ease(1 - lead / 0.3) * 0.85 };
      } else {
        aim = { target, arms: 'both', weight: ease(1 - lead / 0.35) * 0.95 };
      }
    } else if (block && inPlay && block.keys.includes(this.key)) {
      const apex = block.attackTime + BLOCK_DELAY;
      // Se guarda como gesto propio: la simulación libera el bloqueo al rematar, pero el salto debe terminar.
      if (this.action?.track !== TRACKS.block || Math.abs(this.action.at - apex) > 0.05) this.action = { track: TRACKS.block, at: apex };
      active = this.action;
      // Manos hasta el alcance real del bloqueador (estatura y salto): el mismo que usa la simulación.
      if (!this.jump && up?.kind === 'attack') this.startJump(apex, BLOCK_AIR, this.liftToReach(TRACKS.block, 'L', blockReach(p.def), 0.2, 1.1));
    } else if (inPlay && sim.decoy?.key === this.key) {
      // Finta del central: carrera y salto de rápida completos, sin pelota.
      const decoy = sim.decoy;
      if (this.action?.track !== TRACKS.spike || Math.abs(this.action.at - decoy.time) > 0.05) this.action = { track: TRACKS.spike, at: decoy.time };
      active = this.action;
      if (!this.jump) this.startJump(decoy.time + 0.01, SPIKE_AIR, this.liftToReach(TRACKS.spike, 'R', attackContactHeight(p.def) - 0.1, 0.3, 1.6));
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
    let drift = 0;
    if (this.jump) {
      lift = jumpOffset(now, this.jump.apex, this.jump.air, this.jump.peak);
      // Salto largo tipo Nishida: despega muy atrás de la línea, golpea en su punto y cae adelante.
      if (this.jump.broad) {
        const u = Math.max(-0.5, Math.min(0.5, (now - this.jump.apex) / this.jump.air));
        drift = u < 0 ? u * 2.4 : u * 1.2;
      }
      if (now > this.jump.apex + this.jump.air / 2) this.jump = null;
    }
    this.rig.body.position.y = lift;
    this.rig.body.position.z = drift;
    this.keepFeetAboveFloor();

    // ---- Orientación ----
    let targetYaw: number;
    const b = sim.ballPos;
    if (!onCourt) targetYaw = 0;
    else if (sim.phase === 'preServe') {
      // Antes del saque: el equipo que saca mira a la red; el que recibe mira al sacador.
      targetYaw = sim.match.serving === p.team ? this.netYaw() : Math.atan2(b.x - p.pos.x, b.z - p.pos.z);
    } else if (block && block.keys.includes(this.key)) targetYaw = this.netYaw();
    else if ((up && up.key === this.key && up.kind === 'attack') || sim.decoy?.key === this.key) targetYaw = this.netYaw();
    else if (this.speed > 2.6 && !(up && up.key === this.key && up.kind === 'attack')) targetYaw = Math.atan2(this.vx, this.vz);
    else targetYaw = Math.atan2(b.x - p.pos.x, b.z - p.pos.z);
    let diff = targetYaw - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * Math.min(1, dt * 8 || 1);
    this.rig.root.position.set(p.pos.x, 0, p.pos.z);
    this.rig.root.rotation.y = this.yaw;

    // El bloqueador principal lleva las manos a la pelota justo al cruzar la red.
    if (up && inPlay && up.kind === 'block' && up.key === this.key && up.point.y > 2.55) {
      aim = { target: new THREE.Vector3(up.point.x, up.point.y, up.point.z), arms: 'both', weight: ease(1 - (up.time - now) / 0.12) * 0.8 };
    }
    if (!aim && this.contactAim) {
      const since = now - this.contactAim.at;
      if (since < 0.12) aim = { target: this.contactAim.target, arms: this.contactAim.arms, weight: (1 - since / 0.12) * 0.9 };
      else this.contactAim = null;
    }
    if (aim) this.aimArms(aim.target, aim.arms, aim.weight);
  }

  /**
   * Cuánto hay que saltar para que la mano (L o R) llegue a `height` en la pose del momento clave de la pista.
   * Aplica esa pose un instante para medir con cinemática directa; la pose real se aplica después en el cuadro.
   */
  private liftToReach(track: readonly Key[], side: 'L' | 'R', height: number, min: number, max: number): number {
    this.applyPose(sampleTrack(track, 0));
    this.rig.body.position.y = 0;
    this.rig.root.updateMatrixWorld(true);
    const hand = this.rig.joints[`elbow${side}`].localToWorld(new THREE.Vector3(0, -DIMS.forearm - 0.05, 0));
    // El salto se aplica dentro de la raíz, que está escalada según la estatura.
    return Math.min(max, Math.max(min, height - hand.y)) / this.rig.root.scale.y;
  }

  /**
   * Los pies no atraviesan el piso: con la rodilla doblada o el pie inclinado, la punta o el talón bajarían de 0.
   * Mide talón, planta y punta de cada zapato (en el espacio de la raíz) y sube el cuerpo lo que falte.
   */
  private keepFeetAboveFloor(): void {
    const { body, root, joints } = this.rig;
    body.updateMatrixWorld(true);
    let min = Infinity;
    for (const knee of [joints.kneeL, joints.kneeR]) {
      for (const sole of SOLE_POINTS) {
        const p = root.worldToLocal(knee.localToWorld(this.tmp.copy(sole)));
        min = Math.min(min, p.y);
      }
    }
    if (min < 0) body.position.y -= min;
  }

  /** Mirando a la red: el equipo A hacia +x, el B hacia −x. */
  private netYaw(): number {
    return this.sim.player(this.key).team === 'A' ? Math.PI / 2 : -Math.PI / 2;
  }

  private startJump(apex: number, air: number, peak: number, broad = false): void {
    const j = this.jump;
    if (j && Math.abs(j.apex - apex) < 0.05) return;
    // No reiniciar un salto que ya está en el aire.
    if (j && this.sim.time > j.apex - j.air / 2 && this.sim.time < j.apex + j.air / 2) return;
    this.jump = { apex, air, peak, broad };
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

  /** Apunta el brazo (o ambos) hacia la pelota en el contacto: plataforma en la recepción, mano en el remate. */
  private aimArms(target: THREE.Vector3, arms: 'both' | 'right', weight: number): void {
    if (weight <= 0) return;
    this.rig.root.updateMatrixWorld(true);
    for (const s of arms === 'both' ? (['L', 'R'] as const) : (['R'] as const)) {
      const shoulder = this.rig.joints[`shoulder${s}`];
      const local = shoulder.parent!.worldToLocal(target.clone()).sub(shoulder.position);
      if (local.lengthSq() < 1e-6) continue;
      shoulder.quaternion.slerp(new THREE.Quaternion().setFromUnitVectors(DOWN, local.normalize()), weight);
    }
  }
}
