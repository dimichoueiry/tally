// Capture sources for the picker. Callers must check screenStatus() first:
// getSources hangs when Screen Recording is denied.
import { desktopCapturer, screen, BrowserWindow } from 'electron';
import { owners } from './winbounds.js';

const ownIds = () => new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()));

export function displayInfo(d) {
  const px = `${Math.round(d.size.width * d.scaleFactor)}×${Math.round(d.size.height * d.scaleFactor)}`;
  return { id: String(d.id), label: d.label || 'Display', name: /built-?in/i.test(d.label || '') ? 'Built-in' : d.label || 'Display', px, bounds: d.bounds, workArea: d.workArea, scale: d.scaleFactor };
}

export async function listSources({ thumbs = true } = {}) {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: thumbs ? { width: 320, height: 200 } : { width: 0, height: 0 },
    fetchWindowIcons: thumbs,
  });
  const mine = ownIds();
  const displays = screen.getAllDisplays().map(displayInfo);
  const screens = sources
    .filter((s) => s.id.startsWith('screen:'))
    .map((s) => {
      const d = displays.find((x) => x.id === s.display_id) || displays[0];
      return { sourceId: s.id, ...d, thumb: thumbs ? s.thumbnail.toDataURL() : null };
    });
  let windows = sources.filter((s) => s.id.startsWith('window:') && !mine.has(s.id) && s.name && (!thumbs || !s.thumbnail.isEmpty()));
  const own = await owners(windows.map((w) => w.id));
  windows = windows
    .map((s) => ({
      sourceId: s.id,
      title: s.name,
      app: own[s.id.split(':')[1]]?.owner || '',
      thumb: thumbs ? s.thumbnail.resize({ width: 112 }).toDataURL() : null,
      icon: thumbs && s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.resize({ width: 28 }).toDataURL() : null,
    }))
    .filter((w) => w.app !== 'Tally' && w.app !== 'Electron');
  return { screens, windows };
}

export async function findSource(sourceId) {
  const sources = await desktopCapturer.getSources({ types: [sourceId.startsWith('screen:') ? 'screen' : 'window'], thumbnailSize: { width: 0, height: 0 } });
  return sources.find((s) => s.id === sourceId) || null;
}

export async function screenSourceForDisplay(displayId) {
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  return sources.find((s) => s.display_id === String(displayId)) || sources[0] || null;
}

export function displayUnderPointer() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}
