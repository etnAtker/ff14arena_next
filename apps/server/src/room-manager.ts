import { getBattleDefinition } from '@ff14arena/content';
import { createSimulation, FIXED_TICK_MS } from '@ff14arena/core';
import type { BattleDefinition, PartyMemberBlueprint, SimulationInstance } from '@ff14arena/core';
import type { Server as SocketServer, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  EncounterResult,
  PartySlot,
  RoomPhase,
  RoomSlotState,
  RoomStateDto,
  RoomSummaryDto,
  ServerToClientEvents,
  SimulationInput,
} from '@ff14arena/shared';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedIo = SocketServer<ClientToServerEvents, ServerToClientEvents>;

interface EmptySlotOccupant {
  type: 'empty';
}

interface PlayerSlotOccupant {
  type: 'player';
  actorId: string;
  userId: string;
  name: string;
  socketId: string | null;
  online: boolean;
  ready: boolean;
}

interface BotSlotOccupant {
  type: 'bot';
  actorId: string;
  name: string;
  ready: true;
}

type SlotOccupant = EmptySlotOccupant | PlayerSlotOccupant | BotSlotOccupant;

interface RoomRecord {
  roomId: string;
  name: string;
  ownerUserId: string;
  ownerName: string;
  phase: RoomPhase;
  battleId: string | null;
  slots: Record<PartySlot, SlotOccupant>;
  simulation: SimulationInstance | null;
  battle: BattleDefinition | null;
  loopHandle: NodeJS.Timeout | null;
  snapshotBroadcastCounter: number;
  result: EncounterResult | null;
  inputSeqByActorId: Map<string, number>;
}

function createEmptySlots(): Record<PartySlot, SlotOccupant> {
  return Object.fromEntries(
    PARTY_SLOT_ORDER.map((slot) => [slot, { type: 'empty' satisfies SlotOccupant['type'] }]),
  ) as Record<PartySlot, SlotOccupant>;
}

export class RoomManager {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly userRooms = new Map<string, string>();
  private roomCounter = 0;

  constructor(private readonly io: TypedIo) {}

  listRooms(): RoomSummaryDto[] {
    return [...this.rooms.values()].map((room) => ({
      roomId: room.roomId,
      name: room.name,
      battleId: room.battleId,
      battleName: room.battle?.name ?? null,
      phase: room.phase,
      occupantCount: Object.values(room.slots).filter((slot) => slot.type !== 'empty').length,
    }));
  }

  createRoom(options: {
    name: string;
    ownerUserId: string;
    ownerName: string;
    battleId?: string;
  }): RoomStateDto {
    const roomId = `room_${String(++this.roomCounter).padStart(4, '0')}`;
    const battle =
      options.battleId === undefined ? null : (getBattleDefinition(options.battleId) ?? null);

    const room: RoomRecord = {
      roomId,
      name: options.name,
      ownerUserId: options.ownerUserId,
      ownerName: options.ownerName,
      phase: 'created',
      battleId: battle?.id ?? null,
      slots: createEmptySlots(),
      simulation: null,
      battle,
      loopHandle: null,
      snapshotBroadcastCounter: 0,
      result: null,
      inputSeqByActorId: new Map(),
    };

    room.phase = 'lobby';
    this.rooms.set(roomId, room);
    return this.toRoomState(room);
  }

  getRoom(roomId: string): RoomRecord | undefined {
    return this.rooms.get(roomId);
  }

  toRoomState(room: RoomRecord): RoomStateDto {
    return {
      roomId: room.roomId,
      name: room.name,
      ownerUserId: room.ownerUserId,
      ownerName: room.ownerName,
      battleId: room.battleId,
      battleName: room.battle?.name ?? null,
      phase: room.phase,
      slots: this.toRoomSlots(room),
      result: room.result,
    };
  }

  toRoomSlots(room: RoomRecord): RoomSlotState[] {
    const snapshot = room.simulation?.getSnapshot();

    return PARTY_SLOT_ORDER.map((slot) => {
      const occupant = room.slots[slot];
      const actor = snapshot?.actors.find((candidate) => candidate.slot === slot);

      if (occupant.type === 'empty') {
        return {
          slot,
          occupantType: 'empty',
          actorId: null,
          ownerUserId: null,
          name: null,
          online: false,
          ready: false,
          currentHp: null,
          alive: null,
          knockbackImmune: false,
        };
      }

      if (occupant.type === 'bot') {
        return {
          slot,
          occupantType: 'bot',
          actorId: occupant.actorId,
          ownerUserId: null,
          name: occupant.name,
          online: true,
          ready: true,
          currentHp: actor?.currentHp ?? null,
          alive: actor?.alive ?? null,
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
        currentHp: actor?.currentHp ?? null,
        alive: actor?.alive ?? null,
        knockbackImmune: actor?.knockbackImmune ?? false,
      };
    });
  }

  joinRoom(
    socket: TypedSocket,
    payload: { roomId: string; userId: string; userName?: string; slot?: PartySlot },
  ): void {
    const room = this.rooms.get(payload.roomId);

    if (room === undefined) {
      this.emitError(socket, 'room_not_found', '房间不存在');
      return;
    }

    const userName = payload.userName?.trim() || `玩家-${payload.userId.slice(-4)}`;
    const existingRoomId = this.userRooms.get(payload.userId);

    if (existingRoomId !== undefined && existingRoomId !== room.roomId) {
      this.emitError(socket, 'already_in_other_room', '当前用户已在其他房间');
      return;
    }

    const currentSlot = this.findPlayerSlot(room, payload.userId);

    if (currentSlot !== undefined) {
      const occupant = room.slots[currentSlot] as PlayerSlotOccupant;
      occupant.socketId = socket.id;
      occupant.online = true;
      occupant.name = userName;
      socket.join(room.roomId);
      this.userRooms.set(payload.userId, room.roomId);
      socket.emit('room:state', { room: this.toRoomState(room) });
      this.io.to(room.roomId).emit('room:slots', {
        roomId: room.roomId,
        slots: this.toRoomSlots(room),
      });
      return;
    }

    if (room.phase !== 'lobby' && room.phase !== 'created') {
      this.emitError(socket, 'room_not_joinable', '当前房间不可加入');
      return;
    }

    const targetSlot = payload.slot ?? this.findFirstEmptySlot(room);

    if (targetSlot === undefined) {
      this.emitError(socket, 'room_full', '房间已满');
      return;
    }

    if (room.slots[targetSlot].type !== 'empty') {
      this.emitError(socket, 'slot_occupied', '目标槽位已被占用');
      return;
    }

    room.slots[targetSlot] = {
      type: 'player',
      actorId: `${room.roomId}:${targetSlot}`,
      userId: payload.userId,
      name: userName,
      socketId: socket.id,
      online: true,
      ready: payload.userId === room.ownerUserId,
    };
    this.userRooms.set(payload.userId, room.roomId);
    socket.join(room.roomId);
    socket.emit('room:state', { room: this.toRoomState(room) });
    this.io.to(room.roomId).emit('room:slots', {
      roomId: room.roomId,
      slots: this.toRoomSlots(room),
    });
  }

  leaveRoom(socket: TypedSocket, roomId: string): void {
    const room = this.rooms.get(roomId);

    if (room === undefined) {
      return;
    }

    const slot = this.findPlayerSlotBySocket(room, socket.id);

    if (slot === undefined) {
      return;
    }

    const occupant = room.slots[slot] as PlayerSlotOccupant;
    this.userRooms.delete(occupant.userId);

    if (room.phase === 'lobby' || room.phase === 'created') {
      room.slots[slot] = { type: 'empty' };

      if (occupant.userId === room.ownerUserId) {
        this.closeRoom(room.roomId);
        return;
      }
    } else {
      occupant.online = false;
      occupant.socketId = null;
    }

    socket.leave(room.roomId);
    this.io.to(room.roomId).emit('room:state', { room: this.toRoomState(room) });
    this.io.to(room.roomId).emit('room:slots', {
      roomId: room.roomId,
      slots: this.toRoomSlots(room),
    });
  }

  handleDisconnect(socketId: string): void {
    for (const room of this.rooms.values()) {
      const slot = this.findPlayerSlotBySocket(room, socketId);

      if (slot === undefined) {
        continue;
      }

      const occupant = room.slots[slot] as PlayerSlotOccupant;
      occupant.online = false;
      occupant.socketId = null;

      this.io.to(room.roomId).emit('room:slots', {
        roomId: room.roomId,
        slots: this.toRoomSlots(room),
      });
    }
  }

  setReady(socket: TypedSocket, roomId: string, ready: boolean): void {
    const room = this.rooms.get(roomId);

    if (room === undefined) {
      this.emitError(socket, 'room_not_found', '房间不存在');
      return;
    }

    const slot = this.findPlayerSlotBySocket(room, socket.id);

    if (slot === undefined) {
      this.emitError(socket, 'not_in_room', '当前连接不在该房间');
      return;
    }

    const occupant = room.slots[slot] as PlayerSlotOccupant;
    occupant.ready = ready;

    this.io.to(room.roomId).emit('room:slots', {
      roomId: room.roomId,
      slots: this.toRoomSlots(room),
    });
  }

  selectBattle(socket: TypedSocket, roomId: string, battleId: string): void {
    const room = this.rooms.get(roomId);

    if (room === undefined) {
      this.emitError(socket, 'room_not_found', '房间不存在');
      return;
    }

    const occupant = this.getPlayerBySocket(room, socket.id);

    if (occupant?.userId !== room.ownerUserId) {
      this.emitError(socket, 'not_owner', '只有房主可以选择战斗');
      return;
    }

    if (room.phase !== 'lobby' && room.phase !== 'created') {
      this.emitError(socket, 'room_not_in_lobby', '当前房间状态不允许切换战斗');
      return;
    }

    const battle = getBattleDefinition(battleId);

    if (battle === undefined) {
      this.emitError(socket, 'battle_not_found', '战斗不存在');
      return;
    }

    room.battleId = battle.id;
    room.battle = battle;
    this.io.to(room.roomId).emit('room:state', { room: this.toRoomState(room) });
  }

  startRoom(socket: TypedSocket, roomId: string): void {
    const room = this.rooms.get(roomId);

    if (room === undefined) {
      this.emitError(socket, 'room_not_found', '房间不存在');
      return;
    }

    const occupant = this.getPlayerBySocket(room, socket.id);

    if (occupant?.userId !== room.ownerUserId) {
      this.emitError(socket, 'not_owner', '只有房主可以开始战斗');
      return;
    }

    if (room.battle === null || room.battleId === null) {
      this.emitError(socket, 'battle_not_selected', '请先选择战斗');
      return;
    }

    const unreadyPlayers = Object.values(room.slots).filter(
      (slotOccupant) => slotOccupant.type === 'player' && !slotOccupant.ready,
    );

    if (unreadyPlayers.length > 0) {
      this.emitError(socket, 'players_not_ready', '仍有玩家未准备');
      return;
    }

    this.fillBots(room);
    this.startSimulation(room, false);
  }

  restartRoom(socket: TypedSocket, roomId: string): void {
    const room = this.rooms.get(roomId);

    if (room === undefined) {
      this.emitError(socket, 'room_not_found', '房间不存在');
      return;
    }

    const occupant = this.getPlayerBySocket(room, socket.id);

    if (occupant?.userId !== room.ownerUserId) {
      this.emitError(socket, 'not_owner', '只有房主可以重开');
      return;
    }

    if (room.battle === null || room.battleId === null) {
      this.emitError(socket, 'battle_not_selected', '请先选择战斗');
      return;
    }

    this.startSimulation(room, true);
  }

  enqueueInput(socket: TypedSocket, input: SimulationInput): void {
    const room = this.rooms.get(input.roomId);

    if (room === undefined) {
      this.emitError(socket, 'not_in_room', '房间不存在');
      return;
    }

    if (room.phase !== 'running' || room.simulation === null) {
      this.emitError(socket, 'room_not_running', '当前房间未处于战斗中');
      return;
    }

    const player = this.getPlayerBySocket(room, socket.id);

    if (player === undefined) {
      this.emitError(socket, 'slot_not_owned', '当前连接不控制该角色');
      return;
    }

    if (player.actorId !== input.actorId) {
      this.emitError(socket, 'slot_not_owned', '当前连接不控制该角色');
      return;
    }

    room.simulation.dispatchInput(input);
  }

  private startSimulation(room: RoomRecord, isRestart: boolean): void {
    if (room.loopHandle !== null) {
      clearInterval(room.loopHandle);
      room.loopHandle = null;
    }

    this.fillBots(room);
    room.phase = 'loading';
    room.result = null;
    room.snapshotBroadcastCounter = 0;
    room.inputSeqByActorId.clear();
    this.io.to(room.roomId).emit('room:state', { room: this.toRoomState(room) });

    const simulation = createSimulation({
      tickRate: 20,
    });
    const partyBlueprint: PartyMemberBlueprint[] = PARTY_SLOT_ORDER.map((slot) => {
      const occupant = room.slots[slot];

      if (occupant.type === 'empty') {
        throw new Error('startSimulation called with empty slot');
      }

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

    simulation.loadBattle({
      battle: room.battle!,
      roomId: room.roomId,
      party: partyBlueprint,
    });
    simulation.start();

    room.simulation = simulation;
    room.phase = 'running';

    const startSnapshot = simulation.getSnapshot();

    this.io.to(room.roomId).emit(isRestart ? 'sim:restart' : 'sim:start', {
      roomId: room.roomId,
      snapshot: startSnapshot,
    });
    this.io.to(room.roomId).emit('room:state', { room: this.toRoomState(room) });
    this.io.to(room.roomId).emit('room:slots', {
      roomId: room.roomId,
      slots: this.toRoomSlots(room),
    });

    room.loopHandle = setInterval(() => {
      if (room.simulation === null || room.battle === null) {
        return;
      }

      const preTickSnapshot = room.simulation.getSnapshot();

      for (const slot of PARTY_SLOT_ORDER) {
        const occupant = room.slots[slot];

        if (occupant.type !== 'bot') {
          continue;
        }

        const actor = preTickSnapshot.actors.find((candidate) => candidate.slot === slot);

        if (actor === undefined || !actor.alive) {
          continue;
        }

        const directive = room.battle.getBotDirective({
          snapshot: preTickSnapshot,
          slot,
          actor,
        });
        const nextSeq = (room.inputSeqByActorId.get(actor.id) ?? 0) + 1;
        room.inputSeqByActorId.set(actor.id, nextSeq);

        if (directive.moveDirection !== undefined) {
          room.simulation.dispatchInput({
            roomId: room.roomId,
            actorId: actor.id,
            inputSeq: nextSeq,
            issuedAt: Date.now(),
            type: 'move',
            payload: {
              direction: directive.moveDirection,
            },
          });
        }

        if (directive.faceAngle !== undefined) {
          room.simulation.dispatchInput({
            roomId: room.roomId,
            actorId: actor.id,
            inputSeq: nextSeq + 1,
            issuedAt: Date.now(),
            type: 'face',
            payload: {
              facing: directive.faceAngle,
            },
          });
          room.inputSeqByActorId.set(actor.id, nextSeq + 1);
        }

        if (directive.useKnockbackImmune) {
          const lastSeq = (room.inputSeqByActorId.get(actor.id) ?? nextSeq + 1) + 1;
          room.simulation.dispatchInput({
            roomId: room.roomId,
            actorId: actor.id,
            inputSeq: lastSeq,
            issuedAt: Date.now(),
            type: 'use-knockback-immune',
            payload: {
              issuedBy: 'bot',
            },
          });
          room.inputSeqByActorId.set(actor.id, lastSeq);
        }
      }

      room.simulation.tick(FIXED_TICK_MS);
      room.snapshotBroadcastCounter += 1;
      const events = room.simulation.drainEvents();
      const acknowledgedInputSeq = room.simulation.getAcknowledgedInputSeq();

      if (events.length > 0) {
        this.io.to(room.roomId).emit('sim:events', {
          roomId: room.roomId,
          events,
          acknowledgedInputSeq,
        });
      }

      if (room.snapshotBroadcastCounter >= 10) {
        room.snapshotBroadcastCounter = 0;
        this.io.to(room.roomId).emit('sim:snapshot', {
          roomId: room.roomId,
          snapshot: room.simulation.getSnapshot(),
          acknowledgedInputSeq,
        });
        this.io.to(room.roomId).emit('room:slots', {
          roomId: room.roomId,
          slots: this.toRoomSlots(room),
        });
      }

      const snapshot = room.simulation.getSnapshot();

      if (snapshot.result !== null) {
        room.phase = 'finished';
        room.result = snapshot.result;
        if (room.loopHandle !== null) {
          clearInterval(room.loopHandle);
          room.loopHandle = null;
        }
        this.io.to(room.roomId).emit('sim:end', {
          roomId: room.roomId,
          result: snapshot.result,
        });
        this.io.to(room.roomId).emit('room:state', { room: this.toRoomState(room) });
        this.io.to(room.roomId).emit('room:slots', {
          roomId: room.roomId,
          slots: this.toRoomSlots(room),
        });
      }
    }, FIXED_TICK_MS);
  }

  private fillBots(room: RoomRecord): void {
    for (const slot of PARTY_SLOT_ORDER) {
      if (room.slots[slot].type === 'empty') {
        room.slots[slot] = {
          type: 'bot',
          actorId: `${room.roomId}:${slot}`,
          name: `Bot ${slot}`,
          ready: true,
        };
      }
    }
  }

  private findPlayerSlot(room: RoomRecord, userId: string): PartySlot | undefined {
    return PARTY_SLOT_ORDER.find((slot) => {
      const occupant = room.slots[slot];
      return occupant.type === 'player' && occupant.userId === userId;
    });
  }

  private findPlayerSlotBySocket(room: RoomRecord, socketId: string): PartySlot | undefined {
    return PARTY_SLOT_ORDER.find((slot) => {
      const occupant = room.slots[slot];
      return occupant.type === 'player' && occupant.socketId === socketId;
    });
  }

  private getPlayerBySocket(room: RoomRecord, socketId: string): PlayerSlotOccupant | undefined {
    const slot = this.findPlayerSlotBySocket(room, socketId);

    if (slot === undefined) {
      return undefined;
    }

    return room.slots[slot] as PlayerSlotOccupant;
  }

  private findFirstEmptySlot(room: RoomRecord): PartySlot | undefined {
    return PARTY_SLOT_ORDER.find((slot) => room.slots[slot].type === 'empty');
  }

  private closeRoom(roomId: string): void {
    const room = this.rooms.get(roomId);

    if (room === undefined) {
      return;
    }

    if (room.loopHandle !== null) {
      clearInterval(room.loopHandle);
    }

    for (const slot of PARTY_SLOT_ORDER) {
      const occupant = room.slots[slot];

      if (occupant.type === 'player') {
        this.userRooms.delete(occupant.userId);
      }
    }

    this.rooms.delete(roomId);
  }

  private emitError(socket: TypedSocket, code: string, message: string): void {
    socket.emit('server:error', {
      code,
      message,
    });
  }
}
