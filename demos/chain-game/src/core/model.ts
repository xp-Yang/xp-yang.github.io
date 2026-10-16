export type Point = Readonly<{ x: number; y: number }>;
export type ColorId = 'blue' | 'green' | 'purple' | 'red';
export type ItemKind = 'shield' | 'teleport' | 'combo-3' | 'combo-5' | 'combo-10';

export interface Creep {
  id: string;
  kind: 'creep';
  pos: Point;
  color: ColorId;
  archetypeId: string;
  bornTurn: number;
  mood: 'calm' | 'angry';
  attackActiveFromTurn: number | null;
  damage: number;
}

export interface Gem {
  id: string;
  kind: 'gem';
  pos: Point;
  bornTurn: number;
  value: number;
}

export type Entity = Creep | Gem;

export type BuildEffect =
  | { type: 'block-creep-attack'; effectId: string; chargesPerRun: number }
  | {
      type: 'chain-reward-flat-bonus';
      effectId: string;
      /** Legacy field name: threshold counts both fruit and gem route nodes. */
      minKills: number;
      bonusValue: number;
    };

/** This snapshot stays fixed for the entire run, even if the catalog changes. */
export interface RunBuildSnapshot {
  catalogVersion: string;
  effects: readonly BuildEffect[];
}

export interface RunState {
  runId: string;
  levelId: string;
  /** Generated runs retain their complete definition across generator updates. */
  levelSnapshot?: LevelDefinition;
  rulesVersion: string;
  contentVersion: string;
  revision: number;
  turn: number;
  status: 'playing' | 'escaped' | 'dead';
  player: { pos: Point; hp: number; maxHp: number };
  entities: Record<string, Entity>;
  killCount: number;
  /** Optional only for saves created before elite fruit were introduced. */
  eliteKills?: number;
  /** Cumulative short routes this level; older saves default to zero. */
  shortChainCount?: number;
  /** Purchased consumables persist across levels until used. */
  inventory?: ItemKind[];
  /** A selected combo potion is spent only when a valid route is executed. */
  selectedComboIndex?: number;
  /** Collection bonus for this level; gem piles retain their original value. */
  gemMultiplier?: 1 | 2;
  carriedGems: number;
  pendingDrops: { value: number }[];
  exitUnlocked: boolean;
  rng: { board: number; rage: number; rewards: number };
  nextEntityId: number;
  build: RunBuildSnapshot;
  equipmentRuntime: Record<string, { remainingCharges: number }>;
}

export interface LevelDefinition {
  id: string;
  levelNumber: number;
  generation?: {
    version: 'v1';
    worldSeed: number;
    stageSeed: number;
    template: string;
  };
  name: string;
  description: string;
  width: number;
  height: number;
  mask: readonly string[];
  goal: number;
  playerStart: Point;
  exit: { pos: Point; entryCells: readonly Point[] };
  colors: readonly ColorId[];
  initialRows?: readonly string[];
  unlockAfter?: string;
  elite?: {
    initialPos: Point;
    minChain: number;
    /** Chance per newly spawned fruit while no elite remains on the board. */
    respawnChance: number;
  };
}

/** Event payloads retain removed entities and old positions for future animation. */
export type GameEvent =
  | { type: 'creep-killed'; entity: Creep }
  | { type: 'creep-crushed'; entity: Creep; gemId: string }
  | { type: 'gem-collected'; entity: Gem }
  | { type: 'item-consumed'; item: ItemKind; reason: 'combo' | 'shield' }
  | { type: 'player-moved'; from: Point; to: Point }
  | { type: 'exit-opened' }
  | {
      type: 'attack';
      attackerId: string;
      from: Point;
      to: Point;
      damage: number;
      blocked: boolean;
    }
  | { type: 'gem-spawned'; entity: Gem }
  | { type: 'reward-pending'; value: number }
  | { type: 'entity-moved'; entityId: string; from: Point; to: Point }
  | { type: 'creep-spawned'; entity: Creep }
  | { type: 'creep-enraged'; entityId: string; activeFromTurn: number }
  | { type: 'run-escaped'; carriedGems: number }
  | { type: 'run-ended'; lostGems: number };

export interface TurnPreview {
  valid: boolean;
  reason?: string;
  /** Fruit and gem piles count once, plus a selected combo potion; the exit never counts. */
  chainCount: number;
  kills: number;
  collectedGems: number;
  /** New reward value earned by the route, excluding earlier pending drops. */
  rewardValue: number;
  /** Total value of gem piles that will land, including pending drops paid out. */
  rewardCount: number;
  damage: number;
  attackers: string[];
  blocked: number;
  endpoint: Point;
  exits: boolean;
  remainingHp: number;
}

export interface TurnCommand {
  runId: string;
  revision: number;
  targets: readonly string[];
}

export type TurnResult =
  | { ok: true; state: RunState; events: GameEvent[]; preview: TurnPreview }
  | { ok: false; error: string };

export const samePoint = (a: Point, b: Point): boolean =>
  a.x === b.x && a.y === b.y;
export const adjacent = (a: Point, b: Point): boolean =>
  !samePoint(a, b) && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
export const cardinalAdjacent = (a: Point, b: Point): boolean =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
