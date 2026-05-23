import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '@ff14arena/core';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { getBattleBotController, getBattleDefinition } from '../src/index.ts';

const TH_SLOTS = ['MT', 'ST', 'H1', 'H2'];
const DPS_SLOTS = ['D1', 'D2', 'D3', 'D4'];
const TOWER_POSITIONS = [
  { x: 0, y: -9 },
  { x: 0, y: 9 },
];
const TOWER_RADIUS = 3;
const LIGHT_MIN_DISTANCE = 17;
const LIGHT_MAX_DISTANCE = 23;
const FAN_HALF_ANGLE_RAD = Math.PI / 12;
const ARENA_RADIUS = 20;

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

function createEdenP4Simulation() {
  const battle = getBattleDefinition('eden_p4_special');
  assert.ok(battle);

  const simulation = createSimulation();
  simulation.loadBattle({
    battle,
    roomId: 'eden-p4-special-test-room',
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

function createEdenP4BotSimulation() {
  const battle = getBattleDefinition('eden_p4_special');
  assert.ok(battle);

  const simulation = createSimulation();
  simulation.loadBattle({
    battle,
    roomId: 'eden-p4-special-bot-test-room',
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

function submitPose(simulation, actor, position, inputSeq) {
  simulation.submitActorControlFrame({
    actorId: actor.id,
    inputSeq,
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

function getDistance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function getAngleDiff(left, right) {
  const diff = Math.abs(left - right) % (Math.PI * 2);

  return diff > Math.PI ? Math.PI * 2 - diff : diff;
}

function getClockwiseAngleFromNorth(position) {
  const angle = Math.atan2(position.x, -position.y);

  return angle < 0 ? angle + Math.PI * 2 : angle;
}

function isInsideFan(actor, direction) {
  if (getDistance(actor.position, { x: 0, y: 0 }) > ARENA_RADIUS) {
    return false;
  }

  if (getDistance(actor.position, { x: 0, y: 0 }) === 0) {
    return true;
  }

  return (
    getAngleDiff(Math.atan2(actor.position.y, actor.position.x), direction) <= FAN_HALF_ANGLE_RAD
  );
}

function areDpsSlotsAlternating(sortedSlots) {
  const dpsIndexes = sortedSlots
    .map((slot, index) => (DPS_SLOTS.includes(slot) ? index : -1))
    .filter((index) => index >= 0);

  return (
    dpsIndexes.length === 4 &&
    (dpsIndexes.every((index) => index % 2 === 0) || dpsIndexes.every((index) => index % 2 === 1))
  );
}

function areDpsSlotsConsecutive(sortedSlots) {
  const dpsIndexSet = new Set(
    sortedSlots
      .map((slot, index) => (DPS_SLOTS.includes(slot) ? index : -1))
      .filter((index) => index >= 0),
  );

  for (let start = 0; start < sortedSlots.length; start += 1) {
    if ([0, 1, 2, 3].every((offset) => dpsIndexSet.has((start + offset) % sortedSlots.length))) {
      return true;
    }
  }

  return false;
}

function lightOrderHasInternalTether(lightOrder) {
  return lightOrder.some((slot, index) => {
    const nextSlot = lightOrder[(index + 1) % lightOrder.length];
    const bothTh = TH_SLOTS.includes(slot) && TH_SLOTS.includes(nextSlot);
    const bothDps = DPS_SLOTS.includes(slot) && DPS_SLOTS.includes(nextSlot);

    return bothTh || bothDps;
  });
}

function getActorBySlot(snapshot, slot) {
  const actor = snapshot.actors.find((candidate) => candidate.slot === slot);
  assert.ok(actor);

  return actor;
}

function runEdenP4WithBots(randomValues) {
  return withMockedRandom(randomValues, () => {
    const controller = getBattleBotController('eden_p4_special');
    assert.ok(controller);

    const simulation = createEdenP4BotSimulation();
    let inputSeq = 0;
    let assignmentSnapshot = null;

    for (let elapsedMs = 0; elapsedMs <= 25_000 && simulation.running; elapsedMs += 50) {
      const snapshot = simulation.getSnapshot();

      if (snapshot.scriptState['edenP4:assignments'] !== undefined && assignmentSnapshot === null) {
        assignmentSnapshot = snapshot;
      }

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
          inputSeq: ++inputSeq,
          issuedAt: elapsedMs,
          ...frame,
        });
      }

      simulation.tick(50);
    }

    return {
      assignmentSnapshot,
      finalSnapshot: simulation.getSnapshot(),
    };
  });
}

function isNoSwap1SameHalfAssignment(snapshot) {
  const assignments = snapshot.scriptState['edenP4:assignments'];
  assert.ok(assignments);

  if (lightOrderHasInternalTether(assignments.lightOrder)) {
    return false;
  }

  const darkWaterActors = assignments.darkWaterSlots.map((slot) => getActorBySlot(snapshot, slot));

  return (
    Math.sign(darkWaterActors[0].position.y) !== 0 &&
    Math.sign(darkWaterActors[0].position.y) === Math.sign(darkWaterActors[1].position.y)
  );
}

function getPermutations(items, length = items.length) {
  if (length === 0) {
    return [[]];
  }

  return items.flatMap((item, index) =>
    getPermutations([...items.slice(0, index), ...items.slice(index + 1)], length - 1).map(
      (tail) => [item, ...tail],
    ),
  );
}

function getFanHitCounts(placement) {
  const actors = PARTY_SLOT_ORDER.map((slot) => ({
    slot,
    position: placement[slot],
  }));
  const fanTargets = actors
    .toSorted(
      (left, right) =>
        getDistance(left.position, { x: 0, y: 0 }) - getDistance(right.position, { x: 0, y: 0 }),
    )
    .slice(0, 4);
  const hitCounts = new Map();

  for (const target of fanTargets) {
    const direction = Math.atan2(target.position.y, target.position.x);

    for (const actor of actors) {
      if (isInsideFan(actor, direction)) {
        hitCounts.set(actor.slot, (hitCounts.get(actor.slot) ?? 0) + 1);
      }
    }
  }

  return hitCounts;
}

function hasValidDpsArrangement(placement) {
  const sortedSlots = PARTY_SLOT_ORDER.toSorted(
    (left, right) =>
      getClockwiseAngleFromNorth(placement[left]) - getClockwiseAngleFromNorth(placement[right]),
  );

  return areDpsSlotsAlternating(sortedSlots) || areDpsSlotsConsecutive(sortedSlots);
}

function isValidPlacement(assignments, placement) {
  for (const [index, slot] of assignments.lightOrder.entries()) {
    const nextSlot = assignments.lightOrder[(index + 1) % assignments.lightOrder.length];
    const tetherDistance = getDistance(placement[slot], placement[nextSlot]);

    if (tetherDistance < LIGHT_MIN_DISTANCE || tetherDistance > LIGHT_MAX_DISTANCE) {
      return false;
    }
  }

  for (const towerPosition of TOWER_POSITIONS) {
    const hits = assignments.lightOrder.filter(
      (slot) => getDistance(placement[slot], towerPosition) <= TOWER_RADIUS,
    );

    if (hits.length !== 2) {
      return false;
    }
  }

  const darkWaterHalves = assignments.darkWaterSlots.map((slot) => Math.sign(placement[slot].y));

  if (darkWaterHalves.includes(0) || darkWaterHalves[0] === darkWaterHalves[1]) {
    return false;
  }

  if (!hasValidDpsArrangement(placement)) {
    return false;
  }

  const lightSlotSet = new Set(assignments.lightOrder);
  const hitCounts = getFanHitCounts(placement);

  return PARTY_SLOT_ORDER.every((slot) => {
    const hitCount = hitCounts.get(slot) ?? 0;

    return (!lightSlotSet.has(slot) || hitCount === 0) && hitCount <= 1;
  });
}

function findValidPlacement(assignments) {
  const towerPairByHalf = {
    north: [
      { x: -0.6, y: -9 },
      { x: 0.6, y: -9 },
    ],
    south: [
      { x: -0.6, y: 9 },
      { x: 0.6, y: 9 },
    ],
  };
  const baitPositions = Array.from({ length: 8 }, (_, index) => {
    const angle = ((22.5 + index * 45) * Math.PI) / 180;

    return {
      x: Math.cos(angle) * 4,
      y: Math.sin(angle) * 4,
    };
  });
  const parityGroups = [
    [assignments.lightOrder[0], assignments.lightOrder[2]],
    [assignments.lightOrder[1], assignments.lightOrder[3]],
  ];
  const nonLightSlots = PARTY_SLOT_ORDER.filter((slot) => !assignments.lightOrder.includes(slot));

  for (const northParity of [0, 1]) {
    const southParity = 1 - northParity;

    for (const northPositions of getPermutations(towerPairByHalf.north)) {
      for (const southPositions of getPermutations(towerPairByHalf.south)) {
        const lightPlacement = {};
        parityGroups[northParity].forEach((slot, index) => {
          lightPlacement[slot] = northPositions[index];
        });
        parityGroups[southParity].forEach((slot, index) => {
          lightPlacement[slot] = southPositions[index];
        });

        for (const baitPermutation of getPermutations(baitPositions, nonLightSlots.length)) {
          const placement = { ...lightPlacement };
          nonLightSlots.forEach((slot, index) => {
            placement[slot] = baitPermutation[index];
          });

          if (isValidPlacement(assignments, placement)) {
            return placement;
          }
        }
      }
    }
  }

  throw new Error('missing valid Eden P4 placement for test assignments');
}

function findRepeatedFanHitPlacement(assignments) {
  const placement = findValidPlacement(assignments);
  const lightSlotSet = new Set(assignments.lightOrder);
  const darkWaterSlotSet = new Set(assignments.darkWaterSlots);
  const repeatedHitCandidates = PARTY_SLOT_ORDER.filter(
    (slot) => !lightSlotSet.has(slot) && !darkWaterSlotSet.has(slot),
  );

  for (const repeatedSlot of repeatedHitCandidates) {
    const repeatedPlacement = {
      ...placement,
      [repeatedSlot]: { x: 0, y: 0 },
    };

    if (!hasValidDpsArrangement(repeatedPlacement)) {
      continue;
    }

    const hitCounts = getFanHitCounts(repeatedPlacement);
    const lightHit = assignments.lightOrder.some((slot) => (hitCounts.get(slot) ?? 0) > 0);

    if (!lightHit && (hitCounts.get(repeatedSlot) ?? 0) >= 2) {
      return {
        placement: repeatedPlacement,
        repeatedSlot,
      };
    }
  }

  throw new Error('missing repeated fan hit placement for test assignments');
}

test('伊甸P4特殊：场地、标点和开场读条正确', () => {
  const simulation = createEdenP4Simulation();
  const initialSnapshot = simulation.getSnapshot();

  assert.equal(initialSnapshot.arenaRadius, 20);
  assert.equal(initialSnapshot.bossTargetRingRadius, 5);
  assert.deepEqual(
    initialSnapshot.mapMarkers.map((marker) => marker.label),
    ['A', '2', 'B', '3', 'C', '4', 'D', '1'],
  );
  assert.ok(
    initialSnapshot.mapMarkers.every(
      (marker) => Math.round(getDistance(marker.position, { x: 0, y: 0 })) === 10,
    ),
  );

  advanceTo(simulation, 3_000);
  assert.equal(simulation.getSnapshot().boss.castBar?.actionName, '光与暗的龙诗');
  assert.equal(simulation.getSnapshot().boss.castBar?.totalDurationMs, 5_000);
});

test('伊甸P4特殊：光与暗的龙诗结束后生成点名、闭合连线、标记和双塔', () =>
  withMockedRandom(createSeededRandomValues(1, 64), () => {
    const simulation = createEdenP4Simulation();

    advanceTo(simulation, 8_000);
    const snapshot = simulation.getSnapshot();
    const assignments = snapshot.scriptState['edenP4:assignments'];
    assert.ok(assignments);
    assert.equal(assignments.lightOrder.length, 4);
    assert.equal(assignments.darkWaterSlots.length, 2);
    assert.equal(new Set(assignments.lightOrder).size, 4);
    assert.equal(assignments.lightOrder.filter((slot) => ['MT', 'ST'].includes(slot)).length, 1);
    assert.equal(assignments.lightOrder.filter((slot) => ['H1', 'H2'].includes(slot)).length, 1);
    assert.equal(assignments.lightOrder.filter((slot) => DPS_SLOTS.includes(slot)).length, 2);
    assert.ok(assignments.lightOrder.includes(assignments.darkWaterSlots[0]));
    assert.ok(!assignments.lightOrder.includes(assignments.darkWaterSlots[1]));
    assert.equal(
      snapshot.actors.filter((actor) =>
        actor.statuses.some((status) => status.id === 'eden_p4_light_lock'),
      ).length,
      4,
    );
    assert.equal(
      snapshot.actors.filter((actor) =>
        actor.statuses.some((status) => status.id === 'eden_p4_dark_water'),
      ).length,
      2,
    );
    assert.equal(
      snapshot.mechanics.filter(
        (mechanic) => mechanic.kind === 'tether' && mechanic.label === '光之锁连线',
      ).length,
      4,
    );
    assert.equal(
      snapshot.mechanics.filter((mechanic) => mechanic.kind === 'actorMarker').length,
      2,
    );
    assert.equal(snapshot.mechanics.filter((mechanic) => mechanic.kind === 'tower').length, 2);
    assert.equal(snapshot.boss.castBar?.actionName, '光之波动');
    assert.equal(snapshot.boss.castBar?.totalDurationMs, 11_000);
  }));

test('伊甸P4特殊：合法站位可以通过光之波动结算', () =>
  withMockedRandom(createSeededRandomValues(2, 64), () => {
    const simulation = createEdenP4Simulation();
    let inputSeq = 0;

    advanceTo(simulation, 8_000);
    const snapshot = simulation.getSnapshot();
    const assignments = snapshot.scriptState['edenP4:assignments'];
    const placement = findValidPlacement(assignments);

    for (const actor of snapshot.actors) {
      submitPose(simulation, actor, placement[actor.slot], ++inputSeq);
    }

    advanceTo(simulation, 18_500);
    assert.equal(
      simulation.getSnapshot().mechanics.filter((mechanic) => mechanic.kind === 'fanTelegraph')
        .length,
      4,
    );

    advanceTo(simulation, 19_050);
    const result = simulation.getSnapshot().latestResult;
    assert.ok(result);
    assert.equal(result.outcome, 'success');
    assert.deepEqual(result.failureReasons, []);
  }));

test('伊甸P4特殊：非束缚玩家同次光之波动内重复吃扇形会死亡', () =>
  withMockedRandom(createSeededRandomValues(5, 64), () => {
    const simulation = createEdenP4Simulation();
    let inputSeq = 0;

    advanceTo(simulation, 8_000);
    const snapshot = simulation.getSnapshot();
    const assignments = snapshot.scriptState['edenP4:assignments'];
    const { placement, repeatedSlot } = findRepeatedFanHitPlacement(assignments);

    for (const actor of snapshot.actors) {
      submitPose(simulation, actor, placement[actor.slot], ++inputSeq);
    }

    advanceTo(simulation, 19_050);
    const repeatedActor = simulation
      .getSnapshot()
      .actors.find((actor) => actor.slot === repeatedSlot);
    assert.ok(repeatedActor);
    assert.equal(repeatedActor.alive, false);
    assert.equal(repeatedActor.deathReason, '光之波动扇形易伤');
    assert.ok(
      simulation.getSnapshot().failureReasons.includes(`${repeatedSlot} 因 光之波动扇形易伤 死亡`),
      simulation.getSnapshot().failureReasons.join(','),
    );
  }));

test('伊甸P4特殊：光之束缚连线长度不合规会团灭', () =>
  withMockedRandom(createSeededRandomValues(3, 64), () => {
    const simulation = createEdenP4Simulation();
    let inputSeq = 0;

    advanceTo(simulation, 8_000);
    const snapshot = simulation.getSnapshot();
    const assignments = snapshot.scriptState['edenP4:assignments'];

    for (const actor of snapshot.actors.filter((candidate) =>
      assignments.lightOrder.includes(candidate.slot),
    )) {
      submitPose(simulation, actor, { x: 0, y: 0 }, ++inputSeq);
    }

    advanceTo(simulation, 15_050);
    assert.ok(
      simulation.getSnapshot().failureReasons.includes('光之束缚连线长度错误'),
      simulation.getSnapshot().failureReasons.join(','),
    );
    assert.ok(simulation.getSnapshot().actors.every((actor) => !actor.alive));
  }));

test('伊甸P4特殊：黑暗狂水没有分处上下半场会团灭', () =>
  withMockedRandom(createSeededRandomValues(4, 64), () => {
    const simulation = createEdenP4Simulation();
    let inputSeq = 0;

    advanceTo(simulation, 8_000);
    const snapshot = simulation.getSnapshot();
    const assignments = snapshot.scriptState['edenP4:assignments'];
    const placement = findValidPlacement(assignments);
    const lockedDarkWaterPosition = placement[assignments.darkWaterSlots[0]];
    placement[assignments.darkWaterSlots[1]] = {
      x: 4,
      y: lockedDarkWaterPosition.y > 0 ? 4 : -4,
    };

    for (const actor of snapshot.actors) {
      submitPose(simulation, actor, placement[actor.slot], ++inputSeq);
    }

    advanceTo(simulation, 19_050);
    assert.ok(
      simulation.getSnapshot().failureReasons.includes('黑暗狂水未分处上下半场'),
      simulation.getSnapshot().failureReasons.join(','),
    );
    assert.ok(simulation.getSnapshot().actors.every((actor) => !actor.alive));
  }));

test('伊甸P4特殊：Bot controller 已登记', () => {
  assert.ok(getBattleBotController('eden_p4_special'));
});

test('伊甸P4特殊：全 Bot 可以完成多组随机跑法', () => {
  for (let seed = 1; seed <= 24; seed += 1) {
    const { finalSnapshot } = runEdenP4WithBots(createSeededRandomValues(seed, 64));
    const result = finalSnapshot.latestResult;

    assert.ok(result, `seed ${seed} 缺少结算结果`);
    assert.equal(result.outcome, 'success', `seed ${seed}: ${result.failureReasons.join(',')}`);
    assert.deepEqual(result.failureReasons, []);
  }
});

test('伊甸P4特殊：Bot 未换位1时通过狂水对角扇形交换保持 DPS 排列', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const { assignmentSnapshot, finalSnapshot } = runEdenP4WithBots(
      createSeededRandomValues(seed, 64),
    );

    assert.ok(assignmentSnapshot);

    if (!isNoSwap1SameHalfAssignment(assignmentSnapshot)) {
      continue;
    }

    const result = finalSnapshot.latestResult;
    assert.ok(result, `seed ${seed} 缺少结算结果`);
    assert.equal(result.outcome, 'success', `seed ${seed}: ${result.failureReasons.join(',')}`);
    assert.deepEqual(result.failureReasons, []);
    return;
  }

  assert.fail('没有找到未换位1且黑暗狂水同半场的随机样本');
});
