import type { MatchView } from '../render/scene';
import type { Simulation } from '../sim/rally';

const KEYS: Record<string, [number, number]> = {
  ArrowUp: [1, 0], KeyW: [1, 0],
  ArrowDown: [-1, 0], KeyS: [-1, 0],
  ArrowLeft: [0, -1], KeyA: [0, -1],
  ArrowRight: [0, 1], KeyD: [0, 1],
};
/** Velocidad de la mira con teclado o palanca (m por segundo real). */
const AIM_SPEED = 6;
/** Con el dedo, la mira queda un poco arriba del dedo para que no la tape (px de pantalla). */
const FINGER_OFFSET = 56;

/**
 * Mira del remate apuntado: el mouse sobre la cancha la mueve, el clic remata ahí (cuenta como el timing);
 * flechas o WASD la mueven desde la vista del rematador (arriba = hacia el fondo rival).
 * Táctil: arrastrar el dedo por la cancha mueve la mira (sin golpear); el golpe es el botón de acción.
 */
export class AimInput {
  private readonly held = new Set<string>();
  private padActive = false;

  constructor(
    private readonly sim: Simulation,
    private readonly view: MatchView,
    canvas: HTMLCanvasElement,
    private readonly clock: (stamp: number) => number,
    private readonly paused: () => boolean,
  ) {
    const finger = (e: PointerEvent) => e.pointerType === 'touch' || e.pointerType === 'pen';
    const aimAt = (e: PointerEvent) => {
      const p = this.view.pickGround(e.clientX, e.clientY - (finger(e) ? FINGER_OFFSET : 0));
      if (p) this.sim.setAim(p.x, p.z);
    };
    canvas.addEventListener('pointermove', (e) => {
      // Con el dedo solo cuenta mientras está apoyado (no hay "hover").
      if (!this.aiming() || (finger(e) && !e.buttons && e.pressure === 0)) return;
      aimAt(e);
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.aiming()) return;
      aimAt(e);
      if (!finger(e)) this.sim.press(this.clock(e.timeStamp));
    });
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
    const toward = this.sim.player(d.playerKey).team === 'A' ? 1 : -1;
    const from = this.sim.localAim ?? d.aim;
    this.sim.setAim(from.x + toward * fwd * AIM_SPEED * dtReal, from.z + toward * side * AIM_SPEED * dtReal);
  }

  private aiming(): boolean {
    return !this.paused() && !!this.sim.decision?.aim && this.sim.decision.pressedAt === null;
  }
}
