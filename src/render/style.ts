/**
 * Estilo de los jugadores 3D: forma del cuerpo, cara, pelo, sombreado y contorno. Es uno solo para todo el juego
 * (`GAME_STYLE`). El editor de personajes (`?editor`, solo para quien diseña) arma uno nuevo; sus ajustes se copian y se
 * pegan aquí. "Probar en un partido" usa el borrador del editor solo en esa pestaña.
 */

import { settings } from '../data/profile';

export type HairStyle = 'variado' | 'casquete' | 'puntas' | 'mechones' | 'cola';
export type TorsoShape = 'capsula' | 'atleta';
/** Cuerpo de curvas (cápsulas y esferas) o de bloques redondeados (cabeza cúbica, puños, zapatillas gruesas). */
export type BodyShape = 'redondo' | 'bloque';

export interface CharStyle {
  /** Forma de las piezas: redondas o bloques redondeados. */
  body: BodyShape;
  /** Suavidad de las curvas (1 = como antes, facetado; 4 = muy redondo). */
  detail: number;
  /** Forma del tronco: cápsula (antes) o de atleta (hombros anchos, cintura fina). */
  torso: TorsoShape;
  /** Tamaño de la cabeza (más grande = más anime). */
  head: number;
  /** Ancho de hombros. */
  shoulders: number;
  /** Ancho de la cintura respecto del pecho. */
  waist: number;
  /** Grosor de brazos y piernas. */
  limbs: number;
  /** Manos. */
  hands: boolean;
  /** Peinado (variado: cada jugador uno distinto). */
  hair: HairStyle;
  /** Tamaño de los ojos. */
  eyes: number;
  /** Brillo blanco en los ojos (estilo anime). */
  eyeShine: boolean;
  /** Cantidad de tonos del sombreado (2 = muy anime, 5 = más suave). */
  tones: number;
  /** Bordes entre tonos: 0 cortados, 1 difuminados. */
  soft: number;
  /** Qué tan oscura es la sombra (0.3 muy oscura, 0.8 casi sin sombra). */
  shadow: number;
  /** Grosor del contorno negro (0 = sin contorno). */
  outline: number;
  /** Luz de borde que despega al jugador del fondo. */
  rim: number;
  /** Tamaño de las zapatillas. */
  shoes: number;
  /** Medias blancas (cuerpo de bloques). */
  socks: boolean;
  /** Cejas: positivo bajan hacia adentro (serio), negativo suben (alegre). */
  brows: number;
  /** Volumen de mechones, puntas y cola. */
  hairVolume: number;
  /** Tamaño del puño (cuerpo de bloques). */
  fist: number;
  /** Sombra cálida: la parte oscura tira a durazno en vez de gris. */
  warmth: number;
  /** Viveza de los colores (1 = normal). */
  vivid: number;
  /** Largo de las piernas (1 = como antes; menos = más cortas, el tronco crece lo mismo). */
  legs: number;
  /** Espacio entre las piernas (m). */
  legGap: number;
}

/** Cómo se veían los jugadores antes del editor (para comparar). */
export const BEFORE_STYLE: CharStyle = {
  body: 'redondo', detail: 1, torso: 'capsula', head: 1, shoulders: 1, waist: 1, limbs: 1, hands: false, hair: 'casquete',
  eyes: 1, eyeShine: false, tones: 4, soft: 0, shadow: 0.47, outline: 1, rim: 0, shoes: 1, socks: false, brows: -0.12, hairVolume: 1, fist: 1, warmth: 0, vivid: 1, legs: 1, legGap: 0.05,
};

/** Redondo: curvas suaves, tronco de atleta, cara anime y sombreado suave. */
export const ROUND_STYLE: CharStyle = {
  body: 'redondo', detail: 3, torso: 'atleta', head: 1.12, shoulders: 1.12, waist: 0.8, limbs: 1, hands: true, hair: 'variado',
  eyes: 1.25, eyeShine: true, tones: 3, soft: 0.35, shadow: 0.55, outline: 0.75, rim: 0.35, shoes: 1, socks: false, brows: -0.12, hairVolume: 1, fist: 1, warmth: 0.3, vivid: 1.1, legs: 1, legGap: 0.05,
};

/** Bloques redondeados, como el dibujo del jugador con el 10: cabeza grande, puños, medias y zapatillas gruesas. */
export const BLOCK_STYLE: CharStyle = {
  body: 'bloque', detail: 3, torso: 'atleta', head: 1.3, shoulders: 1.1, waist: 0.9, limbs: 1.1, hands: true, hair: 'mechones',
  eyes: 1.1, eyeShine: false, tones: 5, soft: 1, shadow: 0.62, outline: 0.3, rim: 0.2, shoes: 1, socks: true, brows: 0.32, hairVolume: 1,
  fist: 1.1, warmth: 0.7, vivid: 1.2, legs: 0.82, legGap: 0.07,
};

/** El estilo del juego: el que ven todos. Se cambia pegando aquí los ajustes copiados del editor. */
export const GAME_STYLE: CharStyle = BLOCK_STYLE;

/** Rango de cada ajuste numérico del editor. */
export const STYLE_RANGES: Partial<Record<keyof CharStyle, [number, number, number]>> = {
  detail: [1, 4, 1],
  head: [0.85, 1.6, 0.01],
  shoulders: [0.85, 1.35, 0.01],
  waist: [0.6, 1.1, 0.01],
  limbs: [0.75, 1.4, 0.01],
  eyes: [0.6, 1.8, 0.01],
  brows: [-0.5, 0.6, 0.01],
  hairVolume: [0.7, 1.5, 0.01],
  shoes: [0.8, 1.5, 0.01],
  legs: [0.7, 1, 0.01],
  legGap: [0, 0.14, 0.005],
  fist: [0.8, 1.4, 0.01],
  warmth: [0, 1, 0.01],
  vivid: [0.7, 1.6, 0.01],
  tones: [2, 5, 1],
  soft: [0, 1, 0.01],
  shadow: [0.3, 0.85, 0.01],
  outline: [0, 2, 0.01],
  rim: [0, 1, 0.01],
};

/** Borrador del editor (solo en el navegador de quien diseña) y la marca de "probar en un partido" de esta pestaña. */
const DRAFT_KEY = 'voleibol-tico:editor';
const TRY_KEY = 'voleibol-tico:editor-try';

/** Borrador guardado del editor (o el estilo del juego si no hay). */
export function draftStyle(): CharStyle {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return { ...GAME_STYLE, ...(JSON.parse(raw) as Partial<CharStyle>) };
  } catch {
    // Sin almacenamiento: el del juego.
  }
  return { ...GAME_STYLE };
}

export function saveDraft(s: CharStyle): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(s));
  } catch {
    // Sin almacenamiento: el borrador dura lo que la página.
  }
}

/** El próximo partido de esta pestaña usa el borrador del editor (nadie más lo ve). */
export function tryDraftInMatch(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(TRY_KEY, '1');
    else sessionStorage.removeItem(TRY_KEY);
  } catch {
    // Sin almacenamiento: se juega con el estilo del juego.
  }
}

/** Estilo de los jugadores: el del juego, salvo que esta pestaña esté probando el borrador del editor. */
export function charStyle(): CharStyle {
  try {
    if (sessionStorage.getItem(TRY_KEY)) return draftStyle();
  } catch {
    // Sin almacenamiento: el del juego.
  }
  return GAME_STYLE;
}

/**
 * Estilo para el partido: con la suavidad limitada por la calidad de Ajustes (en el partido hay ~30 personajes; en
 * calidad baja las curvas son las de antes y el teléfono no sufre).
 */
export function matchStyle(): CharStyle {
  const s = charStyle();
  const cap = { alta: 3, media: 2, baja: 1 }[settings().quality];
  return s.detail > cap ? { ...s, detail: cap } : s;
}
