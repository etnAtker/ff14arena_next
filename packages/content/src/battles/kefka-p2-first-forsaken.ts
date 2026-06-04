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
  markerResolutions: LockedMarkerResolution[];
  nearAoeResolutions: LockedMarkerResolution[];
  addPositions: Vector2[];
}

interface KefkaBotGroups {
  a: PartySlot[];
  b: PartySlot[];
}

const ARENA_RADIUS = 20;
const BOSS_TARGET_RING_RADIUS = 6;
const TOWER_RING_RADIUS = 8;
const TOWER_RADIUS = 4;
const TOWER_REQUIRED_PLAYERS = 2;
const MARKER_DISPLAY_MS = 5_000;
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
const BOT_EVEN_OTHER_BAIT_TANGENTIAL_OFFSET = 4.45;
const BOT_EVEN_OTHER_BAIT_INWARD_OFFSET = -0.35;
const BOT_EVEN_OTHER_NEAR_BAIT_RADIUS = BOSS_TARGET_RING_RADIUS - 1;
const INITIAL_MARKER_POOL: MarkerPool = {
  share: 8,
  largeCircle: 12,
  fan: 12,
};
const FALLBACK_MARKERS = ['share', 'largeCircle', 'fan'] as const satisfies readonly KefkaMarker[];
const TANK_HEALER_SLOTS = ['MT', 'ST', 'H1', 'H2'] as const satisfies readonly PartySlot[];
const DPS_SLOTS = ['D1', 'D2', 'D3', 'D4'] as const satisfies readonly PartySlot[];
const INITIAL_SOUTH_POSITIONS: Record<PartySlot, Vector2> = {
  MT: { x: -4.2, y: 12 },
  ST: { x: -3, y: 12 },
  H1: { x: -1.8, y: 12 },
  H2: { x: -0.6, y: 12 },
  D1: { x: 0.6, y: 12 },
  D2: { x: 1.8, y: 12 },
  D3: { x: 3, y: 12 },
  D4: { x: 4.2, y: 12 },
};
const A_GROUP_ROUNDS = new Set([1, 2, 3, 8]);

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
    resolveAfterMs: MARKER_DISPLAY_MS,
  });
}

function applyMarkerAssignments(
  ctx: BattleScriptContext,
  assignments: Array<[BaseActorSnapshot, KefkaMarker]>,
): void {
  const activeMarkers = getActiveMarkers(ctx);

  for (const [actor, marker] of assignments) {
    activeMarkers[actor.id] = marker;
    showMarker(ctx, actor, marker);
  }

  setActiveMarkers(ctx, activeMarkers);
}

function createInitialBotGroups(
  assignments: Array<[BaseActorSnapshot, KefkaMarker]>,
): KefkaBotGroups {
  const slotsByMarker: Record<KefkaMarker, PartySlot[]> = {
    share: [],
    largeCircle: [],
    fan: [],
  };

  for (const [actor, marker] of assignments) {
    if (actor.slot !== null) {
      slotsByMarker[marker].push(actor.slot);
    }
  }

  const aFanSlot = sortSlotsByPriority(slotsByMarker.fan)[0];
  const aLargeCircleSlot = sortSlotsByPriority(slotsByMarker.largeCircle)[0];

  if (aFanSlot === undefined || aLargeCircleSlot === undefined) {
    throw new Error('凯夫卡一运缺少初始 A/B 分组点名');
  }

  const aSlots = sortSlotsByPriority([...slotsByMarker.share, aFanSlot, aLargeCircleSlot]);
  const aSlotSet = new Set(aSlots);
  const bSlots = PARTY_SLOT_ORDER.filter((slot) => !aSlotSet.has(slot));

  return {
    a: aSlots,
    b: bSlots,
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

  setMarkerPool(ctx, markerPool);
  applyMarkerAssignments(ctx, assignments);
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
  const handlers = round.towerPositions.flatMap((towerPosition) =>
    selectTowerHandlers(ctx, towerPosition, roundIndex),
  );
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
    markerResolutions,
    nearAoeResolutions,
    addPositions,
  });
}

function resolveTowerRound(ctx: BattleScriptContext, roundIndex: number): void {
  const lockedResolution = getLockedRoundResolution(ctx, roundIndex);
  const handlers = lockedResolution?.handlers ?? [];
  const activeMarkers = getActiveMarkers(ctx);

  for (const resolution of lockedResolution?.markerResolutions ?? []) {
    applyLockedMarkerResolution(ctx, resolution);
  }

  for (const resolution of lockedResolution?.nearAoeResolutions ?? []) {
    applyLockedMarkerResolution(ctx, resolution);
  }

  for (const handler of handlers) {
    delete activeMarkers[handler.id];
  }

  setActiveMarkers(ctx, activeMarkers);
  assignNextMarkers(ctx, roundIndex, handlers);

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
  return A_GROUP_ROUNDS.has(roundIndex) ? 'a' : 'b';
}

function getOtherGroupKey(groupKey: keyof KefkaBotGroups): keyof KefkaBotGroups {
  return groupKey === 'a' ? 'b' : 'a';
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

function getLocalTowerPoint(tower: Vector2, leftOffset: number, radialOffset: number): Vector2 {
  const radialOut = normalizeVector(tower);
  const inward = {
    x: -radialOut.x,
    y: -radialOut.y,
  };
  const left = {
    x: inward.y,
    y: -inward.x,
  };

  return {
    x: tower.x + left.x * leftOffset + radialOut.x * radialOffset,
    y: tower.y + left.y * leftOffset + radialOut.y * radialOffset,
  };
}

function getOuterTowerPoint(tower: Vector2, otherTower: Vector2): Vector2 {
  const candidates = [
    getLocalTowerPoint(
      tower,
      BOT_EVEN_OTHER_BAIT_TANGENTIAL_OFFSET,
      BOT_EVEN_OTHER_BAIT_INWARD_OFFSET,
    ),
    getLocalTowerPoint(
      tower,
      -BOT_EVEN_OTHER_BAIT_TANGENTIAL_OFFSET,
      BOT_EVEN_OTHER_BAIT_INWARD_OFFSET,
    ),
  ];

  return distance(candidates[0]!, otherTower) > distance(candidates[1]!, otherTower)
    ? candidates[0]!
    : candidates[1]!;
}

function getRoleTarget(
  slot: PartySlot,
  slotsByMarker: Record<KefkaMarker, PartySlot[]>,
  marker: KefkaMarker,
  points: Vector2[],
): Vector2 | null {
  const markerIndex = slotsByMarker[marker].indexOf(slot);

  return markerIndex < 0 ? null : (points[markerIndex] ?? null);
}

function getSharePatternTarget(
  slot: PartySlot,
  groupSlotsByMarker: Record<KefkaMarker, PartySlot[]>,
  otherSlotsByMarker: Record<KefkaMarker, PartySlot[]>,
  leftTower: Vector2,
  rightTower: Vector2,
): Vector2 | null {
  return (
    getRoleTarget(slot, groupSlotsByMarker, 'largeCircle', [
      getLocalTowerPoint(leftTower, 3.45, 0),
    ]) ??
    getRoleTarget(slot, groupSlotsByMarker, 'share', [
      getLocalTowerPoint(leftTower, -3.25, 0),
      getLocalTowerPoint(rightTower, 0, -3.25),
    ]) ??
    getRoleTarget(slot, groupSlotsByMarker, 'fan', [getLocalTowerPoint(rightTower, -1.5, 1.1)]) ??
    getRoleTarget(slot, otherSlotsByMarker, 'largeCircle', [
      getLocalTowerPoint(leftTower, -5.6, 0),
      getLocalTowerPoint(rightTower, -5.6, 2.6),
    ]) ??
    getRoleTarget(slot, otherSlotsByMarker, 'fan', [
      getLocalTowerPoint(leftTower, -5.2, 1.0),
      getLocalTowerPoint(rightTower, 0, -5.2),
    ])
  );
}

function getNoSharePatternTarget(
  slot: PartySlot,
  groupSlotsByMarker: Record<KefkaMarker, PartySlot[]>,
  otherSlotsByMarker: Record<KefkaMarker, PartySlot[]>,
  otherGroupSlots: readonly PartySlot[],
  leftTower: Vector2,
  rightTower: Vector2,
): Vector2 | null {
  const leftOpposite = createPointOnRadius(
    Math.atan2(leftTower.y, leftTower.x) + Math.PI,
    BOT_EVEN_OTHER_NEAR_BAIT_RADIUS,
  );
  const rightOpposite = createPointOnRadius(
    Math.atan2(rightTower.y, rightTower.x) + Math.PI,
    BOT_EVEN_OTHER_NEAR_BAIT_RADIUS,
  );
  const otherSlotIndex = sortSlotsByPriority(otherGroupSlots).indexOf(slot);
  const leftFanPoint = getLocalTowerPoint(leftTower, 0, -3.45);
  const rightFanPoint = getLocalTowerPoint(rightTower, 0, -3.45);
  const otherTargets = [
    getOuterTowerPoint(leftTower, rightTower),
    getOuterTowerPoint(rightTower, leftTower),
    leftOpposite,
    rightOpposite,
  ];

  return (
    getRoleTarget(slot, groupSlotsByMarker, 'largeCircle', [
      getLocalTowerPoint(leftTower, 0, 3.45),
      getLocalTowerPoint(rightTower, 0, 3.45),
    ]) ??
    getRoleTarget(slot, groupSlotsByMarker, 'fan', [leftFanPoint, rightFanPoint]) ??
    otherTargets[otherSlotIndex] ??
    getRoleTarget(slot, otherSlotsByMarker, 'largeCircle', otherTargets) ??
    getRoleTarget(slot, otherSlotsByMarker, 'fan', otherTargets)
  );
}

function getRoundBotTarget(
  slot: PartySlot,
  round: KefkaTowerRound,
  actors: BaseActorSnapshot[],
  activeMarkers: Record<string, KefkaMarker>,
  groups: KefkaBotGroups,
): Vector2 {
  const groupKey = getRoundGroupKey(round.index);
  const otherGroupKey = getOtherGroupKey(groupKey);
  const groupSlotsByMarker = getMarkerSlotsByGroup(actors, activeMarkers, groups[groupKey]);
  const otherSlotsByMarker = getMarkerSlotsByGroup(actors, activeMarkers, groups[otherGroupKey]);
  const [leftTower, rightTower] = round.towerPositions;
  const hasShare = groupSlotsByMarker.share.length > 0;
  const target = hasShare
    ? getSharePatternTarget(slot, groupSlotsByMarker, otherSlotsByMarker, leftTower, rightTower)
    : getNoSharePatternTarget(
        slot,
        groupSlotsByMarker,
        otherSlotsByMarker,
        groups[otherGroupKey],
        leftTower,
        rightTower,
      );

  if (target !== null) {
    return target;
  }

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
  actors: BaseActorSnapshot[],
  scriptState: Record<string, unknown>,
): Vector2 {
  const groups = getBotGroupsFromSnapshot(scriptState);
  const rounds = getTowerRoundsFromSnapshot(scriptState);
  const activeMarkers = getActiveMarkersFromSnapshot(scriptState);
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

  return getRoundBotTarget(slot, round, actors, activeMarkers, groups);
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
  const target = getKefkaBotTarget(slot, snapshot.timeMs, snapshot.actors, snapshot.scriptState);
  const faceAngle = createFacingTowards(actor.position, snapshot.boss.position);

  return {
    pose: createPoseTowards(actor, target, faceAngle),
  };
};

export const KEFKA_P2_FIRST_FORSAKEN_TESTING = {
  FAN_ANGLE,
  getLocalTowerPoint,
  getOuterTowerPoint,
  getNoSharePatternTarget,
  getFootBaitTarget,
  getFinalFootDodgeTarget,
};
