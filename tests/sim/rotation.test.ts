import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { runMatch } from '../../src/sim/headless';
import { courtPlayers, isFrontIndex } from '../../src/sim/match';
import type { Role } from '../../src/sim/players';

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
    for (let seed = 1; seed <= 8; seed++) {
      runMatch(opts(seed), (sim) => {
        let first: Role | null = null;
        sim.bus.on((e) => {
          if (e.type !== 'contact') return;
          const role = sim.player(e.playerKey).def.role;
          if (e.kind === 'reception') receivers.push(role);
          if (e.kind === 'reception' || e.kind === 'dig') first = role;
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
    expect(liberoSets / setterFirst).toBeGreaterThan(0.6);
  }, 60_000);
});
