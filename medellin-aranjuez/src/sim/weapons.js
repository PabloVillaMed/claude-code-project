// Armas e inventario: selección por número/rueda, cadencia semiautomática y
// automática, cargador, reserva, recarga, tiempo de cambio y dispersión.

export const WEAPONS = [
  { id: 'fists', name: 'Puños', slot: 1, kind: 'melee', damage: 18, range: 1.9, interval: 0.42, auto: false, price: 0, icon: '✊' },
  { id: 'machete', name: 'Machete', slot: 2, kind: 'melee', damage: 55, range: 2.3, interval: 0.62, auto: false, price: 250, icon: '🔪' },
  { id: 'pistol', name: 'Pistola 9 mm', slot: 3, kind: 'gun', damage: 30, range: 120, interval: 0.2, auto: false, mag: 15, reload: 1.3, spread: 0.012, pellets: 1, maxReserve: 180, ammoPrice: 60, price: 800, icon: '🔫', loud: 1 },
  { id: 'smg', name: 'Subametralladora', slot: 4, kind: 'gun', damage: 19, range: 90, interval: 0.075, auto: true, mag: 30, reload: 1.8, spread: 0.03, pellets: 1, maxReserve: 300, ammoPrice: 90, price: 2200, icon: '🔫', loud: 1 },
  { id: 'shotgun', name: 'Escopeta', slot: 5, kind: 'gun', damage: 15, range: 40, interval: 0.85, auto: false, mag: 6, reload: 2.4, spread: 0.075, pellets: 9, maxReserve: 60, ammoPrice: 80, price: 3000, icon: '💥', loud: 1.4 },
  { id: 'rifle', name: 'Fusil de asalto', slot: 6, kind: 'gun', damage: 34, range: 220, interval: 0.105, auto: true, mag: 30, reload: 2.1, spread: 0.016, pellets: 1, maxReserve: 270, ammoPrice: 120, price: 5000, icon: '🎯', loud: 1.3 },
];

export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

const SWITCH_TIME = 0.35;

export class Inventory {
  constructor(ids = ['fists']) {
    this.owned = new Map();
    this.currentId = 'fists';
    this.cooldown = 0;
    this.reloading = 0;
    this.switching = 0;
    this.bloom = 0;
    this.triggerHeld = false;
    for (const id of ids) this.give(id);
  }

  get current() {
    return WEAPON_BY_ID[this.currentId];
  }

  get ammo() {
    return this.owned.get(this.currentId);
  }

  has(id) {
    return this.owned.has(id);
  }

  /** Da un arma (con un cargador lleno y algo de reserva) o suma munición. */
  give(id, reserve = null) {
    const w = WEAPON_BY_ID[id];
    if (!w) throw new Error(`Arma desconocida: ${id}`);
    if (!this.owned.has(id)) {
      this.owned.set(id, { mag: w.mag ?? 0, reserve: 0 });
    }
    if (w.kind === 'gun') this.addAmmo(id, reserve ?? w.mag * 3);
    return this.owned.get(id);
  }

  addAmmo(id, n) {
    const w = WEAPON_BY_ID[id];
    const a = this.owned.get(id);
    if (!a || w.kind !== 'gun') return 0;
    const before = a.reserve;
    a.reserve = Math.min(w.maxReserve, a.reserve + n);
    return a.reserve - before;
  }

  /** Lista ordenada por ranura de las armas que se poseen. */
  ownedList() {
    return WEAPONS.filter((w) => this.owned.has(w.id));
  }

  select(id) {
    if (!this.owned.has(id) || id === this.currentId) return false;
    this.currentId = id;
    this.reloading = 0;
    this.switching = SWITCH_TIME;
    this.triggerHeld = false;
    return true;
  }

  selectSlot(slot) {
    const w = WEAPONS.find((x) => x.slot === slot);
    return w ? this.select(w.id) : false;
  }

  /** Cambia a la siguiente/anterior arma poseída (rueda del ratón). */
  cycle(dir) {
    const list = this.ownedList();
    if (list.length < 2) return false;
    const idx = list.findIndex((w) => w.id === this.currentId);
    const next = list[(idx + (dir > 0 ? 1 : -1) + list.length) % list.length];
    return this.select(next.id);
  }

  canReload() {
    const w = this.current;
    const a = this.ammo;
    return w.kind === 'gun' && this.reloading <= 0 && a.mag < w.mag && a.reserve > 0 && this.switching <= 0;
  }

  reload() {
    if (!this.canReload()) return false;
    this.reloading = this.current.reload;
    return true;
  }

  update(dt, moving = false) {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.switching > 0) this.switching = Math.max(0, this.switching - dt);
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        const w = this.current;
        const a = this.ammo;
        const take = Math.min(w.mag - a.mag, a.reserve);
        a.mag += take;
        a.reserve -= take;
      }
    }
    const target = moving ? 0.5 : 0;
    this.bloom += (target - this.bloom) * Math.min(1, dt * 4);
  }

  /** Dispersión actual en radianes. */
  spread(aiming, moving) {
    const w = this.current;
    if (w.kind !== 'gun') return 0;
    let s = w.spread * (1 + this.bloom);
    if (aiming) s *= 0.5;
    if (moving) s *= 1.5;
    return s;
  }

  /**
   * Intenta disparar. `trigger` indica si el gatillo está presionado este
   * frame. Devuelve null si no dispara, o {weapon, pellets:[{dYaw,dPitch}],
   * empty?} con las desviaciones de cada perdigón.
   */
  tryFire(trigger, rand = Math.random, aiming = false, moving = false) {
    const pressedNow = trigger && !this.triggerHeld;
    this.triggerHeld = trigger;
    if (!trigger) return null;
    const w = this.current;
    if (!w.auto && !pressedNow) return null;
    if (this.cooldown > 0 || this.switching > 0 || this.reloading > 0) return null;
    if (w.kind === 'gun') {
      const a = this.ammo;
      if (a.mag <= 0) {
        this.cooldown = 0.25;
        if (a.reserve > 0) this.reload();
        return { weapon: w, pellets: [], empty: true };
      }
      a.mag -= 1;
    }
    this.cooldown = w.interval;
    const spread = this.spread(aiming, moving);
    const pellets = [];
    const n = w.pellets ?? 1;
    for (let i = 0; i < n; i++) {
      // Distribución en disco para que el cono sea uniforme.
      const r = spread * Math.sqrt(rand());
      const t = rand() * Math.PI * 2;
      pellets.push({ dYaw: Math.cos(t) * r, dPitch: Math.sin(t) * r });
    }
    if (w.kind === 'gun') this.bloom = Math.min(2.5, this.bloom + 0.35);
    if (w.kind === 'gun' && this.ammo.mag === 0 && this.ammo.reserve > 0) this.reload();
    return { weapon: w, pellets };
  }

  serialize() {
    return { current: this.currentId, owned: [...this.owned.entries()] };
  }

  static deserialize(data) {
    const inv = new Inventory([]);
    inv.owned = new Map(data.owned);
    if (!inv.owned.has('fists')) inv.owned.set('fists', { mag: 0, reserve: 0 });
    inv.currentId = inv.owned.has(data.current) ? data.current : 'fists';
    return inv;
  }
}

/** Daño con caída por distancia y multiplicador por disparo a la cabeza. */
export function computeDamage(weapon, distance, headshot) {
  let dmg = weapon.damage;
  if (weapon.kind === 'gun') {
    const falloffStart = weapon.range * 0.5;
    if (distance > falloffStart) dmg *= Math.max(0.35, 1 - (distance - falloffStart) / weapon.range);
  }
  if (headshot) dmg *= 2.5;
  return dmg;
}
