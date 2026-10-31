/**
 * Escudos de los clubes e íconos de la interfaz, dibujados en SVG (nada de emojis: se ven igual en todos lados).
 */

export interface CrestSpec {
  short: string;
  primary: string;
  secondary: string;
  crest: number;
}

export const CREST_NAMES = ['Clásico', 'Franja', 'Balón', 'Galón', 'Círculo', 'Estrella'] as const;
export const CREST_COUNT = CREST_NAMES.length;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const SHIELD = 'M50 4 L92 16 V52 C92 78 72 94 50 100 C28 94 8 78 8 52 V16 Z';
const BALL = '<circle cx="50" cy="44" r="19" fill="none" stroke="currentColor" stroke-width="4"/>'
  + '<path d="M31 44 C40 36 60 36 69 44 M50 25 C42 34 42 54 50 63 M37 30 C48 38 52 52 48 62" fill="none" stroke="currentColor" stroke-width="3.2"/>';

/** SVG del escudo (viewBox 100×106). */
export function crestSvg(c: CrestSpec, size = 64): string {
  const p = esc(c.primary);
  const s = esc(c.secondary);
  const text = esc(c.short.slice(0, 3).toUpperCase());
  const id = `cr${Math.random().toString(36).slice(2, 8)}`;
  const label = `<text x="50" y="${c.crest === 2 ? 88 : 66}" text-anchor="middle" font-family="'Bebas Neue', 'Oswald', system-ui, sans-serif" font-weight="800" font-size="${c.crest === 2 ? 17 : 30}" letter-spacing="1" fill="${s}" stroke="#0b0f18" stroke-width="0.8" paint-order="stroke">${text}</text>`;
  let body: string;
  switch (c.crest % CREST_COUNT) {
    case 1:
      body = `<path d="${SHIELD}" fill="${p}"/><g clip-path="url(#${id})"><path d="M-10 70 L110 10 V34 L-10 94 Z" fill="${s}" opacity="0.9"/></g>`
        + `<rect x="20" y="44" width="60" height="30" rx="4" fill="${p}" opacity="0.85"/>`;
      break;
    case 2:
      body = `<path d="${SHIELD}" fill="${p}"/><g style="color:${s}">${BALL}</g>`;
      break;
    case 3:
      body = `<path d="${SHIELD}" fill="${p}"/><path d="M8 30 L50 52 L92 30 V44 L50 66 L8 44 Z" fill="${s}" clip-path="url(#${id})"/>`
        + `<rect x="22" y="44" width="56" height="30" rx="4" fill="${p}"/>`;
      break;
    case 4:
      body = `<circle cx="50" cy="53" r="46" fill="${s}"/><circle cx="50" cy="53" r="39" fill="${p}"/>`
        + `<circle cx="50" cy="53" r="33" fill="none" stroke="${s}" stroke-width="1.5" stroke-dasharray="3 3"/>`;
      break;
    case 5:
      body = `<path d="${SHIELD}" fill="${p}"/><path d="M50 14 L54 25 L66 25 L56 32 L60 43 L50 36 L40 43 L44 32 L34 25 L46 25 Z" fill="${s}"/>`;
      break;
    default:
      body = `<path d="${SHIELD}" fill="${p}"/><path d="M50 4 L92 16 V30 H8 V16 Z" fill="${s}" opacity="0.95"/>`;
  }
  const rim = c.crest % CREST_COUNT === 4 ? '' : `<path d="${SHIELD}" fill="none" stroke="${s}" stroke-width="3.5"/><path d="${SHIELD}" fill="none" stroke="#0b0f18" stroke-opacity="0.35" stroke-width="1" transform="translate(50 53) scale(0.9) translate(-50 -53)"/>`;
  return `<svg class="crest" width="${size}" height="${size * 1.06}" viewBox="0 0 100 106" role="img" aria-label="Escudo ${text}">`
    + `<defs><clipPath id="${id}"><path d="${SHIELD}"/></clipPath></defs>${body}${rim}${label}</svg>`;
}

/** Siglas de un nombre: "San José" → "SJO", "UCR" → "UCR". */
export function initials(name: string): string {
  const words = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3);
  if (words.length === 2) return (words[0][0] + words[1].slice(0, 2)).slice(0, 3);
  return words.slice(0, 3).map((w) => w[0]).join('');
}

const PATHS: Record<string, string> = {
  play: '<path d="M8 5v14l11-7z"/>',
  tutorial: '<path d="M3 8l9-4 9 4-9 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M7 10.2v4.6c0 1.3 2.2 2.7 5 2.7s5-1.4 5-2.7v-4.6M21 8v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  solo: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.8 11c3-2.2 13.4-2.2 16.4 0M12 3.5c-2.8 3-2.8 14 0 17M6.5 5.6c4.3 1.8 6.4 7.5 4.7 14" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  online: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="19.5" r="1.6"/>',
  club: '<path d="M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8.5 11.5l2.4 2.4 4.6-4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  pack: '<rect x="4" y="3" width="16" height="18" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 8h16" stroke="currentColor" stroke-width="2"/><path d="M12 11l1.4 2.8 3 .4-2.2 2.1.5 3-2.7-1.4-2.7 1.4.5-3-2.2-2.1 3-.4z"/>',
  settings: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.4 13.5l1.8 1.4-2 3.4-2.1-.8a7.7 7.7 0 0 1-2.2 1.3L14.5 21h-4l-.4-2.2A7.7 7.7 0 0 1 8 17.5l-2.1.8-2-3.4 1.8-1.4a7.6 7.6 0 0 1 0-3L3.9 9.1l2-3.4 2.1.8A7.7 7.7 0 0 1 10.1 5.2L10.5 3h4l.4 2.2A7.7 7.7 0 0 1 17 6.5l2.1-.8 2 3.4-1.8 1.4a7.6 7.6 0 0 1 .1 3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  help: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.3 9.3a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.2 1-1.2 1.9v.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.2"/>',
  back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  sound: '<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  mute: '<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  fast: '<path d="M3 6v12l8-6zM12 6v12l8-6z"/>',
  chat: '<path d="M4 5h16v10H9l-5 4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  trophy: '<path d="M7 4h10v4a5 5 0 0 1-10 0z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  user: '<circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21a8 8 0 0 1 16 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  swap: '<path d="M7 7h12l-3-3M17 17H5l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" fill="none" stroke="currentColor" stroke-width="2"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  send: '<path d="M3 11.5L21 4l-7.5 18-2.5-7.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
};

export type IconName = keyof typeof PATHS;

/** Ícono SVG (hereda el color del texto). */
export function icon(name: IconName, size = 20): string {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${PATHS[name]}</svg>`;
}
