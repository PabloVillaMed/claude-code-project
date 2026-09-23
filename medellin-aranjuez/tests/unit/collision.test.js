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
