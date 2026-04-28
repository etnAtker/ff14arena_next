export const PARTY_SLOT_ORDER = ['MT', 'ST', 'H1', 'H2', 'D1', 'D2', 'D3', 'D4'] as const;

export type PartySlot = (typeof PARTY_SLOT_ORDER)[number];

export const ROOM_PHASES = ['waiting', 'running', 'closed'] as const;
export type RoomPhase = (typeof ROOM_PHASES)[number];

export const ROOM_RUNTIME_PHASES = ['waiting', 'running'] as const;
export type RoomRuntimePhase = (typeof ROOM_RUNTIME_PHASES)[number];

export interface Vector2 {
  x: number;
  y: number;
}

export type MapMarkerLabel = 'A' | 'B' | 'C' | 'D' | '1' | '2' | '3' | '4';
export type MapMarkerShape = 'circle' | 'square';

export interface MapMarker {
  label: MapMarkerLabel;
  shape: MapMarkerShape;
  position: Vector2;
  color: string;
  radius?: number;
  size?: number;
}
