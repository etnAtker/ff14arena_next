<script setup lang="ts">
import type { SelectOption } from 'naive-ui';
import { NButton, NCard, NIcon, NLayoutHeader, NSelect, NTag } from 'naive-ui';
import type { SelectValue } from '../../utils/ui';

const githubUrl = 'https://github.com/etnAtker/ff14arena_next';

const props = defineProps<{
  connected: boolean;
  latencyDisplay: string;
  userName: string;
  roomName: string | null;
  roomPhase: string | null;
  battleName: string | null;
  isOwner: boolean;
  battleOptions: SelectOption[];
  roomBattleId: string | null;
  battleSelectDisabled: boolean;
}>();

const emit = defineEmits<{
  selectBattle: [value: SelectValue];
  leaveRoom: [];
  openMetrics: [];
}>();
</script>

<template>
  <n-layout-header class="shell-header">
    <n-card embedded class="topbar-card">
      <div class="topbar">
        <div class="brand-block">
          <p class="eyebrow">FF14 Arena Next</p>
          <h1 class="page-title">联机机制模拟</h1>
        </div>
        <p v-if="!props.roomName" class="deployment-notice">
          若没有影响严重的恶性 Bug，模拟器仅会在 0:00 和 12:00
          左右进行闪断更新。更新会使服务器会清空所有房间，请见谅！
        </p>
        <div v-if="props.roomName" class="room-block">
          <div class="room-row single-line">
            <strong class="room-name">{{ props.roomName }}</strong>
            <n-tag
              v-if="props.roomPhase"
              :type="props.roomPhase === '模拟中' ? 'success' : 'info'"
              round
            >
              {{ props.roomPhase }}
            </n-tag>
            <span class="battle-name">{{ props.battleName ?? '未选择战斗' }}</span>
            <n-select
              v-if="props.isOwner"
              class="battle-select"
              :value="props.roomBattleId"
              :options="props.battleOptions"
              :disabled="props.battleSelectDisabled"
              placeholder="选择机制"
              @update:value="emit('selectBattle', $event)"
            />
          </div>
        </div>
        <div class="topbar-actions">
          <n-tag :type="props.connected ? 'success' : 'error'" size="large" round>
            {{ props.connected ? '服务器在线' : '服务器断开' }}
          </n-tag>
          <n-tag type="warning" size="large" round> 延迟：{{ props.latencyDisplay }} </n-tag>
          <n-tag type="info" size="large" round> 当前用户：{{ props.userName }} </n-tag>
          <n-button secondary @click="emit('openMetrics')">观测</n-button>
          <n-button v-if="props.roomName" secondary @click="emit('leaveRoom')">离开房间</n-button>
          <n-button
            tag="a"
            :href="githubUrl"
            target="_blank"
            rel="noopener noreferrer"
            secondary
            circle
            title="GitHub"
            aria-label="打开 GitHub 仓库"
          >
            <template #icon>
              <n-icon>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M12 2C6.48 2 2 6.59 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.49 0-.24-.01-.88-.01-1.73-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.55-1.14-4.55-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.32 9.32 0 0 1 12 7c.85 0 1.71.12 2.51.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.56 5.05.36.32.68.95.68 1.91 0 1.38-.01 2.49-.01 2.83 0 .27.18.59.69.49A10.17 10.17 0 0 0 22 12.25C22 6.59 17.52 2 12 2Z"
                  />
                </svg>
              </n-icon>
            </template>
          </n-button>
        </div>
      </div>
    </n-card>
  </n-layout-header>
</template>

<style scoped>
.shell-header {
  padding: 12px 20px 8px;
}

.topbar-card {
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.24);
}

.topbar-card :deep(.n-card-content) {
  padding: 12px 16px;
}

.topbar {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.brand-block {
  min-width: 160px;
}

.deployment-notice {
  margin: 0;
  justify-self: center;
  max-width: 760px;
  text-align: center;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(246, 239, 228, 0.74);
}

.room-block {
  min-width: 300px;
}

.room-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.room-row.single-line {
  flex-wrap: nowrap;
}

.room-name {
  font-size: 16px;
  white-space: nowrap;
}

.battle-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(246, 239, 228, 0.78);
}

.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 500;
}

.eyebrow {
  margin: 0 0 2px;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(246, 239, 228, 0.55);
}

.battle-select {
  width: 220px;
  flex: 0 0 220px;
}

@media (max-width: 768px) {
  .shell-header {
    padding: 16px;
  }

  .topbar {
    grid-template-columns: 1fr;
  }

  .brand-block,
  .deployment-notice,
  .room-block,
  .topbar-actions {
    width: 100%;
  }

  .deployment-notice {
    justify-self: stretch;
    text-align: left;
  }
}
</style>
