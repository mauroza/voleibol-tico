import type { AttackShot, ServeType, SetChoice, SetOption, Zone } from './actions';
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

const SET_WEIGHT: Record<SetOption, number> = { zone4: 0.3, zone4fast: 0.12, quick: 0.15, semi: 0.08, zone2: 0.2, pipe: 0.1, back1: 0.05 };

export function chooseSet(rng: Rng, choices: readonly SetChoice[]): SetChoice {
  return rng.weighted(choices.map((c) => ({ item: c, weight: SET_WEIGHT[c.option] })));
}

export function chooseShot(rng: Rng): AttackShot {
  return rng.weighted<AttackShot>([
    { item: 'cross', weight: 0.5 },
    { item: 'line', weight: 0.35 },
    { item: 'tip', weight: 0.15 },
  ]);
}

/**
 * Cuántos bloquean según la colocación rival: contra la rápida casi siempre uno (no da tiempo a cerrar);
 * contra pelotas altas o fuera de sistema, doble o triple.
 */
export function chooseBlockScheme(rng: Rng, option: SetOption, outOfSystem: boolean): number {
  if (outOfSystem) return rng.weighted([{ item: 2, weight: 0.45 }, { item: 3, weight: 0.5 }, { item: 1, weight: 0.05 }]);
  switch (option) {
    case 'quick':
      return rng.weighted([{ item: 1, weight: 0.75 }, { item: 2, weight: 0.25 }]);
    case 'semi':
    case 'zone4fast':
      return rng.weighted([{ item: 1, weight: 0.35 }, { item: 2, weight: 0.55 }, { item: 3, weight: 0.1 }]);
    default:
      return rng.weighted([{ item: 1, weight: 0.1 }, { item: 2, weight: 0.6 }, { item: 3, weight: 0.3 }]);
  }
}
