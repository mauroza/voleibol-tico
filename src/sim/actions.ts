import { isFrontIndex } from './match';
import type { PlayerState } from './players';
import { TUNING } from './tuning';

export type ServeType = 'float' | 'jump' | 'safe';
export type SetOption = 'zone4' | 'zone2' | 'quick' | 'pipe';
/** 'tool' (usar el bloqueo) solo lo elige el usuario. */
export type AttackShot = 'cross' | 'line' | 'tip' | 'tool';
export type Zone = 1 | 2 | 3 | 4 | 5 | 6;

export const SERVE_TYPES: readonly ServeType[] = ['float', 'jump', 'safe'];
export const ATTACK_SHOTS: readonly AttackShot[] = ['cross', 'line', 'tip'];

export interface SetChoice {
  option: SetOption;
  attackerKey: string;
}

/**
 * Opciones de colocación según quién está en cancha (en orden de posición), quién coloca y la calidad del pase.
 * Las combinaciones (rápida, pipe) solo existen con colocador especialista y buen pase.
 */
export function availableSetOptions(
  court: readonly string[],
  setterKey: string,
  passQuality: number,
  setterIsSpecialist: boolean,
  players: ReadonlyMap<string, PlayerState>,
): SetChoice[] {
  const combos = setterIsSpecialist && passQuality >= TUNING.set.minPassForCombination;
  const choices: SetChoice[] = [];
  court.forEach((key, i) => {
    if (key === setterKey) return;
    const role = players.get(key)!.def.role;
    if (role === 'L') return;
    if (isFrontIndex(i)) {
      if (role === 'OH') choices.push({ option: 'zone4', attackerKey: key });
      else if (role === 'OP' || role === 'S') choices.push({ option: 'zone2', attackerKey: key });
      else if (role === 'MB' && combos) choices.push({ option: 'quick', attackerKey: key });
    } else if ((role === 'OH' || role === 'OP') && combos) {
      choices.push({ option: 'pipe', attackerKey: key });
    }
  });
  if (choices.length > 0) return choices;
  const fallback = court.find((key, i) => key !== setterKey && isFrontIndex(i) && players.get(key)!.def.role !== 'L')
    ?? court.find((key) => key !== setterKey && players.get(key)!.def.role !== 'L')!;
  return [{ option: 'zone4', attackerKey: fallback }];
}
