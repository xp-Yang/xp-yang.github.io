import { getLevel } from '../content/levels';
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
  const level = getLevel(state.levelId);
  if (!color) {
    const random = nextRandom(state.rng.board);
    state.rng.board = random.state;
    color = level.colors[Math.floor(random.value * level.colors.length)];
  }
  return {
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
    rulesVersion: 'prototype-v1',
    contentVersion: '1',
    revision: 0,
    turn: 0,
    status: health > 0 ? 'playing' : 'dead',
    player: { pos: { ...level.playerStart }, hp: health, maxHp: 3 },
    entities: {},
    killCount: 0,
    carriedGems: 0,
    pendingDrops: [],
    exitUnlocked: false,
    rng: seedStreams(seed),
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
  return state;
}

/** Operates only on the resolver's private copy. Gems and the player split gravity into segments. */
export function settleBoard(
  state: RunState,
  actionTurn: number,
  events: GameEvent[],
): void {
  const level = getLevel(state.levelId);
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
      if (
        !isPlayable(level, pos) ||
        samePoint(pos, state.player.pos) ||
        entityAt(state, pos)?.kind === 'gem'
      )
        settleSegment();
      else segment.push(pos);
    }
  }
}

export function emptyCells(state: RunState): Point[] {
  const level = getLevel(state.levelId);
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
