import { otherTeam, type TeamId } from '../sim/court';
import type { Simulation } from '../sim/rally';
import { TUNING } from '../sim/tuning';
import type { NetMessage, Transport } from './transport';

/** Una acción de un jugador, aplicada en el mismo tick en las dos computadoras. */
interface Input {
  tick: number;
  seq: number;
  team: TeamId;
  k: 'choose' | 'aim' | 'press';
  i?: number;
  x?: number;
  z?: number;
  at?: number;
}

/**
 * Ticks de simulación (1/120 s) entre que se toca una tecla y que se aplica: lo que tarda en cruzar la red.
 * Se mide con el ping al entrar a la sala (ida = la mitad), con margen; entre 10 y 40 ticks.
 */
export const delayForPing = (rttSeconds: number): number => Math.min(40, Math.max(10, Math.ceil((rttSeconds / 2) * 120 * 1.25) + 4));
/** Adelanto de las barras de timing (s de simulación): un poco más que el retraso de las teclas. */
export const leadForDelay = (delay: number): number => (delay + 2) * TUNING.dt;

/**
 * Partida online "lockstep": las dos computadoras corren la misma simulación (misma semilla, pasos fijos de 1/120 s)
 * y solo se mandan las acciones de cada jugador con el tick en que se aplican. Mientras un equipo tiene una decisión
 * abierta, el otro no avanza más allá de lo que ese jugador ya confirmó: así las dos simulaciones son idénticas.
 */
export class Lockstep {
  tick = 0;
  /** Tick hasta el que el rival confirmó que ya mandó todas sus acciones. */
  private remoteUpTo = 0;
  /** Tick hasta el que nosotros prometimos no mandar más acciones. */
  private promised = 0;
  private seq = 0;
  private readonly queue: Input[] = [];
  /** Acciones nuestras que el rival todavía no confirmó (se reenvían). */
  private unacked: Input[] = [];
  private remoteSeq = -1;
  private readonly lastOpen: Record<TeamId, number> = { A: -1e9, B: -1e9 };
  private debt = 0;
  private sendClock = 0;
  private readonly hashes = new Map<number, string>();
  private readonly remoteHashes = new Map<number, string>();
  /** Se pone en true si las dos simulaciones dejaron de coincidir. */
  desync = false;
  /** Hace cuánto (s reales) que no llega nada del rival. */
  silence = 0;
  readonly remote: TeamId;
  private readonly apply: { choose: Simulation['choose']; setAim: Simulation['setAim']; press: Simulation['press'] };

  constructor(private readonly sim: Simulation, private readonly net: Transport, readonly local: TeamId, private readonly delay = 14) {
    this.remote = otherTeam(local);
    this.apply = { choose: sim.choose.bind(sim), setAim: sim.setAim.bind(sim), press: sim.press.bind(sim) };
    // Las acciones del jugador local no tocan la simulación directo: se programan para el tick de llegada.
    sim.choose = (i: number) => this.push({ k: 'choose', i });
    sim.setAim = (x: number, z: number) => this.push({ k: 'aim', x, z });
    sim.press = (at: number = sim.time) => this.push({ k: 'press', at });
    net.onMessage((m) => this.receive(m));
  }

  private push(input: Omit<Input, 'tick' | 'seq' | 'team'>): void {
    if (!this.sim.decisions[this.local]) return;
    // Nunca antes de lo ya prometido: el rival puede haber simulado hasta ahí.
    const tick = Math.max(this.tick + this.delay, this.promised + 1);
    const full: Input = { ...input, tick, seq: this.seq++, team: this.local };
    this.queue.push(full);
    this.unacked.push(full);
    this.flush();
  }

  private receive(m: NetMessage): void {
    this.silence = 0;
    if (m.t === 'in') {
      for (const input of m.inputs as Input[]) {
        if (input.seq <= this.remoteSeq) continue;
        this.remoteSeq = input.seq;
        this.queue.push(input);
      }
      this.remoteUpTo = Math.max(this.remoteUpTo, m.upTo as number);
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
    this.net.send({ t: 'in', upTo: this.promised, inputs: this.unacked, ack: this.remoteSeq });
  }

  /** ¿El rival puede mandar acciones para este tick? Solo si tiene (o tuvo hace poco) una decisión abierta. */
  private needsRemote(tick: number): boolean {
    return !!this.sim.decisions[this.remote] || tick - this.lastOpen[this.remote] <= this.delay + 1;
  }

  /**
   * Avanza en pasos fijos lo que corresponde a `dtReal` segundos reales (a la escala de tiempo de la simulación),
   * sin pasarse de lo que el rival confirmó cuando hace falta. Devuelve true si quedó esperando al rival.
   */
  advance(dtReal: number, pace: number): boolean {
    this.silence += dtReal;
    // Mensajes: cada cuadro mientras tenemos una decisión abierta; si no, unas 6 veces por segundo.
    this.sendClock += dtReal;
    const deciding = !!this.sim.decisions[this.local] || this.tick - this.lastOpen[this.local] <= this.delay + 1;
    if (deciding || this.sendClock > 0.16 || this.unacked.length) {
      this.sendClock = 0;
      this.flush();
    }
    this.debt = Math.min(this.debt + dtReal * pace * this.sim.timeScale, 0.25);
    let waiting = false;
    while (this.debt >= TUNING.dt) {
      const next = this.tick + 1;
      if (this.needsRemote(next) && this.remoteUpTo < next) {
        waiting = true;
        break;
      }
      this.applyInputs(next);
      this.sim.step(TUNING.dt);
      this.tick = next;
      this.debt -= TUNING.dt;
      for (const t of ['A', 'B'] as const) if (this.sim.decisions[t]) this.lastOpen[t] = this.tick;
      if (this.tick % 240 === 0) this.checkSync();
      // Con la escala de tiempo nueva (cámara lenta), la deuda se recalcula en el próximo cuadro.
    }
    return waiting;
  }

  private applyInputs(tick: number): void {
    const due = this.queue.filter((i) => i.tick === tick).sort((a, b) => (a.team === b.team ? a.seq - b.seq : a.team < b.team ? -1 : 1));
    if (!due.length) return;
    for (const i of due) {
      if (i.k === 'choose') this.apply.choose(i.i!, i.team);
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
