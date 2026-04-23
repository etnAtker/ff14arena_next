import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { Socket } from 'socket.io-client';
import { movePosition, normalizeMoveDirection } from '@ff14arena/core';
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
const CONTINUOUS_INPUT_INTERVAL_MS = 50;
const TRANSPORT_PROBE_INTERVAL_MS = 1_500;

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

function normalizeAngleDifference(left: number, right: number): number {
  return Math.atan2(Math.sin(left - right), Math.cos(left - right));
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

function cloneVector(vector: Vector2): Vector2 {
  return {
    x: vector.x,
    y: vector.y,
  };
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
  const facingPreview = ref<FacingPreviewState | null>(null);
  const lastResyncRequestedAt = ref(0);
  const transportProbeLatencyMs = ref(0);
  const localControlledPose = ref<LocalControlledPose | null>(null);
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
    const currentRoom = room.value;

    if (currentRoom === null) {
      return null;
    }

    const hit = currentRoom.slots.find((slot) => slot.ownerUserId === profile.value.userId);
    return hit?.slot ?? null;
  });

  const page = computed<'home' | 'battle'>(() => (room.value === null ? 'home' : 'battle'));
  const latencyDisplay = computed(() =>
    transportProbeLatencyMs.value > 0 ? `${Math.round(transportProbeLatencyMs.value)} ms` : '--',
  );

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

  function clearLocalControlledPose(): void {
    localControlledPose.value = null;
  }

  function resetSyncState(options?: { clearInputSeq?: boolean }): void {
    authoritativeSnapshot.value = null;
    currentSyncId.value = 0;
    clearLocalControlledPose();
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

    const actor = snapshot.value?.actors.find((candidate) => candidate.slot === slot) ?? null;

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
        startTransportProbeLoop();
        rejoinCurrentRoom();
      });

      nextSocket.on('disconnect', () => {
        connected.value = false;
        stopTransportProbeLoop();
        clearLocalControlledPose();
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
        clearLocalControlledPose();
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
    const nextPosition = movePosition(actor.position, direction, CONTINUOUS_INPUT_INTERVAL_MS);

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

  function emitSimulationInput(
    input: Omit<SimulationInput, 'roomId' | 'inputSeq' | 'issuedAt'>,
  ): void {
    if (room.value === null || socket.value === null) {
      return;
    }

    inputSeq.value += 1;
    const issuedAt = Date.now();
    const payload = {
      ...input,
      roomId: room.value.roomId,
      inputSeq: inputSeq.value,
      issuedAt,
    } as SimulationInput;

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
      actorId: actor.id,
      inputSeq: nextInputSeq,
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
          if (
            event.payload.actorId === localControlledPose.value?.actorId &&
            event.payload.correctionMode !== 'hard'
          ) {
            break;
          }

          actor.position = event.payload.position;
          actor.facing = event.payload.facing;

          if (event.payload.actorId === localControlledPose.value?.actorId) {
            localControlledPose.value = {
              actorId: actor.id,
              position: cloneVector(event.payload.position),
              facing: event.payload.facing,
              moveState: {
                direction: cloneVector(actor.moveState.direction),
                moving: actor.moveState.moving,
              },
            };
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
    rooms,
    room,
    snapshot,
    serverError,
    connected,
    latencyDisplay,
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
