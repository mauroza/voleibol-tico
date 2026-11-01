import './style.css';
import './menu.css';
import './hud.css';
import './lineup.css';
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
import { PACE_SPEED, PACE_TEMPO, overallFor, paceOf, saveSetup, showMenu, teamFor, type MatchSetup } from './ui/menu';
import { ROUND_NAMES, recordResult } from './data/tournament';
import { isKey, loadProfile, settings, typingIn, updateProfile } from './data/profile';
import { clubTeam } from './data/club';
import { audio } from './audio/music';
import { Chat } from './ui/chat';
import { StrategyPanel } from './ui/strategy';
import { withDirectLink } from './net/p2p';
import { recordMatch, startClubSync } from './net/leaderboard';
import { icon } from './ui/crest';
import { PauseMenu, showResult } from './ui/overlays';
import { TimeoutPanel } from './ui/timeout';
import { ChallengePanel } from './ui/challenge';
import { IS_TOUCH, TouchControls } from './ui/touch';
import { PregamePanel } from './ui/pregame';
import { LineupEditor } from './ui/lineup';
import { Lockstep, leadForDelay } from './net/lockstep';
import { hostRoom, joinRoom, type OnlineMatch } from './net/room';
import { showLobby } from './ui/lobby';
import { labView } from './ui/lab';
import { loadPlayerModel } from './render/model';

const ui = document.getElementById('hud')!;
startClubSync();
// El modelo de los jugadores baja mientras se elige el partido; si no llega, se juega con los bloques.
const model = loadPlayerModel();
// Editor de personajes: solo para quien diseña el juego (`?editor` o `#editor`); no aparece en el menú.
const editor = new URLSearchParams(location.search).has('editor') || location.hash === '#editor';
if (editor) void model.then(openEditor);
else showMenu(ui).then(async (setup) => {
  await model;
  if (!setup.online) return start(setup);
  // Online: sala con código. El anfitrión elige los equipos; el invitado juega con el rival.
  const lobby = showLobby(ui);
  // Cada uno juega con su club y su apodo.
  const profile = loadProfile();
  const me = { club: clubTeam(profile), nick: profile.nickname || 'Invitado' };
  try {
    const match = setup.online.mode === 'host'
      ? await hostRoom({ team: setup.team, rival: setup.rival, setsToWin: setup.setsToWin, tempo: 'fluido' }, me, (text, code) => lobby.show(text, code))
      : await joinRoom(setup.online.code, me, (text) => lobby.show(text, setup.online?.mode === 'join' ? setup.online.code : ''));
    lobby.close();
    start(setup, match);
  } catch (err) {
    lobby.fail(err instanceof Error ? err.message : 'No se pudo conectar');
  }
});

/** Editor de personajes a pantalla completa. "Probar en un partido" arranca un amistoso con el borrador. */
function openEditor(): void {
  const shell = document.createElement('div');
  shell.className = 'app-menu';
  const home = () => {
    location.href = location.pathname;
  };
  shell.append(labView(home, () => {
    saveSetup({ team: -1, rival: 0, setsToWin: 1, difficulty: 'normal', mode: 'friendly' }, true);
    home();
  }));
  ui.append(shell);
}

function start(setup: MatchSetup, online?: OnlineMatch): void {
  const deal = online?.deal;
  const sim = new Simulation({
    seed: deal ? deal.seed : Date.now() % 1_000_000_000,
    setsToWin: deal ? deal.setsToWin : setup.setsToWin,
    teamA: deal ? deal.clubA ?? TEAMS[deal.teamA] : teamFor(setup.team),
    teamB: deal ? deal.clubB ?? TEAMS[deal.teamB] : teamFor(setup.rival),
    control: online ? online.local : 'A',
    difficulty: setup.difficulty,
    // Online: los dos juegan con el mismo reloj, casi sin cámara lenta, y las barras se adelantan lo que tarda la red.
    tempo: online ? online.deal.tempo ?? 'fluido' : PACE_TEMPO[paceOf(setup.difficulty)],
    // Previa: entrada, 1:30 de remate por zona 4, 1:30 por zona 2, 1:00 de saque, saludo, sorteo y alineación.
    warmup: 90,
    pregame: true,
    ...(online ? { humans: ['A', 'B'] as const, inputLead: leadForDelay(online.deal.delay) } : {}),
  });
  // Online: conexión directa entre los dos (menos ping); si no se puede, por el servidor de la sala.
  const net = online ? withDirectLink(online.net, online.local === 'A') : null;
  const lockstep = online && net ? new Lockstep(sim, net, online.local, online.deal.delay) : null;
  const netStatus = document.createElement('div');
  netStatus.className = 'net-status';
  // Ping arriba: verde fluido, amarillo aceptable, rojo con retraso.
  const pingEl = document.createElement('div');
  pingEl.className = 'net-ping';
  ui.append(netStatus);
  if (online) ui.append(pingEl);
  const gone = document.createElement('div');
  gone.className = 'overlay net-gone';
  gone.innerHTML = '<div class="overlay-box"><h2>Tu rival se desconectó</h2><p>Hace más de 15 segundos que no llega nada de su lado. Si vuelve, el partido sigue solo.</p><div class="overlay-actions"><button class="primary">Volver al menú</button></div></div>';
  const stats = attachStats(sim.bus, sim.control);
  const view = new MatchView(document.getElementById('app')!, sim, ui);
  if (lockstep) view.renderAhead = () => lockstep.pendingTime;
  const hud = new Hud(ui, sim);
  // Reloj entre cuadros: la tecla se juzga en el instante real en que se tocó, no en el del último cuadro.
  let frameStamp = performance.now();
  let frameRate = 0;
  const clock = (stamp: number) => sim.time + Math.max(0, (stamp - frameStamp) / 1000) * frameRate;
  const panel = new DecisionPanel(ui, sim, clock);
  if (lockstep) panel.ahead = () => lockstep.pendingTime;
  const sound = createSound(sim);

  // Reiniciar, revancha y menú recargan la página: así no hay que desmontar la escena a mano.
  const restart = () => {
    saveSetup(setup, true);
    location.reload();
  };
  const toMenu = () => {
    // En el torneo se vuelve a la llave.
    saveSetup({ ...setup, online: undefined, tournament: false }, false, setup.tournament ? 'tournament' : undefined);
    location.reload();
  };
  gone.querySelector('button')!.addEventListener('click', (e) => {
    e.stopPropagation();
    toMenu();
  });
  const toPacks = () => {
    saveSetup({ ...setup, online: undefined }, false, 'packs');
    location.reload();
  };
  // Música suave también en el partido (más baja: mandan el público y los golpes).
  audio.setMatch(true);
  audio.play();
  // Chat del online.
  if (online) {
    const me = online.local;
    const nick = (t: 'A' | 'B') => (t === 'A' ? online.deal.nickA : online.deal.nickB) ?? (t === me ? 'Tú' : 'Rival');
    const other = me === 'A' ? 'B' : 'A';
    new Chat(ui, net!, nick(me), nick(other), sim.teams[me].primary, sim.teams[other].primary);
  }
  const pause = new PauseMenu(ui, { resume: () => setPaused(false), restart: online ? toMenu : restart, menu: toMenu });
  const setPaused = (p: boolean) => {
    // Online la pausa es de los dos: se pide entre puntos (cualquiera) y la levanta cualquiera.
    if (online && sim.phase !== 'matchOver') {
      const me = sim.control ?? 'A';
      if (p) sim.pauseGame(me);
      else sim.resumeGame(me);
      return;
    }
    // Online no hay pausa: el reloj es de los dos.
    if (sim.phase === 'matchOver' || (online && p)) return;
    pause.set(p);
    panel.paused = p;
  };
  // Tiempo y cambios: pausa el juego mientras el panel está abierto.
  const timeouts = new TimeoutPanel(ui, sim, sim.control ?? 'A', (open) => { panel.paused = (open && !online) || pause.open; }, !!online);
  // Estrategia (entre puntos): junto al botón de tiempo, arriba a la derecha.
  const strategy = new StrategyPanel(ui, sim, sim.control ?? 'A', (open) => { panel.paused = (open && !online) || pause.open; });
  const hudActions = document.createElement('div');
  hudActions.className = 'hud-actions';
  hudActions.append(strategy.button, timeouts.button);
  ui.append(hudActions);
  const challenges = new ChallengePanel(ui, sim, sim.control ?? 'A');
  // Previa (cartel, saltar, sorteo) y alineación de cada set.
  const pregame = new PregamePanel(ui, sim, sim.control ?? 'A', !!online);
  const lineup = new LineupEditor(ui, sim, sim.control ?? 'A');
  const gamepad = new GamepadInput(sim, () => setPaused(!pause.open), clock);
  const aim = new AimInput(sim, view, view.canvas, clock, () => pause.open || timeouts.open);
  const touch = IS_TOUCH
    ? new TouchControls(ui, sim, clock, () => pause.open || timeouts.open, {
      pause: () => setPaused(!pause.open),
      mute: () => sound?.toggleMute() ?? false,
      skipReplay: () => view.skipReplay(),
    })
    : null;

  sim.bus.on((e) => {
    if (e.type !== 'matchEnd') return;
    // Premio: cada victoria da un sobre.
    const won = e.winner === (sim.control ?? 'A');
    updateProfile((p) => {
      p.played += 1;
      if (won) {
        p.wins += 1;
        p.packs += 1;
      }
    });
    // Tabla global: cuentan los partidos jugados con tu club (contra la IA u online).
    if (setup.team === -1 || online) void recordMatch(won, !!online);
    let reward = won ? `¡Ganaste un sobre! Tienes ${loadProfile().packs} por abrir.` : '';
    // Torneo: se anota el partido y se resuelven los demás de la ronda. El campeón se lleva 3 sobres más.
    if (setup.tournament) {
      const t = loadProfile().tournament;
      if (t) {
        const round = ROUND_NAMES[t.round];
        const next = recordResult(t, won, overallFor);
        updateProfile((p) => {
          p.tournament = next;
          if (next.champion === next.user) p.packs += 3;
        });
        reward = next.champion === next.user
          ? `¡Campeón del torneo! Te llevas 4 sobres. Tienes ${loadProfile().packs} por abrir.`
          : won ? `Pasaste a ${ROUND_NAMES[next.round].toLowerCase()}. ${reward}` : `Eliminado en ${round.toLowerCase()}.`;
      }
    }
    const rematch = online ? toMenu : setup.tournament ? toMenu : restart;
    // Deja ver la celebración antes del resultado.
    setTimeout(() => showResult(ui, sim.teams, e.winner, sim.match.sets, stats, true, { rematch, menu: toMenu, packs: toPacks, rematchLabel: setup.tournament ? 'Ver la llave' : undefined }, sim.control ?? 'A', reward), 2200);
  });

  // Solo en desarrollo: permite avanzar y renderizar a mano desde la consola o las pruebas visuales.
  if (import.meta.env.DEV) Object.assign(window, { __game: { sim, view, hud, panel, stats } });

  let speed = 1;
  let smoothRate = 1;
  const fastBadge = document.createElement('div');
  fastBadge.className = 'fast-badge';
  fastBadge.innerHTML = `${icon('fast', 16)} x4 (Shift+F para volver)`;
  ui.append(fastBadge);
  window.addEventListener('keydown', (e) => {
    sound?.unlock();
    audio.unlock();
    if (typingIn(e)) return;
    const k = e.key.toLowerCase();
    if (isKey(e, 'pause') || k === 'p') setPaused(!pause.open);
    if (isKey(e, 'mute')) sound?.toggleMute();
    // x4 solo con Shift+F (la F sola está pegada a la D de apuntar y se tocaba sin querer).
    if (k === 'f' && e.shiftKey && !e.repeat && !online) speed = speed === 1 ? 4 : 1;
    if (e.code === 'Space' && view.replaying) view.skipReplay();
  });
  window.addEventListener('pointerdown', () => {
    sound?.unlock();
    audio.unlock();
    view.skipReplay();
  });

  const pace = online ? 1 : PACE_SPEED[paceOf(setup.difficulty)];
  let waitingFor = 0;
  let last = performance.now();
  function frame(now: number): void {
    // Límite de FPS de los ajustes: se saltan cuadros hasta que toca (con 1 ms de margen por el redondeo del reloj).
    const cap = settings().fps;
    if (cap && now - last < 1000 / cap - 1) {
      requestAnimationFrame(frame);
      return;
    }
    const dtReal = Math.min(0.1, (now - last) / 1000);
    last = now;
    gamepad.update();
    aim.update(dtReal);
    // Paso variable: la simulación avanza exactamente lo que duró el cuadro (fluido a 60, 144 o 165 Hz).
    // En pausa o repetición espera; la cámara lenta de decisión ignora la aceleración x4.
    // Online la pausa la decide la simulación (pedida por cualquiera de los dos); el panel de tiempo no detiene el reloj.
    if (online && pause.open !== !!sim.pausedBy) {
      pause.set(!!sim.pausedBy);
      panel.paused = pause.open;
    }
    const stopped = !online && (pause.open || timeouts.open || strategy.open);
    if (lockstep) {
      // Online: pasos fijos sincronizados; si el rival todavía no confirmó, se espera.
      const waiting = !view.replaying && lockstep.advance(dtReal, pace);
      waitingFor = waiting ? waitingFor + dtReal : 0;
      frameRate = pace * sim.timeScale;
      // Avisos discretos (una píldora abajo, no un cartel en medio): solo si algo dura más que un parpadeo.
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const status = lockstep.desync ? 'Las dos partidas se desincronizaron: creen una sala nueva'
        : offline ? 'Sin internet en este dispositivo'
        : lockstep.remoteAway ? 'Tu rival salió de la ventana del juego'
        : lockstep.silence > 3 ? 'Conexión inestable con tu rival…'
        : waitingFor > 0.9 ? 'Sincronizando con tu rival…' : '';
      if (netStatus.dataset.text !== status) {
        netStatus.dataset.text = status;
        netStatus.innerHTML = status ? `<span class="net-spin"></span>${status}` : '';
        netStatus.classList.toggle('on', !!status);
        netStatus.classList.toggle('bad', !!lockstep.desync);
      }
      // Rival desconectado del todo: aviso con salida al menú.
      if (lockstep.silence > 15 && !gone.parentElement) ui.append(gone);
      if (lockstep.silence < 1 && gone.parentElement) gone.remove();
      // Ping con el rival (ida y vuelta) y cómo van los mensajes: directo o por el servidor.
      const ms = lockstep.ping;
      const level = ms === null ? '' : ms < 90 ? 'good' : ms < 170 ? 'ok' : 'bad';
      const link = net!.state === 'direct' ? 'Directo' : net!.state === 'connecting' ? 'Conectando' : 'Servidor';
      const pingText = `<span class="net-dot" data-level="${level}"></span>${link} · ${ms === null ? '…' : `${Math.round(ms)} ms`}`;
      if (pingEl.dataset.text !== pingText) {
        pingEl.dataset.text = pingText;
        pingEl.innerHTML = pingText;
      }
    } else if (!view.replaying && !stopped) {
      // Con una jugada tuya abierta nunca va acelerado (ni el saque ni el remate).
      const target = sim.timeScale < 1 ? sim.timeScale : sim.decision ? 1 : speed;
      // Al salir de la cámara lenta vuelve de a poco (en ~0.5 s): de golpe se sentía como si el juego se acelerara.
      smoothRate = target < smoothRate ? target : smoothRate + (target - smoothRate) * Math.min(1, dtReal * 5);
      frameRate = pace * smoothRate;
      fastBadge.style.display = speed > 1 ? 'block' : 'none';
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
    strategy.update();
    challenges.update();
    touch?.update();
    pregame.update();
    lineup.update();
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
