import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { landingTime, positionAt, timeAtHeightDescending } from '../../src/sim/ball';
import { isInCourt, sideOfX } from '../../src/sim/court';
import { meterWindow, serveMeter, type DecisionKind } from '../../src/sim/decision';
import { Simulation } from '../../src/sim/rally';
import type { Timing } from '../../src/sim/resolver';
import { TUNING } from '../../src/sim/tuning';

type Bot = 'idle' | 'perfect';

/** Partido con el usuario controlando al equipo A. El bot perfecto elige la primera opción y presiona justo a tiempo. */
function play(seed: number, bot: Bot, onCreate?: (sim: Simulation) => void, teamB = TEAMS[1]): Simulation {
  const sim = new Simulation({ seed, setsToWin: 1, teamA: TEAMS[0], teamB, control: 'A' });
  onCreate?.(sim);
  while (sim.phase !== 'matchOver') {
    const d = sim.decision;
    if (bot === 'perfect' && d) {
      // Bloqueo doble (el triple deja la cancha vacía); en lo demás, la primera opción.
      if (d.chosen === null) sim.choose(d.kind === 'block' && d.options.length > 1 ? 1 : 0);
      if (d.kind === 'serve') {
        if (serveMeter(sim.time - d.startTime) >= 0.9) sim.press();
      } else if (d.kind === 'set' && d.contactTime !== null) {
        // Colocación segura: tempo alto (barra en verde).
        if (d.contactTime - sim.time <= TUNING.decision.setWindow * 0.8) sim.press();
      } else if (d.kind === 'attack' && d.contactTime !== null) {
        // Remate fuerte pero controlado: barra en amarillo.
        if (d.contactTime - sim.time <= TUNING.decision.slowWindow * 0.35) sim.press();
      } else if (d.contactTime !== null && d.contactTime - sim.time <= 0.03) {
        sim.press();
      }
    }
    sim.step(TUNING.dt);
    if (sim.time > 6 * 3600) throw new Error('Partido trabado');
  }
  return sim;
}

describe('control del equipo completo', () => {
  it('inactivo: el partido termina y toda decisión se resuelve como mala', () => {
    const timings: Timing[] = [];
    // El bloqueo sugerido sin saltar con ESPACIO sale normal ('good'); todo lo demás sin tocar es malo.
    play(1, 'idle', (sim) => sim.bus.on((e) => { if (e.type === 'decisionResolved' && e.kind !== 'block') timings.push(e.timing); }));
    expect(timings.length).toBeGreaterThan(20);
    expect(new Set(timings)).toEqual(new Set(['bad']));
  });

  it('el usuario decide saque, pase, colocación, ataque y bloqueo, siempre con jugadores de su equipo', () => {
    const kinds = new Set<DecisionKind>();
    play(2, 'idle', (sim) => sim.bus.on((e) => {
      if (e.type !== 'decision') return;
      kinds.add(e.decision.kind);
      expect(sim.player(e.decision.playerKey).team).toBe('A');
    }));
    expect(kinds).toEqual(new Set(['serve', 'pass', 'set', 'attack', 'block']));
  });

  it('el colocador ofrece rápida y semi-rápida al central cuando el pase es bueno', () => {
    const labels = new Set<string>();
    play(3, 'perfect', (sim) => sim.bus.on((e) => {
      if (e.type === 'decision' && e.decision.kind === 'set') e.decision.options.forEach((o) => labels.add(o.label));
    }));
    expect(labels).toContain('Rápida al central');
    expect(labels).toContain('Semi-rápida al centro');
  });

  it('elegir bloqueo triple pone a tres delanteros a bloquear', () => {
    let checked = 0;
    const sim = new Simulation({ seed: 4, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], control: 'A' });
    let seen: unknown = null;
    while (sim.phase !== 'matchOver' && checked < 5) {
      const d = sim.decision;
      if (d?.kind === 'block' && d !== seen) {
        seen = d;
        const triple = d.options.findIndex((o) => o.label === 'Bloqueo triple');
        if (triple >= 0) {
          sim.choose(triple);
          expect(sim.blockers?.keys).toHaveLength(3);
          checked += 1;
        } else sim.choose(0);
      }
      sim.step(TUNING.dt);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('tiempo casi detenido mientras no elige; acercamiento y cámara lenta después', () => {
    const cfg = TUNING.decision;
    const seen = new Set<number>();
    const sim = new Simulation({ seed: 4, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], control: 'A' });
    for (let i = 0; i < 200000 && sim.phase !== 'matchOver' && seen.size < 5; i++) {
      const d = sim.decision;
      if (!d || d.contactTime === null) {
        expect(sim.timeScale).toBe(1);
      } else if (d.chosen === null) {
        expect(sim.timeScale).toBe(cfg.thinkScale);
        seen.add(cfg.thinkScale);
        if (d.contactTime - sim.time < 0.9) sim.choose(0);
      } else {
        // Con mira (remate, pase) el tiempo corre más lento para apuntar; sin mira, el ritmo normal de la decisión.
        const near = d.contactTime - sim.time <= meterWindow(d);
        const aiming = !!d.aim && d.kind !== 'block';
        const expected = aiming ? (near ? cfg.aimSlowScale : cfg.aimApproachScale) : near ? cfg.slowScale : cfg.approachScale;
        expect(sim.timeScale).toBe(expected);
        seen.add(expected);
      }
      sim.step(TUNING.dt);
    }
    // Todas las decisiones ya vienen con algo elegido (mira o bloqueo sugerido): no hay tiempo detenido.
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it('press(at) juzga el timing con el instante exacto de la tecla, no con el del último cuadro', () => {
    const sim = new Simulation({ seed: 7, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], control: 'A' });
    let timing: Timing | null = null;
    sim.bus.on((e) => { if (e.type === 'decisionResolved' && e.kind === 'pass') timing = e.timing; });
    while (sim.phase !== 'matchOver' && timing === null) {
      const d = sim.decision;
      if (d && d.kind === 'pass' && d.pressedAt === null && d.contactTime! - (d.shift ?? 0) - sim.time > 0.2) {
        // El cuadro va 0.2 s antes del punto ideal, pero la tecla se presionó 0.03 s antes de él.
        sim.press(d.contactTime! - (d.shift ?? 0) - 0.03);
      } else if (d && d.chosen === null) {
        sim.choose(0);
      }
      sim.step(TUNING.dt);
    }
    expect(timing).toBe('perfect');
  });

  it('jugar perfecto gana más puntos que no hacer nada', () => {
    const share = (bot: Bot) => {
      let a = 0;
      let total = 0;
      for (let seed = 1; seed <= 30; seed++) {
        // Rival idéntico: la diferencia sale solo de cómo juega el usuario.
        play(seed, bot, (sim) => sim.bus.on((e) => {
          if (e.type === 'point') { total += 1; if (e.winner === 'A') a += 1; }
        }), TEAMS[0]);
      }
      return a / total;
    };
    expect(share('perfect')).toBeGreaterThan(share('idle') + 0.05);
  }, 180_000);
});

describe('remate apuntado', () => {
  /** Avanza hasta el próximo remate propio; `aim` decide a dónde apuntar. Devuelve dónde cae la pelota tras el golpe. */
  /** `lead`: cuánto antes del contacto se presiona en el remate (tarde = rojo, temprano = verde). */
  function aimedAttack(seed: number, aim: (d: NonNullable<Simulation['decision']>) => { x: number; z: number }, lead = 0.03) {
    const sim = new Simulation({ seed, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], control: 'A' });
    let target: { x: number; z: number } | null = null;
    let justHit = false;
    sim.bus.on((e) => { if (e.type === 'contact' && e.kind === 'attack' && e.team === 'A' && target) justHit = true; });
    while (sim.phase !== 'matchOver') {
      const d = sim.decision;
      if (d?.kind === 'attack' && d.options[0].option.id === 'aim' && !target) {
        expect(d.aim).not.toBeNull();
        expect(d.chosen).toBe(0);
        target = aim(d);
        sim.setAim(target.x, target.z);
      } else if (d && d.kind !== 'attack' && d.chosen === null) sim.choose(0);
      if (d && d.contactTime !== null && d.contactTime - sim.time <= (d.kind === 'attack' ? lead : 0.03)) sim.press();
      if (d?.kind === 'serve' && serveMeter(sim.time - d.startTime) >= 0.9) sim.press();
      sim.step(TUNING.dt);
      if (justHit) {
        const land = positionAt(sim.ball, landingTime(sim.ball));
        const flight = landingTime(sim.ball) - sim.ball.t0;
        return { target: target!, land, flight };
      }
    }
    throw new Error('No hubo remate propio');
  }

  it('la pelota cae cerca del punto apuntado con buen timing', () => {
    let near = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { target, land } = aimedAttack(seed, () => ({ x: 6, z: -2.5 }));
      if (Math.hypot(land.x - target.x, land.z - target.z) < 1.5) near += 1;
    }
    expect(near).toBeGreaterThanOrEqual(4);
  });

  it('cerca de la red: en verde es finta (pelota lenta); en rojo, remate en picada (rápido)', () => {
    const soft = aimedAttack(2, () => ({ x: 1.8, z: 1 }), 0.35);
    expect(soft.flight).toBeGreaterThan(0.6);
    const hard = aimedAttack(2, () => ({ x: 1.8, z: 1 }), 0.02);
    expect(hard.flight).toBeLessThan(0.45);
  });
});

describe('fuerza, saque, pase dirigido y defensa', () => {
  const fresh = (seed: number) => new Simulation({ seed, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1], control: 'A' });
  const horizontalSpeed = (sim: Simulation) => Math.hypot(sim.ball.v0.x, sim.ball.v0.z);

  /** Avanza hasta la decisión pedida respondiendo el resto con la primera opción. */
  function until(sim: Simulation, want: (d: NonNullable<Simulation['decision']>) => boolean) {
    while (sim.phase !== 'matchOver') {
      const d = sim.decision;
      if (d && want(d)) return d;
      if (d && d.chosen === null) sim.choose(0);
      if (d && d.pressedAt === null && (d.kind === 'serve' || (d.contactTime !== null && d.contactTime - sim.time < 0.03))) sim.press();
      sim.step(TUNING.dt);
    }
    throw new Error('No apareció la decisión');
  }

  it('saque apuntado: cada uno con su estilo; rojo más rápido que verde y van hacia la mira', () => {
    const speeds: Record<string, number[]> = { strong: [], soft: [] };
    let near = 0;
    for (let seed = 1; seed <= 6; seed++) {
      for (const zone of ['strong', 'soft'] as const) {
        const sim = fresh(seed);
        const d = until(sim, (x) => x.kind === 'serve');
        expect(d.meter).toBe('power');
        sim.setAim(6, -2);
        // Medidor triangular: arriba (≈1) = rojo; al inicio (≈0.3) = verde.
        while (serveMeter(sim.time - d.startTime) < (zone === 'strong' ? 0.95 : 0.3)) sim.step(TUNING.dt);
        sim.press();
        // El golpe llega al final de la secuencia de saque (lanzamiento y carrera).
        while (sim.phase === 'preServe') sim.step(TUNING.dt);
        speeds[zone].push(horizontalSpeed(sim));
        if (zone === 'strong') {
          const land = positionAt(sim.ball, landingTime(sim.ball));
          if (Math.hypot(land.x - 6, land.z + 2) < 2.5) near += 1;
        }
      }
    }
    const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    expect(avg(speeds.strong)).toBeGreaterThan(avg(speeds.soft) * 1.15);
    expect(near).toBeGreaterThanOrEqual(4);
  });

  it('remate: rojo pega más fuerte que verde', () => {
    const speed = (late: boolean) => {
      const sim = fresh(5);
      const d = until(sim, (x) => x.kind === 'attack' && x.options[0].option.id === 'aim');
      // Rojo: al final de la barra; verde: apenas entra la barra.
      sim.press(late ? d.contactTime! - 0.02 : d.contactTime! - 0.35);
      while (sim.decision === d) sim.step(TUNING.dt);
      return horizontalSpeed(sim);
    };
    expect(speed(true)).toBeGreaterThan(speed(false) * 1.25);
  });

  it('pase dirigido: la pelota va al punto elegido del propio campo', () => {
    let near = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const sim = fresh(seed);
      const d = until(sim, (x) => x.kind === 'pass');
      expect(d.aimSide).toBe('A');
      sim.setAim(-2.5, -2);
      sim.press(d.contactTime! - (d.shift ?? 0) - 0.03);
      while (sim.decision === d) sim.step(TUNING.dt);
      const t = timeAtHeightDescending(sim.ball, TUNING.setHeight);
      if (t !== null) {
        const p = positionAt(sim.ball, t);
        if (Math.hypot(p.x + 2.5, p.z + 2) < 1.3) near += 1;
      }
    }
    expect(near).toBeGreaterThanOrEqual(4);
  });

  it('marca de defensa: un defensor (que no bloquea) va hacia la marca', () => {
    const sim = fresh(6);
    const d = until(sim, (x) => x.kind === 'block');
    expect(d.aimSide).toBe('A');
    sim.setAim(-5, 3);
    const covering = sim.court('A').map((k) => sim.player(k)).filter((p) => Math.hypot(p.target.x + 5, p.target.z - 3) < 0.05);
    expect(covering).toHaveLength(1);
    expect(sim.blockers?.keys).not.toContain(covering[0].key);
  });
});

describe('pelota en la red', () => {
  it('una pelota que cae junto a la red cae del lado del equipo que pierde el punto (no atraviesa la red)', () => {
    let nearNet = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const sim = new Simulation({ seed, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1] });
      sim.bus.on((e) => {
        if (e.type !== 'point') return;
        const land = positionAt(sim.ball, landingTime(sim.ball));
        // Dentro de la cancha, junto a la red: pierde el lado donde cae (incluye las pelotas que pegan en la red).
        if (Math.abs(land.x) < 0.6 && isInCourt(land)) {
          nearNet += 1;
          expect(sideOfX(land.x)).toBe(e.winner === 'A' ? 'B' : 'A');
        }
      });
      while (sim.phase !== 'matchOver') sim.step(TUNING.dt);
    }
    expect(nearNet).toBeGreaterThan(5);
  });
});
