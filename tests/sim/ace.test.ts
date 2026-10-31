import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { aceBand, serveMeter } from '../../src/sim/decision';
import { Simulation } from '../../src/sim/rally';
import { TUNING } from '../../src/sim/tuning';

describe('saque morado', () => {
  it('en la franja morada sale un ace que nadie toca; tras 2 seguidos la franja se mueve y se achica', () => {
    const sim = new Simulation({ seed: 3, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], control: 'A', firstServer: 'A' });
    let aces = 0;
    let tries = 0;
    let receptions = 0;
    let label = '';
    const bands: [number, number][] = [];
    sim.bus.on((e) => {
      if (e.type === 'decision' && e.decision.kind === 'serve' && e.team === 'A') bands.push(aceBand(e.decision));
      if (e.type === 'decisionResolved' && e.kind === 'serve' && e.team === 'A') label = e.label ?? '';
      if (e.type === 'contact' && e.team === 'B' && label) receptions += 1;
      if (e.type === 'point' && label) {
        tries += 1;
        if (e.reason === 'ace' && e.winner === 'A') aces += 1;
        label = '';
      }
    });
    while (tries < 5 && sim.time < 900) {
      const d = sim.decisions.A;
      if (d?.kind === 'serve' && d.pressedAt === null) {
        const [from, to] = aceBand(d);
        const m = serveMeter(sim.time - d.startTime);
        if (m >= from && m <= to) sim.press();
      } else if (d && d.kind !== 'serve' && d.contactTime !== null && d.contactTime - sim.time <= 0.05) sim.press();
      sim.step(TUNING.dt);
    }
    expect(tries).toBe(5);
    expect(aces).toBe(5);
    expect(receptions).toBe(0);
    // Los dos primeros, en la puntita; desde el tercero, en otro lugar y cada vez más angosta.
    expect(bands[0]).toEqual([TUNING.power.ace, 1]);
    expect(bands[1]).toEqual([TUNING.power.ace, 1]);
    for (const b of bands.slice(2)) expect(b[1]).toBeLessThan(1);
    expect(bands[3][1] - bands[3][0]).toBeLessThan(bands[2][1] - bands[2][0]);
  });

  it('la racha se corta con cualquier otro punto', () => {
    const sim = new Simulation({ seed: 5, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], firstServer: 'A' });
    let checked = 0;
    sim.bus.on((e) => {
      if (e.type === 'point' && e.reason !== 'ace') {
        expect(sim.aceStreak.A + sim.aceStreak.B).toBe(0);
        checked += 1;
      }
    });
    while (sim.phase !== 'matchOver' && sim.time < 3600) sim.step(TUNING.dt);
    expect(checked).toBeGreaterThan(10);
  });
});
