import { describe, expect, it } from 'vitest';
import { Inventory, WEAPONS, WEAPON_BY_ID, computeDamage } from '../../src/sim/weapons.js';
import { makeRng } from '../../src/sim/rng.js';

const tick = (inv, seconds, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) inv.update(dt);
};

describe('armas e inventario', () => {
  it('empieza con los puños y solo selecciona armas que posee', () => {
    const inv = new Inventory();
    expect(inv.currentId).toBe('fists');
    expect(inv.select('rifle')).toBe(false);
    inv.give('pistol');
    expect(inv.select('pistol')).toBe(true);
    expect(inv.current.name).toBe('Pistola 9 mm');
  });

  it('selección por ranura numérica (1-6)', () => {
    const inv = new Inventory();
    for (const w of WEAPONS) inv.give(w.id);
    for (const w of WEAPONS) {
      inv.selectSlot(w.slot);
      expect(inv.currentId).toBe(w.id);
    }
  });

  it('la rueda del ratón recorre en orden y da la vuelta', () => {
    const inv = new Inventory();
    inv.give('pistol');
    inv.give('shotgun');
    const seen = [];
    for (let i = 0; i < 4; i++) {
      inv.cycle(1);
      seen.push(inv.currentId);
    }
    expect(seen).toEqual(['pistol', 'shotgun', 'fists', 'pistol']);
    inv.cycle(-1);
    expect(inv.currentId).toBe('fists');
  });

  it('no dispara durante el cambio de arma', () => {
    const inv = new Inventory();
    inv.give('pistol');
    inv.select('pistol');
    expect(inv.tryFire(true)).toBeNull();
    inv.tryFire(false);
    tick(inv, 0.4);
    expect(inv.tryFire(true)).not.toBeNull();
  });

  it('semiautomática: un disparo por clic; automática: ráfaga sostenida', () => {
    const inv = new Inventory();
    inv.give('pistol');
    inv.give('smg');
    inv.select('pistol');
    tick(inv, 0.5);
    let shots = 0;
    for (let t = 0; t < 1; t += 1 / 60) {
      if (inv.tryFire(true)) shots++;
      inv.update(1 / 60);
    }
    expect(shots).toBe(1);
    inv.tryFire(false);
    inv.select('smg');
    tick(inv, 0.5);
    shots = 0;
    for (let t = 0; t < 1; t += 1 / 60) {
      if (inv.tryFire(true)?.pellets.length) shots++;
      inv.update(1 / 60);
    }
    // 1 s / 0.075 s ≈ 13 disparos (limitados por la resolución del frame)
    expect(shots).toBeGreaterThanOrEqual(10);
    expect(shots).toBeLessThanOrEqual(14);
  });

  it('consume munición, recarga desde la reserva y respeta el tiempo de recarga', () => {
    const inv = new Inventory();
    inv.give('pistol', 20);
    inv.select('pistol');
    tick(inv, 0.5);
    const w = WEAPON_BY_ID.pistol;
    for (let i = 0; i < w.mag; i++) {
      expect(inv.tryFire(true)).not.toBeNull();
      inv.tryFire(false);
      tick(inv, w.interval + 0.01);
    }
    expect(inv.ammo.mag).toBe(0);
    expect(inv.reloading).toBeGreaterThan(0); // recarga automática
    expect(inv.tryFire(true)).toBeNull();
    inv.tryFire(false);
    tick(inv, w.reload + 0.05);
    expect(inv.ammo.mag).toBe(15);
    expect(inv.ammo.reserve).toBe(5);
  });

  it('recarga manual solo si hace falta y hay reserva', () => {
    const inv = new Inventory();
    inv.give('rifle', 0);
    inv.select('rifle');
    tick(inv, 0.5);
    expect(inv.reload()).toBe(false); // cargador lleno
    inv.tryFire(true);
    expect(inv.reload()).toBe(false); // sin reserva
    inv.addAmmo('rifle', 10);
    expect(inv.reload()).toBe(true);
  });

  it('cambiar de arma cancela la recarga', () => {
    const inv = new Inventory();
    inv.give('pistol');
    inv.select('pistol');
    tick(inv, 0.5);
    inv.tryFire(true);
    inv.reload();
    inv.select('fists');
    expect(inv.reloading).toBe(0);
    inv.select('pistol');
    tick(inv, 3);
    expect(inv.ammo.mag).toBe(14);
  });

  it('sin munición: clic en vacío', () => {
    const inv = new Inventory();
    inv.give('pistol', 0);
    inv.select('pistol');
    tick(inv, 0.5);
    inv.ammo.mag = 0;
    const r = inv.tryFire(true);
    expect(r.empty).toBe(true);
    expect(r.pellets.length).toBe(0);
  });

  it('la escopeta dispara perdigones dentro del cono de dispersión', () => {
    const inv = new Inventory();
    inv.give('shotgun');
    inv.select('shotgun');
    tick(inv, 0.5);
    const rng = makeRng(3);
    const r = inv.tryFire(true, rng.next);
    expect(r.pellets.length).toBe(9);
    const maxSpread = inv.spread(false, false) + 1e-9;
    for (const p of r.pellets) expect(Math.hypot(p.dYaw, p.dPitch)).toBeLessThanOrEqual(maxSpread * 1.2);
  });

  it('apuntar reduce la dispersión y moverse la aumenta', () => {
    const inv = new Inventory();
    inv.give('rifle');
    inv.select('rifle');
    expect(inv.spread(true, false)).toBeLessThan(inv.spread(false, false));
    expect(inv.spread(false, true)).toBeGreaterThan(inv.spread(false, false));
  });

  it('la reserva tiene tope', () => {
    const inv = new Inventory();
    inv.give('pistol');
    inv.addAmmo('pistol', 10000);
    expect(inv.owned.get('pistol').reserve).toBe(WEAPON_BY_ID.pistol.maxReserve);
  });

  it('daño: caída con la distancia y multiplicador de cabeza', () => {
    const r = WEAPON_BY_ID.rifle;
    expect(computeDamage(r, 10, false)).toBe(r.damage);
    expect(computeDamage(r, 200, false)).toBeLessThan(r.damage);
    expect(computeDamage(r, 10, true)).toBeCloseTo(r.damage * 2.5);
  });

  it('serializa y restaura el inventario', () => {
    const inv = new Inventory();
    inv.give('smg', 50);
    inv.select('smg');
    const copy = Inventory.deserialize(JSON.parse(JSON.stringify(inv.serialize())));
    expect(copy.currentId).toBe('smg');
    expect(copy.ammo.reserve).toBe(inv.ammo.reserve);
    expect(copy.has('fists')).toBe(true);
  });
});
