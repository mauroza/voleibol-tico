import type { Simulation } from '../sim/rally';
import { ROLE_LABELS } from './menu';
import { Narrator } from './narrator';

export class Hud {
  private readonly el = document.createElement('div');
  private message = '';
  private readonly narrator = new Narrator();
  private shown = '';

  constructor(root: HTMLElement, private readonly sim: Simulation) {
    this.el.className = 'hud';
    root.appendChild(this.el);
    sim.bus.on((e) => {
      if (e.type === 'point') this.message = `${this.narrator.phrase(e.reason)} — punto ${sim.teams[e.winner].name}`;
      if (e.type === 'setEnd') this.message = `Set para ${sim.teams[e.winner].name}`;
      if (e.type === 'matchEnd') this.message = `¡${sim.teams[e.winner].name} gana el partido!`;
    });
  }

  update(): void {
    const { points, sets } = this.sim.match;
    const { A, B } = this.sim.teams;
    const text = `${A.name}  ${sets.A}  |  ${points.A} – ${points.B}  |  ${sets.B}  ${B.name}\n${this.userLine()}${this.message}`;
    // Reescribir el DOM solo si cambió: evita recalcular estilos y layout en cada cuadro.
    if (text !== this.shown) {
      this.el.textContent = text;
      this.shown = text;
    }
  }

  private userLine(): string {
    const key = this.sim.userKey;
    if (!key) return '';
    const p = this.sim.player(key);
    const bench = this.sim.court(p.team).includes(key) ? '' : ' (en la banca)';
    return `Tú: ${ROLE_LABELS[p.def.role]} #${p.def.number}${bench}\n`;
  }
}
