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
const EXPECTED = {
  4: {
    all: '37210199913d68ed',
    counts: [14890, 22464, 261],
    buildings: 'c63011be8aa30fc5',
    props: '7261b21b104bcadd',
    parkedVehicles: '8f0b3d83691b3738',
    blocks: '7235efc8f8b15c92',
    pois: '330046757d22c82c',
    collision: '0567fcd148eb9568',
    metro: '8ef5eeef08119bb0',
  },
  7: {
    all: '6faa629f39629b9f',
    counts: [14916, 22791, 256],
    buildings: 'b7b683906d2d9592',
    props: 'a73aaa5a1661aa9d',
    parkedVehicles: '0f48bb75fb91742c',
    blocks: '7235efc8f8b15c92',
    pois: 'ef1c778461746adb',
    collision: '9efe3ea53e791186',
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
