// Nivel de búsqueda policial (0 a 5 estrellas) y lo que la policía sabe del
// jugador: la última posición conocida (compartida por radio) y la zona de
// búsqueda alrededor de ella. La policía NO conoce la posición real del
// jugador: solo la que alguien vio o reportó.

export const CRIMES = {
  shotsFired: 1, // disparos cerca de gente
  assault: 1,
  carjack: 1,
  murder: 2, // matar a un civil: mínimo 2 estrellas
  copAssault: 3,
  copKill: 1, // suma una estrella más
};

export const SEARCH = {
  zoneBase: 40, // radio (m) de la zona de búsqueda con 0 estrellas…
  zonePerStar: 14, // …más esto por estrella
  zoneGrow: 1.5, // m/s que crece mientras no te ven (hasta x1.6)
  lead: 0.6, // la zona se corre hacia donde ibas (s de ventaja)
  insideRate: 0.4, // dentro de la zona el tiempo para perder estrellas corre más lento
};

export class WantedSystem {
  constructor() {
    this.level = 0;
    this.unseenTimer = 0;
    this.flash = 0;
    this.lastKnown = null; // {x, z}
    this.lastVel = { x: 0, z: 0 };
    this.sinceSeen = Infinity;
  }

  /** Tiempo sin ser visto necesario para bajar una estrella. */
  cooldownFor(level) {
    return 10 + level * 6;
  }

  /** Delito: sube el nivel y, si hay posición, los testigos la reportan. */
  report(crime, pos = null) {
    const before = this.level;
    if (crime === 'copKill' || crime === 'murderRepeat') this.level = Math.min(5, this.level + 1);
    else this.level = Math.max(this.level, CRIMES[crime] ?? 1);
    if (crime === 'murder' && before >= 2) this.level = Math.min(5, this.level + 1);
    if (this.level !== before) this.flash = 2;
    this.unseenTimer = 0;
    if (pos) this.spot(pos.x, pos.z);
    return this.level;
  }

  /** Un policía (o un testigo) ve al jugador en (x, z). */
  spot(x, z, vx = 0, vz = 0) {
    this.lastKnown = { x, z };
    this.lastVel = { x: vx, z: vz };
    this.sinceSeen = 0;
  }

  /** Radio de la zona de búsqueda: crece mientras no te ven. */
  zoneRadius() {
    if (this.level === 0 || !this.lastKnown) return 0;
    const base = SEARCH.zoneBase + SEARCH.zonePerStar * this.level;
    return Math.min(base * 1.6, base + Math.min(this.sinceSeen, 60) * SEARCH.zoneGrow);
  }

  /** Centro de la zona: la última posición, corrida hacia donde se movía. */
  zoneCenter() {
    if (!this.lastKnown) return null;
    const t = Math.min(this.sinceSeen, 6) * SEARCH.lead;
    return { x: this.lastKnown.x + this.lastVel.x * t, z: this.lastKnown.z + this.lastVel.z * t };
  }

  inZone(x, z) {
    const c = this.zoneCenter();
    return !!c && Math.hypot(x - c.x, z - c.z) < this.zoneRadius();
  }

  /**
   * seenByPolice: algún policía ve al jugador ahora. pos (opcional): posición
   * real del jugador {x, z, vx?, vz?}; si lo ven, actualiza lo que sabe la
   * policía, y si no, sirve para saber si sigue dentro de la zona.
   */
  update(dt, seenByPolice, pos = null) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);
    if (this.level === 0) return 0;
    if (seenByPolice) {
      this.unseenTimer = 0;
      if (pos) this.spot(pos.x, pos.z, pos.vx ?? 0, pos.vz ?? 0);
      return this.level;
    }
    this.sinceSeen += dt;
    const rate = pos && this.inZone(pos.x, pos.z) ? SEARCH.insideRate : 1;
    this.unseenTimer += dt * rate;
    if (this.unseenTimer >= this.cooldownFor(this.level)) {
      this.level -= 1;
      this.unseenTimer = 0;
      if (this.level === 0) this.lastKnown = null;
    }
    return this.level;
  }

  clear() {
    this.level = 0;
    this.unseenTimer = 0;
    this.lastKnown = null;
    this.sinceSeen = Infinity;
  }

  /** Cuántas patrullas deberían estar buscando. */
  desiredUnits() {
    return [0, 1, 2, 3, 5, 6][this.level];
  }
}
