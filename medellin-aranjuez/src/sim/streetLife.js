// Vida de la calle (pura, sin three.js): las plazas de las esquinas donde se
// para cada banda, los habitantes de calle y cuándo se arma una balacera
// entre bandas. game/streetLife.js pone la gente en escena y la hace actuar.
//
// Todo sale de la ciudad generada y de una semilla propia: la ciudad no
// cambia (ni sus pruebas) por agregar esto.

import { makeRng } from './rng.js';
import { pointInPoly } from './geom2d.js';

/** Bandas (inventadas): nombre, de qué lado del mapa son y su pinta (ids de sim/ropa.js). */
export const BANDS = [
  { id: 'morro', name: 'Los del Morro', outfit: { torso: 'camiseta-negra', cabeza: 'gorra-plana-negra', piernas: 'jean-negro', pies: 'tenis-blancos' } },
  { id: 'quebrada', name: 'Los de la Quebrada', outfit: { torso: 'camiseta-blanca', cabeza: 'gorra-plana-blanca', piernas: 'sudadera-negra', pies: 'tenis-negros', cuello: 'cadena-plateada' } },
  { id: 'loma', name: 'Los de la Loma', outfit: { torso: 'camiseta-vinotinto', cabeza: 'gorra-plana-roja', piernas: 'jean-azul', pies: 'tenis-blancos', cintura: 'canguro-negro' } },
];
export const BAND_BY_ID = Object.fromEntries(BANDS.map((b) => [b.id, b]));

export const PLAZA_COUNT = 20;
export const HOMELESS_COUNT = 12;

/** Lugares donde no hay plaza cerca (iglesias, hospitales, colegios, la estación de policía...). */
const QUIET_POIS = new Set(['iglesia', 'hospital', 'policia', 'metro', 'cayetano', 'claret', 'agustiniano', 'biblioteca', 'comfama', 'madreLaura', 'saludMoravia', 'ninodios', 'sanesteban', 'museo', 'parque']);
/** Donde más pasa gente: ahí piden los habitantes de calle. */
const BUSY_POIS = ['parque', 'iglesia', 'metro', 'terminal', 'hospital', 'cayetano', 'metroplus', 'moravia', 'metroplusCaribe', 'encicla', 'biblioteca', 'sanesteban'];

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const norm = (x, z) => {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
};
/** yaw del juego (mira hacia (sin yaw, cos yaw)). */
const yawOf = (x, z) => Math.atan2(x, z);

/**
 * Esquinas convexas de las manzanas (en el anillo del andén): los dos tramos
 * largos y un giro claro. Devuelve {x, z, out:[ox, oz], a:[ux, uz], b:[vx, vz], block}.
 */
export function blockCorners(city, { minEdge = 7, minTurn = 0.8 } = {}) {
  const out = [];
  for (const b of city.blocks) {
    if (b.type !== 'residencial' || !b.ring || b.ring.length < 4) continue;
    const r = b.ring;
    const n = r.length;
    for (let i = 0; i < n; i++) {
      const [px, pz] = r[(i - 1 + n) % n];
      const [x, z] = r[i];
      const [nx, nz] = r[(i + 1) % n];
      const l1 = Math.hypot(x - px, z - pz);
      const l2 = Math.hypot(nx - x, nz - z);
      if (l1 < minEdge || l2 < minEdge) continue;
      const u = [(x - px) / l1, (z - pz) / l1];
      const v = [(nx - x) / l2, (nz - z) / l2];
      const turn = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
      if (turn < minTurn) continue;
      const o = norm(u[0] - v[0], u[1] - v[1]);
      // Convexa: hacia afuera de la esquina queda la calle, no la manzana.
      if (pointInPoly(x + o[0] * 3, z + o[1] * 3, b.curb)) continue;
      out.push({ x, z, out: o, a: u, b: v, block: b.id });
    }
  }
  return out;
}

/** Reparte candidatos con al menos `gap` metros entre sí (en el orden dado). */
function spread(cands, count, gap, taken = []) {
  const got = [];
  for (const c of cands) {
    if (got.length >= count) break;
    if (got.some((g) => dist(g, c) < gap) || taken.some((g) => dist(g, c) < gap * 0.6)) continue;
    got.push(c);
  }
  return got;
}

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Plazas y habitantes de calle de la ciudad. Cada plaza: {id, x, z, yaw (hacia
 * la esquina), band, spots: [{x, z, yaw}]} (dónde se para cada muchacho).
 * Cada habitante de calle: {id, x, z, yaw, walks (camina por ahí o se queda)}.
 */
export function buildStreetLife(city, { seed = 4242 } = {}) {
  const rng = makeRng(seed);
  const blocked = (x, z) => city.collision?.pointBlocked?.(x, z) ?? false;
  const quiet = city.pois.filter((p) => QUIET_POIS.has(p.id));
  const inMap = (c) => Math.abs(c.x) < 940 && Math.abs(c.z) < 750;
  const corners = blockCorners(city).filter((c) => inMap(c) && !blocked(c.x, c.z) && dist(c, city.spawn) > 60 && quiet.every((q) => dist(q, c) > 35));
  const order = shuffle(corners, rng);
  let chosen = spread(order, PLAZA_COUNT, 70);
  if (chosen.length < PLAZA_COUNT) chosen = spread(order, PLAZA_COUNT, 45);
  // Bandas por zona, de oeste a este: el Morro (Moravia), la Quebrada y la Loma.
  const byX = [...chosen].sort((p, q) => p.x - q.x);
  const plazas = byX.map((c, i) => {
    const band = BANDS[Math.min(BANDS.length - 1, Math.floor((i * BANDS.length) / byX.length))].id;
    // El campanero en la punta mirando la esquina; los otros a lado y lado.
    const cand = [
      { x: c.x + c.out[0] * 0.5, z: c.z + c.out[1] * 0.5, yaw: yawOf(c.out[0], c.out[1]) },
      { x: c.x - c.a[0] * 2.3 - c.out[0] * 0.4, z: c.z - c.a[1] * 2.3 - c.out[1] * 0.4, yaw: yawOf(c.a[0], c.a[1]) },
      { x: c.x + c.b[0] * 2.1 - c.out[0] * 0.4, z: c.z + c.b[1] * 2.1 - c.out[1] * 0.4, yaw: yawOf(-c.b[0], -c.b[1]) },
    ];
    const spots = cand.filter((s) => !blocked(s.x, s.z));
    return { id: `plaza-${i + 1}`, x: c.x, z: c.z, yaw: yawOf(c.out[0], c.out[1]), band, spots: spots.length ? spots : [cand[0]] };
  });
  // Habitantes de calle: cerca de lo concurrido y, el resto, en otras esquinas.
  const homeless = [];
  for (const id of BUSY_POIS) {
    if (homeless.length >= HOMELESS_COUNT) break;
    const p = city.pois.find((q) => q.id === id);
    if (!p) continue;
    const a = rng.next() * Math.PI * 2;
    const c = { x: p.x + Math.cos(a) * 9, z: p.z + Math.sin(a) * 9 };
    if (blocked(c.x, c.z) || homeless.some((h) => dist(h, c) < 40)) continue;
    homeless.push({ id: `calle-${homeless.length + 1}`, x: c.x, z: c.z, yaw: rng.next() * Math.PI * 2, walks: rng.next() < 0.5 });
  }
  for (const c of spread(order.filter((q) => !chosen.includes(q)), HOMELESS_COUNT - homeless.length, 90, [...plazas, ...homeless])) {
    homeless.push({ id: `calle-${homeless.length + 1}`, x: c.x - c.out[0] * 0.6, z: c.z - c.out[1] * 0.6, yaw: yawOf(c.out[0], c.out[1]), walks: rng.next() < 0.5 });
  }
  return { plazas, homeless };
}

/** Segundos de juego hasta la próxima balacera: rara, entre 9 y 16 minutos. */
export function nextWarDelay(rand = Math.random) {
  return (9 + rand() * 7) * 60;
}

/**
 * Elige dos plazas de bandas rivales para una balacera: separadas entre 45 y
 * 170 m, la más cercana a 30-160 m del jugador (que se oiga y se vea a lo
 * lejos, sin que le caiga encima de una). null si no hay ninguna pareja.
 */
export function pickWar(plazas, px, pz, rand = Math.random) {
  const pairs = [];
  for (let i = 0; i < plazas.length; i++) {
    for (let j = i + 1; j < plazas.length; j++) {
      const a = plazas[i];
      const b = plazas[j];
      if (a.band === b.band) continue;
      const d = dist(a, b);
      if (d < 45 || d > 170) continue;
      const da = Math.hypot(a.x - px, a.z - pz);
      const db = Math.hypot(b.x - px, b.z - pz);
      const near = Math.min(da, db);
      if (near < 30 || near > 160 || Math.max(da, db) > 210) continue;
      pairs.push({ a, b, w: 1 / (20 + near) });
    }
  }
  if (!pairs.length) return null;
  let r = rand() * pairs.reduce((s, p) => s + p.w, 0);
  for (const p of pairs) if ((r -= p.w) <= 0) return { a: p.a, b: p.b };
  return { a: pairs[0].a, b: pairs[0].b };
}
