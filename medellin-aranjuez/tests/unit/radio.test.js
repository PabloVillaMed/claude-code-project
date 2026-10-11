import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMISORAS, LICENCIAS_OK, rutaPista } from '../../src/game/radioStations.js';
import { APAGADA, enVivo, gananciaParlante, mover, objetivoDuck, ordenPistas, parlantesCercanos, pasoDuck, RADIO_PARLANTE, semillaDe } from '../../src/sim/radioDial.js';
import { parseCredits } from '../../src/ui/credits.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

describe('radio: dial de emisoras', () => {
  it('recorre las emisoras y la radio apagada en círculo, hacia los dos lados', () => {
    const n = 4;
    const seq = [0];
    for (let i = 0; i < 5; i++) seq.push(mover(seq.at(-1), n, 1));
    expect(seq).toEqual([0, 1, 2, 3, APAGADA, 0]);
    expect(mover(0, n, -1)).toBe(APAGADA);
    expect(mover(APAGADA, n, -1)).toBe(3);
    expect(mover(2, 0, 1)).toBe(APAGADA);
  });
});

describe('radio: programación en vivo', () => {
  it('el orden de las pistas es una permutación estable por emisora', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const o1 = ordenPistas(ids, semillaDe('perreo'));
    expect([...o1].sort()).toEqual(ids);
    expect(ordenPistas(ids, semillaDe('perreo'))).toEqual(o1);
  });

  it('ubica la pista y el segundo según el reloj, con pausa entre pistas y repitiendo', () => {
    const dur = [100, 50, 80];
    expect(enVivo(dur, 0)).toEqual({ i: 0, offset: 0 });
    expect(enVivo(dur, 99)).toEqual({ i: 0, offset: 99 });
    expect(enVivo(dur, 120)).toEqual({ i: 1, offset: 20 });
    expect(enVivo(dur, 230 + 10)).toEqual({ i: 0, offset: 10 }); // vuelta completa
    // Con pausa: 100 s de pista + 2 de silencio; en el silencio sigue "al final".
    expect(enVivo(dur, 101, 2)).toEqual({ i: 0, offset: 100 });
    expect(enVivo(dur, 103, 2)).toEqual({ i: 1, offset: 1 });
    expect(enVivo([], 50)).toEqual({ i: 0, offset: 0 });
  });
});

describe('radio: ducking bajo las voces', () => {
  it('baja la música cuando hablan y más en las cinemáticas', () => {
    expect(objetivoDuck({})).toBe(1);
    expect(objetivoDuck({ voz: true })).toBeLessThan(0.5);
    expect(objetivoDuck({ cinematica: true })).toBeLessThan(objetivoDuck({ voz: true }));
  });

  it('baja rápido y sube despacio, igual a cualquier framerate', () => {
    const correr = (from, to, seg, fps) => {
      let g = from;
      for (let i = 0; i < seg * fps; i++) g = pasoDuck(g, to, 1 / fps);
      return g;
    };
    // En 0,3 s ya bajó casi del todo; en 0,3 s de subida todavía no llega.
    expect(correr(1, 0.35, 0.3, 60)).toBeLessThan(0.45);
    expect(correr(0.35, 1, 0.3, 60)).toBeLessThan(0.7);
    expect(correr(0.35, 1, 4, 60)).toBeGreaterThan(0.98);
    expect(Math.abs(correr(1, 0.35, 0.5, 30) - correr(1, 0.35, 0.5, 144))).toBeLessThan(1e-6);
  });
});

describe('radio: parlantes de los locales', () => {
  it('se oyen solo de cerca, cada vez más bajito, y nada en el borde', () => {
    expect(gananciaParlante(2)).toBeGreaterThan(0.99);
    expect(gananciaParlante(10)).toBeLessThan(gananciaParlante(5));
    expect(gananciaParlante(RADIO_PARLANTE)).toBe(0);
    expect(gananciaParlante(RADIO_PARLANTE - 0.5)).toBeLessThan(0.02);
    expect(gananciaParlante(Infinity)).toBe(0);
  });

  it('suenan como máximo dos, los más cercanos', () => {
    const ps = [
      { id: 'lejos', x: 100, z: 0 },
      { id: 'b', x: 8, z: 0 },
      { id: 'a', x: 3, z: 0 },
      { id: 'c', x: 0, z: 15 },
    ];
    expect(parlantesCercanos(ps, 0, 0).map((o) => o.p.id)).toEqual(['a', 'b']);
    expect(parlantesCercanos(ps, 200, 0)).toEqual([]);
  });
});

describe('radio: emisoras, archivos y licencias', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/sounds/musica/manifest.json'), 'utf8'));
  const creditos = parseCredits().flatMap((s) => s.rows);
  const md = fs.readFileSync(path.join(ROOT, 'ASSETS-CREDITS.md'), 'utf8');

  it('3 a 5 emisoras con 4 a 8 pistas, ids únicos', () => {
    expect(EMISORAS.length).toBeGreaterThanOrEqual(3);
    expect(EMISORAS.length).toBeLessThanOrEqual(5);
    const ids = new Set();
    for (const e of EMISORAS) {
      expect(e.pistas.length).toBeGreaterThanOrEqual(4);
      expect(e.pistas.length).toBeLessThanOrEqual(8);
      for (const p of e.pistas) {
        expect(ids.has(p.id)).toBe(false);
        ids.add(p.id);
      }
    }
  });

  it('cada pista tiene licencia libre (sin NC ni ND), autor, página y está en los créditos', () => {
    for (const e of EMISORAS)
      for (const p of e.pistas) {
        expect(LICENCIAS_OK).toContain(p.licencia);
        expect(p.licencia).not.toMatch(/NC|ND/);
        expect(p.artista.length).toBeGreaterThan(1);
        expect(p.fuente).toMatch(/^https:\/\//);
        expect(p.licenciaUrl).toMatch(/^https:\/\/creativecommons\.org\/licenses\/by\//);
        const fila = creditos.find((r) => r.name.includes(`"${p.titulo}"`));
        expect(fila, p.titulo).toBeTruthy();
        expect(fila.license).toContain(p.licencia);
        expect(md).toContain(rutaPista(e, p));
      }
  });

  it('cada pista existe, está en el manifiesto con su duración y el total pesa menos de 40 MB', () => {
    let total = 0;
    for (const e of EMISORAS)
      for (const p of e.pistas) {
        const f = path.join(ROOT, 'public', rutaPista(e, p));
        expect(fs.existsSync(f), f).toBe(true);
        total += fs.statSync(f).size;
        expect(manifest.emisoras[e.id][p.id].dur).toBeGreaterThan(60);
      }
    expect(total).toBeLessThan(40 * 1024 * 1024);
  });
});
