import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '@ff14arena/core';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { getBattleBotController, getBattleDefinition, getBattleStaticData } from '../src/index.ts';
import { KEFKA_P5_THREE_STARS_TESTING } from '../src/battles/kefka-p5-three-stars.ts';

const {
  TOWERS_SPAWN_AT,
  INITIAL_VULNERABILITY_MS,
  FIRST_LIGHT_AT,
  FIRST_RESOLVE_AT,
  COMPLETE_AT,
  TOWER_DISTANCE,
  TOWER_COUNT,
  DISASTER_CAST_MS,
  DISASTER_START_ATS,
  DISASTER_TELEGRAPH_MS,
  BOSS_OVERLAY_RADIUS,
  PLAN_KEY,
  ELEMENTS,
  ELEMENT_STATUS_IDS,
  ELEMENT_TOWER_COLORS,
  TOWER_GROUP_INDEXES,
  KEFKA_MAP_MARKERS,
  INITIAL_POSITIONS,
  getTowerPosition,
  getKefkaP5ThreeStarsBotTarget,
} = KEFKA_P5_THREE_STARS_TESTING;

function createKefkaP5ThreeStarsSimulation(kind = 'player') {
  const battle = getBattleDefinition('kefka_p5_three_stars');
  assert.ok(battle);

  const simulation = createSimulation();
  simulation.loadBattle({
    battle,
    roomId: `kefka-p5-three-stars-${kind}-test-room`,
    party: PARTY_SLOT_ORDER.map((slot) => ({
      slot,
      name: slot,
      kind,
      actorId: `${kind}_${slot}`,
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

function getPlan(snapshot) {
  const plan = snapshot.scriptState[PLAN_KEY];
  assert.ok(plan);

  return plan;
}

function getActorById(snapshot, actorId) {
  const actor = snapshot.actors.find((candidate) => candidate.id === actorId);
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

function assertNear(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) <= 0.001, `${label}: expected ${expected}, got ${actual}`);
}

function createTestTowerPlan({ assignments, idleActorIds, groupElements, rounds }) {
  const towers = Array.from({ length: TOWER_COUNT }, (_, index) => {
    const group = index === 8 || index <= 1 ? 'bottom' : index <= 4 ? 'leftUpper' : 'rightUpper';

    return {
      index,
      group,
      element: groupElements[group],
      position: getTowerPosition(index),
    };
  });

  return {
    assignments,
    idleActorIds,
    towers,
    rounds,
    disasters: [],
  };
}

function getAssignmentElement(plan, actorId) {
  return plan.assignments.find((assignment) => assignment.actorId === actorId)?.element ?? null;
}

function choosePairsForRound(snapshot, plan, round, killTowerIndex) {
  const actorIds = snapshot.actors.map((actor) => actor.id);
  const killTower = plan.towers[killTowerIndex];
  const killActorIds = plan.assignments
    .filter((assignment) => assignment.element === killTower.element)
    .map((assignment) => assignment.actorId);
  const remainingTowerIndexes = round.towerIndexes.filter(
    (towerIndex) => towerIndex !== killTowerIndex,
  );
  const result = new Map([[killTowerIndex, killActorIds]]);
  const usedActorIds = new Set(killActorIds);

  function search(towerOffset) {
    if (towerOffset >= remainingTowerIndexes.length) {
      return true;
    }

    const towerIndex = remainingTowerIndexes[towerOffset];
    const tower = plan.towers[towerIndex];
    const candidates = actorIds.filter(
      (actorId) =>
        !usedActorIds.has(actorId) && getAssignmentElement(plan, actorId) !== tower.element,
    );

    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
        const pair = [candidates[leftIndex], candidates[rightIndex]];
        usedActorIds.add(pair[0]);
        usedActorIds.add(pair[1]);
        result.set(towerIndex, pair);

        if (search(towerOffset + 1)) {
          return true;
        }

        result.delete(towerIndex);
        usedActorIds.delete(pair[0]);
        usedActorIds.delete(pair[1]);
      }
    }

    return false;
  }

  assert.ok(search(0), '应能生成完整塔处理站位');
  return result;
}

function submitBotFrames(simulation, controller) {
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
      issuedAt: snapshot.timeMs,
      ...frame,
    });
  }
}

function advanceWithBotControls(simulation, timeMs) {
  const controller = getBattleBotController('kefka_p5_three_stars');
  assert.ok(controller);

  while (simulation.running && simulation.getSnapshot().timeMs < timeMs) {
    submitBotFrames(simulation, controller);
    simulation.tick(Math.min(50, timeMs - simulation.getSnapshot().timeMs));
  }
}

function runKefkaP5ThreeStarsWithBots() {
  const simulation = createKefkaP5ThreeStarsSimulation('bot');

  advanceWithBotControls(simulation, COMPLETE_AT + 2_000);

  return simulation.getSnapshot();
}

test('凯夫卡P5三星：战斗、Bot 和状态元数据已登记', () => {
  const battle = getBattleDefinition('kefka_p5_three_stars');
  assert.ok(battle);

  assert.equal(battle.name, '凯夫卡P5：三星');
  assert.deepEqual(battle.mapMarkers, KEFKA_MAP_MARKERS);
  assert.ok(getBattleBotController('kefka_p5_three_stars'));

  const staticData = getBattleStaticData('kefka_p5_three_stars');
  assert.ok(staticData);
  assert.deepEqual(
    staticData.statusMetadata
      .map((status) => status.id)
      .filter((statusId) => statusId.startsWith('kefka_p5_three_stars_')),
    [ELEMENT_STATUS_IDS.ice, ELEMENT_STATUS_IDS.fire, ELEMENT_STATUS_IDS.lightning],
  );
});

test('凯夫卡P5三星：塔位、塔色、亮塔和重复颜色满足规则', () => {
  const simulation = createKefkaP5ThreeStarsSimulation();
  const initialSnapshot = simulation.getSnapshot();

  for (const slot of PARTY_SLOT_ORDER) {
    const placement = getBattleDefinition('kefka_p5_three_stars').initialPartyPositions[slot];
    const expected = INITIAL_POSITIONS[slot];

    assertNear(placement.position.x, expected.x, `${slot} 初始 x`);
    assertNear(placement.position.y, expected.y, `${slot} 初始 y`);
  }

  const plan = getPlan(initialSnapshot);
  assert.equal(plan.towers.length, TOWER_COUNT);
  assert.equal(new Set(plan.towers.map((tower) => tower.element)).size, ELEMENTS.length);
  assert.equal(new Set(plan.rounds.map((round) => round.repeatElement)).size, ELEMENTS.length);

  for (const tower of plan.towers) {
    assertNear(
      pointDistance(tower.position, { x: 0, y: 0 }),
      TOWER_DISTANCE,
      `塔${tower.index}半径`,
    );
    assertNear(
      pointDistance(tower.position, getTowerPosition(tower.index)),
      0,
      `塔${tower.index}位置`,
    );
  }

  for (const indexes of Object.values(TOWER_GROUP_INDEXES)) {
    const groupElements = new Set(indexes.map((towerIndex) => plan.towers[towerIndex].element));
    assert.equal(groupElements.size, 1);
  }

  for (const [roundIndex, round] of plan.rounds.entries()) {
    assert.equal(round.towerIndexes.length, 4);
    assert.equal(round.lightAt, FIRST_LIGHT_AT + roundIndex * 6_000);
    assert.equal(round.resolveAt, FIRST_RESOLVE_AT + roundIndex * 6_000);

    const elementCounts = new Map(ELEMENTS.map((element) => [element, 0]));

    for (const towerIndex of round.towerIndexes) {
      const element = plan.towers[towerIndex].element;
      elementCounts.set(element, elementCounts.get(element) + 1);
    }

    assert.deepEqual([...elementCounts.values()].sort(), [1, 1, 2]);
    assert.equal(elementCounts.get(round.repeatElement), 2);

    if (roundIndex > 0) {
      const previousTowerIndexes = new Set(plan.rounds[roundIndex - 1].towerIndexes);
      assert.equal(
        round.towerIndexes.some((towerIndex) => previousTowerIndexes.has(towerIndex)),
        false,
      );
    }
  }

  advanceTo(simulation, TOWERS_SPAWN_AT);
  const towerSnapshot = simulation.getSnapshot();
  const baseTowers = towerSnapshot.mechanics.filter((mechanic) => mechanic.kind === 'tower');
  assert.equal(baseTowers.length, TOWER_COUNT);
  assert.ok(baseTowers.every((tower) => Object.values(ELEMENT_TOWER_COLORS).includes(tower.color)));
  assert.ok(baseTowers.every((tower) => tower.filled === false));

  for (const element of ELEMENTS) {
    const actorsWithStatus = towerSnapshot.actors.filter((actor) =>
      actor.statuses.some((status) => status.id === ELEMENT_STATUS_IDS[element]),
    );
    assert.equal(actorsWithStatus.length, 2);

    for (const actor of actorsWithStatus) {
      const status = actor.statuses.find(
        (candidate) => candidate.id === ELEMENT_STATUS_IDS[element],
      );
      assert.equal(status.expiresAt, TOWERS_SPAWN_AT + INITIAL_VULNERABILITY_MS);
    }
  }

  advanceTo(simulation, FIRST_LIGHT_AT);
  const lightSnapshot = simulation.getSnapshot();
  assert.equal(
    lightSnapshot.mechanics.filter((mechanic) => mechanic.kind === 'tower').length,
    TOWER_COUNT + 4,
  );
  assert.equal(
    lightSnapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'tower' && mechanic.filled === true,
    ).length,
    4,
  );
});

test('凯夫卡P5三星：同属性易伤踩塔即死，空塔触发团灭', () => {
  {
    const simulation = createKefkaP5ThreeStarsSimulation();
    advanceTo(simulation, FIRST_LIGHT_AT);

    const snapshot = simulation.getSnapshot();
    const plan = getPlan(snapshot);
    const round = plan.rounds[0];
    const killTowerIndex = round.towerIndexes[0];
    const handlersByTower = choosePairsForRound(snapshot, plan, round, killTowerIndex);

    for (const [towerIndex, actorIds] of handlersByTower.entries()) {
      const tower = plan.towers[towerIndex];

      for (const actorId of actorIds) {
        submitPose(simulation, getActorById(snapshot, actorId), tower.position);
      }
    }

    advanceTo(simulation, FIRST_RESOLVE_AT);

    const resolvedSnapshot = simulation.getSnapshot();
    const killTower = plan.towers[killTowerIndex];
    const killedActorIds = handlersByTower.get(killTowerIndex);

    for (const actorId of killedActorIds) {
      assert.equal(
        getActorById(resolvedSnapshot, actorId).deathReason,
        `三星${killTower.element === 'fire' ? '火' : killTower.element === 'ice' ? '冰' : '雷'}塔`,
      );
    }
  }

  {
    const simulation = createKefkaP5ThreeStarsSimulation();
    advanceTo(simulation, FIRST_LIGHT_AT);

    const snapshot = simulation.getSnapshot();

    for (const actor of snapshot.actors) {
      submitPose(simulation, actor, { x: 0, y: 0 });
    }

    advanceTo(simulation, FIRST_RESOLVE_AT);

    const resolvedSnapshot = simulation.getSnapshot();
    assert.ok(resolvedSnapshot.failureReasons.includes('三星塔无人处理'));
    assert.ok(resolvedSnapshot.actors.every((actor) => actor.deathReason === '三星塔无人处理'));
  }
});

test('凯夫卡P5三星：二选一灾祟读条和预兆按随机结果显示', () => {
  const simulation = createKefkaP5ThreeStarsSimulation('bot');
  const plan = getPlan(simulation.getSnapshot());

  advanceWithBotControls(simulation, DISASTER_START_ATS[0]);
  const snapshot = simulation.getSnapshot();
  const disaster = plan.disasters[0];

  assert.equal(snapshot.boss.castBar.actionName, '二选一的灾祟');
  assert.equal(snapshot.boss.castBar.totalDurationMs, DISASTER_CAST_MS);
  assert.equal(
    snapshot.mechanics.filter(
      (mechanic) =>
        mechanic.kind === 'circleTelegraph' &&
        mechanic.label ===
          (disaster.mode === 'wind' ? '二选一的灾祟风提示' : '二选一的灾祟土提示') &&
        mechanic.radius === BOSS_OVERLAY_RADIUS,
    ).length,
    1,
  );
  assert.equal(
    snapshot.mechanics.some(
      (mechanic) =>
        (mechanic.kind === 'donutTelegraph' && mechanic.label === '风月环') ||
        (mechanic.kind === 'circleTelegraph' && mechanic.label === '土大圈'),
    ),
    false,
  );

  advanceWithBotControls(simulation, disaster.resolveAt - DISASTER_TELEGRAPH_MS + 1);
  const telegraphSnapshot = simulation.getSnapshot();

  if (disaster.mode === 'wind') {
    assert.ok(
      telegraphSnapshot.mechanics.some(
        (mechanic) =>
          mechanic.kind === 'donutTelegraph' &&
          mechanic.label === '风月环' &&
          mechanic.innerRadius === 10 &&
          mechanic.outerRadius === 40,
      ),
    );
  } else {
    assert.ok(
      telegraphSnapshot.mechanics.some(
        (mechanic) =>
          mechanic.kind === 'circleTelegraph' &&
          mechanic.label === '土大圈' &&
          mechanic.radius === 10,
      ),
    );
  }
});

test('凯夫卡P5三星：Bot 同塔双人会错开站位', () => {
  const controller = getBattleBotController('kefka_p5_three_stars');
  assert.ok(controller);

  const simulation = createKefkaP5ThreeStarsSimulation('bot');
  advanceTo(simulation, FIRST_LIGHT_AT);

  const snapshot = simulation.getSnapshot();
  const plan = getPlan(snapshot);
  const round = plan.rounds[0];
  const targetsByTower = new Map();

  for (const actor of snapshot.actors) {
    if (actor.slot === null) {
      continue;
    }

    const frame = controller({ snapshot, slot: actor.slot, actor });
    assert.ok(frame.pose);
    const target = getKefkaP5ThreeStarsBotTarget(actor, snapshot.timeMs, snapshot.scriptState);
    const tower = round.towerIndexes
      .map((towerIndex) => plan.towers[towerIndex])
      .find((candidate) => pointDistance(target, candidate.position) <= 1.2);

    if (tower === undefined) {
      continue;
    }

    targetsByTower.set(tower.index, [...(targetsByTower.get(tower.index) ?? []), target]);
  }

  const sameTowerTargets = [...targetsByTower.values()].find((targets) => targets.length === 2);
  assert.ok(sameTowerTargets);
  assert.ok(pointDistance(sameTowerTargets[0], sameTowerTargets[1]) > 0.5);
});

test('凯夫卡P5三星：Bot 闲人处理 C 点附近重复塔时按 8-0-1 回绕取第二座', () => {
  const simulation = createKefkaP5ThreeStarsSimulation('bot');
  const snapshot = simulation.getSnapshot();
  const idleActor = getActorById(snapshot, 'bot_D3');
  const plan = createTestTowerPlan({
    assignments: PARTY_SLOT_ORDER.slice(0, 6).map((slot, index) => ({
      actorId: `bot_${slot}`,
      element: ELEMENTS[Math.floor(index / 2)],
    })),
    idleActorIds: ['bot_D3', 'bot_D4'],
    groupElements: {
      bottom: 'fire',
      leftUpper: 'ice',
      rightUpper: 'lightning',
    },
    rounds: [
      {
        index: 0,
        lightAt: FIRST_LIGHT_AT,
        resolveAt: FIRST_RESOLVE_AT,
        repeatElement: 'fire',
        towerIndexes: [8, 0, 2, 3],
      },
    ],
  });

  const target = getKefkaP5ThreeStarsBotTarget(idleActor, FIRST_LIGHT_AT, {
    [PLAN_KEY]: plan,
  });

  assert.ok(pointDistance(target, getTowerPosition(0)) < 1);
});

test('凯夫卡P5三星：Bot 初始易伤按本局塔色顺时针顺序推格', () => {
  const simulation = createKefkaP5ThreeStarsSimulation('bot');
  const snapshot = simulation.getSnapshot();
  const actor = getActorById(snapshot, 'bot_MT');
  const plan = createTestTowerPlan({
    assignments: [{ actorId: 'bot_MT', element: 'ice' }],
    idleActorIds: [],
    groupElements: {
      bottom: 'ice',
      leftUpper: 'fire',
      rightUpper: 'lightning',
    },
    rounds: [
      {
        index: 0,
        lightAt: FIRST_LIGHT_AT,
        resolveAt: FIRST_RESOLVE_AT,
        repeatElement: 'fire',
        towerIndexes: [2, 3, 5, 8],
      },
      {
        index: 1,
        lightAt: FIRST_LIGHT_AT + 6_000,
        resolveAt: FIRST_RESOLVE_AT + 6_000,
        repeatElement: 'lightning',
        towerIndexes: [0, 4, 5, 6],
      },
      {
        index: 2,
        lightAt: FIRST_LIGHT_AT + 12_000,
        resolveAt: FIRST_RESOLVE_AT + 12_000,
        repeatElement: 'ice',
        towerIndexes: [1, 7, 8, 3],
      },
    ],
  });

  const targets = plan.rounds.map((round) =>
    getKefkaP5ThreeStarsBotTarget(actor, round.lightAt, { [PLAN_KEY]: plan }),
  );

  assert.ok(pointDistance(targets[0], getTowerPosition(2)) < 1);
  assert.ok(pointDistance(targets[1], getTowerPosition(5)) < 1);
  assert.ok(pointDistance(targets[2], getTowerPosition(8)) < 1);
});

test('凯夫卡P5三星：第三轮判定时初始易伤已消失，且全 Bot 可完成随机跑法', () => {
  for (let runIndex = 0; runIndex < 8; runIndex += 1) {
    const snapshot = runKefkaP5ThreeStarsWithBots();

    assert.equal(snapshot.latestResult?.outcome, 'success', `第 ${runIndex + 1} 次随机应成功`);
    assert.deepEqual(snapshot.failureReasons, []);
    assert.ok(
      snapshot.actors.every((actor) => actor.alive),
      `第 ${runIndex + 1} 次随机不应死人`,
    );
  }
});
