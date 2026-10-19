import type { PointReason } from '../sim/events';

/** Frases del narrador con sabor tico. Rotan para no repetirse seguidas. */
const PHRASES: Record<PointReason, string[]> = {
  ace: ['¡Ace! ¡Ni la vieron venir!', '¡Diay, qué saque más tuanis!', '¡Ace directo, pura vida!'],
  kill: ['¡Qué remate, mae!', '¡Tremendo pichazo al piso!', '¡Bombazo! ¡Nadie la toca!', '¡Eso es voleibol, mae!'],
  blockKill: ['¡Qué tapa, mae!', '¡Pared! ¡No pasa nada por ahí!', '¡Tapón de los buenos!'],
  blockOut: ['¡Usó las manos del bloqueo!', '¡Vivo! ¡La sacó por el bloqueo!', '¡Qué inteligencia, mae!'],
  landed: ['¡Cayó en tierra de nadie!', '¡Se les metió, mae!', '¡Nadie llegó!'],
  serviceError: ['Saque a la red… ¡qué torta!', 'Se le fue largo el saque.', 'Regalado ese punto.'],
  attackError: ['¡Se le fue el remate!', 'Afuera… ¡por poquito!', 'Remate a la red, ¡diay!'],
  error: ['Error no forzado.', '¡Qué torta, mae!', 'Se complicaron solitos.'],
};

export class Narrator {
  private readonly next = new Map<PointReason, number>();

  phrase(reason: PointReason): string {
    const pool = PHRASES[reason];
    const i = this.next.get(reason) ?? 0;
    this.next.set(reason, (i + 1) % pool.length);
    return pool[i];
  }
}
