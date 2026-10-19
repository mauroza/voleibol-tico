import type { PointReason } from '../sim/events';

export interface ReplayFrame {
  time: number;
  data: Float32Array;
}

/** Ring buffer de cuadros de estado visual (tamaño fijo por cuadro). */
export class ReplayBuffer {
  private readonly times: Float64Array;
  private readonly data: Float32Array[];
  private start = 0;
  private count = 0;

  constructor(private readonly capacity: number, readonly frameSize: number) {
    this.times = new Float64Array(capacity);
    this.data = Array.from({ length: capacity }, () => new Float32Array(frameSize));
  }

  push(time: number, frame: Float32Array): void {
    const i = (this.start + this.count) % this.capacity;
    this.times[i] = time;
    this.data[i].set(frame);
    if (this.count < this.capacity) this.count += 1;
    else this.start = (this.start + 1) % this.capacity;
  }

  clear(): void {
    this.start = 0;
    this.count = 0;
  }

  get length(): number {
    return this.count;
  }

  frames(): ReplayFrame[] {
    return Array.from({ length: this.count }, (_, k) => {
      const i = (this.start + k) % this.capacity;
      return { time: this.times[i], data: this.data[i] };
    });
  }

  get firstTime(): number {
    return this.count ? this.times[this.start] : 0;
  }

  get lastTime(): number {
    return this.count ? this.times[(this.start + this.count - 1) % this.capacity] : 0;
  }

  /** Último cuadro con tiempo ≤ t (o el primero si t es anterior a todos). */
  frameAt(t: number): ReplayFrame | null {
    if (!this.count) return null;
    let best = this.start;
    for (let k = 0; k < this.count; k++) {
      const i = (this.start + k) % this.capacity;
      if (this.times[i] <= t) best = i;
      else break;
    }
    return { time: this.times[best], data: this.data[best] };
  }
}

/** Puntos que se repiten: remate que cae (también el que sale del bloqueo), ace y tapa. */
const REPLAYED: ReadonlySet<PointReason> = new Set<PointReason>(['kill', 'blockOut', 'ace', 'blockKill']);

/** Decide qué puntos merecen repetición: siempre los remates que caen, los aces y las tapas; nunca los errores. */
export class ReplayPolicy {
  shouldReplay(reason: PointReason): boolean {
    return REPLAYED.has(reason);
  }
}
