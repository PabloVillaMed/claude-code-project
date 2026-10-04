// Utilería de las actividades del barrio (game/activities.js): cuerda de
// ropa con prendas, platón, escoba, balón, arquitos de microfútbol, piedras de
// arco, mesa de dominó con fichas, sillas plásticas y balde. Geometrías y
// materiales compartidos entre todas las copias; lo repetido (prendas,
// fichas, sillas) va en InstancedMesh: pocas llamadas de dibujo por escena.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { propTemplate } from './props.js';

const cache = {};
const cacheSet = new Set(); // geometrías y materiales compartidos: nunca se liberan
const once = (k, make) => {
  if (!(k in cache)) {
    cache[k] = make();
    cacheSet.add(cache[k]);
  }
  return cache[k];
};

/**
 * Saca de la escena un objeto de utilería de las actividades y libera lo que
 * sea solo suyo (cuerdas de tendedero, mesas armadas para ese lugar…); lo
 * compartido (prendas, balón, materiales) se queda.
 */
export function releaseProp(obj) {
  obj.removeFromParent();
  obj.traverse?.((o) => {
    if (o.isInstancedMesh) o.dispose();
    if (o.geometry && !cacheSet.has(o.geometry)) o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) if (!cacheSet.has(m)) m.dispose();
  });
}

const mat = (k, opts) => once(`m:${k}`, () => new THREE.MeshStandardMaterial({ roughness: 0.8, ...opts }));

/** Pinta los vértices de una geometría de un color (para fusionar piezas con un solo material). */
function paint(g, color) {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(arr, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Fusiona piezas (sin índice para que todas casen) con color por vértice. */
function merged(parts) {
  return mergeGeometries(parts.map(([g, color]) => paint(g.index ? g.toNonIndexed() : g, color)));
}

const vcMat = () => mat('vc', { vertexColors: true, roughness: 0.75 });

// Colores de ropa tendida: camisetas, toallas, sábanas y jeans.
export const GARMENT_COLORS = [0xf2efe6, 0xc0392b, 0x2e5e8c, 0xe8c547, 0x5f8f4e, 0xd98cb3, 0x34495e, 0xf39c52, 0x8e44ad, 0x6d8fb3];

// ------------------------------------------------------------------ ropa
/** Prenda colgada: tela que cuelga desde el origen (arriba) hacia abajo. */
function garmentGeo() {
  return once('garment', () => {
    const g = new THREE.PlaneGeometry(0.46, 0.56, 2, 3);
    // Un poco abombada, como tela.
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(((p.getX(i) + 0.23) / 0.46) * Math.PI) * 0.03 * (1 - (p.getY(i) + 0.28) / 0.56));
    g.translate(0, -0.28, 0);
    g.computeVertexNormals();
    return g;
  });
}

const garmentMat = () => mat('garment', { side: THREE.DoubleSide, roughness: 0.95 });

/**
 * Cuerda de ropa en un balcón: dos palitos, la cuerda, las prendas
 * (InstancedMesh con color por prenda) y el platón de ropa en el piso.
 * a, b: extremos de la cuerda (mundo, a la altura de la cuerda).
 */
export function buildClothesline(a, b, floorY, basketPos, seed = 0) {
  const g = new THREE.Group();
  g.name = 'ropa-balcon';
  const len = a.distanceTo(b);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  g.position.copy(mid);
  g.lookAt(b.x, mid.y, b.z); // +Z local hacia b
  // Cuerda (a lo largo de Z local) y palitos que la sostienen desde la baranda.
  const hLine = a.y - floorY;
  const frame = merged([
    [new THREE.CylinderGeometry(0.006, 0.006, len, 4).rotateX(Math.PI / 2), 0xe8e4da],
    [new THREE.CylinderGeometry(0.015, 0.015, hLine - 0.95, 5).translate(0, -(hLine - 0.95) / 2, -len / 2), 0x6b5a45],
    [new THREE.CylinderGeometry(0.015, 0.015, hLine - 0.95, 5).translate(0, -(hLine - 0.95) / 2, len / 2), 0x6b5a45],
  ]);
  const line = new THREE.Mesh(frame, vcMat());
  line.castShadow = false;
  g.add(line);
  // Prendas: hasta 9 espacios a lo largo de la cuerda.
  const slots = Math.max(2, Math.min(9, Math.floor(len / 0.52)));
  const inst = new THREE.InstancedMesh(garmentGeo(), garmentMat(), slots);
  inst.castShadow = true;
  inst.count = 0;
  const col = new THREE.Color();
  for (let i = 0; i < slots; i++) inst.setColorAt(i, col.set(GARMENT_COLORS[(seed + i * 3) % GARMENT_COLORS.length]));
  g.add(inst);
  // Platón plástico con ropa (en coordenadas de mundo -> locales del grupo).
  const basket = new THREE.Mesh(
    once('basket', () =>
      merged([
        [new THREE.CylinderGeometry(0.26, 0.21, 0.2, 12, 1, true).translate(0, 0.1, 0), 0x3b8fd1],
        [new THREE.CylinderGeometry(0.21, 0.21, 0.01, 12).translate(0, 0.005, 0), 0x3b8fd1],
        [new THREE.SphereGeometry(0.22, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 1).translate(0, 0.14, 0), 0xe9e2d0],
      ]),
    ),
    vcMat(),
  );
  g.add(basket);
  g.updateMatrixWorld(true);
  basket.position.copy(g.worldToLocal(basketPos.clone()));
  // La que va en la mano mientras la cuelga.
  const hand = new THREE.Mesh(garmentGeo(), garmentMat().clone());
  hand.visible = false;
  hand.castShadow = true;
  hand.name = 'prenda-mano';
  const api = {
    group: g,
    slots,
    len,
    inst,
    hand,
    /** Punto (mundo) del espacio i de la cuerda. */
    slotWorld(i, out = new THREE.Vector3()) {
      const t = (i + 0.5) / slots;
      return out.copy(a).lerp(b, t);
    },
    /** Cuántas prendas cuelgan (las primeras `n` de la cuerda). */
    setHung(n) {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3(1, 1, 1);
      const p = new THREE.Vector3();
      inst.count = Math.min(slots, n);
      for (let i = 0; i < inst.count; i++) {
        p.set(0, 0, -len / 2 + ((i + 0.5) / slots) * len);
        // Cara hacia la calle: la prenda en el plano de la cuerda.
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 + ((i * 7919) % 10) * 0.012);
        s.set(0.8 + ((i * 31) % 5) * 0.08, 0.75 + ((i * 17) % 4) * 0.12, 1);
        inst.setMatrixAt(i, m.compose(p, q, s));
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    },
    colorOf(i) {
      return GARMENT_COLORS[(seed + i * 3) % GARMENT_COLORS.length];
    },
  };
  return api;
}

// ------------------------------------------------------------------ escoba
/** Escoba: palo de madera desde el origen (cerdas) hasta +Y 1.25 m. */
export function broomMesh() {
  const geo = once('broom', () =>
    merged([
      [new THREE.CylinderGeometry(0.013, 0.013, 1.2, 6).translate(0, 0.66, 0), 0xb08d5a],
      [new THREE.BoxGeometry(0.3, 0.05, 0.05).translate(0, 0.07, 0), 0x2f6fb5],
      [new THREE.BoxGeometry(0.28, 0.07, 0.035).translate(0, 0.02, 0), 0xd8c070],
    ]),
  );
  const m = new THREE.Mesh(geo, vcMat());
  m.castShadow = true;
  m.name = 'escoba';
  return m;
}

// ------------------------------------------------------------------ balón
function ballTexture() {
  return once('ballTex', () => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f4f4f0';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#1c1c1c';
    // Parches oscuros repartidos (proyección equirrectangular aproximada).
    const spots = [
      [16, 14], [48, 12], [80, 14], [112, 12],
      [0, 36], [32, 34], [64, 36], [96, 34], [128, 36],
      [16, 56], [48, 56], [80, 56], [112, 56],
    ];
    for (const [x, y] of spots) {
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        ctx.lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 5);
      }
      ctx.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

export function ballMesh(r) {
  const m = new THREE.Mesh(
    once('ball', () => new THREE.SphereGeometry(r, 14, 10)),
    once('m:ball', () => new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.55 })),
  );
  m.castShadow = true;
  m.name = 'balon';
  return m;
}

// ------------------------------------------------------------------ arcos
/** Arquito de microfútbol (tubos blancos, 2·w de ancho y h de alto) mirando a +Z. */
export function smallGoal(w, h) {
  const geo = once(`goal:${w}:${h}`, () => {
    const t = 0.04;
    return merged([
      [new THREE.CylinderGeometry(t, t, h, 6).translate(-w, h / 2, 0), 0xf2f2f2],
      [new THREE.CylinderGeometry(t, t, h, 6).translate(w, h / 2, 0), 0xf2f2f2],
      [new THREE.CylinderGeometry(t, t, 2 * w, 6).rotateZ(Math.PI / 2).translate(0, h, 0), 0xf2f2f2],
      [new THREE.CylinderGeometry(t * 0.8, t * 0.8, 2 * w, 6).rotateZ(Math.PI / 2).translate(0, 0.03, -0.8), 0xc8c8c8],
      [new THREE.CylinderGeometry(t * 0.8, t * 0.8, 0.95, 6).rotateX(Math.PI / 2 - 0.6).translate(-w, h / 2, -0.4), 0xc8c8c8],
      [new THREE.CylinderGeometry(t * 0.8, t * 0.8, 0.95, 6).rotateX(Math.PI / 2 - 0.6).translate(w, h / 2, -0.4), 0xc8c8c8],
    ]);
  });
  const m = new THREE.Mesh(geo, vcMat());
  m.castShadow = true;
  m.name = 'arquito';
  return m;
}

/** Dos piedras (o chanclas) que marcan un arco callejero de 2·w. */
export function stoneGoal(w) {
  const geo = once(`stones:${w}`, () =>
    merged([
      [new THREE.DodecahedronGeometry(0.13, 0).scale(1, 0.7, 1.2).translate(-w, 0.07, 0), 0x8a857a],
      [new THREE.DodecahedronGeometry(0.12, 0).scale(1.2, 0.7, 1).translate(w, 0.06, 0), 0x77736b],
    ]),
  );
  const m = new THREE.Mesh(geo, vcMat());
  m.castShadow = true;
  m.name = 'piedras-arco';
  return m;
}

// ------------------------------------------------------------------ dominó
/** Mesa plástica Rimax (cuadrada, 0.9 m) con las patas; el origen en el piso. */
function tableGeo() {
  return once('table', () => {
    const parts = [[new THREE.BoxGeometry(0.9, 0.035, 0.9).translate(0, 0.72, 0), 0xf1f0ea]];
    for (const [x, z] of [
      [-0.38, -0.38],
      [0.38, -0.38],
      [-0.38, 0.38],
      [0.38, 0.38],
    ]) parts.push([new THREE.CylinderGeometry(0.03, 0.035, 0.71, 6).translate(x, 0.355, z), 0xe6e4dc]);
    return merged(parts);
  });
}

/**
 * Mesa de dominó: la mesa, `seats` sillas plásticas alrededor (del modelo de
 * utilería, instanciadas) y las fichas (InstancedMesh). `seatPos(i)` da el
 * sitio (local) y el yaw de quien se sienta en la silla i.
 */
export function buildDominoTable(seats = 4) {
  const g = new THREE.Group();
  g.name = 'mesa-domino';
  const table = new THREE.Mesh(tableGeo(), vcMat());
  table.castShadow = true;
  g.add(table);
  const seatAt = [];
  for (let i = 0; i < seats; i++) {
    const a = (i / seats) * Math.PI * 2 + Math.PI / 4;
    const x = Math.sin(a) * 0.72;
    const z = Math.cos(a) * 0.72;
    // Mira al centro de la mesa (yaw del juego: 0 mira a -Z).
    seatAt.push({ x, z, yaw: Math.atan2(x, z) });
  }
  const tpl = propTemplate('silla_plastica');
  const parts = tpl?.cerca ?? [{ geometry: once('chairBox', () => new THREE.BoxGeometry(0.46, 0.85, 0.46).translate(0, 0.425, 0)), material: mat('chair', { color: 0xf2f2ee }) }];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  for (const part of parts) {
    const im = new THREE.InstancedMesh(part.geometry, part.material, seats);
    im.castShadow = true;
    for (let i = 0; i < seats; i++) {
      const s = seatAt[i];
      // Igual que las sillas del andén: la persona mira a rot + PI.
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw - Math.PI);
      im.setMatrixAt(i, m4.compose(new THREE.Vector3(s.x, 0, s.z), q, one));
    }
    g.add(im);
  }
  // Fichas: blancas con los puntos insinuados (la cara de arriba más gris).
  const tiles = new THREE.InstancedMesh(
    once('tile', () => new THREE.BoxGeometry(0.048, 0.012, 0.024)),
    mat('tile', { color: 0xf4f1e6, roughness: 0.4 }),
    28,
  );
  tiles.count = 0;
  tiles.castShadow = false;
  g.add(tiles);
  const api = {
    group: g,
    seatAt,
    tiles,
    /** Pone `n` fichas en fila (la culebrita del dominó) y `hand` fichas paradas frente a cada silla. */
    setTiles(n, hand = 5) {
      const p = new THREE.Vector3();
      const qq = new THREE.Quaternion();
      const s = new THREE.Vector3(1, 1, 1);
      let k = 0;
      for (let i = 0; i < n && k < 28; i++, k++) {
        // Culebra: de un lado al otro, doblando en las puntas.
        const row = Math.floor(i / 7);
        const col = i % 7;
        const x = (row % 2 ? 3 - col : col - 3) * 0.05;
        p.set(x, 0.744, (row - 1) * 0.06);
        qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
        tiles.setMatrixAt(k, m4.compose(p, qq, s));
      }
      // Fichas en la mano: paradas de canto frente a cada jugador.
      for (let j = 0; j < seats && k < 28; j++) {
        const st = seatAt[j];
        const dx = -st.x;
        const dz = -st.z;
        const l = Math.hypot(dx, dz);
        for (let t = 0; t < Math.min(hand, 3) && k < 28; t++, k++) {
          const side = (t - 1) * 0.03;
          p.set(st.x + (dx / l) * 0.3 + (dz / l) * side, 0.752, st.z + (dz / l) * 0.3 - (dx / l) * side);
          qq.setFromEuler(new THREE.Euler(Math.PI / 2 - 0.3, st.yaw, 0, 'YXZ'));
          tiles.setMatrixAt(k, m4.compose(p, qq, s));
        }
      }
      tiles.count = k;
      tiles.instanceMatrix.needsUpdate = true;
    },
  };
  api.setTiles(0);
  return api;
}

// ------------------------------------------------------------------ balde
export function bucketMesh() {
  const geo = once('bucket', () =>
    merged([
      [new THREE.CylinderGeometry(0.15, 0.12, 0.28, 12, 1, true).translate(0, 0.14, 0), 0x2d7fc4],
      [new THREE.CylinderGeometry(0.12, 0.12, 0.01, 12).translate(0, 0.005, 0), 0x2d7fc4],
      [new THREE.CylinderGeometry(0.14, 0.14, 0.01, 12).translate(0, 0.22, 0), 0xdfe8ee],
      [new THREE.TorusGeometry(0.15, 0.006, 4, 12, Math.PI).translate(0, 0.28, 0), 0xcfcfcf],
    ]),
  );
  const m = new THREE.Mesh(geo, vcMat());
  m.castShadow = true;
  m.name = 'balde';
  return m;
}

/** Trapo en la mano (para lavar la moto). */
export function ragMesh() {
  const m = new THREE.Mesh(once('rag', () => new THREE.BoxGeometry(0.14, 0.03, 0.1)), mat('rag', { color: 0xe7c34a, roughness: 1 }));
  m.name = 'trapo';
  return m;
}
