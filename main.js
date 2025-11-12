// main.js — aggressive, packaging-safe, non-caching, hair-trigger network UX
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const isOnline = require('is-online');
const packageJson = require('./package.json');

let mainWindow, splash, offlineOverlay;
const mainURL = 'https://cluster64.sp-server.online/public/login';
let lastTriedURL = mainURL;
let lastOfflineState = false;
let networkStableCount = 0; // smoothing for noisy network probes

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
  splash = new BrowserWindow({
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

  // --- Main window ---
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

  // **Remove default menu bar**
  mainWindow.setMenuBarVisibility(false);
  mainWindow.removeMenu();

  // --- Offline overlay ---
  offlineOverlay = new BrowserWindow({
    parent: mainWindow,
    modal: true,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    backgroundColor: '#fff',
    webPreferences: {
      preload: resolvePreload('offline-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  offlineOverlay.loadFile(path.join(__dirname, 'offline.html')).catch(console.error);

  // Keep overlay bounds synced
  function syncOverlayBounds() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (offlineOverlay && !offlineOverlay.isDestroyed()) {
      try { offlineOverlay.setBounds(mainWindow.getBounds()); } catch (e) {}
    }
  }
  ['move', 'resize', 'enter-full-screen', 'leave-full-screen'].forEach(ev => mainWindow.on(ev, syncOverlayBounds));

  // --- Certificates (dev only) ---
  if (process.env.FORCE_CERT_IGNORE === '1') {
    mainWindow.webContents.on('certificate-error', (event, url, error, certificate, callback) => {
      try {
        event.preventDefault();
        console.warn('certificate-error for', url, ' — ignoring (FORCE_CERT_IGNORE=1).', error && error.message);
        callback(true);
      } catch (e) { callback(false); }
    });
  }

  // --- Fail handling ---
  mainWindow.webContents.on('did-fail-provisional-load', (e, errorCode, desc, validatedURL, isMainFrame) => {
    if (isMainFrame) showFullOverlayForMainFrameFailure(validatedURL || lastTriedURL);
  });
  mainWindow.webContents.on('did-fail-load', (e, errorCode, desc, validatedURL, isMainFrame) => {
    if (isMainFrame) showFullOverlayForMainFrameFailure(validatedURL || lastTriedURL);
  });

  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
    mainWindow.setTitle(`Sales+ POS v${packageJson.version}`);
  });

  // --- Splash hide helper ---
  function showMainAndCloseSplash() {
    try { if (splash && !splash.isDestroyed()) splash.close(); } catch (e) {}
    try { if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show(); } catch (e) {}
  }

  mainWindow.webContents.on('did-finish-load', async () => {
    setTimeout(() => {
      if (offlineOverlay && !offlineOverlay.isDestroyed() && offlineOverlay.isVisible()) {
        try { offlineOverlay.hide(); } catch (e) {}
      }
      showMainAndCloseSplash();
    }, 300);
  });

  setTimeout(() => {
    if (splash && !splash.isDestroyed() && (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible())) {
      showFullOverlayForMainFrameFailure(lastTriedURL);
      try { splash.close(); } catch (e) {}
    }
  }, 10000);

  // --- Full overlay helper ---
  function showFullOverlayForMainFrameFailure(failedUrl) {
    try {
      if (!offlineOverlay || offlineOverlay.isDestroyed()) return;
      try { offlineOverlay.setBounds(mainWindow.getBounds()); } catch (e) {}
      offlineOverlay.show();
    } catch (err) { console.error('showFullOverlayForMainFrameFailure error:', err && err.message); }
  }

  // --- Load URL aggressively ---
  async function tryLoadURL(url, maxAttempts = 5, attemptDelayMs = 1500) {
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await mainWindow.webContents.session.clearCache().catch(()=>{});
        await mainWindow.loadURL(url);
        lastTriedURL = url;
        return true;
      } catch (err) {
        lastErr = err;
        await new Promise(r => setTimeout(r, attemptDelayMs));
      }
    }
    return false;
  }

  (async () => {
    const ok = await tryLoadURL(mainURL, 6, 2000);
    if (!ok) showFullOverlayForMainFrameFailure(lastTriedURL);
  })();

  // --- Network monitor ---
  async function monitorNetwork() {
    const onlineProbe = await isOnline().catch(() => false);
    let rendererOnline = null;
    try {
      rendererOnline = await mainWindow.webContents.executeJavaScript('typeof navigator !== "undefined" && navigator.onLine', true).catch(() => null);
    } catch (e) {}
    const online = (rendererOnline === true) || onlineProbe;

    if (online) networkStableCount++;
    else networkStableCount = Math.max(networkStableCount - 2, 0);

    const overlayVisible = offlineOverlay && !offlineOverlay.isDestroyed() && offlineOverlay.isVisible();

    if (!online && networkStableCount < 1 && !lastOfflineState) {
      lastOfflineState = true;
      showFullOverlayForMainFrameFailure(lastTriedURL);
    }

    if (online && networkStableCount >= 1 && lastOfflineState) {
      lastOfflineState = false;
      if (overlayVisible) { try { offlineOverlay.hide(); } catch (e) {} }
      try { await tryLoadURL(lastTriedURL || mainURL, 4, 1200); } catch (e) {}
    }
  }
  setInterval(monitorNetwork, 3000);

  // --- IPC handler ---
  ipcMain.handle('force-go-live', async () => {
    try {
      if (offlineOverlay && !offlineOverlay.isDestroyed() && offlineOverlay.isVisible()) offlineOverlay.hide();
      const ok = await tryLoadURL(lastTriedURL || mainURL, 5, 1000);
      if (!ok) showFullOverlayForMainFrameFailure(lastTriedURL);
      return ok;
    } catch (err) {
      showFullOverlayForMainFrameFailure(lastTriedURL);
      return false;
    }
  });
}

// App lifecycle
app.whenReady().then(async () => {
  await createWindows();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindows(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
