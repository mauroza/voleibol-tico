import type { TeamId } from './court';
import type { Vec3 } from './vec';

export type Role = 'S' | 'OH' | 'MB' | 'OP' | 'L';
export type Specialty = 'serve' | 'reception' | 'block' | 'attackPower' | 'defense' | 'setting';
export const SPECIALTY_LABELS: Record<Specialty, string> = {
  serve: 'Saque', reception: 'Recepción', block: 'Bloqueo', attackPower: 'Remate', defense: 'Defensa', setting: 'Colocación',
};

export interface Attributes {
  serve: number;
  reception: number;
  setting: number;
  attackPower: number;
  attackAccuracy: number;
  block: number;
  jump: number;
  speed: number;
  defense: number;
}

export interface PlayerDef {
  id: string;
  name: string;
  number: number;
  role: Role;
  attrs: Attributes;
  /** Estatura (m). Suma al alcance de remate y de bloqueo. */
  height: number;
  /** Figura del equipo: salto y remate fuera de serie. */
  star?: boolean;
  /** Su fuerte: el fundamento en que se destaca. */
  specialty: Specialty;
  /** Su saque de siempre: en suspensión (como remate) o flotado en salto. */
  serveStyle: 'jump' | 'float';
  /** Apariencia: tono de piel (0 claro … 5 muy oscuro) y pelo (índice de color; el último, rapado). */
  skin: number;
  hair: number;
  /** Mangas de compresión: 0 ninguna, 1 izquierda, 2 derecha, 3 ambas (brazos y piernas); color 0 negro, 1 blanco. */
  armSleeve: number;
  legSleeve: number;
  sleeveColor: number;
}

/** Apellido para la espalda de la camisa. */
export function shirtName(p: PlayerDef): string {
  const parts = p.name.split(' ');
  return parts[parts.length - 1].toUpperCase();
}

export interface PlayerState {
  /** `${team}:${def.id}`: único aunque ambos lados usen el mismo TeamDef. */
  key: string;
  def: PlayerDef;
  team: TeamId;
  pos: Vec3;
  target: Vec3;
  /** Energía 0..1: los saltos y las planchas cansan; se recupera entre puntos y en la banca. */
  stamina: number;
}

/** m/s */
export const moveSpeed = (p: PlayerDef): number => 3.5 + 2.5 * (p.attrs.speed / 100);
/** Altura de la mano al rematar. */
export const attackContactHeight = (p: PlayerDef): number => 2.9 + 0.5 * (p.attrs.jump / 100) + REACH_PER_M * (p.height - AVG_HEIGHT);
/** Altura máxima de las manos al bloquear. */
export const blockReach = (p: PlayerDef): number => 2.75 + 0.45 * (p.attrs.jump / 100) + REACH_PER_M * (p.height - AVG_HEIGHT);
/** Estatura de referencia y cuánto alcance da cada metro de estatura (brazos incluidos). */
export const AVG_HEIGHT = 1.93;
const REACH_PER_M = 1.33;
