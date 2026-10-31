import { CAN_FULLSCREEN, IS_TOUCH, enterMobileMode } from './touch';
import type { TempoProfile } from '../sim/rally';
import { TEAMS, type TeamDef } from '../data/teams';
import type { Role } from '../sim/players';
import type { Difficulty } from '../sim/rally';
import { ACTION_LABELS, DEFAULT_KEYS, keyName, loadProfile, updateProfile, type Action, type Profile, type Settings } from '../data/profile';
import { cardById, cardPlayer, levelBonus, openPack, overallOf, VNL_CARDS, type Card } from '../data/cards';
import { SQUAD_ROLES, basePlayers, clubTeam, squadPlayer } from '../data/club';
import { createRng } from '../sim/rng';
import { audio } from '../audio/music';
import { tutorialView } from './tutorial';
import { CREST_COUNT, CREST_NAMES, crestSvg, icon, initials, type IconName } from './crest';
import { cardEl, esc, playerChip, rarityLevel, ROLE_SHORT } from './cards-ui';
import { teamBadge } from './hud';
import { LEADERBOARD_AVAILABLE, topClubs, type ClubRow } from '../net/leaderboard';

export type Pace = 'calm' | 'normal' | 'real';

/** Velocidad del reloj del juego respecto del tiempo real. */
export const PACE_SPEED: Record<Pace, number> = { calm: 0.8, normal: 1, real: 1 };
/** Ritmo de las decisiones de cada modo: cuánto se frena el tiempo para pensar y golpear. */
export const PACE_TEMPO: Record<Pace, TempoProfile> = { calm: 'clasico', normal: 'fluido', real: 'online' };
const PACE_LABELS: Record<Pace, string> = { calm: 'Tranquilo', normal: 'Fluido', real: 'Rápido' };

/** Índice de equipo para "Mi club" (los demás son los de `TEAMS`). */
export const CLUB = -1;

export interface MatchSetup {
  /** Online 1 vs 1: crear sala o unirse con un código. */
  online?: { mode: 'host' } | { mode: 'join'; code: string };
  team: number;
  rival: number;
  setsToWin: 1 | 2;
  difficulty: Difficulty;
  pace: Pace;
}

export const ROLE_LABELS: Record<Role, string> = {
  S: 'Colocador',
  OH: 'Punta',
  MB: 'Central',
  OP: 'Opuesto',
  L: 'Líbero',
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: 'Fácil', normal: 'Normal', hard: 'Difícil' };

const STYLE_LABELS: Record<string, string> = {
  balanced: 'Equilibrado',
  power: 'Ataque potente',
  block: 'Bloqueo alto',
  defense: 'Defensa',
  serve: 'Saque agresivo',
  fast: 'Juego rápido',
  athletic: 'Atlético',
};

/** Equipo del partido para un índice (`CLUB` = el club del usuario). */
export function teamFor(index: number): TeamDef {
  return index === CLUB ? clubTeam(loadProfile()) : TEAMS[index];
}

const KEY = 'voleibol-tico:setup';
const SCREEN_KEY = 'voleibol-tico:screen';

/** Guarda la configuración para la siguiente carga (revancha o reinicio). */
export function saveSetup(setup: MatchSetup, autostart: boolean, screen?: Screen): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ setup, autostart }));
    if (screen) sessionStorage.setItem(SCREEN_KEY, screen);
  } catch {
    // Sin almacenamiento: se vuelve al menú, que es un comportamiento aceptable.
  }
}

function loadSetup(): { setup: MatchSetup; autostart: boolean } | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const v = JSON.parse(raw) as { setup: MatchSetup; autostart: boolean };
    const ok = (i: number) => i === CLUB || !!TEAMS[i];
    return v.setup && ok(v.setup.team) && TEAMS[v.setup.rival] ? v : null;
  } catch {
    return null;
  }
}

function takeScreen(): Screen | null {
  try {
    const s = sessionStorage.getItem(SCREEN_KEY) as Screen | null;
    sessionStorage.removeItem(SCREEN_KEY);
    return s;
  } catch {
    return null;
  }
}

const DEFAULT: MatchSetup = { team: CLUB, rival: 0, setsToWin: 1, difficulty: 'normal', pace: 'normal' };

type Screen = 'welcome' | 'tutorial' | 'home' | 'solo' | 'online' | 'club' | 'packs' | 'ranking' | 'settings' | 'help';

const ONLINE_AVAILABLE = import.meta.env.MODE !== 'artifact';

/** Elemento con clase y HTML. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html) el.innerHTML = html;
  return el;
}

/** Botón con sonido al pasar y al tocar. */
function button(cls: string, html: string, onClick: () => void, sound: 'click' | 'back' = 'click'): HTMLButtonElement {
  const b = h('button', cls, html);
  b.type = 'button';
  b.addEventListener('pointerenter', () => audio.hover());
  b.addEventListener('click', () => {
    audio.unlock();
    audio[sound]();
    onClick();
  });
  return b;
}

/**
 * Menú principal: pantallas con submenús (jugar solo, online, mi club, sobres, ajustes, cómo jugar). Resuelve con la
 * configuración elegida (o al instante si hay una revancha pendiente).
 */
export function showMenu(root: HTMLElement): Promise<MatchSetup> {
  const saved = loadSetup();
  if (saved?.autostart) return Promise.resolve({ ...DEFAULT, ...saved.setup });
  const setup: MatchSetup = { ...DEFAULT, ...saved?.setup, online: undefined };

  const shell = h('div', 'app-menu');
  shell.innerHTML = '<div class="am-bg"><div class="am-court"></div><div class="am-glow"></div></div>';
  const top = h('header', 'am-top');
  const main = h('main', 'am-main');
  shell.append(top, main);
  root.append(shell);

  let resolveFn: (s: MatchSetup) => void = () => undefined;
  const promise = new Promise<MatchSetup>((resolve) => { resolveFn = resolve; });
  // La música arranca con el primer gesto (el navegador no deja sonar antes).
  const startMusic = () => {
    audio.unlock();
    audio.play();
  };
  window.addEventListener('pointerdown', startMusic, { once: true });
  window.addEventListener('keydown', startMusic, { once: true });

  const launch = (s: MatchSetup) => {
    audio.setMatch(true);
    enterMobileMode();
    shell.remove();
    resolveFn(s);
  };

  // La primera vez (o si nunca vio el tutorial) entra al tutorial después de crear el perfil.
  let screen: Screen = loadProfile().nickname ? takeScreen() ?? (loadProfile().tutorial ? 'home' : 'tutorial') : 'welcome';
  const go = (s: Screen) => {
    screen = s;
    render();
  };

  const renderTop = () => {
    const p = loadProfile();
    top.replaceChildren();
    if (screen === 'welcome' || screen === 'tutorial') return;
    const brand = button('am-brand', '<b>VOLEIBOL</b><span>TICO</span>', () => go('home'), 'back');
    const club = button('am-clubchip', `${crestSvg(p.club, 30)}<div><b>${esc(p.club.name)}</b><small>${icon('user', 12)} ${esc(p.nickname)}</small></div>`, () => go('club'));
    const packs = button('am-packchip', `${icon('pack', 18)}<b>${p.packs}</b>`, () => go('packs'));
    packs.title = 'Sobres por abrir';
    packs.classList.toggle('has', p.packs > 0);
    const right = h('div', 'am-top-right');
    right.append(packs, club);
    top.append(brand, right);
  };

  const render = () => {
    renderTop();
    main.replaceChildren();
    main.className = `am-main screen-${screen}`;
    const view = {
      welcome: welcomeScreen,
      tutorial: tutorialScreen,
      home: homeScreen,
      solo: soloScreen,
      online: onlineScreen,
      club: clubScreen,
      packs: packsScreen,
      settings: settingsScreen,
      help: helpScreen,
      ranking: rankingScreen,
    }[screen]();
    view.classList.add('am-enter');
    main.append(view);
  };

  /** Encabezado de una pantalla secundaria: volver + título. */
  const heading = (title: string, sub = ''): HTMLElement => {
    const el = h('div', 'am-heading');
    el.append(button('am-back', `${icon('back', 22)}`, () => go('home'), 'back'));
    el.append(h('div', '', `<h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}`));
    return el;
  };

  // ---------- bienvenida ----------
  const welcomeScreen = (): HTMLElement => {
    const p = loadProfile();
    const el = h('section', 'am-welcome');
    el.innerHTML = `<div class="am-logo"><b>VOLEIBOL</b><span>TICO</span></div>
      <p class="am-tag">Primera división · Liga de Naciones · Sobres</p>`;
    const card = h('div', 'am-panel am-welcome-card');
    card.innerHTML = '<h3>Crea tu perfil</h3><p>Tu apodo de jugador y el nombre de tu club. Puedes cambiarlos cuando quieras en Mi club.</p>';
    const nick = field('Apodo', p.nickname, 16, 'Ej. Mauro');
    const name = field('Nombre del club', p.club.name === 'Mi Club' ? '' : p.club.name, 22, 'Ej. Deportivo Volcán');
    const err = h('p', 'am-error');
    const go2 = button('am-cta', `Empezar ${icon('play', 18)}`, () => {
      const n = nick.input.value.trim();
      const c = name.input.value.trim();
      if (n.length < 2) {
        err.textContent = 'Escribe un apodo (2 letras o más).';
        nick.input.focus();
        return;
      }
      updateProfile((pp) => {
        pp.nickname = n;
        if (c) {
          pp.club.name = c;
          pp.club.short = initials(c);
        }
      });
      go(loadProfile().tutorial ? 'home' : 'tutorial');
    });
    card.append(nick.el, name.el, err, go2);
    el.append(card);
    setTimeout(() => nick.input.focus(), 50);
    return el;
  };

  // ---------- tutorial ----------
  const tutorialScreen = (): HTMLElement => {
    const seen = () => updateProfile((pp) => { pp.tutorial = true; });
    return tutorialView(() => {
      seen();
      go('home');
    }, () => {
      seen();
      // Práctica: tu club contra un equipo de primera, IA fácil, un set.
      launch({ ...setup, team: CLUB, rival: 0, difficulty: 'easy', setsToWin: 1, online: undefined });
    });
  };

  // ---------- inicio ----------
  const homeScreen = (): HTMLElement => {
    const p = loadProfile();
    const el = h('section', 'am-home');
    const hero = h('div', 'am-hero');
    hero.innerHTML = `<div class="am-logo"><b>VOLEIBOL</b><span>TICO</span></div>
      <p class="am-tag">Hola, <b>${esc(p.nickname)}</b> · ${p.wins} ${p.wins === 1 ? 'victoria' : 'victorias'} · ${Object.keys(p.cards).length} cartas</p>`;
    // iPhone no deja poner una página en pantalla completa: como app (desde la pantalla de inicio) sí.
    const standalone = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    if (IS_TOUCH && !CAN_FULLSCREEN && !standalone && ONLINE_AVAILABLE) {
      hero.append(h('p', 'am-install', `${icon('expand', 14)} Para jugar en pantalla completa: <b>Compartir → Agregar a inicio</b> y ábrelo desde ese ícono.`));
    }
    const list = h('nav', 'am-list');
    const item = (ic: IconName, title: string, sub: string, to: () => void, extra = '') => {
      const b = button('am-item', `<span class="am-item-ic">${icon(ic, 26)}</span><span class="am-item-txt"><b>${title}</b><small>${sub}</small></span>${extra}<span class="am-item-go">${icon('back', 18)}</span>`, to);
      list.append(b);
      return b;
    };
    item('solo', 'Jugar', 'Contra la IA · tu club o un equipo de primera', () => go('solo'));
    const on = item('online', 'Online 1 vs 1', ONLINE_AVAILABLE ? 'Crea una sala o únete con un código' : 'Solo en el sitio del juego (mauroza.github.io)', () => go('online'));
    if (!ONLINE_AVAILABLE) on.classList.add('soon');
    item('club', 'Mi club', 'Nombre, escudo, colores y plantilla', () => go('club'));
    item('pack', 'Sobres', p.packs ? `Tienes ${p.packs} por abrir` : 'Gana partidos para conseguir sobres', () => go('packs'), p.packs ? `<span class="am-badge">${p.packs}</span>` : '');
    item('trophy', 'Tabla de clubes', LEADERBOARD_AVAILABLE ? 'Los clubes de todos los jugadores y sus victorias' : 'Solo en el sitio del juego (mauroza.github.io)', () => go('ranking'));
    item('settings', 'Ajustes', 'Sonido, controles, sensibilidad, FPS', () => go('settings'));
    item('tutorial', 'Tutorial', 'Aprende todas las mecánicas paso a paso', () => go('tutorial'));
    item('help', 'Cómo jugar', 'Resumen de controles y jugadas', () => go('help'));
    // Teclado: flechas para moverse por el menú.
    list.addEventListener('keydown', (e) => {
      const items = [...list.querySelectorAll('button')];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length];
        next.focus();
        audio.hover();
      }
    });
    setTimeout(() => (list.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true }), 30);
    const showcase = h('div', 'am-showcase');
    const best = Object.keys(p.cards).map((id) => cardById(id)).filter((c): c is Card => !!c).sort((a, b) => b.overall - a.overall).slice(0, 3);
    const shown = best.length ? best : [VNL_CARDS[0], VNL_CARDS[2], VNL_CARDS[4]];
    shown.forEach((c, i) => {
      const card = cardEl(c, { copies: p.cards[c.id], shirt: p.club.primary, trim: p.club.secondary });
      card.style.setProperty('--i', String(i));
      showcase.append(card);
    });
    if (!best.length) showcase.append(h('p', 'am-showcase-note', 'Figuras de la VNL te esperan en los sobres'));
    const left = h('div', 'am-home-left');
    left.append(hero, list);
    el.append(left, showcase);
    return el;
  };

  // ---------- jugar solo ----------
  const soloScreen = (): HTMLElement => {
    const p = loadProfile();
    const el = h('section', 'am-solo');
    el.append(heading('Jugar', 'Partido contra la IA. Si ganas, te llevas un sobre.'));
    const grid = h('div', 'am-cols');
    const pick = (title: string, selected: number, choose: (i: number) => void, withClub: boolean, disabled: number | null) => {
      const box = h('div', 'am-panel');
      box.append(h('h3', '', title));
      const list = h('div', 'am-teams');
      const opts: { i: number; name: string; sub: string; crest: string; color: string }[] = [];
      if (withClub) opts.push({ i: CLUB, name: p.club.name, sub: `Tu club · media ${teamOverall(clubTeam(p))}`, crest: crestSvg(p.club, 38), color: p.club.primary });
      TEAMS.forEach((t, i) => opts.push({ i, name: t.name, sub: `${t.province} · ${STYLE_LABELS[t.style]} · media ${teamOverall(t)}`, crest: teamBadge(t, 38), color: t.primary }));
      for (const o of opts) {
        const b = button('am-team', `${o.crest}<span><b>${esc(o.name)}</b><small>${o.sub}</small></span>`, () => { choose(o.i); render(); });
        b.style.setProperty('--c1', o.color);
        b.classList.toggle('active', o.i === selected);
        b.disabled = o.i === disabled;
        list.append(b);
      }
      box.append(list);
      return box;
    };
    grid.append(
      pick('Tu equipo', setup.team, (i) => {
        setup.team = i;
        if (setup.rival === i) setup.rival = (Math.max(0, i) + 1) % TEAMS.length;
      }, true, null),
      pick('Rival', setup.rival, (i) => { setup.rival = i; }, false, setup.team),
    );
    const opts = h('div', 'am-panel am-options');
    opts.append(
      row('Formato', segmented([
        { label: '1 set', active: setup.setsToWin === 1, pick: () => { setup.setsToWin = 1; render(); } },
        { label: 'Mejor de 3', active: setup.setsToWin === 2, pick: () => { setup.setsToWin = 2; render(); } },
      ])),
      row('Dificultad', segmented((Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map((d) => ({
        label: DIFFICULTY_LABELS[d], active: setup.difficulty === d, pick: () => { setup.difficulty = d; render(); },
      })))),
      row('Ritmo', segmented((Object.keys(PACE_LABELS) as Pace[]).map((pp) => ({
        label: PACE_LABELS[pp], active: setup.pace === pp, pick: () => { setup.pace = pp; render(); },
      })))),
    );
    const play = button('am-cta big', `${icon('play', 22)} Jugar`, () => launch({ ...setup, online: undefined }));
    el.append(grid, opts, play);
    return el;
  };

  // ---------- online ----------
  const onlineScreen = (): HTMLElement => {
    const p = loadProfile();
    const el = h('section', 'am-online');
    el.append(heading('Online 1 vs 1', 'Cada uno juega con su club. El que crea la sala elige el formato y el ritmo.'));
    if (!ONLINE_AVAILABLE) {
      const box = h('div', 'am-panel');
      box.innerHTML = '<h3>Disponible en el sitio del juego</h3><p>Desde aquí la página no puede conectarse a internet. Para jugar online abre <b>mauroza.github.io/voleibol-tico</b>.</p>';
      el.append(box);
      return el;
    }
    const me = h('div', 'am-panel am-versus');
    me.innerHTML = `${crestSvg(p.club, 64)}<div><small>Juegas con</small><b>${esc(p.club.name)}</b><span>DT ${esc(p.nickname)} · media ${teamOverall(clubTeam(p))}</span></div>`;
    const cols = h('div', 'am-cols');
    const host = h('div', 'am-panel');
    host.append(h('h3', '', 'Crear sala'), h('p', 'am-muted', 'Te damos un código para que tu rival entre.'));
    host.append(
      row('Formato', segmented([
        { label: '1 set', active: setup.setsToWin === 1, pick: () => { setup.setsToWin = 1; render(); } },
        { label: 'Mejor de 3', active: setup.setsToWin === 2, pick: () => { setup.setsToWin = 2; render(); } },
      ])),
      row('Ritmo', segmented((Object.keys(PACE_LABELS) as Pace[]).map((pp) => ({
        label: PACE_LABELS[pp], active: setup.pace === pp, pick: () => { setup.pace = pp; render(); },
      })))),
      button('am-cta', `${icon('online', 20)} Crear sala`, () => launch({ ...setup, team: CLUB, online: { mode: 'host' } })),
    );
    const join = h('div', 'am-panel');
    join.append(h('h3', '', 'Unirse'), h('p', 'am-muted', 'Escribe el código que te pasó tu rival.'));
    const code = field('Código', '', 8, 'TICO42');
    code.input.classList.add('am-code');
    const err = h('p', 'am-error');
    const tryJoin = () => {
      const value = code.input.value.trim().toUpperCase();
      if (value.length < 4) {
        err.textContent = 'El código tiene 6 letras y números.';
        code.input.focus();
        return;
      }
      launch({ ...setup, team: CLUB, online: { mode: 'join', code: value } });
    };
    code.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryJoin(); });
    join.append(code.el, err, button('am-cta', `${icon('play', 18)} Unirse`, tryJoin));
    cols.append(host, join);
    el.append(me, cols, h('p', 'am-note', 'Los dos con la ventana del juego a la vista. En la partida puedes escribir en el chat con ENTER.'));
    return el;
  };

  // ---------- mi club ----------
  let clubTab: 'squad' | 'identity' | 'collection' = 'squad';
  const clubScreen = (): HTMLElement => {
    const p = loadProfile();
    const el = h('section', 'am-club');
    el.append(heading('Mi club', `DT ${esc(p.nickname)} · media del equipo ${teamOverall(clubTeam(p))}`));
    el.append(tabs([['squad', 'Plantilla'], ['identity', 'Escudo y nombre'], ['collection', 'Colección']], clubTab, (t) => { clubTab = t as typeof clubTab; render(); }));
    if (clubTab === 'identity') el.append(identityEditor(p));
    else if (clubTab === 'collection') el.append(collectionView(p));
    else el.append(squadEditor(p));
    return el;
  };

  const identityEditor = (p: Profile): HTMLElement => {
    const box = h('div', 'am-identity');
    const preview = h('div', 'am-panel am-crest-preview');
    const paint = () => {
      const c = loadProfile().club;
      preview.innerHTML = `${crestSvg(c, 140)}<b>${esc(c.name)}</b><small>${esc(c.short)}</small>`;
      renderTop();
    };
    const form = h('div', 'am-panel');
    const name = field('Nombre del club', p.club.name, 22);
    const short = field('Siglas (3 letras)', p.club.short, 3);
    name.input.addEventListener('input', () => {
      updateProfile((pp) => {
        // Las siglas siguen al nombre mientras no las hayas cambiado a mano.
        const auto = pp.club.short === initials(pp.club.name || 'Mi Club');
        pp.club.name = name.input.value;
        if (auto) pp.club.short = initials(name.input.value || 'Mi Club');
      });
      short.input.value = loadProfile().club.short;
      paint();
    });
    short.input.addEventListener('input', () => { updateProfile((pp) => { pp.club.short = short.input.value.toUpperCase(); }); paint(); });
    const nick = field('Tu apodo (DT)', p.nickname, 16);
    nick.input.addEventListener('change', () => { if (nick.input.value.trim().length >= 2) updateProfile((pp) => { pp.nickname = nick.input.value.trim(); }); renderTop(); });
    const palette = ['#d6263b', '#c8102e', '#1f4e9c', '#2a7fd4', '#0f7a3d', '#1e7d32', '#f28c00', '#f2c500', '#7a2bd6', '#e5197d', '#111827', '#f2f2f2', '#6b2a12', '#14b8a6'];
    const swatches = (which: 'primary' | 'secondary') => {
      const wrap = h('div', 'am-swatches');
      for (const c of palette) {
        const b = button('am-swatch', '', () => { updateProfile((pp) => { pp.club[which] = c; }); render(); });
        b.style.background = c;
        b.classList.toggle('active', loadProfile().club[which] === c);
        b.title = c;
        wrap.append(b);
      }
      const custom = document.createElement('input');
      custom.type = 'color';
      custom.className = 'am-swatch-custom';
      custom.value = loadProfile().club[which];
      custom.addEventListener('change', () => { updateProfile((pp) => { pp.club[which] = custom.value; }); render(); });
      wrap.append(custom);
      return wrap;
    };
    const crests = h('div', 'am-crests');
    for (let i = 0; i < CREST_COUNT; i++) {
      const b = button('am-crest-opt', `${crestSvg({ ...loadProfile().club, crest: i }, 54)}<small>${CREST_NAMES[i]}</small>`, () => { updateProfile((pp) => { pp.club.crest = i; }); render(); });
      b.classList.toggle('active', loadProfile().club.crest === i);
      crests.append(b);
    }
    form.append(name.el, short.el, nick.el, row('Color principal', swatches('primary')), row('Color secundario', swatches('secondary')), row('Escudo', crests));
    box.append(preview, form);
    paint();
    return box;
  };

  let picking: number | null = null;
  const squadEditor = (p: Profile): HTMLElement => {
    const box = h('div', 'am-squad');
    const bases = basePlayers(p);
    const court = h('div', 'am-panel am-squad-court');
    court.append(h('h3', '', 'Titulares'));
    const bench = h('div', 'am-panel am-squad-bench');
    bench.append(h('h3', '', 'Líbero y banca'));
    const slots = h('div', 'am-slots six');
    const rest = h('div', 'am-slots');
    SQUAD_ROLES.forEach((role, i) => {
      const ref = p.squad[i];
      const pl = squadPlayer(p, ref, bases) ?? bases[i];
      const card = ref.startsWith('card:') ? cardById(ref.slice(5)) : null;
      const slot = button(`am-slot${picking === i ? ' active' : ''}`, '', () => { picking = picking === i ? null : i; render(); });
      slot.append(h('span', 'am-slot-role', `${ROLE_SHORT[role]}${i < 6 ? ` · P${i + 1}` : ''}`));
      const ovr = card ? card.overall + levelBonus(p.cards[card.id] ?? 1) : overallOf(pl);
      slot.append(playerChip(pl, ovr, card ? card.rarity : 'basico', p.club.primary, p.club.secondary));
      (i < 6 ? slots : rest).append(slot);
    });
    court.append(slots);
    bench.append(rest);
    box.append(court, bench);
    if (picking !== null) box.append(pickerFor(p, picking, bases));
    else box.append(h('p', 'am-note', 'Toca un puesto para cambiar al jugador: ahí van las cartas de los sobres de ese puesto. También puedes cambiarle el nombre a tus jugadores básicos.'));
    return box;
  };

  const pickerFor = (p: Profile, slot: number, bases: ReturnType<typeof basePlayers>): HTMLElement => {
    const role = SQUAD_ROLES[slot];
    const box = h('div', 'am-panel am-picker');
    box.append(button('am-picker-close', icon('close', 18), () => { picking = null; render(); }, 'back'));
    box.append(h('h3', '', `Elige ${ROLE_LABELS[role].toLowerCase()} para el puesto ${slot < 6 ? `P${slot + 1}` : slot === 6 ? 'de líbero' : 'de la banca'}`));
    const list = h('div', 'am-pick-list');
    const used = new Set(p.squad.filter((_, i) => i !== slot));
    const options: { ref: string; label: HTMLElement }[] = [];
    const base = bases[slot];
    options.push({ ref: `base:${slot}`, label: playerChip(base, overallOf(base), 'basico', p.club.primary, p.club.secondary) });
    for (const id of Object.keys(p.cards)) {
      const card = cardById(id);
      if (!card || card.role !== role || used.has(`card:${id}`)) continue;
      const pl = cardPlayer(card, `x-${id}`, p.cards[id]);
      options.push({ ref: `card:${id}`, label: playerChip(pl, card.overall + levelBonus(p.cards[id]), card.rarity, p.club.primary, p.club.secondary) });
    }
    options.sort((a, b) => Number(b.label.querySelector('.pchip-ovr')!.textContent) - Number(a.label.querySelector('.pchip-ovr')!.textContent));
    for (const o of options) {
      const b = button(`am-pick${p.squad[slot] === o.ref ? ' active' : ''}`, '', () => {
        updateProfile((pp) => { pp.squad[slot] = o.ref; });
        picking = null;
        render();
      });
      b.append(o.label);
      list.append(b);
    }
    box.append(list);
    if (options.length === 1) box.append(h('p', 'am-muted', `Todavía no tienes cartas de ${ROLE_LABELS[role].toLowerCase()}. ¡Abre sobres!`));
    // Renombrar al básico de este puesto.
    const rename = field(`Nombre del básico (${ROLE_LABELS[role].toLowerCase()})`, base.name, 26);
    rename.input.addEventListener('change', () => {
      const v = rename.input.value.trim();
      updateProfile((pp) => {
        if (v) pp.names[`base:${slot}`] = v;
        else delete pp.names[`base:${slot}`];
      });
      render();
    });
    box.append(rename.el);
    return box;
  };

  const collectionView = (p: Profile): HTMLElement => {
    const box = h('div', 'am-collection');
    const ids = Object.keys(p.cards);
    const owned = ids.map((id) => cardById(id)).filter((c): c is Card => !!c).sort((a, b) => b.overall - a.overall);
    const vnlOwned = owned.filter((c) => c.rarity !== 'promesa').length;
    box.append(h('p', 'am-note', `${owned.length} cartas · ${vnlOwned} de ${VNL_CARDS.length} figuras de la VNL. Las repetidas suben la media de la carta (hasta +4).`));
    const grid = h('div', 'am-card-grid');
    for (const c of owned) grid.append(cardEl(c, { copies: p.cards[c.id], shirt: p.club.primary, trim: p.club.secondary, small: true }));
    if (!owned.length) grid.append(h('p', 'am-muted', 'Aún no tienes cartas. Abre tu sobre de bienvenida en Sobres.'));
    box.append(grid);
    return box;
  };

  // ---------- sobres ----------
  const packsScreen = (): HTMLElement => {
    const p = loadProfile();
    const el = h('section', 'am-packs');
    el.append(heading('Sobres', 'Cada victoria te da un sobre con un jugador: verde promesa, azul internacional, morado épico o dorado increíble.'));
    const stage = h('div', 'am-pack-stage');
    const pack = h('div', `am-pack${p.packs ? '' : ' empty'}`, `<div class="am-pack-face">${crestSvg({ short: 'VNL', primary: '#14213d', secondary: '#f6c445', crest: 5 }, 90)}<b>SOBRE</b><small>Liga de Naciones</small></div>`);
    const count = h('p', 'am-pack-count', p.packs ? `Tienes <b>${p.packs}</b> ${p.packs === 1 ? 'sobre' : 'sobres'}` : 'No tienes sobres. Gana un partido para conseguir uno.');
    const open = button('am-cta big', `${icon('pack', 22)} Abrir sobre`, () => openOne());
    open.disabled = !p.packs;
    stage.append(pack, count, open);
    el.append(stage);
    const reveal = h('div', 'am-reveal');
    el.append(reveal);
    const openOne = () => {
      if (!loadProfile().packs) return;
      open.disabled = true;
      pack.classList.add('ripping');
      audio.rip();
      const rng = createRng((Date.now() % 1_000_000) + 1);
      const cards = openPack(rng);
      updateProfile((pp) => {
        pp.packs -= 1;
        pp.opened += 1;
        for (const c of cards) pp.cards[c.id] = (pp.cards[c.id] ?? 0) + 1;
      });
      renderTop();
      setTimeout(() => {
        stage.classList.add('done');
        reveal.replaceChildren();
        const prof = loadProfile();
        cards.forEach((c, i) => {
          const slot = h('div', 'am-flip');
          const inner = h('div', 'am-flip-inner');
          const back = h('div', 'am-flip-back', crestSvg({ short: 'VNL', primary: '#14213d', secondary: '#f6c445', crest: 5 }, 70));
          const front = h('div', 'am-flip-front');
          front.append(cardEl(c, { copies: prof.cards[c.id], shirt: prof.club.primary, trim: prof.club.secondary }));
          if ((prof.cards[c.id] ?? 0) > 1) front.append(h('span', 'am-dup', 'Repetida · +1'));
          else front.append(h('span', 'am-new', '¡Nueva!'));
          inner.append(back, front);
          slot.append(inner);
          reveal.append(slot);
          setTimeout(() => {
            slot.classList.add('flipped', `r-${c.rarity}`);
            audio.reveal(rarityLevel(c.rarity));
          }, 500 + i * 650);
        });
        setTimeout(() => {
          const actions = h('div', 'am-reveal-actions');
          actions.append(
            button('am-ghost', `${icon('club', 18)} Ir a la plantilla`, () => { clubTab = 'squad'; go('club'); }),
            button('am-cta', loadProfile().packs ? `${icon('pack', 18)} Abrir otro` : `${icon('back', 18)} Volver`, () => (loadProfile().packs ? render() : go('home'))),
          );
          reveal.append(actions);
        }, 500 + cards.length * 650 + 300);
      }, 900);
    };
    return el;
  };

  // ---------- ajustes ----------
  let settingsTab: 'audio' | 'controls' | 'graphics' = 'audio';
  let capturing: Action | null = null;
  const settingsScreen = (): HTMLElement => {
    const s = loadProfile().settings;
    const el = h('section', 'am-settings');
    el.append(heading('Ajustes', 'Se guardan en este navegador.'));
    el.append(tabs([['audio', 'Sonido'], ['controls', 'Controles'], ['graphics', 'Gráficos']], settingsTab, (t) => { settingsTab = t as typeof settingsTab; capturing = null; render(); }));
    const box = h('div', 'am-panel am-settings-box');
    const set = (change: (st: Settings) => void, rerender = false) => {
      updateProfile((pp) => change(pp.settings));
      audio.applyVolumes();
      if (rerender) render();
    };
    if (settingsTab === 'audio') {
      box.append(
        slider('Música', s.music, 0, 1, 0.05, (v) => set((st) => { st.music = v; }), pct),
        slider('Efectos del partido', s.sfx, 0, 1, 0.05, (v) => set((st) => { st.sfx = v; }), pct),
        slider('Sonidos del menú', s.ui, 0, 1, 0.05, (v) => { set((st) => { st.ui = v; }); audio.click(); }, pct),
      );
    } else if (settingsTab === 'graphics') {
      box.append(
        row('Límite de FPS', segmented(([0, 30, 60, 120] as const).map((f) => ({ label: f ? `${f}` : 'Sin límite', active: s.fps === f, pick: () => set((st) => { st.fps = f; }, true) })))),
        h('p', 'am-muted', '30 o 60 ahorran batería y calientan menos el teléfono; sin límite usa la frecuencia de tu pantalla.'),
        row('Calidad', segmented((['alta', 'media', 'baja'] as const).map((q) => ({ label: q[0].toUpperCase() + q.slice(1), active: s.quality === q, pick: () => set((st) => { st.quality = q; }, true) })))),
        h('p', 'am-muted', 'Media y baja dibujan a menor resolución: más fluido en teléfonos y tablets.'),
      );
    } else {
      box.append(
        row('Mouse', segmented([
          { label: 'Directo', active: s.mouseMode === 'directo', pick: () => set((st) => { st.mouseMode = 'directo'; }, true) },
          { label: 'Relativo', active: s.mouseMode === 'relativo', pick: () => set((st) => { st.mouseMode = 'relativo'; }, true) },
        ])),
        h('p', 'am-muted', s.mouseMode === 'directo' ? 'La mira va donde está el cursor.' : 'La mira se mueve con el mouse como en un trackpad (la sensibilidad cuenta).'),
        slider('Sensibilidad del mouse', s.mouseSens, 0.3, 2.5, 0.05, (v) => set((st) => { st.mouseSens = v; }), times),
        slider('Sensibilidad táctil', s.touchSens, 0.3, 2.5, 0.05, (v) => set((st) => { st.touchSens = v; }), times),
        slider('Velocidad con teclado / control', s.keySens, 0.3, 2.5, 0.05, (v) => set((st) => { st.keySens = v; }), times),
      );
      const keys = h('div', 'am-keys');
      keys.append(h('h3', '', 'Teclas'));
      for (const a of Object.keys(ACTION_LABELS) as Action[]) {
        const b = button(`am-key${capturing === a ? ' capturing' : ''}`, `<span>${ACTION_LABELS[a]}</span><kbd>${capturing === a ? 'Presiona una tecla…' : keyName(s.keys[a])}</kbd>`, () => { capturing = a; render(); });
        keys.append(b);
      }
      keys.append(button('am-ghost', 'Restablecer teclas', () => set((st) => { st.keys = { ...DEFAULT_KEYS }; }, true), 'back'));
      keys.append(h('p', 'am-muted', 'Las flechas siempre mueven la mira, además de las teclas que elijas.'));
      box.append(keys);
    }
    el.append(box);
    return el;
  };
  // Captura de tecla para los controles.
  window.addEventListener('keydown', (e) => {
    if (!capturing || !shell.isConnected) return;
    e.preventDefault();
    const action = capturing;
    capturing = null;
    if (e.code !== 'Escape' || action === 'pause') updateProfile((pp) => {
      // Si la tecla ya era de otra acción, se intercambian.
      const other = (Object.keys(pp.settings.keys) as Action[]).find((k) => pp.settings.keys[k] === e.code);
      if (other) pp.settings.keys[other] = pp.settings.keys[action];
      pp.settings.keys[action] = e.code;
    });
    audio.click();
    render();
  }, true);

  // ---------- tabla de clubes ----------
  const rankingScreen = (): HTMLElement => {
    const p = loadProfile();
    const el = h('section', 'am-ranking');
    el.append(heading('Tabla de clubes', 'Todos los clubes creados por los jugadores. Cuentan los partidos con tu club, contra la IA u online.'));
    const box = h('div', 'am-panel am-ranking-box');
    el.append(box);
    if (!LEADERBOARD_AVAILABLE) {
      box.innerHTML = '<h3>Disponible en el sitio del juego</h3><p>Desde aquí la página no puede conectarse a internet. La tabla está en <b>mauroza.github.io/voleibol-tico</b>.</p>';
      return el;
    }
    const status = h('p', 'am-muted', 'Cargando la tabla…');
    box.append(status);
    const draw = (rows: ClubRow[]) => {
      box.replaceChildren();
      const head = h('div', 'am-rank-row am-rank-head', '<span>#</span><span>Club</span><span title="Partidos jugados">PJ</span><span title="Partidos ganados">PG</span><span title="Porcentaje de victorias">%</span><span title="Ganados online">Online</span>');
      box.append(head);
      if (!rows.length) box.append(h('p', 'am-muted', 'Todavía no hay clubes. ¡Juega un partido con tu club y sé el primero!'));
      let mineShown = false;
      rows.forEach((r, i) => {
        const mine = r.id === p.cloudId;
        mineShown ||= mine;
        const pct = r.played ? Math.round((r.wins / r.played) * 100) : 0;
        const row = h('div', `am-rank-row${mine ? ' mine' : ''}${i < 3 ? ` top${i + 1}` : ''}`);
        row.innerHTML = `<span class="am-rank-pos">${i + 1}</span>
          <span class="am-rank-club">${crestSvg({ short: r.short, primary: r.primary_color, secondary: r.secondary_color, crest: r.crest }, 34)}<span><b>${esc(r.name)}</b><small>DT ${esc(r.nickname)}${mine ? ' · tú' : ''}</small></span></span>
          <span>${r.played}</span><span class="am-rank-wins">${r.wins}</span><span>${pct}%</span><span>${r.online_wins}</span>`;
        box.append(row);
      });
      if (!mineShown) box.append(h('p', 'am-note', p.played ? 'Tu club aparece cuando entra entre los 100 primeros.' : 'Juega un partido con tu club para aparecer en la tabla.'));
      box.append(button('am-ghost am-rank-refresh', 'Actualizar', () => render()));
    };
    topClubs().then(draw).catch(() => {
      status.textContent = 'No se pudo cargar la tabla. Revisa tu conexión a internet.';
      box.append(button('am-ghost', 'Reintentar', () => render()));
    });
    return el;
  };

  // ---------- cómo jugar ----------
  const helpScreen = (): HTMLElement => {
    const k = (a: Action) => `<kbd>${keyName(loadProfile().settings.keys[a])}</kbd>`;
    const el = h('section', 'am-help');
    el.append(heading('Cómo jugar'));
    el.append(button('am-cta am-help-tut', `${icon('tutorial', 18)} Ver el tutorial paso a paso`, () => go('tutorial')));
    const box = h('div', 'am-panel am-help-box');
    box.innerHTML = `
      <div class="am-help-grid">
        <article><h4>Tu turno</h4><p>Cuando la pelota viene a tu jugador, el tiempo casi se detiene: apunta con calma y golpea con ${k('hit')} o clic. En teléfono, arrastra el dedo en la <b>mitad izquierda</b> y golpea con el botón grande.</p></article>
        <article><h4>Saque</h4><p>La barra es la fuerza: <span class="c-green">verde suave y seguro</span>, <span class="c-red">rojo potente</span>, la puntita <span class="c-purple">morada es ace</span>.</p></article>
        <article><h4>Recepción</h4><p>Apunta a dónde dejarla y golpea cuando la marca pase por la zona verde (cambia de lugar cada vez). Doble positiva = puedes jugar rápidas.</p></article>
        <article><h4>Colocación</h4><p>Apunta al aro del atacante: pegado a la red o despegado (abre el ángulo); detrás de la línea de 3 m, los zagueros. La barra es el tempo: <span class="c-green">alta (3)</span>, <span class="c-yellow">media (2)</span>, <span class="c-red">rápida (1)</span>. El rival bloquea de 3, 2 o 1.</p></article>
        <article><h4>Remate</h4><p>La sombra roja en la cancha es el bloqueo: apunta fuera de ella. La barra es la fuerza; cerca de la red en verde es finta.</p></article>
        <article><h4>Bloqueo y defensa</h4><p>Salta con ${k('hit')} un poco antes del golpe. Mueve la <span class="c-blue">marca de defensa</span> a donde esperas el remate.</p></article>
        <article><h4>Banca</h4><p>${k('timeout')} pide tiempo (ahí haces cambios) · ${k('challenge')} challenge · ${k('pause')} pausa · ${k('mute')} silencio · Shift+F acelera x4.</p></article>
        <article><h4>Sobres y club</h4><p>Cada victoria da un sobre con figuras de la VNL. Ponlas en tu plantilla en Mi club; las repetidas suben su media.</p></article>
      </div>`;
    el.append(box);
    return el;
  };

  render();
  return promise;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const times = (v: number) => `${v.toFixed(2)}×`;

function teamOverall(t: TeamDef): number {
  const starters = t.lineup.map((id) => t.roster.find((p) => p.id === id)!).concat(t.roster.filter((p) => p.id === t.libero));
  return Math.round(starters.reduce((s, p) => s + overallOf(p), 0) / starters.length);
}

function field(label: string, value: string, max: number, placeholder = ''): { el: HTMLElement; input: HTMLInputElement } {
  const el = h('label', 'am-field');
  el.append(h('span', '', label));
  const input = document.createElement('input');
  input.value = value;
  input.maxLength = max;
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  el.append(input);
  return { el, input };
}

function row(label: string, content: HTMLElement): HTMLElement {
  const el = h('div', 'am-row');
  el.append(h('span', 'am-row-label', label), content);
  return el;
}

function tabs(items: [string, string][], active: string, pick: (t: string) => void): HTMLElement {
  const el = h('div', 'am-tabs');
  for (const [id, label] of items) {
    const b = button(`am-tab${id === active ? ' active' : ''}`, label, () => pick(id));
    el.append(b);
  }
  return el;
}

function slider(label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void, fmt: (v: number) => string): HTMLElement {
  const el = h('label', 'am-slider');
  const out = h('output', '', fmt(value));
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const paint = () => input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
  paint();
  input.addEventListener('input', () => {
    out.textContent = fmt(Number(input.value));
    paint();
  });
  input.addEventListener('change', () => onChange(Number(input.value)));
  el.append(h('span', '', label), input, out);
  return el;
}

function segmented(items: { label: string; active: boolean; pick: () => void }[]): HTMLElement {
  const wrap = h('div', 'segmented');
  for (const it of items) {
    const b = button(it.active ? 'active' : '', it.label, it.pick);
    wrap.append(b);
  }
  return wrap;
}
