// Controlador de personaje en tercera persona (a pie). Lógica pura y testeable:
// caminar, trotar, correr con estamina, agacharse, saltar, gravedad, pendientes,
// subir andenes y colisiones con edificios y vehículos sin atravesarlos.

import { clamp, dampAngle, forwardX, forwardZ, rightX, rightZ, yawFromDir } from './math.js';
import { circleVsObb } from './collision.js';
import { PLAY_BOUNDS } from './terrain.js';

export const PLAYER = {
  radius: 0.35,
  height: 1.8,
  crouchHeight: 1.2,
  walkSpeed: 1.8,
  runSpeed: 4.6,
  sprintSpeed: 7.4,
  crouchSpeed: 1.5,
  groundAccel: 30,
  airAccel: 5,
  jumpVelocity: 6.0,
  gravity: -19.6,
  stepHeight: 0.45,
  snapDistance: 0.35,
  turnRate: 12,
  staminaMax: 100,
  staminaDrain: 14,
  staminaRegen: 22,
  staminaResume: 25,
  maxSubstep: 1 / 120,
};

export function createPlayerState(x, z, groundFn, yaw = 0) {
  return {
    pos: { x, y: groundFn(x, z), z },
    vel: { x: 0, y: 0, z: 0 },
    yaw,
    onGround: true,
    crouching: false,
    sprinting: false,
    exhausted: false,
    stamina: PLAYER.staminaMax,
    speed: 0,
    jumpHeld: false,
    landedImpact: 0,
  };
}

/** Entrada normalizada de movimiento. */
export function emptyMoveInput() {
  return { forward: 0, right: 0, sprint: false, jump: false, crouch: false, walk: false, aiming: false, camYaw: 0 };
}

/**
 * Avanza el estado del jugador. `env` = {groundHeight(x,z), collision: CollisionWorld,
 * obstacles?: [{x,z,hx,hz,angle}]}. Se subdivide el paso para evitar
 * atravesar paredes aunque el framerate sea bajo.
 */
export function stepPlayer(s, input, dt, env) {
  dt = Math.min(dt, 0.1);
  const steps = Math.max(1, Math.ceil(dt / PLAYER.maxSubstep));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) substep(s, input, h, env);
  return s;
}

function substep(s, input, dt, env) {
  // --- Dirección deseada relativa a la cámara ---
  let mx = clamp(input.right, -1, 1);
  let mz = clamp(input.forward, -1, 1);
  const ml = Math.hypot(mx, mz);
  if (ml > 1) {
    mx /= ml;
    mz /= ml;
  }
  const cy = input.camYaw;
  const wishX = forwardX(cy) * mz + rightX(cy) * mx;
  const wishZ = forwardZ(cy) * mz + rightZ(cy) * mx;
  const wishLen = Math.hypot(wishX, wishZ);

  // --- Agacharse / estamina / velocidad objetivo ---
  s.crouching = !!input.crouch && s.onGround;
  const wantsSprint = input.sprint && wishLen > 0.1 && !s.crouching && !input.aiming;
  if (s.exhausted && s.stamina >= PLAYER.staminaResume) s.exhausted = false;
  s.sprinting = wantsSprint && !s.exhausted && s.onGround;
  if (s.sprinting) {
    s.stamina -= PLAYER.staminaDrain * dt;
    if (s.stamina <= 0) {
      s.stamina = 0;
      s.exhausted = true;
      s.sprinting = false;
    }
  } else {
    s.stamina = Math.min(PLAYER.staminaMax, s.stamina + PLAYER.staminaRegen * dt);
  }
  let maxSpeed = PLAYER.runSpeed;
  if (s.sprinting) maxSpeed = PLAYER.sprintSpeed;
  if (input.walk || input.aiming) maxSpeed = PLAYER.walkSpeed * 1.4;
  if (s.crouching) maxSpeed = PLAYER.crouchSpeed;
  const targetX = wishLen > 0 ? wishX * maxSpeed : 0;
  const targetZ = wishLen > 0 ? wishZ * maxSpeed : 0;

  // --- Aceleración horizontal ---
  const accel = s.onGround ? PLAYER.groundAccel : PLAYER.airAccel;
  const dvx = targetX - s.vel.x;
  const dvz = targetZ - s.vel.z;
  const dvl = Math.hypot(dvx, dvz);
  const maxDv = accel * dt;
  if (dvl <= maxDv) {
    s.vel.x = targetX;
    s.vel.z = targetZ;
  } else if (s.onGround || wishLen > 0) {
    s.vel.x += (dvx / dvl) * maxDv;
    s.vel.z += (dvz / dvl) * maxDv;
  }

  // --- Salto (solo al presionar, no manteniendo) ---
  if (input.jump && !s.jumpHeld && s.onGround && !s.crouching) {
    s.vel.y = PLAYER.jumpVelocity;
    s.onGround = false;
  }
  s.jumpHeld = !!input.jump;

  // --- Gravedad ---
  if (!s.onGround) s.vel.y += PLAYER.gravity * dt;

  // --- Integración horizontal con colisiones ---
  const prevX = s.pos.x;
  const prevZ = s.pos.z;
  let nx = s.pos.x + s.vel.x * dt;
  let nz = s.pos.z + s.vel.z * dt;
  const headY = s.pos.y + (s.crouching ? PLAYER.crouchHeight : PLAYER.height);
  const res = env.collision.resolveCircle(nx, nz, PLAYER.radius, s.pos.y + PLAYER.stepHeight, headY);
  nx = res.x;
  nz = res.z;
  if (env.obstacles) {
    for (const o of env.obstacles) {
      const r = circleVsObb(nx, nz, PLAYER.radius, o);
      if (r) {
        nx += r.nx * r.depth;
        nz += r.nz * r.depth;
      }
    }
  }
  const bounds = env.bounds ?? PLAY_BOUNDS;
  nx = clamp(nx, bounds.minX, bounds.maxX);
  nz = clamp(nz, bounds.minZ, bounds.maxZ);
  // Velocidad efectiva tras colisión (deslizar contra la pared). Un empujón
  // de resolución nunca debe acelerar al personaje.
  if (dt > 0) {
    const before = Math.hypot(s.vel.x, s.vel.z);
    let vx = (nx - prevX) / dt;
    let vz = (nz - prevZ) / dt;
    const after = Math.hypot(vx, vz);
    if (after > before && after > 1e-6) {
      vx *= before / after;
      vz *= before / after;
    }
    s.vel.x = vx;
    s.vel.z = vz;
  }
  s.pos.x = nx;
  s.pos.z = nz;

  // --- Integración vertical y suelo ---
  const ground = env.groundHeight(nx, nz, s.pos.y);
  s.pos.y += s.vel.y * dt;
  if (s.onGround) {
    // Pegarse al suelo en bajadas y subir andenes / pendientes.
    if (s.pos.y - ground <= PLAYER.snapDistance && ground - s.pos.y <= PLAYER.stepHeight) {
      s.pos.y = ground;
      s.vel.y = 0;
    } else if (s.pos.y > ground) {
      s.onGround = false; // caída desde un borde
    } else {
      s.pos.y = ground;
    }
  } else if (s.pos.y <= ground) {
    s.landedImpact = -s.vel.y;
    s.pos.y = ground;
    s.vel.y = 0;
    s.onGround = true;
  }

  // --- Orientación del personaje ---
  s.speed = Math.hypot(s.vel.x, s.vel.z);
  if (input.aiming) {
    s.yaw = dampAngle(s.yaw, input.camYaw, PLAYER.turnRate * 2, dt);
  } else if (s.speed > 0.3 && wishLen > 0.1) {
    s.yaw = dampAngle(s.yaw, yawFromDir(wishX, wishZ), PLAYER.turnRate, dt);
  }
}

