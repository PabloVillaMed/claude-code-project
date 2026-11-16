// El sonido del salón de las discotecas: adentro, la música y las voces
// suenan con la reverberación del recinto (un ConvolverNode con la respuesta
// que sim/salon.js arma según el tamaño del local), la gente murmura y grita
// (sintetizado, con tope de voces), el corro aplaude cuando el jugador baila
// bien (game/danceGame.js) y la calle se oye apagada y filtrada (el filtro
// `calle` de game/audio.js). Todo entra y sale con una transición suave.
// También le pone voz (subtítulos) al local: el DJ, el animador de la fonda,
// el cantante de la orquesta, el bartender al servir y la gente que baila.
//
// Barato: un solo convolvedor (conectado solo con el jugador adentro), un
// murmullo y unos aplausos en bucle (un buffer cada uno) y unos pocos gritos
// prearmados que se reparten con tope; las ganancias se mueven solo cuando
// cambian. La respuesta del recinto se arma al acercarse a la puerta (no al
// cruzarla) y se guarda por local.

import { aplausos, grito, medidaSalon, respuestaSalon } from '../sim/salon.js';
import { murmullo } from '../sim/nightlife.js';

// ------------------------------------------------------------------ configurables
/** El sonido de adentro. */
export const SALON = {
  /** Envío a la reverberación: de la música (bus de la radio) y de efectos y voces (master), y volumen de lo que sale. */
  ENVIO_MUSICA: 0.3,
  ENVIO_EFECTOS: 0.32,
  REVERB_VOL: 0.85,
  /** La calle desde adentro: pasabajos (Hz) y volumen (fracción). */
  CALLE_HZ: 620,
  CALLE_VOL: 0.45,
  /** s de la transición (constante de tiempo de las rampas) al entrar y al salir. */
  TRANSICION: 0.35,
  /** s afuera antes de desconectar el convolvedor (ya en silencio). */
  SOLTAR: 3,
  /** Murmullo de la gente adentro: volumen con el local lleno, con la estampida, y pasabajos (Hz). */
  MURMULLO_VOL: 0.14,
  MURMULLO_PANICO: 0.3,
  MURMULLO_HZ: 2600,
  /** Gritos de rumba ("¡eeeh!", "¡uepa!"): s entre uno y otro con el local lleno (más seguido con la emoción del baile), voces a la vez, volumen y variantes prearmadas. */
  GRITOS_CADA: [6, 14],
  GRITOS_MAX: 3,
  GRITO_VOL: 0.2,
  GRITOS_VARIANTES: 6,
  /** Aplausos del corro: volumen máximo. */
  APLAUSOS_VOL: 0.26,
  /** Frecuencias de muestreo de lo sintetizado. */
  SR_VOZ: 22050,
  SR_APLAUSO: 32000,
  /** s entre frases del DJ, el animador o el cantante, y entre comentarios de la gente que baila cerca. */
  FRASES_CADA: [16, 30],
  GENTE_CADA: [22, 40],
  /** Respuestas del recinto guardadas (una por local, ~0,3-0,6 MB cada una): con 8 se calcula una sola vez por local y partida. */
  IRS_GUARDADAS: 8,
};

const azar = (a, b) => a + Math.random() * (b - a);

export class SalonSound {
  constructor(game) {
    this.game = game;
    this.ok = false;
    this.ctx = null;
    this.r = null; // local cuya respuesta está puesta en el convolvedor
    this.irs = new Map(); // id -> AudioBuffer (los SALON.IRS_GUARDADAS más recientes)
    this.pend = null; // {r, L, R}: respuesta calculada esperando a ponerse (al cuadro siguiente)
    this.dentro = false;
    this.conectado = false;
    this.fueraT = 0;
    this.gritos = []; // AudioBuffer prearmados
    this.vivos = 0; // gritos sonando
    this.gritoT = azar(...SALON.GRITOS_CADA);
    this.fraseT = azar(...SALON.FRASES_CADA);
    this.genteT = azar(...SALON.GENTE_CADA);
    this.aplauso = 0; // nivel pedido (0..1)
    this.aplausoAct = -1;
    this.murmulloAct = -1;
    this.tickT = 0;
    this.panicoAntes = false;
  }

  _armar() {
    const a = this.game.audio;
    const radio = this.game.radio;
    if (this.ok || !a?.ctx || !a.master) return this.ok;
    const ctx = (this.ctx = a.ctx);
    try {
      this.conv = ctx.createConvolver();
      this.conv.normalize = false;
      this.revOut = ctx.createGain();
      this.revOut.gain.value = SALON.REVERB_VOL;
      this.conv.connect(this.revOut).connect(ctx.destination);
      this.envioMusica = ctx.createGain();
      this.envioMusica.gain.value = 0;
      this.envioFx = ctx.createGain();
      this.envioFx.gain.value = 0;
      // Lo del salón (murmullo, gritos, aplausos) entra al master: pasa por el compresor, el volumen y el envío de efectos.
      this.bus = ctx.createGain();
      this.bus.connect(a.master);
      this.radioBus = radio?.bus ?? null;
      this.ok = true;
    } catch (e) {
      console.warn('Sonido del salón no disponible:', e?.message ?? e);
    }
    return this.ok;
  }

  update(dt) {
    const g = this.game;
    if (g.state !== 'playing') return;
    if (!this._armar()) return;
    const cl = g.clubLife;
    const dentro = g.interiors?.inside ?? null;
    // La respuesta del recinto se prepara al activarse el local (el jugador en la puerta).
    const cerca = dentro ?? cl?.r ?? null;
    if (cerca && cerca !== this.r) this._preparar(cerca);
    this._entrar(dentro, dt);
    if (!this.conectado) return;
    this.tickT -= dt;
    if (this.tickT > 0) return;
    this.tickT = 0.2;
    const t = this.ctx.currentTime;
    // Murmullo: según cuánta gente hay (y más duro con la estampida).
    const lleno = cl?.r === dentro && cl.cupo > 0 ? Math.min(1, cl.gente.length / Math.max(8, cl.cupo)) : 0;
    const panico = !!cl?.panico && cl.r === dentro;
    const mur = dentro ? (panico ? SALON.MURMULLO_PANICO : SALON.MURMULLO_VOL * lleno * (1 + 0.4 * (g.danceGame?.emocion ?? 0))) : 0;
    if (mur > 0.002) this._murmullo();
    if (this.mur && Math.abs(mur - this.murmulloAct) > 0.004) {
      this.murmulloAct = mur;
      this.mur.gain.gain.setTargetAtTime(mur, t, panico ? 0.15 : 0.5);
    }
    // Aplausos del corro.
    const ap = dentro ? this.aplauso * SALON.APLAUSOS_VOL : 0;
    if (ap > 0.002) this._aplausos();
    if (this.apl && Math.abs(ap - this.aplausoAct) > 0.004) {
      this.aplausoAct = ap;
      this.apl.gain.gain.setTargetAtTime(ap, t, ap > 0 ? 0.25 : 0.6);
    }
    if (!dentro || !cl || cl.r !== dentro) return;
    // Gritos: de vez en cuando con el local lleno (más seguido con la emoción del baile); con la estampida, de susto.
    if (panico && !this.panicoAntes) for (let k = 0; k < 3; k++) this._grito(1.25 + Math.random() * 0.15, 0.9, k * 0.18);
    this.panicoAntes = panico;
    this.gritoT -= 0.2 * (1 + 2 * (g.danceGame?.emocion ?? 0)) * (panico ? 2.5 : 1);
    if (this.gritoT <= 0 && lleno > 0.25) {
      this.gritoT = azar(...SALON.GRITOS_CADA);
      this._grito(panico ? 1.3 : 0.9 + Math.random() * 0.2, panico ? 0.9 : 0.5 + 0.5 * lleno);
    }
    if (panico) return;
    // Frases del local (subtítulos): DJ, animador o cantante; y la gente que baila cerca del jugador.
    this.fraseT -= 0.2;
    if (this.fraseT <= 0) {
      this.fraseT = azar(...SALON.FRASES_CADA);
      this._fraseLocal();
    }
    this.genteT -= 0.2;
    if (this.genteT <= 0) {
      this.genteT = azar(...SALON.GENTE_CADA);
      this._fraseGente();
    }
  }

  // ------------------------------------------------------------ el recinto
  /** Calcula la respuesta del local `r` (o la saca de las guardadas) y la pone al cuadro siguiente. */
  _preparar(r) {
    const ctx = this.ctx;
    if (this.pend?.r === r) {
      if (this.pend.L) this._poner(r, this.pend);
      return;
    }
    const hecha = this.irs.get(r.id);
    if (hecha) {
      if (!this.conectado || this.nivelEnvio < 0.02) this._ponerBuffer(r, hecha);
      return;
    }
    const M = medidaSalon(r);
    let h = 7;
    for (let i = 0; i < r.id.length; i++) h = (h * 31 + r.id.charCodeAt(i)) >>> 0;
    const [L, R] = respuestaSalon(ctx.sampleRate, { ...M, g: 0.5, semilla: h });
    this.pend = { r, L, R };
  }

  _poner(r, P) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(2, P.L.length, ctx.sampleRate);
    buf.copyToChannel(P.L, 0);
    buf.copyToChannel(P.R, 1);
    this.pend = null;
    this.irs.set(r.id, buf);
    // (se guardan las SALON.IRS_GUARDADAS más recientes)
    if (this.irs.size > SALON.IRS_GUARDADAS) this.irs.delete(this.irs.keys().next().value);
    this._ponerBuffer(r, buf);
  }

  _ponerBuffer(r, buf) {
    // Cambiar la respuesta con el envío abierto daría un golpe: solo con el envío en silencio.
    if (this.conectado && this.nivelEnvio > 0.02) return;
    this.conv.buffer = buf;
    this.r = r;
  }

  /** Abre o cierra el salón: envíos a la reverberación y filtro de la calle. */
  _entrar(dentro, dt) {
    const a = this.game.audio;
    const t = this.ctx.currentTime;
    const T = SALON.TRANSICION;
    const quiere = !!dentro && this.r === dentro;
    if (quiere !== this.dentro) {
      this.dentro = quiere;
      if (quiere && !this.conectado) {
        this.radioBus ??= this.game.radio?.bus ?? null;
        this.radioBus?.connect(this.envioMusica);
        a.master.connect(this.envioFx);
        this.envioMusica.connect(this.conv);
        this.envioFx.connect(this.conv);
        this.conectado = true;
      }
      this.envioMusica.gain.setTargetAtTime(quiere ? SALON.ENVIO_MUSICA : 0, t, T);
      this.envioFx.gain.setTargetAtTime(quiere ? SALON.ENVIO_EFECTOS : 0, t, T);
      if (a.calle) {
        a.calle.frequency.setTargetAtTime(quiere ? SALON.CALLE_HZ : 22000, t, T);
        a.calleGain.gain.setTargetAtTime(quiere ? SALON.CALLE_VOL : 1, t, T);
      }
      this.fueraT = 0;
    }
    this.nivelEnvio = this.envioMusica.gain.value;
    // Afuera un rato (ya en silencio): se desconecta el convolvedor (no gasta).
    if (!quiere && this.conectado && (this.fueraT += dt) > SALON.SOLTAR) {
      try {
        this.radioBus?.disconnect(this.envioMusica);
        a.master.disconnect(this.envioFx);
        this.envioMusica.disconnect();
        this.envioFx.disconnect();
      } catch {
        /* ya estaba desconectado */
      }
      this.conectado = false;
      this.nivelEnvio = 0;
    }
  }

  /** Al menú (Game.setState; update no corre ahí): se sale del salón de una (la calle sin filtro, sin reverberación, murmullo ni aplausos). */
  salir() {
    if (!this.ok) return;
    this._entrar(null, 0);
    const t = this.ctx.currentTime;
    this.aplauso = 0;
    this.murmulloAct = this.aplausoAct = 0;
    this.mur?.gain.gain.setTargetAtTime(0, t, SALON.TRANSICION);
    this.apl?.gain.gain.setTargetAtTime(0, t, SALON.TRANSICION);
  }

  // ------------------------------------------------------------ la gente
  _murmullo() {
    if (this.mur) return;
    const ctx = this.ctx;
    // El de la rumba de afuera (game/nightlife.js) si ya está armado; si no, uno propio más corto.
    let buf = this.game.nightlife?._buf;
    if (!buf) {
      const data = murmullo(SALON.SR_VOZ, 3, 6, 921);
      buf = ctx.createBuffer(1, data.length, SALON.SR_VOZ);
      buf.getChannelData(0).set(data);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = 0.94; // (otra gente que la de la puerta)
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = SALON.MURMULLO_HZ;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(lp).connect(gain).connect(this.bus);
    src.start(0, Math.random() * buf.duration);
    this.mur = { src, gain };
  }

  _aplausos() {
    if (this.apl) return;
    const ctx = this.ctx;
    const data = aplausos(SALON.SR_APLAUSO, 2.4, 10, 31);
    const buf = ctx.createBuffer(1, data.length, SALON.SR_APLAUSO);
    buf.getChannelData(0).set(data);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(this.bus);
    src.start();
    this.apl = { src, gain };
  }

  /** Un grito de la gente (rate: tono; vol: 0..1; demora: s). */
  _grito(rate = 1, vol = 0.7, demora = 0) {
    if (this.vivos >= SALON.GRITOS_MAX || !this.ctx) return;
    const ctx = this.ctx;
    // Las variantes se arman de a una (la primera vez que hacen falta).
    if (this.gritos.length < SALON.GRITOS_VARIANTES) {
      const k = this.gritos.length;
      const data = grito(SALON.SR_VOZ, { semilla: 11 + k * 7, mujer: k % 2 === 1 });
      const b = ctx.createBuffer(1, data.length, SALON.SR_VOZ);
      b.getChannelData(0).set(data);
      this.gritos.push(b);
    }
    const src = ctx.createBufferSource();
    src.buffer = this.gritos[Math.floor(Math.random() * this.gritos.length)];
    src.playbackRate.value = rate * (0.94 + Math.random() * 0.12);
    const gain = ctx.createGain();
    gain.gain.value = SALON.GRITO_VOL * vol;
    let n = src.connect(gain);
    if (ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = (Math.random() - 0.5) * 1.2;
      n = n.connect(pan);
    }
    n.connect(this.bus);
    this.vivos++;
    src.onended = () => {
      this.vivos--;
      src.disconnect();
    };
    src.start(ctx.currentTime + demora);
  }

  /** Vítores del corro (game/danceGame.js): unos gritos juntos, `nivel` 0..1. */
  vitorear(nivel = 0.6) {
    if (!this.conectado) return;
    const n = 1 + Math.round(nivel * 2);
    for (let k = 0; k < n; k++) this._grito(0.95 + Math.random() * 0.25, 0.6 + 0.4 * nivel, k * 0.12 + Math.random() * 0.1);
  }

  /** Nivel de aplausos del corro (0..1; game/danceGame.js cada cuadro). */
  aplaudir(nivel = 0) {
    this.aplauso = nivel;
  }

  // ------------------------------------------------------------ las voces del local
  /** Alguien del local con ese rol (y, si se da, que cumpla `si`). */
  _quien(rol, si = null) {
    const cl = this.game.clubLife;
    for (const m of cl?.gente ?? []) if (m.alive && m.club?.q.rol === rol && m.club.estado === 'normal' && (!si || si(m))) return m;
    return null;
  }

  _fraseLocal() {
    const d = this.game.dialogue;
    if (!d) return;
    const op = [];
    const dj = this._quien('dj');
    if (dj) op.push([dj, 'dj', 'DJ']);
    const an = this._quien('animador');
    if (an) op.push([an, 'animador', 'Animador']);
    const ca = this._quien('musico', (m) => m.club.q.inst === 'voz');
    if (ca) op.push([ca, 'cantante', ca.look?.female ? 'Cantante' : 'Cantante']);
    if (!op.length) return;
    const [m, cat, label] = op[Math.floor(Math.random() * op.length)];
    d.speak(m, cat, { label });
  }

  _fraseGente() {
    const g = this.game;
    const p = g.player;
    let best = null;
    let bd = 5;
    for (const m of g.clubLife?.gente ?? []) {
      const C = m.club;
      if (!m.alive || C.q.rol !== 'baile' || C.estado !== 'normal') continue;
      const d = Math.hypot(m.sim.x - p.x, m.sim.z - p.z);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    if (best) g.dialogue?.speak(best, 'baile_gente', { label: best.look?.female ? 'Rumbera' : 'Rumbero' });
  }

  /** El bartender dice algo al servir (game/interiors.js pedirGuaro). */
  bartender() {
    const g = this.game;
    const p = g.player;
    let best = null;
    let bd = 6;
    for (const m of g.clubLife?.gente ?? []) {
      if (!m.alive || m.club?.q.rol !== 'bartender') continue;
      const d = Math.hypot(m.sim.x - p.x, m.sim.z - p.z);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    if (best) g.dialogue?.speak(best, 'bartender', { label: 'Bartender' });
  }

  /** Estado para pruebas. */
  info() {
    return {
      armado: this.ok,
      dentro: this.dentro,
      conectado: this.conectado,
      local: this.r?.id ?? null,
      respuestas: [...this.irs.keys()],
      envio: +(this.envioMusica?.gain.value ?? 0).toFixed(3),
      calleHz: Math.round(this.game.audio?.calle?.frequency.value ?? 0),
      murmullo: +(this.murmulloAct > 0 ? this.murmulloAct : 0).toFixed(3),
      aplausos: +(this.aplausoAct > 0 ? this.aplausoAct : 0).toFixed(3),
      gritos: this.vivos,
      variantes: this.gritos.length,
    };
  }
}
