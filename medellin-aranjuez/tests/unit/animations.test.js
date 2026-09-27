import { describe, expect, it } from 'vitest';
import { FIDGETS, pickFidget, fidgetDelay, standingActivity, walkingActivity, walkStyle, playerStyle, speechGesture, purchaseGestures, EMOTES, nextEmote, unit } from '../../src/sim/animSelect.js';
import { carEntryPlan, carExitPlan, motoEntryPlan, motoExitPlan, poseAt, fireEvents, rotate, applyEnd, seatRoot, entrySide } from '../../src/sim/boarding.js';

describe('elección de animaciones', () => {
  it('gestos de relleno: nunca repite el anterior y respeta los disponibles', () => {
    for (let i = 0; i < 50; i++) {
      const r = i / 50;
      const n = pickFidget(FIDGETS.stand, 'idle_look', r);
      expect(FIDGETS.stand).toContain(n);
      expect(n).not.toBe('idle_look');
    }
    expect(pickFidget(FIDGETS.sit, null, 0.5, (n) => n === 'sit_look')).toBe('sit_look');
    expect(pickFidget(FIDGETS.sit, 'sit_look', 0.5, (n) => n === 'sit_look')).toBe('sit_look');
    expect(pickFidget(FIDGETS.sit, null, 0.5, () => false)).toBe(null);
    expect(fidgetDelay(true, 0)).toBeGreaterThan(4);
    expect(fidgetDelay(false, 0.99)).toBeLessThan(25);
  });

  it('actividad de los peatones: estable, variada y minoritaria', () => {
    expect(standingActivity(7, 3)).toBe(standingActivity(7, 3));
    const acts = Array.from({ length: 400 }, (_, i) => standingActivity(i, 1));
    const phone = acts.filter((a) => a === 'phone').length;
    const text = acts.filter((a) => a === 'text').length;
    expect(phone).toBeGreaterThan(40);
    expect(text).toBeGreaterThan(30);
    expect(acts.filter((a) => a === null).length).toBeGreaterThan(200);
    const walking = Array.from({ length: 400 }, (_, i) => walkingActivity(i, 2)).filter(Boolean).length;
    expect(walking).toBeGreaterThan(10);
    expect(walking).toBeLessThan(70);
    for (let i = 0; i < 100; i++) expect(unit(i, 3)).toBeGreaterThanOrEqual(0);
  });

  it('estilos de caminar: pandilla sobrada, rumba solo de noche, policía normal', () => {
    expect(walkStyle({ id: 1, faction: 'gang' })).toBe('cool');
    expect(walkStyle({ id: 1, faction: 'police' })).toBe(null);
    const day = Array.from({ length: 300 }, (_, i) => walkStyle({ id: i, faction: 'civil', hour: 12 }));
    expect(day).not.toContain('drunk');
    expect(day.filter((s) => s === 'stroll').length).toBeGreaterThan(50);
    const night = Array.from({ length: 300 }, (_, i) => walkStyle({ id: i, faction: 'civil', hour: 23 }));
    expect(night.filter((s) => s === 'drunk').length).toBeGreaterThan(10);
    expect(Array.from({ length: 300 }, (_, i) => walkStyle({ id: i, faction: 'civil', female: true, hour: 23 }))).not.toContain('drunk');
    expect(playerStyle(20)).toBe('injured');
    expect(playerStyle(80)).toBe(null);
    expect(playerStyle(0)).toBe(null);
  });

  it('gestos del diálogo, de las compras y emotes', () => {
    expect(speechGesture('saludo_2')).toEqual({ gesture: 'wave' });
    expect(speechGesture('charla_4').upper).toBe('talk');
    expect(speechGesture('pregon').upper).toBe('talk_excited');
    expect(speechGesture('disparos').upper).toBe(null);
    expect(purchaseGestures('food')).toEqual(['take', 'drink']);
    expect(purchaseGestures('weapon')).toEqual(['take']);
    expect(purchaseGestures('mission')).toEqual([]);
    let i = -1;
    const seen = new Set();
    for (let k = 0; k < EMOTES.length; k++) seen.add(EMOTES[(i = nextEmote(i))]);
    expect(seen.size).toBe(EMOTES.length);
  });
});

describe('subir y bajar de vehículos', () => {
  const car = { width: 1.73, length: 4, seat: { x: -0.35, y: 0.42, z: 0.05 } };
  // Medidas como las de SkinnedRig.clipInfo (cadera ~0.89 m).
  const clips = {
    door: { duration: 1.1, end: { dx: 0, dz: -0.26, dyaw: 0 } },
    sit: { duration: 2.5, end: { dx: 0.07, dz: -0.55, dyaw: 1.48 } },
    sitL: { duration: 2.4, end: { dx: -0.12, dz: -0.59, dyaw: -1.34 } },
    stand: { duration: 2.5, end: { dx: -0.02, dz: -0.42, dyaw: 0 } },
  };

  it('geometría: rotar y aplicar el final de un clip', () => {
    const r = rotate(0, -1, Math.PI / 2); // adelante girando 90° a la izquierda = -X
    expect(r.x).toBeCloseTo(-1);
    expect(r.z).toBeCloseTo(0);
    const e = applyEnd({ x: 0, y: 0, z: 0, yaw: 0 }, clips.sit.end);
    expect(e.z).toBeCloseTo(-0.55);
    expect(e.yaw).toBeCloseTo(1.48);
    expect(seatRoot(car.seat).y).toBeCloseTo(-0.08);
    expect(seatRoot(car.seat, true).y).toBeCloseTo(0.27);
    expect(entrySide({ x: -2 })).toBe(-1);
    expect(entrySide({ x: 2 })).toBe(1);
  });

  it('subir por la puerta del conductor: puerta, sentarse y deslizarse al puesto', () => {
    const plan = carEntryPlan(car, { x: -2.3, z: 1.2, yaw: 0 }, clips);
    expect(plan.side).toBe(-1);
    const types = plan.events.map((e) => e.type + (e.clip ? `:${e.clip}` : ''));
    expect(types).toEqual(['play:door', 'commit', 'play:sit', 'commit', 'seat']);
    // Rápido: menos de ~4 s aun caminando hasta la puerta.
    expect(plan.total).toBeGreaterThan(1.2);
    expect(plan.total).toBeLessThan(4);
    // Arranca donde estaba el personaje y termina sentado en el puesto.
    const p0 = poseAt(plan, 0);
    expect(p0.x).toBeCloseTo(-2.3);
    const end = poseAt(plan, plan.total + 1);
    expect(end).toMatchObject({ x: car.seat.x, z: car.seat.z });
    expect(end.yaw).toBeCloseTo(0);
    // La puerta se abre desde afuera del carro, y al sentarse la cadera queda sobre el borde.
    const door = plan.events.find((e) => e.clip === 'door');
    expect(poseAt(plan, door.t).x).toBeLessThan(-car.width / 2);
    const sat = plan.events.filter((e) => e.type === 'commit')[1];
    const hip = poseAt(plan, sat.t + 1e-6);
    expect(hip.x).toBeCloseTo(-(car.width / 2 - 0.2), 1);
    // Mientras camina, la base de locomoción recibe una rapidez razonable.
    const walking = plan.keys.filter((k) => k.walk);
    expect(walking.length).toBeGreaterThan(0);
    const mid = poseAt(plan, (plan.keys[0].t + plan.keys[1].t) / 2);
    expect(mid.speed).toBeLessThanOrEqual(2.5);
  });

  it('subir por el otro lado: se sienta del lado del copiloto y cruza', () => {
    const plan = carEntryPlan(car, { x: 2.2, z: 0.5, yaw: Math.PI }, clips);
    expect(plan.side).toBe(1);
    expect(plan.events.find((e) => e.type === 'play' && e.clip !== 'door').clip).toBe('sitL');
    expect(poseAt(plan, 99).x).toBeCloseTo(car.seat.x);
  });

  it('desde adelante del carro rodea la esquina en vez de atravesarlo', () => {
    const plan = carEntryPlan(car, { x: -0.3, z: -3, yaw: 0 }, clips);
    for (let t = 0; t < plan.events[0].t; t += 0.05) {
      const p = poseAt(plan, t);
      const inside = Math.abs(p.x) < car.width / 2 - 0.05 && Math.abs(p.z) < car.length / 2 - 0.1;
      expect(inside).toBe(false);
    }
  });

  it('bajarse: se desliza al borde, se levanta y queda de pie afuera mirando hacia fuera', () => {
    const plan = carExitPlan(car, clips, -1);
    expect(plan.events.map((e) => e.type)).toEqual(['seat', 'seat', 'play', 'commit']);
    expect(plan.final.x).toBeLessThan(-car.width / 2);
    expect(plan.final.yaw).toBeCloseTo(Math.PI / 2);
    expect(plan.total).toBeLessThan(2.5);
    const right = carExitPlan(car, clips, 1);
    expect(right.final.x).toBeGreaterThan(car.width / 2);
  });

  it('moto: se monta por un lado y se baja al otro', () => {
    const moto = { width: 0.75, length: 2, seat: { x: 0, y: 0.26, z: 0.2 } };
    const up = motoEntryPlan(moto, { x: -1.2, z: 0.3, yaw: 0 });
    expect(poseAt(up, 99)).toMatchObject(seatRoot(moto.seat, true));
    expect(up.events.some((e) => e.mount)).toBe(true);
    const down = motoExitPlan(moto, -1);
    expect(down.final.x).toBeLessThan(-0.5);
  });

  it('los eventos se disparan una sola vez y en orden', () => {
    const plan = carEntryPlan(car, { x: -2, z: 0.5, yaw: 0 }, clips);
    const fired = [];
    let i = 0;
    for (let t = 0; t <= plan.total + 0.1; t += 1 / 30) i = fireEvents(plan, i, t, (e) => fired.push(e));
    expect(fired).toEqual(plan.events);
  });
});
