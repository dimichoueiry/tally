import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bubbleSize, constrainToWindow, fitSize, cropRect, maxZoom, clampZoom, snapRect, relToWindow } from '../src/shared/geometry.js';

test('sizes match DESIGN_SPEC §3.2', () => {
  assert.deepEqual(bubbleSize('circle', 'S'), { width: 220, height: 220 });
  assert.deepEqual(bubbleSize('landscape', 'XL'), { width: 600, height: 338 });
  assert.deepEqual(bubbleSize('portrait', 'M'), { width: 316, height: 420 });
});

test('preset fit still steps XL → L → M → S', () => {
  assert.equal(fitSize('circle', 'XL', { width: 1000, height: 1000 }), 'XL');
  assert.equal(fitSize('circle', 'XL', { width: 400, height: 400 }), 'L'); // 340 + 48 ≤ 400
  assert.equal(fitSize('circle', 'XL', { width: 300, height: 300 }), 'S');
});

test('window mode shrinks the bubble continuously and hides it only below the minimum', () => {
  const r = constrainToWindow({ x: 0, y: 0, width: 200, height: 200 }, 'circle', 'S');
  assert.equal(r.hidden, false);
  assert.deepEqual([r.width, r.height, r.stepped], [152, 152, true]); // 200 − 2 × 24
  const full = constrainToWindow({ x: 0, y: 0, width: 1000, height: 800 }, 'landscape', 'M');
  assert.deepEqual([full.width, full.height, full.stepped], [420, 236, false]); // presets keep the spec table
  assert.equal(constrainToWindow({ x: 0, y: 0, width: 143, height: 600 }, 'circle', 300).hidden, true); // 95 < 96
  assert.equal(constrainToWindow({ x: 0, y: 0, width: 144, height: 600 }, 'circle', 300).width, 96);
});

test('window mode keeps the bubble inside with the 24 pt inset and follows the window', () => {
  const win = { x: 100, y: 50, width: 800, height: 600 };
  const r = constrainToWindow(win, 'circle', 'S', { left: -500, bottom: 9999 });
  assert.deepEqual([r.x, r.y], [124, 74]);
  const rel = relToWindow(win, { x: 300, y: 300, width: 220, height: 220 });
  const moved = constrainToWindow({ ...win, x: 400 }, 'circle', 'S', rel);
  assert.deepEqual([moved.x, moved.y], [600, 300]);
});

test('snap to inset lines within 16 pt', () => {
  const area = { x: 0, y: 0, width: 1000, height: 800 };
  const { rect, guides } = snapRect(area, { x: 30, y: 800 - 24 - 220 - 10, width: 220, height: 220 });
  assert.deepEqual([rect.x, rect.y], [24, 556]);
  assert.ok(guides.left && guides.bottom);
});

test('zoom cap keeps ≥ 540 px on the short side', () => {
  assert.equal(maxZoom(1280, 720), 1.3);
  assert.equal(maxZoom(1920, 1080), 2);
  assert.equal(clampZoom(1.9, 1280, 720), 1.3);
  assert.equal(clampZoom(0.5, 1920, 1080), 1);
});

test('crop is centred on the face and clamped to the frame', () => {
  const c = cropRect(1920, 1080, 1, 2, { x: 0.5, y: 0.5 });
  assert.deepEqual(c, { sx: 690, sy: 270, sw: 540, sh: 540 });
  const edge = cropRect(1920, 1080, 1, 2, { x: 0, y: 0 });
  assert.deepEqual([edge.sx, edge.sy], [0, 0]);
  const wide = cropRect(1920, 1080, 16 / 9, 1);
  assert.deepEqual(wide, { sx: 0, sy: 0, sw: 1920, sh: 1080 });
});
