import type { TeamDef } from '../data/teams';
import { settings, updateProfile, type Settings } from '../data/profile';
import { IS_TOUCH } from './touch';
import type { TeamId } from '../sim/court';
import type { MatchStats } from '../sim/stats';

interface Action {
  label: string;
  run: () => void;
  primary?: boolean;
}

function panel(className: string, title: string, actions: Action[]): { el: HTMLDivElement; body: HTMLDivElement } {
  const el = document.createElement('div');
  el.className = `overlay ${className}`;
  const box = document.createElement('div');
  box.className = 'overlay-box';
  const h = document.createElement('h2');
  h.textContent = title;
  const body = document.createElement('div');
  const buttons = document.createElement('div');
  buttons.className = 'overlay-actions';
  for (const a of actions) {
    const b = document.createElement('button');
    b.textContent = a.label;
    b.classList.toggle('primary', !!a.primary);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      a.run();
    });
    buttons.append(b);
  }
  box.append(h, body, buttons);
  el.append(box);
  return { el, body };
}

/** Control deslizante de sensibilidad (0.3× a 3×), guardado en el perfil al soltarlo. */
function sensSlider(label: string, key: keyof Settings): HTMLElement {
  const row = document.createElement('label');
  row.className = 'pause-slider';
  const name = document.createElement('span');
  name.textContent = label;
  const out = document.createElement('output');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0.3';
  input.max = '3';
  input.step = '0.05';
  input.value = String(settings()[key]);
  const paint = () => {
    out.textContent = `${Number(input.value).toFixed(2)}×`;
    input.style.setProperty('--fill', `${((Number(input.value) - 0.3) / 2.7) * 100}%`);
  };
  paint();
  input.addEventListener('input', () => {
    paint();
    updateProfile((p) => { (p.settings[key] as number) = Number(input.value); });
  });
  row.append(name, input, out);
  return row;
}

/** Menú de pausa (Esc, P o Start). */
export class PauseMenu {
  private readonly el: HTMLDivElement;
  open = false;

  constructor(root: HTMLElement, actions: { resume: () => void; restart: () => void; menu: () => void }) {
    const p = panel('pause', 'Pausa', [
      { label: 'Continuar', run: actions.resume, primary: true },
      { label: 'Reiniciar partido', run: actions.restart },
      { label: 'Menú principal', run: actions.menu },
    ]);
    this.el = p.el;
    // Ajustes rápidos sin salir del partido: sensibilidad de la mira (se guarda para los próximos partidos).
    const box = document.createElement('div');
    box.className = 'pause-settings';
    const title = document.createElement('h3');
    title.textContent = 'Sensibilidad de la mira';
    box.append(title);
    const rows: [string, keyof Settings][] = IS_TOUCH
      ? [['Dedo', 'touchSens']]
      : [['Mouse (modo relativo)', 'mouseSens'], ['Teclado / control', 'keySens'], ['Dedo (táctil)', 'touchSens']];
    for (const [label, key] of rows) box.append(sensSlider(label, key));
    p.body.append(box);
    for (const ev of ['pointerdown', 'click'] as const) box.addEventListener(ev, (e) => e.stopPropagation());
    this.el.style.display = 'none';
    root.append(this.el);
  }

  set(open: boolean): void {
    this.open = open;
    this.el.style.display = open ? 'grid' : 'none';
  }
}

/** Pantalla final con marcador de sets y estadísticas. */
export function showResult(
  root: HTMLElement,
  teams: Record<TeamId, TeamDef>,
  winner: TeamId,
  sets: Record<TeamId, number>,
  stats: MatchStats,
  hasUser: boolean,
  actions: { rematch: () => void; menu: () => void; packs?: () => void },
  userTeam: TeamId = 'A',
  reward = '',
): void {
  const won = winner === userTeam;
  const buttons = [
    ...(reward && actions.packs ? [{ label: 'Abrir sobre', run: actions.packs, primary: true }] : []),
    { label: 'Revancha', run: actions.rematch, primary: !reward },
    { label: 'Menú principal', run: actions.menu },
  ];
  const p = panel('result', won ? '¡Ganaste, mae!' : 'Derrota… ¡a la próxima!', buttons);
  const score = document.createElement('div');
  score.className = 'result-score';
  score.innerHTML = `<span style="--c:${teams.A.primary}"></span><b></b><em>${sets.A} – ${sets.B}</em><b></b><span style="--c:${teams.B.primary}"></span>`;
  const names = score.querySelectorAll('b');
  names[0].textContent = teams.A.name;
  names[1].textContent = teams.B.name;

  const table = document.createElement('table');
  table.className = 'result-stats';
  const rows: [string, keyof MatchStats['teams']['A']][] = [
    ['Puntos', 'points'], ['Aces', 'aces'], ['Remates ganadores', 'kills'], ['Tapas', 'blocks'], ['Errores', 'errors'],
  ];
  table.innerHTML = rows.map(([label, k]) => `<tr><td>${stats.teams.A[k]}</td><th>${label}</th><td>${stats.teams.B[k]}</td></tr>`).join('');

  p.body.append(score, table);
  if (reward) {
    const r = document.createElement('p');
    r.className = 'result-reward';
    r.textContent = reward;
    p.body.append(r);
  }
  if (hasUser) {
    const u = stats.user;
    const timed = u.perfect + u.good + u.bad;
    const you = document.createElement('p');
    you.className = 'result-you';
    you.textContent = `Tú: ${u.touches} toques · ${u.perfect} perfectos de ${timed} decisiones · ${u.kills} remates ganadores · ${u.aces} aces · ${u.blocks} tapas`;
    p.body.append(you);
  }
  p.el.style.display = 'grid';
  root.append(p.el);
}
