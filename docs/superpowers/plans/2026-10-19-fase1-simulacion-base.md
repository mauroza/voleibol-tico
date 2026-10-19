# Fase 1 — Simulación base: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la simulación de voleibol 6v6, que funciona sin gráficos: reglas, pelota, rally, IA y métricas. Se agrega una vista 3D con primitivas donde dos equipos IA juegan un partido completo con reglas correctas y métricas de balance dentro de rango.

**Architecture:** La carpeta `src/sim/` contiene lógica pura en TypeScript, determinista con semilla, sin Three.js ni DOM. La pelota sigue trayectorias balísticas analíticas. El rally es una máquina de estados guiada por contactos planificados: cada contacto calcula la nueva trayectoria y el sistema planifica quién toca después según una prueba de alcance (distancia / velocidad contra tiempo disponible). La capa `src/render/` solo lee el estado. Las métricas salen del bus de eventos.

**Tech Stack:** Vite, TypeScript strict, Three.js, Vitest, tsx (para el script de simulación masiva).

**Spec:** `docs/superpowers/specs/2026-10-19-voleibol-tico-design.md`

**Coordenadas:**
- `x` es el largo de la cancha, de −9 a 9. La red está en `x=0`. El equipo A juega en `x<0` y el equipo B en `x>0`.
- `z` es el ancho, de −4.5 a 4.5.
- `y` es la altura.
- `toWorld(team, depth, right)` convierte coordenadas locales del equipo a coordenadas del mundo. `depth` son los metros desde la red hacia el fondo propio, y `right` es la dirección lateral a la derecha del equipo cuando mira la red.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `package.json`, `tsconfig.json`, `index.html`, `.gitignore` | Proyecto |
| `src/sim/vec.ts` | Vec3 y utilidades numéricas |
| `src/sim/rng.ts` | Generador aleatorio con semilla (mulberry32) |
| `src/sim/court.ts` | Medidas de la cancha, lados y conversión de coordenadas |
| `src/sim/ball.ts` | Trayectorias, predicción de alturas y chequeo de red y antenas |
| `src/sim/players.ts` | Tipos de jugador, atributos y capacidades físicas derivadas |
| `src/data/teams.ts` | Generador de equipos y los 7 equipos de provincia |
| `src/sim/match.ts` | Marcador, sets, rotación, líbero y jugadores en cancha |
| `src/sim/events.ts` | Tipos de evento y `EventBus` |
| `src/sim/tuning.ts` | Todas las constantes de balance |
| `src/sim/resolver.ts` | Calidad de cada toque, probabilidad de error y timing de la IA |
| `src/sim/actions.ts` | Acciones disponibles según posición y situación |
| `src/sim/ai.ts` | Decisiones de la IA (saque, colocación, tiro) |
| `src/sim/formation.ts` | Posiciones tácticas en coordenadas locales |
| `src/sim/rally.ts` | `Simulation`: motor del rally y del partido |
| `src/sim/headless.ts` | `runMatch` sin gráficos |
| `src/sim/metrics.ts` | Recolección de métricas y rangos objetivo |
| `scripts/simulate.ts` | Simulación masiva con reporte |
| `src/render/scene.ts` | Vista 3D con primitivas |
| `src/ui/hud.ts` | Marcador en pantalla |
| `src/main.ts` | Bucle principal |
| `tests/sim/*.test.ts` | Pruebas |

---

### Task 1: Scaffold del proyecto

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `index.html`, `src/main.ts`

- [ ] **Step 1: Crear `package.json`**

```json
{
  "name": "voleibol-tico",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "typecheck": "tsc",
    "test": "vitest run",
    "sim": "tsx scripts/simulate.ts"
  }
}
```

- [ ] **Step 2: Instalar dependencias**

Run: `npm install three` y luego `npm install -D typescript vite vitest tsx @types/three @types/node`
Expected: se crea `node_modules` y `package-lock.json`, sin errores.

- [ ] **Step 3: Crear `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  },
  "include": ["src", "tests", "scripts"]
}
```

- [ ] **Step 4: Crear `.gitignore`**

```
node_modules
dist
```

- [ ] **Step 5: Crear `index.html`**

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Voleibol Tico</title>
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; background: #1b2333; font-family: system-ui, sans-serif; }
      .hud { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); color: #fff; background: rgba(0, 0, 0, 0.55);
             padding: 8px 16px; border-radius: 8px; white-space: pre; text-align: center; font-size: 16px; }
      #help { position: fixed; bottom: 10px; left: 12px; color: #ccd; font-size: 13px; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <div id="hud"></div>
    <div id="help">F: velocidad x4</div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Crear `src/main.ts` provisional**

```ts
console.log('Voleibol Tico');
```

- [ ] **Step 7: Verificar**

Run: `npx tsc` → sin salida (OK).
Run: `npx vitest run --passWithNoTests` → "No test files found", exit 0.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore index.html src/main.ts
git commit -m "chore: scaffold Vite + TypeScript + Three.js"
```

---

### Task 2: Vectores y RNG con semilla

**Files:**
- Create: `src/sim/vec.ts`, `src/sim/rng.ts`
- Test: `tests/sim/rng.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/sim/rng.test.ts
import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/sim/rng';

describe('createRng', () => {
  it('es determinista con la misma semilla', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('genera valores en [0, 1)', () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('range respeta los límites', () => {
    const r = createRng(9);
    for (let i = 0; i < 500; i++) {
      const v = r.range(-2, 3);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(3);
    }
  });

  it('weighted nunca elige un peso cero', () => {
    const r = createRng(3);
    for (let i = 0; i < 200; i++) {
      expect(r.weighted([{ item: 'a', weight: 0 }, { item: 'b', weight: 1 }])).toBe('b');
    }
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/sim/rng.test.ts`
Expected: FAIL, "Failed to resolve import ../../src/sim/rng".

- [ ] **Step 3: Implementar `src/sim/vec.ts`**

```ts
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const clone = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const distXZ = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z);
export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
export const clamp01 = (v: number): number => clamp(v, 0, 1);
```

- [ ] **Step 4: Implementar `src/sim/rng.ts`**

```ts
export interface Rng {
  next(): number;
  range(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly { item: T; weight: number }[]): T;
}

/** mulberry32: rápido, determinista y suficiente para un juego. */
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    chance: (p) => next() < p,
    pick: (items) => items[Math.floor(next() * items.length)],
    weighted: (items) => {
      const total = items.reduce((sum, i) => sum + i.weight, 0);
      let r = next() * total;
      for (const i of items) {
        r -= i.weight;
        if (r < 0) return i.item;
      }
      return items[items.length - 1].item;
    },
  };
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run tests/sim/rng.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/sim/vec.ts src/sim/rng.ts tests/sim/rng.test.ts
git commit -m "feat(sim): vectores y RNG con semilla"
```

---

### Task 3: Cancha y trayectoria de la pelota

**Files:**
- Create: `src/sim/court.ts`, `src/sim/ball.ts`
- Test: `tests/sim/court.test.ts`, `tests/sim/ball.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

```ts
// tests/sim/court.test.ts
import { describe, expect, it } from 'vitest';
import { isInCourt, otherTeam, sideOfX, toWorld } from '../../src/sim/court';
import { v3 } from '../../src/sim/vec';

describe('court', () => {
  it('toWorld ubica la zona 4 (izquierda delantera) de cada equipo', () => {
    expect(toWorld('A', 1.5, -3)).toEqual({ x: -1.5, y: 0, z: -3 });
    expect(toWorld('B', 1.5, -3)).toEqual({ x: 1.5, y: 0, z: 3 });
  });

  it('sideOfX y otherTeam', () => {
    expect(sideOfX(-0.1)).toBe('A');
    expect(sideOfX(0.1)).toBe('B');
    expect(otherTeam('A')).toBe('B');
  });

  it('la línea cuenta como dentro', () => {
    expect(isInCourt(v3(9, 0, 4.5))).toBe(true);
    expect(isInCourt(v3(9.5, 0, 0))).toBe(false);
    expect(isInCourt(v3(0, 0, -4.8))).toBe(false);
  });
});
```

```ts
// tests/sim/ball.test.ts
import { describe, expect, it } from 'vitest';
import { checkNet, landingTime, launch, positionAt, timeAtHeightDescending } from '../../src/sim/ball';
import { v3 } from '../../src/sim/vec';

describe('launch', () => {
  it('llega al objetivo exactamente en el tiempo de vuelo', () => {
    const tr = launch(v3(-8, 1, 0), v3(5, 0.105, 2), 1.2, 10);
    const p = positionAt(tr, 11.2);
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(0.105);
    expect(p.z).toBeCloseTo(2);
  });
});

describe('timeAtHeightDescending', () => {
  it('devuelve la raíz descendente', () => {
    const tr = launch(v3(0, 1, 0), v3(0, 1, 0), 2, 0);
    expect(timeAtHeightDescending(tr, 1)).toBeCloseTo(2);
  });

  it('devuelve null si nunca alcanza la altura', () => {
    const tr = launch(v3(0, 1, 0), v3(1, 1, 0), 0.5, 0);
    expect(timeAtHeightDescending(tr, 10)).toBeNull();
  });

  it('landingTime coincide con la llegada al piso', () => {
    const tr = launch(v3(-3, 2, 0), v3(4, 0.105, 0), 1.1, 5);
    expect(landingTime(tr)).toBeCloseTo(6.1);
  });
});

describe('checkNet', () => {
  it('clear si pasa alto', () => {
    expect(checkNet(launch(v3(-5, 2.5, 0), v3(5, 0.105, 0), 1.5, 0)).kind).toBe('clear');
  });

  it('fault por red si pasa bajo', () => {
    expect(checkNet(launch(v3(-1, 3, 0), v3(0.8, 0.105, 0), 0.1, 0))).toMatchObject({ kind: 'fault', reason: 'net' });
  });

  it('fault por antena si cruza por fuera', () => {
    expect(checkNet(launch(v3(-5, 3, 6), v3(5, 0.105, 6), 1.5, 0))).toMatchObject({ kind: 'fault', reason: 'antenna' });
  });

  it('none si no cruza antes de caer', () => {
    expect(checkNet(launch(v3(-5, 1, 0), v3(-2, 2.3, 0), 1.3, 0)).kind).toBe('none');
  });
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run tests/sim/court.test.ts tests/sim/ball.test.ts`
Expected: FAIL, porque los módulos no existen.

- [ ] **Step 3: Implementar `src/sim/court.ts`**

```ts
import { v3, type Vec3 } from './vec';

export type TeamId = 'A' | 'B';

export const COURT = {
  halfLength: 9,
  halfWidth: 4.5,
  netHeight: 2.43,
  attackLine: 3,
  ballRadius: 0.105,
  antennaZ: 4.5,
} as const;

export const GRAVITY = 9.81;

/** A juega en x<0, B en x>0. */
export const sideSign = (team: TeamId): number => (team === 'A' ? -1 : 1);
export const otherTeam = (team: TeamId): TeamId => (team === 'A' ? 'B' : 'A');
export const sideOfX = (x: number): TeamId => (x < 0 ? 'A' : 'B');

/** depth: metros desde la red hacia el fondo propio. right: lateral a la derecha del equipo mirando la red. */
export function toWorld(team: TeamId, depth: number, right: number, y = 0): Vec3 {
  const s = sideSign(team);
  return v3(s * depth, y, -s * right + 0);
}

export function isInCourt(p: Vec3): boolean {
  return Math.abs(p.x) <= COURT.halfLength + COURT.ballRadius && Math.abs(p.z) <= COURT.halfWidth + COURT.ballRadius;
}
```

(El `+ 0` evita que aparezca `-0` en `toEqual`.)

- [ ] **Step 4: Implementar `src/sim/ball.ts`**

```ts
import { COURT, GRAVITY } from './court';
import { clone, v3, type Vec3 } from './vec';

export interface Trajectory {
  p0: Vec3;
  v0: Vec3;
  t0: number;
  /** Gravedad efectiva: mayor que GRAVITY simula topspin. */
  g: number;
}

export function positionAt(tr: Trajectory, t: number): Vec3 {
  const dt = t - tr.t0;
  return v3(tr.p0.x + tr.v0.x * dt, tr.p0.y + tr.v0.y * dt - 0.5 * tr.g * dt * dt, tr.p0.z + tr.v0.z * dt);
}

/** Lanza desde `from` para llegar a `to` en `flightTime` segundos. */
export function launch(from: Vec3, to: Vec3, flightTime: number, t0: number, g = GRAVITY): Trajectory {
  const T = flightTime;
  const v0 = v3((to.x - from.x) / T, (to.y - from.y + 0.5 * g * T * T) / T, (to.z - from.z) / T);
  return { p0: clone(from), v0, t0, g };
}

/** Tiempo absoluto en que la pelota baja hasta la altura h, o null si nunca la alcanza. */
export function timeAtHeightDescending(tr: Trajectory, h: number): number | null {
  const a = 0.5 * tr.g;
  const b = -tr.v0.y;
  const c = h - tr.p0.y;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const dt = (-b + Math.sqrt(disc)) / (2 * a);
  return dt >= 0 ? tr.t0 + dt : null;
}

export function landingTime(tr: Trajectory): number {
  return timeAtHeightDescending(tr, COURT.ballRadius) ?? tr.t0;
}

export type NetCheck =
  | { kind: 'none' }
  | { kind: 'clear'; time: number }
  | { kind: 'fault'; time: number; reason: 'net' | 'antenna' };

export function checkNet(tr: Trajectory): NetCheck {
  if (tr.v0.x === 0) return { kind: 'none' };
  const dt = -tr.p0.x / tr.v0.x;
  if (dt <= 0) return { kind: 'none' };
  const time = tr.t0 + dt;
  if (time > landingTime(tr)) return { kind: 'none' };
  const p = positionAt(tr, time);
  if (Math.abs(p.z) > COURT.antennaZ) return { kind: 'fault', time, reason: 'antenna' };
  if (p.y < COURT.netHeight + COURT.ballRadius) return { kind: 'fault', time, reason: 'net' };
  return { kind: 'clear', time };
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run tests/sim/court.test.ts tests/sim/ball.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add src/sim/court.ts src/sim/ball.ts tests/sim/court.test.ts tests/sim/ball.test.ts
git commit -m "feat(sim): cancha y trayectorias balísticas"
```

---

### Task 4: Jugadores y equipos de provincia

**Files:**
- Create: `src/sim/players.ts`, `src/data/teams.ts`
- Test: `tests/sim/teams.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/sim/teams.test.ts
import { describe, expect, it } from 'vitest';
import { TEAMS, makeTeam } from '../../src/data/teams';
import { attackContactHeight, moveSpeed } from '../../src/sim/players';

describe('teams', () => {
  it('hay 7 equipos de provincia con 12 jugadores cada uno', () => {
    expect(TEAMS).toHaveLength(7);
    expect(new Set(TEAMS.map((t) => t.province)).size).toBe(7);
    for (const t of TEAMS) expect(t.roster).toHaveLength(12);
  });

  it('el lineup inicial es un 5-1 y el líbero reemplaza a los centrales', () => {
    for (const t of TEAMS) {
      const role = (id: string) => t.roster.find((p) => p.id === id)!.role;
      expect(t.lineup.map(role)).toEqual(['S', 'OH', 'MB', 'OP', 'OH', 'MB']);
      expect(role(t.libero)).toBe('L');
      expect(t.liberoReplaces.map(role)).toEqual(['MB', 'MB']);
    }
  });

  it('atributos en rango 1..99', () => {
    for (const t of TEAMS) for (const p of t.roster) for (const v of Object.values(p.attrs)) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(99);
    }
  });

  it('es determinista y variance 0 no agrega ruido', () => {
    const spec = { id: 'X', name: 'X', province: 'X', primary: '#000', secondary: '#fff', style: 'balanced' as const, seed: 5 };
    expect(makeTeam(spec)).toEqual(makeTeam(spec));
    const flat = makeTeam({ ...spec, variance: 0 });
    expect(flat.roster[0].attrs.setting).toBe(82);
  });

  it('capacidades físicas derivadas crecen con los atributos', () => {
    const [slow, fast] = [10, 90].map((v) => ({ ...TEAMS[0].roster[0], attrs: { ...TEAMS[0].roster[0].attrs, speed: v, jump: v } }));
    expect(moveSpeed(fast)).toBeGreaterThan(moveSpeed(slow));
    expect(attackContactHeight(fast)).toBeGreaterThan(attackContactHeight(slow));
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/sim/teams.test.ts`
Expected: FAIL, porque los módulos no existen.

- [ ] **Step 3: Implementar `src/sim/players.ts`**

```ts
import type { TeamId } from './court';
import type { Vec3 } from './vec';

export type Role = 'S' | 'OH' | 'MB' | 'OP' | 'L';

export interface Attributes {
  serve: number;
  reception: number;
  setting: number;
  attackPower: number;
  attackAccuracy: number;
  block: number;
  jump: number;
  speed: number;
  defense: number;
}

export interface PlayerDef {
  id: string;
  name: string;
  number: number;
  role: Role;
  attrs: Attributes;
}

export interface PlayerState {
  /** `${team}:${def.id}`: único aunque ambos lados usen el mismo TeamDef. */
  key: string;
  def: PlayerDef;
  team: TeamId;
  pos: Vec3;
  target: Vec3;
}

/** m/s */
export const moveSpeed = (p: PlayerDef): number => 3.5 + 2.5 * (p.attrs.speed / 100);
/** Altura de la mano al rematar. */
export const attackContactHeight = (p: PlayerDef): number => 2.9 + 0.5 * (p.attrs.jump / 100);
/** Altura máxima de las manos al bloquear. */
export const blockReach = (p: PlayerDef): number => 2.75 + 0.45 * (p.attrs.jump / 100);
```

- [ ] **Step 4: Implementar `src/data/teams.ts`**

```ts
import type { Attributes, PlayerDef, Role } from '../sim/players';
import { createRng } from '../sim/rng';

export type TeamStyle = 'balanced' | 'power' | 'block' | 'defense' | 'serve' | 'fast' | 'athletic';

export interface TeamDef {
  id: string;
  name: string;
  province: string;
  primary: string;
  secondary: string;
  style: TeamStyle;
  roster: PlayerDef[];
  /** 6 ids en orden de posición 1..6 */
  lineup: string[];
  libero: string;
  liberoReplaces: string[];
}

export interface TeamSpec {
  id: string;
  name: string;
  province: string;
  primary: string;
  secondary: string;
  style: TeamStyle;
  seed: number;
  variance?: number;
}

const ROLE_BASE: Record<Role, Attributes> = {
  S: { serve: 60, reception: 55, setting: 82, attackPower: 50, attackAccuracy: 55, block: 55, jump: 62, speed: 70, defense: 62 },
  OH: { serve: 66, reception: 70, setting: 45, attackPower: 76, attackAccuracy: 70, block: 62, jump: 72, speed: 68, defense: 64 },
  MB: { serve: 58, reception: 40, setting: 40, attackPower: 74, attackAccuracy: 68, block: 80, jump: 78, speed: 62, defense: 45 },
  OP: { serve: 70, reception: 45, setting: 42, attackPower: 82, attackAccuracy: 68, block: 68, jump: 74, speed: 64, defense: 52 },
  L: { serve: 30, reception: 84, setting: 55, attackPower: 20, attackAccuracy: 30, block: 10, jump: 40, speed: 78, defense: 84 },
};

const STYLE_BONUS: Record<TeamStyle, Partial<Attributes>> = {
  balanced: {},
  power: { attackPower: 8 },
  block: { block: 8, jump: 3 },
  defense: { reception: 6, defense: 8 },
  serve: { serve: 10 },
  fast: { setting: 6, speed: 6 },
  athletic: { jump: 7, speed: 4 },
};

/** Índices 0-5 titulares (5-1), 6 líbero, 7-11 banca. */
const ROLES: Role[] = ['S', 'OH', 'MB', 'OP', 'OH', 'MB', 'L', 'S', 'OH', 'MB', 'OH', 'OP'];

const FIRST = ['Andrés', 'José', 'Luis', 'Carlos', 'Daniel', 'Esteban', 'Kevin', 'Josué', 'Fabián', 'Diego',
  'Pablo', 'Mauricio', 'Randall', 'Bryan', 'Allan', 'Jason', 'Steven', 'Adrián', 'Gabriel', 'Sebastián'];
const LAST = ['Mora', 'Rodríguez', 'Jiménez', 'Vargas', 'Rojas', 'Solís', 'Quesada', 'Araya', 'Chaves', 'Calderón',
  'Brenes', 'Zúñiga', 'Arias', 'Montero', 'Salas', 'Ulate', 'Alfaro', 'Cordero', 'Villalobos', 'Murillo'];

export function makeTeam(spec: TeamSpec): TeamDef {
  const { seed, variance = 6, ...info } = spec;
  const rng = createRng(seed);
  const bonus = STYLE_BONUS[spec.style];
  const roster = ROLES.map((role, i): PlayerDef => {
    const attrs = { ...ROLE_BASE[role] };
    for (const key of Object.keys(attrs) as (keyof Attributes)[]) {
      const value = attrs[key] + (bonus[key] ?? 0) + rng.range(-variance, variance);
      attrs[key] = Math.round(Math.min(99, Math.max(1, value)));
    }
    return { id: `${spec.id}-${i + 1}`, name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`, number: i + 1, role, attrs };
  });
  const ids = roster.map((p) => p.id);
  return { ...info, roster, lineup: ids.slice(0, 6), libero: ids[6], liberoReplaces: [ids[2], ids[5]] };
}

export const TEAMS: readonly TeamDef[] = [
  makeTeam({ id: 'SJ', name: 'Leones de San José', province: 'San José', primary: '#c8102e', secondary: '#1d3f8f', style: 'balanced', seed: 101 }),
  makeTeam({ id: 'AL', name: 'Manudos de Alajuela', province: 'Alajuela', primary: '#d0021b', secondary: '#111111', style: 'power', seed: 102 }),
  makeTeam({ id: 'CA', name: 'Volcanes de Cartago', province: 'Cartago', primary: '#1f4e9c', secondary: '#ffffff', style: 'block', seed: 103 }),
  makeTeam({ id: 'HE', name: 'Flores de Heredia', province: 'Heredia', primary: '#d6202a', secondary: '#f4c430', style: 'defense', seed: 104 }),
  makeTeam({ id: 'GU', name: 'Toros de Guanacaste', province: 'Guanacaste', primary: '#1e7d32', secondary: '#f2c500', style: 'serve', seed: 105 }),
  makeTeam({ id: 'PU', name: 'Mareas de Puntarenas', province: 'Puntarenas', primary: '#3fa9f5', secondary: '#ffffff', style: 'fast', seed: 106 }),
  makeTeam({ id: 'LI', name: 'Tortugas de Limón', province: 'Limón', primary: '#0f7a3d', secondary: '#111111', style: 'athletic', seed: 107 }),
];
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run tests/sim/teams.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/sim/players.ts src/data/teams.ts tests/sim/teams.test.ts
git commit -m "feat(sim): jugadores y 7 equipos de provincia"
```

---

### Task 5: Reglas del partido (marcador, sets, rotación, líbero)

**Files:**
- Create: `src/sim/match.ts`
- Test: `tests/sim/match.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/sim/match.test.ts
import { describe, expect, it } from 'vitest';
import { awardPoint, courtPlayers, createMatch, type MatchState, type TeamSetup } from '../../src/sim/match';

const setup = (t: string): TeamSetup => ({
  lineup: [1, 2, 3, 4, 5, 6].map((n) => `${t}${n}`),
  libero: `${t}L`,
  liberoReplaces: [`${t}3`, `${t}6`],
});
const fresh = (setsToWin: 1 | 2 = 2): MatchState => createMatch({ setsToWin }, setup('a'), setup('b'));
const give = (m: MatchState, team: 'A' | 'B', n: number) => { for (let i = 0; i < n; i++) awardPoint(m, team); };

describe('match', () => {
  it('el equipo que saca y gana no rota', () => {
    const m = fresh();
    const out = awardPoint(m, 'A');
    expect(out.rotated).toBeNull();
    expect(m.lineups.A[0]).toBe('a1');
  });

  it('side-out: el receptor gana, saca y rota', () => {
    const m = fresh();
    const out = awardPoint(m, 'B');
    expect(out.rotated).toBe('B');
    expect(m.serving).toBe('B');
    expect(m.lineups.B).toEqual(['b2', 'b3', 'b4', 'b5', 'b6', 'b1']);
  });

  it('25-24 no cierra el set, 26-24 sí', () => {
    const m = fresh();
    give(m, 'B', 24);
    give(m, 'A', 24);
    expect(awardPoint(m, 'A').setWinner).toBeNull();
    awardPoint(m, 'B');
    awardPoint(m, 'A');
    const out = awardPoint(m, 'A');
    expect(out.setWinner).toBe('A');
    expect(out.points).toEqual({ A: 27, B: 25 });
    expect(m.points).toEqual({ A: 0, B: 0 });
    expect(m.sets.A).toBe(1);
    expect(m.serving).toBe('B');
  });

  it('el tercer set de un partido a 2 sets ganados va a 15', () => {
    const m = fresh(2);
    give(m, 'A', 25);
    give(m, 'B', 25);
    expect(m.setNumber).toBe(3);
    give(m, 'A', 14);
    const out = awardPoint(m, 'A');
    expect(out.matchWinner).toBe('A');
    expect(m.winner).toBe('A');
  });

  it('a 1 set el partido termina al primer set', () => {
    const m = fresh(1);
    give(m, 'B', 25);
    expect(m.winner).toBe('B');
  });

  it('el líbero reemplaza al central solo en zaga y nunca saca', () => {
    const m = fresh();
    // posición 6 (índice 5) es a6, central de zaga → líbero
    expect(courtPlayers(m, 'A')).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'aL']);
    // B recibe; b3 está en delantera → sin cambio, b6 en zaga → líbero
    expect(courtPlayers(m, 'B')).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'bL']);
    // central en posición 1 sacando → no lo reemplaza
    m.lineups.A = ['a6', 'a1', 'a2', 'a3', 'a4', 'a5'];
    m.serving = 'A';
    expect(courtPlayers(m, 'A')[0]).toBe('a6');
    m.serving = 'B';
    expect(courtPlayers(m, 'A')[0]).toBe('aL');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/sim/match.test.ts`
Expected: FAIL, porque el módulo no existe.

- [ ] **Step 3: Implementar `src/sim/match.ts`**

```ts
import { otherTeam, type TeamId } from './court';

export interface MatchConfig {
  setsToWin: 1 | 2;
}

export type Score = Record<TeamId, number>;

export interface TeamSetup {
  lineup: string[];
  libero: string | null;
  liberoReplaces: string[];
}

export interface MatchState {
  config: MatchConfig;
  points: Score;
  sets: Score;
  setNumber: number;
  firstServer: TeamId;
  serving: TeamId;
  /** Claves de jugador en orden de posición 1..6 (índice = posición − 1). */
  lineups: Record<TeamId, string[]>;
  libero: Record<TeamId, string | null>;
  liberoReplaces: Record<TeamId, string[]>;
  winner: TeamId | null;
}

export interface PointOutcome {
  /** Marcador del set justo después del punto (antes de reiniciar si terminó el set). */
  points: Score;
  rotated: TeamId | null;
  setWinner: TeamId | null;
  matchWinner: TeamId | null;
}

export function createMatch(config: MatchConfig, a: TeamSetup, b: TeamSetup, firstServer: TeamId = 'A'): MatchState {
  return {
    config,
    points: { A: 0, B: 0 },
    sets: { A: 0, B: 0 },
    setNumber: 1,
    firstServer,
    serving: firstServer,
    lineups: { A: [...a.lineup], B: [...b.lineup] },
    libero: { A: a.libero, B: b.libero },
    liberoReplaces: { A: [...a.liberoReplaces], B: [...b.liberoReplaces] },
    winner: null,
  };
}

export const isFrontIndex = (i: number): boolean => i >= 1 && i <= 3;

export const isDecidingSet = (m: MatchState): boolean =>
  m.config.setsToWin > 1 && m.setNumber === m.config.setsToWin * 2 - 1;

export const pointsToWinSet = (m: MatchState): number => (isDecidingSet(m) ? 15 : 25);

export function rotate(m: MatchState, team: TeamId): void {
  const l = m.lineups[team];
  m.lineups[team] = [...l.slice(1), l[0]];
}

export function awardPoint(m: MatchState, winner: TeamId): PointOutcome {
  if (m.winner) throw new Error('El partido ya terminó');
  m.points[winner] += 1;
  const out: PointOutcome = { points: { ...m.points }, rotated: null, setWinner: null, matchWinner: null };
  if (m.serving !== winner) {
    m.serving = winner;
    rotate(m, winner);
    out.rotated = winner;
  }
  const lead = m.points[winner] - m.points[otherTeam(winner)];
  if (m.points[winner] >= pointsToWinSet(m) && lead >= 2) {
    m.sets[winner] += 1;
    out.setWinner = winner;
    if (m.sets[winner] >= m.config.setsToWin) {
      m.winner = winner;
      out.matchWinner = winner;
    } else {
      m.setNumber += 1;
      m.points = { A: 0, B: 0 };
      m.serving = m.setNumber % 2 === 1 ? m.firstServer : otherTeam(m.firstServer);
    }
  }
  return out;
}

/** Jugadores en cancha en orden de posición, con el líbero sustituyendo al central de zaga (excepto si saca). */
export function courtPlayers(m: MatchState, team: TeamId): string[] {
  const libero = m.libero[team];
  return m.lineups[team].map((key, i) => {
    const back = !isFrontIndex(i);
    const serving = i === 0 && m.serving === team;
    return libero && back && !serving && m.liberoReplaces[team].includes(key) ? libero : key;
  });
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/sim/match.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sim/match.ts tests/sim/match.test.ts
git commit -m "feat(sim): reglas de marcador, sets, rotación y líbero"
```

---

### Task 6: Eventos, tuning y resolver de calidad

**Files:**
- Create: `src/sim/events.ts`, `src/sim/tuning.ts`, `src/sim/resolver.ts`
- Test: `tests/sim/resolver.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/sim/resolver.test.ts
import { describe, expect, it } from 'vitest';
import { computeQuality, errorChance, type QualityInput } from '../../src/sim/resolver';
import type { Rng } from '../../src/sim/rng';

/** RNG sin ruido: range devuelve el punto medio. */
const still: Rng = {
  next: () => 0.5,
  range: (a, b) => (a + b) / 2,
  chance: () => false,
  pick: (items) => items[0],
  weighted: (items) => items[0].item,
};
const base: QualityInput = { base: 1, prevQuality: 1, timing: 'perfect', attribute: 100, pressure: 0 };

describe('computeQuality', () => {
  it('máxima calidad con todo a favor', () => {
    expect(computeQuality(base, still)).toBeCloseTo(1);
  });

  it('perfecto > bueno > malo', () => {
    const p = computeQuality(base, still);
    const g = computeQuality({ ...base, timing: 'good' }, still);
    const b = computeQuality({ ...base, timing: 'bad' }, still);
    expect(p).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('peor toque previo, menor atributo y más presión bajan la calidad', () => {
    const ref = computeQuality({ ...base, timing: 'good' }, still);
    expect(computeQuality({ ...base, timing: 'good', prevQuality: 0.2 }, still)).toBeLessThan(ref);
    expect(computeQuality({ ...base, timing: 'good', attribute: 30 }, still)).toBeLessThan(ref);
    expect(computeQuality({ ...base, timing: 'good', pressure: 0.8 }, still)).toBeLessThan(ref);
  });

  it('se limita a [0, 1]', () => {
    expect(computeQuality({ ...base, base: 3 }, still)).toBe(1);
    expect(computeQuality({ ...base, base: -1 }, still)).toBe(0);
  });
});

describe('errorChance', () => {
  it('es 0 con calidad perfecta y crece al bajar la calidad', () => {
    expect(errorChance(0.2, 1)).toBe(0);
    expect(errorChance(0.2, 0.3)).toBeGreaterThan(errorChance(0.2, 0.7));
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/sim/resolver.test.ts`
Expected: FAIL, porque el módulo no existe.

- [ ] **Step 3: Implementar `src/sim/events.ts`**

```ts
import type { TeamId } from './court';
import type { Score } from './match';

export type ContactKind = 'serve' | 'reception' | 'dig' | 'set' | 'attack' | 'block' | 'free';

export type PointReason = 'ace' | 'kill' | 'blockKill' | 'landed' | 'serviceError' | 'attackError' | 'error';

export type SimEvent =
  | { type: 'contact'; time: number; playerKey: string; team: TeamId; kind: ContactKind; quality: number }
  | { type: 'point'; winner: TeamId; reason: PointReason; points: Score; sets: Score }
  | { type: 'rotation'; team: TeamId }
  | { type: 'setEnd'; winner: TeamId; sets: Score }
  | { type: 'matchEnd'; winner: TeamId };

export class EventBus {
  private handlers: Array<(e: SimEvent) => void> = [];

  on(handler: (e: SimEvent) => void): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  emit(e: SimEvent): void {
    for (const h of this.handlers) h(e);
  }
}
```

- [ ] **Step 4: Implementar `src/sim/tuning.ts`**

```ts
/** Todas las constantes de balance en un solo lugar. Ajustar con `npm run sim`. */
export const TUNING = {
  dt: 1 / 120,
  reactionTime: 0.25,
  /** Distancia que un jugador cubre estirándose o lanzándose, sin desplazarse. */
  reachRadius: 1.0,
  minPlanLead: 0.12,
  /** Si la pelota rival va a caer fuera por más de esto, se deja caer. */
  letDropMargin: 0.25,
  pointPause: 1.5,
  servePause: 1.0,
  passHeight: 0.9,
  setHeight: 2.3,
  diveHeight: 0.4,
  timing: { perfect: 0.3, good: 0.5, bad: 0.2 },
  serve: {
    float: { base: 1.0, risk: 0.09, speed: 15, gravityBonus: 0, contactHeight: 2.6, noise: 1.5 },
    jump: { base: 1.05, risk: 0.2, speed: 21, gravityBonus: 6, contactHeight: 3.1, noise: 2.0 },
    safe: { base: 0.8, risk: 0.03, speed: 11, gravityBonus: 0, contactHeight: 2.3, noise: 1.2 },
  },
  pass: { base: 1.05, risk: 0.12, flightTime: 1.35, noise: 3.0, lowContactBase: 0.8 },
  set: {
    base: 1.05,
    noise: 2.0,
    minPassForCombination: 0.55,
    outOfSystemPass: 0.3,
    rescueFlightTime: 1.5,
    flightTime: { zone4: 1.25, zone2: 1.0, quick: 0.55, pipe: 0.95 },
  },
  attack: {
    base: 1.08,
    minSpeed: 16,
    speedRange: 12,
    gravityBonus: 4,
    tipFlightTime: 0.9,
    noise: 2.0,
    targetSamples: 8,
    shots: { cross: { risk: 0.1 }, line: { risk: 0.14 }, tip: { risk: 0.04 } },
  },
  free: { flightTime: 1.6, risk: 0.03 },
  block: { reactionTime: 0.3, lateralSpeed: 3.0, handWidth: 0.6, stuffBase: 0.08, stuffScale: 0.3, touchChance: 0.25, doubleBonus: 1.25 },
} as const;
```

- [ ] **Step 5: Implementar `src/sim/resolver.ts`**

```ts
import type { Rng } from './rng';
import { TUNING } from './tuning';
import { clamp01 } from './vec';

export type Timing = 'perfect' | 'good' | 'bad';

export const TIMING_FACTOR: Record<Timing, number> = { perfect: 1, good: 0.85, bad: 0.55 };

export interface QualityInput {
  base: number;
  /** Calidad del toque anterior propio (0..1). */
  prevQuality: number;
  timing: Timing;
  /** Atributo relevante (0..100). */
  attribute: number;
  /** Presión rival: bloqueo, velocidad de la pelota (0..1). */
  pressure: number;
}

/** calidad = base × toque previo × timing × atributo × presión + ruido (spec §3.4) */
export function computeQuality(input: QualityInput, rng: Rng): number {
  const prev = 0.5 + 0.5 * clamp01(input.prevQuality);
  const attr = 0.6 + 0.4 * clamp01(input.attribute / 100);
  const pressure = 1 - 0.5 * clamp01(input.pressure);
  const raw = input.base * prev * TIMING_FACTOR[input.timing] * attr * pressure;
  return clamp01(raw + rng.range(-0.08, 0.08));
}

export function errorChance(risk: number, quality: number): number {
  return clamp01(risk * 2 * (1 - quality));
}

export function rollTiming(rng: Rng): Timing {
  const t = TUNING.timing;
  return rng.weighted<Timing>([
    { item: 'perfect', weight: t.perfect },
    { item: 'good', weight: t.good },
    { item: 'bad', weight: t.bad },
  ]);
}
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `npx vitest run tests/sim/resolver.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add src/sim/events.ts src/sim/tuning.ts src/sim/resolver.ts tests/sim/resolver.test.ts
git commit -m "feat(sim): eventos, constantes de balance y resolver de calidad"
```

---

### Task 7: Acciones disponibles, IA de decisiones y formaciones

**Files:**
- Create: `src/sim/actions.ts`, `src/sim/ai.ts`, `src/sim/formation.ts`
- Test: `tests/sim/actions.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/sim/actions.test.ts
import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import { availableSetOptions, SERVE_TYPES } from '../../src/sim/actions';
import { chooseServe, chooseSet } from '../../src/sim/ai';
import type { PlayerState } from '../../src/sim/players';
import { createRng } from '../../src/sim/rng';
import { v3 } from '../../src/sim/vec';

const team = TEAMS[0];
const players = new Map<string, PlayerState>(
  team.roster.map((p) => [`A:${p.id}`, { key: `A:${p.id}`, def: p, team: 'A', pos: v3(), target: v3() }]),
);
const court = team.lineup.map((id) => `A:${id}`); // [S, OH, MB, OP, OH, MB]
const options = (setter: string, pass: number, specialist: boolean) =>
  availableSetOptions(court, setter, pass, specialist, players).map((c) => `${c.option}@${court.indexOf(c.attackerKey)}`).sort();

describe('availableSetOptions', () => {
  it('pase bueno con colocador en zaga: todas las opciones', () => {
    expect(options(court[0], 0.8, true)).toEqual(['pipe@4', 'quick@2', 'zone2@3', 'zone4@1']);
  });

  it('pase malo: solo pelotas altas a los extremos', () => {
    expect(options(court[0], 0.3, true)).toEqual(['zone2@3', 'zone4@1']);
  });

  it('si coloca otro jugador no hay combinaciones', () => {
    expect(options(court[1], 0.9, false)).toEqual(['zone2@3']);
  });
});

describe('ai', () => {
  it('chooseServe devuelve tipo y zona válidos', () => {
    const rng = createRng(1);
    for (let i = 0; i < 100; i++) {
      const s = chooseServe(rng, team.roster[0]);
      expect(SERVE_TYPES).toContain(s.type);
      expect(s.zone).toBeGreaterThanOrEqual(1);
      expect(s.zone).toBeLessThanOrEqual(6);
    }
  });

  it('chooseSet elige una de las opciones', () => {
    const rng = createRng(2);
    const choices = availableSetOptions(court, court[0], 0.8, true, players);
    for (let i = 0; i < 50; i++) expect(choices).toContain(chooseSet(rng, choices));
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/sim/actions.test.ts`
Expected: FAIL, porque los módulos no existen.

- [ ] **Step 3: Implementar `src/sim/actions.ts`**

```ts
import { isFrontIndex } from './match';
import type { PlayerState } from './players';
import { TUNING } from './tuning';

export type ServeType = 'float' | 'jump' | 'safe';
export type SetOption = 'zone4' | 'zone2' | 'quick' | 'pipe';
export type AttackShot = 'cross' | 'line' | 'tip';
export type Zone = 1 | 2 | 3 | 4 | 5 | 6;

export const SERVE_TYPES: readonly ServeType[] = ['float', 'jump', 'safe'];
export const ATTACK_SHOTS: readonly AttackShot[] = ['cross', 'line', 'tip'];

export interface SetChoice {
  option: SetOption;
  attackerKey: string;
}

/**
 * Opciones de colocación según quién está en cancha (en orden de posición), quién coloca y la calidad del pase.
 * Las combinaciones (rápida, pipe) solo existen con colocador especialista y buen pase.
 */
export function availableSetOptions(
  court: readonly string[],
  setterKey: string,
  passQuality: number,
  setterIsSpecialist: boolean,
  players: ReadonlyMap<string, PlayerState>,
): SetChoice[] {
  const combos = setterIsSpecialist && passQuality >= TUNING.set.minPassForCombination;
  const choices: SetChoice[] = [];
  court.forEach((key, i) => {
    if (key === setterKey) return;
    const role = players.get(key)!.def.role;
    if (role === 'L') return;
    if (isFrontIndex(i)) {
      if (role === 'OH') choices.push({ option: 'zone4', attackerKey: key });
      else if (role === 'OP' || role === 'S') choices.push({ option: 'zone2', attackerKey: key });
      else if (role === 'MB' && combos) choices.push({ option: 'quick', attackerKey: key });
    } else if ((role === 'OH' || role === 'OP') && combos) {
      choices.push({ option: 'pipe', attackerKey: key });
    }
  });
  if (choices.length > 0) return choices;
  const fallback = court.find((key, i) => key !== setterKey && isFrontIndex(i) && players.get(key)!.def.role !== 'L')
    ?? court.find((key) => key !== setterKey && players.get(key)!.def.role !== 'L')!;
  return [{ option: 'zone4', attackerKey: fallback }];
}
```

- [ ] **Step 4: Implementar `src/sim/ai.ts`**

```ts
import type { AttackShot, ServeType, SetChoice, SetOption, Zone } from './actions';
import type { PlayerDef } from './players';
import type { Rng } from './rng';

export function chooseServe(rng: Rng, server: PlayerDef): { type: ServeType; zone: Zone } {
  const type = rng.weighted<ServeType>([
    { item: 'jump', weight: server.attrs.serve / 100 },
    { item: 'float', weight: 0.8 },
    { item: 'safe', weight: 0.15 },
  ]);
  const zone = rng.weighted<Zone>([
    { item: 1, weight: 3 }, { item: 5, weight: 3 }, { item: 6, weight: 2 },
    { item: 2, weight: 0.5 }, { item: 3, weight: 0.5 }, { item: 4, weight: 0.5 },
  ]);
  return { type, zone };
}

const SET_WEIGHT: Record<SetOption, number> = { zone4: 0.4, zone2: 0.25, quick: 0.2, pipe: 0.15 };

export function chooseSet(rng: Rng, choices: readonly SetChoice[]): SetChoice {
  return rng.weighted(choices.map((c) => ({ item: c, weight: SET_WEIGHT[c.option] })));
}

export function chooseShot(rng: Rng): AttackShot {
  return rng.weighted<AttackShot>([
    { item: 'cross', weight: 0.5 },
    { item: 'line', weight: 0.35 },
    { item: 'tip', weight: 0.15 },
  ]);
}
```

- [ ] **Step 5: Implementar `src/sim/formation.ts`**

```ts
import type { SetOption, Zone } from './actions';
import { toWorld, type TeamId } from './court';
import type { Vec3 } from './vec';

/** [depth, right] en coordenadas locales del equipo. */
export type Spot = readonly [number, number];

/** Índice = posición − 1. */
export const DEFENSE_SPOTS: readonly Spot[] = [[6.5, 3], [0.6, 3], [0.6, 0], [0.6, -3], [6.5, -3], [7.5, 0]];
export const RECEIVE_SPOTS: readonly Spot[] = [[6.5, 3], [3.5, 3], [3.0, 0], [3.5, -3], [6.5, -3], [7.0, 0]];
export const SETTER_SPOT: Spot = [0.8, 1.0];
export const SERVE_SPOT: Spot = [9.6, 2.5];
export const APPROACH_SPOTS: Record<SetOption, Spot> = { zone4: [3.2, -3.6], zone2: [3.2, 3.6], quick: [2.0, 0.5], pipe: [5.5, 0] };
export const ATTACK_POINTS: Record<SetOption, Spot> = { zone4: [1.0, -3.6], zone2: [1.0, 3.6], quick: [0.7, 0.4], pipe: [3.6, 0] };
export const ZONE_SPOTS: Record<Zone, Spot> = { 1: [7, 3], 2: [1.8, 3], 3: [1.8, 0], 4: [1.8, -3], 5: [7, -3], 6: [7, 0] };

export const spot = (team: TeamId, s: Spot, y = 0): Vec3 => toWorld(team, s[0], s[1], y);
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `npx vitest run tests/sim/actions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add src/sim/actions.ts src/sim/ai.ts src/sim/formation.ts tests/sim/actions.test.ts
git commit -m "feat(sim): acciones contextuales, decisiones de IA y formaciones"
```

---

### Task 8: Motor del rally (`Simulation`) y `runMatch`

**Files:**
- Create: `src/sim/rally.ts`, `src/sim/headless.ts`
- Test: `tests/sim/rally.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/sim/rally.test.ts
import { describe, expect, it } from 'vitest';
import { TEAMS } from '../../src/data/teams';
import type { TeamId } from '../../src/sim/court';
import { runMatch } from '../../src/sim/headless';
import type { SimOptions } from '../../src/sim/rally';

const opts = (seed: number): SimOptions => ({ seed, setsToWin: 1, teamA: TEAMS[0], teamB: TEAMS[1] });

describe('Simulation', () => {
  it('es determinista con la misma semilla', () => {
    const a = runMatch(opts(5));
    const b = runMatch(opts(5));
    expect(a.time).toBe(b.time);
    expect(a.match.winner).toBe(b.match.winner);
  });

  it('completa un partido a 1 set', () => {
    const sim = runMatch(opts(9));
    expect(sim.phase).toBe('matchOver');
    expect(sim.match.sets[sim.match.winner!]).toBe(1);
  });

  it('respeta máximo 3 toques y sin doble contacto (20 partidos)', () => {
    for (let seed = 1; seed <= 20; seed++) {
      runMatch(opts(seed), (sim) => {
        let side: TeamId | null = null;
        let count = 0;
        let lastKey: string | null = null;
        sim.bus.on((e) => {
          if (e.type === 'point') { side = null; count = 0; lastKey = null; return; }
          if (e.type !== 'contact') return;
          if (e.kind === 'serve' || e.kind === 'block') { side = e.team; count = 0; lastKey = e.kind === 'serve' ? e.playerKey : null; return; }
          if (e.team !== side) { side = e.team; count = 0; lastKey = null; }
          count += 1;
          expect(count).toBeLessThanOrEqual(3);
          expect(e.playerKey).not.toBe(lastKey);
          lastKey = e.playerKey;
        });
      });
    }
  });

  it('el líbero nunca saca, ni ataca, ni bloquea', () => {
    for (let seed = 1; seed <= 10; seed++) {
      runMatch(opts(seed), (sim) => {
        const liberos = new Set([`A:${TEAMS[0].libero}`, `B:${TEAMS[1].libero}`]);
        sim.bus.on((e) => {
          if (e.type === 'contact' && (e.kind === 'serve' || e.kind === 'attack' || e.kind === 'block')) {
            expect(liberos.has(e.playerKey)).toBe(false);
          }
        });
      });
    }
  });

  it('cada rally termina en menos de 60 s de simulación', () => {
    runMatch(opts(3), (sim) => {
      let start = 0;
      sim.bus.on((e) => {
        if (e.type === 'contact' && e.kind === 'serve') start = e.time;
        if (e.type === 'point') expect(sim.time - start).toBeLessThan(60);
      });
    });
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/sim/rally.test.ts`
Expected: FAIL, porque los módulos no existen.

- [ ] **Step 3: Implementar `src/sim/rally.ts`**

```ts
import type { TeamDef } from '../data/teams';
import { availableSetOptions, type AttackShot } from './actions';
import { chooseServe, chooseSet, chooseShot } from './ai';
import { checkNet, landingTime, launch, positionAt, timeAtHeightDescending, type Trajectory } from './ball';
import { COURT, GRAVITY, isInCourt, otherTeam, sideOfX, sideSign, toWorld, type TeamId } from './court';
import { EventBus, type ContactKind, type PointReason } from './events';
import { APPROACH_SPOTS, ATTACK_POINTS, DEFENSE_SPOTS, RECEIVE_SPOTS, SERVE_SPOT, SETTER_SPOT, ZONE_SPOTS, spot } from './formation';
import { awardPoint, courtPlayers, createMatch, isFrontIndex, type MatchState, type TeamSetup } from './match';
import { attackContactHeight, blockReach, moveSpeed, type PlayerState } from './players';
import { computeQuality, errorChance, rollTiming } from './resolver';
import { createRng, type Rng } from './rng';
import { TUNING } from './tuning';
import { clamp, clamp01, clone, distXZ, v3, type Vec3 } from './vec';

export interface SimOptions {
  seed: number;
  setsToWin: 1 | 2;
  teamA: TeamDef;
  teamB: TeamDef;
  firstServer?: TeamId;
}

export type Phase = 'preServe' | 'inPlay' | 'pointOver' | 'matchOver';

type BlockOutcome = 'stuff' | 'soft';

interface Touch {
  key: string;
  team: TeamId;
  kind: ContactKind;
  quality: number;
}

interface Plan {
  key: string;
  team: TeamId;
  time: number;
  point: Vec3;
  kind: ContactKind;
  /** Contacto bajo o de emergencia: penaliza la calidad. */
  low: boolean;
  block?: BlockOutcome;
}

interface Reach {
  time: number;
  point: Vec3;
  slack: number;
  low: boolean;
}

const TEAM_IDS: readonly TeamId[] = ['A', 'B'];

export class Simulation {
  readonly bus = new EventBus();
  readonly match: MatchState;
  readonly players = new Map<string, PlayerState>();
  readonly teams: Record<TeamId, TeamDef>;
  phase: Phase = 'preServe';
  time = 0;
  ball: Trajectory = { p0: v3(), v0: v3(), t0: 0, g: GRAVITY };
  ballPos: Vec3 = v3();

  private readonly rng: Rng;
  private phaseTimer = 0;
  private plan: Plan | null = null;
  private netFaultTime: number | null = null;
  private last: Touch | null = null;
  private touchSide: TeamId = 'A';
  private touches = 0;
  /** Dificultad de la pelota entrante para quien la recibe (0..1). */
  private threat = 0;
  private intent: { key: string } | null = null;
  private lastShot: AttackShot = 'cross';

  constructor(opts: SimOptions) {
    this.rng = createRng(opts.seed);
    this.teams = { A: opts.teamA, B: opts.teamB };
    for (const team of TEAM_IDS) {
      for (const def of this.teams[team].roster) {
        const key = `${team}:${def.id}`;
        this.players.set(key, { key, def, team, pos: v3(), target: v3() });
      }
    }
    this.match = createMatch({ setsToWin: opts.setsToWin }, this.setup('A'), this.setup('B'), opts.firstServer ?? 'A');
    this.resetForServe();
  }

  court(team: TeamId): string[] {
    return courtPlayers(this.match, team);
  }

  player(key: string): PlayerState {
    const p = this.players.get(key);
    if (!p) throw new Error(`Jugador desconocido: ${key}`);
    return p;
  }

  step(dt: number): void {
    if (this.phase === 'matchOver') return;
    this.time += dt;
    this.movePlayers(dt);
    if (this.phase === 'preServe') {
      this.ballPos = this.serverHand();
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) this.serve();
    } else if (this.phase === 'inPlay') {
      this.ballPos = positionAt(this.ball, this.time);
      if (this.netFaultTime !== null) {
        if (this.time >= this.netFaultTime) this.endRally(this.last!.team);
      } else if (this.plan) {
        if (this.time >= this.plan.time) this.executeContact(this.plan);
      } else if (this.time >= landingTime(this.ball)) {
        this.ballLanded();
      }
    } else {
      this.ballPos = positionAt(this.ball, Math.min(this.time, landingTime(this.ball)));
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        if (this.match.winner) this.phase = 'matchOver';
        else this.resetForServe();
      }
    }
  }

  // ---------- preparación ----------

  private setup(team: TeamId): TeamSetup {
    const d = this.teams[team];
    const k = (id: string) => `${team}:${id}`;
    return { lineup: d.lineup.map(k), libero: k(d.libero), liberoReplaces: d.liberoReplaces.map(k) };
  }

  private resetForServe(): void {
    this.phase = 'preServe';
    this.phaseTimer = TUNING.servePause;
    this.plan = null;
    this.netFaultTime = null;
    this.last = null;
    this.intent = null;
    this.threat = 0;
    this.touchSide = this.match.serving;
    this.touches = 0;
    for (const team of TEAM_IDS) {
      const court = this.court(team);
      const receiving = team !== this.match.serving;
      let bench = 0;
      for (const p of this.players.values()) {
        if (p.team !== team) continue;
        const idx = court.indexOf(p.key);
        let target: Vec3;
        if (idx < 0) target = toWorld(team, 2.5 + 0.7 * bench++, -6.5);
        else if (!receiving && idx === 0) target = spot(team, SERVE_SPOT);
        else target = spot(team, (receiving ? RECEIVE_SPOTS : DEFENSE_SPOTS)[idx]);
        p.pos = clone(target);
        p.target = clone(target);
      }
    }
    this.ballPos = this.serverHand();
  }

  private serverHand(): Vec3 {
    const p = this.player(this.court(this.match.serving)[0]);
    return v3(p.pos.x, 1.4, p.pos.z);
  }

  private movePlayers(dt: number): void {
    for (const p of this.players.values()) {
      const dx = p.target.x - p.pos.x;
      const dz = p.target.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-6) continue;
      const len = Math.min(d, moveSpeed(p.def) * dt);
      p.pos.x += (dx / d) * len;
      p.pos.z += (dz / d) * len;
    }
  }

  // ---------- contactos ----------

  private registerTouch(p: PlayerState, kind: ContactKind, quality: number): void {
    if (kind === 'serve' || kind === 'block') {
      this.touchSide = p.team;
      this.touches = 0;
    } else if (this.touchSide === p.team) {
      this.touches += 1;
    } else {
      this.touchSide = p.team;
      this.touches = 1;
    }
    this.last = { key: p.key, team: p.team, kind, quality };
    this.bus.emit({ type: 'contact', time: this.time, playerKey: p.key, team: p.team, kind, quality });
  }

  private serve(): void {
    const team = this.match.serving;
    const server = this.player(this.court(team)[0]);
    const choice = chooseServe(this.rng, server.def);
    const cfg = TUNING.serve[choice.type];
    const from = v3(server.pos.x, cfg.contactHeight, server.pos.z);
    const q = computeQuality(
      { base: cfg.base, prevQuality: 1, timing: rollTiming(this.rng), attribute: server.def.attrs.serve, pressure: 0 },
      this.rng,
    );
    this.phase = 'inPlay';
    this.registerTouch(server, 'serve', q);
    const opp = otherTeam(team);
    const isError = this.rng.chance(errorChance(cfg.risk, q));
    const target = isError
      ? this.errorTarget(opp, from)
      : this.keepOnSide(opp, this.noisy(spot(opp, ZONE_SPOTS[choice.zone], COURT.ballRadius), cfg.noise * (1 - q)));
    this.ball = this.launchClearing(from, target, distXZ(from, target) / cfg.speed, GRAVITY + cfg.gravityBonus, this.time, !isError);
    this.threat = q * clamp01(cfg.speed / 22);
    this.planNext();
  }

  private executeContact(plan: Plan): void {
    const p = this.player(plan.key);
    const t = plan.time;
    const at = positionAt(this.ball, t);
    this.plan = null;
    switch (plan.kind) {
      case 'reception':
      case 'dig':
        this.doPass(p, plan.kind, at, t, plan.low);
        break;
      case 'set':
        this.doSet(p, at, t, plan.low);
        break;
      case 'attack':
        this.doAttack(p, at, t);
        break;
      case 'free':
        this.doFree(p, at, t);
        break;
      case 'block':
        this.doBlock(p, at, t, plan.block!);
        break;
      case 'serve':
        throw new Error('El saque no se planifica');
    }
    this.planNext();
  }

  private doPass(p: PlayerState, kind: 'reception' | 'dig', at: Vec3, t: number, low: boolean): void {
    const cfg = TUNING.pass;
    const attribute = kind === 'reception' ? p.def.attrs.reception : p.def.attrs.defense;
    const q = computeQuality(
      { base: low ? cfg.lowContactBase : cfg.base, prevQuality: 1, timing: rollTiming(this.rng), attribute, pressure: this.threat },
      this.rng,
    );
    this.registerTouch(p, kind, q);
    this.intent = null;
    if (this.rng.chance(errorChance(cfg.risk, q))) {
      const wild = v3(at.x + this.rng.range(-6, 6), COURT.ballRadius, at.z + this.rng.range(-6, 6));
      this.ball = launch(at, wild, 1.0, t);
    } else {
      const target = this.noisy(spot(p.team, SETTER_SPOT, TUNING.setHeight), cfg.noise * (1 - q));
      this.ball = launch(at, target, cfg.flightTime, t);
    }
    this.threat = 0;
  }

  private doSet(p: PlayerState, at: Vec3, t: number, low: boolean): void {
    const cfg = TUNING.set;
    const passQuality = this.last!.quality;
    const specialist = p.def.role === 'S';
    const choice = chooseSet(this.rng, availableSetOptions(this.court(p.team), p.key, passQuality, specialist, this.players));
    const attacker = this.player(choice.attackerKey);
    const q = computeQuality(
      { base: low ? TUNING.pass.lowContactBase : cfg.base, prevQuality: passQuality, timing: rollTiming(this.rng), attribute: p.def.attrs.setting, pressure: 0 },
      this.rng,
    );
    this.registerTouch(p, 'set', q);
    const outOfSystem = low || passQuality < cfg.outOfSystemPass;
    const [depth, right] = ATTACK_POINTS[choice.option];
    const point = toWorld(p.team, outOfSystem ? Math.max(depth, 2.0) : depth, right, attackContactHeight(attacker.def) - 0.1);
    const target = this.noisy(point, cfg.noise * (1 - q));
    this.ball = launch(at, target, outOfSystem ? cfg.rescueFlightTime : cfg.flightTime[choice.option], t);
    this.intent = { key: attacker.key };
    this.threat = 0;
  }

  private doAttack(p: PlayerState, at: Vec3, t: number): void {
    const cfg = TUNING.attack;
    const opp = otherTeam(p.team);
    const shot = chooseShot(this.rng);
    const q = computeQuality(
      {
        base: cfg.base,
        prevQuality: this.last!.quality,
        timing: rollTiming(this.rng),
        attribute: (p.def.attrs.attackPower + p.def.attrs.attackAccuracy) / 2,
        pressure: this.blockPressure(opp, at),
      },
      this.rng,
    );
    this.registerTouch(p, 'attack', q);
    this.lastShot = shot;
    this.intent = null;
    const isError = this.rng.chance(errorChance(cfg.shots[shot].risk, q));
    const target = isError
      ? this.errorTarget(opp, at)
      : this.keepOnSide(opp, this.noisy(this.pickAttackTarget(opp, at, shot), cfg.noise * (1 - q)));
    if (shot === 'tip') {
      this.ball = this.launchClearing(at, target, cfg.tipFlightTime, GRAVITY, t, !isError);
      this.threat = 0.3 * q;
    } else {
      const speed = cfg.minSpeed + cfg.speedRange * q * (p.def.attrs.attackPower / 100);
      this.ball = this.launchClearing(at, target, distXZ(at, target) / speed, GRAVITY + cfg.gravityBonus, t, !isError);
      this.threat = q * clamp01(speed / 28);
    }
  }

  private doFree(p: PlayerState, at: Vec3, t: number): void {
    const last = this.last;
    const prevQuality = last && last.team === p.team ? last.quality : 0.5;
    const q = computeQuality(
      { base: 0.9, prevQuality, timing: rollTiming(this.rng), attribute: p.def.attrs.reception, pressure: this.threat },
      this.rng,
    );
    this.registerTouch(p, 'free', q);
    this.intent = null;
    const opp = otherTeam(p.team);
    const isError = this.rng.chance(errorChance(TUNING.free.risk, q));
    const target = isError ? this.errorTarget(opp, at) : toWorld(opp, this.rng.range(5, 8), this.rng.range(-3, 3), COURT.ballRadius);
    this.ball = this.launchClearing(at, target, TUNING.free.flightTime, GRAVITY, t, !isError);
    this.threat = 0.1;
  }

  private doBlock(p: PlayerState, at: Vec3, t: number, outcome: BlockOutcome): void {
    this.registerTouch(p, 'block', outcome === 'stuff' ? 0.9 : 0.5);
    this.intent = null;
    const attackers = otherTeam(p.team);
    if (outcome === 'stuff') {
      // Las manos pasan sobre la red: la pelota sale ya del lado atacante.
      const from = v3(sideSign(attackers) * 0.1, Math.max(at.y, 2.7), at.z);
      const z = clamp(at.z + this.rng.range(-1.5, 1.5), -COURT.halfWidth - 1, COURT.halfWidth + 1);
      const target = v3(sideSign(attackers) * this.rng.range(0.5, 3), COURT.ballRadius, z);
      this.ball = launch(from, target, 0.4, t);
      this.threat = 0.8;
    } else {
      const from = v3(sideSign(p.team) * 0.15, Math.max(at.y, 2.7), at.z);
      const target = v3(sideSign(p.team) * this.rng.range(2.5, 6), COURT.ballRadius, this.rng.range(-3, 3));
      this.ball = launch(from, target, 1.3, t);
      this.threat = 0.2;
    }
  }

  // ---------- planificación ----------

  private planNext(): void {
    this.plan = null;
    this.netFaultTime = null;
    const net = checkNet(this.ball);
    if (net.kind === 'fault') {
      this.netFaultTime = net.time;
      this.setFormations();
      return;
    }
    const last = this.last!;
    if (net.kind === 'clear' && last.kind === 'attack' && this.lastShot !== 'tip') {
      this.plan = this.planBlock(otherTeam(last.team), net.time);
    }
    if (!this.plan) {
      const team = sideOfX(positionAt(this.ball, landingTime(this.ball)).x);
      this.plan = this.planTouch(team);
    }
    this.setFormations();
  }

  private planTouch(team: TeamId): Plan | null {
    const last = this.last!;
    const n = (this.touchSide === team ? this.touches : 0) + 1;
    if (n > 3) return null;
    if (last.team !== team && !this.isNearlyIn(positionAt(this.ball, landingTime(this.ball)))) return null;
    const exclude = last.team === team && last.kind !== 'block' ? last.key : null;
    const court = this.court(team).filter((k) => k !== exclude);
    const low = [TUNING.passHeight, TUNING.diveHeight];

    if (n === 3) {
      const attacker = this.intent?.key;
      if (attacker && court.includes(attacker)) {
        const r = this.reach(attacker, [attackContactHeight(this.player(attacker).def) - 0.1]);
        if (r) return { key: attacker, team, time: r.time, point: r.point, kind: 'attack', low: false };
      }
      return this.bestContact(team, court, low, 'free');
    }
    if (n === 2) {
      const setter = court.find((k) => this.player(k).def.role === 'S');
      if (setter) {
        const r = this.reach(setter, [TUNING.setHeight]);
        if (r) return { key: setter, team, time: r.time, point: r.point, kind: 'set', low: false };
      }
      return this.bestContact(team, court.filter((k) => k !== setter), [TUNING.setHeight], 'set')
        ?? this.bestContact(team, court, low, 'set', true);
    }
    const kind: ContactKind = last.kind === 'serve' ? 'reception' : 'dig';
    const nonSetters = court.filter((k) => this.player(k).def.role !== 'S');
    return this.bestContact(team, nonSetters, low, kind) ?? this.bestContact(team, court, low, kind);
  }

  private bestContact(team: TeamId, keys: readonly string[], heights: readonly number[], kind: ContactKind, forceLow = false): Plan | null {
    let best: Plan | null = null;
    let bestSlack = -Infinity;
    for (const key of keys) {
      const r = this.reach(key, heights);
      if (r && r.slack > bestSlack) {
        bestSlack = r.slack;
        best = { key, team, time: r.time, point: r.point, kind, low: r.low || forceLow };
      }
    }
    return best;
  }

  /** Primer contacto alcanzable por el jugador entre las alturas dadas (en orden de preferencia). */
  private reach(key: string, heights: readonly number[]): Reach | null {
    const p = this.player(key);
    for (let i = 0; i < heights.length; i++) {
      const time = timeAtHeightDescending(this.ball, heights[i]);
      if (time === null || time < this.time + TUNING.minPlanLead) continue;
      const point = positionAt(this.ball, time);
      if (sideOfX(point.x) !== p.team) continue;
      if (Math.abs(point.x) > COURT.halfLength + 4 || Math.abs(point.z) > COURT.halfWidth + 4) continue;
      const available = time - this.time - TUNING.reactionTime;
      const distance = Math.max(0, distXZ(p.pos, point) - TUNING.reachRadius);
      const slack = available - distance / moveSpeed(p.def);
      if (slack >= 0) return { time, point, slack, low: i > 0 };
    }
    return null;
  }

  private planBlock(team: TeamId, crossTime: number): Plan | null {
    const cfg = TUNING.block;
    const at = positionAt(this.ball, crossTime);
    const available = Math.max(0, crossTime - this.time - cfg.reactionTime);
    const blockers = this.court(team)
      .filter((_, i) => isFrontIndex(i))
      .map((k) => this.player(k))
      .filter((p) => p.def.role !== 'L' && at.y <= blockReach(p.def))
      .filter((p) => Math.max(0, Math.abs(p.pos.z - at.z) - cfg.handWidth) <= cfg.lateralSpeed * available)
      .sort((a, b) => Math.abs(a.pos.z - at.z) - Math.abs(b.pos.z - at.z))
      .slice(0, 2);
    if (blockers.length === 0) return null;
    const blockAttr = blockers.reduce((s, p) => s + p.def.attrs.block, 0) / blockers.length / 100;
    const stuff = clamp01((cfg.stuffBase + cfg.stuffScale * blockAttr * (1 - this.last!.quality)) * (blockers.length === 2 ? cfg.doubleBonus : 1));
    const r = this.rng.next();
    const outcome: BlockOutcome | null = r < stuff ? 'stuff' : r < stuff + cfg.touchChance ? 'soft' : null;
    if (!outcome) return null;
    return { key: blockers[0].key, team, time: crossTime, point: at, kind: 'block', low: false, block: outcome };
  }

  private setFormations(): void {
    const plan = this.plan;
    for (const team of TEAM_IDS) {
      const building = plan !== null && plan.team === team && plan.kind !== 'block' && this.touchSide === team && this.touches >= 1;
      const receivingFirst = plan !== null && plan.team === team && !building;
      this.court(team).forEach((key, idx) => {
        const p = this.player(key);
        if (plan && plan.key === key) p.target = v3(plan.point.x, 0, plan.point.z);
        else if (building) p.target = this.attackSpot(team, p, idx);
        else if (receivingFirst) {
          if (p.def.role === 'S') p.target = spot(team, SETTER_SPOT);
        } else p.target = spot(team, DEFENSE_SPOTS[idx]);
      });
    }
  }

  private attackSpot(team: TeamId, p: PlayerState, idx: number): Vec3 {
    if (p.def.role === 'S') return spot(team, SETTER_SPOT);
    if (!isFrontIndex(idx)) return spot(team, p.def.role === 'OH' ? APPROACH_SPOTS.pipe : DEFENSE_SPOTS[idx]);
    if (p.def.role === 'OH') return spot(team, APPROACH_SPOTS.zone4);
    if (p.def.role === 'MB') return spot(team, APPROACH_SPOTS.quick);
    return spot(team, APPROACH_SPOTS.zone2);
  }

  // ---------- objetivos ----------

  private pickAttackTarget(opp: TeamId, at: Vec3, shot: AttackShot): Vec3 {
    const s = sideSign(opp);
    const lane = at.z === 0 ? (this.rng.chance(0.5) ? 1 : -1) : Math.sign(at.z);
    const defenders = this.court(opp).map((k) => this.player(k).pos);
    let best = v3();
    let bestScore = -Infinity;
    for (let i = 0; i < TUNING.attack.targetSamples; i++) {
      let depth: number;
      let z: number;
      if (shot === 'line') {
        depth = this.rng.range(5, 8.5);
        z = lane * this.rng.range(2.5, 4.2);
      } else if (shot === 'cross') {
        depth = this.rng.range(3.5, 8);
        z = -lane * this.rng.range(0.5, 4.2);
      } else {
        depth = this.rng.range(1, 3);
        z = this.rng.range(-4, 4);
      }
      const candidate = v3(s * depth, COURT.ballRadius, z);
      const score = Math.min(...defenders.map((d) => distXZ(d, candidate)));
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  private errorTarget(opp: TeamId, from: Vec3): Vec3 {
    const s = sideSign(opp);
    if (this.rng.chance(0.5)) return v3(s * 0.8, COURT.ballRadius, from.z); // a la red
    if (this.rng.chance(0.6)) {
      const z = clamp(from.z + this.rng.range(-2, 2), -COURT.halfWidth, COURT.halfWidth);
      return v3(s * (COURT.halfLength + this.rng.range(0.5, 2.5)), COURT.ballRadius, z); // larga
    }
    const side = this.rng.chance(0.5) ? 1 : -1;
    return v3(s * this.rng.range(3, 8), COURT.ballRadius, side * (COURT.halfWidth + this.rng.range(0.4, 1.5))); // afuera lateral
  }

  private noisy(p: Vec3, radius: number): Vec3 {
    const a = this.rng.range(0, Math.PI * 2);
    const r = radius * Math.sqrt(this.rng.next());
    return v3(p.x + Math.cos(a) * r, p.y, p.z + Math.sin(a) * r);
  }

  private keepOnSide(team: TeamId, p: Vec3): Vec3 {
    const s = sideSign(team);
    return s * p.x < 0.5 ? v3(s * 0.5, p.y, p.z) : p;
  }

  /** Si la trayectoria pega en la red, la levanta (más tiempo de vuelo) hasta que pase. */
  private launchClearing(from: Vec3, to: Vec3, flightTime: number, g: number, t0: number, mustClear: boolean): Trajectory {
    let time = Math.max(0.15, flightTime);
    let tr = launch(from, to, time, t0, g);
    for (let i = 0; mustClear && i < 15; i++) {
      const c = checkNet(tr);
      if (c.kind !== 'fault' || c.reason !== 'net') break;
      time *= 1.1;
      tr = launch(from, to, time, t0, g);
    }
    return tr;
  }

  private blockPressure(opp: TeamId, at: Vec3): number {
    const near = this.court(opp).filter((k, i) => isFrontIndex(i) && Math.abs(this.player(k).pos.z - at.z) < 1.5).length;
    return Math.min(0.6, 0.3 * near);
  }

  private isNearlyIn(p: Vec3): boolean {
    return Math.abs(p.x) <= COURT.halfLength + TUNING.letDropMargin && Math.abs(p.z) <= COURT.halfWidth + TUNING.letDropMargin;
  }

  // ---------- fin del rally ----------

  private ballLanded(): void {
    const p = positionAt(this.ball, landingTime(this.ball));
    this.endRally(isInCourt(p) ? sideOfX(p.x) : this.last!.team);
  }

  private endRally(loser: TeamId): void {
    const winner = otherTeam(loser);
    const reason = this.pointReason(loser);
    const out = awardPoint(this.match, winner);
    this.bus.emit({ type: 'point', winner, reason, points: out.points, sets: { ...this.match.sets } });
    if (out.rotated) this.bus.emit({ type: 'rotation', team: out.rotated });
    if (out.setWinner) this.bus.emit({ type: 'setEnd', winner: out.setWinner, sets: { ...this.match.sets } });
    if (out.matchWinner) this.bus.emit({ type: 'matchEnd', winner: out.matchWinner });
    this.phase = 'pointOver';
    this.phaseTimer = TUNING.pointPause;
    this.plan = null;
    this.netFaultTime = null;
  }

  private pointReason(loser: TeamId): PointReason {
    const { kind, team } = this.last!;
    if (team === loser) return kind === 'serve' ? 'serviceError' : kind === 'attack' ? 'attackError' : 'error';
    return kind === 'serve' ? 'ace' : kind === 'attack' ? 'kill' : kind === 'block' ? 'blockKill' : 'landed';
  }
}
```

- [ ] **Step 4: Implementar `src/sim/headless.ts`**

```ts
import { Simulation, type SimOptions } from './rally';
import { TUNING } from './tuning';

/** Corre un partido completo sin gráficos. `onCreate` permite suscribirse al bus antes del primer saque. */
export function runMatch(opts: SimOptions, onCreate?: (sim: Simulation) => void, maxSimSeconds = 6 * 3600): Simulation {
  const sim = new Simulation(opts);
  onCreate?.(sim);
  while (sim.phase !== 'matchOver') {
    sim.step(TUNING.dt);
    if (sim.time > maxSimSeconds) throw new Error(`Partido trabado (seed ${opts.seed})`);
  }
  return sim;
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run tests/sim/rally.test.ts`
Expected: PASS (5 tests). Si algún test falla, depurar con superpowers:systematic-debugging antes de seguir. No relajar los tests.

- [ ] **Step 6: Typecheck**

Run: `npx tsc`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add src/sim/rally.ts src/sim/headless.ts tests/sim/rally.test.ts
git commit -m "feat(sim): motor de rally y partido completo IA vs IA"
```

---

### Task 9: Métricas y script de simulación masiva

**Files:**
- Create: `src/sim/metrics.ts`, `scripts/simulate.ts`
- Test: `tests/sim/metrics.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// tests/sim/metrics.test.ts
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/sim/events';
import { attachMetrics, emptyMetrics, summarize } from '../../src/sim/metrics';

describe('metrics', () => {
  it('cuenta kills, errores de saque y toques por rally', () => {
    const bus = new EventBus();
    const m = emptyMetrics();
    attachMetrics(bus, m);
    const sets = { A: 0, B: 0 };
    const contact = (team: 'A' | 'B', kind: 'serve' | 'reception' | 'set' | 'attack' | 'block') =>
      bus.emit({ type: 'contact', time: 0, playerKey: `${team}:x`, team, kind, quality: 0.5 });
    // Rally 1: saque A, B recibe, coloca, ataca, A bloquea (toque), punto B → kill
    contact('A', 'serve'); contact('B', 'reception'); contact('B', 'set'); contact('B', 'attack'); contact('A', 'block');
    bus.emit({ type: 'point', winner: 'B', reason: 'landed', points: { A: 0, B: 1 }, sets });
    // Rally 2: error de saque de B
    contact('B', 'serve');
    bus.emit({ type: 'point', winner: 'A', reason: 'serviceError', points: { A: 1, B: 1 }, sets });
    bus.emit({ type: 'matchEnd', winner: 'A' });
    const s = summarize(m);
    expect(s.touchesPerRally).toBe(3);
    expect(s.killRate).toBe(1);
    expect(s.serveErrorRate).toBe(0.5);
    expect(s.winRateA).toBe(1);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run tests/sim/metrics.test.ts`
Expected: FAIL, porque el módulo no existe.

- [ ] **Step 3: Implementar `src/sim/metrics.ts`**

```ts
import type { TeamId } from './court';
import type { EventBus } from './events';

export interface Metrics {
  matches: number;
  rallies: number;
  contacts: number;
  attacks: number;
  kills: number;
  serves: number;
  serviceErrors: number;
  aces: number;
  wins: Record<TeamId, number>;
}

export interface Summary {
  touchesPerRally: number;
  killRate: number;
  serveErrorRate: number;
  aceRate: number;
  winRateA: number;
}

/** Rangos objetivo del spec §7. */
export const TARGETS: Record<'touchesPerRally' | 'killRate' | 'serveErrorRate' | 'winRateA', readonly [number, number]> = {
  touchesPerRally: [3, 8],
  killRate: [0.35, 0.55],
  serveErrorRate: [0.08, 0.15],
  winRateA: [0.45, 0.55],
};

export const emptyMetrics = (): Metrics => ({
  matches: 0, rallies: 0, contacts: 0, attacks: 0, kills: 0, serves: 0, serviceErrors: 0, aces: 0, wins: { A: 0, B: 0 },
});

export function attachMetrics(bus: EventBus, m: Metrics): void {
  /** Equipo cuyo último ataque sigue vivo (nadie más lo ha tocado salvo un bloqueo). */
  let pendingAttack: TeamId | null = null;
  bus.on((e) => {
    if (e.type === 'contact') {
      m.contacts += 1;
      if (e.kind === 'serve') {
        m.serves += 1;
        m.rallies += 1;
      }
      if (e.kind === 'attack') {
        m.attacks += 1;
        pendingAttack = e.team;
      } else if (e.kind !== 'block') {
        pendingAttack = null;
      }
    } else if (e.type === 'point') {
      if (pendingAttack && e.winner === pendingAttack) m.kills += 1;
      pendingAttack = null;
      if (e.reason === 'serviceError') m.serviceErrors += 1;
      if (e.reason === 'ace') m.aces += 1;
    } else if (e.type === 'matchEnd') {
      m.matches += 1;
      m.wins[e.winner] += 1;
    }
  });
}

const ratio = (a: number, b: number): number => (b === 0 ? 0 : a / b);

export function summarize(m: Metrics): Summary {
  return {
    touchesPerRally: ratio(m.contacts, m.rallies),
    killRate: ratio(m.kills, m.attacks),
    serveErrorRate: ratio(m.serviceErrors, m.serves),
    aceRate: ratio(m.aces, m.serves),
    winRateA: ratio(m.wins.A, m.matches),
  };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run tests/sim/metrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Implementar `scripts/simulate.ts`**

```ts
import { makeTeam } from '../src/data/teams';
import { runMatch } from '../src/sim/headless';
import { TARGETS, attachMetrics, emptyMetrics, summarize } from '../src/sim/metrics';

const n = Number(process.argv[2] ?? 400);
const equal = makeTeam({ id: 'EQ', name: 'Iguales', province: '-', primary: '#888888', secondary: '#ffffff', style: 'balanced', seed: 1, variance: 0 });
const metrics = emptyMetrics();
const started = Date.now();

for (let i = 0; i < n; i++) {
  runMatch(
    { seed: 1000 + i, setsToWin: 1, teamA: equal, teamB: equal, firstServer: i % 2 === 0 ? 'A' : 'B' },
    (sim) => attachMetrics(sim.bus, metrics),
  );
}

const s = summarize(metrics);
console.log(`${n} partidos (1 set, equipos iguales) en ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
let failures = 0;
for (const [key, value] of Object.entries(s) as [keyof typeof s, number][]) {
  const range = (TARGETS as Record<string, readonly [number, number]>)[key];
  const ok = !range || (value >= range[0] && value <= range[1]);
  if (!ok) failures += 1;
  const label = range ? `[${range[0]}, ${range[1]}] ${ok ? 'OK' : 'FUERA'}` : '';
  console.log(`${key.padEnd(16)} ${value.toFixed(3).padStart(7)}  ${label}`);
}
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 6: Correr la simulación**

Run: `npm run sim -- 100`
Expected: se imprime la tabla de métricas sin excepciones. Algunas métricas pueden salir FUERA; eso se resuelve en la Task 10.

- [ ] **Step 7: Commit**

```bash
git add src/sim/metrics.ts scripts/simulate.ts tests/sim/metrics.test.ts
git commit -m "feat(sim): métricas de balance y script de simulación masiva"
```

---

### Task 10: Ajuste de balance y test de aceptación

**Files:**
- Modify: `src/sim/tuning.ts`
- Test: `tests/sim/balance.test.ts`

- [ ] **Step 1: Escribir el test de aceptación**

```ts
// tests/sim/balance.test.ts
import { describe, expect, it } from 'vitest';
import { makeTeam } from '../../src/data/teams';
import { runMatch } from '../../src/sim/headless';
import { TARGETS, attachMetrics, emptyMetrics, summarize } from '../../src/sim/metrics';

describe('balance (spec §7)', () => {
  it('métricas de 120 partidos IA vs IA dentro de rango', () => {
    const equal = makeTeam({ id: 'EQ', name: 'Iguales', province: '-', primary: '#888888', secondary: '#ffffff', style: 'balanced', seed: 1, variance: 0 });
    const m = emptyMetrics();
    for (let i = 0; i < 120; i++) {
      runMatch({ seed: 5000 + i, setsToWin: 1, teamA: equal, teamB: equal, firstServer: i % 2 === 0 ? 'A' : 'B' }, (sim) => attachMetrics(sim.bus, m));
    }
    const s = summarize(m);
    const within = (v: number, [lo, hi]: readonly [number, number]) => v >= lo && v <= hi;
    expect(within(s.touchesPerRally, TARGETS.touchesPerRally), `toques/rally ${s.touchesPerRally}`).toBe(true);
    expect(within(s.killRate, TARGETS.killRate), `kill rate ${s.killRate}`).toBe(true);
    expect(within(s.serveErrorRate, TARGETS.serveErrorRate), `error de saque ${s.serveErrorRate}`).toBe(true);
    // Con 120 partidos el ruido estadístico es ±9 %; el rango estricto 45–55 % se verifica con `npm run sim` (400 partidos).
    expect(within(s.winRateA, [0.4, 0.6]), `win rate A ${s.winRateA}`).toBe(true);
  }, 180_000);
});
```

- [ ] **Step 2: Correr la simulación completa y anotar los valores**

Run: `npm run sim`
Anotar los valores de `touchesPerRally`, `killRate`, `serveErrorRate` y `winRateA`.

- [ ] **Step 3: Ajustar `src/sim/tuning.ts` hasta que todo esté en rango**

Cambiar **una perilla a la vez** y volver a correr `npm run sim` después de cada cambio:

| Métrica fuera de rango | Perilla principal | Dirección |
|---|---|---|
| `touchesPerRally` muy bajo (rallies cortos) | `reachRadius` ↑, `attack.minSpeed` ↓ | más defensas |
| `touchesPerRally` muy alto | `reachRadius` ↓, `attack.speedRange` ↑ | menos defensas |
| `killRate` muy alto | `reachRadius` ↑, `block.stuffBase` ↑, `attack.speedRange` ↓ | |
| `killRate` muy bajo | `reactionTime` ↑, `attack.targetSamples` ↑, `attack.noise` ↓ | |
| `serveErrorRate` fuera de rango | `serve.*.risk` | proporcional |
| `winRateA` fuera de 45–55 % con equipos idénticos | — | **es un bug, no se ajusta**: investigar con superpowers:systematic-debugging |

- [ ] **Step 4: Correr el test de aceptación**

Run: `npx vitest run tests/sim/balance.test.ts`
Expected: PASS.

- [ ] **Step 5: Correr toda la suite y el typecheck**

Run: `npx vitest run` → todo PASS. Run: `npx tsc` → sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/sim/tuning.ts tests/sim/balance.test.ts
git commit -m "test(sim): balance IA vs IA dentro de los rangos del spec"
```

---

### Task 11: Vista 3D con primitivas y HUD

**Files:**
- Create: `src/render/scene.ts`, `src/ui/hud.ts`, `.claude/launch.json`
- Modify: `src/main.ts`

- [ ] **Step 1: Implementar `src/render/scene.ts`**

```ts
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
```

- [ ] **Step 2: Implementar `src/ui/hud.ts`**

```ts
import type { PointReason } from '../sim/events';
import type { Simulation } from '../sim/rally';

const REASON_LABEL: Record<PointReason, string> = {
  ace: '¡Ace!',
  kill: '¡Remate ganador!',
  blockKill: '¡Qué tapa!',
  landed: 'Pelota al piso',
  serviceError: 'Error de saque',
  attackError: 'Error de ataque',
  error: 'Error',
};

export class Hud {
  private readonly el = document.createElement('div');
  private message = '';

  constructor(root: HTMLElement, private readonly sim: Simulation) {
    this.el.className = 'hud';
    root.appendChild(this.el);
    sim.bus.on((e) => {
      if (e.type === 'point') this.message = `${REASON_LABEL[e.reason]} — punto ${sim.teams[e.winner].name}`;
      if (e.type === 'setEnd') this.message = `Set para ${sim.teams[e.winner].name}`;
      if (e.type === 'matchEnd') this.message = `¡${sim.teams[e.winner].name} gana el partido!`;
    });
  }

  update(): void {
    const { points, sets } = this.sim.match;
    const { A, B } = this.sim.teams;
    this.el.textContent = `${A.name}  ${sets.A}  |  ${points.A} – ${points.B}  |  ${sets.B}  ${B.name}\n${this.message}`;
  }
}
```

- [ ] **Step 3: Reemplazar `src/main.ts`**

```ts
import { TEAMS } from './data/teams';
import { MatchView } from './render/scene';
import { Simulation } from './sim/rally';
import { TUNING } from './sim/tuning';
import { Hud } from './ui/hud';

const sim = new Simulation({ seed: Date.now() % 1_000_000_000, setsToWin: 2, teamA: TEAMS[0], teamB: TEAMS[2] });
const view = new MatchView(document.getElementById('app')!, sim);
const hud = new Hud(document.getElementById('hud')!, sim);

let speed = 1;
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'f') speed = speed === 1 ? 4 : 1;
});

let last = performance.now();
let acc = 0;
function frame(now: number): void {
  acc += Math.min(0.25, (now - last) / 1000) * speed;
  last = now;
  while (acc >= TUNING.dt) {
    sim.step(TUNING.dt);
    acc -= TUNING.dt;
  }
  view.render();
  hud.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

- [ ] **Step 4: Crear `.claude/launch.json`**

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "voleibol-dev", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 5173 }
  ]
}
```

- [ ] **Step 5: Typecheck y build**

Run: `npx tsc` → sin errores. Run: `npx vite build` → build OK.

- [ ] **Step 6: Verificación visual**

Iniciar con preview_start ("voleibol-dev") y tomar capturas. Comprobar:
- La cancha, la red y las antenas se ven.
- Hay 12 cápsulas en cancha y la banca está fuera.
- La pelota viaja entre jugadores.
- El marcador avanza y aparecen mensajes ("¡Ace!", "¡Qué tapa!", etc.).
- No hay errores en la consola.
- Con F se acelera, y el partido llega a "gana el partido".

- [ ] **Step 7: Commit**

```bash
git add src/render/scene.ts src/ui/hud.ts src/main.ts .claude/launch.json
git commit -m "feat(render): vista 3D con primitivas y marcador"
```

---

## Criterio de fase completa

- `npx vitest run`: todos los tests PASS, incluido el de balance.
- `npm run sim`: las 4 métricas OK con 400 partidos.
- `npx tsc`: sin errores.
- La vista en el navegador muestra un partido IA contra IA completo, de principio a fin.
