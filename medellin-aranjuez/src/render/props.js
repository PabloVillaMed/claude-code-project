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
  constructor(group, center, radius, items, nearLevel, farLevel, near, far) {
    this.group = group;
    this.cx = center.x;
    this.cz = center.z;
    this.radius = radius;
    this.near = near;
    this.far = far;
    this.n = items.length;
    this.px = Float32Array.from(items, (it) => it.x);
    this.pz = Float32Array.from(items, (it) => it.z);
    this.levels = [nearLevel, farLevel];
    // Copia fija de las matrices/colores originales (fuente de las particiones).
    this.srcMatrix = nearLevel.matrix.array.slice();
    this.srcColor = nearLevel.color ? nearLevel.color.array.slice() : null;
    this.idx = [new Uint16Array(this.n), new Uint16Array(this.n)];
    this.mode = -1; // 0 = todo lejos, 1 = todo cerca, 2 = mezclado
  }

  update(x, z) {
    const d = Math.hypot(x - this.cx, z - this.cz);
    if (d - this.radius > this.far) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    if (d - this.radius > this.near) return this._all(0);
    if (d + this.radius < this.near) return this._all(1);
    this.mode = 2;
    const near2 = this.near * this.near;
    const [ni, fi] = this.idx;
    let kn = 0;
    let kf = 0;
    for (let i = 0; i < this.n; i++) {
      const dx = this.px[i] - x;
      const dz = this.pz[i] - z;
      if (dx * dx + dz * dz < near2) ni[kn++] = i;
      else fi[kf++] = i;
    }
    this._write(this.levels[0], ni, kn);
    this._write(this.levels[1], fi, kf);
  }

  _all(nearMode) {
    if (this.mode === nearMode) return;
    this.mode = nearMode;
    const all = this.idx[0];
    for (let i = 0; i < this.n; i++) all[i] = i;
    this._write(this.levels[nearMode ? 0 : 1], all, this.n);
    this._write(this.levels[nearMode ? 1 : 0], all, 0);
  }

  _write(level, idx, k) {
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

/**
 * Conjunto de instancias de una plantilla repartidas en trozos de ciudad.
 * Si la plantilla tiene versión reducida ('lejos'), cada instancia elige su
 * nivel según su distancia (LodChunk); si no, el trozo entero es un
 * THREE.LOD que desaparece más allá de `far`.
 */
export class ChunkedInstances {
  constructor(tpl, { near = 140, far = 1500, castShadow = true, receiveShadow = true, tint = null, name = 'utileria', chunk = CHUNK } = {}) {
    this.tpl = tpl;
    this.items = [];
    this.opts = { near, far, castShadow, receiveShadow, tint, name, chunk };
  }

  /** q: cuaternión opcional (ya incluye la rotación en Y). */
  add(x, y, z, rotY, sx = 1, sy = sx, sz = sx, color = null, q = null) {
    this.items.push({ x, y, z, rotY, sx, sy, sz, color: color ? color.clone() : null, q: q ? q.clone() : null });
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
      if (this.tpl.lejos && lodChunks) {
        let radius = 0;
        for (const it of list) radius = Math.max(radius, Math.hypot(it.x - c.x, it.z - c.z) + reach * Math.max(it.sx, it.sz));
        const g = new THREE.Group();
        g.name = this.opts.name;
        g.position.copy(c);
        const nearLevel = this._level(this.tpl.cerca, list, c, this.opts.castShadow);
        const farLevel = this._level(this.tpl.lejos, list, c, false);
        g.add(nearLevel.group, farLevel.group);
        root.add(g);
        const lc = new LodChunk(g, c, radius, list, nearLevel, farLevel, this.opts.near, this.opts.far);
        lc._all(0);
        lodChunks.push(lc);
        out.push(g);
        continue;
      }
      const lod = new THREE.LOD();
      lod.name = this.opts.name;
      lod.position.copy(c);
      lod.addLevel(this._level(this.tpl.cerca, list, c, this.opts.castShadow).group, 0);
      if (this.tpl.lejos) lod.addLevel(this._level(this.tpl.lejos, list, c, false).group, this.opts.near);
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
    const tinted = this.opts.tint && parts.some((p) => this.opts.tint(p.material));
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
      if (color && this.opts.tint(part.material)) im.instanceColor = color;
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
    }
  }
  return out;
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
    const set = new ChunkedInstances(tpl, { near: propNear(r), far: r.quality?.drawDistance ?? 1500, name: 'faroles' });
    r.lampHeads ??= [];
    for (const l of lamps) {
      set.add(l.x, groundY(l.x, l.z) - 0.05, l.z, l.rot);
      const dx = Math.sin(l.rot) * luz[2];
      const dz = Math.cos(l.rot) * luz[2];
      glows.push({ x: l.x + dx, z: l.z + dz, s: 1 });
      r.lampHeads.push({ x: l.x + dx, y: groundY(l.x, l.z) + luz[1] - 0.3, z: l.z + dz });
    }
    set.build(r.root, r.lodChunks);
    handledStreet = true;
  }
  if (parkLamps.length) {
    const t = ptpl ?? boxTemplate('farol_parque', 0.18, 4, 0.18, 0x1c1f22, { cylinder: true });
    if (ptpl) lampMaterials(ptpl, r.nightMaterials, 3);
    const k = ptpl ? 4.4 / ptpl.height : 1;
    const set = new ChunkedInstances(t, { near: 400, far: 700, name: 'faroles-parque' });
    r.lampHeads ??= [];
    for (const l of parkLamps) {
      set.add(l.x, groundY(l.x, l.z), l.z, l.rot ?? 0, k);
      glows.push({ x: l.x, z: l.z, s: 0.6 });
      r.lampHeads.push({ x: l.x, y: groundY(l.x, l.z) + 4.1, z: l.z, park: true });
    }
    set.build(r.root);
  }
  if (glows.length && handledStreet) {
    // Charco de luz falso en el piso (el mismo truco de la versión procedural).
    const glowGeo = new THREE.PlaneGeometry(11, 11).rotateX(-Math.PI / 2);
    const glowMat = new THREE.MeshBasicMaterial({ map: glowSprite(), color: 0xffb865, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4 });
    const gm = new THREE.InstancedMesh(glowGeo, glowMat, glows.length);
    glows.forEach((g, i) => {
      _m.compose(_v.set(g.x, terrainHeight(g.x, g.z) + 0.08, g.z), _q.identity(), _s.set(g.s, 1, g.s));
      gm.setMatrixAt(i, _m);
    });
    gm.computeBoundingSphere();
    r.root.add(gm);
    r.lampGlow = glowMat;
  }
  return handledStreet;
}

function buildPoles(r, poles, cables) {
  const ta = propTemplate('poste_a');
  const tb = propTemplate('poste_b');
  if (!ta || !poles.length) return false;
  const rng = makeRng(313);
  const H = 9;
  const variant = new Map();
  const setA = new ChunkedInstances(ta, { near: propNear(r), far: r.quality?.drawDistance ?? 1500, name: 'postes' });
  const setB = tb ? new ChunkedInstances(tb, { near: propNear(r), far: r.quality?.drawDistance ?? 1500, name: 'postes-transformador' }) : null;
  for (const p of poles) {
    const useB = setB && rng.chance(0.3);
    const tpl = useB ? tb : ta;
    const k = H / tpl.height;
    // Crucetas perpendiculares a la carrera (los cables corren en Z).
    const rot = rng.chance(0.5) ? 0 : Math.PI;
    (useB ? setB : setA).add(p.x, groundY(p.x, p.z) - 0.1, p.z, rot, k);
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
  for (const c of cables) {
    const A = anchorsOf(c.a);
    const B = anchorsOf(c.b);
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
  r.root.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x151515 })));
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
    });
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
    set.build(r.root);
  }
}

/**
 * Punto de entrada desde CityRenderer._props(). Dibuja con modelos los tipos
 * disponibles y devuelve lo que debe seguir siendo procedural.
 */
export function buildModelProps(r, byType, { glowSprite }) {
  // Vegetación (vegetation.js): árboles, matas en los jardines y los props
  // sueltos shrub / grass / climber. Devuelve los árboles sin modelo.
  const trees = buildVegetation(r, byType.tree ?? [], (byType.garden ?? []).filter((g) => g.poly), [...(byType.shrub ?? []), ...(byType.grass ?? []), ...(byType.climber ?? [])]);
  const lamps = buildLamps(r, byType.lamp ?? [], byType.parkLamp ?? [], glowSprite);
  const poles = buildPoles(r, byType.pole ?? [], byType.cable ?? []);
  const benches = buildBenches(r, byType.bench ?? []);
  buildSmallProps(r, byType);
  return { trees, lamps, poles, benches };
}

