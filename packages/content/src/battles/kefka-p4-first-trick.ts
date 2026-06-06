import type { BattleDefinition, BattleScriptContext } from '@ff14arena/core';
import { INJURY_UP_MULTIPLIER, createFacingTowards, distance } from '@ff14arena/core';
import type { BaseActorSnapshot, MapMarker, PartySlot, StatusId, Vector2 } from '@ff14arena/shared';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import { getStatusDisplayName } from '../status-metadata';

type TrickTruth = 'real' | 'fake';
type DarkLightKind = 'living' | 'dead';
type BigCrossPlanId = 'curse_accel' | 'accel' | 'lightning' | 'water';
type BigCrossPlanCategory = 'A' | 'B';
type ProtectionStatusId = typeof ALLAGAN_FIELD_STATUS_ID | typeof BEYOND_DEATH_STATUS_ID;
type ChaosElementKind = 'fire' | 'water';
type MagicComponent = 'ice' | 'thunder';

interface RectSpec {
  center: Vector2;
  direction: number;
  length: number;
  width: number;
}

interface FanSpec {
  center: Vector2;
  direction: number;
  angle: number;
  radius: number;
}

interface MagicPattern {
  icePreview: FanSpec[];
  iceOpposite: FanSpec[];
  iceResolve: FanSpec[];
  thunderPreview: RectSpec[];
  thunderOpposite: RectSpec[];
  thunderResolve: RectSpec[];
  iceTruth: TrickTruth;
  thunderTruth: TrickTruth;
  iceMarkerAngle: number;
  thunderMarkerAngle: number;
}

interface MagicResolveInversion {
  ice?: boolean;
  thunder?: boolean;
}

interface BigCrossPlan {
  id: BigCrossPlanId;
  statuses: Array<{
    statusId: StatusId;
    durationMs: number;
    resolver: (ctx: BattleScriptContext, actorId: string, fake: boolean) => void;
  }>;
}

interface ProtectionState {
  actorId: string;
  statusId: ProtectionStatusId;
  fake: boolean;
  active: boolean;
  burstPending: boolean;
}

const ARENA_RADIUS = 20;
const BOSS_TARGET_RING_RADIUS = 6;
const CENTER = { x: 0, y: 0 } as const satisfies Vector2;
const OUTSIDE_BOSS_DISTANCE = ARENA_RADIUS + 5;
const TELEGRAPH_MS = 500;
const MAGIC_CAST_MS = 5_000;
const MANA_STORE_CAST_MS = 3_000;
const BIG_CROSS_CAST_MS = 8_000;
const CHAOS_CAST_MS = 8_000;
const VOID_FLOOD_CAST_MS = 5_000;
const MANA_RELEASE_CAST_MS = 7_000;
const INJURY_DURATION_MS = 3_000;
const MECHANIC_DAMAGE = 1;
const ACCELERATION_CHECK_MS = 2_000;
const CHAOS_ELEMENT_DELAY_MS = 5_000;
const COMPLETE_AT = 109_000;
const OUTSIDE_BOSS_MARKER_RADIUS = 1.275;
const VOID_FLOOD_MARKER_SIDE_OFFSET = 5;

const THUNDER_LENGTH = 40;
const THUNDER_WIDTH = 10;
const THUNDER_NEAR_OFFSET = 5;
const THUNDER_FAR_OFFSET = 15;
const ICE_RADIUS = 20;
const ICE_ANGLE = Math.PI / 2;
const LIGHTNING_RADIUS = 8;
const WATER_SHARE_RADIUS = 8;
const WATER_SHARE_REQUIRED_PLAYERS = 3;
const CHAOS_FIRE_RADIUS = 6;
const CHAOS_DONUT_OUTER_RADIUS = 40;
const CHAOS_WATER_INNER_RADIUS = 6;
const CHAOS_WATER_OUTER_RADIUS = 40;

const CURSE_HOWL_STATUS_ID = 'kefka_p4_curse_howl';
const FORKED_LIGHTNING_STATUS_ID = 'kefka_p4_forked_lightning';
const COMPRESSED_WATER_STATUS_ID = 'kefka_p4_compressed_water';
const ACCELERATION_BOMB_STATUS_ID = 'kefka_p4_acceleration_bomb';
const ALLAGAN_FIELD_STATUS_ID = 'kefka_p4_allagan_field';
const BEYOND_DEATH_STATUS_ID = 'kefka_p4_beyond_death';
const LIVING_WOUND_STATUS_ID = 'kefka_p4_living_wound';
const DEAD_WOUND_STATUS_ID = 'kefka_p4_dead_wound';
const CHAOS_FIRE_STATUS_ID = 'kefka_p4_chaos_fire';
const CHAOS_WATER_STATUS_ID = 'kefka_p4_chaos_water';

const TANK_HEALER_SLOTS = ['MT', 'ST', 'H1', 'H2'] as const satisfies readonly PartySlot[];
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

function shuffle<T>(values: readonly T[]): T[] {
  const shuffled = [...values];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }

  return shuffled;
}

function createPermutations<T>(values: readonly T[]): T[][] {
  if (values.length <= 1) {
    return [[...values]];
  }

  return values.flatMap((value, index) => {
    const remaining = [...values.slice(0, index), ...values.slice(index + 1)];

    return createPermutations(remaining).map((permutation) => [value, ...permutation]);
  });
}

function randomTruth(): TrickTruth {
  return Math.random() < 0.5 ? 'real' : 'fake';
}

function isFake(truth: TrickTruth): boolean {
  return truth === 'fake';
}

function getActorById(actors: BaseActorSnapshot[], actorId: string): BaseActorSnapshot | null {
  return actors.find((actor) => actor.id === actorId) ?? null;
}

function getFreshActor(ctx: BattleScriptContext, actorId: string): BaseActorSnapshot | null {
  return getActorById(ctx.select.allPlayers(), actorId);
}

function getActorBySlot(ctx: BattleScriptContext, slot: PartySlot): BaseActorSnapshot {
  const actor = ctx.select.bySlot(slot);

  if (actor === undefined) {
    throw new Error(`missing actor for slot ${slot}`);
  }

  return actor;
}

function hasStatus(actor: BaseActorSnapshot, statusId: StatusId): boolean {
  return actor.statuses.some((status) => status.id === statusId);
}

function normalizeAngle(angle: number): number {
  const normalized = angle % (Math.PI * 2);

  return normalized < 0 ? normalized + Math.PI * 2 : normalized;
}

function getAngleDiff(left: number, right: number): number {
  const diff = Math.abs(normalizeAngle(left) - normalizeAngle(right)) % (Math.PI * 2);

  return diff > Math.PI ? Math.PI * 2 - diff : diff;
}

function createPointOnDirection(direction: number, radius: number): Vector2 {
  return {
    x: Math.cos(direction) * radius,
    y: Math.sin(direction) * radius,
  };
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

function getActorsInsideDonut(
  actors: BaseActorSnapshot[],
  center: Vector2,
  innerRadius: number,
  outerRadius: number,
): BaseActorSnapshot[] {
  return actors.filter((actor) => {
    if (!actor.mechanicActive) {
      return false;
    }

    const hitDistance = distance(actor.position, center);

    return hitDistance >= innerRadius && hitDistance <= outerRadius;
  });
}

function isActorInsideFan(actor: BaseActorSnapshot, spec: FanSpec): boolean {
  if (!actor.mechanicActive || distance(actor.position, spec.center) > spec.radius) {
    return false;
  }

  if (distance(actor.position, spec.center) <= 0.0001) {
    return true;
  }

  return (
    getAngleDiff(
      Math.atan2(actor.position.y - spec.center.y, actor.position.x - spec.center.x),
      spec.direction,
    ) <=
    spec.angle / 2
  );
}

function isActorInsideRectangle(actor: BaseActorSnapshot, spec: RectSpec): boolean {
  if (!actor.mechanicActive) {
    return false;
  }

  const relative = {
    x: actor.position.x - spec.center.x,
    y: actor.position.y - spec.center.y,
  };
  const forward = {
    x: Math.cos(spec.direction),
    y: Math.sin(spec.direction),
  };
  const projection = relative.x * forward.x + relative.y * forward.y;

  if (projection < 0 || projection > spec.length) {
    return false;
  }

  const lateral = Math.abs(relative.x * -forward.y + relative.y * forward.x);

  return lateral <= spec.width / 2;
}

function isFacingSource(actor: BaseActorSnapshot, source: Vector2): boolean {
  return getAngleDiff(actor.facing, createFacingTowards(actor.position, source)) <= Math.PI / 2;
}

function applyStatus(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  statusId: StatusId,
  durationMs: number,
  fake: boolean,
): void {
  const displayName = getStatusDisplayName(statusId);

  ctx.status.apply([actor.id], statusId, durationMs, {
    name: fake ? `${displayName}（假）` : displayName,
  });
}

function applyP4Death(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  sourceLabel: string,
): void {
  const freshActor = getFreshActor(ctx, actor.id);

  if (freshActor === null || !freshActor.mechanicActive) {
    return;
  }

  ctx.damage.kill([freshActor.id], sourceLabel);
}

function applyP4Damage(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  sourceLabel: string,
): void {
  const freshActor = getFreshActor(ctx, actor.id);

  if (freshActor === null || !freshActor.mechanicActive) {
    return;
  }

  if (hasStatus(freshActor, 'injury_up')) {
    applyP4FatalDamage(ctx, freshActor, sourceLabel);
    return;
  }

  ctx.damage.apply([freshActor.id], MECHANIC_DAMAGE, sourceLabel);
  ctx.status.apply([freshActor.id], 'injury_up', INJURY_DURATION_MS, {
    multiplier: INJURY_UP_MULTIPLIER,
    name: getStatusDisplayName('injury_up'),
  });
}

function protectionStateKey(actorId: string, statusId: ProtectionStatusId): string {
  return `kefkaP4:protection:${actorId}:${statusId}`;
}

function getProtectionState(
  ctx: BattleScriptContext,
  actorId: string,
  statusId: ProtectionStatusId,
): ProtectionState | undefined {
  return ctx.state.getValue<ProtectionState>(protectionStateKey(actorId, statusId));
}

function setProtectionState(ctx: BattleScriptContext, state: ProtectionState): void {
  ctx.state.setValue(protectionStateKey(state.actorId, state.statusId), state);
}

function consumeFatalProtection(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  sourceLabel: string,
): boolean {
  const protections = [
    getProtectionState(ctx, actor.id, ALLAGAN_FIELD_STATUS_ID),
    getProtectionState(ctx, actor.id, BEYOND_DEATH_STATUS_ID),
  ].filter((state): state is ProtectionState => state !== undefined && state.active);
  const protection = protections.find(
    (state) =>
      (state.statusId === ALLAGAN_FIELD_STATUS_ID && state.fake) ||
      (state.statusId === BEYOND_DEATH_STATUS_ID && !state.fake),
  );

  if (protection === undefined) {
    return false;
  }

  setProtectionState(ctx, { ...protection, active: false });
  ctx.status.remove([actor.id], protection.statusId);
  ctx.state.fail(
    `${actor.name} 使用 ${getStatusDisplayName(protection.statusId)} 抵挡 ${sourceLabel}`,
  );

  return true;
}

function applyP4FatalDamage(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  sourceLabel: string,
): void {
  const freshActor = getFreshActor(ctx, actor.id);

  if (freshActor === null || !freshActor.mechanicActive) {
    return;
  }

  if (consumeFatalProtection(ctx, freshActor, sourceLabel)) {
    return;
  }

  applyP4Death(ctx, freshActor, sourceLabel);
}

function applyRaidwideDeath(ctx: BattleScriptContext, sourceLabel: string): void {
  for (const actor of ctx.select.allPlayers().filter((candidate) => candidate.mechanicActive)) {
    applyP4Death(ctx, actor, sourceLabel);
  }
}

function markProtectionBurstPending(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  sourceLabel: string,
): void {
  for (const statusId of [ALLAGAN_FIELD_STATUS_ID, BEYOND_DEATH_STATUS_ID] as const) {
    const protection = getProtectionState(ctx, actor.id, statusId);

    if (
      protection === undefined ||
      !protection.active ||
      !(
        (protection.statusId === ALLAGAN_FIELD_STATUS_ID && !protection.fake) ||
        (protection.statusId === BEYOND_DEATH_STATUS_ID && protection.fake)
      )
    ) {
      continue;
    }

    setProtectionState(ctx, { ...protection, burstPending: true });
    ctx.state.fail(`${actor.name} 的 ${getStatusDisplayName(statusId)} 记录了 ${sourceLabel}`);
  }
}

function expireProtection(
  ctx: BattleScriptContext,
  actorId: string,
  statusId: ProtectionStatusId,
): void {
  const protection = getProtectionState(ctx, actorId, statusId);
  const actor = getFreshActor(ctx, actorId);

  if (protection === undefined || !protection.active || actor === null) {
    return;
  }

  setProtectionState(ctx, { ...protection, active: false });

  if (
    (protection.statusId === ALLAGAN_FIELD_STATUS_ID && !protection.fake) ||
    (protection.statusId === BEYOND_DEATH_STATUS_ID && protection.fake)
  ) {
    if (protection.burstPending) {
      applyRaidwideDeath(ctx, getStatusDisplayName(protection.statusId));
    }
    return;
  }

  applyP4Death(ctx, actor, getStatusDisplayName(protection.statusId));
}

function spawnEnemyMarker(
  ctx: BattleScriptContext,
  label: string,
  center: Vector2,
  stableId: string,
  resolveAfterMs: number,
  color: string,
): void {
  ctx.spawn.fieldMarker({
    label,
    center,
    stableId,
    shape: 'enemy',
    radius: OUTSIDE_BOSS_MARKER_RADIUS,
    color,
    direction: createFacingTowards(center, CENTER),
    resolveAfterMs,
  });
}

function getInitialOutsideBosses(): { chaos: Vector2; exdeath: Vector2 } {
  const left = createPointOnDirection((-3 * Math.PI) / 4, OUTSIDE_BOSS_DISTANCE);
  const right = createPointOnDirection(-Math.PI / 4, OUTSIDE_BOSS_DISTANCE);

  return Math.random() < 0.5 ? { chaos: left, exdeath: right } : { chaos: right, exdeath: left };
}

function setChaosPosition(ctx: BattleScriptContext, position: Vector2): void {
  ctx.state.setValue('kefkaP4:chaosPosition', position);
}

function getChaosPosition(ctx: BattleScriptContext): Vector2 {
  return ctx.state.getValue<Vector2>('kefkaP4:chaosPosition') ?? CENTER;
}

function setExdeathPosition(ctx: BattleScriptContext, position: Vector2): void {
  ctx.state.setValue('kefkaP4:exdeathPosition', position);
}

function getExdeathPosition(ctx: BattleScriptContext): Vector2 {
  return ctx.state.getValue<Vector2>('kefkaP4:exdeathPosition') ?? CENTER;
}

function spawnTruthRing(
  ctx: BattleScriptContext,
  label: string,
  center: Vector2,
  truth: TrickTruth,
  resolveAfterMs: number,
  ringColor = '#ffffff',
): void {
  ctx.spawn.ringIndicator({
    label,
    center,
    resolveAfterMs,
    rings: [
      {
        radius: 1.45,
        color: ringColor,
        markerAngle: -Math.PI / 2,
        markerColor: isFake(truth) ? '#ef4444' : '#38bdf8',
        markerKind: isFake(truth) ? 'question' : 'solid',
      },
    ],
  });
}

function createThunderRect(direction: number, offset: number): RectSpec {
  const normal = {
    x: -Math.sin(direction),
    y: Math.cos(direction),
  };
  const lineCenter = {
    x: normal.x * offset,
    y: normal.y * offset,
  };

  return {
    center: {
      x: lineCenter.x - Math.cos(direction) * (THUNDER_LENGTH / 2),
      y: lineCenter.y - Math.sin(direction) * (THUNDER_LENGTH / 2),
    },
    direction,
    length: THUNDER_LENGTH,
    width: THUNDER_WIDTH,
  };
}

function createMagicPattern(): MagicPattern {
  const thunderDirection = Math.random() < 0.5 ? Math.PI / 4 : -Math.PI / 4;
  const thunderSide = Math.random() < 0.5 ? 1 : -1;
  const thunderPreview = [
    createThunderRect(thunderDirection, thunderSide * THUNDER_NEAR_OFFSET),
    createThunderRect(thunderDirection, -thunderSide * THUNDER_FAR_OFFSET),
  ];
  const thunderOpposite = [
    createThunderRect(thunderDirection, thunderSide * THUNDER_FAR_OFFSET),
    createThunderRect(thunderDirection, -thunderSide * THUNDER_NEAR_OFFSET),
  ];
  const icePairIndex = Math.random() < 0.5 ? 0 : 1;
  const icePreviewDirections =
    icePairIndex === 0 ? [-Math.PI / 4, (3 * Math.PI) / 4] : [(-3 * Math.PI) / 4, Math.PI / 4];
  const iceOppositeDirections =
    icePairIndex === 0 ? [(-3 * Math.PI) / 4, Math.PI / 4] : [-Math.PI / 4, (3 * Math.PI) / 4];
  const icePreview = icePreviewDirections.map((direction) => ({
    center: CENTER,
    direction,
    angle: ICE_ANGLE,
    radius: ICE_RADIUS,
  }));
  const iceOpposite = iceOppositeDirections.map((direction) => ({
    center: CENTER,
    direction,
    angle: ICE_ANGLE,
    radius: ICE_RADIUS,
  }));
  const iceTruth = randomTruth();
  const thunderTruth = randomTruth();

  return {
    icePreview,
    iceOpposite,
    iceResolve: isFake(iceTruth) ? iceOpposite : icePreview,
    thunderPreview,
    thunderOpposite,
    thunderResolve: isFake(thunderTruth) ? thunderOpposite : thunderPreview,
    iceTruth,
    thunderTruth,
    iceMarkerAngle: Math.random() * Math.PI * 2,
    thunderMarkerAngle: Math.random() * Math.PI * 2,
  };
}

function spawnMagicTelegraphs(
  ctx: BattleScriptContext,
  pattern: MagicPattern,
  resolveAfterMs: number,
  components: readonly MagicComponent[] = ['ice', 'thunder'],
  showTruthIndicator = true,
): void {
  if (components.includes('ice')) {
    for (const fan of pattern.icePreview) {
      ctx.spawn.fanTelegraph({
        label: '玄乎乎魔法：冰',
        center: fan.center,
        direction: fan.direction,
        angle: fan.angle,
        radius: fan.radius,
        resolveAfterMs,
      });
    }
  }

  if (components.includes('thunder')) {
    for (const rect of pattern.thunderPreview) {
      ctx.spawn.rectangleTelegraph({
        label: '玄乎乎魔法：雷',
        center: rect.center,
        direction: rect.direction,
        length: rect.length,
        width: rect.width,
        color: '#a78bfa',
        resolveAfterMs,
      });
    }
  }

  if (!showTruthIndicator) {
    return;
  }

  spawnMagicTruthIndicator(ctx, pattern, resolveAfterMs, components);
}

function spawnMagicTruthIndicator(
  ctx: BattleScriptContext,
  pattern: MagicPattern,
  resolveAfterMs: number,
  components: readonly MagicComponent[] = ['ice', 'thunder'],
): void {
  ctx.spawn.ringIndicator({
    label: '玄乎乎魔法真假',
    center: CENTER,
    resolveAfterMs,
    rings: [
      ...(components.includes('ice')
        ? [
            {
              radius: 1.35,
              color: '#ffffff',
              markerAngle: pattern.iceMarkerAngle,
              markerColor: isFake(pattern.iceTruth) ? '#ef4444' : '#38bdf8',
              markerKind: isFake(pattern.iceTruth) ? 'question' : 'solid',
            } as const,
          ]
        : []),
      ...(components.includes('thunder')
        ? [
            {
              radius: 2.05,
              color: '#a855f7',
              markerAngle: pattern.thunderMarkerAngle,
              markerColor: isFake(pattern.thunderTruth) ? '#ef4444' : '#38bdf8',
              markerKind: isFake(pattern.thunderTruth) ? 'question' : 'solid',
            } as const,
          ]
        : []),
    ],
  });
}

function getMagicIceResolve(pattern: MagicPattern, inverted = false): FanSpec[] {
  return isFake(pattern.iceTruth) !== inverted ? pattern.iceOpposite : pattern.icePreview;
}

function getMagicThunderResolve(pattern: MagicPattern, inverted = false): RectSpec[] {
  return isFake(pattern.thunderTruth) !== inverted
    ? pattern.thunderOpposite
    : pattern.thunderPreview;
}

function resolveMagic(
  ctx: BattleScriptContext,
  pattern: MagicPattern,
  components: readonly MagicComponent[] = ['ice', 'thunder'],
  inversion: MagicResolveInversion = {},
): void {
  const iceResolve = getMagicIceResolve(pattern, inversion.ice === true);
  const thunderResolve = getMagicThunderResolve(pattern, inversion.thunder === true);

  for (const actor of ctx.select.allPlayers()) {
    const hitIce =
      components.includes('ice') && iceResolve.some((fan) => isActorInsideFan(actor, fan));
    const hitThunder =
      components.includes('thunder') &&
      thunderResolve.some((rect) => isActorInsideRectangle(actor, rect));

    if (hitIce) {
      applyP4Damage(ctx, actor, '玄乎乎魔法：冰');
    }

    if (hitThunder) {
      applyP4Damage(ctx, actor, '玄乎乎魔法：雷');
    }
  }
}

function scheduleMagic(
  ctx: BattleScriptContext,
  startAt: number,
  index: number,
  options: {
    actionId?: string;
    actionName?: string;
    components?: readonly MagicComponent[];
    showCast?: boolean;
  } = {},
): void {
  const components = options.components ?? (['ice', 'thunder'] as const);
  const actionId = options.actionId ?? `kefka_p4_mysterious_magic_${index}`;
  const actionName = options.actionName ?? '玄乎乎魔法';
  const showCast = options.showCast ?? true;

  ctx.timeline.at(startAt, () => {
    const pattern = createMagicPattern();

    if (showCast) {
      ctx.boss.cast(actionId, actionName, MAGIC_CAST_MS);
    }
    ctx.state.setValue(`kefkaP4:magic:${index}`, pattern);
    spawnMagicTelegraphs(ctx, pattern, MAGIC_CAST_MS, components);
  });
  ctx.timeline.at(startAt + MAGIC_CAST_MS, () => {
    const pattern = ctx.state.getValue<MagicPattern>(`kefkaP4:magic:${index}`);

    if (pattern !== undefined) {
      resolveMagic(ctx, pattern, components);
    }
  });
}

function scheduleKefkaNoopCast(
  ctx: BattleScriptContext,
  startAt: number,
  actionId: string,
  actionName: string,
  castMs: number,
): void {
  ctx.timeline.at(startAt, () => {
    ctx.boss.cast(actionId, actionName, castMs);
  });
}

function scheduleManaReleaseMagic(ctx: BattleScriptContext): void {
  ctx.timeline.at(89_000, () => {
    const pattern = createMagicPattern();

    ctx.boss.cast('kefka_p4_mana_release', '魔力释放', MANA_RELEASE_CAST_MS);
    ctx.state.setValue('kefkaP4:magic:6', pattern);
    spawnMagicTruthIndicator(ctx, pattern, MANA_RELEASE_CAST_MS);
  });
  ctx.timeline.at(96_000, () => {
    const pattern = ctx.state.getValue<MagicPattern>('kefkaP4:magic:6');

    if (pattern !== undefined) {
      spawnMagicTelegraphs(ctx, pattern, MAGIC_CAST_MS, ['ice', 'thunder'], false);
    }
  });
  ctx.timeline.at(96_000 + MAGIC_CAST_MS, () => {
    const pattern = ctx.state.getValue<MagicPattern>('kefkaP4:magic:6');
    const thunderPattern = ctx.state.getValue<MagicPattern>('kefkaP4:magic:4');
    const icePattern = ctx.state.getValue<MagicPattern>('kefkaP4:magic:5');

    if (pattern !== undefined) {
      resolveMagic(ctx, pattern, ['ice', 'thunder'], {
        ice: icePattern !== undefined && isFake(icePattern.iceTruth),
        thunder: thunderPattern !== undefined && isFake(thunderPattern.thunderTruth),
      });
    }
  });
}

function scheduleFlappingUltimate(ctx: BattleScriptContext): void {
  ctx.timeline.at(71_000, () => {
    ctx.boss.cast('kefka_p4_flapping_ultimate', '扑腾腾究极', MAGIC_CAST_MS);
  });
}

function getBigCrossPlans(round: 1 | 2): BigCrossPlan[] {
  if (round === 1) {
    return [
      {
        id: 'curse_accel',
        statuses: [
          { statusId: CURSE_HOWL_STATUS_ID, durationMs: 60_000, resolver: resolveCurseHowl },
          {
            statusId: ACCELERATION_BOMB_STATUS_ID,
            durationMs: 51_000,
            resolver: resolveAccelerationBomb,
          },
        ],
      },
      {
        id: 'accel',
        statuses: [
          {
            statusId: ACCELERATION_BOMB_STATUS_ID,
            durationMs: 76_000,
            resolver: resolveAccelerationBomb,
          },
        ],
      },
      {
        id: 'lightning',
        statuses: [
          {
            statusId: FORKED_LIGHTNING_STATUS_ID,
            durationMs: 0,
            resolver: resolveForkedLightning,
          },
        ],
      },
      {
        id: 'water',
        statuses: [
          {
            statusId: COMPRESSED_WATER_STATUS_ID,
            durationMs: 0,
            resolver: resolveCompressedWater,
          },
        ],
      },
    ];
  }

  return [
    {
      id: 'curse_accel',
      statuses: [
        { statusId: CURSE_HOWL_STATUS_ID, durationMs: 69_000, resolver: resolveCurseHowl },
        {
          statusId: ACCELERATION_BOMB_STATUS_ID,
          durationMs: 61_000,
          resolver: resolveAccelerationBomb,
        },
      ],
    },
    {
      id: 'accel',
      statuses: [
        {
          statusId: ACCELERATION_BOMB_STATUS_ID,
          durationMs: 36_000,
          resolver: resolveAccelerationBomb,
        },
      ],
    },
    {
      id: 'lightning',
      statuses: [
        {
          statusId: FORKED_LIGHTNING_STATUS_ID,
          durationMs: 0,
          resolver: resolveForkedLightning,
        },
      ],
    },
    {
      id: 'water',
      statuses: [
        {
          statusId: COMPRESSED_WATER_STATUS_ID,
          durationMs: 0,
          resolver: resolveCompressedWater,
        },
      ],
    },
  ];
}

function getBigCrossPlanCategory(planId: BigCrossPlanId): BigCrossPlanCategory {
  return planId === 'curse_accel' || planId === 'accel' ? 'A' : 'B';
}

function canAssignBigCrossPlan(
  plan: BigCrossPlan,
  previousPlanId: BigCrossPlanId | undefined,
): boolean {
  if (previousPlanId === undefined) {
    return true;
  }

  return getBigCrossPlanCategory(plan.id) !== getBigCrossPlanCategory(previousPlanId);
}

function selectRoundPlansForGroup(
  slots: readonly PartySlot[],
  plans: readonly BigCrossPlan[],
  previousPlans: Record<PartySlot, BigCrossPlanId> | undefined,
): Map<PartySlot, BigCrossPlan> {
  const validPermutations = createPermutations(plans).filter((permutation) =>
    slots.every((slot, index) => canAssignBigCrossPlan(permutation[index]!, previousPlans?.[slot])),
  );

  if (validPermutations.length === 0) {
    throw new Error('no valid Kefka P4 big cross plan assignment');
  }

  const selected = validPermutations[Math.floor(Math.random() * validPermutations.length)]!;

  return new Map(slots.map((slot, index) => [slot, selected[index]!]));
}

function groupPlanStateKey(round: 1 | 2): string {
  return `kefkaP4:bigCrossPlans:${round}`;
}

function getElementalDurationGroup(ctx: BattleScriptContext): 'early' | 'late' {
  const existing = ctx.state.getValue<'early' | 'late'>('kefkaP4:elementalDurationGroup');

  if (existing !== undefined) {
    return existing;
  }

  const durationGroup = Math.random() < 0.5 ? 'early' : 'late';
  ctx.state.setValue('kefkaP4:elementalDurationGroup', durationGroup);

  return durationGroup;
}

function getElementalDurationMs(ctx: BattleScriptContext, round: 1 | 2): number {
  const durationGroup = getElementalDurationGroup(ctx);

  if (round === 1) {
    return durationGroup === 'early' ? 51_000 : 76_000;
  }

  return durationGroup === 'early' ? 61_000 : 36_000;
}

function resolveBigCrossStatusDurationMs(
  ctx: BattleScriptContext,
  round: 1 | 2,
  statusId: StatusId,
  durationMs: number,
): number {
  if (statusId === FORKED_LIGHTNING_STATUS_ID || statusId === COMPRESSED_WATER_STATUS_ID) {
    return getElementalDurationMs(ctx, round);
  }

  return durationMs;
}

function scheduleStatusResolution(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  statusId: StatusId,
  durationMs: number,
  fake: boolean,
  resolver: (ctx: BattleScriptContext, actorId: string, fake: boolean) => void,
): void {
  applyStatus(ctx, actor, statusId, durationMs, fake);
  ctx.timeline.after(durationMs, () => {
    resolver(ctx, actor.id, fake);
  });
}

function assignBigCross(ctx: BattleScriptContext, round: 1 | 2, truth: TrickTruth): void {
  const plans = getBigCrossPlans(round);
  const previousPlans =
    round === 1
      ? undefined
      : ctx.state.getValue<Record<PartySlot, BigCrossPlanId>>(groupPlanStateKey(1));
  const roleGroupAssignments = [
    selectRoundPlansForGroup(TANK_HEALER_SLOTS, plans, previousPlans),
    selectRoundPlansForGroup(DPS_SLOTS, plans, previousPlans),
  ];
  const assignments = new Map<PartySlot, BigCrossPlan>(
    roleGroupAssignments.flatMap((groupAssignments) => [...groupAssignments.entries()]),
  );
  const stateValue = Object.fromEntries(
    [...assignments.entries()].map(([slot, plan]) => [slot, plan.id]),
  ) as Record<PartySlot, BigCrossPlanId>;

  ctx.state.setValue(groupPlanStateKey(round), stateValue);

  for (const groupAssignments of roleGroupAssignments) {
    for (const [slot, plan] of groupAssignments) {
      const actor = getActorBySlot(ctx, slot);

      for (const status of plan.statuses) {
        scheduleStatusResolution(
          ctx,
          actor,
          status.statusId,
          resolveBigCrossStatusDurationMs(ctx, round, status.statusId, status.durationMs),
          isFake(truth),
          status.resolver,
        );
      }
    }
  }
}

function scheduleBigCross(ctx: BattleScriptContext, startAt: number, round: 1 | 2): void {
  ctx.timeline.at(startAt, () => {
    const truth = randomTruth();
    const exdeathPosition = getExdeathPosition(ctx);

    ctx.boss.cast(`kefka_p4_big_cross_${round}`, '大十字', BIG_CROSS_CAST_MS);
    spawnTruthRing(ctx, '大十字真假', exdeathPosition, truth, BIG_CROSS_CAST_MS, '#ffffff');
    ctx.state.setValue(`kefkaP4:bigCrossTruth:${round}`, truth);
  });
  ctx.timeline.at(startAt + BIG_CROSS_CAST_MS, () => {
    const truth = ctx.state.getValue<TrickTruth>(`kefkaP4:bigCrossTruth:${round}`) ?? 'real';
    assignBigCross(ctx, round, truth);
  });
}

function resolveCurseHowl(ctx: BattleScriptContext, actorId: string, fake: boolean): void {
  const actor = getFreshActor(ctx, actorId);

  if (actor === null || !actor.mechanicActive) {
    return;
  }

  ctx.spawn.actorMarker({
    label: '诅咒之嚎',
    target: actor,
    markerShape: 'circleDot',
    color: fake ? '#ef4444' : '#38bdf8',
    resolveAfterMs: TELEGRAPH_MS,
  });

  for (const target of ctx.select.allPlayers()) {
    if (target.id === actor.id || !target.mechanicActive) {
      continue;
    }

    const facingSource = isFacingSource(target, actor.position);

    if ((!fake && facingSource) || (fake && !facingSource)) {
      applyP4FatalDamage(ctx, target, '诅咒之嚎');
    }
  }
}

function spawnCenteredCircleTelegraph(
  ctx: BattleScriptContext,
  label: string,
  center: Vector2,
  radius: number,
): void {
  ctx.spawn.circleTelegraph({
    label,
    center,
    radius,
    color: '#facc15',
    resolveAfterMs: TELEGRAPH_MS,
  });
}

function resolveCenteredCircleDamage(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  label: string,
): void {
  spawnCenteredCircleTelegraph(ctx, label, actor.position, LIGHTNING_RADIUS);

  for (const hit of getActorsInsideCircle(
    ctx.select.allPlayers(),
    actor.position,
    LIGHTNING_RADIUS,
  )) {
    applyP4Damage(ctx, hit, label);
  }
}

function resolveThreePlayerShare(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  label: string,
): void {
  spawnCenteredCircleTelegraph(ctx, label, actor.position, WATER_SHARE_RADIUS);
  const hits = getActorsInsideCircle(ctx.select.allPlayers(), actor.position, WATER_SHARE_RADIUS);

  if (hits.length < WATER_SHARE_REQUIRED_PLAYERS) {
    for (const hit of hits) {
      applyP4FatalDamage(ctx, hit, `${label}人数不足`);
    }
    return;
  }

  for (const hit of hits) {
    applyP4Damage(ctx, hit, label);
  }
}

function resolveForkedLightning(ctx: BattleScriptContext, actorId: string, fake: boolean): void {
  const actor = getFreshActor(ctx, actorId);

  if (actor === null || !actor.mechanicActive) {
    return;
  }

  if (fake) {
    resolveThreePlayerShare(ctx, actor, '叉形闪电');
    return;
  }

  resolveCenteredCircleDamage(ctx, actor, '叉形闪电');
}

function resolveCompressedWater(ctx: BattleScriptContext, actorId: string, fake: boolean): void {
  const actor = getFreshActor(ctx, actorId);

  if (actor === null || !actor.mechanicActive) {
    return;
  }

  if (fake) {
    resolveCenteredCircleDamage(ctx, actor, '水属性压缩');
    return;
  }

  resolveThreePlayerShare(ctx, actor, '水属性压缩');
}

function accelerationMovedKey(actorId: string, resolveAt: number): string {
  return `kefkaP4:accelerationMoved:${actorId}:${resolveAt}`;
}

function resolveAccelerationBomb(ctx: BattleScriptContext, actorId: string, fake: boolean): void {
  const resolveAt = ctx.state.getBattleTime();
  const movedKey = accelerationMovedKey(actorId, resolveAt);

  ctx.state.setValue(movedKey, false);
  ctx.timeline.every(
    100,
    () => {
      const actor = getFreshActor(ctx, actorId);

      if (actor === null || !actor.mechanicActive) {
        return;
      }

      if (!actor.moveState.moving) {
        return;
      }

      if (!fake) {
        applyP4FatalDamage(ctx, actor, '加速度炸弹');
        return;
      }

      ctx.state.setValue(movedKey, true);
    },
    ACCELERATION_CHECK_MS,
  );
  ctx.timeline.after(ACCELERATION_CHECK_MS, () => {
    const actor = getFreshActor(ctx, actorId);

    if (actor === null || !actor.mechanicActive || !fake) {
      return;
    }

    if (ctx.state.getValue<boolean>(movedKey) !== true) {
      applyP4FatalDamage(ctx, actor, '加速度炸弹');
    }
  });
}

function scheduleChaosElement(
  ctx: BattleScriptContext,
  startAt: number,
  actionId: string,
  actionName: string,
  statusId: StatusId,
  durationMs: number,
  resolver: (ctx: BattleScriptContext, actorId: string, fake: boolean) => void,
): void {
  ctx.timeline.at(startAt, () => {
    const truth = randomTruth();
    const chaosPosition = getChaosPosition(ctx);

    ctx.boss.cast(actionId, actionName, CHAOS_CAST_MS);
    spawnTruthRing(ctx, `${actionName}真假`, chaosPosition, truth, CHAOS_CAST_MS, '#a855f7');
    ctx.state.setValue(`kefkaP4:${actionId}:truth`, truth);
  });
  ctx.timeline.at(startAt + CHAOS_CAST_MS, () => {
    const truth = ctx.state.getValue<TrickTruth>(`kefkaP4:${actionId}:truth`) ?? 'real';

    for (const actor of ctx.select.allPlayers()) {
      scheduleStatusResolution(ctx, actor, statusId, durationMs, isFake(truth), resolver);
    }
  });
}

function spawnChaosFireTelegraph(ctx: BattleScriptContext, center: Vector2, fake: boolean): void {
  if (fake) {
    ctx.spawn.donutTelegraph({
      label: '混沌之炎',
      center,
      innerRadius: CHAOS_FIRE_RADIUS,
      outerRadius: CHAOS_DONUT_OUTER_RADIUS,
      color: '#ef4444',
      resolveAfterMs: TELEGRAPH_MS,
    });
    return;
  }

  spawnCenteredCircleTelegraph(ctx, '混沌之炎', center, CHAOS_FIRE_RADIUS);
}

function applyChaosFire(ctx: BattleScriptContext, center: Vector2, fake: boolean): void {
  if (fake) {
    for (const hit of getActorsInsideDonut(
      ctx.select.allPlayers(),
      center,
      CHAOS_FIRE_RADIUS,
      CHAOS_DONUT_OUTER_RADIUS,
    )) {
      applyP4Damage(ctx, hit, '混沌之炎');
    }
    return;
  }

  for (const hit of getActorsInsideCircle(ctx.select.allPlayers(), center, CHAOS_FIRE_RADIUS)) {
    applyP4Damage(ctx, hit, '混沌之炎');
  }
}

function resolveChaosFire(ctx: BattleScriptContext, actorId: string, fake: boolean): void {
  const actor = getFreshActor(ctx, actorId);

  if (actor === null || !actor.mechanicActive) {
    return;
  }

  const center = { ...actor.position };

  ctx.timeline.after(CHAOS_ELEMENT_DELAY_MS - TELEGRAPH_MS, () => {
    spawnChaosFireTelegraph(ctx, center, fake);
  });
  ctx.timeline.after(CHAOS_ELEMENT_DELAY_MS, () => {
    applyChaosFire(ctx, center, fake);
  });
}

function spawnChaosWaterTelegraph(ctx: BattleScriptContext, center: Vector2, fake: boolean): void {
  if (fake) {
    spawnCenteredCircleTelegraph(ctx, '混沌之水', center, CHAOS_WATER_INNER_RADIUS);
    return;
  }

  ctx.spawn.donutTelegraph({
    label: '混沌之水',
    center,
    innerRadius: CHAOS_WATER_INNER_RADIUS,
    outerRadius: CHAOS_WATER_OUTER_RADIUS,
    color: '#38bdf8',
    resolveAfterMs: TELEGRAPH_MS,
  });
}

function applyChaosWater(ctx: BattleScriptContext, center: Vector2, fake: boolean): void {
  if (fake) {
    for (const hit of getActorsInsideCircle(
      ctx.select.allPlayers(),
      center,
      CHAOS_WATER_INNER_RADIUS,
    )) {
      applyP4Damage(ctx, hit, '混沌之水');
    }
    return;
  }

  for (const hit of getActorsInsideDonut(
    ctx.select.allPlayers(),
    center,
    CHAOS_WATER_INNER_RADIUS,
    CHAOS_WATER_OUTER_RADIUS,
  )) {
    applyP4Damage(ctx, hit, '混沌之水');
  }
}

function resolveChaosWater(ctx: BattleScriptContext, actorId: string, fake: boolean): void {
  const actor = getFreshActor(ctx, actorId);

  if (actor === null || !actor.mechanicActive) {
    return;
  }

  const center = { ...actor.position };

  ctx.timeline.after(CHAOS_ELEMENT_DELAY_MS - TELEGRAPH_MS, () => {
    spawnChaosWaterTelegraph(ctx, center, fake);
  });
  ctx.timeline.after(CHAOS_ELEMENT_DELAY_MS, () => {
    applyChaosWater(ctx, center, fake);
  });
}

function scheduleChaosElementPair(ctx: BattleScriptContext): void {
  ctx.timeline.at(5_000, () => {
    const firstElement: ChaosElementKind = Math.random() < 0.5 ? 'water' : 'fire';
    ctx.state.setValue('kefkaP4:firstChaosElement', firstElement);
  });

  ctx.timeline.at(5_000, () => {
    const firstElement =
      ctx.state.getValue<ChaosElementKind>('kefkaP4:firstChaosElement') ?? 'water';

    if (firstElement === 'water') {
      return;
    }

    scheduleChaosElement(
      ctx,
      5_000,
      'kefka_p4_blaze_first',
      '烈焰',
      CHAOS_FIRE_STATUS_ID,
      60_000,
      resolveChaosFire,
    );
  });

  ctx.timeline.at(21_000, () => {
    const firstElement =
      ctx.state.getValue<ChaosElementKind>('kefkaP4:firstChaosElement') ?? 'water';

    if (firstElement === 'water') {
      return;
    }

    scheduleChaosElement(
      ctx,
      21_000,
      'kefka_p4_tsunami_second',
      '海啸',
      CHAOS_WATER_STATUS_ID,
      66_000,
      resolveChaosWater,
    );
  });

  ctx.timeline.at(5_000, () => {
    const firstElement =
      ctx.state.getValue<ChaosElementKind>('kefkaP4:firstChaosElement') ?? 'water';

    if (firstElement === 'fire') {
      return;
    }

    scheduleChaosElement(
      ctx,
      5_000,
      'kefka_p4_tsunami_first',
      '海啸',
      CHAOS_WATER_STATUS_ID,
      82_000,
      resolveChaosWater,
    );
  });

  ctx.timeline.at(21_000, () => {
    const firstElement =
      ctx.state.getValue<ChaosElementKind>('kefkaP4:firstChaosElement') ?? 'water';

    if (firstElement === 'fire') {
      return;
    }

    scheduleChaosElement(
      ctx,
      21_000,
      'kefka_p4_blaze_second',
      '烈焰',
      CHAOS_FIRE_STATUS_ID,
      44_000,
      resolveChaosFire,
    );
  });
}

function assignFinalBigCross(ctx: BattleScriptContext, truth: TrickTruth): void {
  const fake = isFake(truth);

  for (const actor of ctx.select.allPlayers()) {
    const statusId = Math.random() < 0.5 ? LIVING_WOUND_STATUS_ID : DEAD_WOUND_STATUS_ID;
    applyStatus(ctx, actor, statusId, 15_000, fake);
  }

  for (const slots of [TANK_HEALER_SLOTS, DPS_SLOTS]) {
    const actors = shuffle(slots.map((slot) => getActorBySlot(ctx, slot)));

    actors.forEach((actor, index) => {
      const statusId = index < 2 ? ALLAGAN_FIELD_STATUS_ID : BEYOND_DEATH_STATUS_ID;
      const durationMs = statusId === ALLAGAN_FIELD_STATUS_ID ? 16_000 : 15_000;

      applyStatus(ctx, actor, statusId, durationMs, fake);
      setProtectionState(ctx, {
        actorId: actor.id,
        statusId,
        fake,
        active: true,
        burstPending: false,
      });
      ctx.timeline.after(durationMs, () => {
        expireProtection(ctx, actor.id, statusId);
      });
    });
  }
}

function scheduleFinalBigCross(ctx: BattleScriptContext): void {
  ctx.timeline.at(30_000, () => {
    const truth = randomTruth();

    ctx.boss.cast('kefka_p4_big_cross_final', '大十字', BIG_CROSS_CAST_MS);
    spawnTruthRing(ctx, '大十字真假', getExdeathPosition(ctx), truth, BIG_CROSS_CAST_MS, '#ffffff');
    ctx.state.setValue('kefkaP4:finalBigCrossTruth', truth);
  });
  ctx.timeline.at(38_000, () => {
    const truth = ctx.state.getValue<TrickTruth>('kefkaP4:finalBigCrossTruth') ?? 'real';
    assignFinalBigCross(ctx, truth);
  });
}

function reappearExdeath(ctx: BattleScriptContext): void {
  const direction = -Math.PI / 2 + (Math.PI * 2 * Math.floor(Math.random() * 8)) / 8;
  const position = createPointOnDirection(direction, OUTSIDE_BOSS_DISTANCE);

  setExdeathPosition(ctx, position);
  spawnEnemyMarker(
    ctx,
    '艾克斯迪斯',
    position,
    'kefka_p4_exdeath',
    COMPLETE_AT - 44_000,
    '#f97316',
  );
}

function getActorDarkWound(actor: BaseActorSnapshot): { statusId: StatusId; fake: boolean } | null {
  const living = actor.statuses.find((status) => status.id === LIVING_WOUND_STATUS_ID);
  const dead = actor.statuses.find((status) => status.id === DEAD_WOUND_STATUS_ID);
  const status = living ?? dead;

  if (status === undefined) {
    return null;
  }

  return {
    statusId: status.id,
    fake: status.name.includes('（假）'),
  };
}

function isWrongDarkLight(actor: BaseActorSnapshot, darkLightKind: DarkLightKind): boolean {
  const wound = getActorDarkWound(actor);

  if (wound === null) {
    return false;
  }

  if (wound.statusId === LIVING_WOUND_STATUS_ID) {
    return wound.fake ? darkLightKind === 'dead' : darkLightKind === 'living';
  }

  return wound.fake ? darkLightKind === 'living' : darkLightKind === 'dead';
}

function resolveDarkLightHit(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  darkLightKind: DarkLightKind,
): void {
  if (!isWrongDarkLight(actor, darkLightKind)) {
    return;
  }

  const sourceLabel = darkLightKind === 'living' ? '生者暗黑光' : '死者暗黑光';
  const wound = getActorDarkWound(actor);

  markProtectionBurstPending(ctx, actor, sourceLabel);

  if (wound !== null) {
    ctx.status.remove([actor.id], wound.statusId);
  }

  applyP4FatalDamage(ctx, actor, sourceLabel);
}

function isActorOnVoidSide(
  actor: BaseActorSnapshot,
  exdeathPosition: Vector2,
  side: 'left' | 'right',
): boolean {
  const facing = createFacingTowards(exdeathPosition, CENTER);
  const right = { x: Math.cos(facing + Math.PI / 2), y: Math.sin(facing + Math.PI / 2) };
  const relative = {
    x: actor.position.x - exdeathPosition.x,
    y: actor.position.y - exdeathPosition.y,
  };
  const sideValue = relative.x * right.x + relative.y * right.y;

  return side === 'right' ? sideValue >= 0 : sideValue < 0;
}

function scheduleVoidFlood(ctx: BattleScriptContext): void {
  ctx.timeline.at(47_000, () => {
    const truth = randomTruth();
    const exdeathPosition = getExdeathPosition(ctx);
    const facing = createFacingTowards(exdeathPosition, CENTER);
    const leftVector = { x: Math.cos(facing - Math.PI / 2), y: Math.sin(facing - Math.PI / 2) };
    const rightVector = { x: Math.cos(facing + Math.PI / 2), y: Math.sin(facing + Math.PI / 2) };
    const purpleSide = Math.random() < 0.5 ? 'left' : 'right';
    const blueSide = purpleSide === 'left' ? 'right' : 'left';
    const purpleVector = purpleSide === 'left' ? leftVector : rightVector;
    const blueVector = blueSide === 'left' ? leftVector : rightVector;

    ctx.boss.cast('kefka_p4_void_flood', '无之泛滥', VOID_FLOOD_CAST_MS);
    spawnTruthRing(ctx, '无之泛滥真假', exdeathPosition, truth, VOID_FLOOD_CAST_MS, '#ffffff');
    ctx.spawn.fieldMarker({
      label: '生者暗黑光',
      center: {
        x: exdeathPosition.x + purpleVector.x * VOID_FLOOD_MARKER_SIDE_OFFSET,
        y: exdeathPosition.y + purpleVector.y * VOID_FLOOD_MARKER_SIDE_OFFSET,
      },
      shape: 'diamond',
      radius: 0.9,
      color: '#a855f7',
      resolveAfterMs: VOID_FLOOD_CAST_MS,
    });
    ctx.spawn.fieldMarker({
      label: '死者暗黑光',
      center: {
        x: exdeathPosition.x + blueVector.x * VOID_FLOOD_MARKER_SIDE_OFFSET,
        y: exdeathPosition.y + blueVector.y * VOID_FLOOD_MARKER_SIDE_OFFSET,
      },
      shape: 'triangle',
      radius: 0.9,
      color: '#38bdf8',
      resolveAfterMs: VOID_FLOOD_CAST_MS,
    });
    ctx.state.setValue('kefkaP4:voidFlood', { truth, purpleSide, blueSide });
  });
  ctx.timeline.at(52_000, () => {
    const state = ctx.state.getValue<{
      truth: TrickTruth;
      purpleSide: 'left' | 'right';
      blueSide: 'left' | 'right';
    }>('kefkaP4:voidFlood');

    if (state === undefined) {
      return;
    }

    const exdeathPosition = getExdeathPosition(ctx);
    const realPurpleKind: DarkLightKind = isFake(state.truth) ? 'dead' : 'living';
    const realBlueKind: DarkLightKind = isFake(state.truth) ? 'living' : 'dead';

    for (const actor of ctx.select.allPlayers()) {
      if (isActorOnVoidSide(actor, exdeathPosition, state.purpleSide)) {
        resolveDarkLightHit(ctx, actor, realPurpleKind);
      } else if (isActorOnVoidSide(actor, exdeathPosition, state.blueSide)) {
        resolveDarkLightHit(ctx, actor, realBlueKind);
      }
    }
  });
}

function buildKefkaP4FirstScript(ctx: BattleScriptContext): void {
  ctx.timeline.at(0, () => {
    const bosses = getInitialOutsideBosses();

    setChaosPosition(ctx, bosses.chaos);
    setExdeathPosition(ctx, bosses.exdeath);
    spawnEnemyMarker(ctx, '卡奥斯', bosses.chaos, 'kefka_p4_chaos', 32_000, '#a855f7');
    spawnEnemyMarker(ctx, '艾克斯迪斯', bosses.exdeath, 'kefka_p4_exdeath', 43_000, '#f97316');
  });

  scheduleMagic(ctx, 0, 1);
  scheduleBigCross(ctx, 0, 1);
  scheduleChaosElementPair(ctx);
  scheduleMagic(ctx, 14_000, 2);
  scheduleBigCross(ctx, 15_000, 2);
  scheduleMagic(ctx, 29_000, 3);
  scheduleFinalBigCross(ctx);

  ctx.timeline.at(43_000, () => {
    setExdeathPosition(ctx, CENTER);
  });
  ctx.timeline.at(44_000, () => {
    reappearExdeath(ctx);
  });
  scheduleVoidFlood(ctx);
  scheduleKefkaNoopCast(ctx, 56_000, 'kefka_p4_mana_store', '魔力储存', MANA_STORE_CAST_MS);
  scheduleMagic(ctx, 63_000, 4, {
    actionId: 'kefka_p4_crackling_thunder',
    actionName: '劈啪啪暴雷',
    components: ['thunder'],
  });
  scheduleFlappingUltimate(ctx);
  scheduleMagic(ctx, 80_000, 5, {
    actionId: 'kefka_p4_expanded_deep_freeze',
    actionName: '扩大大冰封',
    components: ['ice'],
  });
  scheduleManaReleaseMagic(ctx);

  ctx.timeline.at(COMPLETE_AT, () => {
    ctx.state.complete();
  });
}

export const KEFKA_P4_FIRST_TRICK_BATTLE: BattleDefinition = {
  id: 'kefka_p4_first_trick',
  name: '凯夫卡P4：一运',
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
  buildScript: buildKefkaP4FirstScript,
  failureTexts: {
    outOfBounds: (actorName) => `${actorName} 越过场地边界`,
    mechanicDeath: (actorName, sourceLabel) => `${actorName} 因 ${sourceLabel} 死亡`,
  },
};

export const KEFKA_P4_FIRST_TRICK_TESTING = {
  COMPLETE_AT,
  MAGIC_CAST_MS,
  MANA_STORE_CAST_MS,
  BIG_CROSS_CAST_MS,
  CHAOS_CAST_MS,
  CHAOS_ELEMENT_DELAY_MS,
  VOID_FLOOD_CAST_MS,
  MANA_RELEASE_CAST_MS,
  TELEGRAPH_MS,
  CURSE_HOWL_STATUS_ID,
  FORKED_LIGHTNING_STATUS_ID,
  COMPRESSED_WATER_STATUS_ID,
  ACCELERATION_BOMB_STATUS_ID,
  ALLAGAN_FIELD_STATUS_ID,
  BEYOND_DEATH_STATUS_ID,
  LIVING_WOUND_STATUS_ID,
  DEAD_WOUND_STATUS_ID,
  CHAOS_FIRE_STATUS_ID,
  CHAOS_WATER_STATUS_ID,
  THUNDER_NEAR_OFFSET,
  THUNDER_FAR_OFFSET,
  createMagicPattern,
  isActorInsideRectangle,
  isActorInsideFan,
};
