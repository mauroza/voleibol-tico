import * as THREE from 'three';
import type { TeamDef } from '../data/teams';
import type { TeamId } from '../sim/court';
import { toon, toonMesh } from './toon';

/** Bandera de Costa Rica: azul, blanco, rojo (doble), blanco, azul. */
function flagTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 120;
  c.height = 72;
  const g = c.getContext('2d')!;
  const bands: [string, number][] = [['#002b7f', 12], ['#ffffff', 12], ['#ce1126', 24], ['#ffffff', 12], ['#002b7f', 12]];
  let y = 0;
  for (const [color, h] of bands) {
    g.fillStyle = color;
    g.fillRect(0, y, 120, h);
    y += h;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bannerTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 128);
  g.fillStyle = fg;
  // El tamaño de letra se ajusta para que el texto quepa en el ancho de la manta.
  let size = 78;
  g.font = `italic 900 ${size}px system-ui, sans-serif`;
  const width = g.measureText(text).width;
  if (width > 960) size = Math.floor(size * (960 / width));
  g.font = `italic 900 ${size}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 512, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Fan {
  x: number;
  y: number;
  z: number;
  side: TeamId;
  phase: number;
  /** Ritmo propio de cada persona: así la tribuna no salta toda junta. */
  rate: number;
  /** Fans que miran hacia la cancha: rotación en y. */
  yaw: number;
}

const FAN_BODY = new THREE.CapsuleGeometry(0.2, 0.42, 2, 6);
const FAN_HEAD = new THREE.SphereGeometry(0.15, 7, 5);
const SHIRT_EXTRA = ['#ffffff', '#ffffff', '#1d2b4f', '#e8e8e8'];
const SKINS = ['#f6d3b3', '#eebf98', '#d9a477', '#b97f55', '#8a5a3b'];

/**
 * Gimnasio: zona libre, paredes, gradas a ambos lados con público instanciado en los colores de cada equipo,
 * mantas con los nombres de los equipos y banderas ticas. `update` anima al público según la emoción de cada lado.
 */
export class Arena {
  readonly group = new THREE.Group();
  private readonly fans: Fan[] = [];
  private readonly bodies: THREE.InstancedMesh;
  private readonly heads: THREE.InstancedMesh;
  private readonly flags: THREE.Mesh[] = [];
  private readonly excitement: Record<TeamId, number> = { A: 0.2, B: 0.2 };
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly p = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(teams: Record<TeamId, TeamDef>) {
    this.buildHall();
    const rowsFar = this.buildStand(-1, 6);
    const rowsNear = this.buildStand(1, 3);
    const total = this.fans.length;
    this.bodies = new THREE.InstancedMesh(FAN_BODY, toon('#ffffff'), total);
    this.heads = new THREE.InstancedMesh(FAN_HEAD, toon('#ffffff'), total);
    let h = 7;
    const rand = () => {
      h = (h * 16807) % 2147483647;
      return h / 2147483647;
    };
    this.fans.forEach((f, i) => {
      const team = teams[f.side];
      const shirt = rand() < 0.75 ? (rand() < 0.7 ? team.primary : team.secondary) : SHIRT_EXTRA[Math.floor(rand() * SHIRT_EXTRA.length)];
      this.bodies.setColorAt(i, new THREE.Color(shirt));
      this.heads.setColorAt(i, new THREE.Color(SKINS[Math.floor(rand() * SKINS.length)]));
    });
    this.group.add(this.bodies, this.heads);
    this.buildBanners(teams, rowsFar, rowsNear);
    this.update(0);
  }

  /** Un equipo hizo un punto: su lado de la tribuna salta; grande = punto espectacular. */
  cheer(side: TeamId, big: boolean): void {
    this.excitement[side] = big ? 1 : 0.75;
  }

  /** Último instante en que se movió al público (se anima a 30 cuadros por segundo: no hace falta más). */
  private crowdAt = -1;

  update(t: number, dt = 0): void {
    for (const s of ['A', 'B'] as const) this.excitement[s] = Math.max(0.15, this.excitement[s] - dt * 0.35);
    this.updateFlags(t);
    if (t - this.crowdAt < 1 / 30 && t >= this.crowdAt) return;
    this.crowdAt = t;
    this.fans.forEach((f, i) => {
      const e = this.excitement[f.side];
      // Solo los más emocionados saltan, cada uno a su ritmo; el resto se mueve poco.
      const bounce = Math.max(0, Math.sin(t * f.rate * (0.8 + e) + f.phase)) * 0.16 * e * e;
      const sway = Math.sin(t * 1.3 + f.phase) * 0.05;
      this.q.setFromAxisAngle(this.up, f.yaw);
      this.m.compose(this.p.set(f.x + sway, f.y + 0.42 + bounce, f.z), this.q, this.one);
      this.bodies.setMatrixAt(i, this.m);
      this.m.compose(this.p.set(f.x + sway, f.y + 0.88 + bounce, f.z), this.q, this.one);
      this.heads.setMatrixAt(i, this.m);
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }

  private updateFlags(t: number): void {
    this.flags.forEach((flag, i) => {
      flag.rotation.z = Math.sin(t * 3 + i) * 0.35;
      flag.rotation.y = Math.sin(t * 2.2 + i * 1.7) * 0.3;
    });
  }

  private buildHall(): void {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(36, 22), toon('#2c5d9c'));
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);
    const wall = toon('#2a2f3d');
    for (const x of [-18, 18]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.5, 12, 34), wall);
      w.position.set(x, 6, 0);
      this.group.add(w);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(36, 12, 0.5), wall);
    back.position.set(0, 6, -16.5);
    this.group.add(back);
    // Techo con lámparas
    for (let x = -12; x <= 12; x += 6) {
      for (const z of [-4, 4]) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.15, 0.7), new THREE.MeshBasicMaterial({ color: '#fff6d6' }));
        lamp.position.set(x, 11.5, z);
        this.group.add(lamp);
      }
    }
  }

  /** Gradas detrás de una banda (dir −1 = lado lejano, +1 = lado de la cámara). Devuelve la altura de la última fila. */
  private buildStand(dir: 1 | -1, rows: number): number {
    const stepMat = toon('#3a4155');
    const zStart = dir * 9.2;
    let top = 0;
    for (let r = 0; r < rows; r++) {
      const y = 0.45 * (r + 1);
      const z = zStart + dir * r * 0.85;
      const step = new THREE.Mesh(new THREE.BoxGeometry(30, 0.45, 0.85), stepMat);
      step.position.set(0, y - 0.225, z);
      this.group.add(step);
      // Cada lado de la tribuna apoya al equipo que juega de ese lado de la red.
      for (let x = -14; x <= 14; x += 0.62) {
        if (Math.abs(x) < 0.5) continue;
        this.fans.push({
          x: x + Math.sin(r * 7.3 + x * 3.1) * 0.08,
          y,
          z,
          side: x < 0 ? 'A' : 'B',
          phase: (x * 12.9898 + r * 78.233) % (Math.PI * 2),
          rate: 3 + (Math.abs(Math.sin(x * 4.7 + r * 1.3)) * 3),
          yaw: dir === -1 ? 0 : Math.PI,
        });
      }
      top = y;
    }
    return top;
  }

  private buildBanners(teams: Record<TeamId, TeamDef>, farTop: number, nearTop: number): void {
    const banner = (text: string, bg: string, fg: string, x: number, y: number, z: number, w: number, yaw = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 8), new THREE.MeshBasicMaterial({ map: bannerTexture(text, bg, fg) }));
      m.position.set(x, y, z);
      m.rotation.y = yaw;
      this.group.add(m);
    };
    const backZ = -9.2 - 6 * 0.85 - 0.6;
    banner(`¡VAMOS ${teams.A.name.toUpperCase()}!`, teams.A.primary, '#ffffff', -7.5, farTop + 1.6, backZ, 12);
    banner(`¡VAMOS ${teams.B.name.toUpperCase()}!`, teams.B.primary, '#ffffff', 7.5, farTop + 1.6, backZ, 12);
    banner('PURA VIDA · LIGA NACIONAL DE VOLEIBOL', '#002b7f', '#ffffff', 0, 9.5, -16.2, 22);
    // Bandera grande en la pared del fondo y banderitas en la tribuna
    const big = new THREE.Mesh(new THREE.PlaneGeometry(8, 4.8), new THREE.MeshBasicMaterial({ map: flagTexture() }));
    big.position.set(0, 6, -16.2);
    this.group.add(big);
    const flagTex = flagTexture();
    for (const [x, side] of [[-11, -1], [-4, -1], [5, -1], [12, -1], [-8, 1], [9, 1]] as const) {
      const pole = toonMesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 6), '#dddddd', false);
      const rows = side === -1 ? 6 : 3;
      const y = (side === -1 ? farTop : nearTop) - 0.45 * Math.floor(rows / 2) + 1.3;
      const z = side * (9.2 + 0.85 * Math.floor(rows / 2));
      pole.position.set(x, y, z);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6), new THREE.MeshBasicMaterial({ map: flagTex, side: THREE.DoubleSide }));
      flag.geometry.translate(0.5, 0, 0);
      flag.position.set(x, y + 0.45, z);
      this.flags.push(flag);
      this.group.add(pole, flag);
    }
  }
}
