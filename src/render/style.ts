/**
 * Estilo de los jugadores 3D: forma del cuerpo, cara, pelo, sombreado y contorno. El Probador (menú → Probador) lo
 * cambia en vivo y lo guarda en este navegador; el partido usa lo guardado (o el estilo por defecto).
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
}

/** Cómo se veían los jugadores antes del Probador (para comparar). */
export const BEFORE_STYLE: CharStyle = {
  body: 'redondo', detail: 1, torso: 'capsula', head: 1, shoulders: 1, waist: 1, limbs: 1, hands: false, hair: 'casquete',
  eyes: 1, eyeShine: false, tones: 4, soft: 0, shadow: 0.47, outline: 1, rim: 0,
};

/** Redondo: curvas suaves, tronco de atleta, cara anime y sombreado suave. */
export const ROUND_STYLE: CharStyle = {
  body: 'redondo', detail: 3, torso: 'atleta', head: 1.12, shoulders: 1.12, waist: 0.8, limbs: 1, hands: true, hair: 'variado',
  eyes: 1.25, eyeShine: true, tones: 3, soft: 0.35, shadow: 0.55, outline: 0.75, rim: 0.35,
};

/** Bloques redondeados, como el dibujo del jugador con el 10: cabeza grande, puños, medias y zapatillas gruesas. */
export const BLOCK_STYLE: CharStyle = {
  body: 'bloque', detail: 3, torso: 'atleta', head: 1.3, shoulders: 1.1, waist: 0.9, limbs: 1.1, hands: true, hair: 'mechones',
  eyes: 1.1, eyeShine: false, tones: 3, soft: 0.6, shadow: 0.6, outline: 0.35, rim: 0.25,
};

/** Estilo por defecto del juego: el de bloques. */
export const DEFAULT_STYLE: CharStyle = BLOCK_STYLE;

/** Rango de cada ajuste numérico del Probador. */
export const STYLE_RANGES: Partial<Record<keyof CharStyle, [number, number, number]>> = {
  detail: [1, 4, 1],
  head: [0.85, 1.4, 0.01],
  shoulders: [0.85, 1.35, 0.01],
  waist: [0.6, 1.1, 0.01],
  limbs: [0.75, 1.3, 0.01],
  eyes: [0.6, 1.8, 0.01],
  tones: [2, 5, 1],
  soft: [0, 1, 0.01],
  shadow: [0.3, 0.85, 0.01],
  outline: [0, 2, 0.01],
  rim: [0, 1, 0.01],
};

const KEY = 'voleibol-tico:look';

/**
 * Estilo para el partido: el del Probador con la suavidad limitada por la calidad de Ajustes (en el partido hay ~30
 * personajes; en calidad baja las curvas son las de antes y el teléfono no sufre).
 */
export function matchStyle(): CharStyle {
  const s = charStyle();
  const cap = { alta: 3, media: 2, baja: 1 }[settings().quality];
  return s.detail > cap ? { ...s, detail: cap } : s;
}

let current: CharStyle | null = null;
const listeners: ((s: CharStyle) => void)[] = [];

/** Estilo en uso: el guardado en el Probador o el de por defecto. */
export function charStyle(): CharStyle {
  if (current) return current;
  current = { ...DEFAULT_STYLE };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) current = { ...DEFAULT_STYLE, ...(JSON.parse(raw) as Partial<CharStyle>) };
  } catch {
    // Sin almacenamiento: estilo por defecto.
  }
  return current;
}

/** Cambia el estilo (lo guarda) y avisa a quien lo dibuja. */
export function setCharStyle(s: CharStyle): void {
  current = { ...s };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Sin almacenamiento: vale solo para esta sesión.
  }
  for (const f of listeners) f(current);
}

/** Vuelve al estilo por defecto (borra lo guardado). */
export function resetCharStyle(): void {
  setCharStyle(DEFAULT_STYLE);
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nada que borrar.
  }
}

export function onCharStyle(f: (s: CharStyle) => void): void {
  listeners.push(f);
}
