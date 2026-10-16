import { getRunLevel } from '../content/levels';
import type { Creep, Entity, Point, RunState } from './model';

const CARDINAL_OFFSETS: readonly Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];
const ELITE_OFFSETS: readonly Point[] = [
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
];

export function isElite(entity: Entity): entity is Creep & { archetypeId: 'elite' } {
  return entity.kind === 'creep' && entity.archetypeId === 'elite';
}

export function attackOffsets(creep: Creep): readonly Point[] {
  return isElite(creep) ? ELITE_OFFSETS : CARDINAL_OFFSETS;
}

/** Range only; activation timing and mood are checked by the caller. */
export function threatens(creep: Creep, pos: Point): boolean {
  return attackOffsets(creep).some(
    (offset) =>
      creep.pos.x + offset.x === pos.x && creep.pos.y + offset.y === pos.y,
  );
}

/** Includes the fruit kills projected by a route, without changing the live run. */
export function canOpenExit(
  state: RunState,
  additionalKills = 0,
  additionalEliteKills = 0,
): boolean {
  const level = getRunLevel(state);
  return (
    state.killCount + additionalKills >= level.goal &&
    (!level.elite || (state.eliteKills ?? 0) + additionalEliteKills > 0)
  );
}
