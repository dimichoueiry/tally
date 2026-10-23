import { installIcons, icon } from '../shared/ui.js';
installIcons();
const tally = window.tally;
const $ = (id) => document.getElementById(id);
const C = 2 * Math.PI * 83;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
let raf = 0;
let t0 = 0;
let total = 3000;

tally.on('countdown:show', ({ kind, rect, tag, ms }) => {
  total = ms;
  const frame = $('frame');
  frame.className = kind === 'window' && rect ? 'win' : 'full';
  const W = innerWidth, H = innerHeight;
  let cx = W / 2, cy = H / 2;
  if (frame.className === 'win') {
    Object.assign(frame.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    cx = rect.x + rect.width / 2;
    cy = rect.y + rect.height / 2;
    Object.assign($('tag').style, { left: `${rect.x}px`, top: `${Math.max(4, rect.y - 30)}px` });
  } else {
    frame.removeAttribute('style');
    Object.assign($('tag').style, { left: '14px', top: '40px' });
  }
  $('tag').innerHTML = `${icon(kind === 'window' ? 'window' : 'monitor', 's14')} ${tag}`;
  Object.assign($('count').style, { left: `${cx}px`, top: `${cy}px` });
  $('ring').style.strokeDasharray = `${C}`;
  $('ring').style.display = reduced ? 'none' : '';
  $('root').hidden = false;
  t0 = performance.now();
  let last = 0;
  cancelAnimationFrame(raf);
  const tick = (now) => {
    const left = Math.max(0, total - (now - t0));
    const n = Math.max(1, Math.ceil(left / 1000));
    if (n !== last) {
      last = n;
      $('digit').textContent = n;
      $('live').textContent = `Recording starts in ${n}`;
    }
    // The ring drains linearly over each second: it represents time.
    const frac = (left % 1000) / 1000 || (left > 0 ? 1 : 0);
    $('ring').style.strokeDashoffset = `${C * (1 - frac)}`;
    if (left > 0) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  window.focus();
});
tally.on('countdown:hide', () => {
  cancelAnimationFrame(raf);
  $('live').textContent = 'Recording';
  $('root').hidden = true;
});
document.addEventListener('keydown', (e) => {
  if ($('root').hidden) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); tally.invoke('countdown:now'); }
  if (e.key === 'Escape') tally.invoke('countdown:cancel');
});
  