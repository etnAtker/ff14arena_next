import type { MapMarker, PartySlot, RoomRuntimePhase, Vector2 } from './base';

export type ActorKind = 'player' | 'bot' | 'boss';
export type DamageType = 'raidwide' | 'avoidable' | 'punishment';
export type EncounterOutcome = 'success' | 'failure';
export type SimulationInputType = 'move' | 'face' | 'use-knockback-immune' | 'use-sprint';
export type StatusId = string;
export type MechanicKind =
  | 'circle'
  | 'donut'
  | 'share'
  | 'spread'
  | 'tower'
  | 'tether'
  | 'circleTelegraph';

export interface MoveState {
  direction: Vector2;
  moving: boolean;
}

export interface StatusSnapshot {
  id: StatusId;
  name: string;
  sourceId: string;
  expiresAt: number;
  multiplier?: number;
}

export interface CooldownState {
  readyAt: number;
}

export interface BossCastBarState {
  actionId: string;
  actionName: string;
  startedAt: number;
  totalDurationMs: number;
}

export interface HudState {
  bossCastBar: BossCastBarState | null;
}

export interface BaseActorSnapshot {
  id: string;
  kind: ActorKind;
  slot: PartySlot | null;
  name: string;
  position: Vector2;
  facing: number;
  moveState: MoveState;
  maxHp: number;
  currentHp: number;
  alive: boolean;
  statuses: StatusSnapshot[];
  knockbackImmune: boolean;
  knockbackImmuneCooldown: CooldownState;
  sprintCooldown: CooldownState;
  deathReason: string | null;
  lastDamageSource: string | null;
  online?: boolean;
  ready?: boolean;
}

export interface BossSnapshot extends BaseActorSnapshot {
  kind: 'boss';
  castBar: BossCastBarState | null;
  targetRingRadius: number;
}

export interface CircleMechanicSnapshot {
  id: string;
  kind: 'circle';
  label: string;
  sourceId: string;
  center: Vector2;
  radius: number;
  damage: number;
  damageType: DamageType;
  resolveAt: number;
}

export interface DonutMechanicSnapshot {
  id: string;
  kind: 'donut';
  label: string;
  sourceId: string;
  center: Vector2;
  innerRadius: number;
  outerRadius: number;
  damage: number;
  damageType: DamageType;
  resolveAt: number;
}

export interface ShareMechanicSnapshot {
  id: string;
  kind: 'share';
  label: string;
  sourceId: string;
  targetId: string;
  targetSlot: PartySlot;
  center: Vector2;
  radius: number;
  totalDamage: number;
  resolveAt: number;
}

export interface SpreadMechanicSnapshot {
  id: string;
  kind: 'spread';
  label: string;
  sourceId: string;
  targetId: string;
  targetSlot: PartySlot;
  center: Vector2;
  radius: number;
  damage: number;
  resolveAt: number;
}

export interface TowerMechanicSnapshot {
  id: string;
  kind: 'tower';
  label: string;
  sourceId: string;
  center: Vector2;
  radius: number;
  resolveAt: number;
}

export interface CircleTelegraphMechanicSnapshot {
  id: string;
  kind: 'circleTelegraph';
  label: string;
  sourceId: string;
  center: Vector2;
  radius: number;
  resolveAt: number;
}

export interface TetherMechanicSnapshot {
  id: string;
  kind: 'tether';
  label: string;
  sourceId: string;
  targetId: string;
  botTransferSequenceIds?: string[];
  botTransferCooldownMs: number;
  transferCooldownMs: number;
  allowTransfer: boolean;
  allowDeadRetarget: boolean;
  preventTargetHoldingOtherTether: boolean;
  resolveAt: number;
}

export type MechanicSnapshot =
  | CircleMechanicSnapshot
  | DonutMechanicSnapshot
  | ShareMechanicSnapshot
  | SpreadMechanicSnapshot
  | TowerMechanicSnapshot
  | CircleTelegraphMechanicSnapshot
  | TetherMechanicSnapshot;

export interface EncounterResult {
  outcome: EncounterOutcome;
  failureReasons: string[];
}

export interface SimulationSnapshot {
  battleId: string;
  battleName: string;
  roomId: string;
  phase: RoomRuntimePhase;
  tick: number;
  timeMs: number;
  arenaRadius: number;
  bossTargetRingRadius: number;
  mapMarkers: MapMarker[];
  actors: BaseActorSnapshot[];
  boss: BossSnapshot;
  mechanics: MechanicSnapshot[];
  hud: HudState;
  scriptState: Record<string, unknown>;
  failureMarked: boolean;
  failureReasons: string[];
  latestResult: EncounterResult | null;
}

export interface MoveInputPayload {
  direction: Vector2;
}

export interface FaceInputPayload {
  facing: number;
}

export interface UseKnockbackImmunePayload {
  issuedBy: 'player' | 'bot';
}

export interface UseSprintPayload {
  issuedBy: 'player' | 'bot';
}

export interface ContinuousInputFramePayload {
  position: Vector2;
  moveDirection: Vector2;
  facing: number;
}

export interface ActorPoseSample {
  actorId: string;
  inputSeq: number;
  issuedAt: number;
  position: Vector2;
  facing: number;
  moveState: MoveState;
}

export interface ActorControlPose {
  position: Vector2;
  facing: number;
  moveState: MoveState;
}

export type ActorControlCommand =
  | {
      type: 'use-knockback-immune';
      payload: UseKnockbackImmunePayload;
    }
  | {
      type: 'use-sprint';
      payload: UseSprintPayload;
    };

export interface ActorControlFrame {
  actorId: string;
  inputSeq: number;
  issuedAt: number;
  pose?: ActorControlPose;
  commands?: ActorControlCommand[];
}

export type PositionCorrectionMode = 'smooth' | 'hard';

export type SimulationInputPayload =
  | MoveInputPayload
  | FaceInputPayload
  | UseKnockbackImmunePayload
  | UseSprintPayload;

export interface SimulationInputBase<TType extends SimulationInputType, TPayload> {
  roomId: string;
  actorId: string;
  inputSeq: number;
  issuedAt: number;
  type: TType;
  payload: TPayload;
}

export type MoveSimulationInput = SimulationInputBase<'move', MoveInputPayload>;
export type FaceSimulationInput = SimulationInputBase<'face', FaceInputPayload>;
export type UseKnockbackImmuneSimulationInput = SimulationInputBase<
  'use-knockback-immune',
  UseKnockbackImmunePayload
>;
export type UseSprintSimulationInput = SimulationInputBase<'use-sprint', UseSprintPayload>;

export interface ContinuousSimulationInputFrame {
  roomId: string;
  actorId: string;
  inputSeq: number;
  issuedAt: number;
  payload: ContinuousInputFramePayload;
}

export type SimulationInput =
  | MoveSimulationInput
  | FaceSimulationInput
  | UseKnockbackImmuneSimulationInput
  | UseSprintSimulationInput;
