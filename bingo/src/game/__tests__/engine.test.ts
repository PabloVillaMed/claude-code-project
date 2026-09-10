import { describe, it, expect } from 'vitest';
import { ballsDrawnAt, TOTAL_BALLS } from '../engine';

describe('ballsDrawnAt: revelación por reloj', () => {
  const t0 = 1_000_000;
  const iv = 3000;

  it('no revela nada antes de empezar', () => {
    expect(ballsDrawnAt(t0, t0 - 1, iv)).toBe(0);
  });

  it('revela la primera bola justo al arrancar', () => {
    expect(ballsDrawnAt(t0, t0, iv)).toBe(1);
  });

  it('revela una bola más por intervalo, no antes', () => {
    expect(ballsDrawnAt(t0, t0 + iv - 1, iv)).toBe(1);
    expect(ballsDrawnAt(t0, t0 + iv, iv)).toBe(2);
    expect(ballsDrawnAt(t0, t0 + iv * 9, iv)).toBe(10);
  });

  it('se detiene en 90 por mucho que pase el tiempo', () => {
    expect(ballsDrawnAt(t0, t0 + iv * 10_000, iv)).toBe(TOTAL_BALLS);
  });
});
