import { typingIn } from '../data/profile';
import { sideSign, type TeamId } from '../sim/court';
import { WARM_STAGE_LABELS, type Simulation } from '../sim/rally';
import { IS_TOUCH } from './touch';

const STEP_LABELS: Record<string, string> = {
  entrance: 'Entrada de los equipos',
  greeting: 'Saludo en la red',
  sides: 'Cambio de cancha',
  toss: 'Sorteo',
  lineup: 'Alineación',
};

/**
 * Previa del partido: cartel con la etapa (entrada, calentamientos, saludo, cambio de cancha) y botones para saltarla,
 * y el sorteo con la moneda: el que gana saca y el que pierde elige lado.
 */
export class PregamePanel {
  private readonly banner = document.createElement('div');
  private readonly text = document.createElement('span');
  private readonly skipOne = document.createElement('button');
  private readonly skipAll = document.createElement('button');
  private readonly toss = document.createElement('div');
  private readonly coin = document.createElement('div');
  private readonly tossText = document.createElement('p');
  private readonly sideButtons = document.createElement('div');
  private shown = '';
  private tossUntil = 0;

  constructor(root: HTMLElement, private readonly sim: Simulation, private readonly team: TeamId, online: boolean) {
    this.banner.className = 'pregame-banner';
    this.skipOne.textContent = IS_TOUCH ? 'Saltar ›' : 'Saltar › (Enter)';
    this.skipAll.textContent = 'Ir al sorteo »';
    for (const b of [this.skipOne, this.skipAll]) {
      b.tabIndex = -1;
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    this.skipOne.addEventListener('click', (e) => { e.stopPropagation(); sim.skip(team, false); });
    this.skipAll.addEventListener('click', (e) => { e.stopPropagation(); sim.skip(team, true); });
    const actions = document.createElement('div');
    actions.className = 'pregame-actions';
    actions.append(this.skipOne, this.skipAll);
    this.banner.append(this.text, actions);

    this.toss.className = 'overlay toss';
    const box = document.createElement('div');
    box.className = 'overlay-box toss-box';
    const title = document.createElement('h2');
    title.textContent = 'Sorteo';
    this.coin.className = 'toss-coin';
    this.sideButtons.className = 'overlay-actions toss-sides';
    const side = (label: string, left: boolean) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = 'primary';
      b.addEventListener('click', (e) => { e.stopPropagation(); sim.chooseSide(team, left); });
      return b;
    };
    this.sideButtons.append(side('◀ Lado izquierdo', true), side('Lado derecho ▶', false));
    box.append(title, this.coin, this.tossText, this.sideButtons);
    this.toss.append(box);
    this.toss.style.display = 'none';
    root.append(this.banner, this.toss);

    window.addEventListener('keydown', (e) => {
      // Online ENTER es del chat: ahí se salta con el botón.
      if (e.key === 'Enter' && !online && !typingIn(e) && sim.skipKey(team)) sim.skip(team, false);
    });
    sim.bus.on((e) => {
      const name = (t: TeamId) => sim.teams[t].name;
      if (e.type === 'toss') {
        this.coin.dataset.result = e.winner === team ? 'win' : 'lose';
        this.coin.classList.remove('spin');
        void this.coin.offsetWidth;
        this.coin.classList.add('spin');
        this.coin.textContent = '';
        this.tossUntil = Infinity;
      }
      if (e.type === 'sides' && e.chosenBy) {
        const where = sideSign(e.chosenBy) < 0 ? 'la izquierda' : 'la derecha';
        this.tossText.textContent = `${name(e.chosenBy)} eligió jugar a ${where}. Saca ${name(otherOf(e.chosenBy))}.`;
        this.tossUntil = performance.now() + 2200;
      }
    });
    void online;
  }

  update(): void {
    const sim = this.sim;
    const cer = sim.ceremony;
    const stage = sim.warmStage;
    // Cartel de la etapa.
    let text = '';
    if (stage) {
      const t = Math.ceil(sim.warmupLeft ?? 0);
      const clock = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      const yours = stage === 'serve' ? 'cuando le toque a tu sacador, apunta y saca' : 'cuando le toque a tu rematador, apunta y remata';
      text = `Calentamiento · ${WARM_STAGE_LABELS[stage]} · ${clock} · ${yours}`;
    } else if (cer && cer.step !== 'toss' && cer.step !== 'lineup') text = STEP_LABELS[cer.step];
    const canSkip = sim.skipKey(this.team) !== null;
    const voted = sim.skipVoted(this.team);
    if (voted) text += ' · esperando a tu rival para saltar…';
    if (text !== this.shown) {
      this.text.textContent = text;
      this.shown = text;
    }
    this.banner.style.display = text ? 'flex' : 'none';
    this.skipOne.style.display = canSkip ? '' : 'none';
    this.skipAll.style.display = canSkip && cer?.step !== 'sides' ? '' : 'none';

    // Sorteo: moneda, resultado y, si perdiste, elegir lado.
    const tossing = cer?.step === 'toss';
    const show = (tossing && cer.sub === 0) || performance.now() < this.tossUntil;
    if (!tossing && this.tossUntil === Infinity) this.tossUntil = 0;
    this.toss.style.display = show ? 'grid' : 'none';
    if (tossing && cer.sub === 0 && cer.tossWinner && cer.sideBy) {
      const revealed = sim.time >= cer.revealAt;
      const name = (t: TeamId) => sim.teams[t].name;
      if (revealed) this.coin.textContent = cer.tossWinner === this.team ? '¡Ganaste!' : 'Perdiste';
      const mine = cer.sideBy === this.team;
      this.tossText.textContent = !revealed ? 'Lanzando la moneda…'
        : cer.tossWinner === this.team ? `Ganaste el sorteo: sacas primero. ${name(cer.sideBy)} elige lado…`
        : mine ? `Ganó ${name(cer.tossWinner)}: saca primero. Elige de qué lado juegas (visto desde la tribuna).`
        : `Ganó ${name(cer.tossWinner)}. ${name(cer.sideBy)} elige lado…`;
      this.sideButtons.style.display = revealed && sim.sideKey(this.team) ? 'grid' : 'none';
    } else this.sideButtons.style.display = 'none';
  }
}

const otherOf = (t: TeamId): TeamId => (t === 'A' ? 'B' : 'A');
