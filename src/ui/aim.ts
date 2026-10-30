import type { MatchView } from '../render/scene';
import { sideSign } from '../sim/court';
import type { Simulation } from '../sim/rally';

const KEYS: Record<string, [number, number]> = {
  ArrowUp: [1, 0], KeyW: [1, 0],
  ArrowDown: [-1, 0], KeyS: [-1, 0],
  ArrowLeft: [0, -1], KeyA: [0, -1],
  ArrowRight: [0, 1], KeyD: [0, 1],
};
/** Velocidad de la mira con teclado o palanca (m por segundo real). */
const AIM_SPEED = 6;
/**
 * Con el dedo la mira funciona como un trackpad, solo en la mitad izquierda de la pantalla (la derecha es del botón de
 * golpe): la mira se mueve desde donde está, en metros por pixel de la pantalla (no por la proyección sobre el piso, que
 * cerca del horizonte se disparaba). Recorrer el lado corto de la pantalla mueve la mira `TOUCH_METERS`.
 */
const TOUCH_METERS = 6;
/** Movimientos lentos del dedo, aún más finos (para corregir unos centímetros). */
const TOUCH_FINE = 0.55;

/**
 * Mira del remate apuntado: el mouse sobre la cancha la mueve, el clic remata ahí (cuenta como el timing);
 * flechas o WASD la mueven desde la vista del rematador (arriba = hacia el fondo rival).
 * Táctil: arrastrar el dedo en la mitad izquierda mueve la mira como un trackpad (sin golpear); el golpe es el botón de acción.
 */
export class AimInput {
  private readonly held = new Set<string>();
  private padActive = false;
  /** Dedo apoyado: último punto de la cancha bajo el dedo (para mover la mira por diferencia). */
  private drag: { id: number; x: number; y: number } | null = null;

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
        const p = this.view.pickGround(e.clientX, e.clientY);
        if (p) this.sim.setAim(p.x, p.z);
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
      const perPx = TOUCH_METERS / Math.min(window.innerWidth, window.innerHeight);
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
      const p = this.view.pickGround(e.clientX, e.clientY);
      if (p) this.sim.setAim(p.x, p.z);
      this.sim.press(this.clock(e.timeStamp));
    });
    const lift = (e: PointerEvent) => {
      if (this.drag?.id === e.pointerId) this.drag = null;
    };
    canvas.addEventListener('pointerup', lift);
    canvas.addEventListener('pointercancel', lift);
    window.addEventListener('keydown', (e) => {
      if (KEYS[e.code] && this.aiming()) {
        e.preventDefault();
        this.held.add(e.code);
      }
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
  }

  /** Mueve la mira con las teclas mantenidas y la palanca izquierda del gamepad. */
  update(dtReal: number): void {
    const d = this.sim.decision;
    if (!this.aiming() || !d?.aim) {
      this.held.clear();
      return;
    }
    let fwd = 0;
    let side = 0;
    for (const code of this.held) {
      fwd += KEYS[code][0];
      side += KEYS[code][1];
    }
    // La palanca solo cuenta después de tocar un botón (evita el "drift" de controles conectados sin usar).
    const pad = navigator.getGamepads?.().find((g) => g && g.connected);
    if (pad?.buttons.some((b) => b.pressed)) this.padActive = true;
    if (pad && this.padActive && pad.axes.length >= 2) {
      if (Math.abs(pad.axes[0]) > 0.25) side += pad.axes[0];
      if (Math.abs(pad.axes[1]) > 0.25) fwd -= pad.axes[1];
    }
    if (!fwd && !side) return;
    this.nudge(fwd * AIM_SPEED * dtReal, side * AIM_SPEED * dtReal);
  }

  /** Mueve la mira desde la vista del rematador: "adelante" es hacia el fondo rival y "derecha" su derecha (m). */
  private nudge(fwd: number, side: number): void {
    const d = this.sim.decision;
    if (!d?.aim) return;
    const toward = -sideSign(this.sim.player(d.playerKey).team);
    const from = this.sim.localAim ?? d.aim;
    this.sim.setAim(from.x + toward * fwd, from.z + toward * side);
  }

  private aiming(): boolean {
    return !this.paused() && !!this.sim.decision?.aim && this.sim.decision.pressedAt === null;
  }
}
