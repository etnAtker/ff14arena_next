import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '@ff14arena/core';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { getBattleDefinition } from '../src/index.ts';

const TH_SLOTS = ['MT', 'ST', 'H1', 'H2'];
const DPS_SLOTS = ['D1', 'D2', 'D3', 'D4'];
const NORTH_ANGLE = -Math.PI / 2;
const RING_RADIUS = 6;
const LIGHT_SAFE_POINTS = [
  { x: -0.6, y: -9 },
  { x: -0.6, y: 9 },
  { x: 0.6, y: -9 },
  { x: 0.6, y: 9 },
];

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
    roomId: 'eden-p4-special-dps-arrangement-test-room',
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

function getCombinations(items, length, startIndex = 0) {
  if (length === 0) {
    return [[]];
  }

  const combinations = [];

  for (let index = startIndex; index <= items.length - length; index += 1) {
    for (const tail of getCombinations(items, length - 1, index + 1)) {
      combinations.push([items[index], ...tail]);
    }
  }

  return combinations;
}

function rotateSlots(slots, offset) {
  return slots.map((_, index) => slots[(index + offset) % slots.length]);
}

function createSortedSlots(dpsIndexes) {
  const dpsQueue = [...DPS_SLOTS];
  const thQueue = [...TH_SLOTS];

  return Array.from({ length: 8 }, (_, index) =>
    dpsIndexes.includes(index) ? dpsQueue.shift() : thQueue.shift(),
  );
}

function createRingPlacement(sortedSlots) {
  return Object.fromEntries(
    sortedSlots.map((slot, index) => {
      const angle = NORTH_ANGLE + (Math.PI / 4) * index;

      return [
        slot,
        {
          x: Math.cos(angle) * RING_RADIUS,
          y: Math.sin(angle) * RING_RADIUS,
        },
      ];
    }),
  );
}

function createLightSafePlacement(assignments) {
  const placement = Object.fromEntries(PARTY_SLOT_ORDER.map((slot) => [slot, { x: 0, y: 0 }]));

  assignments.lightOrder.forEach((slot, index) => {
    placement[slot] = LIGHT_SAFE_POINTS[index];
  });

  return placement;
}

function expectsValidDpsArrangement(sortedSlots) {
  const isDpsByIndex = sortedSlots.map((slot) => DPS_SLOTS.includes(slot));
  const transitions = isDpsByIndex.filter(
    (isDps, index) => isDps !== isDpsByIndex[(index + 1) % isDpsByIndex.length],
  ).length;

  return transitions === 2 || transitions === sortedSlots.length;
}

function assertDpsArrangementResult(sortedSlots) {
  return withMockedRandom(createSeededRandomValues(2, 64), () => {
    const simulation = createEdenP4Simulation();

    advanceTo(simulation, 8_000);
    const assignmentSnapshot = simulation.getSnapshot();
    const assignments = assignmentSnapshot.scriptState['edenP4:assignments'];
    assert.ok(assignments);

    const lightSafePlacement = createLightSafePlacement(assignments);
    for (const actor of assignmentSnapshot.actors) {
      submitPose(simulation, actor, lightSafePlacement[actor.slot]);
    }

    advanceTo(simulation, 18_950);
    const resolveSnapshot = simulation.getSnapshot();
    const ringPlacement = createRingPlacement(sortedSlots);
    for (const actor of resolveSnapshot.actors) {
      submitPose(simulation, actor, ringPlacement[actor.slot]);
    }

    advanceTo(simulation, 19_000);
    const hasDpsFailure = simulation.getSnapshot().failureReasons.includes('DPS 站位顺序错误');

    assert.equal(
      !hasDpsFailure,
      expectsValidDpsArrangement(sortedSlots),
      `DPS 排列判定错误：${sortedSlots.join(',')}`,
    );
  });
}

test('伊甸P4特殊：DPS 排列判定覆盖全部环形相对位置', () => {
  let assertionCount = 0;

  for (const dpsIndexes of getCombinations([...Array(8).keys()], 4)) {
    const sortedSlots = createSortedSlots(dpsIndexes);

    for (let offset = 0; offset < sortedSlots.length; offset += 1) {
      assertDpsArrangementResult(rotateSlots(sortedSlots, offset));
      assertionCount += 1;
    }
  }

  assert.equal(assertionCount, 560);
});
