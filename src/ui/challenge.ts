import { isKey } from '../data/profile';
import type { TeamId } from '../sim/court';
import type { Simulation } from '../sim/rally';
import { TUNING } from '../sim/tuning';
import { IS_TOUCH } from './touch';
import { esc } from './cards-ui';

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
      if (isKey(e, 'challenge') && !e.repeat) this.request();
    });
    sim.bus.on((e) => {
      const name = (t: TeamId) => sim.teams[t].name;
      if (e.type === 'challenge') {
        // Quién gana de verdad: si se dio vuelta, el que pidió el challenge; si no, el otro.
        const winner = e.overturned ? e.team : e.team === 'A' ? 'B' : 'A';
        const cm = Math.max(1, Math.round(e.margin * 100));
        const title = e.kind === 'touch' ? '¡Hubo roce del bloqueo!' : e.inside ? `DENTRO · por ${cm} cm` : `FUERA · por ${cm} cm`;
        const who = e.team === team ? 'Tenías razón' : `${name(e.team)} tenía razón`;
        const sub = e.overturned
          ? `${who}: se corrige el fallo · punto para ${name(winner)}`
          : `El árbitro acertó · punto para ${name(winner)}${e.team === team ? ' · gastas un challenge' : ''}`;
        this.show(title, sub, winner === team ? 'good' : 'bad');
      } else if (e.type === 'point' && e.reason === 'blockOut' && performance.now() > this.verdictUntil) {
        // Detección de roces: si la pelota tocó el bloqueo antes de salir, se avisa.
        this.show('Roce del bloqueo', `Punto para ${name(e.winner)}`);
      }
    });
  }

  private show(title: string, sub: string, tone: 'good' | 'bad' | '' = ''): void {
    this.verdict.dataset.tone = tone;
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
      // Lo que cantó el árbitro y lo que eso significa (punto para quién); el challenge lo revisa con la marca.
      const called = call.kind === 'touch' ? 'Árbitro: SIN ROCE del bloqueo' : `Árbitro: ${call.calledIn ? 'DENTRO' : 'FUERA'}`;
      const left = Math.max(0, Math.ceil(call.until - this.sim.time));
      const label = this.button.firstChild as HTMLElement;
      label.innerHTML = `<b>${called}</b> → punto ${esc(this.sim.teams[call.calledWinner].name)}<small>¿No estás de acuerdo? ${IS_TOUCH ? 'Toca aquí' : 'C'} · pedir challenge · ${left} s · te quedan ${this.sim.challengesLeft[this.team]}</small>`;
      this.bar.style.transform = `scaleX(${Math.max(0, Math.min(1, (call.until - this.sim.time) / TUNING.calls.window))})`;
    }
    this.verdict.style.opacity = performance.now() < this.verdictUntil ? '1' : '0';
  }
}
