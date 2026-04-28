import type { MapMarker, PartySlot, Vector2 } from './base';

export interface BattleSummary {
  id: string;
  name: string;
}

export interface BattleStaticData {
  id: string;
  name: string;
  bossName: string;
  arenaRadius: number;
  bossTargetRingRadius: number;
  mapMarkers: MapMarker[];
  defaultPlayerMaxHp: number;
  initialPartyPositions: Record<
    PartySlot,
    {
      position: Vector2;
      facing: number;
    }
  >;
}
