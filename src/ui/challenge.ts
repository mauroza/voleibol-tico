import type { TeamId } from '../sim/court';
import type { Simulation } from '../sim/rally';
import { TUNING } from '../sim/tuning';
import { IS_TOUCH } from './touch';

/**
 * Challenge y roces: tras una jugada cerrada (pelota a centímetros de la línea o roce leve del bloqueo) aparece
 * "C · Challenge" para el equipo perjudicado. La revisión dice dónde picó (y por cuántos cm) o si hubo toque.
 */
export class ChallengePanel {
  private readonly button = document.createElement('button');
  private readonly bar = document.createElement('div');
  private readonly verdict = document.createElement('div');
  private verdictUntil = 0;

  constructor(root: HTMLElement, private readonly sim: Simulation, private readonly team: TeamId) {
    this.button.className = 'challenge-button';
    this.button.tabIndex = -1;
    this.bar.className = 'challenge-bar';
    this.button.append(document.createElement('span'), this.bar);
    this.button.addEventListener('click', (e) => {
      e.stopPropagation();
      this.request();
    });
    this.verdict.className = 'challenge-verdict';
    root.append(this.button, this.verdict);
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'c' && !e.repeat) this.request();
    });
    sim.bus.on((e) => {
      const name = (t: TeamId) => sim.teams[t].name;
      if (e.type === 'challenge') {
        const who = e.team === team ? 'Tu challenge' : `Challenge de ${name(e.team)}`;
        const cm = Math.max(1, Math.round(e.margin * 100));
        const detail = e.kind === 'touch' ? '¡Hubo roce del bloqueo!' : e.inside ? `Dentro por ${cm} cm` : `Fuera por ${cm} cm`;
        this.show(`${who}: ${detail}`, e.overturned ? '✔ Se cambia la decisión' : '✘ Se mantiene lo que cantó el árbitro');
      } else if (e.type === 'point' && e.reason === 'blockOut' && performance.now() > this.verdictUntil) {
        // Detección de roces: si la pelota tocó el bloqueo antes de salir, se avisa.
        this.show('Roce del bloqueo', `Punto para ${name(e.winner)}`);
      }
    });
  }

  private show(title: string, sub: string): void {
    this.verdict.replaceChildren(Object.assign(document.createElement('strong'), { textContent: title }), Object.assign(document.createElement('span'), { textContent: sub }));
    this.verdictUntil = performance.now() + 2600;
  }

  private request(): void {
    if (this.sim.canChallenge(this.team)) this.sim.challenge(this.team);
  }

  update(): void {
    const call = this.sim.callPending;
    const can = !!call && this.sim.canChallenge(this.team);
    this.button.style.display = can ? '' : 'none';
    if (can && call) {
      const kind = call.kind === 'touch' ? '¿Roce del bloqueo?' : '¿Dentro o fuera?';
      (this.button.firstChild as HTMLElement).textContent = `${IS_TOUCH ? '' : 'C · '}Challenge — ${kind} (quedan ${this.sim.challengesLeft[this.team]})`;
      this.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, (call.until - this.sim.time) / TUNING.calls.window))})`;
    }
    this.verdict.style.opacity = performance.now() < this.verdictUntil ? '1' : '0';
  }
}
