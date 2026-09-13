import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRefinementLoop,
  jitterOffset,
  refinementBytes,
  refinementSamples,
  REFINEMENT_BUDGET_BYTES,
  type RefinementClock,
} from '../lib/gcode/refinement';

function setup(count = 16) {
  let id = 0,
    now = 0;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { callback: () => void; at: number }>();
  const events: string[] = [];
  let enabled = true,
    fail = false;
  const clock: RefinementClock = {
    frame(callback) {
      frames.set(++id, callback);
      return id;
    },
    cancelFrame(handle) {
      frames.delete(handle);
    },
    timer(callback, delay) {
      timers.set(++id, { callback, at: now + delay });
      return id;
    },
    cancelTimer(handle) {
      timers.delete(handle);
    },
  };
  const loop = createRefinementLoop(
    {
      direct: () => events.push('direct'),
      sample: () => {
        events.push('sample');
        if (fail) enabled = false;
        return !fail;
      },
      reset: () => events.push('reset'),
      available: () => enabled,
      state: (refining) => events.push(refining ? 'refining' : 'idle'),
    },
    count,
    clock,
  );
  return {
    loop,
    events,
    frames,
    timers,
    fail() {
      fail = true;
    },
    frame() {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback());
    },
    advance(ms: number) {
      now += ms;
      for (const [handle, timer] of timers) {
        if (timer.at <= now) {
          timers.delete(handle);
          timer.callback();
        }
      }
    },
  };
}

void test('refinement waits 200 ms, draws one sample per frame, then stops at 8 or 16', () => {
  for (const coarse of [false, true]) {
    const count = refinementSamples(coarse),
      s = setup(count);
    s.loop.invalidate();
    s.loop.invalidate();
    s.frame();
    assert.equal(s.events.filter((e) => e === 'direct').length, 1);
    s.advance(199);
    assert.equal(s.frames.size, 0);
    s.advance(1);
    assert.equal(s.events.at(-1), 'refining');
    for (let i = 0; i < count; i++) {
      s.frame();
      assert.equal(s.events.filter((e) => e === 'sample').length, i + 1);
    }
    assert.equal(s.events.at(-1), 'idle');
    assert.equal(s.frames.size + s.timers.size, 0);
    s.advance(10000);
    s.frame();
    assert.equal(s.events.filter((e) => e === 'sample').length, count);
  }
});

void test('visual changes discard history and interaction prevents refinement until release', () => {
  const s = setup();
  s.loop.invalidate();
  s.frame();
  s.advance(200);
  s.frame();
  s.events.length = 0;
  s.loop.startInteraction();
  s.frame();
  s.advance(1000);
  s.frame();
  assert.deepEqual(s.events, ['reset', 'idle', 'direct']);
  s.loop.endInteraction();
  s.frame();
  s.advance(200);
  s.frame();
  assert.equal(s.events.at(-1), 'sample');
  s.loop.invalidate(); // layer/filter/model/resize all use the same invalidation.
  s.frame();
  assert.equal(s.events.at(-1), 'direct');
  s.advance(200);
  for (let i = 0; i < 16; i++) s.frame();
  assert.equal(s.events.at(-1), 'idle');
});

void test('background suspension, resume and disposal leave no scheduled work', () => {
  const s = setup();
  s.loop.invalidate();
  s.frame();
  s.advance(200);
  s.frame();
  s.loop.suspend();
  const before = s.events.length;
  s.advance(1000);
  s.frame();
  assert.equal(s.events.length, before);
  assert.equal(s.frames.size + s.timers.size, 0);
  s.loop.resume();
  s.frame();
  assert.equal(s.events.at(-1), 'direct');
  s.loop.dispose();
  s.loop.invalidate();
  s.advance(1000);
  s.frame();
  assert.equal(s.frames.size + s.timers.size, 0);
});

void test('allocation or sampling failure restores single-frame rendering on the next frame', () => {
  const s = setup();
  s.loop.invalidate();
  s.frame();
  s.advance(200);
  s.fail();
  s.events.length = 0;
  s.frame();
  assert.deepEqual(s.events, ['sample', 'reset', 'idle']);
  s.frame();
  assert.equal(s.events.at(-1), 'direct');
  assert.equal(s.frames.size + s.timers.size, 0);
});

void test('jitter is deterministic, centered within one pixel; buffer estimate respects 128 MiB', () => {
  for (const count of [8, 16]) {
    const offsets = Array.from({ length: count }, (_, i) =>
      jitterOffset(i, count),
    );
    assert.equal(new Set(offsets.map((p) => p.join(','))).size, count);
    assert.ok(offsets.flat().every((value) => Math.abs(value) < 0.5));
    for (const axis of [0, 1])
      assert.equal(
        offsets.reduce((sum, p) => sum + p[axis], 0),
        0,
      );
    assert.deepEqual(
      offsets,
      Array.from({ length: count }, (_, i) => jitterOffset(i, count)),
    );
  }
  assert.ok(refinementBytes(1920, 1080) < REFINEMENT_BUDGET_BYTES);
  assert.ok(refinementBytes(3840, 2160) > REFINEMENT_BUDGET_BYTES);
});
