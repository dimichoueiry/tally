// app://tally/… serves the renderer, shared modules and bundled assets. A custom
// scheme gives ES modules and fetch() (MediaPipe needs it; file:// blocks it).
import { protocol, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
// Executables can't run from inside app.asar: the packaged build unpacks native/bin
// (electron-builder asarUnpack) next to it, in app.asar.unpacked.
export const unpacked = (p) => p.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`);
// Files the user picked (background / cover images) are copied here, inside the app's own data.
export const userMediaDir = () => path.join(app.getPath('userData'), 'media');
const MOUNTS = {
  renderer: () => path.join(ROOT, 'src', 'renderer'),
  shared: () => path.join(ROOT, 'src', 'shared'),
  mediapipe: () => path.join(ROOT, 'resources', 'vendor', 'mediapipe'), // scripts/vendor.mjs
  models: () => path.join(ROOT, 'resources', 'models'),
  user: userMediaDir,
};
const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.wasm': 'application/wasm', '.tflite': 'application/octet-stream', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.txt': 'text/plain',
};

export function registerScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
}

export function handleProtocol() {
  protocol.handle('app', async (req) => {
    const { pathname } = new URL(req.url);
    const [, mount, ...rest] = decodeURIComponent(pathname).split('/');
    const base = MOUNTS[mount]?.();
    if (!base) return new Response('not found', { status: 404 });
    const file = path.normalize(path.join(base, ...rest));
    if (!file.startsWith(base + path.sep)) return new Response('forbidden', { status: 403 });
    // Read directly (not net.fetch of file://, which the network guard would see).
    // Streaming WASM compile needs application/wasm.
    try {
      const body = await fs.promises.readFile(file);
      return new Response(body, { headers: { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

export const pageUrl = (name) => `app://tally/renderer/${name}/index.html`;
