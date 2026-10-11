// Exporta el mundo del juego para Unreal Engine (ver ../medellin-unreal/LEEME.md).
// Uso: npm run exportar:unreal  (compila y deja los archivos en
// ../medellin-unreal/Importar). Usa el Chromium de Playwright; en este
// contenedor, PW_CHROMIUM=/opt/pw-browsers/chromium.
import { chromium } from '@playwright/test';
import { serveDist } from './serve.mjs';
import path from 'node:path';
import fs from 'node:fs';

const OUT = path.resolve(process.argv[2] ?? '../medellin-unreal/Importar');
const PORT = +(process.env.SHOTS_PORT ?? 4199);
const server = await serveDist(PORT, path.resolve(process.env.DIST_DIR ?? 'dist'));
const exe = process.env.PW_CHROMIUM || undefined;
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
console.log('Cargando el juego (calidad alta)...');
await page.goto(`http://localhost:${PORT}/?autotest=1&quality=${process.env.Q ?? 'alta'}`, { timeout: 900000 });
await page.waitForFunction(() => window.__game?.ready && window.__game.state().state === 'playing', null, { timeout: 900000 });
console.log('Exportando...');
const r = await page.evaluate(() => window.__game.exportarUnreal());
for (const l of r.log) console.log('  ' + l);
fs.rmSync(OUT, { recursive: true, force: true });
let total = 0;
const CH = 8 * 1024 * 1024;
for (const { nombre, bytes } of r.archivos) {
  const dest = path.join(OUT, nombre);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const fd = fs.openSync(dest, 'w');
  for (let o = 0; o < bytes; o += CH) {
    const b64 = await page.evaluate(([n, o, c]) => window.__game.leerExportado(n, o, c), [nombre, o, CH]);
    fs.writeSync(fd, Buffer.from(b64, 'base64'));
  }
  fs.closeSync(fd);
  total += bytes;
}
// Modelos originales (personajes, vehículos, armas, utilería) y sonidos, tal cual.
for (const sub of ['models/personajes', 'models/vehiculos', 'models/armas']) {
  const src = path.resolve('public', sub);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(OUT, 'modelos', path.basename(sub)), { recursive: true });
}
console.log(`Listo: ${r.archivos.length} archivos, ${(total / 1048576).toFixed(1)} MB en ${OUT}`);
if (errors.length) console.log('Errores de la página:\n' + errors.slice(0, 10).join('\n'));
await browser.close();
server.close?.();
process.exit(0);
