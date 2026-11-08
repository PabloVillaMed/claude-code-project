// Utilería urbana y vegetación con modelos glTF reales (Poly Haven, CC0),
// generados por scripts/assets/utileria.mjs. Cada modelo se dibuja con
// InstancedMesh (una por material, primitivas fusionadas), repartidos en
// trozos de ciudad (THREE.LOD) para que el recorte por cámara, las sombras y
// el nivel de detalle funcionen por zona y no haya un draw call por objeto.
// Si un modelo no está disponible, el tipo correspondiente vuelve a la
// versión procedural de cityRenderer (o a una caja sencilla si es nuevo).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { assets } from './assets.js';
import { registerAssets } from './assetManifest.js';
import { GRID, terrainHeight } from '../sim/terrain.js';
import { makeRng } from '../sim/rng.js';
import { buildVegetation } from './vegetation.js';
import { wireLines } from './wires.js';

export const PROP_MODELS = [
  'silla_plastica',
  'canasta',
  'caneca',
  'barrera',
  'alcantarilla',
  'bolsa_basura',
  'matera',
  'hidrante',
  'banca',
  'farol_parque',
  'farol_calle',
  'poste_a',
  'poste_b',
  'arbol_copa_ancha',
  'arbol_copa_redonda',
];

registerAssets(PROP_MODELS.map((k) => ({ key: `utileria/${k}`, type: 'gltf', url: `models/utileria/${k}.glb` })));

// Lado (m) de cada trozo de ciudad. El detalle se decide por instancia
// (LodChunk), así que trozos grandes = muchas menos llamadas de dibujo sin
// perder calidad de cerca.
const CHUNK = 280;

// ------------------------------------------------------------------ plantillas

/** Copia un atributo (posiblemente cuantizado) a Float32 sin normalizar. */
function toFloatGeometry(src, matrix) {
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const n = attr.count;
    const size = attr.itemSize;
    const arr = new Float32Array(n * size);
    for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) arr[i * size + k] = attr.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array), 1));
  g.applyMatrix4(matrix);
  return g;
}

/** Fusiona geometrías por material; si los atributos no coinciden, las deja aparte. */
function mergeByMaterial(list) {
  const byMat = new Map();
  for (const { geometry, material } of list) {
    if (!byMat.has(material)) byMat.set(material, []);
    byMat.get(material).push(geometry);
  }
  const out = [];
  for (const [material, geos] of byMat) {
    const merged = geos.length > 1 ? mergeGeometries(geos, false) : geos[0];
    if (merged) out.push({ geometry: merged, material });
    else for (const g of geos) out.push({ geometry: g, material });
  }
  for (const p of out) {
    p.geometry.computeBoundingSphere();
    p.geometry.computeBoundingBox();
  }
  return out;
}

const templates = new Map();

/**
 * Plantilla de un modelo: partes {geometry, material} por nivel de detalle
 * ('cerca' y opcionalmente 'lejos') y los extras del archivo (tamaño, anclajes).
 */
export function propTemplate(key) {
  if (templates.has(key)) return templates.get(key);
  const gltf = assets.gltf(key.includes('/') ? key : `utileria/${key}`);
  if (!gltf) {
    templates.set(key, null);
    return null;
  }
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const levels = { cerca: [], lejos: [] };
  scene.traverse((o) => {
    if (!o.isMesh) return;
    let level = 'cerca';
    for (let p = o; p; p = p.parent) {
      if (p.name === 'lejos') level = 'lejos';
    }
    levels[level].push({ geometry: toFloatGeometry(o.geometry, o.matrixWorld), material: o.material });
  });
  const tpl = {
    key,
    cerca: mergeByMaterial(levels.cerca),
    lejos: levels.lejos.length ? mergeByMaterial(levels.lejos) : null,
    extras: scene.userData ?? {},
  };
  const box = new THREE.Box3();
  for (const p of tpl.cerca) box.union(p.geometry.boundingBox);
  tpl.box = box;
  tpl.height = box.max.y - box.min.y;
  templates.set(key, tpl);
  return tpl;
}

/** Plantilla procedural simple para la utilería nueva cuando falta el modelo. */
function boxTemplate(key, w, h, d, color, { cylinder = false } = {}) {
  const geo = cylinder ? new THREE.CylinderGeometry(w / 2, w / 2, h, 10) : new THREE.BoxGeometry(w, h, d);
  geo.translate(0, h / 2, 0);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const tpl = { key, cerca: [{ geometry: geo, material: new THREE.MeshStandardMaterial({ color, roughness: 0.8 }) }], lejos: null, extras: {}, box: geo.boundingBox, height: h };
  return tpl;
}

// ------------------------------------------------------------------ instancias por trozos

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Trozo con nivel de detalle POR INSTANCIA: cada árbol/poste elige su versión
 * (completa o reducida) según su propia distancia a la cámara, no la del
 * trozo. Las mallas de cada nivel comparten un único buffer de matrices, así
 * que repartir las instancias cuesta una copia pequeña por trozo y solo se
 * hace cuando la cámara se mueve.
 */
class LodChunk {
  /** levels = [cerca, lejos, (muy lejos)]; mid = desde dónde se usa el tercer nivel. */
  constructor(group, center, radius, items, levels, near, far, mid = Infinity) {
    this.group = group;
    this.cx = center.x;
    this.cz = center.z;
    this.radius = radius;
    this.near = near;
    this.far = far;
    this.mid = levels.length > 2 ? Math.max(near + 10, mid) : Infinity;
    this.n = items.length;
    this.px = Float32Array.from(items, (it) => it.x);
    this.pz = Float32Array.from(items, (it) => it.z);
    this.levels = levels;
    // Copia fija de las matrices/colores originales (fuente de las particiones).
    this.srcMatrix = levels[0].matrix.array.slice();
    this.srcColor = levels[0].color ? levels[0].color.array.slice() : null;
    this.idx = levels.map(() => new Uint16Array(this.n));
    // Dónde quedó cada instancia (nivel y casilla en su buffer): para cambiar
    // la matriz de UNA sola (un poste tumbado) sin reescribir el trozo.
    this.lvl = new Uint8Array(this.n);
    this.slot = new Uint16Array(this.n);
    this.mode = -1; // nivel único (0, 1, 2) o 9 = mezclado
  }

  /** Cambia la matriz de la instancia i (en la copia fuente y en su casilla visible: solo esos 16 números). */
  setMatrix(i, te) {
    this.srcMatrix.set(te, i * 16);
    const lv = this.levels[this.lvl[i]];
    if (this.mode < 0 || !lv?.meshes.length || this.slot[i] >= lv.meshes[0].count) return;
    lv.matrix.array.set(te, this.slot[i] * 16);
    lv.matrix.addUpdateRange(this.slot[i] * 16, 16);
    lv.matrix.needsUpdate = true;
  }

  /** Color por instancia (si el nivel lo tiene): mismo trato que setMatrix. */
  setColor(i, r, g, b) {
    if (!this.srcColor) return;
    const o = i * 3;
    this.srcColor[o] = r;
    this.srcColor[o + 1] = g;
    this.srcColor[o + 2] = b;
    const lv = this.levels[this.lvl[i]];
    if (this.mode < 0 || !lv?.color || !lv.meshes.length || this.slot[i] >= lv.meshes[0].count) return;
    const s = this.slot[i] * 3;
    lv.color.array[s] = r;
    lv.color.array[s + 1] = g;
    lv.color.array[s + 2] = b;
    lv.color.addUpdateRange(s, 3);
    lv.color.needsUpdate = true;
  }

  update(x, z) {
    const d = Math.hypot(x - this.cx, z - this.cz);
    if (d - this.radius > this.far) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const r = this.radius;
    if (d - r > this.mid) return this._all(2);
    if (d + r < this.near) return this._all(0);
    if (d - r > this.near && d + r < this.mid) return this._all(1);
    this.mode = 9;
    const near2 = this.near * this.near;
    const mid2 = this.mid * this.mid;
    const k = this.levels.map(() => 0);
    for (let i = 0; i < this.n; i++) {
      const dx = this.px[i] - x;
      const dz = this.pz[i] - z;
      const d2 = dx * dx + dz * dz;
      const l = d2 < near2 ? 0 : d2 < mid2 || this.levels.length < 3 ? 1 : 2;
      this.lvl[i] = l;
      this.slot[i] = k[l];
      this.idx[l][k[l]++] = i;
    }
    this.levels.forEach((lv, l) => this._write(lv, this.idx[l], k[l]));
  }

  _all(level) {
    if (level >= this.levels.length) level = this.levels.length - 1;
    if (this.mode === level) return;
    this.mode = level;
    const all = this.idx[0];
    for (let i = 0; i < this.n; i++) all[i] = this.slot[i] = i;
    this.lvl.fill(level);
    this.levels.forEach((lv, l) => this._write(lv, all, l === level ? this.n : 0));
  }

  _write(level, idx, k) {
    if (!level.meshes.length) return; // nivel vacío (utilería sin versión lejana)
    const m = level.matrix.array;
    for (let j = 0; j < k; j++) m.set(this.srcMatrix.subarray(idx[j] * 16, idx[j] * 16 + 16), j * 16);
    level.matrix.clearUpdateRanges();
    level.matrix.addUpdateRange(0, Math.max(16, k * 16));
    level.matrix.needsUpdate = true;
    if (level.color && this.srcColor) {
      const c = level.color.array;
      for (let j = 0; j < k; j++) c.set(this.srcColor.subarray(idx[j] * 3, idx[j] * 3 + 3), j * 3);
      level.color.clearUpdateRanges();
      level.color.addUpdateRange(0, Math.max(3, k * 3));
      level.color.needsUpdate = true;
    }
    for (const im of level.meshes) {
      im.count = k;
      im.visible = k > 0;
    }
  }
}

// ------------------------------------------------------------------ una instancia suelta
// h = lo que ChunkedInstances deja en `refs` para un objeto: {lc, i} (trozo
// con detalle por instancia) o {levels, i} (THREE.LOD por trozo). Las
// matrices son relativas al centro del trozo.

/** Matriz actual (16 números) de una instancia, escrita en `out`. */
export function instanceMatrix(h, out) {
  const a = h.lc ? h.lc.srcMatrix : h.levels[0].matrix.array;
  for (let k = 0; k < 16; k++) out[k] = a[h.i * 16 + k];
  return out;
}

/** Cambia la matriz de UNA instancia: solo sus 16 números se vuelven a subir, y solo en su trozo. */
export function setInstanceMatrix(h, te) {
  if (h.lc) return h.lc.setMatrix(h.i, te);
  for (const lv of h.levels) {
    lv.matrix.array.set(te, h.i * 16);
    lv.matrix.addUpdateRange(h.i * 16, 16);
    lv.matrix.needsUpdate = true;
  }
}

/** Color de una instancia (solo en los niveles con color por instancia). */
export function setInstanceColor(h, r, g, b) {
  if (h.lc) return h.lc.setColor(h.i, r, g, b);
  for (const lv of h.levels) {
    if (!lv.color) continue;
    lv.color.array[h.i * 3] = r;
    lv.color.array[h.i * 3 + 1] = g;
    lv.color.array[h.i * 3 + 2] = b;
    lv.color.addUpdateRange(h.i * 3, 3);
    lv.color.needsUpdate = true;
  }
}

/** Mallas de una instancia (todos sus niveles). */
export function instanceMeshes(h) {
  const levels = h.lc ? h.lc.levels : h.levels;
  return levels.flatMap((lv) => lv.meshes);
}

// Árbol lejano genérico: copa (icosaedro deformado) y tronco, ~100 triángulos.
const _blobCache = new Map();
const _blobLeaf = new THREE.MeshLambertMaterial({ color: 0x6a8f48 });
const _blobBark = new THREE.MeshLambertMaterial({ color: 0x5a4a3a });
_blobLeaf.userData.blob = true;
/** Partes del nivel "muy lejos" hechas a la medida de la caja de la plantilla. */
export function blobParts(tpl) {
  if (_blobCache.has(tpl)) return _blobCache.get(tpl);
  const b = tpl.box;
  const H = Math.max(0.5, b.max.y);
  const W = Math.max(0.4, Math.max(b.max.x - b.min.x, b.max.z - b.min.z));
  const slim = H > W * 2.2; // palmas y guaduas: copa alta y angosta
  const canopy = new THREE.IcosahedronGeometry(0.5, 1);
  const pos = canopy.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const n = 1 + 0.12 * Math.sin(pos.getX(i) * 9) * Math.cos(pos.getZ(i) * 7);
    pos.setXYZ(i, pos.getX(i) * n, pos.getY(i) * n, pos.getZ(i) * n);
  }
  const ch = slim ? H * 0.35 : H * 0.62;
  canopy.scale(W * (slim ? 0.8 : 0.95), ch, W * (slim ? 0.8 : 0.95));
  canopy.translate(0, H - ch / 2, 0);
  canopy.computeVertexNormals();
  const trunk = new THREE.CylinderGeometry(W * 0.03 + 0.05, W * 0.04 + 0.08, H - ch * 0.8, 5, 1, true);
  trunk.translate(0, (H - ch * 0.8) / 2, 0);
  const parts = [
    { geometry: canopy, material: _blobLeaf },
    { geometry: trunk, material: _blobBark },
  ];
  _blobCache.set(tpl, parts);
  return parts;
}

/**
 * Conjunto de instancias de una plantilla repartidas en trozos de ciudad.
 * Si la plantilla tiene versión reducida ('lejos'), cada instancia elige su
 * nivel según su distancia (LodChunk); si no, el trozo entero es un
 * THREE.LOD que desaparece más allá de `far`.
 */
export class ChunkedInstances {
  constructor(tpl, { near = 140, far = 1500, mid = Infinity, blob = false, castShadow = true, receiveShadow = true, tint = null, name = 'utileria', chunk = CHUNK, perInstance = false, refs = null } = {}) {
    this.tpl = tpl;
    this.items = [];
    // mid + blob: más allá de `mid` cada instancia pasa a un árbol genérico barato.
    // perInstance: aunque no haya versión lejana, la distancia de dibujo se mide
    // a cada instancia y no al centro del trozo (para utilería que se ve poco lejos).
    this.opts = { near, far, mid, blob, castShadow, receiveShadow, tint, name, chunk, perInstance };
    // refs: Map donde queda, por cada objeto (`ref` de add), su instancia
    // {lc | levels, i}: así se puede mover una sola (render/destructibles.js).
    this.refs = refs;
  }

  /** q: cuaternión opcional (ya incluye la rotación en Y); ref: el objeto de la ciudad (ver refs). */
  add(x, y, z, rotY, sx = 1, sy = sx, sz = sx, color = null, q = null, ref = null) {
    this.items.push({ x, y, z, rotY, sx, sy, sz, color: color ? color.clone() : null, q: q ? q.clone() : null, ref });
  }

  /** lodChunks: lista donde se registran los trozos con detalle por instancia. */
  build(root, lodChunks = null) {
    if (!this.items.length) return [];
    const chunks = new Map();
    for (const it of this.items) {
      const k = `${Math.floor(it.x / this.opts.chunk)},${Math.floor(it.z / this.opts.chunk)}`;
      if (!chunks.has(k)) chunks.set(k, []);
      chunks.get(k).push(it);
    }
    const out = [];
    const reach = Math.max(this.tpl.box.max.x - this.tpl.box.min.x, this.tpl.box.max.z - this.tpl.box.min.z);
    for (const list of chunks.values()) {
      const c = new THREE.Vector3();
      for (const it of list) c.add(_v.set(it.x, it.y, it.z));
      c.divideScalar(list.length);
      if (lodChunks && (this.tpl.lejos || this.opts.perInstance)) {
        let radius = 0;
        for (const it of list) radius = Math.max(radius, Math.hypot(it.x - c.x, it.z - c.z) + reach * Math.max(it.sx, it.sz));
        const g = new THREE.Group();
        g.name = this.opts.name;
        g.position.copy(c);
        const nearLevel = this._level(this.tpl.cerca, list, c, this.opts.castShadow);
        // Sin versión lejana: más allá de `near` la instancia simplemente no se
        // dibuja. Antes estas iban en un THREE.LOD por trozo de 280 m, que
        // medía la distancia al centro del trozo: una silla a un paso del
        // jugador podía no verse (y la gente quedaba sentada en el aire).
        const farLevel = this.tpl.lejos ? this._level(this.tpl.lejos, list, c, false) : { group: new THREE.Group(), meshes: [], matrix: null, color: null };
        const levels = [nearLevel, farLevel];
        if (this.opts.blob && this.opts.mid < this.opts.far) levels.push(this._level(blobParts(this.tpl), list, c, false));
        for (const lv of levels) g.add(lv.group);
        root.add(g);
        const lc = new LodChunk(g, c, radius, list, levels, this.tpl.lejos ? this.opts.near : this.opts.far, this.opts.far, this.opts.mid);
        lc._all(0);
        lodChunks.push(lc);
        if (this.refs) list.forEach((it, i) => it.ref && this.refs.set(it.ref, { lc, levels: null, i, group: g, h: this.tpl.box.max.y * it.sy }));
        out.push(g);
        continue;
      }
      const lod = new THREE.LOD();
      lod.name = this.opts.name;
      lod.position.copy(c);
      const lvs = [this._level(this.tpl.cerca, list, c, this.opts.castShadow)];
      lod.addLevel(lvs[0].group, 0);
      if (this.tpl.lejos) {
        lvs.push(this._level(this.tpl.lejos, list, c, false));
        lod.addLevel(lvs[1].group, this.opts.near);
      }
      if (this.refs) list.forEach((it, i) => it.ref && this.refs.set(it.ref, { lc: null, levels: lvs, i, group: lod, h: this.tpl.box.max.y * it.sy }));
      lod.addLevel(new THREE.Object3D(), this.opts.far);
      root.add(lod);
      out.push(lod);
    }
    return out;
  }

  /** Un nivel de detalle: una InstancedMesh por material, todas con el mismo buffer de matrices. */
  _level(parts, list, c, castShadow) {
    const g = new THREE.Group();
    const n = list.length;
    const matrix = new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16);
    matrix.setUsage(THREE.DynamicDrawUsage);
    const tintOf = (m) => m.userData?.blob || (this.opts.tint && this.opts.tint(m));
    const tinted = parts.some((p) => tintOf(p.material));
    const color = tinted ? new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3) : null;
    const col = new THREE.Color();
    list.forEach((it, i) => {
      if (it.q) _q.copy(it.q);
      else _q.setFromAxisAngle(_up, it.rotY);
      _m.compose(_v.set(it.x - c.x, it.y - c.y, it.z - c.z), _q, _s.set(it.sx, it.sy, it.sz));
      _m.toArray(matrix.array, i * 16);
      if (color) (it.color ? col.copy(it.color) : col.setRGB(1, 1, 1)).toArray(color.array, i * 3);
    });
    const meshes = [];
    for (const part of parts) {
      const im = new THREE.InstancedMesh(part.geometry, part.material, n);
      im.instanceMatrix = matrix;
      if (color && tintOf(part.material)) im.instanceColor = color;
      im.castShadow = castShadow;
      im.receiveShadow = this.opts.receiveShadow;
      im.computeBoundingSphere(); // con todas las instancias: vale aunque cambie count
      g.add(im);
      meshes.push(im);
    }
    return { group: g, meshes, matrix, color };
  }
}

// ------------------------------------------------------------------ utilidades

const groundY = (x, z) => terrainHeight(x, z) + GRID.curb;

/** Distancia a la que postes y faroles pasan a su versión reducida. */
const propNear = (r) => Math.round((r.quality?.treeNear ?? 70) * 0.85);

/** Reparte el detalle por instancia según la posición de la cámara (barato: solo si se movió). */
export function updatePropLod(r, camPos) {
  const last = (r._lodAt ??= { x: Infinity, z: Infinity });
  if (Math.abs(camPos.x - last.x) + Math.abs(camPos.z - last.z) < 2.5) return;
  last.x = camPos.x;
  last.z = camPos.z;
  for (const c of r.lodChunks) c.update(camPos.x, camPos.z);
}

/** Cuaternión que apoya un objeto plano sobre la pendiente del terreno. */
function slopeQuat(x, z, rotY, out) {
  const e = 0.5;
  const nx = -(terrainHeight(x + e, z) - terrainHeight(x - e, z)) / (2 * e);
  const nz = -(terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
  _v.set(nx, 1, nz).normalize();
  out.setFromUnitVectors(_up, _v);
  _q2.setFromAxisAngle(_up, rotY);
  return out.multiply(_q2);
}

/** Materiales emisivos (vidrio/bombillo de los faroles) que se encienden de noche. */
function lampMaterials(tpl, night, max) {
  const out = [];
  for (const level of [tpl.cerca, tpl.lejos ?? []]) {
    for (const p of level) {
      const m = p.material;
      if (!m.userData?.luz || out.includes(m)) continue;
      m.emissive = new THREE.Color(0xffc27a);
      m.emissiveIntensity = 0;
      night.push({ m, max });
      out.push(m);
      apagable(m);
    }
  }
  return out;
}

/**
 * El bombillo de un farol tumbado se apaga: con color por instancia, el
 * brillo se multiplica por (2·verde − 1): blanco = encendido, gris 0,5 =
 * apagado (y el vidrio un poco más oscuro). Sin color por instancia, igual que antes.
 */
function apagable(m) {
  if (m.userData.apagable || m.vertexColors) return;
  m.userData.apagable = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = function (sh, renderer) {
    prev.call(this, sh, renderer);
    sh.fragmentShader = sh.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive;\n#ifdef USE_COLOR\n\ttotalEmissiveRadiance *= clamp( vColor.g * 2.0 - 1.0, 0.0, 1.0 );\n#endif');
  };
  const key = m.customProgramCacheKey;
  m.customProgramCacheKey = function () {
    return key.call(this) + '|apagable';
  };
}

// ------------------------------------------------------------------ constructores por tipo

function buildLamps(r, lamps, parkLamps, glowSprite) {
  const tpl = propTemplate('farol_calle');
  const ptpl = propTemplate('farol_parque');
  const glows = [];
  let handledStreet = false;
  if (tpl && lamps.length) {
    lampMaterials(tpl, r.nightMaterials, 4);
    // Lejos: el poste simple más un bloque luminoso donde va la lámpara.
    const luz = tpl.extras.luz ?? [0, 7, -1];
    const glass = tpl.cerca.find((p) => p.material.userData?.luz)?.material;
    if (glass && tpl.lejos && !tpl.lejos.some((p) => p.material === glass)) {
      const box = new THREE.BoxGeometry(0.35, 0.5, 0.35).translate(0, luz[1] + 0.25, luz[2]);
      box.computeBoundingBox();
      box.computeBoundingSphere();
      tpl.lejos.push({ geometry: box, material: glass });
    }
    // Color por instancia solo en el vidrio: así un farol tumbado se apaga (apagable).
    const set = new ChunkedInstances(tpl, { near: propNear(r), far: Math.min(r.quality?.drawDistance ?? 1500, 450), name: 'faroles', tint: (m) => !!m.userData?.luz, refs: r.propInstances });
    r.lampHeads ??= [];
    for (const l of lamps) {
      set.add(l.x, groundY(l.x, l.z) - 0.05, l.z, l.rot, 1, 1, 1, null, null, l);
      const dx = Math.sin(l.rot) * luz[2];
      const dz = Math.cos(l.rot) * luz[2];
      glows.push({ x: l.x + dx, z: l.z + dz, s: 1 });
      const head = { x: l.x + dx, y: groundY(l.x, l.z) + luz[1] - 0.3, z: l.z + dz, off: false };
      r.lampHeads.push(head);
      r.propLights?.set(l, head);
    }
    set.build(r.root, r.lodChunks);
    handledStreet = true;
  }
  if (parkLamps.length) {
    const t = ptpl ?? boxTemplate('farol_parque', 0.18, 4, 0.18, 0x1c1f22, { cylinder: true });
    if (ptpl) lampMaterials(ptpl, r.nightMaterials, 3);
    const k = ptpl ? 4.4 / ptpl.height : 1;
    const set = new ChunkedInstances(t, { near: 400, far: 700, name: 'faroles-parque', tint: (m) => !!m.userData?.luz, refs: r.propInstances });
    r.lampHeads ??= [];
    for (const l of parkLamps) {
      set.add(l.x, groundY(l.x, l.z), l.z, l.rot ?? 0, k, k, k, null, null, l);
      glows.push({ x: l.x, z: l.z, s: 0.6 });
      const head = { x: l.x, y: groundY(l.x, l.z) + 4.1, z: l.z, park: true, off: false };
      r.lampHeads.push(head);
      r.propLights?.set(l, head);
    }
    set.build(r.root);
  }
  // El charco de luz de cada farol lo pinta el shader del piso (render/groundLights.js).
  return handledStreet;
}

function buildPoles(r, poles, cables) {
  const ta = propTemplate('poste_a');
  const tb = propTemplate('poste_b');
  if (!ta || !poles.length) return false;
  const rng = makeRng(313);
  const H = 9;
  const variant = new Map();
  const setA = new ChunkedInstances(ta, { near: propNear(r), far: Math.min(r.quality?.drawDistance ?? 1500, 450), name: 'postes', refs: r.propInstances });
  const setB = tb ? new ChunkedInstances(tb, { near: propNear(r), far: Math.min(r.quality?.drawDistance ?? 1500, 450), name: 'postes-transformador', refs: r.propInstances }) : null;
  for (const p of poles) {
    const useB = setB && rng.chance(0.3);
    const tpl = useB ? tb : ta;
    const k = H / tpl.height;
    // Crucetas perpendiculares a la carrera (los cables corren en Z).
    const rot = rng.chance(0.5) ? 0 : Math.PI;
    (useB ? setB : setA).add(p.x, groundY(p.x, p.z) - 0.1, p.z, rot, k, k, k, null, null, p);
    variant.set(p, { tpl, k });
  }
  setA.build(r.root, r.lodChunks);
  setB?.build(r.root, r.lodChunks);
  // Cables con catenaria entre los aisladores de postes vecinos.
  const pts = [];
  const anchorsOf = (p) => {
    const { tpl, k } = variant.get(p);
    const a = tpl.extras.cables ?? [[-0.6, 5.7], [0, 6.05], [0.6, 5.7]];
    const list = a.map(([x, y]) => [x * k, y * k - 0.1]);
    // Cable más bajo (teléfono/TV) del lado de la calle.
    list.push([0.25, list[1][1] * 0.72]);
    return list;
  };
  // Cada tramo recuerda dónde quedaron sus vértices: si se tumba un poste,
  // sus cables bajan con él (render/destructibles.js los vuelve a tender).
  const tramos = r.poleCables;
  for (const c of cables) {
    const A = anchorsOf(c.a);
    const B = anchorsOf(c.b);
    if (tramos) {
      const t = { a: c.a, b: c.b, start: pts.length / 3, A, B, n: 10 };
      for (const p of [c.a, c.b]) {
        const l = tramos.get(p);
        if (l) l.push(t);
        else tramos.set(p, [t]);
      }
    }
    const ya = groundY(c.a.x, c.a.z);
    const yb = groundY(c.b.x, c.b.z);
    for (let j = 0; j < A.length; j++) {
      const n = 10;
      const sag = (t) => -1.1 * 4 * t * (1 - t);
      for (let s = 0; s < n; s++) {
        for (const t of [s / n, (s + 1) / n]) {
          const ox = A[j][0] + (B[j][0] - A[j][0]) * t;
          const y = ya + A[j][1] + (yb + B[j][1] - ya - A[j][1]) * t + sag(t);
          pts.push(c.a.x + ox + (c.b.x - c.a.x) * t, y, c.a.z + (c.b.z - c.a.z) * t);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const lines = wireLines(g, 0x1c1c1c);
  lines.name = 'cables';
  // Sus vértices se vuelven a escribir cuando se tumba un poste: no se sueltan.
  lines.userData.keepGeometry = true;
  r.cableLines = lines;
  r.root.add(lines);
  return true;
}

function buildBenches(r, benches) {
  const tpl = propTemplate('banca');
  if (!tpl || !benches.length) return false;
  const set = new ChunkedInstances(tpl, { near: 400, far: 500, name: 'bancas' });
  // El modelo mira a -Z; en el juego el frente de la banca es +Z.
  for (const b of benches) set.add(b.x, groundY(b.x, b.z), b.z, (b.rot ?? 0) + Math.PI, 1.5);
  set.build(r.root);
  return true;
}

// Utilería nueva: modelo o caja de respaldo, distancia de dibujo y giro base.
const SMALL = {
  chair: { model: 'silla_plastica', fb: [0.5, 0.85, 0.5, 0xf2f2ee], far: 110, rot: 0, tint: true },
  crate: { model: 'canasta', fb: [0.5, 0.26, 0.4, 0xd9a520], far: 110, rot: 0 },
  trashcan: { model: 'caneca', fb: [0.6, 0.9, 0.6, 0x3d4a3a, true], far: 150, rot: 0 },
  trashbag: { model: 'bolsa_basura', fb: [0.5, 0.5, 0.45, 0x111111], far: 110, rot: 0 },
  planter: { model: 'matera', fb: [0.5, 0.6, 0.5, 0xa0522d, true], far: 120, rot: 0 },
  barrier: { model: 'barrera', fb: [1.5, 0.8, 0.6, 0xb8b4ab], far: 200, rot: 0 },
  hydrant: { model: 'hidrante', fb: [0.25, 0.8, 0.25, 0xc0302a, true], far: 150, rot: 0 },
  manhole: { model: 'alcantarilla', fb: [0.7, 0.02, 0.7, 0x2a2a2a, true], far: 90, rot: 0, shadow: false },
};

function buildSmallProps(r, byType) {
  for (const [type, cfg] of Object.entries(SMALL)) {
    const list = byType[type];
    if (!list?.length) continue;
    const tpl = propTemplate(cfg.model) ?? boxTemplate(cfg.model, cfg.fb[0], cfg.fb[1], cfg.fb[2], cfg.fb[3], { cylinder: !!cfg.fb[4] });
    const set = new ChunkedInstances(tpl, {
      near: cfg.far,
      far: cfg.far,
      castShadow: cfg.shadow !== false,
      tint: cfg.tint ? () => true : null,
      name: `utileria-${type}`,
      perInstance: true,
    });
    const lodChunks = r.lodChunks;
    const col = new THREE.Color();
    for (const p of list) {
      const s = p.s ?? 1;
      if (type === 'manhole') {
        // A ras del asfalto y siguiendo la pendiente de la calle.
        const q = slopeQuat(p.x, p.z, p.rot ?? 0, new THREE.Quaternion());
        set.add(p.x, terrainHeight(p.x, p.z) + 0.03 - tpl.height * 0.55, p.z, p.rot ?? 0, 1, 1, 1, null, q);
        continue;
      }
      const y = p.y ?? groundY(p.x, p.z);
      if (type === 'crate') {
        const h = tpl.height;
        for (let k = 0; k < (p.stack ?? 1); k++) set.add(p.x, y + k * h * 0.98, p.z, p.rot + (k % 2) * 0.08, s);
        continue;
      }
      set.add(p.x, y, p.z, (p.rot ?? 0) + cfg.rot, s, s, s, p.color ? col.set(p.color) : null);
    }
    set.build(r.root, lodChunks);
  }
}

/**
 * Punto de entrada desde CityRenderer._props(). Dibuja con modelos los tipos
 * disponibles y devuelve lo que debe seguir siendo procedural.
 */
export function buildModelProps(r, byType, { glowSprite }) {
  // Instancias de la utilería que se puede tumbar (render/destructibles.js):
  // objeto de la ciudad → instancia, cabeza de farol y tramos de cable.
  r.propInstances ??= new Map();
  r.propLights ??= new Map();
  r.poleCables ??= new Map();
  // Vegetación (vegetation.js): árboles, matas en los jardines y los props
  // sueltos shrub / grass / climber. Devuelve los árboles sin modelo.
  const trees = buildVegetation(r, byType.tree ?? [], (byType.garden ?? []).filter((g) => g.poly), [...(byType.shrub ?? []), ...(byType.grass ?? []), ...(byType.climber ?? [])]);
  const lamps = buildLamps(r, byType.lamp ?? [], byType.parkLamp ?? [], glowSprite);
  const poles = buildPoles(r, byType.pole ?? [], byType.cable ?? []);
  const benches = buildBenches(r, byType.bench ?? []);
  buildSmallProps(r, byType);
  return { trees, lamps, poles, benches };
}

