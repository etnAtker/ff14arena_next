import type { BattleDefinition } from '@ff14arena/core';
import {
  DEFAULT_PLAYER_MAX_HP,
  INJURY_UP_DURATION_MS,
  INJURY_UP_MULTIPLIER,
} from '@ff14arena/core';
import type { BattleStaticData, BattleSummary } from '@ff14arena/shared';
import {
  TOP_P1_PROGRAM_LOOP_BATTLE,
  TOP_P1_PROGRAM_LOOP_BOT_CONTROLLER,
} from './battles/top-p1-program-loop';
import type { BattleBotController } from './runtime/bot';

export type {
  BattleBotControlFrame,
  BattleBotController,
  BattleBotControllerContext,
} from './runtime/bot';

export const battleDefinitions: BattleDefinition[] = [TOP_P1_PROGRAM_LOOP_BATTLE];

export const battleBotControllers = new Map<string, BattleBotController>([
  [TOP_P1_PROGRAM_LOOP_BATTLE.id, TOP_P1_PROGRAM_LOOP_BOT_CONTROLLER],
]);

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
  mapMarkers: battle.mapMarkers ?? [],
  defaultPlayerMaxHp: DEFAULT_PLAYER_MAX_HP,
  initialPartyPositions: battle.initialPartyPositions,
}));

export function getBattleDefinition(battleId: string): BattleDefinition | undefined {
  return battleDefinitions.find((battle) => battle.id === battleId);
}

export function getBattleStaticData(battleId: string): BattleStaticData | undefined {
  return battleStaticCatalog.find((battle) => battle.id === battleId);
}

export function getBattleBotController(battleId: string): BattleBotController | undefined {
  return battleBotControllers.get(battleId);
}

export { INJURY_UP_DURATION_MS, INJURY_UP_MULTIPLIER };
