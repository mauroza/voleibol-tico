import type { TeamId } from '../sim/court';
import { SPECIALTY_LABELS } from '../sim/players';
import type { Simulation } from '../sim/rally';
import { ROLE_LABELS } from './menu';

/**
 * Tiempo y cambios: con la pelota muerta, T (o el botón) pide tiempo y pausa el juego.
 * Se elige un titular y después un suplente para cambiarlo. 2 tiempos y 6 cambios por set.
 */
export class TimeoutPanel {
  open = false;
  private readonly el = document.createElement('div');
  private readonly box = document.createElement('div');
  private readonly button = document.createElement('button');
  private readonly toast = document.createElement('div');
  private picked: string | null = null;
  private toastUntil = 0;

  constructor(root: HTMLElement, private readonly sim: Simulation, private readonly team: TeamId, private readonly onChange: (open: boolean) => void) {
    this.el.className = 'overlay timeout';
    this.box.className = 'overlay-box timeout-box';
    this.el.append(this.box);
    this.el.style.display = 'none';
    this.button.className = 'timeout-button';
    this.button.tabIndex = -1;
    this.button.addEventListener('click', (e) => {
      e.stopPropagation();
      this.request();
    });
    this.toast.className = 'timeout-toast';
    root.append(this.el, this.button, this.toast);
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 't' && !this.open) this.request();
    });
    sim.bus.on((e) => {
      const name = (t: TeamId) => sim.teams[t].name;
      if (e.type === 'timeout' && e.team !== team) this.say(`Tiempo pedido por ${name(e.team)}`);
      if (e.type === 'substitution' && e.team !== team) {
        this.say(`Cambio en ${name(e.team)}: entra #${sim.player(e.inKey).def.number} por #${sim.player(e.outKey).def.number}`);
      }
    });
  }

  update(): void {
    this.button.textContent = `T · Tiempo (${this.sim.timeouts[this.team]}) · Cambios ${this.sim.subsLeft[this.team]}`;
    this.button.disabled = !this.sim.deadBall || this.sim.timeouts[this.team] <= 0;
    this.toast.style.opacity = performance.now() < this.toastUntil ? '1' : '0';
  }

  private request(): void {
    if (!this.sim.deadBall) return this.say('El tiempo se pide entre puntos');
    if (!this.sim.callTimeout(this.team)) return this.say('No te quedan tiempos en este set');
    this.picked = null;
    this.set(true);
  }

  private set(open: boolean): void {
    this.open = open;
    this.el.style.display = open ? 'grid' : 'none';
    if (open) this.render();
    this.onChange(open);
  }

  private say(text: string): void {
    this.toast.textContent = text;
    this.toastUntil = performance.now() + 2200;
  }

  private card(key: string, kind: 'court' | 'bench'): HTMLButtonElement {
    const p = this.sim.player(key);
    const b = document.createElement('button');
    b.className = `sub-card ${kind}`;
    b.classList.toggle('picked', this.picked === key);
    const pct = Math.round(p.stamina * 100);
    const color = p.stamina > 0.6 ? '#5dff8f' : p.stamina > 0.38 ? '#ffd23f' : '#ff4a3a';
    b.innerHTML = `<b>#${p.def.number}</b> <span></span><i>${ROLE_LABELS[p.def.role]} · ${SPECIALTY_LABELS[p.def.specialty]}</i>
      <span class="sub-stamina"><span style="width:${pct}%;background:${color}"></span></span>`;
    b.querySelector('span')!.textContent = p.def.name;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (kind === 'court') this.picked = this.picked === key ? null : key;
      else if (this.picked) {
        if (this.sim.substitute(this.team, this.picked, key)) this.say(`Entra #${p.def.number}`);
        else this.say('No quedan cambios en este set');
        this.picked = null;
      } else this.say('Primero elige al titular que sale');
      this.render();
    });
    return b;
  }

  private render(): void {
    const h = document.createElement('h2');
    h.textContent = `Tiempo · cambios disponibles: ${this.sim.subsLeft[this.team]}`;
    const hint = document.createElement('p');
    hint.className = 'sub-hint';
    hint.textContent = 'Clic en un titular y luego en un suplente para cambiarlo. El tiempo recupera un poco de estamina.';
    const court = document.createElement('div');
    court.className = 'sub-list';
    court.append(...this.sim.match.lineups[this.team].map((k) => this.card(k, 'court')));
    const bench = document.createElement('div');
    bench.className = 'sub-list';
    bench.append(...this.sim.bench(this.team).map((k) => this.card(k, 'bench')));
    const label = (t: string) => {
      const d = document.createElement('div');
      d.className = 'sub-label';
      d.textContent = t;
      return d;
    };
    const back = document.createElement('button');
    back.className = 'primary';
    back.textContent = 'Volver al juego';
    back.addEventListener('click', (e) => {
      e.stopPropagation();
      this.set(false);
    });
    const actions = document.createElement('div');
    actions.className = 'overlay-actions';
    actions.append(back);
    this.box.replaceChildren(h, hint, label('En cancha'), court, label('Banca'), bench, actions);
  }
}
