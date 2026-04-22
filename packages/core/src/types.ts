import type {
  BaseActorSnapshot,
  BossSnapshot,
  DamageType,
  MechanicSnapshot,
  PartySlot,
  SimulationEvent,
  SimulationInput,
  SimulationSnapshot,
  StatusId,
  Vector2,
} from '@ff14arena/shared';

export interface SimulationConfig {
  tickRate?: number;
}

export interface PartyMemberBlueprint {
  slot: PartySlot;
  name: string;
  kind: 'player' | 'bot';
  actorId: string;
  ownerUserId?: string;
  online?: boolean;
  ready?: boolean;
}

export interface BattleFailureTextApi {
  outOfBounds: (actorName: string) => string;
  mechanicDeath: (actorName: string, sourceLabel: string) => string;
}

export interface BotDirective {
  moveDirection?: Vector2;
  faceTargetId?: string;
  faceAngle?: number;
  useKnockbackImmune?: boolean;
}

export interface BotDecisionContext<TBotContext = unknown> {
  snapshot: SimulationSnapshot;
  slot: PartySlot;
  actor: BaseActorSnapshot;
  botContext: TBotContext | null;
}

export interface TimelineApi {
  at(timeMs: number, fn: () => void): void;
  after(delayMs: number, fn: () => void): void;
  every(intervalMs: number, fn: () => void, windowMs?: number): void;
}

export interface BattleScriptContext<TBotContext = unknown> {
  readonly timeline: TimelineApi;
  readonly boss: {
    readonly id: string;
    readonly snapshot: () => BossSnapshot;
    cast(actionId: string, actionName: string, totalDurationMs: number): void;
    clearCast(): void;
  };
  readonly select: {
    allPlayers(): BaseActorSnapshot[];
    alivePlayers(): BaseActorSnapshot[];
    bySlot(slot: PartySlot): BaseActorSnapshot | undefined;
    randomPlayers(
      count: number,
      filter?: (actor: BaseActorSnapshot) => boolean,
    ): BaseActorSnapshot[];
    nearestTo(actorId: string, count?: number): BaseActorSnapshot[];
    farthestFrom(actorId: string, count?: number): BaseActorSnapshot[];
  };
  readonly spawn: {
    circleAoe(options: {
      label: string;
      radius: number;
      damage: number;
      damageType?: DamageType;
      resolveAfterMs?: number;
      sourceId?: string;
      center?: Vector2;
    }): MechanicSnapshot;
    donutAoe(options: {
      label: string;
      innerRadius: number;
      outerRadius: number;
      damage: number;
      damageType?: DamageType;
      resolveAfterMs?: number;
      sourceId?: string;
      center?: Vector2;
    }): MechanicSnapshot;
    shareAoe(options: {
      label: string;
      targets: BaseActorSnapshot[];
      radius: number;
      totalDamage: number;
      resolveAfterMs?: number;
      sourceId?: string;
    }): MechanicSnapshot[];
    spreadAoe(options: {
      label: string;
      targets: BaseActorSnapshot[];
      radius: number;
      damage: number;
      resolveAfterMs?: number;
      sourceId?: string;
    }): MechanicSnapshot[];
  };
  readonly status: {
    apply(
      targetIds: string[],
      statusId: StatusId,
      durationMs: number,
      options?: { multiplier?: number },
    ): void;
    grantKnockbackImmunity(targetIds: string[], durationMs: number): void;
  };
  readonly displacement: {
    knockback(targetIds: string[], source: Vector2, distance: number): void;
  };
  readonly state: {
    getBattleTime(): number;
    getValue<T>(key: string): T | undefined;
    setValue<T>(key: string, value: T): void;
    fail(reason: string): void;
    complete(outcome?: 'success' | 'failure'): void;
  };
  readonly bot: {
    setContext(context: TBotContext | null): void;
  };
  readonly ui: {
    setCastBar(actionId: string, actionName: string, totalDurationMs: number): void;
    clearCastBar(): void;
  };
}

export interface BattleDefinition<TBotContext = unknown> {
  id: string;
  name: string;
  arenaRadius: number;
  bossTargetRingRadius: number;
  slots: readonly PartySlot[];
  bossName: string;
  initialPartyPositions: Record<
    PartySlot,
    {
      position: Vector2;
      facing: number;
    }
  >;
  buildScript(ctx: BattleScriptContext<TBotContext>): void;
  getBotDirective(ctx: BotDecisionContext<TBotContext>): BotDirective;
  failureTexts: BattleFailureTextApi;
}

export interface SimulationInstance {
  readonly config: Required<SimulationConfig>;
  readonly running: boolean;
  loadBattle(options: {
    battle: BattleDefinition;
    roomId: string;
    party: PartyMemberBlueprint[];
  }): void;
  start(): void;
  stop(): void;
  tick(deltaMs: number): void;
  dispatchInput(input: SimulationInput): void;
  getSnapshot(): SimulationSnapshot;
  drainEvents(): SimulationEvent[];
  getAcknowledgedInputSeq(): number;
}
