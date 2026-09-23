// Utilidades matemáticas puras (sin dependencias de Three.js) para la simulación.

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Normaliza un ángulo al rango (-PI, PI]. */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Diferencia angular más corta de a hacia b. */
export const angleDiff = (a, b) => wrapAngle(b - a);

/** Amortiguación exponencial independiente del framerate. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export function dampAngle(a, b, lambda, dt) {
  return a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));
}

/** Vector adelante para un yaw (convención Three.js: yaw 0 mira hacia -Z). */
export const forwardX = (yaw) => -Math.sin(yaw);
export const forwardZ = (yaw) => -Math.cos(yaw);
/** Vector derecha para un yaw. */
export const rightX = (yaw) => Math.cos(yaw);
export const rightZ = (yaw) => -Math.sin(yaw);

/** Yaw que mira en la dirección (dx, dz). */
export const yawFromDir = (dx, dz) => Math.atan2(-dx, -dz);

export const dist2D = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
