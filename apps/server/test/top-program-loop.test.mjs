import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation } from '@ff14arena/core';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { getBattleBotController, getBattleDefinition } from '@ff14arena/content';

test('欧米茄绝境战 P1 循环程序：全机器人按固定脚本完成机制', () => {
  const originalRandom = Math.random;
  const randomValues = [0.91, 0.17, 0.73, 0.44, 0.28, 0.62, 0.05];
  let randomIndex = 0;
  Math.random = () => randomValues[randomIndex++ % randomValues.length];

  const battle = getBattleDefinition('top_p1_program_loop');
  const controller = getBattleBotController('top_p1_program_loop');

  try {
    assert.ok(battle);
    assert.ok(controller);

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
  } finally {
    Math.random = originalRandom;
  }
});
