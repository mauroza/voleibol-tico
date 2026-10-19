import { describe, expect, it } from 'vitest';
import { broadcastFocusX, shakeOffset } from '../../src/render/camera';
import { ReplayBuffer, ReplayPolicy } from '../../src/render/replay';
import type { PointReason } from '../../src/sim/events';
import { Narrator } from '../../src/ui/narrator';

describe('ReplayBuffer', () => {
  it('guarda solo los últimos N cuadros, en orden', () => {
    const b = new ReplayBuffer(3, 2);
    for (let i = 1; i <= 5; i++) b.push(i * 0.1, Float32Array.from([i, i * 10]));
    const frames = b.frames();
    expect(frames.map((f) => f.time)).toEqual([0.3, 0.4, 0.5].map((t) => expect.closeTo(t)));
    expect(Array.from(frames[0].data)).toEqual([3, 30]);
  });

  it('frameAt devuelve el cuadro más cercano anterior o igual', () => {
    const b = new ReplayBuffer(10, 1);
    for (let i = 0; i < 5; i++) b.push(i, Float32Array.from([i]));
    expect(b.frameAt(2.6)!.data[0]).toBe(2);
    expect(b.frameAt(-1)!.data[0]).toBe(0);
  });
});

describe('ReplayPolicy', () => {
  const point = (p: ReplayPolicy, reason: PointReason, attackQuality = 0.5, userPerfect = false) =>
    p.shouldReplay({ reason, attackQuality, userPerfect, userWon: userPerfect });

  it('repite aces, tapas y remates fuertes; no errores', () => {
    expect(point(new ReplayPolicy(0), 'ace')).toBe(true);
    expect(point(new ReplayPolicy(0), 'blockKill')).toBe(true);
    expect(point(new ReplayPolicy(0), 'kill', 0.8)).toBe(true);
    expect(point(new ReplayPolicy(0), 'kill', 0.5)).toBe(false);
    expect(point(new ReplayPolicy(0), 'serviceError')).toBe(false);
  });

  it('repite el punto perfecto del usuario', () => {
    expect(point(new ReplayPolicy(0), 'kill', 0.4, true)).toBe(true);
  });

  it('respeta la separación mínima entre repeticiones', () => {
    const p = new ReplayPolicy(3);
    expect(point(p, 'ace')).toBe(true);
    expect(point(p, 'ace')).toBe(false);
    expect(point(p, 'ace')).toBe(false);
    expect(point(p, 'ace')).toBe(false);
    expect(point(p, 'ace')).toBe(true);
  });
});

describe('Narrator', () => {
  it('tiene frases para cada motivo y no repite seguidas', () => {
    const n = new Narrator();
    const reasons: PointReason[] = ['ace', 'kill', 'blockKill', 'blockOut', 'landed', 'serviceError', 'attackError', 'error'];
    for (const r of reasons) {
      const a = n.phrase(r);
      const b = n.phrase(r);
      expect(a.length).toBeGreaterThan(0);
      expect(b).not.toBe(a);
    }
  });
});

describe('camera', () => {
  it('el encuadre de transmisión sigue la pelota con límite', () => {
    expect(broadcastFocusX(0)).toBe(0);
    expect(Math.abs(broadcastFocusX(20))).toBeLessThanOrEqual(4);
    expect(broadcastFocusX(-6)).toBeLessThan(0);
  });

  it('la sacudida se apaga con el tiempo', () => {
    expect(Math.abs(shakeOffset(0.5, 0, 0.3, 1))).toBe(0);
    expect(Math.abs(shakeOffset(0.05, 0, 0.3, 1))).toBeGreaterThanOrEqual(0);
  });
});
