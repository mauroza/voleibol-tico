import { describe, expect, it } from 'vitest';
import { isInCourt, otherTeam, sideOfX, toWorld } from '../../src/sim/court';
import { v3 } from '../../src/sim/vec';

describe('court', () => {
  it('toWorld ubica la zona 4 (izquierda delantera) de cada equipo', () => {
    expect(toWorld('A', 1.5, -3)).toEqual({ x: -1.5, y: 0, z: -3 });
    expect(toWorld('B', 1.5, -3)).toEqual({ x: 1.5, y: 0, z: 3 });
  });

  it('sideOfX y otherTeam', () => {
    expect(sideOfX(-0.1)).toBe('A');
    expect(sideOfX(0.1)).toBe('B');
    expect(otherTeam('A')).toBe('B');
  });

  it('la línea cuenta como dentro', () => {
    expect(isInCourt(v3(9, 0, 4.5))).toBe(true);
    expect(isInCourt(v3(9.5, 0, 0))).toBe(false);
    expect(isInCourt(v3(0, 0, -4.8))).toBe(false);
  });
});
