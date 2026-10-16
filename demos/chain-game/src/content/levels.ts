import type { LevelDefinition, RunState } from '../core/model';
import { generateEndlessLevel, makeEndlessLevelId, parseEndlessLevelId } from './endless-levels';

export { GENERATOR_VERSION, makeEndlessLevelId, parseEndlessLevelId } from './endless-levels';

/** Dimensions in UI copy are rows × columns; storage uses width and height. */
export const LEVELS: readonly LevelDefinition[] = [
  {
    id: 'level-001',
    levelNumber: 1,
    name: '初入矿洞',
    description: '6 行 × 5 列 · 切开 20 个水果，然后到顶部出口撤离。',
    width: 5,
    height: 6,
    mask: Array<string>(6).fill('.....'),
    goal: 20,
    playerStart: { x: 2, y: 5 },
    exit: {
      pos: { x: 2, y: -1 },
      entryCells: [
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ],
    },
    colors: ['blue', 'red', 'purple'],
    initialRows: ['RBRPR', 'BBPRP', 'BBRPR', 'RBBBP', 'RPBBR', 'PR.PR'],
  },
  {
    id: 'level-002',
    levelNumber: 2,
    name: '深入矿脉',
    description: '7 行 × 7 列 · 切开 55 个水果；少于 5 连击会激怒场上的水果。',
    width: 7,
    height: 7,
    mask: Array<string>(7).fill('.......'),
    goal: 55,
    playerStart: { x: 3, y: 6 },
    exit: {
      pos: { x: 3, y: -1 },
      entryCells: [
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
      ],
    },
    colors: ['blue', 'green', 'purple', 'red'],
    unlockAfter: 'level-001',
  },
  {
    id: 'level-003',
    levelNumber: 3,
    name: '精英守门人',
    description: '7 行 × 7 列 · 达到 10 连击击败门前的精英水果，并累计切开 60 个水果。',
    width: 7,
    height: 7,
    mask: Array<string>(7).fill('.......'),
    goal: 60,
    playerStart: { x: 3, y: 6 },
    exit: {
      pos: { x: 3, y: -1 },
      entryCells: [
        { x: 2, y: 0 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
      ],
    },
    colors: ['blue', 'green', 'purple', 'red'],
    unlockAfter: 'level-002',
    elite: { initialPos: { x: 3, y: 0 }, minChain: 10, respawnChance: 1 / 40 },
  },
];

/** Retain only a small recent window: progression never builds an infinite catalog. */
const generatedLevels = new Map<string, LevelDefinition>();
export function getLevel(id: string): LevelDefinition {
  const fixed = LEVELS.find((candidate) => candidate.id === id);
  if (fixed) return fixed;
  if (!parseEndlessLevelId(id)) throw new Error(`Unknown level: ${id}`);
  const cached = generatedLevels.get(id);
  if (cached) return cached;
  const level = generateEndlessLevel(id);
  if (generatedLevels.size >= 16) generatedLevels.delete(generatedLevels.keys().next().value!);
  generatedLevels.set(id, level);
  return level;
}

/** In-progress generated runs always use their saved, immutable definition. */
export function getRunLevel(state: Pick<RunState, 'levelId' | 'levelSnapshot'>): LevelDefinition {
  return state.levelSnapshot ?? getLevel(state.levelId);
}

export function getNextLevelId(currentId: string, worldSeed: number): string {
  const generated = parseEndlessLevelId(currentId);
  if (generated) return makeEndlessLevelId(generated.levelNumber + 1, generated.worldSeed);
  const fixedIndex = LEVELS.findIndex((level) => level.id === currentId);
  if (fixedIndex < 0) throw new Error(`Unknown level: ${currentId}`);
  return LEVELS[fixedIndex + 1]?.id ?? makeEndlessLevelId(4, worldSeed);
}

/** A hint only: completing this route is never a tutorial progression gate. */
export const TUTORIAL_CHAIN = [
  { x: 2, y: 4 },
  { x: 3, y: 4 },
  { x: 3, y: 3 },
  { x: 2, y: 3 },
  { x: 1, y: 3 },
  { x: 1, y: 2 },
  { x: 0, y: 2 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: 0 },
] as const;
