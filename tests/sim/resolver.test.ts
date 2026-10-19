import { describe, expect, it } from 'vitest';
import { computeQuality, errorChance, type QualityInput } from '../../src/sim/resolver';
import type { Rng } from '../../src/sim/rng';

/** RNG sin ruido: range devuelve el punto medio. */
const still: Rng = {
  next: () => 0.5,
  range: (a, b) => (a + b) / 2,
  chance: () => false,
  pick: (items) => items[0],
  weighted: (items) => items[0].item,
};
const base: QualityInput = { base: 1, prevQuality: 1, timing: 'perfect', attribute: 100, pressure: 0 };

describe('computeQuality', () => {
  it('máxima calidad con todo a favor', () => {
    expect(computeQuality(base, still)).toBeCloseTo(1);
  });

  it('perfecto > bueno > malo', () => {
    const p = computeQuality(base, still);
    const g = computeQuality({ ...base, timing: 'good' }, still);
    const b = computeQuality({ ...base, timing: 'bad' }, still);
    expect(p).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('peor toque previo, menor atributo y más presión bajan la calidad', () => {
    const ref = computeQuality({ ...base, timing: 'good' }, still);
    expect(computeQuality({ ...base, timing: 'good', prevQuality: 0.2 }, still)).toBeLessThan(ref);
    expect(computeQuality({ ...base, timing: 'good', attribute: 30 }, still)).toBeLessThan(ref);
    expect(computeQuality({ ...base, timing: 'good', pressure: 0.8 }, still)).toBeLessThan(ref);
  });

  it('se limita a [0, 1]', () => {
    expect(computeQuality({ ...base, base: 3 }, still)).toBe(1);
    expect(computeQuality({ ...base, base: -1 }, still)).toBe(0);
  });
});

describe('errorChance', () => {
  it('es 0 con calidad perfecta y crece al bajar la calidad', () => {
    expect(errorChance(0.2, 1)).toBe(0);
    expect(errorChance(0.2, 0.3)).toBeGreaterThan(errorChance(0.2, 0.7));
  });
});
