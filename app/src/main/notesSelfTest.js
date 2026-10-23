// Windows only (SETUP_V2 §12.6, S19): the one-time self-test capture. A small
// content-protected window filled with the marker colour sits in a corner of the primary
// display for a moment; a capture of that display must not contain it. Magenta is the
// same in RGBA and BGRA, so the bitmap's channel order doesn't matter.
// Never runs on a Mac (protection there is verified separately); untested on Windows.
import { BrowserWindow, desktopCapturer, screen } from 'electron';
import { MARKER, markerVisible } from './notesGuard.js';

export async function selfTestCapture() {
  const d = screen.getPrimaryDisplay();
  const size = 64;
  const at = { x: d.bounds.x + 8, y: d.bounds.y + d.bounds.height - size - 8 };
  const win = new BrowserWindow({ ...at, width: size, height: size, frame: false, show: false, focusable: false, skipTaskbar: true, resizable: false, alwaysOnTop: true, backgroundColor: `#${MARKER.map((c) => c.toString(16).padStart(2, '0')).join('')}` });
  try {
    win.setContentProtection(true);
    win.showInactive();
    await new Promise((r) => setTimeout(r, 400));
    const s = d.scaleFactor;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.size.width * s), height: Math.round(d.size.height * s) } });
    const src = sources.find((x) => String(x.display_id) === String(d.id)) || sources[0];
    if (!src) return false;
    const img = src.thumbnail;
    const { width, height } = img.getSize();
    if (!width || !height) return false;
    const k = width / d.size.width;
    const rect = { x: Math.round((at.x - d.bounds.x) * k), y: Math.round((at.y - d.bounds.y) * k), width: Math.round(size * k), height: Math.round(size * k) };
    return !markerVisible(img.toBitmap(), width, rect); // passed = the protected window is absent
  } finally {
    win.destroy();
  }
}
