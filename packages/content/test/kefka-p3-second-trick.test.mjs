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
  CHAOS_EXPLOSION_CAST_MS,
  THUNDER_CAST_MS,
  TRUE_SELF_LATE_CAST_MS,
  TRUE_SELF_LATE_SPAWN_TO_CAST_MS,
  TRUE_SELF_LENGTH,
  FIRST_TARGET_MARKER_COLOR,
  SECOND_TARGET_MARKER_COLOR,
  THIRD_TARGET_MARKER_COLOR,
  getChaosExplosionDirections,
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

function hasKefkaMarker(snapshot) {
  return snapshot.mechanics.some(
    (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '凯夫卡',
  );
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

test('三组目标会生成对应颜色和编号的头顶标点', () => {
  withMockedRandom(createSeededRandomValues(12, 64), () => {
    const simulation = createKefkaP3SecondSimulation();

    advanceTo(simulation, ZERO_AT);

    const markers = simulation
      .getSnapshot()
      .mechanics.filter((mechanic) => mechanic.kind === 'actorMarker');
    const firstMarkers = markers.filter((marker) => marker.color === FIRST_TARGET_MARKER_COLOR);
    const secondMarkers = markers.filter((marker) => marker.color === SECOND_TARGET_MARKER_COLOR);
    const thirdMarkers = markers.filter((marker) => marker.color === THIRD_TARGET_MARKER_COLOR);

    assert.deepEqual(firstMarkers.map((marker) => marker.label).sort(), ['1', '2', '3']);
    assert.deepEqual(secondMarkers.map((marker) => marker.label).sort(), ['1', '2', '3']);
    assert.deepEqual(thirdMarkers.map((marker) => marker.label).sort(), ['1', '2']);
    assert.ok(markers.every((marker) => marker.markerShape === 'numberCircle'));
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
    assert.equal(tethers[0].preventTargetHoldingOtherTether, false);

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
      const chaosMarker = snapshot.mechanics.find(
        (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '卡奥斯',
      );
      assert.ok(chaosMarker);
      assertCloseAngle(chaosMarker.direction, locked.direction);
    },
  );
});

test('暴雷锁定最近目标时艾克斯迪斯会转向目标', () => {
  withMockedRandom(createSeededRandomValues(34, 128), () => {
    const simulation = createKefkaP3SecondSimulation();
    const firstThunderResolveAt = ZERO_AT + 31_900 + THUNDER_CAST_MS;

    advanceTo(simulation, firstThunderResolveAt - TELEGRAPH_MS);

    const snapshot = simulation.getSnapshot();
    const targetId = snapshot.scriptState[`kefkaP3Second:thunder:${firstThunderResolveAt}`];
    assert.ok(targetId);
    const target = getActorById(snapshot, targetId);
    const exdeathMarker = snapshot.mechanics.find(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '艾克斯迪斯',
    );

    assert.ok(exdeathMarker);
    assertCloseAngle(exdeathMarker.direction, getFacing(exdeathMarker.center, target.position));
  });
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

test('第三组黑洞在88.1秒生成并允许同一玩家持有多根连线', () => {
  withMockedRandom(createSeededRandomValues(66, 512), () => {
    const simulation = createKefkaP3SecondSimulation();

    advanceTo(simulation, ZERO_AT + 88_100);

    const snapshot = simulation.getSnapshot();
    const blackHoles = snapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '黑洞',
    );
    const tethers = snapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'tether' && mechanic.label === '黑洞连线',
    );

    assert.equal(blackHoles.length, 3);
    assert.equal(tethers.length, 3);
    assert.ok(tethers.every((tether) => tether.preventTargetHoldingOtherTether === false));
  });
});

test('107.1秒凯夫卡先出现，113.1秒才开始响亮亮耳光读条', () => {
  withMockedRandom(createSeededRandomValues(77, 512), () => {
    const simulation = createKefkaP3SecondSimulation();

    advanceTo(simulation, ZERO_AT + 108_100);

    let snapshot = simulation.getSnapshot();
    assert.equal(
      snapshot.hud.bossCastBars.some((cast) => cast.actionName === '响亮亮耳光'),
      false,
    );
    assert.ok(hasKefkaMarker(snapshot));

    advanceTo(simulation, ZERO_AT + 113_100);

    snapshot = simulation.getSnapshot();
    assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '响亮亮耳光'));
  });
});

test('凯夫卡释放结束后会驻留到下一次出现前1秒', () => {
  withMockedRandom(createSeededRandomValues(79, 512), () => {
    const simulation = createKefkaP3SecondSimulation();

    advanceTo(simulation, ZERO_AT + 18_000);
    assert.ok(hasKefkaMarker(simulation.getSnapshot()));

    advanceTo(simulation, ZERO_AT + 39_200);
    assert.equal(hasKefkaMarker(simulation.getSnapshot()), false);

    advanceTo(simulation, ZERO_AT + 40_200);
    assert.ok(hasKefkaMarker(simulation.getSnapshot()));

    advanceTo(simulation, ZERO_AT + 69_600);
    assert.equal(hasKefkaMarker(simulation.getSnapshot()), false);

    advanceTo(simulation, ZERO_AT + 70_600);
    assert.ok(hasKefkaMarker(simulation.getSnapshot()));

    advanceTo(simulation, ZERO_AT + 106_100);
    assert.equal(hasKefkaMarker(simulation.getSnapshot()), false);
  });
});

test('本色出演的我使用50m矩形范围', () => {
  withMockedRandom(createSeededRandomValues(78, 512), () => {
    const simulation = createKefkaP3SecondSimulation();

    advanceTo(simulation, ZERO_AT + 70_600 + 1_500 + 4_000 - TELEGRAPH_MS);

    const telegraph = simulation
      .getSnapshot()
      .mechanics.find(
        (mechanic) => mechanic.kind === 'rectangleTelegraph' && mechanic.label === '本色出演的我',
      );

    assert.ok(telegraph);
    assert.equal(telegraph.length, TRUE_SELF_LENGTH);
    assert.equal(telegraph.length, 50);
  });
});

test('111.1秒卡奥斯随机释放经度聚爆或纬度聚爆', () => {
  withMockedRandom(createSeededRandomValues(88, 512), () => {
    const simulation = createKefkaP3SecondSimulation();

    advanceTo(simulation, ZERO_AT + 111_050);

    const st = simulation.getSnapshot().actors.find((actor) => actor.slot === 'ST');
    assert.ok(st);
    submitPose(simulation, st, { x: 12, y: 0 });
    simulation.tick(50);

    let snapshot = simulation.getSnapshot();
    const stateKey = `kefkaP3Second:chaosExplosion:${ZERO_AT + 111_100}`;
    const explosionState = snapshot.scriptState[stateKey];
    assert.ok(explosionState);
    assert.ok(['longitude', 'latitude'].includes(explosionState.mode));
    assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName.endsWith('聚爆')));
    const chaosMarker = snapshot.mechanics.find(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '卡奥斯',
    );
    assert.ok(chaosMarker);
    assertCloseAngle(chaosMarker.direction, explosionState.facing);

    advanceTo(simulation, ZERO_AT + 111_100 + CHAOS_EXPLOSION_CAST_MS - TELEGRAPH_MS);

    snapshot = simulation.getSnapshot();
    const actionName = explosionState.mode === 'longitude' ? '经度聚爆' : '纬度聚爆';
    const telegraphs = snapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'fanTelegraph' && mechanic.label === `${actionName}范围`,
    );
    const expectedDirections = getChaosExplosionDirections(explosionState, 'first');

    assert.equal(telegraphs.length, 2);
    for (const expectedDirection of expectedDirections) {
      assert.ok(
        telegraphs.some(
          (telegraph) => getAngleDiff(telegraph.direction, expectedDirection) < 0.001,
        ),
      );
    }
  });
});

test('121秒黑洞先相邻两个连线，再剩余一个连线', () => {
  withMockedRandom(createSeededRandomValues(89, 512), () => {
    const simulation = createKefkaP3SecondSimulation();
    const spawnAt = ZERO_AT + 121_000;
    const firstShotAt = spawnAt + BLACK_HOLE_SHOT_DELAY_MS;
    const secondShotAt = spawnAt + BLACK_HOLE_SHOT_DELAY_MS * 2;

    advanceTo(simulation, spawnAt);

    let snapshot = simulation.getSnapshot();
    let blackHoles = snapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '黑洞',
    );
    let tethers = snapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'tether' && mechanic.label === '黑洞连线',
    );

    assert.equal(blackHoles.length, 3);
    assert.equal(tethers.length, 2);
    assert.ok(tethers[0].sourcePosition);
    assert.ok(tethers[1].sourcePosition);
    assert.ok(getDistance(tethers[0].sourcePosition, tethers[1].sourcePosition) < 30);

    advanceTo(simulation, firstShotAt + 150);

    snapshot = simulation.getSnapshot();
    blackHoles = snapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '黑洞',
    );
    tethers = snapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'tether' && mechanic.label === '黑洞连线',
    );

    assert.equal(blackHoles.length, 1);
    assert.equal(tethers.length, 1);

    advanceTo(simulation, secondShotAt + 150);

    snapshot = simulation.getSnapshot();
    blackHoles = snapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '黑洞',
    );
    tethers = snapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'tether' && mechanic.label === '黑洞连线',
    );

    assert.equal(blackHoles.length, 0);
    assert.equal(tethers.length, 0);
  });
});

test('128.1秒两黑洞判定同时凯夫卡出现并读条5秒本色出演的我', () => {
  withMockedRandom(createSeededRandomValues(91, 512), () => {
    const simulation = createKefkaP3SecondSimulation();
    const blackHoleSpawnAt = ZERO_AT + 121_000;
    const firstShotAt = blackHoleSpawnAt + BLACK_HOLE_SHOT_DELAY_MS;
    const castStartAt = firstShotAt + TRUE_SELF_LATE_SPAWN_TO_CAST_MS;
    const resolveAt = castStartAt + TRUE_SELF_LATE_CAST_MS;

    advanceTo(simulation, firstShotAt);
    assert.ok(hasKefkaMarker(simulation.getSnapshot()));

    advanceTo(simulation, castStartAt);

    let snapshot = simulation.getSnapshot();
    const castBar = snapshot.hud.bossCastBars.find((cast) => cast.actionName === '本色出演的我');

    assert.ok(castBar);
    assert.equal(castBar.startedAt, castStartAt);
    assert.equal(castBar.totalDurationMs, TRUE_SELF_LATE_CAST_MS);

    advanceTo(simulation, resolveAt - TELEGRAPH_MS);

    snapshot = simulation.getSnapshot();
    const telegraph = snapshot.mechanics.find(
      (mechanic) => mechanic.kind === 'rectangleTelegraph' && mechanic.label === '本色出演的我',
    );

    assert.ok(telegraph);
    assert.equal(telegraph.length, TRUE_SELF_LENGTH);
  });
});
