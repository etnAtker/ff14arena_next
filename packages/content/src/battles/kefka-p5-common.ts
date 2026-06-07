import type { MapMarker, PartySlot, Vector2 } from '@ff14arena/shared';

export const KEFKA_P5_ARENA_RADIUS = 20;
export const KEFKA_P5_BOSS_TARGET_RING_RADIUS = 8;
export const KEFKA_P5_CENTER = { x: 0, y: 0 } as const satisfies Vector2;
export const KEFKA_P5_NORTH_ANGLE = -Math.PI / 2;
export const KEFKA_P5_INITIAL_RADIUS = KEFKA_P5_BOSS_TARGET_RING_RADIUS + 1;

export const KEFKA_P5_INITIAL_SLOT_ORDER = [
  'MT',
  'ST',
  'H2',
  'D2',
  'D4',
  'D1',
  'H1',
  'D3',
] as const satisfies readonly PartySlot[];

export const KEFKA_P5_MARKER_COLORS = {
  red: '#ef4444',
  yellow: '#f4d35e',
  cyan: '#7dd3fc',
  purple: '#a78bfa',
} as const;

const MARKER_CORNER_DISTANCE = 12;

export const KEFKA_P5_MAP_MARKERS: MapMarker[] = [
  {
    label: 'A',
    shape: 'circle',
    color: KEFKA_P5_MARKER_COLORS.red,
    position: { x: 0, y: -MARKER_CORNER_DISTANCE },
    radius: 1.25,
  },
  {
    label: '2',
    shape: 'square',
    color: KEFKA_P5_MARKER_COLORS.yellow,
    position: { x: MARKER_CORNER_DISTANCE, y: -MARKER_CORNER_DISTANCE },
    size: 2.2,
  },
  {
    label: 'B',
    shape: 'circle',
    color: KEFKA_P5_MARKER_COLORS.yellow,
    position: { x: MARKER_CORNER_DISTANCE, y: 0 },
    radius: 1.25,
  },
  {
    label: '3',
    shape: 'square',
    color: KEFKA_P5_MARKER_COLORS.cyan,
    position: { x: MARKER_CORNER_DISTANCE, y: MARKER_CORNER_DISTANCE },
    size: 2.2,
  },
  {
    label: 'C',
    shape: 'circle',
    color: KEFKA_P5_MARKER_COLORS.cyan,
    position: { x: 0, y: MARKER_CORNER_DISTANCE },
    radius: 1.25,
  },
  {
    label: '4',
    shape: 'square',
    color: KEFKA_P5_MARKER_COLORS.purple,
    position: { x: -MARKER_CORNER_DISTANCE, y: MARKER_CORNER_DISTANCE },
    size: 2.2,
  },
  {
    label: 'D',
    shape: 'circle',
    color: KEFKA_P5_MARKER_COLORS.purple,
    position: { x: -MARKER_CORNER_DISTANCE, y: 0 },
    radius: 1.25,
  },
  {
    label: '1',
    shape: 'square',
    color: KEFKA_P5_MARKER_COLORS.red,
    position: { x: -MARKER_CORNER_DISTANCE, y: -MARKER_CORNER_DISTANCE },
    size: 2.2,
  },
];

export function pointOnRadius(angle: number, radius: number): Vector2 {
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

export const KEFKA_P5_INITIAL_POSITIONS = Object.fromEntries(
  KEFKA_P5_INITIAL_SLOT_ORDER.map((slot, index) => [
    slot,
    pointOnRadius(KEFKA_P5_NORTH_ANGLE + (Math.PI / 4) * index, KEFKA_P5_INITIAL_RADIUS),
  ]),
) as Record<PartySlot, Vector2>;
