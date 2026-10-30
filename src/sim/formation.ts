import type { SetOption, Zone } from './actions';
import { toWorld, type TeamId } from './court';
import type { Role } from './players';
import type { Vec3 } from './vec';

/** [depth, right] en coordenadas locales del equipo. */
export type Spot = readonly [number, number];

/** Índice = posición − 1 (antes del saque, en el orden de la rotación). */
export const DEFENSE_SPOTS: readonly Spot[] = [[6.5, 3], [0.6, 3], [0.6, 0], [0.6, -3], [6.5, -3], [7.5, 0]];
export const RECEIVE_SPOTS: readonly Spot[] = [[6.5, 3], [3.5, 3], [3.0, 0], [3.5, -3], [6.5, -3], [7.0, 0]];

/**
 * Zonas de defensa por especialidad (después del saque cada uno "cambia" a su zona):
 * delanteros: punta a la izquierda (4), central al centro (3), opuesto o colocador a la derecha (2);
 * zagueros: colocador u opuesto en 1, punta en 6, central o líbero en 5.
 */
export function zoneSpotFor(role: Role, front: boolean): Spot {
  if (front) return role === 'OH' ? [0.6, -3] : role === 'MB' ? [0.6, 0] : [0.6, 3];
  if (role === 'S' || role === 'OP') return [6.5, 3];
  if (role === 'OH') return [7.5, 0];
  return [6.5, -3];
}

export const SETTER_SPOT: Spot = [0.8, 1.0];
/** Si el colocador toma la primera pelota, coloca el líbero desde atrás de la línea de 3 m. */
export const LIBERO_SET_SPOT: Spot = [3.8, 0.5];

/**
 * Recepción del 5-1: reciben el líbero y los puntas (tres en línea, en el orden izquierda-derecha de la rotación);
 * el colocador zaguero se esconde cerca de la red para penetrar, los delanteros que no reciben esperan en la red
 * y el opuesto zaguero se esconde al fondo. Devuelve un lugar por posición (índice = posición − 1).
 */
export function receiveFormation(roles: readonly Role[]): Spot[] {
  const out: Spot[] = RECEIVE_SPOTS.map((s) => s);
  const isFront = (i: number) => i >= 1 && i <= 3;
  const receivers = roles.map((_, i) => i).filter((i) => roles[i] === 'L' || roles[i] === 'OH' || (!isFront(i) && roles[i] === 'MB'));
  receivers.sort((a, b) => RECEIVE_SPOTS[a][1] - RECEIVE_SPOTS[b][1]);
  const lanes = receivers.length >= 3 ? [-3, 0, 3] : receivers.length === 2 ? [-1.8, 1.8] : [0];
  receivers.slice(0, 3).forEach((i, k) => { out[i] = [6.3, lanes[k]]; });
  roles.forEach((role, i) => {
    if (receivers.slice(0, 3).includes(i)) return;
    const right = RECEIVE_SPOTS[i][1];
    if (role === 'S') out[i] = isFront(i) ? [0.9, right] : [2.6, 2.6];
    else if (isFront(i)) out[i] = [1.4, right];
    else out[i] = [8.2, right >= 0 ? 3.6 : -3.6];
  });
  return out;
}
export const SERVE_SPOT: Spot = [10.6, 2.5];
export const APPROACH_SPOTS: Record<SetOption, Spot> = {
  zone4: [3.2, -3.6], zone3: [2.0, 0.5], zone2: [3.2, 3.6], pipe: [6.6, 0], back1: [6.6, 3.2],
};
export const ATTACK_POINTS: Record<SetOption, Spot> = {
  zone4: [1.0, -3.6], zone3: [0.7, 0.4], zone2: [1.0, 3.6], pipe: [3.3, 0], back1: [3.3, 3.2],
};
export const ZONE_SPOTS: Record<Zone, Spot> = { 1: [7, 3], 2: [1.8, 3], 3: [1.8, 0], 4: [1.8, -3], 5: [7, -3], 6: [7, 0] };

export const spot = (team: TeamId, s: Spot, y = 0): Vec3 => toWorld(team, s[0], s[1], y);
