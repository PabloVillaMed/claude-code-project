import { describe, expect, it } from 'vitest';
import { generateCity } from '../../src/sim/cityLayout.js';
import { RoadGraph } from '../../src/sim/roadNav.js';
import { groundHeight, onRoad, terrainHeight } from '../../src/sim/terrain.js';
import { frameCorners, pointInPoly, polyArea } from '../../src/sim/geom2d.js';
import { city } from './helpers.js';

describe('ciudad: mapa real de Moravia a Aranjuez', () => {
  it('es determinista con la misma semilla', () => {
    const a = generateCity(7);
    const b = generateCity(7);
    expect(a.buildings.length).toBe(b.buildings.length);
    const pick = (c) => c.buildings.slice(0, 200).map((h) => [h.frame, h.style, h.roof, h.floors, h.topY]);
    expect(pick(a)).toEqual(pick(b));
  }, 120000);

  it('tiene los puntos de interés reales del barrio', () => {
    const ids = city().pois.map((p) => p.id);
    for (const id of ['parque', 'iglesia', 'museo', 'metro', 'hospital', 'moravia', 'armeria', 'taller', 'cancha', 'mirador', 'cayetano', 'consuelo', 'comfama']) {
      expect(ids).toContain(id);
    }
  });

  it('todos los puntos de interés son accesibles (no están dentro de un edificio)', () => {
    const c = city();
    for (const p of c.pois) {
      expect(c.collision.pointBlocked(p.x, p.z), p.id).toBe(false);
      const free = [0, 1, 2, 3, 4, 5, 6, 7].some((k) => {
        const a = (k / 8) * Math.PI * 2;
        return !c.collision.pointBlocked(p.x + Math.cos(a) * 3, p.z + Math.sin(a) * 3);
      });
      expect(free, p.id).toBe(true);
    }
  });

  it('el punto de aparición está libre y sobre el suelo', () => {
    const c = city();
    expect(c.collision.pointBlocked(c.spawn.x, c.spawn.z)).toBe(false);
    expect(Number.isFinite(groundHeight(c.spawn.x, c.spawn.z))).toBe(true);
  });

  it('no es una cuadrícula: vías curvas y diagonales, largas transversales', () => {
    const c = city();
    const g = new RoadGraph(c);
    expect(g.active.length).toBeGreaterThan(300);
    // Muchas vías con quiebres (polilíneas), no rectas de nodo a nodo.
    const curvy = c.edges.filter((e) => e.pts.length > 3).length;
    expect(curvy).toBeGreaterThan(80);
    // Rumbos variados: no solo norte-sur y oriente-occidente.
    const diag = c.edges.filter((e) => {
      const [a, b] = [e.pts[0], e.pts[e.pts.length - 1]];
      const ang = Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0])) % (Math.PI / 2);
      return ang > 0.3 && ang < 1.27;
    }).length;
    expect(diag / c.edges.length).toBeGreaterThan(0.15);
    // Hay transversales con su nombre real.
    expect(c.edges.some((e) => /Transversal/.test(e.name))).toBe(true);
  });

  it('geografía real: el río y Moravia al occidente, Aranjuez en la ladera oriental', () => {
    const c = city();
    const at = (id) => c.pois.find((p) => p.id === id);
    expect(at('moravia').x).toBeLessThan(at('museo').x);
    expect(at('metro').x).toBeLessThan(at('moravia').x); // la Caribe al otro lado del río
    expect(at('parque').x).toBeGreaterThan(at('museo').x); // el parque hacia el oriente
    expect(at('parque').z).toBeLessThan(at('museo').z); // la Calle 92 al norte
    expect(terrainHeight(at('mirador').x, at('mirador').z)).toBeGreaterThan(terrainHeight(at('moravia').x + 150, at('moravia').z) + 60);
  });

  it('Moravia: casas angostas, casi todas de ladrillo a la vista y techos de zinc', () => {
    const houses = city().buildings.filter((h) => h.informal && !h.interior);
    expect(houses.length).toBeGreaterThan(200);
    const brick = houses.filter((h) => h.style === 'ladrillo').length / houses.length;
    expect(brick).toBeGreaterThan(0.6);
    expect(houses.every((h) => h.style !== 'torre')).toBe(true);
    expect(houses.filter((h) => h.roof === 'zinc').length / houses.length).toBeGreaterThan(0.3);
  });

  it('techos variados, no solo cajas planas', () => {
    const roofs = new Set(city().buildings.map((b) => b.roof));
    for (const r of ['terraza', 'plancha', 'dosAguas', 'cuatroAguas', 'zinc']) expect(roofs).toContain(r);
  });

  it('venteros, placas y paraderos en los andenes', () => {
    const c = city();
    const vendors = c.props.filter((p) => p.type === 'vendor');
    expect(vendors.length).toBeGreaterThan(8);
    const signs = c.props.filter((p) => p.type === 'streetSign');
    expect(signs.length).toBeGreaterThan(50);
    for (const s of signs) expect(s.names.length).toBe(2);
    for (const p of [...vendors, ...signs, ...c.props.filter((q) => q.type === 'busStop')]) {
      expect(onRoad(p.x, p.z)).toBe(false);
      expect(c.blocks.some((b) => pointInPoly(p.x, p.z, b.curb))).toBe(true);
    }
  });

  it('ningún edificio invade la calzada', () => {
    const bad = [];
    for (const b of city().buildings) {
      const f = b.frame;
      const pts = [...frameCorners(f).map(([x, z]) => [x + (f.x - x) * 0.1, z + (f.z - z) * 0.1]), [f.x, f.z]];
      if (pts.some(([x, z]) => onRoad(x, z))) bad.push([b.style, Math.round(f.x), Math.round(f.z)]);
    }
    expect(bad).toEqual([]);
  });

  it('los edificios no dejan huecos bajo la base en la ladera', () => {
    for (const b of city().buildings) {
      const hMin = Math.min(...[...frameCorners(b.frame), [b.frame.x, b.frame.z]].map(([x, z]) => terrainHeight(x, z)));
      expect(b.baseY).toBeLessThanOrEqual(hMin);
      expect(b.topY).toBeGreaterThan(b.baseY + 1);
    }
  });

  it('las calles son subibles en carro', () => {
    const c = city();
    let maxRoadSlope = 0;
    for (const e of c.edges) {
      for (let i = 1; i < e.pts.length; i++) {
        const [ax, az] = e.pts[i - 1];
        const [bx, bz] = e.pts[i];
        const l = Math.hypot(bx - ax, bz - az);
        if (l < 4) continue;
        maxRoadSlope = Math.max(maxRoadSlope, Math.abs(terrainHeight(bx, bz) - terrainHeight(ax, az)) / l);
      }
    }
    // Empinadas como en Medellín, pero subibles (< 30 %).
    expect(maxRoadSlope).toBeLessThan(0.3);
  });

  it('manzanas con andén y lotes adentro', () => {
    const c = city();
    const res = c.blocks.filter((b) => b.type === 'residencial');
    expect(res.length).toBeGreaterThan(150);
    for (const b of res.slice(0, 60)) {
      expect(Math.abs(polyArea(b.ring))).toBeGreaterThan(10);
      for (const l of b.lots) expect(pointInPoly(l[0][0], l[0][1], b.curb)).toBe(true);
    }
  });

  it('hay motos parqueadas en lugares libres', () => {
    const c = city();
    expect(c.parkedVehicles.length).toBeGreaterThan(10);
    for (const v of c.parkedVehicles) expect(c.collision.pointBlocked(v.x, v.z)).toBe(false);
  });
});
