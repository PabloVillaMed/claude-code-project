// Luminarias de calle típicas de Medellín (medidas en sim/alumbrado.js):
//  - barrio: poste de concreto gris (el del kit de los postes de redes, para
//    que combinen) con brazo metálico corto e inclinado y luminaria;
//  - avenida: poste metálico más alto, brazo largo y luminaria más grande;
//  - poste: solo el brazo con su luminaria, sujeto con una abrazadera al
//    poste de redes que ya existe (no se dibuja otro poste al lado).
// La carcasa es una caja que se adelgaza hacia la punta y el lente que
// alumbra va por DEBAJO (un tronco de pirámide bajito: se ve encendido
// también de lado). Pocos triángulos, todo en instancias (render/props.js):
// metal, concreto y lente son tres materiales compartidos por los tres tipos.
// El color de la luz va por instancia en el lente (ver tinteLente).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FONDO_LENTE, LUMINARIAS, geometriaLuminaria } from '../sim/alumbrado.js';

// ------------------------------------------------------------------ ajustables
/** Metal galvanizado del brazo, la carcasa y el poste de avenida. */
export const COLOR_METAL = 0x8c9399;
/** Concreto del poste de barrio cuando no está el modelo del kit. */
export const COLOR_CONCRETO = 0x9d9a93;
/** Radio (m) del tubo del brazo. */
export const RADIO_BRAZO = 0.035;
/** Alto (m) de la abrazadera que sujeta el brazo al poste. */
export const ALTO_ABRAZADERA = 0.16;
/** Poste de barrio: ensanche horizontal del poste del kit (mide 0,09 m de radio) para que se vea de concreto. */
export const ANCHO_POSTE_BARRIO = 1.35;
/** Poste de avenida: radio (m) abajo y arriba. */
export const RADIO_POSTE_AVENIDA = [0.13, 0.07];
/** Color del lente encendido (se multiplica por el brillo de la noche): sodio ámbar y LED blanco neutro. */
export const LENTE_SODIO = new THREE.Color(1.0, 0.6, 0.28);
export const LENTE_LED = new THREE.Color(0.9, 0.95, 1.0);

// ------------------------------------------------------------------ materiales
const METAL = new THREE.MeshStandardMaterial({ color: COLOR_METAL, roughness: 0.45, metalness: 0.55 });
METAL.name = 'luminaria-metal';
const CONCRETO = new THREE.MeshStandardMaterial({ color: COLOR_CONCRETO, roughness: 0.9 });
CONCRETO.name = 'poste-concreto';
// Emisivo blanco: el tinte (sodio o LED) y el apagado van por instancia (props.js apagable).
const LENTE = new THREE.MeshStandardMaterial({ color: 0xe9e7df, roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 0 });
LENTE.name = 'luminaria-lente';
LENTE.userData.luz = true;
export const MATERIAL_LENTE = LENTE;

/** Color por instancia del lente: 0,5 + 0,5·tinte (el shader apagable lo vuelve 2c − 1 = tinte; la mitad = apagado). */
export function tinteLente(led, out = new THREE.Color()) {
  const t = led ? LENTE_LED : LENTE_SODIO;
  return out.setRGB(0.5 + 0.5 * t.r, 0.5 + 0.5 * t.g, 0.5 + 0.5 * t.b);
}

// ------------------------------------------------------------------ piezas
const _up = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** Tubo de (u0, y0) a (u1, y1) en el espacio de la luminaria (u hacia −Z). */
function tubo(u0, y0, u1, y1, r0, r1 = r0, lados = 6) {
  const len = Math.hypot(u1 - u0, y1 - y0);
  const g = new THREE.CylinderGeometry(r1, r0, len, lados, 1, true);
  _d.set(0, y1 - y0, -(u1 - u0)).normalize();
  g.applyQuaternion(_q.setFromUnitVectors(_up, _d));
  g.translate(0, (y0 + y1) / 2, -(u0 + u1) / 2);
  return g;
}

/** Carcasa: caja que se adelgaza hacia la punta, siguiendo el brazo. */
function carcasa(L, G) {
  const g = new THREE.BoxGeometry(L.ancho, L.grueso, L.largo, 1, 1, 1);
  g.translate(0, 0, -L.largo / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getZ(i) > -L.largo / 2) continue;
    // Punta: más angosta y más baja por arriba (el perfil de las luminarias LED).
    p.setX(i, p.getX(i) * 0.8);
    if (p.getY(i) > 0) p.setY(i, p.getY(i) * 0.35);
  }
  g.computeVertexNormals();
  g.rotateX(L.inclinacion);
  g.translate(0, G.cy, -G.cu);
  return g;
}

/** Lente: tronco de pirámide bajito colgado de la carcasa, con la cara grande mirando abajo. */
function lente(L, G) {
  const m = L.largo * 0.55;
  const y0 = -L.grueso / 2;
  const y1 = y0 - FONDO_LENTE;
  const a0 = (L.ancho * 0.86) / 2;
  const l0 = (L.largo * 0.72) / 2;
  const a1 = (L.ancho * 0.72) / 2;
  const l1 = (L.largo * 0.6) / 2;
  const T = [
    [-a0, y0, -m - l0], [a0, y0, -m - l0], [a0, y0, -m + l0], [-a0, y0, -m + l0],
    [-a1, y1, -m - l1], [a1, y1, -m - l1], [a1, y1, -m + l1], [-a1, y1, -m + l1],
  ];
  // Fondo (mirando abajo) y los cuatro costados (hacia afuera).
  const caras = [[4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
  const pos = [];
  for (const c of caras) for (const k of c) pos.push(...T[k]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // (Las caras se arman con el orden de los vértices; si quedaran al revés, se voltean.)
  const n = g.attributes.normal;
  if (n.getY(0) > 0) {
    for (let i = 0; i < pos.length; i += 9) for (let k = 0; k < 3; k++) [pos[i + 3 + k], pos[i + 6 + k]] = [pos[i + 6 + k], pos[i + 3 + k]];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
  }
  g.rotateX(L.inclinacion);
  g.translate(0, G.cy, -G.cu);
  return g;
}

/** Brazo, abrazadera y carcasa (metal) + lente de una luminaria. */
function brazoYLuminaria(L, abrazadera = true) {
  const G = geometriaLuminaria(L);
  const metal = [tubo(G.u0 - 0.02, G.y0, G.u1, G.y1, RADIO_BRAZO), carcasa(L, G)];
  if (abrazadera) {
    const a = new THREE.CylinderGeometry(L.arranque + 0.01, L.arranque + 0.01, ALTO_ABRAZADERA, 8, 1, true);
    a.translate(0, G.y0, 0);
    metal.push(a);
  }
  return { metal, lente: lente(L, G) };
}

/** Une geometrías indexadas del mismo material (solo posición, normal y uv). */
function unir(geos) {
  for (const g of geos) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  const m = mergeGeometries(geos, false);
  m.computeBoundingBox();
  m.computeBoundingSphere();
  return m;
}

function plantilla(key, cerca, lejos) {
  const box = new THREE.Box3();
  for (const p of cerca) {
    if (!p.geometry.boundingBox) p.geometry.computeBoundingBox();
    if (!p.geometry.boundingSphere) p.geometry.computeBoundingSphere();
    box.union(p.geometry.boundingBox);
  }
  for (const p of lejos) {
    if (!p.geometry.boundingBox) p.geometry.computeBoundingBox();
    if (!p.geometry.boundingSphere) p.geometry.computeBoundingSphere();
  }
  return { key, cerca, lejos, extras: {}, box, height: box.max.y - box.min.y };
}

// ------------------------------------------------------------------ plantillas
const _cache = new Map();

/**
 * Plantillas {barrio, avenida, poste} con niveles 'cerca' y 'lejos' (como
 * las de props.js propTemplate). `kit`: la plantilla del modelo farol_calle
 * (de él solo se usa el poste de concreto del kit de postes de redes; su
 * farol de hierro forjado era europeo y estaba montado al revés) o null:
 * entonces el poste de barrio es un cono de concreto procedural.
 */
export function plantillasAlumbrado(kit) {
  if (_cache.has(kit)) return _cache.get(kit);
  const B = LUMINARIAS.barrio;
  const A = LUMINARIAS.avenida;
  const P = LUMINARIAS.poste;
  // Poste de barrio: el del kit, estirado al alto y un poco más grueso.
  const esPoste = (p) => /^modular_electricity_poles/.test(p.material.name ?? '');
  const posteKit = (nivel) => {
    const partes = (nivel ?? []).filter(esPoste);
    if (!partes.length) return null;
    const box = new THREE.Box3();
    for (const p of partes) {
      if (!p.geometry.boundingBox) p.geometry.computeBoundingBox();
      box.union(p.geometry.boundingBox);
    }
    const k = B.alto / Math.max(0.1, box.max.y - box.min.y);
    return partes.map((p) => ({ geometry: p.geometry.clone().translate(0, -box.min.y, 0).scale(ANCHO_POSTE_BARRIO, k, ANCHO_POSTE_BARRIO), material: p.material }));
  };
  const conoConcreto = (lados) => {
    const g = new THREE.CylinderGeometry(0.085, 0.13, B.alto, lados, 1, false);
    g.translate(0, B.alto / 2, 0);
    return [{ geometry: g, material: CONCRETO }];
  };
  const posteCerca = posteKit(kit?.cerca) ?? conoConcreto(8);
  const posteLejos = posteKit(kit?.lejos) ?? conoConcreto(5);

  const b = brazoYLuminaria(B);
  const bl = brazoYLuminaria(B, false);
  const barrio = plantilla(
    'farol-barrio',
    [...posteCerca, { geometry: unir(b.metal), material: METAL }, { geometry: b.lente, material: LENTE }],
    [...posteLejos, { geometry: unir(bl.metal), material: METAL }, { geometry: bl.lente, material: LENTE }],
  );

  // Avenida: poste metálico cónico con su platina, del mismo metal del brazo.
  const posteAv = (lados) => {
    const g = new THREE.CylinderGeometry(RADIO_POSTE_AVENIDA[1], RADIO_POSTE_AVENIDA[0], A.alto, lados, 1, false);
    g.translate(0, A.alto / 2, 0);
    return g;
  };
  const platina = new THREE.BoxGeometry(0.4, 0.05, 0.4).translate(0, 0.025, 0);
  const a = brazoYLuminaria(A);
  const al = brazoYLuminaria(A, false);
  const avenida = plantilla(
    'farol-avenida',
    [{ geometry: unir([posteAv(8), platina, ...a.metal]), material: METAL }, { geometry: a.lente, material: LENTE }],
    [{ geometry: unir([posteAv(5), ...al.metal]), material: METAL }, { geometry: al.lente, material: LENTE }],
  );

  // En el poste de redes: brazo con abrazadera y luminaria, sin poste.
  const p = brazoYLuminaria(P);
  const pl = brazoYLuminaria(P, false);
  const poste = plantilla(
    'luminaria-poste',
    [{ geometry: unir(p.metal), material: METAL }, { geometry: p.lente, material: LENTE }],
    [{ geometry: unir(pl.metal), material: METAL }, { geometry: pl.lente, material: LENTE }],
  );
  const out = { barrio, avenida, poste };
  _cache.set(kit, out);
  return out;
}
