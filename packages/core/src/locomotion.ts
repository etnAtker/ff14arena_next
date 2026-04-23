import type { Vector2 } from '@ff14arena/shared';
import { DEFAULT_PLAYER_MOVE_SPEED } from './constants';
import { add, normalize, scale } from './math';

export function normalizeMoveDirection(direction: Vector2): Vector2 {
  return normalize(direction);
}

export function movePosition(
  position: Vector2,
  direction: Vector2,
  deltaMs: number,
  speed = DEFAULT_PLAYER_MOVE_SPEED,
): Vector2 {
  return add(position, scale(direction, speed * (deltaMs / 1_000)));
}
