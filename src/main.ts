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
