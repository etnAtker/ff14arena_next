<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import BattleStage from './components/BattleStage.vue';
import { useAppStore } from './stores/app';

type OperationMode = 'traditional' | 'standard';

const OPERATION_MODE_STORAGE_KEY = 'ff14arena:operation-mode';

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
    ? '传统：左键/右键拖拽转镜头，移动方向跟随镜头，移动时人物自动转向。'
    : '标准：左键拖拽转镜头，右键拖拽同时转镜头和人物，移动方向跟随人物朝向。',
);
const recentFailureReasons = computed(
  () => snapshot.value?.hud.recentFailureReason ?? snapshot.value?.failureReasons ?? [],
);

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
  store.joinRoom(roomId);
}

function handleOperationModeChange(event: Event): void {
  const nextMode = (event.target as HTMLSelectElement).value as OperationMode;
  operationMode.value = nextMode === 'standard' ? 'standard' : 'traditional';
  window.localStorage.setItem(OPERATION_MODE_STORAGE_KEY, operationMode.value);
}

function updateCameraYaw(nextYaw: number): void {
  cameraYaw.value = nextYaw;
}

function updateCameraZoom(nextZoom: number): void {
  cameraZoom.value = nextZoom;
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
      cameraYaw.value = 0;
      cameraZoom.value = 1;
      lastTraditionalFacing.value = null;
    }
  },
);

onMounted(async () => {
  await refreshLobby();
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);

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
  <main class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">FF14 Arena Next</p>
        <h1>多人联机机制模拟 MVP</h1>
      </div>
      <div class="status-bar">
        <span :class="['pill', connected ? 'is-connected' : 'is-disconnected']">
          {{ connected ? '服务器在线' : '服务器断开' }}
        </span>
        <span class="pill">当前用户：{{ profile.userName }}</span>
        <label class="pill mode-pill">
          <span>操作模式</span>
          <select :value="operationMode" @change="handleOperationModeChange">
            <option value="traditional">传统</option>
            <option value="standard">标准</option>
          </select>
        </label>
      </div>
    </header>

    <p v-if="serverError" class="error-banner">{{ serverError }}</p>

    <section v-if="page === 'home'" class="layout home-layout">
      <article class="panel create-panel">
        <h2>创建房间</h2>
        <label class="field">
          <span>昵称</span>
          <input v-model="editUserName" maxlength="24" />
        </label>
        <label class="field">
          <span>房间名</span>
          <input v-model="createRoomName" maxlength="32" />
        </label>
        <label class="field">
          <span>战斗</span>
          <select v-model="createBattleId">
            <option v-for="battle in battles" :key="battle.id" :value="battle.id">
              {{ battle.name }}
            </option>
          </select>
        </label>
        <button class="primary-button" @click="handleCreateRoom">创建并进入</button>
      </article>

      <article class="panel room-panel">
        <div class="panel-header">
          <h2>当前房间</h2>
          <button class="ghost-button" @click="refreshLobby">刷新</button>
        </div>
        <ul class="room-list">
          <li v-for="roomItem in rooms" :key="roomItem.roomId" class="room-card">
            <div>
              <strong>{{ roomItem.name }}</strong>
              <p>{{ roomItem.battleName ?? '未选择战斗' }}</p>
              <p>状态：{{ roomItem.phase }} / 人数：{{ roomItem.occupantCount }}</p>
            </div>
            <button class="secondary-button" @click="handleJoinRoom(roomItem.roomId)">加入</button>
          </li>
          <li v-if="rooms.length === 0" class="empty-state">当前没有房间，直接创建即可。</li>
        </ul>
      </article>
    </section>

    <section v-else-if="page === 'lobby'" class="layout lobby-layout">
      <article class="panel room-overview">
        <div class="panel-header">
          <div>
            <p class="eyebrow">房间大厅</p>
            <h2>{{ room?.name }}</h2>
          </div>
          <button class="ghost-button" @click="store.leaveRoom">离开房间</button>
        </div>
        <p class="overview-text">房主：{{ room?.ownerName }}，当前战斗：{{ currentBattleName }}</p>
        <div class="control-row">
          <label v-if="isOwner" class="field compact-field">
            <span>切换战斗</span>
            <select
              :value="room?.battleId ?? ''"
              @change="store.selectBattle(($event.target as HTMLSelectElement).value)"
            >
              <option value="" disabled>请选择战斗</option>
              <option v-for="battle in battles" :key="battle.id" :value="battle.id">
                {{ battle.name }}
              </option>
            </select>
          </label>
          <button class="secondary-button" @click="store.setReady(!currentReady)">
            {{ currentReady ? '取消准备' : '准备就绪' }}
          </button>
          <button v-if="isOwner" class="primary-button" @click="store.startBattle">开始战斗</button>
        </div>
      </article>

      <article class="panel slots-panel">
        <h2>8 槽位编组</h2>
        <ul class="slot-list">
          <li v-for="slot in PARTY_SLOT_ORDER" :key="slot" class="slot-card">
            <div class="slot-title">
              <strong>{{ slot }}</strong>
              <span>
                {{
                  room?.slots.find((item) => item.slot === slot)?.occupantType === 'empty'
                    ? '空位'
                    : room?.slots.find((item) => item.slot === slot)?.occupantType === 'bot'
                      ? 'Bot'
                      : '玩家'
                }}
              </span>
            </div>
            <p>{{ room?.slots.find((item) => item.slot === slot)?.name ?? '等待加入' }}</p>
            <p>
              在线：
              {{
                room?.slots.find((item) => item.slot === slot)?.online
                  ? '在线'
                  : room?.slots.find((item) => item.slot === slot)?.occupantType === 'player'
                    ? '离线'
                    : '-'
              }}
            </p>
            <p>准备：{{ room?.slots.find((item) => item.slot === slot)?.ready ? '是' : '否' }}</p>
            <p>HP：{{ room?.slots.find((item) => item.slot === slot)?.currentHp ?? '-' }}</p>
            <p>
              存活：{{
                room?.slots.find((item) => item.slot === slot)?.alive === false ? '否' : '是'
              }}
            </p>
            <p>
              防击退：
              {{
                room?.slots.find((item) => item.slot === slot)?.knockbackImmune ? '生效中' : '无'
              }}
            </p>
          </li>
        </ul>
      </article>
    </section>

    <section v-else-if="page === 'battle'" class="layout battle-layout">
      <article class="panel stage-panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">战斗中</p>
            <h2>{{ snapshot?.battleName }}</h2>
          </div>
          <button class="ghost-button" @click="store.leaveRoom">离开房间</button>
        </div>
        <BattleStage
          :snapshot="snapshot"
          :controlled-actor-id="currentActor?.id ?? null"
          :camera-yaw="cameraYaw"
          :camera-zoom="cameraZoom"
          :operation-mode="operationMode"
          @camera-yaw-change="updateCameraYaw"
          @camera-zoom-change="updateCameraZoom"
          @face-angle="store.sendFaceAngle"
        />
      </article>

      <article class="panel hud-panel">
        <h2>HUD</h2>
        <dl class="data-list">
          <div>
            <dt>战斗时间</dt>
            <dd>{{ ((snapshot?.timeMs ?? 0) / 1000).toFixed(1) }}s</dd>
          </div>
          <div>
            <dt>Boss 读条</dt>
            <dd>{{ snapshot?.hud.bossCastBar?.actionName ?? '无' }}</dd>
          </div>
          <div>
            <dt>读条进度</dt>
            <dd>{{ (currentCastProgress * 100).toFixed(0) }}%</dd>
          </div>
          <div>
            <dt>总读条</dt>
            <dd>
              {{
                snapshot?.hud.bossCastBar === null || snapshot?.hud.bossCastBar === undefined
                  ? '无'
                  : `${(snapshot.hud.bossCastBar.totalDurationMs / 1000).toFixed(1)}s`
              }}
            </dd>
          </div>
          <div>
            <dt>战斗提示</dt>
            <dd>{{ snapshot?.hud.battleMessage ?? '无' }}</dd>
          </div>
          <div>
            <dt>中心提示</dt>
            <dd>{{ snapshot?.hud.centerHint ?? '无' }}</dd>
          </div>
          <div>
            <dt>倒计时</dt>
            <dd>{{ snapshot?.hud.countdownText ?? '无' }}</dd>
          </div>
          <div>
            <dt>镜头缩放</dt>
            <dd>{{ cameraZoom.toFixed(2) }}x</dd>
          </div>
          <div>
            <dt>当前模式</dt>
            <dd>{{ operationMode === 'traditional' ? '传统' : '标准' }}</dd>
          </div>
        </dl>
        <div class="failure-box">
          <h3>失败原因聚合</h3>
          <ul>
            <li v-for="reason in recentFailureReasons" :key="reason">{{ reason }}</li>
            <li v-if="recentFailureReasons.length === 0">当前未写入失败标记</li>
          </ul>
        </div>
        <div class="control-row battle-controls">
          <button class="secondary-button" @click="store.useKnockbackImmune">防击退（1）</button>
          <button v-if="isOwner" class="ghost-button" @click="store.restartBattle">房主重开</button>
          <button class="ghost-button" @click="cameraZoom = 1">重置缩放</button>
        </div>
        <p class="hint-text">{{ controlHint }}</p>
        <p class="hint-text">滚轮缩放，双击场地重置缩放，按键 1 使用防击退。</p>
      </article>

      <article class="panel party-panel">
        <h2>队伍状态</h2>
        <ul class="party-list">
          <li v-for="actor in snapshot?.actors ?? []" :key="actor.id" class="party-card">
            <div class="slot-title">
              <strong>{{ actor.slot }}</strong>
              <span>{{ actor.name }}</span>
            </div>
            <p>HP：{{ actor.currentHp }} / {{ actor.maxHp }}</p>
            <p>存活：{{ actor.alive ? '是' : '否' }}</p>
            <p>状态：{{ actor.statuses.map((status) => status.name).join('、') || '无' }}</p>
            <p>防击退：{{ actor.knockbackImmune ? '生效中' : '未生效' }}</p>
            <p>
              冷却：
              {{
                Math.max(
                  (actor.knockbackImmuneCooldown.readyAt - (snapshot?.timeMs ?? 0)) / 1000,
                  0,
                ).toFixed(1)
              }}s
            </p>
          </li>
        </ul>
      </article>

      <article class="panel log-panel">
        <h2>日志</h2>
        <ul class="log-list">
          <li v-for="line in logs" :key="line">{{ line }}</li>
        </ul>
      </article>
    </section>

    <section v-else class="layout result-layout">
      <article class="panel result-panel">
        <p class="eyebrow">战斗结算</p>
        <h2>{{ result?.outcome === 'success' ? '成功' : '失败' }}</h2>
        <p class="overview-text">{{ room?.name }} / {{ snapshot?.battleName }}</p>
        <div class="failure-box">
          <h3>失败原因</h3>
          <ul>
            <li v-for="reason in result?.failureReasons ?? []" :key="reason">{{ reason }}</li>
            <li v-if="(result?.failureReasons ?? []).length === 0">
              没有失败原因，本轮判定为成功。
            </li>
          </ul>
        </div>
        <ul class="party-list result-party-list">
          <li v-for="actor in snapshot?.actors ?? []" :key="actor.id" class="party-card">
            <div class="slot-title">
              <strong>{{ actor.slot }}</strong>
              <span>{{ actor.name }}</span>
            </div>
            <p>最终 HP：{{ actor.currentHp }}</p>
            <p>存活：{{ actor.alive ? '是' : '否' }}</p>
            <p>死亡原因：{{ actor.deathReason ?? '无' }}</p>
          </li>
        </ul>
        <div class="control-row">
          <button v-if="isOwner" class="primary-button" @click="store.restartBattle">
            房主重开
          </button>
          <button class="ghost-button" @click="store.leaveRoom">返回大厅列表</button>
        </div>
      </article>
    </section>
  </main>
</template>

<style scoped>
:global(body) {
  margin: 0;
  background:
    radial-gradient(circle at top, rgba(199, 139, 90, 0.15), transparent 28%),
    linear-gradient(180deg, #181312 0%, #0d0d10 100%);
  color: #f6efe4;
  font-family: 'Noto Sans SC', 'PingFang SC', sans-serif;
}

:global(*) {
  box-sizing: border-box;
}

.shell {
  min-height: 100vh;
  padding: 28px;
}

.topbar,
.panel {
  border: 1px solid rgba(255, 223, 177, 0.14);
  border-radius: 24px;
  background: rgba(26, 22, 20, 0.88);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.32);
}

.topbar {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: center;
  padding: 24px 28px;
}

.layout {
  display: grid;
  gap: 20px;
  margin-top: 20px;
}

.home-layout {
  grid-template-columns: minmax(320px, 420px) 1fr;
}

.lobby-layout,
.result-layout {
  grid-template-columns: 1fr;
}

.battle-layout {
  grid-template-columns: minmax(520px, 1.5fr) minmax(280px, 360px);
  grid-template-areas:
    'stage hud'
    'party log';
}

.stage-panel {
  grid-area: stage;
}

.hud-panel {
  grid-area: hud;
}

.party-panel {
  grid-area: party;
}

.log-panel {
  grid-area: log;
}

.panel {
  padding: 24px;
}

.panel-header,
.control-row,
.status-bar,
.slot-title {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.eyebrow {
  margin: 0 0 8px;
  color: #dfa868;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-size: 12px;
}

h1,
h2,
h3,
p {
  margin-top: 0;
}

h1 {
  margin-bottom: 0;
  font-size: 32px;
}

h2 {
  margin-bottom: 12px;
  font-size: 24px;
}

.pill,
button,
input,
select {
  border-radius: 14px;
}

.pill {
  display: inline-flex;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.06);
}

.mode-pill {
  align-items: center;
  gap: 10px;
}

.mode-pill select {
  padding: 6px 10px;
}

.is-connected {
  color: #86e0b8;
}

.is-disconnected {
  color: #f0a1a1;
}

.field {
  display: grid;
  gap: 8px;
  margin-bottom: 14px;
}

.compact-field {
  margin-bottom: 0;
}

input,
select,
button {
  border: 1px solid rgba(255, 223, 177, 0.16);
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  font: inherit;
}

button {
  cursor: pointer;
}

.primary-button {
  background: linear-gradient(135deg, #c97f55, #9d5032);
}

.secondary-button {
  background: linear-gradient(135deg, #4d8477, #29564d);
}

.ghost-button {
  background: rgba(255, 255, 255, 0.04);
}

.overview-text,
.hint-text,
.room-card p,
.slot-card p,
.party-card p {
  color: rgba(246, 239, 228, 0.78);
}

.room-list,
.slot-list,
.party-list,
.log-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.room-list,
.slot-list,
.party-list {
  display: grid;
  gap: 12px;
}

.slot-list {
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.party-list {
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.room-card,
.slot-card,
.party-card,
.failure-box,
.data-list {
  border: 1px solid rgba(255, 223, 177, 0.1);
  border-radius: 18px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
}

.data-list {
  display: grid;
  gap: 12px;
}

.data-list div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.log-list {
  max-height: 320px;
  overflow: auto;
  display: grid;
  gap: 8px;
  color: rgba(246, 239, 228, 0.78);
}

.failure-box {
  margin-top: 16px;
}

.failure-box ul {
  margin: 12px 0 0;
  padding-left: 18px;
}

.error-banner {
  margin: 16px 0 0;
  padding: 14px 16px;
  border-radius: 18px;
  background: rgba(200, 76, 76, 0.16);
  color: #ffb5b5;
}

.empty-state {
  padding: 18px;
  color: rgba(246, 239, 228, 0.7);
}

.result-party-list {
  margin-top: 20px;
}

@media (max-width: 1080px) {
  .home-layout,
  .battle-layout {
    grid-template-columns: 1fr;
    grid-template-areas:
      'stage'
      'hud'
      'party'
      'log';
  }

  .topbar,
  .status-bar {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
