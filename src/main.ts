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
  const view = new MatchView(document.getElementById('app')!, sim);
  const hud = new Hud(ui, sim);
  const panel = new DecisionPanel(ui, sim);

  let speed = 1;
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'f') speed = speed === 1 ? 4 : 1;
  });

  let last = performance.now();
  let acc = 0;
  function frame(now: number): void {
    // La cámara lenta de decisión ignora la aceleración x4.
    const scale = sim.timeScale < 1 ? sim.timeScale : speed;
    acc += Math.min(0.25, (now - last) / 1000) * scale;
    last = now;
    while (acc >= TUNING.dt) {
      sim.step(TUNING.dt);
      acc -= TUNING.dt;
    }
    view.render();
    hud.update();
    panel.update();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
