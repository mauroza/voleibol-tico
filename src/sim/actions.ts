import { isFrontIndex } from './match';
import type { PlayerState } from './players';
import { TUNING } from './tuning';

export type ServeType = 'float' | 'jump' | 'safe';
/**
 * Colocaciones: punta alta o tensa (zona 4), rápida y semi-rápida al central (zona 3), opuesto (zona 2),
 * pipe (zaguero por el centro) y zaguero por zona 1.
 */
export type SetOption = 'zone4' | 'zone4fast' | 'quick' | 'semi' | 'zone2' | 'pipe' | 'back1';
/** 'tool' (usar el bloqueo) solo lo elige el usuario. */
export type AttackShot = 'cross' | 'line' | 'tip' | 'tool';
export type Zone = 1 | 2 | 3 | 4 | 5 | 6;

export const SERVE_TYPES: readonly ServeType[] = ['float', 'jump', 'safe'];
export const ATTACK_SHOTS: readonly AttackShot[] = ['cross', 'line', 'tip'];

export const SET_LABELS: Record<SetOption, string> = {
  zone4: 'Punta alta (zona 4)',
  zone4fast: 'Punta tensa (zona 4)',
  quick: 'Rápida al central',
  semi: 'Semi-rápida al centro',
  zone2: 'Opuesto (zona 2)',
  pipe: 'Pipe (zaguero centro)',
  back1: 'Zaguero zona 1',
};

export interface SetChoice {
  option: SetOption;
  attackerKey: string;
}

/**
 * Opciones de colocación según quién está en cancha (en orden de posición), quién coloca y la calidad del pase.
 * Las combinaciones (tensa, rápida, pipe, zona 1) exigen colocador especialista y buen pase; la semi-rápida, algo menos.
 */
export function availableSetOptions(
  court: readonly string[],
  setterKey: string,
  passQuality: number,
  setterIsSpecialist: boolean,
  players: ReadonlyMap<string, PlayerState>,
): SetChoice[] {
  const combos = setterIsSpecialist && passQuality >= TUNING.set.minPassForCombination;
  const semi = setterIsSpecialist && passQuality >= TUNING.set.minPassForSemi;
  const choices: SetChoice[] = [];
  court.forEach((key, i) => {
    if (key === setterKey) return;
    const role = players.get(key)!.def.role;
    if (role === 'L') return;
    const add = (option: SetOption) => choices.push({ option, attackerKey: key });
    if (isFrontIndex(i)) {
      if (role === 'OH') {
        add('zone4');
        if (combos) add('zone4fast');
      } else if (role === 'OP' || role === 'S') add('zone2');
      else if (role === 'MB') {
        if (combos) add('quick');
        if (semi) add('semi');
      }
    } else if (role === 'OH' && combos) add('pipe');
    else if (role === 'OP' && combos) add('back1');
  });
  if (choices.length > 0) return choices;
  const fallback = court.find((key, i) => key !== setterKey && isFrontIndex(i) && players.get(key)!.def.role !== 'L')
    ?? court.find((key) => key !== setterKey && players.get(key)!.def.role !== 'L')!;
  return [{ option: 'zone4', attackerKey: fallback }];
}
