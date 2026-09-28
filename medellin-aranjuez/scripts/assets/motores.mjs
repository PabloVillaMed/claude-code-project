// Granos de motor grabados para el sonido de los vehículos
// (public/sounds/motor/motor.ogg + motor.json).
// Reproducible: `node scripts/assets/motores.mjs` (usa caché en .cache/sonidos/motor/).
//
// Método: de cada grabación se toma un tramo con el motor estable, se mide
// cuántas explosiones hay por segundo (autocorrelación de la envolvente) y se
// corta en "granos": uno por explosión (o por unas pocas, en el diésel),
// desde justo antes de un pulso hasta justo antes del siguiente. El juego
// (src/game/engineWorklet.js) vuelve a disparar esos granos al ritmo de las
// revoluciones del momento, eligiendo uno distinto cada vez: así el motor
// suena a pulsos reales y nunca a un tono continuo.
//
// Fuentes (todas CC0, vistas previas HQ públicas de Freesound; ver
// ASSETS-CREDITS.md):
//  - moto en ralentí: "Motorcycle_Yamaha_Tenere_250CC_Enduro_Idle" (Singular_Estudio);
//  - moto andando (con carga): "Jerry Honda 125 slow follow & ride off" (3bagbrew);
//  - carro: "Sedan engine loop" (Dmitry_mansurev64);
//  - diésel: "Diesel engine idling" (chungus43A).
//
// Necesita ffmpeg con libopus (como scripts/assets/sonidos.mjs: si no está en
// el PATH, en Linux x64 se baja del registro de npm).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = path.join(ROOT, '.cache/sonidos/motor');
const TOOLS = path.join(ROOT, '.cache/sonidos/herramientas');
const OUT = path.join(ROOT, 'public/sounds/motor');
const SR = 48000;

/** Vista previa HQ (Ogg Vorbis) de un sonido de Freesound. */
const FS = (id, user) => `https://cdn.freesound.org/previews/${String(id).slice(0, -3)}/${id}_${user}-hq.ogg`;

export const FUENTES = {
  motoRalenti: { url: FS(510231, 2053141), autor: 'Singular_Estudio', titulo: 'Motorcycle_Yamaha_Tenere_250CC_Enduro_Idle.wav', pagina: 'https://freesound.org/people/Singular_Estudio/sounds/510231/' },
  motoAndando: { url: FS(574325, 571436), autor: '3bagbrew', titulo: 'Jerry Honda 125 slow follow & ride off.wav', pagina: 'https://freesound.org/people/3bagbrew/sounds/574325/' },
  carro: { url: FS(748027, 16197341), autor: 'Dmitry_mansurev64', titulo: 'Sedan engine loop', pagina: 'https://freesound.org/people/Dmitry_mansurev64/sounds/748027/' },
  diesel: { url: FS(705386, 12024110), autor: 'chungus43A', titulo: 'Diesel engine idling', pagina: 'https://freesound.org/people/chungus43A/sounds/705386/' },
};

/**
 * Bancos de granos: fuente, tramo [s], rango de explosiones por segundo
 * esperado, explosiones por grano y cuántos granos guardar.
 */
const BANCOS = {
  moto_ralenti: { src: 'motoRalenti', t: [2, 24], f: [10, 20], periodos: 1, n: 36 },
  moto_carga: { src: 'motoAndando', t: [8.4, 10.9], f: [15, 26], periodos: 1, n: 36 },
  carro: { src: 'carro', t: [0.5, 16], f: [25, 45], periodos: 1, n: 48 },
  diesel: { src: 'diesel', t: [0.3, 9.4], f: [80, 115], periodos: 3, n: 40 },
};

// --------------------------------------------------------------- herramientas
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { maxBuffer: 1 << 30, ...opts });
const enPath = (bin) => spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0;

function bajar(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  console.log('descargando', url);
  run('curl', ['-sS', '-f', '-L', '--retry', '3', '-o', dest + '.part', url], { stdio: 'inherit' });
  fs.renameSync(dest + '.part', dest);
  return dest;
}

let FFMPEG = 'ffmpeg';
function herramientas() {
  if (enPath('ffmpeg')) return;
  const local = path.join(TOOLS, 'ffmpeg/package/ffmpeg');
  if (fs.existsSync(local)) {
    FFMPEG = local;
    return;
  }
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Falta ffmpeg (con libopus) en el PATH');
  const tgz = bajar('https://registry.npmjs.org/@ffmpeg-installer/linux-x64/-/linux-x64-4.1.0.tgz', path.join(TOOLS, 'ffmpeg.tgz'));
  fs.mkdirSync(path.join(TOOLS, 'ffmpeg'), { recursive: true });
  run('tar', ['xzf', tgz, '-C', path.join(TOOLS, 'ffmpeg')]);
  FFMPEG = local;
  fs.chmodSync(FFMPEG, 0o755);
}

/** Float32 mono 48 kHz, con pasa-altos para quitar el retumbo del micrófono. */
function decodificar(file) {
  const buf = run(FFMPEG, ['-v', 'error', '-i', file, '-ac', '1', '-af', 'highpass=f=28:poles=2', '-ar', String(SR), '-f', 'f32le', '-']);
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
}

// --------------------------------------------------------------- análisis
/** Envolvente (valor absoluto con pasa-bajos de un polo a `fc` Hz). */
function envolvente(x, fc) {
  const e = new Float32Array(x.length);
  const k = 1 - Math.exp((-2 * Math.PI * fc) / SR);
  let a = 0;
  for (let i = 0; i < x.length; i++) {
    a += (Math.abs(x[i]) - a) * k;
    e[i] = a;
  }
  return e;
}

/** Periodo (muestras) más probable en el rango de frecuencias [fmin, fmax]. */
function periodo(env, fmin, fmax) {
  const ds = 16;
  const n = Math.floor(env.length / ds);
  const e = new Float32Array(n);
  let m = 0;
  for (let i = 0; i < n; i++) m += e[i] = env[i * ds];
  m /= n;
  for (let i = 0; i < n; i++) e[i] -= m;
  let best = -1;
  let lag0 = 0;
  for (let lag = Math.floor(SR / ds / fmax); lag <= Math.ceil(SR / ds / fmin); lag++) {
    let c = 0;
    for (let i = 0; i + lag < n; i++) c += e[i] * e[i + lag];
    c /= n - lag;
    if (c > best) {
      best = c;
      lag0 = lag;
    }
  }
  // Refina a resolución de muestra alrededor del máximo.
  let T = lag0 * ds;
  let bc = -Infinity;
  for (let lag = T - ds; lag <= T + ds; lag++) {
    let c = 0;
    for (let i = 0; i + lag < env.length; i += 4) c += (env[i] - m) * (env[i + lag] - m);
    if (c > bc) {
      bc = c;
      T = lag;
    }
  }
  return T;
}

/** Pulsos: máximos de la envolvente separados por ~T (se sigue el ritmo). */
function pulsos(env, T) {
  const out = [];
  let p = 0;
  let best = 0;
  for (let i = 0; i < T; i++) if (env[i] > best) ((best = env[i]), (p = i));
  out.push(p);
  for (;;) {
    const a = p + Math.round(T * 0.7);
    const b = p + Math.round(T * 1.3);
    if (b >= env.length) break;
    let q = a;
    for (let i = a; i < b; i++) if (env[i] > env[q]) q = i;
    out.push(q);
    p = q;
  }
  return out;
}

const rms = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / Math.max(1, x.length));
const mediana = (a) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];

function banco(nombre, cfg, audio) {
  const x = audio.subarray(Math.floor(cfg.t[0] * SR), Math.floor(cfg.t[1] * SR));
  const fc = cfg.f[1] * 3;
  const env = envolvente(x, fc);
  const T = periodo(env, cfg.f[0], cfg.f[1]);
  const ps = pulsos(env, T);
  const pre = Math.round(T * 0.2);
  let granos = [];
  for (let i = 0; i + cfg.periodos < ps.length; i++) {
    const a = ps[i] - pre;
    const b = ps[i + cfg.periodos] - pre;
    if (a < 0) continue;
    granos.push(x.slice(a, b));
  }
  // Fuera los granos de duración o nivel raros (un bache, una voz, un golpe).
  const L = mediana(granos.map((g) => g.length));
  const R = mediana(granos.map(rms));
  granos = granos.filter((g) => g.length > L * 0.82 && g.length < L * 1.2 && rms(g) > R * 0.6 && rms(g) < R * 1.6);
  // Repartidos a lo largo del tramo (más variedad que los primeros N).
  const paso = Math.max(1, granos.length / cfg.n);
  const elegidos = [];
  for (let k = 0; k < cfg.n && Math.floor(k * paso) < granos.length; k++) elegidos.push(granos[Math.floor(k * paso)]);
  // Nivel: la mediana del banco a -16 dBFS (RMS); se conserva la variación natural.
  const g0 = 10 ** (-16 / 20) / mediana(elegidos.map(rms));
  const fade = Math.round(0.0015 * SR);
  for (const g of elegidos) {
    for (let i = 0; i < g.length; i++) g[i] *= g0;
    for (let i = 0; i < fade; i++) {
      const w = 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
      g[i] *= w;
      g[g.length - 1 - i] *= w;
    }
  }
  const f = (SR / T).toFixed(1);
  console.log(`${nombre}: ${f} explosiones/s, ${ps.length} pulsos, ${granos.length} granos válidos, ${elegidos.length} guardados de ${(L / SR * 1000).toFixed(0)} ms`);
  return { granos: elegidos, periodo: T / cfg.periodos / SR, periodos: cfg.periodos };
}

async function main() {
  herramientas();
  fs.mkdirSync(OUT, { recursive: true });
  const audio = {};
  for (const [k, f] of Object.entries(FUENTES)) audio[k] = decodificar(bajar(f.url, path.join(CACHE, `${k}.ogg`)));
  const gap = Math.round(0.02 * SR);
  const partes = [];
  let pos = gap;
  const manifest = { sr: SR, archivo: 'motor.ogg', bancos: {} };
  for (const [nombre, cfg] of Object.entries(BANCOS)) {
    const b = banco(nombre, cfg, audio[cfg.src]);
    const lista = [];
    for (const g of b.granos) {
      lista.push([pos, g.length]);
      partes.push(g, new Float32Array(gap));
      pos += g.length + gap;
    }
    // `periodo`: segundos entre explosiones en la grabación (el ritmo natural del grano).
    manifest.bancos[nombre] = { periodo: +b.periodo.toFixed(5), explosiones: b.periodos, granos: lista };
  }
  const total = new Float32Array(pos + gap);
  let o = gap;
  for (const p of partes) {
    total.set(p, o);
    o += p.length;
  }
  const out = path.join(OUT, 'motor.ogg');
  run(FFMPEG, ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', '-', '-c:a', 'libopus', '-b:a', '72k', '-application', 'audio', out], { input: Buffer.from(total.buffer) });
  fs.writeFileSync(path.join(OUT, 'motor.json'), JSON.stringify(manifest));
  console.log('motor.ogg', (fs.statSync(out).size / 1024).toFixed(0), 'KB,', (total.length / SR).toFixed(1), 's');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
