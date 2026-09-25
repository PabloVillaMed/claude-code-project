// Metro de Medellín: vía a nivel (balasto, rieles, postes de catenaria), la
// estación Caribe (andenes, cubiertas, vestíbulo elevado con torniquetes,
// escaleras, ascensores de vidrio y el puente peatonal sobre el río) y el
// tren de la línea A que va y viene parando en la estación.

import * as THREE from 'three';
import { GeoBuilder } from './geoBuilder.js';
import { orientedQuad, ribbon } from './drape.js';
import { textTexture } from './textures.js';
import { pointAlong } from '../sim/geom2d.js';
import { insideMap, terrainHeight } from '../sim/terrain.js';

const GREEN = 0x0a7a45; // verde Metro de Medellín

export function buildMetro(r) {
  const mt = r.city.metro;
  if (!mt) return null;
  const root = new THREE.Group();
  root.name = 'metro';
  r.root.add(root);
  const mats = {
    ballast: new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 1, map: r.tex.concrete.map, polygonOffset: true, polygonOffsetFactor: -1 }),
    rail: new THREE.MeshStandardMaterial({ color: 0x8d8f92, roughness: 0.35, metalness: 0.85 }),
    conc: new THREE.MeshStandardMaterial({ color: 0xc9c6bf, roughness: 0.85, map: r.tex.concrete.map, normalMap: r.tex.concrete.normalMap, vertexColors: true }),
    metal: new THREE.MeshStandardMaterial({ color: 0xd8dadc, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide, vertexColors: true }),
    dark: r.materials.darkMetal,
    glass: new THREE.MeshPhysicalMaterial({ color: 0x9fb8c0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    green: new THREE.MeshStandardMaterial({ color: GREEN, roughness: 0.5 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xf1c21b, roughness: 0.6 }),
  };
  const add = (g, mat, { cast = true, name } = {}) => {
    const m = new THREE.Mesh(g.build(), mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    if (name) m.name = name;
    root.add(m);
    return m;
  };

  // ---- vía: balasto y rieles sobre el terreno
  const ballast = new GeoBuilder();
  const rails = new GeoBuilder();
  for (const l of mt.lines) {
    if (l.bridge) continue;
    const pts = l.pts.filter(([x, z]) => insideMap(x, z, 300));
    if (pts.length < 2) continue;
    ribbon(ballast, pts, -1.7, 1.7, (x, z) => terrainHeight(x, z) + 0.12, { step: 4, uv: (s, o) => [o / 3, s / 3] });
    for (const o of [-0.72, 0.72]) ribbon(rails, pts, o - 0.04, o + 0.04, (x, z) => terrainHeight(x, z) + 0.32, { step: 4, uv: () => [0, 0] });
  }
  add(ballast, mats.ballast, { cast: false, name: 'balasto' });
  add(rails, mats.rail, { cast: false, name: 'rieles' });

  // Postes de catenaria y el muro de cierre del corredor.
  const posts = [];
  const tp = mt.trainPath;
  if (tp) {
    const L = tp.cum[tp.cum.length - 1];
    for (let s = 5; s < L; s += 45) {
      const p = pointAlong(tp.pts, tp.cum, s);
      posts.push({ x: p.x + p.dz * 3.4, z: p.z - p.dx * 3.4, rot: Math.atan2(p.dx, p.dz) });
    }
  }
  if (posts.length) {
    const pole = new THREE.CylinderGeometry(0.12, 0.16, 7.5, 8).translate(0, 3.75, 0);
    const arm = new THREE.BoxGeometry(5.2, 0.12, 0.12).translate(-2.4, 6.8, 0);
    const geo = mergeSimple([pole, arm]);
    const im = new THREE.InstancedMesh(geo, mats.rail, posts.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    posts.forEach((p, i) => {
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.rot + Math.PI / 2);
      m.compose(new THREE.Vector3(p.x, terrainHeight(p.x, p.z), p.z), q, new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(i, m);
    });
    im.castShadow = true;
    root.add(im);
  }
  if (r.city.metroFence?.length) {
    const g = new GeoBuilder();
    for (const f of r.city.metroFence) {
      const y = terrainHeight(f.x, f.z);
      const ax = f.x - f.ux * f.h;
      const az = f.z - f.uz * f.h;
      const bx = f.x + f.ux * f.h;
      const bz = f.z + f.uz * f.h;
      const ya = terrainHeight(ax, az);
      const yb = terrainHeight(bx, bz);
      for (const sgn of [1, -1]) {
        orientedQuad(g, [[ax, ya - 0.3, az], [bx, yb - 0.3, bz], [bx, yb + 2.1, bz], [ax, ya + 2.1, az]], [-f.uz * sgn, 0, f.ux * sgn], [[0, 0], [f.h / 1.5, 0], [f.h / 1.5, 0.8], [0, 0.8]], [0.85, 0.84, 0.8]);
      }
      void y;
    }
    add(g, mats.conc, { name: 'muro-metro' });
  }

  const S = mt.geo;
  const station = S ? buildStation(r, root, S, mats, add) : null;
  const train = tp ? buildTrain(root) : null;
  const state = { s: 0, dir: 1, speed: 0, wait: 0, stopS: 0 };
  if (tp && S) {
    // Distancia a lo largo del recorrido donde queda la estación.
    let best = Infinity;
    for (let s = 0; s < tp.cum[tp.cum.length - 1]; s += 2) {
      const p = pointAlong(tp.pts, tp.cum, s);
      const d = Math.hypot(p.x - S.station.x, p.z - S.station.z);
      if (d < best) {
        best = d;
        state.stopS = s;
      }
    }
    state.s = Math.max(0, state.stopS - 600);
    // Lado de la otra vía (la del sentido contrario) respecto al recorrido.
    const p = pointAlong(tp.pts, tp.cum, state.stopS);
    const side = Math.sign(-p.dz * (S.station.x - p.x) + p.dx * (S.station.z - p.z)) || 1;
    state.otherTrack = side * 2 * (S.station.track ?? 2.5);
  }
  return {
    update(dt) {
      if (S) S.update(dt);
      if (station) station.update();
      if (train) stepTrain(train, tp, state, dt);
    },
  };
}

// ------------------------------------------------------------------ estación
function buildStation(r, root, S, mats, add) {
  const { W } = S.frame;
  const { yR, yP, yC } = S;
  const P = (a, c, y) => {
    const [x, z] = W(a, c);
    return [x, y, z];
  };
  const L = S.frame;
  const N = (na, ny, nc) => [L.ax * na + L.cx * nc, ny, L.az * na + L.cz * nc];
  // Caja orientada en el marco de la estación.
  const box = (g, a0, a1, c0, c1, y0, y1, color, bottom = false) => {
    const du = a1 - a0;
    const dc = c1 - c0;
    const dy = y1 - y0;
    orientedQuad(g, [P(a0, c1, y0), P(a1, c1, y0), P(a1, c1, y1), P(a0, c1, y1)], N(0, 0, 1), [[0, 0], [du / 3, 0], [du / 3, dy / 3], [0, dy / 3]], color);
    orientedQuad(g, [P(a1, c0, y0), P(a0, c0, y0), P(a0, c0, y1), P(a1, c0, y1)], N(0, 0, -1), [[0, 0], [du / 3, 0], [du / 3, dy / 3], [0, dy / 3]], color);
    orientedQuad(g, [P(a1, c1, y0), P(a1, c0, y0), P(a1, c0, y1), P(a1, c1, y1)], N(1, 0, 0), [[0, 0], [dc / 3, 0], [dc / 3, dy / 3], [0, dy / 3]], color);
    orientedQuad(g, [P(a0, c0, y0), P(a0, c1, y0), P(a0, c1, y1), P(a0, c0, y1)], N(-1, 0, 0), [[0, 0], [dc / 3, 0], [dc / 3, dy / 3], [0, dy / 3]], color);
    orientedQuad(g, [P(a0, c0, y1), P(a1, c0, y1), P(a1, c1, y1), P(a0, c1, y1)], [0, 1, 0], [[0, 0], [du / 3, 0], [du / 3, dc / 3], [0, dc / 3]], color);
    if (bottom) orientedQuad(g, [P(a0, c0, y0), P(a1, c0, y0), P(a1, c1, y0), P(a0, c1, y0)], [0, -1, 0], [[0, 0], [du / 3, 0], [du / 3, dc / 3], [0, dc / 3]], color);
  };
  const conc = new GeoBuilder();
  const metal = new GeoBuilder();
  const dark = new GeoBuilder();
  const green = new GeoBuilder();
  const yellow = new GeoBuilder();
  const glass = new GeoBuilder();
  const light = [0.92, 0.91, 0.88];
  const W1 = [1, 1, 1];

  // Andenes con borde amarillo de seguridad (táctil).
  for (const p of S.platforms) {
    box(conc, p.a0, p.a1, p.c0, p.c1, yR - 0.3, yP, light);
    const ce = p.side > 0 ? p.c0 : p.c1 - 0.6;
    box(yellow, p.a0, p.a1, ce, ce + 0.6, yP, yP + 0.01, W1);
  }
  // Rejas del borde exterior.
  for (const f of S.fences) {
    box(dark, f.a0, f.a1, f.c0, f.c1, f.y1 - 0.06, f.y1, W1);
    for (let a = f.a0; a <= f.a1; a += 2.5) box(dark, a - 0.04, a + 0.04, f.c0, f.c1, f.y0, f.y1, W1);
    glassPanel(glass, P, f.a0, f.a1, (f.c0 + f.c1) / 2, f.y0 + 0.1, f.y1 - 0.1, N(0, 0, 1));
  }
  // Cubiertas: techo metálico ligeramente inclinado sobre columnas.
  for (const rf of S.roofs) {
    if (rf.flat) {
      box(metal, rf.a0, rf.a1, rf.c0, rf.c1, rf.y, rf.y + 0.35, light, true);
      continue;
    }
    const lo = rf.side > 0 ? rf.c1 : rf.c0;
    const hi = rf.side > 0 ? rf.c0 : rf.c1;
    orientedQuad(metal, [P(rf.a0, lo, rf.y), P(rf.a1, lo, rf.y), P(rf.a1, hi, rf.y + 0.7), P(rf.a0, hi, rf.y + 0.7)], [0, 1, 0], [[0, 0], [10, 0], [10, 1], [0, 1]], light);
    orientedQuad(metal, [P(rf.a0, lo, rf.y - 0.02), P(rf.a1, lo, rf.y - 0.02), P(rf.a1, hi, rf.y + 0.68), P(rf.a0, hi, rf.y + 0.68)], [0, -1, 0], [[0, 0], [10, 0], [10, 1], [0, 1]], [0.8, 0.8, 0.8]);
    const cc = rf.side > 0 ? rf.c1 - 1.2 : rf.c0 + 1.2;
    for (let a = rf.a0 + 2; a < rf.a1; a += 9) box(dark, a - 0.14, a + 0.14, cc - 0.14, cc + 0.14, yP, rf.y + 0.4, [0.35, 0.37, 0.4]);
    // Letrero de la estación colgado de la cubierta.
    for (const a of [rf.a0 + 16, rf.a1 - 16]) signBoard(root, P(a, (rf.c0 + rf.c1) / 2, rf.y - 0.75), L, 'CARIBE');
  }
  // Vestíbulo: losa, muros bajos con vidrio y cubierta.
  const c = S.concourse;
  box(conc, c.a0, c.a1, c.c0, c.c1, yC - 0.7, yC, light, true);
  for (const w of S.walls) glassPanel(glass, P, w.a0, w.a1, 0, 0, 0, null, w, c);
  // Columnas del vestíbulo entre las vías y a los lados.
  for (const cc of [0, c.c0 + 0.6, c.c1 - 0.6]) for (const a of [c.a0 + 0.8, c.a1 - 0.8]) box(conc, a - 0.35, a + 0.35, cc - 0.35, cc + 0.35, yR - 0.3, yC - 0.7, light);
  // Torniquetes (validadores de la tarjeta Cívica).
  for (const t of S.turnstiles) {
    for (let a = t.a0; a <= t.a1; a += 1.1) {
      box(metal, a - 0.12, a + 0.12, t.c - 0.5, t.c + 0.5, yC, yC + 1.0, [0.75, 0.77, 0.8]);
      box(green, a - 0.12, a + 0.12, t.c - 0.52, t.c - 0.42, yC + 0.85, yC + 1.0, W1);
    }
  }
  // Barandas.
  for (const rl of S.rails) {
    box(dark, rl.a0, rl.a1, rl.c0, rl.c1, rl.y + 1.0, rl.y + 1.08, W1);
    glassPanel(glass, P, rl.a0, rl.a1, (rl.c0 + rl.c1) / 2, rl.y + 0.05, rl.y + 1.0, null, null, null, rl);
  }
  // Puente peatonal: losa, pilas y cubierta curva.
  const b = S.bridge;
  box(conc, b.a0, b.a1, b.c0, b.c1, yC - 0.9, yC, light, true);
  for (const pr of S.piers) {
    const [x, z] = W(pr.a, pr.c);
    const yg = terrainHeight(x, z) - 1;
    box(conc, -0.5, 0.5, pr.c - 0.5, pr.c + 0.5, yg, yC - 0.9, light);
  }
  for (let k = 0; k < 8; k++) {
    const t0 = k / 8;
    const t1 = (k + 1) / 8;
    const arc = (t) => [b.a0 - 0.3 + (b.a1 - b.a0 + 0.6) * t, yC + 2.9 + Math.sin(t * Math.PI) * 0.7];
    const [a0, y0] = arc(t0);
    const [a1, y1] = arc(t1);
    orientedQuad(metal, [P(a0, b.c0, y0), P(a1, b.c0, y1), P(a1, b.c1, y1), P(a0, b.c1, y0)], [0, 1, 0], [[0, 0], [1, 0], [1, 8], [0, 8]], light);
  }
  for (let cc = b.c0 + 1; cc < b.c1; cc += 6) for (const a of [b.a0 - 0.2, b.a1 + 0.2]) box(dark, a - 0.06, a + 0.06, cc - 0.06, cc + 0.06, yC, yC + 2.9, W1);
  // Escaleras: peldaños de 17 cm.
  for (const st of S.stairs) {
    const rise = Math.abs(st.y0 - st.y1);
    const n = Math.max(1, Math.round(rise / 0.17));
    const run = st.a1 - st.a0;
    for (let k = 0; k < n; k++) {
      // k = 0 es el peldaño de arriba.
      const yTop = Math.max(st.y0, st.y1) - (rise * k) / n;
      const aTop = st.dir > 0 ? st.a0 + (run * k) / n : st.a1 - (run * k) / n;
      const aBot = st.dir > 0 ? aTop + run / n : aTop - run / n;
      box(conc, Math.min(aTop, aBot), Math.max(aTop, aBot), st.c0, st.c1, Math.min(st.y0, st.y1) - 0.2, yTop, light);
    }
    // Pasamanos.
    for (const cc of [st.c0 - 0.1, st.c1 + 0.1]) {
      const yA = st.dir > 0 ? st.y0 : st.y1;
      const yB = st.dir > 0 ? st.y1 : st.y0;
      orientedQuad(dark, [P(st.a0, cc - 0.04, yA + 0.9), P(st.a1, cc - 0.04, yB + 0.9), P(st.a1, cc + 0.04, yB + 0.95), P(st.a0, cc + 0.04, yA + 0.95)], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], W1);
      glassPanel(glass, P, st.a0, st.a1, cc, 0, 0, null, null, null, null, { yA, yB });
    }
  }
  // Cubos de los ascensores (vidrio y marco verde) con su letrero.
  for (const e of S.elevators) {
    for (const [a, cc] of [
      [e.a0, e.c0],
      [e.a1, e.c0],
      [e.a0, e.c1],
      [e.a1, e.c1],
    ])
      box(green, a - 0.07, a + 0.07, cc - 0.07, cc + 0.07, e.y0 - 0.1, e.y1 + 2.6, W1);
    box(green, e.a0 - 0.1, e.a1 + 0.1, e.c0 - 0.1, e.c1 + 0.1, e.y1 + 2.6, e.y1 + 2.8, W1);
    for (const [sa, sc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const isB = e.bottomDoor[0] === sa && e.bottomDoor[1] === sc;
      const isT = e.topDoor[0] === sa && e.topDoor[1] === sc;
      const segs = [];
      if (!isB && !isT) segs.push([e.y0, e.y1 + 2.6]);
      else if (isB && !isT) segs.push([e.y0 + 2.3, e.y1 + 2.6]);
      else if (isT && !isB) segs.push([e.y0, e.y1]);
      else segs.push([e.y0 + 2.3, e.y1]);
      for (const [y0, y1] of segs) {
        if (sa) glassPanel(glass, P, 0, 0, 0, 0, 0, null, null, null, null, null, { a: sa > 0 ? e.a1 : e.a0, c0: e.c0, c1: e.c1, y0, y1 });
        else glassPanel(glass, P, e.a0, e.a1, sc > 0 ? e.c1 : e.c0, y0, y1, N(0, 0, 1));
      }
    }
  }
  add(conc, mats.conc, { name: 'estacion-concreto' });
  add(metal, mats.metal, { name: 'estacion-cubiertas' });
  add(dark, mats.dark, { name: 'estacion-metal' });
  add(green, mats.green, { name: 'estacion-verde' });
  add(yellow, mats.yellow, { cast: false, name: 'estacion-borde' });
  const gm = add(glass, mats.glass, { cast: false, name: 'estacion-vidrio' });
  gm.renderOrder = 2;

  // Letreros de acceso y del puente.
  signBoard(root, P(c.a1 + 0.1, c.c0 + 4, yC + 2.4), L, 'CARIBE', true);
  signBoard(root, P(b.a0, b.c1 - 1, yC + 3.4), L, 'METRO · CARIBE');

  // Cabinas de los ascensores (se mueven).
  const cabGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const cabMat = new THREE.MeshStandardMaterial({ color: 0xb8c2c6, roughness: 0.3, metalness: 0.6 });
  const cabs = S.elevators.map((e) => {
    const cab = new THREE.Mesh(cabGeo, cabMat);
    const [x, z] = W((e.a0 + e.a1) / 2, (e.c0 + e.c1) / 2);
    cab.position.set(x, e.y - 0.12, z);
    cab.rotation.y = Math.atan2(L.ax, L.az);
    cab.scale.set(e.c1 - e.c0 - 0.1, 0.12, e.a1 - e.a0 - 0.1);
    cab.castShadow = true;
    cab.receiveShadow = true;
    root.add(cab);
    return { cab, e };
  });
  return {
    update() {
      for (const { cab, e } of cabs) cab.position.y = e.y - 0.12;
    },
  };
}

/** Panel de vidrio vertical: a lo largo de a (en c fijo) o, con `across`, a lo largo de c; o inclinado en escaleras. */
function glassPanel(g, P, a0, a1, c, y0, y1, n, wall, conc, rail, stair, across) {
  if (wall) {
    // Muro del vestíbulo: vidrio de piso a techo a lo largo de c.
    const a = (wall.a0 + wall.a1) / 2;
    orientedQuad(g, [P(a, wall.c0, wall.y0 + 1), P(a, wall.c1, wall.y0 + 1), P(a, wall.c1, wall.y1), P(a, wall.c0, wall.y1)], [1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    void conc;
    return;
  }
  if (rail) {
    const alongA = rail.a1 - rail.a0 > rail.c1 - rail.c0;
    if (alongA) orientedQuad(g, [P(rail.a0, c, y0), P(rail.a1, c, y0), P(rail.a1, c, y1), P(rail.a0, c, y1)], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    else {
      const a = (rail.a0 + rail.a1) / 2;
      orientedQuad(g, [P(a, rail.c0, y0), P(a, rail.c1, y0), P(a, rail.c1, y1), P(a, rail.c0, y1)], [1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    return;
  }
  if (stair) {
    orientedQuad(g, [P(a0, c, stair.yA + 0.1), P(a1, c, stair.yB + 0.1), P(a1, c, stair.yB + 0.9), P(a0, c, stair.yA + 0.9)], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    return;
  }
  if (across) {
    orientedQuad(g, [P(across.a, across.c0, across.y0), P(across.a, across.c1, across.y0), P(across.a, across.c1, across.y1), P(across.a, across.c0, across.y1)], [1, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    return;
  }
  orientedQuad(g, [P(a0, c, y0), P(a1, c, y0), P(a1, c, y1), P(a0, c, y1)], n ?? [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
}

function signBoard(root, pos, L, text, alongC = false) {
  const tex = textTexture(text, { bg: '#0a7a45', w: 1024, h: 200 });
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35, side: THREE.DoubleSide });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(text.length > 8 ? 6 : 4, 0.8), mat);
  m.position.set(...pos);
  // Por defecto el letrero corre a lo largo de la vía (se lee desde el andén).
  m.rotation.y = alongC ? Math.atan2(L.ax, L.az) : Math.atan2(L.cx, L.cz);
  root.add(m);
}

// ------------------------------------------------------------------ tren
function buildTrain(root) {
  const train = new THREE.Group();
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xe9ecee, roughness: 0.25, metalness: 0.5, clearcoat: 0.5 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: GREEN });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x1a232b, roughness: 0.05, metalness: 0.2 });
  const cars = [];
  for (let k = 0; k < 3; k++) {
    const car = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.0, 3.1, 21.5), bodyMat);
    body.position.y = 2.05;
    const win = new THREE.Mesh(new THREE.BoxGeometry(3.04, 1.05, 19.5), glass);
    win.position.y = 2.55;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.05, 0.35, 21.5), stripeMat);
    stripe.position.y = 1.25;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 18), new THREE.MeshStandardMaterial({ color: 0x555a5e }));
    roof.position.y = 3.75;
    car.add(body, win, stripe, roof);
    car.traverse((o) => (o.castShadow = true));
    train.add(car);
    cars.push(car);
  }
  root.add(train);
  return { group: train, cars };
}

function stepTrain(train, tp, st, dt) {
  const L = tp.cum[tp.cum.length - 1];
  if (st.wait > 0) st.wait -= dt;
  else {
    const maxV = 16;
    // Objetivo: la estación si no ha pasado, si no el final del recorrido.
    const target = st.dir > 0 ? (st.s < st.stopS - 1 ? st.stopS : L - 40) : st.s > st.stopS + 1 ? st.stopS : 40;
    const dist = Math.abs(target - st.s);
    const desired = Math.min(maxV, Math.sqrt(2 * 1.1 * dist));
    st.speed += Math.sign(desired - st.speed) * Math.min(Math.abs(desired - st.speed), 1.4 * dt);
    st.s += st.dir * st.speed * dt;
    if (dist < 0.3) {
      st.s = target;
      st.speed = 0;
      st.wait = target === st.stopS ? 18 : 6;
      if (target !== st.stopS) st.dir *= -1;
    }
  }
  // Cada vagón sigue la vía; el tren va por la vía de la derecha de su sentido.
  train.cars.forEach((car, k) => {
    const s = Math.max(0, Math.min(L, st.s - st.dir * (k - 1) * 22));
    const p = pointAlong(tp.pts, tp.cum, s);
    const off = st.dir > 0 ? 0 : st.otherTrack ?? 5;
    const x = p.x - p.dz * off;
    const z = p.z + p.dx * off;
    car.position.set(x, terrainHeight(x, z) + 0.35, z);
    car.rotation.y = Math.atan2(p.dx, p.dz);
  });
}

function mergeSimple(geos) {
  const g = new GeoBuilder();
  for (const geo of geos) {
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const uv = geo.attributes.uv;
    const base = g.vertexCount;
    for (let i = 0; i < pos.count; i++) g.vertex(pos.getX(i), pos.getY(i), pos.getZ(i), nrm.getX(i), nrm.getY(i), nrm.getZ(i), uv.getX(i), uv.getY(i));
    for (let i = 0; i < geo.index.count; i++) g.idx.push(base + geo.index.getX(i));
  }
  const out = g.build();
  out.deleteAttribute('color');
  return out;
}
