import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { io } from 'socket.io-client';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
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

function waitForNoPayload(socket, eventName, predicate, timeoutMs = 150) {
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(() => {
      socket.off(eventName, handleEvent);
      resolve(true);
    }, timeoutMs);

    const handleEvent = (payload) => {
      if (!predicate(payload)) {
        return;
      }

      globalThis.clearTimeout(timer);
      socket.off(eventName, handleEvent);
      resolve(false);
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
    syncId: options.syncId,
    actorId: options.actorId,
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

test('房间密码：启用后创建和加入都需要匹配密码', async () => {
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    logger: false,
    roomPassword: 'secret',
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const owner = io(baseUrl, { transports: ['websocket'] });
  const guest = io(baseUrl, { transports: ['websocket'] });

  try {
    const authConfigResponse = await globalThis.fetch(`${baseUrl}/auth-config`);
    assert.equal(authConfigResponse.status, 200);
    const authConfig = await authConfigResponse.json();
    assert.equal(authConfig.roomPasswordRequired, true);

    const battleId = await getAvailableBattleId(baseUrl);
    const deniedCreateResponse = await globalThis.fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '密码房',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId,
        password: 'wrong',
      }),
    });
    assert.equal(deniedCreateResponse.status, 403);
    const deniedCreatePayload = await deniedCreateResponse.json();
    assert.equal(deniedCreatePayload.code, 'invalid_room_password');

    const createResponse = await globalThis.fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '密码房',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId,
        password: 'secret',
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.roomId;

    await waitForConnect(owner);
    const ownerStatePromise = waitForRoomState(
      owner,
      (room) => room.roomId === roomId && room.phase === 'waiting',
    );
    owner.emit('room:join', {
      roomId,
      userId: 'owner-user',
      userName: '房主',
      password: 'secret',
    });
    await ownerStatePromise;

    await waitForConnect(guest);
    const guestErrorPromise = waitForPayload(
      guest,
      'server:error',
      (payload) => payload.code === 'invalid_room_password',
      4000,
    );
    guest.emit('room:join', {
      roomId,
      userId: 'guest-user',
      userName: '队员',
      password: 'wrong',
    });
    const guestError = await guestErrorPromise;
    assert.equal(guestError.message, '房间密码错误');

    const guestStatePromise = waitForRoomState(
      guest,
      (room) =>
        room.roomId === roomId && room.slots.some((slot) => slot.ownerUserId === 'guest-user'),
    );
    guest.emit('room:join', {
      roomId,
      userId: 'guest-user',
      userName: '队员',
      password: 'secret',
    });
    await guestStatePromise;
  } finally {
    owner.close();
    guest.close();
    await server.close();
  }
});

test('建房申请：房主加入后才实例化为真实房间', async () => {
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
        name: '待加入房',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId,
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    assert.equal(typeof createPayload.roomId, 'string');
    assert.equal(typeof createPayload.expiresAt, 'number');

    const pendingListResponse = await globalThis.fetch(`${baseUrl}/rooms`);
    assert.equal(pendingListResponse.status, 200);
    const pendingListPayload = await pendingListResponse.json();
    assert.equal(
      pendingListPayload.rooms.some((room) => room.roomId === createPayload.roomId),
      false,
    );

    await waitForConnect(guest);
    const guestErrorPromise = waitForPayload(
      guest,
      'server:error',
      (payload) => payload.code === 'not_owner',
    );
    guest.emit('room:join', {
      roomId: createPayload.roomId,
      userId: 'guest-user',
      userName: '队员',
    });
    await guestErrorPromise;

    const stillPendingListResponse = await globalThis.fetch(`${baseUrl}/rooms`);
    const stillPendingListPayload = await stillPendingListResponse.json();
    assert.equal(
      stillPendingListPayload.rooms.some((room) => room.roomId === createPayload.roomId),
      false,
    );

    await waitForConnect(owner);
    const ownerStatePromise = waitForRoomState(
      owner,
      (room) =>
        room.roomId === createPayload.roomId &&
        room.slots.some((slot) => slot.ownerUserId === 'owner-user'),
    );
    owner.emit('room:join', {
      roomId: createPayload.roomId,
      userId: 'owner-user',
      userName: '房主',
    });
    const room = await ownerStatePromise;
    assert.equal(room.phase, 'waiting');

    const activeListResponse = await globalThis.fetch(`${baseUrl}/rooms`);
    const activeListPayload = await activeListResponse.json();
    const summary = activeListPayload.rooms.find((candidate) => candidate.roomId === room.roomId);
    assert.equal(summary?.occupantCount, 1);
  } finally {
    owner.close();
    guest.close();
    await server.close();
  }
});

test('建房申请：超时后过期且不能再加入', async () => {
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    logger: false,
    pendingRoomTtlMs: 50,
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
        name: '过期房',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId,
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();

    await sleep(80);
    await waitForConnect(owner);
    const ownerErrorPromise = waitForPayload(
      owner,
      'server:error',
      (payload) => payload.code === 'room_not_found' || payload.code === 'room_expired',
    );
    owner.emit('room:join', {
      roomId: createPayload.roomId,
      userId: 'owner-user',
      userName: '房主',
    });
    await ownerErrorPromise;

    const roomsResponse = await globalThis.fetch(`${baseUrl}/rooms`);
    const roomsPayload = await roomsResponse.json();
    assert.equal(
      roomsPayload.rooms.some((room) => room.roomId === createPayload.roomId),
      false,
    );
  } finally {
    owner.close();
    await server.close();
  }
});

test('无效连续位姿输入会静默丢弃且不会产生错误回包风暴', async () => {
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    logger: false,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const socket = io(baseUrl, { transports: ['websocket'] });

  try {
    await waitForConnect(socket);

    for (let index = 0; index < 5; index += 1) {
      emitPoseFrame(socket, {
        roomId: 'missing-room',
        syncId: 1,
        actorId: 'missing-actor',
        position: { x: 0, y: 0 },
        facing: 0,
        moveDirection: { x: 0, y: 0 },
      });
    }

    const noError = await waitForNoPayload(socket, 'server:error', () => true, 250);
    assert.equal(noError, true);
  } finally {
    socket.close();
    await server.close();
  }
});

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
    const roomId = createPayload.roomId;

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
    assert.equal(joinedRoom.options.deadActorsInteract, true);
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

    const disabledOptionsPromise = waitForRoomState(
      owner,
      (room) => room.roomId === roomId && room.options.deadActorsInteract === false,
    );
    owner.emit('room:update-options', {
      roomId,
      options: {
        deadActorsInteract: false,
      },
    });
    const disabledOptionsRoom = await disabledOptionsPromise;
    assert.equal(disabledOptionsRoom.options.deadActorsInteract, false);

    const enabledOptionsPromise = waitForRoomState(
      owner,
      (room) => room.roomId === roomId && room.options.deadActorsInteract === true,
    );
    owner.emit('room:update-options', {
      roomId,
      options: {
        deadActorsInteract: true,
      },
    });
    const enabledOptionsRoom = await enabledOptionsPromise;
    assert.equal(enabledOptionsRoom.options.deadActorsInteract, true);

    const countdownPromise = waitForRoomState(
      owner,
      (room) => room.roomId === roomId && room.startCountdown !== null,
    );
    const countdownTickPromise = waitForPayload(
      guest,
      'room:countdown',
      (payload) => payload.roomId === roomId && payload.remainingSeconds === 1,
    );
    const startPromise = waitForEvent(owner, 'sim:start');

    owner.emit('room:start', {
      roomId,
      countdownMs: 1000,
    });
    const countdownRoom = await countdownPromise;
    assert.equal(countdownRoom.startCountdown.durationMs, 1000);
    const countdownTick = await countdownTickPromise;
    assert.equal(countdownTick.remainingSeconds, 1);

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

test('客户端同步快照不会暴露服务端脚本状态', async () => {
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    logger: false,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const owner = io(baseUrl, { transports: ['websocket'] });

  try {
    const createResponse = await globalThis.fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '客户端快照裁剪测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId: 'kefka_p3_second_trick',
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.roomId;

    await waitForConnect(owner);
    const waitingSnapshotPromise = waitForEvent(owner, 'sim:snapshot');
    owner.emit('room:join', {
      roomId,
      userId: 'owner-user',
      userName: '房主',
    });
    await waitForRoomState(owner, (room) => room.roomId === roomId && room.phase === 'waiting');
    const waitingSnapshot = await waitingSnapshotPromise;
    assert.deepEqual(waitingSnapshot.snapshot.scriptState, {});

    const startPromise = waitForEvent(owner, 'sim:start');
    owner.emit('room:start', {
      roomId,
      countdownMs: 1000,
    });
    const startPayload = await startPromise;
    assert.equal(startPayload.snapshot.phase, 'running');
    assert.deepEqual(startPayload.snapshot.scriptState, {});

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
      reason: 'client-snapshot-trim-check',
    });
    const resyncPayload = await resyncPromise;
    assert.deepEqual(resyncPayload.snapshot.scriptState, {});
  } finally {
    owner.close();
    await server.close();
  }
});

test('房主开战可以携带开始时间并从该时间点启动模拟', async () => {
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    logger: false,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const owner = io(baseUrl, { transports: ['websocket'] });

  try {
    const createResponse = await globalThis.fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '跳时开战测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId: 'kefka_p3_first_trick',
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.roomId;

    await waitForConnect(owner);
    const waitingSnapshotPromise = waitForEvent(owner, 'sim:snapshot');
    owner.emit('room:join', {
      roomId,
      userId: 'owner-user',
      userName: '房主',
    });
    await waitForRoomState(owner, (room) => room.roomId === roomId && room.phase === 'waiting');
    await waitingSnapshotPromise;

    const startPromise = waitForEvent(owner, 'sim:start');
    owner.emit('room:start', {
      roomId,
      countdownMs: 1000,
      startTimeMs: 54_000,
    });
    const startPayload = await startPromise;

    assert.equal(startPayload.snapshot.phase, 'running');
    assert.equal(startPayload.snapshot.timeMs, 54_000);
  } finally {
    owner.close();
    await server.close();
  }
});

test('不支持跳时的战斗传入非零开始时间会被拒绝', async () => {
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    logger: false,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const owner = io(baseUrl, { transports: ['websocket'] });

  try {
    const createResponse = await globalThis.fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '不支持跳时测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId: 'top_p1_program_loop',
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.roomId;

    await waitForConnect(owner);
    owner.emit('room:join', {
      roomId,
      userId: 'owner-user',
      userName: '房主',
    });
    await waitForRoomState(owner, (room) => room.roomId === roomId && room.phase === 'waiting');

    const errorPromise = waitForPayload(
      owner,
      'server:error',
      (payload) => payload.code === 'invalid_start_time',
      4000,
    );
    owner.emit('room:start', {
      roomId,
      countdownMs: 1000,
      startTimeMs: 1000,
    });
    await errorPromise;
  } finally {
    owner.close();
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
    const roomId = createPayload.roomId;

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

test('非房主主动离开后不会收到离房广播回写', async () => {
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
        name: '离房回写测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId,
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.roomId;

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
    await waitForRoomState(
      guest,
      (room) =>
        room.roomId === roomId && room.slots.some((slot) => slot.ownerUserId === 'guest-user'),
    );

    const ownerUpdatePromise = waitForRoomState(
      owner,
      (room) =>
        room.roomId === roomId && !room.slots.some((slot) => slot.ownerUserId === 'guest-user'),
    );
    const noGuestStatePromise = waitForNoPayload(
      guest,
      'room:state',
      (payload) => payload.room.roomId === roomId,
    );
    guest.emit('room:leave', {
      roomId,
    });

    await ownerUpdatePromise;
    assert.equal(await noGuestStatePromise, true);
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
    const roomId = createPayload.roomId;

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

    const startPromise = waitForEvent(owner, 'sim:start');
    const countdownTickPromise = waitForPayload(
      owner,
      'room:countdown',
      (payload) => payload.roomId === roomId && payload.remainingSeconds === 1,
    );
    owner.emit('room:start', {
      roomId,
      countdownMs: 1000,
    });
    await countdownTickPromise;
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
    const roomId = createPayload.roomId;

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

test('槽位满员时仍允许从大厅直接加入观战', async () => {
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    logger: false,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const sockets = [];

  try {
    const battleId = await getAvailableBattleId(baseUrl);
    const createResponse = await globalThis.fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '满员观战加入测试',
        ownerUserId: 'player-0',
        ownerName: '玩家0',
        battleId,
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.roomId;

    const owner = io(baseUrl, { transports: ['websocket'] });
    sockets.push(owner);
    await waitForConnect(owner);
    const ownerJoinPromise = waitForRoomState(
      owner,
      (room) => room.roomId === roomId && room.slots[0]?.ownerUserId === 'player-0',
    );
    owner.emit('room:join', {
      roomId,
      userId: 'player-0',
      userName: '玩家0',
      slot: PARTY_SLOT_ORDER[0],
    });
    await ownerJoinPromise;

    for (const [index, slot] of PARTY_SLOT_ORDER.slice(1).entries()) {
      const playerIndex = index + 1;
      const player = io(baseUrl, { transports: ['websocket'] });
      sockets.push(player);
      await waitForConnect(player);
      const joinPromise = waitForRoomState(
        owner,
        (room) =>
          room.roomId === roomId &&
          room.slots.find((slotState) => slotState.slot === slot)?.ownerUserId ===
            `player-${playerIndex}`,
      );
      player.emit('room:join', {
        roomId,
        userId: `player-${playerIndex}`,
        userName: `玩家${playerIndex}`,
        slot,
      });
      await joinPromise;
    }

    const spectator = io(baseUrl, { transports: ['websocket'] });
    sockets.push(spectator);
    await waitForConnect(spectator);
    const spectatorJoinPromise = waitForRoomState(
      spectator,
      (room) =>
        room.roomId === roomId &&
        room.slots.every((slot) => slot.occupantType === 'player') &&
        room.spectators.some((roomSpectator) => roomSpectator.userId === 'spectator-user'),
    );
    spectator.emit('room:join', {
      roomId,
      userId: 'spectator-user',
      userName: '观战者',
      mode: 'spectator',
    });
    const spectatorRoom = await spectatorJoinPromise;
    assert.equal(spectatorRoom.slots.filter((slot) => slot.occupantType === 'player').length, 8);
    assert.equal(spectatorRoom.spectators.length, 1);
  } finally {
    for (const socket of sockets) {
      socket.close();
    }
    await server.close();
  }
});

test('房主观战后可以以 8 个 Bot 开始战斗倒计时', async () => {
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
        name: '观战开始倒计时测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId,
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.roomId;

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

    const guestSpectatePromise = waitForRoomState(
      owner,
      (room) =>
        room.roomId === roomId &&
        room.spectators.some((spectator) => spectator.userId === 'guest-user') &&
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
      countdownMs: 1000,
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

test('房主可以在运行中快速失败并结束本轮模拟', async () => {
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
        name: '快速失败测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId,
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.roomId;

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

    const startPromise = waitForEvent(owner, 'sim:start');
    owner.emit('room:start', {
      roomId,
      countdownMs: 1000,
    });
    const startPayload = await startPromise;
    assert.equal(startPayload.snapshot.phase, 'running');

    const guestErrorPromise = waitForPayload(
      guest,
      'server:error',
      (payload) => payload.code === 'not_owner',
      4000,
    );
    guest.emit('room:quick-fail', {
      roomId,
    });
    const guestError = await guestErrorPromise;
    assert.equal(guestError.message, '只有房主可以快速失败');

    const endPromise = waitForPayload(
      owner,
      'sim:end',
      (payload) => payload.roomId === roomId && payload.latestResult.outcome === 'failure',
      4000,
    );
    const waitingRoomPromise = waitForRoomState(
      guest,
      (room) =>
        room.roomId === roomId &&
        room.phase === 'waiting' &&
        room.latestResult?.outcome === 'failure',
    );
    const failureEventPromise = waitForPayload(
      guest,
      'sim:events',
      (payload) =>
        payload.roomId === roomId &&
        payload.events.some((event) => event.type === 'battleFailureMarked'),
      4000,
    );

    owner.emit('room:quick-fail', {
      roomId,
    });

    const failureEvents = await failureEventPromise;
    const endPayload = await endPromise;
    const waitingRoom = await waitingRoomPromise;
    const failureEvent = failureEvents.events.find((event) => event.type === 'battleFailureMarked');

    assert.ok(failureEvent, '应广播快速失败原因事件');
    assert.deepEqual(failureEvent.payload.failureReasons, ['房主手动结束本轮模拟']);
    assert.deepEqual(endPayload.latestResult.failureReasons, ['房主手动结束本轮模拟']);
    assert.equal(waitingRoom.latestResult.outcome, 'failure');
  } finally {
    owner.close();
    guest.close();
    await server.close();
  }
});

test('倒计时期间移动会保留到正式开战快照', async () => {
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
        name: '倒计时移动保留测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId,
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.roomId;

    await waitForConnect(owner);
    const initialWaitingSnapshotPromise = waitForEvent(owner, 'sim:snapshot');
    owner.emit('room:join', {
      roomId,
      userId: 'owner-user',
      userName: '房主',
    });
    await waitForRoomState(owner, (room) => room.roomId === roomId && room.phase === 'waiting');
    const initialWaitingSnapshot = await initialWaitingSnapshotPromise;
    const initialOwnerActor = initialWaitingSnapshot.snapshot.actors.find(
      (actor) => actor.slot === 'MT',
    );
    assert.ok(initialOwnerActor, '等待态应找到房主角色');

    await waitForConnect(guest);
    const guestJoinSnapshotPromise = waitForEvent(guest, 'sim:snapshot');
    guest.emit('room:join', {
      roomId,
      userId: 'guest-user',
      userName: '队员',
      slot: 'ST',
    });
    await waitForRoomState(guest, (room) => room.roomId === roomId && room.phase === 'waiting');
    const guestJoinSnapshot = await guestJoinSnapshotPromise;
    const initialGuestViewOwnerActor = findActor(guestJoinSnapshot.snapshot, initialOwnerActor.id);
    assert.ok(initialGuestViewOwnerActor, '队员等待态应看到房主角色');

    const ownerMovedBeforeCountdown = {
      x: initialOwnerActor.position.x + 1,
      y: initialOwnerActor.position.y,
    };
    const guestPreCountdownMovePromise = waitForPayload(
      guest,
      'sim:events',
      (payload) =>
        payload.roomId === roomId &&
        payload.events.some(
          (event) => event.type === 'actorMoved' && event.payload.actorId === initialOwnerActor.id,
        ),
      4000,
    );
    emitPoseFrame(owner, {
      roomId,
      syncId: guestJoinSnapshot.syncId,
      actorId: initialOwnerActor.id,
      position: ownerMovedBeforeCountdown,
      facing: initialOwnerActor.facing,
      moveDirection: { x: 0, y: 0 },
    });
    await guestPreCountdownMovePromise;

    const countdownSnapshotPromise = waitForPayload(
      owner,
      'sim:snapshot',
      (payload) =>
        payload.roomId === roomId &&
        payload.reason === 'waiting-state' &&
        payload.syncId !== initialWaitingSnapshot.syncId,
      4000,
    );
    const guestCountdownSnapshotPromise = waitForPayload(
      guest,
      'sim:snapshot',
      (payload) =>
        payload.roomId === roomId &&
        payload.reason === 'waiting-state' &&
        payload.syncId !== guestJoinSnapshot.syncId,
      4000,
    );
    const startPromise = waitForEvent(owner, 'sim:start');
    const guestStartPromise = waitForEvent(guest, 'sim:start');
    owner.emit('room:start', {
      roomId,
      countdownMs: 1000,
    });
    const countdownSnapshot = await countdownSnapshotPromise;
    const guestCountdownSnapshot = await guestCountdownSnapshotPromise;
    const countdownOwnerActor = findActor(countdownSnapshot.snapshot, initialOwnerActor.id);
    assert.ok(countdownOwnerActor, '倒计时等待态应找到房主角色');
    assert.deepEqual(countdownOwnerActor.position, initialOwnerActor.position);
    const guestCountdownOwnerActor = findActor(
      guestCountdownSnapshot.snapshot,
      initialOwnerActor.id,
    );
    assert.ok(guestCountdownOwnerActor, '队员倒计时等待态应看到房主归位');
    assert.deepEqual(guestCountdownOwnerActor.position, initialOwnerActor.position);

    const movedPosition = {
      x: countdownOwnerActor.position.x + 1.4,
      y: countdownOwnerActor.position.y + 0.7,
    };
    const movedFacing = countdownOwnerActor.facing + 0.35;
    const ownerMovedEventPromise = waitForPayload(
      owner,
      'sim:events',
      (payload) =>
        payload.roomId === roomId &&
        payload.events.some(
          (event) => event.type === 'actorMoved' && event.payload.actorId === initialOwnerActor.id,
        ),
      4000,
    );
    const guestMovedEventPromise = waitForPayload(
      guest,
      'sim:events',
      (payload) =>
        payload.roomId === roomId &&
        payload.syncId === countdownSnapshot.syncId &&
        payload.events.some(
          (event) => event.type === 'actorMoved' && event.payload.actorId === initialOwnerActor.id,
        ),
      4000,
    );
    emitPoseFrame(owner, {
      roomId,
      syncId: countdownSnapshot.syncId,
      actorId: initialOwnerActor.id,
      position: movedPosition,
      facing: movedFacing,
      moveDirection: { x: 0, y: 0 },
    });
    await ownerMovedEventPromise;
    await guestMovedEventPromise;

    const startPayload = await startPromise;
    const guestStartPayload = await guestStartPromise;
    const startedOwnerActor = findActor(startPayload.snapshot, initialOwnerActor.id);
    assert.ok(startedOwnerActor, '正式开战快照应找到房主角色');
    assert.ok(displacementBetween(movedPosition, startedOwnerActor.position) <= 0.001);
    assert.equal(startedOwnerActor.facing, movedFacing);
    assert.equal(startPayload.snapshot.timeMs, 0);
    const guestStartedOwnerActor = findActor(guestStartPayload.snapshot, initialOwnerActor.id);
    assert.ok(guestStartedOwnerActor, '队员正式开战快照应看到房主角色');
    assert.ok(displacementBetween(movedPosition, guestStartedOwnerActor.position) <= 0.001);
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
    const roomId = createPayload.roomId;

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
    const roomId = createPayload.roomId;

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
      countdownMs: 1000,
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
      syncId: startPayload.syncId,
      actorId: ownerActor.id,
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
    const roomId = createPayload.roomId;

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
      syncId: waitingSnapshot.syncId,
      actorId: ownerActor.id,
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

test('冲刺会为玩家附加状态并记录冷却', async () => {
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
        name: '冲刺测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId,
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.roomId;

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
      countdownMs: 1000,
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
      syncId: startPayload.syncId,
      actorId: ownerActor.id,
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
    assert.ok(sprintEvent, '应收到冲刺状态事件');
    assert.equal(sprintEvent.payload.status.name, '冲刺');
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

test('等待态与战斗态位姿样本使用同一套移动链路', async () => {
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
    const roomId = createPayload.roomId;

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
        syncId: waitingSnapshot.syncId,
        actorId: ownerSlot.id,
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
      syncId: waitingSnapshot.syncId,
      actorId: ownerSlot.id,
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
      countdownMs: 1000,
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
        syncId: startPayload.syncId,
        actorId: ownerSlot.id,
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
      syncId: startPayload.syncId,
      actorId: ownerSlot.id,
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
      `等待态位移 ${waitingDistance.toFixed(3)}m 与战斗态位移 ${runningDistance.toFixed(
        3,
      )}m 应基本一致`,
    );
  } finally {
    owner.close();
    await server.close();
  }
});

test('旧同步轮高序号位姿样本不会阻塞当前战斗态移动', async () => {
  const server = await startServer({
    host: '127.0.0.1',
    port: 0,
    logger: false,
  });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const owner = io(baseUrl, { transports: ['websocket'] });
  const originalWarn = globalThis.console.warn;

  try {
    globalThis.console.warn = () => undefined;
    const battleId = await getAvailableBattleId(baseUrl);
    const createResponse = await globalThis.fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '旧同步轮输入隔离测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId,
      }),
    });
    assert.equal(createResponse.status, 200);
    const createPayload = await createResponse.json();
    const roomId = createPayload.roomId;

    await waitForConnect(owner);
    const waitingSnapshotPromise = waitForEvent(owner, 'sim:snapshot');
    owner.emit('room:join', {
      roomId,
      userId: 'owner-user',
      userName: '房主',
    });
    await waitForRoomState(owner, (room) => room.roomId === roomId && room.phase === 'waiting');
    const waitingSnapshot = await waitingSnapshotPromise;

    const startPromise = waitForEvent(owner, 'sim:start');
    owner.emit('room:start', {
      roomId,
      countdownMs: 1000,
    });
    const startPayload = await startPromise;
    const ownerActor = startPayload.snapshot.actors.find((actor) => actor.slot === 'MT');
    assert.ok(ownerActor, '应找到房主控制的 MT 角色');

    emitPoseFrame(owner, {
      roomId,
      syncId: waitingSnapshot.syncId,
      actorId: ownerActor.id,
      position: ownerActor.position,
      facing: ownerActor.facing,
      moveDirection: { x: 0, y: 0 },
    });

    const targetPosition = {
      x: ownerActor.position.x + 1,
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
      syncId: startPayload.syncId,
      actorId: ownerActor.id,
      position: targetPosition,
      facing: ownerActor.facing,
      moveDirection: { x: 1, y: 0 },
    });

    const movedPayload = await movedEventPromise;
    const actorMovedEvent = movedPayload.events.find(
      (event) => event.type === 'actorMoved' && event.payload.actorId === ownerActor.id,
    );
    assert.ok(actorMovedEvent, '当前同步轮低序号输入不应被旧同步轮高序号输入阻塞');
    assert.deepEqual(actorMovedEvent.payload.position, targetPosition);
  } finally {
    globalThis.console.warn = originalWarn;
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
