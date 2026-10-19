import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import type { TeamId } from '../../src/sim/court';
import { runMatch } from '../../src/sim/headless';
import type { SimOptions } from '../../src/sim/rally';

const opts = (seed: number): SimOptions => ({ seed, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1] });

describe('Simulation', () => {
  it('es determinista con la misma semilla', () => {
    const a = runMatch(opts(5));
    const b = runMatch(opts(5));
    expect(a.time).toBe(b.time);
    expect(a.match.winner).toBe(b.match.winner);
  });

  it('completa un partido a 1 set', () => {
    const sim = runMatch(opts(9));
    expect(sim.phase).toBe('matchOver');
    expect(sim.match.sets[sim.match.winner!]).toBe(1);
  });

  it('respeta máximo 3 toques y sin doble contacto (20 partidos)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      runMatch(opts(seed), (sim) => {
        let side: TeamId | null = null;
        let count = 0;
        let lastKey: string | null = null;
        sim.bus.on((e) => {
          if (e.type === 'point') { side = null; count = 0; lastKey = null; return; }
          if (e.type !== 'contact') return;
          if (e.kind === 'serve' || e.kind === 'block') { side = e.team; count = 0; lastKey = e.kind === 'serve' ? e.playerKey : null; return; }
          if (e.team !== side) { side = e.team; count = 0; lastKey = null; }
          count += 1;
          expect(count).toBeLessThanOrEqual(3);
          expect(e.playerKey).not.toBe(lastKey);
          lastKey = e.playerKey;
        });
      });
    }
  });

  it('el líbero nunca saca, ni ataca, ni bloquea', () => {
    for (let seed = 1; seed <= 10; seed++) {
      runMatch(opts(seed), (sim) => {
        const liberos = new Set([`A:${TEAMS[0].libero}`, `B:${TEAMS[1].libero}`]);
        sim.bus.on((e) => {
          if (e.type === 'contact' && (e.kind === 'serve' || e.kind === 'attack' || e.kind === 'block')) {
            expect(liberos.has(e.playerKey)).toBe(false);
          }
        });
      });
    }
  });

  it('cada rally termina en menos de 60 s de simulación', () => {
    runMatch(opts(3), (sim) => {
      let start = 0;
      sim.bus.on((e) => {
        if (e.type === 'contact' && e.kind === 'serve') start = e.time;
        if (e.type === 'point') expect(sim.time - start).toBeLessThan(60);
      });
    });
  });
});
