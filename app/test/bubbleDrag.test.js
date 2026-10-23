// LC-9 regression: the camera bubble must never follow the pointer on hover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BubbleDrag, DRAG_THRESHOLD } from '../src/shared/bubbleDrag.js';

const phases = (acts) => acts.map((a) => a.phase);

test('hover never drags: moves with no press do nothing', () => {
  const d = new BubbleDrag();
  for (let i = 0; i < 50; i++) assert.deepEqual(d.move(100 + i * 7, 200 + i * 3, 0), []);
  assert.equal(d.active, false);
});

test('press + more than 3 px with the button down starts, release ends', () => {
  const d = new BubbleDrag();
  d.press(100, 100);
  assert.deepEqual(d.move(100 + DRAG_THRESHOLD, 100, 1), [], '3 px is not enough');
  assert.deepEqual(phases(d.move(104, 100, 1)), ['start', 'move']);
  assert.deepEqual(d.move(150, 120, 1), [{ phase: 'move', x: 150, y: 120 }]);
  assert.deepEqual(d.end(150, 120), [{ phase: 'end', x: 150, y: 120 }]);
  assert.equal(d.active, false);
  assert.deepEqual(d.move(300, 300, 0), [], 'hover after release does nothing');
});

test('lost mouseup (bug repro): the next move without a button ends the drag, then hover is inert', () => {
  const d = new BubbleDrag();
  d.press(134, 797);
  d.move(160, 780, 1); // drag started, then the window hid and pointerup was never delivered
  assert.equal(d.started, true);
  assert.deepEqual(phases(d.move(140, 800, 0)), ['end']);
  assert.deepEqual(d.move(500, 500, 0), []);
});

test('press interrupted before the threshold leaves nothing armed', () => {
  const d = new BubbleDrag();
  d.press(10, 10);
  assert.deepEqual(d.move(400, 400, 0), [], 'a click whose release was lost never moves the bubble');
  assert.equal(d.active, false);
});

test('blur / Esc / leave / hide end an active drag at the last position', () => {
  const d = new BubbleDrag();
  d.press(0, 0);
  d.move(10, 0, 1);
  d.move(20, 5, 1);
  assert.deepEqual(d.end(), [{ phase: 'end', x: 20, y: 5 }]);
  assert.deepEqual(d.end(), [], 'ending twice is harmless');
});

test('only the primary button arms a drag, and a new press replaces a stale one', () => {
  const d = new BubbleDrag();
  d.press(0, 0, 2);
  assert.deepEqual(d.move(50, 50, 2), []);
  d.press(0, 0);
  d.move(10, 0, 1);
  assert.deepEqual(phases(d.press(10, 0)), ['end']);
  assert.equal(d.started, false);
});
