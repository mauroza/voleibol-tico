import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/sim/events';
import { attachMetrics, emptyMetrics, summarize } from '../../src/sim/metrics';

describe('metrics', () => {
  it('cuenta kills, errores de saque y toques por rally', () => {
    const bus = new EventBus();
    const m = emptyMetrics();
    attachMetrics(bus, m);
    const sets = { A: 0, B: 0 };
    const contact = (team: 'A' | 'B', kind: 'serve' | 'reception' | 'set' | 'attack' | 'block') =>
      bus.emit({ type: 'contact', time: 0, playerKey: `${team}:x`, team, kind, quality: 0.5 });
    // Rally 1: saque A, B recibe, coloca, ataca, A bloquea (toque), punto B → kill
    contact('A', 'serve'); contact('B', 'reception'); contact('B', 'set'); contact('B', 'attack'); contact('A', 'block');
    bus.emit({ type: 'point', winner: 'B', reason: 'landed', points: { A: 0, B: 1 }, sets });
    // Rally 2: error de saque de B
    contact('B', 'serve');
    bus.emit({ type: 'point', winner: 'A', reason: 'serviceError', points: { A: 1, B: 1 }, sets });
    bus.emit({ type: 'matchEnd', winner: 'A' });
    const s = summarize(m);
    expect(s.touchesPerRally).toBe(3);
    expect(s.killRate).toBe(1);
    expect(s.serveErrorRate).toBe(0.5);
    expect(s.winRateA).toBe(1);
  });
});
