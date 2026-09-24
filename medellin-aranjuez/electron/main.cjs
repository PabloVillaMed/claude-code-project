// Proceso principal de Electron: ventana del juego para Windows 11.
const { app, BrowserWindow, Menu, ipcMain, protocol, shell } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

// Modo prueba de humo (CI): --smoke-test [--smoke-out=captura.png]
const SMOKE = process.argv.includes('--smoke-test');
const SMOKE_OUT = path.resolve((process.argv.find((a) => a.startsWith('--smoke-out=')) ?? '--smoke-out=electron-smoke.png').slice('--smoke-out='.length));

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
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.hdr': 'image/vnd.radiance',
  '.ktx2': 'image/ktx2',
  '.md': 'text/markdown; charset=utf-8',
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
  win.loadURL(SMOKE ? 'app://juego/index.html?quality=baja' : 'app://juego/index.html');
  if (SMOKE) runSmokeTest(win);
  // El juego mantiene su casilla de pantalla completa al día (también con F11).
  win.on('enter-full-screen', () => win.webContents.send('app:fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('app:fullscreen', false));
  win.on('closed', () => {
    win = null;
  });
}

/**
 * Prueba de humo del ejecutable real: carga el juego, entra a jugar desde el
 * menú, espera a que corra, guarda una captura y sale con 0 (ok) o 1 (fallo).
 * El resultado queda también en <captura>.txt (las apps GUI de Windows no
 * tienen consola).
 */
async function runSmokeTest(w) {
  const log = [];
  const say = (m) => {
    log.push(m);
    console.log(m);
    fsSync.writeFileSync(`${SMOKE_OUT}.txt`, log.join('\n'));
  };
  const errors = [];
  w.webContents.on('console-message', (e, ...rest) => {
    const level = e?.level ?? rest[0];
    const message = e?.message ?? rest[1];
    if ((level === 'error' || level === 3) && !/404|favicon/.test(String(message))) errors.push(String(message));
  });
  const js = (code) => w.webContents.executeJavaScript(code, true);
  const deadline = Date.now() + 20 * 60 * 1000;
  const waitFor = async (code, label) => {
    while (Date.now() < deadline) {
      try {
        if (await js(code)) return;
      } catch {
        // la página aún no está lista
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`Tiempo agotado esperando: ${label}`);
  };
  try {
    say(`Iniciando prueba de humo: ${app.getName()} ${app.getVersion()} (${process.platform})`);
    await waitFor('!!(window.__game && window.__game.ready)', 'carga del juego');
    say('Juego cargado; entrando desde el menú.');
    await js(`document.querySelector('[data-action="play"]').click()`);
    await waitFor(`window.__game.state().state === 'playing'`, 'partida');
    const f0 = await js('window.__game.frames');
    await waitFor(`window.__game.frames > ${f0 + 20}`, '20 frames de juego');
    const img = await w.webContents.capturePage();
    fsSync.writeFileSync(SMOKE_OUT, img.toPNG());
    const st = JSON.parse(await js('JSON.stringify(window.__game.state())'));
    say(`Estado: ${JSON.stringify({ state: st.state, peatones: st.peds, vehiculos: st.vehicles, puente: await js('typeof window.desktop?.quit') })}`);
    if (errors.length) throw new Error(`Errores en consola:\n${errors.join('\n')}`);
    say(`OK: la app arranca y el juego corre. Captura: ${SMOKE_OUT}`);
    app.exit(0);
  } catch (err) {
    say(`FALLO: ${err.message}`);
    app.exit(1);
  }
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
  ipcMain.on('app:set-fullscreen', (e, on) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && w.isFullScreen() !== !!on) w.setFullScreen(!!on);
  });
  createWindow();
});

app.on('window-all-closed', () => app.quit());
