/**
 * Perfil del jugador, guardado en este navegador: apodo, su club (nombre, siglas, colores, escudo), la plantilla
 * (jugadores básicos y cartas de los sobres), sobres por abrir y los ajustes del juego.
 */

export type Action = 'up' | 'down' | 'left' | 'right' | 'hit' | 'pause' | 'timeout' | 'challenge' | 'mute' | 'chat';

export const ACTION_LABELS: Record<Action, string> = {
  up: 'Mira hacia adelante',
  down: 'Mira hacia atrás',
  left: 'Mira a la izquierda',
  right: 'Mira a la derecha',
  hit: 'Golpear / saltar',
  pause: 'Pausa',
  timeout: 'Pedir tiempo',
  challenge: 'Challenge',
  mute: 'Silencio',
  chat: 'Chat (online)',
};

/** Teclas por defecto (códigos de `KeyboardEvent.code`); las flechas siempre funcionan además de estas. */
export const DEFAULT_KEYS: Record<Action, string> = {
  up: 'KeyW',
  down: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  hit: 'Space',
  pause: 'Escape',
  timeout: 'KeyT',
  challenge: 'KeyC',
  mute: 'KeyM',
  chat: 'Enter',
};

export type FpsCap = 0 | 30 | 60 | 120;
export type Quality = 'alta' | 'media' | 'baja';
export type MouseMode = 'directo' | 'relativo';

export interface Settings {
  /** Volúmenes 0..1. */
  music: number;
  sfx: number;
  ui: number;
  /** 0 = sin límite. */
  fps: FpsCap;
  quality: Quality;
  /** Mouse: la mira bajo el cursor, o se mueve con el mouse como en un trackpad. */
  mouseMode: MouseMode;
  /** Multiplicadores de sensibilidad (1 = normal). */
  mouseSens: number;
  touchSens: number;
  keySens: number;
  keys: Record<Action, string>;
  /** Mostrar el chat en online. */
  chat: boolean;
}

export interface ClubIdentity {
  name: string;
  short: string;
  primary: string;
  secondary: string;
  /** Diseño del escudo (0..CREST_COUNT-1). */
  crest: number;
}

/** Puesto de la plantilla: 0-5 titulares (S, OH, MB, OP, OH, MB), 6 líbero, 7-11 banca (como los equipos). */
export const SQUAD_SIZE = 12;

export interface Profile {
  version: 1;
  nickname: string;
  club: ClubIdentity;
  /** Semilla de los jugadores básicos del club (fija: cambiar el nombre del club no cambia la plantilla). */
  seed: number;
  /** Nombres que el usuario puso a sus jugadores básicos: 'base:<n>' → nombre. */
  names: Record<string, string>;
  /** Qué jugador ocupa cada puesto: id de carta ('card:<id>') o del básico ('base:<n>'). */
  squad: string[];
  /** Cartas obtenidas: id → cuántas (las repetidas suben su nivel). */
  cards: Record<string, number>;
  packs: number;
  /** Sobres ya abiertos (para la colección). */
  opened: number;
  wins: number;
  played: number;
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  music: 0.45,
  sfx: 0.8,
  ui: 0.6,
  fps: 0,
  quality: 'alta',
  mouseMode: 'directo',
  mouseSens: 1,
  touchSens: 1,
  keySens: 1,
  keys: { ...DEFAULT_KEYS },
  chat: true,
};

const KEY = 'voleibol-tico:profile';

export function defaultProfile(): Profile {
  return {
    version: 1,
    nickname: '',
    club: { name: 'Mi Club', short: 'MIC', primary: '#d6263b', secondary: '#f2f2f2', crest: 0 },
    seed: 1 + Math.floor(Math.random() * 1_000_000),
    names: {},
    squad: Array.from({ length: SQUAD_SIZE }, (_, i) => `base:${i}`),
    cards: {},
    // Para empezar con algo: un sobre de bienvenida.
    packs: 1,
    opened: 0,
    wins: 0,
    played: 0,
    settings: { ...DEFAULT_SETTINGS, keys: { ...DEFAULT_KEYS } },
  };
}

let cached: Profile | null = null;
const listeners: ((p: Profile) => void)[] = [];

/** Perfil guardado (o uno nuevo). Siempre devuelve uno válido aunque el almacenamiento esté bloqueado. */
export function loadProfile(): Profile {
  if (cached) return cached;
  const base = defaultProfile();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Profile>;
      cached = {
        ...base,
        ...p,
        club: { ...base.club, ...p.club },
        squad: Array.isArray(p.squad) && p.squad.length === SQUAD_SIZE ? p.squad : base.squad,
        cards: p.cards ?? {},
        names: p.names ?? {},
        settings: { ...base.settings, ...p.settings, keys: { ...DEFAULT_KEYS, ...p.settings?.keys } },
      };
      return cached;
    }
  } catch {
    // Sin almacenamiento: perfil nuevo en memoria.
  }
  cached = base;
  return cached;
}

/** Cambia el perfil y lo guarda. */
export function updateProfile(change: (p: Profile) => void): Profile {
  const p = loadProfile();
  change(p);
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Se queda en memoria hasta cerrar la página.
  }
  for (const l of listeners) l(p);
  return p;
}

export function onProfileChange(cb: (p: Profile) => void): void {
  listeners.push(cb);
}

export const settings = (): Settings => loadProfile().settings;

/** Nombre corto de una tecla para mostrar. */
export function keyName(code: string): string {
  if (code === 'Space') return 'ESPACIO';
  if (code === 'Escape') return 'ESC';
  if (code === 'Enter') return 'ENTER';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] ?? code;
  return code.replace('Shift', 'SHIFT ').replace('Control', 'CTRL ').trim();
}

/** ¿Esta tecla es la de la acción? (las flechas cuentan siempre para mover la mira). */
export function isKey(e: KeyboardEvent, action: Action): boolean {
  if (typingIn(e)) return false;
  const code = settings().keys[action];
  if (e.code === code) return true;
  const arrows: Partial<Record<Action, string>> = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  return arrows[action] === e.code;
}

/** Escribiendo en un campo de texto (chat, nombre): las teclas no son del juego. */
export function typingIn(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
