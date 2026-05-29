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
const statusMetadataById: Record<string, StatusMetadata> = statusMetadataCatalog;

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
