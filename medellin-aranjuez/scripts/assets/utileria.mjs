// Descarga, convierte y optimiza la utilería urbana y la vegetación 3D desde
// Poly Haven (todo CC0). Reproducible: `node scripts/assets/utileria.mjs`
// (opcional: `--only silla_plastica,arbol_copa_ancha`).
//
// Salida: public/models/utileria/<nombre>.glb (meshopt + texturas webp) y
// public/models/utileria/manifest.json con autores, licencia y triángulos.
// Las descargas se guardan en scripts/assets/.cache (ignorado por git).
//
// Presupuestos: utilería ≤ 5k triángulos, árboles ≤ 15k, texturas ≤ 1024 px
// (512 en objetos pequeños). Los árboles de Poly Haven traen millones de
// hojas modeladas; aquí se reconstruye el follaje con tarjetas (racimos de
// hojas compuestos a partir del atlas de hojas del propio modelo, con alpha)
// ubicadas donde el modelo original tiene hojas, y se simplifica la madera.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { dedup, prune, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, 'public/models/utileria');
const CACHE = path.join(ROOT, 'scripts/assets/.cache');

// ---------------------------------------------------------------- catálogo
// pivot: 'base' = centro de la huella en XZ y la base en y=0.
// rotY: giro (grados) para que el frente del objeto mire a +Z.
export const MODELS = [
  { out: 'silla_plastica', id: 'plastic_monobloc_chair_01', use: 'Silla plástica de tienda de barrio', maxTris: 900, tex: 512 },
  { out: 'canasta', id: 'plastic_crate_02', use: 'Canasta de cerveza (tiendas)', maxTris: 900, tex: 512, alpha: 'MASK' },
  { out: 'caneca', id: 'metal_trash_can', use: 'Caneca de basura', maxTris: 1000, tex: 512, nodes: /^metal_trash_can(_handle_left|_handle_right)?$/ },
  { out: 'barrera', id: 'concrete_road_barrier', use: 'Barrera de concreto (obras)', maxTris: 900, tex: 512 },
  { out: 'alcantarilla', id: 'water_manhole_cover', use: 'Tapa de alcantarilla', maxTris: 320, tex: 512 },
  { out: 'bolsa_basura', id: 'trashbag', use: 'Bolsa de basura', maxTris: 500, tex: 512 },
  { out: 'matera', id: 'potted_plant_02', use: 'Matera con planta (andenes y balcones)', maxTris: 1400, tex: 512, alpha: 'MASK' },
  { out: 'hidrante', id: 'fire_hydrant', use: 'Hidrante', maxTris: 800, tex: 512, nodes: /^fire_hydrant(_cap_0[123])?$/ },
  { out: 'banca', id: 'painted_wooden_bench', use: 'Banca del parque', maxTris: 700, tex: 512 },
  { out: 'farol_parque', id: 'street_lamp_01', use: 'Farol de parque', maxTris: 2600, tex: 512, emissive: /glass|bulb/ },
  { out: 'poste_a', id: 'modular_electricity_poles', use: 'Poste de energía con crucetas', maxTris: 3500, tex: 512, nodes: /^preset_02_/, pivotNode: /_pole$/, concrete: /^modular_electricity_poles$/, cables: true, farTris: 220 },
  { out: 'poste_b', id: 'modular_electricity_poles', use: 'Poste de energía con transformador', maxTris: 4500, tex: 512, nodes: /^preset_01_/, pivotNode: /_pole$/, concrete: /^modular_electricity_poles$/, cables: true, farTris: 260 },
  { out: 'farol_calle', custom: 'streetLamp', use: 'Farol de calle (poste + lámpara de brazo)', ids: ['modular_electricity_poles', 'street_lamp_02'] },
  { out: 'arbol_copa_ancha', custom: 'tree', id: 'jacaranda_tree', use: 'Árbol de copa ancha (guayacanes, ceiba)', cell: 1.35, cards: 1100, minLeafY: 0.3, maxSprites: 3, farCell: 3.6, barkTris: 5200, barkFarTris: 260, clumpLeaves: 26, leafSize: [0.42, 0.62] },
  { out: 'arbol_copa_redonda', custom: 'tree', id: 'island_tree_01', use: 'Árbol de copa redonda (mango, ficus)', cell: 0.42, cards: 900, minLeafY: 0.15, farCell: 0.9, barkTris: 4200, barkFarTris: 240, clumpLeaves: 40, leafSize: [0.2, 0.34] },
];

// ---------------------------------------------------------------- utilidades
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

export async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

export async function downloadTo(url, file, size) {
  if (fs.existsSync(file) && (!size || fs.statSync(file).size === size)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      return;
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
    }
  }
}

/** Descarga un modelo glTF de Poly Haven (con caché) y su ficha. */
export async function polyhaven(id, res = '1k') {
  const dir = path.join(CACHE, 'polyhaven', id, res);
  const infoFile = path.join(CACHE, 'polyhaven', id, 'info.json');
  const filesFile = path.join(CACHE, 'polyhaven', id, 'files.json');
  if (!fs.existsSync(filesFile)) {
    fs.mkdirSync(path.dirname(filesFile), { recursive: true });
    fs.writeFileSync(filesFile, JSON.stringify(await getJson(`https://api.polyhaven.com/files/${id}`)));
    fs.writeFileSync(infoFile, JSON.stringify(await getJson(`https://api.polyhaven.com/info/${id}`)));
  }
  const files = JSON.parse(fs.readFileSync(filesFile, 'utf8'));
  const info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
  const g = files.gltf[res].gltf;
  const gltfPath = path.join(dir, path.basename(new URL(g.url).pathname));
  await downloadTo(g.url, gltfPath, g.size);
  for (const [rel, f] of Object.entries(g.include)) await downloadTo(f.url, path.join(dir, rel), f.size);
  return { gltfPath, info, files, dir };
}

// Matrices 4x4 (column-major, como glTF).
function mat4Apply(m, x, y, z) {
  return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
}
function mat3Normal(m) {
  // Inversa transpuesta de la parte 3x3.
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1;
  return [A / det, B / det, C / det, -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det, (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det];
}
export function makeTransform({ tx = 0, ty = 0, tz = 0, rotY = 0, s = 1, sy = s } = {}) {
  const c = Math.cos(rotY);
  const n = Math.sin(rotY);
  // Primero traslada, luego rota en Y y escala.
  return (x, y, z) => {
    const X = x + tx, Y = y + ty, Z = z + tz;
    return [(c * X + n * Z) * s, Y * sy, (-n * X + c * Z) * s];
  };
}

function accessorArray(acc, comps) {
  if (!acc) return null;
  const arr = acc.getArray();
  if (arr instanceof Float32Array && !acc.getNormalized()) return arr;
  const n = acc.getCount();
  const out = new Float32Array(n * comps);
  const el = [];
  for (let i = 0; i < n; i++) {
    acc.getElement(i, el);
    for (let k = 0; k < comps; k++) out[i * comps + k] = el[k];
  }
  return out;
}

function texInfo(material, slot) {
  const t = material[`get${slot}Texture`]?.();
  if (!t) return null;
  const info = material[`get${slot}TextureInfo`]();
  const tt = info.getExtension('KHR_texture_transform');
  return { image: Buffer.from(t.getImage()), mime: t.getMimeType(), texCoord: info.getTexCoord(), transform: tt ? { offset: tt.getOffset(), scale: tt.getScale(), rotation: tt.getRotation() } : null };
}

/**
 * Lee un glTF y devuelve "partes" planas (una por primitiva) con la
 * geometría ya en espacio de mundo del archivo y la información de material.
 */
export async function readParts(gltfPath, filter = null) {
  const doc = await io.read(gltfPath);
  const parts = [];
  for (const scene of doc.getRoot().listScenes()) {
    for (const root of scene.listChildren()) {
      root.traverse((node) => {
        const mesh = node.getMesh();
        if (!mesh) return;
        if (filter && !filter.test(node.getName())) return;
        const world = node.getWorldMatrix();
        const nm = mat3Normal(world);
        for (const prim of mesh.listPrimitives()) {
          const mat = prim.getMaterial();
          const base = mat ? texInfo(mat, 'BaseColor') : null;
          const uvSet = base?.texCoord ?? 0;
          const pos = accessorArray(prim.getAttribute('POSITION'), 3);
          const nrm = accessorArray(prim.getAttribute('NORMAL'), 3);
          const uvSrc = accessorArray(prim.getAttribute(`TEXCOORD_${uvSet}`), 2);
          const count = pos.length / 3;
          const P = new Float32Array(count * 3);
          const N = new Float32Array(count * 3);
          const U = new Float32Array(count * 2);
          for (let i = 0; i < count; i++) {
            const p = mat4Apply(world, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
            P.set(p, i * 3);
            if (nrm) {
              const x = nrm[i * 3], y = nrm[i * 3 + 1], z = nrm[i * 3 + 2];
              let nx = nm[0] * x + nm[3] * y + nm[6] * z;
              let ny = nm[1] * x + nm[4] * y + nm[7] * z;
              let nz = nm[2] * x + nm[5] * y + nm[8] * z;
              const l = Math.hypot(nx, ny, nz) || 1;
              N[i * 3] = nx / l;
              N[i * 3 + 1] = ny / l;
              N[i * 3 + 2] = nz / l;
            } else N[i * 3 + 1] = 1;
            if (uvSrc) {
              let u = uvSrc[i * 2];
              let v = uvSrc[i * 2 + 1];
              const tt = base?.transform;
              if (tt) {
                const cs = Math.cos(tt.rotation), sn = Math.sin(tt.rotation);
                const su = u * tt.scale[0], sv = v * tt.scale[1];
                u = cs * su + sn * sv + tt.offset[0];
                v = -sn * su + cs * sv + tt.offset[1];
              }
              U[i * 2] = u;
              U[i * 2 + 1] = v;
            }
          }
          const idxAcc = prim.getIndices();
          let I;
          if (idxAcc) I = Uint32Array.from(idxAcc.getArray());
          else I = Uint32Array.from({ length: count }, (_, k) => k);
          // Espejo en la matriz: invertir el orden de los triángulos.
          const det = world[0] * (world[5] * world[10] - world[6] * world[9]) - world[4] * (world[1] * world[10] - world[2] * world[9]) + world[8] * (world[1] * world[6] - world[2] * world[5]);
          if (det < 0) for (let t = 0; t < I.length; t += 3) [I[t + 1], I[t + 2]] = [I[t + 2], I[t + 1]];
          parts.push({
            node: node.getName(),
            material: mat
              ? {
                  name: mat.getName(),
                  color: mat.getBaseColorFactor(),
                  alphaMode: mat.getAlphaMode(),
                  alphaCutoff: mat.getAlphaCutoff(),
                  doubleSided: mat.getDoubleSided(),
                  roughness: mat.getRoughnessFactor(),
                  metalness: mat.getMetallicFactor(),
                  base,
                  normal: texInfo(mat, 'Normal'),
                  mr: texInfo(mat, 'MetallicRoughness'),
                }
              : { name: 'default', color: [1, 1, 1, 1], alphaMode: 'OPAQUE', doubleSided: false, roughness: 1, metalness: 0 },
            P,
            N,
            U,
            I,
          });
        }
      });
    }
  }
  return parts;
}

export function trisOf(parts) {
  return parts.reduce((s, p) => s + p.I.length / 3, 0);
}

export function boundsOf(parts) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    for (let i = 0; i < p.P.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p.P[i + k]);
        max[k] = Math.max(max[k], p.P[i + k]);
      }
    }
  }
  return { min, max };
}

export function transformParts(parts, fn) {
  for (const p of parts) {
    for (let i = 0; i < p.P.length; i += 3) p.P.set(fn(p.P[i], p.P[i + 1], p.P[i + 2]), i);
    // Normales: solo rotación en Y (las escalas no uniformes que usamos son leves).
    const o = fn(0, 0, 0);
    for (let i = 0; i < p.N.length; i += 3) {
      const q = fn(p.N[i], p.N[i + 1], p.N[i + 2]);
      let x = q[0] - o[0], y = q[1] - o[1], z = q[2] - o[2];
      const l = Math.hypot(x, y, z) || 1;
      p.N[i] = x / l;
      p.N[i + 1] = y / l;
      p.N[i + 2] = z / l;
    }
  }
}

/** Fusiona partes que comparten material (una sola primitiva por material). */
export function mergeByMaterial(parts) {
  const groups = new Map();
  for (const p of parts) {
    const k = p.material.name;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  return [...groups.values()].map((list) => mergeList(list, list[0].material));
}

export function mergeList(list, material) {
  let nv = 0;
  let ni = 0;
  for (const p of list) {
    nv += p.P.length / 3;
    ni += p.I.length;
  }
  const P = new Float32Array(nv * 3);
  const N = new Float32Array(nv * 3);
  const U = new Float32Array(nv * 2);
  const C = list.some((p) => p.C) ? new Float32Array(nv * 3).fill(1) : null;
  const I = new Uint32Array(ni);
  let ov = 0;
  let oi = 0;
  for (const p of list) {
    P.set(p.P, ov * 3);
    N.set(p.N, ov * 3);
    U.set(p.U, ov * 2);
    if (C && p.C) C.set(p.C, ov * 3);
    for (let k = 0; k < p.I.length; k++) I[oi + k] = p.I[k] + ov;
    ov += p.P.length / 3;
    oi += p.I.length;
  }
  return { node: list[0].node, material, P, N, U, C, I };
}

/** Quita vértices no referenciados. */
export function compact(part) {
  const map = new Int32Array(part.P.length / 3).fill(-1);
  let n = 0;
  for (const i of part.I) if (map[i] < 0) map[i] = n++;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const U = new Float32Array(n * 2);
  const C = part.C ? new Float32Array(n * 3) : null;
  for (let i = 0; i < map.length; i++) {
    const j = map[i];
    if (j < 0) continue;
    P.set(part.P.subarray(i * 3, i * 3 + 3), j * 3);
    N.set(part.N.subarray(i * 3, i * 3 + 3), j * 3);
    U.set(part.U.subarray(i * 2, i * 2 + 2), j * 2);
    if (C) C.set(part.C.subarray(i * 3, i * 3 + 3), j * 3);
  }
  const I = part.I.map((i) => map[i]);
  return { ...part, P, N, U, C, I };
}

/**
 * Quita piezas sueltas pequeñas (restos de ramitas tras simplificar): se
 * unen vértices por posición y se descartan componentes con pocos triángulos.
 */
export function dropSmallComponents(part, minTris) {
  const nv = part.P.length / 3;
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const byPos = new Map();
  for (let i = 0; i < nv; i++) {
    const k = `${Math.round(part.P[i * 3] * 1e3)},${Math.round(part.P[i * 3 + 1] * 1e3)},${Math.round(part.P[i * 3 + 2] * 1e3)}`;
    if (byPos.has(k)) parent[find(i)] = find(byPos.get(k));
    else byPos.set(k, i);
  }
  for (let t = 0; t < part.I.length; t += 3) {
    const a = find(part.I[t]);
    parent[find(part.I[t + 1])] = a;
    parent[find(part.I[t + 2])] = a;
  }
  const count = new Map();
  for (let t = 0; t < part.I.length; t += 3) {
    const r = find(part.I[t]);
    count.set(r, (count.get(r) ?? 0) + 1);
  }
  const keep = [];
  for (let t = 0; t < part.I.length; t += 3) if (count.get(find(part.I[t])) >= minTris) keep.push(part.I[t], part.I[t + 1], part.I[t + 2]);
  return compact({ ...part, I: Uint32Array.from(keep) });
}

/** Simplifica una parte hasta ~targetTris con meshoptimizer. */
export function simplifyPart(part, targetTris, { prune: doPrune = false } = {}) {
  const cur = part.I.length / 3;
  if (cur <= targetTris) return part;
  const target = Math.max(3, Math.floor(targetTris) * 3);
  const flags = doPrune ? ['Prune'] : [];
  // Atributos: normal y UV para respetar costuras y sombreado.
  const nv = part.P.length / 3;
  const attrs = new Float32Array(nv * 5);
  for (let i = 0; i < nv; i++) {
    attrs.set(part.N.subarray(i * 3, i * 3 + 3), i * 5);
    attrs.set(part.U.subarray(i * 2, i * 2 + 2), i * 5 + 3);
  }
  let best = part.I;
  for (const err of [0.01, 0.03, 0.08, 0.2, 0.5, 1]) {
    // "Prune" elimina piezas sueltas pequeñas (ramitas) pero con errores
    // grandes se come todo: solo se usa con errores moderados.
    const [idx] = MeshoptSimplifier.simplifyWithAttributes(part.I, part.P, 3, attrs, 5, [0.3, 0.3, 0.3, 0.6, 0.6], null, target, err, err <= 0.08 ? flags : []);
    if (idx.length < target * 0.25 && best !== part.I) break;
    best = idx;
    if (idx.length <= target * 1.08) break;
  }
  if (best.length > target * 1.3) {
    // Piezas sueltas que no colapsan: simplificación "sloppy".
    const [idx] = MeshoptSimplifier.simplifySloppy(part.I, part.P, 3, null, target, 1);
    best = idx;
  }
  return compact({ ...part, I: best });
}

export function simplifyToBudget(parts, maxTris, opts) {
  const total = trisOf(parts);
  if (total <= maxTris) return parts;
  let out = parts;
  let budget = maxTris;
  for (let iter = 0; iter < 4; iter++) {
    out = parts.map((p) => simplifyPart(p, Math.max(12, (p.I.length / 3 / total) * budget), opts));
    const t = trisOf(out);
    if (t <= maxTris) break;
    budget *= (maxTris / t) * 0.95;
  }
  return out;
}

// ---------------------------------------------------------------- texturas
export async function toWebp(img, size, { alpha = false, quality = 84, mode = null } = {}) {
  let s = sharp(img).resize(size, size, { fit: 'inside', withoutEnlargement: true });
  if (mode === 'concrete') {
    // Poste de madera -> concreto gris claro (Medellín usa postes de concreto).
    s = s.grayscale().linear(0.55, 95).toColourspace('srgb');
  }
  if (!alpha) s = s.removeAlpha();
  return s.webp({ quality, alphaQuality: 100, effort: 5 }).toBuffer();
}

// ---------------------------------------------------------------- escritura GLB
/**
 * groups: [{ name, parts }] -> un nodo (con su malla) por grupo.
 * matOpts(material) -> { tex, alphaMode, emissive, concrete, ... }
 */
export async function writeGLB(file, groups, { tex = 512, extras = {}, matOverrides = () => ({}) } = {}) {
  const doc = new Document();
  doc.createExtension(EXTTextureWebP).setRequired(false);
  const buffer = doc.createBuffer();
  const scene = doc.createScene('utileria');
  const mats = new Map();
  const texCache = new Map();
  const makeTex = async (info, name, size, opts) => {
    if (!info) return null;
    const key = `${name}|${size}|${opts.mode ?? ''}|${info.image.length}`;
    if (texCache.has(key)) return texCache.get(key);
    const img = await toWebp(info.image, size, opts);
    const t = doc.createTexture(name).setImage(img).setMimeType('image/webp').setURI(`${name}.webp`);
    texCache.set(key, t);
    return t;
  };
  const getMat = async (m) => {
    if (mats.has(m.name)) return mats.get(m.name);
    const o = { ...m, ...matOverrides(m) };
    const alphaMode = o.alphaMode === 'BLEND' ? (o.keepBlend ? 'BLEND' : 'MASK') : o.alphaMode;
    const hasAlpha = alphaMode !== 'OPAQUE';
    const size = o.tex ?? tex;
    const mat = doc
      .createMaterial(o.name)
      .setBaseColorFactor(o.color ?? [1, 1, 1, 1])
      .setAlphaMode(alphaMode)
      .setAlphaCutoff(o.alphaCutoff ?? 0.5)
      .setDoubleSided(o.doubleSided ?? false)
      .setRoughnessFactor(o.roughness ?? 1)
      .setMetallicFactor(o.metalness ?? 0);
    if (o.base) mat.setBaseColorTexture(await makeTex(o.base, `${o.name}_color`, size, { alpha: hasAlpha, mode: o.concrete ? 'concrete' : null }));
    if (o.normal && !o.noNormal) mat.setNormalTexture(await makeTex(o.normal, `${o.name}_normal`, size, { quality: 88 }));
    if (o.mr) {
      const t = await makeTex(o.mr, `${o.name}_orm`, Math.max(256, size / 2), { quality: 86 });
      mat.setMetallicRoughnessTexture(t).setOcclusionTexture(t);
    }
    if (o.emissive) mat.setEmissiveFactor(o.emissive);
    if (o.extras) mat.setExtras(o.extras);
    mats.set(m.name, mat);
    return mat;
  };
  const stats = {};
  for (const g of groups) {
    const mesh = doc.createMesh(g.name);
    let tris = 0;
    for (const p of g.parts) {
      if (!p.I.length) continue; // pieza eliminada por completo al simplificar
      const prim = doc.createPrimitive();
      prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(p.P).setBuffer(buffer));
      prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(p.N).setBuffer(buffer));
      if (p.material.base || p.U.some((v) => v !== 0)) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(p.U).setBuffer(buffer));
      if (p.C) {
        // RGBA para que meshopt empaquete el color en 4 bytes alineados.
        const c4 = new Float32Array((p.C.length / 3) * 4);
        for (let i = 0, j = 0; i < p.C.length; i += 3, j += 4) c4.set([Math.min(1, p.C[i]), Math.min(1, p.C[i + 1]), Math.min(1, p.C[i + 2]), 1], j);
        prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(c4).setBuffer(buffer));
      }
      const nv = p.P.length / 3;
      prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(nv < 65535 ? Uint16Array.from(p.I) : p.I).setBuffer(buffer));
      prim.setMaterial(await getMat(p.material));
      mesh.addPrimitive(prim);
      tris += p.I.length / 3;
    }
    const node = doc.createNode(g.name).setMesh(mesh);
    scene.addChild(node);
    stats[g.name] = tris;
  }
  scene.setExtras(extras);
  await doc.transform(dedup(), prune({ keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const glb = await io.writeBinary(doc);
  fs.writeFileSync(file, glb);
  return { tris: stats, bytes: glb.length };
}

// ---------------------------------------------------------------- modelos simples
async function buildSimple(spec) {
  const src = await polyhaven(spec.id, spec.res ?? '1k');
  let parts = await readParts(src.gltfPath, spec.nodes ?? null);
  // Pivote: centro de la huella (o del nodo indicado) y base en y = 0.
  const piv = boundsOf(spec.pivotNode ? parts.filter((p) => spec.pivotNode.test(p.node)) : parts);
  const all = boundsOf(parts);
  const cx = (piv.min[0] + piv.max[0]) / 2;
  const cz = (piv.min[2] + piv.max[2]) / 2;
  transformParts(parts, makeTransform({ tx: -cx, ty: -all.min[1], tz: -cz, rotY: ((spec.rotY ?? 0) * Math.PI) / 180 }));
  parts = mergeByMaterial(parts);
  parts = simplifyToBudget(parts, spec.maxTris);
  const extras = {};
  if (spec.cables) extras.cables = cableAnchors(parts);
  const b = boundsOf(parts);
  extras.size = b.max.map((v, k) => +(v - b.min[k]).toFixed(3));
  // Versión lejana (LOD) opcional: la misma pieza muy simplificada.
  const groups = [{ name: spec.farTris ? 'cerca' : spec.out, parts }];
  if (spec.farTris) groups.push({ name: 'lejos', parts: simplifyToBudget(parts.map((p) => ({ ...p })), spec.farTris) });
  const res = await writeGLB(path.join(OUT, `${spec.out}.glb`), groups, {
    tex: spec.tex,
    extras,
    matOverrides: (m) => ({
      alphaMode: spec.alpha ?? m.alphaMode,
      concrete: spec.concrete?.test(m.name),
      emissive: spec.emissive?.test(m.name) ? [1, 0.8, 0.5] : null,
      extras: spec.emissive?.test(m.name) ? { luz: true } : undefined,
      // El vidrio translúcido se ve mejor opaco y emisivo de noche.
      color: spec.emissive?.test(m.name) ? [0.9, 0.85, 0.7, 1] : m.color,
      ...(spec.emissive?.test(m.name) ? { alphaMode: 'OPAQUE' } : {}),
    }),
  });
  return { ...res, authors: Object.keys(src.info.authors ?? {}), name: src.info.name, sources: [spec.id], extras };
}

/**
 * Puntos de amarre de los cables: extremos superiores de las crucetas
 * (aisladores), medidos sobre la geometría ya normalizada.
 */
function cableAnchors(parts) {
  const b = boundsOf(parts);
  const top = b.max[1];
  const pts = [];
  for (const p of parts) {
    for (let i = 0; i < p.P.length; i += 3) {
      const x = p.P[i], y = p.P[i + 1], z = p.P[i + 2];
      if (y > top - 1.2 && Math.abs(x) > 0.25) pts.push([x, y, z]);
    }
  }
  // Agrupa por x (redondeado a 10 cm) y toma la altura máxima de cada grupo.
  const groups = new Map();
  for (const [x, y] of pts) {
    const k = Math.round(x * 5) / 5;
    groups.set(k, Math.max(groups.get(k) ?? -Infinity, y));
  }
  const xs = [...groups.keys()].sort((a, c) => a - c);
  const minX = xs[0];
  const maxX = xs[xs.length - 1];
  const yTop = Math.max(...groups.values());
  return [
    [+minX.toFixed(2), +(groups.get(minX) ?? yTop).toFixed(2)],
    [0, +(top - 0.05).toFixed(2)],
    [+maxX.toFixed(2), +(groups.get(maxX) ?? yTop).toFixed(2)],
  ];
}

// ---------------------------------------------------------------- farol de calle
async function buildStreetLamp(spec) {
  // Poste de concreto del kit modular + lámpara de brazo de street_lamp_02.
  const kit = await polyhaven('modular_electricity_poles', '1k');
  const lampSrc = await polyhaven('street_lamp_02', '1k');
  let pole = await readParts(kit.gltfPath, /^pole_small$/);
  const pb = boundsOf(pole.filter((p) => p.node === 'pole_small'));
  const pcx = (pb.min[0] + pb.max[0]) / 2;
  const pcz = (pb.min[2] + pb.max[2]) / 2;
  const poleH = pb.max[1] - pb.min[1];
  const H = 7.2; // altura del poste
  const k = H / poleH;
  const body = pole.filter((p) => p.node === 'pole_small');
  transformParts(body, makeTransform({ tx: -pcx, ty: -pb.min[1], tz: -pcz, s: 1.25, sy: k }));
  let lamp = await readParts(lampSrc.gltfPath);
  const lb = boundsOf(lamp);
  // El soporte de pared queda en el poste y la lámpara hacia -Z (la calle).
  const lampScale = 1.35;
  const back = lb.max[2];
  transformParts(lamp, (x, y, z) => [(x - (lb.min[0] + lb.max[0]) / 2) * lampScale, (y - lb.max[1]) * lampScale + H - 0.1, (z - back) * lampScale - 0.12]);
  let parts = mergeByMaterial([...body, ...lamp]);
  const lampParts = parts.filter((p) => /street_lamp/.test(p.material.name));
  const poleParts = parts.filter((p) => !/street_lamp/.test(p.material.name));
  parts = [...poleParts, ...simplifyToBudget(lampParts, 1100)];
  const b = boundsOf(parts);
  const head = boundsOf(parts.filter((p) => /glass|bulb/.test(p.material.name)));
  const extras = { size: b.max.map((v, i) => +(v - b.min[i]).toFixed(3)), luz: [0, +head.min[1].toFixed(2), +((head.min[2] + head.max[2]) / 2).toFixed(2)] };
  // LOD lejano: solo el poste (sin cabeza detallada).
  const far = simplifyToBudget(poleParts.map((p) => ({ ...p })), 60);
  const res = await writeGLB(path.join(OUT, `${spec.out}.glb`), [{ name: 'cerca', parts }, { name: 'lejos', parts: far }], {
    tex: 512,
    extras,
    matOverrides: (m) => {
      if (/glass|bulb/.test(m.name)) return { alphaMode: 'OPAQUE', color: [0.9, 0.85, 0.7, 1], emissive: [1, 0.8, 0.5], extras: { luz: true } };
      if (/^modular_electricity_poles/.test(m.name)) return { concrete: m.name === 'modular_electricity_poles' };
      return {};
    },
  });
  return { ...res, authors: [...new Set([...Object.keys(kit.info.authors ?? {}), ...Object.keys(lampSrc.info.authors ?? {})])], name: `${kit.info.name} + ${lampSrc.info.name}`, sources: spec.ids, extras };
}

// ---------------------------------------------------------------- árboles
export function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Recorta las hojas del atlas usando su mapa alpha (componentes conexas). */
export async function leafSprites(diffBuf, alphaBuf, maxSprites = 12) {
  const S = 1024;
  const diff = await sharp(diffBuf).resize(S, S).removeAlpha().raw().toBuffer();
  const alpha = await sharp(alphaBuf).resize(S, S).greyscale().raw().toBuffer();
  // Componentes a baja resolución con dilatación para unir tallos finos.
  const L = 128;
  const small = await sharp(alphaBuf).resize(L, L).greyscale().blur(1.2).raw().toBuffer();
  const lab = new Int32Array(L * L).fill(-1);
  const boxes = [];
  for (let i = 0; i < L * L; i++) {
    if (small[i] < 40 || lab[i] >= 0) continue;
    const id = boxes.length;
    const box = { x0: L, y0: L, x1: 0, y1: 0, n: 0 };
    const stack = [i];
    lab[i] = id;
    while (stack.length) {
      const j = stack.pop();
      const x = j % L;
      const y = (j / L) | 0;
      box.x0 = Math.min(box.x0, x);
      box.x1 = Math.max(box.x1, x);
      box.y0 = Math.min(box.y0, y);
      box.y1 = Math.max(box.y1, y);
      box.n++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X >= L || Y >= L) continue;
        const q = Y * L + X;
        if (lab[q] < 0 && small[q] >= 40) {
          lab[q] = id;
          stack.push(q);
        }
      }
    }
    boxes.push(box);
  }
  const k = S / L;
  const sprites = boxes
    .filter((b) => b.n > L * L * 0.004)
    .sort((a, b) => b.n - a.n)
    .slice(0, maxSprites)
    .map((b) => {
      const x0 = Math.max(0, (b.x0 - 1) * k);
      const y0 = Math.max(0, (b.y0 - 1) * k);
      const x1 = Math.min(S, (b.x1 + 2) * k);
      const y1 = Math.min(S, (b.y1 + 2) * k);
      const w = x1 - x0;
      const h = y1 - y0;
      const rgba = new Float32Array(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const si = (y0 + y) * S + (x0 + x);
          const o = (y * w + x) * 4;
          rgba[o] = diff[si * 3] / 255;
          rgba[o + 1] = diff[si * 3 + 1] / 255;
          rgba[o + 2] = diff[si * 3 + 2] / 255;
          rgba[o + 3] = alpha[si] / 255;
        }
      }
      return { w, h, rgba };
    });
  return sprites;
}

/** Compone 4 racimos de hojas (atlas 2x2 de 512 px) con alpha. */
export async function clumpAtlas(sprites, spec, seed) {
  const T = 512;
  const A = 1024;
  const out = new Float32Array(A * A * 4);
  const rnd = rngFrom(seed);
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * T;
    const oy = Math.floor(v / 2) * T;
    const n = spec.clumpLeaves;
    for (let j = 0; j < n; j++) {
      const sp = sprites[Math.floor(rnd() * sprites.length)];
      const long = Math.max(sp.w, sp.h);
      const size = T * (spec.leafSize[0] + rnd() * (spec.leafSize[1] - spec.leafSize[0]));
      const sc = size / long;
      const ang = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * T * 0.27;
      const a2 = rnd() * Math.PI * 2;
      const cx = T / 2 + Math.cos(a2) * r;
      const cy = T / 2 + Math.sin(a2) * r;
      const bright = (0.55 + 0.45 * (j / n)) * (0.9 + rnd() * 0.2);
      const cs = Math.cos(ang);
      const sn = Math.sin(ang);
      const half = (Math.hypot(sp.w, sp.h) * sc) / 2;
      const X0 = Math.max(0, Math.floor(cx - half));
      const X1 = Math.min(T - 1, Math.ceil(cx + half));
      const Y0 = Math.max(0, Math.floor(cy - half));
      const Y1 = Math.min(T - 1, Math.ceil(cy + half));
      for (let y = Y0; y <= Y1; y++) {
        for (let x = X0; x <= X1; x++) {
          // Coordenadas en el sprite (rotación inversa).
          const dx = (x - cx) / sc;
          const dy = (y - cy) / sc;
          const sx = cs * dx + sn * dy + sp.w / 2;
          const sy = -sn * dx + cs * dy + sp.h / 2;
          if (sx < 0 || sy < 0 || sx >= sp.w - 1 || sy >= sp.h - 1) continue;
          const ix = sx | 0;
          const iy = sy | 0;
          const fx = sx - ix;
          const fy = sy - iy;
          const px = [0, 0, 0, 0];
          for (const [ddx, ddy, wgt] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
            const o = ((iy + ddy) * sp.w + ix + ddx) * 4;
            const al = sp.rgba[o + 3] * wgt;
            px[0] += sp.rgba[o] * al;
            px[1] += sp.rgba[o + 1] * al;
            px[2] += sp.rgba[o + 2] * al;
            px[3] += al;
          }
          const a = px[3];
          if (a <= 0.001) continue;
          const o = ((oy + y) * A + ox + x) * 4;
          // "over" premultiplicado
          const ia = 1 - a;
          out[o] = px[0] * bright + out[o] * ia;
          out[o + 1] = px[1] * bright + out[o + 1] * ia;
          out[o + 2] = px[2] * bright + out[o + 2] * ia;
          out[o + 3] = a + out[o + 3] * ia;
        }
      }
    }
  }
  // Color: casi en escala de grises (el tinte por especie va en instanceColor)
  // con un poco del verde original; alpha reforzado para que no se "pele".
  const img = Buffer.alloc(A * A * 4);
  let sumL = 0;
  let cnt = 0;
  const lum = new Float32Array(A * A);
  for (let i = 0; i < A * A; i++) {
    const a = out[i * 4 + 3];
    if (a < 0.05) continue;
    const r = out[i * 4] / a;
    const g = out[i * 4 + 1] / a;
    const b = out[i * 4 + 2] / a;
    lum[i] = 0.3 * r + 0.55 * g + 0.15 * b;
    sumL += lum[i];
    cnt++;
  }
  const gain = 0.7 / (sumL / Math.max(1, cnt));
  const chroma = spec.chroma ?? 0.22;
  // Relleno de color en zonas transparentes (evita bordes oscuros en mipmaps).
  const avg = [0, 0, 0];
  for (let i = 0; i < A * A; i++) {
    const a = out[i * 4 + 3];
    if (a < 0.05) continue;
    for (let k = 0; k < 3; k++) avg[k] += out[i * 4 + k] / a;
  }
  for (let k = 0; k < 3; k++) avg[k] /= Math.max(1, cnt);
  const avgL = 0.3 * avg[0] + 0.55 * avg[1] + 0.15 * avg[2];
  for (let i = 0; i < A * A; i++) {
    const a = out[i * 4 + 3];
    let r, g, b, L;
    if (a >= 0.05) {
      r = out[i * 4] / a;
      g = out[i * 4 + 1] / a;
      b = out[i * 4 + 2] / a;
      L = lum[i];
    } else {
      [r, g, b] = avg;
      L = avgL;
    }
    const mix = (c) => Math.min(1, (L + (c - L) * chroma) * gain);
    img[i * 4] = Math.round(mix(r) * 255);
    img[i * 4 + 1] = Math.round(mix(g) * 255);
    img[i * 4 + 2] = Math.round(mix(b) * 255);
    // Desvanecido radial dentro de cada racimo: sin cortes rectos en el borde.
    const tx = ((i % A) % 512) / 512 - 0.5;
    const ty = (Math.floor(i / A) % 512) / 512 - 0.5;
    const rad = Math.hypot(tx, ty);
    const fade = Math.min(1, Math.max(0, (0.49 - rad) / 0.1));
    img[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, (a - 0.08) * 1.5)) * fade * 255);
  }
  return sharp(img, { raw: { width: A, height: A, channels: 4 } }).webp({ quality: 88, alphaQuality: 100, effort: 5 }).toBuffer();
}

/**
 * Tarjetas de follaje: un racimo (2 planos cruzados, con cara trasera propia
 * para que la iluminación sea igual por ambos lados) en cada celda donde el
 * modelo original tiene hojas.
 */
export function foliageCards(leaves, spec, cell, maxCards, seed, sizeMul = 1.45) {
  const rnd = rngFrom(seed);
  const cells = new Map();
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const p of leaves) {
    for (let t = 0; t < p.I.length; t += 3) {
      const a = p.I[t] * 3, b = p.I[t + 1] * 3, c = p.I[t + 2] * 3;
      const P = p.P;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      const cx = (P[a] + P[b] + P[c]) / 3, cy = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, cz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
      const key = `${Math.floor(cx / cell)},${Math.floor(cy / cell)},${Math.floor(cz / cell)}`;
      let e = cells.get(key);
      if (!e) cells.set(key, (e = { area: 0, x: 0, y: 0, z: 0 }));
      e.area += area;
      e.x += cx * area;
      e.y += cy * area;
      e.z += cz * area;
      lo = [Math.min(lo[0], cx), Math.min(lo[1], cy), Math.min(lo[2], cz)];
      hi = [Math.max(hi[0], cx), Math.max(hi[1], cy), Math.max(hi[2], cz)];
    }
  }
  let list = [...cells.values()].map((e) => ({ area: e.area, x: e.x / e.area, y: e.y / e.area, z: e.z / e.area }));
  list.sort((a, b) => b.area - a.area);
  const maxArea = list[Math.floor(list.length * 0.1)]?.area ?? 1;
  const minY = lo[1] + (hi[1] - lo[1]) * (spec.minLeafY ?? 0);
  list = list.filter((e) => e.area > maxArea * 0.04 && e.y > minY).slice(0, maxCards);
  const center = [(lo[0] + hi[0]) / 2, lo[1] + (hi[1] - lo[1]) * 0.45, (lo[2] + hi[2]) / 2];
  const P = [];
  const N = [];
  const U = [];
  const C = [];
  const I = [];
  const quad = (cx, cy, cz, ax, ay, az, bx, by, bz, nx, ny, nz, variant, col) => {
    const u0 = (variant % 2) * 0.5;
    const v0 = Math.floor(variant / 2) * 0.5;
    const base = P.length / 3;
    const corners = [[-1, -1, u0, v0 + 0.5], [1, -1, u0 + 0.5, v0 + 0.5], [1, 1, u0 + 0.5, v0], [-1, 1, u0, v0]];
    for (const [sa, sb, u, v] of corners) {
      P.push(cx + ax * sa + bx * sb, cy + ay * sa + by * sb, cz + az * sa + bz * sb);
      N.push(nx, ny, nz);
      U.push(u, v);
      C.push(...col);
    }
    // Cara frontal y trasera (mismo sombreado "esférico").
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    I.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  const H = hi[1] - lo[1];
  const R = Math.max(hi[0] - lo[0], hi[2] - lo[2]) / 2;
  for (const e of list) {
    const size = cell * sizeMul * (0.75 + 0.5 * Math.min(1, Math.sqrt(e.area / maxArea))) / 2;
    const x = e.x + (rnd() - 0.5) * cell * 0.3;
    const y = e.y + (rnd() - 0.5) * cell * 0.3;
    const z = e.z + (rnd() - 0.5) * cell * 0.3;
    // Normal suave: hacia afuera de la copa, un poco hacia arriba.
    let nx = x - center[0], ny = (y - center[1]) * 1.2 + H * 0.25, nz = z - center[2];
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    // Oclusión: abajo y adentro más oscuro.
    const hy = Math.min(1, Math.max(0, (y - lo[1]) / H));
    const rr = Math.min(1, Math.hypot(x - center[0], z - center[2]) / R);
    const ao = Math.min(1, 0.5 + 0.35 * Math.pow(hy, 0.8) + 0.25 * rr) * (0.92 + rnd() * 0.16);
    const j = (rnd() - 0.5) * 0.12;
    const col = [ao * (1 + j), ao, ao * (1 - j)];
    const yaw = rnd() * Math.PI;
    const tilt = (rnd() - 0.5) * 0.9;
    const spin = rnd() * Math.PI * 2;
    for (let q = 0; q < 2; q++) {
      const yw = yaw + q * Math.PI / 2;
      // Plano con normal horizontal (yw) inclinado; ejes a y b en el plano.
      const pn = [Math.cos(yw) * Math.cos(tilt), Math.sin(tilt), Math.sin(yw) * Math.cos(tilt)];
      let t1 = [-Math.sin(yw), 0, Math.cos(yw)];
      let t2 = [pn[1] * t1[2] - pn[2] * t1[1], pn[2] * t1[0] - pn[0] * t1[2], pn[0] * t1[1] - pn[1] * t1[0]];
      const cs = Math.cos(spin + q), sn = Math.sin(spin + q);
      const a = [t1[0] * cs + t2[0] * sn, t1[1] * cs + t2[1] * sn, t1[2] * cs + t2[2] * sn];
      const b = [-t1[0] * sn + t2[0] * cs, -t1[1] * sn + t2[1] * cs, -t1[2] * sn + t2[2] * cs];
      quad(x, y, z, a[0] * size, a[1] * size, a[2] * size, b[0] * size, b[1] * size, b[2] * size, nx, ny, nz, Math.floor(rnd() * 4), col);
    }
  }
  return { P: new Float32Array(P), N: new Float32Array(N), U: new Float32Array(U), C: new Float32Array(C), I: new Uint32Array(I), count: list.length };
}

export async function buildTree(spec) {
  const src = await polyhaven(spec.id, '1k');
  const parts = await readParts(src.gltfPath);
  const isLeaf = (p) => /leaves|leaf/.test(p.material.name);
  const leaves = parts.filter(isLeaf);
  let wood = parts.filter((p) => !isLeaf(p));
  // Pivote: base del tronco (vértices más bajos de la madera).
  const wb = boundsOf(wood);
  let sx = 0, sz = 0, n = 0;
  for (const p of wood) {
    for (let i = 0; i < p.P.length; i += 3) {
      if (p.P[i + 1] < wb.min[1] + 0.3) {
        sx += p.P[i];
        sz += p.P[i + 2];
        n++;
      }
    }
  }
  const tf = makeTransform({ tx: -sx / n, ty: -wb.min[1], tz: -sz / n });
  transformParts(wood, tf);
  transformParts(leaves, tf);
  // Madera: toda con el material de corteza principal (un solo draw call).
  const barkMat = wood.reduce((a, b) => (b.I.length > a.I.length ? b : a)).material;
  const trunkMat = wood.find((p) => /trunk/.test(p.material.name))?.material ?? (wood.find((p) => !/branch/.test(p.material.name))?.material ?? barkMat);
  const woodMerged = mergeList(wood, { ...trunkMat, name: 'corteza' });
  const near = dropSmallComponents(simplifyPart(woodMerged, spec.barkTris, { prune: true }), 40);
  const far = dropSmallComponents(simplifyPart(woodMerged, spec.barkFarTris, { prune: true }), 12);
  // Follaje.
  const files = src.files;
  const alphaUrl = files.leaves_alpha?.['1k']?.jpg?.url;
  const diffUrl = files.leaves_diff?.['1k']?.jpg?.url;
  const alphaFile = path.join(src.dir, 'textures', 'leaves_alpha.jpg');
  const diffFile = path.join(src.dir, 'textures', 'leaves_diff_full.jpg');
  await downloadTo(alphaUrl, alphaFile);
  await downloadTo(diffUrl, diffFile);
  const sprites = await leafSprites(fs.readFileSync(diffFile), fs.readFileSync(alphaFile), spec.maxSprites ?? 12);
  const atlas = await clumpAtlas(sprites, spec, 1234);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(path.join(CACHE, `${spec.out}_follaje.webp`), atlas);
  const leafMaterial = { name: 'follaje', color: [1, 1, 1, 1], alphaMode: 'MASK', alphaCutoff: 0.42, doubleSided: false, roughness: 0.8, metalness: 0, base: { image: atlas, mime: 'image/webp' } };
  const cardsNear = foliageCards(leaves, spec, spec.cell, spec.cards, 99);
  const cardsFar = foliageCards(leaves, spec, spec.farCell, Math.round(spec.cards / 4), 7, 1.55);
  const leafNear = { node: 'follaje', material: leafMaterial, ...cardsNear };
  const leafFar = { node: 'follaje', material: leafMaterial, ...cardsFar };
  const b = boundsOf([near, leafNear]);
  const leafB = boundsOf([leafNear]);
  const extras = {
    size: b.max.map((v, i) => +(v - b.min[i]).toFixed(3)),
    copa: { minY: +leafB.min[1].toFixed(2), radio: +(Math.max(leafB.max[0] - leafB.min[0], leafB.max[2] - leafB.min[2]) / 2).toFixed(2) },
  };
  const res = await writeGLB(
    path.join(spec.outDir ?? OUT, `${spec.out}.glb`),
    [
      { name: 'cerca', parts: [near, leafNear] },
      { name: 'lejos', parts: [far, leafFar] },
    ],
    {
      tex: 1024,
      extras,
      matOverrides: (m) => (m.name === 'follaje' ? { tex: 1024 } : { tex: 512, noNormal: false }),
    },
  );
  return { ...res, authors: Object.keys(src.info.authors ?? {}), name: src.info.name, sources: [spec.id], extras, cards: cardsNear.count };
}

// ---------------------------------------------------------------- main
async function main() {
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.argv.find((a) => a.startsWith('--only'))?.split('=')[1]?.split(',') ?? (process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null);
  const manifestFile = path.join(OUT, 'manifest.json');
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  for (const spec of MODELS) {
    if (only && !only.includes(spec.out)) continue;
    const t0 = Date.now();
    let r;
    if (spec.custom === 'tree') r = await buildTree(spec);
    else if (spec.custom === 'streetLamp') r = await buildStreetLamp(spec);
    else r = await buildSimple(spec);
    manifest[spec.out] = {
      file: `models/utileria/${spec.out}.glb`,
      use: spec.use,
      name: r.name,
      sources: r.sources.map((id) => `https://polyhaven.com/a/${id}`),
      authors: r.authors,
      license: 'CC0',
      triangles: r.tris,
      bytes: r.bytes,
      extras: r.extras,
    };
    console.log(`${spec.out.padEnd(20)} ${JSON.stringify(r.tris)} ${(r.bytes / 1024).toFixed(0)} KB ${((Date.now() - t0) / 1000).toFixed(1)} s ${r.cards ? `(${r.cards} racimos)` : ''}`);
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  const total = Object.values(manifest).reduce((s, m) => s + m.bytes, 0);
  console.log(`total ${(total / 1e6).toFixed(2)} MB`);
}

// Solo al ejecutarse directamente (vegetacion.mjs importa sus utilidades).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
