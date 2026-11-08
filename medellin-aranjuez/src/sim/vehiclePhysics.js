// Física arcade de vehículos (modelo bicicleta con agarre limitado): el giro
// y la corrección del deslizamiento lateral no pueden pedir más aceleración
// de la que dan las llantas (mu·g), así que a alta velocidad el carro subvira
// y los derrapes conservan el impulso y se corrigen con contravolante; con el
// freno de mano se suelta la cola. Aceleración, frenado, reversa, pendientes,
// inercia de giro, cabeceo y balanceo de la carrocería, colisiones y daño.

import { clamp, damp, forwardX, forwardZ, rightX, rightZ, wrapAngle } from './math.js';
import { aabbToObb, obbVsObb } from './collision.js';
import { PLAY_BOUNDS } from './terrain.js';
import { VEHICLE_VARIANTS } from './vehicleVariants.js';

// `health`: resistencia de cada tipo (v3.5: ~×1,7 de la de antes, que era
// taxi/sedán 1000, camioneta 1400, buseta 2200, patrulla 1300, moto 500).
export const VEHICLE_TYPES = {
  taxi: { name: 'Taxi', length: 4.0, width: 1.73, height: 1.5, mass: 950, maxSpeed: 40, accel: 7.5, brake: 16, reverseMax: 8, steerMax: 0.6, wheelBase: 2.5, grip: 10, handbrakeGrip: 1.6, mu: 0.95, health: 1700, seats: 4 },
  sedan: { name: 'Sedán', length: 4.45, width: 1.77, height: 1.47, mass: 1250, maxSpeed: 46, accel: 8.5, brake: 17, reverseMax: 9, steerMax: 0.58, wheelBase: 2.75, grip: 10, handbrakeGrip: 1.5, mu: 1.0, health: 1700, seats: 4 },
  camioneta: { name: 'Camioneta', length: 4.4, width: 1.85, height: 1.65, mass: 1900, maxSpeed: 42, accel: 7, brake: 15, reverseMax: 8, steerMax: 0.55, wheelBase: 2.75, grip: 9, handbrakeGrip: 1.8, mu: 0.88, health: 2400, seats: 5 },
  buseta: { name: 'Buseta', length: 7.8, width: 2.3, height: 2.9, mass: 5500, maxSpeed: 26, accel: 3.6, brake: 10, reverseMax: 5, steerMax: 0.5, wheelBase: 4.4, grip: 8, handbrakeGrip: 3, mu: 0.75, health: 3800, seats: 1 },
  policia: { name: 'Patrulla', length: 4.4, width: 1.85, height: 1.65, mass: 1400, maxSpeed: 50, accel: 9.5, brake: 18, reverseMax: 9, steerMax: 0.6, wheelBase: 2.75, grip: 11, handbrakeGrip: 1.6, mu: 1.08, health: 2200, seats: 2 },
  moto: { name: 'Moto', length: 2.0, width: 0.75, height: 1.2, mass: 180, maxSpeed: 44, accel: 10.5, brake: 15, reverseMax: 2.5, steerMax: 0.62, wheelBase: 1.35, grip: 12, handbrakeGrip: 2.2, mu: 1.05, health: 900, seats: 2, twoWheels: true },
};

// ---------------------------------------------- choques (ajustables)
// `impact` es la rapidez (m/s) contra la normal del golpe: de frente contra un
// muro, casi la del vehículo; de lado o rozando, mucho menos.
export const CRASH = {
  /** Daño al propio vehículo: nada por debajo de `selfThreshold` m/s y `selfFactor` de salud por m/s encima (antes 4 y 18). */
  selfThreshold: 7,
  selfFactor: 12,
  /** Daño a otro vehículo que el jugador embiste (Game.updateDriving): igual, con su umbral y factor (antes 0 y 12). */
  otherThreshold: 4,
  otherFactor: 7,
  /** Sonido del golpe y sacudida de la cámara desde este impacto (m/s); sacudida por m/s y tope. */
  fxThreshold: 3,
  shakePerImpact: 0.03,
  shakeMax: 0.5,
  /** En carro el jugador no pierde vida al chocar: vida por m/s sobre `carHurtThreshold` (0 = nunca). */
  carHurtFactor: 0,
  carHurtThreshold: 16,
  /** En moto: desde `motoHurtThreshold` m/s pierde `motoHurtFactor` de vida por m/s sin caerse (40 m/s → ~11). */
  motoHurtThreshold: 12,
  motoHurtFactor: 0.4,
  /** Solo un golpe de verdad fuerte (≥ `motoFallThreshold` m/s, ~83 km/h de frente) lo tumba: `motoFallDamage` + `motoFallFactor` por m/s encima. */
  motoFallThreshold: 23,
  motoFallDamage: 10,
  motoFallFactor: 0.5,
  /** Vida que pierde el piloto al irse de espaldas en un caballito. */
  wheelieFallDamage: 6,
};

// ----------------------------- carro: balanceo de la carrocería (ajustables)
// La suspensión (solo visual: carrocería y conductor, no las ruedas): cabecea
// con la aceleración (nariz arriba al arrancar, abajo al frenar) y se balancea
// hacia afuera en las curvas. La buseta, blanda, ×1,5; la moto no.
export const BODY = {
  /** Cabeceo: rad por m/s² de aceleración, tope al frenar (pitchDown) y al arrancar (pitchUp), rapidez (1/s). */
  pitchGain: 0.0045,
  pitchDown: 0.055,
  pitchUp: 0.045,
  pitchRate: 6,
  /** Balanceo: rad por m/s² de aceleración lateral, tope (~4,6°) y rapidez (1/s). */
  rollGain: 0.0048,
  rollMax: 0.08,
  rollRate: 5,
};

// ------------------------------------- moto: inclinación y caballito (ajustables)
// La moto se inclina hacia adentro de la curva según la aceleración lateral
// (rapidez × giro: atan(a/g), como una moto de verdad) con tope y suavizado.
// Caballito ('grau'): manteniendo la tecla (Shift) y acelerando, la rueda de
// adelante sube; por debajo del punto de equilibrio la moto es estable (un
// resorte la lleva hacia holdAngle: el acelerador decide qué tan alto va y
// sin acelerar baja), pero pasado balanceAngle la gravedad la tumba hacia
// atrás y, si no se suelta el acelerador o se frena (freno trasero), pasa de
// fallAngle y el piloto se cae. Soltando la tecla baja suave. Frenando fuerte
// con la tecla se levanta la llanta de atrás (stoppie), sin caída.
export const MOTO = {
  /** Inclinación = atan(aLateral / g) × leanGain, hasta leanMax rad (~34°); entra y sale como un resorte críticamente amortiguado de frecuencia leanRate (1/s: ~95 % en 4,7 / leanRate s), sin tirones. */
  leanGain: 1,
  leanMax: 0.6,
  leanRate: 7,
  /** Detenida (por debajo de stopSpeed m/s) se recuesta stopLean rad hacia la izquierda, sobre el pie del piloto. */
  stopSpeed: 1.2,
  stopLean: 0.06,
};

export const WHEELIE = {
  /** Rapidez mínima (m/s) para levantar la rueda de adelante. */
  minSpeed: 2,
  /** Aceleración angular (rad/s²) con el acelerador a fondo (cerca de la velocidad máxima el motor tira hasta un 20 % menos). */
  lift: 5.6,
  /** Lo que tira la gravedad hacia abajo (rad/s²). Debe pasar de assist × holdAngle para que sin acelerar la rueda llegue al piso. */
  gravity: 3.8,
  /** Resorte (1/s²) hacia holdAngle (rad, ~26°) que hace estable la moto por debajo del punto de equilibrio. */
  assist: 8,
  holdAngle: 0.45,
  /** Punto de equilibrio (rad, ~36°): por encima no hay resorte y la gravedad la tumba hacia atrás (tip rad/s² por rad). */
  balanceAngle: 0.62,
  tip: 10,
  /** Pasado este ángulo (rad, ~54°) ya no se salva: el piloto se cae. */
  fallAngle: 0.95,
  /** Amortiguación (1/s) del giro de la moto (con assist da un leve vaivén). */
  damping: 3,
  /** El freno trasero baja la rueda (rad/s² con el freno a fondo). */
  brakeDrop: 6,
  /** Soltando la tecla la rueda baja suave: resorte (1/s²) y amortiguación (1/s) hacia el piso. */
  releaseSpring: 28,
  releaseDamping: 10,
  /** Con la rueda arriba la dirección casi no gira (fracción con la moto a balanceAngle). */
  steerFactor: 0.3,
  /** Stoppie: con la tecla y el freno a fondo por encima de stoppieSpeed m/s, la de atrás sube hasta stoppieMax rad. */
  stoppieSpeed: 7,
  stoppieMax: 0.22,
  stoppieRate: 6,
};

/** Salud que pierde un vehículo con un impacto propio de `impact` m/s (por subpaso). */
export function crashSelfDamage(impact) {
  return impact > CRASH.selfThreshold ? (impact - CRASH.selfThreshold) * CRASH.selfFactor : 0;
}

/** Salud que pierde el vehículo que el jugador embiste con un impacto de `impact` m/s. */
export function crashOtherDamage(impact) {
  return impact > CRASH.otherThreshold ? (impact - CRASH.otherThreshold) * CRASH.otherFactor : 0;
}

/**
 * Qué le pasa al jugador que maneja cuando su vehículo choca con `impact` m/s:
 * {fx: suena y tiembla la cámara, shake, damage (vida), knockOff (en moto: se cae)}.
 * Atropellar peatones va aparte (world.js) y no cambia.
 */
export function crashOnDriver(twoWheels, impact, out = {}) {
  out.fx = impact > CRASH.fxThreshold;
  out.shake = out.fx ? Math.min(CRASH.shakeMax, impact * CRASH.shakePerImpact) : 0;
  out.knockOff = false;
  out.damage = 0;
  if (twoWheels) {
    if (impact >= CRASH.motoFallThreshold) {
      out.knockOff = true;
      out.damage = CRASH.motoFallDamage + (impact - CRASH.motoFallThreshold) * CRASH.motoFallFactor;
    } else if (impact > CRASH.motoHurtThreshold) out.damage = (impact - CRASH.motoHurtThreshold) * CRASH.motoHurtFactor;
  } else if (impact > CRASH.carHurtThreshold) out.damage = (impact - CRASH.carHurtThreshold) * CRASH.carHurtFactor;
  return out;
}

const GRAVITY = 9.8;

/** Ficha de un tipo con los cambios de su variante (medidas, masa, motor). */
export function vehicleSpec(type, variant = null) {
  const base = VEHICLE_TYPES[type];
  if (!base) throw new Error(`Tipo de vehículo desconocido: ${type}`);
  const v = VEHICLE_VARIANTS[variant];
  if (!v || v.type !== type || (!v.spec && !v.name)) return base;
  return { ...base, ...v.spec, name: v.name ?? base.name };
}

export function createVehicleState(type, x, z, heading, groundFn, variant = null) {
  const spec = vehicleSpec(type, variant);
  return {
    type,
    variant: VEHICLE_VARIANTS[variant]?.type === type ? variant : null,
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
    leanVel: 0, // rad/s (moto)
    wheelSpin: 0,
    health: spec.health,
    destroyed: false,
    lastImpact: 0,
    handbrake: false,
    throttle: 0,
    yawRate: 0, // rad/s (positivo = a la derecha)
    bodyPitch: 0, // cabeceo de la carrocería por acelerar/frenar (visual)
    bodyRoll: 0, // balanceo en las curvas (visual)
    slip: 0, // velocidad lateral absoluta (derrape)
    wheelie: 0, // moto: rad, + rueda de adelante arriba (caballito), - la de atrás (stoppie)
    wheelieRate: 0, // rad/s
    wheelieFall: false, // el caballito se pasó del punto de no volver (Game tumba al piloto)
  };
}

export const emptyDriveInput = () => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, wheelie: false });

export function vehicleObb(v, pad = 0) {
  return { x: v.x, z: v.z, hx: v.spec.width / 2 + pad, hz: v.spec.length / 2 + pad, angle: v.heading };
}

/**
 * Avanza la física de un vehículo. input.throttle 0..1, input.brake 0..1
 * (frena y, detenido, va en reversa), input.steer -1 (izq) .. 1 (der).
 * env = {groundHeight, collision, obstacles?: [obb], breakables?: Destructibles,
 * isPlayer?}. Devuelve eventos de impacto.
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
  v.steer = damp(v.steer, clamp(input.steer, -1, 1) * steerLimit, sp.twoWheels ? 10 : 8, dt);

  // Giro: Ackermann simplificado, limitado por el agarre (subviraje) y con
  // inercia. Con freno de mano la cola se suelta y el carro rota de más
  // (sobreviraje), y el contravolante lo frena. Derecha = yaw decreciente.
  const aMax = (sp.mu ?? 0.95) * GRAVITY;
  // En caballito la rueda de adelante casi no toca: gira mucho menos.
  const air = sp.twoWheels && v.wheelie > 0 ? 1 - (1 - WHEELIE.steerFactor) * Math.min(1, v.wheelie / WHEELIE.balanceAngle) : 1;
  const kin = (v.forwardSpeed / sp.wheelBase) * Math.tan(v.steer) * air;
  const wMax = aMax / Math.max(2.5, speedAbs);
  const hb = !!input.handbrake && speedAbs > 4;
  const target = hb ? kin * 1.8 : clamp(kin, -wMax * 1.1, wMax * 1.1);
  const yawResp = sp.mass > 3000 ? 5 : sp.twoWheels ? 14 : 9;
  v.yawRate = damp(v.yawRate ?? 0, target, yawResp, dt);
  v.heading = wrapAngle(v.heading - v.yawRate * dt);

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

  // --- Agarre lateral: las llantas anulan el deslizamiento hasta su límite
  //     (si se pide más, el carro derrapa y conserva parte del impulso) ---
  const grip = input.handbrake ? sp.handbrakeGrip : sp.grip;
  const want = vr * (1 - Math.exp(-grip * dt));
  const limit = (input.handbrake ? 0.45 : 1) * aMax * 1.2 * dt;
  vr -= clamp(want, -limit, limit);
  v.slip = Math.abs(vr);

  // --- Carrocería: cabecea al acelerar/frenar y se balancea en las curvas ---
  const ax = (vf - (v.forwardSpeed ?? vf)) / Math.max(dt, 1e-4);
  const ay = vf * (v.yawRate ?? 0);
  const soft = sp.twoWheels ? 0 : sp.mass > 3000 ? 1.5 : 1;
  v.bodyPitch = damp(v.bodyPitch ?? 0, clamp(ax * BODY.pitchGain * soft, -BODY.pitchDown, BODY.pitchUp), BODY.pitchRate, dt);
  v.bodyRoll = damp(v.bodyRoll ?? 0, clamp(ay * BODY.rollGain * soft, -BODY.rollMax, BODY.rollMax), BODY.rollRate, dt);

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
    if (!res) continue;
    // Postes, faroles, placas y árboles que se tumban (sim/destructibles.js):
    // el objeto cae, el vehículo pierde algo de velocidad y no rebota.
    if (env.breakables && env.breakables.golpe(b, v, res, !!env.isPlayer)) continue;
    impact = Math.max(impact, resolveImpact(v, obb, res));
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
  if (sp.twoWheels) {
    // Hacia adentro de la curva según la aceleración lateral (+ = derecha);
    // casi quieta, recostada sobre el pie izquierdo del piloto.
    const ay = vf * v.yawRate;
    let lt = -Math.atan(ay / GRAVITY) * MOTO.leanGain;
    const sa = Math.abs(vf);
    if (sa < MOTO.stopSpeed) lt += MOTO.stopLean * (1 - sa / MOTO.stopSpeed);
    const k = MOTO.leanRate;
    v.leanVel = (v.leanVel || 0) + (k * k * (clamp(lt, -MOTO.leanMax, MOTO.leanMax) - v.lean) - 2 * k * (v.leanVel || 0)) * dt;
    v.lean += v.leanVel * dt;
    if (Math.abs(v.lean) > MOTO.leanMax) {
      v.lean = Math.sign(v.lean) * MOTO.leanMax;
      v.leanVel = 0;
    }
    if (input.wheelie || v.wheelie || v.wheelieRate) stepWheelie(v, input, vf, impact, dt);
  }
  v.wheelSpin += (vf / 0.33) * dt;

  if (impact > CRASH.selfThreshold && !v.destroyed) {
    v.health -= crashSelfDamage(impact);
    if (v.health <= 0) {
      v.health = 0;
    }
  }
  return impact;
}

/**
 * Caballito y stoppie de la moto (WHEELIE): `v.wheelie` (rad) es el cabeceo
 * sobre la llanta que queda en el piso. Con la tecla, el acelerador sube la
 * rueda de adelante contra la gravedad; por debajo del punto de equilibrio un
 * resorte la hace estable y por encima se tumba hacia atrás; el freno la baja.
 * Sin la tecla (o sin piloto) baja suave. `vf` m/s hacia adelante.
 */
function stepWheelie(v, input, vf, impact, dt) {
  const W = WHEELIE;
  let th = v.wheelie || 0;
  let w = v.wheelieRate || 0;
  const key = !!input.wheelie && !v.destroyed && !v.wheelieFall;
  const throttle = clamp(input.throttle, 0, 1);
  const brake = clamp(input.brake, 0, 1);
  if (key && th >= 0 && (th > 0.002 || (vf > W.minSpeed && throttle > 0))) {
    // El motor tira menos cerca de la velocidad máxima.
    const power = clamp(1.2 - (0.4 * vf) / v.spec.maxSpeed, 0.6, 1);
    const spring = W.assist * (W.holdAngle - Math.min(th, W.balanceAngle));
    const tip = th > W.balanceAngle ? W.tip * (th - W.balanceAngle) : 0;
    const acc = W.lift * throttle * power - W.gravity + spring + tip - W.damping * w - W.brakeDrop * brake;
    w += acc * dt;
    th += w * dt;
    if (th <= 0) {
      th = 0;
      w = 0;
    }
    if (th > W.fallAngle) v.wheelieFall = true;
  } else if (th > 0) {
    // Soltó la tecla (o se cayó el piloto): la rueda vuelve al piso sin golpe.
    w += (-W.releaseSpring * th - W.releaseDamping * w) * dt;
    th += w * dt;
    if (th <= 0.002) {
      th = 0;
      w = 0;
    }
  } else {
    // Stoppie: frenando fuerte con la tecla se levanta la llanta de atrás.
    const want = key && vf > W.stoppieSpeed ? -W.stoppieMax * brake * clamp((vf - W.stoppieSpeed) / 6, 0, 1) : 0;
    th = damp(th, want, W.stoppieRate, dt);
    w = 0;
    if (want === 0 && th > -0.002) th = 0;
  }
  // Un golpe con la rueda arriba la manda al piso.
  if (impact > 6 && th > 0) w = Math.min(w, -2);
  v.wheelie = th;
  v.wheelieRate = w;
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
