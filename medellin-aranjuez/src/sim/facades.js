// Fachadas de las casas del barrio, casa por casa: dónde van puertas,
// ventanas, garajes y locales según el ancho y los pisos de cada casa, con
// los detalles típicos de Aranjuez y Moravia (ladrillo farol con vigas y
// columnas de concreto a la vista, zócalo enchapado, rejas, cortinas,
// balcones, la puerta aparte para subir al segundo piso, el local con
// cortina metálica). Puro y determinista: render/facadeBuilder.js solo
// convierte esta descripción en geometría.

import { makeRng } from './rng.js';
import { clamp } from './math.js';

/** Estilos de casa que se dibujan con fachada modelada. */
export const MODELED_STYLES = new Set(['ladrillo', 'pintada', 'tienda', 'torre']);

export const FACADE = {
  margin: 0.45, // de la esquina al primer hueco (deja ver la columna)
  column: 0.28, // ancho de la columna de concreto en las esquinas
  band: 0.22, // alto de la viga de borde de placa entre pisos
  door: [0.95, 2.2],
  garage: [2.7, 2.4],
  shopH: 2.65,
  sillH: 0.95, // antepecho de las ventanas
  winH: 1.35,
};

// Nombres genéricos de negocios de barrio (inventados, sin marcas).
export const SHOPS = [
  ['Tienda Doña Rosa', 'tienda'],
  ['Tienda Mi Barrio', 'tienda'],
  ['Minimercado La 92', 'tienda'],
  ['Miscelánea La Esquina', 'tienda'],
  ['Granero El Surtidor', 'tienda'],
  ['Panadería El Trigal', 'panaderia'],
  ['Panadería Pan de Oro', 'panaderia'],
  ['Droguería San Nicolás', 'drogueria'],
  ['Droguería La Salud', 'drogueria'],
  ['Carnicería La Mejor', 'carniceria'],
  ['Frutería La Cosecha', 'fruteria'],
  ['Legumbrería La Huerta', 'fruteria'],
  ['Peluquería Estilos', 'peluqueria'],
  ['Barbería El Parce', 'peluqueria'],
  ['Ferretería El Tornillo', 'ferreteria'],
  ['Cacharrería Todo a Mil', 'ferreteria'],
  ['Papelería El Estudiante', 'papeleria'],
  ['Fotocopias y Minutos', 'papeleria'],
  ['Heladería La Delicia', 'heladeria'],
  ['Cafetería El Tinto', 'cafeteria'],
  ['Arepas Doña Gloria', 'cafeteria'],
  ['Asadero El Fogón', 'cafeteria'],
  ['Billares El Parche', 'billares'],
  ['Remontadora La Horma', 'ferreteria'],
];

/** Color de la carpintería de aluminio: natural, bronce, blanco, negro. */
export const FRAME_COLORS = [
  [0.72, 0.74, 0.76],
  [0.34, 0.25, 0.17],
  [0.9, 0.9, 0.88],
  [0.12, 0.12, 0.13],
];
/** Color de rejas y puertas metálicas: negro, blanco, verde, café, gris. */
export const METAL_COLORS = [
  [0.1, 0.1, 0.1],
  [0.9, 0.9, 0.88],
  [0.16, 0.36, 0.22],
  [0.32, 0.2, 0.12],
  [0.45, 0.47, 0.5],
];
/** Zócalos pintados (la franja de abajo de otro color). */
export const ZOCALO_COLORS = [
  [0.18, 0.3, 0.62],
  [0.62, 0.14, 0.12],
  [0.18, 0.42, 0.28],
  [0.35, 0.33, 0.31],
  [0.95, 0.95, 0.93],
  [0.55, 0.38, 0.22],
];
/** Cortinas de las ventanas. */
export const CURTAIN_COLORS = [
  [0.93, 0.88, 0.76],
  [0.76, 0.3, 0.27],
  [0.42, 0.55, 0.69],
  [0.89, 0.76, 0.35],
  [0.96, 0.95, 0.92],
  [0.54, 0.44, 0.62],
  [0.38, 0.6, 0.45],
];

/**
 * Marco de una cara del edificio: origen en su extremo izquierdo visto desde
 * afuera, dirección `r` a lo largo de la fachada y normal hacia la calle.
 */
export function faceFrame(b, side) {
  const f = b.frame;
  if (f) {
    // Rectángulo orientado: 'S' = frente (hacia la calle), 'N' = fondo,
    // 'W' / 'E' = costados izquierdo / derecho vistos desde la calle.
    const { x, z, nx, nz, ux, uz, hu, hv } = f;
    switch (side) {
      case 'S':
        return { x0: x - ux * hu + nx * hv, z0: z - uz * hu + nz * hv, nx, nz, rx: ux, rz: uz, len: 2 * hu };
      case 'N':
        return { x0: x + ux * hu - nx * hv, z0: z + uz * hu - nz * hv, nx: -nx, nz: -nz, rx: -ux, rz: -uz, len: 2 * hu };
      case 'W':
        return { x0: x - ux * hu - nx * hv, z0: z - uz * hu - nz * hv, nx: -ux, nz: -uz, rx: nx, rz: nz, len: 2 * hv };
      default:
        return { x0: x + ux * hu + nx * hv, z0: z + uz * hu + nz * hv, nx: ux, nz: uz, rx: -nx, rz: -nz, len: 2 * hv };
    }
  }
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  switch (side) {
    case 'N':
      return { x0: b.maxX, z0: b.minZ, nx: 0, nz: -1, rx: -1, rz: 0, len: w };
    case 'S':
      return { x0: b.minX, z0: b.maxZ, nx: 0, nz: 1, rx: 1, rz: 0, len: w };
    case 'W':
      return { x0: b.minX, z0: b.minZ, nx: -1, nz: 0, rx: 0, rz: 1, len: d };
    default:
      return { x0: b.maxX, z0: b.maxZ, nx: 1, nz: 0, rx: 0, rz: -1, len: d };
  }
}

/** Punto del mundo en la fachada: u a lo largo, v de altura, off hacia la calle. */
export function facadePoint(f, u, off = 0) {
  return { x: f.x0 + f.rx * u + f.nx * off, z: f.z0 + f.rz * u + f.nz * off };
}

function pickWall(b, rng) {
  if (b.style === 'torre') return 'tower';
  if (b.style === 'ladrillo') return 'brick';
  const r = rng.next();
  if (b.informal) return r < 0.5 ? 'brick' : r < 0.82 ? 'paintedBrick' : 'peeling';
  if (b.style === 'tienda' && r < 0.35) return 'brick';
  return r < 0.55 ? 'plaster' : r < 0.82 ? 'paintedBrick' : 'peeling';
}

function windowAttrs(rng, ground, informal, frame) {
  return {
    grille: rng.chance(ground ? 0.75 : informal ? 0.5 : 0.35) ? rng.int(0, 3) : -1,
    curtain: rng.chance(0.6) ? { color: rng.int(0, CURTAIN_COLORS.length - 1), left: rng.chance(0.5), frac: rng.range(0.25, 0.55) } : null,
    lit: rng.chance(0.42),
    cool: rng.chance(0.3), // luz fría (televisor, LED)
    frame,
    sill: true,
  };
}

/**
 * Distribución de la fachada principal (la que da a la calle) de un edificio.
 * Devuelve null si el estilo no se modela.
 */
export function facadeLayout(b, idx) {
  // Las casas del fondo de manzana no dan a la calle: caja de ladrillo simple.
  if (!MODELED_STYLES.has(b.style) || b.interior) return null;
  const rng = makeRng(0x51ed + idx * 7919);
  const side = b.front ?? 'S';
  const f = faceFrame(b, side);
  const len = f.len;
  const floors = Math.max(1, b.floors);
  const H = b.topY - b.groundY;
  const floorH = H / floors;
  const tower = b.style === 'torre';
  const informal = !!b.informal;
  const wall = pickWall(b, rng);
  const layout = {
    side,
    face: f,
    floors,
    floorH,
    height: H,
    wall,
    variant: rng.int(0, 2),
    frame: !tower && (wall === 'brick' || rng.chance(0.55)), // vigas y columnas a la vista
    // Zócalo: enchape de gres o granito, o pintado de otro color (dos tonos).
    zocalo: !tower && rng.chance(wall === 'brick' ? 0.25 : informal ? 0.35 : 0.6) ? { h: rng.range(0.9, 1.3), kind: rng.pick(wall === 'brick' ? ['gres', 'granito', 'pintado'] : ['gres', 'granito', 'pintado', 'pintado']), color: rng.int(0, ZOCALO_COLORS.length - 1) } : null,
    frameColor: tower ? 3 : rng.int(0, FRAME_COLORS.length - 1),
    metalColor: rng.int(0, METAL_COLORS.length - 1),
    grilleDesign: rng.int(0, 3),
    openings: [],
    balconies: [],
    shop: null,
    meter: null,
    gas: null, // tubería amarilla del gas: altura del tramo horizontal
    dish: null, // antena parabólica
    eave: !tower && rng.chance(informal ? 0.45 : 0.15), // alero de teja de zinc
    laundry: rng.chance(informal ? 0.6 : 0.35), // ropa colgada en el balcón
  };
  const M = FACADE.margin;
  const usable = len - 2 * M;
  if (usable < 1.2) return layout;

  // ---- pisos altos: ventanas alineadas verticalmente (misma retícula)
  const winW = tower ? rng.range(1.6, 2.0) : informal ? rng.range(0.9, 1.3) : rng.range(1.1, 1.7);
  const gap = tower ? 0.8 : 0.9;
  const n = clamp(Math.floor((usable + gap) / (winW + gap)), 1, tower ? 6 : 4);
  const slots = [];
  for (let i = 0; i < n; i++) {
    const c = M + (usable * (i + 0.5)) / n;
    slots.push([c - winW / 2, c + winW / 2]);
  }
  const balcony = !!b.balcony && floors >= 2 && !tower;
  const bw = Math.min(4.2, len * 0.6);
  const bc = len / 2;
  const doorW = Math.min(2.0, bw - 0.6);
  for (let fl = 1; fl < floors; fl++) {
    const base = fl * floorH;
    // Moravia: en algunos pisos las ventanas no quedan alineadas.
    const jitter = informal && rng.chance(0.4) ? rng.range(-0.4, 0.4) : 0;
    // Sobre un local, el segundo piso deja libre el aviso del negocio.
    const balc = balcony && !(b.style === 'tienda' && fl === 1);
    if (balc) {
      layout.balconies.push({ floor: fl, u0: bc - bw / 2, u1: bc + bw / 2, v: base });
      layout.openings.push({ kind: 'balconyDoor', floor: fl, u0: bc - doorW / 2, u1: bc + doorW / 2, v0: base + 0.02, v1: base + 2.3, ...windowAttrs(rng, false, informal, layout.frameColor), grille: -1 });
    }
    for (const [a0, a1] of slots) {
      let u0 = a0 + jitter;
      let u1 = a1 + jitter;
      if (u0 < M * 0.6 || u1 > len - M * 0.6) {
        u0 = a0;
        u1 = a1;
      }
      if (balc && u1 > bc - doorW / 2 - 0.3 && u0 < bc + doorW / 2 + 0.3) continue; // la puerta del balcón ocupa ese sitio
      const v0 = base + (tower ? 0.8 : FACADE.sillH);
      layout.openings.push({ kind: 'window', floor: fl, u0, u1, v0, v1: v0 + (tower ? 1.5 : FACADE.winH), ...windowAttrs(rng, false, informal, layout.frameColor) });
    }
  }

  // ---- primer piso
  const ground = [];
  const upstairsDoor = floors >= 2 && !tower && rng.chance(0.55); // puerta aparte para subir
  if (b.style === 'tienda') {
    const doorSpace = upstairsDoor ? FACADE.door[0] + 0.4 : 0;
    const sw = clamp(usable - doorSpace, 2.2, 5.2);
    const [name, kind] = SHOPS[rng.int(0, SHOPS.length - 1)];
    ground.push({ kind: 'shop', w: sw, h: FACADE.shopH, name, interior: kind, awning: rng.chance(0.55) ? rng.int(0, 3) : -1, shutter: rng.range(0.08, 0.3), shutterColor: rng.int(0, 4), counter: rng.chance(0.7) });
    if (upstairsDoor) ground.push({ kind: 'door', w: FACADE.door[0], h: FACADE.door[1] });
  } else if (tower) {
    ground.push({ kind: 'door', w: 1.8, h: 2.4, glass: true });
    for (let k = 0; k < 2; k++) ground.push({ kind: 'window', w: winW, h: 1.5 });
  } else {
    const garage = usable >= 5.6 && rng.chance(informal ? 0.12 : 0.35);
    if (garage) ground.push({ kind: 'garage', w: Math.min(FACADE.garage[0], usable - 1.6), h: FACADE.garage[1] });
    ground.push({ kind: 'door', w: FACADE.door[0], h: FACADE.door[1] });
    if (upstairsDoor) ground.push({ kind: 'door', w: 0.85, h: FACADE.door[1] });
    // Ventana de la sala en lo que sobre.
    for (let k = 0; k < 2; k++) ground.push({ kind: 'window', w: informal ? rng.range(0.9, 1.2) : rng.range(1.1, 1.6), h: 1.2 });
  }
  // Acomodar de izquierda a derecha (orden al azar para variar), quitando
  // ventanas si no caben.
  if (rng.chance(0.5)) ground.reverse();
  const minGap = 0.45;
  while (ground.length > 1 && ground.reduce((s, o) => s + o.w, 0) + minGap * (ground.length - 1) > usable) {
    const iWin = ground.map((o) => o.kind).lastIndexOf('window');
    if (iWin < 0) break;
    ground.splice(iWin, 1);
  }
  const total = ground.reduce((s, o) => s + o.w, 0);
  const free = Math.max(0, usable - total);
  const gapG = ground.length > 1 ? Math.max(minGap, free / (ground.length + 1)) : 0;
  let u = M + (ground.length > 1 ? Math.max(0, (usable - total - gapG * (ground.length - 1)) / 2) : (usable - total) / 2);
  for (const o of ground) {
    const u0 = u;
    const u1 = Math.min(len - M * 0.5, u + o.w);
    u = u1 + gapG;
    if (u1 - u0 < 0.6) continue;
    if (o.kind === 'window') {
      layout.openings.push({ kind: 'window', floor: 0, u0, u1, v0: 1.0, v1: 1.0 + o.h, ...windowAttrs(rng, true, informal, layout.frameColor) });
    } else if (o.kind === 'shop') {
      layout.openings.push({ kind: 'shop', floor: 0, u0, u1, v0: 0, v1: o.h, lit: true });
      layout.shop = { ...o, u0, u1 };
    } else {
      layout.openings.push({ kind: o.kind, floor: 0, u0, u1, v0: 0, v1: o.h, design: rng.int(0, 5), color: rng.int(0, METAL_COLORS.length - 1), glass: !!o.glass });
    }
  }
  // Contador de energía junto a la primera puerta.
  const door = layout.openings.find((o) => o.floor === 0 && (o.kind === 'door' || o.kind === 'shop'));
  if (door && !tower) {
    // A un lado de la puerta, donde no haya otro hueco.
    for (const mu of [door.u1 + 0.35, door.u0 - 0.35]) {
      if (mu < M * 0.8 || mu > len - M * 0.8) continue;
      if (layout.openings.some((o) => o.floor === 0 && mu > o.u0 - 0.25 && mu < o.u1 + 0.25)) continue;
      layout.meter = { u: mu, v: 1.55 };
      break;
    }
  }
  // Tubería del gas: sube del andén al contador y corre a lo largo de la fachada.
  if (layout.meter && rng.chance(0.6)) layout.gas = { v: rng.range(2.45, 2.7), u: layout.meter.u + 0.25 };
  // Parabólica (roja o gris) en el último piso, cerca de una esquina.
  if (!tower && floors >= 2 && rng.chance(informal ? 0.35 : 0.2)) {
    const left = rng.chance(0.5);
    layout.dish = { u: left ? 0.65 : len - 0.65, v: (floors - 1) * floorH + 2.3, red: rng.chance(0.6) };
  }
  return layout;
}
