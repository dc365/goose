const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meteoDesktop', {
  getRuntimeStatus: () => ipcRenderer.invoke('runtime:status'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  openWorkspace: (targetPath) => ipcRenderer.invoke('workspace:open', targetPath),
  sendRuntimeMessage: (request) => ipcRenderer.invoke('runtime:send', request),
  cancelRuntimeTask: (request) => ipcRenderer.invoke('runtime:cancel', request),
  resolvePermission: (request) => ipcRenderer.invoke('runtime:permission', request),
  onRuntimeEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('runtime:event', listener);
    return () => ipcRenderer.removeListener('runtime:event', listener);
  },
});
