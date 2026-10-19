import type { TeamDef } from '../data/teams';
import { SET_LABELS, availableSetOptions, type AttackShot, type SetOption, type Zone } from './actions';
import { chooseBlockScheme, chooseServe, chooseSet, chooseShot } from './ai';
import { checkNet, landingTime, launch, positionAt, timeAtHeightDescending, type Trajectory } from './ball';
import { COURT, GRAVITY, isInCourt, otherTeam, sideOfX, sideSign, toWorld, type TeamId } from './court';
import { judgeServe, judgeTiming, serveMeter, type Decision, type DecisionKind, type DecisionOption, type UserOption } from './decision';
import { EventBus, type ContactKind, type PointReason } from './events';
import { APPROACH_SPOTS, ATTACK_POINTS, DEFENSE_SPOTS, RECEIVE_SPOTS, SERVE_SPOT, SETTER_SPOT, ZONE_SPOTS, spot, zoneSpotFor } from './formation';
import { awardPoint, courtPlayers, createMatch, isFrontIndex, type MatchState, type TeamSetup } from './match';
import { attackContactHeight, blockReach, moveSpeed, type PlayerState } from './players';
import { computeQuality, errorChance, rollTiming, type Timing } from './resolver';
import { createRng, type Rng } from './rng';
import { TUNING } from './tuning';
import { clamp, clamp01, clone, distXZ, v3, type Vec3 } from './vec';

export interface SimOptions {
  seed: number;
  setsToWin: 1 | 2;
  teamA: TeamDef;
  teamB: TeamDef;
  firstServer?: TeamId;
  /** Equipo que controla el usuario: decide todas las jugadas de todos sus jugadores. */
  control?: TeamId;
  /** Dificultad del rival (el equipo que no controla el usuario). Por defecto, normal. */
  difficulty?: Difficulty;
}

export type Difficulty = 'easy' | 'normal' | 'hard';
export type Phase = 'preServe' | 'inPlay' | 'pointOver' | 'matchOver';

type BlockOutcome = 'stuff' | 'soft' | 'tool';

/** Decisión del usuario ya resuelta para un contacto: opción (null = la IA decide) y timing. */
interface Control {
  option: UserOption | null;
  aim?: { x: number; z: number } | null;
  timing: Timing;
}

interface Touch {
  key: string;
  team: TeamId;
  kind: ContactKind;
  quality: number;
}

export type PlannedContact = Plan;

interface Plan {
  key: string;
  team: TeamId;
  time: number;
  point: Vec3;
  kind: ContactKind;
  /** Contacto bajo o de emergencia: penaliza la calidad. */
  low: boolean;
  block?: BlockOutcome;
}

/** Bloqueo preparado contra el remate rival ya planificado. */
export interface BlockSetup {
  team: TeamId;
  /** Cuántos bloquean (0 = sin bloqueo). */
  scheme: number;
  keys: string[];
  /** Instante del remate rival. */
  attackTime: number;
  /** Lateral (z mundo) del punto de remate. */
  z: number;
}

interface Reach {
  time: number;
  point: Vec3;
  slack: number;
  low: boolean;
}

const TEAM_IDS: readonly TeamId[] = ['A', 'B'];

export class Simulation {
  readonly bus = new EventBus();
  readonly match: MatchState;
  readonly players = new Map<string, PlayerState>();
  readonly teams: Record<TeamId, TeamDef>;
  readonly control: TeamId | null;
  phase: Phase = 'preServe';
  time = 0;
  ball: Trajectory = { p0: v3(), v0: v3(), t0: 0, g: GRAVITY };
  ballPos: Vec3 = v3();
  /** Decisión pendiente del usuario. La UI la lee y responde con `choose`, `setServeZone` y `press`. */
  decision: Decision | null = null;

  private readonly rng: Rng;
  private readonly difficulty: Difficulty;
  private phaseTimer = 0;
  private plan: Plan | null = null;
  private netFaultTime: number | null = null;
  /** Rebotes de la pelota en el piso después del punto. */
  private bounces = 0;
  private last: Touch | null = null;
  private touchSide: TeamId = 'A';
  private touches = 0;
  /** Dificultad de la pelota entrante para quien la recibe (0..1). */
  private threat = 0;
  private intent: { key: string; option: SetOption; outOfSystem: boolean } | null = null;
  private lastShot: AttackShot = 'cross';
  private blockSetup: BlockSetup | null = null;
  /** Bloqueo ya consumido por el remate: los bloqueadores mantienen su lugar hasta el siguiente toque. */
  private blockHold: BlockSetup | null = null;

  constructor(opts: SimOptions) {
    this.rng = createRng(opts.seed);
    this.difficulty = opts.difficulty ?? 'normal';
    this.control = opts.control ?? null;
    this.teams = { A: opts.teamA, B: opts.teamB };
    for (const team of TEAM_IDS) {
      for (const def of this.teams[team].roster) {
        const key = `${team}:${def.id}`;
        this.players.set(key, { key, def, team, pos: v3(), target: v3() });
      }
    }
    this.match = createMatch({ setsToWin: opts.setsToWin }, this.setup('A'), this.setup('B'), opts.firstServer ?? 'A');
    this.resetForServe();
  }

  court(team: TeamId): string[] {
    return courtPlayers(this.match, team);
  }

  player(key: string): PlayerState {
    const p = this.players.get(key);
    if (!p) throw new Error(`Jugador desconocido: ${key}`);
    return p;
  }

  /** Próximo contacto planificado (solo lectura): el render lo usa para anticipar saltos y gestos. */
  get upcoming(): Readonly<PlannedContact> | null {
    return this.plan;
  }

  /** Bloqueo preparado contra el próximo remate (solo lectura, para el render). */
  get blockers(): Readonly<BlockSetup> | null {
    return this.blockSetup;
  }

  /** Segundos hasta el saque de la IA (para animar el lanzamiento); null si no hay saque automático pendiente. */
  get serveCountdown(): number | null {
    return this.phase === 'preServe' && this.match.serving !== this.control ? Math.max(0, this.phaseTimer) : null;
  }

  /**
   * Multiplicador de tiempo para el bucle en tiempo real. Con una decisión pendiente: casi detenido mientras el usuario
   * no elige, acercamiento cuando ya eligió y cámara lenta en los últimos instantes para el timing.
   */
  get timeScale(): number {
    const d = this.decision;
    if (!d || d.contactTime === null) return 1;
    const cfg = TUNING.decision;
    if (d.chosen === null) return cfg.thinkScale;
    const near = d.contactTime - this.time <= cfg.slowWindow;
    if (d.aim) return near ? cfg.aimSlowScale : cfg.aimApproachScale;
    return near ? cfg.slowScale : cfg.approachScale;
  }

  /** Elige una opción. Se puede cambiar mientras no se haya presionado el timing. */
  choose(index: number): void {
    const d = this.decision;
    if (!d || d.pressedAt !== null || index < 0 || index >= d.options.length) return;
    d.chosen = index;
    const opt = d.options[index].option;
    if (d.kind === 'block' && opt.id === 'block' && this.blockSetup) {
      this.blockSetup.scheme = opt.n;
      this.blockSetup.keys = this.pickBlockers(this.blockSetup.team, opt.n, this.blockSetup.z);
      this.setFormations();
    }
  }

  /** Mueve la mira del remate apuntado (limitada al campo rival y sus alrededores). */
  setAim(x: number, z: number): void {
    const d = this.decision;
    if (!d || !d.aim || d.pressedAt !== null) return;
    const s = sideSign(otherTeam(this.player(d.playerKey).team));
    d.aim = { x: s * clamp(s * x, 0.3, COURT.halfLength + 2), z: clamp(z, -COURT.halfWidth - 1.5, COURT.halfWidth + 1.5) };
  }

  setServeZone(zone: Zone): void {
    const d = this.decision;
    if (d && d.kind === 'serve' && d.pressedAt === null) d.zone = zone;
  }

  /**
   * Presiona el timing. `at` es el instante de simulación en que se tocó la tecla (puede caer entre dos cuadros);
   * por defecto, el instante actual. En el saque, saca de inmediato.
   */
  press(at: number = this.time): void {
    const d = this.decision;
    if (!d || d.chosen === null || d.pressedAt !== null) return;
    d.pressedAt = Math.max(at, d.startTime);
    if (d.kind === 'serve' && this.phase === 'preServe') this.serve();
  }

  step(dt: number): void {
    if (this.phase === 'matchOver') return;
    this.time += dt;
    this.movePlayers(dt);
    if (this.phase === 'preServe') {
      this.ballPos = this.serverHand();
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        if (this.match.serving !== this.control) this.serve();
        else if (!this.decision) this.openDecision('serve', this.serveOptions(), null, this.court(this.match.serving)[0]);
        else if (this.time - this.decision.startTime > TUNING.decision.serveTimeout) this.serve();
      }
    } else if (this.phase === 'inPlay') {
      this.ballPos = positionAt(this.ball, this.time);
      if (this.netFaultTime !== null) {
        if (this.time >= this.netFaultTime) {
          this.dropAtNet(this.netFaultTime);
          this.endRally(this.last!.team);
        }
      } else if (this.plan) {
        if (this.time >= this.plan.time) this.executeContact(this.plan);
      } else if (this.time >= landingTime(this.ball)) {
        this.ballLanded();
      }
    } else {
      this.bounceBall();
      this.ballPos = positionAt(this.ball, Math.min(this.time, landingTime(this.ball)));
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        if (this.match.winner) this.phase = 'matchOver';
        else this.resetForServe();
      }
    }
  }

  // ---------- preparación ----------

  private setup(team: TeamId): TeamSetup {
    const d = this.teams[team];
    const k = (id: string) => `${team}:${id}`;
    return { lineup: d.lineup.map(k), libero: k(d.libero), liberoReplaces: d.liberoReplaces.map(k) };
  }

  private resetForServe(): void {
    this.phase = 'preServe';
    this.phaseTimer = TUNING.servePause;
    this.plan = null;
    this.netFaultTime = null;
    this.last = null;
    this.intent = null;
    this.threat = 0;
    this.decision = null;
    this.blockSetup = null;
    this.blockHold = null;
    this.touchSide = this.match.serving;
    this.touches = 0;
    for (const team of TEAM_IDS) {
      const court = this.court(team);
      const receiving = team !== this.match.serving;
      let bench = 0;
      for (const p of this.players.values()) {
        if (p.team !== team) continue;
        const idx = court.indexOf(p.key);
        let target: Vec3;
        // Ambas bancas del lado lejano de la cámara de transmisión (z negativo).
        if (idx < 0) target = v3(sideSign(team) * (2.5 + 0.7 * bench++), 0, -6.5);
        else if (!receiving && idx === 0) target = spot(team, SERVE_SPOT);
        else target = spot(team, (receiving ? RECEIVE_SPOTS : DEFENSE_SPOTS)[idx]);
        p.pos = clone(target);
        p.target = clone(target);
      }
    }
    this.ballPos = this.serverHand();
  }

  private serverHand(): Vec3 {
    const p = this.player(this.court(this.match.serving)[0]);
    return v3(p.pos.x, 1.4, p.pos.z);
  }

  private movePlayers(dt: number): void {
    // El atacante espera en su punto de partida y arranca la carrera justo a tiempo para llegar al salto.
    const plan = this.plan;
    if (plan?.kind === 'attack') {
      const p = this.player(plan.key);
      const stand = this.standPoint(plan);
      const runTime = distXZ(p.pos, stand) / moveSpeed(p.def) + 0.15;
      p.target = plan.time - this.time > runTime ? v3(p.pos.x, 0, p.pos.z) : stand;
    }
    for (const p of this.players.values()) {
      const dx = p.target.x - p.pos.x;
      const dz = p.target.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-6) continue;
      const len = Math.min(d, moveSpeed(p.def) * dt);
      p.pos.x += (dx / d) * len;
      p.pos.z += (dz / d) * len;
    }
    this.separatePlayers();
    // Nadie cruza la línea central (el cuerpo se queda en su campo).
    for (const team of TEAM_IDS) {
      const s = sideSign(team);
      for (const k of this.court(team)) {
        const p = this.player(k).pos;
        if (s * p.x < TUNING.minNetGap) p.x = s * TUNING.minNetGap;
      }
    }
  }

  /** Cuando la pelota toca el piso después del punto, rebota perdiendo energía (hasta que casi no sube). */
  private bounceBall(): void {
    const land = landingTime(this.ball);
    if (this.time < land || this.bounces >= TUNING.bounce.max) return;
    const dt = land - this.ball.t0;
    const vy = this.ball.v0.y - this.ball.g * dt;
    if (-vy * TUNING.bounce.restitution < TUNING.bounce.minUp) return;
    const p = positionAt(this.ball, land);
    this.ball = {
      p0: v3(p.x, COURT.ballRadius, p.z),
      v0: v3(this.ball.v0.x * TUNING.bounce.friction, -vy * TUNING.bounce.restitution, this.ball.v0.z * TUNING.bounce.friction),
      t0: land,
      g: GRAVITY,
    };
    this.bounces += 1;
  }

  /** Nadie ocupa el lugar de un compañero: separación mínima entre los jugadores en cancha de cada equipo. */
  private separatePlayers(): void {
    const min = TUNING.minSeparation;
    for (const team of TEAM_IDS) {
      const ps = this.court(team).map((k) => this.player(k));
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const a = ps[i].pos;
          const b = ps[j].pos;
          let dx = b.x - a.x;
          let dz = b.z - a.z;
          let d = Math.hypot(dx, dz);
          if (d >= min) continue;
          if (d < 1e-6) {
            dx = 0;
            dz = 1;
            d = 1;
          }
          const push = (min - Math.min(d, min)) / 2;
          const nx = dx / d;
          const nz = dz / d;
          a.x -= nx * push;
          a.z -= nz * push;
          b.x += nx * push;
          b.z += nz * push;
        }
      }
    }
  }

  // ---------- decisiones del usuario ----------

  private openDecision(kind: DecisionKind, options: DecisionOption[], contactTime: number | null, playerKey: string): void {
    const decision: Decision = { kind, playerKey, options, contactTime, startTime: this.time, chosen: null, pressedAt: null, zone: null, aim: null };
    this.decision = decision;
    this.bus.emit({ type: 'decision', decision });
  }

  private closeDecision(timing: Timing): void {
    const d = this.decision!;
    this.decision = null;
    this.bus.emit({ type: 'decisionResolved', kind: d.kind, timing });
  }

  private serveOptions(): DecisionOption[] {
    return [
      { label: 'Saque flotado', option: { id: 'serve', type: 'float' } },
      { label: 'Saque en salto', option: { id: 'serve', type: 'jump' } },
      { label: 'Saque seguro', option: { id: 'serve', type: 'safe' } },
    ];
  }

  /** Abre una decisión si el próximo contacto es del equipo controlado, o el esquema de bloqueo ante el remate rival. */
  private openDecisionFor(plan: Plan | null): void {
    if (!this.control || !plan || this.decision) return;
    if (plan.team === this.control && plan.kind !== 'block') {
      const kind: DecisionKind = plan.kind === 'reception' || plan.kind === 'dig' ? 'pass' : plan.kind === 'set' ? 'set' : 'attack';
      this.openDecision(kind, this.contactOptions(plan), plan.time, plan.key);
      const opened = this.decision as Decision | null;
      if (kind === 'attack' && plan.kind === 'attack' && opened) {
        // Remate apuntado: ya "elegido"; la mira empieza en el mejor hueco y el usuario la mueve.
        const t = this.pickAttackTarget(otherTeam(plan.team), plan.point, 'cross');
        opened.aim = { x: t.x, z: t.z };
        opened.chosen = 0;
      }
    } else if (plan.kind === 'attack' && plan.team !== this.control && this.blockSetup?.team === this.control) {
      const front = this.frontPlayers(this.control);
      if (front.length === 0) return;
      const labels = ['Sin bloqueo (defender)', 'Bloqueo simple', 'Bloqueo doble', 'Bloqueo triple'];
      const options: DecisionOption[] = [3, 2, 1, 0]
        .filter((n) => n <= front.length)
        .map((n) => ({ label: labels[n], option: { id: 'block', n } }));
      this.openDecision('block', options, plan.time, this.blockSetup.keys[0] ?? front[0]);
    }
  }

  private contactOptions(plan: Plan): DecisionOption[] {
    const p = this.player(plan.key);
    switch (plan.kind) {
      case 'reception':
      case 'dig':
        return [
          { label: 'Pase al colocador', option: { id: 'pass', high: false } },
          { label: 'Pase alto seguro', option: { id: 'pass', high: true } },
        ];
      case 'set': {
        const passQuality = this.last!.quality;
        const specialist = p.def.role === 'S';
        const court = this.court(p.team);
        const options: DecisionOption[] = availableSetOptions(court, p.key, passQuality, specialist, this.players)
          .map((choice) => ({ label: SET_LABELS[choice.option], option: { id: 'set', choice } }));
        if (specialist && isFrontIndex(court.indexOf(p.key)) && passQuality >= 0.5) {
          options.push({ label: 'Segunda (ataque del colocador)', option: { id: 'dump' } });
        }
        return options;
      }
      case 'attack':
        return [{ label: 'Remate apuntado', option: { id: 'aim' } }];
      default:
        return [{ label: 'Mandar pelota', option: { id: 'free' } }];
    }
  }

  /** Timing de la IA: el rival usa la distribución de su dificultad; el equipo controlado, la normal. */
  private aiTiming(team: TeamId): Timing {
    const rival = this.control ? team !== this.control : team === 'B';
    return rollTiming(this.rng, rival ? TUNING.difficulty[this.difficulty] : TUNING.timing);
  }

  /** Timing perfecto del usuario: bono de calidad. La IA (userTiming undefined) no lo recibe. */
  private boosted(q: number, userTiming: Timing | undefined): number {
    return userTiming === 'perfect' ? Math.min(1, q + TUNING.decision.perfectBonus) : q;
  }

  /** Consume la decisión del usuario para este contacto. */
  private resolveDecision(plan: Plan): Control | undefined {
    const d = this.decision;
    if (!d || d.kind === 'block' || d.kind === 'serve' || d.playerKey !== plan.key) return undefined;
    const option = d.chosen === null ? null : d.options[d.chosen].option;
    const timing = d.chosen === null ? 'bad' : judgeTiming(d.pressedAt, plan.time);
    const aim = d.aim;
    this.closeDecision(timing);
    return { option, timing, aim };
  }

  // ---------- contactos ----------

  private registerTouch(p: PlayerState, kind: ContactKind, quality: number): void {
    if (kind === 'serve' || kind === 'block') {
      this.touchSide = p.team;
      this.touches = 0;
    } else if (this.touchSide === p.team) {
      this.touches += 1;
    } else {
      this.touchSide = p.team;
      this.touches = 1;
    }
    this.last = { key: p.key, team: p.team, kind, quality };
    this.bus.emit({ type: 'contact', time: this.time, playerKey: p.key, team: p.team, kind, quality });
  }

  private serve(): void {
    const team = this.match.serving;
    const server = this.player(this.court(team)[0]);
    let choice = chooseServe(this.rng, server.def);
    let timing: Timing;
    const d = this.decision?.kind === 'serve' ? this.decision : null;
    if (d) {
      const option = d.chosen === null ? null : d.options[d.chosen].option;
      if (option?.id === 'serve') choice = { type: option.type, zone: d.zone ?? choice.zone };
      timing = d.pressedAt === null ? 'bad' : judgeServe(serveMeter(d.pressedAt - d.startTime));
      this.closeDecision(timing);
    } else {
      timing = this.aiTiming(team);
    }
    const cfg = TUNING.serve[choice.type];
    const from = v3(server.pos.x, cfg.contactHeight, server.pos.z);
    let q = computeQuality(
      { base: cfg.base, prevQuality: 1, timing, attribute: server.def.attrs.serve, pressure: 0 },
      this.rng,
    );
    this.phase = 'inPlay';
    q = this.boosted(q, d ? timing : undefined);
    this.registerTouch(server, 'serve', q);
    const opp = otherTeam(team);
    const isError = this.rng.chance(errorChance(cfg.risk, q));
    const target = isError
      ? this.errorTarget(opp, from)
      : this.keepOnSide(opp, this.noisy(spot(opp, ZONE_SPOTS[choice.zone], COURT.ballRadius), cfg.noise * (1 - q)));
    this.ball = this.launchClearing(from, target, distXZ(from, target) / cfg.speed, GRAVITY + cfg.gravityBonus, this.time, !isError);
    this.ballPos = clone(from);
    this.threat = q * clamp01(cfg.speed / 22);
    this.planNext();
  }

  private executeContact(plan: Plan): void {
    const p = this.player(plan.key);
    const t = plan.time;
    const at = positionAt(this.ball, t);
    this.plan = null;
    const ctl = this.resolveDecision(plan);
    switch (plan.kind) {
      case 'reception':
      case 'dig':
        this.doPass(p, plan.kind, at, t, plan.low, ctl);
        break;
      case 'set':
        this.doSet(p, at, t, plan.low, ctl);
        break;
      case 'attack':
        this.doAttack(p, at, t, ctl);
        break;
      case 'free':
        this.doFree(p, at, t, ctl);
        break;
      case 'block':
        this.doBlock(p, at, t, plan.block!);
        break;
      case 'serve':
        throw new Error('El saque no se planifica');
    }
    this.planNext();
  }

  private doPass(p: PlayerState, kind: 'reception' | 'dig', at: Vec3, t: number, low: boolean, ctl?: Control): void {
    const cfg = TUNING.pass;
    const high = ctl?.option?.id === 'pass' && ctl.option.high;
    const hp = TUNING.decision.highPass;
    const attribute = kind === 'reception' ? p.def.attrs.reception : p.def.attrs.defense;
    let q = computeQuality(
      { base: low ? cfg.lowContactBase : cfg.base, prevQuality: 1, timing: ctl?.timing ?? this.aiTiming(p.team), attribute, pressure: this.threat },
      this.rng,
    );
    q = this.boosted(q, ctl?.timing);
    this.registerTouch(p, kind, q);
    this.intent = null;
    if (this.rng.chance(errorChance(cfg.risk * (high ? hp.riskFactor : 1), q))) {
      const wild = v3(at.x + this.rng.range(-6, 6), COURT.ballRadius, at.z + this.rng.range(-6, 6));
      this.ball = launch(at, wild, 1.0, t);
    } else {
      const noise = cfg.noise * (1 - q) * (high ? hp.noiseFactor : 1);
      const target = this.keepOnSide(p.team, this.noisy(spot(p.team, SETTER_SPOT, TUNING.setHeight), noise));
      this.ball = launch(at, target, high ? hp.flightTime : cfg.flightTime, t);
    }
    this.threat = 0;
  }

  private doSet(p: PlayerState, at: Vec3, t: number, low: boolean, ctl?: Control): void {
    if (ctl?.option?.id === 'dump') {
      this.doAttack(p, at, t, { option: { id: 'shot', shot: 'tip' }, timing: ctl.timing });
      return;
    }
    const cfg = TUNING.set;
    const passQuality = this.last!.quality;
    const specialist = p.def.role === 'S';
    const choice = ctl?.option?.id === 'set'
      ? ctl.option.choice
      : chooseSet(this.rng, availableSetOptions(this.court(p.team), p.key, passQuality, specialist, this.players));
    const attacker = this.player(choice.attackerKey);
    let q = computeQuality(
      { base: low ? TUNING.pass.lowContactBase : cfg.base, prevQuality: passQuality, timing: ctl?.timing ?? this.aiTiming(p.team), attribute: p.def.attrs.setting, pressure: 0 },
      this.rng,
    );
    q = this.boosted(q, ctl?.timing);
    this.registerTouch(p, 'set', q);
    const outOfSystem = low || passQuality < cfg.outOfSystemPass;
    const [depth, right] = ATTACK_POINTS[choice.option];
    const point = toWorld(p.team, outOfSystem ? Math.max(depth, 2.0) : depth, right, attackContactHeight(attacker.def) - 0.1);
    const target = this.keepOnSide(p.team, this.noisy(point, cfg.noise * (1 - q)));
    this.ball = launch(at, target, outOfSystem ? cfg.rescueFlightTime : cfg.flightTime[choice.option], t);
    this.intent = { key: attacker.key, option: choice.option, outOfSystem };
    this.threat = 0;
  }

  private doAttack(p: PlayerState, at: Vec3, t: number, ctl?: Control): void {
    const cfg = TUNING.attack;
    const opp = otherTeam(p.team);
    const aim = ctl?.option?.id === 'aim' && ctl.aim ? ctl.aim : null;
    // Con mira: cerca de la red es finta; si no, remate. Sin mira, la IA (o la opción elegida) decide el tiro.
    const shot: AttackShot = aim
      ? (Math.abs(aim.x) < cfg.tipDepth ? 'tip' : 'cross')
      : ctl?.option?.id === 'shot' ? ctl.option.shot : chooseShot(this.rng);
    let q = computeQuality(
      {
        base: cfg.base,
        prevQuality: this.last!.quality,
        timing: ctl?.timing ?? this.aiTiming(p.team),
        attribute: (p.def.attrs.attackPower + p.def.attrs.attackAccuracy) / 2,
        pressure: this.blockPressure(at),
      },
      this.rng,
    );
    q = this.boosted(q, ctl?.timing);
    this.registerTouch(p, 'attack', q);
    this.lastShot = shot;
    this.intent = null;
    const isError = this.rng.chance(errorChance(cfg.shots[shot].risk * (aim ? TUNING.decision.aimRiskFactor : 1), q));
    const aimed = aim ? v3(aim.x, COURT.ballRadius, aim.z) : this.pickAttackTarget(opp, at, shot);
    const target = isError ? this.errorTarget(opp, at) : this.keepOnSide(opp, this.noisy(aimed, cfg.noise * (1 - q)));
    if (shot === 'tip') {
      this.ball = this.launchClearing(at, target, cfg.tipFlightTime, GRAVITY, t, !isError);
      this.threat = 0.3 * q;
    } else {
      const speed = cfg.minSpeed + cfg.speedRange * q * (p.def.attrs.attackPower / 100);
      this.ball = this.launchClearing(at, target, distXZ(at, target) / speed, GRAVITY + cfg.gravityBonus, t, !isError);
      this.threat = q * clamp01(speed / 28);
    }
  }

  private doFree(p: PlayerState, at: Vec3, t: number, ctl?: Control): void {
    const last = this.last;
    const prevQuality = last && last.team === p.team ? last.quality : 0.5;
    let q = computeQuality(
      { base: 0.9, prevQuality, timing: ctl?.timing ?? this.aiTiming(p.team), attribute: p.def.attrs.reception, pressure: this.threat },
      this.rng,
    );
    q = this.boosted(q, ctl?.timing);
    this.registerTouch(p, 'free', q);
    this.intent = null;
    const opp = otherTeam(p.team);
    const isError = this.rng.chance(errorChance(TUNING.free.risk, q));
    const target = isError ? this.errorTarget(opp, at) : toWorld(opp, this.rng.range(5, 8), this.rng.range(-3, 3), COURT.ballRadius);
    this.ball = this.launchClearing(at, target, TUNING.free.flightTime, GRAVITY, t, !isError);
    this.threat = 0.1;
  }

  private doBlock(p: PlayerState, at: Vec3, t: number, outcome: BlockOutcome): void {
    this.registerTouch(p, 'block', outcome === 'stuff' ? 0.9 : outcome === 'tool' ? 0.1 : 0.5);
    this.intent = null;
    const attackers = otherTeam(p.team);
    if (outcome === 'tool') {
      // El atacante usó las manos del bloqueo: la pelota sale desviada afuera del lado del bloqueo.
      const from = v3(sideSign(p.team) * 0.15, Math.max(at.y, 2.7), at.z);
      const side = at.z === 0 ? 1 : Math.sign(at.z);
      const target = v3(sideSign(p.team) * this.rng.range(2, 7), COURT.ballRadius, side * (COURT.halfWidth + this.rng.range(1, 3)));
      this.ball = launch(from, target, 0.9, t);
      this.threat = 1;
    } else if (outcome === 'stuff') {
      // Las manos pasan sobre la red: la pelota sale ya del lado atacante.
      const from = v3(sideSign(attackers) * 0.1, Math.max(at.y, 2.7), at.z);
      const z = clamp(at.z + this.rng.range(-1.5, 1.5), -COURT.halfWidth - 1, COURT.halfWidth + 1);
      const target = v3(sideSign(attackers) * this.rng.range(0.5, 3), COURT.ballRadius, z);
      this.ball = launch(from, target, 0.4, t);
      this.threat = 0.8;
    } else {
      const from = v3(sideSign(p.team) * 0.15, Math.max(at.y, 2.7), at.z);
      const target = v3(sideSign(p.team) * this.rng.range(2.5, 6), COURT.ballRadius, this.rng.range(-3, 3));
      this.ball = launch(from, target, 1.3, t);
      this.threat = 0.2;
    }
  }

  /** La pelota pegó en la red (o la antena): cae junto a la red del lado de quien la tocó, sin atravesarla. */
  private dropAtNet(time: number): void {
    const hit = positionAt(this.ball, time);
    const s = sideSign(this.last!.team);
    const from = v3(s * 0.12, clamp(hit.y, 0.4, COURT.netHeight), clamp(hit.z, -COURT.halfWidth - 0.5, COURT.halfWidth + 0.5));
    this.ball = launch(from, v3(s * 0.45, COURT.ballRadius, from.z), 0.35 + 0.12 * from.y, time);
  }

  // ---------- planificación ----------

  private planNext(): void {
    this.plan = null;
    this.netFaultTime = null;
    const last = this.last!;
    // El bloqueo preparado (y la decisión del usuario sobre él) se consume con el remate rival.
    const blockDecision = last.kind === 'attack' && this.decision?.kind === 'block' ? this.decision : null;
    const block = last.kind === 'attack' ? this.blockSetup : null;
    this.blockHold = last.kind === 'attack' ? block : null;
    if (last.kind === 'attack') this.blockSetup = null;
    const net = checkNet(this.ball);
    const crossTime = net.kind === 'none' ? Infinity : net.time;
    // Primero el lado donde está la pelota: un compañero puede jugarla antes de que llegue a la red.
    const here = this.planTouch(sideOfX(this.ball.p0.x));
    let blockTiming: Timing = 'bad';
    if (here && here.time < crossTime) {
      this.plan = here;
    } else if (net.kind === 'fault') {
      this.netFaultTime = net.time;
    } else if (net.kind === 'clear') {
      if (last.kind === 'attack' && this.lastShot !== 'tip' && block && block.scheme > 0) {
        if (blockDecision && blockDecision.chosen !== null) blockTiming = judgeTiming(blockDecision.pressedAt, blockDecision.contactTime!);
        this.plan = this.planBlock(block, net.time, blockDecision ? blockTiming : null);
      }
      this.plan ??= this.planTouch(otherTeam(sideOfX(this.ball.p0.x)));
    }
    if (blockDecision) this.closeDecision(blockTiming);
    if (this.plan?.kind === 'attack') this.setupBlock(otherTeam(this.plan.team), this.plan);
    this.setFormations();
    this.openDecisionFor(this.plan);
  }

  /** Prepara el bloqueo del equipo que defiende contra el remate ya planificado (esquema de la IA por defecto). */
  private setupBlock(team: TeamId, attack: Plan): void {
    const scheme = chooseBlockScheme(this.rng, this.intent?.option ?? 'zone4', this.intent?.outOfSystem ?? false);
    const n = Math.min(scheme, this.frontPlayers(team).length);
    this.blockSetup = { team, scheme: n, keys: this.pickBlockers(team, n, attack.point.z), attackTime: attack.time, z: attack.point.z };
  }

  /** Delanteros que pueden bloquear (sin líbero). */
  private frontPlayers(team: TeamId): string[] {
    return this.court(team).filter((k, i) => isFrontIndex(i) && this.player(k).def.role !== 'L');
  }

  /** Los `n` delanteros cuya zona queda más cerca del punto de remate (el de esa zona, luego el central, luego el otro). */
  private pickBlockers(team: TeamId, n: number, z: number): string[] {
    const zoneZ = (k: string) => spot(team, zoneSpotFor(this.player(k).def.role, true)).z;
    return this.frontPlayers(team)
      .sort((a, b) => Math.abs(zoneZ(a) - z) - Math.abs(zoneZ(b) - z))
      .slice(0, n);
  }

  /** Posiciones del bloqueo cerrado: los bloqueadores, juntos frente al atacante, en el orden de sus zonas. */
  private blockSpots(block: BlockSetup): Map<string, Vec3> {
    const team = block.team;
    const zoneZ = (k: string) => spot(team, zoneSpotFor(this.player(k).def.role, true)).z;
    const ordered = [...block.keys].sort((a, b) => zoneZ(a) - zoneZ(b));
    const out = new Map<string, Vec3>();
    ordered.forEach((k, i) => {
      const offset = (i - (ordered.length - 1) / 2) * TUNING.block.spacing;
      out.set(k, v3(sideSign(team) * TUNING.contactStance.blockDepth, 0, clamp(block.z + offset, -COURT.halfWidth + 0.3, COURT.halfWidth - 0.3)));
    });
    return out;
  }

  private planTouch(team: TeamId): Plan | null {
    const last = this.last!;
    const n = (this.touchSide === team ? this.touches : 0) + 1;
    if (n > 3) return null;
    if (last.team !== team && !this.isNearlyIn(positionAt(this.ball, landingTime(this.ball)))) return null;
    const exclude = last.team === team && last.kind !== 'block' ? last.key : null;
    const court = this.court(team).filter((k) => k !== exclude);
    const low = [TUNING.passHeight, TUNING.diveHeight];

    if (n === 3) {
      const attacker = this.intent?.key;
      if (attacker && court.includes(attacker)) {
        const r = this.reach(attacker, [attackContactHeight(this.player(attacker).def) - 0.1]);
        if (r) return { key: attacker, team, time: r.time, point: r.point, kind: 'attack', low: false };
      }
      return this.bestContact(team, court, low, 'free');
    }
    if (n === 2) {
      const setter = court.find((k) => this.player(k).def.role === 'S');
      if (setter) {
        const r = this.reach(setter, [TUNING.setHeight]);
        if (r) return { key: setter, team, time: r.time, point: r.point, kind: 'set', low: false };
      }
      return this.bestContact(team, court.filter((k) => k !== setter), [TUNING.setHeight], 'set')
        ?? this.bestContact(team, court, low, 'set', true);
    }
    const kind: ContactKind = last.kind === 'serve' ? 'reception' : 'dig';
    const nonSetters = court.filter((k) => this.player(k).def.role !== 'S');
    return this.bestContact(team, nonSetters, low, kind) ?? this.bestContact(team, court, low, kind);
  }

  private bestContact(team: TeamId, keys: readonly string[], heights: readonly number[], kind: ContactKind, forceLow = false): Plan | null {
    let best: Plan | null = null;
    let bestSlack = -Infinity;
    for (const key of keys) {
      const r = this.reach(key, heights);
      if (r && r.slack > bestSlack) {
        bestSlack = r.slack;
        best = { key, team, time: r.time, point: r.point, kind, low: r.low || forceLow };
      }
    }
    return best;
  }

  /** Primer contacto alcanzable por el jugador entre las alturas dadas (en orden de preferencia). */
  private reach(key: string, heights: readonly number[]): Reach | null {
    const p = this.player(key);
    for (let i = 0; i < heights.length; i++) {
      const time = timeAtHeightDescending(this.ball, heights[i]);
      if (time === null || time < this.time + TUNING.minPlanLead) continue;
      const point = positionAt(this.ball, time);
      if (sideOfX(point.x) !== p.team) continue;
      if (Math.abs(point.x) > COURT.halfLength + 4 || Math.abs(point.z) > COURT.halfWidth + 4) continue;
      const available = time - this.time - TUNING.reactionTime;
      const distance = Math.max(0, distXZ(p.pos, point) - TUNING.reachRadius);
      const slack = available - distance / moveSpeed(p.def);
      if (slack >= 0) return { time, point, slack, low: i > 0 };
    }
    return null;
  }

  /** Resuelve el bloqueo al cruzar la red: cuenta solo a los bloqueadores que llegaron y alcanzan la altura. */
  private planBlock(block: BlockSetup, crossTime: number, userTiming: Timing | null): Plan | null {
    const cfg = TUNING.block;
    const at = positionAt(this.ball, crossTime);
    const available = Math.max(0, crossTime - this.time - cfg.reactionTime);
    const blockers = block.keys
      .map((k) => this.player(k))
      .filter((p) => at.y <= blockReach(p.def))
      .filter((p) => Math.max(0, Math.abs(p.pos.z - at.z) - cfg.handWidth) <= cfg.lateralSpeed * available)
      .sort((a, b) => Math.abs(a.pos.z - at.z) - Math.abs(b.pos.z - at.z));
    const n = blockers.length;
    if (n === 0) return null;
    const plan = (outcome: BlockOutcome): Plan => ({ key: blockers[0].key, team: block.team, time: crossTime, point: at, kind: 'block', low: false, block: outcome });
    if (this.lastShot === 'tool' && this.rng.chance(TUNING.decision.toolBase + TUNING.decision.toolScale * this.last!.quality)) return plan('tool');
    const blockAttr = blockers.reduce((s, p) => s + p.def.attrs.block, 0) / n / 100;
    const userFactor = userTiming ? TUNING.decision.blockTiming[userTiming] : 1;
    const stuff = clamp01((cfg.stuffBase + cfg.stuffScale * blockAttr * (1 - this.last!.quality)) * cfg.nFactor[n] * userFactor);
    const r = this.rng.next();
    if (r < stuff) return plan('stuff');
    if (r < stuff + cfg.touchByN[n]) return plan('soft');
    return null;
  }

  private setFormations(): void {
    const plan = this.plan;
    for (const team of TEAM_IDS) {
      const building = plan !== null && plan.team === team && plan.kind !== 'block' && this.touchSide === team && this.touches >= 1;
      const receivingFirst = plan !== null && plan.team === team && !building;
      const block = [this.blockSetup, this.blockHold].find((b) => b?.team === team) ?? null;
      const blockSpots = block ? this.blockSpots(block) : null;
      this.court(team).forEach((key, idx) => {
        const p = this.player(key);
        // El bloqueador principal no corre al punto de cruce: sigue en su lugar del bloqueo cerrado.
        if (plan && plan.key === key) p.target = plan.kind === 'block' && blockSpots?.has(key) ? blockSpots.get(key)! : this.standPoint(plan);
        else if (building) p.target = this.attackSpot(team, p, idx);
        else if (receivingFirst) {
          if (p.def.role === 'S') p.target = spot(team, SETTER_SPOT);
        } else if (blockSpots?.has(key)) p.target = blockSpots.get(key)!;
        else p.target = this.zoneSpot(team, p, idx, !!block);
      });
    }
  }

  /**
   * Dónde se para quien va a tocar para que la pelota quede en sus manos y no atraviese el cuerpo:
   * en recepción y defensa, delante de la trayectoria (la pelota llega a los brazos estirados);
   * en la colocación, casi debajo con la pelota apenas hacia la red; en el remate, detrás y a la izquierda
   * de la pelota (queda arriba del brazo derecho); en el bloqueo, pegado a la red.
   */
  private standPoint(plan: Plan): Vec3 {
    const pt = plan.point;
    const toNet = -sideSign(plan.team); // signo de x hacia la red
    const right = -sideSign(plan.team); // signo de z del lado derecho mirando la red
    const c = TUNING.contactStance;
    switch (plan.kind) {
      case 'attack':
        return v3(pt.x - toNet * c.spikeBehind, 0, pt.z - right * c.spikeSide);
      case 'set':
        return v3(pt.x - toNet * c.setBehind, 0, pt.z);
      case 'block':
        return v3(sideSign(plan.team) * TUNING.contactStance.blockDepth, 0, pt.z);
      default: {
        const reach = plan.low ? c.diveReach : c.bumpReach;
        const vx = this.ball.v0.x;
        const vz = this.ball.v0.z;
        const len = Math.hypot(vx, vz);
        if (len < 0.5) return v3(pt.x - toNet * reach, 0, pt.z);
        return v3(pt.x + (vx / len) * reach, 0, pt.z + (vz / len) * reach);
      }
    }
  }

  /** Zona de defensa por especialidad; un delantero que no bloquea se retira a defender. */
  private zoneSpot(team: TeamId, p: PlayerState, idx: number, blockActive: boolean): Vec3 {
    const front = isFrontIndex(idx);
    const [depth, right] = zoneSpotFor(p.def.role, front);
    return spot(team, [front && blockActive ? 3.2 : depth, right]);
  }

  private attackSpot(team: TeamId, p: PlayerState, idx: number): Vec3 {
    if (p.def.role === 'S') return spot(team, SETTER_SPOT);
    if (!isFrontIndex(idx)) {
      if (p.def.role === 'OH') return spot(team, APPROACH_SPOTS.pipe);
      if (p.def.role === 'OP') return spot(team, APPROACH_SPOTS.back1);
      return spot(team, zoneSpotFor(p.def.role, false));
    }
    if (p.def.role === 'OH') return spot(team, APPROACH_SPOTS.zone4);
    if (p.def.role === 'MB') return spot(team, APPROACH_SPOTS.quick);
    return spot(team, APPROACH_SPOTS.zone2);
  }

  // ---------- objetivos ----------

  private pickAttackTarget(opp: TeamId, at: Vec3, shot: AttackShot): Vec3 {
    const s = sideSign(opp);
    const lane = at.z === 0 ? (this.rng.chance(0.5) ? 1 : -1) : Math.sign(at.z);
    const defenders = this.court(opp).map((k) => this.player(k).pos);
    let best = v3();
    let bestScore = -Infinity;
    for (let i = 0; i < TUNING.attack.targetSamples; i++) {
      let depth: number;
      let z: number;
      if (shot === 'line' || shot === 'tool') {
        depth = this.rng.range(5, 8.5);
        z = lane * this.rng.range(2.5, 4.2);
      } else if (shot === 'cross') {
        depth = this.rng.range(3.5, 8);
        z = -lane * this.rng.range(0.5, 4.2);
      } else {
        depth = this.rng.range(1, 3);
        z = this.rng.range(-4, 4);
      }
      const candidate = v3(s * depth, COURT.ballRadius, z);
      const score = Math.min(...defenders.map((d) => distXZ(d, candidate)));
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  private errorTarget(opp: TeamId, from: Vec3): Vec3 {
    const s = sideSign(opp);
    if (this.rng.chance(0.5)) return v3(s * 0.05, 1.0, from.z); // a la red
    if (this.rng.chance(0.6)) {
      const z = clamp(from.z + this.rng.range(-2, 2), -COURT.halfWidth, COURT.halfWidth);
      return v3(s * (COURT.halfLength + this.rng.range(0.5, 2.5)), COURT.ballRadius, z); // larga
    }
    const side = this.rng.chance(0.5) ? 1 : -1;
    return v3(s * this.rng.range(3, 8), COURT.ballRadius, side * (COURT.halfWidth + this.rng.range(0.4, 1.5))); // afuera lateral
  }

  private noisy(p: Vec3, radius: number): Vec3 {
    const a = this.rng.range(0, Math.PI * 2);
    const r = radius * Math.sqrt(this.rng.next());
    return v3(p.x + Math.cos(a) * r, p.y, p.z + Math.sin(a) * r);
  }

  private keepOnSide(team: TeamId, p: Vec3): Vec3 {
    const s = sideSign(team);
    return s * p.x < 0.5 ? v3(s * 0.5, p.y, p.z) : p;
  }

  /** Si la trayectoria pega en la red, la levanta (más tiempo de vuelo) hasta que pase. */
  private launchClearing(from: Vec3, to: Vec3, flightTime: number, g: number, t0: number, mustClear: boolean): Trajectory {
    let time = Math.max(0.15, flightTime);
    let tr = launch(from, to, time, t0, g);
    for (let i = 0; mustClear && i < 15; i++) {
      const c = checkNet(tr);
      if (c.kind !== 'fault' || c.reason !== 'net') break;
      time *= 1.1;
      tr = launch(from, to, time, t0, g);
    }
    return tr;
  }

  /** Presión del bloqueo preparado sobre el atacante: más bloqueadores cerca, más presión. */
  private blockPressure(at: Vec3): number {
    const block = this.blockSetup;
    if (!block) return 0;
    const near = block.keys.filter((k) => Math.abs(this.player(k).pos.z - at.z) < 1.5).length;
    return Math.min(0.6, 0.22 * near);
  }

  private isNearlyIn(p: Vec3): boolean {
    return Math.abs(p.x) <= COURT.halfLength + TUNING.letDropMargin && Math.abs(p.z) <= COURT.halfWidth + TUNING.letDropMargin;
  }

  // ---------- fin del rally ----------

  private ballLanded(): void {
    const p = positionAt(this.ball, landingTime(this.ball));
    this.endRally(isInCourt(p) ? sideOfX(p.x) : this.last!.team);
  }

  private endRally(loser: TeamId): void {
    const winner = otherTeam(loser);
    const reason = this.pointReason(loser);
    const out = awardPoint(this.match, winner);
    this.bus.emit({ type: 'point', winner, reason, points: out.points, sets: { ...this.match.sets } });
    if (out.rotated) this.bus.emit({ type: 'rotation', team: out.rotated });
    if (out.setWinner) this.bus.emit({ type: 'setEnd', winner: out.setWinner, sets: { ...this.match.sets } });
    if (out.matchWinner) this.bus.emit({ type: 'matchEnd', winner: out.matchWinner });
    this.phase = 'pointOver';
    this.phaseTimer = TUNING.pointPause;
    this.bounces = 0;
    this.plan = null;
    this.netFaultTime = null;
    this.blockSetup = null;
    this.blockHold = null;
    if (this.decision) this.closeDecision('bad');
  }

  private pointReason(loser: TeamId): PointReason {
    const { kind, team } = this.last!;
    if (team === loser && kind === 'block') return 'blockOut';
    if (team === loser) return kind === 'serve' ? 'serviceError' : kind === 'attack' ? 'attackError' : 'error';
    return kind === 'serve' ? 'ace' : kind === 'attack' ? 'kill' : kind === 'block' ? 'blockKill' : 'landed';
  }
}
