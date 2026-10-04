// Vehículos: taxi amarillo, sedán, camioneta, patrulla de la Policía, buseta
// de barrio y moto. Usa modelos glTF externos (CC BY 4.0, ver
// ASSETS-CREDITS.md y scripts/assets/vehiculos.mjs) con materiales PBR
// propios (conservando las texturas del autor); si un modelo no cargó,
// construye la versión procedural (perfiles extruidos).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { textTexture } from './textures.js';
import { registerAssets } from './assetManifest.js';
import { assets } from './assets.js';
import { vehicleSpec } from '../sim/vehiclePhysics.js';
import { VEHICLE_VARIANTS, BOX_COLORS } from '../sim/vehicleVariants.js';
import { groundHeight, terrainHeight } from '../sim/terrain.js';

// Las vías se dibujan un poco por encima del terreno (cityRenderer: `lift` de
// _roads) y los andenes justo a la altura del sardinel (groundHeight). Las
// llantas se apoyan en lo que se ve: debe coincidir con ese `lift`.
export const ROAD_LIFT = 0.03;

/** Altura de la superficie dibujada (asfalto o andén) en (x, z). */
export function surfaceHeight(x, z) {
  const g = groundHeight(x, z);
  return g - terrainHeight(x, z) > 0.05 ? g : g + ROAD_LIFT;
}

const PAINTS = [0xc0c4c8, 0xf2f2f2, 0x9b1c1c, 0x111316, 0x1e3a6b, 0x4a4f55, 0x6b8f71, 0xb87333];

const cache = new Map();
const sharedSet = new Set(); // lo compartido entre vehículos: nunca se libera
function shared(key, make) {
  if (!cache.has(key)) {
    const v = make();
    cache.set(key, v);
    registerShared(v); // también lo que traiga adentro (listas de {geometry, material})
    sharedSet.add(v);
  }
  return cache.get(key);
}

/**
 * Libera un material propio de un vehículo (pintura con faros, calcomanías,
 * letreros…). Sin esto cada carro que sale del barrio dejaba sus materiales
 * vivos en el renderizador: con el tráfico entrando y saliendo se acumulaban
 * por miles y el juego se ponía a tironear a los pocos minutos.
 */
function releaseMaterial(m) {
  for (const mm of Array.isArray(m) ? m : [m]) {
    if (!mm || sharedSet.has(mm)) continue;
    // Texturas propias (letreros pintados para este carro) también.
    for (const k of ['map', 'emissiveMap']) {
      const t = mm[k];
      if (t && !sharedSet.has(t)) t.dispose();
    }
    mm.dispose();
  }
}

/** Marca como compartido todo lo de una plantilla (geometrías, materiales y texturas del modelo). */
function registerShared(obj, depth = 0) {
  if (!obj || depth > 4 || typeof obj !== 'object' || sharedSet.has(obj)) return;
  if (obj.isBufferGeometry || obj.isTexture) {
    sharedSet.add(obj);
    return;
  }
  if (obj.isMaterial) {
    sharedSet.add(obj);
    for (const k of ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap']) if (obj[k]) sharedSet.add(obj[k]);
    return;
  }
  if (obj.isObject3D) {
    obj.traverse((o) => {
      if (o.geometry) registerShared(o.geometry, depth + 1);
      if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) registerShared(m, depth + 1);
    });
    return;
  }
  for (const v of Array.isArray(obj) ? obj : Object.values(obj)) if (v && typeof v === 'object') registerShared(v, depth + 1);
}

const paint = (color) =>
  shared(`paint${color}`, () => new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }));
const glassMat = () => shared('glass', () => new THREE.MeshPhysicalMaterial({ color: 0x0e1418, metalness: 0.1, roughness: 0.04, clearcoat: 1, transparent: true, opacity: 0.88 }));
const tireMat = () => shared('tire', () => new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 }));
const rimMat = () => shared('rim', () => new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.9, roughness: 0.25 }));
const blackMat = () => shared('trim', () => new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.6 }));
const chromeMat = () => shared('chrome', () => new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 1, roughness: 0.12 }));

// ======================================================= modelos glTF externos
registerAssets(
  [...new Set(Object.values(VEHICLE_VARIANTS).map((v) => v.model))].map((m) => ({ key: `vehiculos/${m}`, type: 'gltf', url: `models/vehiculos/${m}.glb` })),
);

/**
 * Modelo de cada tipo. `hBlend` mezcla (en escala logarítmica) la altura que
 * resulta de conservar las proporciones del modelo (0) con la altura física
 * de VEHICLE_TYPES (1). `uniform` escala igual en los tres ejes (moto).
 * `seat`: puesto del conductor relativo al modelo ya escalado (x en fracción
 * del ancho, z en fracción del largo desde el centro, y = techo - drop).
 */
const MODEL_CFG = {
  taxi: { model: 'hatchback', hBlend: 0.3, seat: { x: -0.2, z: 0.02, drop: 1.1 } },
  sedan: { model: 'sedan', hBlend: 0.3, seat: { x: -0.21, z: 0.03, drop: 1.12 } },
  // Patrulla: camioneta tipo Renault Duster, como las de la Policía Nacional.
  policia: { model: 'suv', hBlend: 0.3, seat: { x: -0.21, z: 0.0, drop: 1.18 } },
  camioneta: { model: 'suv', hBlend: 0.3, seat: { x: -0.21, z: 0.0, drop: 1.18 } },
  buseta: { model: 'buseta', hBlend: 0.5, seat: { x: -0.24, z: -0.39, drop: 1.75 } },
  // Moto: el faro y el stop se añaden como mallas (medidas ya escaladas).
  moto: { model: 'moto', uniform: true, seatAbs: { x: 0, y: 0.26, z: 0.2 }, headY: 0.9, headZ: 0.24, tailY: 0.72, tailZ: 0.08 },
  // Variantes (ver sim/vehicleVariants.js).
  taxi_pequeno: { model: 'hatch_pequeno', hBlend: 0.3, seat: { x: -0.2, z: 0.02, drop: 1.05 } },
  taxi_sedan: { model: 'sedan_compacto', hBlend: 0.3, seat: { x: -0.21, z: 0.04, drop: 1.24 } },
  sedan_compacto: { model: 'sedan_compacto', hBlend: 0.3, seat: { x: -0.21, z: 0.04, drop: 1.24 } },
  hatch_pequeno: { model: 'hatch_pequeno', hBlend: 0.3, seat: { x: -0.2, z: 0.02, drop: 1.05 } },
  hatch_compacto: { model: 'hatch_compacto', hBlend: 0.3, seat: { x: -0.2, z: 0.04, drop: 1.05 } },
  clasico: { model: 'clasico', hBlend: 0.4, seat: { x: -0.2, z: -0.08, drop: 1.32 } },
  suv_compacta: { model: 'suv_compacta', hBlend: 0.3, seat: { x: -0.21, z: 0.02, drop: 0.98 } },
  suv_mediana: { model: 'suv_mediana', hBlend: 0.3, seat: { x: -0.21, z: 0.0, drop: 1.08 } },
  domicilio: { model: 'moto', uniform: true, seatAbs: { x: 0, y: 0.26, z: 0.2 }, headY: 0.9, headZ: 0.24, tailY: 0.72, tailZ: 0.08 },
  moto_2t: { model: 'moto_2t', uniform: true, seatAbs: { x: 0, y: 0.26, z: 0.16 }, headY: 0.92, headZ: 0.22, tailY: 0.74, tailZ: 0.1 },
  moto_enduro: { model: 'moto_enduro', uniform: true, seatAbs: { x: 0, y: 0.3, z: 0.12 }, headY: 1.0, headZ: 0.2, tailY: 0.8, tailZ: 0.1 },
  moto_tt: { model: 'moto_tt', uniform: true, seatAbs: { x: 0, y: 0.3, z: 0.18 }, headY: 1.02, headZ: 0.24, tailY: 0.82, tailZ: 0.2 },
  scooter: { model: 'scooter', uniform: true, seatAbs: { x: 0, y: 0.24, z: 0.2 }, headY: 0.9, headZ: 0.16, tailY: 0.72, tailZ: 0.06 },
};

/** Configuración del modelo de una variante (o la del tipo). */
const cfgOf = (type, variant) => (variant && MODEL_CFG[variant]) || MODEL_CFG[type];

// Materiales PBR compartidos por clave de material del modelo normalizado.
const MODEL_MATS = {
  vidrio: () => shared('m-vidrio', () => new THREE.MeshPhysicalMaterial({ color: 0x0b1115, metalness: 0.2, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03, transparent: true, opacity: 0.82, envMapIntensity: 1.4 })),
  negro: () => shared('m-negro', () => new THREE.MeshStandardMaterial({ color: 0x111213, roughness: 0.55, metalness: 0.1 })),
  plastico: () => shared('m-plastico', () => new THREE.MeshStandardMaterial({ color: 0x232426, roughness: 0.75 })),
  gris: () => shared('m-gris', () => new THREE.MeshStandardMaterial({ color: 0x3b3e42, roughness: 0.45, metalness: 0.5 })),
  cromo: () => chromeMat(),
  placa: () => shared('m-placa', () => new THREE.MeshStandardMaterial({ color: 0xe8d44a, roughness: 0.5 })),
  direccional: () => shared('m-direccional', () => new THREE.MeshStandardMaterial({ color: 0xd07010, emissive: 0xff8a1a, emissiveIntensity: 0.15, roughness: 0.25 })),
  caucho: () => shared('m-caucho', () => new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.92 })),
  rin: () => shared('m-rin', () => new THREE.MeshStandardMaterial({ color: 0xaeb2b6, metalness: 0.95, roughness: 0.22 })),
};

/**
 * Material compartido de una clave con la textura del modelo (si la trae):
 * mismo acabado PBR, color base blanco para que se vea la textura.
 */
function withMaps(base, src, key) {
  if (!src?.map) return base;
  return shared(`${key}-${src.map.uuid}`, () => {
    const m = base.clone();
    m.color.set(0xffffff);
    m.map = src.map;
    m.normalMap = src.normalMap ?? null;
    return m;
  });
}

/** Pintura con la textura del modelo (líneas de latas, sombreado). */
function paintFor(color, src) {
  if (!src?.map) return paint(color);
  return shared(`paint${color}-${src.map.uuid}`, () => {
    const m = paint(color).clone();
    m.map = src.map;
    m.normalMap = src.normalMap ?? null;
    return m;
  });
}

/** Faros/stops de una instancia: toman la textura del modelo (también como brillo). */
function lampMaps(lamp, src) {
  if (!src?.map || lamp.map) return;
  lamp.map = src.map;
  lamp.emissiveMap = src.map;
  lamp.color.set(0xffffff);
}

const headMat = () => new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff1d0, emissiveIntensity: 0.2, roughness: 0.1, metalness: 0.2 });
const tailMat = () => new THREE.MeshStandardMaterial({ color: 0x6a0000, emissive: 0xff1a1a, emissiveIntensity: 0.3, roughness: 0.3 });

/** Material de calcomanía (se pinta encima de la carrocería sin z-fighting). */
function decalMat(opts) {
  return new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, ...opts });
}

/** Texto sobre fondo transparente para calcomanías (POLICÍA, etc.). */
function labelTexture(text, color, { w = 512, h = 128, font = 'bold 92px Arial, sans-serif' } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font;
  ctx.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Franja de cuadros negros y blancos del taxi. */
function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 16;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 32; i++) {
    ctx.fillStyle = i % 2 ? '#111' : '#f4f4f4';
    ctx.fillRect(i * 8, 0, 8, 8);
    ctx.fillStyle = i % 2 ? '#f4f4f4' : '#111';
    ctx.fillRect(i * 8, 8, 8, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

const _ray = new THREE.Raycaster();
const _v = new THREE.Vector3();
/** Primer impacto de un rayo contra las mallas de `root` (espacio mundo). */
function hit(root, origin, dir) {
  _ray.set(origin, dir);
  _ray.far = 50;
  const h = _ray.intersectObject(root, true);
  return h.length ? h[0] : null;
}

/**
 * Puntos de manejo de la moto medidos en el modelo ya escalado (espacio del
 * vehículo, frente en -Z): superficie del asiento, puños del manubrio (los
 * extremos del manubrio, por debajo de los espejos) y estriberas del piloto.
 * El personaje (characterRig) pone ahí cadera, manos y pies.
 */
function motoRidePoints(body, seat, box) {
  const h = hit(body, _v.set(0, box.max.y + 1, seat.z), new THREE.Vector3(0, -1, 0));
  const seatY = h ? h.point.y : 0.93;
  const p = new THREE.Vector3();
  const grip = [null, null];
  const peg = [null, null];
  body.updateMatrixWorld(true);
  body.traverse((o) => {
    if (!o.isMesh) return;
    const a = o.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) {
      p.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld);
      const s = p.x < 0 ? 0 : 1;
      // Manubrio: delante del asiento, a la altura del tanque/tablero, sin los espejos (más altos).
      if (p.z < seat.z - 0.3 && p.z > seat.z - 0.9 && p.y > seatY && p.y < seatY + 0.22 && (!grip[s] || Math.abs(p.x) > Math.abs(grip[s].x))) grip[s] = p.clone();
      // Estriberas: lo más ancho a baja altura, cerca de la vertical del asiento.
      if (Math.abs(p.z - seat.z) < 0.3 && p.y > 0.2 && p.y < 0.42 && (!peg[s] || Math.abs(p.x) > Math.abs(peg[s].x))) peg[s] = p.clone();
    }
  });
  const inset = (v, d, fallback) => (v ? { x: v.x - Math.sign(v.x) * d, y: v.y, z: v.z } : fallback);
  return {
    seatY,
    seatZ: seat.z,
    // El puño ocupa los últimos ~12 cm del manubrio: la mano va en su centro.
    grips: [inset(grip[0], 0.07, { x: -0.34, y: 1.07, z: -0.32 }), inset(grip[1], 0.07, { x: 0.34, y: 1.07, z: -0.32 })],
    pegs: [inset(peg[0], 0.05, { x: -0.19, y: 0.32, z: 0.1 }), inset(peg[1], 0.05, { x: 0.19, y: 0.32, z: 0.1 })],
  };
}

const templates = new Map();

/**
 * Plantilla por tipo: carrocería escalada con materiales compartidos, ruedas,
 * calcomanías, techo y puesto. Se crea una vez; cada instancia la clona
 * (comparte geometrías y materiales, salvo pintura y luces).
 */
function modelTemplate(type, variant = null) {
  const key = variant && MODEL_CFG[variant] ? variant : type;
  if (templates.has(key)) return templates.get(key);
  const cfg = cfgOf(type, variant);
  const gltf = cfg && assets.gltf(`vehiculos/${cfg.model}`);
  const src = gltf?.scene?.getObjectByName('carroceria');
  // Sin modelo (no cargó o aún no se cargan los assets): respaldo procedural.
  if (!src) return null;
  const spec = vehicleSpec(type, variant);
  const root = src.parent;
  root.updateMatrixWorld(true);
  const bodyBox = new THREE.Box3().setFromObject(src);
  const size = bodyBox.getSize(new THREE.Vector3());
  const wheelSrc = root.children.filter((o) => o.name.startsWith('rueda'));
  const wheelBox = new THREE.Box3();
  for (const w of wheelSrc) wheelBox.expandByObject(w);
  // Ancho sin retrovisores: el de las ruedas con un pequeño margen.
  const modelW = cfg.uniform || wheelBox.isEmpty() ? size.x : Math.min(size.x, (wheelBox.max.x - wheelBox.min.x) * 1.06);
  const sL = spec.length / size.z;
  const sW = cfg.uniform ? sL : spec.width / modelW;
  const sH = cfg.uniform ? sL : Math.exp((1 - cfg.hBlend) * Math.log((sL + sW) / 2) + cfg.hBlend * Math.log(spec.height / bodyBox.max.y));
  const ws = cfg.uniform ? sL : (sL + sH) / 2;

  const body = new THREE.Group();
  body.name = 'carroceria';
  body.add(src.clone(true));
  body.scale.set(sW, sH, sL);
  body.traverse((o) => {
    if (!o.isMesh) return;
    const key = o.material.name;
    if (MODEL_MATS[key]) o.material = withMaps(MODEL_MATS[key](), o.material, key);
    // "textura" (detalles con la textura del autor) y "detalle" (colores de
    // vértice) se usan tal como vienen del modelo.
    o.castShadow = true;
    o.receiveShadow = true;
  });
  body.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(body);
  const L = box.max.z - box.min.z;
  const W = box.max.x - box.min.x;

  const wheels = wheelSrc.map((w) => {
    const wb = new THREE.Box3().setFromObject(w);
    const r = (wb.max.y - wb.min.y) / 2;
    const content = new THREE.Group();
    for (const c of w.children) content.add(c.clone(true));
    content.traverse((o) => {
      if (o.isMesh) {
        const key = o.material.name;
        if (MODEL_MATS[key]) o.material = withMaps(MODEL_MATS[key](), o.material, key);
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    content.scale.set(cfg.uniform ? sL : sW, ws, ws);
    const pos = new THREE.Vector3(w.position.x * sW, r * ws, w.position.z * sL);
    // Piezas que viran con esta rueda pero no giran (guardabarros y mordaza
    // de la moto): nodo "horquilla_*" con el origen en el mismo eje.
    const st = root.getObjectByName(w.name.replace('rueda_', 'horquilla_'));
    let steer = null;
    if (st) {
      steer = new THREE.Group();
      for (const c of st.children) steer.add(c.clone(true));
      steer.traverse((o) => {
        if (!o.isMesh) return;
        const key = o.material.name;
        if (MODEL_MATS[key]) o.material = withMaps(MODEL_MATS[key](), o.material, key);
        o.castShadow = true;
        o.receiveShadow = true;
      });
      steer.scale.set(sW, sH, sL);
      // Mismo punto del modelo que el eje de la rueda (con la escala de la carrocería).
      steer.position.set(st.position.x * sW - pos.x, st.position.y * sH - pos.y, st.position.z * sL - pos.z);
    }
    return { content, steer, pos, front: w.name.startsWith('rueda_del') };
  });

  // Techo: barrido de rayos hacia abajo por el eje central.
  let roofY = 0;
  const roofZ = [];
  const samples = [];
  for (let z = box.min.z; z <= box.max.z; z += 0.05) {
    const h = hit(body, _v.set(0, box.max.y + 1, z), new THREE.Vector3(0, -1, 0));
    if (h) samples.push([z, h.point.y]);
  }
  for (const [, y] of samples) roofY = Math.max(roofY, y);
  for (const [z, y] of samples) if (y > roofY - 0.05) roofZ.push(z);
  const roofCenterZ = roofZ.length ? (roofZ[0] + roofZ[roofZ.length - 1]) / 2 : 0;

  // Línea de cintura: parte baja de las ventanas laterales.
  let beltY = roofY * 0.62;
  body.traverse((o) => {
    if (o.isMesh && o.material === MODEL_MATS.vidrio()) {
      const b = new THREE.Box3().setFromObject(o);
      beltY = b.min.y;
    }
  });

  const tpl = { type, cfg, body, wheels, L, W, box, roofY, roofCenterZ, beltY, decals: [], sL };
  const paintMeshes = [];
  body.traverse((o) => o.isMesh && o.material.name === 'pintura' && paintMeshes.push(o));
  // Calcomanía lateral (ambos costados) proyectada sobre la pintura.
  const sideDecal = (material, y, z, len, hgt) => {
    for (const side of [-1, 1]) {
      const surf = hit(body, _v.set(side * (W + 1), y, z), new THREE.Vector3(-side, 0, 0));
      const x = surf ? surf.point.x : (side * W) / 2;
      for (const m of paintMeshes) {
        const g = new DecalGeometry(m, new THREE.Vector3(x, y, z), new THREE.Euler(0, (side * Math.PI) / 2, 0), new THREE.Vector3(len, hgt, 0.6));
        if (g.attributes.position.count) tpl.decals.push({ geometry: g, material });
      }
    }
  };
  tpl.sideDecal = sideDecal;
  if (type === 'taxi') {
    sideDecal(decalMat({ map: checkerTexture() }), beltY - 0.07, 0.1, L * 0.62, 0.075);
  } else if (type === 'policia') {
    sideDecal(decalMat({ color: 0x0b6b3a, roughness: 0.4 }), beltY - 0.3, 0, L * 0.94, 0.13);
    sideDecal(decalMat({ color: 0x0b6b3a, roughness: 0.4 }), beltY - 0.12, 0, L * 0.94, 0.035);
    sideDecal(decalMat({ map: labelTexture('POLICÍA', '#0b5a33') }), beltY - 0.21, 0.05, 1.25, 0.26);
  } else if (type === 'buseta') {
    // Las franjas de color varían por bus: se generan en la instancia.
    tpl.stripeY = [beltY - 0.3, beltY - 0.55];
  }
  // Puesto del conductor (lado izquierdo).
  if (cfg.seat) tpl.seat = { x: cfg.seat.x * W, y: roofY - cfg.seat.drop, z: cfg.seat.z * L };
  else tpl.seat = { ...(cfg.seatAbs ?? { x: 0, y: 0.34, z: 0.12 }) };
  if (type === 'moto') tpl.ride = motoRidePoints(body, tpl.seat, box);
  templates.set(key, tpl);
  registerShared(root);
  registerShared(tpl);
  return tpl;
}

/** Franjas de color de una buseta (compartidas por color). */
function busStripes(tpl, color) {
  return shared(`bus-stripes-${color}`, () => {
    const out = [];
    const saved = tpl.decals;
    tpl.decals = out;
    tpl.sideDecal(decalMat({ color, roughness: 0.3 }), tpl.stripeY[0], 0.2, tpl.L * 0.96, 0.2);
    tpl.sideDecal(decalMat({ color: 0xf7c600, roughness: 0.3 }), tpl.stripeY[1], 0.2, tpl.L * 0.96, 0.12);
    tpl.decals = saved;
    return out;
  });
}

function profileGeo(points, width, bevel = 0.06) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 4 });
  // Forma: X = largo (+X frente), Y = alto, Z = ancho -> vehículo: frente hacia -Z.
  g.rotateY(Math.PI / 2);
  g.translate(-(width - bevel * 2) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

// Perfiles laterales [largo, alto] con el frente en +X.
function bodyProfile(type, L) {
  const h = L / 2;
  switch (type) {
    case 'taxi':
      return {
        body: [[-h, 0.32], [-h, 0.95], [-h + 0.15, 1.0], [h - 0.75, 0.95], [h - 0.1, 0.8], [h, 0.55], [h - 0.05, 0.32]],
        cabin: [[-h + 0.12, 0.98], [-h + 0.3, 1.46], [h - 1.4, 1.48], [h - 0.78, 0.96]],
      };
    case 'camioneta':
    case 'policia':
      return {
        body: [[-h, 0.42], [-h, 1.08], [-h + 0.1, 1.12], [h - 0.95, 1.12], [h - 0.12, 1.02], [h, 0.7], [h - 0.05, 0.42]],
        cabin: [[-h + 0.12, 1.1], [-h + 0.25, 1.72], [h - 1.55, 1.74], [h - 1.0, 1.1]],
      };
    default:
      return {
        body: [[-h, 0.34], [-h, 0.86], [-h + 0.25, 0.94], [-h + 0.9, 0.95], [h - 1.1, 0.92], [h - 0.15, 0.78], [h, 0.52], [h - 0.05, 0.34]],
        cabin: [[-h + 0.85, 0.93], [-h + 1.35, 1.38], [h - 1.75, 1.4], [h - 1.12, 0.92]],
      };
  }
}

export class VehicleView {
  constructor(type, opts = {}) {
    this.type = type;
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    this.chassis = new THREE.Group();
    this.group.add(this.chassis);
    this.wheels = [];
    this.frontPivots = [];
    this.lights = { head: null, tail: null, bar: [] };
    this.color = opts.color ?? PAINTS[Math.floor(Math.random() * PAINTS.length)];
    this.lights.sign = null;
    this.variant = opts.variant ?? null;
    const tpl = opts.procedural ? null : modelTemplate(type, this.variant);
    this.fromModel = !!tpl;
    if (tpl) this._buildFromModel(tpl, opts);
    else if (type === 'moto') this._buildMoto(opts);
    else if (type === 'buseta') this._buildBus(opts);
    else this._buildCar(type, opts);
    if (!tpl) {
      this.group.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
    }
    this.sirenPhase = 0;
    this.burnt = false;
  }

  /** Letrero TAXI iluminado sobre el techo (y = base del letrero). */
  _taxiSign(y, z) {
    const signMat = shared('taxi-sign', () => {
      const signTex = textTexture('TAXI', { w: 256, h: 96, bg: '#ffffff', fg: '#111111', font: 'bold 70px Arial', border: '#111111' });
      return new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.3 });
    }).clone();
    const geo = shared('taxi-sign-geo', () => new RoundedBoxGeometry(0.55, 0.2, 0.25, 2, 0.03));
    const sign = new THREE.Mesh(geo, [blackMat(), blackMat(), blackMat(), blackMat(), signMat, signMat]);
    sign.position.set(0, y + 0.1, z);
    sign.castShadow = true;
    this.chassis.add(sign);
    this.lights.sign = signMat;
  }

  /** Barra de luces roja/azul de la patrulla (y = base de la barra). */
  _sirenBar(y, z, width = 1.2) {
    const bar = new THREE.Group();
    const base = new THREE.Mesh(shared(`bar-base${width}`, () => new RoundedBoxGeometry(width, 0.08, 0.3, 2, 0.03)), blackMat());
    base.position.y = 0.04;
    bar.add(base);
    const lensGeo = shared(`bar-lens${width}`, () => new RoundedBoxGeometry(width * 0.4, 0.12, 0.26, 2, 0.04));
    for (const [x, c] of [[-width * 0.26, 0xff0000], [width * 0.26, 0x0044ff]]) {
      const m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.1, transparent: true, opacity: 0.9, roughness: 0.2 });
      const l = new THREE.Mesh(lensGeo, m);
      l.position.set(x, 0.13, 0);
      bar.add(l);
      this.lights.bar.push(m);
    }
    bar.position.set(0, y, z);
    bar.traverse((o) => o.isMesh && (o.castShadow = true));
    this.chassis.add(bar);
  }

  /**
   * Caja térmica de domicilios en la parrilla, detrás del conductor: un color
   * de plataforma, tapa y franja reflectiva, sin logos.
   */
  _deliveryBox(tpl, opts) {
    const color = opts.boxColor ?? BOX_COLORS[Math.floor(Math.random() * BOX_COLORS.length)];
    const shell = shared(`box-${color}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
    const dark = shared('box-lid', () => new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.7 }));
    const band = shared('box-band', () => new THREE.MeshStandardMaterial({ color: 0xd8dadc, roughness: 0.25, metalness: 0.6 }));
    const g = new THREE.Group();
    const body = new THREE.Mesh(shared('box-geo', () => new RoundedBoxGeometry(0.44, 0.4, 0.42, 2, 0.04)), shell);
    body.position.y = 0.2;
    const lid = new THREE.Mesh(shared('box-lid-geo', () => new RoundedBoxGeometry(0.46, 0.05, 0.44, 2, 0.02)), dark);
    lid.position.y = 0.41;
    const strip = new THREE.Mesh(shared('box-band-geo', () => new THREE.BoxGeometry(0.445, 0.035, 0.425)), band);
    strip.position.y = 0.12;
    g.add(body, lid, strip);
    // Sobre la parrilla: un poco más atrás del sillín, apoyada a su altura.
    g.position.set(0, tpl.ride.seatY - 0.02, Math.min(tpl.box.max.z - 0.24, tpl.seat.z + 0.5));
    g.traverse((o) => o.isMesh && ((o.castShadow = true), (o.receiveShadow = true)));
    this.chassis.add(g);
  }

  /** Vehículo a partir del modelo glTF normalizado (ver modelTemplate). */
  _buildFromModel(tpl, opts) {
    const type = this.type;
    let color = this.color;
    if (type === 'taxi') color = 0xf7c600;
    else if (type === 'policia') color = 0xf4f4f4;
    else if (type === 'buseta') color = 0xf2f2f2;
    else if (type === 'moto') color = opts.color ?? [0xd62828, 0x111111, 0x1d3557, 0xf2f2f2, 0x2a9d8f][Math.floor(Math.random() * 5)];
    this.color = color;
    const head = headMat();
    const tail = tailMat();
    this.lights.head = head;
    this.lights.tail = tail;
    const body = tpl.body.clone(true);
    let hasHead = false;
    let hasTail = false;
    body.traverse((o) => {
      if (!o.isMesh) return;
      const key = o.material.name;
      if (key === 'pintura') o.material = this.paint ??= paintFor(color, o.material);
      else if (key === 'faro') {
        lampMaps(head, o.material);
        o.material = head;
        hasHead = true;
      } else if (key === 'stop') {
        lampMaps(tail, o.material);
        o.material = tail;
        hasTail = true;
      }
    });
    this.paint ??= paint(color);
    this.chassis.add(body);
    const decals = type === 'buseta' ? [...tpl.decals, ...busStripes(tpl, opts.color ?? [0x1d4e89, 0xd62828, 0x2a9d8f, 0xf4a261][Math.floor(Math.random() * 4)])] : tpl.decals;
    for (const d of decals) {
      const m = new THREE.Mesh(d.geometry, d.material);
      m.receiveShadow = true;
      this.chassis.add(m);
    }
    for (const w of tpl.wheels) {
      const pivot = new THREE.Group();
      pivot.position.copy(w.pos);
      const spin = new THREE.Group();
      spin.add(w.content.clone(true));
      pivot.add(spin);
      if (w.steer) pivot.add(w.steer.clone(true));
      this.group.add(pivot);
      this.wheels.push(spin);
      if (w.front) this.frontPivots.push(pivot);
    }
    if (type === 'taxi') this._taxiSign(tpl.roofY - 0.01, tpl.roofCenterZ);
    if (type === 'policia') this._sirenBar(tpl.roofY - 0.01, tpl.roofCenterZ, Math.min(1.2, tpl.W * 0.62));
    if (type === 'buseta') {
      // Letrero de ruta sobre el parabrisas.
      const y = tpl.roofY - 0.28;
      const front = hit(body, _v.set(0, y, tpl.box.min.z - 2), new THREE.Vector3(0, 0, 1));
      const destMat = shared('bus-dest', () => {
        const t = textTexture('ARANJUEZ - CENTRO', { w: 1024, h: 128, bg: '#111111', fg: '#ffb000', font: 'bold 80px Arial', border: '#111111' });
        return new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.6 });
      }).clone();
      const dest = new THREE.Mesh(shared('bus-dest-geo', () => new THREE.PlaneGeometry(1, 0.24)), destMat);
      dest.scale.x = tpl.W - 0.5;
      dest.position.set(0, y, (front ? front.point.z : tpl.box.min.z) - 0.02);
      dest.rotation.y = Math.PI;
      this.chassis.add(dest);
      this.lights.sign = destMat;
    }
    if (type === 'moto') {
      // Faro y stop, si el modelo no los trae como materiales separados.
      if (!hasHead) {
        const hl = new THREE.Mesh(shared('moto-hl', () => new THREE.CylinderGeometry(0.07, 0.07, 0.04, 16).rotateX(Math.PI / 2)), head);
        hl.position.set(0, tpl.cfg.headY ?? 0.86, tpl.box.min.z + (tpl.cfg.headZ ?? 0.42));
        this.chassis.add(hl);
      }
      if (!hasTail) {
        const tl = new THREE.Mesh(shared('moto-tl', () => new THREE.BoxGeometry(0.12, 0.05, 0.03)), tail);
        tl.position.set(0, tpl.cfg.tailY ?? 0.62, tpl.box.max.z - (tpl.cfg.tailZ ?? 0.06));
        this.chassis.add(tl);
      }
    }
    if (VEHICLE_VARIANTS[this.variant]?.box && tpl.ride) this._deliveryBox(tpl, opts);
    this.seat = { ...tpl.seat };
    // Para el personaje que la maneja (characterRig lee group.userData.ride).
    if (tpl.ride) this.group.userData.ride = { ...tpl.ride, speed: 0 };
  }

  _lights(width, L, frontY, rearY) {
    const head = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff1d0, emissiveIntensity: 0.2, roughness: 0.1 });
    const tail = new THREE.MeshStandardMaterial({ color: 0x6a0000, emissive: 0xff1a1a, emissiveIntensity: 0.3, roughness: 0.3 });
    const hg = new THREE.BoxGeometry(0.32, 0.12, 0.06);
    for (const s of [-1, 1]) {
      const hl = new THREE.Mesh(hg, head);
      hl.position.set(s * (width / 2 - 0.25), frontY, -L / 2 - 0.01);
      const tl = new THREE.Mesh(hg, tail);
      tl.position.set(s * (width / 2 - 0.22), rearY, L / 2 + 0.01);
      this.chassis.add(hl, tl);
    }
    this.lights.head = head;
    this.lights.tail = tail;
  }

  _wheel(x, z, r, w, front) {
    const pivot = new THREE.Group();
    pivot.position.set(x, r, z);
    const spin = new THREE.Group();
    const tire = new THREE.Mesh(shared(`tire${r}-${w}`, () => new THREE.CylinderGeometry(r, r, w, 20).rotateZ(Math.PI / 2)), tireMat());
    const rim = new THREE.Mesh(shared(`rim${r}-${w}`, () => new THREE.CylinderGeometry(r * 0.62, r * 0.62, w + 0.02, 12).rotateZ(Math.PI / 2)), rimMat());
    spin.add(tire, rim);
    pivot.add(spin);
    this.group.add(pivot);
    this.wheels.push(spin);
    if (front) this.frontPivots.push(pivot);
  }

  _buildCar(type, opts) {
    const dims = {
      taxi: [4.0, 1.73],
      sedan: [4.45, 1.77],
      camioneta: [4.4, 1.85],
      policia: [4.4, 1.85],
    }[type];
    const [L, W] = dims;
    const color = type === 'taxi' ? 0xf7c600 : type === 'policia' ? 0xf4f4f4 : this.color;
    this.color = color;
    const prof = bodyProfile(type, L);
    this.paint = paint(color);
    const body = new THREE.Mesh(profileGeo(prof.body, W), this.paint);
    const cabin = new THREE.Mesh(profileGeo(prof.cabin, W * 0.86, 0.05), glassMat());
    this.chassis.add(body, cabin);
    // Techo pintado sobre el vidrio.
    const roofY = prof.cabin[1][1];
    const roofL = prof.cabin[2][0] - prof.cabin[1][0];
    const roof = new THREE.Mesh(new RoundedBoxGeometry(W * 0.84, 0.06, roofL + 0.1, 2, 0.02), this.paint);
    roof.position.set(0, roofY + 0.01, -(prof.cabin[1][0] + prof.cabin[2][0]) / 2);
    this.chassis.add(roof);
    // Parachoques y retrovisores.
    for (const z of [-L / 2 - 0.02, L / 2 + 0.02]) {
      const bump = new THREE.Mesh(new RoundedBoxGeometry(W * 0.98, 0.18, 0.12, 2, 0.04), blackMat());
      bump.position.set(0, prof.body[0][1] + 0.05, z);
      this.chassis.add(bump);
    }
    for (const s of [-1, 1]) {
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.08), this.paint);
      mirror.position.set(s * (W / 2 + 0.06), prof.cabin[0][1] + 0.12, -(prof.cabin[3][0]) + 0.1);
      this.chassis.add(mirror);
    }
    // Rejilla frontal.
    const grille = new THREE.Mesh(new THREE.BoxGeometry(W * 0.45, 0.14, 0.04), chromeMat());
    grille.position.set(0, prof.body[0][1] + 0.3, -L / 2 - 0.02);
    this.chassis.add(grille);
    this._lights(W, L, prof.body[0][1] + 0.35, prof.body[0][1] + 0.45);

    if (type === 'taxi') {
      this._taxiSign(roofY + 0.04, roof.position.z);
      // Franja de cuadros en los costados.
      const checker = document.createElement('canvas');
      checker.width = 128;
      checker.height = 16;
      const ctx = checker.getContext('2d');
      for (let i = 0; i < 16; i++) {
        ctx.fillStyle = i % 2 ? '#111' : '#fff';
        ctx.fillRect(i * 8, 0, 8, 8);
        ctx.fillStyle = i % 2 ? '#fff' : '#111';
        ctx.fillRect(i * 8, 8, 8, 8);
      }
      const ct = new THREE.CanvasTexture(checker);
      ct.magFilter = THREE.NearestFilter;
      for (const s of [-1, 1]) {
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.7, 0.1), new THREE.MeshStandardMaterial({ map: ct }));
        strip.rotation.y = s * Math.PI / 2;
        strip.position.set(s * (W / 2 + 0.005), 0.75, 0.05);
        this.chassis.add(strip);
      }
    }
    if (type === 'policia') {
      for (const s of [-1, 1]) {
        const stripe = new THREE.Mesh(new THREE.PlaneGeometry(L * 0.9, 0.22), new THREE.MeshStandardMaterial({ color: 0x0b6b3a }));
        stripe.rotation.y = s * Math.PI / 2;
        stripe.position.set(s * (W / 2 + 0.005), 0.8, 0);
        this.chassis.add(stripe);
        const labelTex = textTexture('POLICÍA', { w: 512, h: 128, bg: '#f4f4f4', fg: '#0b6b3a', font: 'bold 90px Arial', border: '#f4f4f4' });
        const label = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35), new THREE.MeshStandardMaterial({ map: labelTex }));
        label.rotation.y = s * Math.PI / 2;
        label.position.set(s * (W / 2 + 0.006), 1.0, 0.2);
        if (s < 0) label.scale.x = 1;
        this.chassis.add(label);
      }
      this._sirenBar(roofY + 0.05, roof.position.z, 1.2);
    }

    const r = type === 'camioneta' || type === 'policia' ? 0.38 : 0.32;
    const wb = { taxi: 2.5, sedan: 2.75, camioneta: 2.75, policia: 2.75 }[type];
    for (const s of [-1, 1]) {
      this._wheel(s * (W / 2 - 0.12), -wb / 2, r, 0.22, true);
      this._wheel(s * (W / 2 - 0.12), wb / 2, r, 0.22, false);
    }
    this.seat = { x: -0.38, y: 0.35, z: 0.1 };
    // Conductor al lado izquierdo (Colombia).
  }

  _buildBus(opts) {
    const L = 7.8;
    const W = 2.3;
    const colors = [0x1d4e89, 0xd62828, 0x2a9d8f, 0xf4a261];
    const base = opts.color ?? colors[Math.floor(Math.random() * colors.length)];
    this.paint = paint(0xf2f2f2);
    const body = new THREE.Mesh(new RoundedBoxGeometry(W, 2.35, L, 3, 0.18), this.paint);
    body.position.y = 1.55;
    this.chassis.add(body);
    const stripeMat = paint(base);
    for (const y of [0.75, 1.1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, 0.18, L - 0.3), y === 0.75 ? stripeMat : paint(0xf7c600));
      stripe.position.y = y;
      this.chassis.add(stripe);
    }
    const win = new THREE.Mesh(new THREE.BoxGeometry(W + 0.03, 0.8, L - 1.6), glassMat());
    win.position.set(0, 2.05, 0.4);
    const wind = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 1.0, 0.05), glassMat());
    wind.position.set(0, 1.95, -L / 2 - 0.01);
    this.chassis.add(win, wind);
    const destTex = textTexture('ARANJUEZ - CENTRO', { w: 1024, h: 128, bg: '#111111', fg: '#ffb000', font: 'bold 80px Arial', border: '#111111' });
    const dest = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.3, 0.25), new THREE.MeshStandardMaterial({ map: destTex, emissive: 0xffffff, emissiveMap: destTex, emissiveIntensity: 0.6 }));
    dest.position.set(0, 2.6, -L / 2 - 0.03);
    dest.rotation.y = Math.PI;
    this.chassis.add(dest);
    this._lights(W, L, 0.8, 0.9);
    for (const s of [-1, 1]) {
      this._wheel(s * (W / 2 - 0.2), -L / 2 + 1.5, 0.48, 0.3, true);
      this._wheel(s * (W / 2 - 0.2), L / 2 - 1.6, 0.48, 0.3, false);
    }
    this.seat = { x: -0.6, y: 0.9, z: -L / 2 + 1.2 };
  }

  _buildMoto(opts) {
    const color = opts.color ?? [0xd62828, 0x111111, 0x1d3557, 0xf2f2f2, 0x2a9d8f][Math.floor(Math.random() * 5)];
    this.paint = paint(color);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 1.1), blackMat());
    frame.position.set(0, 0.55, 0);
    frame.rotation.x = 0.15;
    const tank = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.22, 0.5, 2, 0.08), this.paint);
    tank.position.set(0, 0.82, -0.2);
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.1, 0.6, 2, 0.04), blackMat());
    seat.position.set(0, 0.85, 0.32);
    const engine = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.35), chromeMat());
    engine.position.set(0, 0.45, 0.0);
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8), chromeMat());
    fork.position.set(0, 0.65, -0.72);
    fork.rotation.x = -0.35;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7).rotateZ(Math.PI / 2), blackMat());
    bar.position.set(0, 1.05, -0.62);
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.6).rotateX(Math.PI / 2), chromeMat());
    exhaust.position.set(0.16, 0.38, 0.35);
    const fender = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.5), this.paint);
    fender.position.set(0, 0.68, 0.72);
    this.chassis.add(frame, tank, seat, engine, fork, bar, exhaust, fender);
    const head = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff1d0, emissiveIntensity: 0.2 });
    const tail = new THREE.MeshStandardMaterial({ color: 0x6a0000, emissive: 0xff1a1a, emissiveIntensity: 0.3 });
    const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.06, 12).rotateX(Math.PI / 2), head);
    hl.position.set(0, 0.95, -0.8);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.04), tail);
    tl.position.set(0, 0.8, 0.98);
    this.chassis.add(hl, tl);
    this.lights.head = head;
    this.lights.tail = tail;
    this._wheel(0, -0.72, 0.3, 0.1, true);
    this._wheel(0, 0.68, 0.3, 0.12, false);
    this.seat = { x: 0, y: 0.45, z: 0.25 };
  }

  /** Sincroniza con el estado de la simulación. */
  sync(v, dt, night, siren = false) {
    this._fitGround(v, dt);
    for (const w of this.wheels) w.rotation.x = -v.wheelSpin;
    if (this.group.userData.ride) this.group.userData.ride.speed = v.forwardSpeed;
    if (this.lights.head) this.lights.head.emissiveIntensity = 0.2 + night * 4;
    if (this.lights.tail) {
      const braking = v.throttle === 0 && Math.abs(v.forwardSpeed) > 0.5;
      this.lights.tail.emissiveIntensity = 0.3 + night * 1.2 + (braking ? 2.5 : 0);
    }
    if (this.lights.sign) this.lights.sign.emissiveIntensity = 0.3 + night * 1.5;
    if (this.lights.bar.length) {
      this.sirenPhase += dt * 8;
      const on = siren ? Math.sin(this.sirenPhase) > 0 : false;
      this.lights.bar[0].emissiveIntensity = siren ? (on ? 6 : 0.2) : 0.1;
      this.lights.bar[1].emissiveIntensity = siren ? (on ? 0.2 : 6) : 0.1;
    }
    if (v.destroyed && !this.burnt) this.burn();
  }

  /**
   * Apoya las llantas en la superficie que se ve (asfalto con su `lift`,
   * andén con su sardinel), también en las pendientes y con los vehículos
   * parqueados (cuya física no corre): altura, cabeceo y alabeo salen de la
   * superficie bajo cada rueda. El cabeceo/balanceo de la suspensión
   * (bodyPitch/bodyRoll) mueve la carrocería y al conductor, no las ruedas; la
   * inclinación de la moto en las curvas sí incluye las ruedas.
   */
  _fitGround(v, dt) {
    const piv = this.wheels.map((w) => w.parent);
    const n = piv.length;
    const g = this.group;
    if (!n) {
      g.position.set(v.x, v.y, v.z);
      g.rotation.set(v.pitch + (v.bodyPitch ?? 0), v.heading, v.roll + (v.lean ?? 0) + (v.bodyRoll ?? 0));
      return;
    }
    if (!this._fit) {
      this._fit = { h: new Float32Array(n), base: piv.map((p) => p.position.clone()), init: false, qa: new THREE.Quaternion(), qb: new THREE.Quaternion(), qs: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, 'YXZ'), up: new THREE.Vector3(0, 1, 0) };
    }
    const F = this._fit;
    const c = Math.cos(v.heading);
    const sn = Math.sin(v.heading);
    // Superficie bajo el punto de apoyo de cada rueda (x, z locales -> mundo).
    let mx = 0;
    let mz = 0;
    let mh = 0;
    const k = F.init ? 1 - Math.exp(-30 * dt) : 1;
    for (let i = 0; i < n; i++) {
      const b = F.base[i];
      const wx = v.x + b.x * c + b.z * sn;
      const wz = v.z - b.x * sn + b.z * c;
      const h = surfaceHeight(wx, wz);
      F.h[i] = Math.abs(h - F.h[i]) > 1 ? h : F.h[i] + (h - F.h[i]) * k;
      mx += b.x;
      mz += b.z;
      mh += F.h[i];
    }
    F.init = true;
    mx /= n;
    mz /= n;
    mh /= n;
    // Plano por mínimos cuadrados: h = y0 + a·x + b·z (locales).
    let sxx = 0;
    let szz = 0;
    let sxh = 0;
    let szh = 0;
    for (let i = 0; i < n; i++) {
      const dx = F.base[i].x - mx;
      const dz = F.base[i].z - mz;
      const dh = F.h[i] - mh;
      sxx += dx * dx;
      szz += dz * dz;
      sxh += dx * dh;
      szh += dz * dh;
    }
    const a = sxx > 0.05 ? sxh / sxx : 0; // alabeo (moto: 0)
    const bz = szz > 0.05 ? szh / szz : 0;
    const pitch = Math.atan(-bz); // frente en -Z: sube si el frente está más alto
    const roll = Math.atan(a);
    const y0 = mh - a * mx - bz * mz;
    g.position.set(v.x, y0, v.z);
    // Suelo (+ inclinación de la moto) y, aparte, la suspensión.
    const lean = v.lean ?? 0;
    const e = F.e;
    F.qa.setFromEuler(e.set(pitch, v.heading, roll + lean));
    const bp = v.bodyPitch ?? 0;
    const br = v.bodyRoll ?? 0;
    g.rotation.set(pitch + bp, v.heading, roll + lean + br);
    // Corrección de las ruedas: C = full⁻¹ · suelo (deshace la suspensión).
    F.qb.copy(g.quaternion).invert().multiply(F.qa);
    for (let i = 0; i < n; i++) {
      const p = piv[i];
      p.position.copy(F.base[i]).applyQuaternion(F.qb);
      p.quaternion.copy(F.qb);
    }
    for (const p of this.frontPivots) p.quaternion.multiply(F.qs.setFromAxisAngle(F.up, -v.steer));
  }

  burn() {
    this.burnt = true;
    const burnt = shared('burnt', () => new THREE.MeshStandardMaterial({ color: 0x151210, roughness: 1 }));
    const keep = new Set([tireMat(), MODEL_MATS.caucho()]);
    this.group.traverse((o) => {
      if (o.isMesh && !keep.has(o.material)) {
        releaseMaterial(o.material);
        o.material = burnt;
      }
    });
    for (const m of this.lights.bar) m.emissiveIntensity = 0;
  }

  dispose() {
    this.group.removeFromParent();
    const seen = new Set();
    this.group.traverse((o) => {
      if (!o.isMesh) return;
      if (o.geometry && !sharedSet.has(o.geometry)) o.geometry.dispose();
      if (seen.has(o.material)) return;
      seen.add(o.material);
      releaseMaterial(o.material);
    });
  }
}
