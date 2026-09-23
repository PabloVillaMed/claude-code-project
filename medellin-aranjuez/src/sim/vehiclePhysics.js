// Física arcade de vehículos (modelo bicicleta con agarre lateral): aceleración,
// frenado, reversa, freno de mano con derrape, pendientes, colisiones y daño.

import { clamp, damp, forwardX, forwardZ, rightX, rightZ, wrapAngle } from './math.js';
import { aabbToObb, obbVsObb } from './collision.js';
import { PLAY_BOUNDS } from './terrain.js';

export const VEHICLE_TYPES = {
  taxi: { name: 'Taxi', length: 3.7, width: 1.65, height: 1.5, mass: 950, maxSpeed: 40, accel: 7.5, brake: 16, reverseMax: 8, steerMax: 0.6, wheelBase: 2.4, grip: 10, handbrakeGrip: 1.6, health: 1000, seats: 4 },
  sedan: { name: 'Sedán', length: 4.4, width: 1.8, height: 1.45, mass: 1250, maxSpeed: 46, accel: 8.5, brake: 17, reverseMax: 9, steerMax: 0.58, wheelBase: 2.7, grip: 10, handbrakeGrip: 1.5, health: 1000, seats: 4 },
  camioneta: { name: 'Camioneta', length: 4.7, width: 1.95, height: 1.85, mass: 1900, maxSpeed: 42, accel: 7, brake: 15, reverseMax: 8, steerMax: 0.55, wheelBase: 2.85, grip: 9, handbrakeGrip: 1.8, health: 1400, seats: 5 },
  buseta: { name: 'Buseta', length: 7.8, width: 2.3, height: 2.9, mass: 5500, maxSpeed: 26, accel: 3.6, brake: 10, reverseMax: 5, steerMax: 0.5, wheelBase: 4.6, grip: 8, handbrakeGrip: 3, health: 2200, seats: 1 },
  policia: { name: 'Patrulla', length: 4.5, width: 1.85, height: 1.55, mass: 1400, maxSpeed: 50, accel: 9.5, brake: 18, reverseMax: 9, steerMax: 0.6, wheelBase: 2.75, grip: 11, handbrakeGrip: 1.6, health: 1300, seats: 2 },
  moto: { name: 'Moto', length: 2.0, width: 0.75, height: 1.2, mass: 180, maxSpeed: 44, accel: 10.5, brake: 15, reverseMax: 2.5, steerMax: 0.62, wheelBase: 1.35, grip: 12, handbrakeGrip: 2.2, health: 500, seats: 2, twoWheels: true },
};

const GRAVITY = 9.8;

export function createVehicleState(type, x, z, heading, groundFn) {
  const spec = VEHICLE_TYPES[type];
  if (!spec) throw new Error(`Tipo de vehículo desconocido: ${type}`);
  return {
    type,
    spec,
    x,
    z,
    y: groundFn(x, z),
    heading,
    vx: 0,
    vz: 0,
    forwardSpeed: 0,
    lateralSpeed: 0,
    steer: 0,
    pitch: 0,
    roll: 0,
    lean: 0,
    wheelSpin: 0,
    health: spec.health,
    destroyed: false,
    lastImpact: 0,
    handbrake: false,
    throttle: 0,
  };
}

export const emptyDriveInput = () => ({ throttle: 0, brake: 0, steer: 0, handbrake: false });

export function vehicleObb(v, pad = 0) {
  return { x: v.x, z: v.z, hx: v.spec.width / 2 + pad, hz: v.spec.length / 2 + pad, angle: v.heading };
}

/**
 * Avanza la física de un vehículo. input.throttle 0..1, input.brake 0..1
 * (frena y, detenido, va en reversa), input.steer -1 (izq) .. 1 (der).
 * env = {groundHeight, collision, obstacles?: [obb]}. Devuelve eventos de impacto.
 */
export function stepVehicle(v, input, dt, env) {
  dt = Math.min(dt, 0.1);
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / steps;
  let impact = 0;
  for (let i = 0; i < steps; i++) impact = Math.max(impact, substep(v, input, h, env));
  v.lastImpact = impact;
  return impact;
}

function substep(v, input, dt, env) {
  const sp = v.spec;
  if (v.destroyed) input = emptyDriveInput();

  // --- Dirección con reducción a alta velocidad ---
  const speedAbs = Math.abs(v.forwardSpeed);
  const steerLimit = sp.steerMax / (1 + speedAbs / 22);
  v.steer = damp(v.steer, clamp(input.steer, -1, 1) * steerLimit, 8, dt);

  // Giro según geometría de Ackermann simplificada. Derecha = yaw decreciente.
  const yawRate = (v.forwardSpeed / sp.wheelBase) * Math.tan(v.steer);
  v.heading = wrapAngle(v.heading - yawRate * dt);

  // --- Descomponer velocidad en el nuevo marco ---
  const fx = forwardX(v.heading);
  const fz = forwardZ(v.heading);
  const rx = rightX(v.heading);
  const rz = rightZ(v.heading);
  let vf = v.vx * fx + v.vz * fz;
  let vr = v.vx * rx + v.vz * rz;

  // --- Fuerzas longitudinales ---
  const throttle = clamp(input.throttle, 0, 1);
  const brake = clamp(input.brake, 0, 1);
  v.throttle = throttle;
  if (throttle > 0) {
    if (vf < -0.5) vf = Math.min(0, vf + sp.brake * throttle * dt);
    else vf += sp.accel * throttle * Math.max(0, 1 - vf / sp.maxSpeed) * dt;
  }
  if (brake > 0) {
    if (vf > 0.5) vf = Math.max(0, vf - sp.brake * brake * dt);
    else vf = Math.max(-sp.reverseMax, vf - sp.accel * 0.6 * brake * dt);
  }
  // Pendiente: la gravedad empuja cuesta abajo.
  const half = sp.length / 2;
  const hFront = env.groundHeight(v.x + fx * half, v.z + fz * half);
  const hBack = env.groundHeight(v.x - fx * half, v.z - fz * half);
  const slope = (hFront - hBack) / sp.length;
  vf -= GRAVITY * slope * dt * 0.85;
  // Resistencia de rodadura y aerodinámica.
  const drag = 0.25 + 0.0009 * vf * vf * (sp.twoWheels ? 1.4 : 1);
  vf -= Math.sign(vf) * Math.min(Math.abs(vf), drag * dt);
  // Freno de estacionamiento automático para no rodar en las lomas.
  if (throttle === 0 && Math.abs(vf) < 0.35 && Math.abs(slope) < 0.3 && brake === 0) vf = damp(vf, 0, 6, dt);
  if (input.handbrake) vf = damp(vf, 0, 1.2, dt);
  v.handbrake = !!input.handbrake;

  // --- Agarre lateral (derrape con freno de mano) ---
  const grip = input.handbrake ? sp.handbrakeGrip : sp.grip;
  vr = damp(vr, 0, grip, dt);

  v.forwardSpeed = vf;
  v.lateralSpeed = vr;
  v.vx = fx * vf + rx * vr;
  v.vz = fz * vf + rz * vr;

  // --- Integración y colisiones ---
  let nx = v.x + v.vx * dt;
  let nz = v.z + v.vz * dt;
  let impact = 0;
  const obb = { x: nx, z: nz, hx: sp.width / 2, hz: sp.length / 2, angle: v.heading };
  const reach = Math.max(sp.width, sp.length);
  const vehY = v.y + 0.3;
  for (const b of env.collision.query(nx - reach, nz - reach, nx + reach, nz + reach)) {
    if (vehY > b.maxY || v.y + sp.height < b.minY) continue;
    const res = obbVsObb(obb, aabbToObb(b));
    if (res) impact = Math.max(impact, resolveImpact(v, obb, res));
  }
  if (env.obstacles) {
    for (const o of env.obstacles) {
      const res = obbVsObb(obb, o);
      if (res) impact = Math.max(impact, resolveImpact(v, obb, res, o.mass ? o.mass / (o.mass + sp.mass) : 0.5));
    }
  }
  // Límites del mapa jugable.
  const bounds = env.bounds ?? PLAY_BOUNDS;
  const bx = clamp(obb.x, bounds.minX, bounds.maxX);
  const bz = clamp(obb.z, bounds.minZ, bounds.maxZ);
  if (bx !== obb.x) v.vx = 0;
  if (bz !== obb.z) v.vz = 0;
  obb.x = bx;
  obb.z = bz;
  v.x = obb.x;
  v.z = obb.z;
  v.forwardSpeed = v.vx * fx + v.vz * fz;

  // --- Altura, cabeceo y alabeo según el terreno ---
  const ground = env.groundHeight(v.x, v.z);
  v.y = damp(v.y, ground, 20, dt);
  if (v.y < ground - 0.2) v.y = ground - 0.2;
  const hL = env.groundHeight(v.x - rx * sp.width * 0.5, v.z - rz * sp.width * 0.5);
  const hR = env.groundHeight(v.x + rx * sp.width * 0.5, v.z + rz * sp.width * 0.5);
  v.pitch = damp(v.pitch, Math.atan2(hFront - hBack, sp.length), 12, dt);
  v.roll = damp(v.roll, Math.atan2(hR - hL, sp.width), 12, dt);
  if (sp.twoWheels) v.lean = damp(v.lean, clamp(-v.steer * Math.abs(vf) * 0.09, -0.6, 0.6), 6, dt);
  v.wheelSpin += (vf / 0.33) * dt;

  if (impact > 4 && !v.destroyed) {
    v.health -= (impact - 4) * 18;
    if (v.health <= 0) {
      v.health = 0;
    }
  }
  return impact;
}

/** Saca el vehículo de un obstáculo y amortigua la velocidad contra la normal. */
function resolveImpact(v, obb, res, share = 1) {
  const push = res.depth * (share > 0 ? Math.max(share, 0.5) : 1);
  obb.x += res.nx * push;
  obb.z += res.nz * push;
  const vn = v.vx * res.nx + v.vz * res.nz;
  if (vn < 0) {
    const restitution = 0.25;
    v.vx -= (1 + restitution) * vn * res.nx;
    v.vz -= (1 + restitution) * vn * res.nz;
    // Fricción tangencial en el roce.
    v.vx *= 0.92;
    v.vz *= 0.92;
    return -vn;
  }
  return 0;
}

export function speedKmh(v) {
  return Math.abs(v.forwardSpeed) * 3.6;
}

/** Punto de salida del conductor (lado izquierdo, como en Colombia). */
export function exitPoint(v) {
  const off = v.spec.width / 2 + 0.8;
  return { x: v.x - rightX(v.heading) * off, z: v.z - rightZ(v.heading) * off };
}
