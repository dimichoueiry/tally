// Setup toolbar placement (SETUP_V2 §15): home, snapping, room, bubble avoidance, window.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homePos, topPos, snapPos, placePill, barWindow, BAR_H, EDGE, FOLDED_W, WIN_MX, WIN_FOOT } from '../src/shared/toolbar.js';

const wa = { x: 0, y: 25, width: 1280, height: 775 }; // 1280×800 display, menu bar 25
const bounds = { x: 0, y: 0, width: 1280, height: 800 };

test('home is bottom-centre for the folded width; unfolding grows right from it (§15.7)', () => {
  const h = homePos(wa);
  assert.equal(h.x, 463); // spec: folded pill spans 463–818
  assert.equal(h.x + FOLDED_W, 818);
  assert.equal(h.y + BAR_H, wa.y + wa.height - EDGE);
  const unfolded = placePill(wa, null, 663);
  assert.deepEqual(unfolded, h); // left edge fixed: 463 → 1126
  assert.equal(topPos(wa).y, wa.y + EDGE);
});

test('the XL bubble + tray in the default corner never pushes the pill (§15.7)', () => {
  const bubbleXL = { x: 24, y: 800 - 24 - 400 - 98, width: 400, height: 400 };
  const tray = { x: 24, y: bubbleXL.y + 408, width: 400, height: 90 };
  assert.deepEqual(placePill(wa, null, 663, [bubbleXL, tray]), homePos(wa));
});

test('a bottom-right bubble moves the unfolded pill left, 16 pt clear (S15)', () => {
  const b = { x: 1280 - 24 - 280, y: 800 - 24 - 280 - 98, width: 280, height: 280 };
  const tray = { x: 1280 - 24 - 332, y: b.y + 288, width: 332, height: 90 };
  const p = placePill(wa, null, 663, [b, tray]);
  assert.equal(p.x + 663, tray.x - EDGE);
  // folded it fits next to it: no move
  assert.deepEqual(placePill(wa, null, FOLDED_W, [b, tray]), homePos(wa));
});

test('a pill saved near the right edge shifts left while unfolded, returns when folded', () => {
  const saved = { x: 1280 - 16 - FOLDED_W, y: 300 };
  assert.equal(placePill(wa, saved, 663).x, 1280 - 16 - 663);
  assert.equal(placePill(wa, saved, FOLDED_W).x, saved.x);
});

test('snapping: home and top-centre magnets, then the 16 pt edge lines; stays on screen', () => {
  const h = homePos(wa);
  assert.deepEqual(snapPos(wa, { x: h.x + 10, y: h.y - 9 }, FOLDED_W), { ...h, at: 'home' });
  assert.equal(snapPos(wa, { x: topPos(wa).x - 5, y: wa.y + 20 }, FOLDED_W).at, 'top');
  const e = snapPos(wa, { x: 1280 - FOLDED_W - 6, y: 300 }, FOLDED_W);
  assert.deepEqual([e.x, e.y, e.at], [1280 - EDGE - FOLDED_W, 300, null]);
  const free = snapPos(wa, { x: 600, y: 300 }, FOLDED_W);
  assert.deepEqual([free.x, free.y], [600, 300]); // free placement elsewhere
  const off = snapPos(wa, { x: -500, y: 2000 }, FOLDED_W);
  assert.deepEqual([off.x, off.y], [0, wa.y + wa.height - BAR_H]);
});

test('bar window: room above at the bottom, below at the top, clamped to the display', () => {
  const home = barWindow(bounds, homePos(wa), FOLDED_W);
  assert.equal(home.down, false);
  assert.equal(home.ox, WIN_MX);
  assert.ok(home.win.y + home.oy === homePos(wa).y && home.win.y + home.win.height <= 800);
  const top = barWindow(bounds, topPos(wa), FOLDED_W);
  assert.equal(top.down, true);
  assert.ok(top.oy <= WIN_FOOT && top.win.y >= 0); // little room above: popovers go below
  const left = barWindow(bounds, { x: 16, y: 500 }, FOLDED_W);
  assert.equal(left.win.x, 0);
  assert.equal(left.ox, 16);
  // the size never depends on where the pill is (no resize under a drag)
  const sizes = [homePos(wa), topPos(wa), { x: 16, y: 500 }, { x: 1280 - 16 - FOLDED_W, y: 300 }].map((p) => barWindow(bounds, p, FOLDED_W).win).map((r) => `${r.width}x${r.height}`);
  assert.equal(new Set(sizes).size, 1);
  const r = barWindow(bounds, { x: 1280 - 16 - FOLDED_W, y: 300 }, FOLDED_W);
  assert.ok(r.win.x + r.win.width <= 1280 && r.win.x + r.ox === 1280 - 16 - FOLDED_W);
});

test('dragging onto another display retargets to it; gaps keep the current one', async () => {
  const { displayAt } = await import('../src/shared/toolbar.js');
  const displays = [
    { id: 1, bounds: { x: 0, y: 0, width: 1280, height: 800 } },
    { id: 2, bounds: { x: 1280, y: -200, width: 1920, height: 1080 } }, // right, taller, offset up
  ];
  assert.equal(displayAt(displays, { x: 600, y: 700 }, 1), '1');
  assert.equal(displayAt(displays, { x: 1300, y: 100 }, 1), '2'); // crossed the edge
  assert.equal(displayAt(displays, { x: 1279, y: 100 }, 2), '1'); // and back
  assert.equal(displayAt(displays, { x: 600, y: 900 }, 2), '2'); // off every screen: stays
  assert.equal(displayAt(displays, { x: -10, y: 10 }, 1), '1');
});

test('after a retarget, a drop snaps and clamps on the new display (global coords)', () => {
  const wa2 = { x: 1280, y: -200, width: 1920, height: 1055 };
  const p = snapPos(wa2, { x: 1290, y: 400 }, FOLDED_W);
  assert.equal(p.x, 1280 + EDGE); // left-edge magnet of display 2, not display 1
  const far = snapPos(wa2, { x: 5000, y: 5000 }, FOLDED_W);
  assert.equal(far.x + FOLDED_W, 1280 + 1920);
  assert.equal(far.y + BAR_H, -200 + 1055);
});
