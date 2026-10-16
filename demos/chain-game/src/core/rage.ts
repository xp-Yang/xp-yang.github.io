import { getRunLevel } from '../content/levels';
import type { LevelDefinition, RunState } from './model';

/** Gems and fruit each count as one node toward this route threshold. */
export function shortChainThreshold(level: LevelDefinition): number {
  return Math.min(3 + level.levelNumber, 8);
}

/** Progress only enables anger on newborn fruit, never on the opening board. */
export function rageRefillChance(
  state: Pick<RunState, 'levelId' | 'levelSnapshot' | 'killCount'>,
): number {
  const level = getRunLevel(state);
  const progressThreshold = level.goal * Math.max(1 / level.levelNumber, 1 / 10);
  return state.killCount >= progressThreshold ? 1 / 15 : 0;
}
