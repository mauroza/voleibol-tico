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

const SET_WEIGHT: Record<SetOption, number> = { zone4: 0.4, zone2: 0.25, quick: 0.2, pipe: 0.15 };

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
