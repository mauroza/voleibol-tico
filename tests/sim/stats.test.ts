import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { EventBus } from '../../src/sim/events';
import { runMatch } from '../../src/sim/headless';
import type { Difficulty } from '../../src/sim/rally';
import { attachStats } from '../../src/sim/stats';

describe('attachStats', () => {
  it('cuenta puntos por motivo y atribuye al equipo controlado', () => {
    const bus = new EventBus();
    const s = attachStats(bus, 'A');
    const sets = { A: 0, B: 0 };
    const contact = (playerKey: string, team: 'A' | 'B', kind: 'serve' | 'reception' | 'set' | 'attack' | 'block') =>
      bus.emit({ type: 'contact', time: 0, playerKey, team, kind, quality: 0.5 });
    contact('A:u', 'A', 'serve');
    bus.emit({ type: 'point', winner: 'A', reason: 'ace', points: { A: 1, B: 0 }, sets });
    contact('A:x', 'A', 'serve'); contact('B:y', 'B', 'reception'); contact('B:z', 'B', 'attack'); contact('A:u', 'A', 'block');
    bus.emit({ type: 'point', winner: 'A', reason: 'blockKill', points: { A: 2, B: 0 }, sets });
    contact('A:x', 'A', 'serve'); contact('B:y', 'B', 'reception'); contact('B:z', 'B', 'attack');
    bus.emit({ type: 'point', winner: 'B', reason: 'kill', points: { A: 2, B: 1 }, sets });
    bus.emit({ type: 'decisionResolved', kind: 'serve', timing: 'perfect' });
    bus.emit({ type: 'decisionResolved', kind: 'pass', timing: 'bad' });

    expect(s.teams.A).toMatchObject({ points: 2, aces: 1, blocks: 1 });
    expect(s.teams.B).toMatchObject({ points: 1, kills: 1 });
    expect(s.user).toMatchObject({ touches: 4, aces: 1, blocks: 1, kills: 0, perfect: 1, bad: 1 });
  });
});

describe('dificultad', () => {
  const shareA = (difficulty: Difficulty) => {
    let a = 0;
    let total = 0;
    for (let seed = 1; seed <= 50; seed++) {
      runMatch({ seed, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[0], difficulty }, (sim) => sim.bus.on((e) => {
        if (e.type === 'point') { total += 1; if (e.winner === 'A') a += 1; }
      }));
    }
    return a / total;
  };

  it('el rival difícil gana más puntos que el fácil', () => {
    const easy = shareA('easy');
    const hard = shareA('hard');
    expect(easy).toBeGreaterThan(hard + 0.025);
  }, 120_000);
});
