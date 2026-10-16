import type { Entity, GameEvent, Point, RunState, TurnPreview } from '../core';
import type { TutorialView } from '../application/tutorial';

export interface BoardView {
  state: RunState;
  path: readonly string[];
  preview: TurnPreview;
  inspectedEntityId: string | null;
  teleportSelecting?: boolean;
  tutorial?: Pick<TutorialView, 'cells' | 'route'> | null;
}

export interface GameRenderer {
  render(view: BoardView): void;
  resize(): void;
  hitTest(clientX: number, clientY: number): string | null;
  dispose(): void;
}

// Future art receives immutable snapshots/events; it cannot decide game results.
export interface ActorVisual {
  sync(actor: Entity | RunState['player']): void;
  play(event: GameEvent, signal: AbortSignal): Promise<void>;
  dispose(): void;
}
export interface ActorVisualFactory {
  player(): ActorVisual;
  enemy(archetype: string): ActorVisual;
}
export interface EffectsPresenter {
  play(events: readonly GameEvent[], signal: AbortSignal): Promise<void>;
}
export interface ScenePresenter {
  load(levelId: string, themeId: string): void;
  resize(width: number, height: number): void;
  dispose(): void;
}
export interface TurnPresenter {
  play(
    before: RunState,
    events: readonly GameEvent[],
    after: RunState,
    signal: AbortSignal,
  ): Promise<void>;
  finishImmediately(): void;
}
export class InstantTurnPresenter implements TurnPresenter {
  async play(
    _before: RunState,
    _events: readonly GameEvent[],
    _after: RunState,
    _signal: AbortSignal,
  ): Promise<void> {}
  finishImmediately(): void {}
}
export interface BoardTransform {
  center(point: Point): Point;
  cellSize: number;
}
