import test from 'node:test';
import assert from 'node:assert/strict';
import { scrollbarGeometry, scrollbarKeyTarget } from '../lib/scrollbar';

test('short homepage has no thumb and long pages map to both track ends', () => {
  assert.equal(scrollbarGeometry(900, 900, 804, 0).scrollable, false);
  const top = scrollbarGeometry(900, 3600, 804, 0);
  assert.equal(top.thumb, 201);
  assert.equal(top.offset, 0);
  const end = scrollbarGeometry(900, 3600, 804, 2700);
  assert.equal(end.offset, end.travel);
  assert.equal(end.progress, 100);
});
test('handles resize, overscroll, empty tracks and very long articles', () => {
  assert.equal(scrollbarGeometry(900, 3600, 804, -20).offset, 0);
  assert.equal(scrollbarGeometry(900, 3600, 804, 9999).progress, 100);
  assert.equal(scrollbarGeometry(900, 1e6, 804, 0).thumb, 44);
  assert.equal(scrollbarGeometry(900, 3600, 0, 0).scrollable, false);
  assert.equal(scrollbarGeometry(900, 300, 804, 400).scrollable, false);
});
test('keyboard scrolling supports arrows, pages, space and boundaries', () => {
  assert.equal(scrollbarKeyTarget('End', 0, 900, 2700, false), 2700);
  assert.equal(scrollbarKeyTarget('Home', 900, 900, 2700, false), 0);
  assert.equal(scrollbarKeyTarget('PageDown', 0, 900, 2700, false), 810);
  assert.equal(scrollbarKeyTarget(' ', 900, 900, 2700, true), 90);
  assert.equal(scrollbarKeyTarget('ArrowUp', 0, 900, 2700, false), 0);
  assert.equal(scrollbarKeyTarget('ArrowDown', 2700, 900, 2700, false), 2700);
  assert.equal(scrollbarKeyTarget('Tab', 0, 900, 2700, false), null);
});
