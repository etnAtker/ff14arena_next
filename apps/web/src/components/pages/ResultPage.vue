<script setup lang="ts">
import {
  NButton,
  NCard,
  NEmpty,
  NGrid,
  NGi,
  NList,
  NListItem,
  NSpace,
  NTag,
  NText,
} from 'naive-ui';
import type { BaseActorSnapshot, EncounterResult } from '@ff14arena/shared';

const props = defineProps<{
  result: EncounterResult | null;
  roomName: string;
  battleName: string;
  isOwner: boolean;
  battleActors: BaseActorSnapshot[];
  resultFailureReasons: string[];
}>();

const emit = defineEmits<{
  restartBattle: [];
  leaveRoom: [];
}>();
</script>

<template>
  <n-card embedded>
    <template #header>
      <div>
        <p class="eyebrow">战斗结算</p>
        <h2 class="section-title">{{ props.result?.outcome === 'success' ? '成功' : '失败' }}</h2>
      </div>
    </template>

    <n-space vertical :size="16">
      <n-text depth="2">{{ props.roomName }} / {{ props.battleName }}</n-text>

      <n-card title="失败原因" size="small" embedded>
        <n-list v-if="props.resultFailureReasons.length > 0" bordered>
          <n-list-item v-for="reason in props.resultFailureReasons" :key="reason">{{
            reason
          }}</n-list-item>
        </n-list>
        <n-empty v-else description="没有失败原因，本轮判定为成功。" />
      </n-card>

      <n-grid cols="1 m:2 xl:4" responsive="screen" :x-gap="12" :y-gap="12">
        <n-gi v-for="actor in props.battleActors" :key="actor.id">
          <n-card size="small" embedded>
            <n-space vertical :size="8">
              <div class="slot-heading">
                <strong>{{ actor.slot }}</strong>
                <n-tag size="small" :type="actor.alive ? 'success' : 'error'" round>
                  {{ actor.name }}
                </n-tag>
              </div>
              <n-list size="small" bordered>
                <n-list-item>最终 HP：{{ actor.currentHp }}</n-list-item>
                <n-list-item>存活：{{ actor.alive ? '是' : '否' }}</n-list-item>
                <n-list-item>死亡原因：{{ actor.deathReason ?? '无' }}</n-list-item>
              </n-list>
            </n-space>
          </n-card>
        </n-gi>
      </n-grid>

      <n-space wrap>
        <n-button v-if="props.isOwner" type="primary" @click="emit('restartBattle')"
          >房主重开</n-button
        >
        <n-button secondary @click="emit('leaveRoom')">返回大厅列表</n-button>
      </n-space>
    </n-space>
  </n-card>
</template>

<style scoped>
.eyebrow {
  margin: 0 0 6px;
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(246, 239, 228, 0.55);
}

.section-title {
  margin: 0;
}

.slot-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
</style>
