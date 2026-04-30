import type {
  BaseActorSnapshot,
  CooldownState,
  RoomSlotState,
  RoomSummaryDto,
} from '@ff14arena/shared';

export type OperationMode = 'traditional' | 'standard';
export type SelectValue = string | number | null;
export type TagType = 'default' | 'primary' | 'info' | 'success' | 'warning' | 'error';
export type PartyRole = 'tank' | 'healer' | 'dps';

const phaseLabelMap: Record<RoomSummaryDto['phase'], string> = {
  waiting: '待开始',
  running: '战斗中',
  closed: '已关闭',
};

const phaseTagTypeMap: Record<RoomSummaryDto['phase'], TagType> = {
  waiting: 'info',
  running: 'success',
  closed: 'default',
};

const slotRoleMap: Record<NonNullable<RoomSlotState['slot']>, PartyRole> = {
  MT: 'tank',
  ST: 'tank',
  H1: 'healer',
  H2: 'healer',
  D1: 'dps',
  D2: 'dps',
  D3: 'dps',
  D4: 'dps',
};

const slotStageTextMap: Record<NonNullable<RoomSlotState['slot']>, string> = {
  MT: 'M',
  ST: 'S',
  H1: '1',
  H2: '2',
  D1: '1',
  D2: '2',
  D3: '3',
  D4: '4',
};

const roleColorMap: Record<PartyRole, string> = {
  tank: '#4d8dff',
  healer: '#3fbf72',
  dps: '#d54c4c',
};

const roleCardBackgroundMap: Record<PartyRole, string> = {
  tank: 'linear-gradient(135deg, rgba(53, 101, 188, 0.82), rgba(21, 32, 54, 0.95))',
  healer: 'linear-gradient(135deg, rgba(41, 132, 82, 0.82), rgba(20, 45, 31, 0.95))',
  dps: 'linear-gradient(135deg, rgba(153, 48, 48, 0.82), rgba(56, 18, 18, 0.95))',
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

export function getCooldownRemainingMs(cooldown: CooldownState, currentTimeMs: number): number {
  return Math.max(cooldown.readyAt - currentTimeMs, 0);
}

export function isCooldownReady(cooldown: CooldownState, currentTimeMs: number): boolean {
  return getCooldownRemainingMs(cooldown, currentTimeMs) <= 0;
}

export function formatCooldownSeconds(cooldown: CooldownState, currentTimeMs: number): string {
  return (getCooldownRemainingMs(cooldown, currentTimeMs) / 1000).toFixed(1);
}

export function formatSkillCooldownLabel(options: {
  label: string;
  hotkey: string;
  cooldown: CooldownState;
  currentTimeMs: number;
}): string {
  if (isCooldownReady(options.cooldown, options.currentTimeMs)) {
    return `${options.label}（${options.hotkey}）`;
  }

  return `${options.label} ${formatCooldownSeconds(options.cooldown, options.currentTimeMs)}s`;
}

export function getCooldownSeconds(actor: BaseActorSnapshot, currentTimeMs: number): string {
  return formatCooldownSeconds(actor.knockbackImmuneCooldown, currentTimeMs);
}

export function getActorStatuses(actor: BaseActorSnapshot): string {
  return actor.statuses.map((status) => status.name).join('、') || '无';
}

export function getSlotRole(slot: RoomSlotState['slot']): PartyRole {
  return slotRoleMap[slot];
}

export function getSlotStageText(slot: RoomSlotState['slot']): string {
  return slotStageTextMap[slot];
}

export function getRoleColor(role: PartyRole): string {
  return roleColorMap[role];
}

export function getSlotColor(slot: RoomSlotState['slot'], isSelf = false): string {
  if (isSelf) {
    return '#8b5cf6';
  }

  return getRoleColor(getSlotRole(slot));
}

export function getSlotCardBackground(slot: RoomSlotState['slot'], isSelf = false): string {
  if (isSelf) {
    return 'linear-gradient(135deg, rgba(120, 72, 194, 0.9), rgba(42, 24, 72, 0.96))';
  }

  return roleCardBackgroundMap[getSlotRole(slot)];
}
