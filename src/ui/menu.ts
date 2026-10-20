import type { TempoProfile } from '../sim/rally';
import { TEAMS } from '../data/teams';
import type { Role } from '../sim/players';
import type { Difficulty } from '../sim/rally';

export type Pace = 'calm' | 'normal' | 'real';

/** Velocidad del reloj del juego respecto del tiempo real. */
export const PACE_SPEED: Record<Pace, number> = { calm: 0.8, normal: 1, real: 1 };
/** Ritmo de las decisiones de cada modo: cuánto se frena el tiempo para pensar y golpear. */
export const PACE_TEMPO: Record<Pace, TempoProfile> = { calm: 'clasico', normal: 'fluido', real: 'online' };
const PACE_LABELS: Record<Pace, string> = { calm: 'Tranquilo', normal: 'Fluido', real: 'Rápido (online)' };

export interface MatchSetup {
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

const DEFAULT: MatchSetup = { team: 0, rival: 2, setsToWin: 1, difficulty: 'normal', pace: 'normal' };

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
    const coach = document.createElement('p');
    coach.className = 'menu-coach';
    coach.textContent = 'Controlas a todo tu equipo: el saque de cada sacador, los pases, a dónde coloca el colocador, cada remate y el bloqueo.';
    el.append(coach);
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
        <li><b>Colocación en abanico:</b> apunta la mira al aro del atacante y presiona cuando la barra marque el tempo: <span style="color:#5dff8f">verde alta</span>, <span style="color:#ffd23f">amarillo media</span>, <span style="color:#ff3b3b">rojo rápida</span>. Mira más allá de la red = segunda. Las teclas 1–N eligen directo.</li>
        <li>Bloqueo: elige con <b>1–4</b> (o clic) y presiona <b>ESPACIO</b> justo cuando la pelota llegue: zona verde = <b>¡Perfecto!</b></li>
        <li><b>Saque, recepción y remate se apuntan:</b> la cámara se pone detrás del jugador; mueve la mira con el mouse o flechas/WASD y golpea con clic o <b>ESPACIO</b>.</li>
        <li>En el remate la barra es la <b>fuerza</b>: <span style="color:#5dff8f">verde suave</span>, <span style="color:#ffd23f">amarillo fuerte</span>, <span style="color:#ff3b3b">rojo potente</span> (más riesgo). Remate cerca de la red = finta.</li>
        <li>En el saque la barra elige el saque: <span style="color:#5dff8f">verde seguro</span>, <span style="color:#ffd23f">amarillo flotado en salto</span> (la pelota baila), <span style="color:#ff3b3b">rojo en suspensión</span> (lanzamiento alto y golpe de remate).</li>
        <li>Cada jugador tiene su <b>fuerte</b>, una <b>barra de estamina</b> (saltar cansa) y, si anota seguido, se <b style="color:#ff3b3b">enciende</b> con un aura roja. Ritmo: <b>Fluido</b> por defecto; <b>Rápido (online)</b> casi sin cámara lenta.</li>
        <li>Cuando te rematan: elige el bloqueo y pon la <b style="color:#4dc3ff">marca de defensa</b> donde esperas el remate; un compañero la cubre y llega mejor.</li>
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
