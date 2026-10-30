import type { SupabaseClient } from '@supabase/supabase-js';
import { loadProfile, onProfileChange, type Profile } from '../data/profile';
import { initials } from '../ui/crest';

/**
 * Tabla global de clubes (proyecto de Supabase propio del juego). Cada navegador tiene un id y una clave de su club:
 * con la clave registra su club y anota sus partidos; la tabla la puede leer cualquiera (sin las claves).
 */
const URL = import.meta.env.VITE_LEADERBOARD_URL as string | undefined;
const KEY = import.meta.env.VITE_LEADERBOARD_KEY as string | undefined;

/** En claude.ai la página no puede conectarse a internet: ahí no hay tabla. */
export const LEADERBOARD_AVAILABLE = import.meta.env.MODE !== 'artifact' && !!URL && !!KEY;

export interface ClubRow {
  id: string;
  nickname: string;
  name: string;
  short: string;
  primary_color: string;
  secondary_color: string;
  crest: number;
  wins: number;
  played: number;
  online_wins: number;
  online_played: number;
}

let client: Promise<SupabaseClient> | null = null;
function db(): Promise<SupabaseClient> {
  // En claude.ai ni siquiera se incluye el cliente de Supabase en el paquete.
  if (import.meta.env.MODE === 'artifact') return Promise.reject(new Error('sin conexión'));
  client ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(URL!, KEY!, { auth: { persistSession: false } }));
  return client;
}

const hex = (c: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : '#d6263b');

/** Registra (o actualiza) el club de este navegador en la tabla. */
async function pushClub(p: Profile): Promise<void> {
  if (!p.nickname) return;
  const name = p.club.name.trim() || 'Mi Club';
  const { error } = await (await db()).rpc('upsert_club', {
    p_id: p.cloudId,
    p_secret: p.cloudSecret,
    p_nickname: p.nickname.slice(0, 16),
    p_name: name.slice(0, 22),
    p_short: (p.club.short.trim() || initials(name)).slice(0, 3),
    p_primary: hex(p.club.primary),
    p_secondary: hex(p.club.secondary),
    p_crest: Math.max(0, Math.min(9, p.club.crest | 0)),
  });
  if (error) throw error;
}

let synced: Promise<void> | null = null;
let timer = 0;

/** Sube el club ahora (una vez por carga) y después de cada cambio de nombre, escudo o colores (con 1.5 s de calma). */
export function startClubSync(): void {
  if (!LEADERBOARD_AVAILABLE) return;
  synced ??= pushClub(loadProfile()).catch(() => { synced = null; });
  let last = identity(loadProfile());
  onProfileChange((p) => {
    const now = identity(p);
    if (now === last) return;
    last = now;
    clearTimeout(timer);
    timer = window.setTimeout(() => { synced = pushClub(p).catch(() => { synced = null; }); }, 1500);
  });
}

const identity = (p: Profile) => JSON.stringify([p.nickname, p.club]);

/** Anota un partido terminado del club (victoria o derrota; online o contra la IA). Sin internet, se pierde. */
export async function recordMatch(won: boolean, online: boolean): Promise<void> {
  if (!LEADERBOARD_AVAILABLE) return;
  const p = loadProfile();
  try {
    await (synced ?? (synced = pushClub(p)));
    await (await db()).rpc('record_match', { p_id: p.cloudId, p_secret: p.cloudSecret, p_won: won, p_online: online });
  } catch {
    // La tabla es un extra: si falla, el juego sigue igual.
  }
}

/** Los mejores clubes: más victorias primero (en empate, menos partidos jugados). */
export async function topClubs(limit = 100): Promise<ClubRow[]> {
  const { data, error } = await (await db())
    .from('clubs')
    .select('id, nickname, name, short, primary_color, secondary_color, crest, wins, played, online_wins, online_played')
    .order('wins', { ascending: false })
    .order('played', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ClubRow[];
}
