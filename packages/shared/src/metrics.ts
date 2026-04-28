import type { RoomPhase } from './base';

export interface MetricDistributionDto {
  count: number;
  avg: number;
  p95: number;
  max: number;
}

export interface EventCountMetricDto {
  name: string;
  count: number;
  ratePerSec: number;
}

export interface HttpRouteMetricDto {
  method: string;
  route: string;
  requestCount: number;
  errorCount: number;
  errorRate: number;
  ratePerSec: number;
  durationMs: MetricDistributionDto;
  statusCodes: Record<string, number>;
}

export interface SocketMetricsDto {
  connected: number;
  totalConnections: number;
  totalDisconnects: number;
  inboundEvents: EventCountMetricDto[];
  outboundEvents: EventCountMetricDto[];
  errorsByCode: EventCountMetricDto[];
}

export interface ProcessMemoryMetricsDto {
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
}

export interface ProcessMetricsDto {
  uptimeSec: number;
  nodeVersion: string;
  nodeEnv: string;
  memory: ProcessMemoryMetricsDto;
  eventLoopDelayMs: {
    p95: number;
    max: number;
  };
  eventLoopUtilization: number;
}

export interface RoomAggregateMetricsDto {
  total: number;
  waiting: number;
  running: number;
  activeSimulations: number;
  onlinePlayers: number;
  botCount: number;
}

export interface SimulationMetricsDto {
  tickDurationMs: MetricDistributionDto;
  botControllerDurationMs: MetricDistributionDto;
  simulationTickDurationMs: MetricDistributionDto;
  tickOverruns: number;
  inputFrames: number;
  droppedInputFrames: number;
  botControlFrames: number;
  simulationEvents: number;
  snapshots: number;
  resyncRequests: number;
}

export interface RoomRuntimeMetricsDto {
  roomId: string;
  name: string;
  battleName: string | null;
  phase: RoomPhase;
  playerCount: number;
  onlinePlayerCount: number;
  botCount: number;
  activeSimulation: boolean;
  tick: number | null;
  timeMs: number | null;
  syncId: number;
  latestResultPresent: boolean;
  failureReasonCount: number;
  lastActiveAt: number;
  tickDurationMs: MetricDistributionDto;
  botControllerDurationMs: MetricDistributionDto;
  simulationTickDurationMs: MetricDistributionDto;
  tickOverruns: number;
  inputFrames: number;
  droppedInputFrames: number;
  botControlFrames: number;
  simulationEvents: number;
  snapshots: number;
  resyncRequests: number;
}

export interface ServerMetricsLimitsDto {
  windowSec: number;
  bucketSec: number;
  activeRoomLimit: number;
  closedRoomLimit: number;
  estimatedMemoryBudgetMb: number;
  estimatedMemoryCeilingMb: number;
  persistence: 'none';
}

export interface ServerMetricsSnapshotDto {
  collectedAt: number;
  limits: ServerMetricsLimitsDto;
  process: ProcessMetricsDto;
  rooms: RoomAggregateMetricsDto;
  http: {
    routes: HttpRouteMetricDto[];
  };
  socket: SocketMetricsDto;
  simulation: SimulationMetricsDto;
  roomMetrics: RoomRuntimeMetricsDto[];
}
