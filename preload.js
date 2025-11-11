const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  forceGoLive: () => ipcRenderer.invoke('force-go-live'),
});
