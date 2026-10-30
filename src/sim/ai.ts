import type { AttackShot, ServeType, SetChoice, SetOption, SetTempo, Zone } from './actions';
import type { PlayerDef } from './players';
import type { Rng } from './rng';

export function chooseServe(rng: Rng, server: PlayerDef): { type: ServeType; zone: Zone } {
  const type = rng.weighted<ServeType>([
    { item: 'jump', weight: server.attrs.serve / 100 },
    { item: 'float', weight: 0.8 },
    { item: 'safe', weight: 0.15 },
  ]);
  const zone = rng.weighted<Zone>([
    { item: 1, weight: 3 }, { item: 5, weight: 3 }, { item: 6, weight: 2 },
    { item: 2, weight: 0.5 }, { item: 3, weight: 0.5 }, { item: 4, weight: 0.5 },
  ]);
  return { type, zone };
}

/** Peso de cada carril y, dentro de él, de cada tempo [alta, media, rápida]: al central casi siempre rápida. */
const SET_WEIGHT: Record<SetOption, number> = { zone4: 0.34, zone3: 0.22, zone2: 0.22, pipe: 0.1, back1: 0.05 };
const TEMPO_WEIGHT: Record<SetOption, readonly number[]> = {
  zone4: [1, 0.45, 0.4], zone3: [0.1, 0.5, 1.2], zone2: [1, 0.45, 0.35], pipe: [0.4, 1, 0.3], back1: [0.5, 1, 0.3],
};

export function chooseSet(rng: Rng, choices: readonly SetChoice[]): SetChoice {
  return rng.weighted(choices.map((c) => ({ item: c, weight: SET_WEIGHT[c.option] * TEMPO_WEIGHT[c.option][c.tempo] })));
}

export function chooseShot(rng: Rng): AttackShot {
  return rng.weighted<AttackShot>([
    { item: 'cross', weight: 0.5 },
    { item: 'line', weight: 0.35 },
    { item: 'tip', weight: 0.15 },
  ]);
}

/**
 * Cuántos bloquean según el tempo de la colocación: a una rápida (tiempo 1) solo llega uno; a una media (tiempo 2),
 * dos; a una alta (tiempo 3) o fuera de sistema, tres. `_rng` se mantiene por compatibilidad de la firma.
 */
export function chooseBlockScheme(_rng: Rng, tempo: SetTempo, outOfSystem: boolean): number {
  if (outOfSystem) return 3;
  return [3, 2, 1][tempo];
}
