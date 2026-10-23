// Clean desktop (spec §3.1, ARCHITECTURE §6.1): a native helper draws a cover over the
// desktop icons and widgets of the recorded display, below every app window. It shows
// from the countdown until stop / cancel, and exits on its own if Tally dies (stdin EOF).
// macOS only for now; Windows has the same contract but no helper yet (available() = false).
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { SANDBOX } from './sandbox.js';
import { hiddenParts, parseDock, maskRects } from '../shared/privacy.js';
const ROOT = path.resolve(import.meta.dirname, '..', '..');
// Packaged: the helper is unpacked next to app.asar (it can't run from inside it).
const BIN = path.join(ROOT, 'native', 'bin', 'cover').replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);

export const COVERS = {
  glow: { label: 'Glow', color: '111615', glow: '2d4a41,111615' },
  deepblue: { label: 'Night', color: '14233a' }, // id kept from v1 ("Deep blue")
  fog: { label: 'Fog', color: 'd9dedb' },
  graphite: { label: 'Graphite', color: '1d2420' },
  black: { label: 'Black', color: '000000' },
  wallpaper: { label: 'Current wallpaper' },
  image: { label: 'Image' },
};

// Helper arguments for a cover setting. Pure (unit-tested).
export function coverArgs(displayId, { cover = 'graphite', image = null } = {}) {
  const args = ['--display', String(displayId ?? 'all')];
  const base = COVERS[cover]?.color || COVERS.graphite.color;
  args.push('--color', cover === 'wallpaper' || cover === 'image' ? COVERS.graphite.color : base);
  if (COVERS[cover]?.glow) args.push('--glow', COVERS[cover].glow);
  if (cover === 'wallpaper') args.push('--wallpaper');
  if (cover === 'image' && image) args.push('--image', image);
  return args;
}

export class CleanDesktop {
  constructor(log = () => {}) {
    this.log = log;
    this.child = null;
    this.key = null;
  }

  available() {
    return process.platform === 'darwin' && fs.existsSync(BIN);
  }

  pid() {
    return this.child?.pid ?? null;
  }

  // Resolves when the cover is on screen (or after 2 s, never blocking a recording).
  show(displayId, cover) {
    if (!this.available()) return Promise.resolve(false);
    const args = coverArgs(displayId, cover);
    const key = args.join(' ');
    if (SANDBOX) {
      // A test instance never paints the real desktop: remember what would show.
      if (this.key !== key) this.log(`clean desktop (sandbox, not drawn): ${key}`);
      this.key = key;
      return Promise.resolve(true);
    }
    if (this.child && this.key === key) return this.ready;
    this.hide();
    const child = spawn(BIN, args, { stdio: ['pipe', 'pipe', 'ignore'] });
    this.child = child;
    this.key = key;
    this.ready = new Promise((resolve) => {
      const t = setTimeout(() => resolve(false), 2000);
      child.stdout.on('data', (d) => {
        const line = String(d).trim();
        if (!line.startsWith('COVER_UP')) return;
        clearTimeout(t);
        this.log(`clean desktop: ${line}`);
        resolve(true);
      });
      child.on('exit', () => {
        clearTimeout(t);
        resolve(false);
        if (this.child === child) this.child = null;
      });
    });
    return this.ready;
  }

  hide() {
    if (SANDBOX && this.key) this.log('clean desktop (sandbox): hidden');
    if (SANDBOX) this.key = null;
    if (!this.child) return;
    const c = this.child;
    this.child = null;
    this.key = null;
    c.stdin.end(); // EOF → the helper exits
    setTimeout(() => c.exitCode == null && c.kill(), 1000);
  }

  isUp() {
    return !!this.child || (SANDBOX && !!this.key);
  }

  // Privacy levels (Full screen only): the strips to paint over in each recorded frame and
  // what to paint them with (the cover's look, or the wallpaper when the cover is off).
  // Null at Standard or when nothing applies. The fill stays in memory (engine canvas).
  async privacyMask(display, cd, imageFile = null) {
    const parts = hiddenParts(cd);
    if (!this.available() || (!parts.menuBar && !parts.dock)) return null;
    const read = (args) => new Promise((resolve) => execFile('/usr/bin/defaults', ['read', ...args], { timeout: 2000 }, (err, out) => resolve(err ? '' : String(out))));
    const [dock, hideBar] = await Promise.all([read(['com.apple.dock']), read(['NSGlobalDomain', '_HIHideMenuBar'])]);
    // A sandbox never reads the wallpaper (TALLY_DEV_WALLPAPER=1 allows it for the strip test).
    const look = cd.on ? cd.cover : 'wallpaper';
    const safe = !SANDBOX || process.env.TALLY_DEV_WALLPAPER === '1' || look !== 'wallpaper';
    const args = coverArgs(display.id, safe ? { cover: look, image: imageFile } : { cover: 'graphite' }).slice(2);
    const width = Math.min(3840, Math.round(display.bounds.width * Math.min(display.scale || 1, 2)));
    const out = await new Promise((resolve) =>
      execFile(BIN, ['--fill', String(display.id), String(width), ...args], { maxBuffer: 32 << 20, timeout: 5000 }, (err, o) => resolve(err ? '' : String(o))),
    );
    const fill = out.split('\n').find((l) => l.startsWith('data:image/')) || null;
    const safeTop = +(out.match(/^SAFE_TOP ([\d.]+)/m)?.[1] || 0);
    const rects = maskRects(display, parseDock(dock), parts, { menuBarAutohide: hideBar.trim() === '1', safeTop });
    if (!rects.length || !fill) return null;
    return { rects, size: { width: display.bounds.width, height: display.bounds.height }, fill };
  }

  // Small preview of the display's wallpaper for the swatch. Data URL in memory only.
  wallpaperThumb(displayId) {
    if (!this.available()) return Promise.resolve(null);
    return new Promise((resolve) =>
      execFile(BIN, ['--thumb', String(displayId), '96'], { maxBuffer: 1 << 20, timeout: 3000 }, (err, out) => {
        const s = String(out || '').trim();
        resolve(!err && s.startsWith('data:image/') ? s : null);
      }),
    );
  }
}
