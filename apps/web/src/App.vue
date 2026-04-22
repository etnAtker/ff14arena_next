<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import BattleStage from './components/BattleStage.vue';
import { useAppStore } from './stores/app';

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
const pressedKeys = new Set<string>();

const isOwner = computed(() => room.value?.ownerUserId === profile.value.userId);
const currentReady = computed(() => {
  if (room.value === null || currentPlayerSlot.value === null) {
    return false;
  }

  return room.value.slots.find((slot) => slot.slot === currentPlayerSlot.value)?.ready ?? false;
});

const currentBattleName = computed(() => room.value?.battleName ?? '未选择战斗');

function movementVector(): { x: number; y: number } {
  return {
    x: (pressedKeys.has('KeyD') ? 1 : 0) - (pressedKeys.has('KeyA') ? 1 : 0),
    y: (pressedKeys.has('KeyS') ? 1 : 0) - (pressedKeys.has('KeyW') ? 1 : 0),
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

onMounted(async () => {
  await refreshLobby();
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);

  movementTimer = window.setInterval(() => {
    if (page.value !== 'battle') {
      return;
    }

    store.sendMove(movementVector());
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
        <BattleStage :snapshot="snapshot" @face="store.sendFace" />
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
            <dt>战斗提示</dt>
            <dd>{{ snapshot?.hud.battleMessage ?? '无' }}</dd>
          </div>
          <div>
            <dt>中心提示</dt>
            <dd>{{ snapshot?.hud.centerHint ?? '无' }}</dd>
          </div>
        </dl>
        <div class="failure-box">
          <h3>失败原因聚合</h3>
          <ul>
            <li v-for="reason in snapshot?.failureReasons ?? []" :key="reason">{{ reason }}</li>
            <li v-if="(snapshot?.failureReasons ?? []).length === 0">当前未写入失败标记</li>
          </ul>
        </div>
        <div class="control-row battle-controls">
          <button class="secondary-button" @click="store.useKnockbackImmune">防击退（1）</button>
          <button v-if="isOwner" class="ghost-button" @click="store.restartBattle">房主重开</button>
        </div>
        <p class="hint-text">移动：WASD，点击场地改变朝向，按键 1 使用防击退。</p>
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
