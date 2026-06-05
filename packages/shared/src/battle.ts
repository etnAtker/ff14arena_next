import type { MapMarker, PartySlot, Vector2 } from './base';
import type { StatusId } from './simulation';

export interface BattleStartTimeOptions {
  minMs: number;
  maxMs: number;
  stepMs: number;
  defaultMs: number;
}

export interface BattleSummary {
  id: string;
  name: string;
  startTimeOptions?: BattleStartTimeOptions;
}

export interface StatusMetadata {
  id: StatusId;
  name: string;
  description: string;
  xivapiStatusId: number;
  iconId: number;
  iconPath: string;
  iconUrl: string;
  fallbackText: string;
  partyListPriority: number;
}

export interface BattleStaticData {
  id: string;
  name: string;
  bossName: string;
  arenaRadius: number;
  bossTargetRingRadius: number;
  mapMarkers: MapMarker[];
  statusMetadata: StatusMetadata[];
  defaultPlayerMaxHp: number;
  startTimeOptions?: BattleStartTimeOptions;
  initialPartyPositions: Record<
    PartySlot,
    {
      position: Vector2;
      facing: number;
    }
  >;
}
