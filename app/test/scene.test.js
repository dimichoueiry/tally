// Full camera switch (⌥⇧F): progress, reversal mid-way, the camera box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_MS, easeInOut, sceneProgress, switchScene, sceneBox } from '../src/shared/scene.js';
import { SESSION } from '../src/main/shortcuts.js';

test('ease: 0 → 1, monotonic, symmetric', () => {
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.ok(Math.abs(easeInOut(0.5) - 0.5) < 1e-9);
  for (let t = 0; t < 1; t += 0.05) assert.ok(easeInOut(t + 0.05) >= easeInOut(t));
});

test('a switch takes 400 ms; no scene is the bubble', () => {
  assert.equal(SCENE_MS, 400);
  assert.equal(sceneProgress(null, 123), 0);
  const s = switchScene(null, true, 1000);
  assert.equal(sceneProgress(s, 1000), 0);
  assert.equal(sceneProgress(s, 1200), 0.5);
  assert.equal(sceneProgress(s, 1400), 1);
  assert.equal(sceneProgress(s, 9999), 1);
  const back = switchScene(s, false, 5000);
  assert.equal(sceneProgress(back, 5000), 1);
  assert.equal(sceneProgress(back, 5400), 0);
});

test('switching back mid-way turns around from where it was (no jump)', () => {
  const s = switchScene(null, true, 0);
  const mid = sceneProgress(s, 100);
  const back = switchScene(s, false, 100);
  assert.equal(sceneProgress(back, 100), mid);
  assert.ok(sceneProgress(back, 200) < mid);
  assert.equal(sceneProgress(back, 500), 0);
});

test('the camera box grows from the bubble to the whole frame, corners square at the end', () => {
  const bubble = { x: 30, y: 760, w: 280, h: 280 };
  const frame = { width: 1920, height: 1080 };
  assert.equal(sceneBox(bubble, frame, 0, 140).radius, null);
  const mid = sceneBox(bubble, frame, 0.5, 140);
  assert.deepEqual([mid.x, mid.y, mid.w, mid.h, mid.radius], [15, 380, 1100, 680, 70]);
  const full = sceneBox(bubble, frame, 1, 140);
  assert.deepEqual([full.x, full.y, full.w, full.h, full.radius], [0, 0, 1920, 1080, 0]);
});

test('⌥⇧F is the session shortcut for full camera, free of the others', () => {
  assert.equal(SESSION.fullcam, 'Alt+Shift+F');
  assert.equal(new Set(Object.values(SESSION)).size, Object.values(SESSION).length);
  assert.ok(!['Alt+Shift+R', 'Alt+Shift+N'].includes(SESSION.fullcam));
});
