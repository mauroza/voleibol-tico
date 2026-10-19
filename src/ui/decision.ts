import type { Zone } from '../sim/actions';
import { serveMeter, type Decision, type DecisionKind } from '../sim/decision';
import type { Simulation } from '../sim/rally';
import type { Timing } from '../sim/resolver';
import { TUNING } from '../sim/tuning';

const TITLES: Record<DecisionKind, string> = {
  serve: 'Saque',
  pass: 'Recepción',
  set: 'Colocación',
  attack: 'Ataque',
  block: 'Bloqueo',
};

const FEEDBACK: Record<Timing, string> = { perfect: '¡Perfecto!', good: 'Bien', bad: 'Tarde' };

/** Zonas en el orden visual de la cancha rival vista desde el saque: delantera 4-3-2, zaga 5-6-1. */
const ZONE_LAYOUT: Zone[] = [4, 3, 2, 5, 6, 1];

/** Panel de decisión: botones contextuales (teclas 1–6 o clic) y medidor de timing (espacio o clic). */
export class DecisionPanel {
  private readonly el = document.createElement('div');
  private readonly title = document.createElement('div');
  private readonly buttons = document.createElement('div');
  private readonly zones = document.createElement('div');
  private readonly meter = document.createElement('div');
  private readonly marker = document.createElement('div');
  private readonly goodZone = this.zoneBar('good');
  private readonly perfectZone = this.zoneBar('perfect');
  private readonly hint = document.createElement('div');
  private readonly feedback = document.createElement('div');
  private shown: Decision | null = null;
  private shownChosen: number | null = null;
  private shownZone: Zone | null = null;
  private feedbackUntil = 0;

  constructor(root: HTMLElement, private readonly sim: Simulation) {
    this.el.className = 'decision';
    this.title.className = 'decision-title';
    this.buttons.className = 'decision-buttons';
    this.zones.className = 'decision-zones';
    this.meter.className = 'meter';
    this.marker.className = 'meter-marker';
    this.hint.className = 'decision-hint';
    this.feedback.className = 'feedback';
    this.meter.append(this.goodZone, this.perfectZone, this.marker);
    this.meter.addEventListener('click', () => sim.press());
    this.el.append(this.title, this.buttons, this.zones, this.meter, this.hint);
    root.append(this.el, this.feedback);

    window.addEventListener('keydown', (e) => this.onKey(e));
    sim.bus.on((e) => {
      if (e.type === 'decisionResolved') {
        this.feedback.textContent = FEEDBACK[e.timing];
        this.feedback.dataset.timing = e.timing;
        this.feedbackUntil = performance.now() + 1000;
      }
    });
  }

  update(): void {
    const d = this.sim.decision;
    this.feedback.style.opacity = performance.now() < this.feedbackUntil ? '1' : '0';
    if (!d) {
      this.el.style.display = 'none';
      this.shown = null;
      return;
    }
    this.el.style.display = 'block';
    if (d !== this.shown || d.chosen !== this.shownChosen || d.zone !== this.shownZone) this.rebuild(d);
    this.marker.style.left = `${(this.meterValue(d) * 100).toFixed(1)}%`;
  }

  private onKey(e: KeyboardEvent): void {
    const d = this.sim.decision;
    if (!d) return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.sim.press();
      return;
    }
    const n = Number(e.key);
    if (!Number.isInteger(n) || n < 1) return;
    if (d.kind === 'serve' && d.chosen !== null && n <= 6) this.sim.setServeZone(n as Zone);
    else this.sim.choose(n - 1);
  }

  private rebuild(d: Decision): void {
    this.shown = d;
    this.shownChosen = d.chosen;
    this.shownZone = d.zone;
    this.title.textContent = TITLES[d.kind];
    this.buttons.replaceChildren(
      ...d.options.map((o, i) => {
        const b = document.createElement('button');
        b.textContent = `${i + 1}  ${o.label}`;
        b.classList.toggle('chosen', d.chosen === i);
        b.addEventListener('click', () => this.sim.choose(i));
        return b;
      }),
    );
    const zoning = d.kind === 'serve' && d.chosen !== null;
    this.zones.style.display = zoning ? 'grid' : 'none';
    if (zoning) {
      this.zones.replaceChildren(
        ...ZONE_LAYOUT.map((z) => {
          const b = document.createElement('button');
          b.textContent = `Zona ${z}`;
          b.classList.toggle('chosen', d.zone === z);
          b.addEventListener('click', () => this.sim.setServeZone(z));
          return b;
        }),
      );
    }
    this.meter.style.visibility = d.chosen === null ? 'hidden' : 'visible';
    const [perfect, good] = d.kind === 'serve'
      ? [0.12, 0.32]
      : [TUNING.decision.perfectWindow / TUNING.decision.slowWindow, TUNING.decision.goodWindow / TUNING.decision.slowWindow];
    this.perfectZone.style.width = `${(perfect * 100).toFixed(1)}%`;
    this.goodZone.style.width = `${(good * 100).toFixed(1)}%`;
    this.hint.textContent = d.chosen === null
      ? `Elige con 1–${d.options.length} o clic`
      : d.kind === 'serve'
        ? 'Zona con 1–6 · ESPACIO cuando el marcador llegue al verde'
        : 'ESPACIO justo cuando la pelota llegue (zona verde)';
  }

  /** 0..1: posición del marcador. Llega a 1 en el instante ideal. */
  private meterValue(d: Decision): number {
    if (d.kind === 'serve') return serveMeter(this.sim.time - d.startTime);
    const left = d.contactTime! - this.sim.time;
    return Math.min(1, Math.max(0, 1 - left / TUNING.decision.slowWindow));
  }

  private zoneBar(kind: 'good' | 'perfect'): HTMLElement {
    const z = document.createElement('div');
    z.className = `meter-zone ${kind}`;
    return z;
  }
}
