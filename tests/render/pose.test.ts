import { describe, expect, it } from 'vitest';
import { blendPose, hipHeight, jumpOffset, twoBoneIK } from '../../src/render/pose';

describe('twoBoneIK', () => {
  it('el extremo llega a la distancia pedida', () => {
    const l1 = 0.3;
    const l2 = 0.28;
    for (const d of [0.2, 0.4, 0.55]) {
      const { root, bend } = twoBoneIK(l1, l2, d);
      // Plano: hueso 1 a +root sobre la línea, hueso 2 girado -bend respecto del primero.
      const x = l1 * Math.cos(root) + l2 * Math.cos(root - bend);
      const y = l1 * Math.sin(root) + l2 * Math.sin(root - bend);
      expect(x).toBeCloseTo(d, 5);
      expect(y).toBeCloseTo(0, 5);
    }
  });

  it('fuera de alcance: brazo estirado hacia el objetivo', () => {
    const { root, bend } = twoBoneIK(0.3, 0.28, 2);
    expect(root).toBeCloseTo(0, 2);
    expect(bend).toBeCloseTo(0, 2);
  });
});

describe('jumpOffset', () => {
  it('ápice en el contacto, cero fuera del tiempo de vuelo', () => {
    expect(jumpOffset(10, 10, 0.8, 0.7)).toBeCloseTo(0.7);
    expect(jumpOffset(9.8, 10, 0.8, 0.7)).toBeCloseTo(0.7 * 0.75);
    expect(jumpOffset(9.5, 10, 0.8, 0.7)).toBe(0);
    expect(jumpOffset(10.5, 10, 0.8, 0.7)).toBe(0);
  });
});

describe('blendPose', () => {
  it('interpola y trata las articulaciones faltantes como cero', () => {
    const p = blendPose({ spine: [1, 0, 0] }, { neck: [0, 2, 0] }, 0.5);
    expect(p.spine).toEqual([0.5, 0, 0]);
    expect(p.neck).toEqual([0, 1, 0]);
  });
});

describe('hipHeight', () => {
  it('pierna recta = largo total; agachado = menos', () => {
    expect(hipHeight(0.46, 0.46, 0, 0)).toBeCloseTo(0.92);
    expect(hipHeight(0.46, 0.46, -0.6, 0.9)).toBeLessThan(0.9);
  });
});
