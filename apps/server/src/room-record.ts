import type { BattleDefinition, SimulationInstance } from '@ff14arena/core';
import type { ActorControlFrame, EncounterResult, PartySlot, RoomPhase } from '@ff14arena/shared';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';

export interface PlayerSlotOccupant {
  type: 'player';
  actorId: string;
  userId: string;
  name: string;
  socketId: string | null;
  online: boolean;
  ready: boolean;
  departed: boolean;
}

export interface BotSlotOccupant {
  type: 'bot';
  actorId: string;
  name: string;
  ready: true;
}

export type SlotOccupant = PlayerSlotOccupant | BotSlotOccupant;

export interface RoomSpectator {
  userId: string;
  name: string;
  socketId: string | null;
  online: boolean;
  ready: boolean;
}

export interface RoomRecord {
  roomId: string;
  name: string;
  ownerUserId: string;
  ownerName: string;
  phase: RoomPhase;
  battleId: string | null;
  battle: BattleDefinition | null;
  slots: Record<PartySlot, SlotOccupant>;
  spectators: Map<string, RoomSpectator>;
  simulation: SimulationInstance | null;
  loopHandle: NodeJS.Timeout | null;
  snapshotBroadcastCounter: number;
  latestResult: EncounterResult | null;
  inputSeqByActorId: Map<string, number>;
  lastPoseSeqByActorId: Map<string, number>;
  pendingControlByActorId: Map<string, ActorControlFrame>;
  syncId: number;
}

export function createBotOccupant(roomId: string, slot: PartySlot): BotSlotOccupant {
  return {
    type: 'bot',
    actorId: `${roomId}:bot:${slot}`,
    name: `Bot ${slot}`,
    ready: true,
  };
}

export function createFilledBotSlots(roomId: string): Record<PartySlot, SlotOccupant> {
  return Object.fromEntries(
    PARTY_SLOT_ORDER.map((slot) => [slot, createBotOccupant(roomId, slot)]),
  ) as Record<PartySlot, SlotOccupant>;
}
