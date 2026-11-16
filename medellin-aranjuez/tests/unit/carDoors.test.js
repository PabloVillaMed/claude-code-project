import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PUERTA, REGIONES, splitGeometry } from '../../src/render/carDoors.js';

// La puerta que abre (render/carDoors.js): el corte de la carrocería por la
// región de la puerta no pierde ni repite superficie y lo de la puerta queda
// adentro de la región.

const area = (g) => {
  if (!g) return 0;
  const p = g.attributes.position;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let s = 0;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    s += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return s;
};

// Región de una puerta izquierda (x <= -0.6), de z -1 a 0.2 y de y 0.3 a 1.4.
const R = { side: -1, xIn: 0.6, z0: -1, z1: 0.2, y0: 0.3, y1: 1.4 };
const planes = [
  [1, 0, 0, -R.xIn],
  [0, 0, -1, -R.z0],
  [0, 0, 1, R.z1],
  [0, -1, 0, -R.y0],
  [0, 1, 0, R.y1],
];

describe('corte de la puerta en la carrocería', () => {
  it('lo de adentro más lo de afuera es la misma superficie (sin huecos ni repetidos)', () => {
    // Una "carrocería" de caja subdividida que cruza todos los bordes de la región.
    const box = new THREE.BoxGeometry(1.8, 1.6, 4.2, 7, 6, 13);
    box.translate(0, 0.8, 0);
    const { inside, outside } = splitGeometry(box, new THREE.Matrix4(), planes);
    expect(inside).not.toBeNull();
    expect(outside).not.toBeNull();
    expect(area(inside) + area(outside)).toBeCloseTo(area(box.toNonIndexed()), 6);
    // La cara de afuera del costado (x = -0.9) dentro de la región: 1.2 m x 1.1 m.
    expect(area(inside)).toBeCloseTo(1.2 * 1.1, 6);
  });

  it('todo lo de la puerta cae dentro de la región y conserva los atributos (normales, uv)', () => {
    const box = new THREE.BoxGeometry(1.8, 1.6, 4.2, 3, 3, 5);
    box.translate(0, 0.8, 0);
    const { inside } = splitGeometry(box, new THREE.Matrix4(), planes);
    const p = inside.attributes.position;
    for (let i = 0; i < p.count; i++) {
      expect(p.getX(i)).toBeLessThanOrEqual(-R.xIn + 1e-6);
      expect(p.getZ(i)).toBeGreaterThanOrEqual(R.z0 - 1e-6);
      expect(p.getZ(i)).toBeLessThanOrEqual(R.z1 + 1e-6);
      expect(p.getY(i)).toBeGreaterThanOrEqual(R.y0 - 1e-6);
      expect(p.getY(i)).toBeLessThanOrEqual(R.y1 + 1e-6);
      expect(Number.isFinite(inside.attributes.uv.getX(i))).toBe(true);
    }
    expect(Object.keys(inside.attributes).sort()).toEqual(['normal', 'position', 'uv']);
  });

  it('la matriz del modelo se aplica antes de cortar', () => {
    const box = new THREE.BoxGeometry(1.8, 1.6, 4.2, 3, 3, 5);
    // La misma caja, pero corrida 10 m: con la matriz que la devuelve, el mismo corte.
    box.translate(10, 0.8, 0);
    const back = new THREE.Matrix4().makeTranslation(-10, 0, 0);
    const { inside } = splitGeometry(box, back, planes);
    expect(area(inside)).toBeCloseTo(1.2 * 1.1, 6);
  });

  it('las regiones medidas son puertas razonables (detrás de la rueda, de largo y alto de puerta)', () => {
    for (const [k, r] of Object.entries(REGIONES)) {
      const len = r.z1 - r.z0;
      expect(len, k).toBeGreaterThan(0.9);
      expect(len, k).toBeLessThanOrEqual(PUERTA.maxLength);
      expect(r.y1 - r.y0, k).toBeGreaterThan(0.9);
      expect(r.lt, k).toBeLessThan(r.y1);
      expect(r.xIn, k).toBeGreaterThan(0.45);
    }
  });
});
