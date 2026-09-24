// Generador determinista del barrio Aranjuez (Comuna 4, Medellín) para el MVP.
// Produce vías, manzanas, edificios, utilería, puntos de interés y colisiones.
// Es una recreación libre e inspirada: no pretende ser un plano exacto.

import { makeRng } from './rng.js';
import {
  GRID,
  MERGED_BLOCKS,
  MORAVIA,
  mergedRect,
  roadLine,
  terrainHeight,
  MAP_MIN_X,
  MAP_MIN_Z,
  MAP_MAX_Z,
  onRoad as onRoadCheck,
} from './terrain.js';
import { CollisionWorld } from './collision.js';

const FLOOR_H = 3;

const PAINT_COLORS = [
  [0.93, 0.91, 0.86], // blanco hueso
  [0.96, 0.83, 0.45], // amarillo
  [0.55, 0.75, 0.86], // azul cielo
  [0.62, 0.82, 0.6], // verde menta
  [0.95, 0.65, 0.6], // salmón
  [0.97, 0.62, 0.3], // naranja
  [0.83, 0.55, 0.78], // lila
  [0.35, 0.62, 0.72], // azul petróleo
  [0.9, 0.36, 0.33], // rojo
];

// Nombres reales de las vías (OpenStreetMap), de norte a sur y de oeste a
// este. El mapa comprime la Comuna 4 (~1,7 x 2,5 km) en 9 x 9 manzanas, pero
// cada lugar queda entre las vías reales que lo rodean.
export const CALLES = ['Calle 94', 'Calle 92', 'Calle 89', 'Calle 86', 'Calle 82', 'Calle 77', 'Calle 73', 'Calle 69', 'Calle 67', 'Calle 64'];
export const CARRERAS = ['Carrera 53', 'Carrera 52 (Carabobo)', 'Carrera 51D', 'Carrera 51B', 'Carrera 51 (Bolívar)', 'Carrera 50', 'Carrera 49', 'Carrera 48', 'Carrera 46', 'Carrera 45 (Manrique)'];

export function roadName(edge) {
  if (edge.axis === 'x') return CALLES[edge.j] ?? `Calle ${94 - edge.j * 3}`;
  return CARRERAS[edge.i] ?? `Carrera ${53 - edge.i}`;
}

// Manzanas especiales -> tipo, según la geografía real (norte arriba):
//  - Calle 92: Parque de Aranjuez con la iglesia San Nicolás (Cra 49-48).
//  - Centro: Casa Museo Pedro Nel Gómez (Cra 51B con Calle 85).
//  - Oeste de la Carrera 52 (Carabobo): Morro de Moravia; más al sur Parque
//    Explora, y el Jardín Botánico enfrente, junto a la estación Universidad
//    (Calle 73).
//  - Sur: Cementerio San Pedro (Cra 51 Bolívar, Calle 68) y el Hospital San
//    Vicente (Calle 64).
//  - Este: la ladera sube hacia Manrique (Carrera 45), con el mirador.
const SPECIAL = {
  '6,0': 'parque',
  '7,0': 'iglesia',
  '3,1': 'cancha',
  '3,3': 'museo',
  '0,3': 'moravia',
  '1,4': 'taller',
  '5,3': 'armeria',
  '8,3': 'mirador',
  '0,5': 'explora',
  '5,5': 'parqueadero',
  '4,7': 'cementerio',
  '1,8': 'hospital',
};

export function generateCity(seed = 4) {
  const rng = makeRng(seed);
  const { nx, nz } = GRID;
  const city = {
    seed,
    nodes: [],
    edges: [],
    blocks: [],
    buildings: [],
    props: [],
    pois: [],
    parkedVehicles: [],
    metro: null,
    collision: new CollisionWorld(24),
  };

  // ---------- Grafo vial ----------
  const nodeId = (i, j) => j * (nx + 1) + i;
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      city.nodes.push({ id: nodeId(i, j), i, j, x: roadLine(i, nx), z: roadLine(j, nz), links: [] });
    }
  }
  const merged = MERGED_BLOCKS.map((m) => ({ ...m, rect: mergedRect(m) }));
  const insideMerged = (x, z) =>
    merged.some((m) => x > m.rect.minX && x < m.rect.maxX && z > m.rect.minZ && z < m.rect.maxZ);
  const addEdge = (a, b, axis, i, j) => {
    const na = city.nodes[a];
    const nb = city.nodes[b];
    const mx = (na.x + nb.x) / 2;
    const mz = (na.z + nb.z) / 2;
    if (insideMerged(mx, mz)) return;
    const e = { id: city.edges.length, a, b, axis, i, j, length: Math.hypot(nb.x - na.x, nb.z - na.z) };
    e.name = roadName(e);
    city.edges.push(e);
    na.links.push({ node: b, edge: e.id });
    nb.links.push({ node: a, edge: e.id });
  };
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      if (i < nx) addEdge(nodeId(i, j), nodeId(i + 1, j), 'x', i, j);
      if (j < nz) addEdge(nodeId(i, j), nodeId(i, j + 1), 'z', i, j);
    }
  }
  for (const n of city.nodes) n.active = n.links.length > 0;

  // ---------- Manzanas ----------
  const mergedCells = new Map();
  for (const m of merged) {
    for (let ix = m.ix0; ix <= m.ix1; ix++) for (let iz = m.iz0; iz <= m.iz1; iz++) mergedCells.set(`${ix},${iz}`, m);
  }
  const doneMerged = new Set();
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const m = mergedCells.get(`${ix},${iz}`);
      let block;
      if (m) {
        if (doneMerged.has(m.id)) continue;
        doneMerged.add(m.id);
        block = { ix, iz, type: m.id, ...m.rect, merged: true };
      } else {
        block = {
          ix,
          iz,
          type: SPECIAL[`${ix},${iz}`] || 'residencial',
          minX: roadLine(ix, nx) + GRID.blockInset,
          maxX: roadLine(ix + 1, nx) - GRID.blockInset,
          minZ: roadLine(iz, nz) + GRID.blockInset,
          maxZ: roadLine(iz + 1, nz) - GRID.blockInset,
        };
      }
      block.cx = (block.minX + block.maxX) / 2;
      block.cz = (block.minZ + block.maxZ) / 2;
      // Anillo peatonal: centro del andén.
      const s = GRID.sidewalk / 2 + 0.1;
      block.ring = { minX: block.minX + s, maxX: block.maxX - s, minZ: block.minZ + s, maxZ: block.maxZ - s };
      // Área de lotes (dentro del andén).
      block.lot = {
        minX: block.minX + GRID.sidewalk,
        maxX: block.maxX - GRID.sidewalk,
        minZ: block.minZ + GRID.sidewalk,
        maxZ: block.maxZ - GRID.sidewalk,
      };
      block.id = city.blocks.length;
      city.blocks.push(block);
    }
  }

  const ctx = { city, rng };
  for (const block of city.blocks) {
    const gen = BLOCK_GENERATORS[block.type] || genResidential;
    // Barrio Moravia: al oeste de Carabobo, alrededor del Morro.
    if (block.type === 'residencial' && isMoravia(block)) genResidential(block, ctx, { informal: true });
    else gen(block, ctx);
    addSidewalkProps(block, ctx);
  }
  addMetro(ctx);
  addPowerLines(ctx);

  // Colisiones de edificios y estructuras sólidas.
  for (const b of city.buildings) {
    if (b.collide === false) continue;
    city.collision.add({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, minY: b.baseY, maxY: b.topY, kind: 'building' });
  }
  for (const p of city.props) {
    if (!p.collider) continue;
    const c = p.collider;
    city.collision.add({ minX: p.x - c.hx, maxX: p.x + c.hx, minZ: p.z - c.hz, maxZ: p.z + c.hz, minY: c.minY ?? -1000, maxY: c.maxY ?? 1000, kind: p.type });
  }

  const parque = city.pois.find((p) => p.id === 'parque');
  city.spawn = { x: parque.x, z: parque.z + 12, yaw: 0 };
  city.hospital = city.pois.find((p) => p.id === 'hospital');
  // Utilería de barrio (tiendas, canecas, alcantarillas...). Va al final y con
  // su propio generador para no alterar la ciudad ya generada.
  addStreetLife(city, makeRng(seed + 777));
  return city;
}

// ---------------------------------------------------------------- vida de barrio

/**
 * Utilería que da vida a las cuadras: sillas plásticas y canastas de cerveza
 * frente a las tiendas, canecas y bolsas de basura, alcantarillas en la
 * calzada, materas en andenes y balcones, barreras de obra, hidrantes y
 * faroles de parque. Nada sólido queda sobre el centro del andén (por donde
 * caminan los peatones), cerca de las esquinas (cruces), de los puntos de
 * interés o de los vehículos parqueados.
 */
function addStreetLife(city, rng) {
  const ringClear = 0.08; // holgura extra entre el peatón y la utilería
  const solids = city.props.filter((p) => p.collider);
  const added = [];
  const blocked = (x, z, r) => {
    for (const p of solids) if (Math.abs(p.x - x) < r + (p.collider.hx ?? 0.3) && Math.abs(p.z - z) < r + (p.collider.hz ?? 0.3)) return true;
    for (const v of city.parkedVehicles) if (Math.hypot(v.x - x, v.z - z) < r + 2.6) return true;
    for (const poi of city.pois) if (Math.hypot(poi.x - x, poi.z - z) < r + 3) return true;
    if (Math.hypot(city.spawn.x - x, city.spawn.z - z) < r + 2) return true;
    if (city.collision.pointBlocked(x, z)) return true;
    return false;
  };
  // Distancia del punto al centro del andén (anillo peatonal) de su manzana.
  const ringDist = (b, x, z) => {
    const r = b.ring;
    const inside = x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ;
    const dx = Math.max(r.minX - x, 0, x - r.maxX);
    const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
    return inside ? Math.min(x - r.minX, r.maxX - x, z - r.minZ, r.maxZ - z) : Math.hypot(dx, dz);
  };
  const place = (p, block) => {
    const r = p.collider ? Math.max(p.collider.hx, p.collider.hz) : 0;
    if (p.collider && block && ringDist(block, p.x, p.z) < ringClear + PED_RADIUS + Math.min(p.collider.hx, p.collider.hz)) return null;
    if (p.collider && blocked(p.x, p.z, r)) return null;
    city.props.push(p);
    added.push(p);
    if (p.collider) solids.push(p);
    return p;
  };
  const ground = (x, z) => terrainHeight(x, z) + GRID.curb;
  const curbOff = GRID.sidewalk / 2 - 0.35; // a 35 cm del sardinel
  const sidesOf = (b) => {
    const r = b.ring;
    return [
      { side: 'N', x0: r.minX, x1: r.maxX, z: r.minZ - curbOff, horiz: true, rot: 0 },
      { side: 'S', x0: r.minX, x1: r.maxX, z: r.maxZ + curbOff, horiz: true, rot: Math.PI },
      { side: 'W', z0: r.minZ, z1: r.maxZ, x: r.minX - curbOff, horiz: false, rot: Math.PI / 2 },
      { side: 'E', z0: r.minZ, z1: r.maxZ, x: r.maxX + curbOff, horiz: false, rot: -Math.PI / 2 },
    ];
  };
  const blockOf = (b) => city.blocks.find((k) => b.minX >= k.minX - 0.5 && b.maxX <= k.maxX + 0.5 && b.minZ >= k.minZ - 0.5 && b.maxZ <= k.maxZ + 0.5);
  // Normal hacia la calle y rotación "mirando a la calle" para cada frente.
  const FRONT = {
    N: { nx: 0, nz: -1, rot: Math.PI },
    S: { nx: 0, nz: 1, rot: 0 },
    W: { nx: -1, nz: 0, rot: -Math.PI / 2 },
    E: { nx: 1, nz: 0, rot: Math.PI / 2 },
  };
  const facadeInfo = (b) => {
    const f = FRONT[b.front];
    const along = b.front === 'N' || b.front === 'S';
    const fx = b.front === 'W' ? b.minX : b.front === 'E' ? b.maxX : (b.minX + b.maxX) / 2;
    const fz = b.front === 'N' ? b.minZ : b.front === 'S' ? b.maxZ : (b.minZ + b.maxZ) / 2;
    return { ...f, along, fx, fz, len: along ? b.maxX - b.minX : b.maxZ - b.minZ, tx: along ? 1 : 0, tz: along ? 0 : 1 };
  };

  // 1) Tiendas de barrio: sillas plásticas y canastas de cerveza en el andén.
  const CHAIR_COLORS = ['#f4f4f0', '#f4f4f0', '#f4f4f0', '#d8312b', '#2f6fb3', '#3f8f4a'];
  for (const b of city.buildings) {
    if (b.style !== 'tienda' || !b.front || b.shop || b.floors >= 6 || !rng.chance(0.5)) continue;
    const block = blockOf(b);
    if (!block) continue;
    const f = facadeInfo(b);
    const n = rng.int(2, 4);
    const color = rng.pick(CHAIR_COLORS);
    const span = Math.min(f.len - 1.5, n * 0.75);
    if (span < 1.4) continue;
    const start = -span / 2;
    for (let k = 0; k < n; k++) {
      const a = start + (k + 0.5) * (span / n) + rng.range(-0.08, 0.08);
      const x = f.fx + f.tx * a + f.nx * 0.42;
      const z = f.fz + f.tz * a + f.nz * 0.42;
      place({ type: 'chair', x, z, rot: f.rot + rng.range(-0.35, 0.35), color, collider: { hx: 0.24, hz: 0.24, maxY: ground(x, z) + 0.9 } }, block);
    }
    // Canastas apiladas a un lado de las sillas.
    const a = (span / 2 + 0.45) * (rng.chance(0.5) ? 1 : -1);
    const x = f.fx + f.tx * a + f.nx * 0.3;
    const z = f.fz + f.tz * a + f.nz * 0.3;
    const stack = rng.int(1, 4);
    place({ type: 'crate', x, z, rot: f.rot + (rng.chance(0.5) ? Math.PI / 2 : 0) + rng.range(-0.1, 0.1), stack, collider: { hx: 0.25, hz: 0.25, maxY: ground(x, z) + 0.26 * stack } }, block);
  }

  // 2) Materas: en el andén junto a la fachada y en los balcones.
  for (const b of city.buildings) {
    if (!b.front || b.style === 'torre' || b.style === 'tienda') continue;
    const f = facadeInfo(b);
    const block = blockOf(b);
    if (block && b.style === 'pintada' && rng.chance(0.18)) {
      const a = rng.range(-f.len / 2 + 0.8, f.len / 2 - 0.8);
      const x = f.fx + f.tx * a + f.nx * 0.36;
      const z = f.fz + f.tz * a + f.nz * 0.36;
      place({ type: 'planter', x, z, rot: rng.range(0, Math.PI * 2), s: rng.range(0.85, 1.1), collider: { hx: 0.3, hz: 0.3, maxY: ground(x, z) + 0.8 } }, block);
    }
    if (b.balcony && rng.chance(0.45)) {
      // Mismo balcón que dibuja el render (centrado, 0.9 m de fondo).
      const bw = Math.min(4.2, f.len * 0.6);
      for (let fl = 1; fl < b.floors; fl++) {
        if (!rng.chance(0.6)) continue;
        const y = b.groundY + fl * 3;
        const count = rng.int(1, 2);
        for (let k = 0; k < count; k++) {
          const a = (k === 0 ? -1 : 1) * (bw / 2 - 0.4);
          place({ type: 'planter', x: f.fx + f.tx * a + f.nx * 0.45, z: f.fz + f.tz * a + f.nz * 0.45, y, rot: rng.range(0, Math.PI * 2), s: rng.range(0.6, 0.8) }, null);
        }
      }
    }
  }

  // 3) Canecas, bolsas de basura, hidrantes y barreras de obra en el borde del andén.
  for (const block of city.blocks) {
    if (block.type === 'botanico' || block.type === 'moravia') continue;
    for (const s of sidesOf(block)) {
      const len = s.horiz ? s.x1 - s.x0 : s.z1 - s.z0;
      const at = (t) => ({ x: s.horiz ? s.x0 + t : s.x, z: s.horiz ? s.z : s.z0 + t });
      if (rng.chance(0.4)) {
        for (let tries = 0; tries < 6; tries++) {
          const t = rng.range(4, len - 4);
          const { x, z } = at(t);
          const c = place({ type: 'trashcan', x, z, rot: rng.range(0, Math.PI * 2), collider: { hx: 0.3, hz: 0.3, maxY: ground(x, z) + 0.95 } }, block);
          if (!c) continue;
          // Bolsas al pie de la caneca (el camión pasa mañana).
          const nb = rng.chance(0.6) ? rng.int(1, 3) : 0;
          for (let k = 0; k < nb; k++) {
            const d = 0.55 + k * 0.45;
            const dir = rng.chance(0.5) ? 1 : -1;
            place({ type: 'trashbag', x: x + (s.horiz ? d * dir : 0), z: z + (s.horiz ? 0 : d * dir), rot: rng.range(0, Math.PI * 2), s: rng.range(0.8, 1.15) }, block);
          }
          break;
        }
      } else if (rng.chance(0.2)) {
        // Solo bolsas sobre el andén, junto al sardinel.
        const t = rng.range(4, len - 4);
        const { x, z } = at(t);
        const nb = rng.int(1, 3);
        for (let k = 0; k < nb; k++) place({ type: 'trashbag', x: x + (s.horiz ? k * 0.45 : 0), z: z + (s.horiz ? 0 : k * 0.45), rot: rng.range(0, Math.PI * 2), s: rng.range(0.8, 1.15) }, block);
      }
      if (rng.chance(0.12)) {
        const t = rng.range(3, 5) * (rng.chance(0.5) ? 1 : -1);
        const { x, z } = at(t > 0 ? t : len + t);
        place({ type: 'hydrant', x, z, rot: s.rot + Math.PI, collider: { hx: 0.16, hz: 0.16, maxY: ground(x, z) + 0.8 } }, block);
      }
      if (block.type === 'residencial' && rng.chance(0.05)) {
        // Obra: dos o tres barreras seguidas, paralelas al sardinel.
        const n = rng.int(2, 3);
        const t0 = rng.range(6, len - 6 - n * 1.6);
        for (let k = 0; k < n; k++) {
          const { x, z } = at(t0 + k * 1.6);
          place({ type: 'barrier', x, z, rot: s.horiz ? 0 : Math.PI / 2, collider: { hx: s.horiz ? 0.78 : 0.33, hz: s.horiz ? 0.33 : 0.78, maxY: ground(x, z) + 0.85 } }, block);
        }
      }
    }
  }

  // 4) Alcantarillas en la calzada (sin colisión: van a ras del asfalto).
  for (const e of city.edges) {
    const a = city.nodes[e.a];
    const b = city.nodes[e.b];
    const n = rng.chance(0.5) ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const t = rng.range(0.25, 0.75);
      const lane = (rng.chance(0.5) ? 1 : -1) * GRID.laneOffset * rng.range(0.3, 0.9);
      const x = a.x + (b.x - a.x) * t + (e.axis === 'z' ? lane : 0);
      const z = a.z + (b.z - a.z) * t + (e.axis === 'x' ? lane : 0);
      place({ type: 'manhole', x, z, rot: rng.range(0, Math.PI * 2), onRoad: true }, null);
    }
  }

  // 5) Faroles de parque alrededor de la fuente y en el mirador.
  const parque = city.blocks.find((b) => b.type === 'parque');
  if (parque) {
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const x = parque.cx + Math.cos(ang) * 11.5;
      const z = parque.cz + Math.sin(ang) * 11.5;
      place({ type: 'parkLamp', x, z, rot: ang, collider: { hx: 0.15, hz: 0.15 } }, null);
    }
  }
  const mirador = city.blocks.find((b) => b.type === 'mirador');
  if (mirador) {
    for (let k = 0; k < 4; k++) {
      const x = mirador.cx - 18 + k * 12;
      const z = mirador.cz + 10;
      place({ type: 'parkLamp', x, z, rot: 0, collider: { hx: 0.15, hz: 0.15 } }, null);
    }
  }

  const blockAtPt = (x, z) => city.blocks.find((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) ?? null;

  // 6) Placas de nomenclatura en una esquina de cada cruce ("Cl 92" / "Cr 49").
  for (const n of city.nodes) {
    if (!n.active) continue;
    const axes = new Set(n.links.map((l) => city.edges[l.edge].axis));
    if (axes.size < 2) continue;
    const d = GRID.blockInset + 0.45;
    for (const [sx, sz] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const x = n.x + sx * d;
      const z = n.z + sz * d;
      const block = blockAtPt(x, z);
      if (!block || block.merged) continue;
      if (place({ type: 'streetSign', x, z, calle: n.j, carrera: n.i, collider: { hx: 0.07, hz: 0.07 } }, block)) break;
    }
  }

  // 7) Paraderos de bus (banca y aviso) en las vías por donde pasan las busetas.
  const busRoute = (e) => (e.axis === 'z' && (e.i === 1 || e.i === 4)) || (e.axis === 'x' && (e.j === 1 || e.j === 6));
  let stopK = 0;
  for (const e of city.edges) {
    if (!busRoute(e) || stopK++ % 2) continue;
    const a = city.nodes[e.a];
    const b = city.nodes[e.b];
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    for (const side of rng.chance(0.5) ? [1, -1] : [-1, 1]) {
      const off = GRID.blockInset + 0.55;
      const x = mx + (e.axis === 'z' ? side * off : 0);
      const z = mz + (e.axis === 'x' ? side * off : 0);
      const block = blockAtPt(x, z);
      if (!block || block.merged) continue;
      // La banca mira a la calle.
      const rot = e.axis === 'z' ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : side > 0 ? Math.PI : 0;
      const along = e.axis === 'z';
      if (place({ type: 'busStop', x, z, rot, collider: { hx: along ? 0.3 : 1.1, hz: along ? 1.1 : 0.3, maxY: ground(x, z) + 0.9 } }, block)) break;
    }
  }

  // 8) Venteros ambulantes: minutos, frutas, mango biche, arepas, helados y
  //    dulces, cerca de los lugares concurridos y en las vías principales.
  const VENDORS = ['minutos', 'frutas', 'mangos', 'arepas', 'helados', 'dulces'];
  const spots = [];
  for (const id of ['parque', 'iglesia', 'metro', 'cementerio', 'explora', 'hospital', 'cancha', 'museo', 'botanico', 'moravia']) {
    const poi = city.pois.find((q) => q.id === id);
    if (poi) spots.push(poi, poi);
  }
  for (const e of city.edges) if (busRoute(e) && rng.chance(0.25)) spots.push({ x: (city.nodes[e.a].x + city.nodes[e.b].x) / 2, z: (city.nodes[e.a].z + city.nodes[e.b].z) / 2 });
  let vk = rng.int(0, VENDORS.length - 1);
  for (const sp of spots) {
    for (let tries = 0; tries < 16; tries++) {
      const ang = rng.range(0, Math.PI * 2);
      const rr = rng.range(5, 14);
      const x = sp.x + Math.cos(ang) * rr;
      const z = sp.z + Math.sin(ang) * rr;
      const block = blockAtPt(x, z);
      if (!block || onRoadCheck(x, z)) continue;
      // Solo en el andén (no dentro de los lotes) o en plazas abiertas.
      const inLot = x > block.lot.minX && x < block.lot.maxX && z > block.lot.minZ && z < block.lot.maxZ;
      if (inLot && !['parque', 'botanico', 'moravia', 'cancha', 'mirador'].includes(block.type)) continue;
      // Mirando hacia la calle más cercana.
      const dW = x - block.minX;
      const dE = block.maxX - x;
      const dN = z - block.minZ;
      const dS = block.maxZ - z;
      const m = Math.min(dW, dE, dN, dS);
      const rot = m === dN ? Math.PI : m === dS ? 0 : m === dW ? -Math.PI / 2 : Math.PI / 2;
      const p = place({ type: 'vendor', kind: VENDORS[vk % VENDORS.length], x, z, rot, collider: { hx: 0.55, hz: 0.55, maxY: ground(x, z) + 1.2 } }, block);
      if (p) {
        vk++;
        break;
      }
    }
  }

  for (const p of added) {
    if (!p.collider) continue;
    const c = p.collider;
    city.collision.add({ minX: p.x - c.hx, maxX: p.x + c.hx, minZ: p.z - c.hz, maxZ: p.z + c.hz, minY: c.minY ?? -1000, maxY: c.maxY ?? 1000, kind: p.type });
  }
  return added;
}

const PED_RADIUS = 0.35;

// ---------- Utilidades de construcción ----------

function footprintHeights(minX, maxX, minZ, maxZ) {
  const hs = [
    terrainHeight(minX, minZ),
    terrainHeight(maxX, minZ),
    terrainHeight(minX, maxZ),
    terrainHeight(maxX, maxZ),
    terrainHeight((minX + maxX) / 2, (minZ + maxZ) / 2),
  ];
  return { min: Math.min(...hs), max: Math.max(...hs) };
}

function addBuilding(ctx, b) {
  const fh = footprintHeights(b.minX, b.maxX, b.minZ, b.maxZ);
  const floors = b.floors ?? 2;
  const baseY = fh.min - 0.6;
  const topY = b.topY ?? fh.max + GRID.curb + (b.height ?? floors * FLOOR_H);
  const building = {
    style: 'ladrillo',
    color: [1, 1, 1],
    roof: 'flat',
    uvOffset: ctx.rng.next(),
    ...b,
    floors,
    baseY,
    groundY: fh.max + GRID.curb,
    topY,
  };
  ctx.city.buildings.push(building);
  return building;
}

function addProp(ctx, p) {
  ctx.city.props.push(p);
  return p;
}

function addPoi(ctx, poi) {
  ctx.city.pois.push({ radius: 3.5, ...poi });
}

/** Punto a mitad de andén frente a un lado de la manzana. */
function sidewalkPoint(block, side, t = 0.5) {
  const r = block.ring;
  switch (side) {
    case 'N':
      return { x: r.minX + (r.maxX - r.minX) * t, z: r.minZ };
    case 'S':
      return { x: r.minX + (r.maxX - r.minX) * t, z: r.maxZ };
    case 'W':
      return { x: r.minX, z: r.minZ + (r.maxZ - r.minZ) * t };
    default:
      return { x: r.maxX, z: r.minZ + (r.maxZ - r.minZ) * t };
  }
}

function pickHouseStyle(rng) {
  const r = rng.next();
  if (r < 0.5) return 'ladrillo';
  if (r < 0.85) return 'pintada';
  return 'tienda';
}

/** Moravia: casi todo ladrillo a la vista sin revocar, alguna fachada pintada y tiendas. */
function pickInformalStyle(rng) {
  const r = rng.next();
  if (r < 0.8) return 'ladrillo';
  if (r < 0.92) return 'pintada';
  return 'tienda';
}

function houseColor(rng, style) {
  if (style === 'ladrillo') {
    const v = rng.range(0.85, 1.05);
    return [v, v * rng.range(0.92, 1), v * rng.range(0.88, 1)];
  }
  return rng.pick(PAINT_COLORS);
}

/**
 * Llena un lado de un lote con casas contiguas (típicas de ladrillo a la vista,
 * con planchas y tanques de agua en la terraza).
 */
function fillSide(ctx, lot, side, depthMax, opts = {}) {
  const { rng } = ctx;
  const along = side === 'N' || side === 'S';
  const start = along ? lot.minX : lot.minZ;
  const end = along ? lot.maxX : lot.maxZ;
  // Los lados E/O dejan libres las esquinas ocupadas por N/S.
  const a0 = along ? start : start + depthMax;
  const a1 = along ? end : end - depthMax;
  let a = a0;
  while (a < a1 - 3) {
    // Moravia: autoconstrucción en lotes angostos (4-7 m de frente).
    let w = opts.informal ? rng.range(4.2, 7.5) : rng.range(6, 11);
    if (a1 - (a + w) < 5) w = a1 - a;
    if (!opts.noGaps && rng.chance(0.06)) {
      a += Math.min(w, 5); // lote vacío
      continue;
    }
    const depth = rng.range(depthMax * 0.7, depthMax);
    let floors = rng.int(opts.minFloors ?? 2, opts.maxFloors ?? (opts.informal ? 5 : 4));
    if (!opts.low && !opts.informal && rng.chance(0.08)) floors = rng.int(6, 11);
    const style = opts.style ?? (floors >= 6 ? 'torre' : opts.informal ? pickInformalStyle(rng) : pickHouseStyle(rng));
    let b;
    if (side === 'N') b = { minX: a, maxX: a + w, minZ: lot.minZ, maxZ: lot.minZ + depth };
    else if (side === 'S') b = { minX: a, maxX: a + w, minZ: lot.maxZ - depth, maxZ: lot.maxZ };
    else if (side === 'W') b = { minX: lot.minX, maxX: lot.minX + depth, minZ: a, maxZ: a + w };
    else b = { minX: lot.maxX - depth, maxX: lot.maxX, minZ: a, maxZ: a + w };
    addBuilding(ctx, {
      ...b,
      floors,
      style,
      color: houseColor(rng, style),
      front: side,
      tank: floors < 6 && rng.chance(0.55),
      roof: floors <= 2 && rng.chance(0.3) ? 'tejas' : 'flat',
      balcony: floors >= 3 && rng.chance(opts.informal ? 0.2 : 0.5),
      informal: !!opts.informal,
    });
    a += w;
  }
}

function genResidential(block, ctx, opts = {}) {
  const lot = block.lot;
  const depth = opts.depth ?? 14;
  for (const side of opts.sides ?? ['N', 'S', 'W', 'E']) fillSide(ctx, lot, side, depth, opts);
  // Patio interior: algún árbol de mango o guayacán.
  if (!opts.sides && ctx.rng.chance(0.7)) {
    addProp(ctx, { type: 'tree', kind: ctx.rng.pick(['mango', 'guayacan', 'guayacanRosado']), x: block.cx, z: block.cz, scale: ctx.rng.range(1, 1.4) });
  }
}

function addSidewalkProps(block, ctx) {
  const { rng } = ctx;
  const r = block.ring;
  const curbOff = GRID.sidewalk / 2 - 0.55; // cerca del sardinel
  const sides = [
    { side: 'N', x0: r.minX, x1: r.maxX, z: r.minZ - curbOff, horiz: true, rot: 0 },
    { side: 'S', x0: r.minX, x1: r.maxX, z: r.maxZ + curbOff, horiz: true, rot: Math.PI },
    { side: 'W', z0: r.minZ, z1: r.maxZ, x: r.minX - curbOff, horiz: false, rot: Math.PI / 2 },
    { side: 'E', z0: r.minZ, z1: r.maxZ, x: r.maxX + curbOff, horiz: false, rot: -Math.PI / 2 },
  ];
  for (const s of sides) {
    const len = s.horiz ? s.x1 - s.x0 : s.z1 - s.z0;
    // Postes de alumbrado.
    for (let t = 8; t < len - 4; t += 26) {
      const x = s.horiz ? s.x0 + t : s.x;
      const z = s.horiz ? s.z : s.z0 + t;
      addProp(ctx, { type: 'lamp', x, z, rot: s.rot, collider: { hx: 0.15, hz: 0.15 } });
    }
    // Árboles de andén.
    for (let t = 20; t < len - 6; t += rng.range(14, 24)) {
      if (!rng.chance(0.55)) continue;
      const x = s.horiz ? s.x0 + t : s.x;
      const z = s.horiz ? s.z : s.z0 + t;
      addProp(ctx, {
        type: 'tree',
        kind: rng.pick(['guayacan', 'guayacanRosado', 'mango', 'ficus', 'ficus', 'palma']),
        x,
        z,
        scale: rng.range(0.75, 1.15),
        collider: { hx: 0.25, hz: 0.25 },
      });
    }
  }
  // Motos parqueadas en el andén (muy de Medellín): a veces varias.
  const nMotos = block.type === 'residencial' ? (rng.chance(0.75) ? rng.int(1, 3) : 0) : 0;
  for (let mk = 0; mk < nMotos; mk++) {
    const s = rng.pick(sides);
    // Buscar un hueco libre entre faroles y árboles del andén.
    for (let tries = 0; tries < 12; tries++) {
      const t = rng.range(0.15, 0.85);
      const x = s.horiz ? s.x0 + (s.x1 - s.x0) * t : s.x;
      const z = s.horiz ? s.z : s.z0 + (s.z1 - s.z0) * t;
      const clash = ctx.city.props.some((p) => p.collider && Math.abs(p.x - x) < 1.8 && Math.abs(p.z - z) < 1.8) || ctx.city.parkedVehicles.some((v) => Math.hypot(v.x - x, v.z - z) < 2.2);
      if (clash) continue;
      ctx.city.parkedVehicles.push({ type: 'moto', x, z, heading: s.rot + Math.PI / 2 });
      break;
    }
  }
}

/** Manzanas del barrio Moravia (entre la Carrera 52 y el río, Calles 92 a 77). */
export function isMoravia(block) {
  return block.ix <= 0 && block.iz >= 1 && block.iz <= 4;
}

// ---------- Generadores de manzanas especiales ----------

const BLOCK_GENERATORS = {
  residencial: genResidential,

  parque(block, ctx) {
    const { rng } = ctx;
    // Plaza con fuente, bancas, kiosco y árboles grandes.
    addProp(ctx, { type: 'plaza', x: block.cx, z: block.cz, w: block.maxX - block.minX, d: block.maxZ - block.minZ });
    addProp(ctx, { type: 'fountain', x: block.cx, z: block.cz, collider: { hx: 3.2, hz: 3.2, maxY: 1000 } });
    for (let k = 0; k < 18; k++) {
      const ang = (k / 18) * Math.PI * 2;
      const rad = rng.range(14, 24);
      addProp(ctx, { type: 'tree', kind: rng.pick(['ceiba', 'guayacan', 'guayacanRosado', 'mango']), x: block.cx + Math.cos(ang) * rad, z: block.cz + Math.sin(ang) * rad, scale: rng.range(1.2, 1.7), collider: { hx: 0.4, hz: 0.4 } });
    }
    for (let k = 0; k < 10; k++) {
      const ang = (k / 10) * Math.PI * 2 + 0.3;
      const bx = block.cx + Math.cos(ang) * 8;
      const bz = block.cz + Math.sin(ang) * 8;
      addProp(ctx, { type: 'bench', x: bx, z: bz, rot: -ang + Math.PI / 2, collider: { hx: 0.75, hz: 0.75, maxY: terrainHeight(bx, bz) + GRID.curb + 0.9 } });
    }
    addProp(ctx, { type: 'kiosk', x: block.cx - 18, z: block.cz - 18, collider: { hx: 1.6, hz: 1.6 } });
    addPoi(ctx, {
      id: 'parque',
      name: 'Parque de Aranjuez',
      desc: 'El corazón del barrio sobre la Calle 92: tinto, dominó y la iglesia San Nicolás al lado.',
      type: 'landmark',
      x: block.cx,
      z: block.cz + 6,
      mission: 'domicilio',
    });
  },

  iglesia(block, ctx) {
    const lot = block.lot;
    // Nave frente al parque (lado oeste) y torre del campanario.
    addBuilding(ctx, { minX: lot.minX + 2, maxX: lot.minX + 32, minZ: block.cz - 8, maxZ: block.cz + 8, height: 13, style: 'iglesia', color: [0.95, 0.92, 0.84], roof: 'tejas' });
    addBuilding(ctx, { minX: lot.minX, maxX: lot.minX + 6, minZ: block.cz - 3, maxZ: block.cz + 3, height: 27, style: 'iglesia', color: [0.95, 0.92, 0.84], tower: true });
    genResidential(block, ctx, { sides: ['N', 'S', 'E'] });
    addProp(ctx, { type: 'sign', x: lot.minX - 1.2, z: block.cz + 5.5, rot: Math.PI / 2, text: 'Iglesia San Nicolás' });
    addPoi(ctx, { id: 'iglesia', name: 'Iglesia San Nicolás', desc: 'La parroquia junto al Parque de Aranjuez.', type: 'landmark', ...sidewalkPoint(block, 'W', 0.5) });
  },

  museo(block, ctx) {
    const lot = block.lot;
    // Casa-museo con murales y jardín.
    addBuilding(ctx, { minX: lot.minX + 4, maxX: lot.minX + 26, minZ: lot.maxZ - 20, maxZ: lot.maxZ - 4, floors: 2, style: 'museo', color: [0.97, 0.94, 0.86], roof: 'tejas' });
    for (let k = 0; k < 6; k++) addProp(ctx, { type: 'tree', kind: ctx.rng.pick(['mango', 'guayacan', 'palma']), x: lot.minX + 6 + k * 4, z: lot.maxZ - 26 + (k % 2) * 3, scale: 1.1 });
    genResidential(block, ctx, { sides: ['N', 'E'] });
    addProp(ctx, { type: 'sign', x: lot.minX + 15, z: lot.maxZ + 1.4, rot: 0, text: 'Casa Museo Pedro Nel Gómez' });
    addPoi(ctx, { id: 'museo', name: 'Casa Museo Pedro Nel Gómez', desc: 'La casa-taller del gran muralista antioqueño (Carrera 51B con Calle 85).', type: 'landmark', ...sidewalkPoint(block, 'S', 0.3) });
  },

  explora(block, ctx) {
    const lot = block.lot;
    // Cubos rojos característicos.
    const cubes = [
      [lot.minX + 3, lot.minZ + 4, 17, 14, 16],
      [lot.minX + 23, lot.minZ + 6, 15, 16, 20],
      [lot.minX + 6, lot.minZ + 26, 18, 17, 13],
      [lot.minX + 30, lot.minZ + 30, 16, 16, 18],
    ];
    for (const [x, z, w, d, h] of cubes) addBuilding(ctx, { minX: x, maxX: x + w, minZ: z, maxZ: z + d, height: h, style: 'explora', color: [0.78, 0.08, 0.07] });
    addProp(ctx, { type: 'sign', x: lot.maxX + 1.4, z: block.cz, rot: -Math.PI / 2, text: 'Parque Explora' });
    addPoi(ctx, { id: 'explora', name: 'Parque Explora', desc: 'Museo interactivo de ciencia y el acuario.', type: 'landmark', ...sidewalkPoint(block, 'E', 0.5) });
  },

  botanico(block, ctx) {
    const { rng } = ctx;
    addProp(ctx, { type: 'garden', x: block.cx, z: block.cz, w: block.maxX - block.minX, d: block.maxZ - block.minZ });
    addProp(ctx, { type: 'orquideorama', x: block.cx + 8, z: block.cz - 6 });
    addProp(ctx, { type: 'pond', x: block.cx - 22, z: block.cz + 26, r: 11 });
    for (let k = 0; k < 90; k++) {
      const x = rng.range(block.minX + 4, block.maxX - 4);
      const z = rng.range(block.minZ + 4, block.maxZ - 4);
      if (Math.hypot(x - block.cx - 8, z - block.cz + 6) < 22) continue;
      if (Math.hypot(x - block.cx + 22, z - block.cz - 26) < 13) continue;
      addProp(ctx, { type: 'tree', kind: rng.pick(['ceiba', 'palma', 'guayacan', 'guayacanRosado', 'ficus', 'mango']), x, z, scale: rng.range(1, 1.8), collider: { hx: 0.4, hz: 0.4 } });
    }
    // Muro perimetral bajo con portada.
    wallRing(ctx, block, 1.4, [0.72, 0.7, 0.66], 'E');
    addProp(ctx, { type: 'sign', x: block.maxX + 1.3, z: block.cz, rot: -Math.PI / 2, text: 'Jardín Botánico' });
    addPoi(ctx, { id: 'botanico', name: 'Jardín Botánico', desc: 'El Orquideorama y 14 hectáreas de verde en plena ciudad.', type: 'landmark', ...sidewalkPoint(block, 'E', 0.5) });
  },

  cancha(block, ctx) {
    const { cx, cz } = block;
    addProp(ctx, { type: 'field', x: cx, z: cz, w: 30, d: 48 });
    addProp(ctx, { type: 'goal', x: cx, z: cz - 23, rot: 0 });
    addProp(ctx, { type: 'goal', x: cx, z: cz + 23, rot: Math.PI });
    for (let k = -1; k <= 1; k += 2) {
      addProp(ctx, { type: 'fence', x: cx + k * 17, z: cz, w: 0.1, d: 50, h: 4, collider: { hx: 0.1, hz: 25 } });
    }
    addPoi(ctx, { id: 'cancha', name: 'Cancha del barrio', desc: 'Aquí se arma el picadito… y los problemas con el parche.', type: 'mission', x: cx, z: cz, mission: 'parche' });
  },

  cementerio(block, ctx) {
    const { rng } = ctx;
    const lot = block.lot;
    wallRing(ctx, block, 2.6, [0.86, 0.84, 0.78], 'N');
    // Capilla de estilo republicano y filas de tumbas.
    addBuilding(ctx, { minX: block.cx - 6, maxX: block.cx + 6, minZ: lot.maxZ - 18, maxZ: lot.maxZ - 4, height: 11, style: 'iglesia', color: [0.9, 0.88, 0.82] });
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 8; c++) {
        const x = lot.minX + 6 + c * 6;
        const z = lot.minZ + 6 + r * 5;
        if (Math.abs(x - block.cx) < 3) continue;
        addProp(ctx, { type: 'tomb', x, z, rot: 0, variant: rng.int(0, 2), collider: { hx: 0.7, hz: 1.3, maxY: terrainHeight(x, z) + 1.3 } });
      }
    }
    addProp(ctx, { type: 'sign', x: block.cx, z: block.minZ - 0.2, rot: 0, text: 'Cementerio San Pedro' });
    addPoi(ctx, { id: 'cementerio', name: 'Cementerio Museo San Pedro', desc: 'Museo a cielo abierto con mausoleos de mármol.', type: 'landmark', ...sidewalkPoint(block, 'N', 0.5) });
  },

  hospital(block, ctx) {
    const lot = block.lot;
    addBuilding(ctx, { minX: lot.minX + 2, maxX: lot.maxX - 2, minZ: lot.minZ + 10, maxZ: lot.maxZ - 6, floors: 6, style: 'hospital', color: [0.94, 0.95, 0.96] });
    addProp(ctx, { type: 'sign', x: block.cx, z: lot.minZ - 1.2, rot: 0, text: 'Hospital San Vicente' });
    addPoi(ctx, { id: 'hospital', name: 'Hospital San Vicente Fundación', desc: 'Aquí despiertas si te va mal en la calle.', type: 'service', ...sidewalkPoint(block, 'N', 0.5) });
  },

  moravia(block, ctx) {
    const { rng } = ctx;
    addProp(ctx, { type: 'garden', x: block.cx, z: block.cz, w: block.maxX - block.minX, d: block.maxZ - block.minZ, flowers: true });
    for (let k = 0; k < 40; k++) {
      const a = rng.range(0, Math.PI * 2);
      const rr = rng.range(3, 26);
      addProp(ctx, { type: 'tree', kind: rng.pick(['guayacan', 'guayacanRosado', 'mango', 'palma']), x: MORAVIA.x + Math.cos(a) * rr, z: MORAVIA.z + Math.sin(a) * rr, scale: rng.range(0.7, 1.2) });
    }
    addPoi(ctx, { id: 'moravia', name: 'Morro de Moravia', desc: 'De basurero a jardín comunitario: el barrio que se reinventó.', type: 'landmark', x: MORAVIA.x, z: MORAVIA.z });
  },

  armeria(block, ctx) {
    genResidential(block, ctx, { sides: ['S', 'W', 'E'] });
    const lot = block.lot;
    addBuilding(ctx, { minX: lot.minX + 18, maxX: lot.minX + 30, minZ: lot.minZ, maxZ: lot.minZ + 12, floors: 2, style: 'tienda', color: [0.25, 0.27, 0.3], shop: 'armeria' });
    addProp(ctx, { type: 'sign', x: lot.minX + 24, z: lot.minZ - 0.3, rot: 0, text: 'Armería El Parcero' });
    addPoi(ctx, { id: 'armeria', name: 'Armería El Parcero', desc: 'Armas y munición. Presiona E para comprar.', type: 'shop', x: lot.minX + 24, z: block.ring.minZ });
  },

  taller(block, ctx) {
    genResidential(block, ctx, { sides: ['N', 'S', 'E'] });
    const lot = block.lot;
    addBuilding(ctx, { minX: lot.minX, maxX: lot.minX + 14, minZ: block.cz - 10, maxZ: block.cz + 10, height: 7, style: 'taller', color: [0.55, 0.6, 0.65] });
    addProp(ctx, { type: 'sign', x: lot.minX - 0.3, z: block.cz, rot: Math.PI / 2, text: 'Taller Los Motos' });
    addPoi(ctx, { id: 'taller', name: 'Taller Los Motos', desc: 'Reparan tu carro y organizan piques. E: reparar / carrera.', type: 'service', ...sidewalkPoint(block, 'W', 0.5), mission: 'carrera' });
  },

  mirador(block, ctx) {
    genResidential(block, ctx, { sides: ['N', 'S'], low: true });
    addProp(ctx, { type: 'plaza', x: block.cx, z: block.cz, w: 40, d: 26 });
    for (let k = 0; k < 6; k++) {
      const bx = block.cx - 15 + k * 6;
      const bz = block.cz + 8;
      addProp(ctx, { type: 'bench', x: bx, z: bz, rot: Math.PI, collider: { hx: 0.95, hz: 0.3, maxY: terrainHeight(bx, bz) + GRID.curb + 0.9 } });
    }
    addProp(ctx, { type: 'railing', x: block.cx, z: block.cz, w: 40 });
    addPoi(ctx, { id: 'mirador', name: 'Mirador de Aranjuez', desc: 'La mejor vista del valle de Aburrá. De noche parece un pesebre.', type: 'landmark', x: block.cx, z: block.cz + 4 });
  },

  parqueadero(block, ctx) {
    genResidential(block, ctx, { sides: ['N', 'W'] });
    const lot = block.lot;
    addProp(ctx, { type: 'parking', x: (lot.minX + 14 + lot.maxX) / 2, z: (lot.minZ + 14 + lot.maxZ) / 2, w: lot.maxX - lot.minX - 14, d: lot.maxZ - lot.minZ - 14 });
    const types = ['taxi', 'sedan', 'camioneta', 'sedan', 'taxi', 'moto', 'camioneta', 'sedan'];
    let k = 0;
    for (let x = lot.minX + 19; x < lot.maxX - 3; x += 5.5) {
      ctx.city.parkedVehicles.push({ type: types[k++ % types.length], x, z: lot.minZ + 22, heading: 0 });
      ctx.city.parkedVehicles.push({ type: types[k++ % types.length], x, z: lot.maxZ - 6, heading: Math.PI });
    }
  },
};

/** Muro que sigue la pendiente: se parte en tramos de ~6 m. */
function addWall(ctx, minX, minZ, maxX, maxZ, h, color) {
  const alongX = maxX - minX >= maxZ - minZ;
  const len = alongX ? maxX - minX : maxZ - minZ;
  const n = Math.max(1, Math.ceil(len / 6));
  for (let k = 0; k < n; k++) {
    const a0 = (len * k) / n;
    const a1 = (len * (k + 1)) / n;
    const seg = alongX ? { minX: minX + a0, maxX: minX + a1, minZ, maxZ } : { minX, maxX, minZ: minZ + a0, maxZ: minZ + a1 };
    const fh = footprintHeights(seg.minX, seg.maxX, seg.minZ, seg.maxZ);
    addBuilding(ctx, { ...seg, topY: fh.max + GRID.curb + h, style: 'muro', color });
  }
}

function wallRing(ctx, block, h, color, gateSide) {
  const t = 0.35;
  const { minX, maxX, minZ, maxZ } = block.lot;
  const gate = 8;
  const segs = [
    ['N', minX, minZ - t, maxX, minZ],
    ['S', minX, maxZ, maxX, maxZ + t],
    ['W', minX - t, minZ, minX, maxZ],
    ['E', maxX, minZ, maxX + t, maxZ],
  ];
  for (const [side, x0, z0, x1, z1] of segs) {
    const horiz = side === 'N' || side === 'S';
    if (side === gateSide) {
      const mid = horiz ? (x0 + x1) / 2 : (z0 + z1) / 2;
      if (horiz) {
        addWall(ctx, x0, z0, mid - gate / 2, z1, h, color);
        addWall(ctx, mid + gate / 2, z0, x1, z1, h, color);
      } else {
        addWall(ctx, x0, z0, x1, mid - gate / 2, h, color);
        addWall(ctx, x0, mid + gate / 2, x1, z1, h, color);
      }
    } else {
      addWall(ctx, x0, z0, x1, z1, h, color);
    }
  }
}

function addMetro(ctx) {
  const x = MAP_MIN_X - 26;
  const z0 = MAP_MIN_Z - 160;
  const z1 = MAP_MAX_Z + 160;
  const deckY = terrainHeight(x, 0) + 11;
  const stationZ = roadLine(6, GRID.nz); // Calle 73, frente al Botánico y Explora
  ctx.city.metro = { x, z0, z1, deckY, stationZ, stationLength: 70 };
  for (let z = z0; z <= z1; z += 30) {
    if (Math.abs(z - stationZ) < 40) continue;
    addProp(ctx, { type: 'metroPillar', x, z, top: deckY, collider: { hx: 0.9, hz: 0.9 } });
  }
  for (const dz of [-30, -10, 10, 30]) {
    for (const dx of [-5, 5]) addProp(ctx, { type: 'metroPillar', x: x + dx, z: stationZ + dz, top: deckY, collider: { hx: 0.7, hz: 0.7 } });
  }
  addPoi(ctx, { id: 'metro', name: 'Estación Universidad (Metro)', desc: 'Línea A del Metro de Medellín, junto al Botánico y Explora.', type: 'landmark', x: x + 9, z: stationZ });
}

function addPowerLines(ctx) {
  // Postes de energía a lo largo de las carreras, con el cableado aéreo típico.
  const poles = [];
  const off = GRID.asphaltHalf + 0.35;
  for (let i = 0; i <= GRID.nx; i++) {
    const x = roadLine(i, GRID.nx) + off;
    let prev = null;
    for (let z = MAP_MIN_Z + 12; z <= MAP_MAX_Z - 12; z += 35) {
      const zz = z;
      // Evitar intersecciones.
      const nearInter = Math.abs(((zz - MAP_MIN_Z) % GRID.pitch) - 0) < 9 || Math.abs(((zz - MAP_MIN_Z) % GRID.pitch) - GRID.pitch) < 9;
      if (nearInter) {
        prev = null;
        continue;
      }
      if (MERGED_BLOCKS.some((m) => { const r = mergedRect(m); return x > r.minX - 1 && x < r.maxX + 1 && zz > r.minZ && zz < r.maxZ; })) {
        prev = null;
        continue;
      }
      const p = addProp(ctx, { type: 'pole', x, z: zz, h: 9, collider: { hx: 0.15, hz: 0.15 } });
      poles.push(p);
      if (prev) ctx.city.props.push({ type: 'cable', a: prev, b: p });
      prev = p;
    }
  }
  return poles;
}
