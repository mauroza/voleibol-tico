import { TEAMS } from '../data/teams';
import type { Role } from '../sim/players';

export interface MatchSetup {
  team: number;
  rival: number;
  role: Role;
  setsToWin: 1 | 2;
}

export const ROLE_LABELS: Record<Role, string> = {
  S: 'Colocador',
  OH: 'Punta',
  MB: 'Central',
  OP: 'Opuesto',
  L: 'Líbero',
};

/** Selección mínima previa al partido (el menú completo llega en la fase 5). */
export function showMenu(root: HTMLElement): Promise<MatchSetup> {
  const form = document.createElement('form');
  form.className = 'menu';
  const select = (label: string, name: string, options: [string, string][], selected: string) => {
    const wrap = document.createElement('label');
    wrap.textContent = label;
    const s = document.createElement('select');
    s.name = name;
    for (const [value, text] of options) s.add(new Option(text, value, false, value === selected));
    wrap.append(s);
    return wrap;
  };
  const teams = TEAMS.map((t, i): [string, string] => [String(i), t.name]);
  const title = document.createElement('h1');
  title.textContent = 'Voleibol Tico';
  const play = document.createElement('button');
  play.type = 'submit';
  play.textContent = 'Jugar';
  form.append(
    title,
    select('Tu equipo', 'team', teams, '0'),
    select('Rival', 'rival', teams, '2'),
    select('Tu posición', 'role', (Object.keys(ROLE_LABELS) as Role[]).map((r) => [r, ROLE_LABELS[r]]), 'OH'),
    select('Formato', 'sets', [['1', '1 set rápido'], ['2', 'Mejor de 3 sets']], '1'),
    play,
  );
  root.append(form);
  return new Promise((resolve) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const team = Number(data.get('team'));
      let rival = Number(data.get('rival'));
      if (rival === team) rival = (team + 1) % TEAMS.length;
      form.remove();
      resolve({ team, rival, role: data.get('role') as Role, setsToWin: data.get('sets') === '2' ? 2 : 1 });
    });
  });
}
