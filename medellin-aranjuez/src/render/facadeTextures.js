// Texturas procedurales (canvas) para las fachadas modeladas: rejas, puertas
// metálicas, interiores de los locales, avisos con el nombre de cada negocio,
// toldos y suciedad de las paredes. Se generan una vez al arrancar; cada una
// es un atlas para que todas las casas compartan material (pocas llamadas de
// dibujo). Las coordenadas de cada casilla las da `slot()`.

import * as THREE from 'three';
import { makeRng } from '../sim/rng.js';
import { SHOPS } from '../sim/facades.js';
import { canvas, stains, toTexture } from './textures.js';

/** Rectángulo UV [u0, v0, u1, v1] de la casilla i en un atlas de cols x rows. */
export function slot(i, cols, rows) {
  const c = i % cols;
  const r = Math.floor(i / cols);
  return [c / cols, 1 - (r + 1) / rows, (c + 1) / cols, 1 - r / rows];
}

function atlasTexture(c, srgb = true) {
  const t = toTexture(c, { srgb, repeat: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ------------------------------------------------------------------ rejas
export const GRILLE_SLOTS = 4;

/** Rejas de ventana (blanco = hierro). Se usa como alphaMap y se tiñe por casa. */
export function grilleAtlas() {
  const S = 256;
  const c = canvas(S * GRILLE_SLOTS, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  const line = (x0, y0, x1, y1, w = 6) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  for (let d = 0; d < GRILLE_SLOTS; d++) {
    const ox = d * S;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, 0, S, S);
    ctx.clip();
    ctx.lineWidth = 10;
    ctx.strokeRect(ox + 5, 5, S - 10, S - 10);
    if (d === 0) {
      // Barrotes verticales con dos travesaños.
      for (let x = 32; x < S; x += 32) line(ox + x, 0, ox + x, S);
      line(ox, S / 3, ox + S, S / 3, 7);
      line(ox, (2 * S) / 3, ox + S, (2 * S) / 3, 7);
    } else if (d === 1) {
      // Rombos.
      for (let k = -S; k < 2 * S; k += 48) {
        line(ox + k, 0, ox + k + S, S, 5);
        line(ox + k + S, 0, ox + k, S, 5);
      }
    } else if (d === 2) {
      // Abanico arriba y barrotes abajo (la reja paisa de siempre).
      const cx = ox + S / 2;
      const cy = S * 0.36;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(cx, cy, S * 0.42, Math.PI, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, S * 0.14, Math.PI, 0);
      ctx.stroke();
      for (let a = 0; a <= 8; a++) {
        const t = Math.PI + (a / 8) * Math.PI;
        line(cx + Math.cos(t) * S * 0.14, cy + Math.sin(t) * S * 0.14, cx + Math.cos(t) * S * 0.5, cy + Math.sin(t) * S * 0.5, 5);
      }
      line(ox, cy, ox + S, cy, 8);
      for (let x = 28; x < S; x += 28) line(ox + x, cy, ox + x, S);
    } else {
      // Cuadrícula con círculos.
      for (let x = 42; x < S; x += 42) line(ox + x, 0, ox + x, S, 5);
      for (let y = 42; y < S; y += 42) line(ox, y, ox + S, y, 5);
      ctx.lineWidth = 4;
      for (let x = 21; x < S; x += 84) {
        for (let y = 21; y < S; y += 84) {
          ctx.beginPath();
          ctx.arc(ox + x + 21, y + 21, 13, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
  return atlasTexture(c, false);
}

// ------------------------------------------------------------------ puertas
export const DOOR_SLOTS = 6; // 0-4 puertas, 5 garaje

/** Puertas metálicas en gris claro (se tiñen del color de cada casa). */
export function doorAtlas() {
  const W = 256;
  const H = 512;
  const c = canvas(W * DOOR_SLOTS, H);
  const ctx = c.getContext('2d');
  const rng = makeRng(404);
  const panel = (x, y, w, h, depth = 1) => {
    ctx.fillStyle = depth > 0 ? '#bdbdbd' : '#e6e6e6';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(x, y, w, 3);
    ctx.fillRect(x, y, 3, h);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x, y + h - 3, w, 3);
    ctx.fillRect(x + w - 3, y, 3, h);
  };
  for (let d = 0; d < DOOR_SLOTS; d++) {
    const ox = d * W;
    ctx.fillStyle = '#d9d9d9';
    ctx.fillRect(ox, 0, W, H);
    if (d === 0) {
      // Lámina con estrías horizontales y ventanita enrejada.
      for (let y = 150; y < H - 20; y += 16) panel(ox + 16, y, W - 32, 9, 1);
      ctx.fillStyle = '#2a3035';
      ctx.fillRect(ox + 40, 40, W - 80, 80);
      ctx.fillStyle = '#d9d9d9';
      for (let x = 60; x < W - 40; x += 22) ctx.fillRect(ox + x, 40, 5, 80);
    } else if (d === 1) {
      // Rombos repujados.
      for (let y = 30; y < H - 40; y += 64) {
        for (let x = 30; x < W - 30; x += 64) {
          ctx.fillStyle = '#b4b4b4';
          ctx.beginPath();
          ctx.moveTo(ox + x + 32, y);
          ctx.lineTo(ox + x + 64, y + 32);
          ctx.lineTo(ox + x + 32, y + 64);
          ctx.lineTo(ox + x, y + 32);
          ctx.closePath();
          ctx.fill();
        }
      }
    } else if (d === 2) {
      // Tres tableros verticales.
      for (let k = 0; k < 3; k++) panel(ox + 18 + k * 76, 24, 64, H - 48, 1);
    } else if (d === 3) {
      // Media luna de vidrio con reja arriba y tableros abajo.
      ctx.fillStyle = '#23292e';
      ctx.beginPath();
      ctx.moveTo(ox + 30, 220);
      ctx.lineTo(ox + 30, 110);
      ctx.arc(ox + W / 2, 110, W / 2 - 30, Math.PI, 0);
      ctx.lineTo(ox + W - 30, 220);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#d9d9d9';
      ctx.lineWidth = 5;
      for (let x = 54; x < W - 30; x += 24) {
        ctx.beginPath();
        ctx.moveTo(ox + x, 30);
        ctx.lineTo(ox + x, 220);
        ctx.stroke();
      }
      panel(ox + 30, 250, W - 60, 110, 1);
      panel(ox + 30, 380, W - 60, 110, 1);
    } else if (d === 4) {
      // Seis cuadros.
      for (let r = 0; r < 3; r++) for (let k = 0; k < 2; k++) panel(ox + 22 + k * 112, 26 + r * 158, 100, 144, 1);
    } else {
      // Garaje: lámina con nervaduras verticales.
      for (let x = 8; x < W; x += 20) {
        ctx.fillStyle = '#c4c4c4';
        ctx.fillRect(ox + x, 0, 8, H);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillRect(ox + x, 0, 2, H);
      }
    }
    // Chapa y manija.
    if (d < 5) {
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(ox + W - 46, H * 0.52, 14, 34);
      ctx.fillStyle = '#8a8a8a';
      ctx.fillRect(ox + W - 50, H * 0.5, 22, 8);
    }
    // Desgaste.
    for (let k = 0; k < 40; k++) {
      ctx.fillStyle = `rgba(60,50,40,${rng.range(0.03, 0.1)})`;
      ctx.fillRect(ox + rng.next() * W, rng.next() * H, rng.range(3, 30), rng.range(3, 60));
    }
  }
  return atlasTexture(c);
}

// ------------------------------------------------------------------ interiores de locales
export const INTERIOR_KINDS = ['tienda', 'panaderia', 'drogueria', 'carniceria', 'fruteria', 'peluqueria', 'ferreteria', 'papeleria', 'heladeria', 'cafeteria', 'billares', 'nevera'];
export const INTERIOR_COLS = 4;
export const INTERIOR_ROWS = 3;

/** Pared del fondo de cada tipo de local (se ve por la cortina abierta). */
export function interiorAtlas() {
  const W = 512;
  const H = 256;
  const c = canvas(W * INTERIOR_COLS, H * INTERIOR_ROWS);
  const ctx = c.getContext('2d');
  const rng = makeRng(777);
  const bright = ['#e63946', '#f1c40f', '#2a9d8f', '#e76f51', '#457b9d', '#8ac926', '#ff6f91', '#ffffff', '#6a4c93', '#f4a261', '#1d3557', '#ffd166'];
  const shelves = (x, y, w, h, rows, itemFn) => {
    for (let r = 0; r < rows; r++) {
      const sy = y + ((r + 1) * h) / rows;
      ctx.fillStyle = '#6b5a45';
      ctx.fillRect(x, sy - 6, w, 6);
      let px = x + 4;
      while (px < x + w - 10) {
        const iw = itemFn(px, sy - 6, h / rows - 12);
        px += iw + 2;
      }
    }
  };
  const boxItem = (colors, minW = 8, maxW = 22) => (px, base, maxH) => {
    const w = rng.range(minW, maxW);
    const h = rng.range(maxH * 0.45, maxH * 0.95);
    ctx.fillStyle = rng.pick(colors);
    ctx.fillRect(px, base - h, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(px, base - h, 2, h);
    return w;
  };
  INTERIOR_KINDS.forEach((kind, i) => {
    const ox = (i % INTERIOR_COLS) * W;
    const oy = Math.floor(i / INTERIOR_COLS) * H;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, W, H);
    ctx.clip();
    const wallC = { tienda: '#efe6cf', panaderia: '#f5deb3', drogueria: '#f4f8fb', carniceria: '#f0f0f0', fruteria: '#dfe9c8', peluqueria: '#f3d9e8', ferreteria: '#d8d4c8', papeleria: '#eef3f8', heladeria: '#ffd6e7', cafeteria: '#e9d2b0', billares: '#3b2f2a', nevera: '#e8eef2' }[kind];
    ctx.fillStyle = wallC;
    ctx.fillRect(ox, oy, W, H);
    if (kind === 'tienda' || kind === 'papeleria' || kind === 'drogueria') {
      const cols = kind === 'drogueria' ? ['#ffffff', '#cfe8ff', '#8fd3a8', '#f2f2f2', '#6fa8dc'] : kind === 'papeleria' ? ['#e63946', '#457b9d', '#f1c40f', '#2a9d8f', '#ffffff', '#6a4c93'] : bright;
      shelves(ox + 10, oy + 10, W - 20, H - 20, 4, boxItem(cols));
      if (kind === 'drogueria') {
        ctx.fillStyle = '#1e9e4a';
        ctx.fillRect(ox + W / 2 - 12, oy + 8, 24, 60);
        ctx.fillRect(ox + W / 2 - 30, oy + 26, 60, 24);
      }
    } else if (kind === 'panaderia') {
      shelves(ox + 10, oy + 10, W - 20, H - 20, 3, (px, base, maxH) => {
        const w = rng.range(24, 40);
        ctx.fillStyle = rng.pick(['#c68642', '#a0612b', '#e0a458', '#8b4a1f']);
        ctx.beginPath();
        ctx.ellipse(px + w / 2, base - maxH * 0.3, w / 2, maxH * 0.3, 0, 0, Math.PI * 2);
        ctx.fill();
        return w;
      });
    } else if (kind === 'carniceria') {
      for (let y = 0; y < H; y += 24) for (let x = 0; x < W; x += 24) {
        ctx.strokeStyle = 'rgba(0,0,0,0.08)';
        ctx.strokeRect(ox + x, oy + y, 24, 24);
      }
      ctx.fillStyle = '#9a9a9a';
      ctx.fillRect(ox + 20, oy + 30, W - 40, 5);
      for (let x = 40; x < W - 30; x += 46) {
        ctx.fillStyle = rng.pick(['#9b2226', '#ae2012', '#bb3e03', '#e9c46a']);
        ctx.beginPath();
        ctx.ellipse(ox + x, oy + 90, 16, 50, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (kind === 'fruteria') {
      for (let r = 0; r < 3; r++) {
        for (let k = 0; k < 6; k++) {
          const x = ox + 12 + k * 82;
          const y = oy + 30 + r * 72;
          ctx.fillStyle = '#8b5a2b';
          ctx.fillRect(x, y + 36, 74, 26);
          const fc = rng.pick(['#f4d03f', '#e67e22', '#27ae60', '#c0392b', '#8e44ad', '#f39c12']);
          for (let f = 0; f < 9; f++) {
            ctx.fillStyle = fc;
            ctx.beginPath();
            ctx.arc(x + 8 + (f % 5) * 15, y + 34 - Math.floor(f / 5) * 12, 8, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    } else if (kind === 'peluqueria') {
      for (let k = 0; k < 3; k++) {
        const x = ox + 30 + k * 160;
        ctx.fillStyle = '#c9d6df';
        ctx.fillRect(x, oy + 30, 110, 110);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(x + 10, oy + 36, 20, 98);
        ctx.fillStyle = '#2b2b2b';
        ctx.fillRect(x + 25, oy + 160, 60, 70);
        ctx.fillRect(x + 15, oy + 150, 80, 16);
      }
    } else if (kind === 'ferreteria') {
      ctx.fillStyle = '#c8a878';
      ctx.fillRect(ox + 10, oy + 10, W - 20, 130);
      for (let k = 0; k < 40; k++) {
        ctx.fillStyle = rng.pick(['#555', '#777', '#b22', '#224', '#dd2']);
        ctx.fillRect(ox + 20 + rng.next() * (W - 60), oy + 20 + rng.next() * 100, rng.range(6, 30), rng.range(4, 18));
      }
      shelves(ox + 10, oy + 140, W - 20, 110, 2, boxItem(['#c0392b', '#2980b9', '#f1c40f', '#ecf0f1', '#27ae60'], 14, 26));
    } else if (kind === 'heladeria') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(ox + 20, oy + 150, W - 40, 90);
      for (let k = 0; k < 10; k++) {
        ctx.fillStyle = rng.pick(['#ff9ecd', '#fff3b0', '#a3e635', '#7dd3fc', '#8b5a2b', '#f87171']);
        ctx.fillRect(ox + 30 + k * 46, oy + 160, 38, 34);
      }
      ctx.fillStyle = '#e11d74';
      ctx.font = 'bold 44px Arial';
      ctx.fillText('HELADOS', ox + 150, oy + 90);
    } else if (kind === 'cafeteria') {
      ctx.fillStyle = '#2d2d2d';
      ctx.fillRect(ox + 60, oy + 20, 260, 110);
      ctx.fillStyle = '#f5f5f5';
      ctx.font = 'bold 22px Arial';
      ['TINTO  $1.500', 'EMPANADA $2.000', 'AREPA  $3.500', 'JUGO  $4.000'].forEach((t, k) => ctx.fillText(t, ox + 76, oy + 48 + k * 24));
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = '#6b4226';
        ctx.fillRect(ox + 40 + k * 160, oy + 190, 100, 10);
        ctx.fillRect(ox + 85 + k * 160, oy + 200, 10, 50);
      }
    } else if (kind === 'billares') {
      ctx.fillStyle = 'rgba(255,220,150,0.35)';
      ctx.fillRect(ox + 150, oy, 200, 60);
      ctx.fillStyle = '#146b3a';
      ctx.fillRect(ox + 110, oy + 150, 290, 70);
      ctx.fillStyle = '#4a2c1a';
      ctx.fillRect(ox + 100, oy + 140, 310, 12);
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = rng.pick(['#e63946', '#f1c40f', '#1d3557', '#ffffff']);
        ctx.fillRect(ox + 20 + k * 20, oy + 40, 12, 90);
      }
    } else {
      // Nevera de gaseosas (frente de vidrio con botellas).
      ctx.fillStyle = '#0d1b2a';
      ctx.fillRect(ox + 20, oy + 10, W - 40, H - 20);
      for (let r = 0; r < 4; r++) {
        ctx.fillStyle = '#9aa';
        ctx.fillRect(ox + 24, oy + 60 + r * 52, W - 48, 3);
        for (let x = 30; x < W - 40; x += 18) {
          ctx.fillStyle = rng.pick(['#e63946', '#f77f00', '#2a9d8f', '#ffd166', '#8ecae6', '#6a040f']);
          ctx.fillRect(ox + x, oy + 22 + r * 52, 12, 38);
        }
      }
      ctx.fillStyle = 'rgba(220,240,255,0.18)';
      ctx.fillRect(ox + 20, oy + 10, 60, H - 20);
    }
    // Viñeta: más oscuro en los bordes (profundidad).
    const g = ctx.createRadialGradient(ox + W / 2, oy + H / 2, 40, ox + W / 2, oy + H / 2, W * 0.7);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, W, H);
    ctx.restore();
  });
  return atlasTexture(c);
}

// ------------------------------------------------------------------ avisos
export const SIGN_COLS = 4;
export const SIGN_ROWS = 8;

const SIGN_STYLES = [
  ['#c1121f', '#ffffff'],
  ['#003049', '#fcbf49'],
  ['#ffffff', '#1d3557'],
  ['#2a9d8f', '#ffffff'],
  ['#f1c40f', '#1b1b1b'],
  ['#1b4332', '#ffffff'],
  ['#6a040f', '#ffd166'],
  ['#e76f51', '#ffffff'],
];

/** Avisos pintados de los negocios, un nombre por casilla (índice = SHOPS). */
export function signAtlas() {
  const W = 512;
  const H = 128;
  const c = canvas(W * SIGN_COLS, H * SIGN_ROWS);
  const ctx = c.getContext('2d');
  const rng = makeRng(99);
  SHOPS.forEach(([name, kind], i) => {
    const ox = (i % SIGN_COLS) * W;
    const oy = Math.floor(i / SIGN_COLS) * H;
    const [bg, fg] = SIGN_STYLES[i % SIGN_STYLES.length];
    ctx.fillStyle = bg;
    ctx.fillRect(ox, oy, W, H);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 5;
    ctx.strokeRect(ox + 6, oy + 6, W - 12, H - 12);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 54;
    ctx.font = `bold ${size}px "Segoe UI", Arial, sans-serif`;
    while (ctx.measureText(name).width > W - 40 && size > 22) {
      size -= 2;
      ctx.font = `bold ${size}px "Segoe UI", Arial, sans-serif`;
    }
    ctx.fillText(name, ox + W / 2, oy + H * 0.42);
    const sub = { tienda: 'Víveres · Rancho · Licores', panaderia: 'Pan caliente todo el día', drogueria: 'Drogas · Perfumería', carniceria: 'Res · Cerdo · Pollo', fruteria: 'Frutas y verduras', peluqueria: 'Cortes · Tintes · Barbería', ferreteria: 'Todo para la casa', papeleria: 'Fotocopias · Minutos', heladeria: 'Helados · Postres', cafeteria: 'Tinto · Desayunos', billares: 'Cerveza fría' }[kind];
    ctx.font = 'bold 22px "Segoe UI", Arial, sans-serif';
    ctx.fillText(sub, ox + W / 2, oy + H * 0.78);
    // Desgaste del aviso.
    for (let k = 0; k < 25; k++) {
      ctx.fillStyle = `rgba(0,0,0,${rng.range(0.03, 0.09)})`;
      ctx.fillRect(ox + rng.next() * W, oy + rng.next() * H, rng.range(4, 40), rng.range(2, 10));
    }
  });
  return atlasTexture(c);
}

// ------------------------------------------------------------------ toldos
export const AWNING_SLOTS = 4;

export function awningAtlas() {
  const S = 256;
  const c = canvas(S * AWNING_SLOTS, S);
  const ctx = c.getContext('2d');
  const schemes = [
    ['#c1121f', '#f8f9fa'],
    ['#1d4e89', '#f8f9fa'],
    ['#2d6a4f', '#f8f9fa'],
    ['#f4a300', '#2d6a4f'],
  ];
  schemes.forEach(([a, b], i) => {
    for (let x = 0; x < S; x += 32) {
      ctx.fillStyle = (x / 32) % 2 ? b : a;
      ctx.fillRect(i * S + x, 0, 32, S);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(i * S, S - 30, S, 30);
  });
  const t = atlasTexture(c);
  return t;
}

// ------------------------------------------------------------------ suciedad de fachada
/** Manchas de humedad y chorreones (RGBA) que se mezclan sobre las paredes. */
export function wallDirt(seed = 5) {
  const S = 1024;
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const rng = makeRng(seed);
  stains(ctx, S, S, rng, 30, '35,28,20', 0.2);
  for (let i = 0; i < 22; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const h = rng.range(80, 260);
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, 'rgba(38,32,24,0.3)');
    g.addColorStop(1, 'rgba(38,32,24,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, rng.range(4, 14), h);
  }
  return toTexture(c);
}
