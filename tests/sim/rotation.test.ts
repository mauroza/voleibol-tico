import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { runMatch } from '../../src/sim/headless';
import { courtPlayers, isFrontIndex } from '../../src/sim/match';
import type { Role } from '../../src/sim/players';
import { Simulation } from '../../src/sim/rally';
import { TUNING } from '../../src/sim/tuning';

const opts = (seed: number) => ({ seed, setsToWin: 1 as const, teamA: TEAMS[0], teamB: TEAMS[1] });

describe('5-1 y rotaciones', () => {
  it('formación 5-1: colocador opuesto al opuesto, puntas y centrales enfrentados', () => {
    for (const t of TEAMS) {
      const roles = t.lineup.map((id) => t.roster.find((p) => p.id === id)!.role);
      expect(roles.filter((r) => r === 'S')).toHaveLength(1);
      const opposite = (i: number) => roles[(i + 3) % 6];
      expect(opposite(roles.indexOf('S'))).toBe('OP');
      roles.forEach((r, i) => { if (r === 'OH' || r === 'MB') expect(opposite(i)).toBe(r); });
    }
  });

  it('al ganar el saque el equipo rota en sentido horario y saca quien estaba en la posición 2', () => {
    let checks = 0;
    runMatch(opts(11), (sim) => {
      let before: Record<string, string[]> = { A: [...sim.match.lineups.A], B: [...sim.match.lineups.B] };
      let serving = sim.match.serving;
      sim.bus.on((e) => {
        if (e.type !== 'point' || e.sets.A + e.sets.B > 0) return;
        const w = e.winner;
        if (w !== serving) {
          expect(sim.match.lineups[w]).toEqual([...before[w].slice(1), before[w][0]]);
          checks += 1;
        } else expect(sim.match.lineups[w]).toEqual(before[w]);
        before = { A: [...sim.match.lineups.A], B: [...sim.match.lineups.B] };
        serving = sim.match.serving;
      });
    });
    expect(checks).toBeGreaterThan(10);
  });

  it('el líbero solo entra por un central de zaga y nunca saca', () => {
    runMatch(opts(12), (sim) => {
      sim.bus.on((e) => {
        if (e.type !== 'point') return;
        for (const team of ['A', 'B'] as const) {
          const court = courtPlayers(sim.match, team);
          const libero = sim.match.libero[team]!;
          const i = court.indexOf(libero);
          if (i < 0) continue;
          expect(isFrontIndex(i)).toBe(false);
          const replaced = sim.match.lineups[team][i];
          expect(sim.player(replaced).def.role).toBe('MB');
          if (sim.match.serving === team) expect(i).not.toBe(0);
        }
      });
    });
  });

  it('en recepción no recibe el colocador, y si toca la primera, coloca el líbero', () => {
    const receivers: Role[] = [];
    let setterFirst = 0;
    let liberoSets = 0;
    for (let seed = 1; seed <= 16; seed++) {
      runMatch(opts(seed), (sim) => {
        let first: Role | null = null;
        sim.bus.on((e) => {
          if (e.type !== 'contact') return;
          const role = sim.player(e.playerKey).def.role;
          if (e.kind === 'reception') receivers.push(role);
          // Solo primeras pelotas controladas (no pelotazos ni recepciones que se van).
          if (e.kind === 'reception' || e.kind === 'dig') first = e.quality >= 0.45 ? role : null;
          else if (e.kind === 'set' && first === 'S') {
            setterFirst += 1;
            if (role === 'L') liberoSets += 1;
            first = null;
          } else first = null;
        });
      });
    }
    const setterShare = receivers.filter((r) => r === 'S').length / receivers.length;
    expect(setterShare).toBeLessThan(0.03);
    expect(setterFirst).toBeGreaterThan(5);
    // Si el pase del colocador sale fuera de zona, coloca el que llegue; el líbero, en la mayoría.
    expect(liberoSets / setterFirst).toBeGreaterThan(0.5);
  }, 60_000);
});

describe('colocación en abanico', () => {
  /** Juega hasta una colocación con rápida y semi al central; apunta a él y presiona `lead` s antes del contacto. */
  function setToMiddle(lead: number): string | null {
    for (let seed = 1; seed <= 20; seed++) {
      const sim = new Simulation({ seed, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], control: 'A' });
      let label: string | null = null;
      let target = false;
      sim.bus.on((e) => { if (e.type === 'decisionResolved' && e.kind === 'set' && target) label = e.label ?? null; });
      while (sim.phase !== 'matchOver' && label === null) {
        const d = sim.decision;
        if (d?.kind === 'set' && d.aim && d.pressedAt === null) {
          const quick = d.options.findIndex((o) => o.option.id === 'set' && o.option.choice.option === 'quick');
          const semi = d.options.findIndex((o) => o.option.id === 'set' && o.option.choice.option === 'semi');
          if (quick >= 0 && semi >= 0) {
            target = true;
            const at = sim.setOptionPoint(d, quick);
            sim.setAim(at.x, at.z);
            if (d.contactTime! - sim.time <= lead) sim.press();
          } else if (d.contactTime! - sim.time <= 0.03) sim.press();
        } else if (d && d.chosen === null) sim.choose(0);
        else if (d && d.kind === 'serve' && sim.time - d.startTime > 0.8) sim.press();
        else if (d && d.contactTime !== null && d.contactTime - sim.time <= 0.03) sim.press();
        sim.step(TUNING.dt);
      }
      if (label) return label;
    }
    return null;
  }

  it('la mira elige al atacante y la barra el tempo: tarde (rojo) rápida, temprano (verde) semi', () => {
    expect(setToMiddle(0.03)).toBe('Rápida al central');
    expect(setToMiddle(0.38)).toBe('Semi-rápida al centro');
  }, 60_000);
});

describe('cada colocación termina en remate', () => {
  it('pipe, zaguero, tensa y rápida llegan al remate (no se vuelven balón libre)', () => {
    const res: Record<string, { sets: number; attacks: number }> = {};
    for (let seed = 1; seed <= 20; seed++) {
      runMatch(opts(seed), (sim) => {
        const s = sim as unknown as { doSet: (...a: unknown[]) => void; intent: { option: string } | null };
        let opt: string | null = null;
        const orig = s.doSet.bind(sim);
        s.doSet = (...a: unknown[]) => {
          orig(...a);
          opt = s.intent?.option ?? null;
          if (opt) (res[opt] ??= { sets: 0, attacks: 0 }).sets += 1;
        };
        sim.bus.on((e) => {
          if (e.type !== 'contact' || e.kind === 'set' || !opt) return;
          if (e.kind === 'attack') res[opt].attacks += 1;
          opt = null;
        });
      });
    }
    for (const [option, r] of Object.entries(res)) {
      if (r.sets < 5) continue;
      expect(r.attacks / r.sets, option).toBeGreaterThan(0.95);
    }
    expect(res.pipe?.sets ?? 0).toBeGreaterThan(5);
  }, 120_000);
});
