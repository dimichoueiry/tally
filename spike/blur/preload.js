const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spike', {
  metrics: () => ipcRenderer.invoke('metrics'),
  savePng: (name, dataUrl) => ipcRenderer.invoke('save-png', name, dataUrl),
  saveJson: (name, obj) => ipcRenderer.invoke('save-json', name, obj),
  log: (...a) => ipcRenderer.send('log', ...a),
  quit: () => ipcRenderer.send('quit'),
});
