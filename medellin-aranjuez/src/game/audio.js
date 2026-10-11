// Audio con WebAudio: las armas usan grabaciones reales (public/sounds/armas,
// ver sfxArmas.js) con eco de la calle, filtro por distancia y límite de
// voces; mientras cargan (o si faltan) se sintetizan. Los motores (del
// jugador y del tráfico cercano) usan explosiones grabadas con síntesis
// granular (engineSound.js) y una caja de cambios simulada (sim/engineModel.js);
// sin AudioWorklet queda un motor sintetizado de respaldo. Pito, sirena,
// explosiones y ambiente de ciudad siguen sintetizados.

import { ARMAS_SFX, BancoSonidos, GRUPOS, RECARGAS, crearRespuestaUrbana, mezclaDistancia } from './sfxArmas.js';
import { EngineVoice, loadEngineBanks, trafficMix } from './engineSound.js';
import { createEngineState, stepEngine } from '../sim/engineModel.js';
import { engineProfile } from '../sim/vehicleVariants.js';

// Voces de motor para el tráfico (las más cercanas; el resto no suena).
const MAX_VOCES_TRAFICO = 4;
const RADIO_TRAFICO = 70;

const MAX_VOCES_DISPARO = 14;
const MAX_VOCES_EFECTO = 10;

export class AudioSystem {
  constructor() {
    // Los bytes de los sonidos se piden ya (no bloquea la carga); se
    // decodifican al crear el AudioContext.
    this.banco = new BancoSonidos();
    this.banco.precargar();
    this.voces = [];
    this.efectos = [];
    this.camera = null; // la pone Game para el paneo estéreo
    this.ctx = null;
    this.master = null;
    this.volume = 0.7;
    this.engine = null;
    this.siren = null;
    this.listener = { x: 0, y: 0, z: 0 };
  }

  /** Debe llamarse tras un gesto del usuario (política de autoplay). */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(this.ctx.destination);
    this.noiseBuf = this._noise(2);
    this._mezclaArmas();
    this.banco.decodificar(this.ctx);
    this._ambient();
    // Motores grabados (asíncrono; mientras tanto, el de respaldo).
    this.motores = null;
    this.vocesTrafico = [];
    loadEngineBanks(this.ctx)
      .then((b) => {
        if (!b) return;
        this.motores = b;
        // El bus de motores pasa por su propia ganancia (volumen relativo).
        this.busMotor = this.ctx.createGain();
        this.busMotor.gain.value = 0.8;
        this.busMotor.connect(this.master);
        if (this.engine) this.setEngine(false);
      })
      .catch((e) => console.warn('Motores grabados no disponibles:', e?.message ?? e));
  }

  /** ¿Está sonando el motor granular? (para pruebas) */
  engineStatus() {
    return { granular: !!this.motores, jugador: this.motorJugador ? { perfil: this.motorJugador.id, rpm: Math.round(this.motorJugador.modelo.rpm), marcha: this.motorJugador.modelo.gear } : null, trafico: (this.vocesTrafico ?? []).filter((v) => v.owner).length };
  }

  /**
   * Motor del vehículo que maneja el jugador: la caja de cambios simulada
   * decide rpm, marcha y carga a partir de la velocidad y el acelerador.
   * state = estado de vehiclePhysics; input = {throttle, brake}.
   */
  drive(state, input, dt) {
    if (!this.ctx) return;
    const id = engineProfile(state.type, state.variant);
    const J = this.motorJugador?.id === id ? this.motorJugador : (this.motorJugador = { id, modelo: createEngineState(id), voz: this.motorJugador?.voz ?? null });
    const e = J.modelo;
    const v = state.forwardSpeed;
    // Frenando detenido va en reversa: el motor acelera con el freno.
    const throttle = v < -0.3 ? input.brake ?? 0 : input.throttle ?? 0;
    stepEngine(e, { speed: Math.abs(v), vmax: state.spec.maxSpeed, throttle: state.destroyed ? 0 : throttle, brake: input.brake ?? 0, dt });
    if (!this.motores) {
      // Respaldo sintetizado con las rpm del modelo.
      const p = e.profile;
      this.setEngine(true, Math.min(1, (e.rpm - p.idle * 0.8) / (p.redline - p.idle * 0.8)), state.type);
      return;
    }
    if (!J.voz) J.voz = new EngineVoice(this.ctx, this.busMotor, this.motores, id);
    J.voz.setProfile(id);
    const moto = state.type === 'moto';
    const crackle = moto && throttle < 0.05 && e.rpm > e.profile.redline * 0.45 && Math.abs(v) > 4 ? 1 : 0;
    J.voz.set({ rpm: e.rpm, load: e.load, cut: e.limiting, crackle, gain: state.destroyed ? 0 : moto ? 0.55 : 0.5, pan: 0 });
  }

  /** Apaga el motor del jugador (bajarse, pausa). */
  _apagarJugador() {
    if (this.motorJugador?.voz) this.motorJugador.voz.silence(0.15);
    this.motorJugador = this.motorJugador ? { ...this.motorJugador, modelo: createEngineState(this.motorJugador.id) } : null;
  }

  /**
   * Motores del tráfico: solo los vehículos con conductor más cercanos (a lo
   * sumo MAX_VOCES_TRAFICO voces reutilizadas), con distancia, paneo y
   * efecto Doppler. `vehicles`: [{state, driver}], `exclude`: el del jugador.
   */
  updateTraffic(vehicles, dt, exclude = null) {
    if (!this.motores || !this.ctx || this.ctx.state !== 'running') return;
    const L = this.listener;
    const lv = this._lvel ?? { x: 0, z: 0 };
    if (this._lprev && dt > 0) {
      lv.x += ((L.x - this._lprev.x) / dt - lv.x) * Math.min(1, dt * 6);
      lv.z += ((L.z - this._lprev.z) / dt - lv.z) * Math.min(1, dt * 6);
    }
    this._lvel = lv;
    this._lprev = { x: L.x, z: L.z };
    const cands = [];
    for (const v of vehicles) {
      if (v === exclude || !v.driver || v.state.destroyed) continue;
      const d = Math.hypot(v.state.x - L.x, v.state.z - L.z);
      if (d < RADIO_TRAFICO) cands.push([d, v]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    const want = new Set(cands.slice(0, MAX_VOCES_TRAFICO).map((c) => c[1]));
    // Liberar las voces de los que ya no están entre los más cercanos.
    for (const voz of this.vocesTrafico) if (voz.owner && !want.has(voz.owner)) voz.silence(0.2);
    for (const [d, v] of cands.slice(0, MAX_VOCES_TRAFICO)) {
      let voz = this.vocesTrafico.find((x) => x.owner === v);
      if (!voz) {
        voz = this.vocesTrafico.find((x) => !x.owner);
        const id = engineProfile(v.state.type, v.state.variant);
        if (!voz && this.vocesTrafico.length < MAX_VOCES_TRAFICO) this.vocesTrafico.push((voz = new EngineVoice(this.ctx, this.busMotor, this.motores, id)));
        if (!voz) continue;
        voz.owner = v;
        voz.setProfile(id);
      }
      const s = v.state;
      const id = engineProfile(s.type, s.variant);
      if (!v._motor || v._motor.id !== id) v._motor = createEngineState(id);
      const e = v._motor;
      stepEngine(e, { speed: Math.abs(s.forwardSpeed), vmax: s.spec.maxSpeed, throttle: s.throttle ?? 0, dt });
      // Velocidad radial (positiva si se acerca al oyente) para el Doppler.
      const dx = L.x - s.x;
      const dz = L.z - s.z;
      const n = Math.max(0.5, Math.hypot(dx, dz));
      const vr = ((s.vx - lv.x) * dx + (s.vz - lv.z) * dz) / n;
      const mix = trafficMix(d, vr);
      const moto = s.type === 'moto';
      const crackle = moto && (s.throttle ?? 0) < 0.05 && e.rpm > e.profile.redline * 0.45 ? 1 : 0;
      voz.set({ rpm: e.rpm, load: e.load, cut: e.limiting, crackle, pitch: mix.pitch, gain: mix.gain * (moto ? 0.6 : s.type === 'buseta' ? 0.75 : 0.5), lp: mix.lp, pan: this._panFor({ x: s.x, y: s.y + 0.5, z: s.z }) }, 0.05);
    }
  }

  // ------------------------------------------------------------ armas grabadas
  /** Bus de efectos y eco urbano (convolución con una respuesta generada). */
  _mezclaArmas() {
    const ctx = this.ctx;
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.ecoIn = ctx.createGain();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 160;
    const conv = ctx.createConvolver();
    conv.normalize = false;
    const [L, R] = crearRespuestaUrbana(ctx.sampleRate);
    const ir = ctx.createBuffer(2, L.length, ctx.sampleRate);
    ir.copyToChannel(L, 0);
    ir.copyToChannel(R, 1);
    conv.buffer = ir;
    this.ecoOut = ctx.createGain();
    this.ecoOut.gain.value = 1;
    this.ecoIn.connect(hp).connect(conv).connect(this.ecoOut).connect(this.master);
  }

  /** Cuántos sonidos grabados están listos (para pruebas). */
  sampleStatus() {
    return { cargados: this.banco.buffers.size, total: this.banco.nombres.length, fallidos: [...this.banco.fallidos] };
  }

  _dist(pos) {
    if (!pos) return 0;
    return Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z);
  }

  /** Paneo estéreo según el vector "derecha" de la cámara. */
  _panFor(pos) {
    const c = this.camera;
    if (!pos || !c) return 0;
    const dx = pos.x - this.listener.x;
    const dy = pos.y - this.listener.y;
    const dz = pos.z - this.listener.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1.5) return 0;
    const m = c.matrixWorld.elements;
    return Math.max(-1, Math.min(1, (dx * m[0] + dy * m[1] + dz * m[2]) / d)) * 0.8 * Math.min(1, (d - 1.5) / 4);
  }

  /**
   * Reproduce uno o varios buffers como una sola voz posicional:
   * retardo de propagación, pasa-bajos por distancia, paneo y envío al eco.
   * capas: [{buf, gain}]. Devuelve la voz (para robarla después).
   */
  _voz(capas, pos, { gain = 1, ref = 10, envio = null, rate = 1, delay = 0, lista = this.efectos, max = MAX_VOCES_EFECTO } = {}) {
    const ctx = this.ctx;
    const d = this._dist(pos);
    const mz = mezclaDistancia(d);
    const t = ctx.currentTime + delay + (pos ? mz.retardo : 0);
    // Limpiar voces terminadas y robar la más vieja si no hay cupo.
    const now = ctx.currentTime;
    for (let i = lista.length - 1; i >= 0; i--) if (lista[i].fin < now) lista.splice(i, 1);
    while (lista.length >= max) this._soltar(lista.shift(), now);
    const vGain = ctx.createGain();
    vGain.gain.value = gain * this._gainFor(pos, ref);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = pos ? mz.corte : 20000;
    lp.Q.value = 0.5;
    const pan = ctx.createStereoPanner();
    pan.pan.value = this._panFor(pos);
    vGain.connect(lp).connect(pan).connect(this.sfx);
    const e = envio ?? mz.envio * 0.5;
    if (e > 0) {
      const send = ctx.createGain();
      // El eco cae más despacio que el sonido directo.
      send.gain.value = (e * this._gainFor(pos, ref * 3)) / Math.max(1e-3, this._gainFor(pos, ref));
      lp.connect(send).connect(this.ecoIn);
    }
    let fin = t;
    const srcs = [];
    for (const c of capas) {
      if (!c.buf || c.gain <= 0.001) continue;
      const src = ctx.createBufferSource();
      src.buffer = c.buf;
      src.playbackRate.value = rate;
      const g = ctx.createGain();
      g.gain.value = c.gain;
      src.connect(g).connect(vGain);
      src.start(t);
      srcs.push(src);
      fin = Math.max(fin, t + c.buf.duration / rate);
    }
    const voz = { srcs, vGain, pos, t0: t, fin: fin + 0.05 };
    lista.push(voz);
    return voz;
  }

  /** Apaga una voz con un fundido corto (sin clic). */
  _soltar(v, t) {
    const at = Math.max(t, v.t0);
    v.vGain.gain.cancelScheduledValues(at);
    v.vGain.gain.setTargetAtTime(0, at, 0.025);
    for (const s of v.srcs) {
      try {
        s.stop(at + 0.15);
      } catch {
        /* ya detenido */
      }
    }
    v.fin = Math.min(v.fin, at + 0.15);
  }

  _uno(nombres, pos, opts = {}) {
    const buf = this.banco.elegir(nombres);
    return buf ? this._voz([{ buf, gain: 1 }], pos, opts) : null;
  }

  _disparoGrabado(weaponId, pos) {
    const cfg = ARMAS_SFX[weaponId];
    if (!cfg) return false;
    const cerca = this.banco.elegir(cfg.cerca, weaponId);
    if (!cerca) return false;
    const lejos = this.banco.get(cfg.lejos);
    const d = this._dist(pos);
    const mz = mezclaDistancia(d);
    const now = this.ctx.currentTime;
    // La ráfaga del mismo tirador corta la cola del disparo anterior: cada
    // tiro suena nítido y solo el último resuena entero (y el eco de la
    // calle, alimentado por cada tiro, hace la cola de la ráfaga).
    for (const v of this.voces) {
      if (v.arma === weaponId && v.fin > now && now - v.t0 < 0.5 && pos && v.pos && Math.hypot(v.pos.x - pos.x, v.pos.y - pos.y, v.pos.z - pos.z) < 2.5) this._soltar(v, v.t0 + 0.07);
    }
    const vr = 1 + (Math.random() - 0.5) * 0.06;
    const vg = cfg.gain * (0.88 + Math.random() * 0.12);
    const capas = [{ buf: cerca, gain: lejos ? mz.cerca : 1 }];
    if (lejos) capas.push({ buf: lejos, gain: mz.lejos * 0.9 });
    const voz = this._voz(capas, pos, { gain: vg, ref: 10, envio: mz.envio, rate: vr, lista: this.voces, max: MAX_VOCES_DISPARO });
    voz.arma = weaponId;
    // Bomba de la escopeta tras cada tiro, y el cartucho vacío cae al piso.
    if (cfg.bomba) {
      this._uno(GRUPOS.bomba, pos, { gain: 0.55, ref: 6, delay: 0.3, envio: 0.08 });
      if (d < 25) this._uno(['vaina_escopeta'], pos && { x: pos.x, y: pos.y - 1.2, z: pos.z }, { gain: 0.18, ref: 5, delay: 0.72 + Math.random() * 0.1, envio: 0 });
    } else if (cfg.vaina && d < 25) {
      // Vainas de latón rebotando en el asfalto (a lo sumo unas pocas a la vez).
      const vivas = this.efectos.filter((v) => v.vaina && v.fin > now).length;
      if (vivas < 4) {
        const v = this._uno(GRUPOS.vaina, pos && { x: pos.x + 0.6, y: pos.y - 1.3, z: pos.z }, { gain: 0.14 + Math.random() * 0.06, ref: 5, delay: 0.35 + Math.random() * 0.25, rate: 0.9 + Math.random() * 0.3, envio: 0 });
        if (v) v.vaina = true;
      }
    }
    return true;
  }

  /** Impacto de bala: 'building' | 'ground' | 'character' (los de carros van por hit()). */
  bulletImpact(kind, pos) {
    if (!this.ctx || !pos || kind === 'vehicle' || !kind) return;
    const now = this.ctx.currentTime;
    // Los perdigones de la escopeta llegan juntos: no más de 3 impactos cada 40 ms.
    this._impactos = (this._impactos ?? []).filter((t) => now - t < 0.04);
    if (this._impactos.length >= 3) return;
    this._impactos.push(now);
    const r = 0.85 + Math.random() * 0.35;
    if (kind === 'character') this._uno(GRUPOS.carne, pos, { gain: 0.55, ref: 6, rate: r, envio: 0.05 });
    else if (kind === 'ground') this._uno(GRUPOS.concreto, pos, { gain: 0.4, ref: 6, rate: r * 0.8, envio: 0.1 });
    else {
      this._uno(GRUPOS.concreto, pos, { gain: 0.5, ref: 6, rate: r, envio: 0.12 });
      if (Math.random() < 0.15) this._uno(GRUPOS.rebote, pos, { gain: 0.3, ref: 8, delay: 0.02, rate: 0.9 + Math.random() * 0.2, envio: 0.2 });
    }
  }

  /**
   * Sonidos de manejo del arma del jugador, leídos del inventario cada frame:
   * cambio de arma (enfundar / desenfundar) y recarga (cargador fuera,
   * dentro, corredera o cerrojo; cartucho por cartucho en la escopeta). Si la
   * recarga se interrumpe, los sonidos pendientes se cancelan.
   */
  updateWeapon(inv) {
    if (!this.ctx || !inv) return;
    const st = this._arma;
    if (!st || st.inv !== inv) {
      this._arma = { inv, id: inv.currentId, rec: inv.reloading };
      return;
    }
    if (inv.currentId !== st.id) {
      this._cancelarRecarga();
      this._cambioArma(st.id, inv.currentId);
      st.id = inv.currentId;
    }
    if (inv.reloading > 0 && st.rec <= 0) this._recarga(inv);
    else if (inv.reloading <= 0 && st.rec > 0.12) this._cancelarRecarga();
    st.rec = inv.reloading;
  }

  _cambioArma(de, a) {
    if (!this.banco.buffers.size) return this._blip(700, 0.04, 0.08, 'square');
    const esArma = (id) => !!ARMAS_SFX[id];
    if (esArma(de)) this._uno(['enfundar'], null, { gain: 0.3, envio: 0 });
    if (esArma(a)) this._uno(GRUPOS.desenfundar, null, { gain: 0.4, delay: esArma(de) ? 0.14 : 0, envio: 0 });
    else if (a === 'machete') this._uno(GRUPOS.silbido, null, { gain: 0.18, rate: 0.6, delay: 0.1, envio: 0 });
  }

  _recarga(inv) {
    const w = inv.current;
    const T = inv.reloading;
    const vacia = inv.ammo.mag === 0;
    const voces = [];
    const add = (nombre, t, gain = 0.5) => {
      const v = this._uno([nombre], null, { gain, delay: t, envio: 0.04 });
      if (v) voces.push(v);
    };
    if (w.id === 'shotgun') {
      const n = Math.min(4, w.mag - inv.ammo.mag, inv.ammo.reserve);
      const fin = T - (vacia ? 0.6 : 0.25);
      const paso = n > 0 ? Math.min(0.45, (fin - 0.15) / n) : 0;
      for (let i = 0; i < n; i++) add('escopeta_cartucho', 0.15 + i * paso, 0.45);
      if (vacia) {
        const b = this.banco.elegir(GRUPOS.bomba);
        if (b) voces.push(this._voz([{ buf: b, gain: 1 }], null, { gain: 0.5, delay: T - 0.5, envio: 0.04 }));
      }
    } else {
      for (const [nombre, f, soloVacia] of RECARGAS[w.id] ?? []) if (!soloVacia || vacia) add(nombre, f * T);
    }
    if (!voces.length && !this.banco.buffers.size) this.ui('tick');
    this._recargaVoces = voces;
  }

  _cancelarRecarga() {
    const now = this.ctx.currentTime;
    for (const v of this._recargaVoces ?? []) {
      if (v.t0 > now) {
        for (const s of v.srcs) {
          try {
            s.stop();
          } catch {
            /* nada */
          }
        }
      }
    }
    this._recargaVoces = [];
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  suspend(on) {
    if (!this.ctx) return;
    if (on) for (const v of this.vocesTrafico ?? []) v.silence(0.05);
    if (on) this.ctx.suspend();
    else this.ctx.resume();
  }

  _noise(seconds) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _gainFor(pos, ref = 8, max = 1) {
    if (!pos) return max;
    const d = Math.hypot(pos.x - this.listener.x, pos.y - this.listener.y, pos.z - this.listener.z);
    return max * Math.min(1, ref / Math.max(ref, d));
  }

  _ambient() {
    // Rumor de ciudad: ruido marrón muy filtrado.
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    src.connect(lp).connect(g).connect(this.master);
    src.start();
    this.ambientGain = g;
  }

  gunshot(weaponId, pos) {
    if (!this.ctx) return;
    if (this._disparoGrabado(weaponId, pos)) return;
    const t = this.ctx.currentTime;
    const cfg = {
      pistol: { f: 1800, dur: 0.18, vol: 0.9, boom: 110 },
      smg: { f: 2400, dur: 0.12, vol: 0.7, boom: 140 },
      shotgun: { f: 900, dur: 0.4, vol: 1.2, boom: 70 },
      rifle: { f: 1500, dur: 0.25, vol: 1.1, boom: 90 },
    }[weaponId] ?? { f: 1600, dur: 0.18, vol: 0.9, boom: 110 };
    const gain = this._gainFor(pos, 10) * cfg.vol;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.setValueAtTime(cfg.f * 3, t);
    bp.frequency.exponentialRampToValueAtTime(cfg.f * 0.3, t + cfg.dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + cfg.dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + cfg.dur + 0.05);
    // Golpe grave.
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(cfg.boom * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(cfg.boom * 0.5, t + 0.12);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(gain * 0.8, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.2);
    // Eco del valle.
    const d = this.ctx.createDelay();
    d.delayTime.value = 0.28;
    const dg = this.ctx.createGain();
    dg.gain.value = 0.18;
    g.connect(d).connect(dg).connect(this.master);
  }

  /** Gatillo en seco (arma vacía). */
  click() {
    if (this.ctx && this._uno(['seco'], null, { gain: 0.55, rate: 0.97 + Math.random() * 0.06, envio: 0 })) return;
    this._blip(1200, 0.03, 0.2, 'square');
  }

  /** Golpe al aire: silbido grave y largo del machete, corto y suave del puño. */
  swing(weaponId = 'fists', who = null) {
    if (!this.ctx) return;
    this._golpe = { id: weaponId, t: this.ctx.currentTime };
    const pos = who && who.x !== undefined ? { x: who.x, y: (who.y ?? 0) + 1.3, z: who.z } : null;
    const mach = weaponId === 'machete';
    const r = mach ? 0.72 + Math.random() * 0.12 : 1.15 + Math.random() * 0.15;
    if (this._uno(GRUPOS.silbido, pos, { gain: mach ? 0.45 : 0.2, ref: 6, rate: r, envio: 0.03 })) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(600, t);
    bp.frequency.linearRampToValueAtTime(2000, t + 0.15);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.25, t + 0.07);
    g.gain.linearRampToValueAtTime(0, t + 0.18);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.2);
  }

  hit(pos, soft = false) {
    if (!this.ctx) return;
    if (soft) {
      // Golpe cuerpo a cuerpo: tajo de machete o puñetazo (según el último swing).
      const mach = this._golpe?.id === 'machete' && this.ctx.currentTime - this._golpe.t < 0.3;
      const p = pos && { x: pos.x, y: pos.y + 1.2, z: pos.z };
      if (this._uno(mach ? GRUPOS.tajo : GRUPOS.puno, p, { gain: mach ? 0.6 : 0.55, ref: 6, delay: 0.06, rate: 0.92 + Math.random() * 0.16, envio: 0.04 })) return;
    } else if (this._uno(GRUPOS.metal, pos, { gain: 0.5, ref: 7, rate: 0.9 + Math.random() * 0.25, envio: 0.12 })) {
      // Bala contra la lata de un carro.
      return;
    }
    this._blip(soft ? 180 : 320, 0.08, this._gainFor(pos, 6) * (soft ? 0.5 : 0.35), 'triangle');
  }

  crash(pos, strength) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = this.ctx.createGain();
    const v = Math.min(1, strength / 15) * this._gainFor(pos, 10);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.55);
  }

  explosion(pos) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2500, t);
    lp.frequency.exponentialRampToValueAtTime(80, t + 1.8);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(this._gainFor(pos, 25) * 1.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 2);
  }

  _blip(freq, dur, vol, type = 'sine') {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  ui(kind = 'ok') {
    if (kind === 'ok') {
      this._blip(880, 0.08, 0.15);
      setTimeout(() => this._blip(1320, 0.1, 0.15), 70);
    } else if (kind === 'money') {
      [988, 1319, 1568].forEach((f, i) => setTimeout(() => this._blip(f, 0.12, 0.18, 'triangle'), i * 80));
    } else if (kind === 'fail') {
      [440, 330, 220].forEach((f, i) => setTimeout(() => this._blip(f, 0.2, 0.2, 'sawtooth'), i * 150));
    } else if (kind === 'checkpoint') {
      this._blip(1046, 0.12, 0.2, 'triangle');
    } else {
      this._blip(660, 0.05, 0.1);
    }
  }

  /** Motor del vehículo del jugador (null = apagado). */
  /** Motor sintetizado de respaldo (sin AudioWorklet o mientras cargan los granos). */
  setEngine(on, rpm = 0, type = 'car') {
    if (!this.ctx) return;
    if (!on) this._apagarJugador();
    if (on && this.motores) return;
    if (on && !this.engine) {
      const o1 = this.ctx.createOscillator();
      const o2 = this.ctx.createOscillator();
      o1.type = 'sawtooth';
      o2.type = 'square';
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 600;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      o1.connect(lp);
      o2.connect(lp);
      lp.connect(g).connect(this.master);
      o1.start();
      o2.start();
      this.engine = { o1, o2, lp, g };
    }
    if (!on && this.engine) {
      const e = this.engine;
      e.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      setTimeout(() => {
        e.o1.stop();
        e.o2.stop();
      }, 400);
      this.engine = null;
      return;
    }
    if (this.engine) {
      const base = type === 'moto' ? 70 : type === 'buseta' ? 32 : 45;
      const f = base + rpm * (type === 'moto' ? 170 : 110);
      const t = this.ctx.currentTime;
      this.engine.o1.frequency.setTargetAtTime(f, t, 0.05);
      this.engine.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
      this.engine.lp.frequency.setTargetAtTime(400 + rpm * 1600, t, 0.05);
      this.engine.g.gain.setTargetAtTime(0.07 + rpm * 0.08, t, 0.05);
    }
  }

  horn(on) {
    if (!this.ctx) return;
    if (on && !this.hornNode) {
      const o = this.ctx.createOscillator();
      const o2 = this.ctx.createOscillator();
      o.type = o2.type = 'square';
      o.frequency.value = 410;
      o2.frequency.value = 500;
      const lp = this.ctx.createBiquadFilter();
      lp.frequency.value = 1500;
      const g = this.ctx.createGain();
      g.gain.value = 0.08;
      o.connect(lp);
      o2.connect(lp);
      lp.connect(g).connect(this.master);
      o.start();
      o2.start();
      this.hornNode = { o, o2 };
    } else if (!on && this.hornNode) {
      this.hornNode.o.stop();
      this.hornNode.o2.stop();
      this.hornNode = null;
    }
  }

  /** Sirena de policía con volumen según la distancia a la patrulla más cercana. */
  setSiren(dist) {
    if (!this.ctx) return;
    const on = dist < 160;
    if (on && !this.siren) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.9;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 280;
      lfo.connect(lfoGain).connect(o.frequency);
      o.frequency.value = 950;
      const lp = this.ctx.createBiquadFilter();
      lp.frequency.value = 2000;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      o.connect(lp).connect(g).connect(this.master);
      o.start();
      lfo.start();
      this.siren = { o, lfo, g };
    }
    if (!on && this.siren) {
      this.siren.o.stop();
      this.siren.lfo.stop();
      this.siren = null;
    }
    if (this.siren) this.siren.g.gain.setTargetAtTime(0.09 * Math.min(1, 25 / Math.max(25, dist)), this.ctx.currentTime, 0.1);
  }

  // ------------------------------------------------------------ vida del barrio
  /** Chirrido de llantas (nivel 0..1). */
  skid(level) {
    if (!this.ctx) return;
    if (level > 0 && !this.skidNode) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1900;
      bp.Q.value = 6;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      src.connect(bp).connect(g).connect(this.master);
      src.start();
      this.skidNode = { src, bp, g };
    }
    if (this.skidNode) {
      this.skidNode.g.gain.setTargetAtTime(0.09 * level, this.ctx.currentTime, 0.05);
      this.skidNode.bp.frequency.setTargetAtTime(1600 + level * 700, this.ctx.currentTime, 0.1);
      if (level === 0 && !this.skidOffTimer) {
        this.skidOffTimer = setTimeout(() => {
          this.skidOffTimer = null;
          if (this.skidNode && this.skidNode.g.gain.value < 0.005) {
            this.skidNode.src.stop();
            this.skidNode = null;
          }
        }, 600);
      }
    }
  }

  _tone(freq, t, dur, vol, type = 'sine', dest = this.master, sweep = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweep) o.frequency.linearRampToValueAtTime(freq + sweep, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.01, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _noiseHit(t, dur, vol, freq, q = 1, dest = this.master, type = 'bandpass') {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  /**
   * Ambiente: pájaros de día, grillos de noche, perros a lo lejos, la música
   * (cumbia) de la tienda más cercana y las campanas de la iglesia cada hora.
   * amb = {night, shopDist, churchDist, hour, parkDist}
   */
  updateAmbient(dt, amb) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const A = (this.amb ??= { bird: 2, dog: 12, lastHour: null, beat: 0, next: 0, crickets: null, music: null });
    // Pájaros (más cerca de parques y árboles).
    A.bird -= dt;
    if (A.bird <= 0) {
      A.bird = 1.5 + Math.random() * (amb.parkDist < 60 ? 3 : 7);
      if (amb.night < 0.4) {
        const base = 2400 + Math.random() * 1600;
        const n = 2 + Math.floor(Math.random() * 4);
        const vol = 0.012 + Math.random() * 0.02 * (amb.parkDist < 60 ? 1.6 : 1);
        for (let k = 0; k < n; k++) this._tone(base + Math.random() * 300, t + k * 0.11, 0.07, vol, 'sine', this.master, 700);
      }
    }
    // Grillos de noche (constantes, suaves).
    if (!A.crickets) {
      const o = this.ctx.createOscillator();
      o.frequency.value = 4300;
      const am = this.ctx.createOscillator();
      am.type = 'square';
      am.frequency.value = 28;
      const amG = this.ctx.createGain();
      amG.gain.value = 0.5;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      const vca = this.ctx.createGain();
      vca.gain.value = 0.5;
      am.connect(amG).connect(vca.gain);
      o.connect(vca).connect(g).connect(this.master);
      o.start();
      am.start();
      A.crickets = { g };
    }
    A.crickets.g.gain.setTargetAtTime(0.006 * Math.max(0, amb.night - 0.3), t, 0.5);
    // Perros ladrando a lo lejos.
    A.dog -= dt;
    if (A.dog <= 0) {
      A.dog = 15 + Math.random() * 40;
      const barks = 1 + Math.floor(Math.random() * 3);
      const f = 500 + Math.random() * 300;
      for (let k = 0; k < barks; k++) {
        this._noiseHit(t + k * 0.32, 0.16, 0.05, f, 4);
        this._tone(f * 0.5, t + k * 0.32, 0.12, 0.02, 'sawtooth', this.master, -120);
      }
    }
    // Música de la tienda más cercana: cumbia a 100 pulsos por minuto.
    const mv = amb.shopDist < 32 ? 0.1 * (1 - amb.shopDist / 32) : 0;
    if (!A.music && mv > 0) {
      const g = this.ctx.createGain();
      g.gain.value = 0;
      const lp = this.ctx.createBiquadFilter();
      lp.frequency.value = 2400; // suena "desde adentro"
      g.connect(lp).connect(this.master);
      A.music = { g };
      A.next = t + 0.05;
      A.beat = 0;
    }
    if (A.music) {
      A.music.g.gain.setTargetAtTime(mv, t, 0.3);
      if (mv === 0 && A.music.g.gain.value < 0.002) {
        A.music.g.disconnect();
        A.music = null;
      } else {
        const spb = 60 / 100 / 2; // corcheas
        const chords = [
          [220, 277.2, 329.6],
          [196, 246.9, 293.7],
          [174.6, 220, 261.6],
          [196, 246.9, 293.7],
        ];
        const bass = [110, 98, 87.3, 98];
        if (A.next < t) A.next = t + 0.02; // tras una pausa: seguir, no ponerse al día
        while (A.next < t + 0.25) {
          const step = A.beat % 8;
          const bar = Math.floor(A.beat / 8) % 4;
          const dest = A.music.g;
          if (step === 0 || step === 4) this._tone(bass[bar], A.next, 0.28, 0.5, 'sine', dest);
          if (step === 3 || step === 7) this._tone(bass[bar] * 1.5, A.next, 0.18, 0.3, 'sine', dest);
          // Guacharaca: rasgueo en cada corchea, acento a contratiempo.
          this._noiseHit(A.next, 0.07, step % 2 ? 0.22 : 0.1, 6000, 1.2, dest, 'highpass');
          // Acordes del acordeón en los contratiempos.
          if (step % 2 === 1) for (const f of chords[bar]) this._tone(f * 2, A.next, 0.16, 0.06, 'triangle', dest);
          A.next += spb;
          A.beat++;
        }
      }
    }
    // Campanas de la iglesia a cada hora (si estás cerca).
    const hour = Math.floor(amb.hour);
    if (A.lastHour !== null && hour !== A.lastHour && amb.churchDist < 220) {
      const n = hour % 12 || 12;
      const vol = 0.09 * Math.max(0.2, 1 - amb.churchDist / 220);
      for (let k = 0; k < Math.min(n, 6); k++) {
        for (const [f, v] of [[392, 1], [784, 0.4], [1176, 0.2], [523, 0.3]]) this._tone(f, t + k * 1.6, 2.4, vol * v, 'sine');
      }
    }
    A.lastHour = hour;
  }
}
