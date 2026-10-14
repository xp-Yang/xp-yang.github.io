import type { LevelDefinition } from '../core/model';

/** Dimensions in UI copy are rows × columns; storage uses width and height. */
export const LEVELS: readonly LevelDefinition[] = [
  {
    id: 'level-001',
    name: '初入矿洞',
    description: '6 行 × 5 列 · 消灭 20 只小怪，然后到顶部出口撤离。',
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
    colors: ['blue', 'green', 'purple'],
    initialRows: ['GBGPG', 'BBPGP', 'BBGPG', 'GBBBP', 'GPBBG', 'PG.PG'],
    rage: { activation: 'exit-open-at-turn-start', newAngryPerTurn: 1 },
  },
  {
    id: 'level-002',
    name: '深入矿脉',
    description: '7 行 × 7 列 · 消灭 55 只小怪。第 6 回合起，小怪开始愤怒。',
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
    colors: ['blue', 'green', 'purple'],
    unlockAfter: 'level-001',
    rage: {
      activation: 'turn-count',
      startTurn: 6,
      newAngryPerTurn: 1,
      newAngryAfterExitOpened: 2,
    },
  },
];

export function getLevel(id: string): LevelDefinition {
  const level = LEVELS.find((candidate) => candidate.id === id);
  if (!level) throw new Error(`Unknown level: ${id}`);
  return level;
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
