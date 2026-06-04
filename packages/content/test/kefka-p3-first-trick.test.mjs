import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '@ff14arena/core';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { getBattleDefinition } from '../src/index.ts';
import { KEFKA_P3_FIRST_TRICK_TESTING } from '../src/battles/kefka-p3-first-trick.ts';

const {
  DEEP_AGONY_CAST_START_AT,
  DEEP_AGONY_CAST_MS,
  MECHANIC_START_AT,
  SHORT_ELEMENT_BUFF_MS,
  LONG_ELEMENT_BUFF_MS,
  CHAOS_FIRE_STATUS_ID,
  CHAOS_WATER_STATUS_ID,
  CHAOS_WIND_STATUS_ID,
  CHAOS_REVERSE_WIND_STATUS_ID,
  FIRE_ELEMENT_INNER_RADIUS,
  FIRE_ELEMENT_OUTER_RADIUS,
  WATER_ELEMENT_RADIUS,
  WIND_SHARE_RADIUS,
  BASE_ELEMENT_KNOCKBACK_DISTANCE,
  DELAYED_RESOLUTION_MS,
  TELEGRAPH_MS,
  RESOLUTION_VISUAL_MS,
  BURST_CAST_START_AT,
  BURST_RESOLVE_AT,
  BURST_CAST_MS,
  BURST_RADIUS,
  BURST_ST_OFFSET,
  BURST_TELEGRAPH_COLOR,
  EXDEATH_MARKER_RADIUS,
  EXDEATH_MARKER_COLOR,
  EXDEATH_TARGET_RING_RADIUS,
  EXDEATH_TARGET_RING_COLOR,
  FOLLOWUP_BURST_CAST_START_AT,
  FOLLOWUP_BURST_FIRST_RESOLVE_AT,
  FOLLOWUP_BURST_SECOND_RESOLVE_AT,
  FOLLOWUP_BURST_CAST_MS,
  FOLLOWUP_BURST_RADIUS,
  EXDEATH_REPOSITION_START_AT,
  EXDEATH_REPOSITION_END_AT,
  EXDEATH_REPOSITION_INTERVAL_MS,
  CHAOS_EXPLOSION_CAST_START_AT,
  CHAOS_EXPLOSION_FIRST_RESOLVE_AT,
  CHAOS_EXPLOSION_SECOND_RESOLVE_AT,
  CHAOS_EXPLOSION_CAST_MS,
  CHAOS_EXPLOSION_FAN_ANGLE,
  CHAOS_EXPLOSION_FAN_RADIUS,
  CHAOS_MARKER_SPAWN_AT,
  CHAOS_REPOSITION_START_AT,
  CHAOS_REPOSITION_END_AT,
  CHAOS_REPOSITION_INTERVAL_MS,
  CHAOS_MARKER_RADIUS,
  CHAOS_MARKER_ST_OFFSET,
  CHAOS_MARKER_TARGET_RING_RADIUS,
  CHAOS_MARKER_TARGET_RING_COLOR,
  VACUUM_WAVE_CAST_START_AT,
  VACUUM_WAVE_RESOLVE_AT,
  VACUUM_WAVE_CAST_MS,
  VACUUM_WAVE_MT_OFFSET,
  SUPER_JUMP_LOCK_AT,
  SUPER_JUMP_RESOLVE_AT,
  SUPER_JUMP_RADIUS,
  CHARGE_MARKER_SPAWN_AT,
  CHARGE_MARKER_OUTSIDE_AT,
  CHARGE_MARKER_ROTATION_INTERVAL_MS,
  CHARGE_MARKER_ROTATION_COUNT,
  CHARGE_MARKER_DESPAWN_AT,
  CHARGE_INITIAL_DISTANCE,
  CHARGE_OUTSIDE_DISTANCE,
  CHARGE_MARKER_RADIUS,
  CHARGE_MARKER_COLOR,
  MAHJONG_ASSIGN_AT,
  MAHJONG_MARKERS_RESOLVE_AT,
  MAHJONG_FIRST_RESOLVE_AT,
  MAHJONG_LAST_RESOLVE_AT,
  MAHJONG_RECTANGLE_INTERVAL_MS,
  MAHJONG_RECTANGLE_LENGTH,
  MAHJONG_RECTANGLE_WIDTH,
  MAHJONG_RECTANGLE_VISUAL_MS,
  MAHJONG_MIN_DISTANCE,
  MAHJONG_ODD_MARKER_COLOR,
  MAHJONG_EVEN_MARKER_COLOR,
  COMPLETE_AT,
  calculateBurstCenter,
  calculateChaosCenter,
  calculateVacuumWaveCenter,
  createChargeOutsideCenters,
  isActorInsideRectangle,
} = KEFKA_P3_FIRST_TRICK_TESTING;

const WATER_TELEGRAPH_COLOR = '#38bdf8';
const WIND_TELEGRAPH_COLOR = '#22c55e';

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

function assertActorDied(actor) {
  assert.equal(actor.alive, false);
  assert.equal(actor.mechanicActive, true);
  assert.equal(actor.currentHp, 0);
  assert.notEqual(actor.deathReason, null);
}

function assertActorNotDead(actor) {
  assert.equal(actor.alive, true);
  assert.equal(actor.mechanicActive, true);
  assert.equal(actor.deathReason, null);
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

function submitKnockbackImmune(simulation, actor) {
  simulation.submitActorControlFrame({
    actorId: actor.id,
    issuedAt: simulation.getSnapshot().timeMs,
    commands: [
      {
        type: 'use-knockback-immune',
        payload: {},
      },
    ],
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

function normalizeAngle(angle) {
  const normalized = angle % (Math.PI * 2);

  return normalized < 0 ? normalized + Math.PI * 2 : normalized;
}

function angleDiff(left, right) {
  const diff = Math.abs(normalizeAngle(left) - normalizeAngle(right)) % (Math.PI * 2);

  return diff > Math.PI ? Math.PI * 2 - diff : diff;
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function getActorBySlot(snapshot, slot) {
  const actor = snapshot.actors.find((candidate) => candidate.slot === slot);
  assert.ok(actor);

  return actor;
}

function assertClosePoint(actual, expected) {
  assert.ok(distance(actual, expected) < 0.001);
}

function assertCloseAngle(actual, expected) {
  assert.ok(angleDiff(actual, expected) < 0.001);
}

function assertTelegraphCenters(telegraphs, expectedCenters) {
  assert.equal(telegraphs.length, expectedCenters.length);

  for (const expectedCenter of expectedCenters) {
    assert.ok(telegraphs.some((telegraph) => distance(telegraph.center, expectedCenter) < 0.001));
  }
}

function getBurstCenter(snapshot) {
  const burstCenter = snapshot.scriptState['kefkaP3:burstCenter'];
  assert.ok(burstCenter);

  return burstCenter;
}

function getChaosCenter(snapshot) {
  const chaosCenter = snapshot.scriptState['kefkaP3:chaosCenter'];
  assert.ok(chaosCenter);

  return chaosCenter;
}

function assertExdeathMarker(marker, expectedCenter, expectedResolveAt) {
  assert.ok(marker);
  assertClosePoint(marker.center, expectedCenter);
  assert.equal(marker.shape, 'enemy');
  assert.equal(marker.radius, EXDEATH_MARKER_RADIUS);
  assert.equal(marker.color, EXDEATH_MARKER_COLOR);
  assert.equal(marker.targetRingRadius, EXDEATH_TARGET_RING_RADIUS);
  assert.equal(marker.targetRingColor, EXDEATH_TARGET_RING_COLOR);
  assert.equal(marker.resolveAt, expectedResolveAt);
}

function assertChaosMarker(marker, expectedCenter, expectedResolveAt) {
  assert.ok(marker);
  assertClosePoint(marker.center, expectedCenter);
  assert.equal(marker.shape, 'enemy');
  assert.equal(marker.radius, CHAOS_MARKER_RADIUS);
  assert.equal(marker.targetRingRadius, CHAOS_MARKER_TARGET_RING_RADIUS);
  assert.equal(marker.targetRingColor, CHAOS_MARKER_TARGET_RING_COLOR);
  assert.equal(marker.resolveAt, expectedResolveAt);
}

function getSafePositionsOutsideRadius(center, radius, count) {
  const candidates = Array.from({ length: 32 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 32;

    return {
      x: Math.cos(angle) * 18,
      y: Math.sin(angle) * 18,
    };
  }).filter((position) => distance(position, center) > radius + 1);

  assert.ok(candidates.length >= count);

  return candidates.slice(0, count);
}

function getSafePositionsOutsideCircle(center, count) {
  return getSafePositionsOutsideRadius(center, BURST_RADIUS, count);
}

function createPointOnDirection(direction, radius) {
  return {
    x: Math.cos(direction) * radius,
    y: Math.sin(direction) * radius,
  };
}

function getSafeClosePairOutsideCircle(center) {
  const candidates = getSafePositionsOutsideCircle(center, 16);

  for (const left of candidates) {
    for (const right of candidates) {
      if (left === right) {
        continue;
      }

      if (distance(left, right) <= 4) {
        return [left, right];
      }
    }
  }

  throw new Error('missing safe close pair outside burst');
}

function moveActorsOutsideBurst(simulation, snapshot, excludedActorIds = new Set()) {
  const burstCenter = getBurstCenter(snapshot);
  const safePositions = getSafePositionsOutsideCircle(
    burstCenter,
    snapshot.actors.length - excludedActorIds.size,
  );
  let positionIndex = 0;

  for (const actor of snapshot.actors) {
    if (excludedActorIds.has(actor.id)) {
      continue;
    }

    submitPose(simulation, actor, safePositions[positionIndex++]);
  }
}

function advanceThroughBurstSafely(simulation, excludedActorIds = new Set()) {
  advanceTo(simulation, BURST_CAST_START_AT);
  moveActorsOutsideBurst(simulation, simulation.getSnapshot(), excludedActorIds);
  advanceTo(simulation, BURST_RESOLVE_AT);
}

function moveAliveActorsOutsideFollowupBurst(simulation, snapshot, center, excludedActorIds) {
  const movableActors = snapshot.actors.filter(
    (actor) => actor.alive && !excludedActorIds.has(actor.id),
  );
  const safePositions = getSafePositionsOutsideRadius(
    center,
    FOLLOWUP_BURST_RADIUS,
    movableActors.length,
  );

  for (const [index, actor] of movableActors.entries()) {
    submitPose(simulation, actor, safePositions[index]);
  }
}

function advanceThroughFollowupBurstSafely(simulation) {
  advanceTo(simulation, FOLLOWUP_BURST_CAST_START_AT);

  let snapshot = simulation.getSnapshot();
  const burstCenter = getBurstCenter(snapshot);
  const mt = getActorBySlot(snapshot, 'MT');
  moveAliveActorsOutsideFollowupBurst(simulation, snapshot, burstCenter, new Set([mt.id]));
  submitPose(simulation, mt, burstCenter);

  advanceTo(simulation, FOLLOWUP_BURST_FIRST_RESOLVE_AT);

  snapshot = simulation.getSnapshot();
  const st = getActorBySlot(snapshot, 'ST');
  moveAliveActorsOutsideFollowupBurst(simulation, snapshot, burstCenter, new Set([st.id]));
  submitPose(simulation, st, burstCenter);

  advanceTo(simulation, FOLLOWUP_BURST_SECOND_RESOLVE_AT);
}

function getElementTypeResolvingAfterDuration(snapshot, durationMs) {
  const durations = snapshot.scriptState['kefkaP3:elementStatusDurations'];

  return durations.fire === durationMs ? 'fire' : 'water';
}

function getElementResolutionTargetPositions(elementBlock, elementType) {
  const inward = normalize({ x: -elementBlock.position.x, y: -elementBlock.position.y });
  const perpendicular = { x: -inward.y, y: inward.x };
  const first = add(elementBlock.position, scale(inward, 1));

  if (elementType === 'water') {
    return [first, add(first, scale(perpendicular, 5.5))];
  }

  return [first, add(elementBlock.position, scale(inward, 4))];
}

function getExtraWindHitPosition(elementBlock, elementType, targetPositions) {
  const inward = normalize({ x: -elementBlock.position.x, y: -elementBlock.position.y });

  if (elementType === 'water') {
    return add(targetPositions[1], scale(inward, 1));
  }

  return add(targetPositions[1], scale(inward, 6));
}

function positionActorsForSafeElementResolution(
  simulation,
  snapshot,
  elementType,
  extraWindHitActorId = null,
) {
  const elementBlock = getElementBlock(snapshot, elementType);
  const targetPositions = getElementResolutionTargetPositions(elementBlock, elementType);

  if (elementType === 'fire') {
    const clusterOffsets = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: -1 },
      { x: 1, y: -1 },
    ];

    for (const [index, actor] of snapshot.actors.entries()) {
      submitPose(simulation, actor, add(targetPositions[0], clusterOffsets[index]));
    }
  } else {
    const farPositions = [
      { x: -4, y: -4 },
      { x: -2, y: -4 },
      { x: 0, y: -4 },
      { x: 2, y: -4 },
      { x: 4, y: -4 },
      { x: -4, y: 4 },
    ];

    for (const [index, actor] of snapshot.actors.entries()) {
      if (index < targetPositions.length) {
        submitPose(simulation, actor, targetPositions[index]);
      } else {
        submitPose(simulation, actor, farPositions[index - targetPositions.length]);
      }
    }
  }

  if (extraWindHitActorId !== null) {
    const extraHitActor = snapshot.actors.find((actor) => actor.id === extraWindHitActorId);
    assert.ok(extraHitActor);
    submitPose(
      simulation,
      extraHitActor,
      getExtraWindHitPosition(elementBlock, elementType, targetPositions),
    );
  }
}

function advanceThroughElementResolutionSafely(
  simulation,
  elementType,
  resolveAt,
  extraWindHitActorId = null,
) {
  advanceTo(simulation, resolveAt - 50);
  positionActorsForSafeElementResolution(
    simulation,
    simulation.getSnapshot(),
    elementType,
    extraWindHitActorId,
  );
  simulation.drainEvents();
  advanceTo(simulation, resolveAt);
  simulation.drainEvents();
}

function getChaosExplosionTestDirections(state, resolveAt) {
  const shouldResolveFrontBack =
    state.mode === 'longitude'
      ? resolveAt === CHAOS_EXPLOSION_FIRST_RESOLVE_AT
      : resolveAt === CHAOS_EXPLOSION_SECOND_RESOLVE_AT;

  if (shouldResolveFrontBack) {
    return [state.facing, state.facing + Math.PI];
  }

  return [state.facing - Math.PI / 2, state.facing + Math.PI / 2];
}

function moveAllActorsToAngle(simulation, snapshot, angle, radius = 12, center = { x: 0, y: 0 }) {
  const position = add(center, {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  });

  for (const actor of snapshot.actors) {
    submitPose(simulation, actor, position);
  }
}

function spreadActorsAroundArena(simulation, snapshot, radius = 16) {
  for (const [index, actor] of snapshot.actors.entries()) {
    const angle = (Math.PI * 2 * index) / snapshot.actors.length;

    submitPose(simulation, actor, {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    });
  }
}

function advanceThroughChaosExplosionSafely(simulation) {
  advanceTo(simulation, CHAOS_EXPLOSION_CAST_START_AT);

  const castSnapshot = simulation.getSnapshot();
  const chaosState = castSnapshot.scriptState['kefkaP3:chaosExplosion'];
  assert.ok(chaosState);
  const firstDirections = getChaosExplosionTestDirections(
    chaosState,
    CHAOS_EXPLOSION_FIRST_RESOLVE_AT,
  );
  const secondDirections = getChaosExplosionTestDirections(
    chaosState,
    CHAOS_EXPLOSION_SECOND_RESOLVE_AT,
  );

  moveAllActorsToAngle(simulation, castSnapshot, secondDirections[0], 12, chaosState.center);
  advanceTo(simulation, CHAOS_EXPLOSION_FIRST_RESOLVE_AT);
  simulation.drainEvents();

  moveAllActorsToAngle(
    simulation,
    simulation.getSnapshot(),
    firstDirections[0],
    12,
    chaosState.center,
  );
  advanceTo(simulation, CHAOS_EXPLOSION_SECOND_RESOLVE_AT);
  simulation.drainEvents();
}

function advanceToVacuumWaveSetup(simulation, options = {}) {
  advanceTo(simulation, MECHANIC_START_AT);

  const startSnapshot = simulation.getSnapshot();
  const shortElementType = getElementTypeResolvingAfterDuration(
    startSnapshot,
    SHORT_ELEMENT_BUFF_MS,
  );
  const longElementType = getElementTypeResolvingAfterDuration(startSnapshot, LONG_ELEMENT_BUFF_MS);

  advanceThroughBurstSafely(simulation);
  spreadActorsAroundArena(simulation, simulation.getSnapshot());
  advanceTo(simulation, MECHANIC_START_AT + SHORT_ELEMENT_BUFF_MS + TELEGRAPH_MS);
  advanceThroughElementResolutionSafely(
    simulation,
    shortElementType,
    MECHANIC_START_AT + SHORT_ELEMENT_BUFF_MS + DELAYED_RESOLUTION_MS,
  );
  advanceThroughFollowupBurstSafely(simulation);
  advanceThroughChaosExplosionSafely(simulation);
  spreadActorsAroundArena(simulation, simulation.getSnapshot());
  advanceTo(simulation, MECHANIC_START_AT + LONG_ELEMENT_BUFF_MS + TELEGRAPH_MS);
  advanceThroughElementResolutionSafely(
    simulation,
    longElementType,
    MECHANIC_START_AT + LONG_ELEMENT_BUFF_MS + DELAYED_RESOLUTION_MS,
    options.consumeWindActorId ?? null,
  );
  advanceTo(simulation, VACUUM_WAVE_CAST_START_AT - 50);
}

function advanceToChargeSetup(simulation) {
  advanceTo(simulation, MECHANIC_START_AT);

  const startSnapshot = simulation.getSnapshot();
  const shortElementType = getElementTypeResolvingAfterDuration(
    startSnapshot,
    SHORT_ELEMENT_BUFF_MS,
  );
  const longElementType = getElementTypeResolvingAfterDuration(startSnapshot, LONG_ELEMENT_BUFF_MS);

  advanceThroughBurstSafely(simulation);
  spreadActorsAroundArena(simulation, simulation.getSnapshot());
  advanceTo(simulation, MECHANIC_START_AT + SHORT_ELEMENT_BUFF_MS + TELEGRAPH_MS);
  advanceThroughElementResolutionSafely(
    simulation,
    shortElementType,
    MECHANIC_START_AT + SHORT_ELEMENT_BUFF_MS + DELAYED_RESOLUTION_MS,
  );
  advanceThroughFollowupBurstSafely(simulation);
  advanceThroughChaosExplosionSafely(simulation);
  spreadActorsAroundArena(simulation, simulation.getSnapshot());
  advanceTo(simulation, MECHANIC_START_AT + LONG_ELEMENT_BUFF_MS + TELEGRAPH_MS);
  advanceThroughElementResolutionSafely(
    simulation,
    longElementType,
    MECHANIC_START_AT + LONG_ELEMENT_BUFF_MS + DELAYED_RESOLUTION_MS,
  );
  advanceTo(simulation, CHARGE_MARKER_SPAWN_AT - 50);
}

function advanceThroughSuperJumpAndVacuumSafely(simulation) {
  advanceTo(simulation, VACUUM_WAVE_CAST_START_AT - 50);

  const setupSnapshot = simulation.getSnapshot();
  const farthestActor = getActorBySlot(setupSnapshot, 'D4');

  for (const actor of setupSnapshot.actors) {
    submitPose(simulation, actor, actor.id === farthestActor.id ? { x: 18, y: 0 } : { x: 0, y: 0 });
  }

  advanceTo(simulation, VACUUM_WAVE_CAST_START_AT);

  const safePositions = [
    { x: -12, y: -4 },
    { x: -10, y: 4 },
    { x: -8, y: -4 },
    { x: -6, y: 4 },
    { x: -4, y: -4 },
    { x: -2, y: 4 },
    { x: 0, y: -4 },
    { x: 2, y: 4 },
  ];

  for (const [index, actor] of simulation.getSnapshot().actors.entries()) {
    submitPose(simulation, actor, safePositions[index]);
  }

  advanceTo(simulation, SUPER_JUMP_RESOLVE_AT);
  advanceTo(simulation, VACUUM_WAVE_RESOLVE_AT - 1_000);

  for (const actor of simulation.getSnapshot().actors) {
    submitKnockbackImmune(simulation, actor);
  }

  advanceTo(simulation, VACUUM_WAVE_RESOLVE_AT - 950);
  advanceTo(simulation, VACUUM_WAVE_RESOLVE_AT);
}

function advanceToMahjongAssignments(simulation) {
  advanceToVacuumWaveSetup(simulation);
  advanceThroughSuperJumpAndVacuumSafely(simulation);
  advanceTo(simulation, MAHJONG_ASSIGN_AT);
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

test('凯夫卡P3一运：暴雷在MT到场中的射线上锁定位置并生成艾克斯德司', () => {
  withMockedRandom(createSeededRandomValues(23, 100), () => {
    const simulation = createKefkaP3Simulation();

    advanceTo(simulation, MECHANIC_START_AT);

    const startSnapshot = simulation.getSnapshot();
    const mt = getActorBySlot(startSnapshot, 'MT');
    const mtPosition = { x: 12, y: 0 };
    submitPose(simulation, mt, mtPosition);

    advanceTo(simulation, BURST_CAST_START_AT);

    const castSnapshot = simulation.getSnapshot();
    const expectedCenter = calculateBurstCenter(mtPosition);
    const burstCenter = getBurstCenter(castSnapshot);
    const earlyBurstTelegraph = castSnapshot.mechanics.find(
      (mechanic) => mechanic.kind === 'circleTelegraph' && mechanic.label === '暴雷范围',
    );
    const exdeathMarker = castSnapshot.mechanics.find(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '艾克斯德司',
    );

    assert.equal(castSnapshot.boss.castBar?.actionName, '暴雷');
    assert.equal(castSnapshot.boss.castBar?.totalDurationMs, BURST_CAST_MS);
    assert.equal(BURST_CAST_MS, 7_000);
    assert.equal(castSnapshot.boss.castBar?.startedAt, BURST_CAST_START_AT);
    assertClosePoint(burstCenter, expectedCenter);
    assert.equal(earlyBurstTelegraph, undefined);
    assertExdeathMarker(exdeathMarker, expectedCenter, EXDEATH_REPOSITION_START_AT);

    const hitActor = getActorBySlot(castSnapshot, 'D1');
    const safeActor = getActorBySlot(castSnapshot, 'D2');
    moveActorsOutsideBurst(simulation, castSnapshot, new Set([hitActor.id]));
    submitPose(simulation, hitActor, expectedCenter);

    advanceTo(simulation, BURST_RESOLVE_AT - 1);

    const preResolveSnapshot = simulation.getSnapshot();
    const preResolveBurstTelegraph = preResolveSnapshot.mechanics.find(
      (mechanic) => mechanic.kind === 'circleTelegraph' && mechanic.label === '暴雷范围',
    );

    assert.equal(preResolveSnapshot.boss.castBar?.actionName, '暴雷');
    assert.equal(preResolveBurstTelegraph, undefined);

    advanceTo(simulation, BURST_RESOLVE_AT);

    const resolvedSnapshot = simulation.getSnapshot();
    const burstTelegraph = resolvedSnapshot.mechanics.find(
      (mechanic) => mechanic.kind === 'circleTelegraph' && mechanic.label === '暴雷范围',
    );
    const resolvedHitActor = resolvedSnapshot.actors.find((actor) => actor.id === hitActor.id);
    const resolvedSafeActor = resolvedSnapshot.actors.find((actor) => actor.id === safeActor.id);

    assert.equal(resolvedSnapshot.boss.castBar, null);
    assert.ok(burstTelegraph);
    assertClosePoint(burstTelegraph.center, expectedCenter);
    assert.equal(burstTelegraph.radius, BURST_RADIUS);
    assert.equal(burstTelegraph.color, BURST_TELEGRAPH_COLOR);
    assert.equal(burstTelegraph.resolveAt, BURST_RESOLVE_AT + RESOLUTION_VISUAL_MS);
    assertActorDied(resolvedHitActor, BURST_RESOLVE_AT);
    assertActorNotDead(resolvedSafeActor);
  });

  withMockedRandom(createSeededRandomValues(23, 100), () => {
    const simulation = createKefkaP3Simulation();

    advanceTo(simulation, MECHANIC_START_AT);

    const mt = getActorBySlot(simulation.getSnapshot(), 'MT');
    const closeMtPosition = { x: BURST_ST_OFFSET - 1, y: 1 };
    assert.ok(distance(closeMtPosition, { x: 0, y: 0 }) <= BURST_ST_OFFSET);
    submitPose(simulation, mt, closeMtPosition);

    advanceTo(simulation, BURST_CAST_START_AT);

    assertClosePoint(getBurstCenter(simulation.getSnapshot()), { x: 0, y: 0 });
  });
});

test('凯夫卡P3一运：第二组暴雷选择艾克斯德司最近目标并判定5m范围', () => {
  withMockedRandom(createSeededRandomValues(23, 100), () => {
    const simulation = createKefkaP3Simulation();

    advanceTo(simulation, MECHANIC_START_AT);
    advanceThroughBurstSafely(simulation);
    advanceTo(simulation, FOLLOWUP_BURST_CAST_START_AT);

    const castSnapshot = simulation.getSnapshot();
    const burstCenter = getBurstCenter(castSnapshot);
    const exdeathMarker = castSnapshot.mechanics.find(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '艾克斯德司',
    );

    assert.equal(castSnapshot.boss.castBar?.actionName, '暴雷');
    assert.equal(castSnapshot.boss.castBar?.totalDurationMs, FOLLOWUP_BURST_CAST_MS);
    assert.equal(castSnapshot.boss.castBar?.startedAt, FOLLOWUP_BURST_CAST_START_AT);
    assertExdeathMarker(exdeathMarker, burstCenter, EXDEATH_REPOSITION_START_AT);

    const mt = getActorBySlot(castSnapshot, 'MT');
    const st = getActorBySlot(castSnapshot, 'ST');
    const nonTankHits = castSnapshot.actors.filter(
      (actor) => actor.alive && actor.slot !== 'MT' && actor.slot !== 'ST',
    );
    assert.ok(nonTankHits.length >= 2);
    const firstNonTankHit = nonTankHits[0];
    const secondNonTankHit = nonTankHits[1];
    const firstTargetPosition = burstCenter;
    moveAliveActorsOutsideFollowupBurst(
      simulation,
      castSnapshot,
      firstTargetPosition,
      new Set([mt.id, st.id, firstNonTankHit.id, secondNonTankHit.id]),
    );
    submitPose(simulation, mt, firstTargetPosition);
    submitPose(simulation, st, add(firstTargetPosition, { x: 2, y: 0 }));
    submitPose(simulation, firstNonTankHit, add(firstTargetPosition, { x: 3, y: 0 }));
    submitPose(simulation, secondNonTankHit, add(firstTargetPosition, { x: 4, y: 0 }));

    advanceTo(simulation, FOLLOWUP_BURST_FIRST_RESOLVE_AT - 1);

    const preResolveSnapshot = simulation.getSnapshot();
    const preResolveTelegraph = preResolveSnapshot.mechanics.find(
      (mechanic) =>
        mechanic.kind === 'circleTelegraph' && mechanic.radius === FOLLOWUP_BURST_RADIUS,
    );
    assert.equal(preResolveSnapshot.boss.castBar?.actionName, '暴雷');
    assert.equal(preResolveTelegraph, undefined);

    advanceTo(simulation, FOLLOWUP_BURST_FIRST_RESOLVE_AT);

    const firstResolvedSnapshot = simulation.getSnapshot();
    const firstTelegraph = firstResolvedSnapshot.mechanics.find(
      (mechanic) =>
        mechanic.kind === 'circleTelegraph' && mechanic.radius === FOLLOWUP_BURST_RADIUS,
    );
    const resolvedMt = getActorBySlot(firstResolvedSnapshot, 'MT');
    const resolvedSt = getActorBySlot(firstResolvedSnapshot, 'ST');
    const resolvedFirstNonTankHit = firstResolvedSnapshot.actors.find(
      (actor) => actor.id === firstNonTankHit.id,
    );
    const resolvedSecondNonTankHit = firstResolvedSnapshot.actors.find(
      (actor) => actor.id === secondNonTankHit.id,
    );
    assert.ok(resolvedFirstNonTankHit);
    assert.ok(resolvedSecondNonTankHit);

    assert.equal(firstResolvedSnapshot.boss.castBar, null);
    assert.ok(firstTelegraph);
    assertClosePoint(firstTelegraph.center, firstTargetPosition);
    assert.equal(firstTelegraph.color, BURST_TELEGRAPH_COLOR);
    assert.equal(firstTelegraph.resolveAt, FOLLOWUP_BURST_FIRST_RESOLVE_AT + RESOLUTION_VISUAL_MS);
    assert.equal(resolvedMt.lastDamageSource, '暴雷');
    assert.ok(hasStatus(resolvedMt, 'injury_up') || !resolvedMt.alive);
    assert.equal(resolvedSt.lastDamageSource, '暴雷');
    assert.ok(hasStatus(resolvedSt, 'injury_up') || !resolvedSt.alive);
    assertActorDied(resolvedFirstNonTankHit, FOLLOWUP_BURST_FIRST_RESOLVE_AT);
    assertActorDied(resolvedSecondNonTankHit, FOLLOWUP_BURST_FIRST_RESOLVE_AT);

    const secondTarget = firstResolvedSnapshot.actors.find(
      (actor) => actor.id === firstNonTankHit.id,
    );
    assert.ok(secondTarget);
    const secondTargetPosition = add(burstCenter, { x: 0, y: 1 });
    moveAliveActorsOutsideFollowupBurst(
      simulation,
      firstResolvedSnapshot,
      secondTargetPosition,
      new Set([secondTarget.id]),
    );
    submitPose(simulation, secondTarget, secondTargetPosition);

    advanceTo(simulation, FOLLOWUP_BURST_SECOND_RESOLVE_AT);

    const secondResolvedSnapshot = simulation.getSnapshot();
    const secondTelegraph = secondResolvedSnapshot.mechanics.find(
      (mechanic) =>
        mechanic.kind === 'circleTelegraph' && mechanic.radius === FOLLOWUP_BURST_RADIUS,
    );
    const resolvedSecondTarget = secondResolvedSnapshot.actors.find(
      (actor) => actor.id === secondTarget.id,
    );
    assert.ok(resolvedSecondTarget);

    assert.ok(secondTelegraph);
    assertClosePoint(secondTelegraph.center, secondTargetPosition);
    assert.equal(secondTelegraph.color, BURST_TELEGRAPH_COLOR);
    assert.equal(
      secondTelegraph.resolveAt,
      FOLLOWUP_BURST_SECOND_RESOLVE_AT + RESOLUTION_VISUAL_MS,
    );
    assertActorDied(resolvedSecondTarget, FOLLOWUP_BURST_FIRST_RESOLVE_AT);
  });
});

test('凯夫卡P3一运：37秒到61秒之间艾克斯德司每秒按MT位置重定位', () => {
  withMockedRandom(createSeededRandomValues(35, 200), () => {
    const simulation = createKefkaP3Simulation();

    advanceTo(simulation, MECHANIC_START_AT);
    advanceThroughBurstSafely(simulation);
    advanceThroughFollowupBurstSafely(simulation);

    let snapshot = simulation.getSnapshot();
    const firstSource = getBurstCenter(snapshot);
    let mt = getActorBySlot(snapshot, 'MT');
    const firstMtPosition = add(firstSource, { x: 12, y: 0 });
    const firstExpectedCenter = calculateVacuumWaveCenter(firstSource, firstMtPosition);
    submitPose(simulation, mt, firstMtPosition);

    advanceTo(simulation, EXDEATH_REPOSITION_START_AT);

    snapshot = simulation.getSnapshot();
    let exdeathMarkers = snapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '艾克斯德司',
    );
    assert.equal(exdeathMarkers.length, 1);
    assertClosePoint(getBurstCenter(snapshot), firstExpectedCenter);
    assertExdeathMarker(
      exdeathMarkers[0],
      firstExpectedCenter,
      EXDEATH_REPOSITION_START_AT + EXDEATH_REPOSITION_INTERVAL_MS,
    );

    mt = getActorBySlot(snapshot, 'MT');
    const secondMtPosition = add(firstExpectedCenter, { x: 0, y: 12 });
    const secondExpectedCenter = calculateVacuumWaveCenter(firstExpectedCenter, secondMtPosition);
    submitPose(simulation, mt, secondMtPosition);

    advanceTo(simulation, EXDEATH_REPOSITION_START_AT + EXDEATH_REPOSITION_INTERVAL_MS);

    snapshot = simulation.getSnapshot();
    exdeathMarkers = snapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '艾克斯德司',
    );
    assert.equal(exdeathMarkers.length, 1);
    assertClosePoint(getBurstCenter(snapshot), secondExpectedCenter);
    assertExdeathMarker(
      exdeathMarkers[0],
      secondExpectedCenter,
      EXDEATH_REPOSITION_START_AT + EXDEATH_REPOSITION_INTERVAL_MS * 2,
    );
    assert.equal(EXDEATH_REPOSITION_END_AT, VACUUM_WAVE_CAST_START_AT);
  });
});

test('凯夫卡P3一运：卡奥斯3秒出现并每秒按ST位置重定位', () => {
  const simulation = createKefkaP3Simulation();

  advanceTo(simulation, CHAOS_MARKER_SPAWN_AT);

  let snapshot = simulation.getSnapshot();
  let chaosMarkers = snapshot.mechanics.filter(
    (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '卡奥斯',
  );
  assert.equal(chaosMarkers.length, 1);
  assertClosePoint(getChaosCenter(snapshot), { x: 0, y: 0 });
  assertChaosMarker(chaosMarkers[0], { x: 0, y: 0 }, CHAOS_REPOSITION_START_AT);

  let st = getActorBySlot(snapshot, 'ST');
  const firstStPosition = { x: 12, y: 0 };
  const firstExpectedCenter = calculateChaosCenter({ x: 0, y: 0 }, firstStPosition);
  submitPose(simulation, st, firstStPosition);

  advanceTo(simulation, CHAOS_REPOSITION_START_AT);

  snapshot = simulation.getSnapshot();
  chaosMarkers = snapshot.mechanics.filter(
    (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '卡奥斯',
  );
  assert.equal(chaosMarkers.length, 1);
  assertClosePoint(getChaosCenter(snapshot), firstExpectedCenter);
  assertChaosMarker(
    chaosMarkers[0],
    firstExpectedCenter,
    CHAOS_REPOSITION_START_AT + CHAOS_REPOSITION_INTERVAL_MS,
  );

  st = getActorBySlot(snapshot, 'ST');
  const closeStPosition = add(firstExpectedCenter, { x: CHAOS_MARKER_ST_OFFSET - 1, y: 0 });
  submitPose(simulation, st, closeStPosition);

  advanceTo(simulation, CHAOS_REPOSITION_START_AT + CHAOS_REPOSITION_INTERVAL_MS);

  snapshot = simulation.getSnapshot();
  chaosMarkers = snapshot.mechanics.filter(
    (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '卡奥斯',
  );
  assert.equal(chaosMarkers.length, 1);
  assertClosePoint(getChaosCenter(snapshot), firstExpectedCenter);
  assertChaosMarker(
    chaosMarkers[0],
    firstExpectedCenter,
    CHAOS_REPOSITION_START_AT + CHAOS_REPOSITION_INTERVAL_MS * 2,
  );
  assert.equal(CHAOS_REPOSITION_END_AT, CHAOS_EXPLOSION_CAST_START_AT);
});

function assertFanTelegraphs(
  snapshot,
  label,
  expectedDirections,
  resolveAt,
  expectedCenter = { x: 0, y: 0 },
) {
  const fanTelegraphs = snapshot.mechanics.filter(
    (mechanic) => mechanic.kind === 'fanTelegraph' && mechanic.label === label,
  );

  assert.equal(fanTelegraphs.length, 2);
  assert.ok(fanTelegraphs.every((mechanic) => mechanic.angle === CHAOS_EXPLOSION_FAN_ANGLE));
  assert.ok(fanTelegraphs.every((mechanic) => mechanic.radius === CHAOS_EXPLOSION_FAN_RADIUS));
  assert.ok(fanTelegraphs.every((mechanic) => mechanic.resolveAt === resolveAt));
  assert.ok(fanTelegraphs.every((mechanic) => distance(mechanic.center, expectedCenter) < 0.001));

  for (const expectedDirection of expectedDirections) {
    assert.ok(
      fanTelegraphs.some((mechanic) => angleDiff(mechanic.direction, expectedDirection) < 0.001),
    );
  }
}

function runChaosExplosionTest({
  randomValue,
  expectedActionName,
  firstDirections,
  secondDirections,
}) {
  withMockedRandom([randomValue], () => {
    const simulation = createKefkaP3Simulation();

    advanceTo(simulation, MECHANIC_START_AT);
    const startSnapshot = simulation.getSnapshot();
    const shortElementType = getElementTypeResolvingAfterDuration(
      startSnapshot,
      SHORT_ELEMENT_BUFF_MS,
    );
    advanceThroughBurstSafely(simulation);
    advanceThroughElementResolutionSafely(
      simulation,
      shortElementType,
      MECHANIC_START_AT + SHORT_ELEMENT_BUFF_MS + DELAYED_RESOLUTION_MS,
    );
    advanceThroughFollowupBurstSafely(simulation);

    let snapshot = simulation.getSnapshot();
    const st = getActorBySlot(snapshot, 'ST');
    const lockedStPosition = { x: 0, y: -12 };
    submitPose(simulation, st, lockedStPosition);

    advanceTo(simulation, CHAOS_EXPLOSION_CAST_START_AT);

    const castSnapshot = simulation.getSnapshot();
    const chaosState = castSnapshot.scriptState['kefkaP3:chaosExplosion'];
    const chaosMarker = castSnapshot.mechanics.find(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '卡奥斯',
    );
    assert.ok(chaosState);
    const chaosCenter = chaosState.center;
    const lockedFacing = angleTo(chaosCenter, lockedStPosition);

    assert.equal(castSnapshot.boss.castBar?.actionName, expectedActionName);
    assert.equal(castSnapshot.boss.castBar?.totalDurationMs, CHAOS_EXPLOSION_CAST_MS);
    assert.equal(castSnapshot.boss.castBar?.startedAt, CHAOS_EXPLOSION_CAST_START_AT);
    assertClosePoint(getChaosCenter(castSnapshot), chaosCenter);
    assertCloseAngle(chaosState.facing, lockedFacing);
    assertChaosMarker(chaosMarker, chaosCenter, SUPER_JUMP_RESOLVE_AT);

    snapshot = simulation.getSnapshot();
    const directionActors = snapshot.actors.filter((actor) => actor.alive && actor.slot !== 'ST');
    assert.ok(directionActors.length >= 3);
    const frontActor = directionActors[0];
    const leftActor = directionActors[1];
    const rightActor = directionActors[2];
    submitPose(
      simulation,
      frontActor,
      add(chaosCenter, { x: Math.cos(lockedFacing) * 12, y: Math.sin(lockedFacing) * 12 }),
    );
    submitPose(
      simulation,
      leftActor,
      add(chaosCenter, {
        x: Math.cos(lockedFacing - Math.PI / 2) * 12,
        y: Math.sin(lockedFacing - Math.PI / 2) * 12,
      }),
    );
    submitPose(
      simulation,
      rightActor,
      add(chaosCenter, {
        x: Math.cos(lockedFacing + Math.PI / 2) * 12,
        y: Math.sin(lockedFacing + Math.PI / 2) * 12,
      }),
    );
    submitPose(simulation, getActorBySlot(snapshot, 'ST'), { x: 12, y: 12 });

    advanceTo(simulation, CHAOS_EXPLOSION_FIRST_RESOLVE_AT);

    const firstSnapshot = simulation.getSnapshot();
    assert.equal(firstSnapshot.boss.castBar, null);
    assertFanTelegraphs(
      firstSnapshot,
      `${expectedActionName}范围`,
      firstDirections(lockedFacing),
      CHAOS_EXPLOSION_FIRST_RESOLVE_AT + RESOLUTION_VISUAL_MS,
      chaosCenter,
    );

    const firstFrontActor = firstSnapshot.actors.find((actor) => actor.id === frontActor.id);
    const firstLeftActor = firstSnapshot.actors.find((actor) => actor.id === leftActor.id);
    const firstRightActor = firstSnapshot.actors.find((actor) => actor.id === rightActor.id);
    assert.ok(firstFrontActor);
    assert.ok(firstLeftActor);
    assert.ok(firstRightActor);

    if (expectedActionName === '经度聚爆') {
      assertActorDied(firstFrontActor, CHAOS_EXPLOSION_FIRST_RESOLVE_AT);
    } else {
      assertActorDied(firstLeftActor, CHAOS_EXPLOSION_FIRST_RESOLVE_AT);
      assertActorDied(firstRightActor, CHAOS_EXPLOSION_FIRST_RESOLVE_AT);
      assertActorNotDead(firstFrontActor);
    }
    advanceTo(simulation, CHAOS_EXPLOSION_SECOND_RESOLVE_AT);

    const secondSnapshot = simulation.getSnapshot();
    assertFanTelegraphs(
      secondSnapshot,
      `${expectedActionName}范围`,
      secondDirections(lockedFacing),
      CHAOS_EXPLOSION_SECOND_RESOLVE_AT + RESOLUTION_VISUAL_MS,
      chaosCenter,
    );

    const secondFrontActor = secondSnapshot.actors.find((actor) => actor.id === frontActor.id);
    const secondLeftActor = secondSnapshot.actors.find((actor) => actor.id === leftActor.id);
    const secondRightActor = secondSnapshot.actors.find((actor) => actor.id === rightActor.id);
    assert.ok(secondFrontActor);
    assert.ok(secondLeftActor);
    assert.ok(secondRightActor);

    if (expectedActionName === '经度聚爆') {
      assert.ok(!secondLeftActor.alive);
      assert.ok(!secondRightActor.alive);
      assertActorDied(secondFrontActor, CHAOS_EXPLOSION_FIRST_RESOLVE_AT);
    } else {
      assertActorDied(secondFrontActor, CHAOS_EXPLOSION_SECOND_RESOLVE_AT);
      assertActorDied(secondLeftActor, CHAOS_EXPLOSION_FIRST_RESOLVE_AT);
      assertActorDied(secondRightActor, CHAOS_EXPLOSION_FIRST_RESOLVE_AT);
    }
  });
}

test('凯夫卡P3一运：经度聚爆先前后再左右并锁定卡奥斯面向', () => {
  runChaosExplosionTest({
    randomValue: 0.25,
    expectedActionName: '经度聚爆',
    firstDirections: (facing) => [facing, facing + Math.PI],
    secondDirections: (facing) => [facing - Math.PI / 2, facing + Math.PI / 2],
  });
});

test('凯夫卡P3一运：纬度聚爆先左右再前后并锁定卡奥斯面向', () => {
  runChaosExplosionTest({
    randomValue: 0.75,
    expectedActionName: '纬度聚爆',
    firstDirections: (facing) => [facing - Math.PI / 2, facing + Math.PI / 2],
    secondDirections: (facing) => [facing, facing + Math.PI],
  });
});

test('凯夫卡P3一运：超级跳锁定最远玩家位置并在67s结算11m范围', () => {
  withMockedRandom(createSeededRandomValues(30, 100), () => {
    const simulation = createKefkaP3Simulation();

    advanceToVacuumWaveSetup(simulation);

    const setupSnapshot = simulation.getSnapshot();
    const availableActors = setupSnapshot.actors.filter((actor) => actor.alive);
    assert.ok(availableActors.length >= 2);
    const lockedActor = availableActors[0];
    const hitActor = availableActors[1];
    const lockedPosition = { x: 12, y: 0 };
    const movedLockedPosition = { x: -12, y: 0 };
    const hitPosition = { x: 15, y: 0 };
    const safePosition = { x: 0, y: 0 };
    const originalChaosMarker = setupSnapshot.mechanics.find(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '卡奥斯',
    );
    const chaosState = setupSnapshot.scriptState['kefkaP3:chaosExplosion'];

    assert.ok(chaosState);
    assertChaosMarker(originalChaosMarker, chaosState.center, SUPER_JUMP_RESOLVE_AT);

    for (const actor of setupSnapshot.actors) {
      submitPose(simulation, actor, safePosition);
    }
    submitPose(simulation, lockedActor, lockedPosition);

    advanceTo(simulation, SUPER_JUMP_LOCK_AT);

    const lockedSnapshot = simulation.getSnapshot();
    const superJumpCenter = lockedSnapshot.scriptState['kefkaP3:superJumpCenter'];
    assert.ok(superJumpCenter);
    assertClosePoint(superJumpCenter, lockedPosition);

    submitPose(
      simulation,
      lockedSnapshot.actors.find((actor) => actor.id === lockedActor.id),
      movedLockedPosition,
    );
    submitPose(
      simulation,
      lockedSnapshot.actors.find((actor) => actor.id === hitActor.id),
      hitPosition,
    );

    advanceTo(simulation, SUPER_JUMP_RESOLVE_AT);

    const resolvedSnapshot = simulation.getSnapshot();
    const superJumpTelegraph = resolvedSnapshot.mechanics.find(
      (mechanic) => mechanic.kind === 'circleTelegraph' && mechanic.label === '超级跳范围',
    );
    const jumpedChaosMarker = resolvedSnapshot.mechanics.find(
      (mechanic) =>
        mechanic.kind === 'fieldMarker' &&
        mechanic.label === '卡奥斯' &&
        mechanic.resolveAt === COMPLETE_AT,
    );
    const resolvedLockedActor = resolvedSnapshot.actors.find(
      (actor) => actor.id === lockedActor.id,
    );
    const resolvedHitActor = resolvedSnapshot.actors.find((actor) => actor.id === hitActor.id);

    assert.ok(superJumpTelegraph);
    assertClosePoint(superJumpTelegraph.center, lockedPosition);
    assert.equal(superJumpTelegraph.radius, SUPER_JUMP_RADIUS);
    assert.equal(superJumpTelegraph.resolveAt, SUPER_JUMP_RESOLVE_AT + RESOLUTION_VISUAL_MS);
    assertChaosMarker(jumpedChaosMarker, lockedPosition, COMPLETE_AT);
    assert.ok(resolvedLockedActor);
    assert.ok(resolvedHitActor);
    assertActorNotDead(resolvedLockedActor);
    assertActorDied(resolvedHitActor, SUPER_JUMP_RESOLVE_AT);
  });
});

test('凯夫卡P3一运：超级跳最远目标距离相同时按队伍顺序锁定', () => {
  withMockedRandom(createSeededRandomValues(31, 100), () => {
    const simulation = createKefkaP3Simulation();

    advanceToVacuumWaveSetup(simulation);

    const setupSnapshot = simulation.getSnapshot();
    const mt = getActorBySlot(setupSnapshot, 'MT');
    const st = getActorBySlot(setupSnapshot, 'ST');

    for (const actor of setupSnapshot.actors) {
      submitPose(simulation, actor, { x: 0, y: 0 });
    }
    submitPose(simulation, mt, { x: 12, y: 0 });
    submitPose(simulation, st, { x: 0, y: 12 });

    advanceTo(simulation, SUPER_JUMP_LOCK_AT);

    const superJumpCenter = simulation.getSnapshot().scriptState['kefkaP3:superJumpCenter'];
    assert.ok(superJumpCenter);
    assertClosePoint(superJumpCenter, { x: 12, y: 0 });
  });
});

test('凯夫卡P3一运：真空波在61s锁定并重建艾克斯德司位置', () => {
  withMockedRandom(createSeededRandomValues(27, 100), () => {
    const simulation = createKefkaP3Simulation();

    advanceToVacuumWaveSetup(simulation);

    const beforeCastSnapshot = simulation.getSnapshot();
    const oldExdeathCenter = getBurstCenter(beforeCastSnapshot);
    const oldExdeathMarker = beforeCastSnapshot.mechanics.find(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '艾克斯德司',
    );
    const mt = getActorBySlot(beforeCastSnapshot, 'MT');
    const mtPosition = add(oldExdeathCenter, { x: 12, y: 0 });
    const expectedCenter = calculateVacuumWaveCenter(oldExdeathCenter, mtPosition);

    assertExdeathMarker(oldExdeathMarker, oldExdeathCenter, VACUUM_WAVE_CAST_START_AT);

    submitPose(simulation, mt, mtPosition);
    advanceTo(simulation, VACUUM_WAVE_CAST_START_AT);

    const castSnapshot = simulation.getSnapshot();
    const newExdeathMarker = castSnapshot.mechanics.find(
      (mechanic) =>
        mechanic.kind === 'fieldMarker' &&
        mechanic.label === '艾克斯德司' &&
        mechanic.resolveAt === COMPLETE_AT,
    );

    assert.equal(castSnapshot.boss.castBar?.actionName, '真空波');
    assert.equal(castSnapshot.boss.castBar?.totalDurationMs, VACUUM_WAVE_CAST_MS);
    assert.equal(castSnapshot.boss.castBar?.startedAt, VACUUM_WAVE_CAST_START_AT);
    assert.equal(VACUUM_WAVE_CAST_MS, 8_000);
    assertClosePoint(getBurstCenter(castSnapshot), expectedCenter);
    assertExdeathMarker(newExdeathMarker, expectedCenter, COMPLETE_AT);
  });

  withMockedRandom(createSeededRandomValues(28, 100), () => {
    const simulation = createKefkaP3Simulation();

    advanceToVacuumWaveSetup(simulation);

    const beforeCastSnapshot = simulation.getSnapshot();
    const oldExdeathCenter = getBurstCenter(beforeCastSnapshot);
    const mt = getActorBySlot(beforeCastSnapshot, 'MT');
    const closeMtPosition = add(oldExdeathCenter, { x: VACUUM_WAVE_MT_OFFSET - 1, y: 0 });

    submitPose(simulation, mt, closeMtPosition);
    advanceTo(simulation, VACUUM_WAVE_CAST_START_AT);

    assertClosePoint(getBurstCenter(simulation.getSnapshot()), oldExdeathCenter);
  });
});

test('凯夫卡P3一运：真空波按风处理击退并且防击退不消风', () => {
  withMockedRandom(createSeededRandomValues(29, 100), () => {
    const simulation = createKefkaP3Simulation();
    const noWindActorId = getActorBySlot(simulation.getSnapshot(), 'D4').id;

    assert.equal(BASE_ELEMENT_KNOCKBACK_DISTANCE, 20);

    advanceToVacuumWaveSetup(simulation, { consumeWindActorId: noWindActorId });

    let snapshot = simulation.getSnapshot();
    const oldExdeathCenter = getBurstCenter(snapshot);
    const mt = getActorBySlot(snapshot, 'MT');
    const mtPosition = add(oldExdeathCenter, { x: 12, y: 0 });
    submitPose(simulation, mt, mtPosition);

    advanceTo(simulation, VACUUM_WAVE_CAST_START_AT);

    snapshot = simulation.getSnapshot();
    const vacuumCenter = getBurstCenter(snapshot);
    const noWindActor = snapshot.actors.find((actor) => actor.id === noWindActorId);
    const windActors = snapshot.actors.filter(
      (actor) => hasStatus(actor, CHAOS_WIND_STATUS_ID) && actor.id !== noWindActorId,
    );
    assert.ok(noWindActor);
    assert.equal(getStatus(noWindActor, CHAOS_WIND_STATUS_ID), null);
    assert.equal(getStatus(noWindActor, CHAOS_REVERSE_WIND_STATUS_ID), null);
    assert.ok(windActors.length >= 3);

    const windCorrectActor = windActors[0];
    const windFailureActor = windActors[1];
    const immuneActor = windActors[2];
    const safeDirection =
      distance(vacuumCenter, { x: 0, y: 0 }) < 0.001
        ? { x: 1, y: 0 }
        : normalize(scale(vacuumCenter, -1));
    const noWindPosition = add(vacuumCenter, scale(safeDirection, 2));
    const windCorrectPosition = add(vacuumCenter, scale(safeDirection, 4));
    const windFailurePosition = add(vacuumCenter, scale(safeDirection, 6));
    const immunePosition = add(vacuumCenter, scale(safeDirection, 8));

    submitPose(simulation, noWindActor, noWindPosition, angleTo(vacuumCenter, noWindPosition));
    submitPose(
      simulation,
      windCorrectActor,
      windCorrectPosition,
      angleTo(vacuumCenter, windCorrectPosition),
    );
    submitPose(
      simulation,
      windFailureActor,
      windFailurePosition,
      angleTo(windFailurePosition, vacuumCenter),
    );
    submitPose(simulation, immuneActor, immunePosition, 0);

    advanceTo(simulation, VACUUM_WAVE_RESOLVE_AT - 1_000);
    const immuneActorBeforeCommand = simulation
      .getSnapshot()
      .actors.find((actor) => actor.id === immuneActor.id);
    assert.ok(immuneActorBeforeCommand);
    submitKnockbackImmune(simulation, immuneActorBeforeCommand);
    advanceTo(simulation, VACUUM_WAVE_RESOLVE_AT - 950);

    const beforeResolveSnapshot = simulation.getSnapshot();
    const immuneBeforeResolve = beforeResolveSnapshot.actors.find(
      (actor) => actor.id === immuneActor.id,
    );
    assert.ok(immuneBeforeResolve.knockbackImmune);
    assert.ok(hasStatus(immuneBeforeResolve, CHAOS_WIND_STATUS_ID));
    assert.equal(beforeResolveSnapshot.boss.castBar?.actionName, '真空波');
    const expectedWindResolutionCount = beforeResolveSnapshot.actors.filter(
      (actor) =>
        actor.mechanicActive &&
        !actor.knockbackImmune &&
        (hasStatus(actor, CHAOS_WIND_STATUS_ID) || hasStatus(actor, CHAOS_REVERSE_WIND_STATUS_ID)),
    ).length;
    simulation.drainEvents();

    advanceTo(simulation, VACUUM_WAVE_RESOLVE_AT);

    const resolvedSnapshot = simulation.getSnapshot();
    const forcedMovementEvents = simulation
      .drainEvents()
      .filter((event) => event.type === 'actorForcedMovementRequested');
    const noWindEvent = forcedMovementEvents.find(
      (event) => event.payload.actorId === noWindActor.id,
    );
    const windCorrectEvent = forcedMovementEvents.find(
      (event) => event.payload.actorId === windCorrectActor.id,
    );
    const windFailureEvent = forcedMovementEvents.find(
      (event) => event.payload.actorId === windFailureActor.id,
    );
    const immuneEvent = forcedMovementEvents.find(
      (event) => event.payload.actorId === immuneActor.id,
    );

    assert.equal(resolvedSnapshot.boss.castBar, null);
    assert.ok(noWindEvent);
    assert.ok(windCorrectEvent);
    assert.ok(windFailureEvent);
    assert.equal(immuneEvent, undefined);
    assertClosePoint(noWindEvent.payload.source, vacuumCenter);
    assertClosePoint(windCorrectEvent.payload.source, vacuumCenter);
    assertClosePoint(windFailureEvent.payload.source, vacuumCenter);
    assert.equal(noWindEvent.payload.distance, BASE_ELEMENT_KNOCKBACK_DISTANCE);
    assert.equal(windCorrectEvent.payload.distance, BASE_ELEMENT_KNOCKBACK_DISTANCE / 2);
    assert.equal(windFailureEvent.payload.distance, BASE_ELEMENT_KNOCKBACK_DISTANCE * 2);

    const resolvedWindCorrectActor = resolvedSnapshot.actors.find(
      (actor) => actor.id === windCorrectActor.id,
    );
    const resolvedWindFailureActor = resolvedSnapshot.actors.find(
      (actor) => actor.id === windFailureActor.id,
    );
    const resolvedImmuneActor = resolvedSnapshot.actors.find(
      (actor) => actor.id === immuneActor.id,
    );
    assert.ok(resolvedWindCorrectActor);
    assert.ok(resolvedWindFailureActor);
    assert.ok(resolvedImmuneActor);
    assert.ok(!hasStatus(resolvedWindCorrectActor, CHAOS_WIND_STATUS_ID));
    assert.ok(!hasStatus(resolvedWindFailureActor, CHAOS_WIND_STATUS_ID));
    assert.ok(hasStatus(resolvedImmuneActor, CHAOS_WIND_STATUS_ID));

    const windResolution = resolvedSnapshot.scriptState['kefkaP3:pendingResolutions'].find(
      (resolution) =>
        resolution.kind === 'wind' &&
        resolution.resolveAt === VACUUM_WAVE_RESOLVE_AT + DELAYED_RESOLUTION_MS,
    );
    assert.ok(windResolution);
    assert.equal(windResolution.count, expectedWindResolutionCount);

    advanceTo(simulation, VACUUM_WAVE_RESOLVE_AT + DELAYED_RESOLUTION_MS);

    const shareSnapshot = simulation.getSnapshot();
    const windTelegraphs = shareSnapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'circleTelegraph' && mechanic.label === '混沌之风分摊范围',
    );
    assert.ok(windTelegraphs.length >= 1);
  });
});

test('凯夫卡P3一运：读条结束后生成三种元素块并赋予状态', () => {
  withMockedRandom(createSeededRandomValues(21, 100), () => {
    const simulation = createKefkaP3Simulation();

    assert.equal(MECHANIC_START_AT, 4_000);
    assert.equal(simulation.getSnapshot().bossTargetRingRadius, 0);

    advanceTo(simulation, DEEP_AGONY_CAST_START_AT - 50);
    assert.equal(simulation.getSnapshot().boss.castBar, null);

    advanceTo(simulation, DEEP_AGONY_CAST_START_AT);
    const castSnapshot = simulation.getSnapshot();
    assert.equal(castSnapshot.boss.castBar?.actionName, '深层痛楚');
    assert.equal(castSnapshot.boss.castBar?.totalDurationMs, DEEP_AGONY_CAST_MS);

    advanceTo(simulation, MECHANIC_START_AT - 50);
    assert.equal(simulation.getSnapshot().boss.castBar?.actionName, '深层痛楚');

    advanceTo(simulation, MECHANIC_START_AT);

    const snapshot = simulation.getSnapshot();
    const elementBlocks = getElementBlocks(snapshot);
    const fieldMarkers = snapshot.mechanics.filter((mechanic) => mechanic.kind === 'fieldMarker');
    const chaosMarker = fieldMarkers.find((mechanic) => mechanic.label === '卡奥斯');
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
    assert.deepEqual(
      fieldMarkers.map((marker) => [marker.label, marker.shape]).sort(),
      [
        ['卡奥斯', 'enemy'],
        ['水元素块', 'square'],
        ['火元素块', 'triangle'],
        ['风元素块', 'diamond'],
      ].sort(),
    );
    assertChaosMarker(
      chaosMarker,
      getChaosCenter(snapshot),
      CHAOS_REPOSITION_START_AT + CHAOS_REPOSITION_INTERVAL_MS,
    );
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

test('凯夫卡P3一运：火元素追击按火元素块距离点名最近2人', () => {
  withMockedRandom(createSeededRandomValues(1, 100), () => {
    const simulation = createKefkaP3Simulation();

    advanceTo(simulation, MECHANIC_START_AT);

    const startSnapshot = simulation.getSnapshot();
    const fireDuration = startSnapshot.scriptState['kefkaP3:elementStatusDurations'].fire;
    const fireBlock = getElementBlock(startSnapshot, 'fire');
    const inward = normalize({ x: -fireBlock.position.x, y: -fireBlock.position.y });
    assert.equal(fireDuration, SHORT_ELEMENT_BUFF_MS);

    advanceThroughBurstSafely(simulation);
    advanceTo(simulation, MECHANIC_START_AT + fireDuration + TELEGRAPH_MS);

    const preElementSnapshot = simulation.getSnapshot();
    const candidateActors = preElementSnapshot.actors
      .filter((actor) => !hasStatus(actor, CHAOS_FIRE_STATUS_ID) && actor.alive)
      .slice(0, 3);
    assert.equal(candidateActors.length, 3);

    moveActorsFarFromElements(
      simulation,
      preElementSnapshot,
      new Set(candidateActors.map((actor) => actor.id)),
    );

    const candidatePositions = [1, 4, 7].map((offset) =>
      add(fireBlock.position, scale(inward, offset)),
    );

    for (const [index, actor] of candidateActors.entries()) {
      submitPose(simulation, actor, candidatePositions[index]);
    }

    advanceTo(simulation, MECHANIC_START_AT + fireDuration + DELAYED_RESOLUTION_MS);

    const resolvedSnapshot = simulation.getSnapshot();
    const fireTelegraphs = resolvedSnapshot.mechanics.filter(
      (mechanic) =>
        mechanic.kind === 'donutTelegraph' &&
        mechanic.label === '火元素追击范围' &&
        mechanic.innerRadius === FIRE_ELEMENT_INNER_RADIUS &&
        mechanic.outerRadius === FIRE_ELEMENT_OUTER_RADIUS,
    );

    assertTelegraphCenters(fireTelegraphs, candidatePositions.slice(0, 2));
    assert.equal(
      fireTelegraphs.some((mechanic) => distance(mechanic.center, candidatePositions[2]) < 0.001),
      false,
    );
  });
});

test('凯夫卡P3一运：水buff两次消除后延迟1500ms点名最近2人', () => {
  withMockedRandom(createSeededRandomValues(24, 100), () => {
    const simulation = createKefkaP3Simulation();

    advanceTo(simulation, MECHANIC_START_AT);

    const startSnapshot = simulation.getSnapshot();
    const waterDuration = startSnapshot.scriptState['kefkaP3:elementStatusDurations'].water;
    const waterBlock = getElementBlock(startSnapshot, 'water');
    let candidateActors = startSnapshot.actors
      .filter((actor) => !hasStatus(actor, CHAOS_WATER_STATUS_ID))
      .slice(0, 2);
    const inward = normalize({ x: -waterBlock.position.x, y: -waterBlock.position.y });
    const perpendicular = { x: -inward.y, y: inward.x };
    let awayActorIds = new Set(candidateActors.map((actor) => actor.id));
    let candidatePositions = candidateActors.map((_, index) =>
      add(waterBlock.position, scale(inward, 1 + index * 6)),
    );

    advanceThroughBurstSafely(simulation);
    if (waterDuration === LONG_ELEMENT_BUFF_MS) {
      advanceThroughFollowupBurstSafely(simulation);
    }

    advanceTo(simulation, MECHANIC_START_AT + waterDuration);

    const expiredSnapshot = simulation.getSnapshot();
    const waterBuffTelegraphs = expiredSnapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'donutTelegraph' && mechanic.label === '混沌之水预兆',
    );
    assert.equal(waterBuffTelegraphs.length, 2);
    assert.ok(waterBuffTelegraphs.every((mechanic) => mechanic.color === WATER_TELEGRAPH_COLOR));

    assert.deepEqual(expiredSnapshot.scriptState['kefkaP3:pendingResolutions'], [
      {
        kind: 'water',
        count: 2,
        resolveAt: MECHANIC_START_AT + waterDuration + DELAYED_RESOLUTION_MS,
      },
    ]);

    advanceTo(simulation, MECHANIC_START_AT + waterDuration + TELEGRAPH_MS);

    const preElementSnapshot = simulation.getSnapshot();
    candidateActors = preElementSnapshot.actors
      .filter(
        (actor) =>
          !hasStatus(actor, CHAOS_WATER_STATUS_ID) && actor.alive && !hasStatus(actor, 'injury_up'),
      )
      .slice(0, 3);
    assert.equal(candidateActors.length, 3);
    awayActorIds = new Set(candidateActors.map((actor) => actor.id));
    candidatePositions = [
      add(waterBlock.position, scale(inward, 1)),
      add(add(waterBlock.position, scale(inward, 1)), scale(perpendicular, 5.5)),
      add(waterBlock.position, scale(inward, 8)),
    ];

    const farCenter = scale(waterBlock.position, -1);
    const farOffsets = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: -2, y: 0 },
      { x: 0, y: 2 },
      { x: 0, y: -2 },
      { x: 2, y: 2 },
      { x: -2, y: -2 },
      { x: 2, y: -2 },
    ];
    let farPositionIndex = 0;

    for (const actor of preElementSnapshot.actors) {
      if (awayActorIds.has(actor.id)) {
        continue;
      }

      submitPose(simulation, actor, add(farCenter, farOffsets[farPositionIndex++]));
    }

    for (const [index, actor] of candidateActors.entries()) {
      submitPose(simulation, actor, candidatePositions[index]);
    }

    advanceTo(simulation, MECHANIC_START_AT + waterDuration + DELAYED_RESOLUTION_MS);

    const resolvedSnapshot = simulation.getSnapshot();
    const resolvedCandidates = candidateActors.map((actor) =>
      resolvedSnapshot.actors.find((candidate) => candidate.id === actor.id),
    );

    assert.ok(
      resolvedCandidates.slice(0, 2).every((actor) => actor.lastDamageSource === '水元素块'),
    );
    assert.notEqual(resolvedCandidates[2].lastDamageSource, '水元素块');
    assert.ok(
      !resolvedSnapshot.scriptState['kefkaP3:pendingResolutions'].some(
        (resolution) => resolution.kind === 'water',
      ),
    );

    const waterTelegraphs = resolvedSnapshot.mechanics.filter(
      (mechanic) =>
        mechanic.kind === 'circleTelegraph' &&
        mechanic.label === '水元素追击范围' &&
        mechanic.radius === WATER_ELEMENT_RADIUS,
    );
    assert.ok(waterTelegraphs.every((mechanic) => mechanic.color === WATER_TELEGRAPH_COLOR));
    assertTelegraphCenters(waterTelegraphs, candidatePositions.slice(0, 2));
    assert.equal(
      waterTelegraphs.some((mechanic) => distance(mechanic.center, candidatePositions[2]) < 0.001),
      false,
    );

    const forcedMovementEvents = simulation
      .drainEvents()
      .filter((event) => event.type === 'actorForcedMovementRequested');
    assert.ok(
      candidateActors.every(
        (actor) => !forcedMovementEvents.some((event) => event.payload.actorId === actor.id),
      ),
    );
  });
});

test('凯夫卡P3一运：元素追击同距离目标按队伍顺序稳定点名', () => {
  withMockedRandom(createSeededRandomValues(24, 100), () => {
    const simulation = createKefkaP3Simulation();

    advanceTo(simulation, MECHANIC_START_AT);

    const startSnapshot = simulation.getSnapshot();
    const waterDuration = startSnapshot.scriptState['kefkaP3:elementStatusDurations'].water;
    const waterBlock = getElementBlock(startSnapshot, 'water');
    const inward = normalize({ x: -waterBlock.position.x, y: -waterBlock.position.y });
    const perpendicular = { x: -inward.y, y: inward.x };
    assert.equal(waterDuration, SHORT_ELEMENT_BUFF_MS);

    advanceThroughBurstSafely(simulation);
    advanceTo(simulation, MECHANIC_START_AT + waterDuration + TELEGRAPH_MS);

    const preElementSnapshot = simulation.getSnapshot();
    const candidateActors = preElementSnapshot.actors
      .filter(
        (actor) =>
          !hasStatus(actor, CHAOS_WATER_STATUS_ID) && actor.alive && !hasStatus(actor, 'injury_up'),
      )
      .sort(
        (left, right) => PARTY_SLOT_ORDER.indexOf(left.slot) - PARTY_SLOT_ORDER.indexOf(right.slot),
      )
      .slice(0, 3);
    assert.equal(candidateActors.length, 3);

    moveActorsFarFromElements(
      simulation,
      preElementSnapshot,
      new Set(candidateActors.map((actor) => actor.id)),
    );

    const candidatePositions = [
      add(waterBlock.position, scale(inward, 6)),
      add(waterBlock.position, scale(perpendicular, 6)),
      add(waterBlock.position, scale(perpendicular, -6)),
    ];

    for (const [index, actor] of candidateActors.entries()) {
      submitPose(simulation, actor, candidatePositions[index]);
    }

    advanceTo(simulation, MECHANIC_START_AT + waterDuration + DELAYED_RESOLUTION_MS);

    const resolvedSnapshot = simulation.getSnapshot();
    const waterTelegraphs = resolvedSnapshot.mechanics.filter(
      (mechanic) =>
        mechanic.kind === 'circleTelegraph' &&
        mechanic.label === '水元素追击范围' &&
        mechanic.radius === WATER_ELEMENT_RADIUS,
    );

    assertTelegraphCenters(waterTelegraphs, candidatePositions.slice(0, 2));
    assert.equal(
      waterTelegraphs.some((mechanic) => distance(mechanic.center, candidatePositions[2]) < 0.001),
      false,
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
    const targetActors = startSnapshot.actors
      .filter((actor) => actor.id !== windActor.id && !hasStatus(actor, CHAOS_WATER_STATUS_ID))
      .slice(0, 2);
    assert.equal(targetActors.length, 2);

    const inward = normalize({ x: -waterBlock.position.x, y: -waterBlock.position.y });
    const perpendicular = { x: -inward.y, y: inward.x };
    const targetPositions = [
      add(waterBlock.position, scale(inward, 1)),
      add(waterBlock.position, scale(inward, 3)),
    ];
    const windPosition = add(targetPositions[0], scale(perpendicular, 4.8));
    advanceThroughBurstSafely(simulation);
    if (waterDuration === LONG_ELEMENT_BUFF_MS) {
      advanceThroughFollowupBurstSafely(simulation);
    }
    advanceTo(simulation, MECHANIC_START_AT + waterDuration + TELEGRAPH_MS);
    moveActorsFarFromElements(
      simulation,
      simulation.getSnapshot(),
      new Set([windActor.id, ...targetActors.map((actor) => actor.id)]),
    );
    for (const [index, actor] of targetActors.entries()) {
      submitPose(simulation, actor, targetPositions[index]);
    }
    submitPose(simulation, windActor, windPosition, angleTo(windPosition, waterBlock.position));
    simulation.drainEvents();

    advanceTo(simulation, MECHANIC_START_AT + waterDuration + DELAYED_RESOLUTION_MS);

    const forcedMovementEvents = getForcedMovementEvents(simulation, windActor.id);
    const resolvedWindActor = simulation
      .getSnapshot()
      .actors.find((actor) => actor.id === windActor.id);

    assert.equal(forcedMovementEvents.at(-1).payload.distance, BASE_ELEMENT_KNOCKBACK_DISTANCE * 2);
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

test('凯夫卡P3一运：风分摊追击按风元素块距离点名累计次数', () => {
  withMockedRandom(createSeededRandomValues(24, 100), () => {
    const simulation = createKefkaP3Simulation();

    advanceTo(simulation, MECHANIC_START_AT);

    const startSnapshot = simulation.getSnapshot();
    const waterDuration = startSnapshot.scriptState['kefkaP3:elementStatusDurations'].water;
    const waterBlock = getElementBlock(startSnapshot, 'water');
    const windBlock = getElementBlock(startSnapshot, 'wind');
    assert.equal(waterDuration, SHORT_ELEMENT_BUFF_MS);

    advanceThroughBurstSafely(simulation);
    advanceTo(simulation, MECHANIC_START_AT + waterDuration + TELEGRAPH_MS);

    const preElementSnapshot = simulation.getSnapshot();
    const waterElementActors = preElementSnapshot.actors
      .filter(
        (actor) =>
          !hasStatus(actor, CHAOS_WATER_STATUS_ID) && actor.alive && !hasStatus(actor, 'injury_up'),
      )
      .slice(0, 4);
    assert.equal(waterElementActors.length, 4);

    const waterTargets = waterElementActors.slice(0, 2);
    const windHits = waterElementActors.slice(2, 4);
    const waterInward = normalize({ x: -waterBlock.position.x, y: -waterBlock.position.y });
    const waterPerpendicular = { x: -waterInward.y, y: waterInward.x };
    const waterTargetPositions = [
      add(waterBlock.position, scale(waterInward, 1)),
      add(add(waterBlock.position, scale(waterInward, 1)), scale(waterPerpendicular, 5.5)),
    ];
    const secondTargetDirection = normalize({
      x: waterTargetPositions[1].x - waterBlock.position.x,
      y: waterTargetPositions[1].y - waterBlock.position.y,
    });
    const windHitPositions = [
      add(waterTargetPositions[0], scale(waterInward, 4.8)),
      add(waterBlock.position, scale(secondTargetDirection, 6)),
    ];

    moveActorsFarFromElements(
      simulation,
      preElementSnapshot,
      new Set(waterElementActors.map((actor) => actor.id)),
    );

    for (const [index, actor] of waterTargets.entries()) {
      submitPose(simulation, actor, waterTargetPositions[index]);
    }

    for (const [index, actor] of windHits.entries()) {
      submitPose(
        simulation,
        actor,
        windHitPositions[index],
        angleTo(windHitPositions[index], waterBlock.position),
      );
    }

    const waterResolveAt = MECHANIC_START_AT + waterDuration + DELAYED_RESOLUTION_MS;
    advanceTo(simulation, waterResolveAt);

    const afterWaterSnapshot = simulation.getSnapshot();
    const windResolution = afterWaterSnapshot.scriptState['kefkaP3:pendingResolutions'].find(
      (resolution) =>
        resolution.kind === 'wind' &&
        resolution.resolveAt === waterResolveAt + DELAYED_RESOLUTION_MS,
    );
    assert.ok(windResolution);
    assert.equal(windResolution.count, 2);

    const expectedActors = [
      getActorBySlot(afterWaterSnapshot, 'MT'),
      getActorBySlot(afterWaterSnapshot, 'ST'),
    ];
    const decoyActor = getActorBySlot(afterWaterSnapshot, 'D4');
    const windInward = normalize({ x: -windBlock.position.x, y: -windBlock.position.y });
    const expectedPositions = [
      add(windBlock.position, scale(windInward, 1)),
      add(windBlock.position, scale(windInward, 3)),
    ];
    const decoyPosition = add(waterBlock.position, scale(waterInward, 1));
    const excludedActorIds = new Set([...expectedActors.map((actor) => actor.id), decoyActor.id]);

    for (const actor of afterWaterSnapshot.actors) {
      if (excludedActorIds.has(actor.id)) {
        continue;
      }

      submitPose(simulation, actor, add(waterBlock.position, { x: 0, y: -2 }));
    }

    for (const [index, actor] of expectedActors.entries()) {
      submitPose(simulation, actor, expectedPositions[index]);
    }
    submitPose(simulation, decoyActor, decoyPosition);

    advanceTo(simulation, waterResolveAt + DELAYED_RESOLUTION_MS);

    const resolvedSnapshot = simulation.getSnapshot();
    const windTelegraphs = resolvedSnapshot.mechanics.filter(
      (mechanic) =>
        mechanic.kind === 'circleTelegraph' &&
        mechanic.label === '混沌之风分摊范围' &&
        mechanic.radius === WIND_SHARE_RADIUS,
    );

    assertTelegraphCenters(windTelegraphs, expectedPositions);
    assert.equal(
      windTelegraphs.some((mechanic) => distance(mechanic.center, decoyPosition) < 0.001),
      false,
    );
  });
});

test('凯夫卡P3一运：风消除后延迟1500ms判定2人分摊，少于2人进入统一死亡状态', () => {
  withMockedRandom(createSeededRandomValues(24, 100), () => {
    const simulation = createKefkaP3Simulation();

    advanceTo(simulation, MECHANIC_START_AT);

    const startSnapshot = simulation.getSnapshot();
    const waterDuration = startSnapshot.scriptState['kefkaP3:elementStatusDurations'].water;
    const waterBlock = getElementBlock(startSnapshot, 'water');
    const windBlock = getElementBlock(startSnapshot, 'wind');
    const windActor = startSnapshot.actors.find(
      (actor) => hasStatus(actor, CHAOS_WIND_STATUS_ID) && !hasStatus(actor, CHAOS_WATER_STATUS_ID),
    );
    assert.ok(windActor);
    const targetActors = startSnapshot.actors
      .filter((actor) => actor.id !== windActor.id && !hasStatus(actor, CHAOS_WATER_STATUS_ID))
      .slice(0, 2);
    assert.equal(targetActors.length, 2);

    const inward = normalize({ x: -waterBlock.position.x, y: -waterBlock.position.y });
    const perpendicular = { x: -inward.y, y: inward.x };
    const targetPositions = [
      add(waterBlock.position, scale(inward, 1)),
      add(waterBlock.position, scale(inward, 3)),
    ];
    const windPosition = add(targetPositions[0], scale(perpendicular, 4.8));
    advanceThroughBurstSafely(simulation);
    if (waterDuration === LONG_ELEMENT_BUFF_MS) {
      advanceThroughFollowupBurstSafely(simulation);
    }
    advanceTo(simulation, MECHANIC_START_AT + waterDuration + TELEGRAPH_MS);
    moveActorsFarFromElements(
      simulation,
      simulation.getSnapshot(),
      new Set([windActor.id, ...targetActors.map((actor) => actor.id)]),
    );
    for (const [index, actor] of targetActors.entries()) {
      submitPose(simulation, actor, targetPositions[index]);
    }
    submitPose(simulation, windActor, windPosition, angleTo(windPosition, waterBlock.position));

    advanceTo(simulation, MECHANIC_START_AT + waterDuration + DELAYED_RESOLUTION_MS);

    const shareSnapshot = simulation.getSnapshot();
    const isolatedActorIds = new Set([windActor.id]);
    moveActorsFarFromElements(simulation, shareSnapshot, isolatedActorIds);
    submitPose(
      simulation,
      windActor,
      add(
        windBlock.position,
        scale(normalize({ x: -windBlock.position.x, y: -windBlock.position.y }), 1),
      ),
    );

    advanceTo(simulation, MECHANIC_START_AT + waterDuration + DELAYED_RESOLUTION_MS * 2);

    const resolvedSnapshot = simulation.getSnapshot();
    const windTelegraphs = resolvedSnapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'circleTelegraph' && mechanic.label === '混沌之风分摊范围',
    );
    const resolvedWindActor = resolvedSnapshot.actors.find((actor) => actor.id === windActor.id);

    assert.ok(windTelegraphs.length >= 1);
    assert.ok(windTelegraphs.every((mechanic) => mechanic.color === WIND_TELEGRAPH_COLOR));
    assertActorDied(
      resolvedWindActor,
      MECHANIC_START_AT + waterDuration + DELAYED_RESOLUTION_MS * 2,
    );
    assert.ok(resolvedSnapshot.failureReasons.includes('混沌之风分摊人数不足'));
  });
});

test('凯夫卡P3一运：易伤期间再次受到机制伤害时进入统一死亡状态', () => {
  withMockedRandom(createSeededRandomValues(25, 100), () => {
    const simulation = createKefkaP3Simulation();

    advanceTo(simulation, MECHANIC_START_AT);

    const startSnapshot = simulation.getSnapshot();
    const fireDuration = startSnapshot.scriptState['kefkaP3:elementStatusDurations'].fire;
    const fireActors = startSnapshot.actors.filter((actor) =>
      hasStatus(actor, CHAOS_FIRE_STATUS_ID),
    );
    assert.equal(fireActors.length, 2);

    if (fireDuration === SHORT_ELEMENT_BUFF_MS) {
      advanceTo(simulation, BURST_CAST_START_AT);

      const burstSnapshot = simulation.getSnapshot();
      const firePositions = getSafeClosePairOutsideCircle(getBurstCenter(burstSnapshot));
      moveActorsOutsideBurst(
        simulation,
        burstSnapshot,
        new Set(fireActors.map((actor) => actor.id)),
      );
      submitPose(simulation, fireActors[0], firePositions[0]);
      submitPose(simulation, fireActors[1], firePositions[1]);
    } else {
      advanceThroughBurstSafely(simulation);
      advanceThroughFollowupBurstSafely(simulation);
      submitPose(simulation, fireActors[0], { x: 0, y: 0 });
      submitPose(simulation, fireActors[1], { x: 3, y: 0 });
    }

    advanceTo(simulation, MECHANIC_START_AT + fireDuration + TELEGRAPH_MS);

    const resolvedSnapshot = simulation.getSnapshot();
    const firstFireActor = resolvedSnapshot.actors.find((actor) => actor.id === fireActors[0].id);
    const secondFireActor = resolvedSnapshot.actors.find((actor) => actor.id === fireActors[1].id);

    assertActorDied(firstFireActor, MECHANIC_START_AT + fireDuration + TELEGRAPH_MS);
    assertActorDied(secondFireActor, MECHANIC_START_AT + fireDuration + TELEGRAPH_MS);
  });
});

test('凯夫卡P3一运：冲锋点按随机基准方向和固定旋转方向移动', () => {
  withMockedRandom(createSeededRandomValues(31, 300), () => {
    const simulation = createKefkaP3Simulation();

    advanceToChargeSetup(simulation);
    advanceTo(simulation, CHARGE_MARKER_SPAWN_AT);

    let snapshot = simulation.getSnapshot();
    const chargeState = snapshot.scriptState['kefkaP3:chargeState'];
    assert.ok(chargeState);
    assert.equal(CHARGE_INITIAL_DISTANCE, 16);
    assert.equal(chargeState.outsideCenters.length, CHARGE_MARKER_ROTATION_COUNT + 1);
    assert.deepEqual(
      chargeState.outsideCenters,
      createChargeOutsideCenters(chargeState.baseDirection, chargeState.rotationSign),
    );

    let chargeMarker = snapshot.mechanics.find(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '冲锋点',
    );
    assert.ok(chargeMarker);
    assert.equal(chargeMarker.shape, 'circle');
    assert.equal(chargeMarker.radius, CHARGE_MARKER_RADIUS);
    assert.equal(chargeMarker.color, CHARGE_MARKER_COLOR);
    assert.equal(chargeMarker.resolveAt, CHARGE_MARKER_OUTSIDE_AT);
    assertClosePoint(
      chargeMarker.center,
      createPointOnDirection(chargeState.baseDirection, CHARGE_INITIAL_DISTANCE),
    );

    for (let index = 0; index <= CHARGE_MARKER_ROTATION_COUNT; index += 1) {
      const markerTime = CHARGE_MARKER_OUTSIDE_AT + index * CHARGE_MARKER_ROTATION_INTERVAL_MS;
      advanceTo(simulation, markerTime);
      snapshot = simulation.getSnapshot();
      chargeMarker = snapshot.mechanics.find(
        (mechanic) =>
          mechanic.kind === 'fieldMarker' &&
          mechanic.label === '冲锋点' &&
          mechanic.resolveAt === markerTime + CHARGE_MARKER_ROTATION_INTERVAL_MS,
      );
      assert.ok(chargeMarker);
      assert.equal(distance(chargeMarker.center, { x: 0, y: 0 }), CHARGE_OUTSIDE_DISTANCE);
      assertClosePoint(chargeMarker.center, chargeState.outsideCenters[index]);
    }

    advanceTo(simulation, CHARGE_MARKER_DESPAWN_AT);
    assert.equal(
      simulation
        .getSnapshot()
        .mechanics.some(
          (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '冲锋点',
        ),
      false,
    );
  });
});

test('凯夫卡P3一运：72秒分配1到8顺位并按奇偶显示颜色', () => {
  withMockedRandom(createSeededRandomValues(32, 400), () => {
    const simulation = createKefkaP3Simulation();

    advanceToMahjongAssignments(simulation);

    const snapshot = simulation.getSnapshot();
    const assignments = snapshot.scriptState['kefkaP3:mahjongAssignments'];
    const orderMarkers = snapshot.mechanics
      .filter((mechanic) => mechanic.kind === 'actorMarker' && /^\d$/.test(mechanic.label))
      .sort((left, right) => Number(left.label) - Number(right.label));

    assert.equal(assignments.length, 8);
    assert.equal(new Set(assignments).size, 8);
    assert.equal(orderMarkers.length, 8);

    for (const [index, marker] of orderMarkers.entries()) {
      const order = index + 1;

      assert.equal(marker.label, `${order}`);
      assert.equal(marker.targetId, assignments[index]);
      assert.equal(marker.markerShape, 'circleDot');
      assert.equal(
        marker.color,
        order % 2 === 1 ? MAHJONG_ODD_MARKER_COLOR : MAHJONG_EVEN_MARKER_COLOR,
      );
      assert.equal(marker.resolveAt, MAHJONG_MARKERS_RESOLVE_AT);
    }

    advanceTo(simulation, MAHJONG_MARKERS_RESOLVE_AT);
    assert.equal(
      simulation
        .getSnapshot()
        .mechanics.some(
          (mechanic) => mechanic.kind === 'actorMarker' && /^\d$/.test(mechanic.label),
        ),
      false,
    );
  });
});

test('凯夫卡P3一运：麻将矩形判定距离过近和其它玩家命中', () => {
  withMockedRandom(createSeededRandomValues(33, 400), () => {
    const simulation = createKefkaP3Simulation();

    advanceToMahjongAssignments(simulation);

    const assignedSnapshot = simulation.getSnapshot();
    const chargeState = assignedSnapshot.scriptState['kefkaP3:chargeState'];
    const assignments = assignedSnapshot.scriptState['kefkaP3:mahjongAssignments'];
    const source = chargeState.outsideCenters[0];
    const inward = normalize(scale(source, -1));
    const lateral = { x: -inward.y, y: inward.x };
    const target = assignedSnapshot.actors.find((actor) => actor.id === assignments[0]);
    const otherHit = assignedSnapshot.actors.find((actor) => actor.id === assignments[1]);
    const safeActor = assignedSnapshot.actors.find((actor) => actor.id === assignments[2]);
    assert.ok(target);
    assert.ok(otherHit);
    assert.ok(safeActor);

    submitPose(simulation, target, add(source, scale(inward, MAHJONG_MIN_DISTANCE - 5)));
    submitPose(simulation, otherHit, add(add(source, scale(inward, 30)), scale(lateral, 2)));
    submitPose(simulation, safeActor, add(add(source, scale(inward, 30)), scale(lateral, 8)));

    advanceTo(simulation, MAHJONG_FIRST_RESOLVE_AT);

    const resolvedSnapshot = simulation.getSnapshot();
    const rectangle = resolvedSnapshot.mechanics.find(
      (mechanic) => mechanic.kind === 'rectangleTelegraph' && mechanic.label === '冲锋矩形',
    );
    const resolvedTarget = resolvedSnapshot.actors.find((actor) => actor.id === target.id);
    const resolvedOtherHit = resolvedSnapshot.actors.find((actor) => actor.id === otherHit.id);
    const resolvedSafeActor = resolvedSnapshot.actors.find((actor) => actor.id === safeActor.id);
    assert.ok(rectangle);
    assertClosePoint(rectangle.center, source);
    assert.equal(rectangle.length, MAHJONG_RECTANGLE_LENGTH);
    assert.equal(rectangle.width, MAHJONG_RECTANGLE_WIDTH);
    assert.equal(rectangle.color, CHARGE_MARKER_COLOR);
    assert.equal(rectangle.resolveAt, MAHJONG_FIRST_RESOLVE_AT + MAHJONG_RECTANGLE_VISUAL_MS);
    assert.ok(
      isActorInsideRectangle(
        otherHit,
        source,
        rectangle.direction,
        MAHJONG_RECTANGLE_LENGTH,
        MAHJONG_RECTANGLE_WIDTH,
      ),
    );
    assertActorDied(resolvedTarget, MAHJONG_FIRST_RESOLVE_AT);
    assertActorDied(resolvedOtherHit, MAHJONG_FIRST_RESOLVE_AT);
    assertActorNotDead(resolvedSafeActor);
    assert.ok(resolvedSnapshot.failureReasons.some((reason) => reason.includes('麻将距离过近')));
    assert.ok(
      resolvedSnapshot.failureReasons.some((reason) => reason.includes('麻将被其它人的矩形命中')),
    );
  });
});

test('凯夫卡P3一运：顺位本人距离足够时不会被自己的矩形命中杀死，85.75秒使用第8个起点', () => {
  withMockedRandom(createSeededRandomValues(34, 400), () => {
    const simulation = createKefkaP3Simulation();

    advanceToMahjongAssignments(simulation);

    let snapshot = simulation.getSnapshot();
    const chargeState = snapshot.scriptState['kefkaP3:chargeState'];
    const assignments = snapshot.scriptState['kefkaP3:mahjongAssignments'];
    const source = chargeState.outsideCenters[0];
    const inward = normalize(scale(source, -1));
    const target = snapshot.actors.find((actor) => actor.id === assignments[0]);
    assert.ok(target);

    submitPose(simulation, target, add(source, scale(inward, MAHJONG_MIN_DISTANCE + 3)));
    advanceTo(simulation, MAHJONG_FIRST_RESOLVE_AT);

    snapshot = simulation.getSnapshot();
    const resolvedTarget = snapshot.actors.find((actor) => actor.id === target.id);
    assertActorNotDead(resolvedTarget);

    const lastTarget = snapshot.actors.find((actor) => actor.id === assignments[7]);
    assert.ok(lastTarget);
    submitPose(
      simulation,
      lastTarget,
      add(
        chargeState.outsideCenters[7],
        scale(normalize(scale(chargeState.outsideCenters[7], -1)), 43),
      ),
    );
    advanceTo(simulation, MAHJONG_LAST_RESOLVE_AT);

    const lastSnapshot = simulation.getSnapshot();
    const lastRectangle = lastSnapshot.mechanics
      .filter((mechanic) => mechanic.kind === 'rectangleTelegraph' && mechanic.label === '冲锋矩形')
      .find(
        (mechanic) => mechanic.resolveAt === MAHJONG_LAST_RESOLVE_AT + MAHJONG_RECTANGLE_VISUAL_MS,
      );
    assert.ok(lastRectangle);
    assertClosePoint(lastRectangle.center, chargeState.outsideCenters[7]);
    assert.equal(lastRectangle.length, MAHJONG_RECTANGLE_LENGTH);
    assert.equal(lastRectangle.width, MAHJONG_RECTANGLE_WIDTH);
  });
});

test('凯夫卡P3一运：麻将最后一次85.75秒判定并在86.75秒完成', () => {
  withMockedRandom(createSeededRandomValues(26, 100), () => {
    const simulation = createKefkaP3Simulation();

    assert.equal(MAHJONG_RECTANGLE_INTERVAL_MS, 250);
    assert.equal(MAHJONG_LAST_RESOLVE_AT, 85_750);
    assert.equal(COMPLETE_AT, 86_750);
    assert.equal(
      MAHJONG_LAST_RESOLVE_AT - MAHJONG_FIRST_RESOLVE_AT,
      7 * MAHJONG_RECTANGLE_INTERVAL_MS,
    );

    advanceTo(simulation, 55_500);
    assert.equal(simulation.getSnapshot().latestResult, null);

    advanceTo(simulation, MAHJONG_LAST_RESOLVE_AT);
    assert.equal(simulation.getSnapshot().latestResult, null);

    advanceTo(simulation, COMPLETE_AT - 50);
    assert.equal(simulation.getSnapshot().latestResult, null);

    advanceTo(simulation, COMPLETE_AT);
    assert.ok(simulation.getSnapshot().latestResult);
  });
});
