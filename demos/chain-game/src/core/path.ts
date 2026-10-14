import { getLevel } from '../content/levels';
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
  kills: number;
  killCount: number;
  collectedGems: number;
  color: ColorId | null;
  exits: boolean;
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
  let kills = 0;
  let collectedGems = 0;
  let exits = false;
  const result = (reason?: string): PathInspection => ({
    valid: !reason,
    ...(reason ? { reason } : {}),
    endpoint,
    kills,
    killCount: kills,
    collectedGems,
    color,
    exits,
  });
  if (state.status !== 'playing') return result('本局已结束');
  if (targets.length === 0) return result('先点击或拖拽选择一条路线');
  const level = getLevel(state.levelId);
  const visited = new Set<string>();
  for (const id of targets) {
    if (exits) return result('出口只能位于路线终点');
    if (visited.has(id)) return result('不能重复连接同一个目标');
    visited.add(id);
    if (id === 'exit') {
      if (!state.exitUnlocked) return result('先完成击杀目标才能开启出口');
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
    if (entity.kind === 'creep') {
      if (color !== null && color !== entity.color)
        return result('经过宝石后才能切换颜色');
      color = entity.color;
      kills += 1;
    } else {
      color = null;
      collectedGems += entity.value;
    }
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
