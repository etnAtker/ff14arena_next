import type { EncounterOutcome, MechanicSnapshot, StatusSnapshot } from './simulation';
import type { Vector2 } from './base';

export interface BaseSimulationEvent<TType extends string, TPayload> {
  eventId: string;
  tick: number;
  timeMs: number;
  type: TType;
  payload: TPayload;
}

export type ActorMovedEvent = BaseSimulationEvent<
  'actorMoved',
  {
    actorId: string;
    position: Vector2;
    facing: number;
  }
>;

export type ActorForcedMovementRequestedEvent = BaseSimulationEvent<
  'actorForcedMovementRequested',
  {
    actorId: string;
    kind: 'knockback';
    source: Vector2;
    distance: number;
  }
>;

export type BossCastStartedEvent = BaseSimulationEvent<
  'bossCastStarted',
  {
    actionId: string;
    actionName: string;
    startedAt: number;
    totalDurationMs: number;
  }
>;

export type BossCastResolvedEvent = BaseSimulationEvent<
  'bossCastResolved',
  {
    actionId: string;
    actionName: string;
  }
>;

export type AoeSpawnedEvent = BaseSimulationEvent<'aoeSpawned', MechanicSnapshot>;
export type AoeResolvedEvent = BaseSimulationEvent<
  'aoeResolved',
  {
    mechanicId: string;
  }
>;

export type TetherTransferredEvent = BaseSimulationEvent<
  'tetherTransferred',
  {
    mechanicId: string;
    previousTargetId: string;
    targetId: string;
  }
>;

export type DamageAppliedEvent = BaseSimulationEvent<
  'damageApplied',
  {
    targetId: string;
    targetName: string;
    amount: number;
    remainingHp: number;
    sourceLabel: string;
  }
>;

export type StatusAppliedEvent = BaseSimulationEvent<
  'statusApplied',
  {
    targetId: string;
    targetName: string;
    status: StatusSnapshot;
  }
>;

export type ActorDiedEvent = BaseSimulationEvent<
  'actorDied',
  {
    actorId: string;
    actorName: string;
    deathReason: string;
    mechanicActive: boolean;
  }
>;

export type BattleFailureMarkedEvent = BaseSimulationEvent<
  'battleFailureMarked',
  {
    addedReason: string;
    failureReasons: string[];
  }
>;

export type EncounterCompletedEvent = BaseSimulationEvent<
  'encounterCompleted',
  {
    outcome: EncounterOutcome;
    failureReasons: string[];
  }
>;

export type SimulationEvent =
  | ActorMovedEvent
  | ActorForcedMovementRequestedEvent
  | BossCastStartedEvent
  | BossCastResolvedEvent
  | AoeSpawnedEvent
  | AoeResolvedEvent
  | TetherTransferredEvent
  | DamageAppliedEvent
  | StatusAppliedEvent
  | ActorDiedEvent
  | BattleFailureMarkedEvent
  | EncounterCompletedEvent;
