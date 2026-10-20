import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { Lockstep, delayForPing, leadForDelay } from '../../src/net/lockstep';
import type { NetMessage, Transport } from '../../src/net/transport';
import type { TeamId } from '../../src/sim/court';
import { Simulation } from '../../src/sim/rally';

/** Dos transportes unidos por una "red" con retraso fijo (en segundos reales simulados). */
function pair(latency: number): { a: Transport; b: Transport; tick: (now: number) => void } {
  const inbox: { at: number; to: 'a' | 'b'; msg: NetMessage }[] = [];
  const handlers: Record<'a' | 'b', ((m: NetMessage) => void)[]> = { a: [], b: [] };
  let now = 0;
  const make = (me: 'a' | 'b', other: 'a' | 'b'): Transport => ({
    id: me,
    kind: 'local',
    // Copia profunda: como en la red de verdad, el que recibe no comparte objetos con el que manda.
    send: (msg) => inbox.push({ at: now + latency, to: other, msg: JSON.parse(JSON.stringify({ ...msg, from: me })) }),
    onMessage: (cb) => handlers[me].push(cb),
    onSelf: () => {},
    close: () => {},
  });
  return {
    a: make('a', 'b'),
    b: make('b', 'a'),
    tick: (t) => {
      now = t;
      for (let i = 0; i < inbox.length; ) {
        if (inbox[i].at <= now) {
          const { to, msg } = inbox.splice(i, 1)[0];
          for (const h of handlers[to]) h(msg);
        } else i++;
      }
    },
  };
}

const make = (control: TeamId, delay: number) =>
  new Simulation({ seed: 77, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[3], control, humans: ['A', 'B'], tempo: 'online', inputLead: leadForDelay(delay) });

/** Bot simple: apunta y presiona en el último tramo de cada barra; saca enseguida. */
function bot(sim: Simulation, team: TeamId, t: number): void {
  const d = sim.decisions[team];
  if (!d || d.pressedAt !== null) return;
  if (d.kind === 'serve') {
    if (sim.time - d.startTime > 0.7) sim.press(sim.time);
  } else if (d.contactTime !== null) {
    if (d.aim && Math.floor(t * 10) % 7 === 0) sim.setAim(d.aim.x + 0.3, d.aim.z);
    if (d.contactTime - (d.lead ?? 0) - sim.time <= 0.05) sim.press(sim.time);
  }
}

describe('online lockstep', () => {
  it.each([0.08, 0.15])('con %s s de retraso, las dos computadoras juegan exactamente el mismo partido', (latency) => {
    const net = pair(latency);
    const delay = delayForPing(latency * 2);
    const host = make('A', delay);
    const guest = make('B', delay);
    const ls = { A: new Lockstep(host, net.a, 'A', delay), B: new Lockstep(guest, net.b, 'B', delay) };
    const sims = { A: host, B: guest };
    const frame = 1 / 60;
    let t = 0;
    let stalls = 0;
    while ((host.phase !== 'matchOver' || guest.phase !== 'matchOver') && t < 4 * 3600) {
      t += frame;
      net.tick(t);
      for (const team of ['A', 'B'] as const) {
        bot(sims[team], team, t);
        if (ls[team].advance(frame, 1)) stalls += 1;
      }
    }
    expect(host.phase).toBe('matchOver');
    expect(guest.phase).toBe('matchOver');
    expect(guest.match.points).toEqual(host.match.points);
    expect(guest.match.sets).toEqual(host.match.sets);
    expect(guest.time).toBeCloseTo(host.time, 6);
    expect(ls.A.desync || ls.B.desync).toBe(false);
    // Esperas al rival: pocas (solo alrededor de las decisiones).
    expect(stalls / (t / frame)).toBeLessThan(0.15);
    console.log(`retraso ${latency}: esperas ${(100 * stalls / (t / frame)).toFixed(1)}% de los cuadros`);
  }, 120_000);

  it('una tecla que llega tarde no se pasa a la jugada siguiente (colocación y remate quedan sin tocar)', () => {
    const net = pair(0.1);
    const delay = delayForPing(0.2);
    const host = make('A', delay);
    const guest = make('B', delay);
    const ls = { A: new Lockstep(host, net.a, 'A', delay), B: new Lockstep(guest, net.b, 'B', delay) };
    const resolved: { kind: string; timing: string }[] = [];
    host.bus.on((e) => { if (e.type === 'decisionResolved' && e.team === 'A') resolved.push({ kind: e.kind, timing: e.timing }); });
    let late = 0;
    const frame = 1 / 60;
    let t = 0;
    while (host.match.points.A + host.match.points.B < 12 && t < 1800) {
      t += frame;
      net.tick(t);
      // Anfitrión: saca normal; en recepción presiona justo en el contacto (tarde para la red); nada más.
      const d = host.decisions.A;
      if (d && d.pressedAt === null) {
        if (d.kind === 'serve' && host.time - d.startTime > 0.7) host.press(host.time);
        if (d.kind === 'pass' && d.contactTime !== null && d.contactTime - host.time <= 0.01) {
          host.press(host.time);
          late += 1;
        }
      }
      bot(guest, 'B', t);
      ls.A.advance(frame, 1);
      ls.B.advance(frame, 1);
    }
    expect(late).toBeGreaterThan(3);
    const after = resolved.filter((r) => r.kind === 'set' || r.kind === 'attack');
    expect(after.length).toBeGreaterThan(3);
    for (const r of after) expect(r.timing).toBe('bad');
    expect(ls.A.desync || ls.B.desync).toBe(false);
  }, 120_000);
});
