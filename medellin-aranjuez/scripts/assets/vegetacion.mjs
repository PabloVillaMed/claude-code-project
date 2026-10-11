// Vegetación de Medellín: árboles, palmas, arbustos, pasto y enredaderas.
// Reproducible: `node scripts/assets/vegetacion.mjs [--only palma_coco,seto]`
// (descargas en .cache/vegetacion/, ignorado por git).
//
// Fuentes:
//  - Sketchfab (CC BY 4.0), GLB originales tomados de la copia pública de
//    Objaverse (allenai/objaverse en Hugging Face). La mayoría son de
//    evolveduk (autor de la app "Tree It"): palmas, guadua, samán, etc.
//  - Poly Haven (CC0): texturas de hojas y pasto y el árbol del guayabo.
//  - Procedurales (hechos aquí con esas texturas): seto, buganvilia, pasto,
//    maleza y enredadera.
//
// Salida: public/models/vegetacion/<nombre>.glb con dos nodos, 'cerca' y
// 'lejos' (nivel de detalle por instancia en props.js), y manifest.json.
// Formato común: metros, Y arriba, base del tronco en (0, 0, 0). Materiales:
// 'corteza' (opaco) y 'follaje' (alpha recortado, doble cara, color de
// vértice = oclusión falsa; el tinte por especie va en instanceColor).
// Presupuestos: árboles 3k-12k triángulos cerca y 15-30 % lejos; arbustos y
// pasto < 2k; texturas webp ≤ 1024 px.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { readParts, boundsOf, transformParts, makeTransform, mergeList, compact, simplifyPart, dropSmallComponents, writeGLB, rngFrom, downloadTo, leafSprites, clumpAtlas, foliageCards, buildTree, trisOf } from './utileria.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, 'public/models/vegetacion');
const CACHE = path.join(ROOT, '.cache/vegetacion');
const OBJAVERSE = 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/';
const PH = 'https://dl.polyhaven.org/file/ph-assets/Models/jpg/1k/';

// ---------------------------------------------------------------- fuentes
const SKETCHFAB = {
  coco: { path: 'glbs/000-004/26e787f2ff2e4c0fb004c3b0210805a3.glb', title: 'Coconut Palm', author: 'evolveduk', url: 'https://sketchfab.com/3d-models/coconut-palm-26e787f2ff2e4c0fb004c3b0210805a3' },
  datil: { path: 'glbs/000-151/11acf710e6c149daa8d6fb8cdc5d087f.glb', title: 'Date Palm', author: 'evolveduk', url: 'https://sketchfab.com/3d-models/date-palm-11acf710e6c149daa8d6fb8cdc5d087f' },
  curly: { path: 'glbs/000-068/00f2b57dd0e844edbeb116034fa471ec.glb', title: 'Curly Palm', author: 'evolveduk', url: 'https://sketchfab.com/3d-models/curly-palm-00f2b57dd0e844edbeb116034fa471ec' },
  bambu: { path: 'glbs/000-118/a02bf0e3ffe44617ad49daf3cd94fe59.glb', title: 'bamboo', author: 'evolveduk', url: 'https://sketchfab.com/3d-models/bamboo-a02bf0e3ffe44617ad49daf3cd94fe59' },
  acacia: { path: 'glbs/000-015/bb14c2bb679b4d0bb1c578a27e2ddabf.glb', title: 'Acacia tree', author: 'evolveduk', url: 'https://sketchfab.com/3d-models/acacia-tree-bb14c2bb679b4d0bb1c578a27e2ddabf' },
  roble: { path: 'glbs/000-107/6468dd4d3eb240ef902b9057d9913606.glb', title: 'Oak tree', author: 'evolveduk', url: 'https://sketchfab.com/3d-models/oak-tree-6468dd4d3eb240ef902b9057d9913606' },
  arce: { path: 'glbs/000-131/b5e945e7abcc471da6547c04e314774c.glb', title: 'Maple Tree', author: 'evolveduk', url: 'https://sketchfab.com/3d-models/maple-tree-b5e945e7abcc471da6547c04e314774c' },
  banano: { path: 'glbs/000-091/7186ebfc24fc42c599f81713cd28d55e.glb', title: 'Banana Tree', author: 'DJMiddi', url: 'https://sketchfab.com/3d-models/banana-tree-7186ebfc24fc42c599f81713cd28d55e' },
  croton: { path: 'glbs/000-065/0cecbc0a6ef34ea68b28c45c08b2528b.glb', title: 'Croton Leaf Plants', author: 'The_Structure_World', url: 'https://sketchfab.com/3d-models/croton-leaf-plants-0cecbc0a6ef34ea68b28c45c08b2528b' },
  tropical: { path: 'glbs/000-072/7365d3fc0eb148028c751364dd172952.glb', title: 'Tropical plant', author: 'adam127', url: 'https://sketchfab.com/3d-models/tropical-plant-7365d3fc0eb148028c751364dd172952' },
  helecho: { path: 'glbs/000-110/38531afd86434987b1a0bf5968fe001f.glb', title: 'Fern', author: 'evolveduk', url: 'https://sketchfab.com/3d-models/fern-38531afd86434987b1a0bf5968fe001f' },
  monstera: { path: 'glbs/000-012/2fa12ba0af5442c9af8f9bead1a7d020.glb', title: 'Tropical Plant monstera deliciosa', author: 'evolveduk', url: 'https://sketchfab.com/3d-models/tropical-plant-monstera-deliciosa-2fa12ba0af5442c9af8f9bead1a7d020' },
  hiedra: { path: 'glbs/000-059/d8991bd2a8c84e96b15a721a833bd4c3.glb', title: 'Ivy', author: 'Daniel Gryningstjerna (dangry)', url: 'https://sketchfab.com/3d-models/ivy-d8991bd2a8c84e96b15a721a833bd4c3' },
};

// ---------------------------------------------------------------- catálogo
// h: altura normalizada (m). bark/barkFar y leaf/leafFar: triángulos cerca/lejos.
// sphere: cuánto se curvan las normales del follaje hacia afuera de la copa
// (0 = las del autor; útil en copas de tarjetas para una luz más suave).
export const SPECIES = [
  { out: 'palma_coco', src: 'coco', use: 'Palma de coco (parques, glorietas)', h: 9, barkMain: 'Tree_0Mat', farDrop: ['Tree_4Mat'], bark: 1800, barkFar: 160, leaf: 3600, leafFar: 900, sphere: 0 },
  { out: 'palma_real', src: 'datil', use: 'Palma real (Roystonea; tronco gris liso y capitel verde)', h: 16, bark: 1400, barkFar: 160, leaf: 4200, leafFar: 1400, farErr: 0.04, sphere: 0, trunkGrey: true, minorTint: { Tree_2Mat: [0.5, 0.72, 0.36], Tree_3Mat: [0.55, 0.7, 0.4] } },
  { out: 'palma_areca', src: 'curly', use: 'Palma areca/abanico de antejardín', h: 3.5, bark: 500, barkFar: 60, leaf: 3800, leafFar: 900, farErr: 0.05, sphere: 0 },
  { out: 'guadua', src: 'bambu', use: 'Guadua / bambú (orillas de quebradas)', h: 12, bark: 420, barkFar: 80, leaf: 1760, leafFar: 520, sphere: 0.3 },
  { out: 'arbol_saman', src: 'acacia', use: 'Samán (copa en sombrilla, parques y avenidas)', h: 14, bark: 3200, barkFar: 220, leaf: 1056, leafFar: 400, sphere: 0.35, grow: 1.5 },
  { out: 'arbol_mango', src: 'roble', use: 'Mango / árbol de sombra de copa densa', h: 9, bark: 3000, barkFar: 200, leaf: 1980, leafFar: 700, sphere: 0.5, grow: 1.2 },
  { out: 'arbol_aguacate', src: 'arce', use: 'Aguacate / árbol de copa alta (patios y lotes)', h: 10, bark: 2600, barkFar: 180, leaf: 4800, leafFar: 1300, sphere: 0.45, grow: 1.35 },
  { out: 'platano', src: 'banano', use: 'Mata de plátano (patios y laderas)', h: 4.5, allLeaf: true, leaf: 3332, leafFar: 800, sphere: 0 },
  { out: 'croton', src: 'croton', use: 'Crotos de colores (antejardines)', h: 1.1, allLeaf: true, cluster: true, leaf: 975, leafFar: 400, sphere: 0 },
  { out: 'heliconia', src: 'tropical', use: 'Heliconia / platanillo (jardines, Jardín Botánico)', h: 1.8, allLeaf: true, leaf: 144, leafFar: 144, sphere: 0 },
  { out: 'helecho', src: 'helecho', use: 'Helecho (sombra, quebradas, Jardín Botánico)', h: 0.9, allLeaf: true, leaf: 560, leafFar: 240, sphere: 0 },
  { out: 'monstera', src: 'monstera', use: 'Costilla de Adán (antejardines y matas)', h: 1.1, bark: 500, barkFar: 60, leaf: 1440, leafFar: 500, sphere: 0 },
  { out: 'arbol_guayabo', custom: 'phTree', id: 'island_tree_02', use: 'Guayabo / almendro (tronco torcido, patios y lotes)', cell: 0.45, cards: 800, minLeafY: 0.15, farCell: 0.95, barkTris: 3600, barkFarTris: 220, clumpLeaves: 40, leafSize: [0.2, 0.34] },
  { out: 'seto', custom: 'seto', use: 'Seto de swinglea podado (antejardines, separadores)' },
  { out: 'buganvilia', custom: 'buganvilia', use: 'Buganvilia (sobre muros y rejas)' },
  { out: 'pasto', custom: 'pasto', use: 'Mata de pasto corto (prados y bordes)' },
  { out: 'maleza', custom: 'maleza', use: 'Pasto alto y maleza (lotes y laderas)' },
  { out: 'enredadera', custom: 'enredadera', use: 'Enredadera sobre muros (2 × 3 m)' },
];

// ---------------------------------------------------------------- utilidades
async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file;
  console.log('descargando', url);
  await downloadTo(url, file);
  return file;
}

const sketchfab = (key) => download(OBJAVERSE + SKETCHFAB[key].path, path.join(CACHE, 'objaverse', path.basename(SKETCHFAB[key].path)));

async function avgColor(info) {
  if (!info?.image) return [0.5, 0.5, 0.5];
  const s = await sharp(info.image).removeAlpha().resize(64, 64).stats();
  return s.channels.slice(0, 3).map((c) => c.mean / 255);
}

/** Componentes conexas (por índice y por posición) -> lista de listas de triángulos. */
function components(part) {
  const nv = part.P.length / 3;
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const byPos = new Map();
  for (let i = 0; i < nv; i++) {
    const k = `${Math.round(part.P[i * 3] * 1e4)},${Math.round(part.P[i * 3 + 1] * 1e4)},${Math.round(part.P[i * 3 + 2] * 1e4)}`;
    if (byPos.has(k)) parent[find(i)] = find(byPos.get(k));
    else byPos.set(k, i);
  }
  for (let t = 0; t < part.I.length; t += 3) {
    const a = find(part.I[t]);
    parent[find(part.I[t + 1])] = a;
    parent[find(part.I[t + 2])] = a;
  }
  const groups = new Map();
  for (let t = 0; t < part.I.length; t += 3) {
    const r = find(part.I[t]);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  }
  return [...groups.values()];
}

/** Simplificación con error máximo (no destruye la forma aunque no llegue al objetivo). */
function simplifyCapped(part, target, maxErr) {
  const nv = part.P.length / 3;
  const attrs = new Float32Array(nv * 5);
  for (let i = 0; i < nv; i++) {
    attrs.set(part.N.subarray(i * 3, i * 3 + 3), i * 5);
    attrs.set(part.U.subarray(i * 2, i * 2 + 2), i * 5 + 3);
  }
  const [idx] = MeshoptSimplifier.simplifyWithAttributes(part.I, part.P, 3, attrs, 5, [0.2, 0.2, 0.2, 1, 1], null, Math.max(3, target * 3), maxErr, []);
  return compact({ ...part, I: idx });
}

/**
 * Reduce el follaje a ~target triángulos sin "pelar" la copa: si las piezas
 * son grandes (hojas de palma) se simplifican con meshopt; si son muchas
 * tarjetas pequeñas, se conserva un subconjunto al azar y cada tarjeta que
 * queda crece para cubrir el área de las que se quitaron.
 */
function reduceLeaves(part, target, seed, { maxErr = null } = {}) {
  if (trisOf([part]) <= target) return part;
  let p = part;
  let comps = components(p);
  const avg = p.I.length / 3 / comps.length;
  if (avg > 6 || comps.length < 40) {
    p = maxErr ? simplifyCapped(p, Math.max(target, comps.length * 4), maxErr) : simplifyPart(p, Math.max(target, comps.length * 4));
    if (trisOf([p]) <= target * 1.1) return p;
    comps = components(p);
  }
  const rnd = rngFrom(seed);
  const order = comps.map((c, i) => [rnd(), i]).sort((a, b) => a[0] - b[0]).map(([, i]) => comps[i]);
  const total = p.I.length / 3;
  const keep = [];
  let n = 0;
  for (const c of order) {
    if (n + c.length > target && keep.length) continue;
    keep.push(c);
    n += c.length;
  }
  const grow = Math.min(1.8, Math.sqrt(total / Math.max(1, n)));
  const P = p.P.slice();
  const I = [];
  const moved = new Uint8Array(p.P.length / 3);
  for (const c of keep) {
    const verts = new Set();
    for (const t of c) for (let k = 0; k < 3; k++) verts.add(p.I[t + k]);
    let cx = 0, cy = 0, cz = 0;
    for (const v of verts) {
      cx += p.P[v * 3];
      cy += p.P[v * 3 + 1];
      cz += p.P[v * 3 + 2];
    }
    cx /= verts.size;
    cy /= verts.size;
    cz /= verts.size;
    for (const v of verts) {
      if (moved[v]) continue;
      moved[v] = 1;
      P[v * 3] = cx + (p.P[v * 3] - cx) * grow;
      P[v * 3 + 1] = cy + (p.P[v * 3 + 1] - cy) * grow;
      P[v * 3 + 2] = cz + (p.P[v * 3 + 2] - cz) * grow;
    }
    for (const t of c) I.push(p.I[t], p.I[t + 1], p.I[t + 2]);
  }
  return compact({ ...p, P, I: Uint32Array.from(I) });
}

/** Agranda cada pieza (tarjeta de hojas) alrededor de su centro: copa más tupida. */
function growLeaves(part, grow) {
  if (!grow || grow === 1) return part;
  const P = part.P.slice();
  for (const c of components(part)) {
    const verts = new Set();
    for (const t of c) for (let k = 0; k < 3; k++) verts.add(part.I[t + k]);
    const m = [0, 0, 0];
    for (const v of verts) for (let k = 0; k < 3; k++) m[k] += part.P[v * 3 + k] / verts.size;
    for (const v of verts) for (let k = 0; k < 3; k++) P[v * 3 + k] = m[k] + (part.P[v * 3 + k] - m[k]) * grow;
  }
  return { ...part, P };
}

/** Normales hacia afuera de la copa (mezcla) y oclusión falsa en color de vértice. */
function shadeLeaves(part, sphere, { aoMin = 0.55 } = {}) {
  const b = boundsOf([part]);
  const H = Math.max(1e-3, b.max[1] - b.min[1]);
  const R = Math.max(1e-3, Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) / 2);
  const c = [(b.min[0] + b.max[0]) / 2, b.min[1] + H * 0.45, (b.min[2] + b.max[2]) / 2];
  const n = part.P.length / 3;
  const C = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = part.P[i * 3], y = part.P[i * 3 + 1], z = part.P[i * 3 + 2];
    if (sphere > 0) {
      let sx = x - c[0], sy = (y - c[1]) * 1.2 + H * 0.25, sz = z - c[2];
      const sl = Math.hypot(sx, sy, sz) || 1;
      sx /= sl;
      sy /= sl;
      sz /= sl;
      let nx = part.N[i * 3], ny = part.N[i * 3 + 1], nz = part.N[i * 3 + 2];
      if (nx * sx + ny * sy + nz * sz < 0) [nx, ny, nz] = [-nx, -ny, -nz];
      nx = nx * (1 - sphere) + sx * sphere;
      ny = ny * (1 - sphere) + sy * sphere;
      nz = nz * (1 - sphere) + sz * sphere;
      const l = Math.hypot(nx, ny, nz) || 1;
      part.N.set([nx / l, ny / l, nz / l], i * 3);
    }
    const hy = Math.min(1, Math.max(0, (y - b.min[1]) / H));
    const rr = Math.min(1, Math.hypot(x - c[0], z - c[2]) / R);
    const ao = Math.min(1, aoMin + (1 - aoMin) * (0.75 * Math.pow(hy, 0.8) + 0.45 * rr));
    C.set([ao, ao, ao], i * 3);
  }
  part.C = C;
  return part;
}

/**
 * Atlas de las texturas de hoja (una celda por material) y UV remapeadas,
 * para dibujar todo el follaje con un solo material.
 */
async function leafAtlas(groups, size = 1024) {
  if (groups.length === 1) return { image: await sharp(groups[0].material.base.image).ensureAlpha().png().toBuffer(), parts: groups };
  const n = groups.length;
  const cols = 2;
  const rows = n <= 2 ? 1 : 2;
  const cw = size / cols, ch = size / rows;
  const comp = [];
  const out = [];
  for (let g = 0; g < n; g++) {
    const cx = (g % cols) * cw, cy = Math.floor(g / cols) * ch;
    const img = await sharp(groups[g].material.base.image).ensureAlpha().resize(cw, ch, { fit: 'fill' }).png().toBuffer();
    comp.push({ input: img, left: cx, top: cy });
    const p = groups[g];
    const U = new Float32Array(p.U.length);
    for (let i = 0; i < p.U.length; i += 2) {
      // Las UV de hojas van en [0, 1]; se recortan un poco para no sangrar a la celda vecina.
      const wrap = (t) => Math.min(0.995, Math.max(0.005, t > 1.001 || t < -0.001 ? t - Math.floor(t) : t));
      const u = wrap(p.U[i]);
      const v = wrap(p.U[i + 1]);
      U[i] = (cx + u * cw) / size;
      U[i + 1] = (cy + v * ch) / size;
    }
    out.push({ ...p, U });
  }
  const image = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 60, g: 80, b: 40, alpha: 0 } } }).composite(comp).png().toBuffer();
  return { image, parts: out };
}

const leafMaterial = (image, { opaque = false, cutoff = 0.5 } = {}) => ({ name: 'follaje', color: [1, 1, 1, 1], alphaMode: opaque ? 'OPAQUE' : 'MASK', alphaCutoff: cutoff, doubleSided: true, roughness: 0.78, metalness: 0, base: { image, mime: 'image/png' } });

// ---------------------------------------------------------------- modelos de Sketchfab
async function buildSketchfab(spec) {
  const file = await sketchfab(spec.src);
  let parts = await readParts(file);
  parts = parts.filter((p) => p.I.length);
  const isLeaf = (p) => spec.allLeaf || p.material.alphaMode !== 'OPAQUE';
  if (spec.cluster) {
    // Varias matas separadas (una por material): se juntan en una sola mata.
    const byMat = new Map();
    for (const p of parts) (byMat.get(p.material.name) ?? byMat.set(p.material.name, []).get(p.material.name)).push(p);
    const spots = [[0, 0], [0.34, 0.22], [-0.3, 0.26], [0.05, -0.32]];
    let k = 0;
    for (const list of byMat.values()) {
      const b = boundsOf(list);
      const [ox, oz] = spots[k++ % spots.length];
      const s = 0.8 + 0.15 * k;
      transformParts(list, (x, y, z) => [(x - (b.min[0] + b.max[0]) / 2) * s + ox, (y - b.min[1]) * s, (z - (b.min[2] + b.max[2]) / 2) * s + oz]);
    }
  }
  let wood = parts.filter((p) => !isLeaf(p));
  let leaves = parts.filter(isLeaf);
  // Pivote: base del tronco (o de la mata) y escala a la altura pedida.
  const all = boundsOf(parts);
  const H = all.max[1] - all.min[1];
  const baseRef = wood.length ? wood : parts;
  let sx = 0, sz = 0, n = 0;
  for (const p of baseRef) {
    for (let i = 0; i < p.P.length; i += 3) {
      if (p.P[i + 1] < all.min[1] + H * 0.04) {
        sx += p.P[i];
        sz += p.P[i + 2];
        n++;
      }
    }
  }
  if (!n) {
    sx = (all.min[0] + all.max[0]) / 2;
    sz = (all.min[2] + all.max[2]) / 2;
    n = 1;
  }
  const s = spec.h / H;
  transformParts(parts, makeTransform({ tx: -sx / n, ty: -all.min[1], tz: -sz / n, s }));

  // Madera: un solo material (la corteza principal); las piezas menores se
  // tiñen con color de vértice para acercarse al color de su textura.
  let woodNear = null;
  let woodFar = null;
  if (wood.length) {
    const main = wood.find((p) => p.material.name === spec.barkMain) ?? wood.reduce((a, b) => (b.I.length > a.I.length ? b : a));
    const mainAvg = await avgColor(main.material.base);
    for (const p of wood) {
      let tint = [1, 1, 1];
      if (spec.minorTint?.[p.material.name]) tint = spec.minorTint[p.material.name];
      else if (p !== main && p.material.name !== main.material.name) {
        const a = await avgColor(p.material.base);
        tint = a.map((v, k) => Math.min(1, v / Math.max(0.05, mainAvg[k])));
      }
      p.C = new Float32Array((p.P.length / 3) * 3);
      for (let i = 0; i < p.C.length; i += 3) p.C.set(tint, i);
    }
    const mat = { ...main.material, name: 'corteza', alphaMode: 'OPAQUE', doubleSided: false, color: [1, 1, 1, 1], mr: null, concrete: !!spec.trunkGrey };
    const merged = mergeList(wood, mat);
    woodNear = dropSmallComponents(simplifyPart(merged, spec.bark, { prune: true }), 8);
    // Lejos: sin las piezas menudas (cocos), para que el tronco no se pierda al simplificar.
    const farWood = spec.farDrop ? wood.filter((p) => !spec.farDrop.includes(p.material.name)) : wood;
    woodFar = simplifyPart(farWood === wood ? merged : mergeList(farWood, mat), spec.barkFar);
  }

  // Follaje: atlas único, reducción por presupuesto y sombreado.
  const byMat = new Map();
  for (const p of leaves) (byMat.get(p.material.name) ?? byMat.set(p.material.name, []).get(p.material.name)).push(p);
  const groups = [...byMat.values()].map((l) => mergeList(l, l[0].material));
  const atlas = await leafAtlas(groups);
  const opaque = groups.every((g) => g.material.alphaMode === 'OPAQUE');
  // Corte de alpha del autor (≈0,22 en los de Tree It): con 0,5 las hojas se adelgazan.
  const cutoff = Math.min(0.45, Math.max(0.15, ...groups.map((g) => (g.material.alphaMode === 'MASK' ? g.material.alphaCutoff : 0.3))));
  const lmat = leafMaterial(atlas.image, { opaque, cutoff });
  const leafAll = growLeaves(mergeList(atlas.parts, lmat), spec.grow);
  const leafNear = shadeLeaves(reduceLeaves(leafAll, spec.leaf, 11), spec.sphere);
  const leafFar = shadeLeaves(reduceLeaves(leafAll, spec.leafFar, 23, { maxErr: spec.farErr }), spec.sphere);
  const near = [woodNear, leafNear].filter(Boolean);
  const far = [woodFar, leafFar].filter(Boolean);
  return write(spec, near, far, { sources: [SKETCHFAB[spec.src]] });
}

async function write(spec, near, far, meta) {
  const b = boundsOf(near);
  const leafB = boundsOf(near.filter((p) => p.material.name === 'follaje'));
  const extras = {
    size: b.max.map((v, i) => +(v - b.min[i]).toFixed(3)),
    copa: { minY: +leafB.min[1].toFixed(2), radio: +(Math.max(leafB.max[0] - leafB.min[0], leafB.max[2] - leafB.min[2]) / 2).toFixed(2) },
  };
  const groups = [{ name: 'cerca', parts: near }];
  if (far) groups.push({ name: 'lejos', parts: far });
  const res = await writeGLB(path.join(OUT, `${spec.out}.glb`), groups, {
    tex: 1024,
    extras,
    matOverrides: (m) => (m.name === 'follaje' ? { tex: spec.tex ?? 1024, noNormal: true } : { tex: 512 }),
  });
  return { ...res, ...meta, extras };
}

// ---------------------------------------------------------------- texturas de Poly Haven
async function phTexture(id, kind) {
  const f = path.join(CACHE, 'polyhaven', `${id}_${kind}_1k.jpg`);
  return fs.readFileSync(await download(`${PH}${id}/${id}_${kind}_1k.jpg`, f));
}

/** RGBA a partir de difuso + alpha separados. */
async function rgba(diff, alpha, size = 1024) {
  const d = await sharp(diff).resize(size, size).removeAlpha().raw().toBuffer();
  const a = await sharp(alpha).resize(size, size).greyscale().raw().toBuffer();
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = d[i * 3];
    out[i * 4 + 1] = d[i * 3 + 1];
    out[i * 4 + 2] = d[i * 3 + 2];
    out[i * 4 + 3] = a[i];
  }
  return { raw: out, size, png: () => sharp(out, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer() };
}

/** Cajas (en UV) de las manchas del alpha: matas de pasto sueltas en el atlas. */
async function spriteBoxes(alpha, minFrac = 0.002) {
  const L = 256;
  const a = await sharp(alpha).resize(L, L).greyscale().raw().toBuffer();
  const lab = new Int32Array(L * L).fill(-1);
  const boxes = [];
  for (let i = 0; i < L * L; i++) {
    if (a[i] < 60 || lab[i] >= 0) continue;
    const box = { x0: L, y0: L, x1: 0, y1: 0, n: 0 };
    const st = [i];
    lab[i] = boxes.length;
    while (st.length) {
      const j = st.pop();
      const x = j % L, y = (j / L) | 0;
      box.x0 = Math.min(box.x0, x);
      box.x1 = Math.max(box.x1, x);
      box.y0 = Math.min(box.y0, y);
      box.y1 = Math.max(box.y1, y);
      box.n++;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const X = x + dx, Y = y + dy;
          if (X < 0 || Y < 0 || X >= L || Y >= L) continue;
          const q = Y * L + X;
          if (lab[q] < 0 && a[q] >= 60) {
            lab[q] = lab[i];
            st.push(q);
          }
        }
      }
    }
    boxes.push(box);
  }
  return boxes
    .filter((b) => b.n > L * L * minFrac)
    .map((b) => ({ u0: b.x0 / L, v0: b.y0 / L, u1: (b.x1 + 1) / L, v1: (b.y1 + 1) / L, aspect: (b.x1 - b.x0 + 1) / (b.y1 - b.y0 + 1) }));
}

/** Acumulador de cuadriláteros (tarjetas) con normal y color por vértice. */
function quadBuilder(material) {
  const P = [], N = [], U = [], C = [], I = [];
  return {
    // o: centro de la base; a: eje horizontal (ancho/2); up: eje vertical (alto)
    quad(o, a, up, n, uv, col, colTop = col) {
      const base = P.length / 3;
      const pts = [[-1, 0, uv.u0, uv.v1, col], [1, 0, uv.u1, uv.v1, col], [1, 1, uv.u1, uv.v0, colTop], [-1, 1, uv.u0, uv.v0, colTop]];
      for (const [sa, sb, u, v, c] of pts) {
        P.push(o[0] + a[0] * sa + up[0] * sb, o[1] + a[1] * sa + up[1] * sb, o[2] + a[2] * sa + up[2] * sb);
        N.push(...n);
        U.push(u, v);
        C.push(...c);
      }
      I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    },
    part: () => ({ node: 'follaje', material, P: new Float32Array(P), N: new Float32Array(N), U: new Float32Array(U), C: new Float32Array(C), I: new Uint32Array(I) }),
  };
}

// ---------------------------------------------------------------- pasto y maleza
async function buildPasto(spec, tall) {
  const diff = await phTexture('grass_bermuda_01', 'diff');
  const alpha = await phTexture('grass_bermuda_01', 'alpha');
  const tex = await rgba(diff, alpha, 512);
  const boxes = (await spriteBoxes(alpha)).filter((b) => b.u1 - b.u0 > 0.04);
  const mat = leafMaterial(await tex.png(), { cutoff: 0.4 });
  const rnd = rngFrom(tall ? 71 : 17);
  const make = (count, hMin, hMax, spread) => {
    const qb = quadBuilder(mat);
    for (let k = 0; k < count; k++) {
      const box = boxes[Math.floor(rnd() * boxes.length)];
      const h = hMin + rnd() * (hMax - hMin);
      const w = Math.min(h * box.aspect, h * 1.6) / 2;
      const r = Math.sqrt(rnd()) * spread;
      const a0 = rnd() * Math.PI * 2;
      const o = [Math.cos(a0) * r, 0, Math.sin(a0) * r];
      const yaw = rnd() * Math.PI;
      const tilt = (rnd() - 0.5) * 0.35;
      const ax = [Math.cos(yaw) * w, 0, Math.sin(yaw) * w];
      const up = [-Math.sin(yaw) * Math.sin(tilt) * h, Math.cos(tilt) * h, Math.cos(yaw) * Math.sin(tilt) * h];
      // Normal casi vertical: el pasto se ilumina como el suelo, sin parpadeo.
      const n = [Math.cos(a0) * 0.25, 0.95, Math.sin(a0) * 0.25];
      const b = 0.5 + rnd() * 0.15;
      qb.quad(o, ax, up, n, box, [b, b, b], [1, 1, 1]);
    }
    return qb.part();
  };
  const near = tall ? make(14, 0.55, 1.15, 0.45) : make(9, 0.18, 0.38, 0.3);
  return write(spec, [near], null, { sources: [{ title: 'Grass Bermuda 01 (textura)', author: 'Rico Cilliers', url: 'https://polyhaven.com/a/grass_bermuda_01', cc0: true }] });
}

// ---------------------------------------------------------------- enredadera
async function buildEnredadera(spec) {
  const file = await sketchfab('hiedra');
  const parts = await readParts(file);
  const leafPart = parts.filter((p) => p.material.base).reduce((a, b) => (b.I.length > a.I.length ? b : a));
  const mat = leafMaterial(await sharp(leafPart.material.base.image).ensureAlpha().resize(512, 512).png().toBuffer(), { cutoff: 0.45 });
  const W = 2, Hh = 3;
  const make = (count, sizeMul, seed) => {
    const rnd = rngFrom(seed);
    const qb = quadBuilder(mat);
    // Tallos que suben desde el piso con ramas; las hojas se reparten a lo largo.
    const stems = 12;
    let placed = 0;
    for (let s = 0; s < stems && placed < count; s++) {
      let x = -W / 2 + (s + 0.5) * (W / stems) + (rnd() - 0.5) * 0.2;
      let y = 0;
      const top = Hh * (0.55 + rnd() * 0.45);
      const per = Math.ceil(count / stems);
      for (let k = 0; k < per && placed < count; k++) {
        y = (k / per) * top;
        x += (rnd() - 0.5) * 0.2;
        x = Math.max(-W / 2 + 0.05, Math.min(W / 2 - 0.05, x));
        const size = (0.09 + rnd() * 0.07) * sizeMul;
        const ang = (rnd() - 0.5) * 1.6;
        const out = 0.02 + rnd() * 0.1;
        const ox = x + (rnd() - 0.5) * 0.45;
        const tiltX = 0.4 + rnd() * 0.5; // hoja inclinada hacia afuera
        const a = [Math.cos(ang) * size, Math.sin(ang) * size * Math.cos(tiltX), 0];
        const up = [-Math.sin(ang) * size * 2, Math.cos(ang) * size * 2 * Math.cos(tiltX), Math.sin(tiltX) * size * 2];
        const cell = Math.floor(rnd() * 4);
        const uv = { u0: (cell % 2) * 0.5, v0: Math.floor(cell / 2) * 0.5, u1: (cell % 2) * 0.5 + 0.5, v1: Math.floor(cell / 2) * 0.5 + 0.5 };
        const ao = 0.6 + 0.4 * Math.min(1, out / 0.12) * (0.8 + 0.2 * (y / Hh));
        qb.quad([ox, y - size * 0.6, out], a, up, [0, 0.35, 0.94], uv, [ao, ao, ao]);
        placed++;
      }
    }
    return qb.part();
  };
  const near = make(420, 1, 5);
  const far = make(140, 1.7, 9);
  return write(spec, [near], [far], { sources: [SKETCHFAB.hiedra] });
}

// ---------------------------------------------------------------- setos y buganvilia (tarjetas)
/** Triángulos falsos repartidos en un volumen: foliageCards pone racimos donde hay "hojas". */
function volumeLeaves(n, inside, seed) {
  const rnd = rngFrom(seed);
  const P = [];
  const I = [];
  let tries = 0;
  while (P.length / 9 < n && tries++ < n * 50) {
    const x = rnd() * 2 - 1, y = rnd(), z = rnd() * 2 - 1;
    const q = inside(x, y, z);
    if (!q) continue;
    const s = 0.04;
    const b = P.length / 3;
    P.push(q[0], q[1], q[2], q[0] + s, q[1], q[2], q[0], q[1] + s, q[2]);
    I.push(b, b + 1, b + 2);
  }
  return [{ P: new Float32Array(P), I: new Uint32Array(I), N: new Float32Array(P.length).fill(0), U: new Float32Array((P.length / 3) * 2) }];
}

async function buildCards(spec, shape) {
  const diff = await phTexture('island_tree_02', 'leaves_diff');
  const alpha = await phTexture('island_tree_02', 'leaves_alpha');
  const sprites = await leafSprites(diff, alpha, 12);
  const cfg = { clumpLeaves: shape.clumpLeaves, leafSize: shape.leafSize, chroma: 0, minLeafY: 0 };
  const atlas = await clumpAtlas(sprites, cfg, shape.seed);
  const mat = { name: 'follaje', color: [1, 1, 1, 1], alphaMode: 'MASK', alphaCutoff: 0.42, doubleSided: false, roughness: 0.8, metalness: 0, base: { image: atlas, mime: 'image/webp' } };
  const leaves = volumeLeaves(4000, shape.inside, shape.seed);
  const mk = (cell, max, seed, mul) => {
    const c = foliageCards(leaves, cfg, cell, max, seed, mul);
    // Color por racimo (8 vértices por tarjeta: 2 planos × 4 esquinas).
    const rnd = rngFrom(seed + 1);
    for (let i = 0; i < c.C.length; i += 24) {
      const col = shape.color(rnd);
      for (let k = 0; k < 24; k += 3) {
        c.C[i + k] *= col[0];
        c.C[i + k + 1] *= col[1];
        c.C[i + k + 2] *= col[2];
      }
    }
    return { node: 'follaje', material: mat, ...c };
  };
  const near = mk(shape.cell, shape.cards, 3, 1.5);
  const far = mk(shape.cell * 2.2, Math.round(shape.cards / 4), 5, 1.6);
  return write(spec, [near], [far], { sources: [{ title: 'Island Tree 02 (textura de hojas)', author: 'Rob Tuytel, Rico Cilliers', url: 'https://polyhaven.com/a/island_tree_02', cc0: true }] });
}

const SHAPES = {
  // Seto podado: bloque de 1,6 × 1,2 × 0,8 m con esquinas redondeadas.
  seto: {
    seed: 41,
    cell: 0.26,
    cards: 260,
    clumpLeaves: 60,
    leafSize: [0.12, 0.2],
    inside: (x, y, z) => {
      const X = x * 0.8, Y = 0.08 + y * 1.1, Z = z * 0.4;
      const e = Math.pow(Math.abs(x), 6) + Math.pow(Math.abs(z), 6) + Math.pow(Math.abs(y * 2 - 1), 6);
      return e < 1 && e > 0.25 ? [X, Y, Z] : null;
    },
    color: (r) => {
      const k = 0.85 + r() * 0.2;
      return [0.3 * k, 0.5 * k, 0.2 * k];
    },
  },
  // Buganvilia: mata alta y ancha (2,2 × 2,2 × 1,1 m) con brácteas fucsia.
  buganvilia: {
    seed: 57,
    cell: 0.32,
    cards: 300,
    clumpLeaves: 45,
    leafSize: [0.14, 0.24],
    inside: (x, y, z) => {
      const r = Math.hypot(x, (y - 0.55) * 1.6, z * 1.1);
      return r < 1 && r > 0.35 && y > 0.05 ? [x * 1.1, y * 2.2, z * 0.55] : null;
    },
    color: (r) => {
      const t = r();
      if (t < 0.5) return [0.95, 0.18 + r() * 0.1, 0.55 + r() * 0.15]; // fucsia
      if (t < 0.58) return [0.98, 0.4, 0.62]; // rosado
      const k = 0.8 + r() * 0.2;
      return [0.3 * k, 0.48 * k, 0.2 * k];
    },
  },
};

// ---------------------------------------------------------------- main
async function main() {
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  fs.mkdirSync(OUT, { recursive: true });
  const onlyArg = process.argv.find((a) => a.startsWith('--only'));
  const only = onlyArg ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : process.argv[process.argv.indexOf(onlyArg) + 1]).split(',') : null;
  const manifestFile = path.join(OUT, 'manifest.json');
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  for (const spec of SPECIES) {
    if (only && !only.includes(spec.out)) continue;
    const t0 = Date.now();
    let r;
    if (spec.src) r = await buildSketchfab(spec);
    else if (spec.custom === 'phTree') {
      r = await buildTree({ ...spec, outDir: OUT });
      r = { ...r, sources: [{ title: r.name, author: r.authors.join(', '), url: `https://polyhaven.com/a/${spec.id}`, cc0: true }] };
    } else if (spec.custom === 'pasto') r = await buildPasto(spec, false);
    else if (spec.custom === 'maleza') r = await buildPasto(spec, true);
    else if (spec.custom === 'enredadera') r = await buildEnredadera(spec);
    else r = await buildCards(spec, SHAPES[spec.custom]);
    manifest[spec.out] = {
      file: `models/vegetacion/${spec.out}.glb`,
      use: spec.use,
      sources: r.sources.map((s) => ({ title: s.title, author: s.author, url: s.url, license: s.cc0 ? 'CC0' : 'CC BY 4.0' })),
      triangles: r.tris,
      bytes: r.bytes,
      extras: r.extras,
    };
    console.log(`${spec.out.padEnd(16)} ${JSON.stringify(r.tris)} ${(r.bytes / 1024).toFixed(0)} KB ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  const credits = ['Vegetación 3D de Medellín Aranjuez: fuentes y licencias', ''];
  for (const [k, m] of Object.entries(manifest)) for (const s of m.sources) credits.push(`${k}.glb: "${s.title}" por ${s.author} — ${s.url} — ${s.license}${s.license.startsWith('CC BY') ? ' (https://creativecommons.org/licenses/by/4.0/), modificado: reducido, reescalado y reempaquetado' : ''}`);
  fs.writeFileSync(path.join(OUT, 'CREDITOS.txt'), credits.join('\n') + '\n');
  const total = Object.values(manifest).reduce((s, m) => s + m.bytes, 0);
  console.log(`total ${(total / 1e6).toFixed(2)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
