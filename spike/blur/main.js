// LC-6 blur spike. Throwaway. Serves this folder over app:// (fetch works, file:// would not),
// blocks every network request (proves the models/wasm are fully bundled), video-only camera.
const { app, BrowserWindow, protocol, session, ipcMain, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const BENCH = process.argv.includes('--bench');
const COMPARE = process.argv.includes('--compare');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

app.whenReady().then(async () => {
  protocol.handle('app', async (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
    const file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) return new Response('no', { status: 403 });
    try {
      const body = await fs.promises.readFile(file);
      return new Response(body, { headers: { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' } });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });

  const blocked = [];
  session.defaultSession.webRequest.onBeforeRequest((d, cb) => {
    const ok = /^(app|devtools|data|blob|chrome-extension):/.test(d.url);
    if (!ok) blocked.push(d.url);
    cb({ cancel: !ok });
  });
  // Camera only. Any request that includes audio is refused.
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => {
    const types = details.mediaTypes || [];
    cb(perm === 'media' && types.length > 0 && types.every((t) => t === 'video'));
  });
  session.defaultSession.setPermissionCheckHandler((wc, perm) => perm === 'media');

  console.log('RESULT camera-tcc', systemPreferences.getMediaAccessStatus('camera'));

  const win = new BrowserWindow({
    width: 1340, height: 900, show: true, title: 'LC-6 blur spike',
    webPreferences: { preload: path.join(ROOT, 'preload.js'), backgroundThrottling: false },
  });
  const rendererPid = () => win.webContents.getOSProcessId();

  ipcMain.handle('metrics', () => {
    const m = app.getAppMetrics();
    const pick = (fn) => m.filter(fn).reduce((s, p) => s + (p.cpu.cumulativeCPUUsage ?? 0), 0);
    return {
      t: Date.now(),
      renderer: pick((p) => p.pid === rendererPid()),
      gpu: pick((p) => p.type === 'GPU'),
      all: pick(() => true),
    };
  });
  ipcMain.handle('save-png', (e, name, dataUrl) => {
    const out = path.join(ROOT, 'shots', name);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
    return out;
  });
  ipcMain.handle('save-json', (e, name, obj) => {
    fs.writeFileSync(path.join(ROOT, name), JSON.stringify(obj, null, 2));
  });
  ipcMain.on('log', (e, ...a) => console.log(...a));
  ipcMain.on('quit', () => {
    console.log('RESULT blocked-network-requests', JSON.stringify(blocked));
    app.quit();
  });

  win.loadURL(`app://spike/index.html${BENCH ? `?bench=1&only=${encodeURIComponent(ONLY)}` : COMPARE ? `?compare=1${process.argv.includes('--replay') ? '&replay=1' : ''}` : ''}`);
});

app.on('window-all-closed', () => app.quit());
