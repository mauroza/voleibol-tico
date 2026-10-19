import { COURT, GRAVITY } from './court';
import { clone, v3, type Vec3 } from './vec';

export interface Trajectory {
  p0: Vec3;
  v0: Vec3;
  t0: number;
  /** Gravedad efectiva: mayor que GRAVITY simula topspin. */
  g: number;
}

export function positionAt(tr: Trajectory, t: number): Vec3 {
  const dt = t - tr.t0;
  return v3(tr.p0.x + tr.v0.x * dt, tr.p0.y + tr.v0.y * dt - 0.5 * tr.g * dt * dt, tr.p0.z + tr.v0.z * dt);
}

/** Lanza desde `from` para llegar a `to` en `flightTime` segundos. */
export function launch(from: Vec3, to: Vec3, flightTime: number, t0: number, g = GRAVITY): Trajectory {
  const T = flightTime;
  const v0 = v3((to.x - from.x) / T, (to.y - from.y + 0.5 * g * T * T) / T, (to.z - from.z) / T);
  return { p0: clone(from), v0, t0, g };
}

/** Tiempo absoluto en que la pelota baja hasta la altura h, o null si nunca la alcanza. */
export function timeAtHeightDescending(tr: Trajectory, h: number): number | null {
  const a = 0.5 * tr.g;
  const b = -tr.v0.y;
  const c = h - tr.p0.y;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const dt = (-b + Math.sqrt(disc)) / (2 * a);
  return dt >= 0 ? tr.t0 + dt : null;
}

export function landingTime(tr: Trajectory): number {
  return timeAtHeightDescending(tr, COURT.ballRadius) ?? tr.t0;
}

export type NetCheck =
  | { kind: 'none' }
  | { kind: 'clear'; time: number }
  | { kind: 'fault'; time: number; reason: 'net' | 'antenna' };

export function checkNet(tr: Trajectory): NetCheck {
  if (tr.v0.x === 0) return { kind: 'none' };
  const dt = -tr.p0.x / tr.v0.x;
  if (dt <= 0) return { kind: 'none' };
  const time = tr.t0 + dt;
  if (time > landingTime(tr)) return { kind: 'none' };
  const p = positionAt(tr, time);
  if (Math.abs(p.z) > COURT.antennaZ) return { kind: 'fault', time, reason: 'antenna' };
  if (p.y < COURT.netHeight + COURT.ballRadius) return { kind: 'fault', time, reason: 'net' };
  return { kind: 'clear', time };
}
