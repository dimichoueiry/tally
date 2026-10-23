// Draws the tray icons (spec §1: rounded-square housing with a round lens) as PNGs.
// Run: npm run icons. Output: resources/icons/.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

const OUT = path.resolve('resources/icons');
fs.mkdirSync(OUT, { recursive: true });

function png(w, h, rgba) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Signed distance to a rounded rect centred at (cx, cy).
const sdRoundRect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

// 18×16 pt canvas: housing outline (1.75 pt stroke) + lens dot. `filled`: solid housing
// with the lens cut out (setup open, SETUP_V2 §2).
function draw(scale, housing, lens, filled = false) {
  const w = 18 * scale, h = 16 * scale;
  const buf = Buffer.alloc(w * h * 4);
  const ss = 4; // supersampling
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    let aH = 0, aL = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const x = (px + (sx + 0.5) / ss) / scale, y = (py + (sy + 0.5) / ss) / scale;
      const d = sdRoundRect(x, y, 9, 8, 7.2, 6.2, 3.2);
      if (filled ? d <= 0.875 : Math.abs(d) <= 0.875) aH++;
      if (Math.hypot(x - 9, y - 8) <= 2.6) aL++;
    }
    aH /= ss * ss; aL /= ss * ss;
    if (filled) {
      const i = (py * w + px) * 4;
      buf[i + 3] = Math.round(aH * (1 - aL) * 255);
      continue;
    }
    const i = (py * w + px) * 4;
    // lens over housing
    const a = aL + aH * (1 - aL);
    if (!a) continue;
    for (let c = 0; c < 3; c++) buf[i + c] = Math.round((lens[c] * aL + housing[c] * aH * (1 - aL)) / a);
    buf[i + 3] = Math.round(a * 255);
  }
  return png(w, h, buf);
}

const black = [0, 0, 0], live = [255, 75, 85], hold = [255, 201, 74], light = [237, 242, 239];
for (const [name, housing, lens] of [['trayTemplate', black, black], ['trayLive', light, live], ['trayPaused', light, hold]]) {
  fs.writeFileSync(path.join(OUT, `${name}.png`), draw(1, housing, lens));
  fs.writeFileSync(path.join(OUT, `${name}@2x.png`), draw(2, housing, lens));
}
fs.writeFileSync(path.join(OUT, 'trayOnTemplate.png'), draw(1, black, black, true));
fs.writeFileSync(path.join(OUT, 'trayOnTemplate@2x.png'), draw(2, black, black, true));
// App icon (build/icon.png, 1024 px; electron-builder makes .icns / .ico from it): the same
// housing + lens mark, light on a deep green rounded square (Apple grid: 824 px body,
// 100 px margin), lens in the live red.
function appIcon(size = 1024) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 2;
  const body = 824, off = (size - body) / 2, r = 185;
  const c = size / 2;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let aB = 0, aH = 0, aL = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const x = px + (sx + 0.5) / ss, y = py + (sy + 0.5) / ss;
      if (sdRoundRect(x, y, c, c, body / 2, body / 2, r) <= 0) aB++;
      if (Math.abs(sdRoundRect(x, y, c, c + 8, 236, 204, 104)) <= 30) aH++;
      if (Math.hypot(x - c, y - c - 8) <= 86) aL++;
    }
    aB /= ss * ss; aH /= ss * ss; aL /= ss * ss;
    if (!aB) continue;
    const k = py / size; // top-to-bottom gradient
    let rgb = [Math.round(31 - 12 * k), Math.round(52 - 22 * k), Math.round(44 - 18 * k)];
    const mix = (to, a) => (rgb = rgb.map((v, i) => Math.round(v * (1 - a) + to[i] * a)));
    mix(light, aH);
    mix(live, aL);
    const i = (py * size + px) * 4;
    buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2]; buf[i + 3] = Math.round(aB * 255);
  }
  return png(size, size, buf);
}
fs.mkdirSync(path.resolve('build'), { recursive: true });
fs.writeFileSync(path.resolve('build', 'icon.png'), appIcon());
console.log('icons written to', OUT, 'and build/icon.png');
