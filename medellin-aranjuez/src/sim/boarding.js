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
//   keys: [{t, x, y, z, yaw, walk?}] pose de la raíz; entre dos claves se
//         interpola (walk: el tramo se camina, con la base de locomoción).
//         Dos claves con el mismo t son un salto (al aplicar el desplazamiento
//         de cadera de un gesto: el cuerpo ya estaba allá).
//   events: [{t, type: 'play' | 'commit' | 'seat', ...}] en orden.
//   final: pose de la raíz al terminar (exit: donde queda de pie).

export const BOARD = {
  walk: 2.2, // m/s al acercarse a la puerta
  maxApproach: 1.2, // s como máximo caminando hacia la puerta
  doorSpeed: 1.6, // velocidad del gesto de abrir la puerta
  sitSpeed: 1.9, // ... de sentarse
  standSpeed: 1.8, // ... de levantarse
  step: 0.32, // s del paso de la puerta al arranque de sentarse
  slide: 0.4, // s deslizándose al puesto (o al borde, al bajarse)
  crossSlide: 0.75, // s cruzando del puesto del copiloto al del conductor
  mount: 0.8, // s montándose en la moto (pierna por encima del asiento)
  dismount: 0.7,
};

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

/** Lado por el que se sube: el del personaje (-1 izquierda, +1 derecha). */
export function entrySide(from) {
  return from.x > 0 ? 1 : -1;
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

  /** Lleva la raíz a `to` en `dur` s. */
  to(to, dur, walk = false) {
    this.t += Math.max(0, dur);
    this.keys.push({ t: this.t, ...this.pose, ...to, walk });
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

  wait(dur) {
    return this.to({}, dur);
  }

  /** Camina (en línea recta, pasando por `via`) hasta `p`, mirando hacia donde va. */
  walkTo(p, speed, maxTime, via = []) {
    for (const q of [...via, p]) {
      const cur = this.pose;
      const d = Math.hypot(q.x - cur.x, q.z - cur.z);
      if (d < 0.08) continue;
      const yaw = Math.atan2(-(q.x - cur.x), -(q.z - cur.z));
      const turn = Math.abs(angleDiff(cur.yaw, yaw));
      if (turn > 0.35) this.to({ yaw: cur.yaw + angleDiff(cur.yaw, yaw) }, Math.min(0.25, turn * 0.12));
      this.to({ x: q.x, z: q.z }, Math.min(maxTime, d / speed), true);
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
  const b = new PlanBuilder({ x: from.x, y: 0, z: from.z, yaw: from.yaw ?? 0 });
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
  b.walkTo(D, BOARD.walk * hurry, BOARD.maxApproach, via);
  const cur = b.pose;
  b.to({ yaw: cur.yaw + angleDiff(cur.yaw, doorYaw) }, Math.min(0.3, Math.abs(angleDiff(cur.yaw, doorYaw)) * 0.2));
  if (clips.door) {
    const sp = BOARD.doorSpeed * hurry;
    b.event('play', { clip: 'door', speed: sp, fadeIn: 0.15 });
    b.wait(clips.door.duration / sp);
    if (clips.door.end) b.event('commit').jump(applyEnd(b.pose, doorEnd));
  }
  // Paso hasta el arranque de sentarse, de frente.
  b.to({ x: S0.x, z: S0.z, yaw: 0 }, BOARD.step / hurry, true);
  const sp = BOARD.sitSpeed * hurry;
  b.event('play', { clip: side < 0 ? 'sit' : 'sitL', speed: sp, fadeIn: 0.12, hold: true });
  b.wait(sit.duration / sp);
  b.event('commit').jump(applyEnd(b.pose, sit.end));
  // Ya sentado: se desliza (y gira) hasta el puesto del conductor.
  b.event('seat', { driving: 'car' });
  const seat = seatRoot(car.seat);
  b.to(seat, side < 0 ? BOARD.slide : BOARD.crossSlide);
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
  b.event('seat', { driving: null });
  const sp = BOARD.standSpeed;
  b.event('play', { clip: 'stand', speed: sp, instant: true, hold: true });
  b.wait(clips.stand.duration / sp);
  const final = applyEnd(b.pose, clips.stand.end);
  b.event('commit').jump(final);
  return b.build({ side, final });
}

/** Montarse en la moto por un lado (pierna derecha por encima del asiento). */
export function motoEntryPlan(moto, from) {
  const side = entrySide(from);
  const M = { x: side * 0.62, z: moto.seat.z + 0.05 };
  const b = new PlanBuilder({ x: from.x, y: 0, z: from.z, yaw: from.yaw ?? 0 });
  b.walkTo(M, BOARD.walk, BOARD.maxApproach);
  const cur = b.pose;
  b.to({ yaw: cur.yaw + angleDiff(cur.yaw, 0) }, Math.min(0.3, Math.abs(angleDiff(cur.yaw, 0)) * 0.2));
  b.event('seat', { driving: 'moto', mount: true });
  const seat = seatRoot(moto.seat, true);
  b.to(seat, BOARD.mount);
  b.event('seat', { driving: 'moto', mount: false });
  return b.build({ side, final: seat });
}

/** Bajarse de la moto por la izquierda (o por la derecha si está bloqueado). */
export function motoExitPlan(moto, side = -1) {
  const seat = seatRoot(moto.seat, true);
  const b = new PlanBuilder(seat);
  b.event('seat', { driving: 'moto', mount: true });
  const final = { x: side * 0.7, y: 0, z: moto.seat.z + 0.05, yaw: 0 };
  b.to(final, BOARD.dismount);
  b.event('seat', { driving: null, mount: false });
  return b.build({ side, final });
}

/**
 * Pose de la raíz en el instante t: {x, y, z, yaw, speed, walk, k (0..1 del
 * tramo)}. `speed` es la rapidez del tramo (para la base de locomoción).
 */
export function poseAt(plan, t) {
  const K = plan.keys;
  if (t <= K[0].t) return { ...pick(K[0]), speed: 0, walk: false, k: 0 };
  let i = 0;
  while (i < K.length - 1 && K[i + 1].t <= t) i++;
  if (i >= K.length - 1) return { ...pick(K[K.length - 1]), speed: 0, walk: false, k: 1 };
  const a = K[i];
  const b = K[i + 1];
  const span = b.t - a.t;
  const k = span > 0 ? (t - a.t) / span : 1;
  const e = b.walk ? k : k * k * (3 - 2 * k); // los deslizamientos arrancan y frenan suave
  return {
    x: a.x + (b.x - a.x) * e,
    y: a.y + (b.y - a.y) * e,
    z: a.z + (b.z - a.z) * e,
    yaw: a.yaw + angleDiff(a.yaw, b.yaw) * e,
    speed: b.walk && span > 0 ? Math.hypot(b.x - a.x, b.z - a.z) / span : 0,
    walk: !!b.walk,
    k,
  };
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
