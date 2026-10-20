import type { Vec3 } from './vec';
import type { TeamId } from './court';
import type { Decision, DecisionKind, Power } from './decision';
import type { Score } from './match';
import type { Timing } from './resolver';

export type ContactKind = 'serve' | 'reception' | 'dig' | 'set' | 'attack' | 'block' | 'free';

export type PointReason = 'ace' | 'kill' | 'blockKill' | 'blockOut' | 'landed' | 'serviceError' | 'attackError' | 'error';

export type SimEvent =
  | { type: 'contact'; time: number; playerKey: string; team: TeamId; kind: ContactKind; quality: number; warmup?: boolean; at?: Vec3 }
  | { type: 'decision'; team: TeamId; decision: Decision }
  | { type: 'decisionResolved'; team: TeamId; kind: DecisionKind; timing: Timing; power?: Power; label?: string; warmup?: boolean }
  | { type: 'point'; winner: TeamId; reason: PointReason; points: Score; sets: Score }
  | { type: 'rotation'; team: TeamId }
  | { type: 'setEnd'; winner: TeamId; sets: Score }
  | { type: 'matchEnd'; winner: TeamId }
  | { type: 'timeout'; team: TeamId }
  | { type: 'warmupEnd' }
  | { type: 'substitution'; team: TeamId; outKey: string; inKey: string };

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
