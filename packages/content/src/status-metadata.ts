import type { StatusId, StatusMetadata } from '@ff14arena/shared';
import statusXivapiMap from '../status-xivapi-map.json';
import { statusMetadataCatalog } from './generated/status-metadata';

interface StatusXivapiMap {
  globalStatusIds: StatusId[];
  battleStatusIds: Record<string, StatusId[]>;
  statusXivapiIds: Record<StatusId, number>;
}

const statusConfig = statusXivapiMap as StatusXivapiMap;

export const globalStatusIds = statusConfig.globalStatusIds;
export const battleStatusIds = statusConfig.battleStatusIds;
export const statusXivapiIds = statusConfig.statusXivapiIds;
const manualStatusMetadataById: Record<string, StatusMetadata> = {
  kefka_p3_second_first_target: {
    id: 'kefka_p3_second_first_target',
    name: '第一目标',
    description: '被选为了第一目标',
    xivapiStatusId: 3004,
    iconId: 215401,
    iconPath: 'ui/icon/215000/215401.tex',
    iconUrl: '/status-icons/215401.png',
    fallbackText: '第一',
    partyListPriority: 250,
  },
  kefka_p3_second_second_target: {
    id: 'kefka_p3_second_second_target',
    name: '第二目标',
    description: '被选为了第二目标',
    xivapiStatusId: 3005,
    iconId: 215402,
    iconPath: 'ui/icon/215000/215402.tex',
    iconUrl: '/status-icons/215402.png',
    fallbackText: '第二',
    partyListPriority: 250,
  },
  kefka_p3_second_third_target: {
    id: 'kefka_p3_second_third_target',
    name: '第三目标',
    description: '被选为了第三目标',
    xivapiStatusId: 3006,
    iconId: 215403,
    iconPath: 'ui/icon/215000/215403.tex',
    iconUrl: '/status-icons/215403.png',
    fallbackText: '第三',
    partyListPriority: 250,
  },
  kefka_p3_second_chaos_earth: {
    id: 'kefka_p3_second_chaos_earth',
    name: '混沌之土',
    description: '受到即将导致死亡的伤害时不死，并对其他玩家造成延迟伤害',
    xivapiStatusId: 5454,
    iconId: 215907,
    iconPath: 'ui/icon/215000/215907.tex',
    iconUrl: '/status-icons/215907.png',
    fallbackText: '土',
    partyListPriority: 220,
  },
  kefka_p3_second_void_erosion_1: {
    id: 'kefka_p3_second_void_erosion_1',
    name: '无之侵蚀',
    description: '再次受到黑洞射线时会替换为无之腐蚀',
    xivapiStatusId: 5452,
    iconId: 217398,
    iconPath: 'ui/icon/217000/217398.tex',
    iconUrl: '/status-icons/217398.png',
    fallbackText: '侵蚀',
    partyListPriority: 200,
  },
  kefka_p3_second_void_erosion_2: {
    id: 'kefka_p3_second_void_erosion_2',
    name: '无之侵蚀',
    description: '旧版二层无之侵蚀状态，当前机制不再赋予',
    xivapiStatusId: 5452,
    iconId: 217399,
    iconPath: 'ui/icon/217000/217399.tex',
    iconUrl: '/status-icons/217399.png',
    fallbackText: '侵蚀',
    partyListPriority: 200,
  },
  kefka_p3_second_void_corrosion: {
    id: 'kefka_p3_second_void_corrosion',
    name: '无之腐蚀',
    description: '再次受到黑洞射线时会死亡',
    xivapiStatusId: 5453,
    iconId: 214413,
    iconPath: 'ui/icon/214000/214413.tex',
    iconUrl: '/status-icons/214413.png',
    fallbackText: '腐蚀',
    partyListPriority: 210,
  },
  kefka_p4_curse_howl: {
    id: 'kefka_p4_curse_howl',
    name: '诅咒之嚎',
    description: '效果结束时发动面向判定',
    xivapiStatusId: 5543,
    iconId: 215588,
    iconPath: 'ui/icon/215000/215588.tex',
    iconUrl: '/status-icons/215588.png',
    fallbackText: '嚎',
    partyListPriority: 240,
  },
  kefka_p4_forked_lightning: {
    id: 'kefka_p4_forked_lightning',
    name: '叉形闪电',
    description: '效果结束时发动雷属性范围或分摊',
    xivapiStatusId: 5544,
    iconId: 215623,
    iconPath: 'ui/icon/215000/215623.tex',
    iconUrl: '/status-icons/215623.png',
    fallbackText: '雷',
    partyListPriority: 230,
  },
  kefka_p4_compressed_water: {
    id: 'kefka_p4_compressed_water',
    name: '水属性压缩',
    description: '效果结束时发动水属性分摊或环形范围',
    xivapiStatusId: 5545,
    iconId: 215696,
    iconPath: 'ui/icon/215000/215696.tex',
    iconUrl: '/status-icons/215696.png',
    fallbackText: '水',
    partyListPriority: 230,
  },
  kefka_p4_acceleration_bomb: {
    id: 'kefka_p4_acceleration_bomb',
    name: '加速度炸弹',
    description: '效果结束后检查玩家是否移动',
    xivapiStatusId: 5546,
    iconId: 215727,
    iconPath: 'ui/icon/215000/215727.tex',
    iconUrl: '/status-icons/215727.png',
    fallbackText: '停',
    partyListPriority: 235,
  },
  kefka_p4_allagan_field: {
    id: 'kefka_p4_allagan_field',
    name: '亚拉戈领域',
    description: '记录错误暗黑光或抵挡致死伤害',
    xivapiStatusId: 454,
    iconId: 215590,
    iconPath: 'ui/icon/215000/215590.tex',
    iconUrl: '/status-icons/215590.png',
    fallbackText: '领',
    partyListPriority: 260,
  },
  kefka_p4_beyond_death: {
    id: 'kefka_p4_beyond_death',
    name: '超越死亡',
    description: '抵挡致死伤害或记录错误暗黑光',
    xivapiStatusId: 5464,
    iconId: 215780,
    iconPath: 'ui/icon/215000/215780.tex',
    iconUrl: '/status-icons/215780.png',
    fallbackText: '超',
    partyListPriority: 260,
  },
  kefka_p4_living_wound: {
    id: 'kefka_p4_living_wound',
    name: '生者之伤',
    description: '受到错误的暗黑光时死亡并移除',
    xivapiStatusId: 4887,
    iconId: 215782,
    iconPath: 'ui/icon/215000/215782.tex',
    iconUrl: '/status-icons/215782.png',
    fallbackText: '生',
    partyListPriority: 250,
  },
  kefka_p4_dead_wound: {
    id: 'kefka_p4_dead_wound',
    name: '死者之伤',
    description: '受到错误的暗黑光时死亡并移除',
    xivapiStatusId: 4888,
    iconId: 215783,
    iconPath: 'ui/icon/215000/215783.tex',
    iconUrl: '/status-icons/215783.png',
    fallbackText: '死',
    partyListPriority: 250,
  },
  kefka_p4_chaos_fire: {
    id: 'kefka_p4_chaos_fire',
    name: '混沌之炎',
    description: '效果结束时发动圆形或环形火属性范围',
    xivapiStatusId: 5547,
    iconId: 215902,
    iconPath: 'ui/icon/215000/215902.tex',
    iconUrl: '/status-icons/215902.png',
    fallbackText: '炎',
    partyListPriority: 225,
  },
  kefka_p4_chaos_water: {
    id: 'kefka_p4_chaos_water',
    name: '混沌之水',
    description: '效果结束时发动环形或圆形水属性范围',
    xivapiStatusId: 5548,
    iconId: 215903,
    iconPath: 'ui/icon/215000/215903.tex',
    iconUrl: '/status-icons/215903.png',
    fallbackText: '水',
    partyListPriority: 225,
  },
  kefka_p5_extra_nuclear_blast: {
    id: 'kefka_p5_extra_nuclear_blast',
    name: '顺手加个核爆',
    description: '效果结束时以自身为中心发动大范围攻击',
    xivapiStatusId: 5350,
    iconId: 214408,
    iconPath: 'ui/icon/214000/214408.tex',
    iconUrl: '/status-icons/214408.png',
    fallbackText: '核爆',
    partyListPriority: 200,
  },
  kefka_p5_extra_holy: {
    id: 'kefka_p5_extra_holy',
    name: '顺手加个神圣',
    description: '效果结束时需要至少4人分摊',
    xivapiStatusId: 5351,
    iconId: 214409,
    iconPath: 'ui/icon/214000/214409.tex',
    iconUrl: '/status-icons/214409.png',
    fallbackText: '神圣',
    partyListPriority: 200,
  },
};
const statusMetadataById: Record<string, StatusMetadata> = {
  ...statusMetadataCatalog,
  ...manualStatusMetadataById,
};

export function getStatusMetadata(statusId: StatusId): StatusMetadata | undefined {
  return statusMetadataById[statusId];
}

export function getStatusDisplayName(statusId: StatusId, fallbackName?: string): string {
  return getStatusMetadata(statusId)?.name ?? fallbackName ?? statusId;
}

export function getBattleStatusMetadata(battleId: string): StatusMetadata[] {
  const statusIds = [...globalStatusIds, ...(battleStatusIds[battleId] ?? [])];
  const metadata: StatusMetadata[] = [];
  const seenStatusIds = new Set<StatusId>();

  for (const statusId of statusIds) {
    if (seenStatusIds.has(statusId)) {
      continue;
    }

    seenStatusIds.add(statusId);
    const status = getStatusMetadata(statusId);

    if (status !== undefined) {
      metadata.push(status);
    }
  }

  return metadata;
}
