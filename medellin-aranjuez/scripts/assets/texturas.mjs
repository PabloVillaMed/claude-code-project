// Descarga y optimiza las texturas PBR fotográficas y el HDRI del cielo desde
// Poly Haven (todas CC0). Reproducible: `node scripts/assets/texturas.mjs`.
//
// Salida: public/textures/<id>/{color,normal,rough}.webp y public/hdri/*.hdr,
// más public/textures/manifest.json con el tamaño real (m) de cada textura
// para que el render la repita a escala correcta.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT_TEX = path.join(ROOT, 'public/textures');
const OUT_HDR = path.join(ROOT, 'public/hdri');

// id de Poly Haven -> uso en el juego y resolución de descarga.
export const TEXTURES = [
  { id: 'red_brick', use: 'Fachada de ladrillo farol (variante A)', res: '2k', size: 1024 },
  { id: 'large_red_bricks', use: 'Fachada de ladrillo farol (variante B)', res: '2k', size: 1024 },
  { id: 'painted_plaster_wall', use: 'Repello pintado (casas de colores)', res: '1k', size: 1024 },
  { id: 'beige_wall_001', use: 'Repello pintado (variante)', res: '1k', size: 1024 },
  { id: 'asphalt_02', use: 'Asfalto de las calles', res: '2k', size: 1024 },
  { id: 'grey_tiles', use: 'Baldosas de los andenes', res: '1k', size: 1024 },
  { id: 'herringbone_brick', use: 'Ladrillo en espiga de plazas y parques', res: '1k', size: 1024 },
  { id: 'leafy_grass', use: 'Pasto de parques y terreno', res: '1k', size: 1024 },
  { id: 'clay_roof_tiles_02', use: 'Teja de barro', res: '1k', size: 1024 },
  { id: 'concrete_floor_02', use: 'Planchas de concreto en terrazas', res: '1k', size: 1024 },
  { id: 'concrete_wall_008', use: 'Muros, cimientos y sardineles', res: '1k', size: 512 },
  { id: 'corrugated_iron_02', use: 'Zinc / lámina de talleres', res: '1k', size: 512 },
];

export const HDRIS = [{ id: 'kloofendal_48d_partly_cloudy_puresky', use: 'Iluminación ambiental de día (IBL)', res: '1k' }];

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function download(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function main() {
  fs.mkdirSync(OUT_TEX, { recursive: true });
  fs.mkdirSync(OUT_HDR, { recursive: true });
  const manifest = {};
  for (const t of TEXTURES) {
    const [files, info] = await Promise.all([getJson(`https://api.polyhaven.com/files/${t.id}`), getJson(`https://api.polyhaven.com/info/${t.id}`)]);
    const dir = path.join(OUT_TEX, t.id);
    fs.mkdirSync(dir, { recursive: true });
    const maps = { color: 'Diffuse', normal: 'nor_gl', rough: 'Rough' };
    for (const [name, key] of Object.entries(maps)) {
      const entry = files[key]?.[t.res]?.jpg ?? files[key]?.['1k']?.jpg;
      if (!entry) continue;
      const buf = await download(entry.url);
      await sharp(buf)
        .resize(t.size, t.size, { fit: 'fill' })
        .webp({ quality: name === 'color' ? 86 : 90 })
        .toFile(path.join(dir, `${name}.webp`));
    }
    manifest[t.id] = {
      name: info.name,
      use: t.use,
      authors: Object.keys(info.authors ?? {}),
      metersX: (info.dimensions?.[0] ?? 2000) / 1000,
      metersY: (info.dimensions?.[1] ?? 2000) / 1000,
      license: 'CC0',
      source: `https://polyhaven.com/a/${t.id}`,
    };
    console.log('textura', t.id, manifest[t.id].metersX.toFixed(2), 'm');
  }
  for (const h of HDRIS) {
    const [files, info] = await Promise.all([getJson(`https://api.polyhaven.com/files/${h.id}`), getJson(`https://api.polyhaven.com/info/${h.id}`)]);
    const buf = await download(files.hdri[h.res].hdr.url);
    fs.writeFileSync(path.join(OUT_HDR, `${h.id}.hdr`), buf);
    manifest[`hdri:${h.id}`] = { name: info.name, use: h.use, authors: Object.keys(info.authors ?? {}), license: 'CC0', source: `https://polyhaven.com/a/${h.id}` };
    console.log('hdri', h.id, (buf.length / 1e6).toFixed(1), 'MB');
  }
  fs.writeFileSync(path.join(OUT_TEX, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
