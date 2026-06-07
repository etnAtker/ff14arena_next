import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '@ff14arena/core';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { getBattleBotController, getBattleDefinition, getBattleStaticData } from '../src/index.ts';
import { KEFKA_P5_FULL_TESTING } from '../src/battles/kefka-p5-full.ts';

const {
  CONTINUOUS_ULTIMATE_CAST_ATS,
  CONTINUOUS_ULTIMATE_RESOLVE_ATS,
  MAGIC_STRIKE_HIT_ATS,
  MAGIC_STRIKE_TELEGRAPH_MS,
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
  CHAOS_VORTEX_CAST_START_AT,
  CHAOS_VORTEX_CAST_RESOLVE_AT,
  CHAOS_VORTEX_HIT_AT,
  CHAOS_VORTEX_RADIUS,
  COMPLETE_AT,
  FLOOD_PLAN_KEY,
  THREE_STARS_PLAN_KEY,
  FIRE_PLAN_KEY,
  KEFKA_MAP_MARKERS,
  getKefkaP5FullBotTarget,
} = KEFKA_P5_FULL_TESTING;

function createKefkaP5FullSimulation(kind = 'player') {
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

test('凯夫卡P5整合：战斗、静态数据和Bot已登记', () => {
  const battle = getBattleDefinition('kefka_p5_full');
  assert.ok(battle);

  assert.equal(battle.name, '凯夫卡P5：整合');
  assert.deepEqual(battle.mapMarkers, KEFKA_MAP_MARKERS);
  assert.ok(getBattleStaticData('kefka_p5_full'));
  assert.ok(getBattleBotController('kefka_p5_full'));
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
  assert.equal(CHAOS_VORTEX_CAST_START_AT, 112_636);
  assert.equal(CHAOS_VORTEX_CAST_RESOLVE_AT, 117_336);
  assert.equal(CHAOS_VORTEX_HIT_AT, 118_228);
  assert.equal(COMPLETE_AT, 145_923);
});

test('凯夫卡P5整合：初始化会生成随机计划供脚本和Bot读取', () => {
  const simulation = createKefkaP5FullSimulation();
  const snapshot = simulation.getSnapshot();

  assert.ok(snapshot.scriptState[FLOOD_PLAN_KEY]);
  assert.ok(snapshot.scriptState[THREE_STARS_PLAN_KEY]);
  assert.ok(snapshot.scriptState[FIRE_PLAN_KEY]);
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

test('凯夫卡P5整合：重复癫狂和魔击都会提前显示预兆', () => {
  assert.equal(MAGIC_STRIKE_TELEGRAPH_MS, 500);
  assert.equal(MAD_TELEGRAPH_MS, 500);
  assert.deepEqual(MAD_FIRST_HIT_ATS, [35_338, 127_405]);
  assert.deepEqual(MAD_SECOND_HIT_ATS, [38_497, 130_569]);

  const simulation = createKefkaP5FullSimulation('bot');

  advanceWithBotControls(simulation, MAGIC_STRIKE_HIT_ATS[7] - 400);
  assert.ok(
    simulation
      .getSnapshot()
      .mechanics.some(
        (mechanic) => mechanic.kind === 'actorMarker' && mechanic.label === '魔击D分摊预兆',
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

test('凯夫卡P5整合：混沌涡旋Bot使用8个5m分散目标', () => {
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
  assert.ok(targets.every((target) => Math.abs(Math.hypot(target.x, target.y) - 13) <= 0.001));
  assert.equal(CHAOS_VORTEX_RADIUS, 5);
});
