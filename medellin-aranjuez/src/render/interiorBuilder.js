// Interiores de los locales a los que se entra (sim/interiors.js da la
// distribución): muros, techo, piso, mezanine con baranda de vidrio,
// escaleras, barra con frente iluminado y estantería de botellas
// retroiluminada (botellas instanciadas), cabina de DJ con su consola,
// pantalla LED (shader), pista de baldosas LED (shader con patrones), mesas
// VIP con sofás curvos y botella con bengala, mesas altas y bancos, truss con
// luces, bola de espejos, afiches y acetatos, decoración paisa, rockola,
// billar, plantas, plataformas de bailarines, baños con puerta...
//
// Luz sin depender de luces reales: cada vértice lleva horneada la luz de
// las fuentes falsas del local (la barra, la pantalla, la pista, los neones)
// y los materiales se alumbran solos con ella (uAmb: el "lavado" de color
// que cambia con el tiempo y el estrobo suave); encima, los emisivos con
// bloom, haces de luz volumétricos falsos (conos aditivos que se mueven),
// láseres (líneas aditivas), puntos de la bola de espejos y neblina. Las 1-2
// luces reales las presta render/nightLights.js solo con el jugador adentro
// (game/interiors.js).
//
// Rendimiento: cada interior se arma por pasos (unos milisegundos por
// cuadro) solo cuando el jugador está cerca; lo estático va fusionado por
// material, lo repetido (botellas, haces, láseres, chispas) instanciado, y lo
// animado solo se mueve con el jugador cerca. Los frentes (puerta doble,
// cortina, marquesina, cordón de la fila) de todos los locales son 5 mallas.

import * as THREE from 'three';
import { INTERIOR } from '../sim/interiors.js';
import { makeRng } from '../sim/rng.js';
import * as TX from './interiorTextures.js';

// ------------------------------------------------------------------ configurables
export const INTERIOR_FX = {
  /** Estrobo suave en los clubes (false = nunca destella). */
  ESTROBO: true,
  /** Destellos por segundo del estrobo (bajo a propósito: lejos de los 3-30 Hz que pueden dar crisis). */
  ESTROBO_HZ: 1.5,
  /** Cuánto sube la luz en cada destello (0 = nada). */
  ESTROBO_FUERZA: 0.35,
  /** Cada cuánto (s) hay una ráfaga de estrobo y cuánto dura (s). */
  ESTROBO_CADA: 26,
  ESTROBO_DURA: 4,
  /** Haces de luz móviles (conos aditivos) de los grandes. */
  HACES: 8,
  /** Láseres de los clubes. */
  LASERES: 10,
  /** Puntos de luz de la bola de espejos. */
  PUNTOS_BOLA: 64,
  /** Chispas por bengala en las botellas de las mesas VIP. */
  CHISPAS: 9,
  /** Planos de neblina. */
  NEBLINA: 4,
  /** Botellas por metro de repisa en la estantería de la barra. */
  BOTELLAS_POR_M: 8,
  /** Multiplicador general de la luz horneada (1 = como se ajustó). */
  LUZ: 1,
  /** Paso (m) de la subdivisión de muros y pisos para hornear la luz. */
  PASO_HORNEO: 1.0,
  /** Milisegundos por cuadro que se gastan armando un interior (se arma en varios cuadros). */
  ARMADO_MS: 5,
};

// ------------------------------------------------------------------ temas (aspecto)
const C = (r, g, b) => [r, g, b];
/** Aspecto de cada tema de sim/interiors.js TEMAS. */
export const ASPECTO = {
  reguetón: { muro: 'panete', muroTint: C(0.13, 0.11, 0.15), piso: 'negro', techo: C(0.05, 0.05, 0.06), acentos: [C(1, 0.15, 0.8), C(0.15, 0.8, 1), C(1, 0.62, 0.15)], base: C(0.1, 0.08, 0.12), barra: C(1, 0.72, 0.3), sofa: C(0.09, 0.08, 0.09), ribete: C(1, 0.76, 0.32), haces: true, laser: 4, estrobo: true, humo: true, ciclo: [C(1, 0.55, 1), C(0.6, 0.75, 1.1), C(1.1, 0.75, 0.55)], led: 0, baranda: 'vidrio' },
  electrónica: { muro: 'concreto', muroTint: C(0.62, 0.62, 0.66), piso: 'concreto', techo: C(0.06, 0.06, 0.07), acentos: [C(0.1, 0.9, 1), C(1, 0.1, 0.65), C(0.35, 1, 0.3)], base: C(0.05, 0.06, 0.08), barra: C(0.2, 0.85, 1), sofa: C(0.12, 0.12, 0.13), ribete: C(0.15, 0.9, 1), haces: true, laser: 10, estrobo: true, humo: true, ciclo: [C(0.6, 0.9, 1.15), C(0.9, 0.6, 1.1), C(0.65, 1.05, 0.8)], led: 1, baranda: 'reja', neonLineas: true },
  hielo: { muro: 'panete', muroTint: C(0.85, 0.9, 0.98), piso: 'blanco', techo: C(0.75, 0.8, 0.88), acentos: [C(0.25, 0.65, 1), C(0.85, 0.95, 1), C(0.4, 0.4, 1)], base: C(0.16, 0.19, 0.26), barra: C(0.35, 0.8, 1), sofa: C(0.92, 0.93, 0.96), ribete: C(0.5, 0.85, 1), haces: true, laser: 6, estrobo: true, humo: true, ciclo: [C(0.7, 0.85, 1.15), C(0.9, 0.95, 1.1), C(0.6, 0.7, 1.2)], led: 2, baranda: 'vidrio' },
  salsoteca: { muro: 'panete', muroTint: C(0.55, 0.12, 0.1), zocalo: 'madera', piso: 'madera', techo: C(0.07, 0.05, 0.05), acentos: [C(1, 0.45, 0.15), C(1, 0.2, 0.25), C(1, 0.8, 0.4)], base: C(0.16, 0.08, 0.06), barra: C(1, 0.62, 0.28), sofa: C(0.4, 0.06, 0.06), ribete: C(1, 0.65, 0.3), bola: true, ciclo: [C(1.1, 0.8, 0.7), C(1.05, 0.7, 0.75), C(1.1, 0.85, 0.6)] },
  fonda: { muro: 'panete', muroTint: C(0.95, 0.93, 0.88), piso: 'barro', techo: C(0.32, 0.2, 0.12), acentos: [C(1, 0.8, 0.4), C(1, 0.3, 0.2), C(0.3, 0.8, 0.4)], base: C(0.26, 0.2, 0.14), barra: C(1, 0.78, 0.42), sofa: C(0.4, 0.25, 0.12), ribete: C(1, 0.8, 0.45), guirnaldas: true, ciclo: [C(1.05, 0.95, 0.8), C(1.08, 0.9, 0.78), C(1, 0.95, 0.85)] },
  son: { muro: 'panete', muroTint: C(0.92, 0.66, 0.38), zocalo: 'madera', piso: 'madera', techo: C(0.42, 0.3, 0.2), acentos: [C(1, 0.75, 0.35), C(0.4, 1, 0.6), C(1, 0.5, 0.3)], base: C(0.22, 0.16, 0.1), barra: C(1, 0.75, 0.4), sofa: C(0.45, 0.3, 0.15), ribete: C(1, 0.8, 0.45), ciclo: [C(1.05, 0.95, 0.8), C(1, 1, 0.85), C(1.08, 0.9, 0.8)] },
  cantina: { muro: 'panete', muroTint: C(0.55, 0.72, 0.6), zocalo: 'baldosa', piso: 'baldosa', techo: C(0.8, 0.8, 0.76), acentos: [C(1, 0.85, 0.55), C(0.3, 1, 0.4), C(1, 0.4, 0.3)], base: C(0.32, 0.3, 0.27), barra: C(1, 0.82, 0.5), sofa: C(0.4, 0.25, 0.12), ribete: C(1, 0.8, 0.5), tubos: true, ciclo: [C(1, 1, 0.95), C(1, 0.98, 0.92), C(1, 1, 0.95)] },
  esquina: { muro: 'panete', muroTint: C(0.45, 0.62, 0.85), zocalo: 'baldosa', piso: 'baldosa', techo: C(0.82, 0.84, 0.86), acentos: [C(1, 0.3, 0.2), C(0.2, 0.7, 1), C(1, 0.85, 0.2)], base: C(0.3, 0.32, 0.35), barra: C(0.9, 0.95, 1), sofa: C(0.8, 0.1, 0.1), ribete: C(1, 0.3, 0.2), tubos: true, neones: true, ciclo: [C(1, 1, 1.02), C(1, 0.98, 1), C(1.02, 1, 1)] },
};

// ------------------------------------------------------------------ geometría acumulada
const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const tmpM3 = new THREE.Matrix3();

/** Acumula triángulos (posición, normal, uv, color) de un material y los vuelve un BufferGeometry. */
class Acc {
  constructor() {
    this.p = [];
    this.n = [];
    this.u = [];
    this.c = [];
    this.i = [];
  }

  get count() {
    return this.p.length / 3;
  }

  _v(v, n, t, col) {
    this.p.push(v[0], v[1], v[2]);
    this.n.push(n[0], n[1], n[2]);
    this.u.push(t[0], t[1]);
    this.c.push(col[0], col[1], col[2]);
  }

  /** Cuadrilátero a-b-c-d con normal n (el orden se corrige solo para que la cara mire hacia n). */
  quad(a, b, c, d, n, uv, col) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const k = this.count;
    this._v(a, n, uv[0], col);
    this._v(b, n, uv[1], col);
    this._v(c, n, uv[2], col);
    this._v(d, n, uv[3], col);
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) this.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
    else this.i.push(k, k + 2, k + 1, k, k + 3, k + 2);
  }

  /**
   * Rectángulo subdividido en celdas de ~`step` m (para que la luz horneada
   * tenga degradé): origen o, eje a (largo la), eje b (largo lb), normal n.
   */
  grid(o, a, la, b, lb, n, col, uvs = 1, step = INTERIOR_FX.PASO_HORNEO) {
    const na = Math.max(1, Math.round(la / step));
    const nb = Math.max(1, Math.round(lb / step));
    const P = (s, t) => [o[0] + a[0] * s + b[0] * t, o[1] + a[1] * s + b[1] * t, o[2] + a[2] * s + b[2] * t];
    for (let i = 0; i < na; i++)
      for (let j = 0; j < nb; j++) {
        const s0 = (la * i) / na;
        const s1 = (la * (i + 1)) / na;
        const t0 = (lb * j) / nb;
        const t1 = (lb * (j + 1)) / nb;
        this.quad(P(s0, t0), P(s1, t0), P(s1, t1), P(s0, t1), n, [[s0 * uvs, t0 * uvs], [s1 * uvs, t0 * uvs], [s1 * uvs, t1 * uvs], [s0 * uvs, t1 * uvs]], col);
      }
  }

  /** Caja alineada; `skip`: caras que no se dibujan ('x+', 'x-', 'y+', 'y-', 'z+', 'z-' separadas por espacio). */
  box(x0, x1, y0, y1, z0, z1, col, uvs = 1, skip = 'y-') {
    const s = ` ${skip} `;
    const U = (a, b) => [a * uvs, b * uvs];
    if (!s.includes(' y+ ')) this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], [U(x0, z0), U(x1, z0), U(x1, z1), U(x0, z1)], col);
    if (!s.includes(' y- ')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [U(x0, z0), U(x1, z0), U(x1, z1), U(x0, z1)], col);
    if (!s.includes(' z+ ')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [U(x0, y0), U(x1, y0), U(x1, y1), U(x0, y1)], col);
    if (!s.includes(' z- ')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], [U(x0, y0), U(x1, y0), U(x1, y1), U(x0, y1)], col);
    if (!s.includes(' x+ ')) this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0], [U(z0, y0), U(z1, y0), U(z1, y1), U(z0, y1)], col);
    if (!s.includes(' x- ')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [U(z0, y0), U(z1, y0), U(z1, y1), U(z0, y1)], col);
  }

  /** Agrega un BufferGeometry de three transformado por `m` (Matrix4) con un color. */
  geom(g, m, col) {
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const uv = g.attributes.uv;
    tmpM3.getNormalMatrix(m);
    const k = this.count;
    for (let v = 0; v < pos.count; v++) {
      tmpV.fromBufferAttribute(pos, v).applyMatrix4(m);
      tmpN.fromBufferAttribute(nor, v).applyMatrix3(tmpM3).normalize();
      this.p.push(tmpV.x, tmpV.y, tmpV.z);
      this.n.push(tmpN.x, tmpN.y, tmpN.z);
      this.u.push(uv ? uv.getX(v) : 0, uv ? uv.getY(v) : 0);
      this.c.push(col[0], col[1], col[2]);
    }
    if (g.index) for (let j = 0; j < g.index.count; j++) this.i.push(k + g.index.getX(j));
    else for (let j = 0; j < pos.count; j++) this.i.push(k + j);
  }

  /** Cilindro vertical (o tronco de cono) con centro de la base en (x, y, z). */
  cyl(x, y, z, rTop, rBot, h, col, seg = 16, open = false) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
    this.geom(g, M.makeTranslation(x, y + h / 2, z), col);
    g.dispose();
  }

  /** Esfera. */
  sphere(x, y, z, r, col, seg = 10) {
    const g = new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg * 0.6)));
    this.geom(g, M.makeTranslation(x, y, z), col);
    g.dispose();
  }

  /**
   * Corona curva extruida (asientos y espaldares de los sofás curvos): radios
   * r0..r1 alrededor de (cx, cz), ángulos a0..a1 (0 = hacia +z), alto y0..y1.
   */
  arc(cx, cz, r0, r1, a0, a1, y0, y1, col, seg = 14) {
    const P = (r, a, y) => [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r];
    for (let s = 0; s < seg; s++) {
      const a = a0 + ((a1 - a0) * s) / seg;
      const b = a0 + ((a1 - a0) * (s + 1)) / seg;
      const nb = [Math.sin((a + b) / 2), 0, Math.cos((a + b) / 2)];
      this.quad(P(r1, a, y0), P(r1, b, y0), P(r1, b, y1), P(r1, a, y1), nb, [[a, y0], [b, y0], [b, y1], [a, y1]], col);
      this.quad(P(r0, a, y0), P(r0, b, y0), P(r0, b, y1), P(r0, a, y1), [-nb[0], 0, -nb[2]], [[a, y0], [b, y0], [b, y1], [a, y1]], col);
      this.quad(P(r0, a, y1), P(r0, b, y1), P(r1, b, y1), P(r1, a, y1), [0, 1, 0], [[a * r0, 0], [b * r0, 0], [b * r1, 1], [a * r1, 1]], col);
    }
    for (const [a, s] of [[a0, -1], [a1, 1]]) {
      const n = [Math.cos(a) * s, 0, -Math.sin(a) * s];
      this.quad(P(r0, a, y0), P(r1, a, y0), P(r1, a, y1), P(r0, a, y1), n, [[0, 0], [1, 0], [1, 1], [0, 1]], col);
    }
  }

  /** Hornea la luz: cada color se multiplica por la luz de las fuentes falsas en su vértice. */
  bake(lights, base, gain = 1) {
    const { p, n, c } = this;
    for (let v = 0; v < c.length; v += 3) {
      let r = base[0];
      let g = base[1];
      let b = base[2];
      const x = p[v];
      const y = p[v + 1];
      const z = p[v + 2];
      for (const L of lights) {
        const dx = L.x - x;
        const dy = L.y - y;
        const dz = L.z - z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-4;
        if (d > L.r) continue;
        const f = 1 - d / L.r;
        const nd = (dx * n[v] + dy * n[v + 1] + dz * n[v + 2]) / d;
        const k = f * f * L.i * (0.3 + 0.7 * Math.max(0, nd));
        r += L.c[0] * k;
        g += L.c[1] * k;
        b += L.c[2] * k;
      }
      c[v] *= r * gain;
      c[v + 1] *= g * gain;
      c[v + 2] *= b * gain;
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    return g;
  }
}
const M = new THREE.Matrix4();
const M2 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const S1 = new THREE.Vector3(1, 1, 1);

// ------------------------------------------------------------------ materiales
/** Se alumbra solo con la luz horneada en el color del vértice × uAmb (el lavado de color del local). */
function baked(m, amb) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uAmb = amb;
    sh.fragmentShader = 'uniform vec3 uAmb;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * uAmb;');
  };
  m.customProgramCacheKey = () => 'interior-horneado';
  return m;
}

const WOOD = { piso: [30, 42, 30], barra: [22, 50, 24], mesa: [26, 45, 34], claro: [34, 40, 50] };

function floorTex(kind) {
  switch (kind) {
    case 'madera':
      return TX.maderaTex(WOOD.piso, 'piso');
    case 'concreto':
      return TX.concretoTex(30, 'piso');
    case 'negro':
      return TX.baldosaTex(['#141416', '#19191c'], 4, 'negro');
    case 'blanco':
      return TX.baldosaTex(['#e9edf3', '#dfe5ee'], 4, 'blanco');
    case 'barro':
      return TX.baldosaTex(['#b5532f', '#a84a2a', '#bf5d35'], 4, 'barro');
    default:
      return TX.baldosaTex(['#d9d2c3', '#8f2f2a', '#d9d2c3', '#2f4f8f'], 4, 'cemento');
  }
}

function wallTex(kind) {
  if (kind === 'concreto') return TX.concretoTex(48, 'muro');
  if (kind === 'ladrillo') return TX.ladrilloTex();
  return TX.paneteTex();
}

/** Materiales de un interior (cada uno con su uniforme de lavado; las texturas son compartidas). */
function interiorMaterials(A) {
  const amb = { value: new THREE.Color(1, 1, 1) };
  const std = (o) => baked(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, ...o }), amb);
  const tex = (t, rep = 1) => {
    if (rep === 1) return t;
    const c = t.clone();
    c.repeat.set(rep, rep);
    c.needsUpdate = true;
    return c;
  };
  return {
    amb,
    muro: std({ map: wallTex(A.muro), roughness: A.muro === 'concreto' ? 0.9 : 0.75 }),
    piso: std({ map: floorTex(A.piso), roughness: A.piso === 'negro' || A.piso === 'blanco' ? 0.22 : A.piso === 'concreto' ? 0.4 : 0.6 }),
    techo: std({ roughness: 1 }),
    madera: std({ map: TX.maderaTex(WOOD.barra, 'barra'), roughness: 0.45 }),
    mesa: std({ map: TX.maderaTex(WOOD.mesa, 'mesa'), roughness: 0.5 }),
    ladrillo: std({ map: TX.ladrilloTex() }),
    baldosa: std({ map: TX.baldosaTex(['#e8eef2', '#d5e3ea'], 6, 'bano'), roughness: 0.3 }),
    metal: std({ roughness: 0.32, metalness: 0.8 }),
    plastico: std({ roughness: 0.5 }),
    cuero: std({ map: TX.cueroTex(), roughness: 0.4 }),
    afiches: std({ map: TX.afichesTex(), roughness: 0.7 }),
    acetatos: std({ map: TX.acetatoTex(), roughness: 0.3 }),
    fotos: std({ map: TX.fotosTex(), roughness: 0.5 }),
    chiva: std({ map: TX.chivaTex(), roughness: 0.4 }),
    hojas: std({ map: TX.hojaTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 }),
    terciopelo: std({ map: TX.terciopeloTex(), roughness: 0.9 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    glowMap: new THREE.MeshBasicMaterial({ vertexColors: true, map: TX.banosTex() }),
    vidrio: new THREE.MeshStandardMaterial({ color: 0x8fb4c8, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.3, depthWrite: false }),
    aditivo: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    _tex: tex,
  };
}

// ------------------------------------------------------------------ shaders
const SHADER_TAIL = '\n  #include <tonemapping_fragment>\n  #include <colorspace_fragment>\n}';
const VERT_UV = 'varying vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

/** Pista de baldosas LED: patrones que cambian cada 8 s (ondas, tablero, barrido, chispazos). */
function ledFloorMaterial(A, tiles) {
  const [a, b, c] = A.acentos;
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uA: { value: new THREE.Color(...a) }, uB: { value: new THREE.Color(...b) }, uC: { value: new THREE.Color(...c) }, uTiles: { value: new THREE.Vector2(tiles[0], tiles[1]) }, uGain: { value: 1 }, uMode: { value: A.led ?? 0 } },
    vertexShader: VERT_UV,
    fragmentShader: `uniform float uTime; uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform vec2 uTiles; uniform float uGain; uniform float uMode;
varying vec2 vUv;
float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 g = vUv * uTiles; vec2 id = floor(g); vec2 f = fract(g);
  float edge = smoothstep(0.03, 0.08, f.x) * smoothstep(0.03, 0.08, f.y) * smoothstep(0.03, 0.08, 1.0 - f.x) * smoothstep(0.03, 0.08, 1.0 - f.y);
  float t = uTime; float h = h21(id);
  vec2 c = id - uTiles * 0.5 + 0.5;
  float p0 = 0.5 + 0.5 * sin(length(c) * 1.1 - t * 3.2);
  float p1 = step(0.5, fract((id.x + id.y) * 0.5 + floor(t * 2.0) * 0.5));
  float p2 = smoothstep(0.6, 1.0, 0.5 + 0.5 * sin(id.x * 0.8 - t * 5.0)) + smoothstep(0.7, 1.0, 0.5 + 0.5 * sin(id.y * 0.9 + t * 3.0));
  float p3 = step(0.72, fract(h + floor(t * 3.0) * 0.37));
  float seg = mod(floor(t / 8.0) + uMode, 4.0);
  float v = seg < 1.0 ? p0 : seg < 2.0 ? p1 : seg < 3.0 ? p2 : p3;
  float k = fract(h * 0.7 + t * 0.06 + (id.x + id.y) * 0.04);
  vec3 col = k < 0.33 ? mix(uA, uB, k * 3.0) : k < 0.66 ? mix(uB, uC, (k - 0.33) * 3.0) : mix(uC, uA, (k - 0.66) * 3.0);
  vec3 lit = col * (0.12 + 2.1 * v) * edge + vec3(0.012) * (1.0 - edge);
  // Reflejo de vidrio: un poco más claro al centro de cada baldosa.
  lit += col * 0.15 * (1.0 - length(f - 0.5) * 1.6) * edge;
  gl_FragColor = vec4(lit * uGain, 1.0);` + SHADER_TAIL,
    fog: false,
  });
}

/** Pantalla LED: plasma y barras de colores con el nombre del local encima; píxeles de LED a la vista. */
function screenMaterial(A, name, aspect) {
  const [a, b, c] = A.acentos;
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: TX.nombreTex(name) }, uA: { value: new THREE.Color(...a) }, uB: { value: new THREE.Color(...b) }, uC: { value: new THREE.Color(...c) }, uAspect: { value: aspect }, uGain: { value: 1 } },
    vertexShader: VERT_UV,
    fragmentShader: `uniform float uTime; uniform sampler2D uMap; uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform float uAspect; uniform float uGain;
varying vec2 vUv;
void main(){
  vec2 p = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5);
  float t = uTime;
  float seg = mod(floor(t / 10.0), 3.0);
  float pl = sin(p.x * 3.0 + t) + sin(p.y * 4.0 - t * 1.3) + sin(length(p) * 6.0 - t * 2.0);
  float bars = step(fract(vUv.y * 1.0), 0.15 + 0.8 * abs(sin(floor(vUv.x * 28.0) * 1.7 + t * 4.0)));
  float tun = 0.5 + 0.5 * sin(1.0 / (length(p) + 0.15) * 2.0 - t * 4.0);
  float v = seg < 1.0 ? 0.5 + 0.5 * sin(pl * 1.6) : seg < 2.0 ? bars : tun;
  vec3 col = mix(mix(uA, uB, 0.5 + 0.5 * sin(t * 0.4 + p.x)), uC, v * 0.6) * (0.25 + v * 1.1);
  // El nombre, cada tanto, grande al centro.
  float show = smoothstep(0.0, 0.5, sin(t * 0.35)) ;
  vec2 q = vec2(0.5 + p.x / min(uAspect, 4.0) * 0.98, 0.5 + p.y * 1.6);
  float txt = (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) ? texture2D(uMap, q).r : 0.0;
  col = mix(col, vec3(1.6), txt * show);
  // Rejilla de LEDs.
  vec2 g = fract(vUv * vec2(uAspect * 70.0, 70.0));
  float dot = smoothstep(0.5, 0.28, length(g - 0.5));
  gl_FragColor = vec4(col * (0.35 + 0.85 * dot) * uGain, 1.0);` + SHADER_TAIL,
    fog: false,
  });
}

/** Televisor con fútbol: cancha verde a rayas, jugadores que corren y el marcador. */
function tvMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: VERT_UV,
    fragmentShader: `uniform float uTime; varying vec2 vUv;
float h11(float n){ return fract(sin(n) * 43758.5453); }
void main(){
  vec2 p = vUv; float t = uTime;
  vec3 col = mix(vec3(0.12, 0.45, 0.15), vec3(0.16, 0.55, 0.2), step(0.5, fract((p.x + t * 0.02) * 6.0)));
  col = mix(col, vec3(0.9), smoothstep(0.012, 0.0, abs(p.x - 0.5 + sin(t * 0.1) * 0.2)) );
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    vec2 q = vec2(fract(h11(fi) + 0.08 * sin(t * (0.3 + h11(fi + 3.0)) + fi)), 0.15 + 0.7 * h11(fi + 7.0) + 0.05 * sin(t * 0.7 + fi));
    float d = length((p - q) * vec2(1.6, 1.0));
    col = mix(col, i < 5 ? vec3(0.9, 0.85, 0.1) : vec3(0.1, 0.2, 0.8), smoothstep(0.022, 0.012, d));
  }
  col = mix(col, vec3(0.05), step(0.9, p.y) * step(p.x, 0.3));
  gl_FragColor = vec4(col * 1.4, 1.0);` + SHADER_TAIL,
    fog: false,
  });
}

// ------------------------------------------------------------------ vista de un interior
/**
 * Un interior armado (o armándose). step(ms) avanza el armado; update()
 * anima lo que se mueve; dispose() suelta la geometría (texturas compartidas).
 */
export class InteriorView {
  constructor(r, quality = {}) {
    this.r = r;
    this.A = ASPECTO[r.tema] ?? ASPECTO.esquina;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = `interior-${r.id}`;
    this.group.position.set(r.ox, 0, r.oz);
    this.group.rotation.y = r.rot;
    this.group.visible = false;
    this.group.updateMatrix();
    this.group.matrixAutoUpdate = false;
    this.ready = false;
    this.anim = []; // (dt, t, ctx) → void
    this.lightSpots = []; // dónde van las luces reales prestadas (local)
    this.shaders = [];
    this.rng = makeRng(Math.floor(Math.abs(r.ox * 13 + r.oz * 7)) + 1);
    this._steps = this._build();
    this.t = 0;
  }

  /** Avanza el armado unos `ms`; true cuando ya está. */
  step(ms = INTERIOR_FX.ARMADO_MS) {
    if (this.ready) return true;
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (this._steps.next().done) {
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
    const A = this.A;
    this.mats = interiorMaterials(A);
    yield;
    const accs = new Map();
    this.acc = (k) => {
      if (!accs.has(k)) accs.set(k, new Acc());
      return accs.get(k);
    };
    this._structure();
    yield;
    for (const it of r.items) {
      this._item(it);
      if (this.acc('muro').count > 0 && it.t === 'barra') yield;
    }
    yield;
    this._decor();
    yield;
    // Luz horneada (las fuentes falsas del local) y mallas por material.
    const lights = this._fakeLights();
    for (const [k, a] of accs) {
      if (k === 'glow' || k === 'glowMap' || k === 'vidrio' || k === 'aditivo') continue;
      a.bake(lights, A.base, INTERIOR_FX.LUZ);
    }
    yield;
    for (const [k, a] of accs) {
      if (!a.count) continue;
      const mesh = new THREE.Mesh(a.build(), this.mats[k]);
      mesh.name = `interior-${k}`;
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      if (k === 'vidrio' || k === 'aditivo') mesh.renderOrder = 2;
      this.group.add(mesh);
      yield;
    }
    accs.clear();
    this._fx();
    yield;
    this.group.updateMatrixWorld(true);
  }

  // -------------------------------------------------------------- estructura
  _structure() {
    const r = this.r;
    const A = this.A;
    const T = INTERIOR.MURO;
    const { X0, X1, Z0, Z1, y0 } = r;
    const top = y0 + r.H;
    const wallCol = A.muroTint;
    const W = this.acc('muro');
    const floor = this.acc('piso');
    const ceil = this.acc('techo');
    // Piso del salón (la pista va encima).
    floor.grid([X0, y0, Z0], [1, 0, 0], X1 - X0, [0, 0, 1], Z1 - Z0, [0, 1, 0], [1, 1, 1], 0.5);
    // Techo (con el hueco del foso del sótano, que tiene el suyo más alto).
    const ceilRects = r.shaft ? rectMinusLocal({ x0: X0, x1: X1, z0: Z0, z1: Z1 }, { x0: r.shaft.x0 - r.shaft.wall, x1: r.shaft.x1 + r.shaft.wall, z0: r.shaft.z0 - r.shaft.wall, z1: Z1 }) : [{ x0: X0, x1: X1, z0: Z0, z1: Z1 }];
    for (const q of ceilRects) ceil.grid([q.x0, top, q.z0], [1, 0, 0], q.x1 - q.x0, [0, 0, 1], q.z1 - q.z0, [0, -1, 0], A.techo, 0.5);
    // Muros (caras de adentro), subdivididos para la luz; el de la fachada con el vano de la puerta.
    const wy0 = y0;
    const wallH = r.H;
    W.grid([X0, wy0, Z0], [1, 0, 0], X1 - X0, [0, 1, 0], wallH, [0, 0, 1], wallCol, 0.5);
    W.grid([X0, wy0, Z0], [0, 0, 1], Z1 - Z0, [0, 1, 0], wallH, [1, 0, 0], wallCol, 0.5);
    W.grid([X1, wy0, Z0], [0, 0, 1], Z1 - Z0, [0, 1, 0], wallH, [-1, 0, 0], wallCol, 0.5);
    const d = r.door;
    const fy = r.floorY;
    if (!r.shaft) {
      W.grid([X0, wy0, Z1], [1, 0, 0], d.x0 - X0, [0, 1, 0], wallH, [0, 0, -1], wallCol, 0.5);
      W.grid([d.x1, wy0, Z1], [1, 0, 0], X1 - d.x1, [0, 1, 0], wallH, [0, 0, -1], wallCol, 0.5);
      W.grid([d.x0, fy + d.h, Z1], [1, 0, 0], d.x1 - d.x0, [0, 1, 0], top - fy - d.h, [0, 0, -1], wallCol, 0.5);
    } else {
      const s = r.shaft;
      const sx0 = s.x0 - s.wall;
      const sx1 = s.x1 + s.wall;
      // Fachada por dentro a los lados del foso (salón) y dentro del foso (con la puerta).
      W.grid([X0, wy0, Z1], [1, 0, 0], sx0 - X0, [0, 1, 0], wallH, [0, 0, -1], wallCol, 0.5);
      W.grid([sx1, wy0, Z1], [1, 0, 0], X1 - sx1, [0, 1, 0], wallH, [0, 0, -1], wallCol, 0.5);
      const L = this.acc('ladrillo');
      L.grid([s.x0, fy, Z1], [1, 0, 0], d.x0 - s.x0, [0, 1, 0], s.top - fy, [0, 0, -1], [0.9, 0.9, 0.9], 1);
      L.grid([d.x1, fy, Z1], [1, 0, 0], s.x1 - d.x1, [0, 1, 0], s.top - fy, [0, 0, -1], [0.9, 0.9, 0.9], 1);
      L.grid([d.x0, fy + d.h, Z1], [1, 0, 0], d.x1 - d.x0, [0, 1, 0], s.top - fy - d.h, [0, 0, -1], [0.9, 0.9, 0.9], 1);
      // Muros del foso: por dentro (ladrillo) y por fuera hacia el salón (pañete).
      for (const [x, nx, outN] of [[s.x0, 1, -1], [s.x1, -1, 1]]) {
        L.grid([x, y0, s.z0], [0, 0, 1], Z1 - s.z0, [0, 1, 0], s.top - y0, [nx, 0, 0], [0.9, 0.9, 0.9], 1);
        W.grid([x + outN * s.wall, y0, s.z0 - s.wall], [0, 0, 1], Z1 - s.z0 + s.wall, [0, 1, 0], wallH, [outN, 0, 0], wallCol, 0.5);
      }
      // Dintel sobre la boca de la escalera (de cara al que baja) y techo del foso.
      L.grid([s.x0, top, s.z0], [1, 0, 0], s.x1 - s.x0, [0, 1, 0], s.top - top, [0, 0, 1], [0.9, 0.9, 0.9], 1);
      ceil.grid([s.x0, s.top, s.z0], [1, 0, 0], s.x1 - s.x0, [0, 0, 1], Z1 - s.z0, [0, -1, 0], A.techo, 0.5);
      // Descanso y escalones.
      const l = r.landing;
      floor.box(l.x0, l.x1, fy - 0.15, fy, l.z0, Z1, [1, 1, 1], 0.5, 'y- z+ x+ x-');
      this._steps(r.stairs[0], this.acc('madera'), [0.7, 0.6, 0.5]);
      // Pasamanos a los dos lados.
      const st = r.stairs[0];
      const M_ = this.acc('metal');
      for (const x of [s.x0 + 0.06, s.x1 - 0.06]) this._rail(M_, x, st.z0, st.yLow + 0.9, st.z1, st.yHigh + 0.9, [0.75, 0.6, 0.3]);
    }
    // Zócalo (rodapié) y, en algunos temas, enchape bajo (madera o baldosa).
    const zk = A.zocalo;
    const zh = zk ? 1.1 : 0.12;
    const Z = zk === 'madera' ? this.acc('madera') : zk === 'baldosa' ? this.acc('baldosa') : this.acc('metal');
    const zc = zk ? [0.85, 0.82, 0.8] : [0.08, 0.08, 0.08];
    const e = 0.03;
    Z.box(X0, X1, y0, y0 + zh, Z0, Z0 + e, zc, 1, 'y- z-');
    Z.box(X0, X0 + e, y0, y0 + zh, Z0, Z1, zc, 1, 'y- x-');
    Z.box(X1 - e, X1, y0, y0 + zh, Z0, Z1, zc, 1, 'y- x+');
    if (!r.shaft) {
      Z.box(X0, d.x0, y0, y0 + zh, Z1 - e, Z1, zc, 1, 'y- z+');
      Z.box(d.x1, X1, y0, y0 + zh, Z1 - e, Z1, zc, 1, 'y- z+');
    }
    // Jambas del vano por dentro del muro (la fachada pone la parte de afuera).
    const J = this.acc('metal');
    J.box(d.x0 - 0.08, d.x0, fy, fy + d.h, -T, -0.2, [0.1, 0.1, 0.1], 1, 'y-');
    J.box(d.x1, d.x1 + 0.08, fy, fy + d.h, -T, -0.2, [0.1, 0.1, 0.1], 1, 'y-');
    J.box(d.x0 - 0.08, d.x1 + 0.08, fy + d.h, fy + d.h + 0.1, -T, -0.2, [0.1, 0.1, 0.1], 1, 'y-');
    // Mezanine: losa, borde, baranda (vidrio o reja), columnas y escalera.
    if (r.mezz) this._mezz();
    // Neón en líneas por los muros (club industrial) o tira LED al pie del techo.
    const G = this.acc('glow');
    if (A.neonLineas) {
      const [c1, c2] = A.acentos;
      const k = 3.2;
      for (const [yy, col] of [[y0 + 2.6, c1], [y0 + r.H - 0.4, c2]]) {
        G.box(X0 + 0.02, X0 + 0.06, yy, yy + 0.05, Z0 + 0.5, Z1 - 0.6, col.map((v) => v * k), 1, '');
        G.box(X1 - 0.06, X1 - 0.02, yy, yy + 0.05, Z0 + 0.5, Z1 - 0.6, col.map((v) => v * k), 1, '');
        G.box(X0 + 0.5, X1 - 0.5, yy, yy + 0.05, Z0 + 0.02, Z0 + 0.06, col.map((v) => v * k), 1, '');
      }
      // Diagonales de neón en el muro del fondo, a los lados de la pantalla.
      for (const s of [-1, 1]) {
        for (let q = 0; q < 3; q++) {
          const x = s * (r.W / 2 - 1.2 - q * 0.6);
          const g = new THREE.BoxGeometry(0.05, 2.6, 0.04);
          E.set(0, 0, s * 0.5);
          Q.setFromEuler(E);
          M2.compose(tmpV.set(x, y0 + 3.2, Z0 + 0.05), Q, S1);
          G.geom(g, M2, A.acentos[q % 3].map((v) => v * k));
          g.dispose();
        }
      }
    } else if (r.tam === 'grande') {
      const c = A.ribete.map((v) => v * 2.4);
      G.box(X0 + 0.02, X0 + 0.05, top - 0.12, top - 0.06, Z0 + 0.1, Z1 - 0.1, c, 1, '');
      G.box(X1 - 0.05, X1 - 0.02, top - 0.12, top - 0.06, Z0 + 0.1, Z1 - 0.1, c, 1, '');
    }
    // Tubos fluorescentes (cantina, bar de esquina).
    if (A.tubos) {
      for (let z = Z0 + 2; z < Z1 - 1; z += 3.2) {
        G.box(-0.6, 0.6, top - 0.06, top - 0.02, z - 0.04, z + 0.04, [2.2, 2.3, 2.3], 1, 'y+');
        this.acc('metal').box(-0.65, 0.65, top - 0.08, top - 0.005, z - 0.07, z + 0.07, [0.85, 0.85, 0.85], 1, 'y+');
      }
    }
  }

  /** Escalones (huella y contrahuella) de una escalera de sim/interiors.js. */
  _steps(st, acc, col) {
    const rise = (st.yHigh - st.yLow) / st.n;
    for (let k = 0; k < st.n; k++) {
      // El escalón k (desde abajo) ocupa [z0 + k·huella, z0 + (k+1)·huella] y sube hasta yLow + (k+1)·rise.
      const za = st.z0 + k * st.tread;
      const zb = Math.min(st.z1, za + st.tread);
      const y = st.yLow + (k + 1) * rise;
      acc.box(st.x0, st.x1, st.yLow, y, za, zb, col, 1, 'y- z+');
      // Nariz iluminada (seguridad) en los clubes.
    }
  }

  /** Pasamanos inclinado de (z0, y0) a (z1, y1) en x. */
  _rail(acc, x, z0, ya, z1, yb, col) {
    const L = Math.hypot(z1 - z0, yb - ya);
    const g = new THREE.CylinderGeometry(0.025, 0.025, L, 8);
    E.set(Math.PI / 2 - Math.atan2(yb - ya, z1 - z0), 0, 0);
    Q.setFromEuler(E);
    M2.compose(tmpV.set(x, (ya + yb) / 2, (z0 + z1) / 2), Q, S1);
    acc.geom(g, M2, col);
    g.dispose();
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      acc.cyl(x, ya - 0.9 + (yb - ya) * t, z0 + (z1 - z0) * t, 0.015, 0.015, 0.9, col, 6);
    }
  }

  _mezz() {
    const r = this.r;
    const A = this.A;
    const m = r.mezz;
    const st = r.stairs.find((s) => Math.abs(s.yHigh - m.y) < 0.01);
    const floor = this.acc('piso');
    const ceil = this.acc('techo');
    const metal = this.acc('metal');
    // Piso de arriba y su cara de abajo (cielo raso del bajo-mezanine) y el canto.
    floor.grid([m.x0, m.y, m.z0], [1, 0, 0], m.x1 - m.x0, [0, 0, 1], m.z1 - m.z0, [0, 1, 0], [1, 1, 1], 0.5);
    ceil.grid([m.x0, m.y - m.slab, m.z0], [1, 0, 0], m.x1 - m.x0, [0, 0, 1], m.z1 - m.z0, [0, -1, 0], A.techo.map((v) => v * 1.4), 0.5);
    metal.box(m.x0, m.x1, m.y - m.slab, m.y, m.z0, m.z0 + 0.02, [0.08, 0.08, 0.09], 1, 'y+ y- z+');
    // Tira LED en el canto (el ribete del tema).
    this.acc('glow').box(m.x0, m.x1, m.y - m.slab + 0.06, m.y - m.slab + 0.1, m.z0 - 0.01, m.z0, A.ribete.map((v) => v * 2.6), 1, '');
    // Bajo el mezanine: ojos de buey (puntos de luz) en el cielo raso.
    for (let x = m.x0 + 1.5; x < m.x1 - 1; x += 2.2) for (let z = m.z0 + 1.3; z < m.z1 - 0.5; z += 2.0) this.acc('glow').cyl(x, m.y - m.slab - 0.012, z, 0.07, 0.07, 0.01, [2.4, 2.2, 1.9], 10);
    // Baranda del borde (deja libre la llegada de la escalera).
    const gx = st ? st.x1 : m.x0;
    const h = INTERIOR.BARANDA;
    if (A.baranda === 'reja') {
      metal.box(gx, m.x1, m.y + h - 0.05, m.y + h, m.z0 + 0.01, m.z0 + 0.07, [0.15, 0.15, 0.16], 1, 'y-');
      for (let x = gx + 0.05; x < m.x1; x += 0.14) metal.box(x, x + 0.025, m.y, m.y + h - 0.05, m.z0 + 0.03, m.z0 + 0.055, [0.2, 0.2, 0.21], 1, 'y- y+');
    } else {
      this.acc('vidrio').box(gx, m.x1, m.y + 0.06, m.y + h - 0.06, m.z0 + 0.03, m.z0 + 0.05, [1, 1, 1], 1, '');
      metal.box(gx, m.x1, m.y + h - 0.06, m.y + h, m.z0 + 0.01, m.z0 + 0.07, [0.85, 0.85, 0.88], 1, 'y-');
      for (let x = gx + 0.03; x < m.x1; x += 1.6) metal.box(x, x + 0.04, m.y, m.y + h, m.z0 + 0.02, m.z0 + 0.06, [0.85, 0.85, 0.88], 1, 'y-');
    }
    // Escalera: escalones, baranda del lado abierto y pasamanos del lado del muro.
    if (st) {
      this._steps(st, this.acc('piso'), [0.8, 0.8, 0.82]);
      const glow = this.acc('glow');
      const rise = (st.yHigh - st.yLow) / st.n;
      for (let k = 0; k < st.n; k++) glow.box(st.x0 + 0.05, st.x1 - 0.05, st.yLow + (k + 1) * rise - 0.02, st.yLow + (k + 1) * rise, st.z0 + k * st.tread - 0.012, st.z0 + k * st.tread, A.ribete.map((v) => v * 1.6), 1, 'y- z+');
      if (A.baranda === 'reja') this._rail(metal, st.x1 + 0.03, st.z0, st.yLow + 1.0, st.z1, st.yHigh + 1.0, [0.2, 0.2, 0.21]);
      else {
        // Vidrio inclinado como paralelogramo + pasamanos.
        const v = this.acc('vidrio');
        const x = st.x1 + 0.03;
        v.quad([x, st.yLow + 0.1, st.z0], [x, st.yHigh + 0.1, st.z1], [x, st.yHigh + 0.95, st.z1], [x, st.yLow + 0.95, st.z0], [1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1]);
        v.quad([x, st.yLow + 0.1, st.z0], [x, st.yHigh + 0.1, st.z1], [x, st.yHigh + 0.95, st.z1], [x, st.yLow + 0.95, st.z0], [-1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 1, 1]);
        this._rail(metal, x, st.z0, st.yLow + 1.0, st.z1, st.yHigh + 1.0, [0.85, 0.85, 0.88]);
      }
      this._rail(metal, st.x0 + 0.05, st.z0, st.yLow + 0.9, st.z1, st.yHigh + 0.9, [0.75, 0.75, 0.78]);
      // Lado abierto de la escalera, macizo (el hueco de abajo queda cerrado).
      const side = this.acc('muro');
      for (let k = 0; k < st.n; k++) {
        const za = st.z0 + k * st.tread;
        side.quad([st.x1, st.yLow, za], [st.x1, st.yLow, za + st.tread], [st.x1, st.yLow + (k + 1) * rise, za + st.tread], [st.x1, st.yLow + (k + 1) * rise, za], [1, 0, 0], [[za, 0], [za + st.tread, 0], [za + st.tread, 1], [za, 1]], A.muroTint);
      }
      side.quad([st.x0, st.yLow, st.z1], [st.x1, st.yLow, st.z1], [st.x1, st.yHigh - 0.3, st.z1], [st.x0, st.yHigh - 0.3, st.z1], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], A.muroTint);
    }
  }

  // -------------------------------------------------------------- muebles
  _item(it) {
    const r = this.r;
    const A = this.A;
    const rng = this.rng;
    const metal = this.acc('metal');
    const glow = this.acc('glow');
    const cx = (it.x0 + it.x1) / 2;
    const cz = (it.z0 + it.z1) / 2;
    switch (it.t) {
      case 'barra': {
        const wood = this.acc('madera');
        const face = it.face; // dirección hacia los clientes (+1/-1 en x, o z si va de lado a lado)
        const alongX = it.x1 - it.x0 > it.z1 - it.z0;
        const lightCol = it.luz === 'cian' ? [0.2, 0.9, 1] : it.luz === 'azul' ? [0.35, 0.75, 1] : it.luz === 'fría' ? [0.85, 0.95, 1] : A.barra;
        // Cuerpo, sobre (que sobresale hacia los clientes) y zócalo.
        const body = it.kind === 'mostrador' ? [0.7, 0.45, 0.25] : r.tema === 'hielo' ? [0.75, 0.85, 0.95] : [0.18, 0.16, 0.16];
        (it.kind === 'mostrador' || it.kind === 'madera' ? wood : metal).box(it.x0, it.x1, it.y, it.y + it.h - 0.06, it.z0, it.z1, body, 1, 'y-');
        const over = 0.12;
        const top = [it.x0 - (alongX ? 0 : face < 0 ? over : 0), it.x1 + (alongX ? 0 : face > 0 ? over : 0), it.z0 - (alongX && face < 0 ? over : 0), it.z1 + (alongX && face > 0 ? over : 0)];
        wood.box(top[0], top[1], it.y + it.h - 0.06, it.y + it.h, top[2], top[3], r.tema === 'hielo' ? [1.2, 1.25, 1.3] : [0.9, 0.8, 0.7], 1, 'y-');
        // Frente iluminado: paneles con luz de abajo hacia arriba y la línea del borde.
        const k = 2.4;
        if (alongX) {
          const z = face > 0 ? it.z1 + 0.005 : it.z0 - 0.005;
          for (let x = it.x0 + 0.1; x < it.x1 - 0.1; x += 0.9) {
            const x1 = Math.min(it.x1 - 0.1, x + 0.8);
            glow.quad([x, it.y + 0.12, z], [x1, it.y + 0.12, z], [x1, it.y + it.h - 0.2, z], [x, it.y + it.h - 0.2, z], [0, 0, face], [[0, 0], [1, 0], [1, 1], [0, 1]], lightCol.map((v) => v * 0.55));
          }
          glow.box(it.x0, it.x1, it.y + it.h - 0.1, it.y + it.h - 0.07, z - 0.01, z + 0.01, lightCol.map((v) => v * k), 1, '');
          // Reposapiés.
          const g = new THREE.CylinderGeometry(0.03, 0.03, it.x1 - it.x0 - 0.2, 8);
          M2.compose(tmpV.set(cx, it.y + 0.22, z + face * 0.18), Q.setFromEuler(E.set(0, 0, Math.PI / 2)), S1);
          metal.geom(g, M2, [0.85, 0.75, 0.4]);
          g.dispose();
          for (let x = it.x0 + 0.4; x < it.x1 - 0.2; x += 0.75) this._stool(x, z + face * 0.55, it.y, 0.78);
        } else {
          const x = face > 0 ? it.x1 + 0.005 : it.x0 - 0.005;
          for (let z = it.z0 + 0.1; z < it.z1 - 0.1; z += 0.9) {
            const z1 = Math.min(it.z1 - 0.1, z + 0.8);
            glow.quad([x, it.y + 0.12, z], [x, it.y + 0.12, z1], [x, it.y + it.h - 0.2, z1], [x, it.y + it.h - 0.2, z], [face, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], lightCol.map((v) => v * 0.55));
          }
          glow.box(x - 0.01, x + 0.01, it.y + it.h - 0.1, it.y + it.h - 0.07, it.z0, it.z1, lightCol.map((v) => v * k), 1, '');
          const g = new THREE.CylinderGeometry(0.03, 0.03, it.z1 - it.z0 - 0.2, 8);
          M2.compose(tmpV.set(x + face * 0.18, it.y + 0.22, cz), Q.setFromEuler(E.set(Math.PI / 2, 0, 0)), S1);
          metal.geom(g, M2, [0.85, 0.75, 0.4]);
          g.dispose();
          for (let z = it.z0 + 0.4; z < it.z1 - 0.2; z += 0.75) this._stool(x + face * 0.55, z, it.y, 0.78);
        }
        // Detrás: caja registradora y vasos.
        break;
      }
      case 'estante': {
        this._shelf(it);
        break;
      }
      case 'tarima': {
        const wood = this.acc(r.tema === 'fonda' || r.tema === 'son' || r.tema === 'salsoteca' ? 'madera' : 'metal');
        wood.box(it.x0, it.x1, it.y, it.y + it.h, it.z0, it.z1, r.tema === 'hielo' ? [0.9, 0.92, 0.96] : [0.25, 0.22, 0.22], 1, 'y-');
        // Borde de luz al frente.
        const c = A.ribete.map((v) => v * 2.2);
        glow.box(it.x0, it.x1, it.y + it.h - 0.05, it.y + it.h - 0.01, it.z1, it.z1 + 0.02, c, 1, '');
        if (r.tema === 'reguetón' || r.tema === 'electrónica' || r.tema === 'hielo') {
          for (let x = it.x0 + 0.3; x < it.x1 - 0.2; x += 0.6) glow.box(x, x + 0.25, it.y + 0.08, it.y + 0.14, it.z1, it.z1 + 0.012, A.acentos[1].map((v) => v * 1.4), 1, '');
        }
        break;
      }
      case 'cabina':
        this._booth(it);
        break;
      case 'parlante':
        this._speaker(it);
        break;
      case 'sofa': {
        const L = this.acc('cuero');
        const col = A.sofa;
        const a0 = it.dir + Math.PI - 1.35;
        const a1 = it.dir + Math.PI + 1.35;
        L.arc(it.cx, it.cz, it.rad - 0.55, it.rad, a0, a1, it.y, it.y + 0.44, col);
        L.arc(it.cx, it.cz, it.rad - 0.02, it.rad + 0.16, a0, a1, it.y + 0.3, it.y + 0.95, col);
        // Ribete de luz en la base (el del tema).
        glow.arc(it.cx, it.cz, it.rad + 0.16, it.rad + 0.17, a0, a1, it.y + 0.03, it.y + 0.07, A.ribete.map((v) => v * 2), 10);
        break;
      }
      case 'mesita': {
        metal.cyl(it.cx, it.y, it.cz, 0.12, 0.2, 0.42, [0.2, 0.2, 0.2], 14);
        this.acc(r.tema === 'hielo' ? 'vidrio' : 'metal').cyl(it.cx, it.y + 0.42, it.cz, 0.38, 0.38, 0.04, r.tema === 'reguetón' ? [0.9, 0.7, 0.3] : [0.85, 0.85, 0.9], 20);
        glow.cyl(it.cx, it.y + 0.4, it.cz, 0.385, 0.385, 0.012, A.ribete.map((v) => v * 1.8), 20, true);
        // Hielera, botella y vasos.
        metal.cyl(it.cx - 0.12, it.y + 0.46, it.cz + 0.05, 0.11, 0.09, 0.2, [0.85, 0.85, 0.88], 12, true);
        this._bottle(this.acc('plastico'), it.cx + 0.1, it.y + 0.46, it.cz - 0.06, 0.95, [0.1, 0.25, 0.12]);
        glow.cyl(it.cx + 0.1, it.y + 0.46, it.cz - 0.06, 0.035, 0.04, 0.2, [0.3, 0.6, 0.25], 8);
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 2 + 0.4;
          this.acc('vidrio').cyl(it.cx + Math.sin(a) * 0.26, it.y + 0.46, it.cz + Math.cos(a) * 0.26, 0.035, 0.03, 0.11, [1, 1, 1], 8, true);
        }
        if (it.botella) (this._bengalas ??= []).push([it.cx + 0.1, it.y + 0.46 + 0.36, it.cz - 0.06]);
        break;
      }
      case 'mesa':
        this._table(it);
        break;
      case 'mesaAlta': {
        metal.cyl(it.cx, it.y, it.cz, 0.25, 0.25, 0.03, [0.15, 0.15, 0.15], 16);
        metal.cyl(it.cx, it.y, it.cz, 0.04, 0.04, it.h - 0.04, [0.8, 0.8, 0.82], 8);
        this.acc('mesa').cyl(it.cx, it.y + it.h - 0.04, it.cz, 0.34, 0.34, 0.04, [0.6, 0.5, 0.45], 18);
        glow.cyl(it.cx, it.y + it.h - 0.045, it.cz, 0.345, 0.345, 0.008, A.ribete.map((v) => v * 1.6), 18, true);
        this._stool(it.cx + 0.55, it.cz, it.y, 0.78);
        this._stool(it.cx - 0.55, it.cz, it.y, 0.78);
        break;
      }
      case 'banos':
        this._bathrooms(it);
        break;
      case 'columna': {
        const c = r.tema === 'electrónica' ? 'muro' : 'metal';
        this.acc(c).box(it.x0, it.x1, it.y, it.y + it.h, it.z0, it.z1, r.tema === 'electrónica' ? [0.7, 0.7, 0.72] : [0.12, 0.12, 0.13], 0.5, 'y- y+');
        glow.box(it.x0 - 0.005, it.x1 + 0.005, it.y + 0.3, it.y + it.h - 0.3, cz - 0.02, cz + 0.02, A.acentos[0].map((v) => v * 2.2), 1, 'y- y+');
        break;
      }
      case 'taquilla': {
        this.acc('madera').box(it.x0, it.x1, it.y, it.y + it.h, it.z0, it.z1, [0.25, 0.2, 0.18], 1, 'y-');
        this.acc('vidrio').box(it.x0, it.x1, it.y + it.h, it.y + it.h + 0.55, it.z1 - 0.03, it.z1 - 0.01, [1, 1, 1], 1, '');
        glow.box(it.x0, it.x1, it.y + 0.9, it.y + 0.94, it.z1, it.z1 + 0.01, A.ribete.map((v) => v * 2), 1, '');
        break;
      }
      case 'plataforma': {
        metal.cyl(it.cx, it.y, it.cz, 0.7, 0.72, it.h - 0.05, [0.85, 0.88, 0.92], 24);
        glow.cyl(it.cx, it.y + it.h - 0.05, it.cz, 0.7, 0.7, 0.05, [0.5, 1.4, 2.6], 24);
        glow.cyl(it.cx, it.y + 0.05, it.cz, 0.725, 0.725, 0.04, [0.3, 0.9, 2.2], 24, true);
        break;
      }
      case 'chiva':
        this._chiva(it);
        break;
      case 'rockola':
        this._jukebox(it);
        break;
      case 'billar':
        this._pool(it);
        break;
      case 'nevera': {
        metal.box(it.x0, it.x1, it.y, it.y + it.h, it.z0, it.z1, [0.85, 0.12, 0.1], 1, 'y-');
        glow.quad([it.x0 + 0.08, it.y + 0.15, it.z1 + 0.005], [it.x1 - 0.08, it.y + 0.15, it.z1 + 0.005], [it.x1 - 0.08, it.y + it.h - 0.3, it.z1 + 0.005], [it.x0 + 0.08, it.y + it.h - 0.3, it.z1 + 0.005], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.55, 0.65, 0.7]);
        for (let y = it.y + 0.25; y < it.y + it.h - 0.4; y += 0.38) for (let x = it.x0 + 0.15; x < it.x1 - 0.1; x += 0.11) this._bottle(this.acc('plastico'), x, y, it.z1 - 0.15, 0.7, [0.55, 0.32, 0.1]);
        break;
      }
      case 'planta':
        this._plant(it.cx, it.cz, it.y);
        break;
      default:
        this._decoItem(it);
    }
  }

  _decoItem(it) {
    const r = this.r;
    const A = this.A;
    const glow = this.acc('glow');
    switch (it.t) {
      case 'pista': {
        const w = it.x1 - it.x0;
        const d = it.z1 - it.z0;
        if (it.kind === 'led' || it.kind === 'hielo') {
          const mat = ledFloorMaterial(A, [Math.max(2, Math.round(w / 0.6)), Math.max(2, Math.round(d / 0.6))]);
          this.shaders.push(mat);
          const g = new THREE.PlaneGeometry(w, d);
          g.rotateX(-Math.PI / 2);
          const mesh = new THREE.Mesh(g, mat);
          mesh.position.set((it.x0 + it.x1) / 2, it.y + 0.012, (it.z0 + it.z1) / 2);
          mesh.updateMatrix();
          mesh.matrixAutoUpdate = false;
          mesh.name = 'interior-pista-led';
          this.group.add(mesh);
          // Marco metálico de la pista.
          this.acc('metal').box(it.x0 - 0.08, it.x1 + 0.08, it.y, it.y + 0.02, it.z0 - 0.08, it.z1 + 0.08, [0.6, 0.6, 0.62], 1, 'y-');
        } else if (it.kind === 'madera') {
          this.acc('madera').grid([it.x0, it.y + 0.01, it.z0], [1, 0, 0], w, [0, 0, 1], d, [0, 1, 0], [1.05, 0.95, 0.85], 0.6);
          this.acc('metal').box(it.x0 - 0.05, it.x1 + 0.05, it.y, it.y + 0.008, it.z0 - 0.05, it.z1 + 0.05, [0.7, 0.55, 0.3], 1, 'y-');
        } else if (it.kind === 'concreto') {
          // Concreto pulido con líneas de luz alrededor.
          const c = A.acentos[0].map((v) => v * 2.4);
          glow.box(it.x0, it.x1, it.y + 0.005, it.y + 0.012, it.z0 - 0.03, it.z0, c, 1, 'y-');
          glow.box(it.x0, it.x1, it.y + 0.005, it.y + 0.012, it.z1, it.z1 + 0.03, c, 1, 'y-');
          glow.box(it.x0 - 0.03, it.x0, it.y + 0.005, it.y + 0.012, it.z0, it.z1, c, 1, 'y-');
          glow.box(it.x1, it.x1 + 0.03, it.y + 0.005, it.y + 0.012, it.z0, it.z1, c, 1, 'y-');
        } else {
          this.acc('baldosa').grid([it.x0, it.y + 0.006, it.z0], [1, 0, 0], w, [0, 0, 1], d, [0, 1, 0], [1, 0.75, 0.6], 0.8);
        }
        break;
      }
      case 'pantalla': {
        const w = it.x1 - it.x0;
        const h = it.y1 - it.y0;
        const mat = screenMaterial(A, r.name, w / h);
        this.shaders.push(mat);
        const g = new THREE.PlaneGeometry(w, h);
        const mesh = new THREE.Mesh(g, mat);
        mesh.position.set((it.x0 + it.x1) / 2, (it.y0 + it.y1) / 2, it.z + 0.06);
        mesh.updateMatrix();
        mesh.matrixAutoUpdate = false;
        mesh.name = 'interior-pantalla';
        this.group.add(mesh);
        this.acc('metal').box(it.x0 - 0.1, it.x1 + 0.1, it.y0 - 0.1, it.y1 + 0.1, it.z, it.z + 0.05, [0.05, 0.05, 0.05], 1, 'z-');
        this._screenLight = { x: (it.x0 + it.x1) / 2, y: (it.y0 + it.y1) / 2, z: it.z + 2 };
        break;
      }
      case 'truss':
        this._truss(it);
        break;
      case 'humo': {
        this.acc('metal').cyl(it.x, it.y, it.z, 0.16, 0.2, 0.32, [0.15, 0.15, 0.16], 12);
        this.acc('metal').cyl(it.x, it.y + 0.32, it.z, 0.07, 0.07, 0.12, [0.3, 0.3, 0.32], 10);
        (this._humos ??= []).push([it.x, it.y + 0.45, it.z]);
        break;
      }
      case 'bola':
        this._mirrorBall(it);
        break;
      case 'instrumentos':
        this._instruments(it);
        break;
      case 'afiches':
        this._posters();
        break;
      case 'casitas':
        this._casitas();
        break;
      case 'guirnaldas':
        this._garlands(it);
        break;
      case 'ventilador':
        (this._fans ??= []).push(it);
        this.acc('metal').cyl(it.x, it.y - 0.35, it.z, 0.02, 0.02, 0.35, [0.3, 0.25, 0.2], 6);
        this.acc('metal').cyl(it.x, it.y - 0.5, it.z, 0.12, 0.1, 0.15, [0.45, 0.35, 0.25], 12);
        break;
      case 'fotos':
        this._photos();
        break;
      case 'tv':
        this._tv(it);
        break;
      case 'canastas': {
        const cols = [[0.75, 0.1, 0.08], [0.95, 0.7, 0.05], [0.1, 0.35, 0.7]];
        for (let k = 0; k < 5; k++) this.acc('plastico').box(it.x - 0.25, it.x + 0.25, r.y0 + k * 0.27, r.y0 + k * 0.27 + 0.26, it.z - 0.18, it.z + 0.18, cols[k % 3], 1, 'y-');
        break;
      }
      case 'afichesBar':
        this._posters(true);
        break;
      case 'neones':
        this._beerNeons();
        break;
      default:
        break;
    }
  }

  // -------------------------------------------------------------- piezas
  /** Banco alto de barra. */
  _stool(x, z, y, h) {
    const metal = this.acc('metal');
    const A = this.A;
    metal.cyl(x, y, z, 0.18, 0.2, 0.03, [0.2, 0.2, 0.2], 12);
    metal.cyl(x, y + 0.03, z, 0.025, 0.025, h - 0.1, [0.8, 0.8, 0.82], 6);
    metal.cyl(x, y + 0.28, z, 0.14, 0.14, 0.02, [0.8, 0.8, 0.82], 12, true);
    this.acc('cuero').cyl(x, y + h - 0.08, z, 0.19, 0.17, 0.08, A.sofa.map((v) => Math.min(1, v * 1.4 + 0.05)), 14);
  }

  /** Botella (cuerpo, hombro y cuello) parada en (x, y, z). */
  _bottle(acc, x, y, z, s = 1, col = [0.25, 0.5, 0.3]) {
    acc.cyl(x, y, z, 0.035 * s, 0.035 * s, 0.2 * s, col, 8);
    acc.cyl(x, y + 0.2 * s, z, 0.012 * s, 0.035 * s, 0.07 * s, col, 8);
    acc.cyl(x, y + 0.27 * s, z, 0.012 * s, 0.012 * s, 0.07 * s, col, 6);
  }

  /** Estantería de botellas retroiluminada (las botellas van instanciadas). */
  _shelf(it) {
    const r = this.r;
    const A = this.A;
    const wood = this.acc('metal');
    const glow = this.acc('glow');
    const alongX = it.x1 - it.x0 > it.z1 - it.z0;
    const face = it.face;
    const lightCol = (r.tema === 'electrónica' ? [0.25, 0.85, 1] : r.tema === 'hielo' ? [0.45, 0.8, 1] : A.barra).map((v) => v * 1.1);
    // Fondo luminoso y repisas.
    const levels = [0.95, 1.4, 1.85, 2.3];
    const back = alongX ? (face > 0 ? it.z0 + 0.02 : it.z1 - 0.02) : face > 0 ? it.x0 + 0.02 : it.x1 - 0.02;
    if (alongX) glow.quad([it.x0, it.y + 0.85, back], [it.x1, it.y + 0.85, back], [it.x1, it.y + it.h - 0.05, back], [it.x0, it.y + it.h - 0.05, back], [0, 0, face], [[0, 0], [1, 0], [1, 1], [0, 1]], lightCol);
    else glow.quad([back, it.y + 0.85, it.z0], [back, it.y + 0.85, it.z1], [back, it.y + it.h - 0.05, it.z1], [back, it.y + it.h - 0.05, it.z0], [face, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], lightCol);
    // Mueble de abajo (puertas).
    this.acc('madera').box(it.x0, it.x1, it.y, it.y + 0.85, it.z0, it.z1, [0.3, 0.25, 0.22], 1, 'y-');
    for (const lv of levels) wood.box(it.x0, it.x1, it.y + lv - 0.03, it.y + lv, it.z0, it.z1, [0.75, 0.75, 0.78], 1, '');
    // Botellas: posiciones para la malla instanciada.
    const len = alongX ? it.x1 - it.x0 : it.z1 - it.z0;
    const per = Math.max(2, Math.floor(len * INTERIOR_FX.BOTELLAS_POR_M));
    const bottles = (this._bottles ??= []);
    for (const lv of levels.slice(0, 3)) {
      for (let k = 0; k < per; k++) {
        const s = (k + 0.5) / per;
        const a = (alongX ? it.x0 : it.z0) + len * s + this.rng.range(-0.02, 0.02);
        const d = 0.13 + this.rng.range(-0.03, 0.03);
        const p = alongX ? [a, it.y + lv, face > 0 ? it.z0 + d : it.z1 - d] : [face > 0 ? it.x0 + d : it.x1 - d, it.y + lv, a];
        bottles.push({ p, s: this.rng.range(0.85, 1.25), c: this.rng.pick(BOTTLE_COLORS) });
      }
    }
  }

  /** Cabina del DJ (o consola del animador): mueble con frente de luz, tornamesas, mezclador, portátil y lámpara. */
  _booth(it) {
    const A = this.A;
    const metal = this.acc('metal');
    const glow = this.acc('glow');
    const y1 = it.y + it.h;
    metal.box(it.x0, it.x1, it.y, y1 - 0.05, it.z0, it.z1, [0.08, 0.08, 0.09], 1, 'y-');
    metal.box(it.x0 - 0.05, it.x1 + 0.05, y1 - 0.05, y1, it.z0 - 0.05, it.z1 + 0.05, [0.15, 0.15, 0.16], 1, 'y-');
    // Frente: rombos de luz (patrón del tema).
    const z = it.z1 + 0.006;
    const n = Math.max(3, Math.round((it.x1 - it.x0) / 0.5));
    for (let k = 0; k < n; k++) {
      const x0 = it.x0 + 0.08 + ((it.x1 - it.x0 - 0.16) * k) / n;
      const x1 = x0 + (it.x1 - it.x0 - 0.16) / n - 0.06;
      glow.quad([x0, it.y + 0.15, z], [x1, it.y + 0.15, z], [x1, y1 - 0.2, z], [x0, y1 - 0.2, z], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], A.acentos[k % 3].map((v) => v * 1.3));
    }
    if (it.kind === 'consola') return;
    const cx = (it.x0 + it.x1) / 2;
    const zc = (it.z0 + it.z1) / 2;
    for (const s of [-1, 1]) {
      metal.box(cx + s * 0.55 - 0.2, cx + s * 0.55 + 0.2, y1, y1 + 0.06, zc - 0.2, zc + 0.2, [0.2, 0.2, 0.22], 1, 'y-');
      metal.cyl(cx + s * 0.55, y1 + 0.06, zc, 0.14, 0.14, 0.012, [0.05, 0.05, 0.05], 20);
      glow.cyl(cx + s * 0.55, y1 + 0.072, zc, 0.03, 0.03, 0.004, A.acentos[1].map((v) => v * 2), 10);
    }
    metal.box(cx - 0.18, cx + 0.18, y1, y1 + 0.08, zc - 0.18, zc + 0.18, [0.12, 0.12, 0.13], 1, 'y-');
    for (let k = 0; k < 4; k++) glow.box(cx - 0.14 + k * 0.08, cx - 0.12 + k * 0.08, y1 + 0.08, y1 + 0.085, zc - 0.12, zc + 0.05, [0.3, 1.6, 0.4], 1, 'y-');
    // Portátil abierto, mirando al DJ.
    metal.box(cx + 1.0, cx + 1.3, y1, y1 + 0.015, zc - 0.1, zc + 0.12, [0.7, 0.7, 0.72], 1, 'y-');
    glow.quad([cx + 1.0, y1 + 0.015, zc - 0.1], [cx + 1.3, y1 + 0.015, zc - 0.1], [cx + 1.3, y1 + 0.21, zc - 0.16], [cx + 1.0, y1 + 0.21, zc - 0.16], [0, 0.3, -1], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.6, 0.8, 1.2]);
  }

  /** Torre de parlantes con sus conos. */
  _speaker(it) {
    const metal = this.acc('metal');
    metal.box(it.x0, it.x1, it.y, it.y + it.h, it.z0, it.z1, [0.06, 0.06, 0.065], 1, 'y-');
    const n = Math.max(2, Math.floor(it.h / 0.55));
    const cx = (it.x0 + it.x1) / 2;
    for (let k = 0; k < n; k++) {
      const y = it.y + 0.3 + k * (it.h / n);
      const r0 = Math.min(0.32, (it.x1 - it.x0) * 0.38);
      const g = new THREE.CylinderGeometry(r0, r0 * 0.6, 0.06, 18, 1, true);
      M2.compose(tmpV.set(cx, y, it.z1 + 0.02), Q.setFromEuler(E.set(Math.PI / 2, 0, 0)), S1);
      metal.geom(g, M2, [0.16, 0.16, 0.17]);
      g.dispose();
      const d = new THREE.CircleGeometry(r0 * 0.25, 14);
      M2.compose(tmpV.set(cx, y, it.z1 + 0.035), Q.identity(), S1);
      metal.geom(d, M2, [0.35, 0.35, 0.37]);
      d.dispose();
    }
  }

  /** Mesa (madera, plástico o redonda) con sus sillas. */
  _table(it) {
    const r = this.r;
    const plastic = it.kind === 'plastico';
    const top = plastic ? this.acc('plastico') : this.acc('mesa');
    const w = it.w;
    const col = plastic ? (r.tema === 'esquina' ? [0.85, 0.1, 0.08] : [0.95, 0.95, 0.92]) : [0.8, 0.65, 0.5];
    if (it.kind === 'redonda') {
      top.cyl(it.cx, it.y + 0.72, it.cz, w / 2, w / 2, 0.04, col, 18);
      this.acc('metal').cyl(it.cx, it.y, it.cz, 0.04, 0.04, 0.72, [0.2, 0.2, 0.2], 8);
      this.acc('metal').cyl(it.cx, it.y, it.cz, 0.22, 0.24, 0.03, [0.2, 0.2, 0.2], 12);
    } else {
      top.box(it.cx - w / 2, it.cx + w / 2, it.y + 0.72, it.y + 0.76, it.cz - w / 2, it.cz + w / 2, col, 1, '');
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) top.box(it.cx + sx * (w / 2 - 0.06) - 0.025, it.cx + sx * (w / 2 - 0.06) + 0.025, it.y, it.y + 0.72, it.cz + sz * (w / 2 - 0.06) - 0.025, it.cz + sz * (w / 2 - 0.06) + 0.025, col.map((v) => v * 0.8), 1, 'y- y+');
    }
    // Sobre la mesa: cervezas (y la de aguardiente en la fonda).
    for (let k = 0; k < (plastic ? 3 : 2); k++) this._bottle(this.acc('plastico'), it.cx - 0.15 + k * 0.15, it.y + 0.76, it.cz + (k % 2 ? 0.1 : -0.08), 0.85, [0.4, 0.2, 0.05]);
    if (r.tema === 'fonda') this.acc('glow').cyl(it.cx + 0.2, it.y + 0.76, it.cz + 0.15, 0.04, 0.045, 0.22, [0.3, 0.55, 1.1], 8);
    // Sillas.
    const n = it.sillas;
    for (let k = 0; k < n; k++) {
      const a = (k * Math.PI * 2) / n + Math.PI / 4;
      const d = w / 2 + 0.32;
      this._chair(it.cx + Math.sin(a) * d, it.cz + Math.cos(a) * d, it.y, a + Math.PI, plastic ? col : [0.55, 0.38, 0.22], plastic ? 'plastico' : 'mesa');
    }
  }

  /** Silla sencilla mirando hacia `yaw` (local). */
  _chair(x, z, y, yaw, col, key) {
    const acc = this.acc(key);
    const g = new THREE.BoxGeometry(0.42, 0.04, 0.42);
    const back = new THREE.BoxGeometry(0.42, 0.42, 0.04);
    const leg = new THREE.BoxGeometry(0.035, 0.44, 0.035);
    Q.setFromEuler(E.set(0, yaw, 0));
    M.compose(tmpV.set(x, y, z), Q, S1);
    acc.geom(g, M2.makeTranslation(0, 0.45, 0).premultiply(M), col);
    acc.geom(back, M2.makeTranslation(0, 0.68, -0.19).premultiply(M), col);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) acc.geom(leg, M2.makeTranslation(sx * 0.18, 0.22, sz * 0.18).premultiply(M), col.map((v) => v * 0.8));
    g.dispose();
    back.dispose();
    leg.dispose();
  }

  _bathrooms(it) {
    const tile = this.acc('baldosa');
    tile.box(it.x0, it.x1, it.y, it.y + it.h, it.z0, it.z1, [0.95, 0.95, 0.95], 0.8, 'y-');
    // Dos puertas con su letrero hacia el lado de `face`.
    const alongX = it.axis === 'z';
    const len = alongX ? it.x1 - it.x0 : it.z1 - it.z0;
    const wood = this.acc('madera');
    const gm = this.acc('glowMap');
    for (let k = 0; k < 2; k++) {
      const c = (alongX ? it.x0 : it.z0) + len * (0.27 + 0.46 * k);
      if (alongX) {
        const z = it.face > 0 ? it.z1 + 0.02 : it.z0 - 0.02;
        const d = it.face > 0 ? [z - 0.02, z] : [z, z + 0.02];
        wood.box(c - 0.42, c + 0.42, it.y, it.y + 2.05, d[0], d[1], [0.5, 0.35, 0.25], 1, 'y-');
        const zz = z + it.face * 0.005;
        const uv = it.face < 0 ? [[k * 0.5 + 0.5, 0], [k * 0.5, 0], [k * 0.5, 1], [k * 0.5 + 0.5, 1]] : [[k * 0.5, 0], [k * 0.5 + 0.5, 0], [k * 0.5 + 0.5, 1], [k * 0.5, 1]];
        gm.quad([c - 0.3, it.y + 2.15, zz], [c + 0.3, it.y + 2.15, zz], [c + 0.3, it.y + 2.45, zz], [c - 0.3, it.y + 2.45, zz], [0, 0, it.face], uv, [1.6, 1.6, 1.6]);
      } else {
        const x = it.face > 0 ? it.x1 + 0.02 : it.x0 - 0.02;
        const d = it.face > 0 ? [x - 0.02, x] : [x, x + 0.02];
        wood.box(d[0], d[1], it.y, it.y + 2.05, c - 0.42, c + 0.42, [0.5, 0.35, 0.25], 1, 'y-');
        const xx = x + it.face * 0.005;
        const uv = it.face > 0 ? [[k * 0.5 + 0.5, 0], [k * 0.5, 0], [k * 0.5, 1], [k * 0.5 + 0.5, 1]] : [[k * 0.5, 0], [k * 0.5 + 0.5, 0], [k * 0.5 + 0.5, 1], [k * 0.5, 1]];
        gm.quad([xx, it.y + 2.15, c - 0.3], [xx, it.y + 2.15, c + 0.3], [xx, it.y + 2.45, c + 0.3], [xx, it.y + 2.45, c - 0.3], [it.face, 0, 0], uv, [1.6, 1.6, 1.6]);
      }
    }
  }

  _truss(it) {
    const metal = this.acc('metal');
    const col = [0.75, 0.75, 0.78];
    const y = it.y;
    const s = 0.3;
    // Cuadro de truss: dos cordones por lado con diagonales.
    const sides = [[it.x0, it.z0, it.x1, it.z0], [it.x1, it.z0, it.x1, it.z1], [it.x1, it.z1, it.x0, it.z1], [it.x0, it.z1, it.x0, it.z0]];
    for (const [ax, az, bx, bz] of sides) {
      const L = Math.hypot(bx - ax, bz - az);
      const yaw = Math.atan2(bx - ax, bz - az);
      for (const [dy, dw] of [[0, -s / 2], [0, s / 2], [s, -s / 2], [s, s / 2]]) {
        const g = new THREE.CylinderGeometry(0.025, 0.025, L, 6);
        g.rotateX(Math.PI / 2);
        Q.setFromEuler(E.set(0, yaw, 0));
        const ox = Math.cos(yaw) * dw;
        const oz = -Math.sin(yaw) * dw;
        M2.compose(tmpV.set((ax + bx) / 2 + ox, y + dy, (az + bz) / 2 + oz), Q, S1);
        metal.geom(g, M2, col);
        g.dispose();
      }
      const n = Math.max(2, Math.round(L / 0.6));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const px = ax + (bx - ax) * t;
        const pz = az + (bz - az) * t;
        metal.cyl(px, y, pz, 0.015, 0.015, s, col, 4);
      }
      // Cabezas móviles y focos (los haces salen de aquí).
      for (let k = 0; k < Math.max(1, Math.round(L / 2.4)); k++) {
        const t = (k + 0.5) / Math.max(1, Math.round(L / 2.4));
        const px = ax + (bx - ax) * t;
        const pz = az + (bz - az) * t;
        metal.box(px - 0.13, px + 0.13, y - 0.32, y - 0.04, pz - 0.13, pz + 0.13, [0.1, 0.1, 0.1], 1, '');
        this.acc('glow').cyl(px, y - 0.34, pz, 0.08, 0.08, 0.02, [2, 2, 2], 10);
        (this._heads ??= []).push([px, y - 0.34, pz]);
      }
    }
    // Colgantes al techo.
    for (const [x, z] of [[it.x0, it.z0], [it.x1, it.z0], [it.x1, it.z1], [it.x0, it.z1]]) metal.cyl(x, y + s, z, 0.01, 0.01, this.r.y0 + this.r.H - y - s, [0.3, 0.3, 0.3], 4);
  }

  _mirrorBall(it) {
    this.acc('metal').cyl(it.x, it.y + 0.2, it.z, 0.006, 0.006, this.r.y0 + this.r.H - it.y - 0.2, [0.4, 0.4, 0.4], 4);
    const g = new THREE.SphereGeometry(0.24, 18, 12).toNonIndexed();
    // Caras planas (espejitos): normales por triángulo.
    g.computeVertexNormals();
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    for (let i = 0; i < pos.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, i);
      const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2);
      const n = b.sub(a).cross(c.sub(a)).normalize();
      for (let k = 0; k < 3; k++) nor.setXYZ(i + k, n.x, n.y, n.z);
    }
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12, emissive: 0x777777, flatShading: true }));
    mesh.position.set(it.x, it.y, it.z);
    mesh.name = 'interior-bola';
    this.group.add(mesh);
    this._ball = { mesh, x: it.x, y: it.y, z: it.z };
  }

  _instruments(it) {
    const metal = this.acc('metal');
    const wood = this.acc('madera');
    const y = it.y;
    const cx = (it.x0 + it.x1) / 2;
    const zc = (it.z0 + it.z1) / 2;
    const w = it.x1 - it.x0;
    if (it.set === 'salsa') {
      // Congas (tres), timbales con campana, piano vertical y atriles.
      for (let k = 0; k < 3; k++) {
        const x = it.x0 + 0.6 + k * 0.36;
        wood.cyl(x, y, zc - 0.1 + (k % 2) * 0.2, 0.15, 0.12, 0.78 + k * 0.03, [0.75, 0.45, 0.2], 14);
        metal.cyl(x, y + 0.78 + k * 0.03, zc - 0.1 + (k % 2) * 0.2, 0.152, 0.152, 0.02, [0.9, 0.85, 0.7], 14, true);
      }
      const tx = cx - 0.3;
      metal.cyl(tx, y, zc, 0.012, 0.012, 0.85, [0.8, 0.8, 0.8], 6);
      for (const s of [-1, 1]) metal.cyl(tx + s * 0.2, y + 0.85, zc, 0.18, 0.18, 0.16, [0.85, 0.85, 0.88], 18);
      metal.box(tx - 0.06, tx + 0.06, y + 1.0, y + 1.1, zc - 0.03, zc + 0.03, [0.7, 0.65, 0.3], 1, '');
      const px = it.x1 - 1.0;
      wood.box(px - 0.75, px + 0.75, y, y + 1.25, it.z0 + 0.15, it.z0 + 0.75, [0.08, 0.06, 0.05], 1, 'y-');
      wood.box(px - 0.72, px + 0.72, y + 0.72, y + 0.76, it.z0 + 0.75, it.z0 + 0.98, [0.08, 0.06, 0.05], 1, 'y-');
      this.acc('plastico').box(px - 0.7, px + 0.7, y + 0.76, y + 0.79, it.z0 + 0.76, it.z0 + 0.95, [0.95, 0.95, 0.92], 1, 'y-');
      for (let k = 0; k < 3; k++) {
        const x = it.x0 + 1.0 + k * (w - 2) / 2.5;
        metal.cyl(x, y, it.z1 - 0.5, 0.01, 0.01, 1.1, [0.15, 0.15, 0.15], 6);
        const g = new THREE.BoxGeometry(0.42, 0.3, 0.01);
        M2.compose(tmpV.set(x, y + 1.15, it.z1 - 0.5), Q.setFromEuler(E.set(-0.5, Math.PI, 0)), S1);
        metal.geom(g, M2, [0.15, 0.15, 0.15]);
        g.dispose();
      }
    } else {
      // Bongó, tres (guitarra cubana) en su base, maracas y el micrófono.
      wood.cyl(cx - 0.8, y, zc, 0.01, 0.01, 0.6, [0.2, 0.2, 0.2], 6);
      wood.cyl(cx - 0.9, y + 0.6, zc, 0.1, 0.09, 0.16, [0.7, 0.42, 0.2], 12);
      wood.cyl(cx - 0.68, y + 0.6, zc, 0.12, 0.1, 0.17, [0.7, 0.42, 0.2], 12);
      this._tres(wood, cx + 0.2, y + 0.55, zc + 0.3, 0.3);
      metal.cyl(cx + 1.2, y, zc + 0.5, 0.01, 0.01, 1.5, [0.15, 0.15, 0.15], 6);
      metal.sphere(cx + 1.2, y + 1.55, zc + 0.5, 0.04, [0.3, 0.3, 0.3], 8);
    }
  }

  /** Tres cubano (caja de guitarra con su mástil), inclinado. */
  _tres(acc, x, y, z, tilt = 0) {
    const g = new THREE.CylinderGeometry(0.17, 0.17, 0.08, 16);
    g.rotateX(Math.PI / 2);
    Q.setFromEuler(E.set(0, 0, tilt));
    M2.compose(tmpV.set(x, y, z), Q, S1);
    acc.geom(g, M2, [0.75, 0.5, 0.25]);
    const g2 = new THREE.CylinderGeometry(0.14, 0.14, 0.08, 16);
    g2.rotateX(Math.PI / 2);
    M2.compose(tmpV.set(x - Math.sin(tilt) * -0.22, y + Math.cos(tilt) * 0.22, z), Q, S1);
    acc.geom(g2, M2, [0.75, 0.5, 0.25]);
    const n = new THREE.BoxGeometry(0.05, 0.5, 0.03);
    M2.compose(tmpV.set(x - Math.sin(tilt) * 0.55, y + Math.cos(tilt) * 0.55, z), Q, S1);
    acc.geom(n, M2, [0.3, 0.2, 0.12]);
    g.dispose();
    g2.dispose();
    n.dispose();
  }

  /** Afiches (salsoteca y cantina) y acetatos (salsoteca) en los muros. */
  _posters(bar = false) {
    const r = this.r;
    const P = this.acc('afiches');
    const rec = this.acc('acetatos');
    const y = r.y0 + Math.min(1.5, r.H - 1.6);
    const ph = Math.min(1.0, r.H - y - 0.3);
    const pw = ph * (256 / 360);
    let k = 0;
    const put = (x, z, nx, nz) => {
      const s = k % 8;
      const u0 = (s % 4) / 4;
      const v0 = s < 4 ? 0.5 : 0;
      const uv = [[u0, v0], [u0 + 0.25, v0], [u0 + 0.25, v0 + 0.5], [u0, v0 + 0.5]];
      // Eje horizontal: la derecha de quien mira el muro (si no, el afiche sale al revés).
      const ax = nz;
      const az = -nx;
      const a = [x - (ax * pw) / 2, y, z - (az * pw) / 2];
      const b = [x + (ax * pw) / 2, y, z + (az * pw) / 2];
      P.quad(a, b, [b[0], y + ph, b[2]], [a[0], y + ph, a[2]], [nx, 0, nz], uv, [1, 1, 1]);
      k++;
    };
    const putRec = (x, z, nx, nz, yy, kind) => {
      const rr = 0.16;
      const ax = nz;
      const az = -nx;
      const u0 = kind / 4;
      rec.quad([x - ax * rr, yy - rr, z - az * rr], [x + ax * rr, yy - rr, z + az * rr], [x + ax * rr, yy + rr, z + az * rr], [x - ax * rr, yy + rr, z - az * rr], [nx, 0, nz], [[u0, 0], [u0 + 0.25, 0], [u0 + 0.25, 1], [u0, 1]], [1, 1, 1]);
    };
    const e = 0.012;
    // Muro izquierdo y derecho, espaciados (sin tapar la barra).
    const zs = [];
    for (let z = r.Z0 + 1.0; z < r.Z1 - 1.2; z += bar ? 2.6 : 1.7) zs.push(z);
    const bar0 = r.items.find((i) => i.t === 'barra');
    for (const z of zs) {
      put(r.X0 + e, z, 1, 0);
      if (!bar0 || bar0.x1 < r.X1 - 2.2 || z < bar0.z0 - 0.5 || z > bar0.z1 + 0.5 || bar0.y + 2.6 < y) put(r.X1 - e, z, -1, 0);
      if (!bar) {
        putRec(r.X0 + e, z + 0.85, 1, 0, y + ph * 0.45, k % 4);
        putRec(r.X0 + e, z + 0.85, 1, 0, y + ph * 0.45 - 0.42, (k + 1) % 4);
      }
    }
    // Fondo: fila de acetatos sobre la tarima.
    if (!bar) for (let x = r.X0 + 0.6; x < r.X1 - 0.4; x += 0.42) putRec(x, r.Z0 + e, 0, 1, r.y0 + r.H - 0.35, Math.floor((x * 7) % 4 + 4) % 4);
  }

  /** Fachadas de pueblito pintadas por dentro de la fonda (casitas con puertas, ventanas, balcones y alero), y lo que cuelga. */
  _casitas() {
    const r = this.r;
    const W = this.acc('muro');
    const wood = this.acc('madera');
    const glow = this.acc('glow');
    const doors = [[0.8, 0.15, 0.12], [0.1, 0.45, 0.25], [0.15, 0.3, 0.7], [0.95, 0.65, 0.1], [0.55, 0.1, 0.45]];
    const H = r.H;
    const y0 = r.y0;
    let k = 0;
    for (const [x, nx] of [[r.X0, 1], [r.X1, -1]]) {
      const bar = r.items.find((i) => i.t === 'barra');
      for (let z = r.Z0 + 2.7; z + 2.4 < r.Z1 - 0.3; z += 2.6) {
        if (bar && nx < 0 && z + 2.4 > bar.z0 - 0.3 && z < bar.z1 + 0.3) continue;
        const col = doors[k++ % doors.length];
        const e = 0.02 * nx;
        const za = z;
        const zb = z + 2.4;
        // Zócalo de color hasta 0.9 m.
        W.quad([x + e, y0, za], [x + e, y0, zb], [x + e, y0 + 0.9, zb], [x + e, y0 + 0.9, za], [nx, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], col.map((v) => v * 0.9 + 0.05));
        // Puerta de madera de dos hojas y ventana con postigos.
        wood.box(Math.min(x + e, x + e + nx * 0.06), Math.max(x + e, x + e + nx * 0.06), y0, y0 + 2.2, za + 0.25, za + 1.15, col, 1, 'y-');
        wood.box(Math.min(x + e, x + e + nx * 0.05), Math.max(x + e, x + e + nx * 0.05), y0 + 1.1, y0 + 1.9, za + 1.45, za + 2.15, col.map((v) => v * 0.85), 1, '');
        glow.quad([x + e * 3.5, y0 + 1.2, za + 1.55], [x + e * 3.5, y0 + 1.2, za + 2.05], [x + e * 3.5, y0 + 1.8, za + 2.05], [x + e * 3.5, y0 + 1.8, za + 1.55], [nx, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [1.2, 0.85, 0.45]);
        // Balcón de madera con chambrana (arriba, no estorba).
        const by = y0 + Math.min(2.6, H - 1.4);
        wood.box(Math.min(x, x + nx * 0.65), Math.max(x, x + nx * 0.65), by - 0.08, by, za + 0.2, zb - 0.2, [0.45, 0.28, 0.15], 1, '');
        for (let zz = za + 0.25; zz < zb - 0.2; zz += 0.18) wood.box(Math.min(x + nx * 0.6, x + nx * 0.64), Math.max(x + nx * 0.6, x + nx * 0.64), by, by + 0.75, zz, zz + 0.04, col, 1, 'y-');
        wood.box(Math.min(x + nx * 0.58, x + nx * 0.66), Math.max(x + nx * 0.58, x + nx * 0.66), by + 0.75, by + 0.8, za + 0.2, zb - 0.2, col, 1, '');
        // Alero de teja.
        this.acc('ladrillo').box(Math.min(x, x + nx * 0.5), Math.max(x, x + nx * 0.5), y0 + H - 0.5, y0 + H - 0.4, za, zb, [0.85, 0.5, 0.35], 2, '');
        // Colgados: sombrero aguadeño, carriel y ruana (alternados).
        const hx = x + nx * 0.08;
        const hz = za + 1.3;
        const hy = y0 + 2.45;
        if (k % 3 === 0) {
          this.acc('plastico').cyl(hx + nx * 0.06, hy, hz, 0.11, 0.12, 0.13, [0.92, 0.88, 0.75], 14);
          this.acc('plastico').cyl(hx + nx * 0.06, hy, hz, 0.24, 0.24, 0.015, [0.92, 0.88, 0.75], 18);
          this.acc('plastico').cyl(hx + nx * 0.06, hy + 0.015, hz, 0.122, 0.122, 0.03, [0.1, 0.1, 0.1], 14, true);
        } else if (k % 3 === 1) {
          this.acc('cuero').box(Math.min(hx, hx + nx * 0.1), Math.max(hx, hx + nx * 0.1), hy - 0.3, hy, hz - 0.15, hz + 0.15, [0.45, 0.28, 0.14], 1, '');
          this.acc('metal').cyl(hx + nx * 0.06, hy - 0.15, hz, 0.03, 0.03, 0.005, [0.8, 0.7, 0.3], 8);
        } else {
          const g = new THREE.PlaneGeometry(0.8, 1.0, 1, 1);
          g.rotateY(nx > 0 ? Math.PI / 2 : -Math.PI / 2);
          M2.makeTranslation(hx + nx * 0.03, hy - 0.5, hz);
          this.acc('terciopelo').geom(g, M2, [0.9, 1.1, 1.0]);
          g.dispose();
        }
      }
    }
  }

  /** Guirnaldas de bombillos de lado a lado del techo (catenarias). */
  _garlands(it) {
    const r = this.r;
    const glow = this.acc('glow');
    const cols = [[2.4, 1.6, 0.6], [2.4, 0.5, 0.4], [0.6, 2.0, 0.7], [0.6, 1.0, 2.4], [2.4, 2.1, 0.5]];
    let k = 0;
    for (let z = r.Z0 + 1.5; z < r.Z1 - 1; z += 1.8) {
      for (let s = 0; s <= 14; s++) {
        const t = s / 14;
        const x = r.X0 + 0.2 + (r.X1 - r.X0 - 0.4) * t;
        const y = it.y - Math.sin(t * Math.PI) * 0.55;
        glow.sphere(x, y, z, 0.045, cols[k++ % cols.length], 6);
      }
      this._wire(r.X0 + 0.2, r.X1 - 0.2, z, it.y);
    }
  }

  _wire(xa, xb, z, y) {
    const metal = this.acc('metal');
    for (let s = 0; s < 14; s++) {
      const t0 = s / 14;
      const t1 = (s + 1) / 14;
      const xa0 = xa + (xb - xa) * t0;
      const xb0 = xa + (xb - xa) * t1;
      const ya = y - Math.sin(t0 * Math.PI) * 0.55 + 0.04;
      const yb = y - Math.sin(t1 * Math.PI) * 0.55 + 0.04;
      metal.quad([xa0, ya, z], [xb0, yb, z], [xb0, yb + 0.01, z], [xa0, ya + 0.01, z], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.05, 0.05, 0.05]);
    }
  }

  /** Fotos enmarcadas (son cubano) y el tres y las maracas colgados. */
  _photos() {
    const r = this.r;
    const P = this.acc('fotos');
    const y = r.y0 + 1.6;
    let k = 0;
    for (const [x, nx] of [[r.X0, 1], [r.X1, -1]]) {
      for (let z = r.Z0 + 3.0; z < r.Z1 - 2.0; z += 1.9) {
        const bar = r.items.find((i) => i.t === 'barra');
        if (bar && (nx > 0 ? bar.x0 < r.X0 + 2.5 : bar.x1 > r.X1 - 2.5) && z > bar.z0 - 0.4 && z < bar.z1 + 0.4) continue;
        const u0 = (k % 4) / 4;
        const e = 0.015 * nx;
        P.quad([x + e, y, z - 0.38], [x + e, y, z + 0.38], [x + e, y + 0.6, z + 0.38], [x + e, y + 0.6, z - 0.38], [nx, 0, 0], nx < 0 ? [[u0, 0], [u0 + 0.25, 0], [u0 + 0.25, 1], [u0, 1]] : [[u0 + 0.25, 0], [u0, 0], [u0, 1], [u0 + 0.25, 1]], [1, 1, 1]);
        k++;
        if (k % 3 === 0) this._tres(this.acc('madera'), x + nx * 0.06, y + 1.05, z + 0.9, 0.5);
        if (k % 3 === 1) {
          for (const s of [-0.08, 0.08]) {
            this.acc('plastico').sphere(x + nx * 0.08, y + 1.1, z + 0.9 + s, 0.06, [0.85, 0.5, 0.15], 8);
            this.acc('madera').cyl(x + nx * 0.08, y + 0.85, z + 0.9 + s, 0.012, 0.012, 0.22, [0.5, 0.3, 0.15], 5);
          }
        }
      }
    }
  }

  _tv(it) {
    const mat = tvMaterial();
    this.shaders.push(mat);
    const g = new THREE.PlaneGeometry(1.15, 0.66);
    const mesh = new THREE.Mesh(g, mat);
    const nx = it.face;
    mesh.position.set(it.x + nx * 0.1, it.y, it.z);
    mesh.rotation.y = nx > 0 ? Math.PI / 2 : -Math.PI / 2;
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    mesh.name = 'interior-tv';
    this.group.add(mesh);
    this.acc('metal').box(Math.min(it.x, it.x + nx * 0.09), Math.max(it.x, it.x + nx * 0.09), it.y - 0.38, it.y + 0.38, it.z - 0.62, it.z + 0.62, [0.04, 0.04, 0.04], 1, '');
    (this._tvs ??= []).push([it.x + nx * 0.6, it.y, it.z]);
  }

  /** Avisos de neón genéricos de cerveza (sin marca) en los muros del bar de esquina. */
  _beerNeons() {
    const r = this.r;
    const cols = ['#ff3b3b', '#36c9ff', '#ffd23f', '#5bff6a'];
    const spots = [[r.X0 + 0.02, r.Z0 + 3.0, 1], [r.X1 - 0.02, r.Z0 + 4.5, -1], [r.X0 + 0.02, r.Z1 - 4.2, 1], [r.X1 - 0.02, r.Z1 - 3.0, -1]];
    spots.forEach(([x, z, nx], k) => {
      const tex = TX.neonTex(TX.NEONES_BAR[k % TX.NEONES_BAR.length], cols[k % cols.length]);
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.2, 2.2, 2.2), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
      const g = new THREE.PlaneGeometry(1.3, 0.4);
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set(x + nx * 0.02, r.y0 + 2.3, z);
      mesh.rotation.y = nx > 0 ? Math.PI / 2 : -Math.PI / 2;
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      mesh.name = 'interior-neon';
      mesh.renderOrder = 2;
      this.group.add(mesh);
      (this._neons ??= []).push({ x: x + nx * 0.8, y: r.y0 + 2.3, z, c: new THREE.Color(cols[k % cols.length]) });
    });
  }

  _chiva(it) {
    const C_ = this.acc('chiva');
    const metal = this.acc('metal');
    const glow = this.acc('glow');
    const { x0, x1, z0, z1, y } = it;
    const h = it.h;
    // Carrocería pintada, capó y parachoques; parabrisas oscuro; techo con parrilla y maletas.
    C_.box(x0, x1, y + 0.45, y + h - 0.6, z0, z1 - 0.45, [1, 1, 1], 0.6, 'y-');
    C_.box(x0 + 0.5, x1 - 0.5, y + 0.45, y + 1.35, z1 - 0.45, z1, [1, 1, 1], 0.6, 'y-');
    metal.box(x0 + 0.3, x1 - 0.3, y + 0.25, y + 0.5, z1 - 0.08, z1 + 0.06, [0.85, 0.85, 0.88], 1, '');
    metal.box(x0 + 0.15, x1 - 0.15, y + 1.55, y + h - 0.85, z1 - 0.44, z1 - 0.43, [0.05, 0.07, 0.09], 1, '');
    metal.box(x0, x1, y + h - 0.6, y + h - 0.55, z0, z1 - 0.45, [0.2, 0.2, 0.2], 1, '');
    for (let x = x0 + 0.1; x < x1; x += 0.35) metal.box(x, x + 0.03, y + h - 0.55, y + h - 0.3, z0 + 0.1, z1 - 0.5, [0.25, 0.25, 0.25], 1, 'y-');
    const lug = [[0.6, 0.2, 0.1], [0.2, 0.4, 0.6], [0.7, 0.6, 0.2]];
    for (let k = 0; k < 4; k++) this.acc('plastico').box(x0 + 0.3 + k * 0.95, x0 + 1.05 + k * 0.95, y + h - 0.55, y + h - 0.2 - (k % 2) * 0.1, z0 + 0.2, z1 - 0.7, lug[k % 3], 1, 'y-');
    // Farolas y luces del bómper.
    for (const s of [-1, 1]) {
      const cx = (x0 + x1) / 2 + s * ((x1 - x0) / 2 - 0.75);
      glow.cyl(cx, y + 1.0, z1 + 0.005, 0.13, 0.13, 0.02, [2.6, 2.4, 1.8], 14);
      const g = new THREE.CylinderGeometry(0.13, 0.13, 0.03, 14);
      g.rotateX(Math.PI / 2);
      M2.makeTranslation(cx, y + 1.0, z1 + 0.01);
      glow.geom(g, M2, [2.6, 2.4, 1.8]);
      g.dispose();
    }
    // Ruedas delanteras asomadas.
    for (const s of [-1, 1]) {
      const g = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 16);
      g.rotateZ(Math.PI / 2);
      M2.makeTranslation((x0 + x1) / 2 + s * ((x1 - x0) / 2 - 0.2), y + 0.42, z1 - 0.9);
      metal.geom(g, M2, [0.06, 0.06, 0.06]);
      g.dispose();
    }
    (this._chivaL = { x: (x0 + x1) / 2, y: y + 1.0, z: z1 + 1.2 });
  }

  _jukebox(it) {
    const metal = this.acc('metal');
    const glow = this.acc('glow');
    const { x0, x1, z0, z1, y, h } = it;
    const alongZ = it.eje === 'x'; // pegada al muro izquierdo: mira a +x
    metal.box(x0, x1, y, y + h - 0.35, z0, z1, [0.5, 0.15, 0.1], 1, 'y-');
    // Corona redondeada.
    const g = new THREE.CylinderGeometry(alongZ ? (z1 - z0) / 2 : (x1 - x0) / 2, alongZ ? (z1 - z0) / 2 : (x1 - x0) / 2, alongZ ? x1 - x0 : z1 - z0, 18, 1, false, 0, Math.PI);
    if (alongZ) g.rotateZ(Math.PI / 2);
    else g.rotateX(Math.PI / 2).rotateZ(Math.PI / 2);
    M2.makeTranslation((x0 + x1) / 2, y + h - 0.35, (z0 + z1) / 2);
    glow.geom(g, M2, [2.2, 1.0, 0.4]);
    g.dispose();
    // Frente: tubos de colores y el panel de canciones.
    const cols = [[2.4, 0.4, 0.3], [0.4, 1.6, 2.4], [2.4, 2.0, 0.4], [0.5, 2.2, 0.6]];
    if (alongZ) {
      const x = x1 + 0.005;
      for (let k = 0; k < 4; k++) glow.quad([x, y + 0.2 + k * 0.25, z0 + 0.06], [x, y + 0.2 + k * 0.25, z1 - 0.06], [x, y + 0.36 + k * 0.25, z1 - 0.06], [x, y + 0.36 + k * 0.25, z0 + 0.06], [1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], cols[k]);
    } else {
      const z = z1 + 0.005;
      for (let k = 0; k < 4; k++) glow.quad([x0 + 0.06, y + 0.2 + k * 0.25, z], [x1 - 0.06, y + 0.2 + k * 0.25, z], [x1 - 0.06, y + 0.36 + k * 0.25, z], [x0 + 0.06, y + 0.36 + k * 0.25, z], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], cols[k]);
    }
    (this._juke = { x: (x0 + x1) / 2 + (alongZ ? 0.8 : 0), y: y + 1.0, z: (z0 + z1) / 2 + (alongZ ? 0 : 0.8) });
  }

  _pool(it) {
    const wood = this.acc('mesa');
    const metal = this.acc('metal');
    const { x0, x1, z0, z1, y, h } = it;
    wood.box(x0, x1, y + h - 0.2, y + h - 0.04, z0, z1, [0.45, 0.25, 0.12], 1, 'y-');
    // Paño verde y bandas.
    this.acc('plastico').box(x0 + 0.1, x1 - 0.1, y + h - 0.04, y + h - 0.035, z0 + 0.1, z1 - 0.1, [0.05, 0.45, 0.2], 1, 'y-');
    for (const [a, b, c, d] of [[x0, x1, z0, z0 + 0.1], [x0, x1, z1 - 0.1, z1], [x0, x0 + 0.1, z0, z1], [x1 - 0.1, x1, z0, z1]]) wood.box(a, b, y + h - 0.04, y + h + 0.03, c, d, [0.4, 0.22, 0.1], 1, 'y-');
    for (const [sx, sz] of [[x0 + 0.12, z0 + 0.12], [x1 - 0.12, z0 + 0.12], [x0 + 0.12, z1 - 0.12], [x1 - 0.12, z1 - 0.12]]) wood.box(sx - 0.07, sx + 0.07, y, y + h - 0.2, sz - 0.07, sz + 0.07, [0.35, 0.2, 0.1], 1, 'y-');
    const cols = [[0.9, 0.85, 0.1], [0.1, 0.2, 0.8], [0.8, 0.1, 0.1], [0.4, 0.1, 0.5], [0.9, 0.4, 0.05], [0.05, 0.4, 0.15], [0.5, 0.15, 0.05], [0.05, 0.05, 0.05], [0.95, 0.95, 0.9]];
    cols.forEach((c, k) => this.acc('plastico').sphere(x0 + 0.35 + (k % 3) * 0.12 + (k > 7 ? 0.25 : 0), y + h + 0.0, z0 + 0.6 + Math.floor(k / 3) * 0.11 + (k > 7 ? 0.9 : 0), 0.028, c, 8));
    // Lámpara colgante sobre la mesa.
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    metal.box(cx - 0.25, cx + 0.25, this.r.y0 + this.r.H - 0.85, this.r.y0 + this.r.H - 0.75, cz - 0.7, cz + 0.7, [0.08, 0.35, 0.18], 1, '');
    this.acc('glow').box(cx - 0.22, cx + 0.22, this.r.y0 + this.r.H - 0.86, this.r.y0 + this.r.H - 0.85, cz - 0.65, cz + 0.65, [2.4, 2.2, 1.7], 1, 'y+');
    metal.cyl(cx, this.r.y0 + this.r.H - 0.75, cz, 0.006, 0.006, 0.75, [0.2, 0.2, 0.2], 4);
    (this._poolL = { x: cx, y: this.r.y0 + this.r.H - 1.0, z: cz });
    // Tacos en su soporte, en el muro.
    for (let k = 0; k < 4; k++) metal.box(this.r.X1 - 0.05, this.r.X1 - 0.02, this.r.y0 + 0.3, this.r.y0 + 1.75, this.r.Z0 + 6.5 + k * 0.12, this.r.Z0 + 6.52 + k * 0.12, [0.6, 0.4, 0.2], 1, '');
  }

  _plant(x, z, y) {
    this.acc('plastico').cyl(x, y, z, 0.3, 0.22, 0.5, [0.55, 0.3, 0.18], 14);
    this.acc('plastico').cyl(x, y + 0.48, z, 0.27, 0.27, 0.02, [0.18, 0.12, 0.08], 14);
    const leaf = new THREE.PlaneGeometry(0.9, 1.3);
    leaf.translate(0, 0.65, 0);
    for (let k = 0; k < 7; k++) {
      Q.setFromEuler(E.set(-0.45 - (k % 3) * 0.12, (k * Math.PI * 2) / 7, 0, 'YXZ'));
      M2.compose(tmpV.set(x, y + 0.5, z), Q, S1);
      this.acc('hojas').geom(leaf, M2, [0.8, 1, 0.8]);
    }
    leaf.dispose();
  }

  _decor() {
    // (Lo que no es de un mueble: hoy nada aparte; los temas lo ponen en sus items.)
  }

  // -------------------------------------------------------------- luz horneada
  _fakeLights() {
    const r = this.r;
    const A = this.A;
    const L = [];
    const add = (x, y, z, c, rad, i) => L.push({ x, y, z, c, r: rad, i });
    for (const it of r.items) {
      const cx = (it.x0 + it.x1) / 2;
      const cz = (it.z0 + it.z1) / 2;
      if (it.t === 'barra') {
        const alongX = it.x1 - it.x0 > it.z1 - it.z0;
        const len = alongX ? it.x1 - it.x0 : it.z1 - it.z0;
        const n = Math.max(1, Math.round(len / 2.5));
        const col = it.luz === 'cian' ? [0.2, 0.9, 1] : it.luz === 'azul' ? [0.35, 0.75, 1] : it.luz === 'fría' ? [0.85, 0.95, 1] : A.barra;
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          if (alongX) add(it.x0 + len * t, it.y + 0.6, it.face > 0 ? it.z1 + 0.6 : it.z0 - 0.6, col, 4.5, 1.1);
          else add(it.face > 0 ? it.x1 + 0.6 : it.x0 - 0.6, it.y + 0.6, it.z0 + len * t, col, 4.5, 1.1);
        }
      } else if (it.t === 'estante') {
        add(cx, it.y + 1.8, cz, A.barra, 3.6, 1.0);
      } else if (it.t === 'pista') {
        const k = it.kind === 'led' || it.kind === 'hielo' ? 1.3 : 0.4;
        const cols = A.acentos;
        add((it.x0 + it.x1) / 2, it.y + 0.4, (it.z0 + it.z1) / 2, cols[0], Math.max(it.x1 - it.x0, it.z1 - it.z0) * 0.9, k);
        add(it.x0 + (it.x1 - it.x0) * 0.25, it.y + 0.4, it.z0 + (it.z1 - it.z0) * 0.3, cols[1], 5, k * 0.7);
        add(it.x0 + (it.x1 - it.x0) * 0.75, it.y + 0.4, it.z0 + (it.z1 - it.z0) * 0.7, cols[2], 5, k * 0.7);
      } else if (it.t === 'pantalla') {
        add((it.x0 + it.x1) / 2, (it.y0 + it.y1) / 2, it.z + 1.5, A.acentos[0], 10, 1.4);
      } else if (it.t === 'cabina') {
        add(cx, it.y + it.h + 0.3, cz, A.acentos[1], 2.5, 0.8);
      } else if (it.t === 'plataforma') {
        add(it.cx, it.y + 0.4, it.cz, [0.4, 0.8, 1.2], 3, 1.2);
      } else if (it.t === 'chiva') {
        add(cx, it.y + 1.0, it.z1 + 0.8, [1, 0.9, 0.7], 5, 1.0);
      } else if (it.t === 'rockola') {
        add(cx, it.y + 1.0, cz, [1, 0.5, 0.3], 3.2, 1.2);
      } else if (it.t === 'nevera') {
        add(cx, it.y + 1.0, it.z1 + 0.4, [0.7, 0.85, 1], 2.4, 0.9);
      } else if (it.t === 'billar') {
        add(cx, r.y0 + r.H - 1.0, cz, [1, 0.95, 0.8], 3.2, 1.4);
      } else if (it.t === 'tv') {
        add(it.x + it.face * 0.6, it.y, it.z, [0.5, 0.8, 1], 3, 0.7);
      } else if (it.t === 'bola') {
        add(it.x, it.y, it.z, [1, 0.9, 0.8], 5, 0.4);
      } else if (it.t === 'guirnaldas') {
        for (let z = r.Z0 + 1.5; z < r.Z1 - 1; z += 3.6) add(0, it.y - 0.4, z, [1, 0.8, 0.5], 4.5, 0.75);
      } else if (it.t === 'banos') {
        add(cx, it.y + 2.3, cz, [0.9, 0.9, 1], 3, 0.4);
      } else if (it.t === 'columna') {
        add(cx, it.y + it.h / 2, cz, A.acentos[0], 2.2, 0.6);
      }
    }
    if (this.A.neones) for (const n of this._neons ?? []) add(n.x, n.y, n.z, [n.c.r, n.c.g, n.c.b], 3.2, 1.0);
    // Luz general de techo (tubos o luz de relleno del tema).
    const fill = A.tubos ? 0.75 : 0.32;
    const fc = A.tubos ? [1, 1, 0.95] : A.acentos[2];
    for (let z = r.Z0 + 2; z < r.Z1; z += 4) for (let x = r.X0 + 2; x < r.X1; x += 4) add(x, r.y0 + r.H - 0.3, z, fc, 6, fill);
    if (r.mezz) for (let x = r.mezz.x0 + 1.5; x < r.mezz.x1 - 1; x += 2.2) add(x, r.mezz.y - 0.4, (r.mezz.z0 + r.mezz.z1) / 2, [1, 0.9, 0.75], 3.2, 0.7);
    if (r.shaft) add(0, r.floorY + 2.4, (r.shaft.z0 + r.Z1) / 2, [1, 0.6, 0.35], 4, 1.0);
    // Dónde van las luces reales prestadas: sobre la pista y sobre la barra.
    const p = r.pista;
    if (p) this.lightSpots.push({ x: (p.x0 + p.x1) / 2, y: r.y0 + r.H - 0.8, z: (p.z0 + p.z1) / 2, c: A.acentos[0], i: 6, d: 14 });
    const b = r.items.find((i) => i.t === 'barra');
    if (b) this.lightSpots.push({ x: (b.x0 + b.x1) / 2 + (b.x1 - b.x0 > b.z1 - b.z0 ? 0 : b.face * 1.2), y: r.y0 + Math.min(2.6, r.H - 0.4), z: (b.z0 + b.z1) / 2 + (b.x1 - b.x0 > b.z1 - b.z0 ? b.face * 1.2 : 0), c: A.barra, i: 4, d: 8 });
    if (!p && !b) this.lightSpots.push({ x: 0, y: r.y0 + r.H - 0.6, z: (r.Z0 + r.Z1) / 2, c: [1, 0.9, 0.8], i: 4, d: 10 });
    return L;
  }

  // -------------------------------------------------------------- efectos
  _fx() {
    const r = this.r;
    const A = this.A;
    const rng = this.rng;
    const add = (o) => {
      o.matrixAutoUpdate = false;
      o.frustumCulled = false;
      this.group.add(o);
      return o;
    };
    // Botellas instanciadas de la estantería.
    if (this._bottles?.length) {
      const g = bottleGeometry();
      // (Contraluz: el color de cada botella brilla con la luz de la estantería.)
      const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.5, 1.5) });
      const mesh = new THREE.InstancedMesh(g, mat, this._bottles.length);
      this._bottles.forEach((b, k) => {
        M.compose(tmpV.set(b.p[0], b.p[1], b.p[2]), Q.identity(), new THREE.Vector3(b.s, b.s, b.s));
        mesh.setMatrixAt(k, M);
        mesh.setColorAt(k, new THREE.Color(...b.c));
      });
      mesh.name = 'interior-botellas';
      mesh.computeBoundingSphere();
      add(mesh).frustumCulled = true;
    }
    // Haces de luz (conos aditivos que barren la pista desde el truss).
    const heads = this._heads ?? [];
    if (A.haces && heads.length) {
      const n = Math.min(INTERIOR_FX.HACES, heads.length);
      const g = beamGeometry(r.H * 1.15, 0.9);
      const mesh = new THREE.InstancedMesh(g, this.mats.aditivo, n);
      mesh.name = 'interior-haces';
      const beams = [];
      for (let k = 0; k < n; k++) {
        const h = heads[Math.floor((k * heads.length) / n)];
        beams.push({ p: h, ph: rng.range(0, 10), sp: rng.range(0.25, 0.6), c: new THREE.Color(...A.acentos[k % 3]) });
        mesh.setColorAt(k, beams[k].c.clone().multiplyScalar(0.22));
      }
      add(mesh);
      const p = r.pista ?? { x0: -2, x1: 2, z0: r.Z0 + 3, z1: r.Z0 + 7, y: r.y0 };
      const dir = new THREE.Vector3();
      const up = new THREE.Vector3(0, -1, 0);
      this.anim.push((dt, t) => {
        for (let k = 0; k < n; k++) {
          const b = beams[k];
          const tx = (p.x0 + p.x1) / 2 + Math.sin(t * b.sp + b.ph) * (p.x1 - p.x0) * 0.6;
          const tz = (p.z0 + p.z1) / 2 + Math.cos(t * b.sp * 1.3 + b.ph * 2) * (p.z1 - p.z0) * 0.6;
          dir.set(tx - b.p[0], p.y - b.p[1], tz - b.p[2]).normalize();
          Q.setFromUnitVectors(up, dir);
          M.compose(tmpV.set(b.p[0], b.p[1], b.p[2]), Q, S1);
          mesh.setMatrixAt(k, M);
        }
        mesh.instanceMatrix.needsUpdate = true;
        // Cambio de color cada tanto (a la par de la pista).
        if (Math.floor(t / 8) !== this._beamSeg) {
          this._beamSeg = Math.floor(t / 8);
          for (let k = 0; k < n; k++) mesh.setColorAt(k, tmpC.setRGB(...A.acentos[(k + this._beamSeg) % 3]).multiplyScalar(0.22));
          mesh.instanceColor.needsUpdate = true;
        }
      });
    }
    // Láseres: abanico que barre desde la cabina.
    if (A.laser && r.cabina) {
      const n = Math.min(INTERIOR_FX.LASERES, A.laser);
      const len = Math.hypot(r.W, r.D) * 0.9;
      const g = white(new THREE.BoxGeometry(0.014, 0.014, len));
      g.translate(0, 0, len / 2);
      const mesh = new THREE.InstancedMesh(g, this.mats.aditivo, n);
      mesh.name = 'interior-laseres';
      const col = r.tema === 'electrónica' ? [0.2, 1.6, 0.3] : r.tema === 'hielo' ? [0.3, 0.6, 1.8] : [1.4, 0.2, 1.2];
      for (let k = 0; k < n; k++) mesh.setColorAt(k, tmpC.setRGB(...col));
      add(mesh);
      const t0 = r.items.find((i) => i.t === 'tarima');
      const src = [(t0 ? (t0.x0 + t0.x1) / 2 : 0), r.y0 + r.H - 0.5, (t0 ? t0.z0 : r.Z0) + 0.3];
      this.anim.push((dt, t) => {
        const on = Math.sin(t * 0.21) > -0.2;
        for (let k = 0; k < n; k++) {
          const a = (k / (n - 1 || 1) - 0.5) * 1.3 + Math.sin(t * 0.9) * 0.45;
          E.set(0.18 + 0.12 * Math.sin(t * 1.7 + k), a, 0, 'YXZ');
          Q.setFromEuler(E);
          M.compose(tmpV.set(src[0], src[1], src[2]), Q, on ? S1 : ZERO);
          mesh.setMatrixAt(k, M);
        }
        mesh.instanceMatrix.needsUpdate = true;
      });
    }
    // Bola de espejos: gira y riega puntos de luz por muros, piso y techo.
    if (this._ball) {
      const n = INTERIOR_FX.PUNTOS_BOLA;
      const g = white(new THREE.CircleGeometry(0.06, 8));
      const mesh = new THREE.InstancedMesh(g, this.mats.aditivo, n);
      mesh.name = 'interior-puntos';
      for (let k = 0; k < n; k++) mesh.setColorAt(k, tmpC.setRGB(0.9, 0.85, 0.75));
      add(mesh);
      const dirs = [];
      for (let k = 0; k < n; k++) {
        const y = rng.range(-0.75, 0.35);
        const a = rng.range(0, Math.PI * 2);
        dirs.push([a, y]);
      }
      const B = this._ball;
      const nrm = new THREE.Vector3();
      const zAxis = new THREE.Vector3(0, 0, 1);
      this.anim.push((dt, t) => {
        B.mesh.rotation.y = t * 0.5;
        B.mesh.updateMatrix();
        for (let k = 0; k < n; k++) {
          const [a0, y] = dirs[k];
          const a = a0 + t * 0.5;
          const c = Math.sqrt(1 - y * y);
          const dx = Math.sin(a) * c;
          const dz = Math.cos(a) * c;
          // Choque del rayo con la caja del salón.
          let tt = Infinity;
          if (dx > 1e-4) tt = Math.min(tt, (r.X1 - 0.01 - B.x) / dx);
          if (dx < -1e-4) tt = Math.min(tt, (r.X0 + 0.01 - B.x) / dx);
          if (dz > 1e-4) tt = Math.min(tt, (r.Z1 - 0.01 - B.z) / dz);
          if (dz < -1e-4) tt = Math.min(tt, (r.Z0 + 0.01 - B.z) / dz);
          if (y < -1e-4) tt = Math.min(tt, (r.y0 + 0.01 - B.y) / y);
          if (y > 1e-4) tt = Math.min(tt, (r.y0 + r.H - 0.01 - B.y) / y);
          const px = B.x + dx * tt;
          const py = B.y + y * tt;
          const pz = B.z + dz * tt;
          // Orientado según la cara que toca.
          if (Math.abs(py - r.y0) < 0.05) nrm.set(0, 1, 0);
          else if (Math.abs(py - r.y0 - r.H) < 0.05) nrm.set(0, -1, 0);
          else if (Math.abs(px - r.X0) < 0.05) nrm.set(1, 0, 0);
          else if (Math.abs(px - r.X1) < 0.05) nrm.set(-1, 0, 0);
          else if (Math.abs(pz - r.Z0) < 0.05) nrm.set(0, 0, 1);
          else nrm.set(0, 0, -1);
          Q.setFromUnitVectors(zAxis, nrm);
          const s = 0.7 + 0.25 * tt;
          M.compose(tmpV.set(px, py, pz), Q, tmpS.set(s, s, s));
          mesh.setMatrixAt(k, M);
        }
        mesh.instanceMatrix.needsUpdate = true;
      });
    }
    // Bengalas en las botellas de las mesas VIP: chispas que titilan.
    if (this._bengalas?.length) {
      const per = INTERIOR_FX.CHISPAS;
      const n = this._bengalas.length * per;
      const g = white(new THREE.OctahedronGeometry(0.018, 0));
      const mesh = new THREE.InstancedMesh(g, this.mats.aditivo, n);
      mesh.name = 'interior-bengalas';
      for (let k = 0; k < n; k++) mesh.setColorAt(k, tmpC.setRGB(3, 2.2, 1.2));
      add(mesh);
      const sp = [];
      for (let k = 0; k < n; k++) sp.push([rng.range(0, 1), rng.range(0.6, 1.4), rng.range(0, Math.PI * 2)]);
      this.anim.push((dt, t) => {
        let k = 0;
        for (const b of this._bengalas)
          for (let j = 0; j < per; j++, k++) {
            const [ph, v, a] = sp[k];
            const life = (t * v + ph) % 1;
            const rr = life * 0.22;
            M.compose(tmpV.set(b[0] + Math.sin(a + t) * rr, b[1] + life * 0.18 - life * life * 0.25, b[2] + Math.cos(a + t) * rr), Q.identity(), tmpS.setScalar(1.2 - life));
            mesh.setMatrixAt(k, M);
          }
        mesh.instanceMatrix.needsUpdate = true;
      });
    }
    // Neblina: planos aditivos que se corren despacio.
    if (A.humo) {
      const tex = TX.humoTex().clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(2, 3);
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(...A.acentos[0]).multiplyScalar(0.18), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      this._hazeMat = mat;
      const p = r.pista ?? { x0: r.X0, x1: r.X1, z0: r.Z0, z1: r.Z1 };
      for (let k = 0; k < INTERIOR_FX.NEBLINA; k++) {
        const g = new THREE.PlaneGeometry(r.W - 1, (p.z1 - p.z0) + 4);
        g.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(g, mat);
        m.position.set(0, r.y0 + 1.4 + k * ((r.H - 2.2) / INTERIOR_FX.NEBLINA), (p.z0 + p.z1) / 2);
        m.updateMatrix();
        m.name = 'interior-neblina';
        m.renderOrder = 3;
        add(m);
      }
      this.anim.push((dt, t) => {
        tex.offset.set(t * 0.012, t * 0.02);
        mat.color.setRGB(...A.acentos[Math.floor(t / 8) % 3]).multiplyScalar(0.16);
      });
    }
    // Cañones de humo (frío): chorros que suben cada tanto.
    if (this._humos?.length) {
      const per = 14;
      const n = this._humos.length * per;
      const g = new THREE.PlaneGeometry(0.7, 0.7);
      const tex = TX.humoTex();
      const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.45, 0.6, 0.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const mesh = new THREE.InstancedMesh(g, mat, n);
      mesh.name = 'interior-chorros';
      add(mesh);
      this.anim.push((dt, t, ctx) => {
        const burst = t % 18;
        let k = 0;
        for (const h of this._humos)
          for (let j = 0; j < per; j++, k++) {
            const life = burst - j * 0.08;
            const on = life > 0 && life < 2.6;
            const y = on ? life * 2.6 : 0;
            const s = on ? 0.4 + life * 0.9 : 0;
            Q.setFromEuler(E.set(0, ctx.camYaw ?? 0, 0));
            M.compose(tmpV.set(h[0] + Math.sin(j) * life * 0.15, h[1] + y, h[2]), Q, tmpS.setScalar(s));
            mesh.setMatrixAt(k, M);
          }
        mesh.instanceMatrix.needsUpdate = true;
      });
    }
    // Ventiladores de techo (giran).
    for (const f of this._fans ?? []) {
      const g = white(new THREE.BoxGeometry(1.2, 0.015, 0.16), 0.55);
      const g2 = g.clone().rotateY(Math.PI / 2);
      const mat = this.mats.mesa;
      const a = new THREE.Mesh(g, mat);
      const b = new THREE.Mesh(g2, mat);
      const fan = new THREE.Group();
      fan.add(a, b);
      fan.position.set(f.x, f.y - 0.45, f.z);
      fan.name = 'interior-ventilador';
      this.group.add(fan);
      this.anim.push((dt) => {
        fan.rotation.y += dt * 4.5;
        fan.updateMatrix();
        fan.updateMatrixWorld(true);
      });
    }
    // Shaders animados (pista, pantalla, TV).
    this.anim.push((dt, t) => {
      for (const s of this.shaders) s.uniforms.uTime.value = t;
    });
  }

  /** Anima (solo con el jugador cerca). ctx: {inside, camYaw, strobe}. */
  update(dt, ctx = {}) {
    if (!this.ready) return;
    this.t += dt;
    const t = this.t;
    for (const f of this.anim) f(dt, t, ctx);
    // Lavado de color (lento) y estrobo suave en ráfagas.
    const cyc = this.A.ciclo;
    const s = (t / 9) % cyc.length;
    const i0 = Math.floor(s);
    const f = s - i0;
    const a = cyc[i0];
    const b = cyc[(i0 + 1) % cyc.length];
    let k = 1;
    if (INTERIOR_FX.ESTROBO && this.A.estrobo && ctx.strobe !== false) {
      const w = t % INTERIOR_FX.ESTROBO_CADA;
      if (w < INTERIOR_FX.ESTROBO_DURA) {
        const ph = (w * INTERIOR_FX.ESTROBO_HZ) % 1;
        k += ph < 0.12 ? INTERIOR_FX.ESTROBO_FUERZA * (1 - ph / 0.12) : 0;
      }
    }
    this.strobe = k - 1;
    this.mats.amb.value.setRGB((a[0] + (b[0] - a[0]) * f) * k, (a[1] + (b[1] - a[1]) * f) * k, (a[2] + (b[2] - a[2]) * f) * k);
    this.group.updateMatrixWorld(true);
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.isInstancedMesh) o.dispose();
    });
    for (const s of this.shaders) s.dispose();
    this._hazeMat?.map?.dispose();
    this._hazeMat?.dispose();
    // (Los materiales base no se liberan: sus programas quedan para el próximo interior.)
  }
}

const ZERO = new THREE.Vector3(0, 0, 0);
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const BOTTLE_COLORS = [[0.12, 0.45, 0.2], [0.55, 0.28, 0.08], [0.75, 0.85, 0.95], [0.85, 0.75, 0.25], [0.6, 0.08, 0.1], [0.9, 0.9, 0.9], [0.2, 0.3, 0.6], [0.65, 0.5, 0.35]];

function rectMinusLocal(a, h) {
  const out = [];
  const x0 = Math.max(a.x0, h.x0);
  const x1 = Math.min(a.x1, h.x1);
  const z0 = Math.max(a.z0, h.z0);
  const z1 = Math.min(a.z1, h.z1);
  if (x0 >= x1 || z0 >= z1) return [a];
  if (a.x0 < x0) out.push({ x0: a.x0, x1: x0, z0: a.z0, z1: a.z1 });
  if (x1 < a.x1) out.push({ x0: x1, x1: a.x1, z0: a.z0, z1: a.z1 });
  if (a.z0 < z0) out.push({ x0, x1, z0: a.z0, z1: z0 });
  if (z1 < a.z1) out.push({ x0, x1, z0: z1, z1: a.z1 });
  return out;
}

/** Atributo de color en blanco (o gris `k`) para geometrías de three con materiales de color por vértice. */
function white(g, k = 1) {
  const n = g.attributes.position.count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(k), 3));
  return g;
}

let _bottleGeo = null;
/** Botella de perfil (torno) para las instancias de la estantería. */
function bottleGeometry() {
  if (_bottleGeo) return _bottleGeo;
  const pts = [[0, 0], [0.036, 0], [0.038, 0.02], [0.038, 0.19], [0.03, 0.23], [0.013, 0.26], [0.012, 0.32], [0.014, 0.33], [0, 0.33]].map(([x, y]) => new THREE.Vector2(x, y));
  _bottleGeo = new THREE.LatheGeometry(pts, 10);
  return _bottleGeo;
}

let _beamGeo = null;
/** Cono del haz de luz: vértice en el origen, abre hacia -y; brillante en la punta, nada en la base. */
function beamGeometry(len, rad) {
  if (_beamGeo) return _beamGeo;
  const g = new THREE.CylinderGeometry(0.06, rad, len, 18, 6, true);
  g.translate(0, -len / 2, 0);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let v = 0; v < pos.count; v++) {
    const t = Math.min(1, -pos.getY(v) / len);
    const k = (1 - t) ** 1.6;
    col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  _beamGeo = g;
  return g;
}

// ------------------------------------------------------------------ frentes
/**
 * Frentes de todos los locales (siempre en escena, 5 mallas): marquesina con
 * tira LED, marco de la puerta, cordón de la fila con sus postes, hojas de
 * la puerta doble (instanciadas: se abren de noche), cortina metálica (baja
 * de día) y el vestíbulo oscuro que se ve por la puerta mientras el salón
 * no está armado.
 */
export class InteriorFronts {
  constructor(interiors) {
    this.list = interiors;
    this.group = new THREE.Group();
    this.group.name = 'frentes-locales';
    const solid = new Acc();
    const glow = new Acc();
    const vest = new Acc();
    const mat = new THREE.Matrix4();
    for (const r of interiors) {
      mat.compose(tmpV.set(r.ox, 0, r.oz), Q.setFromEuler(E.set(0, r.rot, 0)), S1);
      const a = new Acc();
      const g = new Acc();
      const v = new Acc();
      this._front(r, a, g, v);
      appendTransformed(solid, a, mat);
      appendTransformed(glow, g, mat);
      appendTransformed(vest, v, mat);
    }
    const sMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.5 });
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const add = (acc, m, name) => {
      if (!acc.count) return null;
      const mesh = new THREE.Mesh(acc.build(), m);
      mesh.name = name;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      return mesh;
    };
    add(solid, sMat, 'frentes-marquesinas');
    add(glow, this.glowMat, 'frentes-luces');
    this.vestMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    // Vestíbulos: uno por local en una malla aparte (se ocultan los de los salones armados con el índice).
    this.vest = [];
    for (const r of interiors) {
      const v = new Acc();
      this._vestibule(r, v);
      mat.compose(tmpV.set(r.ox, 0, r.oz), Q.setFromEuler(E.set(0, r.rot, 0)), S1);
      const w = new Acc();
      appendTransformed(w, v, mat);
      const mesh = add(w, this.vestMat, `vestibulo-${r.id}`);
      this.vest.push(mesh);
    }
    // Hojas de la puerta doble (2 por local) y cortinas (1 por local), instanciadas.
    const leafG = new THREE.BoxGeometry(1, 1, 0.06);
    leafG.translate(0.5, 0.5, 0);
    this.leaves = new THREE.InstancedMesh(leafG, new THREE.MeshStandardMaterial({ map: TX.cueroTex(), color: 0x2a1418, roughness: 0.5, metalness: 0.1 }), interiors.length * 2);
    this.leaves.name = 'frentes-puertas';
    const shG = new THREE.PlaneGeometry(1, 1);
    shG.translate(0, -0.5, 0);
    this.shutters = new THREE.InstancedMesh(shG, new THREE.MeshStandardMaterial({ map: TX.cortinaTex(), color: 0xb9bcc2, roughness: 0.55, metalness: 0.45, side: THREE.DoubleSide }), interiors.length);
    this.shutters.name = 'frentes-cortinas';
    for (const m of [this.leaves, this.shutters]) {
      m.matrixAutoUpdate = false;
      this.group.add(m);
    }
    this.state = interiors.map(() => ({ open: -1, shut: -1, openK: 0, shutK: 1 }));
    for (let i = 0; i < interiors.length; i++) this._place(i, 0, 1);
  }

  _front(r, a, g, v) {
    const d = r.door;
    const fy = r.floorY;
    const w = d.x1 - d.x0;
    const big = r.tam === 'grande';
    const mw = Math.min(r.W - 1, w + (big ? 3.2 : 1.8));
    const my = fy + d.h + 0.32;
    const out = big ? 1.6 : 1.1;
    // Marquesina: losa negra con canto metálico; tira LED y focos por debajo.
    a.box(-mw / 2, mw / 2, my, my + 0.16, 0, out, [0.06, 0.06, 0.07], 1, '');
    a.box(-mw / 2 - 0.02, mw / 2 + 0.02, my + 0.16, my + 0.2, out - 0.04, out + 0.02, [0.8, 0.8, 0.82], 1, 'y-');
    const A = ASPECTO[r.tema] ?? ASPECTO.esquina;
    const c = A.ribete.map((x) => x * 2.6);
    g.box(-mw / 2, mw / 2, my - 0.012, my, out - 0.08, out - 0.04, c, 1, 'y+');
    g.box(-mw / 2, mw / 2, my + 0.02, my + 0.12, out + 0.02, out + 0.03, A.acentos[0].map((x) => x * 2.2), 1, '');
    for (let x = -mw / 2 + 0.4; x < mw / 2 - 0.2; x += 0.6) g.cyl(x, my - 0.012, out * 0.5, 0.05, 0.05, 0.01, [2.6, 2.4, 2.0], 8);
    // Tirantes a la fachada.
    for (const s of [-1, 1]) {
      const L = Math.hypot(out, 1.0);
      const geo = new THREE.CylinderGeometry(0.015, 0.015, L, 6);
      Q.setFromEuler(E.set(Math.atan2(out, 1.0), 0, 0));
      M2.compose(tmpV.set(s * (mw / 2 - 0.15), my + 0.66, out / 2), Q, S1);
      a.geom(geo, M2, [0.7, 0.7, 0.72]);
      geo.dispose();
    }
    // Marco de la puerta (acero negro) y neón vertical a los lados.
    a.box(d.x0 - 0.12, d.x0, fy, fy + d.h + 0.1, -0.02, 0.05, [0.05, 0.05, 0.05], 1, 'y-');
    a.box(d.x1, d.x1 + 0.12, fy, fy + d.h + 0.1, -0.02, 0.05, [0.05, 0.05, 0.05], 1, 'y-');
    a.box(d.x0 - 0.12, d.x1 + 0.12, fy + d.h, fy + d.h + 0.12, -0.02, 0.05, [0.05, 0.05, 0.05], 1, 'y-');
    for (const x of [d.x0 - 0.2, d.x1 + 0.2]) g.box(x - 0.025, x + 0.025, fy + 0.1, fy + d.h, 0.03, 0.07, A.acentos[1].map((q) => q * 2.4), 1, 'y-');
    // Cordón de la fila (postes cromados y cordón de terciopelo) del lado de la fila (+x).
    const x0 = d.x1 + 0.35;
    const zf = 1.05;
    const posts = [x0, x0 + 1.3, x0 + 2.6].filter((x) => x < r.W / 2 + 1.5);
    for (const x of posts) {
      a.cyl(x, fy, zf, 0.13, 0.15, 0.04, [0.85, 0.85, 0.88], 14);
      a.cyl(x, fy + 0.04, zf, 0.025, 0.025, 0.9, [0.9, 0.9, 0.92], 8);
      a.sphere(x, fy + 0.96, zf, 0.045, [0.9, 0.85, 0.5], 8);
    }
    for (let k = 0; k + 1 < posts.length; k++) {
      const xa = posts[k];
      const xb = posts[k + 1];
      for (let s = 0; s < 8; s++) {
        const t0 = s / 8;
        const t1 = (s + 1) / 8;
        const ya = fy + 0.88 - Math.sin(t0 * Math.PI) * 0.22;
        const yb = fy + 0.88 - Math.sin(t1 * Math.PI) * 0.22;
        const L = Math.hypot((xb - xa) / 8, yb - ya);
        const geo = new THREE.CylinderGeometry(0.022, 0.022, L, 6);
        Q.setFromEuler(E.set(0, 0, Math.PI / 2 - Math.atan2(yb - ya, (xb - xa) / 8)));
        M2.compose(tmpV.set(xa + (xb - xa) * (t0 + t1) / 2, (ya + yb) / 2, zf), Q, S1);
        a.geom(geo, M2, [0.55, 0.04, 0.08]);
        geo.dispose();
      }
    }
  }

  /** Vestíbulo oscuro tras la puerta (mientras el salón no está armado): paredes negras, cortina de terciopelo y un resplandor. */
  _vestibule(r, v) {
    const d = r.door;
    const fy = r.floorY;
    const z0 = -0.3;
    const z1 = -2.2;
    const x0 = d.x0 - 0.4;
    const x1 = d.x1 + 0.4;
    const A = ASPECTO[r.tema] ?? ASPECTO.esquina;
    const glow = A.acentos[0].map((x) => x * 0.35);
    v.quad([x0, fy, z1], [x1, fy, z1], [x1, fy + d.h + 0.3, z1], [x0, fy + d.h + 0.3, z1], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], glow);
    v.quad([x0, fy, z0], [x0, fy, z1], [x0, fy + d.h + 0.3, z1], [x0, fy + d.h + 0.3, z0], [1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.02, 0.02, 0.025]);
    v.quad([x1, fy, z0], [x1, fy, z1], [x1, fy + d.h + 0.3, z1], [x1, fy + d.h + 0.3, z0], [-1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.02, 0.02, 0.025]);
    v.quad([x0, fy + 0.01, z0], [x1, fy + 0.01, z0], [x1, fy + 0.01, z1], [x0, fy + 0.01, z1], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.03, 0.02, 0.03]);
    v.quad([x0, fy + d.h + 0.3, z0], [x1, fy + d.h + 0.3, z0], [x1, fy + d.h + 0.3, z1], [x0, fy + d.h + 0.3, z1], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.02, 0.02, 0.02]);
    // Cortina (pliegues oscuros) y tira de luz al pie.
    for (let k = 0; k < 10; k++) {
      const xa = x0 + ((x1 - x0) * k) / 10;
      const xb = x0 + ((x1 - x0) * (k + 1)) / 10;
      const z = z1 + 0.15 + (k % 2) * 0.08;
      v.quad([xa, fy, z], [xb, fy, z + (k % 2 ? -0.08 : 0.08)], [xb, fy + d.h + 0.2, z + (k % 2 ? -0.08 : 0.08)], [xa, fy + d.h + 0.2, z], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], [0.22 + 0.06 * (k % 2), 0.01, 0.04]);
    }
    v.quad([x0, fy + 0.02, z1 + 0.3], [x1, fy + 0.02, z1 + 0.3], [x1, fy + 0.06, z1 + 0.3], [x0, fy + 0.06, z1 + 0.3], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], A.acentos[1].map((x) => x * 2));
  }

  /** Pone las hojas (openK 0 = cerradas, 1 = abiertas) y la cortina (shutK 1 = abajo) del local i. */
  _place(i, openK, shutK) {
    const r = this.list[i];
    const d = r.door;
    const hw = (d.x1 - d.x0) / 2;
    const base = new THREE.Matrix4().compose(tmpV.set(r.ox, 0, r.oz), Q.setFromEuler(E.set(0, r.rot, 0)), S1);
    const ang = openK * 1.45;
    for (const s of [0, 1]) {
      const hx = s ? d.x1 : d.x0;
      // Bisagra en el marco; la hoja abre hacia adentro (z < 0).
      Q.setFromEuler(E.set(0, s ? -ang + Math.PI : ang, 0));
      M.compose(tmpV.set(hx, r.floorY, -0.14), Q, tmpS.set(hw - 0.02, d.h - 0.03, 1));
      M.premultiply(base);
      this.leaves.setMatrixAt(i * 2 + s, M);
    }
    this.leaves.instanceMatrix.needsUpdate = true;
    const h = Math.max(0.28, d.h * shutK);
    M.compose(tmpV.set((d.x0 + d.x1) / 2, r.floorY + d.h, -0.03), Q.identity(), tmpS.set(d.x1 - d.x0 + 0.06, h, 1)).premultiply(base);
    this.shutters.setMatrixAt(i, M);
    this.shutters.instanceMatrix.needsUpdate = true;
    this.leaves.computeBoundingSphere();
    this.shutters.computeBoundingSphere();
  }

  /**
   * Estados: open[i] (puerta abierta), shut[i] (cortina abajo), built[i]
   * (salón armado: sin vestíbulo). Anima las hojas y la cortina.
   */
  update(dt, open, shut, built, night) {
    for (let i = 0; i < this.list.length; i++) {
      const s = this.state[i];
      const to = open[i] ? 1 : 0;
      const sh = shut[i] ? 1 : 0;
      const ok = s.openK + Math.sign(to - s.openK) * Math.min(Math.abs(to - s.openK), dt * 1.8);
      const sk = s.shutK + Math.sign(sh - s.shutK) * Math.min(Math.abs(sh - s.shutK), dt * 0.5);
      if (ok !== s.openK || sk !== s.shutK) {
        s.openK = ok;
        s.shutK = sk;
        this._place(i, ok, sk);
      }
      if (this.vest[i]) this.vest[i].visible = !built[i];
    }
    const k = 0.15 + 0.85 * night;
    this.glowMat.color.setScalar(k);
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => o.geometry?.dispose());
  }
}

/** Copia `src` en `dst` transformada por `m` (posiciones y normales). */
function appendTransformed(dst, src, m) {
  tmpM3.getNormalMatrix(m);
  const k = dst.count;
  for (let v = 0; v < src.count; v++) {
    tmpV.set(src.p[v * 3], src.p[v * 3 + 1], src.p[v * 3 + 2]).applyMatrix4(m);
    tmpN.set(src.n[v * 3], src.n[v * 3 + 1], src.n[v * 3 + 2]).applyMatrix3(tmpM3).normalize();
    dst.p.push(tmpV.x, tmpV.y, tmpV.z);
    dst.n.push(tmpN.x, tmpN.y, tmpN.z);
  }
  for (const u of src.u) dst.u.push(u);
  for (const c of src.c) dst.c.push(c);
  for (const i of src.i) dst.i.push(i + k);
}

// ------------------------------------------------------------------ calentamiento
/**
 * Muestras de los materiales de los interiores para el calentamiento de
 * programas (render/warmupSamples.js): un interior pequeño de cada clase de
 * material, armado de una (lo libera quien lo pide con dispose()).
 */
export function interiorWarmupSample(rooms, temas = MUESTRA_TEMAS) {
  const out = [];
  for (const t of temas) {
    const r = rooms.find((q) => q.tema === t);
    if (r) out.push(new InteriorView(r).buildNow());
  }
  return out;
}

/** Temas que juntos usan todos los programas de los interiores (pista LED, pantalla, neblina, chorros, haces y láseres; bola y puntos; hojas y ventiladores; TV y neones). */
export const MUESTRA_TEMAS = ['hielo', 'salsoteca', 'son', 'esquina'];
