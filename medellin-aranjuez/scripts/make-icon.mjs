// Genera build/icon.png (512 px) y build/icon.ico (Windows, PNG embebido 256 px).
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const html = `<canvas id="c" width="512" height="512"></canvas><script>
const c = document.getElementById('c'), x = c.getContext('2d');
const r = 96;
x.beginPath(); x.moveTo(r,0); x.arcTo(512,0,512,512,r); x.arcTo(512,512,0,512,r); x.arcTo(0,512,0,0,r); x.arcTo(0,0,512,0,r); x.closePath(); x.clip();
const g = x.createLinearGradient(0,0,0,512); g.addColorStop(0,'#f59e0b'); g.addColorStop(0.55,'#d9480f'); g.addColorStop(1,'#3b0d0c');
x.fillStyle = g; x.fillRect(0,0,512,512);
x.fillStyle = 'rgba(255,230,160,0.9)'; x.beginPath(); x.arc(360,190,70,0,Math.PI*2); x.fill();
// Montañas y casas de la ladera
x.fillStyle = '#1f2a20'; x.beginPath(); x.moveTo(0,330); x.quadraticCurveTo(140,230,260,300); x.quadraticCurveTo(380,230,512,280); x.lineTo(512,512); x.lineTo(0,512); x.fill();
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let i = 0; i < 90; i++) { const px = rnd()*512, py = 300 + rnd()*200; x.fillStyle = ['#8c3b22','#b5543a','#d9d2c3','#6b2a1a'][i%4]; x.fillRect(px, py, 16+rnd()*14, 12+rnd()*10); x.fillStyle='rgba(255,210,120,0.9)'; if (rnd()<0.5) x.fillRect(px+4, py+4, 4, 4); }
x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0,380,512,132);
x.font = 'italic 900 250px Arial Black, Arial'; x.textAlign = 'center';
x.lineWidth = 14; x.strokeStyle = '#111'; x.strokeText('A', 256, 440);
const tg = x.createLinearGradient(0,250,0,440); tg.addColorStop(0,'#ffffff'); tg.addColorStop(1,'#ffd200');
x.fillStyle = tg; x.fillText('A', 256, 440);
</script>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.setContent(html);
const png512 = Buffer.from((await page.evaluate(() => document.getElementById('c').toDataURL('image/png'))).split(',')[1], 'base64');
const png256 = Buffer.from(
  (await page.evaluate(() => {
    const s = document.createElement('canvas');
    s.width = s.height = 256;
    s.getContext('2d').drawImage(document.getElementById('c'), 0, 0, 256, 256);
    return s.toDataURL('image/png');
  })).split(',')[1],
  'base64',
);
await browser.close();
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/icon.png', png512);
// ICO con una imagen PNG de 256x256 (soportado desde Windows Vista).
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0); // 256
entry.writeUInt8(0, 1);
entry.writeUInt8(0, 2);
entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png256.length, 8);
entry.writeUInt32LE(22, 12);
fs.writeFileSync('build/icon.ico', Buffer.concat([header, entry, png256]));
console.log('icono listo', png512.length, png256.length);
