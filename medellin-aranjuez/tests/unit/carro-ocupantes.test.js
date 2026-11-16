import { describe, expect, it } from 'vitest';
import { CABINAS, OCUPANTE_HIT, SIN_CONTROL, cabinaDe, looseInput, occupantHitbox, patrolOutcome, rayVsCar, startLoose } from '../../src/sim/carOccupants.js';
import { traceShot } from '../../src/sim/ballistics.js';
import { VEHICLE_TYPES, createVehicleState, stepVehicle } from '../../src/sim/vehiclePhysics.js';
import { flatEnv } from './helpers.js';
import { makeRng } from '../../src/sim/rng.js';

// Dispararle a los que van en carro (sim/carOccupants.js): por los vidrios
// le pega al de adentro, en la lata le pega al carro; y el carro que se queda
// sin control cuando el conductor cae.

// Puestos del conductor medidos en el juego (vehicleMesh seat, marco local).
const PUESTOS = {
  taxi: { x: -0.35, y: 0.39, z: 0.08 },
  hatch_pequeno: { x: -0.34, y: 0.36, z: 0.07 },
  sedan_compacto: { x: -0.39, y: 0.39, z: 0.17 },
  sedan: { x: -0.37, y: 0.36, z: 0.13 },
  hatch_compacto: { x: -0.33, y: 0.32, z: 0.15 },
  clasico: { x: -0.3, y: 0.35, z: -0.29 },
  camioneta: { x: -0.41, y: 0.41, z: 0 },
  suv_compacta: { x: -0.41, y: 0.63, z: 0.09 },
  suv_mediana: { x: -0.42, y: 0.54, z: 0 },
  buseta: { x: -0.66, y: 1.16, z: -3.04 },
};
const TIPO = { taxi: 'taxi', hatch_pequeno: 'sedan', sedan_compacto: 'sedan', sedan: 'sedan', hatch_compacto: 'sedan', clasico: 'sedan', camioneta: 'camioneta', suv_compacta: 'camioneta', suv_mediana: 'camioneta', buseta: 'buseta' };

/** ¿El punto local (x, y, z) está adentro de la cabina? */
const adentro = (cab, x, y, z) => cab.planes.every((p) => p[0] * x + p[1] * y + p[2] * z <= p[3] + 1e-9);

/** Entrada de la escena del tiro para un carro en (x, z) con rumbo h y su conductor (y copiloto). */
function carro(variant, { x = 0, z = 0, heading = 0, copiloto = false, slump = 0 } = {}) {
  const spec = VEHICLE_TYPES[TIPO[variant]];
  const s = { x, y: 0, z, heading };
  const seat = PUESTOS[variant];
  const occ = [{ ref: 'conductor', ...occupantHitbox(s, seat, 1, slump) }];
  if (copiloto) occ.push({ ref: 'copiloto', ...occupantHitbox(s, seat, -1) });
  return { ref: 'carro', obb: { x, z, hx: spec.width / 2, hz: spec.length / 2, angle: heading }, y: 0, height: spec.height, cab: cabinaDe(variant, spec), occ, nOcc: occ.length, seat, s };
}

const env = flatEnv();
const tiro = (car, o, d) => {
  const l = Math.hypot(d.x, d.y, d.z);
  return traceShot(o, { x: d.x / l, y: d.y / l, z: d.z / l }, 100, { collision: env.collision, groundHeight: env.groundHeight, characters: [], vehicles: [car] });
};

describe('cajas de los que van en carro, por modelo', () => {
  for (const variant of Object.keys(PUESTOS)) {
    it(`${variant}: la cabeza va adentro de la cabina, sobre la cintura; el torso, en parte debajo`, () => {
      const cab = cabinaDe(variant, VEHICLE_TYPES[TIPO[variant]]);
      const seat = PUESTOS[variant];
      const hb = occupantHitbox({ x: 0, y: 0, z: 0, heading: 0 }, seat);
      // Rumbo 0: el marco local es el del mundo.
      expect(adentro(cab, hb.hx, hb.hy, hb.hz)).toBe(true);
      expect(hb.hy - hb.hr).toBeGreaterThan(cab.belt - 0.05);
      // (En la buseta, de ventanas grandes, se le ve todo el torso.)
      if (variant !== 'buseta') expect(hb.y0).toBeLessThan(cab.belt);
      expect(hb.y1 + hb.r).toBeGreaterThan(cab.belt - 0.12); // los hombros se asoman (o casi) por la ventana
      // El copiloto: el mismo puesto reflejado.
      const cp = occupantHitbox({ x: 0, y: 0, z: 0, heading: 0 }, seat, -1);
      expect(cp.hx).toBeCloseTo(-hb.hx, 6);
      expect(adentro(cab, cp.hx, cp.hy, cp.hz)).toBe(true);
      // El vidrio lateral queda por fuera del cuerpo (no se sale por la puerta).
      expect(Math.abs(hb.x) + hb.r).toBeLessThan(cab.gx + 0.05);
    });
  }

  it('el parabrisas va inclinado hacia atrás y el techo sobre la cabeza', () => {
    for (const [v, c] of Object.entries(CABINAS)) {
      expect(c.ws[2], v).toBeGreaterThan(c.ws[0]);
      expect(c.ws[3], v).toBeGreaterThanOrEqual(c.ws[1]);
      expect(c.rw[3], v).toBeLessThanOrEqual(c.rw[1]);
      expect(c.roof, v).toBeGreaterThan(c.belt + 0.25);
    }
  });

  it('un modelo sin medir tiene una cabina estimada razonable (la misma para el mismo tamaño)', () => {
    const spec = VEHICLE_TYPES.sedan;
    const a = cabinaDe('modelo_nuevo', spec);
    expect(a).toBe(cabinaDe('otro_nuevo', spec));
    expect(a.belt).toBeGreaterThan(0.8);
    expect(a.roof).toBeLessThanOrEqual(spec.height);
    expect(adentro(a, -0.37, 1.2, 0.1)).toBe(true);
  });

  it('desplomado sobre el timón la cabeza baja y se va adelante', () => {
    const s = { x: 0, y: 0, z: 0, heading: 0 };
    const a = occupantHitbox(s, PUESTOS.sedan);
    const b = occupantHitbox(s, PUESTOS.sedan, 1, 1);
    expect(b.hy).toBeCloseTo(a.hy - OCUPANTE_HIT.slumpDown, 6);
    expect(b.hz).toBeCloseTo(a.hz - OCUPANTE_HIT.slumpFwd, 6); // adelante es -Z
  });
});

describe('tiro por la ventana o en la lata', () => {
  it('por la ventana del conductor a la altura de la cabeza: tiro a la cabeza, por el vidrio', () => {
    const car = carro('sedan');
    const hb = car.occ[0];
    const h = tiro(car, { x: -10, y: hb.hy, z: hb.hz }, { x: 1, y: 0, z: 0 });
    expect(h.kind).toBe('character');
    expect(h.ref).toBe('conductor');
    expect(h.headshot).toBe(true);
    expect(h.glass).toBeTruthy();
    expect(h.glass.x).toBeCloseTo(-car.cab.gx, 2); // el vidrio se rompe en el costado
    expect(h.car).toBe('carro');
  });

  it('a la puerta, debajo de la cintura: le pega al carro (la lata lo protege)', () => {
    const car = carro('sedan');
    const hb = car.occ[0];
    const h = tiro(car, { x: -10, y: car.cab.belt - 0.15, z: hb.z }, { x: 1, y: 0, z: 0 });
    expect(h.kind).toBe('vehicle');
    expect(h.ref).toBe('carro');
    expect(h.glass).toBeFalsy();
    expect(h.x).toBeCloseTo(-VEHICLE_TYPES.sedan.width / 2, 3);
  });

  it('de frente, por el parabrisas: la cabeza; el pecho, desde arriba; por el capó, la lata', () => {
    const car = carro('camioneta');
    const hb = car.occ[0];
    const h = tiro(car, { x: hb.hx, y: hb.hy, z: -12 }, { x: 0, y: 0, z: 1 });
    expect(h.kind).toBe('character');
    expect(h.headshot).toBe(true);
    expect(h.glass).toBeTruthy();
    // El vidrio se rompe en el parabrisas (no en la punta de la caja del carro).
    expect(h.glass.z).toBeGreaterThan(-VEHICLE_TYPES.camioneta.length / 2 + 0.5);
    expect(h.glass.z).toBeLessThan(car.cab.ws[3] + 0.01);
    // Desde arriba y adelante (un segundo piso), por el parabrisas al pecho.
    const o = { x: hb.x, y: 2.6, z: -6 };
    const p = tiro(car, o, { x: 0, y: hb.y1 - o.y, z: hb.z - o.z });
    expect(p.kind).toBe('character');
    expect(p.headshot).toBe(false);
    expect(p.glass).toBeTruthy();
    // Al pecho de frente y derecho: el capó y el motor lo tapan.
    const q = tiro(car, { x: hb.x, y: hb.y1, z: -12 }, { x: 0, y: 0, z: 1 });
    expect(q.kind).toBe('vehicle');
    expect(q.glass).toBeFalsy();
  });

  it('desde arriba, al techo: lata', () => {
    const car = carro('taxi');
    const hb = car.occ[0];
    const h = tiro(car, { x: hb.hx, y: 10, z: hb.hz }, { x: 0, y: -1, z: 0 });
    expect(h.kind).toBe('vehicle');
    expect(h.glass).toBeFalsy();
    expect(h.y).toBeCloseTo(car.cab.roof, 3);
  });

  it('por el vidrio de atrás sin nadie en esa línea: rompe el vidrio y le pega al carro', () => {
    const car = carro('sedan');
    // Por el lado del copiloto (x > 0), desde atrás: no hay nadie sentado ahí.
    const h = tiro(car, { x: 0.4, y: 1.3, z: 12 }, { x: 0, y: 0, z: -1 });
    expect(h.kind).toBe('vehicle');
    expect(h.glass).toBeTruthy();
  });

  it('el copiloto también; y con el carro girado las cuentas siguen', () => {
    const car = carro('suv_mediana', { x: 30, z: -8, heading: Math.PI / 2, copiloto: true });
    const cp = car.occ[1];
    // Rumbo 90°: el carro mira hacia -X; su derecha (el copiloto) queda hacia -Z.
    expect(cp.hz).toBeLessThan(-8);
    const h = tiro(car, { x: cp.hx, y: cp.hy, z: -20 }, { x: 0, y: 0, z: 1 });
    expect(h.kind).toBe('character');
    expect(h.ref).toBe('copiloto');
    expect(h.headshot).toBe(true);
  });

  it('un carro sin nadie: igual que antes por la lata, y vidrio roto por las ventanas', () => {
    const car = { ...carro('sedan'), occ: [], nOcc: 0 };
    const out = {};
    const low = rayVsCar({ x: -10, y: 0.6, z: 0 }, { x: 1, y: 0, z: 0 }, car, 100, out);
    expect(low.kind).toBe('vehicle');
    expect(low.glass).toBe(false);
    const hi = rayVsCar({ x: -10, y: 1.25, z: 0 }, { x: 1, y: 0, z: 0 }, car, 100, out);
    expect(hi.kind).toBe('vehicle');
    expect(hi.glass).toBe(true);
    // Por encima del techo no le pega.
    expect(rayVsCar({ x: -10, y: 1.7, z: 0 }, { x: 1, y: 0, z: 0 }, car, 100, out)).toBe(null);
  });

  it('descarte barato: los carros lejos del tiro o más allá de maxT no cuentan; ningún tiro que cruza la cabina se pierde', () => {
    const out = {};
    const car = carro('sedan', { x: 40, z: 5, heading: 0.7 });
    // De lado (a 20 m de la línea del tiro) y más allá del alcance.
    expect(rayVsCar({ x: 0, y: 1.2, z: 25 }, { x: 1, y: 0, z: 0 }, car, 100, out)).toBe(null);
    expect(rayVsCar({ x: 0, y: 1.2, z: 5 }, { x: 1, y: 0, z: 0 }, car, 30, out)).toBe(null);
    expect(rayVsCar({ x: 0, y: 1.2, z: 5 }, { x: 1, y: 0, z: 0 }, car, 100, out)).not.toBe(null);
    // Rayos al azar que pasan por un punto de adentro de la cabina (o de la lata): siempre le pegan.
    const rng = makeRng(17);
    for (const variant of Object.keys(PUESTOS)) {
      for (let k = 0; k < 60; k++) {
        const h = rng.range(-Math.PI, Math.PI);
        const c = carro(variant, { x: rng.range(-30, 30), z: rng.range(-30, 30), heading: h });
        const lx = rng.range(-0.8, 0.8) * c.cab.gx;
        const lz = rng.range(-0.3, 0.3) * c.obb.hz;
        const ly = rng.range(0.4, c.cab.belt - 0.05);
        // Al mundo (el marco local de rayVsCar: x = px cos - pz sen, z = px sen + pz cos).
        const wx = c.obb.x + lx * Math.cos(h) + lz * Math.sin(h);
        const wz = c.obb.z - lx * Math.sin(h) + lz * Math.cos(h);
        const a = rng.range(-Math.PI, Math.PI);
        const dist = rng.range(5, 60);
        const d = { x: Math.cos(a), y: 0, z: Math.sin(a) };
        const o = { x: wx - d.x * dist, y: ly, z: wz - d.z * dist };
        expect(rayVsCar(o, d, c, 100, out), `${variant} ${k}`).not.toBe(null);
      }
    }
  });

  it('el que está detrás del carro no recibe la bala que pegó en la lata', () => {
    const car = carro('sedan');
    const ped = { ref: 'peaton', x: 3, y: 0, z: 0 };
    const h = traceShot({ x: -10, y: 0.7, z: 0 }, { x: 1, y: 0, z: 0 }, 100, { collision: env.collision, groundHeight: env.groundHeight, characters: [ped], vehicles: [car] });
    expect(h.ref).toBe('carro');
  });
});

describe('conductor muerto: el carro sin control', () => {
  const rodar = (seed, secs = 20, dt = 1 / 60) => {
    const s = createVehicleState('sedan', 0, 0, 0, env.groundHeight);
    s.vx = 0;
    s.vz = -12; // rumbo 0: adelante es -Z
    s.forwardSpeed = 12;
    const lc = startLoose(makeRng(seed).next, 0);
    const input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    let t = 0;
    let stopAt = null;
    for (; t < secs; t += dt) {
      looseInput(lc, s, dt, input);
      stepVehicle(s, input, dt, env);
      if (lc.stopped && stopAt === null) stopAt = t;
    }
    return { s, lc, stopAt };
  };

  it('sigue rodando un trecho, se desvía y para solo', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { s, lc, stopAt } = rodar(seed);
      const recorrido = Math.hypot(s.x, s.z);
      expect(recorrido, `semilla ${seed}`).toBeGreaterThan(8); // no se clava en el sitio
      expect(Math.abs(s.x), `semilla ${seed}`).toBeGreaterThan(1); // se fue de lado
      expect(stopAt, `semilla ${seed}`).not.toBe(null); // paró solo
      expect(Math.abs(s.forwardSpeed)).toBeLessThan(SIN_CONTROL.stopSpeed + 0.05);
      expect(Math.abs(lc.steer)).toBeGreaterThanOrEqual(SIN_CONTROL.steerMin);
    }
  });

  it('el timón llega a lo torcido de a poco (no de golpe) y la bocina a veces queda pegada', () => {
    const lc = startLoose(() => 0.9, 0);
    const s = { forwardSpeed: 10 };
    const out = {};
    looseInput(lc, s, 0.1, out);
    expect(Math.abs(out.steer)).toBeLessThan(Math.abs(lc.steer));
    looseInput(lc, s, SIN_CONTROL.steerRamp, out);
    expect(out.steer).toBeCloseTo(lc.steer, 6);
    expect(lc.horn).toBe(0); // 0.9 > hornChance
    expect(startLoose(() => 0.1, 0).horn).toBeGreaterThanOrEqual(SIN_CONTROL.hornMin);
  });
});

describe('patrulla: los dos agentes de adentro', () => {
  it('sigue si el conductor está bien; a pie si cayó el conductor; eliminada si cayeron los dos', () => {
    expect(patrolOutcome([false, false])).toBe('sigue');
    expect(patrolOutcome([false, true])).toBe('sigue');
    expect(patrolOutcome([true, false])).toBe('aPie');
    expect(patrolOutcome([true, true])).toBe('eliminada');
    expect(patrolOutcome([true])).toBe('eliminada');
  });
});
