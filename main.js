// main.js — aggressive, packaging-safe, non-caching, hair-trigger network UX
// certificate-ignore is opt-in via env FORCE_CERT_IGNORE === '1'
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
  // --- Focus helper to prevent input freeze ---
  function restoreWebviewFocus() {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
        mainWindow.webContents.focus();
      }
    } catch (e) {
      console.warn('Failed to restore webview focus:', e);
    }
  }

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
    if (isMainFrame) {
      lastTriedURL = validatedURL || lastTriedURL;
      console.warn('Provisional main-frame load failed:', validatedURL, desc, errorCode);
      showFullOverlayForMainFrameFailure(validatedURL);
    } else {
      showInlineToast('⚠️ Network glitch — some resources failed to load', '#ff4d4f');
    }
  });

  mainWindow.webContents.on('did-fail-load', (e, errorCode, desc, validatedURL, isMainFrame) => {
    if (isMainFrame) {
      lastTriedURL = validatedURL || lastTriedURL;
      showFullOverlayForMainFrameFailure(validatedURL);
    } else {
      showInlineToast('⚠️ Network glitch — resource load failed', '#ff4d4f');
    }
  });

  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
    mainWindow.setTitle(`Sales+ POS v${packageJson.version}`);
  });

  // --- Splash hide ---
  function showMainAndCloseSplash() {
    try { if (splash && !splash.isDestroyed()) splash.close(); } catch (e) {}
    try { if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show(); restoreWebviewFocus(); } catch (e) {}
  }

  mainWindow.webContents.on('did-finish-load', async () => {
    setTimeout(() => {
      hideInlineToast();
      if (offlineOverlay && !offlineOverlay.isDestroyed() && offlineOverlay.isVisible()) {
        try { offlineOverlay.hide(); restoreWebviewFocus(); } catch (e) {}
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

  // --- Toast helpers ---
  function showInlineToast(message, color) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.executeJavaScript(`
      (function() {
        let t = document.getElementById('__sp_net_toast');
        if (!t) {
          t = document.createElement('div');
          t.id = '__sp_net_toast';
          t.style.cssText = "position:fixed;top:18px;right:18px;padding:10px 14px;border-radius:8px;box-shadow:0 3px 12px rgba(0,0,0,0.18);z-index:2147483647;font-family:Inter, system-ui, sans-serif;font-weight:600;transition:opacity .15s, transform .15s;opacity:1;transform:translateY(0)";
          document.body.appendChild(t);
        }
        t.style.background = '${color}';
        t.style.color = '#fff';
        t.textContent = '${message}';
        t.style.opacity = '1';
        t.style.transform = 'translateY(0)';
        if (${JSON.stringify(message)}.toLowerCase().includes('back online')) {
          setTimeout(()=>{ if (t) { t.style.opacity='0'; t.style.transform='translateY(8px)'; setTimeout(()=>t.remove(),200); } }, 2000);
        }
      })();
    `).catch(() => {});
  }

  function updateInlineToast(message, color) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.executeJavaScript(`
      (function() {
        const t = document.getElementById('__sp_net_toast');
        if (t) { t.style.background = '${color}'; t.textContent = '${message}'; }
      })();
    `).catch(() => {});
  }

  function hideInlineToast() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.executeJavaScript(`
      (function() {
        const t = document.getElementById('__sp_net_toast');
        if (t) { t.style.opacity='0'; t.style.transform='translateY(8px)'; setTimeout(()=>t.remove(),200); }
      })();
    `).catch(() => {});
  }

  // --- Full overlay ---
  function showFullOverlayForMainFrameFailure(failedUrl) {
    try {
      if (!offlineOverlay || offlineOverlay.isDestroyed()) return;
      try { if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show(); } catch (e) {}
      hideInlineToast();
      try { offlineOverlay.setBounds(mainWindow.getBounds()); } catch (e) {}
      offlineOverlay.show();
      restoreWebviewFocus();
    } catch (err) { console.error('showFullOverlayForMainFrameFailure error:', err && err.message); }
  }

  // --- URL loader ---
  async function tryLoadURL(url, maxAttempts = 5, attemptDelayMs = 1500) {
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.info(`Loading ${url} (attempt ${attempt}/${maxAttempts})`);
        try { await mainWindow.webContents.session.clearCache(); } catch (e) {}
        await mainWindow.loadURL(url);
        lastTriedURL = url;
        restoreWebviewFocus();
        return true;
      } catch (err) {
        lastErr = err;
        console.warn(`loadURL attempt ${attempt} failed:`, err && err.message ? err.message : err);
        await new Promise(r => setTimeout(r, attemptDelayMs));
      }
    }
    console.error('All loadURL attempts failed for', url, 'last error:', lastErr && lastErr.message);
    return false;
  }

  // --- Initial aggressive load ---
  (async () => {
    try {
      const ok = await tryLoadURL(mainURL, 6, 2000);
      if (!ok) showFullOverlayForMainFrameFailure(lastTriedURL);
    } catch (err) {
      console.error('Initial aggressive load failed:', err && err.message);
      showFullOverlayForMainFrameFailure(lastTriedURL);
    }
  })();

  // --- Network monitor ---
  async function monitorNetwork() {
    const onlineProbe = await isOnline().catch(() => false);

    let rendererOnline = null;
    try {
      rendererOnline = await mainWindow.webContents.executeJavaScript('typeof navigator !== "undefined" && navigator.onLine', true).catch(() => null);
    } catch (e) { rendererOnline = null; }

    const online = (rendererOnline === true) || onlineProbe;

    if (online) networkStableCount++;
    else networkStableCount = Math.max(networkStableCount - 2, 0);

    const overlayVisible = offlineOverlay && !offlineOverlay.isDestroyed() && offlineOverlay.isVisible();

    if (!online && networkStableCount < 1 && !lastOfflineState) {
      try {
        const hasContent = await mainWindow.webContents.executeJavaScript('document.readyState === "complete" || document.body?.innerText?.length > 0', true).catch(() => false);
        if (hasContent) showInlineToast('⚠️ Offline — changes will be saved and resumed when online', '#ff4d4f');
        else showFullOverlayForMainFrameFailure(lastTriedURL);
      } catch (e) { showFullOverlayForMainFrameFailure(lastTriedURL); }
      lastOfflineState = true;
    }

    if (online && networkStableCount >= 1 && lastOfflineState) {
      lastOfflineState = false;
      try { updateInlineToast('✅ Back online — restoring connection...', '#22c55e'); restoreWebviewFocus(); } catch (e) {}
      try { if (overlayVisible) { try { offlineOverlay.hide(); restoreWebviewFocus(); } catch (e) {} } } catch (e) {}
      (async () => {
        try {
          await mainWindow.webContents.session.clearCache().catch(()=>{});
          const loaded = await tryLoadURL(lastTriedURL || mainURL, 4, 1200);
          if (!loaded) showFullOverlayForMainFrameFailure(lastTriedURL);
        } catch (err) {
          console.error('Auto reload error after online:', err && err.message);
          showFullOverlayForMainFrameFailure(lastTriedURL);
        }
      })();
    }
  }
  setInterval(monitorNetwork, 3000);

  // --- IPC handler ---
  ipcMain.handle('force-go-live', async () => {
    try {
      if (offlineOverlay && !offlineOverlay.isDestroyed() && offlineOverlay.isVisible()) {
        try { offlineOverlay.hide(); restoreWebviewFocus(); } catch (e) {}
      }
      await mainWindow.webContents.session.clearCache().catch(()=>{});
      const ok = await tryLoadURL(lastTriedURL || mainURL, 5, 1000);
      if (!ok) showFullOverlayForMainFrameFailure(lastTriedURL);
      return ok;
    } catch (err) {
      console.error('force-go-live failed:', err && err.message);
      showFullOverlayForMainFrameFailure(lastTriedURL);
      return false;
    }
  });

  async function retryLastURL() {
    try {
      if (offlineOverlay && !offlineOverlay.isDestroyed()) offlineOverlay.hide();
      await mainWindow.webContents.session.clearCache().catch(()=>{});
      await tryLoadURL(lastTriedURL || mainURL, 5, 1200);
    } catch (err) { showFullOverlayForMainFrameFailure(lastTriedURL); }
  }
}

// App lifecycle
app.whenReady().then(async () => {
  await createWindows();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindows(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
