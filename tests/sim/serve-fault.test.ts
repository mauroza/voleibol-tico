import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { Simulation } from '../../src/sim/rally';
import { TUNING } from '../../src/sim/tuning';

describe('saque', () => {
  it('el equipo que saca nunca toca su propio saque (si no pasa la red, es punto del rival)', () => {
    let serves = 0;
    let netServes = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const sim = new Simulation({ seed, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1] });
      let prev = sim.lastContact;
      let serveTeam: string | null = null;
      for (let i = 0; i < 120 * 60 * 8 && sim.phase !== 'matchOver'; i++) {
        sim.step(TUNING.dt);
        const c = sim.lastContact;
        if (c !== prev && c) {
          if (c.kind === 'serve') {
            serves++;
            serveTeam = c.team;
          } else if (serveTeam !== null) {
            // El primer toque después del saque es del rival.
            expect(c.team).not.toBe(serveTeam);
            serveTeam = null;
          }
          prev = c;
        }
        if (sim.phase === 'pointOver' && serveTeam !== null) {
          netServes++;
          serveTeam = null;
        }
      }
    }
    expect(serves).toBeGreaterThan(100);
    expect(netServes).toBeGreaterThan(0);
  }, 120_000);
});
