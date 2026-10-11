import { describe, expect, it } from 'vitest';
import { MissionSystem, createMissionDefs } from '../../src/sim/missions.js';
import { WantedSystem } from '../../src/sim/wanted.js';
import { city } from './helpers.js';

const types = (evs) => evs.map((e) => e.type);

describe('misiones', () => {
  it('cada misión la ofrece un punto de interés existente', () => {
    const c = city();
    const defs = createMissionDefs(c);
    for (const d of Object.values(defs)) expect(c.pois.some((p) => p.id === d.giver)).toBe(true);
  });

  it('domicilio: recoger, entregar y cobrar', () => {
    const c = city();
    const ms = new MissionSystem(createMissionDefs(c));
    expect(ms.available('parque').id).toBe('domicilio');
    expect(types(ms.start('domicilio'))).toContain('objective');
    const museo = c.pois.find((p) => p.id === 'museo');
    const metro = c.pois.find((p) => p.id === 'metro');
    expect(ms.update(1, { x: 0, z: 0 })).toEqual([]);
    expect(types(ms.update(1, { x: museo.x, z: museo.z }))).toEqual(['stageComplete', 'objective']);
    const done = ms.update(1, { x: metro.x, z: metro.z });
    expect(types(done)).toContain('complete');
    expect(done.find((e) => e.type === 'complete').reward).toBe(900);
    expect(ms.completed.has('domicilio')).toBe(true);
    expect(ms.active).toBeNull();
  });

  it('domicilio: falla si se acaba el tiempo de entrega', () => {
    const c = city();
    const ms = new MissionSystem(createMissionDefs(c));
    ms.start('domicilio');
    const museo = c.pois.find((p) => p.id === 'museo');
    ms.update(1, { x: museo.x, z: museo.z });
    const evs = ms.update(151, { x: 0, z: 0 });
    expect(types(evs)).toEqual(['fail']);
  });

  it('carrera: los checkpoints solo cuentan en vehículo', () => {
    const c = city();
    const defs = createMissionDefs(c);
    const ms = new MissionSystem(defs);
    const evs = ms.start('carrera');
    expect(evs.find((e) => e.type === 'spawnVehicle').vehicle).toBe('moto');
    const cp = defs.carrera.stages[0].target;
    expect(ms.update(0.1, { x: cp.x, z: cp.z, inVehicle: false })).toEqual([]);
    for (const st of defs.carrera.stages) ms.update(0.1, { x: st.target.x, z: st.target.z, inVehicle: true });
    expect(ms.completed.has('carrera')).toBe(true);
  });

  it('parche: termina al eliminar a todos y falla si mueres', () => {
    const c = city();
    const ms = new MissionSystem(createMissionDefs(c));
    const ev = ms.start('parche');
    expect(ev.find((e) => e.type === 'spawnGang').count).toBe(5);
    const cem = c.pois.find((p) => p.id === 'moravia');
    ms.update(0.1, { x: cem.x, z: cem.z, gangAlive: 5 });
    expect(ms.update(0.1, { x: cem.x, z: cem.z, gangAlive: 2 })).toEqual([]);
    expect(types(ms.update(0.1, { x: cem.x, z: cem.z, gangAlive: 0 }))).toContain('complete');
    ms.start('parche');
    expect(types(ms.update(0.1, { x: 0, z: 0, dead: true }))).toEqual(['fail']);
  });

  it('no se puede iniciar otra misión con una activa', () => {
    const ms = new MissionSystem(createMissionDefs(city()));
    ms.start('domicilio');
    expect(ms.start('carrera')).toEqual([]);
    expect(ms.available('taller')).toBeNull();
  });
});

describe('nivel de búsqueda', () => {
  it('sube con los delitos y tiene tope de 5 estrellas', () => {
    const w = new WantedSystem();
    w.report('shotsFired');
    expect(w.level).toBe(1);
    w.report('murder');
    expect(w.level).toBe(2);
    w.report('murder');
    expect(w.level).toBe(3);
    w.report('copAssault');
    expect(w.level).toBe(3);
    for (let i = 0; i < 5; i++) w.report('copKill');
    expect(w.level).toBe(5);
  });

  it('baja si la policía no te ve y no baja si te ve', () => {
    const w = new WantedSystem();
    w.report('murder');
    for (let t = 0; t < 60; t += 0.1) w.update(0.1, true);
    expect(w.level).toBe(2);
    for (let t = 0; t < w.cooldownFor(2) + 0.2; t += 0.1) w.update(0.1, false);
    expect(w.level).toBe(1);
    for (let t = 0; t < w.cooldownFor(1) + 0.2; t += 0.1) w.update(0.1, false);
    expect(w.level).toBe(0);
    expect(w.desiredUnits()).toBe(0);
  });
});

describe('locales típicos y sus encargos', () => {
  it('Mandingas, granizados y demás quedan en su cuadra, con aviso y menú', () => {
    const c = city();
    const want = { mandingas92: [300, -250], mandingas94: [158, -505], granizados92: [272, -332], laspatatas: [154, -261] };
    for (const [id, [x, z]] of Object.entries(want)) {
      const p = c.pois.find((q) => q.id === id);
      expect(p, id).toBeTruthy();
      expect(p.type).toBe('food');
      expect(p.menu.length).toBeGreaterThan(0);
      expect(Math.hypot(p.x - x, p.z - z), id).toBeLessThan(40);
      const b = c.buildings.find((q) => q.local?.name === p.name);
      expect(b, p.name).toBeTruthy();
      expect(b.style).toBe('tienda');
    }
    expect(c.pois.filter((p) => p.type === 'food').length).toBeGreaterThanOrEqual(10);
  });

  it('domicilios de mandingas: moto del local, pedido y tres entregas', () => {
    const c = city();
    const ms = new MissionSystem(createMissionDefs(c));
    expect(ms.available('mandingas92').id).toBe('mandingas');
    const evs = ms.start('mandingas');
    expect(evs.find((e) => e.type === 'spawnVehicle').at).toBe('mandingas92');
    let paid = 0;
    for (const st of ms.active.def.stages) {
      const r = ms.update(1, { x: st.target.x, z: st.target.z });
      paid += r.find((e) => e.type === 'complete')?.reward ?? 0;
    }
    expect(paid).toBe(1400);
  });

  it('el granizado se derrite si uno se demora', () => {
    const c = city();
    const ms = new MissionSystem(createMissionDefs(c));
    ms.start('granizado');
    expect(ms.active.timer).toBeGreaterThan(30);
    expect(types(ms.update(ms.active.timer + 1, { x: 0, z: 0 }))).toEqual(['fail']);
  });
});
