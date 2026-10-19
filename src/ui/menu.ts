import { TEAMS } from '../data/teams';
import type { Role } from '../sim/players';
import type { Difficulty } from '../sim/rally';

export type Pace = 'calm' | 'normal' | 'real';

/** Velocidad del reloj del juego respecto del tiempo real. */
export const PACE_SPEED: Record<Pace, number> = { calm: 0.6, normal: 0.8, real: 1 };
const PACE_LABELS: Record<Pace, string> = { calm: 'Tranquilo', normal: 'Normal', real: 'Real' };

export interface MatchSetup {
  team: number;
  rival: number;
  role: Role;
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

const ROLE_HINT: Record<Role, string> = {
  S: 'Decides a quién va cada pelota',
  OH: 'Recibes y rematas por zona 4',
  MB: 'Rápidas y bloqueo',
  OP: 'Potencia por zona 2',
  L: 'Recepción y defensa',
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

const KEY = 'voleibol-tico:setup';

/** Guarda la configuración para la siguiente carga (revancha o reinicio). */
export function saveSetup(setup: MatchSetup, autostart: boolean): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ setup, autostart }));
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
    return v.setup && TEAMS[v.setup.team] && TEAMS[v.setup.rival] ? v : null;
  } catch {
    return null;
  }
}

const DEFAULT: MatchSetup = { team: 0, rival: 2, role: 'OH', setsToWin: 1, difficulty: 'normal', pace: 'normal' };

/** Menú principal. Resuelve con la configuración elegida (o al instante si hay una revancha pendiente). */
export function showMenu(root: HTMLElement): Promise<MatchSetup> {
  const saved = loadSetup();
  if (saved?.autostart) return Promise.resolve({ ...DEFAULT, ...saved.setup });
  const setup: MatchSetup = { ...DEFAULT, ...saved?.setup };

  const el = document.createElement('div');
  el.className = 'menu';
  root.append(el);

  const render = () => {
    el.replaceChildren();
    const h1 = document.createElement('h1');
    h1.innerHTML = 'Voleibol <span>Tico</span>';
    const sub = document.createElement('p');
    sub.className = 'menu-sub';
    sub.textContent = 'Liga de provincias · Partido rápido';
    el.append(h1, sub);

    el.append(section('Tu equipo', teamGrid(setup.team, (i) => {
      setup.team = i;
      if (setup.rival === i) setup.rival = (i + 1) % TEAMS.length;
      render();
    })));
    el.append(section('Rival', teamGrid(setup.rival, (i) => {
      if (i !== setup.team) setup.rival = i;
      render();
    }, setup.team)));
    el.append(section('Tu posición', segmented((Object.keys(ROLE_LABELS) as Role[]).map((r) => ({
      label: ROLE_LABELS[r], hint: ROLE_HINT[r], active: setup.role === r, pick: () => { setup.role = r; render(); },
    })))));
    const row = document.createElement('div');
    row.className = 'menu-row';
    row.append(
      section('Formato', segmented([
        { label: '1 set', active: setup.setsToWin === 1, pick: () => { setup.setsToWin = 1; render(); } },
        { label: 'Mejor de 3', active: setup.setsToWin === 2, pick: () => { setup.setsToWin = 2; render(); } },
      ])),
      section('Dificultad', segmented((Object.keys(DIFFICULTY_LABELS) as Difficulty[]).map((d) => ({
        label: DIFFICULTY_LABELS[d], active: setup.difficulty === d, pick: () => { setup.difficulty = d; render(); },
      })))),
      section('Ritmo', segmented((Object.keys(PACE_LABELS) as Pace[]).map((p) => ({
        label: PACE_LABELS[p], active: setup.pace === p, pick: () => { setup.pace = p; render(); },
      })))),
    );
    el.append(row);

    const how = document.createElement('details');
    how.className = 'menu-how';
    how.innerHTML = `<summary>Cómo jugar</summary>
      <ul>
        <li>Cuando la pelota viene a tu jugador, el tiempo casi se detiene hasta que eliges: piensa con calma.</li>
        <li>Elige con <b>1–4</b> (o clic). En el saque, después eliges la zona con <b>1–6</b>.</li>
        <li>Presiona <b>ESPACIO</b> justo cuando la pelota llegue: zona verde = <b>¡Perfecto!</b></li>
        <li><b>Esc</b> pausa · <b>M</b> silencio · <b>F</b> acelera x4 · Gamepad: cruceta elige, <b>A</b> timing, <b>Start</b> pausa.</li>
      </ul>`;
    el.append(how);

    const play = document.createElement('button');
    play.className = 'menu-play';
    play.textContent = 'Jugar';
    play.addEventListener('click', () => {
      el.remove();
      resolveFn({ ...setup });
    });
    el.append(play);
  };

  let resolveFn: (s: MatchSetup) => void = () => undefined;
  const promise = new Promise<MatchSetup>((resolve) => { resolveFn = resolve; });
  render();
  return promise;
}

function section(title: string, content: HTMLElement): HTMLElement {
  const s = document.createElement('section');
  const h = document.createElement('h2');
  h.textContent = title;
  s.append(h, content);
  return s;
}

function teamGrid(selected: number, pick: (i: number) => void, disabled = -1): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'team-grid';
  TEAMS.forEach((t, i) => {
    const b = document.createElement('button');
    b.className = 'team-card';
    b.classList.toggle('active', i === selected);
    b.disabled = i === disabled;
    b.style.setProperty('--c1', t.primary);
    b.style.setProperty('--c2', t.secondary);
    const name = document.createElement('strong');
    name.textContent = t.name;
    const info = document.createElement('small');
    info.textContent = `${t.province} · ${STYLE_LABELS[t.style]}`;
    b.append(name, info);
    b.addEventListener('click', () => pick(i));
    grid.append(b);
  });
  return grid;
}

function segmented(items: { label: string; hint?: string; active: boolean; pick: () => void }[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'segmented';
  for (const it of items) {
    const b = document.createElement('button');
    b.classList.toggle('active', it.active);
    b.textContent = it.label;
    if (it.hint) b.title = it.hint;
    b.addEventListener('click', it.pick);
    wrap.append(b);
  }
  return wrap;
}
