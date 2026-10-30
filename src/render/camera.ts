import * as THREE from 'three';
import { COURT, sideSign } from '../sim/court';
import { TUNING } from '../sim/tuning';
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

export type CameraMode = 'broadcast' | 'decision' | 'aim' | 'replay' | 'mark';

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
  private replayLand = new THREE.Vector3();
  private replayAngle = 0;
  /** Challenge de línea: plano cerrado sobre la marca del pique hasta este instante (ms). */
  private markUntil = 0;
  private readonly mark = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera, private readonly sim: Simulation, private readonly fixed: boolean) {}

  punch(amplitude: number, duration = 0.3): void {
    this.shake = { start: performance.now() / 1000, duration, amplitude };
  }

  /**
   * Repetición (y challenge) como en la tele: plano abierto desde el costado, lejos y alto, que sigue a la pelota con
   * suavidad. Se ve la jugada completa (los dos campos) y la pelota siempre en cuadro, sin acercarse de más.
   */
  startReplay(focus: THREE.Vector3, land: THREE.Vector3 = focus): void {
    this.mode = 'replay';
    this.replayFocus.copy(focus);
    this.replayLand.copy(land);
    this.replayAngle = 0;
    const [pos, look] = this.replayShot(focus);
    this.pos.copy(pos);
    this.look.copy(look);
  }

  endReplay(): void {
    this.mode = 'broadcast';
  }

  /** Challenge: la cámara baja sobre la marca del pique (con la línea) durante `seconds`. */
  focusMark(at: THREE.Vector3, seconds: number): void {
    this.mark.copy(at);
    this.markUntil = performance.now() + seconds * 1000;
  }

  /** Plano de la repetición para la pelota en `ball`: costado del pabellón, alto, siguiéndola a medias. */
  private replayShot(ball: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
    // En pantallas angostas (teléfono vertical) se sube un poco más para que entren los dos campos.
    const narrow = Math.max(1, 1.5 / this.camera.aspect) ** 0.5;
    const pos = new THREE.Vector3(
      Math.max(-6, Math.min(6, ball.x * 0.4)),
      Math.min(7.8 * narrow, TUNING.hall.ceiling - 1.5),
      TUNING.hall.standZ - 0.8,
    );
    const look = new THREE.Vector3(
      Math.max(-7, Math.min(7, ball.x * 0.75)),
      Math.max(0.6, Math.min(3, ball.y * 0.45)),
      Math.max(-3, Math.min(3, ball.z * 0.45)),
    );
    return [pos, look];
  }

  update(dtReal: number, ballPos: THREE.Vector3): void {
    if (this.fixed) return;
    const targetPos = new THREE.Vector3();
    const targetLook = new THREE.Vector3();
    let rate = 3;
    const d = this.sim.decision;
    const cer = this.sim.ceremony;
    // Después de elegir lado vuelve el plano general: se ve a los equipos cambiar de cancha.
    if (cer && (cer.step === 'greeting' || (cer.step === 'toss' && cer.sub === 0)) && this.mode !== 'replay') {
      // Saludo y sorteo: plano más cercano de la red, del lado de tu cancha.
      this.mode = 'broadcast';
      const own = this.sim.control ? sideSign(this.sim.control) : 0;
      if (own) {
        targetPos.set(own * 9, 4.4, 2.5);
        targetLook.set(0, 1.2, 0);
      } else {
        targetPos.set(0, 4.6, 11.5);
        targetLook.set(0, 1.1, 0);
      }
      rate = 2;
    } else if (performance.now() < this.markUntil && this.mode !== 'replay') {
      // Como el ojo de halcón: casi desde arriba, un poco del lado de la cámara, con la marca y la línea en el centro.
      this.mode = 'mark';
      // Casi cenital y del lado de afuera de la línea más cercana: ningún jugador se mete entre la cámara y la marca.
      const side = COURT.halfWidth - Math.abs(this.mark.z) < COURT.halfLength - Math.abs(this.mark.x);
      const out = side ? [0, Math.sign(this.mark.z) || 1] : [Math.sign(this.mark.x) || 1, 0];
      targetPos.set(this.mark.x + out[0] * 1.1, 4.6, this.mark.z + out[1] * 1.1 + 0.01);
      targetLook.set(this.mark.x, 0, this.mark.z);
      rate = 3.5;
    } else if (this.mode === 'replay') {
      this.replayAngle += dtReal;
      const [pos, look] = this.replayShot(ballPos);
      targetPos.copy(pos);
      targetLook.copy(look);
      rate = 2.5;
    } else if (d?.aim && d.kind !== 'block') {
      // Saque, pase o remate apuntado: tercera persona, detrás y arriba del jugador, mirando hacia la mira.
      // La cámara no sigue a la mira (miraba hacia ella y el mouse o el dedo, quietos, la seguían corriendo): enfoca el
      // centro del campo rival desde atrás del jugador.
      this.mode = 'aim';
      const u = this.sim.player(d.playerKey).pos;
      const toward = -sideSign(this.sim.player(d.playerKey).team);
      // Pase y balón propio: hacia la zona del colocador; remate y saque: el centro del campo rival.
      const rival = d.aimSide === this.sim.player(d.playerKey).team ? -toward * 1.5 : toward * 4.5;
      if (d.kind === 'set') {
        // Colocación: plano fijo desde atrás y arriba del propio campo (no sigue al colocador, que se mueve), con la red
        // entera y todos los atacantes a la vista: punta, central, opuesto y zagueros.
        // Si coloca otro (pase malo: el líbero o un zaguero desde atrás), la cámara se aleja y sube lo necesario para
        // que el que coloca quede siempre en cuadro, y se corre hacia su lado.
        const depth = Math.max(0, -toward * u.x);
        targetPos.set(-toward * Math.max(10.5, depth + 5), 7.4 + Math.max(0, depth - 3) * 0.7, u.z * 0.35);
        targetLook.set(-toward * Math.max(1.4, depth * 0.45), 0.4, u.z * 0.3);
      } else if (d.kind === 'serve') {
        // El saque cruza toda la cancha: más alto, para ver el campo rival por encima de la red.
        targetPos.set(u.x - toward * 2.6, 7.6, u.z * 0.6);
        targetLook.set(u.x + (rival - u.x) * 0.78, 0, u.z * 0.22);
      } else {
        // Remate (y pase): detrás del que golpea, que queda siempre abajo en el centro del cuadro.
        targetPos.set(u.x - toward * 4.6, 5.2, u.z * 0.85);
        targetLook.set(u.x + (rival - u.x) * 0.5, 0.2, u.z * 0.6);
      }
      rate = 5;
    } else if (d?.kind === 'block' && d.aim) {
      // Bloqueo y marca de defensa: desde atrás y arriba del propio campo, para ver la cancha, la red y al rematador.
      this.mode = 'decision';
      const own = sideSign(this.sim.player(d.playerKey).team);
      targetPos.set(own * 14, 11, d.aim.z * 0.2);
      targetLook.set(own * 3.2, 0, d.aim.z * 0.3);
      rate = 4;
    } else if (this.sim.control) {
      // Juego: siempre desde atrás de la propia cancha, a la espalda de tus jugadores, mirando hacia la red y el
      // rival. Sigue a la pelota de a poco (a lo ancho y a lo largo), sin girar de golpe. En tu decisión se acerca un poco.
      this.mode = d && d.contactTime !== null && this.sim.timeScale < 1 ? 'decision' : 'broadcast';
      const own = sideSign(this.sim.control);
      const close = this.mode === 'decision' ? 1 : 0;
      // Pantallas angostas (teléfono en vertical): un poco más alto para ver los dos campos.
      const narrow = Math.max(1, 1.5 / this.camera.aspect) ** 0.5;
      const bx = Math.max(-COURT.halfLength - 1, Math.min(COURT.halfLength + 1, ballPos.x));
      const bz = Math.max(-COURT.halfWidth - 1, Math.min(COURT.halfWidth + 1, ballPos.z));
      targetPos.set(own * (15.2 - close * 1.6), (7.4 - close * 0.8) * narrow, bz * 0.3);
      const netLook = -own * 1.2;
      targetLook.set(netLook + (bx - netLook) * 0.3, 0.7, bz * 0.45);
      rate = 2.6;
    } else {
      // Sin equipo propio (IA contra IA): la transmisión lateral de siempre.
      this.mode = 'broadcast';
      const fx = broadcastFocusX(ballPos.x);
      targetPos.set(fx, BROADCAST_POS.y, BROADCAST_POS.z);
      targetLook.set(fx, 0.5, 0);
    }
    // Nunca contra las paredes ni dentro de la tribuna: la cámara queda dentro del pabellón.
    if (this.mode === 'aim' || this.mode === 'decision') {
      targetPos.x = Math.max(-15.5, Math.min(15.5, targetPos.x));
      // Nunca dentro de la tribuna de enfrente (el público tapaba la jugada).
      targetPos.z = Math.max(-9, Math.min(TUNING.hall.standZ - 0.6, targetPos.z));
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
