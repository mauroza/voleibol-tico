import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { COURT, type TeamId } from '../../src/sim/court';
import { runMatch } from '../../src/sim/headless';
import { Simulation, type SimOptions } from '../../src/sim/rally';
import { TUNING } from '../../src/sim/tuning';

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
  }, 30_000);

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

  it('upcoming anticipa al jugador del próximo contacto', () => {
    let checked = 0;
    runMatch(opts(6), (sim) => {
      let expected: { key: string; time: number } | null = null;
      sim.bus.on((e) => {
        if (e.type !== 'contact') return;
        if (expected && e.kind !== 'serve') {
          expect(e.playerKey).toBe(expected.key);
          expect(e.time).toBeGreaterThanOrEqual(expected.time - 1e-9);
          checked += 1;
        }
      });
      const origStep = sim.step.bind(sim);
      sim.step = (dt: number) => {
        const up = sim.upcoming;
        expected = up ? { key: up.key, time: up.time } : null;
        origStep(dt);
      };
    });
    expect(checked).toBeGreaterThan(50);
  });

  it('hay bloqueos simples, dobles y triples; el bloqueador simple es el de la zona del remate', () => {
    const sizes = new Set<number>();
    let zoneChecks = 0;
    for (let seed = 1; seed <= 10; seed++) {
      runMatch(opts(seed), (sim) => {
        let seen: unknown = null;
        const orig = sim.step.bind(sim);
        sim.step = (dt: number) => {
          orig(dt);
          const b = sim.blockers;
          if (!b || b === seen) return;
          seen = b;
          sizes.add(b.keys.length);
          if (b.keys.length === 1 && Math.abs(b.z) > 2.8) {
            // Con remate por un extremo, bloquea el delantero cuya zona es ese extremo (nunca el central).
            expect(sim.player(b.keys[0]).def.role).not.toBe('MB');
            zoneChecks += 1;
          }
        };
      });
    }
    expect(sizes).toEqual(new Set([1, 2, 3]));
    expect(zoneChecks).toBeGreaterThan(0);
  });

  it('dos compañeros en cancha nunca quedan uno encima del otro', () => {
    let minDist = Infinity;
    for (let seed = 1; seed <= 5; seed++) {
      runMatch(opts(seed), (sim) => {
        const orig = sim.step.bind(sim);
        sim.step = (dt: number) => {
          orig(dt);
          for (const team of ['A', 'B'] as const) {
            const ps = sim.court(team).map((k) => sim.player(k).pos);
            for (let i = 0; i < ps.length; i++) {
              for (let j = i + 1; j < ps.length; j++) minDist = Math.min(minDist, Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z));
            }
          }
        };
      });
    }
    expect(minDist).toBeGreaterThan(0.45);
  }, 60_000);

  it('la pelota rebota en el piso después de caer', () => {
    const sim = new Simulation(opts(8));
    let bounced = 0;
    let landedAt: number | null = null;
    let maxAfter = 0;
    while (sim.phase !== 'matchOver' && bounced < 5) {
      sim.step(TUNING.dt);
      if (sim.phase === 'pointOver') {
        if (landedAt === null && sim.ballPos.y <= COURT.ballRadius + 0.02) landedAt = sim.time;
        if (landedAt !== null) maxAfter = Math.max(maxAfter, sim.ballPos.y);
      } else if (landedAt !== null) {
        if (maxAfter > 0.3) bounced += 1;
        landedAt = null;
        maxAfter = 0;
      }
    }
    expect(bounced).toBeGreaterThanOrEqual(5);
  });

  it('ningún jugador cruza la línea central', () => {
    let worst = Infinity;
    for (let seed = 1; seed <= 3; seed++) {
      runMatch(opts(seed), (sim) => {
        const orig = sim.step.bind(sim);
        sim.step = (dt: number) => {
          orig(dt);
          for (const team of ['A', 'B'] as const) {
            const s = team === 'A' ? -1 : 1;
            for (const k of sim.court(team)) worst = Math.min(worst, s * sim.player(k).pos.x);
          }
        };
      });
    }
    expect(worst).toBeGreaterThanOrEqual(0.19);
  }, 60_000);

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
