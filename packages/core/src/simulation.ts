import type {} from './globals';
import type {
  BaseActorSnapshot,
  BattleFailureMarkedEvent,
  BattleMessageChangedEvent,
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

interface RuntimeState {
  battle: BattleDefinition;
  roomId: string;
  phase: 'loading' | 'running' | 'finished';
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
  result: EncounterResult | null;
  acknowledgedInputSeq: number;
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

  function setBattleMessage(message: string | null): void {
    const currentState = assertState(state);
    currentState.scriptState.set('hud:battleMessage', message);
    emit<BattleMessageChangedEvent>({
      type: 'battleMessageChanged',
      payload: {
        message,
      },
    });
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

    if (currentState.result !== null) {
      return;
    }

    currentState.phase = 'finished';
    currentState.result = {
      outcome: outcome ?? (currentState.failureMarked ? 'failure' : 'success'),
      failureReasons: [...currentState.failureReasons],
    };
    running = false;

    emit<EncounterCompletedEvent>({
      type: 'encounterCompleted',
      payload: currentState.result,
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
      checkOutOfBounds(target);
    }
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
        const direction = normalize(input.payload.direction);
        actor.moveState = {
          direction,
          moving: length(direction) > 0,
        };
        break;
      }
      case 'face':
        actor.facing = input.payload.facing;
        break;
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
      if (!actor.alive || !actor.moveState.moving) {
        continue;
      }

      const before = cloneVector(actor.position);
      const delta = scale(actor.moveState.direction, DEFAULT_PLAYER_MOVE_SPEED * (deltaMs / 1000));
      actor.position = add(actor.position, delta);
      checkOutOfBounds(actor);

      if (before.x !== actor.position.x || before.y !== actor.position.y) {
        emit({
          type: 'actorMoved',
          payload: {
            actorId: actor.id,
            position: cloneVector(actor.position),
            facing: actor.facing,
          },
        });
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
          currentState.scriptState.set('hud:bossCastBar', currentState.boss.castBar);

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
            latestState.scriptState.set('hud:bossCastBar', null);
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
          currentState.scriptState.set('hud:bossCastBar', null);
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
      ui: {
        setCastBar(actionId, actionName, totalDurationMs) {
          const currentState = assertState(state);
          currentState.boss.castBar = {
            actionId,
            actionName,
            startedAt: currentState.timeMs,
            totalDurationMs,
          };
          currentState.scriptState.set('hud:bossCastBar', currentState.boss.castBar);
        },
        clearCastBar() {
          const currentState = assertState(state);
          currentState.boss.castBar = null;
          currentState.scriptState.set('hud:bossCastBar', null);
        },
        setBattleMessage(message) {
          setBattleMessage(message);
        },
        pushHint(message) {
          assertState(state).scriptState.set('hud:centerHint', message);
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
        battleMessage:
          (currentState.scriptState.get('hud:battleMessage') as string | null | undefined) ?? null,
        recentFailureReason: [...currentState.failureReasons],
        centerHint:
          (currentState.scriptState.get('hud:centerHint') as string | null | undefined) ?? null,
        countdownText:
          (currentState.scriptState.get('hud:countdownText') as string | null | undefined) ?? null,
      },
      failureMarked: currentState.failureMarked,
      failureReasons: [...currentState.failureReasons],
      result: currentState.result === null ? null : structuredClone(currentState.result),
    };
  }

  return {
    config: normalizedConfig,
    get running() {
      return running;
    },
    loadBattle({ battle, roomId, party }) {
      const actors = new Map<string, BaseActorSnapshot>();

      for (const member of party) {
        const placement = battle.initialPartyPositions[member.slot];
        actors.set(member.actorId, {
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
        });
      }

      state = {
        battle,
        roomId,
        phase: 'loading',
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
        result: null,
        acknowledgedInputSeq: 0,
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

        if (currentState.result !== null) {
          currentState.phase = 'finished';
          running = false;
          break;
        }
      }
    },
    dispatchInput(input) {
      assertState(state).inputQueue.push(input);
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
