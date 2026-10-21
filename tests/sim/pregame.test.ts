import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { sideOfX, sideSign, type TeamId } from '../../src/sim/court';
import { Simulation } from '../../src/sim/rally';
import { TUNING } from '../../src/sim/tuning';

const steps = (sim: Simulation) => {
  const seen: string[] = [];
  sim.bus.on((e) => { if (e.type === 'ceremony') seen.push(e.step); });
  return seen;
};

describe('previa del partido', () => {
  it('entrada, remate por zona 4, por zona 2, saque, saludo, sorteo, alineación y partido (IA contra IA)', () => {
    const sim = new Simulation({ seed: 4, setsToWin: 2, teamA: TEAMS[0], teamB: TEAMS[1], warmup: 15, pregame: true });
    const seen = steps(sim);
    let toss: TeamId | null = null;
    let sides = 0;
    let warmServes = 0;
    let firstServe: TeamId | null = null;
    sim.bus.on((e) => {
      if (e.type === 'toss') toss = e.winner;
      if (e.type === 'sides') sides += 1;
      if (e.type === 'contact' && e.warmup && e.kind === 'serve') warmServes += 1;
      if (e.type === 'contact' && !e.warmup && e.kind === 'serve' && !firstServe) firstServe = e.team;
    });
    expect(sim.ceremony?.step).toBe('entrance');
    while (sim.phase !== 'matchOver' && sim.time < 3 * 3600) sim.step(TUNING.dt);
    expect(seen.slice(0, 6)).toEqual(['spike4', 'spike2', 'serve', 'greeting', 'toss', 'lineup']);
    expect(warmServes).toBeGreaterThanOrEqual(2);
    expect(firstServe).toBe(toss);
    // Cambio de cancha después de cada set (más el lado elegido en el sorteo).
    expect(sides).toBeGreaterThanOrEqual(2);
    expect(sim.phase).toBe('matchOver');
  }, 60_000);

  it('la persona elige lado si pierde el sorteo y arma su alineación; se puede saltar todo', () => {
    let done = false;
    for (let seed = 1; seed < 20 && !done; seed++) {
      const sim = new Simulation({ seed, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], control: 'A', warmup: 60, pregame: true });
      sim.skip('A', true);
      expect(sim.ceremony?.step).toBe('toss');
      if (sim.ceremony?.tossWinner === 'A') continue;
      // Antes de ver la moneda no se puede elegir.
      sim.chooseSide('A', false);
      expect(sim.ceremony?.sub).toBe(0);
      while (sim.sideKey('A') === null) sim.step(TUNING.dt);
      sim.chooseSide('A', false);
      // A a la derecha: x > 0.
      expect(sideSign('A')).toBe(1);
      while (sim.ceremony?.step !== 'lineup') sim.step(TUNING.dt);
      const bench = sim.bench('A');
      const lineup = [...sim.match.lineups.A];
      expect(sim.submitLineup('A', lineup.map(() => lineup[0]))).toBe(false);
      lineup[1] = bench.find((k) => sim.player(k).def.role === 'OH')!;
      expect(sim.submitLineup('A', lineup)).toBe(true);
      expect(sim.match.lineups.A).toEqual(lineup);
      expect(sim.match.serving).toBe('B');
      while (sim.phase !== 'inPlay') sim.step(TUNING.dt);
      for (const k of sim.court('A')) expect(sideOfX(sim.player(k).pos.x)).toBe('A');
      done = true;
    }
    expect(done).toBe(true);
  });

  it('sin previa también cambian de cancha al terminar el set (caminando)', () => {
    const sim = new Simulation({ seed: 2, setsToWin: 2, teamA: TEAMS[0], teamB: TEAMS[1] });
    let flips = 0;
    sim.bus.on((e) => { if (e.type === 'sides') flips += 1; });
    while (sim.match.setNumber === 1) sim.step(TUNING.dt);
    while (sim.phase !== 'preServe' || sim.arriving) sim.step(TUNING.dt);
    expect(flips).toBe(1);
    expect(sideSign('A')).toBe(1);
    for (const k of sim.court('A')) expect(sim.player(k).pos.x).toBeGreaterThan(0);
  }, 30_000);
});
