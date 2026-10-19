import type { PointReason } from '../sim/events';
import type { Simulation } from '../sim/rally';
import { ROLE_LABELS } from './menu';

const REASON_LABEL: Record<PointReason, string> = {
  ace: '¡Ace!',
  kill: '¡Remate ganador!',
  blockKill: '¡Qué tapa!',
  blockOut: '¡Remate tras el bloqueo!',
  landed: 'Pelota al piso',
  serviceError: 'Error de saque',
  attackError: 'Error de ataque',
  error: 'Error',
};

export class Hud {
  private readonly el = document.createElement('div');
  private message = '';

  constructor(root: HTMLElement, private readonly sim: Simulation) {
    this.el.className = 'hud';
    root.appendChild(this.el);
    sim.bus.on((e) => {
      if (e.type === 'point') this.message = `${REASON_LABEL[e.reason]} — punto ${sim.teams[e.winner].name}`;
      if (e.type === 'setEnd') this.message = `Set para ${sim.teams[e.winner].name}`;
      if (e.type === 'matchEnd') this.message = `¡${sim.teams[e.winner].name} gana el partido!`;
    });
  }

  update(): void {
    const { points, sets } = this.sim.match;
    const { A, B } = this.sim.teams;
    this.el.textContent = `${A.name}  ${sets.A}  |  ${points.A} – ${points.B}  |  ${sets.B}  ${B.name}\n${this.userLine()}${this.message}`;
  }

  private userLine(): string {
    const key = this.sim.userKey;
    if (!key) return '';
    const p = this.sim.player(key);
    const bench = this.sim.court(p.team).includes(key) ? '' : ' (en la banca)';
    return `Tú: ${ROLE_LABELS[p.def.role]} #${p.def.number}${bench}\n`;
  }
}
