// Texturas procedurales (canvas) de los interiores de los locales
// (render/interiorBuilder.js): madera, concreto, ladrillo, pañete, baldosa,
// cuero, paño de billar, terciopelo, afiches de orquestas inventadas (sin
// personas), acetatos, fotos enmarcadas genéricas, la pintura de la chiva,
// avisos de neón de cerveza sin marca, los letreros de los baños y el nombre
// del local para la pantalla. Todo se pinta una vez, la primera vez que se
// necesita, y queda en caché (no hay imágenes externas ni marcas reales).

import * as THREE from 'three';
import { canvas, noise, stains, toTexture } from './textures.js';
import { makeRng } from '../sim/rng.js';

// ------------------------------------------------------------------ configurables
/** Lado (px) de las texturas de superficie (muros, pisos, cuero...). */
export const TEX_LADO = 512;
/** Nombres inventados de orquestas y conjuntos para los afiches (ninguno real). */
export const ORQUESTAS = ['Orquesta Clave 92', 'Combo Candela', 'Los Soneros de Aranjuez', 'Gran Banda Moravia', 'Sexteto La Loma', 'Conjunto Brisa Caribe', 'Orquesta Sabor Paisa', 'Timba del Barrio'];
/** Textos de los avisos de neón genéricos del bar de esquina. */
export const NEONES_BAR = ['CERVEZA FRÍA', 'BAR', 'ABIERTO', 'AGUARDIENTE'];

const cache = new Map();
const once = (key, fn) => {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
};

const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

/** Madera de tablones (piso, barra, mesas). tone: [h, s, l]. */
export function maderaTex(tone = [28, 45, 32], key = 'madera') {
  return once(`${key}:${tone}`, () => {
    const S = TEX_LADO;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    const rng = makeRng(311);
    const rows = 8;
    for (let r = 0; r < rows; r++) {
      const y = (r * S) / rows;
      let x = -rng.range(0, S * 0.5);
      while (x < S) {
        const w = S * rng.range(0.35, 0.8);
        g.fillStyle = hsl(tone[0] + rng.range(-4, 4), tone[1] + rng.range(-6, 6), tone[2] + rng.range(-6, 5));
        g.fillRect(x, y, w, S / rows);
        // Vetas.
        g.strokeStyle = hsl(tone[0], tone[1], tone[2] - 12, 0.35);
        g.lineWidth = 1;
        for (let k = 0; k < 6; k++) {
          const yy = y + rng.range(2, S / rows - 2);
          g.beginPath();
          g.moveTo(x, yy);
          g.bezierCurveTo(x + w * 0.3, yy + rng.range(-3, 3), x + w * 0.6, yy + rng.range(-3, 3), x + w, yy);
          g.stroke();
        }
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.fillRect(x, y, 2, S / rows);
        x += w;
      }
      g.fillStyle = 'rgba(0,0,0,0.5)';
      g.fillRect(0, y, S, 2);
    }
    noise(g, S, S, rng, 3000, 0.05);
    return toTexture(c);
  });
}

/** Concreto a la vista (muros y piso del club industrial). */
export function concretoTex(l = 46, key = 'concreto') {
  return once(`${key}:${l}`, () => {
    const S = TEX_LADO;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    const rng = makeRng(77);
    g.fillStyle = hsl(30, 4, l);
    g.fillRect(0, 0, S, S);
    stains(g, S, S, rng, 40, '0,0,0', 0.18);
    stains(g, S, S, rng, 20, '255,255,255', 0.08);
    noise(g, S, S, rng, 14000, 0.07, 2);
    // Juntas de las formaletas y huecos de los amarres.
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 2;
    for (let k = 1; k < 4; k++) {
      g.beginPath();
      g.moveTo(0, (k * S) / 4);
      g.lineTo(S, (k * S) / 4);
      g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.fillRect((i + 0.5) * (S / 4) - 3, (j + 0.5) * (S / 4) - 3, 6, 6);
    return toTexture(c);
  });
}

/** Ladrillo farol (muros de la cantina y el foso del sótano). */
export function ladrilloTex() {
  return once('ladrillo', () => {
    const S = TEX_LADO;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    const rng = makeRng(5);
    g.fillStyle = '#8a8178';
    g.fillRect(0, 0, S, S);
    const rows = 10;
    const bh = S / rows;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? bh * 1.2 : 0;
      for (let x = -off; x < S; x += bh * 2.4) {
        g.fillStyle = hsl(14 + rng.range(-4, 5), 50 + rng.range(-8, 8), 38 + rng.range(-7, 6));
        g.fillRect(x + 2, r * bh + 2, bh * 2.4 - 4, bh - 4);
      }
    }
    noise(g, S, S, rng, 9000, 0.08);
    return toTexture(c);
  });
}

/** Pañete pintado (se tiñe con el color del vértice). */
export function paneteTex() {
  return once('panete', () => {
    const S = TEX_LADO;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    const rng = makeRng(9);
    g.fillStyle = '#e8e6e2';
    g.fillRect(0, 0, S, S);
    stains(g, S, S, rng, 30, '0,0,0', 0.06);
    noise(g, S, S, rng, 12000, 0.04, 2);
    return toTexture(c);
  });
}

/** Baldosa (cuadrícula de juntas); colors: lista de colores de baldosa; n: baldosas por lado. */
export function baldosaTex(colors = ['#b84c32', '#a9442c'], n = 4, key = 'baldosa') {
  return once(`${key}:${colors}`, () => {
    const S = TEX_LADO;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    const rng = makeRng(13);
    const t = S / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        g.fillStyle = colors[(i + j + (rng.chance(0.15) ? 1 : 0)) % colors.length];
        g.fillRect(i * t, j * t, t, t);
        stains(g, t, t, rng, 1, '0,0,0', 0.06);
      }
    g.strokeStyle = 'rgba(30,25,20,0.55)';
    g.lineWidth = 3;
    for (let k = 0; k <= n; k++) {
      g.beginPath();
      g.moveTo(k * t, 0);
      g.lineTo(k * t, S);
      g.moveTo(0, k * t);
      g.lineTo(S, k * t);
      g.stroke();
    }
    noise(g, S, S, rng, 6000, 0.05);
    return toTexture(c);
  });
}

/** Cuero acolchado de los sofás (capitoné). */
export function cueroTex() {
  return once('cuero', () => {
    const S = 256;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    const rng = makeRng(21);
    g.fillStyle = '#d8d8d8';
    g.fillRect(0, 0, S, S);
    const n = 4;
    for (let i = 0; i <= n; i++)
      for (let j = 0; j <= n; j++) {
        const x = (i + (j % 2) * 0.5) * (S / n);
        const y = j * (S / n);
        const gr = g.createRadialGradient(x, y, 0, x, y, S / n);
        gr.addColorStop(0, 'rgba(0,0,0,0.45)');
        gr.addColorStop(0.15, 'rgba(0,0,0,0.12)');
        gr.addColorStop(1, 'rgba(255,255,255,0.05)');
        g.fillStyle = gr;
        g.fillRect(x - S / n, y - S / n, (2 * S) / n, (2 * S) / n);
      }
    noise(g, S, S, rng, 4000, 0.05);
    return toTexture(c);
  });
}

/** Terciopelo rojo (cortina del vestíbulo y cordón de la fila). */
export function terciopeloTex() {
  return once('terciopelo', () => {
    const S = 256;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    for (let x = 0; x < S; x++) {
      const v = 0.55 + 0.45 * Math.sin((x / S) * Math.PI * 14) ** 2;
      g.fillStyle = `rgb(${Math.round(120 * v)},${Math.round(8 * v)},${Math.round(22 * v)})`;
      g.fillRect(x, 0, 1, S);
    }
    return toTexture(c);
  });
}

/** Lámina de la cortina metálica (estrías horizontales). */
export function cortinaTex() {
  return once('cortina', () => {
    const S = 128;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    for (let y = 0; y < S; y++) {
      const v = 150 + 60 * Math.sin((y / S) * Math.PI * 16);
      g.fillStyle = `rgb(${v},${v + 3},${v + 6})`;
      g.fillRect(0, y, S, 1);
    }
    noise(g, S, S, makeRng(4), 1500, 0.08);
    return toTexture(c);
  });
}

/** Atlas de afiches de orquestas inventadas (4×2): tipografía y siluetas de instrumentos, sin personas. */
export function afichesTex() {
  return once('afiches', () => {
    const W = 256;
    const H = 360;
    const c = canvas(W * 4, H * 2);
    const g = c.getContext('2d');
    const rng = makeRng(1992);
    const pal = [['#f4d35e', '#0d3b66', '#ee964b'], ['#ff595e', '#1d1d1d', '#ffca3a'], ['#06d6a0', '#073b4c', '#ffd166'], ['#ef476f', '#f8f1e5', '#118ab2'], ['#f77f00', '#003049', '#fcbf49'], ['#9b5de5', '#f15bb5', '#fee440'], ['#2ec4b6', '#011627', '#ff9f1c'], ['#e63946', '#f1faee', '#457b9d']];
    ORQUESTAS.forEach((name, i) => {
      const ox = (i % 4) * W;
      const oy = Math.floor(i / 4) * H;
      const [a, b, k] = pal[i % pal.length];
      g.fillStyle = b;
      g.fillRect(ox, oy, W, H);
      // Rayos de sol detrás.
      g.save();
      g.translate(ox + W / 2, oy + H * 0.42);
      for (let r = 0; r < 16; r++) {
        g.rotate(Math.PI / 8);
        g.fillStyle = r % 2 ? a : k;
        g.globalAlpha = 0.5;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(W, -30);
        g.lineTo(W, 30);
        g.fill();
      }
      g.restore();
      g.globalAlpha = 1;
      // Silueta: trompeta, conga o maracas.
      g.fillStyle = b;
      g.strokeStyle = b;
      g.lineWidth = 10;
      const cx = ox + W / 2;
      const cy = oy + H * 0.42;
      const kind = i % 3;
      if (kind === 0) {
        g.beginPath();
        g.moveTo(cx - 80, cy + 10);
        g.lineTo(cx + 40, cy + 10);
        g.stroke();
        g.beginPath();
        g.moveTo(cx + 40, cy + 10);
        g.lineTo(cx + 85, cy - 25);
        g.lineTo(cx + 85, cy + 45);
        g.closePath();
        g.fill();
        g.fillRect(cx - 30, cy - 18, 12, 28);
        g.fillRect(cx - 10, cy - 18, 12, 28);
        g.fillRect(cx + 10, cy - 18, 12, 28);
      } else if (kind === 1) {
        g.beginPath();
        g.ellipse(cx - 30, cy - 50, 34, 10, 0, 0, Math.PI * 2);
        g.ellipse(cx + 35, cy - 40, 30, 9, 0, 0, Math.PI * 2);
        g.fill();
        g.fillRect(cx - 62, cy - 50, 64, 120);
        g.fillRect(cx + 6, cy - 40, 58, 110);
      } else {
        for (const s of [-1, 1]) {
          g.beginPath();
          g.ellipse(cx + s * 35, cy - 20, 30, 38, s * 0.4, 0, Math.PI * 2);
          g.fill();
          g.save();
          g.translate(cx + s * 35, cy - 20);
          g.rotate(s * 0.4);
          g.fillRect(-5, 30, 10, 70);
          g.restore();
        }
      }
      // Letras.
      g.fillStyle = a;
      g.textAlign = 'center';
      g.font = 'bold 30px "Segoe UI", Arial, sans-serif';
      const words = name.split(' ');
      const mid = Math.ceil(words.length / 2);
      g.fillText(words.slice(0, mid).join(' '), cx, oy + H * 0.78);
      g.fillText(words.slice(mid).join(' '), cx, oy + H * 0.78 + 34);
      g.font = 'bold 18px "Segoe UI", Arial, sans-serif';
      g.fillStyle = k;
      g.fillText(`SÁBADO ${rng.int(1, 28)} · 10 P.M.`, cx, oy + H * 0.96);
      g.strokeStyle = a;
      g.lineWidth = 6;
      g.strokeRect(ox + 8, oy + 8, W - 16, H - 16);
    });
    noise(g, c.width, c.height, rng, 20000, 0.06);
    return toTexture(c);
  });
}

/** Acetato (disco de vinilo) con su etiqueta de color: 4 variantes en fila. */
export function acetatoTex() {
  return once('acetato', () => {
    const S = 256;
    const c = canvas(S * 4, S);
    const g = c.getContext('2d');
    const labels = ['#e63946', '#f4a261', '#2a9d8f', '#e9c46a'];
    for (let k = 0; k < 4; k++) {
      const cx = k * S + S / 2;
      const cy = S / 2;
      g.fillStyle = '#0b0b0d';
      g.beginPath();
      g.arc(cx, cy, S / 2 - 2, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.07)';
      for (let r = S * 0.2; r < S / 2 - 4; r += 3) {
        g.beginPath();
        g.arc(cx, cy, r, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = labels[k];
      g.beginPath();
      g.arc(cx, cy, S * 0.17, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#111';
      g.beginPath();
      g.arc(cx, cy, 5, 0, Math.PI * 2);
      g.fill();
    }
    return toTexture(c, { repeat: false });
  });
}

/** Fotos enmarcadas genéricas (4 en fila, tono sepia): palmas, un carro viejo, el mar y una calle; sin personas. */
export function fotosTex() {
  return once('fotos', () => {
    const W = 256;
    const H = 200;
    const c = canvas(W * 4, H);
    const g = c.getContext('2d');
    const rng = makeRng(53);
    for (let k = 0; k < 4; k++) {
      const ox = k * W;
      g.fillStyle = '#3b2a1a';
      g.fillRect(ox, 0, W, H);
      g.fillStyle = '#d9c7a3';
      g.fillRect(ox + 14, 14, W - 28, H - 28);
      const gr = g.createLinearGradient(0, 14, 0, H - 14);
      gr.addColorStop(0, '#e8d5ae');
      gr.addColorStop(1, '#a88f63');
      g.fillStyle = gr;
      g.fillRect(ox + 22, 22, W - 44, H - 44);
      g.fillStyle = '#5a4630';
      g.strokeStyle = '#5a4630';
      if (k === 0) {
        for (const px of [70, 150, 200]) {
          g.lineWidth = 6;
          g.beginPath();
          g.moveTo(ox + px, H - 30);
          g.quadraticCurveTo(ox + px + 10, 90, ox + px - 4, 60);
          g.stroke();
          for (let a = 0; a < 7; a++) {
            g.beginPath();
            g.ellipse(ox + px - 4, 60, 34, 7, (a * Math.PI) / 7, 0, Math.PI * 2);
            g.fill();
          }
        }
      } else if (k === 1) {
        g.fillRect(ox + 50, 110, 150, 36);
        g.fillRect(ox + 80, 86, 80, 30);
        g.fillStyle = '#2b2016';
        g.beginPath();
        g.arc(ox + 85, 148, 14, 0, Math.PI * 2);
        g.arc(ox + 170, 148, 14, 0, Math.PI * 2);
        g.fill();
      } else if (k === 2) {
        g.fillRect(ox + 22, 120, W - 44, 58);
        g.fillStyle = '#7a6448';
        for (let i = 0; i < 6; i++) g.fillRect(ox + 30 + rng.range(0, 180), 128 + i * 8, rng.range(20, 60), 2);
        g.fillStyle = '#f2e3c2';
        g.beginPath();
        g.arc(ox + 180, 70, 18, 0, Math.PI * 2);
        g.fill();
      } else {
        for (let i = 0; i < 5; i++) {
          g.fillStyle = i % 2 ? '#6b5538' : '#7d6646';
          g.fillRect(ox + 24 + i * 42, 60 + rng.range(0, 30), 40, 120);
          g.fillStyle = '#3e2f1f';
          g.fillRect(ox + 36 + i * 42, 120, 12, 22);
        }
      }
      noise(g, W, H, rng, 1500, 0.08);
    }
    return toTexture(c, { repeat: false });
  });
}

/** Pintura de la chiva: franjas de colores y adornos (frente y costados). */
export function chivaTex() {
  return once('chiva', () => {
    const W = 512;
    const H = 256;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    const cols = ['#e63946', '#ffd60a', '#2a9d8f', '#1d4ed8', '#f77f00', '#38b000'];
    const bands = 9;
    for (let i = 0; i < bands; i++) {
      g.fillStyle = cols[i % cols.length];
      g.fillRect(0, (i * H) / bands, W, H / bands + 1);
      // Rombos y ondas pintadas a mano.
      g.fillStyle = cols[(i + 3) % cols.length];
      for (let x = 10; x < W; x += 36) {
        const y = ((i + 0.5) * H) / bands;
        g.beginPath();
        g.moveTo(x, y - 6);
        g.lineTo(x + 8, y);
        g.lineTo(x, y + 6);
        g.lineTo(x - 8, y);
        g.fill();
      }
    }
    g.fillStyle = '#ffffff';
    g.font = 'bold 34px "Segoe UI", Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('LA RUANA', W / 2, H * 0.58);
    return toTexture(c);
  });
}

/** Aviso de neón pintado (fondo negro, tubo de color con su halo). */
export function neonTex(text, color = '#ff2bd6', key = text) {
  return once(`neon:${key}:${color}`, () => {
    const W = 512;
    const H = 160;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 76;
    g.font = `bold ${size}px "Segoe UI", Arial, sans-serif`;
    while (g.measureText(text).width > W - 50 && size > 24) {
      size -= 3;
      g.font = `bold ${size}px "Segoe UI", Arial, sans-serif`;
    }
    for (const [blur, a] of [[26, 0.9], [10, 1]]) {
      g.shadowColor = color;
      g.shadowBlur = blur;
      g.fillStyle = color;
      g.globalAlpha = a;
      g.fillText(text, W / 2, H / 2);
    }
    g.shadowBlur = 0;
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillText(text, W / 2, H / 2 - 1);
    return toTexture(c, { repeat: false });
  });
}

/** Letreros de los baños (Damas / Caballeros), en fila. */
export function banosTex() {
  return once('banos', () => {
    const W = 256;
    const H = 128;
    const c = canvas(W * 2, H);
    const g = c.getContext('2d');
    ['DAMAS', 'CABALLEROS'].forEach((t, k) => {
      g.fillStyle = '#1b1b1f';
      g.fillRect(k * W, 0, W, H);
      g.fillStyle = k ? '#58a6ff' : '#ff7eb6';
      g.font = 'bold 34px "Segoe UI", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(t, k * W + W / 2, H * 0.68);
      // Figura (círculo y cuerpo).
      g.beginPath();
      g.arc(k * W + W / 2, H * 0.24, 12, 0, Math.PI * 2);
      g.fill();
    });
    return toTexture(c, { repeat: false });
  });
}

/** Nombre del local para la pantalla LED (blanco sobre negro; el shader lo colorea). */
export function nombreTex(name) {
  return once(`nombre:${name}`, () => {
    const W = 1024;
    const H = 256;
    const c = canvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 150;
    const t = name.replace(/^(Discoteca|Salsoteca|Bar|Fonda) /, '').toUpperCase();
    g.font = `900 ${size}px "Segoe UI", Arial, sans-serif`;
    while (g.measureText(t).width > W - 60 && size > 40) {
      size -= 6;
      g.font = `900 ${size}px "Segoe UI", Arial, sans-serif`;
    }
    g.fillText(t, W / 2, H / 2);
    const tex = toTexture(c, { repeat: false });
    tex.colorSpace = THREE.NoColorSpace;
    return tex;
  });
}

/** Ruido suave para el humo y la neblina (gris sobre negro, para mezcla aditiva). */
export function humoTex() {
  return once('humo', () => {
    const S = 256;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    const rng = makeRng(808);
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 60; i++) {
      const x = rng.range(0, S);
      const y = rng.range(0, S);
      const r = rng.range(20, 70);
      for (const [dx, dy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
        const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        gr.addColorStop(0, `rgba(255,255,255,${rng.range(0.05, 0.16)})`);
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
    return toTexture(c, { srgb: false });
  });
}

/** Hoja de palma o planta (con transparencia) para las materas. */
export function hojaTex() {
  return once('hoja', () => {
    const S = 256;
    const c = canvas(S, S);
    const g = c.getContext('2d');
    g.clearRect(0, 0, S, S);
    g.strokeStyle = '#2f6b2a';
    g.fillStyle = '#3f8f36';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(S / 2, S);
    g.quadraticCurveTo(S / 2 + 10, S / 2, S / 2, 8);
    g.stroke();
    for (let k = 0; k < 14; k++) {
      const t = 0.12 + (k / 14) * 0.85;
      const y = S - t * (S - 8);
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(S / 2, y);
        g.quadraticCurveTo(S / 2 + s * 60 * (1 - t * 0.6), y - 12, S / 2 + s * 110 * (1 - t * 0.7), y + 14);
        g.lineTo(S / 2 + s * 100 * (1 - t * 0.7), y + 20);
        g.quadraticCurveTo(S / 2 + s * 50, y + 4, S / 2, y + 6);
        g.fill();
      }
    }
    const t = toTexture(c, { repeat: false });
    return t;
  });
}

// ------------------------------------------------------------------ comercios
// Atlas de los comercios a los que se entra (render/localInteriors.js): una
// sola textura para muros, pisos, maderas, acero, telas, bultos, menús
// pintados, el altar, el televisor, avisos y el espejo, así cada local se
// dibuja con muy pocas mallas. Casillas de CASILLA px; los menús y avisos
// ocupan dos casillas de ancho (no se estira la letra).

/** Lado (px) de cada casilla del atlas de los comercios. */
export const CASILLA = 256;
/** Casillas del atlas: nombre -> [columna, fila, ancho en casillas]. */
export const COMERCIO_CASILLAS = {
  blanco: [0, 0], panete: [1, 0], baldosaPared: [2, 0], madera: [3, 0], maderaOscura: [4, 0], acero: [5, 0], carton: [6, 0], bulto: [7, 0],
  menuPapas: [0, 1, 2], menuGranizados: [2, 1, 2], menuPanaderia: [4, 1, 2], menuComidas: [6, 1, 2],
  ruana: [0, 2], poncho: [1, 2], cuadros: [2, 2], mezclilla: [3, 2], cortina: [4, 2], espejo: [5, 2], panela: [6, 2], cuero: [7, 2],
  canasta: [0, 3], cruz: [1, 3], fotocopiadora: [2, 3], horno: [3, 3], zapatos: [4, 3], tela: [5, 3], altar: [6, 3], tv: [7, 3],
  afiche: [0, 4, 2], aficheMinutos: [2, 4, 2], pisoMadera: [4, 4], calendario: [5, 4], baldosaBlanca: [6, 4], granito: [7, 4],
};
const AT_W = CASILLA * 8;
const AT_H = CASILLA * 5;

/** Rectángulos UV [u0, v0, u1, v1] de las casillas (con margen contra el sangrado de los mipmaps). */
export const COMERCIO_UV = (() => {
  const out = {};
  const pad = 3;
  for (const [k, [c, r, w = 1]] of Object.entries(COMERCIO_CASILLAS)) {
    const px = c * CASILLA;
    const py = r * CASILLA;
    out[k] = [(px + pad) / AT_W, 1 - (py + CASILLA - pad) / AT_H, (px + w * CASILLA - pad) / AT_W, 1 - (py + pad) / AT_H];
  }
  return out;
})();

/** Texto centrado que se achica hasta caber en `maxW`. */
function texto(g, s, x, y, maxW, px, font = 'bold', color = '#fff') {
  let size = px;
  g.font = `${font} ${size}px "Segoe UI", Arial, sans-serif`;
  while (g.measureText(s).width > maxW && size > 8) {
    size -= 1;
    g.font = `${font} ${size}px "Segoe UI", Arial, sans-serif`;
  }
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}

/** Tablero de menú pintado: título y renglones "nombre ... $precio" (sin marcas). */
function menuTablero(g, w, h, rng, { fondo, titulo, items, tinta, acento }) {
  g.fillStyle = fondo;
  g.fillRect(0, 0, w, h);
  stains(g, w, h, rng, 10, '255,255,255', 0.05);
  g.strokeStyle = acento;
  g.lineWidth = 6;
  g.strokeRect(8, 8, w - 16, h - 16);
  texto(g, titulo, w / 2, 36, w - 60, 34, 'bold', acento);
  const n = Math.max(1, items.length);
  const top = 70;
  const step = Math.min(44, (h - top - 16) / n);
  items.forEach((it, k) => {
    const y = top + step * (k + 0.5);
    g.font = `bold ${Math.round(step * 0.58)}px "Segoe UI", Arial, sans-serif`;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = tinta;
    g.fillText(it.name, 30, y);
    g.textAlign = 'right';
    g.fillStyle = acento;
    g.fillText('$' + it.price, w - 30, y);
    // Puntos guía entre el nombre y el precio.
    g.fillStyle = 'rgba(255,255,255,0.25)';
    const x0 = 30 + g.measureText(it.name).width;
    for (let x = Math.max(x0 + 40, w * 0.5); x < w - 90; x += 12) g.fillRect(x, y + 6, 3, 3);
  });
  noise(g, w, h, rng, 1500, 0.05);
}

/**
 * Atlas de los comercios (una vez; queda en caché). `menus`: renglones de
 * los tableros {menuPapas, menuGranizados, menuPanaderia, menuComidas: [{name, price}]}.
 */
export function comerciosAtlas(menus = {}) {
  return once('comercios', () => {
    const c = canvas(AT_W, AT_H);
    const g = c.getContext('2d');
    const rng = makeRng(9292);
    const S = CASILLA;
    const cell = (name, fn) => {
      const [cx, cy, w = 1] = COMERCIO_CASILLAS[name];
      g.save();
      g.beginPath();
      g.rect(cx * S, cy * S, w * S, S);
      g.clip();
      g.translate(cx * S, cy * S);
      fn(w * S, S);
      g.restore();
    };
    const fill = (col, x = 0, y = 0, w = S, h = S) => {
      g.fillStyle = col;
      g.fillRect(x, y, w, h);
    };
    cell('blanco', () => fill('#ffffff'));
    cell('panete', () => {
      fill('#f1eee7');
      stains(g, S, S, rng, 14, '0,0,0', 0.05);
      noise(g, S, S, rng, 5000, 0.04, 2);
    });
    const baldosas = (base, n, junta) => {
      const t = S / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          g.fillStyle = `hsl(${base[0]},${base[1]}%,${base[2] + rng.range(-2.5, 2.5)}%)`;
          g.fillRect(i * t, j * t, t, t);
          // Brillo del esmalte.
          const gr = g.createLinearGradient(i * t, j * t, i * t + t, j * t + t);
          gr.addColorStop(0, 'rgba(255,255,255,0.18)');
          gr.addColorStop(0.5, 'rgba(255,255,255,0)');
          g.fillStyle = gr;
          g.fillRect(i * t, j * t, t, t);
        }
      g.strokeStyle = junta;
      g.lineWidth = 3;
      for (let k = 0; k <= n; k++) {
        g.beginPath();
        g.moveTo(k * t, 0);
        g.lineTo(k * t, S);
        g.moveTo(0, k * t);
        g.lineTo(S, k * t);
        g.stroke();
      }
    };
    cell('baldosaPared', () => baldosas([42, 45, 90], 4, 'rgba(120,110,95,0.6)'));
    cell('baldosaBlanca', () => baldosas([200, 10, 94], 4, 'rgba(110,120,130,0.55)'));
    const tablas = (tone, rows, dark = 0.45) => {
      for (let r = 0; r < rows; r++) {
        const y = (r * S) / rows;
        let x = -rng.range(0, S * 0.5);
        while (x < S) {
          const w = S * rng.range(0.4, 0.9);
          g.fillStyle = `hsl(${tone[0] + rng.range(-4, 4)},${tone[1] + rng.range(-6, 6)}%,${tone[2] + rng.range(-5, 5)}%)`;
          g.fillRect(x, y, w, S / rows);
          g.strokeStyle = `hsla(${tone[0]},${tone[1]}%,${tone[2] - 12}%,0.35)`;
          g.lineWidth = 1;
          for (let k = 0; k < 5; k++) {
            const yy = y + rng.range(2, S / rows - 2);
            g.beginPath();
            g.moveTo(x, yy);
            g.bezierCurveTo(x + w * 0.3, yy + rng.range(-3, 3), x + w * 0.6, yy + rng.range(-3, 3), x + w, yy);
            g.stroke();
          }
          g.fillStyle = `rgba(0,0,0,${dark})`;
          g.fillRect(x, y, 2, S / rows);
          x += w;
        }
        g.fillStyle = `rgba(0,0,0,${dark})`;
        g.fillRect(0, y, S, 2);
      }
      noise(g, S, S, rng, 2500, 0.05);
    };
    cell('madera', () => tablas([30, 48, 40], 6));
    cell('maderaOscura', () => tablas([24, 42, 22], 6, 0.6));
    cell('pisoMadera', () => tablas([32, 40, 44], 4, 0.4));
    cell('acero', () => {
      fill('#c8ccd1');
      for (let y = 0; y < S; y += 2) {
        g.fillStyle = `rgba(${rng.chance(0.5) ? '255,255,255' : '0,0,0'},${rng.range(0.02, 0.08)})`;
        g.fillRect(0, y, S, 1);
      }
      const gr = g.createLinearGradient(0, 0, S, S);
      gr.addColorStop(0, 'rgba(255,255,255,0.25)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0)');
      gr.addColorStop(1, 'rgba(0,0,0,0.12)');
      g.fillStyle = gr;
      g.fillRect(0, 0, S, S);
    });
    cell('carton', () => {
      fill('#b98d5c');
      noise(g, S, S, rng, 4000, 0.06, 2);
      fill('rgba(230,220,190,0.75)', 0, S * 0.44, S, S * 0.12);
      g.strokeStyle = 'rgba(80,50,20,0.35)';
      g.lineWidth = 3;
      g.strokeRect(4, 4, S - 8, S - 8);
    });
    // Costal de fique con su estampa (sin marca).
    cell('bulto', () => {
      fill('#b59a68');
      g.strokeStyle = 'rgba(90,65,30,0.35)';
      g.lineWidth = 2;
      for (let k = 0; k < S; k += 6) {
        g.beginPath();
        g.moveTo(k, 0);
        g.lineTo(k, S);
        g.stroke();
        g.beginPath();
        g.moveTo(0, k + 3);
        g.lineTo(S, k + 3);
        g.stroke();
      }
      noise(g, S, S, rng, 3000, 0.08, 2);
      texto(g, 'PAPA', S / 2, S * 0.45, S * 0.7, 54, 'bold', 'rgba(150,30,25,0.55)');
      texto(g, 'CAPIRA · 50 kg', S / 2, S * 0.62, S * 0.8, 22, 'bold', 'rgba(150,30,25,0.45)');
    });
    // Menús pintados (dos casillas de ancho).
    cell('menuPapas', (w, h) => menuTablero(g, w, h, rng, { fondo: '#1d2a22', titulo: 'MENÚ', items: menus.menuPapas ?? [], tinta: '#f5f1e6', acento: '#ffd23f' }));
    cell('menuGranizados', (w, h) => menuTablero(g, w, h, rng, { fondo: '#e8457a', titulo: 'GRANIZADOS Y MÁS', items: menus.menuGranizados ?? [], tinta: '#ffffff', acento: '#fff27a' }));
    cell('menuPanaderia', (w, h) => menuTablero(g, w, h, rng, { fondo: '#5a3418', titulo: 'RECIÉN HORNEADO', items: menus.menuPanaderia ?? [], tinta: '#fff3d6', acento: '#ffc14d' }));
    cell('menuComidas', (w, h) => menuTablero(g, w, h, rng, { fondo: '#16324f', titulo: 'HOY HAY', items: menus.menuComidas ?? [], tinta: '#ffffff', acento: '#ffb347' }));
    // Telas (se tiñen con el color del vértice o de la instancia).
    const rayas = (base, cols, ancho, cada) => {
      fill(base);
      for (let k = 0; k < S; k += cada) {
        g.fillStyle = cols[(k / cada) % cols.length];
        g.fillRect(k, 0, ancho, S);
      }
      noise(g, S, S, rng, 6000, 0.06, 2);
    };
    cell('ruana', () => {
      rayas('#8a8178', ['#6d655d', '#a59b8f', '#5b534c'], 5, 14);
      for (let x = 0; x < S; x += 5) fill('rgba(60,52,45,0.8)', x, S - 18, 2, 18); // flecos
    });
    cell('poncho', () => {
      fill('#f2ecdc');
      noise(g, S, S, rng, 6000, 0.05, 2);
      for (const y of [S * 0.72, S * 0.8]) fill('#222', 0, y, S, 9);
      for (let x = 0; x < S; x += 5) fill('rgba(230,222,200,0.95)', x, S - 14, 2, 14);
    });
    cell('cuadros', () => {
      fill('#efe6d2');
      for (let k = 0; k < S; k += 32) {
        fill('rgba(170,40,32,0.75)', k, 0, 14, S);
        fill('rgba(170,40,32,0.55)', 0, k, S, 14);
        fill('rgba(40,40,60,0.35)', k + 20, 0, 3, S);
      }
      noise(g, S, S, rng, 4000, 0.05, 2);
    });
    cell('mezclilla', () => {
      fill('#3c5a86');
      g.strokeStyle = 'rgba(255,255,255,0.12)';
      g.lineWidth = 2;
      for (let k = -S; k < S; k += 5) {
        g.beginPath();
        g.moveTo(k, S);
        g.lineTo(k + S, 0);
        g.stroke();
      }
      noise(g, S, S, rng, 6000, 0.08, 2);
    });
    cell('tela', () => {
      fill('#e9e9e9');
      g.strokeStyle = 'rgba(0,0,0,0.06)';
      for (let k = 0; k < S; k += 3) {
        g.beginPath();
        g.moveTo(k, 0);
        g.lineTo(k, S);
        g.stroke();
      }
      noise(g, S, S, rng, 5000, 0.05, 2);
      // Costura del cuello y bolsillo (camisas y camisetas).
      g.strokeStyle = 'rgba(0,0,0,0.18)';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(S / 2, 0, S * 0.16, 0, Math.PI);
      g.stroke();
      g.strokeRect(S * 0.62, S * 0.3, S * 0.18, S * 0.16);
    });
    cell('cortina', () => {
      for (let x = 0; x < S; x++) {
        const k = 0.6 + 0.4 * Math.sin((x / S) * Math.PI * 10);
        g.fillStyle = `rgb(${Math.round(120 * k + 20)},${Math.round(18 * k)},${Math.round(30 * k + 6)})`;
        g.fillRect(x, 0, 1, S);
      }
      noise(g, S, S, rng, 3000, 0.05, 2);
    });
    // Espejo: reflejo difuso (manchas de color del local) y vetas de luz.
    cell('espejo', () => {
      const gr = g.createLinearGradient(0, 0, 0, S);
      gr.addColorStop(0, '#c9d3da');
      gr.addColorStop(1, '#8d98a2');
      g.fillStyle = gr;
      g.fillRect(0, 0, S, S);
      for (let k = 0; k < 7; k++) {
        const x = rng.range(0, S);
        const y = rng.range(S * 0.3, S);
        const rr = rng.range(20, 60);
        const rg = g.createRadialGradient(x, y, 0, x, y, rr);
        rg.addColorStop(0, `hsla(${Math.round(rng.range(0, 360))},40%,60%,0.25)`);
        rg.addColorStop(1, 'hsla(0,0%,50%,0)');
        g.fillStyle = rg;
        g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
      }
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.beginPath();
      g.moveTo(S * 0.15, 0);
      g.lineTo(S * 0.28, 0);
      g.lineTo(S * 0.05, S);
      g.lineTo(-S * 0.08, S);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.beginPath();
      g.moveTo(S * 0.4, 0);
      g.lineTo(S * 0.46, 0);
      g.lineTo(S * 0.23, S);
      g.lineTo(S * 0.17, S);
      g.fill();
    });
    cell('panela', () => {
      fill('#6e4a22');
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 3; i++) {
          const x = i * (S / 3) + 6;
          const y = j * (S / 4) + 6;
          g.fillStyle = `hsl(${28 + rng.range(-3, 3)},${55 + rng.range(-6, 6)}%,${30 + rng.range(-4, 4)}%)`;
          g.fillRect(x, y, S / 3 - 12, S / 4 - 12);
          g.fillStyle = 'rgba(210,190,120,0.35)';
          g.fillRect(x + 4, y + 4, S / 3 - 20, 5);
        }
      noise(g, S, S, rng, 2000, 0.06, 2);
    });
    cell('cuero', () => {
      fill('#7a4a24');
      stains(g, S, S, rng, 20, '0,0,0', 0.2);
      noise(g, S, S, rng, 6000, 0.06, 2);
      g.setLineDash([8, 6]);
      g.strokeStyle = 'rgba(230,200,150,0.6)';
      g.lineWidth = 2;
      g.strokeRect(14, 14, S - 28, S - 28);
      g.setLineDash([]);
    });
    // Canasta de cerveza (plástico neutro con huecos: la tiñe el color del vértice).
    cell('canasta', () => {
      fill('#e2e2e2');
      for (let j = 0; j < 3; j++) for (let i = 0; i < 6; i++) fill('rgba(30,30,30,0.85)', 12 + i * 40, 40 + j * 62, 26, 40);
      fill('rgba(0,0,0,0.2)', 0, 0, S, 18);
      fill('rgba(255,255,255,0.4)', 0, S - 22, S, 6);
    });
    cell('cruz', () => {
      fill('#ffffff');
      g.fillStyle = '#12a14a';
      g.fillRect(S * 0.38, S * 0.08, S * 0.24, S * 0.6);
      g.fillRect(S * 0.2, S * 0.26, S * 0.6, S * 0.24);
      texto(g, 'DROGUERÍA', S / 2, S * 0.85, S * 0.92, 40, 'bold', '#0b7a3b');
    });
    cell('fotocopiadora', () => {
      fill('#d9dbdd');
      fill('#b8bcc0', 0, S * 0.55, S, 6);
      fill('#2e3a44', S * 0.08, S * 0.12, S * 0.34, S * 0.2);
      fill('#7fd4ff', S * 0.11, S * 0.15, S * 0.28, S * 0.14);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) fill(i === 3 && j === 2 ? '#2ec27e' : '#555', S * 0.55 + i * 22, S * 0.12 + j * 18, 16, 12);
      fill('#c5c8cb', S * 0.1, S * 0.62, S * 0.8, S * 0.3);
      fill('#9ea2a6', S * 0.12, S * 0.75, S * 0.76, 4);
    });
    cell('horno', () => {
      fill('#a9adb2');
      fill('#22262a', S * 0.12, S * 0.18, S * 0.76, S * 0.5);
      const gr = g.createRadialGradient(S / 2, S * 0.45, 4, S / 2, S * 0.45, S * 0.45);
      gr.addColorStop(0, 'rgba(255,170,60,0.95)');
      gr.addColorStop(1, 'rgba(120,40,10,0.4)');
      g.fillStyle = gr;
      g.fillRect(S * 0.14, S * 0.2, S * 0.72, S * 0.46);
      for (const y of [0.32, 0.5]) fill('rgba(60,30,10,0.7)', S * 0.16, S * y, S * 0.68, 5);
      for (let i = 0; i < 5; i++) fill('#d9a55a', S * (0.2 + i * 0.12), S * 0.27, 18, 12);
      fill('#5c6066', S * 0.1, S * 0.74, S * 0.8, 10);
      for (let i = 0; i < 3; i++) fill('#222', S * (0.25 + i * 0.22), S * 0.84, 18, 18);
    });
    cell('zapatos', () => {
      fill('#ece9e3');
      for (let j = 0; j < 4; j++) {
        fill('#9a9590', 0, (j + 1) * (S / 4) - 6, S, 6);
        for (let i = 0; i < 4; i++) {
          const x = 10 + i * 62;
          const y = (j + 1) * (S / 4) - 30;
          g.fillStyle = rng.pick(['#f2f2f2', '#111', '#c62828', '#1565c0', '#2e7d32', '#ffb300']);
          g.beginPath();
          g.ellipse(x + 24, y + 12, 24, 11, 0, 0, Math.PI * 2);
          g.fill();
          fill('#fff', x + 2, y + 18, 46, 6);
          fill('rgba(0,0,0,0.3)', x + 30, y + 6, 10, 4);
        }
      }
    });
    // Altar: imagen enmarcada de la Virgen (manto azul, aureola) con rosas.
    cell('altar', () => {
      const gr = g.createLinearGradient(0, 0, 0, S);
      gr.addColorStop(0, '#fdf3d8');
      gr.addColorStop(1, '#e9c98a');
      g.fillStyle = gr;
      g.fillRect(0, 0, S, S);
      g.strokeStyle = 'rgba(255,220,120,0.6)';
      g.lineWidth = 3;
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        g.beginPath();
        g.moveTo(S / 2 + Math.cos(a) * 40, S * 0.3 + Math.sin(a) * 40);
        g.lineTo(S / 2 + Math.cos(a) * 110, S * 0.3 + Math.sin(a) * 110);
        g.stroke();
      }
      g.fillStyle = '#2f5fae';
      g.beginPath();
      g.moveTo(S / 2, S * 0.2);
      g.lineTo(S * 0.82, S * 0.92);
      g.lineTo(S * 0.18, S * 0.92);
      g.fill();
      g.fillStyle = '#f4efe6';
      g.beginPath();
      g.moveTo(S / 2, S * 0.36);
      g.lineTo(S * 0.62, S * 0.9);
      g.lineTo(S * 0.38, S * 0.9);
      g.fill();
      g.fillStyle = '#e8c4a0';
      g.beginPath();
      g.arc(S / 2, S * 0.28, 22, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#e0b030';
      g.lineWidth = 5;
      g.beginPath();
      g.arc(S / 2, S * 0.26, 34, 0, Math.PI * 2);
      g.stroke();
      for (let k = 0; k < 7; k++) {
        g.fillStyle = rng.pick(['#c62828', '#e53935', '#f06292', '#ffffff']);
        g.beginPath();
        g.arc(S * (0.12 + k * 0.125), S * 0.94, 13, 0, Math.PI * 2);
        g.fill();
      }
    });
    // Televisor: partido de fútbol genérico (cancha, jugadores y marcador sin marcas).
    cell('tv', () => {
      for (let k = 0; k < 8; k++) fill(k % 2 ? '#2f8f3a' : '#34a043', 0, (k * S) / 8, S, S / 8);
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(S / 2, 20);
      g.lineTo(S / 2, S);
      g.stroke();
      g.beginPath();
      g.arc(S / 2, S * 0.6, 34, 0, Math.PI * 2);
      g.stroke();
      for (let k = 0; k < 9; k++) {
        g.fillStyle = k % 2 ? '#e53935' : '#fdd835';
        g.beginPath();
        g.arc(rng.range(20, S - 20), rng.range(50, S - 20), 6, 0, Math.PI * 2);
        g.fill();
      }
      fill('rgba(10,20,40,0.85)', 8, 8, 120, 26);
      texto(g, 'LOC 1 - 0 VIS', 68, 21, 110, 16, 'bold', '#fff');
    });
    cell('calendario', () => {
      fill('#ffffff');
      const gr = g.createLinearGradient(0, 0, 0, S * 0.5);
      gr.addColorStop(0, '#7ec8e3');
      gr.addColorStop(1, '#3f9b4a');
      g.fillStyle = gr;
      g.fillRect(10, 10, S - 20, S * 0.45);
      for (let j = 0; j < 5; j++) for (let i = 0; i < 7; i++) fill(i === 0 ? '#c62828' : '#555', 18 + i * 32, S * 0.55 + j * 22, 18, 12);
    });
    cell('afiche', (w, h) => {
      fill('#ffe14d', 0, 0, w, h);
      noise(g, w, h, rng, 2000, 0.05, 2);
      texto(g, 'HAY HIELO · HAY MINUTOS', w / 2, h * 0.36, w - 40, 54, 'bold', '#b3121e');
      texto(g, 'RECARGAS · SE FÍA SOLO A CONOCIDOS', w / 2, h * 0.72, w - 40, 30, 'bold', '#1b2a5a');
    });
    cell('aficheMinutos', (w, h) => {
      fill('#1f4fa3', 0, 0, w, h);
      texto(g, 'MINUTOS · FOTOCOPIAS', w / 2, h * 0.36, w - 40, 56, 'bold', '#ffffff');
      texto(g, 'RECARGAS · ANILLADOS · IMPRESIONES', w / 2, h * 0.72, w - 40, 30, 'bold', '#ffe14d');
    });
    cell('granito', () => {
      fill('#a8a49c');
      for (let k = 0; k < 2600; k++) {
        const v = Math.round(rng.range(40, 230));
        g.fillStyle = `rgba(${v},${v},${Math.round(v * rng.range(0.9, 1))},0.6)`;
        g.fillRect(rng.next() * S, rng.next() * S, rng.range(1, 4), rng.range(1, 4));
      }
      g.strokeStyle = 'rgba(60,60,60,0.4)';
      g.lineWidth = 2;
      g.strokeRect(0, 0, S, S);
    });
    const t = toTexture(c, { repeat: false });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}
