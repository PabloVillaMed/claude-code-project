// Texturas procedurales (canvas) con mapas de color, normales, rugosidad y
// emisión. No se usan imágenes externas: todo se genera al arrancar.

import * as THREE from 'three';
import { makeRng } from '../sim/rng.js';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Normal map a partir de un canvas de alturas (escala de grises). */
function normalFromHeight(hc, strength = 2) {
  const w = hc.width;
  const h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(w, h);
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const nz = 1;
      const l = Math.hypot(dx, dy, nz);
      const i = (y * w + x) * 4;
      img.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(out, { srgb: false });
}

function noise(ctx, w, h, rng, amount, alpha = 0.08, size = 2) {
  for (let i = 0; i < amount; i++) {
    const v = Math.floor(rng.next() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(rng.next() * w, rng.next() * h, size, size);
  }
}

function stains(ctx, w, h, rng, n, color = '0,0,0', maxA = 0.12) {
  for (let i = 0; i < n; i++) {
    const x = rng.next() * w;
    const y = rng.next() * h;
    const r = 10 + rng.next() * w * 0.12;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${color},${maxA * rng.next()})`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

// ---- Fachadas: 4 ventanas x 4 pisos = 12 m x 12 m ----
const FACADE_PX = 1024;
const TILE = FACADE_PX / 4; // 3 m

function drawWindows(ctx, hctx, rng, style) {
  for (let fy = 0; fy < 4; fy++) {
    for (let fx = 0; fx < 4; fx++) {
      const x0 = fx * TILE;
      const y0 = fy * TILE;
      const isGround = fy === 3;
      if (isGround && style !== 'torre' && rng.chance(0.5)) {
        // Puerta de garaje / local con reja enrollable.
        const dx = x0 + TILE * 0.1;
        const dw = TILE * 0.8;
        const dy = y0 + TILE * 0.18;
        const dh = TILE * 0.82;
        const shutter = rng.chance(0.5);
        ctx.fillStyle = shutter ? '#8d9296' : '#3b2a1f';
        ctx.fillRect(dx, dy, dw, dh);
        if (shutter) {
          for (let k = 0; k < dh; k += 6) {
            ctx.fillStyle = k % 12 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.12)';
            ctx.fillRect(dx, dy + k, dw, 3);
          }
        } else {
          ctx.strokeStyle = '#1e140e';
          ctx.lineWidth = 4;
          ctx.strokeRect(dx + 8, dy + 8, dw / 2 - 12, dh - 16);
          ctx.strokeRect(dx + dw / 2 + 4, dy + 8, dw / 2 - 12, dh - 16);
        }
        hctx.fillStyle = '#404040';
        hctx.fillRect(dx, dy, dw, dh);
        continue;
      }
      const ww = TILE * (style === 'torre' ? 0.62 : 0.5);
      const wh = TILE * 0.46;
      const wx = x0 + (TILE - ww) / 2;
      const wy = y0 + TILE * 0.24;
      // Dintel/marco de concreto o aluminio.
      ctx.fillStyle = style === 'ladrillo' ? '#d9d4c9' : '#f2efe8';
      ctx.fillRect(wx - 7, wy - 7, ww + 14, wh + 14);
      // Vidrio con reflejo de cielo.
      const g = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
      g.addColorStop(0, '#5c7384');
      g.addColorStop(0.5, '#27343d');
      g.addColorStop(1, '#3d5160');
      ctx.fillStyle = g;
      ctx.fillRect(wx, wy, ww, wh);
      // Cortinas en algunas ventanas.
      if (rng.chance(0.45)) {
        const cols = ['#e8dcc0', '#c0564b', '#6a8caf', '#e2c35a', '#f3f0ea'];
        ctx.fillStyle = rng.pick(cols);
        ctx.globalAlpha = 0.75;
        ctx.fillRect(wx + 3, wy + 3, ww * rng.range(0.25, 0.5), wh - 6);
        ctx.globalAlpha = 1;
      }
      // Marco de aluminio con divisiones.
      ctx.strokeStyle = style === 'torre' ? '#2a2f33' : '#b8bcbf';
      ctx.lineWidth = 4;
      ctx.strokeRect(wx, wy, ww, wh);
      ctx.beginPath();
      ctx.moveTo(wx + ww / 2, wy);
      ctx.lineTo(wx + ww / 2, wy + wh);
      ctx.stroke();
      // Reja (muy típica en Medellín).
      if (style !== 'torre' && rng.chance(0.55)) {
        ctx.strokeStyle = 'rgba(25,25,25,0.85)';
        ctx.lineWidth = 3;
        for (let k = 1; k < 7; k++) {
          ctx.beginPath();
          ctx.moveTo(wx + (ww * k) / 7, wy);
          ctx.lineTo(wx + (ww * k) / 7, wy + wh);
          ctx.stroke();
        }
      }
      // Alféizar.
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(wx - 7, wy + wh + 7, ww + 14, 6);
      hctx.fillStyle = '#303030';
      hctx.fillRect(wx, wy, ww, wh);
      hctx.fillStyle = '#c8c8c8';
      hctx.fillRect(wx - 7, wy - 7, ww + 14, 7);
      hctx.fillRect(wx - 7, wy + wh, ww + 14, 7);
    }
    // Viga/placa entre pisos.
    if (style === 'ladrillo') {
      ctx.fillStyle = 'rgba(160,160,155,0.9)';
      ctx.fillRect(0, fy * TILE, FACADE_PX, 10);
      hctx.fillStyle = '#d0d0d0';
      hctx.fillRect(0, fy * TILE, FACADE_PX, 10);
    }
  }
}

function emissiveWindows(rng, style) {
  const c = canvas(FACADE_PX / 4);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  const t = c.width / 4;
  const warm = ['#ffcf8a', '#ffe2b0', '#fff4dc', '#bfe3ff', '#ffd9a0'];
  for (let fy = 0; fy < 4; fy++) {
    for (let fx = 0; fx < 4; fx++) {
      if (fy === 3 && style !== 'torre') continue; // planta baja: locales/garajes
      if (!rng.chance(style === 'torre' ? 0.5 : 0.4)) continue;
      const ww = t * (style === 'torre' ? 0.62 : 0.5);
      const wh = t * 0.46;
      ctx.fillStyle = rng.pick(warm);
      ctx.fillRect(fx * t + (t - ww) / 2, fy * t + t * 0.24, ww, wh);
    }
  }
  return toTexture(c);
}

function brickFacade(seed) {
  const rng = makeRng(seed);
  const c = canvas(FACADE_PX);
  const h = canvas(FACADE_PX);
  const ctx = c.getContext('2d');
  const hctx = h.getContext('2d');
  ctx.fillStyle = '#9a8f84';
  ctx.fillRect(0, 0, FACADE_PX, FACADE_PX);
  hctx.fillStyle = '#505050';
  hctx.fillRect(0, 0, FACADE_PX, FACADE_PX);
  // Ladrillo farol a la vista: 29 x 9 cm aprox -> ~9.9 px x 3 px por cm… escalado.
  const bw = 24;
  const bh = 9;
  for (let y = 0, row = 0; y < FACADE_PX; y += bh + 2, row++) {
    for (let x = row % 2 ? -bw / 2 : 0; x < FACADE_PX; x += bw + 2) {
      const r = 150 + rng.next() * 45;
      const g = 68 + rng.next() * 28;
      const b = 40 + rng.next() * 20;
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(x, y, bw, bh);
      const hv = 170 + rng.next() * 60;
      hctx.fillStyle = `rgb(${hv | 0},${hv | 0},${hv | 0})`;
      hctx.fillRect(x, y, bw, bh);
    }
  }
  stains(ctx, FACADE_PX, FACADE_PX, rng, 30, '40,25,15', 0.18);
  drawWindows(ctx, hctx, rng, 'ladrillo');
  noise(ctx, FACADE_PX, FACADE_PX, rng, 9000, 0.06);
  return { map: toTexture(c), normalMap: normalFromHeight(h, 3), emissiveMap: emissiveWindows(makeRng(seed + 7), 'ladrillo') };
}

function stuccoFacade(seed, style = 'pintada') {
  const rng = makeRng(seed);
  const c = canvas(FACADE_PX);
  const h = canvas(FACADE_PX);
  const ctx = c.getContext('2d');
  const hctx = h.getContext('2d');
  ctx.fillStyle = '#f1efe9';
  ctx.fillRect(0, 0, FACADE_PX, FACADE_PX);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, FACADE_PX, FACADE_PX);
  noise(hctx, FACADE_PX, FACADE_PX, rng, 40000, 0.25, 2);
  stains(ctx, FACADE_PX, FACADE_PX, rng, 40, '60,55,45', 0.14);
  // Chorreados de humedad bajo las ventanas.
  for (let i = 0; i < 20; i++) {
    const x = rng.next() * FACADE_PX;
    const y = rng.next() * FACADE_PX;
    const g = ctx.createLinearGradient(x, y, x, y + 120);
    g.addColorStop(0, 'rgba(70,60,50,0.18)');
    g.addColorStop(1, 'rgba(70,60,50,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 6 + rng.next() * 10, 120);
  }
  // Zócalo en el primer piso.
  if (style !== 'torre') {
    ctx.fillStyle = 'rgba(80,70,60,0.35)';
    ctx.fillRect(0, FACADE_PX - 36, FACADE_PX, 36);
  }
  drawWindows(ctx, hctx, rng, style);
  noise(ctx, FACADE_PX, FACADE_PX, rng, 6000, 0.05);
  return { map: toTexture(c), normalMap: normalFromHeight(h, 1.2), emissiveMap: emissiveWindows(makeRng(seed + 11), style) };
}

function muralTexture(seed) {
  // Mural colorido inspirado en el muralismo antioqueño y el grafiti de la ciudad.
  const rng = makeRng(seed);
  const c = canvas(1024, 512);
  const ctx = c.getContext('2d');
  const pal = ['#e63946', '#f4a261', '#2a9d8f', '#264653', '#e9c46a', '#8338ec', '#ff006e', '#3a86ff', '#06d6a0'];
  ctx.fillStyle = rng.pick(pal);
  ctx.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = rng.pick(pal);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    const x = rng.next() * 1024;
    const y = rng.next() * 512;
    ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) ctx.quadraticCurveTo(x + rng.range(-200, 200), y + rng.range(-150, 150), x + rng.range(-220, 220), y + rng.range(-160, 160));
    ctx.fill();
  }
  // Figuras: rostros y soles estilizados.
  for (let i = 0; i < 6; i++) {
    const x = 80 + rng.next() * 860;
    const y = 80 + rng.next() * 350;
    const r = 30 + rng.next() * 60;
    ctx.globalAlpha = 1;
    ctx.fillStyle = rng.pick(pal);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.15, r * 0.1, 0, Math.PI * 2);
    ctx.arc(x + r * 0.3, y - r * 0.15, r * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.font = 'bold 64px "Segoe UI", sans-serif';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 6;
  const words = ['MEDELLÍN', 'ARANJUEZ', 'COMUNA 4', 'PARCE', 'BACANO'];
  const word = rng.pick(words);
  ctx.strokeText(word, 60 + rng.next() * 400, 440);
  ctx.fillText(word, 60 + rng.next() * 400, 440);
  return toTexture(c);
}

function concreteTexture(seed, base = '#8e8b85', size = 512) {
  const rng = makeRng(seed);
  const c = canvas(size);
  const h = canvas(size);
  const ctx = c.getContext('2d');
  const hctx = h.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, size, size);
  stains(ctx, size, size, rng, 40, '30,30,30', 0.25);
  stains(ctx, size, size, rng, 15, '90,70,40', 0.12);
  noise(ctx, size, size, rng, 30000, 0.08, 2);
  noise(hctx, size, size, rng, 30000, 0.3, 2);
  return { map: toTexture(c), normalMap: normalFromHeight(h, 1) };
}

function asphaltTexture(seed, markings) {
  const rng = makeRng(seed);
  const W = 512;
  const H = 512;
  const c = canvas(W, H);
  const h = canvas(W, H);
  const ctx = c.getContext('2d');
  const hctx = h.getContext('2d');
  ctx.fillStyle = '#3a3a3c';
  ctx.fillRect(0, 0, W, H);
  hctx.fillStyle = '#707070';
  hctx.fillRect(0, 0, W, H);
  // Agregado del asfalto.
  for (let i = 0; i < 60000; i++) {
    const v = 35 + rng.next() * 50;
    ctx.fillStyle = `rgb(${v | 0},${v | 0},${(v + 2) | 0})`;
    const x = rng.next() * W;
    const y = rng.next() * H;
    ctx.fillRect(x, y, 1.5, 1.5);
    const hv = 60 + rng.next() * 140;
    hctx.fillStyle = `rgb(${hv | 0},${hv | 0},${hv | 0})`;
    hctx.fillRect(x, y, 1.5, 1.5);
  }
  // Parches y manchas de aceite.
  stains(ctx, W, H, rng, 18, '10,10,10', 0.35);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = `rgba(${rng.next() < 0.5 ? '25,25,27' : '70,70,72'},0.6)`;
    ctx.fillRect(rng.next() * W, rng.next() * H, 40 + rng.next() * 120, 30 + rng.next() * 90);
  }
  // Grietas.
  ctx.strokeStyle = 'rgba(15,15,15,0.7)';
  hctx.strokeStyle = '#303030';
  for (let i = 0; i < 12; i++) {
    let x = rng.next() * W;
    let y = rng.next() * H;
    ctx.lineWidth = hctx.lineWidth = 1 + rng.next() * 1.5;
    ctx.beginPath();
    hctx.beginPath();
    ctx.moveTo(x, y);
    hctx.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      x += rng.range(-25, 25);
      y += rng.range(-25, 25);
      ctx.lineTo(x, y);
      hctx.lineTo(x, y);
    }
    ctx.stroke();
    hctx.stroke();
  }
  if (markings) {
    // U cruza la vía (0..1 = 9 m), V a lo largo (1 = 9 m).
    const px = W / 9;
    // Línea central amarilla discontinua.
    ctx.fillStyle = 'rgba(230,180,40,0.92)';
    for (let y = 0; y < H; y += H / 2) ctx.fillRect(W / 2 - px * 0.06, y, px * 0.12, H / 4);
    // Bordes blancos.
    ctx.fillStyle = 'rgba(235,235,230,0.85)';
    ctx.fillRect(px * 0.25, 0, px * 0.1, H);
    ctx.fillRect(W - px * 0.35, 0, px * 0.1, H);
    noise(ctx, W, H, rng, 8000, 0.25, 2);
  }
  return { map: toTexture(c), normalMap: normalFromHeight(h, 1.5) };
}

function sidewalkTexture(seed) {
  const rng = makeRng(seed);
  const S = 512; // 4 m x 4 m
  const c = canvas(S);
  const h = canvas(S);
  const ctx = c.getContext('2d');
  const hctx = h.getContext('2d');
  ctx.fillStyle = '#a19d95';
  ctx.fillRect(0, 0, S, S);
  hctx.fillStyle = '#a0a0a0';
  hctx.fillRect(0, 0, S, S);
  const tile = S / 8; // losetas de 50 cm
  for (let y = 0; y < S; y += tile) {
    for (let x = 0; x < S; x += tile) {
      const v = 150 + rng.next() * 30;
      ctx.fillStyle = `rgb(${v | 0},${(v - 4) | 0},${(v - 10) | 0})`;
      ctx.fillRect(x + 2, y + 2, tile - 4, tile - 4);
      // Loseta táctil/rayada.
      if ((x / tile + y / tile) % 5 === 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.07)';
        for (let k = 6; k < tile - 4; k += 8) ctx.fillRect(x + 4, y + k, tile - 8, 3);
      }
      hctx.fillStyle = '#c8c8c8';
      hctx.fillRect(x + 2, y + 2, tile - 4, tile - 4);
    }
  }
  stains(ctx, S, S, rng, 25, '40,35,30', 0.2);
  noise(ctx, S, S, rng, 20000, 0.07);
  return { map: toTexture(c), normalMap: normalFromHeight(h, 2) };
}

function paversTexture(seed) {
  const rng = makeRng(seed);
  const S = 512;
  const c = canvas(S);
  const h = canvas(S);
  const ctx = c.getContext('2d');
  const hctx = h.getContext('2d');
  ctx.fillStyle = '#6d5243';
  ctx.fillRect(0, 0, S, S);
  hctx.fillStyle = '#404040';
  hctx.fillRect(0, 0, S, S);
  const bw = 32;
  const bh = 16;
  for (let y = 0, row = 0; y < S; y += bh, row++) {
    for (let x = row % 2 ? -bw / 2 : 0; x < S; x += bw) {
      const r = 150 + rng.next() * 40;
      ctx.fillStyle = `rgb(${r | 0},${(r * 0.55) | 0},${(r * 0.4) | 0})`;
      ctx.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
      hctx.fillStyle = '#c0c0c0';
      hctx.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
    }
  }
  stains(ctx, S, S, rng, 20, '30,20,10', 0.2);
  return { map: toTexture(c), normalMap: normalFromHeight(h, 2.5) };
}

function grassTexture(seed, base = [58, 92, 40]) {
  const rng = makeRng(seed);
  const S = 512;
  const c = canvas(S);
  const h = canvas(S);
  const ctx = c.getContext('2d');
  const hctx = h.getContext('2d');
  ctx.fillStyle = `rgb(${base.join(',')})`;
  ctx.fillRect(0, 0, S, S);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 70000; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const k = rng.range(0.6, 1.4);
    ctx.fillStyle = `rgb(${(base[0] * k) | 0},${(base[1] * k) | 0},${(base[2] * k) | 0})`;
    ctx.fillRect(x, y, 1.2, 3 + rng.next() * 3);
    const hv = 80 + rng.next() * 150;
    hctx.fillStyle = `rgb(${hv | 0},${hv | 0},${hv | 0})`;
    hctx.fillRect(x, y, 1.2, 3);
  }
  stains(ctx, S, S, rng, 30, '90,75,40', 0.2);
  return { map: toTexture(c), normalMap: normalFromHeight(h, 1.5) };
}

function tilesTexture(seed) {
  // Teja de barro española.
  const rng = makeRng(seed);
  const S = 512;
  const c = canvas(S);
  const h = canvas(S);
  const ctx = c.getContext('2d');
  const hctx = h.getContext('2d');
  const cw = 32;
  const ch = 48;
  for (let y = 0; y < S; y += ch) {
    for (let x = 0; x < S; x += cw) {
      const g = ctx.createLinearGradient(x, 0, x + cw, 0);
      const r = 150 + rng.next() * 40;
      g.addColorStop(0, `rgb(${(r * 0.6) | 0},${(r * 0.28) | 0},${(r * 0.16) | 0})`);
      g.addColorStop(0.5, `rgb(${r | 0},${(r * 0.5) | 0},${(r * 0.3) | 0})`);
      g.addColorStop(1, `rgb(${(r * 0.6) | 0},${(r * 0.28) | 0},${(r * 0.16) | 0})`);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, cw, ch);
      const hg = hctx.createLinearGradient(x, 0, x + cw, 0);
      hg.addColorStop(0, '#202020');
      hg.addColorStop(0.5, '#e0e0e0');
      hg.addColorStop(1, '#202020');
      hctx.fillStyle = hg;
      hctx.fillRect(x, y, cw, ch);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x, y + ch - 4, cw, 4);
    }
  }
  stains(ctx, S, S, rng, 30, '20,30,10', 0.25);
  return { map: toTexture(c), normalMap: normalFromHeight(h, 3) };
}

function metalTexture(seed) {
  const rng = makeRng(seed);
  const S = 256;
  const c = canvas(S);
  const h = canvas(S);
  const ctx = c.getContext('2d');
  const hctx = h.getContext('2d');
  for (let x = 0; x < S; x += 16) {
    const g = ctx.createLinearGradient(x, 0, x + 16, 0);
    g.addColorStop(0, '#8a9097');
    g.addColorStop(0.5, '#c3c8cc');
    g.addColorStop(1, '#8a9097');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 16, S);
    const hg = hctx.createLinearGradient(x, 0, x + 16, 0);
    hg.addColorStop(0, '#000');
    hg.addColorStop(0.5, '#fff');
    hg.addColorStop(1, '#000');
    hctx.fillStyle = hg;
    hctx.fillRect(x, 0, 16, S);
  }
  stains(ctx, S, S, rng, 20, '120,60,20', 0.35);
  return { map: toTexture(c), normalMap: normalFromHeight(h, 2) };
}

export function textTexture(text, { w = 1024, h = 256, bg = '#0f5132', fg = '#ffffff', font = 'bold 110px "Segoe UI", Arial, sans-serif', border = '#ffffff' } = {}) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = border;
  ctx.lineWidth = 10;
  ctx.strokeRect(12, 12, w - 24, h - 24);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = parseInt(font.match(/(\d+)px/)[1], 10);
  ctx.font = font;
  while (ctx.measureText(text).width > w - 80 && size > 20) {
    size -= 4;
    ctx.font = font.replace(/\d+px/, `${size}px`);
  }
  ctx.fillText(text, w / 2, h / 2 + 4);
  return toTexture(c, { repeat: false });
}

/** Crea (una sola vez) todas las texturas del juego. */
export function createTextureLibrary() {
  return {
    brick: [brickFacade(11), brickFacade(12)],
    stucco: [stuccoFacade(21), stuccoFacade(22)],
    tower: stuccoFacade(31, 'torre'),
    mural: [muralTexture(41), muralTexture(42), muralTexture(43)],
    concrete: concreteTexture(51),
    roof: concreteTexture(52, '#7d7a74'),
    asphalt: asphaltTexture(61, true),
    asphaltPlain: asphaltTexture(62, false),
    sidewalk: sidewalkTexture(71),
    pavers: paversTexture(81),
    grass: grassTexture(91),
    dryGrass: grassTexture(92, [96, 104, 58]),
    field: grassTexture(93, [52, 110, 45]),
    tiles: tilesTexture(101),
    metal: metalTexture(111),
  };
}
