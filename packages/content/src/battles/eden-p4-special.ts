import type { BattleDefinition, BattleScriptContext } from '@ff14arena/core';
import { FIXED_TICK_MS, createFacingTowards, createPointOnRadius, distance } from '@ff14arena/core';
import type { BaseActorSnapshot, MapMarker, PartySlot, StatusId, Vector2 } from '@ff14arena/shared';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import type { BattleBotController } from '../runtime/bot';
import { createMoveDirection, createPose } from '../runtime/bot';

const ARENA_RADIUS = 20;
const BOSS_TARGET_RING_RADIUS = 5;
const MAP_MARKER_RADIUS = 10;
const ROUND_MARKER_RADIUS = 1.25;
const SQUARE_MARKER_SIZE = 2;
const TOWER_RADIUS = 3;
const TOWER_REQUIRED_PLAYERS = 2;
const TOWER_POSITIONS = [
  { x: 0, y: -9 },
  { x: 0, y: 9 },
] as const satisfies readonly Vector2[];
const CENTER = { x: 0, y: 0 } as const satisfies Vector2;
const NORTH_ANGLE = -Math.PI / 2;
const MAP_MARKER_ANGLE_STEP = Math.PI / 4;
const DRAGONSONG_CAST_START_AT = 3_000;
const DRAGONSONG_CAST_MS = 5_000;
const MECHANIC_START_AT = DRAGONSONG_CAST_START_AT + DRAGONSONG_CAST_MS;
const LIGHT_LOCK_DURATION_MS = 7_000;
const LIGHT_BONDAGE_START_AT = MECHANIC_START_AT + LIGHT_LOCK_DURATION_MS;
const LIGHT_WAVE_CAST_MS = 11_000;
const LIGHT_WAVE_RESOLVE_AT = MECHANIC_START_AT + LIGHT_WAVE_CAST_MS;
const LIGHT_BONDAGE_MIN_DISTANCE = 17;
const LIGHT_BONDAGE_MAX_DISTANCE = 23;
const FAN_ANGLE_RAD = Math.PI / 6;
const FAN_HALF_ANGLE_RAD = FAN_ANGLE_RAD / 2;
const FAN_TELEGRAPH_MS = 500;

const TANK_SLOTS = ['MT', 'ST'] as const satisfies readonly PartySlot[];
const HEALER_SLOTS = ['H1', 'H2'] as const satisfies readonly PartySlot[];
const DPS_SLOTS = ['D1', 'D2', 'D3', 'D4'] as const satisfies readonly PartySlot[];
const TH_SLOTS = [...TANK_SLOTS, ...HEALER_SLOTS] as const satisfies readonly PartySlot[];
const NORTH_QUEUE = ['MT', 'ST', 'H1', 'H2'] as const satisfies readonly PartySlot[];
const SOUTH_QUEUE = ['D1', 'D2', 'D3', 'D4'] as const satisfies readonly PartySlot[];

const QUEUE_POSITIONS: Record<PartySlot, Vector2> = {
  MT: { x: -3, y: -5 },
  ST: { x: -1, y: -5 },
  H1: { x: 1, y: -5 },
  H2: { x: 3, y: -5 },
  D1: { x: -3, y: 5 },
  D2: { x: -1, y: 5 },
  D3: { x: 1, y: 5 },
  D4: { x: 3, y: 5 },
};

const BOT_FINAL_POINTS = {
  northTowerLeft: { x: -0.6, y: -9 },
  northTowerRight: { x: 0.6, y: -9 },
  southTowerLeft: { x: -0.6, y: 9 },
  southTowerRight: { x: 0.6, y: 9 },
  dNorth: { x: -4, y: -1.2 },
  dSouth: { x: -4, y: 1.2 },
  bNorth: { x: 4, y: -1.2 },
  bSouth: { x: 4, y: 1.2 },
} as const satisfies Record<string, Vector2>;

type EdenP4BotFinalPointKey = keyof typeof BOT_FINAL_POINTS;
type EdenP4BotFanPointKey = Extract<
  EdenP4BotFinalPointKey,
  'dNorth' | 'dSouth' | 'bNorth' | 'bSouth'
>;
type EdenP4BotPlacement = Record<PartySlot, EdenP4BotFinalPointKey>;

const LIGHT_LOCK_STATUS_ID = 'eden_p4_light_lock';
const LIGHT_BONDAGE_STATUS_ID = 'eden_p4_light_bondage';
const DARK_WATER_STATUS_ID = 'eden_p4_dark_water';

const STATUS_NAME_BY_ID: Record<StatusId, string> = {
  [LIGHT_LOCK_STATUS_ID]: '光之锁',
  [LIGHT_BONDAGE_STATUS_ID]: '光之束缚',
  [DARK_WATER_STATUS_ID]: '黑暗狂水',
  injury_up: '易伤',
};

interface EdenP4Assignments {
  lightOrder: PartySlot[];
  darkWaterSlots: [PartySlot, PartySlot];
}

interface EdenP4BotQueueGroups {
  north: PartySlot[];
  south: PartySlot[];
}

const MARKER_COLORS = {
  red: '#ef4444',
  yellow: '#f4d35e',
  cyan: '#7dd3fc',
  purple: '#a78bfa',
} as const;

const EDEN_P4_MAP_MARKER_BASES: Array<Omit<MapMarker, 'position' | 'radius' | 'size'>> = [
  { label: 'A', shape: 'circle', color: MARKER_COLORS.red },
  { label: '2', shape: 'square', color: MARKER_COLORS.yellow },
  { label: 'B', shape: 'circle', color: MARKER_COLORS.yellow },
  { label: '3', shape: 'square', color: MARKER_COLORS.cyan },
  { label: 'C', shape: 'circle', color: MARKER_COLORS.cyan },
  { label: '4', shape: 'square', color: MARKER_COLORS.purple },
  { label: 'D', shape: 'circle', color: MARKER_COLORS.purple },
  { label: '1', shape: 'square', color: MARKER_COLORS.red },
];

const EDEN_P4_MAP_MARKERS: MapMarker[] = EDEN_P4_MAP_MARKER_BASES.map((marker, index) => ({
  ...marker,
  position: createPointOnRadius(NORTH_ANGLE + MAP_MARKER_ANGLE_STEP * index, MAP_MARKER_RADIUS),
  ...(marker.shape === 'circle' ? { radius: ROUND_MARKER_RADIUS } : { size: SQUARE_MARKER_SIZE }),
}));

const INITIAL_POSITIONS: Record<PartySlot, Vector2> = {
  MT: { x: -6, y: 14 },
  ST: { x: -3, y: 14 },
  H1: { x: 0, y: 14 },
  H2: { x: 3, y: 14 },
  D1: { x: 6, y: 14 },
  D2: { x: -4.5, y: 16 },
  D3: { x: 0, y: 16 },
  D4: { x: 4.5, y: 16 },
};

function shuffleSlots(slots: readonly PartySlot[]): PartySlot[] {
  const shuffled = [...slots];

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
  return actors.find((candidate) => candidate.id === actorId) ?? null;
}

function getStatusName(statusId: StatusId): string {
  return STATUS_NAME_BY_ID[statusId] ?? statusId;
}

function applyEdenStatus(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  statusId: StatusId,
  durationMs: number,
): void {
  ctx.status.apply([actor.id], statusId, durationMs, {
    name: getStatusName(statusId),
  });
}

function hasStatus(actor: BaseActorSnapshot, statusId: StatusId): boolean {
  return actor.statuses.some((status) => status.id === statusId);
}

function triggerPartyWipe(ctx: BattleScriptContext, sourceLabel: string): void {
  ctx.state.fail(sourceLabel);
  ctx.damage.kill(
    ctx.select.alivePlayers().map((actor) => actor.id),
    sourceLabel,
  );
  ctx.state.complete('failure');
}

function getActorsInside(
  actors: BaseActorSnapshot[],
  center: Vector2,
  radius: number,
): BaseActorSnapshot[] {
  return actors.filter((actor) => actor.alive && distance(actor.position, center) <= radius);
}

function createAssignments(actors: BaseActorSnapshot[]): EdenP4Assignments {
  const lightSlots = [
    ...shuffleSlots(TANK_SLOTS).slice(0, 1),
    ...shuffleSlots(HEALER_SLOTS).slice(0, 1),
    ...shuffleSlots(DPS_SLOTS).slice(0, 2),
  ];
  const lightOrder = shuffleSlots(lightSlots);
  const unlockedSlots = PARTY_SLOT_ORDER.filter((slot) => !lightSlots.includes(slot));
  const lockedDarkWaterSlot = shuffleSlots(lightSlots).slice(0, 1)[0]!;
  const unlockedDarkWaterSlot = shuffleSlots(unlockedSlots).slice(0, 1)[0]!;

  for (const slot of [...lightSlots, ...unlockedSlots]) {
    getActorBySlot(actors, slot);
  }

  return {
    lightOrder,
    darkWaterSlots: [lockedDarkWaterSlot, unlockedDarkWaterSlot],
  };
}

function createClosedLightTethers(
  ctx: BattleScriptContext,
  actors: BaseActorSnapshot[],
  lightOrder: PartySlot[],
): void {
  for (const [index, sourceSlot] of lightOrder.entries()) {
    const targetSlot = lightOrder[(index + 1) % lightOrder.length]!;
    const source = getActorBySlot(actors, sourceSlot);
    const target = getActorBySlot(actors, targetSlot);

    ctx.spawn.tether({
      label: '光之锁连线',
      sourceId: source.id,
      target,
      allowTransfer: false,
      allowDeadRetarget: false,
      preventTargetHoldingOtherTether: false,
      resolveAfterMs: LIGHT_WAVE_RESOLVE_AT - MECHANIC_START_AT + FIXED_TICK_MS,
    });
  }
}

function getAngleDiff(left: number, right: number): number {
  const diff = Math.abs(left - right) % (Math.PI * 2);

  return diff > Math.PI ? Math.PI * 2 - diff : diff;
}

function getClockwiseAngleFromNorth(position: Vector2): number {
  const angle = Math.atan2(position.x, -position.y);

  return angle < 0 ? angle + Math.PI * 2 : angle;
}

function isInsideFan(actor: BaseActorSnapshot, direction: number): boolean {
  if (!actor.alive || distance(actor.position, CENTER) > ARENA_RADIUS) {
    return false;
  }

  if (distance(actor.position, CENTER) === 0) {
    return true;
  }

  return (
    getAngleDiff(Math.atan2(actor.position.y, actor.position.x), direction) <= FAN_HALF_ANGLE_RAD
  );
}

function areDpsSlotsAlternating(sortedSlots: PartySlot[]): boolean {
  const dpsIndexes = sortedSlots
    .map((slot, index) => ((DPS_SLOTS as readonly PartySlot[]).includes(slot) ? index : -1))
    .filter((index) => index >= 0);

  return (
    dpsIndexes.length === 4 &&
    (dpsIndexes.every((index) => index % 2 === 0) || dpsIndexes.every((index) => index % 2 === 1))
  );
}

function areDpsSlotsConsecutive(sortedSlots: PartySlot[]): boolean {
  const dpsIndexSet = new Set(
    sortedSlots
      .map((slot, index) => ((DPS_SLOTS as readonly PartySlot[]).includes(slot) ? index : -1))
      .filter((index) => index >= 0),
  );

  if (dpsIndexSet.size !== 4) {
    return false;
  }

  for (let start = 0; start < sortedSlots.length; start += 1) {
    const hasRun = [0, 1, 2, 3].every((offset) =>
      dpsIndexSet.has((start + offset) % sortedSlots.length),
    );

    if (hasRun) {
      return true;
    }
  }

  return false;
}

function validateLightBondage(ctx: BattleScriptContext, lightActorIds: string[]): void {
  const actors = ctx.select.allPlayers();

  for (const actorId of lightActorIds) {
    const actor = getActorById(actors, actorId);

    if (actor === null || !actor.alive) {
      triggerPartyWipe(ctx, '光之束缚玩家死亡');
      return;
    }
  }

  for (const [index, sourceId] of lightActorIds.entries()) {
    const targetId = lightActorIds[(index + 1) % lightActorIds.length]!;
    const source = getActorById(actors, sourceId);
    const target = getActorById(actors, targetId);

    if (source === null || target === null) {
      triggerPartyWipe(ctx, '光之束缚连线目标缺失');
      return;
    }

    const tetherDistance = distance(source.position, target.position);

    if (
      tetherDistance < LIGHT_BONDAGE_MIN_DISTANCE ||
      tetherDistance > LIGHT_BONDAGE_MAX_DISTANCE
    ) {
      triggerPartyWipe(ctx, '光之束缚连线长度错误');
      return;
    }
  }
}

function validateTowers(ctx: BattleScriptContext, actors: BaseActorSnapshot[]): void {
  for (const towerPosition of TOWER_POSITIONS) {
    const hits = getActorsInside(actors, towerPosition, TOWER_RADIUS);

    if (
      hits.length !== TOWER_REQUIRED_PLAYERS ||
      hits.some((actor) => !hasStatus(actor, LIGHT_BONDAGE_STATUS_ID))
    ) {
      triggerPartyWipe(ctx, '光之波动塔处理错误');
      return;
    }
  }
}

function validateDarkWater(
  ctx: BattleScriptContext,
  actors: BaseActorSnapshot[],
  darkWaterSlots: [PartySlot, PartySlot],
): void {
  const darkWaterActors = darkWaterSlots.map((slot) => getActorBySlot(actors, slot));

  if (darkWaterActors.some((actor) => !actor.alive)) {
    triggerPartyWipe(ctx, '黑暗狂水玩家死亡');
    return;
  }

  const halves = darkWaterActors.map((actor) => Math.sign(actor.position.y));

  if (halves.includes(0) || halves[0] === halves[1]) {
    triggerPartyWipe(ctx, '黑暗狂水未分处上下半场');
  }
}

function validateFanAttacks(ctx: BattleScriptContext, actors: BaseActorSnapshot[]): void {
  const fanTargets = [...actors]
    .filter((actor) => actor.alive)
    .sort((left, right) => distance(left.position, CENTER) - distance(right.position, CENTER))
    .slice(0, 4);

  const injuryUpActorIds: string[] = [];

  for (const target of fanTargets) {
    const direction = Math.atan2(target.position.y, target.position.x);

    for (const actor of actors) {
      if (isInsideFan(actor, direction)) {
        if (hasStatus(actor, LIGHT_BONDAGE_STATUS_ID)) {
          triggerPartyWipe(ctx, '光之束缚玩家被扇形命中');
        }

        if (injuryUpActorIds.includes(actor.id)) {
          ctx.damage.kill([actor.id], '光之波动扇形易伤');
          continue;
        }

        injuryUpActorIds.push(actor.id);
      }
    }
  }
}

function spawnFanTelegraphs(ctx: BattleScriptContext): void {
  const fanTargets = ctx.select
    .allPlayers()
    .filter((actor) => actor.alive)
    .sort((left, right) => distance(left.position, CENTER) - distance(right.position, CENTER))
    .slice(0, 4);

  for (const target of fanTargets) {
    ctx.spawn.fanTelegraph({
      label: '光之波动扇形预警',
      center: CENTER,
      direction: Math.atan2(target.position.y, target.position.x),
      angle: FAN_ANGLE_RAD,
      radius: ARENA_RADIUS,
      resolveAfterMs: FAN_TELEGRAPH_MS,
    });
  }
}

function validateDpsArrangement(ctx: BattleScriptContext, actors: BaseActorSnapshot[]): void {
  const sortedSlots = [...actors]
    .filter((actor): actor is BaseActorSnapshot & { slot: PartySlot } => actor.slot !== null)
    .sort(
      (left, right) =>
        getClockwiseAngleFromNorth(left.position) - getClockwiseAngleFromNorth(right.position),
    )
    .map((actor) => actor.slot);

  if (sortedSlots.length !== PARTY_SLOT_ORDER.length) {
    triggerPartyWipe(ctx, '玩家站位数量不足');
    return;
  }

  if (!areDpsSlotsAlternating(sortedSlots) && !areDpsSlotsConsecutive(sortedSlots)) {
    triggerPartyWipe(ctx, 'DPS 站位顺序错误');
  }
}

function isPartySlot(value: unknown): value is PartySlot {
  return typeof value === 'string' && (PARTY_SLOT_ORDER as readonly string[]).includes(value);
}

function isEdenP4Assignments(value: unknown): value is EdenP4Assignments {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const assignment = value as Partial<EdenP4Assignments>;

  return (
    Array.isArray(assignment.lightOrder) &&
    assignment.lightOrder.length === 4 &&
    assignment.lightOrder.every(isPartySlot) &&
    new Set(assignment.lightOrder).size === 4 &&
    Array.isArray(assignment.darkWaterSlots) &&
    assignment.darkWaterSlots.length === 2 &&
    assignment.darkWaterSlots.every(isPartySlot)
  );
}

function getEdenP4AssignmentsFromScriptState(
  scriptState: Record<string, unknown>,
): EdenP4Assignments | null {
  const assignments = scriptState['edenP4:assignments'];

  return isEdenP4Assignments(assignments) ? assignments : null;
}

function getLightEdges(lightOrder: PartySlot[]): Array<[PartySlot, PartySlot]> {
  return lightOrder.map((sourceSlot, index) => [
    sourceSlot,
    lightOrder[(index + 1) % lightOrder.length]!,
  ]);
}

function isThSlot(slot: PartySlot): boolean {
  return (TH_SLOTS as readonly PartySlot[]).includes(slot);
}

function isDpsSlot(slot: PartySlot): boolean {
  return (DPS_SLOTS as readonly PartySlot[]).includes(slot);
}

function isSameLightGroup(left: PartySlot, right: PartySlot): boolean {
  return (isThSlot(left) && isThSlot(right)) || (isDpsSlot(left) && isDpsSlot(right));
}

function needsEdenP4Swap1(lightOrder: PartySlot[]): boolean {
  return getLightEdges(lightOrder).some(([sourceSlot, targetSlot]) =>
    isSameLightGroup(sourceSlot, targetSlot),
  );
}

function getLinkedDpsForHealer(lightOrder: PartySlot[], healerSlot: PartySlot): PartySlot | null {
  for (const [sourceSlot, targetSlot] of getLightEdges(lightOrder)) {
    if (sourceSlot === healerSlot && isDpsSlot(targetSlot)) {
      return targetSlot;
    }

    if (targetSlot === healerSlot && isDpsSlot(sourceSlot)) {
      return sourceSlot;
    }
  }

  return null;
}

function getBotQueueGroups(assignments: EdenP4Assignments): EdenP4BotQueueGroups {
  const north: PartySlot[] = [...NORTH_QUEUE];
  const south: PartySlot[] = [...SOUTH_QUEUE];

  if (!needsEdenP4Swap1(assignments.lightOrder)) {
    return { north, south };
  }

  const healerSlot = assignments.lightOrder.find((slot) =>
    (HEALER_SLOTS as readonly PartySlot[]).includes(slot),
  );
  const linkedDpsSlot =
    healerSlot === undefined ? null : getLinkedDpsForHealer(assignments.lightOrder, healerSlot);

  if (healerSlot === undefined || linkedDpsSlot === null) {
    return { north, south };
  }

  const northIndex = north.indexOf(healerSlot);
  const southIndex = south.indexOf(linkedDpsSlot);

  if (northIndex < 0 || southIndex < 0) {
    return { north, south };
  }

  north[northIndex] = linkedDpsSlot;
  south[southIndex] = healerSlot;

  return { north, south };
}

function assignBotPoint(
  placement: Partial<EdenP4BotPlacement>,
  slot: PartySlot | undefined,
  pointKey: EdenP4BotFinalPointKey,
): void {
  if (slot !== undefined) {
    placement[slot] = pointKey;
  }
}

function getSlotAtBotPoint(
  placement: Partial<EdenP4BotPlacement>,
  pointKey: EdenP4BotFinalPointKey,
): PartySlot | null {
  return PARTY_SLOT_ORDER.find((slot) => placement[slot] === pointKey) ?? null;
}

function swapBotPoints(
  placement: Partial<EdenP4BotPlacement>,
  leftPointKey: EdenP4BotFinalPointKey,
  rightPointKey: EdenP4BotFinalPointKey,
): void {
  const leftSlot = getSlotAtBotPoint(placement, leftPointKey);
  const rightSlot = getSlotAtBotPoint(placement, rightPointKey);

  if (leftSlot === null || rightSlot === null) {
    return;
  }

  placement[leftSlot] = rightPointKey;
  placement[rightSlot] = leftPointKey;
}

function completeBotPlacement(placement: Partial<EdenP4BotPlacement>): EdenP4BotPlacement | null {
  if (!PARTY_SLOT_ORDER.every((slot) => placement[slot] !== undefined)) {
    return null;
  }

  return placement as EdenP4BotPlacement;
}

function getBotPointHalf(pointKey: EdenP4BotFinalPointKey): -1 | 0 | 1 {
  return Math.sign(BOT_FINAL_POINTS[pointKey].y) as -1 | 0 | 1;
}

function hasDarkWaterInSameHalf(
  placement: Partial<EdenP4BotPlacement>,
  darkWaterSlots: [PartySlot, PartySlot],
): boolean {
  const halves = darkWaterSlots.map((slot) => {
    const pointKey = placement[slot];

    return pointKey === undefined ? 0 : getBotPointHalf(pointKey);
  });

  return halves[0] !== 0 && halves[0] === halves[1];
}

function swapAllEdenP4BotGroups(placement: Partial<EdenP4BotPlacement>): void {
  swapBotPoints(placement, 'northTowerLeft', 'northTowerRight');
  swapBotPoints(placement, 'southTowerLeft', 'southTowerRight');
  swapBotPoints(placement, 'dNorth', 'dSouth');
  swapBotPoints(placement, 'bNorth', 'bSouth');
}

function isEdenP4BotFanPointKey(
  pointKey: EdenP4BotFinalPointKey | undefined,
): pointKey is EdenP4BotFanPointKey {
  return (
    pointKey === 'dNorth' || pointKey === 'dSouth' || pointKey === 'bNorth' || pointKey === 'bSouth'
  );
}

function swapNoSwap1DarkWaterFan(
  placement: Partial<EdenP4BotPlacement>,
  darkWaterSlots: [PartySlot, PartySlot],
): void {
  const fanPointByDarkWaterSlot = darkWaterSlots
    .map((slot) => [slot, placement[slot]] as const)
    .find(([, pointKey]) => isEdenP4BotFanPointKey(pointKey));

  if (
    fanPointByDarkWaterSlot === undefined ||
    !isEdenP4BotFanPointKey(fanPointByDarkWaterSlot[1])
  ) {
    return;
  }

  const oppositeFanPointByPoint: Record<EdenP4BotFanPointKey, EdenP4BotFanPointKey> = {
    dNorth: 'bSouth',
    bSouth: 'dNorth',
    dSouth: 'bNorth',
    bNorth: 'dSouth',
  };

  swapBotPoints(
    placement,
    fanPointByDarkWaterSlot[1],
    oppositeFanPointByPoint[fanPointByDarkWaterSlot[1]],
  );
}

function createEdenP4NoSwap1Placement(assignments: EdenP4Assignments): EdenP4BotPlacement | null {
  const placement: Partial<EdenP4BotPlacement> = {};
  const lightSlotSet = new Set(assignments.lightOrder);
  const northLightSlots = NORTH_QUEUE.filter((slot) => lightSlotSet.has(slot));
  const southLightSlots = SOUTH_QUEUE.filter((slot) => lightSlotSet.has(slot));
  const northFanSlots = NORTH_QUEUE.filter((slot) => !lightSlotSet.has(slot));
  const southFanSlots = SOUTH_QUEUE.filter((slot) => !lightSlotSet.has(slot));

  assignBotPoint(placement, northLightSlots[0], 'northTowerLeft');
  assignBotPoint(placement, northLightSlots[1], 'northTowerRight');
  assignBotPoint(placement, southLightSlots[0], 'southTowerLeft');
  assignBotPoint(placement, southLightSlots[1], 'southTowerRight');
  assignBotPoint(placement, northFanSlots[0], 'dNorth');
  assignBotPoint(placement, northFanSlots[1], 'bNorth');
  assignBotPoint(placement, southFanSlots[0], 'dSouth');
  assignBotPoint(placement, southFanSlots[1], 'bSouth');

  if (hasDarkWaterInSameHalf(placement, assignments.darkWaterSlots)) {
    swapNoSwap1DarkWaterFan(placement, assignments.darkWaterSlots);
  }

  return completeBotPlacement(placement);
}

function createEdenP4Swap1Placement(assignments: EdenP4Assignments): EdenP4BotPlacement | null {
  const placement: Partial<EdenP4BotPlacement> = {};
  const queueGroups = getBotQueueGroups(assignments);
  const lightSlotSet = new Set(assignments.lightOrder);
  const tankSlot = assignments.lightOrder.find((slot) =>
    (TANK_SLOTS as readonly PartySlot[]).includes(slot),
  );
  const healerSlot = assignments.lightOrder.find((slot) =>
    (HEALER_SLOTS as readonly PartySlot[]).includes(slot),
  );
  const linkedDpsSlot =
    healerSlot === undefined ? null : getLinkedDpsForHealer(assignments.lightOrder, healerSlot);
  const otherDpsSlot = assignments.lightOrder.find(
    (slot) => isDpsSlot(slot) && slot !== linkedDpsSlot,
  );
  const northFanSlots = queueGroups.north.filter((slot) => !lightSlotSet.has(slot));
  const southFanSlots = queueGroups.south.filter((slot) => !lightSlotSet.has(slot));

  assignBotPoint(placement, tankSlot, 'northTowerLeft');
  assignBotPoint(placement, linkedDpsSlot ?? undefined, 'northTowerRight');
  assignBotPoint(placement, otherDpsSlot, 'southTowerLeft');
  assignBotPoint(placement, healerSlot, 'southTowerRight');
  assignBotPoint(placement, northFanSlots[0], 'dNorth');
  assignBotPoint(placement, northFanSlots[1], 'bNorth');
  assignBotPoint(placement, southFanSlots[0], 'dSouth');
  assignBotPoint(placement, southFanSlots[1], 'bSouth');
  swapBotPoints(placement, 'dNorth', 'dSouth');

  if (hasDarkWaterInSameHalf(placement, assignments.darkWaterSlots)) {
    swapAllEdenP4BotGroups(placement);
  }

  return completeBotPlacement(placement);
}

function createEdenP4BotPlacement(assignments: EdenP4Assignments): EdenP4BotPlacement | null {
  return needsEdenP4Swap1(assignments.lightOrder)
    ? createEdenP4Swap1Placement(assignments)
    : createEdenP4NoSwap1Placement(assignments);
}

function getEdenP4BotTarget(slot: PartySlot, scriptState: Record<string, unknown>): Vector2 {
  const assignments = getEdenP4AssignmentsFromScriptState(scriptState);

  if (assignments === null) {
    return QUEUE_POSITIONS[slot];
  }

  const placement = createEdenP4BotPlacement(assignments);

  if (placement === null) {
    return QUEUE_POSITIONS[slot];
  }

  return BOT_FINAL_POINTS[placement[slot]];
}

export const EDEN_P4_SPECIAL_BATTLE: BattleDefinition = {
  id: 'eden_p4_special',
  name: '伊甸P4特殊',
  arenaRadius: ARENA_RADIUS,
  bossTargetRingRadius: BOSS_TARGET_RING_RADIUS,
  mapMarkers: EDEN_P4_MAP_MARKERS,
  slots: PARTY_SLOT_ORDER,
  bossName: '伊甸',
  initialPartyPositions: Object.fromEntries(
    PARTY_SLOT_ORDER.map((slot) => [
      slot,
      {
        position: INITIAL_POSITIONS[slot],
        facing: createFacingTowards(INITIAL_POSITIONS[slot], CENTER),
      },
    ]),
  ) as BattleDefinition['initialPartyPositions'],
  failureTexts: {
    outOfBounds(actorName) {
      return `${actorName} 触碰死亡墙`;
    },
    mechanicDeath(actorName, sourceLabel) {
      return `${actorName} 因 ${sourceLabel} 死亡`;
    },
  },
  buildScript(ctx) {
    ctx.timeline.at(DRAGONSONG_CAST_START_AT, () => {
      ctx.boss.cast('eden_p4_dragonsong_light_dark', '光与暗的龙诗', DRAGONSONG_CAST_MS);
    });

    ctx.timeline.at(MECHANIC_START_AT, () => {
      ctx.boss.clearCast();
      ctx.boss.cast('eden_p4_light_wave', '光之波动', LIGHT_WAVE_CAST_MS);

      const actors = ctx.select.allPlayers();
      const assignments = createAssignments(actors);
      const lightActors = assignments.lightOrder.map((slot) => getActorBySlot(actors, slot));
      const darkWaterActors = assignments.darkWaterSlots.map((slot) =>
        getActorBySlot(actors, slot),
      );
      ctx.state.setValue('edenP4:assignments', assignments);
      ctx.state.setValue(
        'edenP4:lightActorIds',
        lightActors.map((actor) => actor.id),
      );

      for (const actor of lightActors) {
        applyEdenStatus(ctx, actor, LIGHT_LOCK_STATUS_ID, LIGHT_LOCK_DURATION_MS);
      }

      createClosedLightTethers(ctx, actors, assignments.lightOrder);

      for (const actor of darkWaterActors) {
        applyEdenStatus(
          ctx,
          actor,
          DARK_WATER_STATUS_ID,
          LIGHT_WAVE_RESOLVE_AT - MECHANIC_START_AT + FIXED_TICK_MS,
        );
        ctx.spawn.actorMarker({
          label: '黑暗狂水标记',
          target: actor,
          resolveAfterMs: LIGHT_WAVE_RESOLVE_AT - MECHANIC_START_AT + FIXED_TICK_MS,
        });
      }

      for (const towerPosition of TOWER_POSITIONS) {
        ctx.spawn.tower({
          label: '光之波动塔',
          center: towerPosition,
          radius: TOWER_RADIUS,
          resolveAfterMs: LIGHT_WAVE_RESOLVE_AT - MECHANIC_START_AT,
        });
      }
    });

    ctx.timeline.at(LIGHT_BONDAGE_START_AT, () => {
      const lightActorIds = ctx.state.getValue<string[]>('edenP4:lightActorIds') ?? [];
      ctx.status.remove(lightActorIds, LIGHT_LOCK_STATUS_ID);
      ctx.status.apply(
        lightActorIds,
        LIGHT_BONDAGE_STATUS_ID,
        LIGHT_WAVE_RESOLVE_AT - LIGHT_BONDAGE_START_AT + FIXED_TICK_MS,
        {
          name: getStatusName(LIGHT_BONDAGE_STATUS_ID),
        },
      );
      validateLightBondage(ctx, lightActorIds);
      ctx.timeline.every(
        FIXED_TICK_MS,
        () => {
          validateLightBondage(ctx, lightActorIds);
        },
        LIGHT_WAVE_RESOLVE_AT - LIGHT_BONDAGE_START_AT,
      );
    });

    ctx.timeline.at(LIGHT_WAVE_RESOLVE_AT - FAN_TELEGRAPH_MS, () => {
      spawnFanTelegraphs(ctx);
    });

    ctx.timeline.at(LIGHT_WAVE_RESOLVE_AT, () => {
      const assignments = ctx.state.getValue<EdenP4Assignments>('edenP4:assignments');
      const lightActorIds = ctx.state.getValue<string[]>('edenP4:lightActorIds') ?? [];
      const actors = ctx.select.allPlayers();

      if (assignments === undefined) {
        triggerPartyWipe(ctx, '伊甸P4特殊缺少点名数据');
        return;
      }

      validateLightBondage(ctx, lightActorIds);
      validateTowers(ctx, actors);
      validateFanAttacks(ctx, actors);
      validateDarkWater(ctx, actors, assignments.darkWaterSlots);
      validateDpsArrangement(ctx, actors);
      ctx.state.complete();
    });
  },
};

export const EDEN_P4_SPECIAL_BOT_CONTROLLER: BattleBotController = ({ snapshot, slot, actor }) => {
  const target = getEdenP4BotTarget(slot, snapshot.scriptState);
  const faceAngle = createFacingTowards(actor.position, snapshot.boss.position);

  return {
    pose: createPose(actor, createMoveDirection(actor.position, target), faceAngle),
  };
};
