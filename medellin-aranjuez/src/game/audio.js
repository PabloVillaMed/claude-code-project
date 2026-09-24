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
