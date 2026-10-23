// Privacy levels: which strips of the recorded display get painted over (menu bar, Dock).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hiddenParts, parseDock, maskRects, MENU_BAR_PT, DOCK_PAD } from '../src/shared/privacy.js';

const both = { menuBar: true, dock: true };
const strip = (rects, part) => rects.find((r) => r.part === part);

test('levels map to the parts they hide', () => {
  assert.deepEqual(hiddenParts({ privacy: 'standard' }), { menuBar: false, dock: false });
  assert.deepEqual(hiddenParts({ privacy: 'semi', keep: 'dock' }), { menuBar: true, dock: false });
  assert.deepEqual(hiddenParts({ privacy: 'semi', keep: 'menubar' }), { menuBar: false, dock: true });
  assert.deepEqual(hiddenParts({ privacy: 'very', keep: 'menubar' }), both);
  assert.deepEqual(hiddenParts(), { menuBar: false, dock: false });
});

test('parses defaults read com.apple.dock, with defaults for missing keys', () => {
  const d = parseDock('{\n    autohide = 1;\n    "largesize" = 90;\n    magnification = 1;\n    orientation = left;\n    tilesize = 32;\n    "persistent-apps" = ( );\n}');
  assert.deepEqual(d, { orientation: 'left', autohide: true, tilesize: 32, magnification: true, largesize: 90 });
  assert.deepEqual(parseDock('{\n    tilesize = "41.5";\n}'), { orientation: 'bottom', autohide: false, tilesize: 41.5, magnification: false, largesize: 128 });
  assert.equal(parseDock('').orientation, 'bottom');
});

test('Dock at the bottom: strip is the work-area inset, full width', () => {
  const display = { bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 805 } };
  const r = maskRects(display, parseDock('tilesize = 48;'), both);
  assert.deepEqual(strip(r, 'dock'), { x: 0, y: 830, width: 1440, height: 70, part: 'dock' });
  assert.deepEqual(strip(r, 'menuBar'), { x: 0, y: 0, width: 1440, height: 25, part: 'menuBar' });
});

test('Dock on the left / right of a secondary display (negative origin)', () => {
  const bounds = { x: -1920, y: -200, width: 1920, height: 1080 };
  const left = maskRects({ bounds, workArea: { x: -1856, y: -175, width: 1856, height: 1055 } }, parseDock('orientation = left;\ntilesize = 40;'), { dock: true });
  assert.deepEqual(left, [{ x: 0, y: 0, width: 64, height: 1080, part: 'dock' }]);
  const right = maskRects({ bounds, workArea: { x: -1920, y: -175, width: 1856, height: 1055 } }, parseDock('orientation = right;\ntilesize = 40;'), { dock: true });
  assert.deepEqual(right, [{ x: 1856, y: 0, width: 64, height: 1080, part: 'dock' }]);
});

test('autohiding Dock (no inset) is still covered: icon size + padding, or the magnified size', () => {
  const display = { bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 38, width: 1512, height: 944 } };
  const r = maskRects(display, parseDock('autohide = 1;\ntilesize = 40;'), { dock: true });
  assert.deepEqual(r, [{ x: 0, y: 982 - 40 - DOCK_PAD, width: 1512, height: 40 + DOCK_PAD, part: 'dock' }]);
  const mag = maskRects(display, parseDock('autohide = 1;\ntilesize = 40;\nmagnification = 1;\nlargesize = 100;'), { dock: true });
  assert.equal(mag[0].height, 100 + DOCK_PAD);
  const side = maskRects(display, parseDock('autohide = 1;\norientation = right;\ntilesize = 40;'), { dock: true });
  assert.deepEqual(side, [{ x: 1512 - 40 - DOCK_PAD, y: 0, width: 40 + DOCK_PAD, height: 982, part: 'dock' }]);
});

test('menu bar on a notched display is as tall as the notch', () => {
  // 14" MacBook Pro: 1512×982 pt, menu bar 38 pt
  const display = { bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 38, width: 1512, height: 900 } };
  assert.deepEqual(maskRects(display, undefined, { menuBar: true }), [{ x: 0, y: 0, width: 1512, height: 38, part: 'menuBar' }]);
  // Menu bar set to autohide: no inset, so use the safe-area top (notch) or 24 pt.
  const hidden = { ...display, workArea: { x: 0, y: 0, width: 1512, height: 938 } };
  assert.equal(maskRects(hidden, undefined, { menuBar: true }, { menuBarAutohide: true, safeTop: 38 })[0].height, 38);
  assert.equal(maskRects(hidden, undefined, { menuBar: true }, { menuBarAutohide: true, safeTop: 0 })[0].height, MENU_BAR_PT);
  // No menu bar on this display and none can appear: nothing to cover.
  assert.deepEqual(maskRects(hidden, undefined, { menuBar: true }), []);
});

test('standard hides nothing', () => {
  const display = { bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 805 } };
  assert.deepEqual(maskRects(display, undefined, hiddenParts({ privacy: 'standard' })), []);
});
