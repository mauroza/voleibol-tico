import type { TeamId } from './court';
import type { EventBus } from './events';

export interface TeamStats {
  points: number;
  aces: number;
  kills: number;
  blocks: number;
  errors: number;
}

export interface UserStats {
  touches: number;
  perfect: number;
  good: number;
  bad: number;
  aces: number;
  kills: number;
  blocks: number;
}

export interface MatchStats {
  teams: Record<TeamId, TeamStats>;
  user: UserStats;
}

const emptyTeam = (): TeamStats => ({ points: 0, aces: 0, kills: 0, blocks: 0, errors: 0 });

/** Estadísticas del partido a partir de los eventos. El objeto devuelto se actualiza en vivo. */
export function attachStats(bus: EventBus, userKey: string | null): MatchStats {
  const s: MatchStats = {
    teams: { A: emptyTeam(), B: emptyTeam() },
    user: { touches: 0, perfect: 0, good: 0, bad: 0, aces: 0, kills: 0, blocks: 0 },
  };
  let server: string | null = null;
  let attacker: string | null = null;
  let blocker: string | null = null;
  bus.on((e) => {
    if (e.type === 'contact') {
      if (e.playerKey === userKey) s.user.touches += 1;
      if (e.kind === 'serve') {
        server = e.playerKey;
        attacker = null;
        blocker = null;
      } else if (e.kind === 'attack') attacker = e.playerKey;
      else if (e.kind === 'block') blocker = e.playerKey;
    } else if (e.type === 'decisionResolved') {
      s.user[e.timing] += 1;
    } else if (e.type === 'point') {
      const loser: TeamId = e.winner === 'A' ? 'B' : 'A';
      s.teams[e.winner].points += 1;
      if (e.reason === 'ace') {
        s.teams[e.winner].aces += 1;
        if (server === userKey) s.user.aces += 1;
      } else if (e.reason === 'kill' || e.reason === 'blockOut') {
        s.teams[e.winner].kills += 1;
        if (attacker === userKey) s.user.kills += 1;
      } else if (e.reason === 'blockKill') {
        s.teams[e.winner].blocks += 1;
        if (blocker === userKey) s.user.blocks += 1;
      } else if (e.reason !== 'landed') {
        s.teams[loser].errors += 1;
      }
    }
  });
  return s;
}
