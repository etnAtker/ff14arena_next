import type { BattleDefinition, BattleScriptContext } from '@ff14arena/core';
import { INJURY_UP_MULTIPLIER, createFacingTowards, distance } from '@ff14arena/core';
import type { BaseActorSnapshot, MapMarker, PartySlot, StatusId, Vector2 } from '@ff14arena/shared';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { getStatusDisplayName } from '../status-metadata';

type SlapHand = 'left' | 'right';
type ChaosExplosionMode = 'longitude' | 'latitude';
type ChaosExplosionPhase = 'first' | 'second';

interface WanderingBossState {
  chaosCenter: Vector2;
  exdeathCenter: Vector2;
  chaosFacing: number;
  exdeathFacing: number;
  chaosLockedUntil: number;
  exdeathLockedUntil: number;
}

interface BlackHole {
  center: Vector2;
  markerResolveAfterMs: number;
  tetherId: string | null;
}

interface ChaosExplosionState {
  mode: ChaosExplosionMode;
  center: Vector2;
  facing: number;
}

const ARENA_RADIUS = 20;
const BOSS_TARGET_RING_RADIUS = 0;
const CENTER = { x: 0, y: 0 } as const satisfies Vector2;
const ZERO_AT = 3_000;
const EARTHQUAKE_CAST_START_AT = 1_000;
const EARTHQUAKE_CAST_MS = 2_000;
const TELEGRAPH_MS = 500;
const VISUAL_MS = 500;
const MECHANIC_DAMAGE = 1;
const INJURY_DURATION_MS = 3_000;
const COMPLETE_AT = ZERO_AT + 115_000;

const CHAOS_MARKER_RADIUS = 0.8;
const CHAOS_TARGET_RING_RADIUS = 6;
const CHAOS_TARGET_RING_COLOR = '#ef4444';
const EXDEATH_MARKER_RADIUS = 0.8;
const EXDEATH_MARKER_COLOR = '#f97316';
const EXDEATH_TARGET_RING_RADIUS = 4;
const EXDEATH_TARGET_RING_COLOR = '#ef4444';
const REPOSITION_INTERVAL_MS = 1_000;
const CHAOS_STABLE_MARKER_ID = 'kefka_p3_second_chaos';
const EXDEATH_STABLE_MARKER_ID = 'kefka_p3_second_exdeath';

const KEFKA_MARKER_RADIUS = 0.9;
const KEFKA_TARGET_RING_RADIUS = 4;
const KEFKA_TARGET_RING_COLOR = '#ef4444';
const OUTSIDE_BOSS_DISTANCE = ARENA_RADIUS + 5;

const SLAP_SPAWN_TO_CAST_MS = 1_000;
const SLAP_CAST_MS = 4_700;
const SLAP_AOE_INTERVAL_MS = 600;
const SLAP_AOE_RADIUS = 13;
const SLAP_FOLLOWUP_DELAY_MS = 1_200;
const SLAP_FAN_RADIUS = 30;
const SLAP_FAN_ANGLE = Math.PI / 3;
const SLAP_ARM_LENGTH = 4;
const SLAP_ARM_WIDTH = 0.6;
const SLAP_MARKER_COLOR = '#e879f9';

const BLACK_HOLE_RADIUS = 2;
const BLACK_HOLE_DISTANCE = 17;
const BLACK_HOLE_SHOT_DELAY_MS = 7_100;
const BLACK_HOLE_BEAM_LENGTH = 40;
const BLACK_HOLE_BEAM_WIDTH = 2;
const BLACK_HOLE_COLOR = '#111827';
const BLACK_HOLE_BEAM_COLOR = '#a855f7';
const FIRST_TARGET_MARKER_COLOR = '#facc15';
const SECOND_TARGET_MARKER_COLOR = '#a855f7';
const THIRD_TARGET_MARKER_COLOR = '#ef4444';

const THUNDER_CAST_MS = 4_700;
const THUNDER_RADIUS = 5;
const THUNDER_SECOND_DELAY_MS = 3_000;

const CURSE_CAST_MS = 4_700;
const CURSE_RADIUS = 30;
const CURSE_ANGLE = Math.PI;
const CHAOS_EXPLOSION_CAST_MS = 5_000;
const CHAOS_EXPLOSION_SECOND_DELAY_MS = 2_000;
const CHAOS_EXPLOSION_FAN_ANGLE = Math.PI / 2;
const CHAOS_EXPLOSION_FAN_RADIUS = 60;

const TRUE_SELF_SPAWN_TO_CAST_MS = 1_500;
const TRUE_SELF_CAST_MS = 4_000;
const TRUE_SELF_LENGTH = 50;
const TRUE_SELF_WIDTH = 10;

const FIRST_TARGET_STATUS_ID = 'kefka_p3_second_first_target';
const SECOND_TARGET_STATUS_ID = 'kefka_p3_second_second_target';
const THIRD_TARGET_STATUS_ID = 'kefka_p3_second_third_target';
const CHAOS_EARTH_STATUS_ID = 'kefka_p3_second_chaos_earth';
const VOID_EROSION_1_STATUS_ID = 'kefka_p3_second_void_erosion_1';
const VOID_EROSION_2_STATUS_ID = 'kefka_p3_second_void_erosion_2';
const VOID_CORROSION_STATUS_ID = 'kefka_p3_second_void_corrosion';

const TANK_SLOTS = ['MT', 'ST'] as const satisfies readonly PartySlot[];
const HEALER_SLOTS = ['H1', 'H2'] as const satisfies readonly PartySlot[];
const DPS_SLOTS = ['D1', 'D2', 'D3', 'D4'] as const satisfies readonly PartySlot[];

const INITIAL_POSITIONS: Record<PartySlot, Vector2> = {
  MT: { x: -4.2, y: 12 },
  ST: { x: -3, y: 12 },
  H1: { x: -1.8, y: 12 },
  H2: { x: -0.6, y: 12 },
  D1: { x: 0.6, y: 12 },
  D2: { x: 1.8, y: 12 },
  D3: { x: 3, y: 12 },
  D4: { x: 4.2, y: 12 },
};

const MARKER_CORNER_DISTANCE = 12;
const MARKER_COLORS = {
  red: '#ef4444',
  yellow: '#f4d35e',
  cyan: '#7dd3fc',
  purple: '#a78bfa',
} as const;

const KEFKA_MAP_MARKERS: MapMarker[] = [
  {
    label: 'A',
    shape: 'circle',
    color: MARKER_COLORS.red,
    position: { x: 0, y: -MARKER_CORNER_DISTANCE },
    radius: 1.25,
  },
  {
    label: '2',
    shape: 'square',
    color: MARKER_COLORS.yellow,
    position: { x: MARKER_CORNER_DISTANCE, y: -MARKER_CORNER_DISTANCE },
    size: 2.2,
  },
  {
    label: 'B',
    shape: 'circle',
    color: MARKER_COLORS.yellow,
    position: { x: MARKER_CORNER_DISTANCE, y: 0 },
    radius: 1.25,
  },
  {
    label: '3',
    shape: 'square',
    color: MARKER_COLORS.cyan,
    position: { x: MARKER_CORNER_DISTANCE, y: MARKER_CORNER_DISTANCE },
    size: 2.2,
  },
  {
    label: 'C',
    shape: 'circle',
    color: MARKER_COLORS.cyan,
    position: { x: 0, y: MARKER_CORNER_DISTANCE },
    radius: 1.25,
  },
  {
    label: '4',
    shape: 'square',
    color: MARKER_COLORS.purple,
    position: { x: -MARKER_CORNER_DISTANCE, y: MARKER_CORNER_DISTANCE },
    size: 2.2,
  },
  {
    label: 'D',
    shape: 'circle',
    color: MARKER_COLORS.purple,
    position: { x: -MARKER_CORNER_DISTANCE, y: 0 },
    radius: 1.25,
  },
  {
    label: '1',
    shape: 'square',
    color: MARKER_COLORS.red,
    position: { x: -MARKER_CORNER_DISTANCE, y: -MARKER_CORNER_DISTANCE },
    size: 2.2,
  },
];

function t(offsetMs: number): number {
  return ZERO_AT + offsetMs;
}

function shuffle<T>(values: readonly T[]): T[] {
  const shuffled = [...values];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }

  return shuffled;
}

function getActorBySlot(actors: BaseActorSnapshot[], slot: PartySlot): BaseActorSnapshot {
  const actor = actors.find((candidate) => candidate.slot === slot);

  if (actor === undefined) {
    throw new Error(`missing actor for slot ${slot}`);
  }

  return actor;
}

function getActorById(actors: BaseActorSnapshot[], actorId: string): BaseActorSnapshot | null {
  return actors.find((actor) => actor.id === actorId) ?? null;
}

function getFreshActor(ctx: BattleScriptContext, actorId: string): BaseActorSnapshot | null {
  return getActorById(ctx.select.allPlayers(), actorId);
}

function hasStatus(actor: BaseActorSnapshot, statusId: StatusId): boolean {
  return actor.statuses.some((status) => status.id === statusId);
}

function getActorsInsideCircle(
  actors: BaseActorSnapshot[],
  center: Vector2,
  radius: number,
): BaseActorSnapshot[] {
  return actors.filter(
    (actor) => actor.mechanicActive && distance(actor.position, center) <= radius,
  );
}

function normalizeAngle(angle: number): number {
  const normalized = angle % (Math.PI * 2);

  return normalized < 0 ? normalized + Math.PI * 2 : normalized;
}

function getAngleDiff(left: number, right: number): number {
  const diff = Math.abs(normalizeAngle(left) - normalizeAngle(right)) % (Math.PI * 2);

  return diff > Math.PI ? Math.PI * 2 - diff : diff;
}

function isActorInsideFan(
  actor: BaseActorSnapshot,
  center: Vector2,
  direction: number,
  angle: number,
  radius: number,
): boolean {
  if (!actor.mechanicActive || distance(actor.position, center) > radius) {
    return false;
  }

  if (distance(actor.position, center) <= 0.0001) {
    return true;
  }

  return (
    getAngleDiff(Math.atan2(actor.position.y - center.y, actor.position.x - center.x), direction) <=
    angle / 2
  );
}

function isActorInsideRectangle(
  actor: BaseActorSnapshot,
  source: Vector2,
  direction: number,
  length: number,
  width: number,
): boolean {
  if (!actor.mechanicActive) {
    return false;
  }

  const relative = {
    x: actor.position.x - source.x,
    y: actor.position.y - source.y,
  };
  const forward = {
    x: Math.cos(direction),
    y: Math.sin(direction),
  };
  const projection = relative.x * forward.x + relative.y * forward.y;

  if (projection < 0 || projection > length) {
    return false;
  }

  const lateral = Math.abs(relative.x * -forward.y + relative.y * forward.x);

  return lateral <= width / 2;
}

function createPointOnDirection(direction: number, radius: number): Vector2 {
  return {
    x: Math.cos(direction) * radius,
    y: Math.sin(direction) * radius,
  };
}

function createPointFromLocal(origin: Vector2, facing: number, local: Vector2): Vector2 {
  const right = { x: Math.cos(facing + Math.PI / 2), y: Math.sin(facing + Math.PI / 2) };
  const forward = { x: Math.cos(facing), y: Math.sin(facing) };

  return {
    x: origin.x + right.x * local.x + forward.x * local.y,
    y: origin.y + right.y * local.x + forward.y * local.y,
  };
}

function createPointFromArenaLocal(northDirection: number, local: Vector2): Vector2 {
  const north = { x: Math.cos(northDirection), y: Math.sin(northDirection) };
  const east = {
    x: Math.cos(northDirection + Math.PI / 2),
    y: Math.sin(northDirection + Math.PI / 2),
  };

  return {
    x: CENTER.x + east.x * local.x - north.x * local.y,
    y: CENTER.y + east.y * local.x - north.y * local.y,
  };
}

function applyStatus(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  statusId: StatusId,
  durationMs: number,
): void {
  ctx.status.apply([actor.id], statusId, durationMs, {
    name: getStatusDisplayName(statusId),
  });
}

function applySecondTrickDeath(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  sourceLabel: string,
): void {
  const freshActor = getFreshActor(ctx, actor.id);

  if (freshActor === null || !freshActor.mechanicActive) {
    return;
  }

  if (hasStatus(freshActor, CHAOS_EARTH_STATUS_ID)) {
    ctx.status.remove([freshActor.id], CHAOS_EARTH_STATUS_ID);
    ctx.timeline.after(1_000, () => {
      for (const target of ctx.select.allPlayers()) {
        if (target.id !== freshActor.id) {
          applySecondTrickDamage(ctx, target, '混沌之土');
        }
      }
    });
    return;
  }

  ctx.damage.kill([freshActor.id], sourceLabel);
}

function applySecondTrickDamage(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  sourceLabel: string,
): void {
  const freshActor = getFreshActor(ctx, actor.id);

  if (freshActor === null || !freshActor.mechanicActive) {
    return;
  }

  if (hasStatus(freshActor, 'injury_up')) {
    applySecondTrickDeath(ctx, freshActor, sourceLabel);
    return;
  }

  ctx.damage.apply([freshActor.id], MECHANIC_DAMAGE, sourceLabel);
  ctx.status.apply([freshActor.id], 'injury_up', INJURY_DURATION_MS, {
    multiplier: INJURY_UP_MULTIPLIER,
    name: getStatusDisplayName('injury_up'),
  });
}

function assignInitialStatuses(ctx: BattleScriptContext): void {
  const actors = shuffle(ctx.select.allPlayers());
  const groups = [
    {
      statusId: FIRST_TARGET_STATUS_ID,
      count: 3,
      durationMs: 72_000,
      markerColor: FIRST_TARGET_MARKER_COLOR,
    },
    {
      statusId: SECOND_TARGET_STATUS_ID,
      count: 3,
      durationMs: 106_000,
      markerColor: SECOND_TARGET_MARKER_COLOR,
    },
    {
      statusId: THIRD_TARGET_STATUS_ID,
      count: 2,
      durationMs: 139_000,
      markerColor: THIRD_TARGET_MARKER_COLOR,
    },
  ] as const;
  let cursor = 0;

  for (const group of groups) {
    for (const [index, actor] of actors.slice(cursor, cursor + group.count).entries()) {
      applyStatus(ctx, actor, group.statusId, group.durationMs);
      applyStatus(ctx, actor, CHAOS_EARTH_STATUS_ID, group.durationMs);
      ctx.spawn.actorMarker({
        label: `${index + 1}`,
        target: actor,
        markerShape: 'numberCircle',
        color: group.markerColor,
        resolveAfterMs: group.durationMs,
      });
    }
    cursor += group.count;
  }
}

function calculateFollowerCenter(current: Vector2, target: Vector2, offset: number): Vector2 {
  const targetDistance = distance(current, target);

  if (targetDistance <= offset) {
    return { ...current };
  }

  const scaleFromTarget = offset / targetDistance;

  return {
    x: target.x + (current.x - target.x) * scaleFromTarget,
    y: target.y + (current.y - target.y) * scaleFromTarget,
  };
}

function getWanderingBossState(ctx: BattleScriptContext): WanderingBossState {
  return (
    ctx.state.getValue<WanderingBossState>('kefkaP3Second:wanderingBosses') ?? {
      chaosCenter: CENTER,
      exdeathCenter: CENTER,
      chaosFacing: 0,
      exdeathFacing: 0,
      chaosLockedUntil: 0,
      exdeathLockedUntil: 0,
    }
  );
}

function setWanderingBossState(ctx: BattleScriptContext, state: WanderingBossState): void {
  ctx.state.setValue('kefkaP3Second:wanderingBosses', state);
}

function spawnChaosMarker(
  ctx: BattleScriptContext,
  center: Vector2,
  resolveAfterMs: number,
  direction = getWanderingBossState(ctx).chaosFacing,
): void {
  ctx.spawn.fieldMarker({
    label: '卡奥斯',
    center,
    shape: 'enemy',
    stableId: CHAOS_STABLE_MARKER_ID,
    radius: CHAOS_MARKER_RADIUS,
    direction,
    targetRingRadius: CHAOS_TARGET_RING_RADIUS,
    targetRingColor: CHAOS_TARGET_RING_COLOR,
    resolveAfterMs,
  });
}

function spawnExdeathMarker(
  ctx: BattleScriptContext,
  center: Vector2,
  resolveAfterMs: number,
  direction = getWanderingBossState(ctx).exdeathFacing,
): void {
  ctx.spawn.fieldMarker({
    label: '艾克斯迪斯',
    center,
    shape: 'enemy',
    stableId: EXDEATH_STABLE_MARKER_ID,
    radius: EXDEATH_MARKER_RADIUS,
    direction,
    color: EXDEATH_MARKER_COLOR,
    targetRingRadius: EXDEATH_TARGET_RING_RADIUS,
    targetRingColor: EXDEATH_TARGET_RING_COLOR,
    resolveAfterMs,
  });
}

function repositionWanderingBosses(ctx: BattleScriptContext): void {
  const state = getWanderingBossState(ctx);
  const battleTime = ctx.state.getBattleTime();
  let nextState = state;

  if (battleTime >= state.chaosLockedUntil) {
    const st = getActorBySlot(ctx.select.allPlayers(), 'ST');
    const chaosCenter = calculateFollowerCenter(
      state.chaosCenter,
      st.position,
      CHAOS_TARGET_RING_RADIUS,
    );
    const chaosFacing =
      distance(chaosCenter, st.position) <= 0.0001
        ? state.chaosFacing
        : createFacingTowards(chaosCenter, st.position);
    nextState = {
      ...nextState,
      chaosCenter,
      chaosFacing,
    };
    spawnChaosMarker(ctx, nextState.chaosCenter, REPOSITION_INTERVAL_MS, chaosFacing);
  }

  if (battleTime >= state.exdeathLockedUntil) {
    const mt = getActorBySlot(ctx.select.allPlayers(), 'MT');
    const exdeathCenter = calculateFollowerCenter(
      state.exdeathCenter,
      mt.position,
      EXDEATH_TARGET_RING_RADIUS,
    );
    const exdeathFacing =
      distance(exdeathCenter, mt.position) <= 0.0001
        ? state.exdeathFacing
        : createFacingTowards(exdeathCenter, mt.position);
    nextState = {
      ...nextState,
      exdeathCenter,
      exdeathFacing,
    };
    spawnExdeathMarker(ctx, nextState.exdeathCenter, REPOSITION_INTERVAL_MS, exdeathFacing);
  }

  setWanderingBossState(ctx, nextState);
}

function lockChaosUntil(
  ctx: BattleScriptContext,
  lockedUntil: number,
  direction = getWanderingBossState(ctx).chaosFacing,
): void {
  const state = getWanderingBossState(ctx);
  setWanderingBossState(ctx, { ...state, chaosFacing: direction, chaosLockedUntil: lockedUntil });
}

function lockExdeathUntil(
  ctx: BattleScriptContext,
  lockedUntil: number,
  direction = getWanderingBossState(ctx).exdeathFacing,
): void {
  const state = getWanderingBossState(ctx);
  setWanderingBossState(ctx, {
    ...state,
    exdeathFacing: direction,
    exdeathLockedUntil: lockedUntil,
  });
}

function selectNearestActor(
  actors: BaseActorSnapshot[],
  center: Vector2,
): BaseActorSnapshot | null {
  return (
    actors
      .filter((actor) => actor.mechanicActive)
      .sort((left, right) => {
        const distanceDiff = distance(left.position, center) - distance(right.position, center);

        if (Math.abs(distanceDiff) > 0.0001) {
          return distanceDiff;
        }

        return PARTY_SLOT_ORDER.indexOf(left.slot!) - PARTY_SLOT_ORDER.indexOf(right.slot!);
      })[0] ?? null
  );
}

function selectRandomActorBySlots(
  actors: BaseActorSnapshot[],
  slots: readonly PartySlot[],
): BaseActorSnapshot | null {
  return (
    shuffle(actors.filter((actor) => actor.mechanicActive && slots.includes(actor.slot!)))[0] ??
    null
  );
}

function spawnKefkaMarker(ctx: BattleScriptContext, center: Vector2, resolveAfterMs: number): void {
  ctx.spawn.fieldMarker({
    label: '凯夫卡',
    center,
    shape: 'enemy',
    radius: KEFKA_MARKER_RADIUS,
    direction: createFacingTowards(center, CENTER),
    color: '#c084fc',
    targetRingRadius: KEFKA_TARGET_RING_RADIUS,
    targetRingColor: KEFKA_TARGET_RING_COLOR,
    resolveAfterMs,
  });
}

function createOutsideKefkaPosition(): Vector2 {
  const direction = Math.floor(Math.random() * 8) * (Math.PI / 4);

  return createPointOnDirection(direction, OUTSIDE_BOSS_DISTANCE);
}

function calculateSlapAoeCenter(kefkaPosition: Vector2, hand: SlapHand, localY: number): Vector2 {
  const kefkaDirection = createFacingTowards(CENTER, kefkaPosition);
  const localX = hand === 'right' ? -10 : 10;

  return createPointFromArenaLocal(kefkaDirection, { x: localX, y: localY });
}

function spawnCircleDamageWithTelegraph(
  ctx: BattleScriptContext,
  label: string,
  center: Vector2,
  radius: number,
  resolveAt: number,
  damage: 'normal' | 'lethal',
): void {
  ctx.timeline.at(resolveAt - TELEGRAPH_MS, () => {
    ctx.spawn.circleTelegraph({
      label,
      center,
      radius,
      resolveAfterMs: TELEGRAPH_MS,
    });
  });
  ctx.timeline.at(resolveAt, () => {
    for (const hit of getActorsInsideCircle(ctx.select.allPlayers(), center, radius)) {
      if (damage === 'normal') {
        applySecondTrickDamage(ctx, hit, label);
      } else {
        applySecondTrickDeath(ctx, hit, label);
      }
    }
  });
}

function resolveFanDamage(
  ctx: BattleScriptContext,
  label: string,
  direction: number,
  damage: 'normal' | 'lethal',
  requiredPlayers?: number,
): void {
  const hits = ctx.select
    .allPlayers()
    .filter((actor) => isActorInsideFan(actor, CENTER, direction, SLAP_FAN_ANGLE, SLAP_FAN_RADIUS));

  if (requiredPlayers !== undefined && hits.length < requiredPlayers) {
    ctx.state.fail(`${label}分摊人数不足`);
    for (const hit of hits) {
      applySecondTrickDeath(ctx, hit, `${label}分摊人数不足`);
    }
    return;
  }

  for (const hit of hits) {
    if (damage === 'normal') {
      applySecondTrickDamage(ctx, hit, label);
    } else {
      applySecondTrickDeath(ctx, hit, label);
    }
  }
}

function scheduleSlap(
  ctx: BattleScriptContext,
  spawnAt: number,
  castDelayMs = SLAP_SPAWN_TO_CAST_MS,
): void {
  const position = createOutsideKefkaPosition();
  const facing = createFacingTowards(position, CENTER);
  const hand: SlapHand = Math.random() < 0.5 ? 'left' : 'right';
  const castStartAt = spawnAt + castDelayMs;
  const resolveStartAt = castStartAt + SLAP_CAST_MS;
  const followupAt = resolveStartAt + SLAP_AOE_INTERVAL_MS * 2 + SLAP_FOLLOWUP_DELAY_MS;
  const disappearAt = followupAt + 1_000;

  ctx.timeline.at(spawnAt, () => {
    spawnKefkaMarker(ctx, position, disappearAt - spawnAt);
  });

  ctx.timeline.at(castStartAt, () => {
    const handSign = hand === 'right' ? 1 : -1;
    const armCenter = createPointFromLocal(position, facing, {
      x: handSign * 1.2,
      y: 0,
    });

    ctx.boss.cast(`kefka_p3_second_slap_${spawnAt}`, '响亮亮耳光', SLAP_CAST_MS);
    ctx.spawn.rectangleTelegraph({
      label: '响亮亮耳光手臂',
      center: armCenter,
      direction: facing + handSign * (Math.PI / 2),
      length: SLAP_ARM_LENGTH,
      width: SLAP_ARM_WIDTH,
      color: SLAP_MARKER_COLOR,
      resolveAfterMs: SLAP_CAST_MS,
    });
  });

  for (const [index, localY] of [-10, 0, 10].entries()) {
    const center = calculateSlapAoeCenter(position, hand, localY);
    spawnCircleDamageWithTelegraph(
      ctx,
      '响亮亮耳光范围',
      center,
      SLAP_AOE_RADIUS,
      resolveStartAt + index * SLAP_AOE_INTERVAL_MS,
      'normal',
    );
  }

  ctx.timeline.at(followupAt - TELEGRAPH_MS, () => {
    if (hand === 'right') {
      const target = shuffle(ctx.select.allPlayers().filter((actor) => actor.mechanicActive))[0];

      if (target === undefined) {
        return;
      }

      const direction = createFacingTowards(CENTER, target.position);
      ctx.state.setValue(`kefkaP3Second:slapStack:${spawnAt}`, target.id);
      ctx.spawn.fanTelegraph({
        label: '响亮亮耳光分摊',
        center: CENTER,
        direction,
        angle: SLAP_FAN_ANGLE,
        radius: SLAP_FAN_RADIUS,
        resolveAfterMs: TELEGRAPH_MS,
      });
    } else {
      const actors = ctx.select.allPlayers();
      const targets = [
        selectRandomActorBySlots(actors, TANK_SLOTS),
        selectRandomActorBySlots(actors, HEALER_SLOTS),
        selectRandomActorBySlots(actors, DPS_SLOTS),
      ].filter((actor): actor is BaseActorSnapshot => actor !== null);

      ctx.state.setValue(
        `kefkaP3Second:slapSpread:${spawnAt}`,
        targets.map((target) => target.id),
      );

      for (const target of targets) {
        ctx.spawn.fanTelegraph({
          label: '响亮亮耳光扇形',
          center: CENTER,
          direction: createFacingTowards(CENTER, target.position),
          angle: SLAP_FAN_ANGLE,
          radius: SLAP_FAN_RADIUS,
          resolveAfterMs: TELEGRAPH_MS,
        });
      }
    }
  });

  ctx.timeline.at(followupAt, () => {
    if (hand === 'right') {
      const targetId = ctx.state.getValue<string>(`kefkaP3Second:slapStack:${spawnAt}`);
      const target = targetId === undefined ? null : getFreshActor(ctx, targetId);

      if (target === null || !target.mechanicActive) {
        return;
      }

      resolveFanDamage(
        ctx,
        '响亮亮耳光分摊',
        createFacingTowards(CENTER, target.position),
        'normal',
        8,
      );
      return;
    }

    const targetIds = ctx.state.getValue<string[]>(`kefkaP3Second:slapSpread:${spawnAt}`) ?? [];

    for (const targetId of targetIds) {
      const target = getFreshActor(ctx, targetId);

      if (target !== null && target.mechanicActive) {
        resolveFanDamage(
          ctx,
          '响亮亮耳光扇形',
          createFacingTowards(CENTER, target.position),
          'normal',
        );
      }
    }
  });
}

function createBlackHoleCenters(): Vector2[] {
  const cardinalDirections = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];

  return shuffle(cardinalDirections)
    .slice(0, 3)
    .map((direction) => createPointOnDirection(direction, BLACK_HOLE_DISTANCE));
}

function spawnBlackHoleMarker(
  ctx: BattleScriptContext,
  center: Vector2,
  resolveAfterMs: number,
): void {
  ctx.spawn.fieldMarker({
    label: '黑洞',
    center,
    shape: 'circle',
    radius: BLACK_HOLE_RADIUS,
    color: BLACK_HOLE_COLOR,
    resolveAfterMs,
  });
}

function spawnBlackHoleTether(
  ctx: BattleScriptContext,
  hole: BlackHole,
  resolveAfterMs: number,
): string | null {
  const target = shuffle(ctx.select.allPlayers().filter((actor) => actor.mechanicActive))[0];

  if (target === undefined) {
    return null;
  }

  const tether = ctx.spawn.tether({
    label: '黑洞连线',
    target,
    sourcePosition: hole.center,
    allowTransfer: true,
    allowDeadRetarget: true,
    preventTargetHoldingOtherTether: false,
    resolveAfterMs: resolveAfterMs + 50,
  });

  return tether.id;
}

function applyVoidErosion(ctx: BattleScriptContext, actor: BaseActorSnapshot): void {
  const freshActor = getFreshActor(ctx, actor.id);

  if (freshActor === null || !freshActor.mechanicActive) {
    return;
  }

  if (hasStatus(freshActor, VOID_CORROSION_STATUS_ID)) {
    applySecondTrickDeath(ctx, freshActor, '无之腐蚀');
    return;
  }

  if (hasStatus(freshActor, VOID_EROSION_2_STATUS_ID)) {
    ctx.status.remove([freshActor.id], VOID_EROSION_2_STATUS_ID);
    applyStatus(ctx, freshActor, VOID_CORROSION_STATUS_ID, 999_000);
    return;
  }

  if (hasStatus(freshActor, VOID_EROSION_1_STATUS_ID)) {
    ctx.status.remove([freshActor.id], VOID_EROSION_1_STATUS_ID);
    applyStatus(ctx, freshActor, VOID_EROSION_2_STATUS_ID, 999_000);
    return;
  }

  applyStatus(ctx, freshActor, VOID_EROSION_1_STATUS_ID, 999_000);
}

function lockBlackHoleShot(ctx: BattleScriptContext, hole: BlackHole, shotKey: string): void {
  if (hole.tetherId === null) {
    return;
  }

  const tether = ctx.mechanics
    .all()
    .find((mechanic) => mechanic.kind === 'tether' && mechanic.id === hole.tetherId);

  if (tether === undefined || tether.kind !== 'tether') {
    return;
  }

  const target = getFreshActor(ctx, tether.targetId);

  if (target === null || !target.mechanicActive) {
    return;
  }

  const direction = createFacingTowards(hole.center, target.position);
  ctx.state.setValue(`kefkaP3Second:blackHoleShot:${shotKey}`, direction);
  ctx.spawn.rectangleTelegraph({
    label: '黑洞射线',
    center: hole.center,
    direction,
    length: BLACK_HOLE_BEAM_LENGTH,
    width: BLACK_HOLE_BEAM_WIDTH,
    color: BLACK_HOLE_BEAM_COLOR,
    resolveAfterMs: VISUAL_MS,
  });
}

function resolveBlackHoleShot(ctx: BattleScriptContext, hole: BlackHole, shotKey: string): void {
  const direction = ctx.state.getValue<number>(`kefkaP3Second:blackHoleShot:${shotKey}`);

  if (direction === undefined) {
    return;
  }

  for (const hit of ctx.select
    .allPlayers()
    .filter((actor) =>
      isActorInsideRectangle(
        actor,
        hole.center,
        direction,
        BLACK_HOLE_BEAM_LENGTH,
        BLACK_HOLE_BEAM_WIDTH,
      ),
    )) {
    applyVoidErosion(ctx, hit);
  }
}

function scheduleBlackHoleShot(
  ctx: BattleScriptContext,
  hole: BlackHole,
  resolveAt: number,
  shotKey: string,
): void {
  ctx.timeline.at(resolveAt - TELEGRAPH_MS, () => {
    lockBlackHoleShot(ctx, hole, shotKey);
  });
  ctx.timeline.at(resolveAt, () => {
    resolveBlackHoleShot(ctx, hole, shotKey);
  });
}

function scheduleFirstBlackHoles(ctx: BattleScriptContext): void {
  const castStartAt = t(16_500);
  const spawnAt = castStartAt + 2_700;

  ctx.timeline.at(castStartAt, () => {
    ctx.boss.cast('kefka_p3_second_black_hole_1', '黑洞', 2_700);
  });

  ctx.timeline.at(spawnAt, () => {
    const firstHoleIndex = Math.floor(Math.random() * 3);
    const holes = createBlackHoleCenters().map((center, index): BlackHole => {
      const markerResolveAfterMs =
        index === firstHoleIndex
          ? BLACK_HOLE_SHOT_DELAY_MS + 100
          : BLACK_HOLE_SHOT_DELAY_MS * 2 + 100;
      const hole: BlackHole = {
        center,
        markerResolveAfterMs,
        tetherId: null,
      };
      spawnBlackHoleMarker(ctx, center, markerResolveAfterMs);
      return hole;
    });
    const firstHole = holes[firstHoleIndex];

    if (firstHole === undefined) {
      return;
    }

    firstHole.tetherId = spawnBlackHoleTether(ctx, firstHole, BLACK_HOLE_SHOT_DELAY_MS);

    scheduleBlackHoleShot(ctx, firstHole, spawnAt + BLACK_HOLE_SHOT_DELAY_MS, 'first:0');
    ctx.timeline.after(BLACK_HOLE_SHOT_DELAY_MS, () => {
      for (const hole of holes.filter((candidate) => candidate !== firstHole)) {
        hole.tetherId = spawnBlackHoleTether(ctx, hole, BLACK_HOLE_SHOT_DELAY_MS);
      }
    });

    holes
      .filter((candidate) => candidate !== firstHole)
      .forEach((hole, index) => {
        scheduleBlackHoleShot(
          ctx,
          hole,
          spawnAt + BLACK_HOLE_SHOT_DELAY_MS * 2,
          `first:${index + 1}`,
        );
      });
  });
}

function schedulePersistentBlackHoles(
  ctx: BattleScriptContext,
  spawnAt: number,
  shotKeyPrefix: string,
): void {
  ctx.timeline.at(spawnAt, () => {
    const holes = createBlackHoleCenters().map((center): BlackHole => {
      const hole: BlackHole = {
        center,
        markerResolveAfterMs: BLACK_HOLE_SHOT_DELAY_MS * 3 + 100,
        tetherId: null,
      };
      spawnBlackHoleMarker(ctx, center, hole.markerResolveAfterMs);
      hole.tetherId = spawnBlackHoleTether(ctx, hole, BLACK_HOLE_SHOT_DELAY_MS * 3);
      return hole;
    });

    for (let shotIndex = 1; shotIndex <= 3; shotIndex += 1) {
      holes.forEach((hole, holeIndex) => {
        scheduleBlackHoleShot(
          ctx,
          hole,
          spawnAt + BLACK_HOLE_SHOT_DELAY_MS * shotIndex,
          `${shotKeyPrefix}:${shotIndex}:${holeIndex}`,
        );
      });
    }
  });
}

function scheduleThunder(ctx: BattleScriptContext, castStartAt: number, actionId: string): void {
  const firstResolveAt = castStartAt + THUNDER_CAST_MS;
  const secondResolveAt = firstResolveAt + THUNDER_SECOND_DELAY_MS;
  const unlockAt = secondResolveAt + 1_000;

  ctx.timeline.at(castStartAt, () => {
    lockExdeathUntil(ctx, unlockAt);
    spawnExdeathMarker(ctx, getWanderingBossState(ctx).exdeathCenter, unlockAt - castStartAt);
    ctx.boss.cast(actionId, '暴雷', THUNDER_CAST_MS);
  });

  for (const resolveAt of [firstResolveAt, secondResolveAt]) {
    ctx.timeline.at(resolveAt - TELEGRAPH_MS, () => {
      const center = getWanderingBossState(ctx).exdeathCenter;
      const target = selectNearestActor(ctx.select.allPlayers(), center);

      if (target === null) {
        return;
      }

      const direction = createFacingTowards(center, target.position);
      lockExdeathUntil(ctx, unlockAt, direction);
      spawnExdeathMarker(ctx, center, unlockAt - (resolveAt - TELEGRAPH_MS), direction);
      ctx.state.setValue(`kefkaP3Second:thunder:${resolveAt}`, target.id);
      ctx.spawn.circleTelegraph({
        label: '暴雷范围',
        center: target.position,
        radius: THUNDER_RADIUS,
        resolveAfterMs: TELEGRAPH_MS,
      });
    });
    ctx.timeline.at(resolveAt, () => {
      const targetId = ctx.state.getValue<string>(`kefkaP3Second:thunder:${resolveAt}`);
      const target = targetId === undefined ? null : getFreshActor(ctx, targetId);

      if (target === null || !target.mechanicActive) {
        return;
      }

      for (const hit of getActorsInsideCircle(
        ctx.select.allPlayers(),
        target.position,
        THUNDER_RADIUS,
      )) {
        if (hit.slot === 'MT' || hit.slot === 'ST') {
          applySecondTrickDamage(ctx, hit, '暴雷');
        } else {
          applySecondTrickDeath(ctx, hit, '被暴雷命中');
        }
      }
    });
  }
}

function scheduleCurse(ctx: BattleScriptContext, castStartAt: number, actionId: string): void {
  const resolveAt = castStartAt + CURSE_CAST_MS;
  const unlockAt = resolveAt + 1_000;

  ctx.timeline.at(castStartAt, () => {
    const state = getWanderingBossState(ctx);
    const target = shuffle(ctx.select.allPlayers().filter((actor) => actor.mechanicActive))[0];

    if (target === undefined) {
      return;
    }

    const direction = createFacingTowards(state.chaosCenter, target.position);

    lockChaosUntil(ctx, unlockAt, direction);
    spawnChaosMarker(ctx, state.chaosCenter, unlockAt - castStartAt, direction);
    ctx.state.setValue(`kefkaP3Second:curse:${castStartAt}`, {
      center: state.chaosCenter,
      direction,
      targetId: target.id,
    });
    ctx.boss.cast(actionId, '诅咒敕令', CURSE_CAST_MS);
  });

  ctx.timeline.at(resolveAt - TELEGRAPH_MS, () => {
    const locked = ctx.state.getValue<{ center: Vector2; direction: number; targetId: string }>(
      `kefkaP3Second:curse:${castStartAt}`,
    );

    if (locked === undefined) {
      return;
    }

    ctx.spawn.fanTelegraph({
      label: '诅咒敕令',
      center: locked.center,
      direction: locked.direction,
      angle: CURSE_ANGLE,
      radius: CURSE_RADIUS,
      resolveAfterMs: TELEGRAPH_MS,
    });
  });

  ctx.timeline.at(resolveAt, () => {
    const locked = ctx.state.getValue<{ center: Vector2; direction: number; targetId: string }>(
      `kefkaP3Second:curse:${castStartAt}`,
    );

    if (locked === undefined) {
      return;
    }

    for (const hit of ctx.select
      .allPlayers()
      .filter((actor) =>
        isActorInsideFan(actor, locked.center, locked.direction, CURSE_ANGLE, CURSE_RADIUS),
      )) {
      applySecondTrickDeath(ctx, hit, '诅咒敕令');
    }
  });
}

function getChaosExplosionActionName(mode: ChaosExplosionMode): string {
  return mode === 'longitude' ? '经度聚爆' : '纬度聚爆';
}

function getChaosExplosionDirections(
  state: ChaosExplosionState,
  phase: ChaosExplosionPhase,
): readonly [number, number] {
  const shouldResolveFrontBack =
    state.mode === 'longitude' ? phase === 'first' : phase === 'second';

  if (shouldResolveFrontBack) {
    return [state.facing, state.facing + Math.PI];
  }

  return [state.facing - Math.PI / 2, state.facing + Math.PI / 2];
}

function spawnChaosExplosionTelegraphs(
  ctx: BattleScriptContext,
  state: ChaosExplosionState,
  phase: ChaosExplosionPhase,
): void {
  const actionName = getChaosExplosionActionName(state.mode);

  for (const direction of getChaosExplosionDirections(state, phase)) {
    ctx.spawn.fanTelegraph({
      label: `${actionName}范围`,
      center: state.center,
      direction,
      angle: CHAOS_EXPLOSION_FAN_ANGLE,
      radius: CHAOS_EXPLOSION_FAN_RADIUS,
      resolveAfterMs: TELEGRAPH_MS,
    });
  }
}

function resolveChaosExplosion(
  ctx: BattleScriptContext,
  state: ChaosExplosionState,
  phase: ChaosExplosionPhase,
): void {
  const hitActorIds = new Set<string>();

  for (const direction of getChaosExplosionDirections(state, phase)) {
    for (const hit of ctx.select
      .allPlayers()
      .filter((actor) =>
        isActorInsideFan(
          actor,
          state.center,
          direction,
          CHAOS_EXPLOSION_FAN_ANGLE,
          CHAOS_EXPLOSION_FAN_RADIUS,
        ),
      )) {
      hitActorIds.add(hit.id);
    }
  }

  for (const hitActorId of hitActorIds) {
    const hit = getFreshActor(ctx, hitActorId);

    if (hit !== null) {
      applySecondTrickDeath(ctx, hit, '被扇形命中');
    }
  }
}

function scheduleChaosExplosion(
  ctx: BattleScriptContext,
  castStartAt: number,
  actionId: string,
): void {
  const firstResolveAt = castStartAt + CHAOS_EXPLOSION_CAST_MS;
  const secondResolveAt = firstResolveAt + CHAOS_EXPLOSION_SECOND_DELAY_MS;
  const unlockAt = secondResolveAt + 1_000;
  const stateKey = `kefkaP3Second:chaosExplosion:${castStartAt}`;

  ctx.timeline.at(castStartAt, () => {
    const st = getActorBySlot(ctx.select.allPlayers(), 'ST');
    const bossState = getWanderingBossState(ctx);
    const mode: ChaosExplosionMode = Math.random() < 0.5 ? 'longitude' : 'latitude';
    const center = { ...bossState.chaosCenter };
    const facing =
      distance(st.position, center) <= 0.0001 ? 0 : createFacingTowards(center, st.position);
    const explosionState: ChaosExplosionState = {
      mode,
      center,
      facing,
    };

    lockChaosUntil(ctx, unlockAt, facing);
    spawnChaosMarker(ctx, center, unlockAt - castStartAt, facing);
    ctx.state.setValue(stateKey, explosionState);
    ctx.boss.cast(actionId, getChaosExplosionActionName(mode), CHAOS_EXPLOSION_CAST_MS);
  });

  for (const [phase, resolveAt] of [
    ['first', firstResolveAt],
    ['second', secondResolveAt],
  ] as const) {
    ctx.timeline.at(resolveAt - TELEGRAPH_MS, () => {
      const state = ctx.state.getValue<ChaosExplosionState>(stateKey);

      if (state !== undefined) {
        spawnChaosExplosionTelegraphs(ctx, state, phase);
      }
    });
    ctx.timeline.at(resolveAt, () => {
      const state = ctx.state.getValue<ChaosExplosionState>(stateKey);

      if (state !== undefined) {
        resolveChaosExplosion(ctx, state, phase);
      }
    });
  }
}

function scheduleTrueSelf(ctx: BattleScriptContext, spawnAt: number): void {
  const position = createOutsideKefkaPosition();
  const facing = createFacingTowards(position, CENTER);
  const castStartAt = spawnAt + TRUE_SELF_SPAWN_TO_CAST_MS;
  const resolveAt = castStartAt + TRUE_SELF_CAST_MS;

  ctx.timeline.at(spawnAt, () => {
    spawnKefkaMarker(ctx, position, resolveAt + VISUAL_MS - spawnAt);
  });
  ctx.timeline.at(castStartAt, () => {
    ctx.boss.cast(`kefka_p3_second_true_self_${spawnAt}`, '本色出演的我', TRUE_SELF_CAST_MS);
  });
  ctx.timeline.at(resolveAt - TELEGRAPH_MS, () => {
    ctx.spawn.rectangleTelegraph({
      label: '本色出演的我',
      center: position,
      direction: facing,
      length: TRUE_SELF_LENGTH,
      width: TRUE_SELF_WIDTH,
      color: SLAP_MARKER_COLOR,
      resolveAfterMs: TELEGRAPH_MS,
    });
  });
  ctx.timeline.at(resolveAt, () => {
    for (const hit of ctx.select
      .allPlayers()
      .filter((actor) =>
        isActorInsideRectangle(actor, position, facing, TRUE_SELF_LENGTH, TRUE_SELF_WIDTH),
      )) {
      applySecondTrickDeath(ctx, hit, '本色出演的我');
    }
  });
}

function buildKefkaP3SecondScript(ctx: BattleScriptContext): void {
  setWanderingBossState(ctx, {
    chaosCenter: CENTER,
    exdeathCenter: CENTER,
    chaosFacing: 0,
    exdeathFacing: 0,
    chaosLockedUntil: 0,
    exdeathLockedUntil: 0,
  });

  ctx.timeline.at(0, () => {
    spawnChaosMarker(ctx, CENTER, REPOSITION_INTERVAL_MS);
    spawnExdeathMarker(ctx, CENTER, REPOSITION_INTERVAL_MS);
  });

  for (
    let repositionAt = REPOSITION_INTERVAL_MS;
    repositionAt < COMPLETE_AT;
    repositionAt += REPOSITION_INTERVAL_MS
  ) {
    ctx.timeline.at(repositionAt, () => {
      repositionWanderingBosses(ctx);
    });
  }

  ctx.timeline.at(EARTHQUAKE_CAST_START_AT, () => {
    ctx.boss.cast('kefka_p3_second_earthquake', '地震', EARTHQUAKE_CAST_MS);
  });
  ctx.timeline.at(ZERO_AT, () => {
    assignInitialStatuses(ctx);
  });

  scheduleSlap(ctx, t(9_800));
  scheduleFirstBlackHoles(ctx);
  scheduleThunder(ctx, t(31_900), 'kefka_p3_second_thunder_1');
  scheduleCurse(ctx, t(39_900), 'kefka_p3_second_curse_1');
  scheduleSlap(ctx, t(40_200));
  schedulePersistentBlackHoles(ctx, t(49_300), 'persistent:1');
  scheduleCurse(ctx, t(63_500), 'kefka_p3_second_curse_2');
  scheduleTrueSelf(ctx, t(63_500));
  scheduleThunder(ctx, t(69_500), 'kefka_p3_second_thunder_2');
  schedulePersistentBlackHoles(ctx, t(81_000), 'persistent:2');
  scheduleSlap(ctx, t(100_000), 6_000);
  scheduleChaosExplosion(ctx, t(104_000), 'kefka_p3_second_chaos_explosion');

  ctx.timeline.at(COMPLETE_AT, () => {
    ctx.state.complete();
  });
}

export const KEFKA_P3_SECOND_TRICK_BATTLE: BattleDefinition = {
  id: 'kefka_p3_second_trick',
  name: '凯夫卡P3：二运',
  arenaRadius: ARENA_RADIUS,
  bossTargetRingRadius: BOSS_TARGET_RING_RADIUS,
  slots: PARTY_SLOT_ORDER,
  bossName: '凯夫卡',
  initialPartyPositions: Object.fromEntries(
    PARTY_SLOT_ORDER.map((slot) => [
      slot,
      {
        position: INITIAL_POSITIONS[slot],
        facing: createFacingTowards(INITIAL_POSITIONS[slot], CENTER),
      },
    ]),
  ) as BattleDefinition['initialPartyPositions'],
  mapMarkers: KEFKA_MAP_MARKERS,
  buildScript: buildKefkaP3SecondScript,
  failureTexts: {
    outOfBounds: (actorName) => `${actorName} 越过场地边界`,
    mechanicDeath: (actorName, sourceLabel) => `${actorName} 因 ${sourceLabel} 死亡`,
  },
};

export const KEFKA_P3_SECOND_TRICK_TESTING = {
  ZERO_AT,
  TELEGRAPH_MS,
  FIRST_TARGET_STATUS_ID,
  SECOND_TARGET_STATUS_ID,
  THIRD_TARGET_STATUS_ID,
  CHAOS_EARTH_STATUS_ID,
  VOID_EROSION_1_STATUS_ID,
  VOID_EROSION_2_STATUS_ID,
  VOID_CORROSION_STATUS_ID,
  FIRST_TARGET_MARKER_COLOR,
  SECOND_TARGET_MARKER_COLOR,
  THIRD_TARGET_MARKER_COLOR,
  BLACK_HOLE_SHOT_DELAY_MS,
  CHAOS_EXPLOSION_CAST_MS,
  CHAOS_EXPLOSION_SECOND_DELAY_MS,
  CHAOS_EXPLOSION_FAN_ANGLE,
  CHAOS_EXPLOSION_FAN_RADIUS,
  THUNDER_CAST_MS,
  CURSE_CAST_MS,
  TRUE_SELF_CAST_MS,
  TRUE_SELF_LENGTH,
  getChaosExplosionDirections,
  createBlackHoleCenters,
  calculateSlapAoeCenter,
  isActorInsideRectangle,
};
