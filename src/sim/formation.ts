import type { SetOption, Zone } from './actions';
import { toWorld, type TeamId } from './court';
import type { Vec3 } from './vec';

/** [depth, right] en coordenadas locales del equipo. */
export type Spot = readonly [number, number];

/** Índice = posición − 1. */
export const DEFENSE_SPOTS: readonly Spot[] = [[6.5, 3], [0.6, 3], [0.6, 0], [0.6, -3], [6.5, -3], [7.5, 0]];
export const RECEIVE_SPOTS: readonly Spot[] = [[6.5, 3], [3.5, 3], [3.0, 0], [3.5, -3], [6.5, -3], [7.0, 0]];
export const SETTER_SPOT: Spot = [0.8, 1.0];
export const SERVE_SPOT: Spot = [9.6, 2.5];
export const APPROACH_SPOTS: Record<SetOption, Spot> = { zone4: [3.2, -3.6], zone2: [3.2, 3.6], quick: [2.0, 0.5], pipe: [5.5, 0] };
export const ATTACK_POINTS: Record<SetOption, Spot> = { zone4: [1.0, -3.6], zone2: [1.0, 3.6], quick: [0.7, 0.4], pipe: [3.6, 0] };
export const ZONE_SPOTS: Record<Zone, Spot> = { 1: [7, 3], 2: [1.8, 3], 3: [1.8, 0], 4: [1.8, -3], 5: [7, -3], 6: [7, 0] };

export const spot = (team: TeamId, s: Spot, y = 0): Vec3 => toWorld(team, s[0], s[1], y);
