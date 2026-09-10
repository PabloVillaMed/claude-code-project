/** Empaqueta dist/ en un único HTML autocontenido: sin recursos externos. */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d) => readdirSync(d).flatMap((f) => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const FACES = [
  ['AlfaSlabOne_400Regular', 400],
  ['Archivo_600SemiBold', 600],
  ['Archivo_700Bold', 700],
];

const files = walk('dist');
const fontCss = FACES.map(([family, weight]) => {
  const f = files.find((p) => p.includes(`/${family}.`) && p.endsWith('.ttf'));
  if (!f) throw new Error(`falta la fuente ${family}`);
  const b64 = readFileSync(f).toString('base64');
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};` +
         `src:url(data:font/ttf;base64,${b64}) format('truetype');font-display:block}`;
}).join('\n');

const bundlePath = files.find((p) => p.endsWith('.js') && p.includes('/js/web/'));
let bundle = readFileSync(bundlePath, 'utf8');

// expo-font pide los TTF por URL; en un fichero suelto eso es un 404.
// Se sustituye cada ruta por su data URI para que no salga ninguna petición.
for (const [family] of FACES) {
  const f = files.find((p) => p.includes(`/${family}.`) && p.endsWith('.ttf'));
  const url = '/' + f.split('dist/')[1];
  const data = `data:font/ttf;base64,${readFileSync(f).toString('base64')}`;
  if (!bundle.includes(url)) throw new Error(`no encuentro la ruta de ${family} en el bundle`);
  bundle = bundle.split(url).join(data);
}

let html = readFileSync('dist/index.html', 'utf8');
const put = (str) => () => str;  // evita que $& y $1 del contenido se interpreten
html = html.replace('</head>', put(`<style id="fuentes-incrustadas">\n${fontCss}\n</style>\n</head>`));
html = html.replace(/<script src="[^"]+" defer><\/script>/, '');
html = html.replace('</body>', put(`<script>\n${bundle}\n</script>\n</body>`));

writeFileSync('dist-single/index.html', html);
const mb = (Buffer.byteLength(html) / 1048576).toFixed(2);
console.log(`√ un solo fichero: dist-single/index.html (${mb} MB)`);
