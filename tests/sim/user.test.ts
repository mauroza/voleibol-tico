import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { landingTime, positionAt } from '../../src/sim/ball';
import { isInCourt, sideOfX } from '../../src/sim/court';
import { serveMeter, type DecisionKind } from '../../src/sim/decision';
import { Simulation } from '../../src/sim/rally';
import type { Timing } from '../../src/sim/resolver';
import { TUNING } from '../../src/sim/tuning';

type Bot = 'idle' | 'perfect';

/** Partido con el usuario controlando al equipo A. El bot perfecto elige la primera opción y presiona justo a tiempo. */
function play(seed: number, bot: Bot, onCreate?: (sim: Simulation) => void): Simulation {
  const sim = new Simulation({ seed, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], control: 'A' });
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

describe('control del equipo completo', () => {
  it('inactivo: el partido termina y toda decisión se resuelve como mala', () => {
    const timings: Timing[] = [];
    play(1, 'idle', (sim) => sim.bus.on((e) => { if (e.type === 'decisionResolved') timings.push(e.timing); }));
    expect(timings.length).toBeGreaterThan(20);
    expect(new Set(timings)).toEqual(new Set(['bad']));
  });

  it('el usuario decide saque, pase, colocación, ataque y bloqueo, siempre con jugadores de su equipo', () => {
    const kinds = new Set<DecisionKind>();
    play(2, 'idle', (sim) => sim.bus.on((e) => {
      if (e.type !== 'decision') return;
      kinds.add(e.decision.kind);
      expect(sim.player(e.decision.playerKey).team).toBe('A');
    }));
    expect(kinds).toEqual(new Set(['serve', 'pass', 'set', 'attack', 'block']));
  });

  it('el colocador ofrece rápida y semi-rápida al central cuando el pase es bueno', () => {
    const labels = new Set<string>();
    play(3, 'perfect', (sim) => sim.bus.on((e) => {
      if (e.type === 'decision' && e.decision.kind === 'set') e.decision.options.forEach((o) => labels.add(o.label));
    }));
    expect(labels).toContain('Rápida al central');
    expect(labels).toContain('Semi-rápida al centro');
  });

  it('elegir bloqueo triple pone a tres delanteros a bloquear', () => {
    let checked = 0;
    const sim = new Simulation({ seed: 4, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], control: 'A' });
    while (sim.phase !== 'matchOver' && checked < 5) {
      const d = sim.decision;
      if (d?.kind === 'block' && d.chosen === null) {
        const triple = d.options.findIndex((o) => o.label === 'Bloqueo triple');
        if (triple >= 0) {
          sim.choose(triple);
          expect(sim.blockers?.keys).toHaveLength(3);
          checked += 1;
        } else sim.choose(0);
      }
      sim.step(TUNING.dt);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('tiempo casi detenido mientras no elige; acercamiento y cámara lenta después', () => {
    const cfg = TUNING.decision;
    const seen = new Set<number>();
    const sim = new Simulation({ seed: 4, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], control: 'A' });
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
      for (let seed = 1; seed <= 30; seed++) {
        play(seed, bot, (sim) => sim.bus.on((e) => {
          if (e.type === 'point') { total += 1; if (e.winner === 'A') a += 1; }
        }));
      }
      return a / total;
    };
    expect(share('perfect')).toBeGreaterThan(share('idle') + 0.05);
  }, 180_000);
});

describe('pelota en la red', () => {
  it('una pelota que cae junto a la red cae del lado del equipo que pierde el punto (no atraviesa la red)', () => {
    let nearNet = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const sim = new Simulation({ seed, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1] });
      sim.bus.on((e) => {
        if (e.type !== 'point') return;
        const land = positionAt(sim.ball, landingTime(sim.ball));
        // Dentro de la cancha, junto a la red: pierde el lado donde cae (incluye las pelotas que pegan en la red).
        if (Math.abs(land.x) < 0.6 && isInCourt(land)) {
          nearNet += 1;
          expect(sideOfX(land.x)).toBe(e.winner === 'A' ? 'B' : 'A');
        }
      });
      while (sim.phase !== 'matchOver') sim.step(TUNING.dt);
    }
    expect(nearNet).toBeGreaterThan(5);
  });
});
