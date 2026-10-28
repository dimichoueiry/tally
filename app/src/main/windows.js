// Window factories. Every overlay is created once at launch, hidden, and with
// content protection on from creation, so it is excluded from every capture
// stream started later (ARCHITECTURE §6.3: protect before getDisplayMedia).
import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { ROOT, pageUrl } from './protocol.js';
import { noteCspBlock } from './netguard.js';
import { sandboxWindow } from './sandbox.js';

const PRELOAD = path.join(ROOT, 'src', 'preload', 'index.cjs');
const isMac = process.platform === 'darwin';
// Dev aid for desktop screenshots of overlays: TALLY_NO_PROTECT=1 leaves them capturable.
const PROTECT = process.env.TALLY_NO_PROTECT !== '1';

export const BUBBLE_PAD = 20; // transparent margin around the bubble for the HUD, ring and shadow
export const POP_MARGIN = 16; // transparent margin around the popover for its shadow and arrow

function make(role, opts, { overlay = true } = {}) {
  const win = new BrowserWindow({
    show: false,
    frame: !overlay,
    transparent: overlay,
    hasShadow: !overlay,
    resizable: !overlay,
    fullscreenable: false,
    minimizable: !overlay,
    maximizable: !overlay,
    skipTaskbar: overlay,
    backgroundColor: overlay ? '#00000000' : '#131716',
    ...opts,
    webPreferences: {
      preload: PRELOAD,
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
      additionalArguments: [`--tally-role=${role}`],
      ...(opts.webPreferences || {}),
    },
  });
  if (overlay && PROTECT) win.setContentProtection(true);
  // Renderer warnings and errors land in the terminal log.
  // Event-object form only: the old (e, level, message, line, source) signature made
  // Electron emit a deprecation warning through Node's warning printer (LC-10).
  win.webContents.on('console-message', (e) => {
    const lvl = e.level;
    const msg = e.message;
    // One line per refused fetch (Chromium also logs a "Connecting to … violates" line for it).
    const csp = /Fetch API cannot load (\S+)\. Refused to connect/.exec(msg);
    if (csp) noteCspBlock(csp[1], role);
    if (lvl === 'warning' || lvl === 'error') console.log(`[tally] ${role} ${lvl}: ${msg} (${e.sourceId}:${e.lineNumber})`);
  });
  win.webContents.on('render-process-gone', (_e, d) => console.log(`[tally] ${role} renderer gone: ${d.reason}`));
  // Messages sent before the page has run its scripts would be dropped: queue them.
  const send = win.webContents.send.bind(win.webContents);
  let queue = [];
  win.webContents.send = (...args) => (queue ? queue.push(args) : send(...args));
  win.webContents.once('did-finish-load', () => {
    const q = queue;
    queue = null;
    q.forEach((a) => send(...a));
  });
  win.loadURL(pageUrl(role));
  return sandboxWindow(win);
}

function overlayTop(win, level, relative = 0) {
  win.setAlwaysOnTop(true, level, relative);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
}

// Window picker (SETUP_V2 §3.5): covers the setup display. While picking it dims
// everything but the window under the pointer and takes the click; once a window is
// picked it only draws the ring and chip, click-through. Above app windows, below the
// toolbar and bubble.
export function createPicker() {
  const win = make('picker', { width: 800, height: 600, focusable: true, enableLargerThanScreen: true, ...(isMac ? { type: 'panel' } : {}) });
  overlayTop(win, 'floating');
  win.setIgnoreMouseEvents(true);
  return win;
}

export function createBubble() {
  const win = make('bubble', { width: 260, height: 260, focusable: true, ...(isMac ? { type: 'panel' } : {}) });
  overlayTop(win, 'screen-saver');
  return win;
}

// Setup v2 bubble tray (SETUP_V2 §3.2). Its own window, so hiding it at Record never
// touches the bubble's window (the bubble cannot jump). It covers the bubble's whole
// display and draws the tray (and its side popovers) at CSS positions: macOS clamps
// windows back on screen, so a tray-sized window would drift at the screen edges,
// and moving with the bubble is a style change, never a window move. Transparent
// parts are click-through.
export function createCamTray() {
  const win = make('camtray', { width: 800, height: 600, focusable: true, enableLargerThanScreen: true, ...(isMac ? { type: 'panel' } : {}) });
  overlayTop(win, 'screen-saver', 1);
  win.setIgnoreMouseEvents(true, { forward: true });
  return win;
}

// Setup toolbar → countdown → recording bar: one window (SETUP_V2 §3.8, §15.6). It holds
// the pill plus transparent, click-through room for its popovers and tooltips.
export function createBar() {
  // The mic level meter's AudioContext must run without a user gesture (it plays nothing).
  const win = make('bar', { width: 760, height: 560, focusable: true, enableLargerThanScreen: true, ...(isMac ? { type: 'panel' } : {}), webPreferences: { autoplayPolicy: 'no-user-gesture-required' } });
  overlayTop(win, 'screen-saver', 1);
  win.setIgnoreMouseEvents(true, { forward: true }); // only the pill, popovers and notice take clicks
  return win;
}

// Speaker notes (SETUP_V2 §12): content-protected from creation, so before its first show
// (§12.6). The window is the 560 pt panel plus transparent, click-through room for its
// shadow and tooltips. Not focusable while recording (S18, set by the controller).
export const NOTES_PAD = { x: 48, top: 48, bottom: 72 };
export function createNotes() {
  const win = make('notes', { width: 560 + 2 * NOTES_PAD.x, height: 264 + NOTES_PAD.top + NOTES_PAD.bottom, focusable: true, enableLargerThanScreen: true, ...(isMac ? { type: 'panel' } : {}) });
  // Above the bubble (0) and its tray (1), so the panel can be read on top of the camera;
  // its transparent margin stays click-through, so the bubble under it still works.
  overlayTop(win, 'screen-saver', 2);
  win.setIgnoreMouseEvents(true, { forward: true });
  return win;
}

export function createCountdown() {
  const win = make('countdown', { width: 800, height: 600, focusable: true, enableLargerThanScreen: true, ...(isMac ? { type: 'panel' } : {}) });
  overlayTop(win, 'screen-saver', 3);
  win.setIgnoreMouseEvents(true);
  return win;
}

export function createPopup() {
  const win = make('popup', { width: 372 + POP_MARGIN * 2, height: 220, focusable: true, ...(isMac ? { type: 'panel' } : {}) });
  overlayTop(win, 'floating');
  return win;
}

export function createEngine() {
  // The system-audio mixer's AudioContext must run without a user gesture.
  return make('engine', { width: 320, height: 200, show: false, webPreferences: { autoplayPolicy: 'no-user-gesture-required' } }, { overlay: false });
}

export function createSettings() {
  return make('settings', {
    width: 520, height: 460, resizable: false, title: 'Tally Settings',
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } } : {}),
  }, { overlay: false });
}

export function createLibrary() {
  return make('library', {
    width: 820, height: 600, minWidth: 640, minHeight: 420, title: 'Recordings',
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } } : {}),
  }, { overlay: false });
}

export function createPermission() {
  return make('permission', {
    width: 600, height: 460, resizable: false, title: 'Allow screen recording',
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } } : {}),
  }, { overlay: false });
}

export function displayFor(rect) {
  return screen.getDisplayMatching(rect);
}
