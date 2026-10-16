import type { ColorId, LevelDefinition, Point } from '../core/model';
import { nextRandom } from '../core/random';

/** Changing this version requires retaining the existing generation algorithm. */
export const GENERATOR_VERSION = 'v1' as const;
export type EndlessTemplate = 'calm' | 'standard' | 'long-chain' | 'pressure' | 'guardian';
export interface EndlessLevelIdentity {
  levelNumber: number;
  worldSeed: number;
  generatorVersion: typeof GENERATOR_VERSION;
}

const UINT32_MAX = 0xffffffff;
const SYMBOLS: Record<ColorId, string> = { blue: 'B', green: 'G', purple: 'P', red: 'R' };
const START: Point = { x: 3, y: 6 };
const GUARDIAN: Point = { x: 3, y: 0 };
const TEMPLATES: readonly EndlessTemplate[] = ['calm', 'standard', 'long-chain', 'pressure', 'guardian'];
const NAMES: Record<EndlessTemplate, string> = {
  calm: '林间小径', standard: '果林深处', 'long-chain': '连刃回廊', pressure: '躁动果园', guardian: '精英守门人',
};

export function makeEndlessLevelId(levelNumber: number, worldSeed: number): string {
  if (!Number.isSafeInteger(levelNumber) || levelNumber < 4 ||
      !Number.isInteger(worldSeed) || worldSeed < 0 || worldSeed > UINT32_MAX) {
    throw new Error('Invalid endless level identity');
  }
  return `endless-${GENERATOR_VERSION}-${levelNumber}-${worldSeed.toString(16).padStart(8, '0')}`;
}

export function parseEndlessLevelId(id: string): EndlessLevelIdentity | null {
  const match = /^endless-v1-([1-9]\d*)-([0-9a-f]{8})$/.exec(id);
  if (!match) return null;
  const levelNumber = Number(match[1]);
  if (!Number.isSafeInteger(levelNumber) || levelNumber < 4) return null;
  return { levelNumber, worldSeed: Number.parseInt(match[2], 16), generatorVersion: GENERATOR_VERSION };
}

/** Hash the complete decimal stage number, including its high integer bits. */
function deriveSeed(worldSeed: number, label: string): number {
  let hash = (worldSeed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = Math.imul(hash ^ label.charCodeAt(i), 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  return hash >>> 0 || 1;
}

class LayoutRandom {
  constructor(private state: number) {}
  integer(limit: number): number {
    const sample = nextRandom(this.state);
    this.state = sample.state;
    return Math.floor(sample.value * limit);
  }
  shuffle<T>(values: readonly T[]): T[] {
    const shuffled = [...values];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = this.integer(i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    return shuffled;
  }
}

const key = (pos: Point): number => pos.y * 7 + pos.x;
const adjacent = (a: Point, b: Point): boolean =>
  key(a) !== key(b) && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
function neighbours(pos: Point): Point[] {
  const result: Point[] = [];
  for (let y = Math.max(0, pos.y - 1); y <= Math.min(6, pos.y + 1); y += 1) {
    for (let x = Math.max(0, pos.x - 1); x <= Math.min(6, pos.x + 1); x += 1) {
      if (x !== pos.x || y !== pos.y) result.push({ x, y });
    }
  }
  return result;
}

/** Fixed expansion budget makes acceptance independent of device speed. */
function openingRoute(random: LayoutRandom, length: number): Point[] | null {
  let budget = 1600;
  const route: Point[] = [];
  const visited = new Set([key(START)]);
  function extend(from: Point): boolean {
    if (route.length === length) return true;
    if (budget-- <= 0) return false;
    for (const pos of random.shuffle(neighbours(from))) {
      if (visited.has(key(pos))) continue;
      visited.add(key(pos));
      route.push(pos);
      if (extend(pos)) return true;
      route.pop();
      visited.delete(key(pos));
    }
    return false;
  }
  return extend(START) ? route : null;
}

/** The elite is the tenth target, never an early node in an otherwise long chain. */
function guardianRoute(mirror: boolean): Point[] {
  const route = [
    { x: 2, y: 6 }, { x: 1, y: 5 }, { x: 1, y: 4 }, { x: 2, y: 3 },
    { x: 1, y: 2 }, { x: 1, y: 1 }, { x: 2, y: 0 }, { x: 3, y: 1 },
    { x: 4, y: 0 }, GUARDIAN,
  ];
  return route.map((pos) => ({ x: mirror ? 6 - pos.x : pos.x, y: pos.y }));
}

function fillRows(random: LayoutRandom, colors: readonly ColorId[], route: readonly Point[]): string[] {
  const chainColor = colors[random.integer(colors.length)]!;
  const rows = Array.from({ length: 7 }, () => Array<string>(7).fill('.'));
  for (const pos of route) rows[pos.y]![pos.x] = SYMBOLS[chainColor];
  const remaining: Point[] = [];
  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      if ((x !== START.x || y !== START.y) && rows[y]![x] === '.') remaining.push({ x, y });
    }
  }
  // A shuffled balanced bag avoids both absent fruit types and near-monochrome boards.
  const bag = random.shuffle(remaining.map((_, index) => colors[index % colors.length]!));
  remaining.forEach((pos, index) => { rows[pos.y]![pos.x] = SYMBOLS[bag[index]!]!; });
  return rows.map((row) => row.join(''));
}

function validOpening(rows: readonly string[], colors: readonly ColorId[], route: readonly Point[], guardian: boolean): boolean {
  if (route.length < (guardian ? 10 : 4)) return false;
  const symbol = rows[route[0]!.y]![route[0]!.x];
  const visited = new Set([key(START)]);
  let previous = START;
  for (const pos of route) {
    if (visited.has(key(pos)) || !adjacent(previous, pos) || rows[pos.y]?.[pos.x] !== symbol) return false;
    visited.add(key(pos));
    previous = pos;
  }
  if (guardian && key(previous) !== key(GUARDIAN)) return false;
  const flat = rows.join('');
  if (colors.some((color) => {
    const count = [...flat].filter((value) => value === SYMBOLS[color]).length;
    return count < 4 || count > 33;
  })) return false;
  // At least two distinct ordinary opening choices; the guardian remains distant.
  return new Set(neighbours(START).map((pos) => rows[pos.y]![pos.x])).size >= 2;
}

export function generateEndlessLevel(id: string): LevelDefinition {
  const identity = parseEndlessLevelId(id);
  if (!identity) throw new Error(`Unknown endless level: ${id}`);
  const { levelNumber, worldSeed } = identity;
  const template = TEMPLATES[(levelNumber - 4) % TEMPLATES.length]!;
  const stageSeed = deriveSeed(worldSeed, `${GENERATOR_VERSION}:stage:${levelNumber}`);
  const settings = new LayoutRandom(deriveSeed(stageSeed, 'settings'));
  const colors: readonly ColorId[] = template === 'calm' ||
    (template === 'long-chain' && settings.integer(2) === 0)
    ? ['blue', 'red', 'purple'] : ['blue', 'green', 'purple', 'red'];
  const guardian = template === 'guardian';
  const band = levelNumber <= 8 ? [55, 65] : levelNumber <= 18 ? [60, 75]
    : levelNumber <= 38 ? [70, 85] : [75, 95];
  const low = band[0]!;
  const high = band[1]!;
  const weight = template === 'calm' ? 0 : template === 'long-chain' ? 0.35
    : template === 'standard' ? 0.5 : template === 'pressure' ? 0.8 : 1;
  const goal = Math.min(high, Math.max(low, low + Math.round((high - low) * weight) + settings.integer(3) - 1));
  let initialRows: string[] | null = null;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const random = new LayoutRandom(deriveSeed(stageSeed, `layout:${attempt}`));
    const route = guardian ? guardianRoute(random.integer(2) === 1)
      : openingRoute(random, template === 'long-chain' ? 8 + random.integer(5) : 4 + random.integer(4));
    if (!route) continue;
    const rows = fillRows(random, colors, route);
    if (validOpening(rows, colors, route, guardian)) { initialRows = rows; break; }
  }
  if (!initialRows) {
    const random = new LayoutRandom(deriveSeed(stageSeed, 'fallback'));
    const route = guardian ? guardianRoute(random.integer(2) === 1) : [
      { x: 2, y: 6 }, { x: 1, y: 5 }, { x: 0, y: 4 }, { x: 1, y: 3 },
      { x: 2, y: 2 }, { x: 3, y: 1 }, { x: 4, y: 2 }, { x: 5, y: 3 },
    ];
    const rows = fillRows(random, colors, route);
    // Force a distinct adjacent opening while preserving the complete reserved chain.
    const reserved = new Set(route.map(key));
    const alternative = neighbours(START).find((pos) => !reserved.has(key(pos)))!;
    const first = route[0]!;
    const alternativeColor = colors.find((color) => SYMBOLS[color] !== rows[first.y]![first.x])!;
    const row = rows[alternative.y]!;
    rows[alternative.y] = row.slice(0, alternative.x) + SYMBOLS[alternativeColor] + row.slice(alternative.x + 1);
    if (!validOpening(rows, colors, route, guardian)) throw new Error('Invalid endless fallback');
    initialRows = rows;
  }
  const level = {
    id, levelNumber, name: NAMES[template],
    description: `7 行 × 7 列 · 切开 ${goal} 个水果${guardian ? '，并以至少 10 连击击败守门精英' : ''}后撤离。`,
    width: 7, height: 7, mask: Array<string>(7).fill('.......'), goal,
    playerStart: { ...START },
    exit: { pos: { x: 3, y: -1 }, entryCells: [{ x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }] },
    colors, initialRows,
    ...(guardian ? { elite: { initialPos: { ...GUARDIAN }, minChain: 10, respawnChance: 1 / 40 } } : {}),
    generation: { version: GENERATOR_VERSION, worldSeed, stageSeed, template },
  } satisfies LevelDefinition;
  return level;
}
