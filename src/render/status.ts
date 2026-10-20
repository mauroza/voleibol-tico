import * as THREE from 'three';
import type { Simulation } from '../sim/rally';
import type { Rig } from './character';

const BAR_W = 0.62;
const BAR_H = 0.07;
const MAX = 24;

/**
 * Estado visible de cada jugador en cancha: barra de estamina sobre la cabeza (verde, amarilla, roja)
 * y aura roja cuando está en racha. Las barras son dos mallas instanciadas: dos llamadas de dibujo en total.
 */
export class PlayerStatus {
  readonly group = new THREE.Group();
  private readonly bg: THREE.InstancedMesh;
  private readonly fill: THREE.InstancedMesh;
  private readonly auras = new Map<string, THREE.Group>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();

  constructor(private readonly sim: Simulation, private readonly rigs: ReadonlyMap<string, Rig>) {
    const plane = new THREE.PlaneGeometry(1, 1);
    const mat = (opacity: number) => new THREE.MeshBasicMaterial({ transparent: true, opacity, depthTest: false, depthWrite: false });
    this.bg = new THREE.InstancedMesh(plane, mat(0.55), MAX);
    this.fill = new THREE.InstancedMesh(plane, mat(0.95), MAX);
    this.bg.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3).fill(0.06), 3);
    this.fill.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    for (const mesh of [this.bg, this.fill]) {
      mesh.frustumCulled = false;
      mesh.renderOrder = 12;
      this.group.add(mesh);
    }
    for (const [key, rig] of rigs) this.auras.set(key, this.buildAura(rig));
  }

  /** Aura: dos cápsulas rojas aditivas alrededor del cuerpo que laten (sigue los saltos porque cuelga del cuerpo). */
  private buildAura(rig: Rig): THREE.Group {
    const aura = new THREE.Group();
    const layer = (r: number, len: number, color: string, opacity: number) => {
      const mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(r, len, 4, 12),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      mesh.position.y = 1.0;
      aura.add(mesh);
    };
    layer(0.42, 1.2, '#ff2a12', 0.22);
    layer(0.58, 1.35, '#ff6a1a', 0.1);
    aura.visible = false;
    rig.body.add(aura);
    return aura;
  }

  update(camera: THREE.Camera, now: number, hidden: boolean): void {
    camera.matrixWorld.extractBasis(this.right, this.v, this.v);
    this.q.copy(camera.quaternion);
    let n = 0;
    for (const team of ['A', 'B'] as const) {
      for (const key of this.sim.court(team)) {
        const rig = this.rigs.get(key);
        if (!rig) continue;
        const p = this.sim.player(key);
        // Barra un poco arriba de la cabeza.
        rig.joints.neck.getWorldPosition(this.v);
        this.v.y += 0.55 * rig.root.scale.y;
        const s = p.stamina;
        this.m.compose(this.v, this.q, this.scale.set(BAR_W + 0.04, BAR_H + 0.04, 1));
        this.bg.setMatrixAt(n, this.m);
        // Relleno alineado a la izquierda: se corre hacia la izquierda la mitad de lo que falta.
        const w = Math.max(0.001, BAR_W * s);
        this.v.addScaledVector(this.right, -(BAR_W - w) / 2);
        this.m.compose(this.v, this.q, this.scale.set(w, BAR_H, 1));
        this.fill.setMatrixAt(n, this.m);
        this.fill.setColorAt(n, this.color.set(s > 0.6 ? '#5dff8f' : s > 0.38 ? '#ffd23f' : '#ff4a3a'));
        n += 1;
      }
    }
    for (const mesh of [this.bg, this.fill]) {
      mesh.count = hidden ? 0 : n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    // Aura de racha que late.
    const pulse = 1 + Math.sin(now * 9) * 0.06;
    for (const [key, aura] of this.auras) {
      const on = !hidden && this.sim.onFire(key) && this.sim.court(this.sim.player(key).team).includes(key);
      aura.visible = on;
      if (on) aura.scale.set(pulse, 1 + Math.sin(now * 6) * 0.04, pulse);
    }
  }
}
