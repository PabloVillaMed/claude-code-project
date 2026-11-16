// Comercios del día a día a los que se entra (v3.8, sim/interiors.js
// armarLocal): la huella propia del edificio (sin tumbar vecinos, solo el
// primer piso), el horario por tema, el cascarón con su puerta (el vano de la
// vitrina), el piso al nivel del andén, el mostrador macizo y el punto de la
// compra (y el espejo de los almacenes) al que se llega caminando.
import { describe, expect, it } from 'vitest';
import { city } from './helpers.js';
import {
  COMERCIO,
  COMERCIO_TEMAS,
  HORARIOS,
  INTERIORES_ACTIVOS,
  MENUS_COMERCIO,
  PLANES_LOCAL,
  TAMANOS,
  aLocal,
  aMundo,
  abiertoA,
  dentroInterior,
  planComercio,
  puntoCompra,
} from '../../src/sim/interiors.js';
import { groundHeight } from '../../src/sim/terrain.js';
import { createPlayerState, emptyMoveInput, stepPlayer } from '../../src/sim/playerController.js';

const C = city();
const env = { groundHeight, collision: C.collision };
const L = C.locales ?? [];
const byId = (id) => L.find((r) => r.id === id);
const edificio = (r) => C.buildings.find((b) => !b.gone && b.local?.id === r.id);

/** Camina en línea recta hacia (tx, tz) (mundo); devuelve el estado final. */
function walkTo(s, tx, tz, secs = 10) {
  const inp = emptyMoveInput();
  for (let t = 0; t < secs; t += 0.05) {
    const dx = tx - s.pos.x;
    const dz = tz - s.pos.z;
    if (Math.hypot(dx, dz) < 0.2) break;
    inp.forward = 1;
    inp.camYaw = Math.atan2(-dx, -dz);
    stepPlayer(s, inp, 0.05, env);
  }
  return s;
}

/** Con la puerta (la cortina) abierta mientras corre `fn`. */
function withDoorOpen(r, fn) {
  C.collision.remove(r.doorBox);
  try {
    return fn();
  } finally {
    C.collision.restore(r.doorBox);
  }
}

/**
 * Camino por el salón (coordenadas locales) de (ax, az) a (bx, bz) esquivando
 * lo macizo (con el radio del jugador): búsqueda a lo ancho en una rejilla.
 * Devuelve los puntos de paso (mundo) o null.
 */
function camino(r, ax, az, bx, bz) {
  const h = 0.2;
  const pad = 0.38;
  const nx = Math.floor((r.X1 - r.X0) / h);
  const nz = Math.floor((r.Z1 - r.Z0 + 0.6) / h);
  const cx = (i) => r.X0 + (i + 0.5) * h;
  const cz = (j) => r.Z0 + (j + 0.5) * h;
  const libre = (x, z) => {
    if (x < r.X0 + pad || x > r.X1 - pad || z < r.Z0 + pad) return false;
    if (z > r.Z1 && (x < r.door.x0 + pad || x > r.door.x1 - pad)) return false;
    return !r.items.some((it) => it.solid && x > it.x0 - pad && x < it.x1 + pad && z > it.z0 - pad && z < it.z1 + pad);
  };
  const cell = (x, z) => [Math.max(0, Math.min(nx - 1, Math.floor((x - r.X0) / h))), Math.max(0, Math.min(nz - 1, Math.floor((z - r.Z0) / h)))];
  const [i0, j0] = cell(ax, az);
  const [i1, j1] = cell(bx, bz);
  const prev = new Map([[i0 * 1000 + j0, -1]]);
  const q = [[i0, j0]];
  while (q.length) {
    const [i, j] = q.shift();
    if (i === i1 && j === j1) break;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di;
      const b = j + dj;
      const k = a * 1000 + b;
      if (a < 0 || b < 0 || a >= nx || b >= nz || prev.has(k)) continue;
      if (!libre(cx(a), cz(b)) && !(a === i1 && b === j1)) continue;
      prev.set(k, i * 1000 + j);
      q.push([a, b]);
    }
  }
  if (!prev.has(i1 * 1000 + j1)) return null;
  const pts = [];
  for (let k = i1 * 1000 + j1; k !== -1; k = prev.get(k)) pts.push(aMundo(r, cx(Math.floor(k / 1000)), cz(k % 1000)));
  pts.reverse();
  pts.push(aMundo(r, bx, bz));
  // (De a dos celdas: el jugador corta las esquinas suaves.)
  return pts.filter((_, n) => n % 2 === 0 || n === pts.length - 1);
}

/** Entra caminando desde el andén y sigue el camino hasta el punto `to` (local); devuelve el estado. */
function entrarHasta(r, to) {
  const dc = (r.door.x0 + r.door.x1) / 2;
  const out = aMundo(r, dc, 1.4);
  const s = createPlayerState(out.x, out.z, groundHeight);
  const pts = camino(r, dc, r.Z1 + 0.25, to.lx, to.lz);
  expect(pts, `${r.id}: camino de la puerta al punto`).toBeTruthy();
  for (const p of pts) walkTo(s, p.x, p.z, 4);
  return s;
}

const enCiudad = INTERIORES_ACTIVOS ? it : it.skip;

describe('comercios a los que se entra', () => {
  it('planes de local: tema, variante y tamaño "local" (huella propia, un piso)', () => {
    expect(planComercio('arriero', 'ropa')).toEqual({ tema: 'almacen', variante: 'paisa', tam: 'local' });
    expect(planComercio('mandingas92', 'comidas')).toEqual({ tema: 'comidas', variante: 'papas', tam: 'local' });
    expect(planComercio('com1', 'tienda')).toEqual({ tema: 'tienda', variante: null, tam: 'local' });
    expect(planComercio('com2', 'ferreteria').tema).toBe('cacharreria');
    expect(planComercio('com3', 'discoteca')).toBe(null);
    expect(TAMANOS.local.propia).toBe(true);
    expect(TAMANOS.local.pisos).toBe(1);
    // Los diez con nombre (ocho almacenes de ropa y dos de comida).
    const nombrados = Object.values(PLANES_LOCAL);
    expect(nombrados.filter((p) => p.tema === 'almacen').length).toBe(8);
    expect(nombrados.filter((p) => p.tema === 'comidas').length).toBe(2);
  });

  it('horario por tema: de día abierto, de noche cortina abajo', () => {
    expect(HORARIOS.tienda).toEqual([6, 22]);
    expect(HORARIOS.panaderia).toEqual([5, 20]);
    expect(HORARIOS.almacen).toEqual([9, 20]);
    expect(HORARIOS.comidas).toEqual([10, 24]);
    const tienda = { horario: HORARIOS.tienda };
    expect(abiertoA(tienda, 5.9)).toBe(false);
    expect(abiertoA(tienda, 6)).toBe(true);
    expect(abiertoA(tienda, 21.9)).toBe(true);
    expect(abiertoA(tienda, 22)).toBe(false);
    expect(abiertoA(tienda, 30)).toBe(true); // (las 6 de la mañana del otro día)
    const pan = { horario: HORARIOS.panaderia };
    expect(abiertoA(pan, 5)).toBe(true);
    expect(abiertoA(pan, 20.5)).toBe(false);
    const alm = { horario: HORARIOS.almacen };
    expect(abiertoA(alm, 8.9)).toBe(false);
    expect(abiertoA(alm, 19.5)).toBe(true);
    const com = { horario: HORARIOS.comidas };
    expect(abiertoA(com, 23.95)).toBe(true);
    expect(abiertoA(com, 0.5)).toBe(false);
    // Las discotecas (sin horario) siguen con la rumba: de noche.
    expect(abiertoA({}, 23)).toBe(true);
    expect(abiertoA({}, 12)).toBe(false);
  });

  enCiudad('los de nombre y una selección de genéricos: entre 20 y 30, con su menú o su ropa', () => {
    const total = L.length;
    expect(total).toBeGreaterThanOrEqual(20);
    expect(total).toBeLessThanOrEqual(30);
    const ids = new Set(L.map((r) => r.id));
    expect(ids.size).toBe(total);
    for (const id of Object.keys(PLANES_LOCAL)) if (!COMERCIO.EXCLUIDOS.includes(id)) expect(ids.has(id), id).toBe(true);
    for (const id of COMERCIO.EXCLUIDOS) expect(ids.has(id), id).toBe(false);
    const genericos = L.filter((r) => !PLANES_LOCAL[r.id]);
    const cupo = Object.values(COMERCIO.CUPOS).reduce((a, b) => a + b, 0);
    expect(genericos.length).toBeLessThanOrEqual(cupo);
    for (const [tema, n] of Object.entries(COMERCIO.CUPOS)) expect(genericos.filter((r) => r.tema === tema).length, tema).toBeLessThanOrEqual(n);
    // Las discotecas siguen siendo las ocho y no se cruzan con los comercios.
    for (const r of C.interiors) expect(ids.has(r.id), r.id).toBe(false);
    for (const r of L) {
      // Lo que se vende: el mismo menú o surtido del lugar de afuera (los de nombre) o el del tema.
      const poi = r.poi ? C.pois.find((p) => p.id === r.poi) : null;
      if (PLANES_LOCAL[r.id]) {
        expect(poi, r.id).toBeTruthy();
        if (r.store) expect(r.store, r.id).toBe(poi.store);
        else expect(r.menu, r.id).toBe(poi.menu);
      } else expect(r.menu, r.id).toBe(MENUS_COMERCIO[r.tema]);
      expect(r.menu?.length || r.store, r.id).toBeTruthy();
      // El que atiende, el punto de la compra y (en los almacenes) el espejo.
      expect(r.spots.tendero.length, r.id).toBeGreaterThan(0);
      expect(r.spots.mostrador.length, r.id).toBeGreaterThan(0);
      if (r.tema === 'almacen') expect(r.spots.espejo.length, r.id).toBeGreaterThan(0);
    }
    // Mandingas (donde empieza la historia): su lugar de afuera sigue frente a la puerta.
    const m = byId('mandingas92');
    const pm = C.pois.find((p) => p.id === 'mandingas92');
    const d = aLocal(m, pm.x, pm.z);
    expect(d.z).toBeGreaterThan(0);
    expect(d.z).toBeLessThan(3.5);
  });

  enCiudad('huella propia: el ancho del edificio, el fondo del tema y solo el primer piso', () => {
    for (const r of L) {
      const b = edificio(r);
      expect(b, r.id).toBeTruthy();
      const f = b.frame;
      expect(r.W, r.id).toBeCloseTo(2 * f.hu, 6);
      expect(r.D, r.id).toBeCloseTo(Math.min(2 * f.hv, COMERCIO_TEMAS[r.tema].fondo), 6);
      expect(r.D, r.id).toBeGreaterThanOrEqual(COMERCIO.FONDO_MIN - 1e-6);
      expect(r.W, r.id).toBeGreaterThanOrEqual(COMERCIO.ANCHO_MIN - 1e-6);
      // El frente es el de la casa (sin correrse) y el techo cabe en el primer piso.
      expect(Math.hypot(r.ox - (f.x + f.nx * f.hv), r.oz - (f.z + f.nz * f.hv)), r.id).toBeLessThan(1e-6);
      expect(r.H, r.id).toBeLessThanOrEqual(COMERCIO.ALTO + 1e-9);
      expect(r.H, r.id).toBeGreaterThan(2.4);
      expect(r.y0 + r.H, r.id).toBeLessThan(r.topY);
      expect(r.mezz, r.id).toBe(null);
      expect(r.stairs.length, r.id).toBe(0);
      // La puerta es el vano de la vitrina: dentro del frente y de buen ancho.
      expect(r.door.x0, r.id).toBeGreaterThanOrEqual(r.X0);
      expect(r.door.x1, r.id).toBeLessThanOrEqual(r.X1);
      expect(r.door.x1 - r.door.x0, r.id).toBeGreaterThan(1.2);
    }
  });

  enCiudad('cerrado no se entra; abierto se camina del andén al piso de la tienda', () => {
    for (const r of L) {
      const dc = (r.door.x0 + r.door.x1) / 2;
      const out = aMundo(r, dc, 1.4);
      const inn = aMundo(r, dc, r.Z1 - 0.9);
      // Cortina abajo: se queda afuera.
      const s0 = createPlayerState(out.x, out.z, groundHeight);
      walkTo(s0, inn.x, inn.z, 4);
      expect(dentroInterior(r, s0.pos.x, s0.pos.z, s0.pos.y), r.id).toBe(false);
      // Cortina arriba: entra con los pies en el piso del local (al nivel del andén).
      withDoorOpen(r, () => {
        const s = createPlayerState(out.x, out.z, groundHeight);
        walkTo(s, inn.x, inn.z, 5);
        expect(dentroInterior(r, s.pos.x, s.pos.z, s.pos.y), r.id).toBe(true);
        expect(Math.abs(s.pos.y - r.floorY), r.id).toBeLessThan(0.05);
        // Y sale otra vez a la calle.
        walkTo(s, out.x, out.z, 5);
        expect(dentroInterior(r, s.pos.x, s.pos.z, s.pos.y), r.id).toBe(false);
      });
    }
  });

  enCiudad('los muros, el techo y el mostrador tapan; el piso es el del local', () => {
    for (const r of L) {
      const y = r.y0 + 1.2;
      const probe = (lx, lz, yy = y) => {
        const p = aMundo(r, lx, lz);
        return C.collision.pointBlocked(p.x, p.z, yy);
      };
      expect(probe(r.X0 - 0.1, (r.Z0 + r.Z1) / 2), r.id).toBe(true);
      expect(probe(r.X1 + 0.1, (r.Z0 + r.Z1) / 2), r.id).toBe(true);
      expect(probe((r.X0 + r.X1) / 2, r.Z0 - 0.1), r.id).toBe(true);
      // Lo de atrás de la casa (bodega) queda macizo.
      if (r.deep > r.D + 0.5) expect(probe(0, -r.D - 0.3), r.id).toBe(true);
      // El techo del local: un rayo que sube choca a la altura del cielo raso.
      const c = aMundo(r, (r.door.x0 + r.door.x1) / 2, r.Z1 - 0.8);
      const hit = C.collision.raycast(c.x, r.y0 + 2, c.z, 0, 1, 0, 30);
      expect(hit, r.id).toBeTruthy();
      expect(r.y0 + 2 + hit.t, r.id).toBeLessThanOrEqual(r.y0 + r.H + 0.05);
      // El piso: el del local frente a la puerta (aunque la loma pase por debajo o por encima).
      expect(groundHeight(c.x, c.z, r.y0 + 0.05), r.id).toBeCloseTo(r.y0, 5);
      // El mostrador es macizo.
      const m = r.items.find((it) => it.t === 'mostrador');
      expect(m, r.id).toBeTruthy();
      expect(probe((m.x0 + m.x1) / 2, (m.z0 + m.z1) / 2, r.y0 + 0.5), r.id).toBe(true);
      expect(probe((m.x0 + m.x1) / 2, (m.z0 + m.z1) / 2, r.y0 + m.h + 0.3), r.id).toBe(false);
    }
  });

  enCiudad('comprar: se llega caminando al mostrador (y al espejo de los almacenes)', () => {
    for (const r of L) {
      withDoorOpen(r, () => {
        const m = r.spots.mostrador[0];
        const s = entrarHasta(r, m);
        expect(Math.hypot(s.pos.x - m.x, s.pos.z - m.z), r.id).toBeLessThan(COMERCIO.RANGO_COMPRA);
        expect(puntoCompra(r, s.pos.x, s.pos.z), r.id).toBe('mostrador');
        if (r.store) {
          const e = r.spots.espejo[0];
          const s2 = entrarHasta(r, e);
          expect(Math.hypot(s2.pos.x - e.x, s2.pos.z - e.z), r.id).toBeLessThan(COMERCIO.RANGO_ESPEJO);
          expect(puntoCompra(r, s2.pos.x, s2.pos.z), r.id).toBe('espejo');
        }
      });
      // En la puerta no se compra.
      const p = aMundo(r, (r.door.x0 + r.door.x1) / 2, r.Z1 - 0.3);
      expect(puntoCompra(r, p.x, p.z), r.id).toBe(null);
    }
    // Sin espejo (los que no venden ropa) E frente al mostrador es comprar.
    const t = L.find((r) => r.tema === 'tienda');
    expect(puntoCompra({ ...t, store: null }, t.spots.mostrador[0].x, t.spots.mostrador[0].z)).toBe('mostrador');
  });
});
