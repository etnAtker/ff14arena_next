import type { BaseActorSnapshot, RoomSlotState, RoomSummaryDto } from '@ff14arena/shared';

export type OperationMode = 'traditional' | 'standard';
export type SelectValue = string | number | null;
export type TagType = 'default' | 'primary' | 'info' | 'success' | 'warning' | 'error';

const phaseLabelMap: Record<RoomSummaryDto['phase'], string> = {
  created: '已创建',
  lobby: '大厅中',
  loading: '加载中',
  running: '战斗中',
  finished: '已结算',
  closed: '已关闭',
};

const phaseTagTypeMap: Record<RoomSummaryDto['phase'], TagType> = {
  created: 'default',
  lobby: 'info',
  loading: 'warning',
  running: 'success',
  finished: 'default',
  closed: 'default',
};

export function getRoomPhaseLabel(phase: RoomSummaryDto['phase']): string {
  return phaseLabelMap[phase];
}

export function getRoomPhaseTagType(phase: RoomSummaryDto['phase']): TagType {
  return phaseTagTypeMap[phase];
}

export function getSlotOccupantLabel(occupantType: 'empty' | 'player' | 'bot' | undefined): string {
  switch (occupantType) {
    case 'player':
      return '玩家';
    case 'bot':
      return 'Bot';
    default:
      return '空位';
  }
}

export function getSlotOnlineText(slot: RoomSlotState): string {
  if (slot.occupantType !== 'player') {
    return '-';
  }

  return slot.online ? '在线' : '离线';
}

export function getSlotAliveText(alive: boolean | null | undefined): string {
  return alive === false ? '否' : '是';
}

export function getCooldownSeconds(actor: BaseActorSnapshot, currentTimeMs: number): string {
  return Math.max((actor.knockbackImmuneCooldown.readyAt - currentTimeMs) / 1000, 0).toFixed(1);
}

export function getActorStatuses(actor: BaseActorSnapshot): string {
  return actor.statuses.map((status) => status.name).join('、') || '无';
}
