import { describe, expect, it } from 'vitest';
import { generateCity } from '../../src/sim/cityLayout.js';
import { RoadGraph } from '../../src/sim/roadNav.js';
import { groundHeight, onRoad, terrainHeight, GRID, roadLine } from '../../src/sim/terrain.js';
import { city } from './helpers.js';

describe('ciudad: Aranjuez (MVP)', () => {
  it('es determinista con la misma semilla', () => {
    const a = generateCity(7);
    const b = generateCity(7);
    expect(a.buildings.length).toBe(b.buildings.length);
    expect(a.buildings[100]).toEqual(b.buildings[100]);
  });

  it('tiene los puntos de interés del barrio', () => {
    const ids = city().pois.map((p) => p.id);
    for (const id of ['parque', 'iglesia', 'museo', 'botanico', 'explora', 'metro', 'hospital', 'cementerio', 'moravia', 'armeria', 'taller', 'cancha', 'mirador']) {
      expect(ids).toContain(id);
    }
  });

  it('todos los puntos de interés son accesibles (no están dentro de un edificio)', () => {
    const c = city();
    for (const p of c.pois) {
      expect(c.collision.pointBlocked(p.x, p.z), p.id).toBe(false);
      // Y no están encerrados: al menos una dirección libre a 3 m.
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

  it('la red vial está conectada y el Botánico no tiene vías internas', () => {
    const c = city();
    const g = new RoadGraph(c);
    expect(g.isConnected()).toBe(true);
    // Centro del Botánico: no es vía.
    const b = c.blocks.find((x) => x.type === 'botanico');
    expect(onRoad(b.cx, b.cz)).toBe(false);
    expect(onRoad(roadLine(1, GRID.nx), b.cz)).toBe(false);
  });

  it('ningún edificio invade la calzada', () => {
    for (const b of city().buildings) {
      const pts = [
        [b.minX + 0.2, b.minZ + 0.2],
        [b.maxX - 0.2, b.maxZ - 0.2],
        [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2],
      ];
      for (const [x, z] of pts) expect(onRoad(x, z)).toBe(false);
    }
  });

  it('los edificios no dejan huecos bajo la base en la ladera', () => {
    for (const b of city().buildings) {
      const hMin = Math.min(terrainHeight(b.minX, b.minZ), terrainHeight(b.maxX, b.maxZ), terrainHeight(b.minX, b.maxZ), terrainHeight(b.maxX, b.minZ));
      expect(b.baseY).toBeLessThanOrEqual(hMin);
      expect(b.topY).toBeGreaterThan(b.baseY + 1);
    }
  });

  it('el terreno sube hacia el oriente (ladera) con pendientes transitables', () => {
    expect(terrainHeight(200, 0)).toBeGreaterThan(terrainHeight(-200, 0));
    let maxSlope = 0;
    let maxRoadSlope = 0;
    for (let x = -300; x < 300; x += 3) {
      for (let z = -300; z < 300; z += 3) {
        const s = Math.hypot(terrainHeight(x + 1, z) - terrainHeight(x, z), terrainHeight(x, z + 1) - terrainHeight(x, z));
        maxSlope = Math.max(maxSlope, s);
        if (onRoad(x, z)) maxRoadSlope = Math.max(maxRoadSlope, s);
      }
    }
    // Calles empinadas como en Medellín, pero subibles en carro (< 25 %).
    expect(maxRoadSlope).toBeLessThan(0.25);
    // Solo el Morro de Moravia supera eso, sin volverse un muro.
    expect(maxSlope).toBeLessThan(0.45);
  });

  it('hay vehículos parqueados en lugares libres', () => {
    const c = city();
    expect(c.parkedVehicles.length).toBeGreaterThan(10);
    for (const v of c.parkedVehicles) expect(c.collision.pointBlocked(v.x, v.z)).toBe(false);
  });
});
