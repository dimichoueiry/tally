const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spike', {
  onStart: (fn) => ipcRenderer.on('rec-start', (_e, a) => fn(a)),
  done: (r) => ipcRenderer.send('rec-done', r),
  bubbleStatus: (s) => ipcRenderer.send('bubble-status', s),
});
