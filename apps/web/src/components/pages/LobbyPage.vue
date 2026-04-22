<script setup lang="ts">
import type { SelectOption } from 'naive-ui';
import {
  NButton,
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NGrid,
  NGi,
  NList,
  NListItem,
  NSpace,
  NSelect,
  NTag,
  NText,
} from 'naive-ui';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import type { RoomStateDto } from '@ff14arena/shared';
import {
  getSlotAliveText,
  getSlotOccupantLabel,
  getSlotOnlineText,
  type SelectValue,
} from '../../utils/ui';

const props = defineProps<{
  room: RoomStateDto | null;
  isOwner: boolean;
  currentReady: boolean;
  currentBattleName: string;
  battleOptions: SelectOption[];
  roomBattleId: string | null;
}>();

const emit = defineEmits<{
  leaveRoom: [];
  toggleReady: [];
  startBattle: [];
  selectBattle: [value: SelectValue];
}>();
</script>

<template>
  <n-space vertical :size="16">
    <n-card embedded>
      <template #header>
        <div class="card-header-row">
          <div>
            <p class="eyebrow">房间大厅</p>
            <h2 class="section-title">{{ props.room?.name }}</h2>
          </div>
          <n-button secondary @click="emit('leaveRoom')">离开房间</n-button>
        </div>
      </template>

      <n-descriptions label-placement="top" bordered :column="2" size="small">
        <n-descriptions-item label="房主">{{ props.room?.ownerName ?? '-' }}</n-descriptions-item>
        <n-descriptions-item label="当前战斗">{{ props.currentBattleName }}</n-descriptions-item>
      </n-descriptions>

      <n-space class="panel-actions" wrap>
        <n-select
          v-if="props.isOwner"
          class="battle-select"
          :value="props.roomBattleId"
          :options="props.battleOptions"
          placeholder="切换战斗"
          @update:value="emit('selectBattle', $event)"
        />
        <n-button secondary @click="emit('toggleReady')">
          {{ props.currentReady ? '取消准备' : '准备就绪' }}
        </n-button>
        <n-button v-if="props.isOwner" type="primary" @click="emit('startBattle')"
          >开始战斗</n-button
        >
      </n-space>
    </n-card>

    <n-card title="8 槽位编组" embedded>
      <n-grid cols="1 s:2 xl:4" responsive="screen" :x-gap="12" :y-gap="12">
        <n-gi v-for="slot in PARTY_SLOT_ORDER" :key="slot">
          <n-card size="small" embedded>
            <n-space vertical :size="10">
              <div class="slot-heading">
                <strong>{{ slot }}</strong>
                <n-tag size="small" round>
                  {{
                    getSlotOccupantLabel(
                      props.room?.slots.find((item) => item.slot === slot)?.occupantType,
                    )
                  }}
                </n-tag>
              </div>
              <n-text>{{
                props.room?.slots.find((item) => item.slot === slot)?.name ?? '等待加入'
              }}</n-text>
              <n-list size="small" bordered>
                <n-list-item>
                  在线：
                  {{
                    props.room?.slots.find((item) => item.slot === slot)
                      ? getSlotOnlineText(props.room.slots.find((item) => item.slot === slot)!)
                      : '-'
                  }}
                </n-list-item>
                <n-list-item>
                  准备：{{
                    props.room?.slots.find((item) => item.slot === slot)?.ready ? '是' : '否'
                  }}
                </n-list-item>
                <n-list-item>
                  HP：{{ props.room?.slots.find((item) => item.slot === slot)?.currentHp ?? '-' }}
                </n-list-item>
                <n-list-item>
                  存活：{{
                    getSlotAliveText(props.room?.slots.find((item) => item.slot === slot)?.alive)
                  }}
                </n-list-item>
                <n-list-item>
                  防击退：{{
                    props.room?.slots.find((item) => item.slot === slot)?.knockbackImmune
                      ? '生效中'
                      : '无'
                  }}
                </n-list-item>
              </n-list>
            </n-space>
          </n-card>
        </n-gi>
      </n-grid>
    </n-card>
  </n-space>
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

.panel-actions {
  margin-top: 16px;
}

.battle-select {
  width: min(320px, 100%);
}

@media (max-width: 768px) {
  .battle-select {
    width: 100%;
  }
}
</style>
