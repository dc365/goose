'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meteoComputerPip', {
  getState: () => ipcRenderer.invoke('computer-pip:state'),
  control: (action) => ipcRenderer.invoke('computer-pip:control', action),
  reportDimensions: (dimensions) => ipcRenderer.invoke('computer-pip:dimensions', dimensions),
  reportStreamStatus: (status) => ipcRenderer.invoke('computer-pip:stream-status', status),
  onStateChange: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('computer-pip:state', listener);
    return () => ipcRenderer.removeListener('computer-pip:state', listener);
  },
});
