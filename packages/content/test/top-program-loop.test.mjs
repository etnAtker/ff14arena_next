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
          allowedTargets: [receiver],
          transferRadius: 0.6,
          transferCooldownMs: 500,
          minSourceDistance: 3,
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

test('欧米茄绝境战 P1 循环程序：全机器人按固定脚本完成机制', () => {
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

    const northTower = snapshotAfterAssignment.mechanics.find(
      (mechanic) => mechanic.kind === 'tower' && mechanic.center.y < 0,
    );
    assert.ok(northTower);

    submitPose(simulation, lateActor, northTower.center, ++inputSeq);
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
