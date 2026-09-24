import { describe, expect, it } from 'vitest';
import {
  CollisionWorld,
  circleVsAABB,
  circleVsObb,
  obbVsObb,
  rayVsAABB,
  rayVsSphere,
  rayVsVerticalCapsule,
  rayVsObb3D,
} from '../../src/sim/collision.js';
import { obbFromAxis } from '../../src/sim/collision.js';

describe('colisiones', () => {
  it('círculo contra caja: empuja fuera por la cara más cercana', () => {
    const b = { minX: 0, maxX: 10, minZ: 0, maxZ: 10 };
    const r = circleVsAABB(-0.2, 5, 0.5, b);
    expect(r.nx).toBeCloseTo(-1);
    expect(r.depth).toBeCloseTo(0.3);
    expect(circleVsAABB(-1, 5, 0.5, b)).toBeNull();
    const inside = circleVsAABB(9.5, 5, 0.5, b);
    expect(inside.nx).toBe(1);
    expect(inside.depth).toBeCloseTo(1);
  });

  it('resolveCircle separa de varias cajas (esquina)', () => {
    const w = new CollisionWorld(4);
    w.add({ minX: 0, maxX: 5, minZ: 0, maxZ: 5 });
    w.add({ minX: 5, maxX: 10, minZ: 0, maxZ: 5 });
    const r = w.resolveCircle(5, 4.9, 0.4);
    expect(r.hit).toBe(true);
    expect(r.z).toBeGreaterThanOrEqual(5.39);
  });

  it('respeta la altura: se puede pasar por encima de obstáculos bajos', () => {
    const w = new CollisionWorld(4);
    w.add({ minX: 0, maxX: 2, minZ: 0, maxZ: 2, minY: 0, maxY: 1 });
    expect(w.resolveCircle(1, 1, 0.3, 1.2, 3).hit).toBe(false);
    expect(w.resolveCircle(1, 1, 0.3, 0.2, 2).hit).toBe(true);
  });

  it('rayos contra AABB, esfera, cápsula y caja orientada', () => {
    const b = { minX: 5, maxX: 6, minY: 0, maxY: 3, minZ: -1, maxZ: 1 };
    const h = rayVsAABB(0, 1, 0, 1, 0, 0, b, 100);
    expect(h.t).toBeCloseTo(5);
    expect(h.nx).toBe(-1);
    expect(rayVsAABB(0, 5, 0, 1, 0, 0, b, 100)).toBeNull();
    expect(rayVsSphere(0, 0, 0, 0, 0, 1, 0, 0, 10, 1, 100)).toBeCloseTo(9);
    expect(rayVsVerticalCapsule(0, 1, 0, 1, 0, 0, 10, 0, 0.3, 1.5, 0.4, 100)).toBeCloseTo(9.6);
    expect(rayVsVerticalCapsule(0, 3, 0, 1, 0, 0, 10, 0, 0.3, 1.5, 0.4, 100)).toBeNull();
    const t = rayVsObb3D(0, 1, 0, 0, 0, -1, { x: 0, z: -10, hx: 1, hz: 2, angle: Math.PI / 2 }, 0, 2, 100);
    expect(t).toBeCloseTo(9); // girada 90°: el lado largo queda en X, el ancho (1) en Z
  });

  it('raycast del mundo encuentra la caja más cercana', () => {
    const w = new CollisionWorld(10);
    w.add({ minX: 30, maxX: 32, minZ: -2, maxZ: 2, minY: 0, maxY: 10 });
    w.add({ minX: 60, maxX: 62, minZ: -2, maxZ: 2, minY: 0, maxY: 10 });
    const hit = w.raycast(0, 1, 0, 1, 0, 0, 200);
    expect(hit.t).toBeCloseTo(30);
    expect(w.raycast(0, 1, 0, -1, 0, 0, 200)).toBeNull();
  });

  it('SAT entre cajas orientadas', () => {
    const a = { x: 0, z: 0, hx: 1, hz: 2, angle: 0 };
    expect(obbVsObb(a, { x: 3, z: 0, hx: 1, hz: 2, angle: 0 })).toBeNull();
    const r = obbVsObb(a, { x: 1.5, z: 0, hx: 1, hz: 2, angle: 0 });
    expect(r.depth).toBeCloseTo(0.5);
    expect(r.nx).toBeCloseTo(-1);
    const rot = obbVsObb(a, { x: 2.2, z: 0, hx: 1, hz: 2, angle: Math.PI / 2 });
    expect(rot).not.toBeNull();
  });

  it('círculo contra caja orientada', () => {
    const o = { x: 0, z: 0, hx: 1, hz: 2, angle: Math.PI / 2 };
    // Girada 90°: su largo (2) queda sobre X.
    expect(circleVsObb(2.2, 0, 0.3, o)).not.toBeNull();
    expect(circleVsObb(0, 1.5, 0.3, o)).toBeNull();
  });
});

describe('cajas giradas (casas que siguen el rumbo de su calle)', () => {
  const ang = 0.6;
  const world = () => {
    const w = new CollisionWorld(24);
    // Casa de 10 x 6 m girada ~34°: eje a lo ancho (cos, -sin) de ese ángulo.
    w.add({ obb: obbFromAxis(50, 40, Math.cos(ang), -Math.sin(ang), 5, 3), minY: 0, maxY: 9, kind: 'building' });
    return w;
  };

  it('el punto dentro de la casa está bloqueado y el de la esquina del AABB no', () => {
    const w = world();
    expect(w.pointBlocked(50, 40)).toBe(true);
    const b = w.boxes[0];
    // Esquina del rectángulo alineado que contiene a la casa: queda por fuera de la casa girada.
    expect(w.pointBlocked(b.minX + 0.2, b.minZ + 0.2)).toBe(false);
  });

  it('un círculo que choca de lado sale en la dirección de la normal de la pared', () => {
    const w = world();
    const ux = Math.cos(ang);
    const uz = -Math.sin(ang);
    // Frente a la cara "a lo ancho" (a 5 m del centro a lo largo de u), metido 0.3 m.
    const x = 50 + ux * (5 + 0.4 - 0.3);
    const z = 40 + uz * (5 + 0.4 - 0.3);
    const r = w.resolveCircle(x, z, 0.4);
    expect(r.hit).toBe(true);
    expect(r.nx * ux + r.nz * uz).toBeGreaterThan(0.99);
    expect(Math.hypot(r.x - 50, r.z - 40)).toBeCloseTo(5.4, 2);
  });

  it('las balas pegan en la pared girada y no en el hueco del AABB', () => {
    const w = world();
    const hit = w.raycast(0, 1.5, 40, 1, 0, 0, 200);
    expect(hit).toBeTruthy();
    // La pared en z = 40 está donde el rayo cruza la caja girada.
    expect(hit.t).toBeGreaterThan(40);
    expect(hit.t).toBeLessThan(50);
    const b = w.boxes[0];
    // Rayo corto que termina en la esquina vacía del AABB: no toca la casa.
    expect(w.raycast(b.minX - 1, 1.5, b.minZ + 0.2, 1, 0, 0, 1.5)).toBe(null);
  });
});
