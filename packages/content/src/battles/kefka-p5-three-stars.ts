import type { BattleDefinition, BattleScriptContext } from '@ff14arena/core';
import { createFacingTowards, distance } from '@ff14arena/core';
import type { BaseActorSnapshot, StatusId, Vector2 } from '@ff14arena/shared';
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
  pointOnRadius,
} from './kefka-p5-common';

type Element = 'fire' | 'ice' | 'lightning';
type DisasterMode = 'wind' | 'earth';

interface ElementVulnerabilityAssignment {
  actorId: string;
  element: Element;
}

interface ThreeStarsTower {
  index: number;
  group: 'bottom' | 'leftUpper' | 'rightUpper';
  element: Element;
  position: Vector2;
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
  startAt: number;
  resolveAt: number;
  mode: DisasterMode;
}

interface ThreeStarsPlan {
  assignments: ElementVulnerabilityAssignment[];
  idleActorIds: string[];
  towers: ThreeStarsTower[];
  rounds: ActiveTowerRound[];
  disasters: DisasterCast[];
}

const CAST_MS = 5_000;
const TOWERS_SPAWN_AT = 5_000;
const INITIAL_VULNERABILITY_MS = 20_000;
const TOWER_VULNERABILITY_MS = 20_000;
const FIRST_LIGHT_AT = TOWERS_SPAWN_AT + 3_000;
const TOWER_ROUND_INTERVAL_MS = 6_000;
const FIRST_RESOLVE_AT = FIRST_LIGHT_AT + TOWER_ROUND_INTERVAL_MS;
const DISASTER_CAST_MS = 4_300;
const DISASTER_START_ATS = [9_700, 21_700] as const;
const SECOND_DISASTER_RESOLVE_AT = DISASTER_START_ATS[1] + DISASTER_CAST_MS;
const COMPLETE_AT = SECOND_DISASTER_RESOLVE_AT + 1_000;
const TOWER_RADIUS = 3;
const TOWER_DISTANCE = 10;
const TOWER_COUNT = 9;
const TOWER_DAMAGE = 1;
const DISASTER_EARTH_RADIUS = 10;
const DISASTER_WIND_INNER_RADIUS = 10;
const DISASTER_WIND_OUTER_RADIUS = 40;
const DISASTER_TELEGRAPH_MS = 500;
const BOSS_OVERLAY_RADIUS = 3;
const BOT_DISASTER_INNER_RADIUS = 8.5;
const BOT_DISASTER_OUTER_RADIUS = 11.5;
const BOT_TOWER_OFFSET = 0.55;
const PLAN_KEY = 'kefkaP5ThreeStars:plan';

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

function shuffle<T>(values: readonly T[]): T[] {
  const shuffled = [...values];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }

  return shuffled;
}

function choose<T>(values: readonly T[], count: number): T[] {
  return shuffle(values).slice(0, count);
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

function createAssignments(
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

function createRound(
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

    if (candidates.length < neededCount) {
      throw new Error('无法生成满足不重复约束的三星亮塔');
    }

    return choose(candidates, neededCount);
  }).sort((left, right) => left - right);

  return {
    index: roundIndex,
    lightAt: FIRST_LIGHT_AT + TOWER_ROUND_INTERVAL_MS * roundIndex,
    resolveAt: FIRST_RESOLVE_AT + TOWER_ROUND_INTERVAL_MS * roundIndex,
    repeatElement,
    towerIndexes,
  };
}

function createRounds(towers: readonly ThreeStarsTower[]): ActiveTowerRound[] {
  const repeatElements = shuffle(ELEMENTS);
  const rounds: ActiveTowerRound[] = [];

  for (let index = 0; index < ELEMENTS.length; index += 1) {
    rounds.push(
      createRound(index, towers, repeatElements[index]!, rounds.at(-1)?.towerIndexes ?? []),
    );
  }

  return rounds;
}

function createDisasters(): DisasterCast[] {
  return DISASTER_START_ATS.map((startAt, index) => ({
    index,
    startAt,
    resolveAt: startAt + DISASTER_CAST_MS,
    mode: Math.random() < 0.5 ? 'wind' : 'earth',
  }));
}

function createPlan(ctx: BattleScriptContext): ThreeStarsPlan {
  const towers = createTowers();
  const assignments = createAssignments(ctx);

  return {
    ...assignments,
    towers,
    rounds: createRounds(towers),
    disasters: createDisasters(),
  };
}

function getOrCreatePlan(ctx: BattleScriptContext): ThreeStarsPlan {
  const existingPlan = ctx.state.getValue<ThreeStarsPlan>(PLAN_KEY);

  if (existingPlan !== undefined) {
    return existingPlan;
  }

  const plan = createPlan(ctx);
  ctx.state.setValue(PLAN_KEY, plan);
  return plan;
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

function getActorsInside(
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

function triggerPartyWipe(ctx: BattleScriptContext, sourceLabel: string): void {
  ctx.state.fail(sourceLabel);
  ctx.damage.kill(
    ctx.select.activePlayers().map((actor) => actor.id),
    sourceLabel,
  );
  ctx.state.complete('failure');
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

function applyElementTowerDamage(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  element: Element,
): void {
  const freshActor = getFreshActor(ctx, actor.id);

  if (freshActor === null || !freshActor.mechanicActive) {
    return;
  }

  const label = `三星${ELEMENT_LABELS[element]}塔`;

  if (hasStatus(freshActor, ELEMENT_STATUS_IDS[element])) {
    ctx.damage.kill([freshActor.id], label);
    return;
  }

  ctx.damage.apply([freshActor.id], TOWER_DAMAGE, label);
  applyElementVulnerability(ctx, [freshActor.id], element, TOWER_VULNERABILITY_MS);
}

function spawnBaseTowers(ctx: BattleScriptContext, plan: ThreeStarsPlan): void {
  const resolveAfterMs = COMPLETE_AT - TOWERS_SPAWN_AT;

  for (const tower of plan.towers) {
    ctx.spawn.tower({
      label: `三星${ELEMENT_LABELS[tower.element]}塔`,
      center: tower.position,
      radius: TOWER_RADIUS,
      color: ELEMENT_TOWER_COLORS[tower.element],
      filled: false,
      resolveAfterMs,
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
      throw new Error(`三星第 ${round.index + 1} 轮缺少塔位 ${towerIndex}`);
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

    const hits = getActorsInside(actors, tower.position, TOWER_RADIUS);

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
      applyElementTowerDamage(ctx, hit, tower.element);
    }
  }
}

function applyInitialVulnerabilities(ctx: BattleScriptContext, plan: ThreeStarsPlan): void {
  for (const element of ELEMENTS) {
    applyElementVulnerability(
      ctx,
      plan.assignments
        .filter((assignment) => assignment.element === element)
        .map((assignment) => assignment.actorId),
      element,
      INITIAL_VULNERABILITY_MS,
    );
  }
}

function spawnDisasterTelegraphs(ctx: BattleScriptContext, disaster: DisasterCast): void {
  ctx.boss.cast(
    `kefka_p5_three_stars_disaster_${disaster.index}`,
    '二选一的灾祟',
    DISASTER_CAST_MS,
  );
  ctx.spawn.circleTelegraph({
    label: disaster.mode === 'wind' ? '二选一的灾祟风提示' : '二选一的灾祟土提示',
    center: CENTER,
    radius: BOSS_OVERLAY_RADIUS,
    color: DISASTER_COLORS[disaster.mode],
    resolveAfterMs: DISASTER_CAST_MS,
  });
}

function spawnDisasterRangeTelegraph(ctx: BattleScriptContext, disaster: DisasterCast): void {
  if (disaster.mode === 'wind') {
    ctx.spawn.donutTelegraph({
      label: '风月环',
      center: CENTER,
      innerRadius: DISASTER_WIND_INNER_RADIUS,
      outerRadius: DISASTER_WIND_OUTER_RADIUS,
      color: DISASTER_COLORS.wind,
      resolveAfterMs: DISASTER_TELEGRAPH_MS,
    });
    return;
  }

  ctx.spawn.circleTelegraph({
    label: '土大圈',
    center: CENTER,
    radius: DISASTER_EARTH_RADIUS,
    color: DISASTER_COLORS.earth,
    resolveAfterMs: DISASTER_TELEGRAPH_MS,
  });
}

function resolveDisaster(ctx: BattleScriptContext, disaster: DisasterCast): void {
  const hits = ctx.select
    .activePlayers()
    .filter((actor) =>
      disaster.mode === 'wind'
        ? distance(actor.position, CENTER) > DISASTER_WIND_INNER_RADIUS &&
          distance(actor.position, CENTER) <= DISASTER_WIND_OUTER_RADIUS
        : distance(actor.position, CENTER) <= DISASTER_EARTH_RADIUS,
    );

  if (hits.length > 0) {
    ctx.damage.kill(
      hits.map((actor) => actor.id),
      disaster.mode === 'wind' ? '风月环' : '土大圈',
    );
  }
}

function getActiveRound(plan: ThreeStarsPlan, timeMs: number): ActiveTowerRound | null {
  return plan.rounds.find((round) => timeMs >= round.lightAt && timeMs < round.resolveAt) ?? null;
}

function getCurrentDisaster(plan: ThreeStarsPlan, timeMs: number): DisasterCast | null {
  return (
    plan.disasters.find((disaster) => timeMs >= disaster.startAt && timeMs < disaster.resolveAt) ??
    null
  );
}

function getBotTowerRound(plan: ThreeStarsPlan, timeMs: number): ActiveTowerRound | null {
  const currentDisaster = getCurrentDisaster(plan, timeMs);

  if (currentDisaster !== null) {
    const resolvedDuringDisaster = plan.rounds.find(
      (round) =>
        round.resolveAt > currentDisaster.startAt &&
        round.resolveAt < currentDisaster.resolveAt &&
        timeMs >= round.resolveAt,
    );

    if (resolvedDuringDisaster !== undefined) {
      return resolvedDuringDisaster;
    }
  }

  return getActiveRound(plan, timeMs);
}

function getAssignmentElement(plan: ThreeStarsPlan, actorId: string): Element | null {
  return plan.assignments.find((assignment) => assignment.actorId === actorId)?.element ?? null;
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
  const elementOrder = getPlanElementOrder(plan);
  const index = elementOrder.indexOf(element);

  if (index < 0) {
    throw new Error(`三星塔颜色顺序缺少 ${element}`);
  }

  return elementOrder[(index + offset) % elementOrder.length]!;
}

function getRoundTargetElement(
  plan: ThreeStarsPlan,
  actorId: string,
  roundIndex: number,
): Element | null {
  const initialElement = getAssignmentElement(plan, actorId);

  if (initialElement === null) {
    return null;
  }

  return getNextElement(plan, initialElement, roundIndex + 1);
}

function sortTowersClockwise(towers: readonly ThreeStarsTower[]): ThreeStarsTower[] {
  const getSortKey = (tower: ThreeStarsTower) => (tower.index === 8 ? -1 : tower.index);

  return [...towers].sort((left, right) => getSortKey(left) - getSortKey(right));
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

  const targetTowers = sortTowersClockwise(
    activeTowers.filter((tower) => tower.element === targetElement),
  );

  return targetTowers[0] ?? null;
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

function adjustTowerPointForDisaster(
  tower: ThreeStarsTower,
  disaster: DisasterCast | null,
): Vector2 {
  if (disaster === null) {
    return tower.position;
  }

  return setVectorRadius(
    tower.position,
    disaster.mode === 'wind' ? BOT_DISASTER_INNER_RADIUS : BOT_DISASTER_OUTER_RADIUS,
  );
}

function addVector(left: Vector2, right: Vector2): Vector2 {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
  };
}

function scaleVector(vector: Vector2, factor: number): Vector2 {
  return {
    x: vector.x * factor,
    y: vector.y * factor,
  };
}

function getTowerBotHandlerIds(
  plan: ThreeStarsPlan,
  round: ActiveTowerRound,
  tower: ThreeStarsTower,
): string[] {
  return [
    ...plan.assignments
      .filter(
        (assignment) =>
          getRoundTargetElement(plan, assignment.actorId, round.index) === tower.element &&
          getTowerForBot(plan, assignment.actorId, round)?.index === tower.index,
      )
      .map((assignment) => assignment.actorId),
    ...plan.idleActorIds.filter(
      (actorId) => getTowerForBot(plan, actorId, round)?.index === tower.index,
    ),
  ].sort();
}

function offsetTowerPointForBot(
  basePoint: Vector2,
  tower: ThreeStarsTower,
  plan: ThreeStarsPlan,
  round: ActiveTowerRound,
  actorId: string,
): Vector2 {
  const handlerIds = getTowerBotHandlerIds(plan, round, tower);
  const handlerIndex = handlerIds.indexOf(actorId);

  if (handlerIndex < 0 || handlerIds.length <= 1) {
    return basePoint;
  }

  const direction = normalizeVector(tower.position);
  const tangent = { x: -direction.y, y: direction.x };
  const centeredIndex = handlerIndex - (handlerIds.length - 1) / 2;

  return addVector(basePoint, scaleVector(tangent, centeredIndex * BOT_TOWER_OFFSET * 2));
}

function getKefkaP5ThreeStarsBotTarget(
  actor: BaseActorSnapshot,
  timeMs: number,
  scriptState: Record<string, unknown>,
): Vector2 {
  const plan = scriptState[PLAN_KEY] as ThreeStarsPlan | undefined;

  if (plan === undefined) {
    return actor.slot === null ? CENTER : INITIAL_POSITIONS[actor.slot];
  }

  const activeRound = getBotTowerRound(plan, timeMs);

  if (activeRound === null) {
    return actor.slot === null ? CENTER : INITIAL_POSITIONS[actor.slot];
  }

  const targetTower = getTowerForBot(plan, actor.id, activeRound);

  if (targetTower === null) {
    return actor.slot === null ? CENTER : INITIAL_POSITIONS[actor.slot];
  }

  return offsetTowerPointForBot(
    adjustTowerPointForDisaster(targetTower, getCurrentDisaster(plan, timeMs)),
    targetTower,
    plan,
    activeRound,
    actor.id,
  );
}

function buildKefkaP5ThreeStarsScript(ctx: BattleScriptContext): void {
  const plan = getOrCreatePlan(ctx);

  ctx.timeline.at(0, () => {
    ctx.boss.cast('kefka_p5_three_stars', '三星', CAST_MS);
  });
  ctx.timeline.at(TOWERS_SPAWN_AT, () => {
    applyInitialVulnerabilities(ctx, plan);
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
    ctx.timeline.at(disaster.startAt, () => {
      spawnDisasterTelegraphs(ctx, disaster);
    });
    ctx.timeline.at(disaster.resolveAt - DISASTER_TELEGRAPH_MS, () => {
      spawnDisasterRangeTelegraph(ctx, disaster);
    });
    ctx.timeline.at(disaster.resolveAt, () => {
      resolveDisaster(ctx, disaster);
    });
  }

  ctx.timeline.at(COMPLETE_AT, () => {
    ctx.state.complete();
  });
}

export const KEFKA_P5_THREE_STARS_BATTLE: BattleDefinition = {
  id: 'kefka_p5_three_stars',
  name: '凯夫卡P5：三星',
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
  buildScript: buildKefkaP5ThreeStarsScript,
  failureTexts: {
    outOfBounds: (actorName) => `${actorName} 越过场地边界`,
    mechanicDeath: (actorName, sourceLabel) => `${actorName} 因 ${sourceLabel} 死亡`,
  },
};

export const KEFKA_P5_THREE_STARS_BOT_CONTROLLER: BattleBotController = ({ snapshot, actor }) => {
  const target = getKefkaP5ThreeStarsBotTarget(actor, snapshot.timeMs, snapshot.scriptState);
  const faceAngle = createFacingTowards(actor.position, snapshot.boss.position);

  return {
    pose: createPoseTowards(actor, target, faceAngle),
  };
};

export const KEFKA_P5_THREE_STARS_TESTING = {
  CAST_MS,
  TOWERS_SPAWN_AT,
  INITIAL_VULNERABILITY_MS,
  TOWER_VULNERABILITY_MS,
  FIRST_LIGHT_AT,
  TOWER_ROUND_INTERVAL_MS,
  FIRST_RESOLVE_AT,
  DISASTER_CAST_MS,
  DISASTER_START_ATS,
  DISASTER_TELEGRAPH_MS,
  SECOND_DISASTER_RESOLVE_AT,
  COMPLETE_AT,
  TOWER_RADIUS,
  TOWER_DISTANCE,
  TOWER_COUNT,
  DISASTER_EARTH_RADIUS,
  DISASTER_WIND_INNER_RADIUS,
  DISASTER_WIND_OUTER_RADIUS,
  BOSS_OVERLAY_RADIUS,
  BOT_DISASTER_INNER_RADIUS,
  BOT_DISASTER_OUTER_RADIUS,
  BOT_TOWER_OFFSET,
  PLAN_KEY,
  ELEMENTS,
  ELEMENT_STATUS_IDS,
  ELEMENT_TOWER_COLORS,
  TOWER_GROUP_INDEXES,
  KEFKA_MAP_MARKERS,
  INITIAL_POSITIONS,
  getTowerPosition,
  getActiveRound,
  getCurrentDisaster,
  getRoundTargetElement,
  getKefkaP5ThreeStarsBotTarget,
};
