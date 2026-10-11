// Construye el mapa del juego a partir de los datos reales (OSM + SRTM):
//  1. Vías con su ancho según la categoría y los carriles, partidas en las
//     intersecciones (grafo de nodos y aristas con polilíneas).
//  2. Calzada rasterizada a 0.5 m y su campo de distancias: las manzanas son
//     las zonas sin calzada; sus contornos a distintas distancias dan el borde
//     del sardinel, el centro del andén (por donde caminan los peatones) y la
//     línea de paramento (donde empiezan las casas). Así funciona con calles
//     curvas, diagonales, sin salida y cruces irregulares, sin casos especiales.
//  3. Zonas (parques, canchas, iglesias, cementerio, el Morro de Moravia,
//     parqueaderos) asignadas a las manzanas; metro (línea A) y estación Caribe.
//  4. Edificios reales: huellas de OpenStreetMap ajustadas a rectángulos
//     orientados, recortadas contra el andén y con el frente hacia la calle;
//     cobertura de huellas por manzana (donde falta, cityLayout completa con
//     casas procedurales).
//  5. Senderos (peatonales, escalas, caminos, ciclorrutas), semáforos,
//     paraderos de bus y lugares con nombre.
//  6. Terreno: rejilla de elevación SRTM suavizada, en metros del juego.
// Entrada: .cache/mapa/osm.json (o la consulta anterior), .cache/mapa/osm-extra.json
// (opcional) y .cache/mapa/srtm.json; los descarga scripts/mapa/descargar.mjs.
// Salida: src/data/mapa.json. Reproducible: mismo caché → mismo archivo.
// Uso: node scripts/mapa/descargar.mjs && node scripts/mapa/construir.mjs [--png salida.png]

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

/** Consulta complementaria (nodos de las vías, lugares, multipolígonos); opcional. */
function loadExtra() {
  const f = path.join(CACHE, 'osm-extra.json');
  if (!fs.existsSync(f)) {
    console.log('(sin .cache/mapa/osm-extra.json: sin semáforos ni paraderos reales)');
    return [];
  }
  console.log('OSM:', path.relative(ROOT, f));
  return JSON.parse(fs.readFileSync(f, 'utf8')).elements;
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

// Nombres tradicionales de las carreras de Medellín (nomenclatura de la
// ciudad: Palacé, Bolívar, Carabobo, Venezuela) donde OpenStreetMap no trae
// alt_name en ese tramo.
const TRADITIONAL = { 'Carrera 49': 'Venezuela', 'Carrera 50': 'Palacé', 'Carrera 51': 'Bolívar', 'Carrera 52': 'Carabobo' };

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
            alt: l.tags.alt_name ?? TRADITIONAL[l.tags.name] ?? '',
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
  // Parqueaderos a cielo abierto: ahí no van casas.
  if (t.amenity === 'parking' && !t.building && !['multi-storey', 'underground', 'rooftop'].includes(t.parking)) return 'parqueadero';
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

// ------------------------------------------------------------------ edificios reales
// Huellas de edificios de OpenStreetMap. El juego dibuja cada edificio como
// rectángulos orientados (fachada al frente, costados, fondo y techo), así que
// cada huella se ajusta a su rectángulo de área mínima o, si es en L o en U, a
// 2-4 rectángulos que la cubren. Luego se recorta contra el andén del juego
// (nunca sobre la calzada ni el andén) y se gira para que su frente mire a la
// calle más cercana; si el frente real quedó a menos de 1.8 m del paramento
// del juego se lleva hasta él (así las fachadas de la cuadra quedan en línea).
const BUILDING_SKIP = new Set(['roof', 'ruins', 'no', 'carport', 'canopy', 'collapsed', 'demolished', 'construction_site']);
const LOT_D = 2.28; // distancia mínima de un edificio a la calzada (el andén mide 2.2 m)

function buildingKind(t) {
  const b = t.building;
  const a = t.amenity;
  if (['school', 'kindergarten', 'university', 'college'].includes(b) || ['school', 'kindergarten', 'college', 'university', 'childcare'].includes(a)) return 'colegio';
  if (['church', 'chapel', 'cathedral', 'temple'].includes(b) || a === 'place_of_worship') return 'iglesia';
  if (b === 'hospital' || ['hospital', 'clinic'].includes(a) || t.healthcare) return 'salud';
  if (b === 'transportation' || a === 'bus_station') return 'terminal';
  if (['civic', 'public', 'government'].includes(b) || ['community_centre', 'library', 'theatre', 'police', 'fire_station', 'townhall'].includes(a)) return 'civico';
  if (['commercial', 'retail', 'supermarket', 'kiosk'].includes(b) || t.shop || a === 'marketplace') return 'comercio';
  if (['industrial', 'warehouse', 'garages', 'garage', 'shed', 'service'].includes(b)) return 'bodega';
  if (b === 'construction') return 'obra';
  if (b === 'apartments' || (b === 'residential' && /edificio|torre|urbanizaci/i.test(t.name ?? '')) || /^(edificio|torre)\b/i.test(t.name ?? '')) return 'apto';
  return '';
}

function buildingLevels(t) {
  const nums = String(t['building:levels'] ?? '').match(/\d+(\.\d+)?/g);
  if (nums) return Math.max(1, Math.min(30, Math.round(Math.max(...nums.map(Number)))));
  const h = parseFloat(t.height);
  if (h > 2 && h < 120) return Math.max(1, Math.round(h / 3));
  return 0;
}

/** Huellas (polígonos proyectados, sin repetir el cierre) con sus etiquetas. */
function footprints(elements) {
  const out = [];
  const add = (geom, t, id) => {
    const a = geom[0];
    const b = geom[geom.length - 1];
    if (a.lat !== b.lat || a.lon !== b.lon) return; // anillo abierto (multipolígono partido)
    const poly = geom.slice(0, -1).map((p) => project(p.lat, p.lon));
    if (poly.length < 3) return;
    const [cx, cz] = centroid(poly);
    if (cx < BOUNDS.minX || cx > BOUNDS.maxX || cz < BOUNDS.minZ || cz > BOUNDS.maxZ) return;
    const A = Math.abs(area(poly));
    if (A < 12) return;
    out.push({ poly, tags: t, id, area: A, c: [cx, cz] });
  };
  for (const e of elements) {
    const t = e.tags;
    if (!t?.building || BUILDING_SKIP.has(t.building)) continue;
    if (e.type === 'way' && e.geometry?.length >= 4) add(e.geometry, t, e.id);
    else if (e.type === 'relation') for (const mb of e.members ?? []) if (mb.role === 'outer' && mb.geometry?.length >= 4) add(mb.geometry, t, e.id);
  }
  return out;
}

/** Rectángulo orientado de área mínima (en el eje de alguna arista): u = a lo largo, v = perpendicular. */
function minRect(poly) {
  let best = null;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % n];
    const l = Math.hypot(bx - ax, bz - az);
    if (l < 0.3) continue;
    const ux = (bx - ax) / l;
    const uz = (bz - az) / l;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const [x, z] of poly) {
      const u = x * ux + z * uz;
      const v = -x * uz + z * ux;
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    const a = (u1 - u0) * (v1 - v0);
    if (!best || a < best.area) best = { area: a, ux, uz, u0, u1, v0, v1 };
  }
  return best;
}

/**
 * Huella en L, en U o irregular: rectángulos (en el marco de su rectángulo
 * mínimo) que la cubren, el más grande primero (celdas de 0.5 m).
 */
function decompose(poly, R0, polyA) {
  const S = 0.5;
  const nu = Math.max(1, Math.ceil((R0.u1 - R0.u0) / S));
  const nv = Math.max(1, Math.ceil((R0.v1 - R0.v0) / S));
  const grid = new Uint8Array(nu * nv);
  let total = 0;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const u = R0.u0 + (i + 0.5) * S;
      const v = R0.v0 + (j + 0.5) * S;
      if (pointInPoly(u * R0.ux - v * R0.uz, u * R0.uz + v * R0.ux, poly)) {
        grid[j * nu + i] = 1;
        total++;
      }
    }
  }
  const rects = [];
  let covered = 0;
  const h = new Int32Array(nu);
  for (let k = 0; k < 4 && covered < total * 0.9; k++) {
    // Rectángulo de unos más grande (histograma por filas).
    h.fill(0);
    let best = null;
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) h[i] = grid[j * nu + i] ? h[i] + 1 : 0;
      const st = [];
      for (let i = 0; i <= nu; i++) {
        const hi = i < nu ? h[i] : 0;
        let start = i;
        while (st.length && st[st.length - 1][1] >= hi) {
          const [s0, hh] = st.pop();
          const a = hh * (i - s0);
          if (hh > 0 && (!best || a > best.a)) best = { a, i0: s0, i1: i, j0: j - hh + 1, j1: j + 1 };
          start = s0;
        }
        st.push([start, hi]);
      }
    }
    if (!best) break;
    const w = (best.i1 - best.i0) * S;
    const d = (best.j1 - best.j0) * S;
    if (best.a * S * S < Math.max(10, polyA * 0.1) || Math.min(w, d) < 2.5) break;
    for (let j = best.j0; j < best.j1; j++) for (let i = best.i0; i < best.i1; i++) grid[j * nu + i] = 0;
    covered += best.a;
    rects.push({ ux: R0.ux, uz: R0.uz, u0: R0.u0 + best.i0 * S, u1: R0.u0 + best.i1 * S, v0: R0.v0 + best.j0 * S, v1: R0.v0 + best.j1 * S });
  }
  return rects;
}

/**
 * Recorta el rectángulo (u0..u1, v0..v1 en su marco) hasta que todo quede a
 * más de LOT_D de la calzada, lo orienta hacia la calle y lo lleva al
 * paramento. Devuelve [x, z, nx, nz, hu, hv, interior] o null.
 */
function fitRect(Dat, r) {
  let { u0, u1, v0, v1 } = r;
  const { ux, uz } = r;
  const W = (u, v) => [u * ux - v * uz, u * uz + v * ux];
  const dAt = (u, v) => Dat(...W(u, v));
  // Lados: [eje, signo] → muestras sobre el lado.
  const sides = [
    ['u', -1],
    ['u', 1],
    ['v', -1],
    ['v', 1],
  ];
  const samples = (side, out = 0) => {
    const [ax, sg] = side;
    const pts = [];
    if (ax === 'u') {
      const u = (sg > 0 ? u1 : u0) + sg * out;
      const n = Math.max(1, Math.ceil((v1 - v0 - 0.2) / 0.5));
      for (let k = 0; k <= n; k++) pts.push([u, v0 + 0.1 + ((v1 - v0 - 0.2) * k) / n]);
    } else {
      const v = (sg > 0 ? v1 : v0) + sg * out;
      const n = Math.max(1, Math.ceil((u1 - u0 - 0.2) / 0.5));
      for (let k = 0; k <= n; k++) pts.push([u0 + 0.1 + ((u1 - u0 - 0.2) * k) / n, v]);
    }
    return pts;
  };
  const move = (side, d) => {
    const [ax, sg] = side;
    if (ax === 'u') {
      if (sg > 0) u1 += d;
      else u0 -= d;
    } else if (sg > 0) v1 += d;
    else v0 -= d;
  };
  for (let it = 0; it < 120; it++) {
    if (u1 - u0 < 2.4 || v1 - v0 < 2.4) return null;
    let worst = null;
    for (const s of sides) {
      const pts = samples(s);
      const bad = pts.filter(([u, v]) => dAt(u, v) < LOT_D).length / pts.length;
      if (bad > 0 && (!worst || bad > worst.bad)) worst = { s, bad };
    }
    if (!worst) break;
    move(worst.s, -0.25);
  }
  if (u1 - u0 < 2.4 || v1 - v0 < 2.4) return null;
  // Nada de calzada adentro (una vía que atraviesa la huella).
  for (let u = u0 + 0.5; u < u1; u += 1.5) for (let v = v0 + 0.5; v < v1; v += 1.5) if (dAt(u, v) < LOT_D) return null;
  // Frente: el lado más cercano a la calzada.
  let front = null;
  for (const s of sides) {
    const pts = samples(s, 0.3);
    const mean = pts.reduce((acc, [u, v]) => acc + dAt(u, v), 0) / pts.length;
    if (!front || mean < front.mean) front = { s, mean };
  }
  const interior = front.mean > SIDEWALK + 5 ? 1 : 0;
  if (!interior) {
    // Al paramento: hasta 1.8 m hacia la calle si todo el frente sigue fuera del andén.
    const pts = samples(front.s);
    const gap = Math.min(...pts.map(([u, v]) => dAt(u, v))) - LOT_D - 0.02;
    if (gap > 0.05 && gap < 1.8) {
      move(front.s, gap);
      if (samples(front.s).some(([u, v]) => dAt(u, v) < LOT_D)) move(front.s, -gap);
    }
  }
  const [ax, sg] = front.s;
  const [cx, cz] = W((u0 + u1) / 2, (v0 + v1) / 2);
  // Normal hacia afuera del lado de frente, en coordenadas del mundo.
  const nx = ax === 'u' ? ux * sg : -uz * sg;
  const nz = ax === 'u' ? uz * sg : ux * sg;
  const along = ax === 'u' ? v1 - v0 : u1 - u0;
  const depth = ax === 'u' ? u1 - u0 : v1 - v0;
  // Medio frente un poco menor: las casas vecinas no quedan con fachadas coplanares traslapadas.
  return [round2([cx, cz]), [Math.round(nx * 1e4) / 1e4, Math.round(nz * 1e4) / 1e4], Math.round((along / 2 - 0.02) * 100) / 100, Math.round((depth / 2) * 100) / 100, interior];
}

function buildBuildings(elements, R, D, lab, compToBlock) {
  const Dat = (x, z) => {
    const i = Math.floor((x - R.x0) / RES);
    const j = Math.floor((z - R.z0) / RES);
    if (i < 0 || j < 0 || i >= R.nx || j >= R.nz) return 0;
    return D[j * R.nx + i];
  };
  const out = [];
  let parts = 0;
  let dropped = 0;
  for (const fp of footprints(elements)) {
    // Manzana: la de la celda del centroide (o la de algún vértice si cae en la calzada).
    let blk = -1;
    for (const [x, z] of [fp.c, ...fp.poly]) {
      const i = Math.floor((x - R.x0) / RES);
      const j = Math.floor((z - R.z0) / RES);
      const b = compToBlock.get(lab[j * R.nx + i]);
      if (b !== undefined) {
        blk = b;
        break;
      }
    }
    if (blk < 0) {
      dropped++;
      continue;
    }
    const R0 = minRect(fp.poly);
    const rect = fp.area / R0.area;
    const rects = rect < 0.82 && fp.area > 60 ? decompose(fp.poly, R0, fp.area) : [R0];
    const fitted = [];
    for (const r of rects.length ? rects : [R0]) {
      const f = fitRect(Dat, r);
      if (f) fitted.push(f.flat());
    }
    if (!fitted.length) {
      dropped++;
      continue;
    }
    parts += fitted.length;
    const t = fp.tags;
    const rec = { b: blk, r: fitted };
    const k = buildingKind(t);
    if (k) rec.k = k;
    const lv = buildingLevels(t);
    if (lv) rec.lv = lv;
    if (t.name) rec.n = t.name;
    rec.a = Math.round(fp.area);
    out.push(rec);
  }
  console.log(`edificios reales: ${out.length} huellas en ${parts} rectángulos (${dropped} descartadas)`);
  return out;
}

/** Fracción del lote de cada manzana cubierta por huellas reales (en el raster). */
function blockCoverage(outBlocks, buildings) {
  const cov = new Map();
  for (const b of buildings) for (const r of b.r) cov.set(b.b, (cov.get(b.b) ?? 0) + 4 * r[4] * r[5]);
  for (const bl of outBlocks) {
    const lotA = bl.lot.reduce((s, l) => s + Math.abs(area(l)), 0);
    bl.osm = lotA > 0 ? Math.round(Math.min(1, (cov.get(bl.id) ?? 0) / lotA) * 100) / 100 : 0;
  }
}

// ------------------------------------------------------------------ senderos
// Peatonales, escalas, caminos y ciclorrutas de OpenStreetMap que no son
// andén ni cebra: los pasajes entre casas de Moravia, las escalas de las
// lomas, los caminos de los parques. Solo la parte que queda fuera de la
// calzada y del andén (esos ya se dibujan).
const FOOT_W = { footway: 2.2, steps: 2.2, path: 1.6, cycleway: 2.4 };

function buildFoot(elements, Dat) {
  const out = [];
  for (const e of elements) {
    const t = e.tags ?? {};
    if (e.type !== 'way' || !e.geometry || !FOOT_W[t.highway]) continue;
    if (t.area === 'yes') continue;
    if (['sidewalk', 'crossing', 'traffic_island'].includes(t.footway) || t.bridge || t.tunnel || (parseInt(t.layer, 10) || 0) !== 0 || t.access === 'private') continue;
    const pts = [];
    for (const p of e.geometry) {
      const [x, z] = project(p.lat, p.lon);
      // Densificar a 1 m para cortar donde pisa andén o calzada.
      if (pts.length) {
        const [px, pz] = pts[pts.length - 1];
        const n = Math.ceil(Math.hypot(x - px, z - pz));
        for (let k = 1; k < n; k++) pts.push([px + ((x - px) * k) / n, pz + ((z - pz) * k) / n]);
      }
      pts.push([x, z]);
    }
    let run = [];
    const flush = () => {
      if (run.length >= 2 && polyLength(run) >= 4) out.push({ k: t.highway, w: FOOT_W[t.highway], ...(t.name ? { n: t.name } : {}), pts: simplify(run, 0.3).map(round2) });
      run = [];
    };
    for (const [x, z] of pts) {
      const inside = x > BOUNDS.minX && x < BOUNDS.maxX && z > BOUNDS.minZ && z < BOUNDS.maxZ;
      if (inside && Dat(x, z) >= SIDEWALK - 0.1) run.push([x, z]);
      else flush();
    }
    flush();
  }
  console.log(`senderos: ${out.length} tramos (${Math.round(out.reduce((s, f) => s + polyLength(f.pts), 0))} m)`);
  return out;
}

// ------------------------------------------------------------------ nodos de las vías
/** Semáforos y paraderos de bus reales. */
function buildStreetNodes(elements) {
  const signals = [];
  const stops = [];
  const seen = new Set();
  for (const e of elements) {
    if (e.type !== 'node' || seen.has(e.id)) continue;
    seen.add(e.id);
    const t = e.tags ?? {};
    const [x, z] = project(e.lat, e.lon);
    if (x < BOUNDS.minX || x > BOUNDS.maxX || z < BOUNDS.minZ || z > BOUNDS.maxZ) continue;
    if (t.highway === 'traffic_signals') signals.push([round1(x), round1(z)]);
    else if (t.highway === 'bus_stop' || (t.public_transport === 'platform' && (t.bus === 'yes' || t.highway === 'bus_stop'))) stops.push({ x: round1(x), z: round1(z), ...(t.name ? { n: t.name } : {}) });
  }
  console.log(`semáforos: ${signals.length}, paraderos: ${stops.length}`);
  return { signals, stops };
}

// ------------------------------------------------------------------ lugares con nombre
const POI_KEYS = ['amenity', 'shop', 'leisure', 'tourism', 'healthcare', 'office', 'historic', 'public_transport', 'railway', 'man_made', 'craft'];
/** Lugares con nombre de OpenStreetMap (cityLayout escoge cuáles son puntos de interés). */
function buildNamedPlaces(elements) {
  const out = [];
  const seen = new Set();
  for (const e of elements) {
    const t = e.tags ?? {};
    if (!t.name || seen.has(`${e.type}${e.id}`)) continue;
    seen.add(`${e.type}${e.id}`);
    const key = POI_KEYS.find((k) => t[k]);
    if (!key || (e.type === 'way' && t.highway)) continue;
    let xz;
    if (e.type === 'node') xz = project(e.lat, e.lon);
    else if (e.geometry?.length) xz = centroid(e.geometry.map((p) => project(p.lat, p.lon)));
    else if (e.bounds) xz = project((e.bounds.minlat + e.bounds.maxlat) / 2, (e.bounds.minlon + e.bounds.maxlon) / 2);
    if (!xz || xz[0] < BOUNDS.minX || xz[0] > BOUNDS.maxX || xz[1] < BOUNDS.minZ || xz[1] > BOUNDS.maxZ) continue;
    out.push({ n: t.name, k: `${key}=${t[key]}`, x: round1(xz[0]), z: round1(xz[1]), osm: `${e.type[0]}${e.id}` });
  }
  console.log(`lugares con nombre: ${out.length}`);
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
  const extra = loadExtra();
  const all = [...elements, ...extra];
  let net = buildRoads(elements);
  net = mergeCloseNodes(net, 3.5);
  for (const e of net.edges) e.pts = simplify(e.pts, 0.35).map(round2);
  // Solo vías de carros para las manzanas y el tráfico; las peatonales van aparte.
  console.log(`vías: ${net.edges.length} tramos, ${net.nodes.length} nodos`);

  const R = makeRaster();
  rasterRoads(R, net.edges);
  // Marco de cierre junto al borde del raster: las manzanas cortadas por el
  // borde de la región se cierran contra él en vez de perderse (si no, el
  // occidente del mapa, junto a la Carrera 63 y la Terminal, queda vacío).
  {
    const m = 3;
    const X0 = R.x0 + m;
    const Z0 = R.z0 + m;
    const X1 = R.x0 + R.nx * RES - m;
    const Z1 = R.z0 + R.nz * RES - m;
    for (const [a, b] of [
      [[X0, Z0], [X1, Z0]],
      [[X1, Z0], [X1, Z1]],
      [[X1, Z1], [X0, Z1]],
      [[X0, Z1], [X0, Z0]],
    ])
      capsule(R, a, b, 1.5);
  }
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
  // Edificios reales (huellas de OpenStreetMap) y cobertura de cada manzana.
  const compToBlock = new Map(outBlocks.map((b) => [b.comp, b.id]));
  const buildings = buildBuildings(all, R, D, lab, compToBlock);
  blockCoverage(outBlocks, buildings);
  const Dat = (x, z) => {
    const i = Math.floor((x - R.x0) / RES);
    const j = Math.floor((z - R.z0) / RES);
    return i < 0 || j < 0 || i >= R.nx || j >= R.nz ? 0 : D[j * R.nx + i];
  };
  const foot = buildFoot(elements, Dat);
  const { signals, stops } = buildStreetNodes(all);
  const places = buildNamedPlaces(all);
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
    edges: net.edges.map((e) => ({ a: e.a, b: e.b, name: e.name, ...(e.alt ? { alt: e.alt } : {}), cls: e.cls, w: round1(e.width), oneway: e.oneway, lanes: e.lanes, car: e.car ? 1 : 0, bridge: e.bridge, pts: e.pts })),
    blocks: outBlocks.map(({ comp, ...b }) => b),
    areas,
    water,
    rail,
    buildings,
    foot,
    signals,
    stops,
    places,
    terrain,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(data));
  console.log(`manzanas: ${outBlocks.length}, zonas: ${areas.length}, agua: ${water.length}, metro: ${rail.length}`);
  for (const k of ['nodes', 'edges', 'blocks', 'areas', 'buildings', 'foot', 'places', 'terrain']) console.log(`  ${k}: ${(JSON.stringify(data[k]).length / 1024).toFixed(0)} KB`);
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
  // Edificios reales: rectángulos con el frente marcado.
  for (const bd of data.buildings) {
    for (const [x, z, nx, nz, hu, hv, inner] of bd.r) {
      const ux = nz;
      const uz = -nx;
      const c = [
        [x - ux * hu + nx * hv, z - uz * hu + nz * hv],
        [x + ux * hu + nx * hv, z + uz * hu + nz * hv],
        [x + ux * hu - nx * hv, z + uz * hu - nz * hv],
        [x - ux * hu - nx * hv, z - uz * hu - nz * hv],
      ];
      svg += `<path d="${path(c, true)}" fill="${inner ? '#b86' : '#c44'}" stroke="#622" stroke-width="0.2"/><path d="${path(c.slice(0, 2))}" stroke="#ff0" stroke-width="0.6"/>`;
    }
  }
  for (const f of data.foot) svg += `<path d="${path(f.pts)}" fill="none" stroke="${f.k === 'steps' ? '#f0f' : f.k === 'cycleway' ? '#08f' : '#0a0'}" stroke-width="${f.w * S}" stroke-opacity="0.7"/>`;
  for (const [x, z] of data.signals) svg += `<circle cx="${X(x)}" cy="${Z(z)}" r="3" fill="#f00" stroke="#000"/>`;
  for (const st of data.stops) svg += `<rect x="${X(st.x) - 3}" y="${Z(st.z) - 3}" width="6" height="6" fill="#00f"/>`;
  for (const w of data.water) svg += `<path d="${path(w.pts)}" fill="none" stroke="#4aa3df" stroke-width="3"/>`;
  for (const r of data.rail) svg += `<path d="${path(r.pts)}" fill="none" stroke="${r.bridge ? '#1f5fbf' : '#2f9a5f'}" stroke-width="4" stroke-dasharray="${r.bridge ? '0' : '8,4'}"/>`;
  svg += `<rect x="${X(b.minX)}" y="${Z(b.minZ)}" width="${(b.maxX - b.minX) * S}" height="${(b.maxZ - b.minZ) * S}" fill="none" stroke="#ff0" stroke-width="2"/>`;
  for (const a of data.areas) if (a.name) svg += `<text x="${X(a.c[0])}" y="${Z(a.c[1])}" font-size="11" fill="#111" font-family="sans-serif">${a.name.replace(/&/g, '&amp;')}</text>`;
  svg += '</svg>';
  await sharp(Buffer.from(svg)).png().toFile(file);
  console.log('png', file);
}

main();
