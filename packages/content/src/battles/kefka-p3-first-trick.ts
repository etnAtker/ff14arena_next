import type { BattleDefinition, BattleScriptContext } from '@ff14arena/core';
import { INJURY_UP_MULTIPLIER, createFacingTowards, distance } from '@ff14arena/core';
import type { BaseActorSnapshot, MapMarker, PartySlot, StatusId, Vector2 } from '@ff14arena/shared';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { getStatusDisplayName } from '../status-metadata';

type ElementType = 'fire' | 'water' | 'wind';
type PendingElementKind = 'fire' | 'water' | 'wind';
type WindStatusId = typeof CHAOS_WIND_STATUS_ID | typeof CHAOS_REVERSE_WIND_STATUS_ID;
type ChaosExplosionMode = 'longitude' | 'latitude';
type ChargeRotationSign = 1 | -1;

interface KefkaP3ElementBlock {
  type: ElementType;
  position: Vector2;
}

interface PendingElementResolution {
  kind: PendingElementKind;
  count: number;
  resolveAt: number;
}

interface ChaosExplosionState {
  mode: ChaosExplosionMode;
  facing: number;
  center: Vector2;
}

interface KefkaP3BossState {
  chaosCenter: Vector2;
  chaosFacing: number;
  exdeathCenter: Vector2;
  exdeathFacing: number;
}

interface ChargeState {
  baseDirection: number;
  rotationSign: ChargeRotationSign;
  outsideCenters: Vector2[];
}

const ARENA_RADIUS = 20;
const BOSS_TARGET_RING_RADIUS = 0;
const CENTER = { x: 0, y: 0 } as const satisfies Vector2;
const DEEP_AGONY_CAST_START_AT = 3_000;
const DEEP_AGONY_CAST_MS = 1_000;
const MECHANIC_START_AT = DEEP_AGONY_CAST_START_AT + DEEP_AGONY_CAST_MS;
const SHORT_ELEMENT_BUFF_MS = 19_000;
const LONG_ELEMENT_BUFF_MS = 46_000;
const WIND_BUFF_MS = 68_000;
const ELEMENT_BLOCK_RADIUS = 0.8;
const ELEMENT_BLOCK_LIFETIME_MS = 60_000;
const ELEMENT_CORNER_DISTANCE = 10;
const INJURY_DURATION_MS = 3_000;
const MECHANIC_DAMAGE = 1;
const FIRE_SELF_RADIUS = 5;
const FIRE_ELEMENT_INNER_RADIUS = 5;
const FIRE_ELEMENT_OUTER_RADIUS = 10;
const WATER_SELF_INNER_RADIUS = 5;
const WATER_SELF_OUTER_RADIUS = 10;
const WATER_ELEMENT_RADIUS = 5;
const WIND_SHARE_RADIUS = 6;
const WIND_SHARE_REQUIRED_PLAYERS = 2;
const BASE_ELEMENT_KNOCKBACK_DISTANCE = 20;
const DELAYED_RESOLUTION_MS = 1_500;
const TELEGRAPH_MS = 500;
const RESOLUTION_VISUAL_MS = 500;
const BURST_CAST_START_AT = 16_000;
const BURST_RESOLVE_AT = 23_000;
const BURST_CAST_MS = BURST_RESOLVE_AT - BURST_CAST_START_AT;
const BURST_RADIUS = 11;
const BURST_ST_OFFSET = 4;
const EXDEATH_MARKER_RADIUS = 0.8;
const EXDEATH_MARKER_COLOR = '#f97316';
const EXDEATH_TARGET_RING_RADIUS = 4;
const EXDEATH_TARGET_RING_COLOR = '#ef4444';
const EXDEATH_STABLE_MARKER_ID = 'kefka_p3_first_exdeath';
const FOLLOWUP_BURST_CAST_START_AT = 27_000;
const FOLLOWUP_BURST_FIRST_RESOLVE_AT = 33_000;
const FOLLOWUP_BURST_SECOND_RESOLVE_AT = 36_000;
const FOLLOWUP_BURST_CAST_MS = FOLLOWUP_BURST_FIRST_RESOLVE_AT - FOLLOWUP_BURST_CAST_START_AT;
const FOLLOWUP_BURST_RADIUS = 5;
const EXDEATH_REPOSITION_START_AT = 37_000;
const EXDEATH_REPOSITION_END_AT = 61_000;
const EXDEATH_REPOSITION_INTERVAL_MS = 1_000;
const CHAOS_EXPLOSION_CAST_START_AT = 41_000;
const CHAOS_EXPLOSION_FIRST_RESOLVE_AT = 46_000;
const CHAOS_EXPLOSION_SECOND_RESOLVE_AT = 48_000;
const CHAOS_EXPLOSION_CAST_MS = CHAOS_EXPLOSION_FIRST_RESOLVE_AT - CHAOS_EXPLOSION_CAST_START_AT;
const CHAOS_EXPLOSION_FAN_ANGLE = Math.PI / 2;
const CHAOS_EXPLOSION_FAN_RADIUS = 60;
const CHAOS_MARKER_SPAWN_AT = 3_000;
const CHAOS_REPOSITION_START_AT = 4_000;
const CHAOS_REPOSITION_END_AT = 41_000;
const CHAOS_REPOSITION_INTERVAL_MS = 1_000;
const CHAOS_MARKER_RADIUS = 0.8;
const CHAOS_MARKER_ST_OFFSET = 6;
const CHAOS_MARKER_TARGET_RING_RADIUS = 6;
const CHAOS_MARKER_TARGET_RING_COLOR = '#ef4444';
const CHAOS_STABLE_MARKER_ID = 'kefka_p3_first_chaos';
const VACUUM_WAVE_CAST_START_AT = 61_000;
const VACUUM_WAVE_RESOLVE_AT = 69_000;
const VACUUM_WAVE_CAST_MS = VACUUM_WAVE_RESOLVE_AT - VACUUM_WAVE_CAST_START_AT;
const VACUUM_WAVE_MT_OFFSET = 4;
const SUPER_JUMP_LOCK_AT = 61_000;
const SUPER_JUMP_RESOLVE_AT = 67_000;
const SUPER_JUMP_RADIUS = 11;
const CHARGE_MARKER_SPAWN_AT = 54_000;
const CHARGE_MARKER_OUTSIDE_AT = 62_000;
const CHARGE_MARKER_ROTATION_INTERVAL_MS = 2_000;
const CHARGE_MARKER_ROTATION_COUNT = 7;
const CHARGE_MARKER_DESPAWN_AT =
  CHARGE_MARKER_OUTSIDE_AT +
  (CHARGE_MARKER_ROTATION_COUNT + 1) * CHARGE_MARKER_ROTATION_INTERVAL_MS;
const CHARGE_INITIAL_DISTANCE = 16;
const CHARGE_OUTSIDE_DISTANCE = 25;
const CHARGE_MARKER_RADIUS = 0.8;
const CHARGE_MARKER_COLOR = '#a855f7';
const MAHJONG_ASSIGN_AT = 72_000;
const MAHJONG_MARKERS_RESOLVE_AT = 80_000;
const MAHJONG_FIRST_RESOLVE_AT = 84_000;
const MAHJONG_LAST_RESOLVE_AT = 85_750;
const MAHJONG_RECTANGLE_INTERVAL_MS = 250;
const MAHJONG_RECTANGLE_LENGTH = 50;
const MAHJONG_RECTANGLE_WIDTH = 12;
const MAHJONG_RECTANGLE_VISUAL_MS = 1_000;
const MAHJONG_MIN_DISTANCE = 40;
const MAHJONG_ODD_MARKER_COLOR = '#38bdf8';
const MAHJONG_EVEN_MARKER_COLOR = '#ef4444';
const COMPLETE_AT = MAHJONG_LAST_RESOLVE_AT + MAHJONG_RECTANGLE_VISUAL_MS;

const CHAOS_FIRE_STATUS_ID = 'kefka_p3_chaos_fire';
const CHAOS_WATER_STATUS_ID = 'kefka_p3_chaos_water';
const CHAOS_WIND_STATUS_ID = 'kefka_p3_chaos_wind';
const CHAOS_REVERSE_WIND_STATUS_ID = 'kefka_p3_chaos_reverse_wind';
const WIND_STATUS_IDS = [CHAOS_WIND_STATUS_ID, CHAOS_REVERSE_WIND_STATUS_ID] as const;
const WATER_TELEGRAPH_COLOR = '#38bdf8';
const WIND_TELEGRAPH_COLOR = '#22c55e';
const BURST_TELEGRAPH_COLOR = '#ffffff';
const TANK_HEALER_SLOTS = ['MT', 'ST', 'H1', 'H2'] as const satisfies readonly PartySlot[];
const DPS_SLOTS = ['D1', 'D2', 'D3', 'D4'] as const satisfies readonly PartySlot[];
const CHARGE_BASE_DIRECTIONS = [-Math.PI / 2, 0, Math.PI / 2, Math.PI] as const;
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
const ELEMENT_CORNERS = [
  { x: ELEMENT_CORNER_DISTANCE, y: -ELEMENT_CORNER_DISTANCE },
  { x: ELEMENT_CORNER_DISTANCE, y: ELEMENT_CORNER_DISTANCE },
  { x: -ELEMENT_CORNER_DISTANCE, y: ELEMENT_CORNER_DISTANCE },
  { x: -ELEMENT_CORNER_DISTANCE, y: -ELEMENT_CORNER_DISTANCE },
] as const satisfies readonly Vector2[];

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

function hasStatus(actor: BaseActorSnapshot, statusId: StatusId): boolean {
  return actor.statuses.some((status) => status.id === statusId);
}

function getWindStatus(actor: BaseActorSnapshot): WindStatusId | null {
  return WIND_STATUS_IDS.find((statusId) => hasStatus(actor, statusId)) ?? null;
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

function getActorsInsideDonut(
  actors: BaseActorSnapshot[],
  center: Vector2,
  innerRadius: number,
  outerRadius: number,
): BaseActorSnapshot[] {
  return actors.filter((actor) => {
    if (!actor.mechanicActive) {
      return false;
    }

    const hitDistance = distance(actor.position, center);

    return hitDistance >= innerRadius && hitDistance <= outerRadius;
  });
}

function getFreshActor(ctx: BattleScriptContext, actorId: string): BaseActorSnapshot | null {
  return getActorById(ctx.select.allPlayers(), actorId);
}

function applyKefkaP3Death(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  sourceLabel: string,
): void {
  const freshActor = getFreshActor(ctx, actor.id);

  if (freshActor === null || !freshActor.mechanicActive) {
    return;
  }

  ctx.damage.kill([freshActor.id], sourceLabel);
}

function applyKefkaP3Damage(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  sourceLabel: string,
): void {
  const freshActor = getFreshActor(ctx, actor.id);

  if (freshActor === null || !freshActor.mechanicActive) {
    return;
  }

  if (hasStatus(freshActor, 'injury_up')) {
    applyKefkaP3Death(ctx, freshActor, sourceLabel);
    return;
  }

  ctx.damage.apply([freshActor.id], MECHANIC_DAMAGE, sourceLabel);
  ctx.status.apply([freshActor.id], 'injury_up', INJURY_DURATION_MS, {
    multiplier: INJURY_UP_MULTIPLIER,
    name: getStatusDisplayName('injury_up'),
  });
}

function getPendingResolutions(ctx: BattleScriptContext): PendingElementResolution[] {
  return ctx.state.getValue<PendingElementResolution[]>('kefkaP3:pendingResolutions') ?? [];
}

function setPendingResolutions(
  ctx: BattleScriptContext,
  pendingResolutions: PendingElementResolution[],
): void {
  ctx.state.setValue('kefkaP3:pendingResolutions', pendingResolutions);
}

function queueElementResolution(
  ctx: BattleScriptContext,
  kind: PendingElementKind,
  count = 1,
): void {
  const resolveAt = ctx.state.getBattleTime() + DELAYED_RESOLUTION_MS;
  const pendingResolutions = getPendingResolutions(ctx);
  const existingResolution = pendingResolutions.find(
    (resolution) => resolution.kind === kind && resolution.resolveAt === resolveAt,
  );

  if (existingResolution === undefined) {
    pendingResolutions.push({ kind, count, resolveAt });
    ctx.timeline.at(resolveAt, () => resolvePendingElementResolutions(ctx, resolveAt));
  } else {
    existingResolution.count += count;
  }

  setPendingResolutions(ctx, pendingResolutions);
}

function createElementBlocks(): KefkaP3ElementBlock[] {
  const windCornerIndex = Math.floor(Math.random() * ELEMENT_CORNERS.length);
  const adjacentCornerIndexes: [number, number] = [
    (windCornerIndex + ELEMENT_CORNERS.length - 1) % ELEMENT_CORNERS.length,
    (windCornerIndex + 1) % ELEMENT_CORNERS.length,
  ];
  const fireCornerIndex = Math.random() < 0.5 ? adjacentCornerIndexes[0] : adjacentCornerIndexes[1];
  const waterCornerIndex =
    fireCornerIndex === adjacentCornerIndexes[0]
      ? adjacentCornerIndexes[1]
      : adjacentCornerIndexes[0];

  return [
    { type: 'fire', position: ELEMENT_CORNERS[fireCornerIndex]! },
    { type: 'wind', position: ELEMENT_CORNERS[windCornerIndex]! },
    { type: 'water', position: ELEMENT_CORNERS[waterCornerIndex]! },
  ];
}

function getElementBlocks(ctx: BattleScriptContext): KefkaP3ElementBlock[] {
  return ctx.state.getValue<KefkaP3ElementBlock[]>('kefkaP3:elementBlocks') ?? [];
}

function getElementBlock(ctx: BattleScriptContext, type: ElementType): KefkaP3ElementBlock {
  const elementBlock = getElementBlocks(ctx).find((block) => block.type === type);

  if (elementBlock === undefined) {
    throw new Error(`missing kefka p3 element block ${type}`);
  }

  return elementBlock;
}

function calculateBurstCenter(tankPosition: Vector2): Vector2 {
  const distanceToCenter = Math.hypot(tankPosition.x, tankPosition.y);

  if (distanceToCenter <= BURST_ST_OFFSET) {
    return { ...CENTER };
  }

  const centerScale = (distanceToCenter - BURST_ST_OFFSET) / distanceToCenter;

  return {
    x: tankPosition.x * centerScale,
    y: tankPosition.y * centerScale,
  };
}

function calculateVacuumWaveCenter(exdeathPosition: Vector2, mtPosition: Vector2): Vector2 {
  const distanceToMt = distance(exdeathPosition, mtPosition);

  if (distanceToMt <= VACUUM_WAVE_MT_OFFSET) {
    return { ...exdeathPosition };
  }

  const scaleFromMt = VACUUM_WAVE_MT_OFFSET / distanceToMt;

  return {
    x: mtPosition.x + (exdeathPosition.x - mtPosition.x) * scaleFromMt,
    y: mtPosition.y + (exdeathPosition.y - mtPosition.y) * scaleFromMt,
  };
}

function calculateChaosCenter(chaosPosition: Vector2, stPosition: Vector2): Vector2 {
  const distanceToSt = distance(chaosPosition, stPosition);

  if (distanceToSt <= CHAOS_MARKER_ST_OFFSET) {
    return { ...chaosPosition };
  }

  const scaleFromSt = CHAOS_MARKER_ST_OFFSET / distanceToSt;

  return {
    x: stPosition.x + (chaosPosition.x - stPosition.x) * scaleFromSt,
    y: stPosition.y + (chaosPosition.y - stPosition.y) * scaleFromSt,
  };
}

function getBossState(ctx: BattleScriptContext): KefkaP3BossState {
  return (
    ctx.state.getValue<KefkaP3BossState>('kefkaP3:bosses') ?? {
      chaosCenter: CENTER,
      chaosFacing: 0,
      exdeathCenter: CENTER,
      exdeathFacing: 0,
    }
  );
}

function setBossState(ctx: BattleScriptContext, state: KefkaP3BossState): void {
  ctx.state.setValue('kefkaP3:bosses', state);
  ctx.state.setValue('kefkaP3:chaosCenter', state.chaosCenter);
  ctx.state.setValue('kefkaP3:burstCenter', state.exdeathCenter);
}

function updateChaosBossState(
  ctx: BattleScriptContext,
  center: Vector2,
  facing: number,
): KefkaP3BossState {
  const nextState = {
    ...getBossState(ctx),
    chaosCenter: center,
    chaosFacing: facing,
  };

  setBossState(ctx, nextState);
  return nextState;
}

function updateExdeathBossState(
  ctx: BattleScriptContext,
  center: Vector2,
  facing: number,
): KefkaP3BossState {
  const nextState = {
    ...getBossState(ctx),
    exdeathCenter: center,
    exdeathFacing: facing,
  };

  setBossState(ctx, nextState);
  return nextState;
}

function getBurstCenter(ctx: BattleScriptContext): Vector2 {
  const burstCenter =
    ctx.state.getValue<KefkaP3BossState>('kefkaP3:bosses')?.exdeathCenter ??
    ctx.state.getValue<Vector2>('kefkaP3:burstCenter');

  if (burstCenter === undefined) {
    throw new Error('missing kefka p3 burst center');
  }

  return burstCenter;
}

function getChaosCenter(ctx: BattleScriptContext): Vector2 {
  const chaosCenter =
    ctx.state.getValue<KefkaP3BossState>('kefkaP3:bosses')?.chaosCenter ??
    ctx.state.getValue<Vector2>('kefkaP3:chaosCenter');

  if (chaosCenter === undefined) {
    throw new Error('missing kefka p3 chaos center');
  }

  return chaosCenter;
}

function getChaosExplosionState(ctx: BattleScriptContext): ChaosExplosionState {
  const state = ctx.state.getValue<ChaosExplosionState>('kefkaP3:chaosExplosion');

  if (state === undefined) {
    throw new Error('missing kefka p3 chaos explosion state');
  }

  return state;
}

function getPartySlotOrderIndex(actor: BaseActorSnapshot): number {
  return actor.slot === null ? Number.MAX_SAFE_INTEGER : PARTY_SLOT_ORDER.indexOf(actor.slot);
}

function getNearestAlivePlayerToPoint(
  actors: BaseActorSnapshot[],
  source: Vector2,
): BaseActorSnapshot | null {
  return (
    actors
      .filter((actor) => actor.mechanicActive)
      .sort((left, right) => {
        const distanceDelta = distance(left.position, source) - distance(right.position, source);

        if (distanceDelta !== 0) {
          return distanceDelta;
        }

        return getPartySlotOrderIndex(left) - getPartySlotOrderIndex(right);
      })[0] ?? null
  );
}

function getFarthestAlivePlayerFromPoint(
  actors: BaseActorSnapshot[],
  source: Vector2,
): BaseActorSnapshot | null {
  return (
    actors
      .filter((actor) => actor.mechanicActive)
      .sort((left, right) => {
        const distanceDelta = distance(right.position, source) - distance(left.position, source);

        if (distanceDelta !== 0) {
          return distanceDelta;
        }

        return getPartySlotOrderIndex(left) - getPartySlotOrderIndex(right);
      })[0] ?? null
  );
}

function getSuperJumpCenter(ctx: BattleScriptContext): Vector2 {
  const center = ctx.state.getValue<Vector2>('kefkaP3:superJumpCenter');

  if (center === undefined) {
    throw new Error('missing kefka p3 super jump center');
  }

  return center;
}

function createPointOnDirection(direction: number, radius: number): Vector2 {
  return {
    x: Math.cos(direction) * radius,
    y: Math.sin(direction) * radius,
  };
}

function createChargeOutsideCenters(
  baseDirection: number,
  rotationSign: ChargeRotationSign,
): Vector2[] {
  return Array.from({ length: CHARGE_MARKER_ROTATION_COUNT + 1 }, (_, index) =>
    createPointOnDirection(
      baseDirection + rotationSign * (Math.PI / 4) * index,
      CHARGE_OUTSIDE_DISTANCE,
    ),
  );
}

function createChargeState(): ChargeState {
  const baseDirection =
    CHARGE_BASE_DIRECTIONS[Math.floor(Math.random() * CHARGE_BASE_DIRECTIONS.length)]!;
  const rotationSign: ChargeRotationSign = Math.random() < 0.5 ? 1 : -1;

  return {
    baseDirection,
    rotationSign,
    outsideCenters: createChargeOutsideCenters(baseDirection, rotationSign),
  };
}

function getChargeState(ctx: BattleScriptContext): ChargeState {
  const state = ctx.state.getValue<ChargeState>('kefkaP3:chargeState');

  if (state === undefined) {
    throw new Error('missing kefka p3 charge state');
  }

  return state;
}

function getMahjongAssignments(ctx: BattleScriptContext): string[] {
  const assignments = ctx.state.getValue<string[]>('kefkaP3:mahjongAssignments');

  if (assignments === undefined) {
    throw new Error('missing kefka p3 mahjong assignments');
  }

  return assignments;
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

  if (distance(actor.position, center) === 0) {
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

function spawnElementBlocks(ctx: BattleScriptContext, elementBlocks: KefkaP3ElementBlock[]): void {
  for (const elementBlock of elementBlocks) {
    const blockOptions =
      elementBlock.type === 'fire'
        ? { label: '火元素块', shape: 'triangle' as const, color: '#ef4444' }
        : elementBlock.type === 'water'
          ? { label: '水元素块', shape: 'square' as const, color: '#38bdf8' }
          : { label: '风元素块', shape: 'diamond' as const, color: '#22c55e' };

    ctx.spawn.fieldMarker({
      ...blockOptions,
      center: elementBlock.position,
      radius: ELEMENT_BLOCK_RADIUS,
      resolveAfterMs: ELEMENT_BLOCK_LIFETIME_MS,
    });
  }
}

function applyContentStatus(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  statusId: StatusId,
  durationMs: number,
): void {
  ctx.status.apply([actor.id], statusId, durationMs, {
    name: getStatusDisplayName(statusId),
  });
}

function assignWindStatuses(ctx: BattleScriptContext, actors: BaseActorSnapshot[]): void {
  const shuffledActors = shuffle(actors);

  for (const [index, actor] of shuffledActors.entries()) {
    applyContentStatus(
      ctx,
      actor,
      index < shuffledActors.length / 2 ? CHAOS_WIND_STATUS_ID : CHAOS_REVERSE_WIND_STATUS_ID,
      WIND_BUFF_MS,
    );
  }
}

function assignElementStatuses(ctx: BattleScriptContext, actors: BaseActorSnapshot[]): void {
  const fireDurationMs = Math.random() < 0.5 ? SHORT_ELEMENT_BUFF_MS : LONG_ELEMENT_BUFF_MS;
  const waterDurationMs =
    fireDurationMs === SHORT_ELEMENT_BUFF_MS ? LONG_ELEMENT_BUFF_MS : SHORT_ELEMENT_BUFF_MS;
  const selectedTankHealerSlots = shuffle(TANK_HEALER_SLOTS).slice(0, 2);
  const selectedDpsSlots = shuffle(DPS_SLOTS).slice(0, 2);
  const fireSlots = [selectedTankHealerSlots[0]!, selectedDpsSlots[0]!] as const;
  const waterSlots = [selectedTankHealerSlots[1]!, selectedDpsSlots[1]!] as const;

  ctx.state.setValue('kefkaP3:elementStatusDurations', {
    fire: fireDurationMs,
    water: waterDurationMs,
  });

  for (const slot of fireSlots) {
    const actor = getActorBySlot(actors, slot);
    applyContentStatus(ctx, actor, CHAOS_FIRE_STATUS_ID, fireDurationMs);
    ctx.timeline.at(MECHANIC_START_AT + fireDurationMs, () => resolveFireBuff(ctx, actor.id));
  }

  for (const slot of waterSlots) {
    const actor = getActorBySlot(actors, slot);
    applyContentStatus(ctx, actor, CHAOS_WATER_STATUS_ID, waterDurationMs);
    ctx.timeline.at(MECHANIC_START_AT + waterDurationMs, () => resolveWaterBuff(ctx, actor.id));
  }
}

function assignInitialStatuses(ctx: BattleScriptContext): void {
  const actors = ctx.select.allPlayers();

  assignWindStatuses(ctx, actors);
  assignElementStatuses(ctx, actors);
}

function resolveFireBuff(ctx: BattleScriptContext, actorId: string): void {
  const actor = getFreshActor(ctx, actorId);

  ctx.status.remove([actorId], CHAOS_FIRE_STATUS_ID);
  queueElementResolution(ctx, 'fire');

  if (actor === null || !actor.mechanicActive) {
    return;
  }

  ctx.spawn.circleTelegraph({
    label: '混沌之炎预兆',
    center: actor.position,
    radius: FIRE_SELF_RADIUS,
    resolveAfterMs: TELEGRAPH_MS,
  });

  ctx.timeline.at(ctx.state.getBattleTime() + TELEGRAPH_MS, () => {
    for (const hit of getActorsInsideCircle(
      ctx.select.allPlayers(),
      actor.position,
      FIRE_SELF_RADIUS,
    )) {
      applyKefkaP3Damage(ctx, hit, '混沌之炎');
    }
  });
}

function resolveWaterBuff(ctx: BattleScriptContext, actorId: string): void {
  const actor = getFreshActor(ctx, actorId);

  ctx.status.remove([actorId], CHAOS_WATER_STATUS_ID);
  queueElementResolution(ctx, 'water');

  if (actor === null || !actor.mechanicActive) {
    return;
  }

  ctx.spawn.donutTelegraph({
    label: '混沌之水预兆',
    center: actor.position,
    innerRadius: WATER_SELF_INNER_RADIUS,
    outerRadius: WATER_SELF_OUTER_RADIUS,
    color: WATER_TELEGRAPH_COLOR,
    resolveAfterMs: TELEGRAPH_MS,
  });

  ctx.timeline.at(ctx.state.getBattleTime() + TELEGRAPH_MS, () => {
    for (const hit of getActorsInsideDonut(
      ctx.select.allPlayers(),
      actor.position,
      WATER_SELF_INNER_RADIUS,
      WATER_SELF_OUTER_RADIUS,
    )) {
      applyKefkaP3Damage(ctx, hit, '混沌之水');
    }
  });
}

function selectNearestDistinctActors(
  actors: BaseActorSnapshot[],
  point: Vector2,
  count: number,
): BaseActorSnapshot[] {
  return [...actors]
    .filter((actor) => actor.mechanicActive)
    .sort((left, right) => {
      const distanceDiff = distance(left.position, point) - distance(right.position, point);

      if (Math.abs(distanceDiff) > 0.0001) {
        return distanceDiff;
      }

      return PARTY_SLOT_ORDER.indexOf(left.slot!) - PARTY_SLOT_ORDER.indexOf(right.slot!);
    })
    .slice(0, count);
}

function getAngleDiff(left: number, right: number): number {
  const diff = Math.abs(left - right) % (Math.PI * 2);

  return diff > Math.PI ? Math.PI * 2 - diff : diff;
}

function isFacingSource(actor: BaseActorSnapshot, source: Vector2): boolean {
  return getAngleDiff(actor.facing, createFacingTowards(actor.position, source)) <= Math.PI / 2;
}

function getKnockbackDistance(actor: BaseActorSnapshot, source: Vector2): number {
  const windStatus = getWindStatus(actor);

  if (windStatus === null) {
    return BASE_ELEMENT_KNOCKBACK_DISTANCE;
  }

  const facingSource = isFacingSource(actor, source);

  if (windStatus === CHAOS_WIND_STATUS_ID) {
    return facingSource ? BASE_ELEMENT_KNOCKBACK_DISTANCE * 2 : BASE_ELEMENT_KNOCKBACK_DISTANCE / 2;
  }

  return facingSource ? BASE_ELEMENT_KNOCKBACK_DISTANCE / 2 : BASE_ELEMENT_KNOCKBACK_DISTANCE * 2;
}

function consumeWindStatusAfterElementKnockback(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
): void {
  const freshActor = getFreshActor(ctx, actor.id);

  if (freshActor === null || !freshActor.mechanicActive) {
    return;
  }

  const windStatus = getWindStatus(freshActor);

  if (windStatus === null) {
    return;
  }

  ctx.status.remove([freshActor.id], windStatus);
  queueElementResolution(ctx, 'wind');
}

function applyElementKnockback(
  ctx: BattleScriptContext,
  hits: BaseActorSnapshot[],
  source: Vector2,
  ignoredActorId?: string,
): void {
  for (const hit of hits) {
    if (hit.id === ignoredActorId) {
      continue;
    }

    const freshActor = getFreshActor(ctx, hit.id);

    if (freshActor === null || !freshActor.mechanicActive) {
      continue;
    }

    const knockbackDistance = getKnockbackDistance(freshActor, source);
    ctx.displacement.knockback([freshActor.id], source, knockbackDistance);
    consumeWindStatusAfterElementKnockback(ctx, freshActor);
  }
}

function applyVacuumWaveKnockback(ctx: BattleScriptContext, source: Vector2): void {
  for (const hit of ctx.select.allPlayers()) {
    const freshActor = getFreshActor(ctx, hit.id);

    if (freshActor === null || !freshActor.mechanicActive || freshActor.knockbackImmune) {
      continue;
    }

    const knockbackDistance = getKnockbackDistance(freshActor, source);
    ctx.displacement.knockback([freshActor.id], source, knockbackDistance);
    consumeWindStatusAfterElementKnockback(ctx, freshActor);
  }
}

function resolveFireElement(ctx: BattleScriptContext, count: number): void {
  const fireElement = getElementBlock(ctx, 'fire');
  const targets = selectNearestDistinctActors(ctx.select.allPlayers(), fireElement.position, count);

  for (const target of targets) {
    ctx.spawn.donutTelegraph({
      label: '火元素追击范围',
      center: target.position,
      innerRadius: FIRE_ELEMENT_INNER_RADIUS,
      outerRadius: FIRE_ELEMENT_OUTER_RADIUS,
      resolveAfterMs: RESOLUTION_VISUAL_MS,
    });

    const actors = ctx.select.allPlayers();
    const hits = getActorsInsideDonut(
      actors,
      target.position,
      FIRE_ELEMENT_INNER_RADIUS,
      FIRE_ELEMENT_OUTER_RADIUS,
    );

    for (const hit of hits) {
      applyKefkaP3Damage(ctx, hit, '火元素块');
    }

    applyElementKnockback(ctx, hits, fireElement.position, target.id);
  }
}

function resolveWaterElement(ctx: BattleScriptContext, count: number): void {
  const waterElement = getElementBlock(ctx, 'water');
  const targets = selectNearestDistinctActors(
    ctx.select.allPlayers(),
    waterElement.position,
    count,
  );

  for (const target of targets) {
    ctx.spawn.circleTelegraph({
      label: '水元素追击范围',
      center: target.position,
      radius: WATER_ELEMENT_RADIUS,
      color: WATER_TELEGRAPH_COLOR,
      resolveAfterMs: RESOLUTION_VISUAL_MS,
    });

    const actors = ctx.select.allPlayers();
    const hits = getActorsInsideCircle(actors, target.position, WATER_ELEMENT_RADIUS);

    for (const hit of hits) {
      applyKefkaP3Damage(ctx, hit, '水元素块');
    }

    applyElementKnockback(ctx, hits, waterElement.position, target.id);
  }
}

function resolveWindShare(ctx: BattleScriptContext, count: number): void {
  const windElement = getElementBlock(ctx, 'wind');
  const targets = selectNearestDistinctActors(ctx.select.allPlayers(), windElement.position, count);

  for (const target of targets) {
    ctx.spawn.circleTelegraph({
      label: '混沌之风分摊范围',
      center: target.position,
      radius: WIND_SHARE_RADIUS,
      color: WIND_TELEGRAPH_COLOR,
      resolveAfterMs: RESOLUTION_VISUAL_MS,
    });

    const hits = getActorsInsideCircle(ctx.select.allPlayers(), target.position, WIND_SHARE_RADIUS);

    if (hits.length < WIND_SHARE_REQUIRED_PLAYERS) {
      ctx.state.fail('混沌之风分摊人数不足');
      applyKefkaP3Death(ctx, target, '混沌之风分摊人数不足');
      continue;
    }

    for (const hit of hits) {
      applyKefkaP3Damage(ctx, hit, '混沌之风分摊');
    }
  }
}

function resolvePendingElementResolutions(ctx: BattleScriptContext, resolveAt: number): void {
  const pendingResolutions = getPendingResolutions(ctx);
  const dueResolutions = pendingResolutions.filter(
    (resolution) => resolution.resolveAt <= resolveAt,
  );

  if (dueResolutions.length === 0) {
    return;
  }

  setPendingResolutions(
    ctx,
    pendingResolutions.filter((resolution) => resolution.resolveAt > resolveAt),
  );

  for (const kind of ['fire', 'water', 'wind'] as const satisfies readonly PendingElementKind[]) {
    const count = dueResolutions
      .filter((resolution) => resolution.kind === kind)
      .reduce((sum, resolution) => sum + resolution.count, 0);

    if (count === 0) {
      continue;
    }

    if (kind === 'fire') {
      resolveFireElement(ctx, count);
    } else if (kind === 'water') {
      resolveWaterElement(ctx, count);
    } else {
      resolveWindShare(ctx, count);
    }
  }
}

function spawnExdeathMarker(
  ctx: BattleScriptContext,
  center: Vector2,
  resolveAfterMs: number,
  direction = getBossState(ctx).exdeathFacing,
): void {
  ctx.spawn.fieldMarker({
    label: '艾克斯德司',
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

function startBurstCast(ctx: BattleScriptContext): void {
  const mt = getActorBySlot(ctx.select.allPlayers(), 'MT');
  const burstCenter = calculateBurstCenter(mt.position);
  const facing =
    distance(burstCenter, mt.position) <= 0.0001
      ? getBossState(ctx).exdeathFacing
      : createFacingTowards(burstCenter, mt.position);

  updateExdeathBossState(ctx, burstCenter, facing);
  ctx.boss.cast('kefka_p3_burst', '暴雷', BURST_CAST_MS);
  spawnExdeathMarker(ctx, burstCenter, EXDEATH_REPOSITION_START_AT - BURST_CAST_START_AT, facing);
}

function resolveBurst(ctx: BattleScriptContext): void {
  const burstCenter = getBurstCenter(ctx);

  ctx.boss.clearCast();
  ctx.spawn.circleTelegraph({
    label: '暴雷范围',
    center: burstCenter,
    radius: BURST_RADIUS,
    color: BURST_TELEGRAPH_COLOR,
    resolveAfterMs: RESOLUTION_VISUAL_MS,
  });

  for (const hit of getActorsInsideCircle(ctx.select.allPlayers(), burstCenter, BURST_RADIUS)) {
    applyKefkaP3Death(ctx, hit, '被暴雷命中');
  }
}

function startVacuumWaveCast(ctx: BattleScriptContext): void {
  const mt = getActorBySlot(ctx.select.allPlayers(), 'MT');
  const exdeathCenter = getBurstCenter(ctx);
  const vacuumWaveCenter = calculateVacuumWaveCenter(exdeathCenter, mt.position);
  const facing =
    distance(vacuumWaveCenter, mt.position) <= 0.0001
      ? getBossState(ctx).exdeathFacing
      : createFacingTowards(vacuumWaveCenter, mt.position);

  updateExdeathBossState(ctx, vacuumWaveCenter, facing);
  ctx.boss.cast('kefka_p3_vacuum_wave', '真空波', VACUUM_WAVE_CAST_MS);
  spawnExdeathMarker(ctx, vacuumWaveCenter, COMPLETE_AT - VACUUM_WAVE_CAST_START_AT, facing);
}

function repositionExdeathTowardMt(ctx: BattleScriptContext): void {
  const mt = getActorBySlot(ctx.select.allPlayers(), 'MT');
  const exdeathCenter = getBurstCenter(ctx);
  const nextCenter = calculateVacuumWaveCenter(exdeathCenter, mt.position);
  const facing =
    distance(nextCenter, mt.position) <= 0.0001
      ? getBossState(ctx).exdeathFacing
      : createFacingTowards(nextCenter, mt.position);

  updateExdeathBossState(ctx, nextCenter, facing);
  spawnExdeathMarker(ctx, nextCenter, EXDEATH_REPOSITION_INTERVAL_MS, facing);
}

function resolveVacuumWave(ctx: BattleScriptContext): void {
  const exdeathCenter = getBurstCenter(ctx);

  ctx.boss.clearCast();
  applyVacuumWaveKnockback(ctx, exdeathCenter);
}

function startFollowupBurstCast(ctx: BattleScriptContext): void {
  ctx.boss.cast('kefka_p3_followup_burst', '暴雷', FOLLOWUP_BURST_CAST_MS);
}

function resolveFollowupBurst(ctx: BattleScriptContext, options?: { clearCast?: boolean }): void {
  const burstCenter = getBurstCenter(ctx);
  const target = getNearestAlivePlayerToPoint(ctx.select.allPlayers(), burstCenter);

  if (options?.clearCast ?? false) {
    ctx.boss.clearCast();
  }

  if (target === null) {
    return;
  }

  const facing = createFacingTowards(burstCenter, target.position);
  updateExdeathBossState(ctx, burstCenter, facing);
  spawnExdeathMarker(
    ctx,
    burstCenter,
    EXDEATH_REPOSITION_START_AT - ctx.state.getBattleTime(),
    facing,
  );

  ctx.spawn.circleTelegraph({
    label: '暴雷范围',
    center: target.position,
    radius: FOLLOWUP_BURST_RADIUS,
    color: BURST_TELEGRAPH_COLOR,
    resolveAfterMs: RESOLUTION_VISUAL_MS,
  });

  const hits = getActorsInsideCircle(
    ctx.select.allPlayers(),
    target.position,
    FOLLOWUP_BURST_RADIUS,
  );

  for (const hit of hits) {
    if (hit.slot === 'MT' || hit.slot === 'ST') {
      applyKefkaP3Damage(ctx, hit, '暴雷');
    } else {
      applyKefkaP3Death(ctx, hit, '被暴雷命中');
    }
  }
}

function getChaosExplosionActionName(mode: ChaosExplosionMode): string {
  return mode === 'longitude' ? '经度聚爆' : '纬度聚爆';
}

function getChaosExplosionDirections(
  state: ChaosExplosionState,
  resolveAt: number,
): readonly [number, number] {
  const shouldResolveFrontBack =
    state.mode === 'longitude'
      ? resolveAt === CHAOS_EXPLOSION_FIRST_RESOLVE_AT
      : resolveAt === CHAOS_EXPLOSION_SECOND_RESOLVE_AT;

  if (shouldResolveFrontBack) {
    return [state.facing, state.facing + Math.PI];
  }

  return [state.facing - Math.PI / 2, state.facing + Math.PI / 2];
}

function spawnChaosMarker(
  ctx: BattleScriptContext,
  center: Vector2,
  resolveAfterMs: number,
  direction = getBossState(ctx).chaosFacing,
): void {
  ctx.spawn.fieldMarker({
    label: '卡奥斯',
    center,
    shape: 'enemy',
    stableId: CHAOS_STABLE_MARKER_ID,
    radius: CHAOS_MARKER_RADIUS,
    direction,
    targetRingRadius: CHAOS_MARKER_TARGET_RING_RADIUS,
    targetRingColor: CHAOS_MARKER_TARGET_RING_COLOR,
    resolveAfterMs,
  });
}

function spawnInitialChaosMarker(ctx: BattleScriptContext): void {
  const st = getActorBySlot(ctx.select.allPlayers(), 'ST');
  const facing =
    distance(CENTER, st.position) <= 0.0001
      ? getBossState(ctx).chaosFacing
      : createFacingTowards(CENTER, st.position);

  updateChaosBossState(ctx, CENTER, facing);
  spawnChaosMarker(ctx, CENTER, CHAOS_REPOSITION_START_AT - CHAOS_MARKER_SPAWN_AT, facing);
}

function repositionChaosTowardSt(ctx: BattleScriptContext): void {
  const st = getActorBySlot(ctx.select.allPlayers(), 'ST');
  const nextCenter = calculateChaosCenter(getChaosCenter(ctx), st.position);
  const facing =
    distance(nextCenter, st.position) <= 0.0001
      ? getBossState(ctx).chaosFacing
      : createFacingTowards(nextCenter, st.position);

  updateChaosBossState(ctx, nextCenter, facing);
  spawnChaosMarker(ctx, nextCenter, CHAOS_REPOSITION_INTERVAL_MS, facing);
}

function startChaosExplosionCast(ctx: BattleScriptContext): void {
  const st = getActorBySlot(ctx.select.allPlayers(), 'ST');
  const center = getChaosCenter(ctx);
  const mode: ChaosExplosionMode = Math.random() < 0.5 ? 'longitude' : 'latitude';
  const facing =
    distance(st.position, center) <= 0.0001 ? 0 : createFacingTowards(center, st.position);
  const actionName = getChaosExplosionActionName(mode);

  updateChaosBossState(ctx, center, facing);
  ctx.state.setValue<ChaosExplosionState>('kefkaP3:chaosExplosion', { mode, facing, center });
  ctx.boss.cast(`kefka_p3_${mode}_explosion`, actionName, CHAOS_EXPLOSION_CAST_MS);
  spawnChaosMarker(ctx, center, SUPER_JUMP_RESOLVE_AT - CHAOS_EXPLOSION_CAST_START_AT, facing);
}

function resolveChaosExplosion(ctx: BattleScriptContext, resolveAt: number): void {
  const state = getChaosExplosionState(ctx);
  const actionName = getChaosExplosionActionName(state.mode);
  const directions = getChaosExplosionDirections(state, resolveAt);
  const hitActorIds = new Set<string>();

  if (resolveAt === CHAOS_EXPLOSION_FIRST_RESOLVE_AT) {
    ctx.boss.clearCast();
  }

  for (const direction of directions) {
    ctx.spawn.fanTelegraph({
      label: `${actionName}范围`,
      center: state.center,
      direction,
      angle: CHAOS_EXPLOSION_FAN_ANGLE,
      radius: CHAOS_EXPLOSION_FAN_RADIUS,
      resolveAfterMs: RESOLUTION_VISUAL_MS,
    });

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
    const hit = getActorById(ctx.select.allPlayers(), hitActorId);

    if (hit !== null) {
      applyKefkaP3Death(ctx, hit, '被扇形命中');
    }
  }
}

function lockSuperJumpTarget(ctx: BattleScriptContext): void {
  const target = getFarthestAlivePlayerFromPoint(ctx.select.allPlayers(), CENTER);

  if (target === null) {
    return;
  }

  ctx.state.setValue('kefkaP3:superJumpCenter', { ...target.position });
}

function resolveSuperJump(ctx: BattleScriptContext): void {
  const superJumpCenter = getSuperJumpCenter(ctx);
  const facing = getBossState(ctx).chaosFacing;

  updateChaosBossState(ctx, superJumpCenter, facing);
  spawnChaosMarker(ctx, superJumpCenter, COMPLETE_AT - SUPER_JUMP_RESOLVE_AT, facing);
  ctx.spawn.circleTelegraph({
    label: '超级跳范围',
    center: superJumpCenter,
    radius: SUPER_JUMP_RADIUS,
    resolveAfterMs: RESOLUTION_VISUAL_MS,
  });

  for (const hit of getActorsInsideCircle(
    ctx.select.allPlayers(),
    superJumpCenter,
    SUPER_JUMP_RADIUS,
  )) {
    applyKefkaP3Death(ctx, hit, '被超级跳命中');
  }
}

function spawnChargeMarker(
  ctx: BattleScriptContext,
  center: Vector2,
  resolveAfterMs: number,
): void {
  ctx.spawn.fieldMarker({
    label: '冲锋点',
    center,
    shape: 'circle',
    radius: CHARGE_MARKER_RADIUS,
    color: CHARGE_MARKER_COLOR,
    resolveAfterMs,
  });
}

function startChargeMarker(ctx: BattleScriptContext): void {
  const chargeState = createChargeState();

  ctx.state.setValue<ChargeState>('kefkaP3:chargeState', chargeState);
  spawnChargeMarker(
    ctx,
    createPointOnDirection(chargeState.baseDirection, CHARGE_INITIAL_DISTANCE),
    CHARGE_MARKER_OUTSIDE_AT - CHARGE_MARKER_SPAWN_AT,
  );
}

function spawnChargeOutsideMarker(ctx: BattleScriptContext, index: number): void {
  const chargeState = getChargeState(ctx);
  const center = chargeState.outsideCenters[index];

  if (center === undefined) {
    return;
  }

  spawnChargeMarker(ctx, center, CHARGE_MARKER_ROTATION_INTERVAL_MS);
}

function assignMahjongOrders(ctx: BattleScriptContext): void {
  const assignments = shuffle(
    ctx.select.allPlayers().filter((actor) => actor.mechanicActive),
  ).slice(0, 8);

  ctx.state.setValue(
    'kefkaP3:mahjongAssignments',
    assignments.map((actor) => actor.id),
  );

  for (const [index, actor] of assignments.entries()) {
    const order = index + 1;

    ctx.spawn.actorMarker({
      label: `${order}`,
      target: actor,
      markerShape: 'circleDot',
      color: order % 2 === 1 ? MAHJONG_ODD_MARKER_COLOR : MAHJONG_EVEN_MARKER_COLOR,
      resolveAfterMs: MAHJONG_MARKERS_RESOLVE_AT - MAHJONG_ASSIGN_AT,
    });
  }
}

function resolveMahjongRectangle(ctx: BattleScriptContext, index: number): void {
  const chargeState = getChargeState(ctx);
  const assignments = getMahjongAssignments(ctx);
  const source = chargeState.outsideCenters[index];
  const targetActorId = assignments[index];

  if (source === undefined || targetActorId === undefined) {
    return;
  }

  const target = getFreshActor(ctx, targetActorId);

  if (target === null || !target.mechanicActive) {
    return;
  }

  const direction =
    distance(source, target.position) <= 0.0001 ? 0 : createFacingTowards(source, target.position);

  ctx.spawn.rectangleTelegraph({
    label: '冲锋矩形',
    center: source,
    direction,
    length: MAHJONG_RECTANGLE_LENGTH,
    width: MAHJONG_RECTANGLE_WIDTH,
    color: CHARGE_MARKER_COLOR,
    resolveAfterMs: MAHJONG_RECTANGLE_VISUAL_MS,
  });

  if (distance(source, target.position) < MAHJONG_MIN_DISTANCE) {
    applyKefkaP3Death(ctx, target, '麻将距离过近');
  }

  for (const hit of ctx.select.allPlayers()) {
    if (hit.id === target.id) {
      continue;
    }

    if (
      isActorInsideRectangle(
        hit,
        source,
        direction,
        MAHJONG_RECTANGLE_LENGTH,
        MAHJONG_RECTANGLE_WIDTH,
      )
    ) {
      applyKefkaP3Death(ctx, hit, '麻将被其它人的矩形命中');
    }
  }
}

function buildKefkaP3Script(ctx: BattleScriptContext): void {
  setBossState(ctx, {
    chaosCenter: CENTER,
    chaosFacing: 0,
    exdeathCenter: CENTER,
    exdeathFacing: 0,
  });

  ctx.timeline.at(DEEP_AGONY_CAST_START_AT, () => {
    ctx.boss.cast('kefka_p3_deep_agony', '深层痛楚', DEEP_AGONY_CAST_MS);
  });

  ctx.timeline.at(CHAOS_MARKER_SPAWN_AT, () => {
    spawnInitialChaosMarker(ctx);
  });

  ctx.timeline.at(MECHANIC_START_AT, () => {
    ctx.boss.clearCast();
    const elementBlocks = createElementBlocks();
    ctx.state.setValue('kefkaP3:elementBlocks', elementBlocks);
    spawnElementBlocks(ctx, elementBlocks);
    assignInitialStatuses(ctx);
  });

  ctx.timeline.at(BURST_CAST_START_AT, () => {
    startBurstCast(ctx);
  });

  ctx.timeline.at(BURST_RESOLVE_AT, () => {
    resolveBurst(ctx);
  });

  ctx.timeline.at(FOLLOWUP_BURST_CAST_START_AT, () => {
    startFollowupBurstCast(ctx);
  });

  ctx.timeline.at(FOLLOWUP_BURST_FIRST_RESOLVE_AT, () => {
    resolveFollowupBurst(ctx, { clearCast: true });
  });

  ctx.timeline.at(FOLLOWUP_BURST_SECOND_RESOLVE_AT, () => {
    resolveFollowupBurst(ctx);
  });

  for (
    let repositionAt = EXDEATH_REPOSITION_START_AT;
    repositionAt < EXDEATH_REPOSITION_END_AT;
    repositionAt += EXDEATH_REPOSITION_INTERVAL_MS
  ) {
    ctx.timeline.at(repositionAt, () => {
      repositionExdeathTowardMt(ctx);
    });
  }

  for (
    let repositionAt = CHAOS_REPOSITION_START_AT;
    repositionAt < CHAOS_REPOSITION_END_AT;
    repositionAt += CHAOS_REPOSITION_INTERVAL_MS
  ) {
    ctx.timeline.at(repositionAt, () => {
      repositionChaosTowardSt(ctx);
    });
  }

  ctx.timeline.at(CHAOS_EXPLOSION_CAST_START_AT, () => {
    startChaosExplosionCast(ctx);
  });

  ctx.timeline.at(CHAOS_EXPLOSION_FIRST_RESOLVE_AT, () => {
    resolveChaosExplosion(ctx, CHAOS_EXPLOSION_FIRST_RESOLVE_AT);
  });

  ctx.timeline.at(CHAOS_EXPLOSION_SECOND_RESOLVE_AT, () => {
    resolveChaosExplosion(ctx, CHAOS_EXPLOSION_SECOND_RESOLVE_AT);
  });

  ctx.timeline.at(CHARGE_MARKER_SPAWN_AT, () => {
    startChargeMarker(ctx);
  });

  for (let index = 0; index <= CHARGE_MARKER_ROTATION_COUNT; index += 1) {
    ctx.timeline.at(CHARGE_MARKER_OUTSIDE_AT + index * CHARGE_MARKER_ROTATION_INTERVAL_MS, () => {
      spawnChargeOutsideMarker(ctx, index);
    });
  }

  ctx.timeline.at(SUPER_JUMP_LOCK_AT, () => {
    lockSuperJumpTarget(ctx);
  });

  ctx.timeline.at(VACUUM_WAVE_CAST_START_AT, () => {
    startVacuumWaveCast(ctx);
  });

  ctx.timeline.at(SUPER_JUMP_RESOLVE_AT, () => {
    resolveSuperJump(ctx);
  });

  ctx.timeline.at(VACUUM_WAVE_RESOLVE_AT, () => {
    resolveVacuumWave(ctx);
  });

  ctx.timeline.at(MAHJONG_ASSIGN_AT, () => {
    assignMahjongOrders(ctx);
  });

  for (let index = 0; index < 8; index += 1) {
    ctx.timeline.at(MAHJONG_FIRST_RESOLVE_AT + index * MAHJONG_RECTANGLE_INTERVAL_MS, () => {
      resolveMahjongRectangle(ctx, index);
    });
  }

  ctx.timeline.at(COMPLETE_AT, () => {
    ctx.state.complete();
  });
}

export const KEFKA_P3_FIRST_TRICK_BATTLE: BattleDefinition = {
  id: 'kefka_p3_first_trick',
  name: '凯夫卡P3：一运',
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
  buildScript: buildKefkaP3Script,
  failureTexts: {
    outOfBounds: (actorName) => `${actorName} 越过场地边界`,
    mechanicDeath: (actorName, sourceLabel) => `${actorName} 因 ${sourceLabel} 死亡`,
  },
};

export const KEFKA_P3_FIRST_TRICK_TESTING = {
  DEEP_AGONY_CAST_START_AT,
  DEEP_AGONY_CAST_MS,
  MECHANIC_START_AT,
  SHORT_ELEMENT_BUFF_MS,
  LONG_ELEMENT_BUFF_MS,
  CHAOS_FIRE_STATUS_ID,
  CHAOS_WATER_STATUS_ID,
  CHAOS_WIND_STATUS_ID,
  CHAOS_REVERSE_WIND_STATUS_ID,
  FIRE_ELEMENT_INNER_RADIUS,
  FIRE_ELEMENT_OUTER_RADIUS,
  WATER_ELEMENT_RADIUS,
  WIND_SHARE_RADIUS,
  BASE_ELEMENT_KNOCKBACK_DISTANCE,
  DELAYED_RESOLUTION_MS,
  TELEGRAPH_MS,
  RESOLUTION_VISUAL_MS,
  BURST_CAST_START_AT,
  BURST_RESOLVE_AT,
  BURST_CAST_MS,
  BURST_RADIUS,
  BURST_ST_OFFSET,
  BURST_TELEGRAPH_COLOR,
  EXDEATH_MARKER_RADIUS,
  EXDEATH_MARKER_COLOR,
  EXDEATH_TARGET_RING_RADIUS,
  EXDEATH_TARGET_RING_COLOR,
  EXDEATH_STABLE_MARKER_ID,
  FOLLOWUP_BURST_CAST_START_AT,
  FOLLOWUP_BURST_FIRST_RESOLVE_AT,
  FOLLOWUP_BURST_SECOND_RESOLVE_AT,
  FOLLOWUP_BURST_CAST_MS,
  FOLLOWUP_BURST_RADIUS,
  EXDEATH_REPOSITION_START_AT,
  EXDEATH_REPOSITION_END_AT,
  EXDEATH_REPOSITION_INTERVAL_MS,
  CHAOS_EXPLOSION_CAST_START_AT,
  CHAOS_EXPLOSION_FIRST_RESOLVE_AT,
  CHAOS_EXPLOSION_SECOND_RESOLVE_AT,
  CHAOS_EXPLOSION_CAST_MS,
  CHAOS_EXPLOSION_FAN_ANGLE,
  CHAOS_EXPLOSION_FAN_RADIUS,
  CHAOS_MARKER_SPAWN_AT,
  CHAOS_REPOSITION_START_AT,
  CHAOS_REPOSITION_END_AT,
  CHAOS_REPOSITION_INTERVAL_MS,
  CHAOS_MARKER_RADIUS,
  CHAOS_MARKER_ST_OFFSET,
  CHAOS_MARKER_TARGET_RING_RADIUS,
  CHAOS_MARKER_TARGET_RING_COLOR,
  CHAOS_STABLE_MARKER_ID,
  VACUUM_WAVE_CAST_START_AT,
  VACUUM_WAVE_RESOLVE_AT,
  VACUUM_WAVE_CAST_MS,
  VACUUM_WAVE_MT_OFFSET,
  SUPER_JUMP_LOCK_AT,
  SUPER_JUMP_RESOLVE_AT,
  SUPER_JUMP_RADIUS,
  CHARGE_MARKER_SPAWN_AT,
  CHARGE_MARKER_OUTSIDE_AT,
  CHARGE_MARKER_ROTATION_INTERVAL_MS,
  CHARGE_MARKER_ROTATION_COUNT,
  CHARGE_MARKER_DESPAWN_AT,
  CHARGE_INITIAL_DISTANCE,
  CHARGE_OUTSIDE_DISTANCE,
  CHARGE_MARKER_RADIUS,
  CHARGE_MARKER_COLOR,
  MAHJONG_ASSIGN_AT,
  MAHJONG_MARKERS_RESOLVE_AT,
  MAHJONG_FIRST_RESOLVE_AT,
  MAHJONG_LAST_RESOLVE_AT,
  MAHJONG_RECTANGLE_INTERVAL_MS,
  MAHJONG_RECTANGLE_LENGTH,
  MAHJONG_RECTANGLE_WIDTH,
  MAHJONG_RECTANGLE_VISUAL_MS,
  MAHJONG_MIN_DISTANCE,
  MAHJONG_ODD_MARKER_COLOR,
  MAHJONG_EVEN_MARKER_COLOR,
  COMPLETE_AT,
  ELEMENT_CORNERS,
  calculateBurstCenter,
  calculateChaosCenter,
  calculateVacuumWaveCenter,
  createChargeOutsideCenters,
  createElementBlocks,
  getKnockbackDistance,
  isActorInsideRectangle,
};
