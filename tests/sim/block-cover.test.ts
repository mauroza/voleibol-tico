import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { runMatch } from '../../src/sim/headless';

describe('cobertura del bloqueo', () => {
  it('a veces la cobertura levanta la pelota que vuelve de la tapa y la jugada sigue', () => {
    let stuffs = 0;
    let covered = 0;
    for (let seed = 1; seed <= 6; seed++) {
      let blocked: string | null = null;
      runMatch({ seed, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1] }, (sim) =>
        sim.bus.on((e) => {
          if (e.type === 'contact' && e.kind === 'block' && e.quality >= 0.9) {
            stuffs += 1;
            blocked = e.team === 'A' ? 'B' : 'A';
          } else if (e.type === 'contact' && blocked) {
            if (e.team === blocked) covered += 1;
            blocked = null;
          } else if (e.type === 'point') blocked = null;
        }),
      );
    }
    expect(stuffs).toBeGreaterThan(5);
    expect(covered).toBeGreaterThan(0);
    // La tapa sigue valiendo: la mayoría termina en punto.
    expect(covered / stuffs).toBeLessThan(0.6);
  }, 30_000);
});
