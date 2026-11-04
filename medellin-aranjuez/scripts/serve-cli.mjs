// Sirve el build (dist/) por http. Opciones (también por entorno):
//   --port=4190                  (PORT)      puerto
//   --base=/medellin-aranjuez/ (BASE)      subruta, como queda en GitHub Pages
//   --dir=dist-otro              (DIST_DIR)  otra carpeta de build
// Ejemplo: node scripts/serve-cli.mjs --port=4191 --base=/medellin-aranjuez/
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBase, serveDist } from './serve.mjs';

/** --nombre=valor o --nombre valor. */
function arg(name) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith(`--${name}=`)) return args[i].slice(name.length + 3);
    if (args[i] === `--${name}` && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  }
  return undefined;
}

const port = +(arg('port') ?? process.env.PORT ?? 4190);
const rawBase = arg('base') ?? process.env.BASE ?? '/';
// Git Bash (MSYS) convierte '/medellin-aranjuez/' en 'C:/Program Files/Git/medellin-aranjuez/'
// al llamar a node directamente; por npm (cmd.exe) no pasa.
if (/^[A-Za-z]:[\\/]/.test(rawBase)) {
  console.error(`La base "${rawBase}" parece una ruta de Windows (Git Bash la convirtió). Escríbela sin la barra inicial (--base=medellin-aranjuez/) o usa MSYS_NO_PATHCONV=1.`);
  process.exit(1);
}
const base = normalizeBase(rawBase);
const dirArg = arg('dir') ?? process.env.DIST_DIR;
// dist/ junto a este script, así sirve igual desde la raíz del repositorio.
const root = dirArg ? path.resolve(dirArg) : fileURLToPath(new URL('../dist', import.meta.url));
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`Puerto inválido: ${arg('port') ?? process.env.PORT}`);
  process.exit(1);
}
await serveDist(port, root, { base });
const shown = path.relative(process.cwd(), root) || '.';
console.log(`Sirviendo ${shown.split(path.sep).join('/')}/ en http://localhost:${port}${base}`);
