<script setup lang="ts">
import type { SelectOption } from 'naive-ui';
import { NCard, NLayoutHeader, NSelect, NTag } from 'naive-ui';
import type { OperationMode, SelectValue } from '../../utils/ui';

const props = defineProps<{
  connected: boolean;
  userName: string;
  operationMode: OperationMode;
}>();

const emit = defineEmits<{
  operationModeChange: [value: SelectValue];
}>();

const operationModeOptions: SelectOption[] = [
  { label: '传统', value: 'traditional' },
  { label: '标准', value: 'standard' },
];
</script>

<template>
  <n-layout-header class="shell-header">
    <n-card embedded class="topbar-card">
      <div class="topbar">
        <div>
          <p class="eyebrow">FF14 Arena Next</p>
          <h1 class="page-title">多人联机机制模拟 MVP</h1>
        </div>
        <div class="topbar-actions">
          <n-tag :type="props.connected ? 'success' : 'error'" size="large" round>
            {{ props.connected ? '服务器在线' : '服务器断开' }}
          </n-tag>
          <n-tag type="info" size="large" round> 当前用户：{{ props.userName }} </n-tag>
          <n-select
            class="mode-select"
            :value="props.operationMode"
            :options="operationModeOptions"
            @update:value="emit('operationModeChange', $event)"
          />
        </div>
      </div>
    </n-card>
  </n-layout-header>
</template>

<style scoped>
.shell-header {
  padding: 24px;
}

.topbar-card {
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.24);
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

.page-title {
  margin: 0;
}

.eyebrow {
  margin: 0 0 6px;
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(246, 239, 228, 0.55);
}

.mode-select {
  width: 140px;
}

@media (max-width: 768px) {
  .shell-header {
    padding: 16px;
  }

  .mode-select,
  .topbar-actions {
    width: 100%;
  }
}
</style>
