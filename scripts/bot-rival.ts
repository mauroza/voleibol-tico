/**
 * Rival online sin pantalla: se une a una sala por código y juega con el equipo B usando la misma simulación.
 * Uso: npx tsx scripts/bot-rival.ts CODIGO   (lee la clave pública de Supabase de .env.local)
 */
import { readFileSync } from 'node:fs';
import { TEAMS } from '../src/data/teams';
import { Lockstep, leadForDelay } from '../src/net/lockstep';
import type { MatchDeal } from '../src/net/room';
import { supabaseTransport } from '../src/net/transport';
import { Simulation } from '../src/sim/rally';
import { TUNING } from '../src/sim/tuning';

const code = (process.argv[2] ?? '').trim().toUpperCase();
if (!code) throw new Error('Falta el código de la sala');
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const log = (...a: unknown[]) => console.log(new Date().toLocaleTimeString(), ...a);

const net = await supabaseTransport(code, env.VITE_SUPABASE_URL, env.VITE_SUPABASE_KEY);
log(`Conectado a la sala ${code}, esperando al anfitrión…`);
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
for (let i = 0; !deal; i++) {
  if (!heard) net.send({ t: 'join' });
  if (i > 0 && i % 40 === 0) log('…nadie responde todavía');
  await new Promise((r) => setTimeout(r, 250));
}
const d0 = deal as MatchDeal;
log(`¡Partido! ${TEAMS[d0.teamA].name} (tú) vs ${TEAMS[d0.teamB].name} (bot) · retraso ${d0.delay} ticks`);

const sim = new Simulation({
  seed: d0.seed,
  setsToWin: d0.setsToWin,
  teamA: TEAMS[d0.teamA],
  teamB: TEAMS[d0.teamB],
  control: 'B',
  humans: ['A', 'B'],
  tempo: 'online',
  inputLead: leadForDelay(d0.delay),
});
const ls = new Lockstep(sim, net, 'B', d0.delay);
sim.bus.on((e) => {
  if (e.type === 'point') log(`Punto ${e.winner === 'A' ? 'tuyo' : 'del bot'} (${e.reason}) · ${e.points.A}–${e.points.B} · sets ${e.sets.A}–${e.sets.B}`);
  if (e.type === 'matchEnd') log(e.winner === 'A' ? '¡Ganaste!' : 'Ganó el bot');
});

/** Bot "humano": cada decisión elige en qué punto de la barra presionar (con algo de error). */
let target: { d: unknown; meter: number } | null = null;
function play(): void {
  const d = sim.decision;
  if (!d || d.pressedAt !== null) return;
  if (!target || target.d !== d) {
    // Remate: amarillo-rojo; saque: fuerte a veces; colocación: tempo variado; pase y bloqueo: buen timing.
    const meter = d.kind === 'attack' ? 0.6 + Math.random() * 0.38 : d.kind === 'set' ? Math.random() : d.kind === 'serve' ? 0.5 + Math.random() * 0.45 : 0.85 + Math.random() * 0.15;
    target = { d, meter };
    // Apunta un poco distinto cada vez.
    if (d.aim && d.kind !== 'block' && d.kind !== 'set') sim.setAim(d.aim.x + (Math.random() - 0.5) * 1.2, d.aim.z + (Math.random() - 0.5) * 1.6);
  }
  if (d.kind === 'serve') {
    const p = ((sim.time - d.startTime) / TUNING.decision.servePeriod) % 1;
    const m = p < 0.5 ? p * 2 : 2 - p * 2;
    if (sim.time - d.startTime > 1 && Math.abs(m - target.meter) < 0.04) sim.press(sim.time);
    return;
  }
  if (d.contactTime === null) return;
  const window = d.kind === 'set' ? TUNING.decision.setWindow : TUNING.decision.slowWindow;
  const left = d.contactTime - (d.lead ?? 0) - sim.time;
  if (left <= (1 - target.meter) * window) sim.press(sim.time);
}

let last = performance.now();
while (sim.phase !== 'matchOver') {
  await new Promise((r) => setTimeout(r, 16));
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  play();
  ls.advance(dt, 1);
  if (ls.desync) {
    log('⚠ Se desincronizó la partida');
    break;
  }
  if (ls.silence > 30) {
    log('El anfitrión se desconectó');
    break;
  }
}
log(`Final: ${sim.match.points.A}–${sim.match.points.B} · sets ${sim.match.sets.A}–${sim.match.sets.B}`);
await new Promise((r) => setTimeout(r, 1500));
net.close();
process.exit(0);
