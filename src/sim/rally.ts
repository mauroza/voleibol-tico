import type { TeamDef } from '../data/teams';
import { SET_LABELS, SET_TEMPO, availableSetOptions, type AttackShot, type ServeType, type SetOption, type Zone } from './actions';
import { chooseBlockScheme, chooseServe, chooseSet, chooseShot } from './ai';
import { checkNet, landingTime, launch, positionAt, timeAtHeightDescending, type Trajectory } from './ball';
import { COURT, GRAVITY, isInCourt, otherTeam, sideOfX, sideSign, toWorld, type TeamId } from './court';
import { contactMeter, judgeTiming, meterOf, powerTiming, powerZone, serveMeter, tempoOf, type Decision, type DecisionKind, type DecisionOption, type Power, type UserOption } from './decision';
import { EventBus, type ContactKind, type PointReason } from './events';
import { APPROACH_SPOTS, ATTACK_POINTS, DEFENSE_SPOTS, LIBERO_SET_SPOT, SERVE_SPOT, SETTER_SPOT, ZONE_SPOTS, receiveFormation, spot, zoneSpotFor } from './formation';
import { awardPoint, courtPlayers, createMatch, isFrontIndex, type MatchState, type TeamSetup } from './match';
import { AVG_HEIGHT, attackContactHeight, blockReach, moveSpeed, type PlayerState } from './players';
import { computeQuality, errorChance, rollTiming, type Timing } from './resolver';
import { createRng, type Rng } from './rng';
import { TUNING } from './tuning';
import { clamp, clamp01, clone, distXZ, v3, type Vec3 } from './vec';

export type TempoProfile = keyof typeof TUNING.decision.profiles;

export interface SimOptions {
  seed: number;
  setsToWin: 1 | 2;
  teamA: TeamDef;
  teamB: TeamDef;
  firstServer?: TeamId;
  /** Ritmo de las decisiones (por defecto, el clásico con cámara lenta marcada). */
  tempo?: TempoProfile;
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
  /** Zona de la barra de fuerza (remate apuntado). */
  power?: Power;
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
  /** Plancha: se lanza al piso para salvarla. */
  dive?: boolean;
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
  /** Marca de defensa del usuario y el defensor que la cubre. */
  focus?: { x: number; z: number } | null;
  focusKey?: string | null;
}

interface Reach {
  time: number;
  point: Vec3;
  slack: number;
  low: boolean;
  dive?: boolean;
}

const TEAM_IDS: readonly TeamId[] = ['A', 'B'];

export class Simulation {
  readonly bus = new EventBus();
  readonly match: MatchState;
  readonly players = new Map<string, PlayerState>();
  readonly teams: Record<TeamId, TeamDef>;
  readonly control: TeamId | null;
  readonly tempo: TempoProfile;
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
  /** Central delantero que corre y salta la rápida como finta mientras la pelota va a otro atacante. */
  private decoyRun: { key: string; time: number } | null = null;
  /** Saque en curso: lanzamiento y carrera hasta el golpe en `at`. */
  private pendingServe: { type: ServeType; zone: Zone; timing: Timing; aim: { x: number; z: number } | null; at: number; user: boolean; from: Vec3 } | null = null;
  /** Saque que hará la IA en este punto (para animarlo antes). */
  private aiServe: { type: ServeType; zone: Zone } | null = null;
  /** Tipo del último saque (la pelota del flotado baila; la del de suspensión gira). */
  servedType: ServeType | null = null;
  /** El contacto en curso es una plancha. */
  private diving = false;
  /** Autor de cada uno de los últimos puntos (null si fue error rival o no hubo autor claro), por equipo. */
  private readonly scorers: Record<TeamId, (string | null)[]> = { A: [], B: [] };
  private lastAttacker: string | null = null;
  /** El último remate fue apuntado por el usuario. */
  private lastAimed = false;
  private lastShot: AttackShot = 'cross';
  private blockSetup: BlockSetup | null = null;
  /** Bloqueo ya consumido por el remate: los bloqueadores mantienen su lugar hasta el siguiente toque. */
  private blockHold: BlockSetup | null = null;

  constructor(opts: SimOptions) {
    this.rng = createRng(opts.seed);
    this.difficulty = opts.difficulty ?? 'normal';
    this.control = opts.control ?? null;
    this.tempo = opts.tempo ?? 'clasico';
    this.teams = { A: opts.teamA, B: opts.teamB };
    for (const team of TEAM_IDS) {
      for (const def of this.teams[team].roster) {
        const key = `${team}:${def.id}`;
        this.players.set(key, { key, def, team, pos: v3(), target: v3(), stamina: 1 });
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
  /** Finta de rápida en curso: quién y cuándo salta. */
  get decoy(): Readonly<{ key: string; time: number }> | null {
    return this.decoyRun;
  }

  /** En racha: anotó muchos de los últimos puntos de su equipo (aura roja). */
  onFire(key: string): boolean {
    const team = this.player(key).team;
    return this.scorers[team].filter((k) => k === key).length >= TUNING.fire.points;
  }

  /** Cansa a un jugador (nunca por debajo del piso de estamina). */
  private tire(key: string, cost: number): void {
    const p = this.player(key);
    p.stamina = Math.max(TUNING.stamina.floor, p.stamina - cost);
  }

  /** Atributo efectivo: el cansancio lo baja y la racha lo sube. */
  private attr(p: PlayerState, value: number): number {
    const s = TUNING.stamina;
    const fire = this.onFire(p.key) ? 1 + TUNING.fire.bonus : 1;
    return value * (s.attrAtZero + (1 - s.attrAtZero) * p.stamina) * fire;
  }

  /** Último contacto (para efectos visuales de la pelota). */
  get lastContact(): Readonly<{ key: string; team: TeamId; kind: ContactKind; quality: number }> | null {
    return this.last;
  }

  get upcoming(): Readonly<PlannedContact> | null {
    return this.plan;
  }

  /** Bloqueo preparado contra el próximo remate (solo lectura, para el render). */
  get blockers(): Readonly<BlockSetup> | null {
    return this.blockSetup;
  }

  /** Segundos hasta el saque de la IA (para animar el lanzamiento); null si no hay saque automático pendiente. */
  get serveCountdown(): number | null {
    const seq = this.serveSequence;
    return seq ? Math.max(0, seq.contactTime - this.time) : null;
  }

  /** Saque que se viene: tipo e instante del golpe (null mientras el usuario no decide). */
  get serveSequence(): { type: ServeType; contactTime: number } | null {
    if (this.phase !== 'preServe') return null;
    if (this.pendingServe) return { type: this.pendingServe.type, contactTime: this.pendingServe.at };
    if (this.aiServe) return { type: this.aiServe.type, contactTime: this.time + Math.max(0, this.phaseTimer) + TUNING.serveWindup[this.aiServe.type] };
    return null;
  }

  /**
   * Multiplicador de tiempo para el bucle en tiempo real. Con una decisión pendiente: casi detenido mientras el usuario
   * no elige, acercamiento cuando ya eligió y cámara lenta en los últimos instantes para el timing.
   */
  get timeScale(): number {
    const d = this.decision;
    if (!d || d.contactTime === null) return 1;
    const cfg = TUNING.decision;
    const p = cfg.profiles[this.tempo];
    if (d.chosen === null) return p.think;
    const near = d.contactTime - this.time <= (d.kind === 'set' ? cfg.setWindow : cfg.slowWindow);
    if (d.aim && d.kind !== 'block') return near ? p.aimSlow : p.aimApproach;
    return near ? p.slow : p.approach;
  }

  /** Elige una opción. Se puede cambiar mientras no se haya presionado el timing. */
  choose(index: number): void {
    const d = this.decision;
    if (!d || d.pressedAt !== null || index < 0 || index >= d.options.length) return;
    d.chosen = index;
    const opt = d.options[index].option;
    if (d.kind === 'set' && d.aim) {
      d.locked = true;
      const at = this.setOptionPoint(d, index);
      d.aim = { x: at.x, z: at.z };
    }
    if (d.kind === 'block' && opt.id === 'block' && this.blockSetup) {
      this.blockSetup.scheme = opt.n;
      this.blockSetup.keys = this.pickBlockers(this.blockSetup.team, opt.n, this.blockSetup.z);
      this.setFormations();
    }
  }

  /**
   * Mueve la mira: remate y saque en el campo rival (puede apuntarse afuera), pase y marca de defensa en el propio.
   */
  setAim(x: number, z: number): void {
    const d = this.decision;
    if (!d || !d.aim || !d.aimSide || d.pressedAt !== null) return;
    const s = sideSign(d.aimSide);
    const own = d.aimSide === this.player(d.playerKey).team;
    const depth = own ? COURT.halfLength + 0.5 : COURT.halfLength + 2;
    const width = own ? COURT.halfWidth + 0.5 : COURT.halfWidth + 1.5;
    // La colocación puede apuntar al campo rival: es la segunda del colocador.
    const near = d.kind === 'set' ? -4 : 0.3;
    d.aim = { x: s * clamp(s * x, near, depth), z: clamp(z, -width, width) };
    if (d.kind === 'set') {
      d.locked = false;
      d.chosen = this.setOptionAt(d, null);
    }
    if (d.kind === 'block' && this.blockSetup) {
      this.blockSetup.focus = { ...d.aim };
      this.setFormations();
    }
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
    if (d.kind === 'serve' && this.phase === 'preServe') this.beginUserServe();
  }

  step(dt: number): void {
    if (this.phase === 'matchOver') return;
    this.time += dt;
    this.movePlayers(dt);
    if (this.phase === 'preServe') {
      this.ballPos = this.serverHand();
      if (this.pendingServe) {
        this.runUp(this.pendingServe);
        if (this.time >= this.pendingServe.at) this.serve();
      } else {
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          if (this.match.serving !== this.control) {
            const ai = this.aiServe ?? chooseServe(this.rng, this.player(this.court(this.match.serving)[0]).def);
            this.beginServe(ai.type, ai.zone, this.aiTiming(this.match.serving), null, false);
          } else if (!this.decision) this.openServeDecision();
          else if (this.time - this.decision.startTime > TUNING.decision.serveTimeout) this.beginUserServe();
        }
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
    this.pendingServe = null;
    this.aiServe = this.match.serving !== this.control ? chooseServe(this.rng, this.player(courtPlayers(this.match, this.match.serving)[0]).def) : null;
    this.plan = null;
    this.netFaultTime = null;
    this.last = null;
    this.intent = null;
    this.decoyRun = null;
    this.threat = 0;
    this.decision = null;
    this.blockSetup = null;
    this.blockHold = null;
    this.touchSide = this.match.serving;
    this.touches = 0;
    for (const team of TEAM_IDS) {
      const court = this.court(team);
      const receiving = team !== this.match.serving;
      const reception = receiveFormation(court.map((k) => this.player(k).def.role));
      let bench = 0;
      for (const p of this.players.values()) {
        if (p.team !== team) continue;
        const idx = court.indexOf(p.key);
        let target: Vec3;
        // Ambas bancas del lado lejano de la cámara de transmisión (z negativo).
        if (idx < 0) target = v3(sideSign(team) * (2.5 + 0.7 * bench++), 0, -6.5);
        else if (!receiving && idx === 0) target = spot(team, SERVE_SPOT);
        else target = spot(team, receiving ? reception[idx] : DEFENSE_SPOTS[idx]);
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
    const decoy = this.decoyRun;
    if (decoy && this.time > decoy.time + 0.5) this.decoyRun = null;
    else if (decoy) {
      // Carrera de la finta: llega a la zona de la rápida justo para saltar con la colocación.
      const p = this.player(decoy.key);
      const [depth, right] = ATTACK_POINTS.quick;
      const stand = spot(p.team, [depth + TUNING.contactStance.spikeBehind, right]);
      const runTime = distXZ(p.pos, stand) / moveSpeed(p.def) + 0.15;
      p.target = decoy.time - this.time > runTime ? v3(p.pos.x, 0, p.pos.z) : stand;
    }
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
    // El remate de la figura pica y rebota mucho más (solo el primer pique).
    const last = this.last;
    const star = this.bounces === 0 && last?.kind === 'attack' && this.lastShot !== 'tip' && !!this.player(last.key).def.star;
    const restitution = star ? TUNING.attack.starRestitution : TUNING.bounce.restitution;
    this.ball = {
      p0: v3(p.x, COURT.ballRadius, p.z),
      v0: v3(this.ball.v0.x * TUNING.bounce.friction, -vy * restitution, this.ball.v0.z * TUNING.bounce.friction),
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
    const decision: Decision = { kind, playerKey, options, contactTime, startTime: this.time, chosen: null, pressedAt: null, zone: null, aim: null, aimSide: null, meter: 'timing' };
    this.decision = decision;
    this.bus.emit({ type: 'decision', decision });
  }

  private closeDecision(timing: Timing, power?: Power, label?: string): void {
    const d = this.decision!;
    this.decision = null;
    this.bus.emit({ type: 'decisionResolved', kind: d.kind, timing, power, label });
  }

  /** Saque apuntado: la mira empieza en la zona 1 rival; la fuerza (verde, amarillo, rojo) decide el tipo de saque. */
  private openServeDecision(): void {
    const team = this.match.serving;
    const opp = otherTeam(team);
    this.openDecision('serve', [{ label: 'Saque apuntado', option: { id: 'serve', type: 'float' } }], null, this.court(team)[0]);
    const d = this.decision as Decision | null;
    if (!d) return;
    const start = spot(opp, ZONE_SPOTS[1]);
    this.aimDecision(d, { x: start.x, z: start.z }, opp, 'power');
  }

  /** Punto de la cancha de una opción de colocación (donde golpeará el atacante; la segunda, sobre la red rival). */
  setOptionPoint(d: Decision, index: number): Vec3 {
    const opt = d.options[index].option;
    const team = this.player(d.playerKey).team;
    if (opt.id === 'set') return spot(team, ATTACK_POINTS[opt.choice.option]);
    const p = this.player(d.playerKey).pos;
    return v3(-sideSign(team) * 1.5, 0, p.z);
  }

  /**
   * Opción de colocación hacia donde apunta la mira: el atacante más cercano a la mira y, de sus colocaciones,
   * la del tempo más parecido (`tempo` null: la primera). Mira en el campo rival: la segunda, si está disponible.
   */
  setOptionAt(d: Decision, tempo: number | null): number {
    const team = this.player(d.playerKey).team;
    const aim = d.aim!;
    const dump = d.options.findIndex((o) => o.option.id === 'dump');
    if (sideSign(team) * aim.x < 0 && dump >= 0) return dump;
    // Primero el atacante: el de la colocación más cercana a la mira.
    let attacker: string | null = null;
    let near = Infinity;
    d.options.forEach((o) => {
      if (o.option.id !== 'set') return;
      const at = spot(team, ATTACK_POINTS[o.option.choice.option]);
      const dist = Math.hypot(at.x - aim.x, at.z - aim.z);
      if (dist < near) {
        near = dist;
        attacker = o.option.choice.attackerKey;
      }
    });
    // Después, de sus colocaciones, la del tempo más parecido (en empate, la más alta: más segura).
    let best = 0;
    let bestScore = Infinity;
    d.options.forEach((o, i) => {
      if (o.option.id !== 'set' || o.option.choice.attackerKey !== attacker) return;
      const t = SET_TEMPO[o.option.choice.option];
      const score = (tempo === null ? 0 : Math.abs(t - tempo)) + t * 0.01;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return best;
  }

  /** Colocación que saldría si se presiona ahora (para mostrarla en la cancha). */
  get setPreview(): number | null {
    const d = this.decision;
    if (!d || d.kind !== 'set' || !d.aim || d.contactTime === null) return null;
    if (d.locked) return d.chosen;
    return this.setOptionAt(d, tempoOf(powerZone(meterOf(d, this.time))));
  }

  /** Configura la mira de una decisión ya abierta (queda "elegida": se apunta y se presiona). */
  private aimDecision(d: Decision, aim: { x: number; z: number }, side: TeamId, meter: 'timing' | 'power'): void {
    d.aim = aim;
    d.aimSide = side;
    d.meter = meter;
    d.chosen = 0;
  }

  /** Abre una decisión si el próximo contacto es del equipo controlado, o el esquema de bloqueo ante el remate rival. */
  private openDecisionFor(plan: Plan | null): void {
    if (!this.control || !plan || this.decision) return;
    if (plan.team === this.control && plan.kind !== 'block') {
      const kind: DecisionKind = plan.kind === 'reception' || plan.kind === 'dig' ? 'pass' : plan.kind === 'set' ? 'set' : 'attack';
      this.openDecision(kind, this.contactOptions(plan), plan.time, plan.key);
      const opened = this.decision as Decision | null;
      if (opened && plan.kind === 'attack') {
        // Remate apuntado: la mira empieza en el mejor hueco; la barra es la fuerza.
        const t = this.pickAttackTarget(otherTeam(plan.team), plan.point, 'cross');
        this.aimDecision(opened, { x: t.x, z: t.z }, otherTeam(plan.team), 'power');
      } else if (opened && plan.kind === 'free') {
        // Balón libre: se apunta a dónde mandarla en el campo rival; la barra es el timing.
        const deep = spot(otherTeam(plan.team), [7, 0]);
        this.aimDecision(opened, { x: deep.x, z: deep.z }, otherTeam(plan.team), 'timing');
      } else if (opened && plan.kind === 'set') {
        // Abanico de colocación: la mira elige al atacante y la barra, el tempo (alta, media, rápida).
        const first = this.setOptionPoint(opened, 0);
        this.aimDecision(opened, { x: first.x, z: first.z }, plan.team, 'power');
      } else if (opened && (plan.kind === 'reception' || plan.kind === 'dig')) {
        // Pase dirigido: la mira empieza donde está el colocador (si recibe el colocador, donde coloca el líbero).
        const s = spot(plan.team, this.player(plan.key).def.role === 'S' ? LIBERO_SET_SPOT : SETTER_SPOT);
        this.aimDecision(opened, { x: s.x, z: s.z }, plan.team, 'timing');
      }
    } else if (plan.kind === 'attack' && plan.team !== this.control && this.blockSetup?.team === this.control) {
      const front = this.frontPlayers(this.control);
      if (front.length === 0) return;
      const labels = ['Sin bloqueo (defender)', 'Bloqueo simple', 'Bloqueo doble', 'Bloqueo triple'];
      const options: DecisionOption[] = [3, 2, 1, 0]
        .filter((n) => n <= front.length)
        .map((n) => ({ label: labels[n], option: { id: 'block', n } }));
      this.openDecision('block', options, plan.time, this.blockSetup.keys[0] ?? front[0]);
      // Marca de defensa: dónde espera el remate; un defensor la cubre (se mueve con la mira).
      const d = this.decision as Decision | null;
      if (d) {
        const f = spot(this.control, [6.5, 0]);
        d.aim = { x: f.x, z: f.z };
        d.aimSide = this.control;
        this.blockSetup.focus = { ...d.aim };
        this.setFormations();
      }
    }
  }

  private contactOptions(plan: Plan): DecisionOption[] {
    const p = this.player(plan.key);
    switch (plan.kind) {
      case 'reception':
      case 'dig':
        return [{ label: 'Pase dirigido', option: { id: 'pass', high: false } }];
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
    if (d.kind === 'set' && d.aim) {
      const power = d.pressedAt === null ? null : powerZone(meterOf(d, this.time));
      const index = d.locked ? d.chosen! : this.setOptionAt(d, power === null ? null : tempoOf(power));
      const timing: Timing = power === null ? 'bad' : powerTiming(power);
      this.closeDecision(timing, undefined, d.options[index].label);
      return { option: d.options[index].option, timing, aim: null };
    }
    const option = d.chosen === null ? null : d.options[d.chosen].option;
    let timing: Timing = d.chosen === null ? 'bad' : judgeTiming(d.pressedAt, plan.time);
    let power: Power | undefined;
    if (d.meter === 'power') {
      power = d.pressedAt === null ? 'medium' : powerZone(contactMeter(d.pressedAt, plan.time));
      timing = d.pressedAt === null ? 'bad' : powerTiming(power);
    }
    const aim = d.aim;
    this.closeDecision(timing, power);
    return { option, timing, aim, power };
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
    const cost = TUNING.stamina.cost;
    if (kind === 'attack') {
      this.lastAttacker = p.key;
      this.tire(p.key, Math.abs(p.pos.x) > 3 ? cost.backAttack : cost.attack);
    } else if (kind === 'set') this.tire(p.key, cost.set);
    else if (kind === 'reception' || kind === 'dig' || kind === 'free') this.tire(p.key, this.diving ? cost.dive : cost.pass);
    this.bus.emit({ type: 'contact', time: this.time, playerKey: p.key, team: p.team, kind, quality });
  }

  /** El usuario presionó (o se le acabó el tiempo): la barra decide el tipo y empieza la secuencia. */
  private beginUserServe(): void {
    const d = this.decision?.kind === 'serve' ? this.decision : null;
    if (!d || this.pendingServe) return;
    // La posición del medidor al presionar es la fuerza: verde = seguro, amarillo = flotado en salto, rojo = suspensión.
    const power: Power = d.pressedAt === null ? 'medium' : powerZone(serveMeter(d.pressedAt - d.startTime));
    const timing: Timing = d.pressedAt === null ? 'bad' : powerTiming(power);
    const aim = d.aim;
    this.closeDecision(timing, power);
    this.beginServe(TUNING.power.serveType[power], 1, timing, aim, true);
  }

  private beginServe(type: ServeType, zone: Zone, timing: Timing, aim: { x: number; z: number } | null, user: boolean): void {
    const server = this.player(this.court(this.match.serving)[0]);
    this.pendingServe = { type, zone, timing, aim, at: this.time + TUNING.serveWindup[type], user, from: clone(server.pos) };
  }

  /** Carrera del sacador hacia la red en el final de la secuencia (salta desde atrás de la línea de fondo). */
  private runUp(ps: NonNullable<Simulation['pendingServe']>): void {
    const run = TUNING.serveRunUp[ps.type];
    if (run <= 0) return;
    const server = this.player(this.court(this.match.serving)[0]);
    const runTime = TUNING.serveRunTime[ps.type];
    const k = clamp01((this.time - (ps.at - runTime)) / runTime);
    const toward = -sideSign(this.match.serving);
    server.pos.x = ps.from.x + toward * run * k * (2 - k);
    server.pos.z = ps.from.z;
    server.target = clone(server.pos);
  }

  private serve(): void {
    const team = this.match.serving;
    const server = this.player(this.court(team)[0]);
    const ps = this.pendingServe!;
    this.pendingServe = null;
    this.aiServe = null;
    this.servedType = ps.type;
    const choice = { type: ps.type, zone: ps.zone };
    const timing = ps.timing;
    const serveAim = ps.aim;
    const cfg = TUNING.serve[choice.type];
    const cost = TUNING.stamina.cost;
    this.tire(server.key, choice.type === 'jump' ? cost.jumpServe : choice.type === 'float' ? cost.floatServe : cost.safeServe);
    // Golpe un poco adelante del cuerpo (en el salto, ya en el aire sobre la línea de fondo).
    const from = v3(server.pos.x - sideSign(team) * 0.3, cfg.contactHeight, server.pos.z);
    let q = computeQuality(
      { base: cfg.base, prevQuality: 1, timing, attribute: this.attr(server, server.def.attrs.serve), pressure: 0 },
      this.rng,
    );
    this.phase = 'inPlay';
    q = this.boosted(q, ps.user ? timing : undefined);
    this.registerTouch(server, 'serve', q);
    const opp = otherTeam(team);
    const isError = this.rng.chance(errorChance(cfg.risk, q));
    const target = isError
      ? this.errorTarget(opp, from)
      : this.keepOnSide(opp, this.noisy(serveAim ? v3(serveAim.x, COURT.ballRadius, serveAim.z) : spot(opp, ZONE_SPOTS[choice.zone], COURT.ballRadius), cfg.noise * (1 - q)));
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
    this.diving = !!plan.dive;
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
    const attribute = this.attr(p, kind === 'reception' ? p.def.attrs.reception : p.def.attrs.defense);
    let q = computeQuality(
      { base: low ? cfg.lowContactBase : cfg.base, prevQuality: 1, timing: ctl?.timing ?? this.aiTiming(p.team), attribute, pressure: this.threat },
      this.rng,
    );
    // Salvada en plancha: la pelota sigue viva, pero el pase sale peor.
    if (this.diving) q *= TUNING.dive.quality;
    q = this.boosted(q, ctl?.timing);
    this.registerTouch(p, kind, q);
    this.intent = null;
    if (this.rng.chance(errorChance(cfg.risk * (high ? hp.riskFactor : 1), q))) {
      const wild = v3(at.x + this.rng.range(-6, 6), COURT.ballRadius, at.z + this.rng.range(-6, 6));
      this.ball = launch(at, wild, 1.0, t);
    } else {
      const noise = cfg.noise * (1 - q) * (high ? hp.noiseFactor : 1);
      const aim = ctl?.aim;
      const goal = aim ? v3(aim.x, TUNING.setHeight, aim.z) : spot(p.team, p.def.role === 'S' ? LIBERO_SET_SPOT : SETTER_SPOT, TUNING.setHeight);
      const target = this.keepOnSide(p.team, this.noisy(goal, noise));
      // Pase dirigido: más tiempo de vuelo cuanto más lejos se manda.
      const flight = aim ? clamp(0.9 + distXZ(at, target) * 0.09, 1.0, 1.9) : high ? hp.flightTime : cfg.flightTime;
      this.ball = launch(at, target, flight, t);
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
      { base: low ? TUNING.pass.lowContactBase : cfg.base, prevQuality: passQuality, timing: ctl?.timing ?? this.aiTiming(p.team), attribute: this.attr(p, p.def.attrs.setting), pressure: 0 },
      this.rng,
    );
    q = this.boosted(q, ctl?.timing);
    this.registerTouch(p, 'set', q);
    const outOfSystem = low || passQuality < cfg.outOfSystemPass;
    const [depth, right] = ATTACK_POINTS[choice.option];
    const point = toWorld(p.team, outOfSystem ? Math.max(depth, 2.0) : depth, right, this.attackHeight(attacker, choice.option, outOfSystem));
    const target = this.keepOnSide(p.team, this.noisy(point, cfg.noise * (1 - q)));
    this.ball = launch(at, target, outOfSystem ? cfg.rescueFlightTime : cfg.flightTime[choice.option], t);
    this.intent = { key: attacker.key, option: choice.option, outOfSystem };
    this.threat = 0;
    // El central delantero siempre amaga la rápida si la pelota va a otro lado (con juego en sistema).
    const court = this.court(p.team);
    const mb = court.find((k, i) => isFrontIndex(i) && k !== p.key && k !== attacker.key && this.player(k).def.role === 'MB');
    this.decoyRun = mb && !outOfSystem ? { key: mb, time: t + cfg.flightTime.quick } : null;
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
        attribute: this.attr(p, (p.def.attrs.attackPower + p.def.attrs.attackAccuracy) / 2),
        pressure: this.blockPressure(at),
      },
      this.rng,
    );
    q = this.boosted(q, ctl?.timing);
    this.registerTouch(p, 'attack', q);
    this.lastShot = shot;
    this.intent = null;
    const pw = aim ? TUNING.power.spike[ctl?.power ?? 'medium'] : { speed: 1, risk: 1, noise: 1 };
    const isError = this.rng.chance(errorChance(cfg.shots[shot].risk * (aim ? TUNING.decision.aimRiskFactor * pw.risk : 1), q));
    this.lastAimed = !!aim;
    const aimed = aim ? v3(aim.x, COURT.ballRadius, aim.z) : this.pickAttackTarget(opp, at, shot);
    const target = isError ? this.errorTarget(opp, at) : this.keepOnSide(opp, this.noisy(aimed, cfg.noise * (1 - q) * pw.noise));
    if (shot === 'tip') {
      this.ball = this.launchClearing(at, target, cfg.tipFlightTime, GRAVITY, t, !isError);
      this.threat = 0.3 * q;
    } else {
      const speed = (cfg.minSpeed + cfg.speedRange * q * (p.def.attrs.attackPower / 100)) * pw.speed * (p.def.star ? cfg.starSpeed : 1) * (1 + cfg.heightSpeed * (p.def.height - AVG_HEIGHT));
      this.ball = this.launchClearing(at, target, distXZ(at, target) / speed, GRAVITY + cfg.gravityBonus, t, !isError);
      this.threat = q * clamp01(speed / 28);
    }
  }

  private doFree(p: PlayerState, at: Vec3, t: number, ctl?: Control): void {
    const last = this.last;
    const prevQuality = last && last.team === p.team ? last.quality : 0.5;
    let q = computeQuality(
      { base: 0.9, prevQuality, timing: ctl?.timing ?? this.aiTiming(p.team), attribute: this.attr(p, p.def.attrs.reception), pressure: this.threat },
      this.rng,
    );
    q = this.boosted(q, ctl?.timing);
    this.registerTouch(p, 'free', q);
    this.intent = null;
    const opp = otherTeam(p.team);
    const isError = this.rng.chance(errorChance(TUNING.free.risk, q));
    const aimed = ctl?.aim ? v3(ctl.aim.x, COURT.ballRadius, ctl.aim.z) : toWorld(opp, this.rng.range(5, 8), this.rng.range(-3, 3), COURT.ballRadius);
    const target = isError ? this.errorTarget(opp, at) : this.keepOnSide(opp, this.noisy(aimed, 1.2 * (1 - q)));
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
    if (last.kind === 'attack') {
      if (block && block.scheme > 0) for (const k of block.keys) this.tire(k, TUNING.stamina.cost.block);
      if (this.decoyRun) this.tire(this.decoyRun.key, TUNING.stamina.cost.decoy);
      this.blockSetup = null;
    }
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
      } else if (last.kind === 'attack' && block && block.scheme > 0) {
        // La finta también salta el bloqueo: pasa por encima o al costado de las manos; si no puede, la tocan.
        if (!this.clearBlockPath(block)) this.plan = this.grazeBlock(block, net.time);
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
    let scheme = chooseBlockScheme(this.rng, this.intent?.option ?? 'zone4', this.intent?.outOfSystem ?? false);
    // La finta del central saca un bloqueador del remate de vez en cuando.
    if (this.decoyRun && scheme > 1 && this.rng.chance(TUNING.set.decoyPull)) scheme -= 1;
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
    // En el orden en que están parados (de un costado al otro): nadie se cruza con un compañero para llegar.
    const ordered = [...block.keys].sort((a, b) => this.player(a).pos.z - this.player(b).pos.z);
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
        const r = this.reach(attacker, [this.attackHeight(this.player(attacker), this.intent!.option, this.intent!.outOfSystem)]);
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
      // Sin colocador (tomó la primera), coloca el líbero desde atrás.
      const libero = court.find((k) => this.player(k).def.role === 'L');
      if (libero) {
        const r = this.reach(libero, [TUNING.setHeight]);
        if (r) return { key: libero, team, time: r.time, point: r.point, kind: 'set', low: false };
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
        best = { key, team, time: r.time, point: r.point, kind, low: r.low || forceLow, dive: r.dive };
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
      // El defensor que cubre la marca de defensa lee el remate: llega mejor si la pelota va cerca de la marca.
      const read = [this.blockHold, this.blockSetup].find((bk) => bk?.focus && bk.focusKey === key && bk.team === p.team);
      const reads = !!read?.focus && distXZ(v3(read.focus.x, 0, read.focus.z), point) < TUNING.defense.focusRadius;
      const available = time - this.time - TUNING.reactionTime + (reads ? TUNING.defense.reactionBonus : 0);
      const distance = Math.max(0, distXZ(p.pos, point) - TUNING.reachRadius - (reads ? TUNING.defense.reachBonus : 0));
      const slack = available - distance / moveSpeed(p.def);
      if (slack >= 0) return { time, point, slack, low: i > 0 };
    }
    // Último recurso: plancha a la pelota baja (solo quien defiende bien, y no en la colocación ni en el remate).
    const dive = TUNING.dive;
    const low = heights[heights.length - 1];
    if (heights.length > 1 && p.def.attrs.defense >= dive.minDefense) {
      const time = timeAtHeightDescending(this.ball, low);
      if (time !== null && time >= this.time + TUNING.minPlanLead) {
        const point = positionAt(this.ball, time);
        if (sideOfX(point.x) === p.team && Math.abs(point.x) <= COURT.halfLength + 3 && Math.abs(point.z) <= COURT.halfWidth + 3) {
          const extra = dive.extra * (p.def.attrs.defense / 100);
          const available = time - this.time - TUNING.reactionTime;
          const distance = Math.max(0, distXZ(p.pos, point) - TUNING.reachRadius - extra);
          const slack = available - distance / moveSpeed(p.def);
          // Holgura negativa a propósito: la plancha pierde contra cualquiera que llegue de pie.
          if (slack >= 0) return { time, point, slack: slack - 10, low: true, dive: true };
        }
      }
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
    // Nadie llega a tapar, pero los que saltan siguen siendo una pared: o la pelota pasa por fuera, o los roza.
    if (n === 0) return this.clearBlockPath(block) ? null : this.grazeBlock(block, crossTime);
    const plan = (outcome: BlockOutcome): Plan => ({ key: blockers[0].key, team: block.team, time: crossTime, point: at, kind: 'block', low: false, block: outcome });
    if (this.lastShot === 'tool' && this.rng.chance(TUNING.decision.toolBase + TUNING.decision.toolScale * this.last!.quality)) return plan('tool');
    const blockAttr = blockers.reduce((s, p) => s + p.def.attrs.block, 0) / n / 100;
    // Bloqueo más alto, más tapas.
    const tall = 1 + cfg.heightStuff * (blockers.reduce((s, p) => s + p.def.height, 0) / n - AVG_HEIGHT);
    const userFactor = userTiming ? TUNING.decision.blockTiming[userTiming] : 1;
    const stuff = clamp01((cfg.stuffBase + cfg.stuffScale * blockAttr * (1 - this.last!.quality)) * cfg.nFactor[n] * userFactor * Math.max(0.5, tall));
    const r = this.rng.next();
    if (r < stuff) return plan('stuff');
    if (r < stuff + cfg.touchByN[n]) return plan('soft');
    // Sin toque: el remate tiene que pasar de verdad por fuera de manos y cuerpos; si no hay hueco, roza el bloqueo.
    return this.clearBlockPath(block) ? null : plan('soft');
  }

  /** La pelota roza las manos del bloqueador más cercano a su paso. */
  private grazeBlock(block: BlockSetup, crossTime: number): Plan {
    const at = positionAt(this.ball, crossTime);
    const key = [...block.keys].sort((a, c) => Math.abs(this.player(a).pos.z - at.z) - Math.abs(this.player(c).pos.z - at.z))[0];
    return { key, team: block.team, time: crossTime, point: at, kind: 'block', low: false, block: 'soft' };
  }

  /** ¿El recorrido toca a algún bloqueador en salto? Revisa planos entre la red y el cuerpo del bloqueador. */
  private crossesBlock(tr: Trajectory, walls: { z: number; top: number }[], side: number): boolean {
    if (Math.abs(tr.v0.x) < 1e-6) return false;
    for (const d of [0.02, 0.15, 0.3, 0.45, 0.6]) {
      const t = (side * d - tr.p0.x) / tr.v0.x;
      if (t <= 0) continue;
      const p = positionAt(tr, tr.t0 + t);
      if (walls.some((w) => p.y < w.top && Math.abs(p.z - w.z) < TUNING.block.bodyHalfWidth)) return true;
    }
    return false;
  }

  /**
   * Un remate que pasa el bloqueo sin tocarlo no puede atravesarlo: si el recorrido choca, se abre en ángulo
   * (mismo tiempo de vuelo, otro punto de caída) por el costado más cercano. Devuelve false si no hay por dónde.
   */
  private clearBlockPath(block: BlockSetup): boolean {
    // Dónde estará cada bloqueador al cruzar la red: va hacia su lugar del bloqueo a su velocidad.
    const spots = this.blockSpots(block);
    const net = checkNet(this.ball);
    const left = net.kind === 'none' ? 0 : Math.max(0, net.time - this.time);
    const walls = block.keys.map((k) => {
      const p = this.player(k);
      const step = clamp(spots.get(k)!.z - p.pos.z, -moveSpeed(p.def) * left, moveSpeed(p.def) * left);
      return { z: p.pos.z + step, top: blockReach(p.def) + 0.05 };
    });
    const side = sideSign(block.team);
    const tr = this.ball;
    if (!this.crossesBlock(tr, walls, side)) return true;
    const T = landingTime(tr) - tr.t0;
    const land = positionAt(tr, tr.t0 + T);
    const inside = Math.abs(land.z) <= COURT.halfWidth;
    // Primero abrir el ángulo; si no alcanza, por encima de las manos (más arco, más lento).
    // El remate apuntado del usuario apenas se corrige: si apuntó contra el bloqueo, lo bloquean.
    const userAim = this.lastAimed;
    const maxSteps = userAim ? 3 : 20;
    for (const stretch of userAim ? [1, 1.12] : [1, 1.12, 1.25, 1.4]) {
      for (let k = stretch === 1 ? 1 : 0; k <= maxSteps; k++) {
        for (const dir of [1, -1]) {
          const z = land.z + dir * k * 0.2;
          if (inside && Math.abs(z) > COURT.halfWidth - 0.15) continue;
          const next = launch(tr.p0, v3(land.x, COURT.ballRadius, z), T * stretch, tr.t0, tr.g);
          if (checkNet(next).kind !== 'clear' || this.crossesBlock(next, walls, side)) continue;
          this.ball = next;
          return true;
        }
      }
    }
    return false;
  }

  private setFormations(): void {
    const plan = this.plan;
    for (const team of TEAM_IDS) {
      const building = plan !== null && plan.team === team && plan.kind !== 'block' && this.touchSide === team && this.touches >= 1;
      const receivingFirst = plan !== null && plan.team === team && !building;
      const block = [this.blockSetup, this.blockHold].find((b) => b?.team === team) ?? null;
      const blockSpots = block ? this.blockSpots(block) : null;
      if (block?.focus && !block.focusKey) {
        // Quien cubre la marca de defensa: el compañero (que no bloquea) más cercano a ella.
        const free = this.court(team).filter((k) => !block.keys.includes(k));
        const f = block.focus;
        block.focusKey = free.sort((a, b) => distXZ(this.player(a).pos, v3(f.x, 0, f.z)) - distXZ(this.player(b).pos, v3(f.x, 0, f.z)))[0] ?? null;
      }
      this.court(team).forEach((key, idx) => {
        const p = this.player(key);
        // El bloqueador principal no corre al punto de cruce: sigue en su lugar del bloqueo cerrado.
        if (plan && plan.key === key) p.target = plan.kind === 'block' && blockSpots?.has(key) ? blockSpots.get(key)! : this.standPoint(plan);
        else if (building && p.def.role === 'L' && this.last?.team === team && this.player(this.last.key).def.role === 'S') p.target = spot(team, LIBERO_SET_SPOT);
        else if (building) p.target = this.attackSpot(team, p, idx);
        else if (receivingFirst) {
          if (p.def.role === 'S') p.target = spot(team, SETTER_SPOT);
        } else if (blockSpots?.has(key)) p.target = blockSpots.get(key)!;
        else if (block?.focus && block.focusKey === key) p.target = v3(block.focus.x, 0, block.focus.z);
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
    // Huecos del bloqueo: el atacante busca abrir el ángulo o la línea por fuera de las manos.
    const block = shot !== 'tip' && this.blockSetup?.team === opp ? this.blockSetup : null;
    const walls = block ? [...this.blockSpots(block).values()].map((p) => p.z) : [];
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
      let score = Math.min(...defenders.map((d) => distXZ(d, candidate)));
      if (walls.length && Math.abs(candidate.x - at.x) > 1e-6) {
        const zNet = at.z + ((candidate.z - at.z) * (s * 0.3 - at.x)) / (candidate.x - at.x);
        if (walls.some((w) => Math.abs(zNet - w) < TUNING.block.bodyHalfWidth + 0.1)) score -= 3;
      }
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

  /** Altura del golpe: el zaguero (pipe o zona 1) en sistema vuela mucho más alto, tipo Nishida. */
  private attackHeight(p: PlayerState, option: SetOption, outOfSystem: boolean): number {
    const back = !outOfSystem && (option === 'pipe' || option === 'back1');
    return attackContactHeight(p.def) - 0.1 + (back ? TUNING.attack.backRowLift : 0) - TUNING.stamina.jumpLoss * (1 - p.stamina);
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
    // Autor del punto (remate, ace, tapa o remate que sale del bloqueo) para la racha.
    const last = this.last!;
    const scorer = reason === 'blockOut' ? this.lastAttacker : reason === 'kill' || reason === 'ace' || reason === 'blockKill' ? last.key : null;
    const list = this.scorers[winner];
    list.push(scorer);
    if (list.length > TUNING.fire.window) list.shift();
    // Entre puntos todos recuperan algo; la banca, más.
    for (const p of this.players.values()) {
      const onCourt = this.court(p.team).includes(p.key);
      p.stamina = Math.min(1, p.stamina + (onCourt ? TUNING.stamina.perPoint : TUNING.stamina.bench));
    }
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
