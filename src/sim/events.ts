import type { TeamId } from './court';
import type { Score } from './match';

export type ContactKind = 'serve' | 'reception' | 'dig' | 'set' | 'attack' | 'block' | 'free';

export type PointReason = 'ace' | 'kill' | 'blockKill' | 'landed' | 'serviceError' | 'attackError' | 'error';

export type SimEvent =
  | { type: 'contact'; time: number; playerKey: string; team: TeamId; kind: ContactKind; quality: number }
  | { type: 'point'; winner: TeamId; reason: PointReason; points: Score; sets: Score }
  | { type: 'rotation'; team: TeamId }
  | { type: 'setEnd'; winner: TeamId; sets: Score }
  | { type: 'matchEnd'; winner: TeamId };

export class EventBus {
  private handlers: Array<(e: SimEvent) => void> = [];

  on(handler: (e: SimEvent) => void): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  emit(e: SimEvent): void {
    for (const h of this.handlers) h(e);
  }
}
