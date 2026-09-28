import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraRig, VEHICLE_VIEWS, footCamera, footViews, smoothingFactor, vehicleCamera } from '../../src/game/cameraRig.js';
import { groundHeight } from '../../src/sim/terrain.js';

describe('cámara de vehículo', () => {
  it('la vista por defecto va más cerca que la lejana (antes era la única)', () => {
    expect(VEHICLE_VIEWS[0]).toBe('cerca');
    const s = 4.2; // carro
    const cerca = vehicleCamera('cerca', s, 0, false);
    const lejos = vehicleCamera('lejos', s, 0, false);
    expect(cerca.dist).toBeLessThan(lejos.dist * 0.75);
    expect(cerca.dist).toBeLessThan(7);
    expect(cerca.height).toBeLessThan(lejos.height);
  });

  it('se aleja un poco con la velocidad, con tope', () => {
    const a = vehicleCamera('cerca', 4.2, 0, false).dist;
    const b = vehicleCamera('cerca', 4.2, 30, false).dist;
    const c = vehicleCamera('cerca', 4.2, 200, false).dist;
    expect(b).toBeGreaterThan(a);
    expect(c / a).toBeLessThanOrEqual(1.18 + 1e-9);
  });

  it('capó en carro va adelante y encima; en moto es sobre el hombro', () => {
    const car = vehicleCamera('capo', 4.2, 10, false);
    expect(car.hood).toBe(true);
    expect(car.ahead).toBeGreaterThan(0.5);
    const moto = vehicleCamera('capo', 2, 10, true);
    expect(moto.hood).toBeFalsy();
    expect(moto.dist).toBeLessThan(2.5);
  });
});

describe('cámara a pie', () => {
  it('la primera persona solo aparece en V si se activa', () => {
    expect(footViews(false)).not.toContain('primera');
    expect(footViews(true)).toContain('primera');
    expect(footViews(true).slice(0, 3)).toEqual(footViews(false));
  });

  it('el hombro cambia de lado; al apuntar se acerca y cierra el campo de visión', () => {
    const r = footCamera('normal', { side: 1 });
    const l = footCamera('normal', { side: -1 });
    expect(r.shoulder).toBeGreaterThan(0);
    expect(l.shoulder).toBeCloseTo(-r.shoulder);
    const aim = footCamera('lejos', { aiming: true, side: -1 });
    expect(aim.dist).toBeLessThan(r.dist);
    expect(aim.shoulder).toBeLessThan(l.shoulder);
    expect(aim.fovAdd).toBeLessThan(0);
    expect(footCamera('lejos').dist).toBeGreaterThan(footCamera('cerca').dist);
  });

  it('primera persona: a la altura de los ojos, más baja agachado', () => {
    const fp = footCamera('primera');
    expect(fp.first).toBe(true);
    expect(fp.dist).toBe(0);
    expect(footCamera('primera', { crouching: true }).height).toBeLessThan(fp.height);
  });

  it('suavizado: 0,5 es el de siempre, 0 más rígido, 1 más suave', () => {
    expect(smoothingFactor(0.5)).toBeCloseTo(1);
    expect(smoothingFactor(0)).toBeGreaterThan(2);
    expect(smoothingFactor(1)).toBeLessThan(0.5);
    expect(smoothingFactor(undefined)).toBeCloseTo(1);
    expect(smoothingFactor(9)).toBeCloseTo(smoothingFactor(1));
  });
});

describe('CameraRig', () => {
  // Una pared en x = 2 y el resto libre.
  const wall = {
    raycast(ox, oy, oz, dx, dy, dz, max) {
      if (dx <= 0) return null;
      const t = (2 - ox) / dx;
      return t >= 0 && t <= max ? { t } : null;
    },
  };
  const none = { raycast: () => null };
  const ctx = (o = {}) => {
    const x = o.x ?? 0;
    return { x, y: groundHeight(x, 0), z: 0, inVehicle: false, aiming: false, sprinting: false, lookX: 0, lookY: 0, ...o };
  };
  const run = (rig, c, n = 90) => {
    for (let i = 0; i < n; i++) rig.update(1 / 60, c);
    return rig.pos;
  };

  it('X cambia de hombro: la cámara pasa al otro lado del personaje', () => {
    const rig = new CameraRig(new THREE.PerspectiveCamera(), none);
    rig.yaw = 0; // mirando a -Z: la derecha es +X
    const a = run(rig, ctx()).x;
    rig.swapShoulder();
    const b = run(rig, ctx()).x;
    expect(a).toBeGreaterThan(0.1);
    expect(b).toBeLessThan(-0.1);
  });

  it('la colisión sigue funcionando: una pared detrás acerca la cámara', () => {
    const rig = new CameraRig(new THREE.PerspectiveCamera(), wall);
    rig.yaw = Math.PI / 2; // mirando a -X: la cámara queda hacia +X, donde está la pared
    const p = run(rig, ctx());
    expect(p.x).toBeLessThan(2);
    const free = run(new CameraRig(new THREE.PerspectiveCamera(), none), ctx());
    expect(Math.hypot(free.x, free.z)).toBeGreaterThan(3);
  });

  it('primera persona: en los ojos, sin atravesar la pared de enfrente', () => {
    const rig = new CameraRig(new THREE.PerspectiveCamera(), wall);
    rig.setFirstPerson(true);
    while (rig.footViewName !== 'primera') rig.cycleZoom();
    expect(rig.firstPerson).toBe(true);
    rig.yaw = -Math.PI / 2; // mirando a +X, hacia la pared a 2 m
    const c = ctx({ x: 1.85 });
    const p = run(rig, c);
    expect(p.y - c.y).toBeCloseTo(1.62, 1);
    expect(p.x).toBeLessThan(2);
    expect(p.x).toBeGreaterThanOrEqual(1.85 - 1e-6);
    rig.setFirstPerson(false);
    expect(rig.footViewName).toBe('normal');
  });

  it('vista de vehículo por defecto desde la configuración', () => {
    const rig = new CameraRig(new THREE.PerspectiveCamera(), none);
    rig.setVehicleView('capo');
    expect(rig.vehicleViewName).toBe('capo');
    rig.setVehicleView('inexistente');
    expect(rig.vehicleViewName).toBe('capo');
  });
});
