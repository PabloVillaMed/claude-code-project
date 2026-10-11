// Renderiza pruebas de sonido de motor a WAV (herramienta de desarrollo):
// node scripts/assets/visor-motor.mjs carpeta [perfil:vmax ...]
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const [out = 'motor', ...lista] = process.argv.slice(2);
const perfiles = lista.length ? lista : ['moto4t:40', 'moto2t:34', 'scooter:27', 'carro:46', 'diesel:26:2.8'];
fs.mkdirSync(out, { recursive: true });
const server = await createServer({ server: { port: 5600 + Math.floor(Math.random() * 300) }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('ERROR', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('consola', m.text()));
for (const p of perfiles) {
  const [perfil, vmax = '40', accel = '6'] = p.split(':');
  await page.goto(`${url}scripts/assets/visor-motor.html?perfil=${perfil}&vmax=${vmax}&accel=${accel}`);
  await page.waitForFunction(() => window.__listo, null, { timeout: 300000 });
  const { wav, rpm, peak } = await page.evaluate(() => ({ wav: window.__wav, rpm: window.__rpm, peak: window.__peak }));
  const file = path.join(out, `motor_${perfil}.wav`);
  fs.writeFileSync(file, Buffer.from(wav, 'base64'));
  fs.writeFileSync(path.join(out, `motor_${perfil}_rpm.json`), JSON.stringify(rpm));
  console.log(file, 'pico', peak.toFixed(2));
}
await browser.close();
await server.close();
