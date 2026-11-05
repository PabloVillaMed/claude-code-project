// Vida de la calle en el juego: los muchachos de las plazas (con la pinta de
// su banda) y los habitantes de calle aparecen solo cerca del jugador; los
// habitantes de calle piden plata al que pasa caminando (E: darle $100), el
// campanero avisa cuando llega la policía y, muy de vez en cuando, otra banda
// se mete a una plaza y se arma una balacera. Dónde, quiénes y cuándo salen
// de sim/streetLife.js (puro y probado); aquí solo la escena.

import { BAND_BY_ID, buildStreetLife, nextWarDelay, pickWar } from '../sim/streetLife.js';
import { groundHeight } from '../sim/terrain.js';
import { applyOutfit } from '../render/outfit.js';

const TICK = 0.25; // s entre revisiones (aparecer, hablar, alertas)
const BEG_RANGE = 3.4; // m: a esta distancia el habitante de calle le pide al jugador
export const GIVE = 100; // los cien pesitos
const HARAPOS = ['harapo', 'harapo-gris'];
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class StreetLife {
  constructor(game) {
    this.game = game;
    const { plazas, homeless } = buildStreetLife(game.city);
    this.plazas = plazas.map((p) => ({ ...p, members: [], talkAt: 0, warnAt: 0 }));
    this.homeless = homeless.map((h) => ({ ...h, ped: null, begAt: 0, gaveAt: -Infinity }));
    this.t = 0;
    this.tick = 0;
    this.war = null;
    this.wars = 0;
    this.nextWar = nextWarDelay();
    this.beggar = null; // {spot, ped, until}: al que se le puede dar con E
    this.talkAt = 0; // pausa global entre frases de las plazas
    this.leftovers = []; // los que llegaron a la balacera y se van
    game.events?.on('shot', (e) => this._onShot(e));
  }

  /** Muchachos por plaza: 2 en Baja y Media, 3 en Alta y Ultra. */
  get perPlaza() {
    return (this.game.quality?.peds ?? 30) >= 40 ? 3 : 2;
  }

  update(dt) {
    const g = this.game;
    if (g.state !== 'playing' || !g.world || !g.player) return;
    this.t += dt;
    if (this.war) this._updateWar(dt);
    this.tick -= dt;
    if (this.tick > 0) return;
    this.tick = TICK;
    const alive = new Set(g.world.peds);
    this._spawns(alive);
    this._alerts();
    this._talk();
    this._schedule();
  }

  // ------------------------------------------------------------ aparecer y desaparecer
  _spawns(alive) {
    const g = this.game;
    const p = g.player;
    const near = g.quality.pedDraw ?? 90;
    for (const q of this.plazas) {
      q.members = q.members.filter((m) => alive.has(m));
      const d = d2(q, p);
      const busy = this.war && (this.war.plaza === q || q.members.some((m) => m.war));
      if (!q.members.length && d < near * 0.85 && d > 10) this._fillPlaza(q);
      else if (q.members.length && d > near * 1.15 && !busy) {
        for (const m of q.members) g.world.removePed(m);
        q.members = [];
      }
    }
    for (const h of this.homeless) {
      if (h.ped && !alive.has(h.ped)) h.ped = null;
      const d = d2(h, p);
      if (!h.ped && d < near * 0.8 && d > 9) h.ped = this._spawnHomeless(h);
      else if (h.ped && d > near * 1.15) {
        g.world.removePed(h.ped);
        h.ped = null;
      }
    }
    this.leftovers = this.leftovers.filter((m) => alive.has(m));
  }

  _fillPlaza(q) {
    const n = Math.min(this.perPlaza, q.spots.length);
    for (let i = 0; i < n; i++) q.members.push(this._spawnMember(q, q.spots[i], i, q.band));
  }

  /** Un muchacho de la banda `band` parado en `spot` (i = 0: el campanero, que vigila la esquina). */
  _spawnMember(q, spot, i, band) {
    const w = this.game.world;
    const m = w.spawnPedAt(spot.x, spot.z, { outfit: 'gang', faction: 'banda', health: 100 });
    m.band = band;
    m.plaza = q;
    const s = m.sim;
    s.fixed = true;
    s.mode = 'idle';
    s.speed = 0;
    s.yaw = spot.yaw + (w.rng.next() - 0.5) * 0.8;
    m.walkStyle = 'cool';
    // El campanero mira para todos lados; los otros, en el celular (los que
    // llegan a la balacera, i < 0, vienen a lo que vienen).
    m.fixedActivity = i === 1 ? 'phone' : i === 2 ? 'text' : null;
    m.idleClip = i === 0 ? 'idle_look' : null;
    applyOutfit(m.rig, BAND_BY_ID[band]?.outfit);
    return m;
  }

  _spawnHomeless(h) {
    const w = this.game.world;
    const p = w.spawnPedAt(h.x, h.z, { outfit: 'civil', health: 70 });
    p.calle = true;
    const s = p.sim;
    if (h.walks) {
      // Camina despacio por el andén (y se queda cerca: si se aleja mucho, se recicla).
      p.walkStyle = 'stroll';
      if (s.walkSpeed) s.walkSpeed *= 0.7;
    } else {
      s.fixed = true;
      s.mode = 'idle';
      s.speed = 0;
      s.yaw = h.yaw;
    }
    p.idleClip = 'idle_wait';
    applyOutfit(p.rig, { torso: HARAPOS[p.id % HARAPOS.length], piernas: 'pantalon-viejo', pies: 'chanclas-viejas', hombro: 'cobija' });
    return p;
  }

  // ------------------------------------------------------------ provocaciones
  /** Si el jugador dispara junto a una plaza, los de la plaza se le voltean. */
  _onShot(e) {
    if (e.by !== 'player') return;
    for (const q of this.plazas) if (q.members.length && Math.hypot(q.x - e.x, q.z - e.z) < 22) for (const m of q.members) m.alerted = true;
  }

  _alerts() {
    const g = this.game;
    const p = g.player;
    for (const q of this.plazas) {
      if (!q.members.length) continue;
      // Si a uno lo atacan, salen todos.
      if (q.members.some((m) => m.alerted && m.alive)) for (const m of q.members) m.alerted = m.alive;
      for (const m of q.members) {
        if (!m.alive || m.war) continue;
        if (m.alerted) {
          if (!m.weapon) this._arm(m);
          m.sim.fixed = false;
          // Lejos o con el jugador muerto se calma la cosa: se recicla al alejarse.
          if (p.dead || d2(m, p) > 75) {
            g.world.removePed(m);
            continue;
          }
        } else if (m.hideAt && this.t > m.hideAt) {
          m.hideAt = 0;
          m.weapon = null;
          m.rig.setWeapon(null);
        }
      }
    }
  }

  _arm(m, rand = Math.random) {
    m.weapon = rand() < 0.3 ? 'smg' : 'pistol';
    m.rig.setWeapon(m.weapon);
    m.fireCooldown = 0.4 + rand() * 1.2;
  }

  // ------------------------------------------------------------ hablar
  _talk() {
    const g = this.game;
    const p = g.player;
    const dlg = g.dialogue;
    if (!dlg || p.dead) return;
    const onFoot = !p.inVehicle;
    // Habitante de calle: le pide al que pasa caminando.
    if (this.beggar && (this.t > this.beggar.until || !this.beggar.ped.alive)) {
      const b = this.beggar;
      this.beggar = null;
      if (b.ped.alive && d2(b.ped, p) > 4 && Math.random() < 0.35) dlg.speak(b.ped, 'limosna_nada');
    }
    if (onFoot && !this.beggar && p.speed < 4 && !p.aiming && (g.wanted?.level ?? 0) === 0) {
      for (const h of this.homeless) {
        const q = h.ped;
        if (!q?.alive || q.sim.mode === 'flee' || this.t < h.begAt || this.t - h.gaveAt < 600) continue;
        if (d2(q, p) > BEG_RANGE) continue;
        h.begAt = this.t + 70;
        if (!dlg.speak(q, 'limosna')) continue;
        // Se voltea a mirarlo y espera.
        q.sim.yaw = Math.atan2(p.x - q.x, p.z - q.z);
        if (!q.sim.fixed) {
          q.sim.mode = 'idle';
          q.sim.speed = 0;
          q.sim.timer = 6;
        }
        this.beggar = { spot: h, ped: q, until: this.t + 6 };
        if (p.money >= GIVE) g.hud.help(`Presiona <kbd>E</kbd> para darle <b>$${GIVE}</b>.`, 5);
        break;
      }
    }
    // Los de la plaza cuando el jugador se arrima (a pie, sin armas en la mano).
    if (onFoot && this.t > this.talkAt) {
      for (const q of this.plazas) {
        if (this.t < q.talkAt || !q.members.length || d2(q, p) > 7) continue;
        const m = q.members.find((x) => x.alive && !x.alerted && !x.war && d2(x, p) < 5);
        if (!m) continue;
        q.talkAt = this.t + 45;
        if (dlg.speak(m, 'banda')) {
          m.sim.yaw = Math.atan2(p.x - m.x, p.z - m.z);
          this.talkAt = this.t + 14;
        }
        break;
      }
    }
    // El campanero cuando ve a la policía.
    const cops = [...g.world.peds.filter((x) => x.faction === 'police' && x.alive), ...g.world.vehicles.filter((v) => v.kind === 'police').map((v) => v.state)];
    if (!cops.length) return;
    for (const q of this.plazas) {
      const m = q.members[0];
      if (!m?.alive || m.alerted || m.war || this.t < q.warnAt) continue;
      if (!cops.some((c) => Math.hypot(c.x - q.x, c.z - q.z) < 40)) continue;
      q.warnAt = this.t + 90;
      dlg.speak(m, 'campanero');
    }
  }

  /** E cerca de un habitante de calle que acaba de pedir: le da los cien pesitos. Devuelve si lo atendió. */
  give() {
    const g = this.game;
    const b = this.beggar;
    const p = g.player;
    if (!b || this.t > b.until || !b.ped.alive || d2(b.ped, p) > 4.5) return false;
    if (p.money < GIVE) {
      g.hud.toast('No te alcanza ni pa\' los cien pesitos.');
      return true;
    }
    g.addMoney(-GIVE);
    g.hud.toast(`<span style="color:#e8b64c">-$${GIVE}</span> · Le diste cien pesitos`, 2.5);
    b.spot.gaveAt = this.t;
    this.beggar = null;
    g.dialogue?.interrupt(b.ped);
    g.dialogue?.speak(b.ped, 'limosna_gracias');
    b.ped.rig.play?.('wave', { fadeIn: 0.25 });
    g.stats.limosnas = (g.stats.limosnas ?? 0) + 1;
    return true;
  }

  // ------------------------------------------------------------ balaceras
  _schedule() {
    const g = this.game;
    if (this.war || this.t < this.nextWar) return;
    const p = g.player;
    const calm = !p.dead && (g.wanted?.level ?? 0) === 0 && !g.storyDir?.cinematic && !g.intro && !g.missions?.active;
    const pair = calm ? pickWar(this.plazas, p.x, p.z) : null;
    if (!pair) {
      this.nextWar = this.t + 30; // se vuelve a intentar en un rato
      return;
    }
    // La plaza que se ataca es la más cercana al jugador (se oye y se ve).
    const [def, att] = d2(pair.a, p) < d2(pair.b, p) ? [pair.a, pair.b] : [pair.b, pair.a];
    this.startWar(def, att.band);
  }

  /**
   * Otra banda (`band`) se mete a la plaza `q`: llegan 2-3 muchachos por el
   * lado de la otra banda, donde vean la esquina, y se dan bala con los de la
   * plaza. Devuelve la balacera o null si no hay desde dónde.
   */
  startWar(q, band, rand = Math.random) {
    const g = this.game;
    if (this.war || !q) return null;
    if (!q.members.length) this._fillPlaza(q);
    const defenders = q.members.filter((m) => m.alive);
    if (!defenders.length) return null;
    // Desde dónde llegan: 22-34 m de la esquina, con línea de vista.
    const from = this.plazas.filter((x) => x.band === band).sort((a, b) => d2(a, q) - d2(b, q))[0] ?? q;
    const toward = Math.atan2(from.x - q.x, from.z - q.z);
    let start = null;
    for (let k = 0; k < 16 && !start; k++) {
      const a = toward + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35;
      const r = 22 + rand() * 12;
      const c = { x: q.x + Math.sin(a) * r, z: q.z + Math.cos(a) * r };
      if (g.city.collision.pointBlocked(c.x, c.z)) continue;
      if (g.combat.lineOfSight({ x: c.x, y: groundHeight(c.x, c.z) + 1.45, z: c.z }, { x: q.x, y: groundHeight(q.x, q.z) + 1.2, z: q.z })) start = c;
    }
    if (!start) return null;
    const war = { plaza: q, band, t: 0, dur: 16 + rand() * 16, attackers: [], defenders, threatT: 0 };
    const n = this.perPlaza;
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(q.x - start.x, q.z - start.z) + Math.PI / 2;
      const off = (i - (n - 1) / 2) * 2.2;
      const spot = { x: start.x + Math.sin(a) * off, z: start.z + Math.cos(a) * off, yaw: a - Math.PI / 2 };
      if (g.city.collision.pointBlocked(spot.x, spot.z)) continue;
      war.attackers.push(this._spawnMember(null, spot, -1, band));
    }
    if (!war.attackers.length) return null;
    for (const m of [...war.attackers, ...defenders]) {
      m.war = war;
      m.alerted = false;
      m.fixedActivity = null;
      m.sim.fixed = true;
      m.sim.mode = 'idle';
      m.sim.speed = 0;
      this._arm(m, rand);
    }
    this.war = war;
    this.wars++;
    g.dialogue?.speak(defenders[0], 'balacera');
    const p = g.player;
    if (d2(q, p) < 170) g.hud.toast(`Balacera: ${BAND_BY_ID[band]?.name ?? 'otra banda'} se metieron donde ${BAND_BY_ID[q.band]?.name ?? 'la plaza'}`, 4);
    return war;
  }

  _updateWar(dt) {
    const g = this.game;
    const war = this.war;
    war.t += dt;
    const side = (list) => list.filter((m) => m.alive && g.world.peds.includes(m));
    const att = side(war.attackers);
    const def = side(war.defenders);
    // El barrio sale corriendo y los carros se asustan.
    war.threatT -= dt;
    if (war.threatT <= 0) {
      war.threatT = 1;
      g.world.addThreat(war.plaza.x, war.plaza.z, 55, 1.2);
    }
    if (war.t > war.dur || !att.length || !def.length) return this._endWar();
    for (const [mine, theirs] of [[att, def], [def, att]]) {
      for (const m of mine) {
        m.fireCooldown -= dt;
        if (m.fireCooldown > 0) continue;
        let target = theirs[0];
        for (const o of theirs) if (d2(o, m) < d2(target, m)) target = o;
        const shot = g.combat.npcShootAt(m, target, { spread: 0.075 });
        // Subametralladora: ráfagas cortas; pistola: tiros sueltos. Sin vista, se asoma después.
        if (!shot) m.fireCooldown = 0.7 + Math.random() * 0.8;
        else if (m.weapon === 'smg') m.fireCooldown = (m.burst = ((m.burst ?? 0) + 1) % 4) ? 0.1 : 1.4 + Math.random() * 1.2;
        else m.fireCooldown = 0.55 + Math.random() * 1.1;
      }
    }
  }

  _endWar() {
    const war = this.war;
    this.war = null;
    this.nextWar = this.t + nextWarDelay();
    for (const m of war.defenders) {
      if (!m.alive) continue;
      m.war = null;
      m.hideAt = this.t + 4; // se guardan el arma un rato después
    }
    // Los que llegaron se van corriendo (y se reciclan lejos).
    for (const m of war.attackers) {
      if (!m.alive) continue;
      m.war = null;
      m.weapon = null;
      m.rig.setWeapon(null);
      m.sim.fixed = false;
      m.sim.mode = 'flee';
      m.sim.fleeFrom = { x: war.plaza.x, z: war.plaza.z };
      m.sim.timer = 15;
      this.leftovers.push(m);
    }
  }

  /** Estado legible (pruebas y depuración). */
  state() {
    return {
      plazas: this.plazas.length,
      homeless: this.homeless.length,
      members: this.plazas.reduce((n, q) => n + q.members.length, 0),
      homelessIn: this.homeless.filter((h) => h.ped).length,
      war: this.war ? { plaza: this.war.plaza.id, band: this.war.band, t: +this.war.t.toFixed(1), attackers: this.war.attackers.filter((m) => m.alive).length, defenders: this.war.defenders.filter((m) => m.alive).length } : null,
      wars: this.wars,
      nextWarIn: Math.max(0, Math.round(this.nextWar - this.t)),
      beggar: this.beggar ? this.beggar.spot.id : null,
    };
  }
}
