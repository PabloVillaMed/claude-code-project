// Captura del visor de vehículos (herramienta de desarrollo):
// node scripts/assets/visor-vehiculos.mjs salida.png "raw=suv_compacta,moto_2t"
// node scripts/assets/visor-vehiculos.mjs salida.png "v=taxi:hatchback,moto:moto_2t&conductor=1"
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const [out = 'visor.png', query = 'raw=hatchback', size = '1600x700'] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);
const server = await createServer({ server: { port: 5199 + Math.floor(Math.random() * 400) }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.on('pageerror', (e) => console.log('ERROR', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('consola', m.text()));
await page.goto(`${url}scripts/assets/visor-vehiculos.html?${query}`);
await page.waitForFunction(() => window.__visorReady, null, { timeout: 300000 });
await page.screenshot({ path: out });
await browser.close();
await server.close();
console.log('ok', out);
