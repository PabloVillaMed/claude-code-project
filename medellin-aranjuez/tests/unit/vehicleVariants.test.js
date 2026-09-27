import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VEHICLE_TYPES, createVehicleState, emptyDriveInput, stepVehicle, vehicleSpec } from '../../src/sim/vehiclePhysics.js';
import { VEHICLE_VARIANTS, engineProfile, pickVariant, randomPaint, variantsOf } from '../../src/sim/vehicleVariants.js';
import { makeRng } from '../../src/sim/rng.js';

const flat = { groundHeight: () => 0, collision: { query: () => [] } };

describe('variantes de vehículos', () => {
  it('cada variante tiene un tipo válido y su modelo en public/', () => {
    for (const [id, v] of Object.entries(VEHICLE_VARIANTS)) {
      expect(VEHICLE_TYPES[v.type], id).toBeTruthy();
      expect(fs.existsSync(path.resolve('public/models/vehiculos', `${v.model}.glb`)), `${id}: ${v.model}.glb`).toBe(true);
    }
    // Todos los tipos tienen al menos una variante (la del modelo original).
    for (const t of Object.keys(VEHICLE_TYPES)) expect(variantsOf(t).length, t).toBeGreaterThan(0);
    expect(variantsOf('moto').length).toBeGreaterThanOrEqual(5);
    expect(variantsOf('sedan').length + variantsOf('taxi').length + variantsOf('camioneta').length).toBeGreaterThanOrEqual(10);
  });

  it('la ficha de la variante cambia medidas y nombre sin tocar el tipo', () => {
    const s = vehicleSpec('moto', 'scooter');
    expect(s.length).toBeLessThan(VEHICLE_TYPES.moto.length);
    expect(s.maxSpeed).toBeLessThan(VEHICLE_TYPES.moto.maxSpeed);
    expect(s.twoWheels).toBe(true);
    expect(s.name).toBe('Scooter');
    expect(VEHICLE_TYPES.moto.name).toBe('Moto');
    // Variante de otro tipo o desconocida: la ficha del tipo.
    expect(vehicleSpec('taxi', 'scooter')).toBe(VEHICLE_TYPES.taxi);
    expect(vehicleSpec('taxi', 'nada')).toBe(VEHICLE_TYPES.taxi);
    const v = createVehicleState('sedan', 0, 0, 0, () => 0, 'clasico');
    expect(v.variant).toBe('clasico');
    expect(v.spec.length).toBeCloseTo(3.66);
  });

  it('todas las variantes arrancan y no pasan de su velocidad máxima', () => {
    for (const [id, vr] of Object.entries(VEHICLE_VARIANTS)) {
      const v = createVehicleState(vr.type, 0, 0, 0, () => 0, id);
      const input = { ...emptyDriveInput(), throttle: 1 };
      for (let i = 0; i < 60 * 30; i++) stepVehicle(v, input, 1 / 60, { ...flat, bounds: { minX: -1e5, maxX: 1e5, minZ: -1e5, maxZ: 1e5 } });
      expect(v.forwardSpeed, id).toBeGreaterThan(v.spec.maxSpeed * 0.75);
      expect(v.forwardSpeed, id).toBeLessThanOrEqual(v.spec.maxSpeed);
    }
  });

  it('la mezcla respeta los pesos: muchas motos de calle y scooters, pocas doble propósito', () => {
    const rng = makeRng(5);
    const n = {};
    for (let i = 0; i < 4000; i++) {
      const id = pickVariant('moto', rng.next);
      n[id] = (n[id] ?? 0) + 1;
    }
    expect(Object.keys(n).sort()).toEqual(variantsOf('moto').sort());
    expect(n.moto).toBeGreaterThan(n.moto_tt * 2);
    expect(n.scooter).toBeGreaterThan(n.moto_enduro);
    // Parqueados: el clásico aparece más que en el tráfico.
    const rate = (kind) => {
      const r = makeRng(9);
      let c = 0;
      for (let i = 0; i < 4000; i++) c += pickVariant('sedan', r.next, kind) === 'clasico';
      return c / 4000;
    };
    expect(rate('parked')).toBeGreaterThan(rate('traffic'));
  });

  it('perfiles de motor y colores', () => {
    expect(engineProfile('moto', 'moto_2t')).toBe('moto2t');
    expect(engineProfile('moto', 'scooter')).toBe('scooter');
    expect(engineProfile('buseta', null)).toBe('diesel');
    expect(engineProfile('taxi', 'taxi_pequeno')).toBe('carro_pequeno');
    const rng = makeRng(3);
    const colors = new Set(Array.from({ length: 300 }, () => randomPaint('sedan', rng.next)));
    expect(colors.size).toBeGreaterThan(5);
    // Blanco, el más común.
    let white = 0;
    for (let i = 0; i < 2000; i++) white += randomPaint('sedan', rng.next) === 0xf2f2f0;
    expect(white / 2000).toBeGreaterThan(0.15);
  });
});
