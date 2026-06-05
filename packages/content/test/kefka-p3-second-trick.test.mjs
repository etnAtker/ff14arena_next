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
  VOID_EROSION_2_STATUS_ID,
  VOID_CORROSION_STATUS_ID,
  BLACK_HOLE_SHOT_DELAY_MS,
  LATE_BLACK_HOLE_SPAWN_AT,
  LATE_BLACK_HOLE_FIRST_SHOT_AT,
  LATE_BLACK_HOLE_SECOND_SHOT_AT,
  CHAOS_EXPLOSION_CAST_MS,
  THUNDER_CAST_MS,
  TRUE_SELF_LATE_CAST_MS,
  LATE_TRUE_SELF_CAST_START_AT,
  LATE_TRUE_SELF_RESOLVE_AT,
  TRUE_SELF_LENGTH,
  TERMINAL_INJURY_DURATION_MS,
  TERMINAL_ARROW_AT,
  TERMINAL_CIRCLE_SPAWN_ATS,
  TERMINAL_CIRCLE_DELAY_MS,
  TERMINAL_CIRCLE_RADIUS,
  TERMINAL_SHARE_ASSIGN_ATS,
  TERMINAL_SHARE_DELAY_MS,
  TERMINAL_SHARE_MIN_PLAYERS,
  TERMINAL_TOWER_ATS,
  TERMINAL_TOWER_OFFSET,
  TERMINAL_TOWER_RADIUS,
  TERMINAL_TOWER_VISUAL_MS,
  TERMINAL_MOVEMENT_CHECK_AT,
  TERMINAL_SHARE_RETURN_AT,
  COMPLETE_AT,
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

function createKefkaP3SecondSimulation(options = {}) {
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
    ...(options.startTimeMs === undefined ? {} : { startTimeMs: options.startTimeMs }),
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

function submitPose(simulation, actor, position, facing = actor.facing, moving = false) {
  simulation.submitActorControlFrame({
    actorId: actor.id,
    issuedAt: simulation.getSnapshot().timeMs,
    pose: {
      position,
      facing,
      moveState: {
        direction: moving ? { x: 1, y: 0 } : { x: 0, y: 0 },
        moving,
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

function getActorBySlot(snapshot, slot) {
  const actor = snapshot.actors.find((candidate) => candidate.slot === slot);
  assert.ok(actor, `missing actor for slot ${slot}`);

  return actor;
}

function getMechanics(snapshot, kind, label) {
  return snapshot.mechanics.filter(
    (mechanic) => mechanic.kind === kind && (label === undefined || mechanic.label === label),
  );
}

function getTerminalShareState(snapshot, index) {
  const state = snapshot.scriptState[`kefkaP3Second:terminalShare:${index}`];
  assert.ok(state, `missing terminal share state ${index}`);

  return state;
}

function getVoidErosionLevel(actor) {
  if (hasStatus(actor, VOID_CORROSION_STATUS_ID)) {
    return 3;
  }

  if (hasStatus(actor, VOID_EROSION_2_STATUS_ID)) {
    return 2;
  }

  if (hasStatus(actor, VOID_EROSION_1_STATUS_ID)) {
    return 1;
  }

  return 0;
}

function getTotalVoidErosionLevel(snapshot) {
  return snapshot.actors.reduce((total, actor) => total + getVoidErosionLevel(actor), 0);
}

function getPointOnDirection(direction, radius) {
  return {
    x: Math.cos(direction) * radius,
    y: Math.sin(direction) * radius,
  };
}

function getTerminalTowerCenter(direction, side) {
  return getPointOnDirection(
    direction + (side === 'right' ? Math.PI / 2 : -Math.PI / 2),
    TERMINAL_TOWER_OFFSET,
  );
}

function getTerminalArrow(snapshot) {
  const arrow = getMechanics(snapshot, 'fieldMarker').find(
    (mechanic) =>
      mechanic.shape === 'enemy' &&
      getDistance(mechanic.center, { x: 0, y: 0 }) < 0.001 &&
      typeof mechanic.direction === 'number',
  );

  assert.ok(arrow);

  return arrow;
}

function getTerminalTowerSoakPositions(snapshot, excludedSlots = []) {
  const arrow = getTerminalArrow(snapshot);
  const availableSlots = PARTY_SLOT_ORDER.filter((slot) => !excludedSlots.includes(slot));
  const leftTowerCenter = getTerminalTowerCenter(arrow.direction, 'left');
  const rightTowerCenter = getTerminalTowerCenter(arrow.direction, 'right');

  assert.ok(availableSlots.length >= 4);

  return {
    [availableSlots[0]]: leftTowerCenter,
    [availableSlots[1]]: leftTowerCenter,
    [availableSlots[2]]: rightTowerCenter,
    [availableSlots[3]]: rightTowerCenter,
  };
}

function submitAllPositions(simulation, positionsBySlot, fallbackPosition, moving = false) {
  const snapshot = simulation.getSnapshot();

  for (const actor of snapshot.actors) {
    if (actor.slot === null) {
      continue;
    }

    submitPose(
      simulation,
      actor,
      positionsBySlot[actor.slot] ?? fallbackPosition,
      actor.facing,
      moving,
    );
  }
}

function setAllPlayersPosition(simulation, position, moving = false) {
  submitAllPositions(simulation, {}, position, moving);
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

test('第一目标只有单T时，T固定获得黄色3标记', () => {
  withMockedRandom(
    Array.from({ length: 64 }, () => 0),
    () => {
      const simulation = createKefkaP3SecondSimulation();

      advanceTo(simulation, ZERO_AT);

      const snapshot = simulation.getSnapshot();
      const st = snapshot.actors.find((actor) => actor.slot === 'ST');
      const h2 = snapshot.actors.find((actor) => actor.slot === 'H2');
      assert.ok(st);
      assert.ok(h2);
      assert.equal(hasStatus(st, FIRST_TARGET_STATUS_ID), true);
      assert.equal(hasStatus(h2, FIRST_TARGET_STATUS_ID), true);

      const firstMarkers = snapshot.mechanics.filter(
        (mechanic) =>
          mechanic.kind === 'actorMarker' && mechanic.color === FIRST_TARGET_MARKER_COLOR,
      );
      const stMarker = firstMarkers.find((marker) => marker.targetId === st.id);
      const h2Marker = firstMarkers.find((marker) => marker.targetId === h2.id);

      assert.equal(stMarker?.label, '3');
      assert.equal(h2Marker?.label, '1');
    },
  );
});

test('第一目标双T获得黄色12时，其中一个T会换到黄色3', () => {
  withMockedRandom(
    Array.from({ length: 64 }, () => 0.999),
    () => {
      const simulation = createKefkaP3SecondSimulation();

      advanceTo(simulation, ZERO_AT);

      const snapshot = simulation.getSnapshot();
      const mt = snapshot.actors.find((actor) => actor.slot === 'MT');
      const st = snapshot.actors.find((actor) => actor.slot === 'ST');
      const h1 = snapshot.actors.find((actor) => actor.slot === 'H1');
      assert.ok(mt);
      assert.ok(st);
      assert.ok(h1);
      assert.equal(hasStatus(mt, FIRST_TARGET_STATUS_ID), true);
      assert.equal(hasStatus(st, FIRST_TARGET_STATUS_ID), true);
      assert.equal(hasStatus(h1, FIRST_TARGET_STATUS_ID), true);

      const firstMarkers = snapshot.mechanics.filter(
        (mechanic) =>
          mechanic.kind === 'actorMarker' && mechanic.color === FIRST_TARGET_MARKER_COLOR,
      );
      const mtMarker = firstMarkers.find((marker) => marker.targetId === mt.id);
      const stMarker = firstMarkers.find((marker) => marker.targetId === st.id);
      const h1Marker = firstMarkers.find((marker) => marker.targetId === h1.id);
      const yellow3Marker = firstMarkers.find((marker) => marker.label === '3');

      assert.equal(mtMarker?.label, '1');
      assert.equal(stMarker?.label, '3');
      assert.equal(h1Marker?.label, '2');
      assert.equal(yellow3Marker?.targetId, st.id);
    },
  );
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
    const spawnAt = LATE_BLACK_HOLE_SPAWN_AT;
    const firstShotAt = LATE_BLACK_HOLE_FIRST_SHOT_AT;
    const secondShotAt = LATE_BLACK_HOLE_SECOND_SHOT_AT;

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
    const firstShotAt = LATE_BLACK_HOLE_FIRST_SHOT_AT;
    const castStartAt = LATE_TRUE_SELF_CAST_START_AT;
    const resolveAt = LATE_TRUE_SELF_RESOLVE_AT;

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

test('135.1秒会同 tick 判定本色出演的我和最后一次黑洞射线', () => {
  withMockedRandom(createSeededRandomValues(301, 512), () => {
    const simulation = createKefkaP3SecondSimulation({
      startTimeMs: LATE_TRUE_SELF_RESOLVE_AT - TELEGRAPH_MS,
    });
    let snapshot = simulation.getSnapshot();
    const rectangles = getMechanics(snapshot, 'rectangleTelegraph');
    const trueSelfTelegraph = rectangles.find((mechanic) => mechanic.length === TRUE_SELF_LENGTH);
    const mt = getActorBySlot(snapshot, 'MT');

    assert.ok(trueSelfTelegraph);
    assert.ok(rectangles.some((mechanic) => mechanic.length !== TRUE_SELF_LENGTH));

    const hitPosition = {
      x: trueSelfTelegraph.center.x + Math.cos(trueSelfTelegraph.direction) * 2,
      y: trueSelfTelegraph.center.y + Math.sin(trueSelfTelegraph.direction) * 2,
    };
    submitPose(simulation, mt, hitPosition);
    simulation.tick(50);

    snapshot = simulation.getSnapshot();
    const beforeErosion = getTotalVoidErosionLevel(snapshot);

    advanceTo(simulation, LATE_TRUE_SELF_RESOLVE_AT);

    snapshot = simulation.getSnapshot();
    assert.equal(getActorById(snapshot, mt.id).alive, false);
    assert.ok(getTotalVoidErosionLevel(snapshot) > beforeErosion);
  });
});

test('139.1秒会在场中生成只用于绘图的正点箭头', () => {
  withMockedRandom(createSeededRandomValues(302, 512), () => {
    const simulation = createKefkaP3SecondSimulation({ startTimeMs: TERMINAL_ARROW_AT + 100 });
    const snapshot = simulation.getSnapshot();
    const arrow = getMechanics(snapshot, 'fieldMarker').find(
      (mechanic) =>
        mechanic.shape === 'enemy' &&
        getDistance(mechanic.center, { x: 0, y: 0 }) < 0.001 &&
        typeof mechanic.direction === 'number',
    );
    const cardinalDirections = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];

    assert.ok(arrow);
    assert.ok(
      cardinalDirections.some((direction) => getAngleDiff(arrow.direction, direction) < 0.001),
    );
  });
});

test('143.1秒和146.1秒脚下圈会生成8个5米预警并按记录位置判定', () => {
  withMockedRandom(createSeededRandomValues(303, 512), () => {
    const spawnAt = TERMINAL_CIRCLE_SPAWN_ATS[0];
    const simulation = createKefkaP3SecondSimulation({ startTimeMs: spawnAt + 100 });
    let snapshot = simulation.getSnapshot();
    const circleTelegraphs = getMechanics(snapshot, 'circleTelegraph').filter(
      (mechanic) => mechanic.radius === TERMINAL_CIRCLE_RADIUS,
    );

    assert.equal(circleTelegraphs.length, 8);

    advanceTo(simulation, spawnAt + TERMINAL_CIRCLE_DELAY_MS);

    snapshot = simulation.getSnapshot();
    assert.ok(snapshot.actors.every((actor) => !actor.alive));
  });
});

test('终盘两次分摊目标会在支援组和DPS之间交替，成功分摊会获得2.5秒易伤', () => {
  withMockedRandom(createSeededRandomValues(304, 512), () => {
    const secondAssignAt = TERMINAL_SHARE_ASSIGN_ATS[1];
    const secondResolveAt = secondAssignAt + TERMINAL_SHARE_DELAY_MS;
    const simulation = createKefkaP3SecondSimulation({ startTimeMs: secondAssignAt + 100 });

    let snapshot = simulation.getSnapshot();
    const firstState = getTerminalShareState(snapshot, 0);
    const secondState = getTerminalShareState(snapshot, 1);
    const secondTarget = getActorById(snapshot, secondState.targetId);

    assert.notEqual(firstState.roleGroup, secondState.roleGroup);

    const stackSlots = [
      secondTarget.slot,
      ...PARTY_SLOT_ORDER.filter((slot) => slot !== secondTarget.slot),
    ].slice(0, TERMINAL_SHARE_MIN_PLAYERS);
    const stackPosition = { x: 12, y: 12 };
    const awayPosition = { x: -12, y: -12 };
    const positionsBySlot = Object.fromEntries(stackSlots.map((slot) => [slot, stackPosition]));
    const towerSoakPositions = getTerminalTowerSoakPositions(snapshot, stackSlots);

    submitAllPositions(simulation, towerSoakPositions, stackPosition);
    simulation.tick(50);
    advanceTo(simulation, TERMINAL_TOWER_ATS[TERMINAL_TOWER_ATS.length - 1]);
    submitAllPositions(simulation, positionsBySlot, awayPosition);
    simulation.tick(50);
    advanceTo(simulation, secondResolveAt);

    snapshot = simulation.getSnapshot();
    for (const slot of stackSlots) {
      const actor = getActorBySlot(snapshot, slot);

      assert.equal(actor.alive, true);
      assert.ok(hasStatus(actor, 'injury_up'));
      assert.ok(
        actor.statuses.some(
          (status) =>
            status.id === 'injury_up' &&
            status.expiresAt === secondResolveAt + TERMINAL_INJURY_DURATION_MS,
        ),
      );
    }
  });
});

test('终盘分摊人数不足时只击杀分摊范围内玩家', () => {
  withMockedRandom(createSeededRandomValues(305, 512), () => {
    const secondAssignAt = TERMINAL_SHARE_ASSIGN_ATS[1];
    const secondResolveAt = secondAssignAt + TERMINAL_SHARE_DELAY_MS;
    const simulation = createKefkaP3SecondSimulation({ startTimeMs: secondAssignAt + 100 });
    let snapshot = simulation.getSnapshot();
    const state = getTerminalShareState(snapshot, 1);
    const target = getActorById(snapshot, state.targetId);
    const stackPosition = { x: 12, y: 12 };
    const awayPosition = { x: -12, y: -12 };
    const towerSoakPositions = getTerminalTowerSoakPositions(snapshot, [target.slot]);

    submitAllPositions(simulation, towerSoakPositions, stackPosition);
    simulation.tick(50);
    advanceTo(simulation, TERMINAL_TOWER_ATS[TERMINAL_TOWER_ATS.length - 1]);
    submitAllPositions(simulation, { [target.slot]: stackPosition }, awayPosition);
    simulation.tick(50);
    advanceTo(simulation, secondResolveAt);

    snapshot = simulation.getSnapshot();
    assert.equal(getActorById(snapshot, target.id).alive, false);
    assert.ok(snapshot.actors.some((actor) => actor.alive));
  });
});

test('终盘塔会按箭头右左方向生成并立即判定，成功踩塔获得易伤', () => {
  withMockedRandom(createSeededRandomValues(306, 512), () => {
    const towerAt = TERMINAL_TOWER_ATS[0];
    const simulation = createKefkaP3SecondSimulation({ startTimeMs: towerAt - 100 });
    let snapshot = simulation.getSnapshot();
    const arrow = getMechanics(snapshot, 'fieldMarker').find(
      (mechanic) =>
        mechanic.shape === 'enemy' &&
        getDistance(mechanic.center, { x: 0, y: 0 }) < 0.001 &&
        typeof mechanic.direction === 'number',
    );

    assert.ok(arrow);

    const towerCenter = getTerminalTowerCenter(arrow.direction, 'right');
    const awayPosition = { x: -towerCenter.x, y: -towerCenter.y };

    submitAllPositions(simulation, { MT: towerCenter, ST: towerCenter }, awayPosition);
    simulation.tick(50);
    advanceTo(simulation, towerAt);

    snapshot = simulation.getSnapshot();
    const tower = getMechanics(snapshot, 'tower').find(
      (mechanic) =>
        mechanic.radius === TERMINAL_TOWER_RADIUS &&
        getDistance(mechanic.center, towerCenter) < 0.001,
    );

    assert.ok(tower);
    assert.equal(tower.resolveAt, towerAt + TERMINAL_TOWER_VISUAL_MS);
    assert.ok(hasStatus(getActorBySlot(snapshot, 'MT'), 'injury_up'));
    assert.ok(hasStatus(getActorBySlot(snapshot, 'ST'), 'injury_up'));
  });
});

test('149.1秒同 tick 会完成第一次分摊、第二次点名和首座终盘塔', () => {
  withMockedRandom(createSeededRandomValues(310, 512), () => {
    const towerAt = TERMINAL_TOWER_ATS[0];
    const simulation = createKefkaP3SecondSimulation({ startTimeMs: towerAt });

    simulation.tick(50);

    const snapshot = simulation.getSnapshot();
    const firstShareState = getTerminalShareState(snapshot, 0);
    const secondShareState = getTerminalShareState(snapshot, 1);
    const tower = getMechanics(snapshot, 'tower').find(
      (mechanic) => mechanic.radius === TERMINAL_TOWER_RADIUS,
    );

    assert.ok(firstShareState.center);
    assert.equal(secondShareState.assignAt, towerAt);
    assert.ok(tower);
    assert.equal(tower.resolveAt, towerAt + TERMINAL_TOWER_VISUAL_MS);
  });
});

test('终盘塔少于2人时会全员死亡', () => {
  withMockedRandom(createSeededRandomValues(307, 512), () => {
    const towerAt = TERMINAL_TOWER_ATS[0];
    const simulation = createKefkaP3SecondSimulation({ startTimeMs: towerAt - 100 });
    const snapshot = simulation.getSnapshot();
    const arrow = getMechanics(snapshot, 'fieldMarker').find(
      (mechanic) =>
        mechanic.shape === 'enemy' &&
        getDistance(mechanic.center, { x: 0, y: 0 }) < 0.001 &&
        typeof mechanic.direction === 'number',
    );

    assert.ok(arrow);

    const towerCenter = getTerminalTowerCenter(arrow.direction, 'right');

    setAllPlayersPosition(simulation, { x: -towerCenter.x, y: -towerCenter.y });
    simulation.tick(50);
    advanceTo(simulation, towerAt);

    assert.ok(simulation.getSnapshot().actors.every((actor) => !actor.alive));
  });
});

test('158.1秒移动检查会击杀静止玩家并保留移动玩家', () => {
  withMockedRandom(createSeededRandomValues(308, 512), () => {
    const simulation = createKefkaP3SecondSimulation({
      startTimeMs: TERMINAL_MOVEMENT_CHECK_AT - 100,
    });
    const snapshot = simulation.getSnapshot();

    for (const actor of snapshot.actors) {
      submitPose(
        simulation,
        actor,
        actor.slot === 'MT' ? { x: 0, y: 0 } : { x: 1, y: 0 },
        actor.facing,
        actor.slot !== 'MT',
      );
    }

    simulation.tick(50);
    advanceTo(simulation, TERMINAL_MOVEMENT_CHECK_AT);

    const resolvedSnapshot = simulation.getSnapshot();
    assert.equal(getActorBySlot(resolvedSnapshot, 'MT').alive, false);
    assert.ok(
      resolvedSnapshot.actors.filter((actor) => actor.slot !== 'MT').every((actor) => actor.alive),
    );
  });
});

test('159.1秒会在两次分摊记录位置造成返还即死范围', () => {
  withMockedRandom(createSeededRandomValues(309, 512), () => {
    const simulation = createKefkaP3SecondSimulation({
      startTimeMs: TERMINAL_SHARE_RETURN_AT - 100,
    });
    let snapshot = simulation.getSnapshot();
    const firstShareState = getTerminalShareState(snapshot, 0);

    assert.ok(firstShareState.center);

    const awayPosition = {
      x: -firstShareState.center.x,
      y: -firstShareState.center.y,
    };

    submitAllPositions(simulation, { MT: firstShareState.center }, awayPosition);
    simulation.tick(50);
    advanceTo(simulation, TERMINAL_SHARE_RETURN_AT);

    snapshot = simulation.getSnapshot();
    assert.equal(getActorBySlot(snapshot, 'MT').alive, false);
  });
});

test('P3二运战斗会在163秒完成', () => {
  const simulation = createKefkaP3SecondSimulation({ startTimeMs: COMPLETE_AT - 100 });

  assert.equal(COMPLETE_AT, 163_000);
  assert.equal(simulation.getSnapshot().latestResult, null);

  advanceTo(simulation, COMPLETE_AT);

  assert.ok(simulation.getSnapshot().latestResult);
});

test('凯夫卡P3二运：开战跳到3秒会直接生成三组目标和混沌之土', () => {
  withMockedRandom(createSeededRandomValues(201, 512), () => {
    const simulation = createKefkaP3SecondSimulation({ startTimeMs: ZERO_AT });
    const snapshot = simulation.getSnapshot();

    assert.equal(snapshot.timeMs, ZERO_AT);
    assert.equal(
      snapshot.actors.filter((actor) => hasStatus(actor, FIRST_TARGET_STATUS_ID)).length,
      3,
    );
    assert.equal(
      snapshot.actors.filter((actor) => hasStatus(actor, SECOND_TARGET_STATUS_ID)).length,
      3,
    );
    assert.equal(
      snapshot.actors.filter((actor) => hasStatus(actor, THIRD_TARGET_STATUS_ID)).length,
      2,
    );
    assert.equal(
      snapshot.actors.filter((actor) => hasStatus(actor, CHAOS_EARTH_STATUS_ID)).length,
      8,
    );
  });
});

test('凯夫卡P3二运：开战跳到第一组黑洞期间会重建黑洞和连线', () => {
  withMockedRandom(createSeededRandomValues(202, 512), () => {
    const blackHoleSpawnAt = ZERO_AT + 16_500 + 2_700;
    const simulation = createKefkaP3SecondSimulation({ startTimeMs: blackHoleSpawnAt + 100 });
    const snapshot = simulation.getSnapshot();
    const blackHoles = snapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '黑洞',
    );
    const tethers = snapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'tether' && mechanic.label === '黑洞连线',
    );

    assert.equal(blackHoles.length, 3);
    assert.equal(tethers.length, 1);
  });
});

test('凯夫卡P3二运：开战跳到第三组黑洞期间会重建三根连线', () => {
  withMockedRandom(createSeededRandomValues(205, 512), () => {
    const blackHoleSpawnAt = ZERO_AT + 88_100;
    const simulation = createKefkaP3SecondSimulation({ startTimeMs: blackHoleSpawnAt + 100 });
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

test('凯夫卡P3二运：开战跳到第四组黑洞期间会重建相邻双连线', () => {
  withMockedRandom(createSeededRandomValues(206, 512), () => {
    const blackHoleSpawnAt = LATE_BLACK_HOLE_SPAWN_AT;
    const simulation = createKefkaP3SecondSimulation({ startTimeMs: blackHoleSpawnAt + 100 });
    const snapshot = simulation.getSnapshot();
    const blackHoles = snapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '黑洞',
    );
    const tethers = snapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'tether' && mechanic.label === '黑洞连线',
    );

    assert.equal(blackHoles.length, 3);
    assert.equal(tethers.length, 2);
    assert.ok(tethers[0].sourcePosition);
    assert.ok(tethers[1].sourcePosition);
    assert.ok(getDistance(tethers[0].sourcePosition, tethers[1].sourcePosition) < 30);
  });
});

test('凯夫卡P3二运：开战跳过黑洞射线后会推进无之侵蚀状态', () => {
  withMockedRandom(createSeededRandomValues(203, 512), () => {
    const blackHoleSpawnAt = ZERO_AT + 16_500 + 2_700;
    const simulation = createKefkaP3SecondSimulation({
      startTimeMs: blackHoleSpawnAt + BLACK_HOLE_SHOT_DELAY_MS + 100,
    });
    const snapshot = simulation.getSnapshot();

    assert.ok(snapshot.actors.some((actor) => hasStatus(actor, VOID_EROSION_1_STATUS_ID)));
  });
});

test('凯夫卡P3二运：开战跳到后半聚爆读条中会恢复读条和状态', () => {
  withMockedRandom(createSeededRandomValues(204, 512), () => {
    const castStartAt = ZERO_AT + 111_100;
    const simulation = createKefkaP3SecondSimulation({ startTimeMs: castStartAt + 100 });
    const snapshot = simulation.getSnapshot();
    const state = snapshot.scriptState[`kefkaP3Second:chaosExplosion:${castStartAt}`];

    assert.ok(state);
    assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName.endsWith('聚爆')));
  });
});
