// Throwaway spike: can Electron 45 capture macOS system audio via getDisplayMedia loopback?
// Usage: electron sysaudio [seconds] [loopback|loopbackWithMute]
// Writes out/sysaudio-<ts>.webm and prints RESULT: lines.
const { app, BrowserWindow, desktopCapturer, session, ipcMain, systemPreferences } = require('electron');
const fs = require('fs');
const path = require('path');

// `electron .` sets process.defaultApp and puts the app path at argv[1]; a bundled app does not.
const packaged = !process.defaultApp;
const args = process.argv.slice(packaged ? 1 : 2).filter((a) => !a.startsWith('-') && a !== '.');
const seconds = Number(args[0] || 5);
const audioMode = args[1] || 'loopback';
const tag = process.env.TAG || (args[2] === 'raw' ? 'raw' : '');
// Packaged: __dirname is SysAudioSpike.app/Contents/Resources/app, so write next to the bundle.
const OUT = path.join(__dirname, packaged ? '../../../../out' : 'out');
const raw = process.env.RAW === '1' || args[2] === 'raw';
fs.mkdirSync(OUT, { recursive: true });
const log = (obj) => {
  const line = 'RESULT: ' + JSON.stringify(obj);
  console.log(line);
  fs.appendFileSync(path.join(OUT, 'results.log'), new Date().toISOString() + ' ' + line + '\n');
};

app.whenReady().then(async () => {
  log({ stage: 'start', tag, raw, packaged, exe: process.execPath, audioMode, seconds,
    screen: systemPreferences.getMediaAccessStatus('screen') });
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => cb({ video: sources[0], audio: audioMode }));

  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  ipcMain.on('result', (_e, r) => log(r));
  ipcMain.on('done', (_e, buf) => {
    const f = path.join(OUT, `sysaudio-${audioMode}${tag && '-' + tag}-${packaged ? 'packaged' : 'unpackaged'}-${Date.now()}.webm`);
    fs.writeFileSync(f, Buffer.from(buf));
    log({ stage: 'saved', file: f, bytes: buf.byteLength });
    app.quit();
  });
  await win.loadFile(path.join(__dirname, 'index.html'), { query: { s: String(seconds), raw: raw ? '1' : '0' } });
});
