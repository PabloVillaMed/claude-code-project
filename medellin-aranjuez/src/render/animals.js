// Animales: una malla instanciada por especie (perro, gato, rata) hecha de
// formas suaves (elipsoides para el cuerpo, la cabeza y el hocico, patas
// cónicas, cola curva que se afina, ojos y nariz), con sombreado suave y la
// barriga más clara. El paso (patas en contrafase), el meneo de la cola, el
// cabeceo y las posturas (sentado: el cuerpo gira sobre los hombros y las
// traseras se recogen; echado: baja con las patas estiradas) se hacen en el
// sombreador de vértices con un atributo por instancia: (fase del paso,
// amplitud, meneo de la cola, postura 0 de pie, 1 sentado, 2 echado). La
// sombra usa el mismo sombreador. En total: tres llamadas de dibujo y ~1500
// triángulos por animal.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Partes (atributo `part`): 0 cuerpo, 1 cabeza, 2 cola, 3 pata delantera, 4 pata trasera.
const BODY = 0;
const HEAD = 1;
const TAIL = 2;
const FRONT = 3;
const BACK = 4;

/**
 * Medidas (m, mirando hacia +Z, patas en y = 0) y colores de pelo. `leg`:
 * alto de la articulación (hombro y cadera); `y`: centro del lomo; `len`:
 * largo del tronco; `tail`: puntos de la curva de la cola desde la base.
 */
export const ANIMAL_SHAPES = {
  perro: {
    leg: 0.44, y: 0.47, len: 0.62, r: [0.115, 0.13], head: [0.085, 0.085, 0.1], snout: [0.045, 0.043, 0.075], ear: { size: 0.06, up: false },
    legR: [0.034, 0.024], tailR: 0.022, tail: [[0, 0.5, -0.31], [0, 0.6, -0.42], [0, 0.72, -0.44], [0, 0.78, -0.37]],
    colors: [0x8a5a2b, 0x2b2622, 0xd9c7a3, 0x6b4a2f, 0xa0703f, 0x3a3029, 0xc9a26b, 0x55402e],
  },
  gato: {
    leg: 0.23, y: 0.25, len: 0.36, r: [0.066, 0.075], head: [0.056, 0.052, 0.054], snout: [0.026, 0.02, 0.022], ear: { size: 0.034, up: true },
    legR: [0.018, 0.013], tailR: 0.014, tail: [[0, 0.27, -0.17], [0, 0.34, -0.27], [0, 0.46, -0.31], [0, 0.53, -0.26]],
    colors: [0x1c1b1d, 0xd08a3c, 0x8d8a86, 0xeeeae2, 0x5b4c3e, 0xb27a3f, 0x2f2e33, 0xa8a39b],
  },
  rata: {
    leg: 0.045, y: 0.048, len: 0.16, r: [0.036, 0.034], head: [0.024, 0.022, 0.038], snout: [0.013, 0.012, 0.02], ear: { size: 0.013, up: true, round: true },
    legR: [0.008, 0.006], tailR: 0.0055, tail: [[0, 0.04, -0.07], [0.02, 0.025, -0.15], [-0.01, 0.012, -0.22], [0.01, 0.006, -0.28]],
    colors: [0x4a423a, 0x3b352f, 0x5a5048, 0x433b34, 0x514840, 0x37312c, 0x5e554b, 0x48413a],
  },
};

/** Prepara una pieza: atributos de parte, articulación y sombra (color de vértice), sin uv. */
function piece(g, part, pivot, shade) {
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const p = g.attributes.position;
  const parts = new Float32Array(n).fill(part);
  const piv = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    piv.set(pivot, i * 3);
    const s = typeof shade === 'function' ? shade(p.getX(i), p.getY(i), p.getZ(i)) : shade;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = s;
  }
  g.setAttribute('part', new THREE.BufferAttribute(parts, 1));
  g.setAttribute('pivot', new THREE.BufferAttribute(piv, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
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
  const pieces = [];
  const zF = s.len * 0.33; // hombros
  const zB = -s.len * 0.33; // caderas
  const [rw, rh] = s.r;
  // Barriga más clara, lomo un poco más oscuro.
  const coat = (lo) => (x, y) => 0.82 + 0.3 * THREE.MathUtils.clamp((s.y + rh - y) / (2 * rh), 0, 1) * (lo ? 1 : 0.6);
  // Tronco: pecho, lomo y cadera.
  // (El del medio manda; pecho y cadera apenas asoman, así no se ven "pedazos".)
  pieces.push(piece(blob(0, s.y + rh * 0.04, zF * 0.6, rw * 1.03, rh * 1.04, s.len * 0.28, 14, 10), BODY, [0, 0, 0], coat(true)));
  pieces.push(piece(blob(0, s.y, 0, rw, rh, s.len * 0.54, 16, 10), BODY, [0, 0, 0], coat(true)));
  pieces.push(piece(blob(0, s.y + rh * 0.02, zB * 0.8, rw * 0.97, rh * 0.98, s.len * 0.24, 12, 8), BODY, [0, 0, 0], coat(true)));
  // Cuello y cabeza (articulados en el cuello).
  const neck = [0, s.y + rh * 0.4, s.len / 2 - rw * 0.2];
  const [hx, hy, hz] = s.head;
  const head = [0, s.y + rh * 0.9 + hy * 0.6, s.len / 2 + hz * 0.35];
  if (kind !== 'rata') pieces.push(piece(blob(0, (neck[1] + head[1]) / 2, (neck[2] + head[2]) / 2 - hz * 0.2, hx * 0.66, hy * 0.95, hz * 0.9, 10, 6), HEAD, neck, 0.97));
  pieces.push(piece(blob(head[0], head[1], head[2], hx, hy, hz), HEAD, neck, 1.02));
  const [sx, sy, sz] = s.snout;
  const snoutZ = head[2] + hz * 0.75 + sz * 0.45;
  pieces.push(piece(blob(0, head[1] - hy * 0.3, snoutZ, sx, sy, sz, 10, 6), HEAD, neck, 0.9));
  pieces.push(piece(blob(0, head[1] - hy * 0.2, snoutZ + sz * 0.9, sx * 0.45, sx * 0.35, sx * 0.3, 8, 5), HEAD, neck, 0.18));
  // Ojos.
  for (const k of [-1, 1]) pieces.push(piece(blob(k * hx * 0.55, head[1] + hy * 0.18, head[2] + hz * 0.72, hx * 0.14, hx * 0.14, hx * 0.1, 8, 5), HEAD, neck, 0.12));
  // Orejas: conos parados (gato), redondas (rata) o caídas a los lados (perro).
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
    pieces.push(piece(g, HEAD, neck, e.up ? 0.88 : 0.72));
  }
  // Cola (articulada en su base).
  for (const g of tail(s.tail, s.tailR)) pieces.push(piece(g, TAIL, s.tail[0], kind === 'rata' ? 1.25 : 0.9));
  // Patas: cono de la articulación al piso, muslo en las traseras y pezuña.
  const [ra, rb] = s.legR;
  for (const [z, part] of [[zF, FRONT], [zB, BACK]]) {
    for (const k of [-1, 1]) {
      const x = k * rw * 0.55;
      const pivot = [x, s.leg, z];
      const leg = new THREE.CylinderGeometry(ra, rb, s.leg, 8, 1);
      leg.translate(x, s.leg / 2, z);
      pieces.push(piece(leg, part, pivot, 0.86));
      if (part === BACK) pieces.push(piece(blob(x, s.leg * 0.86, z - ra * 0.3, ra * 1.9, s.leg * 0.32, ra * 2.6, 10, 6), part, pivot, (px, py) => coat(true)(px, py)));
      else pieces.push(piece(blob(x, s.leg * 0.88, z, ra * 1.5, s.leg * 0.24, ra * 1.9, 8, 6), part, pivot, 0.92));
      pieces.push(piece(blob(x, rb * 0.8, z + rb * 0.7, rb * 1.3, rb * 0.8, rb * 1.9, 8, 5), part, pivot, 0.62));
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
attribute vec4 aAnim;
uniform float uAnimalTime;
uniform vec3 uShoulder;
uniform float uLeg;
vec3 rotX( vec3 v, float a ) { float c = cos( a ), s = sin( a ); return vec3( v.x, v.y * c - v.z * s, v.y * s + v.z * c ); }
vec3 rotY( vec3 v, float a ) { float c = cos( a ), s = sin( a ); return vec3( v.x * c + v.z * s, v.y, -v.x * s + v.z * c ); }`;

const VERT_BODY = `vec3 transformed = vec3( position );
{
  float ph = aAnim.x;
  float amp = aAnim.y;
  float wag = aAnim.z;
  float lieW = clamp( aAnim.w - 1.0, 0.0, 1.0 );
  float sitW = clamp( aAnim.w, 0.0, 1.0 ) * ( 1.0 - lieW );
  float still = clamp( aAnim.w, 0.0, 1.0 );
  vec3 v = transformed - pivot;
  if ( part > 2.5 ) {
    // Patas: delanteras y traseras en contrafase; izquierda y derecha también.
    float side = position.x > 0.0 ? 0.0 : 3.14159;
    float back = part > 3.5 ? 3.14159 : 0.0;
    v = rotX( v, sin( ph + side + back ) * amp * ( 1.0 - still ) );
    // Sentado: las traseras se recogen; echado: todas estiradas (adelante y atrás).
    if ( part > 3.5 ) v.y *= mix( 1.0, 0.42, sitW );
    v = rotX( v, lieW * ( part > 3.5 ? 1.3 : -1.3 ) );
    transformed = pivot + v;
  } else if ( part > 1.5 ) {
    // Cola: de lado a lado (rápido si está contento, despacio si no).
    transformed = pivot + rotY( v, sin( uAnimalTime * ( 3.0 + wag * 8.0 ) + ph ) * ( 0.15 + wag * 0.45 ) );
  } else if ( part > 0.5 ) {
    // Cabeza: cabecea al caminar; sentado la endereza (el cuerpo la levanta).
    transformed = pivot + rotX( v, sin( ph * 2.0 ) * amp * 0.22 + sitW * 0.42 );
  }
  // Sentado: el tronco (y lo que cuelga de él) gira hacia atrás sobre los hombros.
  if ( part < 2.5 || part > 3.5 ) transformed = uShoulder + rotX( transformed - uShoulder, -0.62 * sitW );
  // Echado: todo baja hasta el piso.
  transformed.y -= lieW * uLeg * 0.8;
  // El cuerpo sube y baja con cada paso.
  transformed.y += abs( sin( ph ) ) * amp * uLeg * 0.06 * ( 1.0 - still );
}`;

/** Inyecta la animación en un material (el de la especie o el de su sombra). */
function animate(mat, uniforms, key) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', VERT_HEAD).replace('#include <begin_vertex>', VERT_BODY);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

export class AnimalRenderer {
  /** @param {object} max cupo de cada especie (el presupuesto de sim/animals.js). */
  constructor(scene, max = { perro: 9, gato: 6, rata: 10 }, { shadows = true } = {}) {
    this.uTime = { value: 0 };
    this.meshes = {};
    this.anim = {};
    const white = new THREE.Color(1, 1, 1);
    for (const kind of Object.keys(ANIMAL_SHAPES)) {
      const s = ANIMAL_SHAPES[kind];
      const n = Math.max(1, max[kind] ?? 1);
      const geo = animalGeometry(kind);
      const a = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAnim', a);
      const uniforms = { uAnimalTime: this.uTime, uShoulder: { value: new THREE.Vector3(0, s.leg, s.len * 0.33) }, uLeg: { value: s.leg } };
      const mat = animate(new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }), uniforms, `animales-${kind}`);
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.name = `animales-${kind}`;
      m.count = 0;
      m.frustumCulled = false; // las instancias andan por todo el barrio
      m.castShadow = shadows && kind !== 'rata';
      m.receiveShadow = false;
      // La sombra sigue la postura (mismo sombreador de vértices).
      if (m.castShadow) m.customDepthMaterial = animate(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), uniforms, `animales-sombra-${kind}`);
      for (let i = 0; i < n; i++) m.setColorAt(i, white);
      scene.add(m);
      this.meshes[kind] = m;
      this.anim[kind] = a;
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._c = new THREE.Color();
  }

  /** Copia la simulación a las instancias (unas decenas de matrices por cuadro). */
  update(dt, animals, camPos, maxDist = 80) {
    this.uTime.value = (this.uTime.value + dt) % 3600;
    const n = { perro: 0, gato: 0, rata: 0 };
    for (const a of animals) {
      const m = this.meshes[a.kind];
      const i = n[a.kind];
      if (!m || i >= m.instanceMatrix.count) continue;
      const d = Math.hypot(a.x - camPos.x, a.z - camPos.z);
      if (d > (a.kind === 'rata' ? maxDist * 0.45 : maxDist)) continue;
      this._q.setFromAxisAngle(this._up, a.yaw);
      this._m.compose(this._p.set(a.x, a.y, a.z), this._q, this._s.setScalar(a.scale));
      m.setMatrixAt(i, this._m);
      const s = ANIMAL_SHAPES[a.kind];
      m.setColorAt(i, this._c.setHex(s.colors[a.color % s.colors.length]));
      const walking = a.speed > 0 ? Math.min(1, 0.35 + a.speed / 3) : 0;
      const wag = a.kind === 'perro' ? (a.mode === 'flee' ? 0 : a.speed > 0 ? 0.4 : 0.15) : 0;
      this.anim[a.kind].setXYZW(i, a.phase, walking * (a.kind === 'rata' ? 0.9 : 0.55), wag, a.pose);
      n[a.kind]++;
    }
    let total = 0;
    for (const kind of Object.keys(this.meshes)) {
      const m = this.meshes[kind];
      const k = n[kind];
      m.count = k;
      m.visible = k > 0;
      total += k;
      if (!k) continue;
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(0, k * 16);
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.clearUpdateRanges();
      m.instanceColor.addUpdateRange(0, k * 3);
      m.instanceColor.needsUpdate = true;
      const a = this.anim[kind];
      a.clearUpdateRanges();
      a.addUpdateRange(0, k * 4);
      a.needsUpdate = true;
    }
    return total;
  }
}
