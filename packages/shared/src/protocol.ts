import type { PartySlot } from './base';
import type { RoomSlotState, RoomStateDto } from './room';
import type {
  ContinuousSimulationInputFrame,
  EncounterResult,
  SimulationSnapshot,
  UseKnockbackImmuneSimulationInput,
  UseSprintSimulationInput,
} from './simulation';
import type { SimulationEvent } from './events';

export interface RoomJoinPayload {
  roomId: string;
  userId: string;
  slot?: PartySlot;
  userName?: string;
}

export interface RoomLeavePayload {
  roomId: string;
}

export interface RoomReadyPayload {
  roomId: string;
  ready: boolean;
}

export interface RoomSelectBattlePayload {
  roomId: string;
  battleId: string;
}

export interface RoomSwitchSlotPayload {
  roomId: string;
  targetSlot: PartySlot;
}

export interface RoomSpectatePayload {
  roomId: string;
}

export interface RoomStartPayload {
  roomId: string;
}

export interface RoomStatePayload {
  room: RoomStateDto;
}

export interface RoomSlotsPayload {
  roomId: string;
  slots: RoomSlotState[];
}

export interface SimStartPayload {
  roomId: string;
  syncId: number;
  snapshot: SimulationSnapshot;
}

export interface SimSnapshotPayload {
  roomId: string;
  syncId: number;
  snapshot: SimulationSnapshot;
  reason: 'join' | 'rejoin' | 'resync' | 'waiting-state' | 'tick' | 'battle-end' | 'battle-start';
}

export interface SimEventsPayload {
  roomId: string;
  syncId: number;
  events: SimulationEvent[];
}

export interface SimEndPayload {
  roomId: string;
  latestResult: EncounterResult;
}

export interface RoomClosedPayload {
  roomId: string;
  reason: string;
}

export interface SimResyncRequestPayload {
  roomId: string;
  reason?: string;
}

export interface ServerErrorPayload {
  code: string;
  message: string;
}

export interface ServerToClientEvents {
  'room:state': (payload: RoomStatePayload) => void;
  'room:slots': (payload: RoomSlotsPayload) => void;
  'sim:start': (payload: SimStartPayload) => void;
  'sim:snapshot': (payload: SimSnapshotPayload) => void;
  'sim:events': (payload: SimEventsPayload) => void;
  'sim:end': (payload: SimEndPayload) => void;
  'room:closed': (payload: RoomClosedPayload) => void;
  'server:error': (payload: ServerErrorPayload) => void;
}

export interface ClientToServerEvents {
  'room:join': (payload: RoomJoinPayload) => void;
  'room:leave': (payload: RoomLeavePayload) => void;
  'room:ready': (payload: RoomReadyPayload) => void;
  'room:select-battle': (payload: RoomSelectBattlePayload) => void;
  'room:switch-slot': (payload: RoomSwitchSlotPayload) => void;
  'room:spectate': (payload: RoomSpectatePayload) => void;
  'room:start': (payload: RoomStartPayload) => void;
  'sim:input-frame': (payload: ContinuousSimulationInputFrame) => void;
  'sim:use-knockback-immune': (payload: UseKnockbackImmuneSimulationInput) => void;
  'sim:use-sprint': (payload: UseSprintSimulationInput) => void;
  'sim:request-resync': (payload: SimResyncRequestPayload) => void;
}
