// Descarga y procesa los modelos 3D de vehículos (todos CC0) para el juego.
// Reproducible: `node scripts/assets/vehiculos.mjs` (usa caché en .cache/).
//
// Cada modelo se normaliza a un formato común que entiende VehicleView:
//  - metros, eje Y hacia arriba, frente hacia -Z, piso en y = 0, centrado en X/Z;
//  - nodo "carroceria" con una malla por material, nombrada con una clave
//    estándar (pintura, vidrio, negro, plastico, cromo, faro, stop, ...);
//  - una rueda por nodo ("rueda_del_izq", "rueda_tras", ...) con el origen en
//    el eje, para que el juego las haga girar y virar;
//  - normales suavizadas por ángulo (se ve menos facetado), sin UV ni colores
//    de vértice salvo que haya textura; meshopt + texturas webp ≤ 1024 px.
//
// Salida: public/models/vehiculos/*.glb

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

// three.js en Node: los cargadores solo necesitan `self` y el exportador un
// FileReader mínimo.
globalThis.self ??= globalThis;
globalThis.FileReader ??= class {
  readAsArrayBuffer(b) {
    b.arrayBuffer().then((r) => {
      this.result = r;
      this.onloadend?.({ target: this });
      this.onload?.({ target: this });
    });
  }
  readAsDataURL(b) {
    b.arrayBuffer().then((r) => {
      this.result = `data:${b.type};base64,` + Buffer.from(r).toString('base64');
      this.onloadend?.({ target: this });
      this.onload?.({ target: this });
    });
  }
};

const THREE = await import('three');
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
const { MTLLoader } = await import('three/examples/jsm/loaders/MTLLoader.js');
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
const { mergeGeometries, toCreasedNormals, mergeVertices } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
const { NodeIO } = await import('@gltf-transform/core');
const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');
const { dedup, prune, weld, meshopt, textureCompress } = await import('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder } = await import('meshoptimizer');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const CACHE = path.join(ROOT, '.cache/vehiculos');
const OUT = path.join(ROOT, 'public/models/vehiculos');

// --------------------------------------------------------------- fuentes
const drive = (id) => `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
const OGA = 'https://opengameart.org/sites/default/files/';

// Quaternius "Cars Pack" (CC0): https://quaternius.com/packs/cars.html
const QUATERNIUS = {
  'License.txt': drive('1CqsvhpIzBNSDlZsBWdJcJNC1B-TE3cXK'),
  'NormalCar1.fbx': drive('1Xxe0nYbAx5epeoY8nT9kY48e9vG3LPWK'),
  'SUV.fbx': drive('1r4gr34s-cNetFINZio-M4i8m2PgzVq_5'),
};

const isHtml = (buf) => /^\s*<(!doctype|html)/i.test(buf.subarray(0, 64).toString('latin1'));

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0 && !isHtml(fs.readFileSync(file))) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Google Drive a veces responde con una página de "cuota excedida": se
  // reintenta y nunca se guarda HTML en la caché.
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

async function zip(name) {
  const file = await download(OGA + name, path.join(CACHE, name));
  const dir = file.replace(/\.zip$/, '');
  if (!fs.existsSync(dir)) execFileSync('unzip', ['-q', '-o', file, '-d', dir]);
  return dir;
}

const ab = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

function loadFBX(file) {
  return new FBXLoader().parse(ab(fs.readFileSync(file)), path.dirname(file) + '/');
}

function loadOBJ(file) {
  const loader = new OBJLoader();
  const mtl = file.replace(/\.obj$/i, '.mtl');
  if (fs.existsSync(mtl)) {
    const m = new MTLLoader().parse(fs.readFileSync(mtl, 'utf8'), '');
    loader.setMaterials(m);
  }
  return loader.parse(fs.readFileSync(file, 'utf8'));
}

/** GLB con texturas: devuelve la escena (sin imágenes) y la primera imagen. */
async function loadGLB(file) {
  const io = new NodeIO();
  const doc = await io.read(file);
  const tex = doc.getRoot().listTextures()[0];
  const image = tex ? Buffer.from(tex.getImage()) : null;
  for (const t of doc.getRoot().listTextures()) t.dispose();
  const glb = await io.writeBinary(doc);
  const scene = await new Promise((res, rej) => new GLTFLoader().parse(ab(Buffer.from(glb)), '', (g) => res(g.scene), rej));
  return { scene, image };
}

// --------------------------------------------------------------- utilidades
/**
 * Recorre las mallas y reparte sus triángulos (en espacio mundo, ya
 * orientados con `pre`) en cubetas {parte: {material: [geometrías]}} según
 * `classify(mesh, materialName, tri) -> {part, mat} | null`.
 */
function collect(root, pre, classify, keepUV = false) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  const add = (part, mat, g) => {
    if (!buckets.has(part)) buckets.set(part, new Map());
    const b = buckets.get(part);
    if (!b.has(mat)) b.set(mat, []);
    b.get(mat).push(g);
  };
  const m4 = new THREE.Matrix4();
  root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    let g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    m4.multiplyMatrices(pre, mesh.matrixWorld);
    g.applyMatrix4(m4);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = mesh.geometry.groups.length ? mesh.geometry.groups : [{ start: 0, count: g.attributes.position.count, materialIndex: 0 }];
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    // Triángulo a triángulo: permite dividir por posición (ruedas de la moto,
    // colores de paleta).
    const tmp = new Map();
    for (const gr of groups) {
      const matName = mats[gr.materialIndex]?.name ?? '';
      for (let i = gr.start; i < gr.start + gr.count; i += 3) {
        const tri = { p: [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, i + k)), uv: uv ? [0, 1, 2].map((k) => new THREE.Vector2().fromBufferAttribute(uv, i + k)) : null };
        const c = classify(mesh, matName, tri);
        if (!c) continue;
        const key = `${c.part}\u0000${c.mat}`;
        if (!tmp.has(key)) tmp.set(key, []);
        tmp.get(key).push(i);
      }
    }
    for (const [key, starts] of tmp) {
      const [part, mat] = key.split('\u0000');
      const ng = new THREE.BufferGeometry();
      const P = new Float32Array(starts.length * 9);
      const U = keepUV && uv ? new Float32Array(starts.length * 6) : null;
      const nrm = g.attributes.normal;
      const N = keepUV && nrm ? new Float32Array(starts.length * 9) : null;
      starts.forEach((s, j) => {
        for (let k = 0; k < 3; k++) {
          P.set([pos.getX(s + k), pos.getY(s + k), pos.getZ(s + k)], j * 9 + k * 3);
          if (U) U.set([uv.getX(s + k), uv.getY(s + k)], j * 6 + k * 2);
          if (N) N.set([nrm.getX(s + k), nrm.getY(s + k), nrm.getZ(s + k)], j * 9 + k * 3);
        }
      });
      ng.setAttribute('position', new THREE.BufferAttribute(P, 3));
      if (U) ng.setAttribute('uv', new THREE.BufferAttribute(U, 2));
      if (N) ng.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      add(part, mat, ng);
    }
  });
  return buckets;
}

const COLORS = {
  pintura: 0xb0b4b8, vidrio: 0x10161b, negro: 0x151515, plastico: 0x2a2b2d, gris: 0x44474a, cromo: 0xcccccc,
  placa: 0xd8d8d8, faro: 0xfff4dc, stop: 0x8a0a0a, direccional: 0xd07010, caucho: 0x161616, rin: 0x9a9ea2, textura: 0xffffff,
};

/**
 * Construye la escena normalizada. `wheelInfo[part] = true` marca las ruedas.
 * Escala a metros con `scale`, apoya en el piso y centra.
 */
function build(buckets, { crease = 35, textureMat = null } = {}) {
  const all = new THREE.Box3();
  const wheelBox = new THREE.Box3();
  const parts = new Map();
  for (const [part, mats] of buckets) {
    const meshes = [];
    for (const [mat, geos] of mats) {
      let g = mergeGeometries(geos, false);
      if (!g.attributes.uv) {
        // Suavizado por ángulo: menos facetas sin redondear aristas vivas.
        g = toCreasedNormals(g, THREE.MathUtils.degToRad(part.startsWith('rueda') ? 50 : crease));
      } else {
        // Con textura se conservan las normales originales del autor.
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
  // Piso: punto más bajo de las ruedas; centro: caja total en X/Z.
  const off = new THREE.Vector3(-(all.min.x + all.max.x) / 2, -(wheelBox.isEmpty() ? all.min.y : wheelBox.min.y), -(all.min.z + all.max.z) / 2);
  const scene = new THREE.Group();
  scene.name = 'vehiculo';
  const matCache = new Map();
  const material = (name) => {
    if (!matCache.has(name)) {
      const m = name === 'textura' && textureMat ? textureMat : new THREE.MeshStandardMaterial({ color: COLORS[name] ?? 0x888888, roughness: 0.5 });
      m.name = name;
      matCache.set(name, m);
    }
    return matCache.get(name);
  };
  for (const [part, meshes] of parts) {
    const node = new THREE.Group();
    node.name = part;
    let center = new THREE.Vector3();
    if (part.startsWith('rueda')) {
      const b = new THREE.Box3();
      for (const [, g] of meshes) b.union(g.boundingBox);
      b.getCenter(center).add(off);
    }
    for (const [mat, g] of meshes) {
      g.translate(off.x - center.x, off.y - center.y, off.z - center.z);
      const mesh = new THREE.Mesh(g, material(mat));
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
  scene.traverse((o) => {
    if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  const b = new THREE.Box3().setFromObject(scene);
  return { tris, size: b.getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(2)) };
}

async function write(scene, name, textures = null) {
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.readBinary(new Uint8Array(glb));
  if (textures) await textures(doc);
  await doc.transform(dedup(), weld(), prune({ keepLeaves: true }));
  if (textures) await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 85 }));
  await MeshoptEncoder.ready;
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(OUT, `${name}.glb`);
  await io.write(out, doc);
  const st = stats(scene);
  console.log(`${name}.glb`, (fs.statSync(out).size / 1024).toFixed(0), 'KB', st.tris, 'triángulos', st.size.join(' x '), 'm');
  return { name, bytes: fs.statSync(out).size, ...st };
}

// --------------------------------------------------------------- modelos
const Q_MAT = {
  Yellow: 'pintura', White: 'pintura', Blue: 'pintura', LightBlue: 'pintura',
  Windows: 'vidrio', Black: 'negro', Grey: 'gris', Headlights: 'faro', TailLights: 'stop',
  WhiteLights: 'cromo', BlueLights: 'cromo', DarkOrange: 'negro',
};

/** Quaternius Cars Pack: frente -Z, centímetros, ruedas separadas. */
async function quaternius(file, name) {
  const src = await download(QUATERNIUS[file], path.join(CACHE, 'quaternius-cars', file));
  const root = loadFBX(src);
  const pre = new THREE.Matrix4().makeScale(0.01, 0.01, 0.01);
  const buckets = collect(root, pre, (mesh, mat) => {
    const n = mesh.name;
    const wheel = /FrontLeftWheel/.test(n) ? 'rueda_del_izq' : /FrontRightWheel/.test(n) ? 'rueda_del_der' : /BackWheels/.test(n) ? 'rueda_tras' : null;
    if (wheel) return { part: wheel, mat: mat === 'Black' ? 'caucho' : 'rin' };
    return { part: 'carroceria', mat: Q_MAT[mat] ?? 'plastico' };
  });
  return write(build(buckets), name);
}

/** "Red Car" de mabaci (CC0): hatchback con textura de paleta; frente +Z. */
async function hatchback() {
  const dir = await zip('redcar.zip');
  const { scene, image } = await loadGLB(path.join(dir, 'RedCar.glb'));
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const cellOf = (uv) => [Math.floor((uv.x * info.width) / 68.2), Math.floor((uv.y * info.height) / 68.2)];
  const pre = new THREE.Matrix4().makeRotationY(Math.PI);
  const buckets = collect(scene, pre, (mesh, mat, tri) => {
    const wheel = { FrontLeftTire: 'rueda_del_izq', FrontRightTire: 'rueda_del_der', RearLeftTire: 'rueda_tras_izq', RearRightTire: 'rueda_tras_der' }[mesh.name];
    const uv = tri.uv[0].clone().add(tri.uv[1]).add(tri.uv[2]).multiplyScalar(1 / 3);
    const [cx, cy] = cellOf(uv);
    if (wheel) return { part: wheel, mat: cx === 1 && cy === 0 ? 'caucho' : 'rin' };
    if (mat === 'Glass') return { part: 'carroceria', mat: 'vidrio' };
    // Ya rotado: frente en -Z.
    const z = (tri.p[0].z + tri.p[1].z + tri.p[2].z) / 3;
    const cell = `${cx},${cy}`;
    const byCell = {
      '4,1': 'pintura', '1,0': 'negro', '2,0': 'plastico', '3,0': 'plastico', '5,0': 'placa', '7,0': 'cromo',
      '9,0': 'faro', '4,6': 'direccional', '2,6': 'stop', '3,1': 'faro',
    };
    if (cell === '7,6') return { part: 'carroceria', mat: z > 0.8 ? 'stop' : 'negro' };
    return { part: 'carroceria', mat: byCell[cell] ?? 'plastico' };
  });
  // El original es de escala arbitraria (2.16 u de largo): a 3.7 m (taxi).
  const scene2 = build(buckets);
  const len = new THREE.Box3().setFromObject(scene2).getSize(new THREE.Vector3()).z;
  const s = 3.7 / len;
  scene2.traverse((o) => {
    if (o.isMesh) o.geometry.scale(s, s, s);
    else if (o !== scene2) o.position.multiplyScalar(s);
  });
  return write(scene2, 'hatchback');
}

/** "3D Bus" de ajanhallinta (CC0): +X al frente, Y arriba, metros. */
async function buseta() {
  const dir = await zip('3DBus_by_ajanhallinta.zip');
  const root = loadOBJ(path.join(dir, 'OBJ/BUS.obj'));
  const pre = new THREE.Matrix4().makeRotationY(Math.PI / 2);
  const map = { Body: 'pintura', Windows: 'vidrio', karmi: 'negro', RearLights: 'stop', FrontLights: 'faro', Indicators: 'direccional', Metal: 'rin', Tire: 'caucho', Bolt: 'negro' };
  const buckets = collect(root, pre, (mesh, mat) => {
    const m = /^wheel(FL|FR|LR|RR)/.exec(mesh.name);
    // En el OBJ, +Z es el lado izquierdo del bus antes de rotar.
    const part = m ? { FL: 'rueda_del_a', FR: 'rueda_del_b', LR: 'rueda_tras_a', RR: 'rueda_tras_b' }[m[1]] : 'carroceria';
    return { part, mat: map[mat] ?? 'plastico' };
  });
  return write(build(buckets, { crease: 30 }), 'buseta');
}

/** Harley-Davidson FLH 1972 de elopez7 (CC0), versión low poly con PBR. */
async function moto() {
  const dir = await zip('FLH1200.zip');
  const root = loadFBX(path.join(dir, 'OPEN_GAME/MODELS/Bike_new_low.fbx'));
  // +X al frente y en cm -> -Z y metros.
  const pre = new THREE.Matrix4().makeRotationY(Math.PI / 2).premultiply(new THREE.Matrix4().makeScale(0.01, 0.01, 0.01));
  // Ruedas: el modelo es una sola malla. Se localiza cada rueda (anillo de la
  // llanta tocando el piso) y se separan los triángulos dentro del cilindro.
  root.updateMatrixWorld(true);
  const verts = [];
  root.traverse((m) => {
    if (!m.isMesh) return;
    const p = m.geometry.attributes.position;
    const M = new THREE.Matrix4().multiplyMatrices(pre, m.matrixWorld);
    for (let i = 0; i < p.count; i++) verts.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(M));
  });
  const minY = Math.min(...verts.map((v) => v.y));
  const wheels = [];
  for (const sign of [-1, 1]) {
    // sign -1: rueda delantera (z < 0).
    const ground = verts.filter((v) => v.y < minY + 0.03 && Math.sign(v.z) === sign);
    const cz = ground.reduce((a, v) => a + v.z, 0) / ground.length;
    // Radio exterior de la llanta: a la altura aproximada del eje, la mayor
    // distancia horizontal que aparece simétrica a ambos lados del centro.
    let r = 0.35;
    for (let it = 0; it < 3; it++) {
      const d = verts.filter((v) => Math.abs(v.x) < 0.09 && Math.abs(v.y - (minY + r)) < 0.03 && Math.abs(v.z - cz) < 0.45).map((v) => v.z - cz);
      const sym = d.filter((a) => a > 0.2 && d.some((b) => Math.abs(b + a) < 0.004));
      if (sym.length) r = Math.max(...sym);
    }
    const best = { r };
    wheels.push({ part: sign < 0 ? 'rueda_del' : 'rueda_tras', z: cz, y: minY + best.r, r: best.r });
    console.log('moto rueda', sign < 0 ? 'delantera' : 'trasera', 'z', cz.toFixed(3), 'radio', best.r.toFixed(3));
  }
  const buckets = collect(
    root,
    pre,
    (mesh, mat, tri) => {
      for (const w of wheels) {
        const inside = tri.p.every((p) => Math.abs(p.x) < 0.085 && Math.hypot(p.z - w.z, p.y - w.y) < w.r + 0.008);
        if (inside) return { part: w.part, mat: 'textura' };
      }
      return { part: 'carroceria', mat: 'textura' };
    },
    true,
  );
  const texDir = path.join(dir, 'OPEN_GAME/TEXTURES_UNITY');
  const tm = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const scene = build(buckets, { textureMat: tm });
  return write(scene, 'moto', async (doc) => {
    // Texturas PBR: color, normal y ORM (oclusión, rugosidad, metal).
    const R = doc.getRoot();
    const mat = R.listMaterials().find((m) => m.getName() === 'textura');
    // Las UV del FBX usan v hacia arriba (convención de three.js con flipY) y
    // glTF v hacia abajo: se voltean las imágenes en vertical.
    const img = async (f, size = 1024) => sharp(path.join(texDir, f)).flip().resize(size, size).png().toBuffer();
    const tex = (name, buf) => doc.createTexture(name).setImage(buf).setMimeType('image/png');
    const [ao, rough, metal] = await Promise.all(
      ['FLH_1200_AO.jpg', 'FLH_1200_roughness.jpg', 'FLH_1200_metallic.jpg'].map((f) => sharp(path.join(texDir, f)).flip().resize(1024, 1024).greyscale().raw().toBuffer()),
    );
    const orm = Buffer.alloc(1024 * 1024 * 3);
    for (let i = 0; i < 1024 * 1024; i++) {
      orm[i * 3] = ao[i];
      orm[i * 3 + 1] = rough[i];
      orm[i * 3 + 2] = metal[i];
    }
    const ormPng = await sharp(orm, { raw: { width: 1024, height: 1024, channels: 3 } }).png().toBuffer();
    mat.setBaseColorTexture(tex('color', await img('FLH_1200_albedo.jpg')));
    mat.setNormalTexture(tex('normal', await img('FLH_1200_normal.jpg')));
    const ormTex = tex('orm', ormPng);
    mat.setMetallicRoughnessTexture(ormTex).setOcclusionTexture(ormTex).setMetallicFactor(1).setRoughnessFactor(1);
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // Licencia del paquete de Quaternius (se guarda junto a la caché).
  await download(QUATERNIUS['License.txt'], path.join(CACHE, 'quaternius-cars/License.txt'));
  const only = process.argv.slice(2);
  const jobs = {
    hatchback,
    sedan: () => quaternius('NormalCar1.fbx', 'sedan'),
    suv: () => quaternius('SUV.fbx', 'suv'),
    buseta,
    moto,
  };
  const res = [];
  for (const [k, fn] of Object.entries(jobs)) if (!only.length || only.includes(k)) res.push(await fn());
  const total = res.reduce((a, r) => a + r.bytes, 0);
  console.log('total', (total / 1e6).toFixed(2), 'MB');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
