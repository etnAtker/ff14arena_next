<script setup lang="ts">
import type { SelectOption } from 'naive-ui';
import { NButton, NCard, NEmpty, NInputNumber, NSelect, NText } from 'naive-ui';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import type {
  BaseActorSnapshot,
  EncounterResult,
  PartySlot,
  RoomStateDto,
  SimulationSnapshot,
} from '@ff14arena/shared';
import {
  formatSkillCooldownLabel,
  getSlotCardBackground,
  getSlotRole,
  isCooldownReady,
  type OperationMode,
  type SelectValue,
} from '../../utils/ui';
import BattleStage from '../battle/BattleStage.vue';
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2.4;
const HUD_TICK_MS = 100;

const props = defineProps<{
  room: RoomStateDto | null;
  snapshot: SimulationSnapshot | null;
  controlledActorId: string | null;
  currentPlayerSlot: PartySlot | null;
  cameraYaw: number;
  cameraZoom: number;
  operationMode: OperationMode;
  isOwner: boolean;
  isSpectating: boolean;
  currentReady: boolean;
  canStart: boolean;
  logs: string[];
  latestResult: EncounterResult | null;
  operationModeOptions: SelectOption[];
}>();

const emit = defineEmits<{
  useKnockbackImmune: [currentTimeMs: number];
  useSprint: [currentTimeMs: number];
  spectate: [];
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
const hudNowMs = ref(0);
const renderClockBase = ref({
  snapshotTimeMs: 0,
  clientNowMs: 0,
});
const castAnimationBase = ref<{
  castKey: string;
  initialElapsedMs: number;
  totalDurationMs: number;
} | null>(null);
let hudTimer: number | null = null;

const renderSimulationTimeMs = computed(() => {
  if (props.snapshot === null) {
    return 0;
  }

  return (
    renderClockBase.value.snapshotTimeMs +
    Math.max(hudNowMs.value - renderClockBase.value.clientNowMs, 0)
  );
});

const currentActor = computed<BaseActorSnapshot | null>(() => {
  if (props.snapshot === null || props.controlledActorId === null) {
    return null;
  }

  return props.snapshot.actors.find((actor) => actor.id === props.controlledActorId) ?? null;
});

const castFillStyle = computed(() => {
  const base = castAnimationBase.value;

  if (base === null) {
    return {};
  }

  return {
    animationDuration: `${base.totalDurationMs}ms`,
    animationDelay: `${-base.initialElapsedMs}ms`,
  };
});

const canUseKnockback = computed(
  () =>
    props.snapshot?.phase === 'running' &&
    currentActor.value !== null &&
    currentActor.value.alive &&
    isCooldownReady(currentActor.value.knockbackImmuneCooldown, renderSimulationTimeMs.value),
);
const canUseSprint = computed(
  () =>
    props.snapshot?.phase === 'running' &&
    currentActor.value !== null &&
    currentActor.value.alive &&
    isCooldownReady(currentActor.value.sprintCooldown, renderSimulationTimeMs.value),
);
const knockbackButtonLabel = computed(() => {
  if (currentActor.value === null) {
    return '防击退（1）';
  }

  return formatSkillCooldownLabel({
    label: '防击退',
    hotkey: '1',
    cooldown: currentActor.value.knockbackImmuneCooldown,
    currentTimeMs: renderSimulationTimeMs.value,
  });
});
const sprintButtonLabel = computed(() => {
  if (currentActor.value === null) {
    return '疾跑（2）';
  }

  return formatSkillCooldownLabel({
    label: '疾跑',
    hotkey: '2',
    cooldown: currentActor.value.sprintCooldown,
    currentTimeMs: renderSimulationTimeMs.value,
  });
});
const spectateButtonLabel = computed(() => (props.isOwner && props.isSpectating ? '开始' : '观战'));
const spectateButtonType = computed(() =>
  props.isOwner && props.isSpectating ? 'warning' : 'info',
);
const spectateButtonDisabled = computed(() => {
  if (props.isOwner && props.isSpectating) {
    return props.snapshot?.phase !== 'waiting' || !props.canStart;
  }

  return (
    props.snapshot?.phase !== 'waiting' || props.isSpectating || props.currentPlayerSlot === null
  );
});

function handleSpectateButton(): void {
  if (props.isOwner && props.isSpectating) {
    emit('startBattle');
    return;
  }

  emit('spectate');
}

function getSlotState(slot: PartySlot) {
  return slotMap.value.get(slot) ?? null;
}

function getActor(slot: PartySlot) {
  return actorMap.value.get(slot) ?? null;
}

function getMechanicStatusRows(slot: PartySlot): string[] {
  const actor = getActor(slot);

  if (actor === null) {
    return [];
  }

  return actor.statuses
    .map((status) => {
      if (!Number.isFinite(status.expiresAt)) {
        return status.name;
      }

      const remainingMs = status.expiresAt - renderSimulationTimeMs.value;

      if (remainingMs <= 0) {
        return null;
      }

      return `${status.name} ${Math.ceil(remainingMs / 1_000)}秒`;
    })
    .filter((name): name is string => name !== null)
    .slice(0, 10);
}

function getSlotButtonLabel(slot: PartySlot): string {
  if (props.isSpectating) {
    return getSlotState(slot)?.occupantType === 'player' ? '占用' : '入场';
  }

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
  if (props.isSpectating) {
    return getSlotState(slot)?.occupantType === 'player' ? 'default' : 'primary';
  }

  if (slot === props.currentPlayerSlot) {
    if (props.isOwner) {
      return 'warning';
    }

    return 'success';
  }

  return 'info';
}

function isSlotButtonDisabled(slot: PartySlot): boolean {
  if (props.isSpectating) {
    return props.snapshot?.phase !== 'waiting' || getSlotState(slot)?.occupantType === 'player';
  }

  if (slot === props.currentPlayerSlot) {
    if (props.isOwner) {
      return props.snapshot?.phase !== 'waiting' || !props.canStart;
    }

    return props.snapshot?.phase !== 'waiting' || props.currentReady;
  }

  return props.snapshot?.phase !== 'waiting';
}

function handleSlotAction(slot: PartySlot): void {
  if (props.isSpectating) {
    emit('switchSlot', slot);
    return;
  }

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

function tickHudClock(): void {
  hudNowMs.value = performance.now();
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

watch(
  () =>
    castBar.value === null
      ? null
      : `${castBar.value.actionId}:${castBar.value.startedAt}:${castBar.value.totalDurationMs}`,
  (castKey) => {
    if (castKey === null || castBar.value === null || props.snapshot === null) {
      castAnimationBase.value = null;
      return;
    }

    const elapsedMs = Math.min(
      Math.max(props.snapshot.timeMs - castBar.value.startedAt, 0),
      castBar.value.totalDurationMs,
    );

    castAnimationBase.value = {
      castKey,
      initialElapsedMs: elapsedMs,
      totalDurationMs: castBar.value.totalDurationMs,
    };
  },
  { immediate: true },
);

onMounted(() => {
  renderClockBase.value = {
    snapshotTimeMs: props.snapshot?.timeMs ?? 0,
    clientNowMs: performance.now(),
  };
  tickHudClock();
  hudTimer = window.setInterval(tickHudClock, HUD_TICK_MS);
});

onBeforeUnmount(() => {
  if (hudTimer !== null) {
    window.clearInterval(hudTimer);
    hudTimer = null;
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
                    ? '机器人'
                    : '玩家'
              }}
              ·
              {{ getSlotRole(slot).toUpperCase() }}
            </span>
          </div>

          <div class="slot-row status-row">
            <span
              v-for="statusName in getMechanicStatusRows(slot)"
              :key="statusName"
              class="status-pill"
            >
              {{ statusName }}
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
              <n-button
                secondary
                strong
                class="spectate-button"
                :type="spectateButtonType"
                :disabled="spectateButtonDisabled"
                @click="handleSpectateButton"
              >
                {{ spectateButtonLabel }}
              </n-button>
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
                  <div
                    :key="`${castBar.actionId}-${castBar.startedAt}`"
                    class="cast-fill"
                    :style="castFillStyle"
                  />
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
            <n-button
              secondary
              :disabled="!canUseKnockback"
              @click="emit('useKnockbackImmune', renderSimulationTimeMs)"
            >
              {{ knockbackButtonLabel }}
            </n-button>
            <n-button
              secondary
              :disabled="!canUseSprint"
              @click="emit('useSprint', renderSimulationTimeMs)"
            >
              {{ sprintButtonLabel }}
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
        <div class="result-panel">
          <div class="result-header">
            <p class="eyebrow">结果</p>
            <h2 class="section-title">{{ getResultTitle(props.latestResult) }}</h2>
          </div>

          <div class="result-stack">
            <div class="result-reasons">
              <div class="panel-title">失败原因</div>
              <div class="panel-body">
                <div class="panel-scroll">
                  <template v-if="props.latestResult !== null">
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
                  </template>
                  <n-empty v-else description="开始一轮模拟后，这里会展示上一轮结果。" />
                </div>
              </div>
            </div>

            <div class="log-panel">
              <div class="panel-title">实时日志</div>
              <div class="panel-body">
                <div class="panel-scroll">
                  <div v-if="props.logs.length > 0" class="log-list">
                    <div
                      v-for="(line, index) in props.logs"
                      :key="`${index}-${line}`"
                      class="log-item"
                    >
                      {{ line }}
                    </div>
                  </div>
                  <n-empty v-else description="当前没有日志。" />
                </div>
              </div>
            </div>
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
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.battle-sidebar,
.result-sidebar,
.battle-main {
  min-height: 0;
  overflow: hidden;
}

.battle-sidebar,
.result-sidebar {
  display: flex;
  flex-direction: column;
}

.result-card,
.stage-card {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

.battle-sidebar {
  min-height: 0;
}

.slot-list {
  display: grid;
  grid-template-rows: repeat(8, minmax(0, 1fr));
  flex: 1 1 auto;
  gap: 8px;
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

.slot-row.status-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-auto-rows: minmax(19px, auto);
  gap: 4px;
  margin-top: 6px;
  min-height: 42px;
  align-items: start;
}

.status-pill {
  min-width: 0;
  border: 1px solid rgba(246, 239, 228, 0.18);
  border-radius: 4px;
  padding: 2px 3px;
  color: rgba(246, 239, 228, 0.88);
  font-size: 11px;
  line-height: 1.25;
  text-align: center;
  background: rgba(0, 0, 0, 0.18);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  display: flex;
  flex-direction: column;
}

.stage-card :deep(.n-card__content) {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding-top: 12px;
  padding-bottom: 12px;
}

.stage-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  flex: 1 1 auto;
  gap: 8px;
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
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  padding-top: 12px;
  padding-bottom: 12px;
}

.result-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}

.result-header {
  min-height: 0;
}

.result-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1 1 auto;
  min-height: 0;
}

.result-reasons,
.log-panel {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: hidden;
}

.panel-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.reason-list,
.log-list {
  display: flex;
  flex-direction: column;
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

.panel-scroll {
  height: 100%;
  min-height: 0;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(201, 139, 90, 0.7) rgba(255, 255, 255, 0.05);
}

.panel-scroll::-webkit-scrollbar {
  width: 10px;
}

.panel-scroll::-webkit-scrollbar-track {
  margin: 6px 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
}

.panel-scroll::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(240, 208, 139, 0.88) 0%, rgba(201, 139, 90, 0.82) 100%)
    padding-box;
  box-shadow: inset 0 0 0 1px rgba(255, 244, 220, 0.12);
}

.panel-scroll::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, rgba(244, 218, 153, 0.96) 0%, rgba(214, 118, 82, 0.9) 100%)
    padding-box;
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

.spectate-button {
  min-width: 72px;
  font-weight: 700;
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
  transform-origin: left center;
  animation-name: cast-progress;
  animation-timing-function: linear;
  animation-fill-mode: both;
}

@keyframes cast-progress {
  from {
    transform: scaleX(0);
  }

  to {
    transform: scaleX(1);
  }
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
