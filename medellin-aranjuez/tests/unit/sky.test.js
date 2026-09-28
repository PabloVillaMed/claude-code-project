import { describe, expect, it } from 'vitest';
import { cloudCover, skyExposure, moonDirection, skyCoefficients, skyRadiance, sunDirection, sunMoved, sunlightColor, tileableCloudNoise, transmittance } from '../../src/sim/sky.js';

describe('sol y luna', () => {
  it('el sol sale por el oriente (+X) a las 6, está alto a mediodía y se pone al occidente', () => {
    expect(sunDirection(6).y).toBeCloseTo(0, 5);
    expect(sunDirection(8).x).toBeGreaterThan(0);
    expect(sunDirection(12).y).toBeGreaterThan(0.9);
    expect(sunDirection(17.75).x).toBeLessThan(0);
    expect(sunDirection(17.75).y).toBeGreaterThan(0);
    expect(sunDirection(20).y).toBeLessThan(0);
    const d = sunDirection(10);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 6);
  });

  it('luna llena: de noche está arriba (sale por la montaña), de día está bajo el horizonte', () => {
    expect(moonDirection(20).y).toBeGreaterThan(0.3);
    expect(moonDirection(20).x).toBeGreaterThan(0);
    expect(moonDirection(0).y).toBeGreaterThan(0.9);
    expect(moonDirection(12).y).toBeLessThan(0);
  });
});

describe('dispersión atmosférica', () => {
  const up = { x: 0, y: 1, z: 0 };
  it('de día el cenit es azul (más azul que rojo)', () => {
    const s = sunDirection(12);
    const c = skyRadiance(up, s, skyCoefficients(s));
    expect(c[2]).toBeGreaterThan(c[0]);
    expect(c[2]).toBeGreaterThan(0.05);
  });

  it('al atardecer el cielo hacia el sol es cálido y la luz del sol se enrojece', () => {
    const s = sunDirection(17.75);
    const co = skyCoefficients(s);
    const c = skyRadiance({ x: s.x, y: 0.08, z: s.z }, s, co);
    expect(c[0]).toBeGreaterThan(c[2]);
    const noon = sunlightColor(sunDirection(12), skyCoefficients(sunDirection(12)));
    const dusk = sunlightColor(s, co);
    expect(dusk[0] / dusk[2]).toBeGreaterThan((noon[0] / noon[2]) * 2);
  });

  it('de noche el cielo es casi negro y sin sol', () => {
    const s = sunDirection(21);
    const co = skyCoefficients(s);
    expect(co.sunE).toBe(0);
    const c = skyRadiance(up, s, co);
    expect(Math.max(...c)).toBeLessThan(0.01);
  });

  it('exposición propia del cielo: el mediodía queda azul (no blanco) y la hora azul se aclara', () => {
    const noon = sunDirection(12);
    const co = skyCoefficients(noon);
    const k = skyExposure(noon, co, 0.35);
    expect(k).toBeLessThan(0.2);
    const z = skyRadiance({ x: 0, y: 1, z: 0 }, noon, co).map((v) => v * k);
    expect(0.2126 * z[0] + 0.7152 * z[1] + 0.0722 * z[2]).toBeCloseTo(0.35, 2);
    expect(z[2]).toBeGreaterThan(z[0] * 2);
    const dusk = sunDirection(18.1);
    expect(skyExposure(dusk, skyCoefficients(dusk), 0.35)).toBeGreaterThan(1);
  });

  it('crepúsculo: con el sol recién puesto el cielo todavía tiene luz', () => {
    const s = sunDirection(18.15);
    expect(s.y).toBeLessThan(0);
    const c = skyRadiance({ x: s.x, y: 0.05, z: s.z }, s, skyCoefficients(s));
    expect(Math.max(...c)).toBeGreaterThan(0.005);
    expect(c[0]).toBeGreaterThan(c[2]);
  });

  it('la transmitancia está entre 0 y 1 y baja hacia el horizonte', () => {
    const co = skyCoefficients(sunDirection(12));
    const z = transmittance(up, co);
    const h = transmittance({ x: 1, y: 0.02, z: 0 }, co);
    for (let i = 0; i < 3; i++) {
      expect(z[i]).toBeLessThanOrEqual(1);
      expect(h[i]).toBeGreaterThan(0);
      expect(h[i]).toBeLessThan(z[i]);
    }
  });
});

describe('nubes', () => {
  it('mañana despejada, tarde más nublada, noche abriéndose', () => {
    expect(cloudCover(8)).toBeLessThan(cloudCover(15.5));
    expect(cloudCover(15.5)).toBeGreaterThan(0.5);
    expect(cloudCover(23.5)).toBeLessThan(cloudCover(15.5));
    expect(cloudCover(15.5, 1)).toBeGreaterThan(cloudCover(15.5, 0));
    for (let h = 0; h < 24; h += 0.5) {
      expect(cloudCover(h)).toBeGreaterThanOrEqual(0.05);
      expect(cloudCover(h)).toBeLessThanOrEqual(0.85);
    }
    expect(cloudCover(-1)).toBeCloseTo(cloudCover(23));
  });

  it('el ruido de las nubes se repite sin costuras y usa todo el rango', () => {
    const n = 64;
    const t = tileableCloudNoise(n, 3);
    expect(t.length).toBe(n * n * 4);
    // Diferencia entre columnas vecinas: el salto del borde (última → primera) es como cualquier otro.
    const at = (x, y, c) => t[(y * n + x) * 4 + c];
    let edge = 0;
    let inner = 0;
    for (let y = 0; y < n; y++) {
      edge += Math.abs(at(n - 1, y, 0) - at(0, y, 0));
      inner += Math.abs(at(n / 2, y, 0) - at(n / 2 + 1, y, 0));
    }
    expect(edge).toBeLessThan(inner * 3 + n * 2);
    let min = 255;
    let max = 0;
    for (let i = 0; i < t.length; i += 4) {
      min = Math.min(min, t[i]);
      max = Math.max(max, t[i]);
    }
    expect(max - min).toBeGreaterThan(150);
    // Misma semilla, mismo cielo.
    expect(tileableCloudNoise(16, 5)).toEqual(tileableCloudNoise(16, 5));
  });

  it('solo se vuelve a hornear el cielo cuando el sol se mueve de verdad', () => {
    const a = sunDirection(10);
    expect(sunMoved(null, a)).toBe(true);
    expect(sunMoved(a, sunDirection(10.005))).toBe(false); // ~0,08°
    expect(sunMoved(a, sunDirection(10.1))).toBe(true); // 1,5°
  });
});
