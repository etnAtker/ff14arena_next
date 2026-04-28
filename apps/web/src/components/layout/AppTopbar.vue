<script setup lang="ts">
import type { SelectOption } from 'naive-ui';
import { NButton, NCard, NLayoutHeader, NSelect, NTag } from 'naive-ui';
import type { SelectValue } from '../../utils/ui';

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

.topbar-card :deep(.n-card__content) {
  padding: 12px 16px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
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

.room-block {
  flex: 1;
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

  .topbar-actions {
    width: 100%;
  }
}
</style>
