// Speaker notes (SETUP_V2 §12, S16–S19): placement, scroll speed, Windows fail-closed check, store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NOTES_W, NOTES_H, CLEAR, dockPos, placeNotes, dropPos, notesDisplay, pxPerSecond, stepFont, stepWpm, countWords } from '../src/shared/notes.js';
import { decide, windowsBuild, parseAffinity, affinityScript, hwndOf, markerVisible, checkPC, MIN_BUILD, WDA_EXCLUDEFROMCAPTURE, MARKER } from '../src/main/notesGuard.js';
import { NotesStore } from '../src/main/notesStore.js';

const bounds = { x: 0, y: 0, width: 1512, height: 982 };
const wa = { x: 0, y: 33, width: 1512, height: 897 };
const hits = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const R = (p) => ({ ...p, width: NOTES_W, height: NOTES_H });

test('docks top-centre under the lens, 10 pt below the menu bar (§12.2)', () => {
  const d = dockPos(bounds, wa);
  assert.equal(d.x + NOTES_W / 2, 756);
  assert.equal(d.y, 43);
  assert.deepEqual(placeNotes(bounds, wa), { ...d, docked: true });
});

test('built-in display whenever it is on, else the setup display', () => {
  const ext = { id: 2, internal: false };
  const mac = { id: 1, internal: true };
  assert.equal(notesDisplay([ext, mac], 2), mac);
  assert.equal(notesDisplay([ext, { id: 3, internal: false }], 3).id, 3);
});

test('a toolbar dragged to the top pushes the docked panel below it (§15.5)', () => {
  const toolbar = { x: 579, y: 49, width: 663, height: 56 };
  const p = placeNotes(bounds, wa, { toolbar });
  assert.equal(p.y, toolbar.y + toolbar.height + CLEAR);
  assert.ok(!hits(R(p), toolbar));
});

test('never covers the bubble or its tray: moves sideways, 16 pt clear', () => {
  const bubble = { x: 600, y: 60, width: 280, height: 280 }; // dragged up under the lens
  const tray = { x: 600, y: 348, width: 332, height: 90 };
  const p = placeNotes(bounds, wa, { avoid: [bubble, tray] });
  for (const r of [bubble, tray]) assert.ok(!hits(R(p), { x: r.x - CLEAR + 1, y: r.y - CLEAR + 1, width: r.width + 2 * CLEAR - 2, height: r.height + 2 * CLEAR - 2 }), JSON.stringify(p));
  // the default bottom-left bubble is nowhere near: the panel stays docked
  assert.deepEqual(placeNotes(bounds, wa, { avoid: [{ x: 24, y: 600, width: 220, height: 220 }] }).x, dockPos(bounds, wa).x);
});

test('a dragged panel keeps its spot; near the dock it snaps back', () => {
  const d = dockPos(bounds, wa);
  assert.equal(dropPos(bounds, wa, { x: d.x + 20, y: d.y + 15 }), null);
  assert.deepEqual(dropPos(bounds, wa, { x: 100, y: 400 }), { x: 100, y: 400 });
  assert.deepEqual(placeNotes(bounds, wa, { saved: { x: 100, y: 400 } }), { x: 100, y: 400, docked: false });
});

test('auto-scroll: wpm → px/s from the layout; text size keeps the reading pace', () => {
  // 140 wpm, 10 words per line, 34 px lines: 140/60/10 lines per second × 34 px
  assert.ok(Math.abs(pxPerSecond({ wpm: 140, words: 200, lines: 20, lineHeightPx: 34 }) - (140 / 60 / 10) * 34) < 1e-9);
  // bigger text: fewer words per line and taller lines → more px/s, same words/s
  const small = pxPerSecond({ wpm: 140, words: 200, lines: 20, lineHeightPx: 34 });
  const big = pxPerSecond({ wpm: 140, words: 200, lines: 40, lineHeightPx: 57 });
  assert.ok(big > small);
  assert.equal(pxPerSecond({ wpm: 140, words: 0, lines: 0, lineHeightPx: 34 }), 0);
  assert.equal(countWords('Hi Sam,  a quick\nwalkthrough.'), 5);
});

test('ranges: text 18–40 step 2, speed 80–220 step 10', () => {
  assert.equal(stepFont(24, 1), 26);
  assert.equal(stepFont(40, 1), 40);
  assert.equal(stepFont(18, -1), 18);
  assert.equal(stepWpm(140, 1), 150);
  assert.equal(stepWpm(220, 1), 220);
  assert.equal(stepWpm(80, -1), 80);
});

test('Windows fail-closed decision (S19): any doubt hides the notes at Record', () => {
  const ok = { platform: 'win32', build: 19045, affinity: WDA_EXCLUDEFROMCAPTURE, selfTest: true };
  assert.deepEqual(decide(ok), { ok: true, reason: null });
  assert.equal(decide({ ...ok, build: MIN_BUILD - 1 }).reason, 'old-windows');
  assert.equal(decide({ ...ok, build: null }).reason, 'old-windows');
  assert.equal(decide({ ...ok, affinity: 0x1 }).reason, 'affinity'); // WDA_MONITOR: black box
  assert.equal(decide({ ...ok, affinity: null }).reason, 'affinity'); // read-back failed
  assert.equal(decide({ ...ok, selfTest: false }).reason, 'self-test');
  assert.equal(decide({ ...ok, selfTest: undefined }).reason, 'self-test');
  assert.deepEqual(decide({ platform: 'darwin' }), { ok: true, reason: null });
  assert.equal(decide({ platform: 'linux' }).ok, false);
});

test('Windows probes: build, HWND and affinity parsing; the self-test pixel check', async () => {
  assert.equal(windowsBuild('10.0.19045'), 19045);
  assert.equal(windowsBuild('10.0.18363'), 18363);
  assert.equal(windowsBuild('garbage'), null);
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(0x1a2b3cn);
  assert.equal(hwndOf(b), String(0x1a2b3c));
  assert.match(affinityScript('1715004'), /GetWindowDisplayAffinity\(\[IntPtr\]::new\(\[Int64\]1715004\)/);
  assert.equal(parseAffinity('17\r\n'), 17);
  assert.equal(parseAffinity(''), null);
  assert.equal(parseAffinity('Exception'), null);
  // 40×40 capture: marker painted in a 20×20 square → visible; plain → not
  const w = 40;
  const img = Buffer.alloc(w * w * 4, 40);
  const rect = { x: 10, y: 10, width: 20, height: 20 };
  assert.equal(markerVisible(img, w, rect), false);
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) img.set([...MARKER, 255], (y * w + x) * 4);
  assert.equal(markerVisible(img, w, rect), true);
  // the whole check never runs probes off Windows, and fails closed when they can't run
  assert.deepEqual(await checkPC({ platform: 'darwin' }), { ok: true, reason: null });
  assert.equal((await checkPC({ platform: 'win32', release: '10.0.17763' })).ok, false);
  assert.equal((await checkPC({ platform: 'win32', release: '10.0.19045', notesWin: null })).reason, 'affinity');
});

test('the script is stored whole, atomically, as plain UTF-8', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-notes-'));
  const store = new NotesStore(path.join(dir, 'notes.txt'));
  assert.equal(store.read(), '');
  const long = 'Ünïcode — line\n\n'.repeat(20000); // no length cap
  store.write(long);
  assert.equal(store.read(), long);
  assert.deepEqual(fs.readdirSync(dir), ['notes.txt']); // no temp file left behind
  fs.rmSync(dir, { recursive: true, force: true });
});
