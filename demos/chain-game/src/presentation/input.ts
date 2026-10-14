export interface InputCallbacks {
  /** Coordinates are viewport CSS pixels, matching PointerEvent.clientX/clientY. */
  hitTest(clientX: number, clientY: number): string | null;
  visit(id: string): void;
  undo(): void;
  clear(): void;
  commit(): void;
  /** The application resolves a tap: route editing first, inspection second. */
  tap?(id: string | null): void;
  /** A new press dismisses transient inspection without treating it as a tap. */
  onInteractionStart?(): void;
  onDraggingChange?(dragging: boolean): void;
  onMenu?(): void;
  enabled?(): boolean;
}

export interface InputController {
  cancelDrag(): void;
  dispose(): void;
  isDragging(): boolean;
}

interface SamplePoint {
  x: number;
  y: number;
}

/**
 * Mouse and touch share one gesture. Drawing never commits a turn; releasing
 * keeps the draft, and a fresh button or keyboard action confirms it.
 */
export function attachInput(
  element: HTMLElement,
  callbacks: InputCallbacks,
  options: { sampleStepPx?: number } = {},
): InputController {
  const document = element.ownerDocument;
  const window = document.defaultView;
  const sampleStep = Math.max(1, options.sampleStepPx ?? 5);
  const originalTouchAction = element.style.touchAction;
  const originalTabIndex = element.getAttribute('tabindex');
  element.style.touchAction = 'none';
  if (element.tabIndex < 0) element.tabIndex = 0;

  let activePointer: number | null = null;
  let lastPoint: SamplePoint | null = null;
  let lastHit: string | null = null;
  let pressPoint: SamplePoint | null = null;
  let pressHit: string | null = null;
  let drawingStarted = false;
  let canTap = false;
  let samplePressPoint = false;
  let rightPressed = false;
  let suppressDrawingClick = false;
  let disposed = false;
  const removers: Array<() => void> = [];

  const enabled = () => !disposed && (callbacks.enabled?.() ?? true);
  function listen(
    target: EventTarget,
    type: string,
    listener: EventListener,
    capture = false,
  ) {
    target.addEventListener(type, listener, { capture, passive: false });
    removers.push(() => target.removeEventListener(type, listener, capture));
  }

  function finishDrag() {
    if (activePointer === null) return;
    const previousPointer = activePointer;
    activePointer = null;
    lastPoint = null;
    lastHit = null;
    pressPoint = null;
    pressHit = null;
    drawingStarted = false;
    canTap = false;
    samplePressPoint = false;
    suppressDrawingClick = true;
    try {
      if (element.hasPointerCapture(previousPointer))
        element.releasePointerCapture(previousPointer);
    } catch {
      // A browser cancellation may already have released capture.
    }
    callbacks.onDraggingChange?.(false);
  }

  function visitPoint(x: number, y: number) {
    const target = callbacks.hitTest(x, y);
    if (target !== null && target !== lastHit) callbacks.visit(target);
    lastHit = target;
  }

  function insideBoard(point: SamplePoint) {
    const bounds = element.getBoundingClientRect();
    return (
      point.x >= bounds.left &&
      point.x < bounds.right &&
      point.y >= bounds.top &&
      point.y < bounds.bottom
    );
  }

  function sample(point: SamplePoint) {
    if (!insideBoard(point)) {
      // Do not connect an out-of-board excursion to its re-entry position.
      lastPoint = null;
      lastHit = null;
      return;
    }
    if (lastPoint) {
      const from = lastPoint;
      const count = Math.max(
        1,
        Math.ceil(Math.hypot(point.x - from.x, point.y - from.y) / sampleStep),
      );
      for (let index = 1; index <= count; index += 1) {
        visitPoint(
          from.x + ((point.x - from.x) * index) / count,
          from.y + ((point.y - from.y) * index) / count,
        );
      }
    } else {
      visitPoint(point.x, point.y);
    }
    lastPoint = point;
  }

  function move(point: SamplePoint) {
    if (!insideBoard(point)) {
      canTap = false;
      samplePressPoint = false;
    }
    if (!drawingStarted) {
      if (
        !pressPoint ||
        Math.hypot(point.x - pressPoint.x, point.y - pressPoint.y) < 6
      )
        return;
      drawingStarted = true;
      canTap = false;
      // Replay the original press only when dragging starts. A stationary
      // press is resolved once on release, with route editing taking priority.
      if (samplePressPoint) sample(pressPoint);
    }
    sample(point);
  }

  listen(
    document,
    'pointerdown',
    ((event: PointerEvent) => {
      if (activePointer !== null && event.pointerId !== activePointer) {
        // A second finger on the HUD must not steal focus and cancel the first
        // finger's drawing gesture. Its eventual click is also blocked below.
        canTap = false;
        event.preventDefault();
        return;
      }
      // A genuinely new press can activate a HUD button. Only the previous
      // drawing gesture's trailing synthetic click is discarded.
      if (activePointer === null) {
        suppressDrawingClick = false;
        if (enabled() && event.isPrimary !== false)
          callbacks.onInteractionStart?.();
      }
    }) as EventListener,
    true,
  );

  listen(element, 'pointerdown', ((event: PointerEvent) => {
    if (!enabled()) return;
    if (event.button === 2) {
      event.preventDefault();
      if (activePointer === null && !rightPressed) {
        rightPressed = true;
        element.focus({ preventScroll: true });
        callbacks.undo();
      }
      return;
    }
    if (
      event.button !== 0 ||
      activePointer !== null ||
      event.isPrimary === false
    )
      return;
    event.preventDefault();
    element.focus({ preventScroll: true });
    activePointer = event.pointerId;
    lastPoint = null;
    lastHit = null;
    pressPoint = { x: event.clientX, y: event.clientY };
    pressHit = callbacks.hitTest(event.clientX, event.clientY);
    drawingStarted = !callbacks.tap;
    canTap = !!callbacks.tap;
    samplePressPoint = true;
    callbacks.onDraggingChange?.(true);
    try {
      element.setPointerCapture(event.pointerId);
    } catch {
      // Document listeners still finish the gesture if capture is unavailable.
    }
    if (drawingStarted) sample(pressPoint);
  }) as EventListener);

  listen(
    document,
    'pointermove',
    ((event: PointerEvent) => {
      if (event.pointerId !== activePointer) return;
      if (
        !enabled() ||
        (event.pointerType !== 'touch' && (event.buttons & 1) === 0)
      ) {
        finishDrag();
        return;
      }
      event.preventDefault();
      const points = event.getCoalescedEvents?.() ?? [];
      for (const point of points) move({ x: point.clientX, y: point.clientY });
      move({ x: event.clientX, y: event.clientY });
    }) as EventListener,
    true,
  );

  listen(
    document,
    'pointerup',
    ((event: PointerEvent) => {
      if (event.button === 2 || (event.buttons & 2) === 0) rightPressed = false;
      if (event.pointerId !== activePointer) return;
      // A right-button release while the left button remains held is not an end.
      if (event.pointerType !== 'touch' && (event.buttons & 1) !== 0) return;
      event.preventDefault();
      if (!enabled()) {
        finishDrag();
        return;
      }
      const point = { x: event.clientX, y: event.clientY };
      // The release may arrive beyond the last move event. Sample that final
      // stretch before ending the gesture, without ever committing a turn.
      move(point);
      const target = callbacks.hitTest(point.x, point.y);
      const shouldTap =
        canTap &&
        !drawingStarted &&
        insideBoard(point) &&
        target === pressHit &&
        (event.pointerType === 'touch' || event.button === 0);
      finishDrag();
      if (shouldTap) callbacks.tap?.(target);
    }) as EventListener,
    true,
  );

  listen(
    document,
    'pointercancel',
    ((event: PointerEvent) => {
      rightPressed = false;
      if (event.pointerId === activePointer) finishDrag();
    }) as EventListener,
    true,
  );

  listen(element, 'lostpointercapture', ((event: PointerEvent) => {
    if (event.pointerId === activePointer) finishDrag();
  }) as EventListener);

  listen(element, 'pointerleave', (() => {
    lastPoint = null;
    lastHit = null;
    canTap = false;
    samplePressPoint = false;
  }) as EventListener);

  listen(element, 'contextmenu', ((event: Event) =>
    event.preventDefault()) as EventListener);
  listen(
    document,
    'click',
    ((event: MouseEvent) => {
      if (event.detail === 0) return;
      if (activePointer !== null || suppressDrawingClick) {
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressDrawingClick = false;
      }
    }) as EventListener,
    true,
  );

  listen(element, 'keydown', ((event: KeyboardEvent) => {
    // A button, text field or dialog has its own keyboard behavior.
    if (
      document.activeElement !== element ||
      event.target !== element ||
      !enabled()
    )
      return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!event.repeat) {
        finishDrag();
        callbacks.onMenu?.();
      }
      return;
    }
    const confirms = event.key === ' ' || event.key === 'Enter';
    const undoes = event.key === 'Backspace' || event.key === 'Delete';
    if (!confirms && !undoes) return;
    event.preventDefault();
    if (event.repeat || activePointer !== null) return;
    if (confirms) callbacks.commit();
    else callbacks.undo();
  }) as EventListener);

  function interrupt() {
    rightPressed = false;
    finishDrag();
  }
  listen(element, 'blur', interrupt);
  if (window) {
    listen(window, 'blur', interrupt);
    listen(window, 'resize', interrupt);
    listen(window, 'orientationchange', interrupt);
  }
  listen(document, 'visibilitychange', (() => {
    if (document.hidden) interrupt();
  }) as EventListener);

  return {
    cancelDrag: interrupt,
    isDragging: () => activePointer !== null,
    dispose() {
      if (disposed) return;
      interrupt();
      disposed = true;
      for (const remove of removers) remove();
      element.style.touchAction = originalTouchAction;
      if (originalTabIndex === null) element.removeAttribute('tabindex');
      else element.setAttribute('tabindex', originalTabIndex);
    },
  };
}
