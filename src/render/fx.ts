import * as THREE from 'three';

const TRAIL = 18;
const SPARKS = 36;
const SPARK_LIFE = 0.55;

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
  /** Chispas del choque contra el bloqueo. */
  private readonly sparks: THREE.InstancedMesh;
  private readonly spark = Array.from({ length: SPARKS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), born: -10 }));
  private lastUpdate = 0;

  constructor(private readonly camera: THREE.Camera) {
    this.trail = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.16, 10, 8),
      new THREE.MeshBasicMaterial({ color: '#fff3b0', transparent: true, opacity: 0.45, depthWrite: false }),
      TRAIL,
    );
    this.trail.frustumCulled = false;
    this.group.add(this.trail);
    this.sparks = new THREE.InstancedMesh(
      new THREE.TetrahedronGeometry(0.06),
      new THREE.MeshBasicMaterial({ color: '#fff1b8', transparent: true, opacity: 0.95, depthWrite: false }),
      SPARKS,
    );
    this.sparks.frustumCulled = false;
    this.group.add(this.sparks);
    for (let i = 0; i < 8; i++) {
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

  /**
   * Choque del remate contra el bloqueo: doble onda expansiva y chispas que salen de las manos.
   * `strength` 0..1 (tapa = 1, toque = 0.6).
   */
  crash(at: THREE.Vector3, strength: number, now: number): void {
    this.impact(at, 1, true, now, '#ffffff');
    const ring = this.bursts.reduce((oldest, x) => (x.born < oldest.born ? x : oldest));
    ring.born = now + 0.07;
    ring.size = 2.6 * (0.6 + strength * 0.6);
    ring.mesh.position.copy(at);
    (ring.mesh.material as THREE.MeshBasicMaterial).color.set('#ffd23f');
    const n = Math.round(SPARKS * (0.5 + strength * 0.5));
    for (let i = 0; i < n; i++) {
      const s = this.spark[i];
      s.born = now;
      s.p.copy(at);
      // Abanico en el plano de la red, con algo de profundidad.
      const a = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 5 * (0.6 + strength * 0.4);
      s.v.set((Math.random() - 0.5) * 3, Math.sin(a) * speed + 2, Math.cos(a) * speed);
    }
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

    const dt = Math.min(0.05, Math.max(0, now - this.lastUpdate));
    this.lastUpdate = now;
    for (let i = 0; i < SPARKS; i++) {
      const s = this.spark[i];
      const age = now - s.born;
      let k = 0;
      if (age >= 0 && age < SPARK_LIFE) {
        s.v.y -= 9.8 * dt;
        s.p.addScaledVector(s.v, dt);
        k = 1 - age / SPARK_LIFE;
      }
      this.m.makeRotationFromEuler(new THREE.Euler(age * 9 + i, age * 7, 0)).scale(new THREE.Vector3(k, k, k)).setPosition(s.p);
      this.sparks.setMatrixAt(i, this.m);
    }
    this.sparks.instanceMatrix.needsUpdate = true;

    for (const b of this.bursts) {
      const age = now - b.born;
      if (age < 0) {
        b.mesh.visible = false;
        continue;
      }
      b.mesh.visible = true;
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
