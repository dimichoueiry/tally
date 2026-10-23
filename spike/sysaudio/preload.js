const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('spike', {
  result: (r) => ipcRenderer.send('result', r),
  done: (buf) => ipcRenderer.send('done', buf),
});
