<script setup lang="ts">
import { Application, Graphics } from 'pixi.js';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { SimulationSnapshot, Vector2 } from '@ff14arena/shared';

const props = defineProps<{
  snapshot: SimulationSnapshot | null;
}>();

const emit = defineEmits<{
  face: [position: Vector2];
}>();

const rootRef = ref<HTMLDivElement | null>(null);

let app: Application | null = null;
let graphics: Graphics | null = null;

function toStagePoint(point: Vector2, width: number, height: number, arenaRadius: number): Vector2 {
  const scale = Math.min(width, height) / (arenaRadius * 2 + 8);

  return {
    x: width / 2 + point.x * scale,
    y: height / 2 + point.y * scale,
  };
}

function draw(): void {
  if (rootRef.value === null || app === null || graphics === null || props.snapshot === null) {
    return;
  }

  const width = rootRef.value.clientWidth;
  const height = rootRef.value.clientHeight;
  const { arenaRadius, bossTargetRingRadius } = props.snapshot;
  const scale = Math.min(width, height) / (arenaRadius * 2 + 8);
  const center = {
    x: width / 2,
    y: height / 2,
  };

  graphics.clear();

  graphics.circle(center.x, center.y, arenaRadius * scale).fill({ color: 0x1c2727, alpha: 1 });
  graphics
    .circle(center.x, center.y, arenaRadius * scale)
    .stroke({ width: 3, color: 0x84d0c4, alpha: 0.9 });
  graphics.circle(center.x, center.y, bossTargetRingRadius * scale).stroke({
    width: 2,
    color: 0xf0d08b,
    alpha: 0.9,
  });

  for (const mechanic of props.snapshot.mechanics) {
    if (mechanic.kind === 'circle') {
      const point = toStagePoint(mechanic.center, width, height, arenaRadius);
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
      const point = toStagePoint(mechanic.center, width, height, arenaRadius);
      graphics
        .circle(point.x, point.y, mechanic.outerRadius * scale)
        .fill({ color: 0xc45779, alpha: 0.18 });
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

    const point = toStagePoint(mechanic.center, width, height, arenaRadius);
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
    const color = actor.kind === 'bot' ? 0xa7b7d7 : 0xffffff;
    const alpha = actor.alive ? 1 : 0.35;
    graphics.circle(point.x, point.y, 8).fill({ color, alpha });
    graphics.moveTo(point.x, point.y);
    graphics.lineTo(point.x + Math.cos(actor.facing) * 16, point.y + Math.sin(actor.facing) * 16);
    graphics.stroke({ width: 2, color, alpha });
  }
}

function handleClick(event: MouseEvent): void {
  if (rootRef.value === null || props.snapshot === null) {
    return;
  }

  const bounds = rootRef.value.getBoundingClientRect();
  const localX = event.clientX - bounds.left;
  const localY = event.clientY - bounds.top;
  const scale = Math.min(bounds.width, bounds.height) / (props.snapshot.arenaRadius * 2 + 8);

  emit('face', {
    x: (localX - bounds.width / 2) / scale,
    y: (localY - bounds.height / 2) / scale,
  });
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
  draw();
});

watch(
  () => props.snapshot,
  () => {
    draw();
  },
  { deep: true },
);

onBeforeUnmount(() => {
  app?.destroy(true, {
    children: true,
    texture: true,
  });
});
</script>

<template>
  <div ref="rootRef" class="battle-stage" @click="handleClick" />
</template>

<style scoped>
.battle-stage {
  width: 100%;
  height: 100%;
  min-height: 520px;
  border: 1px solid rgba(169, 214, 205, 0.28);
  border-radius: 24px;
  background:
    radial-gradient(circle at top, rgba(80, 144, 132, 0.16), transparent 35%),
    linear-gradient(180deg, rgba(10, 21, 23, 0.96), rgba(7, 12, 15, 0.96));
  overflow: hidden;
}
</style>
