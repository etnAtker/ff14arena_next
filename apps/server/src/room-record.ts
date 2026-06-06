import type { BattleDefinition, SimulationInstance } from '@ff14arena/core';
import type {
  ActorControlFrame,
  EncounterResult,
  PartySlot,
  RealtimeEncoding,
  RoomPhase,
  RoomRuleOptions,
} from '@ff14arena/shared';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';

export interface PlayerSlotOccupant {
  type: 'player';
  actorId: string;
  userId: string;
  name: string;
  socketId: string | null;
  online: boolean;
  departed: boolean;
}

export interface BotSlotOccupant {
  type: 'bot';
  actorId: string;
  name: string;
}

export type SlotOccupant = PlayerSlotOccupant | BotSlotOccupant;

export interface RoomSpectator {
  userId: string;
  name: string;
  socketId: string | null;
  online: boolean;
}

export interface RoomStartCountdownRecord {
  durationMs: number;
  startedAt: number;
  endsAt: number;
  startTimeMs: number;
}

export interface RoomRecord {
  roomId: string;
  name: string;
  ownerUserId: string;
  ownerName: string;
  options: RoomRuleOptions;
  phase: RoomPhase;
  battleId: string | null;
  battle: BattleDefinition | null;
  slots: Record<PartySlot, SlotOccupant>;
  spectators: Map<string, RoomSpectator>;
  simulation: SimulationInstance | null;
  loopHandle: NodeJS.Timeout | null;
  snapshotBroadcastCounter: number;
  latestResult: EncounterResult | null;
  pendingControlByActorId: Map<string, ActorControlFrame>;
  realtimeEncodingBySocketId: Map<string, RealtimeEncoding>;
  syncId: number;
  startCountdown: RoomStartCountdownRecord | null;
  startCountdownHandle: NodeJS.Timeout | null;
  startCountdownTickHandle: NodeJS.Timeout | null;
}

export function createBotOccupant(roomId: string, slot: PartySlot): BotSlotOccupant {
  return {
    type: 'bot',
    actorId: `${roomId}:bot:${slot}`,
    name: `Bot ${slot}`,
  };
}

export function createFilledBotSlots(roomId: string): Record<PartySlot, SlotOccupant> {
  return Object.fromEntries(
    PARTY_SLOT_ORDER.map((slot) => [slot, createBotOccupant(roomId, slot)]),
  ) as Record<PartySlot, SlotOccupant>;
}
