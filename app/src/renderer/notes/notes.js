// Speaker notes (SETUP_V2 §12, S16–S19). Setup: plain-text editing, autosaved by main.
// Countdown / recording: read-only; optional auto-scroll in words per minute past a reading
// mark on line 2, lines already read dimmed. Paused: editable again. The window is not
// focusable while recording (main), so clicks here never take focus from the recorded app.
import { installIcons, icon, cmd, keys, esc } from '../shared/ui.js';
import { pxPerSecond, countWords, stepFont, stepWpm, FONT, WPM, LINE_HEIGHT } from '../../shared/notes.js';

const tally = window.tally;
installIcons();
const $ = (id) => document.getElementById(id);
const panel = $('panel');
const txt = $('txt');
const ed = $('ed');
const view = $('view');
const inDim = $('inDim');
const inBright = $('inBright');
const foot = $('foot');
const empty = $('empty');
const isMac = tally.platform === 'darwin';
const reduce = matchMedia('(prefers-reduced-motion: reduce)');

let text = '';
let prefs = { fontSize: FONT.def, auto: false, wpm: WPM.def, scroll: 0 };
let snap = null;
let status = 'Saved';
let scroll = 0; // px of the text above the top of the viewport
let scrollPaused = false; // ⌥⇧N
let takeStart = null; // where this take's scrolling began (a restart returns there)
let hover = false;
let raf = 0;
let lastT = 0;
let restored = false;
let drag = null;

$('pasteKey').textContent = cmd('V');
empty.querySelector('.btn').insertAdjacentHTML('afterbegin', icon('paste'));

// idle → edit; countdown / recording / confirm → read; paused → edit ("Paused · editable")
function phase() {
  const s = snap?.state;
  if (s === 'countdown' || s === 'recording' || s === 'confirm') return 'read';
  if (s === 'paused') return 'paused';
  return 'edit';
}

const lineH = () => prefs.fontSize * LINE_HEIGHT;
const markTop = () => 16 + lineH(); // top of line 2
const maxScroll = () => Math.max(0, inDim.offsetHeight - 40 - lineH() - markTop());

// ───────── render ─────────

function render() {
  const p = phase();
  const blank = !text.trim();
  panel.style.setProperty('--fs', `${prefs.fontSize}px`);
  const editing = p !== 'read';
  txt.classList.toggle('editing', editing);
  ed.hidden = !editing;
  // The read view keeps its layout while editing (hidden, not removed): it is what the
  // scroll range is measured on.
  view.classList.toggle('off', editing);
  view.setAttribute('aria-hidden', String(editing));
  ed.readOnly = !editing;
  ed.classList.toggle('blank', blank);
  empty.hidden = !(blank && p === 'edit');
  if (inDim.textContent !== `${text}\n`) {
    inDim.textContent = `${text}\n`;
    inBright.textContent = `${text}\n`;
  }
  $('bright').style.clipPath = `inset(${markTop()}px 0 0 0)`;
  Object.assign($('rl').style, { top: `${16 + lineH() * 1.2}px`, height: `${lineH() * 0.6}px` });
  renderFoot(p, blank);
  applyScroll();
}

const fontGrp = () => `<div class="grp" role="group" aria-label="Text size">
    <button data-act="font-" aria-label="Smaller text" data-tip="Smaller text" data-key="${cmd('−')}" ${prefs.fontSize <= FONT.min ? 'disabled' : ''}><span class="a-s">A</span></button>
    <span class="v">${prefs.fontSize}</span>
    <button data-act="font+" aria-label="Larger text" data-tip="Larger text" data-key="${cmd('+')}" ${prefs.fontSize >= FONT.max ? 'disabled' : ''}><span class="a-l">A</span></button></div>`;
const speedGrp = () => `<div class="grp${prefs.auto ? '' : ' dim'}" role="group" aria-label="Scroll speed">
    <button data-act="wpm-" aria-label="Slower" data-tip="Slower" ${prefs.wpm <= WPM.min ? 'disabled' : ''}>${icon('minus')}</button>
    <span class="v" style="min-width:64px">${prefs.wpm}<small>wpm</small></span>
    <button data-act="wpm+" aria-label="Faster" data-tip="Faster" ${prefs.wpm >= WPM.max ? 'disabled' : ''}>${icon('plus')}</button></div>`;
const hideBtn = () => `<button class="ib" data-act="hide" aria-label="Hide notes" data-tip="Hide notes">${icon('x')}</button>`;

function renderFoot(p, blank) {
  const focusAct = foot.contains(document.activeElement) ? document.activeElement.dataset.act : null;
  const kb = keys('N');
  const live = snap?.state === 'recording';
  let html;
  let quiet = false;
  if (p === 'edit' && blank) {
    html = `<span class="st" style="padding-left:6px">Plain text · no length limit</span><span class="sp"></span>${hideBtn()}`;
  } else if (p === 'read' && !hover) {
    quiet = true;
    const prog = `<i class="prog" id="prog" style="width:${pct()}%"></i>`;
    if (!prefs.auto) html = `<span class="dot"></span>Read-only · wheel or trackpad to move<span class="sp"></span>${prog}`;
    else if (scrollPaused) html = `<span class="dot hold"></span><span class="hold-t">Scroll paused</span> · wheel or trackpad to move<span class="sp"></span><span class="kbd">${kb}</span> resume${prog}`;
    else if (live) html = `<span class="dot go"></span>Scrolling · ${prefs.wpm} wpm<span class="sp"></span><span class="kbd">${kb}</span> pause${prog}`;
    else html = `<span class="dot"></span>${snap?.state === 'countdown' ? 'Scrolls from the first frame' : 'Scroll stopped'} · ${prefs.wpm} wpm<span class="sp"></span>${prog}`;
  } else if (p === 'read') {
    // pointer over the panel while recording: full controls (15d)
    const tog = prefs.auto
      ? `<button class="tog" data-act="scroll" aria-pressed="${!scrollPaused}" data-tip="${scrollPaused ? 'Resume scroll' : 'Pause scroll'}">${icon(scrollPaused ? 'play' : 'pause')}${scrollPaused ? 'Resume scroll' : 'Pause scroll'}<span class="kbd">${kb}</span></button>`
      : `<button class="tog" data-act="auto" aria-pressed="false" data-tip="Auto-scroll">${icon('autoscroll')}Auto-scroll</button>`;
    html = `${fontGrp()}${tog}${speedGrp()}<span class="sp"></span>${hideBtn()}`;
  } else {
    const st = p === 'paused' ? '<span class="st hold">Paused · editable</span>' : `<span class="st" id="st">${status}</span>`;
    html = `${fontGrp()}<button class="tog" data-act="auto" aria-pressed="${prefs.auto}" data-tip="Auto-scroll">${icon('autoscroll')}Auto-scroll</button>${speedGrp()}<span class="sp"></span>${st}${hideBtn()}`;
  }
  foot.className = `nfoot${quiet ? ' quiet' : ''}`;
  foot.innerHTML = html;
  if (focusAct) foot.querySelector(`[data-act="${focusAct}"]`)?.focus();
}

const pct = () => {
  const m = maxScroll();
  return m ? Math.round((scroll / m) * 1000) / 10 : 0;
};

function applyScroll() {
  if (phase() === 'read') {
    // reading: the last line can come up to the mark, no further
    scroll = Math.min(Math.max(scroll, 0), maxScroll());
    const t = `translateY(${-scroll}px)`;
    inDim.style.transform = t;
    inBright.style.transform = t;
  } else if (Math.abs(ed.scrollTop - scroll) > 1) ed.scrollTop = scroll;
  const prog = $('prog');
  if (prog) prog.style.width = `${pct()}%`;
}

// ───────── auto-scroll (§12.3) ─────────

function scrolling() {
  return phase() === 'read' && snap?.state === 'recording' && prefs.auto && !scrollPaused && text.trim();
}

function loop(t) {
  raf = 0;
  if (!scrolling()) return;
  const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0;
  lastT = t;
  const lines = Math.max(1, (inDim.offsetHeight - 56) / lineH());
  scroll += pxPerSecond({ wpm: prefs.wpm, words: countWords(text), lines, lineHeightPx: lineH() }) * dt;
  applyScroll();
  raf = requestAnimationFrame(loop);
}

function kick() {
  if (scrolling() && !raf) {
    lastT = 0;
    raf = requestAnimationFrame(loop);
  }
}

// The scroll position is remembered (as a fraction, so text size changes keep the place).
let saveTimer = 0;
function rememberScroll() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const m = maxScroll();
    if (m) setPrefs({ scroll: Math.round((scroll / m) * 10000) / 10000 }, false);
  }, 800);
}

// ───────── actions ─────────

async function setPrefs(partial, rerender = true) {
  prefs = { ...prefs, ...partial };
  if (rerender) render();
  await tally.invoke('notes:prefs', partial);
}

function setFont(dir) {
  const frac = maxScroll() ? scroll / maxScroll() : 0;
  const next = stepFont(prefs.fontSize, dir);
  if (next === prefs.fontSize) return;
  prefs.fontSize = next;
  render();
  scroll = frac * maxScroll();
  applyScroll();
  announce(`Text size ${next}`);
  setPrefs({ fontSize: next }, false);
}

function setWpm(dir) {
  const next = stepWpm(prefs.wpm, dir);
  if (next === prefs.wpm) return;
  announce(`${next} words per minute`);
  setPrefs({ wpm: next });
}

function toggleScrollPause() {
  if (!prefs.auto) return;
  scrollPaused = !scrollPaused;
  announce(scrollPaused ? 'Scroll paused' : 'Scrolling');
  render();
  kick();
}

const announce = (t) => ($('announce').textContent = t);

foot.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const a = b.dataset.act;
  if (a === 'font-') setFont(-1);
  else if (a === 'font+') setFont(1);
  else if (a === 'wpm-') setWpm(-1);
  else if (a === 'wpm+') setWpm(1);
  else if (a === 'auto') {
    announce(prefs.auto ? 'Auto-scroll off' : 'Auto-scroll on');
    setPrefs({ auto: !prefs.auto }).then(kick);
  } else if (a === 'scroll') toggleScrollPause();
  else if (a === 'hide') tally.invoke('notes:hide');
});

empty.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-act=paste]')) return;
  ed.focus();
  pasteText(await tally.invoke('notes:paste'));
});

// Plain text only: line breaks normalised, nothing else kept.
function pasteText(t) {
  if (!t) return;
  ed.setRangeText(String(t).replace(/\r\n?/g, '\n'), ed.selectionStart, ed.selectionEnd, 'end');
  ed.dispatchEvent(new Event('input'));
}

ed.addEventListener('input', () => {
  text = ed.value;
  status = 'Saving…';
  tally.send('notes:text', text); // main writes it 0.5 s after typing stops
  const wasBlank = ed.classList.contains('blank');
  if (wasBlank !== !text.trim()) render();
  else if ($('st')) $('st').textContent = status;
});
ed.addEventListener('scroll', () => {
  if (phase() === 'read') return;
  scroll = ed.scrollTop;
  rememberScroll();
});
ed.addEventListener('blur', () => tally.invoke('notes:flush'));

// Wheel / trackpad always works while reading; it nudges and the auto-scroll carries on.
view.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    scroll += e.deltaY;
    applyScroll();
    rememberScroll();
  },
  { passive: false },
);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    tally.invoke('notes:toBar'); // back to the toolbar's Notes button (§12.4)
  }
});

tally.on('notes:font', (dir) => setFont(dir)); // ⌘+ / ⌘− (taken in main, before any menu)
tally.on('notes:toggleScroll', () => toggleScrollPause()); // ⌥⇧N
tally.on('notes:focus', () => {
  if (phase() !== 'read') ed.focus();
});
tally.on('notes:flush', () => tally.invoke('notes:flush'));
tally.on('notes:saved', () => {
  status = 'Saved';
  if ($('st')) $('st').textContent = status;
});

// ───────── tooltips (400 ms, light chip with the shortcut) ─────────

let tipTimer = 0;
foot.addEventListener('mouseover', (e) => {
  const b = e.target.closest('[data-tip]');
  clearTimeout(tipTimer);
  foot.querySelectorAll('.tip').forEach((t) => t.remove());
  if (!b) return;
  tipTimer = setTimeout(() => {
    const t = document.createElement('div');
    t.className = 'tip';
    t.innerHTML = `${esc(b.dataset.tip)}${b.dataset.key ? ` <span class="kbd">${esc(b.dataset.key)}</span>` : ''}`;
    b.appendChild(t);
  }, 400);
});

// ───────── pointer: hover controls, click-through outside, drag by the grip ─────────

let over = null;
document.addEventListener('mousemove', (e) => {
  const r = panel.getBoundingClientRect();
  const inside = !!drag || (!panel.hidden && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
  if (inside !== over) {
    over = inside;
    tally.invoke('notes:mouse', inside);
  }
  if (inside !== hover) {
    hover = inside;
    if (phase() === 'read') render();
  }
});
document.addEventListener('mouseleave', () => {
  if (hover && !drag) {
    hover = false;
    foot.querySelectorAll('.tip').forEach((t) => t.remove());
    if (phase() === 'read') render();
  }
});

panel.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !e.target.closest('[data-drag]')) return;
  e.preventDefault();
  panel.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
});
panel.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  if (!(e.buttons & 1)) return endDrag(e);
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3) return;
    drag.moved = true;
    tally.invoke('notes:drag', { phase: 'start', cx: drag.x, cy: drag.y });
  }
  tally.invoke('notes:drag', { phase: 'move', cx: e.clientX, cy: e.clientY });
});
function endDrag(e) {
  if (!drag) return;
  if (drag.moved) tally.invoke('notes:drag', { phase: 'end', cx: e?.clientX, cy: e?.clientY });
  drag = null;
}
panel.addEventListener('pointerup', endDrag);
panel.addEventListener('pointercancel', () => endDrag());

// ───────── state from main ─────────

function onSession(s) {
  const prev = snap?.state;
  snap = s;
  // Frame 1: scrolling starts from wherever the text was left (§12.3). A restart scrolls
  // back to where that take started.
  if (prev === 'countdown' && s.state === 'recording') takeStart = scroll;
  if (prev === 'confirm' && s.state === 'countdown' && takeStart != null) scroll = takeStart;
  if (s.state === 'idle' && prev && prev !== 'idle') {
    takeStart = null;
    scrollPaused = false;
  }
  if (phase() === 'read') {
    hover = false;
    ed.blur();
  }
  render();
  kick();
  if (prev && prev !== s.state) rememberScroll();
}

tally.on('app:session', onSession);
tally.on('app:settings', (st) => {
  const n = st.notes;
  const changed = n.fontSize !== prefs.fontSize || n.auto !== prefs.auto || n.wpm !== prefs.wpm;
  prefs = { ...prefs, fontSize: n.fontSize, auto: n.auto, wpm: n.wpm };
  if (changed) render();
  kick();
});

tally.invoke('notes:init').then((r) => {
  text = r.text;
  ed.value = text;
  const n = r.settings.notes;
  prefs = { fontSize: n.fontSize, auto: n.auto, wpm: n.wpm, scroll: n.scroll || 0 };
  snap = r.session;
  panel.hidden = false;
  render();
  // Reopening restores the place in the script (as a fraction of it).
  requestAnimationFrame(() => {
    if (!restored) {
      restored = true;
      scroll = (prefs.scroll || 0) * maxScroll();
      render();
    }
  });
});
