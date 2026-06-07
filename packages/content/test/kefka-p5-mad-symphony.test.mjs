import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '@ff14arena/core';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { getBattleBotController, getBattleDefinition } from '../src/index.ts';
import { KEFKA_P5_MAD_SYMPHONY_TESTING } from '../src/battles/kefka-p5-mad-symphony.ts';

const {
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
  FOLLOWUP_INJURY_MS,
  NUCLEAR_STATUS_ID,
  HOLY_STATUS_ID,
  ASSIGNMENTS_KEY,
  FOLLOWUP_TARGETS_KEY_PREFIX,
  BOT_INITIAL_RADIUS,
  BOT_SECOND_BAIT_RADIUS,
  BOT_NUCLEAR_RADIUS,
  BOT_NUCLEAR_POINT,
  BOT_HOLY_SHARE_POINT,
  BOT_NON_SHARE_SAFE_RADIUS,
  BOT_NON_SHARE_RIGHT_POINT,
  BOT_NON_SHARE_LEFT_POINT,
  BOT_FOLLOWUP_DPS_SHARE_POINT,
  BOT_FOLLOWUP_HEALER_SHARE_POINT,
  BOT_FOLLOWUP_TANK_SHARE_POINT,
  BOT_INITIAL_SLOT_ORDER,
  KEFKA_MAP_MARKERS,
  INITIAL_POSITIONS,
  getKefkaP5BotTarget,
} = KEFKA_P5_MAD_SYMPHONY_TESTING;

const TANK_SLOTS = ['MT', 'ST'];
const HEALER_SLOTS = ['H1', 'H2'];
const DPS_SLOTS = ['D1', 'D2', 'D3', 'D4'];

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

function createKefkaP5Simulation() {
  const battle = getBattleDefinition('kefka_p5_mad_symphony');
  assert.ok(battle);

  const simulation = createSimulation();
  simulation.loadBattle({
    battle,
    roomId: 'kefka-p5-mad-symphony-test-room',
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

function createKefkaP5BotSimulation() {
  const battle = getBattleDefinition('kefka_p5_mad_symphony');
  assert.ok(battle);

  const simulation = createSimulation();
  simulation.loadBattle({
    battle,
    roomId: 'kefka-p5-mad-symphony-bot-test-room',
    party: PARTY_SLOT_ORDER.map((slot) => ({
      slot,
      name: slot,
      kind: 'bot',
      actorId: `bot_${slot}`,
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

function getActorById(snapshot, actorId) {
  const actor = snapshot.actors.find((candidate) => candidate.id === actorId);
  assert.ok(actor);

  return actor;
}

function hasStatus(actor, statusId) {
  return actor.statuses.some((status) => status.id === statusId);
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

function submitPositions(simulation, snapshot, positionsByActorId) {
  for (const [actorId, position] of Object.entries(positionsByActorId)) {
    submitPose(simulation, getActorById(snapshot, actorId), position);
  }
}

function getAssignments(snapshot) {
  const assignments = snapshot.scriptState[ASSIGNMENTS_KEY];
  assert.ok(assignments);

  return assignments;
}

function getFollowupTargets(snapshot, roundIndex) {
  const targets = snapshot.scriptState[`${FOLLOWUP_TARGETS_KEY_PREFIX}:${roundIndex}`];
  assert.ok(targets);

  return targets;
}

function getActorIdAtPosition(snapshot, position) {
  const actor = snapshot.actors.find(
    (candidate) =>
      Math.abs(candidate.position.x - position.x) < 0.0001 &&
      Math.abs(candidate.position.y - position.y) < 0.0001,
  );
  assert.ok(actor);

  return actor.id;
}

function getFirstTargetIds(assignments) {
  return [...assignments.firstTankTargetIds, ...assignments.firstDhTargetIds];
}

function getNearestActorIds(snapshot, count) {
  return snapshot.actors
    .filter((actor) => actor.mechanicActive)
    .sort((left, right) => {
      const distanceDiff =
        pointDistance(left.position, { x: 0, y: 0 }) -
        pointDistance(right.position, { x: 0, y: 0 });

      if (Math.abs(distanceDiff) > 0.0001) {
        return distanceDiff;
      }

      return (left.slot ?? '').localeCompare(right.slot ?? '');
    })
    .slice(0, count)
    .map((actor) => actor.id);
}

function pointDistance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function assertNearPoint(actual, expected, label) {
  assert.ok(
    pointDistance(actual, expected) <= 0.001,
    `${label}: expected (${expected.x}, ${expected.y}), got (${actual.x}, ${actual.y})`,
  );
}

function getExpectedNonSharePoint(slot) {
  return INITIAL_POSITIONS[slot].x < 0 ? BOT_NON_SHARE_LEFT_POINT : BOT_NON_SHARE_RIGHT_POINT;
}

function prepareBuffPhase(simulation) {
  advanceTo(simulation, FIRST_HIT_AT);

  const firstSnapshot = simulation.getSnapshot();
  const assignments = getAssignments(firstSnapshot);
  const firstDhTargetIds = assignments.firstDhTargetIds;
  const secondDhTargetIds = firstSnapshot.actors
    .filter(
      (actor) =>
        actor.mechanicActive &&
        actor.slot !== 'MT' &&
        actor.slot !== 'ST' &&
        !firstDhTargetIds.includes(actor.id),
    )
    .map((actor) => actor.id);
  const mt = getActorBySlot(firstSnapshot, 'MT');
  const st = getActorBySlot(firstSnapshot, 'ST');

  assert.equal(secondDhTargetIds.length, 3);

  submitPositions(simulation, firstSnapshot, {
    [st.id]: mt.position,
    [firstDhTargetIds[0]]: { x: -6, y: 18 },
    [firstDhTargetIds[1]]: { x: 0, y: 18 },
    [firstDhTargetIds[2]]: { x: 6, y: 18 },
    [secondDhTargetIds[0]]: { x: 0, y: 6 },
    [secondDhTargetIds[1]]: { x: 6, y: 0 },
    [secondDhTargetIds[2]]: { x: -6, y: 0 },
  });
  advanceTo(simulation, SECOND_HIT_AT);

  return {
    assignments,
    snapshot: simulation.getSnapshot(),
  };
}

function runKefkaP5WithBots(randomValues) {
  return withMockedRandom(randomValues, () => {
    const controller = getBattleBotController('kefka_p5_mad_symphony');
    assert.ok(controller);

    const simulation = createKefkaP5BotSimulation();

    for (
      let elapsedMs = 0;
      elapsedMs <= COMPLETE_AT + 2_000 && simulation.running;
      elapsedMs += 50
    ) {
      const snapshot = simulation.getSnapshot();

      for (const actor of snapshot.actors) {
        if (actor.slot === null || !actor.alive) {
          continue;
        }

        const frame = controller({
          snapshot,
          slot: actor.slot,
          actor,
        });

        simulation.submitActorControlFrame({
          actorId: actor.id,
          issuedAt: elapsedMs,
          ...frame,
        });
      }

      simulation.tick(50);
    }

    return simulation.getSnapshot();
  });
}

test('凯夫卡P5癫狂交响曲：首轮蓝圈随机3名DPS，次轮蓝圈选择最近3名玩家', () => {
  withMockedRandom(createSeededRandomValues(51, 100), () => {
    const simulation = createKefkaP5Simulation();

    advanceTo(simulation, FIRST_TELEGRAPH_AT);

    const firstSnapshot = simulation.getSnapshot();
    const assignments = getAssignments(firstSnapshot);
    const firstDhTargetIds = assignments.firstDhTargetIds;
    const dpsActorIds = DPS_SLOTS.map((slot) => getActorBySlot(firstSnapshot, slot).id);

    assert.equal(new Set(firstDhTargetIds).size, 3);
    assert.ok(firstDhTargetIds.every((actorId) => dpsActorIds.includes(actorId)));

    const firstTargetIds = getFirstTargetIds(assignments);
    assert.equal(new Set(firstTargetIds).size, 5);
    assert.deepEqual(new Set(assignments.firstTankTargetIds), new Set(['player_MT', 'player_ST']));
    assert.ok(assignments.firstTankTargetIds.includes(assignments.nuclearTargetId));
    assert.ok(assignments.firstTankTargetIds.includes(assignments.holyTargetId));
    assert.notEqual(assignments.nuclearTargetId, assignments.holyTargetId);

    const mt = getActorBySlot(firstSnapshot, 'MT');
    const st = getActorBySlot(firstSnapshot, 'ST');
    const secondBaitIds = firstSnapshot.actors
      .filter(
        (actor) =>
          actor.mechanicActive &&
          actor.slot !== 'MT' &&
          actor.slot !== 'ST' &&
          !firstDhTargetIds.includes(actor.id),
      )
      .map((actor) => actor.id);

    submitPositions(simulation, firstSnapshot, {
      [st.id]: mt.position,
      [firstDhTargetIds[0]]: { x: -6, y: 18 },
      [firstDhTargetIds[1]]: { x: 0, y: 18 },
      [firstDhTargetIds[2]]: { x: 6, y: 18 },
      [secondBaitIds[0]]: { x: 0, y: 6 },
      [secondBaitIds[1]]: { x: 6, y: 0 },
      [secondBaitIds[2]]: { x: -6, y: 0 },
    });

    advanceTo(simulation, SECOND_TELEGRAPH_AT);

    const secondSnapshot = simulation.getSnapshot();
    const secondBlueTelegraphs = secondSnapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'circleTelegraph' && mechanic.color === '#38bdf8',
    );
    const secondDhTargetIds = secondBlueTelegraphs.map((mechanic) => {
      return getActorIdAtPosition(secondSnapshot, mechanic.center);
    });
    const expectedSecondDhTargetIds = getNearestActorIds(secondSnapshot, 3);
    const secondRedTelegraphs = secondSnapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'circleTelegraph' && mechanic.color === '#ef4444',
    );

    assert.deepEqual(secondDhTargetIds, expectedSecondDhTargetIds);
    assert.equal(secondRedTelegraphs.length, 1);
    assertNearPoint(
      secondRedTelegraphs[0].center,
      getActorBySlot(secondSnapshot, 'MT').position,
      '第二轮双T分摊',
    );
  });
});

test('凯夫卡P5癫狂交响曲：初始站位为目标圈外1m的正北顺时针八方位', () => {
  const battle = getBattleDefinition('kefka_p5_mad_symphony');
  assert.ok(battle);

  for (let index = 0; index < BOT_INITIAL_SLOT_ORDER.length; index += 1) {
    const slot = BOT_INITIAL_SLOT_ORDER[index];
    const expected = INITIAL_POSITIONS[slot];
    const actual = battle.initialPartyPositions[slot].position;

    assertNearPoint(actual, expected, `${slot} 初始站位`);
    assert.ok(Math.abs(pointDistance(actual, { x: 0, y: 0 }) - BOT_INITIAL_RADIUS) <= 0.001);
  }
});

test('凯夫卡P5癫狂交响曲：场地标点沿用P3二运', () => {
  const battle = getBattleDefinition('kefka_p5_mad_symphony');
  assert.ok(battle);

  assert.deepEqual(battle.mapMarkers, KEFKA_MAP_MARKERS);
  assert.deepEqual(
    battle.mapMarkers?.map((marker) => marker.label),
    ['A', '2', 'B', '3', 'C', '4', 'D', '1'],
  );
});

test('凯夫卡P5癫狂交响曲：前两轮范围提前0.5秒显示预兆', () => {
  withMockedRandom(createSeededRandomValues(58, 100), () => {
    const simulation = createKefkaP5Simulation();

    advanceTo(simulation, FIRST_TELEGRAPH_AT - 100);

    assert.equal(
      simulation.getSnapshot().mechanics.filter((mechanic) => mechanic.kind === 'circleTelegraph')
        .length,
      0,
    );

    advanceTo(simulation, FIRST_TELEGRAPH_AT);

    const telegraphSnapshot = simulation.getSnapshot();
    const redTelegraphs = telegraphSnapshot.mechanics.filter(
      (mechanic) =>
        mechanic.kind === 'circleTelegraph' &&
        mechanic.color === '#ef4444' &&
        mechanic.radius === TANK_SPREAD_RADIUS,
    );
    const blueTelegraphs = telegraphSnapshot.mechanics.filter(
      (mechanic) =>
        mechanic.kind === 'circleTelegraph' &&
        mechanic.color === '#38bdf8' &&
        mechanic.radius === DH_SPREAD_RADIUS,
    );

    assert.equal(FIRST_HIT_AT - FIRST_TELEGRAPH_AT, 500);
    assert.equal(SECOND_HIT_AT - SECOND_TELEGRAPH_AT, 500);
    assert.equal(TELEGRAPH_MS, 500);
    assert.equal(redTelegraphs.length, 2);
    assert.equal(blueTelegraphs.length, 3);
    assert.ok(
      [...redTelegraphs, ...blueTelegraphs].every(
        (mechanic) => mechanic.resolveAt === FIRST_TELEGRAPH_AT + TELEGRAPH_MS,
      ),
    );
  });
});

test('凯夫卡P5癫狂交响曲：Bot controller 已登记', () => {
  assert.ok(getBattleBotController('kefka_p5_mad_symphony'));
});

test('凯夫卡P5癫狂交响曲：Bot 第二轮ST去MT位置处理双T分摊', () => {
  withMockedRandom(createSeededRandomValues(57, 100), () => {
    const simulation = createKefkaP5BotSimulation();
    const controller = getBattleBotController('kefka_p5_mad_symphony');
    assert.ok(controller);

    advanceTo(simulation, FIRST_HIT_AT);

    const snapshot = simulation.getSnapshot();
    const assignments = getAssignments(snapshot);
    const st = getActorBySlot(snapshot, 'ST');
    const target = getKefkaP5BotTarget(
      'ST',
      st,
      snapshot.actors,
      snapshot.timeMs,
      snapshot.scriptState,
    );
    const frame = controller({ snapshot, slot: 'ST', actor: st });

    assert.ok(frame.pose);
    assert.ok(assignments.firstDhTargetIds.length === 3);
    assertNearPoint(target, INITIAL_POSITIONS.MT, 'ST 第二轮双T分摊目标');

    for (const actor of snapshot.actors) {
      assert.ok(actor.slot);

      if (
        actor.slot === 'MT' ||
        actor.slot === 'ST' ||
        assignments.firstDhTargetIds.includes(actor.id)
      ) {
        continue;
      }

      const baitTarget = getKefkaP5BotTarget(
        actor.slot,
        actor,
        snapshot.actors,
        snapshot.timeMs,
        snapshot.scriptState,
      );

      assert.ok(
        Math.abs(pointDistance(baitTarget, { x: 0, y: 0 }) - BOT_SECOND_BAIT_RADIUS) <= 0.001,
        `${actor.slot} 第一轮未点DH应主动内移引导第二轮蓝圈`,
      );
    }
  });
});

test('凯夫卡P5癫狂交响曲：Bot 核爆T去A方向，神圣T和首轮蓝圈分摊，其余人避开', () => {
  withMockedRandom(createSeededRandomValues(57, 100), () => {
    const simulation = createKefkaP5BotSimulation();

    advanceTo(simulation, SECOND_HIT_AT);

    const snapshot = simulation.getSnapshot();
    const assignments = getAssignments(snapshot);
    assert.ok(assignments.secondDhTargetIds);

    for (const actor of snapshot.actors) {
      assert.ok(actor.slot);

      const target = getKefkaP5BotTarget(
        actor.slot,
        actor,
        snapshot.actors,
        snapshot.timeMs,
        snapshot.scriptState,
      );

      if (actor.id === assignments.nuclearTargetId) {
        assertNearPoint(target, BOT_NUCLEAR_POINT, `${actor.slot} 核爆目标点`);
        assert.ok(Math.abs(pointDistance(target, { x: 0, y: 0 }) - BOT_NUCLEAR_RADIUS) <= 0.001);
      } else if (assignments.secondDhTargetIds.includes(actor.id)) {
        assertNearPoint(
          target,
          getExpectedNonSharePoint(actor.slot),
          `${actor.slot} 第二轮蓝圈闲人固定点`,
        );
        assert.ok(
          pointDistance(target, BOT_NUCLEAR_POINT) > NUCLEAR_RADIUS,
          `${actor.slot} 第二轮蓝圈应避开核爆`,
        );
        assert.ok(
          pointDistance(target, BOT_HOLY_SHARE_POINT) > HOLY_SHARE_RADIUS,
          `${actor.slot} 第二轮蓝圈应远离神圣分摊`,
        );
        assert.ok(
          Math.abs(pointDistance(target, { x: 0, y: 0 }) - BOT_NON_SHARE_SAFE_RADIUS) <= 0.001,
          `${actor.slot} 第二轮蓝圈应站到12m闲人点`,
        );
      } else if (
        actor.id === assignments.holyTargetId ||
        assignments.firstDhTargetIds.includes(actor.id)
      ) {
        assertNearPoint(target, BOT_HOLY_SHARE_POINT, `${actor.slot} 神圣分摊点`);
      } else {
        assertNearPoint(target, getExpectedNonSharePoint(actor.slot), `${actor.slot} 闲人固定点`);
        assert.ok(
          pointDistance(target, BOT_NUCLEAR_POINT) > NUCLEAR_RADIUS,
          `${actor.slot} 应避开核爆`,
        );
        assert.ok(
          pointDistance(target, BOT_HOLY_SHARE_POINT) > HOLY_SHARE_RADIUS,
          `${actor.slot} 应远离神圣分摊`,
        );
        assert.ok(
          Math.abs(pointDistance(target, { x: 0, y: 0 }) - BOT_NON_SHARE_SAFE_RADIUS) <= 0.001,
          `${actor.slot} 应站到12m闲人点`,
        );
      }
    }
  });
});

test('凯夫卡P5癫狂交响曲：Bot 后续职能分摊T北H左下D右下', () => {
  withMockedRandom(createSeededRandomValues(59, 100), () => {
    const simulation = createKefkaP5BotSimulation();
    const controller = getBattleBotController('kefka_p5_mad_symphony');
    assert.ok(controller);

    advanceTo(simulation, BUFF_RESOLVE_AT);

    const snapshot = simulation.getSnapshot();

    for (const actor of snapshot.actors) {
      assert.ok(actor.slot);

      const target = getKefkaP5BotTarget(
        actor.slot,
        actor,
        snapshot.actors,
        snapshot.timeMs,
        snapshot.scriptState,
      );
      const frame = controller({ snapshot, slot: actor.slot, actor });

      assert.ok(frame.pose);
      assertNearPoint(
        target,
        TANK_SLOTS.includes(actor.slot)
          ? BOT_FOLLOWUP_TANK_SHARE_POINT
          : DPS_SLOTS.includes(actor.slot)
            ? BOT_FOLLOWUP_DPS_SHARE_POINT
            : BOT_FOLLOWUP_HEALER_SHARE_POINT,
        `${actor.slot} 后续职能分摊目标`,
      );
    }
  });
});

test('凯夫卡P5癫狂交响曲：尾段每轮重新随机1T1H1D并显示职能分摊', () => {
  withMockedRandom(createSeededRandomValues(60, 200), () => {
    const simulation = createKefkaP5Simulation();

    const { assignments, snapshot } = prepareBuffPhase(simulation);
    const holyTarget = getActorById(snapshot, assignments.holyTargetId);
    const nuclearTarget = getActorById(snapshot, assignments.nuclearTargetId);
    const holyHelperIds = getFirstTargetIds(assignments).filter(
      (actorId) => actorId !== holyTarget.id && actorId !== nuclearTarget.id,
    );
    const safePositions = Object.fromEntries(
      snapshot.actors.map((actor) => [actor.id, { x: 0, y: -19 }]),
    );
    const holyStackPositions = Object.fromEntries(
      [holyTarget.id, ...holyHelperIds].map((actorId) => [actorId, { x: -18.5, y: 0 }]),
    );

    submitPositions(simulation, snapshot, {
      ...safePositions,
      ...holyStackPositions,
      [nuclearTarget.id]: { x: 18.5, y: 0 },
    });
    advanceTo(simulation, BUFF_RESOLVE_AT);

    const afterBuffSnapshot = simulation.getSnapshot();
    submitPositions(
      simulation,
      afterBuffSnapshot,
      Object.fromEntries(
        afterBuffSnapshot.actors.map((actor) => [
          actor.id,
          TANK_SLOTS.includes(actor.slot)
            ? BOT_FOLLOWUP_TANK_SHARE_POINT
            : DPS_SLOTS.includes(actor.slot)
              ? BOT_FOLLOWUP_DPS_SHARE_POINT
              : BOT_FOLLOWUP_HEALER_SHARE_POINT,
        ]),
      ),
    );

    advanceTo(simulation, FIRST_FOLLOWUP_HIT_AT);

    const firstFollowupSnapshot = simulation.getSnapshot();
    const firstTargets = getFollowupTargets(firstFollowupSnapshot, 1);
    const firstTank = getActorById(firstFollowupSnapshot, firstTargets.tankTargetId);
    const firstHealer = getActorById(firstFollowupSnapshot, firstTargets.healerTargetId);
    const firstDps = getActorById(firstFollowupSnapshot, firstTargets.dpsTargetId);
    const firstTankMarkers = firstFollowupSnapshot.mechanics.filter(
      (mechanic) =>
        mechanic.kind === 'actorMarker' &&
        mechanic.label === '癫狂交响曲后续T分摊1' &&
        mechanic.radius === FOLLOWUP_SHARE_RADIUS,
    );
    const firstHealerMarkers = firstFollowupSnapshot.mechanics.filter(
      (mechanic) =>
        mechanic.kind === 'actorMarker' &&
        mechanic.label === '癫狂交响曲后续H分摊1' &&
        mechanic.radius === FOLLOWUP_SHARE_RADIUS,
    );
    const firstDMarkers = firstFollowupSnapshot.mechanics.filter(
      (mechanic) =>
        mechanic.kind === 'actorMarker' &&
        mechanic.label === '癫狂交响曲后续D分摊1' &&
        mechanic.radius === FOLLOWUP_SHARE_RADIUS,
    );

    assert.ok(TANK_SLOTS.includes(firstTank.slot));
    assert.ok(HEALER_SLOTS.includes(firstHealer.slot));
    assert.ok(DPS_SLOTS.includes(firstDps.slot));
    assert.equal(firstTankMarkers.length, 1);
    assert.equal(firstHealerMarkers.length, 1);
    assert.equal(firstDMarkers.length, 1);
    assert.equal(firstTankMarkers[0].targetId, firstTank.id);
    assert.equal(firstHealerMarkers[0].targetId, firstHealer.id);
    assert.equal(firstDMarkers[0].targetId, firstDps.id);
    assert.ok(
      [...firstTankMarkers, ...firstHealerMarkers, ...firstDMarkers].every(
        (mechanic) => mechanic.resolveAt === FIRST_FOLLOWUP_HIT_AT + INSTANT_TELEGRAPH_MS,
      ),
    );

    advanceTo(simulation, SECOND_FOLLOWUP_HIT_AT);

    const secondFollowupSnapshot = simulation.getSnapshot();
    const secondTargets = getFollowupTargets(secondFollowupSnapshot, 2);
    const secondTank = getActorById(secondFollowupSnapshot, secondTargets.tankTargetId);
    const secondHealer = getActorById(secondFollowupSnapshot, secondTargets.healerTargetId);
    const secondDps = getActorById(secondFollowupSnapshot, secondTargets.dpsTargetId);

    assert.equal(FIRST_FOLLOWUP_HIT_AT, BUFF_RESOLVE_AT + 3_000);
    assert.equal(SECOND_FOLLOWUP_HIT_AT, FIRST_FOLLOWUP_HIT_AT + 2_000);
    assert.equal(FIRST_FOLLOWUP_TELEGRAPH_AT, FIRST_FOLLOWUP_HIT_AT);
    assert.equal(SECOND_FOLLOWUP_TELEGRAPH_AT, SECOND_FOLLOWUP_HIT_AT);
    assert.equal(INSTANT_TELEGRAPH_MS, 300);
    assert.equal(FOLLOWUP_INJURY_MS, 1_000);
    assert.ok(TANK_SLOTS.includes(secondTank.slot));
    assert.ok(HEALER_SLOTS.includes(secondHealer.slot));
    assert.ok(DPS_SLOTS.includes(secondDps.slot));
    assert.notEqual(
      firstFollowupSnapshot.scriptState[`${FOLLOWUP_TARGETS_KEY_PREFIX}:1`],
      secondFollowupSnapshot.scriptState[`${FOLLOWUP_TARGETS_KEY_PREFIX}:2`],
    );
  });
});

test('凯夫卡P5癫狂交响曲：全 Bot 可以完成当前随机跑法', () => {
  for (let seed = 1; seed <= 12; seed += 1) {
    const snapshot = runKefkaP5WithBots(createSeededRandomValues(seed, 100));

    assert.equal(snapshot.latestResult?.outcome, 'success', `seed ${seed}`);
    assert.equal(snapshot.failureReasons.length, 0, `seed ${seed}`);
    assert.ok(
      snapshot.actors.every((actor) => actor.alive),
      `seed ${seed}`,
    );
  }
});

test('凯夫卡P5癫狂交响曲：首轮命中后赋予核爆和神圣Buff', () => {
  withMockedRandom(createSeededRandomValues(52, 100), () => {
    const simulation = createKefkaP5Simulation();

    advanceTo(simulation, FIRST_HIT_AT);

    const snapshot = simulation.getSnapshot();
    const assignments = getAssignments(snapshot);
    const nuclearTarget = getActorById(snapshot, assignments.nuclearTargetId);
    const holyTarget = getActorById(snapshot, assignments.holyTargetId);

    assert.ok(assignments.firstTankTargetIds.includes(nuclearTarget.id));
    assert.ok(assignments.firstTankTargetIds.includes(holyTarget.id));
    assert.notEqual(nuclearTarget.id, holyTarget.id);
    assert.ok(['MT', 'ST'].includes(nuclearTarget.slot));
    assert.ok(['MT', 'ST'].includes(holyTarget.slot));
    assert.ok(hasStatus(nuclearTarget, NUCLEAR_STATUS_ID));
    assert.ok(hasStatus(holyTarget, HOLY_STATUS_ID));
    assert.equal(
      nuclearTarget.statuses.find((status) => status.id === NUCLEAR_STATUS_ID)?.name,
      '顺手加个核爆',
    );
    assert.equal(
      holyTarget.statuses.find((status) => status.id === HOLY_STATUS_ID)?.name,
      '顺手加个神圣',
    );
  });
});

test('凯夫卡P5癫狂交响曲：非T吃到红色死刑范围即死', () => {
  withMockedRandom(createSeededRandomValues(53, 100), () => {
    const simulation = createKefkaP5Simulation();
    const snapshot = simulation.getSnapshot();
    const mt = getActorBySlot(snapshot, 'MT');
    const h1 = getActorBySlot(snapshot, 'H1');

    submitPose(simulation, h1, mt.position);
    advanceTo(simulation, FIRST_HIT_AT);

    const resolvedH1 = getActorBySlot(simulation.getSnapshot(), 'H1');

    assert.equal(resolvedH1.alive, false);
    assert.equal(resolvedH1.deathReason, '癫狂交响曲死刑');
  });
});

test('凯夫卡P5癫狂交响曲：易伤期间再次受到蓝色范围伤害即死', () => {
  withMockedRandom(createSeededRandomValues(54, 100), () => {
    const simulation = createKefkaP5Simulation();

    advanceTo(simulation, FIRST_HIT_AT);

    const firstSnapshot = simulation.getSnapshot();
    const assignments = getAssignments(firstSnapshot);
    const injuredActor = getActorById(firstSnapshot, assignments.firstDhTargetIds[0]);

    submitPose(simulation, injuredActor, { x: 0, y: 0 });
    advanceTo(simulation, SECOND_HIT_AT);

    const resolvedActor = getActorById(simulation.getSnapshot(), injuredActor.id);

    assert.equal(resolvedActor.alive, false);
    assert.equal(resolvedActor.deathReason, '癫狂交响曲分散');
  });
});

test('凯夫卡P5癫狂交响曲：神圣需要至少4人分摊', () => {
  withMockedRandom(createSeededRandomValues(55, 100), () => {
    const simulation = createKefkaP5Simulation();

    const { assignments, snapshot } = prepareBuffPhase(simulation);
    const holyTarget = getActorById(snapshot, assignments.holyTargetId);
    const nuclearTarget = getActorById(snapshot, assignments.nuclearTargetId);
    const allActorIds = snapshot.actors.map((actor) => actor.id);
    const farPositions = Object.fromEntries(
      allActorIds.map((actorId, index) => [actorId, { x: -12 + index * 4, y: 18.5 }]),
    );

    submitPositions(simulation, snapshot, {
      ...farPositions,
      [holyTarget.id]: { x: -18.5, y: 0 },
      [nuclearTarget.id]: { x: 18.5, y: 0 },
    });
    advanceTo(simulation, BUFF_RESOLVE_AT);

    const resolvedSnapshot = simulation.getSnapshot();
    const resolvedHolyTarget = getActorById(resolvedSnapshot, holyTarget.id);

    assert.equal(resolvedHolyTarget.alive, false);
    assert.equal(resolvedHolyTarget.deathReason, '顺手加个神圣');
    assert.ok(resolvedSnapshot.failureReasons.includes('顺手加个神圣分摊人数不足'));
  });
});

test('凯夫卡P5癫狂交响曲：神圣成功分摊附加3秒易伤，核爆按25m范围判定', () => {
  withMockedRandom(createSeededRandomValues(56, 100), () => {
    const simulation = createKefkaP5Simulation();

    const { assignments, snapshot } = prepareBuffPhase(simulation);
    const holyTarget = getActorById(snapshot, assignments.holyTargetId);
    const nuclearTarget = getActorById(snapshot, assignments.nuclearTargetId);
    const holyHelperIds = getFirstTargetIds(assignments).filter(
      (actorId) => actorId !== holyTarget.id && actorId !== nuclearTarget.id,
    );
    assert.equal(holyHelperIds.length, 3);

    const holyStackIds = [holyTarget.id, ...holyHelperIds];
    const spreadOutPositions = Object.fromEntries(
      snapshot.actors.map((actor, index) => [actor.id, { x: -14 + index * 4, y: 18.5 }]),
    );
    const positionsByActorId = Object.fromEntries(
      holyStackIds.map((actorId) => [actorId, { x: -18.5, y: 0 }]),
    );
    Object.assign(positionsByActorId, {
      ...spreadOutPositions,
      ...positionsByActorId,
    });
    positionsByActorId[nuclearTarget.id] = { x: 18.5, y: 0 };

    submitPositions(simulation, snapshot, positionsByActorId);
    advanceTo(simulation, BUFF_RESOLVE_AT);

    const resolvedSnapshot = simulation.getSnapshot();
    const holyStack = holyStackIds.map((actorId) => getActorById(resolvedSnapshot, actorId));
    const resolvedNuclearTarget = getActorById(resolvedSnapshot, nuclearTarget.id);
    const holyMarker = resolvedSnapshot.mechanics.find(
      (mechanic) =>
        mechanic.kind === 'actorMarker' &&
        mechanic.label === '顺手加个神圣' &&
        mechanic.radius === HOLY_SHARE_RADIUS,
    );
    const nuclearTelegraph = resolvedSnapshot.mechanics.find(
      (mechanic) =>
        mechanic.kind === 'circleTelegraph' &&
        mechanic.label === '顺手加个核爆' &&
        mechanic.radius === NUCLEAR_RADIUS,
    );

    assert.ok(holyMarker);
    assert.ok(nuclearTelegraph);
    assert.ok(holyStack.every((actor) => actor.alive && hasStatus(actor, 'injury_up')));
    assert.ok(hasStatus(resolvedNuclearTarget, 'injury_up') || !resolvedNuclearTarget.alive);
  });
});
