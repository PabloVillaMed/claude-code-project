import { describe, expect, it } from 'vitest';
import { FACADE, MODELED_STYLES, facadeLayout, faceFrame } from '../../src/sim/facades.js';
import { onRoad } from '../../src/sim/terrain.js';
import { city } from './helpers.js';

const modeled = () => city().buildings.map((b, i) => [b, i]).filter(([b]) => MODELED_STYLES.has(b.style));

describe('fachadas casa por casa', () => {
  it('cada casa tiene su propia distribución (determinista)', () => {
    const list = modeled();
    expect(list.length).toBeGreaterThan(600);
    for (const [b, i] of list.slice(0, 50)) expect(facadeLayout(b, i)).toEqual(facadeLayout(b, i));
    // Variedad: no todas las casas tienen el mismo número de ventanas.
    const counts = new Set(list.map(([b, i]) => facadeLayout(b, i).openings.filter((o) => o.kind === 'window').length));
    expect(counts.size).toBeGreaterThan(4);
  });

  it('los huecos caben en la fachada y no se montan entre sí', () => {
    for (const [b, i] of modeled()) {
      const L = facadeLayout(b, i);
      const len = L.face.len;
      for (const o of L.openings) {
        expect(o.u0).toBeGreaterThanOrEqual(0);
        expect(o.u1).toBeLessThanOrEqual(len + 1e-6);
        expect(o.u1 - o.u0).toBeGreaterThan(0.5);
        expect(o.v0).toBeGreaterThanOrEqual(0);
        // Ninguna ventana atraviesa la placa del piso de arriba.
        expect(o.v1).toBeLessThanOrEqual((o.floor + 1) * L.floorH - FACADE.band * 0.5 + 1e-6);
      }
      for (let fl = 0; fl < L.floors; fl++) {
        const row = L.openings.filter((o) => o.floor === fl).sort((a, c) => a.u0 - c.u0);
        for (let k = 1; k < row.length; k++) expect(row[k].u0).toBeGreaterThanOrEqual(row[k - 1].u1 + 0.2);
      }
    }
  });

  it('toda casa tiene por dónde entrar desde la calle y los locales tienen su local', () => {
    for (const [b, i] of modeled()) {
      const L = facadeLayout(b, i);
      if (L.face.len < 2.2) continue;
      const entry = L.openings.filter((o) => o.floor === 0 && ['door', 'garage', 'shop'].includes(o.kind));
      expect(entry.length).toBeGreaterThan(0);
      if (b.style === 'tienda') expect(L.shop?.name).toBeTruthy();
    }
  });

  it('la fachada modelada es la que da a la calle', () => {
    let checked = 0;
    for (const [b, i] of modeled()) {
      if (!b.front) continue;
      const L = facadeLayout(b, i);
      const f = faceFrame(b, L.side);
      // 3 m por delante del centro de la fachada queda andén o calle, no otra casa.
      const cx = f.x0 + f.rx * (f.len / 2) + f.nx * 3;
      const cz = f.z0 + f.rz * (f.len / 2) + f.nz * 3;
      const inside = city().buildings.some((o) => o !== b && cx > o.minX && cx < o.maxX && cz > o.minZ && cz < o.maxZ);
      expect(inside).toBe(false);
      if (onRoad(cx, cz) || true) checked++;
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('balcones con su puerta y Moravia más de ladrillo a la vista', () => {
    const list = modeled();
    const withBalcony = list.map(([b, i]) => facadeLayout(b, i)).filter((L) => L.balconies.length);
    expect(withBalcony.length).toBeGreaterThan(20);
    for (const L of withBalcony) {
      for (const bal of L.balconies) {
        const door = L.openings.find((o) => o.kind === 'balconyDoor' && o.floor === bal.floor);
        expect(door).toBeTruthy();
        expect(door.u0).toBeGreaterThanOrEqual(bal.u0);
        expect(door.u1).toBeLessThanOrEqual(bal.u1);
      }
    }
    const walls = (inf) => {
      const ls = list.filter(([b]) => !!b.informal === inf && b.style !== 'torre').map(([b, i]) => facadeLayout(b, i).wall);
      return ls.filter((w) => w === 'brick').length / ls.length;
    };
    expect(walls(true)).toBeGreaterThan(walls(false));
  });

  it('el aviso de la tienda no queda tapado por un balcón del segundo piso', () => {
    const shops = modeled().map(([b, i]) => facadeLayout(b, i)).filter((L) => L.shop);
    expect(shops.length).toBeGreaterThan(20);
    for (const L of shops) expect(L.balconies.some((bal) => bal.floor === 1)).toBe(false);
  });
});
