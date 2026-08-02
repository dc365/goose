const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('meteoArtifactPreview', {
  loadDocument: () => ipcRenderer.invoke('artifact-preview:document'),
  addSelection: (selection) => ipcRenderer.invoke('artifact-preview:selection-add', selection),
  reportReady: (payload) => ipcRenderer.invoke('artifact-preview:document-ready', payload),
  reportError: (message) => ipcRenderer.invoke('artifact-preview:document-error', String(message || '')),
  onHighlightSelection: (callback) => subscribe('artifact-preview:selection-highlight', callback),
  onJumpSelection: (callback) => subscribe('artifact-preview:selection-jump', callback),
  onRemoveSelection: (callback) => subscribe('artifact-preview:selection-remove', callback),
});
