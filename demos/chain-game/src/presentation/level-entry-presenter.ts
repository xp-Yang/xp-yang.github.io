import { getRunLevel, type RunState } from '../core';
import { BOARD_TOP_CELLS } from './board-geometry';
import type { EntityMotion } from './motion';

/** Entry motion is disposable presentation data, never a turn or a saved state. */
export interface LevelEntryFrame {
  elapsed: number;
  levelNumber: number;
  goal: number;
  entities: Readonly<Record<string, EntityMotion>>;
}

export interface LevelEntrySink {
  setLevelEntry(frame: LevelEntryFrame | null): void;
}

export const LEVEL_ENTRY_TIMING = {
  titleEnterAt: 550,
  titleDropMs: 420,
  titleLeaveAt: 1550,
  titleLeaveMs: 480,
  fruitStartMs: 100,
  columnStaggerMs: 14,
  rowStaggerMs: 20,
  fallBaseMs: 360,
  fallRowMs: 14,
  landingMs: 110,
  durationMs: 2200,
} as const;

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export class LevelEntryPresenter {
  private finishCurrent: (() => void) | null = null;

  constructor(private readonly sink: LevelEntrySink) {}

  play(state: RunState, levelNumber: number, signal: AbortSignal): Promise<void> {
    this.finishImmediately();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (signal.aborted || document.hidden || reducedMotion.matches) {
      this.sink.setLevelEntry(null);
      return Promise.resolve();
    }

    const level = getRunLevel(state);
    // Bottom fruit lands first. Each column then fills upward, keeping the
    // silhouettes readable as a wave rather than spawning the whole board.
    const falls = Object.values(state.entities).map((entity) => ({
      entity,
      start: LEVEL_ENTRY_TIMING.fruitStartMs +
        entity.pos.x * LEVEL_ENTRY_TIMING.columnStaggerMs +
        (level.height - 1 - entity.pos.y) * LEVEL_ENTRY_TIMING.rowStaggerMs,
      duration: LEVEL_ENTRY_TIMING.fallBaseMs + entity.pos.y * LEVEL_ENTRY_TIMING.fallRowMs,
      fromY: -BOARD_TOP_CELLS - 1.1,
    }));
    const duration = Math.max(LEVEL_ENTRY_TIMING.durationMs,
      ...falls.map((fall) => fall.start + fall.duration + LEVEL_ENTRY_TIMING.landingMs));
    const frameAt = (elapsed: number): LevelEntryFrame => {
      const entities: Record<string, EntityMotion> = {};
      for (const fall of falls) {
        const local = elapsed - fall.start;
        const progress = clamp(local / fall.duration);
        const landedFor = local - fall.duration;
        const bounce = landedFor >= 0 && landedFor < LEVEL_ENTRY_TIMING.landingMs
          ? Math.sin(landedFor / LEVEL_ENTRY_TIMING.landingMs * Math.PI)
          : 0;
        entities[fall.entity.id] = {
          pos: {
            x: fall.entity.pos.x,
            y: fall.fromY + (fall.entity.pos.y - fall.fromY) * progress ** 2 - bounce * 0.09,
          },
          alpha: local < 0 ? 0 : 1,
          scaleX: 1 + bounce * 0.08,
          scaleY: 1 - bounce * 0.09,
        };
      }
      return { elapsed, levelNumber, goal: level.goal, entities };
    };

    return new Promise((resolve) => {
      let request = 0;
      let finished = false;
      const started = performance.now();
      const finish = () => {
        if (finished) return;
        finished = true;
        if (request) cancelAnimationFrame(request);
        signal.removeEventListener('abort', finish);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('pagehide', finish);
        reducedMotion.removeEventListener('change', onMotionPreference);
        if (this.finishCurrent === finish) this.finishCurrent = null;
        try {
          this.sink.setLevelEntry(null);
        } catch {
          // A presentation failure must still release the application's lock.
        } finally {
          resolve();
        }
      };
      const onVisibility = () => {
        if (document.hidden) finish();
      };
      const onMotionPreference = () => {
        if (reducedMotion.matches) finish();
      };
      const tick = (now: number) => {
        if (finished) return;
        const elapsed = now - started;
        if (elapsed >= duration) {
          finish();
          return;
        }
        try {
          this.sink.setLevelEntry(frameAt(elapsed));
          if (!finished) request = requestAnimationFrame(tick);
        } catch {
          finish();
        }
      };
      this.finishCurrent = finish;
      signal.addEventListener('abort', finish, { once: true });
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', finish, { once: true });
      reducedMotion.addEventListener('change', onMotionPreference);
      try {
        // Hide every fruit synchronously, before the browser can paint a full
        // new board between the state swap and the first animation frame.
        this.sink.setLevelEntry(frameAt(0));
        if (!finished) request = requestAnimationFrame(tick);
      } catch {
        finish();
      }
    });
  }

  finishImmediately(): void {
    this.finishCurrent?.();
  }
}
