import { describe, expect, it } from 'vitest';
import { checkNet, landingTime, launch, positionAt, timeAtHeightDescending } from '../../src/sim/ball';
import { v3 } from '../../src/sim/vec';

describe('launch', () => {
  it('llega al objetivo exactamente en el tiempo de vuelo', () => {
    const tr = launch(v3(-8, 1, 0), v3(5, 0.105, 2), 1.2, 10);
    const p = positionAt(tr, 11.2);
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(0.105);
    expect(p.z).toBeCloseTo(2);
  });
});

describe('timeAtHeightDescending', () => {
  it('devuelve la raíz descendente', () => {
    const tr = launch(v3(0, 1, 0), v3(0, 1, 0), 2, 0);
    expect(timeAtHeightDescending(tr, 1)).toBeCloseTo(2);
  });

  it('devuelve null si nunca alcanza la altura', () => {
    const tr = launch(v3(0, 1, 0), v3(1, 1, 0), 0.5, 0);
    expect(timeAtHeightDescending(tr, 10)).toBeNull();
  });

  it('landingTime coincide con la llegada al piso', () => {
    const tr = launch(v3(-3, 2, 0), v3(4, 0.105, 0), 1.1, 5);
    expect(landingTime(tr)).toBeCloseTo(6.1);
  });
});

describe('checkNet', () => {
  it('clear si pasa alto', () => {
    expect(checkNet(launch(v3(-5, 2.5, 0), v3(5, 0.105, 0), 1.5, 0)).kind).toBe('clear');
  });

  it('fault por red si pasa bajo', () => {
    expect(checkNet(launch(v3(-1, 3, 0), v3(0.8, 0.105, 0), 0.1, 0))).toMatchObject({ kind: 'fault', reason: 'net' });
  });

  it('fault por antena si cruza por fuera', () => {
    expect(checkNet(launch(v3(-5, 3, 6), v3(5, 0.105, 6), 1.5, 0))).toMatchObject({ kind: 'fault', reason: 'antenna' });
  });

  it('none si no cruza antes de caer', () => {
    expect(checkNet(launch(v3(-5, 1, 0), v3(-2, 2.3, 0), 1.3, 0)).kind).toBe('none');
  });
});
