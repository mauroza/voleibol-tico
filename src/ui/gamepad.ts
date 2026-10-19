import type { Zone } from '../sim/actions';
import type { Simulation } from '../sim/rally';

/** Índices del mapeo estándar de gamepad. */
const A = 0;
const START = 9;
const DPAD: Record<number, number> = { 12: 0, 15: 1, 13: 2, 14: 3 }; // arriba, derecha, abajo, izquierda → opción 1..4
const DPAD_ZONE: Record<number, Zone> = { 12: 3, 14: 4, 15: 2, 13: 6 }; // en el saque: centro, izquierda, derecha, fondo

/**
 * Gamepad: la cruceta elige opciones (en el saque, la zona), A presiona el timing (si no hay opción, elige la primera)
 * y Start pausa. Detecta flancos de pulsación por sondeo en cada cuadro.
 */
export class GamepadInput {
  private prev: boolean[] = [];

  constructor(private readonly sim: Simulation, private readonly onPause: () => void, private readonly clock: (stamp: number) => number = () => sim.time) {}

  update(): void {
    const pad = navigator.getGamepads?.().find((g) => g && g.connected);
    if (!pad) return;
    const stamp = pad.timestamp;
    const now = pad.buttons.map((b) => b.pressed);
    const pressed = (i: number) => now[i] && !this.prev[i];
    this.prev = now;

    if (pressed(START)) this.onPause();
    const d = this.sim.decision;
    if (!d) return;
    for (const [btn, idx] of Object.entries(DPAD)) {
      if (!pressed(Number(btn))) continue;
      if (d.kind === 'serve' && d.chosen !== null) this.sim.setServeZone(DPAD_ZONE[Number(btn)]);
      else this.sim.choose(idx);
    }
    if (pressed(A)) {
      if (d.chosen === null) this.sim.choose(0);
      else this.sim.press(this.clock(stamp));
    }
  }
}
