# Fase 2: plan de implementación del gameplay del jugador

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** El usuario controla a un jugador en la posición que elija y toma decisiones con botones contextuales, cámara lenta y medidor de timing, según el spec §3.

**Architecture:** La simulación mantiene un objeto `decision` pendiente, que es la API pública. Un toque del jugador del usuario crea una decisión con opciones. La UI llama a `sim.choose(i)` y a `sim.press()`. Cuando llega el contacto, la simulación resuelve con la opción elegida (o la de la IA por defecto) y con el timing medido contra el instante real del contacto. `sim.timeScale` vale 0.2 durante los últimos 0.4 s de simulación antes de un contacto con decisión pendiente. El bucle principal lo aplica; en modo headless se ignora, así que la simulación sigue siendo determinista. La IA nunca usa las opciones nuevas (tool, pase alto, segunda), por lo que el balance de la fase 1 no cambia.

**Tech Stack:** el mismo de la fase 1.

**Spec:** `docs/superpowers/specs/2026-10-19-voleibol-tico-design.md` §3.

## Decisiones de diseño (detalle del spec)

**Timing medido contra la pelota real:**
- Perfecto: presionar dentro de los 0.06 s de simulación antes del contacto.
- Bueno: entre 0.06 y 0.16 s antes del contacto.
- Malo: cualquier otro caso, o si no se presiona.

En cámara lenta, 0.06 s de simulación equivalen a 0.3 s reales. El medidor muestra la pelota acercándose a la zona perfecta.

**Saque:**
- El juego espera al usuario (máximo 10 s; después la IA saca con timing malo).
- Primero se elige el tipo de saque (flotado, salto o seguro) y luego la zona (1–6).
- El medidor oscila con un periodo de 1.6 s. Perfecto si se presiona dentro de ±0.06 del centro de la fase; bueno dentro de ±0.16.

**Opciones por situación:**
- **Recepción o defensa:** pase al colocador, o pase alto seguro (más lento, la mitad de ruido y la mitad de riesgo).
- **Colocación:** las opciones de `availableSetOptions`. Además existe la "segunda" (ataque directo del colocador), disponible si es especialista, está en delantera y el pase tiene calidad ≥ 0.5.
- **Ataque:** cruzado, línea, finta o *tool* (usar el bloqueo). Con *tool*, si hay bloqueadores, la probabilidad de que la pelota salga de las manos y vaya afuera es 0.35 + 0.4·q, y el punto es para el atacante.
- **Tercer toque sin ataque posible:** la única opción es "mandar pelota" (free).
- **Bloqueo (usuario en delantera, el rival coloca):** bloquear o no bloquear. El timing se mide contra el instante del remate rival y multiplica la probabilidad de tapa: perfecto ×1.5, bueno ×1, malo ×0.5. Si elige bloquear, el usuario es el bloqueador principal siempre que llegue.

**Valores por defecto sin respuesta:** la IA decide (pase al colocador, `chooseSet`, `chooseShot`, bloquear), con timing malo.

**Posición del usuario:** el usuario siempre juega en el equipo A.
- S, OH, MB y OP corresponden al primer jugador del lineup con ese rol. L corresponde al líbero.
- Si el usuario es MB, se quita de `liberoReplaces` para que siempre esté en cancha.

**Sin cambios para la IA:** las opciones nuevas solo las usa el usuario.

**Fuera de la fase 2:** gamepad y menús definitivos (fase 5), cámara dramática (fase 4). La pantalla de selección de esta fase es mínima.

## Archivos

| Archivo | Cambio |
|---|---|
| `src/sim/decision.ts` (nuevo) | Tipos `UserOption`, `Decision`, `judgeTiming`, `serveMeter` |
| `src/sim/rally.ts` | Usuario, creación y resolución de decisiones, `timeScale`, *tool*, pase alto, segunda |
| `src/sim/events.ts` | Eventos `decision` y `decisionResolved`; motivo de punto `blockOut` |
| `src/sim/tuning.ts` | Constantes de decisión |
| `src/ui/decision.ts` (nuevo) | Panel de botones y medidor |
| `src/ui/menu.ts` (nuevo) | Selección de equipo, rival, posición y formato |
| `src/ui/hud.ts` | Línea "Tú: …" y retroalimentación del timing |
| `src/render/scene.ts` | Anillo bajo el jugador del usuario |
| `src/main.ts` | Menú → partido, `timeScale` |
| `tests/sim/decision.test.ts`, `tests/sim/user.test.ts` (nuevos) | Tests |

## Tareas

### Task 1: Tipos y juicio de timing (`decision.ts`)
- [ ] Test: `judgeTiming` (perfecto, bueno, malo, sin presionar, presionar después del contacto) y `serveMeter`/`judgeServe` (centro = perfecto).
- [ ] Implementar y correr. Commit.

### Task 2: Usuario y decisiones en la simulación
- [ ] Test (`user.test.ts`):
  1. Con el usuario inactivo como punta, el partido termina, hay decisiones y todas se resuelven como `bad`.
  2. Un colocador recibe decisiones `set` con opciones de colocación; una punta recibe `pass` y `attack`.
  3. Un central nunca sale de cancha.
  4. `timeScale` vale 0.2 cerca del contacto y 1 en otro caso.
  5. Un bot perfecto (opción 0 y presionar justo antes del contacto) gana más puntos que el usuario inactivo (40 partidos con las mismas semillas).
- [ ] Implementar `SimOptions.user`, `decision`, `choose`, `press`, `timeScale`, opciones nuevas y eventos.
- [ ] Toda la suite pasa, incluido el balance de la fase 1. Commit.

### Task 3: UI de decisiones, menú y marcador del usuario
- [ ] `ui/decision.ts`: botones con teclas 1–4 y clic, segundo paso de zona en el saque, medidor con la zona perfecta, presionar con espacio o clic.
- [ ] `ui/menu.ts`: selects de equipo, rival, posición y formato, y botón "Jugar".
- [ ] Anillo bajo el jugador del usuario, línea "Tú: Punta #2" en el HUD y destello "¡Perfecto! / Bien / Tarde".
- [ ] `main.ts` aplica `sim.timeScale`.
- [ ] `tsc` y `vite build` OK. Commit.

### Task 4: Verificación en el navegador
- [ ] Jugar como colocador y como punta: aparecen los botones, la cámara lenta se activa, el timing responde y el partido avanza.
- [ ] Revisar que la consola no tenga errores. Commit de los ajustes.
