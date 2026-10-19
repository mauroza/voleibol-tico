import type { AttackShot, ServeType, SetChoice, Zone } from './actions';
import type { Timing } from './resolver';
import { TUNING } from './tuning';

export type UserOption =
  | { id: 'serve'; type: ServeType }
  | { id: 'pass'; high: boolean }
  | { id: 'set'; choice: SetChoice }
  | { id: 'dump' }
  | { id: 'shot'; shot: AttackShot }
  | { id: 'free' }
  | { id: 'block'; jump: boolean };

export type DecisionKind = 'serve' | 'pass' | 'set' | 'attack' | 'block';

export interface DecisionOption {
  label: string;
  option: UserOption;
}

export interface Decision {
  kind: DecisionKind;
  options: DecisionOption[];
  /** Instante de simulación del contacto (o del remate rival en un bloqueo); null en el saque. */
  contactTime: number | null;
  startTime: number;
  chosen: number | null;
  pressedAt: number | null;
  /** Solo saque: zona elegida (si no, la IA elige). */
  zone: Zone | null;
}

/** El usuario presiona antes del contacto; después del contacto ya es tarde. */
export function judgeTiming(pressedAt: number | null, contactTime: number): Timing {
  if (pressedAt === null) return 'bad';
  const early = contactTime - pressedAt;
  if (early < -1e-9) return 'bad';
  if (early <= TUNING.decision.perfectWindow + 1e-9) return 'perfect';
  if (early <= TUNING.decision.goodWindow + 1e-9) return 'good';
  return 'bad';
}

/** Medidor triangular del saque: 0 → 1 → 0 en un periodo. */
export function serveMeter(elapsed: number): number {
  const p = (elapsed / TUNING.decision.servePeriod) % 1;
  return p < 0.5 ? p * 2 : 2 - p * 2;
}

export function judgeServe(meter: number): Timing {
  const miss = 1 - meter;
  if (miss <= 0.12) return 'perfect';
  if (miss <= 0.32) return 'good';
  return 'bad';
}
