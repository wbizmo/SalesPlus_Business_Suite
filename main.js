const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const isOnline = require('is-online');
const packageJson = require('./package.json');

let mainWindow, splash, offlineOverlay;
const mainURL = 'https://cluster64.sp-server.online/public/';
let lastTriedURL = mainURL;
let lastOfflineState = false;
let networkStableCount = 0; // helps filter out brief fluctuations

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
  splash.loadFile(path.join(__dirname, 'splash.html'));

  // --- Main window ---
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#f4f6fa',
    icon: path.join(__dirname, 'build/icon.ico'),
    title: `Sales+ POS v${packageJson.version}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      partition: 'persist:main',
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
      preload: path.join(__dirname, 'offline-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  offlineOverlay.loadFile(path.join(__dirname, 'offline.html'));

  // --- Sync overlay bounds with main window ---
  function syncOverlayBounds() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (offlineOverlay && !offlineOverlay.isDestroyed()) {
      offlineOverlay.setBounds(mainWindow.getBounds());
    }
  }
  mainWindow.on('move', syncOverlayBounds);
  mainWindow.on('resize', syncOverlayBounds);
  mainWindow.on('enter-full-screen', syncOverlayBounds);
  mainWindow.on('leave-full-screen', syncOverlayBounds);

  // --- Try initial load ---
  try {
    if (await isOnline()) {
      await mainWindow.loadURL(mainURL);
      lastTriedURL = mainURL;
    } else {
      showOfflineOverlay();
    }
  } catch (err) {
    console.error('Initial load failed:', err);
    showOfflineOverlay();
  }

  // --- Splash → Main transition ---
  mainWindow.webContents.on('did-finish-load', () => {
    setTimeout(() => {
      if (splash && !splash.isDestroyed()) splash.close();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    }, 700);
  });

  // --- Fix title ---
  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
    mainWindow.setTitle(`Sales+ POS v${packageJson.version}`);
  });

  // --- Handle failed loads (GET/POST/new navigation) ---
  mainWindow.webContents.on('did-fail-provisional-load', (e, errorCode, desc, validatedURL, isMainFrame) => {
    if (isMainFrame) {
      lastTriedURL = validatedURL || lastTriedURL;
      console.warn('Provisional load failed:', validatedURL, desc);
      showOfflineOverlay();
    }
  });

  mainWindow.webContents.on('did-fail-load', (e, errorCode, desc, validatedURL, isMainFrame) => {
    if (isMainFrame) {
      lastTriedURL = validatedURL || lastTriedURL;
      console.warn('Load failed:', validatedURL, desc);
      showOfflineOverlay();
    }
  });

  // --- Network Monitor (for popup toast only) ---
  async function monitorNetwork() {
    const online = await isOnline().catch(() => false);
    const overlayVisible =
      offlineOverlay && !offlineOverlay.isDestroyed() && offlineOverlay.isVisible();

    // debounce-style smoothing
    if (online) networkStableCount++;
    else networkStableCount = Math.max(networkStableCount - 2, 0); // decay faster on drop

    // trigger offline after consistent failures
    if (!online && networkStableCount < 1 && !lastOfflineState) {
      if (!overlayVisible) showToast('You are offline. Trying to reconnect…', '#ff4d4f');
      lastOfflineState = true;
    }

    // trigger restored when consistently online again
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
    const online = await isOnline().catch(() => false);
    if (!online) return false;

    if (offlineOverlay && !offlineOverlay.isDestroyed() && offlineOverlay.isVisible()) {
      offlineOverlay.hide();
    }

    try {
      await mainWindow.loadURL(lastTriedURL);
    } catch (err) {
      console.error('Retry load failed:', err);
      showOfflineOverlay();
      return false;
    }
    return true;
  });

  // --- Helper functions ---
  function showOfflineOverlay() {
    try {
      if (!offlineOverlay || offlineOverlay.isDestroyed()) return;
      hideToast();
      offlineOverlay.setBounds(mainWindow.getBounds());
      offlineOverlay.show();
    } catch (err) {
      console.error('showOfflineOverlay error:', err);
    }
  }

  async function retryLastURL() {
    try {
      if (offlineOverlay && !offlineOverlay.isDestroyed()) offlineOverlay.hide();
      await mainWindow.loadURL(lastTriedURL);
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

app.whenReady().then(createWindows);
