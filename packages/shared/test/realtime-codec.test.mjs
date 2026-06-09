import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeSimEventsPayload,
  decodeSimSnapshotPayload,
  encodeSimEventsPayload,
  encodeSimSnapshotPayload,
} from '../src/realtime-codec.ts';

function createActor(overrides = {}) {
  return {
    id: 'actor-1',
    kind: 'player',
    slot: 'MT',
    name: '玩家',
    position: { x: 0, y: 0 },
    facing: 0,
    moveState: {
      direction: { x: 0, y: 0 },
      moving: false,
    },
    maxHp: 10000,
    currentHp: 10000,
    alive: true,
    mechanicActive: true,
    statuses: [],
    knockbackImmune: false,
    knockbackImmuneCooldown: { readyAt: 0 },
    sprintCooldown: { readyAt: 0 },
    deathReason: null,
    lastDamageSource: null,
    ...overrides,
  };
}

function createSnapshot(overrides = {}) {
  return {
    battleId: 'test-battle',
    battleName: '测试战斗',
    roomId: 'room-1',
    phase: 'running',
    tick: 1,
    timeMs: 1000,
    arenaRadius: 20,
    bossTargetRingRadius: 3,
    mapMarkers: [],
    actors: [],
    boss: {
      ...createActor({
        id: 'boss-1',
        kind: 'boss',
        slot: null,
        name: 'Boss',
      }),
      castBar: null,
      targetRingRadius: 3,
    },
    mechanics: [],
    hud: {
      bossCastBar: null,
      bossCastBars: [],
    },
    scriptState: {},
    failureMarked: false,
    failureReasons: [],
    latestResult: null,
    ...overrides,
  };
}

test('protobuf 快照保留可选标量的默认值', () => {
  const snapshot = createSnapshot({
    mapMarkers: [
      {
        label: 'A',
        shape: 'circle',
        position: { x: 0, y: 0 },
        color: '#ffffff',
        radius: 0,
        size: 0,
      },
    ],
    actors: [
      createActor({
        online: false,
        statuses: [
          {
            id: 'status-1',
            name: '状态',
            sourceId: 'boss-1',
            expiresAt: 0,
            multiplier: 0,
          },
        ],
      }),
    ],
    mechanics: [
      {
        id: 'tower-1',
        kind: 'tower',
        label: '塔',
        sourceId: 'boss-1',
        center: { x: 0, y: 0 },
        radius: 0,
        filled: false,
        resolveAt: 0,
      },
      {
        id: 'actor-marker-1',
        kind: 'actorMarker',
        label: '',
        showLabel: false,
        sourceId: 'boss-1',
        targetId: 'actor-1',
        markerShape: 'circleDot',
        radius: 0,
        resolveAt: 0,
      },
      {
        id: 'field-marker-1',
        kind: 'fieldMarker',
        label: '',
        showLabel: false,
        sourceId: 'boss-1',
        stableId: '',
        center: { x: 0, y: 0 },
        shape: 'enemy',
        radius: 0,
        direction: 0,
        targetRingRadius: 0,
        targetRingColor: '',
        resolveAt: 0,
      },
      {
        id: 'tether-1',
        kind: 'tether',
        label: '连线',
        sourceId: 'boss-1',
        sourcePosition: { x: 0, y: 0 },
        targetId: 'actor-1',
        botTransferSequenceIds: [],
        botTransferCooldownMs: 0,
        transferCooldownMs: 0,
        allowTransfer: false,
        allowDeadRetarget: false,
        preventTargetHoldingOtherTether: false,
        resolveAt: 0,
      },
    ],
  });

  const decoded = decodeSimSnapshotPayload(
    encodeSimSnapshotPayload({
      roomId: 'room-1',
      syncId: 1,
      snapshot,
      reason: 'tick',
    }),
  ).snapshot;

  assert.equal(decoded.mapMarkers[0].radius, 0);
  assert.equal(decoded.mapMarkers[0].size, 0);
  assert.equal(decoded.actors[0].online, false);
  assert.equal(decoded.actors[0].statuses[0].multiplier, 0);

  assert.equal(decoded.mechanics[0].filled, false);
  assert.equal(decoded.mechanics[0].radius, 0);
  assert.equal(decoded.mechanics[1].showLabel, false);
  assert.equal(decoded.mechanics[1].radius, 0);
  assert.equal(decoded.mechanics[2].showLabel, false);
  assert.equal(decoded.mechanics[2].stableId, '');
  assert.equal(decoded.mechanics[2].direction, 0);
  assert.equal(decoded.mechanics[2].targetRingRadius, 0);
  assert.equal(decoded.mechanics[2].targetRingColor, '');
  assert.equal(decoded.mechanics[3].botTransferCooldownMs, 0);
  assert.equal(decoded.mechanics[3].transferCooldownMs, 0);
  assert.equal(decoded.mechanics[3].allowTransfer, false);
  assert.equal(decoded.mechanics[3].allowDeadRetarget, false);
  assert.equal(decoded.mechanics[3].preventTargetHoldingOtherTether, false);
});

test('protobuf 快照不会为省略的可选字段补默认值', () => {
  const decoded = decodeSimSnapshotPayload(
    encodeSimSnapshotPayload({
      roomId: 'room-1',
      syncId: 1,
      snapshot: createSnapshot({
        actors: [
          createActor({
            statuses: [
              {
                id: 'status-1',
                name: '状态',
                sourceId: 'boss-1',
                expiresAt: 0,
              },
            ],
          }),
        ],
        mechanics: [
          {
            id: 'tower-1',
            kind: 'tower',
            label: '塔',
            sourceId: 'boss-1',
            center: { x: 0, y: 0 },
            radius: 3,
            resolveAt: 0,
          },
        ],
      }),
      reason: 'tick',
    }),
  ).snapshot;

  assert.equal(Object.hasOwn(decoded.actors[0], 'online'), false);
  assert.equal(Object.hasOwn(decoded.actors[0].statuses[0], 'multiplier'), false);
  assert.equal(Object.hasOwn(decoded.mechanics[0], 'filled'), false);
  assert.equal(Object.hasOwn(decoded.mechanics[0], 'color'), false);
});

test('protobuf 事件保留嵌套机制和状态的默认值', () => {
  const decoded = decodeSimEventsPayload(
    encodeSimEventsPayload({
      roomId: 'room-1',
      syncId: 1,
      events: [
        {
          eventId: 'event-1',
          tick: 1,
          timeMs: 1000,
          type: 'aoeSpawned',
          payload: {
            id: 'tower-1',
            kind: 'tower',
            label: '塔',
            sourceId: 'boss-1',
            center: { x: 0, y: 0 },
            radius: 0,
            filled: false,
            resolveAt: 0,
          },
        },
        {
          eventId: 'event-2',
          tick: 1,
          timeMs: 1000,
          type: 'statusApplied',
          payload: {
            targetId: 'actor-1',
            targetName: '玩家',
            status: {
              id: 'status-1',
              name: '状态',
              sourceId: 'boss-1',
              expiresAt: 0,
              multiplier: 0,
            },
          },
        },
      ],
    }),
  );

  assert.equal(decoded.events[0].payload.filled, false);
  assert.equal(decoded.events[0].payload.radius, 0);
  assert.equal(decoded.events[1].payload.status.multiplier, 0);
});
