// Bounds of another app's window, from the native helper (macOS). Other platforms:
// no provider yet, so callers fall back to placing the bubble inside the capture.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, unpacked } from './protocol.js';

const BIN = unpacked(path.join(ROOT, 'native', 'bin', 'winbounds'));
export const available = () => process.platform === 'darwin' && fs.existsSync(BIN);

// "window:12345:0" → 12345
export const windowIdOf = (sourceId) => Number(String(sourceId).split(':')[1]);

export function watchWindow(sourceId, onBounds) {
  if (!available()) return { stop() {} };
  const child = spawn(BIN, ['--watch', String(windowIdOf(sourceId))], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        onBounds(JSON.parse(line));
      } catch {}
    }
  });
  return { stop: () => { child.stdin.end(); child.kill(); } };
}

export function owners(sourceIds) {
  if (!available() || !sourceIds.length) return Promise.resolve({});
  return new Promise((resolve) =>
    execFile(BIN, ['--owners', ...sourceIds.map(windowIdOf).map(String)], (err, out) => {
      try {
        resolve(err ? {} : JSON.parse(out));
      } catch {
        resolve({});
      }
    }),
  );
}

export function boundsOnce(sourceId) {
  return new Promise((resolve) => {
    const w = watchWindow(sourceId, (b) => {
      w.stop();
      resolve(b.missing ? null : b);
    });
    if (!available()) resolve(null);
    setTimeout(() => { w.stop(); resolve(null); }, 1500);
  });
}

// On-screen app windows, front to back (SETUP_V2 §3.5 window picker). `skip`: pids
// whose windows can't be picked (Tally itself, the cover helper).
export function listWindows(skip = []) {
  if (!available()) return Promise.resolve([]);
  return new Promise((resolve) =>
    execFile(BIN, ['--list', skip.filter(Boolean).join(',')], (err, out) => {
      try {
        resolve(err ? [] : JSON.parse(out));
      } catch {
        resolve([]);
      }
    }),
  );
}
