// Modelo del motor para el sonido: caja de cambios simulada a partir de la
// velocidad, revoluciones con inercia, carga (acelerador en cambio), corte
// del acelerador al cambiar de marcha, limitador de revoluciones y embrague
// que patina al arrancar. La física del vehículo no usa marchas (acelera de
// forma continua); esto solo decide cómo suena. Lógica pura, sin WebAudio.

/**
 * Perfiles de motor. `gears`: fracción de la velocidad máxima a la que cada
 * marcha llega al corte (la última puede pasarse un poco). `cvt`: variador
 * de scooter (sin marchas: las revoluciones suben al arrancar y se quedan
 * casi fijas mientras la velocidad sube). `cyl` y `strokes` definen cuántas
 * explosiones hay por vuelta (el ritmo del sonido).
 */
export const ENGINE_PROFILES = {
  // Moto de calle 4T monocilíndrica de 125-150 cc (el "tucu-tucu" de siempre).
  moto4t: { cyl: 1, strokes: 4, idle: 1450, redline: 9200, limiter: 9600, gears: [0.24, 0.4, 0.57, 0.76, 1.03], shiftTime: 0.13, inertia: 7.5 },
  // 200 cc doble propósito: algo más grave y lenta de revoluciones.
  moto4t_grande: { cyl: 1, strokes: 4, idle: 1350, redline: 8600, limiter: 9000, gears: [0.21, 0.36, 0.52, 0.68, 0.84, 1.03], shiftTime: 0.14, inertia: 6.5 },
  // Dos tiempos: una explosión por vuelta, sube muy rápido y "rin-rin".
  moto2t: { cyl: 1, strokes: 2, idle: 1600, redline: 8800, limiter: 9300, gears: [0.26, 0.44, 0.62, 0.8, 1.03], shiftTime: 0.11, inertia: 9.5 },
  // Scooter automática con variador.
  scooter: { cyl: 1, strokes: 4, idle: 1700, redline: 8200, limiter: 8600, cvt: { engage: 3600, cruise: 6600 }, inertia: 6 },
  // Carros: tres o cuatro cilindros.
  carro_pequeno: { cyl: 3, strokes: 4, idle: 900, redline: 6200, limiter: 6500, gears: [0.19, 0.34, 0.52, 0.72, 1.02], shiftTime: 0.32, inertia: 4.2 },
  carro: { cyl: 4, strokes: 4, idle: 820, redline: 6300, limiter: 6600, gears: [0.18, 0.32, 0.5, 0.7, 1.02], shiftTime: 0.3, inertia: 4 },
  carro_viejo: { cyl: 4, strokes: 4, idle: 780, redline: 5200, limiter: 5500, gears: [0.24, 0.45, 0.72, 1.02], shiftTime: 0.42, inertia: 3.2 },
  camioneta: { cyl: 4, strokes: 4, idle: 760, redline: 5800, limiter: 6100, gears: [0.17, 0.3, 0.46, 0.64, 0.82, 1.02], shiftTime: 0.34, inertia: 3.6 },
  // Buseta diésel de seis cilindros.
  diesel: { cyl: 6, strokes: 4, idle: 650, redline: 2700, limiter: 2850, gears: [0.16, 0.3, 0.48, 0.7, 1.02], shiftTime: 0.55, inertia: 2.2, diesel: true },
};

/** Explosiones por segundo a unas revoluciones dadas. */
export function firingRate(profile, rpm) {
  return (rpm / 60) * profile.cyl * (2 / profile.strokes);
}

export function createEngineState(profileId) {
  const p = ENGINE_PROFILES[profileId] ?? ENGINE_PROFILES.carro;
  return { profile: p, id: profileId, rpm: p.idle, gear: 1, shift: 0, load: 0, cut: false, limiterT: 0, clutch: 0, lastShift: -1 };
}

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/**
 * Revoluciones "enganchadas" a la rueda en una marcha (sin límite inferior).
 * `v` en m/s, `vmax` la velocidad máxima del vehículo.
 */
export function coupledRpm(profile, gear, v, vmax) {
  const top = profile.gears[gear - 1] * vmax;
  return (profile.redline * v) / Math.max(0.1, top);
}

/**
 * Avanza el motor. input = {speed (m/s, valor absoluto), vmax, throttle
 * 0..1, brake 0..1, dt}. Devuelve el estado (rpm, gear, load 0..1, cut: el
 * encendido está cortado por el limitador o el cambio, shifted: se acaba de
 * cambiar de marcha).
 */
export function stepEngine(e, { speed, vmax, throttle, brake = 0, dt }) {
  const p = e.profile;
  const v = Math.abs(speed);
  e.shifted = 0;
  let target;
  let load = throttle;
  if (p.cvt) {
    // Variador: embraga a `engage`; acelerando, las revoluciones se quedan
    // cerca de `cruise` hasta que la relación llega al final (velocidad alta).
    const ratio = clamp(v / vmax, 0, 1);
    const hold = p.cvt.engage + (p.cvt.cruise - p.cvt.engage) * clamp(throttle * 1.4, 0, 1);
    const top = p.idle + (p.redline - p.idle) * ratio;
    target = throttle > 0.05 ? Math.max(hold * (0.75 + 0.25 * ratio), top) : Math.max(p.idle, top * 0.92);
    if (v < 0.4 && throttle < 0.05) target = p.idle;
  } else {
    const n = p.gears.length;
    if (e.shift > 0) {
      e.shift -= dt;
      load = 0;
    } else {
      // Subir de marcha: antes con poco acelerador (manejo tranquilo), al
      // tope con el acelerador a fondo. Bajar cuando se caen las revoluciones.
      const up = p.redline * (0.5 + 0.44 * clamp(throttle, 0, 1));
      const rpmNow = coupledRpm(p, e.gear, v, vmax);
      if (e.gear < n && rpmNow > up && throttle > 0.05) {
        e.gear++;
        e.shift = p.shiftTime;
        e.shifted = 1;
        load = 0;
      } else if (e.gear > 1) {
        const lower = coupledRpm(p, e.gear - 1, v, vmax);
        const down = p.idle * (throttle > 0.5 ? 2.4 : 1.35);
        if (rpmNow < down && lower < p.redline * 0.82) {
          e.gear--;
          e.shifted = -1;
          // Al bajar con el pie afuera (frenando) no hay corte: el motor sube solo.
          if (throttle > 0.05) e.shift = p.shiftTime * 0.6;
        }
      }
    }
    if (v < 0.3 && throttle < 0.05) e.gear = 1;
    const coupled = coupledRpm(p, e.gear, v, vmax);
    // Primera con el embrague patinando: al arrancar el motor no baja de un
    // mínimo que sube con el acelerador (y se puede "acelerar en neutro").
    const launch = p.idle + (p.redline * 0.55 - p.idle) * throttle;
    if (e.gear === 1 && coupled < launch) {
      e.clutch = 1 - coupled / Math.max(1, launch);
      target = launch * (1 - 0.25 * (1 - e.clutch)) + coupled * 0.25 * (1 - e.clutch);
      // Quieto (en neutro) se puede acelerar hasta el limitador.
      if (v < 0.5 && throttle > 0.05) target = p.idle + (p.limiter * 1.03 - p.idle) * throttle;
    } else {
      e.clutch = 0;
      target = Math.max(p.idle, coupled);
    }
    // Durante el cambio el motor cae hacia las revoluciones de la marcha nueva.
    if (e.shift > 0) target = Math.max(p.idle, coupled);
  }
  // Inercia: sube rápido con carga, cae más despacio sin ella.
  // Al cambiar (embrague y acelerador sueltos) caen mucho más rápido.
  const k = (e.shift > 0 ? 3.2 : target > e.rpm ? 0.5 + load : 0.8) * p.inertia;
  e.rpm += (target - e.rpm) * (1 - Math.exp(-k * dt));
  // Limitador: al tocar el corte, se apaga el encendido unas centésimas.
  e.limiterT = Math.max(0, e.limiterT - dt);
  if (e.rpm >= p.limiter && throttle > 0.3) e.limiterT = 0.06;
  if (e.limiterT > 0) e.rpm -= (p.limiter - p.idle) * 0.9 * dt;
  e.rpm = clamp(e.rpm, p.idle * 0.85, p.limiter + 50);
  e.cut = e.shift > 0 || e.limiterT > 0.02;
  // Solo el limitador corta el encendido; al cambiar el motor sigue andando sin carga.
  e.limiting = e.limiterT > 0.02;
  // Carga: acelerador en cambio (la marcha "tira"); frenando con motor, 0.
  e.load = e.cut ? 0 : clamp(load * (1 - 0.5 * e.clutch), 0, 1);
  e.brake = brake;
  return e;
}
