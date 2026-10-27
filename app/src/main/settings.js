// Persisted preferences: userData/settings.json. Small, synchronous, merged with defaults.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const DEFAULTS = {
  source: { mode: 'display', displayId: null, windowSourceId: null, windowTitle: null },
  camera: { on: true, deviceId: null, deviceLabel: null, shape: 'circle', size: 'S', zoom: 1, background: 'none', bgImage: 'builtin:studio', follow: false, mirror: true },
  // camera.follow: crop tracks the face (off by default: it can jitter). camera.mirror:
  // preview and recording are both flipped like a mirror (on, as before in the preview).
  backgrounds: [], // user-chosen background images: file names in userData/media/backgrounds
  // image: file name in userData/media/covers. privacy: 'standard' | 'semi' | 'very' (Full
  // screen only, src/shared/privacy.js); keep: what Semi-private still shows, 'dock' | 'menubar'.
  cleanDesktop: { on: false, cover: 'graphite', image: null, privacy: 'standard', keep: 'dock' },
  systemAudio: false, // off by default (spec §3.1)
  // Optional microphone, off by default. The device is remembered by id, with the label
  // as the fallback when the id changes (shared/mic.js pickMic).
  mic: { on: false, deviceId: null, deviceLabel: null },
  quality: { size: '1080p', fps: 30 },
  bubblePos: {}, // displayId → { x, y } (top-left of the bubble, screen pt)
  bubbleRelWindow: null, // { left, bottom } offset inside the recorded window
  barPos: {}, // v1 only (unused since setup v2: the toolbar and bar share toolbar.pos)
  // Setup toolbar / recording bar (SETUP_V2 §15): one fold preference for both, and the
  // pill's top-left per display (absent = home, bottom-centre).
  // collapsed: the minimal pill (grip · expand · Record, or Stop / Pause / Restart), kept
  // until expanded; it sits on top of the fold state, which expanding restores.
  toolbar: { unfolded: false, collapsed: false, pos: {} },
  // Speaker notes (SETUP_V2 §12.5): open/closed, position per display (absent = docked),
  // text size, auto-scroll on/off and speed, scroll position (0–1). The script itself is
  // userData/notes.txt. winCheck: the Windows capture-exclusion result (S19), per build.
  notes: { open: false, pos: {}, fontSize: 24, auto: false, wpm: 140, scroll: 0, winCheck: null },
  recordingsMade: 0,
  libraryDir: process.platform === 'win32' ? path.join(os.homedir(), 'Videos', 'Tally') : path.join(os.homedir(), 'Movies', 'Tally'),
};

export class Settings {
  constructor(file) {
    this.file = file;
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    this.data = merge(structuredClone(DEFAULTS), saved);
  }

  get() {
    return this.data;
  }

  patch(partial) {
    this.data = merge(this.data, partial);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    return this.data;
  }
}

function merge(base, extra) {
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) base[k] = merge({ ...base[k] }, v);
    else base[k] = v;
  }
  return base;
}
