// Suelta los arreglos JS (posiciones, normales, UV, colores e índices) de las
// geometrías estáticas en cuanto three las sube a la GPU. La ciudad fusionada
// (fachadas, suelos, calles) guarda cientos de MB en arreglos que después de
// subirse no vuelve a leer nadie: en un celular esa copia doble es la que
// tumba la pestaña.
//
// Qué NO se suelta (porque el juego los vuelve a leer o a escribir):
//  - InstancedMesh, SkinnedMesh, BatchedMesh y Sprite (plantillas compartidas,
//    matrices y colores por instancia que cambian, huesos, la geometría
//    común de todos los sprites);
//  - atributos dinámicos (DynamicDrawUsage, updateRanges), intercalados,
//    morph targets, materiales en wireframe (three arma las líneas desde el
//    arreglo);
//  - geometrías que comparte algo excluido o no soltable del mismo árbol;
//  - lo que `exclude(o)` o `o.userData.keepGeometry` excluyan (con todo lo
//    que cuelga de ellos);
//  - todo, si la página se abrió con ?exportar (el exportador de Unreal lee
//    las geometrías de la ciudad).
//
// three necesita boundingSphere/boundingBox para descartar lo que no se ve y
// ya no podría calcularlos sin el arreglo: se calculan antes de soltar. Las
// mallas soltadas dejan de responder al Raycaster (no hay vértices que
// intersecar) en vez de romperlo.

import * as THREE from 'three';

/** ¿Se abrió el juego para el exportador de Unreal (?exportar)? Entonces no se suelta nada. */
export function keepGeometryArrays(search = globalThis.location?.search ?? '') {
  try {
    return new URLSearchParams(search).has('exportar');
  } catch {
    return false;
  }
}

const marked = new WeakSet(); // geometrías ya marcadas (llamar dos veces no duplica)

/** Callback de BufferAttribute.onUpload: three ya copió el arreglo a la GPU. */
function dropArray() {
  this.array = null;
}

const releasableObject = (o) => (o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && !o.isBatchedMesh) || o.isLine || o.isPoints;

const usesWireframe = (o) => [].concat(o.material ?? []).some((m) => m?.wireframe);

/** Atributos e índice de una geometría. */
function buffersOf(g) {
  const list = Object.values(g.attributes);
  if (g.index) list.push(g.index);
  return list;
}

/** Bytes de los arreglos que aún tiene una geometría en JS. */
export function geometryBytes(g) {
  let n = 0;
  for (const a of buffersOf(g)) {
    const arr = a.isInterleavedBufferAttribute ? a.data?.array : a.array;
    if (arr) n += arr.byteLength;
  }
  return n;
}

/** ¿La geometría ya no tiene sus arreglos (se soltaron al subirse)? */
export function geometryReleased(g) {
  return g.attributes.position?.array === null || g.index?.array === null;
}

/** Atributo que se puede soltar: estático, propio (no intercalado ni de GL) y con datos. */
const staticAttribute = (a) =>
  !a.isInterleavedBufferAttribute && !a.isGLBufferAttribute && !a.isInstancedBufferAttribute && a.usage === THREE.StaticDrawUsage && !(a.updateRanges?.length > 0);

/**
 * Marca las geometrías estáticas de `root` para que suelten sus arreglos al
 * subirse a la GPU. Hay que llamarla ANTES del primer render de ese árbol
 * (lo que ya se subió no vuelve a avisar). Devuelve lo marcado:
 * { geometries, objects, bytes, skipped }.
 *  exclude(o): true = no tocar `o` ni lo que cuelga de él.
 *  minBytes: deja quietas las geometrías más pequeñas.
 *  keep: no soltar nada (por defecto, con ?exportar).
 */
export function releaseStaticGeometry(root, { exclude = null, minBytes = 0, keep = keepGeometryArrays() } = {}) {
  const out = { geometries: 0, objects: 0, bytes: 0, skipped: 0 };
  if (!root || keep) return out;
  const candidates = new Map(); // geometría -> objetos que la usan
  const protectedGeos = new Set();
  const visit = (o, excluded) => {
    const ex = excluded || o.userData?.keepGeometry === true || (exclude ? !!exclude(o) : false);
    const g = o.geometry;
    if (g?.isBufferGeometry) {
      if (ex || !releasableObject(o) || usesWireframe(o) || o.morphTargetInfluences?.length) protectedGeos.add(g);
      else {
        const list = candidates.get(g);
        if (list) list.push(o);
        else candidates.set(g, [o]);
      }
    }
    for (const c of o.children) visit(c, ex);
  };
  visit(root, false);
  // Atributos de lo protegido: si otra geometría los comparte, tampoco se sueltan.
  const protectedBuffers = new Set();
  for (const g of protectedGeos) for (const a of buffersOf(g)) protectedBuffers.add(a.isInterleavedBufferAttribute ? a.data : a);

  for (const [g, objs] of candidates) {
    if (protectedGeos.has(g)) {
      out.skipped++;
      continue;
    }
    const buffers = buffersOf(g);
    const ok =
      !marked.has(g) &&
      g.attributes.position?.array &&
      Object.keys(g.morphAttributes).length === 0 &&
      buffers.every((a) => staticAttribute(a) && !protectedBuffers.has(a)) &&
      geometryBytes(g) >= minBytes;
    if (!ok) {
      if (!marked.has(g)) out.skipped++;
      continue;
    }
    // Sin el arreglo three ya no podría calcularlos (frustum culling, orden, sombras).
    if (g.boundingBox === null) g.computeBoundingBox();
    if (g.boundingSphere === null) g.computeBoundingSphere();
    for (const a of buffers) {
      const prev = a.onUploadCallback;
      a.onUpload(prev === THREE.BufferAttribute.prototype.onUploadCallback ? dropArray : function () {
        prev.call(this);
        dropArray.call(this);
      });
    }
    marked.add(g);
    out.geometries++;
    out.bytes += geometryBytes(g);
    for (const o of objs) {
      // El Raycaster ignora las mallas ya soltadas (antes leía sus vértices).
      const base = o.raycast;
      o.raycast = function (raycaster, intersects) {
        if (!geometryReleased(this.geometry)) base.call(this, raycaster, intersects);
      };
      out.objects++;
    }
  }
  return out;
}

/**
 * Cuánto ocupan los arreglos de geometría de `root` que siguen en JS y cuántas
 * geometrías ya los soltaron (medición y pruebas). Cuenta cada geometría y
 * cada atributo compartido una sola vez.
 */
export function retainedGeometryBytes(root) {
  const seenGeo = new Set();
  const seenBuf = new Set();
  const r = { bytes: 0, geometries: 0, released: 0 };
  root?.traverse((o) => {
    const g = o.geometry;
    if (!g?.isBufferGeometry || seenGeo.has(g)) return;
    seenGeo.add(g);
    r.geometries++;
    if (geometryReleased(g)) r.released++;
    for (const a of buffersOf(g)) {
      const buf = a.isInterleavedBufferAttribute ? a.data : a;
      if (seenBuf.has(buf)) continue;
      seenBuf.add(buf);
      if (buf.array) r.bytes += buf.array.byteLength;
    }
    // Matrices y colores por instancia (también son arreglos que se quedan).
    for (const a of [o.instanceMatrix, o.instanceColor]) {
      if (a?.array && !seenBuf.has(a)) {
        seenBuf.add(a);
        r.bytes += a.array.byteLength;
      }
    }
  });
  return r;
}
