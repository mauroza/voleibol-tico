# Voleibol Tico — Documento de diseño

**Fecha:** 2026-10-19
**Estado:** aprobado en conversación, pendiente de revisión escrita
**Nombre de trabajo:** *Voleibol Tico* (cambiable)

## 1. Visión

Videojuego de voleibol de sala 6v6 en 3D, estilo anime, que corre en el navegador. Los equipos son ficticios e inspirados en las 7 provincias de Costa Rica.

El usuario controla **a un solo jugador** en la posición que elija: colocador, punta, central, opuesto o líbero. No mueve al personaje manualmente: elige **acciones contextuales** con botones y presiona un **medidor de timing**. El juego ejecuta automáticamente los desplazamientos, los saltos, los gestos técnicos y las animaciones.

La jugabilidad se basa en las decisiones, la sincronización y la comprensión táctica, no en reflejos de movimiento.

## 2. Alcance de la versión 1

**Incluye:**
- Modo **Partido rápido**: elegir equipo, rival, posición propia y formato (1 set rápido o al mejor de 3 sets).
- Reglas reales: 3 toques, rotación, sets a 25 con diferencia de 2 y tie-break a 15.
- 7 equipos de provincia con identidad visual propia.
- Personajes anime procedurales con animación procedural (IK).
- Gimnasio con público y efectos anime.
- Menús, pausa, pantalla de resultado y 3 niveles de dificultad de la IA.
- Sonido generado por código (WebAudio).
- Controles por teclado, mouse y gamepad.

**Fuera de la versión 1:** torneo o liga, modo carrera, vóley de playa, multijugador, controles táctiles, sustituciones manuales, tiempos muertos manuales.

## 3. Gameplay

### 3.1 Flujo del partido
- Los 11 jugadores no controlados (5 compañeros y 6 rivales) los maneja la IA.
- Rotación real. El líbero entra y sale automáticamente por los zagueros centrales.
- Si el usuario elige ser líbero, su jugador solo participa cuando está en zaga. Cuando le tocaría delantera, la cámara lo sigue en la banca hasta que vuelve a entrar.
- Si el usuario elige ser central, el líbero de su equipo **no** lo sustituye en zaga (reemplaza solo al otro central), para que el usuario siempre esté en cancha.

### 3.2 Momento de decisión
1. Cuando la simulación predice que el próximo toque corresponde al jugador del usuario, se activa la **cámara lenta**: escala de tiempo 0.2 durante un máximo de 2 s reales.
2. Aparecen de 2 a 4 **botones contextuales** (teclas 1–4, clic o botones del gamepad).
3. Después de elegir, aparece el **medidor de timing**. El usuario presiona espacio, clic o el botón A cuando el indicador está en la zona correcta:
   - **Perfecto:** ventana central estrecha.
   - **Bueno:** ventana media.
   - **Malo:** fuera de las ventanas, o sin respuesta.
4. Si no elige a tiempo, la IA elige la acción por defecto y el timing cuenta como "malo".

### 3.3 Acciones por posición y situación

| Situación | Acciones disponibles |
|---|---|
| Saque (cualquier posición) | Flotado, en salto, seguro. Después se apunta una zona del 1 al 6 |
| Recepción o defensa | Pase a zona del colocador, pase alto seguro, (líbero) cubrir |
| Colocador | Punta (zona 4), rápida al central, opuesto (zona 2), pipe (zaguero), segunda (ataque directo) |
| Punta u opuesto atacando | Remate cruzado, remate en línea, finta, tip, usar el bloqueo (*tool*) |
| Central | Pedir rápida (en ataque); en bloqueo: leer o comprometerse con un atacante |
| Bloqueo (delanteros) | Saltar a bloquear, no saltar y cubrir |

Las acciones que no tienen sentido en la situación no se muestran. Por ejemplo, no hay rápida si la recepción fue mala.

### 3.4 Resolución de acciones
Cada toque produce una **calidad** de 0 a 1:

```
calidad = base_acción
        × factor_toque_previo   (0.5–1.0 según la calidad del toque anterior)
        × factor_timing         (perfecto 1.0 / bueno 0.85 / malo 0.55)
        × factor_atributo       (atributo relevante del jugador, normalizado)
        × factor_presión        (bloqueo o defensa rival bien posicionados lo reducen)
        + ruido controlado      (±0.08)
```

La calidad determina el resultado concreto: la precisión del destino de la pelota, su velocidad, la probabilidad de error (pelota fuera o a la red) y lo fácil que es para el rival defenderla. Los valores exactos se ajustan con la simulación masiva (sección 7).

### 3.5 Atributos de jugador (0–100)
Saque, recepción, colocación, ataque (potencia), ataque (precisión), bloqueo, salto, velocidad y defensa.

## 4. Equipos (ficticios, nombres provisionales)

| Provincia | Equipo | Colores | Estilo |
|---|---|---|---|
| San José | Leones de San José | Rojo y azul | Equilibrado |
| Alajuela | Manudos de Alajuela | Rojo y negro | Ataque potente |
| Cartago | Volcanes de Cartago | Azul y blanco | Bloqueo alto |
| Heredia | Flores de Heredia | Rojo y amarillo | Defensa y recepción |
| Guanacaste | Toros de Guanacaste | Verde y amarillo | Saque agresivo |
| Puntarenas | Mareas de Puntarenas | Celeste y blanco | Juego rápido |
| Limón | Tortugas de Limón | Verde y negro | Atletismo y salto |

Cada equipo tiene 12 jugadores con nombres ticos ficticios y atributos sesgados según su estilo. Todo está definido en `data/teams.ts`.

## 5. Arquitectura técnica

**Stack:** Vite, TypeScript (en modo strict), Three.js y Vitest. No hay servidor ni motor de física externo.

**Física de la pelota:** trayectorias balísticas analíticas, con gravedad y un término simple de efecto (*topspin* o flotado). La simulación siempre conoce el punto y el instante de la próxima intersección relevante: el plano de la red, la altura de contacto y el piso.

### 5.1 Capas

```
src/
  sim/        lógica pura, sin Three.js ni DOM, determinista con semilla
    match.ts      marcador, sets, rotación, líbero, reglas
    ball.ts       trayectoria, predicción, contacto
    rally.ts      máquina de estados del rally
    players.ts    tipos de jugador, atributos, roles
    actions.ts    acciones disponibles por posición y situación
    resolver.ts   cálculo de calidad y resultado
    ai.ts         decisiones y posicionamiento de la IA
    rng.ts        generador aleatorio con semilla
    events.ts     bus de eventos tipado
  render/     Three.js
    characters.ts modelo anime procedural y esqueleto
    animation.ts  animación procedural e IK
    toon.ts       shader cel-shading y contorno
    court.ts      gimnasio, red, público
    camera.ts     director de cámara
    fx.ts         efectos anime
  ui/         HTML/CSS sobre el canvas
    menus.ts, hud.ts, decision.ts (botones y medidor de timing)
  audio/      WebAudio procedural
  data/       teams.ts
  main.ts
```

### 5.2 Máquina de estados del rally
`SAQUE → RECEPCIÓN → COLOCACIÓN → ATAQUE → (BLOQUEO) → DEFENSA → COLOCACIÓN → …` hasta llegar a `PUNTO`. También existen transiciones por error: pelota fuera, toca la red, cuatro toques o pelota al piso.

### 5.3 Flujo de datos
- La simulación avanza con **paso fijo** (120 Hz) multiplicado por `timeScale`, que es el valor que usa la cámara lenta.
- La simulación emite eventos tipados: `contact`, `decisionRequired`, `point`, `setEnd`, `rotation`, etc.
- La capa de render y la UI solo leen el estado y escuchan eventos. Nunca modifican la simulación directamente. La UI envía las decisiones del usuario mediante `sim.submitDecision(action, timing)`.

## 6. Arte y animación (todo en código)

- **Personajes:** geometría procedural con proporciones anime: piernas largas, cabeza levemente grande, pelo en mechones, ojos grandes en una textura dibujada con canvas y uniforme con los colores del equipo y su número.
- **Shader:** iluminación por bandas (cel-shading de 2 a 3 tonos) más contorno por *inverted hull*.
- **Animación:** esqueleto propio con IK de dos huesos para brazos y piernas. Las poses clave son procedurales: correr, desplazamiento lateral, salto, remate, recepción, colocación, bloqueo, saque, celebración y lamento. El contacto se adapta a la posición real de la pelota.
- **Efectos:** líneas de velocidad, destello de impacto, estela de la pelota, marco anime en remates perfectos y vibración de cámara.
- **Cámara:** vista de transmisión lateral elevada por defecto. Durante el momento de decisión hace un acercamiento dramático, y después de los puntos importantes muestra una repetición corta.

**Expectativa:** estilo anime low-poly cel-shaded, coherente y expresivo. No busca el detalle de modelos hechos a mano.

## 7. Verificación

- **Tests unitarios (Vitest):** reglas y marcador, rotación y líbero, trayectorias y predicción de caída, acciones disponibles por situación y resolver.
- **Simulación masiva sin gráficos:** un script corre N partidos IA contra IA con semilla fija y reporta métricas. Estos son los objetivos de balance:
  - Toques por rally: promedio entre 3 y 8.
  - Eficacia de ataque: entre 35 y 55 %.
  - Errores de saque: entre 8 y 15 %.
  - Equipos de atributos iguales: cada uno gana entre 45 y 55 % de los partidos.
  - Ningún partido se queda trabado ni rompe las reglas.
- **Verificación visual:** capturas en el navegador integrado al final de cada fase.

## 8. Fases

1. **Simulación base:** reglas, pelota, rally, IA básica y vista 3D con primitivas. *Listo cuando* un partido IA contra IA se completa con reglas correctas y las métricas de la sección 7 están en rango.
2. **Gameplay del jugador:** selección de posición, cámara lenta, botones, medidor de timing y resolver completo. *Listo cuando* un partido completo es jugable y justo.
3. **Personajes anime:** modelos, shader, IK y animaciones. *Listo cuando* los 12 jugadores se ven y se mueven de forma creíble.
4. **Identidad tica y espectáculo:** equipos, gimnasio, público, efectos y cámara dramática.
5. **Menús, audio y pulido:** flujo completo de menús, pausa, resultado, dificultad y sonido. *Listo cuando* la versión 1 se puede compartir por link.

## 9. Riesgos

- **Animación procedural robótica.** Mitigación: dedicar la fase 3 completa a la animación, usar curvas de *easing*, anticipación y *overshoot*, y revisar con el usuario mediante capturas.
- **Balance injusto o aburrido.** Mitigación: ajustar con la simulación masiva y con las pruebas del usuario en la fase 2.
- **Rendimiento en el navegador con 12 personajes y público.** Mitigación: usar instancing para el público, limitar las sombras y aplicar el contorno solo a los jugadores.
