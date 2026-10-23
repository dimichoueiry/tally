// Camera bubble geometry. Shared by main (window-mode constraint), the bubble
// preview (CSS) and the engine (canvas clip). Pure: no DOM, no Electron.

export const SHAPES = ['circle', 'squircle', 'landscape', 'portrait'];
export const SIZES = ['S', 'M', 'L', 'XL'];
export const INSET = 24; // --bub-inset
export const SNAP = 16; // snap distance to an inset line
export const RECT_RADIUS = 14; // landscape / portrait corner radius, pt
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.1;

// DESIGN_SPEC §3.2, in logical pt. Literal table: the spec's rounding is not uniform.
const DIMS = {
  circle: { S: [220, 220], M: [280, 280], L: [340, 340], XL: [400, 400] },
  squircle: { S: [220, 220], M: [280, 280], L: [340, 340], XL: [400, 400] },
  landscape: { S: [330, 186], M: [420, 236], L: [510, 286], XL: [600, 338] },
  portrait: { S: [248, 330], M: [316, 420], L: [382, 510], XL: [450, 600] },
};

export function bubbleSize(shape, size) {
  const d = (DIMS[shape] || DIMS.circle)[size] || DIMS.circle.S;
  return { width: d[0], height: d[1] };
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Smallest step that fits, walking down from the chosen one (XL → L → M → S).
export function fitSize(shape, chosen, room) {
  for (let i = SIZES.indexOf(chosen); i >= 0; i--) {
    const { width, height } = bubbleSize(shape, SIZES[i]);
    if (width + 2 * INSET <= room.width && height + 2 * INSET <= room.height) return SIZES[i];
  }
  return null;
}

// Window mode (D4): keep the bubble inside the recorded window with the inset.
// `rel` is the bubble's offset from the window's bottom-left corner, so the
// bubble follows the window when it moves. Returns screen coordinates.
export function constrainToWindow(win, shape, chosen, rel = { left: INSET, bottom: INSET }) {
  const size = fitSize(shape, chosen, win);
  if (!size) return { hidden: true, size: null };
  const { width, height } = bubbleSize(shape, size);
  const x = clamp(win.x + rel.left, win.x + INSET, win.x + win.width - INSET - width);
  const yFromBottom = clamp(rel.bottom, INSET, win.height - INSET - height);
  const y = win.y + win.height - yFromBottom - height;
  return { hidden: false, size, x: Math.round(x), y: Math.round(y), width, height, stepped: size !== chosen };
}

export function relToWindow(win, rect) {
  return { left: rect.x - win.x, bottom: win.y + win.height - (rect.y + rect.height) };
}

// Clamp a dragged rect into an area. Display mode keeps the bubble fully on screen;
// window mode passes the window inset by INSET so dragging stops at the window edge.
export function clampRect(area, rect) {
  return {
    ...rect,
    x: Math.round(clamp(rect.x, area.x, area.x + area.width - rect.width)),
    y: Math.round(clamp(rect.y, area.y, area.y + area.height - rect.height)),
  };
}

// Snap to the 24 pt inset lines when within 16 pt of them. Returns the snapped
// rect plus which guides are active (for the drag guides).
export function snapRect(area, rect) {
  const lines = {
    left: area.x + INSET,
    right: area.x + area.width - INSET - rect.width,
    top: area.y + INSET,
    bottom: area.y + area.height - INSET - rect.height,
  };
  let { x, y } = rect;
  const guides = {};
  if (Math.abs(x - lines.left) <= SNAP) { x = lines.left; guides.left = true; }
  else if (Math.abs(x - lines.right) <= SNAP) { x = lines.right; guides.right = true; }
  if (Math.abs(y - lines.top) <= SNAP) { y = lines.top; guides.top = true; }
  else if (Math.abs(y - lines.bottom) <= SNAP) { y = lines.bottom; guides.bottom = true; }
  return { rect: { ...rect, x, y }, guides };
}

export function defaultBubbleRect(area, shape, size) {
  const { width, height } = bubbleSize(shape, size);
  return { x: area.x + INSET, y: area.y + area.height - INSET - height, width, height };
}

// Quality cap (§3.2): the crop keeps ≥ 540 px on its short side.
export function maxZoom(camW, camH) {
  const short = Math.min(camW, camH);
  if (!short) return ZOOM_MAX;
  return clamp(Math.floor((short / 540) * 10 + 1e-9) / 10, ZOOM_MIN, ZOOM_MAX);
}

// Zoom is kept to 0.05× steps so the tray's 1.25 / 1.75 detents are reachable.
export function clampZoom(z, camW, camH) {
  const max = camW && camH ? maxZoom(camW, camH) : ZOOM_MAX;
  return Math.round(clamp(z, ZOOM_MIN, max) * 20) / 20;
}

// Tray zoom slider (SETUP_V2 §3.2): detents at 1.0 / 1.25 / 1.5 / 1.75 / 2.0, the
// value snaps to a detent within 0.03, otherwise to 0.05; never above `max`.
export const ZOOM_DETENTS = [1, 1.25, 1.5, 1.75, 2];
export function snapZoom(z, max = ZOOM_MAX) {
  const d = ZOOM_DETENTS.find((v) => Math.abs(v - z) <= 0.03);
  const v = d ?? Math.round(z * 20) / 20;
  return Math.round(clamp(v, ZOOM_MIN, Math.min(max, ZOOM_MAX)) * 100) / 100;
}

// Source rect in camera pixels for a bubble of aspect `aspect` (w/h): the largest
// crop of that aspect, divided by zoom, centred on `centre` (0..1, camera space,
// unmirrored) and clamped so it never shows the frame's edges.
export function cropRect(camW, camH, aspect, zoom, centre = { x: 0.5, y: 0.5 }) {
  let sw = camW;
  let sh = camW / aspect;
  if (sh > camH) { sh = camH; sw = camH * aspect; }
  sw /= zoom;
  sh /= zoom;
  const sx = clamp(centre.x * camW - sw / 2, 0, camW - sw);
  const sy = clamp(centre.y * camH - sh / 2, 0, camH - sh);
  return { sx, sy, sw, sh };
}

// Superellipse |x|^n + |y|^n = 1, n = 5 (§3.2). Points in 0..1 box coordinates.
export function squirclePoints(n = 5, steps = 96) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push([0.5 + 0.5 * Math.sign(c) * Math.abs(c) ** (2 / n), 0.5 + 0.5 * Math.sign(s) * Math.abs(s) ** (2 / n)]);
  }
  return pts;
}

export function cssClipPath(shape) {
  if (shape === 'circle') return 'circle(50% at 50% 50%)';
  if (shape === 'squircle') return `polygon(${squirclePoints().map(([x, y]) => `${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`).join(',')})`;
  return `inset(0 round ${RECT_RADIUS}px)`;
}

// Canvas path for the same shape. `scale` maps pt → output pixels.
export function traceShape(ctx, shape, x, y, w, h, scale = 1) {
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  } else if (shape === 'squircle') {
    squirclePoints().forEach(([px, py], i) => (i ? ctx.lineTo(x + px * w, y + py * h) : ctx.moveTo(x + px * w, y + py * h)));
    ctx.closePath();
  } else {
    ctx.roundRect(x, y, w, h, RECT_RADIUS * scale);
  }
}

// ───────── setup v2: tray + anchored resize ─────────

export const TRAY_GAP = 8; // tray sits 8 pt under the bubble
export const TRAY_MIN_W = 332; // SETUP_V2 §11.1; the renderer reports more if row 2 needs it

// The corner a bubble is anchored to: the one nearest the screen edges it sits by
// (by edge distance, not centre, so a bubble grown to XL at the bottom stays
// bottom-anchored and shrinks back down). Resizing keeps that corner fixed.
export function anchorFor(area, rect) {
  const left = rect.x - area.x;
  const right = area.x + area.width - (rect.x + rect.width);
  const top = rect.y - area.y;
  const bottom = area.y + area.height - (rect.y + rect.height);
  return { h: left <= right ? 'left' : 'right', v: bottom <= top ? 'bottom' : 'top' };
}

// New size, same anchor corner, then kept fully inside `area`.
export function resizeAnchored(area, rect, dims, anchor = anchorFor(area, rect)) {
  const x = anchor.h === 'left' ? rect.x : rect.x + rect.width - dims.width;
  const y = anchor.v === 'top' ? rect.y : rect.y + rect.height - dims.height;
  return clampRect(area, { x, y, width: dims.width, height: dims.height });
}

// The bubble's clamp area minus room for the tray under it. No longer used for the
// bubble (it may sit on the bottom edge; the tray flips above it, trayRect).
export function setupArea(area, trayH) {
  return { ...area, height: Math.max(0, area.height - trayH - TRAY_GAP) };
}

// Tray box (SETUP_V2 §11.3): aligned to the bubble's outer edge (left edges flush in
// the left half of the screen, right edges flush in the right half), so bubble and
// tray share the edge inset; slid sideways only if it would still leave the inset.
// Under the bubble when it fits above the bottom of `area`, else above the bubble
// (a bubble dropped on the bottom edge keeps its tray on screen).
export function trayRect(area, bubble, trayW, trayH) {
  const w = Math.max(trayW, TRAY_MIN_W);
  const left = bubble.x + bubble.width / 2 <= area.x + area.width / 2;
  const x = clamp(left ? bubble.x : bubble.x + bubble.width - w, area.x + INSET, area.x + area.width - INSET - w);
  const below = bubble.y + bubble.height + TRAY_GAP;
  const above = below + trayH > area.y + area.height && bubble.y - TRAY_GAP - trayH >= area.y;
  return { x: Math.round(x), y: above ? bubble.y - TRAY_GAP - trayH : below, width: w, height: trayH, ...(above ? { above: true } : {}) };
}

// Which size presets fit `area` with the edge inset on both sides (SETUP_V2 §11.2:
// presets that can't fit are disabled, "Too big for this screen").
export function sizesThatFit(area, shape) {
  const out = {};
  for (const s of SIZES) {
    const { width, height } = bubbleSize(shape, s);
    out[s] = width <= area.width - 2 * INSET && height <= area.height - 2 * INSET;
  }
  return out;
}

// Corner resize handle: the size step whose box best matches the pointer's distance
// from the anchored corner (both axes, scaled to the shape's aspect).
export function sizeFromDrag(shape, anchorPt, pointer) {
  const dx = Math.abs(pointer.x - anchorPt.x);
  const dy = Math.abs(pointer.y - anchorPt.y);
  let best = SIZES[0];
  let bestErr = Infinity;
  for (const s of SIZES) {
    const { width, height } = bubbleSize(shape, s);
    const want = Math.max(dx / width, dy / height); // 1 = pointer exactly on the corner
    const err = Math.abs(want - 1) * width;
    if (err < bestErr) {
      bestErr = err;
      best = s;
    }
  }
  return best;
}

// Where the resize handle sits: the corner opposite the anchor (for a circle, on
// the rim at 45°). Returned relative to the bubble box, as the handle's centre.
export function handlePoint(shape, width, height, anchor) {
  const k = shape === 'circle' ? 0.146 : shape === 'squircle' ? 0.06 : 0;
  const x = anchor.h === 'left' ? width * (1 - k) : width * k;
  const y = anchor.v === 'bottom' ? height * k : height * (1 - k);
  return { x: Math.round(x), y: Math.round(y) };
}
