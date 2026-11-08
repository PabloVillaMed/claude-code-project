// Subir y bajar sin saltos: los planes de sim/boarding.js (raíz, giro, peso
// de la postura sentada, inclinación del vehículo) y la transición de la
// cámara (cameraRig ctx.board).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BOARD, carEntryPlan, carExitPlan, motoEntryPlan, motoExitPlan, poseAt, angleDiff, ramp } from '../../src/sim/boarding.js';
import { CameraRig, footCamera, vehicleCamera, BOARD_CAM_PITCH } from '../../src/game/cameraRig.js';

const car = { width: 1.74, length: 4.29, seat: { x: -0.37, y: 0.42, z: 0.15 } };
const moto = { width: 0.8, length: 2.1, seat: { x: 0, y: 0.8, z: 0.2 } };
// Como los mide SkinnedRig.clipInfo en el personaje del jugador.
const clips = {
  door: { duration: 1.1, end: { dx: -0.049, dz: -0.269, dyaw: -0.418 } },
  sit: { duration: 2.5, end: { dx: 0.07, dz: -0.538, dyaw: 1.48 } },
  sitL: { duration: 2.4, end: { dx: -0.118, dz: -0.577, dyaw: -1.339 } },
  stand: { duration: 2.5, end: { dx: -0.016, dz: -0.411, dyaw: 0 } },
};

const PLANS = () => ({
  'carro, por la puerta': carEntryPlan(car, { x: -2.2, z: 1.0, yaw: 1.2 }, clips),
  'carro, por el otro lado': carEntryPlan(car, { x: 2.2, z: 0.5, yaw: Math.PI }, clips),
  'carro, desde adelante': carEntryPlan(car, { x: -0.3, z: -3, yaw: 0 }, clips),
  'carro, desde el andén': carEntryPlan(car, { x: -2.6, y: 0.18, z: 0.4, yaw: -2.5 }, clips),
  'bajarse del carro': carExitPlan(car, clips, -1),
  'bajarse del carro (derecha)': carExitPlan(car, clips, 1),
  'moto, por la izquierda': motoEntryPlan(moto, { x: -1.5, z: 1.0, yaw: 2.5 }),
  'moto, por la derecha': motoEntryPlan(moto, { x: 1.2, z: -0.5, yaw: 0 }),
  'bajarse de la moto': motoExitPlan(moto, -1),
});

/** Recorre un plan a 60 cuadros/s; los saltos de commit (dos claves con el mismo t) no cuentan. */
function sweep(plan) {
  const jumps = new Set(plan.keys.filter((k, i) => i > 0 && k.t === plan.keys[i - 1].t).map((k) => k.t));
  const dt = 1 / 60;
  let prev = poseAt(plan, 0);
  const m = { dp: 0, dyaw: 0, dspeed: 0, dseat: 0, dtilt: 0 };
  for (let t = dt; t <= plan.total + dt; t += dt) {
    const q = poseAt(plan, t);
    const commit = [...jumps].some((j) => j > t - dt - 1e-9 && j <= t + 1e-9);
    if (!commit) {
      m.dp = Math.max(m.dp, Math.hypot(q.x - prev.x, q.y - prev.y, q.z - prev.z));
      m.dyaw = Math.max(m.dyaw, Math.abs(angleDiff(prev.yaw, q.yaw)));
    }
    m.dspeed = Math.max(m.dspeed, Math.abs(q.speed - prev.speed));
    if (q.seat != null && prev.seat != null) m.dseat = Math.max(m.dseat, Math.abs(q.seat - prev.seat));
    m.dtilt = Math.max(m.dtilt, Math.abs((q.tilt ?? 0) - (prev.tilt ?? 0)));
    prev = q;
  }
  return m;
}

describe('subir y bajar sin saltos', () => {
  for (const [name, plan] of Object.entries(PLANS())) {
    it(`${name}: la raíz, el giro, la rapidez y el peso cambian poco a poco`, () => {
      const m = sweep(plan);
      expect(m.dp).toBeLessThan(0.05); // < 3 m/s
      expect(m.dyaw).toBeLessThan(0.12); // < 7 rad/s (antes giraba 12 rad/s en el sitio)
      expect(m.dspeed).toBeLessThan(0.45); // arranca y frena (no de 0 a 2,2 m/s de una)
      expect(m.dseat).toBeLessThan(0.08);
      expect(m.dtilt).toBeLessThan(0.01);
    });
  }

  it('rampa trapezoidal: arranca y termina quieto y recorre todo el tramo', () => {
    expect(ramp(0, 1, 0.25, 0.3)).toEqual({ s: 0, v: 0 });
    expect(ramp(1, 1, 0.25, 0.3)).toEqual({ s: 1, v: 0 });
    const mid = ramp(0.5, 1, 0.25, 0.3);
    expect(mid.v).toBeCloseTo(1 / (1 - 0.125 - 0.15));
    // Continua en los quiebres.
    expect(ramp(0.25 - 1e-6, 1, 0.25, 0.3).s).toBeCloseTo(ramp(0.25 + 1e-6, 1, 0.25, 0.3).s, 5);
    expect(ramp(0.7 - 1e-6, 1, 0.25, 0.3).s).toBeCloseTo(ramp(0.7 + 1e-6, 1, 0.25, 0.3).s, 5);
  });

  it('carro: llega a la puerta ya girado hacia ella y el gesto de la puerta se sostiene hasta el commit', () => {
    const plan = carEntryPlan(car, { x: -2.2, z: 1.0, yaw: 1.2 }, clips);
    const door = plan.events.find((e) => e.clip === 'door');
    expect(door.hold).toBe(true);
    const at = poseAt(plan, door.t);
    expect(angleDiff(at.yaw, -(Math.PI / 2 - 0.5))).toBeCloseTo(0, 2);
    // Camina: arranca desde quieto.
    expect(poseAt(plan, 0.02).speed).toBeLessThan(0.3);
    // Al sentarse, la postura del carro entra a la par del deslizamiento y el carro se hunde del lado de la puerta.
    const slide = plan.keys[plan.keys.length - 1];
    expect(slide.chan).toBe('sit');
    const mid = poseAt(plan, (plan.keys[plan.keys.length - 2].t + slide.t) / 2);
    expect(mid.seat).toBeGreaterThan(0.2);
    expect(mid.seat).toBeLessThan(0.8);
    expect(mid.tilt).toBeGreaterThan(0); // puerta izquierda: se hunde la izquierda (+)
  });

  it('desde el andén (más alto) baja al nivel del vehículo caminando', () => {
    const plan = carEntryPlan(car, { x: -2.6, y: 0.18, z: 0.4, yaw: -2.5 }, clips);
    expect(poseAt(plan, 0).y).toBeCloseTo(0.18);
    const door = plan.events.find((e) => e.clip === 'door');
    expect(poseAt(plan, door.t).y).toBeCloseTo(0);
  });

  it('bajarse: queda de pie afuera, libre del carro y de la moto (radio del jugador 0,35 m)', () => {
    for (const side of [-1, 1]) {
      const c = carExitPlan(car, clips, side);
      expect(Math.abs(c.final.x)).toBeGreaterThan(car.width / 2 + 0.36);
      expect(Math.sign(c.final.x)).toBe(side);
      const m = motoExitPlan(moto, side);
      expect(Math.abs(m.final.x)).toBeGreaterThan(moto.width / 2 + 0.36);
    }
    // La postura del carro se suelta cuando el gesto de levantarse ya la tapa.
    const c = carExitPlan(car, clips, -1);
    const play = c.events.find((e) => e.type === 'play');
    const free = c.events.filter((e) => e.type === 'seat')[1];
    expect(play.t).toBeLessThan(free.t);
    expect(free.t - play.t).toBeCloseTo(BOARD.unsit, 5);
  });

  it('moto: la pierna pasa por encima, la cadera va al asiento después y la moto se inclina hacia el que se monta', () => {
    const plan = motoEntryPlan(moto, { x: -1.5, z: 1.0, yaw: 2.5 });
    const k = plan.keys[plan.keys.length - 1];
    expect(k.chan).toBe('mount');
    const t0 = plan.keys[plan.keys.length - 2].t;
    const at = (f) => poseAt(plan, t0 + (k.t - t0) * f);
    // Pierna arriba a la mitad; la cadera apenas empieza a pasar.
    expect(at(0.5).lift).toBeCloseTo(0.5);
    expect(at(0.15).seat).toBe(0);
    expect(at(0.5).seat).toBeLessThan(0.45);
    expect(at(1).seat).toBeCloseTo(1);
    // La raíz sube con el peso, no antes (el pie de apoyo sigue en el piso).
    expect(at(0.15).y).toBeCloseTo(0, 5);
    // Se monta por la izquierda: la moto se hunde a la izquierda (+) y vuelve.
    expect(at(0.5).tilt).toBeCloseTo(BOARD.motoLean, 3);
    expect(Math.abs(at(1).tilt)).toBeLessThan(1e-6);
    const right = motoEntryPlan(moto, { x: 1.2, z: -0.5, yaw: 0 });
    const kr = right.keys[right.keys.length - 1];
    expect(poseAt(right, (right.keys[right.keys.length - 2].t + kr.t) / 2).tilt).toBeLessThan(0);
    // El pie de apoyo (x) viaja en el evento de montarse.
    expect(plan.events[0].plant).toBeCloseTo(-0.72);
  });
});

describe('cámara al subir y bajar', () => {
  const none = { raycast: () => null };
  const board = (w, o = {}) => ({ enter: true, w, x: -2, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, size: 4.3, moto: false, ...o });
  const ctx = (b) => ({ x: b.vx, y: 0, z: b.vz, inVehicle: b.enter, vehicleHeading: 0, vehicleSpeed: 0, vehicleSize: 4.3, lookX: 0, lookY: 0, board: b });

  it('de la de a pie (siguiendo al personaje) a la de persecución, y la órbita llega detrás del vehículo', () => {
    const rig = new CameraRig(new THREE.PerspectiveCamera(), none);
    rig.yaw = 1.6; // mirando hacia un lado
    rig.pitch = 0.1;
    rig.update(1 / 60, ctx(board(0)));
    const fc = footCamera('normal', { side: 1 });
    expect(rig.dist).toBeCloseTo(fc.dist);
    expect(rig.target.x).toBeCloseTo(-2);
    expect(rig.target.y).toBeCloseTo(fc.height);
    expect(rig.yaw).toBeCloseTo(1.6);
    // Avanza la mezcla: nada salta de un cuadro al siguiente.
    let prev = rig.pos.clone();
    let maxStep = 0;
    for (let i = 1; i <= 120; i++) {
      const u = i / 120;
      rig.update(1 / 60, ctx(board(u * u * (3 - 2 * u))));
      maxStep = Math.max(maxStep, rig.pos.distanceTo(prev));
      prev = rig.pos.clone();
    }
    expect(maxStep).toBeLessThan(0.25);
    const vc = vehicleCamera('cerca', 4.3, 0, false);
    expect(rig.dist).toBeCloseTo(vc.dist);
    expect(rig.yaw).toBeCloseTo(0);
    expect(rig.pitch).toBeCloseTo(BOARD_CAM_PITCH);
    // Ya sentado (sin ctx.board) sigue igual: sin salto al terminar.
    const before = rig.pos.clone();
    rig.update(1 / 60, { ...ctx(board(1)), board: null });
    expect(rig.pos.distanceTo(before)).toBeLessThan(0.05);
  });

  it('al bajarse no gira la órbita: solo acerca la cámara al personaje', () => {
    const rig = new CameraRig(new THREE.PerspectiveCamera(), none);
    rig.yaw = 0.4;
    for (let i = 0; i <= 60; i++) rig.update(1 / 60, { ...ctx(board(1 - i / 60, { enter: false })), inVehicle: false });
    expect(rig.yaw).toBeCloseTo(0.4);
    expect(rig.dist).toBeCloseTo(footCamera('normal', { side: 1 }).dist);
  });
});
