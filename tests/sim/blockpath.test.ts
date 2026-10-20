import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { runMatch } from '../../src/sim/headless';
import { attackContactHeight, blockReach } from '../../src/sim/players';
import { TUNING } from '../../src/sim/tuning';

describe('bloqueo sólido', () => {
  it('un remate que pasa sin tocar el bloqueo no atraviesa manos ni cuerpos', () => {
    let passes = 0;
    let through = 0;
    for (let seed = 1; seed <= 6; seed++) {
      runMatch({ seed, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1] }, (sim) => {
        let keys: readonly string[] = [];
        let watching = false;
        let hit = false;
        sim.bus.on((e) => {
          if (e.type !== 'contact') return;
          if (e.kind === 'attack') { keys = sim.blockers?.keys ?? []; watching = keys.length > 0; hit = false; passes += watching ? 1 : 0; }
          else if (e.kind === 'block') hit = true;
          else watching = false;
        });
        const orig = sim.step.bind(sim);
        sim.step = (dt: number) => {
          const before = { ...sim.ballPos };
          orig(dt);
          if (!watching || hit || sim.phase !== 'inPlay') return;
          const after = sim.ballPos;
          for (const k of keys) {
            const p = sim.player(k);
            // Solo cuenta quien está en la red (saltando); el que ya bajó y se aleja no es pared.
            if (Math.abs(p.pos.x) > 0.7) continue;
            // Plano del bloqueador: el cuerpo y, delante, las manos sobre la red.
            for (const x of [p.pos.x, p.pos.x * 0.3]) {
              if ((before.x - x) * (after.x - x) > 0 || before.x === after.x) continue;
              const f = (x - before.x) / (after.x - before.x);
              const y = before.y + (after.y - before.y) * f;
              const z = before.z + (after.z - before.z) * f;
              if (y < blockReach(p.def) - 0.1 && Math.abs(z - p.pos.z) < TUNING.block.bodyHalfWidth - 0.2) through += 1;
            }
          }
        };
      });
    }
    expect(passes).toBeGreaterThan(100);
    expect(through / passes).toBeLessThan(0.005);
  }, 120_000);
});

describe('físico de los jugadores', () => {
  it('estaturas distintas por puesto y una figura por equipo que salta más', () => {
    for (const t of TEAMS) {
      const heights = new Set(t.roster.map((p) => p.height));
      expect(heights.size).toBeGreaterThan(5);
      const stars = t.roster.filter((p) => p.star);
      expect(stars).toHaveLength(1);
      const others = t.roster.filter((p) => !p.star && (p.role === 'OH' || p.role === 'OP')).map(attackContactHeight);
      const mean = others.reduce((a, b) => a + b, 0) / others.length;
      expect(attackContactHeight(stars[0])).toBeGreaterThan(mean + 0.08);
    }
    const mbs = TEAMS.flatMap((t) => t.roster.filter((p) => p.role === 'MB')).map((p) => p.height);
    const libs = TEAMS.flatMap((t) => t.roster.filter((p) => p.role === 'L')).map((p) => p.height);
    expect(Math.min(...mbs)).toBeGreaterThan(Math.max(...libs));
  });
});

describe('finta del central', () => {
  it('cuando la pelota va a otro atacante, el central delantero llega a la red para la rápida', () => {
    let decoys = 0;
    let atNet = 0;
    runMatch({ seed: 3, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1] }, (sim) => {
      let seen: unknown = null;
      const orig = sim.step.bind(sim);
      sim.step = (dt: number) => {
        orig(dt);
        const d = sim.decoy;
        if (!d || d === seen || sim.time < d.time) return;
        seen = d;
        decoys += 1;
        const p = sim.player(d.key);
        expect(p.def.role).toBe('MB');
        if (Math.abs(p.pos.x) < 1.6) atNet += 1;
      };
    });
    expect(decoys).toBeGreaterThan(10);
    expect(atNet / decoys).toBeGreaterThan(0.8);
  }, 60_000);
});
