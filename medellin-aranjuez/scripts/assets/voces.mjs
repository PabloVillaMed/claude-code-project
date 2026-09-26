// Genera las voces de los diálogos callejeros con Chatterbox Multilingual
// (Resemble AI, MIT; TTS neuronal local, sin servicios en la nube), clonando
// voces reales de hablantes colombianos del corpus OpenSLR 72 (CC BY-SA 4.0).
// Reproducible: `node scripts/assets/voces.mjs`
// (opciones: --force rehace todo; --only=saludo,charla solo esas categorías).
//
// Texto: src/game/dialogueLines.js (el mismo módulo que usa el juego para los
// subtítulos). Reparto: CAST (qué hablante de OpenSLR 72 hace cada voz y con
// qué grabaciones de referencia) y STYLE (expresividad por categoría); ver
// ASSETS-CREDITS.md. Caché (gitignored): .cache/voces/ (entorno de Python con
// chatterbox-tts y torch CPU, pesos del modelo en hf/, clips de OpenSLR 72,
// referencias y WAV crudos). Salida: public/sounds/voces/<línea>-<voz>.ogg
// (Opus mono 24 kHz) + manifest.json con la duración de cada archivo.
//
// Cadena por archivo: Chatterbox (referencia de la voz, exageración/cfg por
// categoría, semilla fija por archivo) -> ffmpeg (paso alto; filtro de radio
// en r1/r2) -> recorte de silencios y nivel en Node -> ffmpeg libopus.
//
// En CPU tarda unos 15-20 s por archivo (≈ 2,5 h el juego completo); lo ya
// sintetizado queda en caché y se retoma donde iba.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { LINES, VOICES } from '../../src/game/dialogueLines.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const CACHE = path.join(ROOT, '.cache/voces');
const OUT = path.join(ROOT, 'public/sounds/voces');
const SLR72 = 'https://www.openslr.org/resources/72';
const CHATTERBOX_VERSION = '0.1.7';
const TORCH_VERSION = '2.6.0';
const VERSION = 5; // subirla rehace el procesado (no la síntesis)
const RATE = 24000; // la salida de Chatterbox (y Opus la acepta tal cual)
const BITRATE = '24k';

/**
 * Reparto: cada voz del juego clona a un hablante de OpenSLR 72 ("Crowdsourced
 * high-quality Colombian Spanish", Google, CC BY-SA 4.0). `clips` son las
 * grabaciones (id del corpus) que se unen como referencia (~10 s).
 */
export const CAST = {
  h1: { speaker: 'com_07049', clips: ['com_07049_01019616663', 'com_07049_00068295615'] }, // señor mayor (voz grave)
  h2: { speaker: 'com_08784', clips: ['com_08784_01015146666', 'com_08784_01932426206'] }, // pelado
  h3: { speaker: 'com_09334', clips: ['com_09334_01593244709', 'com_09334_01559014467'] }, // señor
  m1: { speaker: 'cof_03034', clips: ['cof_03034_00543032345', 'cof_03034_01505095988'] }, // señora mayor
  m2: { speaker: 'cof_07049', clips: ['cof_07049_01908458477', 'cof_07049_01495383977'] }, // muchacha
  m3: { speaker: 'cof_00610', clips: ['cof_00610_00211979024', 'cof_00610_00100787111', 'cof_00610_01482178433'] }, // señora
  p1: { speaker: 'com_03397', clips: ['com_03397_00495289763', 'com_03397_01461129427'] }, // policía
  p2: { speaker: 'com_06136', clips: ['com_06136_02095498422', 'com_06136_01897189612'] }, // policía
  r1: { speaker: 'cof_07508', clips: ['cof_07508_00105321934', 'cof_07508_00299917657'] }, // central (radio)
  r2: { speaker: 'com_08421', clips: ['com_08421_01824082729', 'com_08421_00719460158'] }, // patrulla (radio)
};

/**
 * Estilo por categoría: exag = exageración emocional de Chatterbox (0.5 normal),
 * cfg = peso de la guía (más bajo = más suelto y rápido, mejor para gritos),
 * level = nivel en dB sobre la charla normal.
 */
const STYLE = {
  saludo: { exag: 0.55, cfg: 0.5, level: 0 },
  comentario: { exag: 0.45, cfg: 0.5, level: -2 },
  charla: { exag: 0.5, cfg: 0.5, level: 0 },
  pregon: { exag: 0.75, cfg: 0.35, level: 3 },
  empujon: { exag: 0.75, cfg: 0.35, level: 3 },
  carro: { exag: 0.8, cfg: 0.3, level: 4 },
  disparos: { exag: 0.85, cfg: 0.3, level: 5 },
  apuntado: { exag: 0.8, cfg: 0.3, level: 3 },
  muerte: { exag: 0.8, cfg: 0.35, level: 4 },
  golpe: { exag: 0.85, cfg: 0.3, level: 4 },
  policia: { exag: 0.7, cfg: 0.35, level: 5 },
  radio: { exag: 0.45, cfg: 0.5, level: 0 },
};
const styleFor = (cat) => STYLE[cat] ?? STYLE[cat.split('_')[0]] ?? STYLE.charla;
const TEMPERATURE = 0.8;

/**
 * Otra semilla para archivos que salieron mal en la primera pasada (revisados
 * con ASR faster-whisper: palabra comida, final cortado, pausa rara…):
 * nombre -> semilla.
 */
const RESEED = {
  'carro-01-h1': 2,
  'carro-02-h2': 2,
  'charla-06-1-h3': 2,
  'charla-06-1-m3': 2,
  'empujon-07-m1': 3,
  'golpe-04-m3': 2,
  'policia_arma-02-p2': 2,
  'policia_arma-03-p1': 2,
  'pregon-arepas-04-m3': 2,
  'pregon-mangos-02-m2': 3,
  'radio_patrulla-01-r2': 2,
};

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const ONLY = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
const rel = (p) => path.relative(ROOT, p);

function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.slice(0, 6).join(' ')}…\n${r.stderr || r.stdout || r.error}`);
  return r.stdout;
}

// ------------------------------------------------------------ entorno
const pyEnv = () => ({ ...process.env, HF_HOME: path.join(CACHE, 'hf'), TOKENIZERS_PARALLELISM: 'false' });

function setupPython() {
  const venv = path.join(CACHE, 'venv-chatterbox');
  const py = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(py)) {
    console.log('Creando entorno de Python en', rel(venv));
    run(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'venv', venv]);
  }
  const ok = spawnSync(py, ['-c', 'import chatterbox, imageio_ffmpeg'], { encoding: 'utf8' }).status === 0;
  if (!ok) {
    console.log(`Instalando torch ${TORCH_VERSION} (CPU), chatterbox-tts ${CHATTERBOX_VERSION} e imageio-ffmpeg…`);
    const pip = (a) => run(py, ['-m', 'pip', 'install', '-q', ...a], { stdio: 'inherit' });
    // torch de CPU primero: evita bajar los ~3 GB de CUDA.
    pip([`torch==${TORCH_VERSION}`, `torchaudio==${TORCH_VERSION}`, '--index-url', 'https://download.pytorch.org/whl/cpu']);
    pip([`chatterbox-tts==${CHATTERBOX_VERSION}`, 'imageio-ffmpeg']);
  }
  return py;
}

function findFfmpeg(py) {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  // El ffmpeg estático de imageio-ffmpeg trae libopus.
  return run(py, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())']).trim();
}

function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return;
  console.log('Descargando', url);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // curl respeta HTTPS_PROXY y el almacén de certificados del sistema.
  run('curl', ['-sSL', '--fail', '--retry', '3', '-o', `${file}.part`, url], { stdio: ['ignore', 'ignore', 'inherit'] });
  fs.renameSync(`${file}.part`, file);
}

/**
 * Clips de referencia de OpenSLR 72: baja cada zip (~800 MB) solo si falta
 * algún clip, extrae los necesarios y borra el zip.
 */
function slr72Clips() {
  const dir = path.join(CACHE, 'slr72');
  download(`${SLR72}/LICENSE`, path.join(dir, 'LICENSE'));
  const clips = {};
  for (const c of Object.values(CAST)) for (const id of c.clips) clips[id] = path.join(dir, 'clips', `${id}.wav`);
  for (const g of ['female', 'male']) {
    const pre = g === 'female' ? 'cof_' : 'com_';
    const missing = Object.keys(clips).filter((id) => id.startsWith(pre) && !fs.existsSync(clips[id]));
    if (!missing.length) continue;
    const zip = path.join(dir, `es_co_${g}.zip`);
    download(`${SLR72}/es_co_${g}.zip`, zip);
    download(`${SLR72}/line_index_${g}.tsv`, path.join(dir, `line_index_${g}.tsv`));
    run('unzip', ['-q', '-o', '-j', zip, ...missing.map((id) => `${id}.wav`), '-d', path.join(dir, 'clips')]);
    fs.rmSync(zip);
  }
  return clips;
}

/** Referencia de cada voz: los clips recortados y unidos (máx. 10 s). */
function buildRefs(py, clips) {
  const spec = {};
  for (const [vid, c] of Object.entries(CAST)) {
    const out = path.join(CACHE, 'refs', `${vid}-${sha(JSON.stringify(c.clips))}.wav`);
    c.ref = out;
    if (!fs.existsSync(out)) spec[vid] = { clips: c.clips.map((id) => clips[id]), out };
  }
  if (!Object.keys(spec).length) return;
  const file = path.join(CACHE, 'refs.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  run(py, [path.join(ROOT, 'scripts/assets/voces_chatterbox.py'), 'refs', file], { env: pyEnv() });
}

/** Ajustes de texto para el TTS (la pronunciación, no el subtítulo). */
function ttsText(t) {
  return t
    .replace(/\bpa'l\b/gi, 'pal')
    .replace(/\bpa'/gi, 'pa')
    .replace(/…/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

// ------------------------------------------------------------ WAV
function readWav(file) {
  const b = fs.readFileSync(file);
  let o = 12;
  let fmt = null;
  while (o < b.length - 8) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') {
      const n = Math.floor(size / 2);
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = b.readInt16LE(o + 8 + i * 2) / 32768;
      return { rate: fmt.rate, x };
    }
    o += 8 + size + (size & 1);
  }
  throw new Error(`WAV inválido: ${file}`);
}

/** Recorta silencios, nivela (RMS de lo hablado) y limita el pico. */
function shape(x, rate, levelDb) {
  const win = Math.round(rate * 0.01);
  const frames = [];
  for (let i = 0; i + win <= x.length; i += win) {
    let s = 0;
    for (let k = 0; k < win; k++) s += x[i + k] * x[i + k];
    frames.push(Math.sqrt(s / win));
  }
  const top = Math.max(...frames, 1e-9);
  const thr = top * 0.03; // -30 dB bajo el tramo más fuerte
  let a = frames.findIndex((r) => r > thr);
  let b = frames.length - 1 - [...frames].reverse().findIndex((r) => r > thr);
  if (a < 0) return null;
  // ¿El TTS cortó una palabra? (mucha energía justo al final del crudo)
  const tailCut = frames[frames.length - 1] > top * 0.25;
  const start = Math.max(0, (a - 3) * win);
  const end = Math.min(x.length, (b + 9) * win); // 90 ms de cola (la voz decae)
  // Pausas internas largas (el modelo a veces se queda "pensando"): se dejan
  // en 0,3 s, cortando en el silencio con un fundido corto.
  const keep = [];
  let from = start;
  for (let i = a, run = 0; i <= b + 1; i++) {
    if (i <= b && frames[i] <= thr) run++;
    else {
      if (run > 40) {
        keep.push([from, (i - run + 15) * win]);
        from = (i - 15) * win;
      }
      run = 0;
    }
  }
  keep.push([from, end]);
  const xf = Math.round(rate * 0.005);
  const segs = keep.map(([p, q]) => x.slice(p, q));
  const y = new Float32Array(segs.reduce((s, g) => s + g.length, 0) - xf * (segs.length - 1));
  let w = 0;
  segs.forEach((g, k) => {
    if (k > 0) {
      w -= xf;
      for (let i = 0; i < xf; i++) y[w + i] = y[w + i] * (1 - i / xf) + g[i] * (i / xf);
      y.set(g.subarray(xf), w + xf);
    } else y.set(g, 0);
    w += g.length;
  });
  let e = 0;
  let n = 0;
  let peak = 0;
  for (let i = a; i <= b; i++) {
    if (frames[i] > top * 0.1) {
      e += frames[i] * frames[i];
      n++;
    }
  }
  for (const v of y) peak = Math.max(peak, Math.abs(v));
  const rms = Math.sqrt(e / Math.max(1, n));
  const targetDb = -19 + levelDb;
  let gain = 10 ** (targetDb / 20) / rms;
  const limited = peak * gain > 0.9;
  if (limited) gain = 0.9 / peak;
  const fade = Math.round(rate * 0.006);
  for (let i = 0; i < y.length; i++) {
    const f = Math.min(1, i / fade, (y.length - 1 - i) / fade);
    y[i] *= gain * f;
  }
  const pad = new Float32Array(Math.round(rate * 0.03));
  const out = new Float32Array(y.length + pad.length);
  out.set(y);
  return { y: out, seconds: out.length / rate, limited, tailCut, peakDb: 20 * Math.log10(peak * gain) };
}

function writePcm16(file, y) {
  const b = Buffer.alloc(y.length * 2);
  for (let i = 0; i < y.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(y[i] * 32767))), i * 2);
  fs.writeFileSync(file, b);
}

// ------------------------------------------------------------ principal
async function synthesize(py, jobs) {
  if (!jobs.length) return;
  const file = path.join(CACHE, 'trabajos.json');
  fs.writeFileSync(file, JSON.stringify(jobs));
  console.log(`Sintetizando ${jobs.length} audios con Chatterbox (CPU; unos 15-20 s cada uno)…`);
  const t0 = Date.now();
  await new Promise((resolve, reject) => {
    const p = spawn(py, [path.join(ROOT, 'scripts/assets/voces_chatterbox.py'), 'synth', file], {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: pyEnv(),
    });
    let done = 0;
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) {
        if (!l.startsWith('{')) continue;
        const r = JSON.parse(l);
        if (!r.ok) console.warn(`  revisar: ${rel(r.out)} (${r.seconds} s)`);
        if (++done % 10 === 0) {
          const left = ((Date.now() - t0) / done) * (jobs.length - done);
          console.log(`  ${done}/${jobs.length} (faltan ~${Math.round(left / 60000)} min)`);
        }
      }
    });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Chatterbox terminó con código ${code}`))));
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const py = setupPython();
  const ffmpeg = findFfmpeg(py);
  buildRefs(py, slr72Clips());

  // 1) Qué hay que producir.
  const items = [];
  for (const line of LINES) {
    if (ONLY && !ONLY.includes(line.cat)) continue;
    const st = styleFor(line.cat);
    for (const vid of line.voices) {
      const v = VOICES[vid];
      const name = `${line.id}-${vid}`;
      const syn = {
        engine: `chatterbox-tts ${CHATTERBOX_VERSION}`,
        clips: CAST[vid].clips,
        text: ttsText(line.tts ?? line.text),
        exaggeration: st.exag,
        cfg: st.cfg,
        temperature: TEMPERATURE,
        // Semilla fija por archivo (reproducible, pero distinta en cada uno).
        seed: RESEED[name] ?? parseInt(sha(name).slice(0, 7), 16),
      };
      const rawKey = sha(JSON.stringify(syn));
      const filters = ['highpass=f=70'];
      if (v.radio) filters.push('highpass=f=420', 'lowpass=f=2900', 'acompressor=threshold=0.1:ratio=6:attack=3:release=80:makeup=2', 'asoftclip=type=tanh');
      filters.push(`aresample=${RATE}`);
      const procKey = sha(JSON.stringify([rawKey, filters, st.level, BITRATE, VERSION]));
      const out = path.join(CACHE, 'raw', `${rawKey}.wav`);
      items.push({ name, line, vid, syn: { ...syn, ref: CAST[vid].ref, out }, filters, level: st.level, procKey });
    }
  }

  // 2) Síntesis (solo lo que no está en caché).
  const stampsFile = path.join(CACHE, 'stamps.json');
  const stamps = fs.existsSync(stampsFile) ? JSON.parse(fs.readFileSync(stampsFile, 'utf8')) : {};
  const pending = new Map();
  for (const it of items) if ((FORCE || !fs.existsSync(it.syn.out)) && !pending.has(it.syn.out)) pending.set(it.syn.out, it.syn);
  await synthesize(py, [...pending.values()]);

  // 3) Procesado y codificación.
  const warnings = [];
  let encoded = 0;
  const tmpF32 = path.join(CACHE, 'proc.f32');
  const tmpPcm = path.join(CACHE, 'proc.pcm');
  for (const it of items) {
    const out = path.join(OUT, `${it.name}.ogg`);
    const st = stamps[it.name];
    if (!FORCE && st?.key === it.procKey && fs.existsSync(out)) continue;
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', it.syn.out, '-af', it.filters.join(','), '-ac', '1', '-f', 'f32le', tmpF32]);
    const raw = fs.readFileSync(tmpF32);
    const x = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
    const s = shape(Float32Array.from(x), RATE, it.level);
    if (!s) {
      warnings.push(`${it.name}: audio vacío`);
      continue;
    }
    writePcm16(tmpPcm, s.y);
    run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', String(RATE), '-ac', '1', '-i', tmpPcm, '-c:a', 'libopus', '-b:a', BITRATE, '-vbr', 'on', '-application', 'voip', '-frame_duration', '20', '-map_metadata', '-1', out]);
    stamps[it.name] = { key: it.procKey, seconds: +s.seconds.toFixed(3), tailCut: s.tailCut, peakDb: +s.peakDb.toFixed(1) };
    if (++encoded % 50 === 0) console.log(`  codificados ${encoded}`);
  }
  fs.writeFileSync(stampsFile, JSON.stringify(stamps, null, 1));
  fs.rmSync(tmpF32, { force: true });
  fs.rmSync(tmpPcm, { force: true });

  // 4) Limpieza de archivos que ya no corresponden a ninguna línea y manifiesto.
  const wanted = new Set();
  for (const line of LINES) for (const vid of line.voices) wanted.add(`${line.id}-${vid}`);
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.ogg') && !wanted.has(f.slice(0, -4))) fs.rmSync(path.join(OUT, f));
  const files = {};
  for (const name of [...wanted].sort()) if (stamps[name] && fs.existsSync(path.join(OUT, `${name}.ogg`))) files[name] = stamps[name].seconds;
  const manifest = { version: VERSION, engine: `chatterbox-tts ${CHATTERBOX_VERSION} (OpenSLR 72)`, codec: `opus ${BITRATE}`, files };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), `${JSON.stringify(manifest)}\n`);

  // 5) Resumen: cuántas, cuánto pesan, duraciones y posibles problemas.
  const byCat = {};
  let bytes = 0;
  const secs = [];
  for (const line of LINES) {
    const c = (byCat[line.cat] ??= { lines: 0, files: 0, seconds: 0 });
    c.lines++;
    for (const vid of line.voices) {
      const name = `${line.id}-${vid}`;
      if (!files[name]) {
        if (!ONLY || ONLY.includes(line.cat)) warnings.push(`${name}: falta`);
        continue;
      }
      c.files++;
      c.seconds += files[name];
      secs.push([files[name], name]);
      bytes += fs.statSync(path.join(OUT, `${name}.ogg`)).size;
      if (files[name] < 0.35) warnings.push(`${name}: muy corto (${files[name]} s)`);
      if (stamps[name].tailCut) warnings.push(`${name}: posible final cortado`);
    }
  }
  console.table(Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, { ...v, seconds: +v.seconds.toFixed(1) }])));
  secs.sort((a, b) => a[0] - b[0]);
  console.log(`${LINES.length} líneas, ${secs.length} archivos, ${(bytes / 1048576).toFixed(2)} MB, ${secs.reduce((s, v) => s + v[0], 0).toFixed(0)} s de audio`);
  console.log(`Más cortos: ${secs.slice(0, 3).map(([s, n]) => `${n} ${s}s`).join(', ')} · más largos: ${secs.slice(-3).map(([s, n]) => `${n} ${s}s`).join(', ')}`);
  if (warnings.length) console.warn(`Avisos (${warnings.length}):\n  ${warnings.join('\n  ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
