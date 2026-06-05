<script setup lang="ts">
import type { SelectOption } from 'naive-ui';
import {
  NButton,
  NCard,
  NEmpty,
  NInputNumber,
  NModal,
  NSelect,
  NSwitch,
  NTag,
  NText,
} from 'naive-ui';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import type {
  BaseActorSnapshot,
  BattleStartTimeOptions,
  BossCastBarState,
  EncounterResult,
  PartySlot,
  RoomStateDto,
  SimulationSnapshot,
  StatusMetadata,
} from '@ff14arena/shared';
import {
  formatSkillCooldownLabel,
  getSlotCardBackground,
  isCooldownReady,
  type OperationMode,
  type SelectValue,
} from '../../utils/ui';
import { loadPartyListOrder, savePartyListOrder } from '../../utils/party-list-order';
import BattleStage from '../battle/BattleStage.vue';
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2.4;
const HUD_TICK_MS = 100;
const MIN_START_COUNTDOWN_SECONDS = 1;
const MAX_START_COUNTDOWN_SECONDS = 30;
const START_TIME_STEP_SECONDS = 0.25;

interface StartBattlePayload {
  countdownMs: number;
  startTimeMs?: number;
}

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
  canStart: boolean;
  startCountdownSeconds: number;
  startTimeSeconds: number;
  startTimeOptions: BattleStartTimeOptions | null;
  serverCountdownSeconds: number | null;
  battleStartNoticeUntilMs: number;
  logs: string[];
  latestResult: EncounterResult | null;
  statusMetadata: StatusMetadata[];
  failedStatusIconUrls: string[];
  operationModeOptions: SelectOption[];
}>();

const emit = defineEmits<{
  useKnockbackImmune: [currentTimeMs: number];
  useSprint: [currentTimeMs: number];
  spectate: [];
  startBattle: [payload: StartBattlePayload];
  quickFail: [];
  roomOptionsChange: [options: Partial<RoomStateDto['options']>];
  startCountdownSecondsChange: [seconds: number];
  startTimeSecondsChange: [seconds: number];
  switchSlot: [slot: PartySlot];
  resetZoom: [];
  cameraYawChange: [yaw: number];
  cameraZoomChange: [zoom: number];
  faceAngle: [facing: number];
  operationModeChange: [value: SelectValue];
  statusIconLoadError: [iconUrl: string];
}>();

interface StatusViewModel {
  key: string;
  name: string;
  description: string;
  iconUrl: string | null;
  fallbackText: string;
  countdownLabel: string;
  title: string;
  iconFailed: boolean;
  partyListPriority: number;
  originalIndex: number;
}

const slotMap = computed(() => {
  const entries = props.room?.slots ?? [];
  return new Map(entries.map((slot) => [slot.slot, slot]));
});

const actorMap = computed(() => {
  const entries = props.snapshot?.actors ?? [];
  return new Map(entries.map((actor) => [actor.slot, actor]));
});

const castBars = computed(() => {
  const bars = props.snapshot?.hud.bossCastBars;

  if (bars !== undefined) {
    return bars;
  }

  const singleBar = props.snapshot?.hud.bossCastBar ?? null;

  return singleBar === null ? [] : [singleBar];
});
const hudNowMs = ref(0);
const renderClockBase = ref({
  snapshotTimeMs: 0,
  clientNowMs: 0,
});
const partyListOrder = ref<PartySlot[]>(loadPartyListOrder());
const localFailedStatusIconUrls = ref(new Set<string>());
const pendingSlotAction = ref<{
  slot: PartySlot;
  title: string;
  description: string;
  confirmLabel: string;
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
const statusMetadataMap = computed(
  () => new Map(props.statusMetadata.map((status) => [status.id, status])),
);
const failedStatusIconUrlSet = computed(
  () => new Set([...props.failedStatusIconUrls, ...localFailedStatusIconUrls.value]),
);
const currentActorStatuses = computed(() =>
  createStatusViewModels(currentActor.value?.statuses ?? []),
);

function getCastFillStyle(castBar: BossCastBarState): Record<string, string> {
  const elapsedMs = Math.min(
    Math.max(renderSimulationTimeMs.value - castBar.startedAt, 0),
    castBar.totalDurationMs,
  );
  const progress = castBar.totalDurationMs <= 0 ? 1 : elapsedMs / castBar.totalDurationMs;

  return {
    transform: `scaleX(${progress})`,
  };
}

const canUseKnockback = computed(
  () =>
    props.snapshot?.phase === 'running' &&
    currentActor.value !== null &&
    currentActor.value.mechanicActive &&
    isCooldownReady(currentActor.value.knockbackImmuneCooldown, renderSimulationTimeMs.value),
);
const canUseSprint = computed(
  () =>
    props.snapshot?.phase === 'running' &&
    currentActor.value !== null &&
    currentActor.value.mechanicActive &&
    isCooldownReady(currentActor.value.sprintCooldown, renderSimulationTimeMs.value),
);
const canQuickFail = computed(() => props.isOwner && props.snapshot?.phase === 'running');
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
    return '冲刺（2）';
  }

  return formatSkillCooldownLabel({
    label: '冲刺',
    hotkey: '2',
    cooldown: currentActor.value.sprintCooldown,
    currentTimeMs: renderSimulationTimeMs.value,
  });
});
const showBattleStartNotice = computed(
  () => props.battleStartNoticeUntilMs > 0 && hudNowMs.value < props.battleStartNoticeUntilMs,
);
const countdownBannerText = computed(() => {
  if (showBattleStartNotice.value) {
    return '战斗开始！';
  }

  if (props.serverCountdownSeconds === null) {
    return null;
  }

  return props.serverCountdownSeconds <= 0 ? '战斗开始！' : String(props.serverCountdownSeconds);
});
const isStartCountdownActive = computed(() => props.room?.startCountdown != null);
const supportsStartTime = computed(() => props.startTimeOptions !== null);
const deadActorsInteractEnabled = computed(() => props.room?.options.deadActorsInteract ?? true);
const isPartyListDefaultOrder = computed(() =>
  partyListOrder.value.every((slot, index) => slot === PARTY_SLOT_ORDER[index]),
);
const spectateButtonLabel = computed(() => {
  if (props.isOwner && props.isSpectating) {
    return isStartCountdownActive.value ? '倒计时中' : '开始';
  }

  return '观战';
});
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
    emitStartBattle();
    return;
  }

  emit('spectate');
}

function createStartBattlePayload(): StartBattlePayload {
  const startTimeMs =
    props.startTimeOptions === null ? 0 : Math.round((props.startTimeSeconds * 1_000) / 50) * 50;

  return {
    countdownMs: props.startCountdownSeconds * 1_000,
    ...(startTimeMs === 0 ? {} : { startTimeMs }),
  };
}

function emitStartBattle(): void {
  emit('startBattle', createStartBattlePayload());
}

function getSlotState(slot: PartySlot) {
  return slotMap.value.get(slot) ?? null;
}

function getSlotDisplayName(slot: PartySlot): string {
  const slotState = getSlotState(slot);

  if (slotState?.name !== null && slotState?.name !== undefined) {
    return slotState.name;
  }

  if (slotState?.occupantType === 'empty') {
    return `空位 [${slot}]`;
  }

  return `[${slot}]`;
}

function isFirstPartyListSlot(slot: PartySlot): boolean {
  return partyListOrder.value[0] === slot;
}

function isLastPartyListSlot(slot: PartySlot): boolean {
  return partyListOrder.value[partyListOrder.value.length - 1] === slot;
}

function movePartyListSlot(slot: PartySlot, offset: -1 | 1): void {
  const currentIndex = partyListOrder.value.indexOf(slot);
  const targetIndex = currentIndex + offset;

  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= partyListOrder.value.length) {
    return;
  }

  const nextOrder = [...partyListOrder.value];
  nextOrder.splice(currentIndex, 1);
  nextOrder.splice(targetIndex, 0, slot);
  partyListOrder.value = nextOrder;
  savePartyListOrder(nextOrder);
}

function resetPartyListOrder(): void {
  const nextOrder = [...PARTY_SLOT_ORDER];
  partyListOrder.value = nextOrder;
  savePartyListOrder(nextOrder);
}

function getOwnerTag(slot: PartySlot): {
  label: string;
  type: 'default';
} | null {
  const slotState = getSlotState(slot);

  if (slotState === null || slotState.occupantType !== 'player') {
    return null;
  }

  if (slotState.ownerUserId === props.room?.ownerUserId) {
    return {
      label: '房主',
      type: 'default',
    };
  }

  return null;
}

function getActor(slot: PartySlot) {
  return actorMap.value.get(slot) ?? null;
}

function createFallbackText(name: string): string {
  return Array.from(name.trim()).slice(0, 2).join('') || '??';
}

function formatStatusCountdown(expiresAt: number): string {
  if (!Number.isFinite(expiresAt)) {
    return '';
  }

  const remainingMs = expiresAt - renderSimulationTimeMs.value;

  if (remainingMs <= 0) {
    return '';
  }

  return `${Math.ceil(remainingMs / 1_000)}秒`;
}

function getStatusTitle(status: StatusViewModel): string {
  const lines = [status.name];

  if (status.countdownLabel !== '') {
    lines.push(`剩余：${status.countdownLabel}`);
  }

  if (status.description !== '') {
    lines.push(status.description);
  }

  return lines.join('\n');
}

function createStatusViewModels(statuses: BaseActorSnapshot['statuses']): StatusViewModel[] {
  return statuses
    .map((status, index) => {
      const remainingMs = status.expiresAt - renderSimulationTimeMs.value;

      if (Number.isFinite(status.expiresAt) && remainingMs <= 0) {
        return null;
      }

      const metadata = statusMetadataMap.value.get(status.id);
      const name = metadata?.name ?? status.name;
      const iconUrl = metadata?.iconUrl ?? null;
      const iconFailed = iconUrl !== null && failedStatusIconUrlSet.value.has(iconUrl);
      const viewModel: StatusViewModel = {
        key: status.id,
        name,
        description: metadata?.description ?? '',
        iconUrl,
        fallbackText: metadata?.fallbackText ?? createFallbackText(name),
        countdownLabel: formatStatusCountdown(status.expiresAt),
        title: '',
        iconFailed,
        partyListPriority: metadata?.partyListPriority ?? Number.MAX_SAFE_INTEGER,
        originalIndex: index,
      };
      viewModel.title = getStatusTitle(viewModel);

      return viewModel;
    })
    .filter((status): status is StatusViewModel => status !== null)
    .sort((left, right) => {
      if (left.partyListPriority !== right.partyListPriority) {
        return right.partyListPriority - left.partyListPriority;
      }

      return right.originalIndex - left.originalIndex;
    })
    .slice(0, 24);
}

function getMechanicStatusRows(slot: PartySlot): StatusViewModel[] {
  return createStatusViewModels(getActor(slot)?.statuses ?? []);
}

function handleStatusIconError(status: StatusViewModel): void {
  if (status.iconUrl === null) {
    return;
  }

  const nextFailedUrls = new Set(localFailedStatusIconUrls.value);
  nextFailedUrls.add(status.iconUrl);
  localFailedStatusIconUrls.value = nextFailedUrls;
  emit('statusIconLoadError', status.iconUrl);
}

function getSlotButtonLabel(slot: PartySlot): string {
  if (props.isSpectating) {
    return getSlotState(slot)?.occupantType === 'player' ? '占用' : '入场';
  }

  if (slot === props.currentPlayerSlot) {
    if (props.isOwner) {
      if (props.snapshot?.phase === 'running') {
        return '房主';
      }

      return isStartCountdownActive.value ? '倒计时中' : '开始';
    }

    return '自己';
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

    return 'default';
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

    return true;
  }

  return props.snapshot?.phase !== 'waiting';
}

function handleSlotAction(slot: PartySlot): void {
  if (props.isSpectating) {
    pendingSlotAction.value = {
      slot,
      title: '确认入场',
      description: `确认进入 ${getSlotDisplayName(slot)} 吗？`,
      confirmLabel: '确认入场',
    };
    return;
  }

  if (slot === props.currentPlayerSlot) {
    if (props.isOwner) {
      emitStartBattle();
      return;
    }

    return;
  }

  pendingSlotAction.value = {
    slot,
    title: '确认换位',
    description: `确认与 ${getSlotDisplayName(slot)} 交换位置吗？`,
    confirmLabel: '确认换位',
  };
}

function cancelPendingSlotAction(): void {
  pendingSlotAction.value = null;
}

function confirmPendingSlotAction(): void {
  const action = pendingSlotAction.value;

  if (action === null) {
    return;
  }

  pendingSlotAction.value = null;
  emit('switchSlot', action.slot);
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

function handleStartCountdownSecondsInput(value: number | null): void {
  if (value === null || Number.isNaN(value)) {
    return;
  }

  emit(
    'startCountdownSecondsChange',
    Math.min(Math.max(Math.round(value), MIN_START_COUNTDOWN_SECONDS), MAX_START_COUNTDOWN_SECONDS),
  );
}

function handleStartTimeSecondsInput(value: number | null): void {
  if (value === null || Number.isNaN(value) || props.startTimeOptions === null) {
    return;
  }

  const minSeconds = props.startTimeOptions.minMs / 1_000;
  const maxSeconds = props.startTimeOptions.maxMs / 1_000;

  emit('startTimeSecondsChange', Math.min(Math.max(value, minSeconds), maxSeconds));
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
      <div class="party-list-header">
        <div>
          <p class="eyebrow">小队</p>
          <h2 class="section-title">成员列表</h2>
        </div>
        <n-button
          tertiary
          size="small"
          class="party-reset-button"
          :disabled="isPartyListDefaultOrder"
          @click="resetPartyListOrder"
        >
          恢复默认
        </n-button>
      </div>
      <div class="slot-list">
        <div
          v-for="slot in partyListOrder"
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

          <div class="slot-order-controls">
            <n-button
              tertiary
              size="tiny"
              class="slot-order-button"
              :disabled="isFirstPartyListSlot(slot)"
              @click="movePartyListSlot(slot, -1)"
            >
              上移
            </n-button>
            <n-button
              tertiary
              size="tiny"
              class="slot-order-button"
              :disabled="isLastPartyListSlot(slot)"
              @click="movePartyListSlot(slot, 1)"
            >
              下移
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
              <template v-if="getOwnerTag(slot) !== null">
                ·
                <n-tag
                  class="owner-tag"
                  :type="getOwnerTag(slot)!.type"
                  size="small"
                  :bordered="false"
                >
                  {{ getOwnerTag(slot)!.label }}
                </n-tag>
              </template>
            </span>
          </div>

          <div class="slot-row status-row">
            <span
              v-for="status in getMechanicStatusRows(slot)"
              :key="status.key"
              class="status-icon-cell"
              :title="status.title"
            >
              <img
                v-if="status.iconUrl !== null && !status.iconFailed"
                class="status-icon"
                :src="status.iconUrl"
                :alt="status.name"
                draggable="false"
                @error="handleStatusIconError(status)"
              />
              <span v-else class="status-icon-fallback">{{ status.fallbackText }}</span>
              <span class="status-countdown">{{ status.countdownLabel }}</span>
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
              <div
                v-if="props.isOwner && props.snapshot?.phase === 'waiting'"
                class="countdown-control"
              >
                <span class="countdown-label">倒计时</span>
                <n-input-number
                  size="small"
                  class="countdown-input"
                  :min="MIN_START_COUNTDOWN_SECONDS"
                  :max="MAX_START_COUNTDOWN_SECONDS"
                  :step="1"
                  :precision="0"
                  :disabled="isStartCountdownActive"
                  :value="props.startCountdownSeconds"
                  @update:value="handleStartCountdownSecondsInput"
                />
              </div>
              <div
                v-if="props.isOwner && props.snapshot?.phase === 'waiting' && supportsStartTime"
                class="countdown-control"
              >
                <span class="countdown-label">开始时间</span>
                <n-input-number
                  size="small"
                  class="countdown-input"
                  :min="(props.startTimeOptions?.minMs ?? 0) / 1_000"
                  :max="(props.startTimeOptions?.maxMs ?? 0) / 1_000"
                  :step="START_TIME_STEP_SECONDS"
                  :precision="2"
                  :disabled="isStartCountdownActive"
                  :value="props.startTimeSeconds"
                  @update:value="handleStartTimeSecondsInput"
                />
              </div>
              <div
                v-if="props.isOwner && props.snapshot?.phase === 'waiting'"
                class="room-option-control"
              >
                <span class="room-option-label">死亡后参与机制</span>
                <n-switch
                  size="small"
                  :value="deadActorsInteractEnabled"
                  :disabled="isStartCountdownActive"
                  @update:value="
                    emit('roomOptionsChange', {
                      deadActorsInteract: $event,
                    })
                  "
                />
              </div>
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
              <template
                v-for="castBar in castBars"
                :key="`${castBar.actionId}-${castBar.startedAt}`"
              >
                <div class="cast-name">{{ castBar.actionName }}</div>
                <div class="cast-track">
                  <div class="cast-fill" :style="getCastFillStyle(castBar)" />
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
            <div v-if="countdownBannerText !== null" class="countdown-banner">
              <div class="countdown-banner-value">{{ countdownBannerText }}</div>
            </div>
            <div v-if="currentActorStatuses.length > 0" class="self-status-hud">
              <span
                v-for="status in currentActorStatuses"
                :key="status.key"
                class="status-icon-cell"
                :title="status.title"
              >
                <img
                  v-if="status.iconUrl !== null && !status.iconFailed"
                  class="status-icon"
                  :src="status.iconUrl"
                  :alt="status.name"
                  draggable="false"
                  @error="handleStatusIconError(status)"
                />
                <span v-else class="status-icon-fallback">{{ status.fallbackText }}</span>
                <span class="status-countdown">{{ status.countdownLabel }}</span>
              </span>
            </div>
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
            <n-button
              v-if="props.isOwner"
              tertiary
              type="error"
              :disabled="!canQuickFail"
              @click="emit('quickFail')"
            >
              快速失败
            </n-button>
            <n-text depth="3" class="stage-hint">
              {{
                props.operationMode === 'traditional'
                  ? '传统：移动方向跟随镜头，移动时人物自动转向。'
                  : props.operationMode === 'standard'
                    ? '标准：右键拖拽同时转镜头和人物，移动方向跟随人物朝向。'
                    : '固定：地图固定在中央且不旋转，WASD 按地图方向移动。'
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

  <n-modal
    :show="pendingSlotAction !== null"
    :mask-closable="false"
    @update:show="(show) => !show && cancelPendingSlotAction()"
  >
    <div class="slot-confirm-modal">
      <h3 class="slot-confirm-title">{{ pendingSlotAction?.title }}</h3>
      <p class="slot-confirm-description">{{ pendingSlotAction?.description }}</p>
      <div class="slot-confirm-actions">
        <n-button tertiary @click="cancelPendingSlotAction">取消</n-button>
        <n-button type="primary" @click="confirmPendingSlotAction">
          {{ pendingSlotAction?.confirmLabel ?? '确认' }}
        </n-button>
      </div>
    </div>
  </n-modal>
</template>

<style scoped>
.battle-layout {
  display: grid;
  grid-template-columns: minmax(408px, 440px) minmax(0, 1fr) 320px;
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
  min-width: 0;
  min-height: 0;
}

.battle-sidebar {
  min-height: 0;
  gap: 10px;
}

.party-list-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.party-reset-button {
  flex: 0 0 auto;
  font-weight: 700;
}

.slot-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-template-rows: repeat(4, minmax(0, 1fr));
  flex: 1 1 auto;
  gap: 8px;
  min-height: 0;
}

.slot-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 8px 9px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.slot-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.slot-row.secondary {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(246, 239, 228, 0.86);
}

.slot-row.status-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, 28px);
  grid-auto-rows: 45px;
  justify-content: start;
  gap: 4px 5px;
  margin-top: 6px;
  min-height: 94px;
  align-items: start;
  overflow: hidden;
}

.status-icon-cell {
  display: grid;
  grid-template-rows: 32px 11px;
  justify-items: center;
  align-items: start;
  width: 28px;
  min-width: 0;
  overflow: hidden;
}

.status-icon,
.status-icon-fallback {
  width: 24px;
  height: 32px;
  border: 1px solid rgba(246, 239, 228, 0.18);
  border-radius: 3px;
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.28);
}

.status-icon {
  display: block;
  object-fit: cover;
}

.status-icon-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(246, 239, 228, 0.88);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.1;
  text-align: center;
}

.status-countdown {
  width: 28px;
  color: rgba(246, 239, 228, 0.78);
  font-size: 10px;
  line-height: 11px;
  text-align: center;
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

.slot-title span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slot-label {
  color: rgba(255, 255, 255, 0.92);
}

.slot-button {
  min-width: 58px;
  font-weight: 700;
  color: #f6efe4;
  border-width: 1px;
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.26);
  backdrop-filter: blur(10px);
}

.slot-order-controls {
  display: flex;
  gap: 4px;
  margin-top: 5px;
}

.slot-order-button {
  flex: 1 1 0;
  min-width: 0;
  font-size: 11px;
}

.slot-button:deep(.n-button__border) {
  opacity: 0.42;
}

.slot-button:deep(.n-button__state-border) {
  opacity: 0.22;
}

.slot-meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  color: rgba(246, 239, 228, 0.7);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.owner-tag {
  height: 18px;
  line-height: 18px;
  font-size: 11px;
  font-weight: 700;
}

.battle-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.stage-card :deep(.n-card-content) {
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
  min-width: 0;
  min-height: 0;
}

.stage-shell {
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.self-status-hud {
  position: absolute;
  left: 14px;
  bottom: 14px;
  z-index: 4;
  display: grid;
  grid-template-columns: repeat(auto-fill, 28px);
  grid-auto-rows: 45px;
  justify-content: start;
  gap: 4px 5px;
  width: min(236px, calc(100% - 28px));
  max-height: 94px;
  overflow: hidden;
  pointer-events: none;
}

.countdown-banner {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-items: center;
  pointer-events: none;
  background: radial-gradient(
    circle at center,
    rgba(0, 0, 0, 0.2),
    rgba(0, 0, 0, 0.04) 44%,
    transparent 68%
  );
}

.countdown-banner-value {
  color: #fff7e8;
  font-size: 76px;
  font-weight: 800;
  line-height: 1;
  text-shadow:
    0 4px 18px rgba(0, 0, 0, 0.62),
    0 0 32px rgba(240, 208, 139, 0.46);
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

.result-card :deep(.n-card-content) {
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
  min-width: 0;
  flex-wrap: wrap;
}

.stage-header > div:first-child {
  min-width: 0;
}

.stage-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  min-width: 0;
  justify-content: flex-end;
}

.countdown-control,
.room-option-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.countdown-label,
.room-option-label {
  color: rgba(246, 239, 228, 0.72);
  font-size: 12px;
  white-space: nowrap;
}

.countdown-input {
  width: 86px;
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
  overflow: hidden;
  font-size: 18px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: min(420px, calc(100% - 80px));
  transform: translateX(-50%);
  pointer-events: none;
}

.cast-name {
  margin-bottom: 2px;
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
  transform: scaleX(0);
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

.slot-confirm-modal {
  width: min(360px, calc(100vw - 32px));
  border: 1px solid rgba(255, 223, 177, 0.14);
  border-radius: 8px;
  padding: 18px;
  color: #f6efe4;
  background: rgba(24, 18, 16, 0.96);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
}

.slot-confirm-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.slot-confirm-description {
  margin: 10px 0 0;
  color: rgba(246, 239, 228, 0.78);
  line-height: 1.5;
}

.slot-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
</style>
