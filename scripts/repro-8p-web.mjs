#!/usr/bin/env node
/* global KeyboardEvent, window */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const PARTY_SLOT_ORDER = ['MT', 'ST', 'H1', 'H2', 'D1', 'D2', 'D3', 'D4'];
const PROFILE_STORAGE_KEY = 'ff14arena:profile';
const DEFAULT_BASE_URL = 'http://127.0.0.1:5173';
const DEFAULT_HOLD_MS = 3_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];
const CAMERA_DRAG_DELTA_X = 240;
const DRAG_ROTATION_SENSITIVITY = 0.005;
const KEY_TEXT = {
  KeyW: 'w',
  KeyA: 'a',
  KeyS: 's',
  KeyD: 'd',
};

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    headed: false,
    holdMs: DEFAULT_HOLD_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    artifactsDir: path.resolve(process.cwd(), 'tmp', `repro-8p-web-${Date.now()}`),
    keepOpen: false,
    latencyMs: 0,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--') {
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    if (arg === '--headed') {
      options.headed = true;
      continue;
    }

    if (arg === '--keep-open') {
      options.keepOpen = true;
      continue;
    }

    if (arg === '--latency-ms' && next !== undefined) {
      options.latencyMs = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (arg.startsWith('--latency-ms=')) {
      options.latencyMs = Number.parseInt(arg.slice('--latency-ms='.length), 10);
      continue;
    }

    if (arg === '--base-url' && next !== undefined) {
      options.baseUrl = next;
      index += 1;
      continue;
    }

    if (arg.startsWith('--base-url=')) {
      options.baseUrl = arg.slice('--base-url='.length);
      continue;
    }

    if (arg === '--hold-ms' && next !== undefined) {
      options.holdMs = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (arg.startsWith('--hold-ms=')) {
      options.holdMs = Number.parseInt(arg.slice('--hold-ms='.length), 10);
      continue;
    }

    if (arg === '--timeout-ms' && next !== undefined) {
      options.timeoutMs = Number.parseInt(next, 10);
      index += 1;
      continue;
    }

    if (arg.startsWith('--timeout-ms=')) {
      options.timeoutMs = Number.parseInt(arg.slice('--timeout-ms='.length), 10);
      continue;
    }

    if (arg === '--artifacts-dir' && next !== undefined) {
      options.artifactsDir = path.resolve(next);
      index += 1;
      continue;
    }

    if (arg.startsWith('--artifacts-dir=')) {
      options.artifactsDir = path.resolve(arg.slice('--artifacts-dir='.length));
      continue;
    }

    throw new Error(`未知参数：${arg}`);
  }

  if (!Number.isFinite(options.holdMs) || options.holdMs <= 0) {
    throw new Error('--hold-ms 必须是正整数');
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout-ms 必须是正整数');
  }

  if (!Number.isFinite(options.latencyMs) || options.latencyMs < 0) {
    throw new Error('--latency-ms 必须是非负整数');
  }

  options.baseUrl = options.baseUrl.replace(/\/+$/, '');
  return options;
}

function printHelp() {
  console.log(`用法：
  node scripts/repro-8p-web.mjs --base-url https://arena.etnatker.top

参数：
  --base-url <url>        目标 Web 地址，默认 ${DEFAULT_BASE_URL}
  --headed                使用有头浏览器
  --hold-ms <ms>          8 人按键移动持续时间，默认 ${DEFAULT_HOLD_MS}
  --timeout-ms <ms>       页面操作超时，默认 ${DEFAULT_TIMEOUT_MS}
  --artifacts-dir <dir>   失败截图目录，默认 tmp/repro-8p-web-<timestamp>
  --latency-ms <ms>       浏览器侧网络延迟，默认 0
  --keep-open             结束后不关闭浏览器，用于人工检查`);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseSocketIoFrame(payload) {
  const raw = typeof payload === 'string' ? payload : payload.toString('utf8');
  const packetIndex = raw.indexOf('42');

  if (packetIndex < 0) {
    return null;
  }

  const jsonStart = raw.indexOf('[', packetIndex);

  if (jsonStart < 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw.slice(jsonStart));

    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string') {
      return null;
    }

    return {
      eventName: parsed[0],
      payload: parsed[1],
    };
  } catch {
    return null;
  }
}

function createClientStats(index) {
  return {
    index,
    userId: `repro-user-${index}-${Date.now()}`,
    userName: `复现${index + 1}`,
    sentInputFrames: 0,
    sentMovingInputFrames: 0,
    maxInputSyncId: 0,
    firstMovingPosition: null,
    lastMovingPosition: null,
    lastInputPosition: null,
    lastInputDirection: null,
    preStartLastInputDirection: null,
    postStartLastInputDirection: null,
    preStartLastMovingInputDirection: null,
    postStartLastMovingInputDirection: null,
    sentInputActorIds: new Set(),
    sentMoveDirections: new Set(),
    receivedMovedActorIds: new Set(),
    receivedMovedSlots: new Set(),
    startSnapshot: null,
    countdownResetSnapshot: null,
    latestSnapshot: null,
    latestSnapshotSyncId: 0,
    lastRoomId: null,
    errors: [],
  };
}

function recordPacket(stats, packet, actorSlotById) {
  if (packet === null) {
    return;
  }

  if (packet.eventName === 'server:error') {
    stats.errors.push(packet.payload);
    return;
  }

  if (packet.eventName === 'sim:input-frame') {
    stats.sentInputFrames += 1;
    if (typeof packet.payload?.syncId === 'number') {
      stats.maxInputSyncId = Math.max(stats.maxInputSyncId, packet.payload.syncId);
    }
    const position = packet.payload?.payload?.position;
    const direction = packet.payload?.payload?.moveDirection;

    if (typeof position?.x === 'number' && typeof position?.y === 'number') {
      stats.lastInputPosition = {
        x: Number(position.x.toFixed(3)),
        y: Number(position.y.toFixed(3)),
      };
    }
    if (typeof direction?.x === 'number' && typeof direction?.y === 'number') {
      stats.lastInputDirection = {
        x: Number(direction.x.toFixed(3)),
        y: Number(direction.y.toFixed(3)),
      };
      const isMovingDirection = Math.hypot(direction.x, direction.y) > 0.001;

      if (stats.startSnapshot === null) {
        stats.preStartLastInputDirection = stats.lastInputDirection;
        if (isMovingDirection) {
          stats.preStartLastMovingInputDirection = stats.lastInputDirection;
        }
      } else {
        stats.postStartLastInputDirection = stats.lastInputDirection;
        if (isMovingDirection) {
          stats.postStartLastMovingInputDirection = stats.lastInputDirection;
        }
      }
    }
    if (typeof packet.payload?.actorId === 'string') {
      stats.sentInputActorIds.add(packet.payload.actorId);
    }

    if (
      typeof direction?.x === 'number' &&
      typeof direction?.y === 'number' &&
      Math.hypot(direction.x, direction.y) > 0.001
    ) {
      stats.sentMovingInputFrames += 1;
      if (typeof position?.x === 'number' && typeof position?.y === 'number') {
        if (stats.firstMovingPosition === null) {
          stats.firstMovingPosition = {
            x: Number(position.x.toFixed(3)),
            y: Number(position.y.toFixed(3)),
          };
        }
        stats.lastMovingPosition = {
          x: Number(position.x.toFixed(3)),
          y: Number(position.y.toFixed(3)),
        };
      }
      stats.sentMoveDirections.add(`${direction.x.toFixed(3)},${direction.y.toFixed(3)}`);
    }
    return;
  }

  if (packet.eventName === 'sim:start') {
    stats.startSnapshot = packet.payload?.snapshot ?? null;
    stats.lastRoomId = packet.payload?.roomId ?? stats.lastRoomId;

    for (const actor of stats.startSnapshot?.actors ?? []) {
      if (typeof actor.id === 'string' && typeof actor.slot === 'string') {
        actorSlotById.set(actor.id, actor.slot);
      }
    }
    return;
  }

  if (packet.eventName === 'sim:snapshot') {
    stats.latestSnapshot = packet.payload?.snapshot ?? null;
    if (typeof packet.payload?.syncId === 'number') {
      stats.latestSnapshotSyncId = Math.max(stats.latestSnapshotSyncId, packet.payload.syncId);
    }
    stats.lastRoomId = packet.payload?.roomId ?? stats.lastRoomId;

    if (packet.payload?.reason === 'waiting-state' && stats.latestSnapshot?.phase === 'waiting') {
      stats.countdownResetSnapshot = stats.latestSnapshot;
    }

    for (const actor of stats.latestSnapshot?.actors ?? []) {
      if (typeof actor.id === 'string' && typeof actor.slot === 'string') {
        actorSlotById.set(actor.id, actor.slot);
      }
    }
    return;
  }

  if (packet.eventName !== 'sim:events') {
    return;
  }

  for (const event of packet.payload?.events ?? []) {
    if (event.type !== 'actorMoved') {
      continue;
    }

    const actorId = event.payload?.actorId;

    if (typeof actorId !== 'string') {
      continue;
    }

    stats.receivedMovedActorIds.add(actorId);
    const slot = actorSlotById.get(actorId);

    if (slot !== undefined) {
      stats.receivedMovedSlots.add(slot);
    }
  }
}

async function waitUntil(label, predicate, options) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < options.timeoutMs) {
    if (predicate()) {
      return;
    }

    await sleep(100);
  }

  throw new Error(`${label} 超时`);
}

async function setProfile(context, profile) {
  await context.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    {
      key: PROFILE_STORAGE_KEY,
      value: profile,
    },
  );
}

async function createPage(browser, options, stats, actorSlotById) {
  const context = await browser.newContext({
    viewport: {
      width: 1280,
      height: 860,
    },
  });
  await setProfile(context, {
    userId: stats.userId,
    userName: stats.userName,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(options.timeoutMs);
  if (options.latencyMs > 0) {
    const cdpSession = await context.newCDPSession(page);
    await cdpSession.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: options.latencyMs,
      downloadThroughput: 1_000_000,
      uploadThroughput: 1_000_000,
      connectionType: 'wifi',
    });
  }
  page.on('websocket', (socket) => {
    socket.on('framesent', (frame) => {
      recordPacket(stats, parseSocketIoFrame(frame.payload), actorSlotById);
    });
    socket.on('framereceived', (frame) => {
      recordPacket(stats, parseSocketIoFrame(frame.payload), actorSlotById);
    });
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      stats.errors.push({
        code: 'browser_console_error',
        message: message.text(),
      });
    }
  });
  return {
    context,
    page,
  };
}

async function gotoHome(page, baseUrl) {
  await page.goto(baseUrl, {
    waitUntil: 'networkidle',
  });
  await page.getByText('创建房间').waitFor();
}

async function createRoomFromUi(page, roomName) {
  await page.getByPlaceholder('输入房间名').fill(roomName);
  await page.getByRole('button', { name: '创建并进入' }).click();
  await page.getByText(roomName).waitFor();
}

async function joinRoomFromUi(page, roomName) {
  await page.getByRole('button', { name: '刷新' }).click();
  const roomRow = page.locator('.room-row').filter({
    hasText: roomName,
  });
  await roomRow.getByRole('button', { name: '加入', exact: true }).click();
  await page.getByText(roomName).waitFor();
}

async function clickStart(page) {
  await page.getByRole('button', { name: '开始' }).first().click();
}

async function dispatchKey(page, type, code) {
  await page.evaluate(
    ({ eventType, eventCode, eventKey }) => {
      window.dispatchEvent(
        new KeyboardEvent(eventType, {
          code: eventCode,
          key: eventKey,
          bubbles: true,
        }),
      );
    },
    {
      eventType: type,
      eventCode: code,
      eventKey: KEY_TEXT[code],
    },
  );
}

async function dragCamera(page) {
  const stage = page.locator('.battle-stage');
  const box = await stage.boundingBox();

  if (box === null) {
    throw new Error('找不到战斗场地，无法拖动镜头');
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down({ button: 'left' });
  await page.mouse.move(startX + CAMERA_DRAG_DELTA_X, startY, { steps: 12 });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(100);
}

function countChangedActors(startSnapshot, latestSnapshot) {
  if (startSnapshot === null || latestSnapshot === null) {
    return {
      count: 0,
      slots: [],
    };
  }

  const startById = new Map(startSnapshot.actors.map((actor) => [actor.id, actor]));
  const changedSlots = [];

  for (const actor of latestSnapshot.actors) {
    const startActor = startById.get(actor.id);

    if (startActor === undefined) {
      continue;
    }

    const movedDistance = Math.hypot(
      actor.position.x - startActor.position.x,
      actor.position.y - startActor.position.y,
    );

    if (movedDistance > 0.2) {
      changedSlots.push(actor.slot);
    }
  }

  return {
    count: changedSlots.length,
    slots: changedSlots.sort(),
  };
}

function countMovedBetween(fromSnapshot, toSnapshot) {
  return countChangedActors(fromSnapshot, toSnapshot);
}

function findActorBySlot(snapshot, slot) {
  return snapshot?.actors.find((actor) => actor.slot === slot) ?? null;
}

function expectedTraditionalForwardDirection(facing, cameraDragDeltaX) {
  const cameraYaw = facing + Math.PI / 2 + cameraDragDeltaX * DRAG_ROTATION_SENSITIVITY;

  return {
    x: Number(Math.sin(cameraYaw).toFixed(3)),
    y: Number((-Math.cos(cameraYaw)).toFixed(3)),
  };
}

function directionDistance(left, right) {
  if (left === null || right === null) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.hypot(left.x - right.x, left.y - right.y);
}

async function captureArtifacts(clients, artifactsDir) {
  await mkdir(artifactsDir, { recursive: true });
  await Promise.all(
    clients.map(({ page }, index) =>
      page.screenshot({
        path: path.join(artifactsDir, `client-${index + 1}.png`),
        fullPage: true,
      }),
    ),
  );
}

function createSummary(options, roomName, observerStats, allStats) {
  const changed = countChangedActors(observerStats.startSnapshot, observerStats.latestSnapshot);
  const preStartChanged = countMovedBetween(
    observerStats.countdownResetSnapshot,
    observerStats.startSnapshot,
  );
  const ownerSlot = PARTY_SLOT_ORDER[0];
  const ownerCountdownActor = findActorBySlot(observerStats.countdownResetSnapshot, ownerSlot);
  const expectedOwnerPostStartDirection =
    ownerCountdownActor === null
      ? null
      : expectedTraditionalForwardDirection(ownerCountdownActor.facing, CAMERA_DRAG_DELTA_X);
  const ownerStats = allStats[0];

  return {
    baseUrl: options.baseUrl,
    roomName,
    roomId: observerStats.lastRoomId,
    clients: allStats.map((stats) => ({
      index: stats.index,
      userName: stats.userName,
      sentInputFrames: stats.sentInputFrames,
      sentMovingInputFrames: stats.sentMovingInputFrames,
      maxInputSyncId: stats.maxInputSyncId,
      firstMovingPosition: stats.firstMovingPosition,
      lastMovingPosition: stats.lastMovingPosition,
      lastInputPosition: stats.lastInputPosition,
      lastInputDirection: stats.lastInputDirection,
      preStartLastInputDirection: stats.preStartLastInputDirection,
      postStartLastInputDirection: stats.postStartLastInputDirection,
      preStartLastMovingInputDirection: stats.preStartLastMovingInputDirection,
      postStartLastMovingInputDirection: stats.postStartLastMovingInputDirection,
      sentInputActorIds: [...stats.sentInputActorIds],
      sentMoveDirections: [...stats.sentMoveDirections],
      receivedMovedActorCount: stats.receivedMovedActorIds.size,
      receivedMovedSlots: [...stats.receivedMovedSlots].sort(),
      errors: stats.errors,
    })),
    observer: {
      startActorCount: observerStats.startSnapshot?.actors.length ?? 0,
      countdownResetActorCount: observerStats.countdownResetSnapshot?.actors.length ?? 0,
      latestSnapshotTick: observerStats.latestSnapshot?.tick ?? null,
      preStartChangedActorCount: preStartChanged.count,
      preStartChangedSlots: preStartChanged.slots,
      movedEventActorCount: observerStats.receivedMovedActorIds.size,
      movedEventSlots: [...observerStats.receivedMovedSlots].sort(),
      changedSnapshotActorCount: changed.count,
      changedSnapshotSlots: changed.slots,
      expectedOwnerPostStartDirection,
      ownerPostStartDirection: ownerStats.postStartLastMovingInputDirection,
      ownerPostStartDirectionDistance: directionDistance(
        ownerStats.postStartLastMovingInputDirection,
        expectedOwnerPostStartDirection,
      ),
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const actorSlotById = new Map();
  const allStats = PARTY_SLOT_ORDER.map((_, index) => createClientStats(index));
  const browser = await chromium.launch({
    headless: !options.headed,
  });
  const clients = [];
  const roomName = `8人网页复现-${Date.now()}`;

  try {
    for (const stats of allStats) {
      clients.push(await createPage(browser, options, stats, actorSlotById));
    }

    await Promise.all(clients.map(({ page }) => gotoHome(page, options.baseUrl)));
    await createRoomFromUi(clients[0].page, roomName);

    for (let index = 1; index < clients.length; index += 1) {
      await joinRoomFromUi(clients[index].page, roomName);
    }

    const beforeStartSyncIds = allStats.map((stats) => stats.latestSnapshotSyncId);
    await clickStart(clients[0].page);

    await waitUntil(
      '等待全部客户端收到倒计时重置快照',
      () =>
        allStats.every(
          (stats, index) =>
            stats.countdownResetSnapshot?.phase === 'waiting' &&
            stats.latestSnapshotSyncId > beforeStartSyncIds[index],
        ),
      options,
    );

    await Promise.all(
      clients.map(({ page }, index) => dispatchKey(page, 'keydown', MOVE_KEYS[index])),
    );
    await sleep(options.holdMs);
    await Promise.all(
      clients.map(({ page }, index) => dispatchKey(page, 'keyup', MOVE_KEYS[index])),
    );
    await dragCamera(clients[0].page);

    await waitUntil(
      '等待全部客户端 sim:start',
      () => allStats.every((stats) => stats.startSnapshot?.phase === 'running'),
      options,
    );

    await Promise.all(
      clients.map(({ page }, index) => dispatchKey(page, 'keydown', MOVE_KEYS[index])),
    );
    await sleep(options.holdMs);
    await Promise.all(
      clients.map(({ page }, index) => dispatchKey(page, 'keyup', MOVE_KEYS[index])),
    );
    await sleep(1_000);

    await waitUntil(
      '等待 8 个客户端发出输入',
      () => allStats.every((stats) => stats.sentInputFrames > 0),
      options,
    );

    const summary = createSummary(options, roomName, allStats[0], allStats);
    const ok =
      summary.clients.every((client) => client.sentInputFrames > 0) &&
      summary.observer.preStartChangedActorCount === PARTY_SLOT_ORDER.length &&
      summary.observer.movedEventActorCount === PARTY_SLOT_ORDER.length &&
      summary.observer.changedSnapshotActorCount === PARTY_SLOT_ORDER.length &&
      summary.observer.ownerPostStartDirectionDistance <= 0.15;

    console.log(JSON.stringify(summary, null, 2));

    if (!ok) {
      await captureArtifacts(clients, options.artifactsDir);
      console.error(`复现失败或命中异常，截图已保存：${options.artifactsDir}`);
      process.exitCode = 1;
    }
  } finally {
    if (options.keepOpen) {
      console.error('已启用 --keep-open，浏览器保持打开。按 Ctrl+C 结束脚本。');
      await new Promise(() => undefined);
    }

    await Promise.all(clients.map(({ context }) => context.close()));
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
