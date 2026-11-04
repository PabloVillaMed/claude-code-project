// Servidor estático de pruebas (scripts/serve.mjs): la subruta de GitHub Pages,
// los tipos MIME, los rangos de bytes y que no se salga de la carpeta.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { normalizeBase, resolveRequest, serveDist, TYPES } from '../../scripts/serve.mjs';

const BASE = '/medellin-aranjuez/';
let tmp;
let root;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'medellin-serve-'));
  root = path.join(tmp, 'dist');
  fs.mkdirSync(path.join(root, 'models'), { recursive: true });
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>juego</title>');
  fs.writeFileSync(path.join(root, 'models', 'silla.glb'), Buffer.alloc(1000, 7));
  fs.writeFileSync(path.join(root, 'manifest.webmanifest'), '{"name":"x"}');
  // Carpeta hermana con el mismo prefijo: el viejo startsWith(root) la dejaba pasar.
  fs.mkdirSync(path.join(tmp, 'dist-secreto'));
  fs.writeFileSync(path.join(tmp, 'dist-secreto', 'clave.txt'), 'no');
  fs.writeFileSync(path.join(tmp, 'afuera.txt'), 'no');
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('normalizeBase', () => {
  it('deja la base con barra al principio y al final', () => {
    expect(normalizeBase()).toBe('/');
    expect(normalizeBase('')).toBe('/');
    expect(normalizeBase('/')).toBe('/');
    expect(normalizeBase('/medellin-aranjuez')).toBe(BASE);
    expect(normalizeBase('medellin-aranjuez/')).toBe(BASE);
    expect(normalizeBase('//a//b/')).toBe('/a/b/');
  });
});

describe('resolveRequest', () => {
  it('sin base sirve desde la raíz como antes', () => {
    expect(resolveRequest('/', root)).toEqual({ status: 200, file: path.join(root, 'index.html') });
    expect(resolveRequest('/?autotest=1&quality=baja', root).file).toBe(path.join(root, 'index.html'));
    expect(resolveRequest('/models/silla.glb', root).file).toBe(path.join(root, 'models', 'silla.glb'));
    expect(resolveRequest('/no-existe.js', root).status).toBe(404);
  });

  it('con base: solo lo de adentro, la base sin barra redirige y la raíz da 404', () => {
    expect(resolveRequest('/', root, BASE).status).toBe(404);
    expect(resolveRequest('/index.html', root, BASE).status).toBe(404);
    expect(resolveRequest('/medellin-aranjuez', root, BASE)).toEqual({ status: 301, location: BASE });
    expect(resolveRequest('/medellin-aranjuez?quality=baja', root, BASE)).toEqual({ status: 301, location: BASE + '?quality=baja' });
    expect(resolveRequest(BASE, root, BASE).file).toBe(path.join(root, 'index.html'));
    expect(resolveRequest(BASE + '?quality=baja', root, BASE).file).toBe(path.join(root, 'index.html'));
    expect(resolveRequest(BASE + 'models/silla.glb', root, BASE).file).toBe(path.join(root, 'models', 'silla.glb'));
    expect(resolveRequest('/medellin-aranjuezx/index.html', root, BASE).status).toBe(404);
  });

  it('las carpetas: sin barra redirigen, con barra y sin index.html dan 404', () => {
    expect(resolveRequest(BASE + 'models', root, BASE)).toEqual({ status: 301, location: BASE + 'models/' });
    expect(resolveRequest(BASE + 'sub/', root, BASE).status).toBe(404);
  });

  it('no se sale de la carpeta (.., barras invertidas, carpeta hermana, unidad)', () => {
    for (const u of [
      '/../afuera.txt',
      '/%2e%2e/afuera.txt',
      '/..%2fafuera.txt',
      '/..%5cafuera.txt',
      '/models/..%5c..%5cafuera.txt',
      '/../dist-secreto/clave.txt',
      '/..%5cdist-secreto%5cclave.txt',
      '/%00index.html',
      '/C:%5cWindows%5cwin.ini',
    ]) {
      for (const b of ['/', BASE]) {
        const r = resolveRequest(u.replace(/^\//, b), root, b);
        expect(r.file, `${b} ${u}`).toBeUndefined();
        expect([400, 404]).toContain(r.status);
      }
    }
    expect(resolveRequest('/%E0%A4%A', root).status).toBe(400); // escape inválido
  });
});

describe('serveDist', () => {
  let server;
  let port;
  const get = (p, headers = {}, method = 'GET') =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.end();
    });

  beforeAll(async () => {
    server = await serveDist(0, root, { base: BASE });
    port = server.address().port;
  });

  afterAll(() => new Promise((r) => server.close(r)));

  it('imita la subruta de Pages', async () => {
    expect((await get('/')).status).toBe(404);
    const r301 = await get('/medellin-aranjuez');
    expect(r301.status).toBe(301);
    expect(r301.headers.location).toBe(BASE);
    const index = await get(BASE);
    expect(index.status).toBe(200);
    expect(index.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(index.headers['cache-control']).toBe('no-cache');
    expect(index.body.toString()).toContain('juego');
  });

  it('tipos MIME y rangos de bytes', async () => {
    const glb = await get(BASE + 'models/silla.glb');
    expect(glb.status).toBe(200);
    expect(glb.headers['content-type']).toBe('model/gltf-binary');
    expect(glb.headers['content-length']).toBe('1000');
    const man = await get(BASE + 'manifest.webmanifest');
    expect(man.headers['content-type']).toBe('application/manifest+json; charset=utf-8');
    const part = await get(BASE + 'models/silla.glb', { Range: 'bytes=100-199' });
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe('bytes 100-199/1000');
    expect(part.body.length).toBe(100);
    const tail = await get(BASE + 'models/silla.glb', { Range: 'bytes=-10' });
    expect(tail.status).toBe(206);
    expect(tail.headers['content-range']).toBe('bytes 990-999/1000');
    expect((await get(BASE + 'models/silla.glb', { Range: 'bytes=5000-' })).status).toBe(416);
    const head = await get(BASE + 'models/silla.glb', {}, 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    expect((await get(BASE, {}, 'POST')).status).toBe(405);
  });

  it('no entrega archivos de afuera aunque la ruta venga cruda', async () => {
    expect((await get('/medellin-aranjuez/../afuera.txt')).status).toBe(404);
    expect((await get('/medellin-aranjuez/..%5c..%5cafuera.txt')).status).toBe(404);
    expect((await get('/medellin-aranjuez/..%2f..%2fdist-secreto%2fclave.txt')).status).toBe(404);
  });

  it('cubre los tipos que trae el build', () => {
    for (const ext of ['.webmanifest', '.svg', '.ico', '.woff2', '.woff', '.opus', '.txt', '.md', '.wasm', '.mjs', '.glb', '.webp', '.hdr', '.ogg']) expect(TYPES[ext], ext).toBeTruthy();
    expect(TYPES['.woff2']).toBe('font/woff2');
    expect(TYPES['.opus']).toBe('audio/ogg');
  });

  it('serveDist(puerto) y serveDist(puerto, ruta) siguen sirviendo desde la raíz', async () => {
    const s = await serveDist(0, root);
    const p = s.address().port;
    const status = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: p, path: '/' }, (res) => (res.resume(), resolve(res.statusCode))));
    await new Promise((r) => s.close(r));
    expect(status).toBe(200);
  });
});
