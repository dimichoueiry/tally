// Icon sprite: the project's single stroke family, copied from design/index.html.
const SYMBOLS = `
  <symbol id="i-sliders" viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></symbol>
  <symbol id="i-power" viewBox="0 0 24 24"><path d="M12 3.5v7.5"/><path d="M6.6 7a7.5 7.5 0 1010.8 0"/></symbol>
  <symbol id="i-sh-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"/></symbol>
  <symbol id="i-sh-squircle" viewBox="0 0 24 24"><path d="M12 4.5c6 0 7.5 1.5 7.5 7.5s-1.5 7.5-7.5 7.5-7.5-1.5-7.5-7.5S6 4.5 12 4.5z"/></symbol>
  <symbol id="i-sh-land" viewBox="0 0 24 24"><rect x="2.5" y="6.5" width="19" height="11" rx="2.5"/></symbol>
  <symbol id="i-sh-port" viewBox="0 0 24 24"><rect x="6.5" y="3.5" width="11" height="17" rx="2.5"/></symbol>
  <symbol id="i-bg-none" viewBox="0 0 24 24"><circle cx="12" cy="9" r="3.2"/><path d="M6.5 19.5a5.5 5.5 0 0111 0"/></symbol>
  <symbol id="i-bg-blur" viewBox="0 0 24 24"><circle cx="12" cy="9" r="3.2"/><path d="M6.5 19.5a5.5 5.5 0 0111 0"/><path d="M3 5h.01M3 9.5h.01M3 14h.01M21 5h.01M21 9.5h.01M21 14h.01M6 2.8h.01M18 2.8h.01" stroke-width="2.4"/></symbol>
  <symbol id="i-bg-image" viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3.5 16.5l5-5 4 4 2.5-2.5 5.5 5.5"/><circle cx="16" cy="9" r="1.4"/></symbol>
  <symbol id="i-zoom-in" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.6-4.6M8 10.5h5M10.5 8v5"/></symbol>
  <symbol id="i-resize" viewBox="0 0 24 24"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></symbol>
  <symbol id="i-collapse" viewBox="0 0 24 24"><path d="M4 14h6v6M20 10h-6V4M10 14l-6 6M14 10l6-6"/></symbol>
  <symbol id="i-size" viewBox="0 0 24 24"><rect x="3" y="9" width="11" height="11" rx="2"/><path d="M13 4h7v7M20 4l-6.5 6.5"/></symbol>
  <symbol id="i-camera-off" viewBox="0 0 24 24"><path d="M10 6h3.5A2.5 2.5 0 0116 8.5v2l5-3v9l-1.6-1M16 16.2V15.5A2.5 2.5 0 0113.5 18H5a2.5 2.5 0 01-2.5-2.5v-7A2.5 2.5 0 015 6"/><path d="M3 3l18 18"/></symbol>
  <symbol id="i-monitor" viewBox="0 0 24 24"><rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8 20h8M12 16.5V20"/></symbol>
  <symbol id="i-window" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M6.5 6.5h.01M9 6.5h.01"/></symbol>
  <symbol id="i-cam-only" viewBox="0 0 24 24"><rect x="4" y="2.5" width="16" height="19" rx="3"/><circle cx="12" cy="10" r="3"/><path d="M6.8 21.5c.8-3 2.8-4.6 5.2-4.6s4.4 1.6 5.2 4.6"/></symbol>
  <symbol id="i-bubble-size" viewBox="0 0 24 24"><circle cx="8" cy="16" r="4"/><circle cx="14" cy="10" r="7" stroke-dasharray="2.4 2.4"/></symbol>
  <symbol id="i-camera" viewBox="0 0 24 24"><rect x="2.5" y="6" width="13.5" height="12" rx="2.5"/><path d="M16 10.5l5-3v9l-5-3"/></symbol>
  <symbol id="i-clean" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 21h10M9 8l6 6M15 8l-6 6" opacity="0"/><path d="M14 8.5l2.5-2.5M7.5 14.5l7-7" /></symbol>
  <symbol id="i-speaker" viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/></symbol>
  <symbol id="i-mic" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21M8.5 21h7"/></symbol>
  <symbol id="i-mic-off" viewBox="0 0 24 24"><path d="M15 9.5V6a3 3 0 00-5.8-1.1M9 9v2a3 3 0 004.6 2.5M18.5 11a6.5 6.5 0 01-1 3.4M5.5 11a6.5 6.5 0 009.8 5.6M12 17.5V21M8.5 21h7"/><path d="M3 3l18 18"/></symbol>
  <symbol id="i-speaker-off" viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></symbol>
  <symbol id="i-quality" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 15V9m0 3h3m0-3v6M14 9h1.5a3 3 0 010 6H14z"/></symbol>
  <symbol id="i-chev-r" viewBox="0 0 24 24"><path d="M9.5 6l6 6-6 6"/></symbol>
  <symbol id="i-chev-d" viewBox="0 0 24 24"><path d="M6 9.5l6 6 6-6"/></symbol>
  <symbol id="i-updown" viewBox="0 0 24 24"><path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4"/></symbol>
  <symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></symbol>
  <symbol id="i-gear" viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></symbol>
  <symbol id="i-library" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M10 9.5v5l4-2.5z"/></symbol>
  <symbol id="i-folder" viewBox="0 0 24 24"><path d="M3 7.5A2.5 2.5 0 015.5 5H10l2 2.5h6.5A2.5 2.5 0 0121 10v7.5a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 17.5z"/></symbol>
  <symbol id="i-pause" viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></symbol>
  <symbol id="i-play" viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></symbol>
  <symbol id="i-restart" viewBox="0 0 24 24"><path d="M4 12a8 8 0 108-8 8.5 8.5 0 00-5.8 2.4L4 8.5"/><path d="M4 4v4.5h4.5"/></symbol>
  <symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 002 1.8h7a2 2 0 002-1.8l1-12M9 7V4.5h6V7"/></symbol>
  <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>
  <symbol id="i-open" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4"/></symbol>
  <symbol id="i-reveal" viewBox="0 0 24 24"><path d="M3 7.5A2.5 2.5 0 015.5 5H10l2 2.5h6.5A2.5 2.5 0 0121 10v7.5a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 17.5z"/><path d="M12 11v5M9.5 13.5L12 11l2.5 2.5"/></symbol>
  <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></symbol>
  <symbol id="i-pencil" viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></symbol>
  <symbol id="i-warn" viewBox="0 0 24 24"><path d="M12 4L2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2h.01"/></symbol>
  <symbol id="i-alert" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.3h.01"/></symbol>
  <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z"/><path d="M9 12l2 2 4-4"/></symbol>
  <symbol id="i-disk" viewBox="0 0 24 24"><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5 13l2.5-8h9L19 13M16.5 16.5h.01"/></symbol>
  <symbol id="i-unplug" viewBox="0 0 24 24"><path d="M6 18l-3 3M17.5 3L15 5.5M21 6.5L18.5 9M11 9l-2 2M14 12l-2 2"/><path d="M8 10l6 6-2 2a4.2 4.2 0 01-6-6zM16 14l-6-6 2-2a4.2 4.2 0 016 6z"/></symbol>
  <symbol id="i-minus" viewBox="0 0 24 24"><path d="M6 12h12"/></symbol>
  <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></symbol>
  <symbol id="i-blur" viewBox="0 0 24 24"><circle cx="12" cy="9" r="3.2"/><path d="M6.5 19.5a5.5 5.5 0 0111 0"/><path d="M3 5h.01M3 9h.01M3 13h.01M21 5h.01M21 9h.01M21 13h.01M5 3h.01M19 3h.01" stroke-width="2.4"/></symbol>
  <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.5 12c1-2.5 4.5-7 9.5-7s8.5 4.5 9.5 7c-1 2.5-4.5 7-9.5 7s-8.5-4.5-9.5-7z"/><circle cx="12" cy="12" r="3"/></symbol>
  <symbol id="i-eye-off" viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c5 0 8.5 4.5 9.5 7-.4 1-1.2 2.3-2.4 3.6M6.6 6.6C4.5 8 3.1 10.1 2.5 12c1 2.5 4.5 7 9.5 7a9.6 9.6 0 004.4-1.1M9.9 9.9a3 3 0 004.2 4.2"/></symbol>
  <symbol id="i-undo" viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></symbol>
  <symbol id="i-lock" viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 018 0v3"/></symbol>
  <symbol id="i-arrow-r" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></symbol>
  <symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/></symbol>
  <symbol id="i-dots" viewBox="0 0 24 24"><path d="M5.5 12h.01M12 12h.01M18.5 12h.01" stroke-width="2.8"/></symbol>
  <symbol id="i-notes" viewBox="0 0 24 24"><rect x="4.5" y="3.5" width="15" height="17" rx="3"/><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4"/></symbol>
  <symbol id="i-chev-l" viewBox="0 0 24 24"><path d="M14.5 6l-6 6 6 6"/></symbol>
  <symbol id="i-hd" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 15V9m0 3h3m0-3v6M14 9h1.5a3 3 0 010 6H14z"/></symbol>
  <symbol id="i-quit" viewBox="0 0 24 24"><path d="M14 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4M10 16l-4-4 4-4M6 12h10"/></symbol>
  <symbol id="i-autoscroll" viewBox="0 0 24 24"><path d="M4 6h9M4 10.5h9M4 15h6"/><path d="M18 5v13M14.8 15l3.2 3.2 3.2-3.2"/></symbol>
  <symbol id="i-paste" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="16" rx="2.5"/><path d="M9 5V4a1 1 0 011-1h4a1 1 0 011 1v1"/><path d="M9 11h6M9 15h4"/></symbol>
`;

// Symbol ids carry an `i-` prefix: the sprite is first in <body>, so a bare `undo`
// or `open` symbol would win getElementById over the page's own #undo / #open.
export function installIcons() {
  const div = document.createElement('div');
  div.innerHTML = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${SYMBOLS}</svg>`;
  document.body.prepend(div.firstChild);
}

export const icon = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// Keycap glyphs per platform (spec §6: Windows spells out Alt+Shift+…).
const isMac = window.tally?.platform === 'darwin';
export const keys = (letter) => (isMac ? `⌥⇧${letter}` : `Alt+Shift+${letter}`);
export const cmd = (k) => (isMac ? `⌘${k}` : `Ctrl+${k}`);
export const fmtTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
export const fmtBytes = (b) => {
  if (b == null) return '';
  if (b === 0) return '0 KB';
  if (b >= 1e9) return `${(b / 1e9).toFixed(b >= 1e11 ? 0 : 1)} GB`;
  if (b >= 1e6) return `${Math.round(b / 1e6)} MB`;
  return `${Math.max(1, Math.round(b / 1e3))} KB`;
};
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
