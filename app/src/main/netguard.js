// Local-only guarantee: every renderer request that is not app://, data:, blob: or
// devtools is cancelled. This is what stops MediaPipe's usage logger
// (odml.pa.googleapis.com, on load and every 60 s, no opt-out) from leaving the Mac.
// Blocked attempts are counted so a recording can prove it made no requests.
const ALLOWED = /^(app|data|blob|devtools|chrome-extension|chrome|about):/;

export function isAllowed(url) {
  return ALLOWED.test(url);
}

let current = null;

// Second layer: every page's CSP has connect-src 'self', so fetches to the network
// are refused inside the renderer before they reach webRequest. windows.js reports
// those refusals (from the console) here, so the count covers both layers.
export function noteCspBlock(url, role) {
  current?.record(url, `csp:${role}`);
}

export function installNetGuard(session, log = () => {}) {
  const stats = { blocked: [], since: Date.now() };
  const record = (url, via) => {
    stats.blocked.push({ at: Date.now(), url: url.slice(0, 120), via });
    if (stats.blocked.length > 500) stats.blocked.shift();
  };
  session.webRequest.onBeforeRequest((d, cb) => {
    const ok = isAllowed(d.url);
    if (!ok) {
      record(d.url, 'webRequest');
      log(`blocked network request: ${d.url.slice(0, 120)}`);
    }
    cb({ cancel: !ok });
  });
  current = { record };
  return {
    stats,
    // Blocked attempts in a time window, grouped by host.
    summary(from = 0, to = Date.now()) {
      const hosts = {};
      const via = {};
      for (const b of stats.blocked) if (b.at >= from && b.at <= to) {
        let h = b.url;
        try { h = new URL(b.url).host; } catch {}
        hosts[h] = (hosts[h] || 0) + 1;
        via[b.via] = (via[b.via] || 0) + 1;
      }
      // Nothing is ever let through: every non-app:// request is either refused by CSP
      // or cancelled here, so "sent" is always 0 by construction; blocked = attempts.
      return { sent: 0, blocked: Object.values(hosts).reduce((a, b) => a + b, 0), hosts, via };
    },
  };
}
