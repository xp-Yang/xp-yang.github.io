import { getRunLevel } from '../content/levels';
import { canOpenExit, isElite } from './combat';
import { comboBonus } from './items';
import {
  adjacent,
  samePoint,
  type ColorId,
  type Entity,
  type Point,
  type RunState,
} from './model';

export interface PathInspection {
  valid: boolean;
  reason?: string;
  endpoint: Point;
  /** Each non-exit target contributes one, plus a selected combo potion. */
  chainCount: number;
  kills: number;
  killCount: number;
  collectedGems: number;
  color: ColorId | null;
  exits: boolean;
  /** The gate requirements are met by the live run plus this route's fruit kills. */
  exitAvailable: boolean;
}

export function entityAt(state: RunState, pos: Point): Entity | undefined {
  return Object.values(state.entities).find((entity) =>
    samePoint(entity.pos, pos),
  );
}

export function inspectPath(
  state: RunState,
  targets: readonly string[],
): PathInspection {
  let endpoint = state.player.pos;
  let color: ColorId | null = null;
  let chainCount = 0;
  let routeNodes = 0;
  let kills = 0;
  let eliteKills = 0;
  let collectedGems = 0;
  let exits = false;
  const result = (reason?: string): PathInspection => ({
    valid: !reason,
    ...(reason ? { reason } : {}),
    endpoint,
    chainCount,
    kills,
    killCount: kills,
    collectedGems,
    color,
    exits,
    exitAvailable: state.exitUnlocked || canOpenExit(state, kills, eliteKills),
  });
  if (state.status !== 'playing') return result('本局已结束');
  if (targets.length === 0) return result('先点击或拖拽选择一条路线');
  const level = getRunLevel(state);
  const visited = new Set<string>();
  for (const id of targets) {
    if (exits) return result('出口只能位于路线终点');
    if (visited.has(id)) return result('不能重复连接同一个目标');
    visited.add(id);
    if (id === 'exit') {
      if (!state.exitUnlocked && !canOpenExit(state, kills, eliteKills))
        return result('先完成击杀目标才能开启出口');
      if (!level.exit.entryCells.some((cell) => samePoint(cell, endpoint)))
        return result('需要先走到出口下方');
      endpoint = level.exit.pos;
      exits = true;
      continue;
    }
    const entity = Object.prototype.hasOwnProperty.call(state.entities, id)
      ? state.entities[id]
      : undefined;
    if (!entity) return result('路线中的目标已经变化');
    if (!adjacent(endpoint, entity.pos)) return result('只能连接相邻的格子');
    if (routeNodes === 0) chainCount = comboBonus(state);
    if (entity.kind === 'creep') {
      if (isElite(entity) && chainCount + 1 < (level.elite?.minChain ?? 10))
        return result(`需要先连到 ${level.elite?.minChain ?? 10} 连击才能击败精英水果`);
      if (color !== null && color !== entity.color)
        return result('经过宝石后才能切换颜色');
      color = entity.color;
      kills += 1;
      if (isElite(entity)) eliteKills += 1;
    } else {
      color = null;
      collectedGems += entity.value * (state.gemMultiplier ?? 1);
    }
    routeNodes += 1;
    chainCount += 1;
    endpoint = entity.pos;
  }
  return result();
}

export function legalTargets(
  state: RunState,
  targets: readonly string[] = [],
): string[] {
  if (state.status !== 'playing' || targets.includes('exit')) return [];
  return [...Object.keys(state.entities), 'exit'].filter(
    (id) => inspectPath(state, [...targets, id]).valid,
  );
}
