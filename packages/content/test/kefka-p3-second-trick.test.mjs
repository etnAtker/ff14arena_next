import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '@ff14arena/core';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { getBattleDefinition } from '../src/index.ts';
import { KEFKA_P3_SECOND_TRICK_TESTING } from '../src/battles/kefka-p3-second-trick.ts';

const {
  ZERO_AT,
  TELEGRAPH_MS,
  FIRST_TARGET_STATUS_ID,
  SECOND_TARGET_STATUS_ID,
  THIRD_TARGET_STATUS_ID,
  CHAOS_EARTH_STATUS_ID,
  VOID_EROSION_1_STATUS_ID,
  BLACK_HOLE_SHOT_DELAY_MS,
  calculateSlapAoeCenter,
} = KEFKA_P3_SECOND_TRICK_TESTING;

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

function createKefkaP3SecondSimulation() {
  const battle = getBattleDefinition('kefka_p3_second_trick');
  assert.ok(battle);

  const simulation = createSimulation();
  simulation.loadBattle({
    battle,
    roomId: 'kefka-p3-second-trick-test-room',
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

function getActorById(snapshot, actorId) {
  const actor = snapshot.actors.find((candidate) => candidate.id === actorId);
  assert.ok(actor);

  return actor;
}

function hasStatus(actor, statusId) {
  return actor.statuses.some((status) => status.id === statusId);
}

function submitPose(simulation, actor, position, facing = actor.facing) {
  simulation.submitActorControlFrame({
    actorId: actor.id,
    issuedAt: simulation.getSnapshot().timeMs,
    pose: {
      position,
      facing,
      moveState: {
        direction: { x: 0, y: 0 },
        moving: false,
      },
    },
  });
}

function getDistance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function normalizeAngle(angle) {
  const normalized = angle % (Math.PI * 2);

  return normalized < 0 ? normalized + Math.PI * 2 : normalized;
}

function getAngleDiff(left, right) {
  const diff = Math.abs(normalizeAngle(left) - normalizeAngle(right)) % (Math.PI * 2);

  return diff > Math.PI ? Math.PI * 2 - diff : diff;
}

function getFacing(source, target) {
  return Math.atan2(target.y - source.y, target.x - source.x);
}

function assertClosePoint(actual, expected) {
  assert.ok(
    getDistance(actual, expected) < 0.001,
    `expected ${JSON.stringify(actual)} close to ${JSON.stringify(expected)}`,
  );
}

function assertCloseAngle(actual, expected) {
  assert.ok(
    getAngleDiff(actual, expected) < 0.001,
    `expected angle ${actual} close to ${expected}`,
  );
}

test('凯夫卡P3二运会注册到战斗列表', () => {
  const battle = getBattleDefinition('kefka_p3_second_trick');

  assert.ok(battle);
  assert.equal(battle.name, '凯夫卡P3：二运');
  assert.equal(battle.bossTargetRingRadius, 0);
});

test('地震结束后分配三组目标和混沌之土', () => {
  withMockedRandom(createSeededRandomValues(11, 64), () => {
    const simulation = createKefkaP3SecondSimulation();

    advanceTo(simulation, ZERO_AT);

    const snapshot = simulation.getSnapshot();
    const firstTargets = snapshot.actors.filter((actor) =>
      hasStatus(actor, FIRST_TARGET_STATUS_ID),
    );
    const secondTargets = snapshot.actors.filter((actor) =>
      hasStatus(actor, SECOND_TARGET_STATUS_ID),
    );
    const thirdTargets = snapshot.actors.filter((actor) =>
      hasStatus(actor, THIRD_TARGET_STATUS_ID),
    );
    const earthTargets = snapshot.actors.filter((actor) => hasStatus(actor, CHAOS_EARTH_STATUS_ID));

    assert.equal(firstTargets.length, 3);
    assert.equal(secondTargets.length, 3);
    assert.equal(thirdTargets.length, 2);
    assert.equal(earthTargets.length, 8);
    assert.ok(
      firstTargets.every((actor) =>
        actor.statuses.some((status) => status.expiresAt === ZERO_AT + 72_000),
      ),
    );
    assert.ok(
      secondTargets.every((actor) =>
        actor.statuses.some((status) => status.expiresAt === ZERO_AT + 106_000),
      ),
    );
    assert.ok(
      thirdTargets.every((actor) =>
        actor.statuses.some((status) => status.expiresAt === ZERO_AT + 139_000),
      ),
    );
  });
});

test('第一次黑洞生成固定源连线并提前显示射线预兆', () => {
  withMockedRandom(createSeededRandomValues(22, 128), () => {
    const simulation = createKefkaP3SecondSimulation();
    const blackHoleSpawnAt = ZERO_AT + 16_500 + 2_700;
    const firstShotAt = blackHoleSpawnAt + BLACK_HOLE_SHOT_DELAY_MS;

    advanceTo(simulation, blackHoleSpawnAt);

    const spawnedSnapshot = simulation.getSnapshot();
    const blackHoles = spawnedSnapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '黑洞',
    );
    const tethers = spawnedSnapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'tether' && mechanic.label === '黑洞连线',
    );

    assert.equal(blackHoles.length, 3);
    assert.equal(tethers.length, 1);
    assert.ok(tethers[0].sourcePosition);

    const tetherTargetId = tethers[0].targetId;

    advanceTo(simulation, firstShotAt - TELEGRAPH_MS);

    const telegraphSnapshot = simulation.getSnapshot();
    assert.ok(
      telegraphSnapshot.mechanics.some(
        (mechanic) => mechanic.kind === 'rectangleTelegraph' && mechanic.label === '黑洞射线',
      ),
    );

    advanceTo(simulation, firstShotAt);

    const target = getActorById(simulation.getSnapshot(), tetherTargetId);
    assert.equal(hasStatus(target, VOID_EROSION_1_STATUS_ID), true);
  });
});

test('诅咒敕令与响亮亮耳光可以同时显示读条', () => {
  withMockedRandom(createSeededRandomValues(33, 128), () => {
    const simulation = createKefkaP3SecondSimulation();

    advanceTo(simulation, ZERO_AT + 41_300);

    const castBars = simulation.getSnapshot().hud.bossCastBars;
    assert.ok(castBars.some((cast) => cast.actionName === '诅咒敕令'));
    assert.ok(castBars.some((cast) => cast.actionName === '响亮亮耳光'));
  });
});

test('诅咒敕令读条开始时随机锁定玩家方向', () => {
  withMockedRandom(
    Array.from({ length: 512 }, () => 0.13),
    () => {
      const simulation = createKefkaP3SecondSimulation();

      advanceTo(simulation, ZERO_AT + 39_850);

      let snapshot = simulation.getSnapshot();
      const st = snapshot.actors.find((actor) => actor.slot === 'ST');
      const d4 = snapshot.actors.find((actor) => actor.slot === 'D4');
      assert.ok(st);
      assert.ok(d4);

      submitPose(simulation, st, { x: 0, y: 12 });
      submitPose(simulation, d4, { x: 12, y: 0 });
      simulation.tick(50);

      snapshot = simulation.getSnapshot();
      const locked = snapshot.scriptState[`kefkaP3Second:curse:${ZERO_AT + 39_900}`];
      assert.ok(locked);
      assert.equal(locked.targetId, d4.id);
      assertCloseAngle(locked.direction, getFacing(locked.center, { x: 12, y: 0 }));
    },
  );
});

test('小Boss读条锁定期间仍保留场地标记', () => {
  withMockedRandom(createSeededRandomValues(44, 128), () => {
    const simulation = createKefkaP3SecondSimulation();

    advanceTo(simulation, ZERO_AT + 32_500);

    const thunderSnapshot = simulation.getSnapshot();
    assert.ok(
      thunderSnapshot.mechanics.some(
        (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '艾克斯迪斯',
      ),
    );

    advanceTo(simulation, ZERO_AT + 41_500);

    const curseSnapshot = simulation.getSnapshot();
    assert.ok(
      curseSnapshot.mechanics.some(
        (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '卡奥斯',
      ),
    );
  });
});

test('小Boss重定位复用稳定场地标记', () => {
  withMockedRandom(createSeededRandomValues(55, 128), () => {
    const simulation = createKefkaP3SecondSimulation();

    advanceTo(simulation, 50);

    const initialSnapshot = simulation.getSnapshot();
    const initialChaos = initialSnapshot.mechanics.find(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '卡奥斯',
    );
    const initialExdeath = initialSnapshot.mechanics.find(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '艾克斯迪斯',
    );
    assert.ok(initialChaos);
    assert.ok(initialExdeath);

    advanceTo(simulation, 2_050);

    const movedSnapshot = simulation.getSnapshot();
    const chaosMarkers = movedSnapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '卡奥斯',
    );
    const exdeathMarkers = movedSnapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '艾克斯迪斯',
    );

    assert.equal(chaosMarkers.length, 1);
    assert.equal(exdeathMarkers.length, 1);
    assert.equal(chaosMarkers[0].id, initialChaos.id);
    assert.equal(exdeathMarkers[0].id, initialExdeath.id);
  });
});

test('响亮亮耳光刀圈以场中为基准按凯夫卡方向旋转', () => {
  assertClosePoint(calculateSlapAoeCenter({ x: 0, y: -25 }, 'right', -10), {
    x: -10,
    y: -10,
  });
  assertClosePoint(calculateSlapAoeCenter({ x: 0, y: -25 }, 'left', 10), {
    x: 10,
    y: 10,
  });
  assertClosePoint(calculateSlapAoeCenter({ x: 25, y: 0 }, 'right', 0), {
    x: 0,
    y: -10,
  });
});
