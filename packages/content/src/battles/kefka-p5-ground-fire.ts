import type { BattleDefinition, BattleScriptContext } from '@ff14arena/core';
import { distance } from '@ff14arena/core';
import type { BaseActorSnapshot, Vector2 } from '@ff14arena/shared';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import {
  KEFKA_P5_ARENA_RADIUS as ARENA_RADIUS,
  KEFKA_P5_BOSS_TARGET_RING_RADIUS as BOSS_TARGET_RING_RADIUS,
  KEFKA_P5_MAP_MARKERS as KEFKA_MAP_MARKERS,
} from './kefka-p5-common';

type FireSide = 'left' | 'right';
type FireNumber = 1 | 2 | 3 | 4 | 5 | 6;

interface FireBatch {
  side: FireSide;
  numbers: readonly FireNumber[];
  startOffsetMs: number;
}

interface FirePlan {
  left: readonly FireGroupId[];
  right: readonly FireGroupId[];
}

type FireGroupId = '14' | '25' | '36';

const CAST_START_AT = 3_000;
const INITIAL_TELEGRAPH_MS = 4_000;
const FIRST_HIT_DELAY_MS = 4_500;
const HIT_INTERVAL_MS = 500;
const HIT_COUNT = 7;
const HIT_DISPLAY_MS = 300;
const AOE_RADIUS = 6;
const FIRE_GRID_STEP = 5;
const LEFT_FIRE_DIRECTION = Math.PI / 4;
const RIGHT_FIRE_DIRECTION = (Math.PI * 3) / 4;
const START_LINE_POINT_COUNT = 6;
const START_LINE_POINT_GAP = FIRE_GRID_STEP * Math.SQRT2;
const START_LINE_LENGTH = START_LINE_POINT_GAP * (START_LINE_POINT_COUNT - 1);
const STEP_DISTANCE = START_LINE_POINT_GAP;
const BISECTOR_LENGTH = FIRE_GRID_STEP * ((START_LINE_POINT_COUNT + 1) / 2) * Math.SQRT2;
const FIRE_COLOR = '#f97316';
const FIRE_DEATH_SOURCE = '地火';
const CHAOS_DOOMSDAY_CAST_MS = 4_000;
const INITIAL_SOUTH_Y = 12;
const INITIAL_LINE_SPACING = 1.2;
const INITIAL_NORTH_FACING = -Math.PI / 2;

const INITIAL_POSITIONS = Object.fromEntries(
  PARTY_SLOT_ORDER.map((slot, index) => [
    slot,
    {
      x: (index - (PARTY_SLOT_ORDER.length - 1) / 2) * INITIAL_LINE_SPACING,
      y: INITIAL_SOUTH_Y,
    },
  ]),
) as Record<(typeof PARTY_SLOT_ORDER)[number], Vector2>;

const FIRE_GROUPS = {
  '14': [1, 4],
  '25': [2, 5],
  '36': [3, 6],
} as const satisfies Record<FireGroupId, readonly FireNumber[]>;
const FIRE_GROUP_IDS = ['14', '25', '36'] as const satisfies readonly FireGroupId[];
const LEFT_BATCH_START_OFFSETS_MS = [0, 5_000, 10_000] as const;
const RIGHT_BATCH_START_OFFSETS_MS = [3_000, 8_000, 13_000] as const;
const FIRE_PLAN_KEY = 'kefkaP5GroundFire:plan';
const LAST_FIRE_START_OFFSET_MS = Math.max(
  ...LEFT_BATCH_START_OFFSETS_MS,
  ...RIGHT_BATCH_START_OFFSETS_MS,
);
const LAST_HIT_OFFSET_MS =
  LAST_FIRE_START_OFFSET_MS + FIRST_HIT_DELAY_MS + HIT_INTERVAL_MS * (HIT_COUNT - 1);
const LAST_HIT_AT = CAST_START_AT + LAST_HIT_OFFSET_MS;
const COMPLETE_AT = LAST_HIT_AT + 1_000;

function shuffle<T>(values: readonly T[]): T[] {
  const shuffled = [...values];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }

  return shuffled;
}

function createFirePlan(): FirePlan {
  return {
    left: shuffle(FIRE_GROUP_IDS),
    right: shuffle(FIRE_GROUP_IDS),
  };
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

function buildFireBatches(plan: FirePlan): FireBatch[] {
  return [
    ...plan.left.map((groupId, index) => ({
      side: 'left' as const,
      numbers: FIRE_GROUPS[groupId],
      startOffsetMs: LEFT_BATCH_START_OFFSETS_MS[index]!,
    })),
    ...plan.right.map((groupId, index) => ({
      side: 'right' as const,
      numbers: FIRE_GROUPS[groupId],
      startOffsetMs: RIGHT_BATCH_START_OFFSETS_MS[index]!,
    })),
  ];
}

function getFireStartPosition(side: FireSide, number: FireNumber): Vector2 {
  const x = FIRE_GRID_STEP * number;
  const y = -FIRE_GRID_STEP * (START_LINE_POINT_COUNT + 1 - number);

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

function getFireLabel(side: FireSide, number: FireNumber): string {
  return `${side === 'left' ? '左' : '右'}${number}号地火`;
}

function getFireDirection(side: FireSide): number {
  return side === 'left' ? LEFT_FIRE_DIRECTION : RIGHT_FIRE_DIRECTION;
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

function spawnFireTelegraph(
  ctx: BattleScriptContext,
  side: FireSide,
  number: FireNumber,
  center: Vector2,
  resolveAfterMs: number,
  direction?: number,
): void {
  ctx.spawn.circleTelegraph({
    label: getFireLabel(side, number),
    center,
    radius: AOE_RADIUS,
    ...(direction === undefined ? {} : { direction }),
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
  const hits = getActorsInsideCircle(ctx.select.allPlayers(), center, AOE_RADIUS);

  if (hits.length > 0) {
    ctx.damage.kill(
      hits.map((actor) => actor.id),
      FIRE_DEATH_SOURCE,
    );
  }
}

function scheduleFireSequence(
  ctx: BattleScriptContext,
  side: FireSide,
  number: FireNumber,
  startAt: number,
): void {
  ctx.timeline.at(startAt, () => {
    spawnFireTelegraph(
      ctx,
      side,
      number,
      getFireStartPosition(side, number),
      INITIAL_TELEGRAPH_MS,
      getFireDirection(side),
    );
  });

  for (let hitIndex = 0; hitIndex < HIT_COUNT; hitIndex += 1) {
    const hitAt = startAt + FIRST_HIT_DELAY_MS + HIT_INTERVAL_MS * hitIndex;
    const center = getFireHitPosition(side, number, hitIndex);

    ctx.timeline.at(hitAt, () => {
      resolveFireHit(ctx, side, number, hitIndex);
      spawnFireTelegraph(ctx, side, number, center, HIT_DISPLAY_MS);
    });
  }
}

function buildKefkaP5GroundFireScript(ctx: BattleScriptContext): void {
  ctx.timeline.at(CAST_START_AT, () => {
    ctx.boss.cast('kefka_p5_chaos_doomsday', '混沌末世', CHAOS_DOOMSDAY_CAST_MS);
  });

  for (const batch of buildFireBatches(getOrCreateFirePlan(ctx))) {
    for (const number of batch.numbers) {
      scheduleFireSequence(ctx, batch.side, number, CAST_START_AT + batch.startOffsetMs);
    }
  }

  ctx.timeline.at(COMPLETE_AT, () => {
    ctx.state.complete();
  });
}

export const KEFKA_P5_GROUND_FIRE_BATTLE: BattleDefinition = {
  id: 'kefka_p5_ground_fire',
  name: '凯夫卡P5：地火',
  arenaRadius: ARENA_RADIUS,
  bossTargetRingRadius: BOSS_TARGET_RING_RADIUS,
  slots: PARTY_SLOT_ORDER,
  bossName: '凯夫卡',
  initialPartyPositions: Object.fromEntries(
    PARTY_SLOT_ORDER.map((slot) => [
      slot,
      {
        position: INITIAL_POSITIONS[slot],
        facing: INITIAL_NORTH_FACING,
      },
    ]),
  ) as BattleDefinition['initialPartyPositions'],
  mapMarkers: KEFKA_MAP_MARKERS,
  buildScript: buildKefkaP5GroundFireScript,
  failureTexts: {
    outOfBounds: (actorName) => `${actorName} 越过场地边界`,
    mechanicDeath: (actorName, sourceLabel) => `${actorName} 因 ${sourceLabel} 死亡`,
  },
};

export const KEFKA_P5_GROUND_FIRE_TESTING = {
  CAST_START_AT,
  CHAOS_DOOMSDAY_CAST_MS,
  INITIAL_TELEGRAPH_MS,
  FIRST_HIT_DELAY_MS,
  HIT_INTERVAL_MS,
  HIT_COUNT,
  HIT_DISPLAY_MS,
  AOE_RADIUS,
  FIRE_GRID_STEP,
  START_LINE_LENGTH,
  START_LINE_POINT_COUNT,
  START_LINE_POINT_GAP,
  STEP_DISTANCE,
  BISECTOR_LENGTH,
  LEFT_FIRE_DIRECTION,
  RIGHT_FIRE_DIRECTION,
  FIRE_GROUPS,
  FIRE_GROUP_IDS,
  FIRE_PLAN_KEY,
  LEFT_BATCH_START_OFFSETS_MS,
  RIGHT_BATCH_START_OFFSETS_MS,
  LAST_HIT_AT,
  COMPLETE_AT,
  FIRE_DEATH_SOURCE,
  INITIAL_SOUTH_Y,
  INITIAL_LINE_SPACING,
  INITIAL_NORTH_FACING,
  KEFKA_MAP_MARKERS,
  INITIAL_POSITIONS,
  buildFireBatches,
  getFireStartPosition,
  getFireHitPosition,
};
