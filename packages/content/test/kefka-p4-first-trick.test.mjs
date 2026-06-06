import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '@ff14arena/core';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { getBattleDefinition } from '../src/index.ts';
import { KEFKA_P4_FIRST_TRICK_TESTING } from '../src/battles/kefka-p4-first-trick.ts';

const {
  MAGIC_CAST_MS,
  MANA_STORE_CAST_MS,
  BIG_CROSS_CAST_MS,
  CHAOS_CAST_MS,
  CHAOS_ELEMENT_DELAY_MS,
  MANA_RELEASE_CAST_MS,
  FLAPPING_ULTIMATE_RADIUS,
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
} = KEFKA_P4_FIRST_TRICK_TESTING;

const SUPPORT_SLOTS = ['MT', 'ST', 'H1', 'H2'];
const DPS_SLOTS = ['D1', 'D2', 'D3', 'D4'];
const BIG_CROSS_STATUS_IDS = [
  KEFKA_P4_FIRST_TRICK_TESTING.CURSE_HOWL_STATUS_ID,
  KEFKA_P4_FIRST_TRICK_TESTING.FORKED_LIGHTNING_STATUS_ID,
  KEFKA_P4_FIRST_TRICK_TESTING.COMPRESSED_WATER_STATUS_ID,
  KEFKA_P4_FIRST_TRICK_TESTING.ACCELERATION_BOMB_STATUS_ID,
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

function getStatusExpiresAtBySlot(snapshot, slot, statusId) {
  return getStatus(getActorBySlot(snapshot, slot), statusId)?.expiresAt ?? null;
}

function getMechanics(snapshot, kind, label = null) {
  return snapshot.mechanics.filter(
    (mechanic) => mechanic.kind === kind && (label === null || mechanic.label === label),
  );
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

  advanceTo(simulation, 50);
  const snapshot = simulation.getSnapshot();

  assert.ok(snapshot.mechanics.some((mechanic) => mechanic.kind === 'ringIndicator'));
  assert.ok(snapshot.mechanics.some((mechanic) => mechanic.kind === 'fanTelegraph'));
  assert.ok(snapshot.mechanics.some((mechanic) => mechanic.kind === 'rectangleTelegraph'));
  assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '玄乎乎魔法'));
  assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '大十字'));
});

test('两轮大十字同组内不会把同一 Buff 组重复给同一玩家', () => {
  const simulation = createKefkaP4Simulation(3);

  advanceTo(simulation, 8_000 + BIG_CROSS_CAST_MS);
  advanceTo(simulation, 15_000 + BIG_CROSS_CAST_MS);
  const snapshot = simulation.getSnapshot();
  const firstPlans = snapshot.scriptState['kefkaP4:bigCrossPlans:1'];
  const secondPlans = snapshot.scriptState['kefkaP4:bigCrossPlans:2'];

  assert.ok(firstPlans);
  assert.ok(secondPlans);

  for (const slot of PARTY_SLOT_ORDER) {
    assert.notEqual(secondPlans[slot], firstPlans[slot]);
  }

  for (const slots of [SUPPORT_SLOTS, DPS_SLOTS]) {
    assert.equal(new Set(slots.map((slot) => firstPlans[slot])).size, 4);
    assert.equal(new Set(slots.map((slot) => secondPlans[slot])).size, 4);
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

    advanceTo(simulation, 8_000 + BIG_CROSS_CAST_MS);
    advanceTo(simulation, 15_000 + BIG_CROSS_CAST_MS);
    const snapshot = simulation.getSnapshot();
    const firstPlans = snapshot.scriptState['kefkaP4:bigCrossPlans:1'];
    const secondPlans = snapshot.scriptState['kefkaP4:bigCrossPlans:2'];

    assert.ok(firstPlans);
    assert.ok(secondPlans);

    for (const slot of PARTY_SLOT_ORDER) {
      assert.notEqual(secondPlans[slot], firstPlans[slot]);
    }

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

test('海啸先出时混沌之水和混沌之炎仍按固定时间到期', () => {
  withMockedRandom(new Array(5000).fill(0.1), () => {
    const simulation = createKefkaP4SimulationDirect();

    advanceTo(simulation, 5_000 + CHAOS_CAST_MS);
    let snapshot = simulation.getSnapshot();

    assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '海啸'));
    for (const actor of snapshot.actors) {
      assert.equal(getStatus(actor, CHAOS_WATER_STATUS_ID)?.expiresAt, 95_000);
      assert.equal(getStatus(actor, CHAOS_FIRE_STATUS_ID), null);
    }

    advanceTo(simulation, 21_000 + CHAOS_CAST_MS);
    snapshot = simulation.getSnapshot();

    assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '烈焰'));
    for (const actor of snapshot.actors) {
      assert.equal(getStatus(actor, CHAOS_FIRE_STATUS_ID)?.expiresAt, 73_000);
    }
  });
});

test('烈焰先出时混沌之炎和混沌之水仍按固定时间到期', () => {
  withMockedRandom(new Array(5000).fill(0.9), () => {
    const simulation = createKefkaP4SimulationDirect();

    advanceTo(simulation, 5_000 + CHAOS_CAST_MS);
    let snapshot = simulation.getSnapshot();

    assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '烈焰'));
    for (const actor of snapshot.actors) {
      assert.equal(getStatus(actor, CHAOS_FIRE_STATUS_ID)?.expiresAt, 73_000);
      assert.equal(getStatus(actor, CHAOS_WATER_STATUS_ID), null);
    }

    advanceTo(simulation, 21_000 + CHAOS_CAST_MS);
    snapshot = simulation.getSnapshot();

    assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '海啸'));
    for (const actor of snapshot.actors) {
      assert.equal(getStatus(actor, CHAOS_WATER_STATUS_ID)?.expiresAt, 95_000);
    }
  });
});

test('混沌之炎到期后延迟5秒并在到期时原地显示预兆', () => {
  withMockedRandom(new Array(5000).fill(0.9), () => {
    const simulation = createKefkaP4SimulationDirect();

    advanceTo(simulation, 73_000);
    const lockedPosition = { ...getActorBySlot(simulation.getSnapshot(), 'MT').position };
    submitPose(simulation, getActorBySlot(simulation.getSnapshot(), 'MT'), { x: 12, y: 12 });
    advanceTo(simulation, 73_000 + CHAOS_ELEMENT_DELAY_MS - 500);
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

    advanceTo(simulation, 8_000);
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
    assert.deepEqual(firstElementalExpiresAts, [59_000, 59_000, 59_000, 59_000]);

    advanceTo(simulation, 23_000);
    snapshot = simulation.getSnapshot();
    const secondPlans = snapshot.scriptState['kefkaP4:bigCrossPlans:2'];
    assert.ok(secondPlans);
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
    assert.deepEqual(secondElementalExpiresAts, [84_000, 84_000, 84_000, 84_000]);
  });
});

test('水属性压缩假 Buff 使用叉形闪电的 8m 圆形效果', () => {
  withMockedRandom(new Array(5000).fill(0.9), () => {
    const simulation = createKefkaP4SimulationDirect();

    advanceTo(simulation, 24_000);
    let snapshot = simulation.getSnapshot();
    assert.ok(
      snapshot.actors.some((actor) =>
        actor.statuses.some(
          (status) => status.id === COMPRESSED_WATER_STATUS_ID && status.name.includes('（假）'),
        ),
      ),
    );

    advanceTo(simulation, 59_000);
    snapshot = simulation.getSnapshot();
    const waterCircleTelegraphs = getMechanics(snapshot, 'circleTelegraph', '水属性压缩');

    assert.ok(waterCircleTelegraphs.length > 0);
    assert.ok(waterCircleTelegraphs.every((mechanic) => mechanic.radius === 8));
    assert.equal(getMechanics(snapshot, 'donutTelegraph', '水属性压缩').length, 0);
  });
});

test('最终大十字赋予 15s 生死伤，并在每组分配 2 个领域和 2 个超越死亡', () => {
  const simulation = createKefkaP4Simulation(5);

  advanceTo(simulation, 30_000 + BIG_CROSS_CAST_MS);
  const snapshot = simulation.getSnapshot();

  for (const actor of snapshot.actors) {
    const wound =
      getStatus(actor, LIVING_WOUND_STATUS_ID) ?? getStatus(actor, DEAD_WOUND_STATUS_ID);
    assert.ok(wound, `missing wound for ${actor.slot}`);
    assert.equal(wound.expiresAt, 53_000);
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
      [54_000, 54_000],
    );
    assert.deepEqual(
      beyondDeathStatuses.map((status) => status.expiresAt),
      [53_000, 53_000],
    );
  }
});

test('生死伤吃到错误暗黑光时会立即消失', () => {
  const simulation = createKefkaP4Simulation(6);

  advanceTo(simulation, 47_000);
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
  advanceTo(simulation, 52_000);
  snapshot = simulation.getSnapshot();

  const resolvedActor = getActorBySlot(snapshot, 'MT');
  assert.equal(getStatus(resolvedActor, wound.id), null);
});

test('后续机制按时间轴显示雷冰变体、究极预兆和隐藏玄乎乎魔法', () => {
  const simulation = createKefkaP4Simulation(7);

  advanceTo(simulation, 56_000 + 50);
  let snapshot = simulation.getSnapshot();
  assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '魔力储存'));

  advanceTo(simulation, 56_000 + MANA_STORE_CAST_MS + 50);
  snapshot = simulation.getSnapshot();
  assert.ok(!snapshot.hud.bossCastBars.some((cast) => cast.actionName === '魔力储存'));

  advanceTo(simulation, 63_000 + 50);
  snapshot = simulation.getSnapshot();
  assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '劈啪啪暴雷'));
  assert.ok(getMechanics(snapshot, 'rectangleTelegraph', '玄乎乎魔法：雷').length > 0);
  assert.equal(getMechanics(snapshot, 'fanTelegraph', '玄乎乎魔法：冰').length, 0);

  advanceTo(simulation, 71_000 + MAGIC_CAST_MS - TELEGRAPH_MS);
  snapshot = simulation.getSnapshot();
  const ultimateTelegraph = getMechanics(snapshot, 'circleTelegraph', '扑腾腾究极')[0];
  assert.ok(ultimateTelegraph);
  assert.equal(ultimateTelegraph.radius, FLAPPING_ULTIMATE_RADIUS);

  advanceTo(simulation, 80_000 + 50);
  snapshot = simulation.getSnapshot();
  assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '扩大大冰封'));
  assert.ok(getMechanics(snapshot, 'fanTelegraph', '玄乎乎魔法：冰').length > 0);
  assert.equal(getMechanics(snapshot, 'rectangleTelegraph', '玄乎乎魔法：雷').length, 0);

  advanceTo(simulation, 89_000 + 50);
  snapshot = simulation.getSnapshot();
  assert.ok(snapshot.hud.bossCastBars.some((cast) => cast.actionName === '魔力释放'));
  assert.ok(getMechanics(snapshot, 'ringIndicator', '玄乎乎魔法真假').length > 0);
  assert.equal(getMechanics(snapshot, 'fanTelegraph', '玄乎乎魔法：冰').length, 0);
  assert.equal(getMechanics(snapshot, 'rectangleTelegraph', '玄乎乎魔法：雷').length, 0);

  advanceTo(simulation, 89_000 + MANA_RELEASE_CAST_MS + 50);
  snapshot = simulation.getSnapshot();
  assert.ok(!snapshot.hud.bossCastBars.some((cast) => cast.actionName === '魔力释放'));
  assert.ok(!snapshot.hud.bossCastBars.some((cast) => cast.actionName === '玄乎乎魔法'));
  assert.equal(getMechanics(snapshot, 'ringIndicator', '玄乎乎魔法真假').length, 0);
  assert.ok(getMechanics(snapshot, 'fanTelegraph', '玄乎乎魔法：冰').length > 0);
  assert.ok(getMechanics(snapshot, 'rectangleTelegraph', '玄乎乎魔法：雷').length > 0);
});
