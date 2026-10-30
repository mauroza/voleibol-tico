import type { TeamDef } from '../data/teams';
import type { TeamId } from '../sim/court';
import type { TempoProfile } from '../sim/rally';
import { delayForPing } from './lockstep';
import { openTransport, roomCode, type NetMessage, type Transport } from './transport';

/** Lo que las dos computadoras acuerdan antes de empezar: misma semilla, mismos equipos, mismo retraso. */
export interface MatchDeal {
  seed: number;
  teamA: number;
  teamB: number;
  setsToWin: 1 | 2;
  delay: number;
  /** Ritmo que eligió el anfitrión (cámara lenta para pensar y golpear, igual para los dos). */
  tempo?: TempoProfile;
  /** Clubes de cada uno (plantilla completa: las dos computadoras simulan con los mismos jugadores). */
  clubA?: TeamDef;
  clubB?: TeamDef;
  /** Apodos de los DT. */
  nickA?: string;
  nickB?: string;
}

/** Lo que cada uno aporta: su club y su apodo. */
export interface Entrant {
  club: TeamDef;
  nick: string;
}

export interface OnlineMatch {
  code: string;
  net: Transport;
  local: TeamId;
  deal: MatchDeal;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Anfitrión: abre la sala con un código, espera al invitado, mide el ping (5 idas y vueltas) y manda el acuerdo.
 * El anfitrión juega con el equipo A (su equipo) y el invitado con el B (el rival elegido).
 */
export async function hostRoom(
  choice: { team: number; rival: number; setsToWin: 1 | 2; tempo: TempoProfile },
  me: Entrant,
  onStatus: (text: string, code: string) => void,
): Promise<OnlineMatch> {
  const code = roomCode();
  onStatus('Abriendo sala…', code);
  const net = await openTransport(code);
  onStatus('Comparte el código. Esperando al rival…', code);
  const inbox: NetMessage[] = [];
  // Solo se guardan los mensajes de la sala hasta empezar (después los maneja el partido).
  let started = false;
  net.onMessage((m) => {
    if (!started) inbox.push(m);
  });
  const take = async (t: string, timeoutMs = Infinity): Promise<NetMessage | null> => {
    const end = performance.now() + timeoutMs;
    while (performance.now() < end) {
      const i = inbox.findIndex((m) => m.t === t);
      if (i >= 0) return inbox.splice(i, 1)[0];
      await wait(30);
    }
    return null;
  };
  const join = await take('join');
  const guest = join?.entrant as Entrant | undefined;
  onStatus(guest ? `¡${guest.nick} se conectó con ${guest.club.name}! Midiendo la conexión…` : '¡Rival conectado! Midiendo la conexión…', code);
  const rtts: number[] = [];
  for (let n = 0; n < 5; n++) {
    const sent = performance.now();
    net.send({ t: 'ping', n });
    const pong = await take('pong', 2000);
    if (pong) rtts.push(performance.now() - sent);
  }
  rtts.sort((a, b) => a - b);
  const rtt = (rtts[Math.floor(rtts.length / 2)] ?? 200) / 1000;
  const deal: MatchDeal = {
    seed: Math.floor(Math.random() * 1_000_000_000),
    teamA: choice.team,
    teamB: choice.rival,
    setsToWin: choice.setsToWin,
    delay: delayForPing(rtt),
    tempo: choice.tempo,
    clubA: me.club,
    nickA: me.nick,
    clubB: guest?.club,
    nickB: guest?.nick,
  };
  // Reenvía el acuerdo hasta que el invitado confirma.
  for (let tries = 0; tries < 50; tries++) {
    net.send({ t: 'start', deal });
    if (await take('ready', 300)) break;
  }
  started = true;
  inbox.length = 0;
  onStatus(`¡A jugar! Ping ${Math.round(rtt * 1000)} ms`, code);
  return { code, net, local: 'A', deal };
}

/** Invitado: entra a la sala con el código, contesta el ping y recibe el acuerdo. */
export async function joinRoom(code: string, me: Entrant, onStatus: (text: string) => void): Promise<OnlineMatch> {
  const clean = code.trim().toUpperCase();
  onStatus(`Conectando a la sala ${clean}…`);
  const net = await openTransport(clean);
  let deal: MatchDeal | null = null;
  let heard = false;
  net.onMessage((m) => {
    heard = true;
    if (m.t === 'ping') net.send({ t: 'pong', n: m.n });
    if (m.t === 'start') {
      deal = m.deal as MatchDeal;
      net.send({ t: 'ready' });
    }
  });
  for (let tries = 0; !deal; tries++) {
    if (!heard) net.send({ t: 'join', entrant: me });
    if (tries === 40 && !heard) onStatus(`Nadie responde en la sala ${clean}. ¿El código está bien?`);
    await wait(250);
  }
  onStatus('¡A jugar!');
  return { code: clean, net, local: 'B', deal };
}
