// Privacy levels for the clean-desktop cover (Full screen only). The real menu bar and
// Dock stay on screen and usable; the engine paints the cover (or the wallpaper) over
// their strips in each recorded frame. Pure: used by main and unit-tested.
//   standard: nothing hidden · semi: one of them hidden (keep = the one that stays) · very: both

export const PRIVACY = {
  standard: { label: 'Standard' },
  semi: { label: 'Semi-private' },
  very: { label: 'Very private' },
};

// When the menu bar autohides the work area has no top inset; cover this much anyway.
export const MENU_BAR_PT = 24;
// Dock thickness = icon size + padding (measured: tilesize 32 → 52 pt work-area inset).
export const DOCK_PAD = 20;
const DOCK_DEFAULTS = { orientation: 'bottom', autohide: false, tilesize: 48, magnification: false, largesize: 128 };

export function hiddenParts({ privacy = 'standard', keep = 'dock' } = {}) {
  if (privacy === 'very') return { menuBar: true, dock: true };
  if (privacy === 'semi') return { menuBar: keep !== 'menubar', dock: keep === 'menubar' };
  return { menuBar: false, dock: false };
}

// `defaults read com.apple.dock` (old-style plist text) → the keys that place the Dock.
export function parseDock(text = '') {
  const get = (k) => String(text).match(new RegExp(`^\\s*"?${k}"?\\s*=\\s*"?([^";\\n]+)"?;`, 'm'))?.[1]?.trim();
  const num = (k, d) => (Number.isFinite(+get(k)) && get(k) != null ? +get(k) : d);
  const o = get('orientation');
  return {
    orientation: ['left', 'right', 'bottom'].includes(o) ? o : DOCK_DEFAULTS.orientation,
    autohide: get('autohide') === '1',
    tilesize: num('tilesize', DOCK_DEFAULTS.tilesize),
    magnification: get('magnification') === '1',
    largesize: num('largesize', DOCK_DEFAULTS.largesize),
  };
}

// Strips to paint, in display-local pt ({ x, y, width, height, part }). `display` has
// Electron's bounds and workArea. The Dock strip spans its whole edge (its length
// changes with the apps in it). The Dock and an autohiding menu bar are covered even
// when the work area has no inset for them: they can slide in mid-recording.
export function maskRects(display, dock = DOCK_DEFAULTS, parts = hiddenParts(), { menuBarAutohide = false, safeTop = 0 } = {}) {
  const b = display.bounds;
  const wa = display.workArea || b;
  const out = [];
  if (parts.menuBar) {
    const inset = wa.y - b.y;
    // A notched display's menu bar is as tall as the notch (safe-area top, e.g. 38 pt).
    const h = inset > 0 ? inset : menuBarAutohide ? Math.max(MENU_BAR_PT, safeTop) : 0;
    if (h > 0) out.push({ x: 0, y: 0, width: b.width, height: Math.ceil(h), part: 'menuBar' });
  }
  if (parts.dock) {
    const d = { ...DOCK_DEFAULTS, ...dock };
    const inset = {
      bottom: b.y + b.height - (wa.y + wa.height),
      left: wa.x - b.x,
      right: b.x + b.width - (wa.x + wa.width),
    }[d.orientation];
    // Magnified icons rise past the Dock's resting edge while the pointer is over it.
    const size = Math.ceil(Math.max(inset, (d.magnification ? Math.max(d.largesize, d.tilesize) : d.tilesize) + DOCK_PAD));
    if (d.orientation === 'bottom') out.push({ x: 0, y: b.height - size, width: b.width, height: size, part: 'dock' });
    else if (d.orientation === 'left') out.push({ x: 0, y: 0, width: size, height: b.height, part: 'dock' });
    else out.push({ x: b.width - size, y: 0, width: size, height: b.height, part: 'dock' });
  }
  return out;
}

// Where the toolbar offers the privacy level (it must never be hard to find).
// `fullScreen`: the source is a display (setup) or the recording's target is one.
//   folded: always an icon in Full screen, eye-off above Standard, a plain eye at Standard
//   more:   a row in the ⋯ menu; greyed out (with the reason) in Window mode
//   collapsedDot: only a tiny eye-off hint, and only above Standard
export function privacyEntries({ fullScreen, coverAvailable, privacy = 'standard' }) {
  const level = PRIVACY[privacy] ? privacy : 'standard';
  const above = level !== 'standard';
  if (!coverAvailable) return { folded: null, more: null, collapsedDot: false };
  return {
    folded: fullScreen ? { icon: above ? 'eye-off' : 'eye', on: above } : null,
    more: { icon: above ? 'eye-off' : 'eye', disabled: fullScreen ? null : 'No cover in Window mode' },
    collapsedDot: fullScreen && above,
  };
}
