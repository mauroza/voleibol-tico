import type { Attributes, PlayerDef, Role, Specialty } from '../sim/players';
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
  /** Siglas y diseño de escudo (para el marcador y los menús). */
  short?: string;
  crest?: number;
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
  /** Nombres de jugadores conocidos por posición en la planilla (0 colocador, 1 punta, 2 central, 3 opuesto, …). */
  names?: Partial<Record<number, string>>;
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
/** Fuertes posibles por puesto: cada jugador se destaca en uno (+14). */
const ROLE_SPECIALTIES: Record<Role, Specialty[]> = {
  S: ['setting', 'serve', 'defense'],
  OH: ['attackPower', 'reception', 'serve'],
  MB: ['block', 'attackPower', 'serve'],
  OP: ['attackPower', 'serve', 'block'],
  L: ['reception', 'defense'],
};
const SPECIALTY_BONUS = 14;

/** La figura del equipo: salta y remata fuera de serie. */
const STAR_BONUS: Partial<Attributes> = { jump: 24, attackPower: 15, attackAccuracy: 5 };

const FIRST = ['Andrés', 'José', 'Luis', 'Carlos', 'Daniel', 'Esteban', 'Kevin', 'Josué', 'Fabián', 'Diego',
  'Pablo', 'Mauricio', 'Randall', 'Bryan', 'Allan', 'Jason', 'Steven', 'Adrián', 'Gabriel', 'Sebastián'];
const LAST = ['Mora', 'Rodríguez', 'Jiménez', 'Vargas', 'Rojas', 'Solís', 'Quesada', 'Araya', 'Chaves', 'Calderón',
  'Brenes', 'Zúñiga', 'Arias', 'Montero', 'Salas', 'Ulate', 'Alfaro', 'Cordero', 'Villalobos', 'Murillo'];

function weighted(r: number, weights: readonly number[]): number {
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (r < acc) return i;
  }
  return weights.length - 1;
}

export function makeTeam(spec: TeamSpec): TeamDef {
  const { seed, variance = 6, names = {}, ...info } = spec;
  const rng = createRng(seed);
  const bonus = STYLE_BONUS[spec.style];
  const roster = ROLES.map((role, i): PlayerDef => {
    const attrs = { ...ROLE_BASE[role] };
    for (const key of Object.keys(attrs) as (keyof Attributes)[]) {
      const value = attrs[key] + (bonus[key] ?? 0) + rng.range(-variance, variance);
      attrs[key] = Math.round(Math.min(99, Math.max(1, value)));
    }
    return { id: `${spec.id}-${i + 1}`, name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`, number: i + 1, role, attrs, height: 0, specialty: 'serve', serveStyle: 'float', skin: 0, hair: 0, armSleeve: 0, legSleeve: 0, sleeveColor: 0 };
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
  // Apariencia con otro generador: piel de todos los tonos (Limón con más afrocostarricenses).
  const looks = createRng(seed * 104729 + 7);
  const skinWeights = spec.id === 'LI' ? [0.05, 0.1, 0.15, 0.2, 0.25, 0.25] : [0.16, 0.26, 0.26, 0.14, 0.1, 0.08];
  for (const p of roster) {
    p.specialty = looks.pick(ROLE_SPECIALTIES[p.role]);
    p.attrs[p.specialty] = Math.min(99, p.attrs[p.specialty] + SPECIALTY_BONUS);
    // Saque propio: los sacadores fuertes, los opuestos y la figura sacan en suspensión; el resto, flotado.
    const jumpChance = (p.attrs.serve - 55) / 35 + (p.role === 'OP' ? 0.3 : 0) + (p.star ? 0.5 : 0) - (p.role === 'L' || p.role === 'S' ? 0.4 : 0);
    p.serveStyle = looks.chance(Math.min(0.95, Math.max(0.05, jumpChance))) ? 'jump' : 'float';
    p.skin = weighted(looks.next(), skinWeights);
    // Pelo: la mayoría natural, uno de cada tres llamativo; algunos rapados.
    p.hair = weighted(looks.next(), [0.24, 0.16, 0.1, 0.05, 0.05, 0.05, 0.06, 0.05, 0.04, 0.04, 0.04, 0.12]);
    // Mangas de compresión como los profesionales: a veces una sola manga negra en una pierna.
    p.armSleeve = weighted(looks.next(), [0.55, 0.1, 0.15, 0.2]);
    p.legSleeve = weighted(looks.next(), [0.62, 0.14, 0.14, 0.1]);
    p.sleeveColor = looks.chance(0.75) ? 0 : 1;
  }
  for (const [i, name] of Object.entries(names)) if (name && roster[Number(i)]) roster[Number(i)].name = name;
  const ids = roster.map((p) => p.id);
  return { ...info, roster, lineup: ids.slice(0, 6), libero: ids[6], liberoReplaces: [ids[2], ids[5]] };
}

/** Equipos de la primera división masculina de Costa Rica (los colores son aproximados; el resto de la planilla es inventada). */
export const TEAMS: readonly TeamDef[] = [
  { ...makeTeam({ id: 'SJ', name: 'San José', province: 'San José', primary: '#c8102e', secondary: '#1d3f8f', style: 'balanced', seed: 101, names: { 0: 'Ignacio', 1: 'Stanley Grant' } }), short: 'SJO', crest: 0 },
  { ...makeTeam({ id: 'SC', name: 'San Carlos', province: 'Alajuela', primary: '#1e7d32', secondary: '#ffffff', style: 'power', seed: 102 }), short: 'SCA', crest: 2 },
  { ...makeTeam({ id: 'CA', name: 'Cartago', province: 'Cartago', primary: '#1f4e9c', secondary: '#ffffff', style: 'block', seed: 103 }), short: 'CAR', crest: 1 },
  { ...makeTeam({ id: 'TU', name: 'Turrialba', province: 'Cartago', primary: '#f28c00', secondary: '#111111', style: 'serve', seed: 104 }), short: 'TUR', crest: 3 },
  { ...makeTeam({ id: 'UC', name: 'UCR', province: 'San José', primary: '#2a7fd4', secondary: '#f4c430', style: 'defense', seed: 105 }), short: 'UCR', crest: 4 },
  { ...makeTeam({ id: 'LI', name: 'Limón', province: 'Limón', primary: '#0f7a3d', secondary: '#f2c500', style: 'athletic', seed: 107 }), short: 'LIM', crest: 5 },
];
