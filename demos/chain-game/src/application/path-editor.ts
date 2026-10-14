import type { RunState } from '../core/model';
import { inspectPath } from '../core/path';

export type PathEdit =
  | { type: 'visit'; id: string }
  | { type: 'undo' }
  | { type: 'clear' };

/** Edit only the uncommitted route. Rejected visits preserve the array identity. */
export function editPath(
  state: RunState,
  targets: readonly string[],
  edit: PathEdit,
): readonly string[] {
  if (state.status !== 'playing') return targets;
  if (
    edit.type === 'clear' ||
    (edit.type === 'visit' && edit.id === 'player')
  ) {
    return targets.length ? [] : targets;
  }
  if (edit.type === 'undo')
    return targets.length ? targets.slice(0, -1) : targets;

  const selectedIndex = targets.indexOf(edit.id);
  if (selectedIndex === targets.length - 1 && selectedIndex !== -1)
    return targets;
  // Backtracking must work across a gem's color change and distant old nodes.
  if (selectedIndex !== -1) return targets.slice(0, selectedIndex + 1);
  const candidate = [...targets, edit.id];
  return inspectPath(state, candidate).valid ? candidate : targets;
}
