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
  KEFKA_P5_INITIAL_RADIUS as BOT_INITIAL_RADIUS,
  KEFKA_P5_INITIAL_SLOT_ORDER as BOT_INITIAL_SLOT_ORDER,
  KEFKA_P5_MAP_MARKERS as KEFKA_MAP_MARKERS,
  KEFKA_P5_NORTH_ANGLE as NORTH_ANGLE,
  pointOnRadius,
} from './kefka-p5-common';

interface P5Assignments {
  firstTankTargetIds: string[];
  firstDhTargetIds: string[];
  secondDhTargetIds?: string[];
  nuclearTargetId: string;
  holyTargetId: string;
}

interface FollowupTargets {
  tankTargetId: string;
  healerTargetId: string;
  dpsTargetId: string;
}

const CAST_MS = 5_000;
const SPREAD_TELEGRAPH_MS = 500;
const FIRST_HIT_AT = 5_700;
const FIRST_TELEGRAPH_AT = FIRST_HIT_AT - SPREAD_TELEGRAPH_MS;
const SECOND_HIT_AT = 8_700;
const SECOND_TELEGRAPH_AT = SECOND_HIT_AT - SPREAD_TELEGRAPH_MS;
const BUFF_RESOLVE_AT = 11_700;
const FIRST_FOLLOWUP_HIT_AT = BUFF_RESOLVE_AT + 3_000;
const FIRST_FOLLOWUP_TELEGRAPH_AT = FIRST_FOLLOWUP_HIT_AT;
const SECOND_FOLLOWUP_HIT_AT = FIRST_FOLLOWUP_HIT_AT + 2_000;
const SECOND_FOLLOWUP_TELEGRAPH_AT = SECOND_FOLLOWUP_HIT_AT;
const COMPLETE_AT = SECOND_FOLLOWUP_HIT_AT + 1_000;
const TELEGRAPH_MS = SPREAD_TELEGRAPH_MS;
const INSTANT_TELEGRAPH_MS = 300;
const TANK_SPREAD_RADIUS = 5;
const DH_SPREAD_RADIUS = 5;
const HOLY_SHARE_RADIUS = 5;
const NUCLEAR_RADIUS = 25;
const FOLLOWUP_SHARE_RADIUS = 5;
const HOLY_REQUIRED_PLAYERS = 4;
const FOLLOWUP_TANK_REQUIRED_PLAYERS = 2;
const FOLLOWUP_HEALER_REQUIRED_PLAYERS = 2;
const FOLLOWUP_DPS_REQUIRED_PLAYERS = 4;
const MECHANIC_DAMAGE = 1;
const TANK_INJURY_MS = 1_000;
const DH_INJURY_MS = 4_000;
const BUFF_INJURY_MS = 3_000;
const FOLLOWUP_INJURY_MS = 1_000;
const NUCLEAR_STATUS_ID = 'kefka_p5_extra_nuclear_blast';
const HOLY_STATUS_ID = 'kefka_p5_extra_holy';
const ASSIGNMENTS_KEY = 'kefkaP5:assignments';
const FOLLOWUP_TARGETS_KEY_PREFIX = 'kefkaP5:followupTargets';
const BOT_NUCLEAR_RADIUS = ARENA_RADIUS - 1;
const BOT_SAFE_SEARCH_STEP = 0.5;
const BOT_SAFE_SEARCH_ANGLE_COUNT = 144;
const BOT_SAFE_MARGIN = 0.05;

const TANK_SLOTS = ['MT', 'ST'] as const satisfies readonly PartySlot[];
const HEALER_SLOTS = ['H1', 'H2'] as const satisfies readonly PartySlot[];
const DPS_SLOTS = ['D1', 'D2', 'D3', 'D4'] as const satisfies readonly PartySlot[];
const BOT_NUCLEAR_POINT = pointOnRadius(NORTH_ANGLE, BOT_NUCLEAR_RADIUS);
const BOT_HOLY_SHARE_POINT = pointOnRadius(NORTH_ANGLE + Math.PI, BOSS_TARGET_RING_RADIUS);
const BOT_FOLLOWUP_DPS_SHARE_POINT = pointOnRadius(Math.PI / 4, BOSS_TARGET_RING_RADIUS);
const BOT_FOLLOWUP_HEALER_SHARE_POINT = pointOnRadius((Math.PI * 3) / 4, BOSS_TARGET_RING_RADIUS);
const BOT_FOLLOWUP_TANK_SHARE_POINT = pointOnRadius(NORTH_ANGLE, BOSS_TARGET_RING_RADIUS);

function shuffle<T>(values: readonly T[]): T[] {
  const shuffled = [...values];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }

  return shuffled;
}

function getActorById(actors: BaseActorSnapshot[], actorId: string): BaseActorSnapshot | null {
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
  actors: BaseActorSnapshot[],
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

function sortByDistanceThenSlot(actors: BaseActorSnapshot[], center: Vector2): BaseActorSnapshot[] {
  return [...actors].sort((left, right) => {
    const distanceDiff = distance(left.position, center) - distance(right.position, center);

    if (Math.abs(distanceDiff) > 0.0001) {
      return distanceDiff;
    }

    return (left.slot ?? '').localeCompare(right.slot ?? '');
  });
}

function selectNearestNonTankTargets(
  actors: BaseActorSnapshot[],
  count: number,
): BaseActorSnapshot[] {
  return sortByDistanceThenSlot(
    actors.filter((actor) => actor.mechanicActive && !isTankSlot(actor.slot)),
    CENTER,
  ).slice(0, count);
}

function applyP5Damage(
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

function applyTankBusterHit(
  ctx: BattleScriptContext,
  target: BaseActorSnapshot,
  actors: BaseActorSnapshot[],
): void {
  const hits = getActorsInsideCircle(actors, target.position, TANK_SPREAD_RADIUS);

  for (const hit of hits) {
    if (TANK_SLOTS.includes(hit.slot as (typeof TANK_SLOTS)[number])) {
      applyP5Damage(ctx, hit, '癫狂交响曲死刑', TANK_INJURY_MS);
    } else {
      ctx.damage.kill([hit.id], '癫狂交响曲死刑');
    }
  }
}

function applyDhHit(
  ctx: BattleScriptContext,
  target: BaseActorSnapshot,
  actors: BaseActorSnapshot[],
): void {
  for (const hit of getActorsInsideCircle(actors, target.position, DH_SPREAD_RADIUS)) {
    applyP5Damage(ctx, hit, '癫狂交响曲分散', DH_INJURY_MS);
  }
}

function applySecondTankStackHit(
  ctx: BattleScriptContext,
  target: BaseActorSnapshot,
  actors: BaseActorSnapshot[],
): void {
  const hits = getActorsInsideCircle(actors, target.position, TANK_SPREAD_RADIUS);
  const tankHits = hits.filter((hit) => isTankSlot(hit.slot));

  for (const hit of hits) {
    if (!isTankSlot(hit.slot)) {
      ctx.damage.kill([hit.id], '癫狂交响曲双T分摊');
    }
  }

  if (tankHits.length < TANK_SLOTS.length) {
    ctx.state.fail('癫狂交响曲双T分摊人数不足');
    for (const hit of tankHits) {
      ctx.damage.kill([hit.id], '癫狂交响曲双T分摊');
    }
    return;
  }

  for (const hit of tankHits) {
    applyP5Damage(ctx, hit, '癫狂交响曲双T分摊', TANK_INJURY_MS);
  }
}

function spawnSpreadTelegraphs(
  ctx: BattleScriptContext,
  targets: readonly BaseActorSnapshot[],
  label: string,
  radius: number,
  color: string,
  telegraphMs = TELEGRAPH_MS,
): void {
  for (const target of targets) {
    ctx.spawn.circleTelegraph({
      label,
      center: target.position,
      radius,
      color,
      resolveAfterMs: telegraphMs,
    });
  }
}

function createAssignments(ctx: BattleScriptContext): P5Assignments {
  const tankTargets = TANK_SLOTS.map((slot) => getActorBySlot(ctx, slot));
  const firstDhTargets = shuffle(DPS_SLOTS.map((slot) => getActorBySlot(ctx, slot))).slice(0, 3);
  const [nuclearTarget, holyTarget] = shuffle(tankTargets);

  if (nuclearTarget === undefined || holyTarget === undefined) {
    throw new Error('missing first targets for Kefka P5 assignments');
  }

  return {
    firstTankTargetIds: tankTargets.map((actor) => actor.id),
    firstDhTargetIds: firstDhTargets.map((actor) => actor.id),
    nuclearTargetId: nuclearTarget.id,
    holyTargetId: holyTarget.id,
  };
}

function getAssignments(ctx: BattleScriptContext): P5Assignments | undefined {
  return ctx.state.getValue<P5Assignments>(ASSIGNMENTS_KEY);
}

function getOrCreateAssignments(ctx: BattleScriptContext): P5Assignments {
  const assignments = getAssignments(ctx) ?? createAssignments(ctx);

  ctx.state.setValue(ASSIGNMENTS_KEY, assignments);

  return assignments;
}

function getOrCreateSecondDhTargetIds(
  ctx: BattleScriptContext,
  assignments: P5Assignments,
): string[] {
  if (assignments.secondDhTargetIds !== undefined) {
    return assignments.secondDhTargetIds;
  }

  const nextAssignments = {
    ...assignments,
    secondDhTargetIds: selectNearestNonTankTargets(ctx.select.allPlayers(), 3).map(
      (actor) => actor.id,
    ),
  };

  ctx.state.setValue(ASSIGNMENTS_KEY, nextAssignments);

  return nextAssignments.secondDhTargetIds;
}

function resolveFirstHit(ctx: BattleScriptContext): void {
  const assignments = getOrCreateAssignments(ctx);
  const actors = ctx.select.allPlayers();
  const tankTargets = assignments.firstTankTargetIds
    .map((actorId) => getActorById(actors, actorId))
    .filter((actor): actor is BaseActorSnapshot => actor !== null);
  const dhTargets = assignments.firstDhTargetIds
    .map((actorId) => getActorById(actors, actorId))
    .filter((actor): actor is BaseActorSnapshot => actor !== null);

  for (const target of tankTargets) {
    applyTankBusterHit(ctx, target, actors);
  }

  for (const target of dhTargets) {
    applyDhHit(ctx, target, actors);
  }

  ctx.status.apply(
    [assignments.nuclearTargetId],
    NUCLEAR_STATUS_ID,
    BUFF_RESOLVE_AT - FIRST_HIT_AT,
    {
      name: getStatusDisplayName(NUCLEAR_STATUS_ID),
    },
  );
  ctx.status.apply([assignments.holyTargetId], HOLY_STATUS_ID, BUFF_RESOLVE_AT - FIRST_HIT_AT, {
    name: getStatusDisplayName(HOLY_STATUS_ID),
  });
}

function spawnFirstTelegraphs(ctx: BattleScriptContext): void {
  const assignments = getOrCreateAssignments(ctx);
  const actors = ctx.select.allPlayers();
  const tankTargets = assignments.firstTankTargetIds
    .map((actorId) => getActorById(actors, actorId))
    .filter((actor): actor is BaseActorSnapshot => actor !== null);
  const dhTargets = assignments.firstDhTargetIds
    .map((actorId) => getActorById(actors, actorId))
    .filter((actor): actor is BaseActorSnapshot => actor !== null);

  spawnSpreadTelegraphs(ctx, tankTargets, '癫狂交响曲死刑预兆', TANK_SPREAD_RADIUS, '#ef4444');
  spawnSpreadTelegraphs(ctx, dhTargets, '癫狂交响曲分散预兆', DH_SPREAD_RADIUS, '#38bdf8');
}

function spawnSecondTelegraphs(ctx: BattleScriptContext): void {
  const assignments = getAssignments(ctx);

  if (assignments === undefined) {
    return;
  }

  const actors = ctx.select.allPlayers();
  const tankTargets = [getActorBySlot(ctx, 'MT')].filter(
    (actor): actor is BaseActorSnapshot => actor !== null,
  );
  const secondDhTargets = getOrCreateSecondDhTargetIds(ctx, assignments)
    .map((actorId) => getActorById(actors, actorId))
    .filter((actor): actor is BaseActorSnapshot => actor !== null);

  spawnSpreadTelegraphs(ctx, tankTargets, '癫狂交响曲双T分摊预兆', TANK_SPREAD_RADIUS, '#ef4444');
  spawnSpreadTelegraphs(ctx, secondDhTargets, '癫狂交响曲分散预兆', DH_SPREAD_RADIUS, '#38bdf8');
}

function resolveSecondHit(ctx: BattleScriptContext): void {
  const assignments = getAssignments(ctx);

  if (assignments === undefined) {
    return;
  }

  const actors = ctx.select.allPlayers();
  const tankTargets = [getActorBySlot(ctx, 'MT')].filter(
    (actor): actor is BaseActorSnapshot => actor !== null,
  );
  const secondDhTargets = getOrCreateSecondDhTargetIds(ctx, assignments)
    .map((actorId) => getActorById(actors, actorId))
    .filter((actor): actor is BaseActorSnapshot => actor !== null);

  for (const target of tankTargets) {
    applySecondTankStackHit(ctx, target, actors);
  }

  for (const target of secondDhTargets) {
    applyDhHit(ctx, target, actors);
  }
}

function resolveHoly(
  ctx: BattleScriptContext,
  target: BaseActorSnapshot,
  actors: BaseActorSnapshot[],
): void {
  const hits = getActorsInsideCircle(actors, target.position, HOLY_SHARE_RADIUS);

  ctx.spawn.actorMarker({
    label: '顺手加个神圣',
    target,
    markerShape: 'stackCircle',
    radius: HOLY_SHARE_RADIUS,
    color: '#facc15',
    resolveAfterMs: TELEGRAPH_MS,
  });

  if (hits.length < HOLY_REQUIRED_PLAYERS) {
    ctx.state.fail('顺手加个神圣分摊人数不足');
    for (const hit of hits) {
      ctx.damage.kill([hit.id], '顺手加个神圣');
    }
    return;
  }

  for (const hit of hits) {
    applyP5Damage(ctx, hit, '顺手加个神圣', BUFF_INJURY_MS);
  }
}

function resolveNuclearBlast(
  ctx: BattleScriptContext,
  target: BaseActorSnapshot,
  actors: BaseActorSnapshot[],
): void {
  ctx.spawn.circleTelegraph({
    label: '顺手加个核爆',
    center: target.position,
    radius: NUCLEAR_RADIUS,
    color: '#f97316',
    resolveAfterMs: TELEGRAPH_MS,
  });

  for (const hit of getActorsInsideCircle(actors, target.position, NUCLEAR_RADIUS)) {
    applyP5Damage(ctx, hit, '顺手加个核爆', BUFF_INJURY_MS);
  }
}

function resolveBuffs(ctx: BattleScriptContext): void {
  const assignments = getAssignments(ctx);

  if (assignments === undefined) {
    return;
  }

  const actors = ctx.select.allPlayers();
  const holyTarget = getActorById(actors, assignments.holyTargetId);
  const nuclearTarget = getActorById(actors, assignments.nuclearTargetId);

  if (holyTarget !== null && holyTarget.mechanicActive) {
    resolveHoly(ctx, holyTarget, actors);
  }

  if (nuclearTarget !== null && nuclearTarget.mechanicActive) {
    resolveNuclearBlast(ctx, nuclearTarget, actors);
  }
}

function followupTargetsKey(roundIndex: number): string {
  return `${FOLLOWUP_TARGETS_KEY_PREFIX}:${roundIndex}`;
}

function createFollowupTargets(ctx: BattleScriptContext): FollowupTargets {
  const tankTarget = shuffle(TANK_SLOTS.map((slot) => getActorBySlot(ctx, slot)))[0]!;
  const healerTarget = shuffle(HEALER_SLOTS.map((slot) => getActorBySlot(ctx, slot)))[0]!;
  const dpsTarget = shuffle(DPS_SLOTS.map((slot) => getActorBySlot(ctx, slot)))[0]!;

  return {
    tankTargetId: tankTarget.id,
    healerTargetId: healerTarget.id,
    dpsTargetId: dpsTarget.id,
  };
}

function getFollowupTargets(
  ctx: BattleScriptContext,
  roundIndex: number,
): FollowupTargets | undefined {
  return ctx.state.getValue<FollowupTargets>(followupTargetsKey(roundIndex));
}

function spawnFollowupTelegraphs(ctx: BattleScriptContext, roundIndex: number): void {
  const actors = ctx.select.allPlayers();
  const targets = createFollowupTargets(ctx);
  const tankTarget = getActorById(actors, targets.tankTargetId);
  const healerTarget = getActorById(actors, targets.healerTargetId);
  const dpsTarget = getActorById(actors, targets.dpsTargetId);

  ctx.state.setValue(followupTargetsKey(roundIndex), targets);

  if (tankTarget !== null) {
    ctx.spawn.actorMarker({
      label: `癫狂交响曲后续T分摊${roundIndex}`,
      target: tankTarget,
      markerShape: 'stackCircle',
      radius: FOLLOWUP_SHARE_RADIUS,
      color: '#ef4444',
      resolveAfterMs: INSTANT_TELEGRAPH_MS,
    });
  }

  if (healerTarget !== null) {
    ctx.spawn.actorMarker({
      label: `癫狂交响曲后续H分摊${roundIndex}`,
      target: healerTarget,
      markerShape: 'stackCircle',
      radius: FOLLOWUP_SHARE_RADIUS,
      color: '#facc15',
      resolveAfterMs: INSTANT_TELEGRAPH_MS,
    });
  }

  if (dpsTarget !== null) {
    ctx.spawn.actorMarker({
      label: `癫狂交响曲后续D分摊${roundIndex}`,
      target: dpsTarget,
      markerShape: 'stackCircle',
      radius: FOLLOWUP_SHARE_RADIUS,
      color: '#38bdf8',
      resolveAfterMs: INSTANT_TELEGRAPH_MS,
    });
  }
}

function resolveFollowupShare(
  ctx: BattleScriptContext,
  label: string,
  requiredPlayers: number,
  target: BaseActorSnapshot,
  actors: BaseActorSnapshot[],
): void {
  const hits = getActorsInsideCircle(actors, target.position, FOLLOWUP_SHARE_RADIUS);

  if (hits.length < requiredPlayers) {
    ctx.state.fail(`${label}人数不足`);
    for (const hit of hits) {
      ctx.damage.kill([hit.id], label);
    }
    return;
  }

  for (const hit of hits) {
    applyP5Damage(ctx, hit, label, FOLLOWUP_INJURY_MS);
  }
}

function resolveFollowup(ctx: BattleScriptContext, roundIndex: number): void {
  const targets = getFollowupTargets(ctx, roundIndex) ?? createFollowupTargets(ctx);
  const actors = ctx.select.allPlayers();
  const tankTarget = getActorById(actors, targets.tankTargetId);
  const healerTarget = getActorById(actors, targets.healerTargetId);
  const dpsTarget = getActorById(actors, targets.dpsTargetId);

  ctx.state.setValue(followupTargetsKey(roundIndex), targets);

  if (tankTarget !== null) {
    resolveFollowupShare(
      ctx,
      '癫狂交响曲后续T分摊',
      FOLLOWUP_TANK_REQUIRED_PLAYERS,
      tankTarget,
      actors,
    );
  }

  if (healerTarget !== null) {
    resolveFollowupShare(
      ctx,
      '癫狂交响曲后续H分摊',
      FOLLOWUP_HEALER_REQUIRED_PLAYERS,
      healerTarget,
      actors,
    );
  }

  if (dpsTarget !== null) {
    resolveFollowupShare(
      ctx,
      '癫狂交响曲后续D分摊',
      FOLLOWUP_DPS_REQUIRED_PLAYERS,
      dpsTarget,
      actors,
    );
  }
}

function getScriptAssignments(scriptState: Record<string, unknown>): P5Assignments | undefined {
  return scriptState[ASSIGNMENTS_KEY] as P5Assignments | undefined;
}

function isDpsSlot(slot: PartySlot): boolean {
  return DPS_SLOTS.includes(slot as (typeof DPS_SLOTS)[number]);
}

function normalizeDirection(point: Vector2, fallback: Vector2): Vector2 {
  const length = Math.hypot(point.x, point.y);

  if (length > 0.0001) {
    return {
      x: point.x / length,
      y: point.y / length,
    };
  }

  const fallbackLength = Math.hypot(fallback.x, fallback.y);

  if (fallbackLength > 0.0001) {
    return {
      x: fallback.x / fallbackLength,
      y: fallback.y / fallbackLength,
    };
  }

  return { x: 0, y: -1 };
}

function scaleVector(vector: Vector2, factor: number): Vector2 {
  return {
    x: vector.x * factor,
    y: vector.y * factor,
  };
}

function isBotSafePoint(point: Vector2, nuclearPoint: Vector2, sharePoint: Vector2): boolean {
  return (
    distance(point, CENTER) <= ARENA_RADIUS &&
    distance(point, nuclearPoint) > NUCLEAR_RADIUS + BOT_SAFE_MARGIN &&
    distance(point, sharePoint) > HOLY_SHARE_RADIUS + BOT_SAFE_MARGIN
  );
}

function findNearestBotSafePoint(
  start: Vector2,
  nuclearPoint: Vector2,
  sharePoint: Vector2,
): Vector2 {
  if (isBotSafePoint(start, nuclearPoint, sharePoint)) {
    return start;
  }

  let nearest: { point: Vector2; distance: number } | null = null;

  for (let radius = 0; radius <= ARENA_RADIUS; radius += BOT_SAFE_SEARCH_STEP) {
    for (let index = 0; index < BOT_SAFE_SEARCH_ANGLE_COUNT; index += 1) {
      const point = pointOnRadius((Math.PI * 2 * index) / BOT_SAFE_SEARCH_ANGLE_COUNT, radius);

      if (!isBotSafePoint(point, nuclearPoint, sharePoint)) {
        continue;
      }

      const pointDistance = distance(start, point);

      if (nearest === null || pointDistance < nearest.distance) {
        nearest = { point, distance: pointDistance };
      }
    }
  }

  return (
    nearest?.point ?? scaleVector(normalizeDirection(sharePoint, { x: -1, y: 0 }), ARENA_RADIUS)
  );
}

function getKefkaP5BotTarget(
  slot: PartySlot,
  actor: BaseActorSnapshot,
  actors: BaseActorSnapshot[],
  timeMs: number,
  scriptState: Record<string, unknown>,
): Vector2 {
  const assignments = getScriptAssignments(scriptState);

  if (assignments === undefined) {
    return INITIAL_POSITIONS[slot];
  }

  if (timeMs < FIRST_HIT_AT) {
    return INITIAL_POSITIONS[slot];
  }

  if (timeMs < SECOND_HIT_AT) {
    if (slot === 'ST') {
      return INITIAL_POSITIONS.MT;
    }

    if (assignments.firstDhTargetIds.includes(actor.id)) {
      return scaleVector(
        normalizeDirection(INITIAL_POSITIONS[slot], INITIAL_POSITIONS[slot]),
        BOSS_TARGET_RING_RADIUS + 3,
      );
    }

    return INITIAL_POSITIONS[slot];
  }

  if (timeMs < BUFF_RESOLVE_AT) {
    if (actor.id === assignments.nuclearTargetId) {
      return BOT_NUCLEAR_POINT;
    }

    if (assignments.secondDhTargetIds?.includes(actor.id)) {
      return findNearestBotSafePoint(actor.position, BOT_NUCLEAR_POINT, BOT_HOLY_SHARE_POINT);
    }

    if (actor.id === assignments.holyTargetId || assignments.firstDhTargetIds.includes(actor.id)) {
      return BOT_HOLY_SHARE_POINT;
    }

    return findNearestBotSafePoint(actor.position, BOT_NUCLEAR_POINT, BOT_HOLY_SHARE_POINT);
  }

  if (isTankSlot(slot)) {
    return BOT_FOLLOWUP_TANK_SHARE_POINT;
  }

  if (isDpsSlot(slot)) {
    return BOT_FOLLOWUP_DPS_SHARE_POINT;
  }

  return BOT_FOLLOWUP_HEALER_SHARE_POINT;
}

function buildKefkaP5MadSymphonyScript(ctx: BattleScriptContext): void {
  ctx.timeline.at(0, () => {
    ctx.boss.cast('kefka_p5_mad_symphony', '癫狂交响曲', CAST_MS);
  });
  ctx.timeline.at(FIRST_TELEGRAPH_AT, () => {
    spawnFirstTelegraphs(ctx);
  });
  ctx.timeline.at(FIRST_HIT_AT, () => {
    resolveFirstHit(ctx);
  });
  ctx.timeline.at(SECOND_TELEGRAPH_AT, () => {
    spawnSecondTelegraphs(ctx);
  });
  ctx.timeline.at(SECOND_HIT_AT, () => {
    resolveSecondHit(ctx);
  });
  ctx.timeline.at(BUFF_RESOLVE_AT, () => {
    resolveBuffs(ctx);
  });
  ctx.timeline.at(FIRST_FOLLOWUP_TELEGRAPH_AT, () => {
    spawnFollowupTelegraphs(ctx, 1);
  });
  ctx.timeline.at(FIRST_FOLLOWUP_HIT_AT, () => {
    resolveFollowup(ctx, 1);
  });
  ctx.timeline.at(SECOND_FOLLOWUP_TELEGRAPH_AT, () => {
    spawnFollowupTelegraphs(ctx, 2);
  });
  ctx.timeline.at(SECOND_FOLLOWUP_HIT_AT, () => {
    resolveFollowup(ctx, 2);
  });
  ctx.timeline.at(COMPLETE_AT, () => {
    ctx.state.complete();
  });
}

export const KEFKA_P5_MAD_SYMPHONY_BATTLE: BattleDefinition = {
  id: 'kefka_p5_mad_symphony',
  name: '凯夫卡P5：癫狂交响曲',
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
  buildScript: buildKefkaP5MadSymphonyScript,
  failureTexts: {
    outOfBounds: (actorName) => `${actorName} 越过场地边界`,
    mechanicDeath: (actorName, sourceLabel) => `${actorName} 因 ${sourceLabel} 死亡`,
  },
};

export const KEFKA_P5_MAD_SYMPHONY_BOT_CONTROLLER: BattleBotController = ({
  snapshot,
  slot,
  actor,
}) => {
  const target = getKefkaP5BotTarget(
    slot,
    actor,
    snapshot.actors,
    snapshot.timeMs,
    snapshot.scriptState,
  );
  const faceAngle = createFacingTowards(actor.position, snapshot.boss.position);

  return {
    pose: createPoseTowards(actor, target, faceAngle),
  };
};

export const KEFKA_P5_MAD_SYMPHONY_TESTING = {
  FIRST_TELEGRAPH_AT,
  FIRST_HIT_AT,
  SECOND_TELEGRAPH_AT,
  SECOND_HIT_AT,
  BUFF_RESOLVE_AT,
  FIRST_FOLLOWUP_TELEGRAPH_AT,
  FIRST_FOLLOWUP_HIT_AT,
  SECOND_FOLLOWUP_TELEGRAPH_AT,
  SECOND_FOLLOWUP_HIT_AT,
  COMPLETE_AT,
  TELEGRAPH_MS,
  INSTANT_TELEGRAPH_MS,
  TANK_SPREAD_RADIUS,
  DH_SPREAD_RADIUS,
  HOLY_SHARE_RADIUS,
  NUCLEAR_RADIUS,
  FOLLOWUP_SHARE_RADIUS,
  HOLY_REQUIRED_PLAYERS,
  FOLLOWUP_TANK_REQUIRED_PLAYERS,
  FOLLOWUP_HEALER_REQUIRED_PLAYERS,
  FOLLOWUP_DPS_REQUIRED_PLAYERS,
  TANK_INJURY_MS,
  DH_INJURY_MS,
  BUFF_INJURY_MS,
  FOLLOWUP_INJURY_MS,
  NUCLEAR_STATUS_ID,
  HOLY_STATUS_ID,
  ASSIGNMENTS_KEY,
  FOLLOWUP_TARGETS_KEY_PREFIX,
  BOT_INITIAL_RADIUS,
  BOT_NUCLEAR_RADIUS,
  BOT_NUCLEAR_POINT,
  BOT_HOLY_SHARE_POINT,
  BOT_FOLLOWUP_DPS_SHARE_POINT,
  BOT_FOLLOWUP_HEALER_SHARE_POINT,
  BOT_FOLLOWUP_TANK_SHARE_POINT,
  BOT_INITIAL_SLOT_ORDER,
  KEFKA_MAP_MARKERS,
  INITIAL_POSITIONS,
  findNearestBotSafePoint,
  getKefkaP5BotTarget,
};
