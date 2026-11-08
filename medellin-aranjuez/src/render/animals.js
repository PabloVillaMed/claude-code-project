// Animales: una malla instanciada por especie (perro, gato, rata) hecha de
// formas suaves (elipsoides para el cuerpo, la cabeza y el hocico, patas
// cónicas, cola curva que se afina, ojos y nariz). Todo lo que se mueve va en
// el sombreador de vértices con atributos por instancia: aAnim (fase del paso,
// amplitud, meneo de la cola, postura 0 de pie, 1 sentado, 2 echado), aLook
// (giro y cabeceo de la cabeza, andar 0 paso, 1 trote, 2 carrera o saltos, y
// agazapado) y aState (muerto: 0 vivo a ±1 echado de lado, el signo dice sobre
// qué lado; y cojera 0 a 1, la pata trasera izquierda casi no apoya). Cada andar mueve las patas a su manera: al paso de a una
// (cuatro tiempos), al trote las diagonales juntas y a la carrera las de
// adelante y las de atrás casi juntas; la pata que avanza se recoge.
// El pelaje no usa texturas: el sombreador de fragmentos lo calcula con ruido
// en coordenadas del modelo en reposo (así el patrón no "nada" al moverse):
// grano de pelo sutil, barriga más clara y un patrón por instancia (aCoatA:
// color y patrón; aCoatB: segundo color y semilla): liso, manchas, pecho y
// patas blancas, lomo oscuro, manchas con patas blancas, atigrado. La marca de
// cada pieza (ojo, nariz, piel) pinta orejas, cola, patas y nariz rosadas de la
// rata. La sombra usa el mismo sombreador de vértices. En total: tres llamadas
// de dibujo y ~1500 triángulos por animal.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ------------------------------------------------------------------ ajustes
/** Cuánto se nota el grano del pelo (0 nada; se apaga solo de lejos para que no titile). */
export const FUR_GRAIN = 0.5;
/** Cuánto más clara es la barriga (0 igual al lomo, 1 del todo del color de barriga). */
export const BELLY_LIGHT = 0.55;
/** Las ratas se dibujan solo hasta esta fracción de la distancia de dibujo de los peatones. */
export const RAT_DRAW_FRACTION = 0.45;
/** Muerto: cuánto se voltea de lado (rad; 1,57 sería del todo de lado, con las patas paralelas al piso). */
export const DEAD_ROLL = 1.5;
/** Muerto: cuánto bajan las patas hacia el piso después de voltearse (rad; para que no queden flotando). */
export const DEAD_LEG_DROOP = 0.14;
/** Muerto: patas tiesas, las delanteras hacia adelante y las traseras hacia atrás (rad). */
export const DEAD_LEG_SPREAD = [0.35, 0.4];
/** Cojera: cuánto menos se mueve la pata mala (0 igual, 1 nada) y cuánto se recoge (fracción del largo). */
export const LIMP_SWING = 0.7;
export const LIMP_LIFT = 0.22;

// Partes (atributo `part`): 0 cuerpo, 1 cabeza, 2 cola, 3 pata delantera, 4 pata trasera.
const BODY = 0;
const HEAD = 1;
const TAIL = 2;
const FRONT = 3;
const BACK = 4;
// Marcas (atributo `skin`.y): 0 pelo (con patrón), 1 piel (rosada), 2 ojo, 3 nariz.
const FUR = 0;
const SKIN = 1;
const EYE = 2;
const NOSE = 3;
// Patrones del pelaje.
export const COAT = { liso: 0, manchas: 1, blancas: 2, silla: 3, manchasBlancas: 4, atigrado: 5 };

/**
 * Medidas (m, mirando hacia +Z, patas en y = 0). `leg`: alto de la
 * articulación (hombro y cadera); `y`: centro del lomo; `len`: largo del
 * tronco; `tail`: puntos de la curva de la cola desde la base. `coats`:
 * pelajes de la calle en Medellín (color, segundo color y patrón; en el liso
 * el segundo color es el de la barriga). `skin`, `nose`, `eye`, `belly`:
 * colores de la piel, la nariz, los ojos y la barriga; `grain`: frecuencia
 * del grano del pelo (1/m: a lo ancho, a lo ancho, a lo largo del pelo).
 */
export const ANIMAL_SHAPES = {
  perro: {
    leg: 0.44, y: 0.47, len: 0.62, r: [0.115, 0.13], head: [0.085, 0.085, 0.1], snout: [0.045, 0.043, 0.075], ear: { size: 0.06, up: false },
    legR: [0.034, 0.024], tailR: 0.022, tail: [[0, 0.5, -0.31], [0, 0.6, -0.42], [0, 0.72, -0.44], [0, 0.78, -0.37]],
    // Criollos: caramelo, canela, negro con pecho blanco, negro y fuego, blanco con manchas, café, crema, atigrado.
    coats: [
      [0xb5793f, 0xdcc29a, COAT.liso],
      [0xa86a33, 0xece3d2, COAT.blancas],
      [0x1e1b19, 0xe8e0d0, COAT.blancas],
      [0xa0642e, 0x1c1917, COAT.silla],
      [0xe6ddcc, 0x6b4528, COAT.manchas],
      [0xe9e2d6, 0x24201d, COAT.manchas],
      [0x5e3f26, 0xe3d9c6, COAT.manchasBlancas],
      [0xcdb38a, 0xe8dcc4, COAT.liso],
      [0x6e5236, 0x2a211b, COAT.atigrado],
      [0xc08a4f, 0x4a3322, COAT.silla],
      [0x2a2522, 0x55463a, COAT.liso],
    ],
    skin: 0x6e5048, nose: 0x161312, eye: 0x120d0a, belly: 0xe6d8bf, grain: [120, 120, 38],
  },
  gato: {
    leg: 0.23, y: 0.25, len: 0.36, r: [0.066, 0.075], head: [0.056, 0.052, 0.054], snout: [0.026, 0.02, 0.022], ear: { size: 0.034, up: true },
    legR: [0.018, 0.013], tailR: 0.014, tail: [[0, 0.27, -0.17], [0, 0.34, -0.27], [0, 0.46, -0.31], [0, 0.53, -0.26]],
    // Atigrado gris y naranja, negro, blanco y negro, blanco con manchas, gris.
    coats: [
      [0x8c857b, 0x35302b, COAT.atigrado],
      [0xd28a45, 0x8e4e1f, COAT.atigrado],
      [0x1b1a1c, 0x2c2a2e, COAT.liso],
      [0x1b1a1c, 0xefebe3, COAT.blancas],
      [0xeeeae2, 0x26242a, COAT.manchas],
      [0x77757a, 0xa9a6a6, COAT.liso],
      [0x8a6a4c, 0x3a2b1f, COAT.atigrado],
      [0xefe9df, 0xc77a38, COAT.manchas],
    ],
    skin: 0xd99a94, nose: 0xc98580, eye: 0x2a2a12, belly: 0xece4d6, grain: [180, 180, 60],
  },
  rata: {
    leg: 0.045, y: 0.048, len: 0.16, r: [0.036, 0.034], head: [0.024, 0.022, 0.038], snout: [0.013, 0.012, 0.02], ear: { size: 0.013, up: true, round: true },
    legR: [0.008, 0.006], tailR: 0.0055, tail: [[0, 0.04, -0.07], [0.02, 0.025, -0.15], [-0.01, 0.012, -0.22], [0.01, 0.006, -0.28]],
    // Rata de alcantarilla: gris pardo, barriga gris clara.
    coats: [
      [0x5c5046, 0x9c9284, COAT.liso],
      [0x4b433b, 0x8f877b, COAT.liso],
      [0x645849, 0xa39886, COAT.liso],
      [0x3f3934, 0x837b70, COAT.liso],
    ],
    skin: 0xd9a19a, nose: 0xe0a4a0, eye: 0x050404, belly: 0xa89e90, grain: [320, 320, 110],
  },
};

/** Dónde queda la cabeza (y del centro, z del centro, radios) en el modelo. */
function headFrame(s) {
  const [, rh] = s.r;
  const [hx, hy, hz] = s.head;
  return { neck: [0, s.y + rh * 0.4, s.len / 2 - s.r[0] * 0.2], y: s.y + rh * 0.9 + hy * 0.6, z: s.len / 2 + hz * 0.35, hx, hy, hz };
}

/** Prepara una pieza: atributos de parte, articulación, sombra y marca (`skin`), sin uv. */
function piece(g, part, pivot, shade = 1, mark = FUR) {
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const parts = new Float32Array(n).fill(part);
  const piv = new Float32Array(n * 3);
  const skin = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    piv.set(pivot, i * 3);
    skin[i * 2] = shade;
    skin[i * 2 + 1] = mark;
  }
  g.setAttribute('part', new THREE.BufferAttribute(parts, 1));
  g.setAttribute('pivot', new THREE.BufferAttribute(piv, 3));
  g.setAttribute('skin', new THREE.BufferAttribute(skin, 2));
  return g;
}

/** Elipsoide de radios (rx, ry, rz) en (x, y, z). */
function blob(x, y, z, rx, ry, rz, seg = 12, rings = 8) {
  const g = new THREE.SphereGeometry(1, seg, rings);
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  return g;
}

/** Tubo que sigue `pts` y se afina hacia la punta (cola). */
function tail(pts, r) {
  const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q)));
  const T = 10;
  const R = 6;
  const g = new THREE.TubeGeometry(curve, T, r, R, false);
  const p = g.attributes.position;
  const c = new THREE.Vector3();
  for (let i = 0; i <= T; i++) {
    curve.getPointAt(i / T, c);
    const k = 1 - 0.65 * (i / T);
    for (let j = 0; j <= R; j++) {
      const idx = i * (R + 1) + j;
      p.setXYZ(idx, c.x + (p.getX(idx) - c.x) * k, c.y + (p.getY(idx) - c.y) * k, c.z + (p.getZ(idx) - c.z) * k);
    }
  }
  // Punta cerrada con una bolita.
  const end = curve.getPointAt(1);
  const tip = new THREE.SphereGeometry(r * 0.35, 6, 4);
  tip.translate(end.x, end.y, end.z);
  return [g, tip];
}

/** Geometría de un animal de la especie `kind`. */
export function animalGeometry(kind) {
  const s = ANIMAL_SHAPES[kind];
  const rat = kind === 'rata';
  const pieces = [];
  const zF = s.len * 0.33; // hombros
  const zB = -s.len * 0.33; // caderas
  const [rw, rh] = s.r;
  // Tronco: pecho, lomo y cadera (el del medio manda; pecho y cadera apenas asoman, así no se ven "pedazos").
  pieces.push(piece(blob(0, s.y + rh * 0.04, zF * 0.6, rw * 1.03, rh * 1.04, s.len * 0.28, 14, 10), BODY, [0, 0, 0]));
  pieces.push(piece(blob(0, s.y, 0, rw, rh, s.len * 0.54, 16, 10), BODY, [0, 0, 0]));
  pieces.push(piece(blob(0, s.y + rh * 0.02, zB * 0.8, rw * 0.97, rh * 0.98, s.len * 0.24, 12, 8), BODY, [0, 0, 0]));
  // Cuello y cabeza (articulados en el cuello; el cuello también une la cabeza de la rata al cuerpo).
  const h = headFrame(s);
  const { neck, hx, hy, hz } = h;
  const head = [0, h.y, h.z];
  pieces.push(piece(blob(0, (neck[1] + head[1]) / 2, (neck[2] + head[2]) / 2 - hz * 0.2, hx * 0.66, hy * 0.95, hz * 0.9, 10, 6), HEAD, neck, 0.97));
  pieces.push(piece(blob(head[0], head[1], head[2], hx, hy, hz), HEAD, neck));
  const [sx, sy, sz] = s.snout;
  const snoutZ = head[2] + hz * 0.75 + sz * 0.45;
  pieces.push(piece(blob(0, head[1] - hy * 0.3, snoutZ, sx, sy, sz, 10, 6), HEAD, neck, 0.96));
  pieces.push(piece(blob(0, head[1] - hy * 0.2, snoutZ + sz * 0.9, sx * 0.45, sx * 0.35, sx * 0.3, 8, 5), HEAD, neck, 1, NOSE));
  // Ojos.
  for (const k of [-1, 1]) pieces.push(piece(blob(k * hx * 0.55, head[1] + hy * 0.18, head[2] + hz * 0.72, hx * 0.14, hx * 0.14, hx * 0.1, 8, 5), HEAD, neck, 1, EYE));
  // Orejas: conos parados (gato), redondas y rosadas (rata) o caídas a los lados (perro).
  for (const k of [-1, 1]) {
    const e = s.ear;
    let g;
    if (e.round) g = blob(k * hx * 0.6, head[1] + hy * 0.7, head[2] - hz * 0.2, e.size, e.size, e.size * 0.35, 8, 5);
    else {
      g = new THREE.ConeGeometry(e.size * 0.55, e.size * 1.4, 6);
      g.scale(1, 1, 0.45);
      if (e.up) {
        g.rotateZ(-k * 0.22);
        g.translate(k * hx * 0.55, head[1] + hy * 0.75 + e.size * 0.5, head[2] - hz * 0.15);
      } else {
        g.rotateZ(Math.PI - k * 0.5);
        g.translate(k * hx * 0.95, head[1] + hy * 0.15, head[2] - hz * 0.25);
      }
    }
    pieces.push(piece(g, HEAD, neck, e.up ? 0.9 : 0.8, rat ? SKIN : FUR));
  }
  // Cola (articulada en su base): pelada y rosada en la rata.
  for (const g of tail(s.tail, s.tailR)) pieces.push(piece(g, TAIL, s.tail[0], 0.95, rat ? SKIN : FUR));
  // Patas: cono de la articulación al piso, muslo (más grueso atrás) y pie.
  const [ra, rb] = s.legR;
  for (const [z, part] of [[zF, FRONT], [zB, BACK]]) {
    for (const k of [-1, 1]) {
      const x = k * rw * 0.55;
      const pivot = [x, s.leg, z];
      const leg = new THREE.CylinderGeometry(ra, rb, s.leg, 8, 1);
      leg.translate(x, s.leg / 2, z);
      pieces.push(piece(leg, part, pivot, 0.94));
      if (part === BACK) pieces.push(piece(blob(x, s.leg * 0.86, z - ra * 0.3, ra * 1.9, s.leg * 0.32, ra * 2.6, 10, 6), part, pivot));
      else pieces.push(piece(blob(x, s.leg * 0.88, z, ra * 1.5, s.leg * 0.24, ra * 1.9, 8, 6), part, pivot, 0.97));
      pieces.push(piece(blob(x, rb * 0.8, z + rb * 0.7, rb * 1.3, rb * 0.8, rb * 1.9, 8, 5), part, pivot, 0.88, rat ? SKIN : FUR));
    }
  }
  // Cada pieza conserva sus normales suaves (recalcularlas aquí las volvería facetadas).
  const g = mergeGeometries(pieces);
  g.computeBoundingSphere();
  return g;
}

const VERT_HEAD = `#include <common>
attribute float part;
attribute vec3 pivot;
attribute vec2 skin;
attribute vec4 aAnim;
attribute vec4 aLook;
attribute vec4 aCoatA;
attribute vec4 aCoatB;
attribute vec2 aState;
uniform float uAnimalTime;
uniform vec2 uDead;
uniform vec4 uDeadLegs;
uniform vec2 uLimp;
uniform vec3 uShoulder;
uniform float uLeg;
varying vec3 vLocal;
varying vec2 vSkin;
varying float vPart;
varying vec4 vCoatA;
varying vec4 vCoatB;
vec3 rotX( vec3 v, float a ) { float c = cos( a ), s = sin( a ); return vec3( v.x, v.y * c - v.z * s, v.y * s + v.z * c ); }
vec3 rotY( vec3 v, float a ) { float c = cos( a ), s = sin( a ); return vec3( v.x * c + v.z * s, v.y, -v.x * s + v.z * c ); }
vec3 rotZ( vec3 v, float a ) { float c = cos( a ), s = sin( a ); return vec3( v.x * c - v.y * s, v.x * s + v.y * c, v.z ); }
// Muerto: lo que va de la caída (acelera, como al caerse) y para qué lado (+1 sobre su derecha).
float deadFall() { float d = abs( aState.x ); return d * d; }
float deadSide() { return aState.x < 0.0 ? -1.0 : 1.0; }`;

const VERT_BODY = `vec3 transformed = vec3( position );
vLocal = position;
vSkin = skin;
vPart = part;
vCoatA = aCoatA;
vCoatB = aCoatB;
{
  float ph = aAnim.x;
  float wag = aAnim.z;
  float deadW = abs( aState.x );
  float fall = deadFall();
  float side = deadSide();
  float limp = aState.y;
  float lie0 = clamp( aAnim.w - 1.0, 0.0, 1.0 );
  float lieW = lie0 * ( 1.0 - deadW );
  float sitW = clamp( aAnim.w, 0.0, 1.0 ) * ( 1.0 - lie0 ) * ( 1.0 - deadW );
  float still = clamp( aAnim.w, 0.0, 1.0 );
  float k = aAnim.y * ( 1.0 - still );
  float trotW = clamp( aLook.z, 0.0, 1.0 );
  float runW = clamp( aLook.z - 1.0, 0.0, 1.0 );
  float crouch = aLook.w;
  vec3 v = transformed - pivot;
  if ( part > 2.5 ) {
    // Desfase de cada pata: al paso de a una (trasera, delantera del mismo lado, ...),
    // al trote las diagonales juntas y a la carrera (o a saltos) las de adelante y las de atrás.
    bool left = position.x > 0.0;
    bool front = part < 3.5;
    float offW = front ? ( left ? 1.5708 : 4.7124 ) : ( left ? 0.0 : 3.1416 );
    float offT = front ? ( left ? 0.0 : 3.1416 ) : ( left ? 3.1416 : 0.0 );
    float offG = front ? ( left ? 0.0 : 0.35 ) : ( left ? 3.1416 : 3.49 );
    float a = ph + mix( mix( offW, offT, trotW ), offG, runW );
    // Cojeando, la trasera izquierda casi no se mueve y va recogida (no apoya).
    float bad = ( !front && left ) ? limp : 0.0;
    float kl = k * ( 1.0 - uLimp.x * bad );
    // La pata que va hacia adelante se recoge (levanta el pie); la de apoyo va estirada. Agazapado, todas se doblan.
    float lift = max( 0.0, -cos( a ) ) * min( 1.0, kl * 3.0 );
    v.y *= ( 1.0 - crouch ) * ( 1.0 - 0.3 * lift ) * ( 1.0 - uLimp.y * bad );
    v = rotX( v, sin( a ) * kl );
    // Sentado: las traseras se recogen; echado: todas estiradas (adelante y atrás).
    if ( part > 3.5 ) v.y *= mix( 1.0, 0.42, sitW );
    v = rotX( v, lieW * ( part > 3.5 ? 1.3 : -1.3 ) );
    // Muerto: tiesas (delanteras adelante, traseras atrás) y, ya volteado, caídas hacia el piso.
    v = rotX( v, fall * ( part > 3.5 ? uDeadLegs.y : -uDeadLegs.x ) );
    v = rotZ( v, side * uDeadLegs.z * fall );
    transformed = pivot + v;
  } else if ( part > 1.5 ) {
    // Cola: de lado a lado (rápido si está contento, despacio si no).
    transformed = pivot + rotY( v, sin( uAnimalTime * ( 3.0 + wag * 8.0 ) + ph ) * ( 0.15 + wag * 0.45 ) * ( 1.0 - deadW ) );
  } else if ( part > 0.5 ) {
    // Cabeza: cabecea con el paso (más al paso que al trote), baja la nariz (olfatear) y mira a los lados.
    float bob = sin( ph * 2.0 ) * k * mix( 0.22, 0.07, trotW );
    v = rotX( v, bob + sitW * 0.42 + aLook.y );
    transformed = pivot + rotY( v, aLook.x );
  }
  // Sentado: el tronco (y lo que cuelga de él) gira hacia atrás sobre los hombros.
  if ( part < 2.5 || part > 3.5 ) transformed = uShoulder + rotX( transformed - uShoulder, -0.62 * sitW );
  // Echado: todo baja hasta el piso; agazapado, lo que se doblan las patas.
  transformed.y -= lieW * uLeg * 0.8 + crouch * uLeg;
  // El cuerpo sube y baja: dos veces por zancada al paso y al trote, una (y más) a saltos.
  transformed.y += mix( abs( sin( ph ) ) * 0.06, ( 0.5 + 0.5 * sin( ph + 1.2 ) ) * 0.12, runW ) * k * uLeg;
  // Cojeando: el cuerpo se hunde un poco cada vez que le tocaría apoyar la pata mala.
  transformed.y -= limp * max( 0.0, sin( ph ) ) * k * uLeg * 0.08;
  // Muerto: se voltea de lado sobre el lomo y baja hasta quedar apoyado en el costado.
  if ( fall > 0.0 ) {
    transformed = rotZ( transformed - vec3( 0.0, uDead.x, 0.0 ), -side * uDeadLegs.w * fall );
    transformed.y += mix( uDead.x, uDead.y, fall );
  }
}`;

// Las normales giran con el cuerpo al quedar de lado (si no, la luz le pega como si estuviera de pie).
const NORMAL_BODY = `#include <beginnormal_vertex>
if ( aState.x != 0.0 ) objectNormal = rotZ( objectNormal, -deadSide() * uDeadLegs.w * deadFall() );`;

const FRAG_HEAD = `#include <common>
uniform float uLeg;
uniform vec4 uCoatShape;
uniform vec4 uCoatHead;
uniform vec3 uGrain;
uniform vec2 uFur;
uniform vec3 uSkinCol;
uniform vec3 uNoseCol;
uniform vec3 uEyeCol;
uniform vec3 uBellyCol;
varying vec3 vLocal;
varying vec2 vSkin;
varying float vPart;
varying vec4 vCoatA;
varying vec4 vCoatB;
float aHash( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.x + p.y ) * p.z );
}
float aNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( aHash( i ), aHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( aHash( i + vec3( 0, 1, 0 ) ), aHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( aHash( i + vec3( 0, 0, 1 ) ), aHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( aHash( i + vec3( 0, 1, 1 ) ), aHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
// Pelaje en coordenadas del modelo en reposo: regiones (barriga, lomo, pecho, medias, hocico), patrón y grano.
vec3 animalCoat() {
  vec3 P = vLocal;
  float L = uCoatShape.z;
  float isLeg = step( 2.5, vPart );
  float isTail = step( 1.5, vPart ) * ( 1.0 - isLeg );
  float isHead = step( 0.5, vPart ) * ( 1.0 - step( 1.5, vPart ) );
  float isBody = 1.0 - step( 0.5, vPart );
  vec3 q = P / L;
  float seed = vCoatB.w;
  float n1 = aNoise( q * 3.0 + seed );
  float n2 = aNoise( q * 7.0 + seed * 1.7 + 11.0 );
  // La cabeza tiene su propia barriga (la quijada); el cuello, la del cuerpo (si no, parece un collar).
  float headW = isHead * smoothstep( uCoatHead.y - uCoatHead.z * 0.3, uCoatHead.y + uCoatHead.z * 0.2, P.z );
  float yc = mix( uCoatShape.x, uCoatHead.x, headW );
  float yr = mix( uCoatShape.y, uCoatHead.w, headW );
  float soft = 1.0 - isLeg - isTail;
  float under = ( 1.0 - smoothstep( yc - yr * 0.8, yc + yr * 0.05, P.y + ( n2 - 0.5 ) * yr * 0.5 ) ) * soft;
  float back = smoothstep( yc + yr * 0.1, yc + yr * 0.8, P.y + ( n2 - 0.5 ) * yr * 0.5 ) * soft;
  float sock = isLeg * ( 1.0 - smoothstep( uLeg * 0.18, uLeg * 0.36, P.y + ( n2 - 0.5 ) * uLeg * 0.14 ) );
  float chest = isBody * smoothstep( L * 0.1, L * 0.34, P.z ) * ( 1.0 - smoothstep( yc - yr * 0.35, yc + yr * 0.45, P.y + ( n1 - 0.5 ) * yr * 0.6 ) );
  float muzzle = isHead * smoothstep( uCoatHead.y + uCoatHead.z * 0.3, uCoatHead.y + uCoatHead.z * 0.85, P.z );
  float blot = smoothstep( 0.54, 0.6, n1 * 0.72 + n2 * 0.28 );
  float dog = 1.0 - step( 0.5, uCoatShape.w );
  float pat = vCoatA.w;
  float m = 0.0;
  if ( pat > 4.5 ) {
    // Atigrado: rayas torcidas que dan la vuelta al cuerpo, anillos en patas y cola y la raya del lomo
    // (en el perro, rayitas finas y suaves: atigrado criollo).
    float fq = mix( 9.0, 15.0, dog );
    float st = isLeg * P.y / uLeg * 4.0 + isTail * ( P.y - P.z ) / L * 7.0 + ( isBody + isHead ) * ( P.z / L * fq + abs( P.x ) / L * 2.5 );
    st += ( n1 - 0.5 ) * 2.4 + ( n2 - 0.5 ) * 0.9;
    m = smoothstep( 0.55, 0.9, 0.5 + 0.5 * sin( st * 6.2832 ) ) * ( 1.0 - under * 0.9 ) * mix( 0.75, 0.6, dog ) * ( 0.7 + 0.3 * n2 );
    m = max( m, back * ( isBody + isTail ) * 0.5 * ( 0.6 + 0.4 * n2 ) );
  } else if ( pat > 3.5 ) m = max( blot, sock );
  else if ( pat > 2.5 ) {
    // Lomo oscuro (negro y fuego): manto negro en lomo, costados, nuca y cola; fuego en patas, hocico y pecho.
    float mantle = smoothstep( yc - yr * 0.45, yc + yr * 0.2, P.y + ( n2 - 0.5 ) * yr * 0.4 ) * ( 1.0 - isLeg );
    m = max( mantle * ( isBody * ( 1.0 - chest ) + isHead * ( 1.0 - muzzle ) ), isTail * 0.9 );
  } else if ( pat > 1.5 ) {
    // Pecho, barriga y patas blancas; el hocico blanco, solo en algunos.
    float blaze = step( 0.5, fract( seed * 0.37 ) ) * smoothstep( uCoatHead.y + uCoatHead.z * 0.6, uCoatHead.y + uCoatHead.z * 1.0, P.z );
    m = max( max( sock, chest ), max( under * ( isBody * 0.9 + isHead * 0.8 ), blaze * 0.9 ) );
  } else if ( pat > 0.5 ) m = blot * ( 1.0 - isLeg * 0.3 );
  vec3 col = mix( vCoatA.rgb, vCoatB.rgb, m );
  // Barriga más clara (en el liso, del segundo color) y lomo un poco más oscuro.
  vec3 belly = pat < 0.5 ? vCoatB.rgb : mix( col, uBellyCol, 0.45 );
  col = mix( col, belly, under * uFur.y * ( 1.0 - m * 0.5 ) );
  col *= 1.0 - back * 0.12;
  // Grano del pelo (estirado a lo largo, dos escalas) y algo de variación; de lejos se apaga para que no titile.
  float aa = clamp( 1.0 - length( fwidth( P ) ) * uGrain.x * 0.5, 0.0, 1.0 );
  float hair = aNoise( P * uGrain ) * 0.45 + aNoise( P * uGrain * 2.3 + 7.0 ) * 0.25 + aNoise( P * uGrain * 0.3 + 3.0 ) * 0.3;
  col *= 1.0 + ( hair - 0.5 ) * uFur.x * aa + ( n1 - 0.5 ) * 0.08;
  // Piel (rosada; la cola de la rata, algo más gris), ojos y nariz.
  float mark = vSkin.y;
  if ( mark > 0.5 ) col = mark < 1.5 ? mix( uSkinCol, vCoatA.rgb, isTail * 0.3 ) * ( 0.92 + 0.16 * n2 ) : mark < 2.5 ? uEyeCol : uNoseCol;
  return col * vSkin.x;
}`;

/** Inyecta la animación en un material (el de la especie o el de su sombra) y, si `coat`, el pelaje. */
function animate(mat, uniforms, key, coat = false) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', VERT_HEAD).replace('#include <beginnormal_vertex>', NORMAL_BODY).replace('#include <begin_vertex>', VERT_BODY);
    if (coat) sh.fragmentShader = sh.fragmentShader.replace('#include <common>', FRAG_HEAD).replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.rgb *= animalCoat();');
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

const KINDS = Object.keys(ANIMAL_SHAPES);
const ATTRS = ['aAnim', 'aLook', 'aCoatA', 'aCoatB'];

export class AnimalRenderer {
  /** @param {object} max cupo de cada especie (el presupuesto de sim/animals.js). */
  constructor(scene, max = { perro: 4, gato: 2, rata: 5 }, { shadows = true } = {}) {
    this.uTime = { value: 0 };
    this.meshes = {};
    this.attrs = {};
    this.coats = {};
    const c = new THREE.Color();
    const lin = (hex) => new THREE.Color().setHex(hex);
    for (const kind of KINDS) {
      const s = ANIMAL_SHAPES[kind];
      const n = Math.max(1, max[kind] ?? 1);
      const geo = animalGeometry(kind);
      const attrs = {};
      for (const name of ATTRS) {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
        a.setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute(name, a);
        attrs[name] = a;
      }
      const st = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
      st.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aState', st);
      attrs.aState = st;
      const h = headFrame(s);
      const uniforms = {
        uAnimalTime: this.uTime,
        uShoulder: { value: new THREE.Vector3(0, s.leg, s.len * 0.33) },
        uLeg: { value: s.leg },
        uDead: { value: new THREE.Vector2(s.y, s.r[0]) }, // muerto: alto del lomo de pie y del costado en el piso
        uDeadLegs: { value: new THREE.Vector4(DEAD_LEG_SPREAD[0], DEAD_LEG_SPREAD[1], DEAD_LEG_DROOP, DEAD_ROLL) },
        uLimp: { value: new THREE.Vector2(LIMP_SWING, LIMP_LIFT) },
        uCoatShape: { value: new THREE.Vector4(s.y, s.r[1], s.len, KINDS.indexOf(kind)) }, // w: especie (0 perro)
        uCoatHead: { value: new THREE.Vector4(h.y, h.z, h.hz, h.hy) },
        uGrain: { value: new THREE.Vector3(...s.grain) },
        uFur: { value: new THREE.Vector2(FUR_GRAIN, BELLY_LIGHT) },
        uSkinCol: { value: lin(s.skin) },
        uNoseCol: { value: lin(s.nose) },
        uEyeCol: { value: lin(s.eye) },
        uBellyCol: { value: lin(s.belly) },
      };
      const mat = animate(new THREE.MeshLambertMaterial({ color: 0xffffff }), uniforms, `animales-${kind}`, true);
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.name = `animales-${kind}`;
      m.count = 0;
      m.frustumCulled = false; // las instancias andan por todo el barrio
      m.castShadow = shadows && kind !== 'rata';
      m.receiveShadow = false;
      // La sombra sigue la postura (mismo sombreador de vértices).
      if (m.castShadow) m.customDepthMaterial = animate(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), uniforms, `animales-sombra-${kind}`);
      scene.add(m);
      this.meshes[kind] = m;
      this.attrs[kind] = attrs;
      // Pelajes en el espacio de color de trabajo (lineal): color y patrón, segundo color.
      const coats = new Float32Array(s.coats.length * 8);
      s.coats.forEach(([c1, c2, p], i) => {
        c.setHex(c1);
        coats.set([c.r, c.g, c.b, p], i * 8);
        c.setHex(c2);
        coats.set([c.r, c.g, c.b], i * 8 + 4);
      });
      this.coats[kind] = coats;
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._n = { perro: 0, gato: 0, rata: 0 };
  }

  /** Copia la simulación a las instancias (unas pocas matrices y atributos por cuadro, sin asignar memoria). */
  update(dt, animals, camPos, maxDist = 80) {
    this.uTime.value = (this.uTime.value + dt) % 3600;
    const n = this._n;
    n.perro = n.gato = n.rata = 0;
    for (const a of animals) {
      const m = this.meshes[a.kind];
      const i = n[a.kind];
      if (!m || i >= m.instanceMatrix.count) continue;
      const d = Math.hypot(a.x - camPos.x, a.z - camPos.z);
      if (d > (a.kind === 'rata' ? maxDist * RAT_DRAW_FRACTION : maxDist)) continue;
      this._q.setFromAxisAngle(this._up, a.yaw);
      this._m.compose(this._p.set(a.x, a.y, a.z), this._q, this._s.setScalar(a.scale));
      m.setMatrixAt(i, this._m);
      const at = this.attrs[a.kind];
      at.aAnim.setXYZW(i, a.phase, a.amp, a.wag, a.pose);
      at.aLook.setXYZW(i, a.headYaw, a.headPitch, a.gait, a.crouch);
      // Muerto (con el lado al que cayó) y cojera (se apaga en los últimos 2 s).
      at.aState.setXY(i, (a.dead ?? 0) * (a.side ?? 1), a.limpT > 0 ? Math.min(1, a.limpT / 2) : 0);
      const coats = this.coats[a.kind];
      const k = (a.color % (coats.length / 8)) * 8;
      at.aCoatA.setXYZW(i, coats[k], coats[k + 1], coats[k + 2], coats[k + 3]);
      at.aCoatB.setXYZW(i, coats[k + 4], coats[k + 5], coats[k + 6], (a.color * 7.31) % 37);
      n[a.kind]++;
    }
    let total = 0;
    for (const kind of KINDS) {
      const m = this.meshes[kind];
      const k = n[kind];
      m.count = k;
      m.visible = k > 0;
      total += k;
      if (!k) continue;
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(0, k * 16);
      m.instanceMatrix.needsUpdate = true;
      const at = this.attrs[kind];
      for (let j = 0; j < ATTRS.length; j++) {
        const a = at[ATTRS[j]];
        a.clearUpdateRanges();
        a.addUpdateRange(0, k * 4);
        a.needsUpdate = true;
      }
      at.aState.clearUpdateRanges();
      at.aState.addUpdateRange(0, k * 2);
      at.aState.needsUpdate = true;
    }
    return total;
  }
}
