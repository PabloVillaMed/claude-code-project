// Conducción v3.5: resistencia y choques (CRASH), inclinación de la moto
// (MOTO) y caballito / stoppie (WHEELIE) de sim/vehiclePhysics.js.
import { describe, expect, it } from 'vitest';
import { CRASH, MOTO, VEHICLE_TYPES, WHEELIE, createVehicleState, crashOnDriver, crashOtherDamage, crashSelfDamage, emptyDriveInput, stepVehicle } from '../../src/sim/vehiclePhysics.js';
import { POLICE_MOTO_SPEC } from '../../src/sim/vehicleVariants.js';
import { flatEnv } from './helpers.js';

const drive = (o = {}) => ({ ...emptyDriveInput(), ...o });
// Lo de antes de v3.5 (para comparar).
const OLD_HEALTH = { taxi: 1000, sedan: 1000, camioneta: 1400, buseta: 2200, policia: 1300, moto: 500 };

/** Choque de frente contra un muro a `speed` m/s (sin acelerar): impacto, salud perdida y lo que le pasa al piloto. */
function wallCrash(type, speed) {
  const env = flatEnv([{ minX: -20, maxX: 20, minZ: -31, maxZ: -30, minY: -1, maxY: 10 }]);
  const v = createVehicleState(type, 0, 0, 0, env.groundHeight);
  v.vz = -speed;
  v.forwardSpeed = speed;
  let impact = 0;
  const driver = { damage: 0, knockOff: false };
  for (let t = 0; t < 3; t += 1 / 30) {
    const i = stepVehicle(v, drive(), 1 / 30, env);
    impact = Math.max(impact, i);
    const c = crashOnDriver(!!v.spec.twoWheels, i);
    driver.damage += c.damage;
    driver.knockOff ||= c.knockOff;
  }
  return { impact, lost: v.spec.health - v.health, frac: (v.spec.health - v.health) / v.spec.health, ...driver };
}

describe('resistencia y choques', () => {
  it('más salud por tipo (×1,5 a ×2) y la moto de la Policía también', () => {
    for (const [type, old] of Object.entries(OLD_HEALTH)) {
      expect(VEHICLE_TYPES[type].health / old, type).toBeGreaterThanOrEqual(1.5);
      expect(VEHICLE_TYPES[type].health / old, type).toBeLessThanOrEqual(2);
    }
    expect(POLICE_MOTO_SPEC.health).toBeGreaterThanOrEqual(650 * 1.5);
  });

  it('menos daño por impacto propio y a los otros (umbral más alto, factor más bajo)', () => {
    for (const i of [5, 10, 20, 30]) {
      expect(crashSelfDamage(i)).toBeLessThan(Math.max(0, i - 4) * 18);
      expect(crashOtherDamage(i)).toBeLessThan(i * 12);
    }
    expect(crashSelfDamage(CRASH.selfThreshold)).toBe(0);
    expect(crashOtherDamage(CRASH.otherThreshold)).toBe(0);
  });

  it('carro contra un muro a 10 / 20 / 30 m/s: el jugador no pierde vida; el carro, poca', () => {
    const r = [10, 20, 30].map((s) => wallCrash('taxi', s));
    for (const x of r) {
      expect(x.damage).toBe(0);
      expect(x.knockOff).toBe(false);
    }
    expect(r[0].impact).toBeGreaterThan(8); // sí chocó
    expect(r[0].frac).toBeLessThan(0.04);
    expect(r[1].frac).toBeLessThan(0.12);
    expect(r[2].frac).toBeLessThan(0.2);
    expect(r[2].lost).toBeGreaterThan(r[1].lost);
    // Antes (a 30 m/s): (30 − 4) × 18 = 468 de 1000.
    expect(r[2].frac).toBeLessThan(468 / 1000 / 2);
  });

  it('moto contra un muro: a 10 m/s nada, a 20 poca vida sin caerse, a 30 se cae con poca vida', () => {
    const [a, b, c] = [10, 20, 30].map((s) => wallCrash('moto', s));
    expect(a.damage).toBe(0);
    expect(a.knockOff).toBe(false);
    expect(b.knockOff).toBe(false);
    expect(b.damage).toBeLessThan(5);
    expect(c.knockOff).toBe(true);
    expect(c.damage).toBeGreaterThan(0);
    expect(c.damage).toBeLessThan(20); // antes: 30 × 2,5 = 75
    expect(c.frac).toBeLessThan(0.35);
  });

  it('en carro solo hay sacudida y sonido; en moto solo un golpe de verdad fuerte tumba', () => {
    const car = crashOnDriver(false, 40);
    expect(car.damage).toBe(0);
    expect(car.fx).toBe(true);
    expect(car.shake).toBeGreaterThan(0);
    expect(crashOnDriver(true, CRASH.motoFallThreshold - 0.5).knockOff).toBe(false);
    expect(crashOnDriver(true, CRASH.motoFallThreshold).knockOff).toBe(true);
    expect(crashOnDriver(true, 2).fx).toBe(false);
  });
});

describe('moto: inclinación en las curvas', () => {
  it('se inclina hacia adentro, con tope y sin saltos por cuadro', () => {
    const env = flatEnv();
    const m = createVehicleState('moto', 0, 0, 0, env.groundHeight);
    for (let t = 0; t < 3; t += 1 / 30) stepVehicle(m, drive({ throttle: 1 }), 1 / 30, env);
    let prev = m.lean;
    let maxStep = 0;
    for (let t = 0; t < 2; t += 1 / 30) {
      stepVehicle(m, drive({ throttle: 0.6, steer: 1 }), 1 / 30, env);
      maxStep = Math.max(maxStep, Math.abs(m.lean - prev));
      prev = m.lean;
    }
    expect(m.lean).toBeLessThan(-0.25); // a la derecha (lado derecho abajo)
    expect(m.lean).toBeGreaterThanOrEqual(-MOTO.leanMax - 1e-9);
    expect(maxStep).toBeLessThan(0.06); // suave: < 3,5° por cuadro a 30 fps
    // Detenida se recuesta un poco hacia la izquierda (pie del piloto).
    for (let t = 0; t < 6; t += 1 / 30) stepVehicle(m, drive({ brake: Math.abs(m.forwardSpeed) > 0.3 ? 1 : 0 }), 1 / 30, env);
    expect(m.lean).toBeGreaterThan(0.02);
    expect(m.lean).toBeLessThanOrEqual(MOTO.stopLean + 1e-6);
  });
});

describe('moto: caballito y stoppie', () => {
  const run = (ctrl, seconds, v0 = 10) => {
    const env = flatEnv();
    const m = createVehicleState('moto', 0, 0, 0, env.groundHeight);
    m.vz = -v0;
    m.forwardSpeed = v0;
    const rec = [];
    for (let t = 0; t < seconds; t += 1 / 30) {
      stepVehicle(m, drive(ctrl(m, t)), 1 / 30, env);
      rec.push({ t, th: m.wheelie, fall: m.wheelieFall });
    }
    return { m, rec };
  };

  it('tocando el acelerador con la tecla se sostiene 5 s sin caerse', () => {
    const { rec } = run((m) => ({ wheelie: true, throttle: m.wheelie < WHEELIE.holdAngle ? 1 : 0 }), 6);
    const hold = rec.filter((r) => r.t > 1);
    expect(hold.some((r) => r.fall)).toBe(false);
    expect(Math.min(...hold.map((r) => r.th))).toBeGreaterThan(0.25);
    expect(Math.max(...hold.map((r) => r.th))).toBeLessThan(WHEELIE.balanceAngle);
  });

  it('con un mando a medio acelerador también es estable', () => {
    const { rec } = run(() => ({ wheelie: true, throttle: 0.6 }), 6);
    const late = rec.filter((r) => r.t > 3).map((r) => r.th);
    expect(Math.max(...late) - Math.min(...late)).toBeLessThan(0.05);
    expect(Math.min(...late)).toBeGreaterThan(0.2);
  });

  it('a fondo sin soltar se pasa del punto de equilibrio y se cae hacia atrás', () => {
    const { rec } = run(() => ({ wheelie: true, throttle: 1 }), 3);
    const fall = rec.find((r) => r.fall);
    expect(fall).toBeTruthy();
    expect(fall.t).toBeGreaterThan(0.8); // da tiempo de reaccionar
    expect(CRASH.wheelieFallDamage).toBeLessThan(15);
  });

  it('soltando la tecla baja suave (sin golpe) y frenando con la tecla se levanta la de atrás', () => {
    const { rec } = run((m, t) => ({ wheelie: t < 0.7, throttle: t < 0.7 ? 1 : 0.4 }), 2.5);
    const down = rec.filter((r) => r.t >= 0.7);
    for (let i = 1; i < down.length; i++) expect(down[i].th).toBeLessThanOrEqual(down[i - 1].th + 1e-9);
    expect(down.at(-1).th).toBe(0);
    let maxDrop = 0;
    for (let i = 1; i < down.length; i++) maxDrop = Math.max(maxDrop, down[i - 1].th - down[i].th);
    expect(maxDrop).toBeLessThan(0.08);
    const s = run((m, t) => (t < 1 ? { throttle: 1 } : { wheelie: true, brake: 1 }), 2.2, 18);
    const min = Math.min(...s.rec.map((r) => r.th));
    expect(min).toBeLessThan(-0.1);
    expect(min).toBeGreaterThanOrEqual(-WHEELIE.stoppieMax - 1e-6);
  });

  it('el tráfico (sin la tecla) nunca levanta la rueda y el carro no hace caballito', () => {
    const { m } = run(() => ({ throttle: 1 }), 3);
    expect(m.wheelie).toBe(0);
    const env = flatEnv();
    const car = createVehicleState('taxi', 0, 0, 0, env.groundHeight);
    for (let t = 0; t < 3; t += 1 / 30) stepVehicle(car, drive({ throttle: 1, wheelie: true }), 1 / 30, env);
    expect(car.wheelie).toBe(0);
  });
});
