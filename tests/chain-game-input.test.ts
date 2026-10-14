import assert from 'node:assert/strict';
import test from 'node:test';
import { attachInput } from '../demos/chain-game/src/presentation/input';
import { editPath } from '../demos/chain-game/src/application/path-editor';
import type { RunState } from '../demos/chain-game/src/core/model';

class TestDocument extends EventTarget {
  activeElement: TestBoard | null = null;
  hidden = false;
  defaultView = new EventTarget();
}

class TestBoard extends EventTarget {
  ownerDocument = new TestDocument();
  style = { touchAction: '' };
  tabIndex = -1;
  attributes = new Map<string, string>();
  captures = new Set<number>();
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  getBoundingClientRect() {
    return { left: 0, right: 100, top: 0, bottom: 100 };
  }
  setPointerCapture(id: number) {
    this.captures.add(id);
  }
  hasPointerCapture(id: number) {
    return this.captures.has(id);
  }
  releasePointerCapture(id: number) {
    this.captures.delete(id);
  }
}

function emit(
  target: EventTarget,
  type: string,
  properties: Record<string, unknown> = {},
) {
  const event = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(properties))
    Object.defineProperty(event, key, { value });
  target.dispatchEvent(event);
  return event;
}

function inputFixture() {
  const board = new TestBoard();
  const visits: string[] = [];
  const calls = {
    undo: 0,
    clear: 0,
    commit: 0,
    menu: 0,
    dragging: [] as boolean[],
  };
  let enabled = true;
  const controller = attachInput(board as unknown as HTMLElement, {
    hitTest: (x) => String(Math.floor(x / 20)),
    visit: (id) => visits.push(id),
    undo: () => {
      calls.undo += 1;
    },
    clear: () => {
      calls.clear += 1;
    },
    commit: () => {
      calls.commit += 1;
    },
    onMenu: () => {
      calls.menu += 1;
    },
    onDraggingChange: (value) => calls.dragging.push(value),
    enabled: () => enabled,
  });
  function pointer(
    type: string,
    x: number,
    extra: Record<string, unknown> = {},
  ) {
    const properties = {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: x,
      clientY: 50,
      ...extra,
    };
    if (type === 'pointerdown') {
      emit(board.ownerDocument, type, properties);
      return emit(board, type, properties);
    }
    return emit(board.ownerDocument, type, properties);
  }
  const key = (value: string, repeat = false) =>
    emit(board, 'keydown', { key: value, repeat });
  return {
    board,
    visits,
    calls,
    controller,
    pointer,
    key,
    setEnabled: (value: boolean) => {
      enabled = value;
    },
  };
}

void test('drawing samples the actual segment and release keeps the path without committing', () => {
  const f = inputFixture();
  f.pointer('pointermove', 80);
  assert.deepEqual(f.visits, []);
  f.pointer('pointerdown', 10);
  f.pointer('pointermove', 90);
  assert.deepEqual(f.visits, ['0', '1', '2', '3', '4']);
  f.pointer('pointerup', 90);
  assert.equal(f.calls.commit, 0);
  assert.equal(f.controller.isDragging(), false);
  assert.deepEqual(f.calls.dragging, [true, false]);
  f.controller.dispose();
});

void test('new gestures and an excursion outside the board do not create connecting samples', () => {
  const f = inputFixture();
  f.pointer('pointerdown', 10);
  f.pointer('pointerup', 10);
  f.pointer('pointerdown', 90);
  assert.deepEqual(f.visits, ['0', '4']);
  f.pointer('pointermove', 110);
  f.pointer('pointermove', 10);
  assert.deepEqual(f.visits, ['0', '4', '0']);
  f.controller.dispose();
});

void test('right press undoes once, never repeats on click/contextmenu and is ignored during drawing', () => {
  const f = inputFixture();
  f.pointer('pointerdown', 30, { button: 2, buttons: 2 });
  f.pointer('pointerdown', 30, { button: 2, buttons: 2 });
  emit(f.board, 'contextmenu');
  emit(f.board.ownerDocument, 'click', { detail: 1 });
  assert.equal(f.calls.undo, 1);
  f.pointer('pointerup', 30, { button: 2 });
  f.pointer('pointerdown', 30, { button: 2, buttons: 2 });
  assert.equal(f.calls.undo, 2);
  f.pointer('pointerup', 30, { button: 2 });
  f.pointer('pointerdown', 10);
  f.pointer('pointerdown', 10, { button: 2, buttons: 3 });
  assert.equal(f.calls.undo, 2);
  assert.equal(f.controller.isDragging(), true);
  f.controller.dispose();
});

void test('only the first finger draws; cancellation and focus loss preserve the last visits', () => {
  const f = inputFixture();
  f.pointer('pointerdown', 10, { pointerType: 'touch' });
  f.pointer('pointerdown', 90, {
    pointerId: 2,
    pointerType: 'touch',
    isPrimary: false,
  });
  f.pointer('pointermove', 90, {
    pointerId: 2,
    pointerType: 'touch',
    isPrimary: false,
  });
  f.pointer('pointerup', 90, {
    pointerId: 2,
    pointerType: 'touch',
    isPrimary: false,
  });
  assert.deepEqual(f.visits, ['0']);
  assert.equal(f.controller.isDragging(), true);
  f.pointer('pointercancel', 10);
  assert.equal(f.controller.isDragging(), false);
  f.pointer('pointerdown', 90);
  emit(f.board.ownerDocument.defaultView, 'blur');
  f.pointer('pointermove', 10);
  assert.deepEqual(f.visits, ['0', '4']);
  assert.equal(f.calls.commit, 0);
  f.controller.dispose();
});

void test('keyboard confirmation belongs to the focused board and ignores repeat or active dragging', () => {
  const f = inputFixture();
  f.key('Enter');
  assert.equal(f.calls.commit, 0);
  f.board.focus();
  f.key('Enter');
  f.key('Enter', true);
  f.key('Backspace');
  f.key('Backspace', true);
  assert.equal(f.calls.commit, 1);
  assert.equal(f.calls.undo, 1);
  f.pointer('pointerdown', 10);
  f.key(' ');
  f.key('Delete');
  assert.equal(f.calls.commit, 1);
  assert.equal(f.calls.undo, 1);
  f.key('Escape');
  assert.equal(f.controller.isDragging(), false);
  assert.equal(f.calls.menu, 1);
  assert.equal(f.key('Tab').defaultPrevented, false);
  f.controller.dispose();
});

void test('drawing trailing click is suppressed, but a fresh HUD press remains usable', () => {
  const f = inputFixture();
  f.pointer('pointerdown', 10);
  f.pointer('pointerup', 10);
  assert.equal(
    emit(f.board.ownerDocument, 'click', { detail: 1 }).defaultPrevented,
    true,
  );
  f.pointer('pointerdown', 10);
  f.pointer('pointerup', 10);
  emit(f.board.ownerDocument, 'pointerdown', { pointerId: 1 });
  assert.equal(
    emit(f.board.ownerDocument, 'click', { detail: 1 }).defaultPrevented,
    false,
  );
  f.controller.dispose();
});

void test('resize interrupts drawing and disposed or disabled input cannot edit', () => {
  const f = inputFixture();
  f.pointer('pointerdown', 10);
  emit(f.board.ownerDocument.defaultView, 'resize');
  assert.equal(f.controller.isDragging(), false);
  f.setEnabled(false);
  f.pointer('pointerdown', 90);
  f.key('Enter');
  assert.deepEqual(f.visits, ['0']);
  assert.equal(f.calls.commit, 0);
  f.controller.dispose();
  assert.equal(f.board.style.touchAction, '');
  f.setEnabled(true);
  f.pointer('pointerdown', 90);
  assert.deepEqual(f.visits, ['0']);
});

// Backtracking is intentionally checked before forward legality. These tests
// need no generated board because they must not invoke a new-target check.
const playingState = { status: 'playing' } as RunState;

void test('backtracking can cross a color-changing gem and truncate to any earlier selected node', () => {
  const path = ['blue-1', 'blue-2', 'gem-1', 'green-1', 'green-2'];
  assert.deepEqual(
    editPath(playingState, path, { type: 'visit', id: 'blue-1' }),
    ['blue-1'],
  );
  assert.deepEqual(
    editPath(playingState, path, { type: 'visit', id: 'gem-1' }),
    ['blue-1', 'blue-2', 'gem-1'],
  );
  assert.deepEqual(
    editPath(playingState, path, { type: 'visit', id: 'player' }),
    [],
  );
  assert.equal(
    editPath(playingState, path, { type: 'visit', id: 'green-2' }),
    path,
  );
});

void test('undo removes exactly one node, including exit or gem, and no-ops preserve identity', () => {
  assert.deepEqual(
    editPath(playingState, ['blue', 'gem', 'exit'], { type: 'undo' }),
    ['blue', 'gem'],
  );
  assert.deepEqual(editPath(playingState, ['blue', 'gem'], { type: 'undo' }), [
    'blue',
  ]);
  const empty: string[] = [];
  assert.equal(editPath(playingState, empty, { type: 'undo' }), empty);
  assert.equal(editPath(playingState, empty, { type: 'clear' }), empty);
  const path = ['blue'];
  assert.equal(
    editPath({ status: 'escaped' } as RunState, path, { type: 'clear' }),
    path,
  );
});

void test('invalid additions preserve the route and undoing a gem restores the original color lock', () => {
  const state = {
    status: 'playing',
    levelId: 'level-001',
    player: { pos: { x: 0, y: 2 } },
    entities: {
      blue1: { id: 'blue1', kind: 'creep', color: 'blue', pos: { x: 1, y: 2 } },
      blue2: { id: 'blue2', kind: 'creep', color: 'blue', pos: { x: 2, y: 2 } },
      gem: { id: 'gem', kind: 'gem', value: 1, pos: { x: 3, y: 2 } },
      green: {
        id: 'green',
        kind: 'creep',
        color: 'green',
        pos: { x: 2, y: 1 },
      },
      distant: {
        id: 'distant',
        kind: 'creep',
        color: 'blue',
        pos: { x: 4, y: 5 },
      },
    },
  } as unknown as RunState;
  const before = structuredClone(state);
  const bluePath = ['blue1', 'blue2'];
  assert.equal(
    editPath(state, bluePath, { type: 'visit', id: 'green' }),
    bluePath,
  );
  assert.equal(
    editPath(state, bluePath, { type: 'visit', id: 'distant' }),
    bluePath,
  );
  assert.equal(
    editPath(state, bluePath, { type: 'visit', id: 'missing' }),
    bluePath,
  );
  const withGem = editPath(state, bluePath, { type: 'visit', id: 'gem' });
  assert.deepEqual(editPath(state, withGem, { type: 'visit', id: 'green' }), [
    'blue1',
    'blue2',
    'gem',
    'green',
  ]);
  const undoGem = editPath(state, withGem, { type: 'undo' });
  assert.equal(
    editPath(state, undoGem, { type: 'visit', id: 'green' }),
    undoGem,
  );
  assert.deepEqual(state, before);
});
