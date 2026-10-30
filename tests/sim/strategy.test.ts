import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { Simulation, type BlockFocus } from '../../src/sim/rally';
import { TUNING } from '../../src/sim/tuning';

/** Promedio de cuánto se corre el bloqueo del usuario hacia la banda (+) o hacia adentro (−) respecto del remate. */
function outward(focus: BlockFocus): number {
  const out: number[] = [];
  for (let seed = 1; seed <= 6; seed++) {
    const sim = new Simulation({ seed, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], control: 'A' });
    const s = sim as unknown as { blockSetup: { team: string; z: number } | null; plan: { kind: string; team: string; point: { z: number } } | null };
    let seen: unknown = null;
    for (let i = 0; i < 120 * 60 * 6 && sim.phase !== 'matchOver'; i++) {
      if (sim.deadBall) sim.setStrategy('A', focus);
      const d = sim.decision;
      if (d && d.chosen === null) sim.choose(0);
      else if (d && d.kind === 'serve' && sim.time - d.startTime > 0.6 && d.pressedAt === null) sim.press();
      else if (d && d.contactTime !== null && d.pressedAt === null && d.contactTime - sim.time <= 0.03) sim.press();
      sim.step(TUNING.dt);
      const b = s.blockSetup;
      const p = s.plan;
      if (b && b.team === 'A' && p?.kind === 'attack' && b !== seen && Math.abs(p.point.z) > 1.5) {
        seen = b;
        out.push(Math.sign(p.point.z) * (b.z - p.point.z));
      }
    }
  }
  return out.reduce((a, b) => a + b, 0) / out.length;
}

describe('estrategia de bloqueo', () => {
  it('cerrar la línea corre el bloqueo hacia la banda; cerrar la diagonal, hacia adentro', () => {
    const line = outward('line');
    const normal = outward('normal');
    const cross = outward('cross');
    expect(line).toBeGreaterThan(normal + 0.3);
    expect(normal).toBeGreaterThan(cross + 0.3);
  }, 120_000);

  it('solo se cambia con la pelota muerta', () => {
    const sim = new Simulation({ seed: 2, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], control: 'A' });
    while (sim.phase !== 'inPlay') {
      const d = sim.decision;
      if (d && d.chosen === null) sim.choose(0);
      else if (d && d.kind === 'serve' && sim.time - d.startTime > 0.6 && d.pressedAt === null) sim.press();
      sim.step(TUNING.dt);
    }
    expect(sim.setStrategy('A', 'line')).toBe(false);
    expect(sim.blockFocus.A).toBe('normal');
  });
});
