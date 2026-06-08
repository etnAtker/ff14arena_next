<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import { storeToRefs } from 'pinia';
import type { GlobalThemeOverrides, SelectOption } from 'naive-ui';
import {
  darkTheme,
  dateZhCN,
  NAlert,
  NButton,
  NConfigProvider,
  NGlobalStyle,
  NInput,
  NModal,
  NSpace,
  zhCN,
} from 'naive-ui';
import AppTopbar from './components/layout/AppTopbar.vue';
import { getCameraYawForFacing } from './components/battle/camera';
import { useAppStore } from './stores/app';
import { normalizeAngleDifference, rotateVector } from './utils/angle';
import { loadOperationMode, saveOperationMode } from './utils/operation-mode';
import type { OperationMode, SelectValue } from './utils/ui';
import type { BattleStartTimeOptions } from '@ff14arena/shared';

const HomePage = defineAsyncComponent(() => import('./components/pages/HomePage.vue'));
const BattlePage = defineAsyncComponent(() => import('./components/pages/BattlePage.vue'));
const ServerMetricsPage = defineAsyncComponent(
  () => import('./components/pages/ServerMetricsPage.vue'),
);

const MIN_CAMERA_ZOOM = 0.7;
const MAX_CAMERA_ZOOM = 2.4;

const themeOverrides: GlobalThemeOverrides = {
  common: {
    bodyColor: '#0d0d10',
    cardColor: 'rgba(26, 22, 20, 0.9)',
    modalColor: 'rgba(26, 22, 20, 0.96)',
    popoverColor: 'rgba(24, 20, 18, 0.98)',
    tableColor: 'rgba(26, 22, 20, 0.9)',
    borderColor: 'rgba(255, 223, 177, 0.14)',
    dividerColor: 'rgba(255, 223, 177, 0.1)',
    textColorBase: '#f6efe4',
    textColor1: '#f6efe4',
    textColor2: 'rgba(246, 239, 228, 0.82)',
    textColor3: 'rgba(246, 239, 228, 0.64)',
    primaryColor: '#c98b5a',
    primaryColorHover: '#d79d6f',
    primaryColorPressed: '#b97848',
    infoColor: '#84d0c4',
    successColor: '#7bc79b',
    warningColor: '#f0d08b',
    errorColor: '#e48686',
  },
  Card: {
    colorEmbedded: 'rgba(255, 255, 255, 0.02)',
    borderRadius: '20px',
  },
  Input: {
    color: 'rgba(255, 255, 255, 0.03)',
  },
  Select: {
    peers: {
      InternalSelection: {
        color: 'rgba(255, 255, 255, 0.03)',
      },
    },
  },
};

const store = useAppStore();
const {
  profile,
  battles,
  battleStaticData,
  rooms,
  room,
  snapshot,
  logs,
  connected,
  latencyDisplay,
  serverError,
  statusIconPreloadError,
  failedStatusIconUrls,
  roomPasswordPromptVisible,
  roomPasswordPromptMessage,
  currentPlayerSlot,
  isSpectating,
  serverCountdownSeconds,
  battleStartNoticeUntilMs,
  page,
} = storeToRefs(store);

const createRoomName = ref('练习房');
const createBattleId = ref<string>('');
const editUserName = ref(profile.value.userName);
const operationMode = ref<OperationMode>(loadOperationMode());
const cameraYaw = ref(0);
const cameraZoom = ref(1);
const startCountdownSeconds = ref(5);
const startTimeSeconds = ref(0);
const roomPasswordInput = ref('');
const isMetricsRoute = window.location.pathname === '/metrics';
const lastTraditionalFacing = ref<number | null>(null);
const pendingPointerFacing = ref<number | null>(null);
const lastSentPointerFacing = ref<number | null>(null);
const pressedKeys = new Set<string>();

const battleOptions = computed<SelectOption[]>(() =>
  battles.value.map((battle) => ({
    label: battle.name,
    value: battle.id,
  })),
);

const isOwner = computed(() => room.value?.ownerUserId === profile.value.userId);
const currentActor = computed(() => {
  if (currentPlayerSlot.value === null) {
    return null;
  }

  return snapshot.value?.actors.find((actor) => actor.slot === currentPlayerSlot.value) ?? null;
});
const canStart = computed(() => {
  if (!isOwner.value || room.value === null || snapshot.value?.phase !== 'waiting') {
    return false;
  }

  return room.value.battleId !== null && room.value.startCountdown === null;
});
const latestResult = computed(
  () => snapshot.value?.latestResult ?? room.value?.latestResult ?? null,
);
const startTimeOptions = computed<BattleStartTimeOptions | null>(
  () =>
    battleStaticData.value?.startTimeOptions ??
    battles.value.find((battle) => battle.id === room.value?.battleId)?.startTimeOptions ??
    null,
);
const roomPhaseLabel = computed(() => {
  if (snapshot.value === null) {
    return null;
  }

  return snapshot.value.phase === 'running' ? '模拟中' : '待开始';
});

function movementIntent(): { horizontal: number; vertical: number } {
  return {
    horizontal: (pressedKeys.has('KeyD') ? 1 : 0) - (pressedKeys.has('KeyA') ? 1 : 0),
    vertical: (pressedKeys.has('KeyS') ? 1 : 0) - (pressedKeys.has('KeyW') ? 1 : 0),
  };
}

function movementVector(): { x: number; y: number } {
  const { horizontal, vertical } = movementIntent();

  if (horizontal === 0 && vertical === 0) {
    return {
      x: 0,
      y: 0,
    };
  }

  if (operationMode.value === 'traditional') {
    return rotateVector(
      {
        x: horizontal,
        y: vertical,
      },
      cameraYaw.value,
    );
  }

  if (operationMode.value === 'fixed') {
    return {
      x: horizontal,
      y: vertical,
    };
  }

  const facing = currentActor.value?.facing ?? 0;
  const forward = {
    x: Math.cos(facing),
    y: Math.sin(facing),
  };
  const right = {
    x: Math.cos(facing + Math.PI / 2),
    y: Math.sin(facing + Math.PI / 2),
  };

  return {
    x: right.x * horizontal - forward.x * vertical,
    y: right.y * horizontal - forward.y * vertical,
  };
}

function updateOperationMode(value: SelectValue): void {
  operationMode.value = value === 'standard' || value === 'fixed' ? value : 'traditional';
  saveOperationMode(operationMode.value);
  pendingPointerFacing.value = null;
  lastSentPointerFacing.value = null;
}

function selectBattleByValue(value: SelectValue): void {
  if (typeof value !== 'string' || value.length === 0) {
    return;
  }

  void store.selectBattle(value);
}

async function refreshLobby(): Promise<void> {
  try {
    await store.loadLobbyData();
    if (createBattleId.value === '' && battles.value[0] !== undefined) {
      createBattleId.value = battles.value[0].id;
    }
  } catch (error) {
    console.error(error);
  }
}

async function handleCreateRoom(): Promise<void> {
  store.updateProfile(editUserName.value);
  try {
    await store.createRoom(createRoomName.value, createBattleId.value || undefined);
    await refreshLobby();
  } catch (error) {
    console.error(error);
  }
}

function handleJoinRoom(roomId: string): void {
  store.updateProfile(editUserName.value);
  void store.joinRoom(roomId);
}

function handleJoinSpectator(roomId: string): void {
  store.updateProfile(editUserName.value);
  void store.joinRoom(roomId, undefined, 'spectator');
}

function submitRoomPasswordPrompt(): void {
  const password = roomPasswordInput.value;
  roomPasswordInput.value = '';
  store.submitRoomPassword(password);
}

function cancelRoomPasswordPrompt(): void {
  roomPasswordInput.value = '';
  store.cancelRoomPasswordPrompt();
}

function openMetricsPage(): void {
  window.location.assign('/metrics');
}

function updateCameraYaw(nextYaw: number): void {
  cameraYaw.value = nextYaw;
}

function updateCameraZoom(nextZoom: number): void {
  cameraZoom.value = Math.min(Math.max(nextZoom, MIN_CAMERA_ZOOM), MAX_CAMERA_ZOOM);
}

function handlePointerFaceAngle(facing: number): void {
  store.previewFaceAngle(facing);
  pendingPointerFacing.value = facing;
}

function resetCameraZoom(): void {
  cameraZoom.value = 1;
}

function resetFacingInputState(): void {
  lastTraditionalFacing.value = null;
  pendingPointerFacing.value = null;
  lastSentPointerFacing.value = null;
}

function handleKeyDown(event: KeyboardEvent): void {
  pressedKeys.add(event.code);

  if (event.code === 'Digit1') {
    store.useKnockbackImmune();
  }

  if (event.code === 'Digit2') {
    store.useSprint();
  }
}

function handleKeyUp(event: KeyboardEvent): void {
  pressedKeys.delete(event.code);
}

let movementTimer: number | null = null;

watch(
  () => [snapshot.value?.tick, snapshot.value?.phase] as const,
  ([tick, phase], [, previousPhase]) => {
    const isBattleEndSnapshot = previousPhase === 'running' && phase === 'waiting';
    const isBattleStartSnapshot = previousPhase === 'waiting' && phase === 'running';

    if (snapshot.value !== null && tick === 0 && !isBattleEndSnapshot && !isBattleStartSnapshot) {
      cameraYaw.value =
        currentActor.value === null ? 0 : getCameraYawForFacing(currentActor.value.facing);
      cameraZoom.value = 1;
      resetFacingInputState();
    }
  },
);

watch(
  startTimeOptions,
  (options) => {
    if (options === null) {
      startTimeSeconds.value = 0;
      return;
    }

    const minSeconds = options.minMs / 1_000;
    const maxSeconds = options.maxMs / 1_000;
    const defaultSeconds = options.defaultMs / 1_000;
    const presetTimes = options.presets?.map((preset) => preset.timeMs) ?? [];

    if (presetTimes.length > 0) {
      const currentTimeMs = Math.round(startTimeSeconds.value * 1_000);

      if (!presetTimes.includes(currentTimeMs)) {
        startTimeSeconds.value = defaultSeconds;
      }

      return;
    }

    if (startTimeSeconds.value < minSeconds || startTimeSeconds.value > maxSeconds) {
      startTimeSeconds.value = defaultSeconds;
    }
  },
  { immediate: true },
);

watch(
  () => [currentPlayerSlot.value, snapshot.value?.battleId, snapshot.value?.phase],
  ([slot, battleId, phase], [previousSlot, previousBattleId, previousPhase]) => {
    const isSameControlledContext = slot === previousSlot && battleId === previousBattleId;

    if (
      currentActor.value === null ||
      slot === null ||
      (isSameControlledContext && phase === previousPhase)
    ) {
      return;
    }

    if (isSameControlledContext) {
      resetFacingInputState();
      return;
    }

    cameraYaw.value = getCameraYawForFacing(currentActor.value.facing);
    resetFacingInputState();
  },
);

onMounted(async () => {
  if (isMetricsRoute) {
    return;
  }

  await refreshLobby();
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);

  await nextTick();

  movementTimer = window.setInterval(() => {
    if (page.value !== 'battle') {
      return;
    }

    const direction = movementVector();
    let facing: number | undefined;

    if (operationMode.value === 'standard') {
      lastTraditionalFacing.value = null;

      if (pendingPointerFacing.value !== null) {
        if (
          lastSentPointerFacing.value === null ||
          Math.abs(
            normalizeAngleDifference(pendingPointerFacing.value, lastSentPointerFacing.value),
          ) >= 0.03
        ) {
          facing = pendingPointerFacing.value;
          lastSentPointerFacing.value = pendingPointerFacing.value;
        }
      }
    } else if (direction.x === 0 && direction.y === 0) {
      lastTraditionalFacing.value = null;
    } else {
      const nextFacing = Math.atan2(direction.y, direction.x);

      if (
        lastTraditionalFacing.value === null ||
        Math.abs(normalizeAngleDifference(nextFacing, lastTraditionalFacing.value)) >= 0.05
      ) {
        facing = nextFacing;
        lastTraditionalFacing.value = nextFacing;
      }
    }

    store.sendContinuousInputFrame({
      moveDirection: direction,
      ...(facing !== undefined ? { facing } : {}),
    });
  }, 50);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown);
  window.removeEventListener('keyup', handleKeyUp);

  if (movementTimer !== null) {
    window.clearInterval(movementTimer);
  }
});
</script>

<template>
  <n-config-provider
    :theme="darkTheme"
    :theme-overrides="themeOverrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <n-global-style />
    <div v-if="isMetricsRoute" class="metrics-shell">
      <ServerMetricsPage />
    </div>

    <div v-else class="shell">
      <AppTopbar
        :connected="connected"
        :latency-display="latencyDisplay"
        :user-name="profile.userName"
        :room-name="room?.name ?? null"
        :room-phase="roomPhaseLabel"
        :battle-name="snapshot?.battleName ?? room?.battleName ?? null"
        :is-owner="isOwner"
        :battle-options="battleOptions"
        :room-battle-id="room?.battleId ?? null"
        :battle-select-disabled="!isOwner || snapshot?.phase !== 'waiting'"
        @select-battle="selectBattleByValue"
        @leave-room="store.leaveRoom"
        @open-metrics="openMetricsPage"
      />

      <main :class="['shell-content', page === 'battle' ? 'battle-content' : 'home-content']">
        <n-alert v-if="serverError" type="error" :show-icon="false" closable class="content-alert">
          {{ serverError }}
        </n-alert>
        <n-alert
          v-if="statusIconPreloadError"
          type="error"
          :show-icon="false"
          closable
          class="content-alert"
        >
          {{ statusIconPreloadError }}
        </n-alert>

        <n-modal
          :show="roomPasswordPromptVisible"
          preset="dialog"
          title="房间密码"
          :mask-closable="false"
          @close="cancelRoomPasswordPrompt"
        >
          <n-space vertical :size="12">
            <span>{{ roomPasswordPromptMessage }}</span>
            <n-input
              v-model:value="roomPasswordInput"
              type="password"
              show-password-on="click"
              autofocus
              placeholder="输入房间密码"
              @keyup.enter="submitRoomPasswordPrompt"
            />
            <n-space justify="end">
              <n-button secondary @click="cancelRoomPasswordPrompt">取消</n-button>
              <n-button type="primary" @click="submitRoomPasswordPrompt">确认</n-button>
            </n-space>
          </n-space>
        </n-modal>

        <HomePage
          v-if="page === 'home'"
          :edit-user-name="editUserName"
          :create-room-name="createRoomName"
          :create-battle-id="createBattleId || null"
          :battle-options="battleOptions"
          :rooms="rooms"
          @edit-user-name-change="editUserName = $event"
          @create-room-name-change="createRoomName = $event"
          @create-battle-id-change="createBattleId = $event ?? ''"
          @create-room="handleCreateRoom"
          @refresh-lobby="refreshLobby"
          @join-room="handleJoinRoom"
          @join-spectator="handleJoinSpectator"
        />

        <div v-else class="battle-page-shell">
          <BattlePage
            :room="room"
            :snapshot="snapshot"
            :controlled-actor-id="currentActor?.id ?? null"
            :current-player-slot="currentPlayerSlot"
            :camera-yaw="cameraYaw"
            :camera-zoom="cameraZoom"
            :operation-mode="operationMode"
            :is-owner="isOwner"
            :is-spectating="isSpectating"
            :can-start="canStart"
            :start-countdown-seconds="startCountdownSeconds"
            :start-time-seconds="startTimeSeconds"
            :start-time-options="startTimeOptions"
            :server-countdown-seconds="serverCountdownSeconds"
            :battle-start-notice-until-ms="battleStartNoticeUntilMs"
            :logs="logs"
            :latest-result="latestResult"
            :status-metadata="battleStaticData?.statusMetadata ?? []"
            :failed-status-icon-urls="failedStatusIconUrls"
            :operation-mode-options="[
              { label: '传统', value: 'traditional' },
              { label: '标准', value: 'standard' },
              { label: '固定', value: 'fixed' },
            ]"
            @use-knockback-immune="store.useKnockbackImmune($event)"
            @use-sprint="store.useSprint($event)"
            @spectate="store.spectate"
            @start-battle="store.startBattle($event)"
            @quick-fail="store.quickFail"
            @room-options-change="store.updateRoomOptions($event)"
            @start-countdown-seconds-change="startCountdownSeconds = $event"
            @start-time-seconds-change="startTimeSeconds = $event"
            @switch-slot="store.switchSlot($event)"
            @reset-zoom="resetCameraZoom"
            @camera-yaw-change="updateCameraYaw"
            @camera-zoom-change="updateCameraZoom"
            @operation-mode-change="updateOperationMode"
            @face-angle="handlePointerFaceAngle"
            @status-icon-load-error="store.recordStatusIconLoadFailure($event)"
          />
        </div>
      </main>
    </div>
  </n-config-provider>
</template>

<style scoped>
:global(html, body) {
  height: 100%;
}

:global(body) {
  margin: 0;
  background:
    radial-gradient(circle at top, rgba(199, 139, 90, 0.15), transparent 28%),
    linear-gradient(180deg, #181312 0%, #0d0d10 100%);
}

:global(#app) {
  height: 100%;
}

.shell {
  height: 100dvh;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}

.metrics-shell {
  box-sizing: border-box;
  height: 100dvh;
  padding: 20px;
  overflow: auto;
}

.shell-content {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  gap: 12px;
  min-height: 0;
  padding: 0 20px 16px;
}

.home-content {
  overflow: auto;
}

.battle-content {
  box-sizing: border-box;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.content-alert {
  margin-bottom: 0;
  flex: 0 0 auto;
}

.battle-page-shell {
  flex: 1 1 auto;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.battle-page-shell :deep(.battle-layout) {
  flex: 1 1 auto;
  min-height: 0;
}

@media (max-width: 768px) {
  .shell-content {
    padding: 0 16px 16px;
  }
}
</style>
