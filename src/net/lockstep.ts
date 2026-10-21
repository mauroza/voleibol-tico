import { otherTeam, type TeamId } from '../sim/court';
import type { Simulation } from '../sim/rally';
import { TUNING } from '../sim/tuning';
import type { NetMessage, Transport } from './transport';

/** Una acción de un jugador, aplicada en el mismo tick en las dos computadoras. */
interface Input {
  tick: number;
  seq: number;
  team: TeamId;
  k: Kind;
  i?: number;
  /** Saltar: toda la previa. Lado: izquierda. */
  a?: boolean;
  /** Alineación (claves de jugador en orden de posición). */
  l?: string[];
  x?: number;
  z?: number;
  at?: number;
  /** Jugada para la que se tocó (tipo, jugador e inicio): si al llegar ya es otra, la tecla no se aplica. */
  dk: string;
}

/** Identidad de una decisión, igual en las dos computadoras (la simulación es la misma). */
const decisionKey = (d: { kind: string; playerKey: string; startTime: number }) => `${d.kind}:${d.playerKey}:${d.startTime}`;
type Kind = 'choose' | 'aim' | 'press' | 'challenge' | 'skip' | 'side' | 'lineup' | 'timeout' | 'endTimeout' | 'sub' | 'pause' | 'resume';

/** Identidad de lo que ese equipo puede mandar ahora de ese tipo (null si no puede). */
const keyFor = (sim: Simulation, team: TeamId, k: Kind): string | null => {
  if (k === 'challenge') return sim.challengeKey(team);
  if (k === 'skip') return sim.skipKey(team);
  if (k === 'side') return sim.sideKey(team);
  if (k === 'lineup') return sim.lineupKey(team);
  if (k === 'timeout') return sim.timeoutKey(team);
  if (k === 'endTimeout') return sim.endTimeoutKey(team);
  if (k === 'sub') return sim.subKey(team);
  if (k === 'pause') return sim.pauseKey(team);
  if (k === 'resume') return sim.resumeKey(team);
  const d = sim.decisions[team];
  return d ? decisionKey(d) : null;
};
/** ¿Ese equipo puede mandar algo ahora? (entonces el otro no avanza más allá de lo que ese ya confirmó). */
/**
 * Las jugadas (elegir, apuntar, golpear) son "rápidas": llegan con el retraso justo de la red. Lo demás (saltar etapa,
 * lado, alineación, tiempos, cambios, pausa, challenge) es "lento": viaja con medio segundo más de margen. Así,
 * mientras solo hay cosas lentas posibles (todo el calentamiento, cada pelota muerta), ninguna computadora tiene que
 * esperar a la otra por un tirón de internet.
 */
const FAST: ReadonlySet<Kind> = new Set<Kind>(['choose', 'aim', 'press']);
const SLOW_KINDS: readonly Kind[] = ['challenge', 'skip', 'side', 'lineup', 'timeout', 'endTimeout', 'sub', 'pause', 'resume'];
/** Margen extra (ticks) de las acciones lentas: 0.4 s de juego. */
const SLACK = 48;
const fastOpen = (sim: Simulation, team: TeamId): boolean => !!keyFor(sim, team, 'press');
const slowOpen = (sim: Simulation, team: TeamId): boolean => SLOW_KINDS.some((k) => keyFor(sim, team, k) !== null);

/**
 * Ticks de simulación (1/120 s) entre que se toca una tecla y que se aplica: lo que tarda en cruzar la red.
 * Se mide con el ping al entrar a la sala (ida = la mitad), con margen; entre 10 y 40 ticks.
 */
export const delayForPing = (rttSeconds: number): number => Math.min(40, Math.max(10, Math.ceil((rttSeconds / 2) * 120 * 1.25) + 8));
/** Adelanto de las barras de timing (s de simulación): un poco más que el retraso de las teclas. */
export const leadForDelay = (delay: number): number => (delay + 2) * TUNING.dt;

/**
 * Partida online "lockstep": las dos computadoras corren la misma simulación (misma semilla, pasos fijos de 1/120 s)
 * y solo se mandan las acciones de cada jugador con el tick en que se aplican. Mientras un equipo tiene una decisión
 * abierta, el otro no avanza más allá de lo que ese jugador ya confirmó: así las dos simulaciones son idénticas.
 */
export class Lockstep {
  tick = 0;
  /** Tick hasta el que el rival confirmó que ya mandó todas sus acciones rápidas (y las lentas, con margen). */
  private remoteUpTo = 0;
  private remoteUpToSlow = 0;
  /** Tick hasta el que nosotros prometimos no mandar más acciones rápidas (y lentas). */
  private promised = 0;
  private promisedSlow = 0;
  private seq = 0;
  private readonly queue: Input[] = [];
  /** Acciones nuestras que el rival todavía no confirmó (se reenvían). */
  private unacked: Input[] = [];
  private remoteSeq = -1;
  private readonly lastOpen: Record<TeamId, number> = { A: -1e9, B: -1e9 };
  private readonly lastSlowOpen: Record<TeamId, number> = { A: -1e9, B: -1e9 };
  private debt = 0;
  /** Último tick que informó el rival y cuándo llegó (para estimar dónde va ahora). */
  private remoteTick: { tick: number; at: number; scale: number } | null = null;
  /** Tiempo de simulación pendiente (menos de un paso): para dibujar la pelota entre dos pasos. */
  get pendingTime(): number {
    return this.debt;
  }
  private sendClock = 0;
  private readonly hashes = new Map<number, string>();
  private readonly remoteHashes = new Map<number, string>();
  /** Se pone en true si las dos simulaciones dejaron de coincidir. */
  desync = false;
  /** Ida y vuelta con el rival (ms, suavizado); null hasta la primera medición. */
  ping: number | null = null;
  private pingClock = 1.5;
  /** Ping de esta computadora al servidor y el que informa el rival (ms): así se ve de quién es la conexión lenta. */
  myNet: number | null = null;
  remoteNet: number | null = null;
  /** El rival salió de la ventana del juego (minimizó o cambió de pestaña). */
  remoteAway = false;
  /** Hace cuánto (s reales) que no llega nada del rival. */
  silence = 0;
  /** Mira pendiente: se manda agrupada (no un mensaje por cada movimiento del mouse). */
  private pendingAim: { x: number; z: number } | null = null;
  private aimClock = 0;
  private shownDecision: unknown = null;
  readonly remote: TeamId;
  private readonly apply: {
    choose: Simulation['choose'];
    setAim: Simulation['setAim'];
    press: Simulation['press'];
    challenge: Simulation['challenge'];
    skip: Simulation['skip'];
    chooseSide: Simulation['chooseSide'];
    submitLineup: Simulation['submitLineup'];
    callTimeout: Simulation['callTimeout'];
    endTimeout: Simulation['endTimeout'];
    substitute: Simulation['substitute'];
    pauseGame: Simulation['pauseGame'];
    resumeGame: Simulation['resumeGame'];
  };

  constructor(private readonly sim: Simulation, private readonly net: Transport, readonly local: TeamId, private readonly delay = 14) {
    this.remote = otherTeam(local);
    this.apply = {
      choose: sim.choose.bind(sim),
      setAim: sim.setAim.bind(sim),
      press: sim.press.bind(sim),
      challenge: sim.challenge.bind(sim),
      skip: sim.skip.bind(sim),
      chooseSide: sim.chooseSide.bind(sim),
      submitLineup: sim.submitLineup.bind(sim),
      callTimeout: sim.callTimeout.bind(sim),
      endTimeout: sim.endTimeout.bind(sim),
      substitute: sim.substitute.bind(sim),
      pauseGame: sim.pauseGame.bind(sim),
      resumeGame: sim.resumeGame.bind(sim),
    };
    // Tiempos, cambios y pausa: viajan como las jugadas y se aplican en el mismo tick en las dos computadoras.
    sim.callTimeout = () => {
      if (!sim.timeoutKey(local)) return false;
      this.push({ k: 'timeout' });
      return true;
    };
    sim.endTimeout = () => this.push({ k: 'endTimeout' });
    sim.substitute = (_team: TeamId, outKey: string, inKey: string) => {
      if (!sim.canSubstitute(local, outKey, inKey)) return false;
      this.push({ k: 'sub', l: [outKey, inKey] });
      return true;
    };
    sim.pauseGame = () => this.push({ k: 'pause' });
    sim.resumeGame = () => this.push({ k: 'resume' });
    sim.challenge = () => this.push({ k: 'challenge' });
    sim.skip = (_team?: TeamId | null, all = false) => this.push({ k: 'skip', a: all });
    sim.chooseSide = (_team: TeamId, left: boolean) => this.push({ k: 'side', a: left });
    sim.submitLineup = (_team: TeamId, lineup: string[]) => {
      if (!sim.validLineup(local, lineup)) return false;
      this.push({ k: 'lineup', l: [...lineup] });
      return true;
    };
    // Las acciones del jugador local no tocan la simulación directo: se programan para el tick de llegada.
    sim.choose = (i: number) => this.push({ k: 'choose', i });
    sim.setAim = (x: number, z: number) => {
      if (!sim.decisions[local]) return;
      this.pendingAim = { x, z };
      sim.localAim = { x, z };
    };
    sim.press = (at: number = sim.time) => {
      // El salto al bloqueo se dibuja ya en esta pantalla.
      const d = sim.decisions[local];
      if (d?.kind === 'block' && d.pressedAt === null && sim.localJumpAt === null) sim.localJumpAt = at;
      // La última mira viaja antes del golpe.
      this.sendPendingAim();
      this.push({ k: 'press', at });
    };
    net.onMessage((m) => this.receive(m));
    net.onSelf((m) => {
      const rtt = performance.now() - (m.s as number);
      this.myNet = this.myNet === null ? rtt : this.myNet * 0.7 + rtt * 0.3;
    });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => net.send({ t: 'away', v: document.hidden }));
    }
  }

  private sendPendingAim(): void {
    if (!this.pendingAim) return;
    const { x, z } = this.pendingAim;
    this.pendingAim = null;
    this.push({ k: 'aim', x, z }, false);
  }

  private push(input: Omit<Input, 'tick' | 'seq' | 'team' | 'dk'>, send = true): void {
    const dk = keyFor(this.sim, this.local, input.k);
    if (!dk) return;
    // Nunca antes de lo ya prometido: el rival puede haber simulado hasta ahí.
    const tick = FAST.has(input.k)
      ? Math.max(this.tick + this.delay, this.promised + 1)
      : Math.max(this.tick + this.delay + SLACK, this.promisedSlow + 1);
    const full: Input = { ...input, tick, seq: this.seq++, team: this.local, dk };
    this.queue.push(full);
    this.unacked.push(full);
    if (send) this.flush();
  }

  private receive(m: NetMessage): void {
    this.silence = 0;
    // Ping en vivo: el otro devuelve nuestra marca de tiempo y medimos la ida y vuelta.
    if (m.t === 'p') {
      this.net.send({ t: 'q', s: m.s });
      return;
    }
    if (m.t === 'q') {
      const rtt = performance.now() - (m.s as number);
      this.ping = this.ping === null ? rtt : this.ping * 0.7 + rtt * 0.3;
      return;
    }
    if (m.t === 'np') {
      this.remoteNet = m.v as number;
      return;
    }
    if (m.t === 'away') {
      this.remoteAway = !!m.v;
      return;
    }
    if (m.t === 'in') {
      for (const input of m.inputs as Input[]) {
        if (input.seq <= this.remoteSeq) continue;
        this.remoteSeq = input.seq;
        this.queue.push(input);
      }
      this.remoteUpTo = Math.max(this.remoteUpTo, m.upTo as number);
      this.remoteUpToSlow = Math.max(this.remoteUpToSlow, (m.upToS as number | undefined) ?? (m.upTo as number));
      if (typeof m.tk === 'number') this.remoteTick = { tick: m.tk, at: performance.now(), scale: (m.sc as number | undefined) ?? 1 };
      const ack = m.ack as number;
      this.unacked = this.unacked.filter((i) => i.seq > ack);
    } else if (m.t === 'hash') {
      const tick = m.tick as number;
      const mine = this.hashes.get(tick);
      if (mine !== undefined) {
        if (mine !== m.hash) this.desync = true;
      } else this.remoteHashes.set(tick, m.hash as string);
    }
  }

  /** Manda nuestras acciones pendientes y promete el horizonte hasta el que ya no habrá más. */
  private flush(): void {
    this.promised = Math.max(this.promised, this.tick + this.delay);
    this.promisedSlow = Math.max(this.promisedSlow, this.tick + this.delay + SLACK);
    this.net.send({ t: 'in', upTo: this.promised, upToS: this.promisedSlow, inputs: this.unacked, ack: this.remoteSeq, tk: this.tick, sc: this.sim.timeScale });
  }

  /**
   * Hasta qué tick del rival hace falta saber para avanzar a `tick`: si tiene (o tuvo hace poco) una jugada abierta, su
   * horizonte rápido; si solo puede mandar cosas lentas, el lento (medio segundo más adelante); si nada, no hace falta.
   */
  private remoteHorizon(tick: number): number {
    if (fastOpen(this.sim, this.remote) || tick - this.lastOpen[this.remote] <= this.delay + 1) return this.remoteUpTo;
    if (slowOpen(this.sim, this.remote) || tick - this.lastSlowOpen[this.remote] <= this.delay + SLACK + 1) return this.remoteUpToSlow;
    return Infinity;
  }

  /**
   * Avanza en pasos fijos lo que corresponde a `dtReal` segundos reales (a la escala de tiempo de la simulación),
   * sin pasarse de lo que el rival confirmó cuando hace falta. Devuelve true si quedó esperando al rival.
   */
  advance(dtReal: number, pace: number): boolean {
    this.silence += dtReal;
    this.pingClock += dtReal;
    if (this.pingClock > 2) {
      this.pingClock = 0;
      const now = performance.now();
      this.net.send({ t: 'p', s: now });
      this.net.send({ t: 'sp', s: now });
      if (this.myNet !== null) this.net.send({ t: 'np', v: Math.round(this.myNet) });
    }
    // La mira de esta pantalla: se dibuja al instante y viaja agrupada (unas 12 veces por segundo).
    const mine = this.sim.decisions[this.local];
    if (mine !== this.shownDecision) {
      this.shownDecision = mine;
      this.sim.localAim = null;
      this.sim.localJumpAt = null;
      this.pendingAim = null;
    }
    this.aimClock += dtReal;
    if (this.pendingAim && this.aimClock > 0.08) {
      this.aimClock = 0;
      this.sendPendingAim();
    }
    // Mensajes: ~25 por segundo mientras tenemos una decisión abierta; si no, ~5. El plan gratuito limita el total.
    this.sendClock += dtReal;
    // Con una jugada abierta, ~25 mensajes por segundo; con solo cosas lentas posibles, ~8 (sobra margen); si no, ~5.
    const deciding = fastOpen(this.sim, this.local) || this.tick - this.lastOpen[this.local] <= this.delay + 1;
    const slow = slowOpen(this.sim, this.local);
    if (this.sendClock > (deciding ? 0.04 : slow ? 0.12 : 0.2)) {
      this.sendClock = 0;
      this.flush();
    }
    this.debt = Math.min(this.debt + dtReal * pace * this.sim.timeScale * this.syncRate(pace), 0.25);
    let waiting = false;
    while (this.debt >= TUNING.dt) {
      const next = this.tick + 1;
      if (this.remoteHorizon(next) < next) {
        waiting = true;
        break;
      }
      this.applyInputs(next);
      this.sim.step(TUNING.dt);
      this.tick = next;
      this.debt -= TUNING.dt;
      for (const t of ['A', 'B'] as const) {
        if (fastOpen(this.sim, t)) this.lastOpen[t] = this.tick;
        if (slowOpen(this.sim, t)) this.lastSlowOpen[t] = this.tick;
      }
      if (this.tick % 240 === 0) this.checkSync();
      // Con la escala de tiempo nueva (cámara lenta), la deuda se recalcula en el próximo cuadro.
    }
    return waiting;
  }

  /**
   * Relojes parejos: si esta computadora va adelantada respecto del rival (estimado con su último tick y el ping), corre
   * un poco más lenta; si va atrasada, un poco más rápida. Así ninguna queda pegada al límite esperando a la otra.
   */
  private syncRate(pace: number): number {
    const r = this.remoteTick;
    if (!r) return 1;
    const oneWay = (this.ping ?? 0) / 2;
    const est = r.tick + ((performance.now() - r.at + oneWay) / 1000) * 120 * r.scale * pace;
    const ahead = this.tick - est;
    return Math.min(1.06, Math.max(0.88, 1 - ahead * 0.01));
  }

  private applyInputs(tick: number): void {
    const due = this.queue.filter((i) => i.tick === tick).sort((a, b) => (a.team === b.team ? a.seq - b.seq : a.team < b.team ? -1 : 1));
    if (!due.length) return;
    for (const i of due) {
      // Una tecla que llega cuando su jugada ya pasó no se aplica a la siguiente (sería un golpe que nadie tocó).
      if (keyFor(this.sim, i.team, i.k) !== i.dk) continue;
      if (i.k === 'challenge') this.apply.challenge(i.team);
      else if (i.k === 'skip') this.apply.skip(i.team, !!i.a);
      else if (i.k === 'side') this.apply.chooseSide(i.team, !!i.a);
      else if (i.k === 'lineup') this.apply.submitLineup(i.team, i.l ?? []);
      else if (i.k === 'timeout') this.apply.callTimeout(i.team);
      else if (i.k === 'endTimeout') this.apply.endTimeout(i.team);
      else if (i.k === 'sub') this.apply.substitute(i.team, i.l?.[0] ?? '', i.l?.[1] ?? '');
      else if (i.k === 'pause') this.apply.pauseGame(i.team);
      else if (i.k === 'resume') this.apply.resumeGame(i.team);
      else if (i.k === 'choose') this.apply.choose(i.i!, i.team);
      else if (i.k === 'aim') this.apply.setAim(i.x!, i.z!, i.team);
      else this.apply.press(i.at!, i.team);
    }
    for (let j = this.queue.length - 1; j >= 0; j--) if (this.queue[j].tick <= tick) this.queue.splice(j, 1);
  }

  /** Huella del estado (marcador, pelota, tiempo): si difiere entre las dos computadoras, se desincronizaron. */
  private checkSync(): void {
    const s = this.sim;
    const b = s.ballPos;
    const hash = `${s.match.points.A}-${s.match.points.B}-${s.match.sets.A}-${s.match.sets.B}-${b.x.toFixed(4)}-${b.y.toFixed(4)}-${b.z.toFixed(4)}-${s.time.toFixed(4)}`;
    const theirs = this.remoteHashes.get(this.tick);
    if (theirs !== undefined) {
      if (theirs !== hash) this.desync = true;
      this.remoteHashes.delete(this.tick);
    }
    this.hashes.set(this.tick, hash);
    if (this.hashes.size > 20) this.hashes.delete(this.hashes.keys().next().value!);
    this.net.send({ t: 'hash', tick: this.tick, hash });
  }
}
