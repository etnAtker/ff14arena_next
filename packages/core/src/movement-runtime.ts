import type { BaseActorSnapshot, Vector2 } from '@ff14arena/shared';
import { DEFAULT_PLAYER_MOVE_SPEED } from './constants';
import { add, length, scale, subtract } from './math';

export interface MovementSegment {
  startTimeMs: number;
  direction: Vector2;
}

export interface ActorMovementRuntime {
  anchorTimeMs: number;
  anchorPosition: Vector2;
  segments: MovementSegment[];
  lastMoveInputSeq: number;
  lastFacingInputSeq: number;
}

export const MOVEMENT_HISTORY_WINDOW_MS = 1_000;
export const HARD_CORRECTION_DISTANCE = 0.9;
export const POSITION_EPSILON = 0.001;

export function cloneVector(vector: Vector2): Vector2 {
  return {
    x: vector.x,
    y: vector.y,
  };
}

export function sameDirection(left: Vector2, right: Vector2): boolean {
  return (
    Math.abs(left.x - right.x) <= POSITION_EPSILON && Math.abs(left.y - right.y) <= POSITION_EPSILON
  );
}

export function sameMoveState(
  left: BaseActorSnapshot['moveState'],
  right: BaseActorSnapshot['moveState'],
): boolean {
  return left.moving === right.moving && sameDirection(left.direction, right.direction);
}

function cross(left: Vector2, right: Vector2): number {
  return left.x * right.y - left.y * right.x;
}

export function isPointOnSegment(point: Vector2, start: Vector2, end: Vector2): boolean {
  return (
    Math.abs(cross(subtract(point, start), subtract(end, start))) <= POSITION_EPSILON &&
    point.x >= Math.min(start.x, end.x) - POSITION_EPSILON &&
    point.x <= Math.max(start.x, end.x) + POSITION_EPSILON &&
    point.y >= Math.min(start.y, end.y) - POSITION_EPSILON &&
    point.y <= Math.max(start.y, end.y) + POSITION_EPSILON
  );
}

export function segmentsIntersect(
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

export function createMovementRuntime(
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

export function pruneMovementRuntime(runtime: ActorMovementRuntime, currentTimeMs: number): void {
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

export function resetMovementRuntime(
  runtime: ActorMovementRuntime,
  actor: BaseActorSnapshot,
  currentTimeMs: number,
): void {
  runtime.anchorTimeMs = currentTimeMs;
  runtime.anchorPosition = cloneVector(actor.position);
  runtime.segments = [
    {
      startTimeMs: currentTimeMs,
      direction: cloneVector(actor.moveState.direction),
    },
  ];
}
