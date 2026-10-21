import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { serveMeter } from '../../src/sim/decision';
import { Simulation } from '../../src/sim/rally';
import { TUNING } from '../../src/sim/tuning';

describe('saque morado', () => {
  it('en la puntita de la barra sale un ace que nadie toca y pica dentro', () => {
    const sim = new Simulation({ seed: 3, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], control: 'A', firstServer: 'A' });
    let aces = 0;
    let tries = 0;
    let receptions = 0;
    let label = '';
    sim.bus.on((e) => {
      if (e.type === 'decisionResolved' && e.kind === 'serve' && e.team === 'A') label = e.label ?? '';
      if (e.type === 'contact' && e.team === 'B' && label) receptions += 1;
      if (e.type === 'point' && label) {
        tries += 1;
        if (e.reason === 'ace' && e.winner === 'A') aces += 1;
        label = '';
      }
    });
    while (tries < 5 && sim.time < 600) {
      const d = sim.decisions.A;
      if (d?.kind === 'serve' && d.pressedAt === null && serveMeter(sim.time - d.startTime) >= TUNING.power.ace + 0.01) sim.press();
      else if (d && d.kind !== 'serve' && d.contactTime !== null && d.contactTime - sim.time <= 0.05) sim.press();
      sim.step(TUNING.dt);
    }
    expect(tries).toBe(5);
    expect(aces).toBe(5);
    expect(receptions).toBe(0);
  });
});
