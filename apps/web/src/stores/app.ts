import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { Socket } from 'socket.io-client';
import {
  add,
  getActorMoveSpeed,
  KNOCKBACK_IMMUNE_COOLDOWN_MS,
  movePosition,
  normalize,
  normalizeMoveDirection,
  scale,
  SPRINT_COOLDOWN_MS,
  subtract,
} from '@ff14arena/core';
import type {
  BattleStaticData,
  BattleSummary,
  PartySlot,
  RoomStatePayload,
  RoomStateDto,
  RoomSpectatorState,
  RoomSummaryDto,
  SimulationEvent,
  SimulationInput,
  SimulationSnapshot,
  Vector2,
} from '@ff14arena/shared';
import { normalizeAngleDifference } from '../utils/angle';
import { loadProfile, saveProfile, type LocalProfile } from './profile';

type AppSocket = Socket;

interface FacingPreviewState {
  actorId: string;
  facing: number;
}

const RESYNC_THROTTLE_MS = 500;
const CONTINUOUS_INPUT_INTERVAL_MS = 50;
const TRANSPORT_PROBE_INTERVAL_MS = 1_500;
const ROOM_PASSWORD_STORAGE_KEY = 'ff14arena.roomPassword';

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

interface LocalControlledPose {
  actorId: string;
  position: Vector2;
  facing: number;
  moveState: {
    direction: Vector2;
    moving: boolean;
  };
}

type RoomEntryAction =
  | {
      type: 'create';
      name: string;
      battleId?: string;
    }
  | {
      type: 'join';
      roomId: string;
      slot?: PartySlot;
      mode?: 'player' | 'spectator';
    };

function cloneVector(vector: Vector2): Vector2 {
  return {
    x: vector.x,
    y: vector.y,
  };
}

function readCachedRoomPassword(): string {
  return window.localStorage.getItem(ROOM_PASSWORD_STORAGE_KEY) ?? '';
}

function saveCachedRoomPassword(password: string): void {
  window.localStorage.setItem(ROOM_PASSWORD_STORAGE_KEY, password);
}

function clearCachedRoomPassword(): void {
  window.localStorage.removeItem(ROOM_PASSWORD_STORAGE_KEY);
}

export const useAppStore = defineStore('app', () => {
  const profile = ref<LocalProfile>(loadProfile());
  const socket = shallowRef<AppSocket | null>(null);
  const socketPromise = shallowRef<Promise<AppSocket> | null>(null);
  const battles = ref<BattleSummary[]>([]);
  const battleStaticDataById = ref(new Map<string, BattleStaticData>());
  const rooms = ref<RoomSummaryDto[]>([]);
  const room = ref<RoomStateDto | null>(null);
  const authoritativeSnapshot = ref<SimulationSnapshot | null>(null);
  const serverError = ref<string | null>(null);
  const statusIconPreloadError = ref<string | null>(null);
  const failedStatusIconUrls = ref<string[]>([]);
  const roomPasswordRequired = ref(false);
  const roomPasswordPromptVisible = ref(false);
  const roomPasswordPromptMessage = ref('请输入房间密码');
  const connected = ref(false);
  const logs = ref<string[]>([]);
  const currentSyncId = ref(0);
  const facingPreview = ref<FacingPreviewState | null>(null);
  const serverCountdownSeconds = ref<number | null>(null);
  const battleStartNoticeUntilMs = ref(0);
  const lastResyncRequestedAt = ref(0);
  const transportProbeLatencyMs = ref(0);
  const localControlledPose = ref<LocalControlledPose | null>(null);
  const spectatePending = ref(false);
  const battleStaticDataPromises = new Map<string, Promise<BattleStaticData>>();
  const preloadedStatusIconUrls = new Set<string>();
  const failedStatusIconUrlSet = new Set<string>();
  let pendingRoomEntryAction: RoomEntryAction | null = null;
  let transportProbeTimer: number | null = null;

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
    if (spectatePending.value) {
      return null;
    }

    const currentRoom = room.value;

    if (currentRoom === null) {
      return null;
    }

    const hit = currentRoom.slots.find((slot) => slot.ownerUserId === profile.value.userId);
    return hit?.slot ?? null;
  });
  const currentSpectator = computed(() => {
    const currentRoom = room.value;

    if (currentRoom === null) {
      return null;
    }

    return (
      currentRoom.spectators.find((spectator) => spectator.userId === profile.value.userId) ?? null
    );
  });
  const isSpectating = computed(() => spectatePending.value || currentSpectator.value !== null);
  const battleStaticData = computed<BattleStaticData | null>(() => {
    const battleId = room.value?.battleId ?? authoritativeSnapshot.value?.battleId ?? null;

    if (battleId === null) {
      return null;
    }

    return battleStaticDataById.value.get(battleId) ?? null;
  });

  const page = computed<'home' | 'battle'>(() => (room.value === null ? 'home' : 'battle'));
  const latencyDisplay = computed(() =>
    transportProbeLatencyMs.value > 0 ? `${Math.round(transportProbeLatencyMs.value)} ms` : '--',
  );

  async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);

    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      let code: string | undefined;

      try {
        const payload = (await response.json()) as {
          code?: string;
          message?: string;
        };
        message = payload.message ?? message;
        code = payload.code;
      } catch {
        // 非 JSON 错误响应保留 HTTP 状态文本。
      }

      throw new HttpError(message, response.status, code);
    }

    return (await response.json()) as T;
  }

  async function loadLobbyData(): Promise<void> {
    const [authConfigResponse, battleResponse, roomResponse] = await Promise.all([
      fetchJson<{ roomPasswordRequired: boolean }>('/auth-config'),
      fetchJson<{ battles: BattleSummary[] }>('/battles'),
      fetchJson<{ rooms: RoomSummaryDto[] }>('/rooms'),
    ]);

    roomPasswordRequired.value = authConfigResponse.roomPasswordRequired;
    battles.value = battleResponse.battles;
    rooms.value = roomResponse.rooms;
  }

  function appendLog(message: string): void {
    logs.value = [message, ...logs.value].slice(0, 80);
  }

  function recordStatusIconLoadFailure(iconUrl: string): void {
    if (failedStatusIconUrlSet.has(iconUrl)) {
      return;
    }

    failedStatusIconUrlSet.add(iconUrl);
    failedStatusIconUrls.value = [...failedStatusIconUrlSet];
    statusIconPreloadError.value = `状态图标加载失败：${iconUrl}`;
    appendLog(`错误：状态图标加载失败 ${iconUrl}`);
  }

  function preloadImage(iconUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(iconUrl));
      image.src = iconUrl;
    });
  }

  async function preloadStatusIcons(staticData: BattleStaticData): Promise<void> {
    const pendingMetadata = staticData.statusMetadata.filter(
      (status) =>
        !preloadedStatusIconUrls.has(status.iconUrl) && !failedStatusIconUrlSet.has(status.iconUrl),
    );

    const results = await Promise.allSettled(
      pendingMetadata.map(async (status) => {
        await preloadImage(status.iconUrl);
        return status.iconUrl;
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        preloadedStatusIconUrls.add(result.value);
        continue;
      }

      const iconUrl = result.reason instanceof Error ? result.reason.message : '未知图标';
      recordStatusIconLoadFailure(iconUrl);
    }
  }

  async function ensureBattleStaticData(battleId: string): Promise<BattleStaticData> {
    const loadedStaticData = battleStaticDataById.value.get(battleId);

    if (loadedStaticData !== undefined) {
      await preloadStatusIcons(loadedStaticData);
      return loadedStaticData;
    }

    const pendingStaticData = battleStaticDataPromises.get(battleId);

    if (pendingStaticData !== undefined) {
      return pendingStaticData;
    }

    const staticDataPromise = (async () => {
      const response = await fetchJson<{ battle: BattleStaticData }>(`/battles/${battleId}/static`);
      const nextStaticDataById = new Map(battleStaticDataById.value);
      nextStaticDataById.set(battleId, response.battle);
      battleStaticDataById.value = nextStaticDataById;
      await preloadStatusIcons(response.battle);
      return response.battle;
    })();

    battleStaticDataPromises.set(battleId, staticDataPromise);

    try {
      return await staticDataPromise;
    } finally {
      battleStaticDataPromises.delete(battleId);
    }
  }

  function loadBattleStaticData(battleId: string | null): void {
    if (battleId === null) {
      return;
    }

    ensureBattleStaticData(battleId).catch((error) => {
      const message = error instanceof Error ? error.message : '加载战斗静态数据失败';
      serverError.value = message;
      appendLog(`错误：${message}`);
    });
  }

  function clearFacingPreview(): void {
    facingPreview.value = null;
  }

  function clearLocalControlledPose(): void {
    localControlledPose.value = null;
  }

  function clearLocalControlState(): void {
    clearLocalControlledPose();
    clearFacingPreview();
  }

  function canSendPlayerInput(): boolean {
    return !spectatePending.value && currentSpectator.value === null;
  }

  function resetSyncState(): void {
    authoritativeSnapshot.value = null;
    currentSyncId.value = 0;
    clearLocalControlState();
  }

  function resetBattleState(options?: { clearLogs?: boolean }): void {
    resetSyncState();
    serverCountdownSeconds.value = null;
    battleStartNoticeUntilMs.value = 0;

    if (options?.clearLogs ?? true) {
      logs.value = [];
    }
  }

  function getCurrentPlayerActor() {
    const slot = currentPlayerSlot.value;

    if (slot === null) {
      return null;
    }

    const actor = snapshot.value?.actors.find((candidate) => candidate.slot === slot) ?? null;

    if (actor === null || !actor.alive) {
      return null;
    }

    return actor;
  }

  function getAuthoritativeCurrentPlayerActor() {
    const slot = currentPlayerSlot.value;

    if (slot === null) {
      return null;
    }

    const actor =
      authoritativeSnapshot.value?.actors.find((candidate) => candidate.slot === slot) ?? null;

    if (actor === null || !actor.alive) {
      return null;
    }

    return actor;
  }

  async function probeTransportLatency(): Promise<void> {
    const startedAt = performance.now();

    try {
      const response = await fetch(`/health?latencyProbe=${Date.now()}`, {
        cache: 'no-store',
      });

      if (!response.ok) {
        return;
      }

      await response.arrayBuffer();
      const latencyMs = performance.now() - startedAt;

      if (transportProbeLatencyMs.value === 0) {
        transportProbeLatencyMs.value = latencyMs;
        return;
      }

      transportProbeLatencyMs.value = transportProbeLatencyMs.value * 0.65 + latencyMs * 0.35;
    } catch {
      // 忽略探测失败，保留最近一次成功值。
    }
  }

  function startTransportProbeLoop(): void {
    if (transportProbeTimer !== null) {
      window.clearInterval(transportProbeTimer);
    }

    void probeTransportLatency();
    transportProbeTimer = window.setInterval(() => {
      void probeTransportLatency();
    }, TRANSPORT_PROBE_INTERVAL_MS);
  }

  function stopTransportProbeLoop(): void {
    if (transportProbeTimer === null) {
      return;
    }

    window.clearInterval(transportProbeTimer);
    transportProbeTimer = null;
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
      authoritativeSnapshot.value = null;
      clearLocalControlledPose();
      clearFacingPreview();
    }

    return true;
  }

  function applyLocalControlledPose(snapshotValue: SimulationSnapshot): void {
    const controlledPose = localControlledPose.value;

    if (controlledPose === null) {
      return;
    }

    const actor = snapshotValue.actors.find((candidate) => candidate.id === controlledPose.actorId);

    if (actor === undefined || !actor.alive) {
      clearLocalControlledPose();
      return;
    }

    actor.position = cloneVector(controlledPose.position);
    actor.facing = controlledPose.facing;
    actor.moveState = {
      direction: cloneVector(controlledPose.moveState.direction),
      moving: controlledPose.moveState.moving,
    };
  }

  function acceptSnapshot(options: { syncId: number; snapshot: SimulationSnapshot }): void {
    if (!acceptSyncId(options.syncId)) {
      return;
    }

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
    applyLocalControlledPose(options.snapshot);
    reconcileFacingPreview(options.snapshot);
  }

  function requestResync(reason: string): void {
    if (room.value === null || socket.value === null) {
      return;
    }

    requestResyncWithSocket(socket.value, room.value.roomId, reason);
  }

  function requestResyncWithSocket(currentSocket: AppSocket, roomId: string, reason: string): void {
    const now = Date.now();

    if (now - lastResyncRequestedAt.value < RESYNC_THROTTLE_MS) {
      return;
    }

    lastResyncRequestedAt.value = now;
    currentSocket.emit('sim:request-resync', {
      roomId,
      reason,
    });
  }

  function getRoomPasswordPayload(): { password?: string } {
    const password = readCachedRoomPassword();

    return password.length === 0 ? {} : { password };
  }

  function requestRoomPassword(action: RoomEntryAction, message = '请输入房间密码'): void {
    pendingRoomEntryAction = action;
    roomPasswordPromptMessage.value = message;
    roomPasswordPromptVisible.value = true;
  }

  function prepareRoomEntryAction(action: RoomEntryAction): boolean {
    pendingRoomEntryAction = action;

    if (!roomPasswordRequired.value || readCachedRoomPassword().length > 0) {
      return true;
    }

    requestRoomPassword(action);
    return false;
  }

  function handleInvalidRoomPassword(message: string): void {
    clearCachedRoomPassword();
    serverError.value = message;
    appendLog(`错误：${message}`);

    if (pendingRoomEntryAction !== null) {
      requestRoomPassword(pendingRoomEntryAction, '房间密码错误，请重新输入');
    }
  }

  async function replayRoomEntryAction(action: RoomEntryAction): Promise<void> {
    if (action.type === 'create') {
      await createRoom(action.name, action.battleId);
      return;
    }

    await joinRoom(action.roomId, action.slot, action.mode);
  }

  function submitRoomPassword(password: string): void {
    const normalizedPassword = password.trim();

    if (normalizedPassword.length === 0) {
      serverError.value = '请输入房间密码';
      return;
    }

    saveCachedRoomPassword(normalizedPassword);
    roomPasswordPromptVisible.value = false;

    const action = pendingRoomEntryAction;

    if (action !== null) {
      void replayRoomEntryAction(action);
    }
  }

  function cancelRoomPasswordPrompt(): void {
    roomPasswordPromptVisible.value = false;
    pendingRoomEntryAction = null;
  }

  function emitRoomJoin(
    currentSocket: AppSocket,
    action: Extract<RoomEntryAction, { type: 'join' }>,
  ): void {
    currentSocket.emit('room:join', {
      roomId: action.roomId,
      userId: profile.value.userId,
      userName: profile.value.userName,
      ...getRoomPasswordPayload(),
      ...(action.mode !== undefined ? { mode: action.mode } : {}),
      ...(action.slot !== undefined ? { slot: action.slot } : {}),
    });
  }

  function rejoinCurrentRoom(): void {
    if (room.value === null || socket.value === null) {
      return;
    }

    const action: RoomEntryAction = {
      type: 'join',
      roomId: room.value.roomId,
    };

    if (!prepareRoomEntryAction(action)) {
      return;
    }

    emitRoomJoin(socket.value, action);
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
        startTransportProbeLoop();
        rejoinCurrentRoom();
      });

      nextSocket.on('disconnect', () => {
        connected.value = false;
        stopTransportProbeLoop();
        spectatePending.value = false;
        clearLocalControlledPose();
        appendLog('与服务器断开连接');
      });

      nextSocket.on('server:error', (payload) => {
        if (payload.code === 'invalid_room_password') {
          spectatePending.value = false;
          handleInvalidRoomPassword(payload.message);
          return;
        }

        serverError.value = payload.message;
        spectatePending.value = false;
        appendLog(`错误：${payload.message}`);
      });

      nextSocket.on('room:state', (payload) => {
        const previousRoomId = room.value?.roomId ?? null;
        const nextRoomId = payload.room.roomId;

        if (previousRoomId !== null && previousRoomId !== nextRoomId) {
          resetBattleState();
        }

        room.value = payload.room;
        pendingRoomEntryAction = null;
        loadBattleStaticData(payload.room.battleId);

        if (payload.room.phase === 'running' && authoritativeSnapshot.value?.phase !== 'running') {
          requestResyncWithSocket(nextSocket, payload.room.roomId, 'running_snapshot_missing');
        }

        if (
          spectatePending.value &&
          payload.room.spectators.some(
            (spectator: RoomSpectatorState) => spectator.userId === profile.value.userId,
          )
        ) {
          spectatePending.value = false;
        }
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
        spectatePending.value = false;
        resetBattleState();
        loadLobbyData().catch(() => undefined);
      });

      nextSocket.on('room:countdown', (payload) => {
        if (room.value?.roomId !== payload.roomId) {
          return;
        }

        serverCountdownSeconds.value = payload.remainingSeconds;
      });

      nextSocket.on('sim:start', (payload) => {
        if (room.value?.roomId !== payload.roomId) {
          return;
        }

        if (!acceptSyncId(payload.syncId)) {
          return;
        }

        authoritativeSnapshot.value = payload.snapshot;
        loadBattleStaticData(payload.snapshot.battleId);
        clearLocalControlledPose();
        clearFacingPreview();
        logs.value = [];
        serverCountdownSeconds.value = null;
        battleStartNoticeUntilMs.value = performance.now() + 1_000;
        appendLog(`开始模拟：${payload.snapshot.battleName}`);
      });

      nextSocket.on('sim:snapshot', (payload) => {
        if (room.value?.roomId !== payload.roomId) {
          return;
        }

        acceptSnapshot({
          syncId: payload.syncId,
          snapshot: payload.snapshot,
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
        applyLocalControlledPose(authoritativeSnapshot.value);
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
    saveProfile(profile.value);
  }

  async function createRoom(name: string, battleId?: string): Promise<void> {
    const action: RoomEntryAction = {
      type: 'create',
      name,
      ...(battleId === undefined ? {} : { battleId }),
    };

    serverError.value = null;

    if (!prepareRoomEntryAction(action)) {
      return;
    }

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
          ...getRoomPasswordPayload(),
          battleId,
        }),
      });

      const roomStatePromise = waitForRoomState(response.room.roomId);
      await joinRoom(response.room.roomId);
      await roomStatePromise;
      loadLobbyData().catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建房间失败';

      if (error instanceof HttpError && error.code === 'invalid_room_password') {
        handleInvalidRoomPassword(message);
        return;
      }

      serverError.value = message;
      appendLog(`错误：${message}`);
      throw error;
    }
  }

  async function joinRoom(
    roomId: string,
    slot?: PartySlot,
    mode?: 'player' | 'spectator',
  ): Promise<void> {
    const action: RoomEntryAction = {
      type: 'join',
      roomId,
      ...(slot !== undefined ? { slot } : {}),
      ...(mode !== undefined ? { mode } : {}),
    };

    if (!prepareRoomEntryAction(action)) {
      return;
    }

    const currentSocket = socket.value ?? (await ensureSocket());
    resetBattleState();
    room.value = null;
    emitRoomJoin(currentSocket, action);
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

    spectatePending.value = false;
    const currentSocket = socket.value ?? (await ensureSocket());
    currentSocket.emit('room:switch-slot', {
      roomId: room.value.roomId,
      targetSlot,
    });
  }

  async function spectate(): Promise<void> {
    if (room.value === null) {
      return;
    }

    spectatePending.value = true;
    clearLocalControlState();
    const currentSocket = socket.value ?? (await ensureSocket());
    currentSocket.emit('room:spectate', {
      roomId: room.value.roomId,
    });
  }

  async function startBattle(countdownMs?: number): Promise<void> {
    if (room.value === null) {
      return;
    }

    const currentSocket = socket.value ?? (await ensureSocket());
    currentSocket.emit('room:start', {
      roomId: room.value.roomId,
      ...(countdownMs === undefined ? {} : { countdownMs }),
    });
  }

  async function quickFail(): Promise<void> {
    if (room.value === null) {
      return;
    }

    const currentSocket = socket.value ?? (await ensureSocket());
    currentSocket.emit('room:quick-fail', {
      roomId: room.value.roomId,
    });
  }

  function applyOptimisticContinuousInput(frame: {
    moveDirection: Vector2;
    facing?: number;
  }): LocalControlledPose | null {
    if (authoritativeSnapshot.value === null) {
      return null;
    }

    const actor = getCurrentPlayerActor();

    if (actor === null) {
      return null;
    }

    const direction = normalizeMoveDirection(frame.moveDirection);
    const nextFacing = frame.facing ?? actor.facing;
    const nextPosition = movePosition(
      actor.position,
      direction,
      CONTINUOUS_INPUT_INTERVAL_MS,
      getActorMoveSpeed(actor),
    );

    actor.position = nextPosition;
    actor.moveState = {
      direction,
      moving: Math.hypot(direction.x, direction.y) > 0,
    };
    actor.facing = nextFacing;

    const nextPose = {
      actorId: actor.id,
      position: cloneVector(nextPosition),
      facing: nextFacing,
      moveState: {
        direction: cloneVector(direction),
        moving: actor.moveState.moving,
      },
    };

    localControlledPose.value = nextPose;
    return nextPose;
  }

  function submitLocalControlledPose(options: {
    actorId: string;
    position: Vector2;
    facing: number;
    moveState: LocalControlledPose['moveState'];
  }): void {
    if (
      room.value === null ||
      socket.value === null ||
      authoritativeSnapshot.value === null ||
      !canSendPlayerInput()
    ) {
      return;
    }

    const actor = authoritativeSnapshot.value.actors.find(
      (candidate) => candidate.id === options.actorId,
    );

    if (actor === undefined || !actor.alive) {
      return;
    }

    const nextPose = {
      actorId: actor.id,
      position: cloneVector(options.position),
      facing: options.facing,
      moveState: {
        direction: cloneVector(options.moveState.direction),
        moving: options.moveState.moving,
      },
    };

    actor.position = cloneVector(nextPose.position);
    actor.facing = nextPose.facing;
    actor.moveState = {
      direction: cloneVector(nextPose.moveState.direction),
      moving: nextPose.moveState.moving,
    };
    localControlledPose.value = nextPose;

    socket.value.emit('sim:input-frame', {
      roomId: room.value.roomId,
      syncId: currentSyncId.value,
      actorId: actor.id,
      issuedAt: Date.now(),
      payload: {
        position: cloneVector(nextPose.position),
        moveDirection: cloneVector(nextPose.moveState.direction),
        facing: nextPose.facing,
      },
    });
  }

  function emitSimulationInput(
    input: Omit<SimulationInput, 'roomId' | 'syncId' | 'issuedAt'>,
  ): boolean {
    if (room.value === null || socket.value === null || !canSendPlayerInput()) {
      return false;
    }

    const issuedAt = Date.now();
    const payload = {
      ...input,
      roomId: room.value.roomId,
      syncId: currentSyncId.value,
      issuedAt,
    } as SimulationInput;

    switch (payload.type) {
      case 'use-knockback-immune':
        socket.value.emit('sim:use-knockback-immune', payload);
        return true;
      case 'use-sprint':
        socket.value.emit('sim:use-sprint', payload);
        return true;
      default:
        return false;
    }
  }

  function sendContinuousInputFrame(frame: { moveDirection: Vector2; facing?: number }): void {
    if (room.value === null || socket.value === null || !canSendPlayerInput()) {
      return;
    }

    const actor = getCurrentPlayerActor();

    if (actor === null) {
      return;
    }

    const issuedAt = Date.now();
    const moveDirection = normalizeMoveDirection(frame.moveDirection);
    const nextPose = applyOptimisticContinuousInput({
      moveDirection,
      ...(frame.facing !== undefined ? { facing: frame.facing } : {}),
    });

    if (nextPose === null) {
      return;
    }

    socket.value.emit('sim:input-frame', {
      roomId: room.value.roomId,
      syncId: currentSyncId.value,
      actorId: actor.id,
      issuedAt,
      payload: {
        position: nextPose.position,
        moveDirection,
        facing: nextPose.facing,
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

  function applyOptimisticCooldown(options: {
    actorId: string;
    cooldown: 'knockbackImmune' | 'sprint';
    durationMs: number;
    currentTimeMs: number;
  }): void {
    if (authoritativeSnapshot.value === null) {
      return;
    }

    const actor = authoritativeSnapshot.value.actors.find(
      (candidate) => candidate.id === options.actorId,
    );

    if (actor === undefined) {
      return;
    }

    const readyAt = options.currentTimeMs + options.durationMs;

    if (options.cooldown === 'knockbackImmune') {
      actor.knockbackImmuneCooldown.readyAt = readyAt;
      return;
    }

    actor.sprintCooldown.readyAt = readyAt;
  }

  function useKnockbackImmune(currentTimeMs?: number): void {
    if (snapshot.value?.phase !== 'running' || !canSendPlayerInput()) {
      return;
    }

    const actor = getAuthoritativeCurrentPlayerActor();

    if (actor === null) {
      return;
    }

    const actionTimeMs = currentTimeMs ?? authoritativeSnapshot.value?.timeMs ?? 0;

    if (actor.knockbackImmuneCooldown.readyAt > actionTimeMs) {
      return;
    }

    const emitted = emitSimulationInput({
      actorId: actor.id,
      type: 'use-knockback-immune',
      payload: {
        issuedBy: 'player',
      },
    });

    if (!emitted) {
      return;
    }

    applyOptimisticCooldown({
      actorId: actor.id,
      cooldown: 'knockbackImmune',
      durationMs: KNOCKBACK_IMMUNE_COOLDOWN_MS,
      currentTimeMs: actionTimeMs,
    });
  }

  function useSprint(currentTimeMs?: number): void {
    if (snapshot.value?.phase !== 'running' || !canSendPlayerInput()) {
      return;
    }

    const actor = getAuthoritativeCurrentPlayerActor();

    if (actor === null) {
      return;
    }

    const actionTimeMs = currentTimeMs ?? authoritativeSnapshot.value?.timeMs ?? 0;

    if (actor.sprintCooldown.readyAt > actionTimeMs) {
      return;
    }

    const emitted = emitSimulationInput({
      actorId: actor.id,
      type: 'use-sprint',
      payload: {
        issuedBy: 'player',
      },
    });

    if (!emitted) {
      return;
    }

    applyOptimisticCooldown({
      actorId: actor.id,
      cooldown: 'sprint',
      durationMs: SPRINT_COOLDOWN_MS,
      currentTimeMs: actionTimeMs,
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
          if (event.payload.actorId === localControlledPose.value?.actorId) {
            break;
          }

          actor.position = event.payload.position;
          actor.facing = event.payload.facing;
        }
        break;
      }
      case 'actorForcedMovementRequested': {
        const actor = getCurrentPlayerActor();

        if (actor === null || actor.id !== event.payload.actorId) {
          break;
        }

        switch (event.payload.kind) {
          case 'knockback': {
            const nextPosition = add(
              actor.position,
              scale(
                normalize(subtract(actor.position, event.payload.source)),
                event.payload.distance,
              ),
            );

            submitLocalControlledPose({
              actorId: actor.id,
              position: nextPosition,
              facing: actor.facing,
              moveState: {
                direction: cloneVector(actor.moveState.direction),
                moving: actor.moveState.moving,
              },
            });
            break;
          }
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
        appendLog(`首领结算：${event.payload.actionName}`);
        break;
      case 'aoeSpawned':
        authoritativeSnapshot.value.mechanics = authoritativeSnapshot.value.mechanics.filter(
          (mechanic) => mechanic.id !== event.payload.id,
        );
        authoritativeSnapshot.value.mechanics.push(event.payload);
        appendLog(`机制出现：${event.payload.label}`);
        break;
      case 'aoeResolved':
        authoritativeSnapshot.value.mechanics = authoritativeSnapshot.value.mechanics.filter(
          (mechanic) => mechanic.id !== event.payload.mechanicId,
        );
        appendLog(`机制结算：${event.payload.mechanicId}`);
        break;
      case 'tetherTransferred': {
        const mechanic = authoritativeSnapshot.value.mechanics.find(
          (candidate) => candidate.id === event.payload.mechanicId,
        );

        if (mechanic?.kind === 'tether') {
          mechanic.targetId = event.payload.targetId;
        }
        break;
      }
      case 'damageApplied': {
        const actor = authoritativeSnapshot.value.actors.find(
          (candidate) => candidate.id === event.payload.targetId,
        );

        if (actor !== undefined) {
          actor.currentHp = event.payload.remainingHp;
          actor.alive = event.payload.remainingHp > 0;
          actor.lastDamageSource = event.payload.sourceLabel;

          if (!actor.alive && actor.id === localControlledPose.value?.actorId) {
            clearLocalControlledPose();
          }
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

          if (actor.id === localControlledPose.value?.actorId) {
            clearLocalControlledPose();
          }
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
    battleStaticData,
    rooms,
    room,
    snapshot,
    serverError,
    statusIconPreloadError,
    failedStatusIconUrls,
    roomPasswordRequired,
    roomPasswordPromptVisible,
    roomPasswordPromptMessage,
    connected,
    latencyDisplay,
    logs,
    serverCountdownSeconds,
    battleStartNoticeUntilMs,
    currentPlayerSlot,
    currentSpectator,
    isSpectating,
    page,
    loadLobbyData,
    updateProfile,
    createRoom,
    joinRoom,
    leaveRoom,
    selectBattle,
    switchSlot,
    spectate,
    startBattle,
    quickFail,
    sendContinuousInputFrame,
    previewFaceAngle,
    useKnockbackImmune,
    useSprint,
    recordStatusIconLoadFailure,
    submitRoomPassword,
    cancelRoomPasswordPrompt,
  };
});
