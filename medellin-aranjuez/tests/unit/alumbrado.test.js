// Alumbrado público (sim/alumbrado.js): cada luminaria de la ciudad (farol
// suelto o en un poste de redes) tiene la cabeza del lado de la calzada, a una
// altura razonable, con el brazo perpendicular a la calle y el lente mirando
// abajo; no quedan postes pegados ni faroles mirando al vacío.
import { describe, expect, it } from 'vitest';
import { generateCity } from '../../src/sim/cityLayout.js';
import { onRoad } from '../../src/sim/terrain.js';
import { DIST_DUPLICADO, LUMINARIAS, cabezaFarol, fuenteDeLuz, geometriaLuminaria, giroLuminaria, luminariaDe, luzLed } from '../../src/sim/alumbrado.js';
import { city } from './helpers.js';

/**
 * Calles junto a las que está parado (x, z): cada tramo del eje de una vía
 * (las de carros y los senderos: peatonales y escalas también se alumbran)
 * cuyo borde queda a menos de `margen` m; con el punto más cercano del eje y
 * la tangente del tramo. En una isla entre dos vías salen las dos.
 */
function callesAlLado(c, x, z, margen = 1.5) {
  const out = [];
  for (const e of [...c.edges, ...c.paths]) {
    for (let i = 0; i < e.pts.length - 1; i++) {
      const [ax, az] = e.pts[i];
      const [bx, bz] = e.pts[i + 1];
      const vx = bx - ax;
      const vz = bz - az;
      const L2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
      const px = ax + vx * t;
      const pz = az + vz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < e.width / 2 + margen) out.push({ d, px, pz, tx: vx / Math.sqrt(L2), tz: vz / Math.sqrt(L2), w: e.width });
    }
  }
  return out;
}

const luminarias = (c) => c.props.filter((p) => luminariaDe(p));

for (const [nombre, getCity] of [['semilla 4 (la del juego)', () => city()], ['semilla 7', () => generateCity(7)]]) {
  describe(`alumbrado: ${nombre}`, () => {
    it('cada cabeza queda del lado de la calzada, más cerca del eje que la base, y a una altura razonable', () => {
      const c = getCity();
      const lista = luminarias(c);
      expect(lista.length).toBeGreaterThan(1000);
      expect(lista.filter((p) => p.type === 'pole').length).toBeGreaterThan(500);
      expect(lista.filter((p) => p.type === 'lamp').length).toBeGreaterThan(300);
      const malos = [];
      const h = { x: 0, y: 0, z: 0 };
      for (const p of lista) {
        cabezaFarol(p, 0, h);
        const alcance = Math.hypot(h.x - p.x, h.z - p.z);
        const ax = (h.x - p.x) / alcance;
        const az = (h.z - p.z) / alcance;
        // Parado en el andén de alguna calle, y sobre esa calle: la cabeza se
        // acerca al eje casi todo lo que sale el brazo (perpendicular a la
        // calle, no a lo largo ni hacia las fachadas).
        const calles = callesAlLado(c, p.x, p.z);
        const sirve = calles.some((e) => Math.hypot(h.x - e.px, h.z - e.pz) < e.d - 0.8 * alcance && Math.abs(ax * e.tx + az * e.tz) < 0.35);
        const ok = sirve && h.y > 6 && h.y < 11.5 && alcance > 1 && alcance < 3;
        if (!ok) malos.push({ tipo: p.type, via: p.via, x: +p.x.toFixed(1), z: +p.z.toFixed(1), calles: calles.length, y: +h.y.toFixed(2), alcance: +alcance.toFixed(2) });
      }
      expect(malos.slice(0, 5)).toEqual([]);
      expect(malos.length).toBe(0);
    });

    it('ningún poste en la calzada y nunca un farol suelto pegado a un poste de redes', () => {
      const c = getCity();
      const postes = c.props.filter((p) => p.type === 'pole');
      const enCalzada = [];
      const pegados = [];
      for (const p of luminarias(c)) {
        if (onRoad(p.x, p.z)) enCalzada.push([p.type, +p.x.toFixed(1), +p.z.toFixed(1)]);
        if (p.type === 'lamp' && postes.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < DIST_DUPLICADO)) pegados.push([+p.x.toFixed(1), +p.z.toFixed(1)]);
      }
      expect(enCalzada).toEqual([]);
      expect(pegados).toEqual([]);
    });

    it('la luz de cada poste de redes cae sobre la calzada, no sobre las fachadas', () => {
      const c = getCity();
      const f = { x: 0, y: 0, z: 0 };
      const fuera = [];
      for (const p of c.props) {
        if (p.type !== 'pole') continue;
        fuenteDeLuz(p, 0, f);
        if (!onRoad(f.x, f.z)) fuera.push([+p.x.toFixed(1), +p.z.toFixed(1)]);
      }
      expect(fuera).toEqual([]);
    });

    it('todos los postes de redes llevan su luminaria; los faroles sueltos dicen su tipo de vía', () => {
      const c = getCity();
      for (const p of c.props) {
        if (p.type === 'pole') expect(Number.isFinite(p.luzRot)).toBe(true);
        if (p.type === 'lamp') expect(['barrio', 'avenida']).toContain(p.via);
      }
      // Las avenidas (troncales y principales) tienen sus postes metálicos.
      expect(c.props.some((p) => p.type === 'lamp' && p.via === 'avenida')).toBe(true);
      expect(c.alumbrado.quitados).toBeGreaterThan(0);
    });
  });
}

describe('alumbrado: la luminaria', () => {
  it('el lente mira hacia abajo (un poco hacia la calzada) y queda más allá de la punta del brazo', () => {
    for (const L of Object.values(LUMINARIAS)) {
      const g = geometriaLuminaria(L);
      expect(g.ny).toBeLessThan(-0.95); // normal de la cara que alumbra: abajo
      expect(g.nu).toBeGreaterThan(0); // ... inclinada hacia la calzada
      expect(g.y1).toBeGreaterThan(g.y0); // el brazo sube hacia la calle
      expect(g.lente.u).toBeGreaterThan(g.u1 - 0.1);
      expect(g.lente.y).toBeLessThan(g.y1);
      if (L.alto) expect(g.y1).toBeLessThan(L.alto + 0.6);
    }
  });

  it('el giro manda el brazo hacia −Z local: rot = 0 lo pone hacia −Z del mundo', () => {
    const p = { type: 'lamp', x: 10, z: 20, rot: 0, via: 'barrio' };
    const h = cabezaFarol(p, 1);
    expect(h.x).toBeCloseTo(10, 6);
    expect(h.z).toBeLessThan(20 - 1);
    expect(h.y).toBeGreaterThan(1 + 7);
    const q = { type: 'pole', x: 0, z: 0, luzRot: Math.PI / 2 };
    expect(giroLuminaria(q)).toBe(Math.PI / 2);
    expect(cabezaFarol(q).x).toBeLessThan(-1); // hacia −X
  });

  it('el color (LED o sodio) es fijo por posición y las avenidas son LED', () => {
    const p = { x: 123.4, z: -56.7 };
    expect(luzLed(p, 'barrio')).toBe(luzLed({ ...p }, 'barrio'));
    let led = 0;
    for (let i = 0; i < 400; i++) {
      expect(luzLed({ x: i * 7.3, z: i * -3.1 }, 'avenida')).toBe(true);
      if (luzLed({ x: i * 7.3, z: i * -3.1 }, 'barrio')) led++;
    }
    expect(led / 400).toBeGreaterThan(0.6);
    expect(led / 400).toBeLessThan(0.9);
  });
});
