// Asiento de las edificaciones en las lomas (sim/buildingBases.js) y su base
// visible (render/baseBuilder.js): cada entrada al nivel de su andén (nunca
// enterrada, ni flotando sin escalas), escalas caminables sobre el andén,
// fachadas escalonadas y la base hecha con su propio zócalo o muro (nada del
// atlas de la fachada).
import { describe, expect, it } from 'vitest';
import { city } from './helpers.js';
import { BASES, buildingEntries, entryLevel, shopRoomRect, walkLevel } from '../../src/sim/buildingBases.js';
import { addBuildingBase } from '../../src/render/baseBuilder.js';
import { facadeLayout, faceFrame } from '../../src/sim/facades.js';
import { GRID, groundHeight, onRoad, roadAt, terrainHeight } from '../../src/sim/terrain.js';
import { pointInPoly } from '../../src/sim/geom2d.js';

/** Edificaciones con fachada a una calle (las del fondo de la manzana no tienen andén al frente). */
function streetFacing(c) {
  const out = [];
  for (let i = 0; i < c.buildings.length; i++) {
    const b = c.buildings[i];
    if (b.interior || b.collide === false) continue;
    const fr = b.frame;
    const d = fr.hv + GRID.sidewalk + 1.5;
    if (!roadAt(fr.x + fr.nx * d, fr.z + fr.nz * d, 1)) continue;
    out.push(i);
  }
  return out;
}

describe('bases de las edificaciones en la loma', () => {
  it('ninguna entrada queda enterrada ni flotando sin escalas', () => {
    const c = city();
    const steps = new Map();
    for (const p of c.props) if (p.type === 'steps') steps.set(`${p.building}:${p.x.toFixed(3)}:${p.z.toFixed(3)}`, p);
    let entries = 0;
    let withSteps = 0;
    const buried = [];
    const floating = [];
    for (const i of streetFacing(c)) {
      const b = c.buildings[i];
      const f = faceFrame(b, b.front ?? 'S');
      for (const e of buildingEntries(b, facadeLayout(b, i), f)) {
        const lv = entryLevel(f, e);
        entries++;
        // El piso nunca por debajo del andén más alto frente al vano.
        if (b.groundY < lv.hi + BASES.FLOOR_LIFT - 1e-6) buried.push(i);
        const uc = (e.u0 + e.u1) / 2;
        const key = `${i}:${(f.x0 + f.rx * uc).toFixed(3)}:${(f.z0 + f.rz * uc).toFixed(3)}`;
        const s = steps.get(key);
        if (s) withSteps++;
        // Sin escalas: a lo sumo un escalón (salvo donde no hay andén al frente).
        const [px, pz] = [f.x0 + f.rx * uc + f.nx * BASES.ENTRY_PROBE, f.z0 + f.rz * uc + f.nz * BASES.ENTRY_PROBE];
        if (!s && !onRoad(px, pz) && b.groundY - lv.lo > BASES.STEP_RISE * 1.5 + 1e-6) floating.push(i);
      }
    }
    expect(entries).toBeGreaterThan(8000);
    expect(buried).toEqual([]);
    expect(floating).toEqual([]);
    // Las escalas son la excepción, no la regla.
    expect(withSteps).toBeGreaterThan(500);
    expect(withSteps / entries).toBeLessThan(0.35);
  }, 120000);

  it('las escalas van sobre el andén, no salen de más y se pueden subir', () => {
    const c = city();
    const list = c.props.filter((p) => p.type === 'steps');
    expect(list.length).toBeGreaterThan(500);
    for (const s of list.slice(0, 400)) {
      expect(s.n).toBeGreaterThanOrEqual(1);
      expect(s.n * s.tread).toBeLessThanOrEqual(BASES.STEPS_MAX_OUT + 1e-6);
      expect(s.rise).toBeLessThanOrEqual(BASES.STEP_MAX + 0.05);
      const nx = Math.sin(s.rot);
      const nz = Math.cos(s.rot);
      // El escalón de arriba (pegado a la fachada) queda a lo sumo un
      // contrapaso bajo el piso (si el andén sube ahí, se pisa el andén).
      const b = c.buildings[s.building];
      const top = groundHeight(s.x + nx * 0.05, s.z + nz * 0.05);
      expect(top).toBeGreaterThanOrEqual(b.groundY - s.rise - 1e-6);
      expect(top).toBeLessThanOrEqual(b.groundY + 0.02);
      // Al pie de las escalas: el andén.
      const out = s.n * s.tread + 0.15;
      expect(onRoad(s.x + nx * out, s.z + nz * out)).toBe(false);
    }
  });

  it('fachadas escalonadas: tramos anchos, cada uno a su nivel', () => {
    const c = city();
    const pieces = c.buildings.filter((b) => b.split);
    expect(pieces.length).toBeGreaterThan(300);
    for (const b of pieces) expect(2 * b.frame.hu).toBeGreaterThanOrEqual(BASES.SPLIT_MIN_W - 1e-6);
  });

  it('el cuarto de cada local: hueco dentro del lote o el piso sobre el terreno', () => {
    const c = city();
    const blocks = new Map(c.blocks.map((bl) => [bl.id, bl]));
    let cut = 0;
    let raised = 0;
    for (let i = 0; i < c.buildings.length; i++) {
      const b = c.buildings[i];
      const L = facadeLayout(b, i);
      if (!L?.shop) continue;
      const f = faceFrame(b, b.front ?? 'S');
      const rect = shopRoomRect(f, L.shop, L.shop.depth);
      if (b.cutRoom !== undefined) {
        cut++;
        const lot = blocks.get(b.block).lots[b.cutRoom];
        for (const [x, z] of rect) expect(pointInPoly(x, z, lot)).toBe(true);
      } else {
        raised++;
        // Sin hueco: el terreno no se asoma dentro del cuarto.
        for (const t of [0.1, 0.5, 0.9]) {
          const u = L.shop.u0 + (L.shop.u1 - L.shop.u0) * t;
          const d = L.shop.depth * 0.9;
          const y = terrainHeight(f.x0 + f.rx * u - f.nx * d, f.z0 + f.rz * u - f.nz * d) + GRID.curb;
          expect(y).toBeLessThanOrEqual(b.groundY - BASES.SHOP_MARGIN + 0.25);
        }
      }
    }
    expect(cut).toBeGreaterThan(1000);
    expect(raised).toBeGreaterThan(0);
  });

  it('la base visible usa zócalo o muro de contención, nunca la textura de la fachada', () => {
    const c = city();
    const allowed = new Set(['muro', 'trim', 'detail', 'piedra', 'gres', 'granito', 'paintedBrick', 'plaster0', 'brick0', 'brick1', 'brick2']);
    const used = new Set();
    let walls = 0;
    // Una muestra de edificios en loma (los de base alta en algún costado).
    let n = 0;
    for (let i = 0; i < c.buildings.length && n < 300; i++) {
      const b = c.buildings[i];
      if (b.interior) continue;
      const f = faceFrame(b, 'W');
      const drop = b.groundY - walkLevel(f.x0 + f.nx * 0.12, f.z0 + f.nz * 0.12);
      if (drop < 0.6) continue;
      n++;
      const geo = new Map();
      const G = (key) => {
        used.add(key);
        if (!geo.has(key)) {
          const g = { ys: [], idx: [], vertex: (x, y) => g.ys.push(y) - 1, quad: (...p) => p.slice(0, 4).forEach((v) => g.ys.push(v[1])) };
          geo.set(key, g);
        }
        return geo.get(key);
      };
      addBuildingBase(G, b, facadeLayout(b, i), i);
      if (geo.has('muro')) walls++;
      // Nada por encima del primer piso: la base llega justo hasta el piso.
      for (const g of geo.values()) for (const y of g.ys) expect(y).toBeLessThanOrEqual(b.groundY + 1e-6);
    }
    expect(n).toBe(300);
    expect(walls).toBeGreaterThan(20);
    for (const k of used) expect(allowed.has(k)).toBe(true);
  });

  it('el andén frente a la entrada se mide con la calzada a su nivel', () => {
    // walkLevel: andén = terreno + sardinel; calzada = terreno.
    const c = city();
    const b = c.buildings[streetFacing(c)[0]];
    const fr = b.frame;
    const x = fr.x + fr.nx * (fr.hv + 0.6);
    const z = fr.z + fr.nz * (fr.hv + 0.6);
    expect(walkLevel(x, z)).toBeCloseTo(terrainHeight(x, z) + (onRoad(x, z) ? 0 : GRID.curb), 9);
  });
});
