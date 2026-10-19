import type { TeamDef } from '../data/teams';
import { availableSetOptions, type AttackShot, type SetOption, type Zone } from './actions';
import { chooseServe, chooseSet, chooseShot } from './ai';
import { checkNet, landingTime, launch, positionAt, timeAtHeightDescending, type Trajectory } from './ball';
import { COURT, GRAVITY, isInCourt, otherTeam, sideOfX, sideSign, toWorld, type TeamId } from './court';
import { judgeServe, judgeTiming, serveMeter, type Decision, type DecisionKind, type DecisionOption, type UserOption } from './decision';
import { EventBus, type ContactKind, type PointReason } from './events';
import { APPROACH_SPOTS, ATTACK_POINTS, DEFENSE_SPOTS, RECEIVE_SPOTS, SERVE_SPOT, SETTER_SPOT, ZONE_SPOTS, spot } from './formation';
import { awardPoint, courtPlayers, createMatch, isFrontIndex, type MatchState, type TeamSetup } from './match';
import { attackContactHeight, blockReach, moveSpeed, type PlayerState, type Role } from './players';
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
  /** Jugador controlado por el usuario (siempre en el equipo A). */
  user?: { role: Role };
}

export type Phase = 'preServe' | 'inPlay' | 'pointOver' | 'matchOver';

type BlockOutcome = 'stuff' | 'soft' | 'tool';

/** Decisión del usuario ya resuelta para un contacto: opción (null = la IA decide) y timing. */
interface Control {
  option: UserOption | null;
  timing: Timing;
}

const USER_TEAM: TeamId = 'A';

const SET_LABELS: Record<SetOption, string> = {
  zone4: 'Punta (zona 4)',
  zone2: 'Opuesto (zona 2)',
  quick: 'Rápida al central',
  pipe: 'Pipe (zaguero)',
};

interface Touch {
  key: string;
  team: TeamId;
  kind: ContactKind;
  quality: number;
}

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
  phase: Phase = 'preServe';
  time = 0;
  ball: Trajectory = { p0: v3(), v0: v3(), t0: 0, g: GRAVITY };
  ballPos: Vec3 = v3();
  readonly userKey: string | null;
  /** Decisión pendiente del usuario. La UI la lee y responde con `choose`, `setServeZone` y `press`. */
  decision: Decision | null = null;

  private readonly rng: Rng;
  private phaseTimer = 0;
  private plan: Plan | null = null;
  private netFaultTime: number | null = null;
  private last: Touch | null = null;
  private touchSide: TeamId = 'A';
  private touches = 0;
  /** Dificultad de la pelota entrante para quien la recibe (0..1). */
  private threat = 0;
  private intent: { key: string } | null = null;
  private lastShot: AttackShot = 'cross';

  constructor(opts: SimOptions) {
    this.rng = createRng(opts.seed);
    this.teams = { A: opts.teamA, B: opts.teamB };
    this.userKey = opts.user ? `${USER_TEAM}:${this.userPlayerId(opts.user.role)}` : null;
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

  /** Multiplicador de tiempo para el bucle en tiempo real: cámara lenta cerca de un contacto con decisión. */
  get timeScale(): number {
    const d = this.decision;
    if (!d || d.contactTime === null) return 1;
    return d.contactTime - this.time <= TUNING.decision.slowWindow ? TUNING.decision.slowScale : 1;
  }

  /** Elige una opción. Se puede cambiar mientras no se haya presionado el timing. */
  choose(index: number): void {
    const d = this.decision;
    if (!d || d.pressedAt !== null || index < 0 || index >= d.options.length) return;
    d.chosen = index;
  }

  setServeZone(zone: Zone): void {
    const d = this.decision;
    if (d && d.kind === 'serve' && d.pressedAt === null) d.zone = zone;
  }

  /** Presiona el timing. En el saque, saca de inmediato. */
  press(): void {
    const d = this.decision;
    if (!d || d.chosen === null || d.pressedAt !== null) return;
    d.pressedAt = this.time;
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
        const server = this.court(this.match.serving)[0];
        if (server !== this.userKey) this.serve();
        else if (!this.decision) this.openDecision('serve', this.serveOptions(), null);
        else if (this.time - this.decision.startTime > TUNING.decision.serveTimeout) this.serve();
      }
    } else if (this.phase === 'inPlay') {
      this.ballPos = positionAt(this.ball, this.time);
      if (this.netFaultTime !== null) {
        if (this.time >= this.netFaultTime) this.endRally(this.last!.team);
      } else if (this.plan) {
        if (this.time >= this.plan.time) this.executeContact(this.plan);
      } else if (this.time >= landingTime(this.ball)) {
        this.ballLanded();
      }
    } else {
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
    // Si el usuario es central, el líbero no lo sustituye: siempre está en cancha.
    const liberoReplaces = d.liberoReplaces.map(k).filter((key) => key !== this.userKey);
    return { lineup: d.lineup.map(k), libero: k(d.libero), liberoReplaces };
  }

  private userPlayerId(role: Role): string {
    const d = this.teams[USER_TEAM];
    if (role === 'L') return d.libero;
    const id = d.lineup.find((pid) => d.roster.find((p) => p.id === pid)!.role === role);
    if (!id) throw new Error(`El lineup no tiene rol ${role}`);
    return id;
  }

  // ---------- decisiones del usuario ----------

  private openDecision(kind: DecisionKind, options: DecisionOption[], contactTime: number | null): void {
    this.decision = { kind, options, contactTime, startTime: this.time, chosen: null, pressedAt: null, zone: null };
    this.bus.emit({ type: 'decision', decision: this.decision });
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

  /** Abre una decisión si el próximo contacto es del usuario, o si puede bloquear el remate rival. */
  private openDecisionFor(plan: Plan | null): void {
    if (!this.userKey || !plan || this.decision) return;
    if (plan.key === this.userKey && plan.kind !== 'block') {
      const options = this.contactOptions(plan);
      const kind: DecisionKind = plan.kind === 'reception' || plan.kind === 'dig' ? 'pass' : plan.kind === 'set' ? 'set' : 'attack';
      this.openDecision(kind, options, plan.time);
    } else if (plan.kind === 'attack' && plan.team !== USER_TEAM && this.userCanBlock()) {
      this.openDecision('block', [
        { label: 'Bloquear', option: { id: 'block', jump: true } },
        { label: 'No bloquear (cubrir)', option: { id: 'block', jump: false } },
      ], plan.time);
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
          options.push({ label: 'Segunda (ataque directo)', option: { id: 'dump' } });
        }
        return options;
      }
      case 'attack':
        return [
          { label: 'Remate cruzado', option: { id: 'shot', shot: 'cross' } },
          { label: 'Remate en línea', option: { id: 'shot', shot: 'line' } },
          { label: 'Finta', option: { id: 'shot', shot: 'tip' } },
          { label: 'Usar el bloqueo', option: { id: 'shot', shot: 'tool' } },
        ];
      default:
        return [{ label: 'Mandar pelota', option: { id: 'free' } }];
    }
  }

  private userCanBlock(): boolean {
    const court = this.court(USER_TEAM);
    const idx = court.indexOf(this.userKey!);
    return idx >= 0 && isFrontIndex(idx) && this.player(this.userKey!).def.role !== 'L';
  }

  /** Timing perfecto del usuario: bono de calidad. La IA (userTiming undefined) no lo recibe. */
  private boosted(q: number, userTiming: Timing | undefined): number {
    return userTiming === 'perfect' ? Math.min(1, q + TUNING.decision.perfectBonus) : q;
  }

  /** Consume la decisión del usuario para este contacto. */
  private resolveDecision(plan: Plan): Control | undefined {
    const d = this.decision;
    if (!d || plan.key !== this.userKey || d.kind === 'block' || d.kind === 'serve') return undefined;
    const option = d.chosen === null ? null : d.options[d.chosen].option;
    const timing = d.chosen === null ? 'bad' : judgeTiming(d.pressedAt, plan.time);
    this.closeDecision(timing);
    return { option, timing };
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
    for (const p of this.players.values()) {
      const dx = p.target.x - p.pos.x;
      const dz = p.target.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-6) continue;
      const len = Math.min(d, moveSpeed(p.def) * dt);
      p.pos.x += (dx / d) * len;
      p.pos.z += (dz / d) * len;
    }
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
      timing = rollTiming(this.rng);
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
      { base: low ? cfg.lowContactBase : cfg.base, prevQuality: 1, timing: ctl?.timing ?? rollTiming(this.rng), attribute, pressure: this.threat },
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
      { base: low ? TUNING.pass.lowContactBase : cfg.base, prevQuality: passQuality, timing: ctl?.timing ?? rollTiming(this.rng), attribute: p.def.attrs.setting, pressure: 0 },
      this.rng,
    );
    q = this.boosted(q, ctl?.timing);
    this.registerTouch(p, 'set', q);
    const outOfSystem = low || passQuality < cfg.outOfSystemPass;
    const [depth, right] = ATTACK_POINTS[choice.option];
    const point = toWorld(p.team, outOfSystem ? Math.max(depth, 2.0) : depth, right, attackContactHeight(attacker.def) - 0.1);
    const target = this.keepOnSide(p.team, this.noisy(point, cfg.noise * (1 - q)));
    this.ball = launch(at, target, outOfSystem ? cfg.rescueFlightTime : cfg.flightTime[choice.option], t);
    this.intent = { key: attacker.key };
    this.threat = 0;
  }

  private doAttack(p: PlayerState, at: Vec3, t: number, ctl?: Control): void {
    const cfg = TUNING.attack;
    const opp = otherTeam(p.team);
    const shot = ctl?.option?.id === 'shot' ? ctl.option.shot : chooseShot(this.rng);
    let q = computeQuality(
      {
        base: cfg.base,
        prevQuality: this.last!.quality,
        timing: ctl?.timing ?? rollTiming(this.rng),
        attribute: (p.def.attrs.attackPower + p.def.attrs.attackAccuracy) / 2,
        pressure: this.blockPressure(opp, at),
      },
      this.rng,
    );
    q = this.boosted(q, ctl?.timing);
    this.registerTouch(p, 'attack', q);
    this.lastShot = shot;
    this.intent = null;
    const isError = this.rng.chance(errorChance(cfg.shots[shot].risk, q));
    const target = isError
      ? this.errorTarget(opp, at)
      : this.keepOnSide(opp, this.noisy(this.pickAttackTarget(opp, at, shot), cfg.noise * (1 - q)));
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
      { base: 0.9, prevQuality, timing: ctl?.timing ?? rollTiming(this.rng), attribute: p.def.attrs.reception, pressure: this.threat },
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

  // ---------- planificación ----------

  private planNext(): void {
    this.plan = null;
    this.netFaultTime = null;
    const last = this.last!;
    // Una decisión de bloqueo se consume con el remate rival, haya o no bloqueo.
    const blockDecision = last.kind === 'attack' && this.decision?.kind === 'block' ? this.decision : null;
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
      if (last.kind === 'attack' && this.lastShot !== 'tip') {
        if (blockDecision && blockDecision.chosen !== null) blockTiming = judgeTiming(blockDecision.pressedAt, blockDecision.contactTime!);
        this.plan = this.planBlock(otherTeam(last.team), net.time, blockDecision, blockTiming);
      }
      this.plan ??= this.planTouch(otherTeam(sideOfX(this.ball.p0.x)));
    }
    if (blockDecision) this.closeDecision(blockTiming);
    this.setFormations();
    this.openDecisionFor(this.plan);
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

  private planBlock(team: TeamId, crossTime: number, userDecision: Decision | null, userTiming: Timing): Plan | null {
    const cfg = TUNING.block;
    const at = positionAt(this.ball, crossTime);
    const available = Math.max(0, crossTime - this.time - cfg.reactionTime);
    const userOption = userDecision && userDecision.chosen !== null ? userDecision.options[userDecision.chosen].option : null;
    const userStays = userOption?.id === 'block' && !userOption.jump;
    const candidates = this.court(team)
      .filter((_, i) => isFrontIndex(i))
      .map((k) => this.player(k))
      .filter((p) => !(userStays && p.key === this.userKey))
      .filter((p) => p.def.role !== 'L' && at.y <= blockReach(p.def))
      .filter((p) => Math.max(0, Math.abs(p.pos.z - at.z) - cfg.handWidth) <= cfg.lateralSpeed * available)
      .sort((a, b) => Math.abs(a.pos.z - at.z) - Math.abs(b.pos.z - at.z));
    // Si el usuario decidió bloquear y llega, es el bloqueador principal.
    const userIdx = userDecision ? candidates.findIndex((p) => p.key === this.userKey) : -1;
    if (userIdx > 0) candidates.unshift(...candidates.splice(userIdx, 1));
    const blockers = candidates.slice(0, 2);
    if (blockers.length === 0) return null;
    if (this.lastShot === 'tool' && this.rng.chance(TUNING.decision.toolBase + TUNING.decision.toolScale * this.last!.quality)) {
      return { key: blockers[0].key, team, time: crossTime, point: at, kind: 'block', low: false, block: 'tool' };
    }
    const blockAttr = blockers.reduce((s, p) => s + p.def.attrs.block, 0) / blockers.length / 100;
    const userFactor = userIdx >= 0 ? TUNING.decision.blockTiming[userTiming] : 1;
    const stuff = clamp01((cfg.stuffBase + cfg.stuffScale * blockAttr * (1 - this.last!.quality)) * (blockers.length === 2 ? cfg.doubleBonus : 1) * userFactor);
    const r = this.rng.next();
    const outcome: BlockOutcome | null = r < stuff ? 'stuff' : r < stuff + cfg.touchChance ? 'soft' : null;
    if (!outcome) return null;
    return { key: blockers[0].key, team, time: crossTime, point: at, kind: 'block', low: false, block: outcome };
  }

  private setFormations(): void {
    const plan = this.plan;
    for (const team of TEAM_IDS) {
      const building = plan !== null && plan.team === team && plan.kind !== 'block' && this.touchSide === team && this.touches >= 1;
      const receivingFirst = plan !== null && plan.team === team && !building;
      this.court(team).forEach((key, idx) => {
        const p = this.player(key);
        if (plan && plan.key === key) p.target = v3(plan.point.x, 0, plan.point.z);
        else if (building) p.target = this.attackSpot(team, p, idx);
        else if (receivingFirst) {
          if (p.def.role === 'S') p.target = spot(team, SETTER_SPOT);
        } else p.target = spot(team, DEFENSE_SPOTS[idx]);
      });
    }
  }

  private attackSpot(team: TeamId, p: PlayerState, idx: number): Vec3 {
    if (p.def.role === 'S') return spot(team, SETTER_SPOT);
    if (!isFrontIndex(idx)) return spot(team, p.def.role === 'OH' ? APPROACH_SPOTS.pipe : DEFENSE_SPOTS[idx]);
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

  private blockPressure(opp: TeamId, at: Vec3): number {
    const near = this.court(opp).filter((k, i) => isFrontIndex(i) && Math.abs(this.player(k).pos.z - at.z) < 1.5).length;
    return Math.min(0.6, 0.3 * near);
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
    this.plan = null;
    this.netFaultTime = null;
    if (this.decision) this.closeDecision('bad');
  }

  private pointReason(loser: TeamId): PointReason {
    const { kind, team } = this.last!;
    if (team === loser && kind === 'block') return 'blockOut';
    if (team === loser) return kind === 'serve' ? 'serviceError' : kind === 'attack' ? 'attackError' : 'error';
    return kind === 'serve' ? 'ace' : kind === 'attack' ? 'kill' : kind === 'block' ? 'blockKill' : 'landed';
  }
}
