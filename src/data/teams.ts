import type { Attributes, PlayerDef, Role } from '../sim/players';
import { createRng } from '../sim/rng';

export type TeamStyle = 'balanced' | 'power' | 'block' | 'defense' | 'serve' | 'fast' | 'athletic';

export interface TeamDef {
  id: string;
  name: string;
  province: string;
  primary: string;
  secondary: string;
  style: TeamStyle;
  roster: PlayerDef[];
  /** 6 ids en orden de posición 1..6 */
  lineup: string[];
  libero: string;
  liberoReplaces: string[];
}

export interface TeamSpec {
  id: string;
  name: string;
  province: string;
  primary: string;
  secondary: string;
  style: TeamStyle;
  seed: number;
  variance?: number;
}

const ROLE_BASE: Record<Role, Attributes> = {
  S: { serve: 60, reception: 55, setting: 82, attackPower: 50, attackAccuracy: 55, block: 55, jump: 62, speed: 70, defense: 62 },
  OH: { serve: 66, reception: 70, setting: 45, attackPower: 76, attackAccuracy: 70, block: 62, jump: 72, speed: 68, defense: 64 },
  MB: { serve: 58, reception: 40, setting: 40, attackPower: 74, attackAccuracy: 68, block: 80, jump: 78, speed: 62, defense: 45 },
  OP: { serve: 70, reception: 45, setting: 42, attackPower: 82, attackAccuracy: 68, block: 68, jump: 74, speed: 64, defense: 52 },
  L: { serve: 30, reception: 84, setting: 55, attackPower: 20, attackAccuracy: 30, block: 10, jump: 40, speed: 78, defense: 84 },
};

const STYLE_BONUS: Record<TeamStyle, Partial<Attributes>> = {
  balanced: {},
  power: { attackPower: 8 },
  block: { block: 8, jump: 3 },
  defense: { reception: 6, defense: 8 },
  serve: { serve: 10 },
  fast: { setting: 6, speed: 6 },
  athletic: { jump: 7, speed: 4 },
};

/** Índices 0-5 titulares (5-1), 6 líbero, 7-11 banca. */
const ROLES: Role[] = ['S', 'OH', 'MB', 'OP', 'OH', 'MB', 'L', 'S', 'OH', 'MB', 'OH', 'OP'];

/** Estatura típica por puesto (m). */
const ROLE_HEIGHT: Record<Role, number> = { S: 1.88, OH: 1.94, MB: 2.01, OP: 1.97, L: 1.78 };
/** La figura del equipo: salta y remata fuera de serie. */
const STAR_BONUS: Partial<Attributes> = { jump: 24, attackPower: 15, attackAccuracy: 5 };

const FIRST = ['Andrés', 'José', 'Luis', 'Carlos', 'Daniel', 'Esteban', 'Kevin', 'Josué', 'Fabián', 'Diego',
  'Pablo', 'Mauricio', 'Randall', 'Bryan', 'Allan', 'Jason', 'Steven', 'Adrián', 'Gabriel', 'Sebastián'];
const LAST = ['Mora', 'Rodríguez', 'Jiménez', 'Vargas', 'Rojas', 'Solís', 'Quesada', 'Araya', 'Chaves', 'Calderón',
  'Brenes', 'Zúñiga', 'Arias', 'Montero', 'Salas', 'Ulate', 'Alfaro', 'Cordero', 'Villalobos', 'Murillo'];

export function makeTeam(spec: TeamSpec): TeamDef {
  const { seed, variance = 6, ...info } = spec;
  const rng = createRng(seed);
  const bonus = STYLE_BONUS[spec.style];
  const roster = ROLES.map((role, i): PlayerDef => {
    const attrs = { ...ROLE_BASE[role] };
    for (const key of Object.keys(attrs) as (keyof Attributes)[]) {
      const value = attrs[key] + (bonus[key] ?? 0) + rng.range(-variance, variance);
      attrs[key] = Math.round(Math.min(99, Math.max(1, value)));
    }
    return { id: `${spec.id}-${i + 1}`, name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`, number: i + 1, role, attrs, height: 0 };
  });
  // Físico con su propio generador: no altera los atributos ya sorteados.
  const body = createRng(seed * 7919 + 13);
  const star = body.chance(0.5) ? 1 : 3;
  for (const [i, p] of roster.entries()) {
    p.height = Math.round((ROLE_HEIGHT[p.role] + body.range(-0.07, 0.07)) * 100) / 100;
    if (i !== star) continue;
    p.star = true;
    p.height = Math.round((p.height + 0.04) * 100) / 100;
    for (const key of Object.keys(STAR_BONUS) as (keyof Attributes)[]) p.attrs[key] = Math.min(99, p.attrs[key] + STAR_BONUS[key]!);
  }
  const ids = roster.map((p) => p.id);
  return { ...info, roster, lineup: ids.slice(0, 6), libero: ids[6], liberoReplaces: [ids[2], ids[5]] };
}

export const TEAMS: readonly TeamDef[] = [
  makeTeam({ id: 'SJ', name: 'Leones de San José', province: 'San José', primary: '#c8102e', secondary: '#1d3f8f', style: 'balanced', seed: 101 }),
  makeTeam({ id: 'AL', name: 'Manudos de Alajuela', province: 'Alajuela', primary: '#d0021b', secondary: '#111111', style: 'power', seed: 102 }),
  makeTeam({ id: 'CA', name: 'Volcanes de Cartago', province: 'Cartago', primary: '#1f4e9c', secondary: '#ffffff', style: 'block', seed: 103 }),
  makeTeam({ id: 'HE', name: 'Flores de Heredia', province: 'Heredia', primary: '#d6202a', secondary: '#f4c430', style: 'defense', seed: 104 }),
  makeTeam({ id: 'GU', name: 'Toros de Guanacaste', province: 'Guanacaste', primary: '#1e7d32', secondary: '#f2c500', style: 'serve', seed: 105 }),
  makeTeam({ id: 'PU', name: 'Mareas de Puntarenas', province: 'Puntarenas', primary: '#3fa9f5', secondary: '#ffffff', style: 'fast', seed: 106 }),
  makeTeam({ id: 'LI', name: 'Tortugas de Limón', province: 'Limón', primary: '#0f7a3d', secondary: '#111111', style: 'athletic', seed: 107 }),
];
