import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import type { TeamId } from '../../src/sim/court';
import { Simulation } from '../../src/sim/rally';
import { TUNING } from '../../src/sim/tuning';

describe('dos personas (online)', () => {
  it('cada equipo decide lo suyo, a veces a la vez (remate de uno y bloqueo del otro), y el partido termina', () => {
    const sim = new Simulation({ seed: 21, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], control: 'A', humans: ['A', 'B'], tempo: 'online' });
    const kinds: Record<TeamId, Set<string>> = { A: new Set(), B: new Set() };
    let both = 0;
    sim.bus.on((e) => {
      if (e.type !== 'decision') return;
      kinds[e.team].add(e.decision.kind);
      expect(sim.player(e.decision.playerKey).team).toBe(e.team);
    });
    while (sim.phase !== 'matchOver' && sim.time < 3 * 3600) {
      if (sim.decisions.A && sim.decisions.B) both += 1;
      for (const team of ['A', 'B'] as const) {
        const d = sim.decisions[team];
        if (!d) continue;
        if (d.kind === 'serve' && sim.time - d.startTime > 0.8) sim.press(sim.time, team);
        else if (d.contactTime !== null && d.contactTime - sim.time <= 0.05) sim.press(sim.time, team);
      }
      sim.step(TUNING.dt);
    }
    expect(sim.phase).toBe('matchOver');
    for (const t of ['A', 'B'] as const) expect(kinds[t]).toEqual(new Set(['serve', 'pass', 'set', 'attack', 'block']));
    expect(both).toBeGreaterThan(0);
  }, 60_000);
});
