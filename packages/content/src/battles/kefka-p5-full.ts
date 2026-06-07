import type { BattleDefinition, BattleScriptContext } from '@ff14arena/core';
import { INJURY_UP_MULTIPLIER, createFacingTowards, distance } from '@ff14arena/core';
import type { BaseActorSnapshot, PartySlot, StatusId, Vector2 } from '@ff14arena/shared';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import type { BattleBotController } from '../runtime/bot';
import { createPoseTowards } from '../runtime/bot';
import { getStatusDisplayName } from '../status-metadata';
import {
  KEFKA_P5_ARENA_RADIUS as ARENA_RADIUS,
  KEFKA_P5_BOSS_TARGET_RING_RADIUS as BOSS_TARGET_RING_RADIUS,
  KEFKA_P5_CENTER as CENTER,
  KEFKA_P5_INITIAL_POSITIONS as INITIAL_POSITIONS,
  KEFKA_P5_MAP_MARKERS as KEFKA_MAP_MARKERS,
  KEFKA_P5_NORTH_ANGLE as NORTH_ANGLE,
  pointOnRadius,
} from './kefka-p5-common';

type Element = 'fire' | 'ice' | 'lightning';
type DisasterMode = 'wind' | 'earth';
type FloodDirectionId = 'slash' | 'backslash';
type FloodVariantId =
  | 'slash_near_right'
  | 'slash_near_left'
  | 'backslash_near_right'
  | 'backslash_near_left';
type FireSide = 'left' | 'right';
type FireNumber = 1 | 2 | 3 | 4 | 5 | 6;
type FireGroupId = '14' | '25' | '36';

interface RectSpec {
  center: Vector2;
  direction: number;
  length: number;
  width: number;
}

interface FloodVariant {
  id: FloodVariantId;
  directionId: FloodDirectionId;
  direction: number;
  side: 1 | -1;
}

interface FloodRound {
  index: number;
  variantId: FloodVariantId;
  previewAt: number;
  resolveAt: number;
}

interface FloodPlan {
  rounds: FloodRound[];
  botRoute: Vector2[];
}

interface MagicStrikeTargets {
  tankTargetId: string;
  healerTargetId: string;
  dpsTargetId: string;
}

interface MadSymphonyAssignments {
  firstTankTargetIds: string[];
  firstDhTargetIds: string[];
  secondDhTargetIds?: string[];
  nuclearTargetId: string;
  holyTargetId: string;
}

interface ThreeStarsTower {
  index: number;
  group: 'bottom' | 'leftUpper' | 'rightUpper';
  element: Element;
  position: Vector2;
}

interface ElementVulnerabilityAssignment {
  actorId: string;
  element: Element;
}

interface ActiveTowerRound {
  index: number;
  lightAt: number;
  resolveAt: number;
  repeatElement: Element;
  towerIndexes: number[];
}

interface DisasterCast {
  index: number;
  castStartAt: number;
  castResolveAt: number;
  rangeResolveAt: number;
  mode: DisasterMode;
}

interface ThreeStarsPlan {
  assignments: ElementVulnerabilityAssignment[];
  idleActorIds: string[];
  towers: ThreeStarsTower[];
  rounds: ActiveTowerRound[];
  disasters: DisasterCast[];
}

interface FireBatch {
  side: FireSide;
  numbers: readonly FireNumber[];
  castAt: number;
  firstHitAt: number;
  botPoint: Vector2;
}

interface FirePlan {
  left: readonly FireGroupId[];
  right: readonly FireGroupId[];
  batches: FireBatch[];
}

const CONTINUOUS_ULTIMATE_CAST_MS = 3_700;
const CONTINUOUS_ULTIMATE_CAST_ATS = [0, 81_906] as const;
const CONTINUOUS_ULTIMATE_RESOLVE_ATS = [3_700, 85_606] as const;
const MAGIC_STRIKE_HIT_ATS = [
  9_672, 12_834, 15_953, 46_608, 49_731, 91_577, 94_738, 138_682, 141_803, 144_923,
] as const;
const COMPLETE_AT = 145_923;

const FLOOD_CAST_START_AT = 16_556;
const FLOOD_CAST_MS = 4_700;
const FLOOD_PREVIEW_ATS = [17_828, 18_853, 19_832, 20_856] as const;
const FLOOD_RESOLVE_ATS = [22_369, 23_396, 24_420, 25_445] as const;
const FLOOD_TELEGRAPH_DISPLAY_MS = 1_300;
const FLOOD_HIT_DISPLAY_MS = 300;
const FLOOD_LENGTH = 40;
const FLOOD_WIDTH = 10;
const FLOOD_NEAR_OFFSET = 5;
const FLOOD_FAR_OFFSET = 15;

const MAD_SYMPHONY_CAST_MS = 4_700;
const MAD_SYMPHONY_CAST_RESOLVE_ATS = [34_446, 126_517] as const;
const MAD_FIRST_HIT_ATS = [35_338, 127_405] as const;
const MAD_SECOND_HIT_ATS = [38_497, 130_569] as const;
const MAD_FIRST_HIT_OFFSETS = [35_338 - 34_446, 127_405 - 126_517] as const;
const MAD_BUFF_APPLY_OFFSETS = [35_959 - 34_446, 128_027 - 126_517] as const;
const MAD_SECOND_HIT_OFFSETS = [38_497 - 34_446, 130_569 - 126_517] as const;
const MAD_BUFF_RESOLVE_OFFSETS = [42_018 - 34_446, 134_090 - 126_517] as const;
const MAD_TELEGRAPH_MS = 500;

const THREE_STARS_CAST_RESOLVE_AT = 56_144;
const THREE_STARS_CAST_MS = 4_700;
const INITIAL_ELEMENT_VULNERABILITY_EXPIRES_AT = 76_155;
const TOWER_LIGHT_ATS = [59_901, 65_919, 71_937] as const;
const TOWER_RESOLVE_ATS = [65_901, 71_919, 77_937] as const;
const BASE_TOWER_DESPAWN_AT = TOWER_RESOLVE_ATS[TOWER_RESOLVE_ATS.length - 1]! + 300;
const DISASTER_CAST_RESOLVE_ATS = [64_611, 76_778] as const;
const DISASTER_RANGE_RESOLVE_ATS = [65_411, 77_583] as const;
const DISASTER_CAST_MS = 4_000;

const FIRE_CAST_RESOLVE_ATS = [100_132, 102_674, 105_173, 107_669, 110_161, 112_658] as const;
const FIRE_CAST_MS = 3_700;
const FIRE_FIRST_HIT_DELAY_MS = 625;
const FIRE_HIT_INTERVAL_MS = 500;
const FIRE_HIT_COUNT = 7;
const FIRE_SAFE_MARGIN = 1;
const FIRE_BOT_LOOKAHEAD_MS = 1_200;

const CHAOS_VORTEX_CAST_START_AT = 112_636;
const CHAOS_VORTEX_CAST_RESOLVE_AT = 117_336;
const CHAOS_VORTEX_CAST_MS = 4_700;
const CHAOS_VORTEX_HIT_AT = 118_228;

const MAGIC_STRIKE_INJURY_MS = 960;
const MAD_TANK_INJURY_MS = 960;
const MAD_DH_INJURY_MS = 3_960;
const MAD_BUFF_INJURY_MS = 960;
const CHAOS_VORTEX_INJURY_MS = 1_960;
const MECHANIC_DAMAGE = 1;
const TANK_SPREAD_RADIUS = 5;
const DH_SPREAD_RADIUS = 5;
const HOLY_SHARE_RADIUS = 5;
const NUCLEAR_RADIUS = 18;
const MAGIC_STRIKE_RADIUS = 5;
const CHAOS_VORTEX_RADIUS = 5;
const TOWER_RADIUS = 3;
const TOWER_DISTANCE = 10;
const TOWER_COUNT = 9;
const FIRE_AOE_RADIUS = 6;
const FIRE_GRID_STEP = 5;
const FIRE_COLOR = '#f97316';
const FLOOD_COLOR = '#38bdf8';

const NUCLEAR_STATUS_ID = 'kefka_p5_extra_nuclear_blast';
const HOLY_STATUS_ID = 'kefka_p5_extra_holy';
const FLOOD_PLAN_KEY = 'kefkaP5Full:floodPlan';
const MAGIC_STRIKE_TARGETS_KEY_PREFIX = 'kefkaP5Full:magicStrikeTargets';
const MAD_ASSIGNMENTS_KEY_PREFIX = 'kefkaP5Full:madAssignments';
const THREE_STARS_PLAN_KEY = 'kefkaP5Full:threeStarsPlan';
const FIRE_PLAN_KEY = 'kefkaP5Full:firePlan';

const TANK_SLOTS = ['MT', 'ST'] as const satisfies readonly PartySlot[];
const HEALER_SLOTS = ['H1', 'H2'] as const satisfies readonly PartySlot[];
const DPS_SLOTS = ['D1', 'D2', 'D3', 'D4'] as const satisfies readonly PartySlot[];
const DH_SLOTS = [...HEALER_SLOTS, ...DPS_SLOTS] as const satisfies readonly PartySlot[];
const ELEMENTS = ['fire', 'ice', 'lightning'] as const satisfies readonly Element[];
const ELEMENT_STATUS_IDS = {
  fire: 'kefka_p5_three_stars_fire_resistance_down',
  ice: 'kefka_p5_three_stars_ice_resistance_down',
  lightning: 'kefka_p5_three_stars_lightning_resistance_down',
} as const satisfies Record<Element, StatusId>;
const ELEMENT_LABELS = {
  fire: '火',
  ice: '冰',
  lightning: '雷',
} as const satisfies Record<Element, string>;
const ELEMENT_TOWER_COLORS = {
  fire: '#ef4444',
  ice: '#38bdf8',
  lightning: '#a855f7',
} as const satisfies Record<Element, string>;
const DISASTER_COLORS = {
  wind: '#22c55e',
  earth: '#eab308',
} as const satisfies Record<DisasterMode, string>;
const TOWER_GROUP_INDEXES = {
  bottom: [8, 0, 1],
  leftUpper: [2, 3, 4],
  rightUpper: [5, 6, 7],
} as const satisfies Record<ThreeStarsTower['group'], readonly number[]>;
const FIRE_GROUPS = {
  '14': [1, 4],
  '25': [2, 5],
  '36': [3, 6],
} as const satisfies Record<FireGroupId, readonly FireNumber[]>;
const FIRE_GROUP_IDS = ['14', '25', '36'] as const satisfies readonly FireGroupId[];

const BOT_MAGIC_TANK_POINT = pointOnRadius(NORTH_ANGLE, BOSS_TARGET_RING_RADIUS);
const BOT_MAGIC_HEALER_POINT = pointOnRadius((Math.PI * 3) / 4, BOSS_TARGET_RING_RADIUS);
const BOT_MAGIC_DPS_POINT = pointOnRadius(Math.PI / 4, BOSS_TARGET_RING_RADIUS);
const BOT_NUCLEAR_POINT = pointOnRadius(NORTH_ANGLE, ARENA_RADIUS);
const BOT_HOLY_SHARE_POINT = pointOnRadius(NORTH_ANGLE + Math.PI, 6);
const BOT_NON_SHARE_RIGHT_POINT = pointOnRadius(Math.PI / 3, 12);
const BOT_NON_SHARE_LEFT_POINT = pointOnRadius((Math.PI * 2) / 3, 12);
const BOT_CHAOS_VORTEX_RADIUS = 13;
const BOT_STACK_OFFSET = 0.45;

const FLOOD_VARIANTS = [
  {
    id: 'slash_near_right',
    directionId: 'slash',
    direction: Math.PI / 4,
    side: 1,
  },
  {
    id: 'slash_near_left',
    directionId: 'slash',
    direction: Math.PI / 4,
    side: -1,
  },
  {
    id: 'backslash_near_right',
    directionId: 'backslash',
    direction: -Math.PI / 4,
    side: 1,
  },
  {
    id: 'backslash_near_left',
    directionId: 'backslash',
    direction: -Math.PI / 4,
    side: -1,
  },
] as const satisfies readonly FloodVariant[];

function shuffle<T>(values: readonly T[]): T[] {
  const shuffled = [...values];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }

  return shuffled;
}

function getActorById(
  actors: readonly BaseActorSnapshot[],
  actorId: string,
): BaseActorSnapshot | null {
  return actors.find((actor) => actor.id === actorId) ?? null;
}

function getFreshActor(ctx: BattleScriptContext, actorId: string): BaseActorSnapshot | null {
  return getActorById(ctx.select.allPlayers(), actorId);
}

function getActorBySlot(ctx: BattleScriptContext, slot: PartySlot): BaseActorSnapshot {
  const actor = ctx.select.bySlot(slot);

  if (actor === undefined) {
    throw new Error(`missing actor for slot ${slot}`);
  }

  return actor;
}

function getActorsInsideCircle(
  actors: readonly BaseActorSnapshot[],
  center: Vector2,
  radius: number,
): BaseActorSnapshot[] {
  return actors.filter(
    (actor) => actor.mechanicActive && distance(actor.position, center) <= radius,
  );
}

function hasStatus(actor: BaseActorSnapshot, statusId: StatusId): boolean {
  return actor.statuses.some((status) => status.id === statusId);
}

function isTankSlot(slot: PartySlot | null): boolean {
  return TANK_SLOTS.includes(slot as (typeof TANK_SLOTS)[number]);
}

function isDpsSlot(slot: PartySlot | null): boolean {
  return DPS_SLOTS.includes(slot as (typeof DPS_SLOTS)[number]);
}

function addVector(left: Vector2, right: Vector2): Vector2 {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
  };
}

function clampPointToArena(point: Vector2, margin = 0.25): Vector2 {
  const length = Math.hypot(point.x, point.y);
  const maxLength = ARENA_RADIUS - margin;

  if (length <= maxLength || length <= 0.0001) {
    return point;
  }

  return {
    x: (point.x / length) * maxLength,
    y: (point.y / length) * maxLength,
  };
}

function getSlotOffset(slot: PartySlot, radius = BOT_STACK_OFFSET): Vector2 {
  const index = PARTY_SLOT_ORDER.indexOf(slot);
  const angle = NORTH_ANGLE + (Math.PI * 2 * index) / PARTY_SLOT_ORDER.length;

  return pointOnRadius(angle, radius);
}

function offsetPointForSlot(point: Vector2, slot: PartySlot, radius = BOT_STACK_OFFSET): Vector2 {
  return clampPointToArena(addVector(point, getSlotOffset(slot, radius)));
}

function applyMechanicDamage(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  sourceLabel: string,
  injuryDurationMs: number,
): void {
  const freshActor = getFreshActor(ctx, actor.id);

  if (freshActor === null || !freshActor.mechanicActive) {
    return;
  }

  if (hasStatus(freshActor, 'injury_up')) {
    ctx.damage.kill([freshActor.id], sourceLabel);
    return;
  }

  ctx.damage.apply([freshActor.id], MECHANIC_DAMAGE, sourceLabel);
  ctx.status.apply([freshActor.id], 'injury_up', injuryDurationMs, {
    multiplier: INJURY_UP_MULTIPLIER,
    name: getStatusDisplayName('injury_up'),
  });
}

function getFloodVariant(variantId: FloodVariantId): FloodVariant {
  const variant = FLOOD_VARIANTS.find((candidate) => candidate.id === variantId);

  if (variant === undefined) {
    throw new Error(`missing flood variant ${variantId}`);
  }

  return variant;
}

function createFloodRect(direction: number, offset: number): RectSpec {
  const normal = {
    x: -Math.sin(direction),
    y: Math.cos(direction),
  };
  const lineCenter = {
    x: normal.x * offset,
    y: normal.y * offset,
  };

  return {
    center: {
      x: lineCenter.x - Math.cos(direction) * (FLOOD_LENGTH / 2),
      y: lineCenter.y - Math.sin(direction) * (FLOOD_LENGTH / 2),
    },
    direction,
    length: FLOOD_LENGTH,
    width: FLOOD_WIDTH,
  };
}

function getFloodRoundRects(round: FloodRound): RectSpec[] {
  const variant = getFloodVariant(round.variantId);

  return [
    createFloodRect(variant.direction, variant.side * FLOOD_NEAR_OFFSET),
    createFloodRect(variant.direction, -variant.side * FLOOD_FAR_OFFSET),
  ];
}

function isPointInsideRect(point: Vector2, spec: RectSpec): boolean {
  const relative = {
    x: point.x - spec.center.x,
    y: point.y - spec.center.y,
  };
  const forward = {
    x: Math.cos(spec.direction),
    y: Math.sin(spec.direction),
  };
  const projection = relative.x * forward.x + relative.y * forward.y;

  if (projection < 0 || projection > spec.length) {
    return false;
  }

  const lateral = Math.abs(relative.x * -forward.y + relative.y * forward.x);

  return lateral <= spec.width / 2;
}

function isActorInsideRect(actor: BaseActorSnapshot, spec: RectSpec): boolean {
  return actor.mechanicActive && isPointInsideRect(actor.position, spec);
}

function createFloodRounds(): FloodRound[] {
  const rounds: FloodRound[] = [];
  let remainingVariants = [...FLOOD_VARIANTS];
  let previousDirectionId: FloodDirectionId | null = null;

  for (let index = 0; index < FLOOD_RESOLVE_ATS.length; index += 1) {
    const candidates = remainingVariants.filter(
      (variant) => variant.directionId !== previousDirectionId,
    );
    const variant = candidates[Math.floor(Math.random() * candidates.length)]!;

    rounds.push({
      index,
      variantId: variant.id,
      previewAt: FLOOD_PREVIEW_ATS[index]!,
      resolveAt: FLOOD_RESOLVE_ATS[index]!,
    });
    remainingVariants = remainingVariants.filter((candidate) => candidate.id !== variant.id);
    previousDirectionId = variant.directionId;
  }

  return rounds;
}

function pointSafeForFlood(point: Vector2, round: FloodRound): boolean {
  return !getFloodRoundRects(round).some((rect) => isPointInsideRect(point, rect));
}

function createFloodBotRoute(rounds: readonly FloodRound[]): Vector2[] {
  const routePoints = [
    pointOnRadius(NORTH_ANGLE, 2),
    pointOnRadius(0, 2),
    pointOnRadius(Math.PI / 2, 2),
    pointOnRadius(Math.PI, 2),
  ];
  const directions = [1, -1] as const;

  for (const startIndex of routePoints.keys()) {
    for (const direction of directions) {
      const route = rounds.map((round, roundIndex) => {
        const pointIndex =
          (startIndex + routePoints.length + direction * roundIndex) % routePoints.length;
        return routePoints[pointIndex]!;
      });

      if (route.every((point, index) => pointSafeForFlood(point, rounds[index]!))) {
        return route;
      }
    }
  }

  return routePoints;
}

function createFloodPlan(): FloodPlan {
  const rounds = createFloodRounds();

  return {
    rounds,
    botRoute: createFloodBotRoute(rounds),
  };
}

function getOrCreateFloodPlan(ctx: BattleScriptContext): FloodPlan {
  const existingPlan = ctx.state.getValue<FloodPlan>(FLOOD_PLAN_KEY);

  if (existingPlan !== undefined) {
    return existingPlan;
  }

  const plan = createFloodPlan();
  ctx.state.setValue(FLOOD_PLAN_KEY, plan);
  return plan;
}

function spawnFloodTelegraphs(
  ctx: BattleScriptContext,
  round: FloodRound,
  resolveAfterMs: number,
): void {
  for (const rect of getFloodRoundRects(round)) {
    ctx.spawn.rectangleTelegraph({
      label: '洪水',
      center: rect.center,
      direction: rect.direction,
      length: rect.length,
      width: rect.width,
      color: FLOOD_COLOR,
      resolveAfterMs,
    });
  }
}

function resolveFlood(ctx: BattleScriptContext, round: FloodRound): void {
  const rects = getFloodRoundRects(round);
  const hits = ctx.select
    .allPlayers()
    .filter((actor) => rects.some((rect) => isActorInsideRect(actor, rect)));

  if (hits.length > 0) {
    ctx.damage.kill(
      hits.map((actor) => actor.id),
      '洪水',
    );
  }
}

function magicTargetsKey(hitAt: number): string {
  return `${MAGIC_STRIKE_TARGETS_KEY_PREFIX}:${hitAt}`;
}

function createMagicStrikeTargets(ctx: BattleScriptContext): MagicStrikeTargets {
  return {
    tankTargetId: shuffle(TANK_SLOTS.map((slot) => getActorBySlot(ctx, slot)))[0]!.id,
    healerTargetId: shuffle(HEALER_SLOTS.map((slot) => getActorBySlot(ctx, slot)))[0]!.id,
    dpsTargetId: shuffle(DPS_SLOTS.map((slot) => getActorBySlot(ctx, slot)))[0]!.id,
  };
}

function getOrCreateMagicStrikeTargets(
  ctx: BattleScriptContext,
  hitAt: number,
): MagicStrikeTargets {
  const key = magicTargetsKey(hitAt);
  const existingTargets = ctx.state.getValue<MagicStrikeTargets>(key);

  if (existingTargets !== undefined) {
    return existingTargets;
  }

  const targets = createMagicStrikeTargets(ctx);
  ctx.state.setValue(key, targets);
  return targets;
}

function spawnMagicStrikeMarker(
  ctx: BattleScriptContext,
  label: string,
  actorId: string,
  color: string,
  resolveAfterMs = 300,
): void {
  const actor = getActorById(ctx.select.allPlayers(), actorId);

  if (actor === null) {
    return;
  }

  ctx.spawn.actorMarker({
    label,
    target: actor,
    markerShape: 'stackCircle',
    radius: MAGIC_STRIKE_RADIUS,
    color,
    resolveAfterMs,
  });
}

function resolveMagicShare(
  ctx: BattleScriptContext,
  label: string,
  targetId: string,
  requiredPlayers: number,
): void {
  const target = getActorById(ctx.select.allPlayers(), targetId);

  if (target === null) {
    return;
  }

  const hits = getActorsInsideCircle(ctx.select.allPlayers(), target.position, MAGIC_STRIKE_RADIUS);

  if (hits.length < requiredPlayers) {
    ctx.state.fail(`${label}人数不足`);
    for (const hit of hits) {
      ctx.damage.kill([hit.id], label);
    }
    return;
  }

  for (const hit of hits) {
    applyMechanicDamage(ctx, hit, label, MAGIC_STRIKE_INJURY_MS);
  }
}

function resolveMagicStrike(ctx: BattleScriptContext, hitAt: number): void {
  const targets = getOrCreateMagicStrikeTargets(ctx, hitAt);

  spawnMagicStrikeMarker(ctx, '魔击T分摊', targets.tankTargetId, '#ef4444');
  spawnMagicStrikeMarker(ctx, '魔击H分摊', targets.healerTargetId, '#facc15');
  spawnMagicStrikeMarker(ctx, '魔击D分摊', targets.dpsTargetId, '#38bdf8');
  resolveMagicShare(ctx, '魔击T分摊', targets.tankTargetId, 2);
  resolveMagicShare(ctx, '魔击H分摊', targets.healerTargetId, 2);
  resolveMagicShare(ctx, '魔击D分摊', targets.dpsTargetId, 4);
}

function madAssignmentsKey(index: number): string {
  return `${MAD_ASSIGNMENTS_KEY_PREFIX}:${index}`;
}

function createMadAssignments(ctx: BattleScriptContext): MadSymphonyAssignments {
  const firstTankTargets = TANK_SLOTS.map((slot) => getActorBySlot(ctx, slot));
  const firstDhTargets = shuffle(DH_SLOTS.map((slot) => getActorBySlot(ctx, slot))).slice(0, 3);

  return {
    firstTankTargetIds: firstTankTargets.map((actor) => actor.id),
    firstDhTargetIds: firstDhTargets.map((actor) => actor.id),
    nuclearTargetId: getActorBySlot(ctx, 'MT').id,
    holyTargetId: getActorBySlot(ctx, 'ST').id,
  };
}

function getOrCreateMadAssignments(
  ctx: BattleScriptContext,
  index: number,
): MadSymphonyAssignments {
  const key = madAssignmentsKey(index);
  const existingAssignments = ctx.state.getValue<MadSymphonyAssignments>(key);

  if (existingAssignments !== undefined) {
    return existingAssignments;
  }

  const assignments = createMadAssignments(ctx);
  ctx.state.setValue(key, assignments);
  return assignments;
}

function getMadAssignments(
  ctx: BattleScriptContext,
  index: number,
): MadSymphonyAssignments | undefined {
  return ctx.state.getValue<MadSymphonyAssignments>(madAssignmentsKey(index));
}

function selectNearestTargets(
  actors: readonly BaseActorSnapshot[],
  count: number,
): BaseActorSnapshot[] {
  return [...actors]
    .filter((actor) => actor.mechanicActive)
    .sort((left, right) => {
      const distanceDiff = distance(left.position, CENTER) - distance(right.position, CENTER);

      if (Math.abs(distanceDiff) > 0.0001) {
        return distanceDiff;
      }

      return (left.slot ?? '').localeCompare(right.slot ?? '');
    })
    .slice(0, count);
}

function getOrCreateSecondDhTargets(
  ctx: BattleScriptContext,
  index: number,
  assignments: MadSymphonyAssignments,
): string[] {
  if (assignments.secondDhTargetIds !== undefined) {
    return assignments.secondDhTargetIds;
  }

  const nextAssignments = {
    ...assignments,
    secondDhTargetIds: selectNearestTargets(ctx.select.allPlayers(), 3).map((actor) => actor.id),
  };

  ctx.state.setValue(madAssignmentsKey(index), nextAssignments);
  return nextAssignments.secondDhTargetIds;
}

function applyTankSpread(ctx: BattleScriptContext, target: BaseActorSnapshot): void {
  const hits = getActorsInsideCircle(ctx.select.allPlayers(), target.position, TANK_SPREAD_RADIUS);

  for (const hit of hits) {
    if (isTankSlot(hit.slot)) {
      applyMechanicDamage(ctx, hit, '癫狂交响曲核爆', MAD_TANK_INJURY_MS);
    } else {
      ctx.damage.kill([hit.id], '癫狂交响曲核爆');
    }
  }
}

function applyDhSpread(ctx: BattleScriptContext, target: BaseActorSnapshot): void {
  const hits = getActorsInsideCircle(ctx.select.allPlayers(), target.position, DH_SPREAD_RADIUS);

  for (const hit of hits) {
    applyMechanicDamage(ctx, hit, '癫狂交响曲神圣', MAD_DH_INJURY_MS);
  }
}

function resolveMadFirstHit(ctx: BattleScriptContext, index: number): void {
  const assignments = getOrCreateMadAssignments(ctx, index);
  const actors = ctx.select.allPlayers();

  for (const actorId of assignments.firstTankTargetIds) {
    const actor = getActorById(actors, actorId);

    if (actor !== null) {
      applyTankSpread(ctx, actor);
    }
  }

  for (const actorId of assignments.firstDhTargetIds) {
    const actor = getActorById(actors, actorId);

    if (actor !== null) {
      applyDhSpread(ctx, actor);
    }
  }
}

function spawnMadSpreadTelegraphs(
  ctx: BattleScriptContext,
  targets: readonly BaseActorSnapshot[],
  label: string,
  radius: number,
  color: string,
): void {
  for (const target of targets) {
    ctx.spawn.circleTelegraph({
      label,
      center: target.position,
      radius,
      color,
      resolveAfterMs: MAD_TELEGRAPH_MS,
    });
  }
}

function spawnMadFirstTelegraphs(ctx: BattleScriptContext, index: number): void {
  const assignments = getOrCreateMadAssignments(ctx, index);
  const actors = ctx.select.allPlayers();
  const tankTargets = assignments.firstTankTargetIds
    .map((actorId) => getActorById(actors, actorId))
    .filter((actor): actor is BaseActorSnapshot => actor !== null);
  const dhTargets = assignments.firstDhTargetIds
    .map((actorId) => getActorById(actors, actorId))
    .filter((actor): actor is BaseActorSnapshot => actor !== null);

  spawnMadSpreadTelegraphs(ctx, tankTargets, '癫狂交响曲核爆预兆', TANK_SPREAD_RADIUS, '#ef4444');
  spawnMadSpreadTelegraphs(ctx, dhTargets, '癫狂交响曲神圣预兆', DH_SPREAD_RADIUS, '#38bdf8');
}

function resolveMadSecondHit(ctx: BattleScriptContext, index: number): void {
  const assignments = getMadAssignments(ctx, index);

  if (assignments === undefined) {
    return;
  }

  const actors = ctx.select.allPlayers();
  const tankTarget = getActorBySlot(ctx, 'MT');
  const tankHits = getActorsInsideCircle(actors, tankTarget.position, TANK_SPREAD_RADIUS).filter(
    (actor) => isTankSlot(actor.slot),
  );

  if (tankHits.length < 2) {
    ctx.state.fail('癫狂交响曲双T分摊人数不足');
    for (const hit of tankHits) {
      ctx.damage.kill([hit.id], '癫狂交响曲双T分摊');
    }
  } else {
    for (const hit of tankHits) {
      applyMechanicDamage(ctx, hit, '癫狂交响曲双T分摊', MAD_TANK_INJURY_MS);
    }
  }

  for (const actorId of getOrCreateSecondDhTargets(ctx, index, assignments)) {
    const actor = getActorById(actors, actorId);

    if (actor !== null) {
      applyDhSpread(ctx, actor);
    }
  }
}

function spawnMadSecondTelegraphs(ctx: BattleScriptContext, index: number): void {
  const assignments = getMadAssignments(ctx, index);

  if (assignments === undefined) {
    return;
  }

  const actors = ctx.select.allPlayers();
  const secondDhTargets = getOrCreateSecondDhTargets(ctx, index, assignments)
    .map((actorId) => getActorById(actors, actorId))
    .filter((actor): actor is BaseActorSnapshot => actor !== null);

  spawnMadSpreadTelegraphs(
    ctx,
    [getActorBySlot(ctx, 'MT')],
    '癫狂交响曲双T分摊预兆',
    TANK_SPREAD_RADIUS,
    '#ef4444',
  );
  spawnMadSpreadTelegraphs(ctx, secondDhTargets, '癫狂交响曲神圣预兆', DH_SPREAD_RADIUS, '#38bdf8');
}

function applyMadBuffs(ctx: BattleScriptContext, index: number, buffDurationMs: number): void {
  const assignments = getOrCreateMadAssignments(ctx, index);

  ctx.status.apply([assignments.nuclearTargetId], NUCLEAR_STATUS_ID, buffDurationMs, {
    name: getStatusDisplayName(NUCLEAR_STATUS_ID),
  });
  ctx.status.apply([assignments.holyTargetId], HOLY_STATUS_ID, buffDurationMs, {
    name: getStatusDisplayName(HOLY_STATUS_ID),
  });
}

function resolveMadBuffs(ctx: BattleScriptContext, index: number): void {
  const assignments = getMadAssignments(ctx, index);

  if (assignments === undefined) {
    return;
  }

  const actors = ctx.select.allPlayers();
  const holyTarget = getActorById(actors, assignments.holyTargetId);
  const nuclearTarget = getActorById(actors, assignments.nuclearTargetId);

  if (holyTarget !== null) {
    ctx.spawn.actorMarker({
      label: '混沌神圣',
      target: holyTarget,
      markerShape: 'stackCircle',
      radius: HOLY_SHARE_RADIUS,
      color: '#facc15',
      resolveAfterMs: 300,
    });
    const holyHits = getActorsInsideCircle(actors, holyTarget.position, HOLY_SHARE_RADIUS);

    if (holyHits.length < 4) {
      ctx.state.fail('混沌神圣分摊人数不足');
      for (const hit of holyHits) {
        ctx.damage.kill([hit.id], '混沌神圣');
      }
    } else {
      for (const hit of holyHits) {
        applyMechanicDamage(ctx, hit, '混沌神圣', MAD_BUFF_INJURY_MS);
      }
    }
  }

  if (nuclearTarget !== null) {
    ctx.spawn.circleTelegraph({
      label: '核爆扩散',
      center: nuclearTarget.position,
      radius: NUCLEAR_RADIUS,
      color: '#f97316',
      resolveAfterMs: 300,
    });

    for (const hit of getActorsInsideCircle(actors, nuclearTarget.position, NUCLEAR_RADIUS)) {
      applyMechanicDamage(ctx, hit, '核爆扩散', MAD_BUFF_INJURY_MS);
    }
  }
}

function getTowerPosition(index: number): Vector2 {
  return pointOnRadius(Math.PI / 2 + ((Math.PI * 2) / TOWER_COUNT) * index, TOWER_DISTANCE);
}

function getTowerGroup(index: number): ThreeStarsTower['group'] {
  for (const [group, indexes] of Object.entries(TOWER_GROUP_INDEXES)) {
    if ((indexes as readonly number[]).includes(index)) {
      return group as ThreeStarsTower['group'];
    }
  }

  throw new Error(`三星塔位 ${index} 缺少分组`);
}

function createTowers(): ThreeStarsTower[] {
  const shuffledElements = shuffle(ELEMENTS);
  const groupElements = Object.fromEntries(
    (Object.keys(TOWER_GROUP_INDEXES) as ThreeStarsTower['group'][]).map((group, index) => [
      group,
      shuffledElements[index]!,
    ]),
  ) as Record<ThreeStarsTower['group'], Element>;

  return Array.from({ length: TOWER_COUNT }, (_, index) => {
    const group = getTowerGroup(index);

    return {
      index,
      group,
      element: groupElements[group],
      position: getTowerPosition(index),
    };
  });
}

function createElementAssignments(
  ctx: BattleScriptContext,
): Pick<ThreeStarsPlan, 'assignments' | 'idleActorIds'> {
  const actors = shuffle(ctx.select.allPlayers());
  const assignedActors = actors.slice(0, ELEMENTS.length * 2);
  const assignments = assignedActors.map((actor, index) => ({
    actorId: actor.id,
    element: ELEMENTS[Math.floor(index / 2)]!,
  }));

  return {
    assignments: shuffle(assignments),
    idleActorIds: actors.slice(ELEMENTS.length * 2).map((actor) => actor.id),
  };
}

function createTowerRound(
  roundIndex: number,
  towers: readonly ThreeStarsTower[],
  repeatElement: Element,
  previousTowerIndexes: readonly number[],
): ActiveTowerRound {
  const previousIndexes = new Set(previousTowerIndexes);
  const towerIndexes = ELEMENTS.flatMap((element) => {
    const neededCount = element === repeatElement ? 2 : 1;
    const candidates = towers
      .filter((tower) => tower.element === element && !previousIndexes.has(tower.index))
      .map((tower) => tower.index);

    return shuffle(candidates).slice(0, neededCount);
  }).sort((left, right) => left - right);

  return {
    index: roundIndex,
    lightAt: TOWER_LIGHT_ATS[roundIndex]!,
    resolveAt: TOWER_RESOLVE_ATS[roundIndex]!,
    repeatElement,
    towerIndexes,
  };
}

function createTowerRounds(towers: readonly ThreeStarsTower[]): ActiveTowerRound[] {
  const repeatElements = shuffle(ELEMENTS);
  const rounds: ActiveTowerRound[] = [];

  for (let index = 0; index < ELEMENTS.length; index += 1) {
    rounds.push(
      createTowerRound(index, towers, repeatElements[index]!, rounds.at(-1)?.towerIndexes ?? []),
    );
  }

  return rounds;
}

function createDisasters(): DisasterCast[] {
  return DISASTER_CAST_RESOLVE_ATS.map((castResolveAt, index) => ({
    index,
    castStartAt: castResolveAt - DISASTER_CAST_MS,
    castResolveAt,
    rangeResolveAt: DISASTER_RANGE_RESOLVE_ATS[index]!,
    mode: Math.random() < 0.5 ? 'wind' : 'earth',
  }));
}

function createThreeStarsPlan(ctx: BattleScriptContext): ThreeStarsPlan {
  const towers = createTowers();

  return {
    ...createElementAssignments(ctx),
    towers,
    rounds: createTowerRounds(towers),
    disasters: createDisasters(),
  };
}

function getOrCreateThreeStarsPlan(ctx: BattleScriptContext): ThreeStarsPlan {
  const existingPlan = ctx.state.getValue<ThreeStarsPlan>(THREE_STARS_PLAN_KEY);

  if (existingPlan !== undefined) {
    return existingPlan;
  }

  const plan = createThreeStarsPlan(ctx);
  ctx.state.setValue(THREE_STARS_PLAN_KEY, plan);
  return plan;
}

function applyElementVulnerability(
  ctx: BattleScriptContext,
  actorIds: readonly string[],
  element: Element,
  durationMs: number,
): void {
  ctx.status.apply([...actorIds], ELEMENT_STATUS_IDS[element], durationMs, {
    name: getStatusDisplayName(ELEMENT_STATUS_IDS[element]),
  });
}

function applyInitialElementVulnerabilities(ctx: BattleScriptContext, plan: ThreeStarsPlan): void {
  for (const element of ELEMENTS) {
    applyElementVulnerability(
      ctx,
      plan.assignments
        .filter((assignment) => assignment.element === element)
        .map((assignment) => assignment.actorId),
      element,
      INITIAL_ELEMENT_VULNERABILITY_EXPIRES_AT - THREE_STARS_CAST_RESOLVE_AT,
    );
  }
}

function spawnBaseTowers(ctx: BattleScriptContext, plan: ThreeStarsPlan): void {
  for (const tower of plan.towers) {
    ctx.spawn.tower({
      label: `三星${ELEMENT_LABELS[tower.element]}塔`,
      center: tower.position,
      radius: TOWER_RADIUS,
      color: ELEMENT_TOWER_COLORS[tower.element],
      filled: false,
      resolveAfterMs: BASE_TOWER_DESPAWN_AT - THREE_STARS_CAST_RESOLVE_AT,
    });
  }
}

function spawnActiveTowers(
  ctx: BattleScriptContext,
  plan: ThreeStarsPlan,
  round: ActiveTowerRound,
): void {
  for (const towerIndex of round.towerIndexes) {
    const tower = plan.towers[towerIndex];

    if (tower === undefined) {
      continue;
    }

    ctx.spawn.tower({
      label: `三星第${round.index + 1}轮亮塔`,
      center: tower.position,
      radius: TOWER_RADIUS,
      color: ELEMENT_TOWER_COLORS[tower.element],
      filled: true,
      resolveAfterMs: round.resolveAt - round.lightAt,
    });
  }
}

function triggerPartyWipe(ctx: BattleScriptContext, sourceLabel: string): void {
  ctx.state.fail(sourceLabel);
  ctx.damage.kill(
    ctx.select.activePlayers().map((actor) => actor.id),
    sourceLabel,
  );
}

function resolveTowerRound(
  ctx: BattleScriptContext,
  plan: ThreeStarsPlan,
  round: ActiveTowerRound,
): void {
  const actors = ctx.select.allPlayers();

  for (const towerIndex of round.towerIndexes) {
    const tower = plan.towers[towerIndex];

    if (tower === undefined) {
      continue;
    }

    const hits = getActorsInsideCircle(actors, tower.position, TOWER_RADIUS);

    if (hits.length === 0) {
      triggerPartyWipe(ctx, '三星塔无人处理');
      return;
    }

    if (hits.length === 1) {
      ctx.state.fail('三星塔人数不足');
      ctx.damage.kill([hits[0]!.id], '三星塔人数不足');
      continue;
    }

    for (const hit of hits) {
      const freshActor = getFreshActor(ctx, hit.id);

      if (freshActor === null || !freshActor.mechanicActive) {
        continue;
      }

      const label = `三星${ELEMENT_LABELS[tower.element]}塔`;

      if (hasStatus(freshActor, ELEMENT_STATUS_IDS[tower.element])) {
        ctx.damage.kill([freshActor.id], label);
      } else {
        ctx.damage.apply([freshActor.id], MECHANIC_DAMAGE, label);
        applyElementVulnerability(ctx, [freshActor.id], tower.element, 20_000);
      }
    }
  }
}

function spawnDisasterTelegraph(ctx: BattleScriptContext, disaster: DisasterCast): void {
  ctx.boss.cast(`kefka_p5_full_disaster_${disaster.index}`, '二选一的灾祟', DISASTER_CAST_MS);
  ctx.spawn.circleTelegraph({
    label: disaster.mode === 'wind' ? '二选一的灾祟风提示' : '二选一的灾祟土提示',
    center: CENTER,
    radius: 3,
    color: DISASTER_COLORS[disaster.mode],
    resolveAfterMs: DISASTER_CAST_MS,
  });
}

function spawnDisasterRange(ctx: BattleScriptContext, disaster: DisasterCast): void {
  if (disaster.mode === 'wind') {
    ctx.spawn.donutTelegraph({
      label: '风月环',
      center: CENTER,
      innerRadius: 10,
      outerRadius: 40,
      color: DISASTER_COLORS.wind,
      resolveAfterMs: 500,
    });
    return;
  }

  ctx.spawn.circleTelegraph({
    label: '土大圈',
    center: CENTER,
    radius: 10,
    color: DISASTER_COLORS.earth,
    resolveAfterMs: 500,
  });
}

function resolveDisaster(ctx: BattleScriptContext, disaster: DisasterCast): void {
  const hits = ctx.select
    .activePlayers()
    .filter((actor) =>
      disaster.mode === 'wind'
        ? distance(actor.position, CENTER) > 10 && distance(actor.position, CENTER) <= 40
        : distance(actor.position, CENTER) <= 10,
    );

  if (hits.length > 0) {
    ctx.damage.kill(
      hits.map((actor) => actor.id),
      disaster.mode === 'wind' ? '风月环' : '土大圈',
    );
  }
}

function createFirePlan(): FirePlan {
  const left = shuffle(FIRE_GROUP_IDS);
  const right = shuffle(FIRE_GROUP_IDS);
  const orderedGroups = [
    { side: 'left' as const, groupId: left[0]! },
    { side: 'right' as const, groupId: right[0]! },
    { side: 'left' as const, groupId: left[1]! },
    { side: 'right' as const, groupId: right[1]! },
    { side: 'left' as const, groupId: left[2]! },
    { side: 'right' as const, groupId: right[2]! },
  ];
  const batches = orderedGroups.map((group, index) => {
    const castAt = FIRE_CAST_RESOLVE_ATS[index]!;

    return {
      side: group.side,
      numbers: FIRE_GROUPS[group.groupId],
      castAt,
      firstHitAt: castAt + FIRE_FIRST_HIT_DELAY_MS,
      botPoint: CENTER,
    };
  });

  return {
    left,
    right,
    batches: batches.map((batch, index) => ({
      ...batch,
      botPoint: chooseFireBotPoint(batch, batches[index - 1]?.botPoint ?? CENTER),
    })),
  };
}

function getFireDangerCenters(batch: Omit<FireBatch, 'botPoint'>): Vector2[] {
  return batch.numbers.flatMap((number) =>
    Array.from({ length: FIRE_HIT_COUNT }, (_, hitIndex) =>
      getFireHitPosition(batch.side, number, hitIndex),
    ),
  );
}

function getFireSafeCandidatesForCenters(dangerCenters: readonly Vector2[]): Vector2[] {
  const candidates = Array.from({ length: 8 }, (_, index) =>
    pointOnRadius((Math.PI / 4) * index, 13),
  );

  return candidates.filter((candidate) =>
    dangerCenters.every(
      (center) => distance(candidate, center) > FIRE_AOE_RADIUS + FIRE_SAFE_MARGIN,
    ),
  );
}

function chooseFireBotPoint(batch: Omit<FireBatch, 'botPoint'>, previousPoint: Vector2): Vector2 {
  const safeCandidates = getFireSafeCandidatesForCenters(getFireDangerCenters(batch));

  return (
    safeCandidates.sort(
      (left, right) => distance(left, previousPoint) - distance(right, previousPoint),
    )[0] ?? CENTER
  );
}

function getOrCreateFirePlan(ctx: BattleScriptContext): FirePlan {
  const existingPlan = ctx.state.getValue<FirePlan>(FIRE_PLAN_KEY);

  if (existingPlan !== undefined) {
    return existingPlan;
  }

  const plan = createFirePlan();
  ctx.state.setValue(FIRE_PLAN_KEY, plan);
  return plan;
}

function getFireStartPosition(side: FireSide, number: FireNumber): Vector2 {
  const x = FIRE_GRID_STEP * number;
  const y = -FIRE_GRID_STEP * (7 - number);

  return {
    x: side === 'left' ? -x : x,
    y,
  };
}

function getFireHitPosition(side: FireSide, number: FireNumber, hitIndex: number): Vector2 {
  const start = getFireStartPosition(side, number);
  const offset = FIRE_GRID_STEP * hitIndex;

  return {
    x: side === 'left' ? start.x + offset : start.x - offset,
    y: start.y + offset,
  };
}

function spawnFireTelegraph(
  ctx: BattleScriptContext,
  label: string,
  center: Vector2,
  resolveAfterMs: number,
): void {
  ctx.spawn.circleTelegraph({
    label,
    center,
    radius: FIRE_AOE_RADIUS,
    color: FIRE_COLOR,
    resolveAfterMs,
  });
}

function resolveFireHit(
  ctx: BattleScriptContext,
  side: FireSide,
  number: FireNumber,
  hitIndex: number,
): void {
  const center = getFireHitPosition(side, number, hitIndex);
  const hits = getActorsInsideCircle(ctx.select.allPlayers(), center, FIRE_AOE_RADIUS);

  if (hits.length > 0) {
    ctx.damage.kill(
      hits.map((actor) => actor.id),
      '地火',
    );
  }

  spawnFireTelegraph(ctx, '混沌末世', center, 300);
}

function resolveChaosVortex(ctx: BattleScriptContext): void {
  const actors = ctx.select.allPlayers().filter((actor) => actor.mechanicActive);

  for (const actor of actors) {
    ctx.spawn.circleTelegraph({
      label: '混沌涡旋',
      center: actor.position,
      radius: CHAOS_VORTEX_RADIUS,
      color: '#a855f7',
      resolveAfterMs: 300,
    });
  }

  for (const actor of actors) {
    const hits = getActorsInsideCircle(actors, actor.position, CHAOS_VORTEX_RADIUS);

    if (hits.length > 1) {
      ctx.damage.kill([actor.id], '混沌涡旋');
    } else {
      applyMechanicDamage(ctx, actor, '混沌涡旋', CHAOS_VORTEX_INJURY_MS);
    }
  }
}

function scheduleContinuousUltimates(ctx: BattleScriptContext): void {
  for (const castAt of CONTINUOUS_ULTIMATE_CAST_ATS) {
    ctx.timeline.at(castAt, () => {
      ctx.boss.cast('kefka_p5_full_continuous_ultimate', '连续究极', CONTINUOUS_ULTIMATE_CAST_MS);
    });
  }
}

function scheduleMagicStrikes(ctx: BattleScriptContext): void {
  for (const hitAt of MAGIC_STRIKE_HIT_ATS) {
    ctx.timeline.at(hitAt, () => {
      resolveMagicStrike(ctx, hitAt);
    });
  }
}

function scheduleFlood(ctx: BattleScriptContext): void {
  const plan = getOrCreateFloodPlan(ctx);

  ctx.timeline.at(FLOOD_CAST_START_AT, () => {
    ctx.boss.cast('kefka_p5_full_flood', '洪水', FLOOD_CAST_MS);
  });

  for (const round of plan.rounds) {
    ctx.timeline.at(round.previewAt, () => {
      spawnFloodTelegraphs(ctx, round, FLOOD_TELEGRAPH_DISPLAY_MS);
    });
    ctx.timeline.at(round.resolveAt, () => {
      resolveFlood(ctx, round);
      spawnFloodTelegraphs(ctx, round, FLOOD_HIT_DISPLAY_MS);
    });
  }
}

function scheduleMadSymphonies(ctx: BattleScriptContext): void {
  MAD_SYMPHONY_CAST_RESOLVE_ATS.forEach((castResolveAt, index) => {
    const castStartAt = castResolveAt - MAD_SYMPHONY_CAST_MS;
    const firstHitAt = castResolveAt + MAD_FIRST_HIT_OFFSETS[index]!;
    const buffApplyAt = castResolveAt + MAD_BUFF_APPLY_OFFSETS[index]!;
    const secondHitAt = castResolveAt + MAD_SECOND_HIT_OFFSETS[index]!;
    const buffResolveAt = castResolveAt + MAD_BUFF_RESOLVE_OFFSETS[index]!;

    ctx.timeline.at(castStartAt, () => {
      ctx.boss.cast('kefka_p5_full_mad_symphony', '癫狂交响曲', MAD_SYMPHONY_CAST_MS);
    });
    ctx.timeline.at(firstHitAt - MAD_TELEGRAPH_MS, () => {
      spawnMadFirstTelegraphs(ctx, index);
    });
    ctx.timeline.at(firstHitAt, () => {
      resolveMadFirstHit(ctx, index);
    });
    ctx.timeline.at(buffApplyAt, () => {
      applyMadBuffs(ctx, index, buffResolveAt - buffApplyAt);
    });
    ctx.timeline.at(secondHitAt - MAD_TELEGRAPH_MS, () => {
      spawnMadSecondTelegraphs(ctx, index);
    });
    ctx.timeline.at(secondHitAt, () => {
      resolveMadSecondHit(ctx, index);
    });
    ctx.timeline.at(buffResolveAt, () => {
      resolveMadBuffs(ctx, index);
    });
  });
}

function scheduleThreeStars(ctx: BattleScriptContext): void {
  const plan = getOrCreateThreeStarsPlan(ctx);

  ctx.timeline.at(THREE_STARS_CAST_RESOLVE_AT - THREE_STARS_CAST_MS, () => {
    ctx.boss.cast('kefka_p5_full_three_stars', '三星', THREE_STARS_CAST_MS);
  });
  ctx.timeline.at(THREE_STARS_CAST_RESOLVE_AT, () => {
    applyInitialElementVulnerabilities(ctx, plan);
    spawnBaseTowers(ctx, plan);
  });

  for (const round of plan.rounds) {
    ctx.timeline.at(round.lightAt, () => {
      spawnActiveTowers(ctx, plan, round);
    });
    ctx.timeline.at(round.resolveAt, () => {
      resolveTowerRound(ctx, plan, round);
    });
  }

  for (const disaster of plan.disasters) {
    ctx.timeline.at(disaster.castStartAt, () => {
      spawnDisasterTelegraph(ctx, disaster);
    });
    ctx.timeline.at(disaster.rangeResolveAt - 500, () => {
      spawnDisasterRange(ctx, disaster);
    });
    ctx.timeline.at(disaster.rangeResolveAt, () => {
      resolveDisaster(ctx, disaster);
    });
  }
}

function scheduleGroundFire(ctx: BattleScriptContext): void {
  const plan = getOrCreateFirePlan(ctx);

  for (const batch of plan.batches) {
    ctx.timeline.at(batch.castAt - FIRE_CAST_MS, () => {
      ctx.boss.cast('kefka_p5_full_chaos_doomsday', '混沌末世', FIRE_CAST_MS);
    });

    for (const number of batch.numbers) {
      ctx.timeline.at(batch.castAt, () => {
        spawnFireTelegraph(
          ctx,
          '混沌末世预兆',
          getFireStartPosition(batch.side, number),
          FIRE_FIRST_HIT_DELAY_MS,
        );
      });

      for (let hitIndex = 0; hitIndex < FIRE_HIT_COUNT; hitIndex += 1) {
        ctx.timeline.at(batch.firstHitAt + FIRE_HIT_INTERVAL_MS * hitIndex, () => {
          resolveFireHit(ctx, batch.side, number, hitIndex);
        });
      }
    }
  }
}

function scheduleChaosVortex(ctx: BattleScriptContext): void {
  ctx.timeline.at(CHAOS_VORTEX_CAST_START_AT, () => {
    ctx.boss.cast('kefka_p5_full_chaos_vortex', '混沌涡旋', CHAOS_VORTEX_CAST_MS);
  });
  ctx.timeline.at(CHAOS_VORTEX_HIT_AT, () => {
    resolveChaosVortex(ctx);
  });
}

function buildKefkaP5FullScript(ctx: BattleScriptContext): void {
  scheduleContinuousUltimates(ctx);
  scheduleMagicStrikes(ctx);
  scheduleFlood(ctx);
  scheduleMadSymphonies(ctx);
  scheduleThreeStars(ctx);
  scheduleGroundFire(ctx);
  scheduleChaosVortex(ctx);

  ctx.timeline.at(COMPLETE_AT, () => {
    ctx.state.complete();
  });
}

function getMagicStrikeBotTarget(slot: PartySlot): Vector2 {
  if (isTankSlot(slot)) {
    return offsetPointForSlot(BOT_MAGIC_TANK_POINT, slot);
  }

  if (isDpsSlot(slot)) {
    return offsetPointForSlot(BOT_MAGIC_DPS_POINT, slot);
  }

  return offsetPointForSlot(BOT_MAGIC_HEALER_POINT, slot);
}

function getMadBotTarget(
  slot: PartySlot,
  actor: BaseActorSnapshot,
  timeMs: number,
  scriptState: Record<string, unknown>,
  index: number,
): Vector2 {
  const castResolveAt = MAD_SYMPHONY_CAST_RESOLVE_ATS[index]!;
  const firstHitAt = castResolveAt + MAD_FIRST_HIT_OFFSETS[index]!;
  const secondHitAt = castResolveAt + MAD_SECOND_HIT_OFFSETS[index]!;
  const buffResolveAt = castResolveAt + MAD_BUFF_RESOLVE_OFFSETS[index]!;
  const assignments = scriptState[madAssignmentsKey(index)] as MadSymphonyAssignments | undefined;

  if (assignments === undefined || timeMs < firstHitAt) {
    return INITIAL_POSITIONS[slot];
  }

  if (timeMs < secondHitAt) {
    if (slot === 'ST') {
      return offsetPointForSlot(INITIAL_POSITIONS.MT, slot);
    }

    if (assignments.firstDhTargetIds.includes(actor.id)) {
      return pointOnRadius(
        createFacingTowards(CENTER, INITIAL_POSITIONS[slot]),
        BOSS_TARGET_RING_RADIUS + 3,
      );
    }

    if (!isTankSlot(slot)) {
      return pointOnRadius(
        createFacingTowards(CENTER, INITIAL_POSITIONS[slot]),
        BOSS_TARGET_RING_RADIUS - 1,
      );
    }

    return INITIAL_POSITIONS[slot];
  }

  if (timeMs < buffResolveAt) {
    if (actor.id === assignments.nuclearTargetId) {
      return offsetPointForSlot(BOT_NUCLEAR_POINT, slot, 0.25);
    }

    if (actor.id === assignments.holyTargetId || assignments.firstDhTargetIds.includes(actor.id)) {
      return offsetPointForSlot(BOT_HOLY_SHARE_POINT, slot);
    }

    return offsetPointForSlot(
      INITIAL_POSITIONS[slot].x < 0 ? BOT_NON_SHARE_LEFT_POINT : BOT_NON_SHARE_RIGHT_POINT,
      slot,
    );
  }

  return getMagicStrikeBotTarget(slot);
}

function getActiveTowerRound(plan: ThreeStarsPlan, timeMs: number): ActiveTowerRound | null {
  return plan.rounds.find((round) => timeMs >= round.lightAt && timeMs < round.resolveAt) ?? null;
}

function getBotTowerRound(plan: ThreeStarsPlan, timeMs: number): ActiveTowerRound | null {
  return (
    getActiveTowerRound(plan, timeMs) ??
    plan.rounds.find(
      (round) => timeMs >= THREE_STARS_CAST_RESOLVE_AT && timeMs < round.resolveAt,
    ) ??
    null
  );
}

function getCurrentDisaster(plan: ThreeStarsPlan, timeMs: number): DisasterCast | null {
  return (
    plan.disasters.find(
      (disaster) => timeMs >= disaster.castStartAt && timeMs < disaster.rangeResolveAt,
    ) ?? null
  );
}

function getRoundDisaster(
  plan: ThreeStarsPlan,
  round: ActiveTowerRound,
  timeMs: number,
): DisasterCast | null {
  return (
    getCurrentDisaster(plan, timeMs) ??
    plan.disasters.find(
      (disaster) =>
        timeMs >= round.lightAt &&
        timeMs < disaster.rangeResolveAt &&
        disaster.rangeResolveAt <= round.resolveAt,
    ) ??
    null
  );
}

function getAssignmentElement(plan: ThreeStarsPlan, actorId: string): Element | null {
  return plan.assignments.find((assignment) => assignment.actorId === actorId)?.element ?? null;
}

function sortTowersClockwise(towers: readonly ThreeStarsTower[]): ThreeStarsTower[] {
  return [...towers].sort((left, right) => {
    const leftKey = left.index === 8 ? -1 : left.index;
    const rightKey = right.index === 8 ? -1 : right.index;

    return leftKey - rightKey;
  });
}

function getPlanTower(plan: ThreeStarsPlan, index: number): ThreeStarsTower {
  const tower = plan.towers[index];

  if (tower === undefined) {
    throw new Error(`三星塔计划缺少 ${index} 号塔`);
  }

  return tower;
}

function getPlanElementOrder(plan: ThreeStarsPlan): Element[] {
  return [
    getPlanTower(plan, TOWER_GROUP_INDEXES.bottom[0]!),
    getPlanTower(plan, TOWER_GROUP_INDEXES.leftUpper[0]!),
    getPlanTower(plan, TOWER_GROUP_INDEXES.rightUpper[0]!),
  ].map((tower) => tower.element);
}

function getNextElement(plan: ThreeStarsPlan, element: Element, offset: number): Element {
  const order = getPlanElementOrder(plan);
  const index = order.indexOf(element);

  if (index < 0) {
    throw new Error(`三星塔颜色顺序缺少 ${element}`);
  }

  return order[(index + offset) % order.length]!;
}

function getRoundTargetElement(
  plan: ThreeStarsPlan,
  actorId: string,
  roundIndex: number,
): Element | null {
  const initialElement = getAssignmentElement(plan, actorId);

  return initialElement === null ? null : getNextElement(plan, initialElement, roundIndex + 1);
}

function getTowerForBot(
  plan: ThreeStarsPlan,
  actorId: string,
  round: ActiveTowerRound,
): ThreeStarsTower | null {
  const activeTowers = round.towerIndexes
    .map((towerIndex) => plan.towers[towerIndex])
    .filter((tower): tower is ThreeStarsTower => tower !== undefined);

  if (plan.idleActorIds.includes(actorId)) {
    const repeatTowers = sortTowersClockwise(
      activeTowers.filter((tower) => tower.element === round.repeatElement),
    );

    return repeatTowers[1] ?? repeatTowers[0] ?? null;
  }

  const targetElement = getRoundTargetElement(plan, actorId, round.index);

  if (targetElement === null) {
    return null;
  }

  return (
    sortTowersClockwise(activeTowers.filter((tower) => tower.element === targetElement))[0] ?? null
  );
}

function normalizeVector(vector: Vector2): Vector2 {
  const length = Math.hypot(vector.x, vector.y);

  if (length <= 0.0001) {
    return { x: 0, y: 1 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function setVectorRadius(vector: Vector2, radius: number): Vector2 {
  const direction = normalizeVector(vector);

  return {
    x: direction.x * radius,
    y: direction.y * radius,
  };
}

function getThreeStarsBotTarget(
  actor: BaseActorSnapshot,
  timeMs: number,
  plan: ThreeStarsPlan,
): Vector2 {
  if (actor.slot === null) {
    return CENTER;
  }

  const activeRound = getBotTowerRound(plan, timeMs);

  if (activeRound === null) {
    return INITIAL_POSITIONS[actor.slot];
  }

  const tower = getTowerForBot(plan, actor.id, activeRound);

  if (tower === null) {
    return INITIAL_POSITIONS[actor.slot];
  }

  const disaster = getRoundDisaster(plan, activeRound, timeMs);
  const radius = disaster === null ? TOWER_DISTANCE : disaster.mode === 'wind' ? 8.5 : 12.5;

  return offsetPointForSlot(setVectorRadius(tower.position, radius), actor.slot, 0.35);
}

function getFloodBotTarget(slot: PartySlot, timeMs: number, plan: FloodPlan): Vector2 {
  const roundIndex = plan.rounds.findIndex(
    (round) => timeMs < round.resolveAt + 300 && timeMs >= round.previewAt - 300,
  );

  if (roundIndex >= 0) {
    return offsetPointForSlot(plan.botRoute[roundIndex] ?? CENTER, slot, 0.25);
  }

  return offsetPointForSlot(plan.botRoute[0] ?? CENTER, slot, 0.25);
}

function getUpcomingFireDangerCenters(plan: FirePlan, timeMs: number): Vector2[] {
  return plan.batches.flatMap((batch) =>
    batch.numbers.flatMap((number) =>
      Array.from({ length: FIRE_HIT_COUNT }, (_, hitIndex) => ({
        hitAt: batch.firstHitAt + FIRE_HIT_INTERVAL_MS * hitIndex,
        center: getFireHitPosition(batch.side, number, hitIndex),
      }))
        .filter(({ hitAt }) => hitAt >= timeMs - 50 && hitAt <= timeMs + FIRE_BOT_LOOKAHEAD_MS)
        .map(({ center }) => center),
    ),
  );
}

function getFireBotTarget(actor: BaseActorSnapshot, timeMs: number, plan: FirePlan): Vector2 {
  const batch =
    [...plan.batches]
      .reverse()
      .find(
        (candidate) =>
          timeMs >= candidate.castAt - 700 &&
          timeMs < candidate.firstHitAt + FIRE_HIT_INTERVAL_MS * FIRE_HIT_COUNT,
      ) ?? plan.batches.at(-1);

  if (batch === undefined) {
    return CENTER;
  }

  const upcomingSafePoint =
    getFireSafeCandidatesForCenters(getUpcomingFireDangerCenters(plan, timeMs)).sort(
      (left, right) => distance(left, batch.botPoint) - distance(right, batch.botPoint),
    )[0] ?? batch.botPoint;

  return actor.slot === null
    ? upcomingSafePoint
    : offsetPointForSlot(upcomingSafePoint, actor.slot, 0.2);
}

function getChaosVortexBotTarget(slot: PartySlot): Vector2 {
  const index = PARTY_SLOT_ORDER.indexOf(slot);

  return pointOnRadius(
    NORTH_ANGLE + (Math.PI * 2 * index) / PARTY_SLOT_ORDER.length,
    BOT_CHAOS_VORTEX_RADIUS,
  );
}

function getKefkaP5FullBotTarget(
  slot: PartySlot,
  actor: BaseActorSnapshot,
  timeMs: number,
  scriptState: Record<string, unknown>,
): Vector2 {
  if (timeMs < FLOOD_PREVIEW_ATS[0] - 800) {
    if (
      timeMs >= CONTINUOUS_ULTIMATE_RESOLVE_ATS[0] ||
      MAGIC_STRIKE_HIT_ATS.some((hitAt) => timeMs >= hitAt - 1_600 && timeMs < hitAt + 600)
    ) {
      return getMagicStrikeBotTarget(slot);
    }

    return INITIAL_POSITIONS[slot];
  }

  if (timeMs < FLOOD_RESOLVE_ATS.at(-1)! + 800) {
    const plan = scriptState[FLOOD_PLAN_KEY] as FloodPlan | undefined;
    return plan === undefined ? CENTER : getFloodBotTarget(slot, timeMs, plan);
  }

  if (timeMs < MAGIC_STRIKE_HIT_ATS[3]! - 1_600) {
    return getMadBotTarget(slot, actor, timeMs, scriptState, 0);
  }

  if (timeMs < THREE_STARS_CAST_RESOLVE_AT - 800) {
    if (timeMs >= MAGIC_STRIKE_HIT_ATS[3]! - 3_500) {
      return getMagicStrikeBotTarget(slot);
    }

    return getMagicStrikeBotTarget(slot);
  }

  if (timeMs < CONTINUOUS_ULTIMATE_CAST_ATS[1] - 800) {
    const plan = scriptState[THREE_STARS_PLAN_KEY] as ThreeStarsPlan | undefined;
    return plan === undefined
      ? INITIAL_POSITIONS[slot]
      : getThreeStarsBotTarget(actor, timeMs, plan);
  }

  if (timeMs < MAGIC_STRIKE_HIT_ATS[6]! + 1_000) {
    if (timeMs >= CONTINUOUS_ULTIMATE_RESOLVE_ATS[1]) {
      return getMagicStrikeBotTarget(slot);
    }

    return INITIAL_POSITIONS[slot];
  }

  if (timeMs < CHAOS_VORTEX_CAST_START_AT) {
    const plan = scriptState[FIRE_PLAN_KEY] as FirePlan | undefined;
    return plan === undefined ? CENTER : getFireBotTarget(actor, timeMs, plan);
  }

  if (timeMs < CHAOS_VORTEX_HIT_AT + 800) {
    return getChaosVortexBotTarget(slot);
  }

  if (timeMs < MAGIC_STRIKE_HIT_ATS[7]! - 1_600) {
    return getMadBotTarget(slot, actor, timeMs, scriptState, 1);
  }

  return getMagicStrikeBotTarget(slot);
}

export const KEFKA_P5_FULL_BATTLE: BattleDefinition = {
  id: 'kefka_p5_full',
  name: '凯夫卡P5：整合',
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
  buildScript: buildKefkaP5FullScript,
  failureTexts: {
    outOfBounds: (actorName) => `${actorName} 越过场地边界`,
    mechanicDeath: (actorName, sourceLabel) => `${actorName} 因 ${sourceLabel} 死亡`,
  },
};

export const KEFKA_P5_FULL_BOT_CONTROLLER: BattleBotController = ({ snapshot, slot, actor }) => {
  const target = getKefkaP5FullBotTarget(slot, actor, snapshot.timeMs, snapshot.scriptState);
  const faceAngle = createFacingTowards(actor.position, snapshot.boss.position);

  return {
    pose: createPoseTowards(actor, target, faceAngle),
  };
};

export const KEFKA_P5_FULL_TESTING = {
  CONTINUOUS_ULTIMATE_CAST_ATS,
  CONTINUOUS_ULTIMATE_RESOLVE_ATS,
  MAGIC_STRIKE_HIT_ATS,
  FLOOD_PREVIEW_ATS,
  FLOOD_RESOLVE_ATS,
  MAD_SYMPHONY_CAST_RESOLVE_ATS,
  MAD_FIRST_HIT_ATS,
  MAD_SECOND_HIT_ATS,
  MAD_TELEGRAPH_MS,
  THREE_STARS_CAST_RESOLVE_AT,
  INITIAL_ELEMENT_VULNERABILITY_EXPIRES_AT,
  TOWER_RESOLVE_ATS,
  BASE_TOWER_DESPAWN_AT,
  DISASTER_CAST_RESOLVE_ATS,
  DISASTER_RANGE_RESOLVE_ATS,
  FIRE_CAST_RESOLVE_ATS,
  CHAOS_VORTEX_CAST_START_AT,
  CHAOS_VORTEX_CAST_RESOLVE_AT,
  CHAOS_VORTEX_HIT_AT,
  CHAOS_VORTEX_RADIUS,
  COMPLETE_AT,
  FLOOD_PLAN_KEY,
  THREE_STARS_PLAN_KEY,
  FIRE_PLAN_KEY,
  KEFKA_MAP_MARKERS,
  getFloodRoundRects,
  getFireHitPosition,
  getKefkaP5FullBotTarget,
};
