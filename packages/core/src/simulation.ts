import type {} from './globals';
import type {
  BaseActorSnapshot,
  BattleFailureMarkedEvent,
  BossCastResolvedEvent,
  BossCastStartedEvent,
  BossSnapshot,
  DamageAppliedEvent,
  EncounterCompletedEvent,
  EncounterResult,
  MechanicSnapshot,
  SimulationEvent,
  SimulationInput,
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
const MAX_MOVEMENT_COMPENSATION_MS = 120;
const HARD_CORRECTION_DISTANCE = 0.9;
const POSITION_EPSILON = 1e-6;

interface RuntimeState {
  battle: BattleDefinition;
  roomId: string;
  phase: 'waiting' | 'running';
  tick: number;
  timeMs: number;
  arenaRadius: number;
  bossTargetRingRadius: number;
  actors: Map<string, BaseActorSnapshot>;
  boss: BossSnapshot;
  mechanics: Map<string, MechanicSnapshot>;
  scheduler: SchedulerEntry[];
  schedulerOrder: number;
  scriptCursorTimeMs: number;
  scriptState: Map<string, unknown>;
  inputQueue: SimulationInput[];
  events: SimulationEvent[];
  failureMarked: boolean;
  failureReasons: string[];
  latestResult: EncounterResult | null;
  acknowledgedInputSeq: number;
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

function createMovementRuntime(position: Vector2): ActorMovementRuntime {
  return {
    anchorTimeMs: 0,
    anchorPosition: cloneVector(position),
    segments: [
      {
        startTimeMs: 0,
        direction: { x: 0, y: 0 },
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
  ): void {
    const currentState = assertState(state);
    const expiresAt = currentState.timeMs + durationMs;
    const statusIndex = target.statuses.findIndex((status) => status.id === statusId);
    const name = statusId === 'injury_up' ? '受伤加重' : '防击退';

    const nextStatus = {
      id: statusId,
      name,
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

  function applyInput(input: SimulationInput): void {
    const currentState = assertState(state);
    const actor = currentState.actors.get(input.actorId);

    currentState.acknowledgedInputSeq = Math.max(currentState.acknowledgedInputSeq, input.inputSeq);

    if (actor === undefined || !actor.alive) {
      return;
    }

    switch (input.type) {
      case 'move': {
        const runtime = getMovementRuntime(actor.id);

        if (input.inputSeq <= runtime.lastMoveInputSeq) {
          break;
        }

        runtime.lastMoveInputSeq = input.inputSeq;
        pruneMovementRuntime(runtime, currentState.timeMs);

        const direction = normalize(input.payload.direction);
        const previousPosition = cloneVector(actor.position);
        const previousDirection = cloneVector(actor.moveState.direction);
        const replayTargetTimeMs =
          currentState.phase === 'running'
            ? Math.max(currentState.timeMs - tickMs, 0)
            : currentState.timeMs;
        const earliestCompensationTimeMs = Math.max(
          runtime.anchorTimeMs,
          currentState.timeMs - MAX_MOVEMENT_COMPENSATION_MS,
        );
        const estimatedTimeMs =
          input.issuedAtServerTimeEstimate === undefined
            ? currentState.timeMs
            : input.issuedAtServerTimeEstimate;
        const effectiveTimeMs = Math.max(
          runtime.segments[runtime.segments.length - 1]?.startTimeMs ?? earliestCompensationTimeMs,
          Math.min(currentState.timeMs, Math.max(earliestCompensationTimeMs, estimatedTimeMs)),
        );

        const lastSegment = runtime.segments[runtime.segments.length - 1];

        if (lastSegment === undefined) {
          runtime.segments.push({
            startTimeMs: effectiveTimeMs,
            direction: cloneVector(direction),
          });
          break;
        }

        if (!sameDirection(lastSegment.direction, direction)) {
          if (Math.abs(effectiveTimeMs - lastSegment.startTimeMs) <= POSITION_EPSILON) {
            lastSegment.direction = cloneVector(direction);
          } else {
            runtime.segments.push({
              startTimeMs: effectiveTimeMs,
              direction: cloneVector(direction),
            });
          }
        }

        actor.moveState = {
          direction,
          moving: length(direction) > 0,
        };

        const idealPosition = evaluatePositionAt(runtime, replayTargetTimeMs);
        const error = distance(previousPosition, idealPosition);

        actor.position = idealPosition;

        if (
          error > POSITION_EPSILON ||
          !sameDirection(previousDirection, actor.moveState.direction)
        ) {
          emitActorMoved(actor, error >= HARD_CORRECTION_DISTANCE ? 'hard' : 'smooth');
        }
        break;
      }
      case 'face': {
        const runtime = getMovementRuntime(actor.id);

        if (input.inputSeq <= runtime.lastFacingInputSeq) {
          break;
        }

        runtime.lastFacingInputSeq = input.inputSeq;

        if (Math.abs(actor.facing - input.payload.facing) <= POSITION_EPSILON) {
          break;
        }

        actor.facing = input.payload.facing;
        emitActorMoved(actor, 'smooth');
        break;
      }
      case 'use-knockback-immune':
        if (
          actor.knockbackImmune ||
          actor.knockbackImmuneCooldown.readyAt > currentState.timeMs ||
          !actor.alive
        ) {
          return;
        }

        applyStatus(actor, 'knockback_immune', 8_000);
        break;
    }
  }

  function advanceMovement(deltaMs: number): void {
    const currentState = assertState(state);

    for (const actor of currentState.actors.values()) {
      pruneMovementRuntime(getMovementRuntime(actor.id), currentState.timeMs);

      if (!actor.alive || !actor.moveState.moving) {
        continue;
      }

      const before = cloneVector(actor.position);
      const delta = scale(actor.moveState.direction, DEFAULT_PLAYER_MOVE_SPEED * (deltaMs / 1000));
      actor.position = add(actor.position, delta);
      checkOutOfBounds(actor);

      if (before.x !== actor.position.x || before.y !== actor.position.y) {
        emitActorMoved(actor, 'smooth');
      }
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
      },
      status: {
        apply(targetIds, statusId, durationMs, options) {
          for (const targetId of targetIds) {
            const actor = getActor(targetId);

            if (actor === undefined || !actor.alive) {
              continue;
            }

            applyStatus(actor, statusId, durationMs, options?.multiplier);
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
      bot: {
        setContext(context) {
          assertState(state).scriptState.set('bot:context', context);
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
      actors: [...currentState.actors.values()].map((actor) => structuredClone(actor)),
      boss: structuredClone(currentState.boss),
      mechanics: [...currentState.mechanics.values()].map((mechanic) => structuredClone(mechanic)),
      hud: {
        bossCastBar:
          currentState.boss.castBar === null ? null : structuredClone(currentState.boss.castBar),
      },
      botContext:
        currentState.scriptState.get('bot:context') === undefined
          ? null
          : structuredClone(currentState.scriptState.get('bot:context')),
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
    loadBattle({ battle, roomId, party }) {
      const actors = new Map<string, BaseActorSnapshot>();
      const movementRuntime = new Map<string, ActorMovementRuntime>();

      for (const member of party) {
        const placement = battle.initialPartyPositions[member.slot];
        const actor = {
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
          online: member.online ?? member.kind === 'bot',
          ready: member.ready ?? member.kind === 'bot',
        } satisfies BaseActorSnapshot;
        actors.set(member.actorId, actor);
        movementRuntime.set(member.actorId, createMovementRuntime(actor.position));
      }

      state = {
        battle,
        roomId,
        phase: 'waiting',
        tick: 0,
        timeMs: 0,
        arenaRadius: battle.arenaRadius,
        bossTargetRingRadius: battle.bossTargetRingRadius,
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
        scheduler: [],
        schedulerOrder: 0,
        scriptCursorTimeMs: 0,
        scriptState: new Map(),
        inputQueue: [],
        events: [],
        failureMarked: false,
        failureReasons: [],
        latestResult: null,
        acknowledgedInputSeq: 0,
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

      if (!running || currentState.phase !== 'running') {
        return;
      }

      accumulatorMs += deltaMs;

      while (accumulatorMs >= tickMs && running) {
        accumulatorMs -= tickMs;
        currentState.tick += 1;
        currentState.timeMs += tickMs;

        const pendingInputs = [...currentState.inputQueue];
        currentState.inputQueue.length = 0;

        for (const input of pendingInputs) {
          applyInput(input);
        }

        advanceMovement(tickMs);
        drainDueScheduler();
        refreshStatuses();

        if (currentState.latestResult !== null) {
          running = false;
          break;
        }
      }
    },
    dispatchInput(input) {
      const currentState = assertState(state);

      if (currentState.phase === 'waiting') {
        applyInput(input);
        advanceMovement(FIXED_TICK_MS);
        refreshStatuses();
        return;
      }

      currentState.inputQueue.push(input);
    },
    getSnapshot() {
      return createSnapshot();
    },
    drainEvents() {
      const currentEvents = [...assertState(state).events];
      assertState(state).events.length = 0;
      return currentEvents;
    },
    getAcknowledgedInputSeq() {
      return assertState(state).acknowledgedInputSeq;
    },
  };
}

export function createFacingTowards(source: Vector2, target: Vector2): number {
  return angleTo(source, target);
}

export function createPointOnRadius(angle: number, radius: number): Vector2 {
  return fromAngle(angle, radius);
}
