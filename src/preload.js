const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('r75', {
  knob: () => ipcRenderer.invoke('knob:get'),
  setKnob: (patch) => ipcRenderer.invoke('knob:set', patch),
  audioApps: () => ipcRenderer.invoke('audio:list'),
  spotifyLogin: (clientId) => ipcRenderer.invoke('spotify:login', clientId),
  spotifyLogout: () => ipcRenderer.invoke('spotify:logout'),
});
