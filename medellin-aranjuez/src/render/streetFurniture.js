// Elementos de calle procedurales: placas de nomenclatura en las esquinas,
// paraderos de bus y venteros ambulantes (minutos, frutas, mango biche,
// arepas, helados, dulces). Todo se fusiona por material: unas pocas
// llamadas de dibujo para cientos de piezas.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CALLES, CARRERAS } from '../sim/cityLayout.js';
import { GRID, terrainHeight } from '../sim/terrain.js';
import { makeRng } from '../sim/rng.js';
import { canvas, toTexture } from './textures.js';
import { slot } from './facadeTextures.js';

// ------------------------------------------------------------------ textos
const shortName = (n) => n.replace(/^Calle /, 'Cl ').replace(/^Carrera /, 'Cr ');
const PLATE_NAMES = [...CALLES, ...CARRERAS];
const PLATE_COLS = 4;
const PLATE_ROWS = Math.ceil(PLATE_NAMES.length / PLATE_COLS);
const VENDOR_SIGNS = ['MINUTOS $200', 'FRUTAS', 'MANGO BICHE', 'AREPAS', 'HELADOS', 'DULCES', 'PARADERO'];
const VENDOR_KINDS = ['minutos', 'frutas', 'mangos', 'arepas', 'helados', 'dulces'];

function plateAtlas() {
  const W = 512;
  const H = 128;
  const c = canvas(W * PLATE_COLS, H * PLATE_ROWS);
  const ctx = c.getContext('2d');
  PLATE_NAMES.forEach((name, i) => {
    const ox = (i % PLATE_COLS) * W;
    const oy = Math.floor(i / PLATE_COLS) * H;
    ctx.fillStyle = '#0b4a2f';
    ctx.fillRect(ox, oy, W, H);
    ctx.strokeStyle = '#f2f2f2';
    ctx.lineWidth = 6;
    ctx.strokeRect(ox + 8, oy + 8, W - 16, H - 16);
    ctx.fillStyle = '#f2f2f2';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const [main, sub] = shortName(name).split(' (');
    ctx.font = `bold ${sub ? 58 : 70}px "Segoe UI", Arial, sans-serif`;
    ctx.fillText(main, ox + W / 2, oy + (sub ? H * 0.4 : H / 2));
    if (sub) {
      ctx.font = 'bold 30px "Segoe UI", Arial, sans-serif';
      ctx.fillText(sub.replace(')', ''), ox + W / 2, oy + H * 0.78);
    }
  });
  const t = toTexture(c, { repeat: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function vendorSignAtlas() {
  const W = 512;
  const H = 128;
  const c = canvas(W * 4, H * 2);
  const ctx = c.getContext('2d');
  const styles = [['#ffd400', '#1b1b1b'], ['#2d6a4f', '#ffffff'], ['#80b918', '#1b1b1b'], ['#9d0208', '#ffd166'], ['#ff8fab', '#ffffff'], ['#7209b7', '#ffffff'], ['#1d4e89', '#ffffff']];
  VENDOR_SIGNS.forEach((t, i) => {
    const ox = (i % 4) * W;
    const oy = Math.floor(i / 4) * H;
    const [bg, fg] = styles[i];
    ctx.fillStyle = bg;
    ctx.fillRect(ox, oy, W, H);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 64px "Segoe UI", Arial, sans-serif';
    ctx.fillText(t, ox + W / 2, oy + H / 2 + 3, W - 30);
  });
  const t = toTexture(c, { repeat: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ------------------------------------------------------------------ fusión por material
class Bins {
  constructor() {
    this.lists = new Map();
  }

  /** geo: geometría de three (se clona); m: matriz; color: [r,g,b]; uvRect: casilla de atlas. */
  add(key, geo, m, color = [1, 1, 1], uvRect = null) {
    const g = geo.clone();
    g.applyMatrix4(m);
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (uvRect) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uvRect[0] + uv.getX(i) * (uvRect[2] - uvRect[0]), uvRect[1] + uv.getY(i) * (uvRect[3] - uvRect[1]));
    }
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set(color, i * 3);
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (!g.index) g.setIndex([...Array(n).keys()]);
    if (!this.lists.has(key)) this.lists.set(key, []);
    this.lists.get(key).push(g);
  }

  build(root, mats, shadows = {}) {
    for (const [key, list] of this.lists) {
      const geo = mergeGeometries(list, false);
      if (!geo) continue;
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mats[key]);
      mesh.name = `calle-${key}`;
      mesh.castShadow = shadows[key] !== false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
    }
  }
}

// Geometrías base (se reutilizan: Bins las clona).
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 10);
const CONE = new THREE.ConeGeometry(1, 1, 12, 1, true);
const SPHERE = new THREE.SphereGeometry(1, 8, 6);
const PLANE = new THREE.PlaneGeometry(1, 1);

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

/** Matriz local (posición, tamaño, giro en Y) dentro del marco `base`. */
function M(base, x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0) {
  _p.set(x, y, z);
  _q.setFromEuler(_e.set(rx, ry, rz));
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().multiplyMatrices(base, _m.compose(_p, _q, _s));
}

function frame(p, rot = 0) {
  const y = terrainHeight(p.x, p.z) + GRID.curb;
  return new THREE.Matrix4().compose(new THREE.Vector3(p.x, y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(1, 1, 1));
}

// ------------------------------------------------------------------ piezas
function streetSign(bins, p) {
  const F = frame(p, 0);
  const pole = [0.3, 0.35, 0.32];
  bins.add('metal', CYL, M(F, 0, 1.45, 0, 0.035, 2.9, 0.035), pole);
  const cl = slot(p.calle, PLATE_COLS, PLATE_ROWS);
  const cr = slot(CALLES.length + p.carrera, PLATE_COLS, PLATE_ROWS);
  // Placa de la calle (paralela a la calle) y de la carrera, legibles por ambos lados.
  for (const [r, y, uv] of [[0, 2.72, cl], [Math.PI / 2, 2.5, cr]]) {
    bins.add('plate', PLANE, M(F, Math.cos(r) * 0.36, y, -Math.sin(r) * 0.36, 0.68, 0.19, 1, r), [1, 1, 1], uv);
    bins.add('plate', PLANE, M(F, Math.cos(r) * 0.36, y, -Math.sin(r) * 0.36, 0.68, 0.19, 1, r + Math.PI), [1, 1, 1], uv);
  }
}

function busStop(bins, p) {
  const F = frame(p, p.rot);
  const wood = [0.55, 0.36, 0.2];
  const metal = [0.25, 0.27, 0.3];
  bins.add('body', BOX, M(F, 0, 0.45, 0, 1.9, 0.05, 0.38), wood);
  bins.add('body', BOX, M(F, 0, 0.78, -0.18, 1.9, 0.3, 0.04), wood);
  for (const x of [-0.8, 0.8]) bins.add('metal', BOX, M(F, x, 0.22, -0.05, 0.06, 0.45, 0.35), metal);
  // Aviso de paradero en poste.
  bins.add('metal', CYL, M(F, 1.05, 1.3, 0, 0.03, 2.6, 0.03), metal);
  const uv = slot(6, 4, 2);
  bins.add('vsign', PLANE, M(F, 1.05, 2.4, 0, 0.6, 0.16, 1, Math.PI / 2), [1, 1, 1], uv);
  bins.add('vsign', PLANE, M(F, 1.05, 2.4, 0, 0.6, 0.16, 1, -Math.PI / 2), [1, 1, 1], uv);
}

const UMBRELLA = [
  [0.85, 0.12, 0.12],
  [0.98, 0.78, 0.1],
  [0.1, 0.35, 0.7],
  [0.95, 0.95, 0.92],
  [0.2, 0.55, 0.3],
];

function umbrella(bins, F, rng, x = 0, z = -0.1, h = 2.05) {
  bins.add('metal', CYL, M(F, x, h / 2, z, 0.02, h, 0.02), [0.8, 0.8, 0.8]);
  bins.add('umbrella', CONE, M(F, x, h + 0.12, z, 1.05, 0.35, 1.05), rng.pick(UMBRELLA));
}

function vendor(bins, p) {
  const rng = makeRng(Math.floor(p.x * 13 + p.z * 7));
  const F = frame(p, p.rot);
  const kind = VENDOR_KINDS.indexOf(p.kind);
  const sign = slot(Math.max(0, kind), 4, 2);
  const cart = (color, w = 1.2, d = 0.65, h = 0.35, y = 0.62) => {
    bins.add('body', BOX, M(F, 0, y, 0, w, h, d), color);
    for (const s of [-1, 1]) bins.add('metal', CYL, M(F, s * (w / 2 + 0.03), 0.24, 0, 0.24, 0.05, 0.24, 0, 0, Math.PI / 2), [0.12, 0.12, 0.12]);
    bins.add('metal', BOX, M(F, 0, y - h / 2 - 0.2, 0, w * 0.9, 0.04, d * 0.8), [0.3, 0.3, 0.3]);
    bins.add('vsign', PLANE, M(F, 0, y, d / 2 + 0.005, w * 0.8, h * 0.8, 1), [1, 1, 1], sign);
  };
  switch (p.kind) {
    case 'minutos': {
      bins.add('body', BOX, M(F, 0, 0.74, 0, 0.9, 0.04, 0.55), [0.92, 0.92, 0.9]);
      for (const [x, z] of [[-0.4, -0.22], [0.4, -0.22], [-0.4, 0.22], [0.4, 0.22]]) bins.add('metal', BOX, M(F, x, 0.36, z, 0.03, 0.72, 0.03), [0.3, 0.3, 0.3]);
      for (let k = 0; k < 3; k++) bins.add('body', BOX, M(F, -0.25 + k * 0.22, 0.77, 0.05, 0.07, 0.015, 0.14), [0.08, 0.08, 0.1]);
      bins.add('vsign', PLANE, M(F, 0, 0.55, 0.28, 0.8, 0.2, 1), [1, 1, 1], sign);
      bins.add('body', CYL, M(F, 0, 0.23, -0.55, 0.16, 0.46, 0.16), [0.15, 0.35, 0.75]);
      umbrella(bins, F, rng, 0, -0.1);
      break;
    }
    case 'frutas':
    case 'mangos': {
      cart(p.kind === 'frutas' ? [0.2, 0.35, 0.65] : [0.85, 0.85, 0.82]);
      const fruit = p.kind === 'frutas' ? [[0.95, 0.8, 0.1], [0.95, 0.5, 0.1], [0.75, 0.1, 0.1], [0.3, 0.6, 0.15], [0.55, 0.2, 0.5]] : [[0.55, 0.75, 0.2], [0.85, 0.8, 0.25], [0.95, 0.95, 0.9]];
      for (let k = 0; k < 28; k++) {
        const r = rng.range(0.05, 0.085);
        bins.add('fruit', SPHERE, M(F, rng.range(-0.5, 0.5), 0.84 + r + rng.range(0, 0.1), rng.range(-0.25, 0.25), r, r, r), rng.pick(fruit));
      }
      umbrella(bins, F, rng, 0, 0);
      break;
    }
    case 'arepas': {
      cart([0.25, 0.25, 0.27], 1.0, 0.6, 0.4, 0.6);
      bins.add('metal', BOX, M(F, 0, 0.82, 0, 0.9, 0.03, 0.5), [0.08, 0.08, 0.08]);
      for (let k = 0; k < 6; k++) bins.add('fruit', CYL, M(F, -0.3 + (k % 3) * 0.3, 0.845, -0.12 + Math.floor(k / 3) * 0.24, 0.09, 0.02, 0.09), [0.93, 0.8, 0.45]);
      umbrella(bins, F, rng, 0.2, -0.2);
      break;
    }
    case 'helados': {
      cart([0.96, 0.96, 0.96], 0.95, 0.6, 0.55, 0.62);
      bins.add('body', BOX, M(F, 0, 0.92, 0, 0.8, 0.06, 0.5), [0.9, 0.35, 0.55]);
      umbrella(bins, F, rng, 0, 0);
      break;
    }
    default: {
      bins.add('body', BOX, M(F, 0, 0.7, 0, 0.8, 0.04, 0.5), [0.6, 0.45, 0.3]);
      for (const [x, z] of [[-0.35, -0.2], [0.35, -0.2], [-0.35, 0.2], [0.35, 0.2]]) bins.add('metal', BOX, M(F, x, 0.34, z, 0.03, 0.68, 0.03), [0.3, 0.3, 0.3]);
      for (let k = 0; k < 16; k++) bins.add('fruit', BOX, M(F, -0.33 + (k % 8) * 0.095, 0.77, -0.15 + Math.floor(k / 8) * 0.22, 0.08, 0.1, 0.12), rng.pick([[0.9, 0.2, 0.2], [0.95, 0.8, 0.1], [0.2, 0.5, 0.9], [0.95, 0.5, 0.7], [0.3, 0.8, 0.4]]));
      bins.add('vsign', PLANE, M(F, 0, 0.5, 0.255, 0.7, 0.18, 1), [1, 1, 1], sign);
    }
  }
}

/** Construye placas, paraderos y venteros de la ciudad. */
export function buildStreetFurniture(r, byType) {
  const bins = new Bins();
  for (const p of byType.streetSign ?? []) streetSign(bins, p);
  for (const p of byType.busStop ?? []) busStop(bins, p);
  for (const p of byType.vendor ?? []) vendor(bins, p);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const vsTex = vendorSignAtlas();
  const mats = {
    metal: std({ vertexColors: true, metalness: 0.5, roughness: 0.45 }),
    plate: std({ map: plateAtlas(), roughness: 0.5, metalness: 0.2 }),
    body: std({ vertexColors: true, roughness: 0.7 }),
    umbrella: std({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
    fruit: std({ vertexColors: true, roughness: 0.45 }),
    vsign: std({ map: vsTex, roughness: 0.6 }),
  };
  bins.build(r.root, mats, { plate: false, vsign: false, fruit: false });
}
