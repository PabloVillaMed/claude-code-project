// Servidor estático mínimo para servir dist/ en pruebas y capturas.
//
// Con `base` imita a GitHub Pages, que publica el sitio bajo una subruta
// (https://pablovillamed.github.io/claude-code-project/): solo responde lo que
// está debajo de la base, la base sin la barra final redirige (301) a la base
// con barra y todo lo demás da 404. Sin `base` sirve desde la raíz, como antes.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const UTF8 = '; charset=utf-8';
export const TYPES = {
  '.html': 'text/html' + UTF8,
  '.js': 'text/javascript' + UTF8,
  '.mjs': 'text/javascript' + UTF8,
  '.css': 'text/css' + UTF8,
  '.json': 'application/json' + UTF8,
  '.webmanifest': 'application/manifest+json' + UTF8,
  '.svg': 'image/svg+xml' + UTF8,
  '.txt': 'text/plain' + UTF8,
  '.md': 'text/markdown' + UTF8,
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.hdr': 'image/vnd.radiance',
  '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json' + UTF8,
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
};

/** '/claude-code-project' | 'claude-code-project/' | '' → '/claude-code-project/' (o '/'). */
export function normalizeBase(base = '/') {
  const parts = String(base ?? '/').split(/[\\/]+/).filter(Boolean);
  return parts.length ? `/${parts.join('/')}/` : '/';
}

/**
 * Decide qué responder a una URL pedida, sin tocar la red (se prueba en Node).
 * Devuelve { status: 200, file } | { status: 301, location } | { status: 400 | 404 }.
 * Nunca entrega un archivo fuera de `root`, ni con '..' ni con barras invertidas
 * (en Windows `path` las toma como separadores) ni con otra unidad (C:).
 */
export function resolveRequest(reqUrl, root, base = '/') {
  base = normalizeBase(base);
  root = path.resolve(root);
  const raw = String(reqUrl ?? '/');
  const q = raw.indexOf('?');
  const pathname = q < 0 ? raw : raw.slice(0, q);
  const search = q < 0 ? '' : raw.slice(q);
  if (!pathname.startsWith('/')) return { status: 400 };
  // La base sin la barra final: Pages redirige a la base con barra.
  if (base !== '/' && pathname === base.slice(0, -1)) return { status: 301, location: base + search };
  if (!pathname.startsWith(base)) return { status: 404 };
  let rel;
  try {
    rel = decodeURIComponent(pathname.slice(base.length));
  } catch {
    return { status: 400 };
  }
  if (rel.includes('\0')) return { status: 400 };
  // En Windows ':' abre flujos alternos de NTFS (index.html::$DATA): ningún archivo del juego la lleva.
  if (path.sep === '\\' && rel.includes(':')) return { status: 404 };
  const file = path.resolve(root, '.' + path.sep + rel);
  const inside = path.relative(root, file);
  if (inside === '..' || inside.startsWith('..' + path.sep) || path.isAbsolute(inside)) return { status: 404 };
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return { status: 404 };
  }
  if (stat.isDirectory()) {
    // Como Pages: la carpeta sin barra redirige; con barra sirve su index.html.
    if (!pathname.endsWith('/')) return { status: 301, location: pathname + '/' + search };
    const index = path.join(file, 'index.html');
    return fs.existsSync(index) ? { status: 200, file: index } : { status: 404 };
  }
  return stat.isFile() ? { status: 200, file } : { status: 404 };
}

export function serveDist(port = 4180, root = path.resolve('dist'), { base = '/' } = {}) {
  root = path.resolve(root);
  base = normalizeBase(base);
  const server = http.createServer((req, res) => {
    const head = req.method === 'HEAD';
    const r = req.method === 'GET' || head ? resolveRequest(req.url, root, base) : { status: 405 };
    if (r.status !== 200) {
      const headers = { 'Content-Type': 'text/plain' + UTF8, 'Cache-Control': 'no-cache' };
      if (r.location) headers.Location = r.location;
      if (r.status === 405) headers.Allow = 'GET, HEAD';
      res.writeHead(r.status, headers);
      res.end(head ? undefined : String(r.status));
      return;
    }
    const file = r.file;
    // Sin caché del navegador entre corridas: así las pruebas no ven un build viejo.
    const common = { 'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
    const send = (status, headers, opts) => {
      res.writeHead(status, { ...common, ...headers });
      if (head) {
        res.end();
        return;
      }
      fs.createReadStream(file, opts)
        .on('error', () => res.destroy())
        .pipe(res);
    };
    // Rangos de bytes: la música de la radio va en streaming con <audio>.
    const size = fs.statSync(file).size;
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (m && (m[1] || m[2])) {
      const a = m[1] ? +m[1] : Math.max(0, size - +m[2]);
      const b = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
      if (a >= size || a > b) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Cache-Control': 'no-cache' });
        res.end();
        return;
      }
      send(206, { 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': b - a + 1 }, { start: a, end: b });
      return;
    }
    send(200, { 'Content-Length': size });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
