import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '@ff14arena/core';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { getBattleDefinition } from '../src/index.ts';
import { KEFKA_P4_FIRST_TRICK_TESTING } from '../src/battles/kefka-p4-first-trick.ts';

const {
  CHAOS_ELEMENT_DELAY_MS,
  ACCELERATION_SAMPLE_BEFORE_MS,
  TIMELINE,
  TIMELINE_RESOLVE,
  TELEGRAPH_MS,
  FORKED_LIGHTNING_STATUS_ID,
  COMPRESSED_WATER_STATUS_ID,
  ALLAGAN_FIELD_STATUS_ID,
  BEYOND_DEATH_STATUS_ID,
  LIVING_WOUND_STATUS_ID,
  DEAD_WOUND_STATUS_ID,
  CHAOS_FIRE_STATUS_ID,
  CHAOS_WATER_STATUS_ID,
  THUNDER_NEAR_OFFSET,
  THUNDER_FAR_OFFSET,
  createMagicPattern,
  isActorInsideRectangle,
  isActorInsideFan,
} = KEFKA_P4_FIRST_TRICK_TESTING;

const SUPPORT_SLOTS = ['MT', 'ST', 'H1', 'H2'];
const DPS_SLOTS = ['D1', 'D2', 'D3', 'D4'];
const SIMULATION_TICK_MS = 50;
const BIG_CROSS_STATUS_IDS = [
  KEFKA_P4_FIRST_TRICK_TESTING.CURSE_HOWL_STATUS_ID,
  KEFKA_P4_FIRST_TRICK_TESTING.FORKED_LIGHTNING_STATUS_ID,
  KEFKA_P4_FIRST_TRICK_TESTING.COMPRESSED_WATER_STATUS_ID,
  KEFKA_P4_FIRST_TRICK_TESTING.ACCELERATION_BOMB_STATUS_ID,
];
const BIG_CROSS_PLAN_CATEGORIES = {
  curse_accel: 'A',
  accel: 'A',
  lightning: 'B',
  water: 'B',
};

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

function createKefkaP4Simulation(randomSeed = 1) {
  const battle = getBattleDefinition('kefka_p4_first_trick');
  assert.ok(battle);

  return withMockedRandom(createSeededRandomValues(randomSeed, 2000), () => {
    const simulation = createSimulation();
    simulation.loadBattle({
      battle,
      roomId: 'kefka-p4-first-trick-test-room',
      party: PARTY_SLOT_ORDER.map((slot) => ({
        slot,
        name: slot,
        kind: 'player',
        actorId: `player_${slot}`,
      })),
    });
    simulation.start();

    return simulation;
  });
}

function createKefkaP4SimulationDirect() {
  const battle = getBattleDefinition('kefka_p4_first_trick');
  assert.ok(battle);

  const simulation = createSimulation();
  simulation.loadBattle({
    battle,
    roomId: 'kefka-p4-first-trick-test-room',
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

function tickTime(timeMs) {
  return Math.ceil(timeMs / SIMULATION_TICK_MS) * SIMULATION_TICK_MS;
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

function getActorBySlot(snapshot, slot) {
  const actor = snapshot.actors.find((candidate) => candidate.slot === slot);
  assert.ok(actor, `missing actor for slot ${slot}`);

  return actor;
}

function getStatus(actor, statusId) {
  return actor.statuses.find((status) => status.id === statusId) ?? null;
}

function getBigCrossStatuses(actor) {
  return actor.statuses.filter((status) => BIG_CROSS_STATUS_IDS.includes(status.id));
}

function getAccelerationBomb(actor) {
  return getStatus(actor, KEFKA_P4_FIRST_TRICK_TESTING.ACCELERATION_BOMB_STATUS_ID);
}

function createSimulationWithAccelerationBomb(fake) {
  for (let seed = 1; seed <= 100; seed += 1) {
    const simulation = createKefkaP4Simulation(seed);

    advanceTo(simulation, tickTime(TIMELINE_RESOLVE.bigCross1ResolveAt));
    const snapshot = simulation.getSnapshot();
    const actor = snapshot.actors.find((candidate) => {
      const status = getAccelerationBomb(candidate);

      return status !== null && status.name.includes('（假）') === fake;
    });

    if (actor !== undefined) {
      const status = getAccelerationBomb(actor);
      assert.ok(status);

      return { simulation, actor, status };
    }
  }

  assert.fail(`missing ${fake ? 'fake' : 'real'} acceleration bomb simulation`);
}

function getBigCrossPlanCategory(planId) {
  return BIG_CROSS_PLAN_CATEGORIES[planId];
}

function assertBigCrossPlanCategoriesAlternate(firstPlans, secondPlans) {
  for (const slot of PARTY_SLOT_ORDER) {
    assert.notEqual(
      getBigCrossPlanCategory(secondPlans[slot]),
      getBigCrossPlanCategory(firstPlans[slot]),
    );
  }
}

function assertNoPlayerGetsBothElementalPlans(firstPlans, secondPlans) {
  for (const slot of PARTY_SLOT_ORDER) {
    assert.ok(
      !(
        (firstPlans[slot] === 'lightning' && secondPlans[slot] === 'water') ||
        (firstPlans[slot] === 'water' && secondPlans[slot] === 'lightning')
      ),
    );
  }
}

function getStatusExpiresAtBySlot(snapshot, slot, statusId) {
  return getStatus(getActorBySlot(snapshot, slot), statusId)?.expiresAt ?? null;
}

function getMechanics(snapshot, kind, label = null) {
  return snapshot.mechanics.filter(
    (mechanic) => mechanic.kind === kind && (label === null || mechanic.label === label),
  );
}

function getFieldMarkerByStableId(snapshot, stableId) {
  const marker = snapshot.mechanics.find(
    (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.stableId === stableId,
  );
  assert.ok(marker, `missing field marker ${stableId}`);

  return marker;
}

function getThunderOffset(rect) {
  const forward = {
    x: Math.cos(rect.direction),
    y: Math.sin(rect.direction),
  };
  const normal = {
    x: -Math.sin(rect.direction),
    y: Math.cos(rect.direction),
  };
  const lineCenter = {
    x: rect.center.x + forward.x * (rect.length / 2),
    y: rect.center.y + forward.y * (rect.length / 2),
  };

  return lineCenter.x * normal.x + lineCenter.y * normal.y;
}

function createVoidFloodSidePosition(exdeathPosition, side) {
  const facing = Math.atan2(-exdeathPosition.y, -exdeathPosition.x);
  const right = { x: Math.cos(facing + Math.PI / 2), y: Math.sin(facing + Math.PI / 2) };
  const sideMultiplier = side === 'right' ? 1 : -1;

  return {
    x: right.x * sideMultiplier * 5,
    y: right.y * sideMultiplier * 5,
  };
}

function createProbeActor(position) {
  return {
    mechanicActive: true,
    position,
    facing: 0,
  };
}

function isPointInsideAnyRectangle(position, rectangles) {
  const actor = createProbeActor(position);

  return rectangles.some((rectangle) => isActorInsideRectangle(actor, rectangle));
}

function isPointInsideAnyFan(position, fans) {
  const actor = createProbeActor(position);

  return fans.some((fan) => isActorInsideFan(actor, fan));
}

function getMagicThunderResolveForTest(pattern, inverted = false) {
  return (pattern.thunderTruth === 'fake') !== inverted
    ? pattern.thunderOpposite
    : pattern.thunderPreview;
}

function getMagicIceResolveForTest(pattern, inverted = false) {
  return (pattern.iceTruth === 'fake') !== inverted ? pattern.iceOpposite : pattern.icePreview;
}

function findIsolatedMagicPoint(matches, excludes) {
  for (let x = -18; x <= 18; x += 0.5) {
    for (let y = -18; y <= 18; y += 0.5) {
      const position = { x, y };

      if (Math.hypot(x, y) > 19) {
        continue;
      }

      if (matches(position) && excludes.every((exclude) => !exclude(position))) {
        return position;
      }
    }
  }

  assert.fail('missing isolated magic test point');
}

test('凯夫卡P4一运注册并使用 6m Boss 目标圈', () => {
  const battle = getBattleDefinition('kefka_p4_first_trick');

  assert.ok(battle);
  assert.equal(battle.name, '凯夫卡P4：一运');
  assert.equal(battle.bossTargetRingRadius, 6);
});

test('玄乎乎魔法假雷使用 5m/15m 互补直线', () => {
  withMockedRandom([0.25, 0.25, 0.25, 0.25, 0.75, 0.1, 0.2], () => {
    const pattern = createMagicPattern();
    const previewOffsets = pattern.thunderPreview.map(getThunderOffset).sort((a, b) => a - b);
    const resolveOffsets = pattern.thunderResolve.map(getThunderOffset).sort((a, b) => a - b);

    assert.deepEqual(
      previewOffsets.map((offset) => Math.round(offset)),
      [-THUNDER_FAR_OFFSET, THUNDER_NEAR_OFFSET],
    );
    assert.deepEqual(
      resolveOffsets.map((offset) => Math.round(offset)),
      [-THUNDER_NEAR_OFFSET, THUNDER_FAR_OFFSET],
    );
  });
});

test('开场同时显示玄乎乎魔法和真假环机制', () => {
  const simulation = createKefkaP4Simulation(2);

  advanceTo(simulation, tickTime(TIMELINE.bigCross1StartAt));
  const snapshot = simulation.getSnapshot();

  assert.ok(snapshot.mechanics.some((mechanic) => mechanic.kind === 'ringIndicator'));
  assert.ok(snapshot.mechanics.some((mechanic) => mechanic.kind === 'fanTelegraph'));
  assert.ok(snapshot.mechanics.some((mechanic) => mechanic.kind === 'rectangleTelegraph'));
  assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '玄乎乎魔法'));
  assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '大十字'));
});

test('开场卡奥斯固定左上且艾克斯迪斯固定右上', () => {
  withMockedRandom(new Array(5000).fill(0.9), () => {
    const simulation = createKefkaP4SimulationDirect();

    advanceTo(simulation, 50);
    const snapshot = simulation.getSnapshot();
    const chaos = getFieldMarkerByStableId(snapshot, 'kefka_p4_chaos');
    const exdeath = getFieldMarkerByStableId(snapshot, 'kefka_p4_exdeath');

    assert.equal(chaos.label, '卡奥斯');
    assert.equal(exdeath.label, '艾克斯迪斯');
    assert.ok(chaos.center.x < 0);
    assert.ok(chaos.center.y < 0);
    assert.ok(exdeath.center.x > 0);
    assert.ok(exdeath.center.y < 0);
    assert.equal(Math.round(Math.hypot(chaos.center.x, chaos.center.y)), 25);
    assert.equal(Math.round(Math.hypot(exdeath.center.x, exdeath.center.y)), 25);
  });
});

test('两轮大十字按 A/B 组交替分配', () => {
  const simulation = createKefkaP4Simulation(3);

  advanceTo(simulation, tickTime(TIMELINE_RESOLVE.bigCross1ResolveAt));
  advanceTo(simulation, tickTime(TIMELINE_RESOLVE.bigCross2ResolveAt));
  const snapshot = simulation.getSnapshot();
  const firstPlans = snapshot.scriptState['kefkaP4:bigCrossPlans:1'];
  const secondPlans = snapshot.scriptState['kefkaP4:bigCrossPlans:2'];

  assert.ok(firstPlans);
  assert.ok(secondPlans);

  assertBigCrossPlanCategoriesAlternate(firstPlans, secondPlans);
  assertNoPlayerGetsBothElementalPlans(firstPlans, secondPlans);

  for (const slots of [SUPPORT_SLOTS, DPS_SLOTS]) {
    assert.equal(new Set(slots.map((slot) => firstPlans[slot])).size, 4);
    assert.equal(new Set(slots.map((slot) => secondPlans[slot])).size, 4);
    assert.deepEqual(slots.map((slot) => getBigCrossPlanCategory(firstPlans[slot])).sort(), [
      'A',
      'A',
      'B',
      'B',
    ]);
    assert.deepEqual(slots.map((slot) => getBigCrossPlanCategory(secondPlans[slot])).sort(), [
      'A',
      'A',
      'B',
      'B',
    ]);
  }

  for (const actor of snapshot.actors) {
    const statuses = getBigCrossStatuses(actor);
    const statusIds = statuses.map((status) => status.id);

    assert.equal(new Set(statusIds).size, statusIds.length);
  }
});

test('大十字合法分配不依赖随机重试兜底', () => {
  withMockedRandom(new Array(5000).fill(0), () => {
    const simulation = createKefkaP4SimulationDirect();

    advanceTo(simulation, tickTime(TIMELINE_RESOLVE.bigCross1ResolveAt));
    advanceTo(simulation, tickTime(TIMELINE_RESOLVE.bigCross2ResolveAt));
    const snapshot = simulation.getSnapshot();
    const firstPlans = snapshot.scriptState['kefkaP4:bigCrossPlans:1'];
    const secondPlans = snapshot.scriptState['kefkaP4:bigCrossPlans:2'];

    assert.ok(firstPlans);
    assert.ok(secondPlans);

    assertBigCrossPlanCategoriesAlternate(firstPlans, secondPlans);
    assertNoPlayerGetsBothElementalPlans(firstPlans, secondPlans);

    for (const actor of snapshot.actors) {
      const statuses = getBigCrossStatuses(actor);
      const statusIds = statuses.map((status) => status.id);
      const accelerationBombCount = statusIds.filter(
        (statusId) => statusId === KEFKA_P4_FIRST_TRICK_TESTING.ACCELERATION_BOMB_STATUS_ID,
      ).length;

      assert.equal(new Set(statusIds).size, statusIds.length);
      assert.ok(accelerationBombCount <= 1);
    }
  });
});

test('加速度炸弹在判定前0.5秒采样移动状态', () => {
  {
    const { simulation, actor: initialActor, status } = createSimulationWithAccelerationBomb(false);
    let actor = initialActor;
    advanceTo(simulation, status.expiresAt - ACCELERATION_SAMPLE_BEFORE_MS - 50);
    let snapshot = simulation.getSnapshot();
    actor = getActorBySlot(snapshot, actor.slot);
    submitPose(simulation, actor, actor.position, actor.facing, true);
    advanceTo(simulation, status.expiresAt - ACCELERATION_SAMPLE_BEFORE_MS);
    snapshot = simulation.getSnapshot();
    actor = getActorBySlot(snapshot, actor.slot);
    assert.equal(
      snapshot.scriptState[`kefkaP4:accelerationMoving:${actor.id}:${status.expiresAt}`],
      true,
    );
    submitPose(simulation, actor, actor.position, actor.facing, false);
    advanceTo(simulation, status.expiresAt);

    assert.equal(getAccelerationBomb(getActorBySlot(simulation.getSnapshot(), actor.slot)), null);
  }

  {
    const { simulation, actor: initialActor, status } = createSimulationWithAccelerationBomb(true);
    let actor = initialActor;
    advanceTo(simulation, status.expiresAt - ACCELERATION_SAMPLE_BEFORE_MS - 50);
    let snapshot = simulation.getSnapshot();
    actor = getActorBySlot(snapshot, actor.slot);
    submitPose(simulation, actor, actor.position, actor.facing, false);
    advanceTo(simulation, status.expiresAt - ACCELERATION_SAMPLE_BEFORE_MS);
    snapshot = simulation.getSnapshot();
    actor = getActorBySlot(snapshot, actor.slot);
    assert.equal(
      snapshot.scriptState[`kefkaP4:accelerationMoving:${actor.id}:${status.expiresAt}`],
      false,
    );
    submitPose(simulation, actor, actor.position, actor.facing, true);
    advanceTo(simulation, status.expiresAt);

    assert.equal(getAccelerationBomb(getActorBySlot(simulation.getSnapshot(), actor.slot)), null);
  }
});

test('海啸先出时混沌之水和混沌之炎仍按固定时间到期', () => {
  withMockedRandom(new Array(5000).fill(0.1), () => {
    const simulation = createKefkaP4SimulationDirect();

    advanceTo(simulation, tickTime(TIMELINE.chaos1StartAt));
    let snapshot = simulation.getSnapshot();
    assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '海啸'));

    advanceTo(simulation, tickTime(TIMELINE_RESOLVE.chaos1ResolveAt));
    snapshot = simulation.getSnapshot();

    for (const actor of snapshot.actors) {
      assert.equal(
        getStatus(actor, CHAOS_WATER_STATUS_ID)?.expiresAt,
        tickTime(TIMELINE_RESOLVE.chaos1ResolveAt) + 84_000,
      );
      assert.equal(getStatus(actor, CHAOS_FIRE_STATUS_ID), null);
    }

    advanceTo(simulation, tickTime(TIMELINE.chaos2StartAt));
    snapshot = simulation.getSnapshot();
    assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '烈焰'));

    advanceTo(simulation, tickTime(TIMELINE_RESOLVE.chaos2ResolveAt));
    snapshot = simulation.getSnapshot();

    for (const actor of snapshot.actors) {
      assert.equal(
        getStatus(actor, CHAOS_FIRE_STATUS_ID)?.expiresAt,
        tickTime(TIMELINE_RESOLVE.chaos2ResolveAt) + 45_000,
      );
    }
  });
});

test('烈焰先出时混沌之炎和混沌之水仍按固定时间到期', () => {
  withMockedRandom(new Array(5000).fill(0.9), () => {
    const simulation = createKefkaP4SimulationDirect();

    advanceTo(simulation, tickTime(TIMELINE.chaos1StartAt));
    let snapshot = simulation.getSnapshot();
    assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '烈焰'));

    advanceTo(simulation, tickTime(TIMELINE_RESOLVE.chaos1ResolveAt));
    snapshot = simulation.getSnapshot();

    for (const actor of snapshot.actors) {
      assert.equal(
        getStatus(actor, CHAOS_FIRE_STATUS_ID)?.expiresAt,
        tickTime(TIMELINE_RESOLVE.chaos1ResolveAt) + 60_000,
      );
      assert.equal(getStatus(actor, CHAOS_WATER_STATUS_ID), null);
    }

    advanceTo(simulation, tickTime(TIMELINE.chaos2StartAt));
    snapshot = simulation.getSnapshot();
    assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '海啸'));

    advanceTo(simulation, tickTime(TIMELINE_RESOLVE.chaos2ResolveAt));
    snapshot = simulation.getSnapshot();

    for (const actor of snapshot.actors) {
      assert.equal(
        getStatus(actor, CHAOS_WATER_STATUS_ID)?.expiresAt,
        tickTime(TIMELINE_RESOLVE.chaos2ResolveAt) + 69_000,
      );
    }
  });
});

test('混沌之炎到期后延迟5秒并在到期时原地显示预兆', () => {
  withMockedRandom(new Array(5000).fill(0.9), () => {
    const simulation = createKefkaP4SimulationDirect();

    const fireExpiresAt = tickTime(TIMELINE_RESOLVE.chaos1ResolveAt) + 60_000;

    advanceTo(simulation, fireExpiresAt);
    const lockedPosition = { ...getActorBySlot(simulation.getSnapshot(), 'MT').position };
    submitPose(simulation, getActorBySlot(simulation.getSnapshot(), 'MT'), { x: 12, y: 12 });
    advanceTo(simulation, fireExpiresAt + CHAOS_ELEMENT_DELAY_MS - 500);
    const snapshot = simulation.getSnapshot();
    const fireTelegraphs = snapshot.mechanics.filter((mechanic) => mechanic.label === '混沌之炎');

    assert.ok(
      fireTelegraphs.some(
        (mechanic) =>
          Math.hypot(mechanic.center.x - lockedPosition.x, mechanic.center.y - lockedPosition.y) <
          0.001,
      ),
    );
  });
});

test('大十字雷水 Buff 时长组在两轮之间保持对应关系', () => {
  withMockedRandom(new Array(5000).fill(0.1), () => {
    const simulation = createKefkaP4SimulationDirect();

    advanceTo(simulation, tickTime(TIMELINE_RESOLVE.bigCross1ResolveAt));
    let snapshot = simulation.getSnapshot();
    const firstPlans = snapshot.scriptState['kefkaP4:bigCrossPlans:1'];
    assert.ok(firstPlans);
    const firstElementalExpiresAts = [];

    for (const slots of [SUPPORT_SLOTS, DPS_SLOTS]) {
      const lightningSlot = slots.find((slot) => firstPlans[slot] === 'lightning');
      const waterSlot = slots.find((slot) => firstPlans[slot] === 'water');
      assert.ok(lightningSlot);
      assert.ok(waterSlot);
      firstElementalExpiresAts.push(
        getStatusExpiresAtBySlot(snapshot, lightningSlot, FORKED_LIGHTNING_STATUS_ID),
        getStatusExpiresAtBySlot(snapshot, waterSlot, COMPRESSED_WATER_STATUS_ID),
      );
    }
    assert.deepEqual(
      firstElementalExpiresAts,
      new Array(4).fill(tickTime(TIMELINE_RESOLVE.bigCross1ResolveAt) + 51_000),
    );

    advanceTo(simulation, tickTime(TIMELINE_RESOLVE.bigCross2ResolveAt));
    snapshot = simulation.getSnapshot();
    const secondPlans = snapshot.scriptState['kefkaP4:bigCrossPlans:2'];
    assert.ok(secondPlans);
    assertBigCrossPlanCategoriesAlternate(firstPlans, secondPlans);
    assertNoPlayerGetsBothElementalPlans(firstPlans, secondPlans);
    const secondElementalExpiresAts = [];

    for (const slots of [SUPPORT_SLOTS, DPS_SLOTS]) {
      const lightningSlot = slots.find((slot) => secondPlans[slot] === 'lightning');
      const waterSlot = slots.find((slot) => secondPlans[slot] === 'water');
      assert.ok(lightningSlot);
      assert.ok(waterSlot);
      secondElementalExpiresAts.push(
        getStatusExpiresAtBySlot(snapshot, lightningSlot, FORKED_LIGHTNING_STATUS_ID),
        getStatusExpiresAtBySlot(snapshot, waterSlot, COMPRESSED_WATER_STATUS_ID),
      );
    }
    assert.deepEqual(
      secondElementalExpiresAts,
      new Array(4).fill(tickTime(TIMELINE_RESOLVE.bigCross2ResolveAt) + 61_000),
    );
  });
});

test('水属性压缩假 Buff 使用叉形闪电的 8m 圆形效果', () => {
  withMockedRandom(new Array(5000).fill(0.9), () => {
    const simulation = createKefkaP4SimulationDirect();

    advanceTo(simulation, tickTime(TIMELINE_RESOLVE.bigCross2ResolveAt));
    let snapshot = simulation.getSnapshot();
    assert.ok(
      snapshot.actors.some((actor) =>
        actor.statuses.some(
          (status) => status.id === COMPRESSED_WATER_STATUS_ID && status.name.includes('（假）'),
        ),
      ),
    );

    advanceTo(simulation, tickTime(TIMELINE_RESOLVE.bigCross2ResolveAt) + 36_000);
    snapshot = simulation.getSnapshot();
    const waterCircleTelegraphs = getMechanics(snapshot, 'circleTelegraph', '水属性压缩');

    assert.ok(waterCircleTelegraphs.length > 0);
    assert.ok(waterCircleTelegraphs.every((mechanic) => mechanic.radius === 8));
    assert.equal(getMechanics(snapshot, 'donutTelegraph', '水属性压缩').length, 0);
  });
});

test('最终大十字赋予 15s 生死伤，并在每组分配 2 个领域和 2 个超越死亡', () => {
  const simulation = createKefkaP4Simulation(5);

  advanceTo(simulation, tickTime(TIMELINE_RESOLVE.finalBigCrossResolveAt));
  const snapshot = simulation.getSnapshot();

  for (const actor of snapshot.actors) {
    const wound =
      getStatus(actor, LIVING_WOUND_STATUS_ID) ?? getStatus(actor, DEAD_WOUND_STATUS_ID);
    assert.ok(wound, `missing wound for ${actor.slot}`);
    assert.equal(wound.expiresAt, tickTime(TIMELINE_RESOLVE.finalBigCrossResolveAt) + 15_000);
  }

  for (const slots of [SUPPORT_SLOTS, DPS_SLOTS]) {
    const actors = slots.map((slot) => getActorBySlot(snapshot, slot));
    const allaganStatuses = actors
      .map((actor) => getStatus(actor, ALLAGAN_FIELD_STATUS_ID))
      .filter((status) => status !== null);
    const beyondDeathStatuses = actors
      .map((actor) => getStatus(actor, BEYOND_DEATH_STATUS_ID))
      .filter((status) => status !== null);

    assert.equal(allaganStatuses.length, 2);
    assert.equal(beyondDeathStatuses.length, 2);
    assert.deepEqual(
      allaganStatuses.map((status) => status.expiresAt),
      new Array(2).fill(tickTime(TIMELINE_RESOLVE.finalBigCrossResolveAt) + 16_000),
    );
    assert.deepEqual(
      beyondDeathStatuses.map((status) => status.expiresAt),
      new Array(2).fill(tickTime(TIMELINE_RESOLVE.finalBigCrossResolveAt) + 15_000),
    );
  }
});

test('生死伤吃到错误暗黑光时会立即消失', () => {
  const simulation = createKefkaP4Simulation(6);

  advanceTo(simulation, tickTime(TIMELINE.voidFloodStartAt));
  let snapshot = simulation.getSnapshot();
  const actor = getActorBySlot(snapshot, 'MT');
  const wound = getStatus(actor, LIVING_WOUND_STATUS_ID) ?? getStatus(actor, DEAD_WOUND_STATUS_ID);
  const voidFlood = snapshot.scriptState['kefkaP4:voidFlood'];
  const exdeathPosition = snapshot.scriptState['kefkaP4:exdeathPosition'];

  assert.ok(wound);
  assert.ok(voidFlood);
  assert.ok(exdeathPosition);

  const woundFake = wound.name.includes('（假）');
  const wrongDarkKind =
    wound.id === LIVING_WOUND_STATUS_ID
      ? woundFake
        ? 'dead'
        : 'living'
      : woundFake
        ? 'living'
        : 'dead';
  const voidFloodFake = voidFlood.truth === 'fake';
  const purpleDarkKind = voidFloodFake ? 'dead' : 'living';
  const wrongSide = purpleDarkKind === wrongDarkKind ? voidFlood.purpleSide : voidFlood.blueSide;

  submitPose(simulation, actor, createVoidFloodSidePosition(exdeathPosition, wrongSide));
  advanceTo(simulation, tickTime(TIMELINE_RESOLVE.darkLightResolveAt));
  snapshot = simulation.getSnapshot();

  const resolvedActor = getActorBySlot(snapshot, 'MT');
  assert.equal(getStatus(resolvedActor, wound.id), null);
});

test('后续机制按时间轴显示雷冰变体、究极读条和隐藏玄乎乎魔法', () => {
  const simulation = createKefkaP4Simulation(7);

  advanceTo(simulation, tickTime(TIMELINE.manaStoreStartAt));
  let snapshot = simulation.getSnapshot();
  assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '魔法储存'));

  advanceTo(simulation, tickTime(TIMELINE_RESOLVE.manaStoreResolveAt) + 50);
  snapshot = simulation.getSnapshot();
  assert.ok(!snapshot.hud.bossCastBars.some((cast) => cast.actionName === '魔法储存'));

  advanceTo(simulation, tickTime(TIMELINE.thunderStartAt));
  snapshot = simulation.getSnapshot();
  assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '劈啪啪暴雷'));
  assert.ok(getMechanics(snapshot, 'rectangleTelegraph', '玄乎乎魔法：雷').length > 0);
  assert.equal(getMechanics(snapshot, 'fanTelegraph', '玄乎乎魔法：冰').length, 0);

  advanceTo(simulation, tickTime(TIMELINE.flappingUltimateStartAt));
  snapshot = simulation.getSnapshot();
  assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '扑腾腾究极'));

  advanceTo(simulation, tickTime(TIMELINE_RESOLVE.flappingUltimateResolveAt - TELEGRAPH_MS));
  snapshot = simulation.getSnapshot();
  assert.equal(getMechanics(snapshot, 'circleTelegraph', '扑腾腾究极').length, 0);

  advanceTo(simulation, tickTime(TIMELINE.iceStartAt));
  snapshot = simulation.getSnapshot();
  assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '扩大大冰封'));
  assert.ok(getMechanics(snapshot, 'fanTelegraph', '玄乎乎魔法：冰').length > 0);
  assert.equal(getMechanics(snapshot, 'rectangleTelegraph', '玄乎乎魔法：雷').length, 0);

  advanceTo(simulation, tickTime(TIMELINE.manaReleaseStartAt));
  snapshot = simulation.getSnapshot();
  assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '魔法放出'));
  assert.ok(getMechanics(snapshot, 'ringIndicator', '玄乎乎魔法真假').length > 0);
  assert.equal(getMechanics(snapshot, 'fanTelegraph', '玄乎乎魔法：冰').length, 0);
  assert.equal(getMechanics(snapshot, 'rectangleTelegraph', '玄乎乎魔法：雷').length, 0);

  advanceTo(simulation, tickTime(TIMELINE_RESOLVE.manaReleaseResolveAt) + 50);
  snapshot = simulation.getSnapshot();
  assert.ok(!snapshot.hud.bossCastBars.some((cast) => cast.actionName === '魔法放出'));
  assert.ok(!snapshot.hud.bossCastBars.some((cast) => cast.actionName === '玄乎乎魔法'));
  assert.equal(getMechanics(snapshot, 'ringIndicator', '玄乎乎魔法真假').length, 0);
  assert.equal(getMechanics(snapshot, 'fanTelegraph', '玄乎乎魔法：冰').length, 0);
  assert.equal(getMechanics(snapshot, 'rectangleTelegraph', '玄乎乎魔法：雷').length, 0);

  advanceTo(simulation, tickTime(TIMELINE.finalMagicStartAt));
  snapshot = simulation.getSnapshot();
  assert.ok(!snapshot.hud.bossCastBars.some((cast) => cast.actionName === '玄乎乎魔法'));
  assert.ok(getMechanics(snapshot, 'fanTelegraph', '玄乎乎魔法：冰').length > 0);
  assert.ok(getMechanics(snapshot, 'rectangleTelegraph', '玄乎乎魔法：雷').length > 0);
});

test('最终玄乎乎魔法按前置雷冰真假额外反转判定', () => {
  withMockedRandom(new Array(5000).fill(0.6), () => {
    const simulation = createKefkaP4SimulationDirect();

    advanceTo(simulation, tickTime(TIMELINE.finalMagicStartAt));
    let snapshot = simulation.getSnapshot();
    const thunderPattern = snapshot.scriptState['kefkaP4:magic:4'];
    const icePattern = snapshot.scriptState['kefkaP4:magic:5'];
    const finalPattern = snapshot.scriptState['kefkaP4:magic:6'];

    assert.equal(thunderPattern.thunderTruth, 'fake');
    assert.equal(icePattern.iceTruth, 'fake');
    assert.equal(finalPattern.thunderTruth, 'fake');
    assert.equal(finalPattern.iceTruth, 'fake');

    const finalThunder = getMagicThunderResolveForTest(finalPattern, true);
    const finalThunderWithoutExtraInvert = getMagicThunderResolveForTest(finalPattern, false);
    const finalIce = getMagicIceResolveForTest(finalPattern, true);
    const finalIceWithoutExtraInvert = getMagicIceResolveForTest(finalPattern, false);

    const thunderPoint = findIsolatedMagicPoint(
      (position) => isPointInsideAnyRectangle(position, finalThunder),
      [
        (position) => isPointInsideAnyRectangle(position, finalThunderWithoutExtraInvert),
        (position) => isPointInsideAnyFan(position, finalIce),
      ],
    );
    const icePoint = findIsolatedMagicPoint(
      (position) => isPointInsideAnyFan(position, finalIce),
      [
        (position) => isPointInsideAnyFan(position, finalIceWithoutExtraInvert),
        (position) => isPointInsideAnyRectangle(position, finalThunder),
      ],
    );

    submitPose(simulation, getActorBySlot(snapshot, 'MT'), thunderPoint);
    submitPose(simulation, getActorBySlot(snapshot, 'ST'), icePoint);

    advanceTo(simulation, tickTime(TIMELINE_RESOLVE.finalMagicResolveAt));
    snapshot = simulation.getSnapshot();

    assert.equal(getActorBySlot(snapshot, 'MT').lastDamageSource, '玄乎乎魔法：雷');
    assert.equal(getActorBySlot(snapshot, 'ST').lastDamageSource, '玄乎乎魔法：冰');
  });
});
