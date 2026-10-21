import type { TeamId } from '../sim/court';
import { SPECIALTY_LABELS, type PlayerState } from '../sim/players';
import type { Simulation } from '../sim/rally';
import { ROLE_LABELS } from './menu';

/** Zonas de la cancha como se ven en la planilla: adelante 4-3-2, atrás 5-6-1 (índice en la alineación = zona − 1). */
const FRONT = [4, 3, 2];
const BACK = [5, 6, 1];

const STATS: { key: keyof PlayerState['def']['attrs']; label: string }[] = [
  { key: 'attackPower', label: 'ATQ' },
  { key: 'block', label: 'BLQ' },
  { key: 'serve', label: 'SAQ' },
  { key: 'reception', label: 'REC' },
  { key: 'defense', label: 'DEF' },
  { key: 'setting', label: 'COL' },
  { key: 'jump', label: 'SAL' },
];

/**
 * Alineación al estilo FIFA: una canchita con las seis zonas, el líbero y la banca. Se toca (o arrastra) un jugador y
 * después otro para cambiarlos de lugar; cada carta muestra sus estadísticas y su estamina. Hace falta un colocador.
 */
export class LineupEditor {
  private readonly el = document.createElement('div');
  private readonly box = document.createElement('div');
  private readonly court = document.createElement('div');
  private readonly bench = document.createElement('div');
  private readonly info = document.createElement('p');
  private readonly ready = document.createElement('button');
  private lineup: string[] = [];
  private picked: string | null = null;
  private openKey: string | null = null;
  private drag: { key: string; ghost: HTMLElement; x0: number; y0: number; moved: boolean } | null = null;

  constructor(root: HTMLElement, private readonly sim: Simulation, private readonly team: TeamId) {
    this.el.className = 'overlay lineup';
    this.box.className = 'overlay-box lineup-box';
    const title = document.createElement('h2');
    title.textContent = 'Alineación';
    const hint = document.createElement('p');
    hint.className = 'sub-hint';
    hint.textContent = 'Toca un jugador y después otro para cambiarlos (también puedes arrastrarlos). La zona 1 saca primero.';
    this.court.className = 'lineup-court';
    this.bench.className = 'lineup-bench';
    this.info.className = 'lineup-info';
    const actions = document.createElement('div');
    actions.className = 'overlay-actions lineup-actions';
    const reset = document.createElement('button');
    reset.textContent = 'Recomendada';
    reset.addEventListener('click', () => {
      this.lineup = this.recommended();
      this.picked = null;
      this.render();
    });
    this.ready.className = 'primary';
    this.ready.textContent = '¡Listo, a jugar!';
    this.ready.addEventListener('click', () => {
      if (this.sim.submitLineup(this.team, [...this.lineup])) this.close();
    });
    actions.append(reset, this.ready);
    const benchTitle = document.createElement('div');
    benchTitle.className = 'sub-label';
    benchTitle.textContent = 'Banca';
    this.box.append(title, hint, this.court, benchTitle, this.bench, this.info, actions);
    this.el.append(this.box);
    this.el.style.display = 'none';
    root.append(this.el);
    window.addEventListener('pointermove', (e) => this.onDragMove(e));
    window.addEventListener('pointerup', (e) => this.onDragEnd(e));
  }

  get open(): boolean {
    return this.el.style.display !== 'none';
  }

  update(): void {
    const key = this.sim.lineupKey(this.team);
    if (key && key !== this.openKey) {
      this.openKey = key;
      this.lineup = [...this.sim.match.lineups[this.team]];
      this.picked = null;
      this.el.style.display = 'grid';
      this.render();
    } else if (!key && this.open) this.close();
  }

  private close(): void {
    this.el.style.display = 'none';
    this.drag?.ghost.remove();
    this.drag = null;
  }

  /** La de siempre del equipo (titulares por puesto). */
  private recommended(): string[] {
    const def = this.sim.teams[this.team];
    return def.lineup.map((id) => `${this.team}:${id}`);
  }

  private swap(a: string, b: string): void {
    if (a === b) return;
    const ia = this.lineup.indexOf(a);
    const ib = this.lineup.indexOf(b);
    if (ia >= 0 && ib >= 0) [this.lineup[ia], this.lineup[ib]] = [this.lineup[ib], this.lineup[ia]];
    else if (ia >= 0) this.lineup[ia] = b;
    else if (ib >= 0) this.lineup[ib] = a;
  }

  private tap(key: string): void {
    if (this.picked === null) this.picked = key;
    else {
      this.swap(this.picked, key);
      this.picked = null;
    }
    this.render();
  }

  private render(): void {
    const libero = this.sim.match.libero[this.team];
    this.court.replaceChildren();
    const net = document.createElement('div');
    net.className = 'lineup-net';
    net.textContent = 'RED';
    this.court.append(net);
    for (const row of [FRONT, BACK]) {
      const r = document.createElement('div');
      r.className = 'lineup-row';
      for (const zone of row) r.append(this.card(this.lineup[zone - 1], `Zona ${zone}`));
      this.court.append(r);
    }
    const benchKeys = [...this.sim.players.values()]
      .filter((p) => p.team === this.team && !this.lineup.includes(p.key) && p.key !== libero)
      .sort((a, b) => a.def.number - b.def.number)
      .map((p) => p.key);
    this.bench.replaceChildren(...(libero ? [this.card(libero, 'Líbero', true)] : []), ...benchKeys.map((k) => this.card(k, 'Banca')));
    const ok = this.sim.validLineup(this.team, this.lineup);
    this.ready.disabled = !ok;
    this.info.textContent = ok ? '' : 'Necesitas al menos un colocador en la cancha.';
  }

  private card(key: string, where: string, fixed = false): HTMLElement {
    const p = this.sim.player(key);
    const c = document.createElement('button');
    c.className = 'lineup-card';
    c.tabIndex = -1;
    c.dataset.key = key;
    c.classList.toggle('picked', this.picked === key);
    c.classList.toggle('fixed', fixed);
    c.style.setProperty('--team', this.sim.teams[this.team].primary);
    const head = document.createElement('div');
    head.className = 'lineup-head';
    const num = document.createElement('b');
    num.textContent = String(p.def.number);
    const name = document.createElement('span');
    name.textContent = `${p.def.name}${p.def.star ? ' ★' : ''}`;
    head.append(num, name);
    const meta = document.createElement('small');
    meta.textContent = `${where} · ${ROLE_LABELS[p.def.role]} · ${p.def.height.toFixed(2)} m · fuerte: ${SPECIALTY_LABELS[p.def.specialty]}`;
    const stats = document.createElement('div');
    stats.className = 'lineup-stats';
    for (const s of STATS) {
      const v = p.def.attrs[s.key];
      const cell = document.createElement('span');
      cell.dataset.level = v >= 80 ? 'high' : v >= 65 ? 'mid' : 'low';
      cell.textContent = `${s.label} ${v}`;
      stats.append(cell);
    }
    const stamina = document.createElement('div');
    stamina.className = 'sub-stamina';
    const fill = document.createElement('span');
    fill.style.width = `${Math.round(p.stamina * 100)}%`;
    fill.style.background = p.stamina > 0.6 ? '#5dff8f' : p.stamina > 0.3 ? '#ffd23f' : '#ff4a3a';
    stamina.append(fill);
    c.append(head, meta, stats, stamina);
    if (!fixed) {
      c.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const ghost = c.cloneNode(true) as HTMLElement;
        ghost.classList.add('lineup-ghost');
        this.drag = { key, ghost, x0: e.clientX, y0: e.clientY, moved: false };
      });
    }
    return c;
  }

  private onDragMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 8) {
      d.moved = true;
      document.body.append(d.ghost);
    }
    if (d.moved) {
      d.ghost.style.left = `${e.clientX}px`;
      d.ghost.style.top = `${e.clientY}px`;
    }
  }

  private onDragEnd(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    d.ghost.remove();
    if (!d.moved) return this.tap(d.key);
    const over = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el instanceof HTMLElement && el.dataset.key && !el.classList.contains('lineup-ghost')) as HTMLElement | undefined;
    const target = over?.dataset.key;
    if (target && !over.classList.contains('fixed')) {
      this.swap(d.key, target);
      this.picked = null;
      this.render();
    }
  }
}
