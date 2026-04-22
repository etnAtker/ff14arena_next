<script setup lang="ts">
import type { SelectOption } from 'naive-ui';
import {
  NButton,
  NCard,
  NEmpty,
  NForm,
  NFormItem,
  NGrid,
  NGi,
  NInput,
  NSpace,
  NSelect,
  NTag,
  NText,
} from 'naive-ui';
import type { RoomSummaryDto } from '@ff14arena/shared';
import { getRoomPhaseLabel, getRoomPhaseTagType } from '../../utils/ui';

const props = defineProps<{
  editUserName: string;
  createRoomName: string;
  createBattleId: string | null;
  battleOptions: SelectOption[];
  rooms: RoomSummaryDto[];
}>();

const emit = defineEmits<{
  editUserNameChange: [value: string];
  createRoomNameChange: [value: string];
  createBattleIdChange: [value: string | null];
  createRoom: [];
  refreshLobby: [];
  joinRoom: [roomId: string];
}>();
</script>

<template>
  <n-grid cols="1 m:2" responsive="screen" :x-gap="16" :y-gap="16">
    <n-gi>
      <n-card title="创建房间" embedded>
        <n-form label-placement="top">
          <n-form-item label="昵称">
            <n-input
              :value="props.editUserName"
              maxlength="24"
              placeholder="输入昵称"
              @update:value="emit('editUserNameChange', $event)"
            />
          </n-form-item>
          <n-form-item label="房间名">
            <n-input
              :value="props.createRoomName"
              maxlength="32"
              placeholder="输入房间名"
              @update:value="emit('createRoomNameChange', $event)"
            />
          </n-form-item>
          <n-form-item label="战斗">
            <n-select
              :value="props.createBattleId"
              :options="props.battleOptions"
              placeholder="请选择战斗"
              @update:value="
                emit('createBattleIdChange', typeof $event === 'string' ? $event : null)
              "
            />
          </n-form-item>
          <n-button type="primary" block @click="emit('createRoom')">创建并进入</n-button>
        </n-form>
      </n-card>
    </n-gi>

    <n-gi>
      <n-card embedded>
        <template #header>
          <div class="card-header-row">
            <span>当前房间</span>
            <n-button secondary size="small" @click="emit('refreshLobby')">刷新</n-button>
          </div>
        </template>
        <n-space v-if="props.rooms.length > 0" vertical :size="12">
          <n-card v-for="roomItem in props.rooms" :key="roomItem.roomId" size="small" embedded>
            <div class="room-row">
              <div>
                <div class="room-title-row">
                  <strong>{{ roomItem.name }}</strong>
                  <n-tag :type="getRoomPhaseTagType(roomItem.phase)" size="small" round>
                    {{ getRoomPhaseLabel(roomItem.phase) }}
                  </n-tag>
                </div>
                <n-space size="small" wrap>
                  <n-text depth="2">{{ roomItem.battleName ?? '未选择战斗' }}</n-text>
                  <n-text depth="3">人数：{{ roomItem.occupantCount }}</n-text>
                </n-space>
              </div>
              <n-button secondary @click="emit('joinRoom', roomItem.roomId)">加入</n-button>
            </div>
          </n-card>
        </n-space>
        <n-empty v-else description="当前没有房间，直接创建即可。" />
      </n-card>
    </n-gi>
  </n-grid>
</template>

<style scoped>
.card-header-row,
.room-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.room-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
</style>
