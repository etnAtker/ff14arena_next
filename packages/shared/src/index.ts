export const PARTY_SLOT_ORDER = ['MT', 'ST', 'H1', 'H2', 'D1', 'D2', 'D3', 'D4'] as const;

export type PartySlot = (typeof PARTY_SLOT_ORDER)[number];

export const ROOM_PHASES = ['waiting', 'running', 'closed'] as const;
export type RoomPhase = (typeof ROOM_PHASES)[number];

export const ROOM_RUNTIME_PHASES = ['waiting', 'running'] as const;
export type RoomRuntimePhase = (typeof ROOM_RUNTIME_PHASES)[number];

export type ActorKind = 'player' | 'bot' | 'boss';
export type DamageType = 'raidwide' | 'avoidable' | 'punishment';
export type EncounterOutcome = 'success' | 'failure';
export type SimulationInputType = 'move' | 'face' | 'use-knockback-immune';
export type StatusId = string;
export type MechanicKind =
  | 'circle'
  | 'donut'
  | 'share'
  | 'spread'
  | 'tower'
  | 'tether'
  | 'circleTelegraph';

export interface Vector2 {
  x: number;
  y: number;
}

export type MapMarkerLabel = 'A' | 'B' | 'C' | 'D' | '1' | '2' | '3' | '4';
export type MapMarkerShape = 'circle' | 'square';

export interface MapMarker {
  label: MapMarkerLabel;
  shape: MapMarkerShape;
  position: Vector2;
  color: string;
  radius?: number;
  size?: number;
}

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

export interface BattleSummary {
  id: string;
  name: string;
}

export interface BattleStaticData {
  id: string;
  name: string;
  bossName: string;
  arenaRadius: number;
  bossTargetRingRadius: number;
  mapMarkers: MapMarker[];
  defaultPlayerMaxHp: number;
  initialPartyPositions: Record<
    PartySlot,
    {
      position: Vector2;
      facing: number;
    }
  >;
}

export interface RoomSlotState {
  slot: PartySlot;
  occupantType: 'empty' | 'player' | 'bot';
  actorId: string | null;
  ownerUserId: string | null;
  name: string | null;
  online: boolean;
  ready: boolean;
  currentHp: number | null;
  alive: boolean | null;
  knockbackImmune: boolean;
}

export interface RoomStateDto {
  roomId: string;
  name: string;
  ownerUserId: string;
  ownerName: string;
  battleId: string | null;
  battleName: string | null;
  phase: RoomPhase;
  slots: RoomSlotState[];
  latestResult: EncounterResult | null;
}

export interface RoomSummaryDto {
  roomId: string;
  name: string;
  battleId: string | null;
  battleName: string | null;
  phase: RoomPhase;
  occupantCount: number;
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

export interface ActorControlCommand {
  type: 'use-knockback-immune';
  payload: UseKnockbackImmunePayload;
}

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
  | UseKnockbackImmunePayload;

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
  | UseKnockbackImmuneSimulationInput;

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
    correctionMode: PositionCorrectionMode;
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
  | BossCastStartedEvent
  | BossCastResolvedEvent
  | AoeSpawnedEvent
  | AoeResolvedEvent
  | DamageAppliedEvent
  | StatusAppliedEvent
  | ActorDiedEvent
  | BattleFailureMarkedEvent
  | EncounterCompletedEvent;

export interface RoomJoinPayload {
  roomId: string;
  userId: string;
  slot?: PartySlot;
  userName?: string;
}

export interface RoomLeavePayload {
  roomId: string;
}

export interface RoomReadyPayload {
  roomId: string;
  ready: boolean;
}

export interface RoomSelectBattlePayload {
  roomId: string;
  battleId: string;
}

export interface RoomSwitchSlotPayload {
  roomId: string;
  targetSlot: PartySlot;
}

export interface RoomStartPayload {
  roomId: string;
}

export interface RoomStatePayload {
  room: RoomStateDto;
}

export interface RoomSlotsPayload {
  roomId: string;
  slots: RoomSlotState[];
}

export interface SimStartPayload {
  roomId: string;
  syncId: number;
  snapshot: SimulationSnapshot;
}

export interface SimSnapshotPayload {
  roomId: string;
  syncId: number;
  snapshot: SimulationSnapshot;
  reason: 'join' | 'rejoin' | 'resync' | 'waiting-state' | 'tick' | 'battle-end' | 'battle-start';
}

export interface SimEventsPayload {
  roomId: string;
  syncId: number;
  events: SimulationEvent[];
}

export interface SimEndPayload {
  roomId: string;
  latestResult: EncounterResult;
}

export interface RoomClosedPayload {
  roomId: string;
  reason: string;
}

export interface SimResyncRequestPayload {
  roomId: string;
  reason?: string;
}

export interface ServerErrorPayload {
  code: string;
  message: string;
}

export interface ServerToClientEvents {
  'room:state': (payload: RoomStatePayload) => void;
  'room:slots': (payload: RoomSlotsPayload) => void;
  'sim:start': (payload: SimStartPayload) => void;
  'sim:snapshot': (payload: SimSnapshotPayload) => void;
  'sim:events': (payload: SimEventsPayload) => void;
  'sim:end': (payload: SimEndPayload) => void;
  'room:closed': (payload: RoomClosedPayload) => void;
  'server:error': (payload: ServerErrorPayload) => void;
}

export interface ClientToServerEvents {
  'room:join': (payload: RoomJoinPayload) => void;
  'room:leave': (payload: RoomLeavePayload) => void;
  'room:ready': (payload: RoomReadyPayload) => void;
  'room:select-battle': (payload: RoomSelectBattlePayload) => void;
  'room:switch-slot': (payload: RoomSwitchSlotPayload) => void;
  'room:start': (payload: RoomStartPayload) => void;
  'sim:input-frame': (payload: ContinuousSimulationInputFrame) => void;
  'sim:use-knockback-immune': (payload: UseKnockbackImmuneSimulationInput) => void;
  'sim:request-resync': (payload: SimResyncRequestPayload) => void;
}

export interface MetricDistributionDto {
  count: number;
  avg: number;
  p95: number;
  max: number;
}

export interface EventCountMetricDto {
  name: string;
  count: number;
  ratePerSec: number;
}

export interface HttpRouteMetricDto {
  method: string;
  route: string;
  requestCount: number;
  errorCount: number;
  errorRate: number;
  ratePerSec: number;
  durationMs: MetricDistributionDto;
  statusCodes: Record<string, number>;
}

export interface SocketMetricsDto {
  connected: number;
  totalConnections: number;
  totalDisconnects: number;
  inboundEvents: EventCountMetricDto[];
  outboundEvents: EventCountMetricDto[];
  errorsByCode: EventCountMetricDto[];
}

export interface ProcessMemoryMetricsDto {
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
}

export interface ProcessMetricsDto {
  uptimeSec: number;
  nodeVersion: string;
  nodeEnv: string;
  memory: ProcessMemoryMetricsDto;
  eventLoopDelayMs: {
    p95: number;
    max: number;
  };
  eventLoopUtilization: number;
}

export interface RoomAggregateMetricsDto {
  total: number;
  waiting: number;
  running: number;
  activeSimulations: number;
  onlinePlayers: number;
  botCount: number;
}

export interface SimulationMetricsDto {
  tickDurationMs: MetricDistributionDto;
  botControllerDurationMs: MetricDistributionDto;
  simulationTickDurationMs: MetricDistributionDto;
  tickOverruns: number;
  inputFrames: number;
  droppedInputFrames: number;
  botControlFrames: number;
  simulationEvents: number;
  snapshots: number;
  resyncRequests: number;
}

export interface RoomRuntimeMetricsDto {
  roomId: string;
  name: string;
  battleName: string | null;
  phase: RoomPhase;
  playerCount: number;
  onlinePlayerCount: number;
  botCount: number;
  activeSimulation: boolean;
  tick: number | null;
  timeMs: number | null;
  syncId: number;
  latestResultPresent: boolean;
  failureReasonCount: number;
  lastActiveAt: number;
  tickDurationMs: MetricDistributionDto;
  botControllerDurationMs: MetricDistributionDto;
  simulationTickDurationMs: MetricDistributionDto;
  tickOverruns: number;
  inputFrames: number;
  droppedInputFrames: number;
  botControlFrames: number;
  simulationEvents: number;
  snapshots: number;
  resyncRequests: number;
}

export interface ServerMetricsLimitsDto {
  windowSec: number;
  bucketSec: number;
  activeRoomLimit: number;
  closedRoomLimit: number;
  estimatedMemoryBudgetMb: number;
  estimatedMemoryCeilingMb: number;
  persistence: 'none';
}

export interface ServerMetricsSnapshotDto {
  collectedAt: number;
  limits: ServerMetricsLimitsDto;
  process: ProcessMetricsDto;
  rooms: RoomAggregateMetricsDto;
  http: {
    routes: HttpRouteMetricDto[];
  };
  socket: SocketMetricsDto;
  simulation: SimulationMetricsDto;
  roomMetrics: RoomRuntimeMetricsDto[];
}
