import type { PlayerDef, Role } from '../sim/players';
import { cardById, cardPlayer } from './cards';
import type { Profile } from './profile';
import { makeTeam, type TeamDef } from './teams';

/** Puesto de cada lugar de la plantilla (igual que los equipos: titulares 5-1, líbero y banca). */
export const SQUAD_ROLES: readonly Role[] = ['S', 'OH', 'MB', 'OP', 'OH', 'MB', 'L', 'S', 'OH', 'MB', 'OH', 'OP'];

/** Los 12 jugadores básicos del club: un nivel modesto (unos 10 puntos menos que un equipo de primera). */
export function basePlayers(profile: Profile): PlayerDef[] {
  const team = makeTeam({ id: 'MC', name: profile.club.name, province: '', primary: profile.club.primary, secondary: profile.club.secondary, style: 'balanced', seed: profile.seed });
  return team.roster.map((p, i) => {
    const attrs = { ...p.attrs };
    for (const k of Object.keys(attrs) as (keyof typeof attrs)[]) attrs[k] = Math.max(1, attrs[k] - 10);
    return { ...p, id: `MC-b${i}`, attrs, star: false, name: profile.names[`base:${i}`] ?? p.name };
  });
}

/** Jugador de un lugar de la plantilla ('base:<n>' o 'card:<id>'); null si la carta ya no está. */
export function squadPlayer(profile: Profile, ref: string, bases = basePlayers(profile)): PlayerDef | null {
  if (ref.startsWith('base:')) return bases[Number(ref.slice(5))] ?? null;
  const id = ref.slice(5);
  const card = cardById(id);
  const copies = profile.cards[id] ?? 0;
  return card && copies > 0 ? cardPlayer(card, `MC-c-${id}`, copies) : null;
}

/** El club como equipo del partido: la plantilla elegida, con los números sin repetir. */
export function clubTeam(profile: Profile): TeamDef {
  const bases = basePlayers(profile);
  const roster = SQUAD_ROLES.map((_, i) => squadPlayer(profile, profile.squad[i], bases) ?? bases[i]);
  const used = new Set<number>();
  for (const p of roster) {
    let n = p.number;
    while (used.has(n)) n = (n % 99) + 1;
    used.add(n);
    p.number = n;
  }
  const ids = roster.map((p) => p.id);
  const c = profile.club;
  return {
    id: 'MC',
    name: c.name.trim() || 'Mi Club',
    province: profile.nickname ? `DT ${profile.nickname}` : 'Tu club',
    primary: c.primary,
    secondary: c.secondary,
    style: 'balanced',
    roster,
    lineup: ids.slice(0, 6),
    libero: ids[6],
    liberoReplaces: [ids[2], ids[5]],
  };
}
