export interface Rng {
  next(): number;
  range(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly { item: T; weight: number }[]): T;
}

/** mulberry32: rápido, determinista y suficiente para un juego. */
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    weighted: (items) => {
      const total = items.reduce((sum, i) => sum + i.weight, 0);
      let r = next() * total;
      for (const i of items) {
        r -= i.weight;
        if (r < 0) return i.item;
      }
      return items[items.length - 1].item;
    },
  };
}
