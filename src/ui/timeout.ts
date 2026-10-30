import { isKey } from '../data/profile';
import type { TeamId } from '../sim/court';
import { SPECIALTY_LABELS } from '../sim/players';
import type { Simulation } from '../sim/rally';
import { ROLE_LABELS } from './menu';
import { IS_TOUCH } from './touch';
import { cardById, overallOf } from '../data/cards';
import { esc, portraitSvg } from './cards-ui';

/**
 * Tiempo y cambios: con la pelota muerta, T (o el botón) pide tiempo (30 s; se puede volver antes). Offline además
 * pausa el juego; online el reloj sigue para los dos, y durante el tiempo de cualquiera los dos pueden hacer cambios.
 * Se elige un titular y después un suplente para cambiarlo. 2 tiempos y 6 cambios por set.
 */
export class TimeoutPanel {
  open = false;
  private readonly el = document.createElement('div');
  private readonly box = document.createElement('div');
  readonly button = document.createElement('button');
  private readonly toast = document.createElement('div');
  private picked: string | null = null;
  private toastUntil = 0;

  constructor(
    root: HTMLElement,
    private readonly sim: Simulation,
    private readonly team: TeamId,
    private readonly onChange: (open: boolean) => void,
    /** Online: el tiempo corre para los dos (no se pausa) y lo que se pide viaja por la red. */
    private readonly online = false,
  ) {
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
      if (isKey(e, 'timeout') && !this.open) this.request();
    });
    sim.bus.on((e) => {
      const name = (t: TeamId) => sim.teams[t].name;
      if (e.type === 'timeout' && e.team !== team) this.say(`Tiempo pedido por ${name(e.team)}${online ? ': puedes hacer cambios (T)' : ''}`);
      // Online los cambios llegan un instante después: se redibuja el panel.
      if (e.type === 'substitution' && this.open) this.render();
      if (e.type === 'substitution' && e.team !== team) {
        this.say(`Cambio en ${name(e.team)}: entra #${sim.player(e.inKey).def.number} por #${sim.player(e.outKey).def.number}`);
      }
    });
  }

  update(): void {
    this.button.textContent = `${IS_TOUCH ? '' : 'T · '}Tiempo (${this.sim.timeouts[this.team]}) · Cambios ${this.sim.subsLeft[this.team]}`;
    const during = !!this.sim.timeoutInfo;
    this.button.disabled = !this.sim.deadBall || (this.sim.timeouts[this.team] <= 0 && !during);
    if (this.open && this.online) {
      // Online: cuenta regresiva del tiempo; al terminar (o al sacar) se cierra solo.
      const info = this.sim.timeoutInfo;
      if (!this.sim.deadBall || (!info && this.called)) this.set(false);
      else if (this.header) this.header.textContent = `${info ? `Tiempo · quedan ${Math.ceil(info.left)} s` : 'Cambios'} · cambios disponibles: ${this.sim.subsLeft[this.team]}`;
    }
    // En la previa y en los cambios de cancha no hay tiempos.
    this.button.style.visibility = this.sim.playing ? '' : 'hidden';
    this.toast.style.opacity = performance.now() < this.toastUntil ? '1' : '0';
  }

  /** Este panel se abrió pidiendo un tiempo propio (no solo para cambios durante el tiempo del rival). */
  private called = false;
  private header: HTMLElement | null = null;

  private request(): void {
    if (!this.sim.deadBall || !this.sim.playing) return this.say('El tiempo se pide entre puntos');
    // Durante el tiempo de cualquiera (online) se puede entrar a hacer cambios sin gastar uno propio.
    if (this.online && this.sim.timeoutInfo) {
      this.called = false;
      this.picked = null;
      return this.set(true);
    }
    if (!this.sim.callTimeout(this.team)) return this.say('No te quedan tiempos en este set');
    this.called = true;
    this.picked = null;
    this.set(true);
  }

  private set(open: boolean): void {
    if (!open && this.open && this.called) this.sim.endTimeout(this.team);
    this.open = open;
    this.el.style.display = open ? 'grid' : 'none';
    if (open) this.render();
    this.onChange(open);
  }

  private say(text: string): void {
    this.toast.textContent = text;
    this.toastUntil = performance.now() + 2200;
  }

  /**
   * Ficha de un jugador como en Mi club: cara con la camisa del equipo, número, apellido, puesto y fuerte, media y
   * estamina. Las cartas de los sobres llevan el color de su rareza.
   */
  private card(key: string, kind: 'court' | 'bench', slot = ''): HTMLButtonElement {
    const p = this.sim.player(key);
    const t = this.sim.teams[this.team];
    const cardId = p.def.id.startsWith('MC-c-') ? p.def.id.slice(5) : null;
    const rarity = cardId ? cardById(cardId)?.rarity ?? 'basico' : 'basico';
    const b = document.createElement('button');
    b.className = `sub-card ${kind} sub-${rarity}`;
    b.classList.toggle('picked', this.picked === key);
    const pct = Math.round(p.stamina * 100);
    const color = p.stamina > 0.6 ? '#5dff8f' : p.stamina > 0.38 ? '#ffd23f' : '#ff4a3a';
    const parts = p.def.name.split(' ');
    b.innerHTML = `${slot ? `<span class="sub-slot">${slot}</span>` : ''}
      <span class="sub-face">${portraitSvg(p.def.skin, p.def.hair, t.primary, t.secondary)}<span class="sub-num">${p.def.number}</span></span>
      <span class="sub-info"><b>${esc(parts[parts.length - 1])}</b><small>${ROLE_LABELS[p.def.role]} · ${SPECIALTY_LABELS[p.def.specialty]}</small>
        <span class="sub-stamina" title="Estamina ${pct}%"><span style="width:${pct}%;background:${color}"></span></span></span>
      <span class="sub-ovr">${overallOf(p.def)}</span>`;
    b.title = `${p.def.name} · estamina ${pct}%`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (kind === 'court') this.picked = this.picked === key ? null : key;
      else if (this.picked) {
        if (this.sim.substitute(this.team, this.picked, key)) this.say(`Entra #${p.def.number} ${p.def.name}`);
        else this.say(this.sim.subsLeft[this.team] <= 0 ? 'No quedan cambios en este set' : 'Ahora no se puede cambiar');
        this.picked = null;
      } else this.say('Primero elige al titular que sale');
      this.render();
    });
    return b;
  }

  private render(): void {
    const h = document.createElement('h2');
    h.textContent = `Tiempo · cambios disponibles: ${this.sim.subsLeft[this.team]}`;
    this.header = h;
    const hint = document.createElement('p');
    hint.className = 'sub-hint';
    hint.textContent = this.picked
      ? `Sale #${this.sim.player(this.picked).def.number}: ahora toca al suplente que entra.`
      : 'Toca un titular y después un suplente para cambiarlo. La barra es la estamina; el número, la media.';
    const court = document.createElement('div');
    court.className = 'sub-list';
    court.append(...this.sim.match.lineups[this.team].map((k, i) => this.card(k, 'court', `P${i + 1}`)));
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
