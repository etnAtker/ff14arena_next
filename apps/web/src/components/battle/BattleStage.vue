<script setup lang="ts">
import { Application, Graphics, Text, TextStyle } from 'pixi.js';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type {
  ActorMarkerMechanicSnapshot,
  ActorMarkerShape,
  FieldMarkerShape,
  MapMarker,
  RingIndicatorMechanicSnapshot,
  SimulationSnapshot,
  Vector2,
} from '@ff14arena/shared';
import { getFacingForCameraYaw } from './camera';
import { getSlotColor, getSlotStageText, type OperationMode } from '../../utils/ui';

const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2.4;
const DRAG_ROTATION_SENSITIVITY = 0.005;
const PLAYER_SCREEN_OFFSET_RATIO = 1 / 10;
const WORLD_VIEW_PADDING = 12;
const REMOTE_SMOOTH_SPEED = 8;
const HARD_SNAP_DISTANCE = 0.9;
const ZOOM_STEP = 0.12;
const ZOOM_EMIT_EPSILON = 0.001;
const MAP_MARKER_FILL_ALPHA = 0.42;
const MAP_MARKER_STROKE_ALPHA = 0.46;
const MAP_MARKER_LABEL_ALPHA = 0.68;
const ACTOR_RADIUS = 12;
const CONTROLLED_ACTOR_RADIUS = 13;
const ACTOR_FACING_ARROW_LENGTH = ACTOR_RADIUS / 2;
const ACTOR_FACING_ARROW_HALF_WIDTH = 4.5;
const RING_INDICATOR_MARKER_RADIUS_RATIO = 0.56;
const RING_INDICATOR_MARKER_MIN_RADIUS = 11;
const RING_INDICATOR_QUESTION_FONT_SIZE = 22;
const RING_INDICATOR_RADIUS_PADDING = 10;
const RING_INDICATOR_RADIUS_INDEX_GAP = 12;
const RING_INDICATOR_STROKE_WIDTH = 4;

const props = defineProps<{
  snapshot: SimulationSnapshot | null;
  controlledActorId: string | null;
  cameraYaw: number;
  cameraZoom: number;
  operationMode: OperationMode;
}>();

const emit = defineEmits<{
  cameraYawChange: [yaw: number];
  cameraZoomChange: [zoom: number];
  faceAngle: [facing: number];
}>();

const stageRootRef = ref<HTMLDivElement | null>(null);

interface RenderActorState {
  position: Vector2;
  facing: number;
  targetPosition: Vector2;
  targetFacing: number;
}

let app: Application | null = null;
let dragButton: 0 | 2 | null = null;
let lastDragClientX = 0;
let renderLoopFrame: number | null = null;
let isUnmounted = false;
let isAppReady = false;
let lastDrawAt = 0;
const renderActors = new Map<string, RenderActorState>();
let stageGraphics: Graphics | null = null;
let bossLabel: Text | null = null;
const actorLabels = new Map<string, Text>();
const markerLabels = new Map<string, Text>();
const actorMarkerTextLabels = new Map<string, Text>();
const fieldMarkerTextLabels = new Map<string, Text>();
const ringIndicatorQuestionLabels = new Map<string, Text>();
let pendingYawDelta = 0;
let dragUpdateFrame: number | null = null;
let pendingZoomSteps = 0;
let zoomUpdateFrame: number | null = null;

function clampZoom(zoom: number): number {
  return Math.min(Math.max(zoom, MIN_ZOOM), MAX_ZOOM);
}

function rotatePoint(point: Vector2, angle: number): Vector2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

function getControlledActor() {
  if (props.snapshot === null || props.controlledActorId === null) {
    return null;
  }

  return props.snapshot.actors.find((actor) => actor.id === props.controlledActorId) ?? null;
}

function getRenderActorState(actorId: string): RenderActorState | null {
  return renderActors.get(actorId) ?? null;
}

function getCameraFocus(): Vector2 {
  if (props.operationMode === 'fixed') {
    return { x: 0, y: 0 };
  }

  const controlledActor = getControlledActor();

  if (controlledActor === null) {
    return { x: 0, y: 0 };
  }

  return getRenderActorState(controlledActor.id)?.position ?? controlledActor.position;
}

function getScreenAnchor(width: number, height: number): Vector2 {
  if (props.operationMode === 'fixed') {
    return {
      x: width / 2,
      y: height / 2,
    };
  }

  if (getControlledActor() === null) {
    return {
      x: width / 2,
      y: height / 2,
    };
  }

  return {
    x: width / 2,
    y: height / 2 + height * PLAYER_SCREEN_OFFSET_RATIO,
  };
}

function getWorldScale(width: number, height: number, arenaRadius: number): number {
  const baseScale = Math.min(width, height) / (arenaRadius * 2 + WORLD_VIEW_PADDING);
  return baseScale * props.cameraZoom;
}

function toStagePoint(point: Vector2, width: number, height: number, arenaRadius: number): Vector2 {
  const scale = getWorldScale(width, height, arenaRadius);
  const focus = getCameraFocus();
  const anchor = getScreenAnchor(width, height);
  const relative = {
    x: point.x - focus.x,
    y: point.y - focus.y,
  };
  const cameraYaw = props.operationMode === 'fixed' ? 0 : props.cameraYaw;
  const rotated = rotatePoint(relative, -cameraYaw);

  return {
    x: anchor.x + rotated.x * scale,
    y: anchor.y + rotated.y * scale,
  };
}

function parseHexColor(color: string): number {
  return Number.parseInt(color.replace('#', ''), 16);
}

function clearStage(): void {
  if (stageGraphics === null) {
    return;
  }

  stageGraphics.clear();
}

function createStagePrimitives(): void {
  if (app === null || stageGraphics !== null || bossLabel !== null) {
    return;
  }

  stageGraphics = new Graphics();
  app.stage.addChild(stageGraphics);

  bossLabel = new Text({
    text: '首',
    style: new TextStyle({
      fill: '#1a120d',
      fontSize: 14,
      fontWeight: '700',
    }),
  });
  bossLabel.anchor.set(0.5);
  app.stage.addChild(bossLabel);
}

function syncActorLabels(snapshot: SimulationSnapshot): void {
  if (app === null) {
    return;
  }

  const activeActorIds = new Set(snapshot.actors.map((actor) => actor.id));

  for (const actor of snapshot.actors) {
    if (actorLabels.has(actor.id)) {
      continue;
    }

    const label = new Text({
      text: actor.slot === null ? '?' : getSlotStageText(actor.slot),
      style: new TextStyle({
        fill: '#f8f5ff',
        fontSize: 12,
        fontWeight: '700',
      }),
    });
    label.anchor.set(0.5);
    actorLabels.set(actor.id, label);
    app.stage.addChild(label);
  }

  for (const [actorId, label] of actorLabels) {
    if (activeActorIds.has(actorId)) {
      continue;
    }

    label.destroy();
    actorLabels.delete(actorId);
  }
}

function syncMapMarkerLabels(markers: MapMarker[]): void {
  if (app === null) {
    return;
  }

  const activeMarkerLabels = new Set<string>(markers.map((marker) => marker.label));

  for (const marker of markers) {
    if (markerLabels.has(marker.label)) {
      continue;
    }

    const label = new Text({
      text: marker.label,
      style: new TextStyle({
        fill: '#111827',
        fontSize: 13,
        fontWeight: '800',
      }),
    });
    label.anchor.set(0.5);
    markerLabels.set(marker.label, label);
    app.stage.addChild(label);
  }

  for (const [labelText, label] of markerLabels) {
    if (activeMarkerLabels.has(labelText)) {
      continue;
    }

    label.destroy();
    markerLabels.delete(labelText);
  }
}

function syncActorMarkerTextLabels(snapshot: SimulationSnapshot): void {
  if (app === null) {
    return;
  }

  const actorMarkerMechanics = snapshot.mechanics.filter(
    (mechanic): mechanic is ActorMarkerMechanicSnapshot =>
      mechanic.kind === 'actorMarker' &&
      mechanic.markerShape !== 'stackCircle' &&
      mechanic.showLabel !== false,
  );
  const activeActorMarkerIds = new Set(actorMarkerMechanics.map((mechanic) => mechanic.id));

  for (const mechanic of actorMarkerMechanics) {
    if (actorMarkerTextLabels.has(mechanic.id)) {
      continue;
    }

    const label = new Text({
      text: mechanic.label,
      style: new TextStyle({
        fill: mechanic.color ?? '#f8f5ff',
        fontSize: 16,
        fontWeight: '900',
      }),
    });
    label.anchor.set(0.5);
    actorMarkerTextLabels.set(mechanic.id, label);
    app.stage.addChild(label);
  }

  for (const [mechanicId, label] of actorMarkerTextLabels) {
    if (activeActorMarkerIds.has(mechanicId)) {
      continue;
    }

    label.destroy();
    actorMarkerTextLabels.delete(mechanicId);
  }
}

function syncFieldMarkerTextLabels(snapshot: SimulationSnapshot): void {
  if (app === null) {
    return;
  }

  const fieldMarkerMechanics = snapshot.mechanics.filter(
    (mechanic) =>
      mechanic.kind === 'fieldMarker' && mechanic.shape === 'enemy' && mechanic.showLabel !== false,
  );
  const activeFieldMarkerIds = new Set(fieldMarkerMechanics.map((mechanic) => mechanic.id));

  for (const mechanic of fieldMarkerMechanics) {
    if (fieldMarkerTextLabels.has(mechanic.id)) {
      continue;
    }

    const label = new Text({
      text: getEnemyFieldMarkerStageText(mechanic.label, fieldMarkerMechanics),
      style: new TextStyle({
        fill: '#f8fafc',
        fontSize: 12,
        fontWeight: '900',
      }),
    });
    label.anchor.set(0.5);
    fieldMarkerTextLabels.set(mechanic.id, label);
    app.stage.addChild(label);
  }

  for (const [mechanicId, label] of fieldMarkerTextLabels) {
    if (activeFieldMarkerIds.has(mechanicId)) {
      continue;
    }

    label.destroy();
    fieldMarkerTextLabels.delete(mechanicId);
  }
}

function getRingIndicatorQuestionLabelId(mechanicId: string, ringIndex: number): string {
  return `${mechanicId}:${ringIndex}`;
}

function syncRingIndicatorQuestionLabels(snapshot: SimulationSnapshot): void {
  if (app === null) {
    return;
  }

  const currentApp = app;
  const ringIndicators = snapshot.mechanics.filter(
    (mechanic): mechanic is RingIndicatorMechanicSnapshot => mechanic.kind === 'ringIndicator',
  );
  const activeLabelIds = new Set<string>();

  for (const mechanic of ringIndicators) {
    mechanic.rings.forEach((ring, ringIndex) => {
      if (ring.markerKind !== 'question') {
        return;
      }

      const labelId = getRingIndicatorQuestionLabelId(mechanic.id, ringIndex);
      activeLabelIds.add(labelId);

      if (ringIndicatorQuestionLabels.has(labelId)) {
        return;
      }

      const label = new Text({
        text: '?',
        style: new TextStyle({
          fill: '#ffffff',
          fontSize: RING_INDICATOR_QUESTION_FONT_SIZE,
          fontWeight: '900',
        }),
      });
      label.anchor.set(0.5);
      ringIndicatorQuestionLabels.set(labelId, label);
      currentApp.stage.addChild(label);
    });
  }

  for (const [labelId, label] of ringIndicatorQuestionLabels) {
    if (activeLabelIds.has(labelId)) {
      continue;
    }

    label.destroy();
    ringIndicatorQuestionLabels.delete(labelId);
  }
}

function getEnemyFieldMarkerStageText(
  label: string,
  activeEnemyMarkers: Array<{ label: string }>,
): string {
  const chars = Array.from(label.trim());
  const firstChar = chars[0] ?? '?';
  const duplicateFirstChar =
    activeEnemyMarkers.filter((marker) => {
      return (Array.from(marker.label.trim())[0] ?? '?') === firstChar;
    }).length > 1;

  return duplicateFirstChar ? chars.slice(0, 2).join('') || '?' : firstChar;
}

function hideLabels(): void {
  if (bossLabel !== null) {
    bossLabel.visible = false;
  }

  for (const label of actorLabels.values()) {
    label.visible = false;
  }

  for (const label of markerLabels.values()) {
    label.visible = false;
  }

  for (const label of actorMarkerTextLabels.values()) {
    label.visible = false;
  }

  for (const label of fieldMarkerTextLabels.values()) {
    label.visible = false;
  }

  for (const label of ringIndicatorQuestionLabels.values()) {
    label.visible = false;
  }
}

function syncRenderActors(): void {
  const snapshot = props.snapshot;

  if (snapshot === null) {
    renderActors.clear();
    return;
  }

  const activeActorIds = new Set(snapshot.actors.map((actor) => actor.id));

  for (const actor of snapshot.actors) {
    const existing = renderActors.get(actor.id);
    const isControlled = actor.id === props.controlledActorId;

    if (existing === undefined) {
      renderActors.set(actor.id, {
        position: { x: actor.position.x, y: actor.position.y },
        facing: actor.facing,
        targetPosition: { x: actor.position.x, y: actor.position.y },
        targetFacing: actor.facing,
      });
      continue;
    }

    existing.targetPosition = {
      x: actor.position.x,
      y: actor.position.y,
    };
    existing.targetFacing = actor.facing;

    const distanceToTarget = Math.hypot(
      existing.position.x - actor.position.x,
      existing.position.y - actor.position.y,
    );

    if (isControlled || distanceToTarget >= HARD_SNAP_DISTANCE) {
      existing.position = {
        x: actor.position.x,
        y: actor.position.y,
      };
      existing.facing = actor.facing;
    }
  }

  for (const actorId of [...renderActors.keys()]) {
    if (!activeActorIds.has(actorId)) {
      renderActors.delete(actorId);
    }
  }
}

function advanceRenderActors(deltaMs: number): boolean {
  let hasAnimatingActor = false;

  for (const [actorId, state] of renderActors) {
    const isControlled = actorId === props.controlledActorId;
    state.facing = state.targetFacing;

    if (isControlled) {
      state.position = {
        x: state.targetPosition.x,
        y: state.targetPosition.y,
      };
      continue;
    }

    const dx = state.targetPosition.x - state.position.x;
    const dy = state.targetPosition.y - state.position.y;
    const distanceToTarget = Math.hypot(dx, dy);

    if (distanceToTarget <= 1e-4) {
      state.position = {
        x: state.targetPosition.x,
        y: state.targetPosition.y,
      };
      continue;
    }

    const maxStep = REMOTE_SMOOTH_SPEED * (deltaMs / 1_000);
    const step = Math.min(distanceToTarget, maxStep);

    state.position = {
      x: state.position.x + (dx / distanceToTarget) * step,
      y: state.position.y + (dy / distanceToTarget) * step,
    };
    hasAnimatingActor = true;
  }

  return hasAnimatingActor;
}

function drawMapMarker(
  graphics: Graphics,
  marker: MapMarker,
  width: number,
  height: number,
  arenaRadius: number,
  scale: number,
): void {
  const point = toStagePoint(marker.position, width, height, arenaRadius);
  const color = parseHexColor(marker.color);

  if (marker.shape === 'circle') {
    const radius = (marker.radius ?? 2) * scale;
    graphics.circle(point.x, point.y, radius).fill({ color, alpha: MAP_MARKER_FILL_ALPHA });
    graphics.circle(point.x, point.y, radius).stroke({
      width: 2,
      color: 0xffffff,
      alpha: MAP_MARKER_STROKE_ALPHA,
    });
  } else {
    const halfSize = (marker.size ?? 3) / 2;
    const corners = [
      { x: marker.position.x - halfSize, y: marker.position.y - halfSize },
      { x: marker.position.x + halfSize, y: marker.position.y - halfSize },
      { x: marker.position.x + halfSize, y: marker.position.y + halfSize },
      { x: marker.position.x - halfSize, y: marker.position.y + halfSize },
    ].map((corner) => toStagePoint(corner, width, height, arenaRadius));
    const points = corners.flatMap((corner) => [corner.x, corner.y]);

    graphics.poly(points).fill({ color, alpha: MAP_MARKER_FILL_ALPHA });
    graphics.poly(points).stroke({
      width: 2,
      color: 0xffffff,
      alpha: MAP_MARKER_STROKE_ALPHA,
    });
  }

  const label = markerLabels.get(marker.label);

  if (label !== undefined) {
    label.visible = true;
    label.text = marker.label;
    label.alpha = MAP_MARKER_LABEL_ALPHA;
    label.x = point.x;
    label.y = point.y;
  }
}

function drawActorMarker(
  graphics: Graphics,
  position: Vector2,
  markerShape: ActorMarkerShape,
  radius: number | undefined,
  colorValue: string | undefined,
  width: number,
  height: number,
  arenaRadius: number,
  scale: number,
): void {
  const actorPoint = toStagePoint(position, width, height, arenaRadius);
  const markerColor = colorValue === undefined ? null : parseHexColor(colorValue);

  if (markerShape === 'stackCircle') {
    const markerRadius = Math.max((radius ?? 4) * scale, 0.5 * scale);
    const arrowLength = 0.9 * scale;
    const arrowHalfWidth = 0.32 * scale;

    graphics.circle(actorPoint.x, actorPoint.y, markerRadius).fill({
      color: markerColor ?? 0xfacc15,
      alpha: 0.12,
    });
    graphics.circle(actorPoint.x, actorPoint.y, markerRadius).stroke({
      width: 2.5,
      color: markerColor ?? 0xfacc15,
      alpha: 0.95,
    });

    for (let index = 0; index < 4; index += 1) {
      const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 4;
      const outward = {
        x: Math.cos(angle),
        y: Math.sin(angle),
      };
      const tangent = {
        x: -outward.y,
        y: outward.x,
      };
      const tip = {
        x: actorPoint.x + outward.x * (markerRadius - arrowLength),
        y: actorPoint.y + outward.y * (markerRadius - arrowLength),
      };
      const base = {
        x: actorPoint.x + outward.x * (markerRadius + 0.18 * scale),
        y: actorPoint.y + outward.y * (markerRadius + 0.18 * scale),
      };
      const points = [
        tip.x,
        tip.y,
        base.x + tangent.x * arrowHalfWidth,
        base.y + tangent.y * arrowHalfWidth,
        base.x - tangent.x * arrowHalfWidth,
        base.y - tangent.y * arrowHalfWidth,
      ];

      graphics.poly(points).fill({ color: markerColor ?? 0xfacc15, alpha: 0.95 });
      graphics.poly(points).stroke({ width: 1.5, color: 0x4c2f12, alpha: 0.8 });
    }

    return;
  }

  const markerCenter = {
    x: actorPoint.x,
    y: actorPoint.y - 2.4 * scale,
  };

  if (markerShape === 'circleDot' || markerShape === 'numberCircle') {
    graphics.circle(markerCenter.x, markerCenter.y, 0.75 * scale).stroke({
      width: 2,
      color: markerColor ?? 0x7dd3fc,
      alpha: 0.95,
    });
    if (markerShape === 'numberCircle') {
      return;
    }
    graphics.circle(markerCenter.x, markerCenter.y, 0.16 * scale).fill({
      color: markerColor ?? 0xe0f2fe,
      alpha: 0.95,
    });
    return;
  }

  if (markerShape === 'fanSector') {
    const radius = 0.86 * scale;
    const apex = {
      x: markerCenter.x,
      y: markerCenter.y + radius,
    };
    const points = [apex.x, apex.y];

    graphics.circle(markerCenter.x, markerCenter.y, radius).stroke({
      width: 1.5,
      color: 0xfbcfe8,
      alpha: 0.95,
    });

    for (let index = 0; index <= 8; index += 1) {
      const fanAngle = -Math.PI * 0.72 + (Math.PI * 0.44 * index) / 8;
      points.push(markerCenter.x + Math.cos(fanAngle) * radius);
      points.push(markerCenter.y + Math.sin(fanAngle) * radius);
    }

    graphics.poly(points).fill({ color: markerColor ?? 0xf472b6, alpha: 0.68 });
    graphics.poly(points).stroke({ width: 1.5, color: markerColor ?? 0x831843, alpha: 0.9 });
    return;
  }

  const arrowLength = 0.72 * scale;
  const arrowHalfWidth = 0.24 * scale;
  const arrowOuterRadius = 0.95 * scale;
  const arrowInnerRadius = arrowOuterRadius - arrowLength;

  for (let index = 0; index < 4; index += 1) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / 4;
    const outward = {
      x: Math.cos(angle),
      y: Math.sin(angle),
    };
    const tangent = {
      x: -outward.y,
      y: outward.x,
    };
    const tip = {
      x: markerCenter.x + outward.x * arrowInnerRadius,
      y: markerCenter.y + outward.y * arrowInnerRadius,
    };
    const base = {
      x: markerCenter.x + outward.x * arrowOuterRadius,
      y: markerCenter.y + outward.y * arrowOuterRadius,
    };
    const points = [
      tip.x,
      tip.y,
      base.x + tangent.x * arrowHalfWidth,
      base.y + tangent.y * arrowHalfWidth,
      base.x - tangent.x * arrowHalfWidth,
      base.y - tangent.y * arrowHalfWidth,
    ];

    graphics.poly(points).fill({ color: markerColor ?? 0xf4d35e, alpha: 0.95 });
    graphics.poly(points).stroke({ width: 1.5, color: 0x4c2f12, alpha: 0.8 });
  }
}

function drawRingIndicator(
  graphics: Graphics,
  mechanic: RingIndicatorMechanicSnapshot,
  width: number,
  height: number,
  arenaRadius: number,
  scale: number,
): void {
  const centerPoint = toStagePoint(mechanic.center, width, height, arenaRadius);

  mechanic.rings.forEach((ring, ringIndex) => {
    const baseRingRadius = ring.radius * scale;
    const ringRadius =
      baseRingRadius + RING_INDICATOR_RADIUS_PADDING + ringIndex * RING_INDICATOR_RADIUS_INDEX_GAP;
    const baseMarkerWorldPosition = {
      x: mechanic.center.x + Math.cos(ring.markerAngle) * ring.radius,
      y: mechanic.center.y + Math.sin(ring.markerAngle) * ring.radius,
    };
    const baseMarkerPoint = toStagePoint(baseMarkerWorldPosition, width, height, arenaRadius);
    const markerDirection = {
      x: baseMarkerPoint.x - centerPoint.x,
      y: baseMarkerPoint.y - centerPoint.y,
    };
    const markerDirectionLength = Math.hypot(markerDirection.x, markerDirection.y) || 1;
    const markerPoint = {
      x: centerPoint.x + (markerDirection.x / markerDirectionLength) * ringRadius,
      y: centerPoint.y + (markerDirection.y / markerDirectionLength) * ringRadius,
    };
    const markerRadius = Math.max(
      RING_INDICATOR_MARKER_RADIUS_RATIO * scale,
      RING_INDICATOR_MARKER_MIN_RADIUS,
    );
    const ringColor = parseHexColor(ring.color);
    const markerColor = parseHexColor(ring.markerColor);

    graphics.circle(centerPoint.x, centerPoint.y, ringRadius).stroke({
      width: RING_INDICATOR_STROKE_WIDTH,
      color: ringColor,
      alpha: 0.95,
    });
    graphics.circle(markerPoint.x, markerPoint.y, markerRadius).fill({
      color: markerColor,
      alpha: 0.96,
    });
    graphics.circle(markerPoint.x, markerPoint.y, markerRadius).stroke({
      width: 2,
      color: 0xffffff,
      alpha: 0.9,
    });

    if (ring.markerKind === 'question') {
      const label = ringIndicatorQuestionLabels.get(
        getRingIndicatorQuestionLabelId(mechanic.id, ringIndex),
      );

      if (label !== undefined) {
        label.visible = true;
        label.x = markerPoint.x;
        label.y = markerPoint.y;
        label.alpha = 0.98;
      }
    }
  });
}

function drawFieldMarker(
  graphics: Graphics,
  position: Vector2,
  shape: FieldMarkerShape,
  radius: number,
  direction: number | undefined,
  colorValue: string | undefined,
  targetRingRadius: number | undefined,
  targetRingColorValue: string | undefined,
  width: number,
  height: number,
  arenaRadius: number,
  scale: number,
): void {
  const point = toStagePoint(position, width, height, arenaRadius);
  const markerRadius = Math.max(radius * scale, 0.5 * scale);
  const color = colorValue === undefined ? 0xa78bfa : parseHexColor(colorValue);
  const strokeColor = shape === 'enemy' ? 0x312e81 : 0xffffff;
  const points: number[] = [];

  if (targetRingRadius !== undefined) {
    graphics.circle(point.x, point.y, targetRingRadius * scale).stroke({
      width: 2,
      color: targetRingColorValue === undefined ? 0xef4444 : parseHexColor(targetRingColorValue),
      alpha: 0.95,
    });
  }

  if (shape === 'circle') {
    graphics.circle(point.x, point.y, markerRadius).fill({ color, alpha: 0.9 });
    graphics.circle(point.x, point.y, markerRadius).stroke({
      width: 2,
      color: strokeColor,
      alpha: 0.95,
    });
    return;
  }

  if (shape === 'square') {
    const halfSize = markerRadius;
    points.push(
      point.x - halfSize,
      point.y - halfSize,
      point.x + halfSize,
      point.y - halfSize,
      point.x + halfSize,
      point.y + halfSize,
      point.x - halfSize,
      point.y + halfSize,
    );
  } else {
    const pointCount = shape === 'triangle' ? 3 : shape === 'diamond' ? 4 : 8;
    const startAngle = shape === 'diamond' || shape === 'enemy' ? -Math.PI / 2 : Math.PI / 2;
    const spikeRadius = markerRadius * 1.45;

    for (let index = 0; index < pointCount; index += 1) {
      const angle = startAngle + (Math.PI * 2 * index) / pointCount;
      const currentRadius = shape === 'enemy' && index % 2 === 0 ? spikeRadius : markerRadius;
      points.push(point.x + Math.cos(angle) * currentRadius);
      points.push(point.y + Math.sin(angle) * currentRadius);
    }
  }

  graphics.poly(points).fill({ color, alpha: 0.9 });
  graphics.poly(points).stroke({ width: 2, color: strokeColor, alpha: 0.95 });

  if (shape === 'enemy' && direction !== undefined) {
    drawActorFacingArrow(graphics, point, direction, strokeColor, 0.92);
  }
}

function drawRectangleTelegraph(
  graphics: Graphics,
  center: Vector2,
  direction: number,
  length: number,
  telegraphWidth: number,
  colorValue: string | undefined,
  width: number,
  height: number,
  arenaRadius: number,
): void {
  const forward = {
    x: Math.cos(direction),
    y: Math.sin(direction),
  };
  const right = {
    x: -forward.y,
    y: forward.x,
  };
  const halfWidth = telegraphWidth / 2;
  const end = {
    x: center.x + forward.x * length,
    y: center.y + forward.y * length,
  };
  const corners = [
    {
      x: center.x + right.x * halfWidth,
      y: center.y + right.y * halfWidth,
    },
    {
      x: end.x + right.x * halfWidth,
      y: end.y + right.y * halfWidth,
    },
    {
      x: end.x - right.x * halfWidth,
      y: end.y - right.y * halfWidth,
    },
    {
      x: center.x - right.x * halfWidth,
      y: center.y - right.y * halfWidth,
    },
  ].map((corner) => toStagePoint(corner, width, height, arenaRadius));
  const color = colorValue === undefined ? 0xa855f7 : parseHexColor(colorValue);
  const polygon = corners.flatMap((corner) => [corner.x, corner.y]);

  graphics.poly(polygon).fill({ color, alpha: 0.18 });
  graphics.poly(polygon).stroke({ width: 2, color, alpha: 0.88 });
}

function drawFanTelegraph(
  graphics: Graphics,
  center: Vector2,
  direction: number,
  angle: number,
  radius: number,
  width: number,
  height: number,
  arenaRadius: number,
): void {
  const points = [toStagePoint(center, width, height, arenaRadius)];
  const steps = 18;

  for (let index = 0; index <= steps; index += 1) {
    const fanAngle = direction - angle / 2 + (angle * index) / steps;
    points.push(
      toStagePoint(
        {
          x: center.x + Math.cos(fanAngle) * radius,
          y: center.y + Math.sin(fanAngle) * radius,
        },
        width,
        height,
        arenaRadius,
      ),
    );
  }

  const polygon = points.flatMap((point) => [point.x, point.y]);
  graphics.poly(polygon).fill({ color: 0xf47262, alpha: 0.18 });
  graphics.poly(polygon).stroke({ width: 2, color: 0xffd1ca, alpha: 0.85 });
}

function drawActorFacingArrow(
  graphics: Graphics,
  point: Vector2,
  facing: number,
  color: number,
  alpha: number,
): void {
  const cameraYaw = props.operationMode === 'fixed' ? 0 : props.cameraYaw;
  const screenFacing = facing - cameraYaw;
  const forward = {
    x: Math.cos(screenFacing),
    y: Math.sin(screenFacing),
  };
  const tangent = {
    x: -forward.y,
    y: forward.x,
  };
  const baseCenter = {
    x: point.x + forward.x * ACTOR_RADIUS,
    y: point.y + forward.y * ACTOR_RADIUS,
  };
  const tip = {
    x: point.x + forward.x * (ACTOR_RADIUS + ACTOR_FACING_ARROW_LENGTH),
    y: point.y + forward.y * (ACTOR_RADIUS + ACTOR_FACING_ARROW_LENGTH),
  };
  const points = [
    tip.x,
    tip.y,
    baseCenter.x + tangent.x * ACTOR_FACING_ARROW_HALF_WIDTH,
    baseCenter.y + tangent.y * ACTOR_FACING_ARROW_HALF_WIDTH,
    baseCenter.x - tangent.x * ACTOR_FACING_ARROW_HALF_WIDTH,
    baseCenter.y - tangent.y * ACTOR_FACING_ARROW_HALF_WIDTH,
  ];

  graphics.poly(points).stroke({ width: 4, color: 0x111827, alpha: alpha * 0.78 });
  graphics.poly(points).fill({ color, alpha });
  graphics.poly(points).stroke({ width: 1.2, color: 0xffffff, alpha: alpha * 0.88 });
}

function draw(now: number): void {
  if (stageRootRef.value === null || app === null || !isAppReady) {
    return;
  }

  const width = stageRootRef.value.clientWidth;
  const height = stageRootRef.value.clientHeight;

  if (width <= 0 || height <= 0) {
    return;
  }

  if (app.renderer.width !== width || app.renderer.height !== height) {
    app.renderer.resize(width, height);
  }

  const deltaMs = lastDrawAt === 0 ? 16 : Math.min(now - lastDrawAt, 50);
  lastDrawAt = now;

  createStagePrimitives();
  clearStage();
  syncRenderActors();

  if (props.snapshot === null) {
    hideLabels();
    return;
  }

  advanceRenderActors(deltaMs);

  const { arenaRadius, bossTargetRingRadius } = props.snapshot;
  const scale = getWorldScale(width, height, arenaRadius);
  const arenaCenter = toStagePoint({ x: 0, y: 0 }, width, height, arenaRadius);
  const graphics = stageGraphics;

  if (graphics === null) {
    return;
  }

  syncActorLabels(props.snapshot);
  syncMapMarkerLabels(props.snapshot.mapMarkers);
  syncActorMarkerTextLabels(props.snapshot);
  syncFieldMarkerTextLabels(props.snapshot);
  syncRingIndicatorQuestionLabels(props.snapshot);
  const activeEnemyFieldMarkers = props.snapshot.mechanics.filter(
    (mechanic) =>
      mechanic.kind === 'fieldMarker' && mechanic.shape === 'enemy' && mechanic.showLabel !== false,
  );

  graphics
    .circle(arenaCenter.x, arenaCenter.y, arenaRadius * scale)
    .fill({ color: 0x162225, alpha: 1 });
  graphics
    .circle(arenaCenter.x, arenaCenter.y, arenaRadius * scale)
    .stroke({ width: 3, color: 0x86d8ca, alpha: 0.92 });
  if (bossTargetRingRadius > 0) {
    graphics.circle(arenaCenter.x, arenaCenter.y, bossTargetRingRadius * scale).stroke({
      width: 2,
      color: 0xf0d08b,
      alpha: 0.9,
    });
  }

  for (const marker of props.snapshot.mapMarkers) {
    drawMapMarker(graphics, marker, width, height, arenaRadius, scale);
  }

  for (const mechanic of props.snapshot.mechanics) {
    if (mechanic.kind === 'tether') {
      const sourcePosition =
        mechanic.sourcePosition ??
        (mechanic.sourceId === props.snapshot.boss.id
          ? props.snapshot.boss.position
          : props.snapshot.actors.find((actor) => actor.id === mechanic.sourceId)?.position);
      const target = props.snapshot.actors.find((actor) => actor.id === mechanic.targetId);

      if (sourcePosition !== undefined && target !== undefined) {
        const sourcePoint = toStagePoint(sourcePosition, width, height, arenaRadius);
        const targetPoint = toStagePoint(target.position, width, height, arenaRadius);
        graphics.moveTo(sourcePoint.x, sourcePoint.y);
        graphics.lineTo(targetPoint.x, targetPoint.y);
        graphics.stroke({ width: 3, color: 0xff6b6b, alpha: 0.9 });
      }

      continue;
    }

    if (mechanic.kind === 'actorMarker') {
      const target = props.snapshot.actors.find((actor) => actor.id === mechanic.targetId);
      const targetPosition =
        target === undefined ? null : (getRenderActorState(target.id)?.position ?? target.position);

      if (targetPosition !== null) {
        drawActorMarker(
          graphics,
          targetPosition,
          mechanic.markerShape,
          mechanic.radius,
          mechanic.color,
          width,
          height,
          arenaRadius,
          scale,
        );

        const label = actorMarkerTextLabels.get(mechanic.id);

        if (label !== undefined) {
          const actorPoint = toStagePoint(targetPosition, width, height, arenaRadius);
          label.visible = true;
          label.text = mechanic.label;
          label.x = actorPoint.x;
          label.y = actorPoint.y - 2.4 * scale;
          label.alpha = 0.98;
        }
      }

      continue;
    }

    if (mechanic.kind === 'ringIndicator') {
      drawRingIndicator(graphics, mechanic, width, height, arenaRadius, scale);
      continue;
    }

    if (mechanic.kind === 'fanTelegraph') {
      drawFanTelegraph(
        graphics,
        mechanic.center,
        mechanic.direction,
        mechanic.angle,
        mechanic.radius,
        width,
        height,
        arenaRadius,
      );
      continue;
    }

    const point = toStagePoint(mechanic.center, width, height, arenaRadius);

    if (mechanic.kind === 'rectangleTelegraph') {
      drawRectangleTelegraph(
        graphics,
        mechanic.center,
        mechanic.direction,
        mechanic.length,
        mechanic.width,
        mechanic.color,
        width,
        height,
        arenaRadius,
      );
      continue;
    }

    if (mechanic.kind === 'fieldMarker') {
      drawFieldMarker(
        graphics,
        mechanic.center,
        mechanic.shape,
        mechanic.radius,
        mechanic.direction,
        mechanic.color,
        mechanic.targetRingRadius,
        mechanic.targetRingColor,
        width,
        height,
        arenaRadius,
        scale,
      );

      if (mechanic.shape === 'enemy') {
        const label = fieldMarkerTextLabels.get(mechanic.id);

        if (label !== undefined) {
          label.visible = true;
          label.text = getEnemyFieldMarkerStageText(mechanic.label, activeEnemyFieldMarkers);
          label.x = point.x;
          label.y = point.y;
          label.alpha = 0.98;
        }
      }
      continue;
    }

    if (mechanic.kind === 'tower') {
      graphics.circle(point.x, point.y, mechanic.radius * scale).fill({
        color: 0xf4d35e,
        alpha: 0.2,
      });
      graphics.circle(point.x, point.y, mechanic.radius * scale).stroke({
        width: 3,
        color: 0xf4d35e,
        alpha: 0.92,
      });
      continue;
    }

    if (mechanic.kind === 'circle') {
      graphics
        .circle(point.x, point.y, mechanic.radius * scale)
        .fill({ color: 0xf47262, alpha: 0.22 });
      graphics.circle(point.x, point.y, mechanic.radius * scale).stroke({
        width: 2,
        color: 0xf47262,
        alpha: 0.85,
      });
      continue;
    }

    if (mechanic.kind === 'circleTelegraph') {
      const color = mechanic.color === undefined ? 0xf47262 : parseHexColor(mechanic.color);
      const strokeColor = mechanic.color === undefined ? 0xffd1ca : color;
      graphics.circle(point.x, point.y, mechanic.radius * scale).fill({ color, alpha: 0.14 });
      graphics.circle(point.x, point.y, mechanic.radius * scale).stroke({
        width: 2,
        color: strokeColor,
        alpha: 0.9,
      });
      continue;
    }

    if (mechanic.kind === 'donutTelegraph') {
      const color = mechanic.color === undefined ? 0xc45779 : parseHexColor(mechanic.color);
      const strokeColor = mechanic.color === undefined ? 0xffd1ca : color;
      graphics.circle(point.x, point.y, mechanic.outerRadius * scale).fill({
        color,
        alpha: 0.12,
      });
      graphics
        .circle(point.x, point.y, mechanic.innerRadius * scale)
        .fill({ color: 0x162225, alpha: 1 });
      graphics.circle(point.x, point.y, mechanic.outerRadius * scale).stroke({
        width: 2,
        color: strokeColor,
        alpha: 0.9,
      });
      continue;
    }

    if (mechanic.kind === 'donut') {
      graphics.circle(point.x, point.y, mechanic.outerRadius * scale).fill({
        color: 0xc45779,
        alpha: 0.18,
      });
      graphics
        .circle(point.x, point.y, mechanic.innerRadius * scale)
        .fill({ color: 0x162225, alpha: 1 });
      graphics.circle(point.x, point.y, mechanic.outerRadius * scale).stroke({
        width: 2,
        color: 0xc45779,
        alpha: 0.85,
      });
      continue;
    }

    const color = mechanic.kind === 'share' ? 0x67d6a3 : 0x7ab8ff;
    graphics.circle(point.x, point.y, mechanic.radius * scale).fill({ color, alpha: 0.18 });
    graphics.circle(point.x, point.y, mechanic.radius * scale).stroke({
      width: 2,
      color,
      alpha: 0.9,
    });
  }

  if (bossTargetRingRadius > 0) {
    const bossPoint = toStagePoint(props.snapshot.boss.position, width, height, arenaRadius);
    graphics.circle(bossPoint.x, bossPoint.y, 16).fill({ color: 0xf6c66a, alpha: 1 });
    graphics.circle(bossPoint.x, bossPoint.y, 20).stroke({
      width: 2,
      color: 0xffefc2,
      alpha: 0.7,
    });

    if (bossLabel !== null) {
      bossLabel.visible = true;
      bossLabel.x = bossPoint.x;
      bossLabel.y = bossPoint.y;
    }
  } else if (bossLabel !== null) {
    bossLabel.visible = false;
  }

  for (const actor of props.snapshot.actors) {
    const renderState = getRenderActorState(actor.id);
    const renderPosition = renderState?.position ?? actor.position;
    const renderFacing = renderState?.facing ?? actor.facing;
    const point = toStagePoint(renderPosition, width, height, arenaRadius);
    const color =
      actor.slot === null
        ? '#ffffff'
        : getSlotColor(actor.slot, actor.id === props.controlledActorId);
    const numericColor = Number.parseInt(color.replace('#', ''), 16);
    const alpha = actor.alive ? 1 : 0.35;

    graphics
      .circle(
        point.x,
        point.y,
        actor.id === props.controlledActorId ? CONTROLLED_ACTOR_RADIUS : ACTOR_RADIUS,
      )
      .fill({
        color: numericColor,
        alpha,
      });
    graphics.circle(point.x, point.y, actor.id === props.controlledActorId ? 16 : 14).stroke({
      width: actor.id === props.controlledActorId ? 3 : 2,
      color: 0xffffff,
      alpha: actor.id === props.controlledActorId ? 0.82 : 0.24,
    });
    drawActorFacingArrow(graphics, point, renderFacing, numericColor, alpha);

    const label = actorLabels.get(actor.id);

    if (label !== undefined) {
      label.visible = true;
      label.text = actor.slot === null ? '?' : getSlotStageText(actor.slot);
      label.x = point.x;
      label.y = point.y;
      label.alpha = alpha;
    }
  }
}

function runRenderLoop(now: number): void {
  if (isUnmounted) {
    return;
  }

  renderLoopFrame = requestAnimationFrame(runRenderLoop);
  draw(now);
}

function handleMouseDown(event: MouseEvent): void {
  if (
    (event.button !== 0 && event.button !== 2) ||
    props.snapshot === null ||
    props.operationMode === 'fixed'
  ) {
    return;
  }

  dragButton = event.button;
  lastDragClientX = event.clientX;
}

function handleMouseMove(event: MouseEvent): void {
  if (dragButton === null) {
    return;
  }

  const deltaX = event.clientX - lastDragClientX;
  lastDragClientX = event.clientX;

  if (deltaX === 0) {
    return;
  }

  if (props.operationMode === 'fixed') {
    return;
  }

  pendingYawDelta += deltaX * DRAG_ROTATION_SENSITIVITY;

  if (dragUpdateFrame !== null) {
    return;
  }

  dragUpdateFrame = requestAnimationFrame(() => {
    dragUpdateFrame = null;

    if (pendingYawDelta === 0 || props.operationMode === 'fixed') {
      pendingYawDelta = 0;
      return;
    }

    const nextYaw = props.cameraYaw + pendingYawDelta;
    pendingYawDelta = 0;
    emit('cameraYawChange', nextYaw);

    if (dragButton !== 2 || props.operationMode !== 'standard') {
      return;
    }

    emit('faceAngle', getFacingForCameraYaw(nextYaw));
  });
}

function endDrag(): void {
  dragButton = null;
}

function handleWheel(event: WheelEvent): void {
  event.preventDefault();

  pendingZoomSteps += event.deltaY > 0 ? -1 : 1;

  if (zoomUpdateFrame !== null) {
    return;
  }

  zoomUpdateFrame = requestAnimationFrame(() => {
    zoomUpdateFrame = null;

    if (pendingZoomSteps === 0) {
      return;
    }

    const nextZoom = clampZoom(props.cameraZoom + pendingZoomSteps * ZOOM_STEP);
    pendingZoomSteps = 0;

    if (Math.abs(nextZoom - props.cameraZoom) < ZOOM_EMIT_EPSILON) {
      return;
    }

    emit('cameraZoomChange', nextZoom);
  });
}

function handleDoubleClick(): void {
  emit('cameraZoomChange', 1);
}

onMounted(async () => {
  isUnmounted = false;
  isAppReady = false;
  lastDrawAt = 0;

  if (stageRootRef.value === null) {
    return;
  }

  app = new Application();
  await app.init({
    resizeTo: stageRootRef.value,
    backgroundAlpha: 0,
    antialias: true,
  });
  isAppReady = true;
  stageRootRef.value.appendChild(app.canvas);
  createStagePrimitives();
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', endDrag);
  renderLoopFrame = requestAnimationFrame(runRenderLoop);
});

onBeforeUnmount(() => {
  isUnmounted = true;
  isAppReady = false;
  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', endDrag);

  if (renderLoopFrame !== null) {
    cancelAnimationFrame(renderLoopFrame);
    renderLoopFrame = null;
  }

  if (dragUpdateFrame !== null) {
    cancelAnimationFrame(dragUpdateFrame);
    dragUpdateFrame = null;
  }

  if (zoomUpdateFrame !== null) {
    cancelAnimationFrame(zoomUpdateFrame);
    zoomUpdateFrame = null;
  }

  app?.destroy(true, {
    children: true,
    texture: true,
  });
  renderActors.clear();
  actorLabels.clear();
  markerLabels.clear();
  actorMarkerTextLabels.clear();
  fieldMarkerTextLabels.clear();
  ringIndicatorQuestionLabels.clear();
  stageGraphics = null;
  bossLabel = null;
});
</script>

<template>
  <div
    ref="stageRootRef"
    class="battle-stage"
    @contextmenu.prevent
    @dblclick="handleDoubleClick"
    @mousedown="handleMouseDown"
    @mouseleave="endDrag"
    @wheel="handleWheel"
  />
</template>

<style scoped>
.battle-stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  border-radius: 20px;
  background:
    radial-gradient(circle at top, rgba(67, 130, 124, 0.12), transparent 26%),
    rgba(10, 21, 23, 0.94);
  overflow: hidden;
  cursor: grab;
  user-select: none;
}

.battle-stage :deep(canvas) {
  display: block;
}

.battle-stage:active {
  cursor: grabbing;
}
</style>
