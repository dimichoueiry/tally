// May speaker notes stay on screen while recording? (SETUP_V2 §12.6, S19)
// Mac: yes. The panel is content-protected (NSWindowSharingNone) before its first show.
// Windows: only if this PC passed the check, else notes work in setup but hide at Record
// with a notice. It fails closed: anything unknown means "hide". There is no override.
//   1. Windows 10 2004 (build 19041) or later: older builds fall back to WDA_MONITOR,
//      which records a black box where the panel is.
//   2. The affinity reads back as WDA_EXCLUDEFROMCAPTURE (the call can fail silently).
//   3. A one-time self-test capture does not contain a protected test window.
// The probes are injected (this file is unit-tested on a Mac; nothing here ran on Windows).
import os from 'node:os';
import { execFile } from 'node:child_process';

export const MIN_BUILD = 19041;
export const WDA_EXCLUDEFROMCAPTURE = 0x11;
export const NOTICE = 'Notes hidden while recording · this PC can\'t keep them out of the video';

export function decide({ platform, build, affinity, selfTest }) {
  if (platform === 'darwin') return { ok: true, reason: null };
  if (platform !== 'win32') return { ok: false, reason: 'unsupported' };
  if (!(Number(build) >= MIN_BUILD)) return { ok: false, reason: 'old-windows' };
  if (affinity !== WDA_EXCLUDEFROMCAPTURE) return { ok: false, reason: 'affinity' };
  if (selfTest !== true) return { ok: false, reason: 'self-test' };
  return { ok: true, reason: null };
}

// "10.0.19045" → 19045 (os.release() on Windows).
export function windowsBuild(release = os.release()) {
  const m = /^\d+\.\d+\.(\d+)/.exec(String(release));
  return m ? Number(m[1]) : null;
}

// HWND from Electron's getNativeWindowHandle() Buffer (pointer-sized, little endian).
export function hwndOf(buf) {
  if (!buf?.length) return null;
  return buf.length >= 8 ? buf.readBigUInt64LE(0).toString() : String(buf.readUInt32LE(0));
}

// GetWindowDisplayAffinity via PowerShell P/Invoke: no native module needed. Prints the
// affinity as a decimal number, or nothing if the call failed.
export function affinityScript(hwnd) {
  return [
    "$ErrorActionPreference='Stop'",
    "Add-Type -Namespace TallyW -Name U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool GetWindowDisplayAffinity(IntPtr h, out uint a);'",
    '$a = [uint32]0',
    `if ([TallyW.U]::GetWindowDisplayAffinity([IntPtr]::new([Int64]${hwnd}), [ref]$a)) { $a }`,
  ].join('; ');
}

export function parseAffinity(stdout) {
  const v = String(stdout ?? '').trim();
  return /^\d+$/.test(v) ? Number(v) : null;
}

export function readAffinity(win, run = execFile) {
  const hwnd = hwndOf(win.getNativeWindowHandle());
  if (!hwnd) return Promise.resolve(null);
  return new Promise((resolve) =>
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', affinityScript(hwnd)], { timeout: 8000, windowsHide: true }, (err, out) => resolve(err ? null : parseAffinity(out))),
  );
}

// Self-test: is the marker colour visible in the capture inside `rect`? (RGBA bytes,
// row stride = width * 4.) The marker is a protected window filled with MARKER.
export const MARKER = [255, 0, 255];
export function markerVisible(rgba, width, rect, tolerance = 24) {
  let hits = 0;
  let total = 0;
  for (let y = rect.y + 2; y < rect.y + rect.height - 2; y += 2) {
    for (let x = rect.x + 2; x < rect.x + rect.width - 2; x += 2) {
      const i = (y * width + x) * 4;
      total++;
      if (Math.abs(rgba[i] - MARKER[0]) <= tolerance && Math.abs(rgba[i + 1] - MARKER[1]) <= tolerance && Math.abs(rgba[i + 2] - MARKER[2]) <= tolerance) hits++;
    }
  }
  return total > 0 && hits / total > 0.2;
}

// The whole check, once per PC (the result is remembered with the build it ran on).
// `deps`: { platform, release, notesWin, selfTest: () => Promise<boolean> }.
export async function checkPC({ platform = process.platform, release = os.release(), notesWin, selfTest, cached } = {}) {
  if (platform !== 'win32') return decide({ platform });
  const build = windowsBuild(release);
  if (cached && cached.build === build && cached.ok) return { ok: true, reason: null, build, cached: true };
  const affinity = notesWin ? await readAffinity(notesWin).catch(() => null) : null;
  const self = build >= MIN_BUILD && affinity === WDA_EXCLUDEFROMCAPTURE && selfTest ? await selfTest().catch(() => false) : false;
  return { ...decide({ platform, build, affinity, selfTest: self }), build };
}
