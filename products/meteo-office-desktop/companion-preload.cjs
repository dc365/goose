'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('meteoCompanion', {
  platform: process.platform,
  getState: () => ipcRenderer.invoke('companion:get-state'),
  action: (request) => ipcRenderer.invoke('companion:action', request || {}),
  onState: (callback) => subscribe('companion:state', callback),
});
