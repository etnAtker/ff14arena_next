import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { io } from 'socket.io-client';
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

function waitForPayload(socket, eventName, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      socket.off(eventName, handleEvent);
      reject(new Error(`${eventName} timeout`));
    }, timeoutMs);

    const handleEvent = (payload) => {
      if (!predicate(payload)) {
        return;
      }

      globalThis.clearTimeout(timer);
      socket.off(eventName, handleEvent);
      resolve(payload);
    };

    socket.on(eventName, handleEvent);
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function findActor(snapshot, actorId) {
  return snapshot.actors.find((actor) => actor.id === actorId);
}

function displacementBetween(from, to) {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

function emitPoseFrame(socket, options) {
  socket.emit('sim:input-frame', {
    roomId: options.roomId,
    actorId: options.actorId,
    inputSeq: options.inputSeq,
    issuedAt: Date.now(),
    payload: {
      position: options.position,
      facing: options.facing,
      moveDirection: options.moveDirection,
    },
  });
}

async function getAvailableBattleId(baseUrl) {
  const response = await globalThis.fetch(`${baseUrl}/battles`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  const battleId = payload.battles[0]?.id;
  assert.equal(typeof battleId, 'string');
  return battleId;
}

test('房间全流程：创建、立即加入、等待态快照、开始战斗', async () => {
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    logger: false,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const owner = io(baseUrl, { transports: ['websocket'] });
  const guest = io(baseUrl, { transports: ['websocket'] });

  try {
    const battleId = await getAvailableBattleId(baseUrl);
    const createResponse = await globalThis.fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '测试房',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId,
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.room.roomId;

    const ownerLobbyPromise = waitForRoomState(
      owner,
      (room) => room.roomId === roomId && room.phase === 'waiting',
    );
    const ownerWaitingSnapshotPromise = waitForEvent(owner, 'sim:snapshot');
    owner.emit('room:join', {
      roomId,
      userId: 'owner-user',
      userName: '房主',
    });

    await waitForConnect(owner);
    const joinedRoom = await ownerLobbyPromise;
    const ownerWaitingSnapshot = await ownerWaitingSnapshotPromise;
    assert.equal(joinedRoom.slots.filter((slot) => slot.occupantType === 'player').length, 1);
    assert.equal(ownerWaitingSnapshot.snapshot.phase, 'waiting');

    const guestLobbyPromise = waitForRoomState(
      guest,
      (room) => room.roomId === roomId && room.phase === 'waiting',
    );
    const guestWaitingSnapshotPromise = waitForEvent(guest, 'sim:snapshot');
    await waitForConnect(guest);
    guest.emit('room:join', {
      roomId,
      userId: 'guest-user',
      userName: '队员',
      slot: 'ST',
    });
    await guestLobbyPromise;

    const waitingSnapshotAfterJoin = await guestWaitingSnapshotPromise;
    assert.equal(waitingSnapshotAfterJoin.snapshot.phase, 'waiting');

    const allReadyPromise = waitForPayload(
      owner,
      'room:slots',
      (payload) =>
        payload.roomId === roomId &&
        payload.slots.find((slot) => slot.slot === 'ST')?.ready === true,
    );
    guest.emit('room:ready', {
      roomId,
      ready: true,
    });
    await allReadyPromise;

    const startPromise = waitForEvent(owner, 'sim:start');

    owner.emit('room:start', {
      roomId,
    });

    const startPayload = await startPromise;
    assert.equal(startPayload.roomId, roomId);
    assert.equal(startPayload.snapshot.phase, 'running');

    const healthResponse = await globalThis.fetch(`${baseUrl}/health`);
    assert.equal(healthResponse.status, 200);

    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, 80);
    });

    const metricsResponse = await globalThis.fetch(`${baseUrl}/admin/metrics`);
    assert.equal(metricsResponse.status, 200);
    const metricsPayload = await metricsResponse.json();
    assert.equal(metricsPayload.limits.persistence, 'none');
    assert.equal(metricsPayload.limits.windowSec, 600);
    assert.equal(metricsPayload.limits.estimatedMemoryCeilingMb, 32);
    assert.equal(metricsPayload.rooms.total, 1);
    assert.equal(metricsPayload.rooms.running, 1);
    assert.equal(metricsPayload.socket.connected, 2);
    assert.ok(metricsPayload.simulation.tickDurationMs.count >= 1);
    assert.equal(
      metricsPayload.http.routes.some((route) => route.route === '/health'),
      false,
    );
    assert.equal(
      metricsPayload.http.routes.some((route) => route.route === '/admin/metrics'),
      false,
    );
  } finally {
    owner.close();
    guest.close();
    await server.close();
  }
});

test('房主离开后立即销毁房间并通知其他玩家', async () => {
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    logger: false,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const owner = io(baseUrl, { transports: ['websocket'] });
  const guest = io(baseUrl, { transports: ['websocket'] });

  try {
    const battleId = await getAvailableBattleId(baseUrl);
    const createResponse = await globalThis.fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '房主离开测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId,
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.room.roomId;

    await waitForConnect(owner);
    const ownerWaitingSnapshotPromise = waitForEvent(owner, 'sim:snapshot');
    owner.emit('room:join', {
      roomId,
      userId: 'owner-user',
      userName: '房主',
    });
    await waitForRoomState(owner, (room) => room.roomId === roomId && room.phase === 'waiting');
    await ownerWaitingSnapshotPromise;

    await waitForConnect(guest);
    guest.emit('room:join', {
      roomId,
      userId: 'guest-user',
      userName: '队员',
    });
    await waitForRoomState(guest, (room) => room.roomId === roomId && room.phase === 'waiting');

    const roomClosedPromise = waitForEvent(guest, 'room:closed');
    owner.emit('room:leave', {
      roomId,
    });

    const closedPayload = await roomClosedPromise;
    assert.equal(closedPayload.roomId, roomId);
    assert.match(closedPayload.reason, /房主已离开/);
  } finally {
    owner.close();
    guest.close();
    await server.close();
  }
});

test('运行中断线后允许按原槽位重连，并向重连玩家下发权威快照', async () => {
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    logger: false,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const owner = io(baseUrl, { transports: ['websocket'] });
  const guest = io(baseUrl, { transports: ['websocket'] });
  let reconnectedGuest = null;

  try {
    const battleId = await getAvailableBattleId(baseUrl);
    const createResponse = await globalThis.fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '重连测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId,
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.room.roomId;

    await waitForConnect(owner);
    const ownerWaitingSnapshotPromise = waitForEvent(owner, 'sim:snapshot');
    owner.emit('room:join', {
      roomId,
      userId: 'owner-user',
      userName: '房主',
    });
    await waitForRoomState(
      owner,
      (nextRoom) => nextRoom.roomId === roomId && nextRoom.phase === 'waiting',
    );
    await ownerWaitingSnapshotPromise;

    await waitForConnect(guest);
    const guestWaitingSnapshotPromise = waitForEvent(guest, 'sim:snapshot');
    guest.emit('room:join', {
      roomId,
      userId: 'guest-user',
      userName: '队员',
      slot: 'ST',
    });
    await waitForRoomState(
      guest,
      (nextRoom) => nextRoom.roomId === roomId && nextRoom.phase === 'waiting',
    );
    await guestWaitingSnapshotPromise;

    const readyPromise = waitForPayload(
      owner,
      'room:slots',
      (payload) =>
        payload.roomId === roomId &&
        payload.slots.find((slot) => slot.slot === 'ST')?.ready === true,
    );
    guest.emit('room:ready', {
      roomId,
      ready: true,
    });
    await readyPromise;

    const startPromise = waitForEvent(owner, 'sim:start');
    owner.emit('room:start', {
      roomId,
    });
    const startPayload = await startPromise;

    const offlinePromise = waitForPayload(
      owner,
      'room:slots',
      (payload) =>
        payload.roomId === roomId &&
        payload.slots.find((slot) => slot.slot === 'ST')?.online === false,
      8000,
    );
    guest.close();
    await offlinePromise;

    reconnectedGuest = io(baseUrl, { transports: ['websocket'] });
    await waitForConnect(reconnectedGuest);

    const onlineAgainPromise = waitForPayload(
      owner,
      'room:slots',
      (payload) =>
        payload.roomId === roomId &&
        payload.slots.find((slot) => slot.slot === 'ST')?.online === true,
      8000,
    );
    const resyncSnapshotPromise = waitForPayload(
      reconnectedGuest,
      'sim:snapshot',
      (payload) => payload.roomId === roomId && payload.snapshot.phase === 'running',
      8000,
    );

    reconnectedGuest.emit('room:join', {
      roomId,
      userId: 'guest-user',
      userName: '队员',
    });

    const resyncSnapshot = await resyncSnapshotPromise;
    await onlineAgainPromise;

    assert.equal(resyncSnapshot.syncId, startPayload.syncId);
    assert.equal(resyncSnapshot.reason, 'rejoin');
    assert.equal(resyncSnapshot.snapshot.phase, 'running');
  } finally {
    owner.close();
    guest.close();
    reconnectedGuest?.close();
    await server.close();
  }
});

test('等待态玩家可以切换观战并点击槽位回到场内', async () => {
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    logger: false,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const owner = io(baseUrl, { transports: ['websocket'] });
  const guest = io(baseUrl, { transports: ['websocket'] });

  try {
    const battleId = await getAvailableBattleId(baseUrl);
    const createResponse = await globalThis.fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '观战回场测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId,
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.room.roomId;

    await waitForConnect(owner);
    const ownerWaitingSnapshotPromise = waitForEvent(owner, 'sim:snapshot');
    owner.emit('room:join', {
      roomId,
      userId: 'owner-user',
      userName: '房主',
    });
    await waitForRoomState(owner, (room) => room.roomId === roomId && room.phase === 'waiting');
    await ownerWaitingSnapshotPromise;

    await waitForConnect(guest);
    const guestWaitingSnapshotPromise = waitForEvent(guest, 'sim:snapshot');
    guest.emit('room:join', {
      roomId,
      userId: 'guest-user',
      userName: '队员',
      slot: 'ST',
    });
    await waitForRoomState(guest, (room) => room.roomId === roomId && room.phase === 'waiting');
    await guestWaitingSnapshotPromise;

    const spectatePromise = waitForRoomState(
      owner,
      (room) =>
        room.roomId === roomId &&
        room.spectators.some((spectator) => spectator.userId === 'guest-user') &&
        room.slots.find((slot) => slot.slot === 'ST')?.occupantType === 'bot',
    );
    guest.emit('room:spectate', {
      roomId,
    });
    const spectateRoom = await spectatePromise;
    assert.equal(spectateRoom.spectators.length, 1);

    const returnPromise = waitForRoomState(
      owner,
      (room) =>
        room.roomId === roomId &&
        room.spectators.every((spectator) => spectator.userId !== 'guest-user') &&
        room.slots.find((slot) => slot.slot === 'D1')?.ownerUserId === 'guest-user',
    );
    guest.emit('room:switch-slot', {
      roomId,
      targetSlot: 'D1',
    });
    const returnRoom = await returnPromise;
    assert.equal(returnRoom.slots.find((slot) => slot.slot === 'D1')?.occupantType, 'player');
  } finally {
    owner.close();
    guest.close();
    await server.close();
  }
});

test('房主观战后可以在所有真人准备时以 8 个 Bot 开始战斗', async () => {
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    logger: false,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const owner = io(baseUrl, { transports: ['websocket'] });
  const guest = io(baseUrl, { transports: ['websocket'] });

  try {
    const battleId = await getAvailableBattleId(baseUrl);
    const createResponse = await globalThis.fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '全 Bot 观战开始测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId,
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.room.roomId;

    await waitForConnect(owner);
    const ownerWaitingSnapshotPromise = waitForEvent(owner, 'sim:snapshot');
    owner.emit('room:join', {
      roomId,
      userId: 'owner-user',
      userName: '房主',
    });
    await waitForRoomState(owner, (room) => room.roomId === roomId && room.phase === 'waiting');
    await ownerWaitingSnapshotPromise;

    await waitForConnect(guest);
    const guestWaitingSnapshotPromise = waitForEvent(guest, 'sim:snapshot');
    guest.emit('room:join', {
      roomId,
      userId: 'guest-user',
      userName: '队员',
      slot: 'ST',
    });
    await waitForRoomState(guest, (room) => room.roomId === roomId && room.phase === 'waiting');
    await guestWaitingSnapshotPromise;

    const readyPromise = waitForPayload(
      owner,
      'room:slots',
      (payload) =>
        payload.roomId === roomId &&
        payload.slots.find((slot) => slot.slot === 'ST')?.ready === true,
    );
    guest.emit('room:ready', {
      roomId,
      ready: true,
    });
    await readyPromise;

    const guestSpectatePromise = waitForRoomState(
      owner,
      (room) =>
        room.roomId === roomId &&
        room.spectators.some(
          (spectator) => spectator.userId === 'guest-user' && spectator.ready === true,
        ) &&
        room.slots.find((slot) => slot.slot === 'ST')?.occupantType === 'bot',
    );
    guest.emit('room:spectate', {
      roomId,
    });
    await guestSpectatePromise;

    const ownerSpectatePromise = waitForRoomState(
      owner,
      (room) =>
        room.roomId === roomId &&
        room.spectators.some((spectator) => spectator.userId === 'owner-user') &&
        room.slots.every((slot) => slot.occupantType === 'bot'),
    );
    owner.emit('room:spectate', {
      roomId,
    });
    const allBotRoom = await ownerSpectatePromise;
    assert.equal(allBotRoom.spectators.length, 2);

    const startPromise = waitForEvent(owner, 'sim:start');
    owner.emit('room:start', {
      roomId,
    });
    const startPayload = await startPromise;
    assert.equal(startPayload.snapshot.phase, 'running');
    assert.equal(startPayload.snapshot.actors.length, 8);
    assert.equal(
      startPayload.snapshot.actors.every((actor) => actor.kind === 'bot'),
      true,
    );
  } finally {
    owner.close();
    guest.close();
    await server.close();
  }
});

test('客户端请求重同步时，服务端会回送当前权威快照', async () => {
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    logger: false,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const owner = io(baseUrl, { transports: ['websocket'] });

  try {
    const battleId = await getAvailableBattleId(baseUrl);
    const createResponse = await globalThis.fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '重同步测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId,
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.room.roomId;

    await waitForConnect(owner);
    const waitingSnapshotPromise = waitForEvent(owner, 'sim:snapshot');
    owner.emit('room:join', {
      roomId,
      userId: 'owner-user',
      userName: '房主',
    });
    await waitForRoomState(
      owner,
      (nextRoom) => nextRoom.roomId === roomId && nextRoom.phase === 'waiting',
    );
    await waitingSnapshotPromise;

    const resyncPromise = waitForPayload(
      owner,
      'sim:snapshot',
      (payload) => payload.roomId === roomId && payload.reason === 'resync',
      4000,
    );

    owner.emit('sim:request-resync', {
      roomId,
      reason: 'test_resync',
    });

    const resyncPayload = await resyncPromise;
    assert.equal(resyncPayload.snapshot.phase, 'waiting');
    assert.equal(typeof resyncPayload.syncId, 'number');
  } finally {
    owner.close();
    await server.close();
  }
});

test('运行态位姿样本会同步到服务端当前权威位置', async () => {
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    logger: false,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const owner = io(baseUrl, { transports: ['websocket'] });

  try {
    const battleId = await getAvailableBattleId(baseUrl);
    const createResponse = await globalThis.fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '运行态位姿样本测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId,
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.room.roomId;

    await waitForConnect(owner);
    const waitingSnapshotPromise = waitForEvent(owner, 'sim:snapshot');
    owner.emit('room:join', {
      roomId,
      userId: 'owner-user',
      userName: '房主',
    });
    await waitForRoomState(
      owner,
      (nextRoom) => nextRoom.roomId === roomId && nextRoom.phase === 'waiting',
    );
    await waitingSnapshotPromise;

    const startPromise = waitForEvent(owner, 'sim:start');
    owner.emit('room:start', {
      roomId,
    });
    const startPayload = await startPromise;
    const ownerActor = startPayload.snapshot.actors.find((actor) => actor.slot === 'MT');
    assert.ok(ownerActor, '应找到房主控制的 MT 角色');

    const targetPosition = {
      x: ownerActor.position.x + 1.2,
      y: ownerActor.position.y + 0.4,
    };
    const targetFacing = ownerActor.facing + 0.3;

    const movedEventPromise = waitForPayload(
      owner,
      'sim:events',
      (payload) =>
        payload.roomId === roomId &&
        payload.events.some(
          (event) => event.type === 'actorMoved' && event.payload.actorId === ownerActor.id,
        ),
      4000,
    );

    emitPoseFrame(owner, {
      roomId,
      actorId: ownerActor.id,
      inputSeq: 1,
      position: targetPosition,
      facing: targetFacing,
      moveDirection: { x: 1, y: 0 },
    });

    const movedPayload = await movedEventPromise;
    const actorMovedEvent = movedPayload.events
      .filter((event) => event.type === 'actorMoved' && event.payload.actorId === ownerActor.id)
      .at(-1);
    assert.ok(actorMovedEvent, '应收到房主角色的移动事件');
    assert.deepEqual(actorMovedEvent.payload.position, targetPosition);
    assert.equal(actorMovedEvent.payload.facing, targetFacing);
  } finally {
    owner.close();
    await server.close();
  }
});

test('等待态位姿样本通过统一事件链返回位移事件', async () => {
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    logger: false,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const owner = io(baseUrl, { transports: ['websocket'] });

  try {
    const battleId = await getAvailableBattleId(baseUrl);
    const createResponse = await globalThis.fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '等待态位姿样本测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId,
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.room.roomId;

    await waitForConnect(owner);
    const waitingSnapshotPromise = waitForEvent(owner, 'sim:snapshot');
    owner.emit('room:join', {
      roomId,
      userId: 'owner-user',
      userName: '房主',
    });
    await waitForRoomState(owner, (room) => room.roomId === roomId && room.phase === 'waiting');
    const waitingSnapshot = await waitingSnapshotPromise;
    const ownerActor = waitingSnapshot.snapshot.actors.find((actor) => actor.slot === 'MT');
    assert.ok(ownerActor, '应找到房主控制的 MT 角色');

    const targetPosition = {
      x: ownerActor.position.x + 0.8,
      y: ownerActor.position.y,
    };

    const movedEventPromise = waitForPayload(
      owner,
      'sim:events',
      (payload) =>
        payload.roomId === roomId &&
        payload.events.some(
          (event) => event.type === 'actorMoved' && event.payload.actorId === ownerActor.id,
        ),
      4000,
    );

    emitPoseFrame(owner, {
      roomId,
      actorId: ownerActor.id,
      inputSeq: 1,
      position: targetPosition,
      facing: ownerActor.facing,
      moveDirection: { x: 1, y: 0 },
    });

    const movedPayload = await movedEventPromise;
    const actorMovedEvent = movedPayload.events.find(
      (event) => event.type === 'actorMoved' && event.payload.actorId === ownerActor.id,
    );
    assert.ok(actorMovedEvent, '等待态输入后应收到位移事件');
    assert.deepEqual(actorMovedEvent.payload.position, targetPosition);
  } finally {
    owner.close();
    await server.close();
  }
});

test('疾跑会为玩家附加状态并记录冷却', async () => {
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    logger: false,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const owner = io(baseUrl, { transports: ['websocket'] });

  try {
    const battleId = await getAvailableBattleId(baseUrl);
    const createResponse = await globalThis.fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '疾跑测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId,
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.room.roomId;

    await waitForConnect(owner);
    owner.emit('room:join', {
      roomId,
      userId: 'owner-user',
      userName: '房主',
    });
    await waitForRoomState(owner, (room) => room.roomId === roomId && room.phase === 'waiting');

    const startPromise = waitForEvent(owner, 'sim:start');
    owner.emit('room:start', {
      roomId,
    });
    const startPayload = await startPromise;
    const ownerActor = startPayload.snapshot.actors.find((actor) => actor.slot === 'MT');
    assert.ok(ownerActor, '应找到房主控制的 MT 角色');

    const sprintEventPromise = waitForPayload(
      owner,
      'sim:events',
      (payload) =>
        payload.roomId === roomId &&
        payload.events.some(
          (event) =>
            event.type === 'statusApplied' &&
            event.payload.targetId === ownerActor.id &&
            event.payload.status.id === 'sprint',
        ),
      4000,
    );

    owner.emit('sim:use-sprint', {
      roomId,
      actorId: ownerActor.id,
      inputSeq: 1,
      issuedAt: Date.now(),
      type: 'use-sprint',
      payload: {
        issuedBy: 'player',
      },
    });

    const sprintPayload = await sprintEventPromise;
    const sprintEvent = sprintPayload.events.find(
      (event) =>
        event.type === 'statusApplied' &&
        event.payload.targetId === ownerActor.id &&
        event.payload.status.id === 'sprint',
    );
    assert.ok(sprintEvent, '应收到疾跑状态事件');
    assert.equal(sprintEvent.payload.status.name, '疾跑');
    assert.equal(sprintEvent.payload.status.expiresAt - sprintEvent.timeMs, 10000);

    const resyncPromise = waitForPayload(
      owner,
      'sim:snapshot',
      (payload) =>
        payload.roomId === roomId &&
        payload.reason === 'resync' &&
        payload.snapshot.phase === 'running',
      4000,
    );
    owner.emit('sim:request-resync', {
      roomId,
      reason: 'sprint-check',
    });
    const resyncPayload = await resyncPromise;
    const resyncActor = findActor(resyncPayload.snapshot, ownerActor.id);
    assert.ok(resyncActor, '重同步快照中应找到房主角色');
    assert.equal(resyncActor.sprintCooldown.readyAt, sprintEvent.timeMs + 60000);
    assert.equal(
      resyncActor.statuses.some((status) => status.id === 'sprint'),
      true,
    );
  } finally {
    owner.close();
    await server.close();
  }
});

test('准备态与战斗态位姿样本使用同一套移动链路', async () => {
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    logger: false,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const owner = io(baseUrl, { transports: ['websocket'] });

  try {
    const battleId = await getAvailableBattleId(baseUrl);
    const createResponse = await globalThis.fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '统一移动链路测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId,
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.room.roomId;

    await waitForConnect(owner);
    const waitingSnapshotPromise = waitForEvent(owner, 'sim:snapshot');
    owner.emit('room:join', {
      roomId,
      userId: 'owner-user',
      userName: '房主',
    });
    await waitForRoomState(
      owner,
      (nextRoom) => nextRoom.roomId === roomId && nextRoom.phase === 'waiting',
    );
    const waitingSnapshot = await waitingSnapshotPromise;
    const ownerSlot = waitingSnapshot.snapshot.actors.find((actor) => actor.slot === 'MT');
    assert.ok(ownerSlot, '应找到房主控制的 MT 角色');

    const waitingStartPosition = {
      x: ownerSlot.position.x,
      y: ownerSlot.position.y,
    };
    let waitingCurrentPosition = { ...waitingStartPosition };

    for (let seq = 1; seq <= 3; seq += 1) {
      const eventPromise = waitForPayload(
        owner,
        'sim:events',
        (payload) =>
          payload.roomId === roomId &&
          payload.events.some(
            (event) => event.type === 'actorMoved' && event.payload.actorId === ownerSlot.id,
          ),
        4000,
      );

      waitingCurrentPosition = {
        x: waitingCurrentPosition.x,
        y: waitingCurrentPosition.y + 0.6,
      };

      emitPoseFrame(owner, {
        roomId,
        actorId: ownerSlot.id,
        inputSeq: seq,
        position: waitingCurrentPosition,
        facing: ownerSlot.facing,
        moveDirection: { x: 0, y: 1 },
      });

      await eventPromise;
      await sleep(60);
    }

    const waitingStopPromise = waitForPayload(
      owner,
      'sim:events',
      (payload) =>
        payload.roomId === roomId &&
        payload.events.some(
          (event) => event.type === 'actorMoved' && event.payload.actorId === ownerSlot.id,
        ),
      4000,
    );
    emitPoseFrame(owner, {
      roomId,
      actorId: ownerSlot.id,
      inputSeq: 4,
      position: waitingCurrentPosition,
      facing: ownerSlot.facing,
      moveDirection: { x: 0, y: 0 },
    });
    await waitingStopPromise;

    const waitingResyncPromise = waitForPayload(
      owner,
      'sim:snapshot',
      (payload) => payload.roomId === roomId && payload.reason === 'resync',
      4000,
    );
    owner.emit('sim:request-resync', {
      roomId,
      reason: 'waiting-parity-check',
    });
    const waitingResyncSnapshot = await waitingResyncPromise;
    const waitingEndActor = findActor(waitingResyncSnapshot.snapshot, ownerSlot.id);
    assert.ok(waitingEndActor, '等待态重同步时应找到房主角色');
    const waitingDistance = displacementBetween(waitingStartPosition, waitingEndActor.position);

    const startPromise = waitForEvent(owner, 'sim:start');
    owner.emit('room:start', {
      roomId,
    });
    const startPayload = await startPromise;
    const runningStartActor = findActor(startPayload.snapshot, ownerSlot.id);
    assert.ok(runningStartActor, '进入战斗后应找到房主角色');
    const runningStartPosition = {
      x: runningStartActor.position.x,
      y: runningStartActor.position.y,
    };
    let runningCurrentPosition = { ...runningStartPosition };

    for (let seq = 1; seq <= 3; seq += 1) {
      const runningEventPromise = waitForPayload(
        owner,
        'sim:events',
        (payload) =>
          payload.roomId === roomId &&
          payload.events.some(
            (event) => event.type === 'actorMoved' && event.payload.actorId === ownerSlot.id,
          ),
        4000,
      );

      runningCurrentPosition = {
        x: runningCurrentPosition.x,
        y: runningCurrentPosition.y + 0.6,
      };

      emitPoseFrame(owner, {
        roomId,
        actorId: ownerSlot.id,
        inputSeq: seq,
        position: runningCurrentPosition,
        facing: ownerSlot.facing,
        moveDirection: { x: 0, y: 1 },
      });

      await runningEventPromise;
      await sleep(60);
    }

    const runningStopPromise = waitForPayload(
      owner,
      'sim:events',
      (payload) =>
        payload.roomId === roomId &&
        payload.events.some(
          (event) => event.type === 'actorMoved' && event.payload.actorId === ownerSlot.id,
        ),
      4000,
    );
    emitPoseFrame(owner, {
      roomId,
      actorId: ownerSlot.id,
      inputSeq: 4,
      position: runningCurrentPosition,
      facing: ownerSlot.facing,
      moveDirection: { x: 0, y: 0 },
    });
    await runningStopPromise;

    const runningResyncPromise = waitForPayload(
      owner,
      'sim:snapshot',
      (payload) =>
        payload.roomId === roomId &&
        payload.reason === 'resync' &&
        payload.snapshot.phase === 'running',
      6000,
    );
    owner.emit('sim:request-resync', {
      roomId,
      reason: 'running-parity-check',
    });
    const runningResyncSnapshot = await runningResyncPromise;
    const runningEndActor = findActor(runningResyncSnapshot.snapshot, ownerSlot.id);
    assert.ok(runningEndActor, '战斗态重同步时应找到房主角色');
    const runningDistance = displacementBetween(runningStartPosition, runningEndActor.position);

    assert.ok(
      Math.abs(waitingDistance - runningDistance) <= 0.05,
      `准备态位移 ${waitingDistance.toFixed(3)}m 与战斗态位移 ${runningDistance.toFixed(
        3,
      )}m 应基本一致`,
    );
  } finally {
    owner.close();
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
