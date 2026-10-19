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
  /** Separación cuerpo–pelota en cada contacto (m): la pelota queda donde llegan los brazos. */
  contactStance: { bumpReach: 0.62, diveReach: 0.6, setBehind: 0.15, spikeBehind: 0.3, spikeSide: 0.22, blockDepth: 0.42 },
  /** Distancia mínima entre compañeros en cancha (m). */
  minSeparation: 0.55,
  /** El cuerpo no se acerca a la red a menos de esto (m): nadie cruza la línea central. */
  minNetGap: 0.2,
  /** Rebotes de la pelota tras el punto: pierde energía vertical y horizontal en cada pique. */
  bounce: { max: 4, restitution: 0.55, friction: 0.78, minUp: 0.8 },
  servePause: 1.0,
  passHeight: 0.9,
  setHeight: 2.3,
  diveHeight: 0.4,
  timing: { perfect: 0.3, good: 0.5, bad: 0.2 },
  /** Timing de la IA rival según la dificultad (normal = `timing`). */
  difficulty: {
    easy: { perfect: 0.15, good: 0.45, bad: 0.4 },
    normal: { perfect: 0.3, good: 0.5, bad: 0.2 },
    hard: { perfect: 0.5, good: 0.42, bad: 0.08 },
  },
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
    /** La semi-rápida tolera un pase algo peor que la rápida. */
    minPassForSemi: 0.4,
    outOfSystemPass: 0.3,
    rescueFlightTime: 1.5,
    flightTime: { zone4: 1.25, zone4fast: 0.75, quick: 0.55, semi: 0.75, zone2: 1.0, pipe: 0.95, back1: 1.0 },
  },
  attack: {
    base: 1.08,
    minSpeed: 21,
    speedRange: 13,
    gravityBonus: 6,
    tipFlightTime: 0.9,
    /** Apuntar a menos de esta distancia de la red (m) es una finta. */
    tipDepth: 3.0,
    noise: 2.0,
    targetSamples: 8,
    shots: { cross: { risk: 0.1 }, line: { risk: 0.14 }, tip: { risk: 0.04 }, tool: { risk: 0.16 } },
  },
  free: { flightTime: 1.6, risk: 0.03 },
  /** Barra de fuerza (remate y saque): umbrales y efecto de cada zona. */
  power: {
    medium: 0.5,
    strong: 0.82,
    spike: {
      soft: { speed: 0.75, risk: 0.6, noise: 0.7 },
      medium: { speed: 1, risk: 1, noise: 1 },
      strong: { speed: 1.32, risk: 1.35, noise: 1.15 },
    },
    serveType: { soft: 'safe', medium: 'float', strong: 'jump' },
  },
  /** Marca de defensa del usuario: el defensor que la cubre llega mejor si el remate va cerca. */
  defense: { focusRadius: 1.8, reachBonus: 0.7, reactionBonus: 0.1 },
  decision: {
    /** Sin opción elegida el tiempo casi se detiene: tiempo para pensar. */
    thinkScale: 0.1,
    /** Opción elegida, aún lejos del contacto: acercamiento. */
    approachScale: 0.6,
    /** Opción elegida, últimos `slowWindow` segundos: cámara lenta para el timing. */
    slowScale: 0.3,
    /** Segundos de simulación antes del contacto en que corre el medidor de timing. */
    slowWindow: 0.4,
    /** Bono de calidad del usuario con timing perfecto: el "momento anime". */
    perfectBonus: 0.15,
    perfectWindow: 0.08,
    goodWindow: 0.2,
    servePeriod: 1.6,
    serveTimeout: 10,
    blockTiming: { perfect: 1.5, good: 1, bad: 0.5 },
    toolBase: 0.35,
    toolScale: 0.4,
    highPass: { flightTime: 1.8, noiseFactor: 0.5, riskFactor: 0.5 },
    /** Remate apuntado: el tiempo corre más lento para mover la mira y golpear a tiempo. */
    aimApproachScale: 0.35,
    aimSlowScale: 0.22,
    /** Los errores al azar pesan menos: el usuario ya puede mandarla afuera apuntando mal. */
    aimRiskFactor: 0.6,
  },
  block: {
    reactionTime: 0.3,
    lateralSpeed: 3.0,
    handWidth: 0.6,
    stuffBase: 0.08,
    stuffScale: 0.3,
    /** Multiplicador de tapa y probabilidad de toque según cuántos bloquean. */
    nFactor: [0, 0.75, 1.1, 1.35],
    touchByN: [0, 0.2, 0.28, 0.33],
    /** Separación lateral entre bloqueadores que cierran el bloqueo (m). */
    spacing: 0.75,
  },
} as const;
