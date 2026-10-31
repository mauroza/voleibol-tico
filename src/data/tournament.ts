import type { Difficulty } from '../sim/rally';
import { createRng } from '../sim/rng';

/**
 * Torneo de eliminación directa: ocho lugares en la llave (cuartos, semifinal y final). Juegan tu equipo, tu club o
 * los de primera; si faltan equipos para llenar la llave, el mejor sembrado pasa directo (BYE). Tú juegas cada ronda;
 * los demás partidos se resuelven al instante según la media de cada equipo, con algo de suerte.
 */

/** Lugar vacío de la llave: el rival pasa directo. */
export const BYE = -99;

export const ROUND_NAMES = ['Cuartos de final', 'Semifinal', 'Final'] as const;

export interface Tournament {
  /** Equipo del usuario (índice de `TEAMS`, o -1 = su club). */
  user: number;
  difficulty: Difficulty;
  setsToWin: 1 | 2;
  /** `rounds[r]` son los equipos de la ronda r en orden de llave (de a dos se enfrentan). */
  rounds: number[][];
  /** Ronda que se juega ahora (0 cuartos, 1 semifinal, 2 final). */
  round: number;
  /** Quedó eliminado (y en qué ronda) o salió campeón. */
  out: boolean;
  champion: number | null;
  /** Semilla para los partidos que no juega el usuario. */
  seed: number;
}

/**
 * Llave nueva. `others` son los demás equipos (índices) y `overall` da la media de cada uno. Los mejores sembrados
 * quedan en extremos opuestos de la llave; el BYE le toca al mejor rival.
 */
export function createTournament(user: number, others: number[], overall: (i: number) => number, opts: { difficulty: Difficulty; setsToWin: 1 | 2; seed: number }): Tournament {
  const rng = createRng(opts.seed);
  const rivals = [...others].sort((a, b) => overall(b) - overall(a)).slice(0, 7);
  while (rivals.length < 7) rivals.push(BYE);
  // Siembra clásica de 8: 1-8, 4-5, 3-6, 2-7. El usuario entra en un lugar al azar de los que no son cabeza de serie.
  const seeds = [...rivals];
  const slot = 3 + Math.floor(rng.next() * 4);
  seeds.splice(slot, 0, user);
  const order = [0, 7, 3, 4, 2, 5, 1, 6].map((i) => seeds[i]);
  return { user, difficulty: opts.difficulty, setsToWin: opts.setsToWin, rounds: [order], round: 0, out: false, champion: null, seed: opts.seed };
}

/** Rival del usuario en la ronda actual (o null si ya terminó). */
export function nextOpponent(t: Tournament): number | null {
  if (t.out || t.champion !== null) return null;
  const teams = t.rounds[t.round];
  const i = teams.indexOf(t.user);
  return i < 0 ? null : teams[i ^ 1];
}

/**
 * Anota el partido del usuario y resuelve los demás de la ronda. Devuelve el torneo actualizado (no cambia el que
 * recibe). Si el rival era un BYE, el usuario pasa sin jugar.
 */
export function recordResult(t: Tournament, won: boolean, overall: (i: number) => number): Tournament {
  if (nextOpponent(t) === null) return t;
  const rng = createRng(t.seed + t.round * 7919);
  const teams = t.rounds[t.round];
  const winners: number[] = [];
  for (let i = 0; i < teams.length; i += 2) {
    const a = teams[i];
    const b = teams[i + 1];
    if (a === t.user || b === t.user) winners.push(won ? t.user : a === t.user ? b : a);
    else winners.push(playOff(a, b, overall, rng.next()));
  }
  const rounds = [...t.rounds, winners];
  const last = winners.length === 1;
  return {
    ...t,
    rounds,
    round: last ? t.round : t.round + 1,
    out: !won,
    champion: last ? winners[0] : null,
  };
}

/** Partido que no juega el usuario: gana el de mejor media con más chance (un BYE siempre pierde). */
function playOff(a: number, b: number, overall: (i: number) => number, roll: number): number {
  if (a === BYE) return b;
  if (b === BYE) return a;
  const pA = 1 / (1 + Math.exp(-(overall(a) - overall(b)) / 5));
  return roll < pA ? a : b;
}

/** Simula el resto del torneo tras la eliminación del usuario (para mostrar quién salió campeón). */
export function finishWithoutUser(t: Tournament, overall: (i: number) => number): Tournament {
  let cur = t;
  let r = cur.rounds.length - 1;
  while (cur.rounds[r].length > 1) {
    const rng = createRng(cur.seed + (r + 1) * 104729);
    const teams = cur.rounds[r];
    const winners: number[] = [];
    for (let i = 0; i < teams.length; i += 2) winners.push(playOff(teams[i], teams[i + 1], overall, rng.next()));
    cur = { ...cur, rounds: [...cur.rounds, winners] };
    r += 1;
  }
  return { ...cur, champion: cur.rounds[r][0] };
}
