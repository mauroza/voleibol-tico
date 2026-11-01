import * as THREE from 'three';
import { COURT, sideSign, type TeamId } from '../sim/court';
import type { ContactKind } from '../sim/events';
import { attackContactHeight, blockReach } from '../sim/players';
import { TUNING } from '../sim/tuning';
import type { Simulation } from '../sim/rally';
import { type Dims, type Rig } from './character';
import { JOINTS, POSES, TRACKS, blendPose, framePose, ease, hipHeight, jumpOffset, runPose, sampleTrack, shufflePose, walkPose, type Euler3, type Key, type Pose } from './pose';

/** Por debajo de esto está quieto; hasta WALK_MAX camina, más rápido corre (m/s). */
const MOVING = 0.1;
const NET_PROBE = new THREE.Vector3();
/** Respiración del cuadro (se reutiliza). */
const BREATH: { spine: Euler3 } = { spine: [0, 0, 0] };
/** Brazo del lado de la red, abierto hacia el costado y arriba, palma hacia el rival que pasa del otro lado. */
const HIGH_FIVE: Record<'L' | 'R', Pose> = {
  L: { shoulderL: [-0.55, 0, 2.15], elbowL: [-0.55, 0, 0] },
  R: { shoulderR: [-0.55, 0, -2.15], elbowR: [-0.55, 0, 0] },
};
const WALK_MAX = 2.2;

const DOWN = new THREE.Vector3(0, -1, 0);
/** El remate llega al ápice justo en el contacto; el bloqueo, un instante después del remate rival. */
const SPIKE_AIR = 0.82;
const BLOCK_AIR = 0.64;
const BLOCK_DELAY = 0.12;
/** Del ESPACIO al punto más alto del salto del bloqueo (s de juego). */
const BLOCK_RISE = 0.27;

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
/** Distancia horizontal del cuerpo a las manos en la plancha (brazos estirados al frente). */
const DIVE_HANDS = 1.05;

/** Talón, planta y punta del zapato, en el espacio de la rodilla (ver `buildCharacter`): según las medidas del jugador. */
const solePoints = (D: Dims): THREE.Vector3[] => [
  new THREE.Vector3(0, -D.shin - D.foot, -0.06),
  new THREE.Vector3(0, -D.shin - D.foot, 0.08),
  new THREE.Vector3(0, -D.shin - D.foot + 0.02, 0.18),
];

export class Animator {
  private readonly tmp = new THREE.Vector3();
  private soles: THREE.Vector3[] = [];
  private dive: { at: number; point: { x: number; z: number }; reach: number; dir: { x: number; z: number } } | null = null;
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
  /**
   * Golpe con la mano (remate y saque): dónde y cuándo la mano tiene que tocar la pelota. Alrededor de ese instante el
   * cuerpo se acomoda lo justo para que la mano llegue exacto a la pelota (antes a veces le pegaba al aire).
   */
  private strike: { target: THREE.Vector3; at: number } | null = null;
  private readonly hand = new THREE.Vector3();
  /** Salto de bloqueo de una persona ya visto: su instante y el punto más alto con que se dibuja. */
  private seenJump: { at: number; apex: number } | null = null;

  constructor(
    readonly key: string,
    readonly rig: Rig,
    private readonly sim: Simulation,
  ) {
    const p = sim.player(key);
    this.soles = solePoints(rig.dims);
    this.prev.set(p.pos.x, 0, p.pos.z);
    this.yaw = this.netYaw();
  }

  onContact(kind: ContactKind, time: number, point?: { x: number; y: number; z: number }): void {
    const b = point ?? this.sim.ballPos;
    const plancha = !!this.dive && Math.abs(this.dive.at - time) < 0.1;
    if (kind !== 'serve') this.contactAim = { target: new THREE.Vector3(b.x, b.y, b.z), arms: kind === 'attack' ? 'right' : 'both', at: time };
    if (kind !== 'attack' && kind !== 'serve') this.strike = null;
    this.action = { track: plancha ? TRACKS.plancha : trackFor(kind, this.sim.ballPos.y < 0.6), at: time };
  }

  /**
   * Plancha: el cuerpo se lanza desde la posición del jugador hacia la pelota hasta que las manos llegan,
   * se queda estirado en el piso un momento y vuelve al levantarse.
   */
  private diveOffset(now: number, px: number, pz: number): { x: number; z: number } {
    const d = this.dive;
    if (!d) return { x: 0, z: 0 };
    const rel = now - d.at;
    if (rel > 1.35) {
      this.dive = null;
      return { x: 0, z: 0 };
    }
    if (rel <= 0) {
      // Hasta el contacto: lo que falta para que las manos (a ~1.1 m del cuerpo estirado) lleguen a la pelota.
      const dx = d.point.x - px;
      const dz = d.point.z - pz;
      const dist = Math.hypot(dx, dz) || 1;
      d.reach = Math.max(-0.4, dist - DIVE_HANDS);
      d.dir = { x: dx / dist, z: dz / dist };
    }
    const w = rel <= 0 ? ease(1 - Math.min(1, -rel / 0.3)) : rel < 0.6 ? 1 : 1 - ease((rel - 0.6) / 0.75);
    return { x: d.dir.x * d.reach * w, z: d.dir.z * d.reach * w };
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
    const k = Math.min(1, dt * 20);
    this.vx += ((dt > 0 && !teleport ? dx / dt : 0) - this.vx) * k;
    this.vz += ((dt > 0 && !teleport ? dz / dt : 0) - this.vz) * k;
    this.speed = Math.hypot(this.vx, this.vz);
    // Los pies van al ritmo de lo que avanza el cuerpo (nada de deslizarse): un ciclo de dos pasos cada `cycle` metros.
    const fwd = this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
    const side = this.vx * Math.cos(this.yaw) - this.vz * Math.sin(this.yaw);
    const sideways = Math.abs(side) > Math.abs(fwd) * 1.2;
    const cycle = sideways ? 1.1 : this.speed < WALK_MAX ? 1.3 : Math.min(2.6, 1.3 + (this.speed - WALK_MAX) * 0.4);
    this.runPhase += (dt * 2 * Math.PI * this.speed) / cycle;

    const court = sim.court(p.team);
    const onCourt = court.includes(this.key);
    // En el calentamiento también hay pases, colocaciones y remates.
    const inPlay = sim.phase === 'inPlay' || sim.phase === 'warmup';

    // ---- Locomoción ----
    // En la banca, sentados (salvo en el calentamiento, que hacen fila); en cancha, listos.
    // En la previa y los cambios de cancha están de pie, relajados.
    const ceremony = sim.ceremony;
    const benched = !onCourt && sim.playing && this.speed < MOVING;
    let pose: Pose = ceremony ? POSES.idle : onCourt ? POSES.ready : benched ? POSES.sit : POSES.idle;
    if (this.speed > MOVING) {
      const dir = fwd < 0 ? -1 : 1;
      // Lento: camina; rápido: corre (con mezcla entre los dos para que no salte de un paso al otro).
      const walk = walkPose(this.runPhase, Math.min(1, 0.45 + this.speed / 1.6), dir);
      const run = runPose(this.runPhase, Math.max(0.45, Math.min(1, this.speed / 5)), dir);
      const gait = sideways
        ? shufflePose(this.runPhase, Math.min(1, 0.4 + this.speed / 3))
        : blendPose(walk, run, Math.max(0, Math.min(1, (this.speed - WALK_MAX) / 1.2)));
      pose = blendPose(pose, gait, Math.min(1, this.speed / 0.35));
    }

    // ---- Gesto técnico ----
    // En el calentamiento cada equipo tiene su propia jugada (dos balones).
    const up = sim.phase === 'warmup' ? sim.upcomingFor(this.key) : sim.upcoming;
    const block = sim.blockers;
    let active: Action | null = null;
    let aim: { target: THREE.Vector3; arms: 'both' | 'right'; weight: number } | null = null;
    if (up && inPlay && up.key === this.key && up.kind !== 'block') {
      if (up.dive && (!this.dive || Math.abs(this.dive.at - up.time) > 0.05)) {
        this.dive = { at: up.time, point: { x: up.point.x, z: up.point.z }, reach: 0, dir: { x: 0, z: 0 } };
      }
      active = { track: up.dive ? TRACKS.plancha : trackFor(up.kind, up.point.y < 0.6), at: up.time };
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
        this.strike = { target, at: up.time };
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
    } else if (block && inPlay && block.keys.includes(this.key) && sim.humans.has(p.team)) {
      // Bloqueo de una persona: listos en la red con los brazos arriba; saltan cuando toca ESPACIO. Online, en la
      // pantalla de quien salta se dibuja al instante; en la del rival, si la tecla llega tarde, el salto arranca ahí
      // (sin aparecer ya en el aire).
      const local = p.team === sim.control && sim.localJumpAt !== null ? sim.localJumpAt : null;
      const jump = sim.blockJump(p.team) ?? (local !== null ? { at: local } : null);
      if (!jump) active = { track: TRACKS.block, at: Infinity };
      else {
        if (this.seenJump?.at !== jump.at) this.seenJump = { at: jump.at, apex: Math.max(jump.at + BLOCK_RISE, now + BLOCK_RISE * 0.7) };
        const apex = this.seenJump.apex;
        if (this.action?.track !== TRACKS.block || Math.abs(this.action.at - apex) > 0.05) this.action = { track: TRACKS.block, at: apex };
        active = this.action;
        if (!this.jump) this.startJump(apex, BLOCK_AIR, this.liftToReach(TRACKS.block, 'L', blockReach(p.def), 0.2, 1.1));
      }
    } else if (block && inPlay && block.keys.includes(this.key)) {
      const apex = block.attackTime + BLOCK_DELAY;
      // Se guarda como gesto propio: la simulación libera el bloqueo al rematar, pero el salto debe terminar.
      if (this.action?.track !== TRACKS.block || Math.abs(this.action.at - apex) > 0.05) this.action = { track: TRACKS.block, at: apex };
      active = this.action;
      // Manos hasta el alcance real del bloqueador (estatura y salto): el mismo que usa la simulación.
      if (!this.jump && up?.kind === 'attack') this.startJump(apex, BLOCK_AIR, this.liftToReach(TRACKS.block, 'L', blockReach(p.def), 0.2, 1.1));
    } else if (inPlay && sim.decoyBite?.key === this.key) {
      // Se comió la finta: salta a bloquear la rápida que nunca llega.
      const bite = sim.decoyBite;
      if (this.action?.track !== TRACKS.block || Math.abs(this.action.at - bite.time) > 0.05) this.action = { track: TRACKS.block, at: bite.time };
      active = this.action;
      if (!this.jump) this.startJump(bite.time + 0.05, BLOCK_AIR, this.liftToReach(TRACKS.block, 'L', blockReach(p.def), 0.2, 1.1));
    } else if (inPlay && sim.decoy?.key === this.key) {
      // Finta del central: carrera y salto de rápida completos, sin pelota.
      const decoy = sim.decoy;
      if (this.action?.track !== TRACKS.spike || Math.abs(this.action.at - decoy.time) > 0.05) this.action = { track: TRACKS.spike, at: decoy.time };
      active = this.action;
      if (!this.jump) this.startJump(decoy.time + 0.01, SPIKE_AIR, this.liftToReach(TRACKS.spike, 'R', attackContactHeight(p.def) - 0.1, 0.3, 1.6));
    } else if (sim.phase === 'preServe' && court[0] === this.key && sim.match.serving === p.team) {
      // Sacador: con el usuario, pelota en la mano hasta que decida; después, la secuencia del tipo de saque.
      const seq = sim.serveSequence;
      if (!seq) active = { track: TRACKS.serve, at: Infinity };
      else if (seq.type === 'safe') active = { track: TRACKS.serve, at: seq.contactTime };
      else {
        // Suspensión: gesto de remate con salto largo; flotado: saltito y brazo seco.
        const jump = seq.type === 'jump';
        const track = jump ? TRACKS.spike : TRACKS.serveFloat;
        if (this.action?.track !== track || Math.abs(this.action.at - seq.contactTime) > 0.05) this.action = { track, at: seq.contactTime };
        active = this.action;
        if (!this.jump && seq.contactTime - now < 0.5) {
          const h = TUNING.serve[seq.type].contactHeight;
          this.startJump(seq.contactTime + 0.01, jump ? SPIKE_AIR * 1.15 : 0.5, this.liftToReach(track, 'R', h, jump ? 0.4 : 0.1, jump ? 1.5 : 0.5), jump);
        }
        // La pelota se golpea donde la lanza la simulación: 30 cm delante del sacador, a la altura del saque.
        const target = new THREE.Vector3(p.pos.x - sideSign(p.team) * 0.3, TUNING.serve[seq.type].contactHeight, p.pos.z);
        this.strike = { target, at: seq.contactTime };
        aim = { target, arms: 'right', weight: ease(1 - (seq.contactTime - now) / 0.16) * 0.9 };
      }
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
      // También la banca festeja de pie (o se lamenta) cada punto.
      if (now < this.mood.until && !inPlay) pose = blendPose(pose, this.mood.pose, onCourt ? 0.85 : 0.7);
      else if (now >= this.mood.until) this.mood = null;
    }

    // Saludo en la red: choca la mano con el rival que pasa enfrente.
    if (ceremony?.step === 'greeting' && ceremony.sub === 1) {
      let near = Infinity;
      for (const o of sim.players.values()) {
        if (o.team === p.team) continue;
        if (Math.abs(o.pos.x) < 1.5 && Math.abs(p.pos.x) < 1.5) near = Math.min(near, Math.abs(o.pos.z - p.pos.z));
      }
      if (near < 1.2) {
        // ¿La red le queda a la izquierda o a la derecha? (izquierda del cuerpo = (cos yaw, −sin yaw)).
        const toNet = -Math.sign(p.pos.x);
        const side = Math.cos(this.yaw) * toNet > 0 ? 'L' : 'R';
        pose = blendPose(pose, framePose(pose, HIGH_FIVE[side]), ease(1 - near / 1.2));
      }
    }

    // Respiración y peso que se mueve: nadie queda quieto como un robot.
    const breathe = Math.sin(performance.now() / 1000 * 1.6 + this.key.length * 1.7);
    const sp = pose.spine ?? [0, 0, 0];
    BREATH.spine = [sp[0] + breathe * 0.025, sp[1] + Math.sin(performance.now() / 2300 + this.key.charCodeAt(2)) * 0.06, sp[2] + breathe * 0.02];
    pose = framePose(pose, BREATH);
    this.applyPose(pose);

    // ---- Salto ----
    let lift = 0;
    if (this.jump) {
      // El avance del salto largo (saque en suspensión, zaguero) lo da el propio desplazamiento del jugador: el cuerpo
      // nunca se separa de su lugar, así no hay saltos bruscos al despegar ni al caer.
      lift = jumpOffset(now, this.jump.apex, this.jump.air, this.jump.peak);
      if (now > this.jump.apex + this.jump.air / 2) this.jump = null;
    }
    this.rig.body.position.y = lift;
    this.rig.body.position.z = 0;
    this.keepFeetAboveFloor();

    // ---- Orientación ----
    let targetYaw: number;
    const b = sim.ballPos;
    // Fuera de la cancha miran al partido; en el calentamiento, la fila (también suplentes) mira a la red.
    if (ceremony) {
      // Caminando miran hacia donde van; quietos, a la red en el saludo y el sorteo, y a la tribuna en lo demás.
      if (this.speed > 0.4) targetYaw = Math.atan2(this.vx, this.vz);
      else targetYaw = ceremony.step === 'greeting' || ceremony.step === 'toss' ? this.netYaw() : 0;
    } else if (!onCourt && sim.phase !== 'warmup') targetYaw = 0;
    else if (sim.phase === 'warmup' && !(up && up.key === this.key) && this.speed < 2.6) targetYaw = this.netYaw();
    else if (sim.phase === 'preServe') {
      // Antes del saque: el equipo que saca mira a la red; el que recibe mira al sacador.
      targetYaw = sim.match.serving === p.team ? this.netYaw() : Math.atan2(b.x - p.pos.x, b.z - p.pos.z);
    } else if (block && block.keys.includes(this.key)) targetYaw = this.netYaw();
    else if ((up && up.key === this.key && up.kind === 'attack') || sim.decoy?.key === this.key) targetYaw = this.netYaw();
    // Calentamiento: la fila y los que esperan miran a la red (no al balón del otro equipo).
    else if (sim.phase === 'warmup' && this.speed < 2.6) targetYaw = this.netYaw();
    else if (this.dive) targetYaw = Math.atan2(this.dive.point.x - p.pos.x, this.dive.point.z - p.pos.z);
    else if (this.speed > 2.6 && !(up && up.key === this.key && up.kind === 'attack')) targetYaw = Math.atan2(this.vx, this.vz);
    else targetYaw = Math.atan2(b.x - p.pos.x, b.z - p.pos.z);
    let diff = targetYaw - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * Math.min(1, dt * 8 || 1);
    const lunge = this.diveOffset(now, p.pos.x, p.pos.z);
    this.rig.root.position.set(p.pos.x + lunge.x, 0, p.pos.z + lunge.z);
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
    this.reachStrike(now);
    this.keepOffNet(p.team);
  }

  /**
   * Remate y saque: en los ~0.2 s alrededor del golpe, el cuerpo se corre (y sube o baja apenas) lo que falte para
   * que la mano derecha quede justo en la pelota en el instante del contacto. Suave antes y después.
   */
  /** En pleno golpe con la mano (o plancha): el cuerpo no se mueve para separarlo de otros (la mano tiene que llegar). */
  get pinned(): boolean {
    const now = this.sim.time;
    return (!!this.strike && Math.abs(now - this.strike.at) < 0.25) || !!this.dive;
  }

  private reachStrike(now: number): void {
    const s = this.strike;
    if (!s) return;
    const rel = now - s.at;
    if (rel > 0.25) {
      this.strike = null;
      return;
    }
    const w = ease(1 - Math.min(1, Math.abs(rel) / (rel < 0 ? 0.22 : 0.18)));
    if (w <= 0) return;
    // Dos pasadas: la segunda corrige lo que movió el brazo al acomodarse el cuerpo.
    for (let i = 0; i < 2; i++) {
      this.rig.root.updateMatrixWorld(true);
      this.rig.joints.elbowR.localToWorld(this.hand.set(0, -this.rig.dims.forearm - 0.05, 0));
      const dx = Math.max(-0.7, Math.min(0.7, s.target.x - this.hand.x));
      const dz = Math.max(-0.7, Math.min(0.7, s.target.z - this.hand.z));
      const dy = Math.max(-0.35, Math.min(0.35, s.target.y - this.hand.y));
      this.rig.root.position.x += dx * w;
      this.rig.root.position.z += dz * w;
      this.rig.body.position.y += (dy * w) / this.rig.root.scale.y;
    }
  }

  /**
   * Nadie pasa las manos ni los brazos al otro lado de la red: si un codo o una mano cruzaría el plano de la red
   * (junto a ella), el jugador se dibuja un poco más atrás, lo justo para que quede de su lado.
   */
  private keepOffNet(team: TeamId): void {
    const root = this.rig.root.position;
    if (Math.abs(root.x) > 1.8 || Math.abs(root.z) > COURT.halfWidth + 1.5) return;
    const s = sideSign(team);
    this.rig.root.updateMatrixWorld(true);
    let worst = 0;
    for (const side of ['L', 'R'] as const) {
      const elbow = this.rig.joints[`elbow${side}`];
      for (const reach of [0, this.rig.dims.forearm + 0.09]) {
        const w = elbow.localToWorld(NET_PROBE.set(0, -reach, 0));
        // Del lado propio s·x > 0; se deja un margen de 5 cm antes de la red.
        worst = Math.max(worst, 0.05 - s * w.x);
      }
    }
    if (worst > 0) root.x += s * worst;
  }

  /**
   * Cuánto hay que saltar para que la mano (L o R) llegue a `height` en la pose del momento clave de la pista.
   * Aplica esa pose un instante para medir con cinemática directa; la pose real se aplica después en el cuadro.
   */
  private liftToReach(track: readonly Key[], side: 'L' | 'R', height: number, min: number, max: number): number {
    this.applyPose(sampleTrack(track, 0));
    this.rig.body.position.y = 0;
    this.rig.root.updateMatrixWorld(true);
    const hand = this.rig.joints[`elbow${side}`].localToWorld(new THREE.Vector3(0, -this.rig.dims.forearm - 0.05, 0));
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
      for (const sole of this.soles) {
        const p = root.worldToLocal(knee.localToWorld(this.tmp.copy(sole)));
        min = Math.min(min, p.y);
      }
    }
    if (min < 0) body.position.y -= min;
  }

  /** Mirando a la red: el equipo A hacia +x, el B hacia −x. */
  private netYaw(): number {
    return sideSign(this.sim.player(this.key).team) < 0 ? Math.PI / 2 : -Math.PI / 2;
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
    const D = this.rig.dims;
    const legL = hipHeight(D.thigh, D.shin, this.rig.joints.hipL.rotation.x, this.rig.joints.kneeL.rotation.x);
    const legR = hipHeight(D.thigh, D.shin, this.rig.joints.hipR.rotation.x, this.rig.joints.kneeR.rotation.x);
    this.rig.hips.position.y = D.foot + Math.max(legL, legR);
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
