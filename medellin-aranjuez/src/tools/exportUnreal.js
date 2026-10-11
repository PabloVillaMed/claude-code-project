// Exporta el mundo para Unreal Engine (ver medellin-unreal/LEEME.md).
//
// Se carga solo bajo demanda (window.__game.exportarUnreal, en modo de
// pruebas): nada de esto entra al juego normal.
//
// Salida (archivos en memoria, los recoge scripts/exportar-unreal.mjs):
//   mundo/<material>_<tile>.glb  geometría fija de la ciudad (terreno, calles,
//                                manzanas, edificios, metro) con los vértices ya
//                                en coordenadas del mundo, fusionada por
//                                material y por cuadros de 200 m (nodos en el
//                                origen: en Unreal todo va en 0,0,0).
//   plantillas/<nombre>.glb      un modelo por cada utilería repetida (sillas,
//                                árboles, faroles...) en su espacio local.
//   instancias.json              dónde va cada copia de cada plantilla
//                                (matrices 4x4 de three.js, metros, Y arriba).
//   calibracion.glb              tres cubitos en +X, +Y, +Z a 10 m: el script
//                                de Unreal los mide para saber cómo convierte
//                                los ejes su importador de glTF.
//   puntos.json                  lugares de interés, aparición del jugador,
//                                sillas y venteros (para la jugabilidad).
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const TILE = 200; // m

const _n = new THREE.Matrix3();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

async function glb(root) {
  const out = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false, maxTextureSize: 2048 });
  return new Uint8Array(out);
}

const slug = (s) =>
  String(s || 'sin_nombre')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'sin_nombre';

/** Material estándar simple (lo que glTF entiende) a partir del del juego. */
const matCache = new Map();
function plainMaterial(m) {
  if (matCache.has(m)) return matCache.get(m);
  const p = new THREE.MeshStandardMaterial({
    // "_vc": usa color de vértice (el script de Unreal le pone M_ColorVertice).
    name: (m.name || m.type) + (m.vertexColors ? '_vc' : ''),
    color: m.color ? m.color.clone() : new THREE.Color(1, 1, 1),
    map: usableTexture(m.map),
    roughness: m.roughness ?? 0.8,
    metalness: m.metalness ?? 0,
    emissive: m.emissive ? m.emissive.clone() : new THREE.Color(0, 0, 0),
    emissiveMap: usableTexture(m.emissiveMap),
    transparent: !!m.transparent,
    opacity: m.opacity ?? 1,
    alphaTest: m.alphaTest ?? 0,
    side: m.side ?? THREE.FrontSide,
    vertexColors: !!m.vertexColors,
  });
  matCache.set(m, p);
  return p;
}

/** Solo texturas con imagen que el exportador pueda dibujar (no comprimidas). */
function usableTexture(t) {
  if (!t || t.isCompressedTexture || t.isRenderTargetTexture) return null;
  const img = t.image;
  if (!img) return null;
  if (t.isDataTexture) return img.data && img.width && img.height ? t : null;
  return img.width > 0 && img.height > 0 ? t : null;
}

const GET = ['getX', 'getY', 'getZ', 'getW'];
/** Componente k del vértice i (sirve con atributos cuantizados e intercalados). */
const comp = (a, i, k) => a[GET[k]](i);

/** Copia "plana" (sin índices, Float32) con la matriz aplicada; solo posición, normal, uv y color. */
function flatten(geo, matrix, range, withColor) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const start = range ? range.start : 0;
  const count = Math.min(range ? range.count : Infinity, src.attributes.position.count - start);
  if (!(count > 0)) return null;
  const g = new THREE.BufferGeometry();
  const copy = (name, size, fill) => {
    const a = src.attributes[name];
    const arr = new Float32Array(count * size);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < size; k++) arr[i * size + k] = a ? comp(a, start + i, k) : fill[k];
    }
    return arr;
  };
  const pos = copy('position', 3, [0, 0, 0]);
  for (let i = 0; i < count; i++) {
    _v.fromArray(pos, i * 3).applyMatrix4(matrix).toArray(pos, i * 3);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (src.attributes.normal) {
    const nor = copy('normal', 3, [0, 1, 0]);
    _n.getNormalMatrix(matrix);
    for (let i = 0; i < count; i++) _v.fromArray(nor, i * 3).applyMatrix3(_n).normalize().toArray(nor, i * 3);
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  } else g.computeVertexNormals();
  g.setAttribute('uv', new THREE.BufferAttribute(copy('uv', 2, [0, 0]), 2));
  if (withColor) {
    const c = src.attributes.color;
    const size = c ? Math.min(c.itemSize, 3) : 3;
    const arr = new Float32Array(count * 3).fill(1);
    if (c) for (let i = 0; i < count; i++) for (let k = 0; k < size; k++) arr[i * 3 + k] = comp(c, start + i, k);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  // Espejo (escala negativa): se voltean los triángulos para que no queden al revés.
  if (matrix.determinant() < 0) {
    for (const a of Object.values(g.attributes)) {
      const arr = a.array;
      const n = a.itemSize;
      for (let t = 0; t + 2 < count; t += 3) {
        for (let k = 0; k < n; k++) {
          const i1 = (t + 1) * n + k;
          const i2 = (t + 2) * n + k;
          [arr[i1], arr[i2]] = [arr[i2], arr[i1]];
        }
      }
    }
  }
  if (src !== geo) src.dispose();
  return g;
}

/** Piezas {geo, mat} de una malla (una por grupo si tiene varios materiales). */
function pieces(mesh, matrix) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const geo = mesh.geometry;
  const out = [];
  if (Array.isArray(mesh.material) && geo.groups.length) {
    for (const gr of geo.groups) {
      const m = mats[gr.materialIndex ?? 0];
      if (!exportableMaterial(m)) continue;
      const g = flatten(geo, matrix, gr, !!m.vertexColors);
      if (g) out.push({ geo: g, mat: m });
    }
  } else if (exportableMaterial(mats[0])) {
    const g = flatten(geo, matrix, null, !!mats[0].vertexColors);
    if (g) out.push({ geo: g, mat: mats[0] });
  }
  return out;
}

function exportableMaterial(m) {
  if (!m || m.isShaderMaterial || m.isRawShaderMaterial || m.isLineBasicMaterial || m.isPointsMaterial || m.isSpriteMaterial) return false;
  if (m.blending === THREE.AdditiveBlending) return false; // brillos de faroles, halos
  if (m.visible === false || m.colorWrite === false) return false;
  return true;
}

/**
 * Recorre la ciudad: mallas fijas (para fusionar) e instancias (por plantilla).
 * Solo el nivel de detalle más cercano de cada LOD.
 */
function collect(cityRenderer) {
  const root = cityRenderer.root;
  root.updateMatrixWorld(true);
  // Mallas instanciadas de los trozos con detalle por instancia (props.js).
  const chunkOf = new Map(); // InstancedMesh -> LodChunk (nivel cercano)
  const skip = new Set(); // mallas de niveles lejanos
  for (const lc of cityRenderer.lodChunks ?? []) {
    lc.levels.forEach((lv, i) => {
      for (const im of lv.meshes) (i === 0 ? chunkOf.set(im, lc) : skip.add(im));
    });
  }
  const fixed = [];
  const sets = new Map(); // clave de plantilla -> {name, parts, matrices[], colors[]}
  const addInstances = (im, name, matrices, colors) => {
    const key = im.parent ? [...im.parent.children].filter((c) => c.isInstancedMesh).map((c) => c.geometry.uuid).join('|') : im.geometry.uuid;
    let s = sets.get(key);
    if (!s) {
      const parts = (im.parent ? [...im.parent.children] : [im]).filter((c) => c.isInstancedMesh && exportableMaterial(c.material));
      sets.set(key, (s = { name, parts: parts.map((c) => ({ geo: c.geometry, mat: c.material })), matrices: [], colors: [], seen: new Set() }));
    }
    // Las partes de una misma plantilla comparten matrices: se cuentan una vez por grupo.
    const owner = im.parent ?? im;
    if (s.seen.has(owner)) return;
    s.seen.add(owner);
    for (let i = 0; i < matrices.length; i++) {
      s.matrices.push(matrices[i]);
      s.colors.push(colors?.[i] ?? null);
    }
  };
  const visit = (o, insideFar) => {
    if (insideFar || skip.has(o)) return;
    if (o.isLOD) {
      if (o.levels[0]) visit(o.levels[0].object, false);
      return;
    }
    if (o.isInstancedMesh) {
      const lc = chunkOf.get(o);
      const name = lc ? lc.group.name : o.parent?.parent?.name || o.parent?.name || o.name || 'instancias';
      const mats = [];
      const cols = [];
      if (lc) {
        const parentM = o.matrixWorld; // incluye la posición del trozo
        for (let i = 0; i < lc.n; i++) {
          _m.fromArray(lc.srcMatrix, i * 16);
          mats.push(new THREE.Matrix4().multiplyMatrices(parentM, _m));
          cols.push(lc.srcColor ? [lc.srcColor[i * 3], lc.srcColor[i * 3 + 1], lc.srcColor[i * 3 + 2]] : null);
        }
      } else {
        const n = o.instanceMatrix.count;
        for (let i = 0; i < n; i++) {
          o.getMatrixAt(i, _m);
          mats.push(new THREE.Matrix4().multiplyMatrices(o.matrixWorld, _m));
          if (o.instanceColor) cols.push([o.instanceColor.getX(i), o.instanceColor.getY(i), o.instanceColor.getZ(i)]);
        }
      }
      addInstances(o, name, mats, cols);
      return;
    }
    if (o.isMesh && !o.isSkinnedMesh && o.geometry?.attributes?.position) fixed.push(o);
    for (const c of o.children) visit(c, false);
  };
  visit(root, false);
  return { fixed, sets };
}

/** Exporta todo. Devuelve Map(nombre de archivo -> Uint8Array). */
export async function exportarUnreal(game, { log = () => {} } = {}) {
  const files = new Map();
  const enc = new TextEncoder();
  const { fixed, sets } = collect(game.cityRenderer);
  log(`mallas fijas: ${fixed.length}, plantillas: ${sets.size}`);

  // 1. Mundo: piezas fusionadas por material y cuadro.
  const buckets = new Map();
  for (const mesh of fixed) {
    for (const { geo, mat } of pieces(mesh, mesh.matrixWorld)) {
      geo.computeBoundingBox();
      const c = geo.boundingBox.getCenter(_v);
      const key = `${mat.uuid}|${Math.floor(c.x / TILE)}_${Math.floor(c.z / TILE)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { mat, tile: key.split('|')[1], geos: [], name: mesh.name || mesh.parent?.name || '' }));
      b.geos.push(geo);
    }
  }
  const usedNames = new Set();
  let tris = 0;
  for (const b of buckets.values()) {
    const merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos);
    if (!merged) continue;
    tris += merged.attributes.position.count / 3;
    let name = `${slug(b.mat.name || b.name || 'material')}_${b.tile.replace('-', 'm')}`;
    while (usedNames.has(name)) name += '_b';
    usedNames.add(name);
    const mesh = new THREE.Mesh(merged, plainMaterial(b.mat));
    mesh.name = name;
    const scene = new THREE.Scene();
    scene.add(mesh);
    files.set(`mundo/${name}.glb`, await glb(scene));
    merged.dispose();
    for (const g of b.geos) g.dispose();
  }
  log(`mundo: ${buckets.size} piezas, ${Math.round(tris / 1000)} mil triángulos`);

  // 2. Plantillas e instancias.
  const inst = { unidades: 'metros', ejes: 'three.js (Y arriba, mano derecha)', matriz: 'columnas (Matrix4.elements)', plantillas: {} };
  const setNames = new Set();
  for (const s of sets.values()) {
    if (!s.matrices.length || !s.parts.length) continue;
    let name = slug(s.name);
    while (setNames.has(name)) name += '_b';
    setNames.add(name);
    const scene = new THREE.Scene();
    for (const p of s.parts) {
      for (const pc of pieces({ geometry: p.geo, material: p.mat }, new THREE.Matrix4())) {
        const m = new THREE.Mesh(pc.geo, plainMaterial(pc.mat));
        m.name = `${name}_${slug(pc.mat.name)}`;
        scene.add(m);
      }
    }
    if (!scene.children.length) continue;
    files.set(`plantillas/${name}.glb`, await glb(scene));
    const r = (x) => Math.round(x * 1e4) / 1e4;
    inst.plantillas[name] = {
      archivo: `plantillas/${name}.glb`,
      cantidad: s.matrices.length,
      matrices: s.matrices.map((m) => m.elements.map(r)),
      colores: s.colors.some(Boolean) ? s.colors.map((c) => (c ? c.map(r) : null)) : undefined,
    };
  }
  files.set('instancias.json', enc.encode(JSON.stringify(inst)));
  log(`plantillas: ${setNames.size}`);

  // 3. Calibración de ejes.
  {
    const scene = new THREE.Scene();
    const mat = new THREE.MeshStandardMaterial({ name: 'calibracion', color: 0xff00ff });
    for (const [n, x, y, z] of [
      ['cal_x', 10, 0, 0],
      ['cal_y', 0, 10, 0],
      ['cal_z', 0, 0, 10],
    ]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5).translate(x, y, z), mat);
      m.name = n;
      scene.add(m);
    }
    files.set('calibracion.glb', await glb(scene));
  }

  // 4. Puntos para la jugabilidad.
  const c = game.city;
  const puntos = {
    unidades: 'metros',
    aparicion: c.spawn ? { x: c.spawn.x, z: c.spawn.z, y: game.player?.y ?? 0 } : null,
    lugares: (c.pois ?? []).map((p) => ({ id: p.id, nombre: p.name, x: p.x, z: p.z })),
    sillas: (c.props ?? []).filter((p) => p.type === 'chair').map((p) => ({ x: p.x, z: p.z, rot: p.rot ?? 0 })),
    venteros: (c.props ?? []).filter((p) => p.type === 'vendor').map((p) => ({ x: p.x, z: p.z, rot: p.rot ?? 0 })),
  };
  files.set('puntos.json', enc.encode(JSON.stringify(puntos)));
  return files;
}
