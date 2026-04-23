import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { Socket } from 'socket.io-client';
import type {
  BattleSummary,
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

interface FacingPreviewState {
  actorId: string;
  facing: number;
}

const PROFILE_STORAGE_KEY = 'ff14arena:profile';
const RESYNC_THROTTLE_MS = 500;

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

function normalizeAngleDifference(left: number, right: number): number {
  return Math.atan2(Math.sin(left - right), Math.cos(left - right));
}

export const useAppStore = defineStore('app', () => {
  const profile = ref<LocalProfile>(loadProfile());
  const socket = shallowRef<AppSocket | null>(null);
  const socketPromise = shallowRef<Promise<AppSocket> | null>(null);
  const battles = ref<BattleSummary[]>([]);
  const rooms = ref<RoomSummaryDto[]>([]);
  const room = ref<RoomStateDto | null>(null);
  const authoritativeSnapshot = ref<SimulationSnapshot | null>(null);
  const serverError = ref<string | null>(null);
  const connected = ref(false);
  const inputSeq = ref(0);
  const logs = ref<string[]>([]);
  const currentSyncId = ref(0);
  const lastAcknowledgedInputSeq = ref(0);
  const facingPreview = ref<FacingPreviewState | null>(null);
  const lastResyncRequestedAt = ref(0);

  const pendingInputIssuedAt = new Map<number, number>();

  const snapshot = computed<SimulationSnapshot | null>(() => {
    const baseSnapshot = authoritativeSnapshot.value;
    const preview = facingPreview.value;

    if (baseSnapshot === null || preview === null) {
      return baseSnapshot;
    }

    const actorIndex = baseSnapshot.actors.findIndex((actor) => actor.id === preview.actorId);

    if (actorIndex < 0) {
      return baseSnapshot;
    }

    return {
      ...baseSnapshot,
      actors: baseSnapshot.actors.map((actor, index) =>
        index === actorIndex ? { ...actor, facing: preview.facing } : actor,
      ),
    };
  });

  const currentPlayerSlot = computed<PartySlot | null>(() => {
    const currentRoom = room.value;

    if (currentRoom === null) {
      return null;
    }

    const hit = currentRoom.slots.find((slot) => slot.ownerUserId === profile.value.userId);
    return hit?.slot ?? null;
  });

  const page = computed<'home' | 'battle'>(() => (room.value === null ? 'home' : 'battle'));

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
    logs.value = [message, ...logs.value].slice(0, 80);
  }

  function clearFacingPreview(): void {
    facingPreview.value = null;
  }

  function resetSyncState(options?: { clearInputSeq?: boolean }): void {
    authoritativeSnapshot.value = null;
    currentSyncId.value = 0;
    lastAcknowledgedInputSeq.value = 0;
    pendingInputIssuedAt.clear();
    clearFacingPreview();

    if (options?.clearInputSeq ?? true) {
      inputSeq.value = 0;
    }
  }

  function resetBattleState(options?: { clearLogs?: boolean; clearInputSeq?: boolean }): void {
    resetSyncState(
      options?.clearInputSeq === undefined ? undefined : { clearInputSeq: options.clearInputSeq },
    );

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

  function handleAcknowledgedInputSeq(acknowledgedInputSeq: number): void {
    if (acknowledgedInputSeq <= lastAcknowledgedInputSeq.value) {
      return;
    }

    for (const seq of [...pendingInputIssuedAt.keys()]) {
      if (seq <= acknowledgedInputSeq) {
        pendingInputIssuedAt.delete(seq);
      }
    }

    lastAcknowledgedInputSeq.value = acknowledgedInputSeq;
  }

  function rememberPendingInput(seq: number): void {
    pendingInputIssuedAt.set(seq, Date.now());
  }

  function reconcileFacingPreview(nextSnapshot: SimulationSnapshot): void {
    const preview = facingPreview.value;

    if (preview === null) {
      return;
    }

    const actor = nextSnapshot.actors.find((candidate) => candidate.id === preview.actorId);

    if (
      actor === undefined ||
      Math.abs(normalizeAngleDifference(actor.facing, preview.facing)) < 0.05
    ) {
      clearFacingPreview();
    }
  }

  function acceptSyncId(syncId: number): boolean {
    if (syncId < currentSyncId.value) {
      return false;
    }

    if (syncId > currentSyncId.value) {
      currentSyncId.value = syncId;
      pendingInputIssuedAt.clear();
      lastAcknowledgedInputSeq.value = 0;
      clearFacingPreview();
    }

    return true;
  }

  function acceptSnapshot(options: {
    syncId: number;
    snapshot: SimulationSnapshot;
    acknowledgedInputSeq: number;
  }): void {
    if (!acceptSyncId(options.syncId)) {
      return;
    }

    handleAcknowledgedInputSeq(options.acknowledgedInputSeq);

    const currentSnapshot = authoritativeSnapshot.value;

    if (
      currentSnapshot !== null &&
      options.syncId === currentSyncId.value &&
      currentSnapshot.phase === options.snapshot.phase &&
      options.snapshot.tick < currentSnapshot.tick
    ) {
      return;
    }

    authoritativeSnapshot.value = options.snapshot;
    reconcileFacingPreview(options.snapshot);
  }

  function requestResync(reason: string): void {
    if (room.value === null || socket.value === null) {
      return;
    }

    const now = Date.now();

    if (now - lastResyncRequestedAt.value < RESYNC_THROTTLE_MS) {
      return;
    }

    lastResyncRequestedAt.value = now;
    socket.value.emit('sim:request-resync', {
      roomId: room.value.roomId,
      reason,
    });
  }

  function rejoinCurrentRoom(): void {
    if (room.value === null || socket.value === null) {
      return;
    }

    socket.value.emit('room:join', {
      roomId: room.value.roomId,
      userId: profile.value.userId,
      userName: profile.value.userName,
    });
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
        rejoinCurrentRoom();
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
      });

      nextSocket.on('room:slots', (payload) => {
        const currentRoom = room.value;

        if (currentRoom === null || currentRoom.roomId !== payload.roomId) {
          return;
        }

        room.value = {
          ...currentRoom,
          slots: payload.slots,
        };
      });

      nextSocket.on('room:closed', (payload) => {
        if (room.value?.roomId !== payload.roomId) {
          return;
        }

        appendLog(payload.reason);
        room.value = null;
        resetBattleState();
        loadLobbyData().catch(() => undefined);
      });

      nextSocket.on('sim:start', (payload) => {
        if (room.value?.roomId !== payload.roomId) {
          return;
        }

        if (!acceptSyncId(payload.syncId)) {
          return;
        }

        authoritativeSnapshot.value = payload.snapshot;
        inputSeq.value = 0;
        lastAcknowledgedInputSeq.value = 0;
        pendingInputIssuedAt.clear();
        clearFacingPreview();
        logs.value = [];
        appendLog(`开始模拟：${payload.snapshot.battleName}`);
      });

      nextSocket.on('sim:snapshot', (payload) => {
        if (room.value?.roomId !== payload.roomId) {
          return;
        }

        acceptSnapshot({
          syncId: payload.syncId,
          snapshot: payload.snapshot,
          acknowledgedInputSeq: payload.acknowledgedInputSeq,
        });
      });

      nextSocket.on('sim:events', (payload) => {
        if (room.value?.roomId !== payload.roomId) {
          return;
        }

        if (!acceptSyncId(payload.syncId)) {
          return;
        }

        if (authoritativeSnapshot.value === null) {
          requestResync('missing_snapshot');
          return;
        }

        if (authoritativeSnapshot.value.phase !== 'running') {
          requestResync('phase_mismatch');
          return;
        }

        handleAcknowledgedInputSeq(payload.acknowledgedInputSeq);

        const acceptedEvents = payload.events.filter(
          (event: SimulationEvent) =>
            event.tick > authoritativeSnapshot.value!.tick ||
            (event.tick === authoritativeSnapshot.value!.tick &&
              event.timeMs > authoritativeSnapshot.value!.timeMs),
        );

        if (acceptedEvents.length === 0) {
          return;
        }

        for (const event of acceptedEvents) {
          applySimulationEvent(event);
        }

        const latestEvent = acceptedEvents[acceptedEvents.length - 1];
        authoritativeSnapshot.value.tick = latestEvent.tick;
        authoritativeSnapshot.value.timeMs = latestEvent.timeMs;
        reconcileFacingPreview(authoritativeSnapshot.value);
      });

      nextSocket.on('sim:end', (payload) => {
        if (room.value?.roomId !== payload.roomId) {
          return;
        }

        appendLog(payload.latestResult.outcome === 'success' ? '本轮成功' : '本轮失败');
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
    const currentSocket = socket.value ?? (await ensureSocket());
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

  async function switchSlot(targetSlot: PartySlot): Promise<void> {
    if (room.value === null) {
      return;
    }

    const currentSocket = socket.value ?? (await ensureSocket());
    currentSocket.emit('room:switch-slot', {
      roomId: room.value.roomId,
      targetSlot,
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

    rememberPendingInput(payload.inputSeq);

    switch (payload.type) {
      case 'use-knockback-immune':
        socket.value.emit('sim:use-knockback-immune', payload);
        break;
      default:
        return;
    }
  }

  function sendContinuousInputFrame(frame: { moveDirection: Vector2; facing?: number }): void {
    if (room.value === null || socket.value === null) {
      return;
    }

    const actor = getCurrentPlayerActor();

    if (actor === null) {
      return;
    }

    inputSeq.value += 1;
    const nextInputSeq = inputSeq.value;
    rememberPendingInput(nextInputSeq);

    socket.value.emit('sim:input-frame', {
      roomId: room.value.roomId,
      actorId: actor.id,
      inputSeq: nextInputSeq,
      issuedAt: Date.now(),
      payload: {
        moveDirection: normalizeDirection(frame.moveDirection),
        ...(frame.facing !== undefined ? { facing: frame.facing } : {}),
      },
    });
  }

  function previewFaceAngle(facing: number): void {
    const actor = getCurrentPlayerActor();

    if (actor === null) {
      return;
    }

    facingPreview.value = {
      actorId: actor.id,
      facing,
    };
  }

  function useKnockbackImmune(): void {
    if (snapshot.value?.phase !== 'running') {
      return;
    }

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
    if (authoritativeSnapshot.value === null) {
      return;
    }

    switch (event.type) {
      case 'actorMoved': {
        const actor = authoritativeSnapshot.value.actors.find(
          (candidate) => candidate.id === event.payload.actorId,
        );

        if (actor !== undefined) {
          actor.position = event.payload.position;
          actor.facing = event.payload.facing;
        }
        break;
      }
      case 'bossCastStarted':
        authoritativeSnapshot.value.boss.castBar = {
          actionId: event.payload.actionId,
          actionName: event.payload.actionName,
          startedAt: event.payload.startedAt,
          totalDurationMs: event.payload.totalDurationMs,
        };
        authoritativeSnapshot.value.hud.bossCastBar = authoritativeSnapshot.value.boss.castBar;
        appendLog(`Boss 读条：${event.payload.actionName}`);
        break;
      case 'bossCastResolved':
        authoritativeSnapshot.value.boss.castBar = null;
        authoritativeSnapshot.value.hud.bossCastBar = null;
        appendLog(`Boss 结算：${event.payload.actionName}`);
        break;
      case 'aoeSpawned':
        authoritativeSnapshot.value.mechanics = authoritativeSnapshot.value.mechanics.filter(
          (mechanic) => mechanic.id !== event.payload.id,
        );
        authoritativeSnapshot.value.mechanics.push(event.payload);
        appendLog(`AOE 出现：${event.payload.label}`);
        break;
      case 'aoeResolved':
        authoritativeSnapshot.value.mechanics = authoritativeSnapshot.value.mechanics.filter(
          (mechanic) => mechanic.id !== event.payload.mechanicId,
        );
        appendLog(`AOE 结算：${event.payload.mechanicId}`);
        break;
      case 'damageApplied': {
        const actor = authoritativeSnapshot.value.actors.find(
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
        const actor = authoritativeSnapshot.value.actors.find(
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
        const actor = authoritativeSnapshot.value.actors.find(
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
      case 'battleFailureMarked':
        authoritativeSnapshot.value.failureMarked = true;
        authoritativeSnapshot.value.failureReasons = event.payload.failureReasons;
        appendLog(`失败原因：${event.payload.failureReasons.join(' / ')}`);
        break;
      case 'encounterCompleted':
        authoritativeSnapshot.value.latestResult = event.payload;
        break;
    }
  }

  return {
    profile,
    battles,
    rooms,
    room,
    snapshot,
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
    switchSlot,
    startBattle,
    sendContinuousInputFrame,
    previewFaceAngle,
    useKnockbackImmune,
  };
});
