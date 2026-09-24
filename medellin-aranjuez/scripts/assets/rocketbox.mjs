// Conversión reproducible de personajes Microsoft Rocketbox (licencia MIT)
// a GLB optimizados para el juego.
//
//   node scripts/assets/rocketbox.mjs [--only jugador,policia-1] [--anims-only] [--avatars-only]
//
// Qué hace:
//  1. Descarga (con curl, desde raw.githubusercontent.com) los FBX y las
//     texturas TGA de cada avatar elegido y los FBX de las animaciones a una
//     caché local (ROCKETBOX_CACHE, por defecto <tmp>/rocketbox-cache).
//  2. Lee los FBX en Node con FBXLoader de three.js (sin navegador: las
//     texturas se sustituyen por marcadores y se procesan aparte).
//  3. Avatares: pasa de centímetros a metros, invierte la V de las UV (glTF
//     usa el origen arriba), agrupa los triángulos por material (menos
//     llamadas de dibujo), aplica recoloreados (uniforme verde oliva de la
//     Policía, camiseta blanca del jugador) y, si se pide, añade un chaleco
//     verde limón como una "cáscara" del torso inflada que comparte el
//     esqueleto. Exporta con GLTFExporter y con glTF-Transform pone las
//     texturas (TGA -> WebP a 1024/512 px), material PBR (piel ~0.55, ropa
//     ~0.85), prune, dedup y compresión meshopt.
//  4. Animaciones: un único GLB sin malla (solo huesos + clips). Se conservan
//     las rotaciones de los huesos del cuerpo y la posición de Bip01 (cadera),
//     esta última NORMALIZADA por la altura de cadera del actor (valor ~1.0)
//     y sin desplazamiento horizontal (clips "en el sitio"). En el juego se
//     multiplica por la altura de cadera de cada avatar, así un clip sirve a
//     todos los cuerpos. La velocidad de avance original de cada ciclo se
//     guarda en `scene.extras.clips` para ajustar el timeScale y que los pies
//     no patinen.
//
// Fuente: https://github.com/microsoft/Microsoft-Rocketbox (MIT, © 2020 Microsoft).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { prune, dedup, resample, meshopt, reorder } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'public/models/personajes');
const CACHE = process.env.ROCKETBOX_CACHE ?? path.join(os.tmpdir(), 'rocketbox-cache');
const RAW = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/';
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;

// ---------------------------------------------------------------- selección
const OLIVE = [74, 84, 50]; // verde oliva del uniforme de la Policía Nacional
const WHITE = [226, 226, 222];
// Huesos del torso (para máscaras de camiseta y para el chaleco).
const TORSO = ['Bip01_Spine', 'Bip01_Spine1', 'Bip01_Spine2', 'Bip01_Neck', 'Bip01_L_Clavicle', 'Bip01_R_Clavicle'];
const SHIRT = [...TORSO, 'Bip01_L_UpperArm', 'Bip01_R_UpperArm'];
// Toda la ropa (sin manos, pies ni cabeza) para teñir uniformes oscuros.
const CLOTHES = [...SHIRT, 'Bip01_Pelvis', 'Bip01_L_Forearm', 'Bip01_R_Forearm', 'Bip01_L_Thigh', 'Bip01_R_Thigh', 'Bip01_L_Calf', 'Bip01_R_Calf'];

/**
 * role: player | civil | police | gang. gender: m | f (elige el juego de clips).
 * recolor: [{ material, color, hue?: [min, max], minSat?, bones?, rects? }]
 *   - hue: recolorea los píxeles cuyo tono (grados) cae en el rango.
 *   - bones: recolorea solo la región UV de los triángulos pesados a esos huesos.
 *   - rects: rectángulos [x0, y0, x1, y1] (0..1, origen arriba) de la textura.
 */
export const AVATARS = [
  { id: 'jugador', src: 'Adults/Male_Adult_16', gender: 'm', role: 'player', head: 1024, recolor: [
      // Islas UV de la camiseta (columna central y mangas) en la textura del cuerpo.
      { material: 'body', rects: [[0.315, 0.02, 0.685, 0.875], [0, 0.43, 0.31, 0.585], [0.69, 0.43, 1, 0.585]], color: WHITE, maxGain: 1.1 },
    ] },
  { id: 'civil-m1', src: 'Adults/Male_Adult_01', gender: 'm', role: 'civil' },
  { id: 'civil-m2', src: 'Adults/Male_Adult_06', gender: 'm', role: 'civil' },
  { id: 'civil-m3', src: 'Adults/Male_Adult_12', gender: 'm', role: 'civil' },
  { id: 'civil-m4', src: 'Adults/Male_Adult_05', gender: 'm', role: 'civil' },
  { id: 'civil-f1', src: 'Adults/Female_Adult_08', gender: 'f', role: 'civil' },
  { id: 'civil-f2', src: 'Adults/Female_Adult_12', gender: 'f', role: 'civil' },
  { id: 'civil-f3', src: 'Adults/Female_Party_02', gender: 'f', role: 'civil' },
  { id: 'civil-f4', src: 'Adults/Female_Adult_03', gender: 'f', role: 'civil' },
  { id: 'policia-1', src: 'Professions/Police_Male_01', gender: 'm', role: 'police', vest: true, recolor: [
      { material: 'body', hue: [180, 260], minSat: 0.12, color: OLIVE },
      { material: 'head', hue: [185, 250], minSat: 0.25, color: OLIVE },
    ] },
  { id: 'policia-2', src: 'Professions/Police_Male_03', gender: 'm', role: 'police', vest: true, recolor: [{ material: 'body', bones: CLOTHES, color: OLIVE }] },
  { id: 'pandilla-1', src: 'Adults/Male_Adult_18', gender: 'm', role: 'gang' },
  { id: 'pandilla-2', src: 'Adults/Male_Adult_10', gender: 'm', role: 'gang' },
];

/** Clips: nombre en el juego -> archivo Rocketbox. kind: loop | locomotion | pose. */
export const ANIMS = [];
for (const g of ['m', 'f']) {
  ANIMS.push(
    { name: `${g}_idle`, file: `static/${g}_idle_breathe_01`, kind: 'loop' },
    { name: `${g}_walk`, file: `xy/${g}_walk_neutral_01`, kind: 'locomotion' },
    { name: `${g}_jog`, file: `xy/${g}_run_slow_01`, kind: 'locomotion' },
    { name: `${g}_sprint`, file: `xy/${g}_run_fast_01`, kind: 'locomotion' },
    { name: `${g}_crouch`, file: `static/${g}_crouch_idle`, kind: 'loop' },
    { name: `${g}_sit`, file: `static/${g}_sit_chair_breathe_01`, kind: 'pose' },
  );
}
// Altura de cadera (Bip01, cm) del actor de captura en reposo, por género.
const HIP_REF = { m: 89.52, f: 91.94 };

// Tamaños de textura por material (px) y calidad WebP.
const TEX = { body: 1024, head: 512, opacity: 512, equipment: 512, pistol: 128 };
const NORMAL_SCALE = 0.5; // los mapas normales van a la mitad de resolución

// ---------------------------------------------------------------- utilidades
function download(rel, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  console.log('  descargando', rel);
  execFileSync('curl', ['-sS', '-f', '-L', '--retry', '3', '-o', dest, RAW + encodeURI(rel)], { stdio: 'inherit' });
}

/** Decodificador TGA mínimo (tipos 2 y 10, 24/32 bits) -> {width, height, data RGBA}. */
export function decodeTga(buf) {
  const idLen = buf[0];
  const type = buf[2];
  const w = buf.readUInt16LE(12);
  const h = buf.readUInt16LE(14);
  const bpp = buf[16];
  const desc = buf[17];
  if (![2, 10].includes(type) || ![24, 32].includes(bpp)) throw new Error(`TGA no soportado: tipo ${type}, ${bpp} bits`);
  const px = bpp / 8;
  const out = Buffer.alloc(w * h * 4);
  let p = 18 + idLen + (buf[1] ? buf.readUInt16LE(5) * Math.ceil(buf[7] / 8) : 0);
  const topDown = (desc & 0x20) !== 0;
  let i = 0;
  const put = (o) => {
    const x = i % w;
    const y = Math.floor(i / w);
    const row = topDown ? y : h - 1 - y;
    const d = (row * w + x) * 4;
    out[d] = buf[o + 2];
    out[d + 1] = buf[o + 1];
    out[d + 2] = buf[o];
    out[d + 3] = px === 4 ? buf[o + 3] : 255;
    i++;
  };
  const n = w * h;
  if (type === 2) {
    while (i < n) {
      put(p);
      p += px;
    }
  } else {
    while (i < n) {
      const c = buf[p++];
      const count = (c & 0x7f) + 1;
      if (c & 0x80) {
        for (let k = 0; k < count; k++) put(p);
        p += px;
      } else {
        for (let k = 0; k < count; k++) {
          put(p);
          p += px;
        }
      }
    }
  }
  return { width: w, height: h, data: out };
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

/** Rasteriza triángulos UV (0..1, origen abajo como en FBX) en una máscara w×h. */
function rasterMask(w, h, tris) {
  const m = new Uint8Array(w * h);
  for (const t of tris) {
    const P = t.map(([u, v]) => [u * w, (1 - v) * h]);
    const minY = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1])) - 1);
    const maxY = Math.min(h - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])) + 1);
    for (let y = minY; y <= maxY; y++) {
      const yc = y + 0.5;
      const xs = [];
      for (let k = 0; k < 3; k++) {
        const [x0, y0] = P[k];
        const [x1, y1] = P[(k + 1) % 3];
        if ((yc >= y0 && yc < y1) || (yc >= y1 && yc < y0)) xs.push(x0 + ((yc - y0) / (y1 - y0)) * (x1 - x0));
      }
      if (xs.length < 2) continue;
      const a = Math.max(0, Math.floor(Math.min(...xs)) - 1);
      const b = Math.min(w - 1, Math.ceil(Math.max(...xs)) + 1);
      for (let x = a; x <= b; x++) m[y * w + x] = 1;
    }
  }
  return m;
}

/** Tiñe los píxeles de la máscara con `color` conservando el sombreado relativo. */
function tint(img, mask, color, maxGain = 1.5) {
  const { data } = img;
  let sum = 0;
  let n = 0;
  const lum = (i) => (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    sum += lum(p * 4);
    n++;
  }
  if (!n) return 0;
  const mean = sum / n;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    const k = Math.min(maxGain, Math.max(0.2, lum(i) / mean));
    for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, Math.round(color[c] * k));
  }
  return n;
}

// ---------------------------------------------------------------- FBX
class StubTextureLoader extends THREE.Loader {
  load(url) {
    const t = new THREE.Texture();
    t.userData.file = url.split(/[\\/]/).pop();
    return t;
  }
}

function parseFbx(file) {
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.(tga|dds|tif|tiff|png|jpe?g|bmp)$/i, new StubTextureLoader(manager));
  const buf = fs.readFileSync(file);
  return new FBXLoader(manager).parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
}

// GLTFExporter en Node necesita FileReader.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((r) => {
      this.result = r;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((r) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(r).toString('base64')}`;
      this.onloadend?.();
    });
  }
};

function exportGlb(object, animations = []) {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(object, (r) => resolve(Buffer.from(r)), reject, { binary: true, animations, onlyVisible: false });
  });
}

function dominantBone(skinIndex, skinWeight, i) {
  let best = 0;
  let bw = -1;
  for (let k = 0; k < 4; k++) {
    const w = skinWeight.getComponent(i, k);
    if (w > bw) {
      bw = w;
      best = skinIndex.getComponent(i, k);
    }
  }
  return best;
}

async function io() {
  const i = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  return i;
}

// ---------------------------------------------------------------- avatares
async function convertAvatar(a, nio) {
  const name = a.src.split('/').pop();
  const dir = path.join(CACHE, 'avatars', name);
  const tree = listing();
  const files = tree.filter((p) => p.startsWith(`Assets/Avatars/${a.src}/`));
  for (const p of files) {
    if (p.endsWith(`/Export/${name}.fbx`) || /\/Textures\/.*_(color|normal)\.tga$/.test(p)) download(p, path.join(dir, p.split('/').pop()));
  }
  const root = parseFbx(path.join(dir, `${name}.fbx`));
  // Quitar lo que no es personaje.
  const junk = [];
  root.traverse((o) => {
    if (o.isLight || o.name === 'Bip01_Footsteps') junk.push(o);
  });
  for (const o of junk) o.removeFromParent();

  const S = new THREE.Matrix4().makeScale(0.01, 0.01, 0.01);
  const Si = new THREE.Matrix4().makeScale(100, 100, 100);
  const meshes = [];
  root.traverse((o) => o.isSkinnedMesh && meshes.push(o));
  if (meshes.length !== 1) console.warn(`  aviso: ${meshes.length} mallas con piel en ${name}`);
  root.traverse((o) => {
    if (o.isBone) o.position.multiplyScalar(0.01);
  });
  const mesh = meshes[0];
  let g = mesh.geometry;
  // Hornear la matriz de enlace en los vértices (quedan en el espacio del
  // esqueleto, Y arriba) y dejar la malla sin transformación propia.
  root.updateMatrixWorld(true);
  const bm = mesh.bindMatrix.clone();
  g.applyMatrix4(bm);
  mesh.position.set(0, 0, 0);
  mesh.quaternion.identity();
  mesh.scale.set(1, 1, 1);
  mesh.bindMatrix.identity();
  mesh.bindMatrixInverse.identity();
  g.scale(0.01, 0.01, 0.01);
  // UV: origen abajo (FBX) -> arriba (glTF), con las imágenes sin voltear.
  for (let i = 0; i < g.attributes.uv.count; i++) g.attributes.uv.setY(i, 1 - g.attributes.uv.getY(i));
  if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
  for (const m of mesh.skeleton.boneInverses) m.premultiply(S).multiply(Si);
  root.updateMatrixWorld(true);

  // Agrupar triángulos por material.
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const index = g.index.array;
  const byMat = mats.map(() => []);
  for (const grp of g.groups) {
    for (let i = grp.start; i < grp.start + grp.count; i++) byMat[grp.materialIndex ?? 0].push(index[i]);
  }
  const newIndex = [];
  g.clearGroups();
  byMat.forEach((list, mi) => {
    if (!list.length) return;
    g.addGroup(newIndex.length, list.length, mi);
    newIndex.push(...list);
  });
  g.setIndex(newIndex);
  // FBXLoader entrega vértices sin compartir: se sueldan los idénticos.
  // (mergeVertices clona la geometría con sus grupos: se reponen una sola
  // vez; si no, cada material queda dos veces y el personaje se dibuja doble.)
  const groups = g.groups.map((q) => ({ ...q }));
  g = mergeVertices(g);
  g.clearGroups();
  for (const q of groups) g.addGroup(q.start, q.count, q.materialIndex);
  mesh.geometry = g;
  const uv = g.attributes.uv;

  // Texturas por material (a partir del nombre del archivo de color).
  const bones = mesh.skeleton.bones.map((b) => b.name);
  const matInfo = mats.map((m, mi) => {
    const colorFile = m.map?.userData.file;
    const normalFile = m.normalMap?.userData.file;
    const kind = (m.name.split('_').pop() || 'body').toLowerCase();
    return { name: m.name, kind, colorFile, normalFile, mi, alpha: !!m.alphaMap || kind === 'opacity' };
  });
  const triUVs = (mi, boneSet, anyVertex = false, minY = -Infinity) => {
    const set = new Set(boneSet.map((b) => bones.indexOf(b)).filter((i) => i >= 0));
    const out = [];
    const grp = g.groups.find((q) => q.materialIndex === mi);
    if (!grp) return out;
    const si = g.attributes.skinIndex;
    const sw = g.attributes.skinWeight;
    for (let i = grp.start; i < grp.start + grp.count; i += 3) {
      const t = [g.index.getX(i), g.index.getX(i + 1), g.index.getX(i + 2)];
      const inSet = (v) => set.has(dominantBone(si, sw, v));
      if (anyVertex ? !t.some(inSet) : !t.every(inSet)) continue;
      if (t.some((v) => g.attributes.position.getY(v) < minY)) continue;
      out.push(t.map((v) => [uv.getX(v), 1 - uv.getY(v)]));
    }
    return out;
  };

  // Chaleco reflectivo: cáscara del torso inflada, con piel sobre el mismo esqueleto.
  let vest = null;
  if (a.vest) {
    const body = matInfo.find((m) => m.kind === 'body');
    const grp = g.groups.find((q) => q.materialIndex === body.mi);
    const set = new Set(['Bip01_Spine', 'Bip01_Spine1', 'Bip01_Spine2'].map((b) => bones.indexOf(b)));
    const armSet = new Set(['Bip01_L_Clavicle', 'Bip01_R_Clavicle', 'Bip01_L_UpperArm', 'Bip01_R_UpperArm', 'Bip01_Neck', 'Bip01_Head'].map((b) => bones.indexOf(b)));
    const si = g.attributes.skinIndex;
    const sw = g.attributes.skinWeight;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const hip = root.getObjectByName('Bip01').getWorldPosition(new THREE.Vector3()).y;
    const tris = [];
    for (let i = grp.start; i < grp.start + grp.count; i += 3) {
      const t = [g.index.getX(i), g.index.getX(i + 1), g.index.getX(i + 2)];
      if (!t.every((v) => set.has(dominantBone(si, sw, v)))) continue;
      if (t.some((v) => pos.getY(v) < hip + 0.04)) continue; // sin la zona del cinturón
      // Nada que se mueva con los brazos (evita solapas al apuntar).
      if (t.some((v) => [0, 1, 2, 3].some((k) => armSet.has(si.getComponent(v, k)) && sw.getComponent(v, k) > 0.12))) continue;
      tris.push(...t);
    }
    const vg = new THREE.BufferGeometry();
    const remap = new Map();
    const P = [];
    const N = [];
    const SI = [];
    const SW = [];
    const idx = [];
    for (const v of tris) {
      if (!remap.has(v)) {
        remap.set(v, remap.size);
        const n = new THREE.Vector3(nor.getX(v), nor.getY(v), nor.getZ(v));
        P.push(pos.getX(v) + n.x * 0.011, pos.getY(v) + n.y * 0.011, pos.getZ(v) + n.z * 0.011);
        N.push(n.x, n.y, n.z);
        for (let k = 0; k < 4; k++) {
          SI.push(si.getComponent(v, k));
          SW.push(sw.getComponent(v, k));
        }
      }
      idx.push(remap.get(v));
    }
    vg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    vg.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    vg.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4));
    vg.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
    vg.setIndex(idx);
    const vm = new THREE.MeshStandardMaterial({ name: 'chaleco', color: 0xc8f000, roughness: 0.6, emissive: 0x2a3300 });
    vest = new THREE.SkinnedMesh(vg, vm);
    vest.name = 'chaleco';
    vest.bind(mesh.skeleton, mesh.bindMatrix);
    mesh.parent.add(vest);
    console.log(`  chaleco: ${idx.length / 3} triángulos`);
  }

  // Materiales PBR simples (las texturas se añaden con glTF-Transform).
  mesh.material = matInfo.map((m) => new THREE.MeshStandardMaterial({ name: m.name }));
  mesh.name = a.id;
  mesh.castShadow = true;

  // Metadatos: altura de cadera y estatura.
  const hipY = root.getObjectByName('Bip01').getWorldPosition(new THREE.Vector3()).y;
  g.computeBoundingBox();
  console.log('  bbox', g.boundingBox.min.toArray().map((v) => v.toFixed(2)).join(','), g.boundingBox.max.toArray().map((v) => v.toFixed(2)).join(','), 'verts', g.attributes.position.count);
  const height = g.boundingBox.max.y - g.boundingBox.min.y;
  root.name = a.id;
  const glb = await exportGlb(root);

  // ------------------------------------------------ glTF-Transform
  const doc = await nio.readBinary(new Uint8Array(glb));
  const webp = doc.createExtension(EXTTextureWebP).setRequired(true);
  void webp;
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  scene.setExtras({ id: a.id, gender: a.gender, role: a.role, hipHeight: +hipY.toFixed(4), height: +height.toFixed(3), source: `Microsoft Rocketbox ${a.src} (MIT)` });

  const texCache = new Map();
  const makeTex = async (file, size, recolor, isNormal, keepAlpha) => {
    const key = `${file}|${size}`;
    if (texCache.has(key)) return texCache.get(key);
    const img = decodeTga(fs.readFileSync(path.join(dir, file)));
    for (const rc of recolor ?? []) {
      let mask;
      if (rc.rects) {
        mask = new Uint8Array(img.width * img.height);
        for (const [x0, y0, x1, y1] of rc.rects) {
          for (let y = Math.floor(y0 * img.height); y < y1 * img.height; y++) {
            for (let x = Math.floor(x0 * img.width); x < x1 * img.width; x++) {
              const p = y * img.width + x;
              if (img.data[p * 4] + img.data[p * 4 + 1] + img.data[p * 4 + 2] > 30) mask[p] = 1; // sin el fondo negro
            }
          }
        }
      } else if (rc.bones) {
        mask = rasterMask(img.width, img.height, triUVs(rc.mi, rc.bones, rc.anyVertex, rc.minY));
      } else {
        mask = new Uint8Array(img.width * img.height);
        for (let p = 0; p < mask.length; p++) {
          const [h, s, l] = rgbToHsl(img.data[p * 4] / 255, img.data[p * 4 + 1] / 255, img.data[p * 4 + 2] / 255);
          if (h >= rc.hue[0] && h <= rc.hue[1] && s >= (rc.minSat ?? 0.1) && l > 0.04) mask[p] = 1;
        }
      }
      const n = tint(img, mask, rc.color, rc.maxGain);
      console.log(`  recoloreado ${file}: ${((100 * n) / mask.length).toFixed(1)}% de la textura`);
    }
    if (process.env.RB_DEBUG && recolor?.length) await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } }).resize(1024).png().toFile(path.join(CACHE, `debug-${a.id}-${file}.png`));
    let sh = sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } }).resize(size, size, { kernel: 'lanczos3' });
    if (!keepAlpha) sh = sh.removeAlpha();
    const buf = await sh.webp({ quality: isNormal ? 85 : 80, alphaQuality: 90, effort: 6 }).toBuffer();
    const tex = doc.createTexture(file.replace(/\.tga$/, '')).setImage(new Uint8Array(buf)).setMimeType('image/webp').setURI(file.replace(/\.tga$/, '.webp'));
    texCache.set(key, tex);
    return tex;
  };

  for (const mat of doc.getRoot().listMaterials()) {
    const info = matInfo.find((m) => m.name === mat.getName());
    if (!info) {
      // El chaleco.
      mat.setMetallicFactor(0).setRoughnessFactor(0.6);
      continue;
    }
    let size = TEX[info.kind] ?? 512;
    if (info.kind === 'head' && a.head) size = a.head;
    const recolor = (a.recolor ?? []).filter((r) => r.material === info.kind).map((r) => ({ ...r, mi: info.mi }));
    if (info.colorFile && fs.existsSync(path.join(dir, info.colorFile))) {
      mat.setBaseColorTexture(await makeTex(info.colorFile, size, recolor, false, info.alpha));
    }
    if (info.normalFile && fs.existsSync(path.join(dir, info.normalFile)) && info.kind !== 'pistol') {
      mat.setNormalTexture(await makeTex(info.normalFile, Math.max(128, size * NORMAL_SCALE), null, true, false));
    }
    mat.setMetallicFactor(0);
    mat.setRoughnessFactor(info.kind === 'head' ? 0.55 : info.kind === 'pistol' || info.kind === 'equipment' ? 0.5 : 0.85);
    if (info.alpha) mat.setAlphaMode('MASK').setAlphaCutoff(0.45).setDoubleSided(true);
  }
  await doc.transform(prune(), dedup(), reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(OUT, `${a.id}.glb`);
  await nio.write(out, doc);
  console.log(`  -> ${path.relative(ROOT, out)} ${(fs.statSync(out).size / 1024).toFixed(0)} KB (cadera ${hipY.toFixed(3)} m, estatura ${height.toFixed(2)} m)`);
}

// ---------------------------------------------------------------- animaciones
const BODY_BONE = /^Bip01(_Pelvis|_Spine\d?|_Neck|_Head|_[LR]_(Clavicle|UpperArm|Forearm|Hand|Finger\d+|Thigh|Calf|Foot|Toe0))?$/;

async function convertAnims(nio) {
  const clips = [];
  const meta = {};
  let skeletonRoot = null;
  const tree = listing();
  for (const an of ANIMS) {
    const [folder, base] = an.file.split('/');
    const rel = tree.find((p) => p === `Assets/Animations/all_animations_max_motextr_${folder}/${base}.max.fbx`);
    if (!rel) throw new Error(`No existe la animación ${an.file}`);
    const dest = path.join(CACHE, 'anims', `${base}.fbx`);
    download(rel, dest);
    const root = parseFbx(dest);
    const src = root.animations[0];
    const hipRef = HIP_REF[an.name[0]];
    const tracks = [];
    let speed = 0;
    for (const t of src.tracks) {
      const [node, prop] = t.name.split('.');
      if (!BODY_BONE.test(node)) continue;
      if (prop === 'quaternion') {
        tracks.push(t.clone());
      } else if (prop === 'position' && node === 'Bip01') {
        const tt = t.clone();
        const v = tt.values;
        const n = tt.times.length;
        const T = tt.times[n - 1] - tt.times[0] || 1;
        const dx = v[3 * (n - 1)] - v[0];
        const dz = v[3 * (n - 1) + 2] - v[2];
        if (an.kind === 'locomotion') speed = Math.hypot(dx, dz) / 100 / T;
        const x0 = v[0];
        const z0 = v[2];
        for (let k = 0; k < n; k++) {
          const f = (tt.times[k] - tt.times[0]) / T;
          // En el sitio: sin avance, se conserva el balanceo lateral y vertical.
          v[3 * k] = (v[3 * k] - x0 - dx * f) / hipRef;
          v[3 * k + 1] = v[3 * k + 1] / hipRef;
          v[3 * k + 2] = (v[3 * k + 2] - z0 - dz * f) / hipRef;
        }
        tracks.push(tt);
      }
    }
    let clip = new THREE.AnimationClip(an.name, -1, tracks);
    if (an.kind === 'pose') {
      // Una sola pose (primer cuadro) de 1 s: sentado para conducir.
      clip = new THREE.AnimationClip(
        an.name,
        1,
        clip.tracks.map((t) => {
          const sz = t.getValueSize();
          const vals = Array.from(t.values.slice(0, sz));
          return new t.constructor(t.name, [0, 1], [...vals, ...vals]);
        }),
      );
    }
    clip.optimize();
    clips.push(clip);
    meta[an.name] = { speed: +speed.toFixed(3), duration: +clip.duration.toFixed(3), kind: an.kind };
    console.log(`  ${an.name}: ${clip.duration.toFixed(2)} s, ${clip.tracks.length} pistas${speed ? `, avance ${speed.toFixed(2)} m/s` : ''}`);
    if (!skeletonRoot) {
      skeletonRoot = root;
      const junk = [];
      root.traverse((o) => {
        if (o.isLight || (!o.isBone && o !== root && o.parent !== root)) junk.push(o);
        if (o.isBone) o.position.multiplyScalar(0.01);
      });
      for (const o of junk) o.removeFromParent();
    }
  }
  skeletonRoot.name = 'esqueleto-rocketbox';
  const glb = await exportGlb(skeletonRoot, clips);
  const doc = await nio.readBinary(new Uint8Array(glb));
  const scene = doc.getRoot().listScenes()[0];
  scene.setExtras({ clips: meta, hipNormalized: true, source: 'Microsoft Rocketbox Assets/Animations (MIT)' });
  await doc.transform(resample({ tolerance: 2e-4 }), prune({ keepLeaves: true }), dedup(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(OUT, 'animaciones.glb');
  await nio.write(out, doc);
  console.log(`  -> ${path.relative(ROOT, out)} ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

// ---------------------------------------------------------------- listado del repo
let _tree = null;
function listing() {
  if (_tree) return _tree;
  const f = path.join(CACHE, 'tree.txt');
  if (!fs.existsSync(f)) {
    // Clon parcial sin blobs solo para listar rutas (no descarga archivos).
    const repo = path.join(CACHE, 'repo');
    if (!fs.existsSync(repo)) execFileSync('git', ['clone', '--filter=blob:none', '--no-checkout', '--depth', '1', 'https://github.com/microsoft/Microsoft-Rocketbox', repo], { stdio: 'inherit' });
    fs.writeFileSync(f, execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', 'HEAD'], { maxBuffer: 64 << 20 }));
  }
  _tree = fs.readFileSync(f, 'utf8').split('\n');
  return _tree;
}

// ---------------------------------------------------------------- main
fs.mkdirSync(OUT, { recursive: true });
const nio = await io();
if (!args.includes('--anims-only')) {
  for (const a of AVATARS) {
    if (only && !only.includes(a.id)) continue;
    console.log(`Avatar ${a.id} (${a.src})`);
    await convertAvatar(a, nio);
  }
}
if (!args.includes('--avatars-only') && (!only || only.includes('animaciones'))) {
  console.log('Animaciones');
  await convertAnims(nio);
}
let total = 0;
for (const f of fs.readdirSync(OUT)) total += fs.statSync(path.join(OUT, f)).size;
console.log(`Total en ${path.relative(ROOT, OUT)}: ${(total / 1048576).toFixed(1)} MB`);
