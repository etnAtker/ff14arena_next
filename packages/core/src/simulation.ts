import type {} from './globals';
import type {
  ActorControlFrame,
  ActorPoseSample,
  BaseActorSnapshot,
  BattleFailureMarkedEvent,
  BossCastBarState,
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
  TetherTransferredEvent,
  Vector2,
} from '@ff14arena/shared';
import {
  FIXED_TICK_MS,
  FIXED_TICK_RATE,
  DEFAULT_PLAYER_MAX_HP,
  INJURY_UP_DURATION_MS,
  INJURY_UP_MULTIPLIER,
  KNOCKBACK_IMMUNE_COOLDOWN_MS,
  KNOCKBACK_IMMUNE_DURATION_MS,
  SPRINT_COOLDOWN_MS,
  SPRINT_DURATION_MS,
} from './constants';
import { add, angleTo, distance, fromAngle, length, normalize, scale, subtract } from './math';
import {
  cloneVector,
  createMovementRuntime,
  isPointOnSegment,
  POSITION_EPSILON,
  pruneMovementRuntime,
  resetMovementRuntime as resetActorMovementRuntime,
  sameMoveState,
  segmentsIntersect,
  type ActorMovementRuntime,
} from './movement-runtime';
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

const DEFAULT_TETHER_TRANSFER_COOLDOWN_MS = 500;
const DEFAULT_BOT_TETHER_TRANSFER_COOLDOWN_MS = 0;
const BUILTIN_STATUS_NAMES: Record<string, string> = {
  injury_up: '受伤加重',
  knockback_immune: '亲疏自行',
  sprint: '冲刺',
};

interface RuntimeState {
  battle: BattleDefinition;
  roomId: string;
  deadActorsInteract: boolean;
  phase: 'waiting' | 'running';
  tick: number;
  timeMs: number;
  arenaRadius: number;
  bossTargetRingRadius: number;
  mapMarkers: MapMarker[];
  actors: Map<string, BaseActorSnapshot>;
  boss: BossSnapshot;
  bossCastBars: BossCastBarState[];
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

export function createSimulation(config: SimulationConfig = {}): SimulationInstance {
  const normalizedConfig = {
    tickRate: config.tickRate ?? FIXED_TICK_RATE,
    deadActorsInteract: config.deadActorsInteract ?? true,
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

  function getActivePartyActors(): BaseActorSnapshot[] {
    return [...assertState(state).actors.values()].filter((actor) => actor.mechanicActive);
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
    currentState.bossCastBars = [];
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

    if (statusId === 'sprint') {
      target.sprintCooldown.readyAt = currentState.timeMs + SPRINT_COOLDOWN_MS;
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
    actor.mechanicActive = currentState.deadActorsInteract;
    actor.currentHp = 0;
    actor.deathReason = reason;

    if (!actor.mechanicActive) {
      actor.moveState = {
        direction: { x: 0, y: 0 },
        moving: false,
      };
      resetMovementRuntime(actor, currentState.timeMs);
    }

    emit({
      type: 'actorDied',
      payload: {
        actorId: actor.id,
        actorName: actor.name,
        deathReason: reason,
        mechanicActive: actor.mechanicActive,
      },
    });

    const failureReason = isOutOfBounds
      ? currentState.battle.failureTexts.outOfBounds(actor.name)
      : currentState.battle.failureTexts.mechanicDeath(actor.name, reason);

    setFailure(failureReason);
  }

  function applyDamage(target: BaseActorSnapshot, amount: number, sourceLabel: string): void {
    if (!target.mechanicActive) {
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

    if (target.alive && target.currentHp <= 0) {
      markActorDeath(target, sourceLabel, false);
    }
  }

  function resolveCircle(mechanic: Extract<MechanicSnapshot, { kind: 'circle' }>): void {
    const currentState = assertState(state);

    for (const actor of currentState.actors.values()) {
      if (!actor.mechanicActive) {
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
      if (!actor.mechanicActive) {
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

    if (target === undefined || !target.mechanicActive) {
      return;
    }

    mechanic.center = cloneVector(target.position);
    const hits = [...currentState.actors.values()].filter(
      (actor) =>
        actor.mechanicActive && distance(actor.position, target.position) <= mechanic.radius,
    );

    if (hits.length === 0) {
      return;
    }

    const damagePerHit = Math.round(mechanic.totalDamage / hits.length);

    for (const actor of hits) {
      applyDamage(actor, damagePerHit, mechanic.label);
    }

    for (const actor of hits.filter((actor) => actor.mechanicActive)) {
      applyStatus(actor, 'injury_up', INJURY_UP_DURATION_MS, INJURY_UP_MULTIPLIER);
    }
  }

  function resolveSpread(mechanic: Extract<MechanicSnapshot, { kind: 'spread' }>): void {
    const currentState = assertState(state);
    const target = currentState.actors.get(mechanic.targetId);

    if (target === undefined || !target.mechanicActive) {
      return;
    }

    mechanic.center = cloneVector(target.position);
    const hits = [...currentState.actors.values()].filter(
      (actor) =>
        actor.mechanicActive && distance(actor.position, target.position) <= mechanic.radius,
    );

    for (const actor of hits) {
      applyDamage(actor, mechanic.damage, mechanic.label);
    }

    for (const actor of hits.filter((actor) => actor.mechanicActive)) {
      applyStatus(actor, 'injury_up', INJURY_UP_DURATION_MS, INJURY_UP_MULTIPLIER);
    }
  }

  function resolveMechanic(mechanicId: string): void {
    const currentState = assertState(state);
    const mechanic = currentState.mechanics.get(mechanicId);

    if (mechanic === undefined) {
      return;
    }

    if (currentState.timeMs + 0.0001 < mechanic.resolveAt) {
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
      case 'actorMarker':
      case 'fanTelegraph':
      case 'rectangleTelegraph':
      case 'fieldMarker':
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

    if (!actor.mechanicActive) {
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

      if (target === undefined || !target.mechanicActive) {
        continue;
      }

      if (target.knockbackImmune) {
        continue;
      }

      if (target.kind === 'player') {
        emit({
          type: 'actorForcedMovementRequested',
          payload: {
            actorId: target.id,
            kind: 'knockback',
            source: cloneVector(source),
            distance: knockbackDistance,
          },
        });
      } else {
        const direction = normalize(subtract(target.position, source));
        target.position = add(target.position, scale(direction, knockbackDistance));
        resetMovementRuntime(target, currentState.timeMs);
        emitActorMoved(target);
        checkOutOfBounds(target);
      }
    }
  }

  function resetMovementRuntime(actor: BaseActorSnapshot, currentTimeMs: number): void {
    const runtime = getMovementRuntime(actor.id);
    resetActorMovementRuntime(runtime, actor, currentTimeMs);
  }

  function emitActorMoved(actor: BaseActorSnapshot): void {
    emit({
      type: 'actorMoved',
      payload: {
        actorId: actor.id,
        position: cloneVector(actor.position),
        facing: actor.facing,
      },
    });
  }

  function applyActorPoseSample(sample: ActorPoseSample): void {
    const currentState = assertState(state);
    const actor = currentState.actors.get(sample.actorId);

    if (actor === undefined || !actor.mechanicActive) {
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

    const moved =
      distance(previousPosition, actor.position) > POSITION_EPSILON ||
      Math.abs(previousFacing - actor.facing) > POSITION_EPSILON ||
      !sameMoveState(previousMoveState, actor.moveState);

    if (moved) {
      emitActorMoved(actor);
    }
  }

  function applyControlFrame(frame: ActorControlFrame): void {
    const currentState = assertState(state);
    const actor = currentState.actors.get(frame.actorId);

    if (frame.pose !== undefined) {
      applyActorPoseSample({
        actorId: frame.actorId,
        issuedAt: frame.issuedAt,
        position: frame.pose.position,
        facing: frame.pose.facing,
        moveState: frame.pose.moveState,
      });
    }

    if (actor === undefined || !actor.mechanicActive || frame.commands === undefined) {
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

          applyStatus(actor, 'knockback_immune', KNOCKBACK_IMMUNE_DURATION_MS);
          break;
        case 'use-sprint':
          if (
            actor.statuses.some((status) => status.id === 'sprint') ||
            actor.sprintCooldown.readyAt > currentState.timeMs
          ) {
            continue;
          }

          applyStatus(actor, 'sprint', SPRINT_DURATION_MS);
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

    function transferTetherTarget(
      mechanic: Extract<MechanicSnapshot, { kind: 'tether' }>,
      nextTarget: BaseActorSnapshot,
    ): void {
      const previousTargetId = mechanic.targetId;
      mechanic.targetId = nextTarget.id;

      emit<TetherTransferredEvent>({
        type: 'tetherTransferred',
        payload: {
          mechanicId: mechanic.id,
          previousTargetId,
          targetId: nextTarget.id,
        },
      });
    }

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

      const sourcePosition =
        mechanic.sourcePosition ??
        (mechanic.sourceId === currentState.boss.id
          ? currentState.boss.position
          : currentState.actors.get(mechanic.sourceId)?.position);
      let target = currentState.actors.get(mechanic.targetId);

      if (sourcePosition === undefined || target === undefined) {
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

      if (!target.mechanicActive && mechanic.allowDeadRetarget) {
        const currentTargetId = target.id;
        const fallback = [...currentState.actors.values()].filter(
          (actor) =>
            actor.mechanicActive &&
            !heldTargetIds.has(actor.id) &&
            canTransferToActor(mechanic, actor, currentTargetId),
        )[0];

        if (fallback === undefined) {
          continue;
        }

        transferTetherTarget(mechanic, fallback);
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

      if (!target.mechanicActive) {
        continue;
      }

      const nextTarget = [...currentState.actors.values()]
        .filter(
          (actor) =>
            actor.mechanicActive &&
            actor.id !== target.id &&
            !heldTargetIds.has(actor.id) &&
            canTransferToActor(mechanic, actor, target.id),
        )
        .map((actor) => {
          const previousPosition = previousActorPositions.get(actor.id) ?? actor.position;

          return {
            actor,
            crossing:
              isPointOnSegment(actor.position, sourcePosition, target.position) ||
              segmentsIntersect(previousPosition, actor.position, sourcePosition, target.position),
          };
        })
        .filter((entry) => entry.crossing)
        .sort((left, right) => {
          return (left.actor.slot ?? '').localeCompare(right.actor.slot ?? '');
        })[0]?.actor;

      if (nextTarget === undefined) {
        continue;
      }

      transferTetherTarget(mechanic, nextTarget);
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
          const castBar = {
            actionId,
            actionName,
            startedAt: currentState.timeMs,
            totalDurationMs,
          };
          currentState.boss.castBar = castBar;
          currentState.bossCastBars = [
            ...currentState.bossCastBars.filter((cast) => cast.actionId !== actionId),
            castBar,
          ];

          emit<BossCastStartedEvent>({
            type: 'bossCastStarted',
            payload: castBar,
          });

          queueScheduler(currentState.timeMs + totalDurationMs, () => {
            const latestState = assertState(state);

            if (!latestState.bossCastBars.some((cast) => cast.actionId === actionId)) {
              return;
            }

            latestState.bossCastBars = latestState.bossCastBars.filter(
              (cast) => cast.actionId !== actionId,
            );
            latestState.boss.castBar = latestState.bossCastBars.at(-1) ?? null;
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
          currentState.bossCastBars = currentState.bossCastBars.filter(
            (cast) => cast.actionId !== currentCast.actionId,
          );
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
        activePlayers() {
          return getActivePartyActors().map((actor) => structuredClone(actor));
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
          const actors = getActivePartyActors().filter((actor) => filter?.(actor) ?? true);
          const shuffled = [...actors].sort(() => Math.random() - 0.5);
          return shuffled.slice(0, count).map((actor) => structuredClone(actor));
        },
        nearestTo(actorId, count = 1) {
          const actor = getActor(actorId);

          if (actor === undefined) {
            return [];
          }

          return getActivePartyActors()
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

          return getActivePartyActors()
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
            ...(options.color === undefined ? {} : { color: options.color }),
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
            ...(options.color === undefined ? {} : { color: options.color }),
            resolveAt: currentState.timeMs + (options.resolveAfterMs ?? FIXED_TICK_MS),
          });
        },
        donutTelegraph(options) {
          const currentState = assertState(state);
          return spawnMechanic({
            id: nextMechanicId(),
            kind: 'donutTelegraph',
            label: options.label,
            sourceId: options.sourceId ?? currentState.boss.id,
            center: cloneVector(options.center),
            innerRadius: options.innerRadius,
            outerRadius: options.outerRadius,
            ...(options.color === undefined ? {} : { color: options.color }),
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
            ...(options.sourcePosition === undefined
              ? {}
              : { sourcePosition: cloneVector(options.sourcePosition) }),
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
        actorMarker(options) {
          const currentState = assertState(state);
          return spawnMechanic({
            id: nextMechanicId(),
            kind: 'actorMarker',
            label: options.label,
            sourceId: options.sourceId ?? currentState.boss.id,
            targetId: options.target.id,
            markerShape: options.markerShape ?? 'stackArrows',
            ...(options.color === undefined ? {} : { color: options.color }),
            resolveAt: currentState.timeMs + (options.resolveAfterMs ?? FIXED_TICK_MS),
          });
        },
        fanTelegraph(options) {
          const currentState = assertState(state);
          return spawnMechanic({
            id: nextMechanicId(),
            kind: 'fanTelegraph',
            label: options.label,
            sourceId: options.sourceId ?? currentState.boss.id,
            center: cloneVector(options.center),
            direction: options.direction,
            angle: options.angle,
            radius: options.radius,
            resolveAt: currentState.timeMs + (options.resolveAfterMs ?? FIXED_TICK_MS),
          });
        },
        rectangleTelegraph(options) {
          const currentState = assertState(state);
          return spawnMechanic({
            id: nextMechanicId(),
            kind: 'rectangleTelegraph',
            label: options.label,
            sourceId: options.sourceId ?? currentState.boss.id,
            center: cloneVector(options.center),
            direction: options.direction,
            length: options.length,
            width: options.width,
            ...(options.color === undefined ? {} : { color: options.color }),
            resolveAt: currentState.timeMs + (options.resolveAfterMs ?? FIXED_TICK_MS),
          });
        },
        fieldMarker(options) {
          const currentState = assertState(state);
          const existing =
            options.stableId === undefined
              ? undefined
              : [...currentState.mechanics.values()].find(
                  (mechanic) =>
                    mechanic.kind === 'fieldMarker' && mechanic.stableId === options.stableId,
                );

          return spawnMechanic({
            id: existing?.id ?? nextMechanicId(),
            kind: 'fieldMarker',
            label: options.label,
            sourceId: options.sourceId ?? currentState.boss.id,
            ...(options.stableId === undefined ? {} : { stableId: options.stableId }),
            center: cloneVector(options.center),
            shape: options.shape,
            radius: options.radius,
            ...(options.color === undefined ? {} : { color: options.color }),
            ...(options.targetRingRadius === undefined
              ? {}
              : { targetRingRadius: options.targetRingRadius }),
            ...(options.targetRingColor === undefined
              ? {}
              : { targetRingColor: options.targetRingColor }),
            resolveAt: currentState.timeMs + (options.resolveAfterMs ?? FIXED_TICK_MS),
          });
        },
      },
      status: {
        apply(targetIds, statusId, durationMs, options) {
          for (const targetId of targetIds) {
            const actor = getActor(targetId);

            if (actor === undefined || !actor.mechanicActive) {
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

            if (actor === undefined || !actor.mechanicActive) {
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
        setTetherBotTransferSequence(mechanicId, targets) {
          const mechanic = assertState(state).mechanics.get(mechanicId);

          if (mechanic?.kind !== 'tether') {
            return;
          }

          mechanic.botTransferSequenceIds = targets.map((target) => target.id);
        },
      },
      damage: {
        apply(targetIds, amount, sourceLabel) {
          for (const targetId of targetIds) {
            const actor = getActor(targetId);

            if (actor === undefined || !actor.mechanicActive) {
              continue;
            }

            applyDamage(actor, amount, sourceLabel);
          }
        },
        kill(targetIds, sourceLabel) {
          for (const targetId of targetIds) {
            const actor = getActor(targetId);

            if (actor === undefined || !actor.alive || !actor.mechanicActive) {
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
          const castBar = {
            actionId,
            actionName,
            startedAt: currentState.timeMs,
            totalDurationMs,
          };
          currentState.boss.castBar = castBar;
          currentState.bossCastBars = [
            ...currentState.bossCastBars.filter((cast) => cast.actionId !== actionId),
            castBar,
          ];
        },
        clearCastBar() {
          const currentState = assertState(state);
          const currentCast = currentState.boss.castBar;

          if (currentCast !== null) {
            currentState.bossCastBars = currentState.bossCastBars.filter(
              (cast) => cast.actionId !== currentCast.actionId,
            );
          }

          currentState.boss.castBar = currentState.bossCastBars.at(-1) ?? null;
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
        bossCastBars: currentState.bossCastBars.map((cast) => structuredClone(cast)),
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
      preserveActorPose = false,
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
        const shouldPreserveActorPose =
          preserveActorPose &&
          shouldResetState &&
          previousActor !== undefined &&
          !nextResetPositionActorIds.has(member.actorId);
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
                mechanicActive: true,
                statuses: [],
                knockbackImmune: false,
                knockbackImmuneCooldown: {
                  readyAt: 0,
                },
                sprintCooldown: {
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
          mechanicActive: actorBase.alive || normalizedConfig.deadActorsInteract,
          sprintCooldown: actorBase.sprintCooldown ?? {
            readyAt: 0,
          },
          online: member.online ?? member.kind === 'bot',
        };

        if (shouldPreserveActorPose) {
          actor.position = cloneVector(previousActor.position);
          actor.facing = previousActor.facing;
          actor.moveState = {
            direction: cloneVector(previousActor.moveState.direction),
            moving: previousActor.moveState.moving,
          };
        } else if (
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
          actor.mechanicActive = true;
          actor.statuses = [];
          actor.knockbackImmune = false;
          actor.knockbackImmuneCooldown = {
            readyAt: 0,
          };
          actor.sprintCooldown = {
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
        deadActorsInteract: normalizedConfig.deadActorsInteract,
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
          mechanicActive: true,
          statuses: [],
          knockbackImmune: true,
          knockbackImmuneCooldown: {
            readyAt: Number.MAX_SAFE_INTEGER,
          },
          sprintCooldown: {
            readyAt: Number.MAX_SAFE_INTEGER,
          },
          deathReason: null,
          lastDamageSource: null,
          castBar: null,
          targetRingRadius: battle.bossTargetRingRadius,
        },
        bossCastBars: [],
        mechanics: new Map(),
        tetherReadyAt: new Map(),
        botTetherReadyAt: new Map(),
        scheduler: [],
        schedulerOrder: 0,
        scriptCursorTimeMs: 0,
        scriptState:
          sourceSnapshot === null || resetAllActors
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
    failImmediately(reason) {
      const currentState = assertState(state);

      if (currentState.phase !== 'running' || currentState.latestResult !== null) {
        return;
      }

      setFailure(reason);
      setResult('failure');
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
