// Descarga, recorta, normaliza y exporta los sonidos de las armas
// (public/sounds/armas/*.ogg, Opus mono 48 kHz).
// Reproducible: `node scripts/assets/sonidos.mjs [nombre ...] [--png carpeta]`
// (usa caché en .cache/sonidos/; --png dibuja forma de onda + espectrograma
// de cada sonido final y una hoja de contacto, para revisarlos a ojo).
//
// Fuentes (todas CC0, ver ASSETS-CREDITS.md):
//  - disparos: The Free Firearm Sound Library (Ben Jaszczak, Brian Nelson,
//    Kevin Heras y Matthew Nanney), grabaciones reales al aire libre, vía
//    OpenGameArt. Cada archivo trae 2-3 disparos del arma a distancia
//    "cercana" y otro a distancia "media" (con más eco), que usamos como
//    versión lejana. Equivalencias con los modelos del juego (mismo calibre y
//    mecanismo): Beretta 92 (9 mm) ← Walther PPQ 9 mm; HK MP5 (9 mm) ←
//    Carl Gustav M45 9 mm; Remington 870 ← Benelli Nova y Charles Daly
//    (escopetas de bomba calibre 12); M4A1 (5,56) ← AR-15 5,56.
//  - recargas, bomba de la escopeta, cartuchos, golpes, impactos y
//    silbidos: paquetes CC0 de OpenGameArt y sonidos CC0 de Freesound (se
//    usa la vista previa HQ pública, que no pide sesión; la licencia CC0 del
//    sonido cubre cualquier copia).
//
// Proceso por sonido: decodificar con ffmpeg a 48 kHz (un canal: los pares
// estéreo espaciados se cancelan al mezclarlos), filtro pasa-altos, ubicar el
// transitorio (el recorte arranca 2 ms antes), recortar, fundido de salida en
// coseno hasta el silencio, normalizar el pico a -1 dBFS y codificar en Opus.
//
// Necesita ffmpeg (con libopus) y 7-Zip. Si no están en el PATH, en Linux x64
// los baja del registro de npm (@ffmpeg-installer/linux-x64 y 7zip-bin) a
// .cache/sonidos/herramientas.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = path.join(ROOT, '.cache/sonidos');
const TOOLS = path.join(CACHE, 'herramientas');
const OUT = path.join(ROOT, 'public/sounds/armas');
const SR = 48000;

// --------------------------------------------------------------- fuentes
const OGA = 'https://opengameart.org/sites/default/files/';
/** Vista previa HQ (Ogg Vorbis ~190 kb/s) de un sonido de Freesound. */
const FS = (id, user) => `https://cdn.freesound.org/previews/${String(id).slice(0, -3)}/${id}_${user}-hq.ogg`;

/**
 * Archivos que se bajan tal cual o comprimidos. De los comprimidos solo se
 * extraen (a .cache/sonidos/<extraer>/) los archivos que se usan.
 */
const DESCARGAS = {
  ffsl: { url: OGA + 'Prepared%20SFX%20Library.7z', file: 'ffsl.7z', extraer: 'ffsl' }, // 194 MB
  zer0solPistola: { url: OGA + 'reload.wav', file: 'src/zer0sol_reload.wav' },
  zer0solEscopeta: { url: OGA + 'shotgunsounds.zip', file: 'src/shotgunsounds.zip', extraer: 'src/zer0sol_shotgun' },
  swishes: { url: OGA + 'swishes.zip', file: 'src/swishes.zip', extraer: 'src/swishes' },
  inuHumedos: { url: OGA + 'independent_nu_ljudbank-wet_squish_slurp_impacts.7z', file: 'src/inu_wet.7z', extraer: 'src/inu_wet' },
};
const fsSrc = (id, user) => ({ url: FS(id, user), file: `src/fs_${id}.ogg` });
Object.assign(DESCARGAS, {
  ar15Manejo: fsSrc(263513, 4675419), // wadaltmon: AR-15, cargador y manija de carga
  fusilRecarga: fsSrc(815879, 71257), // qubodup: recarga de fusil (se usa en la MP5)
  sxpBomba: fsSrc(449614, 9348290), // dasBUTCHER84: bomba de una Winchester SXP
  gatilloSeco: fsSrc(171211, 1769769), // brianhanson2nd: S&W 9 mm en seco
  desenfundar: fsSrc(377145, 932959), // nioczkus
  enfundar: fsSrc(388819, 932959), // nioczkus
  desenfundar2: fsSrc(688765, 71257), // qubodup
  vainas: fsSrc(210102, 3278936), // GrayJoy: vainas de latón sobre concreto
  cartuchos: fsSrc(620929, 6493174), // Metrolynn: cartuchos de escopeta vacíos
  aceroBlanco: fsSrc(675951, 2524442), // craigsmith: tiros a blancos de acero
  balaCarro: fsSrc(399550, 3223478), // BorekPL: bala contra carro
  balaCarne: fsSrc(452155, 6175868), // bananplyte: balas en carne
  rebote: fsSrc(30932, 15696), // aust_paul: rebotes
  concreto1: fsSrc(321477, 5485024), // dslrguide: golpe en losa de concreto
  concreto2: fsSrc(321478, 5485024), // dslrguide: golpe en ladrillo con esquirlas
  tajo: fsSrc(504615, 7704891), // NeoSpica: tajo en carne
  punos: fsSrc(503277, 2247456), // Kinoton: puñetazos
  puno2: fsSrc(390462, 1325505), // Huminaatio: puñetazo
});

// --------------------------------------------------------------- sonidos
// Cada salida: src (clave de DESCARGAS, o [clave, ruta dentro del extraído]),
// at (s, aproximado; se ajusta al transitorio), dur (s), fade (s, fundido de
// salida), hp (Hz, pasa-altos), lp (Hz, pasa-bajos opcional), canal (0 | 1 |
// 'mezcla'), kbps, pre (s antes del transitorio), exacto (no buscar el
// transitorio: at es el inicio), capas: [{…mismo formato, offset, gain}]
// para mezclar varias tomas.
const G = { kbps: 80, hp: 30, canal: 0, fade: 0.5 }; // disparos
const F = { kbps: 48, hp: 90, canal: 0, fade: 0.08 }; // foley
const ff = (dir, file) => ['ffsl', `Prepared SFX Library/${dir}/${file}`];

export const SONIDOS = {
  // ---- disparos cercanos (2-3 variantes por arma) y lejanos (distancia media)
  pistola_1: { ...G, src: ff('Walther PPQ', 'X_39P.wav'), at: 1.4, dur: 1.45 },
  pistola_2: { ...G, src: ff('Walther PPQ', 'X_39P.wav'), at: 6.44, dur: 1.45 },
  pistola_3: { ...G, src: ff('Walther PPQ', 'X_39P.wav'), at: 10.66, dur: 1.45 },
  pistola_lejos: { ...G, src: ff('Walther PPQ', 'X_31P.wav'), at: 1.08, dur: 2.2, fade: 0.9 },
  subfusil_1: { ...G, src: ff('Carl Gustav M45', 'G_31P.wav'), at: 0.3, dur: 1.0, fade: 0.45 },
  subfusil_2: { ...G, src: ff('Carl Gustav M45', 'G_31P.wav'), at: 3.5, dur: 1.0, fade: 0.45 },
  subfusil_3: { ...G, src: ff('Carl Gustav M45', 'G_31P.wav'), at: 6.72, dur: 1.0, fade: 0.45 },
  subfusil_lejos: { ...G, src: ff('Carl Gustav M45', 'G_20P.wav'), at: 0.34, dur: 1.7, fade: 0.8 },
  escopeta_1: { ...G, src: ff('Nova', 'O_21P.wav'), at: 0.42, dur: 1.7, fade: 0.7 },
  escopeta_2: { ...G, src: ff('Nova', 'O_21P.wav'), at: 3.46, dur: 1.7, fade: 0.7 },
  escopeta_3: { ...G, src: ff('CD', 'H_21P.wav'), at: 0.46, dur: 1.7, fade: 0.7 },
  escopeta_lejos: { ...G, src: ff('Nova', 'O_17P.wav'), at: 0.68, dur: 2.5, fade: 1.1 },
  fusil_1: { ...G, src: ff('AR-15', 'D_32P.wav'), at: 0.7, dur: 1.8, fade: 0.8 },
  fusil_2: { ...G, src: ff('AR-15', 'D_32P.wav'), at: 5.64, dur: 1.8, fade: 0.8 },
  fusil_lejos: { ...G, src: ff('AR-15', 'D_24P.wav'), at: 0.54, dur: 2.9, fade: 1.2 },

  // ---- manejo: gatillo en seco, cargadores, correderas, bomba
  seco: { ...F, src: 'gatilloSeco', at: 1.29, dur: 0.26, hp: 150 },
  pistola_cargador_fuera: { ...F, src: 'zer0solPistola', at: 0.1, dur: 0.36 },
  pistola_cargador_dentro: { ...F, src: 'zer0solPistola', at: 0.6, dur: 0.38 },
  pistola_corredera: { ...F, src: 'zer0solPistola', at: 1.03, dur: 0.5, fade: 0.12 },
  subfusil_cargador_fuera: { ...F, src: 'fusilRecarga', at: 0.03, dur: 0.5 },
  subfusil_cargador_dentro: { ...F, src: 'fusilRecarga', at: 0.6, dur: 0.42 },
  subfusil_cerrojo: { ...F, src: 'fusilRecarga', at: 1.36, dur: 0.52, fade: 0.1 },
  fusil_cargador_fuera: { ...F, src: 'ar15Manejo', at: 0.23, dur: 0.45 },
  fusil_cargador_dentro: { ...F, src: 'ar15Manejo', at: 2.86, dur: 0.42 },
  fusil_manija: { ...F, src: 'ar15Manejo', at: 3.44, dur: 0.6, fade: 0.1 },
  escopeta_cartucho: { ...F, src: ['zer0solEscopeta', 'ShotgunSounds/Subsequent Shells.mp3'], at: 0.68, dur: 0.62 },
  escopeta_bomba_1: { ...F, src: ['zer0solEscopeta', 'ShotgunSounds/Rack.mp3'], at: 0.62, dur: 0.5 },
  escopeta_bomba_2: { ...F, src: 'sxpBomba', at: 0.0, dur: 0.5, exacto: true },
  desenfundar_1: { ...F, src: 'desenfundar', at: 0.07, dur: 0.75, fade: 0.2 },
  desenfundar_2: { ...F, src: 'desenfundar2', at: 0.0, dur: 0.7, exacto: true, fade: 0.15 },
  enfundar: { ...F, src: 'enfundar', at: 0.05, dur: 0.95, fade: 0.25 },

  // ---- vainas y cartuchos que caen al piso
  vaina_1: { ...F, src: 'vainas', at: 2.33, dur: 0.6, hp: 700, fade: 0.25 },
  vaina_2: { ...F, src: 'vainas', at: 7.61, dur: 0.6, hp: 700, fade: 0.25 },
  vaina_3: { ...F, src: 'vainas', at: 9.93, dur: 0.75, hp: 700, fade: 0.25 },
  vaina_escopeta: { ...F, src: 'cartuchos', at: 0.07, dur: 0.7, hp: 200, fade: 0.3 },

  // ---- impactos de bala
  impacto_concreto_1: { ...F, src: 'concreto1', at: 0.0, dur: 0.45, hp: 250, fade: 0.2 },
  impacto_concreto_2: { ...F, src: 'concreto2', at: 0.45, dur: 0.38, hp: 250, fade: 0.2 },
  impacto_metal_1: { ...F, src: 'balaCarro', at: 0.1, dur: 0.55, hp: 150, fade: 0.25 },
  impacto_metal_2: { ...F, src: 'balaCarro', at: 1.75, dur: 0.55, hp: 150, fade: 0.25 },
  impacto_metal_3: { ...F, src: 'aceroBlanco', at: 2.83, dur: 0.7, hp: 150, fade: 0.35 },
  impacto_carne_1: { ...F, src: 'balaCarne', at: 0.0, dur: 0.45, hp: 60, fade: 0.2 },
  impacto_carne_2: { ...F, src: 'balaCarne', at: 0.78, dur: 0.45, hp: 60, fade: 0.2 },
  impacto_carne_3: { ...F, src: 'balaCarne', at: 1.45, dur: 0.45, hp: 60, fade: 0.2 },
  rebote_1: { ...F, src: 'rebote', at: 0.0, dur: 0.5, hp: 300, fade: 0.2 },
  rebote_2: { ...F, src: 'rebote', at: 0.97, dur: 0.6, hp: 300, fade: 0.25 },

  // ---- cuerpo a cuerpo
  silbido_1: { ...F, src: ['swishes', 'swishes/swish-9.wav'], at: 0, dur: 0.2, exacto: true, fade: 0.05, hp: 150 },
  silbido_2: { ...F, src: ['swishes', 'swishes/swish-11.wav'], at: 0, dur: 0.25, exacto: true, fade: 0.05, hp: 150 },
  silbido_3: { ...F, src: ['swishes', 'swishes/swish-3.wav'], at: 0, dur: 0.2, exacto: true, fade: 0.05, hp: 150 },
  tajo: { ...F, src: 'tajo', at: 0.05, dur: 0.6, hp: 80, fade: 0.25 },
  tajo_2: { ...F, src: ['inuHumedos', 'impsplat/impactsplat03.mp3.flac'], at: 0, dur: 0.5, hp: 80, fade: 0.2 },
  puno_1: { ...F, src: 'punos', at: 0.35, dur: 0.4, hp: 50, fade: 0.15 },
  puno_2: { ...F, src: 'punos', at: 3.48, dur: 0.4, hp: 50, fade: 0.15 },
  puno_3: { ...F, src: 'puno2', at: 0.03, dur: 0.4, hp: 50, fade: 0.15 },
};

// --------------------------------------------------------------- herramientas
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { maxBuffer: 1 << 30, ...opts });
const enPath = (bin) => spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0 || spawnSync(bin, ['--help'], { stdio: 'ignore' }).status === 0;

function bajar(url, dest) {
  if (fs.existsSync(dest)) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  console.log('descargando', url);
  run('curl', ['-sS', '-f', '-L', '--retry', '3', '-o', dest + '.part', url], { stdio: 'inherit' });
  fs.renameSync(dest + '.part', dest);
  return dest;
}

/** Baja un paquete de npm (tarball) y lo desempaca en herramientas/<nombre>. */
function paqueteNpm(nombre, version, dir) {
  const dest = path.join(TOOLS, dir);
  if (!fs.existsSync(dest)) {
    const base = nombre.split('/').pop();
    const tgz = bajar(`https://registry.npmjs.org/${nombre}/-/${base}-${version}.tgz`, path.join(TOOLS, `${dir}.tgz`));
    fs.mkdirSync(dest, { recursive: true });
    run('tar', ['xzf', tgz, '-C', dest]);
  }
  return path.join(dest, 'package');
}

let FFMPEG = 'ffmpeg';
let SIETE = '7z';
function herramientas() {
  const linux = process.platform === 'linux' && process.arch === 'x64';
  if (!enPath('ffmpeg')) {
    if (!linux) throw new Error('Falta ffmpeg (con libopus) en el PATH');
    FFMPEG = path.join(paqueteNpm('@ffmpeg-installer/linux-x64', '4.1.0', 'ffmpeg'), 'ffmpeg');
    fs.chmodSync(FFMPEG, 0o755);
  }
  if (!enPath('7z')) {
    if (enPath('7za')) SIETE = '7za';
    else {
      if (!linux) throw new Error('Falta 7-Zip (7z) en el PATH');
      SIETE = path.join(paqueteNpm('7zip-bin', '5.2.0', '7zip'), 'linux/x64/7za');
      fs.chmodSync(SIETE, 0o755);
    }
  }
}

/** Ruta local de una fuente: clave de DESCARGAS o [clave, archivo dentro del comprimido]. */
function rutaDe(src) {
  const [clave, miembro] = Array.isArray(src) ? src : [src, null];
  const d = DESCARGAS[clave];
  if (!d) throw new Error(`Fuente desconocida: ${clave}`);
  const file = bajar(d.url, path.join(CACHE, d.file));
  if (!miembro) return file;
  const dest = path.join(CACHE, d.extraer, miembro);
  if (!fs.existsSync(dest)) {
    console.log('extrayendo', miembro);
    fs.mkdirSync(path.join(CACHE, d.extraer), { recursive: true });
    if (file.endsWith('.zip')) run('unzip', ['-o', '-q', file, miembro, '-d', path.join(CACHE, d.extraer)]);
    else run(SIETE, ['x', '-y', `-o${path.join(CACHE, d.extraer)}`, file, miembro], { stdio: 'ignore' });
  }
  return dest;
}

// --------------------------------------------------------------- audio
/** Decodifica a Float32 mono 48 kHz (un canal o la mezcla) con filtros opcionales. */
function decodificar(file, { canal = 0, hp = 0, lp = 0 } = {}) {
  const af = [canal === 'mezcla' ? 'pan=mono|c0=0.5*c0+0.5*c1' : `pan=mono|c0=c${canal}`];
  if (hp) af.push(`highpass=f=${hp}:poles=2`);
  if (lp) af.push(`lowpass=f=${lp}:poles=2`);
  // Las fuentes mono no tienen c1: se repite el canal 0.
  let args = ['-v', 'error', '-i', file, '-af', af.join(','), '-ar', String(SR), '-f', 'f32le', '-'];
  let buf;
  try {
    buf = run(FFMPEG, args);
  } catch {
    args = ['-v', 'error', '-i', file, '-ac', '1', ...(af.length > 1 ? ['-af', af.slice(1).join(',')] : []), '-ar', String(SR), '-f', 'f32le', '-'];
    buf = run(FFMPEG, args);
  }
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
}

/** Inicio del transitorio más fuerte cerca de `at`: primera muestra que supera el 30 % del pico local. */
function transitorio(x, at, ventana = 0.12) {
  const a = Math.max(0, Math.floor((at - ventana) * SR));
  const b = Math.min(x.length, Math.floor((at + ventana) * SR));
  let pico = 0;
  for (let i = a; i < b; i++) pico = Math.max(pico, Math.abs(x[i]));
  for (let i = a; i < b; i++) if (Math.abs(x[i]) >= pico * 0.3) return i / SR;
  return at;
}

function procesar(spec) {
  const capas = spec.capas ?? [{ ...spec, offset: 0, gain: 1 }];
  const len = Math.round(spec.dur * SR);
  const out = new Float32Array(len);
  for (const c of capas) {
    const x = decodificar(rutaDe(c.src), c);
    const t0 = c.exacto ? c.at : Math.max(0, transitorio(x, c.at) - (c.pre ?? 0.002));
    const i0 = Math.round(t0 * SR);
    const off = Math.round((c.offset ?? 0) * SR);
    for (let i = 0; i + off < len && i0 + i < x.length; i++) out[i + off] += x[i0 + i] * (c.gain ?? 1);
  }
  // Fundido de entrada de 1 ms (sin clic) y de salida en coseno hasta cero.
  const fin = Math.round(0.001 * SR);
  for (let i = 0; i < fin; i++) out[i] *= i / fin;
  const nf = Math.min(len, Math.round(spec.fade * SR));
  for (let i = 0; i < nf; i++) out[len - nf + i] *= 0.5 + 0.5 * Math.cos((Math.PI * (i + 1)) / nf);
  // Normalizar el pico a -1 dBFS.
  let pico = 0;
  for (const v of out) pico = Math.max(pico, Math.abs(v));
  const k = pico > 0 ? 10 ** (-1 / 20) / pico : 1;
  for (let i = 0; i < len; i++) out[i] *= k;
  return out;
}

function codificar(x, dest, kbps) {
  const tmp = dest + '.f32';
  fs.writeFileSync(tmp, Buffer.from(x.buffer));
  try {
    run(FFMPEG, ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', tmp, '-c:a', 'libopus', '-b:a', `${kbps}k`, '-vbr', 'on', '-compression_level', '10', '-application', 'audio', '-map_metadata', '-1', dest]);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Forma de onda (lineal y en dB) + espectrograma de cada archivo, y una hoja de contacto. */
async function dibujar(nombres, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const pngs = [];
  for (const n of nombres) {
    const src = path.join(OUT, `${n}.ogg`);
    const png = path.join(dir, `${n}.png`);
    run(FFMPEG, [
      '-v', 'error', '-y', '-i', src, '-filter_complex',
      '[0:a]aformat=channel_layouts=mono,asplit=3[a][b][c];' +
        '[a]showwavespic=s=640x90:colors=#4fc3f7[w];' +
        '[b]volume=30dB,showwavespic=s=640x60:colors=#ffb74d[l];' +
        '[c]showspectrumpic=s=640x160:scale=log:color=intensity[s];' +
        '[s]scale=640:160[s2];[w][l][s2]vstack=inputs=3',
      '-frames:v', '1', png,
    ]);
    pngs.push({ n, png });
  }
  const sharp = (await import('sharp')).default;
  const W = 660;
  const H = 330;
  const cols = 4;
  const rows = Math.ceil(pngs.length / cols);
  const comps = [];
  for (const [i, { n, png }] of pngs.entries()) {
    const x = (i % cols) * W;
    const y = Math.floor(i / cols) * H;
    comps.push({ input: await sharp(png).resize(640, 310, { fit: 'fill' }).toBuffer(), left: x + 10, top: y + 18 });
    comps.push({ input: Buffer.from(`<svg width="640" height="18"><text x="0" y="14" font-size="14" font-family="sans-serif" fill="#fff">${n} (${(fs.statSync(path.join(OUT, `${n}.ogg`)).size / 1024).toFixed(1)} KB)</text></svg>`), left: x + 10, top: y });
  }
  await sharp({ create: { width: cols * W, height: rows * H, channels: 3, background: '#111' } }).composite(comps).png().toFile(path.join(dir, 'hoja.png'));
  console.log('imágenes en', dir);
}

// --------------------------------------------------------------- main
const args = process.argv.slice(2);
const pngIdx = args.indexOf('--png');
const pngDir = pngIdx >= 0 ? path.resolve(args[pngIdx + 1]) : null;
const pedidos = args.filter((a, i) => !a.startsWith('--') && (pngIdx < 0 || i !== pngIdx + 1));
const nombres = pedidos.length ? pedidos : Object.keys(SONIDOS);

herramientas();
fs.mkdirSync(OUT, { recursive: true });
let total = 0;
for (const n of nombres) {
  const spec = SONIDOS[n];
  if (!spec) throw new Error(`Sonido desconocido: ${n}`);
  const dest = path.join(OUT, `${n}.ogg`);
  codificar(procesar(spec), dest, spec.kbps);
  const kb = fs.statSync(dest).size / 1024;
  total += kb;
  console.log(n.padEnd(26), `${spec.dur.toFixed(2)} s`, `${kb.toFixed(1)} KB`);
}
console.log(`total: ${nombres.length} archivos, ${(total / 1024).toFixed(2)} MB`);
if (pngDir) await dibujar(nombres, pngDir);
