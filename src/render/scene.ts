import * as THREE from 'three';
import { landingTime, positionAt } from '../sim/ball';
import { COURT } from '../sim/court';
import { AVG_HEIGHT, isTall, shirtName } from '../sim/players';
import type { Simulation } from '../sim/rally';
import { SpeedLines } from '../ui/speedlines';
import { Animator } from './animator';
import { Arena } from './arena';
import { CameraDirector } from './camera';
import { DIMS, buildCharacter, lookFor, type Rig } from './character';
import { PlayerStatus } from './status';
import { Officials } from './officials';
import { Effects } from './fx';
import { JOINTS } from './pose';
import { ReplayBuffer, ReplayPolicy } from './replay';
import { TUNING } from '../sim/tuning';
import { SET_TEMPO, TEMPO_LABELS } from '../sim/actions';
import { meterOf, powerZone, type Power } from '../sim/decision';
import { toon } from './toon';

/**
 * Pelota de vóley: paneles curvos amarillos y azules con costuras finas (textura equirectangular dibujada en canvas).
 */
function ballTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f6f3e6';
  g.fillRect(0, 0, 512, 256);
  const bands = ['#ffcf2e', '#1f5fbf', '#f6f3e6'];
  // Tres grupos de paneles, cada uno con tres franjas onduladas.
  for (let group = 0; group < 3; group++) {
    const x0 = (group * 512) / 3;
    for (let b = 0; b < 3; b++) {
      g.fillStyle = bands[(b + group) % 3];
      g.beginPath();
      for (let y = 0; y <= 256; y += 4) {
        const wave = Math.sin((y / 256) * Math.PI * 2 + group) * 14;
        g.lineTo(x0 + b * 56 + wave, y);
      }
      for (let y = 256; y >= 0; y -= 4) {
        const wave = Math.sin((y / 256) * Math.PI * 2 + group) * 14;
        g.lineTo(x0 + (b + 1) * 56 + wave, y);
      }
      g.closePath();
      g.fill();
      g.strokeStyle = '#2b2b2b55';
      g.lineWidth = 2;
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Un cuadro de la malla de la red (10 cm): hilo oscuro sobre fondo transparente. */
function netTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(20, 20, 24, 0.85)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Franjas rojas y blancas de la antena (18 franjas de 10 cm). */
function antennaTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 36;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 18; i++) {
    g.fillStyle = i % 2 === 0 ? '#e01e2d' : '#ffffff';
    g.fillRect(0, i * 2, 4, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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
/** La repetición arranca un poco antes de la colocación (o del saque, si fue ace), y nunca más de 6 s atrás. */
const REPLAY_LEAD = 0.6;
const REPLAY_MAX = 6;
/** Un cuadro de repetición cada 1/60 s de juego (sin importar los fps ni la cámara lenta). */
const CAPTURE_STEP = 1 / 60;
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
  private readonly ball2: THREE.Mesh;
  private readonly ball2Shadow: THREE.Mesh;
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
  private readonly rigs = new Map<string, Rig>();
  private readonly spinAxis = new THREE.Vector3();
  private spinTime = 0;
  /** Online: tiempo de simulación entre el último paso fijo y este cuadro (lo pone el lockstep). */
  renderAhead: () => number = () => 0;
  private status: PlayerStatus | null = null;
  private officials: Officials | null = null;
  private readonly badge = document.createElement('div');
  private readonly buffer: ReplayBuffer;
  private readonly frame: Float32Array;
  private readonly policy = new ReplayPolicy();
  private readonly prevBall = new THREE.Vector3();
  private lastPower: Power | null = null;
  private lastAttackAt = new THREE.Vector3();
  private pendingReplay: { at: number; focus: THREE.Vector3; land: THREE.Vector3 } | null = null;
  private replay: { playhead: number; to: number } | null = null;
  private replayStart = 0;
  /** Tiempos de la jugada en curso: saque y última colocación (para que la repetición la muestre entera). */
  private rallyServe = 0;
  private rallySet = -Infinity;
  private lastCapture = -Infinity;
  private readonly mixed: Float32Array;
  /** Resolución adaptativa: si los cuadros van lentos, baja la densidad de píxeles. */
  private pixelRatio = Math.min(window.devicePixelRatio, window.matchMedia?.('(pointer: coarse)').matches ? 1.25 : 1.5);
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
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(COURT.ballRadius * 1.6, 32, 20), toon('#ffffff', ballTexture()));
    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.18, 20),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35 }),
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ball2 = new THREE.Mesh(this.ball.geometry, this.ball.material);
    this.ball2Shadow = new THREE.Mesh(this.ballShadow.geometry, this.ballShadow.material);
    this.ball2Shadow.rotation.x = -Math.PI / 2;
    this.ball2.visible = this.ball2Shadow.visible = false;
    this.scene.add(this.ball, this.ballShadow, this.ball2, this.ball2Shadow);
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
    this.buffer = new ReplayBuffer(Math.ceil((REPLAY_MAX * 2) / CAPTURE_STEP), this.frame.length);
    this.mixed = new Float32Array(this.frame.length);
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
      if (this.buffer.sample(this.replay.playhead, this.mixed, (a, b, k, out) => this.mixFrames(a, b, k, out))) this.applyFrame(this.mixed, ballPos);
      if (this.replay.playhead >= this.replay.to) this.endReplay();
    } else {
      for (const a of this.animators) a.update();
      const b = this.sim.ballPos;
      ballPos.set(b.x, b.y, b.z);
      // Online la simulación avanza en pasos fijos: la pelota se dibuja en el instante exacto del cuadro
      // (entre dos pasos), así no tiembla con la cámara lenta ni con distintas velocidades.
      const ahead = this.renderAhead();
      if (ahead > 0 && this.sim.phase === 'inPlay') {
        const p = positionAt(this.sim.ball, this.sim.time + ahead);
        ballPos.set(p.x, p.y, p.z);
      } else if (ahead > 0 && this.sim.phase === 'warmup') {
        // Calentamiento: el balón principal es el de la fila del equipo A (no la pelota del partido, que está quieta).
        const w = this.sim.warmupBallsAt(ahead);
        if (w) ballPos.set(w.A.x, w.A.y, w.A.z);
      }
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
    this.spinBall();
    this.updateAim();
    this.updateSetMarkers();
    this.ballShadow.position.set(ballPos.x, 0.012, ballPos.z);
    // Calentamiento: el segundo balón (el del equipo B) con su sombra.
    const warm = this.replay ? null : this.sim.warmupBallsAt(this.renderAhead());
    this.ball2.visible = this.ball2Shadow.visible = !!warm;
    if (warm) {
      this.ball2.position.set(warm.B.x, warm.B.y, warm.B.z);
      this.ball2Shadow.position.set(warm.B.x, 0.012, warm.B.z);
      this.ball2.rotation.x += 0.05;
    }

    const scale = this.replay ? REPLAY_SPEED : this.sim.timeScale;
    const ballSpeed = dtReal > 0 ? ballPos.distanceTo(this.prevBall) / (dtReal * Math.max(scale, 0.05)) : 0;
    this.prevBall.copy(ballPos);
    this.arena.update(now, dtReal);
    this.fx.update(ballPos, ballSpeed, now);
    this.status?.update(this.camera, now, !!this.replay);
    this.officials?.update();
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
        this.byKey.get(e.playerKey)?.onContact(e.kind, e.time, e.at);
        // En el calentamiento hay dos balones: el golpe trae su propio punto.
        const b = e.at ?? this.sim.ballPos;
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
        if (!e.warmup && e.kind === 'serve') {
          this.rallyServe = e.time;
          this.rallySet = -Infinity;
        }
        if (!e.warmup && e.kind === 'set') this.rallySet = e.time;
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
          const land = new THREE.Vector3(b.x, 0, b.z);
          const focus = e.reason === 'ace' ? land : this.lastAttackAt.clone().setY(0);
          this.pendingReplay = { at: this.sim.time + REPLAY_AFTER, focus, land };
          // Toda la jugada: desde un poco antes de la colocación (o del saque en un ace) hasta que pica.
          const from = e.reason === 'ace' || this.rallySet < this.rallyServe ? this.rallyServe : this.rallySet;
          this.replayStart = Math.max(from - REPLAY_LEAD, this.sim.time - REPLAY_MAX);
        }
      }
    });
  }

  /**
   * Antes del saque la pelota va en la mano izquierda del sacador (la simulación solo sabe dónde está el jugador).
   * En el último tramo del saque de la IA, la pelota sube desde la mano y baja al punto de golpe.
   */
  /**
   * Efecto de la pelota en vuelo: el remate y el saque en suspensión giran hacia adelante muy rápido, el pase y la
   * colocación apenas; el flotado no gira y baila de un lado a otro (el baile se apaga al llegar).
   */
  private spinBall(): void {
    const sim = this.sim;
    const t = sim.time;
    const dt = Math.max(0, t - this.spinTime);
    this.spinTime = t;
    if ((sim.phase !== 'inPlay' && sim.phase !== 'warmup') || this.replay) return;
    const kind = sim.lastContact?.kind;
    const v = sim.ball.v0;
    const flat = Math.hypot(v.x, v.z) || 1;
    const floater = kind === 'serve' && sim.servedType === 'float';
    if (floater) {
      const land = landingTime(sim.ball);
      const k = Math.min(1, Math.max(0, (t - sim.ball.t0) / Math.max(0.1, land - sim.ball.t0)));
      const sway = Math.sin(k * Math.PI) * 0.45 * Math.sin((t - sim.ball.t0) * Math.PI * 2 * 1.25);
      this.ball.position.x += (-v.z / flat) * sway;
      this.ball.position.z += (v.x / flat) * sway;
      return;
    }
    const rate = kind === 'attack' || (kind === 'serve' && sim.servedType === 'jump') ? 28 : kind === 'serve' ? 10 : 5;
    // Eje del efecto: horizontal y perpendicular a la dirección de vuelo (topspin).
    this.spinAxis.set(v.z / flat, 0, -v.x / flat);
    // Tope de giro por cuadro: muy rápido, la textura "parpadea" (efecto estroboscópico) y la pelota se ve deformada.
    this.ball.rotateOnWorldAxis(this.spinAxis, Math.min(rate * dt, 0.22));
  }

  private serveBall(out: THREE.Vector3): void {
    if (this.sim.phase !== 'preServe') return;
    const key = this.sim.court(this.sim.match.serving)[0];
    const rig = this.byKey.get(key)!.rig;
    rig.root.updateMatrixWorld(true);
    const hand = rig.joints.elbowL.localToWorld(new THREE.Vector3(0, -DIMS.forearm - 0.09, 0.05));
    const seq = this.sim.serveSequence;
    // El lanzamiento dura casi toda la secuencia; el de suspensión sube muchísimo más.
    const toss = seq ? TUNING.serveWindup[seq.type] * 0.92 : SERVE_TOSS;
    const countdown = seq ? seq.contactTime - this.sim.time : null;
    if (!seq || countdown === null || countdown > toss) {
      out.copy(hand);
      return;
    }
    const k = 1 - countdown / toss;
    const p = this.sim.player(key).pos;
    const apex = seq.type === 'jump' ? 6.2 : seq.type === 'float' ? 3.7 : 3.4;
    const contact = TUNING.serve[seq.type].contactHeight;
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
      const m = meterOf(d, this.sim.time);
      const tempoColor = d.locked ? '#ffe14d' : POWER_COLORS[powerZone(m)];
      d.options.forEach((o, i) => {
        const key = o.option.id === 'set' ? o.option.choice.attackerKey : 'dump';
        if (seen.has(key)) return;
        seen.add(key);
        const at = this.sim.setOptionPoint(d, i);
        const marker = this.setMarker(used++);
        const on = key === selKey;
        // Sin números: solo los aros; el elegido dice el tempo (o "segunda").
        const text = key === 'dump' ? (on ? 'SEGUNDA' : '') : '';
        marker.group.position.set(at.x, 0, at.z);
        marker.ring.scale.setScalar(on ? 1.25 : 1);
        (marker.ring.material as THREE.MeshBasicMaterial).color.set(on ? tempoColor : '#ffffff');
        (marker.ring.material as THREE.MeshBasicMaterial).opacity = on ? 0.95 : 0.5;
        marker.label.position.y = 0.7;
        // El elegido muestra además el tempo con que saldría (alta, media, rápida).
        const tempo = on && selected.id === 'set' ? TEMPO_LABELS[SET_TEMPO[selected.choice.option]] : '';
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
    if (!text) {
      (m.label.material as THREE.SpriteMaterial).map!.needsUpdate = true;
      return;
    }
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
    // En el calentamiento cada equipo tiene su propia jugada: se busca la del jugador que decide.
    const up = this.sim.phase === 'warmup' && d ? this.sim.upcomingFor(d.playerKey) : this.sim.upcoming;
    const ready = d?.aim && (d.kind === 'serve' || d.kind === 'block' || (up && up.key === d.playerKey));
    if (!d?.aim || !ready) {
      this.aimGroup.visible = false;
      return;
    }
    this.aimGroup.visible = true;
    // Online: la mira de esta pantalla se dibuja al instante (la oficial llega unos ms después).
    const { x, z } = this.sim.localAim ?? d.aim;
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
      const m = meterOf(d, this.sim.time);
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
      const tall = isTall(this.sim.player(d.playerKey).def);
      // Adelante: finta mientras la barra está en verde; en amarillo o rojo, remate en picada.
      const front = Math.abs(x) < (tall ? TUNING.attack.tallTipDepth : TUNING.attack.tipDepth);
      const tip = front && powerZone(meterOf(d, this.sim.time)) === 'soft';
      from.set(up!.point.x, up!.point.y, up!.point.z);
      T = tip ? TUNING.attack.tipFlightTime : Math.max(0.15, Math.hypot(x - from.x, z - from.z) / (TUNING.attack.minSpeed + TUNING.attack.speedRange * 0.5));
      g = tip ? 9.81 : 9.81 + TUNING.attack.gravityBonus + (tall ? TUNING.attack.tallGravity : 0) + (front ? TUNING.attack.frontGravity : 0);
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
    this.replay = { playhead: Math.max(this.buffer.firstTime, this.replayStart), to: this.buffer.lastTime };
    this.director.startReplay(p.focus, p.land);
  }

  private endReplay(): void {
    this.replay = null;
    this.director.endReplay();
  }

  // ---------- grabación ----------

  private captureFrame(ball: THREE.Vector3): void {
    // Por tiempo de juego: la cámara lenta no llena el búfer ni lo deja corto.
    if (this.sim.time - this.lastCapture < CAPTURE_STEP && this.sim.time >= this.lastCapture) return;
    this.lastCapture = this.sim.time;
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

  /** Mezcla dos cuadros: posiciones en línea recta, giros por el camino corto y articulaciones normalizadas. */
  private mixFrames(a: Float32Array, b: Float32Array, k: number, out: Float32Array): void {
    for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * k;
    const stride = 5 + JOINTS.length * 4;
    for (let p = 0; p < this.animators.length; p++) {
      const i = p * stride + 2;
      const d = Math.atan2(Math.sin(b[i] - a[i]), Math.cos(b[i] - a[i]));
      out[i] = a[i] + d * k;
    }
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
        r.joints[j].quaternion.set(data[o], data[o + 1], data[o + 2], data[o + 3]).normalize();
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
    // Pantalla más angosta que 3:2 (tablet, teléfono en vertical): se abre el ángulo para ver el mismo ancho de cancha.
    const wide = 1.5;
    this.camera.fov = w / h >= wide ? 45 : Math.min(105, (2 * Math.atan(Math.tan((45 * Math.PI) / 360) * (wide / (w / h))) * 180) / Math.PI);
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

    // Bancas de los suplentes (asiento a 45 cm), una por equipo.
    for (const side of [-1, 1]) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.08, 0.42), toon('#c9ccd4'));
      bench.position.set(side * 5.9, 0.45, -6.62);
      const legs = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.41, 0.3), toon('#5d6270'));
      legs.position.set(side * 5.9, 0.2, -6.62);
      this.scene.add(bench, legs);
    }
    // Red de malla: cuadros de 10 cm (textura repetida con transparencia), banda blanca arriba y abajo.
    const netW = 2 * W + 1;
    const mesh = netTexture();
    mesh.repeat.set(netW * 10, 10);
    const net = new THREE.Mesh(
      new THREE.PlaneGeometry(netW, 1),
      new THREE.MeshBasicMaterial({ map: mesh, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    net.rotation.y = Math.PI / 2;
    net.position.set(0, COURT.netHeight - 0.5, 0);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, netW), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    tape.position.set(0, COURT.netHeight, 0);
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.05, netW), new THREE.MeshBasicMaterial({ color: '#f2f2f2' }));
    bottom.position.set(0, COURT.netHeight - 1, 0);
    this.scene.add(net, tape, bottom);
    // Antenas reglamentarias: 1.8 m, franjas rojas y blancas de 10 cm, 80 cm sobre la red.
    const stripes = antennaTexture();
    for (const z of [-COURT.antennaZ, COURT.antennaZ]) {
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.8, 10), new THREE.MeshBasicMaterial({ map: stripes }));
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
      this.rigs.set(p.key, rig);
    }
    this.status = new PlayerStatus(this.sim, this.rigs);
    this.scene.add(this.status.group);
    this.officials = new Officials(this.sim);
    this.scene.add(this.officials.group);
  }
}
