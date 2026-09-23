// Audio 100 % sintetizado con WebAudio (sin archivos): disparos por arma,
// motor según RPM, pito, sirena, explosiones, golpes y ambiente de ciudad.

export class AudioSystem {
  constructor() {
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
    this._ambient();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  suspend(on) {
    if (!this.ctx) return;
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

  click() {
    this._blip(1200, 0.03, 0.2, 'square');
  }

  swing() {
    if (!this.ctx) return;
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
  setEngine(on, rpm = 0, type = 'car') {
    if (!this.ctx) return;
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
}
