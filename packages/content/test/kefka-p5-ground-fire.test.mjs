import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '@ff14arena/core';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { getBattleBotController, getBattleDefinition } from '../src/index.ts';
import { KEFKA_P5_GROUND_FIRE_TESTING } from '../src/battles/kefka-p5-ground-fire.ts';

const {
  CAST_START_AT,
  CHAOS_DOOMSDAY_CAST_MS,
  INITIAL_TELEGRAPH_MS,
  FIRST_HIT_DELAY_MS,
  HIT_INTERVAL_MS,
  HIT_COUNT,
  HIT_DISPLAY_MS,
  AOE_RADIUS,
  START_LINE_LENGTH,
  START_LINE_POINT_COUNT,
  START_LINE_POINT_GAP,
  STEP_DISTANCE,
  BISECTOR_LENGTH,
  FIRE_BATCHES,
  FIRE_DEATH_SOURCE,
  INITIAL_SOUTH_Y,
  INITIAL_LINE_SPACING,
  INITIAL_NORTH_FACING,
  KEFKA_MAP_MARKERS,
  INITIAL_POSITIONS,
  getFireStartPosition,
  getFireHitPosition,
} = KEFKA_P5_GROUND_FIRE_TESTING;

function createKefkaP5GroundFireSimulation() {
  const battle = getBattleDefinition('kefka_p5_ground_fire');
  assert.ok(battle);

  const simulation = createSimulation();
  simulation.loadBattle({
    battle,
    roomId: 'kefka-p5-ground-fire-test-room',
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

function pointDistance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function midpoint(left, right) {
  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
  };
}

function assertNear(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= 0.001, `${label}: expected ${expected}, got ${actual}`);
}

test('凯夫卡P5地火：战斗登记且不登记Bot', () => {
  const battle = getBattleDefinition('kefka_p5_ground_fire');
  assert.ok(battle);

  assert.equal(battle.name, '凯夫卡P5：地火');
  assert.deepEqual(battle.mapMarkers, KEFKA_MAP_MARKERS);
  assert.equal(getBattleBotController('kefka_p5_ground_fire'), undefined);
});

test('凯夫卡P5地火：初始站位在南侧一字排开并面向北', () => {
  const battle = getBattleDefinition('kefka_p5_ground_fire');
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

test('凯夫卡P5地火：左右起始线长度35m，中垂线25m，6个起点间隔7m', () => {
  for (const side of ['left', 'right']) {
    const starts = Array.from({ length: START_LINE_POINT_COUNT }, (_, index) =>
      getFireStartPosition(side, index + 1),
    );
    const lineMidpoint = midpoint(starts[0], starts[starts.length - 1]);

    assertNear(
      pointDistance(starts[0], starts[starts.length - 1]),
      START_LINE_LENGTH,
      `${side} 起始线长度`,
    );
    assertNear(pointDistance(lineMidpoint, { x: 0, y: 0 }), BISECTOR_LENGTH, `${side} 中垂线长度`);

    for (let index = 1; index < starts.length; index += 1) {
      assertNear(
        pointDistance(starts[index - 1], starts[index]),
        START_LINE_POINT_GAP,
        `${side} ${index}-${index + 1} 起点间隔`,
      );
    }
  }
});

test('凯夫卡P5地火：每条地火向场中方向步进7次，每次前进7m', () => {
  for (const side of ['left', 'right']) {
    for (const number of [1, 2, 3, 4, 5, 6]) {
      const firstHit = getFireHitPosition(side, number, 0);
      const lastHit = getFireHitPosition(side, number, HIT_COUNT - 1);

      assert.ok(
        pointDistance(lastHit, { x: 0, y: 0 }) < pointDistance(firstHit, { x: 0, y: 0 }),
        `${side}${number} 应向场中步进`,
      );

      for (let hitIndex = 1; hitIndex < HIT_COUNT; hitIndex += 1) {
        assertNear(
          pointDistance(
            getFireHitPosition(side, number, hitIndex - 1),
            getFireHitPosition(side, number, hitIndex),
          ),
          STEP_DISTANCE,
          `${side}${number} 第${hitIndex}次步进距离`,
        );
      }
    }
  }
});

test('凯夫卡P5地火：T+3读条混沌末世，并按批次刷新地火预兆', () => {
  const simulation = createKefkaP5GroundFireSimulation();

  advanceTo(simulation, CAST_START_AT);

  const castSnapshot = simulation.getSnapshot();
  assert.equal(castSnapshot.boss.castBar?.actionName, '混沌末世');
  assert.equal(castSnapshot.boss.castBar?.startedAt, CAST_START_AT);
  assert.equal(castSnapshot.boss.castBar?.totalDurationMs, CHAOS_DOOMSDAY_CAST_MS);
  assert.equal(CHAOS_DOOMSDAY_CAST_MS, 4_000);

  const initialTelegraphs = castSnapshot.mechanics.filter(
    (mechanic) => mechanic.kind === 'circleTelegraph',
  );
  assert.deepEqual(initialTelegraphs.map((mechanic) => mechanic.label).sort(), [
    '左1号地火',
    '左4号地火',
  ]);
  assert.ok(
    initialTelegraphs.every(
      (mechanic) =>
        mechanic.radius === AOE_RADIUS &&
        mechanic.resolveAt === CAST_START_AT + INITIAL_TELEGRAPH_MS,
    ),
  );

  advanceTo(simulation, CAST_START_AT + 3_000);

  const rightFirstSnapshot = simulation.getSnapshot();
  const rightFirstTelegraphs = rightFirstSnapshot.mechanics.filter(
    (mechanic) =>
      mechanic.kind === 'circleTelegraph' &&
      ['右3号地火', '右6号地火'].includes(mechanic.label) &&
      mechanic.resolveAt === CAST_START_AT + 3_000 + INITIAL_TELEGRAPH_MS,
  );
  assert.equal(rightFirstTelegraphs.length, 2);

  assert.deepEqual(
    FIRE_BATCHES.map((batch) => `${batch.side}:${batch.numbers.join(',')}:${batch.startOffsetMs}`),
    [
      'left:1,4:0',
      'left:2,5:5000',
      'left:3,6:10000',
      'right:3,6:3000',
      'right:2,5:8000',
      'right:1,4:13000',
    ],
  );
});

test('凯夫卡P5地火：地火半径6m，每次判定后显示0.3秒，命中即死', () => {
  const simulation = createKefkaP5GroundFireSimulation();
  const firstLeftHitAt = CAST_START_AT + FIRST_HIT_DELAY_MS;

  advanceTo(simulation, firstLeftHitAt - 1);

  const beforeHitSnapshot = simulation.getSnapshot();
  const beforeHitTelegraphs = beforeHitSnapshot.mechanics.filter(
    (mechanic) =>
      mechanic.kind === 'circleTelegraph' &&
      ['左1号地火', '左4号地火'].includes(mechanic.label) &&
      mechanic.resolveAt === firstLeftHitAt + HIT_DISPLAY_MS,
  );

  assert.equal(beforeHitTelegraphs.length, 0);

  const mt = getActorBySlot(beforeHitSnapshot, 'MT');
  const hitIndex = 3;
  const hitAt = CAST_START_AT + FIRST_HIT_DELAY_MS + HIT_INTERVAL_MS * hitIndex;
  const hitPosition = getFireHitPosition('left', 1, hitIndex);

  submitPose(simulation, mt, hitPosition);
  advanceTo(simulation, hitAt);

  const hitSnapshot = simulation.getSnapshot();
  const hitTelegraphs = hitSnapshot.mechanics.filter(
    (mechanic) =>
      mechanic.kind === 'circleTelegraph' &&
      ['左1号地火', '左4号地火'].includes(mechanic.label) &&
      mechanic.resolveAt === hitAt + HIT_DISPLAY_MS,
  );
  const resolvedMt = getActorBySlot(hitSnapshot, 'MT');

  assert.equal(hitTelegraphs.length, 2);
  assert.equal(AOE_RADIUS, 6);
  assert.ok(hitTelegraphs.every((mechanic) => mechanic.radius === 6));
  assert.equal(FIRE_DEATH_SOURCE, '地火');
  assert.equal(resolvedMt.alive, false);
  assert.equal(resolvedMt.deathReason, FIRE_DEATH_SOURCE);
});
