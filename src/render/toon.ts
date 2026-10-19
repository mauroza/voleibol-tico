import * as THREE from 'three';

/** Rampa de 3 tonos (sombra, medio, luz) con filtro nearest: bandas duras de cel-shading. */
let gradient: THREE.DataTexture | null = null;
function gradientMap(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([95, 95, 95, 255, 180, 180, 180, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
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

/** Material toon único con color por vértice: lo comparten todas las mallas fusionadas de los personajes. */
export function toonVertexColors(): THREE.MeshToonMaterial {
  vertexToon ??= new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradientMap() });
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

/** Malla toon con su contorno como hijo. */
export function toonMesh(geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, outline = true): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, toon(color));
  if (outline) mesh.add(new THREE.Mesh(geometry, OUTLINE));
  return mesh;
}
