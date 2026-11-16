// La puerta del carro que abre al subir y al bajar. Los modelos glTF traen la
// carrocería en una sola pieza (sin la puerta aparte): una vez por plantilla
// y por lado se corta la puerta de la carrocería (los triángulos de la lata,
// los vidrios y las calcomanías que caen en la región de la puerta, partidos
// justo en los bordes para que cerrada no se note), con la bisagra en el
// borde de adelante, y se arma un forro interior oscuro (piso, techo, paredes
// y la cara de adentro de la puerta) para que el hueco no se vea vacío.
// Cerrada, el carro usa su carrocería de siempre (sin mallas de más ni costo
// por cuadro); solo mientras la puerta se mueve o está abierta se cambia por
// la carrocería con el hueco y la puerta aparte (render/vehicleMesh.js).

import * as THREE from 'three';
import { CABINAS } from '../sim/carOccupants.js';

// ------------------------------------------------ ajustables
export const PUERTA = {
  open: 1.1, // rad que abre (unos 63°)
  openTime: 0.42, // s en abrirse
  closeTime: 0.3, // s en cerrarse (con el golpe al final)
  hand: 0.4, // fracción del gesto de abrir (clip door) en que la mano ya jala la puerta
  exitDelay: 0.05, // s desde que decide bajarse hasta que abre (antes de girar las piernas hacia afuera)
  standDelay: 0.1, // s desde que empieza a levantarse hasta que abre (si no estaba abierta ya)
  closeAfterSit: 0.15, // s ya sentado antes de cerrarla
  closeAfterOut: 0.05, // s ya afuera antes de cerrarla
  pulseHold: 0.9, // s abierta cuando el conductor se baja corriendo (robo, susto) o sacan a alguien
  wheelGap: 0.07, // m entre el arco de la rueda de adelante y el borde de adelante de la puerta
  sill: 0.92, // altura de la parte de abajo de la puerta, en radios de la rueda (≈ la altura del eje)
  roofGap: 0.05, // m bajo el techo donde termina el marco de la puerta
  pillarGap: 0.015, // m antes del parante (el vidrio que sigue) donde termina la puerta
  innerGap: 0.05, // m hacia adentro del vidrio lateral que todavía es puerta (el panel de adentro)
  minInner: 0.2, // m mínimos entre el puesto y lo que es puerta (el timón nunca se va con la puerta)
  maxLength: 1.35, // m máximos de largo de la puerta
  liner: 0x15161a, // color del forro interior
  panel: 0x26272b, // color de la cara de adentro de la puerta
  // Variantes sin puerta que abre: la buseta (la del conductor es otra cosa)
  // y el clásico (vidrios muy metidos: la puerta saldría sin su ventana).
  skip: ['buseta', 'clasico'], // (modelos: render/vehicleMesh.js MODEL_CFG)
};

// Región de la puerta del conductor por modelo (variante de sim/vehicleVariants.js),
// medida con rayos contra cada modelo (sonda carros/puertas.mjs; doorRegion la
// mide igual para un modelo que no esté aquí): z0 borde de adelante (detrás
// del arco de la rueda), z1 borde de atrás (antes del parante), y0 abajo (a la
// altura del eje), y1 arriba (el marco bajo el techo), xIn hasta dónde hacia
// adentro es puerta y lt el techo por dentro (para el forro). La del copiloto
// es la misma reflejada.
export const REGIONES = {
  taxi: { z0: -0.77, z1: 0.28, y0: 0.28, y1: 1.44, xIn: 0.58, lt: 1.21 },
  hatch_pequeno: { z0: -0.71, z1: 0.48, y0: 0.27, y1: 1.36, xIn: 0.57, lt: 1.06 },
  sedan_compacto: { z0: -0.97, z1: 0.16, y0: 0.28, y1: 1.58, xIn: 0.65, lt: 1.2 },
  sedan: { z0: -1.08, z1: 0.14, y0: 0.28, y1: 1.43, xIn: 0.59, lt: 1.23 },
  hatch_compacto: { z0: -0.8, z1: 0.46, y0: 0.25, y1: 1.32, xIn: 0.53, lt: 1.02 },
  camioneta: { z0: -0.99, z1: 0.07, y0: 0.32, y1: 1.54, xIn: 0.67, lt: 1.28 },
  suv_compacta: { z0: -0.92, z1: 0.11, y0: 0.31, y1: 1.56, xIn: 0.67, lt: 1.28 },
  suv_mediana: { z0: -0.85, z1: 0.2, y0: 0.32, y1: 1.57, xIn: 0.71, lt: 1.35 },
};
REGIONES.taxi_pequeno = REGIONES.hatch_pequeno;
REGIONES.taxi_sedan = REGIONES.sedan_compacto;
REGIONES.policia = REGIONES.camioneta;

const linerMat = () => (linerMat.m ??= new THREE.MeshStandardMaterial({ color: PUERTA.liner, roughness: 0.95, side: THREE.BackSide }));
const panelMat = () => (panelMat.m ??= new THREE.MeshStandardMaterial({ color: PUERTA.panel, roughness: 0.8 }));
/** Materiales del forro (para calentar los programas antes de jugar). */
export function doorMaterials() {
  return [linerMat(), panelMat()];
}

// ------------------------------------------------ cortar una geometría por una región
const _p = new THREE.Vector3();
const TRI = [{ w: [1, 0, 0] }, { w: [0, 1, 0] }, { w: [0, 0, 1] }];

/**
 * Parte `geo` (coordenadas de la malla; `toRoot` la lleva al marco donde
 * están los `planes`) en lo que queda adentro de la región (todos los planos
 * [nx, ny, nz, d] con n·p <= d) y lo de afuera. Los triángulos que cruzan un
 * borde se cortan justo en el plano (todos los atributos interpolados).
 * Devuelve {inside, outside} (BufferGeometry sin índice, o null si vacío).
 */
export function splitGeometry(geo, toRoot, planes) {
  const pos = geo.attributes.position;
  const idx = geo.index;
  const n = idx ? idx.count : pos.count;
  const P = new Float64Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i).applyMatrix4(toRoot);
    P[i * 3] = _p.x;
    P[i * 3 + 1] = _p.y;
    P[i * 3 + 2] = _p.z;
  }
  const names = Object.keys(geo.attributes);
  const attrs = names.map((k) => geo.attributes[k]);
  const out = { inside: names.map(() => []), outside: names.map(() => []) };
  const counts = { inside: 0, outside: 0 };
  // Lectura directa de los arreglos (los atributos normales); los entrelazados
  // o normalizados (colores de vértice en bytes), por getComponent.
  const raw = attrs.map((at) => (!at.isInterleavedBufferAttribute && !at.normalized ? at.array : null));
  const emitVertex = (dst, a, b, c, w) => {
    const [wa, wb, wc] = w;
    for (let k = 0; k < attrs.length; k++) {
      const at = attrs[k];
      const n = at.itemSize;
      const arr = dst[k];
      const r = raw[k];
      if (r) for (let j = 0; j < n; j++) arr.push(r[a * n + j] * wa + r[b * n + j] * wb + r[c * n + j] * wc);
      else for (let j = 0; j < n; j++) arr.push(at.getComponent(a, j) * wa + at.getComponent(b, j) * wb + at.getComponent(c, j) * wc);
    }
  };
  const emitPoly = (which, poly, a, b, c) => {
    const dst = out[which];
    for (let i = 1; i + 1 < poly.length; i++) {
      emitVertex(dst, a, b, c, poly[0].w);
      emitVertex(dst, a, b, c, poly[i].w);
      emitVertex(dst, a, b, c, poly[i + 1].w);
      counts[which] += 3;
    }
  };
  const lerp = (u, v, t) => ({
    w: [u.w[0] + (v.w[0] - u.w[0]) * t, u.w[1] + (v.w[1] - u.w[1]) * t, u.w[2] + (v.w[2] - u.w[2]) * t],
    p: [u.p[0] + (v.p[0] - u.p[0]) * t, u.p[1] + (v.p[1] - u.p[1]) * t, u.p[2] + (v.p[2] - u.p[2]) * t],
  });
  const dist = (pl, v) => pl[0] * v.p[0] + pl[1] * v.p[1] + pl[2] * v.p[2] - pl[3];
  for (let i = 0; i < n; i += 3) {
    const a = idx ? idx.getX(i) : i;
    const b = idx ? idx.getX(i + 1) : i + 1;
    const c = idx ? idx.getX(i + 2) : i + 2;
    // Descarte rápido: del todo afuera de un plano, o del todo adentro de todos.
    let allIn = true;
    let anyOut = false;
    for (const pl of planes) {
      const da = pl[0] * P[a * 3] + pl[1] * P[a * 3 + 1] + pl[2] * P[a * 3 + 2] - pl[3];
      const db = pl[0] * P[b * 3] + pl[1] * P[b * 3 + 1] + pl[2] * P[b * 3 + 2] - pl[3];
      const dc = pl[0] * P[c * 3] + pl[1] * P[c * 3 + 1] + pl[2] * P[c * 3 + 2] - pl[3];
      if (da >= 0 && db >= 0 && dc >= 0) {
        anyOut = true;
        break;
      }
      if (da > 0 || db > 0 || dc > 0) allIn = false;
    }
    if (anyOut || allIn) {
      emitPoly(anyOut ? 'outside' : 'inside', TRI, a, b, c);
      continue;
    }
    let poly = [
      { w: [1, 0, 0], p: [P[a * 3], P[a * 3 + 1], P[a * 3 + 2]] },
      { w: [0, 1, 0], p: [P[b * 3], P[b * 3 + 1], P[b * 3 + 2]] },
      { w: [0, 0, 1], p: [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]] },
    ];
    for (const pl of planes) {
      if (poly.length < 3) break;
      const d = poly.map((v) => dist(pl, v));
      if (d.every((x) => x <= 0)) continue;
      if (d.every((x) => x >= 0)) {
        emitPoly('outside', poly, a, b, c);
        poly = [];
        break;
      }
      const inP = [];
      const outP = [];
      for (let k = 0; k < poly.length; k++) {
        const u = poly[k];
        const v = poly[(k + 1) % poly.length];
        const du = d[k];
        const dv = d[(k + 1) % poly.length];
        if (du <= 0) inP.push(u);
        if (du >= 0) outP.push(u);
        if ((du < 0 && dv > 0) || (du > 0 && dv < 0)) {
          const m = lerp(u, v, du / (du - dv));
          inP.push(m);
          outP.push(m);
        }
      }
      if (outP.length >= 3) emitPoly('outside', outP, a, b, c);
      poly = inP;
    }
    if (poly.length >= 3) emitPoly('inside', poly, a, b, c);
  }
  const build = (which) => {
    if (!counts[which]) return null;
    const g = new THREE.BufferGeometry();
    names.forEach((k, j) => g.setAttribute(k, new THREE.Float32BufferAttribute(out[which][j], attrs[j].itemSize)));
    return g;
  };
  return { inside: build('inside'), outside: build('outside') };
}

// ------------------------------------------------ la región de la puerta
/**
 * Región de la puerta del lado `side` (-1 conductor, a la izquierda; +1
 * copiloto) en el marco de la plantilla, medida contra el modelo: del arco de
 * la rueda de adelante al parante (donde el vidrio lateral se acaba), de la
 * altura del eje al techo y de la piel de afuera hasta un poco adentro del
 * vidrio. `ray(origin, dir)` da el primer impacto contra la carrocería
 * ({point, glass}) o null. Devuelve null si no se puede medir bien.
 */
export function doorRegion(tpl, side, ray) {
  const known = REGIONES[tpl.key];
  if (known) return { side, ...known, xOut: tpl.W / 2 };
  const front = tpl.wheels.find((w) => w.front);
  if (!front) return null;
  const r = front.pos.y;
  const z0 = front.pos.z + r + PUERTA.wheelGap;
  const y0 = r * PUERTA.sill;
  const y1 = tpl.roofY - PUERTA.roofGap;
  const yw = (CABINAS[tpl.key]?.belt ?? tpl.beltY) + 0.12; // a media ventana (la cintura medida: sim/carOccupants.js)
  const seat = tpl.seat;
  // Vidrio lateral a la altura de media ventana, desde el puesto hacia atrás: el parante.
  const from = new THREE.Vector3();
  const dir = new THREE.Vector3(-side, 0, 0);
  const sideHit = (z) => ray(from.set(side * (tpl.W + 1), yw, z), dir);
  const atSeat = sideHit(seat.z);
  let gx = atSeat?.glass ? Math.abs(atSeat.point.x) : null;
  let z1 = null;
  let sawGlass = !!atSeat?.glass;
  for (let z = seat.z - 0.3; z < seat.z + 1.2; z += 0.02) {
    const h = sideHit(z);
    if (h?.glass) {
      sawGlass = true;
      gx ??= Math.abs(h.point.x);
    } else if (sawGlass && z > seat.z) {
      z1 = z - PUERTA.pillarGap;
      break;
    }
  }
  if (gx === null || z1 === null) return null;
  z1 = Math.min(z1, z0 + PUERTA.maxLength);
  const xIn = Math.max(gx - PUERTA.innerGap, Math.abs(seat.x) + PUERTA.minInner);
  if (z1 - z0 < 0.6 || y1 - y0 < 0.6) return null;
  // Techo por dentro sobre la puerta (el forro no se asoma por un techo curvo).
  const top = ray(from.set(side * xIn, tpl.roofY + 1, seat.z), new THREE.Vector3(0, -1, 0));
  const lt = Math.min(y1, (top?.point.y ?? y1) - 0.06);
  return { side, z0, z1, y0, y1, xIn, xOut: tpl.W / 2, gx, lt };
}

/** Planos de la región (adentro: n·p <= d). */
function regionPlanes(R) {
  const s = R.side;
  // x del lado: s·x >= xIn  ->  -s·x <= -xIn
  return [
    [-s, 0, 0, -R.xIn],
    [0, 0, -1, -R.z0],
    [0, 0, 1, R.z1],
    [0, -1, 0, -R.y0],
    [0, 1, 0, R.y1],
  ];
}

// ------------------------------------------------ el juego de puerta por plantilla
/**
 * Arma (una vez por plantilla y lado; queda en tpl.doors[side]) la
 * carrocería con el hueco, la puerta aparte (con su bisagra) y el forro. null
 * si el modelo no se presta. `isGlass(material)` dice si un material es vidrio.
 */
export function doorKit(tpl, side, ray, register) {
  const doors = (tpl.doors ??= {});
  if (side in doors) return doors[side];
  doors[side] = null;
  if (PUERTA.skip.includes(tpl.cfg?.model) || tpl.cfg?.uniform) return null;
  const R = doorRegion(tpl, side, ray);
  if (!R) return null;
  const planes = regionPlanes(R);
  // Carrocería con el hueco: la misma jerarquía, con las mallas tocadas cambiadas.
  const body = tpl.body.clone(true);
  body.updateMatrixWorld(true);
  const doorParts = [];
  const meshes = [];
  body.traverse((o) => o.isMesh && meshes.push(o));
  let moved = 0;
  for (const o of meshes) {
    // (La carrocería de la plantilla no tiene padre: su mundo es el marco del carro.)
    const toRoot = o.matrixWorld.clone();
    const { inside, outside } = splitGeometry(o.geometry, toRoot, planes);
    if (!inside) continue;
    moved += inside.attributes.position.count / 3;
    // La parte de la puerta, en el marco de la plantilla (horneada).
    inside.applyMatrix4(toRoot);
    doorParts.push({ geometry: inside, material: o.material, key: o.material.name });
    if (outside) o.geometry = outside;
    else o.visible = false;
  }
  if (moved < 20) return null;
  // Calcomanías (franja del taxi, de la patrulla): lo que cae en la puerta se va con ella.
  const decals = [];
  for (const d of tpl.decals) {
    const { inside, outside } = splitGeometry(d.geometry, new THREE.Matrix4(), planes);
    decals.push({ outside, inside, material: d.material, src: d.geometry });
  }
  // Bisagra: el borde de adelante, en la piel de afuera.
  const hinge = new THREE.Vector3(side * R.xOut, 0, R.z0);
  for (const p of doorParts) p.geometry.translate(-hinge.x, 0, -hinge.z);
  for (const d of decals) d.inside?.translate(-hinge.x, 0, -hinge.z);
  // Forro: caja oscura vista por dentro (la cara del lado del hueco no se ve
  // de afuera), un poco más adentro que la piel; y la cara de adentro de la puerta.
  const xa = side * R.xIn;
  const xb = -side * (R.xIn - 0.02);
  const liner = new THREE.BoxGeometry(Math.abs(xa - xb), R.lt - R.y0 - 0.02, R.z1 - R.z0);
  liner.translate((xa + xb) / 2, (R.y0 + 0.02 + R.lt) / 2, (R.z0 + R.z1) / 2);
  const panelH = Math.max(0.2, tpl.beltY - R.y0 - 0.02);
  const panel = new THREE.PlaneGeometry(R.z1 - R.z0 - 0.04, panelH);
  // De cara hacia adentro del carro (cerrada); abierta, mira hacia atrás y afuera.
  panel.rotateY((-side * Math.PI) / 2);
  panel.translate(side * (R.xIn + 0.01) - hinge.x, R.y0 + panelH / 2 + 0.01, (R.z0 + R.z1) / 2 - hinge.z);
  const kit = { side, region: R, body, parts: doorParts, decals, hinge, liner, panel, tris: moved };
  register?.(kit);
  doors[side] = kit;
  return kit;
}

/**
 * La puerta de una instancia (render/vehicleMesh.js): se arma al abrir por
 * primera vez y se quita al cerrar. `materialFor(part)` devuelve el material
 * de esa pieza en la instancia (la pintura propia, las luces...).
 */
export class DoorRig {
  constructor(kit, materialFor) {
    this.kit = kit;
    this.group = new THREE.Group();
    this.body = kit.body.clone(true);
    this.body.traverse((o) => {
      if (o.isMesh) o.material = materialFor(o.material);
    });
    this.group.add(this.body);
    this.pivot = new THREE.Group();
    this.pivot.position.copy(kit.hinge);
    for (const p of kit.parts) {
      const m = new THREE.Mesh(p.geometry, materialFor(p.material));
      m.castShadow = true;
      m.receiveShadow = true;
      this.pivot.add(m);
    }
    for (const d of kit.decals) {
      if (d.inside) this.pivot.add(new THREE.Mesh(d.inside, d.material));
      if (d.outside) this.group.add(new THREE.Mesh(d.outside, d.material));
    }
    this.pivot.add(new THREE.Mesh(kit.panel, panelMat()));
    this.group.add(this.pivot);
    this.group.add(new THREE.Mesh(kit.liner, linerMat()));
  }

  /** Ángulo de la puerta: 0 cerrada .. 1 abierta del todo. */
  set(k) {
    // Izquierda (side -1): el borde de atrás sale hacia -x girando en -Y.
    this.pivot.rotation.y = this.kit.side * PUERTA.open * k;
  }
}
