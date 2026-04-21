import Fastify from 'fastify';
import { Server } from 'socket.io';
import { battleCatalog } from '@ff14arena/content';
import { createSimulation } from '@ff14arena/core';

async function bootstrap() {
  const app = Fastify({
    logger: true,
  });

  const io = new Server({
    cors: {
      origin: true,
    },
  });

  app.get('/health', async () => {
    const simulation = createSimulation({
      tickRate: 20,
    });

    return {
      status: 'ok',
      battleCount: battleCatalog.length,
      tickRate: simulation.config.tickRate,
    };
  });

  app.get('/socket-status', async () => {
    return {
      ready: io.engine.clientsCount >= 0,
    };
  });

  await app.listen({
    host: '0.0.0.0',
    port: 3000,
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
