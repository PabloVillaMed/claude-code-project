// Subir y bajar de un vehículo con animación (lógica pura, sin three.js):
// dónde se para el personaje, cuándo abre la puerta, se sienta, se desliza
// al puesto del conductor o se levanta. game/boarding.js ejecuta el plan
// (mueve la raíz del personaje y dispara los gestos del rig).
//
// Coordenadas locales del vehículo: x a la derecha, z hacia atrás (el frente
// es -Z), y hacia arriba desde el piso. yaw 0 = mirando al frente; positivo =
// girando a la izquierda (hacia -X), como rotation.y de three.js.
//
// Un plan es { keys, events, total, side, final }:
//   keys: [{t, x, y, z, yaw, walk?, ...}] pose de la raíz; entre dos claves se
//         interpola (walk: el tramo se camina, con la base de locomoción, con
//         arranque / frenada suaves `acc` / `dec` (s) y girando mientras
//         camina: `travel` es el rumbo de la marcha, al que llega en `tin` s,
//         y en los últimos `tout` s gira hacia `yaw`). `chan` da los canales
//         extra del tramo (ver poseAt): 'sit' / 'unsit' (peso de la postura
//         sentada), 'mount' / 'dismount' (moto: pierna por encima del asiento,
//         peso y la moto que se inclina hacia el que se monta).
//         Dos claves con el mismo t son un salto (al aplicar el desplazamiento
//         de cadera de un gesto: el cuerpo ya estaba allá).
//   events: [{t, type: 'play' | 'commit' | 'seat', ...}] en orden.
//   final: pose de la raíz al terminar (exit: donde queda de pie).

export const BOARD = {
  walk: 2.2, // m/s al acercarse a la puerta
  maxApproach: 1.2, // s como máximo caminando hacia la puerta (sin contar arranque y frenada)
  walkAccel: 0.25, // s para pasar de quieto a caminar (y no arrancar de una a 2,2 m/s)
  walkDecel: 0.3, // s frenando al llegar
  turnWalk: 0.5, // s girando hacia donde va mientras arranca a caminar
  arriveTurn: 0.45, // s antes de llegar en que gira hacia la puerta (o el frente de la moto)
  pivotFree: 1.4, // rad: un giro hasta de esto se hace caminando; lo que pase, en el sitio
  pivotRate: 4, // rad/s girando en el sitio (el exceso de un giro grande)
  doorSpeed: 2, // velocidad del gesto de abrir la puerta
  sitSpeed: 2.1, // ... de sentarse
  standSpeed: 1.8, // ... de levantarse
  step: 0.6, // s del paso de la puerta al arranque de sentarse (girando al frente)
  slide: 0.55, // s deslizándose al puesto (o al borde, al bajarse)
  crossSlide: 0.95, // s cruzando del puesto del copiloto al del conductor
  unsit: 0.35, // s en que la postura del carro pasa a la del gesto de levantarse
  mount: 1.25, // s montándose en la moto (pierna por encima del asiento; v3.5: 1,1)
  dismount: 1.15, // s bajándose de la moto (v3.5: 1,05)
  mountLag: 0.22, // fracción del montarse antes de que la cadera empiece a pasar al asiento
  motoLean: 0.07, // rad que la moto se inclina hacia el que se monta (o se baja)
  carRock: 0.022, // rad que el carro se hunde del lado de la puerta al sentarse / levantarse
  stepOut: 0.25, // m del paso hacia afuera ya de pie junto al carro (queda libre de la carrocería)
  stepOutSpeed: 1.4, // m/s de ese paso (y del de la moto)
  motoStepX: 0.95, // m del eje de la moto a donde queda de pie tras bajarse
  motoStepBack: 0.3, // m hacia atrás de ese paso
  motoStepTurn: 0.7, // rad que gira hacia afuera en ese paso
};

// Montarse / bajarse de la moto: camino del tobillo de la pierna que pasa por
// encima (mountLegPath), en el marco del vehículo. Sale del pie animado (de
// pie junto a la moto), sube de lado con la rodilla doblada hacia adelante y
// arriba (como quien pasa una valla), cruza justo detrás de la nalga sobre lo
// más alto de la moto en ese punto (ride.pass de render/vehicleMesh.js: la
// parte de atrás del sillín, delante del baúl o de la caja) y baja al otro
// lado a la estribera. El sillín (0,9-1 m) queda más alto que la cadera de
// pie (~0,86 m): como en una moto alta de verdad, el pie de apoyo se sube
// primero a su estribera y la cadera sube con él (mountStep); así el pie pasa
// a la altura de la cadera y no por encima ni por detrás de la espalda. El
// torso se echa hacia el manubrio. Al bajarse, el mismo camino al revés.
// Claves en lift = 0, rise, over, 0,5 (cumbre), drop y 1, interpoladas con cúbicas
// monótonas por componente (sin pasarse de las claves ni dar vueltas); el polo
// de la rodilla también va por claves (no por pesos que se cruzan: la rodilla
// daba media vuelta en un cuadro).
export const MOUNT_LEG = {
  clear: 0.12, // m del tobillo sobre lo más alto de la moto en el paso (con el pie hacia abajo, la punta queda ~4 cm por encima)
  rise: 0.28, // lift de la clave de subida
  riseIn: 0.25, // fracción del camino lateral (del pie al eje) hecha en la clave de subida (de lado, por fuera del sillín)
  riseH: 0.72, // fracción de la altura (del pie a la cumbre) hecha en la clave de subida (sube antes de cruzar)
  riseBack: 1, // fracción del camino hacia atrás (del pie al paso) hecha en la clave de subida
  over: 0.4, // lift de la clave en que el pie llega al borde del sillín ...
  overX: 0.17, // ... a esta distancia (m) del eje ...
  overDown: 0.03, // ... ya casi a la altura de la cumbre (m por debajo): no roza el borde del sillín
  drop: 0.72, // lift de la clave de bajada
  dropX: 0.34, // m del eje al otro lado en la clave de bajada (libra el costado del sillín)
  dropDown: 0.1, // m que ya bajó el tobillo desde la cumbre en la clave de bajada
  dropFwd: 0.45, // fracción del camino de la cumbre a la estribera hecha hacia adelante en la bajada
  reach: 0.22, // m mínimos de la cadera al tobillo (más cerca la rodilla se dobla del todo y gira de golpe): si no, el tobillo se corre hacia el lado al que va
  blendIn: 0.12, // lift en que la pierna pasa de la animación al camino (sin salto al arrancar)
  // Hacia dónde apunta la rodilla (polo de la IK: [x hacia el lado al que va
  // el pie, y arriba, z atrás]) en las claves de subida, cumbre y bajada; de
  // pie, al frente, y al final, la de manejo. Cambia poco a poco (sin vueltas):
  kneeRise: [0, 0.25, -1], // al frente: el talón sube hacia la nalga
  kneeApex: [0.3, 0.6, -0.75], // al frente y arriba, algo abierta: la rodilla pasa sobre el tanque
  kneeDrop: [0.3, 0.35, -0.85], // al frente, hacia el tanque
  toeIn: 0.25, // lift en que el pie pasa a ir suelto (la punta hacia atrás y un poco abajo, no clavada en el sillín) ...
  toeOut: 0.8, // ... y en que vuelve a apoyarse
  bodyLean: 0.85, // torso hacia el manubrio a mitad del montarse (fracción de la inclinación de manejo) ...
  extraBend: 0.22, // ... y rad de más hacia adelante (la espalda baja y la pierna pasa por detrás de la nalga)
  hipRise: 0.26, // m que sube la cadera con el pie de apoyo en la estribera
  stepFrom: 0.03, // lift en que el pie de apoyo empieza a subirse a la estribera ...
  stepFull: 0.26, // ... y en que ya está arriba (al bajarse, al revés)
  hipFollow: 0.5, // la cadera pasa al centro con el peso (0: a ritmo parejo; 1: con el asiento)
};

/** Cuánto está el pie de apoyo subido a su estribera (0..1) en `lift`. */
export function mountStep(lift) {
  return smooth(clamp01((lift - MOUNT_LEG.stepFrom) / (MOUNT_LEG.stepFull - MOUNT_LEG.stepFrom)));
}

const _U = [0, 0, 0, 0.5, 0, 1]; // claves del tobillo
const _K = [0, 0, 0, 0, 0, 0];
const _UP = [0, 0, 0.5, 0, 1]; // claves del polo de la rodilla
const _KP = [0, 0, 0, 0, 0];

/** Cúbica monótona (Fritsch-Carlson) por las claves (us, vs), con pendiente 0 en los extremos. */
function pchip(us, vs, u) {
  const n = us.length;
  let i = 0;
  while (i < n - 2 && u > us[i + 1]) i++;
  const slope = (k) => {
    if (k === 0 || k === n - 1) return 0;
    const h0 = us[k] - us[k - 1];
    const h1 = us[k + 1] - us[k];
    const d0 = (vs[k] - vs[k - 1]) / h0;
    const d1 = (vs[k + 1] - vs[k]) / h1;
    if (d0 * d1 <= 0) return 0;
    const w1 = 2 * h1 + h0;
    const w2 = h1 + 2 * h0;
    return (w1 + w2) / (w1 / d0 + w2 / d1);
  };
  const h = us[i + 1] - us[i];
  const t = clamp01((u - us[i]) / h);
  const m0 = slope(i) * h;
  const m1 = slope(i + 1) * h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * vs[i] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * vs[i + 1] + (t3 - t2) * m1;
}

/**
 * Tobillo de la pierna que pasa por encima de la moto en `lift` (0 de pie …
 * 1 sentado), en el marco del vehículo. `rest`: tobillo animado de pie junto
 * a la moto; `peg`: tobillo en la estribera (o en el piso); `pass`: {z, y} del
 * paso; `side`: lado del personaje (-1 / 1; el pie termina en -side);
 * `hip` (opcional): cadera de esa pierna, de la que el tobillo se mantiene a
 * MOUNT_LEG.reach m como mínimo. Devuelve `out` = {x, y, z, w (peso de la IK), knee (0..1: pie suelto),
 * px, py, pz (polo de la rodilla)}.
 */
export function mountLegPath(rest, peg, pass, side, lift, out = {}, hip = null) {
  const M = MOUNT_LEG;
  const L = clamp01(lift);
  const apex = pass.y + M.clear;
  _U[1] = M.rise;
  _U[2] = M.over;
  _U[4] = M.drop;
  _K[0] = rest.x;
  _K[1] = rest.x * (1 - M.riseIn);
  _K[2] = side * M.overX;
  _K[3] = 0;
  _K[4] = -side * M.dropX;
  _K[5] = peg.x;
  out.x = pchip(_U, _K, L);
  _K[0] = rest.y;
  _K[1] = rest.y + (apex - rest.y) * M.riseH;
  _K[2] = apex - M.overDown;
  _K[3] = apex;
  _K[4] = apex - M.dropDown;
  _K[5] = peg.y;
  out.y = pchip(_U, _K, L);
  _K[0] = rest.z;
  _K[1] = rest.z + (pass.z - rest.z) * M.riseBack;
  _K[2] = pass.z;
  _K[3] = pass.z;
  _K[4] = pass.z + (peg.z - pass.z) * M.dropFwd;
  _K[5] = peg.z;
  out.z = pchip(_U, _K, L);
  if (hip) {
    // Lejos de la cadera: el tobillo se corre de lado (hacia donde va, nunca
    // hacia atrás ni adelante: ahí la rodilla daría la vuelta) hasta MOUNT_LEG.reach.
    const dy = out.y - hip.y;
    const dz = out.z - hip.z;
    const r2 = M.reach * M.reach - dy * dy - dz * dz;
    if (r2 > 0) out.x = side < 0 ? Math.max(out.x, hip.x + Math.sqrt(r2)) : Math.min(out.x, hip.x - Math.sqrt(r2));
  }
  out.w = smooth(clamp01(L / M.blendIn));
  out.knee = Math.min(smooth(clamp01(L / M.toeIn)), smooth(clamp01((1 - L) / (1 - M.toeOut))));
  // Polo de la rodilla (en el marco del vehículo; sin normalizar).
  const sw = -side;
  _UP[1] = M.rise;
  _UP[3] = M.drop;
  _KP[0] = 0;
  _KP[1] = M.kneeRise[0] * sw;
  _KP[2] = M.kneeApex[0] * sw;
  _KP[3] = M.kneeDrop[0] * sw;
  _KP[4] = side * 0.12;
  out.px = pchip(_UP, _KP, L);
  _KP[0] = -0.1;
  _KP[1] = M.kneeRise[1];
  _KP[2] = M.kneeApex[1];
  _KP[3] = M.kneeDrop[1];
  _KP[4] = 0.2;
  out.py = pchip(_UP, _KP, L);
  _KP[0] = -1;
  _KP[1] = M.kneeRise[2];
  _KP[2] = M.kneeApex[2];
  _KP[3] = M.kneeDrop[2];
  _KP[4] = -1;
  out.pz = pchip(_UP, _KP, L);
  return out;
}

const HALF_PI = Math.PI / 2;

/** Vector hacia donde mira un yaw (plano x-z del vehículo). */
export function facing(yaw) {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** Rota un desplazamiento del marco de la raíz (dx a la derecha, dz hacia atrás) por yaw. */
export function rotate(dx, dz, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: dx * c + dz * s, z: -dx * s + dz * c };
}

/** Pose de destino tras aplicar el final de un clip con desplazamiento de cadera. */
export function applyEnd(pose, end) {
  const d = rotate(end.dx, end.dz, pose.yaw);
  return { x: pose.x + d.x, y: pose.y, z: pose.z + d.z, yaw: pose.yaw + end.dyaw };
}

/** Diferencia angular más corta b - a. */
export function angleDiff(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/** Raíz del conductor sentado (como Game/world.js: asiento - 0.5, +0.35 en moto). */
export function seatRoot(seat, moto = false) {
  return { x: seat.x, y: seat.y - 0.5 + (moto ? 0.35 : 0), z: seat.z, yaw: 0 };
}

/**
 * Altura de partida de los pies en el marco del vehículo (`from.y`: en el
 * andén o en una pendiente no coincide con el piso del vehículo); al caminar a
 * la puerta baja a 0. Acotada por si viene de muy arriba o de muy abajo.
 */
export function startY(from) {
  return Math.max(-0.5, Math.min(0.5, from.y ?? 0));
}

/** Lado por el que se sube: el del personaje (-1 izquierda, +1 derecha). */
export function entrySide(from) {
  return from.x > 0 ? 1 : -1;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (k) => k * k * (3 - 2 * k);

/**
 * Avance (0..1) y rapidez (fracción/s) de un tramo de T s que arranca en ta s
 * y frena en td s (perfil trapezoidal: la rapidez no salta).
 */
export function ramp(tau, T, ta, td) {
  if (ta + td > T) {
    const f = T / (ta + td);
    ta *= f;
    td *= f;
  }
  const vmax = 1 / Math.max(1e-6, T - ta / 2 - td / 2);
  if (tau <= 0) return { s: 0, v: ta > 0 ? 0 : vmax };
  if (tau >= T) return { s: 1, v: td > 0 ? 0 : vmax };
  if (tau < ta) return { s: (0.5 * vmax * tau * tau) / ta, v: (vmax * tau) / ta };
  if (tau <= T - td) return { s: vmax * (tau - ta / 2), v: vmax };
  const r = T - tau;
  return { s: 1 - (0.5 * vmax * r * r) / td, v: (vmax * r) / td };
}

class PlanBuilder {
  constructor(start) {
    this.t = 0;
    this.keys = [{ t: 0, ...start }];
    this.events = [];
  }

  get pose() {
    const k = this.keys[this.keys.length - 1];
    return { x: k.x, y: k.y, z: k.z, yaw: k.yaw };
  }

  /** Lleva la raíz a `to` en `dur` s (`extra`: walk, acc, dec, travel, tin, tout, chan, side). */
  to(to, dur, walk = false, extra = null) {
    this.t += Math.max(0, dur);
    this.keys.push({ t: this.t, ...this.pose, ...to, walk, ...extra });
    return this;
  }

  /** Salto instantáneo de la raíz (desplazamiento de cadera ya recorrido por el gesto). */
  jump(to) {
    this.keys.push({ t: this.t, ...this.pose, ...to });
    return this;
  }

  event(type, data = {}) {
    this.events.push({ t: this.t, type, ...data });
    return this;
  }

  wait(dur, extra = null) {
    return this.to({}, dur, false, extra);
  }

  /**
   * Camina (en línea recta, pasando por `via`) hasta `p`: arranca y frena
   * suave, gira hacia donde va mientras arranca (solo el exceso de un giro
   * muy grande se hace en el sitio) y, si se da `endYaw`, llega ya girando
   * hacia allá (hacia la puerta) en vez de girar al llegar.
   */
  walkTo(p, speed, maxTime, via = [], endYaw = null) {
    const pts = [...via, p];
    let first = true;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i];
      const last = i === pts.length - 1;
      const cur = this.pose;
      const d = Math.hypot(q.x - cur.x, q.z - cur.z);
      if (d < 0.08) {
        // Ya está ahí: solo gira (si hace falta) hacia donde debe quedar.
        if (last && endYaw != null) {
          const turn = Math.abs(angleDiff(cur.yaw, endYaw));
          if (turn > 0.02) this.to({ yaw: cur.yaw + angleDiff(cur.yaw, endYaw) }, Math.max(0.2, turn / BOARD.pivotRate));
        }
        continue;
      }
      const travel = Math.atan2(-(q.x - cur.x), -(q.z - cur.z));
      const turn = angleDiff(cur.yaw, travel);
      const acc0 = first ? BOARD.walkAccel : 0;
      const dec0 = last ? BOARD.walkDecel : 0;
      const dur0 = Math.min(maxTime, d / speed) + (acc0 + dec0) / 2;
      if (last && endYaw != null && dur0 < BOARD.turnWalk + BOARD.arriveTurn) {
        // Tramo corto (un par de pasos): no da para girar hacia donde va y
        // luego hacia la puerta; da los pasos girando de una vez hacia allá.
        const tEnd = angleDiff(cur.yaw, endYaw);
        this.to({ x: q.x, y: 0, z: q.z, yaw: cur.yaw + tEnd }, Math.max(dur0, (Math.abs(tEnd) / BOARD.pivotRate) * 1.5), true, { acc: acc0, dec: dec0 });
        first = false;
        continue;
      }
      if (Math.abs(turn) > BOARD.pivotFree) {
        const ex = turn - Math.sign(turn) * BOARD.pivotFree;
        this.to({ yaw: cur.yaw + ex }, Math.abs(ex) / BOARD.pivotRate);
      }
      const yaw0 = this.pose.yaw;
      const tr = yaw0 + angleDiff(yaw0, travel);
      const acc = first ? BOARD.walkAccel : 0;
      const dec = last ? BOARD.walkDecel : 0;
      const dur = Math.min(maxTime, d / speed) + (acc + dec) / 2;
      const end = last && endYaw != null ? tr + angleDiff(tr, endYaw) : tr;
      this.to({ x: q.x, ...(last ? { y: 0 } : null), z: q.z, yaw: end }, dur, true, { acc, dec, travel: tr, tin: BOARD.turnWalk, tout: last && endYaw != null ? BOARD.arriveTurn : 0 });
      first = false;
    }
    return this;
  }

  build(extra = {}) {
    return { keys: this.keys, events: this.events, total: this.t, ...extra };
  }
}

/**
 * Plan para subirse a manejar un carro. `car` = {width, length, seat: {x, y, z}};
 * `from` = {x, z, yaw} del personaje en el marco del vehículo; `clips` =
 * {door, sit, sitL} con {duration, end: {dx, dz, dyaw}} (SkinnedRig.clipInfo:
 * abrir la puerta, sentarse girando a la izquierda / a la derecha).
 */
export function carEntryPlan(car, from, clips, opts = {}) {
  const side = opts.side ?? entrySide(from);
  const W2 = car.width / 2;
  const L2 = (car.length ?? 4) / 2;
  const hurry = opts.hurry ? 1.35 : 1;
  const sit = side < 0 ? clips.sit : clips.sitL;
  const b = new PlanBuilder({ x: from.x, y: startY(from), z: from.z, yaw: from.yaw ?? 0 });
  // Cadera al terminar de sentarse: sobre el borde del asiento, del lado de la puerta.
  const H = { x: side * (W2 - 0.2), z: car.seat.z };
  // Arranque de sentarse (mirando al frente): H menos el desplazamiento del clip.
  const S0 = { x: H.x - sit.end.dx, y: 0, z: H.z - sit.end.dz, yaw: 0 };
  // Puerta: afuera, mirando al carro y algo hacia el frente (la manija queda
  // al alcance de la mano); el gesto avanza medio paso hacia la puerta.
  const doorYaw = side * (HALF_PI - 0.5);
  const D1 = { x: side * (W2 + 0.42), z: S0.z };
  const doorEnd = clips.door?.end ?? { dx: 0, dz: 0, dyaw: 0 };
  const dd = rotate(doorEnd.dx, doorEnd.dz, doorYaw);
  const D = { x: D1.x - dd.x, z: D1.z - dd.z };
  // Si viene de adelante o de atrás, primero rodea la esquina.
  const via = [];
  if (Math.abs(from.x) < W2 + 0.3 && Math.abs(from.z) > L2 - 0.2) via.push({ x: side * (W2 + 0.55), z: Math.sign(from.z) * (L2 + 0.1) });
  // Llega a la puerta ya girando hacia ella.
  b.walkTo(D, BOARD.walk * hurry, BOARD.maxApproach, via, doorYaw);
  if (clips.door) {
    const sp = BOARD.doorSpeed * hurry;
    // hold: el gesto se queda en su último cuadro hasta el commit (si se
    // acabara antes, la cadera volvería al reposo y luego saltaría).
    b.event('play', { clip: 'door', speed: sp, fadeIn: 0.22, hold: true });
    b.wait(clips.door.duration / sp);
    if (clips.door.end) b.event('commit').jump(applyEnd(b.pose, doorEnd));
  }
  // Paso hasta el arranque de sentarse, girando al frente (arranca y frena suave).
  const st = BOARD.step / hurry;
  b.to({ x: S0.x, z: S0.z, yaw: b.pose.yaw + angleDiff(b.pose.yaw, 0) }, st, true, { acc: st / 2, dec: st / 2 });
  const sp = BOARD.sitSpeed * hurry;
  b.event('play', { clip: side < 0 ? 'sit' : 'sitL', speed: sp, fadeIn: 0.2, hold: true });
  b.wait(sit.duration / sp);
  b.event('commit').jump(applyEnd(b.pose, sit.end));
  // Ya sentado: se desliza (y gira) hasta el puesto del conductor; la postura
  // del carro entra a la par y el carro se hunde un poco del lado de la puerta.
  b.event('seat', { driving: 'car' });
  const seat = seatRoot(car.seat);
  b.to(seat, side < 0 ? BOARD.slide : BOARD.crossSlide, false, { chan: 'sit', side });
  return b.build({ side, final: seat });
}

/**
 * Plan para bajarse de un carro por el lado `side` (-1 izquierda / conductor).
 * `clips.stand` = {duration, end} (levantarse hacia delante).
 */
export function carExitPlan(car, clips, side = -1) {
  const W2 = car.width / 2;
  const seat = seatRoot(car.seat);
  const b = new PlanBuilder(seat);
  b.event('seat', { driving: 'car', handsFree: true });
  // Sentado de lado en el borde, mirando hacia afuera.
  const edge = { x: side * (W2 - 0.15), y: 0, z: car.seat.z, yaw: -side * HALF_PI };
  const slide = side < 0 ? BOARD.slide : BOARD.crossSlide;
  b.to(edge, slide);
  const sp = BOARD.standSpeed;
  // Levantarse: el gesto entra encima de la postura sentada mientras la del
  // carro (más alta, para verse por la ventana) se va; ya tapada, la base
  // deja de ser la del carro.
  b.event('play', { clip: 'stand', speed: sp, fadeIn: BOARD.unsit, hold: true });
  const dur = clips.stand.duration / sp;
  const un = Math.min(BOARD.unsit, dur * 0.5);
  b.wait(un, { chan: 'unsit', side });
  b.event('seat', { driving: null });
  b.wait(dur - un);
  const up = applyEnd(b.pose, clips.stand.end);
  b.event('commit').jump(up);
  // Un paso hacia afuera: de pie queda a un lado de la puerta, sin que el
  // cuerpo (radio del jugador) toque el carro (si no, la física lo empujaría).
  const out = facing(up.yaw);
  b.walkTo({ x: up.x + out.x * BOARD.stepOut, z: up.z + out.z * BOARD.stepOut }, BOARD.stepOutSpeed, BOARD.maxApproach, [], up.yaw);
  return b.build({ side, final: b.pose });
}

/** Montarse en la moto por un lado (la pierna de afuera pasa por encima del asiento). */
export function motoEntryPlan(moto, from, opts = {}) {
  const side = entrySide(from);
  const hurry = opts.hurry ? 1.35 : 1;
  const M = { x: side * 0.62, z: moto.seat.z + 0.05 };
  const b = new PlanBuilder({ x: from.x, y: startY(from), z: from.z, yaw: from.yaw ?? 0 });
  // Llega al lado de la moto ya mirando al frente.
  b.walkTo(M, BOARD.walk * hurry, BOARD.maxApproach, [], 0);
  // plant: x del pie de apoyo (el de afuera, a 10 cm del eje del cuerpo).
  b.event('seat', { driving: 'moto', mount: true, side, plant: M.x + side * 0.1 });
  const seat = seatRoot(moto.seat, true);
  b.to(seat, BOARD.mount / hurry, false, { chan: 'mount', side });
  b.event('seat', { driving: 'moto', mount: false });
  return b.build({ side, final: seat });
}

/** Bajarse de la moto por la izquierda (o por la derecha si está bloqueado). */
export function motoExitPlan(moto, side = -1) {
  const seat = seatRoot(moto.seat, true);
  const b = new PlanBuilder(seat);
  const D = { x: side * 0.7, y: 0, z: moto.seat.z + 0.05, yaw: 0 };
  b.event('seat', { driving: 'moto', mount: true, side, plant: D.x + side * 0.1 });
  b.to(D, BOARD.dismount, false, { chan: 'dismount', side });
  b.event('seat', { driving: null, mount: false });
  // Un paso atrás y afuera, girando un poco hacia afuera: libre de la moto.
  b.walkTo({ x: side * BOARD.motoStepX, z: D.z + BOARD.motoStepBack }, BOARD.stepOutSpeed, BOARD.maxApproach, [], -side * BOARD.motoStepTurn);
  return b.build({ side, final: b.pose });
}

/**
 * Pose de la raíz en el instante t: {x, y, z, yaw, speed, walk, k (0..1 del
 * tramo)}. `speed` es la rapidez del tramo (para la base de locomoción). Con
 * canales (`chan` de la clave), además: `seat` (0 de pie … 1 sentado: peso de
 * la postura del vehículo), `lift` (0..1: la pierna pasa por encima del
 * asiento de la moto; arriba en 0,5), `tilt` (rad de inclinación del vehículo,
 * positivo = se hunde el lado izquierdo) y `side` (lado del personaje).
 */
export function poseAt(plan, t) {
  const K = plan.keys;
  if (t <= K[0].t) return { ...pick(K[0]), speed: 0, walk: false, k: 0 };
  let i = 0;
  while (i < K.length - 1 && K[i + 1].t <= t) i++;
  if (i >= K.length - 1) return { ...pick(K[K.length - 1]), speed: 0, walk: false, k: 1, ...chanAt(K[K.length - 1], 1, 1) };
  const a = K[i];
  const b = K[i + 1];
  const span = b.t - a.t;
  const k = span > 0 ? (t - a.t) / span : 1;
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  let e;
  let speed = 0;
  let yaw;
  if (b.walk) {
    // Caminando: arranque y frenada suaves; gira mientras camina.
    const r = ramp(t - a.t, span, b.acc ?? 0, b.dec ?? 0);
    e = r.s;
    speed = r.v * dist;
    yaw = walkYaw(a, b, t - a.t, span);
  } else {
    e = smooth(k); // los deslizamientos arrancan y frenan suave
    yaw = a.yaw + angleDiff(a.yaw, b.yaw) * e;
  }
  const out = {
    x: a.x + (b.x - a.x) * e,
    y: a.y + (b.y - a.y) * e,
    z: a.z + (b.z - a.z) * e,
    yaw,
    speed,
    walk: !!b.walk,
    k,
  };
  const c = chanAt(b, k, e);
  if (c) {
    Object.assign(out, c);
    // Moto: la cadera pasa al centro en parte con el peso (MOUNT_LEG.hipFollow).
    if (c.lift != null) {
      const f = e + ((b.chan === 'mount' ? c.seat : 1 - c.seat) - e) * MOUNT_LEG.hipFollow;
      out.x = a.x + (b.x - a.x) * f;
    }
    // Moto: la raíz sube (o baja) con el peso puesto en el asiento, no antes
    // (el pie de apoyo sigue en el piso mientras la pierna pasa por encima).
    if (b.chan === 'mount') out.y = a.y + (b.y - a.y) * c.seat;
    else if (b.chan === 'dismount') out.y = b.y + (a.y - b.y) * c.seat;
  }
  return out;
}

/** Rumbo de un tramo caminado: hacia `travel` en `tin` s y, al final, hacia `yaw` en `tout` s. */
function walkYaw(a, b, tau, T) {
  if (b.travel == null) return a.yaw + angleDiff(a.yaw, b.yaw) * smooth(clamp01(tau / T));
  let tin = b.tin ?? 0;
  let tout = b.tout ?? 0;
  if (tin + tout > T) {
    const f = T / (tin + tout);
    tin *= f;
    tout *= f;
  }
  // (Sin giro al final, travel es el yaw de llegada.)
  let yaw = a.yaw + angleDiff(a.yaw, b.travel) * (tin > 0 ? smooth(clamp01(tau / tin)) : 1);
  if (tout > 0) yaw += angleDiff(yaw, b.yaw) * smooth(clamp01((tau - (T - tout)) / tout));
  return yaw;
}

/** Canales de un tramo con `chan` (ver poseAt) en el avance k (e: avance suavizado). */
export function chanAt(key, k, e) {
  const ch = key.chan;
  if (!ch) return null;
  const side = key.side ?? -1;
  const bell = Math.sin(Math.PI * k);
  if (ch === 'sit') return { seat: e, tilt: -side * BOARD.carRock * bell, side };
  if (ch === 'unsit') return { seat: 1 - e, tilt: -side * BOARD.carRock * bell, side };
  const lag = BOARD.mountLag;
  if (ch === 'mount') return { seat: smooth(clamp01((k - lag) / (1 - lag))), lift: k, tilt: -side * BOARD.motoLean * bell, side };
  if (ch === 'dismount') return { seat: 1 - smooth(clamp01(k / (1 - lag))), lift: 1 - k, tilt: -side * BOARD.motoLean * bell, side };
  return null;
}

function pick(k) {
  return { x: k.x, y: k.y, z: k.z, yaw: k.yaw };
}

/** Índice del primer evento aún no disparado tras llegar a t (dispara con `fire`). */
export function fireEvents(plan, index, t, fire) {
  let i = index;
  while (i < plan.events.length && plan.events[i].t <= t) fire(plan.events[i++]);
  return i;
}
