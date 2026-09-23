// Prueba de humo de la app de escritorio: abre el ejecutable de Electron,
// espera a que el juego cargue, entra a jugar y guarda una captura.
// Uso: node scripts/electron-smoke.mjs [ruta-al-exe] [captura.png]
import { _electron as electron } from '@playwright/test';
import path from 'node:path';

const exe = process.argv[2];
const shot = process.argv[3] ?? 'electron-smoke.png';
const app = await electron.launch(
  exe
    ? { executablePath: path.resolve(exe), args: [], timeout: 120000 }
    : { args: ['.', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], timeout: 120000 },
);
const errors = [];
const win = await app.firstWindow();
win.on('pageerror', (e) => errors.push(e.message));
win.on('console', (m) => m.type() === 'error' && !/404|favicon/.test(m.text()) && errors.push(m.text()));
console.log('Ventana:', await win.title(), win.url());
await win.waitForFunction(() => window.__game?.ready, null, { timeout: 600000 });
const hasBridge = await win.evaluate(() => typeof window.desktop?.quit === 'function');
await win.click('[data-action="play"]');
await win.waitForFunction(() => window.__game.state().state === 'playing', null, { timeout: 60000 });
const start = await win.evaluate(() => window.__game.frames);
await win.waitForFunction((t) => window.__game.frames > t, start + 20, { timeout: 600000 });
await win.screenshot({ path: shot });
const state = await win.evaluate(() => window.__game.state());
console.log('Estado:', JSON.stringify({ state: state.state, peds: state.peds, vehicles: state.vehicles, fps: state.fps }));
await app.close();
if (!hasBridge) throw new Error('El puente preload (window.desktop) no está disponible');
if (errors.length) throw new Error(`Errores en la app:\n${errors.join('\n')}`);
console.log('OK: la app de escritorio arranca y el juego corre.');
