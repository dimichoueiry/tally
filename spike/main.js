// Throwaway spike. Usage:
//   electron . list                         -> print screens + windows as JSON
//   electron . record <sourceId|screen> [s]  -> record N seconds (default 5) to out/
//   electron . bubble [s]                   -> show circle camera bubble for N seconds
//   electron . protect [s]                  -> record screen with a content-protected RED window
//                                              and an unprotected GREEN window visible
// Every run writes a JSON result line prefixed with RESULT: to stdout.
const { app, BrowserWindow, desktopCapturer, session, ipcMain, systemPreferences, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const [mode = 'list', arg1, arg2] = process.argv.slice(2).filter((a) => !a.startsWith('--') && a !== '.');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const log = (obj) => console.log('RESULT: ' + JSON.stringify(obj));

app.commandLine.appendSwitch('enable-features', 'MediaRecorderEnableMp4Muxer');

function perms() {
  return {
    screen: systemPreferences.getMediaAccessStatus('screen'),
    camera: systemPreferences.getMediaAccessStatus('camera'),
  };
}

async function list() {
  const t0 = Date.now();
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 160, height: 100 } });
  log({
    perms: perms(),
    ms: Date.now() - t0,
    displays: screen.getAllDisplays().map((d) => ({ id: d.id, size: d.size, scale: d.scaleFactor })),
    sources: sources.map((s) => ({ id: s.id, name: s.name, display_id: s.display_id, thumbEmpty: s.thumbnail.isEmpty() })),
  });
}

// Recorder runs in a hidden renderer: getDisplayMedia -> MediaRecorder -> bytes over IPC.
// MediaPipe needs fetch() for wasm/model, which file:// blocks, so pages that use it load over localhost.
function serve() {
  const http = require('http');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm' };
  const srv = http.createServer((req, res) => {
    const f = path.join(__dirname, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!f.startsWith(__dirname) || !fs.existsSync(f)) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));
}

async function record(sourceSel, seconds, extraWindows = [], page = 'recorder.html', opts = {}) {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
  const src =
    sourceSel && sourceSel !== 'screen'
      ? sources.find((s) => s.id === sourceSel || s.name.includes(sourceSel))
      : sources.find((s) => s.id.startsWith('screen:'));
  if (!src) throw new Error('source not found: ' + sourceSel);

  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => cb({ video: src }));

  const rec = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false } });
  if (page === 'recorder.html') await rec.loadFile(page);
  else await rec.loadURL(`${await serve()}/${page}`);
  const result = await new Promise((resolve) => {
    ipcMain.once('rec-done', (_e, r) => resolve(r));
    rec.webContents.send('rec-start', { seconds, ...opts });
  });
  if (result.error) return log({ mode: 'record', source: src.name, error: result.error, perms: perms() });
  if (result.snapshot) fs.writeFileSync(path.join(OUT, `snap-${page}-${opts.blur ? opts.delegate : 'noblur'}.jpg`), Buffer.from(result.snapshot.split(',')[1], 'base64'));
  const file = path.join(OUT, `${page === 'recorder.html' ? 'rec' : 'comp'}-${src.id.replace(/[:]/g, '_')}-${Date.now()}.${result.ext}`);
  fs.writeFileSync(file, Buffer.from(result.bytes));
  log({ mode: 'record', source: { id: src.id, name: src.name }, file, bytes: fs.statSync(file).size, ...result.meta, extraWindows });
  return file;
}

async function bubble(seconds) {
  const size = 240;
  const { workArea } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: size, height: size, x: workArea.x + 40, y: workArea.y + workArea.height - size - 40,
    frame: false, transparent: true, resizable: false, hasShadow: false, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setAlwaysOnTop(true, 'screen-saver');
  await win.loadFile('bubble.html');
  const status = await new Promise((resolve) => ipcMain.once('bubble-status', (_e, s) => resolve(s)));
  await new Promise((r) => setTimeout(r, 1500));
  const img = await win.webContents.capturePage();
  const png = path.join(OUT, 'bubble-capture.png');
  fs.writeFileSync(png, img.toPNG());
  log({ mode: 'bubble', status, perms: perms(), capturePng: png });
  await new Promise((r) => setTimeout(r, (seconds - 1.5) * 1000));
  return win;
}

// Two solid windows side by side: RED has setContentProtection(true), GREEN does not.
async function protect(seconds) {
  const mk = (color, x, protectedFlag) => {
    const w = new BrowserWindow({ x, y: 200, width: 400, height: 300, frame: false, alwaysOnTop: true, backgroundColor: color, show: false });
    w.loadURL(`data:text/html,<body style="margin:0;background:${color}"></body>`);
    w.setContentProtection(protectedFlag);
    w.showInactive();
    return w;
  };
  const red = mk('#ff0000', 200, process.env.PROTECT !== '0');
  const green = mk('#00ff00', 700, false);
  await new Promise((r) => setTimeout(r, 800));
  const file = await record('screen', seconds, [
    { color: 'red', protected: true, bounds: red.getBounds() },
    { color: 'green', protected: false, bounds: green.getBounds() },
  ]);
  red.close();
  green.close();
  return file;
}

// Full-screen mode: the bubble is a real always-on-top window, so the screen capture picks it up.
async function bubbleRec(seconds) {
  const win = await bubble(1.6);
  const b = win.getBounds();
  const file = await record('screen', seconds, [{ bubble: b }]);
  win.close();
  return file;
}

app.whenReady().then(async () => {
  try {
    if (mode === 'list') await list();
    else if (mode === 'record') await record(arg1, Number(arg2 || 5));
    else if (mode === 'bubble') await bubble(Number(arg1 || 6));
    else if (mode === 'protect') await protect(Number(arg1 || 3));
    else if (mode === 'bubblerec') await bubbleRec(Number(arg1 || 3));
    // composite <sourceId> <seconds> <none|CPU|GPU>
    else if (mode === 'composite') {
      const blurMode = process.argv.slice(-1)[0];
      await record(arg1, Number(arg2 || 5), [], 'composite.html', { blur: blurMode !== 'none', delegate: blurMode });
    }
  } catch (e) {
    log({ mode, error: String(e && e.stack || e), perms: perms() });
  }
  app.exit(0);
});
