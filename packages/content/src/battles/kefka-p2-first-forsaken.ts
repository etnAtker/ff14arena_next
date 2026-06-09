import type { BattleDefinition, BattleScriptContext } from '@ff14arena/core';
import {
  FIXED_TICK_MS,
  INJURY_UP_MULTIPLIER,
  createFacingTowards,
  createPointOnRadius,
  distance,
} from '@ff14arena/core';
import type { BaseActorSnapshot, MapMarker, PartySlot, Vector2 } from '@ff14arena/shared';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import type { BattleBotController } from '../runtime/bot';
import { createPoseTowards } from '../runtime/bot';
import { getStatusDisplayName } from '../status-metadata';

type KefkaMarker = 'share' | 'largeCircle' | 'fan';
type TerminatorMode = 'future' | 'past';

interface MarkerPool {
  share: number;
  largeCircle: number;
  fan: number;
}

interface KefkaTowerRound {
  index: number;
  spawnAt: number;
  resolveAt: number;
  towerIndexes: [number, number];
  towerPositions: [Vector2, Vector2];
}

interface KefkaFootSource {
  center: Vector2;
  direction: number;
}

interface LockedMarkerResolution {
  sourceId: string;
  label: string;
  marker: KefkaMarker;
  center: Vector2;
  radius?: number;
  direction?: number;
  hitActorIds: string[];
  validShareCount?: boolean;
}

interface LockedTowerRoundResolution {
  handlers: BaseActorSnapshot[];
  handlerSources: Record<string, number>;
  markerResolutions: LockedMarkerResolution[];
  nearAoeResolutions: LockedMarkerResolution[];
  addPositions: Vector2[];
}

interface KefkaBotGroups {
  a: PartySlot[];
  b: PartySlot[];
}

interface KefkaBotTowerFrame {
  leftTower: Vector2;
  rightTower: Vector2;
  up: Vector2;
  right: Vector2;
}

interface KefkaOddRoundBotPositions {
  leftShare: Vector2;
  idleTank: Vector2;
  fan: Vector2;
  idleHealer: Vector2;
  rightLargeCircle: Vector2;
  rightShare: Vector2;
  idleDps: Vector2;
}

interface KefkaEvenRoundBotPositions {
  leftFan: Vector2;
  leftLargeCircle: Vector2;
  idleHealer: Vector2;
  idleTank: Vector2;
  rightFan: Vector2;
  rightLargeCircle: Vector2;
  idleRanged: Vector2;
  idleMelee: Vector2;
}

interface KefkaBotTowerPositionSet {
  key: string;
  towerIndexes: readonly [number, number];
  leftTower: Vector2;
  rightTower: Vector2;
  odd: KefkaOddRoundBotPositions;
  even: KefkaEvenRoundBotPositions;
}

interface KefkaBotHandlerSourceReference {
  position: Vector2;
  rank: number;
}

const ARENA_RADIUS = 20;
const BOSS_TARGET_RING_RADIUS = 6;
const TOWER_RING_RADIUS = 8;
const TOWER_RADIUS = 4;
const TOWER_REQUIRED_PLAYERS = 2;
const MARKER_DISPLAY_MS = 5_000;
const BOT_MARKER_MOVE_DELAY_MS = 1_000;
const INJURY_DURATION_MS = 3_000;
const MARKER_DAMAGE = 1;
const CENTER = { x: 0, y: 0 } as const satisfies Vector2;
const NORTH_ANGLE = -Math.PI / 2;
const RING_STEP = Math.PI / 4;
const FORSAKEN_CAST_START_AT = 3_000;
const FORSAKEN_CAST_MS = 6_700;
const INITIAL_MARKER_AT = FORSAKEN_CAST_START_AT + FORSAKEN_CAST_MS;
const FIRST_TOWER_SPAWN_AT = INITIAL_MARKER_AT + 3_000;
const TOWER_WINDOW_MS = 10_000;
const ROUND_COUNT = 8;
const LAST_MARKER_ASSIGN_ROUND = 6;
const TELEGRAPH_MS = 500;
const TERMINATOR_CAST_DELAY_MS = 1_000;
const TERMINATOR_CAST_MS = 6_100;
const ADD_FOOT_CAST_DELAY_MS = 5_300;
const DESTROYING_FOOT_CAST_MS = 4_700;
const FOOT_RADIUS = 20;
const FOOT_ANGLE = Math.PI;
const SHARE_RADIUS = 5;
const SHARE_REQUIRED_PLAYERS = 3;
const LARGE_CIRCLE_RADIUS = 5;
const FAN_RADIUS = 20;
const FAN_ANGLE = Math.PI / 2;
const ADD_MARKER_RADIUS = 0.45;
const ADD_TARGET_RING_RADIUS = 4;
const INITIAL_MARKER_POOL: MarkerPool = {
  share: 8,
  largeCircle: 12,
  fan: 12,
};
const FALLBACK_MARKERS = ['share', 'largeCircle', 'fan'] as const satisfies readonly KefkaMarker[];
const TANK_HEALER_SLOTS = ['MT', 'ST', 'H1', 'H2'] as const satisfies readonly PartySlot[];
const TANK_SLOTS = ['MT', 'ST'] as const satisfies readonly PartySlot[];
const HEALER_SLOTS = ['H1', 'H2'] as const satisfies readonly PartySlot[];
const DPS_SLOTS = ['D1', 'D2', 'D3', 'D4'] as const satisfies readonly PartySlot[];
const MELEE_DPS_SLOTS = ['D1', 'D2'] as const satisfies readonly PartySlot[];
const RANGED_DPS_SLOTS = ['D3', 'D4'] as const satisfies readonly PartySlot[];
const INITIAL_SOUTH_POSITIONS: Record<PartySlot, Vector2> = {
  MT: { x: -12, y: -4 },
  H1: { x: -8, y: -4 },
  D1: { x: -12, y: 4 },
  D3: { x: -8, y: 4 },
  ST: { x: 8, y: -4 },
  H2: { x: 12, y: -4 },
  D2: { x: 8, y: 4 },
  D4: { x: 12, y: 4 },
};
const INITIAL_GROUP_STAGING_POSITIONS = {
  a: {
    support: [
      { x: -12, y: -4 },
      { x: -8, y: -4 },
    ],
    dps: [
      { x: -12, y: 4 },
      { x: -8, y: 4 },
    ],
  },
  b: {
    support: [
      { x: 8, y: -4 },
      { x: 12, y: -4 },
    ],
    dps: [
      { x: 8, y: 4 },
      { x: 12, y: 4 },
    ],
  },
} as const satisfies Record<
  keyof KefkaBotGroups,
  { support: readonly [Vector2, Vector2]; dps: readonly [Vector2, Vector2] }
>;
const INITIAL_BOT_PAIR_GROUPS = [
  ['MT', 'H1'],
  ['D1', 'D3'],
  ['ST', 'H2'],
  ['D2', 'D4'],
] as const satisfies readonly (readonly PartySlot[])[];
const INITIAL_BOT_SIDE_PRIORITY = [
  'MT',
  'ST',
  'H1',
  'H2',
  'D1',
  'D2',
  'D3',
  'D4',
] as const satisfies readonly PartySlot[];
const GROUP_1238_ROUNDS = new Set([1, 2, 3, 8]);
const BOT_TOWER_PAIR_INDEXES = [
  [0, 2],
  [1, 3],
  [2, 4],
  [3, 5],
  [4, 6],
  [5, 7],
  [6, 0],
  [7, 1],
] as const satisfies readonly (readonly [number, number])[];

const MARKER_COLORS = {
  red: '#ef4444',
  yellow: '#f4d35e',
  cyan: '#7dd3fc',
  purple: '#a78bfa',
} as const;

const KEFKA_MAP_MARKER_BASES: Array<Omit<MapMarker, 'position' | 'radius' | 'size'>> = [
  { label: 'A', shape: 'circle', color: MARKER_COLORS.red },
  { label: '2', shape: 'square', color: MARKER_COLORS.yellow },
  { label: 'B', shape: 'circle', color: MARKER_COLORS.yellow },
  { label: '3', shape: 'square', color: MARKER_COLORS.cyan },
  { label: 'C', shape: 'circle', color: MARKER_COLORS.cyan },
  { label: '4', shape: 'square', color: MARKER_COLORS.purple },
  { label: 'D', shape: 'circle', color: MARKER_COLORS.purple },
  { label: '1', shape: 'square', color: MARKER_COLORS.red },
];

const KEFKA_MAP_MARKERS: MapMarker[] = KEFKA_MAP_MARKER_BASES.map((marker, index) => ({
  ...marker,
  position: createPointOnRadius(NORTH_ANGLE + RING_STEP * index, 13),
  ...(marker.shape === 'circle' ? { radius: 1.25 } : { size: 2.2 }),
}));

const TOWER_RING = Array.from({ length: 8 }, (_, index) =>
  createPointOnRadius(NORTH_ANGLE + RING_STEP * index, TOWER_RING_RADIUS),
) as [Vector2, Vector2, Vector2, Vector2, Vector2, Vector2, Vector2, Vector2];

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

function getSlotByActorId(actors: BaseActorSnapshot[], actorId: string): PartySlot | null {
  return actors.find((actor) => actor.id === actorId)?.slot ?? null;
}

function hasStatus(actor: BaseActorSnapshot, statusId: string): boolean {
  return actor.statuses.some((status) => status.id === statusId);
}

function getActiveMarkers(ctx: BattleScriptContext): Record<string, KefkaMarker> {
  return { ...(ctx.state.getValue<Record<string, KefkaMarker>>('kefka:activeMarkers') ?? {}) };
}

function setActiveMarkers(
  ctx: BattleScriptContext,
  activeMarkers: Record<string, KefkaMarker>,
): void {
  ctx.state.setValue('kefka:activeMarkers', activeMarkers);
}

function getBotMarkerSources(ctx: BattleScriptContext): Record<string, number> {
  return {
    ...(ctx.state.getValue<Record<string, number>>('kefka:botMarkerSources') ?? {}),
  };
}

function getBotMarkerAssignedAt(ctx: BattleScriptContext): Record<string, number> {
  return {
    ...(ctx.state.getValue<Record<string, number>>('kefka:botMarkerAssignedAt') ?? {}),
  };
}

function setBotMarkerAssignedAt(
  ctx: BattleScriptContext,
  markerAssignedAt: Record<string, number>,
): void {
  ctx.state.setValue('kefka:botMarkerAssignedAt', markerAssignedAt);
}

function setBotMarkerSources(
  ctx: BattleScriptContext,
  markerSources: Record<string, number>,
): void {
  ctx.state.setValue('kefka:botMarkerSources', markerSources);
}

function getMarkerPool(ctx: BattleScriptContext): MarkerPool {
  return {
    ...(ctx.state.getValue<MarkerPool>('kefka:markerPool') ?? INITIAL_MARKER_POOL),
  };
}

function setMarkerPool(ctx: BattleScriptContext, markerPool: MarkerPool): void {
  ctx.state.setValue('kefka:markerPool', markerPool);
}

function getTowerRounds(ctx: BattleScriptContext): KefkaTowerRound[] {
  return ctx.state.getValue<KefkaTowerRound[]>('kefka:towerRounds') ?? [];
}

function getTowerRound(ctx: BattleScriptContext, roundIndex: number): KefkaTowerRound {
  const round = getTowerRounds(ctx).find((candidate) => candidate.index === roundIndex);

  if (round === undefined) {
    throw new Error(`missing kefka tower round ${roundIndex}`);
  }

  return round;
}

function getTerminatorModes(ctx: BattleScriptContext): Record<string, TerminatorMode> {
  return { ...(ctx.state.getValue<Record<string, TerminatorMode>>('kefka:terminatorModes') ?? {}) };
}

function setTerminatorMode(
  ctx: BattleScriptContext,
  evenRoundIndex: number,
  mode: TerminatorMode,
): void {
  const modes = getTerminatorModes(ctx);
  modes[String(evenRoundIndex)] = mode;
  ctx.state.setValue('kefka:terminatorModes', modes);
}

function getTerminatorMode(ctx: BattleScriptContext, evenRoundIndex: number): TerminatorMode {
  return getTerminatorModes(ctx)[String(evenRoundIndex)] ?? 'future';
}

function getFootSources(ctx: BattleScriptContext, evenRoundIndex: number): KefkaFootSource[] {
  return (
    ctx.state.getValue<Record<string, KefkaFootSource[]>>('kefka:footSources')?.[
      String(evenRoundIndex)
    ] ?? []
  );
}

function setFootSources(
  ctx: BattleScriptContext,
  evenRoundIndex: number,
  footSources: KefkaFootSource[],
): void {
  const currentSources =
    ctx.state.getValue<Record<string, KefkaFootSource[]>>('kefka:footSources') ?? {};
  ctx.state.setValue('kefka:footSources', {
    ...currentSources,
    [String(evenRoundIndex)]: footSources,
  });
}

function getLockedRoundResolution(
  ctx: BattleScriptContext,
  roundIndex: number,
): LockedTowerRoundResolution | null {
  return (
    ctx.state.getValue<Record<string, LockedTowerRoundResolution>>('kefka:lockedRounds')?.[
      String(roundIndex)
    ] ?? null
  );
}

function setLockedRoundResolution(
  ctx: BattleScriptContext,
  roundIndex: number,
  resolution: LockedTowerRoundResolution,
): void {
  const lockedRounds =
    ctx.state.getValue<Record<string, LockedTowerRoundResolution>>('kefka:lockedRounds') ?? {};

  ctx.state.setValue('kefka:lockedRounds', {
    ...lockedRounds,
    [String(roundIndex)]: resolution,
  });
}

function getSlotPriorityIndex(slot: PartySlot): number {
  return PARTY_SLOT_ORDER.indexOf(slot);
}

function sortSlotsByPriority(slots: readonly PartySlot[]): PartySlot[] {
  return [...slots].sort((left, right) => getSlotPriorityIndex(left) - getSlotPriorityIndex(right));
}

function getInitialBotSidePriorityIndex(slot: PartySlot): number {
  return INITIAL_BOT_SIDE_PRIORITY.indexOf(slot);
}

function sortSlotsByInitialBotSidePriority(slots: readonly PartySlot[]): PartySlot[] {
  return [...slots].sort(
    (left, right) => getInitialBotSidePriorityIndex(left) - getInitialBotSidePriorityIndex(right),
  );
}

function getSlotRole(slots: readonly PartySlot[], slot: PartySlot): boolean {
  return slots.includes(slot);
}

function normalizeVector(vector: Vector2): Vector2 {
  const vectorLength = Math.hypot(vector.x, vector.y);

  if (vectorLength === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: vector.x / vectorLength,
    y: vector.y / vectorLength,
  };
}

function decrementPool(markerPool: MarkerPool, marker: KefkaMarker): void {
  markerPool[marker] -= 1;
}

function consumeDesiredMarker(
  markerPool: MarkerPool,
  desiredMarker: KefkaMarker,
): KefkaMarker | null {
  if (markerPool[desiredMarker] > 0) {
    decrementPool(markerPool, desiredMarker);
    return desiredMarker;
  }

  const fallbackMarker = FALLBACK_MARKERS.find((marker) => markerPool[marker] > 0);

  if (fallbackMarker === undefined) {
    return null;
  }

  decrementPool(markerPool, fallbackMarker);
  return fallbackMarker;
}

function hasRemainingMarker(markerPool: MarkerPool): boolean {
  return FALLBACK_MARKERS.some((marker) => markerPool[marker] > 0);
}

function getMarkerLabel(marker: KefkaMarker): string {
  switch (marker) {
    case 'share':
      return '分摊头标';
    case 'largeCircle':
      return '大圈头标';
    case 'fan':
      return '扇形头标';
  }
}

function getMarkerShape(marker: KefkaMarker) {
  switch (marker) {
    case 'share':
      return 'stackArrows';
    case 'largeCircle':
      return 'circleDot';
    case 'fan':
      return 'fanSector';
  }
}

function showMarker(ctx: BattleScriptContext, actor: BaseActorSnapshot, marker: KefkaMarker): void {
  ctx.spawn.actorMarker({
    label: getMarkerLabel(marker),
    target: actor,
    markerShape: getMarkerShape(marker),
    showLabel: false,
    resolveAfterMs: MARKER_DISPLAY_MS,
  });
}

function applyMarkerAssignments(
  ctx: BattleScriptContext,
  assignments: Array<[BaseActorSnapshot, KefkaMarker]>,
  markerSources?: Record<string, number>,
): void {
  const activeMarkers = getActiveMarkers(ctx);
  const activeMarkerSources = getBotMarkerSources(ctx);
  const activeMarkerAssignedAt = getBotMarkerAssignedAt(ctx);
  const assignedAt = ctx.state.getBattleTime();

  for (const [actor, marker] of assignments) {
    activeMarkers[actor.id] = marker;
    activeMarkerAssignedAt[actor.id] = assignedAt;

    if (markerSources?.[actor.id] !== undefined) {
      activeMarkerSources[actor.id] = markerSources[actor.id]!;
    } else {
      delete activeMarkerSources[actor.id];
    }

    showMarker(ctx, actor, marker);
  }

  setActiveMarkers(ctx, activeMarkers);
  setBotMarkerSources(ctx, activeMarkerSources);
  setBotMarkerAssignedAt(ctx, activeMarkerAssignedAt);
}

function createInitialBotGroups(
  assignments: Array<[BaseActorSnapshot, KefkaMarker]>,
): KefkaBotGroups {
  const shareSlots = new Set(
    assignments.flatMap(([actor, marker]) =>
      marker === 'share' && actor.slot !== null ? [actor.slot] : [],
    ),
  );
  const group1238Slots = INITIAL_BOT_PAIR_GROUPS.flatMap((group) =>
    group.some((slot) => shareSlots.has(slot)) ? [...group] : [],
  );
  const group1238SlotSet = new Set(group1238Slots);
  const group4567Slots = PARTY_SLOT_ORDER.filter((slot) => !group1238SlotSet.has(slot));

  return {
    a: sortSlotsByPriority(group1238Slots),
    b: sortSlotsByPriority(group4567Slots),
  };
}

function assignInitialMarkers(ctx: BattleScriptContext): void {
  const actors = ctx.select.allPlayers();
  const markerPool = { ...INITIAL_MARKER_POOL };
  const shareTankHealer = getActorBySlot(actors, shuffle(TANK_HEALER_SLOTS)[0]!);
  const shareDps = getActorBySlot(actors, shuffle(DPS_SLOTS)[0]!);
  const remainingTankHealers = TANK_HEALER_SLOTS.filter((slot) => slot !== shareTankHealer.slot);
  const remainingDps = DPS_SLOTS.filter((slot) => slot !== shareDps.slot);
  const largeCircleGroup =
    Math.random() < 0.5 ? remainingTankHealers : (remainingDps as readonly PartySlot[]);
  const fanGroup = largeCircleGroup === remainingTankHealers ? remainingDps : remainingTankHealers;
  const assignments: Array<[BaseActorSnapshot, KefkaMarker]> = [
    [shareTankHealer, 'share'],
    [shareDps, 'share'],
  ];

  for (const slot of largeCircleGroup) {
    assignments.push([getActorBySlot(actors, slot), 'largeCircle']);
  }

  for (const slot of fanGroup) {
    assignments.push([getActorBySlot(actors, slot), 'fan']);
  }

  for (const [, marker] of assignments) {
    decrementPool(markerPool, marker);
  }

  setMarkerPool(ctx, markerPool);
  ctx.state.setValue('kefka:botGroups', createInitialBotGroups(assignments));
  applyMarkerAssignments(ctx, assignments);
}

function createTowerRounds(): KefkaTowerRound[] {
  const firstTowerIndex = Math.floor(Math.random() * TOWER_RING.length);
  const firstPairDirection = Math.random() < 0.5 ? 2 : -2;
  const rotationDirection = Math.random() < 0.5 ? 1 : -1;
  const rounds: KefkaTowerRound[] = [];

  for (let roundIndex = 1; roundIndex <= ROUND_COUNT; roundIndex += 1) {
    const spawnAt = FIRST_TOWER_SPAWN_AT + TOWER_WINDOW_MS * (roundIndex - 1);
    const leftIndex = (firstTowerIndex + rotationDirection * (roundIndex - 1) + 8) % 8;
    const rightIndex =
      (firstTowerIndex + firstPairDirection + rotationDirection * (roundIndex - 1) + 16) % 8;

    rounds.push({
      index: roundIndex,
      spawnAt,
      resolveAt: spawnAt + TOWER_WINDOW_MS,
      towerIndexes: [leftIndex, rightIndex],
      towerPositions: [TOWER_RING[leftIndex]!, TOWER_RING[rightIndex]!],
    });
  }

  return rounds;
}

function getActorsInside(
  actors: BaseActorSnapshot[],
  center: Vector2,
  radius: number,
): BaseActorSnapshot[] {
  return actors.filter(
    (actor) => actor.mechanicActive && distance(actor.position, center) <= radius,
  );
}

function getAngleDiff(left: number, right: number): number {
  const diff = Math.abs(left - right) % (Math.PI * 2);

  return diff > Math.PI ? Math.PI * 2 - diff : diff;
}

function isInsideSector(
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

function getFreshActor(ctx: BattleScriptContext, actorId: string): BaseActorSnapshot | null {
  return getActorById(ctx.select.allPlayers(), actorId);
}

function applyKefkaDamage(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  sourceLabel: string,
): void {
  const freshActor = getFreshActor(ctx, actor.id);

  if (freshActor === null || !freshActor.mechanicActive) {
    return;
  }

  if (hasStatus(freshActor, 'injury_up')) {
    ctx.damage.kill([freshActor.id], sourceLabel);
    return;
  }

  ctx.damage.apply([freshActor.id], MARKER_DAMAGE, sourceLabel);
  ctx.status.apply([freshActor.id], 'injury_up', INJURY_DURATION_MS, {
    multiplier: INJURY_UP_MULTIPLIER,
    name: getStatusDisplayName('injury_up'),
  });
}

function resolveShareMarker(
  source: BaseActorSnapshot,
  actors: BaseActorSnapshot[],
): LockedMarkerResolution {
  const hits = getActorsInside(actors, source.position, SHARE_RADIUS);

  return {
    sourceId: source.id,
    label: '分摊头标',
    marker: 'share',
    center: source.position,
    radius: SHARE_RADIUS,
    hitActorIds: hits.map((actor) => actor.id),
    validShareCount: hits.length === SHARE_REQUIRED_PLAYERS,
  };
}

function resolveLargeCircleMarker(
  source: BaseActorSnapshot,
  actors: BaseActorSnapshot[],
): LockedMarkerResolution {
  const hits = getActorsInside(actors, source.position, LARGE_CIRCLE_RADIUS);

  return {
    sourceId: source.id,
    label: '大圈头标',
    marker: 'largeCircle',
    center: source.position,
    radius: LARGE_CIRCLE_RADIUS,
    hitActorIds: hits.map((actor) => actor.id),
  };
}

function resolveFanMarker(
  source: BaseActorSnapshot,
  actors: BaseActorSnapshot[],
): LockedMarkerResolution | null {
  const target = [...actors]
    .filter((actor) => actor.mechanicActive && actor.id !== source.id)
    .sort(
      (left, right) =>
        distance(left.position, source.position) - distance(right.position, source.position),
    )[0];

  if (target === undefined) {
    return null;
  }

  const direction = createFacingTowards(source.position, target.position);
  const hits = actors.filter(
    (actor) =>
      actor.id !== source.id &&
      isInsideSector(actor, source.position, direction, FAN_ANGLE, FAN_RADIUS),
  );

  return {
    sourceId: source.id,
    label: '扇形头标',
    marker: 'fan',
    center: source.position,
    direction,
    hitActorIds: hits.map((actor) => actor.id),
  };
}

function createLockedMarkerResolution(
  source: BaseActorSnapshot,
  marker: KefkaMarker,
  actors: BaseActorSnapshot[],
): LockedMarkerResolution | null {
  const freshSource = getActorById(actors, source.id);

  if (freshSource === null || !freshSource.mechanicActive) {
    return null;
  }

  switch (marker) {
    case 'share':
      return resolveShareMarker(freshSource, actors);
    case 'largeCircle':
      return resolveLargeCircleMarker(freshSource, actors);
    case 'fan':
      return resolveFanMarker(freshSource, actors);
  }
}

function spawnMarkerTelegraph(ctx: BattleScriptContext, resolution: LockedMarkerResolution): void {
  if (resolution.marker === 'fan') {
    ctx.spawn.fanTelegraph({
      label: resolution.label,
      center: resolution.center,
      direction: resolution.direction ?? 0,
      angle: FAN_ANGLE,
      radius: FAN_RADIUS,
      resolveAfterMs: TELEGRAPH_MS,
    });
    return;
  }

  ctx.spawn.circleTelegraph({
    label: resolution.label,
    center: resolution.center,
    radius: resolution.radius ?? LARGE_CIRCLE_RADIUS,
    resolveAfterMs: TELEGRAPH_MS,
  });
}

function applyLockedMarkerResolution(
  ctx: BattleScriptContext,
  resolution: LockedMarkerResolution,
): void {
  const actors = ctx.select.allPlayers();

  if (resolution.marker === 'share' && resolution.validShareCount === false) {
    ctx.state.fail('分摊人数错误');
  }

  for (const actorId of resolution.hitActorIds) {
    const actor = getActorById(actors, actorId);

    if (actor !== null) {
      applyKefkaDamage(ctx, actor, resolution.label);
    }
  }
}

function getNewMarkerRequests(roundIndex: number): KefkaMarker[] {
  if (roundIndex % 2 === 1) {
    return ['largeCircle', 'largeCircle', 'fan', 'fan'];
  }

  return ['share', 'share', 'largeCircle', 'fan'];
}

function assignNextMarkers(
  ctx: BattleScriptContext,
  roundIndex: number,
  handlers: BaseActorSnapshot[],
  handlerSources: Record<string, number>,
): void {
  if (roundIndex > LAST_MARKER_ASSIGN_ROUND) {
    return;
  }

  const markerPool = getMarkerPool(ctx);

  if (!hasRemainingMarker(markerPool)) {
    return;
  }

  const requestedMarkers = getNewMarkerRequests(roundIndex).slice(0, handlers.length);
  const consumedMarkers = requestedMarkers
    .map((marker) => consumeDesiredMarker(markerPool, marker))
    .filter((marker): marker is KefkaMarker => marker !== null);
  const aliveHandlers = handlers
    .map((actor) => getFreshActor(ctx, actor.id))
    .filter((actor): actor is BaseActorSnapshot => actor !== null && actor.mechanicActive);
  const shuffledHandlers = shuffle(aliveHandlers);
  const shuffledMarkers = shuffle(consumedMarkers);
  const assignments = shuffledMarkers.flatMap((marker, index) => {
    const actor = shuffledHandlers[index];

    return actor === undefined
      ? []
      : ([[actor, marker]] as Array<[BaseActorSnapshot, KefkaMarker]>);
  });
  const markerSources = Object.fromEntries(
    assignments.flatMap(([actor]) => {
      const source = handlerSources[actor.id];

      return source === undefined ? [] : [[actor.id, source]];
    }),
  ) as Record<string, number>;

  setMarkerPool(ctx, markerPool);
  applyMarkerAssignments(ctx, assignments, markerSources);
}

function spawnRoundTowers(ctx: BattleScriptContext, roundIndex: number): void {
  const round = getTowerRound(ctx, roundIndex);

  for (const towerPosition of round.towerPositions) {
    ctx.spawn.tower({
      label: `凯夫卡一运第 ${roundIndex} 轮塔`,
      center: towerPosition,
      radius: TOWER_RADIUS,
      resolveAfterMs: round.resolveAt - round.spawnAt,
    });
  }
}

function selectTowerHandlers(
  ctx: BattleScriptContext,
  towerPosition: Vector2,
  roundIndex: number,
): BaseActorSnapshot[] {
  const actors = ctx.select.allPlayers();
  const hits = getActorsInside(actors, towerPosition, TOWER_RADIUS);

  if (hits.length < TOWER_REQUIRED_PLAYERS) {
    ctx.state.fail(`第 ${roundIndex} 轮塔人数不足`);

    if (hits.length === 1) {
      ctx.damage.kill([hits[0]!.id], '塔人数不足');
    }

    return [];
  }

  return shuffle(hits).slice(0, TOWER_REQUIRED_PLAYERS);
}

function getAddPositionFromTarget(targetPosition: Vector2): Vector2 {
  const targetDistance = distance(targetPosition, CENTER);

  if (targetDistance <= ADD_TARGET_RING_RADIUS) {
    return CENTER;
  }

  const direction = normalizeVector(targetPosition);

  return {
    x: direction.x * (targetDistance - ADD_TARGET_RING_RADIUS),
    y: direction.y * (targetDistance - ADD_TARGET_RING_RADIUS),
  };
}

function createNearAoeResolutions(actors: BaseActorSnapshot[]): {
  nearAoeResolutions: LockedMarkerResolution[];
  addPositions: Vector2[];
} {
  const targets = [...actors]
    .filter((actor) => actor.mechanicActive)
    .sort((left, right) => distance(left.position, CENTER) - distance(right.position, CENTER))
    .slice(0, 4);
  const outerTargets = [...targets]
    .sort((left, right) => distance(right.position, CENTER) - distance(left.position, CENTER))
    .slice(0, 3);
  const nearAoeResolutions = targets.map((target) => ({
    sourceId: target.id,
    label: '终结点名',
    marker: 'largeCircle' as const,
    center: target.position,
    radius: LARGE_CIRCLE_RADIUS,
    hitActorIds: getActorsInside(actors, target.position, LARGE_CIRCLE_RADIUS).map(
      (actor) => actor.id,
    ),
  }));

  return {
    nearAoeResolutions,
    addPositions: outerTargets.map((target) => getAddPositionFromTarget(target.position)),
  };
}

function lockTowerRound(ctx: BattleScriptContext, roundIndex: number): void {
  const round = getTowerRound(ctx, roundIndex);
  const activeMarkers = getActiveMarkers(ctx);
  const frame = getTowerFrame(round.towerPositions);
  const leftHandlers = selectTowerHandlers(ctx, frame.leftTower, roundIndex);
  const rightHandlers = selectTowerHandlers(ctx, frame.rightTower, roundIndex);
  const handlers = [...leftHandlers, ...rightHandlers];
  const handlerSources = createHandlerSources(handlers, getHandlerSourceReferences(round));
  const actors = ctx.select.allPlayers();
  const markerResolutions = handlers.flatMap((handler) => {
    const marker = activeMarkers[handler.id];

    if (marker === undefined) {
      return [];
    }

    const resolution = createLockedMarkerResolution(handler, marker, actors);

    return resolution === null ? [] : [resolution];
  });
  const { nearAoeResolutions, addPositions } =
    roundIndex % 2 === 0
      ? createNearAoeResolutions(actors)
      : { nearAoeResolutions: [], addPositions: [] };

  for (const resolution of [...markerResolutions, ...nearAoeResolutions]) {
    spawnMarkerTelegraph(ctx, resolution);
  }

  setLockedRoundResolution(ctx, roundIndex, {
    handlers,
    handlerSources,
    markerResolutions,
    nearAoeResolutions,
    addPositions,
  });
}

function resolveTowerRound(ctx: BattleScriptContext, roundIndex: number): void {
  const lockedResolution = getLockedRoundResolution(ctx, roundIndex);
  const handlers = lockedResolution?.handlers ?? [];
  const activeMarkers = getActiveMarkers(ctx);
  const activeMarkerAssignedAt = getBotMarkerAssignedAt(ctx);

  for (const resolution of lockedResolution?.markerResolutions ?? []) {
    applyLockedMarkerResolution(ctx, resolution);
  }

  for (const resolution of lockedResolution?.nearAoeResolutions ?? []) {
    applyLockedMarkerResolution(ctx, resolution);
  }

  for (const handler of handlers) {
    delete activeMarkers[handler.id];
    delete activeMarkerAssignedAt[handler.id];
  }

  setActiveMarkers(ctx, activeMarkers);
  setBotMarkerAssignedAt(ctx, activeMarkerAssignedAt);
  setBotMarkerSources(
    ctx,
    Object.fromEntries(
      Object.entries(getBotMarkerSources(ctx)).filter(
        ([actorId]) => activeMarkers[actorId] !== undefined,
      ),
    ) as Record<string, number>,
  );
  assignNextMarkers(ctx, roundIndex, handlers, lockedResolution?.handlerSources ?? {});

  if (roundIndex % 2 === 1) {
    const nextEvenRoundIndex = roundIndex + 1;
    const mode: TerminatorMode = Math.random() < 0.5 ? 'future' : 'past';
    setTerminatorMode(ctx, nextEvenRoundIndex, mode);
    return;
  }

  resolveEvenRoundNearTargets(ctx, roundIndex, lockedResolution?.addPositions ?? []);
}

function startTerminatorCast(ctx: BattleScriptContext, oddRoundIndex: number): void {
  const evenRoundIndex = oddRoundIndex + 1;
  const mode = getTerminatorMode(ctx, evenRoundIndex);
  const actionName = mode === 'future' ? '未来终结' : '过去终结';

  ctx.boss.cast(`kefka_${mode}_ending_round_${evenRoundIndex}`, actionName, TERMINATOR_CAST_MS);
  ctx.timeline.after(TERMINATOR_CAST_MS, () => {
    ctx.boss.clearCast();
  });
}

function resolveEvenRoundNearTargets(
  ctx: BattleScriptContext,
  evenRoundIndex: number,
  addPositions: Vector2[],
): void {
  for (const addPosition of addPositions) {
    ctx.spawn.fieldMarker({
      label: '小怪',
      center: addPosition,
      shape: 'enemy',
      radius: ADD_MARKER_RADIUS,
      showLabel: false,
      resolveAfterMs: ADD_FOOT_CAST_DELAY_MS + DESTROYING_FOOT_CAST_MS + FIXED_TICK_MS,
    });
  }

  ctx.timeline.after(ADD_FOOT_CAST_DELAY_MS, () => {
    startDestroyingFootCast(ctx, evenRoundIndex, addPositions);
  });
}

function getNearestActorToPoint(
  actors: BaseActorSnapshot[],
  point: Vector2,
): BaseActorSnapshot | null {
  return (
    [...actors]
      .filter((actor) => actor.mechanicActive)
      .sort((left, right) => distance(left.position, point) - distance(right.position, point))[0] ??
    null
  );
}

function startDestroyingFootCast(
  ctx: BattleScriptContext,
  evenRoundIndex: number,
  addPositions: Vector2[],
): void {
  const mode = getTerminatorMode(ctx, evenRoundIndex);
  const actors = ctx.select.activePlayers();
  const sourcePositions = [ctx.boss.snapshot().position, ...addPositions];
  const footSources = sourcePositions.flatMap((sourcePosition) => {
    const target = getNearestActorToPoint(actors, sourcePosition);

    if (target === null) {
      return [];
    }

    const lockedDirection = createFacingTowards(sourcePosition, target.position);
    const direction = mode === 'future' ? lockedDirection : lockedDirection + Math.PI;

    return [
      {
        center: sourcePosition,
        direction,
      },
    ];
  });

  setFootSources(ctx, evenRoundIndex, footSources);
  ctx.boss.cast(
    `kefka_destroying_foot_round_${evenRoundIndex}`,
    '消灭之脚',
    DESTROYING_FOOT_CAST_MS,
  );

  ctx.timeline.after(DESTROYING_FOOT_CAST_MS - TELEGRAPH_MS, () => {
    for (const source of footSources) {
      ctx.spawn.fanTelegraph({
        label: '消灭之脚',
        center: source.center,
        direction: source.direction,
        angle: FOOT_ANGLE,
        radius: FOOT_RADIUS,
        resolveAfterMs: TELEGRAPH_MS,
      });
    }
  });

  ctx.timeline.after(DESTROYING_FOOT_CAST_MS, () => {
    resolveDestroyingFoot(ctx, evenRoundIndex);
  });
}

function scheduleTowerRound(ctx: BattleScriptContext, roundIndex: number): void {
  const spawnAt = FIRST_TOWER_SPAWN_AT + TOWER_WINDOW_MS * (roundIndex - 1);
  const resolveAt = spawnAt + TOWER_WINDOW_MS;

  ctx.timeline.at(spawnAt, () => {
    spawnRoundTowers(ctx, roundIndex);
  });
  ctx.timeline.at(resolveAt - TELEGRAPH_MS, () => {
    lockTowerRound(ctx, roundIndex);
  });
  ctx.timeline.at(resolveAt, () => {
    resolveTowerRound(ctx, roundIndex);
  });

  if (roundIndex % 2 === 1) {
    ctx.timeline.at(resolveAt + TERMINATOR_CAST_DELAY_MS, () => {
      startTerminatorCast(ctx, roundIndex);
    });
  }
}

function resolveDestroyingFoot(ctx: BattleScriptContext, evenRoundIndex: number): void {
  const footSources = getFootSources(ctx, evenRoundIndex);
  const actors = ctx.select.allPlayers();

  ctx.boss.clearCast();

  for (const source of footSources) {
    for (const actor of actors) {
      if (isInsideSector(actor, source.center, source.direction, FOOT_ANGLE, FOOT_RADIUS)) {
        applyKefkaDamage(ctx, actor, '消灭之脚');
      }
    }
  }

  if (evenRoundIndex === ROUND_COUNT) {
    ctx.state.complete();
  }
}

function buildKefkaScript(ctx: BattleScriptContext): void {
  ctx.timeline.at(FORSAKEN_CAST_START_AT, () => {
    ctx.boss.cast('kefka_forsaken_doomsday', '遗弃末世', FORSAKEN_CAST_MS);
  });

  ctx.timeline.at(INITIAL_MARKER_AT, () => {
    ctx.boss.clearCast();
    ctx.state.setValue('kefka:towerRounds', createTowerRounds());
    assignInitialMarkers(ctx);
  });

  for (let roundIndex = 1; roundIndex <= ROUND_COUNT; roundIndex += 1) {
    scheduleTowerRound(ctx, roundIndex);
  }
}

function isKefkaBotGroups(value: unknown): value is KefkaBotGroups {
  const groups = value as KefkaBotGroups;

  return (
    typeof groups === 'object' &&
    groups !== null &&
    Array.isArray(groups.a) &&
    Array.isArray(groups.b) &&
    groups.a.every((slot) => PARTY_SLOT_ORDER.includes(slot)) &&
    groups.b.every((slot) => PARTY_SLOT_ORDER.includes(slot))
  );
}

function getBotGroupsFromSnapshot(scriptState: Record<string, unknown>): KefkaBotGroups | null {
  const groups = scriptState['kefka:botGroups'];

  return isKefkaBotGroups(groups) ? groups : null;
}

function getActiveMarkersFromSnapshot(
  scriptState: Record<string, unknown>,
): Record<string, KefkaMarker> {
  return (scriptState['kefka:activeMarkers'] as Record<string, KefkaMarker> | undefined) ?? {};
}

function getTowerRoundsFromSnapshot(scriptState: Record<string, unknown>): KefkaTowerRound[] {
  return (scriptState['kefka:towerRounds'] as KefkaTowerRound[] | undefined) ?? [];
}

function getTerminatorModesFromSnapshot(
  scriptState: Record<string, unknown>,
): Record<string, TerminatorMode> {
  return (scriptState['kefka:terminatorModes'] as Record<string, TerminatorMode> | undefined) ?? {};
}

function getBotMarkerSourcesFromSnapshot(
  scriptState: Record<string, unknown>,
): Record<string, number> {
  return (scriptState['kefka:botMarkerSources'] as Record<string, number> | undefined) ?? {};
}

function getBotMarkerAssignedAtFromSnapshot(
  scriptState: Record<string, unknown>,
): Record<string, number> {
  return (scriptState['kefka:botMarkerAssignedAt'] as Record<string, number> | undefined) ?? {};
}

function getCurrentOrNextRound(timeMs: number, rounds: KefkaTowerRound[]): KefkaTowerRound | null {
  return rounds.find((round) => timeMs < round.resolveAt) ?? null;
}

function getRoundForEvenFoot(timeMs: number, rounds: KefkaTowerRound[]): KefkaTowerRound | null {
  return (
    rounds.find((round) => {
      if (round.index % 2 !== 0) {
        return false;
      }

      const footResolveAt = round.resolveAt + ADD_FOOT_CAST_DELAY_MS + DESTROYING_FOOT_CAST_MS;

      return timeMs >= round.resolveAt && timeMs < footResolveAt;
    }) ?? null
  );
}

function getRoundGroupKey(roundIndex: number): keyof KefkaBotGroups {
  return GROUP_1238_ROUNDS.has(roundIndex) ? 'a' : 'b';
}

function getOtherGroupKey(groupKey: keyof KefkaBotGroups): keyof KefkaBotGroups {
  return groupKey === 'a' ? 'b' : 'a';
}

function getGroupKeyForSlot(groups: KefkaBotGroups, slot: PartySlot): keyof KefkaBotGroups {
  return groups.a.includes(slot) ? 'a' : 'b';
}

function getInitialGroupStagingTarget(slot: PartySlot, groups: KefkaBotGroups): Vector2 {
  const groupKey = getGroupKeyForSlot(groups, slot);
  const groupSlots = groups[groupKey];
  const roleSlots = getSlotRole(DPS_SLOTS, slot)
    ? groupSlots.filter((candidate) => getSlotRole(DPS_SLOTS, candidate))
    : groupSlots.filter((candidate) => getSlotRole(TANK_HEALER_SLOTS, candidate));
  const orderedRoleSlots = sortSlotsByPriority(roleSlots);
  const roleIndex = Math.max(0, orderedRoleSlots.indexOf(slot));
  const rolePositions = getSlotRole(DPS_SLOTS, slot)
    ? INITIAL_GROUP_STAGING_POSITIONS[groupKey].dps
    : INITIAL_GROUP_STAGING_POSITIONS[groupKey].support;

  return rolePositions[Math.min(roleIndex, rolePositions.length - 1)]!;
}

function getMarkerSlotsByGroup(
  snapshotActors: BaseActorSnapshot[],
  activeMarkers: Record<string, KefkaMarker>,
  groupSlots: readonly PartySlot[],
): Record<KefkaMarker, PartySlot[]> {
  const groupSlotSet = new Set(groupSlots);
  const slotsByMarker: Record<KefkaMarker, PartySlot[]> = {
    share: [],
    largeCircle: [],
    fan: [],
  };

  for (const [actorId, marker] of Object.entries(activeMarkers)) {
    const slot = getSlotByActorId(snapshotActors, actorId);

    if (slot !== null && groupSlotSet.has(slot)) {
      slotsByMarker[marker].push(slot);
    }
  }

  return {
    share: sortSlotsByPriority(slotsByMarker.share),
    largeCircle: sortSlotsByPriority(slotsByMarker.largeCircle),
    fan: sortSlotsByPriority(slotsByMarker.fan),
  };
}

function getEarliestGroupMarkerAssignedAt(
  snapshotActors: BaseActorSnapshot[],
  markerAssignedAt: Record<string, number>,
  groupSlots: readonly PartySlot[],
): number | null {
  const groupSlotSet = new Set(groupSlots);
  const assignedTimes = snapshotActors.flatMap((actor) => {
    const assignedAt = markerAssignedAt[actor.id];

    return actor.slot !== null && groupSlotSet.has(actor.slot) && assignedAt !== undefined
      ? [assignedAt]
      : [];
  });

  return assignedTimes.length === 0 ? null : Math.min(...assignedTimes);
}

function getTowerFrame(towerPositions: [Vector2, Vector2]): KefkaBotTowerFrame {
  const up = normalizeVector({
    x: -(towerPositions[0].x + towerPositions[1].x),
    y: -(towerPositions[0].y + towerPositions[1].y),
  });
  const right = {
    x: -up.y,
    y: up.x,
  };
  const sortedTowers = [...towerPositions].sort(
    (left, other) => left.x * right.x + left.y * right.y - (other.x * right.x + other.y * right.y),
  ) as [Vector2, Vector2];

  return {
    leftTower: sortedTowers[0],
    rightTower: sortedTowers[1],
    up,
    right,
  };
}

function getTowerFramePoint(
  origin: Vector2,
  frame: KefkaBotTowerFrame,
  rightOffset: number,
  upOffset: number,
): Vector2 {
  return {
    x: origin.x + frame.right.x * rightOffset + frame.up.x * upOffset,
    y: origin.y + frame.right.y * rightOffset + frame.up.y * upOffset,
  };
}

function getDiagonalPoint(
  origin: Vector2,
  frame: KefkaBotTowerFrame,
  rightSign: -1 | 1,
  upSign: -1 | 1,
  distanceFromOrigin: number,
): Vector2 {
  const offset = distanceFromOrigin / Math.SQRT2;

  return getTowerFramePoint(origin, frame, rightSign * offset, upSign * offset);
}

function getMirroredDiagonalPoint(
  origin: Vector2,
  frame: KefkaBotTowerFrame,
  rightSign: -1 | 1,
  upSign: -1 | 1,
  distanceFromOrigin: number,
): Vector2 {
  const mirroredRightSign = rightSign === 1 ? -1 : 1;

  return getDiagonalPoint(origin, frame, mirroredRightSign, upSign, distanceFromOrigin);
}

function createBotTowerPositionSet(
  towerIndexes: readonly [number, number],
): KefkaBotTowerPositionSet {
  const frame = getTowerFrame([TOWER_RING[towerIndexes[0]]!, TOWER_RING[towerIndexes[1]]!]);
  const leftShare = getDiagonalPoint(frame.leftTower, frame, -1, 1, 2);
  const rightShare = getDiagonalPoint(frame.rightTower, frame, -1, -1, 3.5);

  return {
    key: getTowerPositionSetKey(towerIndexes),
    towerIndexes,
    leftTower: frame.leftTower,
    rightTower: frame.rightTower,
    odd: {
      leftShare,
      idleTank: getDiagonalPoint(frame.leftTower, frame, -1, 1, 4.5),
      fan: getTowerFramePoint(frame.leftTower, frame, 0, -3),
      idleHealer: getTowerFramePoint(frame.leftTower, frame, 0, -4.5),
      rightLargeCircle: getDiagonalPoint(frame.rightTower, frame, 1, 1, 3.5),
      rightShare,
      idleDps: getTowerFramePoint(rightShare, frame, -2, 0),
    },
    even: {
      leftFan: getDiagonalPoint(frame.leftTower, frame, 1, 1, 3.5),
      leftLargeCircle: getDiagonalPoint(frame.leftTower, frame, -1, -1, 3.5),
      idleHealer: getDiagonalPoint(frame.leftTower, frame, -1, 1, 4.5),
      idleTank: getDiagonalPoint(CENTER, frame, -1, 1, 5),
      rightFan: getMirroredDiagonalPoint(frame.rightTower, frame, 1, 1, 3.5),
      rightLargeCircle: getMirroredDiagonalPoint(frame.rightTower, frame, -1, -1, 3.5),
      idleRanged: getDiagonalPoint(frame.rightTower, frame, 1, 1, 4.5),
      idleMelee: getMirroredDiagonalPoint(CENTER, frame, -1, 1, 5),
    },
  };
}

function getOddHandlerSourceReferences(
  positions: KefkaOddRoundBotPositions,
): KefkaBotHandlerSourceReference[] {
  return [
    { position: positions.leftShare, rank: 0 },
    { position: positions.fan, rank: 1 },
    { position: positions.rightShare, rank: 2 },
    { position: positions.rightLargeCircle, rank: 3 },
  ];
}

function getEvenHandlerSourceReferences(
  positions: KefkaEvenRoundBotPositions,
): KefkaBotHandlerSourceReference[] {
  return [
    { position: positions.leftLargeCircle, rank: 0 },
    { position: positions.leftFan, rank: 1 },
    { position: positions.rightFan, rank: 2 },
    { position: positions.rightLargeCircle, rank: 3 },
  ];
}

function getHandlerSourceReferences(round: KefkaTowerRound): KefkaBotHandlerSourceReference[] {
  const positionSet = getBotTowerPositionSet(round);

  return round.index % 2 === 1
    ? getOddHandlerSourceReferences(positionSet.odd)
    : getEvenHandlerSourceReferences(positionSet.even);
}

function createHandlerSources(
  handlers: BaseActorSnapshot[],
  references: KefkaBotHandlerSourceReference[],
): Record<string, number> {
  const pendingHandlers = [...handlers];
  const pendingReferences = [...references];
  const handlerSources: Record<string, number> = {};

  while (pendingHandlers.length > 0 && pendingReferences.length > 0) {
    let bestHandlerIndex = 0;
    let bestReferenceIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const [handlerIndex, handler] of pendingHandlers.entries()) {
      for (const [referenceIndex, reference] of pendingReferences.entries()) {
        const referenceDistance = distance(handler.position, reference.position);

        if (referenceDistance < bestDistance) {
          bestHandlerIndex = handlerIndex;
          bestReferenceIndex = referenceIndex;
          bestDistance = referenceDistance;
        }
      }
    }

    const [handler] = pendingHandlers.splice(bestHandlerIndex, 1);
    const [reference] = pendingReferences.splice(bestReferenceIndex, 1);

    if (handler !== undefined && reference !== undefined) {
      handlerSources[handler.id] = reference.rank;
    }
  }

  return handlerSources;
}

function getTowerPositionSetKey(towerIndexes: readonly [number, number]): string {
  return [...towerIndexes].sort((left, right) => left - right).join(':');
}

const BOT_TOWER_POSITION_SETS = Object.fromEntries(
  BOT_TOWER_PAIR_INDEXES.map((towerIndexes) => {
    const positions = createBotTowerPositionSet(towerIndexes);

    return [positions.key, positions];
  }),
) as Record<string, KefkaBotTowerPositionSet>;

function getBotTowerPositionSet(round: KefkaTowerRound): KefkaBotTowerPositionSet {
  return BOT_TOWER_POSITION_SETS[getTowerPositionSetKey(round.towerIndexes)]!;
}

function getInitialSideOrderedSlots(slots: readonly PartySlot[]): PartySlot[] {
  return sortSlotsByInitialBotSidePriority(slots);
}

function getSlotsOrderedBySource(
  slots: readonly PartySlot[],
  actors: BaseActorSnapshot[],
  markerSources: Record<string, number>,
): PartySlot[] {
  const slotSet = new Set(slots);
  const sourceEntries = actors.flatMap((actor) => {
    const source = markerSources[actor.id];

    return actor.slot !== null && slotSet.has(actor.slot) && source !== undefined
      ? [{ slot: actor.slot, source }]
      : [];
  });

  if (sourceEntries.length === slots.length) {
    return sourceEntries
      .sort(
        (left, right) =>
          left.source - right.source ||
          getInitialBotSidePriorityIndex(left.slot) - getInitialBotSidePriorityIndex(right.slot),
      )
      .map((entry) => entry.slot);
  }

  return getInitialSideOrderedSlots(slots);
}

function getOrderedTarget(
  slot: PartySlot,
  slots: readonly PartySlot[],
  actors: BaseActorSnapshot[],
  markerSources: Record<string, number>,
  leftPoint: Vector2,
  rightPoint: Vector2,
): Vector2 | null {
  if (slots.length !== 2 || !slots.includes(slot)) {
    return null;
  }

  const orderedSlots = getSlotsOrderedBySource(slots, actors, markerSources);

  return orderedSlots.indexOf(slot) === 0 ? leftPoint : rightPoint;
}

function getSingleMarkerTarget(
  slot: PartySlot,
  slots: readonly PartySlot[],
  point: Vector2,
): Vector2 | null {
  return slots.length === 1 && slots.includes(slot) ? point : null;
}

function getRoleTarget(
  slot: PartySlot,
  slots: readonly PartySlot[],
  point: Vector2,
): Vector2 | null {
  return slots.includes(slot) ? point : null;
}

function getIdleDpsTarget(
  slot: PartySlot,
  idleDpsSlots: readonly PartySlot[],
  point: Vector2,
): Vector2 | null {
  const slotIndex = sortSlotsByPriority(idleDpsSlots).indexOf(slot);

  if (slotIndex < 0) {
    return null;
  }

  return {
    x: point.x,
    y: point.y,
  };
}

function getMarkerPairTarget(
  slot: PartySlot,
  slots: readonly PartySlot[],
  actors: BaseActorSnapshot[],
  markerSources: Record<string, number>,
  leftPoint: Vector2,
  rightPoint: Vector2,
  singlePoint: Vector2,
): Vector2 | null {
  return (
    getOrderedTarget(slot, slots, actors, markerSources, leftPoint, rightPoint) ??
    getSingleMarkerTarget(slot, slots, singlePoint)
  );
}

function getOddRoundBotTarget(
  slot: PartySlot,
  groupSlotsByMarker: Record<KefkaMarker, PartySlot[]>,
  otherGroupSlots: readonly PartySlot[],
  actors: BaseActorSnapshot[],
  markerSources: Record<string, number>,
  positions: KefkaOddRoundBotPositions,
): Vector2 | null {
  const shareSlots = groupSlotsByMarker.share;
  const fanSlots = groupSlotsByMarker.fan;
  const largeCircleSlots = groupSlotsByMarker.largeCircle;
  const idleTankSlots = otherGroupSlots.filter((candidate) => getSlotRole(TANK_SLOTS, candidate));
  const idleHealerSlots = otherGroupSlots.filter((candidate) =>
    getSlotRole(HEALER_SLOTS, candidate),
  );
  const idleDpsSlots = otherGroupSlots.filter((candidate) => getSlotRole(DPS_SLOTS, candidate));

  return (
    getMarkerPairTarget(
      slot,
      shareSlots,
      actors,
      markerSources,
      positions.leftShare,
      positions.rightShare,
      positions.leftShare,
    ) ??
    getRoleTarget(slot, idleTankSlots, positions.idleTank) ??
    getRoleTarget(slot, fanSlots, positions.fan) ??
    getRoleTarget(slot, idleHealerSlots, positions.idleHealer) ??
    getRoleTarget(slot, largeCircleSlots, positions.rightLargeCircle) ??
    getIdleDpsTarget(slot, idleDpsSlots, positions.idleDps)
  );
}

function getEvenRoundBotTarget(
  slot: PartySlot,
  groupSlotsByMarker: Record<KefkaMarker, PartySlot[]>,
  otherGroupSlots: readonly PartySlot[],
  actors: BaseActorSnapshot[],
  markerSources: Record<string, number>,
  positions: KefkaEvenRoundBotPositions,
): Vector2 | null {
  const fanSlots = groupSlotsByMarker.fan;
  const largeCircleSlots = groupSlotsByMarker.largeCircle;
  const idleHealerSlots = otherGroupSlots.filter((candidate) =>
    getSlotRole(HEALER_SLOTS, candidate),
  );
  const idleTankSlots = otherGroupSlots.filter((candidate) => getSlotRole(TANK_SLOTS, candidate));
  const idleRangedSlots = otherGroupSlots.filter((candidate) =>
    getSlotRole(RANGED_DPS_SLOTS, candidate),
  );
  const idleMeleeSlots = otherGroupSlots.filter((candidate) =>
    getSlotRole(MELEE_DPS_SLOTS, candidate),
  );

  return (
    getMarkerPairTarget(
      slot,
      fanSlots,
      actors,
      markerSources,
      positions.leftFan,
      positions.rightFan,
      positions.leftFan,
    ) ??
    getMarkerPairTarget(
      slot,
      largeCircleSlots,
      actors,
      markerSources,
      positions.leftLargeCircle,
      positions.rightLargeCircle,
      positions.leftLargeCircle,
    ) ??
    getRoleTarget(slot, idleHealerSlots, positions.idleHealer) ??
    getRoleTarget(slot, idleTankSlots, positions.idleTank) ??
    getRoleTarget(slot, idleRangedSlots, positions.idleRanged) ??
    getRoleTarget(slot, idleMeleeSlots, positions.idleMelee)
  );
}

function getRoundBotTarget(
  slot: PartySlot,
  timeMs: number,
  currentPosition: Vector2,
  round: KefkaTowerRound,
  actors: BaseActorSnapshot[],
  activeMarkers: Record<string, KefkaMarker>,
  markerSources: Record<string, number>,
  markerAssignedAt: Record<string, number>,
  groups: KefkaBotGroups,
): Vector2 {
  const groupKey = getRoundGroupKey(round.index);
  const otherGroupKey = getOtherGroupKey(groupKey);
  const groupSlotsByMarker = getMarkerSlotsByGroup(actors, activeMarkers, groups[groupKey]);
  const earliestMarkerAssignedAt = getEarliestGroupMarkerAssignedAt(
    actors,
    markerAssignedAt,
    groups[groupKey],
  );

  if (earliestMarkerAssignedAt !== null) {
    const markerReadyAt = earliestMarkerAssignedAt + BOT_MARKER_MOVE_DELAY_MS;
    const towerReadyAt = round.spawnAt + BOT_MARKER_MOVE_DELAY_MS;

    if (timeMs < markerReadyAt) {
      return currentPosition;
    }

    if (round.index === 1 && timeMs < towerReadyAt) {
      return getInitialGroupStagingTarget(slot, groups);
    }

    if (timeMs < towerReadyAt) {
      return currentPosition;
    }
  }

  const positionSet = getBotTowerPositionSet(round);
  const target =
    round.index % 2 === 1
      ? getOddRoundBotTarget(
          slot,
          groupSlotsByMarker,
          groups[otherGroupKey],
          actors,
          markerSources,
          positionSet.odd,
        )
      : getEvenRoundBotTarget(
          slot,
          groupSlotsByMarker,
          groups[otherGroupKey],
          actors,
          markerSources,
          positionSet.even,
        );

  if (target !== null) {
    return target;
  }

  return getRoundWaitingTarget(slot, round);
}

function getRoundWaitingTarget(slot: PartySlot, round: KefkaTowerRound): Vector2 {
  const [leftTower, rightTower] = round.towerPositions;
  const waitingAngle = Math.atan2(leftTower.y + rightTower.y, leftTower.x + rightTower.x);
  const priorityOffset = (getSlotPriorityIndex(slot) - 3.5) * 0.55;
  const base = createPointOnRadius(waitingAngle + Math.PI, 13);
  const tangent = {
    x: -Math.sin(waitingAngle),
    y: Math.cos(waitingAngle),
  };

  return {
    x: base.x + tangent.x * priorityOffset,
    y: base.y + tangent.y * priorityOffset,
  };
}

function getFootBaitTarget(baitRound: KefkaTowerRound, mode: TerminatorMode): Vector2 {
  const [leftTower, rightTower] = baitRound.towerPositions;
  const bisector = normalizeVector({
    x: leftTower.x + rightTower.x,
    y: leftTower.y + rightTower.y,
  });
  const baseAngle = Math.atan2(bisector.y, bisector.x);
  const baitAngle = mode === 'future' ? baseAngle + Math.PI : baseAngle;

  return createPointOnRadius(baitAngle, BOSS_TARGET_RING_RADIUS + 2);
}

function getFinalFootDodgeTarget(finalRound: KefkaTowerRound, mode: TerminatorMode): Vector2 {
  const baitTarget = getFootBaitTarget(finalRound, mode);

  if (mode === 'future') {
    return {
      x: -baitTarget.x,
      y: -baitTarget.y,
    };
  }

  return baitTarget;
}

function getKefkaBotTarget(
  slot: PartySlot,
  timeMs: number,
  currentPosition: Vector2,
  actors: BaseActorSnapshot[],
  scriptState: Record<string, unknown>,
): Vector2 {
  const groups = getBotGroupsFromSnapshot(scriptState);
  const rounds = getTowerRoundsFromSnapshot(scriptState);
  const activeMarkers = getActiveMarkersFromSnapshot(scriptState);
  const markerSources = getBotMarkerSourcesFromSnapshot(scriptState);
  const markerAssignedAt = getBotMarkerAssignedAtFromSnapshot(scriptState);
  const footRound = getRoundForEvenFoot(timeMs, rounds);

  if (groups === null || rounds.length === 0) {
    return INITIAL_SOUTH_POSITIONS[slot];
  }

  if (footRound !== null) {
    const modes = getTerminatorModesFromSnapshot(scriptState);
    const mode = modes[String(footRound.index)] ?? 'future';
    const footCastStartAt = footRound.resolveAt + ADD_FOOT_CAST_DELAY_MS;

    if (timeMs < footCastStartAt) {
      const baitRound =
        rounds.find((round) => round.index === footRound.index + 1) ??
        rounds.find((round) => round.index === footRound.index) ??
        footRound;

      return getFootBaitTarget(baitRound, mode);
    }

    if (footRound.index === ROUND_COUNT) {
      return getFinalFootDodgeTarget(footRound, mode);
    }
  }

  const round = getCurrentOrNextRound(timeMs, rounds);

  if (round === null) {
    return INITIAL_SOUTH_POSITIONS[slot];
  }

  return getRoundBotTarget(
    slot,
    timeMs,
    currentPosition,
    round,
    actors,
    activeMarkers,
    markerSources,
    markerAssignedAt,
    groups,
  );
}

export const KEFKA_P2_FIRST_FORSAKEN_BATTLE: BattleDefinition = {
  id: 'kefka_p2_first_forsaken',
  name: '凯夫卡P2：一运',
  arenaRadius: ARENA_RADIUS,
  bossTargetRingRadius: BOSS_TARGET_RING_RADIUS,
  mapMarkers: KEFKA_MAP_MARKERS,
  slots: PARTY_SLOT_ORDER,
  bossName: '凯夫卡',
  initialPartyPositions: Object.fromEntries(
    PARTY_SLOT_ORDER.map((slot) => [
      slot,
      {
        position: INITIAL_SOUTH_POSITIONS[slot],
        facing: NORTH_ANGLE,
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
  buildScript: buildKefkaScript,
};

export const KEFKA_P2_FIRST_FORSAKEN_BOT_CONTROLLER: BattleBotController = ({
  snapshot,
  slot,
  actor,
}) => {
  const target = getKefkaBotTarget(
    slot,
    snapshot.timeMs,
    actor.position,
    snapshot.actors,
    snapshot.scriptState,
  );
  const faceAngle = createFacingTowards(actor.position, snapshot.boss.position);

  return {
    pose: createPoseTowards(actor, target, faceAngle),
  };
};

export const KEFKA_P2_FIRST_FORSAKEN_TESTING = {
  FAN_ANGLE,
  INITIAL_SOUTH_POSITIONS,
  INITIAL_GROUP_STAGING_POSITIONS,
  BOT_TOWER_POSITION_SETS,
  createInitialBotGroups,
  createHandlerSources,
  getInitialGroupStagingTarget,
  getBotTowerPositionSet,
  getOddHandlerSourceReferences,
  getEvenHandlerSourceReferences,
  getOddRoundBotTarget,
  getEvenRoundBotTarget,
  getRoundWaitingTarget,
  getFootBaitTarget,
  getFinalFootDodgeTarget,
};
