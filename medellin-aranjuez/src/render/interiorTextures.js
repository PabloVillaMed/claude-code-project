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
