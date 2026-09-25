// Vegetación de Medellín: árboles, palmas, arbustos, pasto y enredaderas con
// modelos glTF (scripts/assets/vegetacion.mjs → public/models/vegetacion; ver
// ASSETS-CREDITS.md). Se dibujan con las mismas instancias por trozos de
// props.js (ChunkedInstances): una InstancedMesh por material y especie en
// cada trozo, con nivel de detalle por instancia (cerca / lejos).
//
// Entrada principal: buildVegetation(renderer, trees, gardens, extra).

import * as THREE from 'three';
import { registerAssets } from './assetManifest.js';
import { ChunkedInstances, propTemplate } from './props.js';
import { GRID, terrainHeight } from '../sim/terrain.js';
import { makeRng } from '../sim/rng.js';
import { pointInPoly, polyArea } from '../sim/geom2d.js';

// Vegetación de Medellín (scripts/assets/vegetacion.mjs → public/models/vegetacion).
export const VEG_MODELS = [
  'palma_coco', 'palma_real', 'palma_areca', 'guadua', 'arbol_saman', 'arbol_mango', 'arbol_aguacate', 'arbol_guayabo', 'platano',
  'croton', 'heliconia', 'helecho', 'monstera', 'seto', 'buganvilia', 'pasto', 'maleza', 'enredadera',
];

registerAssets(VEG_MODELS.map((k) => ({ key: `vegetacion/${k}`, type: 'gltf', url: `models/vegetacion/${k}.glb` })));

// Especies de árbol: modelo, altura base (m, se multiplica por prop.scale),
// factor de ancho de copa y color del follaje por instancia. Los modelos de
// utilería (arbol_copa_*) y el guayabo tienen el atlas de hojas casi gris y el
// color es el verde real; los de vegetación traen su textura verde y el color
// solo varía un poco el tono. Verde casi todo: los guayacanes son el acento.
const SPECIES = {
  guayacan: { model: 'arbol_copa_ancha', h: 8.5, w: 0.85, color: '#f2c230', jitter: 0.06 },
  guayacanRosado: { model: 'arbol_copa_ancha', h: 8.5, w: 0.85, color: '#e78fb3', jitter: 0.06 },
  ceiba: { model: 'arbol_copa_ancha', h: 13, w: 1.05, color: '#6f9a45', jitter: 0.08 },
  carbonero: { model: 'arbol_copa_ancha', h: 9, w: 1.15, color: '#5e8a3a', jitter: 0.08 },
  ficus: { model: 'arbol_copa_redonda', h: 6.2, w: 1.0, color: '#4a7a34', jitter: 0.08 },
  mango: { model: 'vegetacion/arbol_mango', h: 9, w: 1.0, color: '#e2efd2', jitter: 0.08 },
  aguacate: { model: 'vegetacion/arbol_aguacate', h: 10, w: 1.0, color: '#93ad7c', jitter: 0.07 },
  saman: { model: 'vegetacion/arbol_saman', h: 14, w: 1.0, color: '#dcebc8', jitter: 0.07 },
  guayabo: { model: 'vegetacion/arbol_guayabo', h: 5, w: 1.05, color: '#6c9a45', jitter: 0.08 },
  almendro: { model: 'vegetacion/arbol_guayabo', h: 8, w: 1.35, color: '#4f8a3c', jitter: 0.12 },
  palma: { model: 'vegetacion/palma_coco', h: 9, w: 1.0, color: '#eef6e4', jitter: 0.06 },
  palmaReal: { model: 'vegetacion/palma_real', h: 16, w: 0.9, color: '#d4e6c0', jitter: 0.05 },
  palmaAreca: { model: 'vegetacion/palma_areca', h: 3.5, w: 1.0, color: '#e6f2c8', jitter: 0.06 },
  platano: { model: 'vegetacion/platano', h: 4.5, w: 1.0, color: '#f2f8e6', jitter: 0.06 },
  guadua: { model: 'vegetacion/guadua', h: 13, w: 1.2, color: '#e8f2d2', jitter: 0.06 },
};

/**
 * Tipos de árbol que entiende props.js ({ type: 'tree', kind, x, z, scale?,
 * collider?, onBlock? }) y dónde se ven en Medellín, para el generador de ciudad.
 */
export const TREE_KINDS = {
  mango: 'Calle, patio y parque: el árbol de sombra más común del barrio (copa densa, oscura)',
  ficus: 'Andén y separador: ficus podado en copa redonda',
  saman: 'Parque, glorieta y avenida: copa enorme en sombrilla (dejar ~20 m libres)',
  carbonero: 'Calle y parque: copa extendida de hojas finas',
  almendro: 'Andén, parque y cancha: copa ancha en pisos',
  guayabo: 'Patio, solar y lote: árbol pequeño de tronco torcido',
  aguacate: 'Patio, solar y ladera: copa alta y oscura',
  ceiba: 'Parque y plaza: árbol monumental',
  palma: 'Parque, glorieta y separador: palma de coco',
  palmaReal: 'Avenida, separador y plaza: palma real alta de tronco gris',
  palmaAreca: 'Antejardín, entrada de casa y matera grande',
  platano: 'Patio, ladera y orilla de quebrada (en grupos de 2-5)',
  guadua: 'Orilla de quebrada y ladera: macizo de guadua (en grupos)',
  guayacan: 'Acento: calle y parque, florecido amarillo (poco)',
  guayacanRosado: 'Acento: calle y parque, florecido rosado (poco)',
};

// Arbustos ({ type: 'shrub', kind, x, z, rot?, scale?, len? }): h = altura (m),
// w = factor de ancho; el seto usa len (m) como largo a lo largo de rot.
const SHRUBS = {
  seto: { model: 'seto', h: 1.2, w: 1.0, color: '#e2f0d6', jitter: 0.06 },
  croton: { model: 'croton', h: 1.0, w: 0.5, color: '#ffffff', jitter: 0.05 },
  buganvilia: { model: 'buganvilia', h: 2.2, w: 1.0, color: '#ffffff', jitter: 0.05 },
  heliconia: { model: 'heliconia', h: 1.8, w: 0.55, color: '#e8f2dc', jitter: 0.06 },
  helecho: { model: 'helecho', h: 0.9, w: 0.8, color: '#dcebc8', jitter: 0.08 },
  monstera: { model: 'monstera', h: 1.1, w: 0.9, color: '#e8f2dc', jitter: 0.06 },
};

export const SHRUB_KINDS = {
  seto: 'Antejardín, separador y borde de parque: seto podado de swinglea (usar len)',
  croton: 'Antejardín y jardinera: crotos de colores',
  buganvilia: 'Contra muros, rejas y terrazas: buganvilia fucsia',
  heliconia: 'Jardín, Jardín Botánico y orilla de quebrada: heliconia / platanillo',
  helecho: 'Sombra, orilla de quebrada y Jardín Botánico: helecho',
  monstera: 'Antejardín y jardín sombreado: costilla de Adán',
};

/**
 * Pasto: { type: 'grass', x, z, r, density?, kind?: 'pasto'|'maleza', onBlock? }
 * reparte matas en un círculo de radio r (density = matas por m², 1,5 por
 * defecto). 'pasto' = bordes de prados y parques; 'maleza' = pasto alto de
 * lotes vacíos, laderas y orillas. Enredadera: { type: 'climber', x, z, rot,
 * w, h } sobre la cara de un muro que mira hacia rot (se reparte en tramos).
 */
export const GRASS_KINDS = { pasto: 'Prado, parque y borde de andén', maleza: 'Lote vacío, ladera, orilla de quebrada' };

// TEMPORAL (hasta que el generador nuevo use TREE_KINDS): reparte las especies
// que pide el generador actual (casi todo guayacanes) en el bosque verde de
// Medellín. Poner en false cuando cityLayout ya elija las especies.
const REMAP_ESPECIES_TEMPORAL = true;
const REMAP = {
  guayacan: [['guayacan', 2], ['mango', 3], ['carbonero', 2], ['almendro', 2], ['saman', 1], ['aguacate', 1], ['ficus', 1]],
  guayacanRosado: [['guayacanRosado', 2], ['mango', 3], ['carbonero', 2], ['almendro', 1], ['guayabo', 1], ['aguacate', 1], ['ficus', 2]],
  mango: [['mango', 4], ['aguacate', 1], ['guayabo', 1], ['saman', 1]],
  ficus: [['ficus', 3], ['almendro', 1], ['mango', 1]],
  palma: [['palma', 2], ['palmaReal', 2], ['palmaAreca', 1], ['platano', 1]],
  ceiba: [['ceiba', 1], ['saman', 2]],
};

/**
 * Follaje de doble cara: la cara trasera se ilumina con la misma normal que la
 * delantera (como una hoja translúcida), sin el volteo de three.js que la
 * dejaría oscura. Solo para los modelos de vegetación (doubleSided en el glTF).
 */
function foliageShading(m) {
  if (m.userData.follaje) return;
  m.userData.follaje = true;
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\n\tnormal *= faceDirection;\n#endif');
  };
  m.customProgramCacheKey = () => 'follaje-doble';
}

/** Prepara los materiales de hoja de una plantilla (una sola vez por modelo). */
function prepareLeaves(tpl) {
  const isLeaf = (m) => m.name === 'follaje' || m.alphaTest > 0;
  if (tpl._hojas) return isLeaf;
  tpl._hojas = true;
  for (const p of [...tpl.cerca, ...(tpl.lejos ?? [])]) {
    const m = p.material;
    if (!isLeaf(m)) continue;
    m.vertexColors = !!p.geometry.attributes.color;
    if (m.side === THREE.DoubleSide) {
      // Vegetación nueva: corte de alpha del autor y doble cara.
      m.alphaTest = Math.max(0.15, m.alphaTest || 0.3);
      foliageShading(m);
    } else {
      // Tarjetas con cara trasera propia (arbol_copa_*, guayabo, seto).
      m.alphaTest = Math.max(0.35, m.alphaTest);
      m.side = THREE.FrontSide;
    }
  }
  return isLeaf;
}

/** Especie efectiva de un árbol (con el reparto temporal, determinista por posición). */
function treeKind(t) {
  if (!REMAP_ESPECIES_TEMPORAL || t.keepKind || !REMAP[t.kind]) return t.kind;
  const opts = REMAP[t.kind];
  const total = opts.reduce((a, o) => a + o[1], 0);
  let h = Math.abs(Math.sin(t.x * 12.9898 + t.z * 78.233) * 43758.5453) % 1;
  h *= total;
  for (const [k, w] of opts) if ((h -= w) < 0) return k;
  return t.kind;
}

export function buildTrees(r, trees) {
  const rng = makeRng(77);
  const leftovers = [];
  const sets = new Map();
  const col = new THREE.Color();
  const near = r.quality?.treeNear ?? 70;
  for (const t of trees) {
    const sp = SPECIES[treeKind(t)] ?? SPECIES[t.kind];
    const tpl = sp && propTemplate(sp.model);
    if (!tpl) {
      leftovers.push(t);
      continue;
    }
    if (!sets.has(sp.model)) {
      const isLeaf = prepareLeaves(tpl);
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
  for (const s of sets.values()) s.build(r.root, r.lodChunks);
  return leftovers;
}

/** Arbustos: setos, crotos, buganvilias, heliconias, helechos y costillas de Adán. */
export function buildShrubs(r, shrubs) {
  if (!shrubs.length) return;
  const rng = makeRng(91);
  const sets = new Map();
  const col = new THREE.Color();
  const near = Math.round((r.quality?.treeNear ?? 70) * 0.6);
  const far = Math.max(160, (r.quality?.detailDraw ?? 120) * 2.5);
  for (const p of shrubs) {
    const sp = SHRUBS[p.kind] ?? SHRUBS.seto;
    const tpl = propTemplate(`vegetacion/${sp.model}`);
    if (!tpl) continue;
    if (!sets.has(sp.model)) {
      const isLeaf = prepareLeaves(tpl);
      sets.set(sp.model, new ChunkedInstances(tpl, { near, far, tint: isLeaf, name: `arbustos-${sp.model}` }));
    }
    const s = (p.scale ?? 1) * rng.range(0.9, 1.1);
    const k = (sp.h * s) / tpl.height;
    const y = p.y ?? terrainHeight(p.x, p.z) + (p.onBlock === false ? 0 : GRID.curb) - 0.04;
    col.set(sp.color).offsetHSL(0, 0, rng.range(-sp.jitter, sp.jitter));
    if (p.kind === 'seto') {
      // El modelo es un tramo de ~1,6 m a lo largo de X: se estira al largo pedido.
      const len = p.len ?? 1.6;
      const lx = tpl.box.max.x - tpl.box.min.x;
      const n = Math.max(1, Math.round(len / 2.4));
      const rot = p.rot ?? 0;
      for (let i = 0; i < n; i++) {
        const o = (i + 0.5) / n - 0.5;
        const x = p.x + Math.cos(rot) * o * len;
        const z = p.z - Math.sin(rot) * o * len;
        set(sets.get(sp.model), x, y, z, rot, (len / n / lx) * 1.12, k, k * (p.depth ?? 1));
      }
      continue;
    }
    set(sets.get(sp.model), p.x, y, p.z, p.rot ?? rng.next() * Math.PI * 2, k * sp.w, k, k * sp.w);
  }
  function set(ci, x, y, z, rot, sx, sy, sz) {
    ci.add(x, y, z, rot, sx, sy, sz, col);
  }
  for (const s of sets.values()) s.build(r.root, r.lodChunks);
}

/** Matas de pasto y maleza en parches circulares (trozos pequeños y cortos de distancia). */
export function buildGrass(r, patches) {
  if (!patches.length || (r.quality?.detailDraw ?? 120) < 60) return;
  const far = Math.round((r.quality?.detailDraw ?? 120) * 0.9);
  const sets = {};
  const col = new THREE.Color();
  for (const p of patches) {
    const kind = p.kind === 'maleza' || p.tall ? 'maleza' : 'pasto';
    const tpl = propTemplate(`vegetacion/${kind}`);
    if (!tpl) continue;
    if (!sets[kind]) {
      const isLeaf = prepareLeaves(tpl);
      sets[kind] = new ChunkedInstances(tpl, { near: far, far, castShadow: false, tint: isLeaf, name: `pasto-${kind}`, chunk: 48 });
    }
    const rng = makeRng(Math.floor(Math.abs(p.x * 73.1 + p.z * 19.7)) + 5);
    const R = p.r ?? 3;
    const n = Math.min(600, Math.round((p.density ?? 1.5) * Math.PI * R * R * (kind === 'maleza' ? 0.6 : 1)));
    for (let i = 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2;
      const d = Math.sqrt(rng.next()) * R;
      const x = p.x + Math.cos(a) * d;
      const z = p.z + Math.sin(a) * d;
      if (p.blocked?.(x, z)) continue;
      const y = terrainHeight(x, z) + (p.onBlock === false ? 0 : GRID.curb) - 0.03;
      const s = rng.range(0.75, 1.3) * (p.scale ?? 1);
      // Verde con matas más secas aquí y allá (pasto de ladera al sol).
      const dry = rng.chance(kind === 'maleza' ? 0.25 : 0.12);
      col.setRGB(dry ? 1.05 : 0.9, dry ? 0.95 : 1.05, dry ? 0.62 : 0.75).multiplyScalar(rng.range(0.85, 1.1));
      sets[kind].add(x, y, z, rng.next() * Math.PI * 2, s, s, s, col);
    }
  }
  for (const s of Object.values(sets)) s.build(r.root);
}

/** Enredaderas sobre muros: el modelo (2,5 × 2,9 m) se reparte en tramos a lo ancho. */
export function buildClimbers(r, climbers) {
  if (!climbers.length) return;
  const tpl = propTemplate('vegetacion/enredadera');
  if (!tpl) return;
  const isLeaf = prepareLeaves(tpl);
  const set = new ChunkedInstances(tpl, { near: Math.round((r.quality?.treeNear ?? 70) * 0.6), far: Math.max(200, (r.quality?.detailDraw ?? 120) * 2), castShadow: false, tint: isLeaf, name: 'enredaderas' });
  const rng = makeRng(123);
  const col = new THREE.Color();
  const W = tpl.box.max.x - tpl.box.min.x;
  const H = tpl.box.max.y - tpl.box.min.y;
  for (const c of climbers) {
    const w = c.w ?? 2.5;
    const n = Math.max(1, Math.round(w / W));
    const rot = c.rot ?? 0;
    const y = c.y ?? terrainHeight(c.x, c.z) + (c.onBlock === false ? 0 : GRID.curb);
    for (let i = 0; i < n; i++) {
      const o = ((i + 0.5) / n - 0.5) * w;
      const x = c.x + Math.cos(rot) * o;
      const z = c.z - Math.sin(rot) * o;
      const hh = (c.h ?? 3) * rng.range(0.8, 1.05);
      col.setRGB(0.95, 1, 0.92).multiplyScalar(rng.range(0.85, 1.05));
      set.add(x, y - 0.05, z, rot, (w / n / W) * 1.1, hh / H, 1, col);
    }
  }
  set.build(r.root, r.lodChunks);
}

// ------------------------------------------------------------------ jardines

const insidePoly = (poly, x, z) => pointInPoly(x, z, poly);

/**
 * Llena un jardín ({ type: 'garden', poly: [[x, z], ...], onBlock? }) con
 * matas de jardín y, en los bordes largos de jardines grandes, un seto bajo.
 * El prado del jardín ya lo dibuja cityRenderer; con g.grass = true se
 * añaden además matas de pasto 3D. Devuelve props sueltos (shrub / grass / tree).
 */
export function gardenPlants(g, seed = 0) {
  const poly = g.poly;
  if (!poly || poly.length < 3) return [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of poly) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const rng = makeRng(Math.floor(Math.abs(minX * 31.7 + minZ * 17.3)) + seed + 1);
  const area = Math.abs(polyArea(poly));
  const onBlock = g.onBlock;
  const out = [];
  const inset = (x, z, d) => insidePoly(poly, x, z) && insidePoly(poly, x + d, z) && insidePoly(poly, x - d, z) && insidePoly(poly, x, z + d) && insidePoly(poly, x, z - d);
  const pick = (list) => {
    let t = rng.next() * list.reduce((a, o) => a + o[1], 0);
    for (const [k, w] of list) if ((t -= w) < 0) return k;
    return list[0][0];
  };
  // Pasto 3D opcional: parches de ~2,5 m que cubren el jardín (recortados al polígono).
  const cell = 2.6;
  for (let x = minX + cell / 2; g.grass && x < maxX; x += cell) {
    for (let z = minZ + cell / 2; z < maxZ; z += cell) {
      const px = x + rng.range(-0.6, 0.6);
      const pz = z + rng.range(-0.6, 0.6);
      if (!insidePoly(poly, px, pz)) continue;
      out.push({ type: 'grass', kind: 'pasto', x: px, z: pz, r: cell * 0.75, density: g.grassDensity ?? 1.6, onBlock, blocked: (qx, qz) => !insidePoly(poly, qx, qz) });
    }
  }
  // Matas de jardín: una cada ~7 m² (mínimo 1), lejos del borde.
  const kinds = g.kinds ?? [['croton', 3], ['heliconia', 2], ['monstera', 2], ['helecho', 2], ['buganvilia', 1], ['palmaAreca', 1]];
  const n = Math.max(1, Math.round(area / 7));
  for (let k = 0, tries = 0; k < n && tries < n * 12; tries++) {
    const x = rng.range(minX, maxX);
    const z = rng.range(minZ, maxZ);
    if (!inset(x, z, 0.6)) continue;
    const kind = pick(kinds);
    if (kind === 'palmaAreca') out.push({ type: 'tree', kind, x, z, scale: rng.range(0.7, 1), onBlock, keepKind: true });
    else out.push({ type: 'shrub', kind, x, z, scale: rng.range(0.8, 1.15), onBlock });
    k++;
  }
  // Seto bajo en los bordes largos de jardines grandes.
  if (area > 40 && rng.chance(g.hedge ?? 0.45)) {
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i];
      const [bx, bz] = poly[(i + 1) % poly.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 4) continue;
      // Hacia adentro 0,5 m (probando ambos lados de la arista).
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const sgn = insidePoly(poly, mx + nx * 0.5, mz + nz * 0.5) ? 1 : -1;
      out.push({ type: 'shrub', kind: 'seto', x: mx + nx * 0.5 * sgn, z: mz + nz * 0.5 * sgn, rot: -Math.atan2(bz - az, bx - ax), len: len - 1.2, scale: 0.75, onBlock });
    }
  }
  return out;
}

/**
 * Punto de entrada para el renderizador de ciudad.
 *  - trees: props { type: 'tree', kind, x, z, scale?, collider?, onBlock? }
 *    (kind: ver TREE_KINDS; los desconocidos vuelven en la lista devuelta).
 *  - gardens: props { type: 'garden', poly: [[x, z], ...] } → pasto + matas.
 *  - extra: props sueltos { type: 'shrub' | 'grass' | 'climber', ... }.
 * Necesita r.root, r.lodChunks (y updatePropLod de props.js en cada cuadro)
 * y opcionalmente r.quality. Devuelve los árboles que no tienen modelo.
 */
export function buildVegetation(r, trees = [], gardens = [], extra = []) {
  r.lodChunks ??= [];
  const by = { tree: [...trees], shrub: [], grass: [], climber: [] };
  if ((r.quality?.detailDraw ?? 120) < 60) gardens = gardens.filter((g, i) => i % 2 === 0); // Baja: la mitad
  gardens.forEach((g, i) => {
    for (const p of gardenPlants(g, i)) by[p.type].push(p);
  });
  for (const p of extra) by[p.type]?.push(p);
  const leftovers = buildTrees(r, by.tree);
  buildShrubs(r, by.shrub);
  buildGrass(r, by.grass);
  buildClimbers(r, by.climber);
  r._lodAt = null;
  return leftovers;
}

/**
 * Dibuja una lista suelta de props de vegetación (árboles, arbustos, pasto,
 * enredaderas) sobre el renderizador de ciudad ya construido. Lo usa
 * scripts/vegetacion-escena.mjs para las capturas de prueba
 * (window.__vegetacion.build(window.__gameInstance.cityRenderer, props)).
 */
export function buildVegetationProps(r, props) {
  const by = {};
  for (const p of props) (by[p.type] ??= []).push({ keepKind: true, ...p });
  buildTrees(r, by.tree ?? []);
  buildShrubs(r, by.shrub ?? []);
  buildGrass(r, by.grass ?? []);
  buildClimbers(r, by.climber ?? []);
  r._lodAt = null;
}

if (typeof window !== 'undefined') window.__vegetacion = { build: buildVegetationProps, buildVegetation, TREE_KINDS, SHRUB_KINDS, GRASS_KINDS };
