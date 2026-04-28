import { DEFAULT_PLAYER_MAX_HP } from '@ff14arena/core';
import type { PartyMemberBlueprint } from '@ff14arena/core';
import type {
  PartySlot,
  RoomSlotState,
  RoomSpectatorState,
  RoomStateDto,
  RoomSummaryDto,
} from '@ff14arena/shared';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import type { RoomMetricDescriptor } from './metrics';
import type { RoomRecord } from './room-record';

export function createRoomSummary(room: RoomRecord): RoomSummaryDto {
  return {
    roomId: room.roomId,
    name: room.name,
    battleId: room.battleId,
    battleName: room.battle?.name ?? null,
    phase: room.phase,
    occupantCount:
      Object.values(room.slots).filter((slot) => slot.type === 'player').length +
      room.spectators.size,
  };
}

export function createRoomMetricDescriptor(room: RoomRecord): RoomMetricDescriptor {
  const snapshot = room.simulation?.getSnapshot();
  const slotOccupants = Object.values(room.slots);
  const playerSlots = slotOccupants.filter((slot) => slot.type === 'player');
  const botSlots = slotOccupants.filter((slot) => slot.type === 'bot');
  const spectators = [...room.spectators.values()];

  return {
    roomId: room.roomId,
    name: room.name,
    battleName: room.battle?.name ?? null,
    phase: room.phase,
    playerCount: playerSlots.length + spectators.length,
    onlinePlayerCount:
      playerSlots.filter((slot) => slot.online).length +
      spectators.filter((spectator) => spectator.online).length,
    botCount: botSlots.length,
    activeSimulation: room.simulation !== null && room.loopHandle !== null,
    tick: snapshot?.tick ?? null,
    timeMs: snapshot?.timeMs ?? null,
    syncId: room.syncId,
    latestResultPresent: room.latestResult !== null || snapshot?.latestResult !== null,
    failureReasonCount:
      snapshot?.failureReasons.length ?? room.latestResult?.failureReasons.length ?? 0,
  };
}

export function createRoomState(room: RoomRecord): RoomStateDto {
  return {
    roomId: room.roomId,
    name: room.name,
    ownerUserId: room.ownerUserId,
    ownerName: room.ownerName,
    battleId: room.battleId,
    battleName: room.battle?.name ?? null,
    phase: room.phase,
    slots: createRoomSlots(room),
    spectators: createRoomSpectators(room),
    latestResult: room.latestResult,
  };
}

export function createRoomSpectators(room: RoomRecord): RoomSpectatorState[] {
  return [...room.spectators.values()].map((spectator) => ({
    userId: spectator.userId,
    name: spectator.name,
    online: spectator.online,
    ready: spectator.ready,
  }));
}

export function createRoomSlots(room: RoomRecord): RoomSlotState[] {
  const snapshot = room.simulation?.getSnapshot();
  const actorById = new Map(snapshot?.actors.map((actor) => [actor.id, actor]) ?? []);

  return PARTY_SLOT_ORDER.map((slot) => {
    const occupant = room.slots[slot];
    const actor = actorById.get(occupant.actorId);

    if (occupant.type === 'bot') {
      return {
        slot,
        occupantType: 'bot',
        actorId: occupant.actorId,
        ownerUserId: null,
        name: occupant.name,
        online: true,
        ready: true,
        currentHp: actor?.currentHp ?? DEFAULT_PLAYER_MAX_HP,
        alive: actor?.alive ?? true,
        knockbackImmune: actor?.knockbackImmune ?? false,
      };
    }

    return {
      slot,
      occupantType: 'player',
      actorId: occupant.actorId,
      ownerUserId: occupant.userId,
      name: occupant.name,
      online: occupant.online,
      ready: occupant.ready,
      currentHp: actor?.currentHp ?? DEFAULT_PLAYER_MAX_HP,
      alive: actor?.alive ?? true,
      knockbackImmune: actor?.knockbackImmune ?? false,
    };
  });
}

export function buildPartyBlueprint(room: RoomRecord): PartyMemberBlueprint[] {
  return PARTY_SLOT_ORDER.map((slot: PartySlot) => {
    const occupant = room.slots[slot];

    if (occupant.type === 'bot') {
      return {
        slot,
        name: occupant.name,
        kind: 'bot',
        actorId: occupant.actorId,
        online: true,
        ready: true,
      };
    }

    return {
      slot,
      name: occupant.name,
      kind: 'player',
      actorId: occupant.actorId,
      ownerUserId: occupant.userId,
      online: occupant.online,
      ready: occupant.ready,
    };
  });
}
