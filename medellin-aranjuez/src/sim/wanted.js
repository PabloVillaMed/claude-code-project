// Nivel de búsqueda policial (0 a 5 estrellas).

export const CRIMES = {
  shotsFired: 1, // disparos cerca de gente
  assault: 1,
  carjack: 1,
  murder: 2, // matar a un civil: mínimo 2 estrellas
  copAssault: 3,
  copKill: 1, // suma una estrella más
};

export class WantedSystem {
  constructor() {
    this.level = 0;
    this.unseenTimer = 0;
    this.flash = 0;
  }

  /** Tiempo sin ser visto necesario para bajar una estrella. */
  cooldownFor(level) {
    return 10 + level * 6;
  }

  report(crime) {
    const before = this.level;
    if (crime === 'copKill' || crime === 'murderRepeat') this.level = Math.min(5, this.level + 1);
    else this.level = Math.max(this.level, CRIMES[crime] ?? 1);
    if (crime === 'murder' && before >= 2) this.level = Math.min(5, this.level + 1);
    if (this.level !== before) this.flash = 2;
    this.unseenTimer = 0;
    return this.level;
  }

  update(dt, seenByPolice) {
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);
    if (this.level === 0) return 0;
    if (seenByPolice) {
      this.unseenTimer = 0;
      return this.level;
    }
    this.unseenTimer += dt;
    if (this.unseenTimer >= this.cooldownFor(this.level)) {
      this.level -= 1;
      this.unseenTimer = 0;
    }
    return this.level;
  }

  clear() {
    this.level = 0;
    this.unseenTimer = 0;
  }

  /** Cuántas patrullas deberían estar persiguiendo. */
  desiredUnits() {
    return [0, 1, 2, 3, 5, 6][this.level];
  }
}
