<script setup lang="ts">
import type { SelectOption } from 'naive-ui';
import { NButton, NCard, NEmpty, NInputNumber, NScrollbar, NSelect, NText } from 'naive-ui';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import type {
  EncounterResult,
  PartySlot,
  RoomStateDto,
  SimulationSnapshot,
} from '@ff14arena/shared';
import {
  getSlotCardBackground,
  getSlotRole,
  type OperationMode,
  type SelectValue,
} from '../../utils/ui';
import BattleStage from '../battle/BattleStage.vue';
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2.4;

const props = defineProps<{
  room: RoomStateDto | null;
  snapshot: SimulationSnapshot | null;
  controlledActorId: string | null;
  currentPlayerSlot: PartySlot | null;
  cameraYaw: number;
  cameraZoom: number;
  operationMode: OperationMode;
  isOwner: boolean;
  currentReady: boolean;
  canStart: boolean;
  logs: string[];
  latestResult: EncounterResult | null;
  operationModeOptions: SelectOption[];
}>();

const emit = defineEmits<{
  useKnockbackImmune: [];
  startBattle: [];
  setReady: [];
  switchSlot: [slot: PartySlot];
  resetZoom: [];
  cameraYawChange: [yaw: number];
  cameraZoomChange: [zoom: number];
  faceAngle: [facing: number];
  operationModeChange: [value: SelectValue];
}>();

const slotMap = computed(() => {
  const entries = props.room?.slots ?? [];
  return new Map(entries.map((slot) => [slot.slot, slot]));
});

const actorMap = computed(() => {
  const entries = props.snapshot?.actors ?? [];
  return new Map(entries.map((actor) => [actor.slot, actor]));
});

const castBar = computed(() => props.snapshot?.hud.bossCastBar ?? null);
const renderNowMs = ref(0);
const renderClockBase = ref({
  snapshotTimeMs: 0,
  clientNowMs: 0,
});
let renderFrame: number | null = null;

const renderSimulationTimeMs = computed(() => {
  if (props.snapshot === null) {
    return 0;
  }

  return (
    renderClockBase.value.snapshotTimeMs +
    Math.max(renderNowMs.value - renderClockBase.value.clientNowMs, 0)
  );
});

const castProgress = computed(() => {
  if (castBar.value === null || props.snapshot === null) {
    return 0;
  }

  const elapsed = Math.max(renderSimulationTimeMs.value - castBar.value.startedAt, 0);
  return Math.min(elapsed / castBar.value.totalDurationMs, 1);
});

const canUseKnockback = computed(
  () => props.snapshot?.phase === 'running' && props.controlledActorId !== null,
);

function getSlotState(slot: PartySlot) {
  return slotMap.value.get(slot) ?? null;
}

function getActor(slot: PartySlot) {
  return actorMap.value.get(slot) ?? null;
}

function getSlotButtonLabel(slot: PartySlot): string {
  if (slot === props.currentPlayerSlot) {
    if (props.isOwner) {
      return props.snapshot?.phase === 'running' ? '房主' : '开始';
    }

    return props.currentReady ? '已准备' : '准备';
  }

  return '切换';
}

function getSlotButtonType(
  slot: PartySlot,
): 'default' | 'primary' | 'success' | 'warning' | 'info' {
  if (slot === props.currentPlayerSlot) {
    if (props.isOwner) {
      return 'warning';
    }

    return 'success';
  }

  return 'info';
}

function isSlotButtonDisabled(slot: PartySlot): boolean {
  if (slot === props.currentPlayerSlot) {
    if (props.isOwner) {
      return props.snapshot?.phase !== 'waiting' || !props.canStart;
    }

    return props.snapshot?.phase !== 'waiting' || props.currentReady;
  }

  return props.snapshot?.phase !== 'waiting';
}

function handleSlotAction(slot: PartySlot): void {
  if (slot === props.currentPlayerSlot) {
    if (props.isOwner) {
      emit('startBattle');
      return;
    }

    emit('setReady');
    return;
  }

  emit('switchSlot', slot);
}

function getResultTitle(result: EncounterResult | null): string {
  if (result === null) {
    return '尚无上一轮结果';
  }

  return result.outcome === 'success' ? '上一轮成功' : '上一轮失败';
}

function handleZoomInput(value: number | null): void {
  if (value === null || Number.isNaN(value)) {
    return;
  }

  emit('cameraZoomChange', Math.min(Math.max(value, MIN_ZOOM), MAX_ZOOM));
}

function tickRenderClock(now: number): void {
  renderNowMs.value = now;
  renderFrame = requestAnimationFrame(tickRenderClock);
}

watch(
  () => props.snapshot?.timeMs ?? 0,
  (timeMs) => {
    renderClockBase.value = {
      snapshotTimeMs: timeMs,
      clientNowMs: performance.now(),
    };
  },
  { immediate: true },
);

onMounted(() => {
  renderClockBase.value = {
    snapshotTimeMs: props.snapshot?.timeMs ?? 0,
    clientNowMs: performance.now(),
  };
  renderFrame = requestAnimationFrame(tickRenderClock);
});

onBeforeUnmount(() => {
  if (renderFrame !== null) {
    cancelAnimationFrame(renderFrame);
    renderFrame = null;
  }
});
</script>

<template>
  <div class="battle-layout">
    <aside class="battle-sidebar">
      <div class="slot-list">
        <div
          v-for="slot in PARTY_SLOT_ORDER"
          :key="slot"
          class="slot-card"
          :style="{ background: getSlotCardBackground(slot, slot === props.currentPlayerSlot) }"
        >
          <div class="slot-row">
            <div class="slot-title">
              <span class="slot-label">[{{ slot }}]</span>
              <span>{{ getSlotState(slot)?.name ?? '等待加入' }}</span>
            </div>
            <n-button
              secondary
              strong
              class="slot-button"
              :type="getSlotButtonType(slot)"
              :disabled="isSlotButtonDisabled(slot)"
              @click="handleSlotAction(slot)"
            >
              {{ getSlotButtonLabel(slot) }}
            </n-button>
          </div>

          <div class="slot-row secondary">
            <span
              >{{ getActor(slot)?.currentHp ?? getSlotState(slot)?.currentHp ?? 0 }} /
              {{ getActor(slot)?.maxHp ?? 10000 }}</span
            >
            <span class="slot-meta">
              {{
                slot === props.currentPlayerSlot
                  ? '自己'
                  : getSlotState(slot)?.occupantType === 'bot'
                    ? 'Bot'
                    : '玩家'
              }}
              ·
              {{ getSlotRole(slot).toUpperCase() }}
            </span>
          </div>
        </div>
      </div>
    </aside>

    <main class="battle-main">
      <n-card embedded class="stage-card">
        <div class="stage-panel">
          <div class="stage-header">
            <div>
              <p class="eyebrow">场地</p>
              <h2 class="section-title">
                {{ props.snapshot?.battleName ?? props.room?.battleName ?? '未选择战斗' }}
              </h2>
            </div>
            <div class="stage-meta">
              <n-select
                class="stage-mode-select"
                size="small"
                :value="props.operationMode"
                :options="props.operationModeOptions"
                @update:value="emit('operationModeChange', $event)"
              />
              <div class="zoom-control">
                <span class="zoom-label">缩放</span>
                <n-input-number
                  size="small"
                  class="zoom-input"
                  :min="MIN_ZOOM"
                  :max="MAX_ZOOM"
                  :step="0.1"
                  :precision="1"
                  :value="Number(props.cameraZoom.toFixed(1))"
                  @update:value="handleZoomInput"
                />
              </div>
            </div>
          </div>

          <div class="stage-shell">
            <div class="cast-overlay">
              <template v-if="castBar">
                <div class="cast-name">{{ castBar.actionName }}</div>
                <div class="cast-track">
                  <div class="cast-fill" :style="{ width: `${castProgress * 100}%` }" />
                </div>
              </template>
            </div>

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

            <div v-if="!props.snapshot" class="empty-stage">等待战斗场景数据</div>
          </div>

          <div class="stage-actions">
            <n-button secondary :disabled="!canUseKnockback" @click="emit('useKnockbackImmune')">
              防击退（1）
            </n-button>
            <n-button tertiary @click="emit('resetZoom')">重置缩放</n-button>
            <n-text depth="3" class="stage-hint">
              {{
                props.operationMode === 'traditional'
                  ? '传统：移动方向跟随镜头，移动时人物自动转向。'
                  : '标准：右键拖拽同时转镜头和人物，移动方向跟随人物朝向。'
              }}
            </n-text>
          </div>
        </div>
      </n-card>
    </main>

    <aside class="result-sidebar">
      <n-card embedded class="result-card">
        <template #header>
          <div>
            <p class="eyebrow">结果</p>
            <h2 class="section-title">{{ getResultTitle(props.latestResult) }}</h2>
          </div>
        </template>

        <div class="result-stack">
          <div v-if="props.latestResult !== null" class="result-reasons">
            <div class="panel-title">失败原因</div>
            <div v-if="props.latestResult.failureReasons.length > 0" class="reason-list">
              <div
                v-for="reason in props.latestResult.failureReasons"
                :key="reason"
                class="reason-item"
              >
                {{ reason }}
              </div>
            </div>
            <n-empty v-else description="没有失败原因，本轮为成功。" />
          </div>
          <n-empty v-else description="开始一轮模拟后，这里会展示上一轮结果。" />

          <div class="log-panel">
            <div class="panel-title">实时日志</div>
            <n-scrollbar class="log-scrollbar">
              <div v-if="props.logs.length > 0" class="log-list">
                <div v-for="(line, index) in props.logs" :key="`${index}-${line}`" class="log-item">
                  {{ line }}
                </div>
              </div>
              <n-empty v-else description="当前没有日志。" />
            </n-scrollbar>
          </div>
        </div>
      </n-card>
    </aside>
  </div>
</template>

<style scoped>
.battle-layout {
  display: grid;
  grid-template-columns: 286px minmax(0, 1fr) 320px;
  gap: 14px;
  height: 100%;
  min-height: 0;
}

.battle-sidebar,
.result-sidebar,
.battle-main {
  min-height: 0;
}

.result-card,
.stage-card {
  height: 100%;
}

.battle-sidebar {
  min-height: 0;
}

.slot-list {
  display: grid;
  grid-template-rows: repeat(8, minmax(0, 1fr));
  gap: 8px;
  height: 100%;
  min-height: 0;
}

.slot-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  padding: 8px 11px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.slot-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.slot-row.secondary {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(246, 239, 228, 0.86);
}

.slot-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 14px;
  font-weight: 700;
}

.slot-label {
  color: rgba(255, 255, 255, 0.92);
}

.slot-button {
  min-width: 72px;
  font-weight: 700;
  color: #f6efe4;
  border-width: 1px;
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.26);
  backdrop-filter: blur(10px);
}

.slot-button:deep(.n-button__border) {
  opacity: 0.42;
}

.slot-button:deep(.n-button__state-border) {
  opacity: 0.22;
}

.slot-meta {
  color: rgba(246, 239, 228, 0.7);
}

.battle-main {
  min-width: 0;
}

.stage-card :deep(.n-card__content) {
  height: 100%;
  min-height: 0;
  padding-top: 12px;
  padding-bottom: 12px;
}

.stage-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 8px;
  height: 100%;
  min-height: 0;
}

.stage-shell {
  position: relative;
  min-height: 0;
  height: 100%;
}

.stage-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-height: 40px;
}

.stage-hint {
  flex: 1;
  min-width: 240px;
}

.result-card :deep(.n-card__content) {
  display: flex;
  flex-direction: column;
  height: calc(100% - 4px);
}

.result-stack {
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(220px, 36%);
  gap: 12px;
  height: 100%;
  min-height: 0;
}

.result-reasons,
.log-panel {
  display: grid;
  gap: 10px;
  min-height: 0;
}

.reason-list,
.log-list {
  display: grid;
  gap: 8px;
}

.reason-item {
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  padding: 10px 12px;
}

.panel-title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(246, 239, 228, 0.68);
}

.log-panel {
  min-height: 220px;
}

.log-scrollbar {
  min-height: 0;
  height: 100%;
  max-height: 100%;
}

.stage-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.stage-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.eyebrow {
  margin: 0 0 4px;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(246, 239, 228, 0.55);
}

.section-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.stage-mode-select {
  width: 112px;
}

.zoom-control {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 223, 177, 0.12);
}

.zoom-label {
  font-size: 12px;
  color: rgba(246, 239, 228, 0.72);
  white-space: nowrap;
}

.zoom-input {
  width: 88px;
}

.cast-overlay {
  position: absolute;
  top: 16px;
  left: 50%;
  z-index: 2;
  width: min(420px, calc(100% - 80px));
  transform: translateX(-50%);
  pointer-events: none;
}

.cast-name {
  margin-bottom: 8px;
  text-align: center;
  font-size: 14px;
  font-weight: 700;
  color: #f6efe4;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.55);
}

.cast-track {
  height: 12px;
  border-radius: 999px;
  border: 1px solid rgba(255, 239, 194, 0.24);
  background: rgba(0, 0, 0, 0.34);
  overflow: hidden;
}

.cast-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #f0d08b 0%, #d67652 100%);
}

.empty-stage {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
  color: rgba(246, 239, 228, 0.72);
}

.log-list {
  font-size: 12px;
  line-height: 1.5;
  color: rgba(246, 239, 228, 0.76);
}

.log-item {
  padding: 0;
  border: 0;
  background: transparent;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
