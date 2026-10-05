import { describe, expect, it } from 'vitest';
import { CHAIR, solveSeat } from '../../src/sim/seatFit.js';

// Cuerpo sentado simplificado (marco de la silla, escala 1): asentaderas y
// muslos, espalda, y pantorrillas que bajan desde la rodilla.
function body({ bottom = 0.37, backZ = -0.12, calfZ = 0.34, kneeY = 0.44 } = {}) {
  const pts = [];
  for (let z = -0.15; z <= 0.3; z += 0.03) for (const x of [-0.1, 0, 0.1]) pts.push(x, bottom + Math.max(0, z) * 0.05, z);
  for (let y = 0.48; y <= 1.05; y += 0.03) for (const x of [-0.08, 0, 0.08]) pts.push(x, y, backZ);
  for (let y = 0.08; y <= kneeY; y += 0.03) for (const x of [-0.1, 0.1]) pts.push(x, y, calfZ);
  return { pts: Float32Array.from(pts), pelvisY: bottom + 0.19, kneeY };
}

// Lo que atraviesa la silla después del acomodo (debería ser nada).
function clipping(fit, { dy, dz }) {
  const bad = [];
  for (let i = 0; i < fit.pts.length; i += 3) {
    const x = Math.abs(fit.pts[i]);
    const y = fit.pts[i + 1] + dy;
    const z = fit.pts[i + 2] + dz;
    if (x > 0.2) continue;
    const overSeat = z > CHAIR.back(CHAIR.seat) + 0.03 && z < CHAIR.front - 0.02;
    if (overSeat && y < CHAIR.seat - 0.02 && y > CHAIR.seat - 0.08) bad.push(['asiento', y, z]);
    if (y > CHAIR.seat + 0.03 && y < CHAIR.backTop && z < CHAIR.back(y) - 0.002) bad.push(['espaldar', y, z]);
  }
  return bad;
}

describe('silla plástica: acomodo de quien se sienta', () => {
  it('sube el cuerpo hasta que las asentaderas quedan sobre el asiento', () => {
    const fit = body({ bottom: 0.37 });
    const r = solveSeat(fit, 1);
    expect(r.dy).toBeGreaterThan(0.05);
    expect(0.37 + r.dy).toBeCloseTo(CHAIR.seat - 0.012, 2);
    expect(clipping(fit, r)).toEqual([]);
  });

  it('si la espalda pasaría el espaldar, corre el cuerpo hacia delante', () => {
    const fit = body({ backZ: -0.3 });
    const r = solveSeat(fit, 1);
    expect(r.dz).toBeGreaterThan(0.05);
    expect(clipping(fit, r)).toEqual([]);
  });

  it('con espacio, se recuesta al espaldar sin que las pantorrillas crucen el borde', () => {
    const fit = body({ backZ: -0.1, calfZ: 0.36 });
    const r = solveSeat(fit, 1);
    expect(r.dz).toBeLessThan(0);
    expect(0.36 + r.dz).toBeGreaterThanOrEqual(CHAIR.front + 0.009);
    expect(clipping(fit, r)).toEqual([]);
  });

  it('escala: una persona más grande sube menos (sus asentaderas ya están más arriba)', () => {
    const fit = body();
    expect(solveSeat(fit, 1.05).dy).toBeLessThan(solveSeat(fit, 0.95).dy);
  });
});
