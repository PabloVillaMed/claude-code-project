import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OUTFIT,
  OPTIONAL,
  ROPA,
  ROPA_BY_ID,
  ROPA_STORES,
  SLOTS,
  buyOrWear,
  deserializeWardrobe,
  newWardrobe,
  priceIn,
  sanitizeOutfit,
  serializeWardrobe,
  storeCatalog,
  takeOff,
  wear,
} from '../../src/sim/ropa.js';
import { LOCALES, SIGN_NAMES } from '../../src/sim/facades.js';
import { city } from './helpers.js';
import { roadAt } from '../../src/sim/terrain.js';

describe('catálogo de ropa paisa', () => {
  it('prendas con id único, parte del cuerpo válida y precio de juego', () => {
    const ids = new Set();
    for (const r of ROPA) {
      expect(ids.has(r.id), r.id).toBe(false);
      ids.add(r.id);
      expect(SLOTS).toContain(r.slot);
      expect(r.price).toBeGreaterThan(0);
      expect(r.price).toBeLessThanOrEqual(400); // ropa: más barata que una pistola ($800)
      expect(r.name.length).toBeGreaterThan(3);
    }
    // De todo lo que se pidió: gorras planas y curvas, busos, camisetas de
    // fútbol, jeans y sudaderas, tenis, chanclas, cadena, canguro, gafas.
    const types = new Set(ROPA.map((r) => r.type));
    for (const t of ['gorra-plana', 'gorra-curva', 'buso', 'camiseta', 'jean', 'sudadera', 'tenis', 'chanclas', 'cadena', 'canguro', 'gafas']) expect(types.has(t), t).toBe(true);
    expect(ROPA_BY_ID['camiseta-verdiblanca'].pattern).toBe('rayas');
    expect(ROPA_BY_ID['camiseta-roja'].color).toBeTruthy();
    // Nada de marcas ni escudos en los nombres.
    for (const r of ROPA) expect(`${r.name} ${r.desc}`).not.toMatch(/nacional|medell[ií]n fc|\bdim\b|nike|adidas|puma/i);
  });

  it('cada almacén vende algo y los remates son más baratos', () => {
    for (const store of Object.keys(ROPA_STORES)) expect(storeCatalog(store).length, store).toBeGreaterThan(4);
    const t = ROPA_BY_ID['camiseta-negra'];
    expect(priceIn(t, 'remates')).toBeLessThan(priceIn(t, 'modapaisa'));
    expect(storeCatalog('deportes').some((r) => r.id === 'camiseta-verdiblanca')).toBe(true);
    expect(storeCatalog('modapaisa').some((r) => r.id === 'camiseta-verdiblanca')).toBe(false);
    expect(storeCatalog('nada')).toEqual([]);
  });

  it('ponerse y quitarse prendas', () => {
    let o = { ...DEFAULT_OUTFIT };
    o = wear(o, 'gorra-plana-negra');
    expect(o.cabeza).toBe('gorra-plana-negra');
    o = wear(o, 'gorra-curva-verde');
    expect(o.cabeza).toBe('gorra-curva-verde');
    o = wear(o, 'buso-negro');
    expect(o.torso).toBe('buso-negro');
    expect(takeOff(o, 'cabeza').cabeza).toBeUndefined();
    // La camiseta no se quita (no se sale sin camisa al barrio).
    expect(takeOff(o, 'torso').torso).toBe('buso-negro');
    expect(OPTIONAL.has('torso')).toBe(false);
  });

  it('comprar descuenta solo la primera vez; lo propio se pone gratis', () => {
    const w = newWardrobe();
    const item = storeCatalog('gorras52').find((r) => r.id === 'gorra-plana-roja');
    expect(buyOrWear(w, item, 10).ok).toBe(false);
    const r = buyOrWear(w, item, 500);
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(item.price);
    expect(r.wardrobe.outfit.cabeza).toBe('gorra-plana-roja');
    const r2 = buyOrWear(r.wardrobe, item, 0);
    expect(r2.ok).toBe(true);
    expect(r2.cost).toBe(0);
  });

  it('guardar y cargar la pinta (y limpiar guardados dañados)', () => {
    let w = newWardrobe();
    for (const id of ['gorra-curva-azul', 'camiseta-verdiblanca', 'sudadera-negra', 'chanclas', 'cadena-dorada', 'canguro-negro', 'gafas-espejo']) w = buyOrWear(w, { ...ROPA_BY_ID[id] }, 9999).wardrobe;
    const saved = JSON.parse(JSON.stringify(serializeWardrobe(w)));
    const back = deserializeWardrobe(saved);
    expect(back.outfit).toEqual(w.outfit);
    expect([...back.owned].sort()).toEqual([...w.owned].sort());
    expect(back.outfit).toMatchObject({ cabeza: 'gorra-curva-azul', torso: 'camiseta-verdiblanca', piernas: 'sudadera-negra', pies: 'chanclas', cuello: 'cadena-dorada', cintura: 'canguro-negro', ojos: 'gafas-espejo' });
    // Guardado viejo (sin ropa) o dañado: la pinta de siempre.
    expect(deserializeWardrobe(null).outfit).toEqual(DEFAULT_OUTFIT);
    expect(deserializeWardrobe({ outfit: { torso: 'nada', cabeza: 'jean-azul' }, owned: 'x' }).outfit).toEqual(DEFAULT_OUTFIT);
    expect(sanitizeOutfit({ torso: 'buso-rojo' }).piernas).toBe('jean-azul');
    // Lo puesto siempre queda como propio.
    expect(deserializeWardrobe({ outfit: { torso: 'buso-rojo' } }).owned.has('buso-rojo')).toBe(true);
  });
});

describe('almacenes de ropa en el barrio', () => {
  it('cinco almacenes en la 92 y en Carabobo, con aviso y vitrina de ropa', () => {
    const c = city();
    const stores = c.pois.filter((p) => p.type === 'ropa');
    expect(stores.length).toBe(5);
    for (const p of stores) {
      expect(ROPA_STORES[p.store], p.id).toBeTruthy();
      const b = c.buildings.find((q) => q.local?.name === p.name);
      expect(b, p.name).toBeTruthy();
      expect(b.style).toBe('tienda');
      expect(b.local.kind).toBe('ropa');
      expect(LOCALES.find(([n]) => n === p.name)?.[1]).toBe('ropa');
      expect(SIGN_NAMES.some(([n]) => n === p.name)).toBe(true);
      // Da a la calle que le corresponde.
      const f = b.frame;
      const r = roadAt(f.x + f.nx * (f.hv + 4), f.z + f.nz * (f.hv + 4), 1);
      expect(r, p.name).toBeTruthy();
      expect(Math.hypot(p.x - (f.x + f.nx * f.hv), p.z - (f.z + f.nz * f.hv))).toBeLessThan(8);
    }
    const names = stores.map((p) => p.name).join(' ');
    expect(names).toMatch(/Almacén/);
    expect(names).toMatch(/Boutique/);
    expect(names).toMatch(/Remates/);
    expect(names).toMatch(/Deportes/);
  });
});
