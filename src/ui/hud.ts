import type { TeamDef } from '../data/teams';
import type { TeamId } from '../sim/court';
import type { Simulation } from '../sim/rally';
import { crestSvg, initials } from './crest';
import { Narrator } from './narrator';

/** Escudo y siglas de un equipo (el club del usuario trae los suyos; los de primera, por su lugar en la lista). */
export function teamBadge(t: TeamDef, size: number): string {
  return crestSvg({ short: t.short ?? initials(t.name), primary: t.primary, secondary: t.secondary, crest: t.crest ?? 0 }, size);
}

/**
 * Marcador del partido arriba al centro, como en la tele: escudo, siglas, sets y puntos de cada equipo, quién saca
 * y el número de set. Los comentarios ("¡Qué remate!") salen aparte, debajo, y se van solos: nada de texto encimado.
 */
export class Hud {
  private readonly el = document.createElement('div');
  private readonly toast = document.createElement('div');
  private readonly narrator = new Narrator();
  private readonly cells: Record<TeamId, { points: HTMLElement; sets: HTMLElement; serve: HTMLElement; side: HTMLElement }>;
  private readonly setLabel = document.createElement('div');
  private shown = '';
  private toastUntil = 0;

  constructor(root: HTMLElement, private readonly sim: Simulation) {
    this.el.className = 'scoreboard';
    const side = (team: TeamId) => {
      const t = sim.teams[team];
      const wrap = document.createElement('div');
      wrap.className = `sb-team sb-${team}`;
      wrap.style.setProperty('--c', t.primary);
      const badge = document.createElement('span');
      badge.className = 'sb-crest';
      badge.innerHTML = teamBadge(t, 26);
      const name = document.createElement('span');
      name.className = 'sb-name';
      name.textContent = (t.short ?? initials(t.name)).toUpperCase();
      name.title = t.name;
      const sets = document.createElement('span');
      sets.className = 'sb-sets';
      const serve = document.createElement('span');
      serve.className = 'sb-serve';
      const points = document.createElement('span');
      points.className = 'sb-points';
      if (team === 'A') wrap.append(badge, name, sets, serve, points);
      else wrap.append(points, serve, sets, name, badge);
      return { el: wrap, cells: { points, sets, serve, side: wrap } };
    };
    const a = side('A');
    const b = side('B');
    this.cells = { A: a.cells, B: b.cells };
    this.setLabel.className = 'sb-set';
    this.el.append(a.el, this.setLabel, b.el);
    this.toast.className = 'score-toast';
    root.append(this.el, this.toast);
    // El equipo propio se marca (en online, cada uno ve el suyo).
    if (sim.control) this.cells[sim.control].side.classList.add('mine');
    sim.bus.on((e) => {
      if (e.type === 'point') this.say(`${this.narrator.phrase(e.reason)} · punto ${sim.teams[e.winner].name}`);
      if (e.type === 'setEnd') this.say(`Set para ${sim.teams[e.winner].name}`, 3500);
      if (e.type === 'matchEnd') this.say(`¡${sim.teams[e.winner].name} gana el partido!`, 6000);
      if (e.type === 'point') this.bump(e.winner);
    });
  }

  private say(text: string, ms = 2600): void {
    this.toast.textContent = text;
    this.toast.classList.add('on');
    this.toastUntil = performance.now() + ms;
  }

  /** El número del que anotó salta un momento. */
  private bump(team: TeamId): void {
    const el = this.cells[team].points;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  update(): void {
    const { points, sets, serving } = this.sim.match;
    const setNo = sets.A + sets.B + 1;
    const key = `${points.A}|${points.B}|${sets.A}|${sets.B}|${serving}|${setNo}`;
    if (key !== this.shown) {
      this.shown = key;
      for (const t of ['A', 'B'] as const) {
        this.cells[t].points.textContent = String(points[t]);
        this.cells[t].sets.textContent = String(sets[t]);
        this.cells[t].serve.classList.toggle('on', serving === t);
      }
      this.setLabel.textContent = `SET ${setNo}`;
    }
    if (this.toastUntil && performance.now() > this.toastUntil) {
      this.toastUntil = 0;
      this.toast.classList.remove('on');
    }
  }
}
