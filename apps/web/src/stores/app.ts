import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { Socket } from 'socket.io-client';
import type {
  BattleSummary,
  EncounterResult,
  PartySlot,
  RoomStatePayload,
  RoomStateDto,
  RoomSummaryDto,
  SimulationEvent,
  SimulationInput,
  SimulationSnapshot,
  Vector2,
} from '@ff14arena/shared';

type AppSocket = Socket;

interface LocalProfile {
  userId: string;
  userName: string;
}

const PROFILE_STORAGE_KEY = 'ff14arena:profile';

function createDefaultProfile(): LocalProfile {
  return {
    userId: `user_${crypto.randomUUID()}`,
    userName: `玩家${Math.floor(Math.random() * 9000 + 1000)}`,
  };
}

function loadProfile(): LocalProfile {
  const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);

  if (raw === null) {
    const nextProfile = createDefaultProfile();
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(nextProfile));
    return nextProfile;
  }

  try {
    const parsed = JSON.parse(raw) as LocalProfile;

    if (typeof parsed.userId === 'string' && typeof parsed.userName === 'string') {
      return parsed;
    }
  } catch {
    // 忽略损坏的本地缓存，回退到默认身份。
  }

  const fallback = createDefaultProfile();
  window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(fallback));
  return fallback;
}

function normalizeDirection(direction: Vector2): Vector2 {
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

export const useAppStore = defineStore('app', () => {
  const profile = ref<LocalProfile>(loadProfile());
  const socket = shallowRef<AppSocket | null>(null);
  const socketPromise = shallowRef<Promise<AppSocket> | null>(null);
  const battles = ref<BattleSummary[]>([]);
  const rooms = ref<RoomSummaryDto[]>([]);
  const room = ref<RoomStateDto | null>(null);
  const snapshot = ref<SimulationSnapshot | null>(null);
  const result = ref<EncounterResult | null>(null);
  const serverError = ref<string | null>(null);
  const connected = ref(false);
  const inputSeq = ref(0);
  const logs = ref<string[]>([]);

  const currentPlayerSlot = computed<PartySlot | null>(() => {
    const currentRoom = room.value;

    if (currentRoom === null) {
      return null;
    }

    const hit = currentRoom.slots.find((slot) => slot.ownerUserId === profile.value.userId);
    return hit?.slot ?? null;
  });

  const page = computed<'home' | 'lobby' | 'battle' | 'result'>(() => {
    if (room.value === null) {
      return 'home';
    }

    if (
      room.value.phase === 'finished' &&
      (snapshot.value?.result !== null || result.value !== null)
    ) {
      return 'result';
    }

    if (room.value.phase === 'loading' || room.value.phase === 'running') {
      return 'battle';
    }

    return 'lobby';
  });

  async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }

  async function loadLobbyData(): Promise<void> {
    const [battleResponse, roomResponse] = await Promise.all([
      fetchJson<{ battles: BattleSummary[] }>('/battles'),
      fetchJson<{ rooms: RoomSummaryDto[] }>('/rooms'),
    ]);

    battles.value = battleResponse.battles;
    rooms.value = roomResponse.rooms;
  }

  function appendLog(message: string): void {
    logs.value = [message, ...logs.value].slice(0, 40);
  }

  function resetBattleState(options?: { clearLogs?: boolean }): void {
    snapshot.value = null;
    result.value = null;
    inputSeq.value = 0;

    if (options?.clearLogs ?? true) {
      logs.value = [];
    }
  }

  function getCurrentPlayerActor() {
    const slot = currentPlayerSlot.value;

    if (slot === null) {
      return null;
    }

    return snapshot.value?.actors.find((candidate) => candidate.slot === slot) ?? null;
  }

  async function waitForRoomState(roomId: string, timeoutMs = 3000): Promise<RoomStateDto> {
    const currentSocket = await ensureSocket();

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        currentSocket.off('room:state', handleRoomState);
        reject(new Error('进入房间超时'));
      }, timeoutMs);

      const handleRoomState = (payload: RoomStatePayload) => {
        if (payload.room.roomId !== roomId) {
          return;
        }

        window.clearTimeout(timer);
        currentSocket.off('room:state', handleRoomState);
        resolve(payload.room);
      };

      currentSocket.on('room:state', handleRoomState);
    });
  }

  async function ensureSocket(): Promise<AppSocket> {
    if (socket.value !== null) {
      return socket.value;
    }

    if (socketPromise.value !== null) {
      return socketPromise.value;
    }

    socketPromise.value = (async () => {
      const { io } = await import('socket.io-client');
      const nextSocket = io({
        transports: ['websocket'],
      }) as AppSocket;

      nextSocket.on('connect', () => {
        connected.value = true;
        serverError.value = null;
        appendLog('已连接服务器');
      });

      nextSocket.on('disconnect', () => {
        connected.value = false;
        appendLog('与服务器断开连接');
      });

      nextSocket.on('server:error', (payload) => {
        serverError.value = payload.message;
        appendLog(`错误：${payload.message}`);
      });

      nextSocket.on('room:state', (payload) => {
        const previousRoomId = room.value?.roomId ?? null;
        const nextRoomId = payload.room.roomId;

        if (previousRoomId !== null && previousRoomId !== nextRoomId) {
          resetBattleState();
        }

        room.value = payload.room;

        if (payload.room.result !== null) {
          result.value = payload.room.result;
        } else {
          result.value = null;
        }
      });

      nextSocket.on('room:slots', (payload) => {
        const currentRoom = room.value;

        if (currentRoom === null || currentRoom.roomId !== payload.roomId) {
          return;
        }

        room.value = {
          roomId: currentRoom.roomId,
          name: currentRoom.name,
          ownerUserId: currentRoom.ownerUserId,
          ownerName: currentRoom.ownerName,
          battleId: currentRoom.battleId,
          battleName: currentRoom.battleName,
          phase: currentRoom.phase,
          slots: payload.slots,
          result: currentRoom.result,
        };
      });

      nextSocket.on('sim:start', (payload) => {
        if (room.value?.roomId !== payload.roomId) {
          return;
        }

        snapshot.value = payload.snapshot;
        result.value = null;
        logs.value = [];
        inputSeq.value = 0;
        appendLog(`战斗开始：${payload.snapshot.battleName}`);
      });

      nextSocket.on('sim:restart', (payload) => {
        if (room.value?.roomId !== payload.roomId) {
          return;
        }

        snapshot.value = payload.snapshot;
        result.value = null;
        logs.value = [];
        inputSeq.value = 0;
        appendLog('战斗已重开');
      });

      nextSocket.on('sim:snapshot', (payload) => {
        if (room.value?.roomId !== payload.roomId) {
          return;
        }

        snapshot.value = payload.snapshot;
      });

      nextSocket.on('sim:events', (payload) => {
        if (snapshot.value === null || snapshot.value.roomId !== payload.roomId) {
          return;
        }

        for (const event of payload.events) {
          applySimulationEvent(event);
        }
      });

      nextSocket.on('sim:end', (payload) => {
        if (room.value?.roomId !== payload.roomId) {
          return;
        }

        result.value = payload.result;
        appendLog(payload.result.outcome === 'success' ? '战斗成功' : '战斗失败');
      });

      socket.value = nextSocket;
      return nextSocket;
    })();

    try {
      return await socketPromise.value;
    } finally {
      socketPromise.value = null;
    }
  }

  function updateProfile(userName: string): void {
    profile.value = {
      ...profile.value,
      userName: userName.trim() || profile.value.userName,
    };
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile.value));
  }

  async function createRoom(name: string, battleId?: string): Promise<void> {
    serverError.value = null;

    try {
      await ensureSocket();
      resetBattleState();
      room.value = null;

      const response = await fetchJson<{ room: RoomStateDto }>('/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          ownerUserId: profile.value.userId,
          ownerName: profile.value.userName,
          battleId,
        }),
      });

      const roomStatePromise = waitForRoomState(response.room.roomId);
      await joinRoom(response.room.roomId);
      await roomStatePromise;
      loadLobbyData().catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建房间失败';
      serverError.value = message;
      appendLog(`错误：${message}`);
      throw error;
    }
  }

  async function joinRoom(roomId: string, slot?: PartySlot): Promise<void> {
    const currentSocket = await ensureSocket();
    resetBattleState();
    room.value = null;
    currentSocket.emit('room:join', {
      roomId,
      userId: profile.value.userId,
      userName: profile.value.userName,
      ...(slot !== undefined ? { slot } : {}),
    });
  }

  function leaveRoom(): void {
    if (room.value === null || socket.value === null) {
      return;
    }

    socket.value.emit('room:leave', {
      roomId: room.value.roomId,
    });
    room.value = null;
    resetBattleState();
    loadLobbyData().catch(() => undefined);
  }

  async function setReady(ready: boolean): Promise<void> {
    if (room.value === null) {
      return;
    }

    const currentSocket = socket.value ?? (await ensureSocket());
    currentSocket.emit('room:ready', {
      roomId: room.value.roomId,
      ready,
    });
  }

  async function selectBattle(battleId: string): Promise<void> {
    if (room.value === null) {
      return;
    }

    const currentSocket = socket.value ?? (await ensureSocket());
    currentSocket.emit('room:select-battle', {
      roomId: room.value.roomId,
      battleId,
    });
  }

  async function startBattle(): Promise<void> {
    if (room.value === null) {
      return;
    }

    const currentSocket = socket.value ?? (await ensureSocket());
    currentSocket.emit('room:start', {
      roomId: room.value.roomId,
    });
  }

  async function restartBattle(): Promise<void> {
    if (room.value === null) {
      return;
    }

    const currentSocket = socket.value ?? (await ensureSocket());
    currentSocket.emit('room:restart', {
      roomId: room.value.roomId,
    });
  }

  function emitSimulationInput(
    input: Omit<SimulationInput, 'roomId' | 'inputSeq' | 'issuedAt'>,
  ): void {
    if (room.value === null || socket.value === null) {
      return;
    }

    inputSeq.value += 1;
    const payload = {
      ...input,
      roomId: room.value.roomId,
      inputSeq: inputSeq.value,
      issuedAt: Date.now(),
    } as SimulationInput;

    switch (payload.type) {
      case 'move':
        socket.value.emit('sim:move', payload);
        break;
      case 'face':
        socket.value.emit('sim:face', payload);
        break;
      case 'use-knockback-immune':
        socket.value.emit('sim:use-knockback-immune', payload);
        break;
    }
  }

  function sendMove(direction: Vector2): void {
    const actor = getCurrentPlayerActor();

    if (actor === null) {
      return;
    }

    emitSimulationInput({
      actorId: actor.id,
      type: 'move',
      payload: {
        direction: normalizeDirection(direction),
      },
    });
  }

  function sendFace(position: Vector2): void {
    const actor = getCurrentPlayerActor();

    if (actor === null) {
      return;
    }

    sendFaceAngle(Math.atan2(position.y - actor.position.y, position.x - actor.position.x));
  }

  function sendFaceAngle(facing: number): void {
    const actor = getCurrentPlayerActor();

    if (actor === null) {
      return;
    }

    actor.facing = facing;

    emitSimulationInput({
      actorId: actor.id,
      type: 'face',
      payload: {
        facing,
      },
    });
  }

  function useKnockbackImmune(): void {
    const actor = getCurrentPlayerActor();

    if (actor === null) {
      return;
    }

    emitSimulationInput({
      actorId: actor.id,
      type: 'use-knockback-immune',
      payload: {
        issuedBy: 'player',
      },
    });
  }

  function applySimulationEvent(event: SimulationEvent): void {
    if (snapshot.value === null) {
      return;
    }

    switch (event.type) {
      case 'actorMoved': {
        const actor = snapshot.value.actors.find(
          (candidate) => candidate.id === event.payload.actorId,
        );

        if (actor !== undefined) {
          actor.position = event.payload.position;
          actor.facing = event.payload.facing;
        }
        break;
      }
      case 'bossCastStarted':
        snapshot.value.boss.castBar = {
          actionId: event.payload.actionId,
          actionName: event.payload.actionName,
          startedAt: event.payload.startedAt,
          totalDurationMs: event.payload.totalDurationMs,
        };
        snapshot.value.hud.bossCastBar = snapshot.value.boss.castBar;
        appendLog(`Boss 读条：${event.payload.actionName}`);
        break;
      case 'bossCastResolved':
        snapshot.value.boss.castBar = null;
        snapshot.value.hud.bossCastBar = null;
        appendLog(`Boss 技能结算：${event.payload.actionName}`);
        break;
      case 'aoeSpawned': {
        snapshot.value.mechanics = snapshot.value.mechanics.filter(
          (mechanic) => mechanic.id !== event.payload.id,
        );
        snapshot.value.mechanics.push(event.payload);
        appendLog(`AOE 出现：${event.payload.label}`);
        break;
      }
      case 'aoeResolved':
        snapshot.value.mechanics = snapshot.value.mechanics.filter(
          (mechanic) => mechanic.id !== event.payload.mechanicId,
        );
        appendLog(`AOE 结算：${event.payload.mechanicId}`);
        break;
      case 'damageApplied': {
        const actor = snapshot.value.actors.find(
          (candidate) => candidate.id === event.payload.targetId,
        );

        if (actor !== undefined) {
          actor.currentHp = event.payload.remainingHp;
          actor.alive = event.payload.remainingHp > 0;
          actor.lastDamageSource = event.payload.sourceLabel;
        }
        break;
      }
      case 'statusApplied': {
        const actor = snapshot.value.actors.find(
          (candidate) => candidate.id === event.payload.targetId,
        );

        if (actor !== undefined) {
          actor.statuses = actor.statuses.filter((status) => status.id !== event.payload.status.id);
          actor.statuses.push(event.payload.status);
          actor.knockbackImmune = actor.statuses.some((status) => status.id === 'knockback_immune');
        }
        break;
      }
      case 'actorDied': {
        const actor = snapshot.value.actors.find(
          (candidate) => candidate.id === event.payload.actorId,
        );

        if (actor !== undefined) {
          actor.alive = false;
          actor.currentHp = 0;
          actor.deathReason = event.payload.deathReason;
        }
        appendLog(`${event.payload.actorName} 倒地：${event.payload.deathReason}`);
        break;
      }
      case 'battleMessageChanged':
        snapshot.value.hud.battleMessage = event.payload.message;
        if (event.payload.message !== null) {
          appendLog(`提示：${event.payload.message}`);
        }
        break;
      case 'battleFailureMarked':
        snapshot.value.failureMarked = true;
        snapshot.value.failureReasons = event.payload.failureReasons;
        snapshot.value.hud.recentFailureReason = event.payload.failureReasons;
        appendLog(`失败标记：${event.payload.failureReasons.join(' / ')}`);
        break;
      case 'encounterCompleted':
        snapshot.value.result = event.payload;
        result.value = event.payload;
        break;
    }
  }

  return {
    profile,
    battles,
    rooms,
    room,
    snapshot,
    result,
    serverError,
    connected,
    logs,
    currentPlayerSlot,
    page,
    loadLobbyData,
    updateProfile,
    createRoom,
    joinRoom,
    leaveRoom,
    setReady,
    selectBattle,
    startBattle,
    restartBattle,
    sendMove,
    sendFace,
    sendFaceAngle,
    useKnockbackImmune,
  };
});
