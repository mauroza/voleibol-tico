import { cardById, overallOf } from '../data/cards';
import type { TeamId } from '../sim/court';
import { SPECIALTY_LABELS, type PlayerState } from '../sim/players';
import type { Simulation } from '../sim/rally';
import { ROLE_SHORT, esc, flagSvg, portraitSvg } from './cards-ui';
import { teamBadge } from './hud';
import { ROLE_LABELS } from './menu';

/** Zonas de la cancha como se ven en la planilla: adelante 4-3-2, atrás 5-6-1 (índice en la alineación = zona − 1). */
const FRONT = [4, 3, 2];
const BACK = [5, 6, 1];

const STATS: { key: keyof PlayerState['def']['attrs']; label: string }[] = [
  { key: 'attackPower', label: 'Ataque' },
  { key: 'block', label: 'Bloqueo' },
  { key: 'serve', label: 'Saque' },
  { key: 'reception', label: 'Recepción' },
  { key: 'defense', label: 'Defensa' },
  { key: 'setting', label: 'Colocación' },
  { key: 'jump', label: 'Salto' },
];

/**
 * Alineación al estilo FIFA (como la plantilla de Mi club): la cancha vista desde arriba con las seis cartas en sus
 * zonas, la banca abajo y la ficha del jugador elegido al costado, con sus estadísticas en barras. Las cartas llevan el
 * color de su rareza. Se toca un jugador y después otro para cambiarlos (o se arrastra). Hace falta un colocador.
 */
export class LineupEditor {
  private readonly el = document.createElement('div');
  private readonly box = document.createElement('div');
  private readonly court = document.createElement('div');
  private readonly bench = document.createElement('div');
  private readonly detail = document.createElement('aside');
  private readonly summary = document.createElement('div');
  private readonly info = document.createElement('p');
  private readonly ready = document.createElement('button');
  private lineup: string[] = [];
  private picked: string | null = null;
  /** Jugador cuya ficha se ve al costado. */
  private focus: string | null = null;
  private openKey: string | null = null;
  private drag: { key: string; ghost: HTMLElement; x0: number; y0: number; moved: boolean } | null = null;

  constructor(root: HTMLElement, private readonly sim: Simulation, private readonly team: TeamId) {
    this.el.className = 'overlay lineup';
    this.box.className = 'overlay-box lu-box';
    const t = sim.teams[team];
    const head = document.createElement('header');
    head.className = 'lu-head';
    head.innerHTML = `<span class="lu-crest">${teamBadge(t, 40)}</span><div><h2>Alineación</h2><small>${esc(t.name)}</small></div>`;
    head.append(this.summary);
    this.summary.className = 'lu-summary';
    const hint = document.createElement('p');
    hint.className = 'lu-hint';
    hint.textContent = 'Toca un jugador y después otro para cambiarlos (también puedes arrastrarlos). La zona 1 saca primero.';
    this.court.className = 'lu-court';
    this.bench.className = 'lu-bench';
    this.detail.className = 'lu-detail';
    this.info.className = 'lu-info';
    const actions = document.createElement('div');
    actions.className = 'overlay-actions lu-actions';
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
    benchTitle.className = 'lu-label';
    benchTitle.textContent = 'Líbero y banca';
    const left = document.createElement('div');
    left.className = 'lu-main';
    left.append(this.court, benchTitle, this.bench);
    const body = document.createElement('div');
    body.className = 'lu-body';
    body.append(left, this.detail);
    this.box.append(head, hint, body, this.info, actions);
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
      this.focus = this.lineup[0] ?? null;
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
    this.focus = key;
    if (this.picked === null) this.picked = key;
    else {
      this.swap(this.picked, key);
      this.picked = null;
    }
    this.render();
  }

  /** Rareza de la carta (los jugadores de sobres) o básico. */
  private rarity(p: PlayerState): string {
    const id = p.def.id.startsWith('MC-c-') ? p.def.id.slice(5) : null;
    return id ? cardById(id)?.rarity ?? 'basico' : 'basico';
  }

  private country(p: PlayerState): string | null {
    const id = p.def.id.startsWith('MC-c-') ? p.def.id.slice(5) : null;
    return id ? cardById(id)?.country ?? null : null;
  }

  private render(): void {
    const libero = this.sim.match.libero[this.team];
    this.court.replaceChildren();
    const net = document.createElement('div');
    net.className = 'lu-net';
    net.textContent = 'RED';
    this.court.append(net);
    for (const row of [FRONT, BACK]) {
      const r = document.createElement('div');
      r.className = 'lu-row';
      for (const zone of row) r.append(this.card(this.lineup[zone - 1], `Z${zone}`));
      this.court.append(r);
    }
    const benchKeys = [...this.sim.players.values()]
      .filter((p) => p.team === this.team && !this.lineup.includes(p.key) && p.key !== libero)
      .sort((a, b) => a.def.number - b.def.number)
      .map((p) => p.key);
    this.bench.replaceChildren(...(libero ? [this.card(libero, 'LÍB', true)] : []), ...benchKeys.map((k) => this.card(k, 'BAN')));
    const ok = this.sim.validLineup(this.team, this.lineup);
    this.ready.disabled = !ok;
    this.info.textContent = ok ? '' : 'Necesitas al menos un colocador en la cancha.';
    // Media del equipo en cancha (con el líbero), como en FIFA.
    const six = [...this.lineup, ...(libero ? [libero] : [])].map((k) => overallOf(this.sim.player(k).def));
    const avg = Math.round(six.reduce((a, b) => a + b, 0) / Math.max(1, six.length));
    const hasSetter = this.lineup.some((k) => this.sim.player(k).def.role === 'S');
    this.summary.innerHTML = `<span><b>${avg}</b><small>MEDIA</small></span><span class="${hasSetter ? 'ok' : 'no'}"><b>${hasSetter ? 'SÍ' : 'NO'}</b><small>COLOCADOR</small></span>`;
    this.renderDetail();
  }

  /** Ficha grande del jugador elegido: carta, puesto, fuerte, altura y estadísticas en barras. */
  private renderDetail(): void {
    const key = this.focus ?? this.lineup[0];
    if (!key) return this.detail.replaceChildren();
    const p = this.sim.player(key);
    const t = this.sim.teams[this.team];
    const zone = this.lineup.indexOf(key);
    const where = zone >= 0 ? `Zona ${zone + 1}` : key === this.sim.match.libero[this.team] ? 'Líbero' : 'Banca';
    const flag = this.country(p);
    const bars = STATS.map((s) => {
      const v = p.def.attrs[s.key];
      const level = v >= 80 ? 'high' : v >= 65 ? 'mid' : 'low';
      return `<div class="lu-stat" data-level="${level}"><span>${s.label}</span><i><em style="width:${v}%"></em></i><b>${v}</b></div>`;
    }).join('');
    const pct = Math.round(p.stamina * 100);
    this.detail.className = `lu-detail lu-${this.rarity(p)}`;
    this.detail.innerHTML = `
      <div class="lu-big">
        <div class="lu-big-top"><b>${overallOf(p.def)}</b><small>${ROLE_SHORT[p.def.role]}</small>${flag ? flagSvg(flag) : ''}</div>
        <div class="lu-big-face">${portraitSvg(p.def.skin, p.def.hair, t.primary, t.secondary)}<span>${p.def.number}</span></div>
        <div class="lu-big-name">${esc(p.def.name.split(' ').slice(-1)[0].toUpperCase())}</div>
      </div>
      <div class="lu-facts"><b>${esc(p.def.name)}${p.def.star ? ' ★' : ''}</b>
        <small>${ROLE_LABELS[p.def.role]} · ${where} · ${p.def.height.toFixed(2)} m</small>
        <small>Fuerte: ${SPECIALTY_LABELS[p.def.specialty]}</small>
        <div class="lu-stamina" title="Estamina ${pct}%"><span style="width:${pct}%"></span><small>Estamina ${pct}%</small></div>
      </div>
      <div class="lu-stats">${bars}</div>`;
  }

  /** Carta chica estilo FIFA: media y puesto arriba, cara con el número, apellido y la estamina abajo. */
  private card(key: string, where: string, fixed = false): HTMLElement {
    const p = this.sim.player(key);
    const t = this.sim.teams[this.team];
    const c = document.createElement('button');
    c.className = `lu-card lu-${this.rarity(p)}`;
    c.tabIndex = -1;
    c.dataset.key = key;
    c.classList.toggle('picked', this.picked === key);
    c.classList.toggle('focus', this.focus === key && this.picked !== key);
    c.classList.toggle('fixed', fixed);
    const pct = Math.round(p.stamina * 100);
    const color = p.stamina > 0.6 ? '#5dff8f' : p.stamina > 0.3 ? '#ffd23f' : '#ff4a3a';
    c.innerHTML = `
      <span class="lu-zone">${where}</span>
      <span class="lu-top"><b>${overallOf(p.def)}</b><small>${ROLE_SHORT[p.def.role]}</small></span>
      <span class="lu-face">${portraitSvg(p.def.skin, p.def.hair, t.primary, t.secondary)}<i>${p.def.number}</i></span>
      <span class="lu-name">${esc(p.def.name.split(' ').slice(-1)[0])}</span>
      <span class="lu-bar"><span style="width:${pct}%;background:${color}"></span></span>`;
    c.title = `${p.def.name} · ${ROLE_LABELS[p.def.role]} · estamina ${pct}%`;
    if (fixed) {
      c.addEventListener('click', () => {
        this.focus = key;
        this.render();
      });
    } else {
      c.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        const ghost = c.cloneNode(true) as HTMLElement;
        ghost.classList.add('lu-ghost');
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
    const over = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el instanceof HTMLElement && el.dataset.key && !el.classList.contains('lu-ghost')) as HTMLElement | undefined;
    const target = over?.dataset.key;
    if (target && !over.classList.contains('fixed')) {
      this.swap(d.key, target);
      this.picked = null;
      this.focus = d.key;
      this.render();
    }
  }
}
