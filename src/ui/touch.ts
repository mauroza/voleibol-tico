import { icon as svgIcon } from './crest';
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

/** El usuario quiere pantalla completa: si el navegador la quita (gesto del sistema), vuelve con el siguiente toque. */
let wantFullscreen = false;

const fullscreenElement = (): Element | null =>
  document.fullscreenElement ?? (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement ?? null;

function requestFullscreen(): void {
  if (!CAN_FULLSCREEN) return;
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

/** iPad (iPadOS se presenta como Mac con pantalla táctil) o iPhone. */
const IS_IOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/**
 * ¿Conviene la pantalla completa del navegador? El iPhone no la tiene; el iPad sí, pero Safari la quita con cualquier
 * deslizamiento hacia abajo (apuntar con el dedo la cerraba). En los dos sirve "Agregar a inicio": como app no hay
 * barra del navegador ni gesto que la saque.
 */
export const CAN_FULLSCREEN = typeof document !== 'undefined' && !IS_IOS
  && !!(document.documentElement.requestFullscreen || (document.documentElement as HTMLElement & { webkitRequestFullscreen?: unknown }).webkitRequestFullscreen);

export function toggleFullscreen(): void {
  if (fullscreenElement()) {
    wantFullscreen = false;
    void document.exitFullscreen?.().catch(() => {});
  } else {
    wantFullscreen = true;
    requestFullscreen();
  }
}

/**
 * Deslizar el dedo nunca mueve la página: ni la barra del navegador, ni "jalar para recargar", ni rebotes. Solo se
 * desplazan los paneles que de verdad tienen contenido para desplazar (menú, alineación, chat).
 */
let scrollLocked = false;
function lockPageScroll(): void {
  if (scrollLocked) return;
  scrollLocked = true;
  const scrollable = (el: Element | null): boolean => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 1) return true;
      if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 1) return true;
    }
    return false;
  };
  document.addEventListener('touchmove', (e) => {
    const t = e.target as Element | null;
    if (t instanceof HTMLInputElement && t.type === 'range') return;
    if (!scrollable(t) && e.cancelable) e.preventDefault();
  }, { passive: false });
  // Volver a pantalla completa con el siguiente toque si el sistema la quitó (al soltar el dedo: el navegador solo
  // acepta pedirla en ese momento).
  document.addEventListener('pointerup', () => {
    if (wantFullscreen && !fullscreenElement()) requestFullscreen();
  }, true);
}

/** Al tocar "Jugar": pantalla completa y horizontal (donde el navegador lo permite; si no, sigue igual). */
export function enterMobileMode(): void {
  if (!IS_TOUCH) return;
  lockPageScroll();
  wantFullscreen = true;
  requestFullscreen();
}

if (IS_TOUCH && typeof document !== 'undefined') lockPageScroll();

/**
 * Controles táctiles en dos zonas grandes y transparentes (no tapan el juego): la mitad izquierda apunta (arrastrar,
 * ver AimInput) y la derecha golpea (recibir, colocar, rematar, sacar, saltar). Además pausa y sonido.
 * En vertical se sugiere girar el teléfono.
 */
export class TouchControls {
  private readonly action = document.createElement('div');
  private readonly aimZone = document.createElement('div');
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
    this.action.className = 'touch-zone touch-hit';
    this.ring.className = 'touch-zone-hint';
    this.ring.textContent = 'TOCA AQUÍ';
    this.label.className = 'touch-zone-label';
    this.action.append(this.label, this.ring);
    this.aimZone.className = 'touch-zone touch-aim';
    this.aimZone.innerHTML = '<span class="touch-zone-label">APUNTA</span><span class="touch-zone-hint">ARRASTRA EL DEDO</span>';
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
    if (actions.pause) bar.append(this.small(svgIcon('pause', 18), 'Pausa', actions.pause));
    // Pantalla completa a mano (por si se salió); donde no existe (iPhone) no se muestra.
    if (CAN_FULLSCREEN) bar.append(this.small(svgIcon('expand', 18), 'Pantalla completa', toggleFullscreen));
    const mute = this.small(svgIcon('sound', 18), 'Sonido', () => { mute.innerHTML = svgIcon(actions.mute() ? 'mute' : 'sound', 18); });
    bar.append(mute);

    this.rotate.className = 'rotate-hint';
    const msg = document.createElement('p');
    msg.textContent = 'Gira el teléfono: el juego se ve y se juega mucho mejor en horizontal.';
    const icon = document.createElement('div');
    icon.className = 'rotate-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/></svg>';
    const ok = document.createElement('button');
    ok.textContent = 'Jugar así';
    ok.addEventListener('click', () => this.rotate.remove());
    this.rotate.append(icon, msg, ok);
    root.append(this.aimZone, this.action, bar, this.rotate);
  }

  private small(html: string, title: string, run: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'touch-small';
    b.innerHTML = html;
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
      this.label.textContent = text;
      this.shownLabel = text;
    }
    this.action.classList.toggle('ready', ready);
    this.action.classList.toggle('idle', !d);
    // La zona de apuntar solo se marca cuando hay mira que mover.
    const aiming = !!d?.aim && d.pressedAt === null && !this.paused();
    this.aimZone.classList.toggle('active', aiming);
    this.aimZone.classList.toggle('idle', !aiming);
  }
}
