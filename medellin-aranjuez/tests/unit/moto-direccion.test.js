// Moto v3.6: inclinación más baja (MOTO) y dirección de la moto del jugador
// (MOTO_STEER: rampa, autocentrado y menos giro a alta velocidad) de
// sim/vehiclePhysics.js. El tráfico y la Policía siguen con la de antes.
import { describe, expect, it } from 'vitest';
import { MOTO, MOTO_STEER, createVehicleState, emptyDriveInput, stepVehicle } from '../../src/sim/vehiclePhysics.js';
import { flatEnv } from './helpers.js';

const DT = 1 / 30;
const DEG = Math.PI / 180;
const drive = (o = {}) => ({ ...emptyDriveInput(), ...o });

/** Moto andando derecho a V m/s (jugador o no). */
function rolling(V, isPlayer = true) {
  const env = { ...flatEnv(), isPlayer };
  const m = createVehicleState('moto', 0, 0, 0, env.groundHeight);
  m.vz = -V;
  m.forwardSpeed = V;
  for (let t = 0; t < 2; t += DT) stepVehicle(m, drive({ throttle: m.forwardSpeed < V ? 1 : 0 }), DT, env);
  return { m, env };
}

/** n cuadros con la tecla `steer` manteniendo la rapidez V; devuelve la historia. */
function hold(m, env, V, steer, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    stepVehicle(m, drive({ throttle: m.forwardSpeed < V ? 1 : 0, steer: typeof steer === 'function' ? steer(i) : steer }), DT, env);
    out.push({ lean: m.lean, yaw: m.yawRate, h: m.heading, cmd: m.steerCmd, steer: m.steer, x: m.x, z: m.z });
  }
  return out;
}

describe('moto: inclinación', () => {
  it('tope visual ~15-18° (antes 34°) con la tecla a fondo a 12, 22 y 35 m/s', () => {
    expect(MOTO.leanMax).toBeLessThanOrEqual(18 * DEG);
    for (const V of [12, 22, 35]) {
      for (const isPlayer of [true, false]) {
        const { m, env } = rolling(V, isPlayer);
        const r = hold(m, env, V, 1, 90);
        const max = Math.max(...r.map((q) => Math.abs(q.lean)));
        expect(max, `${V} m/s`).toBeLessThanOrEqual(MOTO.leanMax + 1e-9);
        expect(max, `${V} m/s`).toBeGreaterThan(12 * DEG); // todavía se ve que se inclina
        expect(r.at(-1).lean).toBeLessThan(0); // hacia adentro (derecha)
      }
    }
  });

  it('entra despacio y sin pasarse; al soltar vuelve sin ir al otro lado', () => {
    const { m, env } = rolling(12);
    const r = hold(m, env, 12, 1, 90);
    const fin = Math.abs(r.at(-1).lean);
    const t90 = r.findIndex((q) => Math.abs(q.lean) >= 0.9 * fin) * DT;
    expect(t90).toBeGreaterThan(0.6); // entrada amortiguada (antes ~0,57 s)
    expect(t90).toBeLessThan(1.5);
    let prev = 0;
    for (const q of r) {
      expect(Math.abs(q.lean)).toBeLessThanOrEqual(fin + 1e-4); // sin sobrepaso
      expect(Math.abs(q.lean - prev)).toBeLessThan(1.2 * DEG); // sin saltos por cuadro
      prev = q.lean;
    }
    const back = hold(m, env, 12, 0, 60);
    expect(Math.max(...back.map((q) => q.lean))).toBeLessThan(0.2 * DEG); // no se pasa al otro lado
    expect(Math.abs(back.at(-1).lean)).toBeLessThan(1 * DEG);
    // Sin vaivén: la inclinación vuelve de forma monótona.
    for (let i = 1; i < back.length; i++) expect(Math.abs(back[i].lean)).toBeLessThanOrEqual(Math.abs(back[i - 1].lean) + 1e-6);
  });

  it('la inclinación es solo de dibujo: no cambia la trayectoria', () => {
    const path = (tweak) => {
      const { m, env } = rolling(14);
      const keys = (i) => (i % 40 < 12 ? 1 : i % 40 < 20 ? 0 : i % 40 < 30 ? -1 : 0);
      for (let i = 0; i < 120; i++) {
        tweak(m);
        stepVehicle(m, drive({ throttle: 0.7, steer: keys(i) }), DT, env);
      }
      return [m.x, m.z, m.heading];
    };
    const a = path(() => {});
    const b = path((m) => {
      m.lean = 0.5; // inclinación absurda: la dirección no la mira
      m.leanVel = -3;
    });
    for (let i = 0; i < 3; i++) expect(b[i]).toBeCloseTo(a[i], 9);
  });
});

describe('moto del jugador: dirección', () => {
  it('un toque corto (0,1 s) gira poco y menos a alta velocidad; el tráfico sigue igual', () => {
    const tap = (V, isPlayer) => {
      const { m, env } = rolling(V, isPlayer);
      const h0 = m.heading;
      hold(m, env, V, (i) => (i < 3 ? 1 : 0), 45);
      return Math.abs(m.heading - h0) / DEG;
    };
    const p12 = tap(12, true);
    const p22 = tap(22, true);
    expect(p12).toBeLessThan(5); // antes 14°
    expect(p12).toBeGreaterThan(1.5); // pero sí corrige
    expect(p22).toBeLessThan(p12);
    expect(p22).toBeLessThan(2.5); // antes 11°
    // Tráfico y Policía (sin isPlayer): la dirección de siempre.
    expect(tap(12, false)).toBeGreaterThan(10);
  });

  it('autocentrado: al soltar el manubrio vuelve solo al centro y deja de girar, sin vaivén', () => {
    const { m, env } = rolling(12);
    hold(m, env, 12, 1, 30);
    expect(m.steerCmd).toBeCloseTo(1, 6); // sostenida, llega a todo
    const r = hold(m, env, 12, 0, 30);
    const tCenter = r.findIndex((q) => q.cmd === 0) * DT;
    expect(tCenter).toBeGreaterThan(0);
    expect(tCenter).toBeLessThan(0.45);
    expect(Math.abs(r.at(-1).steer)).toBeLessThan(1e-9);
    expect(Math.abs(r.at(-1).yaw)).toBeLessThan(0.01);
    // El giro baja sin cambiar de signo (sin contragolpe).
    for (const q of r) expect(q.yaw).toBeGreaterThanOrEqual(-1e-6);
    // De un lado al otro pasa por el centro (sin saltar de +1 a -1).
    const s = hold(m, env, 12, (i) => (i < 15 ? 1 : -1), 40);
    for (let i = 1; i < s.length; i++) expect(Math.abs(s[i].cmd - s[i - 1].cmd)).toBeLessThan(MOTO_STEER.centerRate * DT);
    expect(Math.min(...s.map((q) => Math.abs(q.cmd)))).toBeLessThan(0.06);
    expect(s.at(-1).cmd).toBeCloseTo(-1, 6);
  });

  it('menos giro a alta velocidad, pero curva cerrada todavía posible a baja', () => {
    const lat = (V) => {
      const { m, env } = rolling(V);
      hold(m, env, V, 1, 60);
      return { g: (Math.abs(m.yawRate) * V) / 9.81, radius: V / Math.abs(m.yawRate) };
    };
    const slow = lat(5);
    const mid = lat(12);
    const fast = lat(24);
    expect(slow.radius).toBeLessThan(3.5); // a 18 km/h da la vuelta en una calle
    expect(mid.g).toBeLessThanOrEqual(MOTO_STEER.latLow + 0.02);
    expect(fast.g).toBeLessThan(mid.g);
    expect(fast.g).toBeCloseTo(MOTO_STEER.latHigh, 1);
    expect(fast.radius).toBeLessThan(80); // todavía dobla en una avenida
  });
});
