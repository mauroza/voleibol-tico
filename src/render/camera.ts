import * as THREE from 'three';
import type { Simulation } from '../sim/rally';

/** Hacia dónde mira la cámara de transmisión en x: sigue la pelota, con límite y atenuado. */
export function broadcastFocusX(ballX: number): number {
  return Math.max(-4, Math.min(4, ballX * 0.45));
}

/** Sacudida amortiguada: amplitud decreciente durante `duration` segundos desde `start`. */
export function shakeOffset(t: number, start: number, duration: number, amplitude: number): number {
  const k = (t - start) / duration;
  if (k < 0 || k >= 1) return 0;
  return amplitude * (1 - k) * Math.sin((t - start) * 70);
}

export type CameraMode = 'broadcast' | 'decision' | 'aim' | 'replay';

const BROADCAST_POS = new THREE.Vector3(0, 11, 19);

/**
 * Dirige la cámara: transmisión lateral elevada, acercamiento dramático durante la decisión del usuario
 * y órbita lenta durante la repetición. Movimiento suavizado; el `?cam=` de desarrollo lo desactiva.
 */
export class CameraDirector {
  mode: CameraMode = 'broadcast';
  private readonly pos = BROADCAST_POS.clone();
  private readonly look = new THREE.Vector3(0, 0.5, 0);
  private shake = { start: -10, duration: 0.3, amplitude: 0 };
  private replayFocus = new THREE.Vector3();
  private replayAngle = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera, private readonly sim: Simulation, private readonly fixed: boolean) {}

  punch(amplitude: number, duration = 0.3): void {
    this.shake = { start: performance.now() / 1000, duration, amplitude };
  }

  startReplay(focus: THREE.Vector3): void {
    this.mode = 'replay';
    this.replayFocus.copy(focus);
    this.replayAngle = focus.x < 0 ? -0.9 : 0.9;
  }

  endReplay(): void {
    this.mode = 'broadcast';
  }

  update(dtReal: number, ballPos: THREE.Vector3): void {
    if (this.fixed) return;
    const targetPos = new THREE.Vector3();
    const targetLook = new THREE.Vector3();
    let rate = 3;
    const d = this.sim.decision;
    if (this.mode === 'replay') {
      this.replayAngle += dtReal * 0.25;
      const r = 7.5;
      targetPos.set(this.replayFocus.x + Math.sin(this.replayAngle) * r, 3.2, this.replayFocus.z + Math.cos(this.replayAngle) * r);
      targetLook.set(this.replayFocus.x, 1.8, this.replayFocus.z);
      rate = 6;
    } else if (d?.aim && d.contactTime !== null) {
      // Remate apuntado: tercera persona, detrás y arriba del rematador, mirando hacia la mira en el campo rival.
      this.mode = 'aim';
      const u = this.sim.player(d.playerKey).pos;
      const toward = this.sim.player(d.playerKey).team === 'A' ? 1 : -1;
      targetPos.set(u.x - toward * 4.6, 5.2, u.z * 0.7 + d.aim.z * 0.15);
      targetLook.set(d.aim.x * 0.6, 0.2, d.aim.z * 0.6 + u.z * 0.25);
      rate = 5;
    } else if (d && d.contactTime !== null && this.sim.timeScale < 1) {
      // Decisión: plano cercano detrás y al costado del jugador del usuario, mirando la pelota.
      this.mode = 'decision';
      const u = this.sim.player(d.playerKey).pos;
      const side = Math.sign(u.x) || -1;
      targetPos.set(u.x + side * 4.2, 3.1, u.z + 5.5);
      targetLook.set((u.x + ballPos.x) / 2, Math.max(1.4, ballPos.y * 0.7), (u.z + ballPos.z) / 2);
      rate = 4;
    } else {
      this.mode = 'broadcast';
      const fx = broadcastFocusX(ballPos.x);
      targetPos.set(fx, BROADCAST_POS.y, BROADCAST_POS.z);
      targetLook.set(fx, 0.5, 0);
    }
    const k = 1 - Math.exp(-rate * dtReal);
    this.pos.lerp(targetPos, k);
    this.look.lerp(targetLook, k);
    const t = performance.now() / 1000;
    const s = shakeOffset(t, this.shake.start, this.shake.duration, this.shake.amplitude);
    this.camera.position.set(this.pos.x + s, this.pos.y + s * 0.6, this.pos.z);
    this.camera.lookAt(this.look);
  }
}
