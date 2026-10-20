import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { availableSetOptions, SERVE_TYPES } from '../../src/sim/actions';
import { chooseServe, chooseSet } from '../../src/sim/ai';
import type { PlayerState } from '../../src/sim/players';
import { createRng } from '../../src/sim/rng';
import { v3 } from '../../src/sim/vec';

const team = TEAMS[0];
const players = new Map<string, PlayerState>(
  team.roster.map((p) => [`A:${p.id}`, { key: `A:${p.id}`, def: p, team: 'A', pos: v3(), target: v3(), stamina: 1 }]),
);
const court = team.lineup.map((id) => `A:${id}`); // [S, OH, MB, OP, OH, MB]
const options = (setter: string, pass: number, specialist: boolean) =>
  availableSetOptions(court, setter, pass, specialist, players).map((c) => `${c.option}@${court.indexOf(c.attackerKey)}`).sort();

describe('availableSetOptions', () => {
  it('pase bueno con colocador en zaga: todas las opciones', () => {
    expect(options(court[0], 0.8, true)).toEqual(['pipe@4', 'quick@2', 'semi@2', 'zone2@3', 'zone4@1', 'zone4fast@1']);
  });

  it('pase malo: solo pelotas altas a los extremos', () => {
    expect(options(court[0], 0.3, true)).toEqual(['zone2@3', 'zone4@1']);
  });

  it('si coloca otro jugador no hay combinaciones', () => {
    expect(options(court[1], 0.9, false)).toEqual(['zone2@3']);
  });
});

describe('ai', () => {
  it('chooseServe devuelve tipo y zona válidos', () => {
    const rng = createRng(1);
    for (let i = 0; i < 100; i++) {
      const s = chooseServe(rng, team.roster[0]);
      expect(SERVE_TYPES).toContain(s.type);
      expect(s.zone).toBeGreaterThanOrEqual(1);
      expect(s.zone).toBeLessThanOrEqual(6);
    }
  });

  it('chooseSet elige una de las opciones', () => {
    const rng = createRng(2);
    const choices = availableSetOptions(court, court[0], 0.8, true, players);
    for (let i = 0; i < 50; i++) expect(choices).toContain(chooseSet(rng, choices));
  });
});
