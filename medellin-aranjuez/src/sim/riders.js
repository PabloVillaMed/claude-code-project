// Los que van montados en moto (piloto y parrillero) como blancos de un tiro:
// cabeza y torso donde van sentados, a partir del asiento de la moto
// (vehicleMesh userData.ride: seatY, seatZ), con su inclinación y su rumbo.
// Puro y testeable: game/riders.js lo usa para armar la escena del tiro.

// ------------------------------------------------ medidas (ajustables)
// Medidas del cuerpo sentado, desde la pelvis (que va sobre el asiento), en
// m. Sacadas del esqueleto montado en la moto de la Policía (sonda): pelvis a
// la altura del asiento, centro de la cabeza ~0,72 m más arriba y ~0,14 m más
// adelante (van inclinados sobre el manubrio).
export const RIDER_HIT = {
  headUp: 0.72, // m del centro de la cabeza sobre la pelvis
  headFwd: 0.14, // m de la cabeza por delante de la pelvis
  headR: 0.15, // radio de la cabeza (igual que de pie: sim/ballistics.js BODY)
  torsoBottom: 0.02, // m sobre la pelvis: centro de la esfera de abajo del torso
  torsoTop: 0.32, // m sobre la pelvis: centro de la esfera de arriba (los hombros llegan a ~0,57)
  torsoR: 0.25, // radio del torso
  torsoFwd: 0.06, // m del eje del torso por delante de la pelvis
};

/**
 * Caja de impacto de alguien montado: `out` recibe en coordenadas del mundo
 * el eje del torso (x, z, y0, y1, r) y la cabeza (hx, hy, hz, hr); y = piso.
 * `s` es el estado del vehículo (x, y, z, heading, lean); (py, pz) la pelvis
 * en el marco local de la moto (y arriba desde el piso, z hacia atrás:
 * adelante es -Z). La inclinación gira alrededor de la línea de apoyo de las
 * llantas (+ = hacia la izquierda), como el dibujo (vehicleMesh _fitGround):
 * lo alto se corre a -X local (x' = -y·sen λ) y el rumbo gira (x', z) en Y.
 */
export function riderHitbox(s, py, pz, out = {}) {
  const H = RIDER_HIT;
  const c = Math.cos(s.heading);
  const sn = Math.sin(s.heading);
  const sl = Math.sin(s.lean ?? 0);
  const cl = Math.cos(s.lean ?? 0);
  // Torso: eje vertical a media altura del tronco.
  let xl = -(py + (H.torsoBottom + H.torsoTop) / 2) * sl;
  let zl = pz - H.torsoFwd;
  out.x = s.x + xl * c + zl * sn;
  out.z = s.z - xl * sn + zl * c;
  out.y = s.y;
  out.y0 = s.y + (py + H.torsoBottom) * cl;
  out.y1 = s.y + (py + H.torsoTop) * cl;
  out.r = H.torsoR;
  // Cabeza.
  const hy = py + H.headUp;
  xl = -hy * sl;
  zl = pz - H.headFwd;
  out.hx = s.x + xl * c + zl * sn;
  out.hz = s.z - xl * sn + zl * c;
  out.hy = s.y + hy * cl;
  out.hr = H.headR;
  return out;
}
