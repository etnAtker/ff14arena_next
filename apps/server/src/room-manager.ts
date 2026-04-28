import { getBattleBotController, getBattleDefinition } from '@ff14arena/content';
import { createSimulation, FIXED_TICK_MS } from '@ff14arena/core';
import { performance } from 'node:perf_hooks';
import type { Server as SocketServer, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ContinuousSimulationInputFrame,
  PartySlot,
  RoomStateDto,
  RoomSummaryDto,
  ServerToClientEvents,
  SimResyncRequestPayload,
  SimulationSnapshot,
  UseKnockbackImmuneSimulationInput,
  UseSprintSimulationInput,
} from '@ff14arena/shared';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { ServerMetricsCollector, type RoomMetricDescriptor } from './metrics';
import {
  buildPartyBlueprint,
  createRoomMetricDescriptor,
  createRoomSlots,
  createRoomState,
  createRoomSummary,
} from './room-presenter';
import {
  createBotOccupant,
  createFilledBotSlots,
  type PlayerSlotOccupant,
  type RoomRecord,
  type RoomSpectator,
} from './room-record';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedIo = SocketServer<ClientToServerEvents, ServerToClientEvents>;

export class RoomManager {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly userRooms = new Map<string, string>();
  private roomCounter = 0;

  constructor(
    private readonly io: TypedIo,
    private readonly metrics?: ServerMetricsCollector,
  ) {}

  listRooms(): RoomSummaryDto[] {
    return [...this.rooms.values()].map(createRoomSummary);
  }

  listMetricDescriptors(): RoomMetricDescriptor[] {
    return [...this.rooms.values()].map(createRoomMetricDescriptor);
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
      phase: 'waiting',
      battleId: battle?.id ?? null,
      battle,
      slots: createFilledBotSlots(roomId),
      spectators: new Map(),
      simulation: null,
      loopHandle: null,
      snapshotBroadcastCounter: 0,
      latestResult: null,
      inputSeqByActorId: new Map(),
      lastPoseSeqByActorId: new Map(),
      pendingControlByActorId: new Map(),
      syncId: 1,
    };

    this.rooms.set(roomId, room);
    this.rebuildWaitingSimulation(room, {
      resetAllActors: true,
      keepTimeMs: false,
      sourceSnapshot: null,
    });
    return createRoomState(room);
  }

  toRoomState(room: RoomRecord): RoomStateDto {
    return createRoomState(room);
  }

  private resetPoseSyncState(room: RoomRecord): void {
    room.lastPoseSeqByActorId.clear();
    room.pendingControlByActorId.clear();
  }

  private rebuildWaitingSimulation(
    room: RoomRecord,
    options?: {
      sourceSnapshot?: SimulationSnapshot | null;
      keepTimeMs?: boolean;
      resetAllActors?: boolean;
      resetStateActorIds?: Set<string>;
      resetPositionActorIds?: Set<string>;
    },
  ): void {
    if (room.battle === null || room.battleId === null) {
      if (room.loopHandle !== null) {
        clearInterval(room.loopHandle);
        room.loopHandle = null;
      }
      room.simulation = null;
      room.phase = 'waiting';
      return;
    }

    const simulation = room.simulation ?? createSimulation({ tickRate: 20 });
    const sourceSnapshot = options?.sourceSnapshot ?? room.simulation?.getSnapshot() ?? null;

    simulation.stop();
    simulation.loadBattle({
      battle: room.battle,
      roomId: room.roomId,
      party: buildPartyBlueprint(room),
      sourceSnapshot,
      latestResult: room.latestResult,
      ...(options?.keepTimeMs === undefined ? {} : { keepTimeMs: options.keepTimeMs }),
      ...(options?.resetAllActors === undefined ? {} : { resetAllActors: options.resetAllActors }),
      ...(options?.resetStateActorIds === undefined
        ? {}
        : { resetStateActorIds: options.resetStateActorIds }),
      ...(options?.resetPositionActorIds === undefined
        ? {}
        : { resetPositionActorIds: options.resetPositionActorIds }),
    });

    room.simulation = simulation;
    room.phase = 'waiting';
    this.ensureSimulationLoop(room);
  }

  private ensureSimulationLoop(room: RoomRecord): void {
    if (room.simulation === null || room.loopHandle !== null) {
      return;
    }

    room.loopHandle = setInterval(() => {
      this.tickRoom(room);
    }, FIXED_TICK_MS);
  }

  private tickRoom(room: RoomRecord): void {
    if (room.simulation === null) {
      return;
    }

    const tickStartedAt = performance.now();
    let botControllerDurationMs = 0;
    let botControlFrames = 0;

    for (const frame of room.pendingControlByActorId.values()) {
      room.simulation.submitActorControlFrame(frame);
    }
    room.pendingControlByActorId.clear();

    if (room.phase === 'running' && room.battle !== null) {
      const preTickSnapshot = room.simulation.getSnapshot();
      const botController = getBattleBotController(room.battle.id);

      for (const slot of PARTY_SLOT_ORDER) {
        const occupant = room.slots[slot];

        if (occupant.type !== 'bot') {
          continue;
        }

        const actor = preTickSnapshot.actors.find((candidate) => candidate.id === occupant.actorId);

        if (actor === undefined || !actor.alive) {
          continue;
        }

        if (botController === undefined) {
          continue;
        }

        const botControllerStartedAt = performance.now();
        const control = botController({
          snapshot: preTickSnapshot,
          slot,
          actor,
        });
        botControllerDurationMs += performance.now() - botControllerStartedAt;
        const nextSeq = (room.inputSeqByActorId.get(actor.id) ?? 0) + 1;
        room.inputSeqByActorId.set(actor.id, nextSeq);
        room.simulation.submitActorControlFrame({
          actorId: actor.id,
          inputSeq: nextSeq,
          issuedAt: Date.now(),
          ...(control.pose === undefined ? {} : { pose: control.pose }),
          ...(control.commands === undefined ? {} : { commands: control.commands }),
        });
        botControlFrames += 1;
      }
    }

    const simulationTickStartedAt = performance.now();
    room.simulation.tick(FIXED_TICK_MS);
    const simulationTickDurationMs = performance.now() - simulationTickStartedAt;
    room.snapshotBroadcastCounter += 1;
    const events = room.simulation.drainEvents();

    if (events.length > 0) {
      this.metrics?.recordSimEvents(room.roomId, events.length);
      this.io.to(room.roomId).emit('sim:events', {
        roomId: room.roomId,
        syncId: room.syncId,
        events,
      });
    }

    if (room.snapshotBroadcastCounter >= 10) {
      room.snapshotBroadcastCounter = 0;
      this.emitSnapshot(room, {
        reason: 'tick',
      });
      this.emitRoomSlots(room);
    }

    const snapshot = room.simulation.getSnapshot();

    if (room.phase === 'running' && snapshot.latestResult !== null) {
      this.finishSimulation(room, snapshot);
    }

    this.metrics?.recordTick({
      roomId: room.roomId,
      tickDurationMs: performance.now() - tickStartedAt,
      botControllerDurationMs,
      simulationTickDurationMs,
      botControlFrames,
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
      occupant.departed = false;
      occupant.name = userName;
      this.userRooms.set(payload.userId, room.roomId);
      socket.join(room.roomId);

      if (room.phase === 'waiting') {
        this.rebuildWaitingSimulation(room, {
          sourceSnapshot: room.simulation?.getSnapshot() ?? null,
          keepTimeMs: true,
        });
        this.broadcastWaitingState(room, 'rejoin');
      } else {
        this.emitRoomState(room);
        this.emitRoomSlots(room);
        this.emitSnapshot(room, {
          target: socket,
          reason: 'rejoin',
        });
      }

      return;
    }

    const currentSpectator = room.spectators.get(payload.userId);

    if (currentSpectator !== undefined) {
      currentSpectator.socketId = socket.id;
      currentSpectator.online = true;
      currentSpectator.name = userName;
      this.userRooms.set(payload.userId, room.roomId);
      socket.join(room.roomId);

      if (room.phase === 'waiting') {
        this.broadcastWaitingState(room, 'rejoin');
      } else {
        this.emitRoomState(room);
        this.emitRoomSlots(room);
        this.emitSnapshot(room, {
          target: socket,
          reason: 'rejoin',
        });
      }

      return;
    }

    if (room.phase !== 'waiting') {
      this.emitError(socket, 'room_not_joinable', '当前房间不可加入');
      return;
    }

    const targetSlot = payload.slot ?? this.findFirstAvailableSlot(room);

    if (targetSlot === undefined) {
      this.emitError(socket, 'room_full', '房间已满');
      return;
    }

    if (room.slots[targetSlot].type === 'player') {
      this.emitError(socket, 'slot_occupied', '目标槽位已被玩家占用');
      return;
    }

    room.slots[targetSlot] = {
      type: 'player',
      actorId: `${room.roomId}:player:${payload.userId}`,
      userId: payload.userId,
      name: userName,
      socketId: socket.id,
      online: true,
      ready: payload.userId === room.ownerUserId,
      departed: false,
    };

    this.userRooms.set(payload.userId, room.roomId);
    socket.join(room.roomId);
    this.rebuildWaitingSimulation(room, {
      sourceSnapshot: room.simulation?.getSnapshot() ?? null,
      keepTimeMs: true,
    });
    this.broadcastWaitingState(room, 'join');
  }

  leaveRoom(socket: TypedSocket, roomId: string): void {
    const room = this.rooms.get(roomId);

    if (room === undefined) {
      return;
    }

    const slot = this.findPlayerSlotBySocket(room, socket.id);

    if (slot === undefined) {
      const spectator = this.getSpectatorBySocket(room, socket.id);

      if (spectator !== undefined) {
        this.handleSpectatorDeparture(room, spectator, true);
        socket.leave(room.roomId);
      }

      return;
    }

    this.handlePlayerDeparture(room, slot, true);
    socket.leave(room.roomId);
  }

  handleDisconnect(socketId: string): void {
    for (const room of this.rooms.values()) {
      const slot = this.findPlayerSlotBySocket(room, socketId);

      if (slot === undefined) {
        const spectator = this.getSpectatorBySocket(room, socketId);

        if (spectator !== undefined) {
          this.handleSpectatorDeparture(room, spectator, false);
          return;
        }

        continue;
      }

      this.handlePlayerDeparture(room, slot, false);
      return;
    }
  }

  setReady(socket: TypedSocket, roomId: string, ready: boolean): void {
    const room = this.rooms.get(roomId);

    if (room === undefined) {
      this.emitError(socket, 'room_not_found', '房间不存在');
      return;
    }

    if (room.phase !== 'waiting') {
      this.emitError(socket, 'room_not_waiting', '当前房间不允许准备');
      return;
    }

    const slot = this.findPlayerSlotBySocket(room, socket.id);

    if (slot === undefined) {
      const spectator = this.getSpectatorBySocket(room, socket.id);

      if (spectator === undefined) {
        this.emitError(socket, 'not_in_room', '当前连接不在该房间');
        return;
      }

      spectator.ready = spectator.userId === room.ownerUserId ? true : ready;
    } else {
      const occupant = room.slots[slot] as PlayerSlotOccupant;

      if (occupant.userId === room.ownerUserId) {
        occupant.ready = true;
      } else {
        occupant.ready = ready;
      }
    }

    this.rebuildWaitingSimulation(room, {
      sourceSnapshot: room.simulation?.getSnapshot() ?? null,
      keepTimeMs: true,
    });
    this.broadcastWaitingState(room, 'waiting-state');
  }

  selectBattle(socket: TypedSocket, roomId: string, battleId: string): void {
    const room = this.rooms.get(roomId);

    if (room === undefined) {
      this.emitError(socket, 'room_not_found', '房间不存在');
      return;
    }

    const occupant = this.getRoomMemberBySocket(room, socket.id);

    if (occupant?.userId !== room.ownerUserId) {
      this.emitError(socket, 'not_owner', '只有房主可以选择战斗');
      return;
    }

    if (room.phase !== 'waiting') {
      this.emitError(socket, 'room_not_waiting', '当前房间状态不允许切换战斗');
      return;
    }

    const battle = getBattleDefinition(battleId);

    if (battle === undefined) {
      this.emitError(socket, 'battle_not_found', '战斗不存在');
      return;
    }

    room.battleId = battle.id;
    room.battle = battle;
    room.latestResult = null;
    room.syncId += 1;
    this.resetPoseSyncState(room);
    this.resetReadyStates(room);
    this.rebuildWaitingSimulation(room, {
      resetAllActors: true,
      keepTimeMs: false,
      sourceSnapshot: null,
    });
    this.broadcastWaitingState(room, 'waiting-state');
  }

  switchSlot(socket: TypedSocket, payload: { roomId: string; targetSlot: PartySlot }): void {
    const room = this.rooms.get(payload.roomId);

    if (room === undefined) {
      this.emitError(socket, 'room_not_found', '房间不存在');
      return;
    }

    if (room.phase !== 'waiting') {
      this.emitError(socket, 'room_not_waiting', '当前房间状态不允许切换槽位');
      return;
    }

    const currentSlot = this.findPlayerSlotBySocket(room, socket.id);

    if (currentSlot === undefined) {
      const spectator = this.getSpectatorBySocket(room, socket.id);

      if (spectator === undefined) {
        this.emitError(socket, 'not_in_room', '当前连接不在该房间');
        return;
      }

      const targetOccupant = room.slots[payload.targetSlot];

      if (targetOccupant.type === 'player') {
        this.emitError(socket, 'slot_occupied', '目标槽位已被玩家占用');
        return;
      }

      room.spectators.delete(spectator.userId);
      const nextOccupant: PlayerSlotOccupant = {
        type: 'player',
        actorId: `${room.roomId}:player:${spectator.userId}`,
        userId: spectator.userId,
        name: spectator.name,
        socketId: spectator.socketId,
        online: spectator.online,
        ready: spectator.userId === room.ownerUserId ? true : spectator.ready,
        departed: false,
      };
      room.slots[payload.targetSlot] = nextOccupant;
      this.resetReadyStates(room);
      this.rebuildWaitingSimulation(room, {
        sourceSnapshot: room.simulation?.getSnapshot() ?? null,
        keepTimeMs: true,
        resetPositionActorIds: new Set([nextOccupant.actorId, targetOccupant.actorId]),
      });
      this.broadcastWaitingState(room, 'waiting-state');
      return;
    }

    if (currentSlot === payload.targetSlot) {
      return;
    }

    const currentOccupant = room.slots[currentSlot];
    const targetOccupant = room.slots[payload.targetSlot];

    room.slots[currentSlot] = targetOccupant;
    room.slots[payload.targetSlot] = currentOccupant;
    this.resetReadyStates(room);
    this.rebuildWaitingSimulation(room, {
      sourceSnapshot: room.simulation?.getSnapshot() ?? null,
      keepTimeMs: true,
      resetPositionActorIds: new Set([currentOccupant.actorId, targetOccupant.actorId]),
    });
    this.broadcastWaitingState(room, 'waiting-state');
  }

  spectate(socket: TypedSocket, roomId: string): void {
    const room = this.rooms.get(roomId);

    if (room === undefined) {
      this.emitError(socket, 'room_not_found', '房间不存在');
      return;
    }

    if (room.phase !== 'waiting') {
      this.emitError(socket, 'room_not_waiting', '当前房间状态不允许切换观战');
      return;
    }

    const currentSlot = this.findPlayerSlotBySocket(room, socket.id);

    if (currentSlot === undefined) {
      if (this.getSpectatorBySocket(room, socket.id) !== undefined) {
        return;
      }

      this.emitError(socket, 'not_in_room', '当前连接不在该房间');
      return;
    }

    const occupant = room.slots[currentSlot] as PlayerSlotOccupant;
    room.spectators.set(occupant.userId, {
      userId: occupant.userId,
      name: occupant.name,
      socketId: occupant.socketId,
      online: occupant.online,
      ready: occupant.userId === room.ownerUserId ? true : occupant.ready,
    });
    room.slots[currentSlot] = createBotOccupant(room.roomId, currentSlot);
    this.rebuildWaitingSimulation(room, {
      sourceSnapshot: room.simulation?.getSnapshot() ?? null,
      keepTimeMs: true,
      resetPositionActorIds: new Set([occupant.actorId, room.slots[currentSlot].actorId]),
    });
    this.broadcastWaitingState(room, 'waiting-state');
  }

  startRoom(socket: TypedSocket, roomId: string): void {
    const room = this.rooms.get(roomId);

    if (room === undefined) {
      this.emitError(socket, 'room_not_found', '房间不存在');
      return;
    }

    const occupant = this.getRoomMemberBySocket(room, socket.id);

    if (occupant?.userId !== room.ownerUserId) {
      this.emitError(socket, 'not_owner', '只有房主可以开始战斗');
      return;
    }

    if (room.phase !== 'waiting') {
      this.emitError(socket, 'room_not_waiting', '当前房间已在模拟中');
      return;
    }

    if (room.battle === null || room.battleId === null) {
      this.emitError(socket, 'battle_not_selected', '请先选择战斗');
      return;
    }

    const unreadyPlayers = [
      ...Object.values(room.slots).filter(
        (slotOccupant) =>
          slotOccupant.type === 'player' &&
          slotOccupant.userId !== room.ownerUserId &&
          !slotOccupant.ready,
      ),
      ...[...room.spectators.values()].filter(
        (spectator) => spectator.userId !== room.ownerUserId && !spectator.ready,
      ),
    ];

    if (unreadyPlayers.length > 0) {
      this.emitError(socket, 'players_not_ready', '仍有玩家未准备');
      return;
    }

    this.startSimulation(room);
  }

  enqueueInput(
    socket: TypedSocket,
    input: UseKnockbackImmuneSimulationInput | UseSprintSimulationInput,
  ): void {
    const room = this.rooms.get(input.roomId);

    if (room === undefined) {
      this.emitError(socket, 'not_in_room', '房间不存在');
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

    if (room.simulation === null) {
      this.emitError(socket, 'room_not_running', '当前房间当前不可处理输入');
      return;
    }

    room.simulation.submitActorControlFrame({
      actorId: input.actorId,
      inputSeq: input.inputSeq,
      issuedAt: input.issuedAt,
      commands: [
        {
          type: input.type,
          payload: input.payload,
        },
      ],
    });
  }

  enqueueContinuousInput(socket: TypedSocket, inputFrame: ContinuousSimulationInputFrame): void {
    const room = this.rooms.get(inputFrame.roomId);

    if (room === undefined) {
      this.emitError(socket, 'not_in_room', '房间不存在');
      return;
    }

    const player = this.getPlayerBySocket(room, socket.id);

    if (player === undefined || player.actorId !== inputFrame.actorId) {
      this.emitError(socket, 'slot_not_owned', '当前连接不控制该角色');
      return;
    }

    if (room.simulation === null) {
      this.emitError(socket, 'room_not_running', '当前房间当前不可处理输入');
      return;
    }

    const lastSeq = room.lastPoseSeqByActorId.get(inputFrame.actorId) ?? 0;

    if (inputFrame.inputSeq <= lastSeq) {
      this.metrics?.recordInputFrame(room.roomId);
      this.metrics?.recordDroppedInputFrame(room.roomId);
      return;
    }

    this.metrics?.recordInputFrame(room.roomId);
    room.lastPoseSeqByActorId.set(inputFrame.actorId, inputFrame.inputSeq);
    room.pendingControlByActorId.set(inputFrame.actorId, {
      actorId: inputFrame.actorId,
      inputSeq: inputFrame.inputSeq,
      issuedAt: inputFrame.issuedAt,
      pose: {
        position: {
          x: inputFrame.payload.position.x,
          y: inputFrame.payload.position.y,
        },
        facing: inputFrame.payload.facing,
        moveState: {
          direction: {
            x: inputFrame.payload.moveDirection.x,
            y: inputFrame.payload.moveDirection.y,
          },
          moving:
            Math.hypot(inputFrame.payload.moveDirection.x, inputFrame.payload.moveDirection.y) > 0,
        },
      },
    });
  }

  requestResync(socket: TypedSocket, payload: SimResyncRequestPayload): void {
    const room = this.rooms.get(payload.roomId);

    if (room === undefined) {
      this.emitError(socket, 'room_not_found', '房间不存在');
      return;
    }

    const player = this.getRoomMemberBySocket(room, socket.id);

    if (player === undefined) {
      this.emitError(socket, 'not_in_room', '当前连接不在该房间');
      return;
    }

    this.metrics?.recordResyncRequest(room.roomId);
    this.emitRoomState(room, socket);
    this.emitRoomSlots(room, socket);
    this.emitSnapshot(room, {
      target: socket,
      reason: 'resync',
    });
  }

  private handlePlayerDeparture(room: RoomRecord, slot: PartySlot, shouldLeaveRoom: boolean): void {
    const occupant = room.slots[slot] as PlayerSlotOccupant;

    if (occupant.userId === room.ownerUserId) {
      this.closeRoom(room.roomId, '房主已离开，房间已关闭');
      return;
    }

    if (room.phase === 'waiting') {
      if (shouldLeaveRoom) {
        this.userRooms.delete(occupant.userId);
        room.slots[slot] = createBotOccupant(room.roomId, slot);
      } else {
        occupant.online = false;
        occupant.socketId = null;
        occupant.ready = occupant.userId === room.ownerUserId;
        occupant.departed = false;
      }

      this.rebuildWaitingSimulation(room, {
        sourceSnapshot: room.simulation?.getSnapshot() ?? null,
        keepTimeMs: true,
      });
      this.broadcastWaitingState(room, 'waiting-state');
      return;
    }

    if (shouldLeaveRoom) {
      this.userRooms.delete(occupant.userId);
    }

    occupant.online = false;
    occupant.socketId = null;
    occupant.ready = false;
    occupant.departed = shouldLeaveRoom;

    this.emitRoomSlots(room);
    this.emitRoomState(room);
  }

  private handleSpectatorDeparture(
    room: RoomRecord,
    spectator: RoomSpectator,
    shouldLeaveRoom: boolean,
  ): void {
    if (spectator.userId === room.ownerUserId) {
      this.closeRoom(room.roomId, '房主已离开，房间已关闭');
      return;
    }

    if (shouldLeaveRoom) {
      this.userRooms.delete(spectator.userId);
      room.spectators.delete(spectator.userId);
    } else {
      spectator.online = false;
      spectator.socketId = null;
      spectator.ready = false;
    }

    this.emitRoomState(room);
  }

  private startSimulation(room: RoomRecord): void {
    room.latestResult = null;
    room.snapshotBroadcastCounter = 0;
    room.inputSeqByActorId.clear();
    room.syncId += 1;
    this.resetPoseSyncState(room);
    const simulation = room.simulation ?? createSimulation({ tickRate: 20 });

    simulation.stop();
    simulation.loadBattle({
      battle: room.battle!,
      roomId: room.roomId,
      party: buildPartyBlueprint(room),
      resetAllActors: true,
      keepTimeMs: false,
      latestResult: null,
    });
    simulation.start();

    room.simulation = simulation;
    room.phase = 'running';
    this.ensureSimulationLoop(room);

    const startSnapshot = simulation.getSnapshot();

    this.io.to(room.roomId).emit('sim:start', {
      roomId: room.roomId,
      syncId: room.syncId,
      snapshot: startSnapshot,
    });
    this.metrics?.recordSimStart();
    this.emitRoomState(room);
    this.emitRoomSlots(room);
  }

  private finishSimulation(room: RoomRecord, endSnapshot: SimulationSnapshot): void {
    room.phase = 'waiting';
    room.latestResult = endSnapshot.latestResult;
    room.syncId += 1;
    this.resetPoseSyncState(room);
    const resetActorIds = new Set<string>();

    for (const slot of PARTY_SLOT_ORDER) {
      const occupant = room.slots[slot];

      if (occupant.type === 'player' && occupant.departed) {
        room.slots[slot] = createBotOccupant(room.roomId, slot);
        resetActorIds.add(room.slots[slot].actorId);
      }
    }

    this.resetReadyStates(room);
    this.rebuildWaitingSimulation(room, {
      sourceSnapshot: endSnapshot,
      keepTimeMs: true,
      resetStateActorIds: resetActorIds,
    });

    this.io.to(room.roomId).emit('sim:end', {
      roomId: room.roomId,
      latestResult: room.latestResult!,
    });
    this.metrics?.recordSimEnd();
    this.broadcastWaitingState(room, 'battle-end');
  }

  private broadcastWaitingState(
    room: RoomRecord,
    reason: 'join' | 'rejoin' | 'resync' | 'waiting-state' | 'battle-end',
  ): void {
    this.emitRoomState(room);
    this.emitRoomSlots(room);
    this.emitSnapshot(room, {
      reason,
    });
  }

  private emitRoomState(room: RoomRecord, target?: TypedSocket): void {
    if (target !== undefined) {
      target.emit('room:state', { room: this.toRoomState(room) });
      this.metrics?.recordRoomState();
      return;
    }

    this.io.to(room.roomId).emit('room:state', { room: this.toRoomState(room) });
    this.metrics?.recordRoomState();
  }

  private emitRoomSlots(room: RoomRecord, target?: TypedSocket): void {
    const payload = {
      roomId: room.roomId,
      slots: createRoomSlots(room),
    };

    if (target !== undefined) {
      target.emit('room:slots', payload);
      this.metrics?.recordRoomSlots();
      return;
    }

    this.io.to(room.roomId).emit('room:slots', payload);
    this.metrics?.recordRoomSlots();
  }

  private emitSnapshot(
    room: RoomRecord,
    options: {
      reason:
        | 'join'
        | 'rejoin'
        | 'resync'
        | 'waiting-state'
        | 'tick'
        | 'battle-end'
        | 'battle-start';
      target?: TypedSocket;
    },
  ): void {
    const snapshot = room.simulation?.getSnapshot();

    if (snapshot === null || snapshot === undefined) {
      return;
    }

    const payload = {
      roomId: room.roomId,
      syncId: room.syncId,
      snapshot,
      reason: options.reason,
    };

    if (options.target !== undefined) {
      options.target.emit('sim:snapshot', payload);
      this.metrics?.recordSnapshot(room.roomId);
      return;
    }

    this.io.to(room.roomId).emit('sim:snapshot', payload);
    this.metrics?.recordSnapshot(room.roomId);
  }

  private resetReadyStates(room: RoomRecord): void {
    for (const slot of PARTY_SLOT_ORDER) {
      const occupant = room.slots[slot];

      if (occupant.type === 'bot') {
        occupant.ready = true;
        continue;
      }

      occupant.ready = occupant.userId === room.ownerUserId;
    }

    for (const spectator of room.spectators.values()) {
      spectator.ready = spectator.userId === room.ownerUserId;
    }
  }

  private findPlayerSlot(room: RoomRecord, userId: string): PartySlot | undefined {
    return PARTY_SLOT_ORDER.find((slot) => {
      const occupant = room.slots[slot];
      return occupant.type === 'player' && occupant.userId === userId && !occupant.departed;
    });
  }

  private findPlayerSlotBySocket(room: RoomRecord, socketId: string): PartySlot | undefined {
    return PARTY_SLOT_ORDER.find((slot) => {
      const occupant = room.slots[slot];
      return occupant.type === 'player' && occupant.socketId === socketId && !occupant.departed;
    });
  }

  private getPlayerBySocket(room: RoomRecord, socketId: string): PlayerSlotOccupant | undefined {
    const slot = this.findPlayerSlotBySocket(room, socketId);

    if (slot === undefined) {
      return undefined;
    }

    return room.slots[slot] as PlayerSlotOccupant;
  }

  private getSpectatorBySocket(room: RoomRecord, socketId: string): RoomSpectator | undefined {
    return [...room.spectators.values()].find((spectator) => spectator.socketId === socketId);
  }

  private getRoomMemberBySocket(
    room: RoomRecord,
    socketId: string,
  ): PlayerSlotOccupant | RoomSpectator | undefined {
    return this.getPlayerBySocket(room, socketId) ?? this.getSpectatorBySocket(room, socketId);
  }

  private findFirstAvailableSlot(room: RoomRecord): PartySlot | undefined {
    return PARTY_SLOT_ORDER.find((slot) => room.slots[slot].type !== 'player');
  }

  private closeRoom(roomId: string, reason: string): void {
    const room = this.rooms.get(roomId);

    if (room === undefined) {
      return;
    }

    if (room.loopHandle !== null) {
      clearInterval(room.loopHandle);
    }

    this.io.to(room.roomId).emit('room:closed', {
      roomId: room.roomId,
      reason,
    });
    this.metrics?.recordRoomClosedEvent();

    for (const slot of PARTY_SLOT_ORDER) {
      const occupant = room.slots[slot];

      if (occupant.type === 'player') {
        this.userRooms.delete(occupant.userId);
      }
    }

    for (const spectator of room.spectators.values()) {
      this.userRooms.delete(spectator.userId);
    }

    this.rooms.delete(roomId);
    this.metrics?.recordRoomClosed(roomId);
  }

  private emitError(socket: TypedSocket, code: string, message: string): void {
    socket.emit('server:error', {
      code,
      message,
    });
    this.metrics?.recordServerError(code);
  }
}
