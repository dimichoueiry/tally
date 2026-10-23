// Session orchestration: owns the state machine and drives the engine, overlays,
// tray and shortcuts from its transitions.
import { ipcMain, screen, shell, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { guardedFinalize, withTimeout, errorPopup, copyBudgetMs } from './session/watchdog.js';
import { during as diskDuring, preflight as diskPreflight } from './disk.js';
import { freeBytes } from './session/segments.js';
import { imagePath } from './images.js';
import { initial, transition, elapsedMs, primaryAction } from './session/machine.js';
import { SegmentWriter, sessionsRoot, finalizeSession } from './session/segments.js';
import { defaultBaseName, sourceLabel, splitExt } from './library/names.js';
import { bubbleSize, constrainToWindow, relToWindow, snapRect, clampRect, defaultBubbleRect, INSET, anchorFor, resizeAnchored, trayRect, sizesThatFit, SIZES, TRAY_MIN_W } from '../shared/geometry.js';
import { screenStatus } from './permissions.js';
import { isStaleGrant, STALE_GRANT_TEXT } from './permAdvice.js';
import { findSource, screenSourceForDisplay, displayUnderPointer, displayInfo } from './sources.js';
import { watchWindow, boundsOnce, listWindows } from './winbounds.js';
import { placePill, barWindow, snapPos, homePos, displayAt, FOLDED_W, BAR_H, MOVE_STEP } from '../shared/toolbar.js';
import { placeNotes, dropPos, notesDisplay, NOTES_W, NOTES_H } from '../shared/notes.js';
import { checkPC } from './notesGuard.js';
import { SANDBOX } from './sandbox.js';
import { selfTestCapture } from './notesSelfTest.js';
import { BUBBLE_PAD, NOTES_PAD } from './windows.js';

const COUNTDOWN_MS = 3000;
const LIVE = new Set(['recording', 'paused', 'confirm']);

export class Controller {
  constructor({ settings, library, pending, wins, shortcuts, tray, log, net, cover, onPermissionNeeded, onBlocked, onCaptureSource, cameraStatus = () => 'granted', micStatus = () => 'granted', shortcutFailures = () => [], onSettings = () => {} }) {
    Object.assign(this, { settings, library, pending, wins, shortcuts, tray, log, net, cover, onPermissionNeeded, onBlocked, onCaptureSource, cameraStatus, micStatus, shortcutFailures, onSettings });
    this.s = initial;
    this.target = null;
    this.writer = null;
    this.sessionDir = null;
    this.winWatch = null;
    this.winBounds = null;
    // Setup v2 (SETUP_V2 §1): the toolbar + bubble + tray on one display. Stays open until
    // ×, Esc, the menu-bar icon or Record; focus moving elsewhere does not close it.
    this.setupOpen = false;
    this.setupDisplayId = null;
    this.setupWindow = null; // picked window: { id, sourceId, title, app, bounds }
    this.picking = false; // window picker overlay is up
    this.backToSetup = false; // Esc in a countdown lands in setup (S7)
    this.fakeWindows = null; // dev control: a stand-in window list for the picker
    // Toolbar / bar pill: measured width, where it sits, the left edge kept through a
    // session (S23), and a drag in progress.
    this.bar = { width: FOLDED_W, pos: null, frozen: null, drag: null, place: '' };
    this.trayScreen = null; // the tray's rect on screen (setup), for toolbar avoidance
    this.cameraHidden = false; // ⌥⇧C during a session
    this.autoHidden = false; // window too small for the bubble
    this.warning = null; // bar notice that needs an answer (source closed)
    this.toast = null; // bar toast: { kind, title, text, sticky } (camera lost, system audio, low disk)
    this.cameraLost = false;
    this.bgStatus = null;
    this.stopReason = null; // 'disk' when auto-stopped
    this.bubbleRect = null;
    this.drag = null;
    this.trayBox = { height: 84, pillW: 210, minW: 344 }; // measured by the tray renderer (camtray:size)
    this.setupLook = null; // { shape, size, rect } last shown in setup, to animate preset changes
    this.sizeAnim = null; // timer: the window spans old ∪ new rect until the preset animation ends
    this.resizeAnchor = null; // fixed while the corner handle is dragged
    this.camDims = null; // the camera's real resolution, from the bubble
    this.engineReady = null;
    this.rpc = { id: 0, pending: new Map() };
    this.popupData = null;
    this.popupDelete = null;
    this._wireEngine();
  }

  // ───────── state machine ─────────

  dispatch(event) {
    const prev = this.s;
    const next = transition(prev, event, Date.now());
    if (next === prev) return false;
    this.s = next;
    this.log(`state ${prev.state} → ${next.state} (${typeof event === 'string' ? event : event.type})`);
    this.shortcuts.setSessionActive(next.sessionActive && next.state !== 'finalizing');
    this._onTransition(prev, next).catch((e) => this._fail(e));
    this._broadcast();
    return true;
  }

  get state() {
    return this.s.state;
  }

  snapshot() {
    return {
      state: this.s.state,
      confirm: this.s.confirm,
      elapsedMs: elapsedMs(this.s, Date.now()),
      at: Date.now(),
      cameraOn: this.settings.get().camera.on,
      cameraHidden: this.cameraHidden || this.autoHidden || this.cameraLost,
      autoHidden: this.autoHidden,
      warning: this.warning,
      toast: this.toast,
      cameraLost: this.cameraLost,
      bgStatus: this.bgStatus,
      labelled: this.settings.get().recordingsMade < 3,
      target: this.target && { kind: this.target.kind, label: this.target.label },
    };
  }

  _broadcast() {
    const snap = this.snapshot();
    for (const w of [this.wins.bar, this.wins.bubble, this.wins.notes]) if (w && !w.isDestroyed()) w.webContents.send('app:session', snap);
    this.wins.bar?.webContents.send('bar:setup', this.setupInfo());
    this.tray.update(snap);
    this._syncBar();
  }

  async _onTransition(prev, next) {
    const from = prev.state;
    const to = next.state;
    if (to === 'countdown') return this._enterCountdown(from);
    if (from === 'countdown' && to === 'recording') return this._startRecording();
    if (from === 'countdown' && to === 'idle') {
      const back = this.backToSetup;
      this.backToSetup = false;
      const displayId = this.target?.display.id;
      this._teardown({ discard: true });
      if (back) this.openSetup(displayId); // Esc in the countdown: back to setup, choices intact (S7)
      return;
    }
    if (to === 'paused' && from === 'recording') return this._engine('pause');
    if (to === 'recording' && (from === 'paused' || from === 'confirm')) {
      this.warning = null;
      return this._engine('resume');
    }
    if (to === 'confirm' && from !== 'confirm') {
      if (from === 'recording') await this._engine('pause');
      this._focusBar();
      return;
    }
    if (from === 'confirm' && to === 'paused') return this._unfocusBar();
    if (from === 'confirm' && to === 'idle') return this._teardown({ discard: true });
    if (to === 'finalizing') return this._finalize();
  }

  // ───────── public actions ─────────

  // `sel`: { kind: 'display', displayId } | { kind: 'window', sourceId, title } | null (⌥⇧R quick start)
  async start(sel = null) {
    if (this.s.state !== 'idle') return;
    if (screenStatus() !== 'granted') return this.onPermissionNeeded();
    // Under 1 GB free nothing starts, ⌥⇧R included (spec §3.1, §3.8).
    if (diskPreflight(this._freeBytes(), this.settings.get().quality.size).level === 'block') {
      this.lastError = 'Less than 1 GB free. Free up space to record.';
      this.log('start refused: less than 1 GB free');
      return this.onBlocked?.();
    }
    try {
      this.target = await this._resolveTarget(sel);
    } catch (e) {
      return this._fail(e);
    }
    this.dispatch('START');
  }

  primary() {
    const action = primaryAction(this.s);
    if (action === 'START' && this._inSetup()) return this.recordFromSetup(); // same as clicking Record
    if (action === 'START') return this.start(null);
    if (action === 'COUNTDOWN_DONE') return this._countdownNow();
    if (action) this.dispatch(action);
  }

  togglePause() {
    this.dispatch('TOGGLE_PAUSE');
  }

  askRestart() {
    this.dispatch('ASK_RESTART');
  }

  askCancel() {
    this.dispatch('ASK_CANCEL');
  }

  keepGoing() {
    this.dispatch('KEEP_GOING');
    this._unfocusBar();
  }

  confirm() {
    this.dispatch('CONFIRM');
  }

  stop() {
    this.dispatch('STOP');
  }

  toggleCamera() {
    if (!LIVE.has(this.s.state) && this.s.state !== 'countdown') return;
    if (!this.settings.get().camera.on) return;
    this.cameraHidden = !this.cameraHidden;
    this._syncBubble();
    this._broadcast();
  }


  // Quit requested (signal): a live recording is stopped and saved, a countdown is
  // cancelled. Resolves once the session is idle (finalize can take a few seconds).
  async shutdown() {
    clearInterval(this.diskTimer);
    if (this.s.state === 'countdown') this.cancelCountdown();
    else if (LIVE.has(this.s.state)) this.stop();
    for (let i = 0; i < 200 && this.s.state !== 'idle'; i++) await new Promise((r) => setTimeout(r, 100));
    this.cover.hide();
  }

  // An uncaught main-process error (logged by logger.js). The session keeps running;
  // the error is kept for the popover's "last error" line.
  noteFatal(e) {
    this.lastError = `Internal error: ${e?.message || e}`;
  }

  // ───────── target resolution ─────────

  async _resolveTarget(sel) {
    const st = this.settings.get();
    if (!sel && st.source.mode === 'window' && st.source.windowSourceId) {
      // ⌥⇧R in Window mode: the last window if it is still open (spec §3.1).
      const src = await findSource(st.source.windowSourceId);
      if (src) sel = { kind: 'window', sourceId: src.id, title: src.name };
    }
    if (sel?.kind === 'window') {
      const src = await findSource(sel.sourceId);
      if (!src) throw new Error('That window is no longer open');
      const bounds = await boundsOnce(src.id);
      const display = displayInfo(bounds ? screen.getDisplayMatching(bounds) : screen.getPrimaryDisplay());
      return { kind: 'window', source: src, title: src.name, label: sourceLabel({ kind: 'window', title: src.name }), display, bounds };
    }
    // Display: the chosen one, or (⌥⇧R) the display under the pointer (D6).
    const d = sel?.displayId != null ? screen.getAllDisplays().find((x) => String(x.id) === String(sel.displayId)) || displayUnderPointer() : displayUnderPointer();
    const src = await screenSourceForDisplay(d.id);
    if (!src) throw new Error('No display source');
    const info = displayInfo(d);
    return { kind: 'display', source: src, label: sourceLabel({ kind: 'display', label: d.label }), display: info, bounds: info.bounds };
  }

  // ───────── countdown ─────────

  async _enterCountdown(from) {
    if (from === 'confirm') {
      // Restart: the take is thrown away and a fresh countdown runs on the same target.
      await this._engine('abort').catch(() => {});
      this._discardSession();
      this.wins.bar.hide();
    } else {
      await this.dismissPopup({ commit: true }); // the popup closes when the next countdown begins (D7)
      // Setup ends at Record: the tray goes, the bubble stays put, and the bar keeps the
      // toolbar's left edge for the whole session (S23).
      this.bar.frozen = this.bar.pos;
      this._endSetup();
    }
    this.warning = null;
    this.toast = null;
    this.cameraLost = false;
    this.stopReason = null;
    this.cameraHidden = false;
    if (this.target.kind === 'window') this._watchWindow();
    this._syncBubble();
    // Clean desktop goes up with the countdown, so the frame and tag show the real result.
    this.coverReady = this._showCover();
    this.onCaptureSource(this.target.source, this.settings.get().systemAudio);
    this.engineReady = this._prepareEngine();
    this.engineReady.catch(() => {}); // awaited (and reported) when the countdown ends
    this._checkNotesForRecording().catch((e) => this.log(`notes check failed: ${e.message}`));
    this._showCountdown();
    clearTimeout(this.countdownTimer);
    this.countdownTimer = setTimeout(() => this._countdownNow(), COUNTDOWN_MS);
  }

  _showCountdown() {
    const { display, kind, bounds, label } = this.target;
    const win = this.wins.countdown;
    win.setBounds(display.bounds);
    const q = this.settings.get().quality.size === 'native' ? 'Native' : '1080p';
    const local = kind === 'window' && bounds ? { x: bounds.x - display.bounds.x, y: bounds.y - display.bounds.y, width: bounds.width, height: bounds.height } : null;
    win.webContents.send('countdown:show', {
      kind,
      rect: local,
      tag: kind === 'display' ? `${display.name === 'Built-in' ? 'Built-in display' : display.name} · ${q}` : label,
      ms: COUNTDOWN_MS,
    });
    win.showInactive();
    win.setIgnoreMouseEvents(true);
    // Space / Esc go to the bar (compact countdown, S25): a non-activating panel, so the
    // app being demoed stays frontmost.
    this._syncBar();
    this.wins.bar.focus();
    this.wins.bar.webContents.send('bar:focus');
  }

  async _countdownNow() {
    if (this.s.state !== 'countdown') return;
    clearTimeout(this.countdownTimer);
    this.wins.countdown.webContents.send('countdown:hide');
    this.wins.countdown.hide();
    try {
      await this.engineReady;
      await this.coverReady; // ≤ 2 s; the cover must be up before frame 1
    } catch (e) {
      return this._fail(e);
    }
    if (this.s.state !== 'countdown') return;
    this.dispatch('COUNTDOWN_DONE');
  }

  cancelCountdown() {
    if (this.s.state !== 'countdown') return;
    clearTimeout(this.countdownTimer);
    this.wins.countdown.hide();
    this.backToSetup = true;
    this.dispatch('CANCEL_COUNTDOWN');
  }

  // ───────── engine ─────────

  _wireEngine() {
    ipcMain.on('engine:reply', (_e, { id, result, error }) => {
      const p = this.rpc.pending.get(id);
      if (!p) return;
      this.rpc.pending.delete(id);
      error ? p.reject(new Error(error)) : p.resolve(result);
    });
    ipcMain.on('engine:chunk', (_e, bytes) => {
      if (this.writer) this.writer.append(bytes);
    });
    ipcMain.on('engine:event', (_e, ev) => this._engineEvent(ev));
  }

  _engine(method, args = {}) {
    const id = ++this.rpc.id;
    this.wins.engine.webContents.send('engine:call', { id, method, args });
    return new Promise((resolve, reject) => {
      this.rpc.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.rpc.pending.delete(id)) reject(new Error(`engine ${method} timed out`));
      }, method === 'prepare' ? 20000 : 15000);
    });
  }

  async _prepareEngine() {
    const st = this.settings.get();
    const mask = await this._privacyMask();
    return this._engine('prepare', {
      kind: this.target.kind,
      quality: st.quality.size,
      captureScale: this.target.display.scale,
      systemAudio: st.systemAudio,
      mic: st.mic,
      camera: { on: st.camera.on, deviceId: st.camera.deviceId },
      bubble: this._bubbleForEngine(),
      mask,
    }).then((r) => {
      this.prepared = r;
      this.log(`engine ready ${JSON.stringify(r)}`);
      return r;
    });
  }

  async _startRecording() {
    this.staleGrant = false; // capture started, so the grant works
    const id = `${Date.now()}`;
    this.sessionDir = path.join(sessionsRoot(this.settings.get().libraryDir), id);
    const startedAt = new Date();
    this.baseName = defaultBaseName(startedAt, this.target.label);
    this.writer = new SegmentWriter(this.sessionDir, { id, baseName: this.baseName, startedAt: startedAt.toISOString(), source: this.target.label, kind: this.target.kind }, { log: (t) => this.log(`writer: ${t}`) });
    this._syncBar();
    this.netFrom = Date.now();
    this.cpuStart = this._cpuNow();
    await this._engine('start');
    this._watchDisk();
  }

  // ───────── clean desktop ─────────

  // Privacy level (Standard / Semi-private / Very private): the menu-bar and Dock strips the
  // engine paints over. Full screen only; the real menu bar and Dock stay usable.
  async _privacyMask() {
    if (this.target?.kind !== 'display') return null;
    const cd = this.settings.get().cleanDesktop;
    const mask = await this.cover.privacyMask(this.target.display, cd, cd.image ? imagePath('cover', cd.image) : null).catch((e) => {
      this.log(`privacy mask failed: ${e.message}`);
      return null;
    });
    this.log(`privacy ${cd.privacy || 'standard'}${cd.privacy === 'semi' ? ` (shows ${cd.keep})` : ''}: ${mask ? JSON.stringify(mask.rects) : 'no mask'}`);
    return mask;
  }

  // The display the cover belongs on: the recorded one in a session, the setup display
  // while setting up in Full-screen mode (S4: the cover is live during setup).
  _coverDisplayId() {
    if (this.s.state !== 'idle') return this.target?.kind === 'display' ? this.target.display.id : null;
    if (this._inSetup() && this.settings.get().source.mode === 'display') return this.setupDisplayId;
    return null;
  }

  _showCover() {
    const cd = this.settings.get().cleanDesktop;
    const id = this._coverDisplayId();
    if (!cd.on || id == null || !this.cover.available()) {
      this.cover.hide();
      return Promise.resolve(false);
    }
    return this.cover.show(id, { cover: cd.cover, image: cd.image ? imagePath('cover', cd.image) : null });
  }

  // Settings changed (toolbar, tray, Settings window): the cover follows at once.
  settingsChanged() {
    if ((this.s.state !== 'idle' && this.target) || this._inSetup()) this._showCover();
    this._broadcast();
  }

  // ───────── disk ─────────

  _freeBytes() {
    // TALLY_FAKE_FREE_MB: test hook. While recording, pretend the disk had this much
    // free when the recording started; every byte written counts against it.
    const fake = Number(process.env.TALLY_FAKE_FREE_MB);
    if (fake && this.writer) return fake * 1e6 - this.writer.bytes;
    return freeBytes(this.settings.get().libraryDir);
  }

  _watchDisk() {
    clearInterval(this.diskTimer);
    const check = () => {
      if (!LIVE.has(this.s.state) || !this.writer) return;
      const st = this.settings.get();
      const d = diskDuring(this._freeBytes(), st.quality.size, st.systemAudio || st.mic.on);
      if (d.level === 'stop') {
        // Auto-stop at 500 MB free: finalize what exists (spec §3.8).
        this.stopFree = this._freeBytes();
        this.log(`disk almost full (${Math.round(this.stopFree / 1e6)} MB): auto-stop`);
        this.stopReason = 'disk';
        clearInterval(this.diskTimer);
        this.dispatch('STOP');
      } else if (d.level === 'notice' && this.toast?.kind !== 'disk') {
        const left = d.seconds < 60 ? 'under a minute left' : `${Math.round(d.seconds / 60)} min left`;
        this._toast({ kind: 'disk', icon: 'disk', title: `Low disk — ${left}.`, text: 'Recording stops safely before the disk fills.', sticky: true });
      }
    };
    this.diskTimer = setInterval(check, Number(process.env.TALLY_DISK_POLL_MS) || 5000);
    check();
  }

  // ───────── bar toasts ─────────

  _toast(t) {
    clearTimeout(this.toastTimer);
    this.toast = t;
    this._broadcast();
    // Auto-hide after 5 s (spec §3.8), unless it is a standing notice.
    if (!t.sticky) this.toastTimer = setTimeout(() => this.dismissToast(t), 5000);
  }

  dismissToast(t = this.toast) {
    if (!t || this.toast !== t) return;
    this.toast = null;
    this._broadcast();
  }

  // ───────── CPU (perf numbers) ─────────

  _cpuNow() {
    const m = app.getAppMetrics();
    const role = (pid) => Object.entries(this.wins).find(([, w]) => w && !w.isDestroyed() && w.webContents.getOSProcessId() === pid)?.[0];
    const out = { t: Date.now(), all: 0 };
    for (const p of m) {
      const c = p.cpu.cumulativeCPUUsage ?? 0;
      out.all += c;
      const k = p.type === 'GPU' ? 'gpu' : p.type === 'Browser' ? 'main' : role(p.pid) || 'other';
      out[k] = (out[k] || 0) + c;
    }
    return out;
  }

  // CPU % since the recording started (100 % = one core).
  cpuSample(from = this.cpuStart) {
    if (!from) return null;
    const now = this._cpuNow();
    const secs = (now.t - from.t) / 1000;
    const res = { seconds: +secs.toFixed(1) };
    for (const k of Object.keys(now)) if (k !== 't') res[k] = +(((now[k] - (from[k] || 0)) / secs) * 100).toFixed(1);
    return res;
  }

  _engineEvent(ev) {
    if (ev.type === 'source-ended' && LIVE.has(this.s.state)) {
      // Source window closed (or display gone): auto-pause at the last frame (spec §3.8).
      this.warning = { kind: 'source-closed', text: this.target.kind === 'window' ? 'Window closed' : 'Display disconnected', atMs: elapsedMs(this.s, Date.now()), canSwitch: !!this._switchDisplay() };
      if (this.s.state === 'recording') this.dispatch('PAUSE');
      this._broadcast();
    }
    if (ev.type === 'camera-lost' && this.s.state !== 'idle') {
      // Screen keeps recording; the video loses the bubble from now (spec §3.8).
      this.cameraLost = true;
      const name = (ev.label || 'Camera').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '').replace(/ Camera$/, '');
      this._toast({ kind: 'camera', icon: 'unplug', title: `${name} disconnected.`, text: 'Screen is still recording. Reconnect to bring the camera back.' });
    }
    if (ev.type === 'camera-back' && this.s.state !== 'idle') {
      this.cameraLost = false;
      if (this.toast?.kind === 'camera') this.dismissToast();
      else this._broadcast();
    }
    if (ev.type === 'audio-lost' && this.s.state !== 'idle') {
      this.log(`system audio lost (${ev.reason})`);
      this._toast({ kind: 'audio', icon: 'speaker-off', title: ev.reason === 'unavailable' ? 'System audio unavailable.' : 'System audio stopped.', text: 'Screen is still recording, without sound from now.', sticky: true });
    }
    if (ev.type === 'audio-back' && this.toast?.kind === 'audio') this.dismissToast();
    // Microphone unplugged / refused: video (and system audio) keep recording; a notice, never a stop.
    if (ev.type === 'mic-lost' && this.s.state !== 'idle') {
      this.log(`microphone lost (${ev.reason})`);
      const name = (ev.label || '').replace(/^Default\s*[-–]\s*/i, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '') || 'Microphone';
      const title = ev.reason === 'denied' ? 'Microphone is off for Tally.' : ev.reason === 'unavailable' ? 'Microphone unavailable.' : `${name} disconnected.`;
      this._toast({ kind: 'mic', icon: 'mic-off', title, text: ev.reason === 'denied' ? 'Recording without your voice. Allow it in System Settings.' : 'Still recording, without your voice. Reconnect to bring it back.', sticky: true });
    }
    if (ev.type === 'mic-back' && this.toast?.kind === 'mic') this.dismissToast();
    if (ev.type === 'bg-status') {
      this.bgStatus = ev.status;
      this._broadcast();
    }
    if (ev.type === 'log') this.log(`engine: ${ev.text}`);
  }

  // The display to continue on after the recorded window closed: the window's display
  // if it is still connected, else the primary one.
  _switchDisplay() {
    const all = screen.getAllDisplays();
    if (this.target?.kind === 'display') return all.find((d) => String(d.id) !== this.target.display.id) || null;
    return all.find((d) => String(d.id) === this.target?.display.id) || screen.getPrimaryDisplay();
  }

  // "Switch to display" (spec §3.8): keep the take, continue recording a display.
  async switchToDisplay() {
    if (!this.warning || !LIVE.has(this.s.state)) return;
    const d = this._switchDisplay();
    if (!d) return;
    const src = await screenSourceForDisplay(d.id);
    if (!src) return this._fail(new Error('No display source'));
    const info = displayInfo(d);
    this._stopWatch();
    this.target = { kind: 'display', source: src, label: this.target.label, display: info, bounds: info.bounds };
    this.onCaptureSource(src, false); // video only; the audio mixer keeps its track
    await this._engine('switchSource', { captureScale: info.scale, mask: await this._privacyMask() });
    this.warning = null;
    this.coverReady = this._showCover();
    this._syncBubble();
    this.log(`switched to display ${info.id}`);
    if (this.s.state === 'paused') this.dispatch('RESUME');
    this._broadcast();
  }

  async _finalize() {
    clearTimeout(this.countdownTimer);
    this.wins.bar.hide();
    this._stopWatch();
    const provisional = `${this.baseName}.mp4`;
    const slow = setTimeout(() => this._showPopup({ finalizing: true, name: provisional }), 300);
    let stats = null;
    clearInterval(this.diskTimer);
    const cpu = this.cpuSample();
    const netSummary = this.net?.summary(this.netFrom || 0);
    this.cover.hide();
    // Dev only (TALLY_DEV_CONTROL): force the error / timeout path to check the popup.
    const fake = process.env.TALLY_DEV_CONTROL === '1' ? process.env.TALLY_FAKE_FINALIZE : null;
    const libDir = this.settings.get().libraryDir;
    try {
      // Every step has a time limit; any failure lands in the error popup (_finishFailed).
      const fakeFree = Number(process.env.TALLY_FAKE_FREE_MB);
      const out = await guardedFinalize({
        stop: () => this._engine('stop'),
        close: () => this.writer.close(),
        finalize: () => {
          if (fake === 'error') throw new Error('Forced finalize error (dev)');
          if (fake === 'hang') return new Promise(() => {});
          const written = this.writer.bytes;
          return finalizeSession(this.sessionDir, libDir, this.baseName, { log: this.log, ...(fakeFree ? { free: () => fakeFree * 1e6 - written } : {}) });
        },
        bytes: () => this.writer?.bytes || 0,
      }, fake === 'hang' ? { budget: () => 3000 } : {});
      stats = out.stats;
      const res = out.res;
      const q = this.settings.get().quality.size === 'native' ? 'Native' : '1080p';
      await this.library.setMeta(res.file, { tally: true, duration: res.duration ?? stats.durationMs / 1000, quality: q, fps: 30, camera: stats.cameraUsed, width: stats.width, height: stats.height }, stats.thumb ? Buffer.from(stats.thumb.split(',')[1], 'base64') : null);
      this.settings.patch({ recordingsMade: this.settings.get().recordingsMade + 1 });
      this.writer = null;
      this.sessionDir = null;
      clearTimeout(slow);
      this.lastSaved = res.file;
      this.log(`saved ${res.file} remuxed=${res.remuxed}${res.skipped ? ` (${res.skipped})` : ''} duration=${res.duration} frames=${stats.frames} chunks=${stats.chunks} lateTicks=${stats.lateTicks} generator=${stats.generator} activeMs=${stats.durationMs} mime=${stats.mimeType}`);
      this.log(`perf ${JSON.stringify({ perf: stats.perf, audio: stats.audio, cpu, net: netSummary })}`);
      this.lastStats = { ...stats, thumb: undefined, cpu, net: netSummary, file: res.file };
      const entry = await this.library.entry(res.file);
      const reason = this.stopReason;
      this.dispatch('FINALIZED');
      this._teardown({ discard: false });
      await this._showPopup({ finalizing: false, entry, stopped: reason === 'disk' ? { reason: 'disk', free: this.stopFree, duration: res.duration } : null });
    } catch (e) {
      clearTimeout(slow);
      const failed = { dir: this.sessionDir, baseName: this.baseName, libDir, job: e.job || null };
      this._fail(e);
      this._finishFailed(failed, e);
    }
  }

  // The popup never stays on "Finishing file…": it says the file couldn't be finished,
  // with Save what was recorded (salvage the parts on disk) and Show in Finder. The parts
  // stay in the session folder; if the popup is dismissed, the next launch recovers them.
  _finishFailed(failed, e) {
    this.failed = failed;
    this.log(`finish failed: ${e?.message || e}${failed.dir ? ` (parts in ${failed.dir})` : ''}`);
    this._showPopup(errorPopup(e, { name: `${failed.baseName}.mp4`, partsLeft: !!failed.dir && fs.existsSync(failed.dir) })).catch(() => {});
  }

  async salvageFailed() {
    const f = this.failed;
    if (!f) return;
    this._showPopup({ finalizing: true, name: `${f.baseName}.mp4` }).catch(() => {});
    try {
      // A copy that ran out of time may have finished since: use it rather than race it.
      let res = f.job ? await f.job.catch(() => null) : null;
      if (!res?.file || !fs.existsSync(res.file)) {
        if (!fs.existsSync(f.dir)) throw new Error('No recorded parts are left to save');
        const size = fs.readdirSync(f.dir).reduce((n, x) => n + (fs.statSync(path.join(f.dir, x)).size || 0), 0);
        res = await withTimeout(finalizeSession(f.dir, f.libDir, f.baseName, { log: this.log }), copyBudgetMs(size) * 3, 'Saving');
        if (!res.file) throw new Error(`Nothing playable was recorded (${res.reason})`);
      }
      await this.library.setMeta(res.file, { tally: true, duration: res.duration ?? null, salvaged: true });
      this.failed = null;
      this.lastSaved = res.file;
      this.log(`salvaged ${res.file} duration=${res.duration}`);
      await this._showPopup({ finalizing: false, entry: await this.library.entry(res.file) });
    } catch (e) {
      this._finishFailed({ ...f, job: null }, e);
    }
  }

  revealFailed() {
    const f = this.failed;
    if (f?.dir && fs.existsSync(f.dir)) return shell.showItemInFolder(f.dir);
    return shell.openPath(f?.libDir || this.settings.get().libraryDir);
  }

  _discardSession() {
    const w = this.writer;
    const dir = this.sessionDir;
    this.writer = null;
    this.sessionDir = null;
    if (w) w.close().catch(() => {}).finally(() => import('node:fs').then((fs) => fs.rmSync(dir, { recursive: true, force: true })));
  }

  _teardown({ discard }) {
    clearTimeout(this.countdownTimer);
    clearInterval(this.diskTimer);
    clearTimeout(this.toastTimer);
    this.cover.hide();
    this.toast = null;
    this.cameraLost = false;
    this.bgStatus = null;
    if (discard) {
      this._engine('abort').catch(() => {});
      this._discardSession();
    }
    this._stopWatch();
    this.wins.countdown.hide();
    this.bar.frozen = null;
    this.warning = null;
    this.cameraHidden = false;
    this.autoHidden = false;
    this._syncBubble();
    this._broadcast();
  }

  // Errors end the session. Segments already written stay on disk and are
  // recovered on the next launch, exactly like a crash.
  _fail(e) {
    this.log(`error: ${e.stack || e}`);
    if (this.s.state !== 'idle') {
      this.s = transition(this.s, 'ERROR');
      this.shortcuts.setSessionActive(false);
      this._engine('abort').catch(() => {});
      this.writer?.close().catch(() => {});
      this.writer = null;
      this.sessionDir = null;
      this._teardown({ discard: false });
    }
    this.lastError = String(e.message || e);
    // Capture refused although the permission reads 'granted': a stale grant (LC-19).
    this.staleGrant = isStaleGrant(e, screenStatus());
    if (this.staleGrant) this.noticeDismissed?.delete('stale');
    this._broadcast();
    if (this.staleGrant && this.s.state === 'idle' && !this._inSetup()) this.onBlocked?.(); // setup's notice says what to do
  }

  // ───────── bar ─────────

  // Confirmation shown: the recording is paused, so the bar may take key focus for
  // Esc / Return. It is a non-activating panel, so the demoed app stays frontmost.
  _focusBar() {
    this.wins.bar.focus();
    this.wins.bar.webContents.send('bar:focus');
  }

  _unfocusBar() {
    this.wins.bar.blur();
  }

  // ───────── setup (SETUP_V2 §1, §15) ─────────

  // Opens setup on a display: toolbar bottom-centre (or where it was left), bubble +
  // tray, and the cover right away (S4).
  openSetup(displayId) {
    if (this.s.state !== 'idle') return;
    if (screenStatus() !== 'granted') return this.onPermissionNeeded();
    const all = screen.getAllDisplays();
    const d = all.find((x) => String(x.id) === String(displayId)) || screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    this.setupOpen = true;
    this.setupDisplayId = String(d.id);
    this.tray.setSetupOpen?.(true);
    this._showCover();
    this._syncBubble();
    this._broadcast();
    this._restoreSetupWindow();
    // Setup takes keyboard focus (S9); initial focus is Record, so Return records.
    this.wins.bar.focus();
    this.wins.bar.webContents.send('bar:focus', 'record');
  }

  closeSetup() {
    if (!this.setupOpen) return;
    this._endSetup();
    if (this.s.state === 'idle') this.cover.hide();
    this._broadcast();
  }

  toggleSetup(displayId) {
    if (this._inSetup()) this.closeSetup();
    else this.openSetup(displayId);
  }

  // Setup UI goes (close, or Record): picker, picked-window ring, tray, toolbar.
  _endSetup() {
    this.setupOpen = false;
    this.picking = false;
    this._hidePicker();
    if (this.s.state === 'idle') this._stopWatch();
    this.tray.setSetupOpen?.(false);
    this._syncBubble();
  }

  // Why Record is disabled right now, said next to it (SETUP_V2 §1 banners table).
  _recordWhy() {
    if (screenStatus() !== 'granted') return 'Screen Recording is off for Tally.';
    if (diskPreflight(this._freeBytes(), this.settings.get().quality.size).level === 'block') return 'Less than 1 GB free. Free up space to record.';
    if (this.settings.get().source.mode === 'window' && !this.setupWindow) return 'Pick a window to record.';
    return null;
  }

  // One glass notice line above the toolbar: the most important one only.
  _notice() {
    if (screenStatus() !== 'granted') return { kind: 'perm', tone: 'bad', text: 'Screen Recording is off for Tally.', action: 'Open Settings' };
    const st = this.settings.get();
    const free = this._freeBytes();
    const d = diskPreflight(free, st.quality.size, st.systemAudio || st.mic.on);
    if (d.level === 'block') return { kind: 'disk', tone: 'bad', text: 'Less than 1 GB free. Free up space to record.' };
    if (st.mic.on && ['denied', 'restricted'].includes(this.micStatus())) return { kind: 'micperm', tone: 'warn', icon: 'mic-off', text: 'Microphone is off for Tally. Recordings will have no voice.', action: 'Open Settings' };
    if (this.staleGrant && !this.noticeDismissed?.has('stale')) return { kind: 'perm', tone: 'bad', text: STALE_GRANT_TEXT, action: 'Open Settings', wrap: true };
    if (this.lastError && !this.noticeDismissed?.has('error')) return { kind: 'error', tone: 'bad', text: `The last recording stopped: ${this.lastError}`, dismiss: true };
    const failed = this.shortcutFailures();
    if (failed.length && !this.noticeDismissed?.has('shortcut')) return { kind: 'shortcut', tone: 'warn', text: `${failed.map((a) => a.replace('Alt+Shift+', process.platform === 'darwin' ? '⌥⇧' : 'Alt+Shift+')).join(', ')} is used by another app. The toolbar still works.`, dismiss: true };
    // Free space shows only when it matters (< 5 GB).
    if (d.level === 'warn') return { kind: 'lowdisk', tone: 'warn', text: `${(free / 1e9).toFixed(1)} GB free, about ${d.minutes} min at ${st.quality.size === 'native' ? 'Native' : '1080p'}. Recording stops safely before the disk fills.` };
    return null;
  }

  dismissNotice(kind) {
    (this.noticeDismissed ||= new Set()).add(kind);
    if (kind === 'error') this.lastError = null;
    this._broadcast();
  }

  setupInfo() {
    const d = this._inSetup() ? screen.getAllDisplays().find((x) => String(x.id) === this.setupDisplayId) : null;
    const st = this.settings.get();
    return {
      open: this._inSetup(),
      picking: this.picking,
      window: this.setupWindow && { title: this.setupWindow.title, app: this.setupWindow.app, width: this.setupWindow.bounds?.width, height: this.setupWindow.bounds?.height },
      recordWhy: this._inSetup() ? this._recordWhy() : null,
      notice: this._inSetup() ? this._notice() : null,
      coverAvailable: this.cover.available(),
      display: d ? { px: `${Math.round(d.size.width * d.scaleFactor)}×${Math.round(d.size.height * d.scaleFactor)}` } : null,
      gbPerHour: st.quality.size === 'native' ? 5.4 : 2.7, // 12 / 6 Mbit/s targets
    };
  }

  recordFromSetup() {
    if (!this._inSetup() || this._recordWhy()) return;
    const st = this.settings.get();
    const sel = st.source.mode === 'window' && this.setupWindow ? { kind: 'window', sourceId: this.setupWindow.sourceId, title: this.setupWindow.title } : { kind: 'display', displayId: this.setupDisplayId };
    return this.start(sel);
  }

  // ───────── toolbar / bar placement (SETUP_V2 §15) ─────────

  _barVisible() {
    return (this.s.state === 'idle' && this.setupOpen) || this.s.state === 'countdown' || LIVE.has(this.s.state);
  }

  // Shown / hidden and placed for the current state. The pill's left edge is the
  // anchor: unfolding grows it right, and Record → countdown → bar keeps it (S23).
  _syncBar() {
    const win = this.wins.bar;
    if (!win || win.isDestroyed()) return;
    if (!this._barVisible()) {
      if (win.isVisible()) win.hide();
      this.bar.place = '';
      this._ghost(null);
      this._syncNotes();
      return;
    }
    this._placeBar();
    if (!win.isVisible()) win.showInactive();
    this._syncNotes(); // placed after the toolbar, bubble and tray, so it can keep clear of them
  }

  _barAvoid() {
    const b = this._bubbleVisible() ? this.bubbleRect : null;
    return this._inSetup() ? [b, this.trayScreen] : [b];
  }

  _placeBar() {
    const d = this._display();
    const saved = this.settings.get().toolbar.pos[String(d.id)] || null;
    const base = this.bar.drag ? this.bar.drag.pos : this.s.state !== 'idle' && this.bar.frozen ? this.bar.frozen : saved;
    const pos = this.bar.drag ? base : placePill(d.workArea, base, this.bar.width, this._barAvoid());
    this.bar.pos = pos;
    const { win, ox, oy, down } = barWindow(d.bounds, pos, this.bar.width);
    const key = JSON.stringify([win, ox, oy, down]);
    if (key === this.bar.place) return;
    this.bar.place = key;
    this.wins.bar.setBounds(win);
    // Moved or resized: transparent until the pointer is over the pill again (the
    // renderer re-checks on bar:place), so nothing invisible catches a bubble drag.
    this.wins.bar.setIgnoreMouseEvents(true, { forward: true });
    this.wins.bar.webContents.send('bar:place', { ox, oy, down });
  }

  // The renderer measured the pill (fold state, labels, status icons).
  barWidth(width) {
    const w = Math.ceil(width);
    if (!w || w === this.bar.width) return;
    this.bar.width = w;
    this._placeBar();
  }

  toggleFold() {
    const t = this.settings.get().toolbar;
    this.settings.patch({ toolbar: { unfolded: !t.unfolded } });
    return this.settings.get();
  }

  // Drag by the grip or any empty part (§15.5): free placement, magnets at the 16 pt
  // edge lines, home and top-centre. Saved per display; home is saved as "no position".
  barDrag({ phase, cx, cy }) {
    let d = this._display();
    const { x, y } = this._dragPoint(this.wins.bar, cx, cy);
    // In setup, dropping it on another display makes that display the target (Loom):
    // cover, bubble + tray and the saved spots all follow. A session keeps its target.
    if (x != null && this.bar.drag && this._inSetup()) {
      const id = displayAt(screen.getAllDisplays(), { x, y }, d.id);
      if (id !== String(d.id)) d = this._retargetSetup(id) || d;
    }
    if (phase === 'start') {
      this.bar.drag = { from: { x, y }, start: { ...this.bar.pos }, pos: { ...this.bar.pos, at: null } };
      this._ghost(d);
      return;
    }
    if (!this.bar.drag) return;
    const { from, start } = this.bar.drag;
    if (x != null) this.bar.drag.pos = snapPos(d.workArea, { x: start.x + x - from.x, y: start.y + y - from.y }, this.bar.width);
    this._ghost(d, this.bar.drag.pos.at === 'home');
    this._placeBar();
    if (phase === 'end') {
      const p = this.bar.drag.pos;
      this.bar.drag = null;
      this._ghost(null);
      this._saveBarPos(d, p);
    }
  }

  // Setup moves to another display: the toolbar, cover (with that display's wallpaper),
  // bubble + tray and picker all go there; each uses its spot saved for that display.
  _retargetSetup(id) {
    const d = screen.getAllDisplays().find((x) => String(x.id) === String(id));
    if (!d || String(d.id) === this.setupDisplayId) return null;
    this.log(`setup moved to display ${d.id}`);
    this.setupDisplayId = String(d.id);
    this.bar.place = '';
    this._showCover();
    this._syncBubble();
    if (this.picking) this.startPicker(); // re-lists the windows on the new display
    this._broadcast();
    return d;
  }

  barHome() {
    const d = this._display();
    this._saveBarPos(d, { ...homePos(d.workArea), at: 'home' });
  }

  // ⌥ + arrows: 16 pt (⌥⇧: 64), snapping like a drag.
  barNudge({ dx, dy, big }) {
    const d = this._display();
    const k = big ? 4 : 1;
    const p = snapPos(d.workArea, { x: this.bar.pos.x + Math.sign(dx) * MOVE_STEP * k, y: this.bar.pos.y + Math.sign(dy) * MOVE_STEP * k }, this.bar.width);
    this._saveBarPos(d, p);
  }

  _saveBarPos(d, p) {
    this.settings.patch({ toolbar: { pos: { [String(d.id)]: p.at === 'home' ? null : { x: p.x, y: p.y } } } });
    if (this.s.state !== 'idle') this.bar.frozen = { x: p.x, y: p.y };
    this.bar.place = '';
    this._placeBar();
  }

  // Dashed "home" outline while dragging (16e), drawn by the display-wide tray overlay.
  _ghost(d, near = false) {
    const t = this.wins.camtray;
    if (!t || t.isDestroyed()) return;
    if (!d || !t.isVisible()) return t.webContents.send('camtray:ghost', null);
    const h = homePos(d.workArea);
    const b = t.getBounds();
    t.webContents.send('camtray:ghost', { x: h.x - b.x, y: h.y - b.y, width: FOLDED_W, height: BAR_H, near });
  }

  // The pointer during a window drag. The window moves under the pointer, so a point the
  // page reports (relative to where the window was) lags; the real cursor never does.
  // A sandboxed test instance drives the page with synthetic events that don't move the
  // cursor, so it uses the reported point instead.
  _dragPoint(win, cx, cy) {
    if (cx == null) return { x: null, y: null };
    if (!SANDBOX) return screen.getCursorScreenPoint();
    const wb = win.getBounds();
    return { x: wb.x + cx, y: wb.y + cy };
  }

  // ───────── window picker (SETUP_V2 §3.5) ─────────

  _setupDisplay() {
    return screen.getAllDisplays().find((x) => String(x.id) === this.setupDisplayId) || screen.getPrimaryDisplay();
  }

  // Window chosen in the toolbar: the screen becomes the picker. Everything dims except
  // the window under the pointer; a click picks it. Esc goes back.
  async startPicker() {
    if (!this._inSetup()) return;
    this.settings.patch({ source: { mode: 'window' } });
    this._showCover(); // no cover in Window mode: nothing of the desktop records
    const d = this._setupDisplay();
    const all = this.fakeWindows || (await listWindows([process.pid, this.cover.pid()]));
    const b = d.bounds;
    const windows = all
      .filter((w) => w.x < b.x + b.width && w.x + w.width > b.x && w.y < b.y + b.height && w.y + w.height > b.y)
      .map((w) => ({ id: w.id, title: w.name || w.owner, app: w.owner, x: w.x - b.x, y: w.y - b.y, width: Math.round(w.width), height: Math.round(w.height) }));
    this.picking = true;
    const win = this.wins.picker;
    win.setBounds(b);
    win.setIgnoreMouseEvents(false);
    win.webContents.send('picker:show', { mode: 'pick', windows, picked: this.setupWindow?.id ?? null });
    win.showInactive();
    win.focus(); // Tab / Return / Esc (non-activating panel)
    this.onSettings(); // the toolbar's chip / source group follow the mode
    this._broadcast();
  }

  pickWindow(w) {
    if (!this.picking) return;
    const b = this._setupDisplay().bounds;
    const bounds = { x: w.x + b.x, y: w.y + b.y, width: w.width, height: w.height };
    this.setupWindow = { id: w.id, sourceId: `window:${w.id}:0`, title: w.title, app: w.app, bounds };
    this.settings.patch({ source: { mode: 'window', windowSourceId: this.setupWindow.sourceId, windowTitle: w.title } });
    this.picking = false;
    this._watchSetupWindow();
    this._showPicked();
    this._syncBubble(); // the bubble moves inside the window (D4)
    this.onSettings(); // the toolbar's chip / source group follow the mode
    this._broadcast();
    this.wins.bar.focus();
  }

  cancelPicker() {
    if (!this.picking) return;
    this.picking = false;
    if (!this.setupWindow) this.settings.patch({ source: { mode: 'display' } });
    this._showPicked();
    this._showCover();
    this.onSettings(); // the toolbar's chip / source group follow the mode
    this._broadcast();
    this.wins.bar.focus();
  }

  chooseFullScreen() {
    this.picking = false;
    this.settings.patch({ source: { mode: 'display' } });
    this._stopWatch();
    this.setupWindow = null;
    this._hidePicker();
    this._showCover();
    this._syncBubble();
    this.onSettings(); // the toolbar's chip / source group follow the mode
    this._broadcast();
  }

  // Picked: the ring stays on the window and a ✓ chip sits outside its top edge (06b).
  // Click-through; follows the window as it moves.
  _showPicked() {
    const win = this.wins.picker;
    const w = this.setupWindow;
    if (!this._inSetup() || this.settings.get().source.mode !== 'window' || !w?.bounds) return this._hidePicker();
    const b = this._setupDisplay().bounds;
    win.setBounds(b);
    win.setIgnoreMouseEvents(true);
    win.webContents.send('picker:show', { mode: 'picked', window: { id: w.id, title: w.title, app: w.app, x: w.bounds.x - b.x, y: w.bounds.y - b.y, width: w.bounds.width, height: w.bounds.height } });
    if (!win.isVisible()) win.showInactive();
  }

  _hidePicker() {
    const win = this.wins.picker;
    if (!win || win.isDestroyed()) return;
    win.webContents.send('picker:hide');
    if (win.isVisible()) win.hide();
  }

  _watchSetupWindow() {
    this._stopWatch();
    const w = this.setupWindow;
    if (!w) return;
    this.winBounds = w.bounds;
    if (this.fakeWindows) return; // dev stand-in: nothing to watch
    this.winWatch = watchWindow(w.sourceId, (b) => {
      if (this.setupWindow !== w) return;
      if (b.missing) {
        // Closed during setup: back to "Pick a window" (Record says why).
        this.setupWindow = null;
        this._stopWatch();
        this.winBounds = null;
        this._showPicked();
        this._syncBubble();
        return this._broadcast();
      }
      const nb = { x: b.x, y: b.y, width: b.width, height: b.height };
      if (['x', 'y', 'width', 'height'].every((k) => w.bounds[k] === nb[k])) return;
      w.bounds = nb;
      this.winBounds = nb;
      this._showPicked();
      if (!this.drag) this._syncBubble();
    });
  }

  // Window mode from last time: the same window if it is still open.
  async _restoreSetupWindow() {
    const st = this.settings.get();
    if (st.source.mode !== 'window' || !st.source.windowSourceId) return;
    if (this.setupWindow?.sourceId === st.source.windowSourceId) {
      this._watchSetupWindow();
      this._showPicked();
      return this._syncBubble();
    }
    const src = await findSource(st.source.windowSourceId).catch(() => null);
    const bounds = src ? await boundsOnce(src.id) : null;
    if (!this._inSetup()) return;
    if (!src || !bounds) {
      this.setupWindow = null;
      return this._broadcast(); // Record: "Pick a window to record."
    }
    this.setupWindow = { id: Number(src.id.split(':')[1]), sourceId: src.id, title: src.name, app: '', bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } };
    this._watchSetupWindow();
    this._showPicked();
    this._syncBubble();
    this._broadcast();
  }

  // ───────── speaker notes (SETUP_V2 §12, S16–S19) ─────────

  // Shown when open, in setup and through the session (countdown → stop). On Windows a
  // PC that failed the capture-exclusion check hides them from Record on (S19).
  _notesVisible() {
    if (!this.settings.get().notes.open) return false;
    if (this.s.state === 'idle') return this._inSetup();
    if (this.s.state === 'finalizing') return false;
    return this.notesAllowed !== false;
  }

  toggleNotes(open = !this.settings.get().notes.open) {
    this.settings.patch({ notes: { open } });
    this.onSettings();
    // Opening from setup puts focus in the text (§12.4).
    this._syncNotes({ focus: open && this._inSetup() });
    if (!open && this.wins.notes) this.wins.notes.webContents.send('notes:flush');
    this._broadcast();
  }

  _syncNotes({ focus = false } = {}) {
    const win = this.wins.notes;
    if (!win || win.isDestroyed()) return;
    const visible = this._notesVisible();
    // ⌥⇧N: only while a session is active and notes are open (S17, D2 lifecycle).
    this.shortcuts.setNotesActive?.(visible && this.s.sessionActive && this.s.state !== 'finalizing');
    if (!visible) {
      this.notesPos = null;
      if (win.isVisible()) win.hide();
      return;
    }
    const st = this.settings.get();
    const all = screen.getAllDisplays();
    const d = notesDisplay(all, this.s.state !== 'idle' ? this.target?.display.id : this.setupDisplayId);
    const sameDisplay = String(this._display().id) === String(d.id);
    const saved = st.notes.pos[String(d.id)] || null;
    const toolbar = sameDisplay && this.wins.bar.isVisible() && this.bar.pos ? { x: this.bar.pos.x, y: this.bar.pos.y, width: this.bar.width, height: BAR_H } : null;
    const avoid = sameDisplay && this._bubbleVisible() ? [this.bubbleRect, this._inSetup() ? this.trayScreen : null] : [];
    const p = this.notesDrag ? this.notesDrag.pos : placeNotes(d.bounds, d.workArea, { saved, toolbar, avoid });
    this.notesPos = p;
    const b = { x: p.x - NOTES_PAD.x, y: p.y - NOTES_PAD.top, width: NOTES_W + 2 * NOTES_PAD.x, height: NOTES_H + NOTES_PAD.top + NOTES_PAD.bottom };
    const cur = win.getBounds();
    if (['x', 'y', 'width', 'height'].some((k) => cur[k] !== b[k])) win.setBounds(b);
    // S18: never focusable while recording, so a click can't take focus from the app being
    // recorded (or grey its title bar on camera). Editable again while paused.
    const focusable = !['countdown', 'recording', 'confirm'].includes(this.s.state);
    if (win.isFocusable() !== focusable) win.setFocusable(focusable);
    if (!win.isVisible()) win.showInactive();
    if (focus) {
      win.focus();
      win.webContents.send('notes:focus');
    }
  }

  // Drag by the top grip (§12.2): free, remembered per display; near the dock it snaps
  // back. Points are window-local (the window moves with the drag).
  notesDragTo({ phase, cx, cy }) {
    const win = this.wins.notes;
    const d = notesDisplay(screen.getAllDisplays(), this.s.state !== 'idle' ? this.target?.display.id : this.setupDisplayId);
    const { x, y } = this._dragPoint(win, cx, cy);
    if (phase === 'start') {
      this.notesDrag = { from: { x, y }, start: { ...this.notesPos }, pos: { ...this.notesPos } };
      return;
    }
    if (!this.notesDrag) return;
    if (x != null) this.notesDrag.pos = { x: this.notesDrag.start.x + x - this.notesDrag.from.x, y: this.notesDrag.start.y + y - this.notesDrag.from.y };
    if (phase === 'end') {
      const drop = dropPos(d.bounds, d.workArea, this.notesDrag.pos);
      this.notesDrag = null;
      this.settings.patch({ notes: { pos: { [String(d.id)]: drop } } });
    }
    this._syncNotes();
  }

  // ⌥⇧N: pause / resume the auto-scroll (the panel owns the scroll).
  toggleNotesScroll() {
    this.wins.notes?.webContents.send('notes:toggleScroll');
  }

  // Windows: may notes stay up while recording? Checked once per PC and build (S19).
  async _checkNotesForRecording() {
    this.notesAllowed = true;
    const st = this.settings.get();
    if (!st.notes.open || process.platform === 'darwin') return;
    const r = await checkPC({ notesWin: this.wins.notes, selfTest: selfTestCapture, cached: st.notes.winCheck }).catch(() => ({ ok: false }));
    if (r.build && !r.cached) this.settings.patch({ notes: { winCheck: { build: r.build, ok: r.ok } } });
    this.notesAllowed = r.ok;
    if (!r.ok) {
      this.log(`notes hidden while recording: ${r.reason}`);
      this._toast({ kind: 'notes', icon: 'warn', title: 'Notes hidden while recording', text: 'this PC can\'t keep them out of the video', sticky: true });
    }
    this._syncNotes();
  }

  // ───────── bubble ─────────

  _bubbleVisible() {
    const st = this.settings.get();
    if (!st.camera.on) return false;
    if (LIVE.has(this.s.state) || this.s.state === 'countdown') return !this.cameraHidden && !this.autoHidden;
    return this._inSetup() && !this._cameraBlocked();
  }

  // Setup = idle with the setup toolbar open. The tray shows only then; it is gone from
  // the countdown on.
  _inSetup() {
    return this.setupOpen && this.s.state === 'idle';
  }

  _cameraBlocked() {
    return ['denied', 'restricted'].includes(this.cameraStatus());
  }

  // The display everything is on: the recorded one in a session, the setup display while
  // setting up, else the one under the pointer.
  _display() {
    const all = screen.getAllDisplays();
    const id = this.target && this.s.state !== 'idle' ? this.target.display.id : this._inSetup() ? this.setupDisplayId : null;
    return (id != null && all.find((x) => String(x.id) === String(id))) || screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }

  _displayArea() {
    return this._display().workArea;
  }

  // Where the bubble may go: anywhere on its display, Dock and menu-bar strips and the
  // toolbar's spot included (Loom). Nothing is reserved for the setup tray (it flips
  // above the bubble at the bottom edge) or the toolbar (it moves aside, _barAvoid).
  // Snapping and the default spot still use the work area's inset lines.
  _bubbleArea() {
    return this._display().bounds;
  }

  _currentDisplayId() {
    return String(this._display().id);
  }

  // Window mode, where the bubble is kept inside the window (D4): while recording a
  // window, and in setup once a window is picked (SETUP_V2 §3.5).
  _windowMode() {
    if (!this.winBounds) return false;
    if (this.s.state !== 'idle') return this.target?.kind === 'window';
    return this._inSetup() && this.settings.get().source.mode === 'window' && !!this.setupWindow;
  }

  // Recomputes the bubble rect from settings + mode, moves the window, informs the engine.
  _syncBubble() {
    const st = this.settings.get();
    const { shape, size, zoom } = st.camera;
    let rect;
    let effSize = size;
    let anchor = null;
    this.autoHidden = false;
    if (this._windowMode()) {
      const r = constrainToWindow(this.winBounds, shape, size, st.bubbleRelWindow || { left: INSET, bottom: INSET });
      if (r.hidden) this.autoHidden = true;
      else {
        rect = { x: r.x, y: r.y, width: r.width, height: r.height };
        effSize = r.size;
      }
    }
    if (!rect && !this.autoHidden) {
      const area = this._bubbleArea();
      const id = this._currentDisplayId();
      const saved = st.bubblePos[id];
      const dims = bubbleSize(shape, size);
      if (saved) {
        // A size or shape change keeps the anchored corner (the one nearest the
        // edges): a bottom-right bubble grows up and left, and stays on screen.
        const prev = { x: saved.x, y: saved.y, width: saved.width ?? dims.width, height: saved.height ?? dims.height };
        anchor = this.resizeAnchor || anchorFor(area, prev);
        rect = resizeAnchored(area, prev, dims, anchor);
      } else rect = defaultBubbleRect(this._displayArea(), shape, size);
      anchor = anchor || anchorFor(area, rect);
      // In setup, what you see is what records: the bubble keeps this spot at Record
      // (the tray going away must not move it), so the setup position is saved.
      if (this._inSetup() && (!saved || saved.x !== rect.x || saved.y !== rect.y || saved.width !== rect.width || saved.height !== rect.height)) {
        this.settings.patch({ bubblePos: { [id]: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } } });
      }
    }
    if (rect) this.bubbleRect = rect;
    const win = this.wins.bubble;
    const visible = this._bubbleVisible();
    // A size preset (tray, ⌘+ / ⌘−) animates from the anchored corner (SETUP_V2 §11.2).
    // For that moment the window spans the old and new rects, so the bubble is not
    // clipped growing or shrinking; the renderer scales it, then the window trims.
    // The corner handle snaps live instead (resizeAnchor set), as does a shape change.
    const prevLook = this.setupLook;
    const animate = rect && visible && this._inSetup() && !this.resizeAnchor && prevLook?.shape === shape && prevLook.size !== effSize;
    const frame = animate ? unionRect(prevLook.rect, rect) : rect;
    this.setupLook = rect && this._inSetup() ? { shape, size: effSize, rect } : null;
    clearTimeout(this.sizeAnim);
    this.sizeAnim = animate ? setTimeout(() => ((this.sizeAnim = null), this._syncBubble()), 200) : null;
    if (frame) win.setBounds({ x: frame.x - BUBBLE_PAD, y: frame.y - BUBBLE_PAD, width: frame.width + 2 * BUBBLE_PAD, height: frame.height + 2 * BUBBLE_PAD });
    win.webContents.send('bubble:state', {
      visible,
      shape,
      size: effSize,
      chosenSize: size,
      zoom,
      deviceId: st.camera.deviceId,
      width: rect?.width,
      height: rect?.height,
      rect,
      offset: frame && rect ? { x: rect.x - frame.x, y: rect.y - frame.y } : { x: 0, y: 0 },
      animFrom: animate ? { width: prevLook.rect.width, height: prevLook.rect.height } : null,
      anchor: anchor || (rect ? anchorFor(this._bubbleArea(), rect) : null),
      setup: this._inSetup(),
      live: this.s.state !== 'idle',
      focusable: this.s.state === 'idle',
      background: st.camera.background,
      bgImage: st.camera.bgImage,
      tag: false, // the tray shows the background now; 'paused' / loading still tag the bubble
    });
    if (visible && !win.isVisible()) win.showInactive();
    if (!visible && win.isVisible()) win.hide();
    if (!visible) this.drag = null; // a press never survives the bubble hiding (LC-9)
    this._syncTray();
    if (this.s.state !== 'idle' && this.prepared !== undefined) this._engine('bubble', this._bubbleForEngine()).catch(() => {});
    if (this.s.state !== 'idle') this._broadcast();
  }

  // ───────── bubble tray (setup v2) ─────────

  // Tray under the bubble during setup; "Camera off · Turn on" (or blocked) pill at
  // the bubble's anchored corner when the camera is off. Hidden otherwise.
  _syncTray() {
    const t = this.wins.camtray;
    if (!t || t.isDestroyed()) return;
    const st = this.settings.get();
    const rect = this.bubbleRect;
    if (!this._inSetup() || !rect) {
      this.trayScreen = null;
      t.webContents.send('camtray:state', { visible: false });
      if (t.isVisible()) t.hide();
      return;
    }
    const full = this._displayArea();
    const mode = !st.camera.on ? 'off' : this._cameraBlocked() ? 'blocked' : 'tray';
    let box;
    if (mode === 'tray') box = trayRect(full, rect, Math.max(rect.width, this.trayBox.minW), this.trayBox.height);
    else {
      const a = anchorFor(this._bubbleArea(), rect);
      const w = this.trayBox.pillW;
      box = { x: a.h === 'left' ? rect.x : rect.x + rect.width - w, y: a.v === 'bottom' ? rect.y + rect.height - 48 : rect.y, width: w, height: 48 };
    }
    const right = full.x + full.width - (box.x + box.width);
    const popSide = right >= 288 + 12 + 8 || right >= box.x - full.x ? 'right' : 'left';
    const db = screen.getDisplayMatching(rect).bounds;
    const cur = t.getBounds();
    if (['x', 'y', 'width', 'height'].some((k) => cur[k] !== db[k])) t.setBounds(db);
    const sizeFits = sizesThatFit(this._bubbleArea(), st.camera.shape);
    this.trayScreen = box;
    // animate: the bubble is mid preset animation, so the tray glides with it (160 ms)
    // instead of jumping; drags and everything else move it instantly.
    t.webContents.send('camtray:state', { visible: true, mode, x: box.x - db.x, y: box.y - db.y, width: box.width, popSide, sizeFits, animate: !!this.sizeAnim, camera: this.cameraStatus(), camDims: this.camDims });
    if (!t.isVisible()) t.showInactive();
    this._syncBar(); // the toolbar keeps 16 pt clear of bubble + tray (S15)
  }

  // The tray renderer measured itself (rows, fonts): re-place bubble + tray.
  traySize({ height, pillW, minW }) {
    const next = { height: Math.round(height) || this.trayBox.height, pillW: Math.round(pillW) || this.trayBox.pillW, minW: Math.max(TRAY_MIN_W, Math.ceil(minW) || this.trayBox.minW) };
    if (next.height === this.trayBox.height && next.pillW === this.trayBox.pillW && next.minW === this.trayBox.minW) return;
    this.trayBox = next;
    this._syncBubble();
  }

  // ⌘+ / ⌘− with the bubble focused (SETUP_V2 §11.2): the next preset that fits.
  stepSize(dir) {
    if (!this._inSetup()) return false;
    const { shape, size } = this.settings.get().camera;
    const fits = sizesThatFit(this._bubbleArea(), shape);
    let i = SIZES.indexOf(size) + dir;
    while (i >= 0 && i < SIZES.length && !fits[SIZES[i]]) i += dir;
    if (i < 0 || i >= SIZES.length) return false;
    this.settings.patch({ camera: { size: SIZES[i] } });
    this._syncBubble();
    return true;
  }

  // Corner handle (SETUP_V2 §3.2, S12): snaps to S/M/L/XL; the anchored corner is
  // locked for the whole gesture so the bubble can't flip direction mid-drag.
  bubbleResize({ phase, size }) {
    if (phase === 'start') {
      if (this.bubbleRect) this.resizeAnchor = anchorFor(this._bubbleArea(), this.bubbleRect);
      return false;
    }
    let changed = false;
    if (size && SIZES.includes(size) && size !== this.settings.get().camera.size) {
      this.settings.patch({ camera: { size } });
      changed = true;
    }
    if (phase === 'end') this.resizeAnchor = null;
    if (changed || phase === 'end') this._syncBubble();
    return changed;
  }

  _bubbleForEngine() {
    const st = this.settings.get();
    const capture = this.target.kind === 'window' ? this.winBounds : this.target.display.bounds;
    return {
      hidden: !st.camera.on || this.cameraHidden || this.autoHidden || !this.bubbleRect,
      rect: this.bubbleRect,
      capture,
      shape: st.camera.shape,
      zoom: st.camera.zoom,
      background: st.camera.background,
      bgImage: st.camera.bgImage,
    };
  }

  bubbleDrag({ phase, x, y }) {
    if (phase === 'start') {
      if (!this.bubbleRect) return;
      this.drag = { px: x, py: y, rect: { ...this.bubbleRect } };
      return;
    }
    if (!this.drag) return;
    const r = { ...this.drag.rect, x: this.drag.rect.x + x - this.drag.px, y: this.drag.rect.y + y - this.drag.py };
    this._moveBubble(r, phase === 'end');
    if (phase === 'end') this.drag = null;
  }

  bubbleNudge({ dx, dy }) {
    if (!this.bubbleRect) return;
    this._moveBubble({ ...this.bubbleRect, x: this.bubbleRect.x + dx, y: this.bubbleRect.y + dy }, true, false);
  }

  _moveBubble(r, commit, snap = true) {
    if (this.sizeAnim) {
      // a drag cut a preset animation short: settle the window on the new size first
      clearTimeout(this.sizeAnim);
      this.sizeAnim = null;
      this._syncBubble();
    }
    const windowMode = this._windowMode();
    const area = windowMode
      ? { x: this.winBounds.x + INSET, y: this.winBounds.y + INSET, width: this.winBounds.width - 2 * INSET, height: this.winBounds.height - 2 * INSET }
      : this._bubbleArea();
    let rect = clampRect(area, r);
    let guides = {};
    if (snap && !windowMode) ({ rect, guides } = snapRect(this._displayArea(), rect));
    this.bubbleRect = rect;
    this.wins.bubble.setPosition(rect.x - BUBBLE_PAD, rect.y - BUBBLE_PAD);
    this.wins.bubble.webContents.send('bubble:guides', commit ? {} : guides);
    if (this._inSetup()) this._syncTray(); // the tray follows the bubble
    if (this.s.state !== 'idle') this._engine('bubble', this._bubbleForEngine()).catch(() => {});
    if (commit) {
      if (windowMode) this.settings.patch({ bubbleRelWindow: relToWindow(this.winBounds, rect) });
      else this.settings.patch({ bubblePos: { [this._currentDisplayId()]: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } } });
      if (this._inSetup()) this._syncBubble(); // anchor (handle corner) may have changed
    }
  }

  // ───────── window mode ─────────

  _watchWindow() {
    this._stopWatch();
    this.winBounds = this.target.bounds;
    this.winWatch = watchWindow(this.target.source.id, (b) => {
      if (b.missing) return; // the capture track ending is the authoritative "closed" signal
      const nb = { x: b.x, y: b.y, width: b.width, height: b.height };
      if (this.winBounds && ['x', 'y', 'width', 'height'].every((k) => this.winBounds[k] === nb[k])) return;
      this.winBounds = nb;
      if (this.s.state !== 'idle' && !this.drag) this._syncBubble();
    });
  }

  _stopWatch() {
    this.winWatch?.stop();
    this.winWatch = null;
  }

  // ───────── after-stop popup ─────────

  async _showPopup(data) {
    this.popupData = data;
    const win = this.wins.popup;
    win.webContents.send('popup:show', { ...data, libraryDir: this.settings.get().libraryDir });
    if (!win.isVisible()) {
      const d = this.target ? screen.getAllDisplays().find((x) => String(x.id) === this.target.display.id) || screen.getPrimaryDisplay() : screen.getPrimaryDisplay();
      const wa = d.workArea;
      const [w, h] = win.getSize();
      win.setPosition(wa.x + wa.width - w - 8, wa.y + wa.height - h - 8);
      win.showInactive();
    }
    win.focus();
  }

  placePopup(height) {
    const win = this.wins.popup;
    const [x, y] = win.getPosition();
    const [w, h] = win.getSize();
    win.setBounds({ x, y: y + h - height, width: w, height });
  }

  async dismissPopup({ commit }) {
    if (this.popupDelete) {
      const t = this.popupDelete;
      this.popupDelete = null;
      if (commit) await this.pending.commit(t).catch((e) => this.log(`trash failed: ${e.message}`));
    }
    if (this.wins.popup.isVisible()) {
      this.wins.popup.webContents.send('popup:hide');
      this.wins.popup.hide();
    }
    this.popupData = null;
  }

  async popupDeleteFile(file) {
    this.popupDelete = await this.pending.remove(file);
    return true;
  }

  async popupUndo() {
    if (!this.popupDelete) return null;
    const restored = await this.pending.undo(this.popupDelete);
    this.popupDelete = null;
    return restored ? this.library.entry(restored) : null;
  }

  reveal(file) {
    shell.showItemInFolder(file);
  }

  open(file) {
    return shell.openPath(file);
  }

  base(file) {
    return splitExt(path.basename(file));
  }
}

function unionRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
