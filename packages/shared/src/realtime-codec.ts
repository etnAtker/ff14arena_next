import protobuf from 'protobufjs';
import type { MapMarker, Vector2 } from './base';
import type { SimulationEvent } from './events';
import type { SimEventsPayload, SimSnapshotPayload, SimStartPayload } from './protocol';
import type {
  ActorKind,
  BaseActorSnapshot,
  BossCastBarState,
  BossSnapshot,
  ContinuousSimulationInputFrame,
  CooldownState,
  EncounterOutcome,
  EncounterResult,
  HudState,
  MechanicKind,
  MechanicSnapshot,
  MoveState,
  RingIndicatorRingSnapshot,
  SimulationSnapshot,
  StatusSnapshot,
} from './simulation';

export type RealtimeEncoding = 'json' | 'protobuf';
export type RealtimeBinaryPayload = Uint8Array | ArrayBuffer;

type ProtoRecord = Record<string, unknown>;

const root = protobuf.Root.fromJSON({
  nested: {
    ff14arena: {
      nested: {
        Vector2: {
          fields: {
            x: { type: 'double', id: 1 },
            y: { type: 'double', id: 2 },
          },
        },
        MoveState: {
          fields: {
            direction: { type: 'Vector2', id: 1 },
            moving: { type: 'bool', id: 2 },
          },
        },
        StatusSnapshot: {
          fields: {
            id: { type: 'string', id: 1 },
            name: { type: 'string', id: 2 },
            sourceId: { type: 'string', id: 3 },
            expiresAt: { type: 'double', id: 4 },
            multiplier: { type: 'double', id: 5 },
          },
        },
        CooldownState: {
          fields: {
            readyAt: { type: 'double', id: 1 },
          },
        },
        BossCastBarState: {
          fields: {
            actionId: { type: 'string', id: 1 },
            actionName: { type: 'string', id: 2 },
            startedAt: { type: 'double', id: 3 },
            totalDurationMs: { type: 'double', id: 4 },
          },
        },
        HudState: {
          fields: {
            bossCastBar: { type: 'BossCastBarState', id: 1 },
            bossCastBars: { rule: 'repeated', type: 'BossCastBarState', id: 2 },
          },
        },
        ActorSnapshot: {
          fields: {
            id: { type: 'string', id: 1 },
            kind: { type: 'string', id: 2 },
            slot: { type: 'string', id: 3 },
            name: { type: 'string', id: 4 },
            position: { type: 'Vector2', id: 5 },
            facing: { type: 'double', id: 6 },
            moveState: { type: 'MoveState', id: 7 },
            maxHp: { type: 'double', id: 8 },
            currentHp: { type: 'double', id: 9 },
            alive: { type: 'bool', id: 10 },
            mechanicActive: { type: 'bool', id: 11 },
            statuses: { rule: 'repeated', type: 'StatusSnapshot', id: 12 },
            knockbackImmune: { type: 'bool', id: 13 },
            knockbackImmuneCooldown: { type: 'CooldownState', id: 14 },
            sprintCooldown: { type: 'CooldownState', id: 15 },
            deathReason: { type: 'string', id: 16 },
            lastDamageSource: { type: 'string', id: 17 },
            online: { type: 'bool', id: 18 },
          },
        },
        BossSnapshot: {
          fields: {
            actor: { type: 'ActorSnapshot', id: 1 },
            castBar: { type: 'BossCastBarState', id: 2 },
            targetRingRadius: { type: 'double', id: 3 },
          },
        },
        MapMarker: {
          fields: {
            label: { type: 'string', id: 1 },
            shape: { type: 'string', id: 2 },
            position: { type: 'Vector2', id: 3 },
            color: { type: 'string', id: 4 },
            radius: { type: 'double', id: 5 },
            size: { type: 'double', id: 6 },
          },
        },
        RingIndicatorRingSnapshot: {
          fields: {
            radius: { type: 'double', id: 1 },
            color: { type: 'string', id: 2 },
            markerAngle: { type: 'double', id: 3 },
            markerColor: { type: 'string', id: 4 },
            markerKind: { type: 'string', id: 5 },
          },
        },
        MechanicSnapshot: {
          fields: {
            id: { type: 'string', id: 1 },
            kind: { type: 'string', id: 2 },
            label: { type: 'string', id: 3 },
            showLabel: { type: 'bool', id: 4 },
            sourceId: { type: 'string', id: 5 },
            sourcePosition: { type: 'Vector2', id: 6 },
            targetId: { type: 'string', id: 7 },
            targetSlot: { type: 'string', id: 8 },
            center: { type: 'Vector2', id: 9 },
            radius: { type: 'double', id: 10 },
            innerRadius: { type: 'double', id: 11 },
            outerRadius: { type: 'double', id: 12 },
            damage: { type: 'double', id: 13 },
            damageType: { type: 'string', id: 14 },
            totalDamage: { type: 'double', id: 15 },
            resolveAt: { type: 'double', id: 16 },
            color: { type: 'string', id: 17 },
            botTransferSequenceIds: { rule: 'repeated', type: 'string', id: 18 },
            botTransferCooldownMs: { type: 'double', id: 19 },
            transferCooldownMs: { type: 'double', id: 20 },
            allowTransfer: { type: 'bool', id: 21 },
            allowDeadRetarget: { type: 'bool', id: 22 },
            preventTargetHoldingOtherTether: { type: 'bool', id: 23 },
            rings: { rule: 'repeated', type: 'RingIndicatorRingSnapshot', id: 24 },
            direction: { type: 'double', id: 25 },
            angle: { type: 'double', id: 26 },
            length: { type: 'double', id: 27 },
            width: { type: 'double', id: 28 },
            stableId: { type: 'string', id: 29 },
            shape: { type: 'string', id: 30 },
            markerShape: { type: 'string', id: 31 },
            targetRingRadius: { type: 'double', id: 32 },
            targetRingColor: { type: 'string', id: 33 },
          },
        },
        EncounterResult: {
          fields: {
            outcome: { type: 'string', id: 1 },
            failureReasons: { rule: 'repeated', type: 'string', id: 2 },
          },
        },
        SimulationSnapshot: {
          fields: {
            battleId: { type: 'string', id: 1 },
            battleName: { type: 'string', id: 2 },
            roomId: { type: 'string', id: 3 },
            phase: { type: 'string', id: 4 },
            tick: { type: 'double', id: 5 },
            timeMs: { type: 'double', id: 6 },
            arenaRadius: { type: 'double', id: 7 },
            bossTargetRingRadius: { type: 'double', id: 8 },
            mapMarkers: { rule: 'repeated', type: 'MapMarker', id: 9 },
            actors: { rule: 'repeated', type: 'ActorSnapshot', id: 10 },
            boss: { type: 'BossSnapshot', id: 11 },
            mechanics: { rule: 'repeated', type: 'MechanicSnapshot', id: 12 },
            hud: { type: 'HudState', id: 13 },
            failureMarked: { type: 'bool', id: 14 },
            failureReasons: { rule: 'repeated', type: 'string', id: 15 },
            latestResult: { type: 'EncounterResult', id: 16 },
          },
        },
        SimStartPayload: {
          fields: {
            roomId: { type: 'string', id: 1 },
            syncId: { type: 'double', id: 2 },
            snapshot: { type: 'SimulationSnapshot', id: 3 },
          },
        },
        SimSnapshotPayload: {
          fields: {
            roomId: { type: 'string', id: 1 },
            syncId: { type: 'double', id: 2 },
            snapshot: { type: 'SimulationSnapshot', id: 3 },
            reason: { type: 'string', id: 4 },
          },
        },
        SimulationEvent: {
          fields: {
            eventId: { type: 'string', id: 1 },
            tick: { type: 'double', id: 2 },
            timeMs: { type: 'double', id: 3 },
            type: { type: 'string', id: 4 },
            actorId: { type: 'string', id: 5 },
            position: { type: 'Vector2', id: 6 },
            facing: { type: 'double', id: 7 },
            kind: { type: 'string', id: 8 },
            source: { type: 'Vector2', id: 9 },
            distance: { type: 'double', id: 10 },
            actionId: { type: 'string', id: 11 },
            actionName: { type: 'string', id: 12 },
            startedAt: { type: 'double', id: 13 },
            totalDurationMs: { type: 'double', id: 14 },
            mechanic: { type: 'MechanicSnapshot', id: 15 },
            mechanicId: { type: 'string', id: 16 },
            previousTargetId: { type: 'string', id: 17 },
            targetId: { type: 'string', id: 18 },
            targetName: { type: 'string', id: 19 },
            amount: { type: 'double', id: 20 },
            remainingHp: { type: 'double', id: 21 },
            sourceLabel: { type: 'string', id: 22 },
            status: { type: 'StatusSnapshot', id: 23 },
            actorName: { type: 'string', id: 24 },
            deathReason: { type: 'string', id: 25 },
            mechanicActive: { type: 'bool', id: 26 },
            addedReason: { type: 'string', id: 27 },
            failureReasons: { rule: 'repeated', type: 'string', id: 28 },
            outcome: { type: 'string', id: 29 },
          },
        },
        SimEventsPayload: {
          fields: {
            roomId: { type: 'string', id: 1 },
            syncId: { type: 'double', id: 2 },
            events: { rule: 'repeated', type: 'SimulationEvent', id: 3 },
          },
        },
        ContinuousInputFramePayload: {
          fields: {
            position: { type: 'Vector2', id: 1 },
            moveDirection: { type: 'Vector2', id: 2 },
            facing: { type: 'double', id: 3 },
          },
        },
        ContinuousSimulationInputFrame: {
          fields: {
            roomId: { type: 'string', id: 1 },
            syncId: { type: 'double', id: 2 },
            actorId: { type: 'string', id: 3 },
            issuedAt: { type: 'double', id: 4 },
            payload: { type: 'ContinuousInputFramePayload', id: 5 },
          },
        },
      },
    },
  },
});

const simStartPayloadType = root.lookupType('ff14arena.SimStartPayload');
const simSnapshotPayloadType = root.lookupType('ff14arena.SimSnapshotPayload');
const simEventsPayloadType = root.lookupType('ff14arena.SimEventsPayload');
const continuousInputFrameType = root.lookupType('ff14arena.ContinuousSimulationInputFrame');

function encode(type: protobuf.Type, value: unknown): Uint8Array {
  return type.encode(type.create(value as ProtoRecord)).finish();
}

function decode(type: protobuf.Type, bytes: RealtimeBinaryPayload): ProtoRecord {
  return type.toObject(type.decode(toUint8Array(bytes)), {
    arrays: true,
    defaults: false,
    longs: Number,
  }) as ProtoRecord;
}

function toUint8Array(bytes: RealtimeBinaryPayload): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function vectorValue(value: unknown): Vector2 {
  const record = (value ?? {}) as ProtoRecord;
  return {
    x: numberValue(record.x),
    y: numberValue(record.y),
  };
}

function moveStateValue(value: unknown): MoveState {
  const record = (value ?? {}) as ProtoRecord;
  return {
    direction: vectorValue(record.direction),
    moving: booleanValue(record.moving),
  };
}

function cooldownValue(value: unknown): CooldownState {
  const record = (value ?? {}) as ProtoRecord;
  return {
    readyAt: numberValue(record.readyAt),
  };
}

function statusValue(value: unknown): StatusSnapshot {
  const record = (value ?? {}) as ProtoRecord;
  const status: StatusSnapshot = {
    id: String(record.id ?? ''),
    name: String(record.name ?? ''),
    sourceId: String(record.sourceId ?? ''),
    expiresAt: numberValue(record.expiresAt),
  };

  if (typeof record.multiplier === 'number') {
    status.multiplier = record.multiplier;
  }

  return status;
}

function castBarValue(value: unknown): BossCastBarState {
  const record = (value ?? {}) as ProtoRecord;
  return {
    actionId: String(record.actionId ?? ''),
    actionName: String(record.actionName ?? ''),
    startedAt: numberValue(record.startedAt),
    totalDurationMs: numberValue(record.totalDurationMs),
  };
}

function nullableCastBarValue(value: unknown): BossCastBarState | null {
  return value === undefined || value === null ? null : castBarValue(value);
}

function hudValue(value: unknown): HudState {
  const record = (value ?? {}) as ProtoRecord;
  return {
    bossCastBar: nullableCastBarValue(record.bossCastBar),
    bossCastBars: arrayValue(record.bossCastBars).map(castBarValue),
  };
}

function actorValue(value: unknown): BaseActorSnapshot {
  const record = (value ?? {}) as ProtoRecord;
  const actor: BaseActorSnapshot = {
    id: String(record.id ?? ''),
    kind: String(record.kind ?? 'player') as ActorKind,
    slot: nullableString(record.slot) as BaseActorSnapshot['slot'],
    name: String(record.name ?? ''),
    position: vectorValue(record.position),
    facing: numberValue(record.facing),
    moveState: moveStateValue(record.moveState),
    maxHp: numberValue(record.maxHp),
    currentHp: numberValue(record.currentHp),
    alive: booleanValue(record.alive),
    mechanicActive: booleanValue(record.mechanicActive),
    statuses: arrayValue(record.statuses).map(statusValue),
    knockbackImmune: booleanValue(record.knockbackImmune),
    knockbackImmuneCooldown: cooldownValue(record.knockbackImmuneCooldown),
    sprintCooldown: cooldownValue(record.sprintCooldown),
    deathReason: nullableString(record.deathReason),
    lastDamageSource: nullableString(record.lastDamageSource),
  };

  if (record.online !== undefined) {
    actor.online = booleanValue(record.online);
  }

  return actor;
}

function bossValue(value: unknown): BossSnapshot {
  const record = (value ?? {}) as ProtoRecord;
  const actor = actorValue(record.actor);

  return {
    ...actor,
    kind: 'boss',
    castBar: nullableCastBarValue(record.castBar),
    targetRingRadius: numberValue(record.targetRingRadius),
  };
}

function mapMarkerValue(value: unknown): MapMarker {
  const record = (value ?? {}) as ProtoRecord;
  const marker: MapMarker = {
    label: String(record.label ?? '') as MapMarker['label'],
    shape: String(record.shape ?? 'circle') as MapMarker['shape'],
    position: vectorValue(record.position),
    color: String(record.color ?? ''),
  };

  if (typeof record.radius === 'number') {
    marker.radius = record.radius;
  }

  if (typeof record.size === 'number') {
    marker.size = record.size;
  }

  return marker;
}

function ringValue(value: unknown): RingIndicatorRingSnapshot {
  const record = (value ?? {}) as ProtoRecord;
  return {
    radius: numberValue(record.radius),
    color: String(record.color ?? ''),
    markerAngle: numberValue(record.markerAngle),
    markerColor: String(record.markerColor ?? ''),
    markerKind: String(record.markerKind ?? 'solid') as RingIndicatorRingSnapshot['markerKind'],
  };
}

function mechanicValue(value: unknown): MechanicSnapshot {
  const record = (value ?? {}) as ProtoRecord;
  const mechanic: ProtoRecord = {
    id: String(record.id ?? ''),
    kind: String(record.kind ?? '') as MechanicKind,
    label: String(record.label ?? ''),
    sourceId: String(record.sourceId ?? ''),
    resolveAt: numberValue(record.resolveAt),
  };

  copyOptionalString(record, mechanic, 'targetId');
  copyOptionalString(record, mechanic, 'targetSlot');
  copyOptionalString(record, mechanic, 'damageType');
  copyOptionalString(record, mechanic, 'color');
  copyOptionalString(record, mechanic, 'stableId');
  copyOptionalString(record, mechanic, 'shape');
  copyOptionalString(record, mechanic, 'markerShape');
  copyOptionalString(record, mechanic, 'targetRingColor');
  copyOptionalNumber(record, mechanic, 'radius');
  copyOptionalNumber(record, mechanic, 'innerRadius');
  copyOptionalNumber(record, mechanic, 'outerRadius');
  copyOptionalNumber(record, mechanic, 'damage');
  copyOptionalNumber(record, mechanic, 'totalDamage');
  copyOptionalNumber(record, mechanic, 'botTransferCooldownMs');
  copyOptionalNumber(record, mechanic, 'transferCooldownMs');
  copyOptionalNumber(record, mechanic, 'direction');
  copyOptionalNumber(record, mechanic, 'angle');
  copyOptionalNumber(record, mechanic, 'length');
  copyOptionalNumber(record, mechanic, 'width');
  copyOptionalNumber(record, mechanic, 'targetRingRadius');
  copyOptionalBoolean(record, mechanic, 'showLabel');
  copyOptionalBoolean(record, mechanic, 'allowTransfer');
  copyOptionalBoolean(record, mechanic, 'allowDeadRetarget');
  copyOptionalBoolean(record, mechanic, 'preventTargetHoldingOtherTether');

  if (record.center !== undefined) {
    mechanic.center = vectorValue(record.center);
  }

  if (record.sourcePosition !== undefined) {
    mechanic.sourcePosition = vectorValue(record.sourcePosition);
  }

  const botTransferSequenceIds = arrayValue(record.botTransferSequenceIds).map(String);
  if (botTransferSequenceIds.length > 0) {
    mechanic.botTransferSequenceIds = botTransferSequenceIds;
  }

  const rings = arrayValue(record.rings).map(ringValue);
  if (rings.length > 0) {
    mechanic.rings = rings;
  }

  return mechanic as unknown as MechanicSnapshot;
}

function encounterResultValue(value: unknown): EncounterResult {
  const record = (value ?? {}) as ProtoRecord;
  return {
    outcome: String(record.outcome ?? 'failure') as EncounterOutcome,
    failureReasons: arrayValue(record.failureReasons).map(String),
  };
}

function nullableEncounterResultValue(value: unknown): EncounterResult | null {
  return value === undefined || value === null ? null : encounterResultValue(value);
}

function snapshotValue(value: unknown): SimulationSnapshot {
  const record = (value ?? {}) as ProtoRecord;
  return {
    battleId: String(record.battleId ?? ''),
    battleName: String(record.battleName ?? ''),
    roomId: String(record.roomId ?? ''),
    phase: String(record.phase ?? 'waiting') as SimulationSnapshot['phase'],
    tick: numberValue(record.tick),
    timeMs: numberValue(record.timeMs),
    arenaRadius: numberValue(record.arenaRadius),
    bossTargetRingRadius: numberValue(record.bossTargetRingRadius),
    mapMarkers: arrayValue(record.mapMarkers).map(mapMarkerValue),
    actors: arrayValue(record.actors).map(actorValue),
    boss: bossValue(record.boss),
    mechanics: arrayValue(record.mechanics).map(mechanicValue),
    hud: hudValue(record.hud),
    scriptState: {},
    failureMarked: booleanValue(record.failureMarked),
    failureReasons: arrayValue(record.failureReasons).map(String),
    latestResult: nullableEncounterResultValue(record.latestResult),
  };
}

function eventToProto(event: SimulationEvent): ProtoRecord {
  const proto: ProtoRecord = {
    eventId: event.eventId,
    tick: event.tick,
    timeMs: event.timeMs,
    type: event.type,
  };

  switch (event.type) {
    case 'actorMoved':
      return {
        ...proto,
        actorId: event.payload.actorId,
        position: event.payload.position,
        facing: event.payload.facing,
      };
    case 'actorForcedMovementRequested':
      return {
        ...proto,
        actorId: event.payload.actorId,
        kind: event.payload.kind,
        source: event.payload.source,
        distance: event.payload.distance,
      };
    case 'bossCastStarted':
      return {
        ...proto,
        actionId: event.payload.actionId,
        actionName: event.payload.actionName,
        startedAt: event.payload.startedAt,
        totalDurationMs: event.payload.totalDurationMs,
      };
    case 'bossCastResolved':
      return {
        ...proto,
        actionId: event.payload.actionId,
        actionName: event.payload.actionName,
      };
    case 'aoeSpawned':
      return {
        ...proto,
        mechanic: event.payload,
      };
    case 'aoeResolved':
      return {
        ...proto,
        mechanicId: event.payload.mechanicId,
      };
    case 'tetherTransferred':
      return {
        ...proto,
        mechanicId: event.payload.mechanicId,
        previousTargetId: event.payload.previousTargetId,
        targetId: event.payload.targetId,
      };
    case 'damageApplied':
      return {
        ...proto,
        targetId: event.payload.targetId,
        targetName: event.payload.targetName,
        amount: event.payload.amount,
        remainingHp: event.payload.remainingHp,
        sourceLabel: event.payload.sourceLabel,
      };
    case 'statusApplied':
      return {
        ...proto,
        targetId: event.payload.targetId,
        targetName: event.payload.targetName,
        status: event.payload.status,
      };
    case 'actorDied':
      return {
        ...proto,
        actorId: event.payload.actorId,
        actorName: event.payload.actorName,
        deathReason: event.payload.deathReason,
        mechanicActive: event.payload.mechanicActive,
      };
    case 'battleFailureMarked':
      return {
        ...proto,
        addedReason: event.payload.addedReason,
        failureReasons: event.payload.failureReasons,
      };
    case 'encounterCompleted':
      return {
        ...proto,
        outcome: event.payload.outcome,
        failureReasons: event.payload.failureReasons,
      };
  }
}

function eventValue(value: unknown): SimulationEvent {
  const record = (value ?? {}) as ProtoRecord;
  const base = {
    eventId: String(record.eventId ?? ''),
    tick: numberValue(record.tick),
    timeMs: numberValue(record.timeMs),
  };
  const type = String(record.type ?? '') as SimulationEvent['type'];

  switch (type) {
    case 'actorMoved':
      return {
        ...base,
        type,
        payload: {
          actorId: String(record.actorId ?? ''),
          position: vectorValue(record.position),
          facing: numberValue(record.facing),
        },
      };
    case 'actorForcedMovementRequested':
      return {
        ...base,
        type,
        payload: {
          actorId: String(record.actorId ?? ''),
          kind: String(record.kind ?? 'knockback') as 'knockback',
          source: vectorValue(record.source),
          distance: numberValue(record.distance),
        },
      };
    case 'bossCastStarted':
      return {
        ...base,
        type,
        payload: {
          actionId: String(record.actionId ?? ''),
          actionName: String(record.actionName ?? ''),
          startedAt: numberValue(record.startedAt),
          totalDurationMs: numberValue(record.totalDurationMs),
        },
      };
    case 'bossCastResolved':
      return {
        ...base,
        type,
        payload: {
          actionId: String(record.actionId ?? ''),
          actionName: String(record.actionName ?? ''),
        },
      };
    case 'aoeSpawned':
      return {
        ...base,
        type,
        payload: mechanicValue(record.mechanic),
      };
    case 'aoeResolved':
      return {
        ...base,
        type,
        payload: {
          mechanicId: String(record.mechanicId ?? ''),
        },
      };
    case 'tetherTransferred':
      return {
        ...base,
        type,
        payload: {
          mechanicId: String(record.mechanicId ?? ''),
          previousTargetId: String(record.previousTargetId ?? ''),
          targetId: String(record.targetId ?? ''),
        },
      };
    case 'damageApplied':
      return {
        ...base,
        type,
        payload: {
          targetId: String(record.targetId ?? ''),
          targetName: String(record.targetName ?? ''),
          amount: numberValue(record.amount),
          remainingHp: numberValue(record.remainingHp),
          sourceLabel: String(record.sourceLabel ?? ''),
        },
      };
    case 'statusApplied':
      return {
        ...base,
        type,
        payload: {
          targetId: String(record.targetId ?? ''),
          targetName: String(record.targetName ?? ''),
          status: statusValue(record.status),
        },
      };
    case 'actorDied':
      return {
        ...base,
        type,
        payload: {
          actorId: String(record.actorId ?? ''),
          actorName: String(record.actorName ?? ''),
          deathReason: String(record.deathReason ?? ''),
          mechanicActive: booleanValue(record.mechanicActive),
        },
      };
    case 'battleFailureMarked':
      return {
        ...base,
        type,
        payload: {
          addedReason: String(record.addedReason ?? ''),
          failureReasons: arrayValue(record.failureReasons).map(String),
        },
      };
    case 'encounterCompleted':
      return {
        ...base,
        type,
        payload: {
          outcome: String(record.outcome ?? 'failure') as EncounterOutcome,
          failureReasons: arrayValue(record.failureReasons).map(String),
        },
      };
    default:
      throw new Error(`未知模拟事件类型：${type}`);
  }
}

function inputFrameValue(value: unknown): ContinuousSimulationInputFrame {
  const record = (value ?? {}) as ProtoRecord;
  const payload = (record.payload ?? {}) as ProtoRecord;

  return {
    roomId: String(record.roomId ?? ''),
    syncId: numberValue(record.syncId),
    actorId: String(record.actorId ?? ''),
    issuedAt: numberValue(record.issuedAt),
    payload: {
      position: vectorValue(payload.position),
      moveDirection: vectorValue(payload.moveDirection),
      facing: numberValue(payload.facing),
    },
  };
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function copyOptionalString(source: ProtoRecord, target: ProtoRecord, key: string): void {
  const value = optionalString(source[key]);

  if (value !== undefined) {
    target[key] = value;
  }
}

function copyOptionalNumber(source: ProtoRecord, target: ProtoRecord, key: string): void {
  const value = source[key];

  if (typeof value === 'number') {
    target[key] = value;
  }
}

function copyOptionalBoolean(source: ProtoRecord, target: ProtoRecord, key: string): void {
  const value = source[key];

  if (typeof value === 'boolean') {
    target[key] = value;
  }
}

function snapshotToProto(snapshot: SimulationSnapshot): ProtoRecord {
  return {
    ...snapshot,
    boss: {
      actor: snapshot.boss,
      castBar: snapshot.boss.castBar ?? undefined,
      targetRingRadius: snapshot.boss.targetRingRadius,
    },
    hud: {
      bossCastBar: snapshot.hud.bossCastBar ?? undefined,
      bossCastBars: snapshot.hud.bossCastBars,
    },
    latestResult: snapshot.latestResult ?? undefined,
  };
}

export function encodeSimStartPayload(payload: SimStartPayload): Uint8Array {
  return encode(simStartPayloadType, {
    roomId: payload.roomId,
    syncId: payload.syncId,
    snapshot: snapshotToProto(payload.snapshot),
  });
}

export function decodeSimStartPayload(bytes: RealtimeBinaryPayload): SimStartPayload {
  const payload = decode(simStartPayloadType, bytes);
  return {
    roomId: String(payload.roomId ?? ''),
    syncId: numberValue(payload.syncId),
    snapshot: snapshotValue(payload.snapshot),
  };
}

export function encodeSimSnapshotPayload(payload: SimSnapshotPayload): Uint8Array {
  return encode(simSnapshotPayloadType, {
    roomId: payload.roomId,
    syncId: payload.syncId,
    snapshot: snapshotToProto(payload.snapshot),
    reason: payload.reason,
  });
}

export function decodeSimSnapshotPayload(bytes: RealtimeBinaryPayload): SimSnapshotPayload {
  const payload = decode(simSnapshotPayloadType, bytes);
  return {
    roomId: String(payload.roomId ?? ''),
    syncId: numberValue(payload.syncId),
    snapshot: snapshotValue(payload.snapshot),
    reason: String(payload.reason ?? 'tick') as SimSnapshotPayload['reason'],
  };
}

export function encodeSimEventsPayload(payload: SimEventsPayload): Uint8Array {
  return encode(simEventsPayloadType, {
    roomId: payload.roomId,
    syncId: payload.syncId,
    events: payload.events.map(eventToProto),
  });
}

export function decodeSimEventsPayload(bytes: RealtimeBinaryPayload): SimEventsPayload {
  const payload = decode(simEventsPayloadType, bytes);
  return {
    roomId: String(payload.roomId ?? ''),
    syncId: numberValue(payload.syncId),
    events: arrayValue(payload.events).map(eventValue),
  };
}

export function encodeContinuousInputFrame(payload: ContinuousSimulationInputFrame): Uint8Array {
  return encode(continuousInputFrameType, payload);
}

export function decodeContinuousInputFrame(
  bytes: RealtimeBinaryPayload,
): ContinuousSimulationInputFrame {
  return inputFrameValue(decode(continuousInputFrameType, bytes));
}
