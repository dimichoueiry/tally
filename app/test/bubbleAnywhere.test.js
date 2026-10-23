// The camera bubble goes anywhere on its display (bottom edge and corners included,
// over the Dock strip and the toolbar's spot), and the toolbar gets out of its way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampRect, snapRect, trayRect, TRAY_GAP, INSET } from '../src/shared/geometry.js';
import { placePill, homePos, EDGE, BAR_H } from '../src/shared/toolbar.js';
import { DEFAULTS } from '../src/main/settings.js';

const bounds = { x: 0, y: 0, width: 1512, height: 982 }; // MacBook Pro 14", Dock at the bottom
const wa = { x: 0, y: 33, width: 1512, height: 875 }; // work area (menu bar 33, Dock 74)
const S = 220;
const drop = (x, y) => {
  // what _moveBubble does: clamp to the display, then snap to the work area's inset lines
  const r = clampRect(bounds, { x, y, width: S, height: S });
  return snapRect(wa, r).rect;
};

test('dropped past the bottom, the bubble touches the bottom of the display (corners + centre)', () => {
  for (const x of [-50, (1512 - S) / 2, 2000]) {
    const r = drop(x, 5000);
    assert.equal(r.y + r.height, bounds.height, `x=${x}`);
  }
  assert.equal(drop(-50, 5000).x, 0);
  assert.equal(drop(2000, 5000).x + S, 1512);
});

test('near the work area bottom it still snaps to the inset line above the Dock', () => {
  const r = drop(INSET, wa.y + wa.height - INSET - S + 10);
  assert.equal(r.y, wa.y + wa.height - INSET - S);
});

test('the setup tray flips above a bubble on the bottom edge, stays under it otherwise', () => {
  const low = { x: 24, y: bounds.height - S, width: S, height: S };
  const t = trayRect(wa, low, S, 84);
  assert.equal(t.above, true);
  assert.equal(t.y, low.y - TRAY_GAP - 84);
  const high = { x: 24, y: 300, width: S, height: S };
  const u = trayRect(wa, high, S, 84);
  assert.equal(u.above, undefined);
  assert.equal(u.y, high.y + S + TRAY_GAP);
});

test('a bubble dropped on the toolbar at bottom-centre moves the toolbar aside', () => {
  const b = drop((1512 - S) / 2, 5000);
  for (const width of [150, 355, 663]) {
    const p = placePill(wa, null, width, [b]);
    const beside = p.x + width + EDGE <= b.x || p.x >= b.x + b.width + EDGE;
    const above = p.y + BAR_H + EDGE <= b.y;
    assert.ok(beside || above, `width ${width}: ${JSON.stringify(p)}`);
    if (width < 663) assert.equal(p.y, homePos(wa).y); // narrow pills move sideways
  }
});

test('collapsed is remembered next to the fold state, off by default', () => {
  assert.deepEqual(DEFAULTS.toolbar, { unfolded: false, collapsed: false, pos: {} });
});

test('a drag or resize ends where the pointer last moved unless it is a real release', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/renderer/bubble/bubble.js', import.meta.url), 'utf8');
  for (const fn of ['endDrag', 'endResize']) {
    const body = src.slice(src.indexOf(`function ${fn}(e)`), src.indexOf('\n}', src.indexOf(`function ${fn}(e)`)));
    assert.match(body, /e\?\.type === 'pointerup' \? e\.screenX : undefined/, fn);
  }
});
