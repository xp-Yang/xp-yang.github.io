import { getLevel, getRunLevel } from '../content/levels';
import { isElite } from './combat';
import {
  samePoint,
  type ColorId,
  type Creep,
  type GameEvent,
  type LevelDefinition,
  type Point,
  type RunBuildSnapshot,
  type RunState,
} from './model';
import { entityAt } from './path';
import { nextRandom, seedStreams } from './random';
import { rageRefillChance } from './rage';

export function isPlayable(level: LevelDefinition, pos: Point): boolean {
  return (
    pos.x >= 0 &&
    pos.x < level.width &&
    pos.y >= 0 &&
    pos.y < level.height &&
    level.mask[pos.y]?.[pos.x] === '.'
  );
}

export function newCreep(
  state: RunState,
  pos: Point,
  bornTurn: number,
  color?: ColorId,
): Creep {
  const level = getRunLevel(state);
  if (!color) {
    const random = nextRandom(state.rng.board);
    state.rng.board = random.state;
    color = level.colors[Math.floor(random.value * level.colors.length)];
  }
  const creep: Creep = {
    id: `creep-${state.nextEntityId++}`,
    kind: 'creep',
    pos: { ...pos },
    color,
    archetypeId: 'basic',
    bornTurn,
    mood: 'calm',
    attackActiveFromTurn: null,
    damage: 1,
  };
  if (
    level.elite &&
    (state.eliteKills ?? 0) > 0 &&
    !Object.values(state.entities).some(isElite)
  ) {
    const random = nextRandom(state.rng.board);
    state.rng.board = random.state;
    if (random.value < level.elite.respawnChance) {
      creep.archetypeId = 'elite';
      creep.mood = 'angry';
      creep.attackActiveFromTurn = bornTurn + 1;
    }
  }
  // Only refill births can become angry at random. Keep the board stream's
  // colour/elite rolls independent of ordinary anger rolls.
  const angryChance = bornTurn > 0 && !isElite(creep) ? rageRefillChance(state) : 0;
  if (angryChance > 0) {
    const random = nextRandom(state.rng.rage);
    state.rng.rage = random.state;
    if (random.value < angryChance) {
      creep.mood = 'angry';
      creep.attackActiveFromTurn = bornTurn + 1;
    }
  }
  return creep;
}

export function createRun(
  levelId: string,
  seed: number,
  hp = 3,
  runId = `${levelId}-${seed}`,
  build: RunBuildSnapshot = { catalogVersion: 'prototype-v1', effects: [] },
): RunState {
  const level = getLevel(levelId);
  const health = Math.max(
    0,
    Math.min(3, Number.isFinite(hp) ? Math.floor(hp) : 0),
  );
  const state: RunState = {
    runId,
    levelId,
    ...(level.generation ? { levelSnapshot: structuredClone(level) } : {}),
    rulesVersion: 'prototype-v1',
    contentVersion: '1',
    revision: 0,
    turn: 0,
    status: health > 0 ? 'playing' : 'dead',
    player: { pos: { ...level.playerStart }, hp: health, maxHp: 3 },
    entities: {},
    killCount: 0,
    eliteKills: 0,
    shortChainCount: 0,
    carriedGems: 0,
    pendingDrops: [],
    exitUnlocked: false,
    rng: seedStreams(level.generation?.stageSeed ?? seed),
    nextEntityId: 1,
    build: {
      ...build,
      effects: build.effects.map((effect) => ({ ...effect })),
    },
    equipmentRuntime: {},
  };
  for (const effect of build.effects) {
    if (effect.type === 'block-creep-attack')
      state.equipmentRuntime[effect.effectId] = {
        remainingCharges: effect.chargesPerRun,
      };
  }
  const colors: Record<string, ColorId> = {
    B: 'blue',
    G: 'green',
    P: 'purple',
    R: 'red',
  };
  for (let y = 0; y < level.height; y += 1) {
    for (let x = 0; x < level.width; x += 1) {
      const pos = { x, y };
      if (!isPlayable(level, pos) || samePoint(pos, state.player.pos)) continue;
      const preset = level.initialRows?.[y]?.[x];
      const creep = newCreep(
        state,
        pos,
        0,
        preset ? colors[preset] : undefined,
      );
      state.entities[creep.id] = creep;
    }
  }
  if (level.elite) {
    const guardian = entityAt(state, level.elite.initialPos);
    if (guardian?.kind === 'creep') {
      guardian.archetypeId = 'elite';
      guardian.mood = 'angry';
      guardian.attackActiveFromTurn = 1;
    }
  }
  return state;
}

/** Operates on the resolver's private copy. Gems, elites and the player split gravity. */
export function settleBoard(
  state: RunState,
  actionTurn: number,
  events: GameEvent[],
): void {
  const level = getRunLevel(state);
  for (let x = 0; x < level.width; x += 1) {
    let segment: Point[] = [];
    const settleSegment = () => {
      const creeps = segment
        .map((pos) => entityAt(state, pos))
        .filter((entity): entity is Creep => entity?.kind === 'creep');
      const destination = segment.slice(segment.length - creeps.length);
      creeps.forEach((creep, index) => {
        const to = destination[index];
        if (!samePoint(creep.pos, to))
          events.push({
            type: 'entity-moved',
            entityId: creep.id,
            from: creep.pos,
            to,
          });
        creep.pos = to;
      });
      for (const pos of segment.slice(0, segment.length - creeps.length)) {
        const creep = newCreep(state, pos, actionTurn);
        state.entities[creep.id] = creep;
        events.push({
          type: 'creep-spawned',
          entity: { ...creep, pos: { ...creep.pos } },
        });
      }
      segment = [];
    };
    for (let y = 0; y <= level.height; y += 1) {
      const pos = { x, y };
      const entity = entityAt(state, pos);
      if (
        !isPlayable(level, pos) ||
        samePoint(pos, state.player.pos) ||
        entity?.kind === 'gem' ||
        (entity !== undefined && isElite(entity))
      )
        settleSegment();
      else segment.push(pos);
    }
  }
}

export function emptyCells(state: RunState): Point[] {
  const level = getRunLevel(state);
  const cells: Point[] = [];
  for (let y = 0; y < level.height; y += 1) {
    for (let x = 0; x < level.width; x += 1) {
      const pos = { x, y };
      if (
        isPlayable(level, pos) &&
        !samePoint(pos, state.player.pos) &&
        !entityAt(state, pos)
      )
        cells.push(pos);
    }
  }
  return cells;
}
