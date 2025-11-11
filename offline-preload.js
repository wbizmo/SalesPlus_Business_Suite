const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  forceGoLive: async () => {
    try {
      return await ipcRenderer.invoke('force-go-live');
    } catch {
      return false;
    }
  },
});
