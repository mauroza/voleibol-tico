import { contactMeter, serveMeter, type Decision, type DecisionKind, type Power } from '../sim/decision';
import type { Simulation } from '../sim/rally';
import type { Timing } from '../sim/resolver';
import { TUNING } from '../sim/tuning';
import { ROLE_LABELS } from './menu';

const TITLES: Record<DecisionKind, string> = {
  serve: 'Saque',
  pass: 'Recepción',
  set: 'Colocación',
  attack: 'Ataque',
  block: 'Bloqueo',
};

const AIM_TITLES: Record<DecisionKind, string> = {
  serve: 'Saque apuntado',
  pass: 'Pase dirigido',
  set: 'Colocación',
  attack: 'Remate apuntado',
  block: 'Bloqueo',
};

const MOVE = 'Apunta con el mouse o flechas/WASD';
const HINTS: Record<DecisionKind, (d: Decision) => string> = {
  serve: () => `${MOVE} · clic o ESPACIO: la barra es la fuerza (verde seguro · amarillo flotado · rojo en salto)`,
  pass: () => `${MOVE} dónde dejar la pelota · clic o ESPACIO justo cuando llegue (zona verde)`,
  set: (d) => (d.aim
    ? 'Apunta al atacante (aros en la cancha) · la barra es el tempo: verde alta · amarillo media · rojo rápida · clic o ESPACIO coloca · más allá de la red = segunda'
    : `Tiempo detenido: elige con 1–${d.options.length} o clic`),
  attack: () => `${MOVE} · clic o ESPACIO: cuanto más tarde, más fuerte (verde suave · amarillo · rojo potente) · cerca de la red = finta`,
  block: (d) => (d.chosen === null
    ? `Elige bloqueo con 1–${d.options.length} · mueve la marca de defensa (azul) a donde esperas el remate`
    : 'Mueve la marca de defensa · ESPACIO al saltar (zona verde)'),
};

const POWER_FEEDBACK: Record<Power, string> = { soft: 'Suave', medium: 'Fuerte', strong: '¡POTENTE!' };
const FEEDBACK: Record<Timing, string> = { perfect: '¡Perfecto!', good: 'Bien', bad: 'Tarde' };

/** Panel de decisión: botones contextuales (teclas 1–6 o clic) y medidor de timing (espacio o clic). */
export class DecisionPanel {
  private readonly el = document.createElement('div');
  private readonly title = document.createElement('div');
  private readonly buttons = document.createElement('div');
  private readonly meter = document.createElement('div');
  private readonly marker = document.createElement('div');
  private readonly goodZone = this.zoneBar('good');
  private readonly perfectZone = this.zoneBar('perfect');
  private readonly hint = document.createElement('div');
  private readonly feedback = document.createElement('div');
  private shown: Decision | null = null;
  private shownChosen: number | null = null;
  private shownPreview: number | null = null;
  private readonly tempo = document.createElement('div');
  private feedbackUntil = 0;
  /** En pausa no se aceptan elecciones ni timing. */
  paused = false;

  /** `clock(eventTimeStamp)` traduce el instante real de un evento al tiempo de simulación (entre cuadros). */
  constructor(root: HTMLElement, private readonly sim: Simulation, private readonly clock: (stamp: number) => number = () => sim.time) {
    this.el.className = 'decision';
    this.title.className = 'decision-title';
    this.buttons.className = 'decision-buttons';
    this.meter.className = 'meter';
    this.marker.className = 'meter-marker';
    this.hint.className = 'decision-hint';
    this.feedback.className = 'feedback';
    this.tempo.className = 'meter-tempo';
    for (const t of ['ALTA', 'MEDIA', 'RÁPIDA']) {
      const span = document.createElement('span');
      span.textContent = t;
      this.tempo.append(span);
    }
    this.meter.append(this.goodZone, this.perfectZone, this.tempo, this.marker);
    this.meter.addEventListener('click', (e) => { if (!this.paused) sim.press(this.clock(e.timeStamp)); });
    this.el.append(this.title, this.buttons, this.meter, this.hint);
    root.append(this.el, this.feedback);

    window.addEventListener('keydown', (e) => this.onKey(e));
    sim.bus.on((e) => {
      if (e.type === 'decisionResolved') {
        this.feedback.textContent = e.label ?? (e.power ? POWER_FEEDBACK[e.power] : FEEDBACK[e.timing]);
        this.feedback.dataset.timing = e.power ? `power-${e.power}` : e.timing;
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
    const preview = this.sim.setPreview;
    if (d !== this.shown || d.chosen !== this.shownChosen || preview !== this.shownPreview) this.rebuild(d);
    this.marker.style.left = `${(this.meterValue(d) * 100).toFixed(1)}%`;
  }

  private onKey(e: KeyboardEvent): void {
    const d = this.sim.decision;
    if (!d || this.paused) return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.sim.press(this.clock(e.timeStamp));
      return;
    }
    const n = Number(e.key);
    if (!Number.isInteger(n) || n < 1) return;
    this.sim.choose(n - 1);
  }

  private rebuild(d: Decision): void {
    this.shown = d;
    this.shownChosen = d.chosen;
    this.shownPreview = this.sim.setPreview;
    const p = this.sim.player(d.playerKey);
    this.title.textContent = d.kind === 'block' ? TITLES.block : `${AIM_TITLES[d.kind]} · #${p.def.number} ${ROLE_LABELS[p.def.role]}${p.def.star ? ' ★ figura' : ''}`;
    this.buttons.replaceChildren(
      ...d.options.map((o, i) => {
        const b = document.createElement('button');
        b.textContent = `${i + 1}  ${o.label}`;
        b.classList.toggle('chosen', (d.kind === 'set' && d.aim ? this.sim.setPreview : d.chosen) === i);
        b.addEventListener('click', () => this.sim.choose(i));
        return b;
      }),
    );
    this.meter.style.visibility = d.chosen === null ? 'hidden' : 'visible';
    // Barra de fuerza (saque y remate): verde suave, amarillo medio, rojo muy fuerte. Si no, zona de timing.
    const power = d.meter === 'power';
    this.meter.classList.toggle('power', power);
    // Colocación: la barra es el tempo.
    this.tempo.style.display = d.kind === 'set' && d.aim ? 'flex' : 'none';
    this.meter.style.setProperty('--medium', `${TUNING.power.medium * 100}%`);
    this.meter.style.setProperty('--strong', `${TUNING.power.strong * 100}%`);
    this.perfectZone.style.display = this.goodZone.style.display = power ? 'none' : 'block';
    this.perfectZone.style.width = `${((TUNING.decision.perfectWindow / TUNING.decision.slowWindow) * 100).toFixed(1)}%`;
    this.goodZone.style.width = `${((TUNING.decision.goodWindow / TUNING.decision.slowWindow) * 100).toFixed(1)}%`;
    // Con mira no hay botones (se apunta en la cancha), salvo el bloqueo: esquema + marca de defensa.
    this.buttons.style.display = d.aim && d.kind !== 'block' && d.kind !== 'set' ? 'none' : 'grid';
    this.buttons.classList.toggle('compact', d.kind === 'set' && !!d.aim);
    this.hint.textContent = HINTS[d.kind](d);
  }

  /** 0..1: posición del marcador. Llega a 1 en el instante ideal. */
  private meterValue(d: Decision): number {
    if (d.kind === 'serve') return serveMeter(this.sim.time - d.startTime);
    return contactMeter(this.sim.time, d.contactTime!);
  }

  private zoneBar(kind: 'good' | 'perfect'): HTMLElement {
    const z = document.createElement('div');
    z.className = `meter-zone ${kind}`;
    return z;
  }
}
