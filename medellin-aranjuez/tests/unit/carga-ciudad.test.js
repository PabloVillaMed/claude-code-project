// Suma de control de la ciudad generada: la generación se aceleró (rejillas
// para las búsquedas cercanas, geometría 2D sin asignaciones) y debe dar la
// MISMA ciudad, bit a bit, con el mismo orden de llamadas al generador
// aleatorio. Si un cambio a propósito altera la ciudad, la prueba imprime las
// sumas nuevas para actualizarlas aquí.
import { describe, expect, it } from 'vitest';
import { generateCity } from '../../src/sim/cityLayout.js';
import { city } from './helpers.js';

/** Suma de control de un grafo de objetos: claves, textos y los 64 bits de cada número. */
function checksum(root) {
  let h1 = 0x811c9dc5 | 0;
  let h2 = 0x9e3779b9 | 0;
  const f64 = new Float64Array(1);
  const u32 = new Uint32Array(f64.buffer);
  const mix = (v) => {
    h1 = Math.imul(h1 ^ v, 0x01000193);
    h2 = Math.imul(h2 ^ (v >>> 0), 0x85ebca6b) ^ (h2 >>> 13);
  };
  const str = (s) => {
    mix(s.length);
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
  };
  // Objetos repetidos (o ciclos) se cuentan por su número de aparición.
  const seen = new Map();
  const walk = (v) => {
    const t = typeof v;
    if (t === 'number') {
      f64[0] = v;
      mix(1);
      mix(u32[0]);
      mix(u32[1]);
    } else if (t === 'string') {
      mix(2);
      str(v);
    } else if (t === 'boolean') mix(v ? 3 : 4);
    else if (v === null) mix(5);
    else if (v === undefined) mix(6);
    else if (t === 'function') mix(7);
    else if (t === 'object') {
      if (seen.has(v)) {
        mix(8);
        mix(seen.get(v));
        return;
      }
      seen.set(v, seen.size);
      if (v instanceof Map) {
        mix(9);
        for (const [k, x] of v) {
          walk(k);
          walk(x);
        }
      } else if (v instanceof Set) {
        mix(10);
        for (const x of v) walk(x);
      } else if (Array.isArray(v) || ArrayBuffer.isView(v)) {
        mix(11);
        mix(v.length);
        for (let i = 0; i < v.length; i++) walk(v[i]);
      } else {
        mix(12);
        for (const k of Object.keys(v)) {
          str(k);
          walk(v[k]);
        }
      }
    }
  };
  walk(root);
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

const PARTS = ['buildings', 'props', 'parkedVehicles', 'blocks', 'pois', 'collision', 'metro'];

// Sumas de la ciudad tal como salía antes de acelerar la generación (al
// agregar locales o calles cambian edificios, lugares, utilería y colisión:
// se actualizan aquí después de revisar que lo demás quedó igual).
// 3.6: el asiento en la loma (sim/buildingBases.js) cambia edificios (fachadas
// escalonadas en tramos, pisos al nivel del andén), utilería (escalas) y
// colisión; manzanas, carros parqueados, lugares y metro siguen iguales.
// 3.6: las discotecas, bares y la fonda de la 92 crecen y se puede entrar
// (sim/interiors.js): cambian edificios (huellas nuevas, vecinos tumbados),
// utilería (lo que quedaba debajo y frente a las puertas), lugares (la
// puerta de los que se corrieron) y colisión (el cascarón hueco y lo de
// adentro); manzanas, carros parqueados y metro siguen iguales. Mientras
// INTERIORES_ACTIVOS sea false, las sumas son las del asiento en la loma solo.
const EXPECTED = {
  4: {
    all: 'd54a191a71979de4',
    counts: [15681, 24140, 261],
    buildings: '74752f482d7ce1bf',
    props: 'c750c4f80938ff46',
    parkedVehicles: '8f0b3d83691b3738',
    blocks: '7235efc8f8b15c92',
    pois: '9128ba9dab3b48ab',
    collision: 'aabdb944834a2b32',
    metro: '8ef5eeef08119bb0',
  },
  7: {
    all: 'b59ed8b1d2e1aaff',
    counts: [15717, 24540, 256],
    buildings: '1e2cbc367141e7a4',
    props: 'e194822209ef8e37',
    parkedVehicles: '0f48bb75fb91742c',
    blocks: '7235efc8f8b15c92',
    pois: '8fe2228e1e02b2da',
    collision: 'aac5ee4e574697d3',
    metro: '8ef5eeef08119bb0',
  },
};

function summary(c) {
  const out = { all: checksum(c), counts: [c.buildings.length, c.props.length, c.parkedVehicles.length] };
  for (const k of PARTS) out[k] = checksum(c[k]);
  return out;
}

describe('carga: la ciudad generada no cambia', () => {
  it('la suma de control es estable (misma ciudad en dos corridas)', () => {
    expect(checksum({ a: [1, -0, NaN, 'x'], b: new Map([[1, 2]]) })).toBe(checksum({ a: [1, -0, NaN, 'x'], b: new Map([[1, 2]]) }));
    expect(checksum([0])).not.toBe(checksum([-0]));
    expect(checksum([0.1 + 0.2])).not.toBe(checksum([0.3]));
  });

  it('semilla 4 (la del juego): idéntica, parte por parte', () => {
    const got = summary(city());
    if (got.all !== EXPECTED[4].all) console.log('ciudad semilla 4:', JSON.stringify(got));
    expect(got).toEqual(EXPECTED[4]);
  });

  it('semilla 7: idéntica, parte por parte', () => {
    const got = summary(generateCity(7));
    if (got.all !== EXPECTED[7].all) console.log('ciudad semilla 7:', JSON.stringify(got));
    expect(got).toEqual(EXPECTED[7]);
  }, 120000);
});
