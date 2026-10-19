import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { serveMeter, type DecisionKind } from '../../src/sim/decision';
import type { Role } from '../../src/sim/players';
import { Simulation } from '../../src/sim/rally';
import type { Timing } from '../../src/sim/resolver';
import { TUNING } from '../../src/sim/tuning';

type Bot = 'idle' | 'perfect';

function play(role: Role, seed: number, bot: Bot, onCreate?: (sim: Simulation) => void): Simulation {
  const sim = new Simulation({ seed, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], user: { role } });
  onCreate?.(sim);
  while (sim.phase !== 'matchOver') {
    const d = sim.decision;
    if (bot === 'perfect' && d) {
      if (d.chosen === null) sim.choose(0);
      if (d.kind === 'serve') {
        if (serveMeter(sim.time - d.startTime) >= 0.97) sim.press();
      } else if (d.contactTime !== null && d.contactTime - sim.time <= 0.03) {
        sim.press();
      }
    }
    sim.step(TUNING.dt);
    if (sim.time > 6 * 3600) throw new Error('Partido trabado');
  }
  return sim;
}

describe('jugador del usuario', () => {
  it('inactivo: el partido termina y toda decisión se resuelve como mala', () => {
    const timings: Timing[] = [];
    play('OH', 1, 'idle', (sim) => sim.bus.on((e) => { if (e.type === 'decisionResolved') timings.push(e.timing); }));
    expect(timings.length).toBeGreaterThan(10);
    expect(new Set(timings)).toEqual(new Set(['bad']));
  });

  it('las decisiones corresponden a la posición', () => {
    const kinds = (role: Role) => {
      const seen = new Set<DecisionKind>();
      play(role, 2, 'idle', (sim) => sim.bus.on((e) => { if (e.type === 'decision') seen.add(e.decision.kind); }));
      return seen;
    };
    expect(kinds('S').has('set')).toBe(true);
    const oh = kinds('OH');
    expect(oh.has('pass')).toBe(true);
    expect(oh.has('attack')).toBe(true);
  });

  it('un central nunca sale de cancha', () => {
    play('MB', 3, 'idle', (sim) => {
      sim.bus.on((e) => {
        if (e.type === 'rotation' || e.type === 'contact') expect(sim.court('A')).toContain(sim.userKey);
      });
    });
  });

  it('tiempo casi detenido mientras no elige; acercamiento y cámara lenta después', () => {
    const cfg = TUNING.decision;
    const seen = new Set<number>();
    const sim = new Simulation({ seed: 4, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], user: { role: 'S' } });
    for (let i = 0; i < 200000 && sim.phase !== 'matchOver' && seen.size < 3; i++) {
      const d = sim.decision;
      if (!d || d.contactTime === null) {
        expect(sim.timeScale).toBe(1);
      } else if (d.chosen === null) {
        expect(sim.timeScale).toBe(cfg.thinkScale);
        seen.add(cfg.thinkScale);
        if (d.contactTime - sim.time < 0.9) sim.choose(0);
      } else {
        const near = d.contactTime - sim.time <= cfg.slowWindow;
        expect(sim.timeScale).toBe(near ? cfg.slowScale : cfg.approachScale);
        seen.add(near ? cfg.slowScale : cfg.approachScale);
      }
      sim.step(TUNING.dt);
    }
    expect(seen).toEqual(new Set([cfg.thinkScale, cfg.approachScale, cfg.slowScale]));
  });

  it('jugar perfecto gana más puntos que no hacer nada', () => {
    const share = (bot: Bot) => {
      let a = 0;
      let total = 0;
      for (let seed = 1; seed <= 40; seed++) {
        play('OH', seed, bot, (sim) => sim.bus.on((e) => {
          if (e.type === 'point') { total += 1; if (e.winner === 'A') a += 1; }
        }));
      }
      return a / total;
    };
    expect(share('perfect')).toBeGreaterThan(share('idle') + 0.03);
  }, 120_000);
});
