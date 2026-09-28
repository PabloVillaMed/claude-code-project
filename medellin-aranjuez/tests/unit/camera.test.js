import { describe, expect, it } from 'vitest';
import { VEHICLE_VIEWS, vehicleCamera } from '../../src/game/cameraRig.js';

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
