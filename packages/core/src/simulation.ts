import type {} from './globals';
import type {
  ActorControlFrame,
  ActorPoseSample,
  BaseActorSnapshot,
  BattleFailureMarkedEvent,
  BossCastResolvedEvent,
  BossCastStartedEvent,
  BossSnapshot,
  DamageAppliedEvent,
  EncounterCompletedEvent,
  EncounterResult,
  MapMarker,
  MechanicSnapshot,
  SimulationEvent,
  SimulationSnapshot,
  StatusAppliedEvent,
  StatusId,
  Vector2,
} from '@ff14arena/shared';
import {
  FIXED_TICK_MS,
  FIXED_TICK_RATE,
  DEFAULT_PLAYER_MAX_HP,
  DEFAULT_PLAYER_MOVE_SPEED,
  INJURY_UP_DURATION_MS,
  INJURY_UP_MULTIPLIER,
  KNOCKBACK_IMMUNE_COOLDOWN_MS,
} from './constants';
import { add, angleTo, distance, fromAngle, length, normalize, scale, subtract } from './math';
import type {
  BattleDefinition,
  BattleScriptContext,
  SimulationConfig,
  SimulationInstance,
} from './types';

interface SchedulerEntry {
  id: string;
  timeMs: number;
  order: number;
  fn: () => void;
  cancelled: boolean;
}

interface MovementSegment {
  startTimeMs: number;
  direction: Vector2;
}

interface ActorMovementRuntime {
  anchorTimeMs: number;
  anchorPosition: Vector2;
  segments: MovementSegment[];
  lastMoveInputSeq: number;
  lastFacingInputSeq: number;
}

const MOVEMENT_HISTORY_WINDOW_MS = 1_000;
const HARD_CORRECTION_DISTANCE = 0.9;
const POSITION_EPSILON = 0.001;
const DEFAULT_TETHER_TRANSFER_COOLDOWN_MS = 500;
const DEFAULT_BOT_TETHER_TRANSFER_COOLDOWN_MS = 0;
const BUILTIN_STATUS_NAMES: Record<string, string> = {
  injury_up: '受伤加重',
  knockback_immune: '防击退',
};

interface RuntimeState {
  battle: BattleDefinition;
  roomId: string;
  phase: 'waiting' | 'running';
  tick: number;
  timeMs: number;
  arenaRadius: number;
  bossTargetRingRadius: number;
  mapMarkers: MapMarker[];
  actors: Map<string, BaseActorSnapshot>;
  boss: BossSnapshot;
  mechanics: Map<string, MechanicSnapshot>;
  tetherReadyAt: Map<string, number>;
  botTetherReadyAt: Map<string, number>;
  scheduler: SchedulerEntry[];
  schedulerOrder: number;
  scriptCursorTimeMs: number;
  scriptState: Map<string, unknown>;
  inputQueue: ActorControlFrame[];
  events: SimulationEvent[];
  failureMarked: boolean;
  failureReasons: string[];
  latestResult: EncounterResult | null;
  movementRuntime: Map<string, ActorMovementRuntime>;
}

function assertState(state: RuntimeState | null): RuntimeState {
  if (state === null) {
    throw new Error('simulation has not loaded a battle');
  }

  return state;
}

function cloneVector(vector: Vector2): Vector2 {
  return {
    x: vector.x,
    y: vector.y,
  };
}

function sameDirection(left: Vector2, right: Vector2): boolean {
  return (
    Math.abs(left.x - right.x) <= POSITION_EPSILON && Math.abs(left.y - right.y) <= POSITION_EPSILON
  );
}

function sameMoveState(
  left: BaseActorSnapshot['moveState'],
  right: BaseActorSnapshot['moveState'],
): boolean {
  return left.moving === right.moving && sameDirection(left.direction, right.direction);
}

function cross(left: Vector2, right: Vector2): number {
  return left.x * right.y - left.y * right.x;
}

function isPointOnSegment(point: Vector2, start: Vector2, end: Vector2): boolean {
  return (
    Math.abs(cross(subtract(point, start), subtract(end, start))) <= POSITION_EPSILON &&
    point.x >= Math.min(start.x, end.x) - POSITION_EPSILON &&
    point.x <= Math.max(start.x, end.x) + POSITION_EPSILON &&
    point.y >= Math.min(start.y, end.y) - POSITION_EPSILON &&
    point.y <= Math.max(start.y, end.y) + POSITION_EPSILON
  );
}

function segmentsIntersect(
  firstStart: Vector2,
  firstEnd: Vector2,
  secondStart: Vector2,
  secondEnd: Vector2,
): boolean {
  const first = subtract(firstEnd, firstStart);
  const second = subtract(secondEnd, secondStart);
  const firstToSecondStart = subtract(secondStart, firstStart);
  const firstToSecondEnd = subtract(secondEnd, firstStart);
  const secondToFirstStart = subtract(firstStart, secondStart);
  const secondToFirstEnd = subtract(firstEnd, secondStart);

  const firstSideStart = cross(first, firstToSecondStart);
  const firstSideEnd = cross(first, firstToSecondEnd);
  const secondSideStart = cross(second, secondToFirstStart);
  const secondSideEnd = cross(second, secondToFirstEnd);

  if (
    Math.abs(firstSideStart) <= POSITION_EPSILON &&
    isPointOnSegment(secondStart, firstStart, firstEnd)
  ) {
    return true;
  }

  if (
    Math.abs(firstSideEnd) <= POSITION_EPSILON &&
    isPointOnSegment(secondEnd, firstStart, firstEnd)
  ) {
    return true;
  }

  if (
    Math.abs(secondSideStart) <= POSITION_EPSILON &&
    isPointOnSegment(firstStart, secondStart, secondEnd)
  ) {
    return true;
  }

  if (
    Math.abs(secondSideEnd) <= POSITION_EPSILON &&
    isPointOnSegment(firstEnd, secondStart, secondEnd)
  ) {
    return true;
  }

  return firstSideStart * firstSideEnd < 0 && secondSideStart * secondSideEnd < 0;
}

function createMovementRuntime(
  position: Vector2,
  options?: {
    timeMs?: number;
    direction?: Vector2;
  },
): ActorMovementRuntime {
  const timeMs = options?.timeMs ?? 0;
  const direction = cloneVector(options?.direction ?? { x: 0, y: 0 });

  return {
    anchorTimeMs: timeMs,
    anchorPosition: cloneVector(position),
    segments: [
      {
        startTimeMs: timeMs,
        direction,
      },
    ],
    lastMoveInputSeq: 0,
    lastFacingInputSeq: 0,
  };
}

export function createSimulation(config: SimulationConfig = {}): SimulationInstance {
  const normalizedConfig = {
    tickRate: config.tickRate ?? FIXED_TICK_RATE,
  };

  const tickMs = 1000 / normalizedConfig.tickRate;
  let running = false;
  let accumulatorMs = 0;
  let state: RuntimeState | null = null;
  let eventId = 0;
  let schedulerId = 0;
  let mechanicId = 0;

  const nextEventId = () => `evt_${++eventId}`;
  const nextSchedulerId = () => `sch_${++schedulerId}`;
  const nextMechanicId = () => `mech_${++mechanicId}`;

  function emit<T extends SimulationEvent>(event: Omit<T, 'eventId' | 'tick' | 'timeMs'>): void {
    const currentState = assertState(state);

    currentState.events.push({
      eventId: nextEventId(),
      tick: currentState.tick,
      timeMs: currentState.timeMs,
      ...event,
    } as T);
  }

  function getActor(actorId: string): BaseActorSnapshot | undefined {
    return assertState(state).actors.get(actorId);
  }

  function getMovementRuntime(actorId: string): ActorMovementRuntime {
    const runtime = assertState(state).movementRuntime.get(actorId);

    if (runtime === undefined) {
      throw new Error(`missing movement runtime for actor ${actorId}`);
    }

    return runtime;
  }

  function getAlivePartyActors(): BaseActorSnapshot[] {
    return [...assertState(state).actors.values()].filter((actor) => actor.alive);
  }

  function queueScheduler(timeMs: number, fn: () => void): void {
    const currentState = assertState(state);
    currentState.scheduler.push({
      id: nextSchedulerId(),
      timeMs,
      order: ++currentState.schedulerOrder,
      fn,
      cancelled: false,
    });
  }

  function drainDueScheduler(): void {
    const currentState = assertState(state);

    currentState.scheduler.sort((left, right) => {
      if (left.timeMs === right.timeMs) {
        return left.order - right.order;
      }

      return left.timeMs - right.timeMs;
    });

    while (
      currentState.scheduler[0] !== undefined &&
      currentState.scheduler[0].timeMs <= currentState.timeMs
    ) {
      const next = currentState.scheduler.shift();

      if (next === undefined || next.cancelled) {
        continue;
      }

      currentState.scriptCursorTimeMs = next.timeMs;
      next.fn();
      currentState.scriptCursorTimeMs = currentState.timeMs;
    }
  }

  function setFailure(reason: string): void {
    const currentState = assertState(state);

    if (currentState.failureReasons.includes(reason)) {
      return;
    }

    currentState.failureMarked = true;
    currentState.failureReasons.push(reason);
    emit<BattleFailureMarkedEvent>({
      type: 'battleFailureMarked',
      payload: {
        addedReason: reason,
        failureReasons: [...currentState.failureReasons],
      },
    });
  }

  function setResult(outcome?: 'success' | 'failure'): void {
    const currentState = assertState(state);

    if (currentState.latestResult !== null) {
      return;
    }

    currentState.phase = 'waiting';
    currentState.boss.castBar = null;
    currentState.latestResult = {
      outcome: outcome ?? (currentState.failureMarked ? 'failure' : 'success'),
      failureReasons: [...currentState.failureReasons],
    };
    running = false;

    emit<EncounterCompletedEvent>({
      type: 'encounterCompleted',
      payload: currentState.latestResult,
    });
  }

  function applyStatus(
    target: BaseActorSnapshot,
    statusId: StatusId,
    durationMs: number,
    multiplier?: number,
    name?: string,
  ): void {
    const currentState = assertState(state);
    const expiresAt = currentState.timeMs + durationMs;
    const statusIndex = target.statuses.findIndex((status) => status.id === statusId);

    const nextStatus = {
      id: statusId,
      name: name ?? BUILTIN_STATUS_NAMES[statusId] ?? statusId,
      sourceId: currentState.boss.id,
      expiresAt,
      ...(multiplier !== undefined ? { multiplier } : {}),
    };

    if (statusIndex >= 0) {
      target.statuses[statusIndex] = nextStatus;
    } else {
      target.statuses.push(nextStatus);
    }

    if (statusId === 'knockback_immune') {
      target.knockbackImmune = true;
      target.knockbackImmuneCooldown.readyAt = currentState.timeMs + KNOCKBACK_IMMUNE_COOLDOWN_MS;
    }

    emit<StatusAppliedEvent>({
      type: 'statusApplied',
      payload: {
        targetId: target.id,
        targetName: target.name,
        status: nextStatus,
      },
    });
  }

  function markActorDeath(actor: BaseActorSnapshot, reason: string, isOutOfBounds: boolean): void {
    const currentState = assertState(state);

    if (!actor.alive) {
      return;
    }

    actor.alive = false;
    actor.currentHp = Math.max(actor.currentHp, 0);
    actor.moveState = {
      direction: { x: 0, y: 0 },
      moving: false,
    };
    actor.deathReason = reason;
    resetMovementRuntime(actor, currentState.timeMs);

    emit({
      type: 'actorDied',
      payload: {
        actorId: actor.id,
        actorName: actor.name,
        deathReason: reason,
      },
    });

    const failureReason = isOutOfBounds
      ? currentState.battle.failureTexts.outOfBounds(actor.name)
      : currentState.battle.failureTexts.mechanicDeath(actor.name, reason);

    setFailure(failureReason);
  }

  function applyDamage(target: BaseActorSnapshot, amount: number, sourceLabel: string): void {
    if (!target.alive) {
      return;
    }

    const injuryUp = target.statuses.find((status) => status.id === 'injury_up');
    const actualAmount = Math.round(amount * (injuryUp?.multiplier ?? 1));
    target.currentHp = Math.max(0, target.currentHp - actualAmount);
    target.lastDamageSource = sourceLabel;

    emit<DamageAppliedEvent>({
      type: 'damageApplied',
      payload: {
        targetId: target.id,
        targetName: target.name,
        amount: actualAmount,
        remainingHp: target.currentHp,
        sourceLabel,
      },
    });

    if (target.currentHp <= 0) {
      markActorDeath(target, sourceLabel, false);
    }
  }

  function resolveCircle(mechanic: Extract<MechanicSnapshot, { kind: 'circle' }>): void {
    const currentState = assertState(state);

    for (const actor of currentState.actors.values()) {
      if (!actor.alive) {
        continue;
      }

      if (distance(actor.position, mechanic.center) <= mechanic.radius) {
        applyDamage(actor, mechanic.damage, mechanic.label);
      }
    }
  }

  function resolveDonut(mechanic: Extract<MechanicSnapshot, { kind: 'donut' }>): void {
    const currentState = assertState(state);

    for (const actor of currentState.actors.values()) {
      if (!actor.alive) {
        continue;
      }

      const hitDistance = distance(actor.position, mechanic.center);

      if (hitDistance >= mechanic.innerRadius && hitDistance <= mechanic.outerRadius) {
        applyDamage(actor, mechanic.damage, mechanic.label);
      }
    }
  }

  function resolveShare(mechanic: Extract<MechanicSnapshot, { kind: 'share' }>): void {
    const currentState = assertState(state);
    const target = currentState.actors.get(mechanic.targetId);

    if (target === undefined || !target.alive) {
      return;
    }

    mechanic.center = cloneVector(target.position);
    const hits = [...currentState.actors.values()].filter(
      (actor) => actor.alive && distance(actor.position, target.position) <= mechanic.radius,
    );

    if (hits.length === 0) {
      return;
    }

    const damagePerHit = Math.round(mechanic.totalDamage / hits.length);

    for (const actor of hits) {
      applyDamage(actor, damagePerHit, mechanic.label);
    }

    for (const actor of hits.filter((actor) => actor.alive)) {
      applyStatus(actor, 'injury_up', INJURY_UP_DURATION_MS, INJURY_UP_MULTIPLIER);
    }
  }

  function resolveSpread(mechanic: Extract<MechanicSnapshot, { kind: 'spread' }>): void {
    const currentState = assertState(state);
    const target = currentState.actors.get(mechanic.targetId);

    if (target === undefined || !target.alive) {
      return;
    }

    mechanic.center = cloneVector(target.position);
    const hits = [...currentState.actors.values()].filter(
      (actor) => actor.alive && distance(actor.position, target.position) <= mechanic.radius,
    );

    for (const actor of hits) {
      applyDamage(actor, mechanic.damage, mechanic.label);
    }

    for (const actor of hits.filter((actor) => actor.alive)) {
      applyStatus(actor, 'injury_up', INJURY_UP_DURATION_MS, INJURY_UP_MULTIPLIER);
    }
  }

  function resolveMechanic(mechanicId: string): void {
    const currentState = assertState(state);
    const mechanic = currentState.mechanics.get(mechanicId);

    if (mechanic === undefined) {
      return;
    }

    switch (mechanic.kind) {
      case 'circle':
        resolveCircle(mechanic);
        break;
      case 'donut':
        resolveDonut(mechanic);
        break;
      case 'share':
        resolveShare(mechanic);
        break;
      case 'spread':
        resolveSpread(mechanic);
        break;
      case 'circleTelegraph':
      case 'tower':
      case 'tether':
        break;
    }

    currentState.mechanics.delete(mechanicId);
    emit({
      type: 'aoeResolved',
      payload: {
        mechanicId,
      },
    });
  }

  function spawnMechanic(mechanic: MechanicSnapshot): MechanicSnapshot {
    const currentState = assertState(state);
    currentState.mechanics.set(mechanic.id, mechanic);
    emit({
      type: 'aoeSpawned',
      payload: mechanic,
    });
    queueScheduler(mechanic.resolveAt, () => resolveMechanic(mechanic.id));
    return mechanic;
  }

  function refreshStatuses(): void {
    const currentState = assertState(state);

    for (const actor of currentState.actors.values()) {
      actor.statuses = actor.statuses.filter((status) => status.expiresAt > currentState.timeMs);
      actor.knockbackImmune = actor.statuses.some((status) => status.id === 'knockback_immune');
    }
  }

  function checkOutOfBounds(actor: BaseActorSnapshot): void {
    const currentState = assertState(state);

    if (!actor.alive) {
      return;
    }

    if (length(actor.position) > currentState.arenaRadius) {
      markActorDeath(actor, '越过场地边界', true);
    }
  }

  function applyKnockback(targetIds: string[], source: Vector2, knockbackDistance: number): void {
    const currentState = assertState(state);

    for (const targetId of targetIds) {
      const target = getActor(targetId);

      if (target === undefined || !target.alive) {
        continue;
      }

      if (target.knockbackImmune) {
        continue;
      }

      const direction = normalize(subtract(target.position, source));
      target.position = add(target.position, scale(direction, knockbackDistance));
      resetMovementRuntime(target, currentState.timeMs);
      emitActorMoved(target, 'hard');
      checkOutOfBounds(target);
    }
  }

  function movePosition(position: Vector2, direction: Vector2, deltaMs: number): Vector2 {
    if (deltaMs <= 0 || length(direction) <= POSITION_EPSILON) {
      return cloneVector(position);
    }

    return add(position, scale(direction, DEFAULT_PLAYER_MOVE_SPEED * (deltaMs / 1_000)));
  }

  function getDirectionAt(runtime: ActorMovementRuntime, timeMs: number): Vector2 {
    for (let index = runtime.segments.length - 1; index >= 0; index -= 1) {
      const segment = runtime.segments[index];

      if (segment === undefined) {
        continue;
      }

      if (segment.startTimeMs <= timeMs) {
        return cloneVector(segment.direction);
      }
    }

    return cloneVector(runtime.segments[0]?.direction ?? { x: 0, y: 0 });
  }

  function evaluatePositionAt(runtime: ActorMovementRuntime, timeMs: number): Vector2 {
    if (timeMs <= runtime.anchorTimeMs) {
      return cloneVector(runtime.anchorPosition);
    }

    let position = cloneVector(runtime.anchorPosition);

    for (let index = 0; index < runtime.segments.length; index += 1) {
      const segment = runtime.segments[index];
      const nextSegment = runtime.segments[index + 1];

      if (segment === undefined) {
        continue;
      }

      const startTimeMs = Math.max(segment.startTimeMs, runtime.anchorTimeMs);

      if (startTimeMs >= timeMs) {
        break;
      }

      const endTimeMs = Math.min(nextSegment?.startTimeMs ?? timeMs, timeMs);

      if (endTimeMs <= startTimeMs) {
        continue;
      }

      position = movePosition(position, segment.direction, endTimeMs - startTimeMs);
    }

    return position;
  }

  function pruneMovementRuntime(runtime: ActorMovementRuntime, currentTimeMs: number): void {
    const pruneBeforeMs = currentTimeMs - MOVEMENT_HISTORY_WINDOW_MS;

    if (pruneBeforeMs <= runtime.anchorTimeMs) {
      return;
    }

    const nextAnchorPosition = evaluatePositionAt(runtime, pruneBeforeMs);
    const activeDirection = getDirectionAt(runtime, pruneBeforeMs);
    const remainingSegments = runtime.segments.filter(
      (segment) => segment.startTimeMs > pruneBeforeMs,
    );

    runtime.anchorTimeMs = pruneBeforeMs;
    runtime.anchorPosition = nextAnchorPosition;
    runtime.segments = [
      {
        startTimeMs: pruneBeforeMs,
        direction: activeDirection,
      },
    ];

    for (const segment of remainingSegments) {
      const lastSegment = runtime.segments[runtime.segments.length - 1];

      if (lastSegment === undefined) {
        runtime.segments.push({
          startTimeMs: segment.startTimeMs,
          direction: cloneVector(segment.direction),
        });
        continue;
      }

      if (sameDirection(lastSegment.direction, segment.direction)) {
        continue;
      }

      runtime.segments.push({
        startTimeMs: segment.startTimeMs,
        direction: cloneVector(segment.direction),
      });
    }
  }

  function resetMovementRuntime(actor: BaseActorSnapshot, currentTimeMs: number): void {
    const runtime = getMovementRuntime(actor.id);

    runtime.anchorTimeMs = currentTimeMs;
    runtime.anchorPosition = cloneVector(actor.position);
    runtime.segments = [
      {
        startTimeMs: currentTimeMs,
        direction: cloneVector(actor.moveState.direction),
      },
    ];
  }

  function emitActorMoved(actor: BaseActorSnapshot, correctionMode: 'smooth' | 'hard'): void {
    emit({
      type: 'actorMoved',
      payload: {
        actorId: actor.id,
        position: cloneVector(actor.position),
        facing: actor.facing,
        correctionMode,
      },
    });
  }

  function applyActorPoseSample(sample: ActorPoseSample): void {
    const currentState = assertState(state);
    const actor = currentState.actors.get(sample.actorId);

    if (actor === undefined || !actor.alive) {
      return;
    }

    const previousPosition = cloneVector(actor.position);
    const previousFacing = actor.facing;
    const previousMoveState = {
      direction: cloneVector(actor.moveState.direction),
      moving: actor.moveState.moving,
    };

    actor.position = cloneVector(sample.position);
    actor.facing = sample.facing;
    actor.moveState = {
      direction: cloneVector(sample.moveState.direction),
      moving: sample.moveState.moving,
    };

    resetMovementRuntime(actor, currentState.timeMs);

    if (currentState.phase === 'running') {
      checkOutOfBounds(actor);
    }

    const positionDelta = distance(previousPosition, actor.position);
    const moved =
      positionDelta > POSITION_EPSILON ||
      Math.abs(previousFacing - actor.facing) > POSITION_EPSILON ||
      !sameMoveState(previousMoveState, actor.moveState);

    if (moved) {
      emitActorMoved(actor, positionDelta >= HARD_CORRECTION_DISTANCE ? 'hard' : 'smooth');
    }
  }

  function applyControlFrame(frame: ActorControlFrame): void {
    const currentState = assertState(state);
    const actor = currentState.actors.get(frame.actorId);

    if (frame.pose !== undefined) {
      applyActorPoseSample({
        actorId: frame.actorId,
        inputSeq: frame.inputSeq,
        issuedAt: frame.issuedAt,
        position: frame.pose.position,
        facing: frame.pose.facing,
        moveState: frame.pose.moveState,
      });
    }

    if (actor === undefined || !actor.alive || frame.commands === undefined) {
      return;
    }

    for (const command of frame.commands) {
      switch (command.type) {
        case 'use-knockback-immune':
          if (
            actor.knockbackImmune ||
            actor.knockbackImmuneCooldown.readyAt > currentState.timeMs
          ) {
            continue;
          }

          applyStatus(actor, 'knockback_immune', 8_000);
          break;
      }
    }
  }

  function advanceMovement(): void {
    const currentState = assertState(state);

    for (const actor of currentState.actors.values()) {
      pruneMovementRuntime(getMovementRuntime(actor.id), currentState.timeMs);
    }
  }

  function updateTethers(previousActorPositions: Map<string, Vector2>): void {
    const currentState = assertState(state);

    function canTransferToActor(
      mechanic: Extract<MechanicSnapshot, { kind: 'tether' }>,
      actor: BaseActorSnapshot,
      currentTargetId: string,
    ): boolean {
      if (actor.kind !== 'bot' || mechanic.botTransferSequenceIds === undefined) {
        return true;
      }

      if ((currentState.botTetherReadyAt.get(mechanic.id) ?? 0) > currentState.timeMs) {
        return false;
      }

      const currentTargetIndex = mechanic.botTransferSequenceIds.indexOf(currentTargetId);

      if (currentTargetIndex < 0) {
        return false;
      }

      const nextTargetId =
        mechanic.botTransferSequenceIds[
          (currentTargetIndex + 1) % mechanic.botTransferSequenceIds.length
        ];

      return actor.id === nextTargetId;
    }

    for (const mechanic of currentState.mechanics.values()) {
      if (mechanic.kind !== 'tether') {
        continue;
      }

      if (
        !mechanic.allowTransfer ||
        (currentState.tetherReadyAt.get(mechanic.id) ?? 0) > currentState.timeMs
      ) {
        continue;
      }

      const source =
        mechanic.sourceId === currentState.boss.id
          ? currentState.boss
          : currentState.actors.get(mechanic.sourceId);
      let target = currentState.actors.get(mechanic.targetId);

      if (source === undefined || target === undefined) {
        continue;
      }

      const heldTargetIds = mechanic.preventTargetHoldingOtherTether
        ? new Set(
            [...currentState.mechanics.values()]
              .filter(
                (candidate): candidate is Extract<MechanicSnapshot, { kind: 'tether' }> =>
                  candidate.kind === 'tether' && candidate.id !== mechanic.id,
              )
              .map((candidate) => candidate.targetId),
          )
        : new Set<string>();

      if (!target.alive && mechanic.allowDeadRetarget) {
        const currentTargetId = target.id;
        const fallback = [...currentState.actors.values()].filter(
          (actor) =>
            actor.alive &&
            !heldTargetIds.has(actor.id) &&
            canTransferToActor(mechanic, actor, currentTargetId),
        )[0];

        if (fallback === undefined) {
          continue;
        }

        mechanic.targetId = fallback.id;
        target = fallback;
        if (fallback.kind === 'bot') {
          currentState.botTetherReadyAt.set(
            mechanic.id,
            currentState.timeMs + mechanic.botTransferCooldownMs,
          );
        }
        currentState.tetherReadyAt.set(
          mechanic.id,
          currentState.timeMs + mechanic.transferCooldownMs,
        );
        continue;
      }

      if (!target.alive) {
        continue;
      }

      const nextTarget = [...currentState.actors.values()]
        .filter(
          (actor) =>
            actor.alive &&
            actor.id !== target.id &&
            !heldTargetIds.has(actor.id) &&
            canTransferToActor(mechanic, actor, target.id),
        )
        .map((actor) => {
          const previousPosition = previousActorPositions.get(actor.id) ?? actor.position;

          return {
            actor,
            crossing:
              isPointOnSegment(actor.position, source.position, target.position) ||
              segmentsIntersect(previousPosition, actor.position, source.position, target.position),
          };
        })
        .filter((entry) => entry.crossing)
        .sort((left, right) => {
          return (left.actor.slot ?? '').localeCompare(right.actor.slot ?? '');
        })[0]?.actor;

      if (nextTarget === undefined) {
        continue;
      }

      mechanic.targetId = nextTarget.id;
      if (nextTarget.kind === 'bot') {
        currentState.botTetherReadyAt.set(
          mechanic.id,
          currentState.timeMs + mechanic.botTransferCooldownMs,
        );
      }
      currentState.tetherReadyAt.set(
        mechanic.id,
        currentState.timeMs + mechanic.transferCooldownMs,
      );
    }
  }

  function createScriptContext(): BattleScriptContext {
    return {
      timeline: {
        at(timeMs, fn) {
          queueScheduler(timeMs, fn);
        },
        after(delayMs, fn) {
          const currentState = assertState(state);
          queueScheduler(currentState.scriptCursorTimeMs + delayMs, fn);
        },
        every(intervalMs, fn, windowMs) {
          const currentState = assertState(state);
          const base = currentState.scriptCursorTimeMs;
          const maxTime = windowMs === undefined ? base + intervalMs : base + windowMs;

          for (let scheduled = base + intervalMs; scheduled <= maxTime; scheduled += intervalMs) {
            queueScheduler(scheduled, fn);
          }
        },
      },
      boss: {
        get id() {
          return assertState(state).boss.id;
        },
        snapshot() {
          return structuredClone(assertState(state).boss);
        },
        cast(actionId, actionName, totalDurationMs) {
          const currentState = assertState(state);
          currentState.boss.castBar = {
            actionId,
            actionName,
            startedAt: currentState.timeMs,
            totalDurationMs,
          };

          emit<BossCastStartedEvent>({
            type: 'bossCastStarted',
            payload: currentState.boss.castBar,
          });

          queueScheduler(currentState.timeMs + totalDurationMs, () => {
            const latestState = assertState(state);

            if (latestState.boss.castBar?.actionId !== actionId) {
              return;
            }

            latestState.boss.castBar = null;
            emit<BossCastResolvedEvent>({
              type: 'bossCastResolved',
              payload: {
                actionId,
                actionName,
              },
            });
          });
        },
        clearCast() {
          const currentState = assertState(state);
          const currentCast = currentState.boss.castBar;

          if (currentCast === null) {
            return;
          }

          currentState.boss.castBar = null;
          emit<BossCastResolvedEvent>({
            type: 'bossCastResolved',
            payload: {
              actionId: currentCast.actionId,
              actionName: currentCast.actionName,
            },
          });
        },
      },
      select: {
        allPlayers() {
          return [...assertState(state).actors.values()].map((actor) => structuredClone(actor));
        },
        alivePlayers() {
          return getAlivePartyActors().map((actor) => structuredClone(actor));
        },
        bySlot(slot) {
          const actor = [...assertState(state).actors.values()].find(
            (candidate) => candidate.slot === slot,
          );
          return actor === undefined ? undefined : structuredClone(actor);
        },
        randomPlayers(count, filter) {
          const actors = getAlivePartyActors().filter((actor) => filter?.(actor) ?? true);
          const shuffled = [...actors].sort(() => Math.random() - 0.5);
          return shuffled.slice(0, count).map((actor) => structuredClone(actor));
        },
        nearestTo(actorId, count = 1) {
          const actor = getActor(actorId);

          if (actor === undefined) {
            return [];
          }

          return getAlivePartyActors()
            .filter((candidate) => candidate.id !== actorId)
            .sort(
              (left, right) =>
                distance(left.position, actor.position) - distance(right.position, actor.position),
            )
            .slice(0, count)
            .map((candidate) => structuredClone(candidate));
        },
        farthestFrom(actorId, count = 1) {
          const actor = getActor(actorId);

          if (actor === undefined) {
            return [];
          }

          return getAlivePartyActors()
            .filter((candidate) => candidate.id !== actorId)
            .sort(
              (left, right) =>
                distance(right.position, actor.position) - distance(left.position, actor.position),
            )
            .slice(0, count)
            .map((candidate) => structuredClone(candidate));
        },
      },
      spawn: {
        circleAoe(options) {
          const currentState = assertState(state);
          return spawnMechanic({
            id: nextMechanicId(),
            kind: 'circle',
            label: options.label,
            sourceId: options.sourceId ?? currentState.boss.id,
            center: cloneVector(options.center ?? currentState.boss.position),
            radius: options.radius,
            damage: options.damage,
            damageType: options.damageType ?? 'avoidable',
            resolveAt: currentState.timeMs + (options.resolveAfterMs ?? FIXED_TICK_MS),
          });
        },
        donutAoe(options) {
          const currentState = assertState(state);
          return spawnMechanic({
            id: nextMechanicId(),
            kind: 'donut',
            label: options.label,
            sourceId: options.sourceId ?? currentState.boss.id,
            center: cloneVector(options.center ?? currentState.boss.position),
            innerRadius: options.innerRadius,
            outerRadius: options.outerRadius,
            damage: options.damage,
            damageType: options.damageType ?? 'avoidable',
            resolveAt: currentState.timeMs + (options.resolveAfterMs ?? FIXED_TICK_MS),
          });
        },
        shareAoe(options) {
          const currentState = assertState(state);
          return options.targets.map((target) =>
            spawnMechanic({
              id: nextMechanicId(),
              kind: 'share',
              label: options.label,
              sourceId: options.sourceId ?? currentState.boss.id,
              targetId: target.id,
              targetSlot: target.slot!,
              center: cloneVector(target.position),
              radius: options.radius,
              totalDamage: options.totalDamage,
              resolveAt: currentState.timeMs + (options.resolveAfterMs ?? FIXED_TICK_MS),
            }),
          );
        },
        spreadAoe(options) {
          const currentState = assertState(state);
          return options.targets.map((target) =>
            spawnMechanic({
              id: nextMechanicId(),
              kind: 'spread',
              label: options.label,
              sourceId: options.sourceId ?? currentState.boss.id,
              targetId: target.id,
              targetSlot: target.slot!,
              center: cloneVector(target.position),
              radius: options.radius,
              damage: options.damage,
              resolveAt: currentState.timeMs + (options.resolveAfterMs ?? FIXED_TICK_MS),
            }),
          );
        },
        tower(options) {
          const currentState = assertState(state);
          return spawnMechanic({
            id: nextMechanicId(),
            kind: 'tower',
            label: options.label,
            sourceId: options.sourceId ?? currentState.boss.id,
            center: cloneVector(options.center),
            radius: options.radius,
            resolveAt: currentState.timeMs + (options.resolveAfterMs ?? FIXED_TICK_MS),
          });
        },
        circleTelegraph(options) {
          const currentState = assertState(state);
          return spawnMechanic({
            id: nextMechanicId(),
            kind: 'circleTelegraph',
            label: options.label,
            sourceId: options.sourceId ?? currentState.boss.id,
            center: cloneVector(options.center),
            radius: options.radius,
            resolveAt: currentState.timeMs + (options.resolveAfterMs ?? FIXED_TICK_MS),
          });
        },
        tether(options) {
          const currentState = assertState(state);
          return spawnMechanic({
            id: nextMechanicId(),
            kind: 'tether',
            label: options.label,
            sourceId: options.sourceId ?? currentState.boss.id,
            targetId: options.target.id,
            ...(options.botTransferSequence === undefined
              ? {}
              : {
                  botTransferSequenceIds: options.botTransferSequence.map((target) => target.id),
                }),
            botTransferCooldownMs:
              options.botTransferCooldownMs ?? DEFAULT_BOT_TETHER_TRANSFER_COOLDOWN_MS,
            transferCooldownMs: options.transferCooldownMs ?? DEFAULT_TETHER_TRANSFER_COOLDOWN_MS,
            allowTransfer: options.allowTransfer ?? true,
            allowDeadRetarget: options.allowDeadRetarget ?? true,
            preventTargetHoldingOtherTether: options.preventTargetHoldingOtherTether ?? true,
            resolveAt: currentState.timeMs + (options.resolveAfterMs ?? FIXED_TICK_MS),
          });
        },
      },
      status: {
        apply(targetIds, statusId, durationMs, options) {
          for (const targetId of targetIds) {
            const actor = getActor(targetId);

            if (actor === undefined || !actor.alive) {
              continue;
            }

            applyStatus(actor, statusId, durationMs, options?.multiplier, options?.name);
          }
        },
        remove(targetIds, statusId) {
          for (const targetId of targetIds) {
            const actor = getActor(targetId);

            if (actor === undefined) {
              continue;
            }

            actor.statuses = actor.statuses.filter((status) => status.id !== statusId);
          }
        },
        grantKnockbackImmunity(targetIds, durationMs) {
          for (const targetId of targetIds) {
            const actor = getActor(targetId);

            if (actor === undefined || !actor.alive) {
              continue;
            }

            applyStatus(actor, 'knockback_immune', durationMs);
          }
        },
      },
      displacement: {
        knockback(targetIds, source, knockbackDistance) {
          applyKnockback(targetIds, source, knockbackDistance);
        },
      },
      mechanics: {
        all() {
          return [...assertState(state).mechanics.values()].map((mechanic) =>
            structuredClone(mechanic),
          );
        },
      },
      damage: {
        apply(targetIds, amount, sourceLabel) {
          for (const targetId of targetIds) {
            const actor = getActor(targetId);

            if (actor === undefined || !actor.alive) {
              continue;
            }

            applyDamage(actor, amount, sourceLabel);
          }
        },
        kill(targetIds, sourceLabel) {
          for (const targetId of targetIds) {
            const actor = getActor(targetId);

            if (actor === undefined || !actor.alive) {
              continue;
            }

            actor.currentHp = 0;
            actor.lastDamageSource = sourceLabel;
            markActorDeath(actor, sourceLabel, false);
          }
        },
      },
      state: {
        getBattleTime() {
          return assertState(state).timeMs;
        },
        getValue(key) {
          return assertState(state).scriptState.get(key) as never;
        },
        setValue(key, value) {
          assertState(state).scriptState.set(key, value);
        },
        fail(reason) {
          setFailure(reason);
        },
        complete(outcome) {
          setResult(outcome);
        },
      },
      ui: {
        setCastBar(actionId, actionName, totalDurationMs) {
          const currentState = assertState(state);
          currentState.boss.castBar = {
            actionId,
            actionName,
            startedAt: currentState.timeMs,
            totalDurationMs,
          };
        },
        clearCastBar() {
          const currentState = assertState(state);
          currentState.boss.castBar = null;
        },
      },
    };
  }

  function createSnapshot(): SimulationSnapshot {
    const currentState = assertState(state);

    return {
      battleId: currentState.battle.id,
      battleName: currentState.battle.name,
      roomId: currentState.roomId,
      phase: currentState.phase,
      tick: currentState.tick,
      timeMs: currentState.timeMs,
      arenaRadius: currentState.arenaRadius,
      bossTargetRingRadius: currentState.bossTargetRingRadius,
      mapMarkers: structuredClone(currentState.mapMarkers),
      actors: [...currentState.actors.values()].map((actor) => structuredClone(actor)),
      boss: structuredClone(currentState.boss),
      mechanics: [...currentState.mechanics.values()].map((mechanic) => structuredClone(mechanic)),
      hud: {
        bossCastBar:
          currentState.boss.castBar === null ? null : structuredClone(currentState.boss.castBar),
      },
      scriptState: Object.fromEntries(
        [...currentState.scriptState.entries()].map(([key, value]) => [
          key,
          structuredClone(value),
        ]),
      ),
      failureMarked: currentState.failureMarked,
      failureReasons: [...currentState.failureReasons],
      latestResult:
        currentState.latestResult === null ? null : structuredClone(currentState.latestResult),
    };
  }

  return {
    config: normalizedConfig,
    get running() {
      return running;
    },
    loadBattle({
      battle,
      roomId,
      party,
      sourceSnapshot = null,
      keepTimeMs = false,
      resetAllActors = false,
      resetStateActorIds,
      resetPositionActorIds,
      latestResult = null,
    }) {
      const actors = new Map<string, BaseActorSnapshot>();
      const movementRuntime = new Map<string, ActorMovementRuntime>();
      const previousActors = new Map(
        sourceSnapshot?.actors.map((actor) => [actor.id, actor]) ?? [],
      );
      const nextResetStateActorIds = resetStateActorIds ?? new Set<string>();
      const nextResetPositionActorIds = resetPositionActorIds ?? new Set<string>();
      const initialTimeMs = keepTimeMs ? (sourceSnapshot?.timeMs ?? 0) : 0;
      const initialTick = resetAllActors ? 0 : (sourceSnapshot?.tick ?? 0);

      for (const member of party) {
        const placement = battle.initialPartyPositions[member.slot];
        const previousActor = previousActors.get(member.actorId);
        const shouldResetState = resetAllActors || nextResetStateActorIds.has(member.actorId);
        const actorBase: BaseActorSnapshot =
          previousActor === undefined || shouldResetState
            ? {
                id: member.actorId,
                kind: member.kind,
                slot: member.slot,
                name: member.name,
                position: cloneVector(placement.position),
                facing: placement.facing,
                moveState: {
                  direction: { x: 0, y: 0 },
                  moving: false,
                },
                maxHp: DEFAULT_PLAYER_MAX_HP,
                currentHp: DEFAULT_PLAYER_MAX_HP,
                alive: true,
                statuses: [],
                knockbackImmune: false,
                knockbackImmuneCooldown: {
                  readyAt: 0,
                },
                deathReason: null,
                lastDamageSource: null,
              }
            : structuredClone(previousActor);
        const actor: BaseActorSnapshot = {
          ...actorBase,
          id: member.actorId,
          kind: member.kind,
          slot: member.slot,
          name: member.name,
          online: member.online ?? member.kind === 'bot',
          ready: member.ready ?? member.kind === 'bot',
        };

        if (
          previousActor === undefined ||
          shouldResetState ||
          nextResetPositionActorIds.has(member.actorId)
        ) {
          actor.position = cloneVector(placement.position);
          actor.facing = placement.facing;
          actor.moveState = {
            direction: { x: 0, y: 0 },
            moving: false,
          };
        }

        if (member.kind === 'bot' && shouldResetState) {
          actor.currentHp = DEFAULT_PLAYER_MAX_HP;
          actor.maxHp = DEFAULT_PLAYER_MAX_HP;
          actor.alive = true;
          actor.statuses = [];
          actor.knockbackImmune = false;
          actor.knockbackImmuneCooldown = {
            readyAt: 0,
          };
          actor.deathReason = null;
          actor.lastDamageSource = null;
        }

        actors.set(member.actorId, actor);
        movementRuntime.set(
          member.actorId,
          createMovementRuntime(actor.position, {
            timeMs: initialTimeMs,
            direction: actor.moveState.direction,
          }),
        );
      }

      state = {
        battle,
        roomId,
        phase: 'waiting',
        tick: initialTick,
        timeMs: initialTimeMs,
        arenaRadius: battle.arenaRadius,
        bossTargetRingRadius: battle.bossTargetRingRadius,
        mapMarkers: structuredClone(battle.mapMarkers ?? []),
        actors,
        boss: {
          id: 'boss',
          kind: 'boss',
          slot: null,
          name: battle.bossName,
          position: { x: 0, y: 0 },
          facing: Math.PI / 2,
          moveState: {
            direction: { x: 0, y: 0 },
            moving: false,
          },
          maxHp: 1,
          currentHp: 1,
          alive: true,
          statuses: [],
          knockbackImmune: true,
          knockbackImmuneCooldown: {
            readyAt: Number.MAX_SAFE_INTEGER,
          },
          deathReason: null,
          lastDamageSource: null,
          castBar: null,
          targetRingRadius: battle.bossTargetRingRadius,
        },
        mechanics: new Map(),
        tetherReadyAt: new Map(),
        botTetherReadyAt: new Map(),
        scheduler: [],
        schedulerOrder: 0,
        scriptCursorTimeMs: 0,
        scriptState:
          sourceSnapshot === null
            ? new Map()
            : new Map(
                Object.entries(sourceSnapshot.scriptState).map(([key, value]) => [
                  key,
                  structuredClone(value),
                ]),
              ),
        inputQueue: [],
        events: [],
        failureMarked: latestResult?.outcome === 'failure',
        failureReasons: latestResult?.failureReasons ?? [],
        latestResult,
        movementRuntime,
      };
      running = false;
      accumulatorMs = 0;
      battle.buildScript(createScriptContext());
    },
    start() {
      const currentState = assertState(state);
      currentState.phase = 'running';
      running = true;
    },
    stop() {
      running = false;
    },
    tick(deltaMs) {
      const currentState = assertState(state);

      if (currentState.phase === 'running' && !running) {
        return;
      }

      accumulatorMs += deltaMs;

      while (accumulatorMs >= tickMs && (currentState.phase !== 'running' || running)) {
        accumulatorMs -= tickMs;
        currentState.tick += 1;
        currentState.timeMs += tickMs;

        const actorPositionsBeforeTick = new Map(
          [...currentState.actors.entries()].map(([actorId, actor]) => [
            actorId,
            cloneVector(actor.position),
          ]),
        );
        const pendingInputs = [...currentState.inputQueue];
        currentState.inputQueue.length = 0;

        for (const frame of pendingInputs) {
          applyControlFrame(frame);
        }

        advanceMovement();
        updateTethers(actorPositionsBeforeTick);
        refreshStatuses();

        if (currentState.phase === 'running') {
          drainDueScheduler();

          if (currentState.latestResult !== null) {
            running = false;
            break;
          }
        }
      }
    },
    submitActorControlFrame(frame) {
      assertState(state).inputQueue.push({
        actorId: frame.actorId,
        inputSeq: frame.inputSeq,
        issuedAt: frame.issuedAt,
        ...(frame.pose === undefined
          ? {}
          : {
              pose: {
                position: cloneVector(frame.pose.position),
                facing: frame.pose.facing,
                moveState: {
                  direction: cloneVector(frame.pose.moveState.direction),
                  moving: frame.pose.moveState.moving,
                },
              },
            }),
        ...(frame.commands === undefined
          ? {}
          : {
              commands: frame.commands.map((command) => ({
                type: command.type,
                payload: structuredClone(command.payload),
              })),
            }),
      });
    },
    getSnapshot() {
      return createSnapshot();
    },
    drainEvents() {
      const currentEvents = [...assertState(state).events];
      assertState(state).events.length = 0;
      return currentEvents;
    },
  };
}

export function createFacingTowards(source: Vector2, target: Vector2): number {
  return angleTo(source, target);
}

export function createPointOnRadius(angle: number, radius: number): Vector2 {
  return fromAngle(angle, radius);
}
