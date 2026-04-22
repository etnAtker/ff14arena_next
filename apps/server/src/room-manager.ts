import { getBattleDefinition } from '@ff14arena/content';
import {
  createSimulation,
  DEFAULT_PLAYER_MAX_HP,
  DEFAULT_PLAYER_MOVE_SPEED,
  FIXED_TICK_MS,
} from '@ff14arena/core';
import type { BattleDefinition, PartyMemberBlueprint, SimulationInstance } from '@ff14arena/core';
import type { Server as SocketServer, Socket } from 'socket.io';
import type {
  BaseActorSnapshot,
  ClientToServerEvents,
  EncounterResult,
  PartySlot,
  RoomPhase,
  RoomSlotState,
  RoomStateDto,
  RoomSummaryDto,
  ServerToClientEvents,
  SimulationInput,
  SimulationSnapshot,
} from '@ff14arena/shared';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type TypedIo = SocketServer<ClientToServerEvents, ServerToClientEvents>;

interface PlayerSlotOccupant {
  type: 'player';
  actorId: string;
  userId: string;
  name: string;
  socketId: string | null;
  online: boolean;
  ready: boolean;
  departed: boolean;
}

interface BotSlotOccupant {
  type: 'bot';
  actorId: string;
  name: string;
  ready: true;
}

type SlotOccupant = PlayerSlotOccupant | BotSlotOccupant;

interface RoomRecord {
  roomId: string;
  name: string;
  ownerUserId: string;
  ownerName: string;
  phase: RoomPhase;
  battleId: string | null;
  battle: BattleDefinition | null;
  slots: Record<PartySlot, SlotOccupant>;
  waitingSnapshot: SimulationSnapshot | null;
  simulation: SimulationInstance | null;
  loopHandle: NodeJS.Timeout | null;
  snapshotBroadcastCounter: number;
  latestResult: EncounterResult | null;
  inputSeqByActorId: Map<string, number>;
}

function normalizeDirection(direction: { x: number; y: number }): { x: number; y: number } {
  const vectorLength = Math.hypot(direction.x, direction.y);

  if (vectorLength === 0) {
    return {
      x: 0,
      y: 0,
    };
  }

  return {
    x: direction.x / vectorLength,
    y: direction.y / vectorLength,
  };
}

function createBotOccupant(roomId: string, slot: PartySlot): BotSlotOccupant {
  return {
    type: 'bot',
    actorId: `${roomId}:bot:${slot}`,
    name: `Bot ${slot}`,
    ready: true,
  };
}

function createFilledBotSlots(roomId: string): Record<PartySlot, SlotOccupant> {
  return Object.fromEntries(
    PARTY_SLOT_ORDER.map((slot) => [slot, createBotOccupant(roomId, slot)]),
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
      occupantCount: Object.values(room.slots).filter((slot) => slot.type === 'player').length,
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
      phase: 'waiting',
      battleId: battle?.id ?? null,
      battle,
      slots: createFilledBotSlots(roomId),
      waitingSnapshot: null,
      simulation: null,
      loopHandle: null,
      snapshotBroadcastCounter: 0,
      latestResult: null,
      inputSeqByActorId: new Map(),
    };

    this.rooms.set(roomId, room);
    this.rebuildWaitingSnapshot(room, {
      resetAllActors: true,
      keepTimeMs: false,
      sourceSnapshot: null,
    });
    return this.toRoomState(room);
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
      latestResult: room.latestResult,
    };
  }

  toRoomSlots(room: RoomRecord): RoomSlotState[] {
    const snapshot =
      room.phase === 'running' ? room.simulation?.getSnapshot() : room.waitingSnapshot;
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

  joinRoom(
    socket: TypedSocket,
    payload: { roomId: string; userId: string; userName?: string; slot?: PartySlot },
  ): void {
    const room = this.rooms.get(payload.roomId);

    if (room === undefined) {
      this.emitError(socket, 'room_not_found', '房间不存在');
      return;
    }

    if (room.phase !== 'waiting') {
      this.emitError(socket, 'room_not_joinable', '当前房间不可加入');
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
      this.rebuildWaitingSnapshot(room, {
        sourceSnapshot: room.waitingSnapshot,
        keepTimeMs: true,
      });
      this.broadcastWaitingState(room);
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
    this.rebuildWaitingSnapshot(room, {
      sourceSnapshot: room.waitingSnapshot,
      keepTimeMs: true,
    });
    this.broadcastWaitingState(room);
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

    this.handlePlayerDeparture(room, slot, true);
    socket.leave(room.roomId);
  }

  handleDisconnect(socketId: string): void {
    for (const room of this.rooms.values()) {
      const slot = this.findPlayerSlotBySocket(room, socketId);

      if (slot === undefined) {
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
      this.emitError(socket, 'not_in_room', '当前连接不在该房间');
      return;
    }

    const occupant = room.slots[slot] as PlayerSlotOccupant;

    if (occupant.userId === room.ownerUserId) {
      occupant.ready = true;
    } else {
      occupant.ready = ready;
    }

    this.rebuildWaitingSnapshot(room, {
      sourceSnapshot: room.waitingSnapshot,
      keepTimeMs: true,
    });
    this.broadcastWaitingState(room);
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
    this.resetReadyStates(room);
    this.rebuildWaitingSnapshot(room, {
      resetAllActors: true,
      keepTimeMs: false,
      sourceSnapshot: null,
    });
    this.broadcastWaitingState(room);
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
      this.emitError(socket, 'not_in_room', '当前连接不在该房间');
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
    this.rebuildWaitingSnapshot(room, {
      sourceSnapshot: room.waitingSnapshot,
      keepTimeMs: true,
      resetPositionActorIds: new Set([currentOccupant.actorId, targetOccupant.actorId]),
    });
    this.broadcastWaitingState(room);
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

    if (room.phase !== 'waiting') {
      this.emitError(socket, 'room_not_waiting', '当前房间已在模拟中');
      return;
    }

    if (room.battle === null || room.battleId === null) {
      this.emitError(socket, 'battle_not_selected', '请先选择战斗');
      return;
    }

    const unreadyPlayers = Object.values(room.slots).filter(
      (slotOccupant) =>
        slotOccupant.type === 'player' &&
        slotOccupant.userId !== room.ownerUserId &&
        !slotOccupant.ready,
    );

    if (unreadyPlayers.length > 0) {
      this.emitError(socket, 'players_not_ready', '仍有玩家未准备');
      return;
    }

    this.startSimulation(room);
  }

  enqueueInput(socket: TypedSocket, input: SimulationInput): void {
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

    if (room.phase === 'waiting') {
      this.applyWaitingInput(room, input);
      return;
    }

    if (room.simulation === null) {
      this.emitError(socket, 'room_not_running', '当前房间未处于模拟中');
      return;
    }

    room.simulation.dispatchInput(input);
  }

  private handlePlayerDeparture(room: RoomRecord, slot: PartySlot, shouldLeaveRoom: boolean): void {
    const occupant = room.slots[slot] as PlayerSlotOccupant;
    this.userRooms.delete(occupant.userId);

    if (occupant.userId === room.ownerUserId) {
      this.closeRoom(room.roomId, '房主已离开，房间已关闭');
      return;
    }

    if (room.phase === 'waiting') {
      room.slots[slot] = createBotOccupant(room.roomId, slot);
      this.rebuildWaitingSnapshot(room, {
        sourceSnapshot: room.waitingSnapshot,
        keepTimeMs: true,
      });
      this.broadcastWaitingState(room);
      return;
    }

    occupant.online = false;
    occupant.socketId = null;
    occupant.ready = false;
    occupant.departed = true;

    if (shouldLeaveRoom) {
      this.io.to(room.roomId).emit('room:slots', {
        roomId: room.roomId,
        slots: this.toRoomSlots(room),
      });
      this.io.to(room.roomId).emit('room:state', { room: this.toRoomState(room) });
    } else {
      this.io.to(room.roomId).emit('room:slots', {
        roomId: room.roomId,
        slots: this.toRoomSlots(room),
      });
      this.io.to(room.roomId).emit('room:state', { room: this.toRoomState(room) });
    }
  }

  private startSimulation(room: RoomRecord): void {
    if (room.loopHandle !== null) {
      clearInterval(room.loopHandle);
      room.loopHandle = null;
    }

    room.latestResult = null;
    room.snapshotBroadcastCounter = 0;
    room.inputSeqByActorId.clear();
    room.waitingSnapshot = null;

    const simulation = createSimulation({
      tickRate: 20,
    });
    const partyBlueprint: PartyMemberBlueprint[] = PARTY_SLOT_ORDER.map((slot) => {
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

    simulation.loadBattle({
      battle: room.battle!,
      roomId: room.roomId,
      party: partyBlueprint,
    });
    simulation.start();

    room.simulation = simulation;
    room.phase = 'running';

    const startSnapshot = simulation.getSnapshot();

    this.io.to(room.roomId).emit('sim:start', {
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

        const actor = preTickSnapshot.actors.find((candidate) => candidate.id === occupant.actorId);

        if (actor === undefined || !actor.alive) {
          continue;
        }

        const directive = room.battle.getBotDirective({
          snapshot: preTickSnapshot,
          slot,
          actor,
          botContext: preTickSnapshot.botContext,
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

      if (snapshot.latestResult !== null) {
        this.finishSimulation(room, snapshot);
      }
    }, FIXED_TICK_MS);
  }

  private finishSimulation(room: RoomRecord, endSnapshot: SimulationSnapshot): void {
    if (room.loopHandle !== null) {
      clearInterval(room.loopHandle);
      room.loopHandle = null;
    }

    room.simulation = null;
    room.phase = 'waiting';
    room.latestResult = endSnapshot.latestResult;
    const resetActorIds = new Set<string>();

    for (const slot of PARTY_SLOT_ORDER) {
      const occupant = room.slots[slot];

      if (occupant.type === 'player' && occupant.departed) {
        room.slots[slot] = createBotOccupant(room.roomId, slot);
        resetActorIds.add(room.slots[slot].actorId);
      }
    }

    this.resetReadyStates(room);
    this.rebuildWaitingSnapshot(room, {
      sourceSnapshot: endSnapshot,
      keepTimeMs: true,
      resetStateActorIds: resetActorIds,
    });

    this.io.to(room.roomId).emit('sim:end', {
      roomId: room.roomId,
      latestResult: room.latestResult!,
    });
    this.broadcastWaitingState(room);
  }

  private rebuildWaitingSnapshot(
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
      room.waitingSnapshot = null;
      return;
    }

    const sourceSnapshot = options?.sourceSnapshot ?? room.waitingSnapshot;
    const previousActors = new Map(sourceSnapshot?.actors.map((actor) => [actor.id, actor]) ?? []);
    const resetStateActorIds = options?.resetStateActorIds ?? new Set<string>();
    const resetPositionActorIds = options?.resetPositionActorIds ?? new Set<string>();

    const actors: BaseActorSnapshot[] = PARTY_SLOT_ORDER.map((slot) => {
      const occupant = room.slots[slot];
      const placement = room.battle!.initialPartyPositions[slot];
      const previousActor = previousActors.get(occupant.actorId);
      const shouldResetState =
        options?.resetAllActors === true || resetStateActorIds.has(occupant.actorId);
      const actorBase: BaseActorSnapshot =
        previousActor === undefined || shouldResetState
          ? {
              id: occupant.actorId,
              kind: occupant.type === 'bot' ? 'bot' : 'player',
              slot,
              name: occupant.name,
              position: {
                x: placement.position.x,
                y: placement.position.y,
              },
              facing: placement.facing,
              moveState: {
                direction: { x: 0, y: 0 },
                moving: false,
              },
              maxHp: DEFAULT_PLAYER_MAX_HP,
              currentHp: DEFAULT_PLAYER_MAX_HP,
              alive: true,
              statuses: [],
              knockbackImmune: false,
              knockbackImmuneCooldown: {
                readyAt: 0,
              },
              deathReason: null,
              lastDamageSource: null,
            }
          : structuredClone(previousActor);

      const actor: BaseActorSnapshot = {
        ...actorBase,
        id: occupant.actorId,
        kind: occupant.type === 'bot' ? 'bot' : 'player',
        slot,
        name: occupant.name,
        online: occupant.type === 'bot' ? true : occupant.online,
        ready: occupant.type === 'bot' ? true : occupant.ready,
      };

      if (
        resetPositionActorIds.has(occupant.actorId) ||
        previousActor === undefined ||
        shouldResetState
      ) {
        actor.position = {
          x: placement.position.x,
          y: placement.position.y,
        };
        actor.facing = placement.facing;
        actor.moveState = {
          direction: { x: 0, y: 0 },
          moving: false,
        };
      }

      if (occupant.type === 'bot' && shouldResetState) {
        actor.currentHp = DEFAULT_PLAYER_MAX_HP;
        actor.maxHp = DEFAULT_PLAYER_MAX_HP;
        actor.alive = true;
        actor.statuses = [];
        actor.knockbackImmune = false;
        actor.knockbackImmuneCooldown = {
          readyAt: 0,
        };
        actor.deathReason = null;
        actor.lastDamageSource = null;
      }

      return actor;
    });

    room.waitingSnapshot = {
      battleId: room.battle.id,
      battleName: room.battle.name,
      roomId: room.roomId,
      phase: 'waiting',
      tick:
        options?.resetAllActors === true
          ? 0
          : (sourceSnapshot?.tick ?? room.waitingSnapshot?.tick ?? 0) + 1,
      timeMs: options?.keepTimeMs ? (sourceSnapshot?.timeMs ?? 0) : 0,
      arenaRadius: room.battle.arenaRadius,
      bossTargetRingRadius: room.battle.bossTargetRingRadius,
      actors,
      boss: {
        id: 'boss',
        kind: 'boss',
        slot: null,
        name: room.battle.bossName,
        position: { x: 0, y: 0 },
        facing: Math.PI / 2,
        moveState: {
          direction: { x: 0, y: 0 },
          moving: false,
        },
        maxHp: 1,
        currentHp: 1,
        alive: true,
        statuses: [],
        knockbackImmune: true,
        knockbackImmuneCooldown: {
          readyAt: Number.MAX_SAFE_INTEGER,
        },
        deathReason: null,
        lastDamageSource: null,
        castBar: null,
        targetRingRadius: room.battle.bossTargetRingRadius,
      },
      mechanics: [],
      hud: {
        bossCastBar: null,
      },
      botContext: null,
      failureMarked: room.latestResult?.outcome === 'failure',
      failureReasons: room.latestResult?.failureReasons ?? [],
      latestResult: room.latestResult,
    };
  }

  private applyWaitingInput(room: RoomRecord, input: SimulationInput): void {
    if (room.waitingSnapshot === null) {
      return;
    }

    const actor = room.waitingSnapshot.actors.find((candidate) => candidate.id === input.actorId);

    if (actor === undefined || !actor.alive) {
      return;
    }

    room.waitingSnapshot.tick += 1;

    switch (input.type) {
      case 'move': {
        const direction = normalizeDirection(input.payload.direction);
        actor.moveState = {
          direction,
          moving: direction.x !== 0 || direction.y !== 0,
        };

        if (!actor.moveState.moving) {
          break;
        }

        const delta = DEFAULT_PLAYER_MOVE_SPEED * (FIXED_TICK_MS / 1000);
        const nextPosition = {
          x: actor.position.x + direction.x * delta,
          y: actor.position.y + direction.y * delta,
        };
        const length = Math.hypot(nextPosition.x, nextPosition.y);

        if (length > room.waitingSnapshot.arenaRadius) {
          const clamped = normalizeDirection(nextPosition);
          actor.position = {
            x: clamped.x * room.waitingSnapshot.arenaRadius,
            y: clamped.y * room.waitingSnapshot.arenaRadius,
          };
        } else {
          actor.position = nextPosition;
        }
        break;
      }
      case 'face':
        actor.facing = input.payload.facing;
        break;
      case 'use-knockback-immune':
        break;
    }

    this.io.to(room.roomId).emit('sim:snapshot', {
      roomId: room.roomId,
      snapshot: room.waitingSnapshot,
      acknowledgedInputSeq: input.inputSeq,
    });
    this.io.to(room.roomId).emit('room:slots', {
      roomId: room.roomId,
      slots: this.toRoomSlots(room),
    });
  }

  private broadcastWaitingState(room: RoomRecord): void {
    this.io.to(room.roomId).emit('room:state', { room: this.toRoomState(room) });
    this.io.to(room.roomId).emit('room:slots', {
      roomId: room.roomId,
      slots: this.toRoomSlots(room),
    });

    if (room.waitingSnapshot !== null) {
      this.io.to(room.roomId).emit('sim:snapshot', {
        roomId: room.roomId,
        snapshot: room.waitingSnapshot,
        acknowledgedInputSeq: 0,
      });
    }
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
