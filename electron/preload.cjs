const { contextBridge, ipcRenderer } = require('electron');

const watchChannel = 'vault:watch';
const watchListeners = new Map();

contextBridge.exposeInMainWorld('vault', {
  open: () => ipcRenderer.invoke('vault:open'),
  list: (root) => ipcRenderer.invoke('vault:list', root),
  read: (root, name) => ipcRenderer.invoke('vault:read', root, name),
  readPdf: (root, name) => ipcRenderer.invoke('vault:readPdf', root, name),
  write: (root, name, content) => ipcRenderer.invoke('vault:write', root, name, content),
  create: (root, name) => ipcRenderer.invoke('vault:create', root, name),
  readData: (root, name) => ipcRenderer.invoke('vault:readData', root, name),
  writeData: (root, name, content) => ipcRenderer.invoke('vault:writeData', root, name, content),
  appendData: (root, name, content) => ipcRenderer.invoke('vault:appendData', root, name, content),
  deleteData: (root, name) => ipcRenderer.invoke('vault:deleteData', root, name),
  mkdir: (root, name) => ipcRenderer.invoke('vault:mkdir', root, name),
  ensureDefault: () => ipcRenderer.invoke('vault:ensureDefault'),
  importObsidian: (root) => ipcRenderer.invoke('vault:importObsidian', root),
  importNotion: (root) => ipcRenderer.invoke('vault:importNotion', root),
  restore: () => ipcRenderer.invoke('vault:restore'),
  rename: (root, from, to) => ipcRenderer.invoke('vault:rename', root, from, to),
  delete: (root, name) => ipcRenderer.invoke('vault:delete', root, name),
  watchStart: (root) => ipcRenderer.invoke('vault:watchStart', root),
  watchStop: () => ipcRenderer.invoke('vault:watchStop'),
  openPath: (root, name) => ipcRenderer.invoke('vault:openPath', root, name),
  revealInFolder: (root, name) => ipcRenderer.invoke('vault:revealInFolder', root, name),
  importPdf: (root, folder) => ipcRenderer.invoke('vault:importPdf', root, folder),
  extractPdfText: (root, name) => ipcRenderer.invoke('vault:extractPdfText', root, name),
  exportNotePdf: (payload) => ipcRenderer.invoke('vault:exportNotePdf', payload),
  takePdfExport: () => ipcRenderer.invoke('vault:takePdfExport'),
  pdfExportReady: () => ipcRenderer.send('vault:pdfExportReady'),
  readImageDataUrl: (root, notePath, src) => ipcRenderer.invoke('vault:readImageDataUrl', root, notePath, src),
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
  status: (backend) => ipcRenderer.invoke('ai:status', backend),
  setApiKey: (apiKey, backend) => ipcRenderer.invoke('ai:setApiKey', apiKey, backend),
  ping: () => ipcRenderer.invoke('ai:ping'),
  chatCompletions: (payload) => ipcRenderer.invoke('ai:chatCompletions', payload),
  chatStream: (payload) => ipcRenderer.invoke('ai:chatStream', payload),
  chatCancel: (streamId) => ipcRenderer.invoke('ai:chatCancel', streamId),
  onChatDelta: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('ai:chatDelta', listener);
    return () => {
      ipcRenderer.removeListener('ai:chatDelta', listener);
    };
  },
  activity: () => ipcRenderer.invoke('ai:activity'),
  trajectories: () => ipcRenderer.invoke('ai:trajectories'),
  recordActivity: (event) => ipcRenderer.invoke('ai:recordActivity', event),
  activityClear: () => ipcRenderer.invoke('ai:activityClear'),
  telemetry: () => ipcRenderer.invoke('ai:telemetry'),
  telemetryClear: () => ipcRenderer.invoke('ai:telemetryClear'),
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

contextBridge.exposeInMainWorld('perf', {
  mark: (label) => ipcRenderer.invoke('perf:mark', label),
});
