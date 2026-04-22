import type { Vector2 } from '@ff14arena/shared';

export function add(a: Vector2, b: Vector2): Vector2 {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
  };
}

export function subtract(a: Vector2, b: Vector2): Vector2 {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
  };
}

export function scale(vector: Vector2, factor: number): Vector2 {
  return {
    x: vector.x * factor,
    y: vector.y * factor,
  };
}

export function length(vector: Vector2): number {
  return Math.hypot(vector.x, vector.y);
}

export function distance(a: Vector2, b: Vector2): number {
  return length(subtract(a, b));
}

export function normalize(vector: Vector2): Vector2 {
  const vectorLength = length(vector);

  if (vectorLength === 0) {
    return {
      x: 0,
      y: 0,
    };
  }

  return scale(vector, 1 / vectorLength);
}

export function fromAngle(angle: number, radius = 1): Vector2 {
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

export function angleTo(source: Vector2, target: Vector2): number {
  return Math.atan2(target.y - source.y, target.x - source.x);
}

export function clampToArena(point: Vector2, radius: number): Vector2 {
  const pointLength = length(point);

  if (pointLength <= radius) {
    return point;
  }

  return scale(normalize(point), radius);
}
