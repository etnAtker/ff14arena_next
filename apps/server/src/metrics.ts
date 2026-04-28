import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import type {
  HttpRouteMetricDto,
  MetricDistributionDto,
  ProcessMetricsDto,
  RoomPhase,
  RoomRuntimeMetricsDto,
  ServerMetricsSnapshotDto,
  SimulationMetricsDto,
} from '@ff14arena/shared';
import { FIXED_TICK_MS } from '@ff14arena/core';

const WINDOW_SEC = 600;
const BUCKET_SEC = 10;
const BUCKET_COUNT = WINDOW_SEC / BUCKET_SEC;
const BUCKET_MS = BUCKET_SEC * 1000;
const ACTIVE_ROOM_LIMIT = 256;
const CLOSED_ROOM_LIMIT = 64;
const ESTIMATED_MEMORY_BUDGET_MB = 16;
const ESTIMATED_MEMORY_CEILING_MB = 32;
const DURATION_BOUNDS_MS = [
  0.1, 0.25, 0.5, 0.75, 1, 2, 4, 8, 16, 33, 50, 100, 250, 500, 1000, 2500, 5000,
];

interface DurationAccumulator {
  count: number;
  sum: number;
  max: number;
  histogram: number[];
}

interface RouteBucket {
  method: string;
  route: string;
  requestCount: number;
  errorCount: number;
  statusCodes: Map<string, number>;
  duration: DurationAccumulator;
}

interface SimulationBucket {
  tickDuration: DurationAccumulator;
  botControllerDuration: DurationAccumulator;
  simulationTickDuration: DurationAccumulator;
  tickOverruns: number;
  inputFrames: number;
  droppedInputFrames: number;
  botControlFrames: number;
  simulationEvents: number;
  snapshots: number;
  resyncRequests: number;
}

interface MetricsBucket {
  key: number;
  httpRoutes: Map<string, RouteBucket>;
  inboundEvents: Map<string, number>;
  outboundEvents: Map<string, number>;
  errorsByCode: Map<string, number>;
  simulation: SimulationBucket;
}

interface RoomMetricsBucket extends SimulationBucket {
  key: number;
}

interface RoomMetricState {
  roomId: string;
  lastActiveAt: number;
  buckets: Map<number, RoomMetricsBucket>;
}

export interface RoomMetricDescriptor {
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
}

function createDurationAccumulator(): DurationAccumulator {
  return {
    count: 0,
    sum: 0,
    max: 0,
    histogram: Array.from({ length: DURATION_BOUNDS_MS.length + 1 }, () => 0),
  };
}

function mergeDurationAccumulator(target: DurationAccumulator, source: DurationAccumulator): void {
  target.count += source.count;
  target.sum += source.sum;
  target.max = Math.max(target.max, source.max);

  for (let index = 0; index < source.histogram.length; index += 1) {
    target.histogram[index] = (target.histogram[index] ?? 0) + (source.histogram[index] ?? 0);
  }
}

function recordDuration(accumulator: DurationAccumulator, durationMs: number): void {
  const safeDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const boundIndex = DURATION_BOUNDS_MS.findIndex((bound) => safeDurationMs <= bound);
  const histogramIndex = boundIndex < 0 ? DURATION_BOUNDS_MS.length : boundIndex;

  accumulator.count += 1;
  accumulator.sum += safeDurationMs;
  accumulator.max = Math.max(accumulator.max, safeDurationMs);
  accumulator.histogram[histogramIndex] = (accumulator.histogram[histogramIndex] ?? 0) + 1;
}

function toDistribution(accumulator: DurationAccumulator): MetricDistributionDto {
  if (accumulator.count === 0) {
    return {
      count: 0,
      avg: 0,
      p95: 0,
      max: 0,
    };
  }

  const targetRank = Math.ceil(accumulator.count * 0.95);
  let seen = 0;
  let p95 = accumulator.max;

  for (let index = 0; index < accumulator.histogram.length; index += 1) {
    seen += accumulator.histogram[index] ?? 0;

    if (seen >= targetRank) {
      p95 = DURATION_BOUNDS_MS[index] ?? accumulator.max;
      break;
    }
  }

  return {
    count: accumulator.count,
    avg: accumulator.sum / accumulator.count,
    p95,
    max: accumulator.max,
  };
}

function createSimulationBucket(): SimulationBucket {
  return {
    tickDuration: createDurationAccumulator(),
    botControllerDuration: createDurationAccumulator(),
    simulationTickDuration: createDurationAccumulator(),
    tickOverruns: 0,
    inputFrames: 0,
    droppedInputFrames: 0,
    botControlFrames: 0,
    simulationEvents: 0,
    snapshots: 0,
    resyncRequests: 0,
  };
}

function createMetricsBucket(key: number): MetricsBucket {
  return {
    key,
    httpRoutes: new Map(),
    inboundEvents: new Map(),
    outboundEvents: new Map(),
    errorsByCode: new Map(),
    simulation: createSimulationBucket(),
  };
}

function createRoomMetricsBucket(key: number): RoomMetricsBucket {
  return {
    key,
    ...createSimulationBucket(),
  };
}

function incrementCounter(counters: Map<string, number>, key: string, increment = 1): void {
  counters.set(key, (counters.get(key) ?? 0) + increment);
}

function mergeCounters(target: Map<string, number>, source: Map<string, number>): void {
  for (const [key, count] of source.entries()) {
    incrementCounter(target, key, count);
  }
}

function currentBucketKey(now = Date.now()): number {
  return Math.floor(now / BUCKET_MS);
}

function isBucketInWindow(bucketKey: number, nowKey: number): boolean {
  return bucketKey <= nowKey && nowKey - bucketKey < BUCKET_COUNT;
}

function createEmptySimulationSummary(): SimulationBucket {
  return createSimulationBucket();
}

function mergeSimulationBucket(target: SimulationBucket, source: SimulationBucket): void {
  mergeDurationAccumulator(target.tickDuration, source.tickDuration);
  mergeDurationAccumulator(target.botControllerDuration, source.botControllerDuration);
  mergeDurationAccumulator(target.simulationTickDuration, source.simulationTickDuration);
  target.tickOverruns += source.tickOverruns;
  target.inputFrames += source.inputFrames;
  target.droppedInputFrames += source.droppedInputFrames;
  target.botControlFrames += source.botControlFrames;
  target.simulationEvents += source.simulationEvents;
  target.snapshots += source.snapshots;
  target.resyncRequests += source.resyncRequests;
}

function toSimulationMetrics(summary: SimulationBucket): SimulationMetricsDto {
  return {
    tickDurationMs: toDistribution(summary.tickDuration),
    botControllerDurationMs: toDistribution(summary.botControllerDuration),
    simulationTickDurationMs: toDistribution(summary.simulationTickDuration),
    tickOverruns: summary.tickOverruns,
    inputFrames: summary.inputFrames,
    droppedInputFrames: summary.droppedInputFrames,
    botControlFrames: summary.botControlFrames,
    simulationEvents: summary.simulationEvents,
    snapshots: summary.snapshots,
    resyncRequests: summary.resyncRequests,
  };
}

function eventCountersToDto(counters: Map<string, number>) {
  return [...counters.entries()]
    .map(([name, count]) => ({
      name,
      count,
      ratePerSec: count / WINDOW_SEC,
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

export class ServerMetricsCollector {
  private readonly startedAt = Date.now();
  private readonly buckets = Array.from({ length: BUCKET_COUNT }, () => createMetricsBucket(-1));
  private readonly roomStates = new Map<string, RoomMetricState>();
  private readonly closedRoomIds: string[] = [];
  private readonly eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
  private readonly eventLoopUtilizationBase = performance.eventLoopUtilization();
  private activeSockets = 0;
  private totalConnections = 0;
  private totalDisconnects = 0;

  constructor() {
    this.eventLoopDelay.enable();
  }

  recordSocketConnect(): void {
    this.activeSockets += 1;
    this.totalConnections += 1;
  }

  recordSocketDisconnect(): void {
    this.activeSockets = Math.max(0, this.activeSockets - 1);
    this.totalDisconnects += 1;
  }

  recordSocketInbound(eventName: string): void {
    incrementCounter(this.getCurrentBucket().inboundEvents, eventName);
  }

  recordSocketOutbound(eventName: string): void {
    incrementCounter(this.getCurrentBucket().outboundEvents, eventName);
  }

  recordServerError(code: string): void {
    incrementCounter(this.getCurrentBucket().errorsByCode, code);
    this.recordSocketOutbound('server:error');
  }

  recordHttp(options: {
    method: string;
    route: string;
    statusCode: number;
    durationMs: number;
  }): void {
    const bucket = this.getCurrentBucket();
    const routeKey = `${options.method} ${options.route}`;
    let route = bucket.httpRoutes.get(routeKey);

    if (route === undefined) {
      route = {
        method: options.method,
        route: options.route,
        requestCount: 0,
        errorCount: 0,
        statusCodes: new Map(),
        duration: createDurationAccumulator(),
      };
      bucket.httpRoutes.set(routeKey, route);
    }

    route.requestCount += 1;

    if (options.statusCode >= 400) {
      route.errorCount += 1;
    }

    incrementCounter(route.statusCodes, String(options.statusCode));
    recordDuration(route.duration, options.durationMs);
  }

  recordRoomClosed(roomId: string): void {
    this.closedRoomIds.push(roomId);

    while (this.closedRoomIds.length > CLOSED_ROOM_LIMIT) {
      const expiredRoomId = this.closedRoomIds.shift();

      if (expiredRoomId !== undefined) {
        this.roomStates.delete(expiredRoomId);
      }
    }
  }

  recordInputFrame(roomId: string): void {
    this.getCurrentBucket().simulation.inputFrames += 1;
    this.getCurrentRoomBucket(roomId).inputFrames += 1;
  }

  recordDroppedInputFrame(roomId: string): void {
    this.getCurrentBucket().simulation.droppedInputFrames += 1;
    this.getCurrentRoomBucket(roomId).droppedInputFrames += 1;
  }

  recordResyncRequest(roomId: string): void {
    this.getCurrentBucket().simulation.resyncRequests += 1;
    this.getCurrentRoomBucket(roomId).resyncRequests += 1;
  }

  recordSnapshot(roomId: string): void {
    this.getCurrentBucket().simulation.snapshots += 1;
    this.getCurrentRoomBucket(roomId).snapshots += 1;
    this.recordSocketOutbound('sim:snapshot');
  }

  recordRoomState(): void {
    this.recordSocketOutbound('room:state');
  }

  recordRoomSlots(): void {
    this.recordSocketOutbound('room:slots');
  }

  recordSimStart(): void {
    this.recordSocketOutbound('sim:start');
  }

  recordSimEvents(roomId: string, eventCount: number): void {
    const bucket = this.getCurrentBucket();
    const roomBucket = this.getCurrentRoomBucket(roomId);

    bucket.simulation.simulationEvents += eventCount;
    roomBucket.simulationEvents += eventCount;
    this.recordSocketOutbound('sim:events');
  }

  recordSimEnd(): void {
    this.recordSocketOutbound('sim:end');
  }

  recordRoomClosedEvent(): void {
    this.recordSocketOutbound('room:closed');
  }

  recordTick(options: {
    roomId: string;
    tickDurationMs: number;
    botControllerDurationMs: number;
    simulationTickDurationMs: number;
    botControlFrames: number;
  }): void {
    const bucket = this.getCurrentBucket().simulation;
    const roomBucket = this.getCurrentRoomBucket(options.roomId);
    const overrun = options.tickDurationMs > FIXED_TICK_MS;

    recordDuration(bucket.tickDuration, options.tickDurationMs);
    recordDuration(bucket.botControllerDuration, options.botControllerDurationMs);
    recordDuration(bucket.simulationTickDuration, options.simulationTickDurationMs);
    bucket.botControlFrames += options.botControlFrames;

    recordDuration(roomBucket.tickDuration, options.tickDurationMs);
    recordDuration(roomBucket.botControllerDuration, options.botControllerDurationMs);
    recordDuration(roomBucket.simulationTickDuration, options.simulationTickDurationMs);
    roomBucket.botControlFrames += options.botControlFrames;

    if (overrun) {
      bucket.tickOverruns += 1;
      roomBucket.tickOverruns += 1;
    }
  }

  createSnapshot(liveRooms: RoomMetricDescriptor[]): ServerMetricsSnapshotDto {
    const nowKey = currentBucketKey();
    const liveRoomIds = new Set(liveRooms.map((room) => room.roomId));

    this.pruneRoomMetrics(liveRoomIds);

    return {
      collectedAt: Date.now(),
      limits: {
        windowSec: WINDOW_SEC,
        bucketSec: BUCKET_SEC,
        activeRoomLimit: ACTIVE_ROOM_LIMIT,
        closedRoomLimit: CLOSED_ROOM_LIMIT,
        estimatedMemoryBudgetMb: ESTIMATED_MEMORY_BUDGET_MB,
        estimatedMemoryCeilingMb: ESTIMATED_MEMORY_CEILING_MB,
        persistence: 'none',
      },
      process: this.createProcessMetrics(),
      rooms: {
        total: liveRooms.length,
        waiting: liveRooms.filter((room) => room.phase === 'waiting').length,
        running: liveRooms.filter((room) => room.phase === 'running').length,
        activeSimulations: liveRooms.filter((room) => room.activeSimulation).length,
        onlinePlayers: liveRooms.reduce((sum, room) => sum + room.onlinePlayerCount, 0),
        botCount: liveRooms.reduce((sum, room) => sum + room.botCount, 0),
      },
      http: {
        routes: this.createHttpMetrics(nowKey),
      },
      socket: this.createSocketMetrics(nowKey),
      simulation: this.createSimulationMetrics(nowKey),
      roomMetrics: this.createRoomMetrics(liveRooms, nowKey),
    };
  }

  private getCurrentBucket(): MetricsBucket {
    const key = currentBucketKey();
    const index = key % BUCKET_COUNT;
    let bucket = this.buckets[index];

    if (bucket === undefined || bucket.key !== key) {
      bucket = createMetricsBucket(key);
      this.buckets[index] = bucket;
    }

    return bucket;
  }

  private getCurrentRoomBucket(roomId: string): RoomMetricsBucket {
    const key = currentBucketKey();
    const state = this.ensureRoomState(roomId);
    let bucket = state.buckets.get(key);

    if (bucket === undefined) {
      bucket = createRoomMetricsBucket(key);
      state.buckets.set(key, bucket);
    }

    state.lastActiveAt = Date.now();
    this.pruneRoomBuckets(state, key);
    return bucket;
  }

  private ensureRoomState(roomId: string): RoomMetricState {
    let state = this.roomStates.get(roomId);

    if (state !== undefined) {
      return state;
    }

    state = {
      roomId,
      lastActiveAt: Date.now(),
      buckets: new Map(),
    };
    this.roomStates.set(roomId, state);
    this.pruneRoomMetrics(new Set());
    return state;
  }

  private pruneRoomMetrics(liveRoomIds: Set<string>): void {
    if (this.roomStates.size <= ACTIVE_ROOM_LIMIT) {
      return;
    }

    const sortedStates = [...this.roomStates.values()].sort(
      (left, right) => left.lastActiveAt - right.lastActiveAt,
    );

    for (const state of sortedStates) {
      if (this.roomStates.size <= ACTIVE_ROOM_LIMIT) {
        return;
      }

      if (!liveRoomIds.has(state.roomId)) {
        this.roomStates.delete(state.roomId);
      }
    }

    for (const state of sortedStates) {
      if (this.roomStates.size <= ACTIVE_ROOM_LIMIT) {
        return;
      }

      this.roomStates.delete(state.roomId);
    }
  }

  private pruneRoomBuckets(state: RoomMetricState, nowKey: number): void {
    for (const bucketKey of state.buckets.keys()) {
      if (!isBucketInWindow(bucketKey, nowKey)) {
        state.buckets.delete(bucketKey);
      }
    }
  }

  private createHttpMetrics(nowKey: number): HttpRouteMetricDto[] {
    const routes = new Map<string, RouteBucket>();

    for (const bucket of this.buckets) {
      if (!isBucketInWindow(bucket.key, nowKey)) {
        continue;
      }

      for (const [routeKey, source] of bucket.httpRoutes.entries()) {
        let target = routes.get(routeKey);

        if (target === undefined) {
          target = {
            method: source.method,
            route: source.route,
            requestCount: 0,
            errorCount: 0,
            statusCodes: new Map(),
            duration: createDurationAccumulator(),
          };
          routes.set(routeKey, target);
        }

        target.requestCount += source.requestCount;
        target.errorCount += source.errorCount;
        mergeCounters(target.statusCodes, source.statusCodes);
        mergeDurationAccumulator(target.duration, source.duration);
      }
    }

    return [...routes.values()]
      .map((route) => ({
        method: route.method,
        route: route.route,
        requestCount: route.requestCount,
        errorCount: route.errorCount,
        errorRate: route.requestCount === 0 ? 0 : route.errorCount / route.requestCount,
        ratePerSec: route.requestCount / WINDOW_SEC,
        durationMs: toDistribution(route.duration),
        statusCodes: Object.fromEntries(route.statusCodes.entries()),
      }))
      .sort((left, right) => right.requestCount - left.requestCount);
  }

  private createSocketMetrics(nowKey: number) {
    const inboundEvents = new Map<string, number>();
    const outboundEvents = new Map<string, number>();
    const errorsByCode = new Map<string, number>();

    for (const bucket of this.buckets) {
      if (!isBucketInWindow(bucket.key, nowKey)) {
        continue;
      }

      mergeCounters(inboundEvents, bucket.inboundEvents);
      mergeCounters(outboundEvents, bucket.outboundEvents);
      mergeCounters(errorsByCode, bucket.errorsByCode);
    }

    return {
      connected: this.activeSockets,
      totalConnections: this.totalConnections,
      totalDisconnects: this.totalDisconnects,
      inboundEvents: eventCountersToDto(inboundEvents),
      outboundEvents: eventCountersToDto(outboundEvents),
      errorsByCode: eventCountersToDto(errorsByCode),
    };
  }

  private createSimulationMetrics(nowKey: number): SimulationMetricsDto {
    const summary = createEmptySimulationSummary();

    for (const bucket of this.buckets) {
      if (isBucketInWindow(bucket.key, nowKey)) {
        mergeSimulationBucket(summary, bucket.simulation);
      }
    }

    return toSimulationMetrics(summary);
  }

  private createRoomMetrics(
    liveRooms: RoomMetricDescriptor[],
    nowKey: number,
  ): RoomRuntimeMetricsDto[] {
    return liveRooms
      .slice(0, ACTIVE_ROOM_LIMIT)
      .map((room) => {
        const state = this.roomStates.get(room.roomId);
        const summary = createEmptySimulationSummary();

        if (state !== undefined) {
          this.pruneRoomBuckets(state, nowKey);

          for (const bucket of state.buckets.values()) {
            if (isBucketInWindow(bucket.key, nowKey)) {
              mergeSimulationBucket(summary, bucket);
            }
          }
        }

        const simulationMetrics = toSimulationMetrics(summary);

        return {
          ...room,
          lastActiveAt: state?.lastActiveAt ?? this.startedAt,
          tickDurationMs: simulationMetrics.tickDurationMs,
          botControllerDurationMs: simulationMetrics.botControllerDurationMs,
          simulationTickDurationMs: simulationMetrics.simulationTickDurationMs,
          tickOverruns: simulationMetrics.tickOverruns,
          inputFrames: simulationMetrics.inputFrames,
          droppedInputFrames: simulationMetrics.droppedInputFrames,
          botControlFrames: simulationMetrics.botControlFrames,
          simulationEvents: simulationMetrics.simulationEvents,
          snapshots: simulationMetrics.snapshots,
          resyncRequests: simulationMetrics.resyncRequests,
        };
      })
      .sort((left, right) => {
        if (left.phase !== right.phase) {
          return left.phase === 'running' ? -1 : 1;
        }

        return right.tickDurationMs.p95 - left.tickDurationMs.p95;
      });
  }

  private createProcessMetrics(): ProcessMetricsDto {
    const memory = process.memoryUsage();
    const eventLoopUtilization = performance.eventLoopUtilization(
      this.eventLoopUtilizationBase,
    ).utilization;

    return {
      uptimeSec: process.uptime(),
      nodeVersion: process.version,
      nodeEnv: process.env.NODE_ENV ?? 'development',
      memory: {
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        external: memory.external,
        arrayBuffers: memory.arrayBuffers,
      },
      eventLoopDelayMs: {
        p95: this.eventLoopDelay.percentile(95) / 1_000_000,
        max: this.eventLoopDelay.max / 1_000_000,
      },
      eventLoopUtilization,
    };
  }
}
