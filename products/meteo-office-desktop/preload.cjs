const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meteoDesktop', {
  getRuntimeStatus: () => ipcRenderer.invoke('runtime:status'),
  getModelSettings: () => ipcRenderer.invoke('runtime:model-settings'),
  saveModelSettings: (request) => ipcRenderer.invoke('runtime:model-settings-save', request),
  getDefaultAssistantWorkspace: () => ipcRenderer.invoke('workspace:assistant-default'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  openWorkspace: (targetPath) => ipcRenderer.invoke('workspace:open', targetPath),
  openExternalUrl: (targetUrl) => ipcRenderer.invoke('external:open', targetUrl),
  sendRuntimeMessage: (request) => ipcRenderer.invoke('runtime:send', request),
  cancelRuntimeTask: (request) => ipcRenderer.invoke('runtime:cancel', request),
  resolvePermission: (request) => ipcRenderer.invoke('runtime:permission', request),
  onRuntimeEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('runtime:event', listener);
    return () => ipcRenderer.removeListener('runtime:event', listener);
  },
});
