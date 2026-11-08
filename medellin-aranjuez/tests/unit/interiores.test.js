// Interiores accesibles de los locales de la 92 (sim/interiors.js): huella
// grande, cascarón hueco con su puerta, piso caminable al nivel de la puerta
// (o sótano), mezanine con escalera que se sube caminando, lo macizo de
// adentro sin encimarse y los puntos para la gente.
import { describe, expect, it } from 'vitest';
import { city } from './helpers.js';
import { INTERIOR, INTERIORES_ACTIVOS, PLANES, TAMANOS, aLocal, aMundo, alturaInterior, dentroInterior, localAbierto, rectMinus, techoInterior } from '../../src/sim/interiors.js';
import { groundHeight, terrainHeight } from '../../src/sim/terrain.js';
import { createPlayerState, emptyMoveInput, stepPlayer } from '../../src/sim/playerController.js';

const C = city();
const env = { groundHeight, collision: C.collision };
const byId = (id) => C.interiors.find((r) => r.id === id);

/** Camina en línea recta hacia (tx, tz) (mundo); devuelve el estado final. */
function walkTo(s, tx, tz, secs = 12) {
  const inp = emptyMoveInput();
  for (let t = 0; t < secs; t += 0.05) {
    const dx = tx - s.pos.x;
    const dz = tz - s.pos.z;
    if (Math.hypot(dx, dz) < 0.25) break;
    inp.forward = 1;
    inp.camYaw = Math.atan2(-dx, -dz);
    stepPlayer(s, inp, 0.05, env);
  }
  return s;
}

/** Con la puerta abierta mientras corre `fn`. */
function withDoorOpen(r, fn) {
  C.collision.remove(r.doorBox);
  try {
    return fn();
  } finally {
    C.collision.restore(r.doorBox);
  }
}

// Con los interiores apagados (INTERIORES_ACTIVOS = false) solo corre lo puro.
const enCiudad = INTERIORES_ACTIVOS ? it : it.skip;

describe('interiores accesibles de la 92', () => {
  enCiudad('los ocho locales tienen interior, del tamaño de su plan', () => {
    expect(C.interiors.map((r) => r.id).sort()).toEqual(Object.keys(PLANES).sort());
    for (const r of C.interiors) {
      const T = TAMANOS[r.tam];
      expect(r.W, r.id).toBeGreaterThanOrEqual(T.ancho * 0.8 - 1e-6);
      expect(r.D, r.id).toBeGreaterThanOrEqual(Math.min(T.fondo * 0.8, 12) - 1e-6);
      expect(r.H, r.id).toBeGreaterThan(2.9);
      // El techo cabe en el edificio.
      expect(r.y0 + r.H, r.id).toBeLessThan(r.topY);
      // Del edificio, la fachada da a la calle y la puerta (el lugar) queda al frente.
      const poi = C.pois.find((p) => p.id === r.id);
      const d = aLocal(r, poi.x, poi.z);
      expect(Math.abs(d.x), r.id).toBeLessThan(1.5);
      expect(d.z, r.id).toBeGreaterThan(0);
      expect(d.z, r.id).toBeLessThan(3.5);
    }
    // Los grandes son grandes y con mezanine; la salsoteca es de sótano.
    for (const id of ['flow92', 'neon92', 'bajocero']) {
      const r = byId(id);
      expect(r.W * r.D).toBeGreaterThan(14 * 22 * 0.75);
      expect(r.H).toBeGreaterThanOrEqual(5);
      expect(r.mezz).toBeTruthy();
    }
    expect(byId('laclave').y0).toBeLessThan(byId('laclave').floorY - 1.5);
  });

  enCiudad('abre de noche y cierra de día', () => {
    expect(localAbierto(23)).toBe(true);
    expect(localAbierto(1)).toBe(true);
    expect(localAbierto(12)).toBe(false);
    expect(localAbierto(16)).toBe(false);
  });

  enCiudad('el piso es el del local aunque la loma quede más alta o más baja', () => {
    for (const r of C.interiors) {
      for (const [fx, fz] of [[0.5, 0.5], [0.15, 0.2], [0.85, 0.8], [0.5, 0.95]]) {
        const lx = r.X0 + (r.X1 - r.X0) * fx;
        const lz = r.Z0 + (r.Z1 - r.Z0) * fz;
        const p = aMundo(r, lx, lz);
        const h = groundHeight(p.x, p.z, r.y0 + 0.05);
        expect(h, r.id).toBeGreaterThanOrEqual(r.y0 - 1e-6);
        expect(h, r.id).toBeLessThan(Math.max(r.floorY, r.y0) + 1.3);
      }
      // En el centro, el piso del salón aunque el terreno pase por encima.
      const c = aMundo(r, (r.X0 + r.X1) / 2, (r.Z0 + r.Z1) / 2);
      if (!r.items.some((it) => it.walk && c && Math.abs(aLocal(r, c.x, c.z).x - (it.x0 + it.x1) / 2) < (it.x1 - it.x0) / 2 && Math.abs(aLocal(r, c.x, c.z).z - (it.z0 + it.z1) / 2) < (it.z1 - it.z0) / 2)) expect(groundHeight(c.x, c.z, r.y0)).toBeCloseTo(r.y0, 5);
    }
    // El sótano queda bajo la loma.
    const s = byId('laclave');
    const c = s.spots.baile[0];
    expect(terrainHeight(c.x, c.z)).toBeGreaterThan(s.y0);
    expect(groundHeight(c.x, c.z, s.y0)).toBeCloseTo(s.y0, 5);
  });

  enCiudad('cerrado no se entra; con la puerta abierta se camina del andén al salón', () => {
    for (const r of C.interiors) {
      const poi = C.pois.find((p) => p.id === r.id);
      const out = aMundo(r, 0, 1.4);
      const inn = aMundo(r, 0, -1.2);
      // Cerrada: se queda afuera.
      const s0 = createPlayerState(out.x, out.z, groundHeight);
      walkTo(s0, inn.x, inn.z, 4);
      expect(dentroInterior(r, s0.pos.x, s0.pos.z, s0.pos.y), r.id).toBe(false);
      // Abierta: entra, con los pies en el piso del local (o del descanso del sótano).
      withDoorOpen(r, () => {
        const s = createPlayerState(poi.x, poi.z, groundHeight);
        walkTo(s, out.x, out.z, 6);
        walkTo(s, inn.x, inn.z, 6);
        expect(dentroInterior(r, s.pos.x, s.pos.z, s.pos.y), r.id).toBe(true);
        expect(Math.abs(s.pos.y - r.floorY), r.id).toBeLessThan(0.05);
      });
    }
  });

  enCiudad('los muros, el techo y el piso tapan: de adentro no se sale sino por la puerta', () => {
    for (const r of C.interiors) {
      const y = r.y0 + 1.2;
      const probe = (lx, lz) => {
        const p = aMundo(r, lx, lz);
        return C.collision.pointBlocked(p.x, p.z, y);
      };
      // Dentro de cada muro.
      expect(probe(r.X0 - 0.1, (r.Z0 + r.Z1) / 2), r.id).toBe(true);
      expect(probe(r.X1 + 0.1, (r.Z0 + r.Z1) / 2), r.id).toBe(true);
      expect(probe((r.X0 + r.X1) / 2, r.Z0 - 0.1), r.id).toBe(true);
      // Un rayo que sube desde la pista choca con el techo (o el mezanine).
      const c = aMundo(r, (r.X0 + r.X1) / 2 + 0.3, (r.Z0 + r.Z1) / 2 - 0.4);
      const hit = C.collision.raycast(c.x, r.y0 + 2, c.z, 0, 1, 0, 30);
      expect(hit, r.id).toBeTruthy();
      expect(r.y0 + 2 + hit.t, r.id).toBeLessThanOrEqual(r.y0 + r.H + 0.05);
      // Uno que sale por un costado choca con el muro.
      const side = C.collision.raycast(c.x, r.y0 + 1.5, c.z, r.ux, 0, r.uz, 40);
      expect(side.t, r.id).toBeLessThan(r.W);
    }
  });

  enCiudad('al mezanine se sube por la escalera, caminando', () => {
    for (const id of ['flow92', 'neon92', 'bajocero']) {
      const r = byId(id);
      const st = r.stairs[0];
      const xc = (st.x0 + st.x1) / 2;
      const a = aMundo(r, xc, st.z0 - 0.6);
      const b = aMundo(r, xc, st.z1 + 1.0);
      const s = createPlayerState(a.x, a.z, (x, z) => groundHeight(x, z, r.y0));
      walkTo(s, b.x, b.z, 15);
      expect(s.pos.y, id).toBeGreaterThan(r.mezz.y - 0.05);
      // Arriba: el piso del mezanine; abajo (sin altura de pies), la pista.
      const m = aMundo(r, 0, (r.mezz.z0 + r.mezz.z1) / 2);
      expect(groundHeight(m.x, m.z, r.mezz.y)).toBeCloseTo(r.mezz.y, 5);
      expect(groundHeight(m.x, m.z, r.y0)).toBeCloseTo(r.y0, 5);
      expect(groundHeight(m.x, m.z)).toBeCloseTo(r.y0, 5);
      // Bajo el mezanine la cámara choca con la losa.
      expect(techoInterior(r, 0, (r.mezz.z0 + r.mezz.z1) / 2, r.y0 + 1.6)).toBeLessThan(r.mezz.y);
      // Desde abajo no se mete uno bajo la escalera.
      const u = aMundo(r, xc, st.z1 - 0.4);
      expect(C.collision.pointBlocked(u.x, u.z, r.y0 + 1)).toBe(true);
    }
  });

  enCiudad('a la salsoteca se baja por la escalera del sótano', () => {
    const r = byId('laclave');
    const st = r.stairs[0];
    withDoorOpen(r, () => {
      const out = aMundo(r, 0, 1.2);
      const end = aMundo(r, 0, st.z0 - 1.5);
      const s = createPlayerState(out.x, out.z, groundHeight);
      walkTo(s, end.x, end.z, 15);
      expect(s.pos.y).toBeCloseTo(r.y0, 1);
      expect(dentroInterior(r, s.pos.x, s.pos.z, s.pos.y)).toBe(true);
    });
  });

  enCiudad('lo macizo de adentro no se encima ni se sale del salón; los puntos de la gente quedan libres', () => {
    for (const r of C.interiors) {
      const solid = r.items.filter((it) => it.solid && it.t !== 'columna');
      for (const it of solid) {
        expect(it.x0, `${r.id} ${it.t}`).toBeGreaterThanOrEqual(r.X0 - 0.3);
        expect(it.x1, `${r.id} ${it.t}`).toBeLessThanOrEqual(r.X1 + 0.3);
        expect(it.z0, `${r.id} ${it.t}`).toBeGreaterThanOrEqual(r.Z0 - 0.01);
        expect(it.z1, `${r.id} ${it.t}`).toBeLessThanOrEqual(r.Z1 + 0.01);
      }
      for (let i = 0; i < solid.length; i++)
        for (let j = i + 1; j < solid.length; j++) {
          const a = solid[i];
          const b = solid[j];
          // (La cabina y los parlantes van encima de la tarima; lo del mezanine, arriba.)
          if (a.y + a.h <= b.y + 0.01 || b.y + b.h <= a.y + 0.01) continue;
          const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
          const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
          expect(ox > 0.05 && oz > 0.05, `${r.id}: ${a.t} con ${b.t}`).toBe(false);
        }
      // Escalera y mezanine no se tapan con muebles.
      for (const st of r.stairs)
        for (const it of solid) {
          if (it.y > st.yHigh) continue;
          const ox = Math.min(it.x1, st.x1) - Math.max(it.x0, st.x0);
          const oz = Math.min(it.z1, st.z1 + 1.0) - Math.max(it.z0, st.z0 - 1.0);
          expect(ox > 0.05 && oz > 0.05, `${r.id}: ${it.t} en la escalera`).toBe(false);
        }
      // Puntos de baile y de barra: adentro, en un piso caminable y sin nada macizo encima.
      for (const k of ['baile', 'barra']) {
        for (const p of r.spots[k]) {
          expect(dentroInterior(r, p.x, p.z, p.y), `${r.id} ${k}`).toBe(true);
          expect(C.collision.pointBlocked(p.x, p.z, p.y + 1.0), `${r.id} ${k}`).toBe(false);
        }
      }
      expect(r.spots.barra.length, r.id).toBeGreaterThan(2);
      expect(r.cabina, r.id).toBeTruthy();
      // El paso de la puerta queda libre.
      const p = aMundo(r, 0, -2.2);
      expect(C.collision.pointBlocked(p.x, p.z, r.floorY + 1), r.id).toBe(false);
    }
    expect(byId('flow92').spots.baile.length).toBeGreaterThan(30);
    expect(byId('flow92').spots.vip.length).toBeGreaterThan(10);
  });

  enCiudad('rectMinus parte un rectángulo alrededor de un hueco', () => {
    const parts = rectMinus({ x0: 0, x1: 10, z0: 0, z1: 10 }, { x0: 4, x1: 6, z0: 5, z1: 12 });
    const area = parts.reduce((s, q) => s + (q.x1 - q.x0) * (q.z1 - q.z0), 0);
    expect(area).toBeCloseTo(100 - 2 * 5, 6);
    expect(INTERIOR.PUERTA_ANCHO).toBeGreaterThan(1.6);
    // Del sótano: el hueco del foso no tiene techo bajo.
    const r = byId('laclave');
    expect(alturaInterior(r, 0, r.Z1 - 0.5, r.floorY)).toBeCloseTo(r.floorY, 5);
  });
});
