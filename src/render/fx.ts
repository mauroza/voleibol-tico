import * as THREE from 'three';

const TRAIL = 18;

/**
 * Efectos anime en la escena: estela de la pelota cuando va rápida y destellos de impacto en cada contacto.
 */
export class Effects {
  readonly group = new THREE.Group();
  private readonly history: THREE.Vector3[] = [];
  private readonly trail: THREE.InstancedMesh;
  private readonly bursts: { mesh: THREE.Mesh; born: number; size: number }[] = [];
  private readonly m = new THREE.Matrix4();
  private fireUntil = 0;

  constructor(private readonly camera: THREE.Camera) {
    this.trail = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.16, 10, 8),
      new THREE.MeshBasicMaterial({ color: '#fff3b0', transparent: true, opacity: 0.45, depthWrite: false }),
      TRAIL,
    );
    this.trail.frustumCulled = false;
    this.group.add(this.trail);
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.8, 24),
        new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
      );
      mesh.visible = false;
      this.bursts.push({ mesh, born: -10, size: 1 });
      this.group.add(mesh);
    }
  }

  /** Destello en el punto de contacto; más grande y dorado con más calidad o potencia. */
  impact(at: THREE.Vector3, quality: number, strong: boolean, now: number, color?: string): void {
    const b = this.bursts.reduce((oldest, x) => (x.born < oldest.born ? x : oldest));
    b.born = now;
    b.size = (strong ? 1.6 : 0.9) * (0.6 + quality * 0.6);
    b.mesh.position.copy(at);
    (b.mesh.material as THREE.MeshBasicMaterial).color.set(color ?? (quality > 0.8 ? '#ffd23f' : '#ffffff'));
    b.mesh.visible = true;
  }

  /** Golpe rojo (máxima fuerza): estela roja y más gruesa hasta `until` (segundos reales). */
  fire(until: number): void {
    this.fireUntil = until;
  }

  /** `now` en segundos reales: los efectos de pantalla no se ralentizan con la cámara lenta. */
  update(ball: THREE.Vector3, ballSpeed: number, now: number): void {
    this.history.unshift(ball.clone());
    if (this.history.length > TRAIL) this.history.pop();
    const show = ballSpeed > 11;
    const fire = now < this.fireUntil;
    (this.trail.material as THREE.MeshBasicMaterial).color.set(fire ? '#ff4a2a' : '#fff3b0');
    (this.trail.material as THREE.MeshBasicMaterial).opacity = fire ? 0.7 : 0.45;
    for (let i = 0; i < TRAIL; i++) {
      const p = this.history[i] ?? ball;
      const s = show ? (1 - i / TRAIL) * (fire ? 1.5 : 0.9) : 0;
      this.m.makeScale(s, s, s).setPosition(p);
      this.trail.setMatrixAt(i, this.m);
    }
    this.trail.instanceMatrix.needsUpdate = true;

    for (const b of this.bursts) {
      const age = now - b.born;
      if (age > 0.35) {
        b.mesh.visible = false;
        continue;
      }
      const k = age / 0.35;
      b.mesh.scale.setScalar(b.size * (0.3 + k * 1.2));
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
      b.mesh.quaternion.copy(this.camera.quaternion);
    }
  }
}
