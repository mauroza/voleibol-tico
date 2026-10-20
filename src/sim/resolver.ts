import type { Rng } from './rng';
import { TUNING } from './tuning';
import { clamp01 } from './vec';

export type Timing = 'perfect' | 'good' | 'bad';

export const TIMING_FACTOR: Record<Timing, number> = { perfect: 1, good: 0.85, bad: 0.55 };

export interface QualityInput {
  base: number;
  /** Calidad del toque anterior propio (0..1). */
  prevQuality: number;
  timing: Timing;
  /** Atributo relevante (0..100). */
  attribute: number;
  /** Presión rival: bloqueo, velocidad de la pelota (0..1). */
  pressure: number;
}

/** calidad = base × toque previo × timing × atributo × presión + ruido (spec §3.4) */
export function computeQuality(input: QualityInput, rng: Rng): number {
  const prev = 0.5 + 0.5 * clamp01(input.prevQuality);
  // El atributo pesa mucho: el líbero recibe bastante mejor que un central, el especialista saca mejor.
  const attr = 0.45 + 0.6 * clamp01(input.attribute / 100);
  const pressure = 1 - 0.5 * clamp01(input.pressure);
  const raw = input.base * prev * TIMING_FACTOR[input.timing] * attr * pressure;
  return clamp01(raw + rng.range(-0.08, 0.08));
}

export function errorChance(risk: number, quality: number): number {
  return clamp01(risk * 2 * (1 - quality));
}

export interface TimingWeights {
  perfect: number;
  good: number;
  bad: number;
}

export function rollTiming(rng: Rng, t: TimingWeights = TUNING.timing): Timing {
  return rng.weighted<Timing>([
    { item: 'perfect', weight: t.perfect },
    { item: 'good', weight: t.good },
    { item: 'bad', weight: t.bad },
  ]);
}
