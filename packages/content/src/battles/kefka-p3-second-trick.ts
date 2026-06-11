import type { BattleDefinition, BattleScriptContext } from '@ff14arena/core';
import { INJURY_UP_MULTIPLIER, createFacingTowards, distance } from '@ff14arena/core';
import type { BaseActorSnapshot, MapMarker, PartySlot, StatusId, Vector2 } from '@ff14arena/shared';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { getStatusDisplayName } from '../status-metadata';

type SlapHand = 'left' | 'right';
type ChaosExplosionMode = 'longitude' | 'latitude';
type ChaosExplosionPhase = 'first' | 'second';
type TerminalShareRoleGroup = 'support' | 'dps';

interface WanderingBossState {
  chaosCenter: Vector2;
  exdeathCenter: Vector2;
  chaosFacing: number;
  exdeathFacing: number;
  chaosLockedUntil: number;
  exdeathLockedUntil: number;
}

interface BlackHole {
  center: Vector2;
  markerResolveAfterMs: number;
  tetherId: string | null;
}

interface ChaosExplosionState {
  mode: ChaosExplosionMode;
  center: Vector2;
  facing: number;
}

interface TargetAssignmentGroup {
  statusId: StatusId;
  actors: BaseActorSnapshot[];
  durationMs: number;
  markerColor: string;
}

interface KefkaAppearanceState {
  kind: 'slap' | 'trueSelf';
  spawnAt: number;
  disappearAt: number;
  position: Vector2;
  facing: number;
  actionId: string;
  actionName: string;
  castStartAt: number;
  castMs: number;
}

interface TerminalCircleState {
  spawnAt: number;
  resolveAt: number;
  centers: Array<{ actorId: string; center: Vector2 }>;
}

interface TerminalShareState {
  index: number;
  assignAt: number;
  resolveAt: number;
  targetId: string;
  roleGroup: TerminalShareRoleGroup;
  center?: Vector2;
}

type VoidErosionTransition =
  | { causesDeath: true }
  | { removeStatusId?: StatusId; applyStatusId: StatusId; causesDeath: false };

const ARENA_RADIUS = 20;
const BOSS_TARGET_RING_RADIUS = 0;
const CENTER = { x: 0, y: 0 } as const satisfies Vector2;
const ZERO_AT = 3_000;
const EARTHQUAKE_CAST_START_AT = 1_000;
const EARTHQUAKE_CAST_MS = 2_000;
const TELEGRAPH_MS = 500;
const VISUAL_MS = 500;
const MECHANIC_DAMAGE = 1;
const INJURY_DURATION_MS = 3_000;
const TERMINAL_INJURY_DURATION_MS = 2_500;
const COMPLETE_AT = 165_000;
const START_TIME_OPTIONS = {
  minMs: 0,
  maxMs: COMPLETE_AT,
  stepMs: 250,
  defaultMs: 0,
} as const;

const CHAOS_MARKER_RADIUS = 0.8;
const CHAOS_TARGET_RING_RADIUS = 6;
const CHAOS_TARGET_RING_COLOR = '#ef4444';
const EXDEATH_MARKER_RADIUS = 0.8;
const EXDEATH_MARKER_COLOR = '#f97316';
const EXDEATH_TARGET_RING_RADIUS = 4;
const EXDEATH_TARGET_RING_COLOR = '#ef4444';
const REPOSITION_INTERVAL_MS = 1_000;
const CHAOS_STABLE_MARKER_ID = 'kefka_p3_second_chaos';
const EXDEATH_STABLE_MARKER_ID = 'kefka_p3_second_exdeath';

const KEFKA_MARKER_RADIUS = 0.9;
const KEFKA_TARGET_RING_RADIUS = 4;
const KEFKA_TARGET_RING_COLOR = '#ef4444';
const OUTSIDE_BOSS_DISTANCE = ARENA_RADIUS + 5;

const SLAP_SPAWN_TO_CAST_MS = 1_000;
const SLAP_CAST_MS = 4_700;
const SLAP_AOE_INTERVAL_MS = 600;
const SLAP_AOE_RADIUS = 13;
const SLAP_FOLLOWUP_DELAY_MS = 2_250;
const SLAP_FAN_RADIUS = 30;
const SLAP_FAN_ANGLE = Math.PI / 3;
const SLAP_ARM_LENGTH = 4;
const SLAP_ARM_WIDTH = 0.6;
const SLAP_MARKER_COLOR = '#e879f9';

const BLACK_HOLE_RADIUS = 2;
const BLACK_HOLE_DISTANCE = 17;
const BLACK_HOLE_SHOT_DELAY_MS = 7_100;
const PERSISTENT_BLACK_HOLE_FIRST_SHOT_DELAY_MS = 7_100;
const PERSISTENT_BLACK_HOLE_REPEAT_INTERVAL_MS = 5_100;
const BLACK_HOLE_BEAM_LENGTH = 40;
const BLACK_HOLE_BEAM_WIDTH = 2;
const BLACK_HOLE_COLOR = '#111827';
const BLACK_HOLE_BEAM_COLOR = '#a855f7';
const FIRST_TARGET_MARKER_COLOR = '#facc15';
const SECOND_TARGET_MARKER_COLOR = '#a855f7';
const THIRD_TARGET_MARKER_COLOR = '#ef4444';

const THUNDER_CAST_MS = 4_700;
const THUNDER_RADIUS = 5;
const THUNDER_SECOND_DELAY_MS = 3_000;

const CURSE_CAST_MS = 4_700;
const CURSE_RADIUS = 30;
const CURSE_ANGLE = Math.PI;
const CHAOS_EXPLOSION_CAST_MS = 4_700;
const CHAOS_EXPLOSION_SECOND_DELAY_MS = 2_000;
const CHAOS_EXPLOSION_FAN_ANGLE = Math.PI / 2;
const CHAOS_EXPLOSION_FAN_RADIUS = 60;

const TRUE_SELF_SPAWN_TO_CAST_MS = 1_700;
const TRUE_SELF_CAST_MS = 4_700;
const TRUE_SELF_LATE_SPAWN_TO_CAST_MS = 2_000;
const TRUE_SELF_LATE_CAST_MS = 4_700;
const TRUE_SELF_LENGTH = 50;
const TRUE_SELF_WIDTH = 10;

const FIRST_SLAP_SPAWN_AT = 12_800;
const FIRST_SLAP_DESPAWN_AT = 40_800;
const FIRST_BLACK_HOLE_CAST_START_AT = 19_400;
const FIRST_THUNDER_CAST_START_AT = 34_800;
const FIRST_CURSE_CAST_START_AT = 42_800;
const SECOND_SLAP_SPAWN_AT = FIRST_CURSE_CAST_START_AT;
const SECOND_SLAP_DESPAWN_AT = 68_000;
const FIRST_PERSISTENT_BLACK_HOLE_SPAWN_AT = 52_600;
const SECOND_CURSE_CAST_START_AT = 70_000;
const FIRST_TRUE_SELF_SPAWN_AT = SECOND_CURSE_CAST_START_AT;
const FIRST_TRUE_SELF_DESPAWN_AT = 104_100;
const SECOND_THUNDER_CAST_START_AT = 76_000;
const SECOND_PERSISTENT_BLACK_HOLE_SPAWN_AT = 86_900;
const THIRD_SLAP_SPAWN_AT = 106_100;
const THIRD_SLAP_DESPAWN_AT = 125_500;
const CHAOS_EXPLOSION_CAST_START_AT = 110_600;
const LATE_BLACK_HOLE_SPAWN_AT = 120_400;
const LATE_BLACK_HOLE_FIRST_SHOT_AT = 127_500;
const LATE_BLACK_HOLE_SECOND_SHOT_AT = 134_600;
const LATE_TRUE_SELF_SPAWN_AT = LATE_BLACK_HOLE_FIRST_SHOT_AT;
const LATE_TRUE_SELF_CAST_START_AT = LATE_BLACK_HOLE_SECOND_SHOT_AT - TRUE_SELF_LATE_CAST_MS;
const LATE_TRUE_SELF_RESOLVE_AT = LATE_BLACK_HOLE_SECOND_SHOT_AT;
const LATE_TRUE_SELF_DESPAWN_AT = 140_100;
const TERMINAL_ARROW_AT = 141_100;
const TERMINAL_ARROW_RADIUS = 1.2;
const TERMINAL_ARROW_COLOR = '#22d3ee';
const TERMINAL_CIRCLE_SPAWN_ATS = [145_100, 148_100] as const;
const TERMINAL_CIRCLE_DELAY_MS = 3_000;
const TERMINAL_CIRCLE_RADIUS = 5;
const TERMINAL_SHARE_ASSIGN_ATS = [145_100, 151_100] as const;
const TERMINAL_SHARE_DELAY_MS = 6_000;
const TERMINAL_SHARE_RADIUS = 4;
const TERMINAL_SHARE_MIN_PLAYERS = 4;
const TERMINAL_SHARE_MARKER_COLOR = '#facc15';
const TERMINAL_TOWER_ATS = [151_100, 152_100, 154_100, 155_100] as const;
const TERMINAL_TOWER_SIDES = ['right', 'left', 'right', 'left'] as const;
const TERMINAL_TOWER_OFFSET = 8;
const TERMINAL_TOWER_RADIUS = 4;
const TERMINAL_TOWER_MIN_PLAYERS = 2;
const TERMINAL_TOWER_VISUAL_MS = 500;
const TERMINAL_MOVEMENT_CHECK_AT = 160_100;
const TERMINAL_SHARE_RETURN_AT = 161_100;

const FIRST_TARGET_STATUS_ID = 'kefka_p3_second_first_target';
const SECOND_TARGET_STATUS_ID = 'kefka_p3_second_second_target';
const THIRD_TARGET_STATUS_ID = 'kefka_p3_second_third_target';
const CHAOS_EARTH_STATUS_ID = 'kefka_p3_second_chaos_earth';
const VOID_EROSION_1_STATUS_ID = 'kefka_p3_second_void_erosion_1';
const VOID_EROSION_2_STATUS_ID = 'kefka_p3_second_void_erosion_2';
const VOID_CORROSION_STATUS_ID = 'kefka_p3_second_void_corrosion';
const KEFKA_P3_MT_PULLS_EXDEATH_OPTION_KEY = 'kefkaP3MtPullsExdeath';
const KEFKA_P3_ROOM_OPTIONS = [
  {
    key: KEFKA_P3_MT_PULLS_EXDEATH_OPTION_KEY,
    type: 'boolean',
    title: 'MT拉艾克斯迪斯',
    description: '开启时艾克斯迪斯追踪 MT、卡奥斯追踪 ST；关闭时两者目标互换。',
    defaultValue: false,
  },
] as const satisfies NonNullable<BattleDefinition['roomOptions']>;

const TANK_SLOTS = ['MT', 'ST'] as const satisfies readonly PartySlot[];
const HEALER_SLOTS = ['H1', 'H2'] as const satisfies readonly PartySlot[];
const DPS_SLOTS = ['D1', 'D2', 'D3', 'D4'] as const satisfies readonly PartySlot[];

const INITIAL_POSITIONS: Record<PartySlot, Vector2> = {
  MT: { x: -4.2, y: 12 },
  ST: { x: -3, y: 12 },
  H1: { x: -1.8, y: 12 },
  H2: { x: -0.6, y: 12 },
  D1: { x: 0.6, y: 12 },
  D2: { x: 1.8, y: 12 },
  D3: { x: 3, y: 12 },
  D4: { x: 4.2, y: 12 },
};

const MARKER_CORNER_DISTANCE = 12;
const MARKER_COLORS = {
  red: '#ef4444',
  yellow: '#f4d35e',
  cyan: '#7dd3fc',
  purple: '#a78bfa',
} as const;

const KEFKA_MAP_MARKERS: MapMarker[] = [
  {
    label: 'A',
    shape: 'circle',
    color: MARKER_COLORS.red,
    position: { x: 0, y: -MARKER_CORNER_DISTANCE },
    radius: 1.25,
  },
  {
    label: '2',
    shape: 'square',
    color: MARKER_COLORS.yellow,
    position: { x: MARKER_CORNER_DISTANCE, y: -MARKER_CORNER_DISTANCE },
    size: 2.2,
  },
  {
    label: 'B',
    shape: 'circle',
    color: MARKER_COLORS.yellow,
    position: { x: MARKER_CORNER_DISTANCE, y: 0 },
    radius: 1.25,
  },
  {
    label: '3',
    shape: 'square',
    color: MARKER_COLORS.cyan,
    position: { x: MARKER_CORNER_DISTANCE, y: MARKER_CORNER_DISTANCE },
    size: 2.2,
  },
  {
    label: 'C',
    shape: 'circle',
    color: MARKER_COLORS.cyan,
    position: { x: 0, y: MARKER_CORNER_DISTANCE },
    radius: 1.25,
  },
  {
    label: '4',
    shape: 'square',
    color: MARKER_COLORS.purple,
    position: { x: -MARKER_CORNER_DISTANCE, y: MARKER_CORNER_DISTANCE },
    size: 2.2,
  },
  {
    label: 'D',
    shape: 'circle',
    color: MARKER_COLORS.purple,
    position: { x: -MARKER_CORNER_DISTANCE, y: 0 },
    radius: 1.25,
  },
  {
    label: '1',
    shape: 'square',
    color: MARKER_COLORS.red,
    position: { x: -MARKER_CORNER_DISTANCE, y: -MARKER_CORNER_DISTANCE },
    size: 2.2,
  },
];

function shuffle<T>(values: readonly T[]): T[] {
  const shuffled = [...values];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }

  return shuffled;
}

function getActorBySlot(actors: BaseActorSnapshot[], slot: PartySlot): BaseActorSnapshot {
  const actor = actors.find((candidate) => candidate.slot === slot);

  if (actor === undefined) {
    throw new Error(`missing actor for slot ${slot}`);
  }

  return actor;
}

function getActorById(actors: BaseActorSnapshot[], actorId: string): BaseActorSnapshot | null {
  return actors.find((actor) => actor.id === actorId) ?? null;
}

function getFreshActor(ctx: BattleScriptContext, actorId: string): BaseActorSnapshot | null {
  return getActorById(ctx.select.allPlayers(), actorId);
}

function hasStatus(actor: BaseActorSnapshot, statusId: StatusId): boolean {
  return actor.statuses.some((status) => status.id === statusId);
}

function getVoidErosionTransition(statusIds: readonly StatusId[]): VoidErosionTransition {
  if (statusIds.includes(VOID_CORROSION_STATUS_ID)) {
    return { causesDeath: true };
  }

  if (statusIds.includes(VOID_EROSION_2_STATUS_ID)) {
    return {
      removeStatusId: VOID_EROSION_2_STATUS_ID,
      applyStatusId: VOID_CORROSION_STATUS_ID,
      causesDeath: false,
    };
  }

  if (statusIds.includes(VOID_EROSION_1_STATUS_ID)) {
    return {
      removeStatusId: VOID_EROSION_1_STATUS_ID,
      applyStatusId: VOID_CORROSION_STATUS_ID,
      causesDeath: false,
    };
  }

  return {
    applyStatusId: VOID_EROSION_1_STATUS_ID,
    causesDeath: false,
  };
}

function getActorsInsideCircle(
  actors: BaseActorSnapshot[],
  center: Vector2,
  radius: number,
): BaseActorSnapshot[] {
  return actors.filter(
    (actor) => actor.mechanicActive && distance(actor.position, center) <= radius,
  );
}

function normalizeAngle(angle: number): number {
  const normalized = angle % (Math.PI * 2);

  return normalized < 0 ? normalized + Math.PI * 2 : normalized;
}

function getAngleDiff(left: number, right: number): number {
  const diff = Math.abs(normalizeAngle(left) - normalizeAngle(right)) % (Math.PI * 2);

  return diff > Math.PI ? Math.PI * 2 - diff : diff;
}

function isActorInsideFan(
  actor: BaseActorSnapshot,
  center: Vector2,
  direction: number,
  angle: number,
  radius: number,
): boolean {
  if (!actor.mechanicActive || distance(actor.position, center) > radius) {
    return false;
  }

  if (distance(actor.position, center) <= 0.0001) {
    return true;
  }

  return (
    getAngleDiff(Math.atan2(actor.position.y - center.y, actor.position.x - center.x), direction) <=
    angle / 2
  );
}

function isActorInsideRectangle(
  actor: BaseActorSnapshot,
  source: Vector2,
  direction: number,
  length: number,
  width: number,
): boolean {
  if (!actor.mechanicActive) {
    return false;
  }

  const relative = {
    x: actor.position.x - source.x,
    y: actor.position.y - source.y,
  };
  const forward = {
    x: Math.cos(direction),
    y: Math.sin(direction),
  };
  const projection = relative.x * forward.x + relative.y * forward.y;

  if (projection < 0 || projection > length) {
    return false;
  }

  const lateral = Math.abs(relative.x * -forward.y + relative.y * forward.x);

  return lateral <= width / 2;
}

function createPointOnDirection(direction: number, radius: number): Vector2 {
  return {
    x: Math.cos(direction) * radius,
    y: Math.sin(direction) * radius,
  };
}

function createPointFromLocal(origin: Vector2, facing: number, local: Vector2): Vector2 {
  const right = { x: Math.cos(facing + Math.PI / 2), y: Math.sin(facing + Math.PI / 2) };
  const forward = { x: Math.cos(facing), y: Math.sin(facing) };

  return {
    x: origin.x + right.x * local.x + forward.x * local.y,
    y: origin.y + right.y * local.x + forward.y * local.y,
  };
}

function createPointFromArenaLocal(northDirection: number, local: Vector2): Vector2 {
  const north = { x: Math.cos(northDirection), y: Math.sin(northDirection) };
  const east = {
    x: Math.cos(northDirection + Math.PI / 2),
    y: Math.sin(northDirection + Math.PI / 2),
  };

  return {
    x: CENTER.x + east.x * local.x - north.x * local.y,
    y: CENTER.y + east.y * local.x - north.y * local.y,
  };
}

function applyStatus(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  statusId: StatusId,
  durationMs: number,
): void {
  ctx.status.apply([actor.id], statusId, durationMs, {
    name: getStatusDisplayName(statusId),
  });
}

function applyStatusUntil(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  statusId: StatusId,
  expiresAt: number,
): void {
  const remainingMs = expiresAt - ctx.state.getBattleTime();

  if (remainingMs <= 0) {
    return;
  }

  applyStatus(ctx, actor, statusId, remainingMs);
}

function applySecondTrickDeath(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  sourceLabel: string,
): void {
  const freshActor = getFreshActor(ctx, actor.id);

  if (freshActor === null || !freshActor.mechanicActive) {
    return;
  }

  if (hasStatus(freshActor, CHAOS_EARTH_STATUS_ID)) {
    ctx.status.remove([freshActor.id], CHAOS_EARTH_STATUS_ID);
    ctx.timeline.after(1_000, () => {
      for (const target of ctx.select.allPlayers()) {
        if (target.id !== freshActor.id) {
          applySecondTrickDamage(ctx, target, '混沌之土');
        }
      }
    });
    return;
  }

  ctx.damage.kill([freshActor.id], sourceLabel);
}

function applySecondTrickDamage(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  sourceLabel: string,
): void {
  const freshActor = getFreshActor(ctx, actor.id);

  if (freshActor === null || !freshActor.mechanicActive) {
    return;
  }

  if (hasStatus(freshActor, 'injury_up')) {
    applySecondTrickDeath(ctx, freshActor, sourceLabel);
    return;
  }

  ctx.damage.apply([freshActor.id], MECHANIC_DAMAGE, sourceLabel);
  ctx.status.apply([freshActor.id], 'injury_up', INJURY_DURATION_MS, {
    multiplier: INJURY_UP_MULTIPLIER,
    name: getStatusDisplayName('injury_up'),
  });
}

function isSupportActor(actor: BaseActorSnapshot): boolean {
  return (
    actor.slot !== null &&
    ([...TANK_SLOTS, ...HEALER_SLOTS] as readonly PartySlot[]).includes(actor.slot)
  );
}

function getTerminalShareCandidates(
  actors: BaseActorSnapshot[],
  roleGroup: TerminalShareRoleGroup,
): BaseActorSnapshot[] {
  return actors.filter((actor) =>
    roleGroup === 'support'
      ? isSupportActor(actor)
      : actor.slot !== null && (DPS_SLOTS as readonly PartySlot[]).includes(actor.slot),
  );
}

function grantTerminalInjuryUntil(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  expiresAt: number,
  sourceLabel: string,
): void {
  const freshActor = getFreshActor(ctx, actor.id);
  const remainingMs = expiresAt - ctx.state.getBattleTime();

  if (freshActor === null || !freshActor.mechanicActive || remainingMs <= 0) {
    return;
  }

  if (hasStatus(freshActor, 'injury_up')) {
    applySecondTrickDeath(ctx, freshActor, sourceLabel);
    return;
  }

  ctx.status.apply([freshActor.id], 'injury_up', remainingMs, {
    multiplier: INJURY_UP_MULTIPLIER,
    name: getStatusDisplayName('injury_up'),
  });
}

function grantTerminalInjury(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  sourceLabel: string,
): void {
  grantTerminalInjuryUntil(
    ctx,
    actor,
    ctx.state.getBattleTime() + TERMINAL_INJURY_DURATION_MS,
    sourceLabel,
  );
}

function isTankActor(actor: BaseActorSnapshot): boolean {
  return actor.slot === 'MT' || actor.slot === 'ST';
}

function orderFirstTargetActors(actors: BaseActorSnapshot[]): BaseActorSnapshot[] {
  const tankIndexes = actors
    .map((actor, index) => (isTankActor(actor) ? index : -1))
    .filter((index) => index >= 0);
  const preferredMarkerIndex = 2;

  if (tankIndexes.length === 0 || tankIndexes.includes(preferredMarkerIndex)) {
    return actors;
  }

  const orderedActors = [...actors];
  const tankIndex = tankIndexes[tankIndexes.length - 1]!;

  [orderedActors[tankIndex], orderedActors[preferredMarkerIndex]] = [
    orderedActors[preferredMarkerIndex]!,
    orderedActors[tankIndex]!,
  ];

  return orderedActors;
}

function createTargetAssignmentGroups(ctx: BattleScriptContext): TargetAssignmentGroup[] {
  const actors = shuffle(ctx.select.allPlayers());
  const groups = [
    {
      statusId: FIRST_TARGET_STATUS_ID,
      count: 3,
      durationMs: 72_000,
      markerColor: FIRST_TARGET_MARKER_COLOR,
    },
    {
      statusId: SECOND_TARGET_STATUS_ID,
      count: 3,
      durationMs: 106_000,
      markerColor: SECOND_TARGET_MARKER_COLOR,
    },
    {
      statusId: THIRD_TARGET_STATUS_ID,
      count: 2,
      durationMs: 139_000,
      markerColor: THIRD_TARGET_MARKER_COLOR,
    },
  ] as const;
  let cursor = 0;

  return groups.map((group) => {
    const assignedActors = actors.slice(cursor, cursor + group.count);
    cursor += group.count;

    return {
      statusId: group.statusId,
      actors:
        group.statusId === FIRST_TARGET_STATUS_ID
          ? orderFirstTargetActors(assignedActors)
          : assignedActors,
      durationMs: group.durationMs,
      markerColor: group.markerColor,
    };
  });
}

function applyTargetAssignmentGroups(
  ctx: BattleScriptContext,
  groups: TargetAssignmentGroup[],
  startTimeMs = ZERO_AT,
): void {
  for (const group of groups) {
    const expiresAt = ZERO_AT + group.durationMs;

    if (startTimeMs >= expiresAt) {
      continue;
    }

    for (const [index, actor] of group.actors.entries()) {
      applyStatusUntil(ctx, actor, group.statusId, expiresAt);
      applyStatusUntil(ctx, actor, CHAOS_EARTH_STATUS_ID, expiresAt);
      ctx.spawn.actorMarker({
        label: `${index + 1}`,
        target: actor,
        markerShape: 'numberCircle',
        color: group.markerColor,
        resolveAfterMs: expiresAt - ctx.state.getBattleTime(),
      });
    }
  }
}

function assignInitialStatuses(ctx: BattleScriptContext): void {
  applyTargetAssignmentGroups(ctx, createTargetAssignmentGroups(ctx));
}

function calculateFollowerCenter(current: Vector2, target: Vector2, offset: number): Vector2 {
  const targetDistance = distance(current, target);

  if (targetDistance <= offset) {
    return { ...current };
  }

  const scaleFromTarget = offset / targetDistance;

  return {
    x: target.x + (current.x - target.x) * scaleFromTarget,
    y: target.y + (current.y - target.y) * scaleFromTarget,
  };
}

function getWanderingBossState(ctx: BattleScriptContext): WanderingBossState {
  return (
    ctx.state.getValue<WanderingBossState>('kefkaP3Second:wanderingBosses') ?? {
      chaosCenter: CENTER,
      exdeathCenter: CENTER,
      chaosFacing: 0,
      exdeathFacing: 0,
      chaosLockedUntil: 0,
      exdeathLockedUntil: 0,
    }
  );
}

function setWanderingBossState(ctx: BattleScriptContext, state: WanderingBossState): void {
  ctx.state.setValue('kefkaP3Second:wanderingBosses', state);
}

function spawnChaosMarker(
  ctx: BattleScriptContext,
  center: Vector2,
  resolveAfterMs: number,
  direction = getWanderingBossState(ctx).chaosFacing,
): void {
  ctx.spawn.stageActor({
    label: '卡奥斯',
    center,
    shape: 'enemy',
    stableId: CHAOS_STABLE_MARKER_ID,
    radius: CHAOS_MARKER_RADIUS,
    direction,
    targetRingRadius: CHAOS_TARGET_RING_RADIUS,
    targetRingColor: CHAOS_TARGET_RING_COLOR,
    resolveAfterMs,
  });
}

function spawnExdeathMarker(
  ctx: BattleScriptContext,
  center: Vector2,
  resolveAfterMs: number,
  direction = getWanderingBossState(ctx).exdeathFacing,
): void {
  ctx.spawn.stageActor({
    label: '艾克斯迪斯',
    center,
    shape: 'enemy',
    stableId: EXDEATH_STABLE_MARKER_ID,
    radius: EXDEATH_MARKER_RADIUS,
    direction,
    color: EXDEATH_MARKER_COLOR,
    targetRingRadius: EXDEATH_TARGET_RING_RADIUS,
    targetRingColor: EXDEATH_TARGET_RING_COLOR,
    resolveAfterMs,
  });
}

function doesMtPullExdeath(ctx: BattleScriptContext): boolean {
  return ctx.roomOptions.boolean(KEFKA_P3_MT_PULLS_EXDEATH_OPTION_KEY);
}

function getExdeathFollowSlot(ctx: BattleScriptContext): PartySlot {
  return doesMtPullExdeath(ctx) ? 'MT' : 'ST';
}

function getChaosFollowSlot(ctx: BattleScriptContext): PartySlot {
  return doesMtPullExdeath(ctx) ? 'ST' : 'MT';
}

function repositionWanderingBosses(ctx: BattleScriptContext): void {
  const state = getWanderingBossState(ctx);
  const battleTime = ctx.state.getBattleTime();
  let nextState = state;

  if (battleTime >= state.chaosLockedUntil) {
    const st = getActorBySlot(ctx.select.allPlayers(), getChaosFollowSlot(ctx));
    const chaosCenter = calculateFollowerCenter(
      state.chaosCenter,
      st.position,
      CHAOS_TARGET_RING_RADIUS,
    );
    const chaosFacing =
      distance(chaosCenter, st.position) <= 0.0001
        ? state.chaosFacing
        : createFacingTowards(chaosCenter, st.position);
    nextState = {
      ...nextState,
      chaosCenter,
      chaosFacing,
    };
    spawnChaosMarker(ctx, nextState.chaosCenter, REPOSITION_INTERVAL_MS, chaosFacing);
  }

  if (battleTime >= state.exdeathLockedUntil) {
    const mt = getActorBySlot(ctx.select.allPlayers(), getExdeathFollowSlot(ctx));
    const exdeathCenter = calculateFollowerCenter(
      state.exdeathCenter,
      mt.position,
      EXDEATH_TARGET_RING_RADIUS,
    );
    const exdeathFacing =
      distance(exdeathCenter, mt.position) <= 0.0001
        ? state.exdeathFacing
        : createFacingTowards(exdeathCenter, mt.position);
    nextState = {
      ...nextState,
      exdeathCenter,
      exdeathFacing,
    };
    spawnExdeathMarker(ctx, nextState.exdeathCenter, REPOSITION_INTERVAL_MS, exdeathFacing);
  }

  setWanderingBossState(ctx, nextState);
}

function lockChaosUntil(
  ctx: BattleScriptContext,
  lockedUntil: number,
  direction = getWanderingBossState(ctx).chaosFacing,
): void {
  const state = getWanderingBossState(ctx);
  setWanderingBossState(ctx, { ...state, chaosFacing: direction, chaosLockedUntil: lockedUntil });
}

function lockExdeathUntil(
  ctx: BattleScriptContext,
  lockedUntil: number,
  direction = getWanderingBossState(ctx).exdeathFacing,
): void {
  const state = getWanderingBossState(ctx);
  setWanderingBossState(ctx, {
    ...state,
    exdeathFacing: direction,
    exdeathLockedUntil: lockedUntil,
  });
}

function selectNearestActor(
  actors: BaseActorSnapshot[],
  center: Vector2,
): BaseActorSnapshot | null {
  return (
    actors
      .filter((actor) => actor.mechanicActive)
      .sort((left, right) => {
        const distanceDiff = distance(left.position, center) - distance(right.position, center);

        if (Math.abs(distanceDiff) > 0.0001) {
          return distanceDiff;
        }

        return PARTY_SLOT_ORDER.indexOf(left.slot!) - PARTY_SLOT_ORDER.indexOf(right.slot!);
      })[0] ?? null
  );
}

function selectRandomActorBySlots(
  actors: BaseActorSnapshot[],
  slots: readonly PartySlot[],
): BaseActorSnapshot | null {
  return (
    shuffle(actors.filter((actor) => actor.mechanicActive && slots.includes(actor.slot!)))[0] ??
    null
  );
}

function spawnKefkaMarker(ctx: BattleScriptContext, center: Vector2, resolveAfterMs: number): void {
  ctx.spawn.fieldMarker({
    label: '凯夫卡',
    center,
    shape: 'enemy',
    radius: KEFKA_MARKER_RADIUS,
    direction: createFacingTowards(center, CENTER),
    color: '#c084fc',
    targetRingRadius: KEFKA_TARGET_RING_RADIUS,
    targetRingColor: KEFKA_TARGET_RING_COLOR,
    resolveAfterMs,
  });
}

function getKefkaAppearances(ctx: BattleScriptContext): KefkaAppearanceState[] {
  return ctx.state.getValue<KefkaAppearanceState[]>('kefkaP3Second:kefkaAppearances') ?? [];
}

function recordKefkaAppearance(ctx: BattleScriptContext, appearance: KefkaAppearanceState): void {
  ctx.state.setValue('kefkaP3Second:kefkaAppearances', [...getKefkaAppearances(ctx), appearance]);
}

function createOutsideKefkaPosition(): Vector2 {
  const direction = Math.floor(Math.random() * 8) * (Math.PI / 4);

  return createPointOnDirection(direction, OUTSIDE_BOSS_DISTANCE);
}

function calculateSlapAoeCenter(kefkaPosition: Vector2, hand: SlapHand, localY: number): Vector2 {
  const kefkaDirection = createFacingTowards(CENTER, kefkaPosition);
  const localX = hand === 'right' ? -10 : 10;

  return createPointFromArenaLocal(kefkaDirection, { x: localX, y: localY });
}

function spawnCircleDamageWithTelegraph(
  ctx: BattleScriptContext,
  label: string,
  center: Vector2,
  radius: number,
  resolveAt: number,
  damage: 'normal' | 'lethal',
): void {
  ctx.timeline.at(resolveAt - TELEGRAPH_MS, () => {
    ctx.spawn.circleTelegraph({
      label,
      center,
      radius,
      resolveAfterMs: TELEGRAPH_MS,
    });
  });
  ctx.timeline.at(resolveAt, () => {
    for (const hit of getActorsInsideCircle(ctx.select.allPlayers(), center, radius)) {
      if (damage === 'normal') {
        applySecondTrickDamage(ctx, hit, label);
      } else {
        applySecondTrickDeath(ctx, hit, label);
      }
    }
  });
}

function resolveFanDamage(
  ctx: BattleScriptContext,
  label: string,
  direction: number,
  damage: 'normal' | 'lethal',
  requiredPlayers?: number,
): void {
  const hits = ctx.select
    .allPlayers()
    .filter((actor) => isActorInsideFan(actor, CENTER, direction, SLAP_FAN_ANGLE, SLAP_FAN_RADIUS));

  if (requiredPlayers !== undefined && hits.length < requiredPlayers) {
    ctx.state.fail(`${label}分摊人数不足`);
    for (const hit of hits) {
      applySecondTrickDeath(ctx, hit, `${label}分摊人数不足`);
    }
    return;
  }

  for (const hit of hits) {
    if (damage === 'normal') {
      applySecondTrickDamage(ctx, hit, label);
    } else {
      applySecondTrickDeath(ctx, hit, label);
    }
  }
}

function scheduleSlap(
  ctx: BattleScriptContext,
  spawnAt: number,
  castDelayMs = SLAP_SPAWN_TO_CAST_MS,
  markerDespawnAt?: number,
): void {
  const position = createOutsideKefkaPosition();
  const facing = createFacingTowards(position, CENTER);
  const hand: SlapHand = Math.random() < 0.5 ? 'left' : 'right';
  const castStartAt = spawnAt + castDelayMs;
  const resolveStartAt = castStartAt + SLAP_CAST_MS;
  const followupAt = resolveStartAt + SLAP_AOE_INTERVAL_MS * 2 + SLAP_FOLLOWUP_DELAY_MS;
  const disappearAt = markerDespawnAt ?? followupAt + 1_000;
  const actionId = `kefka_p3_second_slap_${spawnAt}`;

  recordKefkaAppearance(ctx, {
    kind: 'slap',
    spawnAt,
    disappearAt,
    position,
    facing,
    actionId,
    actionName: '响亮亮耳光',
    castStartAt,
    castMs: SLAP_CAST_MS,
  });

  ctx.timeline.at(spawnAt, () => {
    spawnKefkaMarker(ctx, position, disappearAt - spawnAt);
  });

  ctx.timeline.at(castStartAt, () => {
    const handSign = hand === 'right' ? 1 : -1;
    const armCenter = createPointFromLocal(position, facing, {
      x: handSign * 1.2,
      y: 0,
    });

    ctx.boss.cast(actionId, '响亮亮耳光', SLAP_CAST_MS);
    ctx.spawn.rectangleTelegraph({
      label: '响亮亮耳光手臂',
      center: armCenter,
      direction: facing + handSign * (Math.PI / 2),
      length: SLAP_ARM_LENGTH,
      width: SLAP_ARM_WIDTH,
      color: SLAP_MARKER_COLOR,
      resolveAfterMs: SLAP_CAST_MS,
    });
  });

  for (const [index, localY] of [-10, 0, 10].entries()) {
    const center = calculateSlapAoeCenter(position, hand, localY);
    spawnCircleDamageWithTelegraph(
      ctx,
      '响亮亮耳光范围',
      center,
      SLAP_AOE_RADIUS,
      resolveStartAt + index * SLAP_AOE_INTERVAL_MS,
      'normal',
    );
  }

  ctx.timeline.at(followupAt - TELEGRAPH_MS, () => {
    if (hand === 'right') {
      const target = shuffle(ctx.select.allPlayers().filter((actor) => actor.mechanicActive))[0];

      if (target === undefined) {
        return;
      }

      const direction = createFacingTowards(CENTER, target.position);
      ctx.state.setValue(`kefkaP3Second:slapStack:${spawnAt}`, target.id);
      ctx.spawn.fanTelegraph({
        label: '响亮亮耳光分摊',
        center: CENTER,
        direction,
        angle: SLAP_FAN_ANGLE,
        radius: SLAP_FAN_RADIUS,
        resolveAfterMs: TELEGRAPH_MS,
      });
    } else {
      const actors = ctx.select.allPlayers();
      const targets = [
        selectRandomActorBySlots(actors, TANK_SLOTS),
        selectRandomActorBySlots(actors, HEALER_SLOTS),
        selectRandomActorBySlots(actors, DPS_SLOTS),
      ].filter((actor): actor is BaseActorSnapshot => actor !== null);

      ctx.state.setValue(
        `kefkaP3Second:slapSpread:${spawnAt}`,
        targets.map((target) => target.id),
      );

      for (const target of targets) {
        ctx.spawn.fanTelegraph({
          label: '响亮亮耳光扇形',
          center: CENTER,
          direction: createFacingTowards(CENTER, target.position),
          angle: SLAP_FAN_ANGLE,
          radius: SLAP_FAN_RADIUS,
          resolveAfterMs: TELEGRAPH_MS,
        });
      }
    }
  });

  ctx.timeline.at(followupAt, () => {
    if (hand === 'right') {
      const targetId = ctx.state.getValue<string>(`kefkaP3Second:slapStack:${spawnAt}`);
      const target = targetId === undefined ? null : getFreshActor(ctx, targetId);

      if (target === null || !target.mechanicActive) {
        return;
      }

      resolveFanDamage(
        ctx,
        '响亮亮耳光分摊',
        createFacingTowards(CENTER, target.position),
        'normal',
        8,
      );
      return;
    }

    const targetIds = ctx.state.getValue<string[]>(`kefkaP3Second:slapSpread:${spawnAt}`) ?? [];

    for (const targetId of targetIds) {
      const target = getFreshActor(ctx, targetId);

      if (target !== null && target.mechanicActive) {
        resolveFanDamage(
          ctx,
          '响亮亮耳光扇形',
          createFacingTowards(CENTER, target.position),
          'normal',
        );
      }
    }
  });
}

function createBlackHoleCenters(): Vector2[] {
  const cardinalDirections = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];

  return shuffle(cardinalDirections)
    .slice(0, 3)
    .map((direction) => createPointOnDirection(direction, BLACK_HOLE_DISTANCE));
}

function getBlackHoleCardinalIndex(center: Vector2): number {
  const angle = normalizeAngle(Math.atan2(center.y, center.x));
  const cardinalAngles = [Math.PI * 1.5, 0, Math.PI / 2, Math.PI];

  return cardinalAngles
    .map((cardinalAngle, index) => ({
      index,
      diff: getAngleDiff(angle, cardinalAngle),
    }))
    .sort((left, right) => left.diff - right.diff)[0]!.index;
}

function selectAdjacentBlackHolePair(holes: readonly BlackHole[]): readonly [BlackHole, BlackHole] {
  const indexedHoles = holes.map((hole) => ({
    hole,
    cardinalIndex: getBlackHoleCardinalIndex(hole.center),
  }));

  for (const left of indexedHoles) {
    const right = indexedHoles.find(
      (candidate) =>
        candidate !== left &&
        ((candidate.cardinalIndex + 4 - left.cardinalIndex) % 4 === 1 ||
          (left.cardinalIndex + 4 - candidate.cardinalIndex) % 4 === 1),
    );

    if (right !== undefined) {
      return [left.hole, right.hole];
    }
  }

  return [holes[0]!, holes[1]!];
}

function spawnBlackHoleMarker(
  ctx: BattleScriptContext,
  center: Vector2,
  resolveAfterMs: number,
): void {
  ctx.spawn.fieldMarker({
    label: '黑洞',
    center,
    shape: 'circle',
    radius: BLACK_HOLE_RADIUS,
    color: BLACK_HOLE_COLOR,
    resolveAfterMs,
  });
}

function spawnBlackHoleTether(
  ctx: BattleScriptContext,
  hole: BlackHole,
  resolveAfterMs: number,
): string | null {
  const target = shuffle(ctx.select.allPlayers().filter((actor) => actor.mechanicActive))[0];

  if (target === undefined) {
    return null;
  }

  const tether = ctx.spawn.tether({
    label: '黑洞连线',
    target,
    sourcePosition: hole.center,
    allowTransfer: true,
    allowDeadRetarget: true,
    preventTargetHoldingOtherTether: false,
    resolveAfterMs: resolveAfterMs + 50,
  });

  return tether.id;
}

function applyVoidErosion(ctx: BattleScriptContext, actor: BaseActorSnapshot): void {
  const freshActor = getFreshActor(ctx, actor.id);

  if (freshActor === null || !freshActor.mechanicActive) {
    return;
  }

  const transition = getVoidErosionTransition(freshActor.statuses.map((status) => status.id));

  if (transition.causesDeath) {
    applySecondTrickDeath(ctx, freshActor, '无之腐蚀');
    return;
  }

  if (transition.removeStatusId !== undefined) {
    ctx.status.remove([freshActor.id], transition.removeStatusId);
  }

  applyStatus(ctx, freshActor, transition.applyStatusId, 999_000);
}

function lockBlackHoleShot(ctx: BattleScriptContext, hole: BlackHole, shotKey: string): void {
  if (hole.tetherId === null) {
    return;
  }

  const tether = ctx.mechanics
    .all()
    .find((mechanic) => mechanic.kind === 'tether' && mechanic.id === hole.tetherId);

  if (tether === undefined || tether.kind !== 'tether') {
    return;
  }

  const target = getFreshActor(ctx, tether.targetId);

  if (target === null || !target.mechanicActive) {
    return;
  }

  const direction = createFacingTowards(hole.center, target.position);
  ctx.state.setValue(`kefkaP3Second:blackHoleShot:${shotKey}`, direction);
  ctx.spawn.rectangleTelegraph({
    label: '黑洞射线',
    center: hole.center,
    direction,
    length: BLACK_HOLE_BEAM_LENGTH,
    width: BLACK_HOLE_BEAM_WIDTH,
    color: BLACK_HOLE_BEAM_COLOR,
    resolveAfterMs: VISUAL_MS,
  });
}

function resolveBlackHoleShot(ctx: BattleScriptContext, hole: BlackHole, shotKey: string): void {
  const direction = ctx.state.getValue<number>(`kefkaP3Second:blackHoleShot:${shotKey}`);

  if (direction === undefined) {
    return;
  }

  for (const hit of ctx.select
    .allPlayers()
    .filter((actor) =>
      isActorInsideRectangle(
        actor,
        hole.center,
        direction,
        BLACK_HOLE_BEAM_LENGTH,
        BLACK_HOLE_BEAM_WIDTH,
      ),
    )) {
    applyVoidErosion(ctx, hit);
  }
}

function scheduleBlackHoleShot(
  ctx: BattleScriptContext,
  hole: BlackHole,
  resolveAt: number,
  shotKey: string,
): void {
  ctx.timeline.at(resolveAt - TELEGRAPH_MS, () => {
    lockBlackHoleShot(ctx, hole, shotKey);
  });
  ctx.timeline.at(resolveAt, () => {
    resolveBlackHoleShot(ctx, hole, shotKey);
  });
}

function scheduleFirstBlackHoles(ctx: BattleScriptContext): void {
  const castStartAt = FIRST_BLACK_HOLE_CAST_START_AT;
  const spawnAt = castStartAt + 2_700;

  ctx.timeline.at(castStartAt, () => {
    ctx.boss.cast('kefka_p3_second_black_hole_1', '黑洞', 2_700);
  });

  ctx.timeline.at(spawnAt, () => {
    const firstHoleIndex = Math.floor(Math.random() * 3);
    const holes = createBlackHoleCenters().map((center, index): BlackHole => {
      const markerResolveAfterMs =
        index === firstHoleIndex
          ? BLACK_HOLE_SHOT_DELAY_MS + 100
          : BLACK_HOLE_SHOT_DELAY_MS * 2 + 100;
      const hole: BlackHole = {
        center,
        markerResolveAfterMs,
        tetherId: null,
      };
      spawnBlackHoleMarker(ctx, center, markerResolveAfterMs);
      return hole;
    });
    const firstHole = holes[firstHoleIndex];

    if (firstHole === undefined) {
      return;
    }

    firstHole.tetherId = spawnBlackHoleTether(ctx, firstHole, BLACK_HOLE_SHOT_DELAY_MS);

    scheduleBlackHoleShot(ctx, firstHole, spawnAt + BLACK_HOLE_SHOT_DELAY_MS, 'first:0');
    ctx.timeline.after(BLACK_HOLE_SHOT_DELAY_MS, () => {
      for (const hole of holes.filter((candidate) => candidate !== firstHole)) {
        hole.tetherId = spawnBlackHoleTether(ctx, hole, BLACK_HOLE_SHOT_DELAY_MS);
      }
    });

    holes
      .filter((candidate) => candidate !== firstHole)
      .forEach((hole, index) => {
        scheduleBlackHoleShot(
          ctx,
          hole,
          spawnAt + BLACK_HOLE_SHOT_DELAY_MS * 2,
          `first:${index + 1}`,
        );
      });
  });
}

function schedulePersistentBlackHoles(
  ctx: BattleScriptContext,
  spawnAt: number,
  shotKeyPrefix: string,
): void {
  ctx.timeline.at(spawnAt, () => {
    const shotAts = [
      spawnAt + PERSISTENT_BLACK_HOLE_FIRST_SHOT_DELAY_MS,
      spawnAt +
        PERSISTENT_BLACK_HOLE_FIRST_SHOT_DELAY_MS +
        PERSISTENT_BLACK_HOLE_REPEAT_INTERVAL_MS,
      spawnAt +
        PERSISTENT_BLACK_HOLE_FIRST_SHOT_DELAY_MS +
        PERSISTENT_BLACK_HOLE_REPEAT_INTERVAL_MS * 2,
    ];
    const finalShotAt = shotAts[shotAts.length - 1]!;
    const holes = createBlackHoleCenters().map((center): BlackHole => {
      const hole: BlackHole = {
        center,
        markerResolveAfterMs: finalShotAt - spawnAt + 100,
        tetherId: null,
      };
      spawnBlackHoleMarker(ctx, center, hole.markerResolveAfterMs);
      hole.tetherId = spawnBlackHoleTether(ctx, hole, finalShotAt - spawnAt);
      return hole;
    });

    for (const [shotIndex, shotAt] of shotAts.entries()) {
      holes.forEach((hole, holeIndex) => {
        scheduleBlackHoleShot(ctx, hole, shotAt, `${shotKeyPrefix}:${shotIndex + 1}:${holeIndex}`);
      });
    }
  });
}

function scheduleLateSplitBlackHoles(ctx: BattleScriptContext): void {
  const spawnAt = LATE_BLACK_HOLE_SPAWN_AT;

  ctx.timeline.at(spawnAt, () => {
    const holes = createBlackHoleCenters().map((center): BlackHole => {
      return {
        center,
        markerResolveAfterMs: 0,
        tetherId: null,
      };
    });
    const firstHoles = selectAdjacentBlackHolePair(holes);
    const secondHole = holes.find((hole) => !firstHoles.includes(hole));

    for (const hole of firstHoles) {
      hole.markerResolveAfterMs = LATE_BLACK_HOLE_FIRST_SHOT_AT - spawnAt + 100;
      spawnBlackHoleMarker(ctx, hole.center, hole.markerResolveAfterMs);
      hole.tetherId = spawnBlackHoleTether(ctx, hole, LATE_BLACK_HOLE_FIRST_SHOT_AT - spawnAt);
    }

    firstHoles.forEach((hole, index) => {
      scheduleBlackHoleShot(ctx, hole, LATE_BLACK_HOLE_FIRST_SHOT_AT, `late:first:${index}`);
    });

    if (secondHole === undefined) {
      return;
    }

    secondHole.markerResolveAfterMs = LATE_BLACK_HOLE_SECOND_SHOT_AT - spawnAt + 100;
    spawnBlackHoleMarker(ctx, secondHole.center, secondHole.markerResolveAfterMs);
    ctx.timeline.at(LATE_BLACK_HOLE_FIRST_SHOT_AT, () => {
      secondHole.tetherId = spawnBlackHoleTether(
        ctx,
        secondHole,
        LATE_BLACK_HOLE_SECOND_SHOT_AT - LATE_BLACK_HOLE_FIRST_SHOT_AT,
      );
    });
    scheduleBlackHoleShot(ctx, secondHole, LATE_BLACK_HOLE_SECOND_SHOT_AT, 'late:second');
  });
}

function scheduleThunder(ctx: BattleScriptContext, castStartAt: number, actionId: string): void {
  const firstResolveAt = castStartAt + THUNDER_CAST_MS;
  const secondResolveAt = firstResolveAt + THUNDER_SECOND_DELAY_MS;
  const unlockAt = secondResolveAt + 1_000;

  ctx.timeline.at(castStartAt, () => {
    lockExdeathUntil(ctx, unlockAt);
    spawnExdeathMarker(ctx, getWanderingBossState(ctx).exdeathCenter, unlockAt - castStartAt);
    ctx.boss.cast(actionId, '暴雷', THUNDER_CAST_MS);
  });

  for (const resolveAt of [firstResolveAt, secondResolveAt]) {
    ctx.timeline.at(resolveAt - TELEGRAPH_MS, () => {
      const center = getWanderingBossState(ctx).exdeathCenter;
      const target = selectNearestActor(ctx.select.allPlayers(), center);

      if (target === null) {
        return;
      }

      const direction = createFacingTowards(center, target.position);
      lockExdeathUntil(ctx, unlockAt, direction);
      spawnExdeathMarker(ctx, center, unlockAt - (resolveAt - TELEGRAPH_MS), direction);
      ctx.state.setValue(`kefkaP3Second:thunder:${resolveAt}`, target.id);
      ctx.spawn.circleTelegraph({
        label: '暴雷范围',
        center: target.position,
        radius: THUNDER_RADIUS,
        resolveAfterMs: TELEGRAPH_MS,
      });
    });
    ctx.timeline.at(resolveAt, () => {
      const targetId = ctx.state.getValue<string>(`kefkaP3Second:thunder:${resolveAt}`);
      const target = targetId === undefined ? null : getFreshActor(ctx, targetId);

      if (target === null || !target.mechanicActive) {
        return;
      }

      for (const hit of getActorsInsideCircle(
        ctx.select.allPlayers(),
        target.position,
        THUNDER_RADIUS,
      )) {
        if (hit.slot === 'MT' || hit.slot === 'ST') {
          applySecondTrickDamage(ctx, hit, '暴雷');
        } else {
          applySecondTrickDeath(ctx, hit, '被暴雷命中');
        }
      }
    });
  }
}

function scheduleCurse(ctx: BattleScriptContext, castStartAt: number, actionId: string): void {
  const resolveAt = castStartAt + CURSE_CAST_MS;
  const unlockAt = resolveAt + 1_000;

  ctx.timeline.at(castStartAt, () => {
    const state = getWanderingBossState(ctx);
    const target = shuffle(ctx.select.allPlayers().filter((actor) => actor.mechanicActive))[0];

    if (target === undefined) {
      return;
    }

    const direction = createFacingTowards(state.chaosCenter, target.position);

    lockChaosUntil(ctx, unlockAt, direction);
    spawnChaosMarker(ctx, state.chaosCenter, unlockAt - castStartAt, direction);
    ctx.state.setValue(`kefkaP3Second:curse:${castStartAt}`, {
      center: state.chaosCenter,
      direction,
      targetId: target.id,
    });
    ctx.boss.cast(actionId, '诅咒敕令', CURSE_CAST_MS);
  });

  ctx.timeline.at(resolveAt - TELEGRAPH_MS, () => {
    const locked = ctx.state.getValue<{ center: Vector2; direction: number; targetId: string }>(
      `kefkaP3Second:curse:${castStartAt}`,
    );

    if (locked === undefined) {
      return;
    }

    ctx.spawn.fanTelegraph({
      label: '诅咒敕令',
      center: locked.center,
      direction: locked.direction,
      angle: CURSE_ANGLE,
      radius: CURSE_RADIUS,
      resolveAfterMs: TELEGRAPH_MS,
    });
  });

  ctx.timeline.at(resolveAt, () => {
    const locked = ctx.state.getValue<{ center: Vector2; direction: number; targetId: string }>(
      `kefkaP3Second:curse:${castStartAt}`,
    );

    if (locked === undefined) {
      return;
    }

    for (const hit of ctx.select
      .allPlayers()
      .filter((actor) =>
        isActorInsideFan(actor, locked.center, locked.direction, CURSE_ANGLE, CURSE_RADIUS),
      )) {
      applySecondTrickDeath(ctx, hit, '诅咒敕令');
    }
  });
}

function getChaosExplosionActionName(mode: ChaosExplosionMode): string {
  return mode === 'longitude' ? '经度聚爆' : '纬度聚爆';
}

function getChaosExplosionDirections(
  state: ChaosExplosionState,
  phase: ChaosExplosionPhase,
): readonly [number, number] {
  const shouldResolveFrontBack =
    state.mode === 'longitude' ? phase === 'first' : phase === 'second';

  if (shouldResolveFrontBack) {
    return [state.facing, state.facing + Math.PI];
  }

  return [state.facing - Math.PI / 2, state.facing + Math.PI / 2];
}

function spawnChaosExplosionTelegraphs(
  ctx: BattleScriptContext,
  state: ChaosExplosionState,
  phase: ChaosExplosionPhase,
): void {
  const actionName = getChaosExplosionActionName(state.mode);

  for (const direction of getChaosExplosionDirections(state, phase)) {
    ctx.spawn.fanTelegraph({
      label: `${actionName}范围`,
      center: state.center,
      direction,
      angle: CHAOS_EXPLOSION_FAN_ANGLE,
      radius: CHAOS_EXPLOSION_FAN_RADIUS,
      resolveAfterMs: TELEGRAPH_MS,
    });
  }
}

function resolveChaosExplosion(
  ctx: BattleScriptContext,
  state: ChaosExplosionState,
  phase: ChaosExplosionPhase,
): void {
  const hitActorIds = new Set<string>();

  for (const direction of getChaosExplosionDirections(state, phase)) {
    for (const hit of ctx.select
      .allPlayers()
      .filter((actor) =>
        isActorInsideFan(
          actor,
          state.center,
          direction,
          CHAOS_EXPLOSION_FAN_ANGLE,
          CHAOS_EXPLOSION_FAN_RADIUS,
        ),
      )) {
      hitActorIds.add(hit.id);
    }
  }

  for (const hitActorId of hitActorIds) {
    const hit = getFreshActor(ctx, hitActorId);

    if (hit !== null) {
      applySecondTrickDeath(ctx, hit, '被扇形命中');
    }
  }
}

function scheduleChaosExplosion(
  ctx: BattleScriptContext,
  castStartAt: number,
  actionId: string,
): void {
  const firstResolveAt = castStartAt + CHAOS_EXPLOSION_CAST_MS;
  const secondResolveAt = firstResolveAt + CHAOS_EXPLOSION_SECOND_DELAY_MS;
  const unlockAt = secondResolveAt + 1_000;
  const stateKey = `kefkaP3Second:chaosExplosion:${castStartAt}`;

  ctx.timeline.at(castStartAt, () => {
    const st = getActorBySlot(ctx.select.allPlayers(), getChaosFollowSlot(ctx));
    const bossState = getWanderingBossState(ctx);
    const mode: ChaosExplosionMode = Math.random() < 0.5 ? 'longitude' : 'latitude';
    const center = { ...bossState.chaosCenter };
    const facing =
      distance(st.position, center) <= 0.0001 ? 0 : createFacingTowards(center, st.position);
    const explosionState: ChaosExplosionState = {
      mode,
      center,
      facing,
    };

    lockChaosUntil(ctx, unlockAt, facing);
    spawnChaosMarker(ctx, center, unlockAt - castStartAt, facing);
    ctx.state.setValue(stateKey, explosionState);
    ctx.boss.cast(actionId, getChaosExplosionActionName(mode), CHAOS_EXPLOSION_CAST_MS);
  });

  for (const [phase, resolveAt] of [
    ['first', firstResolveAt],
    ['second', secondResolveAt],
  ] as const) {
    ctx.timeline.at(resolveAt - TELEGRAPH_MS, () => {
      const state = ctx.state.getValue<ChaosExplosionState>(stateKey);

      if (state !== undefined) {
        spawnChaosExplosionTelegraphs(ctx, state, phase);
      }
    });
    ctx.timeline.at(resolveAt, () => {
      const state = ctx.state.getValue<ChaosExplosionState>(stateKey);

      if (state !== undefined) {
        resolveChaosExplosion(ctx, state, phase);
      }
    });
  }
}

function scheduleTrueSelf(
  ctx: BattleScriptContext,
  spawnAt: number,
  markerDespawnAt?: number,
  castDelayMs = TRUE_SELF_SPAWN_TO_CAST_MS,
  castMs = TRUE_SELF_CAST_MS,
): void {
  const position = createOutsideKefkaPosition();
  const facing = createFacingTowards(position, CENTER);
  const castStartAt = spawnAt + castDelayMs;
  const resolveAt = castStartAt + castMs;
  const disappearAt = markerDespawnAt ?? resolveAt + VISUAL_MS;
  const actionId = `kefka_p3_second_true_self_${spawnAt}`;

  recordKefkaAppearance(ctx, {
    kind: 'trueSelf',
    spawnAt,
    disappearAt,
    position,
    facing,
    actionId,
    actionName: '本色出演的我',
    castStartAt,
    castMs,
  });

  ctx.timeline.at(spawnAt, () => {
    spawnKefkaMarker(ctx, position, disappearAt - spawnAt);
  });
  ctx.timeline.at(castStartAt, () => {
    ctx.boss.cast(actionId, '本色出演的我', castMs);
  });
  ctx.timeline.at(resolveAt - TELEGRAPH_MS, () => {
    ctx.spawn.rectangleTelegraph({
      label: '本色出演的我',
      center: position,
      direction: facing,
      length: TRUE_SELF_LENGTH,
      width: TRUE_SELF_WIDTH,
      color: SLAP_MARKER_COLOR,
      resolveAfterMs: TELEGRAPH_MS,
    });
  });
  ctx.timeline.at(resolveAt, () => {
    for (const hit of ctx.select
      .allPlayers()
      .filter((actor) =>
        isActorInsideRectangle(actor, position, facing, TRUE_SELF_LENGTH, TRUE_SELF_WIDTH),
      )) {
      applySecondTrickDeath(ctx, hit, '本色出演的我');
    }
  });
}

function getTerminalArrowDirection(ctx: BattleScriptContext): number | undefined {
  return ctx.state.getValue<number>('kefkaP3Second:terminalArrowDirection');
}

function getLastTrueSelfAppearance(ctx: BattleScriptContext): KefkaAppearanceState | undefined {
  return getKefkaAppearances(ctx)
    .filter((appearance) => appearance.kind === 'trueSelf')
    .sort((left, right) => right.disappearAt - left.disappearAt)[0];
}

function ensureTerminalArrowDirection(ctx: BattleScriptContext): number {
  const existingDirection = getTerminalArrowDirection(ctx);

  if (existingDirection !== undefined) {
    return existingDirection;
  }

  const lastTrueSelfAppearance = getLastTrueSelfAppearance(ctx);

  if (lastTrueSelfAppearance === undefined) {
    throw new Error('missing kefka p3 second final true self appearance');
  }

  const direction = createFacingTowards(lastTrueSelfAppearance.position, CENTER);
  ctx.state.setValue('kefkaP3Second:terminalArrowDirection', direction);

  return direction;
}

function spawnTerminalArrow(
  ctx: BattleScriptContext,
  direction: number,
  resolveAfterMs: number,
): void {
  ctx.spawn.fieldMarker({
    label: '凯夫卡',
    center: CENTER,
    shape: 'enemy',
    radius: TERMINAL_ARROW_RADIUS,
    direction,
    color: TERMINAL_ARROW_COLOR,
    resolveAfterMs,
  });
}

function terminalCircleStateKey(spawnAt: number): string {
  return `kefkaP3Second:terminalCircle:${spawnAt}`;
}

function createTerminalCircleState(ctx: BattleScriptContext, spawnAt: number): TerminalCircleState {
  const state: TerminalCircleState = {
    spawnAt,
    resolveAt: spawnAt + TERMINAL_CIRCLE_DELAY_MS,
    centers: ctx.select.allPlayers().map((actor) => ({
      actorId: actor.id,
      center: { ...actor.position },
    })),
  };

  ctx.state.setValue(terminalCircleStateKey(spawnAt), state);

  return state;
}

function spawnTerminalCircleTelegraphs(ctx: BattleScriptContext, state: TerminalCircleState): void {
  const remainingMs = state.resolveAt - ctx.state.getBattleTime();

  if (remainingMs <= 0) {
    return;
  }

  for (const entry of state.centers) {
    ctx.spawn.circleTelegraph({
      label: '终盘脚下圈',
      center: entry.center,
      radius: TERMINAL_CIRCLE_RADIUS,
      color: '#f97316',
      resolveAfterMs: remainingMs,
    });
  }
}

function resolveTerminalCircleState(ctx: BattleScriptContext, state: TerminalCircleState): void {
  for (const entry of state.centers) {
    for (const hit of getActorsInsideCircle(
      ctx.select.allPlayers(),
      entry.center,
      TERMINAL_CIRCLE_RADIUS,
    )) {
      applySecondTrickDeath(ctx, hit, '终盘脚下圈');
    }
  }
}

function scheduleTerminalCircleSet(ctx: BattleScriptContext, spawnAt: number): void {
  const resolveAt = spawnAt + TERMINAL_CIRCLE_DELAY_MS;

  ctx.timeline.at(spawnAt, () => {
    const state = createTerminalCircleState(ctx, spawnAt);
    spawnTerminalCircleTelegraphs(ctx, state);
  });
  ctx.timeline.at(resolveAt, () => {
    const state = ctx.state.getValue<TerminalCircleState>(terminalCircleStateKey(spawnAt));

    if (state !== undefined) {
      resolveTerminalCircleState(ctx, state);
    }
  });
}

function terminalShareStateKey(index: number): string {
  return `kefkaP3Second:terminalShare:${index}`;
}

function getTerminalShareState(
  ctx: BattleScriptContext,
  index: number,
): TerminalShareState | undefined {
  return ctx.state.getValue<TerminalShareState>(terminalShareStateKey(index));
}

function getTerminalShareRoleOrder(ctx: BattleScriptContext): TerminalShareRoleGroup[] {
  const stateKey = 'kefkaP3Second:terminalShareRoleOrder';
  const existingOrder = ctx.state.getValue<TerminalShareRoleGroup[]>(stateKey);

  if (existingOrder !== undefined) {
    return existingOrder;
  }

  const order = shuffle<TerminalShareRoleGroup>(['support', 'dps']);
  ctx.state.setValue(stateKey, order);

  return order;
}

function selectTerminalShareTarget(
  ctx: BattleScriptContext,
  roleGroup: TerminalShareRoleGroup,
): BaseActorSnapshot | null {
  const activeActors = ctx.select.allPlayers().filter((actor) => actor.mechanicActive);
  const candidates = getTerminalShareCandidates(activeActors, roleGroup);

  return shuffle(candidates.length === 0 ? activeActors : candidates)[0] ?? null;
}

function createTerminalShareState(
  ctx: BattleScriptContext,
  index: number,
): TerminalShareState | null {
  const assignAt = TERMINAL_SHARE_ASSIGN_ATS[index];

  if (assignAt === undefined) {
    return null;
  }

  const existingState = getTerminalShareState(ctx, index);

  if (existingState !== undefined) {
    return existingState;
  }

  const roleGroup = getTerminalShareRoleOrder(ctx)[index];

  if (roleGroup === undefined) {
    return null;
  }

  const target = selectTerminalShareTarget(ctx, roleGroup);

  if (target === null) {
    return null;
  }

  const state: TerminalShareState = {
    index,
    assignAt,
    resolveAt: assignAt + TERMINAL_SHARE_DELAY_MS,
    targetId: target.id,
    roleGroup,
  };

  ctx.state.setValue(terminalShareStateKey(index), state);

  return state;
}

function spawnTerminalShareMarker(ctx: BattleScriptContext, state: TerminalShareState): void {
  const target = getFreshActor(ctx, state.targetId);
  const remainingMs = state.resolveAt - ctx.state.getBattleTime();

  if (target === null || !target.mechanicActive || remainingMs <= 0) {
    return;
  }

  ctx.spawn.actorMarker({
    label: '终盘分摊',
    target,
    markerShape: 'stackCircle',
    radius: TERMINAL_SHARE_RADIUS,
    color: TERMINAL_SHARE_MARKER_COLOR,
    resolveAfterMs: remainingMs,
  });
}

function resolveTerminalShareState(ctx: BattleScriptContext, state: TerminalShareState): void {
  const target = getFreshActor(ctx, state.targetId);

  if (target === null || !target.mechanicActive) {
    return;
  }

  const center = { ...target.position };
  const resolvedState: TerminalShareState = { ...state, center };
  ctx.state.setValue(terminalShareStateKey(state.index), resolvedState);

  const hits = getActorsInsideCircle(ctx.select.allPlayers(), center, TERMINAL_SHARE_RADIUS);

  if (hits.length < TERMINAL_SHARE_MIN_PLAYERS) {
    for (const hit of hits) {
      applySecondTrickDeath(ctx, hit, '终盘分摊人数不足');
    }
    return;
  }

  for (const hit of hits) {
    grantTerminalInjury(ctx, hit, '终盘分摊');
  }
}

function scheduleTerminalShare(ctx: BattleScriptContext, index: number): void {
  const assignAt = TERMINAL_SHARE_ASSIGN_ATS[index];

  if (assignAt === undefined) {
    return;
  }

  const resolveAt = assignAt + TERMINAL_SHARE_DELAY_MS;

  ctx.timeline.at(assignAt, () => {
    const state = createTerminalShareState(ctx, index);

    if (state !== null) {
      spawnTerminalShareMarker(ctx, state);
    }
  });
  ctx.timeline.at(resolveAt, () => {
    const state = getTerminalShareState(ctx, index);

    if (state !== undefined) {
      resolveTerminalShareState(ctx, state);
    }
  });
}

function getTerminalShareCenterForExpectedState(
  ctx: BattleScriptContext,
  state: TerminalShareState,
): Vector2 | null {
  if (state.center !== undefined) {
    return state.center;
  }

  const target = getFreshActor(ctx, state.targetId);

  return target === null ? null : { ...target.position };
}

function applyExpectedTerminalShareInjury(
  ctx: BattleScriptContext,
  state: TerminalShareState,
  startTimeMs: number,
): void {
  const injuryExpiresAt = state.resolveAt + TERMINAL_INJURY_DURATION_MS;

  if (!isTimeInWindow(startTimeMs, state.resolveAt, injuryExpiresAt)) {
    return;
  }

  const center = getTerminalShareCenterForExpectedState(ctx, state);

  if (center === null) {
    return;
  }

  const resolvedState: TerminalShareState = { ...state, center };
  ctx.state.setValue(terminalShareStateKey(state.index), resolvedState);

  for (const hit of getActorsInsideCircle(ctx.select.allPlayers(), center, TERMINAL_SHARE_RADIUS)) {
    grantTerminalInjuryUntil(ctx, hit, injuryExpiresAt, '终盘分摊');
  }
}

function resolveTerminalShareReturn(ctx: BattleScriptContext): void {
  for (let index = 0; index < TERMINAL_SHARE_ASSIGN_ATS.length; index += 1) {
    const state = getTerminalShareState(ctx, index);

    if (state?.center === undefined) {
      continue;
    }

    for (const hit of getActorsInsideCircle(
      ctx.select.allPlayers(),
      state.center,
      TERMINAL_SHARE_RADIUS,
    )) {
      applySecondTrickDeath(ctx, hit, '终盘分摊返还');
    }
  }
}

function spawnTerminalShareReturnTelegraphs(ctx: BattleScriptContext): void {
  const remainingMs = TERMINAL_SHARE_RETURN_AT - ctx.state.getBattleTime();

  if (remainingMs <= 0) {
    return;
  }

  for (let index = 0; index < TERMINAL_SHARE_ASSIGN_ATS.length; index += 1) {
    const state = getTerminalShareState(ctx, index);

    if (state?.center === undefined) {
      continue;
    }

    ctx.spawn.circleTelegraph({
      label: '终盘石笋范围',
      center: state.center,
      radius: TERMINAL_SHARE_RADIUS,
      color: TERMINAL_SHARE_MARKER_COLOR,
      resolveAfterMs: remainingMs,
    });
  }
}

function getTerminalTowerCenter(direction: number, side: 'left' | 'right'): Vector2 {
  return createPointOnDirection(
    direction + (side === 'right' ? Math.PI / 2 : -Math.PI / 2),
    TERMINAL_TOWER_OFFSET,
  );
}

function resolveTerminalTower(
  ctx: BattleScriptContext,
  center: Vector2,
  sourceLabel = '终盘塔',
): void {
  const hits = getActorsInsideCircle(ctx.select.allPlayers(), center, TERMINAL_TOWER_RADIUS);

  if (hits.length < TERMINAL_TOWER_MIN_PLAYERS) {
    for (const actor of ctx.select.allPlayers().filter((candidate) => candidate.mechanicActive)) {
      applySecondTrickDeath(ctx, actor, `${sourceLabel}人数不足`);
    }
    return;
  }

  for (const hit of hits) {
    grantTerminalInjury(ctx, hit, sourceLabel);
  }
}

function scheduleTerminalTower(ctx: BattleScriptContext, index: number): void {
  const spawnAt = TERMINAL_TOWER_ATS[index];
  const side = TERMINAL_TOWER_SIDES[index];

  if (spawnAt === undefined || side === undefined) {
    return;
  }

  ctx.timeline.at(spawnAt, () => {
    const center = getTerminalTowerCenter(ensureTerminalArrowDirection(ctx), side);
    ctx.spawn.tower({
      label: '终盘塔',
      center,
      radius: TERMINAL_TOWER_RADIUS,
      resolveAfterMs: TERMINAL_TOWER_VISUAL_MS,
      color: side === 'right' ? '#f97316' : '#38bdf8',
    });
    resolveTerminalTower(ctx, center);
  });
}

function scheduleTerminalMechanics(ctx: BattleScriptContext): void {
  ctx.timeline.at(TERMINAL_ARROW_AT, () => {
    spawnTerminalArrow(ctx, ensureTerminalArrowDirection(ctx), COMPLETE_AT - TERMINAL_ARROW_AT);
  });

  for (const spawnAt of TERMINAL_CIRCLE_SPAWN_ATS) {
    scheduleTerminalCircleSet(ctx, spawnAt);
  }

  for (let index = 0; index < TERMINAL_SHARE_ASSIGN_ATS.length; index += 1) {
    scheduleTerminalShare(ctx, index);
  }

  for (let index = 0; index < TERMINAL_TOWER_ATS.length; index += 1) {
    scheduleTerminalTower(ctx, index);
  }

  ctx.timeline.at(TERMINAL_MOVEMENT_CHECK_AT, () => {
    for (const actor of ctx.select.allPlayers().filter((candidate) => candidate.mechanicActive)) {
      if (!actor.moveState.moving) {
        applySecondTrickDeath(ctx, actor, '终盘移动检查');
      }
    }
  });

  ctx.timeline.at(TERMINAL_SHARE_RETURN_AT - TELEGRAPH_MS, () => {
    spawnTerminalShareReturnTelegraphs(ctx);
  });

  ctx.timeline.at(TERMINAL_SHARE_RETURN_AT, () => {
    resolveTerminalShareReturn(ctx);
  });
}

function isTimeInWindow(startTimeMs: number, startAt: number, endAt: number): boolean {
  return startTimeMs >= startAt && startTimeMs < endAt;
}

function restoreCastIfActive(
  ctx: BattleScriptContext,
  startTimeMs: number,
  castStartAt: number,
  castMs: number,
  actionId: string,
  actionName: string,
): void {
  if (isTimeInWindow(startTimeMs, castStartAt, castStartAt + castMs)) {
    ctx.boss.restoreCast(actionId, actionName, castStartAt, castMs);
  }
}

function applyVoidErosionProgress(ctx: BattleScriptContext, actor: BaseActorSnapshot): void {
  const freshActor = getFreshActor(ctx, actor.id);

  if (freshActor === null || !freshActor.mechanicActive) {
    return;
  }

  const transition = getVoidErosionTransition(freshActor.statuses.map((status) => status.id));

  if (transition.causesDeath) {
    return;
  }

  if (transition.removeStatusId !== undefined) {
    ctx.status.remove([freshActor.id], transition.removeStatusId);
  }

  applyStatus(ctx, freshActor, transition.applyStatusId, 999_000);
}

function applyExpectedBlackHoleShots(ctx: BattleScriptContext, count: number): void {
  const actors = ctx.select.allPlayers().filter((actor) => actor.mechanicActive);

  if (actors.length === 0) {
    return;
  }

  for (let index = 0; index < count; index += 1) {
    applyVoidErosionProgress(ctx, actors[index % actors.length]!);
  }
}

function initializeShotTelegraphIfActive(
  ctx: BattleScriptContext,
  startTimeMs: number,
  hole: BlackHole,
  shotAt: number,
  shotKey: string,
): void {
  if (!isTimeInWindow(startTimeMs, shotAt - TELEGRAPH_MS, shotAt)) {
    return;
  }

  lockBlackHoleShot(ctx, hole, shotKey);
}

function initializeFirstBlackHolesAt(ctx: BattleScriptContext, startTimeMs: number): void {
  const castStartAt = FIRST_BLACK_HOLE_CAST_START_AT;
  const spawnAt = castStartAt + 2_700;

  restoreCastIfActive(ctx, startTimeMs, castStartAt, 2_700, 'kefka_p3_second_black_hole_1', '黑洞');

  if (startTimeMs <= spawnAt) {
    return;
  }

  const firstHoleIndex = Math.floor(Math.random() * 3);
  const holes = createBlackHoleCenters().map(
    (center, index): BlackHole => ({
      center,
      markerResolveAfterMs:
        index === firstHoleIndex
          ? BLACK_HOLE_SHOT_DELAY_MS + 100
          : BLACK_HOLE_SHOT_DELAY_MS * 2 + 100,
      tetherId: null,
    }),
  );
  const firstShotAt = spawnAt + BLACK_HOLE_SHOT_DELAY_MS;
  const secondShotAt = spawnAt + BLACK_HOLE_SHOT_DELAY_MS * 2;
  const firstHole = holes[firstHoleIndex];

  if (startTimeMs >= firstShotAt) {
    applyExpectedBlackHoleShots(ctx, 1);
  }

  if (startTimeMs >= secondShotAt) {
    applyExpectedBlackHoleShots(ctx, 2);
  }

  if (firstHole !== undefined && startTimeMs < firstShotAt + 100) {
    spawnBlackHoleMarker(ctx, firstHole.center, firstShotAt + 100 - startTimeMs);
    if (startTimeMs < firstShotAt + 50) {
      firstHole.tetherId = spawnBlackHoleTether(ctx, firstHole, firstShotAt + 50 - startTimeMs);
    }
    scheduleBlackHoleShot(ctx, firstHole, firstShotAt, 'first:0');
    initializeShotTelegraphIfActive(ctx, startTimeMs, firstHole, firstShotAt, 'first:0');
  }

  holes
    .filter((hole) => hole !== firstHole)
    .forEach((hole, index) => {
      if (startTimeMs >= secondShotAt + 100) {
        return;
      }

      spawnBlackHoleMarker(ctx, hole.center, secondShotAt + 100 - startTimeMs);

      if (startTimeMs >= firstShotAt && startTimeMs < secondShotAt + 50) {
        hole.tetherId = spawnBlackHoleTether(ctx, hole, secondShotAt + 50 - startTimeMs);
        scheduleBlackHoleShot(ctx, hole, secondShotAt, `first:${index + 1}`);
        initializeShotTelegraphIfActive(ctx, startTimeMs, hole, secondShotAt, `first:${index + 1}`);
      } else {
        ctx.timeline.at(firstShotAt, () => {
          hole.tetherId = spawnBlackHoleTether(ctx, hole, BLACK_HOLE_SHOT_DELAY_MS);
        });
        scheduleBlackHoleShot(ctx, hole, secondShotAt, `first:${index + 1}`);
      }
    });
}

function initializePersistentBlackHolesAt(
  ctx: BattleScriptContext,
  startTimeMs: number,
  spawnAt: number,
  shotKeyPrefix: string,
): void {
  if (startTimeMs <= spawnAt) {
    return;
  }

  const holes = createBlackHoleCenters().map(
    (center): BlackHole => ({
      center,
      markerResolveAfterMs: 0,
      tetherId: null,
    }),
  );
  const shotAts = [
    spawnAt + PERSISTENT_BLACK_HOLE_FIRST_SHOT_DELAY_MS,
    spawnAt + PERSISTENT_BLACK_HOLE_FIRST_SHOT_DELAY_MS + PERSISTENT_BLACK_HOLE_REPEAT_INTERVAL_MS,
    spawnAt +
      PERSISTENT_BLACK_HOLE_FIRST_SHOT_DELAY_MS +
      PERSISTENT_BLACK_HOLE_REPEAT_INTERVAL_MS * 2,
  ];
  const finalShotAt = shotAts[shotAts.length - 1]!;

  for (const shotAt of shotAts) {
    if (startTimeMs >= shotAt) {
      applyExpectedBlackHoleShots(ctx, holes.length);
    }
  }

  if (startTimeMs >= finalShotAt + 100) {
    return;
  }

  holes.forEach((hole, holeIndex) => {
    spawnBlackHoleMarker(ctx, hole.center, finalShotAt + 100 - startTimeMs);
    if (startTimeMs < finalShotAt + 50) {
      hole.tetherId = spawnBlackHoleTether(ctx, hole, finalShotAt + 50 - startTimeMs);
    }

    for (const [shotIndex, shotAt] of shotAts.entries()) {
      const shotKey = `${shotKeyPrefix}:${shotIndex + 1}:${holeIndex}`;

      if (shotAt > startTimeMs) {
        scheduleBlackHoleShot(ctx, hole, shotAt, shotKey);
      } else {
        initializeShotTelegraphIfActive(ctx, startTimeMs, hole, shotAt, shotKey);
      }
    }
  });
}

function initializeLateSplitBlackHolesAt(ctx: BattleScriptContext, startTimeMs: number): void {
  const spawnAt = LATE_BLACK_HOLE_SPAWN_AT;

  if (startTimeMs <= spawnAt) {
    return;
  }

  const holes = createBlackHoleCenters().map(
    (center): BlackHole => ({
      center,
      markerResolveAfterMs: 0,
      tetherId: null,
    }),
  );
  const firstHoles = selectAdjacentBlackHolePair(holes);
  const secondHole = holes.find((hole) => !firstHoles.includes(hole));
  const firstShotAt = LATE_BLACK_HOLE_FIRST_SHOT_AT;
  const secondShotAt = LATE_BLACK_HOLE_SECOND_SHOT_AT;

  if (startTimeMs >= firstShotAt) {
    applyExpectedBlackHoleShots(ctx, firstHoles.length);
  }

  if (startTimeMs >= secondShotAt) {
    applyExpectedBlackHoleShots(ctx, 1);
  }

  for (const [index, hole] of firstHoles.entries()) {
    if (startTimeMs >= firstShotAt + 100) {
      continue;
    }

    spawnBlackHoleMarker(ctx, hole.center, firstShotAt + 100 - startTimeMs);
    if (startTimeMs < firstShotAt + 50) {
      hole.tetherId = spawnBlackHoleTether(ctx, hole, firstShotAt + 50 - startTimeMs);
    }
    scheduleBlackHoleShot(ctx, hole, firstShotAt, `late:first:${index}`);
    initializeShotTelegraphIfActive(ctx, startTimeMs, hole, firstShotAt, `late:first:${index}`);
  }

  if (secondHole === undefined || startTimeMs >= secondShotAt + 100) {
    return;
  }

  spawnBlackHoleMarker(ctx, secondHole.center, secondShotAt + 100 - startTimeMs);

  if (startTimeMs >= firstShotAt && startTimeMs < secondShotAt + 50) {
    secondHole.tetherId = spawnBlackHoleTether(ctx, secondHole, secondShotAt + 50 - startTimeMs);
  } else {
    ctx.timeline.at(firstShotAt, () => {
      secondHole.tetherId = spawnBlackHoleTether(ctx, secondHole, secondShotAt - firstShotAt);
    });
  }

  scheduleBlackHoleShot(ctx, secondHole, secondShotAt, 'late:second');
  initializeShotTelegraphIfActive(ctx, startTimeMs, secondHole, secondShotAt, 'late:second');
}

function initializeWanderingBossesAt(ctx: BattleScriptContext, startTimeMs: number): void {
  const st = getActorBySlot(ctx.select.allPlayers(), getChaosFollowSlot(ctx));
  const mt = getActorBySlot(ctx.select.allPlayers(), getExdeathFollowSlot(ctx));
  const chaosCenter = calculateFollowerCenter(CENTER, st.position, CHAOS_TARGET_RING_RADIUS);
  const exdeathCenter = calculateFollowerCenter(CENTER, mt.position, EXDEATH_TARGET_RING_RADIUS);
  const chaosFacing =
    distance(chaosCenter, st.position) <= 0.0001
      ? 0
      : createFacingTowards(chaosCenter, st.position);
  const exdeathFacing =
    distance(exdeathCenter, mt.position) <= 0.0001
      ? 0
      : createFacingTowards(exdeathCenter, mt.position);

  setWanderingBossState(ctx, {
    chaosCenter,
    exdeathCenter,
    chaosFacing,
    exdeathFacing,
    chaosLockedUntil: 0,
    exdeathLockedUntil: 0,
  });

  if (startTimeMs < COMPLETE_AT) {
    spawnChaosMarker(ctx, chaosCenter, Math.max(COMPLETE_AT - startTimeMs, 50), chaosFacing);
    spawnExdeathMarker(ctx, exdeathCenter, Math.max(COMPLETE_AT - startTimeMs, 50), exdeathFacing);
  }
}

function initializeKefkaAppearancesAt(ctx: BattleScriptContext, startTimeMs: number): void {
  for (const appearance of getKefkaAppearances(ctx)) {
    if (isTimeInWindow(startTimeMs, appearance.spawnAt, appearance.disappearAt)) {
      spawnKefkaMarker(ctx, appearance.position, appearance.disappearAt - startTimeMs);
    }

    restoreCastIfActive(
      ctx,
      startTimeMs,
      appearance.castStartAt,
      appearance.castMs,
      appearance.actionId,
      appearance.actionName,
    );

    const resolveAt = appearance.castStartAt + appearance.castMs;
    if (
      appearance.kind === 'trueSelf' &&
      isTimeInWindow(startTimeMs, resolveAt - TELEGRAPH_MS, resolveAt)
    ) {
      ctx.spawn.rectangleTelegraph({
        label: '本色出演的我',
        center: appearance.position,
        direction: appearance.facing,
        length: TRUE_SELF_LENGTH,
        width: TRUE_SELF_WIDTH,
        color: SLAP_MARKER_COLOR,
        resolveAfterMs: resolveAt - startTimeMs,
      });
    }
  }
}

function initializeChaosExplosionAt(ctx: BattleScriptContext, startTimeMs: number): void {
  const castStartAt = CHAOS_EXPLOSION_CAST_START_AT;

  if (startTimeMs < castStartAt) {
    return;
  }

  const st = getActorBySlot(ctx.select.allPlayers(), getChaosFollowSlot(ctx));
  const bossState = getWanderingBossState(ctx);
  const mode: ChaosExplosionMode = Math.random() < 0.5 ? 'longitude' : 'latitude';
  const center = { ...bossState.chaosCenter };
  const facing =
    distance(st.position, center) <= 0.0001
      ? bossState.chaosFacing
      : createFacingTowards(center, st.position);
  const state: ChaosExplosionState = { mode, center, facing };
  const firstResolveAt = castStartAt + CHAOS_EXPLOSION_CAST_MS;
  const secondResolveAt = firstResolveAt + CHAOS_EXPLOSION_SECOND_DELAY_MS;

  ctx.state.setValue(`kefkaP3Second:chaosExplosion:${castStartAt}`, state);
  restoreCastIfActive(
    ctx,
    startTimeMs,
    castStartAt,
    CHAOS_EXPLOSION_CAST_MS,
    'kefka_p3_second_chaos_explosion',
    getChaosExplosionActionName(mode),
  );

  if (isTimeInWindow(startTimeMs, firstResolveAt - TELEGRAPH_MS, firstResolveAt)) {
    spawnChaosExplosionTelegraphs(ctx, state, 'first');
  }

  if (isTimeInWindow(startTimeMs, secondResolveAt - TELEGRAPH_MS, secondResolveAt)) {
    spawnChaosExplosionTelegraphs(ctx, state, 'second');
  }
}

function initializeTerminalCircleAt(
  ctx: BattleScriptContext,
  startTimeMs: number,
  spawnAt: number,
): void {
  const resolveAt = spawnAt + TERMINAL_CIRCLE_DELAY_MS;

  if (!isTimeInWindow(startTimeMs, spawnAt, resolveAt)) {
    return;
  }

  const state = createTerminalCircleState(ctx, spawnAt);
  spawnTerminalCircleTelegraphs(ctx, state);
}

function initializeTerminalShareAt(
  ctx: BattleScriptContext,
  startTimeMs: number,
  index: number,
): void {
  const assignAt = TERMINAL_SHARE_ASSIGN_ATS[index];

  if (assignAt === undefined || startTimeMs <= assignAt) {
    return;
  }

  const state = createTerminalShareState(ctx, index);

  if (state === null) {
    return;
  }

  if (startTimeMs < state.resolveAt) {
    spawnTerminalShareMarker(ctx, state);
    return;
  }

  const center = getTerminalShareCenterForExpectedState(ctx, state);

  if (center !== null) {
    ctx.state.setValue(terminalShareStateKey(index), { ...state, center });
  }

  applyExpectedTerminalShareInjury(ctx, state, startTimeMs);
}

function initializeTerminalTowerInjuryAt(ctx: BattleScriptContext, startTimeMs: number): void {
  const direction = getTerminalArrowDirection(ctx);

  if (direction === undefined) {
    return;
  }

  for (const [index, towerAt] of TERMINAL_TOWER_ATS.entries()) {
    const injuryExpiresAt = towerAt + TERMINAL_INJURY_DURATION_MS;

    if (!isTimeInWindow(startTimeMs, towerAt, injuryExpiresAt)) {
      continue;
    }

    const side = TERMINAL_TOWER_SIDES[index];

    if (side === undefined) {
      continue;
    }

    const center = getTerminalTowerCenter(direction, side);
    const hits = getActorsInsideCircle(ctx.select.allPlayers(), center, TERMINAL_TOWER_RADIUS);

    if (hits.length < TERMINAL_TOWER_MIN_PLAYERS) {
      continue;
    }

    for (const hit of hits) {
      grantTerminalInjuryUntil(ctx, hit, injuryExpiresAt, '终盘塔');
    }
  }
}

function initializeTerminalMechanicsAt(ctx: BattleScriptContext, startTimeMs: number): void {
  if (isTimeInWindow(startTimeMs, TERMINAL_ARROW_AT, COMPLETE_AT)) {
    spawnTerminalArrow(
      ctx,
      ensureTerminalArrowDirection(ctx),
      Math.max(COMPLETE_AT - startTimeMs, 50),
    );
  }

  for (const spawnAt of TERMINAL_CIRCLE_SPAWN_ATS) {
    initializeTerminalCircleAt(ctx, startTimeMs, spawnAt);
  }

  for (let index = 0; index < TERMINAL_SHARE_ASSIGN_ATS.length; index += 1) {
    initializeTerminalShareAt(ctx, startTimeMs, index);
  }

  if (
    isTimeInWindow(startTimeMs, TERMINAL_SHARE_RETURN_AT - TELEGRAPH_MS, TERMINAL_SHARE_RETURN_AT)
  ) {
    spawnTerminalShareReturnTelegraphs(ctx);
  }

  initializeTerminalTowerInjuryAt(ctx, startTimeMs);
}

function initializeKefkaP3SecondAt(ctx: BattleScriptContext, startTimeMs: number): void {
  restoreCastIfActive(
    ctx,
    startTimeMs,
    EARTHQUAKE_CAST_START_AT,
    EARTHQUAKE_CAST_MS,
    'kefka_p3_second_earthquake',
    '地震',
  );

  if (startTimeMs > ZERO_AT) {
    applyTargetAssignmentGroups(ctx, createTargetAssignmentGroups(ctx), startTimeMs);
  }

  initializeWanderingBossesAt(ctx, startTimeMs);
  initializeFirstBlackHolesAt(ctx, startTimeMs);
  initializePersistentBlackHolesAt(
    ctx,
    startTimeMs,
    FIRST_PERSISTENT_BLACK_HOLE_SPAWN_AT,
    'persistent:1',
  );
  initializePersistentBlackHolesAt(
    ctx,
    startTimeMs,
    SECOND_PERSISTENT_BLACK_HOLE_SPAWN_AT,
    'persistent:2',
  );
  initializeLateSplitBlackHolesAt(ctx, startTimeMs);
  initializeKefkaAppearancesAt(ctx, startTimeMs);

  restoreCastIfActive(
    ctx,
    startTimeMs,
    FIRST_THUNDER_CAST_START_AT,
    THUNDER_CAST_MS,
    'kefka_p3_second_thunder_1',
    '暴雷',
  );
  restoreCastIfActive(
    ctx,
    startTimeMs,
    SECOND_THUNDER_CAST_START_AT,
    THUNDER_CAST_MS,
    'kefka_p3_second_thunder_2',
    '暴雷',
  );
  restoreCastIfActive(
    ctx,
    startTimeMs,
    FIRST_CURSE_CAST_START_AT,
    CURSE_CAST_MS,
    'kefka_p3_second_curse_1',
    '诅咒敕令',
  );
  restoreCastIfActive(
    ctx,
    startTimeMs,
    SECOND_CURSE_CAST_START_AT,
    CURSE_CAST_MS,
    'kefka_p3_second_curse_2',
    '诅咒敕令',
  );
  initializeChaosExplosionAt(ctx, startTimeMs);
  initializeTerminalMechanicsAt(ctx, startTimeMs);
}

function buildKefkaP3SecondScript(ctx: BattleScriptContext): void {
  setWanderingBossState(ctx, {
    chaosCenter: CENTER,
    exdeathCenter: CENTER,
    chaosFacing: 0,
    exdeathFacing: 0,
    chaosLockedUntil: 0,
    exdeathLockedUntil: 0,
  });

  ctx.timeline.at(0, () => {
    spawnChaosMarker(ctx, CENTER, REPOSITION_INTERVAL_MS);
    spawnExdeathMarker(ctx, CENTER, REPOSITION_INTERVAL_MS);
  });

  for (
    let repositionAt = REPOSITION_INTERVAL_MS;
    repositionAt < COMPLETE_AT;
    repositionAt += REPOSITION_INTERVAL_MS
  ) {
    ctx.timeline.at(repositionAt, () => {
      repositionWanderingBosses(ctx);
    });
  }

  ctx.timeline.at(EARTHQUAKE_CAST_START_AT, () => {
    ctx.boss.cast('kefka_p3_second_earthquake', '地震', EARTHQUAKE_CAST_MS);
  });
  ctx.timeline.at(ZERO_AT, () => {
    assignInitialStatuses(ctx);
  });

  scheduleSlap(ctx, FIRST_SLAP_SPAWN_AT, SLAP_SPAWN_TO_CAST_MS, FIRST_SLAP_DESPAWN_AT);
  scheduleFirstBlackHoles(ctx);
  scheduleThunder(ctx, FIRST_THUNDER_CAST_START_AT, 'kefka_p3_second_thunder_1');
  scheduleCurse(ctx, FIRST_CURSE_CAST_START_AT, 'kefka_p3_second_curse_1');
  scheduleSlap(ctx, SECOND_SLAP_SPAWN_AT, 1_500, SECOND_SLAP_DESPAWN_AT);
  schedulePersistentBlackHoles(ctx, FIRST_PERSISTENT_BLACK_HOLE_SPAWN_AT, 'persistent:1');
  scheduleCurse(ctx, SECOND_CURSE_CAST_START_AT, 'kefka_p3_second_curse_2');
  scheduleTrueSelf(ctx, FIRST_TRUE_SELF_SPAWN_AT, FIRST_TRUE_SELF_DESPAWN_AT);
  scheduleThunder(ctx, SECOND_THUNDER_CAST_START_AT, 'kefka_p3_second_thunder_2');
  schedulePersistentBlackHoles(ctx, SECOND_PERSISTENT_BLACK_HOLE_SPAWN_AT, 'persistent:2');
  scheduleSlap(ctx, THIRD_SLAP_SPAWN_AT, 6_000, THIRD_SLAP_DESPAWN_AT);
  scheduleChaosExplosion(ctx, CHAOS_EXPLOSION_CAST_START_AT, 'kefka_p3_second_chaos_explosion');
  scheduleLateSplitBlackHoles(ctx);
  scheduleTrueSelf(
    ctx,
    LATE_TRUE_SELF_SPAWN_AT,
    LATE_TRUE_SELF_DESPAWN_AT,
    LATE_TRUE_SELF_CAST_START_AT - LATE_TRUE_SELF_SPAWN_AT,
    TRUE_SELF_LATE_CAST_MS,
  );
  scheduleTerminalMechanics(ctx);

  ctx.timeline.at(COMPLETE_AT, () => {
    ctx.state.complete();
  });
}

export const KEFKA_P3_SECOND_TRICK_BATTLE: BattleDefinition = {
  id: 'kefka_p3_second_trick',
  name: '凯夫卡P3：二运',
  arenaRadius: ARENA_RADIUS,
  bossTargetRingRadius: BOSS_TARGET_RING_RADIUS,
  slots: PARTY_SLOT_ORDER,
  bossName: '凯夫卡',
  initialPartyPositions: Object.fromEntries(
    PARTY_SLOT_ORDER.map((slot) => [
      slot,
      {
        position: INITIAL_POSITIONS[slot],
        facing: createFacingTowards(INITIAL_POSITIONS[slot], CENTER),
      },
    ]),
  ) as BattleDefinition['initialPartyPositions'],
  mapMarkers: KEFKA_MAP_MARKERS,
  startTimeOptions: START_TIME_OPTIONS,
  roomOptions: KEFKA_P3_ROOM_OPTIONS,
  buildScript: buildKefkaP3SecondScript,
  initializeAt: initializeKefkaP3SecondAt,
  failureTexts: {
    outOfBounds: (actorName) => `${actorName} 越过场地边界`,
    mechanicDeath: (actorName, sourceLabel) => `${actorName} 因 ${sourceLabel} 死亡`,
  },
};

export const KEFKA_P3_SECOND_TRICK_TESTING = {
  ZERO_AT,
  TELEGRAPH_MS,
  FIRST_TARGET_STATUS_ID,
  SECOND_TARGET_STATUS_ID,
  THIRD_TARGET_STATUS_ID,
  CHAOS_EARTH_STATUS_ID,
  VOID_EROSION_1_STATUS_ID,
  VOID_EROSION_2_STATUS_ID,
  VOID_CORROSION_STATUS_ID,
  FIRST_TARGET_MARKER_COLOR,
  SECOND_TARGET_MARKER_COLOR,
  THIRD_TARGET_MARKER_COLOR,
  TERMINAL_INJURY_DURATION_MS,
  BLACK_HOLE_SHOT_DELAY_MS,
  PERSISTENT_BLACK_HOLE_FIRST_SHOT_DELAY_MS,
  PERSISTENT_BLACK_HOLE_REPEAT_INTERVAL_MS,
  LATE_BLACK_HOLE_SPAWN_AT,
  LATE_BLACK_HOLE_FIRST_SHOT_AT,
  LATE_BLACK_HOLE_SECOND_SHOT_AT,
  CHAOS_EXPLOSION_CAST_MS,
  CHAOS_EXPLOSION_SECOND_DELAY_MS,
  CHAOS_EXPLOSION_FAN_ANGLE,
  CHAOS_EXPLOSION_FAN_RADIUS,
  THUNDER_CAST_MS,
  CURSE_CAST_MS,
  TRUE_SELF_CAST_MS,
  TRUE_SELF_LATE_CAST_MS,
  TRUE_SELF_LATE_SPAWN_TO_CAST_MS,
  LATE_TRUE_SELF_SPAWN_AT,
  LATE_TRUE_SELF_CAST_START_AT,
  LATE_TRUE_SELF_RESOLVE_AT,
  LATE_TRUE_SELF_DESPAWN_AT,
  TRUE_SELF_LENGTH,
  TERMINAL_ARROW_AT,
  TERMINAL_CIRCLE_SPAWN_ATS,
  TERMINAL_CIRCLE_DELAY_MS,
  TERMINAL_CIRCLE_RADIUS,
  TERMINAL_SHARE_ASSIGN_ATS,
  TERMINAL_SHARE_DELAY_MS,
  TERMINAL_SHARE_RADIUS,
  TERMINAL_SHARE_MIN_PLAYERS,
  TERMINAL_SHARE_MARKER_COLOR,
  TERMINAL_TOWER_ATS,
  TERMINAL_TOWER_SIDES,
  TERMINAL_TOWER_OFFSET,
  TERMINAL_TOWER_RADIUS,
  TERMINAL_TOWER_VISUAL_MS,
  TERMINAL_MOVEMENT_CHECK_AT,
  TERMINAL_SHARE_RETURN_AT,
  COMPLETE_AT,
  getChaosExplosionDirections,
  createBlackHoleCenters,
  calculateSlapAoeCenter,
  getVoidErosionTransition,
  isActorInsideRectangle,
};
