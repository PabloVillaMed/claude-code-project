// Interiores de los comercios a los que se entra (sim/interiors.js armarLocal
// da la distribución): tienda de barrio, panadería, comidas, almacén de ropa
// paisa, droguería, cacharrería y papelería. Muros pañetados de color,
// zócalo de baldosa, piso de baldosa roja, granito o madera, mostradores con
// su vitrina, estanterías llenas (el fondo pintado del atlas de las vitrinas
// y productos 3D instanciados al frente), nevera de gaseosas de puerta de
// vidrio iluminada, bultos, plátanos colgados, canastas de cerveza, dominó,
// altar con veladora, televisor, horno, latas de pan, plancha y freidora,
// menús pintados, percheros con ponchos, ruanas y camisas, repisas de
// sombreros aguadeños y carrieles (las mallas de render/outfit.js),
// maniquíes, espejo y vestier con cortina.
//
// Luz sin luces reales: cada vértice lleva horneada la luz de los tubos
// fluorescentes (y la de la nevera, el televisor, la veladora y el horno) y
// los materiales son sin sombreado (MeshBasic con el color del vértice): se
// ven igual de día y de noche y cuestan muy poco. Lo que brilla (tubos,
// nevera, pantalla) va con color > 1 para el bloom.
//
// Rendimiento: un interior son 2 mallas fusionadas (los dos atlas: el de los
// comercios, render/interiorTextures.js, y el de las vitrinas,
// render/shopInteriors.js, compartido con las fachadas), el vidrio y una
// malla instanciada por tipo de producto (cajas, latas, pan, prendas,
// sombreros, carrieles, baldes): unas 6-9 llamadas de dibujo. Se arma por
// pasos solo con el jugador cerca (game/comercios.js). Los frentes de todos
// los comercios (la cortina metálica que baja de noche y el cuarto de lejos
// que se ve por la vitrina mientras el interior no está armado) son 2 mallas.

import * as THREE from 'three';
import { Acc } from './interiorBuilder.js';
import { ATLAS, interiorAtlas } from './shopInteriors.js';
import { COMERCIO_UV, comerciosAtlas, cortinaTex } from './interiorTextures.js';
import { capGeo, carrielGeo, hatGeo } from './outfit.js';
import { ROPA_BY_ID } from '../sim/ropa.js';
import { LOCAL_SPOTS } from '../sim/cityLayout.js';
import { INTERIOR, MENUS_COMERCIO } from '../sim/interiors.js';
import { METAL_COLORS } from '../sim/facades.js';
import { makeRng } from '../sim/rng.js';

// ------------------------------------------------------------------ configurables
export const COMERCIO_FX = {
  /** Milisegundos por cuadro que se gastan armando un interior. */
  ARMADO_MS: 4,
  /** Luz de fondo (sin tubos cerca) de adentro, por canal. */
  BASE: [0.5, 0.5, 0.49],
  /** Tubos fluorescentes: color, fuerza y alcance (m) de su luz horneada. */
  TUBO_COLOR: [1.0, 1.03, 1.02],
  TUBO_FUERZA: 0.72,
  TUBO_ALCANCE: 4.8,
  /** Multiplicador general de la luz horneada (1 = como se ajustó). */
  LUZ: 1,
  /** Paso (m) de la subdivisión de muros y pisos para hornear la luz. */
  PASO: 0.8,
  /** Brillo de los materiales de adentro de día y de noche (game/comercios.js lo cambia con la hora). */
  BRILLO_DIA: 1.0,
  BRILLO_NOCHE: 0.92,
  /** Fracción de cada repisa ocupada por productos 3D (el resto lo pone el fondo pintado). */
  RELLENO: 0.72,
  /** Tope de instancias por tipo y local (por si un local sale muy grande). */
  MAX_INSTANCIAS: 1200,
};

/** Colores de los muros pañetados (pasteles de las tiendas paisas), se escoge uno por local. */
export const MUROS = [
  [0.97, 0.91, 0.74],
  [0.83, 0.94, 0.86],
  [0.84, 0.9, 0.98],
  [0.98, 0.86, 0.85],
  [0.99, 0.95, 0.72],
  [0.92, 0.88, 0.97],
  [0.96, 0.96, 0.93],
];

/** Piso por tema: casilla y metros que cubre cada casilla. */
const PISOS = {
  tienda: ['vit', 'piso-rojo', 4],
  cacharreria: ['vit', 'piso-rojo', 4],
  panaderia: ['com', 'baldosaBlanca', 0.6],
  comidas: ['vit', 'piso-ajedrez', 4],
  drogueria: ['com', 'granito', 0.6],
  papeleria: ['com', 'granito', 0.6],
  almacen: ['com', 'pisoMadera', 3.2],
};

// Colores (lineales; > 1 = luz propia).
const C = (r, g, b) => [r, g, b];
const NEGRO = C(0.06, 0.06, 0.07);
const ACERO = C(0.86, 0.87, 0.89);
const MADERA = C(0.85, 0.72, 0.58);
const OSCURA = C(0.7, 0.62, 0.56);
const PLASTICO = [C(0.95, 0.95, 0.93), C(0.78, 0.12, 0.12), C(0.14, 0.32, 0.7)];
const VIVOS = [C(0.85, 0.15, 0.12), C(0.95, 0.62, 0.2), C(0.15, 0.6, 0.5), C(0.92, 0.78, 0.3), C(0.25, 0.45, 0.65), C(0.5, 0.75, 0.2), C(1, 0.42, 0.55), C(0.95, 0.95, 0.92), C(0.4, 0.3, 0.6), C(0.97, 0.47, 0.05), C(0.12, 0.2, 0.36), C(1, 0.82, 0.4)];
const DROGAS = [C(0.96, 0.96, 0.97), C(0.8, 0.9, 1), C(0.55, 0.82, 0.66), C(0.42, 0.65, 0.86), C(0.98, 0.84, 0.88), C(0.99, 0.9, 0.55)];
const CANASTAS = [C(0.78, 0.1, 0.1), C(0.95, 0.72, 0.08), C(0.12, 0.35, 0.72), C(0.13, 0.48, 0.22)];
const PAN = [C(0.85, 0.6, 0.3), C(0.92, 0.72, 0.4), C(0.75, 0.48, 0.22), C(0.96, 0.82, 0.55)];
const hex = (n) => {
  const c = new THREE.Color().setHex(n);
  return [c.r, c.g, c.b];
};

// ------------------------------------------------------------------ geometría con atlas
/** Acumulador con casillas de atlas: cada cara se mapea a su casilla (y se repite cada `rep` m). */
class Malla extends Acc {
  constructor(R) {
    super();
    this.R = R;
  }

  /** Cara: esquina o (abajo-izquierda vista de frente), eje derecho rv y eje arriba uv (vectores con largo), normal n. */
  cara(o, rv, uv, n, tile, col, s0 = 0, t0 = 0, s1 = 1, t1 = 1) {
    const R = this.R[tile] ?? COMERCIO_UV.blanco;
    const U = (s) => R[0] + (R[2] - R[0]) * s;
    const V = (t) => R[1] + (R[3] - R[1]) * t;
    const b = [o[0] + rv[0], o[1] + rv[1], o[2] + rv[2]];
    const c = [b[0] + uv[0], b[1] + uv[1], b[2] + uv[2]];
    const d = [o[0] + uv[0], o[1] + uv[1], o[2] + uv[2]];
    this.quad(o, b, c, d, n, [[U(s0), V(t0)], [U(s1), V(t0)], [U(s1), V(t1)], [U(s0), V(t1)]], col);
  }

  /** Cara subdividida (para la luz horneada) con la casilla repetida cada rw × rh m (0 = estirada). */
  caraRep(o, rv, uv, n, tile, col, rw = 0, rh = 0, paso = COMERCIO_FX.PASO) {
    const Lr = Math.hypot(rv[0], rv[1], rv[2]);
    const Lu = Math.hypot(uv[0], uv[1], uv[2]);
    if (Lr < 1e-4 || Lu < 1e-4) return;
    for (const [a0, a1, s0, s1] of tramos(Lr, rw, paso))
      for (const [b0, b1, t0, t1] of tramos(Lu, rh, paso)) {
        const p = [o[0] + rv[0] * a0 + uv[0] * b0, o[1] + rv[1] * a0 + uv[1] * b0, o[2] + rv[2] * a0 + uv[2] * b0];
        this.cara(p, [rv[0] * (a1 - a0), rv[1] * (a1 - a0), rv[2] * (a1 - a0)], [uv[0] * (b1 - b0), uv[1] * (b1 - b0), uv[2] * (b1 - b0)], n, tile, col, s0, t0, s1, t1);
      }
  }

  /**
   * Caja alineada. o = {t: casilla (o {zp, zn, xp, xn, yp, yn, t}), col, skip:
   * 'y- z-'..., rep: m por casilla (0 = estirada), paso}.
   */
  caja(x0, x1, y0, y1, z0, z1, o = {}) {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
    const skip = ` ${o.skip ?? 'y-'} `;
    const col = o.col ?? [1, 1, 1];
    const T = typeof o.t === 'object' ? o.t : { t: o.t ?? 'blanco' };
    const t = (k) => T[k] ?? T.t ?? 'blanco';
    const c = (k) => o.cols?.[k] ?? col;
    const rep = o.rep ?? 0;
    const paso = o.paso ?? 99;
    const W = x1 - x0;
    const H = y1 - y0;
    const D = z1 - z0;
    if (!skip.includes(' z+ ')) this.caraRep([x0, y0, z1], [W, 0, 0], [0, H, 0], [0, 0, 1], t('zp'), c('zp'), rep, rep, paso);
    if (!skip.includes(' z- ')) this.caraRep([x1, y0, z0], [-W, 0, 0], [0, H, 0], [0, 0, -1], t('zn'), c('zn'), rep, rep, paso);
    if (!skip.includes(' x+ ')) this.caraRep([x1, y0, z1], [0, 0, -D], [0, H, 0], [1, 0, 0], t('xp'), c('xp'), rep, rep, paso);
    if (!skip.includes(' x- ')) this.caraRep([x0, y0, z0], [0, 0, D], [0, H, 0], [-1, 0, 0], t('xn'), c('xn'), rep, rep, paso);
    if (!skip.includes(' y+ ')) this.caraRep([x0, y1, z1], [W, 0, 0], [0, 0, -D], [0, 1, 0], t('yp'), c('yp'), rep, rep, paso);
    if (!skip.includes(' y- ')) this.caraRep([x0, y0, z0], [W, 0, 0], [0, 0, D], [0, -1, 0], t('yn'), c('yn'), rep, rep, paso);
  }

  /** Geometría de three transformada por `m`, con sus UV metidas en la casilla `tile`. */
  geom(g, m, col, tile = 'blanco') {
    const k0 = this.count;
    super.geom(g, m, col);
    const R = this.R[tile] ?? COMERCIO_UV.blanco;
    for (let v = k0; v < this.count; v++) {
      const s = Math.min(1, Math.max(0, this.u[v * 2]));
      const t = Math.min(1, Math.max(0, this.u[v * 2 + 1]));
      this.u[v * 2] = R[0] + (R[2] - R[0]) * s;
      this.u[v * 2 + 1] = R[1] + (R[3] - R[1]) * t;
    }
  }

  /** Copia otro acumulador al final (lo que brilla se agrega después de hornear). */
  append(o) {
    const k = this.count;
    for (const v of o.p) this.p.push(v);
    for (const v of o.n) this.n.push(v);
    for (const v of o.u) this.u.push(v);
    for (const v of o.c) this.c.push(v);
    for (const i of o.i) this.i.push(i + k);
  }
}

/** Tramos de un lado de largo L: [p0, p1, s0, s1] (p en fracción del lado, s en fracción de la casilla). */
function tramos(L, rep, paso) {
  const out = [];
  if (!(rep > 0)) {
    const n = Math.max(1, Math.ceil(L / paso - 1e-6));
    for (let i = 0; i < n; i++) out.push([i / n, (i + 1) / n, i / n, (i + 1) / n]);
    return out;
  }
  const k = Math.max(1, Math.ceil(rep / paso - 1e-6));
  const st = rep / k;
  let x = 0;
  let j = 0;
  while (x < L - 1e-6) {
    const x1 = Math.min(L, x + st);
    const s0 = (j % k) / k;
    out.push([x / L, x1 / L, s0, s0 + (x1 - x) / rep]);
    x = x1;
    j++;
  }
  return out;
}

/**
 * Marco de un ítem según hacia dónde mira (`dir` local): ancho W a lo largo
 * del frente, fondo D hacia adentro; p(u, w) -> [x, z] (u desde la izquierda
 * vista de frente, w desde el frente hacia atrás); n la normal del frente.
 */
function marco(it) {
  const [dx, dz] = it.dir ?? [0, 1];
  if (dz > 0.5) return { W: it.x1 - it.x0, D: it.z1 - it.z0, p: (u, w) => [it.x0 + u, it.z1 - w], n: [0, 0, 1], r: [1, 0, 0], k: 'zp', yaw: 0 };
  if (dz < -0.5) return { W: it.x1 - it.x0, D: it.z1 - it.z0, p: (u, w) => [it.x1 - u, it.z0 + w], n: [0, 0, -1], r: [-1, 0, 0], k: 'zn', yaw: Math.PI };
  if (dx > 0.5) return { W: it.z1 - it.z0, D: it.x1 - it.x0, p: (u, w) => [it.x1 - w, it.z1 - u], n: [1, 0, 0], r: [0, 0, -1], k: 'xp', yaw: Math.PI / 2 };
  return { W: it.z1 - it.z0, D: it.x1 - it.x0, p: (u, w) => [it.x0 + w, it.z0 + u], n: [-1, 0, 0], r: [0, 0, 1], k: 'xn', yaw: -Math.PI / 2 };
}

// ------------------------------------------------------------------ materiales y mallas compartidas
let MATS = null;
/** Menús pintados de los tableros (los mismos precios del menú de compra). */
function menusTableros() {
  const de = (id) => (LOCAL_SPOTS.find((l) => l.id === id)?.menu ?? []).map((m) => ({ name: m.name, price: m.price }));
  const gen = (t) => (MENUS_COMERCIO[t] ?? []).map((m) => ({ name: m.name, price: m.price }));
  return { menuPapas: de('mandingas92'), menuGranizados: de('granizados92'), menuPanaderia: gen('panaderia'), menuComidas: gen('comidas') };
}

/** Materiales de los comercios (uno por atlas, sin sombreado; compartidos por todos los locales y los frentes). */
export function materialesComercio() {
  if (MATS) return MATS;
  const com = new THREE.MeshBasicMaterial({ map: comerciosAtlas(menusTableros()), vertexColors: true });
  com.name = 'comercio-atlas';
  // El mismo (misma textura) para las mallas instanciadas: three guarda un programa por material y, si uno se
  // dibuja con y sin instancias, lo vuelve a buscar (getParameters y la clave) en cada cambio, varias veces por cuadro.
  const comInst = com.clone();
  comInst.name = 'comercio-atlas-inst';
  const vit = new THREE.MeshBasicMaterial({ map: interiorAtlas(), vertexColors: true });
  vit.name = 'comercio-vitrinas';
  const vidrio = new THREE.MeshBasicMaterial({ color: 0xb6d4e2, transparent: true, opacity: 0.17, depthWrite: false });
  vidrio.name = 'comercio-vidrio';
  MATS = { com, comInst, vit, vidrio };
  return MATS;
}

/** Brillo de los materiales de adentro (game/comercios.js: de día y de noche). */
export function brilloComercios(k) {
  const m = materialesComercio();
  m.com.color.setScalar(k);
  m.comInst.color.setScalar(k);
  m.vit.color.setScalar(k);
}

/** Pinta una geometría con color por cara según la normal (arriba más claro) y UV en la casilla blanca. */
function sombreada(g, tile = 'blanco') {
  const nor = g.attributes.normal;
  const n = nor.count;
  const col = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const ny = nor.getY(v);
    const nz = nor.getZ(v);
    const k = ny > 0.5 ? 1 : ny < -0.5 ? 0.55 : nz > 0.5 ? 0.92 : nz < -0.5 ? 0.7 : 0.8;
    col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const R = COMERCIO_UV[tile];
  const uv = g.attributes.uv;
  if (uv) for (let v = 0; v < uv.count; v++) uv.setXY(v, R[0] + (R[2] - R[0]) * uv.getX(v), R[1] + (R[3] - R[1]) * uv.getY(v));
  else g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2).fill((R[0] + R[2]) / 2), 2));
  return g;
}

/** Recentra una geometría: base en y = 0 y centro en x, z = 0. */
function aPiso(g) {
  g.computeBoundingBox();
  const b = g.boundingBox;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  return g;
}

/** Fuerza UV fijas en la casilla blanca (las mallas de la ropa no traen UV). */
function uvBlanca(g) {
  const n = g.attributes.position.count;
  const R = COMERCIO_UV.blanco;
  const a = new Float32Array(n * 2);
  for (let v = 0; v < n; v++) {
    a[v * 2] = (R[0] + R[2]) / 2;
    a[v * 2 + 1] = (R[1] + R[3]) / 2;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(a, 2));
  return g;
}

// Medidas de una cabeza promedio para armar sombreros, gorras y carrieles sin personaje (render/outfit.js).
const CABEZA = { skull: { cx: 0, cz: 0, rx: 0.082, rz: 0.098 }, eyeY: 0, top: 0.12, neck: { x: 0, y: 0 }, chest: { front: 0.11, back: -0.1 }, belly: { front: 0.12, back: -0.1 } };

let GEOS = null;
/** Geometrías de las instancias (unidades: se escalan por instancia; base en y = 0). */
function geos() {
  if (GEOS) return GEOS;
  const caja = sombreada(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const lata = sombreada(new THREE.CylinderGeometry(0.5, 0.5, 1, 10).translate(0, 0.5, 0));
  const pan = sombreada(new THREE.SphereGeometry(0.5, 9, 6).scale(1, 0.62, 1).translate(0, 0.31, 0));
  const balde = sombreada(new THREE.CylinderGeometry(0.5, 0.38, 1, 12).translate(0, 0.5, 0));
  // Prenda colgada (camisa, buso): cuerpo plano con hombros y mangas, colgada
  // de un tubo a lo largo de z (el plano de la prenda es x-y: una tras otra).
  const prenda = (() => {
    const parts = [];
    const add = (g) => parts.push(g.toNonIndexed());
    add(new THREE.BoxGeometry(0.42, 0.62, 0.022).translate(0, -0.38, 0));
    add(new THREE.BoxGeometry(0.58, 0.12, 0.024).translate(0, -0.12, 0)); // hombros y mangas
    add(new THREE.BoxGeometry(0.14, 0.32, 0.02).translate(-0.27, -0.3, 0));
    add(new THREE.BoxGeometry(0.14, 0.32, 0.02).translate(0.27, -0.3, 0));
    add(new THREE.BoxGeometry(0.01, 0.07, 0.01).translate(0, -0.03, 0)); // gancho de la percha
    return sombreada(mergeSimple(parts), 'tela');
  })();
  // Ruana y poncho: paño largo colgado del tubo (la tela con sus flecos abajo).
  const pano = (tile) => sombreada(new THREE.BoxGeometry(0.5, 0.78, 0.03).translate(0, -0.41, 0), tile);
  const sombrero = aPiso(uvBlanca(hatGeo(CABEZA, ROPA_BY_ID['sombrero-aguadeno'])));
  // Gorra en blanco (la tiñe la instancia).
  const gorra = aPiso(uvBlanca(capGeo(CABEZA, { ...ROPA_BY_ID['gorra-curva-azul'], color: 0xffffff, color2: 0xdddddd })));
  const carriel = aPiso(uvBlanca(carrielGeo(CABEZA, ROPA_BY_ID.carriel).bag));
  GEOS = { caja, lata, pan, balde, prenda, ruana: pano('ruana'), poncho: pano('poncho'), sombrero, gorra, carriel };
  return GEOS;
}

/** Une geometrías no indexadas (posición, normal, uv). */
function mergeSimple(parts) {
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

const M4 = new THREE.Matrix4();
const MB = new THREE.Matrix4();
const Q4 = new THREE.Quaternion();
const E4 = new THREE.Euler();
const V4 = new THREE.Vector3();
const S4 = new THREE.Vector3();
const COL = new THREE.Color();
const hashStr = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

// ------------------------------------------------------------------ vista de un comercio
/** Un comercio armado (o armándose): misma interfaz que render/interiorBuilder.js InteriorView. */
export class LocalView {
  constructor(r) {
    this.r = r;
    this.group = new THREE.Group();
    this.group.name = `comercio-${r.id}`;
    this.group.position.set(r.ox, 0, r.oz);
    this.group.rotation.y = r.rot;
    this.group.visible = false;
    this.group.updateMatrix();
    this.group.matrixAutoUpdate = false;
    this.ready = false;
    this.rng = makeRng(hashStr(r.id) || 7);
    this.muro = MUROS[hashStr(r.id) % MUROS.length];
    this.lightSpot = { x: 0, y: r.y0 + r.H - 0.4, z: (r.Z0 + r.Z1) / 2 };
    this._gen = this._build();
    this._own = []; // geometrías propias (las de las instancias son compartidas)
  }

  /** Avanza el armado unos `ms`; true cuando ya está. */
  step(ms = COMERCIO_FX.ARMADO_MS) {
    if (this.ready) return true;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (this._gen.next().done) {
        this.ready = true;
        break;
      }
    }
    return this.ready;
  }

  /** Arma todo de una (pruebas y calentamiento). */
  buildNow() {
    while (!this.step(1000));
    return this;
  }

  *_build() {
    const r = this.r;
    const M = materialesComercio();
    geos();
    this.com = new Malla(COMERCIO_UV);
    this.vit = new Malla(ATLAS);
    this.comLuz = new Malla(COMERCIO_UV);
    this.vitLuz = new Malla(ATLAS);
    this.vidrio = new Malla(COMERCIO_UV);
    this.inst = new Map();
    this.luces = [];
    // Las fuentes de luz primero (los productos toman su luz al final).
    for (const it of r.items) this._luz(it);
    yield;
    this._estructura();
    yield;
    for (let k = 0; k < r.items.length; k++) {
      this._item(r.items[k]);
      if (k % 6 === 5) yield;
    }
    // Luz horneada y lo que brilla encima.
    const base = COMERCIO_FX.BASE;
    this.com.bake(this.luces, base, COMERCIO_FX.LUZ);
    yield;
    this.vit.bake(this.luces, base, COMERCIO_FX.LUZ);
    this.com.append(this.comLuz);
    this.vit.append(this.vitLuz);
    yield;
    for (const [acc, mat, name] of [[this.com, M.com, 'atlas'], [this.vit, M.vit, 'vitrinas'], [this.vidrio, M.vidrio, 'vidrio']]) {
      if (!acc.count) continue;
      const g = acc.build();
      this._own.push(g);
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = `comercio-${name}`;
      mesh.matrixAutoUpdate = false;
      if (mat === M.vidrio) mesh.renderOrder = 2;
      this.group.add(mesh);
      yield;
    }
    this.com = this.vit = this.comLuz = this.vitLuz = this.vidrio = null;
    // Instancias por tipo (con la luz del sitio en el color).
    const G = geos();
    for (const [tipo, list] of this.inst) {
      const n = Math.min(list.length, COMERCIO_FX.MAX_INSTANCIAS);
      if (!n) continue;
      const mesh = new THREE.InstancedMesh(G[tipo], M.comInst, n);
      mesh.name = `comercio-${tipo}`;
      for (let k = 0; k < n; k++) {
        const q = list[k];
        E4.set(q[10] ?? 0, q[6], q[11] ?? 0, 'YXZ');
        Q4.setFromEuler(E4);
        M4.compose(V4.set(q[0], q[1], q[2]), Q4, S4.set(q[3], q[4], q[5]));
        mesh.setMatrixAt(k, M4);
        const l = this._luzEn(q[0], q[1] + q[4] * 0.6, q[2]);
        mesh.setColorAt(k, COL.setRGB(q[7] * l[0], q[8] * l[1], q[9] * l[2]));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      yield;
    }
    this.inst = null;
    this.group.updateMatrixWorld(true);
  }

  // -------------------------------------------------------------- luz
  /** Luz horneada en un punto (normal hacia arriba-frente): para teñir las instancias. */
  _luzEn(x, y, z) {
    const b = COMERCIO_FX.BASE;
    let r0 = b[0];
    let g0 = b[1];
    let b0 = b[2];
    for (const L of this.luces) {
      const dx = L.x - x;
      const dy = L.y - y;
      const dz = L.z - z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-4;
      if (d > L.r) continue;
      const f = 1 - d / L.r;
      const k = f * f * L.i * 0.85;
      r0 += L.c[0] * k;
      g0 += L.c[1] * k;
      b0 += L.c[2] * k;
    }
    const s = COMERCIO_FX.LUZ;
    return [r0 * s, g0 * s, b0 * s];
  }

  /** Fuentes de luz falsas de los ítems que alumbran (tubos, nevera, televisor, veladora, horno, aviso). */
  _luz(it) {
    const r = this.r;
    const add = (x, y, z, c, i, rad) => this.luces.push({ x, y, z, c, i, r: rad });
    switch (it.t) {
      case 'tubo':
        add(it.x, it.y - 0.15, it.z, COMERCIO_FX.TUBO_COLOR, COMERCIO_FX.TUBO_FUERZA, COMERCIO_FX.TUBO_ALCANCE);
        break;
      case 'nevera': {
        const F = marco(it);
        const [x, z] = F.p(F.W / 2, -0.4);
        add(x, it.y + 1.1, z, [0.75, 0.9, 1.1], 0.32, 1.9);
        break;
      }
      case 'tv':
        add(it.x + (it.mira?.[0] ?? 0) * 0.5, it.y, it.z + (it.mira?.[1] ?? 0) * 0.5, [0.5, 0.8, 0.7], 0.16, 1.8);
        break;
      case 'altar':
        add(it.x, it.y + 0.15, it.z + 0.2, [1.2, 0.55, 0.25], 0.32, 1.3);
        break;
      case 'horno': {
        const F = marco(it);
        const [x, z] = F.p(F.W / 2, -0.3);
        add(x, it.y + 0.9, z, [1.3, 0.75, 0.35], 0.4, 1.8);
        break;
      }
      case 'cruz':
        add(it.x, it.y, it.z + 0.3, [0.4, 1.2, 0.6], 0.25, 1.6);
        break;
      default:
        break;
    }
    void r;
  }

  // -------------------------------------------------------------- estructura
  _estructura() {
    const r = this.r;
    const { X0, X1, Z0, Z1, y0 } = r;
    const top = y0 + r.H;
    const com = this.com;
    const P = COMERCIO_FX.PASO;
    // Piso.
    const [atl, ptile, prep] = PISOS[r.tema] ?? PISOS.tienda;
    const piso = atl === 'vit' ? this.vit : com;
    piso.caraRep([X0, y0, Z1], [X1 - X0, 0, 0], [0, 0, Z0 - Z1], [0, 1, 0], ptile, [1, 1, 1], prep, prep, P);
    // Techo de placa pañetado (blanco).
    com.caraRep([X0, top, Z0], [X1 - X0, 0, 0], [0, 0, Z1 - Z0], [0, -1, 0], 'panete', [0.93, 0.93, 0.91], 1.2, 1.2, P);
    // Muros (pañete de color): fondo, costados y la fachada por dentro con el vano de la puerta.
    const mc = this.muro;
    const H = r.H;
    com.caraRep([X1, y0, Z0], [X0 - X1, 0, 0], [0, H, 0], [0, 0, 1], 'panete', mc, 1.2, 1.2, P);
    com.caraRep([X0, y0, Z0], [0, 0, Z1 - Z0], [0, H, 0], [1, 0, 0], 'panete', mc, 1.2, 1.2, P);
    com.caraRep([X1, y0, Z1], [0, 0, Z0 - Z1], [0, H, 0], [-1, 0, 0], 'panete', mc, 1.2, 1.2, P);
    const d = r.door;
    com.caraRep([d.x0, y0, Z1], [X0 - d.x0, 0, 0], [0, H, 0], [0, 0, -1], 'panete', mc, 1.2, 1.2, P);
    com.caraRep([X1, y0, Z1], [d.x1 - X1, 0, 0], [0, H, 0], [0, 0, -1], 'panete', mc, 1.2, 1.2, P);
    if (top - (r.floorY + d.h) > 0.02) com.caraRep([d.x1, r.floorY + d.h, Z1], [d.x0 - d.x1, 0, 0], [0, top - r.floorY - d.h, 0], [0, 0, -1], 'panete', mc, 1.2, 1.2, P);
    // Jambas y dintel del vano por dentro del muro (la fachada pone lo de afuera).
    const T = INTERIOR.MURO;
    com.caja(d.x0 - 0.06, d.x0, r.floorY, r.floorY + d.h, -T, -0.2, { col: [0.3, 0.31, 0.33], skip: 'y-' });
    com.caja(d.x1, d.x1 + 0.06, r.floorY, r.floorY + d.h, -T, -0.2, { col: [0.3, 0.31, 0.33], skip: 'y-' });
    com.caja(d.x0 - 0.06, d.x1 + 0.06, r.floorY + d.h, r.floorY + d.h + 0.06, -T, -0.2, { col: [0.3, 0.31, 0.33], skip: 'y-' });
    // Umbral de la puerta.
    com.caja(d.x0, d.x1, r.floorY - 0.02, r.floorY + 0.01, -T, -0.02, { t: 'granito', col: [0.8, 0.8, 0.8], skip: 'y-' });
    // Cuadro de la luz y tomacorrientes (detalle de toda casa paisa).
    const ex = X0 + 0.02;
    com.caja(ex, ex + 0.06, y0 + 1.7, y0 + 2.05, Z1 - 0.55, Z1 - 0.3, { col: [0.82, 0.82, 0.8] });
  }

  // -------------------------------------------------------------- ítems
  _item(it) {
    switch (it.t) {
      case 'mostrador':
        return this._mostrador(it);
      case 'tablilla':
        return this._tablilla(it);
      case 'estante':
        return this._estante(it);
      case 'nevera':
        return this._nevera(it);
      case 'canastas':
        return this._canastas(it);
      case 'bultos':
        return this._bultos(it);
      case 'mesa':
        return this._mesa(it);
      case 'silla':
        return this._silla(it.cx ?? (it.x0 + it.x1) / 2, it.cz ?? (it.z0 + it.z1) / 2, it.y, it.dir ?? [0, 1], it.kind, it.color ?? 0);
      case 'platanos':
        return this._platanos(it);
      case 'tiraMecato':
        return this._tira(it);
      case 'altar':
        return this._altar(it);
      case 'tv':
        return this._tv(it);
      case 'afiche':
        return this._afiche(it);
      case 'zocalo':
        return this._zocalo(it);
      case 'tubo':
        return this._tubo(it);
      case 'horno':
        return this._horno(it);
      case 'bandejas':
        return this._bandejas(it);
      case 'cocina':
        return this._cocina(it);
      case 'campana':
        return this._campana(it);
      case 'barraPared':
        return this._barraPared(it);
      case 'butaca':
        return this._butaca(it);
      case 'vestier':
        return this._vestier(it);
      case 'repisa':
        return this._repisa(it);
      case 'espejo':
        return this._espejo(it);
      case 'perchero':
        return this._perchero(it);
      case 'maniqui':
        return this._maniqui(it);
      case 'bascula':
        return this._bascula(it);
      case 'baldes':
        return this._baldes(it);
      case 'escobas':
        return this._escobas(it);
      case 'colgados':
        return this._colgados(it);
      case 'fotocopiadora':
        return this._fotocopiadora(it);
      case 'cruz':
        return this._cruz(it);
      default:
        return null;
    }
  }

  /** Instancia: tipo, posición (base), escala, giro en y y color (lineal). */
  _i(tipo, x, y, z, sx, sy, sz, ry, col, rx = 0, rz = 0) {
    let l = this.inst.get(tipo);
    if (!l) this.inst.set(tipo, (l = []));
    l.push([x, y, z, sx, sy, sz, ry, col[0], col[1], col[2], rx, rz]);
  }

  /** Caja en el espacio del frente de un ítem (u a lo ancho, w hacia atrás). o: como Malla.caja; `frente` = casilla de la cara del frente. */
  _fbox(F, u0, u1, w0, w1, y0, y1, o = {}, acc = this.com) {
    const [ax, az] = F.p(u0, w0);
    const [bx, bz] = F.p(u1, w1);
    const t = typeof o.t === 'object' ? { ...o.t } : { t: o.t ?? 'blanco' };
    if (o.frente) t[F.k] = o.frente;
    acc.caja(Math.min(ax, bx), Math.max(ax, bx), y0, y1, Math.min(az, bz), Math.max(az, bz), { ...o, t });
  }

  /** Cuadro de casilla en el plano del frente (w < 0 = hacia afuera del ítem), repetido cada `rep` m. */
  _fquad(F, acc, tile, u0, u1, y0, y1, w, col, rep = 0) {
    const [x, z] = F.p(u0, w);
    acc.caraRep([x, y0, z], [F.r[0] * (u1 - u0), 0, F.r[2] * (u1 - u0)], [0, y1 - y0, 0], F.n, tile, col, rep, 0, 99);
  }

  _mostrador(it) {
    const F = marco(it);
    const y = it.y;
    const h = it.h;
    const k = it.kind;
    const cuerpo = k === 'acero' ? 'acero' : k === 'blanco' ? 'blanco' : 'madera';
    const cc = k === 'blanco' ? [0.93, 0.94, 0.95] : k === 'acero' ? ACERO : MADERA;
    this._fbox(F, 0.02, F.W - 0.02, 0.05, F.D, y, y + 0.1, { col: NEGRO });
    this._fbox(F, 0, F.W, 0, F.D, y + 0.1, y + h - 0.05, { t: cuerpo, col: cc, rep: 1.2, paso: 1.2 });
    // El frente: la vitrina pintada (dulces, pan, comida, remedios...) con el vidrio delante.
    if (it.frente) {
      const rep = Math.max(1.2, F.W / Math.max(1, Math.round(F.W / 1.6)));
      const tile = ATLAS[it.frente] ? it.frente : null;
      if (tile) this._fquad(F, this.vit, tile, 0.04, F.W - 0.04, y + 0.14, y + h - 0.1, -0.006, [1.12, 1.12, 1.12], rep);
      else this._fquad(F, this.com, it.frente, 0.04, F.W - 0.04, y + 0.14, y + h - 0.1, -0.006, [1, 1, 1], rep);
      this._fquad(F, this.vidrio, 'blanco', 0.03, F.W - 0.03, y + 0.12, y + h - 0.07, -0.02, [1, 1, 1]);
    }
    // Sobre (un poco volado hacia los clientes).
    this._fbox(F, -0.03, F.W + 0.03, -0.05, F.D + 0.02, y + h - 0.05, y + h, { t: k === 'acero' ? 'acero' : k === 'blanco' ? 'granito' : 'maderaOscura', col: k === 'blanco' ? [0.95, 0.95, 0.95] : [1, 1, 1], rep: 1.2 });
    const top = y + h;
    const list = it.encima ?? [];
    list.forEach((e, i) => {
      const u = F.W * ((i + 0.6) / (list.length + 0.4));
      this._encima(e, F, u, F.D * 0.5, top);
    });
  }

  /** Lo que va encima del mostrador. */
  _encima(e, F, u, w, y) {
    const com = this.com;
    const at = (du, dw) => F.p(u + du, w + dw);
    const rng = this.rng;
    switch (e) {
      case 'balanza': {
        const [x, z] = at(0, 0);
        com.caja(x - 0.15, x + 0.15, y, y + 0.08, z - 0.12, z + 0.12, { col: [0.95, 0.95, 0.94] });
        com.cyl(x, y + 0.08, z, 0.14, 0.14, 0.015, ACERO, 16);
        com.caja(x - 0.08, x + 0.08, y + 0.08, y + 0.3, z - 0.02, z + 0.02, { col: [0.9, 0.2, 0.15] });
        break;
      }
      case 'frascos':
        for (let k = 0; k < 4; k++) {
          const [x, z] = at(-0.3 + k * 0.2, rng.range(-0.05, 0.05));
          this._i('lata', x, y, z, 0.15, 0.22, 0.15, 0, rng.pick(VIVOS));
          this._i('lata', x, y + 0.22, z, 0.12, 0.04, 0.12, 0, [0.85, 0.15, 0.1]);
        }
        break;
      case 'registradora': {
        const [x, z] = at(0, 0.05);
        com.caja(x - 0.18, x + 0.18, y, y + 0.14, z - 0.16, z + 0.16, { col: [0.22, 0.22, 0.24] });
        com.caja(x - 0.16, x + 0.16, y + 0.14, y + 0.17, z - 0.04, z + 0.14, { col: [0.5, 0.5, 0.52] });
        com.caja(x - 0.08, x + 0.08, y + 0.14, y + 0.26, z - 0.14, z - 0.06, { col: [0.15, 0.3, 0.2] });
        break;
      }
      case 'greca': {
        const [x, z] = at(0, 0);
        com.cyl(x, y, z, 0.13, 0.14, 0.42, ACERO, 16);
        com.sphere(x, y + 0.42, z, 0.12, ACERO, 12);
        com.caja(x - 0.03, x + 0.03, y + 0.06, y + 0.12, z + 0.12, z + 0.2, { col: NEGRO });
        for (let k = 0; k < 3; k++) {
          const [cx, cz] = at(0.25 + k * 0.1, 0.05);
          this._i('lata', cx, y, cz, 0.07, 0.08, 0.07, 0, [0.95, 0.95, 0.93]);
        }
        break;
      }
      case 'canastaPan': {
        const [x, z] = at(0, 0);
        com.caja(x - 0.22, x + 0.22, y, y + 0.1, z - 0.15, z + 0.15, { t: 'bulto', col: [0.9, 0.75, 0.55] });
        for (let k = 0; k < 7; k++) this._i('pan', x + rng.range(-0.16, 0.16), y + 0.08, z + rng.range(-0.1, 0.1), 0.11, 0.11, 0.11, rng.range(0, 3), rng.pick(PAN));
        break;
      }
      case 'licuadoras':
        for (let k = 0; k < 2; k++) {
          const [x, z] = at(-0.15 + k * 0.32, 0);
          com.caja(x - 0.08, x + 0.08, y, y + 0.12, z - 0.08, z + 0.08, { col: k ? [0.9, 0.9, 0.9] : [0.2, 0.2, 0.22] });
          this.vidrio.caja(x - 0.07, x + 0.07, y + 0.12, y + 0.36, z - 0.07, z + 0.07, { skip: 'y-' });
          this._i('lata', x, y + 0.12, z, 0.12, 0.12 + k * 0.08, 0.12, 0, k ? [0.75, 0.12, 0.35] : [0.95, 0.8, 0.3]);
        }
        break;
      case 'vasos':
        for (let k = 0; k < 3; k++) {
          const [x, z] = at(-0.12 + k * 0.12, 0.05);
          this._i('lata', x, y, z, 0.08, 0.3, 0.08, 0, [0.95, 0.95, 0.96]);
        }
        break;
      case 'salsas':
        for (const [k, c] of [[0, [0.85, 0.12, 0.1]], [1, [0.96, 0.8, 0.15]], [2, [0.95, 0.95, 0.92]]]) {
          const [x, z] = at(-0.12 + k * 0.12, 0.08);
          this._i('lata', x, y, z, 0.065, 0.2, 0.065, 0, c);
          this._i('lata', x, y + 0.2, z, 0.03, 0.04, 0.03, 0, c);
        }
        break;
      case 'vitrinaComida': {
        // Vitrina de vidrio sobre la barra con empanadas, papas y chorizos (con su bombillo).
        const [x, z] = at(0, 0);
        const L = 0.9;
        this.vidrio.caja(x - L / 2, x + L / 2, y, y + 0.42, z - 0.2, z + 0.2, { skip: 'y-' });
        com.caja(x - L / 2, x + L / 2, y, y + 0.03, z - 0.2, z + 0.2, { t: 'acero', col: ACERO });
        com.caja(x - L / 2, x + L / 2, y + 0.2, y + 0.215, z - 0.18, z + 0.18, { t: 'acero', col: [0.95, 0.95, 0.95] });
        this.comLuz.caja(x - L / 2 + 0.05, x + L / 2 - 0.05, y + 0.4, y + 0.415, z - 0.02, z + 0.02, { col: [2.4, 2.1, 1.5], skip: 'y+' });
        for (let k = 0; k < 8; k++) this._i('pan', x - L / 2 + 0.09 + (k % 4) * 0.22, y + 0.03, z - 0.08 + Math.floor(k / 4) * 0.16, 0.12, 0.07, 0.08, rng.range(-0.3, 0.3), [0.88, 0.6, 0.25]);
        for (let k = 0; k < 6; k++) this._i('caja', x - L / 2 + 0.12 + k * 0.13, y + 0.215, z + rng.range(-0.08, 0.08), 0.03, 0.03, 0.09, rng.range(0, 3), [0.95, 0.8, 0.3]);
        for (let k = 0; k < 3; k++) this._i('lata', x - L / 2 + 0.2 + k * 0.25, y + 0.215, z - 0.06, 0.045, 0.045, 0.045, 0, [0.55, 0.15, 0.08], 0, Math.PI / 2);
        break;
      }
      case 'servilletero': {
        const [x, z] = at(0, 0.1);
        com.caja(x - 0.08, x + 0.08, y, y + 0.1, z - 0.04, z + 0.04, { col: ACERO });
        com.caja(x - 0.07, x + 0.07, y + 0.02, y + 0.12, z - 0.03, z + 0.03, { col: [0.98, 0.98, 0.98] });
        break;
      }
      case 'exhibidorChico': {
        const [x, z] = at(0, 0);
        this.vidrio.caja(x - 0.22, x + 0.22, y, y + 0.3, z - 0.14, z + 0.14, { skip: 'y-' });
        for (let k = 0; k < 6; k++) this._i('caja', x - 0.17 + (k % 3) * 0.17, y + 0.02 + Math.floor(k / 3) * 0.14, z, 0.1, 0.1, 0.06, 0, rng.pick(DROGAS));
        break;
      }
      case 'celulares':
        for (let k = 0; k < 2; k++) {
          const [x, z] = at(k * 0.22, 0);
          com.caja(x - 0.05, x + 0.05, y, y + 0.02, z - 0.06, z + 0.06, { col: NEGRO });
          com.caja(x - 0.035, x + 0.035, y + 0.02, y + 0.17, z - 0.01, z + 0.01, { col: [0.12, 0.12, 0.14], cols: { [F.k]: [0.3, 0.5, 0.8] } });
        }
        break;
      case 'bolsas':
        for (let k = 0; k < 2; k++) {
          const [x, z] = at(k * 0.3, 0);
          this._i('caja', x, y, z, 0.24, 0.3, 0.12, rng.range(-0.2, 0.2), k ? [0.95, 0.9, 0.82] : [0.75, 0.2, 0.3]);
        }
        break;
      default:
        break;
    }
  }

  _tablilla(it) {
    // Levantada contra el muro: el paso queda abierto.
    // (Del mismo material del sobre del mostrador: formica blanca, acero o madera.)
    const x = Math.abs(it.x0 - this.r.X0) < 0.05 ? it.x0 + 0.02 : it.x1 - 0.05;
    const k = this.r.items.find((q) => q.t === 'mostrador')?.kind;
    const t = k === 'acero' ? 'acero' : k === 'blanco' ? 'granito' : 'maderaOscura';
    this.com.caja(x, x + 0.03, it.y - 0.05, it.y + 0.6, it.z0 + 0.04, it.z1 - 0.04, { t, col: k === 'blanco' ? [0.95, 0.95, 0.95] : [1, 1, 1] });
  }

  _estante(it) {
    const F = marco(it);
    const y = it.y;
    const h = it.h;
    const prod = it.prod ?? 'viveres';
    const metal = prod === 'viveres' || prod === 'drogas' || prod === 'cacharro';
    const fr = metal ? { t: 'blanco', col: prod === 'drogas' ? [0.93, 0.95, 0.96] : [0.62, 0.64, 0.67] } : { t: 'madera', col: MADERA };
    const D = F.D;
    // Fondo pintado (las casillas del atlas de las vitrinas: estanterías llenas) por tramos.
    const tiles = it.tex ?? ['gondola-viveres'];
    const seg = Math.max(1, Math.round(F.W / 1.3));
    for (let s = 0; s < seg; s++) {
      const u0 = (F.W * s) / seg;
      const u1 = (F.W * (s + 1)) / seg;
      const t = tiles[s % tiles.length];
      const back = D - 0.02;
      if (ATLAS[t]) this._fquad(F, this.vit, t, u0, u1, y + 0.08, y + h - 0.04, back, [1.05, 1.05, 1.05]);
      else this._fquad(F, this.com, t, u0, u1, y + 0.08, y + h - 0.04, back, [1, 1, 1]);
    }
    // Costados, techo y zócalo del mueble.
    this._fbox(F, 0, 0.035, 0, D, y, y + h, fr);
    this._fbox(F, F.W - 0.035, F.W, 0, D, y, y + h, fr);
    this._fbox(F, 0, F.W, 0, D, y + h - 0.035, y + h, fr);
    this._fbox(F, 0, F.W, 0, D, y, y + 0.08, { ...fr, col: fr.col.map((v) => v * 0.6) });
    // Repisas y lo de encima.
    const n = Math.max(3, Math.round((h - 0.1) / 0.42));
    const rng = this.rng;
    for (let k = 0; k < n; k++) {
      const yb = y + 0.08 + ((h - 0.12) * k) / n;
      if (k > 0) this._fbox(F, 0.035, F.W - 0.035, 0, D, yb - 0.022, yb, fr);
      const alto = (h - 0.12) / n - 0.06;
      this._llenar(F, prod, 0.06, F.W - 0.06, yb, alto, D, rng, k);
    }
  }

  /** Productos 3D al frente de una repisa (u de u0 a u1, sobre yb, hasta `alto` de alto). */
  _llenar(F, prod, u0, u1, yb, alto, D, rng, nivel) {
    let u = u0 + rng.range(0, 0.06);
    const fill = COMERCIO_FX.RELLENO;
    while (u < u1 - 0.05) {
      if (rng.next() > fill) {
        u += rng.range(0.12, 0.3);
        continue;
      }
      const w0 = rng.range(0.03, 0.09);
      switch (prod) {
        case 'pan': {
          const s = rng.range(0.08, 0.13);
          for (let j = 0; j < 2; j++) {
            const [x, z] = F.p(u + s / 2, w0 + j * (s + 0.02) + s / 2);
            this._i('pan', x, yb, z, s, s * rng.range(0.8, 1.1), s * rng.range(0.9, 1.3), rng.range(0, 3), rng.pick(PAN));
          }
          u += s + 0.02;
          break;
        }
        case 'drogas': {
          const w = rng.range(0.05, 0.1);
          const hh = Math.min(alto, rng.range(0.06, 0.14));
          const c = rng.pick(DROGAS);
          for (let j = 0; j < 2; j++) {
            const [x, z] = F.p(u + w / 2, w0 + j * 0.1 + 0.04);
            this._i('caja', x, yb, z, w, hh, 0.08, F.yaw, c);
          }
          u += w + 0.012;
          break;
        }
        case 'cacharro': {
          const r0 = rng.range(0.06, 0.12);
          const [x, z] = F.p(u + r0, w0 + r0);
          if (rng.chance(0.5)) this._i('balde', x, yb, z, r0 * 2, Math.min(alto, r0 * 1.8), r0 * 2, 0, rng.pick(VIVOS));
          else this._i('lata', x, yb, z, r0 * 2, Math.min(alto, r0 * 1.2), r0 * 2, 0, rng.chance(0.5) ? [0.7, 0.72, 0.75] : rng.pick(VIVOS));
          u += r0 * 2 + 0.03;
          break;
        }
        case 'papel': {
          const w = rng.range(0.16, 0.3);
          const n = rng.int(3, 9);
          const c = rng.chance(0.4) ? [0.97, 0.97, 0.96] : rng.pick(VIVOS);
          const [x, z] = F.p(u + w / 2, w0 + 0.12);
          this._i('caja', x, yb, z, w, Math.min(alto, n * 0.012), 0.22, F.yaw, c);
          u += w + 0.03;
          break;
        }
        case 'ropa': {
          const w = rng.range(0.26, 0.34);
          const n = rng.int(3, 6);
          for (let j = 0; j < n && j * 0.05 < alto - 0.05; j++) {
            const [x, z] = F.p(u + w / 2 + rng.range(-0.01, 0.01), w0 + 0.13);
            this._i('caja', x, yb + j * 0.05, z, w, 0.045, 0.24, F.yaw, rng.pick(VIVOS));
          }
          u += w + 0.04;
          break;
        }
        case 'sombreros': {
          const [x, z] = F.p(u + 0.2, Math.min(D - 0.18, 0.2));
          if (nivel % 2 === 0) this._i('sombrero', x, yb, z, 1, 1, 1, F.yaw + rng.range(-0.3, 0.3), [1, 1, 1]);
          else this._i('carriel', x, yb, z, 1, 1, 1, F.yaw + rng.range(-0.3, 0.3), [0.95, 0.95, 0.95]);
          u += 0.42;
          break;
        }
        case 'tenis': {
          const w = 0.3;
          const [x, z] = F.p(u + w / 2, w0 + 0.11);
          this._i('caja', x, yb, z, w, Math.min(alto, 0.11), 0.2, F.yaw, rng.pick([[0.95, 0.55, 0.15], [0.95, 0.95, 0.95], [0.15, 0.15, 0.18], [0.85, 0.15, 0.15]]));
          if (rng.chance(0.5)) {
            const [gx, gz] = F.p(u + w / 2, w0 + 0.1);
            this._i('gorra', gx, yb + 0.11, gz, 1.05, 1.05, 1.05, F.yaw, rng.pick(VIVOS));
          }
          u += w + 0.05;
          break;
        }
        default: {
          // Víveres: cajas, latas, frascos y bolsas.
          const q = rng.next();
          if (q < 0.4) {
            const w = rng.range(0.08, 0.17);
            const hh = Math.min(alto, rng.range(0.12, 0.3));
            const c = rng.pick(VIVOS);
            for (let j = 0; j < 2; j++) {
              const [x, z] = F.p(u + w / 2, w0 + j * 0.13 + 0.06);
              this._i('caja', x, yb, z, w, hh, 0.11, F.yaw, c);
            }
            u += w + 0.015;
          } else if (q < 0.75) {
            const rr = rng.range(0.035, 0.05);
            const hh = Math.min(alto, rng.range(0.1, 0.2));
            const c = rng.pick(VIVOS);
            for (let j = 0; j < 3; j++) {
              const [x, z] = F.p(u + rr, w0 + rr + j * (rr * 2 + 0.01));
              this._i('lata', x, yb, z, rr * 2, hh, rr * 2, 0, c);
            }
            u += rr * 2 + 0.012;
          } else {
            const w = rng.range(0.14, 0.22);
            const [x, z] = F.p(u + w / 2, w0 + 0.08);
            this._i('caja', x, yb, z, w, Math.min(alto, rng.range(0.18, 0.3)), 0.1, F.yaw + rng.range(-0.15, 0.15), rng.pick(VIVOS), rng.range(-0.06, 0.06));
            u += w + 0.02;
          }
        }
      }
    }
  }

  _nevera(it) {
    const F = marco(it);
    const y = it.y;
    const h = it.h;
    const body = this.rng.chance(0.5) ? [0.95, 0.95, 0.96] : [0.8, 0.12, 0.12];
    this._fbox(F, 0, F.W, 0, F.D, y, y + h, { col: body });
    // Puerta de vidrio iluminada (las botellas del atlas de las vitrinas) y el aviso de arriba.
    this._fquad(F, this.vitLuz, 'nevera', 0.05, F.W - 0.05, y + 0.12, y + h - 0.28, -0.006, [1.45, 1.5, 1.6]);
    this._fquad(F, this.vidrio, 'blanco', 0.04, F.W - 0.04, y + 0.1, y + h - 0.26, -0.02, [1, 1, 1]);
    this._fquad(F, this.comLuz, 'blanco', 0.03, F.W - 0.03, y + h - 0.24, y + h - 0.04, -0.008, this.rng.pick([[2.2, 0.35, 0.25], [0.3, 0.6, 2.1], [0.3, 1.6, 0.4]]));
    const [x, z] = F.p(F.W - 0.1, -0.03);
    this.com.caja(x - 0.02, x + 0.02, y + 0.6, y + 1.3, z - 0.02, z + 0.02, { col: [0.75, 0.75, 0.78] });
  }

  _canastas(it) {
    const n = it.n ?? 3;
    const x0 = it.x0 + 0.01;
    const x1 = it.x1 - 0.01;
    const z0 = it.z0 + 0.01;
    const z1 = it.z1 - 0.01;
    const rng = this.rng;
    for (let k = 0; k < n; k++) {
      const c = rng.pick(CANASTAS);
      const dx = rng.range(-0.02, 0.02);
      const y = it.y + k * 0.29;
      this.com.caja(x0 + dx, x1 + dx, y, y + 0.28, z0, z1, { t: { t: 'canasta', yp: 'blanco', yn: 'blanco' }, col: c });
      if (k === n - 1)
        for (let i = 0; i < 4; i++)
          for (let j = 0; j < 3; j++) this._i('lata', x0 + dx + 0.06 + i * ((x1 - x0 - 0.12) / 3), y + 0.2, z0 + 0.06 + j * ((z1 - z0 - 0.12) / 2), 0.055, 0.12, 0.055, 0, [0.35, 0.18, 0.06]);
    }
  }

  _bultos(it) {
    const rng = this.rng;
    const w = it.x1 - it.x0;
    const n = Math.max(1, Math.floor(w / 0.42));
    for (let k = 0; k < n; k++) {
      const x0 = it.x0 + k * (w / n) + 0.02;
      const x1 = x0 + w / n - 0.04;
      if (k === n - 1 && n > 1) {
        // Panela: arrume de bloques envueltos.
        this.com.caja(x0, x1, it.y, it.y + 0.34, it.z0 + 0.05, it.z1 - 0.05, { t: 'panela', col: [1, 1, 1], skip: 'y-' });
        continue;
      }
      const hh = rng.range(0.5, 0.6);
      const zc = (it.z0 + it.z1) / 2;
      this.com.caja(x0, x1, it.y, it.y + hh * 0.85, zc - 0.21, zc + 0.21, { t: 'bulto', col: [1, 1, 1], skip: 'y-' });
      this.com.caja(x0 + 0.04, x1 - 0.04, it.y + hh * 0.85, it.y + hh, zc - 0.16, zc + 0.16, { t: 'bulto', col: [0.92, 0.92, 0.92], skip: 'y-' });
    }
  }

  _mesa(it) {
    const { cx, cz, y } = it;
    const rng = this.rng;
    if (it.kind === 'metal') {
      this.com.cyl(cx, y + 0.72, cz, 0.36, 0.36, 0.03, [0.78, 0.8, 0.82], 20);
      this.com.cyl(cx, y, cz, 0.025, 0.025, 0.72, [0.3, 0.3, 0.32], 8);
      this.com.cyl(cx, y, cz, 0.24, 0.26, 0.03, [0.3, 0.3, 0.32], 16);
      return;
    }
    const c = PLASTICO[it.color ?? 0];
    this.com.caja(cx - 0.36, cx + 0.36, y + 0.7, y + 0.74, cz - 0.36, cz + 0.36, { col: c, skip: '' });
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.com.caja(cx + a * 0.32 - 0.02, cx + a * 0.32 + 0.02, y, y + 0.7, cz + b * 0.32 - 0.02, cz + b * 0.32 + 0.02, { col: c });
    if (it.domino) {
      // Fichas de dominó: unas en fila (la mano) y otras regadas boca abajo.
      for (let k = 0; k < 7; k++) this._i('caja', cx - 0.2 + k * 0.035, y + 0.74, cz - 0.26, 0.026, 0.05, 0.012, 0, [0.95, 0.94, 0.9]);
      for (let k = 0; k < 7; k++) this._i('caja', cx + 0.2 - k * 0.035, y + 0.74, cz + 0.26, 0.026, 0.05, 0.012, 0, [0.95, 0.94, 0.9]);
      for (let k = 0; k < 10; k++) this._i('caja', cx + rng.range(-0.2, 0.2), y + 0.74, cz + rng.range(-0.15, 0.15), 0.026, 0.012, 0.05, rng.range(0, Math.PI), k % 3 ? [0.95, 0.94, 0.9] : [0.1, 0.1, 0.12]);
      // Dos cervezas.
      this._i('lata', cx + 0.26, y + 0.74, cz - 0.05, 0.06, 0.22, 0.06, 0, [0.4, 0.2, 0.06]);
      this._i('lata', cx - 0.27, y + 0.74, cz + 0.08, 0.06, 0.22, 0.06, 0, [0.4, 0.2, 0.06]);
    }
  }

  /** Silla (plástica o metálica) en (x, z) que mira hacia `dir`. */
  _silla(x, z, y, dir, kind, color) {
    const c = kind === 'metal' ? [0.35, 0.36, 0.4] : PLASTICO[color % 3];
    const com = this.com;
    com.caja(x - 0.21, x + 0.21, y + 0.42, y + 0.46, z - 0.21, z + 0.21, { col: c, skip: '' });
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) com.caja(x + a * 0.18 - 0.018, x + a * 0.18 + 0.018, y, y + 0.42, z + b * 0.18 - 0.018, z + b * 0.18 + 0.018, { col: c });
    // Espaldar del lado contrario a donde mira.
    const [dx, dz] = dir;
    if (Math.abs(dz) > Math.abs(dx)) {
      const zb = z - Math.sign(dz) * 0.2;
      com.caja(x - 0.21, x + 0.21, y + 0.46, y + 0.9, zb - 0.02, zb + 0.02, { col: c, skip: '' });
    } else {
      const xb = x - Math.sign(dx) * 0.2;
      com.caja(xb - 0.02, xb + 0.02, y + 0.46, y + 0.9, z - 0.21, z + 0.21, { col: c, skip: '' });
    }
  }

  _platanos(it) {
    const com = this.com;
    const { x, z, y } = it;
    const yb = y - 0.85;
    com.caja(x - 0.006, x + 0.006, yb + 0.42, y, z - 0.006, z + 0.006, { col: [0.6, 0.5, 0.35] });
    com.cyl(x, yb, z, 0.018, 0.022, 0.44, [0.35, 0.4, 0.15], 6);
    // Gajos (manos) de plátanos pegados al vástago, los dedos curvos hacia arriba.
    const g = new THREE.CylinderGeometry(0.02, 0.016, 0.13, 6);
    for (let tier = 0; tier < 3; tier++)
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + tier * 0.5;
        E4.set(0.5, a, 0, 'YXZ');
        Q4.setFromEuler(E4);
        M4.compose(V4.set(x + Math.sin(a) * 0.045, yb + 0.08 + tier * 0.11, z + Math.cos(a) * 0.045), Q4, S4.set(1, 1, 1));
        com.geom(g, M4, tier === 0 ? [0.6, 0.7, 0.2] : [0.92, 0.82, 0.22]);
      }
    g.dispose();
  }

  _tira(it) {
    const { x, z, y } = it;
    const L = 0.78;
    const yb = y - 0.12 - L;
    // Doble cara: la tira de mecato colgada del techo (con su gancho).
    this.vitLuz.cara([x - 0.1, yb, z], [0.2, 0, 0], [0, L, 0], [0, 0, 1], 'tira-mecato', [1.3, 1.3, 1.3]);
    this.vitLuz.cara([x + 0.1, yb, z - 0.004], [-0.2, 0, 0], [0, L, 0], [0, 0, -1], 'tira-mecato', [1.3, 1.3, 1.3]);
    this.com.caja(x - 0.11, x + 0.11, yb + L, yb + L + 0.03, z - 0.01, z + 0.01, { col: [0.6, 0.6, 0.62] });
    this.com.caja(x - 0.004, x + 0.004, yb + L + 0.03, y, z - 0.004, z + 0.004, { col: [0.5, 0.5, 0.5] });
  }

  _altar(it) {
    const { x, z, y } = it;
    const com = this.com;
    // Repisa de madera con su imagen enmarcada, flores y la veladora encendida.
    com.caja(x - 0.3, x + 0.3, y - 0.03, y, z, z + 0.24, { t: 'maderaOscura', col: [1, 1, 1] });
    com.caja(x - 0.02, x + 0.02, y - 0.22, y - 0.03, z, z + 0.04, { col: OSCURA });
    com.caja(x - 0.17, x + 0.17, y, y + 0.46, z + 0.01, z + 0.04, { t: 'maderaOscura', col: [1, 1, 1] });
    this.comLuz.cara([x - 0.14, y + 0.03, z + 0.045], [0.28, 0, 0], [0, 0.4, 0], [0, 0, 1], 'altar', [1.08, 1.06, 1.02]);
    this.comLuz.cyl(x + 0.2, y, z + 0.12, 0.03, 0.03, 0.09, [2.0, 0.35, 0.25], 10);
    this.comLuz.cyl(x + 0.2, y + 0.09, z + 0.12, 0.006, 0.012, 0.03, [3, 2.4, 1.2], 6);
    for (let k = 0; k < 4; k++) com.sphere(x - 0.22 + (k % 2) * 0.04, y + 0.06 + Math.floor(k / 2) * 0.05, z + 0.12, 0.028, k % 2 ? [0.9, 0.15, 0.2] : [0.98, 0.95, 0.95], 6);
  }

  _tv(it) {
    const { x, z, y } = it;
    const [mx, mz] = it.mira ?? [0, 1];
    const a = Math.atan2(mx, mz);
    E4.set(-0.12, a, 0, 'YXZ');
    Q4.setFromEuler(E4);
    const g = new THREE.BoxGeometry(0.8, 0.48, 0.07);
    M4.compose(V4.set(x, y, z), Q4, S4.set(1, 1, 1));
    this.com.geom(g, M4, NEGRO);
    g.dispose();
    const p = new THREE.PlaneGeometry(0.72, 0.41);
    M4.compose(V4.set(x + Math.sin(a) * 0.04, y, z + Math.cos(a) * 0.04), Q4, S4.set(1, 1, 1));
    this.comLuz.geom(p, M4, [1.25, 1.25, 1.25], 'tv');
    p.dispose();
    // Soporte a la pared.
    this.com.caja(x - 0.04, x + 0.04, y + 0.2, y + 0.6, z - 0.04, z + 0.04, { col: [0.2, 0.2, 0.22] });
  }

  _afiche(it) {
    const F = marco({ x0: it.x - it.w / 2, x1: it.x + it.w / 2, z0: it.z - it.w / 2, z1: it.z + it.w / 2, dir: it.dir });
    const [px, pz] = [it.x, it.z];
    // Centro en (x, z) sobre el plano del muro.
    const o = [px - (F.r[0] * it.w) / 2, it.y - it.h / 2, pz - (F.r[2] * it.w) / 2];
    this.com.cara(o, [F.r[0] * it.w, 0, F.r[2] * it.w], [0, it.h, 0], F.n, it.tex, [1, 1, 1]);
  }

  _zocalo(it) {
    const r = this.r;
    const h = it.h ?? 1;
    const t = it.tex ?? 'baldosaPared';
    const e = 0.006;
    const y0 = r.y0;
    const rep = t === 'madera' ? 1.2 : 0.7;
    const col = t === 'madera' ? [0.75, 0.65, 0.55] : [1, 1, 1];
    const com = this.com;
    com.caraRep([r.X1, y0, r.Z0 + e], [r.X0 - r.X1, 0, 0], [0, h, 0], [0, 0, 1], t, col, rep, rep);
    com.caraRep([r.X0 + e, y0, r.Z0], [0, 0, r.Z1 - r.Z0], [0, h, 0], [1, 0, 0], t, col, rep, rep);
    com.caraRep([r.X1 - e, y0, r.Z1], [0, 0, r.Z0 - r.Z1], [0, h, 0], [-1, 0, 0], t, col, rep, rep);
    const d = r.door;
    com.caraRep([d.x0, y0, r.Z1 - e], [r.X0 - d.x0, 0, 0], [0, h, 0], [0, 0, -1], t, col, rep, rep);
    com.caraRep([r.X1, y0, r.Z1 - e], [d.x1 - r.X1, 0, 0], [0, h, 0], [0, 0, -1], t, col, rep, rep);
    // Remate del zócalo.
    if (h > 0.3) com.caja(r.X0, r.X1, y0 + h, y0 + h + 0.025, r.Z0, r.Z0 + 0.02, { col: [0.55, 0.45, 0.35], skip: 'y- z-' });
  }

  _tubo(it) {
    const { x, z, y } = it;
    const L = it.largo ?? 1.2;
    this.com.caja(x - L / 2 - 0.03, x + L / 2 + 0.03, y - 0.05, y - 0.005, z - 0.08, z + 0.08, { col: [0.88, 0.88, 0.86], skip: 'y+' });
    this.comLuz.caja(x - L / 2, x + L / 2, y - 0.075, y - 0.05, z - 0.035, z + 0.035, { col: [2.5, 2.6, 2.6], skip: 'y+' });
  }

  _horno(it) {
    const F = marco(it);
    this._fbox(F, 0, F.W, 0, F.D, it.y, it.y + it.h, { t: 'acero', col: [0.9, 0.9, 0.92] });
    this._fquad(F, this.comLuz, 'horno', 0.05, F.W - 0.05, it.y + 0.15, it.y + it.h - 0.1, -0.006, [1.15, 1.12, 1.1]);
    // Chimenea al techo.
    const [x, z] = F.p(F.W * 0.5, F.D * 0.6);
    this.com.cyl(x, it.y + it.h, z, 0.09, 0.09, this.r.y0 + this.r.H - it.y - it.h, [0.6, 0.6, 0.62], 10);
  }

  _bandejas(it) {
    const F = marco(it);
    const rng = this.rng;
    for (const u of [0.02, F.W - 0.02]) for (const w of [0.02, F.D - 0.02]) this._fbox(F, u - 0.015, u + 0.015, w - 0.015, w + 0.015, it.y, it.y + it.h, { col: ACERO });
    for (let k = 0; k < 7; k++) {
      const y = it.y + 0.15 + k * 0.22;
      this._fbox(F, 0, F.W, 0, F.D, y, y + 0.015, { t: 'acero', col: [0.95, 0.95, 0.95] });
      if (k % 2 === 0)
        for (let i = 0; i < 4; i++)
          for (let j = 0; j < 3; j++) {
            const [x, z] = F.p(0.08 + i * ((F.W - 0.16) / 3), 0.07 + j * ((F.D - 0.14) / 2));
            this._i('pan', x, y + 0.015, z, 0.09, 0.08, 0.09, rng.range(0, 3), rng.pick(PAN));
          }
    }
  }

  _cocina(it) {
    const F = marco(it);
    const y = it.y;
    const h = it.h;
    const com = this.com;
    this._fbox(F, 0, F.W, 0, F.D, y, y + h, { t: 'acero', col: ACERO, rep: 1.0 });
    // Puertas del mueble (rayas oscuras).
    for (let u = 0.6; u < F.W - 0.2; u += 0.6) this._fquad(F, com, 'blanco', u - 0.01, u + 0.01, y + 0.1, y + h - 0.1, -0.004, [0.3, 0.3, 0.32]);
    const top = y + h;
    if (it.kind === 'granizados') {
      // Máquina de raspar hielo, congelador de las frutas y botellas de los siropes.
      const [x, z] = F.p(0.5, F.D * 0.5);
      com.caja(x - 0.2, x + 0.2, top, top + 0.35, z - 0.18, z + 0.18, { col: [0.85, 0.15, 0.2] });
      this.vidrio.caja(x - 0.17, x + 0.17, top + 0.35, top + 0.65, z - 0.15, z + 0.15, { skip: 'y-' });
      com.caja(x - 0.15, x + 0.15, top + 0.35, top + 0.5, z - 0.13, z + 0.13, { col: [0.95, 0.97, 1] });
      for (let k = 0; k < 5; k++) {
        const [bx, bz] = F.p(1.0 + k * 0.14, F.D * 0.45);
        this._i('lata', bx, top, bz, 0.07, 0.28, 0.07, 0, [[0.6, 0.05, 0.25], [0.95, 0.6, 0.1], [0.15, 0.6, 0.2], [0.9, 0.85, 0.2], [0.45, 0.1, 0.5]][k]);
      }
      const [cx, cz] = F.p(F.W - 0.7, F.D * 0.5);
      com.caja(cx - 0.5, cx + 0.5, top, top + 0.06, cz - 0.3, cz + 0.3, { col: [0.95, 0.95, 0.96] });
      this.vidrio.caja(cx - 0.48, cx + 0.48, top + 0.06, top + 0.1, cz - 0.28, cz + 0.28, { skip: 'y-' });
      return;
    }
    // Plancha (negra, con borde de acero), freidora de dos canastas y la olla de las papas.
    const [px, pz] = F.p(0.55, F.D * 0.5);
    com.caja(px - 0.42, px + 0.42, top, top + 0.06, pz - 0.28, pz + 0.28, { col: [0.1, 0.1, 0.1] });
    com.caja(px - 0.44, px + 0.44, top, top + 0.1, pz - 0.3, pz - 0.27, { t: 'acero', col: ACERO });
    for (let k = 0; k < 4; k++) com.caja(px - 0.3 + k * 0.18, px - 0.2 + k * 0.18, top + 0.06, top + 0.075, pz - 0.1, pz + 0.05, { col: [0.75, 0.5, 0.25] }); // arepas y chorizos
    const [fx, fz] = F.p(1.45, F.D * 0.5);
    com.caja(fx - 0.25, fx + 0.25, top, top + 0.3, fz - 0.25, fz + 0.25, { t: 'acero', col: ACERO });
    com.caja(fx - 0.22, fx + 0.22, top + 0.3, top + 0.302, fz - 0.22, fz + 0.22, { col: [0.45, 0.3, 0.08] });
    for (const s of [-1, 1]) {
      com.caja(fx + s * 0.11 - 0.09, fx + s * 0.11 + 0.09, top + 0.29, top + 0.36, fz - 0.15, fz + 0.15, { col: [0.55, 0.55, 0.58], skip: 'y+' });
      const [hx, hz] = F.p(1.45 + s * 0.11, -0.05);
      com.caja(hx - 0.015, hx + 0.015, top + 0.33, top + 0.36, Math.min(hz, fz), Math.max(hz, fz), { col: NEGRO });
    }
    const [ox, oz] = F.p(Math.min(F.W - 0.35, 2.1), F.D * 0.5);
    com.cyl(ox, top, oz, 0.2, 0.18, 0.28, [0.75, 0.76, 0.78], 14);
  }

  _campana(it) {
    const com = this.com;
    const top = this.r.y0 + this.r.H;
    com.caja(it.x0, it.x1, it.y, it.y + 0.12, it.z0, it.z1, { t: 'acero', col: ACERO });
    com.caja(it.x0 + 0.2, it.x1 - 0.2, it.y + 0.12, it.y + 0.4, it.z0, it.z1 - 0.25, { t: 'acero', col: [0.85, 0.86, 0.88] });
    const cx = (it.x0 + it.x1) / 2;
    com.caja(cx - 0.15, cx + 0.15, it.y + 0.4, top, it.z0, it.z0 + 0.3, { t: 'acero', col: [0.8, 0.81, 0.83] });
  }

  _barraPared(it) {
    const com = this.com;
    com.caja(it.x0, it.x1, it.y + it.h - 0.04, it.y + it.h, it.z0, it.z1, { t: 'maderaOscura', col: [1, 1, 1], skip: '' });
    const n = Math.max(2, Math.round((it.z1 - it.z0) / 0.9) + 1);
    for (let k = 0; k < n; k++) {
      const z = it.z0 + 0.06 + ((it.z1 - it.z0 - 0.12) * k) / (n - 1);
      com.caja(it.x0 + 0.02, it.x1 - 0.06, it.y + it.h - 0.25, it.y + it.h - 0.04, z - 0.015, z + 0.015, { col: [0.2, 0.2, 0.22] });
    }
  }

  _butaca(it) {
    const { x, z, y } = it;
    const com = this.com;
    com.cyl(x, y, z, 0.2, 0.22, 0.03, [0.25, 0.25, 0.27], 14);
    com.cyl(x, y + 0.03, z, 0.025, 0.025, 0.66, ACERO, 8);
    com.cyl(x, y + 0.28, z, 0.15, 0.15, 0.015, ACERO, 14, true);
    com.cyl(x, y + 0.69, z, 0.18, 0.17, 0.07, [0.75, 0.12, 0.1], 16);
  }

  _vestier(it) {
    const F = marco(it);
    const y = it.y;
    const h = it.h;
    const col = [0.92, 0.9, 0.86];
    this._fbox(F, 0, 0.04, 0, F.D, y, y + h, { t: 'maderaOscura', col: [1, 1, 1] });
    this._fbox(F, F.W - 0.04, F.W, 0, F.D, y, y + h, { t: 'maderaOscura', col: [1, 1, 1] });
    this._fbox(F, 0, F.W, 0, 0.06, y + h - 0.12, y + h, { t: 'maderaOscura', col: [1, 1, 1] });
    // Adentro: banquito y percha.
    const [bx, bz] = F.p(F.W * 0.5, F.D - 0.2);
    this.com.caja(bx - 0.25, bx + 0.25, y, y + 0.42, bz - 0.15, bz + 0.15, { t: 'madera', col: MADERA });
    // Cortina recogida a un lado (pliegues).
    const n = 7;
    for (let k = 0; k < n; k++) {
      const u0 = 0.05 + k * ((F.W * 0.72) / n);
      const u1 = u0 + (F.W * 0.72) / n;
      const w = k % 2 ? 0.08 : 0.03;
      const [ax, az] = F.p(u0, w);
      const [bx2, bz2] = F.p(u1, k % 2 ? 0.03 : 0.08);
      const n2 = [F.n[0], 0, F.n[2]];
      this.com.cara([ax, y + 0.06, az], [bx2 - ax, 0, bz2 - az], [0, h - 0.24, 0], n2, 'cortina', [1, 1, 1], k / n, 0, (k + 1) / n, 1);
    }
    void col;
  }

  _repisa(it) {
    const r = this.r;
    const F = marco({ x0: it.x0, x1: it.x1, z0: it.z, z1: it.z + 0.34, dir: it.dir });
    const y = it.y;
    const h = it.h;
    const com = this.com;
    const rng = this.rng;
    // Panel del fondo (gorras y tenis: la pared pintada de mercancía).
    if (it.que === 'gorras') this._fquad(F, this.vit, 'gorras', 0, F.W * 0.5, y + 0.9, y + h - 0.05, F.D - 0.01, [1.05, 1.05, 1.05], 1.2);
    if (it.que === 'gorras') this._fquad(F, this.com, 'zapatos', F.W * 0.5, F.W, y + 0.9, y + h - 0.05, F.D - 0.01, [1, 1, 1], 1.2);
    const n = 4;
    for (let k = 0; k < n; k++) {
      const yb = y + 0.5 + k * ((h - 0.6) / (n - 1));
      this._fbox(F, 0, F.W, 0, F.D, yb - 0.03, yb, { t: 'maderaOscura', col: [1, 1, 1] });
      if (it.que === 'gorras' && k > 0) continue;
      for (let u = 0.2; u < F.W - 0.15; u += it.que === 'ropa' ? 0.36 : 0.42) {
        const [x, z] = F.p(u, 0.17);
        if (it.que === 'sombreros') this._i(k % 3 === 2 ? 'carriel' : 'sombrero', x, yb, z, 1, 1, 1, F.yaw + rng.range(-0.25, 0.25), [1, 1, 1]);
        else if (it.que === 'carrieles') this._i(k % 2 ? 'carriel' : 'sombrero', x, yb, z, 1.1, 1.1, 1.1, F.yaw + rng.range(-0.2, 0.2), [1, 1, 1]);
        else if (it.que === 'gorras') this._i('caja', x, yb, z, 0.3, 0.11, 0.2, F.yaw, rng.pick([[0.95, 0.55, 0.15], [0.95, 0.95, 0.95], [0.15, 0.15, 0.18]]));
        else
          for (let j = 0; j < rng.int(3, 6); j++) this._i('caja', x, yb + j * 0.05, z, 0.3, 0.045, 0.24, F.yaw, rng.pick(VIVOS));
      }
    }
    // Soportes (cuadros de madera a los lados).
    this._fbox(F, 0, 0.04, 0, F.D, y, y + h, { t: 'maderaOscura', col: [1, 1, 1] });
    this._fbox(F, F.W - 0.04, F.W, 0, F.D, y, y + h, { t: 'maderaOscura', col: [1, 1, 1] });
    // Los carrieles también colgados de puntillas en la pared (talabartería).
    if (it.que === 'carrieles') for (let u = 0.3; u < F.W - 0.2; u += 0.5) {
      const [x, z] = F.p(u, F.D - 0.06);
      this._i('carriel', x, y + 0.05, z, 1.15, 1.15, 1.15, F.yaw, [0.9, 0.85, 0.8]);
    }
    void r;
  }

  _espejo(it) {
    const F = marco({ x0: it.x - 0.02, x1: it.x + 0.02, z0: it.z0, z1: it.z1, dir: it.dir });
    const w = it.z1 - it.z0;
    const [ox, oz] = F.p(0, -0.012);
    this.comLuz.cara([ox, it.y, oz], [F.r[0] * w, 0, F.r[2] * w], [0, it.h, 0], F.n, 'espejo', [1.05, 1.07, 1.1]);
    // Marco de madera.
    this._fbox(F, -0.05, 0, -0.03, 0.02, it.y - 0.05, it.y + it.h + 0.05, { t: 'maderaOscura', col: [1, 1, 1] });
    this._fbox(F, w, w + 0.05, -0.03, 0.02, it.y - 0.05, it.y + it.h + 0.05, { t: 'maderaOscura', col: [1, 1, 1] });
    this._fbox(F, -0.05, w + 0.05, -0.03, 0.02, it.y + it.h, it.y + it.h + 0.05, { t: 'maderaOscura', col: [1, 1, 1] });
    this._fbox(F, -0.05, w + 0.05, -0.03, 0.02, it.y - 0.05, it.y, { t: 'maderaOscura', col: [1, 1, 1] });
  }

  _perchero(it) {
    const rng = this.rng;
    const alongZ = it.z1 - it.z0 > it.x1 - it.x0;
    const cx = (it.x0 + it.x1) / 2;
    const cz = (it.z0 + it.z1) / 2;
    const yr = it.y + it.h - 0.05;
    const com = this.com;
    const L = alongZ ? it.z1 - it.z0 : it.x1 - it.x0;
    // Tubo y soportes (a la pared o de pie con sus patas).
    const tx = it.pared ? (it.dir[0] > 0 ? it.x0 + 0.3 : it.x1 - 0.3) : cx;
    if (alongZ) {
      com.cyl(tx, yr, it.z0, 0.015, 0.015, 0.03, ACERO);
      const g = new THREE.CylinderGeometry(0.016, 0.016, L, 8);
      E4.set(Math.PI / 2, 0, 0);
      Q4.setFromEuler(E4);
      M4.compose(V4.set(tx, yr, cz), Q4, S4.set(1, 1, 1));
      com.geom(g, M4, ACERO);
      g.dispose();
      for (const z of [it.z0 + 0.05, it.z1 - 0.05]) {
        if (it.pared) com.caja(Math.min(tx, it.dir[0] > 0 ? it.x0 : it.x1), Math.max(tx, it.dir[0] > 0 ? it.x0 : it.x1), yr - 0.02, yr + 0.02, z - 0.015, z + 0.015, { col: ACERO });
        else {
          com.caja(tx - 0.015, tx + 0.015, it.y, yr, z - 0.015, z + 0.015, { col: ACERO });
          com.caja(tx - 0.3, tx + 0.3, it.y, it.y + 0.03, z - 0.02, z + 0.02, { col: ACERO });
        }
      }
    }
    // Prendas: una tras otra a lo largo del tubo (se ven de canto, como en un perchero de verdad).
    const telas = it.telas ?? ['camisa'];
    const paso = 0.075;
    for (let s = 0.08; s < L - 0.08; s += paso * rng.range(0.85, 1.3)) {
      const tela = rng.pick(telas);
      const z = it.z0 + s;
      const x = tx;
      const tipo = tela === 'ruana' ? 'ruana' : tela === 'poncho' ? 'poncho' : 'prenda';
      let c;
      if (tela === 'poncho') c = rng.chance(0.7) ? [1, 1, 1] : [1, 0.85, 0.85];
      else if (tela === 'ruana') c = rng.pick([[1, 1, 1], [0.8, 0.75, 0.7], [0.6, 0.62, 0.65], [0.95, 0.9, 0.8]]);
      else if (tela === 'camiseta') c = rng.pick(VIVOS);
      else if (tela === 'sudadera') c = rng.pick([[0.12, 0.12, 0.14], [0.45, 0.46, 0.48], [0.15, 0.2, 0.4]]);
      else if (tela === 'buso') c = rng.pick([[0.12, 0.12, 0.14], [0.45, 0.46, 0.48], [0.4, 0.45, 0.25], [0.75, 0.15, 0.15], [0.85, 0.65, 0.2]]);
      else c = rng.pick([[0.97, 0.97, 0.96], [0.75, 0.25, 0.2], [0.6, 0.75, 0.9], [0.95, 0.9, 0.75], [0.35, 0.45, 0.6]]);
      if (alongZ) this._i(tipo, x, yr + (tipo === 'prenda' ? 0.02 : 0.02), z, 1, rng.range(0.92, 1.08), 1, 0, c);
    }
  }

  _maniqui(it) {
    const { cx: x, cz: z, y } = it;
    const com = this.com;
    const piel = [0.88, 0.86, 0.82];
    const v = it.pinta ?? 'moda';
    const rng = this.rng;
    const camisa = v === 'paisa' ? [0.96, 0.96, 0.94] : v === 'cuero' ? [0.72, 0.28, 0.2] : v === 'deportes' ? rng.pick([[0.92, 0.78, 0.15], [0.85, 0.12, 0.12], [0.12, 0.45, 0.25]]) : rng.pick(VIVOS);
    const pantalon = v === 'paisa' || v === 'cuero' ? [0.72, 0.64, 0.48] : [0.32, 0.42, 0.62];
    com.cyl(x, y, z, 0.2, 0.22, 0.03, [0.2, 0.2, 0.22], 16);
    com.cyl(x, y + 0.03, z, 0.015, 0.015, 0.2, ACERO, 6);
    for (const s of [-1, 1]) com.cyl(x + s * 0.08, y + 0.22, z, 0.06, 0.055, 0.72, pantalon, 10);
    com.cyl(x, y + 0.94, z, 0.16, 0.15, 0.22, pantalon, 14);
    com.cyl(x, y + 1.1, z, 0.2, 0.15, 0.36, camisa, 14);
    com.sphere(x, y + 1.46, z, 0.2, camisa, 12);
    for (const s of [-1, 1]) com.cyl(x + s * 0.23, y + 1.0, z, 0.045, 0.055, 0.45, camisa, 8);
    com.cyl(x, y + 1.5, z, 0.045, 0.05, 0.1, piel, 8);
    com.sphere(x, y + 1.7, z, 0.105, piel, 12);
    if (v === 'paisa') {
      // Poncho al hombro y sombrero aguadeño (las mallas de la ropa).
      com.caja(x + 0.1, x + 0.2, y + 1.05, y + 1.62, z - 0.14, z + 0.14, { t: 'poncho', col: [1, 1, 1], skip: '' });
      const g = hatGeo(CABEZA, ROPA_BY_ID['sombrero-aguadeno']);
      M4.compose(V4.set(x, y + 1.7, z), Q4.identity(), S4.set(1.05, 1.05, 1.05));
      com.geom(g, M4, [0.95, 0.88, 0.62]);
      g.dispose();
      com.cyl(x, y + 1.751, z, 0.098, 0.098, 0.022, [0.08, 0.08, 0.08], 16, true);
    } else if (v === 'cuero') {
      com.caja(x - 0.3, x - 0.2, y + 0.82, y + 1.0, z - 0.08, z + 0.08, { t: 'cuero', col: [1, 1, 1] });
      com.caja(x - 0.21, x + 0.18, y + 1.0, y + 1.5, z + 0.155, z + 0.17, { col: [0.25, 0.15, 0.08] });
    } else if (v === 'deportes') {
      const g = capGeo(CABEZA, { ...ROPA_BY_ID['gorra-curva-azul'], color: 0x1b3d8f, color2: 0xffffff });
      M4.compose(V4.set(x, y + 1.66, z), Q4.identity(), S4.set(1.1, 1.1, 1.1));
      com.geom(g, M4, [0.15, 0.25, 0.6]);
      g.dispose();
    }
    void it;
  }

  _bascula(it) {
    const x = (it.x0 + it.x1) / 2;
    const z = (it.z0 + it.z1) / 2;
    const com = this.com;
    com.caja(x - 0.2, x + 0.2, it.y, it.y + 0.08, z - 0.18, z + 0.18, { col: [0.25, 0.25, 0.27] });
    com.caja(x - 0.04, x + 0.04, it.y + 0.08, it.y + 1.25, z - 0.14, z - 0.06, { col: [0.93, 0.93, 0.94] });
    com.caja(x - 0.14, x + 0.14, it.y + 1.25, it.y + 1.55, z - 0.16, z - 0.04, { col: [0.93, 0.93, 0.94] });
    com.cyl(x, it.y + 1.4, z - 0.035, 0.1, 0.1, 0.005, [0.95, 0.95, 0.85], 16);
  }

  _baldes(it) {
    const rng = this.rng;
    const w = it.x1 - it.x0;
    const piles = Math.max(1, Math.floor(w / 0.45));
    for (let p = 0; p < piles; p++) {
      const x = it.x0 + (p + 0.5) * (w / piles);
      const z = (it.z0 + it.z1) / 2;
      const c = rng.pick(VIVOS);
      const n = rng.int(3, it.n ?? 5);
      for (let k = 0; k < n; k++) this._i('balde', x, it.y + k * 0.07, z, 0.36, 0.28, 0.36, 0, c);
    }
  }

  _escobas(it) {
    const rng = this.rng;
    const x = (it.x0 + it.x1) / 2;
    const g = new THREE.CylinderGeometry(0.012, 0.012, 1.3, 6);
    const hd = new THREE.BoxGeometry(0.26, 0.09, 0.05);
    for (let k = 0; k < 4; k++) {
      const z = it.z0 + 0.1 + k * ((it.z1 - it.z0 - 0.2) / 3);
      const c = rng.pick(VIVOS);
      const tilt = rng.range(-0.12, 0.12);
      E4.set(tilt, 0, (x < 0 ? -1 : 1) * 0.12, 'XYZ');
      Q4.setFromEuler(E4);
      M4.compose(V4.set(x, it.y + 0.75, z), Q4, S4.set(1, 1, 1));
      this.com.geom(g, M4, c);
      M4.compose(V4.set(x, it.y + 0.06, z), Q4, S4.set(1, 1, 1));
      this.com.geom(hd, M4, k % 2 ? [0.2, 0.2, 0.22] : c.map((v) => v * 0.8));
    }
    g.dispose();
    hd.dispose();
  }

  _colgados(it) {
    const rng = makeRng(it.seed ?? 1);
    const { x, z, y } = it;
    const yb = y - 0.9;
    this.com.caja(x - 0.004, x + 0.004, yb + 0.2, y, z - 0.004, z + 0.004, { col: [0.75, 0.7, 0.6] });
    for (let k = 0; k < 3; k++) {
      const yy = yb + k * 0.24 - 0.1;
      const q = rng.next();
      if (q < 0.4) this._i('balde', x + rng.range(-0.05, 0.05), yy, z, 0.24, 0.2, 0.24, 0, rng.pick(VIVOS));
      else if (q < 0.7) this._i('lata', x, yy, z, 0.26, 0.05, 0.26, 0, [0.72, 0.74, 0.78]);
      else this._i('caja', x, yy, z, 0.18, 0.2, 0.06, rng.range(0, 3), rng.pick(VIVOS));
    }
  }

  _fotocopiadora(it) {
    const F = marco(it);
    this._fbox(F, 0, F.W, 0, F.D, it.y, it.y + it.h, { col: [0.82, 0.83, 0.85], frente: 'fotocopiadora' });
    this._fbox(F, 0.05, F.W - 0.05, 0.05, F.D - 0.05, it.y + it.h, it.y + it.h + 0.06, { col: [0.3, 0.32, 0.35] });
    this._fbox(F, F.W * 0.6, F.W - 0.05, -0.15, 0.02, it.y + it.h - 0.35, it.y + it.h - 0.32, { col: [0.9, 0.9, 0.92] });
  }

  _cruz(it) {
    const { x, z, y } = it;
    this.com.caja(x - 0.28, x + 0.28, y - 0.3, y + 0.3, z, z + 0.08, { col: [0.95, 0.95, 0.95] });
    this.comLuz.cara([x - 0.26, y - 0.28, z + 0.082], [0.52, 0, 0], [0, 0.56, 0], [0, 0, 1], 'cruz', [1.5, 1.6, 1.5]);
  }

  update() {}

  dispose() {
    this.group.removeFromParent();
    for (const g of this._own) g.dispose();
    this.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
    this._own.length = 0;
    // (Materiales, texturas y geometrías de las instancias son compartidos: quedan para el próximo local.)
  }
}

// ------------------------------------------------------------------ frentes
/**
 * Frentes de todos los comercios (siempre en escena): la cortina metálica
 * de cada uno (instanciada: sube de día y baja fuera de su horario) y el
 * cuarto que se ve por la vitrina mientras el interior no está armado (una
 * sola malla fusionada con el atlas de las vitrinas; queda detrás de los
 * muros del interior de verdad, que lo tapan cuando está armado).
 */
export class LocalFronts {
  constructor(locales) {
    this.list = locales;
    this.group = new THREE.Group();
    this.group.name = 'frentes-comercios';
    const M = materialesComercio();
    const room = new Malla(ATLAS);
    const mat = new THREE.Matrix4();
    for (const r of locales) {
      const a = new Malla(ATLAS);
      this._cuarto(r, a);
      mat.compose(V4.set(r.ox, 0, r.oz), Q4.setFromEuler(E4.set(0, r.rot, 0)), S4.set(1, 1, 1));
      appendT(room, a, mat);
    }
    if (room.count) {
      this.room = new THREE.Mesh(room.build(), M.vit);
      this.room.name = 'comercios-cuartos';
      this.room.matrixAutoUpdate = false;
      this.group.add(this.room);
    }
    const shG = new THREE.PlaneGeometry(1, 1);
    shG.translate(0, -0.5, 0);
    this.shutters = new THREE.InstancedMesh(shG, new THREE.MeshStandardMaterial({ map: cortinaTex(), color: 0xffffff, roughness: 0.55, metalness: 0.45, side: THREE.DoubleSide }), Math.max(1, locales.length));
    this.shutters.name = 'comercios-cortinas';
    this.shutters.matrixAutoUpdate = false;
    this.shutters.count = locales.length;
    for (let i = 0; i < locales.length; i++) {
      const c = METAL_COLORS[locales[i].cortina ?? 4] ?? METAL_COLORS[4];
      this.shutters.setColorAt(i, COL.setRGB(0.55 + c[0] * 0.5, 0.55 + c[1] * 0.5, 0.55 + c[2] * 0.5));
    }
    this.group.add(this.shutters);
    this.state = locales.map(() => ({ k: -1 }));
    for (let i = 0; i < locales.length; i++) this._place(i, 1);
  }

  /** Cuarto de lejos: fondo y costados pintados del tipo de local, piso y techo (un poco detrás de los muros de verdad). */
  _cuarto(r, a) {
    const kind = ATLAS[`back:${r.kind}`] ? r.kind : 'tienda';
    const x0 = -r.hu + 0.06;
    const x1 = r.hu - 0.06;
    const z0 = -r.D + 0.06;
    const z1 = -INTERIOR.MURO + 0.02;
    const y0 = r.y0 - 0.03;
    const H = r.H + 0.06;
    const k = [0.95, 0.95, 0.95];
    a.caraRep([x1, y0, z0], [x0 - x1, 0, 0], [0, H, 0], [0, 0, 1], `back:${kind}`, k, 5.9, 0, 99);
    a.caraRep([x0, y0, z0], [0, 0, z1 - z0], [0, H, 0], [1, 0, 0], `side:${kind}`, k, 3, 0, 99);
    a.caraRep([x1, y0, z1], [0, 0, z0 - z1], [0, H, 0], [-1, 0, 0], `side:${kind}`, k, 3, 0, 99);
    a.caraRep([x0, y0, z1], [x1 - x0, 0, 0], [0, 0, z0 - z1], [0, 1, 0], 'piso-rojo', k, 4, 4, 99);
    a.caraRep([x0, y0 + H, z0], [x1 - x0, 0, 0], [0, 0, z1 - z0], [0, -1, 0], 'techo', k, 4, 4, 99);
  }

  /** Cortina del local i (shutK 1 = abajo, 0 = arriba). */
  _place(i, shutK) {
    const r = this.list[i];
    const d = r.door;
    const base = MB.compose(V4.set(r.ox, 0, r.oz), Q4.setFromEuler(E4.set(0, r.rot, 0)), S4.set(1, 1, 1));
    const h = Math.max(0.3, d.h * shutK);
    const m = M4.compose(V4.set((d.x0 + d.x1) / 2, r.floorY + d.h, -0.06), Q4.identity(), S4.set(d.x1 - d.x0 + 0.04, h, 1)).premultiply(base);
    this.shutters.setMatrixAt(i, m);
    this.shutters.instanceMatrix.needsUpdate = true;
  }

  /** shut[i] = cortina abajo; anima hacia allá (dt en s). */
  update(dt, shut) {
    let moved = false;
    for (let i = 0; i < this.list.length; i++) {
      const s = this.state[i];
      const to = shut[i] ? 1 : 0;
      const k = s.k < 0 ? to : s.k + Math.sign(to - s.k) * Math.min(Math.abs(to - s.k), dt * 0.6);
      if (k !== s.k) {
        s.k = k;
        this._place(i, k);
        moved = true;
      }
    }
    if (moved) this.shutters.computeBoundingSphere();
  }

  /** ¿La cortina del local i está del todo abajo? */
  cerrada(i) {
    return this.state[i].k >= 0.999;
  }

  dispose() {
    this.group.removeFromParent();
    this.room?.geometry.dispose();
    this.shutters.dispose();
  }
}

/** Copia `src` en `dst` transformada por `m` (posiciones y normales). */
function appendT(dst, src, m) {
  const n3 = new THREE.Matrix3().getNormalMatrix(m);
  const k = dst.count;
  for (let v = 0; v < src.count; v++) {
    V4.set(src.p[v * 3], src.p[v * 3 + 1], src.p[v * 3 + 2]).applyMatrix4(m);
    dst.p.push(V4.x, V4.y, V4.z);
    S4.set(src.n[v * 3], src.n[v * 3 + 1], src.n[v * 3 + 2]).applyMatrix3(n3).normalize();
    dst.n.push(S4.x, S4.y, S4.z);
  }
  for (const u of src.u) dst.u.push(u);
  for (const c of src.c) dst.c.push(c);
  for (const i of src.i) dst.i.push(i + k);
}

// ------------------------------------------------------------------ calentamiento
/**
 * Muestras para el calentamiento de programas (render/warmupSamples.js): un
 * comercio de cada tema que haya (con sus instancias), armado de una. Las
 * suelta quien las pide con dispose().
 */
export function comercioWarmupSample(locales, temas = ['tienda', 'almacen']) {
  const out = [];
  for (const t of temas) {
    const r = locales.find((q) => q.tema === t);
    if (r) out.push(new LocalView(r).buildNow());
  }
  return out;
}
