// Descarga los datos reales del mapa (se ejecuta a mano; usa caché):
//  - OpenStreetMap (Overpass): vías, metro, zonas verdes, canchas, iglesias,
//    quebradas y edificios del sector entre Moravia y Aranjuez.
//  - OpenStreetMap, consulta complementaria: nodos de las vías (semáforos,
//    cruces peatonales, paraderos), lugares puntuales (salud, turismo, arte)
//    y edificios multipolígono.
//  - Elevación SRTM 30 m (OpenTopoData) en una rejilla que cubre el mapa.
// Salida: .cache/mapa/osm.json, .cache/mapa/osm-extra.json y
// .cache/mapa/srtm.json (los procesa construir.mjs). Lo que ya está en caché
// no se vuelve a pedir: para datos frescos se borra el archivo.
// Uso: node scripts/mapa/descargar.mjs  (Node 22+: si hay proxy, NODE_USE_ENV_PROXY=1)

import fs from 'node:fs';
import path from 'node:path';
import { REGION, MARGIN_DEG } from './region.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const CACHE = path.join(ROOT, '.cache/mapa');
fs.mkdirSync(CACHE, { recursive: true });
const UA = 'MedellinAranjuezGame/0.2 (juego de mundo abierto; construccion de mapa)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const m = MARGIN_DEG;
const bbox = `${REGION.south - m},${REGION.west - m},${REGION.north + m},${REGION.east + m}`;

// Consulta principal: todo lo que tiene forma (vías, zonas, edificios…).
const Q_MAIN = `[out:json][timeout:180];
(
  way["highway"](${bbox});
  way["railway"](${bbox});
  nwr["railway"~"station|platform|subway_entrance|halt"](${bbox});
  nwr["public_transport"](${bbox});
  way["leisure"](${bbox});
  way["landuse"](${bbox});
  way["natural"](${bbox});
  way["waterway"](${bbox});
  way["amenity"](${bbox});
  way["building"](${bbox});
  way["man_made"](${bbox});
  relation["leisure"](${bbox});
  relation["landuse"](${bbox});
  node["amenity"](${bbox});
  node["shop"](${bbox});
);
out body geom;`;

// Consulta complementaria: nodos sueltos de las vías y de lugares, y los
// edificios que OpenStreetMap guarda como multipolígono.
const Q_EXTRA = `[out:json][timeout:120];
(
  node["highway"~"traffic_signals|crossing|bus_stop|stop|give_way"](${bbox});
  node["tourism"](${bbox});
  node["leisure"](${bbox});
  node["healthcare"](${bbox});
  node["office"](${bbox});
  node["historic"](${bbox});
  node["craft"](${bbox});
  relation["building"](${bbox});
);
out body geom;`;

async function overpass(file, q, minElements) {
  const out = path.join(CACHE, file);
  if (fs.existsSync(out) && fs.statSync(out).size > 1000) return console.log(`${file} en caché`);
  const hosts = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  for (let intento = 0; intento < 18; intento++) {
    const host = hosts[intento % hosts.length];
    try {
      console.log(`Overpass (${host}) intento ${intento + 1}…`);
      const r = await fetch(host, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
      const txt = await r.text();
      if (r.ok && txt.trim().startsWith('{')) {
        const j = JSON.parse(txt);
        if (j.elements?.length > minElements) {
          fs.writeFileSync(out, txt);
          console.log(`${file}: ${j.elements.length} elementos`);
          return;
        }
      }
      console.log(`  respuesta ${r.status}, ${txt.length} bytes`);
    } catch (e) {
      console.log('  error', e.message);
    }
    await sleep(Math.min(120000, 8000 * (intento + 1)));
  }
  throw new Error(`No se pudo descargar ${file}`);
}

async function srtm() {
  const out = path.join(CACHE, 'srtm.json');
  // Rejilla de ~30 m sobre la región con margen.
  const m = MARGIN_DEG * 2;
  const s = REGION.south - m;
  const n = REGION.north + m;
  const w = REGION.west - m;
  const e = REGION.east + m;
  const step = 0.00027; // ~30 m
  const lats = [];
  const lons = [];
  for (let la = s; la <= n + 1e-9; la += step) lats.push(+la.toFixed(6));
  for (let lo = w; lo <= e + 1e-9; lo += step) lons.push(+lo.toFixed(6));
  const pts = [];
  for (const la of lats) for (const lo of lons) pts.push([la, lo]);
  let data = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  if (!data || data.lats.length !== lats.length || data.lons.length !== lons.length) data = { lats, lons, h: new Array(pts.length).fill(null) };
  for (let i = 0; i < pts.length; i += 100) {
    if (data.h.slice(i, i + 100).every((v) => v !== null)) continue;
    const chunk = pts.slice(i, i + 100);
    const locs = chunk.map(([la, lo]) => `${la},${lo}`).join('|');
    for (let intento = 0; intento < 8; intento++) {
      try {
        const r = await fetch(`https://api.opentopodata.org/v1/srtm30m?locations=${locs}`, { headers: { 'User-Agent': UA } });
        if (r.ok) {
          const j = await r.json();
          j.results.forEach((res, k) => (data.h[i + k] = res.elevation));
          break;
        }
        console.log(`  SRTM ${r.status}, reintento`);
      } catch (e2) {
        console.log('  SRTM error', e2.message);
      }
      await sleep(3000 * (intento + 1));
    }
    fs.writeFileSync(out, JSON.stringify(data));
    process.stdout.write(`\rSRTM ${Math.min(pts.length, i + 100)}/${pts.length}`);
    await sleep(1100);
  }
  console.log(`\nSRTM: ${lats.length} x ${lons.length}`);
}

await Promise.all([overpass('osm.json', Q_MAIN, 100).then(() => overpass('osm-extra.json', Q_EXTRA, 20)), srtm()]);
