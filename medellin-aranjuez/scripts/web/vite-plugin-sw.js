// Plugin de Vite (solo en `vite build`): cuando dist/ ya está escrito (bundle +
// lo copiado de public/), recorre los archivos, calcula la revisión de cada uno
// y escribe dist/sw.js desde src/web/sw-template.js con la versión de
// package.json, el BUILD y las listas (ver scripts/web/swManifest.js).
// `npm run dev` no lo usa: en desarrollo no hay service worker.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatSummary, injectServiceWorker, listFiles, planServiceWorker, revision } from './swManifest.js';

const TEMPLATE = fileURLToPath(new URL('../../src/web/sw-template.js', import.meta.url));

/**
 * Revisiones con memoria entre builds. Lo copiado de public/ se lee del
 * original (en Windows leer los archivos recién escritos en dist/ es muy lento:
 * el antivirus los revisa uno por uno) y su revisión se recuerda por tamaño y
 * fecha de modificación; el bundle (assets/, index.html) se lee siempre.
 */
function revisionCache(root, publicDir) {
  const file = path.join(root, 'node_modules', '.cache', 'medellin-sw', 'revisiones.json');
  let memo = {};
  try {
    memo = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // primera vez
  }
  const next = {};
  return {
    revisionOf(f) {
      if (publicDir) {
        const src = path.join(publicDir, f.rel);
        let st = null;
        try {
          st = fs.statSync(src);
        } catch {
          // no viene de public/
        }
        if (st?.isFile() && st.size === f.size) {
          const m = memo[f.rel];
          const rev = m && m[0] === st.size && m[1] === st.mtimeMs ? m[2] : revision(fs.readFileSync(src));
          next[f.rel] = [st.size, st.mtimeMs, rev];
          return rev;
        }
      }
      return revision(fs.readFileSync(f.abs));
    },
    save() {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(next));
      } catch {
        // sin memoria: el próximo build vuelve a leer todo
      }
    },
  };
}

export function serviceWorkerPlugin({ template = TEMPLATE } = {}) {
  let config = null;
  return {
    name: 'medellin:service-worker',
    apply: 'build',
    configResolved(c) {
      config = c;
    },
    // writeBundle corre después de escribir el bundle; public/ se copia antes
    // (renderStart), así que aquí dist/ ya está completo.
    writeBundle() {
      const env = this?.environment;
      if (env && env.name && env.name !== 'client') return;
      const cfg = env?.config ?? config;
      const outDir = path.resolve(cfg.root, cfg.build.outDir);
      const pkg = JSON.parse(fs.readFileSync(path.join(config.root, 'package.json'), 'utf8'));
      const revs = revisionCache(config.root, cfg.build.copyPublicDir === false ? null : cfg.publicDir);
      const plan = planServiceWorker(listFiles(outDir), { version: pkg.version, revisionOf: revs.revisionOf });
      revs.save();
      const code = injectServiceWorker(fs.readFileSync(template, 'utf8'), plan);
      fs.writeFileSync(path.join(outDir, 'sw.js'), code);
      const log = cfg.logger ?? config.logger;
      log.info(formatSummary(plan));
      if (plan.unknown.length) log.warn(`Service worker: ${plan.unknown.length} archivos sin regla (van a la red, sin caché): ${plan.unknown.slice(0, 8).join(', ')}${plan.unknown.length > 8 ? ', …' : ''}. Clasifícalos en scripts/web/swManifest.js.`);
    },
  };
}
