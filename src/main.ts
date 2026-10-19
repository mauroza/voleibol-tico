import { TEAMS } from './data/teams';
import { MatchView } from './render/scene';
import { Simulation } from './sim/rally';
import { TUNING } from './sim/tuning';
import { DecisionPanel } from './ui/decision';
import { Hud } from './ui/hud';
import { showMenu, type MatchSetup } from './ui/menu';

const ui = document.getElementById('hud')!;
showMenu(ui).then(start);

function start(setup: MatchSetup): void {
  const sim = new Simulation({
    seed: Date.now() % 1_000_000_000,
    setsToWin: setup.setsToWin,
    teamA: TEAMS[setup.team],
    teamB: TEAMS[setup.rival],
    user: { role: setup.role },
  });
  const view = new MatchView(document.getElementById('app')!, sim, ui);
  const hud = new Hud(ui, sim);
  const panel = new DecisionPanel(ui, sim);

  // Solo en desarrollo: permite avanzar y renderizar a mano desde la consola o las pruebas visuales.
  if (import.meta.env.DEV) Object.assign(window, { __game: { sim, view, hud, panel } });

  let speed = 1;
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'f') speed = speed === 1 ? 4 : 1;
    if (e.code === 'Space' && view.replaying) view.skipReplay();
  });
  window.addEventListener('pointerdown', () => view.skipReplay());

  let last = performance.now();
  let acc = 0;
  function frame(now: number): void {
    // La cámara lenta de decisión ignora la aceleración x4.
    const dtReal = Math.min(0.25, (now - last) / 1000);
    last = now;
    // Durante una repetición la simulación espera; la cámara lenta de decisión ignora la aceleración x4.
    if (!view.replaying) {
      acc += dtReal * (sim.timeScale < 1 ? sim.timeScale : speed);
      while (acc >= TUNING.dt) {
        sim.step(TUNING.dt);
        acc -= TUNING.dt;
      }
    }
    view.render(dtReal);
    hud.update();
    panel.update();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
