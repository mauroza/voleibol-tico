export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const clone = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
/**
 * Largo de (x, z) con una raíz cuadrada exacta (IEEE): da lo mismo en todos los navegadores. `Math.hypot`, `sin`
 * y `cos` pueden diferir en el último decimal entre motores y desincronizar una partida online.
 */
export const len2 = (x: number, z: number): number => Math.sqrt(x * x + z * z);
export const distXZ = (a: Vec3, b: Vec3): number => len2(a.x - b.x, a.z - b.z);
export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
export const clamp01 = (v: number): number => clamp(v, 0, 1);
