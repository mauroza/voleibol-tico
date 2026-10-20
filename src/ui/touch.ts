import type { DecisionKind } from '../sim/decision';
import type { Simulation } from '../sim/rally';

/** ¿Pantalla táctil sin mouse (teléfono o tablet)? */
export const IS_TOUCH = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !window.matchMedia?.('(pointer: fine)').matches));

const ACTION_LABELS: Record<DecisionKind, string> = {
  serve: 'SACAR',
  pass: 'RECIBIR',
  set: 'COLOCAR',
  attack: 'REMATAR',
  block: 'SALTAR',
};

/** Al tocar "Jugar": pantalla completa y horizontal (donde el navegador lo permite; si no, sigue igual). */
export function enterMobileMode(): void {
  if (!IS_TOUCH) return;
  const doc = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    const p = doc.requestFullscreen?.({ navigationUI: 'hide' }) ?? doc.webkitRequestFullscreen?.();
    Promise.resolve(p)
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
      .catch(() => {});
  } catch {
    // Sin pantalla completa (iPhone, artefacto): se juega igual.
  }
}

/**
 * Controles táctiles: botón grande de acción (el ESPACIO), pausa y sonido. La mira se mueve arrastrando el dedo
 * sobre la cancha (ver AimInput). En vertical se sugiere girar el teléfono.
 */
export class TouchControls {
  private readonly action = document.createElement('button');
  private readonly label = document.createElement('span');
  private readonly ring = document.createElement('span');
  private readonly rotate = document.createElement('div');
  private shownLabel = '';

  constructor(
    root: HTMLElement,
    private readonly sim: Simulation,
    private readonly clock: (stamp: number) => number,
    private readonly paused: () => boolean,
    actions: { pause: (() => void) | null; mute: () => boolean; skipReplay: () => void },
  ) {
    document.body.classList.add('touch');
    this.action.className = 'touch-action';
    this.ring.className = 'touch-ring';
    this.action.append(this.ring, this.label);
    // pointerdown (no click): el golpe cuenta en el instante en que el dedo toca, sin la demora del clic.
    this.action.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (navigator.vibrate) navigator.vibrate(12);
      const d = this.sim.decision;
      if (!d || this.paused()) return actions.skipReplay();
      this.sim.press(this.clock(e.timeStamp));
    });
    this.action.addEventListener('contextmenu', (e) => e.preventDefault());

    const bar = document.createElement('div');
    bar.className = 'touch-bar';
    if (actions.pause) bar.append(this.small('⏸', 'Pausa', actions.pause));
    const mute = this.small('🔊', 'Sonido', () => { mute.textContent = actions.mute() ? '🔇' : '🔊'; });
    bar.append(mute);

    this.rotate.className = 'rotate-hint';
    const msg = document.createElement('p');
    msg.textContent = 'Gira el teléfono: el juego se ve y se juega mucho mejor en horizontal.';
    const icon = document.createElement('div');
    icon.className = 'rotate-icon';
    icon.textContent = '📱';
    const ok = document.createElement('button');
    ok.textContent = 'Jugar así';
    ok.addEventListener('click', () => this.rotate.remove());
    this.rotate.append(icon, msg, ok);
    root.append(this.action, bar, this.rotate);
  }

  private small(text: string, title: string, run: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'touch-small';
    b.textContent = text;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      run();
    });
    return b;
  }

  update(): void {
    const d = this.sim.decision;
    const ready = !!d && d.pressedAt === null && (d.chosen !== null || d.kind === 'block');
    const text = d ? ACTION_LABELS[d.kind] : '';
    if (text !== this.shownLabel) {
      this.label.textContent = text || '●';
      this.shownLabel = text;
    }
    this.action.classList.toggle('ready', ready);
    this.action.classList.toggle('idle', !d);
  }
}
