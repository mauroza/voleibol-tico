import { v3, type Vec3 } from './vec';

export type TeamId = 'A' | 'B';

export const COURT = {
  halfLength: 9,
  halfWidth: 4.5,
  netHeight: 2.43,
  attackLine: 3,
  ballRadius: 0.105,
  antennaZ: 4.5,
} as const;

export const GRAVITY = 9.81;

/**
 * Lado de cada equipo: al empezar A juega en x<0 y B en x>0; con el cambio de cancha (cada set, o lo que elija quien
 * pierde el sorteo) se invierte. La simulación lo fija antes de cada paso (`setSidesFlipped`).
 */
let flipped = false;
export function setSidesFlipped(value: boolean): void {
  flipped = value;
}
export const sidesFlipped = (): boolean => flipped;
export const sideSign = (team: TeamId): number => ((team === 'A') !== flipped ? -1 : 1);
export const otherTeam = (team: TeamId): TeamId => (team === 'A' ? 'B' : 'A');
export const sideOfX = (x: number): TeamId => ((x < 0) !== flipped ? 'A' : 'B');

/** depth: metros desde la red hacia el fondo propio. right: lateral a la derecha del equipo mirando la red. */
export function toWorld(team: TeamId, depth: number, right: number, y = 0): Vec3 {
  const s = sideSign(team);
  return v3(s * depth, y, -s * right + 0);
}

export function isInCourt(p: Vec3): boolean {
  return Math.abs(p.x) <= COURT.halfLength + COURT.ballRadius && Math.abs(p.z) <= COURT.halfWidth + COURT.ballRadius;
}
