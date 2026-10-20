import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { attachStats } from '../../src/sim/stats';
import { Simulation } from '../../src/sim/rally';
import { TUNING } from '../../src/sim/tuning';

describe('calentamiento de remate', () => {
  it('los dos equipos hacen fila, el colocador coloca y rematan; tu rematador remata con mira; después empieza el partido', () => {
    const sim = new Simulation({ seed: 4, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], control: 'A', warmup: 40 });
    const stats = attachStats(sim.bus, 'A');
    expect(sim.phase).toBe('warmup');
    const attacks = { A: new Set<string>(), B: new Set<string>() };
    let sets = 0;
    let userSpikes = 0;
    sim.bus.on((e) => {
      if (e.type === 'contact' && e.warmup && e.kind === 'attack') attacks[e.team].add(e.playerKey);
      if (e.type === 'contact' && e.warmup && e.kind === 'set') sets += 1;
      if (e.type === 'decisionResolved' && e.kind === 'attack') userSpikes += 1;
    });
    let ended = false;
    sim.bus.on((e) => { if (e.type === 'warmupEnd') ended = true; });
    while (!ended && sim.time < 300) {
      const d = sim.decision;
      // Tu rematador: apunta al fondo y presiona en el amarillo.
      if (d?.kind === 'attack' && d.pressedAt === null && d.contactTime! - sim.time < 0.15) sim.press();
      sim.step(TUNING.dt);
    }
    expect(ended).toBe(true);
    expect(sim.phase).toBe('preServe');
    // Varios rematadores distintos de cada equipo pasaron por la fila.
    expect(attacks.A.size).toBeGreaterThan(2);
    expect(attacks.B.size).toBeGreaterThan(2);
    expect(sets).toBeGreaterThan(6);
    expect(userSpikes).toBeGreaterThan(2);
    // El calentamiento no cuenta en las estadísticas del partido.
    expect(stats.user.touches + stats.user.perfect + stats.user.good + stats.user.bad).toBe(0);
    expect(sim.match.points).toEqual({ A: 0, B: 0 });
  }, 60_000);
});
