import type { TeamId } from '../sim/court';
import type { BlockFocus, Simulation } from '../sim/rally';

const OPTIONS: { id: BlockFocus; title: string; text: string; block: [number, number] }[] = [
  { id: 'normal', title: 'Equilibrado', text: 'El bloqueo se arma frente al rematador, un poco hacia adentro. Cubre algo de todo.', block: [22, 48] },
  { id: 'line', title: 'Cerrar la línea', text: 'El bloqueo se pone por fuera, sobre la banda: el remate por la línea pega en las manos. Queda libre la diagonal.', block: [6, 32] },
  { id: 'cross', title: 'Cerrar la diagonal', text: 'El bloqueo se mete hacia el centro: tapa el remate cruzado. Queda libre la línea.', block: [36, 62] },
];

/** Diagrama: rematador rival en zona 4, la red, dónde va tu bloqueo y qué remate queda tapado o libre. */
function diagram(block: [number, number], focus: BlockFocus): string {
  const lineOpen = focus !== 'line';
  const crossOpen = focus !== 'cross';
  const arrow = (x2: number, y2: number, open: boolean) =>
    `<path d="M22 24 L${x2} ${y2}" stroke="${open ? '#5dff8f' : '#ff4a5a'}" stroke-width="2.4" stroke-dasharray="${open ? '0' : '4 3'}" marker-end="url(#${open ? 'ok' : 'no'})" opacity="${open ? 1 : 0.8}"/>`;
  return `<svg viewBox="0 0 120 92" class="strat-svg" aria-hidden="true">
    <defs>
      <marker id="ok" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L6 3 L0 6z" fill="#5dff8f"/></marker>
      <marker id="no" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L6 3 L0 6z" fill="#ff4a5a"/></marker>
    </defs>
    <rect x="4" y="4" width="112" height="84" rx="3" fill="#c98b48"/>
    <rect x="4" y="4" width="112" height="40" fill="#b77a3c"/>
    <path d="M4 32 H116 M4 58 H116" stroke="#ffffff66" stroke-width="1"/>
    <rect x="4" y="4" width="112" height="84" rx="3" fill="none" stroke="#fff" stroke-width="1.5"/>
    <rect x="2" y="42.5" width="116" height="3" fill="#0b0f18"/>
    <text x="60" y="13" text-anchor="middle" font-size="7" fill="#fff" font-family="system-ui" font-weight="700" opacity=".8">RIVAL</text>
    <text x="60" y="84" text-anchor="middle" font-size="7" fill="#fff" font-family="system-ui" font-weight="700" opacity=".8">TU CANCHA</text>
    ${arrow(14, 84, lineOpen)}
    ${arrow(104, 80, crossOpen)}
    <circle cx="22" cy="24" r="4.5" fill="#1d3f8f" stroke="#fff" stroke-width="1.2"/>
    <rect x="${block[0]}" y="40" width="${block[1] - block[0]}" height="8" rx="2.5" fill="#e5293e" stroke="#fff" stroke-width="1.2"/>
  </svg>`;
}

/**
 * Estrategia: se planea entre puntos (con la pelota muerta), no en medio de la jugada. Por ahora, hacia dónde va tu
 * bloqueo. Queda puesta para los puntos siguientes hasta que la cambies. Offline pausa mientras está abierta.
 */
export class StrategyPanel {
  open = false;
  readonly button = document.createElement('button');
  private readonly el = document.createElement('div');
  private readonly box = document.createElement('div');

  constructor(root: HTMLElement, private readonly sim: Simulation, private readonly team: TeamId, private readonly onChange: (open: boolean) => void) {
    this.el.className = 'overlay strategy';
    this.box.className = 'overlay-box strategy-box';
    this.el.append(this.box);
    this.el.style.display = 'none';
    this.button.className = 'strategy-button';
    this.button.tabIndex = -1;
    this.button.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.sim.strategyKey(this.team) !== null) this.set(true);
    });
    for (const ev of ['pointerdown', 'click'] as const) this.el.addEventListener(ev, (e) => e.stopPropagation());
    root.append(this.el);
  }

  update(): void {
    const can = this.sim.strategyKey(this.team) !== null;
    const label = { normal: 'Equilibrado', line: 'Cerrar línea', cross: 'Cerrar diagonal' }[this.sim.blockFocus[this.team]];
    const text = `Estrategia · ${label}`;
    if (this.button.textContent !== text) this.button.textContent = text;
    this.button.disabled = !can;
    this.button.title = can ? 'Plan de bloqueo para el próximo punto' : 'Se cambia entre puntos';
    this.button.style.visibility = this.sim.playing ? '' : 'hidden';
    // Si empieza el punto con el panel abierto (online el reloj sigue), se cierra.
    if (this.open && !can) this.set(false);
  }

  private set(open: boolean): void {
    this.open = open;
    this.el.style.display = open ? 'grid' : 'none';
    if (open) this.render();
    this.onChange(open);
  }

  private render(): void {
    const focus = this.sim.blockFocus[this.team];
    const h = document.createElement('h2');
    h.textContent = 'Estrategia de bloqueo';
    const p = document.createElement('p');
    p.className = 'strat-hint';
    p.textContent = 'Planéalo antes del punto: hacia dónde se arma tu bloqueo cuando el rival remata. Queda puesto hasta que lo cambies.';
    const grid = document.createElement('div');
    grid.className = 'strat-grid';
    for (const o of OPTIONS) {
      const b = document.createElement('button');
      b.className = `strat-option${o.id === focus ? ' active' : ''}`;
      b.innerHTML = `${diagram(o.block, o.id)}<b>${o.title}</b><small>${o.text}</small>`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.sim.setStrategy(this.team, o.id);
        // Online la elección llega un instante después: se marca ya en pantalla.
        grid.querySelectorAll('.strat-option').forEach((x) => x.classList.toggle('active', x === b));
      });
      grid.append(b);
    }
    const back = document.createElement('button');
    back.className = 'primary';
    back.textContent = 'Listo';
    back.addEventListener('click', (e) => {
      e.stopPropagation();
      this.set(false);
    });
    const actions = document.createElement('div');
    actions.className = 'overlay-actions';
    actions.append(back);
    this.box.replaceChildren(h, p, grid, actions);
  }
}
