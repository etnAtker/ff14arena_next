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
import { EDEN_P4_SPECIAL_BATTLE, EDEN_P4_SPECIAL_BOT_CONTROLLER } from './battles/eden-p4-special';
import {
  KEFKA_P2_FIRST_FORSAKEN_BATTLE,
  KEFKA_P2_FIRST_FORSAKEN_BOT_CONTROLLER,
} from './battles/kefka-p2-first-forsaken';
import { KEFKA_P3_FIRST_TRICK_BATTLE } from './battles/kefka-p3-first-trick';
import { KEFKA_P3_SECOND_TRICK_BATTLE } from './battles/kefka-p3-second-trick';
import { KEFKA_P4_FIRST_TRICK_BATTLE } from './battles/kefka-p4-first-trick';
import { KEFKA_P5_FULL_BATTLE, KEFKA_P5_FULL_BOT_CONTROLLER } from './battles/kefka-p5-full';
import type { BattleBotController } from './runtime/bot';
import { getBattleStatusMetadata } from './status-metadata';

export type {
  BattleBotControlFrame,
  BattleBotController,
  BattleBotControllerContext,
} from './runtime/bot';

export const battleDefinitions: BattleDefinition[] = [
  TOP_P1_PROGRAM_LOOP_BATTLE,
  EDEN_P4_SPECIAL_BATTLE,
  KEFKA_P2_FIRST_FORSAKEN_BATTLE,
  KEFKA_P3_FIRST_TRICK_BATTLE,
  KEFKA_P3_SECOND_TRICK_BATTLE,
  KEFKA_P4_FIRST_TRICK_BATTLE,
  KEFKA_P5_FULL_BATTLE,
];

export const battleBotControllers = new Map<string, BattleBotController>([
  [TOP_P1_PROGRAM_LOOP_BATTLE.id, TOP_P1_PROGRAM_LOOP_BOT_CONTROLLER],
  [EDEN_P4_SPECIAL_BATTLE.id, EDEN_P4_SPECIAL_BOT_CONTROLLER],
  [KEFKA_P2_FIRST_FORSAKEN_BATTLE.id, KEFKA_P2_FIRST_FORSAKEN_BOT_CONTROLLER],
  [KEFKA_P5_FULL_BATTLE.id, KEFKA_P5_FULL_BOT_CONTROLLER],
]);

export const battleCatalog: BattleSummary[] = battleDefinitions.map((battle) => ({
  id: battle.id,
  name: battle.name,
  ...(battle.startTimeOptions === undefined ? {} : { startTimeOptions: battle.startTimeOptions }),
  ...(battle.roomOptions === undefined ? {} : { roomOptions: battle.roomOptions }),
}));

export const battleStaticCatalog: BattleStaticData[] = battleDefinitions.map((battle) => ({
  id: battle.id,
  name: battle.name,
  bossName: battle.bossName,
  arenaRadius: battle.arenaRadius,
  bossTargetRingRadius: battle.bossTargetRingRadius,
  ...(battle.arenaBackground === undefined ? {} : { arenaBackground: battle.arenaBackground }),
  mapMarkers: battle.mapMarkers ?? [],
  statusMetadata: getBattleStatusMetadata(battle.id),
  defaultPlayerMaxHp: DEFAULT_PLAYER_MAX_HP,
  ...(battle.startTimeOptions === undefined ? {} : { startTimeOptions: battle.startTimeOptions }),
  ...(battle.roomOptions === undefined ? {} : { roomOptions: battle.roomOptions }),
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
export {
  getBattleStatusMetadata,
  getStatusDisplayName,
  getStatusMetadata,
} from './status-metadata';
