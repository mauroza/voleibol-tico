import { COUNTRY_NAMES, RARITY_LABELS, type Card, type Rarity } from '../data/cards';
import { HAIR_COLORS, SKIN_TONES } from '../render/character';
import type { PlayerDef, Role } from '../sim/players';

/** Texto seguro para meter en HTML (los nombres los escribe el usuario). */
export const esc = (t: string): string => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const ROLE_SHORT: Record<Role, string> = { S: 'COL', OH: 'PUN', MB: 'CEN', OP: 'OPU', L: 'LIB' };

/** Bandera simplificada (SVG 30×20). */
export function flagSvg(code: string): string {
  const h = (colors: string[]) => colors.map((c, i) => `<rect y="${(i * 20) / colors.length}" width="30" height="${20 / colors.length + 0.2}" fill="${c}"/>`).join('');
  const v = (colors: string[]) => colors.map((c, i) => `<rect x="${(i * 30) / colors.length}" width="${30 / colors.length + 0.2}" height="20" fill="${c}"/>`).join('');
  const body: Record<string, string> = {
    JPN: '<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="5.5" fill="#bc002d"/>',
    BRA: '<rect width="30" height="20" fill="#009c3b"/><path d="M15 2.5L27 10 15 17.5 3 10z" fill="#ffdf00"/><circle cx="15" cy="10" r="4.2" fill="#002776"/>',
    BUL: h(['#fff', '#00966e', '#d62612']),
    FRA: v(['#0055a4', '#fff', '#ef4135']),
    POL: h(['#fff', '#dc143c']),
    ITA: v(['#009246', '#fff', '#ce2b37']),
    USA: `${h(['#b22234', '#fff', '#b22234', '#fff', '#b22234', '#fff', '#b22234'])}<rect width="13" height="11" fill="#3c3b6e"/>`,
    ARG: `${h(['#74acdf', '#fff', '#74acdf'])}<circle cx="15" cy="10" r="2.2" fill="#f6b40e"/>`,
    NED: h(['#ae1c28', '#fff', '#21468b']),
    CUB: `${h(['#002a8f', '#fff', '#002a8f', '#fff', '#002a8f'])}<path d="M0 0L13 10 0 20z" fill="#cf142b"/>`,
    SLO: h(['#fff', '#0000ff', '#ff0000']),
    CAN: `${v(['#d52b1e', '#fff', '#fff', '#d52b1e'])}<rect x="12.5" y="6.5" width="5" height="7" fill="#d52b1e"/>`,
    SRB: h(['#c6363c', '#0c4076', '#fff']),
    CRC: '<rect width="30" height="20" fill="#002b7f"/><rect y="3.3" width="30" height="13.4" fill="#fff"/><rect y="6.7" width="30" height="6.6" fill="#ce1126"/>',
  };
  return `<svg class="flag" viewBox="0 0 30 20" width="24" height="16" aria-label="${COUNTRY_NAMES[code] ?? code}">${body[code] ?? '<rect width="30" height="20" fill="#556"/>'}</svg>`;
}

/** Retrato estilizado: cabeza, pelo y hombros con la camisa. */
export function portraitSvg(skin: number, hair: number, shirt: string, trim: string): string {
  const s = SKIN_TONES[Math.max(0, Math.min(SKIN_TONES.length - 1, skin))];
  const shaved = hair >= HAIR_COLORS.length;
  const hc = shaved ? s : HAIR_COLORS[hair];
  return `<svg class="portrait" viewBox="0 0 100 100" aria-hidden="true">
    <path d="M10 100 C12 76 30 68 50 68 C70 68 88 76 90 100 Z" fill="${shirt}"/>
    <path d="M38 70 L50 84 L62 70" fill="none" stroke="${trim}" stroke-width="4"/>
    <rect x="43" y="56" width="14" height="14" rx="5" fill="${s}"/>
    <ellipse cx="50" cy="42" rx="19" ry="22" fill="${s}"/>
    ${shaved ? `<path d="M31 38 C31 22 69 22 69 38 C64 30 36 30 31 38 Z" fill="#00000022"/>` : `<path d="M30 42 C27 18 73 14 70 42 C67 30 58 26 50 27 C42 26 33 30 30 42 Z" fill="${hc}"/>`}
    <circle cx="43" cy="44" r="2.2" fill="#24160f"/><circle cx="57" cy="44" r="2.2" fill="#24160f"/>
    <path d="M45 54 Q50 57 55 54" fill="none" stroke="#24160f" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`;
}

const RARITY_LEVEL: Record<Rarity, number> = { promesa: 0, internacional: 1, elite: 2, leyenda: 3 };
export const rarityLevel = (r: Rarity) => RARITY_LEVEL[r];

/** Carta estilo álbum: media, puesto, bandera, retrato y nombre. */
export function cardEl(card: Card, opts: { copies?: number; shirt?: string; trim?: string; small?: boolean } = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = `vcard vcard-${card.rarity}${opts.small ? ' small' : ''}`;
  const bonus = Math.min(4, Math.max(0, (opts.copies ?? 1) - 1));
  const last = card.name.split(' ').slice(-1)[0];
  el.innerHTML = `
    <div class="vcard-shine"></div>
    <div class="vcard-top">
      <div class="vcard-ovr">${card.overall + bonus}<small>${ROLE_SHORT[card.role]}</small></div>
      ${flagSvg(card.country)}
    </div>
    <div class="vcard-face">${portraitSvg(card.skin, card.hair, opts.shirt ?? '#1d2a4a', opts.trim ?? '#e8eefc')}</div>
    <div class="vcard-name" title="${esc(card.name)}">${esc(last.toUpperCase())}</div>
    <div class="vcard-meta"><span>${esc(card.name.split(' ').slice(0, -1).join(' '))}</span><span>${card.height.toFixed(2)} m</span></div>
    <div class="vcard-rarity">${RARITY_LABELS[card.rarity]}${bonus ? ` · +${bonus}` : ''}</div>`;
  return el;
}

/** Ficha de un jugador del club (básico o carta) para la plantilla. */
export function playerChip(p: PlayerDef, overall: number, rarity: Rarity | 'basico', shirt: string, trim: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `pchip pchip-${rarity}`;
  el.innerHTML = `<div class="pchip-face">${portraitSvg(p.skin, p.hair, shirt, trim)}</div>
    <div class="pchip-info"><b>${esc(p.name.split(' ').slice(-1)[0])}</b><small>${esc(p.name.split(' ').slice(0, -1).join(' ')) || '&nbsp;'}</small></div>
    <div class="pchip-ovr">${overall}</div>`;
  return el;
}
