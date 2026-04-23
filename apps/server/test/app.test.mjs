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

test('房间全流程：创建、立即加入、等待态快照、开始、结算回到待开始', async () => {
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
    const endPromise = waitForEvent(owner, 'sim:end');
    const backToWaitingPromise = waitForPayload(
      owner,
      'sim:snapshot',
      (payload) =>
        payload.roomId === roomId &&
        payload.snapshot.phase === 'waiting' &&
        payload.snapshot.latestResult !== null,
      12000,
    );

    owner.emit('room:start', {
      roomId,
    });

    const startPayload = await startPromise;
    assert.equal(startPayload.roomId, roomId);
    assert.equal(startPayload.snapshot.phase, 'running');

    const endPayload = await endPromise;
    assert.equal(endPayload.roomId, roomId);
    assert.equal(endPayload.latestResult.outcome, 'success');

    const waitingAgainSnapshot = await backToWaitingPromise;
    assert.equal(waitingAgainSnapshot.snapshot.latestResult?.outcome, 'success');

    const healthResponse = await globalThis.fetch(`${baseUrl}/health`);
    assert.equal(healthResponse.status, 200);
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
    const createResponse = await globalThis.fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '房主离开测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId: 'opening_two_rounds',
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
    const createResponse = await globalThis.fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '重连测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId: 'opening_two_rounds',
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

test('客户端请求重同步时，服务端会回送当前权威快照', async () => {
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
        name: '重同步测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId: 'opening_two_rounds',
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

test('高延迟移动输入会按 issuedAtServerTimeEstimate 补偿权威位置', async () => {
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
        name: '高延迟移动测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId: 'opening_two_rounds',
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

    await sleep(220);

    const movedEventPromise = waitForPayload(
      owner,
      'sim:events',
      (payload) =>
        payload.roomId === roomId &&
        payload.events.some(
          (event) => event.type === 'actorMoved' && event.payload.actorId === ownerActor.id,
        ),
      8_000,
    );

    owner.emit('sim:input-frame', {
      roomId,
      actorId: ownerActor.id,
      inputSeq: 1,
      issuedAt: Date.now() - 100,
      issuedAtServerTimeEstimate: Date.now() - 100,
      payload: {
        moveDirection: { x: 1, y: 0 },
      },
    });

    const movedPayload = await movedEventPromise;
    const actorMovedEvent = movedPayload.events
      .filter((event) => event.type === 'actorMoved' && event.payload.actorId === ownerActor.id)
      .at(-1);
    assert.ok(actorMovedEvent, '应收到房主角色的移动事件');

    const movedDistance = Math.hypot(
      actorMovedEvent.payload.position.x - ownerActor.position.x,
      actorMovedEvent.payload.position.y - ownerActor.position.y,
    );

    assert.ok(
      movedDistance >= 0.55,
      `补偿后首次权威位移应至少接近 0.6m，实际为 ${movedDistance.toFixed(3)}m`,
    );
  } finally {
    owner.close();
    await server.close();
  }
});

test('准备态与战斗态连续移动使用同一套位移规则', async () => {
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
        name: '统一移动链路测试',
        ownerUserId: 'owner-user',
        ownerName: '房主',
        battleId: 'opening_two_rounds',
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

    for (let seq = 1; seq <= 3; seq += 1) {
      const snapshotPromise = waitForPayload(
        owner,
        'sim:snapshot',
        (payload) => payload.roomId === roomId && payload.acknowledgedInputSeq >= seq,
        4000,
      );

      owner.emit('sim:input-frame', {
        roomId,
        actorId: ownerSlot.id,
        inputSeq: seq,
        issuedAt: Date.now(),
        issuedAtServerTimeEstimate: Date.now(),
        payload: {
          moveDirection: { x: 0, y: 1 },
        },
      });

      await snapshotPromise;
      await sleep(60);
    }

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

    for (let seq = 1; seq <= 3; seq += 1) {
      owner.emit('sim:input-frame', {
        roomId,
        actorId: ownerSlot.id,
        inputSeq: seq,
        issuedAt: Date.now(),
        issuedAtServerTimeEstimate: Date.now(),
        payload: {
          moveDirection: { x: 0, y: 1 },
        },
      });

      await sleep(60);
    }

    const runningResyncPromise = waitForPayload(
      owner,
      'sim:snapshot',
      (payload) =>
        payload.roomId === roomId &&
        payload.reason === 'resync' &&
        payload.snapshot.phase === 'running' &&
        payload.acknowledgedInputSeq >= 3,
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
