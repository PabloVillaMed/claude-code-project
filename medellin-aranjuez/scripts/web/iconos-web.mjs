// Íconos de la versión web (public/icons/) a partir de build/icon.png (512 px,
// esquinas redondeadas transparentes; lo genera scripts/make-icon.mjs).
// Uso: node scripts/web/iconos-web.mjs   (también lo corre `npm run icon` al final)
//
//  icon-192.png, icon-512.png   → manifiesto, purpose "any" (tal cual, con esquinas)
//  icon-maskable-512.png        → purpose "maskable": cuadro lleno, el dibujo
//                                 dentro de la zona segura (círculo del 80 %)
//  apple-touch-icon.png (180)   → iOS: sin transparencia (iOS pone su máscara)
//  favicon-32.png               → pestaña del navegador
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export async function makeWebIcons({ src = path.join(ROOT, 'build/icon.png'), out = path.join(ROOT, 'public/icons') } = {}) {
  fs.mkdirSync(out, { recursive: true });
  const png = (img) => img.png({ compressionLevel: 9, adaptiveFiltering: true });
  const meta = await sharp(src).metadata();
  const S = meta.width;
  // El ícono tiene esquinas redondeadas (radio 96 de 512): recortando 6.25 %
  // por lado queda un cuadro sin transparencia, el "lleno" para las máscaras.
  const inset = Math.ceil(S * 0.0625);
  const full = await sharp(src)
    .extract({ left: inset, top: inset, width: S - 2 * inset, height: S - 2 * inset })
    .flatten({ background: '#000000' })
    .toBuffer();

  const files = {};
  const write = async (name, img) => {
    const f = path.join(out, name);
    await png(img).toFile(f);
    files[name] = fs.statSync(f).size;
  };
  await write('icon-192.png', sharp(src).resize(192, 192, { kernel: 'lanczos3' }));
  await write('icon-512.png', sharp(src).resize(512, 512, { kernel: 'lanczos3' }));
  await write('favicon-32.png', sharp(src).resize(32, 32, { kernel: 'lanczos3' }));
  await write('apple-touch-icon.png', sharp(full).resize(180, 180, { kernel: 'lanczos3' }));
  // Maskable: el dibujo lleno a 400 px (78 %: la letra queda dentro del
  // círculo seguro de 410) sobre su propio borde estirado y desenfocado, para
  // que no se note el corte con máscaras más grandes que el círculo
  // (cuadrado redondeado, gota).
  const inner = 400;
  const pad = (512 - inner) / 2;
  const innerBuf = await sharp(full).resize(inner, inner, { kernel: 'lanczos3' }).toBuffer();
  const bg = await sharp(innerBuf).extend({ top: pad, bottom: pad, left: pad, right: pad, extendWith: 'copy' }).blur(14).toBuffer();
  await write('icon-maskable-512.png', sharp(bg).composite([{ input: innerBuf, left: pad, top: pad }]));
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = await makeWebIcons();
  console.log('íconos web listos:', Object.entries(files).map(([n, b]) => `${n} (${(b / 1024).toFixed(1)} KB)`).join(', '));
}
