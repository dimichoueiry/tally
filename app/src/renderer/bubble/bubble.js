// Camera bubble preview (spec §3.2). Mirrored, shaped, zoomed and face-centred
// exactly like the engine's composite. Content-protected: the HUD never reaches the video.
import { installIcons, icon } from '../shared/ui.js';
import { openCamera, stopStream, FaceTracker, drawBubble, CENTRE } from '../shared/camera.js';
import { CameraBackground } from '../shared/bg/background.js';
import { cssClipPath, clampZoom, maxZoom, squirclePoints, RECT_RADIUS, handlePoint, diamFromDrag, resizeZone, anchorForZone } from '../../shared/geometry.js';
import { BubbleDrag } from '../../shared/bubbleDrag.js';

const tally = window.tally;
installIcons();
const $ = (id) => document.getElementById(id);
const wrap = $('wrap');
const cam = $('cam');
const canvas = $('c');
const ctx = canvas.getContext('2d');
const hud = $('hud');
const PAD = 20; // window margin around the bubble: BUBBLE_PAD in main/windows.js, .wrap in bubble.css
document.querySelector('[data-z="-1"]').innerHTML = icon('minus', 's14');
document.querySelector('[data-z="1"]').innerHTML = icon('plus', 's14');
$('hide').innerHTML = icon('eye-off', 's14');
$('bgbtn').innerHTML = icon('blur', 's14');
$('lostIcon').innerHTML = icon('unplug', 's20');
$('sizeh').innerHTML = icon('resize');

let state = { visible: false };
const ring = document.createElement('div');
ring.className = 'ring';
ring.setAttribute('aria-hidden', 'true');
wrap.appendChild(ring);

// Drag / focus ring: the shape's outline, 4 px outside it (spec 02b).
function ringSvg(shape, w, h) {
  let d;
  if (shape === 'circle') d = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2 - 1}" ry="${h / 2 - 1}"/>`;
  else if (shape === 'squircle') d = `<polygon points="${squirclePoints().map(([x, y]) => `${(1 + x * (w - 2)).toFixed(1)},${(1 + y * (h - 2)).toFixed(1)}`).join(' ')}"/>`;
  else d = `<rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${RECT_RADIUS + 4}"/>`;
  return `<svg viewBox="0 0 ${w} ${h}" fill="none" stroke="var(--ready)" stroke-width="2">${d}</svg>`;
}
let camera = null;
let opening = null;
let face = null;
let loop = 0; // generation counter: bumping it ends the running draw loop
// One background pipeline for the window's lifetime: switching None/Blur/Image only
// changes its mode (no new segmenter or GL context).
let bg = null;
const perf = [];
window.__bubblePerf = () => {
  const s = [...perf].sort((a, b) => a - b);
  const q = (p) => (s.length ? +s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))].toFixed(2) : null);
  return { n: s.length, med: q(0.5), p95: q(0.95), delegate: bg?.delegate || null, status: bg?.status || null, load: bg?.loadInfo || null };
};

const BG_LABEL = { blur: 'Blur', image: 'Image' };
const BG_NEXT = { none: 'blur', blur: 'image', image: 'none' };

function syncBackground() {
  const mode = state.background || 'none';
  if (mode !== 'none' && !bg) bg = new CameraBackground({ onStatus: renderTag, log: (t) => console.warn(`[bg] ${t}`) });
  bg?.setMode(mode, state.bgImage);
  renderTag();
}

// Preview-only tag (spec 02b): "Blur" / "Image" while the popover is open, and
// "Background paused" whenever segmentation can't keep up.
function renderTag() {
  const tag = $('bgtag');
  const paused = bg?.status === 'paused' && state.background !== 'none';
  const loading = bg?.status === 'loading' && state.background !== 'none';
  const text = paused ? 'Background paused' : loading ? `${BG_LABEL[state.background]}…` : state.tag && state.background !== 'none' ? BG_LABEL[state.background] : '';
  tag.hidden = !text;
  tag.classList.toggle('warn', paused);
  tag.innerHTML = text ? `${paused ? icon('warn', 's14') : icon('blur', 's14')}${text}` : '';
  $('bgbtn').setAttribute('aria-label', `Background: ${state.background === 'none' || !state.background ? 'None' : BG_LABEL[state.background]}. Change`);
  $('bgbtn').classList.toggle('on', !!state.background && state.background !== 'none');
}

const SHAPE = { circle: 'circle', squircle: 'squircle', landscape: 'landscape', portrait: 'portrait', frame: 'camera only' };
const sizeText = () => (state.cameraOnly ? `${state.aspect} preview` : state.width === state.height ? `${state.width} pt` : `${state.width}×${state.height} pt`);

function layout() {
  const { width, height, shape } = state;
  if (!width) return;
  wrap.style.width = `${width}px`;
  wrap.style.height = `${height}px`;
  // Non-zero only while a size preset animates: the window then spans old ∪ new.
  const off = state.offset || { x: 0, y: 0 };
  wrap.style.left = `${PAD + off.x}px`;
  wrap.style.top = `${PAD + off.y}px`;
  cam.style.clipPath = cssClipPath(shape);
  ring.innerHTML = ringSvg(shape, width + 8, height + 8);
  const dpr = window.devicePixelRatio || 2;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  $('zoom').value = state.zoom;
  $('zv').textContent = `${state.zoom.toFixed(1)}×`;
  setPct();
  cam.setAttribute('aria-label', `Camera preview, ${SHAPE[shape] || shape}, ${sizeText()}, zoom ${state.zoom.toFixed(1)}×, background ${state.background === 'none' || !state.background ? 'none' : BG_LABEL[state.background].toLowerCase()}`);
  cam.tabIndex = state.focusable ? 0 : -1;
  wrap.classList.toggle('setup', !!state.setup);
  wrap.classList.toggle('camonly', !!state.cameraOnly);
  // Small bubbles: the hover HUD keeps its buttons and drops the zoom slider.
  wrap.classList.toggle('tiny', width < 200);
  placeHandle();
}

// Handle on the corner opposite the anchored one: dragging it outward grows the
// bubble away from the screen edge it sits by.
function placeHandle() {
  const h = $('sizeh');
  const a = state.anchor || { h: 'left', v: 'bottom' };
  const p = handlePoint(state.shape, state.width, state.height, a);
  h.style.left = `${p.x}px`;
  h.style.top = `${p.y}px`;
  h.className = `sizeh ${a.v === 'bottom' ? 'n' : 's'}${a.h === 'left' ? 'e' : 'w'}${state.width < 140 ? ' sm' : ''}`;
  $('sizechip').textContent = sizeText();
}

function setPct() {
  $('zoom').style.setProperty('--pct', `${(Number($('zoom').value) - 1) * 100}%`);
}

// Camera only opens the camera at its best (as the engine does, so both get one format).
async function ensureCamera() {
  const hiRes = !!state.cameraOnly;
  if (camera && camera.deviceId === (state.deviceId || null) && camera.hiRes === hiRes) return;
  if (opening) return opening;
  opening = (async () => {
    stopCamera();
    try {
      const c = await openCamera(state.deviceId, { hiRes });
      camera = { ...c, deviceId: state.deviceId || null, hiRes };
      face = face || new FaceTracker();
      $('lost').hidden = true;
      const track = c.stream.getVideoTracks()[0];
      track.addEventListener('ended', () => {
        if (camera?.stream !== c.stream) return;
        stopStream(c.stream);
        showLost('Camera disconnected');
      });
      tally.invoke('bubble:camera', { width: c.video.videoWidth, height: c.video.videoHeight });
    } catch (e) {
      showLost(e.name === 'NotAllowedError' ? 'Camera is blocked' : 'Camera unavailable');
    }
    opening = null;
  })();
  await opening;
  // The mode changed while it was opening: open again with the right resolution.
  if (state.visible && camera && camera.hiRes !== !!state.cameraOnly) return ensureCamera();
}

function showLost(text) {
  $('lostText').textContent = text;
  $('lost').hidden = false;
  camera = null;
}

function stopCamera() {
  if (camera) stopStream(camera.stream);
  camera = null;
}

// Draw once per camera frame (requestVideoFrameCallback), not per display refresh:
// on a 120 Hz screen rAF would segment every 30 fps camera frame four times.
function startLoop() {
  const gen = ++loop;
  const tick = () => {
    if (gen !== loop) return;
    frame();
    if (camera) camera.video.requestVideoFrameCallback(tick);
    else setTimeout(tick, 250);
  };
  tick();
}

function frame() {
  if (!camera) return;
  const v = camera.video;
  const z = clampZoom(state.zoom, v.videoWidth, v.videoHeight);
  const centre = state.follow ? face.update(v) : CENTRE;
  const t0 = performance.now();
  const out = bg?.process(v, { width: canvas.width, height: canvas.height, zoom: z, centre });
  if (out) {
    perf.push(performance.now() - t0);
    if (perf.length > 600) perf.shift();
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // CSS clip-path shapes it; mirrored exactly when the recording is (camera.mirror).
  drawBubble(ctx, out || v, { x: 0, y: 0, w: canvas.width, h: canvas.height, shape: state.shape, zoom: out ? 1 : z, centre: out ? CENTRE : centre, mirror: state.mirror !== false, clip: false });
}

tally.on('bubble:state', async (s) => {
  const prev = state;
  state = s;
  if (!s.visible) {
    endDrag(); // a press can't outlive the window being hidden (LC-9)
    endResize();
    wrap.hidden = true;
    loop++;
    stopCamera();
    return;
  }
  layout();
  wrap.hidden = false;
  if (s.animFrom && !reduceMotion.matches) growFrom(s.animFrom);
  syncBackground();
  if (!prev.visible || prev.deviceId !== s.deviceId || !!prev.cameraOnly !== !!s.cameraOnly) await ensureCamera();
  startLoop();
});

// Size preset change (SETUP_V2 §11.2): 160 ms ease-out from the anchored corner, so
// a bottom-left bubble grows up and right. Instant with reduced motion.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
function growFrom(from) {
  const a = state.anchor || { h: 'left', v: 'bottom' };
  wrap.style.transformOrigin = `${a.h} ${a.v}`;
  wrap.style.transition = 'none';
  wrap.style.transform = `scale(${from.width / state.width}, ${from.height / state.height})`;
  wrap.getBoundingClientRect(); // commit the start frame before transitioning
  wrap.style.transition = 'transform 160ms var(--ease-out)';
  wrap.style.transform = '';
  setTimeout(() => {
    wrap.style.transition = '';
    wrap.style.transformOrigin = '';
  }, 200);
}

tally.on('bubble:guides', (g) => wrap.classList.toggle('snapped', Object.keys(g).length > 0));

// ───────── pointer: hover HUD, drag, click-through outside the shape ─────────

let hoverTimer = 0;
let leaveTimer = 0;
let inside = false;
const drag = new BubbleDrag();

function hit(x, y) {
  const r = cam.getBoundingClientRect();
  if (resize.active) return true;
  if (state.setup && !state.cameraOnly && wrap.classList.contains('hover')) {
    if (zoneAt(x, y)) return true;
    const h = $('sizeh').getBoundingClientRect();
    if (Math.hypot(x - (h.left + h.width / 2), y - (h.top + h.height / 2)) <= h.width / 2 + 2) return true;
  }
  if (!wrap.hidden && hud.contains(document.elementFromPoint(x, y)) && wrap.classList.contains('hover')) return true;
  if (x < r.left || y < r.top || x > r.right || y > r.bottom) return false;
  if (state.shape === 'circle') return Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2)) <= r.width / 2;
  return true;
}

function setInside(v) {
  if (v === inside) return;
  inside = v;
  tally.invoke('bubble:mouse', v);
  clearTimeout(hoverTimer);
  clearTimeout(leaveTimer);
  if (v) hoverTimer = setTimeout(() => wrap.classList.add('hover'), 150);
  else leaveTimer = setTimeout(() => wrap.classList.remove('hover'), 600);
}

// Drag (LC-9): see src/shared/bubbleDrag.js. Hover only shows the HUD; a drag needs
// a press on the bubble plus > 3 px of movement with the button held, and it ends on
// release, cancel, lost capture, window blur, Esc, leaving the window or hiding.
function apply(actions) {
  for (const a of actions) {
    if (a.phase === 'start') wrap.classList.add('dragging');
    if (a.phase === 'end') wrap.classList.remove('dragging');
    tally.invoke('bubble:drag', a);
  }
}

// Only a release says where the drag ended. Every other end (lost capture, leaving the
// window, blur, Esc) keeps the last move: their coordinates can be stale (lost capture
// reports the press point, which snapped the bubble back to where the drag began).
function endDrag(e) {
  apply(drag.end(e?.type === 'pointerup' ? e.screenX : undefined, e?.type === 'pointerup' ? e.screenY : undefined));
  wrap.classList.remove('dragging');
}

document.addEventListener('pointermove', (e) => {
  if (resize.active) return applyResize(resize.move(e.screenX, e.screenY, e.buttons), e);
  if (drag.active) return apply(drag.move(e.screenX, e.screenY, e.buttons));
  setInside(hit(e.clientX, e.clientY));
  showZone(zoneAt(e.clientX, e.clientY));
});
document.addEventListener('mouseleave', (e) => {
  endDrag(e);
  if (!resize.active) endResize(); // a captured resize may leave the old window bounds
  setInside(false);
});

cam.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || state.cameraOnly) return; // the Camera only preview doesn't move
  const z = zoneAt(e.clientX, e.clientY);
  try {
    cam.setPointerCapture(e.pointerId);
  } catch {}
  // A press on the edge band (hovered, in setup) resizes; anywhere else drags.
  if (z) {
    grabbed = z;
    return applyResize(resize.press(e.screenX, e.screenY, e.button));
  }
  apply(drag.press(e.screenX, e.screenY, e.button));
});
cam.addEventListener('pointerup', (e) => resize.active && endResize(e));
$('grip').addEventListener('pointerdown', (e) => cam.dispatchEvent(new PointerEvent('pointerdown', e)));
cam.addEventListener('pointerup', endDrag);
cam.addEventListener('pointercancel', (e) => (resize.active ? endResize(e) : endDrag(e)));
cam.addEventListener('lostpointercapture', (e) => (resize.active ? endResize(e) : endDrag(e)));
window.addEventListener('blur', () => {
  endDrag();
  endResize();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  endDrag();
  endResize();
});

// Resize (setup only, while hovering): the corner handle, or the 10 pt band along the
// edge (rim for a circle), so the bubble never needs a handle in the way. Same gesture
// rules as the drag (LC-9): a press plus > 3 px of movement with the button held; any
// release, lost capture, blur or Esc ends it. Continuous; main keeps the fixed corner.
const resize = new BubbleDrag();
let anchorPt = null;
let grabbed = null; // { zx, zy } edge band pressed, or null for the corner handle
let axes = { x: true, y: true };

// The resize zone under a window point, or null. Only in setup, hovered, not Camera only.
function zoneAt(x, y) {
  if (!state.setup || state.cameraOnly || !state.width || drag.active || !wrap.classList.contains('hover')) return null;
  const r = cam.getBoundingClientRect();
  return resizeZone(state.shape, r.width, r.height, { x: x - r.left, y: y - r.top }, state.width < 140 ? 8 : 10);
}

const CURSOR = { '-1,-1': 'nwse', '1,1': 'nwse', '1,-1': 'nesw', '-1,1': 'nesw', '-1,0': 'ew', '1,0': 'ew', '0,-1': 'ns', '0,1': 'ns' };
function showZone(z) {
  cam.style.cursor = z ? `${CURSOR[`${z.zx},${z.zy}`]}-resize` : '';
  wrap.classList.toggle('edge', !!z);
}

function applyResize(actions) {
  for (const a of actions) {
    if (a.phase === 'start') {
      wrap.classList.add('resizing');
      const r = state.rect;
      const screenAnchor = state.anchor || { h: 'left', v: 'bottom' };
      const an = grabbed ? anchorForZone(grabbed, screenAnchor) : screenAnchor;
      axes = grabbed ? { x: grabbed.zx !== 0, y: grabbed.zy !== 0 } : { x: true, y: true };
      anchorPt = { x: an.h === 'left' ? r.x : r.x + r.width, y: an.v === 'top' ? r.y : r.y + r.height };
      tally.invoke('bubble:resize', { phase: 'start', anchor: an });
    } else if (a.phase === 'move' && anchorPt) {
      tally.invoke('bubble:resize', { phase: 'move', diam: diamFromDrag(state.shape, anchorPt, a, axes) });
    } else if (a.phase === 'end') {
      wrap.classList.remove('resizing');
      anchorPt = null;
      tally.invoke('bubble:resize', { phase: 'end' });
    }
  }
}
function endResize(e) {
  // Same rule as endDrag: only a release carries a trustworthy position.
  applyResize(resize.end(e?.type === 'pointerup' ? e.screenX : undefined, e?.type === 'pointerup' ? e.screenY : undefined));
  wrap.classList.remove('resizing');
  grabbed = null;
}
$('sizeh').addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !state.setup || state.cameraOnly) return;
  e.stopPropagation();
  grabbed = null;
  try {
    $('sizeh').setPointerCapture(e.pointerId);
  } catch {}
  applyResize(resize.press(e.screenX, e.screenY, e.button));
});
$('sizeh').addEventListener('pointerup', endResize);
$('sizeh').addEventListener('pointercancel', endResize);
$('sizeh').addEventListener('lostpointercapture', endResize);

const setZoom = (z) => {
  const max = camera ? maxZoom(camera.video.videoWidth, camera.video.videoHeight) : 2;
  z = Math.round(Math.min(Math.max(z, 1), max) * 20) / 20;
  if (z === state.zoom) return;
  state.zoom = z;
  layout();
  tally.invoke('bubble:zoom', z);
};

// No scroll-wheel / pinch zoom: a stray scroll over the bubble used to reset the
// framing. Zoom changes only on purpose: tray slider, HUD buttons, keys.

hud.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.z) setZoom(state.zoom + Number(b.dataset.z) * 0.1);
  if (b.id === 'hide') tally.invoke('bubble:hide');
  if (b.id === 'bgbtn') tally.invoke('bubble:background', BG_NEXT[state.background || 'none']);
});

// The camera came back (spec §3.8: resumes automatically when the same device returns).
async function retryCamera() {
  if (!state.visible || camera || opening || $('lost').hidden) return;
  await ensureCamera();
  if (camera) startLoop();
}
navigator.mediaDevices.addEventListener('devicechange', retryCamera);
tally.on('bubble:simulate', (what) => {
  if (what === 'camera-lost') camera?.stream.getVideoTracks()[0].dispatchEvent(new Event('ended'));
  if (what === 'camera-back') retryCamera();
});
$('zoom').addEventListener('input', (e) => {
  setPct();
  setZoom(Number(e.target.value));
});
$('zv').addEventListener('dblclick', () => setZoom(1));

// Keyboard (when focusable, i.e. while the popover is open): arrows move, +/− zoom, 0 reset, H hide.
cam.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 40 : 8;
  const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (mv) {
    e.preventDefault();
    tally.invoke('bubble:nudge', { dx: mv[0], dy: mv[1] });
  } else if (e.key === '+' || e.key === '=') setZoom(state.zoom + 0.1);
  else if (e.key === '-') setZoom(state.zoom - 0.1);
  else if (e.key === '0') setZoom(1);
  else if (e.key.toLowerCase() === 'h') tally.invoke('bubble:hide');
  else if (e.key.toLowerCase() === 'b') tally.invoke('bubble:background', state.background === 'blur' ? 'none' : 'blur');
  else if (e.key === 'Tab' && state.setup) {
    // Setup tab ring (SETUP_V2 §7): … background → bubble → tray zoom.
    e.preventDefault();
    tally.invoke('bubble:focusTray', e.shiftKey ? 'last' : 'first');
  }
});
tally.on('bubble:focus', () => cam.focus());
cam.addEventListener('focus', () => wrap.classList.add('focus'));
cam.addEventListener('blur', () => wrap.classList.remove('focus'));
