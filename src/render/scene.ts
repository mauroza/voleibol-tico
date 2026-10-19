import * as THREE from 'three';
import { COURT } from '../sim/court';
import type { Simulation } from '../sim/rally';

const PLAYER_RADIUS = 0.3;
const PLAYER_HEIGHT = 1.85;

/** Vista de fase 1: cápsulas, esfera y cancha plana. Solo lee la simulación. */
export class MatchView {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  private readonly playerMeshes = new Map<string, THREE.Mesh>();
  private readonly ball: THREE.Mesh;
  private readonly ballShadow: THREE.Mesh;

  constructor(container: HTMLElement, private readonly sim: Simulation) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color('#1b2333');
    this.camera.position.set(0, 11, 19);
    this.camera.lookAt(0, 0.5, 0);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#445566', 1.2));
    const sun = new THREE.DirectionalLight('#ffffff', 1.5);
    sun.position.set(5, 15, 8);
    this.scene.add(sun);
    this.buildCourt();
    this.buildPlayers();
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(COURT.ballRadius * 1.6, 20, 14), new THREE.MeshStandardMaterial({ color: '#ffd23f' }));
    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.18, 20),
      new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35 }),
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ball, this.ballShadow);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  render(): void {
    for (const p of this.sim.players.values()) {
      this.playerMeshes.get(p.key)!.position.set(p.pos.x, PLAYER_HEIGHT / 2, p.pos.z);
    }
    const b = this.sim.ballPos;
    this.ball.position.set(b.x, b.y, b.z);
    this.ballShadow.position.set(b.x, 0.012, b.z);
    this.renderer.render(this.scene, this.camera);
  }

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
    const flat = (geo: THREE.BufferGeometry, color: string, y: number) => {
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      this.scene.add(m);
      return m;
    };
    flat(new THREE.PlaneGeometry(40, 30), '#2b3a4f', 0);
    flat(new THREE.PlaneGeometry(L * 2, W * 2), '#d98c3f', 0.005);
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
      new THREE.MeshStandardMaterial({ color: '#111111', transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    );
    net.rotation.y = Math.PI / 2;
    net.position.set(0, COURT.netHeight - 0.5, 0);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 2 * W + 1), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    tape.position.set(0, COURT.netHeight, 0);
    this.scene.add(net, tape);
    for (const z of [-COURT.antennaZ, COURT.antennaZ]) {
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.8), new THREE.MeshBasicMaterial({ color: '#ff3355' }));
      antenna.position.set(0, COURT.netHeight - 0.1, z);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, COURT.netHeight + 0.2), new THREE.MeshStandardMaterial({ color: '#cccccc' }));
      post.position.set(0, (COURT.netHeight + 0.2) / 2, Math.sign(z) * (W + 1));
      this.scene.add(antenna, post);
    }
  }

  private buildPlayers(): void {
    const geo = new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HEIGHT - 2 * PLAYER_RADIUS, 4, 10);
    for (const p of this.sim.players.values()) {
      const team = this.sim.teams[p.team];
      const color = p.def.role === 'L' ? team.secondary : team.primary;
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color }));
      this.playerMeshes.set(p.key, mesh);
      this.scene.add(mesh);
    }
  }
}
