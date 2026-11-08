import { afterEach, describe, expect, it } from 'vitest';
import { MAX_UNITS } from '../../src/sim/wanted.js';
import { DISPATCH, PoliceDispatch } from '../../src/sim/policeAI.js';

// Unidades eliminadas (toda la tripulación muerta o el vehículo inservible):
// el despacho no las repone mientras las estrellas no suban.

/** Corre el despacho `secs` s al nivel `level`; agrega a `units` lo que despache. */
function run(d, level, units, secs) {
  let retired = 0;
  for (let t = 0; t < secs; t += 0.1) {
    const o = d.step(0.1, level, units);
    if (o === 'car' || o === 'moto') units.push({ kind: o });
    else if (o === 'retire') {
      units.pop();
      retired++;
    }
  }
  return retired;
}

describe('despacho: unidades eliminadas', () => {
  const saved = { ...DISPATCH };
  afterEach(() => Object.assign(DISPATCH, saved));

  it('una unidad eliminada no se repone al mismo nivel', () => {
    const d = new PoliceDispatch();
    const units = [];
    run(d, 2, units, 120);
    expect(units.length).toBe(MAX_UNITS[2]);
    // Matan a toda la tripulación de una: sale del caso y queda eliminada.
    units.pop();
    d.eliminated();
    run(d, 2, units, 300);
    expect(units.length).toBe(MAX_UNITS[2] - 1);
    // Y la otra también: no llega nadie más.
    units.pop();
    d.eliminated();
    run(d, 2, units, 300);
    expect(units.length).toBe(0);
  });

  it('una unidad que se fue sin caer (reciclada por lejos) sí se repone', () => {
    const d = new PoliceDispatch();
    const units = [];
    run(d, 2, units, 120);
    units.pop(); // (sin eliminated())
    run(d, 2, units, 60);
    expect(units.length).toBe(MAX_UNITS[2]);
  });

  it('al subir de nivel sí llegan refuerzos (hasta el tope del nivel nuevo)', () => {
    const d = new PoliceDispatch();
    const units = [];
    run(d, 2, units, 120);
    units.length = 0;
    d.eliminated();
    d.eliminated();
    run(d, 2, units, 120);
    expect(units.length).toBe(0);
    // Matar policías sube las estrellas: la radio vuelve a despachar.
    run(d, 3, units, 120);
    expect(units.length).toBe(MAX_UNITS[3]);
  });

  it('los cupos perdidos no hacen retirar a las unidades que siguen en el caso', () => {
    const d = new PoliceDispatch();
    const units = [];
    run(d, 3, units, 120);
    d.eliminated(); // (cayó otra que ya no está en la lista)
    expect(run(d, 3, units, 60)).toBe(0);
    expect(units.length).toBe(MAX_UNITS[3]);
  });

  it('con DISPATCH.replaceEliminated se reponen como antes', () => {
    DISPATCH.replaceEliminated = true;
    const d = new PoliceDispatch();
    const units = [];
    run(d, 2, units, 120);
    units.pop();
    d.eliminated();
    run(d, 2, units, 60);
    expect(units.length).toBe(MAX_UNITS[2]);
  });

  it('con DISPATCH.eliminatedCooldown se recupera un cupo al cabo de ese tiempo', () => {
    DISPATCH.eliminatedCooldown = 90;
    const d = new PoliceDispatch();
    const units = [];
    run(d, 2, units, 120);
    units.pop();
    d.eliminated();
    run(d, 2, units, 80);
    expect(units.length).toBe(MAX_UNITS[2] - 1);
    run(d, 2, units, 40);
    expect(units.length).toBe(MAX_UNITS[2]);
  });

  it('sin estrellas se olvidan los cupos perdidos', () => {
    const d = new PoliceDispatch();
    const units = [];
    run(d, 1, units, 60);
    units.pop();
    d.eliminated();
    run(d, 0, units, 1);
    run(d, 1, units, 60);
    expect(units.length).toBe(MAX_UNITS[1]);
  });
});
