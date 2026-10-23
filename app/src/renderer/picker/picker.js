// Window picker (SETUP_V2 §3.5). Pick mode: everything dims except the window under the
// pointer (green ring + chip); a click or Return picks it, Tab / ⇧Tab step front to back,
// Esc goes back. Picked mode: click-through; the ring stays and a ✓ chip sits outside
// the window's top edge, following it as it moves.
import { installIcons, icon, esc } from '../shared/ui.js';

const tally = window.tally;
installIcons();
const $ = (id) => document.getElementById(id);
const root = $('root');
const ring = $('ring');
const chip = $('chip');
const dim = $('dim');

let mode = null; // 'pick' | 'picked'
let windows = []; // front to back, display-local
let hl = -1;

const label = (w) => (w.app && w.title && w.title !== w.app ? `${w.title} — ${w.app}` : w.title || w.app || 'Window');
const size = (w) => `${w.width}×${w.height}`;

function show(w, picked = false) {
  ring.hidden = !w;
  chip.hidden = !w;
  dim.classList.toggle('cut', !!w && !picked);
  ring.classList.toggle('cut', !!w && !picked);
  if (!w) return;
  Object.assign(ring.style, { left: `${w.x}px`, top: `${w.y}px`, width: `${w.width}px`, height: `${w.height}px` });
  chip.className = `wchip ${picked ? 'picked' : 'glass'}`;
  chip.innerHTML = picked
    ? `${icon('check')}<span class="t">${esc(label(w))}</span><small>${size(w)}</small>`
    : `<span class="t">${esc(label(w))}</span><small>${size(w)}</small><span class="k">Click</span>`;
  // Hover: inside the window's top-left. Picked: just above its top edge (inside if no room).
  const top = picked ? (w.y - 42 >= 4 ? w.y - 42 : w.y + 8) : Math.max(w.y, 0) + 12;
  Object.assign(chip.style, { left: `${Math.max(w.x, 0) + (picked ? 0 : 12)}px`, top: `${top}px` });
}

function highlight(i) {
  if (i === hl) return;
  hl = i;
  const w = windows[i];
  show(w);
  if (w) $('announce').textContent = `${w.title || w.app}, ${w.app}, ${w.width} by ${w.height}, press Return to choose`;
}

const at = (x, y) => windows.findIndex((w) => x >= w.x && x < w.x + w.width && y >= w.y && y < w.y + w.height);

document.addEventListener('mousemove', (e) => {
  if (mode === 'pick') highlight(at(e.clientX, e.clientY));
});
document.addEventListener('mousedown', (e) => {
  if (mode !== 'pick' || e.button !== 0) return;
  const i = at(e.clientX, e.clientY);
  if (i >= 0) tally.invoke('picker:pick', windows[i]);
});
document.addEventListener('keydown', (e) => {
  if (mode !== 'pick') return;
  if (e.key === 'Escape') {
    e.preventDefault();
    tally.invoke('picker:cancel');
  } else if (e.key === 'Tab' && windows.length) {
    e.preventDefault();
    highlight((hl + (e.shiftKey ? -1 : 1) + windows.length) % windows.length);
  } else if (e.key === 'Enter' && windows[hl]) {
    e.preventDefault();
    tally.invoke('picker:pick', windows[hl]);
  }
});

tally.on('picker:show', (s) => {
  mode = s.mode;
  root.hidden = false;
  if (mode === 'pick') {
    windows = s.windows || [];
    hl = -2;
    dim.hidden = false;
    // Start on the picked window (or the frontmost), so Tab / Return work at once.
    highlight(windows.length ? Math.max(0, windows.findIndex((w) => w.id === s.picked)) : -1);
  } else {
    windows = [];
    dim.hidden = true;
    show(s.window, true);
  }
});
tally.on('picker:hide', () => {
  mode = null;
  root.hidden = true;
});
