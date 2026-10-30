/** Todas las constantes de balance en un solo lugar. Ajustar con `npm run sim`. */
export const TUNING = {
  dt: 1 / 120,
  reactionTime: 0.42,
  /** Distancia que un jugador cubre estirándose o lanzándose, sin desplazarse. */
  reachRadius: 0.7,
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
  /**
   * Pabellón: paredes laterales (x), pared del fondo y frente de las tribunas (z, hasta cierta altura) y techo (y).
   * En juego, tocarlos es fuera; después del punto la pelota rebota en ellos.
   */
  hall: { wallX: 17.6, wallZBack: -16.1, standZ: 9.3, standTop: 3.2, ceiling: 11.2, restitution: 0.55 },
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
    float: { base: 1.0, risk: 0.15, speed: 13.5, gravityBonus: 0, contactHeight: 2.95, noise: 1.5 },
    jump: { base: 1.05, risk: 0.32, speed: 22, gravityBonus: 6, contactHeight: 3.25, noise: 2.0 },
    safe: { base: 0.8, risk: 0.05, speed: 11, gravityBonus: 0, contactHeight: 2.3, noise: 1.2 },
  },
  /**
   * Secuencia de saque (segundos del lanzamiento al golpe) y carrera hacia la red: el de suspensión lanza muy alto,
   * corre tres pasos y salta largo; el flotado en salto da dos pasos y un saltito; el seguro, de pie.
   */
  serveWindup: { safe: 0.9, float: 1.0, jump: 1.5 },
  serveRunUp: { safe: 0, float: 0.6, jump: 2.3 },
  serveRunTime: { safe: 0, float: 0.4, jump: 0.8 },
  /** El que saca en suspensión se para más atrás (unos pasos detrás de la línea) para tomar carrera. */
  jumpServeDepth: 12.6,
  pass: {
    base: 1.05, risk: 0.12, flightTime: 1.35, noise: 3.0, lowContactBase: 0.8,
    /** El saque presiona más a la recepción que un remate a la defensa (multiplica la presión). */
    servePressure: 1.6,
    /** Recepción por debajo de esto: la pelota sale despedida (casi siempre ace). */
    shank: 0.3,
    /** Debajo de esta calidad el pase queda fuera de zona: lejos de la red y hacia un costado. */
    offZone: 0.62,
    offZoneDrift: 6,
  },
  set: {
    base: 1.05,
    noise: 2.0,
    /**
     * Tempos según la recepción: las rápidas (rápida al central, rápida a punta) solo con recepción doble positiva;
     * las medias (semi-rápida, zagueros) con recepción positiva; con una recepción complicada, solo pelotas altas.
     */
    minPassForCombination: 0.78,
    minPassForSemi: 0.5,
    outOfSystemPass: 0.3,
    rescueFlightTime: 1.5,
    /** Tiempo de vuelo de la colocación por carril y tempo: [alta, media, rápida]. */
    flightTime: {
      zone4: [1.25, 0.95, 0.72],
      zone3: [1.05, 0.75, 0.55],
      zone2: [1.15, 0.88, 0.66],
      pipe: [1.15, 0.88, 0.7],
      back1: [1.2, 0.92, 0.74],
    },
    /**
     * Distancia de la colocación a la red (la mira la elige): delanteros entre `frontDepth`, zagueros detrás de la
     * línea de 3 m entre `backDepth`. Pegada a la red, el bloqueo tapa más; despegada abre el ángulo, pero el remate
     * pierde algo de fuerza y precisión.
     */
    frontDepth: [0.4, 2.8],
    backDepth: [3.2, 5.0],
    /** Tapa: por cada metro más pegada que lo normal (1 m), tanto más; despegada, tanto menos. */
    tightStuff: 0.38,
    /** Pérdida de velocidad y más dispersión del remate por metro despegado de la red (sobre 1 m). */
    offNetSpeed: 0.04,
    offNetNoise: 0.18,
    /**
     * Finta del central: el central rival a veces "se la come" y salta con él (más si bloquea peor);
     * entonces ese bloqueador no llega al remate.
     */
    decoyBite: 0.45,
  },
  attack: {
    base: 1.17,
    minSpeed: 21,
    speedRange: 13,
    gravityBonus: 6,
    tipFlightTime: 0.9,
    /** La figura del equipo remata más rápido y la pelota pica más alto. */
    starSpeed: 1.1,
    /** El atacante sabe a dónde va la colocación: arranca casi sin demora. */
    approachReaction: 0.05,
    /** Cada metro de estatura sobre el promedio: remate más rápido. */
    heightSpeed: 0.9,
    /** Ataque de zaguero tipo Nishida: salto largo desde lejos de la línea y mucho más alto. */
    backRowLift: 0.22,
    starRestitution: 0.68,
    /** Apuntar a menos de esta distancia de la red (m) es una finta. */
    tipDepth: 3.0,
    /** Los de 2 m o más la hunden: pueden pegar fuerte corto (hasta 1.8 m de la red) y la pelota baja más empinada. */
    tallHeight: 2.0,
    tallTipDepth: 1.8,
    tallGravity: 6,
    /** Remate fuerte a la zona de adelante (entre la línea de 3 m y la red): baja en picada. */
    frontGravity: 9,
    /** Remate en rojo: el primer pique rebota muchísimo (bombazo), con tope de velocidad hacia arriba (m/s). */
    bombRestitution: 0.82,
    bombMaxUp: 12,
    noise: 2.0,
    targetSamples: 8,
    shots: { cross: { risk: 0.1 }, line: { risk: 0.14 }, tip: { risk: 0.04 }, tool: { risk: 0.16 } },
  },
  free: { flightTime: 1.6, risk: 0.03 },
  /** Barra de fuerza (remate y saque): umbrales y efecto de cada zona. */
  power: {
    medium: 0.5,
    strong: 0.82,
    /**
     * Saque morado: la puntita de la barra, después del rojo (muy difícil de acertar). Sale un misil a la línea que
     * nadie alcanza: ace que pica en el piso. La IA lo logra muy de vez en cuando (más si saca muy bien).
     */
    ace: 0.975,
    aceSpeed: 1.3,
    aiAce: 0.025,
    spike: {
      soft: { speed: 0.75, risk: 0.6, noise: 0.7 },
      medium: { speed: 1, risk: 1, noise: 1 },
      strong: { speed: 1.45, risk: 1.35, noise: 1.15 },
    },
    /** Saque: la barra es la fuerza dentro del estilo del sacador (velocidad y riesgo). */
    serve: {
      soft: { speed: 0.85, risk: 0.5 },
      medium: { speed: 1, risk: 1 },
      strong: { speed: 1.12, risk: 1.5 },
    },
  },
  /**
   * Defensa de reflejo ante remates: si la pelota pasa dentro de este radio de un defensor (más amplio cuanto mejor
   * defiende), la levanta sin alcanzar a moverse. Sale incómoda; si el remate es muy duro puede pasarse al otro lado.
   */
  reflex: { radius: 0.75, perDefense: 0.45, minY: 0.25, maxY: 2.1, quality: [0.12, 0.55], overpass: 0.3 },
  /** Pelota que pega en el cuerpo de un defensor: radio del cuerpo y cómo sale (alta y cerca, jugable). */
  bodyHit: { radius: 0.32, quality: [0.1, 0.4], flight: [1.0, 1.5], playable: 0.25 },
  /** Plancha: el defensor se lanza para salvar una pelota lejana (más lejos cuanto mejor defiende). */
  dive: { extra: 1.5, minDefense: 55, quality: 0.85 },
  /** Estamina: costo de cada acción, recuperación y efecto del cansancio (atributos y altura del salto). */
  stamina: {
    cost: { attack: 0.055, backAttack: 0.075, block: 0.035, jumpServe: 0.05, floatServe: 0.03, safeServe: 0.01, dive: 0.07, pass: 0.012, set: 0.008, decoy: 0.025 },
    /** Recuperación por punto: poca, así el cansancio se acumula a lo largo del set. */
    perPoint: 0.008,
    bench: 0.12,
    /** Al terminar el set se recupera bastante. */
    perSet: 0.35,
    floor: 0.25,
    /** Con estamina 0 el atributo rinde este porcentaje y el salto pierde estos metros. */
    attrAtZero: 0.7,
    jumpLoss: 0.18,
  },
  /** Calentamiento de remate: cada cuánto arranca una jugada (alterna equipos) y cuánto vuela cada pase. */
  warmup: { toss: 1.1, gap: 0.5 },
  /** Tiempos y cambios por set; recuperación de estamina en un tiempo; la IA cambia a quien baje de `aiSubBelow`. */
  /** `timeoutLength`: segundos que dura el tiempo pedido por una persona (el saque espera; se puede volver antes). */
  bench: { timeouts: 2, subs: 6, timeoutRest: 0.1, aiSubBelow: 0.45, aiTimeoutStreak: 3, timeoutLength: 30 },
  /**
   * Arbitraje: en jugadas cerradas los árbitros se pueden equivocar (pelota a pocos cm de la línea, roce leve del
   * bloqueo). `fingertip`: chance de que un remate que pasa limpio igual roce los dedos del bloqueo. El equipo perjudicado puede pedir challenge (2 por set; solo se gastan los fallidos).
   */
  calls: { fingertip: 0.35, lineMargin: 0.25, lineMiss: 0.45, touchMiss: 0.25, window: 6, challenges: 2, aiChallengeWrong: 0.75, aiChallengeRight: 0.06 },
  /** Racha: quien anota muchos de los últimos puntos de su equipo se enciende (aura roja) y rinde un poco más. */
  fire: { window: 7, points: 3, bonus: 0.06 },
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
    /**
     * Recepción: barra más larga y el punto ideal en un lugar distinto cada vez (hasta `passShiftMax` s antes del
     * contacto): el verde puede caer a la derecha, en el medio o a la izquierda.
     */
    passWindow: 0.75,
    passShiftMax: 0.5,
    /**
     * Una tecla en el primer instante de una jugada nueva (s de simulación) es el golpe tardío de la anterior:
     * no se aplica (si no, la colocación o el remate se "marcan solos").
     */
    openGuard: 0.08,
    /** La barra de tempo de la colocación corre más tiempo: da para elegir alta, media o rápida con calma. */
    setWindow: 0.75,
    /** Bono de calidad del usuario con timing perfecto: el "momento anime". */
    perfectBonus: 0.2,
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
    /**
     * Perfiles de ritmo de las decisiones (escala del tiempo): clásico = cámara lenta marcada; fluido = más ágil;
     * online = casi tiempo real (en 1 vs 1 el reloj es uno solo para los dos, no puede frenarse mucho).
     */
    profiles: {
      clasico: { think: 0.1, approach: 0.6, slow: 0.3, aimApproach: 0.35, aimSlow: 0.22 },
      fluido: { think: 0.3, approach: 0.85, slow: 0.5, aimApproach: 0.6, aimSlow: 0.42 },
      online: { think: 0.6, approach: 0.95, slow: 0.6, aimApproach: 0.8, aimSlow: 0.55 },
    },
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
    touchByN: [0, 0.06, 0.09, 0.11],
    /** Separación lateral entre bloqueadores que cierran el bloqueo (m). */
    spacing: 0.75,
    /** Medio ancho del bloqueador (manos y cuerpo) más el radio de la pelota: el remate sin toque pasa fuera de esto. */
    bodyHalfWidth: 0.48,
    /**
     * Bloqueo humano: se arma un poco hacia adentro (cuida la diagonal y deja algo de línea) y con error de lectura;
     * más error con colocaciones rápidas y bloqueadores flojos.
     */
    insideShift: 0.35,
    readError: 0.45,
    /**
     * Salto del bloqueo de una persona: lo ideal es saltar este tanto antes del golpe del rematador (s), para estar
     * arriba cuando la pelota cruza. Ventanas de perfecto y bueno alrededor de ese instante.
     */
    jumpLead: 0.15,
    jumpPerfect: 0.07,
    jumpGood: 0.17,
    /** Cada metro de estatura promedio del bloqueo sobre el promedio: más tapas. */
    heightStuff: 2.5,
  },
} as const;
