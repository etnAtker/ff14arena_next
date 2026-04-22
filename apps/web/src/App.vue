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
  NConfigProvider,
  NGlobalStyle,
  NLayout,
  NLayoutContent,
  zhCN,
} from 'naive-ui';
import AppTopbar from './components/layout/AppTopbar.vue';
import { getCameraYawForFacing } from './components/battle/camera';
import { useAppStore } from './stores/app';
import type { OperationMode, SelectValue } from './utils/ui';

const HomePage = defineAsyncComponent(() => import('./components/pages/HomePage.vue'));
const LobbyPage = defineAsyncComponent(() => import('./components/pages/LobbyPage.vue'));
const BattlePage = defineAsyncComponent(() => import('./components/pages/BattlePage.vue'));
const ResultPage = defineAsyncComponent(() => import('./components/pages/ResultPage.vue'));

const OPERATION_MODE_STORAGE_KEY = 'ff14arena:operation-mode';

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
  Layout: {
    color: 'transparent',
    headerColor: 'transparent',
  },
};

function preloadDeferredModules(): void {
  void Promise.allSettled([
    import('./components/pages/HomePage.vue'),
    import('./components/pages/LobbyPage.vue'),
    import('./components/pages/BattlePage.vue'),
    import('./components/pages/ResultPage.vue'),
    import('./components/battle/BattleStage.vue'),
    import('socket.io-client'),
  ]);
}

function loadOperationMode(): OperationMode {
  const raw = window.localStorage.getItem(OPERATION_MODE_STORAGE_KEY);
  return raw === 'standard' ? 'standard' : 'traditional';
}

function rotateVector(vector: { x: number; y: number }, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos,
  };
}

function normalizeAngleDifference(left: number, right: number): number {
  return Math.atan2(Math.sin(left - right), Math.cos(left - right));
}

const store = useAppStore();
const {
  profile,
  battles,
  rooms,
  room,
  snapshot,
  result,
  logs,
  connected,
  serverError,
  currentPlayerSlot,
  page,
} = storeToRefs(store);

const createRoomName = ref('练习房');
const createBattleId = ref<string>('');
const editUserName = ref(profile.value.userName);
const operationMode = ref<OperationMode>(loadOperationMode());
const cameraYaw = ref(0);
const cameraZoom = ref(1);
const lastTraditionalFacing = ref<number | null>(null);
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
const currentReady = computed(() => {
  if (room.value === null || currentPlayerSlot.value === null) {
    return false;
  }

  return room.value.slots.find((slot) => slot.slot === currentPlayerSlot.value)?.ready ?? false;
});
const currentBattleName = computed(() => room.value?.battleName ?? '未选择战斗');
const currentCastProgress = computed(() => {
  const castBar = snapshot.value?.hud.bossCastBar;

  if (castBar === null || castBar === undefined || snapshot.value === null) {
    return 0;
  }

  const elapsed = Math.max(snapshot.value.timeMs - castBar.startedAt, 0);
  return Math.min(elapsed / castBar.totalDurationMs, 1);
});
const controlHint = computed(() =>
  operationMode.value === 'traditional'
    ? '传统：左键或右键拖拽转镜头，移动方向跟随镜头，移动时人物自动转向。'
    : '标准：左键拖拽转镜头，右键拖拽同时转镜头和人物，移动方向跟随人物朝向。',
);
const recentFailureReasons = computed(
  () => snapshot.value?.hud.recentFailureReason ?? snapshot.value?.failureReasons ?? [],
);
const resultFailureReasons = computed(() => result.value?.failureReasons ?? []);
const battleActors = computed(() => snapshot.value?.actors ?? []);
const battleRunningTime = computed(() => `${((snapshot.value?.timeMs ?? 0) / 1000).toFixed(1)}s`);
const castDurationText = computed(() => {
  const castBar = snapshot.value?.hud.bossCastBar;
  return castBar === null || castBar === undefined
    ? '无'
    : `${(castBar.totalDurationMs / 1000).toFixed(1)}s`;
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
  operationMode.value = value === 'standard' ? 'standard' : 'traditional';
  window.localStorage.setItem(OPERATION_MODE_STORAGE_KEY, operationMode.value);
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

function updateCameraYaw(nextYaw: number): void {
  cameraYaw.value = nextYaw;
}

function updateCameraZoom(nextZoom: number): void {
  cameraZoom.value = nextZoom;
}

function resetCameraZoom(): void {
  cameraZoom.value = 1;
}

function handleKeyDown(event: KeyboardEvent): void {
  pressedKeys.add(event.code);

  if (event.code === 'Digit1') {
    store.useKnockbackImmune();
  }
}

function handleKeyUp(event: KeyboardEvent): void {
  pressedKeys.delete(event.code);
}

let movementTimer: number | null = null;

watch(
  () => snapshot.value?.tick,
  (tick) => {
    if (snapshot.value !== null && tick === 0) {
      cameraYaw.value =
        currentActor.value === null ? 0 : getCameraYawForFacing(currentActor.value.facing);
      cameraZoom.value = 1;
      lastTraditionalFacing.value = null;
    }
  },
);

onMounted(async () => {
  await refreshLobby();
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);

  await nextTick();
  window.setTimeout(preloadDeferredModules, 0);

  movementTimer = window.setInterval(() => {
    if (page.value !== 'battle') {
      return;
    }

    const direction = movementVector();
    store.sendMove(direction);

    if (operationMode.value !== 'traditional') {
      lastTraditionalFacing.value = null;
      return;
    }

    if (direction.x === 0 && direction.y === 0) {
      lastTraditionalFacing.value = null;
      return;
    }

    const facing = Math.atan2(direction.y, direction.x);

    if (
      lastTraditionalFacing.value === null ||
      Math.abs(normalizeAngleDifference(facing, lastTraditionalFacing.value)) >= 0.05
    ) {
      store.sendFaceAngle(facing);
      lastTraditionalFacing.value = facing;
    }
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
    <n-layout class="shell">
      <AppTopbar
        :connected="connected"
        :user-name="profile.userName"
        :operation-mode="operationMode"
        @operation-mode-change="updateOperationMode"
      />

      <n-layout-content class="shell-content">
        <n-alert v-if="serverError" type="error" :show-icon="false" closable class="content-alert">
          {{ serverError }}
        </n-alert>

        <Suspense>
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
          />

          <LobbyPage
            v-else-if="page === 'lobby'"
            :room="room"
            :is-owner="isOwner"
            :current-ready="currentReady"
            :current-battle-name="currentBattleName"
            :battle-options="battleOptions"
            :room-battle-id="room?.battleId ?? null"
            @leave-room="store.leaveRoom"
            @toggle-ready="store.setReady(!currentReady)"
            @start-battle="store.startBattle"
            @select-battle="selectBattleByValue"
          />

          <BattlePage
            v-else-if="page === 'battle'"
            :snapshot="snapshot"
            :controlled-actor-id="currentActor?.id ?? null"
            :camera-yaw="cameraYaw"
            :camera-zoom="cameraZoom"
            :operation-mode="operationMode"
            :is-owner="isOwner"
            :logs="logs"
            :current-cast-progress="currentCastProgress"
            :battle-running-time="battleRunningTime"
            :cast-duration-text="castDurationText"
            :control-hint="controlHint"
            :recent-failure-reasons="recentFailureReasons"
            :battle-actors="battleActors"
            @leave-room="store.leaveRoom"
            @use-knockback-immune="store.useKnockbackImmune"
            @restart-battle="store.restartBattle"
            @reset-zoom="resetCameraZoom"
            @camera-yaw-change="updateCameraYaw"
            @camera-zoom-change="updateCameraZoom"
            @face-angle="store.sendFaceAngle"
          />

          <ResultPage
            v-else
            :result="result"
            :room-name="room?.name ?? '-'"
            :battle-name="snapshot?.battleName ?? '-'"
            :is-owner="isOwner"
            :battle-actors="battleActors"
            :result-failure-reasons="resultFailureReasons"
            @restart-battle="store.restartBattle"
            @leave-room="store.leaveRoom"
          />

          <template #fallback>
            <section class="async-placeholder">
              <p class="async-title">正在加载界面模块</p>
              <p class="async-text">页面组件和联机依赖会按需加载，避免首页首包过重。</p>
            </section>
          </template>
        </Suspense>
      </n-layout-content>
    </n-layout>
  </n-config-provider>
</template>

<style scoped>
:global(body) {
  margin: 0;
  background:
    radial-gradient(circle at top, rgba(199, 139, 90, 0.15), transparent 28%),
    linear-gradient(180deg, #181312 0%, #0d0d10 100%);
}

:global(#app) {
  min-height: 100vh;
}

.shell {
  min-height: 100vh;
}

.shell-content {
  padding: 0 24px 24px;
}

.content-alert {
  margin-bottom: 16px;
}

.async-placeholder {
  min-height: 320px;
  display: grid;
  place-items: center;
  text-align: center;
  border: 1px solid rgba(255, 223, 177, 0.14);
  border-radius: 20px;
  background: rgba(26, 22, 20, 0.7);
  padding: 32px 20px;
}

.async-title {
  margin: 0 0 8px;
  font-size: 18px;
  color: #f6efe4;
}

.async-text {
  margin: 0;
  color: rgba(246, 239, 228, 0.7);
}

@media (max-width: 768px) {
  .shell-content {
    padding: 0 16px 16px;
  }
}
</style>
