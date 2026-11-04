// Listas del service worker de la versión web (dist/sw.js): qué se precarga al
// instalar para arrancar y jugar sin conexión, qué se guarda la primera vez que
// el juego lo pide y qué va siempre directo a la red.
//
// Lógica pura (sin Vite) para poder probarla con Vitest; el plugin de
// scripts/web/vite-plugin-sw.js solo la llama al terminar el build.
//
// De dónde salen las reglas (revisado en el código, no adivinado):
//  - index.html y assets/: el bundle, la hoja de estilos, las fuentes Barlow
//    (.woff2) y el worklet del motor (engineSound.js → addModule). No se
//    precargan las .woff (respaldo para navegadores sin woff2) ni el chunk del
//    exportador de Unreal (Game.exportarUnreal, import dinámico), que solo usa
//    el script headless scripts/exportar-unreal.mjs.
//  - models/ y textures/: los manifiestos de render (assetManifest.js:
//    personajes, vehículos, utilería, vegetación, armas, texturas PBR) se cargan
//    todos en Game.init; los íconos de armas los pide ui/icons.js al arrancar.
//    textures/<mat>/hd/ y hdri/*_2k.hdr (urlHd) solo se piden en calidad Alta y Ultra (se guardan al usarse).
//  - sounds/armas (sfxArmas.js), sounds/motor (engineSound.js) y
//    sounds/historia (storyDirector.js): pocos KB, se piden al usarse.
//  - sounds/voces: manifest.json al arrancar (dialogue.js) y 537 voces sueltas a
//    demanda; sounds/musica: la radio (radio.js) baja manifest.json y reproduce
//    las pistas por streaming con <audio> (pedidos Range): no se interceptan.
//  - Los CREDITOS.txt y LICENSE-*.md de public/ no se piden nunca: los créditos
//    del juego salen de ASSETS-CREDITS.md compilado en el bundle (ui/credits.js).

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Largo de la revisión (hex del SHA-256). El SW la verifica con crypto.subtle. */
export const REV_LENGTH = 12;

/** Revisión corta de un archivo: los primeros hex del SHA-256 del contenido. */
export function revision(data) {
  return createHash('sha256').update(data).digest('hex').slice(0, REV_LENGTH);
}

// Primera regla que coincide gana. Rutas relativas a dist/, con '/'.
const RULES = [
  [/^sw\.js$/, 'exclude'],
  [/\.map$/, 'exclude'],
  [/\.(txt|md)$/i, 'exclude'], // CREDITOS.txt, LICENSE-Rocketbox.md: documentación, el juego no los pide
  [/^assets\/exportUnreal-[^/]+\.js$/, 'exclude'],
  // Fuentes .woff: respaldo de @fontsource para navegadores sin woff2; todo
  // navegador con service worker usa las .woff2.
  [/^assets\/[^/]+\.woff$/, 'exclude'],
  [/^index\.html$/, 'precache'],
  [/^manifest\.webmanifest$/, 'precache'],
  [/^icons\//, 'precache'],
  [/^assets\//, 'precache'],
  [/^models\//, 'precache'],
  [/^textures\/[^/]+\/hd\//, 'runtime'],
  [/^textures\//, 'precache'],
  [/^hdri\/[^/]+_2k\.hdr$/, 'runtime'],
  [/^hdri\//, 'precache'],
  [/^sounds\/(armas|motor|historia)\//, 'precache'],
  [/^sounds\/voces\/manifest\.json$/, 'precache'],
  [/^sounds\/voces\/[^/]+\.ogg$/, 'runtime'],
  [/^sounds\/musica\/manifest\.json$/, 'precache'],
  [/^sounds\/musica\//, 'network'],
];

/**
 * Clasifica un archivo de dist/ (ruta relativa con '/'):
 *  'precache' → se baja al instalar el SW (arrancar y jugar sin conexión)
 *  'runtime'  → se guarda en caché la primera vez que el juego lo pide
 *  'network'  → el SW no lo intercepta (música en streaming)
 *  'exclude'  → no entra en las listas (el SW mismo, mapas de fuente, documentación, el exportador)
 *  null       → sin regla: va a la red; el plugin avisa para que alguien decida
 */
export function classify(rel) {
  for (const [re, kind] of RULES) if (re.test(rel)) return kind;
  return null;
}

/** Todos los archivos bajo `dir`: [{ rel, size, abs }] ordenados por ruta. */
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile()) out.push({ rel: path.relative(dir, abs).split(path.sep).join('/'), size: fs.statSync(abs).size, abs });
    }
  };
  walk(dir);
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

const defaultRevisionOf = (f) => f.rev ?? revision(f.data ?? fs.readFileSync(f.abs));

/**
 * Arma las listas del SW. Cada archivo trae `rel`, `size` y su revisión de una
 * de tres formas: `rev` ya calculada, `data` (contenido) o `abs` (se lee del
 * disco); `revisionOf(f)` puede reemplazar eso (el plugin usa una caché). Solo
 * se calculan las revisiones de lo que entra en las listas (la música, 36 MB,
 * no se lee).
 *
 * @returns {{ version: string, build: string, precache: Record<string,string>, runtime: Record<string,string>,
 *   network: string[], excluded: string[], unknown: string[], precacheBytes: number, runtimeBytes: number }}
 */
export function planServiceWorker(files, { version = '0.0.0', revisionOf = defaultRevisionOf } = {}) {
  const plan = { version, build: '', precache: {}, runtime: {}, network: [], excluded: [], unknown: [], precacheBytes: 0, runtimeBytes: 0 };
  const sorted = [...files].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  for (const f of sorted) {
    const kind = classify(f.rel);
    if (kind === 'exclude') plan.excluded.push(f.rel);
    else if (kind === 'network') plan.network.push(f.rel);
    else if (kind === null) plan.unknown.push(f.rel);
    else {
      const rev = revisionOf(f);
      plan[kind][f.rel] = rev;
      if (kind === 'precache') plan.precacheBytes += f.size ?? 0;
      else plan.runtimeBytes += f.size ?? 0;
    }
  }
  // BUILD: huella del conjunto (versión + cada archivo con su revisión). Nombra
  // la caché de esta versión: si nada cambió, la caché es la misma.
  const h = createHash('sha256').update(`v${version}\n`);
  for (const [k, list] of [['P', plan.precache], ['R', plan.runtime]]) for (const [rel, rev] of Object.entries(list)) h.update(`${k} ${rel} ${rev}\n`);
  plan.build = h.digest('hex').slice(0, 10);
  return plan;
}

// Marcas de la plantilla (src/web/sw-template.js). Son JS válido, así la
// plantilla se puede leer y probar tal cual.
export const PLACEHOLDERS = {
  version: "'%VERSION%'",
  build: "'%BUILD%'",
  precache: '/* %PRECACHE% */ {}',
  runtime: '/* %RUNTIME% */ {}',
};

/** Llena la plantilla del SW con la versión, el BUILD y las listas. */
export function injectServiceWorker(template, { version, build, precache, runtime }) {
  const values = { version, build, precache, runtime };
  let code = template;
  for (const [name, mark] of Object.entries(PLACEHOLDERS)) {
    const parts = code.split(mark);
    if (parts.length !== 2) throw new Error(`Plantilla del service worker: la marca ${mark} debe aparecer una vez (aparece ${parts.length - 1})`);
    code = parts.join(JSON.stringify(values[name] ?? (name === 'precache' || name === 'runtime' ? {} : '')));
  }
  return `// Generado por scripts/web/vite-plugin-sw.js a partir de src/web/sw-template.js: no editar.\n${code}`;
}

const mb = (n) => (n / (1024 * 1024)).toFixed(1);

/** Línea para el log del build. */
export function formatSummary(plan) {
  const nPre = Object.keys(plan.precache).length;
  const nRun = Object.keys(plan.runtime).length;
  return `Service worker: ${nPre} archivos precargados (${mb(plan.precacheBytes)} MB), ${nRun} bajo demanda (${mb(plan.runtimeBytes)} MB), ${plan.network.length} por la red (música) · caché medellin-${plan.build}`;
}
