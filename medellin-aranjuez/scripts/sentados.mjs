// Revisa la postura de la gente sentada en las sillas plásticas: mide los
// huesos en el marco de la silla y toma capturas de lado y de frente.
// Uso: npx vite build && node scripts/sentados.mjs <carpeta>
import { chromium } from '@playwright/test';
import { serveDist } from './serve.mjs';
import path from 'node:path';
import fs from 'node:fs';
const out = process.argv[2] ?? 'sentados';
fs.mkdirSync(out, { recursive: true });
const PORT = +(process.env.SHOTS_PORT ?? 4193);
const server = await serveDist(PORT, path.resolve(process.env.DIST_DIR ?? 'dist'));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${PORT}/?autotest=1&quality=${process.env.Q ?? 'alta'}`, { timeout: 600000 });
await page.waitForFunction(() => window.__game?.ready && window.__game.state().state === 'playing', null, { timeout: 600000 });
const G = (fn, a) => page.evaluate(fn, a);
const frames = async (n) => {
  const s = await G(() => window.__game.frames);
  await page.waitForFunction((t) => window.__game.frames >= t, s + n, { timeout: 600000 });
};
const spots = await G(() => window.__gameInstance.world.fixedSpots.filter((s) => s.sit).map((s) => ({ x: s.x, z: s.z, yaw: s.yaw })));
console.log('sillas con gente:', spots.length);
const N = +(process.env.N ?? 2);
for (let i = 0; i < Math.min(N, spots.length); i++) {
  const sp = spots[i * 5 % spots.length];
  await G((sp) => {
    window.__game.setTime?.(11);
    window.__game.teleport(sp.x + 14, sp.z + 14);
  }, sp);
  await G(() => window.__game.advance(3));
  await G((sp) => window.__game.aerial(sp.x + 2, window.__game.state().y + 1.5, sp.z + 2, sp.x, window.__game.state().y, sp.z), sp);
  await frames(40);
  const m = await G((sp) => {
    const g = window.__gameInstance;
    const ped = g.world.fixedSpots.find((s) => Math.abs(s.x - sp.x) < 0.01 && Math.abs(s.z - sp.z) < 0.01)?.ped;
    if (!ped) return null;
    const rig = ped.rig;
    const rot = sp.yaw - Math.PI; // la silla mira a +Z local
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const gy = rig.root.position.y;
    const loc = (v) => {
      const dx = v.x - sp.x;
      const dz = v.z - sp.z;
      // Marco de la silla: z hacia el frente, x a su izquierda/derecha.
      return { x: +(dx * c - dz * s).toFixed(3), y: +(v.y - gy).toFixed(3), z: +(dx * s + dz * c).toFixed(3) };
    };
    rig.root.updateMatrixWorld(true);
    const res = {};
    for (const n of ['Bip01', 'Bip01_Pelvis', 'Bip01_Spine', 'Bip01_Spine2', 'Bip01_Neck', 'Bip01_Head', 'Bip01_L_Thigh', 'Bip01_L_Calf', 'Bip01_L_Foot', 'Bip01_R_Thigh', 'Bip01_R_Foot']) {
      const b = rig.bones[n];
      if (b) res[n] = loc(b.getWorldPosition(b.position.clone()));
    }
    // Puntos más bajos y más atrás de la malla (piel) en el marco de la silla.
    let minY = 9;
    let minZ = 9;
    const v = new (rig.root.position.constructor)();
    rig.model.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const pos = o.geometry.attributes.position;
      for (let k = 0; k < pos.count; k += 7) {
        o.getVertexPosition(k, v);
        o.localToWorld(v); // getVertexPosition ya aplica los huesos
        const l = loc(v);
        if (Math.abs(l.x) < 0.25 && l.y < 0.75 && l.y > 0.2) minY = Math.min(minY, l.y);
        if (Math.abs(l.x) < 0.25 && l.y > 0.5 && l.y < 1.1) minZ = Math.min(minZ, l.z);
      }
    });
    return { gy, clip: Object.entries(rig.w).filter(([, w]) => w > 0.05).map(([k, w]) => `${k}:${w.toFixed(2)}`), model: rig.model.position.y, sitHip: rig.sitHip, scale: rig.model.scale.x, bones: res, minSeatY: +minY.toFixed(3), minBackZ: +minZ.toFixed(3) };
  }, sp);
  console.log(i, JSON.stringify(m, null, 0));
  if (!m) continue;
  // Capturas: de lado (eje x de la silla) y de tres cuartos.
  for (const [name, side, fwd, h] of [
    ['lado', 2.2, 0, 0.75],
    ['frente', 0.6, 2.2, 0.9],
  ]) {
    await G(([sp, side, fwd, h, gy]) => {
      const rot = sp.yaw - Math.PI;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      // Del marco de la silla al mundo.
      const wx = (lx, lz) => sp.x + lx * c + lz * s;
      const wz = (lx, lz) => sp.z - lx * s + lz * c;
      window.__game.aerial(wx(side, fwd), gy + h, wz(side, fwd), sp.x, gy + 0.6, sp.z);
    }, [sp, side, fwd, h, m?.gy ?? 0]);
    await frames(4);
    await page.screenshot({ path: `${out}/silla${i}_${name}.png`, timeout: 600000 });
    if (name === 'lado') {
      // La silla sola (sin la persona) para comparar.
      const vis = (v) => G(([sp, v]) => {
        const ped = window.__gameInstance.world.fixedSpots.find((s) => Math.abs(s.x - sp.x) < 0.01 && Math.abs(s.z - sp.z) < 0.01)?.ped;
        if (ped) ped.rig.root.visible = v;
      }, [sp, v]);
      await vis(false);
      await frames(3);
      await page.screenshot({ path: `${out}/silla${i}_${name}_sola.png`, timeout: 600000 });
      await vis(true);
    }
  }
  await G(() => window.__game.aerial());
}
console.log('ERRORES', errors.length ? errors.slice(0, 10).join('\n') : 'ninguno');
await browser.close();
server.close?.();
process.exit(0);
