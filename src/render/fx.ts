import * as THREE from 'three';

/** Puntos de la cinta de la estela (los últimos cuadros de la pelota). */
const TRAIL = 26;
const SPARKS = 36;
const SPARK_LIFE = 0.55;

/**
 * Efectos anime en la escena: estela de la pelota cuando va rápida y destellos de impacto en cada contacto.
 */
export class Effects {
  readonly group = new THREE.Group();
  private readonly history: THREE.Vector3[] = Array.from({ length: TRAIL }, () => new THREE.Vector3());
  private filled = 0;
  /** Estela: cinta que mira a la cámara, ancha y brillante junto a la pelota y fina y transparente al final. */
  private readonly trail: THREE.Mesh;
  private readonly trailPos = new Float32Array(TRAIL * 2 * 3);
  private readonly trailCol = new Float32Array(TRAIL * 2 * 3);
  /** 0..1: la estela aparece y se va suave (no de golpe al cambiar la velocidad). */
  private trailAlpha = 0;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly bursts: { mesh: THREE.Mesh; born: number; size: number }[] = [];
  private readonly m = new THREE.Matrix4();
  private fireUntil = 0;
  /** Chispas del choque contra el bloqueo. */
  private readonly sparks: THREE.InstancedMesh;
  private readonly spark = Array.from({ length: SPARKS }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), born: -10 }));
  private lastUpdate = 0;

  constructor(private readonly camera: THREE.Camera) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
    const index: number[] = [];
    for (let i = 0; i < TRAIL - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(index);
    // Suma de luz (aditiva): el negro es transparente, así el color por vértice hace de transparencia.
    this.trail = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 5;
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
    // Historia sin crear objetos: el último punto pasa a ser el primero.
    const last = this.history.pop()!;
    this.history.unshift(last.copy(ball));
    this.filled = Math.min(TRAIL, this.filled + 1);
    // Un salto grande (la pelota vuelve a la mano del sacador, o empieza una repetición) borra la estela.
    if (this.history[1].distanceToSquared(ball) > 9) this.filled = 1;
    const fire = now < this.fireUntil;
    const target = ballSpeed > 10 ? Math.min(1, (ballSpeed - 10) / 8) : 0;
    this.trailAlpha += (target - this.trailAlpha) * 0.25;
    this.color.set(fire ? '#ff5a2a' : '#ffe9a8');
    const width = (fire ? 0.2 : 0.13) * (0.6 + this.trailAlpha * 0.4);
    const cam = this.camera.position;
    for (let i = 0; i < TRAIL; i++) {
      const p = this.history[Math.min(i, this.filled - 1)];
      const q = this.history[Math.min(i + 1, this.filled - 1)];
      // Ancho perpendicular a la dirección de la estela y a la cámara: siempre se ve de frente.
      this.tmpA.subVectors(p, q);
      if (this.tmpA.lengthSq() < 1e-8) this.tmpA.set(1, 0, 0);
      this.tmpB.subVectors(cam, p).cross(this.tmpA).normalize();
      const k = i / (TRAIL - 1);
      const w = width * (1 - k) ** 1.3;
      const glow = this.trailAlpha * (1 - k) ** 1.6 * (i < this.filled ? 1 : 0);
      for (const side of [0, 1]) {
        const s = side ? -w : w;
        const o = (i * 2 + side) * 3;
        this.trailPos[o] = p.x + this.tmpB.x * s;
        this.trailPos[o + 1] = p.y + this.tmpB.y * s;
        this.trailPos[o + 2] = p.z + this.tmpB.z * s;
        this.trailCol[o] = this.color.r * glow;
        this.trailCol[o + 1] = this.color.g * glow;
        this.trailCol[o + 2] = this.color.b * glow;
      }
    }
    this.trail.geometry.attributes.position.needsUpdate = true;
    this.trail.geometry.attributes.color.needsUpdate = true;

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
