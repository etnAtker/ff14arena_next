import type { BattleDefinition } from '@ff14arena/core';
import {
  createFacingTowards,
  createPointOnRadius,
  DEFAULT_PLAYER_MAX_HP,
  INJURY_UP_DURATION_MS,
  INJURY_UP_MULTIPLIER,
} from '@ff14arena/core';
import type { BattleStaticData, BattleSummary, PartySlot } from '@ff14arena/shared';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';

const LEFT_SHARE_GROUP: PartySlot[] = ['MT', 'H1', 'D1', 'D3'];
const RIGHT_SHARE_GROUP: PartySlot[] = ['ST', 'H2', 'D2', 'D4'];

const SPREAD_ANGLES: Record<PartySlot, number> = {
  MT: -Math.PI / 2,
  D4: -Math.PI / 4,
  H2: 0,
  D2: Math.PI / 4,
  ST: Math.PI / 2,
  D1: (Math.PI * 3) / 4,
  H1: Math.PI,
  D3: (-Math.PI * 3) / 4,
};

function createMoveDirective(
  current: { x: number; y: number },
  target: { x: number; y: number },
): { x: number; y: number } {
  const delta = {
    x: target.x - current.x,
    y: target.y - current.y,
  };

  if (Math.hypot(delta.x, delta.y) <= 0.35) {
    return {
      x: 0,
      y: 0,
    };
  }

  return delta;
}

interface OpeningTwoRoundsBotContext {
  mode: 'idle' | 'share' | 'spread';
  safeRadius: number;
}

const OPENING_TWO_ROUNDS_BATTLE: BattleDefinition<OpeningTwoRoundsBotContext> = {
  id: 'opening_two_rounds',
  name: '双轮组合练习',
  arenaRadius: 20,
  bossTargetRingRadius: 5,
  slots: PARTY_SLOT_ORDER,
  bossName: '练习用首领',
  initialPartyPositions: {
    MT: { position: createPointOnRadius(-Math.PI / 2, 8), facing: Math.PI / 2 },
    ST: { position: createPointOnRadius(Math.PI / 2, 8), facing: -Math.PI / 2 },
    H1: { position: createPointOnRadius(Math.PI, 8), facing: 0 },
    H2: { position: createPointOnRadius(0, 8), facing: Math.PI },
    D1: { position: createPointOnRadius((Math.PI * 3) / 4, 8), facing: -Math.PI / 4 },
    D2: { position: createPointOnRadius(Math.PI / 4, 8), facing: (-Math.PI * 3) / 4 },
    D3: { position: createPointOnRadius((-Math.PI * 3) / 4, 8), facing: Math.PI / 4 },
    D4: { position: createPointOnRadius(-Math.PI / 4, 8), facing: (Math.PI * 3) / 4 },
  },
  failureTexts: {
    outOfBounds(actorName) {
      return `${actorName} 越界死亡`;
    },
    mechanicDeath(actorName, sourceLabel) {
      return `${actorName} 因 ${sourceLabel} 死亡`;
    },
  },
  buildScript(ctx) {
    const firstArea = Math.random() >= 0.5 ? '钢铁' : '月环';
    const firstTarget = Math.random() >= 0.5 ? '分摊' : '分散';
    const secondArea = firstArea === '钢铁' ? '月环' : '钢铁';
    const secondTarget = firstTarget === '分摊' ? '分散' : '分摊';
    const rounds = [
      { index: 1, area: firstArea, target: firstTarget, startAt: 1000 },
      { index: 2, area: secondArea, target: secondTarget, startAt: 6500 },
    ] as const;

    ctx.state.setValue('rounds', rounds);
    ctx.bot.setContext({
      mode: 'idle',
      safeRadius: 5,
    });

    for (const round of rounds) {
      ctx.timeline.at(round.startAt, () => {
        ctx.state.setValue('activeRound', round.index);
        ctx.state.setValue('activeArea', round.area);
        ctx.state.setValue('activeTarget', round.target);
        ctx.bot.setContext({
          mode: 'idle',
          safeRadius: round.area === '钢铁' ? 6 : 5,
        });
        ctx.boss.cast(
          `round_${round.index}`,
          `第${round.index}轮：${round.area} + ${round.target}`,
          3000,
        );

        if (round.area === '钢铁') {
          ctx.spawn.circleAoe({
            label: '钢铁',
            radius: 5,
            damage: 5000,
            resolveAfterMs: 3000,
          });
        } else {
          ctx.spawn.donutAoe({
            label: '月环',
            innerRadius: 6,
            outerRadius: 15,
            damage: 5000,
            resolveAfterMs: 3000,
          });
        }
      });

      ctx.timeline.at(round.startAt + 3000, () => {
        ctx.bot.setContext({
          mode: round.target === '分摊' ? 'share' : 'spread',
          safeRadius: round.area === '钢铁' ? 6 : 5,
        });

        if (round.target === '分摊') {
          const h1 = ctx.select.bySlot('H1');
          const h2 = ctx.select.bySlot('H2');

          if (h1 !== undefined && h2 !== undefined) {
            ctx.spawn.shareAoe({
              label: '分摊',
              targets: [h1, h2],
              radius: 5,
              totalDamage: 10000,
              resolveAfterMs: 100,
            });
          }
        } else {
          ctx.spawn.spreadAoe({
            label: '分散',
            targets: ctx.select.alivePlayers(),
            radius: 1,
            damage: 2500,
            resolveAfterMs: 100,
          });
        }
      });

      ctx.timeline.at(round.startAt + 3300, () => {
        ctx.bot.setContext({
          mode: 'idle',
          safeRadius: 5,
        });
      });
    }

    ctx.timeline.at(10_000, () => {
      ctx.state.complete();
    });
  },
  getBotDirective({ snapshot, slot, actor, botContext }) {
    const faceAngle = createFacingTowards(actor.position, snapshot.boss.position);
    const activeShare = snapshot.mechanics.find((mechanic) => mechanic.kind === 'share');
    const activeSpread = snapshot.mechanics.find((mechanic) => mechanic.kind === 'spread');

    if (activeShare !== undefined) {
      const isLeftGroup = LEFT_SHARE_GROUP.includes(slot);
      const anchor = isLeftGroup ? { x: -8, y: 0 } : { x: 8, y: 0 };
      const laneIndex = isLeftGroup
        ? LEFT_SHARE_GROUP.indexOf(slot)
        : RIGHT_SHARE_GROUP.indexOf(slot);
      const offsets = [-1.5, -0.5, 0.5, 1.5];
      const target = {
        x: anchor.x,
        y: anchor.y + (offsets[laneIndex] ?? 0),
      };

      return {
        moveDirection: createMoveDirective(actor.position, target),
        faceAngle,
      };
    }

    if (activeSpread !== undefined) {
      const target = createPointOnRadius(SPREAD_ANGLES[slot], 12);

      return {
        moveDirection: createMoveDirective(actor.position, target),
        faceAngle,
      };
    }

    const safeRadius = botContext?.safeRadius ?? 5;
    const target = createPointOnRadius(SPREAD_ANGLES[slot], safeRadius);

    return {
      moveDirection: createMoveDirective(actor.position, target),
      faceAngle,
    };
  },
};

export const battleDefinitions: BattleDefinition[] = [OPENING_TWO_ROUNDS_BATTLE];

export const battleCatalog: BattleSummary[] = battleDefinitions.map((battle) => ({
  id: battle.id,
  name: battle.name,
}));

export const battleStaticCatalog: BattleStaticData[] = battleDefinitions.map((battle) => ({
  id: battle.id,
  name: battle.name,
  bossName: battle.bossName,
  arenaRadius: battle.arenaRadius,
  bossTargetRingRadius: battle.bossTargetRingRadius,
  defaultPlayerMaxHp: DEFAULT_PLAYER_MAX_HP,
  initialPartyPositions: battle.initialPartyPositions,
}));

export function getBattleDefinition(battleId: string): BattleDefinition | undefined {
  return battleDefinitions.find((battle) => battle.id === battleId);
}

export function getBattleStaticData(battleId: string): BattleStaticData | undefined {
  return battleStaticCatalog.find((battle) => battle.id === battleId);
}

export { INJURY_UP_DURATION_MS, INJURY_UP_MULTIPLIER };
