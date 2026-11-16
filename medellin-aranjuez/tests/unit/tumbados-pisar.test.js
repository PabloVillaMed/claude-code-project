// Lo tumbado en el piso (sim/destructibles.js alturaTumbado / pisar): los
// vehículos le pasan por encima con un brinco y una frenada leve, sin chocar
// como contra una pared.
import { describe, expect, it } from 'vitest';
import { CollisionWorld } from '../../src/sim/collision.js';
import { createVehicleState, stepVehicle } from '../../src/sim/vehiclePhysics.js';
import { Destructibles, CAYENDO, RADIO_TUMBADO, RUEDA_REF, TUMBADO_ALTO_MAX } from '../../src/sim/destructibles.js';

function mundo(props) {
  const collision = new CollisionWorld(8);
  for (const p of props) collision.add({ minX: p.x - p.collider.hx, maxX: p.x + p.collider.hx, minZ: p.z - p.collider.hz, maxZ: p.z + p.collider.hz, kind: p.type });
  const reg = new Destructibles({ props, collision }, { groundHeight: () => 0 });
  const env = { groundHeight: () => 0, collision, breakables: reg, bounds: { minX: -1e6, maxX: 1e6, minZ: -1e6, maxZ: 1e6 } };
  return { reg, env };
}
const poste = (x, z) => ({ type: 'pole', x, z, h: 9, collider: { hx: 0.15, hz: 0.15 } });
const arbol = (x, z) => ({ type: 'tree', kind: 'mango', x, z, scale: 1, collider: { hx: 0.25, hz: 0.25 } });

/** Tumba la entrada hacia +X y la deja quieta en el piso. */
function acostar(reg, e) {
  reg.tumbar(e, 1, 0, 10);
  for (let i = 0; i < 900 && e.estado === CAYENDO; i++) reg.update(1 / 60, 500, 500);
}

/** Carro que va hacia -Z por x = xc a `vel` m/s, sin acelerar; velocidad al final y brinco máximo. */
function cruzar(env, xc, vel, segundos = 1.6) {
  const v = createVehicleState('sedan', xc, 6, 0, () => 0);
  v.vz = -vel;
  v.forwardSpeed = vel;
  let maxTronco = 0;
  let subidas = 0;
  let antes = 0;
  for (let i = 0; i < Math.round(segundos * 60); i++) {
    stepVehicle(v, { throttle: 0, brake: 0, steer: 0, handbrake: false }, 1 / 60, env);
    if (v.tronco & ~antes) subidas++;
    antes = v.tronco;
    maxTronco = Math.max(maxTronco, v.tronco);
  }
  return { v, vel: Math.hypot(v.vx, v.vz), subidas, maxTronco };
}

describe('lo tumbado en el piso se pisa', () => {
  it('el poste acostado levanta la rueda que le pasa por encima (unos 2 radios), solo encima de él', () => {
    const { reg } = mundo([poste(0, 0)]);
    const e = reg.entries[0];
    expect(reg.alturaTumbado(4, 0)).toBe(0); // de pie: nada
    acostar(reg, e);
    const r = RADIO_TUMBADO.pole;
    expect(e.pr).toBeCloseTo(r, 6);
    // Encima del eje, a 4 m de la base: casi dos radios (el poste casi no sube).
    const encima = reg.alturaTumbado(e.px + 4, 0);
    expect(encima).toBeGreaterThan(2 * r - 0.01);
    expect(encima).toBeLessThan(2 * r + 0.1);
    // A un lado sube menos y lejos nada.
    expect(reg.alturaTumbado(e.px + 4, 0.3)).toBeLessThan(encima);
    expect(reg.alturaTumbado(e.px + 4, RUEDA_REF + r + 0.01)).toBe(0);
    expect(reg.alturaTumbado(e.px + 12, 0)).toBe(0); // pasada la punta
    expect(reg.alturaTumbado(e.px - 1, 0)).toBe(0); // antes de la base
  });

  it('un carro le pasa por encima: los dos ejes brincan, pierde algo de velocidad y sigue', () => {
    const libre = cruzar(mundo([]).env, 4, 10);
    const { reg, env } = mundo([poste(0, 0)]);
    acostar(reg, reg.entries[0]);
    const r = cruzar(env, 4, 10);
    expect(r.subidas).toBe(2); // adelante y atrás
    expect(r.maxTronco).toBeGreaterThan(0);
    expect(r.v.tronco).toBe(0); // ya pasó
    expect(r.v.z).toBeLessThan(-4); // no se quedó trabado
    const perdida = 1 - r.vel / libre.vel;
    expect(perdida).toBeGreaterThan(0.04);
    expect(perdida).toBeLessThan(0.25);
  });

  it('del árbol (sostenido por la copa) solo se pisa el tronco cerca de la base', () => {
    const { reg } = mundo([arbol(0, 0)]);
    const e = reg.entries[0];
    acostar(reg, e);
    expect(e.pr).toBeGreaterThan(0);
    expect(e.prise).toBeGreaterThan(0.1);
    expect(e.plen).toBeLessThanOrEqual(TUMBADO_ALTO_MAX / e.prise + 1e-6);
    expect(e.plen).toBeLessThan(e.h * Math.sin(e.ang));
    expect(reg.alturaTumbado(e.px + 0.4, 0)).toBeGreaterThan(0.2);
    expect(reg.alturaTumbado(e.px + e.plen + 1.5, 0)).toBe(0);
  });

  it('repuesto de pie ya no se pisa (y sin nada tumbado no cuesta nada)', () => {
    const { reg, env } = mundo([poste(0, 0)]);
    const e = reg.entries[0];
    acostar(reg, e);
    reg.reponer(e);
    expect(reg.tumbados.length).toBe(0);
    expect(reg.alturaTumbado(e.px + 4, 0)).toBe(0);
    const v = createVehicleState('sedan', 4, 6, 0, () => 0);
    expect(env.breakables.pisar(v, v.spec, 0, -1, 1, 0)).toBe(0);
    expect(v.tronco).toBe(0);
  });
});
