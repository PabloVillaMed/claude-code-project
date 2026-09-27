// Motores con granos grabados (ver engineWorklet.js y scripts/assets/motores.mjs):
// perfiles de sonido por tipo de motor, carga de los granos y voces (la del
// jugador y unas pocas para el tráfico cercano, con distancia, paneo y
// efecto Doppler). Si el navegador no tiene AudioWorklet, AudioSystem usa su
// motor sintetizado de respaldo.

import { ENGINE_PROFILES } from '../sim/engineModel.js';

export const RUTA_MOTOR = 'sounds/motor/';

/**
 * Cómo suena cada perfil del modelo del motor: bancos de granos (sin y con
 * carga), cuánto sube el timbre con las rpm (`alpha`), tono (`pitchMul`),
 * ruido de admisión, variación, fallas, petardeo y el filtro del escape.
 */
export const SOUND_PROFILES = {
  moto4t: { off: 'moto_ralenti', on: 'moto_carga', alpha: 0.55, pitchMul: 1, noise: 0.22, noiseFreq: 1300, jitter: 0.06, misfire: 0.03, crackle: 1, lp: 5200, gain: 1 },
  moto4t_grande: { off: 'moto_ralenti', on: 'moto_carga', alpha: 0.5, pitchMul: 0.86, noise: 0.2, noiseFreq: 1100, jitter: 0.05, misfire: 0.025, crackle: 1, lp: 4600, gain: 1.1 },
  // Dos tiempos: explosión por vuelta, más aguda y rasposa ("rin-rin").
  moto2t: { off: 'moto_ralenti', on: 'moto_carga', alpha: 0.72, pitchMul: 1.5, noise: 0.32, noiseFreq: 2600, jitter: 0.07, misfire: 0.08, crackle: 0.6, lp: 6500, gain: 0.85 },
  // Scooter: motor tapado por la carcasa (más apagado) y variador.
  scooter: { off: 'moto_ralenti', on: 'moto_carga', alpha: 0.6, pitchMul: 1.18, noise: 0.3, noiseFreq: 1800, jitter: 0.04, misfire: 0.015, crackle: 0.2, lp: 3600, gain: 0.8 },
  carro_pequeno: { off: 'carro', on: 'carro', alpha: 0.5, pitchMul: 1.08, noise: 0.18, noiseFreq: 900, jitter: 0.035, misfire: 0.006, crackle: 0, lp: 3600, gain: 0.95 },
  carro: { off: 'carro', on: 'carro', alpha: 0.5, pitchMul: 1, noise: 0.16, noiseFreq: 850, jitter: 0.03, misfire: 0.004, crackle: 0, lp: 3400, gain: 1 },
  carro_viejo: { off: 'carro', on: 'carro', alpha: 0.45, pitchMul: 0.84, noise: 0.24, noiseFreq: 700, jitter: 0.07, misfire: 0.02, crackle: 0.1, lp: 2800, gain: 1.05 },
  camioneta: { off: 'carro', on: 'carro', alpha: 0.45, pitchMul: 0.9, noise: 0.18, noiseFreq: 750, jitter: 0.03, misfire: 0.004, crackle: 0, lp: 3100, gain: 1.1 },
  // Diésel: golpeteo seco de la inyección.
  diesel: { off: 'diesel', on: 'diesel', alpha: 0.35, pitchMul: 1, noise: 0.35, noiseFreq: 650, jitter: 0.025, misfire: 0, crackle: 0, lp: 2600, gain: 0.75 },
};

/** Opciones del procesador para un perfil (mecánica + sonido). */
export function workletProfile(id) {
  const m = ENGINE_PROFILES[id] ?? ENGINE_PROFILES.carro;
  const s = SOUND_PROFILES[id] ?? SOUND_PROFILES.carro;
  return { cyl: m.cyl, strokes: m.strokes, idle: m.idle, redline: m.redline, ...s };
}

/**
 * Carga el procesador y los granos. Devuelve {data, sent} o null si no se puede
 * (sin AudioWorklet o sin los archivos: se usa el motor de respaldo).
 */
export async function loadEngineBanks(ctx) {
  if (!ctx.audioWorklet) return null;
  await ctx.audioWorklet.addModule(new URL('./engineWorklet.js', import.meta.url));
  const man = await (await fetch(`${RUTA_MOTOR}motor.json`)).json();
  const buf = await (await fetch(`${RUTA_MOTOR}${man.archivo}`)).arrayBuffer();
  const audio = await ctx.decodeAudioData(buf);
  const data = audio.getChannelData(0);
  // El AudioContext puede ir a otra frecuencia de muestreo (44,1 kHz): se escalan las posiciones.
  const k = audio.sampleRate / man.sr;
  const banks = {};
  for (const [name, b] of Object.entries(man.bancos)) {
    banks[name] = { periodo: b.periodo, explosiones: b.explosiones, granos: b.granos.map(([a, n]) => data.slice(Math.round(a * k), Math.round((a + n) * k))) };
  }
  return { data: banks, sent: false };
}

let seed = 1;

/**
 * Una voz de motor: procesador granular -> pasa-bajos (escape y distancia)
 * -> realce de graves con carga -> ganancia -> paneo -> destino.
 */
export class EngineVoice {
  constructor(ctx, dest, banks, profileId) {
    this.ctx = ctx;
    this.profileId = profileId;
    this.node = new AudioWorkletNode(ctx, 'motor-granular', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      // Los granos se mandan solo con la primera voz (el procesador los comparte).
      processorOptions: { profile: workletProfile(profileId), banks: banks.sent ? null : banks.data, seed: (seed = (seed * 1103515245 + 12345) >>> 0) },
    });
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.Q.value = 0.6;
    this.shelf = ctx.createBiquadFilter();
    this.shelf.type = 'lowshelf';
    this.shelf.frequency.value = 220;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.node.connect(this.lp).connect(this.shelf).connect(this.gain).connect(this.pan).connect(dest);
    banks.sent = true;
    this.p = this.node.parameters;
    this.owner = null;
  }

  setProfile(id) {
    if (id === this.profileId) return;
    this.profileId = id;
    this.node.port.postMessage({ type: 'profile', profile: workletProfile(id) });
  }

  /**
   * s = {rpm, load, cut, crackle, pitch, gain, pan, lp (Hz extra de corte
   * por distancia, opcional)}. `tau`: suavizado de los cambios (s).
   */
  set(s, tau = 0.03, at = null) {
    const t = at ?? this.ctx.currentTime;
    const sp = SOUND_PROFILES[this.profileId] ?? SOUND_PROFILES.carro;
    this.p.get('rpm').setTargetAtTime(s.rpm, t, tau);
    this.p.get('load').setTargetAtTime(s.load ?? 0, t, 0.05);
    this.p.get('cut').setValueAtTime(s.cut ? 1 : 0, t);
    this.p.get('crackle').setValueAtTime(s.crackle ?? 0, t);
    this.p.get('pitch').setTargetAtTime(s.pitch ?? 1, t, 0.05);
    const lp = Math.min(sp.lp * (0.75 + 0.5 * (s.load ?? 0)), s.lp ?? 20000);
    this.lp.frequency.setTargetAtTime(lp, t, 0.05);
    this.shelf.gain.setTargetAtTime(2 + 5 * (s.load ?? 0), t, 0.08);
    this.gain.gain.setTargetAtTime(s.gain ?? 0, t, 0.06);
    this.pan.pan.setTargetAtTime(s.pan ?? 0, t, 0.05);
  }

  silence(tau = 0.12) {
    this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, tau);
    this.owner = null;
  }

  dispose() {
    this.silence(0.05);
    const n = this.node;
    setTimeout(() => {
      try {
        n.disconnect();
        this.pan.disconnect();
      } catch {
        /* ya desconectado */
      }
    }, 400);
  }
}

/**
 * Mezcla de una voz del tráfico según la distancia `d` (m) y la velocidad
 * radial `vr` (m/s, positiva si se acerca): ganancia, corte de agudos y
 * efecto Doppler (c / (c - vr)).
 */
export function trafficMix(d, vr) {
  const c = 343;
  const pitch = Math.min(1.25, Math.max(0.8, c / (c - Math.max(-60, Math.min(60, vr)))));
  const gain = Math.min(1, 7 / (7 + d)) ** 1.6;
  const lp = 9000 / (1 + d / 18);
  return { pitch, gain, lp };
}
