// Construye el mapa del juego a partir de los datos reales (OSM + SRTM):
//  1. Vías con su ancho según la categoría y los carriles, partidas en las
//     intersecciones (grafo de nodos y aristas con polilíneas).
//  2. Calzada rasterizada a 0.5 m y su campo de distancias: las manzanas son
//     las zonas sin calzada; sus contornos a distintas distancias dan el borde
//     del sardinel, el centro del andén (por donde caminan los peatones) y la
//     línea de paramento (donde empiezan las casas). Así funciona con calles
//     curvas, diagonales, sin salida y cruces irregulares, sin casos especiales.
//  3. Zonas (parques, canchas, iglesias, cementerio, el Morro de Moravia)
//     asignadas a las manzanas; metro (línea A) y estación Caribe.
//  4. Terreno: rejilla de elevación SRTM suavizada, en metros del juego.
// Entrada: .cache/mapa/osm.json (o la consulta anterior) y .cache/mapa/srtm.json.
// Salida: src/data/mapa.json. Uso: node scripts/mapa/construir.mjs [--png salida.png]

import fs from 'node:fs';
import path from 'node:path';
import { REGION, project } from './region.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const CACHE = path.join(ROOT, '.cache/mapa');
const OUT = path.join(ROOT, 'src/data/mapa.json');

// ------------------------------------------------------------------ entrada
function loadOsm() {
  for (const f of [path.join(CACHE, 'osm.json'), path.join(CACHE, 'osm-anterior.json')]) {
    if (fs.existsSync(f)) {
      console.log('OSM:', path.relative(ROOT, f));
      return JSON.parse(fs.readFileSync(f, 'utf8')).elements;
    }
  }
  throw new Error('Falta .cache/mapa/osm.json (node scripts/mapa/descargar.mjs)');
}

const [RX0, RZ1] = project(REGION.south, REGION.west);
const [RX1, RZ0] = project(REGION.north, REGION.east);
// Límites del mapa en metros (x oriente, z sur).
const BOUNDS = { minX: Math.round(RX0), maxX: Math.round(RX1), minZ: Math.round(RZ0), maxZ: Math.round(RZ1) };
const PAD = 60; // las vías siguen un poco más allá del borde jugable

// Anchos de calzada (m) por categoría: las calles residenciales de Aranjuez
// son angostas; Carabobo y las transversales son más anchas.
const CLASS = {
  trunk: { w: 11, car: true },
  trunk_link: { w: 6.5, car: true },
  primary: { w: 10, car: true },
  primary_link: { w: 6.5, car: true },
  secondary: { w: 9, car: true },
  secondary_link: { w: 6, car: true },
  tertiary: { w: 8, car: true },
  tertiary_link: { w: 6, car: true },
  unclassified: { w: 6.5, car: true },
  residential: { w: 6.5, car: true },
  living_street: { w: 5.5, car: true },
  service: { w: 4.5, car: true },
  pedestrian: { w: 5, car: false },
};

function roadWidth(tags, cls) {
  const lanes = parseInt(tags.lanes, 10);
  if (lanes > 0) return Math.max(CLASS[cls].w * 0.7, Math.min(16, lanes * 3.2 + 0.4));
  if (tags.width) {
    const w = parseFloat(tags.width);
    if (w > 2 && w < 30) return w;
  }
  return CLASS[cls].w;
}

// ------------------------------------------------------------------ vías
function buildRoads(elements) {
  const ways = elements.filter((e) => e.type === 'way' && e.geometry && CLASS[e.tags?.highway]);
  const inBox = (x, z, m) => x > BOUNDS.minX - m && x < BOUNDS.maxX + m && z > BOUNDS.minZ - m && z < BOUNDS.maxZ + m;
  // Nodos por coordenada exacta (OSM comparte nodos en las intersecciones).
  const key = (p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
  const use = new Map();
  const lines = [];
  for (const w of ways) {
    const cls = w.tags.highway;
    if (cls === 'service' && !w.tags.name) continue; // parqueaderos y accesos privados
    if (w.tags.tunnel === 'yes') continue;
    const pts = w.geometry.map((p) => ({ k: key(p), xz: project(p.lat, p.lon) }));
    // Recortar a la región con margen (partes contiguas dentro).
    let run = [];
    const flush = () => {
      if (run.length >= 2) lines.push({ tags: w.tags, cls, id: w.id, pts: run });
      run = [];
    };
    for (const p of pts) {
      if (inBox(p.xz[0], p.xz[1], PAD)) run.push(p);
      else {
        if (run.length) run.push(p); // incluir el punto que sale para no cortar en seco
        flush();
      }
    }
    flush();
  }
  for (const l of lines) for (const [i, p] of l.pts.entries()) use.set(p.k, (use.get(p.k) ?? 0) + (i === 0 || i === l.pts.length - 1 ? 2 : 1));
  const nodes = [];
  const nodeOf = new Map();
  const getNode = (p) => {
    let id = nodeOf.get(p.k);
    if (id === undefined) {
      id = nodes.length;
      nodes.push({ id, x: p.xz[0], z: p.xz[1] });
      nodeOf.set(p.k, id);
    }
    return id;
  };
  const edges = [];
  for (const l of lines) {
    const w = roadWidth(l.tags, l.cls);
    let start = 0;
    for (let i = 1; i < l.pts.length; i++) {
      const p = l.pts[i];
      if (i === l.pts.length - 1 || (use.get(p.k) ?? 0) >= 2) {
        const seg = l.pts.slice(start, i + 1);
        const a = getNode(seg[0]);
        const b = getNode(seg[seg.length - 1]);
        if (a !== b || seg.length > 2) {
          edges.push({
            a,
            b,
            pts: seg.map((q) => q.xz),
            name: l.tags.name ?? '',
            cls: l.cls,
            width: w,
            oneway: l.tags.oneway === 'yes' || l.tags.oneway === '1' || l.cls.endsWith('_link') ? 1 : l.tags.oneway === '-1' ? -1 : 0,
            lanes: parseInt(l.tags.lanes, 10) || (l.cls === 'residential' || l.cls === 'service' || l.cls === 'living_street' ? 2 : 2),
            car: CLASS[l.cls].car,
            bridge: l.tags.bridge ? 1 : 0,
            layer: parseInt(l.tags.layer, 10) || 0,
            osm: l.id,
          });
        }
        start = i;
      }
    }
  }
  return { nodes, edges };
}

/** Une nodos a menos de `tol` m (esquinas con varios nodos OSM muy juntos). */
function mergeCloseNodes(net, tol = 3) {
  const { nodes, edges } = net;
  const parent = nodes.map((n) => n.id);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const deg = new Map();
  for (const e of edges) {
    deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
    deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
  }
  for (const e of edges) {
    const len = polyLength(e.pts);
    if (len < tol && e.a !== e.b) {
      const ra = find(e.a);
      const rb = find(e.b);
      if (ra !== rb) parent[rb] = ra;
    }
  }
  const out = [];
  const remap = new Map();
  for (const n of nodes) {
    const r = find(n.id);
    if (!remap.has(r)) {
      // Centro del grupo.
      const members = nodes.filter((m) => find(m.id) === r);
      const x = members.reduce((s, m) => s + m.x, 0) / members.length;
      const z = members.reduce((s, m) => s + m.z, 0) / members.length;
      remap.set(r, out.length);
      out.push({ id: out.length, x, z });
    }
  }
  const newEdges = [];
  for (const e of edges) {
    const a = remap.get(find(e.a));
    const b = remap.get(find(e.b));
    if (a === b && polyLength(e.pts) < tol * 2) continue;
    const pts = e.pts.map((p) => [...p]);
    pts[0] = [out[a].x, out[a].z];
    pts[pts.length - 1] = [out[b].x, out[b].z];
    newEdges.push({ ...e, a, b, pts });
  }
  return { nodes: out, edges: newEdges };
}

function polyLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

/** Douglas-Peucker. */
function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const [ax, az] = pts[i0];
    const [bx, bz] = pts[i1];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1e-9;
    let best = -1;
    let bd = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const t = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - az) * dz) / l2));
      const d = Math.hypot(pts[i][0] - ax - dx * t, pts[i][1] - az - dz * t);
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i0, best], [best, i1]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// ------------------------------------------------------------------ raster
const RES = 0.5;
function makeRaster() {
  const x0 = BOUNDS.minX - PAD;
  const z0 = BOUNDS.minZ - PAD;
  const nx = Math.ceil((BOUNDS.maxX - BOUNDS.minX + PAD * 2) / RES);
  const nz = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ + PAD * 2) / RES);
  return { x0, z0, nx, nz, road: new Uint8Array(nx * nz) };
}

function rasterRoads(R, edges) {
  for (const e of edges) {
    const hw = e.width / 2;
    for (let i = 1; i < e.pts.length; i++) capsule(R, e.pts[i - 1], e.pts[i], hw);
  }
}

function capsule(R, a, b, r) {
  const minX = Math.min(a[0], b[0]) - r;
  const maxX = Math.max(a[0], b[0]) + r;
  const minZ = Math.min(a[1], b[1]) - r;
  const maxZ = Math.max(a[1], b[1]) + r;
  const i0 = Math.max(0, Math.floor((minX - R.x0) / RES));
  const i1 = Math.min(R.nx - 1, Math.ceil((maxX - R.x0) / RES));
  const j0 = Math.max(0, Math.floor((minZ - R.z0) / RES));
  const j1 = Math.min(R.nz - 1, Math.ceil((maxZ - R.z0) / RES));
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1e-9;
  for (let j = j0; j <= j1; j++) {
    const z = R.z0 + (j + 0.5) * RES;
    for (let i = i0; i <= i1; i++) {
      const x = R.x0 + (i + 0.5) * RES;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      const ex = x - a[0] - dx * t;
      const ez = z - a[1] - dz * t;
      if (ex * ex + ez * ez <= r * r) R.road[j * R.nx + i] = 1;
    }
  }
}

/** Transformada de distancia euclidiana exacta (Felzenszwalb) en metros a la calzada. */
function distanceField(R) {
  const { nx, nz } = R;
  const INF = 1e20;
  const f = new Float64Array(nx * nz);
  for (let k = 0; k < f.length; k++) f[k] = R.road[k] ? 0 : INF;
  const n = Math.max(nx, nz);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const zz = new Float64Array(n + 1);
  const fr = new Float64Array(n);
  const edt1 = (len) => {
    let k = 0;
    v[0] = 0;
    zz[0] = -INF;
    zz[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (fr[q] + q * q - (fr[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= zz[k]) {
        k--;
        s = (fr[q] + q * q - (fr[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      zz[k] = s;
      zz[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (zz[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + fr[v[k]];
    }
  };
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) fr[j] = f[j * nx + i];
    edt1(nz);
    for (let j = 0; j < nz; j++) f[j * nx + i] = d[j];
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) fr[i] = f[j * nx + i];
    edt1(nx);
    for (let i = 0; i < nx; i++) f[j * nx + i] = d[i];
  }
  const out = new Float32Array(nx * nz);
  for (let k = 0; k < f.length; k++) out[k] = Math.sqrt(f[k]) * RES;
  return out;
}

/** Componentes conexas de celdas sin calzada (4-vecinos). */
function labelBlocks(R) {
  const { nx, nz } = R;
  const lab = new Int32Array(nx * nz).fill(-1);
  const sizes = [];
  const stack = [];
  for (let k = 0; k < lab.length; k++) {
    if (R.road[k] || lab[k] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    stack.push(k);
    lab[k] = id;
    while (stack.length) {
      const c = stack.pop();
      size++;
      const i = c % nx;
      const j = (c - i) / nx;
      const nb = [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, j > 0 ? c - nx : -1, j < nz - 1 ? c + nx : -1];
      for (const q of nb) {
        if (q >= 0 && !R.road[q] && lab[q] < 0) {
          lab[q] = id;
          stack.push(q);
        }
      }
    }
    sizes.push(size);
  }
  return { lab, sizes };
}

/**
 * Isolíneas cerradas del campo D a un nivel (marching squares). Devuelve
 * lazos [[x,z],...] en coordenadas del mundo.
 */
function contours(R, D, level) {
  const { nx, nz } = R;
  // Valor en los centros de celda; la rejilla de marching squares usa esos centros.
  const val = (i, j) => (i < 0 || j < 0 || i >= nx || j >= nz ? -1 : D[j * nx + i]);
  const segs = new Map(); // clave de punto -> [siguiente clave, punto]
  const P = (i, j, di, dj) => {
    // Punto en la arista entre (i,j) y (i+di,j+dj).
    const a = val(i, j);
    const b = val(i + di, j + dj);
    const t = Math.max(0, Math.min(1, (level - a) / (b - a || 1e-9)));
    const x = R.x0 + (i + 0.5 + di * t) * RES;
    const z = R.z0 + (j + 0.5 + dj * t) * RES;
    return { key: `${i + (di ? 0.5 : 0)},${j + (dj ? 0.5 : 0)}`, x, z };
  };
  const addSeg = (p, q) => segs.set(p.key, { next: q.key, x: p.x, z: p.z });
  for (let j = -1; j < nz; j++) {
    for (let i = -1; i < nx; i++) {
      const a = val(i, j) > level ? 1 : 0; // arriba-izq
      const b = val(i + 1, j) > level ? 1 : 0; // arriba-der
      const c = val(i + 1, j + 1) > level ? 1 : 0; // abajo-der
      const d = val(i, j + 1) > level ? 1 : 0; // abajo-izq
      const code = (a << 3) | (b << 2) | (c << 1) | d;
      if (code === 0 || code === 15) continue;
      const top = () => P(i, j, 1, 0);
      const right = () => P(i + 1, j, 0, 1);
      const bottom = () => P(i, j + 1, 1, 0);
      const left = () => P(i, j, 0, 1);
      // Orientación: el interior (> nivel) queda a la izquierda al recorrer.
      switch (code) {
        case 1: addSeg(bottom(), left()); break;
        case 2: addSeg(right(), bottom()); break;
        case 3: addSeg(right(), left()); break;
        case 4: addSeg(top(), right()); break;
        case 5: addSeg(top(), left()); addSeg(bottom(), right()); break;
        case 6: addSeg(top(), bottom()); break;
        case 7: addSeg(top(), left()); break;
        case 8: addSeg(left(), top()); break;
        case 9: addSeg(bottom(), top()); break;
        case 10: addSeg(left(), bottom()); addSeg(right(), top()); break;
        case 11: addSeg(right(), top()); break;
        case 12: addSeg(left(), right()); break;
        case 13: addSeg(bottom(), right()); break;
        case 14: addSeg(left(), bottom()); break;
        default: break;
      }
    }
  }
  const loops = [];
  const seen = new Set();
  for (const [k0] of segs) {
    if (seen.has(k0)) continue;
    const loop = [];
    let k = k0;
    let guard = 0;
    while (k && !seen.has(k) && guard++ < 1e6) {
      seen.add(k);
      const s = segs.get(k);
      if (!s) break;
      loop.push([s.x, s.z]);
      k = s.next;
    }
    if (k === k0 && loop.length >= 4) loops.push(loop);
  }
  return loops;
}

function area(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
}

function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function centroid(poly) {
  let cx = 0;
  let cz = 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    const f = x1 * z2 - x2 * z1;
    cx += (x1 + x2) * f;
    cz += (z1 + z2) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) return [poly[0][0], poly[0][1]];
  return [cx / (3 * a), cz / (3 * a)];
}

// ------------------------------------------------------------------ zonas
const AREA_KIND = (t) => {
  if (t.leisure === 'pitch' || t.leisure === 'sports_centre' || t.leisure === 'stadium') return 'cancha';
  if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'playground' || t.landuse === 'recreation_ground' || t.landuse === 'grass' || t.landuse === 'village_green') return 'parque';
  if (t.amenity === 'place_of_worship') return 'iglesia';
  if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') return 'cementerio';
  if (t.amenity === 'hospital' || t.amenity === 'clinic' || t.healthcare) return 'salud';
  if (t.amenity === 'school' || t.amenity === 'university' || t.amenity === 'college' || t.amenity === 'kindergarten') return 'colegio';
  if (t.natural === 'wood' || t.natural === 'scrub' || t.natural === 'grassland' || t.landuse === 'forest' || t.landuse === 'meadow') return 'verde';
  if (t.tourism === 'museum' || (t.building && /museo/i.test(t.name ?? ''))) return 'museo';
  return null;
};

function buildAreas(elements) {
  const out = [];
  for (const e of elements) {
    if (e.type !== 'way' || !e.geometry || e.geometry.length < 4) continue;
    const t = e.tags ?? {};
    const kind = AREA_KIND(t);
    if (!kind) continue;
    const poly = e.geometry.map((p) => project(p.lat, p.lon));
    const [cx, cz] = centroid(poly);
    if (cx < BOUNDS.minX - 20 || cx > BOUNDS.maxX + 20 || cz < BOUNDS.minZ - 20 || cz > BOUNDS.maxZ + 20) continue;
    out.push({ kind, name: t.name ?? '', sport: t.sport ?? '', poly: simplify(poly, 0.4).map(round2), area: Math.abs(area(poly)), c: [round1(cx), round1(cz)] });
  }
  return out;
}

function buildWater(elements) {
  const out = [];
  for (const e of elements) {
    if (e.type !== 'way' || !e.geometry || !e.tags?.waterway) continue;
    const pts = e.geometry.map((p) => project(p.lat, p.lon));
    if (!pts.some(([x, z]) => x > BOUNDS.minX && x < BOUNDS.maxX && z > BOUNDS.minZ && z < BOUNDS.maxZ)) continue;
    out.push({ kind: e.tags.waterway, name: e.tags.name ?? '', tunnel: e.tags.tunnel ? 1 : 0, pts: simplify(pts, 0.5).map(round2) });
  }
  return out;
}

function buildRail(elements) {
  const out = [];
  for (const e of elements) {
    if (e.type !== 'way' || !e.geometry || !['subway', 'rail', 'light_rail'].includes(e.tags?.railway)) continue;
    const pts = e.geometry.map((p) => project(p.lat, p.lon));
    if (!pts.some(([x, z]) => x > BOUNDS.minX - 300 && x < BOUNDS.maxX + 300 && z > BOUNDS.minZ - 300 && z < BOUNDS.maxZ + 300)) continue;
    out.push({ kind: e.tags.railway, bridge: e.tags.bridge ? 1 : 0, layer: parseInt(e.tags.layer, 10) || 0, pts: pts.map(round2) });
  }
  return out;
}

// ------------------------------------------------------------------ terreno
function buildTerrain() {
  const f = path.join(CACHE, 'srtm.json');
  if (!fs.existsSync(f)) throw new Error('Falta .cache/mapa/srtm.json');
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (s.h.some((v) => v === null)) throw new Error('SRTM incompleto: vuelva a correr descargar.mjs');
  const step = 10;
  const x0 = BOUNDS.minX - 400;
  const z0 = BOUNDS.minZ - 400;
  const nx = Math.ceil((BOUNDS.maxX - BOUNDS.minX + 800) / step) + 1;
  const nz = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ + 800) / step) + 1;
  // Muestreo bilineal de la rejilla lat/lon (proyectada).
  const nLat = s.lats.length;
  const nLon = s.lons.length;
  const sample = (x, z) => {
    // Invertir la proyección lineal.
    const [la0x, la0z] = project(s.lats[0], s.lons[0]);
    const [la1x, la1z] = project(s.lats[nLat - 1], s.lons[nLon - 1]);
    const u = ((x - la0x) / (la1x - la0x)) * (nLon - 1);
    const v = ((z - la0z) / (la1z - la0z)) * (nLat - 1);
    const i = Math.max(0, Math.min(nLon - 2, Math.floor(u)));
    const j = Math.max(0, Math.min(nLat - 2, Math.floor(v)));
    const fu = Math.max(0, Math.min(1, u - i));
    const fv = Math.max(0, Math.min(1, v - j));
    const h = (jj, ii) => s.h[jj * nLon + ii];
    return (h(j, i) * (1 - fu) + h(j, i + 1) * fu) * (1 - fv) + (h(j + 1, i) * (1 - fu) + h(j + 1, i + 1) * fu) * fv;
  };
  let hs = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) hs[j * nx + i] = sample(x0 + i * step, z0 + j * step);
  // Suavizado gaussiano (el SRTM ve techos y árboles: ruido de ±3 m).
  const sigma = 2.4; // en celdas de 10 m
  const rad = Math.ceil(sigma * 3);
  const ker = [];
  for (let k = -rad; k <= rad; k++) ker.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  const ks = ker.reduce((a, b) => a + b, 0);
  const blur = (src, horiz) => {
    const dst = new Float32Array(src.length);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        let acc = 0;
        for (let k = -rad; k <= rad; k++) {
          const ii = horiz ? Math.max(0, Math.min(nx - 1, i + k)) : i;
          const jj = horiz ? j : Math.max(0, Math.min(nz - 1, j + k));
          acc += src[jj * nx + ii] * ker[k + rad];
        }
        dst[j * nx + i] = acc / ks;
      }
    }
    return dst;
  };
  hs = blur(blur(hs, true), false);
  const h = Array.from(hs, (v) => Math.round(v * 10)); // decímetros sobre el mar
  return { x0, z0, step, nx, nz, dm: h };
}

// ------------------------------------------------------------------ principal
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];

const SIDEWALK = 2.2; // del sardinel a la línea de paramento
const RING = 1.1; // centro del andén

function main() {
  const t0 = Date.now();
  const elements = loadOsm();
  let net = buildRoads(elements);
  net = mergeCloseNodes(net, 3.5);
  for (const e of net.edges) e.pts = simplify(e.pts, 0.35).map(round2);
  // Solo vías de carros para las manzanas y el tráfico; las peatonales van aparte.
  console.log(`vías: ${net.edges.length} tramos, ${net.nodes.length} nodos`);

  const R = makeRaster();
  rasterRoads(R, net.edges);
  const D = distanceField(R);
  const { lab, sizes } = labelBlocks(R);
  const minCells = 90 / (RES * RES); // manzanas de menos de 90 m²: separadores e isletas
  // Contornos por nivel, asignados a la manzana (componente) que encierran.
  const levels = { curb: 0.02, ring: RING, lot: SIDEWALK };
  const blocks = new Map();
  for (const [name, level] of Object.entries(levels)) {
    for (const loop of contours(R, D, level)) {
      const a = area(loop);
      if (a >= 0) continue; // agujeros (orientación inversa; con z hacia el sur el contorno exterior sale negativo)
      // Componente: la de un punto interior cercano al primer vértice.
      let comp = -1;
      for (const [x, z] of loop) {
        const i = Math.floor((x - R.x0) / RES);
        const j = Math.floor((z - R.z0) / RES);
        for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = (j + dj) * R.nx + (i + di);
          if (k >= 0 && k < lab.length && lab[k] >= 0 && D[k] > level) {
            comp = lab[k];
            break;
          }
        }
        if (comp >= 0) break;
      }
      if (comp < 0 || sizes[comp] < minCells) continue;
      if (!blocks.has(comp)) blocks.set(comp, { curb: [], ring: [], lot: [] });
      const tol = name === 'curb' ? 0.2 : 0.3;
      blocks.get(comp)[name].push(simplify(loop, tol).map(round2));
    }
  }
  // Manzanas: cada componente con su contorno de sardinel más grande.
  const outBlocks = [];
  for (const [comp, b] of blocks) {
    if (!b.curb.length) continue;
    b.curb.sort((p, q) => Math.abs(area(q)) - Math.abs(area(p)));
    const curb = b.curb[0];
    const [cx, cz] = centroid(curb);
    // ¿Toca el borde del raster? Entonces es el "resto del mundo": no es manzana.
    const touchesEdge = curb.some(([x, z]) => x < R.x0 + 1 || z < R.z0 + 1 || x > R.x0 + R.nx * RES - 1 || z > R.z0 + R.nz * RES - 1);
    if (touchesEdge) continue;
    outBlocks.push({ id: outBlocks.length, comp, c: [round1(cx), round1(cz)], area: Math.round(Math.abs(area(curb))), curb, ring: b.ring.sort((p, q) => Math.abs(area(q)) - Math.abs(area(p))), lot: b.lot.sort((p, q) => Math.abs(area(q)) - Math.abs(area(p))) });
  }
  // Zonas y su manzana.
  const areas = buildAreas(elements);
  for (const ar of areas) {
    const blk = outBlocks.find((b) => pointInPoly(ar.c[0], ar.c[1], b.curb));
    ar.block = blk ? blk.id : -1;
  }
  const water = buildWater(elements);
  const rail = buildRail(elements);
  const terrain = buildTerrain();
  const data = {
    version: 2,
    note: 'Datos © colaboradores de OpenStreetMap (ODbL) y SRTM (NASA/USGS). Generado por scripts/mapa/construir.mjs.',
    bounds: BOUNDS,
    region: REGION,
    sidewalk: SIDEWALK,
    ring: RING,
    nodes: net.nodes.map((n) => ({ x: round1(n.x), z: round1(n.z) })),
    edges: net.edges.map((e) => ({ a: e.a, b: e.b, name: e.name, cls: e.cls, w: round1(e.width), oneway: e.oneway, lanes: e.lanes, car: e.car ? 1 : 0, bridge: e.bridge, pts: e.pts })),
    blocks: outBlocks.map(({ comp, ...b }) => b),
    areas,
    water,
    rail,
    terrain,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data));
  console.log(`manzanas: ${outBlocks.length}, zonas: ${areas.length}, agua: ${water.length}, metro: ${rail.length}`);
  console.log(`listo en ${((Date.now() - t0) / 1000).toFixed(1)} s → ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
  const png = process.argv.indexOf('--png');
  if (png > 0) return drawPng(data, process.argv[png + 1]);
}

async function drawPng(data, file) {
  const sharp = (await import('sharp')).default;
  const b = data.bounds;
  const S = 1; // px por metro
  const W = Math.round((b.maxX - b.minX + 120) * S);
  const H = Math.round((b.maxZ - b.minZ + 120) * S);
  const X = (x) => ((x - b.minX + 60) * S).toFixed(1);
  const Z = (z) => ((z - b.minZ + 60) * S).toFixed(1);
  const path = (pts, close) => 'M' + pts.map((p) => `${X(p[0])},${Z(p[1])}`).join('L') + (close ? 'Z' : '');
  const color = { parque: '#8fcf7a', cancha: '#5fae5a', iglesia: '#b38bd9', cementerio: '#9aa58a', salud: '#f2a0a0', colegio: '#e8d28a', verde: '#6fae5a', museo: '#d9a066' };
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#3a3d40"/>`;
  for (const bl of data.blocks) {
    svg += `<path d="${path(bl.curb, true)}" fill="#9a968c"/>`;
    for (const l of bl.lot) svg += `<path d="${path(l, true)}" fill="#c9b79c"/>`;
    for (const r of bl.ring) svg += `<path d="${path(r, true)}" fill="none" stroke="#fff" stroke-width="0.4" stroke-dasharray="2,2"/>`;
  }
  for (const a of data.areas) svg += `<path d="${path(a.poly, true)}" fill="${color[a.kind] ?? '#888'}" fill-opacity="0.75"/>`;
  for (const w of data.water) svg += `<path d="${path(w.pts)}" fill="none" stroke="#4aa3df" stroke-width="3"/>`;
  for (const r of data.rail) svg += `<path d="${path(r.pts)}" fill="none" stroke="${r.bridge ? '#1f5fbf' : '#2f9a5f'}" stroke-width="4" stroke-dasharray="${r.bridge ? '0' : '8,4'}"/>`;
  svg += `<rect x="${X(b.minX)}" y="${Z(b.minZ)}" width="${(b.maxX - b.minX) * S}" height="${(b.maxZ - b.minZ) * S}" fill="none" stroke="#ff0" stroke-width="2"/>`;
  for (const a of data.areas) if (a.name) svg += `<text x="${X(a.c[0])}" y="${Z(a.c[1])}" font-size="11" fill="#111" font-family="sans-serif">${a.name.replace(/&/g, '&amp;')}</text>`;
  svg += '</svg>';
  await sharp(Buffer.from(svg)).png().toFile(file);
  console.log('png', file);
}

main();
