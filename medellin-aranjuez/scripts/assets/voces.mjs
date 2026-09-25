// Genera las voces de los diálogos callejeros con Piper TTS (neuronal, local,
// sin servicios en la nube). Reproducible: `node scripts/assets/voces.mjs`
// (opciones: --force rehace todo; --only=saludo,charla solo esas categorías).
//
// Texto: src/game/dialogueLines.js (el mismo módulo que usa el juego para los
// subtítulos). Voces: modelos de rhasspy/piper-voices (ver VOICES y
// ASSETS-CREDITS.md). Caché (gitignored): .cache/voces/ (entorno de Python con
// piper-tts, modelos .onnx, WAV crudos y procesados). Salida:
// public/sounds/voces/<línea>-<voz>.ogg (Opus mono) + manifest.json con la
// duración de cada archivo.
//
// Cadena por archivo: Piper (velocidad por voz y categoría, fonetización
// 'es-419' = seseo) -> ffmpeg (tono con rubberband, ecualización, filtro de
// radio) -> recorte de silencios y nivel en Node -> ffmpeg libopus.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { LINES, VOICES } from '../../src/game/dialogueLines.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const CACHE = path.join(ROOT, '.cache/voces');
const OUT = path.join(ROOT, 'public/sounds/voces');
const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';
const PIPER_VERSION = '1.8.0';
const VERSION = 3; // subirla rehace el procesado (no la síntesis)
const RATE = 24000; // Opus acepta 24 kHz tal cual
const BITRATE = '20k';

/** Modelos de Piper usados (ruta dentro de rhasspy/piper-voices). */
export const MODELS = {
  'es_MX-claude-high': 'es/es_MX/claude/high',
  'es_MX-ald-medium': 'es/es_MX/ald/medium',
  'es_ES-davefx-medium': 'es/es_ES/davefx/medium',
  'es_ES-sharvard-medium': 'es/es_ES/sharvard/medium',
};

/** Estilo por categoría: velocidad relativa y nivel (dB sobre la charla normal). */
const STYLE = {
  saludo: { speed: 1, level: 0 },
  comentario: { speed: 0.97, level: -2 },
  charla: { speed: 1, level: 0 },
  pregon: { speed: 0.94, level: 3 },
  empujon: { speed: 1.1, level: 3 },
  carro: { speed: 1.12, level: 4 },
  disparos: { speed: 1.16, level: 5 },
  apuntado: { speed: 1.14, level: 3 },
  muerte: { speed: 1.04, level: 4 },
  golpe: { speed: 1.12, level: 4 },
  policia: { speed: 1.06, level: 5 },
  radio: { speed: 1.04, level: 0 },
};
const styleFor = (cat) => STYLE[cat] ?? STYLE[cat.split('_')[0]] ?? STYLE.charla;

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
function setupPython() {
  const venv = path.join(CACHE, 'venv');
  const py = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(py)) {
    console.log('Creando entorno de Python en', rel(venv));
    run(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'venv', venv]);
  }
  const ok = spawnSync(py, ['-c', 'import piper, imageio_ffmpeg'], { encoding: 'utf8' }).status === 0;
  if (!ok) {
    console.log(`Instalando piper-tts ${PIPER_VERSION} e imageio-ffmpeg…`);
    run(py, ['-m', 'pip', 'install', '-q', `piper-tts==${PIPER_VERSION}`, 'imageio-ffmpeg'], { stdio: 'inherit' });
  }
  return py;
}

function findFfmpeg(py) {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  // El ffmpeg estático de imageio-ffmpeg trae libopus y rubberband.
  return run(py, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())']).trim();
}

function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return;
  console.log('Descargando', url);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // curl respeta HTTPS_PROXY y el almacén de certificados del sistema.
  run('curl', ['-sSL', '--fail', '--retry', '3', '-o', `${file}.part`, url]);
  fs.renameSync(`${file}.part`, file);
}

function modelPath(model) {
  const base = `${HF}/${MODELS[model]}`;
  const dir = path.join(CACHE, 'models');
  const onnx = path.join(dir, `${model}.onnx`);
  download(`${base}/${model}.onnx`, onnx);
  download(`${base}/${model}.onnx.json`, `${onnx}.json`);
  download(`${base}/MODEL_CARD`, path.join(dir, `${model}.MODEL_CARD.md`));
  return onnx;
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
  const y = x.slice(start, end);
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
  console.log(`Sintetizando ${jobs.length} audios con Piper…`);
  await new Promise((resolve, reject) => {
    const p = spawn(py, [path.join(ROOT, 'scripts/assets/voces_piper.py'), file], { stdio: ['ignore', 'pipe', 'inherit'] });
    let done = 0;
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) if (l.startsWith('{') && ++done % 25 === 0) console.log(`  ${done}/${jobs.length}`);
    });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Piper terminó con código ${code}`))));
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const py = setupPython();
  const ffmpeg = findFfmpeg(py);
  const models = {};
  for (const m of new Set(Object.values(VOICES).map((v) => v.model))) models[m] = modelPath(m);

  // 1) Qué hay que producir.
  const items = [];
  for (const line of LINES) {
    if (ONLY && !ONLY.includes(line.cat)) continue;
    const st = styleFor(line.cat);
    for (const vid of line.voices) {
      const v = VOICES[vid];
      const syn = {
        model: v.model,
        speaker: v.speaker ?? null,
        espeak: v.espeak ?? null,
        lengthScale: +(1 / (v.speed * st.speed)).toFixed(3),
        noiseScale: 0.667,
        noiseW: 0.8,
        gap: 0.14,
        text: ttsText(line.tts ?? line.text),
      };
      const rawKey = sha(JSON.stringify(syn));
      const filters = ['highpass=f=70'];
      if (v.pitch) filters.push(`rubberband=pitch=${(2 ** (v.pitch / 12)).toFixed(5)}:pitchq=quality`);
      if (v.old) filters.push('lowpass=f=7200', 'equalizer=f=180:t=q:w=1:g=2');
      if (v.radio) filters.push('highpass=f=420', 'lowpass=f=2900', 'acompressor=threshold=0.1:ratio=6:attack=3:release=80:makeup=2', 'asoftclip=type=tanh');
      filters.push(`aresample=${RATE}`);
      const name = `${line.id}-${vid}`;
      const procKey = sha(JSON.stringify([rawKey, filters, st.level, BITRATE, VERSION]));
      items.push({ name, line, vid, syn: { ...syn, modelPath: models[v.model], out: path.join(CACHE, 'raw', `${rawKey}.wav`) }, filters, level: st.level, procKey });
    }
  }

  // 2) Síntesis (solo lo que no está en caché).
  // (también lo que la vez anterior salió con el final cortado: se reintenta)
  const stampsFile = path.join(CACHE, 'stamps.json');
  const stamps = fs.existsSync(stampsFile) ? JSON.parse(fs.readFileSync(stampsFile, 'utf8')) : {};
  const pending = new Map();
  for (const it of items) {
    const retry = stamps[it.name]?.tailCut;
    if (retry) delete stamps[it.name];
    if ((FORCE || retry || !fs.existsSync(it.syn.out)) && !pending.has(it.syn.out)) pending.set(it.syn.out, it.syn);
  }
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
  const manifest = { version: VERSION, engine: `piper-tts ${PIPER_VERSION}`, codec: `opus ${BITRATE}`, files };
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
