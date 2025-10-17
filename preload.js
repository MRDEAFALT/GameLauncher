const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getGames: () => ipcRenderer.invoke('getGames'),
  getStatus: () => ipcRenderer.invoke('getStatus'),
  launchGame: (name) => ipcRenderer.send('launchGame', name),
  stopGame: () => ipcRenderer.send('stopGame'),
  toggleFavorite: (name) => ipcRenderer.invoke('toggleFavorite', name),
  importZip: () => ipcRenderer.invoke('importZip'),
  removeGame: (name) => ipcRenderer.invoke('removeGame', name),
  onGameStatus: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('game-status', listener);
    return () => ipcRenderer.removeListener('game-status', listener);
  },
});

contextBridge.exposeInMainWorld('upd', {
  onStatus: (cb) => ipcRenderer.on('upd:status', (_e, p) => cb(p)),
  onProgress: (cb) => ipcRenderer.on('upd:progress', (_e, p) => cb(p)),
  installNow: () => ipcRenderer.send('upd:installNow'),
});
