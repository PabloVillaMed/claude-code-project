import { describe, expect, it } from 'vitest';
import { generateCity } from '../../src/sim/cityLayout.js';
import { BANDS, HOMELESS_COUNT, PLAZA_COUNT, blockCorners, buildStreetLife, nextWarDelay, pickWar } from '../../src/sim/streetLife.js';
import { ROPA_BY_ID } from '../../src/sim/ropa.js';

const city = generateCity(4);
const life = buildStreetLife(city);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

describe('vida de la calle: plazas de las bandas', () => {
  it('veinte plazas en esquinas del andén, separadas y lejos de lo tranquilo', () => {
    const { plazas } = life;
    expect(plazas.length).toBe(PLAZA_COUNT);
    const quiet = city.pois.filter((p) => ['iglesia', 'hospital', 'policia', 'metro', 'parque'].includes(p.id));
    for (const q of plazas) {
      expect(city.collision.pointBlocked(q.x, q.z), q.id).toBe(false);
      expect(dist(q, city.spawn), q.id).toBeGreaterThan(60);
      for (const p of quiet) expect(dist(q, p), `${q.id} junto a ${p.id}`).toBeGreaterThan(35);
      expect(q.spots.length).toBeGreaterThan(0);
      for (const s of q.spots) {
        expect(dist(s, q)).toBeLessThan(3.5);
        expect(Number.isFinite(s.yaw)).toBe(true);
      }
    }
    for (let i = 0; i < plazas.length; i++) for (let j = i + 1; j < plazas.length; j++) expect(dist(plazas[i], plazas[j])).toBeGreaterThanOrEqual(45);
  });

  it('las tres bandas, repartidas de oeste a este, con pinta que existe', () => {
    const ids = BANDS.map((b) => b.id);
    const by = Object.fromEntries(ids.map((id) => [id, life.plazas.filter((q) => q.band === id)]));
    for (const id of ids) expect(by[id].length, id).toBeGreaterThanOrEqual(5);
    const meanX = (list) => list.reduce((s, q) => s + q.x, 0) / list.length;
    expect(meanX(by.morro)).toBeLessThan(meanX(by.quebrada));
    expect(meanX(by.quebrada)).toBeLessThan(meanX(by.loma));
    for (const b of BANDS) for (const id of Object.values(b.outfit)) expect(ROPA_BY_ID[id], `${b.id}: ${id}`).toBeTruthy();
  });

  it('esquinas convexas: afuera de la esquina queda la calle', () => {
    const corners = blockCorners(city);
    expect(corners.length).toBeGreaterThan(100);
    for (const c of corners.slice(0, 50)) {
      expect(Math.hypot(...c.out)).toBeCloseTo(1, 5);
      // La salida de la esquina apunta entre las dos calles (contra los dos tramos).
      expect(c.out[0] * c.a[0] + c.out[1] * c.a[1]).toBeGreaterThan(-0.2);
      expect(c.out[0] * c.b[0] + c.out[1] * c.b[1]).toBeLessThan(0.2);
    }
  });

  it('determinista: la misma ciudad da las mismas plazas y habitantes de calle', () => {
    expect(buildStreetLife(city)).toEqual(life);
  });
});

describe('vida de la calle: habitantes de calle', () => {
  it('doce, en el andén y lejos unos de otros', () => {
    const { homeless, plazas } = life;
    expect(homeless.length).toBe(HOMELESS_COUNT);
    for (const h of homeless) {
      expect(city.collision.pointBlocked(h.x, h.z), h.id).toBe(false);
      expect(typeof h.walks).toBe('boolean');
    }
    for (let i = 0; i < homeless.length; i++) for (let j = i + 1; j < homeless.length; j++) expect(dist(homeless[i], homeless[j])).toBeGreaterThan(30);
    // No se paran en la esquina de una banda.
    for (const h of homeless) for (const q of plazas) expect(dist(h, q), `${h.id} en ${q.id}`).toBeGreaterThan(20);
  });
});

describe('vida de la calle: balaceras', () => {
  it('cada 9 a 16 minutos de juego', () => {
    expect(nextWarDelay(() => 0)).toBe(540);
    expect(nextWarDelay(() => 0.999999)).toBeCloseTo(960, 0);
  });

  it('solo entre bandas rivales, cerca del jugador y sin caerle encima', () => {
    const { plazas } = life;
    let found = 0;
    for (const q of plazas) {
      const pair = pickWar(plazas, q.x + 40, q.z, () => 0.5);
      if (!pair) continue;
      found++;
      expect(pair.a.band).not.toBe(pair.b.band);
      const d = dist(pair.a, pair.b);
      expect(d).toBeGreaterThanOrEqual(45);
      expect(d).toBeLessThanOrEqual(170);
      const near = Math.min(Math.hypot(pair.a.x - q.x - 40, pair.a.z - q.z), Math.hypot(pair.b.x - q.x - 40, pair.b.z - q.z));
      expect(near).toBeGreaterThanOrEqual(30);
      expect(near).toBeLessThanOrEqual(160);
    }
    expect(found).toBeGreaterThan(0);
    // Lejos de todo (afuera del mapa): ninguna.
    expect(pickWar(plazas, 5000, 5000)).toBeNull();
  });
});
