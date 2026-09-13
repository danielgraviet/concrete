const { contextBridge, ipcRenderer } = require('electron');

const watchChannel = 'vault:watch';
const watchListeners = new Map();

contextBridge.exposeInMainWorld('vault', {
  open: () => ipcRenderer.invoke('vault:open'),
  list: (root) => ipcRenderer.invoke('vault:list', root),
  read: (root, name) => ipcRenderer.invoke('vault:read', root, name),
  write: (root, name, content) => ipcRenderer.invoke('vault:write', root, name, content),
  create: (root, name) => ipcRenderer.invoke('vault:create', root, name),
  mkdir: (root, name) => ipcRenderer.invoke('vault:mkdir', root, name),
  ensureDefault: () => ipcRenderer.invoke('vault:ensureDefault'),
  rename: (root, from, to) => ipcRenderer.invoke('vault:rename', root, from, to),
  delete: (root, name) => ipcRenderer.invoke('vault:delete', root, name),
  watchStart: (root) => ipcRenderer.invoke('vault:watchStart', root),
  watchStop: () => ipcRenderer.invoke('vault:watchStop'),
  onWatch: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    watchListeners.set(callback, listener);
    ipcRenderer.on(watchChannel, listener);
    return () => {
      const registered = watchListeners.get(callback);
      if (!registered) return;
      ipcRenderer.removeListener(watchChannel, registered);
      watchListeners.delete(callback);
    };
  },
  offWatch: (callback) => {
    const registered = watchListeners.get(callback);
    if (!registered) return;
    ipcRenderer.removeListener(watchChannel, registered);
    watchListeners.delete(callback);
  }
});

contextBridge.exposeInMainWorld('ai', {
  status: () => ipcRenderer.invoke('ai:status'),
  ping: () => ipcRenderer.invoke('ai:ping'),
  chatCompletions: (payload) => ipcRenderer.invoke('ai:chatCompletions', payload),
});
