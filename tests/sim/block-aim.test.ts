import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { Simulation } from '../../src/sim/rally';
import { TUNING } from '../../src/sim/tuning';

/**
 * Remata apuntando fuera (o dentro) de la sombra del bloqueo y cuenta cuántos remates toca el bloqueo rival.
 * `inside`: apunta justo detrás del bloqueador más cercano.
 */
function blockedShare(inside: boolean): { attempts: number; blocked: number } {
  let attempts = 0;
  let blocked = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const sim = new Simulation({ seed, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], control: 'A' });
    let waiting = false;
    sim.bus.on((e) => {
      if (e.type !== 'contact' || !waiting || e.kind === 'attack') return;
      if (e.kind === 'block' && e.team === 'B') blocked += 1;
      waiting = false;
    });
    while (sim.phase !== 'matchOver' && attempts < 400) {
      const d = sim.decision;
      if (d?.kind === 'attack' && d.aim && d.pressedAt === null && d.options[0].option.id === 'aim') {
        const shadow = sim.blockShadow;
        if (shadow && d.contactTime! - sim.time <= 0.25) {
          const { from, walls, side } = shadow;
          const half = TUNING.block.bodyHalfWidth;
          let pick: { x: number; z: number } | null = null;
          for (const depth of [7, 6, 5, 8]) for (const z of [-3.8, -2.5, -1.2, 0, 1.2, 2.5, 3.8]) {
            const x = side * depth;
            const atNet = from.z + ((z - from.z) * (0 - from.x)) / (x - from.x);
            const gap = Math.min(...walls.map((w) => Math.abs(atNet - w.z)));
            if (!pick && (inside ? gap < 0.15 : gap > half + 0.4)) pick = { x, z };
          }
          if (pick) {
            sim.setAim(pick.x, pick.z);
            sim.press();
            attempts += 1;
            waiting = true;
          }
        }
      } else if (d && d.chosen === null) sim.choose(0);
      else if (d && d.kind === 'serve' && sim.time - d.startTime > 0.7) sim.press();
      else if (d && d.contactTime !== null && d.pressedAt === null && d.contactTime - sim.time <= 0.03) sim.press();
      sim.step(TUNING.dt);
    }
  }
  return { attempts, blocked };
}

describe('bloqueo según la mira', () => {
  it('apuntado fuera de la sombra del bloqueo, casi nunca lo tocan; dentro, sí', () => {
    const out = blockedShare(false);
    expect(out.attempts).toBeGreaterThan(30);
    expect(out.blocked / out.attempts).toBeLessThan(0.05);
    const inside = blockedShare(true);
    expect(inside.attempts).toBeGreaterThan(30);
    expect(inside.blocked / inside.attempts).toBeGreaterThan(0.2);
  }, 120_000);
});

describe('colocación pegada o despegada', () => {
  /** Distancia media a la red de los remates cuando se coloca apuntando a `depth` m de la red. */
  function attackDepth(depth: number): number {
    const seen: number[] = [];
    for (let seed = 1; seed <= 16 && seen.length < 60; seed++) {
      const sim = new Simulation({ seed, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], control: 'A' });
      let set = false;
      sim.bus.on((e) => {
        if (e.type === 'contact' && e.kind === 'attack' && e.team === 'A' && set) seen.push(Math.abs(sim.player(e.playerKey).pos.x));
        if (e.type === 'contact' && e.kind !== 'set') set = false;
      });
      while (sim.phase !== 'matchOver' && seen.length < 60) {
        const d = sim.decision;
        if (d?.kind === 'set' && d.aim && d.pressedAt === null) {
          const side = Math.sign(sim.player(d.playerKey).pos.x) || 1;
          sim.setAim(side * depth, d.aim.z);
          if (d.contactTime! - sim.time <= 0.4) {
            sim.press();
            set = true;
          }
        } else if (d && d.chosen === null) sim.choose(0);
        else if (d && d.kind === 'serve' && sim.time - d.startTime > 0.7) sim.press();
        else if (d && d.contactTime !== null && d.pressedAt === null && d.contactTime - sim.time <= 0.03) sim.press();
        sim.step(TUNING.dt);
      }
    }
    return seen.reduce((a, b) => a + b, 0) / seen.length;
  }

  it('la mira decide a qué distancia de la red llega la colocación', () => {
    // Donde salta el rematador: metro y medio más atrás cuando la colocación va despegada (60 remates por lado).
    const far = attackDepth(2.6);
    const near = attackDepth(0.5);
    expect(far - near).toBeGreaterThan(1.2);
  }, 120_000);
});
