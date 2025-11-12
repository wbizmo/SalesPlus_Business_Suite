// main.js (brute-force, packaging-safe, resilient)
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const isOnline = require('is-online');
const packageJson = require('./package.json');

let mainWindow, splash, offlineOverlay;
const mainURL = 'https://cluster64.sp-server.online/public/login';
let lastTriedURL = mainURL;
let lastOfflineState = false;
let networkStableCount = 0; // smoothing

// Resolve preload in packaged and dev scenarios
function resolvePreload(filename) {
  // Prefer app.getAppPath() (works inside asar), then resourcesPath (unpacked), then __dirname fallback
  try {
    const appPathCandidate = path.join(app.getAppPath(), filename);
    if (fs.existsSync(appPathCandidate)) return appPathCandidate;
  } catch (e) {}
  try {
    const resourcesCandidate = path.join(process.resourcesPath || '', filename);
    if (fs.existsSync(resourcesCandidate)) return resourcesCandidate;
  } catch (e) {}
  // final fallback
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
  splash.loadFile(path.join(__dirname, 'splash.html')).catch(err => {
    console.error('Splash load failed:', err);
  });

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
  mainWindow.setMenuBarVisibility(false);

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
  offlineOverlay.loadFile(path.join(__dirname, 'offline.html')).catch(err => {
    console.error('Offline overlay load failed:', err);
  });

  // Keep overlay bounds in sync
  function syncOverlayBounds() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (offlineOverlay && !offlineOverlay.isDestroyed()) {
      try {
        offlineOverlay.setBounds(mainWindow.getBounds());
      } catch (err) {
        // ignore
      }
    }
  }
  mainWindow.on('move', syncOverlayBounds);
  mainWindow.on('resize', syncOverlayBounds);
  mainWindow.on('enter-full-screen', syncOverlayBounds);
  mainWindow.on('leave-full-screen', syncOverlayBounds);

  // --- Defensive certificate handler (brute-force: accept certs) ---
  // WARNING: this weakens security. Remove for stricter production usage.
  mainWindow.webContents.on('certificate-error', (event, url, error, certificate, callback) => {
    try {
      event.preventDefault();
      console.warn('certificate-error for', url, ' — ignoring for load (brute-force).', error);
      callback(true);
    } catch (e) {
      callback(false);
    }
  });

  // --- Logging for loads ---
  mainWindow.webContents.on('did-fail-provisional-load', (e, errorCode, desc, validatedURL, isMainFrame) => {
    if (isMainFrame) {
      lastTriedURL = validatedURL || lastTriedURL;
      console.warn('Provisional load failed:', validatedURL, desc, errorCode);
      showOfflineOverlay();
    }
  });
  mainWindow.webContents.on('did-fail-load', (e, errorCode, desc, validatedURL, isMainFrame) => {
    if (isMainFrame) {
      lastTriedURL = validatedURL || lastTriedURL;
      console.warn('Load failed:', validatedURL, desc, errorCode);
      showOfflineOverlay();
    }
  });

  // Keep title stable
  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
    mainWindow.setTitle(`Sales+ POS v${packageJson.version}`);
  });

  // --- Splash -> main transition (guaranteed) ---
  function showMainAndCloseSplash() {
    try {
      if (splash && !splash.isDestroyed()) splash.close();
    } catch (e) {}
    try {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
    } catch (e) {}
  }

  mainWindow.webContents.on('did-finish-load', () => {
    // slight delay for splash polish
    setTimeout(() => {
      showMainAndCloseSplash();
      hideToast();
    }, 700);
  });

  // If something goes wrong but mainWindow still created, ensure splash doesn't hang forever
  setTimeout(() => {
    if (splash && !splash.isDestroyed() && (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible())) {
      // Give user the offline overlay if main didn't appear
      showOfflineOverlay();
      try { splash.close(); } catch (e) {}
    }
  }, 10000); // 10s fallback if nothing else happens

  // --- Try to load URL with retries (brute-force) ---
  async function tryLoadURL(url, maxAttempts = 5, attemptDelayMs = 2000) {
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.info(`Loading ${url} (attempt ${attempt}/${maxAttempts})`);
        // Attempt to load; await promise if possible
        await mainWindow.loadURL(url);
        lastTriedURL = url;
        return true;
      } catch (err) {
        lastErr = err;
        console.warn(`loadURL attempt ${attempt} failed:`, err && err.message ? err.message : err);
        // small wait before retry
        await new Promise(r => setTimeout(r, attemptDelayMs));
      }
    }
    console.error('All loadURL attempts failed for', url, 'last error:', lastErr);
    return false;
  }

  // --- Initial load: do NOT rely only on isOnline(); try direct load and fallback gracefully ---
  (async () => {
    try {
      // Attempt direct load (aggressive)
      const ok = await tryLoadURL(mainURL, 6, 2500);
      if (!ok) {
        // If direct load didn't work, check network and show offline overlay
        const online = await isOnline().catch(() => false);
        if (!online) {
          console.warn('Network check says offline — showing offline overlay.');
          showOfflineOverlay();
        } else {
          console.warn('Network up but remote failed — showing offline overlay and keeping retry button available.');
          showOfflineOverlay();
        }
      }
    } catch (err) {
      console.error('Initial aggressive load failed:', err);
      showOfflineOverlay();
    }
  })();

  // --- Network Monitor (toast only) ---
  async function monitorNetwork() {
    const online = await isOnline().catch(() => false);
    const overlayVisible = offlineOverlay && !offlineOverlay.isDestroyed() && offlineOverlay.isVisible();

    if (online) networkStableCount++;
    else networkStableCount = Math.max(networkStableCount - 2, 0);

    if (!online && networkStableCount < 1 && !lastOfflineState) {
      if (!overlayVisible) showToast('You are offline. Trying to reconnect…', '#ff4d4f');
      lastOfflineState = true;
    }

    if (online && networkStableCount >= 2 && lastOfflineState) {
      if (!overlayVisible) updateToast('Network restored. You’re back online!', '#4caf50');
      lastOfflineState = false;
      setTimeout(() => {
        hideToast();
        if (overlayVisible) retryLastURL();
      }, 1800);
    }
  }
  setInterval(monitorNetwork, 6000);

  // --- IPC handler for offline retry button ---
  ipcMain.handle('force-go-live', async () => {
    // Always attempt to load, regardless of isOnline() result — brute-force approach
    try {
      // quick network hint
      const online = await isOnline().catch(() => false);
      if (!online) {
        // If offline, still try to load (some networks block is-online probe)
        console.warn('force-go-live: network probe says offline — still attempting load');
      }
      if (offlineOverlay && !offlineOverlay.isDestroyed() && offlineOverlay.isVisible()) {
        offlineOverlay.hide();
      }
      const loaded = await tryLoadURL(lastTriedURL || mainURL, 4, 1500);
      if (!loaded) {
        showOfflineOverlay();
        return false;
      }
      return true;
    } catch (err) {
      console.error('force-go-live failed:', err);
      showOfflineOverlay();
      return false;
    }
  });

  // --- Helper functions ---
  function showOfflineOverlay() {
    try {
      if (!offlineOverlay || offlineOverlay.isDestroyed()) return;
      hideToast();
      // sync bounds then show
      try { offlineOverlay.setBounds(mainWindow.getBounds()); } catch (e) {}
      offlineOverlay.show();
      // Make sure mainWindow is visible behind it so the user sees the app window
      try {
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
      } catch (e) {}
    } catch (err) {
      console.error('showOfflineOverlay error:', err);
    }
  }

  async function retryLastURL() {
    try {
      if (offlineOverlay && !offlineOverlay.isDestroyed()) offlineOverlay.hide();
      await tryLoadURL(lastTriedURL || mainURL, 5, 1500);
    } catch (err) {
      console.error('retryLastURL failed:', err);
      showOfflineOverlay();
    }
  }

  // --- Toast utilities (mainWindow only) ---
  function showToast(message, color) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents
      .executeJavaScript(`
        (function() {
          let t = document.getElementById('net-toast');
          if (!t) {
            t = document.createElement('div');
            t.id = 'net-toast';
            t.style.cssText = "position:fixed;top:20px;right:20px;background:${color};color:#fff;padding:10px 16px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.2);z-index:999999;font-family:system-ui,sans-serif;transition:opacity .3s;opacity:1";
            t.textContent = '${message}';
            document.body.appendChild(t);
          } else {
            t.style.background = '${color}';
            t.textContent = '${message}';
            t.style.opacity = '1';
          }
        })();
      `)
      .catch(() => {});
  }

  function updateToast(message, color) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents
      .executeJavaScript(`
        const t = document.getElementById('net-toast');
        if (t) { t.style.background = '${color}'; t.textContent = '${message}'; }
      `)
      .catch(() => {});
  }

  function hideToast() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents
      .executeJavaScript(`
        const t = document.getElementById('net-toast');
        if (t) { t.style.opacity = '0'; setTimeout(()=>t.remove(), 300); }
      `)
      .catch(() => {});
  }
}

// Start
app.whenReady().then(async () => {
  await createWindows();
  // On macOS re-create window when dock icon clicked and no windows exist
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindows();
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
