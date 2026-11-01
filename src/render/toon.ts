import * as THREE from 'three';

/** Rampa de tonos (sombra, medios, luz) con filtro nearest: bandas de cel-shading. */
let gradient: THREE.DataTexture | null = null;
function gradientMap(): THREE.DataTexture {
  if (gradient) return gradient;
  // Cuatro tonos con saltos más suaves: sigue siendo anime, pero las sombras no se ven tan "planas" ni tan negras.
  const data = new Uint8Array([120, 120, 120, 255, 175, 175, 175, 255, 220, 220, 220, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

const cache = new Map<string, THREE.MeshToonMaterial>();

export function toon(color: THREE.ColorRepresentation, map?: THREE.Texture): THREE.MeshToonMaterial {
  const key = map ? `map:${map.uuid}` : `c:${new THREE.Color(color).getHexString()}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color: map ? '#ffffff' : color, map: map ?? null, gradientMap: gradientMap(), transparent: !!map });
    cache.set(key, m);
  }
  return m;
}

let vertexToon: THREE.MeshToonMaterial | null = null;
/** Rampa de tonos propia de los jugadores (la del Probador) y la luz de borde. */
let charGradient: THREE.DataTexture | null = null;
const rimUniform = { value: 0 };
const vividUniform = { value: 1 };

/**
 * Rampa de `tones` tonos desde `shadow` hasta 1; `soft` difumina el paso entre uno y otro (0 = bandas cortadas).
 * 64 muestras con filtro lineal: con soft 0 se ve igual que las bandas de antes.
 */
function rampData(tones: number, soft: number, shadow: number, warmth: number): Uint8Array<ArrayBuffer> {
  const n = 64;
  const data = new Uint8Array(n * 4);
  const steps = Math.max(2, Math.round(tones));
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) / n;
    const f = x * steps;
    const band = Math.min(steps - 1, Math.floor(f));
    // Dentro de cada banda, el último tramo (de ancho soft/2) sube suave hasta la siguiente.
    const w = Math.max(1e-3, soft * 0.5);
    const t = band < steps - 1 ? THREE.MathUtils.smoothstep(f - band, 1 - w, 1) : 0;
    const level = Math.min(steps - 1, band + t) / (steps - 1);
    const v = shadow + (1 - shadow) * level;
    // Sombra cálida: en la parte oscura baja más el azul y el verde que el rojo (la piel se ve durazno, no gris).
    const dark = (1 - level) * warmth;
    const c = (k: number) => Math.round(255 * Math.min(1, v * (1 - dark * k)));
    data.set([c(-0.06), c(0.12), c(0.3), 255], i * 4);
  }
  return data;
}

/** Aplica el sombreado del estilo de los jugadores: tonos, sombra, contorno y luz de borde. */
export function applyCharShading(s: { tones: number; soft: number; shadow: number; outline: number; rim: number; warmth?: number; vivid?: number }): void {
  const data = rampData(s.tones, s.soft, s.shadow, s.warmth ?? 0);
  vividUniform.value = s.vivid ?? 1;
  if (!charGradient) {
    charGradient = new THREE.DataTexture(data, 64, 1, THREE.RGBAFormat);
    charGradient.minFilter = THREE.LinearFilter;
    charGradient.magFilter = THREE.LinearFilter;
    charGradient.generateMipmaps = false;
  } else charGradient.image.data.set(data);
  charGradient.needsUpdate = true;
  rimUniform.value = s.rim;
  OUTLINE_SKINNED.uniforms.thickness.value = 0.0021 * s.outline;
  OUTLINE_SKINNED.uniforms.minThickness.value = 0.008 * s.outline;
  OUTLINE_SKINNED.visible = s.outline > 0.01;
}

/** Material toon único con color por vértice: lo comparten todas las mallas fusionadas de los personajes. */
export function toonVertexColors(): THREE.MeshToonMaterial {
  if (vertexToon) return vertexToon;
  if (!charGradient) applyCharShading({ tones: 4, soft: 0, shadow: 0.47, outline: 1, rim: 0 });
  vertexToon = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: charGradient });
  // Luz de borde: un brillo frío en el contorno de la silueta (donde la superficie se pone de canto a la cámara).
  vertexToon.onBeforeCompile = (shader) => {
    shader.uniforms.rimStrength = rimUniform;
    shader.uniforms.vivid = vividUniform;
    // Viveza: separa el color de su gris (el tono del pabellón apaga los colores; esto los devuelve).
    shader.fragmentShader = `uniform float rimStrength;\nuniform float vivid;\n${shader.fragmentShader}`.replace(
      '#include <opaque_fragment>',
      `float rimF = 1.0 - max(dot(normal, normalize(vViewPosition)), 0.0);
      outgoingLight += vec3(0.75, 0.85, 1.0) * rimStrength * smoothstep(0.55, 0.95, rimF) * 0.6;
      outgoingLight = max(vec3(0.0), mix(vec3(dot(outgoingLight, vec3(0.299, 0.587, 0.114))), outgoingLight, vivid));
      #include <opaque_fragment>`,
    );
  };
  return vertexToon;
}

/** Contorno por "inverted hull": la misma geometría inflada por la normal, solo caras traseras. */
export const OUTLINE = new THREE.ShaderMaterial({
  // Grosor proporcional a la distancia a la cámara: el contorno se ve parecido de cerca y en la vista de transmisión.
  uniforms: { thickness: { value: 0.0021 }, minThickness: { value: 0.008 }, color: { value: new THREE.Color('#1a1222') } },
  vertexShader: /* glsl */ `
    uniform float thickness;
    uniform float minThickness;
    void main() {
      float dist = -(modelViewMatrix * vec4(position, 1.0)).z;
      vec3 p = position + normal * max(minThickness, thickness * dist);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    void main() { gl_FragColor = vec4(color, 1.0); }
  `,
  side: THREE.BackSide,
});

/** Contorno de los personajes (una sola malla con esqueleto): se infla por la normal ya deformada por los huesos. */
export const OUTLINE_SKINNED = new THREE.ShaderMaterial({
  // Grosor propio (el Probador lo cambia sin tocar el contorno del pabellón); el color es el mismo.
  uniforms: { thickness: { value: 0.0021 }, minThickness: { value: 0.008 }, color: OUTLINE.uniforms.color },
  vertexShader: /* glsl */ `
    #include <common>
    #include <skinning_pars_vertex>
    uniform float thickness;
    uniform float minThickness;
    void main() {
      #include <skinbase_vertex>
      #include <begin_vertex>
      #include <beginnormal_vertex>
      #include <skinnormal_vertex>
      #include <skinning_vertex>
      float dist = -(modelViewMatrix * vec4(transformed, 1.0)).z;
      transformed += normalize(objectNormal) * max(minThickness, thickness * dist);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
    }
  `,
  fragmentShader: OUTLINE.fragmentShader,
  side: THREE.BackSide,
});

/** Malla toon con su contorno como hijo. */
export function toonMesh(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, outline = true): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, toon(color));
  if (outline) mesh.add(new THREE.Mesh(geometry, OUTLINE));
  return mesh;
}
