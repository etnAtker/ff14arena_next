import type { BattleDefinition, BattleScriptContext } from '@ff14arena/core';
import type { BaseActorSnapshot, Vector2 } from '@ff14arena/shared';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import {
  KEFKA_P5_ARENA_RADIUS as ARENA_RADIUS,
  KEFKA_P5_BOSS_TARGET_RING_RADIUS as BOSS_TARGET_RING_RADIUS,
  KEFKA_P5_MAP_MARKERS as KEFKA_MAP_MARKERS,
} from './kefka-p5-common';

type FloodDirectionId = 'slash' | 'backslash';
type FloodVariantId =
  | 'slash_near_right'
  | 'slash_near_left'
  | 'backslash_near_right'
  | 'backslash_near_left';

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
  round: number;
  variantId: FloodVariantId;
}

const CAST_START_AT = 1_000;
const CAST_MS = 5_000;
const ROUND_COUNT = 4;
const PREVIEW_INTERVAL_MS = 1_000;
const PREVIEW_DISPLAY_MS = 1_300;
const FIRST_RESOLVE_DELAY_AFTER_CAST_MS = 1_000;
const RESOLVE_INTERVAL_MS = 1_000;
const RESOLVE_DISPLAY_MS = 300;
const THUNDER_LENGTH = 40;
const THUNDER_WIDTH = 10;
const THUNDER_NEAR_OFFSET = 5;
const THUNDER_FAR_OFFSET = 15;
const FLOOD_COLOR = '#38bdf8';
const FLOOD_DEATH_SOURCE = '洪水';
const FLOOD_PLAN_KEY = 'kefkaP5Flood:plan';
const INITIAL_SOUTH_Y = 12;
const INITIAL_LINE_SPACING = 1.2;
const INITIAL_NORTH_FACING = -Math.PI / 2;
const FIRST_RESOLVE_AT = CAST_START_AT + CAST_MS + FIRST_RESOLVE_DELAY_AFTER_CAST_MS;
const LAST_RESOLVE_AT = FIRST_RESOLVE_AT + RESOLVE_INTERVAL_MS * (ROUND_COUNT - 1);
const COMPLETE_AT = LAST_RESOLVE_AT + 1_000;

const INITIAL_POSITIONS = Object.fromEntries(
  PARTY_SLOT_ORDER.map((slot, index) => [
    slot,
    {
      x: (index - (PARTY_SLOT_ORDER.length - 1) / 2) * INITIAL_LINE_SPACING,
      y: INITIAL_SOUTH_Y,
    },
  ]),
) as Record<(typeof PARTY_SLOT_ORDER)[number], Vector2>;

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

function getFloodVariant(variantId: FloodVariantId): FloodVariant {
  const variant = FLOOD_VARIANTS.find((candidate) => candidate.id === variantId);

  if (variant === undefined) {
    throw new Error(`missing Kefka P5 flood variant ${variantId}`);
  }

  return variant;
}

function createThunderRect(direction: number, offset: number): RectSpec {
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
      x: lineCenter.x - Math.cos(direction) * (THUNDER_LENGTH / 2),
      y: lineCenter.y - Math.sin(direction) * (THUNDER_LENGTH / 2),
    },
    direction,
    length: THUNDER_LENGTH,
    width: THUNDER_WIDTH,
  };
}

function getFloodRoundRects(round: FloodRound): RectSpec[] {
  const variant = getFloodVariant(round.variantId);

  return [
    createThunderRect(variant.direction, variant.side * THUNDER_NEAR_OFFSET),
    createThunderRect(variant.direction, -variant.side * THUNDER_FAR_OFFSET),
  ];
}

function createFloodPlan(): FloodRound[] {
  const rounds: FloodRound[] = [];
  let remainingVariants: FloodVariant[] = [...FLOOD_VARIANTS];
  let previousDirectionId: FloodDirectionId | null = null;

  for (let round = 1; round <= ROUND_COUNT; round += 1) {
    const candidates = remainingVariants.filter(
      (variant) => variant.directionId !== previousDirectionId,
    );

    if (candidates.length === 0) {
      throw new Error('凯夫卡P5洪水无法生成满足不重复和方向约束的计划');
    }

    const variant = candidates[Math.floor(Math.random() * candidates.length)]!;

    rounds.push({
      round,
      variantId: variant.id,
    });
    remainingVariants = remainingVariants.filter((candidate) => candidate.id !== variant.id);
    previousDirectionId = variant.directionId;
  }

  return rounds;
}

function getOrCreateFloodPlan(ctx: BattleScriptContext): FloodRound[] {
  const existingPlan = ctx.state.getValue<FloodRound[]>(FLOOD_PLAN_KEY);

  if (existingPlan !== undefined) {
    return existingPlan;
  }

  const plan = createFloodPlan();
  ctx.state.setValue(FLOOD_PLAN_KEY, plan);

  return plan;
}

function isActorInsideRectangle(actor: BaseActorSnapshot, spec: RectSpec): boolean {
  if (!actor.mechanicActive) {
    return false;
  }

  const relative = {
    x: actor.position.x - spec.center.x,
    y: actor.position.y - spec.center.y,
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

function resolveFloodRound(ctx: BattleScriptContext, round: FloodRound): void {
  const rects = getFloodRoundRects(round);
  const hits = ctx.select
    .allPlayers()
    .filter((actor) => rects.some((rect) => isActorInsideRectangle(actor, rect)));

  if (hits.length > 0) {
    ctx.damage.kill(
      hits.map((actor) => actor.id),
      FLOOD_DEATH_SOURCE,
    );
  }
}

function buildKefkaP5FloodScript(ctx: BattleScriptContext): void {
  const plan = getOrCreateFloodPlan(ctx);

  ctx.timeline.at(CAST_START_AT, () => {
    ctx.boss.cast('kefka_p5_flood', '洪水', CAST_MS);
  });

  for (const round of plan) {
    const previewAt = CAST_START_AT + PREVIEW_INTERVAL_MS * (round.round - 1);
    const resolveAt = FIRST_RESOLVE_AT + RESOLVE_INTERVAL_MS * (round.round - 1);

    ctx.timeline.at(previewAt, () => {
      spawnFloodTelegraphs(ctx, round, PREVIEW_DISPLAY_MS);
    });
    ctx.timeline.at(resolveAt, () => {
      resolveFloodRound(ctx, round);
      spawnFloodTelegraphs(ctx, round, RESOLVE_DISPLAY_MS);
    });
  }

  ctx.timeline.at(COMPLETE_AT, () => {
    ctx.state.complete();
  });
}

export const KEFKA_P5_FLOOD_BATTLE: BattleDefinition = {
  id: 'kefka_p5_flood',
  name: '凯夫卡P5：洪水',
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
  buildScript: buildKefkaP5FloodScript,
  failureTexts: {
    outOfBounds: (actorName) => `${actorName} 越过场地边界`,
    mechanicDeath: (actorName, sourceLabel) => `${actorName} 因 ${sourceLabel} 死亡`,
  },
};

export const KEFKA_P5_FLOOD_TESTING = {
  CAST_START_AT,
  CAST_MS,
  ROUND_COUNT,
  PREVIEW_INTERVAL_MS,
  PREVIEW_DISPLAY_MS,
  FIRST_RESOLVE_DELAY_AFTER_CAST_MS,
  RESOLVE_INTERVAL_MS,
  RESOLVE_DISPLAY_MS,
  THUNDER_LENGTH,
  THUNDER_WIDTH,
  THUNDER_NEAR_OFFSET,
  THUNDER_FAR_OFFSET,
  FLOOD_DEATH_SOURCE,
  FLOOD_PLAN_KEY,
  INITIAL_SOUTH_Y,
  INITIAL_LINE_SPACING,
  INITIAL_NORTH_FACING,
  FIRST_RESOLVE_AT,
  LAST_RESOLVE_AT,
  COMPLETE_AT,
  KEFKA_MAP_MARKERS,
  INITIAL_POSITIONS,
  FLOOD_VARIANTS,
  createFloodPlan,
  getFloodRoundRects,
  getFloodVariant,
};
