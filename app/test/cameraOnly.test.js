// Camera only: the output's aspect crop, its resolution, and the setup preview frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASPECTS, ASPECT_KEYS, aspectOf, cropRect, cameraOutputSize, cameraPreviewRect, INSET, anchorFor, resizeAnchored, clampRect } from '../src/shared/geometry.js';
import { DEFAULTS } from '../src/main/settings.js';
import { sourceLabel } from '../src/main/library/names.js';

const close = (a, b, eps = 0.5) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('the four ratios, unknown keys fall back to 16:9', () => {
  assert.deepEqual(ASPECT_KEYS, ['16:9', '9:16', '1:1', '4:5']);
  assert.equal(aspectOf('9:16'), 9 / 16);
  assert.equal(aspectOf('nope'), 16 / 9);
});

test('the crop is the largest of that ratio, centred, inside the frame', () => {
  for (const [w, h] of [[1920, 1080], [3840, 2160], [1280, 720], [1920, 1440], [1080, 1920]]) {
    for (const k of ASPECT_KEYS) {
      const c = cropRect(w, h, ASPECTS[k], 1);
      close(c.sw / c.sh, ASPECTS[k], 0.002);
      assert.ok(c.sx >= 0 && c.sy >= 0 && c.sx + c.sw <= w + 1e-9 && c.sy + c.sh <= h + 1e-9, `${w}×${h} ${k}`);
      assert.ok(Math.abs(c.sw - w) < 1e-9 || Math.abs(c.sh - h) < 1e-9, 'touches two edges: largest crop');
      close(c.sx + c.sw / 2, w / 2);
      close(c.sy + c.sh / 2, h / 2);
    }
  }
});

test('zoom shrinks the crop around the centre and never leaves the frame', () => {
  const c = cropRect(1920, 1080, 9 / 16, 2, { x: 0.95, y: 0.5 });
  close(c.sh, 540);
  close(c.sw, 303.75);
  assert.ok(c.sx + c.sw <= 1920);
});

test('output: social sizes from any camera (upscaled when needed), even numbers', () => {
  const social = { '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], '16:9': [1920, 1080] };
  for (const [w, h] of [[1920, 1080], [1280, 720], [3840, 2160], [640, 480], [1920, 1440]]) {
    for (const [k, [ow, oh]] of Object.entries(social)) assert.deepEqual(cameraOutputSize(w, h, k), { width: ow, height: oh }, `${w}×${h} ${k}`);
  }
  // Native keeps a bigger camera's pixels, never goes below the social size
  assert.deepEqual(cameraOutputSize(3840, 2160, '9:16', 'native'), { width: 1216, height: 2160 });
  assert.deepEqual(cameraOutputSize(1920, 1080, '9:16', 'native'), { width: 1080, height: 1920 });
  for (const k of ASPECT_KEYS) {
    const o = cameraOutputSize(1919, 1079, k);
    assert.equal(o.width % 2, 0);
    assert.equal(o.height % 2, 0);
  }
});

test('setup preview: that ratio, centred, inside the inset, room left under it for tray + toolbar', () => {
  const wa = { x: 0, y: 33, width: 1512, height: 875 };
  for (const k of ASPECT_KEYS) {
    const r = cameraPreviewRect(wa, k, { trayH: 120 });
    close(r.width / r.height, ASPECTS[k], 0.01);
    assert.ok(r.x >= wa.x + INSET && r.x + r.width <= wa.x + wa.width - INSET, k);
    assert.ok(r.y >= wa.y + INSET, k);
    assert.ok(r.y + r.height + 8 + 120 + 56 + 32 <= wa.y + wa.height - INSET + 1, `${k}: tray and toolbar fit under it`);
    close(r.x + r.width / 2, wa.x + wa.width / 2, 1);
    assert.ok(Math.min(r.width, r.height) >= 300, `${k}: large`);
  }
});

test('mode and ratio are remembered settings; files are named "Camera"', () => {
  assert.equal(DEFAULTS.source.mode, 'display');
  assert.deepEqual(DEFAULTS.camOnly, { aspect: '16:9', pos: {} }); // pos: centred until dragged
  assert.equal(sourceLabel({ kind: 'camera', aspect: '9:16' }), 'Camera');
});

test('the preview moves anywhere, corners and bottom edge included; a new ratio keeps its corner', () => {
  // What the controller does: the drop is clamped to the display bounds (not the work area,
  // and nothing is reserved for the toolbar), then re-placed from the saved spot.
  const bounds = { x: 0, y: 0, width: 1512, height: 982 };
  const wa = { x: 0, y: 33, width: 1512, height: 875 };
  const r = cameraPreviewRect(wa, '16:9', { trayH: 120 });
  for (const [x, y] of [[1e4, 1e4], [-1e4, 1e4], [-1e4, -1e4], [1e4, -1e4]]) {
    const p = clampRect(bounds, { ...r, x, y });
    assert.ok(p.x === 0 || p.x + p.width === 1512, 'touches a side');
    assert.ok(p.y === 0 || p.y + p.height === 982, 'touches the top or bottom');
  }
  assert.deepEqual(clampRect(bounds, { ...r, x: 300, y: 1e4 }), { ...r, x: 300, y: 982 - r.height }); // bottom edge
  const corner = clampRect(bounds, { ...r, x: 1e4, y: 1e4 });
  const tall = cameraPreviewRect(wa, '9:16', { trayH: 120 });
  const next = resizeAnchored(bounds, corner, tall, anchorFor(bounds, corner));
  assert.equal(next.x + next.width, 1512);
  assert.equal(next.y + next.height, 982);
  close(next.width / next.height, 9 / 16, 0.01);
});

test('the output is the camera crop alone: where the preview sits never changes it', () => {
  // cameraOutputSize / cropRect take no position; the engine draws the crop at 0,0 full frame.
  assert.equal(cameraOutputSize.length, 3); // (camW, camH, aspectKey[, quality])
  assert.deepEqual(cameraOutputSize(1920, 1080, '9:16'), { width: 1080, height: 1920 });
});
