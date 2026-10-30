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
 * Con el dedo la mira funciona como un trackpad: se arrastra en cualquier parte de la pantalla y la mira se mueve desde
 * donde está (el dedo nunca la tapa ni la hace saltar). `TOUCH_GAIN` amplifica el arrastre para cruzar la cancha con
 * un movimiento corto del pulgar; `TOUCH_STEP` limita cada movimiento (cerca del horizonte la proyección se dispara).
 */
const TOUCH_GAIN = 1.7;
const TOUCH_STEP = 1.2;

/**
 * Mira del remate apuntado: el mouse sobre la cancha la mueve, el clic remata ahí (cuenta como el timing);
 * flechas o WASD la mueven desde la vista del rematador (arriba = hacia el fondo rival).
 * Táctil: arrastrar el dedo mueve la mira como un trackpad (sin golpear); el golpe es el botón de acción.
 */
export class AimInput {
  private readonly held = new Set<string>();
  private padActive = false;
  /** Dedo apoyado: último punto de la cancha bajo el dedo (para mover la mira por diferencia). */
  private drag: { id: number; at: { x: number; z: number } } | null = null;

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
      // Dedo: la mira se mueve lo que se movió el dedo sobre la cancha (amplificado).
      const d = this.sim.decision;
      const g = this.view.pickGround(e.clientX, e.clientY);
      if (!d?.aim || !g || !this.drag || this.drag.id !== e.pointerId) return;
      const step = (v: number) => Math.max(-TOUCH_STEP, Math.min(TOUCH_STEP, v * TOUCH_GAIN));
      const from = this.sim.localAim ?? d.aim;
      this.sim.setAim(from.x + step(g.x - this.drag.at.x), from.z + step(g.z - this.drag.at.z));
      this.drag.at = { x: g.x, z: g.z };
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (finger(e)) {
        const g = this.view.pickGround(e.clientX, e.clientY);
        this.drag = g ? { id: e.pointerId, at: { x: g.x, z: g.z } } : null;
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
    // Desde la vista del rematador: "adelante" es hacia el fondo rival y "derecha" su derecha.
    const toward = -sideSign(this.sim.player(d.playerKey).team);
    const from = this.sim.localAim ?? d.aim;
    this.sim.setAim(from.x + toward * fwd * AIM_SPEED * dtReal, from.z + toward * side * AIM_SPEED * dtReal);
  }

  private aiming(): boolean {
    return !this.paused() && !!this.sim.decision?.aim && this.sim.decision.pressedAt === null;
  }
}
