// Prueba de humo de la app de escritorio: ejecuta el binario con
// --smoke-test (ver electron/main.cjs) y falla si la app no arranca y juega.
// Uso: node scripts/electron-smoke.mjs [ruta-al-exe] [captura.png]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import electronPath from 'electron';

const exe = process.argv[2];
const shot = path.resolve(process.argv[3] ?? 'electron-smoke.png');
const [cmd, args] = exe
  ? [path.resolve(exe), []]
  : [electronPath, ['.', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']];
const child = spawn(cmd, [...args, '--smoke-test', `--smoke-out=${shot}`], { stdio: 'inherit' });
const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c ?? 1)));
if (fs.existsSync(`${shot}.txt`)) console.log(fs.readFileSync(`${shot}.txt`, 'utf8'));
console.log(`Código de salida: ${code}`);
process.exit(code === 0 && fs.existsSync(shot) ? 0 : 1);
