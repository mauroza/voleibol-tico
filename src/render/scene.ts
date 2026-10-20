import * as THREE from 'three';
import { COURT } from '../sim/court';
import { AVG_HEIGHT, shirtName } from '../sim/players';
import type { Simulation } from '../sim/rally';
import { SpeedLines } from '../ui/speedlines';
import { Animator } from './animator';
import { Arena } from './arena';
import { CameraDirector } from './camera';
import { DIMS, buildCharacter, lookFor } from './character';
import { Effects } from './fx';
import { JOINTS } from './pose';
import { ReplayBuffer, ReplayPolicy } from './replay';
import { TUNING } from '../sim/tuning';
import { SET_TEMPO, TEMPO_LABELS } from '../sim/actions';
import { contactMeter, powerZone, serveMeter, type Power } from '../sim/decision';
import { toon } from './toon';

interface SetMarker {
  group: THREE.Group;
  ring: THREE.Mesh;
  label: THREE.Sprite;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  text: string;
}

const POWER_COLORS: Record<Power, string> = { soft: '#5dff8f', medium: '#ffd23f', strong: '#ff3b3b' };

/** Floats por personaje en un cuadro de repetición: raíz x/z, giro, salto, cadera y un cuaternión por articulación. */
const PER_RIG = 5 + JOINTS.length * 4;
/** Segundos de juego antes y después del punto que muestra la repetición. */
const REPLAY_BEFORE = 1.6;
const REPLAY_AFTER = 0.4;
const REPLAY_SPEED = 0.45;
/** Segundos antes del saque de la IA en que la pelota sale de la mano (lanzamiento). */
const SERVE_TOSS = 0.55;

/**
 * Vista del partido: personajes, gimnasio con público, efectos anime, cámara dramática y repeticiones.
 * Solo lee la simulación; durante una repetición `replaying` es true y el bucle no debe avanzar la simulación.
 */
export class MatchView {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  private readonly animators: Animator[] = [];
  private readonly byKey = new Map<string, Animator>();
  private readonly ball: THREE.Mesh;
  private readonly ballShadow: THREE.Mesh;
  /** Mira del remate apuntado: cruz, círculo de dispersión (dónde puede caer) y trayectoria punteada. */
  private readonly aimGroup = new THREE.Group();
  private readonly aimSpread = new THREE.Mesh(
    new THREE.RingGeometry(0.92, 1, 40),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, depthTest: false }),
  );
  private readonly aimCross = new THREE.Group();
  private readonly setMarkers: SetMarker[] = [];
  /** Sin prueba de profundidad: la mira se ve aunque quede detrás de un jugador o de la red. */
  private readonly aimMat = new THREE.MeshBasicMaterial({ color: '#ffe14d', side: THREE.DoubleSide, depthWrite: false, depthTest: false });
  private readonly aimPath = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(Array.from({ length: 24 }, () => new THREE.Vector3())),
    new THREE.LineDashedMaterial({ color: '#ffe14d', dashSize: 0.35, gapSize: 0.22, transparent: true, opacity: 0.9 }),
  );
  private readonly raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly userRing = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.6, 32),
    new THREE.MeshBasicMaterial({ color: '#ffe14d', side: THREE.DoubleSide }),
  );
  private readonly arena: Arena;
  private readonly fx: Effects;
  private readonly director: CameraDirector;
  private readonly speedLines: SpeedLines;
  private readonly flashEl = document.createElement('div');
  private readonly badge = document.createElement('div');
  private readonly buffer: ReplayBuffer;
  private readonly frame: Float32Array;
  private readonly policy = new ReplayPolicy();
  private readonly prevBall = new THREE.Vector3();
  private lastPower: Power | null = null;
  private lastAttackAt = new THREE.Vector3();
  private pendingReplay: { at: number; focus: THREE.Vector3 } | null = null;
  private replay: { playhead: number; to: number } | null = null;
  private replayPointTime = 0;
  /** Resolución adaptativa: si los cuadros van lentos, baja la densidad de píxeles. */
  private pixelRatio = Math.min(window.devicePixelRatio, 1.5);
  private slowFrames = 0;

  constructor(container: HTMLElement, private readonly sim: Simulation, uiRoot: HTMLElement) {
    this.renderer.setPixelRatio(this.pixelRatio);
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color('#141a26');
    this.scene.fog = new THREE.Fog('#141a26', 30, 60);
    this.camera.position.set(0, 11, 19);
    this.camera.lookAt(0, 0.5, 0);
    // Desarrollo: ?cam=x,y,z,lx,ly,lz fija la cámara (para revisar de cerca).
    const cam = new URLSearchParams(location.search).get('cam')?.split(',').map(Number);
    const fixed = cam?.length === 6 && cam.every(Number.isFinite);
    if (fixed) {
      this.camera.position.set(cam[0], cam[1], cam[2]);
      this.camera.lookAt(cam[3], cam[4], cam[5]);
    }
    this.director = new CameraDirector(this.camera, sim, !!fixed);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#445566', 0.7));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(5, 15, 8);
    this.scene.add(sun);

    this.arena = new Arena(sim.teams);
    this.scene.add(this.arena.group);
    this.buildCourt();
    this.buildPlayers();
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(COURT.ballRadius * 1.6, 20, 14), toon('#ffd23f'));
    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.18, 20),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35 }),
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ball, this.ballShadow);
    this.userRing.rotation.x = -Math.PI / 2;
    this.userRing.visible = false;
    this.scene.add(this.userRing);
    this.buildAim();
    this.fx = new Effects(this.camera);
    this.scene.add(this.fx.group);

    this.speedLines = new SpeedLines(uiRoot);
    this.flashEl.className = 'impact-flash';
    uiRoot.append(this.flashEl);
    this.badge.className = 'replay-badge';
    this.badge.textContent = 'REPETICIÓN';
    uiRoot.append(this.badge);

    this.frame = new Float32Array(this.animators.length * PER_RIG + 3);
    this.buffer = new ReplayBuffer(400, this.frame.length);
    this.listen();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    // Compilar los shaders ahora (también los de efectos aún invisibles) para evitar tirones la primera vez que aparecen.
    this.renderer.compile(this.scene, this.camera);
  }

  /** Punto del piso (y = 0) bajo el cursor, en coordenadas del mundo. */
  pickGround(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3());
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  get replaying(): boolean {
    return this.replay !== null;
  }

  skipReplay(): void {
    if (this.replay) this.endReplay();
  }

  render(dtReal: number): void {
    const now = performance.now() / 1000;
    this.adaptResolution(dtReal);
    const ballPos = new THREE.Vector3();
    if (this.replay) {
      this.replay.playhead += dtReal * REPLAY_SPEED;
      const f = this.buffer.frameAt(this.replay.playhead);
      if (f) this.applyFrame(f.data, ballPos);
      if (this.replay.playhead >= this.replay.to) this.endReplay();
    } else {
      for (const a of this.animators) a.update();
      const b = this.sim.ballPos;
      ballPos.set(b.x, b.y, b.z);
      this.serveBall(ballPos);
      this.captureFrame(ballPos);
      if (this.pendingReplay && this.sim.time >= this.pendingReplay.at) this.startReplay();
    }

    // Anillo bajo el jugador que está decidiendo.
    const deciding = this.replay ? null : this.sim.decision?.playerKey;
    this.userRing.visible = !!deciding;
    if (deciding) {
      const u = this.byKey.get(deciding)!.rig.root.position;
      this.userRing.position.set(u.x, 0.02, u.z);
    }
    this.ball.position.copy(ballPos);
    this.updateAim();
    this.updateSetMarkers();
    this.ballShadow.position.set(ballPos.x, 0.012, ballPos.z);

    const scale = this.replay ? REPLAY_SPEED : this.sim.timeScale;
    const ballSpeed = dtReal > 0 ? ballPos.distanceTo(this.prevBall) / (dtReal * Math.max(scale, 0.05)) : 0;
    this.prevBall.copy(ballPos);
    this.arena.update(now, dtReal);
    this.fx.update(ballPos, ballSpeed, now);
    this.speedLines.update(dtReal, !this.replay && this.sim.timeScale <= TUNING.decision.slowScale && this.sim.decision?.chosen != null ? 0.25 : 0);
    this.director.update(dtReal, ballPos);
    this.badge.style.opacity = this.replay ? '1' : '0';
    this.renderer.render(this.scene, this.camera);
  }

  // ---------- eventos ----------

  private listen(): void {
    this.sim.bus.on((e) => {
      const now = performance.now() / 1000;
      if (e.type === 'contact') {
        this.byKey.get(e.playerKey)?.onContact(e.kind, e.time);
        const b = this.sim.ballPos;
        const at = new THREE.Vector3(b.x, b.y, b.z);
        const hit = e.kind === 'attack' || e.kind === 'serve';
        // Golpe en rojo de la barra de fuerza: destello rojo, estela de fuego, sacudida y líneas de velocidad.
        const fire = hit && this.lastPower === 'strong';
        this.lastPower = null;
        const strong = hit && e.quality > 0.6;
        this.fx.impact(at, e.quality, strong || fire || e.kind === 'block', now, fire ? '#ff3b3b' : undefined);
        if (fire) {
          this.fx.fire(now + 1.2);
          this.director.punch(0.06, 0.3);
          this.speedLines.flash(1);
        }
        if (e.kind === 'attack') {
          this.lastAttackAt.copy(at);
          if (e.quality > 0.7) {
            this.director.punch(0.03);
            this.speedLines.flash(0.8);
          }
        }
        if (e.kind === 'block') {
          // Choque contra el bloqueo: chispas, onda, sacudida fuerte y destello blanco.
          const strength = e.quality >= 0.85 ? 1 : 0.6;
          this.fx.crash(at, strength, now);
          this.director.punch(0.05 + 0.04 * strength, 0.35);
          this.speedLines.flash(0.9);
          this.flashEl.classList.remove('on');
          void this.flashEl.offsetWidth;
          this.flashEl.classList.add('on');
        }
      } else if (e.type === 'decisionResolved') {
        this.lastPower = e.power ?? null;
      } else if (e.type === 'point') {
        for (const a of this.animators) a.onPoint(this.sim.player(a.key).team === e.winner, this.sim.time);
        const big = e.reason === 'ace' || e.reason === 'kill' || e.reason === 'blockKill';
        this.arena.cheer(e.winner, big);
        if (big) this.director.punch(0.05, 0.3);
        const replay = this.policy.shouldReplay(e.reason);
        if (replay) {
          const b = this.sim.ballPos;
          const focus = e.reason === 'ace' ? new THREE.Vector3(b.x, 0, b.z) : this.lastAttackAt.clone().setY(0);
          this.pendingReplay = { at: this.sim.time + REPLAY_AFTER, focus };
          this.replayPointTime = this.sim.time;
        }
      }
    });
  }

  /**
   * Antes del saque la pelota va en la mano izquierda del sacador (la simulación solo sabe dónde está el jugador).
   * En el último tramo del saque de la IA, la pelota sube desde la mano y baja al punto de golpe.
   */
  private serveBall(out: THREE.Vector3): void {
    if (this.sim.phase !== 'preServe') return;
    const key = this.sim.court(this.sim.match.serving)[0];
    const rig = this.byKey.get(key)!.rig;
    rig.root.updateMatrixWorld(true);
    const hand = rig.joints.elbowL.localToWorld(new THREE.Vector3(0, -DIMS.forearm - 0.09, 0.05));
    const countdown = this.sim.serveCountdown;
    if (countdown === null || countdown > SERVE_TOSS) {
      out.copy(hand);
      return;
    }
    const k = 1 - countdown / SERVE_TOSS;
    const p = this.sim.player(key).pos;
    const apex = 3.4;
    const contact = 2.7;
    const y = k < 0.65
      ? hand.y + (apex - hand.y) * (1 - (1 - k / 0.65) ** 2)
      : apex - (apex - contact) * ((k - 0.65) / 0.35) ** 2;
    out.set(hand.x + (p.x - hand.x) * k, y, hand.z + (p.z - hand.z) * k);
  }

  private buildAim(): void {
    const mat = this.aimMat;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.42, 32), mat);
    const barX = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.09), mat);
    const barZ = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 1.4), mat);
    this.aimCross.add(ring, barX, barZ);
    this.aimCross.rotation.x = -Math.PI / 2;
    this.aimSpread.rotation.x = -Math.PI / 2;
    for (const k of this.aimCross.children) k.renderOrder = 10;
    this.aimSpread.renderOrder = 10;
    this.aimGroup.add(this.aimCross, this.aimSpread, this.aimPath);
    this.aimGroup.visible = false;
    this.scene.add(this.aimGroup);
  }

  /**
   * Mira del usuario: cruz, círculo de dispersión y trayectoria punteada desde el punto de golpe.
   * Saque y remate: la cruz toma el color de la fuerza actual de la barra. Pase: amarillo. Defensa: solo la marca, azul.
   */
  /**
   * Abanico de colocación: un aro con el número sobre el punto de golpe de cada atacante disponible (y la segunda
   * sobre la red rival). El que saldría ahora se ilumina con el color del tempo de la barra.
   */
  private updateSetMarkers(): void {
    const d = this.replay ? null : this.sim.decision;
    const preview = this.sim.setPreview;
    const show = !!d && d.kind === 'set' && !!d.aim && preview !== null;
    let used = 0;
    if (show) {
      const seen = new Set<string>();
      const selected = d.options[preview].option;
      const selKey = selected.id === 'set' ? selected.choice.attackerKey : 'dump';
      const m = contactMeter(this.sim.time, d.contactTime!);
      const tempoColor = d.locked ? '#ffe14d' : POWER_COLORS[powerZone(m)];
      d.options.forEach((o, i) => {
        const key = o.option.id === 'set' ? o.option.choice.attackerKey : 'dump';
        if (seen.has(key)) return;
        seen.add(key);
        const at = this.sim.setOptionPoint(d, i);
        const marker = this.setMarker(used++);
        const on = key === selKey;
        const text = key === 'dump' ? 'SEGUNDA' : `#${this.sim.player(key).def.number}`;
        marker.group.position.set(at.x, 0, at.z);
        marker.ring.scale.setScalar(on ? 1.25 : 1);
        (marker.ring.material as THREE.MeshBasicMaterial).color.set(on ? tempoColor : '#ffffff');
        (marker.ring.material as THREE.MeshBasicMaterial).opacity = on ? 0.95 : 0.5;
        marker.label.position.y = 0.7;
        // El elegido muestra además el tempo con que saldría (alta, media, rápida).
        const tempo = on && selected.id === 'set' ? ` · ${TEMPO_LABELS[SET_TEMPO[selected.choice.option]]}` : '';
        this.setMarkerText(marker, text + tempo, on ? tempoColor : '#ffffff');
        marker.group.visible = true;
      });
    }
    for (let i = used; i < this.setMarkers.length; i++) this.setMarkers[i].group.visible = false;
  }

  private setMarker(i: number): SetMarker {
    while (this.setMarkers.length <= i) {
      const group = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.42, 0.55, 32),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, depthTest: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      ring.renderOrder = 9;
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      // Tamaño fijo en pantalla: legible de lejos y sin tapar la jugada de cerca.
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true, sizeAttenuation: false }));
      label.scale.set(0.16, 0.04, 1);
      label.renderOrder = 11;
      group.add(ring, label);
      group.visible = false;
      this.scene.add(group);
      this.setMarkers.push({ group, ring, label, canvas, texture, text: '' });
    }
    return this.setMarkers[i];
  }

  private setMarkerText(m: SetMarker, text: string, color: string): void {
    const key = `${text}|${color}`;
    if (m.text === key) return;
    m.text = key;
    const g = m.canvas.getContext('2d')!;
    g.clearRect(0, 0, 256, 64);
    g.fillStyle = 'rgba(10, 14, 24, 0.8)';
    g.beginPath();
    g.roundRect(4, 6, 248, 52, 14);
    g.fill();
    g.fillStyle = color;
    g.font = 'bold 30px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 33);
    m.texture.needsUpdate = true;
  }

  private updateAim(): void {
    const d = this.replay ? null : this.sim.decision;
    const up = this.sim.upcoming;
    const ready = d?.aim && (d.kind === 'serve' || d.kind === 'block' || (up && up.key === d.playerKey));
    if (!d?.aim || !ready) {
      this.aimGroup.visible = false;
      return;
    }
    this.aimGroup.visible = true;
    const { x, z } = d.aim;
    const inCourt = Math.abs(x) <= COURT.halfLength && Math.abs(z) <= COURT.halfWidth;
    this.aimCross.position.set(x, 0.03, z);
    this.aimSpread.position.set(x, 0.025, z);
    (this.aimSpread.material as THREE.MeshBasicMaterial).color.set(inCourt ? '#ffffff' : '#ff5a5a');
    const pathMat = this.aimPath.material as THREE.LineDashedMaterial;
    if (d.kind === 'block') {
      this.aimMat.color.set('#4dc3ff');
      this.aimSpread.scale.setScalar(TUNING.defense.focusRadius);
      (this.aimSpread.material as THREE.MeshBasicMaterial).color.set('#4dc3ff');
      this.aimPath.visible = false;
      return;
    }
    this.aimPath.visible = true;
    let color = '#ffe14d';
    if (d.meter === 'power') {
      const m = d.kind === 'serve' ? serveMeter(this.sim.time - d.startTime) : contactMeter(this.sim.time, d.contactTime!);
      color = POWER_COLORS[powerZone(m)];
    }
    this.aimMat.color.set(color);
    pathMat.color.set(color);
    // Origen, gravedad, duración y altura final de la trayectoria según la acción.
    const from = new THREE.Vector3();
    let tx = x;
    let tz = z;
    let T: number;
    let g = 9.81;
    let endY: number = COURT.ballRadius;
    let spread: number;
    if (d.kind === 'serve') {
      const p = this.sim.player(d.playerKey).pos;
      from.set(p.x, TUNING.serve.float.contactHeight, p.z);
      T = Math.max(0.6, Math.hypot(x - from.x, z - from.z) / TUNING.serve.float.speed);
      spread = TUNING.serve.float.noise * 0.35;
    } else if (d.kind === 'set') {
      // Colocación: la trayectoria va al atacante elegido (no a la mira), con el tiempo de vuelo de ese tempo.
      const i = this.sim.setPreview ?? 0;
      const opt = d.options[i].option;
      const at = this.sim.setOptionPoint(d, i);
      from.set(up!.point.x, up!.point.y, up!.point.z);
      tx = at.x;
      tz = at.z;
      T = opt.id === 'set' ? TUNING.set.flightTime[opt.choice.option] : TUNING.attack.tipFlightTime;
      endY = opt.id === 'set' ? 3.1 : COURT.ballRadius;
      spread = 0.3;
    } else if (d.kind === 'pass') {
      from.set(up!.point.x, up!.point.y, up!.point.z);
      T = Math.min(1.9, Math.max(1.0, 0.9 + Math.hypot(x - from.x, z - from.z) * 0.09));
      endY = TUNING.setHeight;
      spread = 0.6;
    } else {
      // Remate fuerte (tenso, con efecto) o finta (globo corto).
      const tip = Math.abs(x) < TUNING.attack.tipDepth;
      from.set(up!.point.x, up!.point.y, up!.point.z);
      T = tip ? TUNING.attack.tipFlightTime : Math.max(0.15, Math.hypot(x - from.x, z - from.z) / (TUNING.attack.minSpeed + TUNING.attack.speedRange * 0.5));
      g = tip ? 9.81 : 9.81 + TUNING.attack.gravityBonus;
      spread = TUNING.attack.noise * 0.35;
    }
    this.aimSpread.scale.setScalar(spread);
    const vy = (endY - from.y + 0.5 * g * T * T) / T;
    const pos = this.aimPath.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const t = (i / (pos.count - 1)) * T;
      pos.setXYZ(i, from.x + ((tx - from.x) * t) / T, from.y + vy * t - 0.5 * g * t * t, from.z + ((tz - from.z) * t) / T);
    }
    pos.needsUpdate = true;
    this.aimPath.computeLineDistances();
  }

  /** Más de ~1 s seguido por debajo de 45 fps: baja la resolución un paso (hasta 0.75). */
  private adaptResolution(dtReal: number): void {
    if (dtReal <= 0) return;
    this.slowFrames = dtReal > 1 / 45 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
    if (this.slowFrames > 60 && this.pixelRatio > 0.75) {
      this.pixelRatio = Math.max(0.75, this.pixelRatio - 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.slowFrames = 0;
    }
  }

  private startReplay(): void {
    const p = this.pendingReplay!;
    this.pendingReplay = null;
    this.replay = { playhead: Math.max(this.buffer.firstTime, this.replayPointTime - REPLAY_BEFORE), to: this.buffer.lastTime };
    this.director.startReplay(p.focus);
  }

  private endReplay(): void {
    this.replay = null;
    this.director.endReplay();
  }

  // ---------- grabación ----------

  private captureFrame(ball: THREE.Vector3): void {
    let o = 0;
    for (const a of this.animators) {
      const r = a.rig;
      this.frame[o++] = r.root.position.x;
      this.frame[o++] = r.root.position.z;
      this.frame[o++] = r.root.rotation.y;
      this.frame[o++] = r.body.position.y;
      this.frame[o++] = r.hips.position.y;
      for (const j of JOINTS) {
        const q = r.joints[j].quaternion;
        this.frame[o++] = q.x;
        this.frame[o++] = q.y;
        this.frame[o++] = q.z;
        this.frame[o++] = q.w;
      }
    }
    this.frame[o++] = ball.x;
    this.frame[o++] = ball.y;
    this.frame[o] = ball.z;
    this.buffer.push(this.sim.time, this.frame);
  }

  private applyFrame(data: Float32Array, ball: THREE.Vector3): void {
    let o = 0;
    for (const a of this.animators) {
      const r = a.rig;
      r.root.position.set(data[o], 0, data[o + 1]);
      r.root.rotation.y = data[o + 2];
      r.body.position.y = data[o + 3];
      r.hips.position.y = data[o + 4];
      o += 5;
      for (const j of JOINTS) {
        r.joints[j].quaternion.set(data[o], data[o + 1], data[o + 2], data[o + 3]);
        o += 4;
      }
    }
    ball.set(data[o], data[o + 1], data[o + 2]);
  }

  // ---------- construcción ----------

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private buildCourt(): void {
    const L = COURT.halfLength;
    const W = COURT.halfWidth;
    const court = new THREE.Mesh(new THREE.PlaneGeometry(L * 2, W * 2), toon('#d98c3f'));
    court.rotation.x = -Math.PI / 2;
    court.position.y = 0.005;
    this.scene.add(court);
    const lineMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const line = (cx: number, cz: number, sx: number, sz: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(cx, 0.01, cz);
      this.scene.add(m);
    };
    const t = 0.05;
    line(0, W, 2 * L, t);
    line(0, -W, 2 * L, t);
    line(L, 0, t, 2 * W);
    line(-L, 0, t, 2 * W);
    line(0, 0, t, 2 * W);
    line(COURT.attackLine, 0, t, 2 * W);
    line(-COURT.attackLine, 0, t, 2 * W);

    const net = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * W + 1, 1),
      new THREE.MeshBasicMaterial({ color: '#111111', transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    net.rotation.y = Math.PI / 2;
    net.position.set(0, COURT.netHeight - 0.5, 0);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 2 * W + 1), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    tape.position.set(0, COURT.netHeight, 0);
    this.scene.add(net, tape);
    for (const z of [-COURT.antennaZ, COURT.antennaZ]) {
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.8), new THREE.MeshBasicMaterial({ color: '#ff3355' }));
      antenna.position.set(0, COURT.netHeight - 0.1, z);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, COURT.netHeight + 0.2), toon('#cccccc'));
      post.position.set(0, (COURT.netHeight + 0.2) / 2, Math.sign(z) * (W + 1));
      this.scene.add(antenna, post);
    }
  }

  private buildPlayers(): void {
    for (const p of this.sim.players.values()) {
      const team = this.sim.teams[p.team];
      const rig = buildCharacter(lookFor(p.def, shirtName(p.def), team.primary, team.secondary, p.def.role === 'L'));
      // Estatura: diferencia exagerada un poco para que se note en la cancha.
      rig.root.scale.setScalar(1 + ((p.def.height - AVG_HEIGHT) / AVG_HEIGHT) * 1.6);
      const a = new Animator(p.key, rig, this.sim);
      this.animators.push(a);
      this.byKey.set(p.key, a);
      this.scene.add(rig.root);
    }
  }
}
