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
  importObsidian: (root) => ipcRenderer.invoke('vault:importObsidian', root),
  restore: () => ipcRenderer.invoke('vault:restore'),
  rename: (root, from, to) => ipcRenderer.invoke('vault:rename', root, from, to),
  delete: (root, name) => ipcRenderer.invoke('vault:delete', root, name),
  watchStart: (root) => ipcRenderer.invoke('vault:watchStart', root),
  watchStop: () => ipcRenderer.invoke('vault:watchStop'),
  openPath: (root, name) => ipcRenderer.invoke('vault:openPath', root, name),
  revealInFolder: (root, name) => ipcRenderer.invoke('vault:revealInFolder', root, name),
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
  setApiKey: (apiKey) => ipcRenderer.invoke('ai:setApiKey', apiKey),
  ping: () => ipcRenderer.invoke('ai:ping'),
  chatCompletions: (payload) => ipcRenderer.invoke('ai:chatCompletions', payload),
  activity: () => ipcRenderer.invoke('ai:activity'),
  trajectories: () => ipcRenderer.invoke('ai:trajectories'),
  recordActivity: (event) => ipcRenderer.invoke('ai:recordActivity', event),
  activityClear: () => ipcRenderer.invoke('ai:activityClear'),
  agentStatus: (payload) => ipcRenderer.invoke('ai:agentStatus', payload),
  agentRun: (payload) => ipcRenderer.invoke('ai:agentRun', payload),
  agentCancel: () => ipcRenderer.invoke('ai:agentCancel'),
  onAgentProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('ai:agentProgress', listener);
    return () => {
      ipcRenderer.removeListener('ai:agentProgress', listener);
    };
  },
  onSetTheme: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('concrete:setTheme', listener);
    return () => {
      ipcRenderer.removeListener('concrete:setTheme', listener);
    };
  },
});

/** Sync renderer copies onto the macOS pasteboard for other apps / terminals. */
contextBridge.exposeInMainWorld('sandbox', {
  providers: () => ipcRenderer.invoke('sandbox:providers'),
  status: (providerId) => ipcRenderer.invoke('sandbox:status', providerId),
  run: (payload) => ipcRenderer.invoke('sandbox:run', payload),
  prepare: (payload) => ipcRenderer.invoke('sandbox:prepare', payload),
  onProgress: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('sandbox:progress', listener);
    return () => {
      ipcRenderer.removeListener('sandbox:progress', listener);
    };
  },
});

contextBridge.exposeInMainWorld('systemClipboard', {
  writeText: (text) => ipcRenderer.invoke('clipboard:writeText', text),
});
