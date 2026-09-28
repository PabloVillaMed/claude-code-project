// Sonidos de los pájaros, sintetizados (sin grabaciones): el aleteo de las
// palomas al arrancar, su zureo y los gritos de los loros que pasan.
// Usa el contexto y los generadores de AudioSystem (game/audio.js).

const MAX_POR_CUADRO = 3;

/** Reproduce los eventos de sonido de la simulación de pájaros (sim/birds.js). */
export function playBirdEvents(audio, events) {
  if (!audio?.ctx || audio.ctx.state !== 'running' || !events.length) return;
  let n = 0;
  for (const ev of events) {
    if (n++ >= MAX_POR_CUADRO) break;
    if (ev.type === 'aleteo') aleteo(audio, ev);
    else if (ev.type === 'zureo') zureo(audio, ev);
    else if (ev.type === 'loro') loro(audio, ev);
  }
}

/** Palomas arrancando: ráfaga de golpes de ala (ruido filtrado), más larga con más palomas. */
function aleteo(audio, ev) {
  const vol = 0.16 * audio._gainFor(ev, 6);
  if (vol < 0.004) return;
  const t = audio.ctx.currentTime;
  const golpes = Math.min(28, 6 + (ev.n ?? 6) * 3);
  for (let k = 0; k < golpes; k++) {
    const at = t + k * 0.04 + Math.random() * 0.03;
    const decay = 1 - k / (golpes + 4);
    audio._noiseHit(at, 0.045, vol * decay * (0.6 + Math.random() * 0.5), 1400 + Math.random() * 1800, 1.1, audio.master, 'bandpass');
  }
}

/** Zureo de paloma: "cu-currúu" grave con un poco de vibrato. */
function zureo(audio, ev) {
  const vol = 0.05 * audio._gainFor(ev, 4);
  if (vol < 0.003) return;
  const t = audio.ctx.currentTime;
  const f = 270 + Math.random() * 60;
  audio._tone(f, t, 0.16, vol * 0.7, 'sine', audio.master, 60);
  audio._tone(f * 1.25, t + 0.2, 0.42, vol, 'sine', audio.master, -f * 0.35);
  audio._tone(f * 2.5, t + 0.2, 0.3, vol * 0.12, 'triangle', audio.master, -f * 0.5);
}

/** Grito de loro: chillido áspero y corto con barrido de tono. */
function loro(audio, ev) {
  const vol = 0.07 * audio._gainFor(ev, 25);
  if (vol < 0.003) return;
  const ctx = audio.ctx;
  const t = ctx.currentTime;
  const dur = 0.1 + Math.random() * 0.12;
  const f = 1300 + Math.random() * 900;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(f, t);
  o.frequency.linearRampToValueAtTime(f + (Math.random() < 0.5 ? 500 : -400), t + dur);
  // Aspereza: modulación rápida de la frecuencia.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 70 + Math.random() * 50;
  const lfoG = ctx.createGain();
  lfoG.gain.value = f * 0.12;
  lfo.connect(lfoG).connect(o.frequency);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 2300;
  bp.Q.value = 1.4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(bp).connect(g).connect(audio.master);
  o.start(t);
  lfo.start(t);
  o.stop(t + dur + 0.02);
  lfo.stop(t + dur + 0.02);
}
