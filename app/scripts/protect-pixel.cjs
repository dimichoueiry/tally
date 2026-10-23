// Capture-exclusion smoke test (ARCHITECTURE §6.3, SETUP_V2 §12.6), to run by hand:
//   npx electron scripts/protect-pixel.cjs
// Shows two 160 pt squares for under a second in the top-left of the main display: red with
// setContentProtection(true) (as every Tally overlay, the notes panel included) and an
// unprotected green control. A capture of the display must show the green one and not the
// red one. Prints PASS / FAIL and quits. Needs Screen Recording permission for Electron.
const { app, BrowserWindow, desktopCapturer, screen } = require('electron');

function square(color, x, y, protect) {
  const win = new BrowserWindow({ x, y, width: 160, height: 160, frame: false, show: false, focusable: false, skipTaskbar: true, resizable: false, alwaysOnTop: true, backgroundColor: color });
  if (protect) win.setContentProtection(true);
  win.showInactive();
  return win;
}

app.whenReady().then(async () => {
  const d = screen.getPrimaryDisplay();
  const at = { x: d.workArea.x + 40, y: d.workArea.y + 40 };
  const red = square('#ff0000', at.x, at.y, true);
  const green = square('#00ff00', at.x + 200, at.y, false);
  await new Promise((r) => setTimeout(r, 600));
  const s = d.scaleFactor;
  const [src] = (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: d.size.width * s, height: d.size.height * s } })).filter((x) => String(x.display_id) === String(d.id));
  red.destroy();
  green.destroy();
  if (!src) {
    console.log('FAIL: no capture of the main display (Screen Recording permission?)');
    return app.exit(1);
  }
  const img = src.thumbnail;
  const k = img.getSize().width / d.size.width;
  const bmp = img.toBitmap(); // BGRA
  const w = img.getSize().width;
  const px = (x, y) => {
    const i = (Math.round((y - d.bounds.y) * k) * w + Math.round((x - d.bounds.x) * k)) * 4;
    return { r: bmp[i + 2], g: bmp[i + 1], b: bmp[i] };
  };
  const r = px(at.x + 80, at.y + 80);
  const g = px(at.x + 280, at.y + 80);
  const redAbsent = !(r.r > 200 && r.g < 60 && r.b < 60);
  const greenPresent = g.g > 200 && g.r < 60 && g.b < 60;
  console.log(`protected red square: ${redAbsent ? 'absent' : 'PRESENT'} (${r.r},${r.g},${r.b}) · unprotected green control: ${greenPresent ? 'present' : 'ABSENT'} (${g.r},${g.g},${g.b})`);
  console.log(redAbsent && greenPresent ? 'PASS' : 'FAIL');
  app.exit(redAbsent && greenPresent ? 0 : 1);
});
