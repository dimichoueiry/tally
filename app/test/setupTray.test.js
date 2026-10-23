// Setup v2 bubble tray geometry: zoom detents, anchored resize, tray placement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapZoom, clampZoom, anchorFor, resizeAnchored, setupArea, trayRect, sizesThatFit, sizeFromDrag, handlePoint, bubbleSize, INSET, TRAY_GAP, TRAY_MIN_W } from '../src/shared/geometry.js';

const area = { x: 0, y: 25, width: 1440, height: 875 }; // work area under a menu bar

test('zoom snaps to detents within 0.03, else to 0.05, and respects the cap', () => {
  assert.equal(snapZoom(1.23), 1.25);
  assert.equal(snapZoom(1.52), 1.5);
  assert.equal(snapZoom(1.11), 1.1);
  assert.equal(snapZoom(1.37), 1.35);
  assert.equal(snapZoom(0.4), 1);
  assert.equal(snapZoom(2.6), 2);
  assert.equal(snapZoom(1.9, 1.3), 1.3);
  assert.equal(clampZoom(1.25, 1920, 1080), 1.25);
});

test('anchor is the corner nearest the edges the bubble sits by', () => {
  assert.deepEqual(anchorFor(area, { x: 24, y: 600, width: 220, height: 220 }), { h: 'left', v: 'bottom' });
  assert.deepEqual(anchorFor(area, { x: 1100, y: 60, width: 220, height: 220 }), { h: 'right', v: 'top' });
});

test('a tall bubble at the bottom stays bottom-anchored and shrinks back down', () => {
  // In setup the bubble lives in the area above the tray: bottom edge 3 pt from it.
  const sa = setupArea({ x: 0, y: 33, width: 1512, height: 898 }, 168);
  const xl = { x: 87, y: sa.y + sa.height - 3 - 600, width: 450, height: 600 }; // portrait XL
  assert.deepEqual(anchorFor(sa, xl), { h: 'left', v: 'bottom' });
  const back = resizeAnchored(sa, xl, bubbleSize('circle', 'S'));
  assert.equal(back.y + back.height, xl.y + xl.height);
});

test('resize keeps the anchored corner fixed', () => {
  // bottom-left bubble grows up and right: left and bottom edges unchanged
  const r = { x: 24, y: 656, width: 220, height: 220 };
  const big = resizeAnchored(area, r, bubbleSize('circle', 'XL'));
  assert.equal(big.x, 24);
  assert.equal(big.y + big.height, r.y + r.height);
  // top-right bubble grows down and left
  const tr = { x: 1196, y: 49, width: 220, height: 220 };
  const big2 = resizeAnchored(area, tr, bubbleSize('circle', 'L'));
  assert.equal(big2.x + big2.width, tr.x + tr.width);
  assert.equal(big2.y, tr.y);
});

test('resize never pushes the bubble off screen', () => {
  // anchored left/top by position, but a huge size near the bottom-right edge still clamps
  const r = { x: 700, y: 440, width: 330, height: 186 }; // centre is right of middle → right anchor
  const out = resizeAnchored({ x: 0, y: 0, width: 800, height: 700 }, r, bubbleSize('landscape', 'XL'));
  assert.ok(out.x >= 0 && out.x + out.width <= 800);
  assert.ok(out.y >= 0 && out.y + out.height <= 700);
});

test('setup area reserves the tray height so bubble + tray fit; the tray stays inset', () => {
  const sa = setupArea(area, 170);
  assert.equal(sa.height, 875 - 170 - TRAY_GAP);
  const b = { x: 24, y: 400, width: 220, height: 220 };
  const t = trayRect(area, b, 220, 84);
  assert.equal(t.width, TRAY_MIN_W); // 332, wider than an S bubble
  assert.equal(t.y, b.y + b.height + TRAY_GAP);
});

test('tray aligns to the bubble\'s outer edge (SETUP_V2 §11.3)', () => {
  // left half: left edges flush, tray hangs out to the right
  const l = { x: INSET, y: 600, width: 220, height: 220 };
  assert.equal(trayRect(area, l, 220, 84).x, INSET);
  // right half: right edges flush, tray hangs out to the left
  const r = { x: 1440 - INSET - 220, y: 600, width: 220, height: 220 };
  const tr = trayRect(area, r, 220, 84);
  assert.equal(tr.x + tr.width, r.x + r.width);
  // wider bubble (landscape M): tray takes its width
  const w = { x: 300, y: 300, width: 420, height: 236 };
  assert.deepEqual([trayRect(area, w, 420, 84).x, trayRect(area, w, 420, 84).width], [300, 420]);
  // a bubble off the inset still leaves the tray inside it
  const off = { x: 1440 - 230, y: 300, width: 220, height: 220 };
  assert.ok(trayRect(area, off, 344, 84).x + 344 <= 1440 - INSET);
});

test('presets that cannot fit with the inset are reported (disabled in the tray)', () => {
  const big = sizesThatFit(area, 'portrait');
  assert.deepEqual(big, { S: true, M: true, L: true, XL: true });
  const small = sizesThatFit({ x: 0, y: 0, width: 800, height: 500 }, 'portrait'); // XL portrait is 600 tall
  assert.equal(small.S, true);
  assert.equal(small.XL, false);
});

test('corner drag picks the nearest size step', () => {
  const a = { x: 100, y: 800 }; // bottom-left anchor
  assert.equal(sizeFromDrag('circle', a, { x: 100 + 222, y: 800 - 200 }), 'S');
  assert.equal(sizeFromDrag('circle', a, { x: 100 + 290, y: 800 - 290 }), 'M');
  assert.equal(sizeFromDrag('circle', a, { x: 100 + 500, y: 800 - 300 }), 'XL');
  assert.equal(sizeFromDrag('landscape', a, { x: 100 + 515, y: 800 - 280 }), 'L');
});

test('handle sits on the corner opposite the anchor', () => {
  assert.deepEqual(handlePoint('landscape', 330, 186, { h: 'left', v: 'bottom' }), { x: 330, y: 0 });
  assert.deepEqual(handlePoint('landscape', 330, 186, { h: 'right', v: 'top' }), { x: 0, y: 186 });
  const c = handlePoint('circle', 220, 220, { h: 'left', v: 'bottom' });
  assert.ok(Math.abs(Math.hypot(c.x - 110, c.y - 110) - 110) < 2); // on the rim
});
