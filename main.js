const { app, BrowserWindow, ipcMain, dialog, net } = require('electron');
const path = require('path');

const isDev = process.env.FORCE_CERT_IGNORE === '1';

if (isDev) {
  app.commandLine.appendSwitch('ignore-certificate-errors', 'true');
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  const startURL = 'https://cluster64.sp-server.online/public/login';
  const offlinePath = path.join(__dirname, 'splash.html');

  const loadOnline = () => mainWindow.loadURL(startURL);
  const loadOffline = () => mainWindow.loadFile(offlinePath);

  const testConnection = () =>
    new Promise((resolve) => {
      const req = net.request(startURL);
      req.on('response', () => resolve(true));
      req.on('error', () => resolve(false));
      req.end();
    });

  (async () => {
    const online = await testConnection();
    if (online) loadOnline();
    else loadOffline();
  })();

  ipcMain.handle('force-go-live', async () => {
    try {
      const online = await testConnection();
      if (online) {
        loadOnline();
        return true;
      } else {
        return false;
      }
    } catch {
      return false;
    }
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
