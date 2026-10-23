// One preload for every Tally window. Exposes a narrow, prefix-allowlisted IPC bridge.
const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED = /^(app|bubble|camtray|bar|picker|notes|countdown|popup|library|perm|engine|settings):/;
const check = (ch) => {
  if (!ALLOWED.test(ch)) throw new Error(`blocked channel ${ch}`);
  return ch;
};
const role = (process.argv.find((a) => a.startsWith('--tally-role=')) || '').split('=')[1] || '';

contextBridge.exposeInMainWorld('tally', {
  role,
  platform: process.platform,
  invoke: (ch, ...args) => ipcRenderer.invoke(check(ch), ...args),
  send: (ch, ...args) => ipcRenderer.send(check(ch), ...args),
  on: (ch, fn) => {
    const h = (_e, ...args) => fn(...args);
    ipcRenderer.on(check(ch), h);
    return () => ipcRenderer.removeListener(ch, h);
  },
});
