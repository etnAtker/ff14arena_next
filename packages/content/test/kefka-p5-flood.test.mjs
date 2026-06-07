import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '@ff14arena/core';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { battleDefinitions, getBattleBotController, getBattleDefinition } from '../src/index.ts';
import { KEFKA_P5_FLOOD_TESTING } from '../src/battles/kefka-p5-flood.ts';

const {
  CAST_START_AT,
  CAST_MS,
  ROUND_COUNT,
  PREVIEW_INTERVAL_MS,
  PREVIEW_DISPLAY_MS,
  FIRST_RESOLVE_DELAY_AFTER_CAST_MS,
  RESOLVE_DISPLAY_MS,
  FLOOD_DEATH_SOURCE,
  FLOOD_PLAN_KEY,
  INITIAL_SOUTH_Y,
  INITIAL_LINE_SPACING,
  INITIAL_NORTH_FACING,
  FIRST_RESOLVE_AT,
  KEFKA_MAP_MARKERS,
  INITIAL_POSITIONS,
  getFloodRoundRects,
  getFloodVariant,
} = KEFKA_P5_FLOOD_TESTING;

function withMockedRandom(randomValues, fn) {
  const originalRandom = Math.random;
  let randomIndex = 0;
  Math.random = () => randomValues[randomIndex++ % randomValues.length];

  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

function createKefkaP5FloodSimulation() {
  const battle = getBattleDefinition('kefka_p5_flood');
  assert.ok(battle);

  const simulation = createSimulation();
  simulation.loadBattle({
    battle,
    roomId: 'kefka-p5-flood-test-room',
    party: PARTY_SLOT_ORDER.map((slot) => ({
      slot,
      name: slot,
      kind: 'player',
      actorId: `player_${slot}`,
    })),
  });
  simulation.start();

  return simulation;
}

function advanceTo(simulation, timeMs) {
  const currentTimeMs = simulation.getSnapshot().timeMs;

  if (timeMs > currentTimeMs) {
    simulation.tick(timeMs - currentTimeMs);
  }
}

function getActorBySlot(snapshot, slot) {
  const actor = snapshot.actors.find((candidate) => candidate.slot === slot);
  assert.ok(actor);

  return actor;
}

function submitPose(simulation, actor, position) {
  simulation.submitActorControlFrame({
    actorId: actor.id,
    issuedAt: simulation.getSnapshot().timeMs,
    pose: {
      position,
      facing: actor.facing,
      moveState: {
        direction: { x: 0, y: 0 },
        moving: false,
      },
    },
  });
}

function rectangleMidpoint(rect) {
  return {
    x: rect.center.x + Math.cos(rect.direction) * (rect.length / 2),
    y: rect.center.y + Math.sin(rect.direction) * (rect.length / 2),
  };
}

function assertNear(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= 0.001, `${label}: expected ${expected}, got ${actual}`);
}

test('凯夫卡P5洪水：战斗登记、不登记Bot，且P5注册顺序正确', () => {
  const battle = getBattleDefinition('kefka_p5_flood');
  assert.ok(battle);

  assert.equal(battle.name, '凯夫卡P5：洪水');
  assert.deepEqual(battle.mapMarkers, KEFKA_MAP_MARKERS);
  assert.equal(getBattleBotController('kefka_p5_flood'), undefined);
  assert.deepEqual(
    battleDefinitions.map((definition) => definition.id).filter((id) => id.startsWith('kefka_p5_')),
    [
      'kefka_p5_flood',
      'kefka_p5_mad_symphony',
      'kefka_p5_three_stars',
      'kefka_p5_ground_fire',
      'kefka_p5_full',
    ],
  );
});

test('凯夫卡P5洪水：初始站位沿用P5地火南侧一字排开并面向北', () => {
  const battle = getBattleDefinition('kefka_p5_flood');
  assert.ok(battle);

  for (let index = 0; index < PARTY_SLOT_ORDER.length; index += 1) {
    const slot = PARTY_SLOT_ORDER[index];
    const placement = battle.initialPartyPositions[slot];
    const expected = INITIAL_POSITIONS[slot];

    assertNear(placement.position.x, expected.x, `${slot} 初始 x`);
    assertNear(placement.position.y, INITIAL_SOUTH_Y, `${slot} 初始 y`);
    assertNear(placement.facing, INITIAL_NORTH_FACING, `${slot} 初始面向`);

    if (index > 0) {
      const previousSlot = PARTY_SLOT_ORDER[index - 1];
      const previousPlacement = battle.initialPartyPositions[previousSlot];

      assertNear(
        placement.position.x - previousPlacement.position.x,
        INITIAL_LINE_SPACING,
        `${previousSlot}-${slot} 初始间距`,
      );
      assertNear(
        placement.position.y,
        previousPlacement.position.y,
        `${previousSlot}-${slot} 初始 y`,
      );
    }
  }
});

test('凯夫卡P5洪水：T+1读条并按1秒间隔显示4轮重叠预兆', () => {
  withMockedRandom([0, 0, 0, 0], () => {
    const simulation = createKefkaP5FloodSimulation();

    advanceTo(simulation, CAST_START_AT);

    const castSnapshot = simulation.getSnapshot();
    const plan = castSnapshot.scriptState[FLOOD_PLAN_KEY];
    assert.equal(plan.length, ROUND_COUNT);
    assert.equal(castSnapshot.boss.castBar?.actionName, '洪水');
    assert.equal(castSnapshot.boss.castBar?.startedAt, CAST_START_AT);
    assert.equal(castSnapshot.boss.castBar?.totalDurationMs, CAST_MS);

    const firstRoundTelegraphs = castSnapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'rectangleTelegraph' && mechanic.label === '洪水',
    );
    assert.equal(firstRoundTelegraphs.length, 2);
    assert.ok(
      firstRoundTelegraphs.every(
        (mechanic) => mechanic.resolveAt === CAST_START_AT + PREVIEW_DISPLAY_MS,
      ),
    );

    advanceTo(simulation, CAST_START_AT + PREVIEW_INTERVAL_MS);

    const overlapSnapshot = simulation.getSnapshot();
    const activeFloodTelegraphs = overlapSnapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'rectangleTelegraph' && mechanic.label === '洪水',
    );
    assert.equal(activeFloodTelegraphs.length, 4);
  });
});

test('凯夫卡P5洪水：4轮预兆范围不重复且相同方向不连续刷新', () => {
  withMockedRandom([0, 0.99, 0.25, 0.75], () => {
    const simulation = createKefkaP5FloodSimulation();
    const plan = simulation.getSnapshot().scriptState[FLOOD_PLAN_KEY];
    const variantIds = plan.map((round) => round.variantId);

    assert.equal(plan.length, ROUND_COUNT);
    assert.equal(new Set(variantIds).size, ROUND_COUNT);

    for (let index = 1; index < plan.length; index += 1) {
      const previous = getFloodVariant(plan[index - 1].variantId);
      const current = getFloodVariant(plan[index].variantId);

      assert.notEqual(current.directionId, previous.directionId);
    }
  });
});

test('凯夫卡P5洪水：读条结束后1秒开始依次判定，判定后显示0.3秒范围且命中即死', () => {
  withMockedRandom([0, 0, 0, 0], () => {
    const simulation = createKefkaP5FloodSimulation();

    advanceTo(simulation, FIRST_RESOLVE_AT - 1);

    const beforeResolveSnapshot = simulation.getSnapshot();
    const plan = beforeResolveSnapshot.scriptState[FLOOD_PLAN_KEY];
    const firstResolveRects = getFloodRoundRects(plan[0]);
    const mt = getActorBySlot(beforeResolveSnapshot, 'MT');

    submitPose(simulation, mt, rectangleMidpoint(firstResolveRects[0]));
    advanceTo(simulation, FIRST_RESOLVE_AT);

    const resolvedSnapshot = simulation.getSnapshot();
    const resolvedMt = getActorBySlot(resolvedSnapshot, 'MT');
    const resolvedTelegraphs = resolvedSnapshot.mechanics.filter(
      (mechanic) =>
        mechanic.kind === 'rectangleTelegraph' &&
        mechanic.label === '洪水' &&
        mechanic.resolveAt === FIRST_RESOLVE_AT + RESOLVE_DISPLAY_MS,
    );

    assert.equal(FIRST_RESOLVE_DELAY_AFTER_CAST_MS, 1_000);
    assert.equal(resolvedTelegraphs.length, 2);
    assert.equal(resolvedMt.alive, false);
    assert.equal(resolvedMt.deathReason, FLOOD_DEATH_SOURCE);
  });
});
