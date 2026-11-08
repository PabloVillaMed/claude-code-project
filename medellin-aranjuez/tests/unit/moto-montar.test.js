// Montarse en la moto v3.6: camino de la pierna que pasa por encima
// (sim/boarding.js MOUNT_LEG, mountLegPath, mountStep). Antes el tobillo
// saltaba a un punto fijo 45 cm sobre el sillín: cruzaba por dentro de la
// moto, subía 0,6 m por encima de la cadera y el muslo giraba hasta 88° por
// cuadro.
import { describe, expect, it } from 'vitest';
import { BOARD, MOUNT_LEG, motoEntryPlan, mountLegPath, mountStep, poseAt } from '../../src/sim/boarding.js';

// Medidas de la moto de calle (sonda en el juego): tobillo de pie junto a la
// moto, tobillo en la estribera del otro lado y paso sobre el sillín.
const REST = { x: -0.44, y: 0.1, z: 0.26 };
const PEG = { x: 0.19, y: 0.41, z: 0.16 };
const PASSES = { calle: { z: 0.45, y: 1.02 }, 'con caja': { z: 0.34, y: 0.98 } };
const smooth = (k) => k * k * (3 - 2 * k);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Cadera de la pierna que pasa, como la mueve el plan (hipFollow) y el pie de apoyo en la estribera. */
function hipAt(L) {
  const seat = smooth(clamp01((L - BOARD.mountLag) / (1 - BOARD.mountLag)));
  const f = smooth(L) + (seat - smooth(L)) * MOUNT_LEG.hipFollow;
  return { x: -0.62 * (1 - f) + 0.09, y: 0.86 + MOUNT_LEG.hipRise * mountStep(L) * (1 - seat) + 0.16 * seat, z: 0.38 - 0.13 * L };
}

function sweep(pass, side = -1, n = 40) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const L = i / n;
    const hip = hipAt(L);
    if (side > 0) hip.x = -hip.x;
    const rest = { ...REST, x: REST.x * -side };
    const peg = { ...PEG, x: PEG.x * -side };
    out.push({ L, hip, ...mountLegPath(rest, peg, pass, side, L, {}, hip) });
  }
  return out;
}

describe('montarse en la moto: la pierna que pasa por encima', () => {
  for (const [name, pass] of Object.entries(PASSES)) {
    it(`${name}: sale del pie de pie, termina en la estribera y entra sin salto`, () => {
      const r = sweep(pass);
      expect(r[0].x).toBeCloseTo(REST.x, 6);
      expect(r[0].y).toBeCloseTo(REST.y, 6);
      expect(r[0].w).toBe(0); // de pie: la animación manda
      expect(r.at(-1).x).toBeCloseTo(PEG.x, 6);
      expect(r.at(-1).y).toBeCloseTo(PEG.y, 6);
      expect(r.at(-1).z).toBeCloseTo(PEG.z, 6);
      expect(r.at(-1).w).toBe(1);
    });

    it(`${name}: pasa por encima del sillín, sin saltos ni vueltas de la rodilla`, () => {
      const r = sweep(pass);
      for (let i = 1; i < r.length; i++) {
        const a = r[i - 1];
        const b = r[i];
        // Paso por cuadro (1/40 de 1,25 s ≈ 31 ms): < 12 cm (≈ 4 m/s).
        expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)).toBeLessThan(0.12);
        // El polo de la rodilla gira poco a poco (< 8° por cuadro).
        const na = Math.hypot(a.px, a.py, a.pz);
        const nb = Math.hypot(b.px, b.py, b.pz);
        const cos = (a.px * b.px + a.py * b.py + a.pz * b.pz) / (na * nb);
        expect(Math.acos(Math.min(1, cos))).toBeLessThan((8 * Math.PI) / 180);
      }
      // Sobre el ancho del sillín (|x| < 15 cm) el tobillo va al menos 8 cm por
      // encima de lo más alto de la moto; en el eje, MOUNT_LEG.clear.
      for (const q of r) if (Math.abs(q.x) < 0.15 && q.L > 0.2 && q.L < 0.8) expect(q.y - pass.y).toBeGreaterThan(0.08);
      const mid = r.reduce((m, q) => (Math.abs(q.x) < Math.abs(m.x) ? q : m));
      expect(mid.y).toBeGreaterThanOrEqual(pass.y + MOUNT_LEG.clear - 0.01);
    });

    it(`${name}: el pie nunca va por encima ni por detrás de la espalda`, () => {
      for (const q of sweep(pass)) {
        expect(q.y - q.hip.y).toBeLessThan(0.1); // a la altura de la cadera, como mucho
        expect(q.z - q.hip.z).toBeLessThan(0.2); // justo detrás de la nalga, no más
      }
    });
  }

  it('por la derecha es el espejo de por la izquierda', () => {
    const l = sweep(PASSES.calle, -1);
    const r = sweep(PASSES.calle, 1);
    for (let i = 0; i < l.length; i++) {
      expect(r[i].x).toBeCloseTo(-l[i].x, 6);
      expect(r[i].y).toBeCloseTo(l[i].y, 6);
      expect(r[i].z).toBeCloseTo(l[i].z, 6);
      expect(r[i].px).toBeCloseTo(-l[i].px, 6);
    }
  });

  it('el pie de apoyo se sube a la estribera al principio y la cadera pasa al centro con el peso', () => {
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const s = mountStep(i / 20);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
    expect(mountStep(0)).toBe(0);
    expect(mountStep(MOUNT_LEG.stepFull)).toBe(1);
    // La raíz del plan va al centro más despacio que a ritmo parejo (con el peso).
    const moto = { width: 0.75, length: 2, seat: { x: 0, y: 0.8, z: 0.2 } };
    const plan = motoEntryPlan(moto, { x: -1.5, z: 1.0, yaw: 2.5 });
    const k = plan.keys.at(-1);
    const a = plan.keys.at(-2);
    const mid = poseAt(plan, (a.t + k.t) / 2);
    expect(mid.lift).toBeCloseTo(0.5);
    expect(Math.abs(mid.x - k.x)).toBeGreaterThan(Math.abs(a.x - k.x) * 0.5);
    expect(poseAt(plan, k.t).x).toBeCloseTo(k.x, 6);
  });
});
