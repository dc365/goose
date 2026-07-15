const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meteoDesktop', {
  getRuntimeStatus: () => ipcRenderer.invoke('runtime:status'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  openWorkspace: (targetPath) => ipcRenderer.invoke('workspace:open', targetPath),
  runTask: (request) => ipcRenderer.invoke('task:run', request),
  cancelTask: (taskId) => ipcRenderer.invoke('task:cancel', taskId),
  onTaskEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('task:event', listener);
    return () => ipcRenderer.removeListener('task:event', listener);
  },
});
