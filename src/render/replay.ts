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

  /**
   * Estado en el instante t mezclado entre los dos cuadros que lo rodean (repetición suave aunque vaya lenta).
   * `mix(a, b, k, out)` combina los datos; devuelve false si no hay cuadros.
   */
  sample(t: number, out: Float32Array, mix: (a: Float32Array, b: Float32Array, k: number, out: Float32Array) => void): boolean {
    if (!this.count) return false;
    let prev = this.start;
    let next = this.start;
    for (let k = 0; k < this.count; k++) {
      const i = (this.start + k) % this.capacity;
      next = i;
      if (this.times[i] > t) break;
      prev = i;
    }
    const span = this.times[next] - this.times[prev];
    const k = span > 1e-6 ? Math.min(1, Math.max(0, (t - this.times[prev]) / span)) : 0;
    mix(this.data[prev], this.data[next], k, out);
    return true;
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

/**
 * Puntos que se repiten: todos los que terminan con la pelota en el piso o afuera. Remate que cae o que sale, el que
 * sale del bloqueo, tapa, ace, saque afuera o a la red y la pelota que cae sin que nadie la toque.
 */
const REPLAYED: ReadonlySet<PointReason> = new Set<PointReason>(['kill', 'blockOut', 'ace', 'blockKill', 'attackError', 'serviceError', 'landed', 'error']);

/** Decide qué puntos merecen repetición. */
export class ReplayPolicy {
  shouldReplay(reason: PointReason): boolean {
    return REPLAYED.has(reason);
  }
}
