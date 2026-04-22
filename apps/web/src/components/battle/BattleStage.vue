<script setup lang="ts">
import { Application, Graphics } from 'pixi.js';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { SimulationSnapshot, Vector2 } from '@ff14arena/shared';
import { getFacingForCameraYaw } from './camera';

type OperationMode = 'traditional' | 'standard';

const MIN_ZOOM = 0.7;
const MAX_ZOOM = 2.4;
const DRAG_ROTATION_SENSITIVITY = 0.005;
const PLAYER_SCREEN_OFFSET_RATIO = 1 / 6;

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

const rootRef = ref<HTMLDivElement | null>(null);

let app: Application | null = null;
let graphics: Graphics | null = null;
let dragButton: 0 | 2 | null = null;
let lastDragClientX = 0;

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

function getCameraFocus(): Vector2 {
  return getControlledActor()?.position ?? { x: 0, y: 0 };
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
  const baseScale = Math.min(width, height) / (arenaRadius * 2 + 8);
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

function draw(): void {
  if (rootRef.value === null || app === null || graphics === null || props.snapshot === null) {
    return;
  }

  const width = rootRef.value.clientWidth;
  const height = rootRef.value.clientHeight;
  const { arenaRadius, bossTargetRingRadius } = props.snapshot;
  const scale = getWorldScale(width, height, arenaRadius);
  const arenaCenter = toStagePoint({ x: 0, y: 0 }, width, height, arenaRadius);

  graphics.clear();

  graphics
    .circle(arenaCenter.x, arenaCenter.y, arenaRadius * scale)
    .fill({ color: 0x1c2727, alpha: 1 });
  graphics
    .circle(arenaCenter.x, arenaCenter.y, arenaRadius * scale)
    .stroke({ width: 3, color: 0x84d0c4, alpha: 0.9 });
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
        .fill({ color: 0x1c2727, alpha: 1 });
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
  graphics.circle(bossPoint.x, bossPoint.y, 12).fill({ color: 0xf6c66a, alpha: 1 });

  for (const actor of props.snapshot.actors) {
    const point = toStagePoint(actor.position, width, height, arenaRadius);
    const lineEnd = toStagePoint(
      {
        x: actor.position.x + Math.cos(actor.facing) * 1.2,
        y: actor.position.y + Math.sin(actor.facing) * 1.2,
      },
      width,
      height,
      arenaRadius,
    );
    const color =
      actor.id === props.controlledActorId ? 0xfff2b0 : actor.kind === 'bot' ? 0xa7b7d7 : 0xffffff;
    const alpha = actor.alive ? 1 : 0.35;

    graphics
      .circle(point.x, point.y, actor.id === props.controlledActorId ? 9 : 8)
      .fill({ color, alpha });
    graphics.moveTo(point.x, point.y);
    graphics.lineTo(lineEnd.x, lineEnd.y);
    graphics.stroke({ width: actor.id === props.controlledActorId ? 3 : 2, color, alpha });
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

  const nextYaw = props.cameraYaw + deltaX * DRAG_ROTATION_SENSITIVITY;
  emit('cameraYawChange', nextYaw);

  if (dragButton !== 2 || props.operationMode !== 'standard') {
    return;
  }

  emit('faceAngle', getFacingForCameraYaw(nextYaw));
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
  if (rootRef.value === null) {
    return;
  }

  app = new Application();
  await app.init({
    resizeTo: rootRef.value,
    backgroundAlpha: 0,
    antialias: true,
  });
  graphics = new Graphics();
  app.stage.addChild(graphics);
  rootRef.value.appendChild(app.canvas);
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', endDrag);
  draw();
});

watch(
  () => [props.snapshot, props.cameraYaw, props.cameraZoom, props.controlledActorId],
  () => {
    draw();
  },
  { deep: true },
);

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', endDrag);
  app?.destroy(true, {
    children: true,
    texture: true,
  });
});
</script>

<template>
  <div
    ref="rootRef"
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
  width: 100%;
  min-height: 520px;
  height: min(68vh, 760px);
  border-radius: 16px;
  background: rgba(10, 21, 23, 0.92);
  overflow: hidden;
  cursor: grab;
  user-select: none;
}

.battle-stage:active {
  cursor: grabbing;
}
</style>
