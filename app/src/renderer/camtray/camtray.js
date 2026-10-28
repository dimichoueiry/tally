// Bubble tray (SETUP_V2 §11, mockup 14), docked under the bubble during setup only.
// Row 1, how big: bubble size, continuous (S/M/L/XL are detents). Row 2: zoom. Row 3, how
// it looks: shape | background · camera settings · camera off. Row 4: Follow me · Mirror.
// Camera only: row 1 is the aspect ratio and the output's resolution; no shape, no off. Never recorded (content
// protection, windows.js) and never starts a bubble drag: it is a separate window
// with no drag code, so hovering or pressing it can only change settings.
import { installIcons, icon, esc } from '../shared/ui.js';
import { SHAPES, ZOOM_DETENTS, ZOOM_MAX, BUBBLE_MIN, BUBBLE_MAX, PRESET_DIAM, ASPECT_KEYS, bubbleSize, maxZoom, snapZoom, cameraDiam } from '../../shared/geometry.js';
import { BUILTIN, builtinThumb } from '../shared/bg/images.js';

const tally = window.tally;
installIcons();
const $ = (id) => document.getElementById(id);
const box = $('box');
const tray = $('tray');
const pill = $('pill');
const pop = $('pop');
const trk = $('zoomTrk');

const SHAPE = { circle: ['sh-circle', 'Circle'], squircle: ['sh-squircle', 'Rounded square'], landscape: ['sh-land', 'Landscape 16:9'], portrait: ['sh-port', 'Portrait 3:4'] };
const BG = [['none', 'bg-none', 'No background effect'], ['blur', 'bg-blur', 'Blur background'], ['image', 'bg-image', 'Image background']];
const userBg = (name) => `app://tally/user/backgrounds/${encodeURIComponent(name)}`;
const cleanLabel = (l) => String(l || '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '');

let st = null; // settings
let view = { visible: false, mode: 'tray', popSide: 'right', minDiam: BUBBLE_MIN, maxDiam: BUBBLE_MAX, cameraOnly: false, camOut: null, camera: 'granted', camDims: null };
const strk = $('sizeTrk');
let devices = [];
let popKind = null; // null | 'settings' | 'image'

$('settingsBtn').innerHTML = icon('sliders');
$('offBtn').innerHTML = icon('power');
document.querySelector('#zoomTrk').parentElement.querySelector('.zi').innerHTML = icon('zoom-in');
$('sizeIcon').innerHTML = icon('bubble-size');
$('dets').innerHTML = ZOOM_DETENTS.map((d) => `<i class="det" style="left:${((d - 1) / (ZOOM_MAX - 1)) * 100}%"></i>`).join('');

const camMax = () => (view.camDims ? maxZoom(view.camDims.width, view.camDims.height) : ZOOM_MAX);
const fmtZoom = (z) => `${z.toFixed(Math.round(z * 100) % 10 ? 2 : 1)}×`;

function save(partial) {
  return tally.invoke('app:setSettings', partial).then((s) => {
    st = s;
    render();
  });
}

// ───────── render ─────────

function render() {
  if (!st) return;
  // Rebuilding a radio group drops its focus: put it back on the new selection.
  const a = document.activeElement;
  const group = a?.closest?.('[role="radiogroup"]');
  const groupKey = group?.id || null;
  const keepId = a?.id && box.contains(a) ? a.id : null;
  draw();
  if (groupKey) focusChecked($(groupKey));
  else if (keepId && document.activeElement !== $(keepId)) $(keepId)?.focus();
}

function draw() {
  box.hidden = !view.visible;
  if (!view.visible) return;
  const c = st.camera;
  const isTray = view.mode === 'tray';
  tray.hidden = !isTray;
  pill.hidden = isTray;
  box.classList.toggle('glide', !!view.animate);
  box.style.transform = `translate(${view.x}px, ${view.y}px)`;
  if (isTray) {
    tray.style.width = `${view.width}px`;
    renderZoom(c.zoom);
    const co = !!view.cameraOnly;
    $('sizeRow').hidden = co;
    $('aspectRow').hidden = !co;
    $('shapes').hidden = co;
    $('shapeSep').hidden = co;
    $('offBtn').hidden = co;
    if (co) renderAspect();
    else {
      renderSize(sizeDiam());
      $('shapes').innerHTML = SHAPES.map((s) => radio('shape', s, c.shape === s, icon(SHAPE[s][0]), SHAPE[s][1])).join('');
    }
    $('bgs').innerHTML = BG.map(([k, ic, n]) => radio('bg', k, (c.background || 'none') === k, icon(ic), n)).join('');
    $('settingsBtn').setAttribute('aria-expanded', String(popKind === 'settings'));
    $('followBtn').setAttribute('aria-checked', String(!!c.follow));
    $('mirrorBtn').setAttribute('aria-checked', String(c.mirror !== false));
  } else renderPill();
  renderPop();
  reportSize();
}

// One tab stop per group; arrows move and select (selection follows focus).
function radio(group, value, on, inner, label, disabled = false) {
  return `<button role="radio" data-${group}="${esc(value)}" aria-checked="${on}" tabindex="${on ? 0 : -1}" aria-label="${esc(label)}" title="${esc(label)}"${disabled ? ' disabled' : ''}>${inner}</button>`;
}

function renderZoom(z) {
  const max = camMax();
  const pct = ((z - 1) / (ZOOM_MAX - 1)) * 100;
  $('zfill').style.width = `${pct}%`;
  $('zknob').style.left = `${pct}%`;
  $('zv').textContent = fmtZoom(z);
  const cap = $('zcap');
  cap.hidden = max >= ZOOM_MAX;
  cap.style.left = `${((max - 1) / (ZOOM_MAX - 1)) * 100}%`;
  trk.setAttribute('aria-valuenow', String(z));
  trk.setAttribute('aria-valuemax', String(max));
  trk.setAttribute('aria-valuetext', `${fmtZoom(z)}${max < ZOOM_MAX ? `, maximum ${fmtZoom(max)} for this camera` : ''}`);
}

// ───────── size slider (continuous) ─────────

const sizeLo = () => view.minDiam || BUBBLE_MIN;
const sizeHi = () => Math.max(sizeLo() + 1, view.maxDiam || BUBBLE_MAX);
const sizeDiam = () => Math.min(Math.max(cameraDiam(st.camera), sizeLo()), sizeHi());
const sizePct = (d) => ((d - sizeLo()) / (sizeHi() - sizeLo())) * 100;
const sizeLabel = (d) => {
  const b = bubbleSize(st.camera.shape, d);
  return b.width === b.height ? `${b.width} pt` : `${b.width}×${b.height}`;
};
const PRESET_NAMES = Object.entries(PRESET_DIAM); // [['S', 220], …]

function renderSize(d) {
  const p = sizePct(d);
  $('sfill').style.width = `${p}%`;
  $('sknob').style.left = `${p}%`;
  $('sv').textContent = sizeLabel(d);
  $('sdets').innerHTML = PRESET_NAMES.filter(([, v]) => v > sizeLo() && v <= sizeHi()).map(([k, v]) => `<i class="det" title="${k}" style="left:${sizePct(v)}%"></i>`).join('');
  strk.setAttribute('aria-valuemin', String(sizeLo()));
  strk.setAttribute('aria-valuemax', String(sizeHi()));
  strk.setAttribute('aria-valuenow', String(d));
  const preset = PRESET_NAMES.find(([, v]) => v === d)?.[0];
  strk.setAttribute('aria-valuetext', `${sizeLabel(d)}${preset ? `, size ${preset}` : ''}`);
}

// Snaps to an S/M/L/XL detent within 4 pt, else whole pt; never outside the range.
function snapDiam(d) {
  const det = PRESET_NAMES.find(([, v]) => Math.abs(v - d) <= 4);
  return Math.round(Math.min(Math.max(det ? det[1] : d, sizeLo()), sizeHi()));
}

function setDiam(d) {
  d = snapDiam(d);
  renderSize(d);
  if (d === cameraDiam(st.camera)) return;
  st.camera.diam = d;
  tally.invoke('app:setSettings', { camera: { diam: d } });
}

// ───────── Camera only: aspect + output ─────────

const ASPECT_LABEL = { '16:9': 'Landscape 16:9', '9:16': 'Vertical 9:16 (TikTok, Reels)', '1:1': 'Square 1:1', '4:5': 'Portrait 4:5' };
function renderAspect() {
  const cur = st.camOnly?.aspect || '16:9';
  $('aspects').innerHTML = ASPECT_KEYS.map((k) => radio('aspect', k, k === cur, `<span class="ar ar-${k.replace(':', 'x')}" aria-hidden="true"></span>${k}`, ASPECT_LABEL[k])).join('');
  const o = view.camOut;
  $('outres').textContent = o ? `${o.width}×${o.height}` : '';
  $('outres').title = o ? `The video is ${o.width}×${o.height} at 30 fps` : '';
}

function renderPill() {
  const blocked = view.mode === 'blocked';
  pill.classList.toggle('blocked', blocked);
  pill.setAttribute('aria-label', blocked ? 'Camera blocked' : 'Camera off');
  pill.innerHTML = blocked
    ? `${icon('warn')}<span>Camera blocked</span><button class="act" data-act="open-settings">Open Settings</button>`
    : `${icon('camera-off')}<span>Camera off</span><button class="act" data-act="turn-on">Turn on</button>`;
}

function renderPop() {
  const open = view.visible && view.mode === 'tray' && popKind;
  pop.hidden = !open;
  if (!open) return;
  pop.className = `gpop glass ${view.popSide}${popKind === 'image' ? ' img' : ''}`;
  const c = st.camera;
  if (popKind === 'settings') {
    pop.setAttribute('aria-label', 'Camera settings');
    const list = devices.length ? devices : [{ deviceId: '', label: 'Default camera' }];
    const cur = c.deviceId || list[0].deviceId;
    pop.innerHTML = `<h4>Camera</h4>
      <div class="devs" id="devs" role="radiogroup" aria-label="Camera device">${list
        .map((d) => `<button class="dev" role="radio" data-dev="${esc(d.deviceId)}" aria-checked="${d.deviceId === cur}" tabindex="${d.deviceId === cur ? 0 : -1}"><span class="ck">${d.deviceId === cur ? icon('check') : ''}</span><span class="nm">${esc(cleanLabel(d.label) || 'Camera')}</span></button>`)
        .join('')}</div>
      <p class="h">The video matches the preview, mirrored or not.</p>`;
  } else {
    pop.setAttribute('aria-label', 'Background image');
    const items = [
      ...BUILTIN.map((b) => ({ ref: b.id, label: b.label, src: builtinThumb(b.id) })),
      ...(st.backgrounds || []).map((n, i) => ({ ref: `user:${n}`, label: `Your image ${i + 1}`, src: userBg(n) })),
    ];
    pop.innerHTML = `<div class="imgrow" id="imgs" role="radiogroup" aria-label="Background image">${items
      .map((it) => `<button role="radio" data-bgimg="${esc(it.ref)}" aria-checked="${it.ref === c.bgImage}" tabindex="${it.ref === c.bgImage ? 0 : -1}" aria-label="${esc(it.label)}" title="${esc(it.label)}" style="background-image:url('${it.src}')"></button>`)
      .join('')}<button class="add" data-act="choose-bg" aria-label="Choose image…" title="Choose image…">${icon('plus')}</button></div>`;
  }
}

// Main places the window from the tray's real size. minW is the narrowest the rows
// can be (332 today, §11.1); main never makes the tray narrower, so nothing clips.
let lastSize = '';
function reportSize() {
  requestAnimationFrame(() => {
    const height = tray.hidden ? 0 : tray.offsetHeight;
    const pillW = pill.hidden ? 0 : pill.offsetWidth;
    let minW = 0;
    if (!tray.hidden) {
      const w = tray.style.width;
      tray.style.width = 'min-content';
      minW = tray.offsetWidth;
      tray.style.width = w;
    }
    const key = `${height}|${pillW}|${minW}`;
    if (key === lastSize) return;
    lastSize = key;
    tally.invoke('camtray:size', { height: height || undefined, pillW: pillW || undefined, minW: minW || undefined });
  });
}

async function loadDevices() {
  try {
    devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId);
  } catch {
    devices = [];
  }
}
navigator.mediaDevices?.addEventListener('devicechange', () => loadDevices().then(render));

// ───────── actions ─────────

function setPop(kind) {
  popKind = kind;
  if (kind === 'settings') loadDevices().then(render);
  render();
}

box.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b || !st) return;
  const d = b.dataset;
  if (b.id === 'settingsBtn') setPop(popKind === 'settings' ? null : 'settings');
  else if (b.id === 'followBtn') save({ camera: { follow: !st.camera.follow } });
  else if (b.id === 'mirrorBtn') save({ camera: { mirror: st.camera.mirror === false } });
  else if (b.id === 'offBtn') {
    popKind = null;
    save({ camera: { on: false } });
  } else if (d.shape) save({ camera: { shape: d.shape } });
  else if (d.aspect) save({ camOnly: { aspect: d.aspect } });
  else if (d.bg) {
    // Image opens its picker; choosing Image again toggles it.
    if (d.bg === 'image') popKind = st.camera.background === 'image' && popKind === 'image' ? null : 'image';
    else if (popKind === 'image') popKind = null;
    save({ camera: { background: d.bg } });
  } else if (d.bgimg) save({ camera: { background: 'image', bgImage: d.bgimg } });
  else if (d.dev !== undefined) {
    const dev = devices.find((x) => x.deviceId === d.dev);
    save({ camera: { deviceId: d.dev || null, deviceLabel: dev?.label || null } });
  } else if (d.act === 'choose-bg') {
    const next = await tally.invoke('app:chooseImage', 'tray');
    if (next) {
      st = next;
      render();
    }
  } else if (d.act === 'turn-on') {
    if (view.camera === 'not-determined') {
      const r = await tally.invoke('app:cameraAccess');
      view.camera = r.status;
      if (!r.granted) return render();
    }
    save({ camera: { on: true } });
  } else if (d.act === 'open-settings') tally.invoke('app:openCameraSettings');
});

// ───────── zoom slider: pointer + keyboard ─────────

let zDrag = null;
function zoomAt(clientX) {
  const r = trk.getBoundingClientRect();
  return snapZoom(1 + ((clientX - r.left) / r.width) * (ZOOM_MAX - 1), camMax());
}
function setZoom(z) {
  z = snapZoom(z, camMax());
  renderZoom(z);
  if (z === st.camera.zoom) return;
  st.camera.zoom = z;
  tally.invoke('app:setSettings', { camera: { zoom: z } });
}
trk.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  trk.focus({ focusVisible: false }); // keyboard can follow, but a click shows no ring
  trk.setPointerCapture(e.pointerId);
  zDrag = e.pointerId;
  trk.classList.add('dragging');
  setZoom(zoomAt(e.clientX));
});
trk.addEventListener('pointermove', (e) => {
  if (zDrag !== e.pointerId) return;
  if (!(e.buttons & 1)) return endZoom(); // release was lost
  setZoom(zoomAt(e.clientX));
});
function endZoom() {
  zDrag = null;
  trk.classList.remove('dragging');
}
trk.addEventListener('pointerup', endZoom);
trk.addEventListener('pointercancel', endZoom);
trk.addEventListener('lostpointercapture', endZoom);
trk.addEventListener('keydown', (e) => {
  const z = st.camera.zoom;
  const next = { ArrowRight: z + 0.1, ArrowUp: z + 0.1, ArrowLeft: z - 0.1, ArrowDown: z - 0.1, Home: 1, End: ZOOM_MAX, 0: 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  setZoom(Math.round(next * 100) / 100);
});
$('zv').addEventListener('dblclick', () => setZoom(1));

// ───────── size slider: pointer + keyboard ─────────

let sDrag = null;
function diamAt(clientX) {
  const r = strk.getBoundingClientRect();
  return sizeLo() + ((clientX - r.left) / r.width) * (sizeHi() - sizeLo());
}
strk.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  strk.focus({ focusVisible: false });
  strk.setPointerCapture(e.pointerId);
  sDrag = e.pointerId;
  strk.classList.add('dragging');
  setDiam(diamAt(e.clientX));
});
strk.addEventListener('pointermove', (e) => {
  if (sDrag !== e.pointerId) return;
  if (!(e.buttons & 1)) return endSize(); // release was lost
  setDiam(diamAt(e.clientX));
});
function endSize() {
  sDrag = null;
  strk.classList.remove('dragging');
}
strk.addEventListener('pointerup', endSize);
strk.addEventListener('pointercancel', endSize);
strk.addEventListener('lostpointercapture', endSize);
strk.addEventListener('keydown', (e) => {
  const d = sizeDiam();
  const step = e.shiftKey ? 40 : 8;
  const next = { ArrowRight: d + step, ArrowUp: d + step, ArrowLeft: d - step, ArrowDown: d - step, Home: sizeLo(), End: sizeHi(), PageUp: d + 40, PageDown: d - 40 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  // Keys never snap to a detent: each press moves.
  const v = Math.round(Math.min(Math.max(next, sizeLo()), sizeHi()));
  renderSize(v);
  if (v === cameraDiam(st.camera)) return;
  st.camera.diam = v;
  tally.invoke('app:setSettings', { camera: { diam: v } });
});

// ───────── keyboard: roving radio groups, Tab ring through tray + bubble, Esc ─────────

box.addEventListener('keydown', (e) => {
  const g = e.target.closest('[role="radiogroup"]');
  const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (g && dir) {
    e.preventDefault();
    const items = [...g.querySelectorAll('[role="radio"]:not(:disabled)')];
    const i = items.indexOf(e.target.closest('[role="radio"]'));
    const next = items[(i + dir + items.length) % items.length];
    next.click();
    // render() rebuilt the group: focus the new selection
    requestAnimationFrame(() => focusChecked($(g.id)));
  }
});

function focusChecked(g) {
  (g?.querySelector('[aria-checked="true"]') || g?.querySelector('[role="radio"]'))?.focus();
}

const tabStops = () => [...box.querySelectorAll('[tabindex="0"], button:not([tabindex])')].filter((el) => el.offsetParent && !el.closest('[hidden]'));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    if (popKind) {
      const back = popKind === 'settings' ? $('settingsBtn') : $('bgs').querySelector('[aria-checked="true"]');
      setPop(null);
      back?.focus();
    } else tally.invoke('camtray:close');
    return;
  }
  if (e.key !== 'Tab') return;
  // Order follows the rows (SETUP_V2 §11): size (or aspect) → zoom → shape → background →
  // settings → camera off → Follow me → Mirror → bubble.
  const stops = tabStops();
  const i = stops.indexOf(document.activeElement);
  const last = i === stops.length - 1;
  const first = i <= 0;
  if ((!e.shiftKey && last) || (e.shiftKey && first)) {
    e.preventDefault();
    tally.invoke('camtray:focusBubble');
  }
});

tally.on('camtray:focus', (where) => {
  const stops = tabStops();
  (where === 'last' ? stops.at(-1) : stops[0])?.focus();
});

// ───────── click-through outside the drawn parts ─────────

let inside = false;
function hit(x, y) {
  for (const el of [tray, pill, pop]) {
    if (el.hidden || box.hidden) continue;
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
  }
  return false;
}
document.addEventListener('mousemove', (e) => {
  const v = hit(e.clientX, e.clientY) || zDrag !== null || sDrag !== null;
  if (v === inside) return;
  inside = v;
  tally.invoke('camtray:mouse', v);
});

// ───────── state from main ─────────

tally.on('camtray:state', (v) => {
  const wasVisible = view.visible;
  view = { ...view, ...v };
  if (!v.visible) {
    popKind = null;
    endZoom();
    endSize();
    inside = false;
  }
  if (v.visible && !wasVisible) loadDevices().then(render);
  render();
});
// Toolbar home outline while the toolbar is dragged (main sends display-local rects).
tally.on('camtray:ghost', (g) => {
  const el = $('ghost');
  el.hidden = !g;
  if (!g) return;
  Object.assign(el.style, { left: `${g.x}px`, top: `${g.y}px`, width: `${g.width}px`, height: `${g.height}px` });
  el.classList.toggle('near', !!g.near);
});
tally.on('app:settings', (s) => {
  st = s;
  if (!st.camera.on || st.camera.background !== 'image') popKind = popKind === 'image' ? null : popKind;
  render();
});
tally.on('app:camera', (dims) => {
  view.camDims = dims;
  render();
});

tally.invoke('camtray:init').then((r) => {
  st = r.settings;
  view.camera = r.camera;
  view.camDims = r.camDims;
  render();
});
