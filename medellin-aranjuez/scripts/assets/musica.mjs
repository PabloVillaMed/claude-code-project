// Baja, recorta, normaliza y exporta la música de las emisoras de radio
// (public/sounds/musica/<emisora>/<pista>.ogg, Opus estéreo 48 kHz) y escribe
// public/sounds/musica/manifest.json con la duración de cada pista.
// Reproducible: `node scripts/assets/musica.mjs [--force]` (caché en
// .cache/musica/; --creditos imprime la tabla para ASSETS-CREDITS.md).
//
// Las pistas, sus autores, páginas y licencias están en
// src/game/radioStations.js (solo CC0 / CC BY; ver el comentario de ese
// archivo y ASSETS-CREDITS.md).
//
// Proceso por pista: decodificar con ffmpeg; recortar a MAX_SEG con fundido
// de salida (edición "de radio", para que el total pese poco); normalizar la
// sonoridad en dos pasadas (loudnorm EBU R128, -16 LUFS integrados, pico
// verdadero -1.5 dBTP, en modo lineal para no aplastar la dinámica) y
// codificar en Opus (64 kb/s, 48 en la emisora lo-fi).
//
// Necesita ffmpeg con libopus; si no está en el PATH, en Linux x64 lo baja del
// registro de npm (@ffmpeg-installer/linux-x64) a .cache/musica/herramientas.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EMISORAS, LICENCIAS_OK, rutaPista } from '../../src/game/radioStations.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = path.join(ROOT, '.cache/musica');
const TOOLS = path.join(CACHE, 'herramientas');
const OUT = path.join(ROOT, 'public/sounds/musica');
const MAX_SEG = 200; // 3:20; más largo se corta con fundido
const FUNDIDO = 6;
const LUFS = -16;
const TP = -1.5;
const VERSION = 1; // subirla rehace el procesado

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { maxBuffer: 1 << 30, ...opts });
const enPath = (bin) => spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0;

/** Baja un archivo; `pagina` va como Referer (ccMixter no sirve descargas sin él). */
function bajar(url, dest, pagina = null) {
  if (fs.existsSync(dest)) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  console.log('descargando', url);
  run('curl', ['-sS', '-f', '-L', '--retry', '3', ...(pagina ? ['-e', pagina] : []), '-o', dest + '.part', url], { stdio: 'inherit' });
  fs.renameSync(dest + '.part', dest);
  return dest;
}

let FFMPEG = 'ffmpeg';
function herramientas() {
  if (process.env.FFMPEG) return void (FFMPEG = process.env.FFMPEG);
  if (enPath('ffmpeg')) return;
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Falta ffmpeg (con libopus) en el PATH');
  const dest = path.join(TOOLS, 'ffmpeg');
  if (!fs.existsSync(dest)) {
    const tgz = bajar('https://registry.npmjs.org/@ffmpeg-installer/linux-x64/-/linux-x64-4.1.0.tgz', path.join(TOOLS, 'ffmpeg.tgz'));
    fs.mkdirSync(dest, { recursive: true });
    run('tar', ['xzf', tgz, '-C', dest]);
  }
  FFMPEG = path.join(dest, 'package', 'ffmpeg');
  fs.chmodSync(FFMPEG, 0o755);
}

const duracion = (file) => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
};

/** Cadena de filtros de recorte (y fundidos) de una pista de `dur` segundos. */
function recorte(dur) {
  const fin = Math.min(dur, MAX_SEG);
  const f = [`atrim=0:${fin.toFixed(2)}`, 'asetpts=PTS-STARTPTS', 'afade=t=in:d=0.05'];
  if (dur > MAX_SEG + 1) f.push(`afade=t=out:st=${(fin - FUNDIDO).toFixed(2)}:d=${FUNDIDO}`);
  return f;
}

function procesar(em, p, force) {
  if (!LICENCIAS_OK.includes(p.licencia)) throw new Error(`Licencia no aceptada en ${p.id}: ${p.licencia}`);
  const src = bajar(p.descarga, path.join(CACHE, 'src', `${p.id}${path.extname(new URL(p.descarga).pathname) || '.mp3'}`), p.fuente);
  const dest = path.join(ROOT, 'public', rutaPista(em, p));
  const stamp = `${VERSION}:${em.kbps ?? 64}:${MAX_SEG}`;
  const stampFile = path.join(CACHE, 'stamps', `${em.id}-${p.id}`);
  if (!force && fs.existsSync(dest) && fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8') === stamp) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const base = recorte(duracion(src));
  // Primera pasada: medir.
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', src, '-af', [...base, `loudnorm=I=${LUFS}:TP=${TP}:LRA=11:print_format=json`].join(','), '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const json = r.stderr.slice(r.stderr.lastIndexOf('{'), r.stderr.lastIndexOf('}') + 1);
  const m = JSON.parse(json);
  // Segunda pasada: aplicar (lineal) y codificar.
  const ln = `loudnorm=I=${LUFS}:TP=${TP}:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  run(FFMPEG, ['-v', 'error', '-y', '-i', src, '-af', [...base, ln, 'aresample=48000'].join(','), '-ac', '2', '-c:a', 'libopus', '-b:a', `${em.kbps ?? 64}k`, '-vbr', 'on', '-compression_level', '10', '-application', 'audio', '-map_metadata', '-1', '-metadata', `title=${p.titulo}`, '-metadata', `artist=${p.artista}`, '-metadata', `copyright=${p.licencia} ${p.licenciaUrl}`, dest]);
  fs.mkdirSync(path.dirname(stampFile), { recursive: true });
  fs.writeFileSync(stampFile, stamp);
  console.log(`${em.id}/${p.id}: ${m.input_i} LUFS -> ${LUFS}, ${(fs.statSync(dest).size / 1048576).toFixed(2)} MB`);
  return dest;
}

function tablaCreditos() {
  const filas = ['| Recurso | Ruta en el proyecto | Fuente | Autor | Licencia |', '|---|---|---|---|---|'];
  for (const em of EMISORAS)
    for (const p of em.pistas) {
      const usa = (p.usa ?? []).map((u) => `"${u.titulo}" de ${u.autor} ([${u.url.replace(/^https?:\/\//, '')}](${u.url}), ${u.licencia})`);
      const autor = p.artista + (usa.length ? `; remezcla que usa ${usa.join(' y ')}` : '');
      filas.push(`| Música: "${p.titulo}" (${em.nombre} ${em.frecuencia}) | \`public/${rutaPista(em, p)}\` | [${p.fuente.replace(/^https?:\/\//, '')}](${p.fuente}) | ${autor} | [${p.licencia}](${p.licenciaUrl}) |`);
    }
  return filas.join('\n');
}

// --------------------------------------------------------------- main
const args = process.argv.slice(2);
if (args.includes('--creditos')) {
  console.log(tablaCreditos());
  process.exit(0);
}
herramientas();
const manifest = { version: VERSION, lufs: LUFS, emisoras: {} };
let total = 0;
for (const em of EMISORAS) {
  const pistas = {};
  for (const p of em.pistas) {
    const dest = procesar(em, p, args.includes('--force'));
    total += fs.statSync(dest).size;
    pistas[p.id] = { dur: Math.round(duracion(dest) * 10) / 10, bytes: fs.statSync(dest).size };
  }
  manifest.emisoras[em.id] = pistas;
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log(`total: ${(total / 1048576).toFixed(1)} MB`);
