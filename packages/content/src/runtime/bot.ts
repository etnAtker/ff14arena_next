import type {
  ActorControlCommand,
  ActorControlPose,
  BaseActorSnapshot,
  PartySlot,
  SimulationSnapshot,
  Vector2,
} from '@ff14arena/shared';
import {
  FIXED_TICK_MS,
  getActorMoveSpeed,
  movePosition,
  normalizeMoveDirection,
} from '@ff14arena/core';

export interface BattleBotControllerContext {
  snapshot: SimulationSnapshot;
  slot: PartySlot;
  actor: BaseActorSnapshot;
}

export interface BattleBotControlFrame {
  pose?: ActorControlPose;
  commands?: ActorControlCommand[];
}

export type BattleBotController = (context: BattleBotControllerContext) => BattleBotControlFrame;

export function createMoveDirection(
  current: Vector2,
  target: Vector2,
  stopDistance = 0.35,
): Vector2 {
  const delta = {
    x: target.x - current.x,
    y: target.y - current.y,
  };

  if (Math.hypot(delta.x, delta.y) <= stopDistance) {
    return {
      x: 0,
      y: 0,
    };
  }

  return delta;
}

export function createPose(
  actor: BaseActorSnapshot,
  moveDirection: Vector2,
  facing: number,
): ActorControlPose {
  const direction = normalizeMoveDirection(moveDirection);

  return {
    position: movePosition(actor.position, direction, FIXED_TICK_MS, getActorMoveSpeed(actor)),
    facing,
    moveState: {
      direction,
      moving: Math.hypot(direction.x, direction.y) > 0,
    },
  };
}

export function createPoseTowards(
  actor: BaseActorSnapshot,
  target: Vector2,
  facing: number,
): ActorControlPose {
  const delta = {
    x: target.x - actor.position.x,
    y: target.y - actor.position.y,
  };
  const distanceToTarget = Math.hypot(delta.x, delta.y);
  const stepDistance = getActorMoveSpeed(actor) * (FIXED_TICK_MS / 1_000);

  if (distanceToTarget <= stepDistance) {
    return {
      position: target,
      facing,
      moveState: {
        direction: { x: 0, y: 0 },
        moving: false,
      },
    };
  }

  return createPose(actor, delta, facing);
}
