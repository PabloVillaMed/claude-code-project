// Acomodo de una persona sentada en la silla plástica (utilería
// 'silla_plastica'). Cálculo puro; la piel se mide en render/characterRig.js
// (measureSeat). La silla mira a su +Z y la raíz de quien se sienta queda en
// su origen (world.js, storyDirector.js).

// Medidas del modelo de la silla.
export const CHAIR = {
  seat: 0.447, // alto del asiento
  front: 0.298, // borde de adelante del asiento
  backTop: 0.88,
  /** Cara de adelante del espaldar a la altura `y` (se inclina hacia atrás). */
  back: (y) => -0.203 - 0.2 * (y - 0.5),
};

/**
 * Cuánto subir (dy) y correr hacia delante (dz, negativo = hacia el
 * espaldar) el cuerpo para que las asentaderas queden sobre el asiento, la
 * espalda contra el espaldar sin atravesarlo y las pantorrillas por delante
 * del borde. `fit` = measureSeat(), `s` = escala de esta persona.
 */
export function solveSeat(fit, s) {
  const P = fit.pts;
  let dy = 0;
  let dz = 0;
  for (let it = 0; it < 3; it++) {
    // 1. Altura: lo más bajo de asentaderas y muslos que queda sobre el asiento.
    let bottom = Infinity;
    for (let i = 0; i < P.length; i += 3) {
      const x = P[i] * s;
      const y = P[i + 1] * s;
      const z = P[i + 2] * s + dz;
      if (Math.abs(x) < 0.2 && z > CHAIR.back(CHAIR.seat) + 0.03 && z < CHAIR.front - 0.05 && y > fit.kneeY * s - 0.12 && y < fit.pelvisY * s) bottom = Math.min(bottom, y);
    }
    if (bottom === Infinity) bottom = (fit.pelvisY - 0.19) * s;
    dy = CHAIR.seat - 0.012 - bottom;
    // 2. Adelante / atrás: la espalda apoyada en el espaldar (sin pasarlo) y
    // lo que queda por debajo del asiento (rodillas, pantorrillas), delante del borde.
    let lo = -0.06;
    for (let i = 0; i < P.length; i += 3) {
      const x = Math.abs(P[i] * s);
      const y = P[i + 1] * s + dy;
      const z = P[i + 2] * s;
      if (x < 0.15 && y > CHAIR.seat + 0.03 && y < CHAIR.backTop) lo = Math.max(lo, CHAIR.back(y) + 0.01 - z);
      if (x < 0.22 && z > 0.1 && y > CHAIR.seat - 0.1 && y < CHAIR.seat - 0.015) lo = Math.max(lo, CHAIR.front + 0.01 - z);
    }
    dz = Math.min(lo, 0.12);
  }
  return { dy, dz };
}
