// Sonidos sintetizados del salón (sim/salon.js): la reverberación según el
// tamaño del local, gritos y aplausos sin valores raros y deterministas.
import { describe, expect, it } from 'vitest';
import { city } from './helpers.js';
import { RECINTO, aplausos, grito, medidaSalon, respuestaSalon } from '../../src/sim/salon.js';

const C = city();
const byId = (id) => C.interiors.find((r) => r.id === id);
const SR = 22050;
const energia = (x, a, b) => {
  let e = 0;
  for (let i = Math.floor(a * x.length); i < Math.floor(b * x.length); i++) e += x[i] * x[i];
  return e;
};
const finito = (x) => x.every((v) => Number.isFinite(v));

describe('sonido del salón', () => {
  it('los locales grandes reverberan más que los bares, dentro de los topes', () => {
    const grande = medidaSalon(byId('flow92'));
    const bar = medidaSalon(byId('elguaro'));
    expect(grande.rt60).toBeGreaterThan(bar.rt60);
    for (const r of C.interiors) {
      const m = medidaSalon(r);
      expect(m.rt60).toBeGreaterThanOrEqual(RECINTO.MIN);
      expect(m.rt60).toBeLessThanOrEqual(RECINTO.MAX);
      expect(m.pre).toBeGreaterThan(0);
      expect(m.pre).toBeLessThan(0.05);
    }
  });

  it('la respuesta del recinto decae, es estéreo, finita y determinista', () => {
    const m = medidaSalon(byId('laclave'));
    const [L, R] = respuestaSalon(SR, { ...m, semilla: 3 });
    expect(L.length).toBe(R.length);
    expect(L.length).toBeLessThanOrEqual(SR * 2.5);
    expect(finito(L) && finito(R)).toBe(true);
    expect(energia(L, 0.75, 1)).toBeLessThan(energia(L, 0, 0.25) * 0.05);
    expect(L.some((v, i) => v !== R[i])).toBe(true);
    const [L2] = respuestaSalon(SR, { ...m, semilla: 3 });
    expect(L2).toEqual(L);
  });

  it('gritos y aplausos: cortos, con pico acotado y deterministas', () => {
    for (let s = 1; s < 6; s++) {
      const g = grito(SR, { semilla: s, mujer: s % 2 === 0 });
      expect(g.length).toBeGreaterThan(SR * 0.3);
      expect(g.length).toBeLessThan(SR * 0.8);
      expect(finito(g)).toBe(true);
      expect(Math.max(...g.map(Math.abs))).toBeLessThanOrEqual(0.9001);
      expect(grito(SR, { semilla: s, mujer: s % 2 === 0 })).toEqual(g);
    }
    const a = aplausos(SR, 2, 8, 4);
    expect(a.length).toBe(SR * 2);
    expect(finito(a)).toBe(true);
    expect(Math.max(...a.map(Math.abs))).toBeLessThanOrEqual(0.9001);
    // Hay palmadas a lo largo de todo el bucle (sin huecos largos).
    for (let k = 0; k < 8; k++) expect(energia(a, k / 8, (k + 1) / 8)).toBeGreaterThan(0.5);
  });
});
