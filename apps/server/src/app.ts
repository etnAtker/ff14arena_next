import Fastify, { type FastifyInstance } from 'fastify';
import { battleCatalog } from '@ff14arena/content';
import { Server } from 'socket.io';
import type { AddressInfo } from 'node:net';
import type { ClientToServerEvents, ServerToClientEvents } from '@ff14arena/shared';
import { RoomManager } from './room-manager';

export interface ServerContext {
  app: FastifyInstance;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  roomManager: RoomManager;
}

export function createServerContext(options?: { logger?: boolean }): ServerContext {
  const app = Fastify({
    logger: options?.logger ?? true,
  });

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(app.server, {
    cors: {
      origin: true,
    },
  });
  const roomManager = new RoomManager(io);

  app.get('/health', async () => ({
    status: 'ok',
    battleCount: battleCatalog.length,
    roomCount: roomManager.listRooms().length,
  }));

  app.get('/battles', async () => ({
    battles: battleCatalog,
  }));

  app.get('/rooms', async () => ({
    rooms: roomManager.listRooms(),
  }));

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

  io.on('connection', (socket) => {
    socket.on('room:join', (payload) => {
      roomManager.joinRoom(socket, payload);
    });

    socket.on('room:leave', (payload) => {
      roomManager.leaveRoom(socket, payload.roomId);
    });

    socket.on('room:ready', (payload) => {
      roomManager.setReady(socket, payload.roomId, payload.ready);
    });

    socket.on('room:select-battle', (payload) => {
      roomManager.selectBattle(socket, payload.roomId, payload.battleId);
    });

    socket.on('room:start', (payload) => {
      roomManager.startRoom(socket, payload.roomId);
    });

    socket.on('room:restart', (payload) => {
      roomManager.restartRoom(socket, payload.roomId);
    });

    socket.on('sim:move', (payload) => {
      roomManager.enqueueInput(socket, payload);
    });

    socket.on('sim:face', (payload) => {
      roomManager.enqueueInput(socket, payload);
    });

    socket.on('sim:use-knockback-immune', (payload) => {
      roomManager.enqueueInput(socket, payload);
    });

    socket.on('disconnect', () => {
      roomManager.handleDisconnect(socket.id);
    });
  });

  return {
    app,
    io,
    roomManager,
  };
}

export async function startServer(options?: { host?: string; port?: number; logger?: boolean }) {
  const context = createServerContext(
    options?.logger === undefined
      ? undefined
      : {
          logger: options.logger,
        },
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
