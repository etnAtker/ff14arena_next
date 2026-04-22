import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { io } from 'socket.io-client';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../src/app.ts';

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    if (socket.connected) {
      resolve();
      return;
    }

    const timer = globalThis.setTimeout(() => {
      socket.off('connect', handleConnect);
      reject(new Error('socket connect timeout'));
    }, 3000);

    const handleConnect = () => {
      globalThis.clearTimeout(timer);
      socket.off('connect', handleConnect);
      resolve();
    };

    socket.on('connect', handleConnect);
  });
}

function waitForRoomState(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      socket.off('room:state', handleRoomState);
      reject(new Error('room:state timeout'));
    }, 4000);

    const handleRoomState = (payload) => {
      if (!predicate(payload.room)) {
        return;
      }

      globalThis.clearTimeout(timer);
      socket.off('room:state', handleRoomState);
      resolve(payload.room);
    };

    socket.on('room:state', handleRoomState);
  });
}

function waitForEvent(socket, eventName) {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      socket.off(eventName, handleEvent);
      reject(new Error(`${eventName} timeout`));
    }, 12000);

    const handleEvent = (payload) => {
      globalThis.clearTimeout(timer);
      socket.off(eventName, handleEvent);
      resolve(payload);
    };

    socket.on(eventName, handleEvent);
  });
}

test('房间全流程：创建、立即加入、开始、结算、重开', async () => {
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    logger: false,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const owner = io(baseUrl, { transports: ['websocket'] });
  const guest = io(baseUrl, { transports: ['websocket'] });

  try {
    const createResponse = await globalThis.fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '测试房',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId: 'opening_two_rounds',
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.room.roomId;

    const ownerLobbyPromise = waitForRoomState(
      owner,
      (room) => room.roomId === roomId && room.phase === 'lobby',
    );
    owner.emit('room:join', {
      roomId,
      userId: 'owner-user',
      userName: '房主',
    });

    await waitForConnect(owner);
    const joinedRoom = await ownerLobbyPromise;
    assert.equal(joinedRoom.slots.filter((slot) => slot.occupantType === 'player').length, 1);

    const guestLobbyPromise = waitForRoomState(
      guest,
      (room) => room.roomId === roomId && room.phase === 'lobby',
    );
    await waitForConnect(guest);
    guest.emit('room:join', {
      roomId,
      userId: 'guest-user',
      userName: '队员',
      slot: 'ST',
    });
    await guestLobbyPromise;

    guest.emit('room:ready', {
      roomId,
      ready: true,
    });
    await delay(200);

    const loadingPromise = waitForRoomState(
      owner,
      (room) => room.roomId === roomId && room.phase === 'loading',
    );
    const startPromise = waitForEvent(owner, 'sim:start');
    const endPromise = waitForEvent(owner, 'sim:end');

    owner.emit('room:start', {
      roomId,
    });

    const loadingRoom = await loadingPromise;
    assert.equal(loadingRoom.phase, 'loading');

    const startPayload = await startPromise;
    assert.equal(startPayload.roomId, roomId);

    const endPayload = await endPromise;
    assert.equal(endPayload.roomId, roomId);
    assert.equal(endPayload.result.outcome, 'success');

    const restartPromise = waitForEvent(owner, 'sim:restart');
    owner.emit('room:restart', {
      roomId,
    });

    const restartPayload = await restartPromise;
    assert.equal(restartPayload.roomId, roomId);

    const healthResponse = await globalThis.fetch(`${baseUrl}/health`);
    assert.equal(healthResponse.status, 200);
  } finally {
    owner.close();
    guest.close();
    await server.close();
  }
});

test('生产静态托管：返回前端资源并仅对页面请求执行 SPA 回退', async () => {
  const staticRoot = await mkdtemp(join(tmpdir(), 'ff14arena-static-'));
  await mkdir(join(staticRoot, 'assets'));
  await writeFile(
    join(staticRoot, 'index.html'),
    '<!doctype html><html><body>ff14arena</body></html>',
  );
  await writeFile(join(staticRoot, 'assets', 'entry.js'), 'console.log("ff14arena");');

  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    logger: false,
    staticRoot,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;

  try {
    const homeResponse = await globalThis.fetch(baseUrl, {
      headers: {
        accept: 'text/html',
      },
    });
    assert.equal(homeResponse.status, 200);
    assert.match(await homeResponse.text(), /ff14arena/);

    const assetResponse = await globalThis.fetch(`${baseUrl}/assets/entry.js`);
    assert.equal(assetResponse.status, 200);
    assert.match(await assetResponse.text(), /console\.log/);

    const spaResponse = await globalThis.fetch(`${baseUrl}/battle/demo`, {
      headers: {
        accept: 'text/html',
      },
    });
    assert.equal(spaResponse.status, 200);
    assert.match(await spaResponse.text(), /ff14arena/);

    const missingApiResponse = await globalThis.fetch(`${baseUrl}/rooms/missing`, {
      headers: {
        accept: 'text/html',
      },
    });
    assert.equal(missingApiResponse.status, 404);
    assert.deepEqual(await missingApiResponse.json(), {
      message: '资源不存在',
    });
  } finally {
    await server.close();
    await rm(staticRoot, { recursive: true, force: true });
  }
});
