const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, session, shell } = require('electron');

const DEFAULT_APP_URL = 'https://diavlo-cord.vercel.app';

function resolveAppUrl() {
  const raw = process.env.DIAVLOCORD_DESKTOP_URL || DEFAULT_APP_URL;
  try {
    return new URL(raw).toString();
  } catch {
    return DEFAULT_APP_URL;
  }
}

const APP_URL = resolveAppUrl();
const APP_ORIGIN = new URL(APP_URL).origin;

let mainWindow = null;
const GENERATED_ICON_WIN = path.join(__dirname, '..', 'build', 'icon.ico');
const GENERATED_ICON_LINUX = path.join(__dirname, '..', 'build', 'icon.png');
const LEGACY_ICON_WIN = path.join(__dirname, '..', 'src', 'app', 'icon.ico');
const LEGACY_ICON_LINUX = path.join(__dirname, '..', 'public', 'logo.png');

const WINDOW_ICON =
  process.platform === 'linux'
    ? (fs.existsSync(GENERATED_ICON_LINUX) ? GENERATED_ICON_LINUX : LEGACY_ICON_LINUX)
    : (fs.existsSync(GENERATED_ICON_WIN) ? GENERATED_ICON_WIN : LEGACY_ICON_WIN);

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1420,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#07090f',
    autoHideMenuBar: true,
    show: false,
    icon: WINDOW_ICON,
    title: 'DiavloCord',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.origin === APP_ORIGIN) {
        return { action: 'allow' };
      }
    } catch {
      // noop
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.origin === APP_ORIGIN) return;
      event.preventDefault();
      shell.openExternal(url);
    } catch {
      // noop
    }
  });

  win.webContents.on('did-fail-load', (_event, errorCode, _errorDescription, validatedURL) => {
    const failedHttpLoad = errorCode !== 0 && /^https?:\/\//i.test(validatedURL || '');
    if (failedHttpLoad) {
      void win.loadFile(path.join(__dirname, 'offline.html'));
    }
  });

  void win.loadURL(APP_URL);
  return win;
}

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.diavlocord.desktop');
    }

    Menu.setApplicationMenu(null);

    session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      const allowList = new Set([
        'media',
        'microphone',
        'camera',
        'notifications',
        'clipboard-sanitized-write',
      ]);
      callback(allowList.has(permission));
    });

    mainWindow = createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
