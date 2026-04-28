import type { BattleDefinition, BattleScriptContext } from '@ff14arena/core';
import { createFacingTowards, createPointOnRadius, distance } from '@ff14arena/core';
import type {
  BaseActorSnapshot,
  MapMarker,
  MechanicSnapshot,
  PartySlot,
  StatusId,
  Vector2,
} from '@ff14arena/shared';
import { PARTY_SLOT_ORDER } from '@ff14arena/shared';
import type { BattleBotController } from '../runtime/bot';
import { createMoveDirection, createPose } from '../runtime/bot';

type ProgramNumber = 1 | 2 | 3 | 4;
type ShockwaveTether = Extract<MechanicSnapshot, { kind: 'tether' }>;
type ProgramAssignments = Record<ProgramNumber, [PartySlot, PartySlot]>;
type BotTetherLane = [PartySlot, PartySlot, PartySlot, PartySlot];
type BotTetherLanes = [BotTetherLane, BotTetherLane];

interface ProgramRound {
  index: ProgramNumber;
  towerNumber: ProgramNumber;
  tetherNumber: ProgramNumber;
  startAt: number;
  resolveAt: number;
}

interface ActiveProgramRound extends ProgramRound {
  towerPositions: [Vector2, Vector2];
  tetherPositions: [Vector2, Vector2];
}

const PROGRAM_NUMBERS = [1, 2, 3, 4] as const;
const TETHER_LANES = [0, 1] as const;
const TOWER_ASSIGNMENT_SLOT_PRIORITY = ['H1', 'MT', 'ST', 'D1', 'D2', 'D3', 'D4', 'H2'] as const;

const STATUS_BY_NUMBER: Record<ProgramNumber, StatusId> = {
  1: 'program_loop_1',
  2: 'program_loop_2',
  3: 'program_loop_3',
  4: 'program_loop_4',
};

const PROGRAM_STATUS_IDS = new Set<StatusId>(Object.values(STATUS_BY_NUMBER));

const STATUS_NAME_BY_ID: Record<StatusId, string> = {
  program_loop_1: '一号',
  program_loop_2: '二号',
  program_loop_3: '三号',
  program_loop_4: '四号',
  hp_penalty: '衰减',
  twice_come_ruin: '破灭',
  doom: '死宣',
  memory_loss: '遗忘',
};

// 通用连线仍按真实穿线结算；这里的冷却只用于避免 Bot 固定脚本同轮连续传线。
const TOP_TETHER_TRANSFER_COOLDOWN_MS = 500;
const TOP_BOT_TETHER_TRANSFER_COOLDOWN_MS = 8_000;
const GEOMETRY_EPSILON = 0.001;

const DEFAULT_ASSIGNMENTS: ProgramAssignments = {
  1: ['MT', 'ST'],
  2: ['H1', 'H2'],
  3: ['D1', 'D2'],
  4: ['D3', 'D4'],
};

const TOWER_RADIUS = 3;
const SHOCKWAVE_RADIUS = 15;
const SHOCKWAVE_DAMAGE = 1;
const TOWER_DAMAGE = 1;
const SHOCKWAVE_TELEGRAPH_MS = 500;
const TWICE_RUIN_DURATION_MS = 10_000;
const HP_PENALTY_DURATION_MS = 9_000;
const PROGRAM_START_AT = 10_000;
const PROGRAM_END_AT = 47_500;
// Blaster 读条 7.6s，读条结束与本轮塔和冲击波结算同 tick。
const BLASTER_CAST_MS = 7_600;
const MAP_MARKER_RADIUS = 15;
const ROUND_MARKER_RADIUS = 2;
const SQUARE_MARKER_SIZE = 3;
const ARENA_RADIUS = 25;
const BOSS_TARGET_RING_RADIUS = 15;
const NORTH_ANGLE = -Math.PI / 2;
const MAP_MARKER_ANGLE_STEP = Math.PI / 4;
const INITIAL_PARTY_FACING = NORTH_ANGLE;
const PROGRAM_CAST_START_AT = 6_000;
const PROGRAM_CAST_MS = 4_000;
const MEMORY_LOSS_DURATION_MS = 1_000;
const PROGRAM_DURATION_BASE_MS = 7_000;
const PROGRAM_DURATION_STEP_MS = 9_000;

// Bot 等待点位于塔方向的内侧，避免和外侧冲击波点重叠。
const BOT_WAITING_RADIUS = 10;
// Bot 接线点取首领到持线者线段上的一段，随后再越过该点，确保触发穿线。
const BOT_TETHER_PICKUP_DISTANCE = 6;
const BOT_TETHER_PICKUP_MIN_RATIO = 0.25;
const BOT_TETHER_PICKUP_MAX_RATIO = 0.65;
const BOT_TETHER_CROSSING_OVERSHOOT = 1.5;
// 冲击波固定拉到正点 17m，避免 Bot 把线带到倾斜方向。
const SHOCKWAVE_POSITION_RADIUS = 17;

const TOWERS = {
  N_W: { x: -3, y: -15 },
  N_E: { x: 3, y: -15 },
  E_N: { x: 15, y: -3 },
  E_S: { x: 15, y: 3 },
  S_E: { x: 3, y: 15 },
  S_W: { x: -3, y: 15 },
  W_S: { x: -15, y: 3 },
  W_N: { x: -15, y: -3 },
} as const satisfies Record<string, Vector2>;

const TOWER_RING = [
  TOWERS.W_N,
  TOWERS.N_W,
  TOWERS.N_E,
  TOWERS.E_N,
  TOWERS.E_S,
  TOWERS.S_E,
  TOWERS.S_W,
  TOWERS.W_S,
] as const satisfies readonly Vector2[];

// 从 A 点左侧开始顺时针找塔；第一座塔由高优先级玩家处理，第二座塔由低优先级玩家处理。
const TOWER_ASSIGNMENT_SCAN_ORDER = [
  TOWERS.N_W,
  TOWERS.N_E,
  TOWERS.E_N,
  TOWERS.E_S,
  TOWERS.S_E,
  TOWERS.S_W,
  TOWERS.W_S,
  TOWERS.W_N,
] as const satisfies readonly Vector2[];

// TOP P1 每轮双塔只允许相隔 90 度或 180 度，按 8 点环形索引表示为 2/4/6。
const VALID_TOWER_INDEX_DIFFS = new Set([2, 4, 6]);
const FALLBACK_TOWER_INDEX_PAIRS = [
  [1, 5],
  [3, 7],
  [2, 6],
  [4, 0],
] as const satisfies ReadonlyArray<readonly [number, number]>;

const SHOCKWAVE_CARDINAL_POSITIONS = [
  createPointOnRadius(NORTH_ANGLE, SHOCKWAVE_POSITION_RADIUS),
  createPointOnRadius(0, SHOCKWAVE_POSITION_RADIUS),
  createPointOnRadius(Math.PI / 2, SHOCKWAVE_POSITION_RADIUS),
  createPointOnRadius(Math.PI, SHOCKWAVE_POSITION_RADIUS),
] as const satisfies readonly Vector2[];

const INITIAL_SOUTH_POSITIONS: Record<PartySlot, Vector2> = {
  MT: { x: -5.25, y: 15 },
  ST: { x: -3.75, y: 15 },
  H1: { x: -2.25, y: 15 },
  H2: { x: -0.75, y: 15 },
  D1: { x: 0.75, y: 15 },
  D2: { x: 2.25, y: 15 },
  D3: { x: 3.75, y: 15 },
  D4: { x: 5.25, y: 15 },
};

const MARKER_COLORS = {
  red: '#ef4444',
  yellow: '#f4d35e',
  cyan: '#7dd3fc',
  purple: '#a78bfa',
} as const;

const TOP_MAP_MARKER_BASES: Array<Omit<MapMarker, 'position' | 'radius' | 'size'>> = [
  { label: 'A', shape: 'circle', color: MARKER_COLORS.red },
  { label: '2', shape: 'square', color: MARKER_COLORS.yellow },
  { label: 'B', shape: 'circle', color: MARKER_COLORS.yellow },
  { label: '3', shape: 'square', color: MARKER_COLORS.cyan },
  { label: 'C', shape: 'circle', color: MARKER_COLORS.cyan },
  { label: '4', shape: 'square', color: MARKER_COLORS.purple },
  { label: 'D', shape: 'circle', color: MARKER_COLORS.purple },
  { label: '1', shape: 'square', color: MARKER_COLORS.red },
];

const TOP_MAP_MARKERS: MapMarker[] = TOP_MAP_MARKER_BASES.map((marker, index) => ({
  ...marker,
  position: createPointOnRadius(NORTH_ANGLE + MAP_MARKER_ANGLE_STEP * index, MAP_MARKER_RADIUS),
  ...(marker.shape === 'circle' ? { radius: ROUND_MARKER_RADIUS } : { size: SQUARE_MARKER_SIZE }),
}));

const ROUND_SCHEDULES: ProgramRound[] = [
  {
    index: 1,
    towerNumber: 1,
    tetherNumber: 3,
    startAt: 10_000,
    resolveAt: 17_600,
  },
  {
    index: 2,
    towerNumber: 2,
    tetherNumber: 4,
    startAt: 17_600,
    resolveAt: 26_600,
  },
  {
    index: 3,
    towerNumber: 3,
    tetherNumber: 1,
    startAt: 26_600,
    resolveAt: 35_600,
  },
  {
    index: 4,
    towerNumber: 4,
    tetherNumber: 2,
    startAt: 35_600,
    resolveAt: 44_600,
  },
];

function getRoundByIndex(rounds: ActiveProgramRound[], index: ProgramNumber): ActiveProgramRound {
  const round = rounds.find((candidate) => candidate.index === index);

  if (round === undefined) {
    throw new Error(`missing program round ${index}`);
  }

  return round;
}

function getProgramNumber(slot: PartySlot, assignments: ProgramAssignments): ProgramNumber {
  for (const [number, slots] of Object.entries(assignments)) {
    if (slots.includes(slot)) {
      return Number(number) as ProgramNumber;
    }
  }

  throw new Error(`missing program number for slot ${slot}`);
}

function shuffleSlots(slots: PartySlot[]): PartySlot[] {
  const shuffled = [...slots];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }

  return shuffled;
}

function shuffleNumbers(numbers: number[]): number[] {
  const shuffled = [...numbers];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }

  return shuffled;
}

function isValidTowerIndexPair(leftIndex: number, rightIndex: number): boolean {
  return VALID_TOWER_INDEX_DIFFS.has(Math.abs(leftIndex - rightIndex));
}

function getTowerScanIndex(position: Vector2): number {
  return TOWER_ASSIGNMENT_SCAN_ORDER.findIndex(
    (towerPosition) => towerPosition.x === position.x && towerPosition.y === position.y,
  );
}

function sortTowerPositionsByAssignmentOrder(
  towerPositions: [Vector2, Vector2],
): [Vector2, Vector2] {
  return [...towerPositions].sort(
    (left, right) => getTowerScanIndex(left) - getTowerScanIndex(right),
  ) as [Vector2, Vector2];
}

function getSlotPriorityIndex(slot: PartySlot): number {
  return TOWER_ASSIGNMENT_SLOT_PRIORITY.indexOf(slot);
}

function getProgramSlotsByPriority(
  assignments: ProgramAssignments,
  number: ProgramNumber,
): [PartySlot, PartySlot] {
  return [...assignments[number]].sort(
    (left, right) => getSlotPriorityIndex(left) - getSlotPriorityIndex(right),
  ) as [PartySlot, PartySlot];
}

function getProgramSlotLane(
  slot: PartySlot,
  assignments: ProgramAssignments,
  number: ProgramNumber,
): number {
  return getProgramSlotsByPriority(assignments, number).indexOf(slot);
}

function createRandomTowerGroups(): Array<[Vector2, Vector2]> {
  function pairRemainingTowerIndexes(remainingIndexes: number[]): Array<[number, number]> | null {
    if (remainingIndexes.length === 0) {
      return [];
    }

    const [leftIndex, ...restIndexes] = remainingIndexes;

    for (const rightIndex of shuffleNumbers(
      restIndexes.filter((index) => isValidTowerIndexPair(leftIndex!, index)),
    )) {
      const nextRemainingIndexes = restIndexes.filter((index) => index !== rightIndex);
      const pairs = pairRemainingTowerIndexes(nextRemainingIndexes);

      if (pairs !== null) {
        return [[leftIndex!, rightIndex], ...pairs];
      }
    }

    return null;
  }

  const indexPairs = pairRemainingTowerIndexes(shuffleNumbers(TOWER_RING.map((_, index) => index)));

  if (indexPairs === null) {
    throw new Error('无法为循环程序生成合法塔位组合');
  }

  return indexPairs.map(([leftIndex, rightIndex]) =>
    sortTowerPositionsByAssignmentOrder([TOWER_RING[leftIndex]!, TOWER_RING[rightIndex]!]),
  );
}

function createTetherPositions(towerPositions: [Vector2, Vector2]): [Vector2, Vector2] {
  const validPairs = SHOCKWAVE_CARDINAL_POSITIONS.flatMap((left, leftIndex) =>
    SHOCKWAVE_CARDINAL_POSITIONS.slice(leftIndex + 1).map((right) => [left, right] as const),
  )
    .map(([left, right]) => {
      const towerDistances = towerPositions.flatMap((tower) => [
        distance(left, tower),
        distance(right, tower),
      ]);
      const pairDistance = distance(left, right);

      return {
        positions: [left, right] as [Vector2, Vector2],
        score: Math.min(pairDistance, ...towerDistances),
      };
    })
    .filter((pair) => pair.score > SHOCKWAVE_RADIUS);

  const bestPair = validPairs.sort((left, right) => right.score - left.score)[0];

  if (bestPair === undefined) {
    throw new Error('无法为随机塔位生成安全的冲击波位置');
  }

  return bestPair.positions;
}

function createRounds(towerGroups: Array<[Vector2, Vector2]>): ActiveProgramRound[] {
  return ROUND_SCHEDULES.map((round, roundIndex) => {
    const roundTowerPositions = towerGroups[roundIndex]!;

    return {
      ...round,
      towerPositions: roundTowerPositions,
      tetherPositions: createTetherPositions(roundTowerPositions),
    };
  });
}

function createRandomRounds(): ActiveProgramRound[] {
  return createRounds(createRandomTowerGroups());
}

function createFallbackRounds(): ActiveProgramRound[] {
  return createRounds(
    FALLBACK_TOWER_INDEX_PAIRS.map(([leftIndex, rightIndex]) =>
      sortTowerPositionsByAssignmentOrder([TOWER_RING[leftIndex]!, TOWER_RING[rightIndex]!]),
    ),
  );
}

function createRandomAssignments(actors: BaseActorSnapshot[]): ProgramAssignments {
  const slots = actors
    .map((actor) => actor.slot)
    .filter((slot): slot is PartySlot => slot !== null);

  if (slots.length !== PARTY_SLOT_ORDER.length) {
    throw new Error('循环程序需要 8 名玩家参与点名');
  }

  const shuffled = shuffleSlots(slots);

  return {
    1: [shuffled[0]!, shuffled[1]!],
    2: [shuffled[2]!, shuffled[3]!],
    3: [shuffled[4]!, shuffled[5]!],
    4: [shuffled[6]!, shuffled[7]!],
  };
}

function getRoundAt(timeMs: number, rounds: ActiveProgramRound[]): ActiveProgramRound | null {
  return rounds.find((round) => timeMs >= round.startAt && timeMs < round.resolveAt) ?? null;
}

function getActorBySlot(actors: BaseActorSnapshot[], slot: PartySlot): BaseActorSnapshot {
  const actor = actors.find((candidate) => candidate.slot === slot);

  if (actor === undefined) {
    throw new Error(`missing actor for slot ${slot}`);
  }

  return actor;
}

function getTowerTarget(
  slot: PartySlot,
  round: ActiveProgramRound,
  assignments: ProgramAssignments,
): Vector2 | null {
  const towerIndex = getProgramSlotLane(slot, assignments, round.towerNumber);

  return towerIndex < 0 ? null : (round.towerPositions[towerIndex] ?? null);
}

function getTetherTarget(
  slot: PartySlot,
  round: ActiveProgramRound,
  assignments: ProgramAssignments,
): Vector2 | null {
  const tetherIndex = getProgramSlotLane(slot, assignments, round.tetherNumber);

  return tetherIndex < 0 ? null : (round.tetherPositions[tetherIndex] ?? null);
}

function getAssignedLane(slot: PartySlot, assignments: ProgramAssignments): number {
  for (const number of PROGRAM_NUMBERS) {
    const lane = getProgramSlotLane(slot, assignments, number);

    if (lane >= 0) {
      return lane;
    }
  }

  return 0;
}

function getWaitingPoint(
  slot: PartySlot,
  round: ActiveProgramRound | null,
  assignments: ProgramAssignments | null,
): Vector2 {
  if (round === null || assignments === null) {
    return INITIAL_SOUTH_POSITIONS[slot];
  }

  const towerIndex = getAssignedLane(slot, assignments);
  const tower = round.towerPositions[towerIndex]!;
  return createPointOnRadius(Math.atan2(tower.y, tower.x), BOT_WAITING_RADIUS);
}

function getActorsInside(actors: BaseActorSnapshot[], center: Vector2, radius: number) {
  return actors.filter((actor) => actor.alive && distance(actor.position, center) <= radius);
}

function hasStatus(actor: BaseActorSnapshot, statusId: StatusId): boolean {
  return actor.statuses.some((status) => status.id === statusId);
}

function getProgramStatus(actor: BaseActorSnapshot): StatusId | null {
  return actor.statuses.find((status) => PROGRAM_STATUS_IDS.has(status.id))?.id ?? null;
}

function applyTopStatus(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  statusId: StatusId,
  durationMs: number,
): void {
  ctx.status.apply([actor.id], statusId, durationMs, {
    name: STATUS_NAME_BY_ID[statusId] ?? statusId,
  });
}

function removeProgramStatus(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  statusId: StatusId,
  activeProgramStatuses: Map<string, StatusId>,
): void {
  if (activeProgramStatuses.get(actor.id) === statusId) {
    activeProgramStatuses.delete(actor.id);
  }

  ctx.status.remove([actor.id], statusId);
}

function expireProgramStatus(
  ctx: BattleScriptContext,
  actorId: string,
  statusId: StatusId,
  activeProgramStatuses: Map<string, StatusId>,
): void {
  if (activeProgramStatuses.get(actorId) !== statusId) {
    return;
  }

  activeProgramStatuses.delete(actorId);

  const actor = ctx.select.allPlayers().find((candidate) => candidate.id === actorId);

  if (actor === undefined || !actor.alive) {
    return;
  }

  applyTopStatus(ctx, actor, 'memory_loss', MEMORY_LOSS_DURATION_MS);
  ctx.damage.kill([actor.id], '遗忘');
}

function applyTwiceComeRuin(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  durationMs: number,
): void {
  if (hasStatus(actor, 'twice_come_ruin')) {
    applyTopStatus(ctx, actor, 'doom', durationMs);
    ctx.damage.kill([actor.id], '死亡宣告');
    return;
  }

  applyTopStatus(ctx, actor, 'twice_come_ruin', durationMs);
}

function applyTopDamage(
  ctx: BattleScriptContext,
  actor: BaseActorSnapshot,
  amount: number,
  sourceLabel: string,
): boolean {
  if (hasStatus(actor, 'hp_penalty')) {
    ctx.damage.kill([actor.id], sourceLabel);
    return false;
  }

  ctx.damage.apply([actor.id], amount, sourceLabel);
  return true;
}

function triggerTowerExplosion(ctx: BattleScriptContext, roundIndex: ProgramNumber): void {
  ctx.state.fail(`第 ${roundIndex} 轮塔爆炸`);
  ctx.damage.kill(
    ctx.select.alivePlayers().map((actor) => actor.id),
    '塔爆炸',
  );
  ctx.state.complete('failure');
}

function isShockwaveTether(mechanic: MechanicSnapshot): mechanic is ShockwaveTether {
  return mechanic.kind === 'tether' && mechanic.label === '冲击波连线';
}

function getShockwaveTethers(mechanics: MechanicSnapshot[]): ShockwaveTether[] {
  return mechanics.filter(isShockwaveTether).sort((left, right) => left.id.localeCompare(right.id));
}

function getTetherLane(
  slot: PartySlot,
  round: ProgramRound,
  assignments: ProgramAssignments,
): number {
  return getProgramSlotLane(slot, assignments, round.tetherNumber);
}

function getHeldTetherLane(actorId: string, tethers: ShockwaveTether[]): number {
  return tethers.findIndex((tether) => tether.targetId === actorId);
}

function getActorById(actors: BaseActorSnapshot[], actorId: string): BaseActorSnapshot | null {
  return actors.find((actor) => actor.id === actorId) ?? null;
}

function getBotTetherLane(assignments: ProgramAssignments, lane: 0 | 1): BotTetherLane {
  return [
    getProgramSlotsByPriority(assignments, 2)[lane],
    getProgramSlotsByPriority(assignments, 3)[lane],
    getProgramSlotsByPriority(assignments, 4)[lane],
    getProgramSlotsByPriority(assignments, 1)[lane],
  ];
}

function createBotTetherLanes(assignments: ProgramAssignments): BotTetherLanes {
  return [getBotTetherLane(assignments, 0), getBotTetherLane(assignments, 1)];
}

function isPartySlot(value: unknown): value is PartySlot {
  return PARTY_SLOT_ORDER.includes(value as PartySlot);
}

function isProgramAssignments(value: unknown): value is ProgramAssignments {
  const assignments = value as ProgramAssignments;

  return (
    typeof assignments === 'object' &&
    assignments !== null &&
    PROGRAM_NUMBERS.every(
      (number) =>
        Array.isArray(assignments[number]) &&
        assignments[number].length === 2 &&
        assignments[number].every(isPartySlot),
    )
  );
}

function isBotTetherLane(value: unknown): value is BotTetherLane {
  return Array.isArray(value) && value.length === 4 && value.every(isPartySlot);
}

function getAssignmentsFromScriptState(
  scriptState: Record<string, unknown>,
): ProgramAssignments | null {
  const assignments = scriptState['top:assignments'];

  return isProgramAssignments(assignments) ? assignments : null;
}

function getBotTetherLanesFromScriptState(
  scriptState: Record<string, unknown>,
): BotTetherLanes | null {
  const lanes = scriptState['top:botTetherLanes'];

  if (!Array.isArray(lanes) || lanes.length !== 2 || !lanes.every(isBotTetherLane)) {
    return null;
  }

  return lanes as BotTetherLanes;
}

function isVector2(value: unknown): value is Vector2 {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Vector2).x === 'number' &&
    typeof (value as Vector2).y === 'number'
  );
}

function subtractVector(left: Vector2, right: Vector2): Vector2 {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
  };
}

function isActiveProgramRound(value: unknown): value is ActiveProgramRound {
  const round = value as ActiveProgramRound;

  return (
    typeof round === 'object' &&
    round !== null &&
    PROGRAM_NUMBERS.includes(round.index) &&
    PROGRAM_NUMBERS.includes(round.towerNumber) &&
    PROGRAM_NUMBERS.includes(round.tetherNumber) &&
    Array.isArray(round.towerPositions) &&
    round.towerPositions.length === 2 &&
    round.towerPositions.every(isVector2) &&
    Array.isArray(round.tetherPositions) &&
    round.tetherPositions.length === 2 &&
    round.tetherPositions.every(isVector2) &&
    typeof round.startAt === 'number' &&
    typeof round.resolveAt === 'number'
  );
}

function getRoundsFromScriptState(
  scriptState: Record<string, unknown>,
): ActiveProgramRound[] | null {
  const rounds = scriptState['top:rounds'];

  if (
    !Array.isArray(rounds) ||
    rounds.length !== ROUND_SCHEDULES.length ||
    !rounds.every(isActiveProgramRound)
  ) {
    return null;
  }

  return rounds;
}

function getTetherPickupPoint(
  snapshot: Parameters<BattleBotController>[0]['snapshot'],
  lane: number,
): Vector2 | null {
  const tether = getShockwaveTethers(snapshot.mechanics)[lane];

  if (tether === undefined) {
    return null;
  }

  const holder = getActorById(snapshot.actors, tether.targetId);

  if (holder === null) {
    return null;
  }

  const source = snapshot.boss.position;
  const lineLength = distance(source, holder.position);

  if (lineLength <= GEOMETRY_EPSILON) {
    return null;
  }

  const ratio = Math.min(
    BOT_TETHER_PICKUP_MAX_RATIO,
    Math.max(BOT_TETHER_PICKUP_MIN_RATIO, BOT_TETHER_PICKUP_DISTANCE / lineLength),
  );

  return {
    x: source.x + (holder.position.x - source.x) * ratio,
    y: source.y + (holder.position.y - source.y) * ratio,
  };
}

function createTetherCrossingTarget(actorPosition: Vector2, pickupPoint: Vector2): Vector2 {
  const direction = subtractVector(pickupPoint, actorPosition);
  const directionLength = Math.hypot(direction.x, direction.y);

  if (directionLength <= GEOMETRY_EPSILON) {
    return pickupPoint;
  }

  return {
    x: pickupPoint.x + (direction.x / directionLength) * BOT_TETHER_CROSSING_OVERSHOOT,
    y: pickupPoint.y + (direction.y / directionLength) * BOT_TETHER_CROSSING_OVERSHOOT,
  };
}

function getNextBotTetherSlot(
  lane: number,
  tethers: ShockwaveTether[],
  actors: BaseActorSnapshot[],
  botTetherLanes: BotTetherLanes | null,
): PartySlot | null {
  const tether = tethers[lane];
  const laneSlots = botTetherLanes?.[lane];

  if (tether === undefined || laneSlots === undefined) {
    return null;
  }

  const holderSlot = getActorById(actors, tether.targetId)?.slot;

  if (holderSlot === null || holderSlot === undefined) {
    return null;
  }

  const holderIndex = laneSlots.indexOf(holderSlot);

  if (holderIndex < 0) {
    return null;
  }

  return laneSlots[(holderIndex + 1) % laneSlots.length]!;
}

export const TOP_P1_PROGRAM_LOOP_BATTLE: BattleDefinition = {
  id: 'top_p1_program_loop',
  name: '欧米茄绝境战 P1：循环程序',
  arenaRadius: ARENA_RADIUS,
  bossTargetRingRadius: BOSS_TARGET_RING_RADIUS,
  mapMarkers: TOP_MAP_MARKERS,
  slots: PARTY_SLOT_ORDER,
  bossName: '欧米茄',
  initialPartyPositions: {
    MT: { position: INITIAL_SOUTH_POSITIONS.MT, facing: INITIAL_PARTY_FACING },
    ST: { position: INITIAL_SOUTH_POSITIONS.ST, facing: INITIAL_PARTY_FACING },
    H1: { position: INITIAL_SOUTH_POSITIONS.H1, facing: INITIAL_PARTY_FACING },
    H2: { position: INITIAL_SOUTH_POSITIONS.H2, facing: INITIAL_PARTY_FACING },
    D1: { position: INITIAL_SOUTH_POSITIONS.D1, facing: INITIAL_PARTY_FACING },
    D2: { position: INITIAL_SOUTH_POSITIONS.D2, facing: INITIAL_PARTY_FACING },
    D3: { position: INITIAL_SOUTH_POSITIONS.D3, facing: INITIAL_PARTY_FACING },
    D4: { position: INITIAL_SOUTH_POSITIONS.D4, facing: INITIAL_PARTY_FACING },
  },
  failureTexts: {
    outOfBounds(actorName) {
      return `${actorName} 触碰死亡墙`;
    },
    mechanicDeath(actorName, sourceLabel) {
      return `${actorName} 因 ${sourceLabel} 死亡`;
    },
  },
  buildScript(ctx) {
    const activeProgramStatuses = new Map<string, StatusId>();

    ctx.timeline.at(PROGRAM_CAST_START_AT, () => {
      ctx.boss.cast('program_loop', '循环程序', PROGRAM_CAST_MS);
    });

    ctx.timeline.at(PROGRAM_START_AT, () => {
      const actors = ctx.select.allPlayers();
      const assignments = createRandomAssignments(actors);
      const rounds = createRandomRounds();
      ctx.state.setValue('top:assignments', assignments);
      ctx.state.setValue('top:botTetherLanes', createBotTetherLanes(assignments));
      ctx.state.setValue('top:rounds', rounds);

      for (const actor of ctx.select.alivePlayers()) {
        if (actor.slot === null) {
          continue;
        }

        const number = getProgramNumber(actor.slot, assignments);
        const statusId = STATUS_BY_NUMBER[number];
        const durationMs = number * PROGRAM_DURATION_STEP_MS + PROGRAM_DURATION_BASE_MS;
        applyTopStatus(ctx, actor, statusId, durationMs);
        activeProgramStatuses.set(actor.id, statusId);
        ctx.timeline.after(durationMs, () => {
          expireProgramStatus(ctx, actor.id, statusId, activeProgramStatuses);
        });
      }

      for (const lane of TETHER_LANES) {
        const slot = getProgramSlotsByPriority(assignments, 2)[lane];
        ctx.spawn.tether({
          label: '冲击波连线',
          target: getActorBySlot(actors, slot),
          botTransferSequence: getBotTetherLane(assignments, lane).map((laneSlot) =>
            getActorBySlot(actors, laneSlot),
          ),
          botTransferCooldownMs: TOP_BOT_TETHER_TRANSFER_COOLDOWN_MS,
          transferCooldownMs: TOP_TETHER_TRANSFER_COOLDOWN_MS,
          allowTransfer: true,
          allowDeadRetarget: true,
          preventTargetHoldingOtherTether: true,
          resolveAfterMs: PROGRAM_END_AT - PROGRAM_START_AT,
        });
      }
    });

    for (const round of ROUND_SCHEDULES) {
      ctx.timeline.at(round.resolveAt - BLASTER_CAST_MS, () => {
        ctx.boss.cast(`shockwave_${round.index}`, '冲击波', BLASTER_CAST_MS);
      });

      ctx.timeline.at(round.resolveAt - SHOCKWAVE_TELEGRAPH_MS, () => {
        for (const tether of getShockwaveTethers(ctx.mechanics.all())) {
          const handler = getActorById(ctx.select.allPlayers(), tether.targetId);

          if (handler === null) {
            continue;
          }

          ctx.spawn.circleTelegraph({
            label: '冲击波预兆',
            center: handler.position,
            radius: SHOCKWAVE_RADIUS,
            resolveAfterMs: SHOCKWAVE_TELEGRAPH_MS,
          });
        }
      });

      ctx.timeline.at(round.startAt, () => {
        const activeRound = getRoundByIndex(
          ctx.state.getValue<ActiveProgramRound[]>('top:rounds') ?? createFallbackRounds(),
          round.index,
        );
        ctx.state.setValue('top:activeRound', activeRound.index);

        for (const towerPosition of activeRound.towerPositions) {
          ctx.spawn.tower({
            label: '塔判定',
            center: towerPosition,
            radius: TOWER_RADIUS,
            resolveAfterMs: activeRound.resolveAt - activeRound.startAt,
          });
        }
      });

      ctx.timeline.at(round.resolveAt, () => {
        const activeRound = getRoundByIndex(
          ctx.state.getValue<ActiveProgramRound[]>('top:rounds') ?? createFallbackRounds(),
          round.index,
        );
        const actors = ctx.select.allPlayers();
        const assignments =
          ctx.state.getValue<ProgramAssignments>('top:assignments') ?? DEFAULT_ASSIGNMENTS;
        for (const [towerIndex, towerPosition] of activeRound.towerPositions.entries()) {
          const hits = getActorsInside(actors, towerPosition, TOWER_RADIUS);
          const validHits = hits
            .map((actor) => ({
              actor,
              statusId: getProgramStatus(actor),
            }))
            .filter(
              (hit): hit is { actor: BaseActorSnapshot; statusId: StatusId } =>
                hit.statusId !== null,
            );

          if (validHits.length === 0) {
            triggerTowerExplosion(ctx, activeRound.index);
            return;
          }

          for (const hit of validHits) {
            if (applyTopDamage(ctx, hit.actor, TOWER_DAMAGE, '塔判定')) {
              applyTwiceComeRuin(ctx, hit.actor, TWICE_RUIN_DURATION_MS);
            }
            removeProgramStatus(ctx, hit.actor, hit.statusId, activeProgramStatuses);
          }

          const expectedSlot = getProgramSlotsByPriority(assignments, activeRound.towerNumber)[
            towerIndex
          ];
          const handler =
            validHits.find((candidate) => candidate.actor.slot === expectedSlot)?.actor ??
            validHits[0]!.actor;

          if (handler.slot !== expectedSlot) {
            ctx.state.fail(`${handler.name} 在错误位置处理塔判定`);
          }
        }

        const activeTethers = getShockwaveTethers(ctx.mechanics.all());
        const tetherSlots = getProgramSlotsByPriority(assignments, activeRound.tetherNumber);

        tetherSlots.forEach((slot, tetherIndex) => {
          const expectedActor = getActorBySlot(actors, slot);
          const tether = activeTethers[tetherIndex];
          const center = activeRound.tetherPositions[tetherIndex];

          if (tether === undefined || center === undefined) {
            ctx.state.fail(`第 ${activeRound.index} 轮冲击波缺少固定位置`);
            return;
          }

          const handler = actors.find((actor) => actor.id === tether.targetId);

          if (handler === undefined) {
            ctx.state.fail(`第 ${activeRound.index} 轮冲击波没有持有者`);
            return;
          }

          if (handler.id !== expectedActor.id) {
            ctx.state.fail(`${handler.name} 在错误轮次处理冲击波`);
          }

          const hits = getActorsInside(actors, handler.position, SHOCKWAVE_RADIUS);

          const towerGroup = getProgramSlotsByPriority(assignments, activeRound.towerNumber);
          const hitTowerMember = hits.some(
            (actor) => actor.slot !== null && towerGroup.includes(actor.slot),
          );

          if (hitTowerMember) {
            ctx.state.fail(`第 ${activeRound.index} 轮冲击波命中踩塔玩家`);
          }

          for (const hit of hits) {
            if (applyTopDamage(ctx, hit, SHOCKWAVE_DAMAGE, '冲击波')) {
              applyTwiceComeRuin(ctx, hit, TWICE_RUIN_DURATION_MS);
              applyTopStatus(ctx, hit, 'hp_penalty', HP_PENALTY_DURATION_MS);
            }
          }
        });
      });
    }

    ctx.timeline.at(PROGRAM_END_AT, () => {
      ctx.state.complete();
    });
  },
};

export const TOP_P1_PROGRAM_LOOP_BOT_CONTROLLER: BattleBotController = ({
  snapshot,
  slot,
  actor,
}) => {
  const rounds = getRoundsFromScriptState(snapshot.scriptState);
  const round = rounds === null ? null : getRoundAt(snapshot.timeMs, rounds);
  const faceAngle = createFacingTowards(actor.position, snapshot.boss.position);
  const tethers = getShockwaveTethers(snapshot.mechanics);
  const assignments = getAssignmentsFromScriptState(snapshot.scriptState);
  const botTetherLanes = getBotTetherLanesFromScriptState(snapshot.scriptState);
  const heldLane = getHeldTetherLane(actor.id, tethers);
  let target = getWaitingPoint(slot, round, assignments);

  if (round !== null && assignments !== null) {
    const tetherLane = getTetherLane(slot, round, assignments);
    const tetherTarget = getTetherTarget(slot, round, assignments);

    if (tetherLane >= 0 && tetherTarget !== null) {
      const laneTether = tethers[tetherLane];
      const pickupTarget = getTetherPickupPoint(snapshot, tetherLane);
      const nextBotTetherSlot = getNextBotTetherSlot(
        tetherLane,
        tethers,
        snapshot.actors,
        botTetherLanes,
      );

      if (laneTether?.targetId === actor.id || pickupTarget === null) {
        target = tetherTarget;
      } else if (nextBotTetherSlot === slot) {
        target = createTetherCrossingTarget(actor.position, pickupTarget);
      } else {
        target = getTowerTarget(slot, round, assignments) ?? target;
      }
    } else if (heldLane >= 0) {
      const heldTarget = getActorById(snapshot.actors, tethers[heldLane]!.targetId);
      target = heldTarget?.position ?? actor.position;
    } else {
      target = getTowerTarget(slot, round, assignments) ?? target;
    }
  }

  return {
    pose: createPose(actor, createMoveDirection(actor.position, target), faceAngle),
  };
};
