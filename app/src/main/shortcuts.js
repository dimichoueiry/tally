// Global shortcut lifecycle (spec §4, D2). ⌥⇧R is registered from launch to quit;
// ⌥⇧P/Z/X/C only while a recording session is active; ⌥⇧N (pause / resume the notes
// scroll, SETUP_V2 S17) only while a session is active and the notes panel is open. `gs` is Electron's
// globalShortcut, injected so the lifecycle can be unit-tested.

export const PRIMARY = 'Alt+Shift+R';
export const SESSION = { pause: 'Alt+Shift+P', restart: 'Alt+Shift+Z', cancel: 'Alt+Shift+X', camera: 'Alt+Shift+C' };
export const NOTES = 'Alt+Shift+N';

export class Shortcuts {
  constructor(gs, handlers, onFailure = () => {}) {
    this.gs = gs;
    this.handlers = handlers;
    this.onFailure = onFailure;
    this.sessionOn = false;
    this.notesOn = false;
    this.failed = new Set();
  }

  _register(accel, fn) {
    let ok = false;
    try {
      ok = this.gs.register(accel, fn);
    } catch {
      ok = false;
    }
    if (!ok) {
      this.failed.add(accel);
      this.onFailure(accel);
    } else this.failed.delete(accel);
    return ok;
  }

  registerPrimary() {
    return this._register(PRIMARY, this.handlers.primary);
  }

  setSessionActive(on) {
    if (on === this.sessionOn) return;
    this.sessionOn = on;
    for (const [name, accel] of Object.entries(SESSION)) {
      if (on) this._register(accel, this.handlers[name]);
      else if (this.gs.isRegistered(accel)) this.gs.unregister(accel);
    }
  }

  // `on` = session active && notes open. Same lifecycle rule as P/Z/X/C.
  setNotesActive(on) {
    if (on === this.notesOn || !this.handlers.notes) return;
    this.notesOn = on;
    if (on) this._register(NOTES, this.handlers.notes);
    else if (this.gs.isRegistered(NOTES)) this.gs.unregister(NOTES);
  }

  dispose() {
    this.setNotesActive(false);
    this.setSessionActive(false);
    if (this.gs.isRegistered(PRIMARY)) this.gs.unregister(PRIMARY);
  }
}
