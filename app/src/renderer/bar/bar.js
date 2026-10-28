// Setup toolbar → countdown → recording bar (SETUP_V2 §3.1, §3.8, §15). One window, one
// pill. Main places the pill's left edge (it is the anchor: unfolding grows it right,
// and Record → countdown → bar keeps it); this page draws the pill, its popovers,
// tooltips and the notice line, and reports the pill's width.
import { privacyEntries } from '../../shared/privacy.js';
import { installIcons, icon, keys, cmd, fmtTime, esc } from '../shared/ui.js';
import { micChoices, micConstraints, peakOf, meterLevel } from '../../shared/mic.js';

const tally = window.tally;
installIcons();
const $ = (id) => document.getElementById(id);
const pill = $('pill');
const pop = $('pop');
const notice = $('notice');
const isMac = tally.platform === 'darwin';
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const spoken = (k) => (isMac ? `Option Shift ${k}` : `Alt Shift ${k}`);

const COUNTDOWN_MS = 3000;
const GUARD_MS = 600; // S26: every bar control ignores clicks this long after the bar changes shape
const COVERS = [
  ['glow', 'Glow'],
  ['deepblue', 'Night'],
  ['fog', 'Fog'],
  ['graphite', 'Graphite'],
  ['black', 'Black'],
  ['wallpaper', 'Wallpaper'],
];

let snap = null; // session
let st = null; // settings
let setup = { open: false };
let place = { ox: 200, oy: 424, down: false };
let view = null; // 'setup' | 'countdown' | 'rec' | 'confirm' | 'warn' | null
let popKind = null; // 'chip' | 'cover' | 'more'
let armedUntil = 0;
let armedTimer = 0;
let lastW = 0;
let anim = null; // fold animation in flight
let hovering = false;
let drag = null;
let tipTimer = 0;
let tick = 0;
let cdStart = 0;
let cdRaf = 0;
let wallThumb = null;
let micPerm = null; // macOS microphone permission, when known ('granted' | 'denied' | …)
let micDevs = []; // audio inputs for the picker in More
let meter = null; // { stream, ac, analyser, raf, deviceId }: the level preview while More is open

function viewOf() {
  if (!snap) return null;
  const s = snap.state;
  if (s === 'idle') return setup.open ? 'setup' : null;
  if (s === 'countdown') return 'countdown';
  if (s === 'confirm') return 'confirm';
  if (s === 'finalizing') return null;
  return snap.warning ? 'warn' : 'rec';
}

const unfolded = () => !!st?.toolbar?.unfolded;
const collapsed = () => !!st?.toolbar?.collapsed;

// Collapse (−) / expand: the minimal pill stays out of the camera's way until expanded.
const collapseBtn = () => `<button class="b tgl" data-k="collapse" data-act="collapse" aria-label="Collapse toolbar" data-tip="Collapse">${icon('collapse')}</button>`;
const expandBtn = () => `<button class="b tgl" data-k="expand" data-act="expand" aria-label="Expand toolbar" data-tip="Expand" data-key="${cmd('\\')}">${icon('resize')}</button>`;

// ───────── views ─────────

function recordBtn() {
  const why = setup.recordWhy;
  return `<button class="rec2" data-k="record" data-act="record" ${why ? 'aria-disabled="true"' : ''} aria-label="Record, ${spoken('R')}${why ? `. ${esc(why)}` : ''}" data-tip="${esc(why || 'Record')}" data-key="${why ? '' : keys('R')}"><span class="rdot" aria-hidden="true"></span>Record<span class="kbd">${keys('R')}</span></button>`;
}

const camOnly = () => st.source.mode === 'camera';
const SRC_ICON = { display: 'monitor', window: 'window', camera: 'cam-only' };
const srcIcon = () => SRC_ICON[st.source.mode] || 'monitor';

function sourceLabel() {
  if (camOnly()) return `Camera only · ${st.camOnly?.aspect || '16:9'}`;
  if (st.source.mode !== 'window') return 'Full screen';
  if (setup.window) return setup.window.title || setup.window.app || 'Window';
  return 'Choose a window';
}

function coverSwatch() {
  const cd = st.cleanDesktop;
  if (!cd.on) return '<span class="sw2 cv-none"></span>';
  if (cd.cover === 'image' && cd.image) return `<span class="sw2" style="background-image:url('app://tally/user/covers/${encodeURIComponent(cd.image)}')"></span>`;
  if (cd.cover === 'wallpaper' && wallThumb) return `<span class="sw2" style="background-image:url('${wallThumb}')"></span>`;
  return `<span class="sw2 cv-${esc(cd.cover)}"></span>`;
}

// Privacy level (Full screen only): what the video hides; the real bars stay usable.
const PRIVACY = [
  ['standard', 'Standard'],
  ['semi', 'Semi-private'],
  ['very', 'Very private'],
];
const privacy = () => (st.cleanDesktop.privacy in { semi: 1, very: 1 } ? st.cleanDesktop.privacy : 'standard');
const keepsDock = () => st.cleanDesktop.keep !== 'menubar';
const pvName = () => PRIVACY.find(([k]) => k === privacy())[1];
// Tiny, non-interactive: the collapsed pill only says that bars are hidden in the video.
const pvEntries = (fullScreen) => privacyEntries({ fullScreen, coverAvailable: !!setup.coverAvailable, privacy: privacy() });
const pvDot = (fullScreen) => (pvEntries(fullScreen).collapsedDot ? `<span class="pvdot" role="img" aria-label="${pvName()}: ${privacyHidden()} in the video" title="${pvName()} · ${privacyHidden()}">${icon('eye-off')}</span>` : '');
function privacyHidden() {
  if (privacy() === 'very') return 'menu bar and Dock hidden';
  if (privacy() === 'semi') return keepsDock() ? 'menu bar hidden' : 'Dock hidden';
  return '';
}

const coverName = () => (st.cleanDesktop.on ? [...COVERS, ['image', 'Image']].find(([k]) => k === st.cleanDesktop.cover)?.[1] || 'On' : 'Off');

// Speaker notes toggle (§12.1): lit while the panel is open; hides / shows it, never pauses.
const notesBtn = () => {
  const on = !!st.notes?.open;
  return `<button class="b x-unf ${on ? 'on' : 'quiet'}" data-k="notes" data-act="notes" aria-pressed="${on}" aria-label="Speaker notes" data-tip="Speaker notes">${icon('notes')}</button>`;
};

function setupHtml() {
  const c = st.camera;
  const win = st.source.mode === 'window';
  const cam = camOnly();
  const full = !win && !cam;
  const grip = '<span class="grip2" data-drag aria-hidden="true"></span>';
  if (collapsed()) {
    const why = setup.recordWhy;
    return {
      label: 'Recording setup, collapsed',
      html: `<button class="xbadge" data-k="close" data-act="close" tabindex="-1" aria-label="Close setup" data-tip="Close setup" data-key="Esc">${icon('x')}</button>
        ${grip}${expandBtn()}${pvDot(full && setup.coverAvailable)}
        <button class="rec2 mini" data-k="record" data-act="record" ${why ? 'aria-disabled="true"' : ''} aria-label="Record, ${spoken('R')}${why ? `. ${esc(why)}` : ''}" data-tip="${esc(why || 'Record')}" data-key="${why ? '' : keys('R')}"><span class="rdot" aria-hidden="true"></span></button>`,
    };
  }
  if (!unfolded()) {
    // Privacy is always one click away in Full screen (it doesn't apply to a window):
    // eye-off when bars are hidden in the video (S22), a plain eye at Standard.
    const pvF = pvEntries(full).folded;
    const pvStat = pvF ? 1 : 0;
    const pvOn = !!pvF?.on;
    const stat = [
      !c.on && !cam ? `<button class="b stat" data-k="stat-cam" data-act="camera-on" aria-label="Camera off, click to turn on" data-tip="Camera off · click to turn on">${icon('camera-off')}</button>` : '',
      st.systemAudio && !cam ? `<button class="b stat on" data-k="stat-audio" data-act="audio-off" aria-label="System audio on, click to turn off" data-tip="System audio on · click to turn off">${icon('speaker')}</button>` : '',
      st.mic.on ? `<button class="b stat on" data-k="stat-mic" data-act="mic-off" aria-label="Microphone on, click to turn off" data-tip="Microphone on · click to turn off">${icon('mic')}</button>` : '',
      pvStat ? `<button class="b stat ${pvOn ? 'on' : ''}" data-k="stat-privacy" data-act="privacy-open" data-pop="cover" aria-haspopup="dialog" aria-expanded="${popKind === 'cover'}" aria-label="Privacy: ${pvName()}${pvOn ? `, ${privacyHidden()} in the video` : ''}. Click to change" data-tip="Privacy · ${pvName()}${pvOn ? ` · ${privacyHidden()}` : ''}">${icon(pvF.icon)}</button>` : '',
    ].join('');
    return {
      label: `Recording setup, ${3 + (!c.on && !cam) + (st.systemAudio && !cam) + st.mic.on + pvStat} controls`,
      html: `<button class="xbadge" data-k="close" data-act="close" tabindex="-1" aria-label="Close setup" data-tip="Close setup" data-key="Esc">${icon('x')}</button>
        ${grip}
        <button class="b tgl" data-k="fold" data-act="fold" aria-expanded="false" aria-label="All controls" data-tip="All controls" data-key="${cmd('\\')}">${icon('chev-r')}</button>
        ${collapseBtn()}
        <button class="chip2" data-k="chip" data-act="chip" aria-haspopup="menu" aria-expanded="${popKind === 'chip'}" aria-label="Source: ${esc(sourceLabel())}">${icon(srcIcon())}<span class="lbl">${esc(sourceLabel())}</span>${icon('chev-d', 'cd')}</button>
        ${stat}${recordBtn()}`,
    };
  }
  const cover = setup.coverAvailable
    ? `<button class="b swb x-unf" data-k="cover" data-act="cover" aria-haspopup="dialog" aria-expanded="${popKind === 'cover'}" ${full ? '' : 'aria-disabled="true"'} aria-label="Desktop cover &amp; privacy: ${coverName()}, ${pvName()}" data-tip="${win ? 'No cover in Window mode' : cam ? 'No desktop in Camera only' : 'Desktop cover &amp; privacy'}">${coverSwatch()}</button>`
    : '';
  return {
    label: `Recording setup, ${setup.coverAvailable ? 11 : 10} controls`,
    html: `${grip}
      <button class="b tgl" data-k="fold" data-act="fold" aria-expanded="true" aria-label="Fewer controls" data-tip="Fewer controls" data-key="${cmd('\\')}">${icon('chev-l')}</button>
      <button class="b quiet x-unf" data-k="close" data-act="close" aria-label="Close setup" data-tip="Close setup" data-key="Esc">${icon('x')}</button>
      ${collapseBtn()}
      <div class="srcg x-unf" role="radiogroup" aria-label="Source">
        <button role="radio" data-k="src-display" data-act="source-display" aria-checked="${full}" tabindex="${full ? 0 : -1}" aria-label="Full screen" data-tip="${full ? '' : 'Full screen'}">${icon('monitor')}${full ? '<span class="lbl">Full screen</span>' : ''}</button>
        <button role="radio" data-k="src-window" data-act="source-window" aria-checked="${win}" tabindex="${win ? 0 : -1}" aria-label="Window${win ? `: ${esc(sourceLabel())}` : ''}" data-tip="${win ? 'Pick another window' : 'Window'}">${icon('window')}${win ? `<span class="lbl">${esc(sourceLabel())}</span>` : ''}</button>
        <button role="radio" data-k="src-camera" data-act="source-camera" aria-checked="${cam}" tabindex="${cam ? 0 : -1}" aria-label="Camera only${cam ? `, ${esc(st.camOnly?.aspect || '16:9')}` : ''}" data-tip="${cam ? '' : 'Camera only · no screen'}">${icon('cam-only')}${cam ? '<span class="lbl">Camera only</span>' : ''}</button>
      </div>
      <span class="gap"></span>
      ${cam ? '' : `<button class="b x-unf ${c.on ? '' : 'off'}" data-k="cam" data-act="camera-toggle" role="switch" aria-checked="${c.on}" aria-label="Camera" data-tip="${c.on ? 'Camera on' : 'Camera off'}">${icon(c.on ? 'camera' : 'camera-off')}</button>`}
      ${cam
        ? `<button class="b x-unf off" data-k="audio" data-act="audio-toggle" role="switch" aria-checked="false" aria-disabled="true" aria-label="System audio, not available in Camera only" data-tip="No system audio in Camera only">${icon('speaker-off')}</button>`
        : `<button class="b x-unf ${st.systemAudio ? '' : 'off'}" data-k="audio" data-act="audio-toggle" role="switch" aria-checked="${st.systemAudio}" aria-label="System audio" data-tip="${st.systemAudio ? 'System audio on' : 'System audio off'}">${icon(st.systemAudio ? 'speaker' : 'speaker-off')}</button>`}
      <button class="b x-unf ${st.mic.on ? '' : 'off'}" data-k="mic" data-act="mic-toggle" role="switch" aria-checked="${st.mic.on}" aria-label="Microphone" data-tip="${st.mic.on ? 'Microphone on' : 'Microphone off'}">${icon(st.mic.on ? 'mic' : 'mic-off')}</button>
      ${notesBtn()}
      ${cover}
      <button class="b quiet x-unf" data-k="more" data-act="more" aria-haspopup="menu" aria-expanded="${popKind === 'more'}" aria-label="More" data-tip="More">${icon('dots')}</button>
      ${recordBtn()}`,
  };
}

function countdownHtml() {
  return {
    label: 'Countdown',
    html: `<span class="grip2" data-drag aria-hidden="true"></span>
      <button class="b cx" data-k="cancel-cd" data-act="cancel-countdown" aria-label="Cancel, Escape" data-tip="Cancel" data-key="Esc">${icon('x')}</button>
      <div class="armed" role="timer" aria-live="off"><span class="n"><svg viewBox="0 0 30 30" aria-hidden="true"><circle id="cdRing" cx="15" cy="15" r="14"></circle></svg><span id="cdN">3</span></span><span id="cdT">Recording in 3</span><small><span class="kbd">Esc</span> cancel · <span class="kbd">Space</span> now</small></div>`,
  };
}

const elapsed = () => (snap ? snap.elapsedMs + (snap.state === 'recording' ? Date.now() - snap.at : 0) : 0);

function ctl(act, inner, label, key, cls = '') {
  return `<button class="b ${cls}" data-k="${act}" data-act="${act}" aria-label="${label}, ${spoken(key)}" data-tip="${label}" data-key="${keys(key)}">${inner}</button>`;
}

function recHtml() {
  const paused = snap.state === 'paused';
  const unf = unfolded();
  const camOff = snap.cameraHidden || !snap.cameraOn;
  const extras = unf
    ? `<span class="gap"></span>
      ${ctl('restart', icon('restart'), 'Restart', 'Z', 'x-unf')}
      ${ctl('cancel', icon('trash'), 'Discard', 'X', 'x-unf')}
      ${notesBtn()}
      ${snap.cameraOnly
        ? ctl('camera', icon(snap.cameraHidden ? 'eye-off' : 'eye'), snap.cameraHidden ? 'Show preview' : 'Hide preview', 'C', `x-unf ${snap.cameraHidden ? 'off' : ''}`)
        : snap.cameraOn ? ctl('camera', icon(camOff ? 'camera-off' : 'camera'), camOff ? 'Show camera' : 'Hide camera', 'C', `x-unf ${camOff ? 'off' : ''}`) : ''}`
    : '';
  if (collapsed()) {
    // Smallest form that still has stop, pause and restart (start is the setup pill's).
    return {
      label: `Recording controls, collapsed, ${paused ? 'paused' : 'recording'}`,
      html: `<span class="grip2" data-drag aria-hidden="true"></span>${expandBtn()}${pvDot(snap.target?.kind === 'display')}
        <button class="stop" data-k="stop" data-act="stop" aria-label="Stop, ${spoken('R')}" data-tip="Stop" data-key="${keys('R')}"><span class="sq"></span></button>
        ${paused ? ctl('pause', icon('play'), 'Resume', 'P', 'on') : ctl('pause', icon('pause'), 'Pause', 'P')}
        ${ctl('restart', icon('restart'), 'Restart', 'Z')}`,
    };
  }
  const chips = [snap.bgStatus === 'paused' ? 'Background paused' : '', snap.autoHidden ? 'Window too small for camera' : ''].filter(Boolean).map((t) => `<span class="chipw">${icon('warn', 's14')}${t}</span>`).join('');
  return {
    label: 'Recording controls',
    html: `<span class="grip2" data-drag aria-hidden="true"></span>
      <button class="b tgl" data-k="fold" data-act="fold" aria-expanded="${unf}" aria-label="${unf ? 'Fewer controls' : 'All controls'}" data-tip="${unf ? 'Fewer controls' : 'All controls'}" data-key="${cmd('\\')}">${icon(unf ? 'chev-l' : 'chev-r')}</button>
      ${collapseBtn()}
      <div class="time ${paused ? 'paused' : ''}" role="timer" aria-live="off"><span class="dot ${paused ? 'hold' : 'pulse'}" aria-hidden="true"></span><span id="t">${fmtTime(elapsed())}</span></div>
      <button class="stop" data-k="stop" data-act="stop" aria-label="Stop, ${spoken('R')}" data-tip="Stop" data-key="${keys('R')}"><span class="sq"></span></button>
      ${paused ? ctl('pause', icon('play'), 'Resume', 'P') : ctl('pause', icon('pause'), 'Pause', 'P')}
      ${extras}${chips}`,
  };
}

function confirmHtml() {
  const restart = snap.confirm.kind === 'restart';
  const sub = restart ? `paused at ${fmtTime(elapsed())}` : 'paused · no file saved';
  return {
    label: `Recording paused. ${restart ? 'Restart recording?' : 'Discard recording?'}`,
    role: 'alertdialog',
    html: `<div class="q"><span class="dot hold" aria-hidden="true"></span>${restart ? 'Restart take?' : 'Discard take?'} <small>${sub}</small></div>
      <button class="pbtn" data-k="keep" data-act="keep">Keep going <span class="kbd">Esc</span></button>
      <button class="pbtn go" data-k="confirm" data-act="confirm">${restart ? 'Restart' : 'Discard'} <span class="kbd">${keys(restart ? 'Z' : 'X')}</span></button>`,
  };
}

function warnHtml() {
  const w = snap.warning;
  return {
    label: w.text,
    role: 'alert',
    html: `<span class="note">${icon('warn')} ${esc(w.text)} <small>· paused at ${fmtTime(w.atMs)}</small></span>
      ${w.canSwitch ? '<button class="pbtn" data-k="switch" data-act="switch">Switch to display</button>' : '<button class="pbtn" data-k="pause" data-act="pause">Resume</button>'}
      <button class="pbtn go" data-k="stop" data-act="stop"><span class="sq" aria-hidden="true"></span>Stop &amp; save</button>`,
  };
}

// ───────── render ─────────

function render({ fold = false } = {}) {
  const v = viewOf();
  if (v !== view) {
    // S26: the bar just changed shape under the pointer (setup → countdown → bar).
    if (view && v) armedUntil = performance.now() + GUARD_MS;
    if (v !== 'setup') popKind = null;
    if (v === 'countdown') cdStart = performance.now();
    view = v;
  }
  clearTip();
  cancelAnimationFrame(cdRaf);
  clearInterval(tick);
  if (!v || !st) {
    pill.innerHTML = '';
    pill.hidden = true;
    pop.hidden = true;
    notice.hidden = true;
    syncMeter();
    return;
  }
  pill.hidden = false;
  if (anim) finishAnim();
  const focusK = pill.contains(document.activeElement) ? document.activeElement.closest('[data-k]')?.dataset.k : null;
  const w0 = pill.offsetWidth;
  const r = { setup: setupHtml, countdown: countdownHtml, rec: recHtml, confirm: confirmHtml, warn: warnHtml }[v]();
  pill.className = ['glass', `v-${v}`, (v === 'setup' || v === 'rec') && collapsed() ? 'collapsed' : '', hovering ? 'hover' : '', drag?.moved ? 'dragging' : '', performance.now() < armedUntil ? 'armed' : ''].join(' ');
  pill.setAttribute('role', r.role || 'toolbar');
  pill.setAttribute('aria-label', r.label);
  pill.style.width = '';
  pill.innerHTML = r.html;
  clearTimeout(armedTimer);
  if (performance.now() < armedUntil) armedTimer = setTimeout(() => pill.classList.remove('armed'), armedUntil - performance.now());
  const w1 = pill.offsetWidth;
  if (fold && !reduce.matches && w0 && w0 !== w1) animateFold(w0, w1);
  else reportWidth(w1);
  if (focusK) {
    // Folding while focus is on a control that disappears moves focus to the chevron (§15.4).
    (pill.querySelector(`[data-k="${focusK}"]`) || pill.querySelector('[data-k="fold"]'))?.focus();
  }
  renderPop();
  renderNotice();
  position();
  syncMeter();
  if (v === 'countdown') countdownTick();
  if (v === 'rec' && snap.state === 'recording') {
    tick = setInterval(() => {
      const t = $('t');
      if (t) t.textContent = fmtTime(elapsed());
    }, 250);
  }
}

function reportWidth(w) {
  if (w === lastW) return;
  lastW = w;
  tally.invoke('bar:width', w);
}

// Unfold: width springs open in 220 ms and the new controls fade + scale in, 15 ms apart,
// left to right. Fold: 160 ms ease-out. The left edge never moves (§15.2).
function animateFold(w0, w1) {
  const opening = w1 > w0;
  reportWidth(Math.max(w0, w1)); // room first, so nothing clips
  if (opening) pill.querySelectorAll('.x-unf').forEach((el, i) => {
    el.classList.add('rv');
    el.style.setProperty('--i', i);
  });
  pill.style.width = `${w0}px`;
  pill.classList.add('anim', opening ? 'unfolding' : 'folding');
  void pill.offsetWidth;
  pill.style.width = `${w1}px`;
  anim = { w1, t: setTimeout(finishAnim, opening ? 260 : 200) };
}

function finishAnim() {
  if (!anim) return;
  clearTimeout(anim.t);
  const { w1 } = anim;
  anim = null;
  pill.classList.remove('anim', 'unfolding', 'folding');
  pill.style.width = '';
  reportWidth(w1);
}

function position() {
  pill.style.left = `${place.ox}px`;
  pill.style.top = `${place.oy}px`;
  placeNotice();
  placePop();
}

function countdownTick() {
  const C = 2 * Math.PI * 14;
  const ring = $('cdRing');
  if (ring) ring.style.strokeDasharray = `${C}`;
  const step = () => {
    const left = Math.max(0, COUNTDOWN_MS - (performance.now() - cdStart));
    const n = Math.max(1, Math.ceil(left / 1000));
    const N = $('cdN');
    if (!N) return;
    if (N.textContent !== String(n)) {
      N.textContent = n;
      $('cdT').textContent = `Recording in ${n}`;
    }
    const frac = (left % 1000) / 1000 || (left > 0 ? 1 : 0);
    if (ring) ring.style.strokeDashoffset = `${reduce.matches ? 0 : C * (1 - frac)}`;
    if (left > 0) cdRaf = requestAnimationFrame(step);
  };
  step();
}

// ───────── notice line ─────────

function renderNotice() {
  let n = null;
  if (view === 'setup' && !popKind) n = setup.notice || (setup.recordWhy ? { kind: 'why', tone: 'warn', text: setup.recordWhy } : null);
  if ((view === 'rec' || view === 'warn') && snap.toast) {
    const t = snap.toast;
    n = { kind: 'toast', tone: 'warn', icon: t.icon, html: `<b>${esc(t.title)}</b> ${esc(t.text)}`, dismiss: t.sticky, role: t.kind === 'camera' || t.kind === 'mic' ? 'status' : 'alert' };
  }
  notice.hidden = !n;
  if (!n) return;
  notice.className = `notice glass ${n.tone === 'bad' ? 'bad' : ''} ${n.wrap ? 'wrap' : ''}`;
  notice.setAttribute('role', n.role || (n.tone === 'bad' ? 'alert' : 'status'));
  const ACT = { perm: 'screen-settings', micperm: 'mic-settings', camperm: 'camera-settings' };
  const act = ACT[n.kind] ? `<button class="act" data-act="${ACT[n.kind]}">${esc(n.action)}</button>` : '';
  const x = n.dismiss ? `<button class="tx" data-act="${n.kind === 'toast' ? 'dismiss' : 'dismiss-notice'}" data-kind="${n.kind}" aria-label="Dismiss">${icon('x')}</button>` : '';
  notice.innerHTML = `${icon(n.icon || (n.tone === 'bad' ? 'alert' : 'warn'))}<span>${n.html || esc(n.text)}</span>${act}${x}`;
  placeNotice();
}

function placeNotice() {
  if (notice.hidden) return;
  notice.style.left = `${place.ox}px`;
  notice.style.top = place.down ? `${place.oy + 56 + 8}px` : `${place.oy - 8 - notice.offsetHeight}px`;
}

// ───────── popovers ─────────

function renderPop() {
  if (view !== 'setup' || !popKind) {
    pop.hidden = true;
    return;
  }
  pop.hidden = false;
  pop.className = `gpop glass ${popKind === 'chip' ? 'chipmenu' : popKind}${place.down ? ' down' : ''}`;
  if (popKind === 'chip') pop.innerHTML = chipMenu();
  else if (popKind === 'cover') pop.innerHTML = coverPicker();
  else pop.innerHTML = moreMenu();
}

function chipMenu() {
  const win = st.source.mode === 'window';
  const cam = camOnly();
  const full = !win && !cam;
  pop.setAttribute('role', 'menu');
  pop.setAttribute('aria-label', 'Source');
  return `<button class="mrow" role="menuitemradio" aria-checked="${full}" data-act="source-display">${icon('monitor')}<span class="l">Full screen</span>${full ? icon('check', 'ck') : ''}</button>
    <button class="mrow tall" role="menuitemradio" aria-checked="${win}" data-act="source-window">${icon('window')}<span class="l">Window…<small>${win && setup.window ? esc(setup.window.title) : 'Pick on screen'}</small></span>${win ? icon('check', 'ck') : ''}</button>
    <button class="mrow tall" role="menuitemradio" aria-checked="${cam}" data-act="source-camera">${icon('cam-only')}<span class="l">Camera only<small>${cam ? `${esc(st.camOnly?.aspect || '16:9')} · no screen` : 'Just you, no screen'}</small></span>${cam ? icon('check', 'ck') : ''}</button>`;
}

function coverPicker() {
  const cd = st.cleanDesktop;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Desktop cover');
  const cell = (id, label, cls, inner = '', style = '') => `<button class="swc" role="radio" data-act="cover-set" data-cover="${id}" aria-checked="${id === 'off' ? !cd.on : cd.on && cd.cover === id}" tabindex="${(id === 'off' ? !cd.on : cd.on && cd.cover === id) ? 0 : -1}" aria-label="${label}"><span class="s ${cls}"${style}>${inner}</span>${label}</button>`;
  const cells = [
    cell('off', 'Off', 'cv-off', icon('monitor')),
    ...COVERS.map(([id, label]) => (id === 'wallpaper' && wallThumb ? cell(id, label, '', '', ` style="background-image:url('${wallThumb}')"`) : cell(id, label, `cv-${id}`))),
    cd.image
      ? cell('image', 'Image', '', '', ` style="background-image:url('app://tally/user/covers/${encodeURIComponent(cd.image)}')"`)
      : `<button class="swc" data-act="choose-cover" aria-label="Choose an image…"><span class="s add">${icon('plus')}</span>Image…</button>`,
  ];
  const pv = privacy();
  const seg = (label, items, cur, act, attr) =>
    `<div class="gseg pv" role="radiogroup" aria-label="${label}">${items.map(([id, l]) => `<button role="radio" data-act="${act}" data-${attr}="${id}" data-k="${act}-${id}" aria-checked="${id === cur}" tabindex="${id === cur ? 0 : -1}">${l}</button>`).join('')}</div>`;
  const hint = {
    standard: 'Windows, the menu bar and the Dock still record.',
    semi: `The ${keepsDock() ? 'menu bar' : 'Dock'} is hidden in the video. You still see and use it.`,
    very: 'The menu bar and Dock are hidden in the video. You still see and use them.',
  }[pv];
  return `<h4>Desktop cover <small>hides icons and wallpaper</small></h4>
    <div class="swg" role="radiogroup" aria-label="Desktop cover">${cells.join('')}</div>
    <div class="msep"></div>
    <h4 class="pvh" id="pvHead">Privacy <small>what the video hides · Full screen only</small></h4>
    ${seg('Privacy', PRIVACY, pv, 'privacy', 'pv')}
    ${pv === 'semi' ? seg('Semi-private shows', [['dock', 'Show Dock'], ['menubar', 'Show menu bar']], keepsDock() ? 'dock' : 'menubar', 'keep', 'pv') : ''}
    <p class="h">${hint} Applies now.${cd.image ? ' Click Image again to choose another.' : ''}</p>`;
}

function moreMenu() {
  pop.setAttribute('role', 'menu');
  pop.setAttribute('aria-label', 'More');
  const q = st.quality.size;
  const pvMore = pvEntries(st.source.mode === 'display').more;
  const cam = camOnly();
  return `<div class="mrow tall${cam ? ' dim' : ''}">${icon(st.systemAudio && !cam ? 'speaker' : 'speaker-off')}<span class="l">System audio<small>${cam ? 'Needs screen recording: not in Camera only.' : 'Sound from apps. Off by default.'}</small></span><span class="switch" role="switch" tabindex="0" data-act="audio-toggle" aria-checked="${st.systemAudio && !cam}" ${cam ? 'aria-disabled="true"' : ''} aria-label="System audio"></span></div>
    ${micRows()}
    <div class="mrow">${icon('hd')}<span class="l">Size</span><div class="gseg" role="radiogroup" aria-label="Size"><button role="radio" data-act="quality" data-q="1080p" aria-checked="${q !== 'native'}" tabindex="${q !== 'native' ? 0 : -1}">1080p</button><button role="radio" data-act="quality" data-q="native" aria-checked="${q === 'native'}" tabindex="${q === 'native' ? 0 : -1}">Native</button></div></div>
    <div class="mrow"><span class="i" aria-hidden="true"></span><span class="l">Frames</span><div class="gseg" role="radiogroup" aria-label="Frames"><button role="radio" aria-checked="true" tabindex="0">30</button><button role="radio" aria-checked="false" aria-disabled="true" disabled title="60 fps comes later">60</button></div></div>
    <div class="cost">≈ ${setup.gbPerHour} GB/hour${cam ? (setup.camOut ? ` · video ${setup.camOut.width}×${setup.camOut.height}` : '') : setup.display ? ` · display ${setup.display.px}` : ''}</div>
    ${pvMore ? `<button class="mrow tall" role="menuitem" data-act="privacy-open" ${pvMore.disabled ? 'aria-disabled="true"' : ''}>${icon(pvMore.icon)}<span class="l">Privacy<small>${pvMore.disabled || `${pvName()}${privacy() === 'standard' ? '' : ` · ${privacyHidden()}`}`}</small></span>${icon('chev-r', 'chev')}</button>` : ''}
    <div class="msep"></div>
    <button class="mrow" role="menuitem" data-act="library">${icon('library')}<span class="l">Recordings</span><span class="k">${cmd('L')}</span></button>
    <button class="mrow" role="menuitem" data-act="settings">${icon('sliders')}<span class="l">Settings…</span><span class="k">${cmd(',')}</span></button>
    <button class="mrow" role="menuitem" data-act="quit">${icon('quit')}<span class="l">Quit Tally</span><span class="k">${cmd('Q')}</span></button>`;
}

// Microphone (optional, off by default): switch, then (when on) the device list and a
// live level so you can see it hears you. Denied: why, and the way to System Settings.
function micRows() {
  const on = st.mic.on;
  const row = `<div class="mrow tall">${icon(on ? 'mic' : 'mic-off')}<span class="l">Microphone<small>Your voice. Off by default.</small></span><span class="switch" role="switch" tabindex="0" data-act="mic-toggle" aria-checked="${on}" aria-label="Microphone"></span></div>`;
  if (['denied', 'restricted'].includes(micPerm)) {
    return `${row}<div class="micx" role="alert">${icon('warn', 's14')}<span>Microphone access is off for Tally. Turn it on in System Settings › Privacy &amp; Security › Microphone.</span><button class="act" data-act="mic-settings">Open Settings</button></div>`;
  }
  if (!on) return row;
  const { list, current } = micChoices(micDevs, st.mic);
  const devs = list.length
    ? list.map((d) => `<button class="dev" role="radio" data-act="mic-dev" data-dev="${esc(d.deviceId)}" aria-checked="${d.deviceId === current}" tabindex="${d.deviceId === current ? 0 : -1}"><span class="ck">${d.deviceId === current ? icon('check') : ''}</span><span class="nm">${esc(d.label)}</span></button>`).join('')
    : '<span class="dev none">No microphone found</span>';
  return `${row}<div class="micd"><div class="devs" role="radiogroup" aria-label="Microphone device">${devs}</div>
    <div class="lvl" role="meter" aria-label="Microphone level" aria-valuemin="0" aria-valuemax="100"><span id="micLvl"></span></div></div>`;
}

async function loadMicDevices() {
  try {
    micDevs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId);
  } catch {
    micDevs = [];
  }
}
navigator.mediaDevices?.addEventListener('devicechange', () => {
  if (popKind === 'more' && st?.mic.on) loadMicDevices().then(render);
});

// Turning it on asks macOS first (not-determined → the system prompt). Denied: the switch
// stays off and More says why, with the button to System Settings.
async function micToggle(on) {
  if (!on) return save({ mic: { on: false } });
  const r = await tally.invoke('app:micAccess');
  micPerm = r.status;
  if (!r.granted) return popKind === 'more' ? render() : openPop('more');
  await save({ mic: { on: true } });
}

// The level preview runs only while More is open with the mic on, so the mic (and the
// orange dot in the menu bar) is used only when you are looking at the meter.
function syncMeter() {
  const want = view === 'setup' && popKind === 'more' && st?.mic.on && !['denied', 'restricted'].includes(micPerm) ? micChoices(micDevs, st.mic).current || 'any' : null;
  if (meter && meter.deviceId === want) return;
  stopMeter();
  if (want) startMeter(want);
}

async function startMeter(deviceId) {
  const m = { deviceId, stream: null, ac: null, raf: 0 };
  meter = m;
  try {
    const stream = await navigator.mediaDevices.getUserMedia(micConstraints(deviceId === 'any' ? null : deviceId));
    if (meter !== m) return stream.getTracks().forEach((t) => t.stop());
    m.stream = stream;
    if (deviceId === 'any') {
      // First use: device ids (and labels) are visible now that access is granted.
      await loadMicDevices();
      if (meter === m) render();
    }
    m.ac = new AudioContext();
    const analyser = m.ac.createAnalyser();
    analyser.fftSize = 1024;
    m.ac.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let shownLevel = 0;
    const step = () => {
      if (meter !== m) return;
      // Fast attack, slow release, like a hardware meter.
      const lv = meterLevel(peakOf(analyser, buf));
      shownLevel = lv > shownLevel ? lv : Math.max(lv, shownLevel - 0.03);
      const el = $('micLvl');
      if (el) {
        el.style.transform = `scaleX(${shownLevel.toFixed(3)})`;
        el.parentElement.setAttribute('aria-valuenow', Math.round(shownLevel * 100));
      }
      m.raf = requestAnimationFrame(step);
    };
    step();
  } catch (e) {
    if (meter !== m) return;
    micPerm = e.name === 'NotAllowedError' ? await tally.invoke('app:micStatus') : micPerm;
    if (e.name === 'NotAllowedError') render();
  }
}

function stopMeter() {
  if (!meter) return;
  cancelAnimationFrame(meter.raf);
  meter.stream?.getTracks().forEach((t) => t.stop());
  meter.ac?.close().catch(() => {});
  meter = null;
}

// Above the trigger, centred on it, arrow pointing at it; below when the pill is in the
// top half of the screen (§15.5). Kept inside the window.
function placePop() {
  if (pop.hidden) return;
  // The cover popover hangs from the swatch, or (folded) from the privacy icon.
  const trigger = pill.querySelector(`[data-act="${popKind}"]`) || pill.querySelector(`[data-pop="${popKind}"]`);
  if (!trigger) return;
  const t = trigger.getBoundingClientRect();
  const cx = t.left + t.width / 2;
  const w = pop.offsetWidth;
  const left = Math.min(Math.max(cx - w / 2, 8), innerWidth - w - 8);
  pop.style.left = `${left}px`;
  pop.style.setProperty('--ax', `${cx - left}px`);
  pop.style.top = place.down ? `${place.oy + 56 + 10}px` : `${place.oy - 10 - pop.offsetHeight}px`;
}

async function openPop(kind) {
  popKind = kind;
  clearTip();
  if (kind === 'more') {
    tally.invoke('app:micStatus').then((p) => {
      micPerm = p;
      if (popKind === 'more') render();
    });
    if (st.mic.on) loadMicDevices().then(() => popKind === 'more' && render());
  }
  if (kind === 'cover' && !wallThumb) {
    tally.invoke('app:wallpaperThumb').then((t) => {
      wallThumb = t;
      if (popKind === 'cover') render();
    });
  }
  render();
  (pop.querySelector('[aria-checked="true"][tabindex="0"], [role=menuitemradio][aria-checked="true"], button, [tabindex="0"]'))?.focus();
}

function closePop(refocus = false) {
  if (!popKind) return;
  const kind = popKind;
  popKind = null;
  render();
  if (refocus) pill.querySelector(`[data-act="${kind}"]`)?.focus();
}

// ───────── actions ─────────

const save = async (partial) => {
  st = await tally.invoke('app:setSettings', partial);
  render();
};

const fold = () => {
  popKind = null; // popovers close when the toolbar folds; unfolding never opens one
  tally.invoke('bar:fold');
};

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) {
    if (popKind && !e.target.closest('#pop')) closePop();
    return;
  }
  if (b.closest('#pill') && performance.now() < armedUntil) return; // S26
  if (b.getAttribute('aria-disabled') === 'true') return;
  const a = b.dataset.act;
  if (popKind && !b.closest('#pop') && !['chip', 'cover', 'more', 'privacy-open'].includes(a)) popKind = null;
  switch (a) {
    case 'fold':
      return fold();
    case 'collapse':
    case 'expand':
      popKind = null;
      return tally.invoke('bar:collapse', a === 'collapse');
    case 'chip':
    case 'cover':
    case 'more':
      return popKind === a ? closePop() : openPop(a);
    case 'source-display':
    case 'source-window':
    case 'source-camera':
      popKind = null;
      render();
      return tally.invoke('bar:action', a);
    case 'camera-toggle':
      return save({ camera: { on: !st.camera.on } });
    case 'camera-on':
      return save({ camera: { on: true } });
    case 'audio-toggle':
      return save({ systemAudio: !st.systemAudio });
    case 'audio-off':
      return save({ systemAudio: false });
    case 'mic-toggle':
      return micToggle(!st.mic.on);
    case 'mic-off':
      return micToggle(false);
    case 'mic-dev': {
      const d = micDevs.find((x) => x.deviceId === b.dataset.dev);
      return save({ mic: { deviceId: b.dataset.dev, deviceLabel: d?.label || null } });
    }
    case 'mic-settings':
      return tally.invoke('app:openMicSettings');
    case 'cover-set': {
      const id = b.dataset.cover;
      const cd = st.cleanDesktop;
      if (id === 'off') return save({ cleanDesktop: { on: false } });
      if (id === 'image' && cd.on && cd.cover === 'image') return chooseCover();
      return save({ cleanDesktop: { on: true, cover: id } });
    }
    case 'choose-cover':
      return chooseCover();
    case 'privacy':
      return save({ cleanDesktop: { privacy: b.dataset.pv } });
    case 'keep':
      return save({ cleanDesktop: { keep: b.dataset.pv } });
    case 'privacy-open':
      // Folded privacy icon or the More row: the cover popover, focus on the privacy choice.
      if (popKind === 'cover' && b.closest('#pill')) return closePop();
      return openPop('cover').then(() => pop.querySelector('.gseg.pv [aria-checked="true"]')?.focus());
    case 'quality':
      return save({ quality: { size: b.dataset.q } });
    case 'library':
      popKind = null;
      render();
      return tally.invoke('app:library');
    case 'settings':
      popKind = null;
      render();
      return tally.invoke('app:settingsWindow');
    case 'quit':
      return tally.invoke('app:quit');
    case 'dismiss-notice':
      return tally.invoke('bar:action', 'dismiss-notice', b.dataset.kind);
    default:
      return tally.invoke('bar:action', a);
  }
});

async function chooseCover() {
  const next = await tally.invoke('app:chooseImage', 'cover');
  if (next) {
    st = next;
    render();
  }
}

// ───────── keyboard ─────────

document.addEventListener('keydown', (e) => {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod && e.key === '\\') {
    // ⌘\ folds / unfolds (S27): local, only while the toolbar has focus. Collapsed: expands.
    e.preventDefault();
    if ((view === 'setup' || view === 'rec') && collapsed()) tally.invoke('bar:collapse', false);
    else if (view === 'setup' || view === 'rec') fold();
    return;
  }
  const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (e.altKey && arrow) {
    // ⌥ + arrows move the toolbar 16 pt (⌥⇧: 64), snapping like a drag (§15.4).
    e.preventDefault();
    tally.invoke('bar:nudge', { dx: arrow[0], dy: arrow[1], big: e.shiftKey });
    return;
  }
  if (view === 'setup' && mod && !e.shiftKey && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === 'l') return (e.preventDefault(), tally.invoke('app:library'));
    if (k === ',') return (e.preventDefault(), tally.invoke('app:settingsWindow'));
    if (k === 'q') return (e.preventDefault(), tally.invoke('app:quit'));
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    // Esc closes the open popover first, then setup itself (§1).
    if (popKind) return closePop(true);
    if (view === 'setup') return tally.invoke('bar:action', 'close');
    if (view === 'countdown') return tally.invoke('bar:action', 'cancel-countdown');
    if (view === 'confirm') return tally.invoke('bar:action', 'keep');
    return;
  }
  if (view === 'countdown' && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault();
    return tally.invoke('bar:action', 'now');
  }
  if (view === 'confirm' && e.key === 'Enter' && !e.target.closest('[data-act=keep]')) return tally.invoke('bar:action', 'confirm');
  if (e.target.matches('[role=switch]:not(button)') && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault();
    return e.target.click();
  }
  // One tab stop per group; arrows move, and selection follows focus.
  const g = e.target.closest('[role=radiogroup]');
  if (g && arrow) {
    e.preventDefault();
    const items = [...g.querySelectorAll('[role=radio]:not([disabled])')];
    const next = items[(items.indexOf(e.target.closest('[role=radio]')) + (arrow[0] || arrow[1]) + items.length) % items.length];
    const k = next?.dataset.k || next?.dataset.cover || next?.dataset.q || next?.dataset.dev;
    next?.click();
    requestAnimationFrame(() => (document.querySelector(`[data-k="${k}"], [data-cover="${k}"], [data-q="${k}"], [data-dev="${k}"]`) || next)?.focus());
    return;
  }
  const menu = e.target.closest('[role=menu]');
  if (menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    const items = [...menu.querySelectorAll('button.mrow, [role=switch]')];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
});

tally.on('bar:focus', (what) => {
  if (what === 'record') pill.querySelector('[data-k="record"]')?.focus({ focusVisible: true });
  else if (what === 'notes') (pill.querySelector('[data-k="notes"]') || pill.querySelector('[data-k="fold"]'))?.focus({ focusVisible: true });
  else if (view === 'confirm') pill.querySelector('[data-k="keep"]')?.focus();
});

// ───────── tooltips (400 ms, light chip with the shortcut) ─────────

function clearTip() {
  clearTimeout(tipTimer);
  document.querySelectorAll('#pill .tip').forEach((t) => t.remove());
}

pill.addEventListener('mouseover', (e) => {
  const b = e.target.closest('[data-tip]');
  clearTip();
  if (!b || !b.dataset.tip || drag || b.getAttribute('aria-expanded') === 'true') return;
  tipTimer = setTimeout(() => {
    const t = document.createElement('div');
    t.className = `tip${place.down ? ' down' : ''}`;
    t.innerHTML = `${esc(b.dataset.tip)}${b.dataset.key ? ` <span class="kbd">${esc(b.dataset.key)}</span>` : ''}`;
    b.appendChild(t);
  }, 400);
});

pill.addEventListener('mouseenter', () => {
  hovering = true;
  pill.classList.add('hover');
});
pill.addEventListener('mouseleave', () => {
  hovering = false;
  pill.classList.remove('hover');
  clearTip();
});

// ───────── drag (grip or any empty part), double-click the grip for home ─────────

let gripPress = 0; // last press on the grip, for double-click = home
pill.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const onGrip = e.target.closest('[data-drag]');
  const empty = !e.target.closest('button, [role=switch], .srcg');
  if (!onGrip && !empty) return;
  e.preventDefault();
  // Double-click the grip: home (§15.5). Detected here: pointer capture would retarget
  // the dblclick event to the pill.
  if (onGrip && e.timeStamp - gripPress < 400) {
    gripPress = 0;
    return tally.invoke('bar:action', 'home');
  }
  if (onGrip) gripPress = e.timeStamp;
  pill.setPointerCapture(e.pointerId);
  // Window-local points: main adds the window's current bounds. (screenX lags while the
  // window itself is moving, which made long drags fall short.)
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
  clearTip();
});
pill.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  if (!(e.buttons & 1)) return endDrag(e);
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3) return;
    drag.moved = true;
    pill.classList.add('dragging');
    popKind = null;
    pop.hidden = true;
    tally.invoke('bar:drag', { phase: 'start', cx: drag.x, cy: drag.y });
  }
  tally.invoke('bar:drag', { phase: 'move', cx: e.clientX, cy: e.clientY });
});
function endDrag(e) {
  if (!drag) return;
  if (drag.moved) tally.invoke('bar:drag', { phase: 'end', cx: e?.clientX, cy: e?.clientY });
  drag = null;
  pill.classList.remove('dragging');
}
pill.addEventListener('pointerup', endDrag);
pill.addEventListener('pointercancel', () => endDrag());

// Transparent room passes clicks through to whatever is underneath.
let over = null;
document.addEventListener('mousemove', (e) => {
  const inside = !!drag || !!document.elementFromPoint(e.clientX, e.clientY)?.closest('#pill, #pop, #notice');
  if (inside === over) return;
  over = inside;
  tally.invoke('bar:mouse', inside);
});

// ───────── state from main ─────────

let lastState = null;
// Same for the session: the clock fields (at, elapsedMs) change on every broadcast.
const sessionShown = (s) => JSON.stringify({ ...s, at: 0, elapsedMs: s.state === 'paused' || s.state === 'confirm' ? s.elapsedMs : 0 });
tally.on('app:session', (s) => {
  const announce = lastState && s.state !== lastState ? { paused: 'Paused', recording: lastState === 'paused' || lastState === 'confirm' ? 'Resumed' : 'Recording', finalizing: 'Stopped' }[s.state] : null;
  lastState = s.state;
  const same = snap && sessionShown(s) === sessionShown(snap);
  snap = s;
  if (same) return;
  render();
  if (announce) $('announce').textContent = announce;
});
// Re-render only when something the bar shows changed: a re-render between a press and
// its release would replace the button under the pointer and lose the click.
const shown = (s) => JSON.stringify([s.toolbar.unfolded, s.toolbar.collapsed, s.notes?.open, s.camera.on, s.systemAudio, s.mic, s.cleanDesktop, s.source, s.quality, s.camOnly]);
tally.on('app:settings', (s) => {
  const folded = st && (s.toolbar.unfolded !== st.toolbar.unfolded || s.toolbar.collapsed !== st.toolbar.collapsed);
  const same = st && shown(s) === shown(st);
  st = s;
  if (!same) render({ fold: folded });
});
tally.on('bar:setup', (x) => {
  const was = setup.open;
  const same = JSON.stringify(x) === JSON.stringify(setup);
  setup = x;
  if (same) return;
  if (!x.open) popKind = null;
  render();
  if (x.open && !was) pill.querySelector('[data-k="record"]')?.focus({ focusVisible: true });
});
tally.on('bar:place', (p) => {
  place = p;
  over = null; // main made the window click-through again; the next move re-checks
  position();
});

tally.invoke('bar:init').then((r) => {
  snap = r.session;
  st = r.settings;
  setup = r.setup;
  render();
});
