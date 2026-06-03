import type { BattleDefinition, BattleScriptContext } from '@ff14arena/core';
import {
  FIXED_TICK_MS,
  INJURY_UP_MULTIPLIER,
  createFacingTowards,
  distance,
} from '@ff14arena/core';
import type { BaseActorSnapshot, MapMarker, PartySlot, StatusId, Vector2 } from '@ff14arena/shared';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { getStatusDisplayName } from '../status-metadata';

type ElementType = 'fire' | 'water' | 'wind';
type PendingElementKind = 'fire' | 'water' | 'wind';
type WindStatusId = typeof CHAOS_WIND_STATUS_ID | typeof CHAOS_REVERSE_WIND_STATUS_ID;

interface KefkaP3ElementBlock {
  type: ElementType;
  position: Vector2;
}

interface PendingElementResolution {
  kind: PendingElementKind;
  count: number;
  resolveAt: number;
}

const ARENA_RADIUS = 20;
const BOSS_TARGET_RING_RADIUS = 6;
const CENTER = { x: 0, y: 0 } as const satisfies Vector2;
const DEEP_AGONY_CAST_START_AT = 3_000;
const DEEP_AGONY_CAST_MS = 4_700;
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
const DELAYED_RESOLUTION_MS = FIXED_TICK_MS * 5;
const TELEGRAPH_MS = 500;
const COMPLETE_AT = MECHANIC_START_AT + LONG_ELEMENT_BUFF_MS + DELAYED_RESOLUTION_MS * 2 + 5_000;

const CHAOS_FIRE_STATUS_ID = 'kefka_p3_chaos_fire';
const CHAOS_WATER_STATUS_ID = 'kefka_p3_chaos_water';
const CHAOS_WIND_STATUS_ID = 'kefka_p3_chaos_wind';
const CHAOS_REVERSE_WIND_STATUS_ID = 'kefka_p3_chaos_reverse_wind';
const WIND_STATUS_IDS = [CHAOS_WIND_STATUS_ID, CHAOS_REVERSE_WIND_STATUS_ID] as const;
const TANK_HEALER_SLOTS = ['MT', 'ST', 'H1', 'H2'] as const satisfies readonly PartySlot[];
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
  return actors.filter((actor) => actor.alive && distance(actor.position, center) <= radius);
}

function getActorsInsideDonut(
  actors: BaseActorSnapshot[],
  center: Vector2,
  innerRadius: number,
  outerRadius: number,
): BaseActorSnapshot[] {
  return actors.filter((actor) => {
    if (!actor.alive) {
      return false;
    }

    const hitDistance = distance(actor.position, center);

    return hitDistance >= innerRadius && hitDistance <= outerRadius;
  });
}

function getFreshActor(ctx: BattleScriptContext, actorId: string): BaseActorSnapshot | null {
  return getActorById(ctx.select.allPlayers(), actorId);
}

function applyKefkaP3Damage(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  sourceLabel: string,
): void {
  const freshActor = getFreshActor(ctx, actor.id);

  if (freshActor === null || !freshActor.alive) {
    return;
  }

  if (hasStatus(freshActor, 'injury_up')) {
    ctx.damage.kill([freshActor.id], sourceLabel);
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

  if (actor === null || !actor.alive) {
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

  if (actor === null || !actor.alive) {
    return;
  }

  ctx.spawn.donutTelegraph({
    label: '混沌之水预兆',
    center: actor.position,
    innerRadius: WATER_SELF_INNER_RADIUS,
    outerRadius: WATER_SELF_OUTER_RADIUS,
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
    .filter((actor) => actor.alive)
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

  if (freshActor === null || !freshActor.alive) {
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
): void {
  for (const hit of hits) {
    const freshActor = getFreshActor(ctx, hit.id);

    if (freshActor === null || !freshActor.alive) {
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
      label: '火元素追击预兆',
      center: target.position,
      innerRadius: FIRE_ELEMENT_INNER_RADIUS,
      outerRadius: FIRE_ELEMENT_OUTER_RADIUS,
      resolveAfterMs: TELEGRAPH_MS,
    });
  }

  ctx.timeline.at(ctx.state.getBattleTime() + TELEGRAPH_MS, () => {
    for (const target of targets) {
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

      applyElementKnockback(ctx, hits, fireElement.position);
    }
  });
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
      label: '水元素追击预兆',
      center: target.position,
      radius: WATER_ELEMENT_RADIUS,
      resolveAfterMs: TELEGRAPH_MS,
    });
  }

  ctx.timeline.at(ctx.state.getBattleTime() + TELEGRAPH_MS, () => {
    for (const target of targets) {
      const actors = ctx.select.allPlayers();
      const hits = getActorsInsideCircle(actors, target.position, WATER_ELEMENT_RADIUS);

      for (const hit of hits) {
        applyKefkaP3Damage(ctx, hit, '水元素块');
      }

      applyElementKnockback(ctx, hits, waterElement.position);
    }
  });
}

function resolveWindShare(ctx: BattleScriptContext, count: number): void {
  const waterElement = getElementBlock(ctx, 'water');
  const targets = selectNearestDistinctActors(
    ctx.select.allPlayers(),
    waterElement.position,
    count,
  );

  for (const target of targets) {
    ctx.spawn.circleTelegraph({
      label: '混沌之风分摊预兆',
      center: target.position,
      radius: WIND_SHARE_RADIUS,
      resolveAfterMs: TELEGRAPH_MS,
    });
  }

  ctx.timeline.at(ctx.state.getBattleTime() + TELEGRAPH_MS, () => {
    for (const target of targets) {
      const hits = getActorsInsideCircle(
        ctx.select.allPlayers(),
        target.position,
        WIND_SHARE_RADIUS,
      );

      if (hits.length < WIND_SHARE_REQUIRED_PLAYERS) {
        ctx.state.fail('混沌之风分摊人数不足');
        ctx.damage.kill([target.id], '混沌之风分摊人数不足');
        continue;
      }

      for (const hit of hits) {
        applyKefkaP3Damage(ctx, hit, '混沌之风分摊');
      }
    }
  });
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

function buildKefkaP3Script(ctx: BattleScriptContext): void {
  ctx.timeline.at(DEEP_AGONY_CAST_START_AT, () => {
    ctx.boss.cast('kefka_p3_deep_agony', '深层痛楚', DEEP_AGONY_CAST_MS);
  });

  ctx.timeline.at(MECHANIC_START_AT, () => {
    ctx.boss.clearCast();
    const elementBlocks = createElementBlocks();
    ctx.state.setValue('kefkaP3:elementBlocks', elementBlocks);
    spawnElementBlocks(ctx, elementBlocks);
    assignInitialStatuses(ctx);
  });

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
  DELAYED_RESOLUTION_MS,
  ELEMENT_CORNERS,
  createElementBlocks,
  getKnockbackDistance,
};
