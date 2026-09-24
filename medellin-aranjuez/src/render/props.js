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

const CHUNK = 140; // lado (m) de cada trozo de ciudad

// Especies del barrio: modelo, altura base (m), factor de ancho de copa y
// color del follaje (el atlas de hojas es casi gris y se tiñe por instancia).
const SPECIES = {
  guayacan: { model: 'arbol_copa_ancha', h: 8.5, w: 0.85, color: '#f2c230', jitter: 0.06 },
  guayacanRosado: { model: 'arbol_copa_ancha', h: 8.5, w: 0.85, color: '#e78fb3', jitter: 0.06 },
  ceiba: { model: 'arbol_copa_ancha', h: 13, w: 1.05, color: '#6f9a45', jitter: 0.08 },
  mango: { model: 'arbol_copa_redonda', h: 7.2, w: 1.15, color: '#4f7f36', jitter: 0.1 },
  ficus: { model: 'arbol_copa_redonda', h: 6.2, w: 1.0, color: '#6a9444', jitter: 0.1 },
};

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
  const gltf = assets.gltf(`utileria/${key}`);
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
 * Conjunto de instancias de una plantilla repartidas en trozos de ciudad.
 * Cada trozo es un THREE.LOD: modelo completo cerca, versión reducida lejos
 * (si la hay) y nada más allá de `far`.
 */
class ChunkedInstances {
  constructor(tpl, { near = 140, far = 1500, castShadow = true, receiveShadow = true, tint = null, name = 'utileria' } = {}) {
    this.tpl = tpl;
    this.items = [];
    this.opts = { near, far, castShadow, receiveShadow, tint, name };
  }

  /** q: cuaternión opcional (ya incluye la rotación en Y). */
  add(x, y, z, rotY, sx = 1, sy = sx, sz = sx, color = null, q = null) {
    this.items.push({ x, y, z, rotY, sx, sy, sz, color: color ? color.clone() : null, q: q ? q.clone() : null });
  }

  build(root) {
    if (!this.items.length) return [];
    const chunks = new Map();
    for (const it of this.items) {
      const k = `${Math.floor(it.x / CHUNK)},${Math.floor(it.z / CHUNK)}`;
      if (!chunks.has(k)) chunks.set(k, []);
      chunks.get(k).push(it);
    }
    const lods = [];
    for (const list of chunks.values()) {
      const c = new THREE.Vector3();
      for (const it of list) c.add(_v.set(it.x, it.y, it.z));
      c.divideScalar(list.length);
      const lod = new THREE.LOD();
      lod.name = this.opts.name;
      lod.position.copy(c);
      lod.addLevel(this._level(this.tpl.cerca, list, c), 0);
      if (this.tpl.lejos) lod.addLevel(this._level(this.tpl.lejos, list, c), this.opts.near);
      lod.addLevel(new THREE.Object3D(), this.opts.far);
      root.add(lod);
      lods.push(lod);
    }
    return lods;
  }

  _level(parts, list, c) {
    const g = new THREE.Group();
    const col = new THREE.Color();
    for (const part of parts) {
      const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
      const tinted = this.opts.tint && this.opts.tint(part.material);
      list.forEach((it, i) => {
        if (it.q) _q.copy(it.q);
        else _q.setFromAxisAngle(_up, it.rotY);
        _m.compose(_v.set(it.x - c.x, it.y - c.y, it.z - c.z), _q, _s.set(it.sx, it.sy, it.sz));
        im.setMatrixAt(i, _m);
        if (tinted) im.setColorAt(i, it.color ? col.copy(it.color) : col.setRGB(1, 1, 1));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = this.opts.castShadow;
      im.receiveShadow = this.opts.receiveShadow;
      im.computeBoundingSphere();
      g.add(im);
    }
    return g;
  }
}

// ------------------------------------------------------------------ utilidades

const groundY = (x, z) => terrainHeight(x, z) + GRID.curb;

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

function buildTrees(r, trees) {
  const rng = makeRng(77);
  const leftovers = [];
  const sets = new Map();
  const col = new THREE.Color();
  const near = r.quality?.drawDistance >= 2500 ? 160 : r.quality?.drawDistance >= 1500 ? 120 : 90;
  for (const t of trees) {
    const sp = SPECIES[t.kind];
    const tpl = sp && propTemplate(sp.model);
    if (!tpl) {
      leftovers.push(t);
      continue;
    }
    if (!sets.has(sp.model)) {
      const isLeaf = (m) => m.name === 'follaje' || m.alphaTest > 0;
      for (const p of [...tpl.cerca, ...(tpl.lejos ?? [])]) {
        if (!isLeaf(p.material)) continue;
        p.material.vertexColors = true;
        p.material.alphaTest = Math.max(0.35, p.material.alphaTest);
        p.material.side = THREE.FrontSide;
      }
      sets.set(sp.model, new ChunkedInstances(tpl, { near, far: r.quality?.drawDistance ?? 1500, tint: isLeaf, name: `arboles-${sp.model}` }));
    }
    const sc = t.scale ?? 1;
    const k = (sp.h * sc) / tpl.height;
    // Árboles de andén (colisión delgada): copa algo más angosta.
    const street = t.collider && t.collider.hx <= 0.25;
    const w = sp.w * (street ? 0.78 : 1) * rng.range(0.92, 1.08);
    const y = terrainHeight(t.x, t.z) + (t.onBlock === false ? 0 : GRID.curb) - 0.08;
    col.set(sp.color).offsetHSL(rng.range(-0.015, 0.015), rng.range(-sp.jitter, sp.jitter) * 0.5, rng.range(-sp.jitter, sp.jitter));
    sets.get(sp.model).add(t.x, y, t.z, rng.next() * Math.PI * 2, k * w, k, k * w, col);
  }
  for (const s of sets.values()) s.build(r.root);
  return leftovers;
}

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
    const set = new ChunkedInstances(tpl, { near: 95, far: r.quality?.drawDistance ?? 1500, name: 'faroles' });
    for (const l of lamps) {
      set.add(l.x, groundY(l.x, l.z) - 0.05, l.z, l.rot);
      const dx = Math.sin(l.rot) * luz[2];
      const dz = Math.cos(l.rot) * luz[2];
      glows.push({ x: l.x + dx, z: l.z + dz, s: 1 });
    }
    set.build(r.root);
    handledStreet = true;
  }
  if (parkLamps.length) {
    const t = ptpl ?? boxTemplate('farol_parque', 0.18, 4, 0.18, 0x1c1f22, { cylinder: true });
    if (ptpl) lampMaterials(ptpl, r.nightMaterials, 3);
    const k = ptpl ? 4.4 / ptpl.height : 1;
    const set = new ChunkedInstances(t, { near: 400, far: 700, name: 'faroles-parque' });
    for (const l of parkLamps) {
      set.add(l.x, groundY(l.x, l.z), l.z, l.rot ?? 0, k);
      glows.push({ x: l.x, z: l.z, s: 0.6 });
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
  const setA = new ChunkedInstances(ta, { near: 100, far: r.quality?.drawDistance ?? 1500, name: 'postes' });
  const setB = tb ? new ChunkedInstances(tb, { near: 100, far: r.quality?.drawDistance ?? 1500, name: 'postes-transformador' }) : null;
  for (const p of poles) {
    const useB = setB && rng.chance(0.3);
    const tpl = useB ? tb : ta;
    const k = H / tpl.height;
    // Crucetas perpendiculares a la carrera (los cables corren en Z).
    const rot = rng.chance(0.5) ? 0 : Math.PI;
    (useB ? setB : setA).add(p.x, groundY(p.x, p.z) - 0.1, p.z, rot, k);
    variant.set(p, { tpl, k });
  }
  setA.build(r.root);
  setB?.build(r.root);
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
  const trees = buildTrees(r, byType.tree ?? []);
  const lamps = buildLamps(r, byType.lamp ?? [], byType.parkLamp ?? [], glowSprite);
  const poles = buildPoles(r, byType.pole ?? [], byType.cable ?? []);
  const benches = buildBenches(r, byType.bench ?? []);
  buildSmallProps(r, byType);
  return { trees, lamps, poles, benches };
}
