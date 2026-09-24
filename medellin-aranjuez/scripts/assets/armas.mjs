// Descarga y procesa los modelos 3D de las armas (CC0 / CC-BY) para el juego,
// y dibuja sus íconos para el HUD.
// Reproducible: `node scripts/assets/armas.mjs [id ...] [--sin-iconos | --solo-iconos]`
// (usa caché en .cache/armas/).
//
// Fuentes (ver ASSETS-CREDITS.md y public/models/armas/CREDITOS.txt):
//  - machete: Poly Haven (CC0), fotogrametría con PBR;
//  - pistola (Beretta 92 FS), subametralladora (HK MP5K) y escopeta
//    (Remington 870): modelos de Sketchfab con licencia CC BY 4.0, tomados de
//    la copia pública de Objaverse (allenai/objaverse en Hugging Face), que
//    redistribuye los GLB originales tal cual (Sketchfab pide sesión);
//  - fusil: M4A1 de OpenGameArt (CC0), PBR. Viene en FBX y se convierte con
//    el módulo `bpy` de Blender (armas_blender.py). Si no hay un Python con
//    bpy, se crea un entorno en .cache/armas/bpyenv (pip install bpy,
//    ~370 MB, Python 3.11). El GLB convertido queda en .cache/armas/crudo.
//
// Cada arma se normaliza a un formato común:
//  - metros a escala real, eje Y hacia arriba, cañón (o filo) hacia -Z;
//  - origen en la empuñadura (donde la mano derecha la agarra);
//  - nodo vacío "boca" en la boca del cañón (de ahí sale el fogonazo) y, en
//    las armas largas, "mano_izq" donde la mano izquierda la sostiene;
//  - meshopt + texturas webp ≤ 1024 px.
// El machete va con la hoja hacia +Y (sale del lado del pulgar) y el filo
// hacia -Z.
//
// Salida: public/models/armas/<id>.glb y public/models/armas/iconos/<id>.png

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import * as THREE from 'three';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { clearNodeTransform, dedup, flatten, meshopt, prune, simplify, textureCompress, transformMesh, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = path.join(ROOT, '.cache/armas');
const OUT = path.join(ROOT, 'public/models/armas');
const ICONOS = path.join(OUT, 'iconos');

// --------------------------------------------------------------- fuentes
const OGA = 'https://opengameart.org/sites/default/files/';
const deg = THREE.MathUtils.degToRad;

/**
 * Por arma:
 *  fuente(): ruta local del glTF/GLB crudo (descarga y convierte si hace falta);
 *  quedar: nombres de nodos a conservar (el resto se borra);
 *  rot: [x, y, z] en grados (Euler XYZ) que deja el cañón en -Z y arriba en +Y;
 *  largo: largo total (m) en Z tras rotar (define la escala);
 *  agarre / boca / manoIzq: puntos [x, y, z] (m) medidos desde el centro de la
 *  caja del modelo ya rotado y escalado;
 *  materiales(doc): ajusta los materiales (texturas, colores PBR).
 */
const ARMAS = {
  machete: {
    fuente: () => polyHaven('machete'),
    rot: [0, 180, 0],
    ejeLargo: 'y',
    largo: 0.62,
    agarre: [0, -0.2, 0.004],
    boca: [0, 0.3, -0.01],
    materiales: (doc) => polyHavenOrm(doc),
    texturas: 512,
  },
  pistol: {
    // Beretta 92 FS — Ecler (ecler), CC BY 4.0.
    fuente: () => objaverse('pistol', 'glbs/000-145/e529e0dc704f4f7fb47d632ac9aa7f1e.glb'),
    rot: [0, -90, 0],
    largo: 0.217,
    agarre: [0, 0.003, 0.068],
    boca: [0, 0.059, -0.108],
    materiales: opacos,
    texturas: 512,
  },
  smg: {
    // HK MP5K (culata plegable) — quick_loop (so_O), CC BY 4.0.
    fuente: () => objaverse('smg', 'glbs/000-043/c503d96157614fb78b5953d49e643b78.glb'),
    rot: [0, -90, 0],
    largo: 0.6,
    agarre: [0, -0.039, 0.014],
    boca: [0, 0.06, -0.3],
    manoIzq: [0, 0.007, -0.259],
    materiales: opacos,
    simplificar: 0.7,
  },
  shotgun: {
    // Remington 870 — Andrei Milin (milinam2002), CC BY 4.0.
    fuente: () => objaverse('shotgun', 'glbs/000-141/6db0ad4764d14eee8f063eea3600071b.glb'),
    rot: [0, 90, 0],
    largo: 1.0,
    agarre: [0, 0.017, 0.192],
    boca: [0, 0.077, -0.5],
    manoIzq: [0, 0.02, -0.228],
    materiales: opacos,
  },
  rifle: {
    // M4A1 — nisu / 3dmodelscc0.com, CC0.
    fuente: () => blender('rifle', { 'm4a1.zip': OGA + 'm4a1_0.zip' }, 'm4a1/M4A1/M4A1.fbx', ''),
    rot: [90, 0, 0],
    largo: 0.84,
    agarre: [0, -0.018, 0.197],
    boca: [0, 0.06, -0.42],
    manoIzq: [0, 0.026, -0.043],
    materiales: m4Materiales,
  },
};

const isHtml = (buf) => /^\s*<(!doctype|html)/i.test(buf.subarray(0, 64).toString('latin1'));

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0 && !isHtml(fs.readFileSync(file))) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let intento = 1; intento <= 3; intento++) {
    console.log('descargando', url);
    const r = await fetch(url);
    const buf = Buffer.from(await r.arrayBuffer());
    if (r.ok && !isHtml(buf)) {
      fs.writeFileSync(file, buf);
      return file;
    }
    await new Promise((res) => setTimeout(res, 2000 * intento));
  }
  throw new Error(`No se pudo descargar ${url}. Descárguelo a mano en ${file} (ver ASSETS-CREDITS.md).`);
}

/** glTF 1k de Poly Haven (API pública): devuelve la ruta del .gltf. */
async function polyHaven(id) {
  const dir = path.join(CACHE, id);
  const gltf = path.join(dir, `${id}.gltf`);
  if (fs.existsSync(gltf)) return gltf;
  const info = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  const g = info.gltf['1k'].gltf;
  await download(g.url, gltf);
  for (const [rel, f] of Object.entries(g.include)) await download(f.url, path.join(dir, rel));
  return gltf;
}

/** GLB original de Sketchfab en la copia de Objaverse (Hugging Face). */
const OBJAVERSE = 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/';
function objaverse(id, ruta) {
  return download(OBJAVERSE + ruta, path.join(CACHE, 'objaverse', `${id}.glb`));
}

/** Python con el módulo bpy (se instala en la caché si no existe). */
function pythonBpy() {
  const candidatos = [process.env.ARMAS_PYTHON, path.join(CACHE, 'bpyenv/bin/python')].filter(Boolean);
  for (const py of candidatos) {
    try {
      execFileSync(py, ['-c', 'import bpy'], { stdio: 'ignore' });
      return py;
    } catch {
      // siguiente
    }
  }
  console.log('instalando bpy en .cache/armas/bpyenv (una sola vez)…');
  const venv = path.join(CACHE, 'bpyenv');
  execFileSync(process.env.PYTHON311 ?? 'python3.11', ['-m', 'venv', venv], { stdio: 'inherit' });
  execFileSync(path.join(venv, 'bin/pip'), ['install', 'bpy'], { stdio: 'inherit' });
  return path.join(venv, 'bin/python');
}

/** Descarga la fuente y la convierte con Blender a .cache/armas/crudo/<id>.glb. */
async function blender(id, archivos, entrada, objetos) {
  const out = path.join(CACHE, 'crudo', `${id}.glb`);
  if (fs.existsSync(out)) return out;
  for (const [f, url] of Object.entries(archivos)) {
    const file = await download(url, path.join(CACHE, f));
    if (f.endsWith('.zip')) execFileSync('unzip', ['-q', '-o', file, '-d', path.join(CACHE, f.replace(/\.zip$/, ''))]);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync(pythonBpy(), [path.join(ROOT, 'scripts/assets/armas_blender.py'), '--', path.join(CACHE, entrada), out, objetos], { stdio: 'inherit' });
  return out;
}

// ------------------------------------------------------------ materiales
const png = (doc, name, buf) => doc.createTexture(name).setImage(new Uint8Array(buf)).setMimeType('image/png');

/** Poly Haven empaqueta AO/rugosidad/metal en una sola textura "arm": también sirve de oclusión. */
function polyHavenOrm(doc) {
  for (const m of doc.getRoot().listMaterials()) {
    const orm = m.getMetallicRoughnessTexture();
    if (orm && !m.getOcclusionTexture()) m.setOcclusionTexture(orm);
  }
}

/** Modelos de Sketchfab: algunos exportan el material en modo BLEND sin necesidad (se ordenan mal). */
function opacos(doc) {
  for (const m of doc.getRoot().listMaterials()) m.setAlphaMode('OPAQUE');
}

/** M4A1: PBR del autor (color, normal, metal y rugosidad separados → ORM). */
async function m4Materiales(doc) {
  const R = doc.getRoot();
  const dir = path.join(CACHE, 'm4a1/M4A1');
  const S = 1024;
  const gris = (f) => sharp(path.join(dir, f)).resize(S, S).greyscale().raw().toBuffer();
  const [rough, metal] = await Promise.all([gris('M4A1_Roughness.png'), gris('M4A1_Metallic.png')]);
  const orm = Buffer.alloc(S * S * 3);
  for (let i = 0; i < S * S; i++) {
    orm[i * 3] = 255;
    orm[i * 3 + 1] = rough[i];
    orm[i * 3 + 2] = metal[i];
  }
  const color = png(doc, 'color', await sharp(path.join(dir, 'M4A1_Base_Color.png')).resize(S, S).png().toBuffer());
  const normal = png(doc, 'normal', await sharp(path.join(dir, 'M4A1_Normal.png')).resize(S, S).png().toBuffer());
  const ormTex = png(doc, 'orm', await sharp(orm, { raw: { width: S, height: S, channels: 3 } }).png().toBuffer());
  const mat = doc.createMaterial('m4a1').setBaseColorTexture(color).setNormalTexture(normal).setMetallicRoughnessTexture(ormTex).setMetallicFactor(1).setRoughnessFactor(1);
  for (const mesh of R.listMeshes()) for (const p of mesh.listPrimitives()) p.setMaterial(mat);
}

// ---------------------------------------------------------- normalización
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const trisOf = (doc) =>
  doc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .reduce((a, p) => a + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0);

async function procesar(id) {
  const cfg = ARMAS[id];
  const src = await cfg.fuente();
  const doc = await io.read(src);
  const R = doc.getRoot();
  const scene = R.getDefaultScene() ?? R.listScenes()[0];

  // 1. Solo los nodos pedidos; todo en espacio mundo y sin jerarquía.
  if (cfg.quedar) for (const n of R.listNodes()) if (!cfg.quedar.includes(n.getName())) n.dispose();
  await doc.transform(flatten());
  for (const n of R.listNodes()) clearNodeTransform(n);

  // 2. Rotar y escalar al tamaño real.
  const rot = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...cfg.rot.map(deg), 'XYZ'));
  const meshes = R.listMeshes();
  for (const m of meshes) transformMesh(m, rot.toArray());
  let b = getBounds(scene);
  const eje = { x: 0, y: 1, z: 2 }[cfg.ejeLargo ?? 'z'];
  const s = cfg.largo / (b.max[eje] - b.min[eje]);
  const centro = [0, 1, 2].map((i) => ((b.min[i] + b.max[i]) / 2) * s);
  // 3. Origen en la empuñadura.
  const t = centro.map((c, i) => -(c + cfg.agarre[i]));
  const m4 = new THREE.Matrix4().makeTranslation(t[0], t[1], t[2]).multiply(new THREE.Matrix4().makeScale(s, s, s));
  for (const m of meshes) transformMesh(m, m4.toArray());

  // 4. Un nodo raíz con las mallas y los puntos de referencia.
  const raiz = doc.createNode(id);
  for (const n of [...scene.listChildren()]) {
    scene.removeChild(n);
    if (n.getMesh()) raiz.addChild(n);
  }
  scene.addChild(raiz);
  const punto = (nombre, p) => raiz.addChild(doc.createNode(nombre).setTranslation(p.map((v, i) => +(v - cfg.agarre[i]).toFixed(4))));
  punto('boca', cfg.boca);
  if (cfg.manoIzq) punto('mano_izq', cfg.manoIzq);

  // 5. Materiales y optimización.
  await cfg.materiales(doc);
  for (const n of R.listNodes()) {
    const m = n.getMesh();
    if (m && !m.getName()) m.setName(n.getName());
  }
  await doc.transform(dedup(), weld(), prune({ keepLeaves: true }));
  if (cfg.simplificar) {
    // Menos triángulos sin tocar la silueta (error máximo ~0,5 mm).
    await MeshoptSimplifier.ready;
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: cfg.simplificar, error: 0.0015, lockBorder: true }));
  }
  const lado = cfg.texturas ?? 1024;
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [lado, lado], quality: 82 }));
  await MeshoptEncoder.ready;
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  fs.mkdirSync(OUT, { recursive: true });
  const out = path.join(OUT, `${id}.glb`);
  await io.write(out, doc);
  b = getBounds(scene);
  const bytes = fs.statSync(out).size;
  console.log(
    `${id}: ${(bytes / 1024).toFixed(0)} KB, ${trisOf(doc)} triángulos, caja ${b.min.map((v) => v.toFixed(3))} → ${b.max.map((v) => v.toFixed(3))}`,
  );
  return bytes;
}

// ---------------------------------------------------------------- íconos
// Silueta lateral (cañón a la derecha), relleno gris claro sobre fondo
// transparente, 256×96 px. Se dibuja con three.js en Chromium (Playwright).
const ICONO = { w: 256, h: 96, color: '#eceff1' };
// Rotación extra para la vista del ícono (el machete se acuesta: hoja a la derecha, filo abajo).
const ROT_ICONO = { machete: [-90, 0, 0] };

function paginaIconos(ids) {
  return `<!doctype html><html><body style="margin:0;background:transparent">
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
const W = ${ICONO.w * 4}, H = ${ICONO.h * 4};
const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
r.setSize(W, H);
r.setClearColor(0x000000, 0);
document.body.appendChild(r.domElement);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const fill = new THREE.MeshBasicMaterial({ color: '${ICONO.color}' });
const rots = ${JSON.stringify(ROT_ICONO)};
window.iconos = {};
for (const id of ${JSON.stringify(ids)}) {
  const g = await loader.loadAsync('/public/models/armas/' + id + '.glb');
  const obj = g.scene;
  obj.traverse((o) => { if (o.isMesh) o.material = fill; });
  if (rots[id]) obj.rotation.set(...rots[id].map((v) => v * Math.PI / 180));
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  // Vista desde +X: la pantalla a la derecha es -Z (el cañón).
  const pad = 0.06;
  const half = Math.max(size.z / 2 / (1 - pad) , (size.y / 2 / (1 - pad)) * W / H);
  const cam = new THREE.OrthographicCamera(-half, half, half * H / W, -half * H / W, -10, 10);
  cam.position.set(c.x + 5, c.y, c.z);
  cam.lookAt(c);
  const s = new THREE.Scene();
  s.add(obj);
  r.render(s, cam);
  window.iconos[id] = r.domElement.toDataURL('image/png');
}
window.listo = true;
</script></body></html>`;
}

async function iconos(ids) {
  const { chromium } = await import('@playwright/test');
  const html = paginaIconos(ids);
  const srv = http
    .createServer((q, s) => {
      const u = decodeURIComponent(q.url.split('?')[0]);
      if (u === '/') {
        s.setHeader('content-type', 'text/html');
        return s.end(html);
      }
      const f = path.join(ROOT, u);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
        s.statusCode = 404;
        return s.end();
      }
      s.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
      s.end(fs.readFileSync(f));
    })
    .listen(0);
  await new Promise((res) => srv.once('listening', res));
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM ?? process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('icono:', e.message));
    await page.goto(`http://localhost:${srv.address().port}/`);
    await page.waitForFunction(() => window.listo, null, { timeout: 120000 });
    const data = await page.evaluate(() => window.iconos);
    fs.mkdirSync(ICONOS, { recursive: true });
    for (const [id, url] of Object.entries(data)) {
      const buf = Buffer.from(url.split(',')[1], 'base64');
      // Se dibuja a 4× y se reduce: bordes suaves.
      await sharp(buf).resize(ICONO.w, ICONO.h).png({ compressionLevel: 9 }).toFile(path.join(ICONOS, `${id}.png`));
      console.log('ícono', id);
    }
  } finally {
    await browser.close();
    srv.close();
  }
  await iconoPunos();
}

/** Puño cerrado visto de lado (nudillos a la derecha), dibujado a mano en SVG. */
async function iconoPunos() {
  // Silueta: antebrazo, dorso, cuatro dedos doblados y el pulgar cruzado; las
  // separaciones se recortan con una máscara (quedan transparentes).
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ICONO.w}" height="${ICONO.h}" viewBox="0 0 256 96">
  <defs>
    <mask id="m">
      <rect width="256" height="96" fill="#fff"/>
      <g stroke="#000" stroke-width="3.2" stroke-linecap="round" fill="none">
        <path d="M163 33.5 H 183"/>
        <path d="M165 48.5 H 186"/>
        <path d="M163 63 H 182"/>
        <path d="M120 58 C 134 51, 156 50, 172 55"/>
      </g>
    </mask>
  </defs>
  <g fill="${ICONO.color}" mask="url(#m)">
    <path d="M52 40 C 70 36, 90 33, 108 31 L 110 71 C 90 70, 70 69, 53 68 C 49 58, 49 48, 52 40 Z"/>
    <path d="M104 30 C 116 17, 140 14, 162 17 L 168 79 C 144 84, 118 83, 106 72 C 99 58, 99 42, 104 30 Z"/>
    <rect x="150" y="18" width="36" height="16" rx="8"/>
    <rect x="152" y="33" width="38" height="16" rx="8"/>
    <rect x="152" y="48" width="37" height="15.5" rx="7.8"/>
    <rect x="148" y="62.5" width="34" height="15.5" rx="7.8"/>
    <path d="M118 60 C 132 53, 156 52, 172 57 C 180 60, 179 70, 170 70 L 136 71 C 124 71, 114 67, 118 60 Z"/>
  </g>
</svg>`;
  fs.mkdirSync(ICONOS, { recursive: true });
  fs.writeFileSync(path.join(ICONOS, 'fists.svg'), svg);
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(path.join(ICONOS, 'fists.png'));
  console.log('ícono fists');
}

// ------------------------------------------------------------------ main
async function main() {
  const args = process.argv.slice(2);
  const ids = args.filter((a) => !a.startsWith('--'));
  const todos = Object.keys(ARMAS);
  const lista = ids.length ? ids : todos;
  let total = 0;
  if (!args.includes('--solo-iconos')) for (const id of lista) total += await procesar(id);
  if (total) console.log('total', (total / 1024).toFixed(0), 'KB');
  if (!args.includes('--sin-iconos')) await iconos(lista.filter((id) => fs.existsSync(path.join(OUT, `${id}.glb`))));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
