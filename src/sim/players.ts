import type { TeamId } from './court';
import type { Vec3 } from './vec';

export type Role = 'S' | 'OH' | 'MB' | 'OP' | 'L';

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
}

export interface PlayerState {
  /** `${team}:${def.id}`: único aunque ambos lados usen el mismo TeamDef. */
  key: string;
  def: PlayerDef;
  team: TeamId;
  pos: Vec3;
  target: Vec3;
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
