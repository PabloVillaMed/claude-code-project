import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

await p.goto('http://127.0.0.1:8088/', { waitUntil: 'networkidle' });
await p.getByPlaceholder('Tu nombre').fill('Pablo');
await p.getByText('Entrar a la mesa').click();

// esperar a que salgan bolas y se marque el cartón
await p.waitForTimeout(40000);
await p.screenshot({ path: '/tmp/shots/4-marcado.png' });
const llevas = await p.locator('text=/Llevas \\d+ de 15/').first().textContent().catch(()=>null);
console.log('progreso:', llevas);

// esperar a que aparezca cualquier botón de cantar (o que gane un bot)
const claim = p.locator('text=/Cantar línea|Cantar dos líneas|¡Bingo!/').first();
try {
  await claim.waitFor({ state: 'visible', timeout: 150000 });
  const label = await claim.textContent();
  console.log('botón visible:', label);
  await p.screenshot({ path: '/tmp/shots/5-puede-cantar.png' });
  await claim.click();
  await p.waitForTimeout(800);
  const aviso = await p.locator('text=/tuya|adelantaron|Todavía/').first().textContent().catch(()=>null);
  console.log('respuesta al cantar:', aviso);
  await p.screenshot({ path: '/tmp/shots/6-cantado.png' });
} catch {
  console.log('no llegó botón; estado del feed:');
  console.log(await p.locator('text=/Línea ·|Dos líneas ·|Bingo ·/').allTextContents());
  await p.screenshot({ path: '/tmp/shots/5-sin-boton.png' });
}
console.log('errores JS:', errs.length ? errs : 'ninguno');
await b.close();
