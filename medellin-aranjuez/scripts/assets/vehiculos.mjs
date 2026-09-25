// Descarga y procesa los modelos 3D de vehículos (CC BY 4.0) para el juego.
// Reproducible: `node scripts/assets/vehiculos.mjs [taxi sedan suv buseta moto]`
// (usa caché en .cache/vehiculos/).
//
// Fuente: modelos descargables de Sketchfab con licencia CC BY 4.0, tomados
// del conjunto Objaverse (allenai/objaverse en Hugging Face), que redistribuye
// los GLB originales con su licencia por modelo. Los créditos quedan en
// ASSETS-CREDITS.md y en public/models/vehiculos/CREDITOS.txt.
//
// Cada modelo se normaliza a un formato común que entiende VehicleView:
//  - metros, eje Y hacia arriba, frente hacia -Z, piso en y = 0, centrado en X/Z;
//  - nodo "carroceria" con una malla por material, nombrada con una clave
//    estándar (pintura, vidrio, negro, plastico, gris, cromo, caucho, rin,
//    faro, stop, textura...). Una clave puede traer textura de color (y de
//    normales); el juego conserva el mapa al cambiar el material;
//  - una rueda por nodo ("rueda_del_izq", "rueda_tras_der", ...) con el origen
//    en el eje, para que el juego las haga girar y virar;
//  - sin textura: normales suavizadas por ángulo; con textura: las del autor;
//  - meshopt + texturas webp (≤ 1024 px).
//
// Salida: public/models/vehiculos/*.glb

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

globalThis.self ??= globalThis;
globalThis.FileReader ??= class {
  readAsArrayBuffer(b) {
    b.arrayBuffer().then((r) => {
      this.result = r;
      this.onloadend?.({ target: this });
      this.onload?.({ target: this });
    });
  }
};

const THREE = await import('three');
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
const { mergeGeometries, toCreasedNormals, mergeVertices } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
const { NodeIO, PropertyType } = await import('@gltf-transform/core');
const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
const { dedup, prune, weld, meshopt, textureCompress } = await import('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } = await import('meshoptimizer');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const CACHE = path.join(ROOT, '.cache/vehiculos');
const OUT = path.join(ROOT, 'public/models/vehiculos');

// --------------------------------------------------------------- fuentes
const OBJAVERSE = 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/';
const SOURCES = {
  ace: {
    path: 'glbs/000-125/055ff8a21b8d4d279debca089e2fafcd.glb',
    title: "Ace '11 - Low Poly model",
    author: 'Daniel Zhabotinsky',
    url: 'https://sketchfab.com/3d-models/ace-11-low-poly-model-055ff8a21b8d4d279debca089e2fafcd',
  },
  kiri: {
    path: 'glbs/000-107/7fd6e15785fa4aa9bfd6e31eb7c97ba6.glb',
    title: "Kiri '10 - Low poly model",
    author: 'Daniel Zhabotinsky',
    url: 'https://sketchfab.com/3d-models/kiri-10-low-poly-model-7fd6e15785fa4aa9bfd6e31eb7c97ba6',
  },
  urban: {
    path: 'glbs/000-005/2866efdfa943484391ef8313768e074d.glb',
    title: "Urban '10 - Low poly model",
    author: 'Daniel Zhabotinsky',
    url: 'https://sketchfab.com/3d-models/urban-10-low-poly-model-2866efdfa943484391ef8313768e074d',
  },
  micruss: {
    path: 'glbs/000-009/60c006be9a834849895438f15d4927c0.glb',
    title: 'Busscar Micruss',
    author: 'Red Fox (nokillnando)',
    url: 'https://sketchfab.com/3d-models/busscar-micruss-60c006be9a834849895438f15d4927c0',
  },
  pulsar: {
    path: 'glbs/000-099/36d04d99171e4d59b540c25d8650dbd5.glb',
    title: 'pulsar 135 ls',
    author: 'Emanuel Restrepo Vélez (e-restrepo1114)',
    url: 'https://sketchfab.com/3d-models/pulsar-135-ls-36d04d99171e4d59b540c25d8650dbd5',
  },
};

const isHtml = (buf) => /^\s*<(!doctype|html)/i.test(buf.subarray(0, 64).toString('latin1'));

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0 && !isHtml(fs.readFileSync(file))) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let intento = 1; intento <= 4; intento++) {
    console.log('descargando', url);
    const r = await fetch(url);
    const buf = Buffer.from(await r.arrayBuffer());
    if (r.ok && !isHtml(buf)) {
      fs.writeFileSync(file, buf);
      return file;
    }
    await new Promise((res) => setTimeout(res, 3000 * intento));
  }
  throw new Error(`No se pudo descargar ${url}. Descárguelo a mano en ${file} (ver ASSETS-CREDITS.md).`);
}

const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

/**
 * GLB de Sketchfab: devuelve la escena de three.js (sin imágenes, que en Node
 * no se pueden decodificar) y, por material, sus texturas originales.
 */
async function loadSource(key) {
  const file = await download(OBJAVERSE + SOURCES[key].path, path.join(CACHE, `${key}.glb`));
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(file);
  const tex = new Map();
  const img = (t) => (t ? Buffer.from(t.getImage()) : null);
  for (const m of doc.getRoot().listMaterials()) {
    tex.set(m.getName(), { color: img(m.getBaseColorTexture()), normal: img(m.getNormalTexture()), factor: m.getBaseColorFactor() });
  }
  for (const t of doc.getRoot().listTextures()) t.dispose();
  const glb = await io.writeBinary(doc);
  const scene = await new Promise((res, rej) => new GLTFLoader().parse(ab(Buffer.from(glb)), '', (g) => res(g.scene), rej));
  scene.updateMatrixWorld(true);
  return { scene, tex };
}

/** Lector de píxeles (RGB 0-255) de una imagen, por coordenada UV de glTF. */
async function sampler(buf) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return (uv) => {
    const u = uv.x - Math.floor(uv.x);
    const v = uv.y - Math.floor(uv.y);
    const x = Math.min(info.width - 1, Math.floor(u * info.width));
    const y = Math.min(info.height - 1, Math.floor(v * info.height));
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
}

/** UV del bloque de 8x8 px más oscuro y parejo de una imagen (para llantas). */
async function darkSpot(buf) {
  const { data, info } = await sharp(buf).removeAlpha().resize(256, 256, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  let best = null;
  for (let by = 0; by < 32; by++) {
    for (let bx = 0; bx < 32; bx++) {
      let sum = 0;
      let sq = 0;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const i = ((by * 8 + y) * 256 + bx * 8 + x) * info.channels;
          const l = (data[i] + data[i + 1] + data[i + 2]) / 3;
          sum += l;
          sq += l * l;
        }
      }
      const mean = sum / 64;
      const dev = Math.sqrt(Math.max(0, sq / 64 - mean * mean));
      // Gris muy oscuro (no negro puro) y sin detalle.
      const score = Math.abs(mean - 22) + dev * 3;
      if (!best || score < best.score) best = { score, u: (bx * 8 + 4) / 256, v: (by * 8 + 4) / 256, mean };
    }
  }
  return new THREE.Vector2(best.u, best.v);
}

/** Color de la textura en el centro de un triángulo. */
const triUV = (tri) => tri.uv[0].clone().add(tri.uv[1]).add(tri.uv[2]).multiplyScalar(1 / 3);
const centroid = (tri) => tri.p[0].clone().add(tri.p[1]).add(tri.p[2]).multiplyScalar(1 / 3);

/**
 * Matriz que orienta (giro en Y), escala a `length` metros de largo (eje Z)
 * y centra el modelo en X/Z con el punto más bajo en y = 0.
 */
function fit(root, rotY, length) {
  const R = new THREE.Matrix4().makeRotationY(rotY);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh) return;
    m.multiplyMatrices(R, o.matrixWorld);
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(m));
  });
  const s = length / (box.max.z - box.min.z);
  const c = box.getCenter(new THREE.Vector3());
  return new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z)).multiply(R);
}

// --------------------------------------------------------------- utilidades
/**
 * Recorre las mallas y reparte sus triángulos (en espacio mundo, ya
 * orientados con `pre`) en cubetas {parte: {material: [geometrías]}} según
 * `classify(mesh, materialName, tri) -> {part, mat, color?, uv?} | null`.
 * Los materiales de `textured` conservan UV (o la fija `uv`) y normales
 * originales; `color` ([r, g, b] sRGB 0-255) se guarda como color de vértice.
 */
function collect(root, pre, classify, textured = new Set()) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  const add = (part, mat, g) => {
    if (!buckets.has(part)) buckets.set(part, new Map());
    const b = buckets.get(part);
    if (!b.has(mat)) b.set(mat, []);
    b.get(mat).push(g);
  };
  const m4 = new THREE.Matrix4();
  const meshes = [];
  root.traverse((o) => o.isMesh && meshes.push(o));
  for (const mesh of meshes) {
    const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    m4.multiplyMatrices(pre, mesh.matrixWorld);
    g.applyMatrix4(m4);
    // Espejos (escala negativa): se invierte el orden de los vértices.
    const flip = m4.determinant() < 0;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = mesh.geometry.groups.length ? mesh.geometry.groups : [{ start: 0, count: g.attributes.position.count, materialIndex: 0 }];
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    const nrm = g.attributes.normal;
    const tmp = new Map();
    for (const gr of groups) {
      const matName = mats[gr.materialIndex]?.name ?? '';
      for (let i = gr.start; i < gr.start + gr.count; i += 3) {
        const tri = { p: [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, i + k)), uv: uv ? [0, 1, 2].map((k) => new THREE.Vector2().fromBufferAttribute(uv, i + k)) : null };
        const c = classify(mesh, matName, tri);
        if (!c) continue;
        const key = `${c.part}\u0000${c.mat}`;
        if (!tmp.has(key)) tmp.set(key, []);
        tmp.get(key).push([i, c]);
      }
    }
    for (const [key, starts] of tmp) {
      const [part, mat] = key.split('\u0000');
      const keep = textured.has(mat) && uv;
      const ng = new THREE.BufferGeometry();
      const P = new Float32Array(starts.length * 9);
      const U = keep ? new Float32Array(starts.length * 6) : null;
      const N = keep && nrm ? new Float32Array(starts.length * 9) : null;
      const C = starts[0][1].color ? new Float32Array(starts.length * 9) : null;
      const col = new THREE.Color();
      starts.forEach(([s, c], j) => {
        // Colores cuantizados (pasos de 12): triángulos vecinos del mismo
        // color comparten vértices y el archivo queda más liviano.
        const q = (v) => Math.min(255, Math.round(v / 12) * 12) / 255;
        if (C) col.setRGB(q(c.color[0]), q(c.color[1]), q(c.color[2]), THREE.SRGBColorSpace);
        for (let k = 0; k < 3; k++) {
          const src = s + (flip ? [0, 2, 1][k] : k);
          P.set([pos.getX(src), pos.getY(src), pos.getZ(src)], j * 9 + k * 3);
          if (U) U.set(c.uv ? [c.uv.x, c.uv.y] : [uv.getX(src), uv.getY(src)], j * 6 + k * 2);
          if (N) N.set([nrm.getX(src), nrm.getY(src), nrm.getZ(src)], j * 9 + k * 3);
          if (C) C.set([col.r, col.g, col.b], j * 9 + k * 3);
        }
      });
      ng.setAttribute('position', new THREE.BufferAttribute(P, 3));
      if (U) ng.setAttribute('uv', new THREE.BufferAttribute(U, 2));
      if (C) ng.setAttribute('color', new THREE.BufferAttribute(C, 3));
      if (N) ng.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      add(part, mat, ng);
    }
  }
  return buckets;
}

// Colores base de cada clave (el juego reemplaza casi todos por sus
// materiales PBR; los que no conoce se quedan con este).
const COLORS = {
  pintura: 0xb0b4b8, vidrio: 0x10161b, negro: 0x151515, plastico: 0x2a2b2d, gris: 0x44474a, cromo: 0xcccccc,
  placa: 0xd8d8d8, faro: 0xfff4dc, stop: 0x8a0a0a, direccional: 0xd07010, caucho: 0x161616, rin: 0x9a9ea2, textura: 0xffffff,
  asiento: 0x2c2d30,
};

/**
 * Construye la escena normalizada: una malla por (parte, material); las
 * ruedas con el origen en su centro. Apoya en el piso (rueda más baja) y
 * centra en X/Z.
 */
function build(buckets, { crease = 35, textured = new Set() } = {}) {
  const all = new THREE.Box3();
  const wheelBox = new THREE.Box3();
  const parts = new Map();
  for (const [part, mats] of buckets) {
    const meshes = [];
    for (const [mat, geos] of mats) {
      let g = mergeGeometries(geos, false);
      if (!g.attributes.uv) {
        g.deleteAttribute('normal');
        // Suavizado por ángulo: menos facetas sin redondear aristas vivas.
        g = toCreasedNormals(g, THREE.MathUtils.degToRad(part.startsWith('rueda') ? 50 : crease));
      } else {
        if (!g.attributes.normal) g.computeVertexNormals();
        g = mergeVertices(g, 1e-5);
      }
      g.computeBoundingBox();
      all.union(g.boundingBox);
      if (part.startsWith('rueda')) wheelBox.union(g.boundingBox);
      meshes.push([mat, g]);
    }
    parts.set(part, meshes);
  }
  const off = new THREE.Vector3(-(all.min.x + all.max.x) / 2, -(wheelBox.isEmpty() ? all.min.y : wheelBox.min.y), -(all.min.z + all.max.z) / 2);
  const scene = new THREE.Group();
  scene.name = 'vehiculo';
  const matCache = new Map();
  const material = (name, vc) => {
    if (!matCache.has(name)) {
      // Con color de vértice ("detalle") o textura, el color base es blanco.
      const m = new THREE.MeshStandardMaterial({ color: textured.has(name) || vc ? 0xffffff : COLORS[name] ?? 0x888888, roughness: vc ? 0.6 : 0.5, vertexColors: vc });
      m.name = name;
      matCache.set(name, m);
    }
    return matCache.get(name);
  };
  // Origen de cada rueda en su eje; "horquilla_<x>" (piezas que viran con la
  // rueda <x> sin girar: guardabarros, mordaza) comparte el origen de "rueda_<x>".
  const centers = new Map();
  for (const [part, meshes] of parts) {
    if (!part.startsWith('rueda')) continue;
    const b = new THREE.Box3();
    for (const [, g] of meshes) b.union(g.boundingBox);
    centers.set(part, b.getCenter(new THREE.Vector3()).add(off));
  }
  for (const [part, meshes] of parts) {
    const node = new THREE.Group();
    node.name = part;
    const center = new THREE.Vector3();
    if (part.startsWith('rueda')) center.copy(centers.get(part));
    else if (part.startsWith('horquilla_')) center.copy(centers.get(part.replace('horquilla_', 'rueda_')) ?? center);
    for (const [mat, g] of meshes) {
      g.translate(off.x - center.x, off.y - center.y, off.z - center.z);
      const mesh = new THREE.Mesh(g, material(mat, !!g.attributes.color));
      mesh.name = `${part}_${mat}`;
      node.add(mesh);
    }
    node.position.copy(center);
    scene.add(node);
  }
  return scene;
}

function stats(scene) {
  let tris = 0;
  let meshes = 0;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  const b = new THREE.Box3().setFromObject(scene);
  const wheels = scene.children.filter((o) => o.name.startsWith('rueda')).map((o) => `${o.name}(${o.position.toArray().map((v) => v.toFixed(2)).join(',')})`);
  return { tris, meshes, size: b.getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)), wheels };
}

/**
 * Exporta a GLB con meshopt. `textures[clave] = {color, normal?, size}`: las
 * imágenes (PNG/JPG originales) se asignan al material de esa clave.
 */
async function write(scene, name, textures = {}) {
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(glb));
  const R = doc.getRoot();
  const cache = new Map();
  const texture = async (buf, size, label, gain = 1) => {
    const key = `${label}:${size}:${gain}:${buf.length}:${buf.subarray(0, 64).toString('hex')}`;
    if (!cache.has(key)) {
      let img = sharp(buf).resize(size, size, { fit: 'fill' });
      // `gain`: aclara u oscurece el color (p. ej. pintura blanca de la buseta).
      if (gain !== 1) img = img.linear(gain, 0);
      const png = await img.png().toBuffer();
      cache.set(key, doc.createTexture(label).setImage(png).setMimeType('image/png'));
    }
    return cache.get(key);
  };
  for (const mat of R.listMaterials()) {
    const t = textures[mat.getName()];
    if (!t) continue;
    mat.setBaseColorTexture(await texture(t.color, t.size ?? 512, `${mat.getName()}_color`, t.gain));
    if (t.normal) mat.setNormalTexture(await texture(t.normal, t.size ?? 512, `${mat.getName()}_normal`));
    if (t.metal !== undefined) mat.setMetallicFactor(t.metal).setRoughnessFactor(t.rough ?? 0.5);
  }
  // Sin deduplicar materiales: pintura, faro, stop y detalles pueden compartir
  // textura y valores, pero el juego los distingue por nombre.
  await doc.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.TEXTURE] }), weld(), prune({ keepLeaves: true }));
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }));
  await MeshoptEncoder.ready;
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(OUT, `${name}.glb`);
  await io.write(out, doc);
  const st = stats(scene);
  console.log(`${name}.glb`, (fs.statSync(out).size / 1024).toFixed(0), 'KB', st.tris, 'triángulos', st.meshes, 'mallas', st.size.join(' x '), 'm');
  console.log('   ruedas', st.wheels.join(' '));
  return { name, bytes: fs.statSync(out).size, ...st };
}

/** Clave de un triángulo por sus vértices (igual en dos pasadas de `collect` con la misma matriz). */
const triKey = (tri) => tri.p.map((p) => `${p.x.toFixed(5)},${p.y.toFixed(5)},${p.z.toFixed(5)}`).join('|');

/**
 * Triángulos (por triKey) de las piezas que giran con cada rueda: piezas
 * conectadas (vértices compartidos) dentro del cilindro de la rueda que dan
 * la vuelta completa alrededor del eje, o que están pegadas a él.
 */
function spinningPieces(scene, pre, wheels) {
  const tris = [];
  collect(scene, pre, (mesh, mat, tri) => {
    for (const w of wheels) {
      if (tri.p.every((p) => Math.abs(p.x) < w.hw + 0.012 && Math.hypot(p.z - w.c.z, p.y - w.c.y) < w.r + 0.01)) {
        tris.push({ tri, w });
        break;
      }
    }
    return null;
  });
  // Unión-búsqueda por vértice (posición cuantizada a 0.1 mm).
  const parent = new Map();
  const find = (k) => {
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)));
      k = parent.get(k);
    }
    return k;
  };
  const vk = (p) => `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)},${Math.round(p.z * 1e4)}`;
  for (const { tri } of tris) {
    const ks = tri.p.map(vk);
    for (const k of ks) if (!parent.has(k)) parent.set(k, k);
    for (let i = 1; i < 3; i++) {
      const a = find(ks[0]);
      const b = find(ks[i]);
      if (a !== b) parent.set(b, a);
    }
  }
  const pieces = new Map();
  for (const t of tris) {
    const root = find(vk(t.tri.p[0]));
    if (!pieces.has(root)) pieces.set(root, { tris: [], w: t.w, bins: new Set(), rmax: 0 });
    const pc = pieces.get(root);
    pc.tris.push(t.tri);
    for (const p of t.tri.p) {
      const dz = p.z - t.w.c.z;
      const dy = p.y - t.w.c.y;
      const r = Math.hypot(dz, dy);
      pc.rmax = Math.max(pc.rmax, r);
      if (r > 0.02) pc.bins.add(Math.floor(((Math.atan2(dy, dz) + Math.PI) / (2 * Math.PI)) * 36) % 36);
    }
  }
  const out = new Set();
  const resumen = {};
  const main = new Map(); // pieza giratoria más grande de cada rueda (la llanta)
  for (const pc of pieces.values()) {
    // Redonda y centrada en el eje (la cadena también rodea el eje, pero es alargada).
    const b = new THREE.Box3();
    for (const t of pc.tris) for (const p of t.p) b.expandByPoint(p);
    const dy = b.max.y - b.min.y;
    const dz = b.max.z - b.min.z;
    const round = Math.abs(dy - dz) < 0.12 * Math.max(dy, dz) && Math.abs((b.min.y + b.max.y) / 2 - pc.w.c.y) < 0.06 && Math.abs((b.min.z + b.max.z) / 2 - pc.w.c.z) < 0.06;
    const spins = (pc.bins.size >= 30 && round) || pc.rmax < 0.06;
    if (spins && pc.rmax > 0.2) {
      // La llanta es la pieza giratoria de mayor diámetro (la que toca el piso).
      pc.box = new THREE.Box3();
      for (const t of pc.tris) for (const p of t.p) pc.box.expandByPoint(p);
      const d = (b) => b.max.z - b.min.z;
      if (!main.has(pc.w.part) || d(pc.box) > d(main.get(pc.w.part).box)) main.set(pc.w.part, pc);
    }
    const k = `${pc.w.part} ${spins ? 'gira' : 'fija'}`;
    resumen[k] = (resumen[k] ?? 0) + pc.tris.length;
    if (process.env.DEBUG_MOTO && pc.tris.length > 20) {
      const b = new THREE.Box3();
      for (const t of pc.tris) for (const p of t.p) b.expandByPoint(p);
      console.log(k, pc.tris.length, 'bins', pc.bins.size, 'rmax', pc.rmax.toFixed(3), 'min', b.min.toArray().map((v) => v.toFixed(3)).join(','), 'max', b.max.toArray().map((v) => v.toFixed(3)).join(','));
    }
    if (spins) for (const t of pc.tris) out.add(triKey(t));
  }
  console.log('moto piezas de rueda (triángulos):', JSON.stringify(resumen));
  const boxes = new Map();
  for (const [part, pc] of main) boxes.set(part, pc.box);
  return { keys: out, boxes };
}

/** Rueda por cuadrante (frente en -Z, izquierda en -X). */
const quadWheel = (c) => `rueda_${c.z < 0 ? 'del' : 'tras'}_${c.x < 0 ? 'izq' : 'der'}`;

/** Simplifica (meshoptimizer) las geometrías de una clave de material. */
async function simplify(buckets, matKey, ratio) {
  await MeshoptSimplifier.ready;
  for (const [, mats] of buckets) {
    const geos = mats.get(matKey);
    if (!geos) continue;
    const merged = mergeVertices(mergeGeometries(geos, false).deleteAttribute('normal'), 1e-4);
    const idx = new Uint32Array(merged.index.array);
    const target = Math.floor((idx.length * ratio) / 3) * 3;
    const [out] = MeshoptSimplifier.simplify(idx, merged.attributes.position.array, 3, target, 0.02);
    merged.setIndex(new THREE.BufferAttribute(out, 1));
    mats.set(matKey, [merged.toNonIndexed()]);
  }
}

// --------------------------------------------------------------- modelos
/**
 * Autos de Daniel Zhabotinsky ("Kiri '10" sedán y "Urban '10" camioneta):
 * pintura sin textura, detalles (rejillas, bajos, rines) con su textura de
 * 512 px, faros/stops con la textura de luces y llantas con la de caucho.
 * El frente está en -X; las cuatro ruedas vienen en una sola malla.
 */
async function zhabotinsky(key, name, length, prefix) {
  const { scene, tex } = await loadSource(key);
  const pre = fit(scene, -Math.PI / 2, length);
  const T = (s) => `${prefix}_${s}`;
  const map = {
    [T('body')]: 'pintura', [T('bottom')]: 'textura', [T('void')]: 'negro', [T('glass_rim')]: 'negro', [T('glass')]: 'vidrio',
    '07_-_Default': 'negro', plastic: 'plastico',
  };
  const tire = [...tex.keys()].find((k) => /tier/.test(k));
  const lamps = T('headlights');
  // Las llantas usan un punto oscuro de la textura de detalles: así cada
  // rueda es una sola malla (una llamada de dibujo) con el rin texturizado.
  const dark = await darkSpot(tex.get(T('bottom')).color);
  const textured = new Set(['textura', 'faro', 'stop']);
  const buckets = collect(
    scene,
    pre,
    (mesh, mat, tri) => {
      const c = centroid(tri);
      if (/^wheels/.test(mesh.name)) return { part: quadWheel(c), mat: 'textura', uv: mat === tire ? dark : undefined };
      // Micas de los faros: se omiten (el faro queda visible debajo).
      if (mat === T('glass') && (/light/.test(mesh.name) || c.y < 0.92)) return null;
      if (mat === lamps) return { part: 'carroceria', mat: c.z < 0 ? 'faro' : 'stop' };
      return { part: 'carroceria', mat: map[mat] ?? 'plastico' };
    },
    textured,
  );
  const t = (m) => tex.get(m).color;
  return write(build(buckets, { textured }), name, {
    // Algo metálico: rines, rejillas y cromados no se ven blancos.
    textura: { color: t(T('bottom')), size: 512, metal: 0.45, rough: 0.4, gain: 0.78 },
    faro: { color: t(lamps), size: 512 },
    stop: { color: t(lamps), size: 512 },
  });
}

/**
 * "Ace '11" (hatchback moderno, tipo Chevrolet Sonic/Aveo): taxi. Carrocería,
 * ruedas y luces comparten un atlas de 1024 px con mapa de normales; la
 * pintura (blanca en el atlas) se separa por color para teñirla de amarillo.
 */
async function ace() {
  const { scene, tex } = await loadSource('ace');
  const pre = fit(scene, -Math.PI / 2, 4.0);
  const body = tex.get('MODERNHATCH_body');
  const px = await sampler(body.color);
  const textured = new Set(['textura', 'pintura', 'faro', 'stop']);
  const buckets = collect(
    scene,
    pre,
    (mesh, mat, tri) => {
      const n = mesh.name;
      const c = centroid(tri);
      const w = /^wheel_(f|r)(l|r)/.exec(n);
      // En el original la izquierda está en +Z (antes de girar).
      if (w) return { part: `rueda_${w[1] === 'f' ? 'del' : 'tras'}_${c.x < 0 ? 'izq' : 'der'}`, mat: 'textura' };
      if (mat === 'GLASS') return /^headlights/.test(n) ? null : { part: 'carroceria', mat: 'vidrio' };
      if (mat === 'MODERNHATCH_INTERIOR') return { part: 'carroceria', mat: 'negro' };
      if (/^headlights/.test(n)) return { part: 'carroceria', mat: 'faro' };
      const [r, g, b] = px(triUV(tri));
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      // Stops: rojo intenso en la parte trasera.
      if (c.z > 1.6 && r > 90 && r > g * 1.8 && r > b * 1.8) return { part: 'carroceria', mat: 'stop' };
      // Pintura: zonas claras y sin color del atlas.
      if (max > 150 && max - min < 28) return { part: 'carroceria', mat: 'pintura' };
      return { part: 'carroceria', mat: 'textura' };
    },
    textured,
  );
  const atlas = { color: body.color, normal: body.normal, size: 1024 };
  return write(build(buckets, { textured }), 'hatchback', { textura: atlas, pintura: atlas, faro: atlas, stop: atlas });
}

/**
 * "Busscar Micruss" (microbús carrozado en Colombia/Brasil): buseta. La
 * carrocería conserva su textura (blanca, con marcos de ventanas); lo demás
 * pasa a colores planos para ahorrar texturas y llamadas de dibujo.
 * Frente en +Z; ruedas separadas (traseras dobles).
 */
async function buseta() {
  const { scene, tex } = await loadSource('micruss');
  const pre = fit(scene, Math.PI, 7.8);
  const map = { Body: 'pintura', Details: 'textura', Windows: 'vidrio' };
  const px = new Map();
  for (const [k, v] of tex) if (v.color) px.set(k, await sampler(v.color));
  const textured = new Set(['pintura', 'textura', 'faro', 'stop']);
  const buckets = collect(
    scene,
    pre,
    (mesh, mat, tri) => {
      const c = centroid(tri);
      // Lo demás (bajos, interior, sillas, espejos, ruedas): color de vértice
      // tomado de su textura en el centro de cada triángulo.
      const color = px.get(mat)?.(triUV(tri));
      if (/^Tire/.test(mesh.name)) return { part: quadWheel(c), mat: 'detalle', color };
      if (mat === 'InteriorWindow') return null;
      if (mat === 'Lights') return { part: 'carroceria', mat: c.z < 0 ? 'faro' : 'stop' };
      if (map[mat]) return { part: 'carroceria', mat: map[mat] };
      // Sillas: un solo color (así se pueden simplificar).
      if (mat === 'Seats') return { part: 'carroceria', mat: 'asiento', color: [58, 60, 64] };
      return { part: 'carroceria', mat: 'detalle', color };
    },
    textured,
  );
  // Sillas (muchos triángulos, apenas se ven por las ventanas): a la mitad y
  // unidas al resto de detalles.
  await simplify(buckets, 'asiento', 0.45);
  const body = buckets.get('carroceria');
  body.set('detalle', [...body.get('detalle'), ...body.get('asiento')]);
  body.delete('asiento');
  const t = (m, size = 1024, normal = false) => ({ color: tex.get(m).color, normal: normal ? tex.get(m).normal : null, size });
  return write(build(buckets, { crease: 30, textured }), 'buseta', {
    // La pintura del original es gris claro: se lleva casi a blanco para que
    // el color del juego se vea limpio; los detalles (empaques) se oscurecen.
    pintura: { ...t('Body', 1024), gain: 1.22 },
    textura: { ...t('Details', 512), gain: 0.55 },
    faro: t('Lights', 512),
    stop: t('Lights', 512),
  });
}

/**
 * "pulsar 135 ls" (Bajaj Pulsar 135 LS, la moto de calle típica de
 * Medellín): el modelo es una sola malla con texturas de colores planos; se
 * convierte a materiales planos muestreando la textura en cada triángulo
 * (naranja = pintura, que el juego cambia de color). Las ruedas se separan
 * por cilindros alrededor de cada llanta. Frente en -Z.
 */
async function moto() {
  const { scene, tex } = await loadSource('pulsar');
  const pre = fit(scene, 0, 2.0);
  const px = new Map();
  for (const [k, v] of tex) if (v.color) px.set(k, await sampler(v.color));
  // Llantas: triángulos de caucho oscuro en el plano medio, lejos del motor
  // (|z| > 0.28 m). Su extensión en Z es el diámetro de cada rueda.
  const tires = { del: new THREE.Box3(), tras: new THREE.Box3() };
  collect(scene, pre, (mesh, mat, tri) => {
    if (mat !== 'caucho') return null;
    const c = centroid(tri);
    const [r, g, b] = px.get(mat)(triUV(tri));
    if (Math.max(r, g, b) > 60 || Math.abs(c.x) > 0.08 || Math.abs(c.z) < 0.28) return null;
    for (const p of tri.p) tires[c.z < 0 ? 'del' : 'tras'].expandByPoint(p);
    return null;
  });
  const wheels = Object.entries(tires).map(([k, b]) => {
    const r = (b.max.z - b.min.z) / 2;
    const c = new THREE.Vector3(0, b.min.y + r, (b.min.z + b.max.z) / 2);
    const hw = Math.max(Math.abs(b.min.x), Math.abs(b.max.x));
    console.log('moto rueda', k, 'centro', c.toArray().map((v) => v.toFixed(3)).join(','), 'radio', r.toFixed(3), 'ancho', (hw * 2).toFixed(3));
    return { part: `rueda_${k}`, c, r, hw };
  });
  // Dentro del cilindro de cada rueda no todo gira: el guardabarros, la
  // mordaza del freno y la punta de la horquilla (o el guardacadena atrás)
  // quedan quietos. Se separan por piezas conectadas: solo gira la pieza que
  // da la vuelta completa alrededor del eje (llanta, rin, disco, piñón) o la
  // que está pegada al eje (tapas); lo demás de la rueda delantera va en
  // "horquilla_del" (vira con la dirección, sin girar) y lo de atrás, en la
  // carrocería.
  // El eje estimado con los triángulos de caucho queda corrido unos cm: se
  // corrige con la caja de la llanta completa (primera pasada) y se repite.
  let spin = spinningPieces(scene, pre, wheels);
  for (const w of wheels) {
    const b = spin.boxes.get(w.part);
    if (!b) continue;
    w.r = (b.max.z - b.min.z) / 2;
    w.c.set(0, b.min.y + w.r, (b.min.z + b.max.z) / 2);
    console.log('moto eje corregido', w.part, w.c.toArray().map((v) => v.toFixed(3)).join(','), 'radio', w.r.toFixed(3));
  }
  spin = spinningPieces(scene, pre, wheels);
  const spinning = spin.keys;
  const buckets = collect(scene, pre, (mesh, mat, tri) => {
    if (mat === 'glass') return { part: 'carroceria', mat: 'vidrio' };
    const color = px.get(mat)(triUV(tri));
    const c = centroid(tri);
    for (const w of wheels) {
      const inside = tri.p.every((p) => Math.abs(p.x) < w.hw + 0.012 && Math.hypot(p.z - w.c.z, p.y - w.c.y) < w.r + 0.01);
      if (!inside) continue;
      if (spinning.has(triKey(tri))) return { part: w.part, mat: 'detalle', color };
      if (w.part === 'rueda_del') return mat === 'plastico_0' && Math.max(...color) < 80 ? { part: 'horquilla_del', mat: 'pintura' } : { part: 'horquilla_del', mat: 'detalle', color };
      break;
    }
    // Carenaje, tanque, colín y guardabarros: base oscura de "plastico_0"
    // (las calcomanías blancas y naranjas se conservan).
    if (mat === 'plastico_0' && Math.max(...color) < 80) return { part: 'carroceria', mat: 'pintura' };
    // Faro: la zona clara de la textura de caucho, al frente.
    if (mat === 'caucho' && Math.max(...color) > 120 && c.z < -0.4) return { part: 'carroceria', mat: 'faro' };
    return { part: 'carroceria', mat: 'detalle', color };
  });
  return write(build(buckets, { crease: 40 }), 'moto');
}

function credits() {
  const lines = [
    'Modelos 3D de vehículos (public/models/vehiculos/*.glb)',
    'Licencia de todos: Creative Commons Attribution 4.0 International (CC BY 4.0)',
    'https://creativecommons.org/licenses/by/4.0/',
    'Modificados para el juego: reorientados, escalados, materiales reagrupados,',
    'ruedas separadas, texturas reducidas y comprimidas (scripts/assets/vehiculos.mjs).',
    '',
  ];
  const uses = { ace: 'hatchback.glb (taxi)', kiri: 'sedan.glb (sedán)', urban: 'suv.glb (camioneta y patrulla)', micruss: 'buseta.glb (buseta)', pulsar: 'moto.glb (moto)' };
  for (const [k, s] of Object.entries(SOURCES)) {
    lines.push(`${uses[k]}: "${s.title}" por ${s.author}`, `  ${s.url}`, `  This work is based on "${s.title}" (${s.url}) by ${s.author} licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)`, '');
  }
  fs.writeFileSync(path.join(OUT, 'CREDITOS.txt'), lines.join('\n'));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2);
  const jobs = {
    taxi: ace,
    sedan: () => zhabotinsky('kiri', 'sedan', 4.45, 'solar'),
    suv: () => zhabotinsky('urban', 'suv', 4.4, 'dust'),
    buseta,
    moto,
  };
  const res = [];
  for (const [k, fn] of Object.entries(jobs)) if (!only.length || only.includes(k)) res.push(await fn());
  credits();
  const total = res.reduce((a, r) => a + r.bytes, 0);
  console.log('total', (total / 1e6).toFixed(2), 'MB');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
