// Diálogos de la calle con voz y subtítulos: saludos cuando el jugador pasa,
// charlas de los vecinos sentados frente a las tiendas, pregones de los
// venteros, reacciones (empujones, carros, disparos, muertos, armas) y la
// policía (gritos y radio de las patrullas).
//
// Solo LEE el estado del juego (peatones, jugador, nivel de búsqueda) y
// escucha los eventos de game.events (disparos, heridos, muertos); no cambia
// la IA. Las voces son archivos Opus generados offline con Piper TTS
// (scripts/assets/voces.mjs); si faltan, igual se muestran los subtítulos.

import { LINES, VOICES, CIVIL_BY_GENDER, POLICE_VOICES, CONVERSATIONS, voiceFile } from './dialogueLines.js';

// =================================================================== partes puras

/** Emisor de eventos mínimo (game.events): on/off/emit. */
export class Emitter {
  constructor() {
    this.handlers = new Map();
  }

  on(ev, fn) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev).add(fn);
    return () => this.off(ev, fn);
  }

  off(ev, fn) {
    this.handlers.get(ev)?.delete(fn);
  }

  emit(ev, data) {
    const hs = this.handlers.get(ev);
    if (!hs) return;
    for (const fn of [...hs]) {
      try {
        fn(data);
      } catch (err) {
        console.error(`[eventos] ${ev}:`, err);
      }
    }
  }
}

/** Mezcla un entero (id de peatón) en 32 bits: misma entrada, misma salida. */
export function hashId(n) {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Voz estable de un peatón: por su id, dentro de las de su género (policías aparte). */
export function voiceForPed(ped) {
  if (ped.faction === 'police') return POLICE_VOICES[hashId(ped.id) % POLICE_VOICES.length];
  const pool = CIVIL_BY_GENDER[ped.look?.female ? 'f' : 'm'];
  return pool[hashId(ped.id) % pool.length];
}

/** ¿La hora h (0..24) cae en [desde, hasta)? El rango puede pasar de medianoche (hasta > 24). */
export function inHours(range, h) {
  if (!range || h == null) return true;
  const [a, b] = range;
  return (h >= a && h < b) || (h + 24 >= a && h + 24 < b);
}

/** Enfriamientos por clave (categoría, peatón, categoría+peatón…) en segundos de juego. */
export class Cooldowns {
  constructor() {
    this.until = new Map();
  }

  ready(key, now) {
    return (this.until.get(key) ?? -Infinity) <= now;
  }

  set(key, now, seconds) {
    this.until.set(key, Math.max(this.until.get(key) ?? -Infinity, now + seconds));
  }

  /** Olvida lo vencido (para que el mapa no crezca con peatones que ya no existen). */
  prune(now) {
    for (const [k, t] of this.until) if (t <= now) this.until.delete(k);
  }
}

/**
 * Elige líneas sin repetir seguidas: por categoría y voz recuerda las últimas
 * (más o menos la mitad de las disponibles) y nunca repite la última línea
 * de la categoría, aunque la diga otra voz.
 */
export class LinePicker {
  constructor(lines = LINES) {
    this.lines = lines;
    this.byCat = new Map();
    for (const l of lines) {
      if (!this.byCat.has(l.cat)) this.byCat.set(l.cat, []);
      this.byCat.get(l.cat).push(l);
    }
    this.recent = new Map();
    this.lastByCat = new Map();
    this.recentConvs = [];
  }

  candidates(cat, { voice = null, hour = null, kind = null } = {}) {
    return (this.byCat.get(cat) ?? []).filter((l) => (!voice || l.voices.includes(voice)) && (!kind || l.kind === kind) && inHours(l.hours, hour));
  }

  pick(cat, opts = {}, rand = Math.random) {
    const c = this.candidates(cat, opts);
    if (!c.length) return null;
    const key = `${cat}|${opts.voice ?? ''}|${opts.kind ?? ''}`;
    const recent = this.recent.get(key) ?? [];
    const last = this.lastByCat.get(cat);
    let pool = c.filter((l) => !recent.includes(l.id) && l.id !== last);
    if (!pool.length) pool = c.filter((l) => l.id !== recent[recent.length - 1] && l.id !== last);
    if (!pool.length) pool = c.filter((l) => l.id !== last);
    if (!pool.length) pool = c;
    const line = pool[Math.floor(rand() * pool.length) % pool.length];
    recent.push(line.id);
    const keep = Math.max(1, Math.ceil(c.length * 0.6));
    while (recent.length > keep) recent.shift();
    this.recent.set(key, recent);
    this.lastByCat.set(cat, line.id);
    return line;
  }

  /** Líneas de la charla n, en orden. */
  conversation(n) {
    return (this.byCat.get('charla') ?? []).filter((l) => l.conv === n).sort((a, b) => a.step - b.step);
  }

  /** Una charla que no se haya oído hace poco (recuerda las últimas ~2/3). */
  pickConversation(rand = Math.random, total = CONVERSATIONS) {
    const free = [];
    for (let i = 0; i < total; i++) if (!this.recentConvs.includes(i)) free.push(i);
    const n = free.length ? free[Math.floor(rand() * free.length) % free.length] : Math.floor(rand() * total) % total;
    this.recentConvs.push(n);
    while (this.recentConvs.length > Math.max(1, Math.floor((total * 2) / 3))) this.recentConvs.shift();
    return n;
  }
}

/** Ganancia por distancia (misma ley que AudioSystem._gainFor) con corte suave en `radius`. */
export function voiceGain(d, ref, radius) {
  const near = Math.min(1, ref / Math.max(ref, d));
  const edge = Math.max(0, Math.min(1, (radius - d) / (radius * 0.3)));
  return near * edge;
}

/** Duración estimada de una línea sin audio (subtítulos solos). */
export const estimateSeconds = (text) => Math.min(6, 0.6 + text.length * 0.055);

// =================================================================== sistema

/**
 * Categorías: prioridad (las más altas interrumpen a las más bajas cuando se
 * llega al límite de voces), radio de alcance (m), distancia de referencia de
 * la atenuación y volumen.
 */
const CATS = {
  saludo: { pri: 1, radius: 18, ref: 4, vol: 0.9 },
  comentario: { pri: 1, radius: 14, ref: 4, vol: 0.8 },
  charla: { pri: 1, radius: 22, ref: 5, vol: 0.9 },
  pregon: { pri: 1, radius: 32, ref: 7, vol: 0.95 },
  empujon: { pri: 3, radius: 22, ref: 5, vol: 1 },
  carro: { pri: 3, radius: 38, ref: 8, vol: 1 },
  golpe: { pri: 3, radius: 30, ref: 6, vol: 1 },
  apuntado: { pri: 3, radius: 26, ref: 5, vol: 1 },
  disparos: { pri: 3, radius: 48, ref: 9, vol: 1 },
  muerte: { pri: 3, radius: 36, ref: 7, vol: 1 },
  policia: { pri: 4, radius: 55, ref: 10, vol: 1 },
  radio: { pri: 2, radius: 30, ref: 6, vol: 0.8 },
};
const catInfo = (cat) => CATS[cat] ?? CATS[cat.split('_')[0]] ?? CATS.charla;

const MAX_VOICES = 2;
const SCAN = 0.1; // s entre revisiones del barrio
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class Dialogue {
  constructor(game) {
    this.game = game;
    game.events ??= new Emitter();
    this.picker = new LinePicker();
    this.cool = new Cooldowns();
    this.rand = Math.random;
    this.now = 0;
    this.scanT = 0;
    this.active = []; // voces sonando (o cargando)
    this.queue = []; // líneas programadas {at, fn}
    this.conv = null; // charla en curso
    this.vendorTimers = new WeakMap();
    this.vendorKinds = new WeakMap();
    this.voices = new WeakMap();
    this.buffers = new Map();
    this.manifest = null;
    this.lastShot = -Infinity;
    this.prevWanted = 0;
    this.log = []; // últimas líneas dichas (depuración y pruebas)
    this.el = typeof document !== 'undefined' ? document.getElementById('subtitles') : null;
    this._loadManifest();
    const ev = game.events;
    ev.on('shot', (e) => this._onShot(e));
    ev.on('explosion', (e) => this._onShot({ ...e, by: 'explosion' }));
    ev.on('pedHurt', (e) => this._onHurt(e));
    ev.on('pedKilled', (e) => this._onKilled(e));
  }

  async _loadManifest() {
    if (typeof fetch === 'undefined') return;
    try {
      const r = await fetch('sounds/voces/manifest.json');
      if (r.ok) this.manifest = await r.json();
    } catch {
      this.manifest = null;
    }
  }

  get subtitlesOn() {
    return this.game.settings?.subtitles !== false;
  }

  voiceOf(ped) {
    let v = this.voices.get(ped);
    if (!v) {
      v = voiceForPed(ped);
      this.voices.set(ped, v);
    }
    return v;
  }

  // ------------------------------------------------------------ bucle
  update(dt, realDt = dt) {
    this.now += dt;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].at <= this.now) {
        const q = this.queue.splice(i, 1)[0];
        q.fn();
      }
    }
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = SCAN;
      this._scan();
    }
    this._updateConversation();
    this._updateVoices(realDt);
    if (this.el) this.el.classList.toggle('hidden', !this.subtitlesOn);
  }

  _scan() {
    const g = this.game;
    const p = g.player;
    const peds = g.world?.peds ?? [];
    if (!p || p.dead) return;
    if ((this._pruneT = (this._pruneT ?? 0) + SCAN) > 20) {
      this._pruneT = 0;
      this.cool.prune(this.now);
    }
    const wanted = g.wanted?.level ?? 0;
    this._police(peds, p, wanted);
    this._reactions(peds, p);
    const calm = wanted === 0 && this.now - this.lastShot > 20 && !p.inVehicle;
    if (calm) this._ambient(peds, p);
    else if (this.conv) this._endConversation();
  }

  // ------------------------------------------------------------ policía
  _police(peds, p, wanted) {
    const g = this.game;
    if (this.prevWanted > 0 && wanted === 0) {
      // Se perdió la búsqueda: la radio de la patrulla más cercana lo cuenta.
      const unit = this._nearestUnit(p, 30);
      if (unit) this._radio(unit, 'fin');
    }
    this.prevWanted = wanted;
    if (wanted === 0) return;
    let cop = null;
    let best = 45;
    let near = 0;
    for (const q of peds) {
      if (q.faction !== 'police' || !q.alive) continue;
      const d = d2(q, p);
      if (d < 30) near++;
      if (d < best && !this._speaking(q)) {
        best = d;
        cop = q;
      }
    }
    const seen = (g.wanted.sinceSeen ?? Infinity) < 1;
    if (cop && this.cool.ready('policia', this.now) && this.cool.ready(cop, this.now)) {
      let cat = null;
      if (seen && best < 32) {
        const armed = p.aiming || p.inventory?.current?.kind === 'gun';
        cat = near >= 2 && this.rand() < 0.35 ? 'policia_rodeo' : armed ? 'policia_arma' : 'policia_alto';
      } else if (!seen && (g.wanted.sinceSeen ?? 0) > 4) cat = 'policia_busca';
      if (cat && this.speak(cop, cat)) {
        this.cool.set('policia', this.now, cat === 'policia_busca' ? 9 + this.rand() * 5 : 3.5 + this.rand() * 2.5);
        this.cool.set(cop, this.now, 7 + this.rand() * 4);
      }
    }
    // Radio de la patrulla más cercana, cada tanto.
    if (this.cool.ready('radio', this.now)) {
      const unit = this._nearestUnit(p, 32);
      if (unit) this._radio(unit, ['radio_central', 'radio_patrulla']);
    }
  }

  _nearestUnit(p, maxD) {
    let best = null;
    let bd = maxD;
    for (const u of this.game.world?.policeUnits ?? []) {
      const s = u.vehicle?.state;
      if (!s || s.destroyed) continue;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < bd) {
        bd = d;
        best = u;
      }
    }
    return best;
  }

  /**
   * Radio de una patrulla: la central habla y la patrulla contesta (o, con
   * 'fin', las dos líneas de cuando se pierde al sospechoso, en orden).
   */
  _radio(unit, cats) {
    this.cool.set('radio', this.now, 16 + this.rand() * 10);
    const st = () => unit.vehicle.state;
    const speaker = {
      radio: unit,
      alive: true,
      get x() {
        return st().x;
      },
      get y() {
        return st().y;
      },
      get z() {
        return st().z;
      },
    };
    const seq =
      cats === 'fin'
        ? this.picker.candidates('radio_fin').map((l) => [l, l.voices[0]])
        : cats
            .map((cat) => {
              const voice = cat === 'radio_central' ? 'r1' : 'r2';
              const l = this.picker.pick(cat, { voice }, this.rand);
              return l && [l, voice];
            })
            .filter(Boolean);
    const say = (i) => {
      if (i >= seq.length) return;
      const u = this.speakLine(speaker, seq[i][0], seq[i][1], { label: 'Radio' });
      if (u) u.onEnd = () => this._later(0.35 + this.rand() * 0.4, () => say(i + 1));
    };
    say(0);
  }

  // ------------------------------------------------------------ reacciones
  _reactions(peds, p) {
    const g = this.game;
    const civ = (q) => q.faction === 'civil' && q.alive && !this._speaking(q);
    // Apuntarle a alguien.
    if (!p.inVehicle && p.aiming && p.inventory?.current?.kind === 'gun' && this.cool.ready('apuntado', this.now)) {
      const yaw = g.camRig?.yaw ?? p.yaw;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      let target = null;
      let bestCos = Math.cos(0.2);
      for (const q of peds) {
        if (!q.alive || q.faction === 'gang') continue;
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 1 || d > 18) continue;
        const c = (dx * fx + dz * fz) / d;
        if (c > bestCos) {
          bestCos = c;
          target = q;
        }
      }
      if (target && this.cool.ready(`apuntado|${target.id}`, this.now) && !this._speaking(target)) {
        const cat = target.faction === 'police' ? 'policia_arma' : 'apuntado';
        if (this.speak(target, cat)) {
          this.cool.set('apuntado', this.now, 2.5);
          this.cool.set(`apuntado|${target.id}`, this.now, 9);
        }
      }
    }
    // Empujones: el jugador a pie se lleva por delante a alguien.
    if (!p.inVehicle && p.speed > 1.2 && this.cool.ready('empujon', this.now)) {
      for (const q of peds) {
        if (!civ(q) || Math.abs(q.x - p.x) > 1 || Math.abs(q.z - p.z) > 1) continue;
        if (d2(q, p) < 0.85 && this.cool.ready(`empujon|${q.id}`, this.now)) {
          if (this.speak(q, 'empujon')) {
            this.cool.set('empujon', this.now, 2.5);
            this.cool.set(`empujon|${q.id}`, this.now, 8);
          }
          break;
        }
      }
    }
    // El carro del jugador pasa rozando a alguien.
    const v = p.vehicle;
    if (v && this.cool.ready('carro', this.now)) {
      const s = v.state;
      const speed = Math.hypot(s.vx, s.vz);
      if (speed > 7) {
        const o = v.obb?.(0);
        for (const q of peds) {
          if (!civ(q) || Math.abs(q.x - s.x) > 7 || Math.abs(q.z - s.z) > 7 || !o) continue;
          const dx = q.x - o.x;
          const dz = q.z - o.z;
          const lx = dx * Math.cos(o.angle) - dz * Math.sin(o.angle);
          const lz = dx * -Math.sin(o.angle) - dz * Math.cos(o.angle);
          const edge = Math.hypot(Math.max(0, Math.abs(lx) - o.hx), Math.max(0, Math.abs(lz) - o.hz));
          if (edge < 2.4 && this.cool.ready(`carro|${q.id}`, this.now)) {
            if (this.speak(q, 'carro')) {
              this.cool.set('carro', this.now, 2.5);
              this.cool.set(`carro|${q.id}`, this.now, 10);
            }
            break;
          }
        }
      }
    }
  }

  _onShot(e) {
    const g = this.game;
    const p = g.player;
    if (!p || !e) return;
    this.lastShot = this.now;
    if (this.conv) this._endConversation();
    if (Math.hypot(e.x - p.x, e.z - p.z) > 60) return;
    // Un civil cerca grita (no todos: la categoría se enfría).
    if (this.cool.ready('disparos', this.now)) {
      const near = [];
      for (const q of g.world?.peds ?? []) {
        if (q.faction !== 'civil' || !q.alive || this._speaking(q)) continue;
        const d = Math.hypot(q.x - e.x, q.z - e.z);
        if (d < 30 && d2(q, p) < 40) near.push([d2(q, p), q]);
      }
      near.sort((a, b) => a[0] - b[0]);
      const pick = near[Math.floor(this.rand() * Math.min(3, near.length))]?.[1];
      if (pick) {
        this.cool.set('disparos', this.now, 3 + this.rand() * 2);
        this._later(0.15 + this.rand() * 0.35, () => pick.alive && this.speak(pick, 'disparos'));
      }
    }
    // A la policía le disparan.
    if (e.by !== 'police' && this.cool.ready('policia_fuego', this.now)) {
      const cop = (g.world?.peds ?? []).find((q) => q.faction === 'police' && q.alive && Math.hypot(q.x - e.x, q.z - e.z) < 35 && !this._speaking(q));
      if (cop && this.speak(cop, 'policia_fuego')) this.cool.set('policia_fuego', this.now, 6 + this.rand() * 3);
    }
  }

  _onHurt(e) {
    const q = e?.ped;
    if (!q || !q.alive) return;
    if (q.faction === 'civil') {
      const cat = e.how === 'impact' ? 'carro' : e.how === 'melee' ? 'golpe' : 'disparos';
      if (this.cool.ready(`golpe|${q.id}`, this.now)) {
        this.cool.set(`golpe|${q.id}`, this.now, 4);
        this.speak(q, cat);
      }
    } else if (q.faction === 'police' && e.attacker === 'player' && this.cool.ready('policia_fuego', this.now)) {
      if (this.speak(q, 'policia_fuego')) this.cool.set('policia_fuego', this.now, 6);
    }
  }

  _onKilled(e) {
    const g = this.game;
    const victim = e?.ped;
    if (!victim || !this.cool.ready('muerte', this.now)) return;
    this.cool.set('muerte', this.now, 6);
    this._later(0.7 + this.rand() * 0.6, () => {
      let w = null;
      let bd = 22;
      for (const q of g.world?.peds ?? []) {
        if (q === victim || !q.alive || q.faction === 'gang' || this._speaking(q)) continue;
        const d = Math.hypot(q.x - victim.x, q.z - victim.z);
        if (d < bd && d2(q, g.player) < 36) {
          bd = d;
          w = q;
        }
      }
      if (w) this.speak(w, w.faction === 'police' ? 'policia_fuego' : 'muerte');
    });
  }

  // ------------------------------------------------------------ ambiente
  _ambient(peds, p) {
    const hour = this.game.env?.timeOfDay;
    // Pregones de los venteros cercanos.
    for (const q of peds) {
      if (q.faction !== 'civil' || !q.alive || !q.sim?.fixed || q.sim.sitting) continue;
      const d = d2(q, p);
      if (d > 26) {
        this.vendorTimers.delete(q);
        continue;
      }
      const kind = this._vendorKind(q);
      if (!kind) continue;
      if (!this.vendorTimers.has(q)) this.vendorTimers.set(q, this.now + 1 + this.rand() * 3);
      if (this.now < this.vendorTimers.get(q) || this._speaking(q)) continue;
      if (this.active.some((u) => u.line.cat === 'pregon')) continue; // uno a la vez
      if (this.speak(q, 'pregon', { kind, label: q.look?.female ? 'Vendedora' : 'Vendedor' })) this.vendorTimers.set(q, this.now + 9 + this.rand() * 8);
    }
    // Charla de dos vecinos sentados.
    if (!this.conv && this.cool.ready('charla', this.now)) this._startConversation(peds, p);
    // Saludo al pasar (de vez en cuando).
    if (this.cool.ready('saludo', this.now) && p.speed < 6 && !p.aiming) {
      for (const q of peds) {
        if (q.faction !== 'civil' || !q.alive || q.sim?.mode === 'flee' || this._inConversation(q) || this._speaking(q)) continue;
        if (Math.abs(q.x - p.x) > 4 || Math.abs(q.z - p.z) > 4 || d2(q, p) > 3.8) continue;
        if (!this.cool.ready(`saludo|${q.id}`, this.now)) continue;
        this.cool.set(`saludo|${q.id}`, this.now, 90);
        if (this.rand() < 0.45 && this.speak(q, 'saludo', { hour })) {
          this.cool.set('saludo', this.now, 12 + this.rand() * 14);
          break;
        }
      }
    }
    // Alguien quieto hablando solo.
    if (this.cool.ready('comentario', this.now)) {
      for (const q of peds) {
        if (q.faction !== 'civil' || !q.alive || q.sim?.mode !== 'idle' || this._inConversation(q) || this._speaking(q)) continue;
        if (d2(q, p) > 7) continue;
        if (this.rand() < 0.3 && this.speak(q, 'comentario', { hour })) this.cool.set('comentario', this.now, 30 + this.rand() * 25);
        else this.cool.set('comentario', this.now, 4);
        break;
      }
    }
  }

  _vendorKind(q) {
    if (this.vendorKinds.has(q)) return this.vendorKinds.get(q);
    this._vendorProps ??= (this.game.city?.props ?? []).filter((pr) => pr.type === 'vendor');
    let kind = null;
    let bd = 2.6;
    for (const pr of this._vendorProps) {
      const d = Math.hypot(pr.x - q.x, pr.z - q.z);
      if (d < bd) {
        bd = d;
        kind = pr.kind ?? null;
      }
    }
    this.vendorKinds.set(q, kind);
    return kind;
  }

  _seated(q) {
    return q.faction === 'civil' && q.alive && q.sim?.fixed && q.sim.sitting;
  }

  _startConversation(peds, p) {
    // La pareja de vecinos sentados más cercana (mejor si no tienen la misma voz).
    let pair = null;
    let best = Infinity;
    for (const a of peds) {
      if (!this._seated(a)) continue;
      const d = d2(a, p);
      if (d > 18) continue;
      for (const b of peds) {
        if (b === a || !this._seated(b) || d2(a, b) > 3.6) continue;
        const score = d + (this.voiceOf(a) === this.voiceOf(b) ? 8 : 0);
        if (score < best) {
          best = score;
          pair = [a, b];
        }
      }
    }
    if (!pair) return;
    const n = this.picker.pickConversation(this.rand);
    const lines = this.picker.conversation(n);
    if (!lines.length) return;
    this.conv = { n, lines, step: 0, a: pair[0], b: pair[1], next: this.now + 0.3, current: null };
    this.cool.set('charla', this.now, 999);
  }

  _inConversation(q) {
    return !!this.conv && (this.conv.a === q || this.conv.b === q);
  }

  _updateConversation() {
    const c = this.conv;
    if (!c) return;
    const p = this.game.player;
    if (!this._seated(c.a) || !this._seated(c.b) || d2(c.a, p) > 30) return this._endConversation();
    if (c.current && !c.current.done) return;
    if (this.now < c.next) return;
    if (c.step >= c.lines.length) return this._endConversation();
    const line = c.lines[c.step];
    const who = line.role === 'A' ? c.a : c.b;
    const u = this.speakLine(who, line, this.voiceOf(who), { label: who.look?.female ? 'Vecina' : 'Vecino' });
    if (!u) {
      c.next = this.now + 0.5; // sin voz libre: se espera
      return;
    }
    c.current = u;
    c.step++;
    u.onEnd = () => {
      c.next = this.now + 0.25 + this.rand() * 0.45;
    };
  }

  _endConversation() {
    if (!this.conv) return;
    this.conv = null;
    this.cool.set('charla', this.now, 14 + this.rand() * 14);
  }

  // ------------------------------------------------------------ voces
  _later(sec, fn) {
    this.queue.push({ at: this.now + sec, fn });
  }

  _speaking(speaker) {
    return this.active.some((u) => u.speaker === speaker && !u.done);
  }

  /** Dice una línea de la categoría con la voz del hablante. Devuelve la voz o null. */
  speak(speaker, cat, opts = {}) {
    const voice = opts.voice ?? (speaker.radio ? null : this.voiceOf(speaker));
    const line = this.picker.pick(cat, { voice, hour: opts.hour, kind: opts.kind }, this.rand);
    if (!line) return null;
    return this.speakLine(speaker, line, voice ?? line.voices[0], opts);
  }

  speakLine(speaker, line, voice, opts = {}) {
    const info = catInfo(line.cat);
    const p = this.game.player;
    const dist = Math.hypot(speaker.x - p.x, speaker.z - p.z);
    if (dist > info.radius) return null;
    // Una voz por hablante; límite global de voces (las prioritarias interrumpen).
    const same = this.active.find((u) => u.speaker === speaker && !u.done);
    if (same) {
      if (same.info.pri >= info.pri) return null;
      this._stop(same);
    }
    const live = this.active.filter((u) => !u.done);
    if (live.length >= MAX_VOICES) {
      const low = live.reduce((m, u) => (u.info.pri < m.info.pri ? u : m));
      if (low.info.pri >= info.pri) return null;
      this._stop(low);
    }
    const key = `${line.id}-${voice}`;
    const manifestSec = this.manifest?.files?.[key];
    const u = {
      speaker,
      line,
      voice,
      key,
      info,
      label: opts.label ?? this._label(speaker, line),
      dur: manifestSec ?? estimateSeconds(line.text),
      t: 0,
      started: false,
      done: false,
      node: null,
      sub: null,
      onEnd: null,
    };
    this.active.push(u);
    this.log.push({ t: +this.now.toFixed(2), cat: line.cat, id: line.id, voice, text: line.text, label: u.label });
    if (this.log.length > 60) this.log.shift();
    this._startAudio(u);
    return u;
  }

  _label(speaker, line) {
    if (speaker.radio) return 'Radio';
    if (speaker.faction === 'police') return 'Policía';
    const f = speaker.look?.female;
    if (line.cat === 'pregon') return f ? 'Vendedora' : 'Vendedor';
    return f ? 'Vecina' : 'Vecino';
  }

  _startAudio(u) {
    const a = this.game.audio;
    const hasFile = !this.manifest || u.key in (this.manifest.files ?? {});
    if (!a?.ctx || !a.master || !hasFile) {
      this._begin(u, null);
      return;
    }
    this._buffer(u.key, u.line.id, u.voice).then((buf) => {
      if (u.done) return;
      this._begin(u, buf);
    });
    // Si tarda en cargar, arranca el subtítulo solo (el audio no se pone al día).
    u.loadTimeout = this.now + 0.6;
  }

  _buffer(key, id, voice) {
    let pr = this.buffers.get(key);
    if (!pr) {
      const ctx = this.game.audio.ctx;
      pr = fetch(voiceFile(id, voice))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((ab) => ctx.decodeAudioData(ab))
        .catch(() => null);
      this.buffers.set(key, pr);
    }
    return pr;
  }

  _begin(u, buf) {
    if (u.started || u.done) return;
    u.started = true;
    u.t = 0;
    const a = this.game.audio;
    if (buf && a?.ctx && a.master) {
      const ctx = a.ctx;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = this._gainFor(u);
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) {
        pan.pan.value = this._panFor(u);
        src.connect(gain).connect(pan).connect(a.master);
      } else src.connect(gain).connect(a.master);
      src.onended = () => this._finish(u);
      src.start();
      u.node = { src, gain, pan };
      u.dur = buf.duration;
      if (u.speaker.radio) {
        // Chasquido del radioteléfono al abrir y al cerrar.
        this._squelch(gain, ctx.currentTime);
        this._squelch(gain, ctx.currentTime + buf.duration + 0.02);
      }
    }
    this._showSub(u);
  }

  _squelch(dest, t) {
    const ctx = this.game.audio.ctx;
    if (!this._noise) {
      this._noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.12), ctx.sampleRate);
      const d = this._noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    src.connect(bp).connect(g).connect(dest);
    src.start(t);
    src.stop(t + 0.1);
  }

  _pos(u) {
    const s = u.speaker;
    return { x: s.x, y: (s.y ?? 0) + (s.radio ? 1 : 1.6), z: s.z };
  }

  _gainFor(u) {
    const l = this.game.audio?.listener ?? this.game.player;
    const pos = this._pos(u);
    const d = Math.hypot(pos.x - l.x, pos.y - (l.y ?? pos.y), pos.z - l.z);
    const muffle = this.game.player?.inVehicle ? 0.55 : 1; // ventanas arriba
    return u.info.vol * voiceGain(d, u.info.ref, u.info.radius) * muffle;
  }

  _panFor(u) {
    const cam = this.game.camera;
    const pos = this._pos(u);
    const l = this.game.audio?.listener ?? this.game.player;
    const dx = pos.x - l.x;
    const dz = pos.z - l.z;
    const d = Math.hypot(dx, dz);
    if (!cam || d < 0.5) return 0;
    const e = cam.matrixWorld.elements;
    const rl = Math.hypot(e[0], e[2]) || 1;
    const pan = ((dx / d) * e[0] + (dz / d) * e[2]) / rl;
    return Math.max(-1, Math.min(1, pan)) * 0.8 * Math.min(1, d / 3);
  }

  _updateVoices(dt) {
    const ctx = this.game.audio?.ctx;
    for (const u of this.active) {
      if (u.done) continue;
      if (!u.started) {
        if (u.loadTimeout != null && this.now > u.loadTimeout) this._begin(u, null);
        continue;
      }
      u.t += dt;
      if (u.node) {
        const t = ctx.currentTime;
        u.node.gain.gain.setTargetAtTime(this._gainFor(u), t, 0.08);
        u.node.pan?.pan.setTargetAtTime(this._panFor(u), t, 0.08);
        if (u.t > u.dur + 1) this._finish(u); // por si onended no llega (contexto suspendido)
      } else if (u.t >= u.dur) this._finish(u);
      // Muerto a media frase: se calla (salvo la radio).
      if (!u.done && u.speaker.alive === false && !u.speaker.radio) this._stop(u);
    }
    this.active = this.active.filter((u) => !u.done);
  }

  _stop(u) {
    if (u.done) return;
    if (u.node) {
      try {
        const t = this.game.audio.ctx.currentTime;
        u.node.gain.gain.setTargetAtTime(0, t, 0.04);
        u.node.src.stop(t + 0.15);
      } catch {
        /* ya había terminado */
      }
    }
    if (this.conv && (u === this.conv.current || this._inConversation(u.speaker))) this._endConversation();
    u.onEnd = null;
    this._finish(u);
  }

  _finish(u) {
    if (u.done) return;
    u.done = true;
    this._hideSub(u);
    const fn = u.onEnd;
    u.onEnd = null;
    if (fn) fn();
  }

  // ------------------------------------------------------------ subtítulos
  _showSub(u) {
    if (!this.el || !this.subtitlesOn) return;
    const div = document.createElement('div');
    div.className = `sub${u.speaker.radio ? ' radio' : u.speaker.faction === 'police' ? ' police' : ''}`;
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = u.label;
    div.append(who, document.createTextNode(u.line.text));
    this.el.append(div);
    u.sub = div;
    // Máximo dos líneas en pantalla: la más vieja se va.
    const subs = [...this.el.children].filter((c) => !c.classList.contains('out'));
    for (const old of subs.slice(0, Math.max(0, subs.length - 2))) this._fadeOut(old);
  }

  _hideSub(u) {
    if (u.sub) this._fadeOut(u.sub, 0.35);
    u.sub = null;
  }

  _fadeOut(div, delay = 0) {
    if (div.classList.contains('out')) return;
    const go = () => {
      div.classList.add('out');
      setTimeout(() => div.remove(), 450);
    };
    if (delay) setTimeout(go, delay * 1000);
    else go();
  }
}
