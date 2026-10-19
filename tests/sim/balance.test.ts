import { describe, expect, it } from 'vitest';
import { makeTeam } from '../../src/data/teams';
import { runMatch } from '../../src/sim/headless';
import { TARGETS, attachMetrics, emptyMetrics, summarize } from '../../src/sim/metrics';

describe('balance (spec §7)', () => {
  it('métricas de 120 partidos IA vs IA dentro de rango', () => {
    const equal = makeTeam({ id: 'EQ', name: 'Iguales', province: '-', primary: '#888888', secondary: '#ffffff', style: 'balanced', seed: 1, variance: 0 });
    const m = emptyMetrics();
    for (let i = 0; i < 120; i++) {
      runMatch({ seed: 5000 + i, setsToWin: 1, teamA: equal, teamB: equal, firstServer: i % 2 === 0 ? 'A' : 'B' }, (sim) => attachMetrics(sim.bus, m));
    }
    const s = summarize(m);
    const within = (v: number, [lo, hi]: readonly [number, number]) => v >= lo && v <= hi;
    expect(within(s.touchesPerRally, TARGETS.touchesPerRally), `toques/rally ${s.touchesPerRally}`).toBe(true);
    expect(within(s.killRate, TARGETS.killRate), `kill rate ${s.killRate}`).toBe(true);
    expect(within(s.serveErrorRate, TARGETS.serveErrorRate), `error de saque ${s.serveErrorRate}`).toBe(true);
    // Con 120 partidos el ruido estadístico es ±9 %; el rango estricto 45–55 % se verifica con `npm run sim` (400 partidos).
    expect(within(s.winRateA, [0.4, 0.6]), `win rate A ${s.winRateA}`).toBe(true);
  }, 180_000);
});
