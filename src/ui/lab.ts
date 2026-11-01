import * as THREE from 'three';
import { DIMS, buildCharacter, lookFor, type Rig } from '../render/character';
import { JOINTS, POSES, hipHeight, sampleTrack, TRACKS, trackSpan, resetPosePool, type Pose } from '../render/pose';
import {
  BEFORE_STYLE, BLOCK_STYLE, GAME_STYLE, ROUND_STYLE, STYLE_RANGES, draftStyle, saveDraft, tryDraftInMatch,
  type CharStyle, type HairStyle,
} from '../render/style';
import { audio } from '../audio/music';

/**
 * Editor de personajes (solo para quien diseña el juego, en `?editor`): tres jugadores en una tarima que gira, con
 * poses del partido y todos los ajustes del estilo (forma, cabeza, pelo, cara, zapatillas, sombreado, contorno). El
 * borrador queda en este navegador; "Copiar ajustes" da el texto para ponerlo en el juego (`GAME_STYLE`), y "Probar en
 * un partido" juega uno con el borrador solo en esta pestaña. Los jugadores nunca ven este editor.
 */

type PoseId = 'idle' | 'ready' | 'spike' | 'block' | 'bump' | 'set' | 'serve' | 'celebrate';
const POSE_LABELS: Record<PoseId, string> = {
  idle: 'Quieto', ready: 'Listo', spike: 'Remate', block: 'Bloqueo', bump: 'Recepción', set: 'Colocación', serve: 'Saque', celebrate: 'Festejo',
};

const LABELS: Partial<Record<keyof CharStyle, string>> = {
  detail: 'Suavidad de las curvas', head: 'Tamaño de la cabeza', shoulders: 'Ancho de hombros', waist: 'Cintura',
  limbs: 'Grosor de brazos y piernas', eyes: 'Tamaño de los ojos', tones: 'Tonos de sombra', soft: 'Sombra difuminada',
  shadow: 'Claridad de la sombra', outline: 'Contorno negro', rim: 'Luz de borde', brows: 'Cejas (− alegre · + serio)',
  hairVolume: 'Volumen del pelo', shoes: 'Tamaño de zapatillas', fist: 'Tamaño del puño', warmth: 'Sombra cálida',
  vivid: 'Viveza de colores',
};

const HAIR_LABELS: Record<HairStyle, string> = { variado: 'Variado', casquete: 'Corto', puntas: 'Puntas anime', mechones: 'Mechones', cola: 'Cola' };

/** Tres jugadores de muestra: piel, pelo, mangas y equipos distintos. */
const MODELS = [
  { def: { number: 10, skin: 1, hair: 1, armSleeve: 0, legSleeve: 0, sleeveColor: 0 }, name: 'PLAYER', primary: '#15161a', secondary: '#f2f2f2', libero: false },
  { def: { number: 7, skin: 4, hair: 0, armSleeve: 2, legSleeve: 1, sleeveColor: 0 }, name: 'ARAYA', primary: '#c8102e', secondary: '#1d3f8f', libero: false },
  { def: { number: 1, skin: 0, hair: 3, armSleeve: 0, legSleeve: 0, sleeveColor: 1 }, name: 'MORA', primary: '#2459d6', secondary: '#f4c430', libero: true },
];

export function labView(onBack: () => void, onTry: () => void): HTMLElement {
  let draft = draftStyle();
  const el = document.createElement('section');
  el.className = 'am-lab';
  el.innerHTML = `
    <div class="lab-stage"><canvas></canvas>
      <div class="lab-poses"></div>
      <div class="lab-cam"><button type="button" data-cam="detail">Detalle</button><button type="button" data-cam="near" class="on">Cerca</button><button type="button" data-cam="far">Como en el partido</button><button type="button" data-spin class="on">Girar</button></div>
    </div>
    <aside class="lab-panel">
      <div class="lab-head"><button type="button" class="am-back lab-back" aria-label="Volver">‹</button><div><h2>Editor de personajes</h2><p>Solo para ti. Ajusta, toca <b>Copiar ajustes</b> y pásaselo a Claude: lo pone en el juego para todos.</p></div></div>
      <div class="lab-presets"></div>
      <div class="lab-controls"></div>
      <div class="lab-actions"><button type="button" class="am-cta" data-copy>Copiar ajustes</button><button type="button" class="am-ghost" data-try>Probar en un partido</button></div>
      <textarea class="lab-out" readonly rows="4" hidden></textarea>
    </aside>`;
  const canvas = el.querySelector('canvas')!;
  const stage = el.querySelector<HTMLElement>('.lab-stage')!;
  const out = el.querySelector<HTMLTextAreaElement>('.lab-out')!;

  // ---------- escena ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.78;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#141a2e');
  // Mismas luces que el pabellón: así se ve igual que en el partido.
  scene.add(new THREE.HemisphereLight('#e6eeff', '#4a3a2a', 0.62));
  const key = new THREE.DirectionalLight('#f4f7ff', 1.65);
  key.position.set(3, 20, 7);
  const fill = new THREE.DirectionalLight('#ffe2bd', 0.75);
  fill.position.set(-8, 9, -12);
  const rim = new THREE.DirectionalLight('#cfe0ff', 0.5);
  rim.position.set(0, 6, -20);
  scene.add(key, fill, rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3.2, 48), new THREE.MeshLambertMaterial({ color: '#d98c3f' }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const line = new THREE.Mesh(new THREE.RingGeometry(3.05, 3.2, 48), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  line.rotation.x = -Math.PI / 2;
  line.position.y = 0.002;
  scene.add(line);
  const turntable = new THREE.Group();
  scene.add(turntable);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);

  let rigs: Rig[] = [];
  // Solo en desarrollo: cámara a mano desde la consola (para revisar detalles de cerca).
  let devCam: number[] | null = null;
  if (import.meta.env.DEV) Object.assign(window, { __lab: { cam: (c: number[] | null) => { devCam = c; } } });
  const build = () => {
    for (const r of rigs) {
      turntable.remove(r.root);
      r.root.traverse((o) => { if (o instanceof THREE.SkinnedMesh && o.material !== null && o.geometry) o.geometry.dispose(); });
    }
    const st = draft;
    rigs = MODELS.map((m, i) => {
      const rig = buildCharacter(lookFor(m.def, m.name, m.primary, m.secondary, m.libero), st);
      // En triángulo: de perfil no se tapan uno al otro.
      rig.root.position.set((i - 1) * 1.05, 0, i === 1 ? -0.7 : 0);
      rig.root.scale.setScalar(1.92 / 1.9);
      turntable.add(rig.root);
      return rig;
    });
  };
  build();

  let pose: PoseId = 'idle';
  let spin = true;
  let cam: 'detail' | 'near' | 'far' = 'near';
  let yaw = 0.35;
  let t0 = performance.now();
  const apply = (rig: Rig, p: Pose) => {
    for (const j of JOINTS) {
      const e = p[j];
      rig.joints[j].rotation.set(e ? e[0] : 0, e ? e[1] : 0, e ? e[2] : 0);
    }
    const legL = hipHeight(DIMS.thigh, DIMS.shin, rig.joints.hipL.rotation.x, rig.joints.kneeL.rotation.x);
    const legR = hipHeight(DIMS.thigh, DIMS.shin, rig.joints.hipR.rotation.x, rig.joints.kneeR.rotation.x);
    rig.hips.position.y = DIMS.foot + Math.max(legL, legR);
  };
  const currentPose = (now: number): Pose => {
    if (pose === 'idle' || pose === 'ready' || pose === 'celebrate') return POSES[pose];
    const track = TRACKS[pose];
    const [a, b] = trackSpan(track);
    const len = b - a + 0.6;
    return sampleTrack(track, a + (((now - t0) / 1000) % len));
  };

  // Arrastrar gira a los jugadores.
  let drag: number | null = null;
  canvas.addEventListener('pointerdown', (e) => { drag = e.clientX; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (drag === null) return;
    yaw += (e.clientX - drag) * 0.01;
    drag = e.clientX;
  });
  canvas.addEventListener('pointerup', () => { drag = null; });

  let last = performance.now();
  const loop = (now: number) => {
    if (!el.isConnected) {
      renderer.dispose();
      return;
    }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (spin && drag === null) yaw += dt * 0.5;
    // En el detalle gira solo el jugador de la izquierda, en su lugar.
    turntable.rotation.y = cam === 'detail' ? 0 : yaw;
    if (rigs[0]) rigs[0].root.rotation.y = cam === 'detail' ? yaw : 0;
    resetPosePool();
    const p = currentPose(now);
    for (const r of rigs) apply(r, p);
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    }
    // Cerca: de frente a la altura del pecho. Partido: alto y lejos, como la cámara de juego.
    const fit = Math.max(1, 1.25 / camera.aspect);
    // Detalle: a cuatro metros del de la izquierda (que deja de girar con los demás, para verlo de frente).
    if (devCam) camera.position.set(devCam[0], devCam[1], devCam[2]);
    else if (cam === 'far') camera.position.set(0, 7.4, 15.2);
    else if (cam === 'detail') camera.position.set(-1.05, 1.25, 4.3 * fit);
    else camera.position.set(0, 1.5, 6.2 * fit);
    if (devCam) camera.lookAt(devCam[3], devCam[4], devCam[5]);
    else camera.lookAt(cam === 'detail' ? -1.05 : 0, cam === 'far' ? 0.6 : cam === 'detail' ? 1.15 : 1.05, 0);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // ---------- controles ----------
  const tap = (b: HTMLElement, fn: () => void) => b.addEventListener('click', () => { audio.unlock(); audio.click(); fn(); });
  const poses = el.querySelector('.lab-poses')!;
  for (const id of Object.keys(POSE_LABELS) as PoseId[]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = POSE_LABELS[id];
    b.classList.toggle('on', id === pose);
    tap(b, () => {
      pose = id;
      t0 = performance.now();
      poses.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    });
    poses.append(b);
  }
  el.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((b) => tap(b, () => {
    cam = b.dataset.cam as typeof cam;
    el.querySelectorAll('[data-cam]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  const spinBtn = el.querySelector<HTMLButtonElement>('[data-spin]')!;
  tap(spinBtn, () => { spin = !spin; spinBtn.classList.toggle('on', spin); });
  tap(el.querySelector<HTMLButtonElement>('.lab-back')!, onBack);

  const change = (patch: Partial<CharStyle>) => {
    draft = { ...draft, ...patch };
    saveDraft(draft);
    build();
    out.hidden = true;
  };

  const presets = el.querySelector('.lab-presets')!;
  // Puntos de partida: el que tiene hoy el juego, los de bloques y redondo, y cómo era antes.
  const presetList: [string, CharStyle][] = [['El del juego', GAME_STYLE], ['Bloque', BLOCK_STYLE], ['Redondo', ROUND_STYLE], ['Antes', BEFORE_STYLE]];
  for (const [label, st] of presetList) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    tap(b, () => { change(st); renderControls(); });
    presets.append(b);
  }

  const controls = el.querySelector<HTMLElement>('.lab-controls')!;
  const choice = <K extends keyof CharStyle>(k: K, label: string, opts: [CharStyle[K], string][]) => {
    const row = document.createElement('div');
    row.className = 'lab-row';
    row.innerHTML = `<span>${label}</span><div class="segmented"></div>`;
    const seg = row.querySelector('.segmented')!;
    for (const [v, text] of opts) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.classList.toggle('active', draft[k] === v);
      tap(b, () => {
        change({ [k]: v } as Partial<CharStyle>);
        seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      });
      seg.append(b);
    }
    controls.append(row);
  };
  const slider = (k: keyof CharStyle) => {
    const [min, max, step] = STYLE_RANGES[k]!;
    const row = document.createElement('label');
    row.className = 'lab-row lab-slider';
    const v = draft[k] as number;
    row.innerHTML = `<span>${LABELS[k]}<b>${v}</b></span><input type="range" min="${min}" max="${max}" step="${step}" value="${v}">`;
    const input = row.querySelector('input')!;
    const shown = row.querySelector('b')!;
    input.addEventListener('input', () => {
      const n = Number(input.value);
      shown.textContent = String(n);
      change({ [k]: n } as Partial<CharStyle>);
    });
    controls.append(row);
  };
  const renderControls = () => {
    controls.replaceChildren();
    choice('body', 'Forma', [['redondo', 'Redonda'], ['bloque', 'Bloques']]);
    choice('torso', 'Tronco', [['atleta', 'Atleta'], ['capsula', 'Cápsula']]);
    choice('hair', 'Peinado', (Object.keys(HAIR_LABELS) as HairStyle[]).map((hh) => [hh, HAIR_LABELS[hh]]));
    choice('hands', 'Manos', [[true, 'Sí'], [false, 'No']]);
    choice('eyeShine', 'Brillo en los ojos', [[true, 'Sí'], [false, 'No']]);
    choice('socks', 'Medias blancas (bloques)', [[true, 'Sí'], [false, 'No']]);
    for (const k of Object.keys(STYLE_RANGES) as (keyof CharStyle)[]) slider(k);
  };
  renderControls();

  tap(el.querySelector<HTMLButtonElement>('[data-try]')!, () => {
    tryDraftInMatch(true);
    onTry();
  });
  tap(el.querySelector<HTMLButtonElement>('[data-copy]')!, () => {
    const text = `Estilo de jugadores: ${JSON.stringify(draft)}`;
    out.value = text;
    out.hidden = false;
    out.select();
    navigator.clipboard?.writeText(text).catch(() => {});
  });
  return el;
}
