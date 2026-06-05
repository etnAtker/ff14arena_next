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
