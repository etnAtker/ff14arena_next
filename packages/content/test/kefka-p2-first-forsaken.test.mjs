import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '@ff14arena/core';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { KEFKA_P2_FIRST_FORSAKEN_TESTING } from '../src/battles/kefka-p2-first-forsaken.ts';
import { getBattleBotController, getBattleDefinition } from '../src/index.ts';
import { createPoseTowards } from '../src/runtime/bot.ts';

const INITIAL_MARKER_AT = 9_700;
const FIRST_TOWER_SPAWN_AT = 12_700;
const FIRST_TOWER_RESOLVE_AT = 22_700;
const SECOND_TOWER_RESOLVE_AT = 32_700;
const FIRST_FOOT_CAST_AT = 38_000;
const FIRST_FOOT_TELEGRAPH_AT = 42_200;
const MARKER_EXPIRED_AT = 14_750;

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

function createSeededRandomValues(seed, count) {
  return Array.from({ length: count }, (_, index) => {
    const value = Math.sin(seed * 1000 + index * 9973) * 10000;

    return value - Math.floor(value);
  });
}

function createKefkaSimulation() {
  const battle = getBattleDefinition('kefka_p2_first_forsaken');
  assert.ok(battle);

  const simulation = createSimulation();
  simulation.loadBattle({
    battle,
    roomId: 'kefka-p2-first-forsaken-test-room',
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

function getActiveMarkers(snapshot) {
  return snapshot.scriptState['kefka:activeMarkers'];
}

function getMarkerPool(snapshot) {
  return snapshot.scriptState['kefka:markerPool'];
}

function getTowerRounds(snapshot) {
  return snapshot.scriptState['kefka:towerRounds'];
}

function countValues(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;

    return counts;
  }, {});
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

function moveAllActorsToSafePoint(simulation, snapshot, towerPositions) {
  const safeAngle = Math.atan2(
    -(towerPositions[0].y + towerPositions[1].y),
    -(towerPositions[0].x + towerPositions[1].x),
  );
  const safePoint = pointOnRadius(safeAngle, 16);

  for (const [index, actor] of snapshot.actors.entries()) {
    submitPose(simulation, actor, offsetPoint(safePoint, index * 0.1, 0));
  }
}

function offsetPoint(center, xOffset, yOffset) {
  return {
    x: center.x + xOffset,
    y: center.y + yOffset,
  };
}

function pointOnRadius(angle, radius) {
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

function pointDistance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function assertPointClose(actual, expected) {
  assert.ok(
    pointDistance(actual, expected) <= 0.0001,
    `${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`,
  );
}

function createTestActor(position, slot = 'MT') {
  return {
    id: `test_actor_${slot}`,
    name: `测试玩家${slot}`,
    slot,
    kind: 'player',
    position,
    facing: 0,
    hp: 10000,
    maxHp: 10000,
    alive: true,
    statuses: [],
  };
}

function createTestActors(position = { x: 0, y: 0 }) {
  return PARTY_SLOT_ORDER.map((slot) => createTestActor(position, slot));
}

function getTestActorId(slot) {
  return `test_actor_${slot}`;
}

test('全局 Bot 目标移动会在一步内精确落点，避免越点抖动', () => {
  const target = { x: 0.12, y: 0 };
  const pose = createPoseTowards(createTestActor({ x: 0, y: 0 }), target, 0);

  assert.deepEqual(pose.position, target);
  assert.deepEqual(pose.moveState.direction, { x: 0, y: 0 });
  assert.equal(pose.moveState.moving, false);
});

test('凯夫卡一运：扇形头标为90度', () => {
  assert.equal(KEFKA_P2_FIRST_FORSAKEN_TESTING.FAN_ANGLE, Math.PI / 2);
});

test('凯夫卡一运首次点名消耗点名池且视觉头标独立过期', () => {
  withMockedRandom(createSeededRandomValues(1, 100), () => {
    const simulation = createKefkaSimulation();

    advanceTo(simulation, INITIAL_MARKER_AT);

    const snapshot = simulation.getSnapshot();
    const activeMarkers = getActiveMarkers(snapshot);
    const markerPool = getMarkerPool(snapshot);
    const actorMarkers = snapshot.mechanics.filter((mechanic) => mechanic.kind === 'actorMarker');

    assert.deepEqual(countValues(Object.values(activeMarkers)), {
      share: 2,
      largeCircle: 3,
      fan: 3,
    });
    assert.deepEqual(markerPool, {
      share: 6,
      largeCircle: 9,
      fan: 9,
    });
    assert.deepEqual(countValues(actorMarkers.map((marker) => marker.markerShape)), {
      stackArrows: 2,
      circleDot: 3,
      fanSector: 3,
    });
    assert.ok(actorMarkers.every((marker) => marker.showLabel === false));

    advanceTo(simulation, MARKER_EXPIRED_AT);

    const expiredSnapshot = simulation.getSnapshot();
    assert.equal(
      expiredSnapshot.mechanics.filter((mechanic) => mechanic.kind === 'actorMarker').length,
      0,
    );
    assert.deepEqual(getActiveMarkers(expiredSnapshot), activeMarkers);
  });
});

test('凯夫卡一运：完整重开局不会继承上一局脚本状态', () => {
  withMockedRandom(createSeededRandomValues(11, 100), () => {
    const battle = getBattleDefinition('kefka_p2_first_forsaken');
    assert.ok(battle);

    const simulation = createKefkaSimulation();
    advanceTo(simulation, INITIAL_MARKER_AT);

    const previousSnapshot = simulation.getSnapshot();
    assert.ok(previousSnapshot.scriptState['kefka:activeMarkers']);

    simulation.stop();
    simulation.loadBattle({
      battle,
      roomId: 'kefka-p2-first-forsaken-test-room',
      party: PARTY_SLOT_ORDER.map((slot) => ({
        slot,
        name: slot,
        kind: 'player',
        actorId: `player_${slot}`,
      })),
      sourceSnapshot: previousSnapshot,
      resetAllActors: true,
      keepTimeMs: false,
    });

    assert.deepEqual(simulation.getSnapshot().scriptState, {});
  });
});

test('凯夫卡一运塔位首轮为90度，后续每轮固定方向旋转45度', () => {
  withMockedRandom(createSeededRandomValues(2, 100), () => {
    const simulation = createKefkaSimulation();

    advanceTo(simulation, FIRST_TOWER_SPAWN_AT);

    const snapshot = simulation.getSnapshot();
    const towerRounds = getTowerRounds(snapshot);
    const activeTowers = snapshot.mechanics.filter((mechanic) => mechanic.kind === 'tower');

    assert.equal(towerRounds.length, 8);
    assert.equal(activeTowers.length, 2);

    const firstDiff = Math.abs(towerRounds[0].towerIndexes[0] - towerRounds[0].towerIndexes[1]);
    assert.ok(firstDiff === 2 || firstDiff === 6);

    const direction =
      (towerRounds[1].towerIndexes[0] - towerRounds[0].towerIndexes[0] + 8) % 8 === 1 ? 1 : -1;

    for (let index = 1; index < towerRounds.length; index += 1) {
      const previousRound = towerRounds[index - 1];
      const currentRound = towerRounds[index];
      assert.equal(
        (currentRound.towerIndexes[0] - previousRound.towerIndexes[0] + 8) % 8,
        direction === 1 ? 1 : 7,
      );
      assert.equal(
        (currentRound.towerIndexes[1] - previousRound.towerIndexes[1] + 8) % 8,
        direction === 1 ? 1 : 7,
      );
    }
  });
});

test('凯夫卡一运塔少于2人时记录失败，单人塔玩家死亡', () => {
  withMockedRandom(createSeededRandomValues(3, 100), () => {
    const simulation = createKefkaSimulation();

    advanceTo(simulation, FIRST_TOWER_RESOLVE_AT - 600);

    const snapshot = simulation.getSnapshot();
    const towerRound = getTowerRounds(snapshot)[0];
    const tower = towerRound.towerPositions[0];
    const mt = getActorBySlot(snapshot, 'MT');

    moveAllActorsToSafePoint(simulation, snapshot, towerRound.towerPositions);
    submitPose(simulation, mt, tower);
    advanceTo(simulation, FIRST_TOWER_RESOLVE_AT);

    const resolvedSnapshot = simulation.getSnapshot();
    const resolvedMt = getActorBySlot(resolvedSnapshot, 'MT');

    assert.equal(resolvedMt.alive, false);
    assert.ok(resolvedSnapshot.failureReasons.includes('第 1 轮塔人数不足'));
    assert.equal(resolvedMt.deathReason, '塔人数不足');
  });
});

test('凯夫卡一运塔多于2人时只消耗随机选中的2人点名', () => {
  withMockedRandom(createSeededRandomValues(4, 200), () => {
    const simulation = createKefkaSimulation();

    advanceTo(simulation, FIRST_TOWER_RESOLVE_AT - 600);

    const snapshot = simulation.getSnapshot();
    const towerRound = getTowerRounds(snapshot)[0];
    const tower = towerRound.towerPositions[0];
    const towerSlots = ['MT', 'ST', 'H1'];

    moveAllActorsToSafePoint(simulation, snapshot, towerRound.towerPositions);
    for (const [index, slot] of towerSlots.entries()) {
      submitPose(simulation, getActorBySlot(snapshot, slot), offsetPoint(tower, index * 0.4, 0));
    }

    advanceTo(simulation, FIRST_TOWER_RESOLVE_AT);

    const resolvedSnapshot = simulation.getSnapshot();
    const markerPool = getMarkerPool(resolvedSnapshot);

    assert.deepEqual(markerPool, {
      share: 6,
      largeCircle: 7,
      fan: 9,
    });
  });
});

test('凯夫卡一运机制伤害命中已有易伤玩家时即死', () => {
  withMockedRandom(createSeededRandomValues(5, 300), () => {
    const simulation = createKefkaSimulation();

    advanceTo(simulation, FIRST_TOWER_RESOLVE_AT - 600);

    const snapshot = simulation.getSnapshot();
    const activeMarkers = getActiveMarkers(snapshot);
    const largeCircleSlots = snapshot.actors
      .filter((actor) => activeMarkers[actor.id] === 'largeCircle')
      .map((actor) => actor.slot);

    assert.ok(largeCircleSlots.length >= 2);

    const towerRounds = getTowerRounds(snapshot);
    const firstTower = towerRounds[0].towerPositions[0];
    const secondTower = towerRounds[0].towerPositions[1];
    const firstLarge = getActorBySlot(snapshot, largeCircleSlots[0]);
    const secondLarge = getActorBySlot(snapshot, largeCircleSlots[1]);
    const fillerSlots = PARTY_SLOT_ORDER.filter((slot) => !largeCircleSlots.includes(slot)).slice(
      0,
      2,
    );

    moveAllActorsToSafePoint(simulation, snapshot, towerRounds[0].towerPositions);
    submitPose(simulation, firstLarge, offsetPoint(firstTower, -0.2, 0));
    submitPose(simulation, secondLarge, offsetPoint(firstTower, 0.2, 0));
    submitPose(
      simulation,
      getActorBySlot(snapshot, fillerSlots[0]),
      offsetPoint(secondTower, -0.2, 0),
    );
    submitPose(
      simulation,
      getActorBySlot(snapshot, fillerSlots[1]),
      offsetPoint(secondTower, 0.2, 0),
    );

    advanceTo(simulation, FIRST_TOWER_RESOLVE_AT);

    const resolvedSnapshot = simulation.getSnapshot();
    const resolvedLargeActors = [largeCircleSlots[0], largeCircleSlots[1]].map((slot) =>
      getActorBySlot(resolvedSnapshot, slot),
    );

    assert.ok(resolvedLargeActors.some((actor) => !actor.alive));
  });
});

test('凯夫卡一运偶数轮点名生成3个可见小怪并开始4个消灭之脚读条预兆', () => {
  withMockedRandom(createSeededRandomValues(6, 300), () => {
    const simulation = createKefkaSimulation();

    advanceTo(simulation, SECOND_TOWER_RESOLVE_AT - 600);

    const spreadSnapshot = simulation.getSnapshot();

    for (const [index, actor] of spreadSnapshot.actors.entries()) {
      submitPose(simulation, actor, pointOnRadius((Math.PI * 2 * index) / 8, 12));
    }

    advanceTo(simulation, SECOND_TOWER_RESOLVE_AT - 500);

    const nearTelegraphSnapshot = simulation.getSnapshot();
    const nearTelegraphs = nearTelegraphSnapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'circleTelegraph' && mechanic.label === '终结点名',
    );

    assert.equal(nearTelegraphs.length, 4);
    assert.ok(nearTelegraphs.every((telegraph) => telegraph.radius === 5));

    advanceTo(simulation, SECOND_TOWER_RESOLVE_AT);

    const addSnapshot = simulation.getSnapshot();
    const fieldMarkers = addSnapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'fieldMarker',
    );
    const damagedActors = addSnapshot.actors.filter(
      (actor) => actor.lastDamageSource === '终结点名',
    );

    assert.equal(fieldMarkers.length, 3);
    assert.ok(fieldMarkers.every((marker) => marker.showLabel === false));
    assert.ok(
      fieldMarkers.every((marker) => {
        const markerDistance = Math.hypot(marker.center.x, marker.center.y);

        return Math.abs(markerDistance - 8) <= 0.0001;
      }),
    );
    assert.ok(damagedActors.length >= 4);

    advanceTo(simulation, FIRST_FOOT_CAST_AT);

    const footCastSnapshot = simulation.getSnapshot();

    assert.equal(footCastSnapshot.boss.castBar?.actionName, '消灭之脚');
    assert.equal(
      footCastSnapshot.mechanics.filter(
        (mechanic) => mechanic.kind === 'fanTelegraph' && mechanic.label === '消灭之脚',
      ).length,
      0,
    );

    advanceTo(simulation, FIRST_FOOT_TELEGRAPH_AT);

    const footTelegraphSnapshot = simulation.getSnapshot();
    const footTelegraphs = footTelegraphSnapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'fanTelegraph' && mechanic.label === '消灭之脚',
    );

    assert.equal(footTelegraphs.length, 4);
    assert.ok(footTelegraphs.every((telegraph) => telegraph.angle === Math.PI));
    assert.ok(footTelegraphs.every((telegraph) => telegraph.radius === 20));
  });
});

test('凯夫卡一运：目标圈内近场点名会让小怪生成在Boss位置', () => {
  withMockedRandom(createSeededRandomValues(7, 300), () => {
    const simulation = createKefkaSimulation();

    advanceTo(simulation, SECOND_TOWER_RESOLVE_AT - 600);

    const snapshot = simulation.getSnapshot();

    for (const [index, actor] of snapshot.actors.entries()) {
      submitPose(simulation, actor, pointOnRadius((Math.PI * 2 * index) / 8, 2));
    }

    advanceTo(simulation, SECOND_TOWER_RESOLVE_AT);

    const fieldMarkers = simulation
      .getSnapshot()
      .mechanics.filter((mechanic) => mechanic.kind === 'fieldMarker');

    assert.equal(fieldMarkers.length, 3);
    assert.ok(
      fieldMarkers.every((marker) => Math.hypot(marker.center.x, marker.center.y) <= 0.0001),
    );
  });
});

test('凯夫卡一运：固定路线 Bot controller 已登记', () => {
  const controller = getBattleBotController('kefka_p2_first_forsaken');

  assert.ok(controller);
});

test('凯夫卡一运：Bot 初始站位按左右上下四组横排', () => {
  const positions = KEFKA_P2_FIRST_FORSAKEN_TESTING.INITIAL_SOUTH_POSITIONS;

  assert.deepEqual(positions.MT, { x: -12, y: -4 });
  assert.deepEqual(positions.H1, { x: -8, y: -4 });
  assert.deepEqual(positions.D1, { x: -12, y: 4 });
  assert.deepEqual(positions.D3, { x: -8, y: 4 });
  assert.deepEqual(positions.ST, { x: 8, y: -4 });
  assert.deepEqual(positions.H2, { x: 12, y: -4 });
  assert.deepEqual(positions.D2, { x: 8, y: 4 });
  assert.deepEqual(positions.D4, { x: 12, y: 4 });
  assert.equal(pointDistance(positions.MT, positions.H1), 4);
  assert.equal(pointDistance(positions.D1, positions.D3), 4);
  assert.equal(pointDistance(positions.ST, positions.H2), 4);
  assert.equal(pointDistance(positions.D2, positions.D4), 4);
});

test('凯夫卡一运：首次分摊所在双人小组决定1238组', () => {
  const actors = Object.fromEntries(
    PARTY_SLOT_ORDER.map((slot) => [slot, createTestActor({ x: 0, y: 0 }, slot)]),
  );
  const groups = KEFKA_P2_FIRST_FORSAKEN_TESTING.createInitialBotGroups([
    [actors.MT, 'share'],
    [actors.D4, 'share'],
    [actors.ST, 'largeCircle'],
    [actors.H1, 'largeCircle'],
    [actors.H2, 'largeCircle'],
    [actors.D1, 'fan'],
    [actors.D2, 'fan'],
    [actors.D3, 'fan'],
  ]);

  assert.deepEqual(groups.a, ['MT', 'H1', 'D2', 'D4']);
  assert.deepEqual(groups.b, ['ST', 'H2', 'D1', 'D3']);
});

test('凯夫卡一运：初始点名后按1238左半场、4567右半场换位', () => {
  const groups = {
    a: ['MT', 'H1', 'D2', 'D4'],
    b: ['ST', 'H2', 'D1', 'D3'],
  };

  assert.deepEqual(KEFKA_P2_FIRST_FORSAKEN_TESTING.getInitialGroupStagingTarget('MT', groups), {
    x: -12,
    y: -4,
  });
  assert.deepEqual(KEFKA_P2_FIRST_FORSAKEN_TESTING.getInitialGroupStagingTarget('H1', groups), {
    x: -8,
    y: -4,
  });
  assert.deepEqual(KEFKA_P2_FIRST_FORSAKEN_TESTING.getInitialGroupStagingTarget('D2', groups), {
    x: -12,
    y: 4,
  });
  assert.deepEqual(KEFKA_P2_FIRST_FORSAKEN_TESTING.getInitialGroupStagingTarget('D4', groups), {
    x: -8,
    y: 4,
  });
  assert.deepEqual(KEFKA_P2_FIRST_FORSAKEN_TESTING.getInitialGroupStagingTarget('ST', groups), {
    x: 8,
    y: -4,
  });
  assert.deepEqual(KEFKA_P2_FIRST_FORSAKEN_TESTING.getInitialGroupStagingTarget('H2', groups), {
    x: 12,
    y: -4,
  });
  assert.deepEqual(KEFKA_P2_FIRST_FORSAKEN_TESTING.getInitialGroupStagingTarget('D1', groups), {
    x: 8,
    y: 4,
  });
  assert.deepEqual(KEFKA_P2_FIRST_FORSAKEN_TESTING.getInitialGroupStagingTarget('D3', groups), {
    x: 12,
    y: 4,
  });
});

test('凯夫卡一运：新跑法按奇偶轮、左右来源和职能分配塔窗口站位', () => {
  const northAngle = -Math.PI / 2;
  const ringStep = Math.PI / 4;
  const towerRing = Array.from({ length: 8 }, (_, index) =>
    pointOnRadius(northAngle + ringStep * index, 8),
  );
  const actors = createTestActors();
  const oddGroupSlotsByMarker = {
    share: ['MT', 'D1'],
    largeCircle: ['D2'],
    fan: ['H1'],
  };
  const oddOtherGroupSlots = ['ST', 'H2', 'D3', 'D4'];
  const oddMarkerSources = {
    [getTestActorId('MT')]: 0,
    [getTestActorId('D1')]: 2,
  };
  const evenGroupSlotsByMarker = {
    share: [],
    largeCircle: ['MT', 'D2'],
    fan: ['H1', 'D4'],
  };
  const evenOtherGroupSlots = ['ST', 'H2', 'D1', 'D3'];
  const evenMarkerSources = {
    [getTestActorId('H1')]: 1,
    [getTestActorId('D4')]: 2,
    [getTestActorId('MT')]: 0,
    [getTestActorId('D2')]: 3,
  };

  for (const pairDirection of [2, -2]) {
    for (let index = 0; index < towerRing.length; index += 1) {
      const towerPositions = [
        towerRing[index],
        towerRing[(index + pairDirection + towerRing.length) % towerRing.length],
      ];
      const positionSet = KEFKA_P2_FIRST_FORSAKEN_TESTING.getBotTowerPositionSet({
        index: 1,
        spawnAt: 0,
        resolveAt: 10_000,
        towerIndexes: [index, (index + pairDirection + towerRing.length) % towerRing.length],
        towerPositions,
      });
      const oddTargets = Object.fromEntries(
        PARTY_SLOT_ORDER.map((slot) => [
          slot,
          KEFKA_P2_FIRST_FORSAKEN_TESTING.getOddRoundBotTarget(
            slot,
            oddGroupSlotsByMarker,
            oddOtherGroupSlots,
            actors,
            oddMarkerSources,
            positionSet.odd,
          ),
        ]),
      );
      const evenTargets = Object.fromEntries(
        PARTY_SLOT_ORDER.map((slot) => [
          slot,
          KEFKA_P2_FIRST_FORSAKEN_TESTING.getEvenRoundBotTarget(
            slot,
            evenGroupSlotsByMarker,
            evenOtherGroupSlots,
            actors,
            evenMarkerSources,
            positionSet.even,
          ),
        ]),
      );

      assert.ok(Object.values(oddTargets).every((target) => target !== null));
      assert.ok(Object.values(evenTargets).every((target) => target !== null));
      assert.ok(pointDistance(oddTargets.MT, positionSet.leftTower) <= 4);
      assert.ok(pointDistance(oddTargets.H1, positionSet.leftTower) <= 4);
      assert.ok(pointDistance(oddTargets.D1, positionSet.rightTower) <= 4);
      assert.ok(pointDistance(oddTargets.D2, positionSet.rightTower) <= 4);
      assert.ok(pointDistance(oddTargets.ST, positionSet.leftTower) > 4);
      assert.ok(pointDistance(oddTargets.H2, positionSet.leftTower) > 4);
      assert.ok(pointDistance(oddTargets.D3, positionSet.rightTower) > 4);
      assert.ok(pointDistance(oddTargets.D4, positionSet.rightTower) > 4);
      assert.ok(pointDistance(evenTargets.H1, positionSet.leftTower) <= 4);
      assert.ok(pointDistance(evenTargets.MT, positionSet.leftTower) <= 4);
      assert.ok(pointDistance(evenTargets.D4, positionSet.rightTower) <= 4);
      assert.ok(pointDistance(evenTargets.D2, positionSet.rightTower) <= 4);
      assert.ok(Math.abs(pointDistance(evenTargets.ST, { x: 0, y: 0 }) - 5) <= 0.0001);
      assert.ok(pointDistance(evenTargets.D3, positionSet.rightTower) > 4);
      assert.ok(Math.abs(pointDistance(evenTargets.D1, { x: 0, y: 0 }) - 5) <= 0.0001);
    }
  }
});

test('凯夫卡一运：固定塔型坐标表覆盖8种双塔组合', () => {
  const positionSets = KEFKA_P2_FIRST_FORSAKEN_TESTING.BOT_TOWER_POSITION_SETS;

  assert.deepEqual(Object.keys(positionSets).sort(), [
    '0:2',
    '0:6',
    '1:3',
    '1:7',
    '2:4',
    '3:5',
    '4:6',
    '5:7',
  ]);

  for (const positions of Object.values(positionSets)) {
    assert.ok(Math.abs(pointDistance(positions.leftTower, positions.odd.leftShare) - 2) <= 0.0001);
    assert.ok(Math.abs(pointDistance(positions.leftTower, positions.odd.idleTank) - 4.5) <= 0.0001);
    assert.ok(Math.abs(pointDistance(positions.leftTower, positions.odd.fan) - 3) <= 0.0001);
    assert.ok(
      Math.abs(pointDistance(positions.leftTower, positions.odd.idleHealer) - 4.5) <= 0.0001,
    );
    assert.ok(
      Math.abs(pointDistance(positions.rightTower, positions.odd.rightLargeCircle) - 3.5) <= 0.0001,
    );
    assert.ok(
      Math.abs(pointDistance(positions.rightTower, positions.odd.rightShare) - 3.5) <= 0.0001,
    );
    assert.ok(
      Math.abs(pointDistance(positions.rightTower, positions.even.rightFan) - 3.5) <= 0.0001,
    );
    assert.ok(
      Math.abs(pointDistance(positions.rightTower, positions.even.rightLargeCircle) - 3.5) <=
        0.0001,
    );
  }
});

test('凯夫卡一运：同塔内踩塔来源按固定处理点分左右', () => {
  const positionSet = KEFKA_P2_FIRST_FORSAKEN_TESTING.getBotTowerPositionSet({
    index: 1,
    spawnAt: 0,
    resolveAt: 10_000,
    towerIndexes: [4, 2],
    towerPositions: [
      { x: 0, y: 8 },
      { x: 8, y: 0 },
    ],
  });
  const handlers = [
    createTestActor(positionSet.odd.leftShare, 'MT'),
    createTestActor(positionSet.odd.fan, 'H1'),
    createTestActor(positionSet.odd.rightShare, 'D1'),
    createTestActor(positionSet.odd.rightLargeCircle, 'D2'),
  ];
  const handlerSources = KEFKA_P2_FIRST_FORSAKEN_TESTING.createHandlerSources(
    handlers,
    KEFKA_P2_FIRST_FORSAKEN_TESTING.getOddHandlerSourceReferences(positionSet.odd),
  );

  assert.deepEqual(handlerSources, {
    [getTestActorId('MT')]: 0,
    [getTestActorId('H1')]: 1,
    [getTestActorId('D1')]: 2,
    [getTestActorId('D2')]: 3,
  });
});

test('凯夫卡一运：同点名左右按来源点排序，不按来源塔压缩', () => {
  const actors = createTestActors();
  const positionSet = KEFKA_P2_FIRST_FORSAKEN_TESTING.getBotTowerPositionSet({
    index: 1,
    spawnAt: 0,
    resolveAt: 10_000,
    towerIndexes: [4, 2],
    towerPositions: [
      { x: 0, y: 8 },
      { x: 8, y: 0 },
    ],
  });
  const sameTowerTargets = {
    MT: KEFKA_P2_FIRST_FORSAKEN_TESTING.getOddRoundBotTarget(
      'MT',
      { share: ['MT', 'H1'], largeCircle: ['D2'], fan: ['D1'] },
      ['ST', 'H2', 'D3', 'D4'],
      actors,
      {
        [getTestActorId('MT')]: 0,
        [getTestActorId('H1')]: 1,
      },
      positionSet.odd,
    ),
    H1: KEFKA_P2_FIRST_FORSAKEN_TESTING.getOddRoundBotTarget(
      'H1',
      { share: ['MT', 'H1'], largeCircle: ['D2'], fan: ['D1'] },
      ['ST', 'H2', 'D3', 'D4'],
      actors,
      {
        [getTestActorId('MT')]: 0,
        [getTestActorId('H1')]: 1,
      },
      positionSet.odd,
    ),
  };
  const crossTowerTargets = {
    MT: KEFKA_P2_FIRST_FORSAKEN_TESTING.getOddRoundBotTarget(
      'MT',
      { share: ['MT', 'D1'], largeCircle: ['D2'], fan: ['H1'] },
      ['ST', 'H2', 'D3', 'D4'],
      actors,
      {
        [getTestActorId('MT')]: 0,
        [getTestActorId('D1')]: 2,
      },
      positionSet.odd,
    ),
    D1: KEFKA_P2_FIRST_FORSAKEN_TESTING.getOddRoundBotTarget(
      'D1',
      { share: ['MT', 'D1'], largeCircle: ['D2'], fan: ['H1'] },
      ['ST', 'H2', 'D3', 'D4'],
      actors,
      {
        [getTestActorId('MT')]: 0,
        [getTestActorId('D1')]: 2,
      },
      positionSet.odd,
    ),
  };

  assertPointClose(sameTowerTargets.MT, positionSet.odd.leftShare);
  assertPointClose(sameTowerTargets.H1, positionSet.odd.rightShare);
  assertPointClose(crossTowerTargets.MT, positionSet.odd.leftShare);
  assertPointClose(crossTowerTargets.D1, positionSet.odd.rightShare);
});

test('凯夫卡一运：正点双塔时固定点位不额外旋转且左右正确', () => {
  const actors = createTestActors();
  const towerPositions = [
    { x: 0, y: 8 },
    { x: 8, y: 0 },
  ];
  const positionSet = KEFKA_P2_FIRST_FORSAKEN_TESTING.getBotTowerPositionSet({
    index: 1,
    spawnAt: 0,
    resolveAt: 10_000,
    towerIndexes: [4, 2],
    towerPositions,
  });
  const oddTargets = Object.fromEntries(
    PARTY_SLOT_ORDER.map((slot) => [
      slot,
      KEFKA_P2_FIRST_FORSAKEN_TESTING.getOddRoundBotTarget(
        slot,
        {
          share: ['MT', 'D1'],
          largeCircle: ['D2'],
          fan: ['H1'],
        },
        ['ST', 'H2', 'D3', 'D4'],
        actors,
        {
          [getTestActorId('MT')]: 0,
          [getTestActorId('D1')]: 2,
        },
        positionSet.odd,
      ),
    ]),
  );
  const evenTargets = Object.fromEntries(
    PARTY_SLOT_ORDER.map((slot) => [
      slot,
      KEFKA_P2_FIRST_FORSAKEN_TESTING.getEvenRoundBotTarget(
        slot,
        {
          share: [],
          largeCircle: ['MT', 'D2'],
          fan: ['H1', 'D4'],
        },
        ['ST', 'H2', 'D1', 'D3'],
        actors,
        {
          [getTestActorId('H1')]: 1,
          [getTestActorId('D4')]: 2,
          [getTestActorId('MT')]: 0,
          [getTestActorId('D2')]: 3,
        },
        positionSet.even,
      ),
    ]),
  );
  const idleOffset = 4.5 / Math.SQRT2;

  assertPointClose(positionSet.leftTower, { x: 0, y: 8 });
  assertPointClose(positionSet.rightTower, { x: 8, y: 0 });
  assertPointClose(oddTargets.MT, { x: -2, y: 8 });
  assertPointClose(oddTargets.ST, { x: -4.5, y: 8 });
  assertPointClose(oddTargets.H1, { x: 3 / Math.SQRT2, y: 8 + 3 / Math.SQRT2 });
  assertPointClose(oddTargets.H2, { x: idleOffset, y: 8 + idleOffset });
  assertPointClose(oddTargets.D2, { x: 8, y: -3.5 });
  assertPointClose(oddTargets.D1, { x: 8, y: 3.5 });
  assertPointClose(oddTargets.D3, { x: 8 - Math.SQRT2, y: 3.5 + Math.SQRT2 });
  assertPointClose(oddTargets.D4, { x: 8 - Math.SQRT2, y: 3.5 + Math.SQRT2 });

  assertPointClose(evenTargets.H1, { x: 0, y: 8 - 3.5 });
  assertPointClose(evenTargets.MT, { x: 0, y: 8 + 3.5 });
  assertPointClose(evenTargets.H2, { x: -4.5, y: 8 });
  assertPointClose(evenTargets.ST, { x: -5, y: 0 });
  assertPointClose(evenTargets.D4, { x: 8 - 3.5, y: 0 });
  assertPointClose(evenTargets.D2, { x: 8 + 3.5, y: 0 });
  assertPointClose(evenTargets.D3, { x: 8, y: -4.5 });
  assertPointClose(evenTargets.D1, { x: 0, y: -5 });
});

test('凯夫卡一运：Bot 点名出现1秒后先分组换位，等塔出现1秒再去踩塔', () => {
  const controller = getBattleBotController('kefka_p2_first_forsaken');
  const actors = createTestActors({ x: 0, y: 13 });
  const actor = actors.find((candidate) => candidate.slot === 'MT');
  const round = {
    index: 1,
    spawnAt: 12_700,
    resolveAt: 22_700,
    towerIndexes: [4, 2],
    towerPositions: [
      { x: 0, y: 8 },
      { x: 8, y: 0 },
    ],
  };
  const baseSnapshot = {
    actors,
    boss: { position: { x: 0, y: 0 } },
    scriptState: {
      'kefka:botGroups': {
        a: ['MT', 'H1', 'D1', 'D2'],
        b: ['ST', 'H2', 'D3', 'D4'],
      },
      'kefka:towerRounds': [round],
      'kefka:activeMarkers': {
        [getTestActorId('MT')]: 'share',
        [getTestActorId('H1')]: 'fan',
        [getTestActorId('D1')]: 'share',
        [getTestActorId('D2')]: 'largeCircle',
      },
      'kefka:botMarkerSources': {
        [getTestActorId('MT')]: 0,
        [getTestActorId('D1')]: 2,
      },
      'kefka:botMarkerAssignedAt': {
        [getTestActorId('MT')]: 9_700,
        [getTestActorId('H1')]: 9_700,
        [getTestActorId('D1')]: 9_700,
        [getTestActorId('D2')]: 9_700,
      },
    },
  };

  assert.ok(controller);
  assert.ok(actor);

  const beforeTowerFrame = controller({
    snapshot: {
      ...baseSnapshot,
      timeMs: 10_699,
    },
    slot: 'MT',
    actor,
  });
  const stagingFrame = controller({
    snapshot: {
      ...baseSnapshot,
      timeMs: 10_700,
    },
    slot: 'MT',
    actor,
  });
  const beforeDelayFrame = controller({
    snapshot: {
      ...baseSnapshot,
      timeMs: 13_699,
    },
    slot: 'MT',
    actor,
  });
  const movingFrame = controller({
    snapshot: {
      ...baseSnapshot,
      timeMs: 13_700,
    },
    slot: 'MT',
    actor,
  });

  assertPointClose(beforeTowerFrame.pose.position, actor.position);
  assertPointClose(beforeTowerFrame.pose.moveState.direction, { x: 0, y: 0 });
  assert.equal(beforeTowerFrame.pose.moveState.moving, false);
  assertPointClose(stagingFrame.pose.moveState.direction, {
    x: -12 / Math.hypot(-12, -4 - 13),
    y: (-4 - 13) / Math.hypot(-12, -4 - 13),
  });
  assertPointClose(beforeDelayFrame.pose.moveState.direction, {
    x: -12 / Math.hypot(-12, -4 - 13),
    y: (-4 - 13) / Math.hypot(-12, -4 - 13),
  });
  assertPointClose(movingFrame.pose.moveState.direction, {
    x: -2 / Math.hypot(-2, 8 - 13),
    y: (8 - 13) / Math.hypot(-2, 8 - 13),
  });
});

test('凯夫卡一运：最后一轮消灭之脚锁定后8个Bot统一按终结类型躲避', () => {
  const controller = getBattleBotController('kefka_p2_first_forsaken');
  const finalRound = {
    index: 8,
    spawnAt: 82_700,
    resolveAt: 92_700,
    towerIndexes: [0, 2],
    towerPositions: [
      { x: 0, y: -8 },
      { x: 8, y: 0 },
    ],
  };

  assert.ok(controller);

  for (const mode of ['future', 'past']) {
    const expectedTarget = KEFKA_P2_FIRST_FORSAKEN_TESTING.getFinalFootDodgeTarget(
      finalRound,
      mode,
    );
    const actors = PARTY_SLOT_ORDER.map((slot) => createTestActor(expectedTarget, slot));
    const snapshot = {
      timeMs: 98_100,
      actors,
      boss: { position: { x: 0, y: 0 } },
      scriptState: {
        'kefka:botGroups': {
          a: ['MT', 'ST', 'H1', 'H2'],
          b: ['D1', 'D2', 'D3', 'D4'],
        },
        'kefka:towerRounds': [finalRound],
        'kefka:terminatorModes': {
          8: mode,
        },
      },
    };

    for (const actor of actors) {
      const frame = controller({ snapshot, slot: actor.slot, actor });

      assert.deepEqual(frame.pose?.position, expectedTarget);
      assert.equal(frame.pose?.moveState.moving, false);
    }
  }
});

test('凯夫卡一运：最后一轮消灭之脚躲避点与引导点同侧或中心对称', () => {
  const finalRound = {
    index: 8,
    spawnAt: 82_700,
    resolveAt: 92_700,
    towerIndexes: [0, 2],
    towerPositions: [
      { x: 0, y: -8 },
      { x: 8, y: 0 },
    ],
  };
  const futureBait = KEFKA_P2_FIRST_FORSAKEN_TESTING.getFootBaitTarget(finalRound, 'future');
  const futureDodge = KEFKA_P2_FIRST_FORSAKEN_TESTING.getFinalFootDodgeTarget(finalRound, 'future');
  const pastBait = KEFKA_P2_FIRST_FORSAKEN_TESTING.getFootBaitTarget(finalRound, 'past');
  const pastDodge = KEFKA_P2_FIRST_FORSAKEN_TESTING.getFinalFootDodgeTarget(finalRound, 'past');

  assert.ok(pointDistance(futureDodge, { x: -futureBait.x, y: -futureBait.y }) <= 0.0001);
  assert.ok(pointDistance(pastDodge, pastBait) <= 0.0001);
});
