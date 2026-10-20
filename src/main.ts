import './style.css';
import { Sound } from './audio/sound';
import { TEAMS } from './data/teams';
import { MatchView } from './render/scene';
import { Simulation } from './sim/rally';
import { attachStats } from './sim/stats';
import { TUNING } from './sim/tuning';
import { AimInput } from './ui/aim';
import { DecisionPanel } from './ui/decision';
import { GamepadInput } from './ui/gamepad';
import { Hud } from './ui/hud';
import { PACE_SPEED, PACE_TEMPO, saveSetup, showMenu, type MatchSetup } from './ui/menu';
import { PauseMenu, showResult } from './ui/overlays';
import { TimeoutPanel } from './ui/timeout';

const ui = document.getElementById('hud')!;
showMenu(ui).then(start);

function start(setup: MatchSetup): void {
  const sim = new Simulation({
    seed: Date.now() % 1_000_000_000,
    setsToWin: setup.setsToWin,
    teamA: TEAMS[setup.team],
    teamB: TEAMS[setup.rival],
    control: 'A',
    difficulty: setup.difficulty,
    tempo: PACE_TEMPO[setup.pace] ?? 'fluido',
  });
  const stats = attachStats(sim.bus, sim.control);
  const view = new MatchView(document.getElementById('app')!, sim, ui);
  const hud = new Hud(ui, sim);
  // Reloj entre cuadros: la tecla se juzga en el instante real en que se tocó, no en el del último cuadro.
  let frameStamp = performance.now();
  let frameRate = 0;
  const clock = (stamp: number) => sim.time + Math.max(0, (stamp - frameStamp) / 1000) * frameRate;
  const panel = new DecisionPanel(ui, sim, clock);
  const sound = createSound(sim);

  // Reiniciar, revancha y menú recargan la página: así no hay que desmontar la escena a mano.
  const restart = () => {
    saveSetup(setup, true);
    location.reload();
  };
  const toMenu = () => {
    saveSetup(setup, false);
    location.reload();
  };
  const pause = new PauseMenu(ui, { resume: () => setPaused(false), restart, menu: toMenu });
  const setPaused = (p: boolean) => {
    if (sim.phase === 'matchOver') return;
    pause.set(p);
    panel.paused = p;
  };
  // Tiempo y cambios: pausa el juego mientras el panel está abierto.
  const timeouts = new TimeoutPanel(ui, sim, 'A', (open) => { panel.paused = open || pause.open; });
  const gamepad = new GamepadInput(sim, () => setPaused(!pause.open), clock);
  const aim = new AimInput(sim, view, view.canvas, clock, () => pause.open || timeouts.open);

  sim.bus.on((e) => {
    if (e.type !== 'matchEnd') return;
    // Deja ver la celebración antes del resultado.
    setTimeout(() => showResult(ui, sim.teams, e.winner, sim.match.sets, stats, true, { rematch: restart, menu: toMenu }), 2200);
  });

  // Solo en desarrollo: permite avanzar y renderizar a mano desde la consola o las pruebas visuales.
  if (import.meta.env.DEV) Object.assign(window, { __game: { sim, view, hud, panel, stats } });

  let speed = 1;
  window.addEventListener('keydown', (e) => {
    sound?.unlock();
    const k = e.key.toLowerCase();
    if (k === 'escape' || k === 'p') setPaused(!pause.open);
    if (k === 'm') sound?.toggleMute();
    if (k === 'f') speed = speed === 1 ? 4 : 1;
    if (e.code === 'Space' && view.replaying) view.skipReplay();
  });
  window.addEventListener('pointerdown', () => {
    sound?.unlock();
    view.skipReplay();
  });

  const pace = PACE_SPEED[setup.pace];
  let last = performance.now();
  function frame(now: number): void {
    const dtReal = Math.min(0.1, (now - last) / 1000);
    last = now;
    gamepad.update();
    aim.update(dtReal);
    // Paso variable: la simulación avanza exactamente lo que duró el cuadro (fluido a 60, 144 o 165 Hz).
    // En pausa o repetición espera; la cámara lenta de decisión ignora la aceleración x4.
    const stopped = pause.open || timeouts.open;
    if (!view.replaying && !stopped) {
      frameRate = pace * (sim.timeScale < 1 ? sim.timeScale : speed);
      let remaining = dtReal * frameRate;
      while (remaining > 1e-6) {
        const h = Math.min(remaining, TUNING.dt);
        sim.step(h);
        remaining -= h;
      }
    }
    frameStamp = now;
    if (view.replaying || stopped) frameRate = 0;
    view.render(stopped ? 0 : dtReal);
    timeouts.update();
    hud.update();
    panel.update();
    sound?.update(dtReal);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/** Sin WebAudio el juego sigue funcionando en silencio. */
function createSound(sim: Simulation): Sound | null {
  try {
    return new Sound(sim);
  } catch {
    return null;
  }
}
