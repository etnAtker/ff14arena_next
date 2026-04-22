<script setup lang="ts">
import { defineAsyncComponent } from 'vue';
import {
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NEmpty,
  NGrid,
  NGi,
  NList,
  NListItem,
  NProgress,
  NScrollbar,
  NSpace,
  NTag,
  NText,
} from 'naive-ui';
import type { BaseActorSnapshot, SimulationSnapshot } from '@ff14arena/shared';
import { getActorStatuses, getCooldownSeconds, type OperationMode } from '../../utils/ui';

const BattleStage = defineAsyncComponent(() => import('../battle/BattleStage.vue'));

const props = defineProps<{
  snapshot: SimulationSnapshot | null;
  controlledActorId: string | null;
  cameraYaw: number;
  cameraZoom: number;
  operationMode: OperationMode;
  isOwner: boolean;
  logs: string[];
  currentCastProgress: number;
  battleRunningTime: string;
  castDurationText: string;
  controlHint: string;
  recentFailureReasons: string[];
  battleActors: BaseActorSnapshot[];
}>();

const emit = defineEmits<{
  leaveRoom: [];
  useKnockbackImmune: [];
  restartBattle: [];
  resetZoom: [];
  cameraYawChange: [yaw: number];
  cameraZoomChange: [zoom: number];
  faceAngle: [facing: number];
}>();
</script>

<template>
  <n-grid cols="1 xl:5" responsive="screen" :x-gap="16" :y-gap="16">
    <n-gi span="1 xl:3">
      <n-card embedded>
        <template #header>
          <div class="card-header-row">
            <div>
              <p class="eyebrow">战斗中</p>
              <h2 class="section-title">{{ props.snapshot?.battleName }}</h2>
            </div>
            <n-button secondary @click="emit('leaveRoom')">离开房间</n-button>
          </div>
        </template>
        <Suspense>
          <BattleStage
            :snapshot="props.snapshot"
            :controlled-actor-id="props.controlledActorId"
            :camera-yaw="props.cameraYaw"
            :camera-zoom="props.cameraZoom"
            :operation-mode="props.operationMode"
            @camera-yaw-change="emit('cameraYawChange', $event)"
            @camera-zoom-change="emit('cameraZoomChange', $event)"
            @face-angle="emit('faceAngle', $event)"
          />
          <template #fallback>
            <div class="stage-placeholder">正在加载战斗场地渲染模块</div>
          </template>
        </Suspense>
      </n-card>
    </n-gi>

    <n-gi span="1 xl:2">
      <n-card title="HUD" embedded>
        <n-space vertical :size="16">
          <n-descriptions label-placement="top" bordered :column="1" size="small">
            <n-descriptions-item label="战斗时间">{{
              props.battleRunningTime
            }}</n-descriptions-item>
            <n-descriptions-item label="Boss 读条">
              {{ props.snapshot?.hud.bossCastBar?.actionName ?? '无' }}
            </n-descriptions-item>
            <n-descriptions-item label="总读条">{{ props.castDurationText }}</n-descriptions-item>
            <n-descriptions-item label="战斗提示">
              {{ props.snapshot?.hud.battleMessage ?? '无' }}
            </n-descriptions-item>
            <n-descriptions-item label="中心提示">
              {{ props.snapshot?.hud.centerHint ?? '无' }}
            </n-descriptions-item>
            <n-descriptions-item label="倒计时">
              {{ props.snapshot?.hud.countdownText ?? '无' }}
            </n-descriptions-item>
            <n-descriptions-item label="镜头缩放">
              {{ props.cameraZoom.toFixed(2) }}x
            </n-descriptions-item>
            <n-descriptions-item label="当前模式">
              {{ props.operationMode === 'traditional' ? '传统' : '标准' }}
            </n-descriptions-item>
          </n-descriptions>

          <div>
            <div class="metric-label">读条进度</div>
            <n-progress
              type="line"
              :percentage="Number((props.currentCastProgress * 100).toFixed(0))"
            />
          </div>

          <n-card title="失败原因聚合" size="small" embedded>
            <n-list v-if="props.recentFailureReasons.length > 0" bordered>
              <n-list-item v-for="reason in props.recentFailureReasons" :key="reason">
                {{ reason }}
              </n-list-item>
            </n-list>
            <n-empty v-else description="当前未写入失败标记" />
          </n-card>

          <n-space wrap>
            <n-button secondary @click="emit('useKnockbackImmune')">防击退（1）</n-button>
            <n-button v-if="props.isOwner" tertiary @click="emit('restartBattle')"
              >房主重开</n-button
            >
            <n-button tertiary @click="emit('resetZoom')">重置缩放</n-button>
          </n-space>

          <n-space vertical size="small">
            <n-text depth="2">{{ props.controlHint }}</n-text>
            <n-text depth="3">滚轮缩放，双击场地重置缩放，按键 1 使用防击退。</n-text>
          </n-space>
        </n-space>
      </n-card>
    </n-gi>

    <n-gi span="1 xl:3">
      <n-card title="队伍状态" embedded>
        <n-grid cols="1 m:2" responsive="screen" :x-gap="12" :y-gap="12">
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
                  <n-list-item>HP：{{ actor.currentHp }} / {{ actor.maxHp }}</n-list-item>
                  <n-list-item>存活：{{ actor.alive ? '是' : '否' }}</n-list-item>
                  <n-list-item>状态：{{ getActorStatuses(actor) }}</n-list-item>
                  <n-list-item
                    >防击退：{{ actor.knockbackImmune ? '生效中' : '未生效' }}</n-list-item
                  >
                  <n-list-item
                    >冷却：{{
                      getCooldownSeconds(actor, props.snapshot?.timeMs ?? 0)
                    }}s</n-list-item
                  >
                </n-list>
              </n-space>
            </n-card>
          </n-gi>
        </n-grid>
      </n-card>
    </n-gi>

    <n-gi span="1 xl:2">
      <n-card title="日志" embedded>
        <n-scrollbar class="log-scrollbar">
          <n-list v-if="props.logs.length > 0" bordered>
            <n-list-item v-for="line in props.logs" :key="line">{{ line }}</n-list-item>
          </n-list>
          <n-empty v-else description="当前没有日志。" />
        </n-scrollbar>
      </n-card>
    </n-gi>
  </n-grid>
</template>

<style scoped>
.card-header-row,
.slot-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

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

.metric-label {
  margin-bottom: 8px;
  font-size: 13px;
  color: rgba(246, 239, 228, 0.72);
}

.log-scrollbar {
  max-height: 360px;
}

.stage-placeholder {
  min-height: 520px;
  display: grid;
  place-items: center;
  border-radius: 16px;
  background: rgba(10, 21, 23, 0.55);
  color: rgba(246, 239, 228, 0.72);
}
</style>
