import { otherTeam, type TeamId } from './court';

export interface MatchConfig {
  setsToWin: 1 | 2;
}

export type Score = Record<TeamId, number>;

export interface TeamSetup {
  lineup: string[];
  libero: string | null;
  liberoReplaces: string[];
}

export interface MatchState {
  config: MatchConfig;
  points: Score;
  sets: Score;
  setNumber: number;
  firstServer: TeamId;
  serving: TeamId;
  /** Claves de jugador en orden de posición 1..6 (índice = posición − 1). */
  lineups: Record<TeamId, string[]>;
  libero: Record<TeamId, string | null>;
  liberoReplaces: Record<TeamId, string[]>;
  winner: TeamId | null;
}

export interface PointOutcome {
  /** Marcador del set justo después del punto (antes de reiniciar si terminó el set). */
  points: Score;
  rotated: TeamId | null;
  setWinner: TeamId | null;
  matchWinner: TeamId | null;
}

export function createMatch(config: MatchConfig, a: TeamSetup, b: TeamSetup, firstServer: TeamId = 'A'): MatchState {
  return {
    config,
    points: { A: 0, B: 0 },
    sets: { A: 0, B: 0 },
    setNumber: 1,
    firstServer,
    serving: firstServer,
    lineups: { A: [...a.lineup], B: [...b.lineup] },
    libero: { A: a.libero, B: b.libero },
    liberoReplaces: { A: [...a.liberoReplaces], B: [...b.liberoReplaces] },
    winner: null,
  };
}

export const isFrontIndex = (i: number): boolean => i >= 1 && i <= 3;

export const isDecidingSet = (m: MatchState): boolean =>
  m.config.setsToWin > 1 && m.setNumber === m.config.setsToWin * 2 - 1;

export const pointsToWinSet = (m: MatchState): number => (isDecidingSet(m) ? 15 : 25);

export function rotate(m: MatchState, team: TeamId): void {
  const l = m.lineups[team];
  m.lineups[team] = [...l.slice(1), l[0]];
}

export function awardPoint(m: MatchState, winner: TeamId): PointOutcome {
  if (m.winner) throw new Error('El partido ya terminó');
  m.points[winner] += 1;
  const out: PointOutcome = { points: { ...m.points }, rotated: null, setWinner: null, matchWinner: null };
  if (m.serving !== winner) {
    m.serving = winner;
    rotate(m, winner);
    out.rotated = winner;
  }
  const lead = m.points[winner] - m.points[otherTeam(winner)];
  if (m.points[winner] >= pointsToWinSet(m) && lead >= 2) {
    m.sets[winner] += 1;
    out.setWinner = winner;
    if (m.sets[winner] >= m.config.setsToWin) {
      m.winner = winner;
      out.matchWinner = winner;
    } else {
      m.setNumber += 1;
      m.points = { A: 0, B: 0 };
      m.serving = m.setNumber % 2 === 1 ? m.firstServer : otherTeam(m.firstServer);
    }
  }
  return out;
}

/** Jugadores en cancha en orden de posición, con el líbero sustituyendo al central de zaga (excepto si saca). */
export function courtPlayers(m: MatchState, team: TeamId): string[] {
  const libero = m.libero[team];
  return m.lineups[team].map((key, i) => {
    const back = !isFrontIndex(i);
    const serving = i === 0 && m.serving === team;
    return libero && back && !serving && m.liberoReplaces[team].includes(key) ? libero : key;
  });
}
