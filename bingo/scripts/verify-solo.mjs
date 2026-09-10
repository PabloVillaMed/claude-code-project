/**
 * Recorre una partida en modo práctica hasta poder cantar y canta.
 * Sirve dist-single/ y apunta aquí:  BASE=http://127.0.0.1:8091 node scripts/verify-solo.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8091';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(BASE, { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await p.screenshot({ path: '/tmp/shots/1-lobby.png' });
await p.getByPlaceholder('Tu nombre').fill('Pablo');
await p.getByText('Prefiero practicar sin rivales').click();

const claim = p.locator('text=/Cantar línea|Cantar dos líneas|¡Bingo!/').first();
await claim.waitFor({ state: 'visible', timeout: 290000 });
const label = (await claim.textContent()).trim();
const bola = await p.locator('text=/Bola \d+ de 90/').first().textContent();
console.log('apareció:', label, '|', bola);
await p.screenshot({ path: '/tmp/shots/5-puede-cantar.png' });
await claim.click();
await p.waitForTimeout(900);
console.log('aviso:', (await p.locator('text=/tuya|adelantaron|Todavía/').first().textContent()).trim());
await p.screenshot({ path: '/tmp/shots/6-cantado.png' });
console.log('errores JS:', errs.length ? errs : 'ninguno');
await b.close();
