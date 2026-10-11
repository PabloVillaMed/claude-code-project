import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { ENGINE_PROFILES, coupledRpm, createEngineState, firingRate, stepEngine } from '../../src/sim/engineModel.js';
import { SOUND_PROFILES, trafficMix, workletProfile } from '../../src/game/engineSound.js';
import { VEHICLE_VARIANTS, engineProfile } from '../../src/sim/vehicleVariants.js';

describe('motor: sonido', () => {
  it('cada variante tiene perfil mecánico y de sonido, y los bancos existen', () => {
    const man = JSON.parse(fs.readFileSync('public/sounds/motor/motor.json', 'utf8'));
    for (const [id, v] of Object.entries(VEHICLE_VARIANTS)) {
      const p = engineProfile(v.type, id);
      expect(ENGINE_PROFILES[p], id).toBeTruthy();
      expect(SOUND_PROFILES[p], id).toBeTruthy();
      const w = workletProfile(p);
      expect(man.bancos[w.off], `${id} ${w.off}`).toBeTruthy();
      expect(man.bancos[w.on], `${id} ${w.on}`).toBeTruthy();
      expect(man.bancos[w.off].granos.length).toBeGreaterThan(20);
    }
  });

  it('Doppler y distancia: más agudo al acercarse, más bajo y apagado lejos', () => {
    const cerca = trafficMix(5, 15);
    const lejos = trafficMix(60, -15);
    expect(cerca.pitch).toBeGreaterThan(1.03);
    expect(lejos.pitch).toBeLessThan(0.97);
    expect(cerca.gain).toBeGreaterThan(lejos.gain * 4);
    expect(cerca.lp).toBeGreaterThan(lejos.lp * 3);
    expect(trafficMix(10, 0).pitch).toBeCloseTo(1);
  });
});

/** Acelera de 0 a `vmax` a fondo (aceleración constante simple) y registra el motor. */
function run(id, { vmax = 40, accel = 6, secs = 14, throttle = 1, from = 0, dt = 1 / 60 } = {}) {
  const e = createEngineState(id);
  let v = from;
  const log = [];
  for (let t = 0; t < secs; t += dt) {
    if (throttle > 0) v = Math.min(vmax * 0.99, v + accel * throttle * (1 - v / vmax) * dt * (e.cut ? 0.4 : 1));
    else v = Math.max(0, v - 2.5 * dt);
    stepEngine(e, { speed: v, vmax, throttle, dt });
    log.push({ t, v, rpm: e.rpm, gear: e.gear, cut: e.cut, load: e.load, shifted: e.shifted });
  }
  return { e, log };
}

describe('motor: ritmo de explosiones', () => {
  it('monocilíndrica 4T, 2T y cuatro cilindros', () => {
    expect(firingRate(ENGINE_PROFILES.moto4t, 6000)).toBeCloseTo(50);
    expect(firingRate(ENGINE_PROFILES.moto2t, 6000)).toBeCloseTo(100);
    expect(firingRate(ENGINE_PROFILES.carro, 3000)).toBeCloseTo(100);
    expect(firingRate(ENGINE_PROFILES.diesel, 600)).toBeCloseTo(30);
  });
});

describe('motor: caja de cambios', () => {
  it('a fondo sube todas las marchas y las revoluciones caen en cada cambio', () => {
    for (const id of ['moto4t', 'moto2t', 'carro', 'carro_pequeno', 'camioneta', 'diesel']) {
      const p = ENGINE_PROFILES[id];
      const { log, e } = run(id, { secs: 30, accel: id === 'diesel' ? 2.5 : 6 });
      const shifts = log.filter((s) => s.shifted === 1);
      expect(shifts.length, id).toBe(p.gears.length - 1);
      expect(e.gear, id).toBe(p.gears.length);
      // Las marchas nunca bajan acelerando.
      for (let i = 1; i < log.length; i++) expect(log[i].gear, id).toBeGreaterThanOrEqual(log[i - 1].gear);
      for (const s of shifts) {
        const i = log.indexOf(s);
        const before = log[i - 1].rpm;
        const after = Math.min(...log.slice(i, i + Math.round(p.shiftTime * 60) + 2).map((x) => x.rpm));
        // Cae al menos un 15 % (subir de marcha baja las revoluciones).
        expect(after, `${id} cambio a ${s.gear}`).toBeLessThan(before * 0.85);
        // Mientras cambia no hay carga (el acelerador se corta).
        expect(log[i].load).toBe(0);
      }
      expect(Math.max(...log.map((s) => s.rpm)), id).toBeLessThanOrEqual(p.limiter + 50);
      expect(Math.min(...log.slice(30).map((s) => s.rpm)), id).toBeGreaterThanOrEqual(p.idle * 0.85);
    }
  });

  it('con poco acelerador cambia antes (a menos revoluciones)', () => {
    const peak = (throttle) => {
      const { log } = run('carro', { throttle, secs: 12 });
      const i = log.findIndex((s) => s.shifted === 1);
      return log[i - 1].rpm;
    };
    expect(peak(0.35)).toBeLessThan(peak(1) * 0.8);
  });

  it('soltando el acelerador baja de marcha y vuelve al ralentí', () => {
    const e = createEngineState('carro');
    e.gear = 5;
    let v = 38;
    const gears = [];
    for (let t = 0; t < 20; t += 1 / 60) {
      v = Math.max(0, v - 3 * (1 / 60));
      stepEngine(e, { speed: v, vmax: 40, throttle: 0, dt: 1 / 60 });
      gears.push(e.gear);
    }
    expect(e.gear).toBe(1);
    expect(gears.some((g) => g === 3)).toBe(true);
    expect(e.rpm).toBeLessThan(ENGINE_PROFILES.carro.idle * 1.2);
  });

  it('acelerando quieto sube hasta el limitador y corta el encendido', () => {
    const e = createEngineState('moto4t');
    let cuts = 0;
    let max = 0;
    for (let t = 0; t < 3; t += 1 / 120) {
      stepEngine(e, { speed: 0, vmax: 40, throttle: 1, dt: 1 / 120 });
      cuts += e.cut ? 1 : 0;
      max = Math.max(max, e.rpm);
    }
    expect(max).toBeGreaterThan(ENGINE_PROFILES.moto4t.redline * 0.95);
    expect(cuts).toBeGreaterThan(3);
    // Sin acelerador vuelve al ralentí.
    for (let t = 0; t < 3; t += 1 / 60) stepEngine(e, { speed: 0, vmax: 40, throttle: 0, dt: 1 / 60 });
    expect(e.rpm).toBeLessThan(ENGINE_PROFILES.moto4t.idle * 1.15);
  });

  it('el scooter no tiene marchas: revoluciones casi fijas mientras gana velocidad', () => {
    const { log } = run('scooter', { vmax: 27, accel: 5, secs: 10 });
    expect(log.every((s) => s.gear === 1 && s.shifted === 0)).toBe(true);
    const mid = log.filter((s) => s.v > 6 && s.v < 16).map((s) => s.rpm);
    expect(Math.max(...mid) - Math.min(...mid)).toBeLessThan(1800);
    expect(Math.min(...mid)).toBeGreaterThan(ENGINE_PROFILES.scooter.cvt.engage);
  });

  it('las revoluciones enganchadas son proporcionales a la velocidad', () => {
    const p = ENGINE_PROFILES.carro;
    expect(coupledRpm(p, 1, p.gears[0] * 40, 40)).toBeCloseTo(p.redline);
    expect(coupledRpm(p, 2, 10, 40)).toBeCloseTo(coupledRpm(p, 2, 5, 40) * 2);
  });
});

describe('motor: procesador de audio', () => {
  // El procesador corre en el hilo de audio; aquí se simula su entorno.
  let Proc = null;
  const load = async () => {
    if (Proc) return Proc;
    globalThis.sampleRate = 44100;
    globalThis.AudioWorkletProcessor = class {
      constructor() {
        this.port = {};
      }
    };
    globalThis.registerProcessor = (_n, C) => (Proc = C);
    await import('../../src/game/engineWorklet.js');
    return Proc;
  };
  const grain = () => Float32Array.from({ length: 900 }, (_, i) => Math.sin(i * 0.3) * Math.exp(-i / 300));
  const banks = Object.fromEntries(['carro', 'moto_ralenti', 'moto_carga', 'diesel'].map((k) => [k, { periodo: 0.02, explosiones: 1, granos: [grain(), grain()] }]));
  const run = (m, params, blocks) => {
    const out = [new Float32Array(128)];
    const P = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, [v]]));
    let peak = 0;
    let finite = true;
    for (let b = 0; b < blocks; b++) {
      m.process([], [out], P);
      for (const x of out[0]) {
        if (!Number.isFinite(x)) finite = false;
        peak = Math.max(peak, Math.abs(x));
      }
    }
    return { peak, finite };
  };

  it('una voz reutilizada de un carro de 4 cilindros a una moto sigue sonando sin NaN', async () => {
    const Motor = await load();
    const m = new Motor({ processorOptions: { profile: workletProfile('carro'), banks, seed: 7 } });
    const params = { rpm: 3000, load: 0.6, pitch: 1, cut: 0, crackle: 0 };
    expect(run(m, params, 200).finite).toBe(true);
    // Dejar el índice de cilindro en el último del carro y cambiar a moto.
    m.cylIndex = 3;
    m.setProfile(workletProfile('moto4t'));
    const r = run(m, { ...params, rpm: 6000 }, 400);
    expect(r.finite).toBe(true);
    expect(r.peak).toBeGreaterThan(0.01);
  });

  it('el ruido de admisión es estable aun con la frecuencia más alta', async () => {
    const Motor = await load();
    const m = new Motor({ processorOptions: { profile: { ...workletProfile('moto2t'), noise: 1, noiseFreq: 9000 }, banks, seed: 3 } });
    const r = run(m, { rpm: 12000, load: 1, pitch: 4, cut: 0, crackle: 1 }, 2000);
    expect(r.finite).toBe(true);
    expect(r.peak).toBeLessThanOrEqual(1);
  });
});
