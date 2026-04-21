import type { PartySlot } from '@ff14arena/shared';

export interface BattleDefinition {
  id: string;
  name: string;
  recommendedSlots: readonly PartySlot[];
}

export const battleCatalog: BattleDefinition[] = [
  {
    id: 'sample-battle',
    name: '示例战斗',
    recommendedSlots: ['MT', 'ST', 'H1', 'H2', 'D1', 'D2', 'D3', 'D4'],
  },
];
