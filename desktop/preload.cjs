const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('diavloDesktop', {
  platform: process.platform,
  userAgent: process.versions.electron ? `Electron ${process.versions.electron}` : 'Electron',
});
