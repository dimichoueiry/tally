// File naming: default names, sanitising user input, resolving conflicts. Pure.

const pad = (n) => String(n).padStart(2, '0');

// `YYYY-MM-DD HH.MM <Source>` (spec §3.5).
export function defaultBaseName(date, source) {
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}`;
  const s = stripFileExt(sanitize(source || '').name).trim();
  return s ? `${d} ${s}` : d;
}

// Short source label: "Built-in" for the built-in display, the display label
// otherwise, the window title (capped) for windows, "Camera" for Camera only.
export function sourceLabel(src) {
  if (!src) return '';
  if (src.kind === 'camera') return 'Camera';
  if (src.kind === 'display') return /built-?in/i.test(src.label || '') ? 'Built-in' : src.label || 'Display';
  const title = stripFileExt((src.title || src.name || 'Window').trim()) || 'Window';
  return title.length > 40 ? `${title.slice(0, 39).trim()}…` : title;
}

// Window titles are often file names ("notes.md", "Q3 report.pdf — Preview"). A
// trailing extension would end up in the recording's name ("… notes.md.mp4") and
// read as the file's real type, so drop extensions that end the title or a
// "name.ext — App" part. Version-like suffixes ("v1.2") are kept: the extension
// must start with a letter.
const FILE_EXT = /\.[A-Za-z][A-Za-z0-9]{0,5}(?=$|\s+[—–-]\s)/g;
export function stripFileExt(title) {
  return title.replace(FILE_EXT, '').replace(/[ .]+$/, '');
}

// Characters that are invalid on macOS or Windows file systems, plus control chars.
const INVALID = /[\/\\:*?"<>|\u0000-\u001f\u007f]/g;

export function sanitize(input) {
  const cleaned = input.replace(INVALID, '');
  // Leading dots hide the file on macOS; trailing dots/spaces are invalid on Windows.
  const name = cleaned.replace(/^\.+/, '').replace(/[ .]+$/, '');
  return { name, stripped: cleaned !== input };
}

export function splitExt(file) {
  const i = file.lastIndexOf('.');
  return i > 0 ? { base: file.slice(0, i), ext: file.slice(i) } : { base: file, ext: '' };
}

// First free "<base>.ext", "<base> 2.ext", "<base> 3.ext"… given a set of taken
// names (compared case-insensitively: APFS is case-insensitive by default).
export function uniqueName(base, ext, taken) {
  const lower = new Set([...taken].map((t) => t.toLowerCase()));
  if (!lower.has(`${base}${ext}`.toLowerCase())) return `${base}${ext}`;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}${ext}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

// Rename check for the popup / list: what Return would save as.
export function planRename(current, typed, taken) {
  const { ext } = splitExt(current);
  const { name, stripped } = sanitize(typed);
  if (!name) return { ok: false, reason: 'empty', stripped };
  const wanted = `${name}${ext}`;
  if (wanted === current) return { ok: true, unchanged: true, target: current, stripped };
  const others = new Set([...taken].filter((t) => t.toLowerCase() !== current.toLowerCase()));
  const target = uniqueName(name, ext, others);
  return { ok: true, target, conflict: target !== wanted, stripped };
}
