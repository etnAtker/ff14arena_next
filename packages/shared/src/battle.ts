import type { MapMarker, PartySlot, Vector2 } from './base';
import type { StatusId } from './simulation';

export interface BattleStartTimeOptions {
  minMs: number;
  maxMs: number;
  stepMs: number;
  defaultMs: number;
  presets?: BattleStartTimePreset[];
}

export interface BattleStartTimePreset {
  label: string;
  timeMs: number;
}

export interface BooleanBattleRoomOptionDefinition {
  key: string;
  type: 'boolean';
  title: string;
  description: string;
  defaultValue: boolean;
}

export type BattleRoomOptionDefinition = BooleanBattleRoomOptionDefinition;

export interface BattleSummary {
  id: string;
  name: string;
  startTimeOptions?: BattleStartTimeOptions;
  roomOptions?: BattleRoomOptionDefinition[];
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

export interface BattleArenaBackground {
  imageUrl: string;
  center: Vector2;
  width: number;
  height: number;
  opacity?: number;
}

export interface BattleStaticData {
  id: string;
  name: string;
  bossName: string;
  arenaRadius: number;
  bossTargetRingRadius: number;
  arenaBackground?: BattleArenaBackground;
  mapMarkers: MapMarker[];
  statusMetadata: StatusMetadata[];
  defaultPlayerMaxHp: number;
  startTimeOptions?: BattleStartTimeOptions;
  roomOptions?: BattleRoomOptionDefinition[];
  initialPartyPositions: Record<
    PartySlot,
    {
      position: Vector2;
      facing: number;
    }
  >;
}
