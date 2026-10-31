import { describe, expect, it } from 'vitest';
import { BYE, createTournament, finishWithoutUser, nextOpponent, recordResult } from '../../src/data/tournament';

const overall = (i: number) => 70 + i;
const opts = { difficulty: 'normal' as const, setsToWin: 1 as const, seed: 42 };

describe('torneo de eliminación directa', () => {
  it('llave de 8 con el usuario y un BYE cuando hay 7 equipos', () => {
    const t = createTournament(-1, [0, 1, 2, 3, 4, 5], overall, opts);
    expect(t.rounds[0]).toHaveLength(8);
    expect(t.rounds[0].filter((x) => x === -1)).toHaveLength(1);
    expect(t.rounds[0].filter((x) => x === BYE)).toHaveLength(1);
    // El BYE le toca al mejor sembrado (el 5), no al usuario.
    const bye = t.rounds[0].indexOf(BYE);
    expect(t.rounds[0][bye ^ 1]).toBe(5);
    expect(nextOpponent(t)).not.toBe(BYE);
  });

  it('ganando tres partidos sale campeón', () => {
    let t = createTournament(-1, [0, 1, 2, 3, 4, 5], overall, opts);
    const played: number[] = [];
    for (let r = 0; r < 3; r++) {
      const opp = nextOpponent(t);
      expect(opp).not.toBeNull();
      played.push(opp!);
      t = recordResult(t, true, overall);
    }
    expect(t.champion).toBe(-1);
    expect(nextOpponent(t)).toBeNull();
    expect(new Set(played).size).toBe(3);
  });

  it('perdiendo queda eliminado y el torneo se termina sin él', () => {
    let t = createTournament(2, [-1, 0, 1, 3, 4, 5], overall, opts);
    t = recordResult(t, true, overall);
    t = recordResult(t, false, overall);
    expect(t.out).toBe(true);
    expect(nextOpponent(t)).toBeNull();
    const done = finishWithoutUser(t, overall);
    expect(done.champion).not.toBeNull();
    expect(done.champion).not.toBe(2);
    expect(done.rounds.at(-1)).toHaveLength(1);
  });
});
