import { describe, expect, it } from 'vitest';
import { judgeServe, judgeTiming, serveMeter } from '../../src/sim/decision';

describe('judgeTiming', () => {
  it('perfecto justo antes del contacto', () => {
    expect(judgeTiming(9.97, 10)).toBe('perfect');
    expect(judgeTiming(10, 10)).toBe('perfect');
  });

  it('bueno un poco antes', () => {
    expect(judgeTiming(9.9, 10)).toBe('good');
  });

  it('malo muy temprano, sin presionar o después del contacto', () => {
    expect(judgeTiming(9.5, 10)).toBe('bad');
    expect(judgeTiming(null, 10)).toBe('bad');
    expect(judgeTiming(10.05, 10)).toBe('bad');
  });
});

describe('serveMeter', () => {
  it('oscila 0 → 1 → 0', () => {
    expect(serveMeter(0)).toBeCloseTo(0);
    expect(serveMeter(0.8)).toBeCloseTo(1);
    expect(serveMeter(1.6)).toBeCloseTo(0);
  });

  it('perfecto arriba, bueno cerca, malo abajo', () => {
    expect(judgeServe(0.95)).toBe('perfect');
    expect(judgeServe(0.75)).toBe('good');
    expect(judgeServe(0.3)).toBe('bad');
  });
});
