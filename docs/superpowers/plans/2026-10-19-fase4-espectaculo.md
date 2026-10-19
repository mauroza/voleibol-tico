# Fase 4: plan de implementación de la identidad tica y el espectáculo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Lograr que un partido se sienta como un partido anime tico: un gimnasio con público que reacciona, efectos anime, cámara dramática, repeticiones y un narrador con expresiones ticas (spec §6, §8 fase 4).

**Architecture:** Todo se implementa en las capas de render y UI; la simulación no cambia. La lógica pura (buffer de repetición, política de repeticiones, frases y encuadres de cámara) tiene tests. Lo visual se verifica con capturas.

## Componentes

| Archivo | Responsabilidad |
|---|---|
| `src/render/arena.ts` | Gimnasio: zona libre azul, paredes, gradas a ambos lados, público con `InstancedMesh` en los colores de cada equipo, banderas de Costa Rica, mantas con los nombres de los equipos y luces. `react(excitement)` hace saltar al público |
| `src/render/fx.ts` | Estela de la pelota, destello de impacto escalado por calidad, sacudida de cámara en remates y puntos |
| `src/ui/speedlines.ts` | Líneas de velocidad anime en canvas superpuesto durante la cámara lenta y los remates fuertes |
| `src/render/camera.ts` | `CameraDirector` con tres modos: transmisión (sigue la pelota en x, suave), decisión (se acerca al jugador del usuario durante la cámara lenta) y repetición (órbita lenta alrededor de la jugada) |
| `src/render/replay.ts` | `ReplayBuffer` (ring buffer de los últimos 4 s del estado visual: raíz, cuerpo, cadera, articulaciones y pelota) y `shouldReplay` |
| `src/ui/narrator.ts` | Frases ticas por tipo de punto, rotando sin repetir seguidas |
| `src/main.ts` | Durante una repetición la simulación se pausa; espacio o clic la saltan |

## Política de repeticiones

Hay repetición en estos casos:
- Ace.
- Tapa (`blockKill`).
- Remate ganador con calidad de ataque ≥ 0.75.
- Cualquier punto ganado por el usuario con timing perfecto en el último toque.

Además, debe haber al menos 3 puntos entre una repetición y la siguiente. La repetición dura 2.5 s a velocidad ×0.5, más o menos los últimos 1.25 s de juego.

## Tareas
1. Tests y código de `replay.ts`, `narrator.ts` y la lógica pura de `camera.ts`.
2. `arena.ts` con el público.
3. `fx.ts` y `speedlines.ts`.
4. `CameraDirector`, grabación y reproducción en `scene.ts` y `main.ts`.
5. Narrador en el HUD, verificación visual y commit por tarea.
