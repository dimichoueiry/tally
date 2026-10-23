// Setup toolbar / recording bar placement (SETUP_V2 §15). Pure: every function takes a
// work area and rectangles in screen pt, so it is unit-tested without Electron.

export const BAR_H = 56; // setup toolbar, countdown and recording bar share this height
export const FOLDED_W = 355; // folded setup pill without status icons (§15.1): defines "home"
export const EDGE = 16; // gap to the screen edges, and to the bubble (S15)
export const SNAP_R = 12; // magnetic radius (§15.5)
export const MOVE_STEP = 16; // ⌥ + arrow; ⌥⇧ + arrow is 4×

// Home is bottom-centre, 16 pt above the Dock, for the folded width. It does not move
// when the pill unfolds: the pill grows to the right from this left edge (S23).
export function homePos(wa) {
  return { x: Math.round(wa.x + (wa.width - FOLDED_W) / 2), y: wa.y + wa.height - EDGE - BAR_H };
}

export function topPos(wa) {
  return { x: homePos(wa).x, y: wa.y + EDGE };
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

// A dragged / nudged position: magnets at home and top-centre (both axes), then at the
// 16 pt edge lines (each axis on its own). Always kept fully on the work area.
// Returns { x, y, at } with at = 'home' | 'top' | null.
export function snapPos(wa, p, width) {
  for (const [at, t] of [['home', homePos(wa)], ['top', topPos(wa)]]) {
    if (Math.abs(p.x - t.x) <= SNAP_R && Math.abs(p.y - t.y) <= SNAP_R) return { ...t, at };
  }
  let { x, y } = p;
  const left = wa.x + EDGE;
  const right = wa.x + wa.width - EDGE - width;
  const top = wa.y + EDGE;
  const bottom = wa.y + wa.height - EDGE - BAR_H;
  if (Math.abs(x - left) <= SNAP_R) x = left;
  else if (Math.abs(x - right) <= SNAP_R) x = right;
  if (Math.abs(y - top) <= SNAP_R) y = top;
  else if (Math.abs(y - bottom) <= SNAP_R) y = bottom;
  return { x: Math.round(clamp(x, wa.x, wa.x + wa.width - width)), y: Math.round(clamp(y, wa.y, wa.y + wa.height - BAR_H)), at: null };
}

const hits = (a, b, pad) => a.x < b.x + b.width + pad && a.x + a.width + pad > b.x && a.y < b.y + b.height + pad && a.y + a.height + pad > b.y;

// Where the pill actually sits for its current width: the saved spot (or home), shifted
// left while it is too wide to fit (it returns when folded), then moved sideways to keep
// 16 pt clear of the bubble + tray (S15): to the bubble's left if there is room, else
// to its right, else (no room beside it) just above it. `avoid` is a list of rects.
export function placePill(wa, saved, width, avoid = []) {
  const base = saved || homePos(wa);
  let x = Math.min(base.x, wa.x + wa.width - EDGE - width);
  x = Math.max(x, wa.x);
  let y = clamp(base.y, wa.y, wa.y + wa.height - BAR_H);
  for (const r of avoid) {
    if (!r || !hits({ x, y, width, height: BAR_H }, r, EDGE)) continue;
    const leftX = r.x - EDGE - width;
    const rightX = r.x + r.width + EDGE;
    if (leftX >= wa.x + EDGE && (x + width / 2 <= r.x + r.width / 2 || rightX + width > wa.x + wa.width - EDGE)) x = leftX;
    else if (rightX + width <= wa.x + wa.width - EDGE) x = rightX;
    else if (r.y - EDGE - BAR_H >= wa.y) y = r.y - EDGE - BAR_H;
    else if (r.y + r.height + EDGE + BAR_H <= wa.y + wa.height) y = r.y + r.height + EDGE;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

// The bar window: the pill plus transparent room for popovers / tooltips / toasts on
// the side away from the nearer screen edge, and for the close badge and shadow. Its
// size depends only on the pill's width: near a screen edge it is shifted, never
// shrunk (macOS pulls windows back on screen, and resizing a window under a drag
// stalls its input), and `ox`/`oy` is where the pill sits inside it. Popovers open
// downward when the pill is in the top half (§15.5).
export const WIN_MX = 200; // side room: popovers centred on a button can overhang the pill
export const WIN_HEAD = 480; // popover side: More menu (~430) + arrow + gap
export const WIN_FOOT = 96; // other side: the pill's shadow (dragging: 22 pt down + 50 pt blur)

export function barWindow(bounds, pill, width) {
  const down = pill.y + BAR_H / 2 < bounds.y + bounds.height / 2;
  const w = Math.min(width + 2 * WIN_MX, bounds.width);
  const h = Math.min(BAR_H + WIN_HEAD + WIN_FOOT, bounds.height);
  const x = clamp(pill.x - WIN_MX, bounds.x, bounds.x + bounds.width - w);
  const y = clamp(down ? pill.y - WIN_FOOT : pill.y - WIN_HEAD, bounds.y, bounds.y + bounds.height - h);
  return { win: { x, y, width: w, height: h }, ox: pill.x - x, oy: pill.y - y, down };
}

// Dragging the toolbar onto another display retargets setup to it (Loom behaviour): the
// display under the pointer wins; between displays (a gap, or off every screen) the
// current one stays. `displays` are { id, bounds }. Returns the id as a string.
export function displayAt(displays, pt, currentId) {
  const inside = (b) => pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height;
  const hit = displays.find((d) => inside(d.bounds));
  return String(hit ? hit.id : currentId);
}
