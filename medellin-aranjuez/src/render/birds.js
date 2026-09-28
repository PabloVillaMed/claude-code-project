// Pájaros: una sola malla instanciada de pocos triángulos (cuerpo, cabeza,
// cola y dos alas de dos tramos) para palomas, gallinazos y loros. El aleteo,
// las alas recogidas en el piso y el picoteo se hacen en el sombreador de
// vértices con un atributo por instancia: (fase, frecuencia, amplitud, en el piso).

import * as THREE from 'three';
import { MAX_BIRDS } from '../sim/birds.js';

const COLORS = {
  paloma: [0x6f737c, 0x5d6068, 0x7d7f86, 0x4f4a48, 0x8a8888],
  gallinazo: [0x161616, 0x1c1b1a],
  loro: [0x2f8a3b, 0x3a9a40, 0x2a7d36],
};

/**
 * Geometría de una paloma (m): mira hacia +Z, ~0,32 m de largo y ~0,66 m de
 * envergadura. Atributo `part`: 0 cuerpo, 1 ala (mitad), 2 punta del ala, 3 cabeza.
 */
export function birdGeometry() {
  const pos = [];
  const part = [];
  const tri = (a, b, c, pa, pb, pc) => {
    pos.push(...a, ...b, ...c);
    part.push(pa, pb, pc);
  };
  // Cuerpo: doble pirámide alargada.
  const nose = [0, 0.02, 0.13];
  const tail = [0, 0.005, -0.1];
  const L = [-0.045, 0, 0.01];
  const R = [0.045, 0, 0.01];
  const T = [0, 0.045, 0.0];
  const B = [0, -0.04, 0.0];
  for (const [a, b] of [[L, T], [T, R], [R, B], [B, L]]) {
    tri(nose, a, b, 0, 0, 0);
    tri(tail, b, a, 0, 0, 0);
  }
  // Cabeza: pirámide pequeña sobre el pecho (se mueve al picotear).
  const h0 = [0, 0.075, 0.15];
  const hb = [0, 0.03, 0.1];
  const hl = [-0.025, 0.045, 0.12];
  const hr = [0.025, 0.045, 0.12];
  const beak = [0, 0.06, 0.19];
  tri(h0, hl, hr, 3, 3, 3);
  tri(hb, hr, hl, 3, 3, 3);
  tri(beak, hl, h0, 3, 3, 3);
  tri(beak, h0, hr, 3, 3, 3);
  // Cola en abanico.
  tri([0, 0.01, -0.07], [-0.055, 0.005, -0.19], [0.055, 0.005, -0.19], 0, 0, 0);
  // Alas: tramo interior (cuadrilátero) y punta.
  for (const s of [-1, 1]) {
    const r0 = [0.03 * s, 0.02, 0.06];
    const r1 = [0.03 * s, 0.02, -0.06];
    const m0 = [0.17 * s, 0.02, 0.045];
    const m1 = [0.17 * s, 0.02, -0.075];
    const tip = [0.33 * s, 0.02, -0.09];
    tri(r0, m0, r1, 0, 1, 0);
    tri(r1, m0, m1, 0, 1, 1);
    tri(m0, tip, m1, 1, 2, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('part', new THREE.Float32BufferAttribute(part, 1));
  g.computeVertexNormals();
  return g;
}

export class BirdRenderer {
  constructor(scene) {
    const geo = birdGeometry();
    this.flap = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 4), 4);
    this.flap.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFlap', this.flap);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, flatShading: true });
    this.uTime = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uBirdTime = this.uTime;
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float part;
          attribute vec4 aFlap;
          uniform float uBirdTime;`,
        )
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3( position );
          {
            float ph = uBirdTime * aFlap.y + aFlap.x;
            float grounded = aFlap.w;
            if ( part > 0.5 && part < 2.5 ) {
              // Aleteo: el ala gira alrededor del eje del cuerpo; la punta un poco más (ala que se dobla).
              float s = sign( transformed.x );
              float r = abs( transformed.x ) - 0.03;
              float ang = sin( ph ) * aFlap.z * ( part > 1.5 ? 1.25 : 1.0 ) + 0.08;
              transformed.x = s * ( 0.03 + r * cos( ang ) );
              transformed.y += r * sin( ang );
              // En el piso: alas recogidas sobre el lomo.
              transformed.x = mix( transformed.x, s * ( 0.034 + r * 0.06 ), grounded );
              transformed.y = mix( transformed.y, 0.035 + r * 0.03, grounded );
              transformed.z = mix( transformed.z, transformed.z - r * 0.45, grounded );
            }
            if ( part > 2.5 ) {
              // Cabeceo al caminar y picoteo.
              float peck = grounded * smoothstep( 0.35, 1.0, sin( ph ) );
              transformed.y -= peck * 0.075;
              transformed.z += peck * 0.035;
            }
          }`,
        );
    };
    mat.customProgramCacheKey = () => 'pajaros-v1';
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_BIRDS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.name = 'pajaros';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // las instancias se mueven por todo el cielo
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < MAX_BIRDS; i++) this.mesh.setColorAt(i, white);
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this._colorOf = new WeakMap();
  }

  /** Copia la simulación a las instancias (unas decenas de matrices por cuadro). */
  update(dt, birds, camPos) {
    this.uTime.value = (this.uTime.value + dt) % 3600;
    const m = this.mesh;
    let n = 0;
    for (const b of birds) {
      if (n >= MAX_BIRDS) break;
      // Muy lejos no se alcanzan a ver (y la paloma en el piso a 90 m es un punto).
      const d = Math.hypot(b.x - camPos.x, b.z - camPos.z);
      if (b.kind === 'paloma' ? d > 90 : d > 900) continue;
      this._e.set(-b.pitch, b.yaw, b.bank);
      this._q.setFromEuler(this._e);
      this._p.set(b.x, b.y + (b.ground ? 0.045 * b.scale : 0), b.z);
      // Gallinazos: alas más anchas y largas (planeadores).
      if (b.kind === 'gallinazo') this._s.set(b.scale * 1.15, b.scale, b.scale * 0.95);
      else this._s.set(b.scale, b.scale, b.scale);
      this._m.compose(this._p, this._q, this._s);
      m.setMatrixAt(n, this._m);
      let c = this._colorOf.get(b);
      if (c === undefined) {
        const list = COLORS[b.kind] ?? COLORS.paloma;
        c = list[Math.floor((b.phase / 6.283) * list.length) % list.length];
        this._colorOf.set(b, c);
      }
      m.setColorAt(n, this._c.setHex(c));
      this.flap.setXYZW(n, b.phase, b.freq, b.amp, b.ground);
      n++;
    }
    m.count = n;
    if (n) {
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(0, n * 16);
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.clearUpdateRanges();
      m.instanceColor.addUpdateRange(0, n * 3);
      m.instanceColor.needsUpdate = true;
      this.flap.clearUpdateRanges();
      this.flap.addUpdateRange(0, n * 4);
      this.flap.needsUpdate = true;
    }
    m.visible = n > 0;
    return n;
  }
}
