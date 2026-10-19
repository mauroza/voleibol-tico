import { Sound } from './audio/sound';
import { TEAMS } from './data/teams';
import { MatchView } from './render/scene';
import { Simulation } from './sim/rally';
import { attachStats } from './sim/stats';
import { TUNING } from './sim/tuning';
import { DecisionPanel } from './ui/decision';
import { GamepadInput } from './ui/gamepad';
import { Hud } from './ui/hud';
import { saveSetup, showMenu, type MatchSetup } from './ui/menu';
import { PauseMenu, showResult } from './ui/overlays';

const ui = document.getElementById('hud')!;
showMenu(ui).then(start);

function start(setup: MatchSetup): void {
  const sim = new Simulation({
    seed: Date.now() % 1_000_000_000,
    setsToWin: setup.setsToWin,
    teamA: TEAMS[setup.team],
    teamB: TEAMS[setup.rival],
    user: { role: setup.role },
    difficulty: setup.difficulty,
  });
  const stats = attachStats(sim.bus, sim.userKey);
  const view = new MatchView(document.getElementById('app')!, sim, ui);
  const hud = new Hud(ui, sim);
  const panel = new DecisionPanel(ui, sim);
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
  const gamepad = new GamepadInput(sim, () => setPaused(!pause.open));

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

  let last = performance.now();
  let acc = 0;
  function frame(now: number): void {
    const dtReal = Math.min(0.25, (now - last) / 1000);
    last = now;
    gamepad.update();
    // En pausa o repetición la simulación espera; la cámara lenta de decisión ignora la aceleración x4.
    if (!view.replaying && !pause.open) {
      acc += dtReal * (sim.timeScale < 1 ? sim.timeScale : speed);
      while (acc >= TUNING.dt) {
        sim.step(TUNING.dt);
        acc -= TUNING.dt;
      }
    }
    view.render(pause.open ? 0 : dtReal);
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
