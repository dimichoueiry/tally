// Tally main process: lifecycle, IPC, wiring.
import { installProcessGuards, initLogFile, logFile } from './logger.js';
import { app, BrowserWindow, ipcMain, globalShortcut, session, shell, dialog, screen, clipboard } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { registerScheme, handleProtocol } from './protocol.js';
import { Settings, DEFAULTS } from './settings.js';
import { bootLibraryDir } from './libraryDir.js';
import { Library } from './library/store.js';
import { PendingDeletes } from './library/pendingDelete.js';
import { recoverSessions } from './session/segments.js';
import { Shortcuts } from './shortcuts.js';
import { TallyTray } from './tray.js';
import { Controller } from './controller.js';
import * as W from './windows.js';
import * as perms from './permissions.js';
import { listSources } from './sources.js';
import { installNetGuard } from './netguard.js';
import { allowPermissionRequest, allowPermissionCheck, displayMediaStreams } from './mediaPolicy.js';
import { CleanDesktop } from './cleanDesktop.js';
import { preflight } from './disk.js';
import { importImage } from './images.js';
import { SANDBOX, initSandbox, noGlobalShortcuts, NoTray } from './sandbox.js';
import { NotesManager } from './notesManager.js';

const log = (...a) => console.log('[tally]', ...a);

// Dev aid: TALLY_USER_DATA=<dir> runs an isolated instance (own settings, logs and
// single-instance lock), so a test build can run next to the user's own Tally.
if (process.env.TALLY_USER_DATA) app.setPath('userData', process.env.TALLY_USER_DATA);
initSandbox(app); // TALLY_DEV_SANDBOX=1: own app name / lock, invisible, never takes focus

// First: no write to a closed terminal and no uncaught error may ever show a dialog (LC-10).
installProcessGuards({ onFatal: (e) => ctl?.noteFatal?.(e) });
initLogFile(path.join(app.getPath('userData'), 'logs'));

// Chromium's MP4 muxer for MediaRecorder (H.264 in MP4, no ffmpeg to record).
app.commandLine.appendSwitch('enable-features', 'MediaRecorderEnableMp4Muxer');
registerScheme();

if (!app.requestSingleInstanceLock()) app.exit(0);

let settings, library, pending, ctl, tray, shortcuts, net, cover, notes;
const wins = {};
const shortcutFailures = new Set();

async function boot() {
  handleProtocol();
  if (process.platform === 'darwin') app.dock?.hide();

  settings = new Settings(path.join(app.getPath('userData'), 'settings.json'));
  // Decided before recovery scans it: a test instance never opens the real folder.
  const boot = bootLibraryDir({ env: process.env, userData: app.getPath('userData'), saved: settings.get().libraryDir, defaultDir: DEFAULTS.libraryDir });
  if (boot.override) settings.patch({ libraryDir: boot.dir });
  const libDir = boot.dir;
  fs.mkdirSync(libDir, { recursive: true });
  library = new Library(libDir);
  pending = new PendingDeletes(libDir, (p) => shell.trashItem(p));

  // Local-only: the renderers may load app:// and nothing else (MediaPipe's telemetry included).
  net = installNetGuard(session.defaultSession, log);
  // Media: camera video. The microphone only while its switch is on, and only for the
  // engine (records it) and the toolbar (its level meter); any other audio request is
  // refused (mediaPolicy.js, test/mic.test.js). System audio is the display-capture
  // loopback, granted only while the System audio switch is on.
  const micAllowed = (wc) => !!settings.get().mic?.on && !!wc && [wins.engine, wins.bar].some((w) => w && !w.isDestroyed() && w.webContents === wc);
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => cb(allowPermissionRequest(permission, details, { micAllowed: micAllowed(wc) })));
  session.defaultSession.setPermissionCheckHandler((wc, permission, _o, details) => allowPermissionCheck(permission, details, { micAllowed: micAllowed(wc) }));
  let capture = { source: null, systemAudio: false };
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
    const streams = displayMediaStreams(capture.source, { audioRequested: req.audioRequested, systemAudio: capture.systemAudio });
    log(`display media: video=${streams.video?.id || 'none'} audio=${streams.audio || 'none'}`);
    cb(streams);
  });
  cover = new CleanDesktop(log);

  // Overlays first, all protected from creation (before any getDisplayMedia).
  wins.bubble = W.createBubble();
  wins.camtray = W.createCamTray();
  wins.bar = W.createBar();
  wins.countdown = W.createCountdown();
  wins.popup = W.createPopup();
  wins.picker = W.createPicker();
  wins.notes = W.createNotes();
  notes = new NotesManager(path.join(app.getPath('userData'), 'notes.txt'), { onSaved: () => wins.notes?.webContents.send('notes:saved') });
  wins.engine = W.createEngine();

  // Menu-bar icon (SETUP_V2 §2). Left-click: toggle setup on the display that owns this
  // menu bar; while recording, stop. Right-click: the small native menu.
  tray = SANDBOX
    ? new NoTray()
    : new TallyTray(
        () => {
          if (['recording', 'paused', 'confirm'].includes(ctl.state)) return ctl.stop();
          if (ctl.state === 'idle') ctl.toggleSetup(trayDisplayId());
        },
        [
          { label: 'New recording', accelerator: 'Alt+Shift+R', registerAccelerator: false, click: () => ctl.primary() },
          { label: 'Recordings…', click: () => showLibrary() },
          { label: 'Settings…', click: () => showSettings() },
          { type: 'separator' },
          { label: 'Quit Tally', click: () => app.quit() },
        ],
      );

  shortcuts = new Shortcuts(
    SANDBOX ? noGlobalShortcuts : globalShortcut,
    {
      primary: () => ctl.primary(),
      pause: () => ctl.togglePause(),
      restart: () => ctl.askRestart(),
      cancel: () => ctl.askCancel(),
      camera: () => ctl.toggleCamera(),
      notes: () => ctl.toggleNotesScroll(),
    },
    (accel) => {
      shortcutFailures.add(accel);
      log(`shortcut registration failed: ${accel}`);
    },
  );
  shortcuts.registerPrimary();

  ctl = new Controller({
    settings,
    library,
    pending,
    wins,
    shortcuts,
    tray,
    log,
    net,
    cover,
    onPermissionNeeded: () => showPermission(),
    onBlocked: () => ctl.openSetup(), // the notice above the toolbar says why
    onCaptureSource: (src, systemAudio = false) => (capture = { source: src, systemAudio }),
    cameraStatus: () => perms.cameraStatus(),
    micStatus: () => perms.micStatus(),
    shortcutFailures: () => [...shortcutFailures],
    onSettings: () => broadcastSettings(),
  });

  registerIpc();

  // Crash recovery: finish interrupted sessions and trash deletes left staged.
  const swept = boot.recover ? await pending.sweep().catch(() => 0) : 0;
  const recovered = boot.recover ? await recoverSessions(libDir, { log }).catch((e) => (log(`recovery failed: ${e.message}`), [])) : [];
  for (const r of recovered) log(r.live ? `session ${r.id} left alone: pid ${r.manifest.owner?.pid} is still recording` : `recovered session ${r.id}: ${r.file || `discarded (${r.reason})`}`);
  if (swept) log(`trashed ${swept} pending delete(s)`);
  const last = recovered.filter((r) => r.file).at(-1);
  if (last) {
    await library.setMeta(last.file, { tally: true, duration: last.duration, quality: null, fps: 30, recovered: true });
    wins.popup.webContents.once('did-finish-load', () => {});
    setTimeout(async () => ctl._showPopup({ finalizing: false, recovered: true, entry: await library.entry(last.file) }), 800);
  }

  if (perms.screenStatus() !== 'granted') showPermission();
  if (process.env.TALLY_DEV_CONTROL === '1') devControl();
  log('ready', JSON.stringify({ screen: perms.screenStatus(), camera: perms.cameraStatus(), mic: perms.micStatus(), library: libDir, recover: boot.recover, shortcuts: [...shortcutFailures], log: logFile() }));
}

// ───────── setup ─────────

// The display whose menu bar holds the icon (setup opens there, SETUP_V2 §2).
function trayDisplayId() {
  const tb = tray.bounds();
  return tb.width ? screen.getDisplayMatching(tb).id : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
}

// Keyboard: Tab off the bubble goes to the tray (first control), ⇧Tab to its last.
function focusTray(where) {
  if (!wins.camtray.isVisible()) return;
  wins.camtray.focus();
  wins.camtray.webContents.send('camtray:focus', where);
}

function showPermission() {
  if (!wins.permission || wins.permission.isDestroyed()) {
    wins.permission = W.createPermission();
    wins.permission.once('ready-to-show', () => wins.permission.show());
  } else wins.permission.show();
  wins.permission.focus();
}

function showLibrary() {
  if (!wins.library || wins.library.isDestroyed()) {
    wins.library = W.createLibrary();
    wins.library.once('ready-to-show', () => wins.library.show());
    const unwatch = library.watch(() => wins.library && !wins.library.isDestroyed() && wins.library.webContents.send('library:changed'));
    wins.library.on('closed', () => {
      unwatch();
      pending.commitAll();
    });
  } else wins.library.show();
  app.focus({ steal: true });
  wins.library.focus();
}

function freeSpace(dir) {
  try {
    const s = fs.statfsSync(dir);
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

// ───────── IPC ─────────

function registerIpc() {
  const h = (ch, fn) => ipcMain.handle(ch, (_e, ...a) => fn(...a));

  h('app:session', () => ctl.snapshot());
  h('app:settings', () => settings.get());
  h('app:setSettings', (partial) => {
    const prevLib = settings.get().libraryDir;
    const next = settings.patch(partial);
    if (next.libraryDir !== prevLib) relocateLibrary(next.libraryDir);
    ctl._syncBubble();
    ctl.settingsChanged();
    broadcastSettings();
    return next;
  });

  // "Current wallpaper" swatch: drawn by the cover helper, kept in memory only.
  // (A sandboxed test instance never reads the real wallpaper.)
  h('app:wallpaperThumb', () => (SANDBOX ? null : cover.wallpaperThumb(ctl.setupDisplayId ?? screen.getPrimaryDisplay().id)));
  // Choose image… for a camera background or the clean-desktop cover.
  h('app:chooseImage', (kind) => chooseImage(kind));
  h('app:removeImage', (name) => {
    const list = settings.get().backgrounds.filter((n) => n !== name);
    const cam = settings.get().camera;
    settings.patch({ backgrounds: list, ...(cam.bgImage === `user:${name}` ? { camera: { bgImage: 'builtin:studio' } } : {}) });
    broadcastSettings();
    return settings.get();
  });
  h('app:cameraAccess', async () => ({ granted: await perms.requestCamera(), status: perms.cameraStatus() }));
  h('app:openCameraSettings', () => perms.openCameraSettings());
  // Microphone: asked only when the user turns it on (not-determined → the system prompt).
  h('app:micStatus', () => perms.micStatus());
  h('app:micAccess', async () => {
    const before = perms.micStatus();
    const granted = before === 'granted' || (before === 'not-determined' && (await perms.requestMic()));
    return { granted, status: perms.micStatus() };
  });
  h('app:openMicSettings', () => perms.openMicSettings());
  h('app:openScreenSettings', () => perms.openScreenSettings());
  h('app:library', () => showLibrary());
  h('app:settingsWindow', () => showSettings());
  h('app:quit', () => app.quit());

  h('perm:status', () => perms.screenStatus());
  h('perm:open', () => perms.openScreenSettings());
  h('perm:reset', () => perms.resetScreenPermission(process.env.TALLY_BUNDLE_ID || 'com.github.Electron'));
  h('perm:relaunch', () => {
    app.relaunch();
    app.exit(0);
  });

  h('bubble:drag', (d) => ctl.bubbleDrag(d));
  h('bubble:nudge', (d) => ctl.bubbleNudge(d));
  h('bubble:mouse', (inside) => wins.bubble.setIgnoreMouseEvents(!inside, { forward: true }));
  h('bubble:hide', () => (ctl.state === 'idle' ? settingsCamera({ on: false }) : ctl.toggleCamera()));
  h('bubble:zoom', (zoom) => settingsCamera({ zoom }));
  h('bubble:background', (background) => settingsCamera({ background }));
  h('bubble:camera', (dims) => {
    ctl.camDims = dims;
    wins.camtray.webContents.send('app:camera', dims);
  });
  h('bubble:resize', (d) => ctl.bubbleResize(d) && broadcastSettings());
  h('bubble:focusTray', (where) => focusTray(where));
  // ⌘+ / ⌘− on the focused bubble step the size in setup (SETUP_V2 §11.2). Taken
  // here, before the default View menu would turn them into page zoom.
  wins.bubble.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || input.alt || !(process.platform === 'darwin' ? input.meta : input.control)) return;
    const dir = { '=': 1, '+': 1, '-': -1, _: -1 }[input.key];
    if (!dir) return;
    e.preventDefault();
    if (ctl.stepSize(dir)) broadcastSettings();
  });

  // Bubble tray (setup v2)
  h('camtray:mouse', (inside) => wins.camtray.setIgnoreMouseEvents(!inside, { forward: true }));
  h('camtray:size', (box) => ctl.traySize(box));
  h('camtray:focusBubble', () => {
    wins.bubble.focus();
    wins.bubble.webContents.send('bubble:focus');
  });
  h('camtray:close', () => ctl.closeSetup());
  h('camtray:init', () => ({ settings: settings.get(), camera: perms.cameraStatus(), camDims: ctl.camDims }));

  // Setup toolbar / countdown / recording bar: one window, one renderer (SETUP_V2 §15).
  h('bar:init', () => ({ session: ctl.snapshot(), settings: settings.get(), setup: ctl.setupInfo() }));
  h('bar:action', (a, arg) => {
    const map = {
      stop: () => ctl.stop(), pause: () => ctl.togglePause(), restart: () => ctl.askRestart(), cancel: () => ctl.askCancel(), camera: () => ctl.toggleCamera(),
      keep: () => ctl.keepGoing(), confirm: () => ctl.confirm(), switch: () => ctl.switchToDisplay(), dismiss: () => ctl.dismissToast(),
      record: () => ctl.recordFromSetup(), close: () => ctl.closeSetup(), now: () => ctl._countdownNow(), 'cancel-countdown': () => ctl.cancelCountdown(),
      'source-display': () => ctl.chooseFullScreen(), 'source-window': () => ctl.startPicker(), 'screen-settings': () => perms.openScreenSettings(),
      'dismiss-notice': () => ctl.dismissNotice(arg), home: () => ctl.barHome(), notes: () => ctl.toggleNotes(),
      'mic-settings': () => perms.openMicSettings(),
    };
    return map[a]?.();
  });
  h('bar:mouse', (inside) => wins.bar.setIgnoreMouseEvents(!inside, { forward: true }));
  h('bar:width', (w) => ctl.barWidth(w));
  h('bar:drag', (d) => ctl.barDrag(d));
  h('bar:nudge', (d) => ctl.barNudge(d));
  h('bar:collapse', (on) => {
    settings.patch({ toolbar: { collapsed: !!on } });
    broadcastSettings();
  });
  h('bar:fold', () => {
    ctl.toggleFold();
    broadcastSettings();
  });

  // Speaker notes (SETUP_V2 §12)
  h('notes:init', () => ({ text: notes.text, settings: settings.get(), session: ctl.snapshot() }));
  ipcMain.on('notes:text', (_e, text) => notes.set(text)); // every edit; written 0.5 s after typing stops
  h('notes:flush', () => notes.flush());
  h('notes:prefs', (partial) => {
    settings.patch({ notes: partial });
    // The scroll position is bookkeeping: no broadcast (every window would re-render).
    if (Object.keys(partial).some((k) => k !== 'scroll')) broadcastSettings();
    return settings.get();
  });
  h('notes:hide', () => {
    notes.flush();
    ctl.toggleNotes(false);
  });
  // Esc in the panel: back to the toolbar's Notes button (§12.4); the panel stays open.
  h('notes:toBar', () => {
    wins.bar.focus();
    wins.bar.webContents.send('bar:focus', 'notes');
  });
  h('notes:paste', () => clipboard.readText()); // plain text only
  h('notes:mouse', (inside) => wins.notes.setIgnoreMouseEvents(!inside, { forward: true }));
  h('notes:drag', (d) => ctl.notesDragTo(d));
  // The panel is a non-activating panel, so the app menu's key equivalents may not reach it:
  // editing keys and ⌘+ / ⌘− (text size) are handled here, before any menu.
  wins.notes.webContents.on('before-input-event', (e, input) => {
    const mod = process.platform === 'darwin' ? input.meta : input.control;
    if (input.type !== 'keyDown' || !mod || input.alt) return;
    const wc = wins.notes.webContents;
    const k = input.key.toLowerCase();
    const edit = { v: () => wc.paste(), c: () => wc.copy(), x: () => wc.cut(), a: () => wc.selectAll(), z: () => (input.shift ? wc.redo() : wc.undo()) }[k];
    const font = { '=': 1, '+': 1, '-': -1, _: -1 }[input.key];
    if (edit) {
      e.preventDefault();
      edit();
    } else if (font) {
      e.preventDefault();
      wc.send('notes:font', font);
    }
  });

  h('picker:pick', (w) => ctl.pickWindow(w));
  h('picker:cancel', () => ctl.cancelPicker());

  h('countdown:now', () => ctl._countdownNow());
  h('countdown:cancel', () => ctl.cancelCountdown());

  h('popup:check', (file, typed) => library.checkRename(file, typed));
  h('popup:rename', async (file, typed) => {
    const r = await library.rename(file, typed);
    return { ...r, entry: await library.entry(r.file) };
  });
  h('popup:delete', (file) => ctl.popupDeleteFile(file));
  h('popup:undo', () => ctl.popupUndo());
  h('popup:dismiss', () => ctl.dismissPopup({ commit: true }));
  h('popup:open', (file) => ctl.open(file));
  h('popup:reveal', (file) => ctl.reveal(file));
  h('popup:resize', (height) => ctl.placePopup(Math.ceil(height)));
  h('popup:freeSpace', () => perms.openStorageSettings());
  // Couldn't finish the file: salvage the parts on disk, or show where they are.
  h('popup:salvage', () => ctl.salvageFailed());
  h('popup:revealFailed', () => ctl.revealFailed());

  h('library:list', async () => {
    const items = await library.list();
    return { items, dir: settings.get().libraryDir.replace(app.getPath('home'), '~') };
  });
  h('library:check', (file, typed) => library.checkRename(file, typed));
  h('library:rename', (file, typed) => library.rename(file, typed));
  h('library:delete', (file) => pending.remove(file));
  h('library:undo', (token) => pending.undo(token));
  h('library:commit', (token) => pending.commit(token));
  h('library:open', (file) => shell.openPath(file));
  h('library:reveal', (file) => shell.showItemInFolder(file));
  h('library:quicklook', (file) => (wins.library.previewFile ? wins.library.previewFile(file) : shell.openPath(file)));
  h('library:record', () => {
    wins.library.blur();
    ctl.start(null);
  });
  h('library:changeDir', async () => {
    const r = await dialog.showOpenDialog(wins.library, { properties: ['openDirectory', 'createDirectory'], defaultPath: settings.get().libraryDir });
    if (r.canceled || !r.filePaths[0]) return null;
    settings.patch({ libraryDir: r.filePaths[0] });
    relocateLibrary(r.filePaths[0]);
    return r.filePaths[0];
  });
}

function settingsCamera(partial) {
  settings.patch({ camera: partial });
  ctl._syncBubble();
  broadcastSettings();
}

function broadcastSettings() {
  const st = settings.get();
  for (const w of [wins.bubble, wins.camtray, wins.bar, wins.notes, wins.settings]) if (w && !w.isDestroyed()) w.webContents.send('app:settings', st);
}

function showSettings() {
  if (!wins.settings || wins.settings.isDestroyed()) {
    wins.settings = W.createSettings();
    wins.settings.once('ready-to-show', () => wins.settings.show());
  } else wins.settings.show();
  app.focus({ steal: true });
  wins.settings.focus();
}

// Copies a picked image into the app's own data (never elsewhere) and selects it.
async function chooseImage(kind) {
  const parent = kind === 'settings' ? BrowserWindow.getFocusedWindow() || undefined : undefined;
  // Setup stays open around the dialog (it no longer closes on blur); the image shows live.
  const r = await dialog.showOpenDialog(parent, { title: kind === 'cover' ? 'Choose a cover image' : 'Choose a background image', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'heic', 'webp'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const which = kind === 'cover' ? 'cover' : 'background';
  const name = await importImage(r.filePaths[0], which);
  if (which === 'cover') settings.patch({ cleanDesktop: { on: true, cover: 'image', image: name } });
  else settings.patch({ backgrounds: [...new Set([...settings.get().backgrounds, name])], camera: { background: 'image', bgImage: `user:${name}` } });
  ctl._syncBubble();
  ctl.settingsChanged();
  broadcastSettings();
  return settings.get();
}

function relocateLibrary(dir) {
  fs.mkdirSync(dir, { recursive: true });
  library = new Library(dir);
  pending = new PendingDeletes(dir, (p) => shell.trashItem(p));
  Object.assign(ctl, { library, pending });
}

// ───────── dev control (TALLY_DEV_CONTROL=1) ─────────
// Lines on stdin drive the app for scripted verification; replies are "DEV {json}".
function devControl() {
  const out = (o) => console.log('DEV ' + JSON.stringify(o));
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    const [cmd, ...rest] = line.trim().split(' ');
    const arg = rest.join(' ');
    try {
      switch (cmd) {
        case 'state':
          return out({ cmd, ...ctl.snapshot(), registered: ['Alt+Shift+R', 'Alt+Shift+P', 'Alt+Shift+Z', 'Alt+Shift+X', 'Alt+Shift+C'].filter((a) => globalShortcut.isRegistered(a)) });
        case 'popover': // v1 name kept for old scripts
        case 'setup':
          ctl.openSetup(rest[0] || screen.getPrimaryDisplay().id);
          return out({ cmd, setup: ctl.setupInfo() });
        case 'hidepopover':
        case 'closesetup':
          ctl.closeSetup();
          return out({ cmd });
        case 'trayclick': // what a left-click on the menu-bar icon does
          if (['recording', 'paused', 'confirm'].includes(ctl.state)) ctl.stop();
          else if (ctl.state === 'idle') ctl.toggleSetup(screen.getPrimaryDisplay().id);
          return out({ cmd, setupOpen: ctl.setupOpen, state: ctl.state });
        case 'fakewindows': // fakewindows <json array> | off: stand-in list for the window picker
          ctl.fakeWindows = arg === 'off' ? null : JSON.parse(arg);
          return out({ cmd, n: ctl.fakeWindows?.length ?? 0 });
        case 'notesblocked': // screenshot aid: what a Windows PC that fails the S19 check shows
          ctl.notesAllowed = false;
          ctl._toast({ kind: 'notes', icon: 'warn', title: 'Notes hidden while recording', text: 'this PC can\'t keep them out of the video', sticky: true });
          ctl._syncNotes();
          return out({ cmd });
        case 'notesscroll': // what ⌥⇧N does (the global shortcut is off in the sandbox)
          ctl.toggleNotesScroll();
          return out({ cmd });
        case 'notes': // notes window state: visible, focusable, bounds, script length, shortcut
          return out({ cmd, visible: wins.notes.isVisible(), focusable: wins.notes.isFocusable(), bounds: wins.notes.getBounds(), pos: ctl.notesPos, chars: notes.text.length, dirty: notes.dirty, nShortcut: shortcuts.notesOn, prefs: settings.get().notes });
        case 'protected': // content protection per window (SETUP_V2 §4: all our UI excluded)
          return out({ cmd, ...Object.fromEntries(Object.entries(wins).filter(([, w]) => w && !w.isDestroyed()).map(([k, w]) => [k, w.isContentProtected()])) });
        case 'cover': // what the cover helper shows (or, sandboxed, would show)
          return out({ cmd, up: cover.isUp(), key: cover.key });
        case 'bar':
          return out({ cmd, bar: ctl.bar, setup: ctl.setupInfo(), bounds: wins.bar.getBounds(), visible: wins.bar.isVisible() });
        case 'library':
          showLibrary();
          return out({ cmd });
        case 'permission':
          showPermission();
          return out({ cmd });
        case 'record': {
          // record display | record window <title substring>
          let sel = { kind: 'display', displayId: screen.getPrimaryDisplay().id };
          if (rest[0] === 'window') {
            const { windows } = await listSources();
            const w = windows.find((x) => x.title.includes(rest.slice(1).join(' ')) || x.app.includes(rest.slice(1).join(' ')));
            if (!w) return out({ cmd, error: 'window not found', windows: windows.map((x) => `${x.app} | ${x.title}`) });
            sel = { kind: 'window', sourceId: w.sourceId, title: w.title };
          }
          if (rest[0] === 'quick') sel = null;
          await ctl.start(sel);
          return out({ cmd, target: ctl.target && { kind: ctl.target.kind, label: ctl.target.label, bounds: ctl.target.bounds } });
        }
        case 'act': {
          // act stop | pause | restart | cancel | camera | keep | confirm | primary | now | esc
          const map = { stop: () => ctl.stop(), pause: () => ctl.togglePause(), restart: () => ctl.askRestart(), cancel: () => ctl.askCancel(), camera: () => ctl.toggleCamera(), keep: () => ctl.keepGoing(), confirm: () => ctl.confirm(), primary: () => ctl.primary(), now: () => ctl._countdownNow(), esc: () => ctl.cancelCountdown() };
          await map[rest[0]]();
          return out({ cmd, act: rest[0], state: ctl.state });
        }
        case 'settings': {
          const prevLib = settings.get().libraryDir;
          settings.patch(JSON.parse(arg));
          if (settings.get().libraryDir !== prevLib) relocateLibrary(settings.get().libraryDir);
          ctl._syncBubble();
          ctl.settingsChanged();
          broadcastSettings();
          return out({ cmd, settings: settings.get() });
        }
        case 'shot': {
          // shot <window> <file>
          const w = wins[rest[0]];
          const img = await w.webContents.capturePage(rest[2] ? JSON.parse(rest[2]) : undefined);
          fs.writeFileSync(rest[1], img.toPNG());
          return out({ cmd, file: rest[1], size: img.getSize(), bounds: w.getBounds() });
        }
        case 'eval': {
          const [name, ...js] = rest;
          const r = await wins[name].webContents.executeJavaScript(js.join(' '));
          return out({ cmd, result: r });
        }
        case 'key': {
          // key <window> <keyCode> [modifiers,comma]
          const [name, keyCode, mods] = rest;
          const modifiers = mods ? mods.split(',') : [];
          wins[name].webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
          wins[name].webContents.sendInputEvent({ type: 'char', keyCode, modifiers });
          wins[name].webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
          return out({ cmd, name, keyCode });
        }
        case 'mouse': {
          // mouse <window> <move|drag|down|up|wheel|dbl> <x> <y> [deltaY] [g]: delivered into
          // the window's page (sendInputEvent), never as an OS event. 'g': x, y are screen
          // coordinates (for drags that move the window itself).
          const [name, kind, x0, y0, dy, g] = rest;
          const wb = wins[name].getBounds();
          const glob = g === 'g' || dy === 'g';
          const x = glob ? Number(x0) - wb.x : Number(x0);
          const y = glob ? Number(y0) - wb.y : Number(y0);
          if (kind === 'dbl') {
            for (const clickCount of [1, 2]) for (const type of ['mouseDown', 'mouseUp']) wins[name].webContents.sendInputEvent({ type, x, y, globalX: wb.x + x, globalY: wb.y + y, button: 'left', clickCount });
            return out({ cmd, name, kind, x, y });
          }
          const type = { move: 'mouseMove', drag: 'mouseMove', down: 'mouseDown', up: 'mouseUp', wheel: 'mouseWheel' }[kind];
          const ev = { type, x, y, globalX: wb.x + x, globalY: wb.y + y, button: 'left', clickCount: 1 };
          if (kind === 'drag') ev.modifiers = ['leftButtonDown']; // a move with the button held
          if (kind === 'wheel') Object.assign(ev, { deltaX: 0, deltaY: Number(dy && dy !== 'g' ? dy : -120), canScroll: true });
          wins[name].webContents.sendInputEvent(ev);
          return out({ cmd, name, kind, x: ev.x, y: ev.y });
        }
        case 'action': // a bar / popup action by name, as if clicked
          await ({ switch: () => ctl.switchToDisplay(), dismiss: () => ctl.dismissToast() })[rest[0]]?.();
          return out({ cmd, act: rest[0], state: ctl.state });
        case 'bounds':
          return out({ cmd, ...Object.fromEntries(Object.entries(wins).filter(([, w]) => w && !w.isDestroyed()).map(([k, w]) => [k, { ...w.getBounds(), visible: w.isVisible() }])) });
        case 'simulate': {
          // simulate camera-lost | camera-back | audio-lost | mic-lost | mic-back | window-closed (engine + bubble)
          if (rest[0] === 'window-closed') {
            ctl._engineEvent({ type: 'source-ended' });
            return out({ cmd, what: rest[0], state: ctl.state });
          }
          const r = await ctl._engine('simulate', { what: rest[0] }).catch((e) => ({ error: e.message }));
          if (rest[0].startsWith('camera')) wins.bubble.webContents.send('bubble:simulate', rest[0]);
          return out({ cmd, what: rest[0], result: r });
        }
        case 'perf':
          return out({ cmd, engine: await ctl._engine('perf').catch(() => null), cpu: ctl.cpuSample(), bubble: await wins.bubble.webContents.executeJavaScript('window.__bubblePerf?.()').catch(() => null) });
        case 'net':
          return out({ cmd, ...net.summary(Number(rest[0] || 0)), total: net.stats.blocked.length });
        case 'importimage': {
          // importimage background|cover <path>: what Choose image… does after the dialog
          const name = await importImage(rest.slice(1).join(' '), rest[0]);
          if (rest[0] === 'cover') settings.patch({ cleanDesktop: { on: true, cover: 'image', image: name } });
          else settings.patch({ backgrounds: [...new Set([...settings.get().backgrounds, name])], camera: { background: 'image', bgImage: `user:${name}` } });
          ctl._syncBubble();
          broadcastSettings();
          return out({ cmd, name });
        }
        case 'settingswin':
          showSettings();
          return out({ cmd });
        case 'warn': // emit a Node process warning (LC-10: warnings used to print to a dead stderr)
          process.emitWarning('Tally test warning', 'TallyTestWarning');
          return out({ cmd });
        case 'throw': // an uncaught main-process exception (LC-10: must never show a dialog)
          setTimeout(() => {
            throw new Error('Tally test uncaught exception');
          }, 0);
          return out({ cmd });
        case 'crash': // simulate a hard crash mid-recording (no cleanup at all)
          out({ cmd });
          return process.kill(process.pid, 'SIGKILL');
        case 'quit':
          out({ cmd });
          return app.quit();
        default:
          return out({ cmd, error: 'unknown' });
      }
    } catch (e) {
      out({ cmd, error: String(e.stack || e) });
    }
  });
}

app.whenReady().then(boot);
app.on('window-all-closed', (e) => e.preventDefault?.());
// Every quit path ends here: Cmd+Q, the dev 'quit', and the signals. Chromium's own
// shutdown handler turns SIGINT (Ctrl+C), SIGTERM and SIGHUP (Terminal closed) into a
// normal quit, so Node's process.on(signal) never runs in this process (verified).
// A recording in progress is stopped and saved before the app goes (LC-10).
let shuttingDown = false;
app.on('before-quit', (e) => {
  if (shuttingDown || !ctl || ctl.state === 'idle') return log('quitting');
  e.preventDefault();
  shuttingDown = true;
  log(`quitting during ${ctl.state}: stopping and saving first`);
  // Chromium hard-kills on a second signal, and one Ctrl+C arrives twice (the terminal
  // signals the group and the npm/electron launcher forwards it). Hold further signals
  // while the file is saved; the 25 s cap below still guarantees the exit.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => log(`${sig}: still saving the recording`));
  setTimeout(() => app.exit(0), 25000).unref(); // never hang on the way out
  ctl
    .shutdown()
    .catch((err) => log(`shutdown: ${err.message}`))
    .finally(() => app.quit());
});
app.on('will-quit', () => {
  notes?.flush(); // the script is never lost to a quit mid-typing (§12.5)
  cover?.hide();
  shortcuts?.dispose();
  globalShortcut.unregisterAll();
});
app.on('second-instance', () => ctl?.state === 'idle' && ctl.openSetup()); // launching again opens setup
