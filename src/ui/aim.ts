import { isKey, settings, type Action } from '../data/profile';
import type { MatchView } from '../render/scene';
import { sideSign } from '../sim/court';
import type { Simulation } from '../sim/rally';

/** Dirección de cada acción de mira: [adelante, derecha]. Las teclas salen de los ajustes (más las flechas). */
const MOVES: [Action, number, number][] = [['up', 1, 0], ['down', -1, 0], ['left', 0, -1], ['right', 0, 1]];
/** Velocidad de la mira con teclado o palanca (m por segundo real). */
const AIM_SPEED = 6;
/**
 * Con el dedo la mira funciona como un trackpad, solo en la mitad izquierda de la pantalla (la derecha es del botón de
 * golpe): la mira se mueve desde donde está, en metros por pixel de la pantalla (no por la proyección sobre el piso, que
 * cerca del horizonte se disparaba). Recorrer el lado corto de la pantalla mueve la mira `TOUCH_METERS`.
 */
const TOUCH_METERS = 12;
/** Movimientos lentos del dedo, más finos (para corregir unos centímetros). */
const TOUCH_FINE = 0.6;
/**
 * Suavizado: la mira no salta al punto pedido, lo persigue con esta rapidez (1/s). Mueve fluido aunque el dedo o el
 * mouse den tirones, sin sentirse lenta (llega al 90% en ~0.12 s).
 */
const SMOOTH_TOUCH = 18;
const SMOOTH_MOUSE = 30;

/**
 * Mira del remate apuntado: el mouse sobre la cancha la mueve, el clic remata ahí (cuenta como el timing);
 * flechas o WASD la mueven desde la vista del rematador (arriba = hacia el fondo rival).
 * Táctil: arrastrar el dedo en la mitad izquierda mueve la mira como un trackpad (sin golpear); el golpe es el botón de acción.
 */
export class AimInput {
  /** Acciones de mira mantenidas, por código de tecla. */
  private readonly held = new Map<string, Action>();
  private padActive = false;
  /** Dedo apoyado: último punto de la cancha bajo el dedo (para mover la mira por diferencia). */
  private drag: { id: number; x: number; y: number } | null = null;
  /** Hacia dónde va la mira (la real la persigue suave) y de qué decisión es. */
  private goal: { x: number; z: number; rate: number } | null = null;
  private goalFor: unknown = null;

  constructor(
    private readonly sim: Simulation,
    private readonly view: MatchView,
    canvas: HTMLCanvasElement,
    private readonly clock: (stamp: number) => number,
    private readonly paused: () => boolean,
  ) {
    const finger = (e: PointerEvent) => e.pointerType === 'touch' || e.pointerType === 'pen';
    canvas.addEventListener('pointermove', (e) => {
      if (!this.aiming()) return;
      if (!finger(e)) {
        // Mouse relativo: se mueve como un trackpad (con la sensibilidad); directo: la mira bajo el cursor.
        if (settings().mouseMode === 'relativo') {
          const perPx = (5 / Math.min(window.innerWidth, window.innerHeight)) * settings().mouseSens;
          this.nudge(-e.movementY * perPx, e.movementX * perPx);
          return;
        }
        const p = this.view.pickGround(e.clientX, e.clientY);
        if (p) this.aimAt(p.x, p.z, SMOOTH_MOUSE);
        return;
      }
      // Dedo: arriba = hacia el fondo rival, derecha = derecha del jugador (como las flechas), en metros por pixel.
      const d = this.sim.decision;
      if (!d?.aim || !this.drag || this.drag.id !== e.pointerId) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      const px = Math.hypot(dx, dy);
      const perPx = (TOUCH_METERS / Math.min(window.innerWidth, window.innerHeight)) * settings().touchSens;
      // Aceleración suave: el pulgar lento apunta fino; el rápido cruza la cancha.
      const gain = perPx * (TOUCH_FINE + (1 - TOUCH_FINE) * Math.min(1, px / 14));
      this.nudge(-dy * gain, dx * gain);
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (finger(e)) {
        // Solo la mitad izquierda apunta; la derecha queda libre para el botón de golpe.
        this.drag = e.clientX < window.innerWidth / 2 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
        return;
      }
      if (!this.aiming()) return;
      if (settings().mouseMode !== 'relativo') {
        // El clic remata exactamente donde está el cursor (sin esperar el suavizado).
        const p = this.view.pickGround(e.clientX, e.clientY);
        if (p) this.sim.setAim(p.x, p.z);
        this.goal = null;
      }
      this.sim.press(this.clock(e.timeStamp));
    });
    const lift = (e: PointerEvent) => {
      if (this.drag?.id === e.pointerId) this.drag = null;
    };
    canvas.addEventListener('pointerup', lift);
    canvas.addEventListener('pointercancel', lift);
    window.addEventListener('keydown', (e) => {
      const move = MOVES.find(([a]) => isKey(e, a));
      if (move && this.aiming()) {
        e.preventDefault();
        this.held.set(e.code, move[0]);
      }
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
  }

  /** Mueve la mira con las teclas mantenidas y la palanca izquierda del gamepad. */
  update(dtReal: number): void {
    const d = this.sim.decision;
    if (!this.aiming() || !d?.aim) {
      this.held.clear();
      this.goal = null;
      return;
    }
    if (this.goalFor !== d) {
      this.goalFor = d;
      this.goal = null;
    }
    // La mira persigue su objetivo con suavidad.
    if (this.goal) {
      const from = this.sim.localAim ?? d.aim;
      const k = 1 - Math.exp(-this.goal.rate * dtReal);
      const nx = from.x + (this.goal.x - from.x) * k;
      const nz = from.z + (this.goal.z - from.z) * k;
      this.sim.setAim(nx, nz);
      // Si la cancha la frenó (borde), el objetivo se queda en el borde: así no hay que "volver" desde afuera.
      const now = this.sim.localAim ?? this.sim.decision?.aim;
      if (now) {
        this.goal.x += now.x - nx;
        this.goal.z += now.z - nz;
      }
    }
    let fwd = 0;
    let side = 0;
    for (const action of this.held.values()) {
      const [, f, s] = MOVES.find(([a]) => a === action)!;
      fwd += f;
      side += s;
    }
    // La palanca solo cuenta después de tocar un botón (evita el "drift" de controles conectados sin usar).
    const pad = navigator.getGamepads?.().find((g) => g && g.connected);
    if (pad?.buttons.some((b) => b.pressed)) this.padActive = true;
    if (pad && this.padActive && pad.axes.length >= 2) {
      if (Math.abs(pad.axes[0]) > 0.25) side += pad.axes[0];
      if (Math.abs(pad.axes[1]) > 0.25) fwd -= pad.axes[1];
    }
    if (!fwd && !side) return;
    const speed = AIM_SPEED * settings().keySens * dtReal;
    const toward = -sideSign(this.sim.player(d.playerKey).team);
    const from = this.sim.localAim ?? d.aim;
    this.goal = null;
    this.sim.setAim(from.x + toward * fwd * speed, from.z + toward * side * speed);
  }

  /** Mueve el objetivo de la mira desde la vista del rematador: "adelante" es hacia el fondo rival (m). */
  private nudge(fwd: number, side: number): void {
    const d = this.sim.decision;
    if (!d?.aim) return;
    const toward = -sideSign(this.sim.player(d.playerKey).team);
    const from = this.goal ?? this.sim.localAim ?? d.aim;
    this.aimAt(from.x + toward * fwd, from.z + toward * side, SMOOTH_TOUCH);
  }

  private aimAt(x: number, z: number, rate: number): void {
    this.goal = { x, z, rate };
  }

  private aiming(): boolean {
    return !this.paused() && !!this.sim.decision?.aim && this.sim.decision.pressedAt === null;
  }
}
