import * as THREE from 'three';
import { COURT } from '../sim/court';
import type { Simulation } from '../sim/rally';
import type { Timing } from '../sim/resolver';
import { SpeedLines } from '../ui/speedlines';
import { Animator } from './animator';
import { Arena } from './arena';
import { CameraDirector } from './camera';
import { buildCharacter, lookFor } from './character';
import { Effects } from './fx';
import { JOINTS } from './pose';
import { ReplayBuffer, ReplayPolicy } from './replay';
import { TUNING } from '../sim/tuning';
import { toon } from './toon';

/** Floats por personaje en un cuadro de repetición: raíz x/z, giro, salto, cadera y un cuaternión por articulación. */
const PER_RIG = 5 + JOINTS.length * 4;
/** Segundos de juego antes y después del punto que muestra la repetición. */
const REPLAY_BEFORE = 1.6;
const REPLAY_AFTER = 0.4;
const REPLAY_SPEED = 0.45;

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
  private readonly userRing = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.6, 32),
    new THREE.MeshBasicMaterial({ color: '#ffe14d', side: THREE.DoubleSide }),
  );
  private readonly arena: Arena;
  private readonly fx: Effects;
  private readonly director: CameraDirector;
  private readonly speedLines: SpeedLines;
  private readonly badge = document.createElement('div');
  private readonly buffer: ReplayBuffer;
  private readonly frame: Float32Array;
  private readonly policy = new ReplayPolicy(3);
  private readonly prevBall = new THREE.Vector3();
  private lastAttackQuality = 0;
  private lastAttackAt = new THREE.Vector3();
  private lastUserTiming: Timing | null = null;
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
    this.userRing.visible = sim.userKey !== null;
    this.scene.add(this.userRing);
    this.fx = new Effects(this.camera);
    this.scene.add(this.fx.group);

    this.speedLines = new SpeedLines(uiRoot);
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
      this.captureFrame(ballPos);
      if (this.pendingReplay && this.sim.time >= this.pendingReplay.at) this.startReplay();
    }

    if (this.sim.userKey) {
      const u = this.byKey.get(this.sim.userKey)!.rig.root.position;
      this.userRing.position.set(u.x, 0.02, u.z);
    }
    this.ball.position.copy(ballPos);
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
        if (e.kind === 'serve') {
          this.lastUserTiming = null;
          this.lastAttackQuality = 0;
        }
        const b = this.sim.ballPos;
        const at = new THREE.Vector3(b.x, b.y, b.z);
        const strong = (e.kind === 'attack' || e.kind === 'serve') && e.quality > 0.6;
        this.fx.impact(at, e.quality, strong || e.kind === 'block', now);
        if (e.kind === 'attack') {
          this.lastAttackQuality = e.quality;
          this.lastAttackAt.copy(at);
          if (e.quality > 0.7) {
            this.director.punch(0.12);
            this.speedLines.flash(0.8);
          }
        }
        if (e.kind === 'block') {
          this.director.punch(0.15);
          this.speedLines.flash(0.6);
        }
      } else if (e.type === 'decisionResolved') {
        this.lastUserTiming = e.timing;
      } else if (e.type === 'point') {
        for (const a of this.animators) a.onPoint(this.sim.player(a.key).team === e.winner, this.sim.time);
        const big = e.reason === 'ace' || e.reason === 'kill' || e.reason === 'blockKill';
        this.arena.cheer(e.winner, big);
        if (big) this.director.punch(0.2, 0.4);
        const replay = this.policy.shouldReplay({
          reason: e.reason,
          attackQuality: this.lastAttackQuality,
          userPerfect: this.lastUserTiming === 'perfect',
          userWon: this.sim.userKey !== null && e.winner === 'A',
        });
        if (replay) {
          const b = this.sim.ballPos;
          const focus = e.reason === 'ace' ? new THREE.Vector3(b.x, 0, b.z) : this.lastAttackAt.clone().setY(0);
          this.pendingReplay = { at: this.sim.time + REPLAY_AFTER, focus };
          this.replayPointTime = this.sim.time;
        }
      }
    });
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
      const rig = buildCharacter(lookFor(p.key, p.def.number, team.primary, team.secondary, p.def.role === 'L'));
      const a = new Animator(p.key, rig, this.sim);
      this.animators.push(a);
      this.byKey.set(p.key, a);
      this.scene.add(rig.root);
    }
  }
}
