// Speaker notes (SETUP_V2 §12, S16–S19): placement, scroll speed and ranges. Pure, so it
// is unit-tested without Electron.

export const NOTES_W = 560; // panel width (§12.2)
export const NOTES_H = 264; // panel height: 8 + text 204 + footer 52 (mockup 15)
export const DOCK_GAP = 10; // under the menu bar (§12.2)
export const CLEAR = 16; // gap kept to the toolbar
export const SNAP_DOCK = 24; // dragging this close to the dock snaps back to it
export const FONT = { min: 18, max: 40, step: 2, def: 24 };
export const WPM = { min: 80, max: 220, step: 10, def: 140 };
export const LINE_HEIGHT = 1.42;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
export const stepFont = (size, dir) => clamp((Math.round(size / 2) * 2 || FONT.def) + dir * FONT.step, FONT.min, FONT.max);
export const stepWpm = (wpm, dir) => clamp((Math.round(wpm / 10) * 10 || WPM.def) + dir * WPM.step, WPM.min, WPM.max);

// Which display the panel lives on (§12.2): the built-in one (the lens is there) whenever
// it is on, else the display setup is on.
export function notesDisplay(displays, setupDisplayId) {
  return displays.find((d) => d.internal) || displays.find((d) => String(d.id) === String(setupDisplayId)) || displays[0];
}

// The dock: top-centre of the display (under the lens), 10 pt below the menu bar.
export function dockPos(bounds, wa) {
  return { x: Math.round(bounds.x + (bounds.width - NOTES_W) / 2), y: wa.y + DOCK_GAP };
}

const overlaps = (a, b, pad) => a.x < b.x + b.width + pad && a.x + a.width + pad > b.x && a.y < b.y + b.height + pad && a.y + a.height + pad > b.y;

// Where the panel sits: the saved spot or the dock, kept on the work area. The toolbar at
// the top pushes the docked panel below it (§15.5). The camera bubble (and its tray) never
// push it: the panel may sit on top of the camera, so the script can be read right where
// the eyes are; it stays above the bubble and is never captured (content protection).
export function placeNotes(bounds, wa, { saved = null, toolbar = null, height = NOTES_H } = {}) {
  const dock = dockPos(bounds, wa);
  let { x, y } = saved || dock;
  const rect = () => ({ x, y, width: NOTES_W, height });
  const fit = () => {
    x = clamp(x, wa.x, wa.x + wa.width - NOTES_W);
    y = clamp(y, wa.y, wa.y + wa.height - height);
  };
  fit();
  if (toolbar && overlaps(rect(), toolbar, CLEAR)) {
    y = toolbar.y + toolbar.height + CLEAR;
    fit();
  }
  return { x: Math.round(x), y: Math.round(y), docked: !saved };
}

// A dragged panel snaps back to the dock when it ends near it.
export function dropPos(bounds, wa, p) {
  const d = dockPos(bounds, wa);
  if (Math.abs(p.x - d.x) <= SNAP_DOCK && Math.abs(p.y - d.y) <= SNAP_DOCK) return null; // = docked
  return { x: Math.round(clamp(p.x, wa.x, wa.x + wa.width - NOTES_W)), y: Math.round(clamp(p.y, wa.y, wa.y + wa.height - 40)) };
}

// Auto-scroll speed (§12.3): words per minute → pixels per second from the real layout,
// so a bigger text size scrolls faster in pixels but at the same reading pace.
export function pxPerSecond({ wpm, words, lines, lineHeightPx }) {
  if (!words || !lines || !lineHeightPx) return 0;
  const wordsPerLine = words / lines;
  return ((wpm / 60) / wordsPerLine) * lineHeightPx;
}

export const countWords = (text) => (String(text).match(/\S+/g) || []).length;
