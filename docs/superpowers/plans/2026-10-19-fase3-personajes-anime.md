# Fase 3: plan de implementación de los personajes anime

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Reemplazar las cápsulas por personajes anime procedurales con cel-shading, contorno y animación procedural guiada por la simulación (spec §6).

**Architecture:** Todo vive en `src/render/`. La simulación solo agrega un getter de lectura, `upcoming`, para que el render pueda anticipar el próximo contacto (por ejemplo, saltar antes del remate).

**Rig rígido por segmentos:** cada articulación es un `Object3D` con su malla. No hay skinning. El contorno usa *inverted hull*: una copia de la geometría con `BackSide` y los vértices desplazados a lo largo de la normal.

**Animación procedural:**
- Poses clave en ángulos de Euler, mezcladas entre sí.
- Ciclo de carrera según la velocidad del jugador.
- Salto parabólico con el ápice en el instante del contacto.
- IK de dos huesos para llevar las manos a la pelota.
- Pies al piso, con la altura de la cadera calculada según el ángulo de las piernas.
- El tiempo de animación es el tiempo de simulación, así que la cámara lenta también ralentiza la animación.

## Convenciones del rig
- El personaje mira hacia +z. Su izquierda es +x.
- En reposo, brazos y piernas cuelgan hacia −y.
- Rotar el hombro o la cadera en x con un ángulo negativo lleva el segmento hacia adelante; −π lo deja apuntando hacia arriba.
- La rodilla se flexiona con x positivo (la tibia va hacia atrás). El codo se flexiona con x negativo.
- Una rotación positiva de la columna en x inclina el torso hacia adelante.

## Archivos
| Archivo | Responsabilidad |
|---|---|
| `src/sim/rally.ts` | `get upcoming(): PlannedContact \| null` (solo lectura) |
| `src/render/toon.ts` | Material toon de 3 tonos, material de contorno y `toonMesh` |
| `src/render/character.ts` | `buildCharacter(look)`, que devuelve un `Rig` (articulaciones y dimensiones), y `lookFor(key, team, libero)` |
| `src/render/pose.ts` | Matemática pura: poses, `blendPose`, `runPose`, `twoBoneIK`, `jumpOffset`, `hipHeight` |
| `src/render/animator.ts` | Estado por jugador: lee la simulación y los eventos, y aplica la pose, el salto, la IK y la orientación |
| `src/render/scene.ts` | Usa los personajes en lugar de las cápsulas |
| `tests/render/pose.test.ts` | Tests de la matemática de pose, IK y salto |

## Tareas
1. Getter `upcoming` en la simulación, con test.
2. `pose.ts`, con tests: la IK alcanza el objetivo, el salto llega a su ápice en el contacto, la mezcla de poses interpola bien y la altura de la cadera es correcta.
3. `toon.ts` y `character.ts`.
4. `animator.ts` e integración en `scene.ts`.
5. Verificación visual con capturas (viewport de 640×480 por el escalado de pantalla) y ajuste de poses. Commit por tarea.
