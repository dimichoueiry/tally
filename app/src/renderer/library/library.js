// Recordings window (spec §3.6): grouped by day, search, inline rename, open,
// reveal, delete with undo. Watches the folder, so Finder renames show up.
import { installIcons, icon, keys, cmd, fmtTime, fmtBytes, esc } from '../shared/ui.js';

const tally = window.tally;
installIcons();
const isMac = tally.platform === 'darwin';
const list = document.getElementById('list');
const foot = document.getElementById('foot');
document.querySelector('.search').innerHTML = `${icon('search', 's14')}<input id="q" placeholder="Search" aria-label="Search recordings">`;
const q = document.getElementById('q');

let items = [];
let dir = '';
let selected = null; // file path
let renaming = null; // file path
let undo = null; // { token, name }

const split = (name) => {
  const i = name.lastIndexOf('.');
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ''];
};
const dayKey = (t) => new Date(t).toDateString();
function dayLabel(t) {
  const d = new Date(t);
  const today = new Date();
  const y = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

async function load() {
  const r = await tally.invoke('library:list');
  items = r.items;
  dir = r.dir;
  if (selected && !items.some((i) => i.file === selected)) selected = null;
  if (!selected && items[0]) selected = items[0].file;
  render();
}

function visible() {
  const s = q.value.trim().toLowerCase();
  return s ? items.filter((i) => i.name.toLowerCase().includes(s)) : items;
}

function render() {
  const vis = visible();
  if (!items.length) {
    list.innerHTML = `<div class="empty" style="height:100%"><div class="inner">
      <span class="mark xl idle" aria-hidden="true"></span>
      <h3>No recordings yet</h3>
      <p>Recordings are saved to <span class="mono">${esc(dir)}</span> and stay on this ${isMac ? 'Mac' : 'PC'}. Nothing is uploaded.</p>
      <button class="btn primary" id="emptyRecord">Record your screen</button>
      <div class="keys">or press <span class="kbd">${keys('R')}</span> anywhere</div>
    </div></div>`;
  } else {
    let html = '';
    let last = null;
    for (const it of vis) {
      const k = dayKey(it.created);
      if (k !== last) {
        html += `<div class="lib-group">${esc(dayLabel(it.created))}</div>`;
        last = k;
      }
      html += row(it);
    }
    list.innerHTML = html || `<div class="empty" style="height:60%"><div class="inner"><p>No recordings match “${esc(q.value)}”.</p></div></div>`;
  }
  const total = items.reduce((a, i) => a + i.size, 0);
  foot.innerHTML = `${icon('folder', 's14')}<span class="path">${esc(dir)}</span><button class="btn quiet sm foot-btn" id="change">Change…</button><span class="sp"></span><span class="mono">${items.length} recording${items.length === 1 ? '' : 's'} · ${fmtBytes(total) || '0 KB'}</span>`;
  const input = list.querySelector('.name-edit input');
  if (input) {
    input.focus();
    input.select();
  }
}

function row(it) {
  const [base, ext] = split(it.name);
  const meta = [hhmm(it.created), it.quality, it.fps && it.fps !== 30 ? `${it.fps} fps` : null, fmtBytes(it.size)].filter(Boolean).join(' · ');
  const editing = renaming === it.file;
  return `<div class="lib-row" role="option" tabindex="${selected === it.file ? 0 : -1}" data-file="${esc(it.file)}" aria-selected="${selected === it.file}" aria-label="${esc(base)}, ${esc(meta)}">
    <div class="vthumb">${it.thumb ? `<img src="${it.thumb}" alt="">` : `<div class="ph">${icon('library', 's20')}</div>`}${it.duration ? `<span class="dur">${fmtTime(it.duration * 1000)}</span>` : ''}${it.camera ? '<span class="cam"></span>' : ''}</div>
    <div class="t">
      ${editing ? `<div class="name-edit"><input value="${esc(base)}" aria-label="File name" spellcheck="false"><span class="ext">${esc(ext)}</span></div>` : `<b title="${esc(it.name)}">${esc(base)}</b>`}
      <div class="m">${esc(meta)}</div>
    </div>
    <div class="ra">
      ${editing ? '' : `<button class="ibtn" data-act="rename" aria-label="Rename" title="Rename">${icon('pencil')}</button>`}
      <button class="ibtn" data-act="open" aria-label="Open" title="Open">${icon('open')}</button>
      <button class="ibtn" data-act="reveal" aria-label="${isMac ? 'Show in Finder' : 'Show in Explorer'}" title="${isMac ? 'Show in Finder' : 'Show in Explorer'}">${icon('reveal')}</button>
      <button class="ibtn" data-act="delete" aria-label="Delete" title="Delete">${icon('trash')}</button>
    </div>
  </div>`;
}

function select(file, focus = true) {
  selected = file;
  list.querySelectorAll('.lib-row').forEach((r) => {
    const on = r.dataset.file === file;
    r.setAttribute('aria-selected', on);
    r.tabIndex = on ? 0 : -1;
    if (on && focus) r.focus();
  });
}

async function del(file) {
  if (undo) await tally.invoke('library:commit', undo.token);
  const token = await tally.invoke('library:delete', file);
  undo = { token, name: file.split(/[\\/]/).pop() };
  showUndo();
  await load();
}

function showUndo() {
  const el = document.getElementById('undo');
  el.innerHTML = undo
    ? `<div class="undo-bar" role="status" aria-live="polite">${icon('trash', 's14')}<span>Moved to Trash <small>${esc(undo.name)}</small></span><button class="btn sm" data-act="undo">${icon('undo', 's14')} Undo <span class="kbd">${cmd('Z')}</span></button><button class="ibtn" data-act="undo-close" aria-label="Dismiss">${icon('x', 's14')}</button></div>`
    : '';
}

async function doUndo() {
  if (!undo) return;
  const restored = await tally.invoke('library:undo', undo.token);
  undo = null;
  showUndo();
  await load();
  if (restored) select(restored);
}

async function commitRename(file, text) {
  try {
    const r = await tally.invoke('library:rename', file, text);
    renaming = null;
    selected = r.file;
  } catch {
    renaming = null;
  }
  await load();
  select(selected);
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act], #record, #emptyRecord, #change');
  const rowEl = e.target.closest('.lib-row');
  if (rowEl && !e.target.closest('.name-edit')) select(rowEl.dataset.file, !b);
  if (!b) return;
  if (b.id === 'record' || b.id === 'emptyRecord') return tally.invoke('library:record');
  if (b.id === 'change') {
    if (await tally.invoke('library:changeDir')) load();
    return;
  }
  const file = rowEl?.dataset.file;
  const a = b.dataset.act;
  if (a === 'rename') {
    renaming = file;
    render();
  } else if (a === 'open') tally.invoke('library:open', file);
  else if (a === 'reveal') tally.invoke('library:reveal', file);
  else if (a === 'delete') del(file);
  else if (a === 'undo') doUndo();
  else if (a === 'undo-close') {
    await tally.invoke('library:commit', undo.token);
    undo = null;
    showUndo();
  }
});

list.addEventListener('dblclick', (e) => {
  const r = e.target.closest('.lib-row');
  if (r && !e.target.closest('.name-edit, .ra')) tally.invoke('library:open', r.dataset.file);
});

// Live conflict check while renaming.
list.addEventListener('input', async (e) => {
  if (!e.target.closest('.name-edit')) return;
  const file = e.target.closest('.lib-row').dataset.file;
  const clean = e.target.value.replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '');
  if (clean !== e.target.value) e.target.value = clean;
  const plan = await tally.invoke('library:check', file, e.target.value);
  const box = e.target.closest('.name-edit');
  box.classList.toggle('err', !!plan.conflict);
  box.parentElement.querySelector('.errmsg')?.remove();
  if (plan.conflict) box.insertAdjacentHTML('afterend', `<div class="errmsg">Exists. Return saves as “${esc(split(plan.target)[0])}”.</div>`);
});

document.addEventListener('keydown', (e) => {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const input = e.target.closest?.('.name-edit input');
  if (input) {
    const file = input.closest('.lib-row').dataset.file;
    if (e.key === 'Enter') commitRename(file, input.value);
    if (e.key === 'Escape') {
      renaming = null;
      render();
      select(file);
    }
    return;
  }
  if (mod && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    return q.focus();
  }
  if (mod && e.key.toLowerCase() === 'z' && undo) return doUndo();
  if (e.target === q) {
    if (e.key === 'Escape') {
      q.value = '';
      render();
    }
    if (e.key === 'ArrowDown') list.querySelector('.lib-row')?.focus();
    return;
  }
  const vis = visible();
  const i = vis.findIndex((x) => x.file === selected);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = vis[Math.min(Math.max(i + (e.key === 'ArrowDown' ? 1 : -1), 0), vis.length - 1)];
    if (n) select(n.file);
  }
  if (!selected) return;
  if (e.key === 'Enter') {
    renaming = selected;
    render();
  } else if (e.key === ' ') {
    e.preventDefault();
    tally.invoke('library:quicklook', selected);
  } else if (mod && e.key.toLowerCase() === 'o') tally.invoke('library:open', selected);
  else if (mod && e.key === 'Backspace') del(selected);
});

q.addEventListener('input', render);
tally.on('library:changed', load);
load();
