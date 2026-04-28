import type { PartySlot, RoomPhase } from './base';
import type { EncounterResult } from './simulation';

export interface RoomSlotState {
  slot: PartySlot;
  occupantType: 'empty' | 'player' | 'bot';
  actorId: string | null;
  ownerUserId: string | null;
  name: string | null;
  online: boolean;
  ready: boolean;
  currentHp: number | null;
  alive: boolean | null;
  knockbackImmune: boolean;
}

export interface RoomSpectatorState {
  userId: string;
  name: string;
  online: boolean;
  ready: boolean;
}

export interface RoomStateDto {
  roomId: string;
  name: string;
  ownerUserId: string;
  ownerName: string;
  battleId: string | null;
  battleName: string | null;
  phase: RoomPhase;
  slots: RoomSlotState[];
  spectators: RoomSpectatorState[];
  latestResult: EncounterResult | null;
}

export interface RoomSummaryDto {
  roomId: string;
  name: string;
  battleId: string | null;
  battleName: string | null;
  phase: RoomPhase;
  occupantCount: number;
}
