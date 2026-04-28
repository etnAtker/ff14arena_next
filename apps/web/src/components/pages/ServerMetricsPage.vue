<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { NAlert, NButton, NEmpty, NSpin, NTag } from 'naive-ui';
import type {
  HttpRouteMetricDto,
  RoomRuntimeMetricsDto,
  ServerMetricsSnapshotDto,
} from '@ff14arena/shared';

const POLL_INTERVAL_MS = 2_000;

const metrics = ref<ServerMetricsSnapshotDto | null>(null);
const loading = ref(false);
const errorMessage = ref<string | null>(null);
let pollTimer: number | null = null;

const sortedRoutes = computed<HttpRouteMetricDto[]>(() =>
  [...(metrics.value?.http.routes ?? [])].sort((left, right) => {
    if (right.requestCount !== left.requestCount) {
      return right.requestCount - left.requestCount;
    }

    return right.durationMs.p95 - left.durationMs.p95;
  }),
);

const sortedRooms = computed<RoomRuntimeMetricsDto[]>(() =>
  [...(metrics.value?.roomMetrics ?? [])].sort((left, right) => {
    if (left.phase !== right.phase) {
      return left.phase === 'running' ? -1 : 1;
    }

    return right.tickDurationMs.p95 - left.tickDurationMs.p95;
  }),
);

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatMs(value: number): string {
  if (value === 0) {
    return '0ms';
  }

  if (Number.isInteger(value)) {
    return `${value}ms`;
  }

  if (value >= 10) {
    return `${value.toFixed(1)}ms`;
  }

  return `${value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}ms`;
}

function formatRate(value: number): string {
  return `${value.toFixed(value >= 1 ? 1 : 2)}/s`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainSeconds = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainSeconds}s`;
  }

  return `${remainSeconds}s`;
}

function returnHome(): void {
  window.location.assign('/');
}

async function loadMetrics(): Promise<void> {
  loading.value = metrics.value === null;
  errorMessage.value = null;

  try {
    const response = await fetch('/admin/metrics', {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    metrics.value = (await response.json()) as ServerMetricsSnapshotDto;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '指标加载失败';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  void loadMetrics();
  pollTimer = window.setInterval(() => {
    void loadMetrics();
  }, POLL_INTERVAL_MS);
});

onBeforeUnmount(() => {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
  }
});
</script>

<template>
  <section class="metrics-page">
    <header class="metrics-toolbar">
      <div>
        <p class="eyebrow">Server Metrics</p>
        <h2>服务器性能观测</h2>
      </div>
      <div class="toolbar-actions">
        <n-button secondary :loading="loading" @click="loadMetrics">刷新</n-button>
        <n-button secondary @click="returnHome">返回主页</n-button>
      </div>
    </header>

    <n-alert v-if="errorMessage" type="error" :show-icon="false">
      {{ errorMessage }}
    </n-alert>

    <n-spin v-if="loading && metrics === null" class="loading-state" />

    <template v-else-if="metrics">
      <div class="metric-grid">
        <div class="metric-tile">
          <span>Socket 连接</span>
          <strong>{{ metrics.socket.connected }}</strong>
          <small
            >累计 {{ metrics.socket.totalConnections }} / 断开
            {{ metrics.socket.totalDisconnects }}</small
          >
        </div>
        <div class="metric-tile">
          <span>运行中房间</span>
          <strong>{{ metrics.rooms.running }}</strong>
          <small
            >总房间 {{ metrics.rooms.total }}，活跃模拟 {{ metrics.rooms.activeSimulations }}</small
          >
        </div>
        <div class="metric-tile">
          <span>Tick p95</span>
          <strong>{{ formatMs(metrics.simulation.tickDurationMs.p95) }}</strong>
          <small>超时 {{ metrics.simulation.tickOverruns }} 次</small>
        </div>
        <div class="metric-tile">
          <span>事件循环 p95</span>
          <strong>{{ formatMs(metrics.process.eventLoopDelayMs.p95) }}</strong>
          <small>利用率 {{ formatPercent(metrics.process.eventLoopUtilization) }}</small>
        </div>
        <div class="metric-tile">
          <span>Heap 使用</span>
          <strong>{{ formatBytes(metrics.process.memory.heapUsed) }}</strong>
          <small>RSS {{ formatBytes(metrics.process.memory.rss) }}</small>
        </div>
        <div class="metric-tile">
          <span>Bot 数</span>
          <strong>{{ metrics.rooms.botCount }}</strong>
          <small>在线玩家 {{ metrics.rooms.onlinePlayers }}</small>
        </div>
      </div>

      <div class="panel-grid">
        <section class="metrics-panel">
          <div class="panel-title">
            <h3>模拟与 Bot</h3>
          </div>
          <dl class="compact-list">
            <div>
              <dt>Tick 平均 / 最大</dt>
              <dd>
                {{ formatMs(metrics.simulation.tickDurationMs.avg) }} /
                {{ formatMs(metrics.simulation.tickDurationMs.max) }}
              </dd>
            </div>
            <div>
              <dt>Core Tick p95</dt>
              <dd>{{ formatMs(metrics.simulation.simulationTickDurationMs.p95) }}</dd>
            </div>
            <div>
              <dt>Bot 控制 p95</dt>
              <dd>{{ formatMs(metrics.simulation.botControllerDurationMs.p95) }}</dd>
            </div>
            <div>
              <dt>Bot 控制帧</dt>
              <dd>{{ metrics.simulation.botControlFrames }}</dd>
            </div>
            <div>
              <dt>输入帧 / 丢弃</dt>
              <dd>
                {{ metrics.simulation.inputFrames }} / {{ metrics.simulation.droppedInputFrames }}
              </dd>
            </div>
            <div>
              <dt>事件 / 快照 / 重同步</dt>
              <dd>
                {{ metrics.simulation.simulationEvents }} / {{ metrics.simulation.snapshots }} /
                {{ metrics.simulation.resyncRequests }}
              </dd>
            </div>
          </dl>
        </section>

        <section class="metrics-panel">
          <div class="panel-title">
            <h3>Socket 事件</h3>
          </div>
          <div class="event-columns">
            <div>
              <h4>上行</h4>
              <p
                v-for="event in metrics.socket.inboundEvents.slice(0, 8)"
                :key="`in-${event.name}`"
              >
                <span>{{ event.name }}</span>
                <strong>{{ event.count }}</strong>
              </p>
              <n-empty
                v-if="metrics.socket.inboundEvents.length === 0"
                size="small"
                description="暂无上行事件"
              />
            </div>
            <div>
              <h4>下行</h4>
              <p
                v-for="event in metrics.socket.outboundEvents.slice(0, 8)"
                :key="`out-${event.name}`"
              >
                <span>{{ event.name }}</span>
                <strong>{{ event.count }}</strong>
              </p>
              <n-empty
                v-if="metrics.socket.outboundEvents.length === 0"
                size="small"
                description="暂无下行事件"
              />
            </div>
          </div>
        </section>
      </div>

      <section class="metrics-panel">
        <div class="panel-title">
          <h3>HTTP 接口</h3>
          <span>{{ sortedRoutes.length }} 个路由</span>
        </div>
        <div class="table-wrap">
          <table class="metrics-table">
            <thead>
              <tr>
                <th>路由</th>
                <th>请求</th>
                <th>速率</th>
                <th>错误率</th>
                <th>p95</th>
                <th>最大</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="route in sortedRoutes" :key="`${route.method}-${route.route}`">
                <td>
                  <code>{{ route.method }} {{ route.route }}</code>
                </td>
                <td>{{ route.requestCount }}</td>
                <td>{{ formatRate(route.ratePerSec) }}</td>
                <td>{{ formatPercent(route.errorRate) }}</td>
                <td>{{ formatMs(route.durationMs.p95) }}</td>
                <td>{{ formatMs(route.durationMs.max) }}</td>
              </tr>
            </tbody>
          </table>
          <n-empty v-if="sortedRoutes.length === 0" description="暂无 HTTP 指标" />
        </div>
      </section>

      <section class="metrics-panel">
        <div class="panel-title">
          <h3>房间负载</h3>
          <span>{{ sortedRooms.length }} / {{ metrics.limits.activeRoomLimit }}</span>
        </div>
        <div class="table-wrap">
          <table class="metrics-table">
            <thead>
              <tr>
                <th>房间</th>
                <th>状态</th>
                <th>玩家 / Bot</th>
                <th>Tick</th>
                <th>Tick p95</th>
                <th>Bot p95</th>
                <th>输入 / 丢弃</th>
                <th>事件 / 快照 / 重同步</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="room in sortedRooms" :key="room.roomId">
                <td>
                  <strong>{{ room.name }}</strong>
                  <small>{{ room.battleName ?? '未选择战斗' }}</small>
                </td>
                <td>
                  <n-tag :type="room.phase === 'running' ? 'success' : 'info'" size="small">
                    {{ room.phase === 'running' ? '模拟中' : '待开始' }}
                  </n-tag>
                </td>
                <td>{{ room.onlinePlayerCount }}/{{ room.playerCount }} / {{ room.botCount }}</td>
                <td>{{ room.tick ?? '-' }}</td>
                <td>{{ formatMs(room.tickDurationMs.p95) }}</td>
                <td>{{ formatMs(room.botControllerDurationMs.p95) }}</td>
                <td>{{ room.inputFrames }} / {{ room.droppedInputFrames }}</td>
                <td>
                  {{ room.simulationEvents }} / {{ room.snapshots }} / {{ room.resyncRequests }}
                </td>
              </tr>
            </tbody>
          </table>
          <n-empty v-if="sortedRooms.length === 0" description="当前没有房间" />
        </div>
      </section>

      <footer class="metrics-footer">
        Node {{ metrics.process.nodeVersion }} · {{ metrics.process.nodeEnv }} · 运行
        {{ formatUptime(metrics.process.uptimeSec) }}
      </footer>
    </template>
  </section>
</template>

<style scoped>
.metrics-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
}

.metrics-toolbar,
.panel-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.metrics-toolbar h2,
.panel-title h3 {
  margin: 0;
  font-weight: 600;
}

.metrics-toolbar h2 {
  font-size: 24px;
}

.panel-title h3 {
  font-size: 16px;
}

.panel-title span,
.metric-tile small,
.metrics-footer,
.event-columns h4 {
  color: rgba(246, 239, 228, 0.58);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.eyebrow {
  margin: 0 0 4px;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(246, 239, 228, 0.55);
}

.loading-state {
  margin: 72px auto;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}

.metric-tile,
.metrics-panel {
  border: 1px solid rgba(255, 223, 177, 0.12);
  background: rgba(255, 255, 255, 0.035);
  border-radius: 8px;
}

.metric-tile {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 14px;
}

.metric-tile span {
  color: rgba(246, 239, 228, 0.7);
}

.metric-tile strong {
  font-size: 24px;
  line-height: 1.1;
}

.panel-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}

.metrics-panel {
  padding: 14px;
}

.compact-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 18px;
  margin: 14px 0 0;
}

.compact-list div {
  min-width: 0;
}

.compact-list dt {
  margin-bottom: 3px;
  color: rgba(246, 239, 228, 0.58);
}

.compact-list dd {
  margin: 0;
  font-weight: 600;
}

.event-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.event-columns h4 {
  margin: 14px 0 8px;
  font-size: 13px;
  font-weight: 500;
}

.event-columns p {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 0;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255, 223, 177, 0.08);
}

.event-columns span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.table-wrap {
  margin-top: 12px;
  overflow: auto;
}

.metrics-table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
}

.metrics-table th,
.metrics-table td {
  padding: 9px 10px;
  border-bottom: 1px solid rgba(255, 223, 177, 0.09);
  text-align: left;
  vertical-align: middle;
  white-space: nowrap;
}

.metrics-table th {
  color: rgba(246, 239, 228, 0.58);
  font-weight: 500;
}

.metrics-table td small {
  display: block;
  margin-top: 2px;
  max-width: 260px;
  overflow: hidden;
  color: rgba(246, 239, 228, 0.56);
  text-overflow: ellipsis;
}

.metrics-table code {
  color: #f0d08b;
}

.metrics-footer {
  padding-bottom: 8px;
}

@media (max-width: 1180px) {
  .metric-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .panel-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .metric-grid,
  .compact-list,
  .event-columns {
    grid-template-columns: 1fr;
  }
}
</style>
