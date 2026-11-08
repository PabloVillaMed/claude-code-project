// La rumba de la 92 en el juego: de noche, frente a cada discoteca, bar y
// fonda de la Calle 92 hay un portero (grande, de negro), una fila corta en
// la puerta y grupos charlando en el andén, con pinta de salir; entre los
// locales caminan parejas. Solo aparecen cerca del jugador (como las plazas
// de game/streetLife.js), con tope por calidad, y de día casi nadie. Cerca de
// la gente suena un murmullo sintetizado (un solo sonido para todos); la
// música de cada local la pone game/radio.js. Qué locales, cuánta gente y
// dónde se para cada quien sale de sim/nightlife.js (puro y probado).

import { MUJERES, PINTA_PORTERO, PORTERO_ESCALA, cupoRumba, discotecasDe, murmullo, nivelRumba, parejasRumba, paseoPareja, pintaRumba, puestosLocal, repartir } from '../sim/nightlife.js';
import { walkSpeedScale } from '../sim/animSelect.js';
import { makeRng } from '../sim/rng.js';
import { randomLook } from '../render/characterRig.js';
import { applyOutfit } from '../render/outfit.js';

// ------------------------------------------------------------------ configurables
const TICK = 0.25; // s entre revisiones (aparecer, desaparecer, hablar, murmullo)
const APARECER = 0.85; // × pedDraw de la calidad: a esta distancia se llena un local
const DESAPARECER = 1.15; // × pedDraw: más lejos se vacía
const SPAWN_POR_TICK = 2; // personas nuevas por revisión (reparte el costo de crear los muñecos)
const SIN_SOMBRA = true; // la gente de la rumba no proyecta sombra (de noche la luz del sol está en 0 y el pase de sombras es puro costo)
const NO_APARECER_CERCA = 14; // m: nadie aparece (ni desaparece) más cerca que esto del jugador
const SOBRANTE_LEJOS = 32; // m: si sobra gente (baja la rumba), se va cuando el jugador está más lejos que esto
const SUSTO = 90; // s sin volver a llenar un local después de que su gente salió corriendo
const HABLA_RANGO = 4.5; // m: los de los grupos y la fila le hablan al jugador que pasa así de cerca
const PORTERO_RANGO = 3.6; // m: el portero le habla al que llega a la puerta
const PAUSA_LOCAL = 35; // s entre frases de la gente de un mismo local
const PAUSA_PORTERO = 45; // s entre frases del portero
const PAUSA_GLOBAL = 9; // s entre frases de rumba en toda la calle
const TURNO_CHARLA = [4, 9]; // s: cada cuánto cambia quién lleva la charla en un grupo
const PAREJA_VEL = 1.25; // m/s (con el caminar de paseo)
const PAREJA_SEP = 0.34; // m de cada lado del camino
const PAREJA_PAUSA = [3, 7]; // s parados en la puerta antes de devolverse
const MURMULLO_VOL = 0.2; // volumen máximo del murmullo (bus de efectos)
const MURMULLO_RADIO = 30; // m: hasta dónde se oye un grupo
const MURMULLO_REF = 4; // m: a esta distancia o menos, a todo volumen
const MURMULLO_PERSONAS = 8; // con esta gente cerca suena "lleno"
const MURMULLO_CARRO = 0.35; // dentro de un vehículo se oye menos
const MURMULLO_SR = 22050; // Hz del murmullo sintetizado (no pasa de 4 kHz: a media tasa se arma en la mitad del tiempo, ~30 ms una sola vez)
const MURMULLO_SEG = 3; // s del bucle
const ACCESORIOS_LEJOS = 20; // m: más lejos de la cámara, la gente de la rumba no dibuja sus accesorios chicos (una llamada de dibujo menos cada uno)
const ACCESORIOS_CHICOS = ['ojos', 'cuello', 'cintura', 'hombro']; // ranuras de sim/ropa.js que se esconden de lejos (gafas, cadenas, canguros y bolsos; no la gorra, el buso ni el vestido)

const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Quieto para el mundo: modo 'idle' sin fin (sim/pedAI.js nunca lo pone a
 * caminar) pero sin `fixed`, así cuentan en el cupo de peatones del mundo
 * (world.js) y la rumba reemplaza gente de otras cuadras en vez de sumarse.
 * Con una amenaza salen corriendo como cualquiera (y dejan de ser de aquí).
 */
const sinSombra = () => {};

function quieto(s) {
  s.fixed = false;
  s.mode = 'idle';
  s.speed = 0;
  s.timer = Infinity;
}

export class Nightlife {
  constructor(game) {
    this.game = game;
    this.locales = discotecasDe(game.city).map((d) => ({ ...d, puestos: null, peds: [], talkAt: 0, porteroAt: 0, scaredUntil: 0, turnAt: 0, talker: 0 }));
    this.byId = new Map(this.locales.map((l) => [l.id, l]));
    this.parejas = [];
    this.rng = makeRng(9292);
    this.t = 0;
    this.tick = 0;
    this.talkAt = 0;
    this.nivel = 0;
    this.cupo = 0;
    this.spawned = 0;
    this.audio = null; // {src, lp, gain, pan} del murmullo (se arma la primera vez)
    this.murmulloNivel = 0;
    this.silencioT = 0;
    // Lo que el mundo le pregunta a cada persona de la rumba (game/world.js: p.act).
    this.act = {
      dress: (p, st) => {
        const r = p.rumba;
        if (r?.walk) {
          st.speed = r.speed;
          st.fidget = r.speed < 0.1;
        }
        // Quien habla gesticula (las categorías de rumba no traen gesto propio).
        if (!st.upper && this.game.dialogue?.speechOf?.(p)) st.upper = 'talk';
      },
      threat: () => false, // con una amenaza salen corriendo como cualquiera (world.js)
    };
  }

  /** Puestos de un local (se calculan la primera vez que hacen falta). */
  _puestos(l) {
    if (!l.puestos) {
      const col = this.game.city?.collision;
      l.puestos = puestosLocal(l, col ? (x, z) => col.pointBlocked(x, z) : undefined);
      l.peds = l.puestos.map(() => null);
    }
    return l.puestos;
  }

  update(dt) {
    const g = this.game;
    if (g.state !== 'playing' || !g.world || !g.player) {
      this._murmullo(0, 0);
      return;
    }
    this.t += dt;
    this._caminar(dt);
    this.tick -= dt;
    if (this.tick > 0) return;
    this.tick = TICK;
    const alive = new Set(g.world.peds);
    this._spawns(alive);
    this._parejas(alive);
    this._charla();
    this._hablar();
    this._sonido();
    this._lod();
  }

  /** Gente lejana más barata: sin sus accesorios chicos (ACCESORIOS_LEJOS; la animación ya va por ANIM_LOD). */
  _lod() {
    const cam = this.game.camera.position;
    for (const l of this.locales) for (const m of l.peds) if (m) this._accesorios(m, Math.hypot(m.sim.x - cam.x, m.sim.z - cam.z) <= ACCESORIOS_LEJOS);
    for (const c of this.parejas) for (const m of c.peds) this._accesorios(m, Math.hypot(m.sim.x - cam.x, m.sim.z - cam.z) <= ACCESORIOS_LEJOS);
  }

  _accesorios(m, ver) {
    if (m._accesorios === ver) return;
    m._accesorios = ver;
    for (const mesh of m.rig._outfit?.meshes ?? []) if (ACCESORIOS_CHICOS.includes(mesh.userData.slot)) mesh.visible = ver;
  }

  // ------------------------------------------------------------ aparecer y desaparecer
  _spawns(alive) {
    const g = this.game;
    const p = g.player;
    const near = g.quality?.pedDraw ?? 90;
    const peds = g.quality?.peds ?? 30;
    this.nivel = nivelRumba(g.env?.timeOfDay ?? 12);
    this.cupo = cupoRumba(peds, this.nivel);
    const want = repartir(this.locales, p.x, p.z, near * APARECER, this.cupo, (l) => this._puestos(l).length);
    let budget = SPAWN_POR_TICK;
    for (const l of this.locales) {
      // Los que se murieron, se borraron o salieron corriendo ya no son de aquí.
      for (let i = 0; i < l.peds.length; i++) {
        const m = l.peds[i];
        if (!m) continue;
        if (!alive.has(m) || !m.alive || m.sim.mode !== 'idle') {
          if (m.act === this.act) m.act = null;
          m.rumba = null;
          this._accesorios(m, true);
          l.peds[i] = null;
          if (alive.has(m)) l.scaredUntil = this.t + SUSTO; // huyó: el local queda solo un rato
        }
      }
      const d = d2(l, p);
      const n = want.get(l.id) ?? 0;
      if (!l.puestos && !n) continue;
      const lejos = d > near * DESAPARECER;
      for (let i = 0; i < l.peds.length; i++) {
        const m = l.peds[i];
        const slot = l.puestos[i];
        const ds = Math.hypot(slot.x - p.x, slot.z - p.z);
        if (m && (lejos || (i >= n && ds > SOBRANTE_LEJOS))) {
          g.world.removePed(m);
          l.peds[i] = null;
        } else if (!m && i < n && budget > 0 && ds > NO_APARECER_CERCA && this.t > l.scaredUntil) {
          l.peds[i] = this._spawnPuesto(l, slot, i);
          budget--;
        }
      }
    }
  }

  /** Una persona de la rumba en su puesto (el portero, de la fila o de un grupo). */
  _spawnPuesto(l, slot, i) {
    const w = this.game.world;
    const portero = slot.rol === 'portero';
    const look = this._look(portero ? false : this.rng.chance(MUJERES));
    if (portero) look.scale = PORTERO_ESCALA;
    const m = w.spawnPedAt(slot.x, slot.z, { outfit: 'civil', health: portero ? 160 : 90, look });
    quieto(m.sim);
    m.sim.yaw = slot.yaw;
    m.act = this.act;
    m.rumba = { local: l.id, rol: slot.rol, grupo: slot.grupo, i };
    m.walkStyle = portero ? null : m.walkStyle;
    if (portero) {
      m.idleClip = 'idle_wait';
      m.fixedActivity = null;
    } else if (slot.rol === 'fila') {
      m.fixedActivity = this.rng.chance(0.45) ? 'phone' : this.rng.chance(0.3) ? 'text' : null;
    } else {
      // En los grupos: unos con el vaso en la mano, otros oyendo (la charla rota).
      m.fixedActivity = this.rng.chance(0.35) ? 'drink' : 'listen';
    }
    // world.js escoge qué hacer con las manos al cambiar de modo: ya va escogido.
    m.lastMode = 'idle';
    m.activity = m.fixedActivity ?? null;
    applyOutfit(m.rig, portero ? PINTA_PORTERO : pintaRumba(this.rng, !!look.female));
    this._sinSombra(m);
    this.spawned++;
    return m;
  }

  /** Sin sombra (world.js le pide sombra a los cercanos cada cuadro: aquí se ignora). */
  _sinSombra(m) {
    if (!SIN_SOMBRA) return;
    m.rig.setShadow(false);
    m.rig.setShadow = sinSombra;
  }

  /** Aspecto al azar de mujer o de hombre (randomLook escoge el avatar según el género). */
  _look(female) {
    let look = randomLook(this.rng, 'civil');
    for (let k = 0; k < 8 && !!look.female !== female; k++) look = randomLook(this.rng, 'civil');
    return look;
  }

  // ------------------------------------------------------------ parejas
  _parejas(alive) {
    const g = this.game;
    const p = g.player;
    const near = g.quality?.pedDraw ?? 90;
    // Las que se fueron (o salieron corriendo) se sueltan.
    this.parejas = this.parejas.filter((c) => {
      const ok = c.peds.every((m) => alive.has(m) && m.alive && m.sim.mode === 'idle');
      if (!ok) for (const m of c.peds) this._soltar(m);
      return ok;
    });
    const cerca = this.locales.filter((l) => d2(l, p) < near * APARECER);
    const n = cerca.length ? parejasRumba(g.quality?.peds ?? 30, this.nivel) : 0;
    for (let k = this.parejas.length - 1; k >= 0; k--) {
      const c = this.parejas[k];
      const dc = d2(c.peds[0], p);
      if (dc > near * DESAPARECER || (this.parejas.length > n && dc > SOBRANTE_LEJOS)) {
        for (const m of c.peds) g.world.removePed(m);
        this.parejas.splice(k, 1);
      }
    }
    if (this.parejas.length >= n) return;
    // Una pareja nueva por revisión, en el paseo de un local cercano, lejos del jugador.
    const l = cerca[Math.floor(this.rng.next() * cerca.length)];
    const ruta = l && paseoPareja(this.locales, l, this.rng);
    if (!ruta) return;
    const len = Math.hypot(ruta.to.x - ruta.from.x, ruta.to.z - ruta.from.z);
    const s0 = this.rng.range(0.1, 0.9) * len;
    const c = { from: ruta.from, to: ruta.to, len, s: s0, pause: 0, peds: [] };
    const at = this._posPareja(c, 0);
    if (Math.hypot(at.x - p.x, at.z - p.z) < NO_APARECER_CERCA * 1.5) return;
    const fems = this.rng.chance(0.75) ? [true, false] : [true, true];
    for (let k = 0; k < 2; k++) {
      const look = this._look(fems[k]);
      const q = this._posPareja(c, k ? 1 : -1);
      const m = g.world.spawnPedAt(q.x, q.z, { outfit: 'civil', health: 90, look });
      quieto(m.sim);
      m.walkStyle = 'stroll';
      m.act = this.act;
      m.rumba = { rol: 'pareja', walk: true, speed: 0 };
      m.fixedActivity = null;
      applyOutfit(m.rig, pintaRumba(this.rng, fems[k]));
      this._sinSombra(m);
      c.peds.push(m);
      this.spawned++;
    }
    this.parejas.push(c);
  }

  _soltar(m) {
    if (m.act === this.act) m.act = null;
    m.rumba = null;
    this._accesorios(m, true);
  }

  /** Punto del camino de la pareja a `s` m del principio, corrido `lado` × PAREJA_SEP a un lado. */
  _posPareja(c, lado) {
    const dx = (c.to.x - c.from.x) / (c.len || 1);
    const dz = (c.to.z - c.from.z) / (c.len || 1);
    const o = (this._pp ??= { x: 0, z: 0, yaw: 0 });
    o.x = c.from.x + dx * c.s - dz * PAREJA_SEP * lado;
    o.z = c.from.z + dz * c.s + dx * PAREJA_SEP * lado;
    o.yaw = Math.atan2(dx, dz);
    return o;
  }

  /** Mueve las parejas (cada cuadro: es solo aritmética). */
  _caminar(dt) {
    const vel = PAREJA_VEL * walkSpeedScale('stroll');
    for (const c of this.parejas) {
      let v = 0;
      if (c.pause > 0) {
        c.pause -= dt;
        if (c.pause <= 0) {
          // Se devuelven por donde vinieron.
          [c.from, c.to] = [c.to, c.from];
          c.s = 0;
        }
      } else {
        c.s += vel * dt;
        v = vel;
        if (c.s >= c.len) {
          c.s = c.len;
          c.pause = this.rng.range(PAREJA_PAUSA[0], PAREJA_PAUSA[1]);
        }
      }
      for (let k = 0; k < c.peds.length; k++) {
        const m = c.peds[k];
        if (!m.rumba) continue;
        const q = this._posPareja(c, k ? 1 : -1);
        const s = m.sim;
        s.x = q.x;
        s.z = q.z;
        // Parados en la puerta: el uno mirando al otro.
        s.yaw = v > 0 ? q.yaw : q.yaw + (k ? -1.2 : 1.2);
        m.rumba.speed = v; // (la animación la toma de act.dress: el mundo los deja quietos)
      }
    }
  }

  // ------------------------------------------------------------ charla y frases
  /** En cada grupo uno lleva la charla (manos) y los demás oyen o toman; rota cada tanto. */
  _charla() {
    for (const l of this.locales) {
      if (this.t < l.turnAt || !l.puestos) continue;
      l.turnAt = this.t + this.rng.range(TURNO_CHARLA[0], TURNO_CHARLA[1]);
      const gm = l.peds.filter((m) => m?.rumba?.rol === 'grupo');
      if (gm.length < 2) continue;
      l.talker = (l.talker + 1) % gm.length;
      gm.forEach((m, k) => {
        if (k === l.talker) m.fixedActivity = 'talk';
        else if (m.fixedActivity === 'talk') m.fixedActivity = this.rng.chance(0.4) ? 'drink' : 'listen';
      });
      // (world.js solo escoge la actividad al cambiar de modo y estos siguen quietos: se pone aquí.)
      for (const m of gm) m.activity = m.fixedActivity;
    }
  }

  _hablar() {
    const g = this.game;
    const p = g.player;
    const dlg = g.dialogue;
    if (!dlg || p.dead || p.inVehicle || (g.wanted?.level ?? 0) > 0) return;
    for (const l of this.locales) {
      if (!l.puestos || d2(l, p) > 12) continue;
      // El portero, al que llega a la puerta.
      const portero = l.peds[0]?.rumba?.rol === 'portero' ? l.peds[0] : null;
      if (portero?.alive && this.t > l.porteroAt && d2(portero, p) < PORTERO_RANGO) {
        const cat = p.aiming ? 'portero_arma' : 'portero';
        if (dlg.speak(portero, cat, { label: 'Portero' })) {
          l.porteroAt = this.t + (p.aiming ? 12 : PAUSA_PORTERO);
          portero.sim.yaw = Math.atan2(p.x - portero.x, p.z - portero.z);
          return;
        }
      }
      // Los de los grupos y la fila, al que pasa caminando cerca.
      if (this.t < l.talkAt || this.t < this.talkAt || p.speed > 4) continue;
      let best = null;
      let bd = HABLA_RANGO;
      for (const m of l.peds) {
        if (!m?.alive || !m.rumba || m.rumba.rol === 'portero') continue;
        const d = d2(m, p);
        if (d < bd) {
          bd = d;
          best = m;
        }
      }
      if (!best) continue;
      const cat = best.rumba.rol === 'fila' ? 'rumba_fila' : 'rumba';
      if (dlg.speak(best, cat, { label: best.look?.female ? 'Rumbera' : 'Rumbero' })) {
        l.talkAt = this.t + PAUSA_LOCAL;
        this.talkAt = this.t + PAUSA_GLOBAL;
        if (best.rumba.rol !== 'pareja') best.sim.yaw = Math.atan2(p.x - best.x, p.z - best.z);
        return;
      }
    }
  }

  // ------------------------------------------------------------ murmullo
  /** Cuánta gente se oye cerca (0..1) y de qué lado (paneo). */
  _sonido() {
    const g = this.game;
    const L = g.audio?.listener ?? g.player;
    let sum = 0;
    let px = 0;
    let pz = 0;
    for (const l of this.locales) {
      let n = 0;
      for (const m of l.peds) if (m?.alive) n++;
      if (!n) continue;
      const d = Math.hypot(l.x - L.x, l.z - L.z);
      if (d >= MURMULLO_RADIO) continue;
      const k = (n / MURMULLO_PERSONAS) * Math.min(1, MURMULLO_REF / Math.max(MURMULLO_REF, d)) * (1 - (d / MURMULLO_RADIO) ** 2);
      sum += k;
      px += l.x * k;
      pz += l.z * k;
    }
    for (const c of this.parejas) {
      const d = Math.hypot(c.peds[0].x - L.x, c.peds[0].z - L.z);
      if (d < 10) sum += 0.08 * (1 - d / 10);
    }
    const lvl = Math.min(1, sum) * (g.player.inVehicle ? MURMULLO_CARRO : 1);
    const pan = sum > 0 ? this._pan(px / sum, pz / sum) : 0;
    this._murmullo(lvl, pan);
  }

  _pan(x, z) {
    const cam = this.game.camera;
    const l = this.game.audio?.listener ?? this.game.player;
    const dx = x - l.x;
    const dz = z - l.z;
    const d = Math.hypot(dx, dz);
    if (!cam || d < 1) return 0;
    const e = cam.matrixWorld.elements;
    const rl = Math.hypot(e[0], e[2]) || 1;
    return Math.max(-1, Math.min(1, ((dx / d) * e[0] + (dz / d) * e[2]) / rl)) * 0.6;
  }

  /** Sube o baja el murmullo; lo arma la primera vez y lo apaga si lleva rato en silencio. */
  _murmullo(lvl, pan) {
    this.murmulloNivel = lvl;
    const a = this.game.audio;
    const ctx = a?.ctx;
    if (!ctx || !a.master) return;
    if (lvl <= 0.003) {
      if (!this.audio) return;
      this.audio.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
      this.silencioT += TICK;
      if (this.silencioT > 4) this._pararMurmullo();
      return;
    }
    this.silencioT = 0;
    if (!this.audio) this._armarMurmullo(ctx, a.master);
    if (!this.audio) return;
    const t = ctx.currentTime;
    this.audio.gain.gain.setTargetAtTime(lvl * MURMULLO_VOL, t, 0.3);
    // Lejos se oye apagado; cerca, claro.
    this.audio.lp.frequency.setTargetAtTime(900 + 2600 * lvl, t, 0.3);
    this.audio.pan?.pan.setTargetAtTime(pan, t, 0.3);
  }

  _armarMurmullo(ctx, dest) {
    try {
      if (!this._buf) {
        const sr = MURMULLO_SR;
        const data = murmullo(sr, MURMULLO_SEG);
        this._buf = ctx.createBuffer(1, data.length, sr);
        this._buf.getChannelData(0).set(data);
      }
      const src = ctx.createBufferSource();
      src.buffer = this._buf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1200;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      let n = src.connect(lp).connect(gain);
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) n = n.connect(pan);
      n.connect(dest);
      src.start(0, Math.random() * MURMULLO_SEG);
      this.audio = { src, lp, gain, pan };
    } catch (e) {
      console.warn('Murmullo no disponible:', e?.message ?? e);
      this.audio = null;
    }
  }

  _pararMurmullo() {
    const s = this.audio;
    this.audio = null;
    this.silencioT = 0;
    try {
      s.src.stop();
      s.src.disconnect();
      (s.pan ?? s.gain).disconnect();
    } catch {
      /* ya estaba parado */
    }
  }

  /** Estado legible (pruebas y depuración). */
  state() {
    const g = this.game;
    const p = g.player;
    const count = (rol) => this.locales.reduce((n, l) => n + l.peds.filter((m) => m?.alive && m.rumba?.rol === rol).length, 0);
    let cerca = null;
    for (const l of this.locales) {
      const d = p ? d2(l, p) : Infinity;
      if (!cerca || d < cerca.d) cerca = { id: l.id, name: l.name, d: Math.round(d), x: Math.round(l.x), z: Math.round(l.z), gente: l.peds.filter((m) => m?.alive).length };
    }
    return {
      locales: this.locales.map((l) => ({ id: l.id, name: l.name, tipo: l.tipo, musica: l.musica, x: +l.x.toFixed(1), z: +l.z.toFixed(1), fx: +l.fx.toFixed(1), fz: +l.fz.toFixed(1), nx: +l.nx.toFixed(3), nz: +l.nz.toFixed(3), gente: l.peds.filter((m) => m?.alive).length })),
      hora: +(g.env?.timeOfDay ?? 0).toFixed(2),
      nivel: +this.nivel.toFixed(2),
      cupo: this.cupo,
      gente: this.locales.reduce((n, l) => n + l.peds.filter((m) => m?.alive).length, 0),
      porteros: count('portero'),
      fila: count('fila'),
      grupos: count('grupo'),
      parejas: this.parejas.length,
      creados: this.spawned,
      murmullo: +this.murmulloNivel.toFixed(3),
      murmulloSonando: !!this.audio,
      cerca,
    };
  }
}
