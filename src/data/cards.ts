import type { Attributes, PlayerDef, Role, Specialty } from '../sim/players';
import { createRng, type Rng } from '../sim/rng';

/**
 * Cartas de los sobres: figuras de la Liga de Naciones (VNL) y promesas. Los atributos son una estimación de juego
 * (no estadísticas oficiales): cada carta tiene una media general y su fuerte.
 */
export type Rarity = 'leyenda' | 'elite' | 'internacional' | 'promesa';

export const RARITY_LABELS: Record<Rarity, string> = {
  leyenda: 'Leyenda',
  elite: 'Élite',
  internacional: 'Internacional',
  promesa: 'Promesa',
};

export interface Card {
  id: string;
  name: string;
  /** Código del país (3 letras) o 'CRC' para las promesas. */
  country: string;
  role: Role;
  height: number;
  number: number;
  /** Media general 50..99. */
  overall: number;
  specialty: Specialty;
  skin: number;
  hair: number;
  serveStyle: 'jump' | 'float';
  rarity: Rarity;
}

export const COUNTRY_NAMES: Record<string, string> = {
  JPN: 'Japón', BRA: 'Brasil', BUL: 'Bulgaria', FRA: 'Francia', POL: 'Polonia', ITA: 'Italia', USA: 'Estados Unidos',
  ARG: 'Argentina', NED: 'Países Bajos', CUB: 'Cuba', SLO: 'Eslovenia', CAN: 'Canadá', SRB: 'Serbia', CRC: 'Costa Rica',
};

type Row = [name: string, country: string, role: Role, height: number, number: number, overall: number, specialty: Specialty, skin: number, hair: number];

/** Figuras de la VNL (media estimada para el juego). */
const VNL: Row[] = [
  ['Yuji Nishida', 'JPN', 'OP', 1.87, 11, 95, 'serve', 1, 0],
  ['Wilfredo León', 'POL', 'OH', 2.02, 9, 94, 'serve', 4, 11],
  ['Earvin N\'Gapeth', 'FRA', 'OH', 1.94, 9, 93, 'attackPower', 3, 1],
  ['Darlan Souza', 'BRA', 'OP', 2.0, 9, 92, 'attackPower', 3, 0],
  ['Aleksandar Nikolov', 'BUL', 'OH', 2.07, 7, 92, 'attackPower', 0, 2],
  ['Simone Giannelli', 'ITA', 'S', 1.98, 6, 93, 'setting', 0, 1],
  ['Antoine Brizard', 'FRA', 'S', 1.96, 4, 90, 'setting', 0, 2],
  ['Bartosz Kurek', 'POL', 'OP', 2.07, 6, 90, 'attackPower', 0, 11],
  ['Ran Takahashi', 'JPN', 'OH', 1.88, 12, 91, 'reception', 1, 0],
  ['Alessandro Michieletto', 'ITA', 'OH', 2.11, 5, 90, 'attackPower', 0, 1],
  ['Yuki Ishikawa', 'JPN', 'OH', 1.92, 14, 89, 'reception', 1, 0],
  ['Matt Anderson', 'USA', 'OP', 2.04, 1, 87, 'attackPower', 0, 11],
  ['Micah Christenson', 'USA', 'S', 1.98, 11, 89, 'setting', 0, 2],
  ['Jenia Grebennikov', 'FRA', 'L', 1.88, 2, 90, 'defense', 0, 0],
  ['Tomasz Fornal', 'POL', 'OH', 2.0, 15, 88, 'reception', 0, 1],
  ['Kamil Semeniuk', 'POL', 'OH', 1.94, 18, 87, 'reception', 0, 0],
  ['Ricardo Lucarelli', 'BRA', 'OH', 1.95, 18, 87, 'attackPower', 2, 0],
  ['Bruno Rezende', 'BRA', 'S', 1.9, 1, 88, 'setting', 1, 1],
  ['Lucas Saatkamp', 'BRA', 'MB', 2.09, 16, 87, 'block', 0, 11],
  ['Jean Patry', 'FRA', 'OP', 2.07, 11, 87, 'serve', 0, 2],
  ['Barthélémy Chinenyeze', 'FRA', 'MB', 2.01, 16, 86, 'block', 5, 11],
  ['Masahiro Sekita', 'JPN', 'S', 1.75, 2, 87, 'setting', 1, 0],
  ['Taylor Averill', 'USA', 'MB', 2.01, 6, 85, 'block', 0, 1],
  ['Fabio Balaso', 'ITA', 'L', 1.78, 6, 88, 'reception', 0, 0],
  ['Yuri Romanò', 'ITA', 'OP', 2.0, 17, 86, 'attackPower', 0, 1],
  ['Roberto Russo', 'ITA', 'MB', 2.05, 13, 86, 'block', 0, 0],
  ['Paweł Zatorski', 'POL', 'L', 1.84, 16, 87, 'defense', 0, 11],
  ['Erik Shoji', 'USA', 'L', 1.84, 22, 87, 'reception', 1, 0],
  ['Tomohiro Yamamoto', 'JPN', 'L', 1.73, 20, 86, 'defense', 1, 0],
  ['Nimir Abdel-Aziz', 'NED', 'OP', 2.01, 14, 86, 'serve', 4, 11],
  ['Agustín Loser', 'ARG', 'MB', 1.99, 15, 86, 'block', 0, 1],
  ['Luciano De Cecco', 'ARG', 'S', 1.91, 13, 86, 'setting', 0, 0],
  ['Jakub Kochanowski', 'POL', 'MB', 1.99, 3, 87, 'block', 0, 0],
  ['Maxwell Holt', 'USA', 'MB', 2.05, 12, 84, 'block', 0, 2],
  ['Marlon Yant', 'CUB', 'OH', 1.86, 6, 85, 'attackPower', 5, 11],
  ['Aaron Russell', 'USA', 'OH', 2.05, 2, 85, 'serve', 0, 2],
  ['Torey DeFalco', 'USA', 'OH', 1.96, 21, 84, 'reception', 0, 1],
  ['Akihiro Yamauchi', 'JPN', 'MB', 2.04, 20, 84, 'block', 1, 0],
  ['Marcin Janusz', 'POL', 'S', 1.95, 7, 85, 'setting', 0, 0],
  ['Norbert Huber', 'POL', 'MB', 2.07, 99, 85, 'block', 0, 11],
  ['Trévor Clévenot', 'FRA', 'OH', 1.99, 17, 85, 'reception', 0, 1],
  ['Alan Souza', 'BRA', 'OP', 2.0, 10, 84, 'attackPower', 2, 11],
  ['Gianluca Galassi', 'ITA', 'MB', 2.04, 18, 84, 'block', 0, 0],
  ['Mateusz Bieniek', 'POL', 'MB', 2.1, 20, 85, 'serve', 0, 1],
  ['Tine Urnaut', 'SLO', 'OH', 2.0, 8, 84, 'attackPower', 0, 0],
  ['Stephen Maar', 'CAN', 'OH', 2.0, 11, 83, 'serve', 0, 0],
  ['Uroš Kovačević', 'SRB', 'OH', 1.98, 18, 83, 'reception', 0, 1],
];

const rarityFor = (overall: number): Rarity => (overall >= 90 ? 'leyenda' : overall >= 86 ? 'elite' : 'internacional');
const slug = (name: string) => name.normalize('NFD').replace(/[^A-Za-z]/g, '').toLowerCase();

export const VNL_CARDS: readonly Card[] = VNL.map(([name, country, role, height, number, overall, specialty, skin, hair]) => ({
  id: slug(name),
  name,
  country,
  role,
  height,
  number,
  overall,
  specialty,
  skin,
  hair,
  serveStyle: role === 'L' || role === 'S' && specialty !== 'serve' ? 'float' : specialty === 'serve' || overall >= 88 ? 'jump' : 'float',
  rarity: rarityFor(overall),
}));

const FIRST = ['Andrés', 'José', 'Luis', 'Carlos', 'Daniel', 'Esteban', 'Kevin', 'Josué', 'Fabián', 'Diego', 'Pablo',
  'Mauricio', 'Randall', 'Bryan', 'Allan', 'Jason', 'Steven', 'Adrián', 'Gabriel', 'Sebastián', 'Jordan', 'Keylor'];
const LAST = ['Mora', 'Rodríguez', 'Jiménez', 'Vargas', 'Rojas', 'Solís', 'Quesada', 'Araya', 'Chaves', 'Calderón',
  'Brenes', 'Zúñiga', 'Arias', 'Montero', 'Salas', 'Ulate', 'Alfaro', 'Cordero', 'Villalobos', 'Murillo', 'Campos'];
const ROLES: Role[] = ['S', 'OH', 'OH', 'MB', 'MB', 'OP', 'L'];
const ROLE_HEIGHT: Record<Role, number> = { S: 1.88, OH: 1.94, MB: 2.01, OP: 1.97, L: 1.78 };
const ROLE_SPECIALTIES: Record<Role, Specialty[]> = {
  S: ['setting', 'serve', 'defense'], OH: ['attackPower', 'reception', 'serve'], MB: ['block', 'attackPower', 'serve'],
  OP: ['attackPower', 'serve', 'block'], L: ['reception', 'defense'],
};

/** Promesa nacional: carta generada con una semilla (siempre la misma para el mismo id). */
export function prospect(seed: number): Card {
  const rng = createRng(Math.imul(seed, 2654435761) ^ 0x5bd1e995);
  // Las primeras salidas de semillas vecinas se parecen: se descartan.
  for (let i = 0; i < 4; i++) rng.next();
  const role = rng.pick(ROLES);
  const overall = Math.round(rng.range(68, 79));
  return {
    id: `p${seed}`,
    name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`,
    country: 'CRC',
    role,
    height: Math.round((ROLE_HEIGHT[role] + rng.range(-0.06, 0.06)) * 100) / 100,
    number: 1 + Math.floor(rng.range(0, 24)),
    overall,
    specialty: rng.pick(ROLE_SPECIALTIES[role]),
    skin: Math.floor(rng.range(0, 5.99)),
    hair: Math.floor(rng.range(0, 11.99)),
    serveStyle: rng.chance(0.4) ? 'jump' : 'float',
    rarity: 'promesa',
  };
}

/** Carta por id (de la VNL o promesa). */
export function cardById(id: string): Card | null {
  return VNL_CARDS.find((c) => c.id === id) ?? (/^p\d+$/.test(id) ? prospect(Number(id.slice(1))) : null);
}

/** Cada repetida sube un punto la media (hasta +4). */
export const levelBonus = (copies: number): number => Math.min(4, Math.max(0, copies - 1));

/** Base de atributos por puesto (con media 75). */
const ROLE_BASE: Record<Role, Attributes> = {
  S: { serve: 62, reception: 58, setting: 86, attackPower: 52, attackAccuracy: 58, block: 58, jump: 66, speed: 72, defense: 66 },
  OH: { serve: 70, reception: 74, setting: 46, attackPower: 80, attackAccuracy: 74, block: 64, jump: 76, speed: 70, defense: 68 },
  MB: { serve: 60, reception: 40, setting: 40, attackPower: 78, attackAccuracy: 72, block: 84, jump: 82, speed: 64, defense: 46 },
  OP: { serve: 74, reception: 46, setting: 42, attackPower: 86, attackAccuracy: 72, block: 70, jump: 78, speed: 66, defense: 54 },
  L: { serve: 30, reception: 88, setting: 58, attackPower: 20, attackAccuracy: 30, block: 10, jump: 40, speed: 82, defense: 88 },
};

/** Jugador de la carta para un equipo: atributos según la media (y el nivel por repetidas). */
export function cardPlayer(card: Card, id: string, copies = 1): PlayerDef {
  const overall = card.overall + levelBonus(copies);
  const k = overall / 80;
  const attrs = { ...ROLE_BASE[card.role] };
  for (const key of Object.keys(attrs) as (keyof Attributes)[]) attrs[key] = Math.round(Math.min(99, Math.max(1, attrs[key] * k)));
  attrs[card.specialty] = Math.min(99, attrs[card.specialty] + 10);
  // Las leyendas atacantes saltan y rematan fuera de serie (como la figura de cada equipo).
  const star = card.rarity === 'leyenda' && (card.role === 'OH' || card.role === 'OP');
  if (star) {
    attrs.jump = Math.min(99, attrs.jump + 12);
    attrs.attackPower = Math.min(99, attrs.attackPower + 6);
  }
  const looks = createRng(card.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 1_000_000 + 1);
  return {
    id,
    name: card.name,
    number: card.number,
    role: card.role,
    attrs,
    height: card.height,
    star,
    specialty: card.specialty,
    serveStyle: card.serveStyle,
    skin: card.skin,
    hair: card.hair,
    armSleeve: Math.floor(looks.range(0, 3.99)),
    legSleeve: looks.chance(0.6) ? 0 : Math.floor(looks.range(1, 3.99)),
    sleeveColor: looks.chance(0.75) ? 0 : 1,
  };
}

/** Media general de un jugador (para mostrar). */
export function overallOf(p: PlayerDef): number {
  const a = p.attrs;
  const main: Record<Role, (keyof Attributes)[]> = {
    S: ['setting', 'serve', 'defense', 'jump', 'speed'],
    OH: ['attackPower', 'attackAccuracy', 'reception', 'jump', 'serve'],
    MB: ['block', 'attackPower', 'jump', 'attackAccuracy', 'serve'],
    OP: ['attackPower', 'attackAccuracy', 'serve', 'jump', 'block'],
    L: ['reception', 'defense', 'speed', 'setting', 'serve'],
  };
  const keys = main[p.role];
  return Math.round(keys.reduce((s, k) => s + a[k], 0) / keys.length);
}

/** Abre un sobre: 4 cartas, la primera siempre de la VNL. */
export function openPack(rng: Rng): Card[] {
  const vnl = (): Card => {
    const tier = rng.weighted<Rarity>([
      { item: 'leyenda', weight: 0.12 },
      { item: 'elite', weight: 0.38 },
      { item: 'internacional', weight: 0.5 },
    ]);
    return rng.pick(VNL_CARDS.filter((c) => c.rarity === tier));
  };
  const cards = [vnl()];
  for (let i = 0; i < 3; i++) cards.push(rng.chance(0.25) ? vnl() : prospect(1 + Math.floor(rng.range(0, 999_999))));
  // La mejor, al final (se revela de última).
  return cards.sort((a, b) => a.overall - b.overall);
}
