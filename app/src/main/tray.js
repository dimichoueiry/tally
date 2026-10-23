// Menu-bar / tray icon (SETUP_V2 §2): outline mark when idle, filled while setup is open;
// red lens + elapsed time while recording (clicking stops); amber lens while paused.
// Left-click toggles setup; right-click (Ctrl-click) opens a small native menu.
import { Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import { ROOT } from './protocol.js';

const icon = (name) => {
  const img = nativeImage.createFromPath(path.join(ROOT, 'resources', 'icons', `${name}.png`));
  if (name.endsWith('Template')) img.setTemplateImage(true);
  return img;
};

const mmss = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export class TallyTray {
  constructor(onClick, menu = []) {
    this.tray = new Tray(icon('trayTemplate'));
    this.tray.setToolTip('Tally');
    this.tray.on('click', onClick);
    // Works without opening setup: New recording ⌥⇧R · Recordings… · Settings… · Quit.
    const ctx = Menu.buildFromTemplate(menu);
    this.tray.on('right-click', () => this.tray.popUpContextMenu(ctx));
    this.setupOpen = false;
    this.snap = null;
    this.timer = null;
    this.mode = null;
  }

  bounds() {
    return this.tray.getBounds();
  }

  setSetupOpen(open) {
    this.setupOpen = open;
    if (this.snap) this.update(this.snap);
  }

  update(snap) {
    this.snap = snap;
    const live = ['recording', 'paused', 'confirm'].includes(snap.state);
    const mode = !live ? (this.setupOpen ? 'setup' : 'idle') : snap.state === 'recording' ? 'live' : 'paused';
    if (mode !== this.mode) {
      this.mode = mode;
      this.tray.setImage(icon({ idle: 'trayTemplate', setup: 'trayOnTemplate', live: 'trayLive', paused: 'trayPaused' }[mode]));
    }
    clearInterval(this.timer);
    if (!live) {
      this.tray.setTitle('');
      this.tray.setToolTip('Tally, not recording');
      return;
    }
    const render = () => {
      const ms = snap.elapsedMs + (snap.state === 'recording' ? Date.now() - snap.at : 0);
      this.tray.setTitle(` ${mmss(ms)}`, { fontType: 'monospacedDigit' });
      this.tray.setToolTip(`Tally, ${snap.state === 'recording' ? 'recording' : 'paused'}, ${mmss(ms)}, click to stop`);
    };
    render();
    if (snap.state === 'recording') this.timer = setInterval(render, 500);
  }
}
