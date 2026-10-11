// Optimización de los recursos ya generados en public/ (idempotente: se puede
// correr varias veces y solo cambia lo que aún pasa del presupuesto).
//
//   node scripts/assets/optimizar.mjs
//
//  - Personajes: quita primitivas duplicadas (el error de grupos de
//    rocketbox.mjs ya está corregido, esto arregla los GLB existentes). Las
//    texturas quedan en 1024 px como máximo (calidad de cerca).
//  - Vehículos: simplifica las primitivas con demasiados triángulos (rines y
//    la moto escaneada); texturas hasta 1024 px.
//  (Las texturas PBR de la ciudad las genera texturas.mjs en 1024 px más un
//  color HD de 2048 px para Alta/Ultra.)
//
// Presupuesto: un personaje <= ~7 k triángulos y 1 llamada por material; un
// vehículo <= ~6 k triángulos.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, dequantize, meshopt, prune, simplifyPrimitive, weldPrimitive } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUB = path.join(ROOT, 'public');

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const trisOf = (prim) => (prim.getIndices() ? prim.getIndices().getCount() : prim.getAttribute('POSITION').getCount()) / 3;

function sameArray(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Quita las primitivas repetidas (mismo material, mismos atributos y mismo índice). */
function dropDuplicatePrimitives(doc) {
  let removed = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    const kept = [];
    for (const prim of mesh.listPrimitives()) {
      const dup = kept.find(
        (k) =>
          k.getMaterial() === prim.getMaterial() &&
          k.getAttribute('POSITION') === prim.getAttribute('POSITION') &&
          sameArray(k.getIndices()?.getArray(), prim.getIndices()?.getArray()),
      );
      if (dup) {
        mesh.removePrimitive(prim);
        prim.dispose();
        removed++;
      } else kept.push(prim);
    }
  }
  return removed;
}

/** Simplifica (meshoptimizer) las primitivas que pasan de `maxTris`. */
function simplifyHeavy(doc, maxTris, { ratioFor = (t) => maxTris / t, error = 0.004 } = {}) {
  let before = 0;
  let after = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const t = trisOf(prim);
      if (t <= maxTris) continue;
      before += t;
      weldPrimitive(prim);
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: Math.min(1, ratioFor(t)), error, lockBorder: false });
      after += trisOf(prim);
    }
  }
  return { before, after };
}

/** Reduce las texturas embebidas a `max` px (mantiene el formato WebP). */
async function capTextures(doc, max, filter = () => true) {
  let n = 0;
  for (const tex of doc.getRoot().listTextures()) {
    const size = tex.getSize();
    if (!size || Math.max(...size) <= max || !filter(tex)) continue;
    const img = tex.getImage();
    const out = await sharp(img).resize(Math.min(max, size[0]), Math.min(max, size[1]), { kernel: 'lanczos3' }).webp({ quality: 88 }).toBuffer();
    tex.setImage(new Uint8Array(out)).setMimeType('image/webp');
    n++;
  }
  return n;
}

async function processGlb(file, fn) {
  const doc = await io.read(file);
  const changed = await fn(doc);
  if (!changed) return false;
  await doc.transform(dequantize(), prune({ keepLeaves: true, keepAttributes: true }), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const before = fs.statSync(file).size;
  await io.write(file, doc);
  console.log(`  ${path.relative(ROOT, file)}: ${(before / 1024).toFixed(0)} KB -> ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
  return true;
}

// ------------------------------------------------------------------ personajes
console.log('Personajes');
const persDir = path.join(PUB, 'models/personajes');
for (const f of fs.readdirSync(persDir).filter((f) => f.endsWith('.glb') && f !== 'animaciones.glb')) {
  await processGlb(path.join(persDir, f), async (doc) => {
    const dups = dropDuplicatePrimitives(doc);
    const tex = await capTextures(doc, 1024);
    if (dups || tex) console.log(`  ${f}: ${dups} primitivas duplicadas, ${tex} texturas reducidas`);
    return dups || tex;
  });
}

// ------------------------------------------------------------------ vehículos
console.log('Vehículos');
const vehDir = path.join(PUB, 'models/vehiculos');
for (const f of fs.readdirSync(vehDir).filter((f) => f.endsWith('.glb'))) {
  await processGlb(path.join(vehDir, f), async (doc) => {
    // Rines de la buseta (~2 k c/u) y la moto escaneada (~20 k en total).
    const s = simplifyHeavy(doc, f === 'moto.glb' ? 1400 : 1500, { ratioFor: (t) => (f === 'moto.glb' ? (t > 8000 ? 0.5 : 0.4) : 0.3) });
    const tex = await capTextures(doc, 1024);
    if (s.before || tex) console.log(`  ${f}: ${s.before} -> ${s.after} triángulos simplificados, ${tex} texturas reducidas`);
    return s.before || tex;
  });
}
