// Procesador de audio (AudioWorklet) del motor: síntesis granular con
// explosiones grabadas (public/sounds/motor, ver scripts/assets/motores.mjs).
//
// En cada explosión (al ritmo de las revoluciones: cilindros y tiempos del
// motor) se dispara un grano distinto elegido al azar de dos bancos, sin
// carga (ralentí, desacelerando) y con carga (acelerando), mezclados según el
// acelerador. El grano se acelera solo en parte (exponente `alpha`) para que
// el timbre suba con las revoluciones sin sonar a cinta acelerada; si la
// siguiente explosión llega antes de que termine, se recorta con un fundido.
// Encima: variación de tiempo y fuerza de cada explosión (más en ralentí),
// diferencias fijas entre cilindros, fallas de encendido ocasionales, corte
// del limitador y del cambio de marcha, ruido de admisión que late con cada
// explosión y petardeo del escape al desacelerar (motos).
//
// Este archivo no importa nada: el navegador lo carga aparte con
// audioWorklet.addModule.

// Granos compartidos por todas las voces del mismo AudioContext (se mandan
// una sola vez, con la primera voz).
let SHARED = {};

class Motor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 1000, minValue: 0, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'pitch', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' },
      { name: 'cut', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'crackle', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    const o = options.processorOptions ?? {};
    this.banks = {};
    this.voices = [];
    this.until = 0;
    this.cylIndex = 0;
    this.seed = (o.seed ?? 1) >>> 0 || 1;
    this.noise = { lp: 0, bp: 0, env: 0 };
    this.pops = [];
    this.setProfile(o.profile ?? {});
    if (o.banks) this.setBanks(o.banks);
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'banks') this.setBanks(m.banks);
      else if (m.type === 'profile') this.setProfile(m.profile);
    };
  }

  rand() {
    // xorshift32: barato y sin reservar memoria.
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  setBanks(banks) {
    // banks: {nombre: {periodo, explosiones, granos: [Float32Array]}}
    SHARED = banks;
  }

  get banks() {
    return SHARED;
  }

  set banks(v) {
    /* los bancos viven en SHARED */
  }

  setProfile(p) {
    this.p = {
      cyl: 1,
      strokes: 4,
      idle: 1000,
      redline: 7000,
      off: 'moto_ralenti',
      on: 'moto_carga',
      alpha: 0.55,
      pitchMul: 1,
      noise: 0.2,
      noiseFreq: 1200,
      jitter: 0.05,
      misfire: 0.01,
      crackle: 0,
      gain: 1,
      ...p,
    };
    // Diferencias fijas entre cilindros (fuerza y adelanto del encendido).
    const n = this.p.cyl;
    this.cylGain = Array.from({ length: n }, (_, i) => 1 + (n > 1 ? ((i * 7919) % 13) / 13 - 0.5 : 0) * 0.16);
    this.cylTime = Array.from({ length: n }, (_, i) => (n > 1 ? (((i * 104729) % 17) / 17 - 0.5) * 0.05 : 0));
    // Las voces del tráfico se reutilizan entre vehículos: el cilindro actual
    // puede no existir en el motor nuevo (de un carro de 4 a una moto de 1).
    // Sin esto el intervalo salía NaN y la voz mandaba NaN para siempre.
    this.cylIndex = 0;
    this.until = 0;
    this.voices.length = 0;
    this.pops.length = 0;
  }

  /** Dispara una explosión: uno o dos granos (bancos con y sin carga). */
  fire(rpm, load, pitch, cut, interval) {
    const p = this.p;
    const rn = Math.min(1, Math.max(0, (rpm - p.idle) / (p.redline - p.idle)));
    // Corte de encendido (limitador o cambio): la mayoría de explosiones no ocurre.
    if (cut > 0 && this.rand() < cut * 0.85) return;
    // Fallas en ralentí y desacelerando (sobre todo en motos y motores viejos).
    if (this.rand() < p.misfire * (1 - rn) * (1 - load)) return;
    const ci = this.cylIndex;
    let amp = (0.55 + 0.45 * load) * (0.75 + 0.35 * rn) * this.cylGain[ci] * (1 + (this.rand() - 0.5) * 0.24);
    if (cut > 0) amp *= 1 - 0.6 * cut;
    const layers = [
      [p.off, 1 - load * 0.8],
      [p.on, load],
    ];
    this.count = (this.count ?? 0) + 1;
    for (const [name, w] of layers) {
      const b = this.banks[name];
      if (!b || w < 0.03 || !b.granos.length) continue;
      // Granos de varias explosiones (diésel): uno cada tantas.
      if (this.count % (b.explosiones ?? 1)) continue;
      const g = b.granos[Math.floor(this.rand() * b.granos.length)];
      // Ritmo natural del grano contra el ritmo actual (en muestras).
      const T0 = b.periodo * (b.explosiones ?? 1) * sampleRate;
      const I = interval * (b.explosiones ?? 1);
      let rate = p.pitchMul * pitch * Math.pow(T0 / I, p.alpha);
      rate = Math.min(4, Math.max(0.35, rate)) * (1 + (this.rand() - 0.5) * 0.03);
      // Duración de salida: el grano entero o hasta 2,2 explosiones después.
      const outLen = Math.min(g.length / rate, I * 2.2);
      if (this.voices.length >= 14) this.voices.shift();
      this.voices.push({ g, pos: 0, rate, amp: amp * w * p.gain, left: outLen, total: outLen });
    }
    // Admisión y mecánica: un golpe de ruido filtrado en cada explosión.
    this.noise.env = Math.max(this.noise.env, p.noise * (0.35 + load) * (0.4 + rn));
    this.cylIndex = (ci + 1) % p.cyl;
  }

  process(inputs, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const p = this.p;
    const rpm = Math.max(1, params.rpm[0]);
    const load = params.load[0];
    const pitch = params.pitch[0];
    const cut = params.cut[0];
    const crackle = params.crackle[0] * p.crackle;
    const rn = Math.min(1, Math.max(0, (rpm - p.idle) / (p.redline - p.idle)));
    // Explosiones por segundo (con el efecto Doppler incluido en `pitch`).
    const fireHz = (rpm / 60) * p.cyl * (2 / p.strokes) * pitch;
    const base = sampleRate / fireHz;
    const jit = p.jitter * (1 - 0.8 * rn);
    // Ruido de admisión: pasa-banda de estado variable que sube con las rpm.
    // Forma trapezoidal (Simper): estable a cualquier frecuencia. La de
    // Chamberlin se volvía inestable con frecuencias altas (moto 2T acelerada
    // y con Doppler), su estado crecía hasta NaN y el motor quedaba mudo y
    // ensuciaba los filtros que vienen después.
    const fc = Math.min(0.45 * sampleRate, p.noiseFreq * (0.6 + 1.2 * rn) * pitch);
    const gF = Math.tan((Math.PI * fc) / sampleRate);
    const kF = 0.9;
    const a1 = 1 / (1 + gF * (gF + kF));
    const a2 = gF * a1;
    const a3 = gF * a2;
    const decay = Math.exp(-1 / (base * 0.35));
    const n = this.noise;
    for (let i = 0; i < out.length; i++) {
      if (--this.until <= 0) {
        const interval = base * (1 + this.cylTime[this.cylIndex] + (this.rand() - 0.5) * 2 * jit);
        this.fire(rpm, load, pitch, cut, interval);
        this.until += interval;
        // Petardeo del escape: sin acelerador y con revoluciones altas.
        if (crackle > 0 && this.rand() < crackle * 0.12) {
          const k = 1 + Math.floor(this.rand() * 3);
          for (let j = 0; j < k; j++) this.pops.push({ at: Math.floor(this.rand() * base * 1.5), len: Math.floor(sampleRate * (0.003 + this.rand() * 0.006)), amp: 0.35 + this.rand() * 0.5, lp: 0 });
        }
      }
      let s = 0;
      for (let v = this.voices.length - 1; v >= 0; v--) {
        const vo = this.voices[v];
        const idx = vo.pos | 0;
        const g = vo.g;
        if (idx + 1 >= g.length || vo.left <= 0) {
          this.voices.splice(v, 1);
          continue;
        }
        const fr = vo.pos - idx;
        let x = g[idx] + (g[idx + 1] - g[idx]) * fr;
        // Fundido al final del tramo que se usa (evita clics al recortar).
        const rel = vo.left / vo.total;
        if (rel < 0.2) x *= rel / 0.2;
        s += x * vo.amp;
        vo.pos += vo.rate;
        vo.left--;
      }
      // Ruido blanco -> pasa-banda, con la envolvente de la explosión.
      const w = this.rand() * 2 - 1;
      const v3 = w - n.lp;
      const bp = a1 * n.bp + a2 * v3;
      const lp = n.lp + a2 * n.bp + a3 * v3;
      n.bp = 2 * bp - n.bp;
      n.lp = 2 * lp - n.lp;
      s += bp * n.env * 0.5;
      n.env *= decay;
      // Petardeos: ruido grave muy corto.
      for (let k = this.pops.length - 1; k >= 0; k--) {
        const po = this.pops[k];
        if (po.at > 0) {
          po.at--;
          continue;
        }
        po.lp += ((this.rand() * 2 - 1) - po.lp) * 0.25;
        s += po.lp * po.amp * (po.len / (po.len + 40));
        if (--po.len <= 0) this.pops.splice(k, 1);
      }
      // Saturación suave (la carga "ensucia" el sonido como un escape real).
      const d = 1 + load * 0.8;
      out[i] = Math.tanh(s * d) / Math.sqrt(d);
    }
    // Nunca mandar NaN: un solo valor inválido daña los filtros de la cadena
    // (y la mezcla entera, porque todo suma en el mismo bus).
    if (!Number.isFinite(out[0]) || !Number.isFinite(out[out.length - 1]) || !Number.isFinite(this.until)) {
      out.fill(0);
      n.lp = n.bp = n.env = 0;
      this.voices.length = 0;
      this.pops.length = 0;
      this.until = 0;
      this.cylIndex = 0;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}

registerProcessor('motor-granular', Motor);
