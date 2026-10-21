import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { Lockstep, delayForPing, leadForDelay } from '../../src/net/lockstep';
import type { NetMessage, Transport } from '../../src/net/transport';
import type { TeamId } from '../../src/sim/court';
import { Simulation } from '../../src/sim/rally';

/** Dos transportes unidos por una "red" con retraso fijo (en segundos reales simulados). */
function pair(latency: number, jitter = 0): { a: Transport; b: Transport; tick: (now: number) => void } {
  const inbox: { at: number; to: 'a' | 'b'; msg: NetMessage }[] = [];
  // Tirones de internet: cada mensaje tarda un poco más al azar (en orden, como un websocket).
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const last = { a: 0, b: 0 };
  const handlers: Record<'a' | 'b', ((m: NetMessage) => void)[]> = { a: [], b: [] };
  let now = 0;
  const make = (me: 'a' | 'b', other: 'a' | 'b'): Transport => ({
    id: me,
    kind: 'local',
    // Copia profunda: como en la red de verdad, el que recibe no comparte objetos con el que manda.
    send: (msg) => {
      const at = Math.max(last[other], now + latency + rand() * jitter);
      last[other] = at;
      inbox.push({ at, to: other, msg: JSON.parse(JSON.stringify({ ...msg, from: me })) });
    },
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
  new Simulation({ seed: 77, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[3], control, humans: ['A', 'B'], tempo: 'online', inputLead: leadForDelay(delay), warmup: 15 });

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

  it('previa online: se salta solo cuando votan los dos; lado y alineación llegan iguales a las dos computadoras', () => {
    const net = pair(0.1);
    const delay = delayForPing(0.2);
    const opts = (control: TeamId) => new Simulation({ seed: 31, setsToWin: 2, teamA: TEAMS[0], teamB: TEAMS[3], control, humans: ['A', 'B'], tempo: 'online', inputLead: leadForDelay(delay), warmup: 20, pregame: true });
    const host = opts('A');
    const guest = opts('B');
    const ls = { A: new Lockstep(host, net.a, 'A', delay), B: new Lockstep(guest, net.b, 'B', delay) };
    const sims = { A: host, B: guest };
    const steps: string[] = [];
    host.bus.on((e) => { if (e.type === 'ceremony') steps.push(e.step); });
    const frame = 1 / 60;
    let t = 0;
    while ((host.phase !== 'matchOver' || guest.phase !== 'matchOver') && t < 4 * 3600) {
      t += frame;
      net.tick(t);
      for (const team of ['A', 'B'] as const) {
        const sim = sims[team];
        // El anfitrión quiere saltar enseguida; el invitado recién a los 5 s de cada etapa.
        if (sim.skipKey(team) && (team === 'A' || t % 30 > 5)) sim.skip(team, false);
        if (sim.sideKey(team)) sim.chooseSide(team, team === 'B');
        if (sim.lineupKey(team)) {
          const l = [...sim.match.lineups[team]];
          [l[0], l[1]] = [l[1], l[0]];
          sim.submitLineup(team, l);
        }
        bot(sim, team, t);
        ls[team].advance(frame, 1);
      }
    }
    expect(host.phase).toBe('matchOver');
    expect(guest.match.points).toEqual(host.match.points);
    expect(guest.match.sets).toEqual(host.match.sets);
    expect(guest.time).toBeCloseTo(host.time, 6);
    expect(ls.A.desync || ls.B.desync).toBe(false);
    expect(steps).toContain('spike2');
    expect(steps).toContain('serve');
    expect(steps).toContain('lineup');
  }, 120_000);

  it('online: tiempo, cambios y pausa llegan iguales a las dos computadoras', () => {
    const net = pair(0.1);
    const delay = delayForPing(0.2);
    const host = make('A', delay);
    const guest = make('B', delay);
    host.skipWarmup();
    guest.skipWarmup();
    const ls = { A: new Lockstep(host, net.a, 'A', delay), B: new Lockstep(guest, net.b, 'B', delay) };
    const frame = 1 / 60;
    let t = 0;
    let timeoutAt = -1;
    let subbed = false;
    let paused = 0;
    let pauseFrames = 0;
    while ((host.phase !== 'matchOver' || guest.phase !== 'matchOver') && t < 4 * 3600) {
      t += frame;
      net.tick(t);
      const pts = host.match.points.A + host.match.points.B;
      // A pide tiempo en el punto 3, cambia a uno y vuelve antes; B pausa en el punto 6 y A la levanta.
      if (pts === 3 && timeoutAt < 0 && host.timeoutKey('A')) {
        host.callTimeout('A');
        timeoutAt = t;
      }
      if (timeoutAt > 0 && !subbed && host.timeoutInfo) {
        const out = host.match.lineups.A[2];
        const inn = host.bench('A').find((k) => host.player(k).def.role === host.player(out).def.role) ?? host.bench('A')[0];
        subbed = host.substitute('A', out, inn);
      }
      if (subbed && host.timeoutInfo && host.subsLeft.A < 6) host.endTimeout('A');
      if (pts === 6 && paused === 0 && guest.pauseKey('B')) {
        guest.pauseGame('B');
        paused = 1;
      }
      if (host.pausedBy) {
        pauseFrames += 1;
        if (pauseFrames > 120) host.resumeGame('A');
      }
      bot(host, 'A', t);
      bot(guest, 'B', t);
      ls.A.advance(frame, 1);
      ls.B.advance(frame, 1);
    }
    expect(subbed).toBe(true);
    expect(pauseFrames).toBeGreaterThan(100);
    expect(host.phase).toBe('matchOver');
    expect(guest.match.points).toEqual(host.match.points);
    expect(guest.time).toBeCloseTo(host.time, 6);
    expect(guest.match.lineups.A).toEqual(host.match.lineups.A);
    expect(ls.A.desync || ls.B.desync).toBe(false);
  }, 120_000);

  it('con tirones de internet, la previa y las pelotas muertas casi no esperan al rival', () => {
    const net = pair(0.09, 0.05);
    const delay = delayForPing(0.18);
    const opts = (control: TeamId) => new Simulation({ seed: 12, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[3], control, humans: ['A', 'B'], tempo: 'online', inputLead: leadForDelay(delay), warmup: 20, pregame: true });
    const host = opts('A');
    const guest = opts('B');
    const ls = { A: new Lockstep(host, net.a, 'A', delay), B: new Lockstep(guest, net.b, 'B', delay) };
    const sims = { A: host, B: guest };
    const frame = 1 / 60;
    let t = 0;
    let stalls = 0;
    let pregameStalls = 0;
    let pregameFrames = 0;
    const run = { A: 0, B: 0 };
    let visible = 0;
    while ((host.phase !== 'matchOver' || guest.phase !== 'matchOver') && t < 4 * 3600) {
      t += frame;
      net.tick(t);
      const pre = host.phase === 'warmup' || host.phase === 'ceremony';
      if (pre) pregameFrames += 1;
      for (const team of ['A', 'B'] as const) {
        const sim = sims[team];
        if (sim.sideKey(team)) sim.chooseSide(team, true);
        if (sim.lineupKey(team)) sim.submitLineup(team, [...sim.match.lineups[team]]);
        bot(sim, team, t);
        if (ls[team].advance(frame, 1)) {
          stalls += 1;
          if (pre) pregameStalls += 1;
          run[team] += frame;
          // Lo que ve la persona: el aviso de esperar sale después de 0.4 s seguidos.
          if (Math.abs(run[team] - 0.4) < frame / 2) visible += 1;
        } else run[team] = 0;
      }
    }
    expect(host.phase).toBe('matchOver');
    expect(guest.match.points).toEqual(host.match.points);
    expect(ls.A.desync || ls.B.desync).toBe(false);
    console.log(`con tirones: esperas ${(100 * stalls / (2 * t / frame)).toFixed(1)}% · en la previa ${(100 * pregameStalls / (2 * pregameFrames)).toFixed(1)}% · avisos visibles ${visible} en ${(t / 60).toFixed(1)} min`);
    // Esperas cortas (invisibles) sí; el aviso de "esperando al rival" no debería salir.
    expect(pregameStalls / (2 * pregameFrames)).toBeLessThan(0.1);
    expect(visible).toBe(0);
  }, 180_000);
});
