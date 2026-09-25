// Sonidos grabados de las armas (public/sounds/armas/*.ogg, generados por
// scripts/assets/sonidos.mjs): catálogo, carga asíncrona, respuesta al
// impulso de la calle (eco urbano) y el modelo de distancia. Sin DOM en el
// nivel del módulo para poder probarlo en Node.

export const RUTA_SONIDOS = 'sounds/armas/';

/** Por arma: variantes cercanas, versión lejana (grabada a distancia media) y mezcla. */
export const ARMAS_SFX = {
  pistol: { cerca: ['pistola_1', 'pistola_2', 'pistola_3'], lejos: 'pistola_lejos', gain: 0.8, vaina: true },
  smg: { cerca: ['subfusil_1', 'subfusil_2', 'subfusil_3'], lejos: 'subfusil_lejos', gain: 0.7, vaina: true },
  shotgun: { cerca: ['escopeta_1', 'escopeta_2', 'escopeta_3'], lejos: 'escopeta_lejos', gain: 1, bomba: true },
  rifle: { cerca: ['fusil_1', 'fusil_2'], lejos: 'fusil_lejos', gain: 0.95, vaina: true },
};

/** Recarga por arma: [sonido, momento (fracción del tiempo de recarga), solo si el arma quedó vacía]. */
export const RECARGAS = {
  pistol: [['pistola_cargador_fuera', 0.04], ['pistola_cargador_dentro', 0.46], ['pistola_corredera', 0.74, true]],
  smg: [['subfusil_cargador_fuera', 0.06], ['subfusil_cargador_dentro', 0.46], ['subfusil_cerrojo', 0.72]],
  rifle: [['fusil_cargador_fuera', 0.05], ['fusil_cargador_dentro', 0.47], ['fusil_manija', 0.72, true]],
};

export const GRUPOS = {
  vaina: ['vaina_1', 'vaina_2', 'vaina_3'],
  bomba: ['escopeta_bomba_1', 'escopeta_bomba_2'],
  desenfundar: ['desenfundar_1', 'desenfundar_2'],
  concreto: ['impacto_concreto_1', 'impacto_concreto_2'],
  metal: ['impacto_metal_1', 'impacto_metal_2', 'impacto_metal_3'],
  carne: ['impacto_carne_1', 'impacto_carne_2', 'impacto_carne_3'],
  rebote: ['rebote_1', 'rebote_2'],
  silbido: ['silbido_1', 'silbido_2', 'silbido_3'],
  tajo: ['tajo', 'tajo_2'],
  puno: ['puno_1', 'puno_2', 'puno_3'],
};

/** Todos los archivos que se cargan. */
export const SONIDOS_ARMAS = [
  ...new Set([
    ...Object.values(ARMAS_SFX).flatMap((a) => [...a.cerca, a.lejos]),
    ...Object.values(RECARGAS).flatMap((r) => r.map((x) => x[0])),
    ...Object.values(GRUPOS).flat(),
    'seco', 'enfundar', 'escopeta_cartucho', 'vaina_escopeta',
  ]),
];

export const VEL_SONIDO = 343; // m/s

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Cómo suena un disparo a `d` metros: retardo de propagación, pasa-bajos
 * (el aire y los obstáculos se comen los agudos), mezcla entre la grabación
 * cercana y la lejana (potencia constante) y cuánto va al eco de la calle,
 * que cae más despacio que el sonido directo (de lejos se oye sobre todo el eco).
 */
export function mezclaDistancia(d) {
  const w = smooth(18, 70, d);
  return {
    retardo: d / VEL_SONIDO,
    corte: Math.max(900, Math.min(18000, 18000 * Math.pow(12 / Math.max(12, d), 0.85))),
    cerca: Math.cos((w * Math.PI) / 2),
    lejos: Math.sin((w * Math.PI) / 2),
    envio: 0.22 + 0.6 * smooth(4, 90, d),
  };
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Respuesta al impulso (estéreo) de una calle de barrio entre casas de 2-4
 * pisos, en una ladera: reflexiones tempranas de las fachadas y el andén,
 * dos o tres ecos definidos de las fachadas de enfrente y de la cuadra, un
 * eco tardío y oscuro de la ladera del frente, y una cola difusa en la que
 * los agudos mueren antes que los graves. Cada parte se escala por energía
 * (g = amplitud equivalente respecto al sonido directo).
 */
export function crearRespuestaUrbana(sr, dur = 2.4, seed = 1234) {
  const n = Math.floor(sr * dur);
  const canales = [new Float32Array(n), new Float32Array(n)];
  const rnd = mulberry32(seed);
  const onePole = (fc) => 1 - Math.exp((-2 * Math.PI * fc) / sr);

  /** Ráfaga de ruido filtrado (reflexión difusa) con energía g² a partir de t. */
  const rafaga = (ch, t, g, largo, fc) => {
    const i0 = Math.floor(t * sr);
    const m = Math.max(1, Math.floor(largo * sr));
    const a = onePole(fc);
    const tmp = new Float32Array(m);
    let lp = 0;
    let e = 0;
    for (let j = 0; j < m; j++) {
      lp += a * (rnd() * 2 - 1 - lp);
      tmp[j] = lp * Math.exp((-4 * j) / m);
      e += tmp[j] * tmp[j];
    }
    const k = g / Math.sqrt(e || 1);
    for (let j = 0; j < m && i0 + j < n; j++) ch[i0 + j] += tmp[j] * k;
  };

  for (const [c, ch] of canales.entries()) {
    // Cola difusa: graves (RT60 ~1,9 s) y agudos (~0,6 s) por separado.
    const tail = new Float32Array(n);
    const a = onePole(1500);
    let lp = 0;
    let e = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const w = rnd() * 2 - 1;
      lp += a * (w - lp);
      const entrada = smooth(0.01, 0.07, t);
      const v = entrada * (lp * 2.2 * Math.exp((-6.91 * t) / 1.9) + (w - lp) * 0.6 * Math.exp((-6.91 * t) / 0.6));
      tail[i] = v;
      e += v * v;
    }
    const k = 0.55 / Math.sqrt(e);
    for (let i = 0; i < n; i++) ch[i] = tail[i] * k;
    // Reflexiones tempranas (andén, fachadas cercanas, aleros).
    for (let j = 0; j < 12; j++) {
      const t = 0.005 + Math.pow(rnd(), 1.4) * 0.085;
      rafaga(ch, t, (0.12 + rnd() * 0.2) * (1 - t * 5), 0.0015 + rnd() * 0.002, 7000);
    }
    // Ecos definidos de las fachadas del frente y de la cuadra (distintos por oído).
    const jit = () => (rnd() - 0.5) * 0.024;
    rafaga(ch, 0.125 + jit() + c * 0.009, 0.3, 0.008, 5000);
    rafaga(ch, 0.215 + jit(), 0.22, 0.012, 4000);
    rafaga(ch, 0.33 + jit() - c * 0.011, 0.15, 0.02, 3000);
    // Eco de la ladera de enfrente (el valle de Aburrá): tardío y oscuro.
    rafaga(ch, 0.56 + jit(), 0.11, 0.09, 1200);
  }
  return canales;
}

/**
 * Carga de los sonidos: los bytes se piden apenas se crea (no bloquea la
 * pantalla de carga) y se decodifican cuando exista el AudioContext (que
 * solo se crea tras un gesto del usuario). Mientras un sonido no esté listo,
 * `get` devuelve null y el sistema de audio usa su versión sintetizada.
 */
export class BancoSonidos {
  constructor(base = RUTA_SONIDOS, nombres = SONIDOS_ARMAS) {
    this.base = base;
    this.nombres = nombres;
    this.buffers = new Map();
    this.fallidos = [];
    this.bytes = null;
    this.ultimo = new Map();
    this.listo = null;
  }

  precargar() {
    if (this.bytes || typeof fetch === 'undefined') return;
    this.bytes = new Map(
      this.nombres.map((n) => [
        n,
        fetch(`${this.base}${n}.ogg`)
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .catch(() => null),
      ]),
    );
  }

  /** Decodifica todo en el contexto dado; devuelve una promesa que resuelve al terminar. */
  decodificar(ctx) {
    if (this.listo) return this.listo;
    this.precargar();
    if (!this.bytes) return (this.listo = Promise.resolve(0));
    this.listo = Promise.all(
      [...this.bytes].map(async ([n, p]) => {
        const ab = await p;
        if (!ab) return this.fallidos.push(n);
        try {
          this.buffers.set(n, await ctx.decodeAudioData(ab));
        } catch {
          this.fallidos.push(n);
        }
      }),
    ).then(() => this.buffers.size);
    return this.listo;
  }

  get(nombre) {
    return this.buffers.get(nombre) ?? null;
  }

  /** Una variante al azar entre las cargadas, sin repetir la anterior del mismo grupo. */
  elegir(nombres, clave = nombres[0]) {
    const ok = nombres.filter((n) => this.buffers.has(n));
    if (!ok.length) return null;
    const prev = this.ultimo.get(clave);
    const opciones = ok.length > 1 ? ok.filter((n) => n !== prev) : ok;
    const n = opciones[Math.floor(Math.random() * opciones.length)];
    this.ultimo.set(clave, n);
    return this.buffers.get(n);
  }
}
