// La rumba de la 92 (sim/nightlife.js): locales, hora, cupo por calidad,
// puestos de la gente frente a cada local, parejas, pinta de salir y murmullo.
import { describe, expect, it } from 'vitest';
import { city } from './helpers.js';
import { GRID, MAPA, onRoad, roadAt } from '../../src/sim/terrain.js';
import { LOCALES, SIGN_NAMES } from '../../src/sim/facades.js';
import { ROPA_BY_ID, ROPA_STORES, storeCatalog } from '../../src/sim/ropa.js';
import { makeRng } from '../../src/sim/rng.js';
import {
  BASE_POR_LOCAL,
  FILA_MAX,
  PINTA_PORTERO,
  RUMBA_FUENTES,
  cupoRumba,
  discotecasDe,
  filtroRumba,
  fuentesRumba,
  gananciaRumba,
  murmullo,
  nivelMusica,
  nivelRumba,
  parejasRumba,
  paseoPareja,
  pintaRumba,
  puestosLocal,
  repartir,
  tipoLocal,
} from '../../src/sim/nightlife.js';

describe('rumba de la 92: hora y cupo', () => {
  it('de día cerrado, de noche lleno, sube y baja sin saltos', () => {
    expect(nivelRumba(12)).toBe(0);
    expect(nivelRumba(8)).toBe(0);
    expect(nivelRumba(23)).toBe(1);
    expect(nivelRumba(0.5)).toBe(1);
    expect(nivelRumba(20)).toBeGreaterThan(0.3);
    expect(nivelRumba(20)).toBeLessThan(1);
    expect(nivelRumba(2.5)).toBeGreaterThan(0.4);
    expect(nivelRumba(4)).toBe(0);
    expect(nivelRumba(24 + 23)).toBe(nivelRumba(23));
    let prev = nivelRumba(0);
    for (let h = 0.05; h < 24; h += 0.05) {
      const v = nivelRumba(h);
      expect(Math.abs(v - prev)).toBeLessThan(0.1);
      prev = v;
    }
  });

  it('los bares y la fonda suenan bajito de día; las discotecas no', () => {
    expect(nivelMusica('bar', 14)).toBeGreaterThan(0);
    expect(nivelMusica('bar', 14)).toBeLessThan(0.2);
    expect(nivelMusica('fonda', 15)).toBeGreaterThan(0);
    expect(nivelMusica('discoteca', 14)).toBe(0);
    expect(nivelMusica('salsoteca', 23)).toBe(1);
    expect(nivelMusica('bar', 8)).toBe(0);
  });

  it('más gente con más calidad; de día nadie', () => {
    const peds = [24, 34, 44, 56];
    const night = peds.map((p) => cupoRumba(p, 1));
    for (let i = 1; i < night.length; i++) expect(night[i]).toBeGreaterThan(night[i - 1]);
    expect(night[0]).toBeGreaterThanOrEqual(6);
    for (const p of peds) {
      expect(cupoRumba(p, nivelRumba(13))).toBe(0);
      expect(parejasRumba(p, nivelRumba(13))).toBe(0);
      expect(parejasRumba(p, 1)).toBeGreaterThanOrEqual(1);
    }
    expect(cupoRumba(44, 0.5)).toBeLessThan(cupoRumba(44, 1));
  });
});

describe('rumba de la 92: los locales', () => {
  const c = city();
  const locales = discotecasDe(c);

  it('6 a 8 discotecas, salsotecas, bares y una fonda, todos en la Calle 92', () => {
    expect(locales.length).toBeGreaterThanOrEqual(6);
    expect(locales.length).toBeLessThanOrEqual(8);
    const tipos = new Set(locales.map((d) => d.tipo));
    for (const t of ['discoteca', 'salsoteca', 'bar', 'fonda']) expect(tipos.has(t), t).toBe(true);
    for (const d of locales) {
      const b = c.buildings.find((q) => q.local?.name === d.name);
      expect(b.local.kind).toBe('discoteca');
      expect(b.style).toBe('tienda');
      expect(LOCALES.find(([n]) => n === d.name)?.[1]).toBe('discoteca');
      expect(SIGN_NAMES.some(([n]) => n === d.name)).toBe(true);
      expect(['perreo', 'sabrosa', 'parce']).toContain(d.musica);
      // Da a la 92.
      const r = roadAt(d.fx + d.nx * (GRID.sidewalk + 1.5), d.fz + d.nz * (GRID.sidewalk + 1.5), 1);
      expect(r, d.name).toBeTruthy();
      expect(MAPA.edges[r.edge].name, d.name).toBe('Calle 92');
      // La puerta (el lugar) queda frente a la fachada.
      expect(Math.hypot(d.x - d.fx, d.z - d.fz)).toBeLessThan(6);
    }
    // Repartidos a lo largo de la calle (no todos en la misma cuadra).
    const xs = locales.map((d) => d.fx).sort((a, b) => a - b);
    expect(xs[xs.length - 1] - xs[0]).toBeGreaterThan(300);
    expect(tipoLocal('Fonda La Ruana')).toBe('fonda');
  });

  it('cada local tiene portero primero, fila y grupos en el andén (no en la calle ni dentro de un poste)', () => {
    const blocked = (x, z) => c.collision.pointBlocked(x, z);
    for (const d of locales) {
      const ps = puestosLocal(d, blocked);
      expect(ps[0].rol).toBe('portero');
      expect(ps.filter((p) => p.rol === 'portero').length).toBe(1);
      expect(ps.filter((p) => p.rol === 'fila').length).toBeLessThanOrEqual(FILA_MAX);
      expect(ps.filter((p) => p.rol === 'grupo').length).toBeGreaterThanOrEqual(3);
      for (const p of ps) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.yaw)).toBe(true);
        expect(onRoad(p.x, p.z), `${d.name} ${p.rol}`).toBe(false);
        expect(blocked(p.x, p.z), `${d.name} ${p.rol}`).toBe(false);
        expect(Math.hypot(p.x - d.fx, p.z - d.fz)).toBeLessThan(10);
      }
      // Nadie encima de nadie.
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) expect(Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z)).toBeGreaterThan(0.35);
      // Determinista.
      expect(puestosLocal(d, blocked)).toEqual(ps);
    }
  });

  it('el cupo se reparte: todos los cercanos con portero y un grupo, el resto al más cercano', () => {
    const tam = (d) => puestosLocal(d).length;
    const d0 = locales[0];
    const m = repartir(locales, d0.x, d0.z, 120, 10, tam);
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(10);
    expect(m.get(d0.id)).toBeGreaterThan(BASE_POR_LOCAL);
    for (const [id, n] of m) if (id !== d0.id) expect(n).toBeLessThanOrEqual(BASE_POR_LOCAL);
    // Lejos de todo: nadie.
    expect(repartir(locales, 5000, 5000, 120, 10, tam).size).toBe(0);
    // Cupo de sobra: cada local lleno, nunca más que sus puestos.
    for (const [id, n] of repartir(locales, d0.x, d0.z, 400, 999, tam)) expect(n).toBe(tam(locales.find((d) => d.id === id)));
  });

  it('las parejas caminan de una puerta a otra por el mismo andén', () => {
    const rng = makeRng(3);
    for (const d of locales) {
      const r = paseoPareja(locales, d, rng);
      if (!r) continue;
      const len = Math.hypot(r.to.x - r.from.x, r.to.z - r.from.z);
      expect(len).toBeGreaterThan(5);
      expect(len).toBeLessThan(150);
      expect(onRoad(r.from.x, r.from.z)).toBe(false);
    }
  });
});

describe('rumba de la 92: la música de los locales', () => {
  const locales = discotecasDe(city());
  it('de noche suenan los más cercanos (con tope); de día solo los bares, bajito', () => {
    const d0 = locales[0];
    const noche = fuentesRumba(locales, d0.x, d0.z, 23);
    expect(noche.length).toBeGreaterThan(0);
    expect(noche.length).toBeLessThanOrEqual(RUMBA_FUENTES);
    expect(noche[0].p).toBe(d0);
    for (let i = 1; i < noche.length; i++) expect(noche[i].d).toBeGreaterThanOrEqual(noche[i - 1].d);
    for (const o of fuentesRumba(locales, d0.x, d0.z, 14, 8, 1000)) {
      expect(['bar', 'fonda']).toContain(o.p.tipo);
      expect(o.nivel).toBeLessThan(0.2);
    }
    expect(fuentesRumba(locales, d0.x, d0.z, 8, 8, 1000).length).toBe(0);
    expect(fuentesRumba(locales, 5000, 5000, 23).length).toBe(0);
  });
  it('más duro y más claro en la puerta; de lejos solo el bajo y luego nada', () => {
    expect(gananciaRumba(2)).toBeCloseTo(gananciaRumba(4), 1);
    expect(gananciaRumba(3)).toBeGreaterThan(gananciaRumba(20));
    expect(gananciaRumba(1000)).toBe(0);
    expect(filtroRumba(1)).toBeGreaterThan(3500);
    expect(filtroRumba(15)).toBeLessThan(filtroRumba(5));
    expect(filtroRumba(60)).toBeLessThan(700);
  });
});

describe('rumba de la 92: pinta de salir', () => {
  it('prendas que existen, cada una en su parte; vestido con blusa del mismo color', () => {
    const rng = makeRng(11);
    let vestidos = 0;
    for (let i = 0; i < 300; i++) {
      const f = i % 2 === 0;
      const o = pintaRumba(rng, f);
      for (const [slot, id] of Object.entries(o)) {
        expect(ROPA_BY_ID[id], id).toBeTruthy();
        expect(ROPA_BY_ID[id].slot).toBe(slot);
      }
      expect(o.torso && o.piernas && o.pies).toBeTruthy();
      if (ROPA_BY_ID[o.piernas].type === 'vestido') {
        vestidos++;
        expect(f).toBe(true);
        expect(ROPA_BY_ID[o.torso].color).toBe(ROPA_BY_ID[o.piernas].color);
      }
    }
    expect(vestidos).toBeGreaterThan(40);
    for (const [slot, id] of Object.entries(PINTA_PORTERO)) expect(ROPA_BY_ID[id].slot).toBe(slot);
    expect(ROPA_BY_ID[PINTA_PORTERO.torso].color).toBeLessThan(0x202020);
  });

  it('la ropa de rumba no se vende en los almacenes', () => {
    const rumba = Object.values(ROPA_BY_ID).filter((r) => /fiesta|blusa|vestido|portero|jean-oscuro/.test(r.id));
    expect(rumba.length).toBeGreaterThan(20);
    for (const r of rumba) expect(r.hidden, r.id).toBe(true);
    for (const s of Object.keys(ROPA_STORES)) for (const it of storeCatalog(s)) expect(it.hidden, it.id).toBeFalsy();
  });
});

describe('rumba de la 92: murmullo', () => {
  it('suena (no es silencio), no satura y da la vuelta sin salto', () => {
    const sr = 22050;
    const a = murmullo(sr, 2);
    expect(a.length).toBe(sr * 2);
    let peak = 0;
    let rms = 0;
    for (const v of a) {
      peak = Math.max(peak, Math.abs(v));
      rms += v * v;
    }
    rms = Math.sqrt(rms / a.length);
    expect(peak).toBeLessThanOrEqual(0.9001);
    expect(rms).toBeGreaterThan(0.05);
    expect(Math.abs(a[a.length - 1] - a[0])).toBeLessThan(0.3);
    expect(murmullo(sr, 2)).toEqual(a);
  });
});
