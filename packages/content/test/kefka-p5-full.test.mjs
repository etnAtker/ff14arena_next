import test from 'node:test';
import assert from 'node:assert/strict';
import { FIXED_TICK_MS, createFacingTowards, createSimulation } from '@ff14arena/core';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { getBattleBotController, getBattleDefinition, getBattleStaticData } from '../src/index.ts';
import { KEFKA_P5_FULL_TESTING } from '../src/battles/kefka-p5-full.ts';

const {
  CONTINUOUS_ULTIMATE_CAST_ATS,
  CONTINUOUS_ULTIMATE_RESOLVE_ATS,
  MAGIC_STRIKE_HIT_ATS,
  FLOOD_PREVIEW_ATS,
  FLOOD_RESOLVE_ATS,
  MAD_SYMPHONY_CAST_RESOLVE_ATS,
  MAD_FIRST_HIT_ATS,
  MAD_SECOND_HIT_ATS,
  MAD_TELEGRAPH_MS,
  THREE_STARS_CAST_RESOLVE_AT,
  INITIAL_ELEMENT_VULNERABILITY_EXPIRES_AT,
  TOWER_RESOLVE_ATS,
  BASE_TOWER_DESPAWN_AT,
  DISASTER_CAST_RESOLVE_ATS,
  DISASTER_RANGE_RESOLVE_ATS,
  FIRE_CAST_RESOLVE_ATS,
  FIRE_INITIAL_TELEGRAPH_MS,
  FIRE_FIRST_HIT_DELAY_MS,
  FIRE_HIT_INTERVAL_MS,
  FIRE_HIT_COUNT,
  FIRE_HIT_DISPLAY_MS,
  START_TIME_OPTIONS,
  LEFT_FIRE_DIRECTION,
  RIGHT_FIRE_DIRECTION,
  CHAOS_VORTEX_CAST_START_AT,
  CHAOS_VORTEX_CAST_RESOLVE_AT,
  CHAOS_VORTEX_HIT_AT,
  CHAOS_VORTEX_RADIUS,
  CHAOS_VORTEX_BOT_SPREAD_START_AT,
  FORSAKEN_DOOMSDAY_CAST_START_AT,
  FORSAKEN_DOOMSDAY_CAST_MS,
  FORSAKEN_DOOMSDAY_PREVIEW_ATS,
  FORSAKEN_DOOMSDAY_RESOLVE_ATS,
  FORSAKEN_DOOMSDAY_PURPLE_RADIUS,
  FORSAKEN_DOOMSDAY_YELLOW_RADIUS,
  FORSAKEN_DOOMSDAY_SHARE_RADIUS,
  COMPLETE_AT,
  FLOOD_PLAN_KEY,
  THREE_STARS_PLAN_KEY,
  FIRE_PLAN_KEY,
  FORSAKEN_DOOMSDAY_PLAN_KEY,
  FORSAKEN_DOOMSDAY_ACTIVE_PURPLES_KEY,
  FORSAKEN_DOOMSDAY_WAIT_POINTS,
  KEFKA_MAP_MARKERS,
  createForsakenDoomsdayBotWaitPointIndexes,
  getKefkaP5FullBotTarget,
} = KEFKA_P5_FULL_TESTING;

function createKefkaP5FullSimulation(kind = 'player', options = {}) {
  const battle = getBattleDefinition('kefka_p5_full');
  assert.ok(battle);

  const simulation = createSimulation();
  simulation.loadBattle({
    battle,
    roomId: `kefka-p5-full-${kind}-test-room`,
    party: PARTY_SLOT_ORDER.map((slot) => ({
      slot,
      name: slot,
      kind,
      actorId: `${kind}_${slot}`,
    })),
    ...(options.startTimeMs === undefined ? {} : { startTimeMs: options.startTimeMs }),
  });
  simulation.start();

  return simulation;
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
  const controller = getBattleBotController('kefka_p5_full');
  assert.ok(controller);

  while (simulation.running && simulation.getSnapshot().timeMs < timeMs) {
    submitBotFrames(simulation, controller);
    simulation.tick(Math.min(50, timeMs - simulation.getSnapshot().timeMs));
  }
}

function advanceTo(simulation, timeMs) {
  const currentTimeMs = simulation.getSnapshot().timeMs;

  if (timeMs > currentTimeMs) {
    simulation.tick(timeMs - currentTimeMs);
  }
}

function alignToNextTick(timeMs) {
  return Math.ceil(timeMs / FIXED_TICK_MS) * FIXED_TICK_MS;
}

function assertNear(actual, expected, label, tolerance = 0.0001) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`,
  );
}

function submitActorPose(simulation, actorId, position) {
  simulation.submitActorControlFrame({
    actorId,
    issuedAt: simulation.getSnapshot().timeMs,
    pose: {
      position,
      facing: createFacingTowards(position, { x: 0, y: 0 }),
      moveState: {
        direction: { x: 0, y: 0 },
        moving: false,
      },
    },
  });
}

function setPartyPositionsOnNextTick(simulation, getPosition) {
  const snapshot = simulation.getSnapshot();

  for (const actor of snapshot.actors) {
    assert.ok(actor.slot);
    submitActorPose(simulation, actor.id, getPosition(actor));
  }

  simulation.tick(FIXED_TICK_MS);
}

function assertActorPose(actor, expectedPosition, label) {
  assertNear(actor.position.x, expectedPosition.x, `${label} x`);
  assertNear(actor.position.y, expectedPosition.y, `${label} y`);
  assertNear(
    actor.facing,
    createFacingTowards(expectedPosition, { x: 0, y: 0 }),
    `${label} facing`,
  );
}

test('凯夫卡P5整合：战斗、静态数据和Bot已登记', () => {
  const battle = getBattleDefinition('kefka_p5_full');
  assert.ok(battle);

  assert.equal(battle.name, '凯夫卡P5：整合');
  assert.deepEqual(battle.mapMarkers, KEFKA_MAP_MARKERS);
  assert.deepEqual(battle.startTimeOptions, START_TIME_OPTIONS);
  assert.ok(getBattleBotController('kefka_p5_full'));

  const staticData = getBattleStaticData('kefka_p5_full');
  assert.ok(staticData);
  assert.deepEqual(staticData.startTimeOptions, START_TIME_OPTIONS);
  assert.deepEqual(
    staticData.statusMetadata
      .map((status) => status.id)
      .filter(
        (statusId) =>
          statusId.startsWith('kefka_p5_three_stars_') || statusId.startsWith('kefka_p5_extra_'),
      ),
    [
      'kefka_p5_extra_nuclear_blast',
      'kefka_p5_extra_holy',
      'kefka_p5_three_stars_ice_resistance_down',
      'kefka_p5_three_stars_fire_resistance_down',
      'kefka_p5_three_stars_lightning_resistance_down',
    ],
  );
});

test('凯夫卡P5整合：跳时预设只开放指定阶段且不重设站位', () => {
  assert.deepEqual(
    START_TIME_OPTIONS.presets.map((preset) => preset.label),
    ['从头', '洪水', '癫狂交响曲', '三星', '地火', '遗弃末世'],
  );

  for (const preset of START_TIME_OPTIONS.presets) {
    const simulation = createKefkaP5FullSimulation('player', { startTimeMs: preset.timeMs });
    const snapshot = simulation.getSnapshot();
    const battle = getBattleDefinition('kefka_p5_full');
    assert.ok(battle);
    assert.equal(snapshot.timeMs, preset.timeMs);

    for (const actor of snapshot.actors) {
      assert.ok(actor.slot);
      assertActorPose(
        actor,
        battle.initialPartyPositions[actor.slot].position,
        `${preset.label} ${actor.slot}`,
      );
    }

    if (preset.label === '遗弃末世') {
      assert.equal(snapshot.boss.castBar?.actionName, '遗弃末世');
      assert.equal(snapshot.boss.castBar?.totalDurationMs, FORSAKEN_DOOMSDAY_CAST_MS);
    }
  }
});

test('凯夫卡P5整合：跳时会保留倒计时结束时的位置', () => {
  const battle = getBattleDefinition('kefka_p5_full');
  assert.ok(battle);
  const waitingSimulation = createKefkaP5FullSimulation('player');

  setPartyPositionsOnNextTick(waitingSimulation, (actor) => ({
    x: PARTY_SLOT_ORDER.indexOf(actor.slot) - 3.5,
    y: 12 - PARTY_SLOT_ORDER.indexOf(actor.slot) * 0.5,
  }));

  const sourceSnapshot = waitingSimulation.getSnapshot();
  const jumpSimulation = createSimulation();
  jumpSimulation.loadBattle({
    battle,
    roomId: 'kefka-p5-full-jump-preserve-test-room',
    party: PARTY_SLOT_ORDER.map((slot) => ({
      slot,
      name: slot,
      kind: 'player',
      actorId: `player_${slot}`,
    })),
    sourceSnapshot,
    resetAllActors: true,
    preserveActorPose: true,
    keepTimeMs: false,
    startTimeMs: FORSAKEN_DOOMSDAY_CAST_START_AT,
  });

  const snapshot = jumpSimulation.getSnapshot();
  assert.equal(snapshot.timeMs, FORSAKEN_DOOMSDAY_CAST_START_AT);
  assert.equal(snapshot.boss.castBar?.actionName, '遗弃末世');

  for (const actor of snapshot.actors) {
    assert.ok(actor.slot);
    const sourceActor = sourceSnapshot.actors.find((candidate) => candidate.id === actor.id);
    assert.ok(sourceActor);
    assertActorPose(actor, sourceActor.position, actor.slot);
  }
});

test('凯夫卡P5整合：关键时间轴常量按日志换算', () => {
  assert.deepEqual(CONTINUOUS_ULTIMATE_CAST_ATS, [0, 81_906]);
  assert.deepEqual(CONTINUOUS_ULTIMATE_RESOLVE_ATS, [3_700, 85_606]);
  assert.deepEqual(
    MAGIC_STRIKE_HIT_ATS,
    [9_672, 12_834, 15_953, 46_608, 49_731, 91_577, 94_738, 138_682, 141_803, 144_923],
  );
  assert.deepEqual(FLOOD_PREVIEW_ATS, [17_828, 18_853, 19_832, 20_856]);
  assert.deepEqual(FLOOD_RESOLVE_ATS, [22_369, 23_396, 24_420, 25_445]);
  assert.deepEqual(MAD_SYMPHONY_CAST_RESOLVE_ATS, [34_446, 126_517]);
  assert.equal(THREE_STARS_CAST_RESOLVE_AT, 56_144);
  assert.equal(INITIAL_ELEMENT_VULNERABILITY_EXPIRES_AT, 76_155);
  assert.deepEqual(TOWER_RESOLVE_ATS, [65_901, 71_919, 77_937]);
  assert.equal(BASE_TOWER_DESPAWN_AT, 78_237);
  assert.deepEqual(DISASTER_CAST_RESOLVE_ATS, [64_611, 76_778]);
  assert.deepEqual(DISASTER_RANGE_RESOLVE_ATS, [65_411, 77_583]);
  assert.deepEqual(FIRE_CAST_RESOLVE_ATS, [100_132, 102_674, 105_173, 107_669, 110_161, 112_658]);
  assert.equal(FIRE_INITIAL_TELEGRAPH_MS, 4_000);
  assert.equal(FIRE_FIRST_HIT_DELAY_MS, 625);
  assert.equal(FIRE_HIT_INTERVAL_MS, 500);
  assert.equal(FIRE_HIT_COUNT, 7);
  assert.equal(FIRE_HIT_DISPLAY_MS, 300);
  assert.equal(CHAOS_VORTEX_CAST_START_AT, 112_636);
  assert.equal(CHAOS_VORTEX_CAST_RESOLVE_AT, 117_336);
  assert.equal(CHAOS_VORTEX_HIT_AT, 118_228);
  assert.equal(
    CHAOS_VORTEX_BOT_SPREAD_START_AT,
    FIRE_CAST_RESOLVE_ATS.at(-1) +
      FIRE_FIRST_HIT_DELAY_MS +
      FIRE_HIT_INTERVAL_MS * (FIRE_HIT_COUNT - 1),
  );
  assert.equal(FORSAKEN_DOOMSDAY_CAST_START_AT, 146_250);
  assert.equal(FORSAKEN_DOOMSDAY_CAST_MS, 9_700);
  assert.deepEqual(FORSAKEN_DOOMSDAY_PREVIEW_ATS, [156_234, 164_417, 172_567, 180_701]);
  assert.deepEqual(FORSAKEN_DOOMSDAY_RESOLVE_ATS, [161_349, 169_495, 177_638, 185_767]);
  assert.equal(COMPLETE_AT, 186_767);
});

test('凯夫卡P5整合：混沌末世只读一次，每批初始地火按4秒预兆和斜向箭头显示', () => {
  const simulation = createKefkaP5FullSimulation();
  const firstBatchAt = FIRE_CAST_RESOLVE_ATS[0];
  const secondBatchAt = FIRE_CAST_RESOLVE_ATS[1];
  assert.ok(firstBatchAt);
  assert.ok(secondBatchAt);
  const firstPreviewAt = firstBatchAt + FIRE_FIRST_HIT_DELAY_MS - FIRE_INITIAL_TELEGRAPH_MS;
  const secondPreviewAt = secondBatchAt + FIRE_FIRST_HIT_DELAY_MS - FIRE_INITIAL_TELEGRAPH_MS;

  advanceTo(simulation, alignToNextTick(firstPreviewAt));

  const firstBatchSnapshot = simulation.getSnapshot();
  const firstBatchTelegraphs = firstBatchSnapshot.mechanics.filter(
    (mechanic) =>
      mechanic.kind === 'circleTelegraph' &&
      mechanic.label === '混沌末世预兆' &&
      mechanic.resolveAt === firstBatchSnapshot.timeMs + FIRE_INITIAL_TELEGRAPH_MS,
  );

  assert.equal(firstBatchSnapshot.boss.castBar?.actionName, '混沌末世');
  assert.equal(firstBatchTelegraphs.length, 2);
  assert.ok(firstBatchTelegraphs.every((mechanic) => mechanic.direction === LEFT_FIRE_DIRECTION));

  advanceTo(simulation, alignToNextTick(secondPreviewAt));

  const secondBatchSnapshot = simulation.getSnapshot();
  const secondBatchTelegraphs = secondBatchSnapshot.mechanics.filter(
    (mechanic) =>
      mechanic.kind === 'circleTelegraph' &&
      mechanic.label === '混沌末世预兆' &&
      mechanic.resolveAt === secondBatchSnapshot.timeMs + FIRE_INITIAL_TELEGRAPH_MS,
  );

  assert.equal(secondBatchTelegraphs.length, 2);
  assert.ok(secondBatchTelegraphs.every((mechanic) => mechanic.direction === RIGHT_FIRE_DIRECTION));

  advanceTo(simulation, alignToNextTick(FIRE_CAST_RESOLVE_ATS.at(-1)));

  const chaosDoomsdayCasts = simulation
    .drainEvents()
    .filter((event) => event.type === 'bossCastStarted' && event.payload.actionName === '混沌末世');

  assert.equal(chaosDoomsdayCasts.length, 1);
  assert.equal(chaosDoomsdayCasts[0]?.payload.startedAt, alignToNextTick(firstBatchAt - 3_700));
  assert.equal(chaosDoomsdayCasts[0]?.payload.totalDurationMs, 3_700);
});

test('凯夫卡P5整合：地火首判定沿用日志时间，判定后显示0.3秒范围', () => {
  const simulation = createKefkaP5FullSimulation();
  const firstBatchAt = FIRE_CAST_RESOLVE_ATS[0];
  assert.ok(firstBatchAt);

  const firstHitAt = firstBatchAt + FIRE_FIRST_HIT_DELAY_MS;
  const firstHitTickAt = alignToNextTick(firstHitAt);

  advanceTo(simulation, firstHitAt - 1);

  assert.equal(
    simulation
      .getSnapshot()
      .mechanics.filter(
        (mechanic) =>
          mechanic.kind === 'circleTelegraph' &&
          mechanic.label === '混沌末世' &&
          mechanic.resolveAt === firstHitTickAt + FIRE_HIT_DISPLAY_MS,
      ).length,
    0,
  );

  advanceTo(simulation, firstHitTickAt);

  const firstHitSnapshot = simulation.getSnapshot();
  const hitTelegraphs = firstHitSnapshot.mechanics.filter(
    (mechanic) =>
      mechanic.kind === 'circleTelegraph' &&
      mechanic.label === '混沌末世' &&
      mechanic.resolveAt === firstHitSnapshot.timeMs + FIRE_HIT_DISPLAY_MS,
  );

  assert.equal(hitTelegraphs.length, 2);
  assert.ok(hitTelegraphs.every((mechanic) => mechanic.direction === undefined));

  const secondHitAt = firstHitAt + FIRE_HIT_INTERVAL_MS;
  advanceTo(simulation, alignToNextTick(secondHitAt));

  const secondHitSnapshot = simulation.getSnapshot();
  const secondHitTelegraphs = secondHitSnapshot.mechanics.filter(
    (mechanic) =>
      mechanic.kind === 'circleTelegraph' &&
      mechanic.label === '混沌末世' &&
      mechanic.resolveAt === secondHitSnapshot.timeMs + FIRE_HIT_DISPLAY_MS,
  );

  assert.equal(secondHitTelegraphs.length, 2);
});

test('凯夫卡P5整合：初始化会生成随机计划供脚本和Bot读取', () => {
  const simulation = createKefkaP5FullSimulation();
  const snapshot = simulation.getSnapshot();

  assert.ok(snapshot.scriptState[FLOOD_PLAN_KEY]);
  assert.ok(snapshot.scriptState[THREE_STARS_PLAN_KEY]);
  assert.ok(snapshot.scriptState[FIRE_PLAN_KEY]);
  assert.ok(snapshot.scriptState[FORSAKEN_DOOMSDAY_PLAN_KEY]);
});

test('凯夫卡P5整合：三星基础塔会在第三轮结束后消失', () => {
  const simulation = createKefkaP5FullSimulation('bot');

  advanceWithBotControls(simulation, THREE_STARS_CAST_RESOLVE_AT + 100);
  assert.equal(
    simulation
      .getSnapshot()
      .mechanics.filter(
        (mechanic) => mechanic.label.startsWith('三星') && mechanic.kind === 'tower',
      ).length,
    9,
  );

  advanceWithBotControls(simulation, BASE_TOWER_DESPAWN_AT + 100);
  assert.equal(
    simulation
      .getSnapshot()
      .mechanics.filter(
        (mechanic) => mechanic.label.startsWith('三星') && mechanic.kind === 'tower',
      ).length,
    0,
  );
});

test('凯夫卡P5整合：重复癫狂提前显示预兆，魔击只显示判定反馈', () => {
  assert.equal(MAD_TELEGRAPH_MS, 500);
  assert.deepEqual(MAD_FIRST_HIT_ATS, [35_338, 127_405]);
  assert.deepEqual(MAD_SECOND_HIT_ATS, [38_497, 130_569]);

  const simulation = createKefkaP5FullSimulation('bot');

  advanceWithBotControls(simulation, MAGIC_STRIKE_HIT_ATS[7] - 400);
  assert.equal(
    simulation
      .getSnapshot()
      .mechanics.some(
        (mechanic) => mechanic.kind === 'actorMarker' && mechanic.label.includes('魔击'),
      ),
    false,
  );

  advanceWithBotControls(simulation, MAGIC_STRIKE_HIT_ATS[7] + 100);
  assert.ok(
    simulation
      .getSnapshot()
      .mechanics.some(
        (mechanic) => mechanic.kind === 'actorMarker' && mechanic.label === '魔击D分摊',
      ),
  );

  const madSimulation = createKefkaP5FullSimulation('bot');

  advanceWithBotControls(madSimulation, MAD_FIRST_HIT_ATS[1] - MAD_TELEGRAPH_MS + 100);
  assert.ok(
    madSimulation
      .getSnapshot()
      .mechanics.some(
        (mechanic) =>
          mechanic.kind === 'circleTelegraph' && mechanic.label === '癫狂交响曲核爆预兆',
      ),
  );
});

test('凯夫卡P5整合：Bot 共享站位会错开显示', () => {
  const simulation = createKefkaP5FullSimulation();
  const snapshot = simulation.getSnapshot();
  const dpsTargets = snapshot.actors
    .filter((actor) => actor.slot?.startsWith('D'))
    .map((actor) => {
      assert.ok(actor.slot);
      return getKefkaP5FullBotTarget(
        actor.slot,
        actor,
        MAGIC_STRIKE_HIT_ATS[0] - 500,
        snapshot.scriptState,
      );
    });

  assert.equal(
    new Set(dpsTargets.map((target) => `${target.x.toFixed(3)},${target.y.toFixed(3)}`)).size,
    4,
  );
});

test('凯夫卡P5整合：混沌涡旋读条开始时Bot不提前离开地火跑法', () => {
  const simulation = createKefkaP5FullSimulation();
  const snapshot = simulation.getSnapshot();
  const targets = snapshot.actors.map((actor) => {
    assert.ok(actor.slot);
    return getKefkaP5FullBotTarget(
      actor.slot,
      actor,
      CHAOS_VORTEX_CAST_START_AT + 100,
      snapshot.scriptState,
    );
  });

  assert.ok(targets.every((target) => Math.hypot(target.x, target.y) > 10));
});

test('凯夫卡P5整合：混沌涡旋Bot使用8m就近分散目标', () => {
  const simulation = createKefkaP5FullSimulation();
  const snapshot = simulation.getSnapshot();
  const targets = snapshot.actors.map((actor) => {
    assert.ok(actor.slot);
    return getKefkaP5FullBotTarget(
      actor.slot,
      actor,
      CHAOS_VORTEX_HIT_AT - 500,
      snapshot.scriptState,
    );
  });

  assert.equal(
    new Set(targets.map((target) => `${target.x.toFixed(3)},${target.y.toFixed(3)}`)).size,
    8,
  );
  assert.ok(targets.every((target) => Math.abs(Math.hypot(target.x, target.y) - 8) <= 0.001));
  assert.equal(CHAOS_VORTEX_RADIUS, 5);
});

test('凯夫卡P5整合：遗弃末世紫圈按四轮规则刷新且不重复', () => {
  const simulation = createKefkaP5FullSimulation();
  const plan = simulation.getSnapshot().scriptState[FORSAKEN_DOOMSDAY_PLAN_KEY];
  assert.ok(plan);

  const rounds = plan.rounds;
  assert.equal(rounds.length, 4);
  assert.deepEqual(
    rounds.map((round) => round.purplePoints.length),
    [2, 2, 2, 2],
  );
  assert.deepEqual(
    rounds.map((round) => round.purplePoints.map((point) => point.kind).sort()),
    [
      ['center', 'diagonal'],
      ['diagonal', 'diagonal'],
      ['cardinal', 'diagonal'],
      ['cardinal', 'cardinal'],
    ],
  );

  const purplePointIds = rounds.flatMap((round) => round.purplePoints.map((point) => point.id));
  assert.equal(new Set(purplePointIds).size, purplePointIds.length);
});

test('凯夫卡P5整合：遗弃末世预兆一起出现，判定后紫圈残留', () => {
  const simulation = createKefkaP5FullSimulation('bot', {
    startTimeMs: FORSAKEN_DOOMSDAY_CAST_START_AT,
  });

  advanceWithBotControls(simulation, alignToNextTick(FORSAKEN_DOOMSDAY_PREVIEW_ATS[0]));

  const previewSnapshot = simulation.getSnapshot();
  assert.equal(
    previewSnapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'circleTelegraph' && mechanic.label === '遗弃末世紫圈预兆',
    ).length,
    2,
  );
  assert.equal(
    previewSnapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'circleTelegraph' && mechanic.label === '遗弃末世黄圈预兆',
    ).length,
    1,
  );
  assert.equal(
    previewSnapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'actorMarker' && mechanic.label === '遗弃末世分摊',
    ).length,
    1,
  );

  advanceWithBotControls(simulation, alignToNextTick(FORSAKEN_DOOMSDAY_RESOLVE_ATS[0]));

  const resolveSnapshot = simulation.getSnapshot();
  assert.equal(resolveSnapshot.scriptState[FORSAKEN_DOOMSDAY_ACTIVE_PURPLES_KEY].length, 2);
  assert.equal(
    resolveSnapshot.mechanics.filter(
      (mechanic) => mechanic.kind === 'fieldMarker' && mechanic.label === '遗弃末世紫圈',
    ).length,
    2,
  );
});

test('凯夫卡P5整合：遗弃末世分摊少于8人时判失败', () => {
  const simulation = createKefkaP5FullSimulation('player', {
    startTimeMs: FORSAKEN_DOOMSDAY_CAST_START_AT,
  });
  const previewAt = alignToNextTick(FORSAKEN_DOOMSDAY_PREVIEW_ATS[0]);
  const resolveAt = alignToNextTick(FORSAKEN_DOOMSDAY_RESOLVE_ATS[0]);

  advanceTo(simulation, previewAt);

  const plan = simulation.getSnapshot().scriptState[FORSAKEN_DOOMSDAY_PLAN_KEY];
  assert.ok(plan);
  const shareTargetId = plan.rounds[0].shareTargetId;
  assert.ok(shareTargetId);

  advanceTo(simulation, resolveAt - FIXED_TICK_MS);
  setPartyPositionsOnNextTick(simulation, (actor) =>
    actor.id === shareTargetId ? { x: 0, y: 18 } : { x: 0, y: -18 },
  );

  assert.ok(simulation.getSnapshot().failureReasons.includes('遗弃末世分摊人数不足'));
});

test('凯夫卡P5整合：遗弃末世Bot使用4个固定等待点', () => {
  const simulation = createKefkaP5FullSimulation('bot', {
    startTimeMs: FORSAKEN_DOOMSDAY_CAST_START_AT,
  });
  const snapshot = simulation.getSnapshot();
  const plan = snapshot.scriptState[FORSAKEN_DOOMSDAY_PLAN_KEY];
  assert.ok(plan);

  assert.equal(plan.botWaitPointIndexes.length, 4);
  assert.equal(plan.botWaitPointIndexes[1], (plan.botWaitPointIndexes[0] + 1) % 4);
  assert.equal(plan.botWaitPointIndexes[3], plan.botWaitPointIndexes[1]);
  assert.ok(
    plan.botWaitPointIndexes.every(
      (waitPointIndex) => FORSAKEN_DOOMSDAY_WAIT_POINTS[waitPointIndex] !== undefined,
    ),
  );

  const firstPreviewTargets = snapshot.actors.map((actor) => {
    assert.ok(actor.slot);
    return getKefkaP5FullBotTarget(
      actor.slot,
      actor,
      FORSAKEN_DOOMSDAY_PREVIEW_ATS[0],
      snapshot.scriptState,
    );
  });
  const firstWaitPoint = FORSAKEN_DOOMSDAY_WAIT_POINTS[plan.botWaitPointIndexes[0]];
  assert.ok(firstWaitPoint);
  assert.ok(
    firstPreviewTargets.every(
      (target) =>
        Math.abs(target.x - firstWaitPoint.x) <= 0.25 &&
        Math.abs(target.y - firstWaitPoint.y) <= 0.25,
    ),
  );

  assert.equal(FORSAKEN_DOOMSDAY_PURPLE_RADIUS, 8);
  assert.equal(FORSAKEN_DOOMSDAY_YELLOW_RADIUS, 8);
  assert.equal(FORSAKEN_DOOMSDAY_SHARE_RADIUS, 8);
});

test('凯夫卡P5整合：Bot 不会在遗弃末世开场自动疾跑', () => {
  const simulation = createKefkaP5FullSimulation('bot', {
    startTimeMs: FORSAKEN_DOOMSDAY_CAST_START_AT,
  });
  const controller = getBattleBotController('kefka_p5_full');
  assert.ok(controller);
  const snapshot = simulation.getSnapshot();

  for (const actor of snapshot.actors) {
    assert.ok(actor.slot);
    const frame = controller({
      snapshot,
      slot: actor.slot,
      actor,
    });

    assert.deepEqual(frame.commands ?? [], []);
  }
});

test('凯夫卡P5整合：遗弃末世Bot第三轮只按本轮顺时针路径判断反跑', () => {
  const northEast = {
    id: 'north_east',
    kind: 'diagonal',
    position: { x: 13.5, y: -13.5 },
  };
  const southWest = {
    id: 'south_west',
    kind: 'diagonal',
    position: { x: -13.5, y: 13.5 },
  };

  assert.deepEqual(
    createForsakenDoomsdayBotWaitPointIndexes([
      { index: 0, previewAt: 0, resolveAt: 0, purplePoints: [northEast] },
      { index: 1, previewAt: 0, resolveAt: 0, purplePoints: [] },
      {
        index: 2,
        previewAt: 0,
        resolveAt: 0,
        purplePoints: [southWest, { id: 'south', kind: 'cardinal', position: { x: 0, y: 13.5 } }],
      },
      { index: 3, previewAt: 0, resolveAt: 0, purplePoints: [] },
    ]),
    [0, 1, 0, 1],
  );

  assert.deepEqual(
    createForsakenDoomsdayBotWaitPointIndexes([
      { index: 0, previewAt: 0, resolveAt: 0, purplePoints: [northEast] },
      { index: 1, previewAt: 0, resolveAt: 0, purplePoints: [] },
      {
        index: 2,
        previewAt: 0,
        resolveAt: 0,
        purplePoints: [southWest, { id: 'west', kind: 'cardinal', position: { x: -13.5, y: 0 } }],
      },
      { index: 3, previewAt: 0, resolveAt: 0, purplePoints: [] },
    ]),
    [0, 1, 2, 1],
  );
});

test('凯夫卡P5整合：遗弃末世Bot按固定圆弧路线完成随机样本', () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const simulation = createKefkaP5FullSimulation('bot', {
      startTimeMs: FORSAKEN_DOOMSDAY_CAST_START_AT,
    });

    advanceWithBotControls(simulation, COMPLETE_AT + 100);

    const snapshot = simulation.getSnapshot();
    assert.equal(snapshot.latestResult?.outcome, 'success');
    assert.equal(snapshot.failureReasons.length, 0);
  }
});
