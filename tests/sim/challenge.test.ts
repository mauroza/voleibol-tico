import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { otherTeam, type TeamId } from '../../src/sim/court';
import type { SimEvent } from '../../src/sim/events';
import { Simulation } from '../../src/sim/rally';
import { TUNING } from '../../src/sim/tuning';

const run = (sim: Simulation, onStep?: () => void) => {
  while (sim.phase !== 'matchOver' && sim.time < 3 * 3600) {
    onStep?.();
    sim.step(TUNING.dt);
  }
};

describe('jugadas cerradas y challenge', () => {
  it('la IA pide challenge: si el árbitro se equivocó se da vuelta, si no pierde uno', () => {
    let challenges = 0;
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 6; seed++) {
      const sim = new Simulation({ seed, setsToWin: 2, teamA: TEAMS[0], teamB: TEAMS[1] });
      const events: SimEvent[] = [];
      sim.bus.on((e) => { if (e.type === 'call' || e.type === 'challenge' || e.type === 'point') events.push(e); });
      run(sim);
      for (let i = 0; i < events.length; i++) {
        const c = events[i];
        if (c.type !== 'call') continue;
        kinds.add(c.kind);
        const next = events[i + 1];
        const point = events.slice(i + 1).find((e) => e.type === 'point');
        expect(point?.type).toBe('point');
        if (next.type === 'challenge') {
          challenges += 1;
          expect(next.team).toBe(otherTeam(c.calledWinner));
          if (point?.type === 'point') expect(point.winner === c.calledWinner).toBe(!next.overturned);
        } else if (point?.type === 'point') {
          expect(point.winner).toBe(c.calledWinner);
        }
      }
    }
    expect(kinds).toEqual(new Set(['line', 'touch']));
    expect(challenges).toBeGreaterThan(0);
  }, 60_000);

  it('el humano perjudicado puede pedir challenge (y solo él); los fallidos gastan uno', () => {
    const sim = new Simulation({ seed: 9, setsToWin: 2, teamA: TEAMS[0], teamB: TEAMS[1], control: 'A' });
    const results: { overturned: boolean; left: number; before: number }[] = [];
    let before = 0;
    sim.bus.on((e) => { if (e.type === 'challenge' && e.team === 'A') results.push({ overturned: e.overturned, left: sim.challengesLeft.A, before }); });
    run(sim, () => {
      const d = sim.decisions.A;
      if (d && (d.kind === 'serve' ? sim.time - d.startTime > 0.8 : d.contactTime !== null && d.contactTime - sim.time <= 0.05)) sim.press(sim.time, 'A');
      const call = sim.callPending;
      if (!call) return;
      const wronged: TeamId = otherTeam(call.calledWinner);
      expect(sim.canChallenge(call.calledWinner)).toBe(false);
      if (wronged === 'A' && sim.canChallenge('A')) {
        before = sim.challengesLeft.A;
        sim.challenge('A');
      }
    });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(r.left).toBe(r.overturned ? r.before : r.before - 1);
  }, 60_000);
});
