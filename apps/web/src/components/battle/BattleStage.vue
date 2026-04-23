<script setup lang="ts">
import { Application, Graphics, Text, TextStyle } from 'pixi.js';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { SimulationSnapshot, Vector2 } from '@ff14arena/shared';
import { getFacingForCameraYaw } from './camera';
import { getSlotColor, getSlotStageText } from '../../utils/ui';

type OperationMode = 'traditional' | 'standard';

const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2.4;
const DRAG_ROTATION_SENSITIVITY = 0.005;
const PLAYER_SCREEN_OFFSET_RATIO = 1 / 10;
const WORLD_VIEW_PADDING = 12;
const REMOTE_SMOOTH_SPEED = 8;
const HARD_SNAP_DISTANCE = 0.9;

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
let resizeObserver: ResizeObserver | null = null;
let drawFrame: number | null = null;
let isUnmounted = false;
let isAppReady = false;
let lastDrawAt = 0;
const renderActors = new Map<string, RenderActorState>();
let stageGraphics: Graphics | null = null;
let bossLabel: Text | null = null;
const actorLabels = new Map<string, Text>();
let pendingYawDelta = 0;
let dragUpdateFrame: number | null = null;

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
  const controlledActor = getControlledActor();

  if (controlledActor === null) {
    return { x: 0, y: 0 };
  }

  return getRenderActorState(controlledActor.id)?.position ?? controlledActor.position;
}

function getScreenAnchor(width: number, height: number): Vector2 {
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
  const rotated = rotatePoint(relative, -props.cameraYaw);

  return {
    x: anchor.x + rotated.x * scale,
    y: anchor.y + rotated.y * scale,
  };
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
    text: 'B',
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

function hideLabels(): void {
  if (bossLabel !== null) {
    bossLabel.visible = false;
  }

  for (const label of actorLabels.values()) {
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

function scheduleDraw(): void {
  if (isUnmounted || !isAppReady) {
    return;
  }

  if (drawFrame !== null) {
    cancelAnimationFrame(drawFrame);
  }

  drawFrame = requestAnimationFrame(() => {
    drawFrame = null;

    if (isUnmounted) {
      return;
    }

    draw();
  });
}

function draw(): void {
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

  const now = performance.now();
  const deltaMs = lastDrawAt === 0 ? 16 : Math.min(now - lastDrawAt, 50);
  lastDrawAt = now;

  createStagePrimitives();
  clearStage();
  syncRenderActors();

  if (props.snapshot === null) {
    hideLabels();
    return;
  }

  const shouldContinueAnimating = advanceRenderActors(deltaMs);

  const { arenaRadius, bossTargetRingRadius } = props.snapshot;
  const scale = getWorldScale(width, height, arenaRadius);
  const arenaCenter = toStagePoint({ x: 0, y: 0 }, width, height, arenaRadius);
  const graphics = stageGraphics;

  if (graphics === null) {
    return;
  }

  syncActorLabels(props.snapshot);

  graphics
    .circle(arenaCenter.x, arenaCenter.y, arenaRadius * scale)
    .fill({ color: 0x162225, alpha: 1 });
  graphics
    .circle(arenaCenter.x, arenaCenter.y, arenaRadius * scale)
    .stroke({ width: 3, color: 0x86d8ca, alpha: 0.92 });
  graphics.circle(arenaCenter.x, arenaCenter.y, bossTargetRingRadius * scale).stroke({
    width: 2,
    color: 0xf0d08b,
    alpha: 0.9,
  });

  for (const mechanic of props.snapshot.mechanics) {
    const point = toStagePoint(mechanic.center, width, height, arenaRadius);

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

  for (const actor of props.snapshot.actors) {
    const renderState = getRenderActorState(actor.id);
    const renderPosition = renderState?.position ?? actor.position;
    const renderFacing = renderState?.facing ?? actor.facing;
    const point = toStagePoint(renderPosition, width, height, arenaRadius);
    const lineEnd = toStagePoint(
      {
        x: renderPosition.x + Math.cos(renderFacing) * 1.3,
        y: renderPosition.y + Math.sin(renderFacing) * 1.3,
      },
      width,
      height,
      arenaRadius,
    );
    const color =
      actor.slot === null
        ? '#ffffff'
        : getSlotColor(actor.slot, actor.id === props.controlledActorId);
    const numericColor = Number.parseInt(color.replace('#', ''), 16);
    const alpha = actor.alive ? 1 : 0.35;

    graphics.circle(point.x, point.y, actor.id === props.controlledActorId ? 13 : 12).fill({
      color: numericColor,
      alpha,
    });
    graphics.circle(point.x, point.y, actor.id === props.controlledActorId ? 16 : 14).stroke({
      width: actor.id === props.controlledActorId ? 3 : 2,
      color: 0xffffff,
      alpha: actor.id === props.controlledActorId ? 0.82 : 0.24,
    });
    graphics.moveTo(point.x, point.y);
    graphics.lineTo(lineEnd.x, lineEnd.y);
    graphics.stroke({
      width: actor.id === props.controlledActorId ? 3 : 2,
      color: numericColor,
      alpha,
    });

    const label = actorLabels.get(actor.id);

    if (label !== undefined) {
      label.visible = true;
      label.text = actor.slot === null ? '?' : getSlotStageText(actor.slot);
      label.x = point.x;
      label.y = point.y;
      label.alpha = alpha;
    }
  }

  if (shouldContinueAnimating) {
    scheduleDraw();
  }
}

function handleMouseDown(event: MouseEvent): void {
  if ((event.button !== 0 && event.button !== 2) || props.snapshot === null) {
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

  pendingYawDelta += deltaX * DRAG_ROTATION_SENSITIVITY;

  if (dragUpdateFrame !== null) {
    return;
  }

  dragUpdateFrame = requestAnimationFrame(() => {
    dragUpdateFrame = null;

    if (pendingYawDelta === 0) {
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

  const zoomDelta = event.deltaY > 0 ? -0.12 : 0.12;
  emit('cameraZoomChange', clampZoom(props.cameraZoom + zoomDelta));
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
  resizeObserver = new ResizeObserver(() => {
    scheduleDraw();
  });
  resizeObserver.observe(stageRootRef.value);
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', endDrag);
  scheduleDraw();
});

watch(
  () => [
    props.snapshot?.phase ?? 'none',
    props.snapshot?.tick ?? -1,
    props.snapshot?.timeMs ?? -1,
    props.snapshot?.actors.length ?? 0,
    props.snapshot?.mechanics.length ?? 0,
    props.snapshot?.hud.bossCastBar?.startedAt ?? -1,
    props.controlledActorId ?? '',
    props.cameraYaw,
    props.cameraZoom,
    props.operationMode,
  ],
  () => {
    scheduleDraw();
  },
  { flush: 'post' },
);

onBeforeUnmount(() => {
  isUnmounted = true;
  isAppReady = false;
  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', endDrag);
  resizeObserver?.disconnect();
  resizeObserver = null;

  if (drawFrame !== null) {
    cancelAnimationFrame(drawFrame);
    drawFrame = null;
  }

  if (dragUpdateFrame !== null) {
    cancelAnimationFrame(dragUpdateFrame);
    dragUpdateFrame = null;
  }

  app?.destroy(true, {
    children: true,
    texture: true,
  });
  renderActors.clear();
  actorLabels.clear();
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
