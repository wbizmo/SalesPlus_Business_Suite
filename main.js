const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const isOnline = require('is-online');
const packageJson = require('./package.json');

let mainWindow;
const mainURL = 'https://cluster64.sp-server.online/public/login';
let lastTriedURL = mainURL;
let lastOfflineState = false;
let networkStableCount = 0;

function resolvePreload(filename) {
  try {
    const appPathCandidate = path.join(app.getAppPath(), filename);
    if (fs.existsSync(appPathCandidate)) return appPathCandidate;
  } catch (e) {}
  try {
    const resourcesCandidate = path.join(process.resourcesPath || '', filename);
    if (fs.existsSync(resourcesCandidate)) return resourcesCandidate;
  } catch (e) {}
  return path.join(__dirname, filename);
}

async function createWindows() {
  // --- Splash ---
  const splash = new BrowserWindow({
    width: 420,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    backgroundColor: '#f4f6fa',
    show: true,
  });
  splash.loadFile(path.join(__dirname, 'splash.html')).catch(console.error);

  // --- Main Window ---
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#f4f6fa',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    title: `Sales+ POS v${packageJson.version}`,
    webPreferences: {
      preload: resolvePreload('preload.js'),
      partition: 'persist:main',
      contextIsolation: true,
      enableRemoteModule: false,
      nodeIntegration: false,
    },
  });

  // Remove default menu bar
  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();

  // Splash hide helper
  function showMainAndCloseSplash() {
    try { if (splash && !splash.isDestroyed()) splash.close(); } catch (e) {}
    try { if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show(); } catch (e) {}
  }

  mainWindow.webContents.on('did-finish-load', async () => {
    setTimeout(showMainAndCloseSplash, 300);
  });

  // Fail handling
  mainWindow.webContents.on('did-fail-provisional-load', () => {});
  mainWindow.webContents.on('did-fail-load', () => {});

  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
    mainWindow.setTitle(`Sales+ POS v${packageJson.version}`);
  });

  // Load URL aggressively
  async function tryLoadURL(url, maxAttempts = 5, attemptDelayMs = 1500) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await mainWindow.webContents.session.clearCache().catch(()=>{});
        await mainWindow.loadURL(url);
        lastTriedURL = url;
        return true;
      } catch (err) {
        await new Promise(r => setTimeout(r, attemptDelayMs));
      }
    }
    return false;
  }

  (async () => {
    const ok = await tryLoadURL(mainURL, 6, 2000);
    if (!ok) console.warn('Failed to load main URL');
  })();

  // Network monitor
  async function monitorNetwork() {
    const onlineProbe = await isOnline().catch(() => false);
    let rendererOnline = null;
    try {
      rendererOnline = await mainWindow.webContents.executeJavaScript('typeof navigator !== "undefined" && navigator.onLine', true).catch(() => null);
    } catch (e) {}
    const online = (rendererOnline === true) || onlineProbe;

    if (online) networkStableCount++;
    else networkStableCount = Math.max(networkStableCount - 2, 0);

    if (!online && networkStableCount < 1 && !lastOfflineState) {
      lastOfflineState = true;
      mainWindow.webContents.send('network-offline');
    }

    if (online && networkStableCount >= 1 && lastOfflineState) {
      lastOfflineState = false;
      mainWindow.webContents.send('network-online');
    }
  }
  setInterval(monitorNetwork, 3000);

  // IPC handler to force reload
  ipcMain.handle('force-go-live', async () => {
    try {
      const ok = await tryLoadURL(lastTriedURL || mainURL, 5, 1000);
      return ok;
    } catch (err) {
      return false;
    }
  });

  // Block navigation while offline
  mainWindow.webContents.on('will-navigate', (event) => {
    if (lastOfflineState) event.preventDefault();
  });
  mainWindow.webContents.on('new-window', (event) => {
    if (lastOfflineState) event.preventDefault();
  });
}

app.whenReady().then(async () => {
  await createWindows();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindows(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
