export const REFINEMENT_DELAY_MS = 200;
export const REFINEMENT_BUDGET_BYTES = 128 * 1024 * 1024;
// Three RGBA16F targets; only the scene sample needs a depth buffer.
export const refinementBytes = (width: number, height: number) =>
  width * height * 28;
export const refinementSamples = (coarsePointer: boolean) =>
  coarsePointer ? 8 : 16;

export function jitterOffset(index: number, count: number): [number, number] {
  // Centered, deterministic stratification within one physical pixel.
  const columns = 4,
    rows = count / columns;
  return [
    (((index * 5) % columns) + 0.5) / columns - 0.5,
    (Math.floor(index / columns) + 0.5) / rows - 0.5,
  ];
}

export type RefinementClock = {
  frame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
  timer: (callback: () => void, delay: number) => number;
  cancelTimer: (handle: number) => void;
};

/** Single scene draw per animation frame; every visual change invalidates history. */
export function createRefinementLoop(
  hooks: {
    direct: () => void;
    sample: () => boolean;
    reset: () => void;
    available: () => boolean;
    state: (refining: boolean) => void;
  },
  count: number,
  clock: RefinementClock = {
    frame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    timer: (callback, delay) => window.setTimeout(callback, delay),
    cancelTimer: (handle) => window.clearTimeout(handle),
  },
) {
  let frame: number | null = null,
    timer: number | null = null;
  let paused = false,
    disposed = false,
    interacting = false;
  let samples = 0;
  const cancel = () => {
    if (frame !== null) clock.cancelFrame(frame);
    if (timer !== null) clock.cancelTimer(timer);
    frame = timer = null;
    samples = 0;
    hooks.reset();
    hooks.state(false);
  };
  const refine = () => {
    frame = null;
    if (paused || disposed || interacting || !hooks.available()) {
      hooks.state(false);
      return;
    }
    if (!hooks.sample()) {
      // A failed sample may already have drawn the scene: fallback next frame.
      invalidate();
      return;
    }
    samples++;
    if (samples < count) frame = clock.frame(refine);
    else hooks.state(false);
  };
  const direct = () => {
    frame = null;
    if (paused || disposed) return;
    hooks.direct();
    if (!interacting && hooks.available()) {
      timer = clock.timer(() => {
        timer = null;
        if (paused || disposed || !hooks.available()) return;
        hooks.state(true);
        frame = clock.frame(refine);
      }, REFINEMENT_DELAY_MS);
    }
  };
  function invalidate() {
    if (disposed) return;
    cancel();
    if (!paused) frame = clock.frame(direct);
  }
  return {
    invalidate,
    startInteraction(this: void) {
      interacting = true;
      invalidate();
    },
    endInteraction(this: void) {
      interacting = false;
      invalidate();
    },
    suspend() {
      paused = true;
      cancel();
    },
    resume() {
      paused = false;
      interacting = false;
      invalidate();
    },
    dispose() {
      disposed = true;
      cancel();
    },
  };
}
