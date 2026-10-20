import type { TeamId } from './court';
import type { EventBus } from './events';

export interface Metrics {
  matches: number;
  rallies: number;
  contacts: number;
  attacks: number;
  kills: number;
  serves: number;
  serviceErrors: number;
  aces: number;
  wins: Record<TeamId, number>;
}

export interface Summary {
  touchesPerRally: number;
  killRate: number;
  serveErrorRate: number;
  aceRate: number;
  winRateA: number;
}

/** Rangos objetivo del spec §7. */
export const TARGETS: Record<'touchesPerRally' | 'killRate' | 'serveErrorRate' | 'aceRate' | 'winRateA', readonly [number, number]> = {
  aceRate: [0.04, 0.1],
  touchesPerRally: [3, 8],
  killRate: [0.35, 0.55],
  serveErrorRate: [0.08, 0.15],
  winRateA: [0.45, 0.55],
};

export const emptyMetrics = (): Metrics => ({
  matches: 0, rallies: 0, contacts: 0, attacks: 0, kills: 0, serves: 0, serviceErrors: 0, aces: 0, wins: { A: 0, B: 0 },
});

export function attachMetrics(bus: EventBus, m: Metrics): void {
  /** Equipo cuyo último ataque sigue vivo (nadie más lo ha tocado salvo un bloqueo). */
  let pendingAttack: TeamId | null = null;
  bus.on((e) => {
    if (e.type === 'contact') {
      m.contacts += 1;
      if (e.kind === 'serve') {
        m.serves += 1;
        m.rallies += 1;
      }
      if (e.kind === 'attack') {
        m.attacks += 1;
        pendingAttack = e.team;
      } else if (e.kind !== 'block') {
        pendingAttack = null;
      }
    } else if (e.type === 'point') {
      if (pendingAttack && e.winner === pendingAttack) m.kills += 1;
      pendingAttack = null;
      if (e.reason === 'serviceError') m.serviceErrors += 1;
      if (e.reason === 'ace') m.aces += 1;
    } else if (e.type === 'matchEnd') {
      m.matches += 1;
      m.wins[e.winner] += 1;
    }
  });
}

const ratio = (a: number, b: number): number => (b === 0 ? 0 : a / b);

export function summarize(m: Metrics): Summary {
  return {
    touchesPerRally: ratio(m.contacts, m.rallies),
    killRate: ratio(m.kills, m.attacks),
    serveErrorRate: ratio(m.serviceErrors, m.serves),
    aceRate: ratio(m.aces, m.serves),
    winRateA: ratio(m.wins.A, m.matches),
  };
}
