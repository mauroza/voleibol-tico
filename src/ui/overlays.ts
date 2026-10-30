import type { TeamDef } from '../data/teams';
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
