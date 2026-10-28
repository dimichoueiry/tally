// Continuous bubble size (camera.diam): presets map exactly, min / max clamping, the
// edge / corner resize math.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUBBLE_MIN, BUBBLE_MAX, PRESET_DIAM, SIZES, SHAPES, bubbleSize, diamOf, cameraDiam, clampDiam, maxDiamFor, diamFromDrag, resizeZone, anchorForZone, resizeAnchored, INSET } from '../src/shared/geometry.js';

test('a diameter equal to a preset gives that preset\'s spec size, for every shape', () => {
  for (const shape of SHAPES) for (const s of SIZES) {
    const a = bubbleSize(shape, s);
    const b = bubbleSize(shape, PRESET_DIAM[s]);
    assert.ok(Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1, `${shape} ${s}`);
  }
});

test('older settings (preset only) keep their size; diam wins when set', () => {
  assert.equal(cameraDiam({ size: 'L' }), 340);
  assert.equal(cameraDiam({ size: 'L', diam: null }), 340);
  assert.equal(cameraDiam({ size: 'L', diam: 150 }), 150);
  assert.equal(diamOf('nope'), 220);
});

test('the minimum: 96 pt, and every shape keeps ≥ 80 pt on its short side', () => {
  assert.equal(BUBBLE_MIN, 96);
  for (const shape of SHAPES) {
    const b = bubbleSize(shape, BUBBLE_MIN);
    const short = Math.min(b.width, b.height);
    assert.ok(short >= 80 && short <= 110, `${shape}: ${b.width}×${b.height}`);
  }
  assert.ok(BUBBLE_MIN < PRESET_DIAM.S / 2); // much smaller than the old minimum (S)
});

test('clamping: never below the minimum, never above the max or what fits the screen', () => {
  const big = { width: 3000, height: 2000 };
  assert.equal(clampDiam(10, 'circle', big), BUBBLE_MIN);
  assert.equal(clampDiam(-Infinity, 'circle', big), 220); // not a number → S
  assert.equal(clampDiam(9999, 'circle', big), BUBBLE_MAX);
  assert.equal(clampDiam(150.6), 151);
  // a short screen caps portrait first (it is the tallest)
  const short = { width: 1280, height: 500 };
  const m = maxDiamFor('portrait', short);
  assert.equal(clampDiam(400, 'portrait', short), m);
  assert.ok(bubbleSize('portrait', m).height <= 500 - 2 * INSET);
  // too small a screen for even the minimum: still the minimum (it can't disappear)
  assert.equal(clampDiam(300, 'circle', { width: 120, height: 120 }), BUBBLE_MIN);
});

test('dragging an edge or corner: the box edge follows the pointer', () => {
  const a = { x: 100, y: 800 }; // bottom-left fixed
  // corner along the diagonal of a circle: exact
  assert.equal(Math.round(diamFromDrag('circle', a, { x: 100 + 150, y: 800 - 150 })), 150);
  // right edge of a landscape bubble: width follows x
  const d = diamFromDrag('landscape', a, { x: 100 + 300, y: 777 }, { x: true });
  assert.equal(bubbleSize('landscape', d).width, 300);
  // top edge of a portrait bubble: height follows y
  const d2 = diamFromDrag('portrait', a, { x: 0, y: 800 - 200 }, { y: true });
  assert.equal(bubbleSize('portrait', d2).height, 200);
  // the corner moves smoothly along either axis (no snapping to steps)
  const v = [150, 151, 152].map((x) => diamFromDrag('circle', a, { x: 100 + x, y: 800 - 150 }));
  assert.ok(v[0] < v[1] && v[1] < v[2] && v[2] - v[0] < 2);
});

test('edge zones: the band along the edge resizes, the middle drags', () => {
  assert.deepEqual(resizeZone('landscape', 240, 135, { x: 238, y: 60 }), { zx: 1, zy: 0 });
  assert.deepEqual(resizeZone('landscape', 240, 135, { x: 3, y: 3 }), { zx: -1, zy: -1 });
  assert.equal(resizeZone('landscape', 240, 135, { x: 120, y: 60 }), null);
  assert.deepEqual(resizeZone('circle', 100, 100, { x: 50, y: 2 }), { zx: 0, zy: -1 }); // rim, top
  assert.deepEqual(resizeZone('circle', 100, 100, { x: 50 + 47 * Math.SQRT1_2, y: 50 + 47 * Math.SQRT1_2 }), { zx: 1, zy: 1 });
  assert.equal(resizeZone('circle', 100, 100, { x: 50, y: 50 }), null);
  assert.equal(resizeZone('circle', 100, 100, { x: 2, y: 2 }), null); // the box corner is outside the circle
});

test('the grabbed edge moves, the opposite one stays (screen anchor on the other axis)', () => {
  const area = { x: 0, y: 0, width: 1512, height: 982 };
  const r = { x: 600, y: 400, width: 220, height: 220 };
  const an = anchorForZone({ zx: -1, zy: 0 }, { h: 'left', v: 'bottom' }); // left edge grabbed
  assert.deepEqual(an, { h: 'right', v: 'bottom' });
  const out = resizeAnchored(area, r, bubbleSize('circle', 120), an);
  assert.equal(out.x + out.width, r.x + r.width);
  assert.equal(out.y + out.height, r.y + r.height);
});

test('a minimum bubble still reaches every screen edge and corner', async () => {
  const { clampRect } = await import('../src/shared/geometry.js');
  const bounds = { x: 0, y: 0, width: 1512, height: 982 };
  const { width, height } = bubbleSize('circle', BUBBLE_MIN);
  for (const [x, y] of [[-500, -500], [5000, -500], [-500, 5000], [5000, 5000]]) {
    const r = clampRect(bounds, { x, y, width, height });
    assert.ok(r.x === 0 || r.x + width === 1512);
    assert.ok(r.y === 0 || r.y + height === 982);
  }
});
