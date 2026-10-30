import { isFrontIndex } from './match';
import type { PlayerState } from './players';
import { TUNING } from './tuning';

export type ServeType = 'float' | 'jump' | 'safe';
/**
 * Carril de la colocación (a quién y por dónde): punta (zona 4), central (zona 3), opuesto (zona 2), pipe (zaguero
 * por el centro) y zaguero por zona 1. El tempo va aparte: cada carril puede ir alta, media o rápida.
 */
export type SetOption = 'zone4' | 'zone3' | 'zone2' | 'pipe' | 'back1';
/** 'tool' (usar el bloqueo) solo lo elige el usuario. */
export type AttackShot = 'cross' | 'line' | 'tip' | 'tool';
export type Zone = 1 | 2 | 3 | 4 | 5 | 6;

export const SERVE_TYPES: readonly ServeType[] = ['float', 'jump', 'safe'];
export const ATTACK_SHOTS: readonly AttackShot[] = ['cross', 'line', 'tip'];

export const SET_LABELS: Record<SetOption, string> = {
  zone4: 'Punta (zona 4)',
  zone3: 'Central (zona 3)',
  zone2: 'Opuesto (zona 2)',
  pipe: 'Pipe (zaguero centro)',
  back1: 'Zaguero zona 1',
};

/** Tempo de la colocación: 0 alta (tiempo 3), 1 media (tiempo 2), 2 rápida (tiempo 1). */
export type SetTempo = 0 | 1 | 2;
export const TEMPO_LABELS = ['Alta', 'Media', 'Rápida'] as const;
/** Tiempo del voleibol: rápida 1, media 2, alta 3. */
export const TEMPO_TIME = [3, 2, 1] as const;
export const setLabel = (c: SetChoice): string => `${SET_LABELS[c.option]} · ${TEMPO_LABELS[c.tempo].toLowerCase()} (tiempo ${TEMPO_TIME[c.tempo]})`;

export interface SetChoice {
  option: SetOption;
  tempo: SetTempo;
  attackerKey: string;
  /** Distancia a la red del punto de remate (m); sin ella, la de siempre del carril. */
  depth?: number;
}

/**
 * Opciones de colocación según quién está en cancha (en orden de posición), quién coloca y la calidad del pase.
 * Cada atacante puede recibir alta siempre; media con recepción positiva y rápida con doble positiva (y colocador
 * especialista). Los zagueros (pipe y zona 1) solo con recepción positiva.
 */
export function availableSetOptions(
  court: readonly string[],
  setterKey: string,
  passQuality: number,
  setterIsSpecialist: boolean,
  players: ReadonlyMap<string, PlayerState>,
): SetChoice[] {
  const fast = setterIsSpecialist && passQuality >= TUNING.set.minPassForCombination;
  const medium = setterIsSpecialist && passQuality >= TUNING.set.minPassForSemi;
  const choices: SetChoice[] = [];
  court.forEach((key, i) => {
    if (key === setterKey) return;
    const role = players.get(key)!.def.role;
    if (role === 'L') return;
    const lane: SetOption | null = isFrontIndex(i)
      ? role === 'OH' ? 'zone4' : role === 'MB' ? 'zone3' : 'zone2'
      : medium && role === 'OH' ? 'pipe' : medium && role === 'OP' ? 'back1' : null;
    if (!lane) return;
    choices.push({ option: lane, tempo: 0, attackerKey: key });
    if (medium) choices.push({ option: lane, tempo: 1, attackerKey: key });
    if (fast) choices.push({ option: lane, tempo: 2, attackerKey: key });
  });
  if (choices.length > 0) return choices;
  const fallback = court.find((key, i) => key !== setterKey && isFrontIndex(i) && players.get(key)!.def.role !== 'L')
    ?? court.find((key) => key !== setterKey && players.get(key)!.def.role !== 'L')!;
  return [{ option: 'zone4', tempo: 0, attackerKey: fallback }];
}
