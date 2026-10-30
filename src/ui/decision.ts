import { SET_TEMPO } from '../sim/actions';
import { SPECIALTY_LABELS, eliteJump } from '../sim/players';
import { meterOf, type Decision, type DecisionKind, type Power } from '../sim/decision';
import type { Simulation } from '../sim/rally';
import type { Timing } from '../sim/resolver';
import { TUNING } from '../sim/tuning';
import { ROLE_LABELS } from './menu';
import { IS_TOUCH } from './touch';

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
  serve: () => `${MOVE} · clic o ESPACIO: la barra es la fuerza (verde suave y seguro · amarillo · rojo potente · la puntita morada: ¡ace!)`,
  pass: () => `${MOVE} dónde dejar la pelota · clic o ESPACIO justo cuando llegue (zona verde)`,
  set: (d) => (d.aim
    ? 'Apunta al atacante (aros en la cancha) · la barra es el tempo: verde alta · amarillo media · rojo rápida · clic o ESPACIO coloca · más allá de la red = segunda'
    : `Tiempo detenido: elige con 1–${d.options.length} o clic`),
  attack: (d) => d.options[0].option.id === 'free' ? `${MOVE} dónde mandarla · clic o ESPACIO justo cuando llegue (zona verde)` : `${MOVE} · clic o ESPACIO: cuanto más tarde, más fuerte (verde suave · amarillo · rojo potente) · cerca de la red: verde = finta, amarillo/rojo = remate en picada`,
  block: (d) => `${d.options[0].label} (según la colocación) · ESPACIO para saltar: atina el momento, un poco antes del golpe del rematador · mouse: marca de defensa (azul)`,
};

/** En teléfono: sin teclas ni mouse, todo con el dedo y el botón de acción. */
const DRAG = 'Arrastra el dedo en la cancha para apuntar';
const TOUCH_HINTS: Record<DecisionKind, (d: Decision) => string> = {
  serve: () => `${DRAG} · SACAR: la barra es la fuerza (verde seguro · rojo potente · morado: ¡ace!)`,
  pass: () => `${DRAG} · RECIBIR justo cuando llegue (verde)`,
  set: (d) => (d.aim ? 'Apunta al aro del atacante · COLOCAR: verde alta · amarillo media · rojo rápida' : 'Toca una opción'),
  attack: (d) => d.options[0].option.id === 'free' ? `${DRAG} · REMATAR cuando llegue (verde)` : `${DRAG} · REMATAR: más tarde, más fuerte · cerca de la red verde = finta`,
  block: (d) => `${d.options[0].label} · SALTAR un poco antes del golpe · dedo: marca de defensa (azul)`,
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
  private shownPressed = false;
  private readonly tempo = document.createElement('div');
  private feedbackUntil = 0;
  /** En pausa no se aceptan elecciones ni timing. */
  paused = false;
  /** Online: tiempo de simulación entre el último paso y este cuadro (la barra avanza suave, sin saltos). */
  ahead: () => number = () => 0;
  /** Ancho de la barra en px (se mide al armar el panel y al cambiar el tamaño de la ventana). */
  private meterWidth = 0;

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
    window.addEventListener('resize', () => { this.meterWidth = 0; });
    sim.bus.on((e) => {
      if (e.type === 'decisionResolved' && e.team === sim.control) {
        this.feedback.textContent = e.label ?? (e.power ? POWER_FEEDBACK[e.power] : FEEDBACK[e.timing]);
        this.feedback.dataset.timing = e.label?.includes('ACE') ? 'ace' : e.power ? `power-${e.power}` : e.timing;
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
    if (d !== this.shown || d.chosen !== this.shownChosen || preview !== this.shownPreview || (d.pressedAt !== null) !== this.shownPressed) this.rebuild(d);
    // Se desplaza con transform (lo mueve la GPU, sin recalcular la página): la línea corre suave, sin trabarse.
    if (!this.meterWidth) this.meterWidth = this.meter.clientWidth;
    this.marker.style.transform = `translate3d(${(this.meterValue(d) * this.meterWidth).toFixed(1)}px, 0, 0)`;
  }

  private onKey(e: KeyboardEvent): void {
    const d = this.sim.decision;
    if (!d || this.paused) return;
    if (e.code === 'Space') {
      e.preventDefault();
      // Tecla mantenida: el teclado repite solo; esas repeticiones no son golpes.
      if (e.repeat) return;
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
    this.shownPressed = d.pressedAt !== null;
    // Confirmación inmediata: la barra se congela y el título muestra lo elegido.
    this.el.classList.toggle('pressed', d.pressedAt !== null);
    const p = this.sim.player(d.playerKey);
    const what = d.options[0].option.id === 'free' ? 'Balón libre'
      : d.kind === 'serve' ? (p.def.serveStyle === 'jump' ? 'Saque en suspensión' : 'Saque flotado') : AIM_TITLES[d.kind];
    this.title.textContent = d.kind === 'block' ? TITLES.block : `${what} · #${p.def.number} ${ROLE_LABELS[p.def.role]}${p.def.star ? ' ★ figura' : ''} · ${p.def.height.toFixed(2)} m${d.kind === 'attack' && eliteJump(p.def) >= 0.1 ? ' · salto élite' : d.kind === 'attack' && p.def.height >= 2 ? ' (en picada)' : ''} · fuerte: ${SPECIALTY_LABELS[p.def.specialty]}`;
    const preview = this.sim.setPreview;
    if (d.kind === 'set' && d.pressedAt !== null && preview !== null) this.title.textContent += ` ✓ ${d.options[preview].label}`;
    if (d.kind === 'set' && d.aim && d.pressedAt === null) {
      const max = this.maxTempo(d);
      this.title.textContent = `Colocación · recepción ${max === 2 ? 'doble positiva: alta, media o rápida' : max === 1 ? 'positiva: alta o media' : 'complicada: solo alta'}`;
    }
    this.buttons.replaceChildren(
      ...d.options.map((o, i) => {
        const b = document.createElement('button');
        b.textContent = IS_TOUCH ? o.label : `${i + 1}  ${o.label}`;
        b.classList.toggle('chosen', (d.kind === 'set' && d.aim ? this.sim.setPreview : d.chosen) === i);
        // Sin foco: ESPACIO nunca "hace clic" en un botón, siempre es el golpe.
        b.tabIndex = -1;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => this.sim.choose(i));
        return b;
      }),
    );
    // El bloqueo no tiene barra: se salta mirando al rematador.
    this.meter.style.visibility = d.chosen === null || d.kind === 'block' ? 'hidden' : 'visible';
    // Barra de fuerza (saque y remate): verde suave, amarillo medio, rojo muy fuerte. Si no, zona de timing.
    const power = d.meter === 'power';
    this.meter.classList.toggle('power', power);
    // Saque: la puntita morada después del rojo es el ace.
    this.meter.classList.toggle('serve', d.kind === 'serve');
    this.meter.style.setProperty('--ace', `${TUNING.power.ace * 100}%`);
    // Colocación: la barra es el tempo.
    this.tempo.style.display = d.kind === 'set' && d.aim ? 'flex' : 'none';
    // Colocación: solo los tempos que permite la recepción (alta siempre; media y rápida con buen pase).
    const maxTempo = d.kind === 'set' && d.aim ? this.maxTempo(d) : 2;
    this.meter.style.setProperty('--medium', `${(maxTempo >= 1 ? TUNING.power.medium : 1) * 100}%`);
    this.meter.style.setProperty('--strong', `${(maxTempo >= 2 ? TUNING.power.strong : 1) * 100}%`);
    for (const [i, span] of [...this.tempo.children].entries()) (span as HTMLElement).style.display = i <= maxTempo ? 'flex' : 'none';
    this.perfectZone.style.display = this.goodZone.style.display = power ? 'none' : 'block';
    this.perfectZone.style.width = `${((TUNING.decision.perfectWindow / TUNING.decision.slowWindow) * 100).toFixed(1)}%`;
    this.goodZone.style.width = `${((TUNING.decision.goodWindow / TUNING.decision.slowWindow) * 100).toFixed(1)}%`;
    // Con mira no hay botones (se apunta en la cancha), salvo el bloqueo: esquema + marca de defensa.
    // La colocación apuntada se elige solo moviendo la mira (sin botones numerados).
    this.buttons.style.display = d.aim || d.kind === 'block' ? 'none' : 'grid';
    this.buttons.classList.toggle('compact', d.kind === 'set' && !!d.aim);
    this.hint.textContent = (IS_TOUCH ? TOUCH_HINTS : HINTS)[d.kind](d);
    this.meterWidth = 0;
    // Online la barra termina un poco antes que la pelota (lo que tarda tu tecla en llegar): guiarse por la barra.
    if ((d.lead ?? 0) > 0 && d.kind !== 'serve') this.hint.textContent += ' · Online: guíate por la barra, termina un poco antes que la pelota';
  }

  /** Tempo más rápido que se puede colocar con esta recepción (0 alta, 1 media, 2 rápida). */
  private maxTempo(d: Decision): number {
    let max = 0;
    for (const o of d.options) if (o.option.id === 'set') max = Math.max(max, SET_TEMPO[o.option.choice.option]);
    return max;
  }

  /** 0..1: posición del marcador. Llega a 1 en el instante ideal. */
  private meterValue(d: Decision): number {
    return meterOf(d, this.sim.time + this.ahead());
  }

  private zoneBar(kind: 'good' | 'perfect'): HTMLElement {
    const z = document.createElement('div');
    z.className = `meter-zone ${kind}`;
    return z;
  }
}
