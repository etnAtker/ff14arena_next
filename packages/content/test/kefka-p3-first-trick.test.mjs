import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '@ff14arena/core';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { getBattleDefinition } from '../src/index.ts';
import { KEFKA_P3_FIRST_TRICK_TESTING } from '../src/battles/kefka-p3-first-trick.ts';

const {
  MECHANIC_START_AT,
  SHORT_ELEMENT_BUFF_MS,
  LONG_ELEMENT_BUFF_MS,
  CHAOS_FIRE_STATUS_ID,
  CHAOS_WATER_STATUS_ID,
  CHAOS_WIND_STATUS_ID,
  CHAOS_REVERSE_WIND_STATUS_ID,
  DELAYED_RESOLUTION_MS,
} = KEFKA_P3_FIRST_TRICK_TESTING;

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

function createKefkaP3Simulation() {
  const battle = getBattleDefinition('kefka_p3_first_trick');
  assert.ok(battle);

  const simulation = createSimulation();
  simulation.loadBattle({
    battle,
    roomId: 'kefka-p3-first-trick-test-room',
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

function getStatus(actor, statusId) {
  return actor.statuses.find((status) => status.id === statusId) ?? null;
}

function hasStatus(actor, statusId) {
  return getStatus(actor, statusId) !== null;
}

function getElementBlocks(snapshot) {
  return snapshot.scriptState['kefkaP3:elementBlocks'];
}

function getElementBlock(snapshot, type) {
  const block = getElementBlocks(snapshot).find((candidate) => candidate.type === type);
  assert.ok(block);

  return block;
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

function add(point, vector) {
  return {
    x: point.x + vector.x,
    y: point.y + vector.y,
  };
}

function scale(vector, factor) {
  return {
    x: vector.x * factor,
    y: vector.y * factor,
  };
}

function normalize(vector) {
  const length = Math.hypot(vector.x, vector.y);

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function angleTo(source, target) {
  return Math.atan2(target.y - source.y, target.x - source.x);
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function moveActorsFarFromElements(simulation, snapshot, excludedActorIds = new Set()) {
  const farPositions = [
    { x: -4, y: -4 },
    { x: -2, y: -4 },
    { x: 0, y: -4 },
    { x: 2, y: -4 },
    { x: 4, y: -4 },
    { x: -4, y: 4 },
    { x: -2, y: 4 },
    { x: 0, y: 4 },
  ];
  let positionIndex = 0;

  for (const actor of snapshot.actors) {
    if (excludedActorIds.has(actor.id)) {
      continue;
    }

    submitPose(simulation, actor, farPositions[positionIndex++]);
  }
}

function getForcedMovementEvents(simulation, actorId) {
  return simulation
    .drainEvents()
    .filter(
      (event) => event.type === 'actorForcedMovementRequested' && event.payload.actorId === actorId,
    );
}

test('凯夫卡P3一运：读条结束后生成三种元素块并赋予状态', () => {
  withMockedRandom(createSeededRandomValues(21, 100), () => {
    const simulation = createKefkaP3Simulation();

    advanceTo(simulation, 3_000);
    assert.equal(simulation.getSnapshot().boss.castBar?.actionName, '深层痛楚');

    advanceTo(simulation, MECHANIC_START_AT);

    const snapshot = simulation.getSnapshot();
    const elementBlocks = getElementBlocks(snapshot);
    const fieldMarkers = snapshot.mechanics.filter((mechanic) => mechanic.kind === 'fieldMarker');
    const windBlock = getElementBlock(snapshot, 'wind');
    const fireBlock = getElementBlock(snapshot, 'fire');
    const waterBlock = getElementBlock(snapshot, 'water');
    const windStatusCount = snapshot.actors.filter((actor) =>
      hasStatus(actor, CHAOS_WIND_STATUS_ID),
    ).length;
    const reverseWindStatusCount = snapshot.actors.filter((actor) =>
      hasStatus(actor, CHAOS_REVERSE_WIND_STATUS_ID),
    ).length;
    const fireActors = snapshot.actors.filter((actor) => hasStatus(actor, CHAOS_FIRE_STATUS_ID));
    const waterActors = snapshot.actors.filter((actor) => hasStatus(actor, CHAOS_WATER_STATUS_ID));
    const fireDuration =
      getStatus(fireActors[0], CHAOS_FIRE_STATUS_ID).expiresAt - MECHANIC_START_AT;
    const waterDuration =
      getStatus(waterActors[0], CHAOS_WATER_STATUS_ID).expiresAt - MECHANIC_START_AT;

    assert.equal(elementBlocks.length, 3);
    assert.deepEqual(fieldMarkers.map((marker) => [marker.label, marker.shape]).sort(), [
      ['水元素块', 'square'],
      ['火元素块', 'triangle'],
      ['风元素块', 'diamond'],
    ]);
    assert.ok(elementBlocks.every((block) => Math.abs(block.position.x) === 10));
    assert.ok(elementBlocks.every((block) => Math.abs(block.position.y) === 10));
    assert.equal(distance(windBlock.position, fireBlock.position), 20);
    assert.equal(distance(windBlock.position, waterBlock.position), 20);
    assert.equal(windStatusCount, 4);
    assert.equal(reverseWindStatusCount, 4);
    assert.equal(fireActors.length, 2);
    assert.equal(waterActors.length, 2);
    assert.equal(
      fireActors.filter((actor) => ['MT', 'ST', 'H1', 'H2'].includes(actor.slot)).length,
      1,
    );
    assert.equal(fireActors.filter((actor) => actor.slot.startsWith('D')).length, 1);
    assert.equal(
      waterActors.filter((actor) => ['MT', 'ST', 'H1', 'H2'].includes(actor.slot)).length,
      1,
    );
    assert.equal(waterActors.filter((actor) => actor.slot.startsWith('D')).length, 1);
    assert.deepEqual(
      [fireDuration, waterDuration].sort((left, right) => left - right),
      [SHORT_ELEMENT_BUFF_MS, LONG_ELEMENT_BUFF_MS],
    );
  });
});

test('凯夫卡P3一运：水buff两次消除后延迟5tick点名最近2人', () => {
  withMockedRandom(createSeededRandomValues(24, 100), () => {
    const simulation = createKefkaP3Simulation();

    advanceTo(simulation, MECHANIC_START_AT);

    const startSnapshot = simulation.getSnapshot();
    const waterDuration = startSnapshot.scriptState['kefkaP3:elementStatusDurations'].water;
    const waterBlock = getElementBlock(startSnapshot, 'water');
    const waterActors = startSnapshot.actors.filter((actor) =>
      hasStatus(actor, CHAOS_WATER_STATUS_ID),
    );
    const candidateActors = startSnapshot.actors
      .filter((actor) => !hasStatus(actor, CHAOS_WATER_STATUS_ID))
      .slice(0, 2);
    const awayActorIds = new Set(candidateActors.map((actor) => actor.id));
    const inward = normalize({ x: -waterBlock.position.x, y: -waterBlock.position.y });

    moveActorsFarFromElements(simulation, startSnapshot, awayActorIds);
    for (const [index, actor] of candidateActors.entries()) {
      submitPose(simulation, actor, add(waterBlock.position, scale(inward, 1 + index * 6)));
    }
    for (const actor of waterActors) {
      submitPose(simulation, actor, { x: -8, y: 0 });
    }

    advanceTo(simulation, MECHANIC_START_AT + waterDuration);

    const expiredSnapshot = simulation.getSnapshot();
    assert.deepEqual(expiredSnapshot.scriptState['kefkaP3:pendingResolutions'], [
      {
        kind: 'water',
        count: 2,
        resolveAt: MECHANIC_START_AT + waterDuration + DELAYED_RESOLUTION_MS,
      },
    ]);

    advanceTo(simulation, MECHANIC_START_AT + waterDuration + DELAYED_RESOLUTION_MS);

    const resolvedSnapshot = simulation.getSnapshot();
    const resolvedCandidates = candidateActors.map((actor) =>
      resolvedSnapshot.actors.find((candidate) => candidate.id === actor.id),
    );

    assert.ok(resolvedCandidates.every((actor) => actor.lastDamageSource === '水元素块'));
    assert.ok(
      !resolvedSnapshot.scriptState['kefkaP3:pendingResolutions'].some(
        (resolution) => resolution.kind === 'water',
      ),
    );
  });
});

test('凯夫卡P3一运：风buff按面向调整元素击退距离并在击退后消除', () => {
  withMockedRandom(createSeededRandomValues(24, 100), () => {
    const simulation = createKefkaP3Simulation();

    advanceTo(simulation, MECHANIC_START_AT);

    const startSnapshot = simulation.getSnapshot();
    const waterDuration = startSnapshot.scriptState['kefkaP3:elementStatusDurations'].water;
    const waterBlock = getElementBlock(startSnapshot, 'water');
    const windActor = startSnapshot.actors.find(
      (actor) => hasStatus(actor, CHAOS_WIND_STATUS_ID) && !hasStatus(actor, CHAOS_WATER_STATUS_ID),
    );
    assert.ok(windActor);

    const inward = normalize({ x: -waterBlock.position.x, y: -waterBlock.position.y });
    const windPosition = add(waterBlock.position, scale(inward, 1));
    moveActorsFarFromElements(simulation, startSnapshot, new Set([windActor.id]));
    submitPose(simulation, windActor, windPosition, angleTo(windPosition, waterBlock.position));
    simulation.drainEvents();

    advanceTo(simulation, MECHANIC_START_AT + waterDuration + DELAYED_RESOLUTION_MS);

    const forcedMovementEvents = getForcedMovementEvents(simulation, windActor.id);
    const resolvedWindActor = simulation
      .getSnapshot()
      .actors.find((actor) => actor.id === windActor.id);

    assert.equal(forcedMovementEvents.at(-1).payload.distance, 40);
    assert.ok(!hasStatus(resolvedWindActor, CHAOS_WIND_STATUS_ID));
    assert.ok(
      simulation
        .getSnapshot()
        .scriptState[
          'kefkaP3:pendingResolutions'
        ].some((resolution) => resolution.kind === 'wind' && resolution.count >= 1),
    );
  });
});

test('凯夫卡P3一运：风消除后延迟5tick判定2人分摊，少于2人即死', () => {
  withMockedRandom(createSeededRandomValues(24, 100), () => {
    const simulation = createKefkaP3Simulation();

    advanceTo(simulation, MECHANIC_START_AT);

    const startSnapshot = simulation.getSnapshot();
    const waterDuration = startSnapshot.scriptState['kefkaP3:elementStatusDurations'].water;
    const waterBlock = getElementBlock(startSnapshot, 'water');
    const windActor = startSnapshot.actors.find(
      (actor) => hasStatus(actor, CHAOS_WIND_STATUS_ID) && !hasStatus(actor, CHAOS_WATER_STATUS_ID),
    );
    assert.ok(windActor);

    const inward = normalize({ x: -waterBlock.position.x, y: -waterBlock.position.y });
    const windPosition = add(waterBlock.position, scale(inward, 1));
    moveActorsFarFromElements(simulation, startSnapshot, new Set([windActor.id]));
    submitPose(simulation, windActor, windPosition, angleTo(windPosition, waterBlock.position));

    advanceTo(simulation, MECHANIC_START_AT + waterDuration + DELAYED_RESOLUTION_MS);

    const shareSnapshot = simulation.getSnapshot();
    const isolatedActorIds = new Set([windActor.id]);
    moveActorsFarFromElements(simulation, shareSnapshot, isolatedActorIds);
    submitPose(simulation, windActor, add(waterBlock.position, scale(inward, 1)));

    advanceTo(simulation, MECHANIC_START_AT + waterDuration + DELAYED_RESOLUTION_MS * 2);

    const resolvedSnapshot = simulation.getSnapshot();
    const resolvedWindActor = resolvedSnapshot.actors.find((actor) => actor.id === windActor.id);

    assert.equal(resolvedWindActor.alive, false);
    assert.equal(resolvedWindActor.deathReason, '混沌之风分摊人数不足');
    assert.ok(resolvedSnapshot.failureReasons.includes('混沌之风分摊人数不足'));
  });
});

test('凯夫卡P3一运：易伤期间再次受到机制伤害即死', () => {
  withMockedRandom(createSeededRandomValues(25, 100), () => {
    const simulation = createKefkaP3Simulation();

    advanceTo(simulation, MECHANIC_START_AT);

    const startSnapshot = simulation.getSnapshot();
    const fireDuration = startSnapshot.scriptState['kefkaP3:elementStatusDurations'].fire;
    const fireActors = startSnapshot.actors.filter((actor) =>
      hasStatus(actor, CHAOS_FIRE_STATUS_ID),
    );
    assert.equal(fireActors.length, 2);

    submitPose(simulation, fireActors[0], { x: 0, y: 0 });
    submitPose(simulation, fireActors[1], { x: 3, y: 0 });

    advanceTo(simulation, MECHANIC_START_AT + fireDuration);

    const resolvedSnapshot = simulation.getSnapshot();
    const firstFireActor = resolvedSnapshot.actors.find((actor) => actor.id === fireActors[0].id);
    const secondFireActor = resolvedSnapshot.actors.find((actor) => actor.id === fireActors[1].id);

    assert.equal(firstFireActor.alive, false);
    assert.equal(secondFireActor.alive, false);
    assert.equal(firstFireActor.deathReason, '混沌之炎');
    assert.equal(secondFireActor.deathReason, '混沌之炎');
  });
});
