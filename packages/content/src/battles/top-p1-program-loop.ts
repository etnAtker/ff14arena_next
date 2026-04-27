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

interface ProgramRound {
  index: ProgramNumber;
  towerNumber: ProgramNumber;
  tetherNumber: ProgramNumber;
  towerPositions: [Vector2, Vector2];
  tetherPositions: [Vector2, Vector2];
  startAt: number;
  resolveAt: number;
}

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

const TOP_TETHER_TRANSFER_RADIUS = 0.6;
const TOP_TETHER_TRANSFER_COOLDOWN_MS = 500;
const TOP_TETHER_MIN_SOURCE_DISTANCE = 3;

const DEFAULT_ASSIGNMENTS: ProgramAssignments = {
  1: ['MT', 'ST'],
  2: ['H1', 'H2'],
  3: ['D1', 'D2'],
  4: ['D3', 'D4'],
};

const TOWER_RADIUS = 5;
const SHOCKWAVE_RADIUS = 15;
const SHOCKWAVE_DAMAGE = 1;
const TOWER_DAMAGE = 1;
const TWICE_RUIN_DURATION_MS = 10_000;
const HP_PENALTY_DURATION_MS = 9_000;
const PROGRAM_START_AT = 10_000;
const PROGRAM_END_AT = 47_500;
const SHOCKWAVE_CAST_MS = 7_600;
const MAP_MARKER_RADIUS = 15;
const ROUND_MARKER_RADIUS = 2;
const SQUARE_MARKER_SIZE = 3;

const TOWERS = {
  N_W: { x: -5, y: -15 },
  N_E: { x: 5, y: -15 },
  E_N: { x: 15, y: -5 },
  E_S: { x: 15, y: 5 },
  S_E: { x: 5, y: 15 },
  S_W: { x: -5, y: 15 },
  W_S: { x: -15, y: 5 },
  W_N: { x: -15, y: -5 },
} as const satisfies Record<string, Vector2>;

const SHOCK_POSITIONS = {
  east: { x: 17, y: 0 },
  west: { x: -17, y: 0 },
  north: { x: 0, y: -17 },
  south: { x: 0, y: 17 },
} as const satisfies Record<string, Vector2>;

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
  position: createPointOnRadius(-Math.PI / 2 + (Math.PI / 4) * index, MAP_MARKER_RADIUS),
  ...(marker.shape === 'circle' ? { radius: ROUND_MARKER_RADIUS } : { size: SQUARE_MARKER_SIZE }),
}));

const ROUNDS: ProgramRound[] = [
  {
    index: 1,
    towerNumber: 1,
    tetherNumber: 3,
    towerPositions: [TOWERS.N_W, TOWERS.S_E],
    tetherPositions: [SHOCK_POSITIONS.east, SHOCK_POSITIONS.west],
    startAt: 10_000,
    resolveAt: 17_600,
  },
  {
    index: 2,
    towerNumber: 2,
    tetherNumber: 4,
    towerPositions: [TOWERS.E_N, TOWERS.W_S],
    tetherPositions: [SHOCK_POSITIONS.north, SHOCK_POSITIONS.south],
    startAt: 17_600,
    resolveAt: 26_600,
  },
  {
    index: 3,
    towerNumber: 3,
    tetherNumber: 1,
    towerPositions: [TOWERS.N_E, TOWERS.S_W],
    tetherPositions: [SHOCK_POSITIONS.east, SHOCK_POSITIONS.west],
    startAt: 26_600,
    resolveAt: 35_600,
  },
  {
    index: 4,
    towerNumber: 4,
    tetherNumber: 2,
    towerPositions: [TOWERS.E_S, TOWERS.W_N],
    tetherPositions: [SHOCK_POSITIONS.north, SHOCK_POSITIONS.south],
    startAt: 35_600,
    resolveAt: 44_600,
  },
];

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

function getRoundAt(timeMs: number): ProgramRound | null {
  return ROUNDS.find((round) => timeMs >= round.startAt && timeMs < round.resolveAt) ?? null;
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
  round: ProgramRound,
  assignments: ProgramAssignments,
): Vector2 | null {
  const towerSlots = assignments[round.towerNumber];
  const towerIndex = towerSlots.indexOf(slot);

  return towerIndex < 0 ? null : (round.towerPositions[towerIndex] ?? null);
}

function getTetherTarget(
  slot: PartySlot,
  round: ProgramRound,
  assignments: ProgramAssignments,
): Vector2 | null {
  const tetherSlots = assignments[round.tetherNumber];
  const tetherIndex = tetherSlots.indexOf(slot);

  return tetherIndex < 0 ? null : (round.tetherPositions[tetherIndex] ?? null);
}

function getAssignedLane(slot: PartySlot, assignments: ProgramAssignments): number {
  for (const slots of Object.values(assignments)) {
    const lane = slots.indexOf(slot);

    if (lane >= 0) {
      return lane;
    }
  }

  return 0;
}

function getWaitingPoint(
  slot: PartySlot,
  round: ProgramRound | null,
  assignments: ProgramAssignments | null,
): Vector2 {
  if (round === null || assignments === null) {
    return INITIAL_SOUTH_POSITIONS[slot];
  }

  const towerIndex = getAssignedLane(slot, assignments);
  const tower = round.towerPositions[towerIndex]!;
  return createPointOnRadius(Math.atan2(tower.y, tower.x), 8);
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

  applyTopStatus(ctx, actor, 'memory_loss', 1_000);
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
  return assignments[round.tetherNumber].indexOf(slot);
}

function getHeldTetherLane(actorId: string, tethers: ShockwaveTether[]): number {
  return tethers.findIndex((tether) => tether.targetId === actorId);
}

function getActorById(actors: BaseActorSnapshot[], actorId: string): BaseActorSnapshot | null {
  return actors.find((actor) => actor.id === actorId) ?? null;
}

function getTetherAllowedSlots(
  assignments: ProgramAssignments,
  lane: 0 | 1,
): [PartySlot, PartySlot, PartySlot, PartySlot] {
  return [assignments[2][lane], assignments[3][lane], assignments[4][lane], assignments[1][lane]];
}

function getAssignmentsFromTethers(
  actors: BaseActorSnapshot[],
  tethers: ShockwaveTether[],
): ProgramAssignments | null {
  if (tethers.length < 2) {
    return null;
  }

  const nextAssignments: Partial<ProgramAssignments> = {};

  for (const number of [1, 2, 3, 4] as const) {
    nextAssignments[number] = [DEFAULT_ASSIGNMENTS[number][0], DEFAULT_ASSIGNMENTS[number][1]];
  }

  for (const lane of [0, 1] as const) {
    const allowedTargetIds = tethers[lane]?.allowedTargetIds;

    if (allowedTargetIds === undefined || allowedTargetIds.length < 4) {
      return null;
    }

    const slots = allowedTargetIds
      .slice(0, 4)
      .map((targetId) => getActorById(actors, targetId)?.slot);

    if (slots.some((slot) => slot === null || slot === undefined)) {
      return null;
    }

    nextAssignments[2]![lane] = slots[0]!;
    nextAssignments[3]![lane] = slots[1]!;
    nextAssignments[4]![lane] = slots[2]!;
    nextAssignments[1]![lane] = slots[3]!;
  }

  return nextAssignments as ProgramAssignments;
}

function getAssignmentsFromSnapshot(
  snapshot: Parameters<BattleBotController>[0]['snapshot'],
): ProgramAssignments | null {
  return getAssignmentsFromTethers(snapshot.actors, getShockwaveTethers(snapshot.mechanics));
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

  if (lineLength <= 0.001) {
    return null;
  }

  const ratio = Math.min(0.65, Math.max(0.25, 6 / lineLength));

  return {
    x: source.x + (holder.position.x - source.x) * ratio,
    y: source.y + (holder.position.y - source.y) * ratio,
  };
}

export const TOP_P1_PROGRAM_LOOP_BATTLE: BattleDefinition = {
  id: 'top_p1_program_loop',
  name: '欧米茄绝境战 P1：循环程序',
  arenaRadius: 20,
  bossTargetRingRadius: 15,
  mapMarkers: TOP_MAP_MARKERS,
  slots: PARTY_SLOT_ORDER,
  bossName: '欧米茄',
  initialPartyPositions: {
    MT: { position: INITIAL_SOUTH_POSITIONS.MT, facing: -Math.PI / 2 },
    ST: { position: INITIAL_SOUTH_POSITIONS.ST, facing: -Math.PI / 2 },
    H1: { position: INITIAL_SOUTH_POSITIONS.H1, facing: -Math.PI / 2 },
    H2: { position: INITIAL_SOUTH_POSITIONS.H2, facing: -Math.PI / 2 },
    D1: { position: INITIAL_SOUTH_POSITIONS.D1, facing: -Math.PI / 2 },
    D2: { position: INITIAL_SOUTH_POSITIONS.D2, facing: -Math.PI / 2 },
    D3: { position: INITIAL_SOUTH_POSITIONS.D3, facing: -Math.PI / 2 },
    D4: { position: INITIAL_SOUTH_POSITIONS.D4, facing: -Math.PI / 2 },
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

    ctx.state.setValue('top:rounds', ROUNDS);
    ctx.timeline.at(6_000, () => {
      ctx.boss.cast('program_loop', '循环程序', 4_000);
    });

    ctx.timeline.at(PROGRAM_START_AT, () => {
      const actors = ctx.select.allPlayers();
      const assignments = createRandomAssignments(actors);
      ctx.state.setValue('top:assignments', assignments);

      for (const actor of ctx.select.alivePlayers()) {
        if (actor.slot === null) {
          continue;
        }

        const number = getProgramNumber(actor.slot, assignments);
        const statusId = STATUS_BY_NUMBER[number];
        const durationMs = number * 9_000 + 7_000;
        applyTopStatus(ctx, actor, statusId, durationMs);
        activeProgramStatuses.set(actor.id, statusId);
        ctx.timeline.after(durationMs, () => {
          expireProgramStatus(ctx, actor.id, statusId, activeProgramStatuses);
        });
      }

      for (const lane of [0, 1] as const) {
        const slot = assignments[2][lane];
        const allowedTargets = getTetherAllowedSlots(assignments, lane).map((allowedSlot) =>
          getActorBySlot(actors, allowedSlot),
        );
        ctx.spawn.tether({
          label: '冲击波连线',
          target: getActorBySlot(actors, slot),
          allowedTargets,
          transferRadius: TOP_TETHER_TRANSFER_RADIUS,
          transferCooldownMs: TOP_TETHER_TRANSFER_COOLDOWN_MS,
          minSourceDistance: TOP_TETHER_MIN_SOURCE_DISTANCE,
          allowTransfer: true,
          allowDeadRetarget: true,
          preventTargetHoldingOtherTether: true,
          resolveAfterMs: PROGRAM_END_AT - PROGRAM_START_AT,
        });
      }
    });

    for (const round of ROUNDS) {
      ctx.timeline.at(round.startAt, () => {
        ctx.state.setValue('top:activeRound', round.index);

        for (const towerPosition of round.towerPositions) {
          ctx.spawn.tower({
            label: '塔判定',
            center: towerPosition,
            radius: TOWER_RADIUS,
            resolveAfterMs: round.resolveAt - round.startAt,
          });
        }

        ctx.boss.cast(`shockwave_${round.index}`, '冲击波', SHOCKWAVE_CAST_MS);
      });

      ctx.timeline.at(round.resolveAt, () => {
        const actors = ctx.select.allPlayers();
        const assignments =
          ctx.state.getValue<ProgramAssignments>('top:assignments') ?? DEFAULT_ASSIGNMENTS;
        round.towerPositions.forEach((towerPosition, towerIndex) => {
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

          for (const hit of validHits) {
            if (applyTopDamage(ctx, hit.actor, TOWER_DAMAGE, '塔判定')) {
              applyTwiceComeRuin(ctx, hit.actor, TWICE_RUIN_DURATION_MS);
            }
            removeProgramStatus(ctx, hit.actor, hit.statusId, activeProgramStatuses);
          }

          if (validHits.length !== 1) {
            ctx.state.fail(`第 ${round.index} 轮塔未被正确处理`);
            return;
          }

          const expectedSlot = assignments[round.towerNumber][towerIndex];
          const handler = validHits[0]!.actor;

          if (handler.slot !== expectedSlot) {
            ctx.state.fail(`${handler.name} 在错误位置处理塔判定`);
          }
        });

        const activeTethers = getShockwaveTethers(ctx.mechanics.all());
        const tetherSlots = assignments[round.tetherNumber];

        tetherSlots.forEach((slot, tetherIndex) => {
          const expectedActor = getActorBySlot(actors, slot);
          const tether = activeTethers[tetherIndex];
          const center = round.tetherPositions[tetherIndex];

          if (tether === undefined || center === undefined) {
            ctx.state.fail(`第 ${round.index} 轮冲击波缺少固定位置`);
            return;
          }

          const handler = actors.find((actor) => actor.id === tether.targetId);

          if (handler === undefined) {
            ctx.state.fail(`第 ${round.index} 轮冲击波没有持有者`);
            return;
          }

          if (handler.id !== expectedActor.id) {
            ctx.state.fail(`${handler.name} 在错误轮次处理冲击波`);
          }

          const hits = getActorsInside(actors, handler.position, SHOCKWAVE_RADIUS);

          const towerGroup = assignments[round.towerNumber];
          const hitTowerMember = hits.some(
            (actor) => actor.slot !== null && towerGroup.includes(actor.slot),
          );

          if (hitTowerMember) {
            ctx.state.fail(`第 ${round.index} 轮冲击波命中踩塔玩家`);
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

    ctx.timeline.at(47_500, () => {
      ctx.state.complete();
    });
  },
};

export const TOP_P1_PROGRAM_LOOP_BOT_CONTROLLER: BattleBotController = ({
  snapshot,
  slot,
  actor,
}) => {
  const round = getRoundAt(snapshot.timeMs);
  const faceAngle = createFacingTowards(actor.position, snapshot.boss.position);
  const tethers = getShockwaveTethers(snapshot.mechanics);
  const assignments = getAssignmentsFromSnapshot(snapshot);
  const heldLane = getHeldTetherLane(actor.id, tethers);
  let target = getWaitingPoint(slot, round, assignments);

  if (round !== null && assignments !== null) {
    const tetherLane = getTetherLane(slot, round, assignments);
    const tetherTarget = getTetherTarget(slot, round, assignments);

    if (tetherLane >= 0 && tetherTarget !== null) {
      const laneTether = tethers[tetherLane];
      const pickupTarget = getTetherPickupPoint(snapshot, tetherLane);

      if (laneTether?.targetId === actor.id || pickupTarget === null) {
        target = tetherTarget;
      } else {
        target = pickupTarget;
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
