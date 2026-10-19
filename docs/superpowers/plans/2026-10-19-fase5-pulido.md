# Fase 5: plan de implementación de menús, audio y pulido

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans.

**Goal:** Completar la versión 1 (spec §2 y §8, fase 5): menú completo, pausa, pantalla de resultado con estadísticas, tres niveles de dificultad de la IA, sonido procedural y gamepad.

## Decisiones
- **Dificultad:** cambia la distribución de timing de la IA del equipo rival (B):
  - Fácil: 15 / 45 / 40 (perfecto / bueno / malo).
  - Normal: la de `TUNING.timing`; el balance de la fase 1 no cambia.
  - Difícil: 50 / 42 / 8.
  
  Los compañeros del usuario juegan siempre en Normal.
- **Estadísticas:** `src/sim/stats.ts` escucha el bus y cuenta, por equipo, puntos, aces, remates ganadores, tapas y errores. Para el usuario cuenta toques, timing (perfecto, bueno, malo), aces, remates ganadores y tapas.
- **Flujo:** Menú → Partido → Resultado (Revancha o Menú). La pausa se abre con Esc o P (Continuar, Reiniciar o Menú). Reiniciar, Revancha y Menú recargan la página; la configuración se pasa por `sessionStorage` (con `try/catch`; si falla, se vuelve al menú). Así no hay que destruir la escena de Three.js a mano.
- **Audio (WebAudio, sin archivos):** golpe (ruido filtrado y un golpe grave; la potencia depende del tipo de toque), silbato, ambiente del público (ruido filtrado continuo con ganancia según la emoción), ovación, corneta y bombo. El contexto de audio se crea con el clic en "Jugar". La M silencia el sonido.
- **Gamepad:** la cruceta elige las opciones 1–4 (en el saque, la zona), A presiona el timing (si no hay opción elegida, elige la primera) y Start pausa.

## Tareas
1. Dificultad en la simulación y `stats.ts`, con tests.
2. `src/audio/sound.ts` y su conexión a los eventos.
3. Menú rediseñado (tarjetas de equipos, posición, formato, dificultad y "Cómo jugar"), pausa y pantalla de resultado.
4. Gamepad.
5. Verificación en el navegador y commit.
