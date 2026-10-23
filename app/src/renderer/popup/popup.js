// After-stop popup (spec §3.5). Stays until dismissed (×, Esc, or the next countdown).
import { installIcons, icon, cmd, fmtTime, fmtBytes, esc } from '../shared/ui.js';

const tally = window.tally;
installIcons();
const root = document.getElementById('root');
const isMac = tally.platform === 'darwin';
const FINDER = isMac ? 'Show in Finder' : 'Show in Explorer';

let d = null; // { entry, finalizing, recovered, libraryDir }
let view = 'saved'; // saved | renamed | deleted
let typed = null; // pending text in the name field
let plan = null;
let stripped = false;
let pendingRename = null; // typed while finalising; applied when ready

const split = (name) => {
  const i = name.lastIndexOf('.');
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ''];
};

function render() {
  if (!d) return;
  if (view === 'deleted') {
    root.innerHTML = `<div class="saved undo" role="status" aria-live="polite">
      <div class="msg">${icon('trash')}<div><b>Moved to Trash</b><small>${esc(d.entry.name)}</small></div></div>
      <button class="btn" data-act="undo">${icon('undo', 's14')} Undo <span class="kbd">${cmd('Z')}</span></button>
      <button class="x ibtn" data-act="dismiss" aria-label="Dismiss">${icon('x', 's14')}</button>
    </div>`;
    return fit();
  }
  if (d.error && !d.finalizing) return renderError();
  const e = d.entry || { name: d.name };
  const [base, ext] = split(e.name);
  const busy = d.finalizing;
  const disk = d.stopped?.reason === 'disk' && view === 'saved';
  const status = busy
    ? `<div class="status busy"><span class="spin"></span>Finishing file…</div>`
    : disk
      ? `<div class="status alert">${icon('disk', 's14')}Stopped — disk almost full</div>`
      : d.recovered && view === 'saved'
      ? `<div class="status recovered">${icon('warn', 's14')}Recovered after a crash</div>`
      : `<div class="status">${icon('check', 's14')}${view === 'renamed' ? 'Renamed' : 'Saved'}</div>`;
  const meta = busy ? 'Rename now — applied when ready' : disk ? `All ${fmtTime((e.duration || d.stopped.duration || 0) * 1000)} saved · ${fmtBytes(Math.max(0, d.stopped.free))} left` : [e.quality, e.fps ? `${e.fps} fps` : null, fmtBytes(e.size), d.libraryDir?.replace(/^\/Users\/[^/]+/, '~')].filter(Boolean).join(' · ');
  const conflict = plan?.conflict ? `<div class="errmsg">A file with this name exists. Return saves as “${esc(split(plan.target)[0])}”.</div>` : '';
  const strippedNote = stripped ? `<div class="note">Removed characters a file name can’t contain.</div>` : '';
  root.innerHTML = `<div class="saved ${disk ? 'alert' : ''}" role="${disk ? 'alertdialog' : 'dialog'}" aria-label="${disk ? 'Recording stopped, disk almost full' : 'Recording saved'}">
    <button class="x ibtn" data-act="close" aria-label="Dismiss">${icon('x', 's14')}</button>
    <div class="top">
      <div class="vthumb">${e.thumb ? `<img src="${e.thumb}" alt="">` : '<div class="thumb"></div>'}${e.duration ? `<span class="dur">${fmtTime(e.duration * 1000)}</span>` : ''}${e.camera ? '<span class="cam"></span>' : ''}</div>
      <div>
        ${status}
        <label class="name-field ${plan?.conflict ? 'err' : ''}" ${view === 'renamed' ? 'data-plain' : ''}>
          <input id="name" aria-label="File name" spellcheck="false" value="${esc(typed ?? base)}"><span class="ext">${esc(ext)}</span>
        </label>
        ${conflict}${strippedNote}
        <div class="meta">${esc(meta)}</div>
      </div>
    </div>
    <div class="acts">
      <button class="btn" data-act="reveal" ${busy ? 'disabled' : ''}>${icon('reveal', 's14')} ${FINDER}</button>
      <button class="btn" data-act="open" ${busy ? 'disabled' : ''}>${icon('open', 's14')} Open</button>
      <span class="spacer"></span>
      ${disk ? '<button class="btn quiet" data-act="free">Free up space…</button>' : `<button class="btn danger" data-act="delete" ${busy ? 'disabled' : ''}>${icon('trash', 's14')} Delete</button>`}
    </div>
    <div class="hint"><span><span class="kbd">↵</span> Rename</span><span><span class="kbd">${cmd('↵')}</span> Open</span><span><span class="kbd">${cmd('R')}</span> ${FINDER}</span><span><span class="kbd">Esc</span> Done</span></div>
  </div>`;
  sizeInput();
  fit();
}

// Stop couldn't produce the file (an error, or a step ran out of time). The recorded
// parts are still on disk: save them now, or see where they are.
function renderError() {
  const er = d.error;
  root.innerHTML = `<div class="saved alert" role="alertdialog" aria-label="${esc(er.title)}">
    <button class="x ibtn" data-act="dismiss" aria-label="Dismiss">${icon('x', 's14')}</button>
    <div class="top">
      <div class="vthumb"><div class="thumb"></div></div>
      <div>
        <div class="status alert">${icon('alert', 's14')}${esc(er.title)}</div>
        <div class="fname">${esc(d.name || '')}</div>
        <div class="meta errtext">${esc(er.text)} ${er.canSave ? 'What was recorded is still on disk.' : 'No recorded parts were left on disk.'}</div>
      </div>
    </div>
    <div class="acts">
      ${er.canSave ? `<button class="btn primary" data-act="salvage">${icon('check', 's14')} Save what was recorded</button>` : ''}
      <button class="btn" data-act="reveal-failed">${icon('reveal', 's14')} ${FINDER}</button>
      <span class="spacer"></span>
    </div>
  </div>`;
  (root.querySelector('[data-act=salvage]') || root.querySelector('[data-act=reveal-failed]'))?.focus();
  fit();
}

function sizeInput() {
  const input = document.getElementById('name');
  if (!input) return;
  // Grow with the text so the dimmed extension sits right after the name.
  const max = input.parentElement.clientWidth - input.nextElementSibling.offsetWidth - 2;
  input.style.width = '0px';
  input.style.width = `${Math.min(input.scrollWidth + 2, max)}px`;
}
document.fonts.ready.then(sizeInput);

function fit() {
  requestAnimationFrame(() => tally.invoke('popup:resize', root.firstElementChild.offsetHeight + 32));
}

function focusName(selectBase = true) {
  const input = document.getElementById('name');
  if (!input) return;
  input.focus();
  if (selectBase) input.select();
}

tally.on('popup:show', (data) => {
  const fresh = !d || !data.entry || d.entry?.file !== data.entry?.file;
  const wasFinalizing = d?.finalizing;
  d = data;
  if (fresh && !wasFinalizing) {
    view = 'saved';
    typed = null;
    plan = null;
    stripped = false;
  }
  render();
  if (fresh && !wasFinalizing) focusName();
  if (wasFinalizing && !d.finalizing && d.entry && pendingRename != null) {
    const t = pendingRename;
    pendingRename = null;
    commitRename(t);
  }
});
tally.on('popup:hide', () => {
  d = null;
  root.innerHTML = '';
});

async function commitRename(text) {
  if (d.finalizing) {
    pendingRename = text;
    return;
  }
  const r = await tally.invoke('popup:rename', d.entry.file, text);
  if (r.plan.unchanged) return;
  d.entry = r.entry;
  typed = null;
  plan = null;
  stripped = false;
  view = 'renamed';
  render();
  root.querySelector('[data-act=reveal]')?.focus(); // spec: focus moves to Show in Finder
}

async function dismiss({ keepTyped }) {
  if (keepTyped && view !== 'deleted') {
    const input = document.getElementById('name');
    if (input && input.value !== split(d.entry?.name || '')[0]) await commitRename(input.value);
  }
  tally.invoke('popup:dismiss');
}

root.addEventListener('input', async (e) => {
  if (e.target.id !== 'name') return;
  // Invalid characters are stripped as you type, with a one-line note.
  const clean = e.target.value.replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '');
  if (clean !== e.target.value) {
    const pos = e.target.selectionStart - (e.target.value.length - clean.length);
    e.target.value = clean;
    e.target.setSelectionRange(pos, pos);
    stripped = true;
  }
  typed = e.target.value;
  sizeInput();
  if (!d.finalizing && d.entry) {
    plan = await tally.invoke('popup:check', d.entry.file, typed);
    const field = root.querySelector('.name-field');
    field.classList.toggle('err', !!plan.conflict);
    root.querySelector('.errmsg')?.remove();
    root.querySelector('.note')?.remove();
    if (plan.conflict) field.insertAdjacentHTML('afterend', `<div class="errmsg">A file with this name exists. Return saves as “${esc(split(plan.target)[0])}”.</div>`);
    if (stripped) field.insertAdjacentHTML('afterend', `<div class="note">Removed characters a file name can’t contain.</div>`);
    fit();
  }
});

root.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const a = b.dataset.act;
  if (a === 'close') dismiss({ keepTyped: true }); // typing is committed on × dismiss
  if (a === 'dismiss') dismiss({ keepTyped: false });
  if (a === 'reveal') tally.invoke('popup:reveal', d.entry.file);
  if (a === 'open') tally.invoke('popup:open', d.entry.file);
  if (a === 'delete') doDelete();
  if (a === 'undo') doUndo();
  if (a === 'free') tally.invoke('popup:freeSpace');
  if (a === 'salvage') tally.invoke('popup:salvage');
  if (a === 'reveal-failed') tally.invoke('popup:revealFailed');
});

async function doDelete() {
  if (!d.entry || d.finalizing) return;
  await tally.invoke('popup:delete', d.entry.file);
  view = 'deleted';
  render();
}

async function doUndo() {
  const entry = await tally.invoke('popup:undo');
  if (!entry) return;
  d.entry = entry;
  view = 'saved';
  typed = null;
  render();
  focusName();
}

document.addEventListener('keydown', (e) => {
  if (!d) return;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (e.key === 'Escape') {
    e.preventDefault();
    return dismiss({ keepTyped: false }); // Esc keeps the current name
  }
  if (view === 'deleted') {
    if (mod && e.key.toLowerCase() === 'z') doUndo();
    return;
  }
  if (d.error && !d.finalizing) return;
  if (mod && e.key === 'Enter') return d.entry && tally.invoke('popup:open', d.entry.file);
  if (mod && e.key.toLowerCase() === 'r') {
    e.preventDefault();
    return d.entry && tally.invoke('popup:reveal', d.entry.file);
  }
  if (mod && e.key === 'Backspace') return doDelete();
  if (e.key === 'Enter' && e.target.id === 'name') {
    e.preventDefault();
    commitRename(e.target.value);
  }
});
