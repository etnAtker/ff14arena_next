import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '@ff14arena/core';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { getBattleBotController, getBattleDefinition } from '../src/index.ts';

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

function createTopProgramLoopSimulation() {
  const battle = getBattleDefinition('top_p1_program_loop');
  assert.ok(battle);

  const simulation = createSimulation();
  simulation.loadBattle({
    battle,
    roomId: 'program-loop-test-room',
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

function runTopProgramLoopWithBots(randomValues) {
  return withMockedRandom(randomValues, () => {
    const controller = getBattleBotController('top_p1_program_loop');
    assert.ok(controller);

    const simulation = createTopProgramLoopSimulation();
    let inputSeq = 0;

    for (let elapsedMs = 0; elapsedMs <= 60_000 && simulation.running; elapsedMs += 50) {
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
          inputSeq: ++inputSeq,
          issuedAt: elapsedMs,
          ...frame,
        });
      }

      simulation.tick(50);
    }

    return simulation.getSnapshot();
  });
}

const TOWER_RING_KEYS = ['-15,-3', '-3,-15', '3,-15', '15,-3', '15,3', '3,15', '-3,15', '-15,3'];
const TOWER_ASSIGNMENT_SCAN_KEYS = [
  '-3,-15',
  '3,-15',
  '15,-3',
  '15,3',
  '3,15',
  '-3,15',
  '-15,3',
  '-15,-3',
];
const SHOCKWAVE_CARDINAL_KEYS = ['0,-17', '17,0', '0,17', '-17,0'];
const TOP_ASSIGNMENT_PRIORITY = ['H1', 'MT', 'ST', 'D1', 'D2', 'D3', 'D4', 'H2'];

function isValidTowerPairIndexDistance(towerPositions) {
  const indexes = towerPositions.map((position) =>
    TOWER_RING_KEYS.indexOf(`${position.x},${position.y}`),
  );

  return (
    indexes.every((index) => index >= 0) && [2, 4, 6].includes(Math.abs(indexes[0] - indexes[1]))
  );
}

function getPositionKey(position) {
  return `${Math.round(position.x)},${Math.round(position.y)}`;
}

function isSortedByOrder(positions, orderKeys) {
  const indexes = positions.map((position) => orderKeys.indexOf(getPositionKey(position)));

  return indexes.every((index) => index >= 0) && indexes[0] < indexes[1];
}

function sortSlotsByTopPriority(slots) {
  return [...slots].sort(
    (left, right) => TOP_ASSIGNMENT_PRIORITY.indexOf(left) - TOP_ASSIGNMENT_PRIORITY.indexOf(right),
  );
}

test('通用连线：玩家单 tick 穿过连线时也能完成传递', () => {
  const battle = {
    id: 'tether_sweep_test',
    name: '连线扫掠测试',
    arenaRadius: 30,
    bossTargetRingRadius: 15,
    slots: ['MT', 'ST'],
    bossName: '测试首领',
    initialPartyPositions: {
      MT: { position: { x: 0, y: 10 }, facing: 0 },
      ST: { position: { x: -1, y: 5 }, facing: 0 },
    },
    failureTexts: {
      outOfBounds(actorName) {
        return `${actorName} 触碰死亡墙`;
      },
      mechanicDeath(actorName, sourceLabel) {
        return `${actorName} 因 ${sourceLabel} 死亡`;
      },
    },
    buildScript(ctx) {
      ctx.timeline.at(0, () => {
        const actors = ctx.select.allPlayers();
        const holder = actors.find((actor) => actor.slot === 'MT');
        const receiver = actors.find((actor) => actor.slot === 'ST');
        assert.ok(holder);
        assert.ok(receiver);

        ctx.spawn.tether({
          label: '测试连线',
          target: holder,
          transferCooldownMs: 500,
          allowTransfer: true,
          allowDeadRetarget: true,
          preventTargetHoldingOtherTether: true,
          resolveAfterMs: 10_000,
        });
      });
    },
  };
  const simulation = createSimulation();

  simulation.loadBattle({
    battle,
    roomId: 'tether-sweep-test-room',
    party: [
      {
        slot: 'MT',
        name: 'MT',
        kind: 'player',
        actorId: 'player_MT',
      },
      {
        slot: 'ST',
        name: 'ST',
        kind: 'player',
        actorId: 'player_ST',
      },
    ],
  });
  simulation.start();
  simulation.tick(50);

  const receiver = simulation.getSnapshot().actors.find((actor) => actor.slot === 'ST');
  assert.ok(receiver);
  submitPose(simulation, receiver, { x: 1, y: 5 }, 1);
  simulation.tick(50);

  const tether = simulation.getSnapshot().mechanics.find((mechanic) => mechanic.kind === 'tether');
  assert.ok(tether);
  assert.equal(tether.targetId, receiver.id);
});

test('通用连线：玩家无需白名单即可误穿接线', () => {
  const battle = {
    id: 'player_tether_sweep_with_bot_order_test',
    name: '玩家误穿接线测试',
    arenaRadius: 30,
    bossTargetRingRadius: 15,
    slots: ['MT', 'ST', 'H1'],
    bossName: '测试首领',
    initialPartyPositions: {
      MT: { position: { x: 0, y: 10 }, facing: 0 },
      ST: { position: { x: 5, y: 5 }, facing: 0 },
      H1: { position: { x: -1, y: 5 }, facing: 0 },
    },
    failureTexts: {
      outOfBounds(actorName) {
        return `${actorName} 触碰死亡墙`;
      },
      mechanicDeath(actorName, sourceLabel) {
        return `${actorName} 因 ${sourceLabel} 死亡`;
      },
    },
    buildScript(ctx) {
      ctx.timeline.at(0, () => {
        const actors = ctx.select.allPlayers();
        const holder = actors.find((actor) => actor.slot === 'MT');
        const receiver = actors.find((actor) => actor.slot === 'H1');
        assert.ok(holder);
        assert.ok(receiver);

        ctx.spawn.tether({
          label: '测试连线',
          target: holder,
          transferCooldownMs: 500,
          allowTransfer: true,
          allowDeadRetarget: true,
          preventTargetHoldingOtherTether: true,
          resolveAfterMs: 10_000,
        });
      });
    },
  };
  const simulation = createSimulation();

  simulation.loadBattle({
    battle,
    roomId: 'player-tether-sweep-with-bot-order-test-room',
    party: [
      {
        slot: 'MT',
        name: 'MT',
        kind: 'bot',
        actorId: 'bot_MT',
      },
      {
        slot: 'ST',
        name: 'ST',
        kind: 'bot',
        actorId: 'bot_ST',
      },
      {
        slot: 'H1',
        name: 'H1',
        kind: 'player',
        actorId: 'player_H1',
      },
    ],
  });
  simulation.start();
  simulation.tick(50);

  const receiver = simulation.getSnapshot().actors.find((actor) => actor.slot === 'H1');
  assert.ok(receiver);
  submitPose(simulation, receiver, { x: 1, y: 5 }, 1);
  simulation.tick(50);

  const tether = simulation.getSnapshot().mechanics.find((mechanic) => mechanic.kind === 'tether');
  assert.ok(tether);
  assert.equal(tether.targetId, receiver.id);
});

test('欧米茄绝境战 P1 循环程序：全机器人按随机塔位脚本完成机制', () => {
  const randomValues = [0.91, 0.17, 0.73, 0.44, 0.28, 0.62, 0.05];
  withMockedRandom(randomValues, () => {
    const controller = getBattleBotController('top_p1_program_loop');
    assert.ok(controller);

    const simulation = createTopProgramLoopSimulation();

    const initialSnapshot = simulation.getSnapshot();
    assert.deepEqual(
      initialSnapshot.mapMarkers.map((marker) => marker.label),
      ['A', '2', 'B', '3', 'C', '4', 'D', '1'],
    );
    assert.deepEqual(
      initialSnapshot.mapMarkers.map((marker) => marker.shape),
      ['circle', 'square', 'circle', 'square', 'circle', 'square', 'circle', 'square'],
    );
    assert.equal(initialSnapshot.mapMarkers[0]?.radius, 2);
    assert.equal(initialSnapshot.mapMarkers[1]?.size, 3);

    let inputSeq = 0;
    let checkedRandomAssignments = false;
    let checkedRandomTowers = false;

    for (let elapsedMs = 0; elapsedMs <= 60_000 && simulation.running; elapsedMs += 50) {
      const snapshot = simulation.getSnapshot();
      const tethers = snapshot.mechanics.filter(
        (mechanic) => mechanic.kind === 'tether' && mechanic.label === '冲击波连线',
      );

      if (snapshot.timeMs >= 10_000 && snapshot.timeMs < 47_500) {
        assert.equal(tethers.length, 2, '循环程序期间应持续存在两条冲击波连线');
      }

      if (!checkedRandomAssignments && snapshot.timeMs >= 10_000) {
        const assignments = {
          1: [],
          2: [],
          3: [],
          4: [],
        };

        for (const actor of snapshot.actors) {
          const status = actor.statuses.find((candidate) =>
            candidate.id.startsWith('program_loop_'),
          );

          if (actor.slot !== null && status !== undefined) {
            assignments[Number(status.id.at(-1))].push(actor.slot);
          }
        }

        assert.deepEqual(
          Object.values(assignments).map((slots) => slots.length),
          [2, 2, 2, 2],
          '随机点名应给每个编号分配 2 名玩家',
        );
        assert.notDeepEqual(assignments, {
          1: ['MT', 'ST'],
          2: ['H1', 'H2'],
          3: ['D1', 'D2'],
          4: ['D3', 'D4'],
        });
        checkedRandomAssignments = true;
      }

      if (!checkedRandomTowers && snapshot.timeMs >= 10_000) {
        const rounds = snapshot.scriptState['top:rounds'];
        const scriptAssignments = snapshot.scriptState['top:assignments'];
        const botTetherLanes = snapshot.scriptState['top:botTetherLanes'];
        assert.ok(Array.isArray(rounds));
        assert.ok(scriptAssignments);
        assert.ok(Array.isArray(botTetherLanes));

        const towerPositions = rounds.flatMap((round) => round.towerPositions);
        const tetherPositions = rounds.flatMap((round) => round.tetherPositions);

        assert.equal(towerPositions.length, 8, '随机塔序列应包含 8 个塔位');
        assert.equal(
          new Set(towerPositions.map((position) => `${position.x},${position.y}`)).size,
          8,
          '随机塔序列不应重复使用同一塔位',
        );
        assert.equal(
          rounds.every((round) => isValidTowerPairIndexDistance(round.towerPositions)),
          true,
          '每轮随机塔位的环形索引差必须为 2、4 或 6',
        );
        assert.equal(
          rounds.every((round) =>
            isSortedByOrder(round.towerPositions, TOWER_ASSIGNMENT_SCAN_KEYS),
          ),
          true,
          '每轮塔位应按 A 左侧起顺时针顺序分配',
        );
        assert.equal(
          tetherPositions.every((position) =>
            SHOCKWAVE_CARDINAL_KEYS.includes(getPositionKey(position)),
          ),
          true,
          '冲击波拉线点应固定在 17m 正点',
        );
        assert.equal(
          rounds.every((round) => isSortedByOrder(round.tetherPositions, SHOCKWAVE_CARDINAL_KEYS)),
          true,
          '每轮冲击波拉线点应按 A 起顺时针顺序分配',
        );
        assert.deepEqual(
          botTetherLanes,
          [
            [2, 3, 4, 1].map((number) => sortSlotsByTopPriority(scriptAssignments[number])[0]),
            [2, 3, 4, 1].map((number) => sortSlotsByTopPriority(scriptAssignments[number])[1]),
          ],
          '接线车道应按 H1 MT ST D1 D2 D3 D4 H2 优先级拆分',
        );
        assert.notDeepEqual(
          rounds.map((round) => round.towerPositions),
          [
            [
              { x: -3, y: -15 },
              { x: 3, y: 15 },
            ],
            [
              { x: 15, y: -3 },
              { x: -15, y: 3 },
            ],
            [
              { x: 3, y: -15 },
              { x: -3, y: 15 },
            ],
            [
              { x: 15, y: 3 },
              { x: -15, y: -3 },
            ],
          ],
          '固定随机序列下塔位不应退回旧固定序列',
        );
        checkedRandomTowers = true;
      }

      const tetherTargetIds = tethers.map((tether) => tether.targetId);
      assert.equal(
        new Set(tetherTargetIds).size,
        tetherTargetIds.length,
        '同一玩家不能同时持有两条冲击波连线',
      );

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

    const result = simulation.getSnapshot().latestResult;
    assert.equal(result?.outcome, 'success');
    assert.deepEqual(result?.failureReasons, []);
  });
});

test('欧米茄绝境战 P1 循环程序：Bot 不会提前接走非自身轮次连线', () => {
  const snapshot = runTopProgramLoopWithBots(createSeededRandomValues(4, 32));
  const result = snapshot.latestResult;

  assert.equal(result?.outcome, 'success');
  assert.deepEqual(result?.failureReasons, []);
});

test('欧米茄绝境战 P1 循环程序：更晚编号提前踩塔会消耗自身状态', () => {
  withMockedRandom([0.91, 0.17, 0.73, 0.44, 0.28, 0.62, 0.05], () => {
    const simulation = createTopProgramLoopSimulation();
    let inputSeq = 0;

    advanceTo(simulation, 10_000);

    for (const actor of simulation.getSnapshot().actors) {
      submitPose(simulation, actor, { x: 0, y: 0 }, ++inputSeq);
    }

    simulation.tick(50);

    const snapshotAfterAssignment = simulation.getSnapshot();
    const lateActor = snapshotAfterAssignment.actors.find((actor) =>
      actor.statuses.some(
        (status) => status.id === 'program_loop_3' || status.id === 'program_loop_4',
      ),
    );
    assert.ok(lateActor);

    const originalStatus = lateActor.statuses.find((status) =>
      ['program_loop_3', 'program_loop_4'].includes(status.id),
    );
    assert.ok(originalStatus);

    const tower = snapshotAfterAssignment.mechanics.find((mechanic) => mechanic.kind === 'tower');
    assert.ok(tower);

    submitPose(simulation, lateActor, tower.center, ++inputSeq);
    simulation.tick(50);
    advanceTo(simulation, 17_600);

    const actorAfterTower = simulation
      .getSnapshot()
      .actors.find((actor) => actor.id === lateActor.id);
    assert.ok(actorAfterTower);
    assert.equal(
      actorAfterTower.statuses.some((status) => status.id === originalStatus.id),
      false,
    );
  });
});

test('欧米茄绝境战 P1 循环程序：循环程序状态到期未消除会触发遗忘死亡', () => {
  withMockedRandom([0.91, 0.17, 0.73, 0.44, 0.28, 0.62, 0.05], () => {
    const simulation = createTopProgramLoopSimulation();
    let inputSeq = 0;

    advanceTo(simulation, 10_000);

    for (const actor of simulation.getSnapshot().actors) {
      submitPose(simulation, actor, { x: 0, y: 0 }, ++inputSeq);
    }

    simulation.tick(50);

    const firstActor = simulation
      .getSnapshot()
      .actors.find((actor) => actor.statuses.some((status) => status.id === 'program_loop_1'));
    assert.ok(firstActor);

    advanceTo(simulation, 26_000);

    const actorAfterExpire = simulation
      .getSnapshot()
      .actors.find((actor) => actor.id === firstActor.id);
    assert.ok(actorAfterExpire);
    assert.equal(actorAfterExpire.alive, false);
    assert.equal(actorAfterExpire.deathReason, '遗忘');
    assert.ok(
      simulation
        .getSnapshot()
        .failureReasons.some((reason) => reason === `${firstActor.name} 因 遗忘 死亡`),
    );
  });
});
