import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { battleCatalog, getBattleStaticData } from '@ff14arena/content';
import { Server } from 'socket.io';
import type { AddressInfo } from 'node:net';
import type { ClientToServerEvents, ServerToClientEvents } from '@ff14arena/shared';
import { performance } from 'node:perf_hooks';
import { ServerMetricsCollector } from './metrics';
import { RoomManager } from './room-manager';

const DEFAULT_WEB_DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const BACKEND_ROUTE_PREFIXES = ['/health', '/battles', '/rooms', '/admin', '/socket.io'];
const requestStartedAt = new WeakMap<FastifyRequest, number>();

export interface ServerContextOptions {
  logger?: boolean;
  staticRoot?: string;
}

export interface ServerContext {
  app: FastifyInstance;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  roomManager: RoomManager;
  metrics: ServerMetricsCollector;
}

export interface StartServerOptions extends ServerContextOptions {
  host?: string;
  port?: number;
}

function resolveStaticRoot(staticRoot?: string): string | null {
  const candidate = staticRoot ?? process.env.WEB_DIST_DIR ?? DEFAULT_WEB_DIST_DIR;

  if (candidate.trim().length === 0) {
    return null;
  }

  return existsSync(candidate) ? candidate : null;
}

function isBackendRoute(pathname: string): boolean {
  return BACKEND_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function shouldServeSpaShell(request: FastifyRequest): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }

  const acceptHeader = request.headers.accept ?? '';

  if (!acceptHeader.includes('text/html')) {
    return false;
  }

  const requestUrl = request.raw.url ?? '/';
  const pathname = new URL(requestUrl, 'http://localhost').pathname;

  return !isBackendRoute(pathname);
}

function shouldRecordHttpMetrics(pathname: string): boolean {
  return pathname !== '/health' && pathname !== '/admin/metrics';
}

export function createServerContext(options?: ServerContextOptions): ServerContext {
  const app = Fastify({
    logger: options?.logger ?? true,
  });
  const staticRoot = resolveStaticRoot(options?.staticRoot);

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server, {
    cors: {
      origin: true,
    },
  });
  const metrics = new ServerMetricsCollector();
  const roomManager = new RoomManager(io, metrics);

  app.addHook('onRequest', async (request) => {
    requestStartedAt.set(request, performance.now());
  });

  app.addHook('onResponse', async (request, reply) => {
    const startedAt = requestStartedAt.get(request) ?? performance.now();
    const requestUrl = request.raw.url ?? '/';
    const pathname = new URL(requestUrl, 'http://localhost').pathname;

    if (!shouldRecordHttpMetrics(pathname)) {
      return;
    }

    const route = request.routeOptions.url ?? pathname;

    metrics.recordHttp({
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs: performance.now() - startedAt,
    });
  });

  app.get('/health', async () => ({
    status: 'ok',
    battleCount: battleCatalog.length,
    roomCount: roomManager.listRooms().length,
  }));

  app.get('/battles', async () => ({
    battles: battleCatalog,
  }));

  app.get('/battles/:battleId/static', async (request, reply) => {
    const { battleId } = request.params as { battleId: string };
    const battle = getBattleStaticData(battleId);

    if (battle === undefined) {
      reply.code(404);
      return {
        message: '战斗不存在',
      };
    }

    return {
      battle,
    };
  });

  app.get('/rooms', async () => ({
    rooms: roomManager.listRooms(),
  }));

  app.get('/admin/metrics', async () =>
    metrics.createSnapshot(roomManager.listMetricDescriptors()),
  );

  app.post('/rooms', async (request, reply) => {
    const body = request.body as {
      name?: string;
      ownerUserId?: string;
      ownerName?: string;
      battleId?: string;
    };

    if (!body.name || !body.ownerUserId || !body.ownerName) {
      reply.code(400);
      return {
        message: 'name、ownerUserId、ownerName 为必填项',
      };
    }

    const createPayload = {
      name: body.name,
      ownerUserId: body.ownerUserId,
      ownerName: body.ownerName,
      ...(body.battleId ? { battleId: body.battleId } : {}),
    };

    return {
      room: roomManager.createRoom(createPayload),
    };
  });

  if (staticRoot !== null) {
    app.register(fastifyStatic, {
      root: staticRoot,
      prefix: '/',
    });

    app.setNotFoundHandler((request, reply) => {
      if (shouldServeSpaShell(request)) {
        return reply.type('text/html').sendFile('index.html');
      }

      reply.code(404);
      return {
        message: '资源不存在',
      };
    });
  }

  io.on('connection', (socket) => {
    metrics.recordSocketConnect();

    socket.on('room:join', (payload) => {
      metrics.recordSocketInbound('room:join');
      roomManager.joinRoom(socket, payload);
    });

    socket.on('room:leave', (payload) => {
      metrics.recordSocketInbound('room:leave');
      roomManager.leaveRoom(socket, payload.roomId);
    });

    socket.on('room:ready', (payload) => {
      metrics.recordSocketInbound('room:ready');
      roomManager.setReady(socket, payload.roomId, payload.ready);
    });

    socket.on('room:select-battle', (payload) => {
      metrics.recordSocketInbound('room:select-battle');
      roomManager.selectBattle(socket, payload.roomId, payload.battleId);
    });

    socket.on('room:switch-slot', (payload) => {
      metrics.recordSocketInbound('room:switch-slot');
      roomManager.switchSlot(socket, payload);
    });

    socket.on('room:spectate', (payload) => {
      metrics.recordSocketInbound('room:spectate');
      roomManager.spectate(socket, payload.roomId);
    });

    socket.on('room:start', (payload) => {
      metrics.recordSocketInbound('room:start');
      roomManager.startRoom(socket, payload.roomId);
    });

    socket.on('sim:input-frame', (payload) => {
      metrics.recordSocketInbound('sim:input-frame');
      roomManager.enqueueContinuousInput(socket, payload);
    });

    socket.on('sim:use-knockback-immune', (payload) => {
      metrics.recordSocketInbound('sim:use-knockback-immune');
      roomManager.enqueueInput(socket, payload);
    });

    socket.on('sim:request-resync', (payload) => {
      metrics.recordSocketInbound('sim:request-resync');
      roomManager.requestResync(socket, payload);
    });

    socket.on('disconnect', () => {
      metrics.recordSocketDisconnect();
      roomManager.handleDisconnect(socket.id);
    });
  });

  return {
    app,
    io,
    roomManager,
    metrics,
  };
}

export async function startServer(options?: StartServerOptions) {
  const contextOptions: ServerContextOptions = {};

  if (options?.logger !== undefined) {
    contextOptions.logger = options.logger;
  }

  if (options?.staticRoot !== undefined) {
    contextOptions.staticRoot = options.staticRoot;
  }

  const context = createServerContext(
    Object.keys(contextOptions).length === 0 ? undefined : contextOptions,
  );

  await context.app.listen({
    host: options?.host ?? '0.0.0.0',
    port: options?.port ?? 3000,
  });

  const address = context.app.server.address() as AddressInfo | null;

  return {
    ...context,
    port: address?.port ?? options?.port ?? 3000,
    async close() {
      await context.io.close();
      await context.app.close();
    },
  };
}
