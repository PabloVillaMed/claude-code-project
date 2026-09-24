// Proceso principal de Electron: ventana del juego para Windows 11.
const { app, BrowserWindow, Menu, ipcMain, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

// El juego se sirve desde un protocolo propio (seguro y con origen estable
// para la CSP y el guardado en localStorage).
// `corsEnabled` es necesario: Vite marca los módulos con `crossorigin`.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Rendimiento: usar la GPU dedicada y no limitar por lista negra de drivers.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

if (process.platform === 'win32') app.setAppUserModelId('com.pablovilla.medellinaranjuez');

// Las cabeceras HTTP solo admiten Latin-1: se limpia el User-Agent por si el
// nombre del producto trae tildes.
app.userAgentFallback = app.userAgentFallback.replace(/[^\x20-\x7E]/g, '');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const DIST = path.join(__dirname, '..', 'dist');
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    title: 'Medellín: Aranjuez',
    backgroundColor: '#000000',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) e.preventDefault();
  });
  win.loadURL('app://juego/index.html');
  win.on('closed', () => {
    win = null;
  });
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('Prohibido', { status: 403 });
    try {
      const body = await fs.readFile(file);
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Access-Control-Allow-Origin': 'app://juego' },
      });
    } catch {
      return new Response('No encontrado', { status: 404 });
    }
  });
  ipcMain.on('app:quit', () => app.quit());
  ipcMain.on('app:toggle-fullscreen', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) w.setFullScreen(!w.isFullScreen());
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
