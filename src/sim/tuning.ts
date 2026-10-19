/** Todas las constantes de balance en un solo lugar. Ajustar con `npm run sim`. */
export const TUNING = {
  dt: 1 / 120,
  reactionTime: 0.35,
  /** Distancia que un jugador cubre estirándose o lanzándose, sin desplazarse. */
  reachRadius: 0.8,
  minPlanLead: 0.12,
  /** Si la pelota rival va a caer fuera por más de esto, se deja caer. */
  letDropMargin: 0.25,
  pointPause: 1.5,
  servePause: 1.0,
  passHeight: 0.9,
  setHeight: 2.3,
  diveHeight: 0.4,
  timing: { perfect: 0.3, good: 0.5, bad: 0.2 },
  serve: {
    float: { base: 1.0, risk: 0.15, speed: 15, gravityBonus: 0, contactHeight: 2.6, noise: 1.5 },
    jump: { base: 1.05, risk: 0.32, speed: 21, gravityBonus: 6, contactHeight: 3.1, noise: 2.0 },
    safe: { base: 0.8, risk: 0.05, speed: 11, gravityBonus: 0, contactHeight: 2.3, noise: 1.2 },
  },
  pass: { base: 1.05, risk: 0.12, flightTime: 1.35, noise: 3.0, lowContactBase: 0.8 },
  set: {
    base: 1.05,
    noise: 2.0,
    minPassForCombination: 0.55,
    outOfSystemPass: 0.3,
    rescueFlightTime: 1.5,
    flightTime: { zone4: 1.25, zone2: 1.0, quick: 0.55, pipe: 0.95 },
  },
  attack: {
    base: 1.08,
    minSpeed: 16,
    speedRange: 12,
    gravityBonus: 4,
    tipFlightTime: 0.9,
    noise: 2.0,
    targetSamples: 8,
    shots: { cross: { risk: 0.1 }, line: { risk: 0.14 }, tip: { risk: 0.04 } },
  },
  free: { flightTime: 1.6, risk: 0.03 },
  block: { reactionTime: 0.3, lateralSpeed: 3.0, handWidth: 0.6, stuffBase: 0.08, stuffScale: 0.3, touchChance: 0.25, doubleBonus: 1.25 },
} as const;
