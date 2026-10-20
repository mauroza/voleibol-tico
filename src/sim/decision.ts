import type { AttackShot, ServeType, SetChoice, Zone } from './actions';
import type { TeamId } from './court';
import type { Timing } from './resolver';
import { TUNING } from './tuning';

export type UserOption =
  | { id: 'serve'; type: ServeType }
  | { id: 'pass'; high: boolean }
  | { id: 'set'; choice: SetChoice }
  | { id: 'dump' }
  | { id: 'shot'; shot: AttackShot }
  | { id: 'free' }
  /** Remate apuntado: la pelota va al punto de la mira (`Decision.aim`). */
  | { id: 'aim' }
  /** Esquema de bloqueo: cuántos delanteros saltan (0 = sin bloqueo). */
  | { id: 'block'; n: number };

export type DecisionKind = 'serve' | 'pass' | 'set' | 'attack' | 'block';

export interface DecisionOption {
  label: string;
  option: UserOption;
}

export interface Decision {
  kind: DecisionKind;
  /** Jugador que ejecuta (en el bloqueo, el bloqueador principal). */
  playerKey: string;
  options: DecisionOption[];
  /** Instante de simulación del contacto (o del remate rival en un bloqueo); null en el saque. */
  contactTime: number | null;
  startTime: number;
  chosen: number | null;
  pressedAt: number | null;
  /** Solo saque: zona elegida (si no, la IA elige). */
  zone: Zone | null;
  /** Mira: punto del piso (x, z del mundo). Remate y saque apuntan al campo rival; pase y marca de defensa, al propio. */
  aim: { x: number; z: number } | null;
  /** Campo donde vive la mira (para limitarla). */
  aimSide: TeamId | null;
  /** 'timing': acertar el verde; 'power': la posición de la barra al presionar es la fuerza (verde, amarillo, rojo). */
  meter: 'timing' | 'power';
  /** Colocación: el usuario fijó la opción con una tecla (si no, sale de la mira y del tempo de la barra). */
  locked?: boolean;
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

export type Power = 'soft' | 'medium' | 'strong';

/** Zona de fuerza según la posición de la barra (0..1): verde suave, amarillo medio, rojo muy fuerte. */
export function powerZone(meter: number): Power {
  return meter >= TUNING.power.strong ? 'strong' : meter >= TUNING.power.medium ? 'medium' : 'soft';
}

/** Posición de la barra de un contacto (0..1) en el instante en que se presionó: llega a 1 justo en el contacto. */
export function contactMeter(pressedAt: number, contactTime: number, window: number = TUNING.decision.slowWindow): number {
  return Math.min(1, Math.max(0, 1 - (contactTime - pressedAt) / window));
}

/** El rojo es lo más difícil de acertar (cuenta como timing perfecto); amarillo y verde, como bueno. */
export const powerTiming = (p: Power): Timing => (p === 'strong' ? 'perfect' : 'good');

/** Tempo de la colocación según la barra: verde alta (0), amarillo media (1), rojo rápida (2). */
export const tempoOf = (p: Power): number => (p === 'soft' ? 0 : p === 'medium' ? 1 : 2);

/**
 * Posición de la barra (0..1) de una decisión. Al presionar queda congelada donde se presionó.
 * Saque: triangular; colocación: ventana de tempo más larga; el resto, la ventana del contacto.
 */
export function meterOf(d: Decision, now: number): number {
  const t = d.pressedAt ?? now;
  if (d.kind === 'serve') return serveMeter(t - d.startTime);
  if (d.contactTime === null) return 0;
  return contactMeter(t, d.contactTime, d.kind === 'set' ? TUNING.decision.setWindow : TUNING.decision.slowWindow);
}
