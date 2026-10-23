// Bundled Image backgrounds. Drawn in code (no third-party image licences, nothing to
// download): soft, out-of-focus rooms so the person stays the subject.

export const BUILTIN = [
  { id: 'builtin:studio', label: 'Studio' },
  { id: 'builtin:dusk', label: 'Dusk' },
  { id: 'builtin:sage', label: 'Sage' },
];

const cache = new Map();

function glow(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

const DRAW = {
  // Graphite wall, a warm key light and a dim shelf line: the default, matches the UI.
  studio(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2b322f');
    g.addColorStop(1, '#141816');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    glow(ctx, w * 0.28, h * 0.3, w * 0.45, 'rgba(255,214,160,0.20)');
    glow(ctx, w * 0.85, h * 0.2, w * 0.3, 'rgba(154,240,127,0.06)');
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(0, h * 0.62, w, h * 0.012);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.025 + (i % 3) * 0.01})`;
      ctx.fillRect(w * (0.58 + i * 0.05), h * (0.5 - (i % 2) * 0.04), w * 0.035, h * (0.12 + (i % 2) * 0.04));
    }
  },
  // Blue hour through a window: deep blue to violet with soft bokeh.
  dusk(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#16233d');
    g.addColorStop(0.55, '#2a2647');
    g.addColorStop(1, '#3d2a45');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const dots = [[0.12, 0.25, 0.07, '255,200,140'], [0.3, 0.18, 0.05, '255,230,190'], [0.72, 0.3, 0.09, '140,170,255'], [0.88, 0.62, 0.06, '255,190,150'], [0.55, 0.75, 0.05, '180,160,255'], [0.2, 0.7, 0.08, '120,150,230']];
    for (const [x, y, r, c] of dots) glow(ctx, w * x, h * y, w * r, `rgba(${c},0.32)`);
  },
  // Light sage plaster with a soft window shadow: bright, for light-themed demos.
  sage(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#c9d3cc');
    g.addColorStop(1, '#9fb0a6');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    glow(ctx, w * 0.3, h * 0.35, w * 0.5, 'rgba(255,255,245,0.35)');
    ctx.fillStyle = 'rgba(40,60,50,0.10)';
    ctx.beginPath();
    ctx.moveTo(w * 0.6, 0);
    ctx.lineTo(w * 0.78, 0);
    ctx.lineTo(w * 0.98, h);
    ctx.lineTo(w * 0.8, h);
    ctx.fill();
  },
};

// A canvas with the image at w×h (cached per size).
export function builtinImage(id, w = 1280, h = 720) {
  const key = `${id}@${w}x${h}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  (DRAW[String(id).replace('builtin:', '')] || DRAW.studio)(ctx, w, h);
  cache.set(key, c);
  return c;
}

export function builtinThumb(id) {
  return builtinImage(id, 96, 64).toDataURL('image/png');
}

// The image for a setting value: 'builtin:…' or 'user:<file name>' (copied into the
// app's own data by main, served at app://tally/user/backgrounds/…).
export async function loadBackgroundImage(ref) {
  if (!ref || ref.startsWith('builtin:')) return builtinImage(ref || 'builtin:studio');
  const img = new Image();
  img.src = `app://tally/user/backgrounds/${encodeURIComponent(ref.slice(5))}`;
  try {
    await img.decode();
    return img;
  } catch {
    return builtinImage('builtin:studio');
  }
}
