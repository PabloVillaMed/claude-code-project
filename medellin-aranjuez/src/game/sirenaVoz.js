// Voz sintetizada de una sirena de policía (cuándo suena y con qué patrón:
// sim/sirena.js). Timbre: portadora de pulso rica en armónicos, saturación
// suave, pasabanda y resonancia metálica de la bocina del parlante; luego
// pasabajos de distancia y cabina, volumen, paneo y envío al eco de la calle.
// Wail y yelp: un oscilador lento (LFO) con la forma del barrido mueve la
// frecuencia (el yelp es el mismo barrido, rápido). Chirp: ráfagas de dos o
// tres "uiu" programadas en la portadora. El tono por unidad y el Doppler van
// por el detune. No es una grabación: es una aproximación sintetizada.

import { SIRENA_TONO, curvaSaturacion, rangoBarrido, seriesBarrido, seriesPulso } from '../sim/sirena.js';

// Ondas y curva compartidas por todas las voces de un mismo AudioContext.
const RECURSOS = new WeakMap();
function recursosSirena(ctx) {
  let r = RECURSOS.get(ctx);
  if (!r) {
    const sb = seriesBarrido();
    const sp = seriesPulso();
    r = {
      barrido: ctx.createPeriodicWave(sb.real, sb.imag, { disableNormalization: true }),
      rango: rangoBarrido(sb),
      pulso: ctx.createPeriodicWave(sp.real, sp.imag),
      curva: curvaSaturacion(),
    };
    RECURSOS.set(ctx, r);
  }
  return r;
}

/** Corta lo programado de un parámetro sin saltos (donde se pueda). */
function soltarParam(p, t) {
  if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t);
  else p.cancelScheduledValues(t);
}

export class VozSirena {
  /** destino: bus de salida; eco: entrada del eco de la calle (o null); patron: con el que arranca. */
  constructor(ctx, destino, eco = null, patron = 'wail') {
    const T = SIRENA_TONO;
    const r = recursosSirena(ctx);
    this.ctx = ctx;
    this.rango = r.rango;
    this.osc = ctx.createOscillator();
    this.osc.setPeriodicWave(r.pulso);
    this.osc.frequency.value = r.rango.base;
    this.lfo = ctx.createOscillator();
    this.lfo.setPeriodicWave(r.barrido);
    this.lfo.frequency.value = 1 / T.wailPeriodo;
    this.prof = ctx.createGain();
    this.prof.gain.value = r.rango.prof;
    this.lfo.connect(this.prof).connect(this.osc.frequency);
    const sat = ctx.createWaveShaper();
    sat.curve = r.curva;
    sat.oversample = '2x';
    const bocina = ctx.createBiquadFilter();
    bocina.type = 'bandpass';
    bocina.frequency.value = T.bocinaHz;
    bocina.Q.value = T.bocinaQ;
    const metal = ctx.createBiquadFilter();
    metal.type = 'peaking';
    metal.frequency.value = T.metalHz;
    metal.Q.value = T.metalQ;
    metal.gain.value = T.metalDb;
    this.gate = ctx.createGain(); // abre y cierra los "uiu" del chirp
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.Q.value = 0.6;
    this.lp.frequency.value = 4000;
    this.vol = ctx.createGain();
    this.vol.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.osc.connect(sat).connect(bocina).connect(metal).connect(this.gate).connect(this.lp).connect(this.vol).connect(this.pan).connect(destino);
    this.envio = null;
    if (eco) {
      this.envio = ctx.createGain();
      this.envio.gain.value = 0;
      this.vol.connect(this.envio).connect(eco);
    }
    this.ritmo = 1;
    this.proxChirp = 0;
    if (patron === 'chirp') {
      // Arranca callada esperando la primera ráfaga (sin el arranque del wail).
      this.prof.gain.value = 0;
      this.gate.gain.value = 0;
      this.osc.frequency.value = T.chirpFMin;
      this.proxChirp = ctx.currentTime + 0.1;
    } else if (patron === 'yelp') this.lfo.frequency.value = T.yelpHz;
    this.patron = patron;
    this.osc.start();
    this.lfo.start();
    // Lo maneja la mezcla (audio.js): unidad dueña, la última que tuvo y el
    // nivel del fundido (0..1).
    this.owner = null;
    this.ultimo = null;
    this.nivel = 0;
  }

  /** Cambia de patrón ('wail'|'yelp'|'chirp'); ritmo: variación de la unidad. */
  setPatron(patron, ritmo = 1) {
    if (patron === this.patron && ritmo === this.ritmo) return;
    const T = SIRENA_TONO;
    const now = this.ctx.currentTime;
    if (patron === 'chirp') {
      if (this.patron !== 'chirp') {
        soltarParam(this.prof.gain, now);
        this.prof.gain.setTargetAtTime(0, now, 0.01);
        soltarParam(this.gate.gain, now);
        this.gate.gain.setTargetAtTime(0, now, 0.03);
        soltarParam(this.osc.frequency, now);
        this.osc.frequency.setTargetAtTime(T.chirpFMin, now, 0.03);
        this.proxChirp = now + 0.25;
      }
    } else {
      if (this.patron === 'chirp') {
        // Del chirp al barrido: la portadora vuelve a la base y el LFO manda.
        soltarParam(this.osc.frequency, now);
        this.osc.frequency.setTargetAtTime(this.rango.base, now, 0.03);
        soltarParam(this.gate.gain, now);
        this.gate.gain.setTargetAtTime(1, now, 0.05);
        soltarParam(this.prof.gain, now);
        this.prof.gain.setTargetAtTime(this.rango.prof, now, 0.03);
      }
      // El LFO sigue en su fase: el tono no salta al pasar de wail a yelp.
      this.lfo.frequency.setTargetAtTime((patron === 'yelp' ? T.yelpHz : 1 / T.wailPeriodo) * ritmo, now, 0.04);
    }
    this.patron = patron;
    this.ritmo = ritmo;
  }

  /** Programa la siguiente ráfaga de "uiu" con un poco de anticipación. */
  _chirps(now) {
    if (this.patron !== 'chirp' || now < this.proxChirp - 0.15) return;
    const T = SIRENA_TONO;
    const f = this.osc.frequency;
    const g = this.gate.gain;
    let t = Math.max(this.proxChirp, now + 0.02);
    const n = T.chirpN[0] + Math.floor(Math.random() * (T.chirpN[1] - T.chirpN[0] + 1));
    for (let i = 0; i < n; i++) {
      const d = T.chirpDur * (i === n - 1 ? 1.25 : 1); // el último "uiu" se estira
      f.setValueAtTime(T.chirpFMin, t);
      f.exponentialRampToValueAtTime(T.chirpFMax, t + d * 0.38);
      f.exponentialRampToValueAtTime(T.chirpFMin, t + d);
      g.setTargetAtTime(1, t, 0.008);
      g.setTargetAtTime(0, t + d - 0.05, 0.02);
      t += d + T.chirpPausaUiu;
    }
    this.proxChirp = t + T.chirpPausa[0] + Math.random() * (T.chirpPausa[1] - T.chirpPausa[0]);
  }

  /**
   * Mezcla del cuadro: ganancia (ya con el fundido), pasabajos (Hz), detune
   * (cents: tono de la unidad y Doppler), paneo y envío al eco.
   */
  set(gain, lp, detune, pan, eco, now = this.ctx.currentTime) {
    this._chirps(now);
    this.vol.gain.setTargetAtTime(gain, now, 0.06);
    this.lp.frequency.setTargetAtTime(lp, now, 0.08);
    this.osc.detune.setTargetAtTime(detune, now, 0.12);
    this.pan.pan.setTargetAtTime(pan, now, 0.08);
    if (this.envio) this.envio.gain.setTargetAtTime(eco, now, 0.08);
  }

  /** Apaga la voz (con un fundido corto si `fundido` > 0) y suelta los nodos. */
  parar(fundido = 0) {
    const now = this.ctx.currentTime;
    if (fundido > 0) this.vol.gain.setTargetAtTime(0, now, fundido / 4);
    const fin = now + fundido;
    this.osc.stop(fin);
    this.lfo.stop(fin);
    this.osc.onended = () => {
      this.pan.disconnect();
      this.envio?.disconnect();
    };
    this.owner = null;
  }
}
