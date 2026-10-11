// Interiores de los locales del barrio vistos desde la calle: un atlas
// pintado en canvas (paredes del fondo y de los lados, pisos de baldosa,
// cielo raso con lámparas, frentes de vitrinas, góndolas, neveras) y las
// recetas de utilería 3D de cada tipo de negocio (mostrador con vitrina,
// canastas de cerveza, tiras de mecato, sillas de peluquería, mesa de billar,
// maniquíes y percheros de ropa...).
//
// Referencia visual: tiendas de barrio, panaderías, droguerías, barberías,
// ferreterías, papelerías, heladerías, cafeterías, billares y almacenes de
// ropa de Medellín (mostrador de madera o vidrio, "Hoy no fío, mañana sí",
// tubos fluorescentes, baldosa roja o granito, nevera de gaseosas al lado de
// la puerta, canastas plásticas apiladas). Todo pintado a mano en código,
// sin fotos ni marcas: los productos son formas y colores genéricos.
//
// La geometría la pone render/facadeBuilder.js con las funciones de `api`
// (cajas con color por vértice y cuadriláteros del atlas); el color por
// vértice mayor que 1 es luz propia (tubos, neveras, vitrinas iluminadas).

import * as THREE from 'three';
import { makeRng } from '../sim/rng.js';
import { ROPA } from '../sim/ropa.js';
import { canvas, toTexture } from './textures.js';

/** Tipos de interior (el de cada local sale de sim/facades.js). */
export const INTERIOR_KINDS = ['tienda', 'panaderia', 'drogueria', 'carniceria', 'fruteria', 'peluqueria', 'ferreteria', 'papeleria', 'heladeria', 'cafeteria', 'billares', 'ropa'];

// ------------------------------------------------------------------ atlas
const CS = 256; // píxeles por casilla
const COLS = 8;
const ROWS = 9;
const AW = CS * COLS;
const AH = CS * ROWS;
/** Metros que representa el ancho de una pared del fondo (se recorta según el local). */
export const BACK_M = 5.9;
/** Metros de fondo que representa una pared lateral. */
export const SIDE_M = 3.0;

// Casillas sueltas (filas 6 a 8).
const EXTRA = [
  'piso-rojo', 'piso-granito', 'piso-ajedrez', 'techo', 'nevera', 'tira-mecato', 'espejo', 'percha',
  'gondola-mecato', 'gondola-viveres', 'gondola-drogas', 'vitrina-pan', 'vitrina-carne', 'vitrina-helado', 'vitrina-comida', 'vitrina-dulces',
  'ropa-doblada', 'herramientas', 'pintura', 'cuadernos', 'botellas', 'gorras', 'tablero', 'canasta',
];

/** Rectángulo UV [u0, v0, u1, v1] de un rectángulo en píxeles (con margen contra el sangrado). */
function uvRect(px, py, pw, ph, inset = 2) {
  return [(px + inset) / AW, 1 - (py + ph - inset) / AH, (px + pw - inset) / AW, 1 - (py + inset) / AH];
}

/** Rectángulos del atlas: 'back:tienda', 'side:tienda', 'piso-rojo'... */
export const ATLAS = (() => {
  const r = {};
  INTERIOR_KINDS.forEach((k, i) => {
    r[`back:${k}`] = uvRect(((i % 4) * 2) * CS, Math.floor(i / 4) * CS, CS * 2, CS);
    r[`side:${k}`] = uvRect((i % 8) * CS, (4 + Math.floor(i / 8)) * CS, CS, CS);
  });
  EXTRA.forEach((n, i) => {
    r[n] = uvRect((i % 8) * CS, (6 + Math.floor(i / 8)) * CS, CS, CS);
  });
  return r;
})();

/** Pinta el atlas de interiores (una vez al arrancar). */
export function interiorAtlas() {
  const c = canvas(AW, AH);
  const ctx = c.getContext('2d');
  const rng = makeRng(7717);
  const P = painter(ctx, rng);
  INTERIOR_KINDS.forEach((k, i) => {
    P.cell(((i % 4) * 2) * CS, Math.floor(i / 4) * CS, CS * 2, CS, (w, h) => KIND_PAINT[k](P, w, h, false));
    P.cell((i % 8) * CS, (4 + Math.floor(i / 8)) * CS, CS, CS, (w, h) => KIND_PAINT[k](P, w, h, true));
  });
  EXTRA.forEach((n, i) => {
    P.cell((i % 8) * CS, (6 + Math.floor(i / 8)) * CS, CS, CS, (w, h) => EXTRA_PAINT[n](P, w, h));
  });
  const t = toTexture(c, { srgb: true, repeat: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ------------------------------------------------------------------ pinceles
const BRIGHT = ['#d62828', '#f4a261', '#2a9d8f', '#e9c46a', '#457b9d', '#8ac926', '#ff6f91', '#f1faee', '#6a4c93', '#f77f00', '#1d3557', '#ffd166', '#06d6a0', '#ef476f'];
const BOTTLES = ['#2d6a4f', '#7f4f24', '#bde0fe', '#d9ed92', '#9d0208', '#e6e6e6', '#355070', '#b08968'];

function painter(ctx, rng) {
  const P = {
    ctx,
    rng,
    cell(x, y, w, h, fn) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.translate(x, y);
      fn(w, h);
      ctx.restore();
    },
    fill(c, x, y, w, h) {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, h);
    },
    /** Pared con textura leve de pintura. */
    wall(c, w, h, speck = 0.05) {
      P.fill(c, 0, 0, w, h);
      for (let i = 0; i < (w * h) / 60; i++) {
        ctx.fillStyle = rng.chance(0.5) ? `rgba(0,0,0,${rng.range(0, speck)})` : `rgba(255,255,255,${rng.range(0, speck)})`;
        ctx.fillRect(rng.next() * w, rng.next() * h, rng.range(1, 3), rng.range(1, 3));
      }
    },
    /** Sombra de rincón: oscurece el borde de arriba, el de abajo y los lados. */
    ao(w, h, k = 0.3, sides = true) {
      const g1 = ctx.createLinearGradient(0, 0, 0, h);
      g1.addColorStop(0, `rgba(0,0,0,${k})`);
      g1.addColorStop(0.12, 'rgba(0,0,0,0)');
      g1.addColorStop(0.9, 'rgba(0,0,0,0)');
      g1.addColorStop(1, `rgba(0,0,0,${k * 0.8})`);
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, w, h);
      if (!sides) return;
      const g2 = ctx.createLinearGradient(0, 0, w, 0);
      g2.addColorStop(0, `rgba(0,0,0,${k * 0.7})`);
      g2.addColorStop(0.08, 'rgba(0,0,0,0)');
      g2.addColorStop(0.92, 'rgba(0,0,0,0)');
      g2.addColorStop(1, `rgba(0,0,0,${k * 0.7})`);
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, w, h);
    },
    /** Enchape de baldosín (cocina, carnicería) hasta la altura `y0`..`y1`. */
    tiles(x, y, w, h, c, s = 12, line = 'rgba(0,0,0,0.12)') {
      P.fill(c, x, y, w, h);
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      for (let yy = y; yy < y + h; yy += s) {
        ctx.beginPath();
        ctx.moveTo(x, yy + 0.5);
        ctx.lineTo(x + w, yy + 0.5);
        ctx.stroke();
      }
      for (let xx = x; xx < x + w; xx += s) {
        ctx.beginPath();
        ctx.moveTo(xx + 0.5, y);
        ctx.lineTo(xx + 0.5, y + h);
        ctx.stroke();
      }
    },
    text(t, x, y, size, color, align = 'center', font = 'bold') {
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.font = `${font} ${size}px "Segoe UI", Arial, sans-serif`;
      ctx.fillText(t, x, y);
    },
    /** Letrero de cartulina o lámina: fondo, borde y texto (varias líneas). */
    sign(x, y, w, h, bg, fg, lines, size = 12) {
      P.fill('rgba(0,0,0,0.25)', x + 2, y + 2, w, h);
      P.fill(bg, x, y, w, h);
      ctx.strokeStyle = fg;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 2.5, y + 2.5, w - 5, h - 5);
      lines.forEach((t, i) => P.text(t, x + w / 2, y + (h * (i + 0.5)) / lines.length, size, fg));
    },
    /** Estantes de `rows` pisos con productos (itemFn dibuja uno y devuelve su ancho). */
    shelves(x, y, w, h, rows, itemFn, board = '#7a5c3e', back = 'rgba(0,0,0,0.12)') {
      P.fill(back, x, y, w, h);
      const rh = h / rows;
      for (let r = 0; r < rows; r++) {
        const base = y + (r + 1) * rh - 4;
        let px = x + 3;
        while (px < x + w - 6) {
          const iw = itemFn(px, base, rh - 7, x + w - px - 3);
          if (iw <= 0) break;
          px += iw + rng.range(0.5, 2.5);
        }
        // Tabla del estante con su canto claro y la sombra de abajo.
        P.fill(board, x, base, w, 4);
        P.fill('rgba(255,255,255,0.25)', x, base, w, 1);
        P.fill('rgba(0,0,0,0.25)', x, base + 4, w, 3);
      }
      // Parales de los lados.
      P.fill(board, x - 3, y, 4, h);
      P.fill(board, x + w - 1, y, 4, h);
    },
    bottle(px, base, maxH, col) {
      const h = Math.min(maxH, rng.range(maxH * 0.7, maxH * 0.98));
      const w = Math.max(4, h * rng.range(0.22, 0.3));
      ctx.fillStyle = col;
      ctx.fillRect(px, base - h * 0.68, w, h * 0.68);
      ctx.fillRect(px + w * 0.32, base - h, w * 0.36, h * 0.34);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(px + 1, base - h * 0.65, 1.5, h * 0.55);
      // Etiqueta (sin letras).
      ctx.fillStyle = rng.pick(['#f1faee', '#ffd166', '#e63946', '#fefae0']);
      ctx.fillRect(px, base - h * 0.45, w, h * 0.18);
      return w;
    },
    box(px, base, maxH, cols, minW = 6, maxW = 16, room = 99) {
      const w = Math.min(room, rng.range(minW, maxW));
      if (w < minW * 0.6) return 0;
      const h = rng.range(maxH * 0.5, maxH * 0.95);
      const c1 = rng.pick(cols);
      ctx.fillStyle = c1;
      ctx.fillRect(px, base - h, w, h);
      ctx.fillStyle = rng.pick(cols);
      ctx.fillRect(px, base - h * 0.62, w, h * 0.2);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(px, base - h, 1.2, h);
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.fillRect(px + w - 1.5, base - h, 1.5, h);
      return w;
    },
    /** Paquete de mecato: bolsa con los bordes rizados y franja de color. */
    bag(px, base, maxH, cols = BRIGHT) {
      const w = rng.range(9, 15);
      const h = rng.range(maxH * 0.6, maxH * 0.95);
      const col = rng.pick(cols);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(px + 1, base);
      ctx.lineTo(px, base - h + 3);
      ctx.lineTo(px + w, base - h + 3);
      ctx.lineTo(px + w - 1, base);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillRect(px, base - h, w, 3);
      ctx.fillStyle = rng.pick(['#ffd166', '#fff', '#111', '#e63946']);
      ctx.beginPath();
      ctx.arc(px + w / 2, base - h * 0.5, w * 0.28, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(px + 1, base - h + 4, 1.5, h - 6);
      return w;
    },
    can(px, base, maxH, cols = BRIGHT) {
      const w = rng.range(6, 9);
      const h = Math.min(maxH, w * 1.6);
      ctx.fillStyle = rng.pick(cols);
      ctx.fillRect(px, base - h, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(px, base - h, w, 1.5);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(px + 1, base - h, 1.5, h);
      return w;
    },
    /** Pan: bollos redondos o alargados sobre la bandeja. */
    bread(px, base, maxH) {
      const w = rng.range(12, 22);
      const h = Math.min(maxH * 0.6, w * rng.range(0.4, 0.65));
      const g = ctx.createRadialGradient(px + w / 2, base - h * 0.7, 1, px + w / 2, base - h / 2, w * 0.6);
      const c = rng.pick([['#f3c178', '#b8702b'], ['#e9b35f', '#8f4c1a'], ['#f7dba7', '#c98b3d'], ['#d9a066', '#7a3f14']]);
      g.addColorStop(0, c[0]);
      g.addColorStop(1, c[1]);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(px + w / 2, base - h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      return w;
    },
    /** Prenda colgada en gancho (camiseta o buso) vista de frente. */
    garment(cx, top, w, h, col, sleeves = true) {
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, top - 3, 3, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.28, top);
      ctx.lineTo(cx - w * 0.5, top + h * 0.12);
      ctx.lineTo(cx - w * (sleeves ? 0.62 : 0.5), top + h * (sleeves ? 0.45 : 0.3));
      ctx.lineTo(cx - w * 0.4, top + h * 0.3);
      ctx.lineTo(cx - w * 0.38, top + h);
      ctx.lineTo(cx + w * 0.38, top + h);
      ctx.lineTo(cx + w * 0.4, top + h * 0.3);
      ctx.lineTo(cx + w * (sleeves ? 0.62 : 0.5), top + h * (sleeves ? 0.45 : 0.3));
      ctx.lineTo(cx + w * 0.5, top + h * 0.12);
      ctx.lineTo(cx + w * 0.28, top);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.arc(cx, top, w * 0.14, 0, Math.PI);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(cx - w * 0.36, top + h * 0.2, w * 0.12, h * 0.75);
    },
    /** Gorra de perfil sobre el exhibidor. */
    cap(cx, cy, s, col, flat) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx, cy, s, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = flat ? col : 'rgba(0,0,0,0.25)';
      ctx.fillRect(cx - s * 0.2, cy - 1, s * 1.9, flat ? 2.5 : 3);
      if (!flat) {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.ellipse(cx + s * 0.9, cy + 0.5, s * 0.9, 2.2, 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(cx - s * 0.6, cy - s * 0.7, s * 0.3, s * 0.4);
    },
    /** Reloj de pared. */
    clock(x, y, r) {
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f8f8f2';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + r * 0.5, y - r * 0.3);
      ctx.moveTo(x, y);
      ctx.lineTo(x - r * 0.1, y - r * 0.75);
      ctx.stroke();
    },
    /** Calendario de pared (con la foto de un paisaje). */
    calendar(x, y, w, h) {
      P.fill('#fafafa', x, y, w, h);
      const g = ctx.createLinearGradient(x, y, x, y + h * 0.55);
      g.addColorStop(0, '#7ab8e8');
      g.addColorStop(0.6, '#bde0fe');
      g.addColorStop(1, '#4f772d');
      ctx.fillStyle = g;
      ctx.fillRect(x + 2, y + 2, w - 4, h * 0.55);
      ctx.fillStyle = '#31572c';
      ctx.beginPath();
      ctx.moveTo(x + 2, y + h * 0.5);
      ctx.lineTo(x + w * 0.4, y + h * 0.25);
      ctx.lineTo(x + w - 2, y + h * 0.5);
      ctx.fill();
      ctx.fillStyle = '#c1121f';
      ctx.fillRect(x + 2, y + h * 0.6, w - 4, 3);
      ctx.fillStyle = '#999';
      for (let r = 0; r < 4; r++) for (let k = 0; k < 6; k++) ctx.fillRect(x + 3 + k * ((w - 6) / 6), y + h * 0.68 + r * ((h * 0.3) / 4), 2, 2);
    },
    /** Tubo fluorescente pintado (el cielo raso visto de lejos). */
    tube(x, y, w, h) {
      P.fill('#d8d8d8', x - 2, y - 2, w + 4, h + 4);
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, '#f4fbff');
      g.addColorStop(0.5, '#ffffff');
      g.addColorStop(1, '#e3f1fb');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
    },
  };
  return P;
}

// ------------------------------------------------------------------ paredes por tipo
// Cada función pinta la pared del fondo (w = 512) o la lateral (side, w = 256).
// En la del fondo, 1 m ≈ 87 px; el piso está abajo y el techo arriba.
const M = CS / 2.95; // píxeles por metro en vertical
const KIND_PAINT = {
  tienda(P, w, h, side) {
    const { rng } = P;
    P.wall('#efe3c4', w, h);
    P.tiles(0, h - 1.0 * M, w, 1.0 * M, '#c9d8c5', 11);
    const top = 0.35 * M;
    const shelfH = h - top - 0.55 * M;
    const mixed = (px, base, maxH, room) => {
      const r = rng.next();
      if (r < 0.35) return P.bottle(px, base, maxH, rng.pick(BOTTLES));
      if (r < 0.55) return P.can(px, base, maxH);
      if (r < 0.8) return P.box(px, base, maxH, BRIGHT, 8, 18, room);
      return P.bag(px, base, maxH);
    };
    P.shelves(8, top, w - 16, shelfH, side ? 4 : 5, mixed, '#8b6b4a');
    if (!side) {
      P.sign(w * 0.5 - 70, 6, 140, 26, '#fff8d6', '#b00020', ['HOY NO FÍO, MAÑANA SÍ'], 11);
      P.calendar(w - 52, 4, 34, 44);
      P.clock(34, 20, 12);
      // Bultos de arroz y panela al pie del estante.
      for (let k = 0; k < 5; k++) {
        const x = 20 + k * 30 + rng.range(-4, 4);
        P.fill('#f4f1e8', x, h - 0.5 * M, 26, 0.42 * M);
        P.fill(rng.pick(['#d62828', '#1d4e89', '#2d6a4f']), x, h - 0.38 * M, 26, 8);
      }
    }
    P.ao(w, h, 0.35);
  },
  panaderia(P, w, h, side) {
    const { rng } = P;
    P.wall('#f6e2b8', w, h);
    P.tiles(0, h - 1.2 * M, w, 1.2 * M, '#f0c987', 13);
    // Canastas y bandejas de pan en estantes de aluminio.
    P.shelves(10, 0.55 * M, w - 20, h - 1.35 * M - 0.3 * M, side ? 3 : 4, (px, base, maxH) => P.bread(px, base, maxH), '#b8bcc2', 'rgba(90,50,20,0.15)');
    if (!side) {
      P.sign(w * 0.5 - 95, 4, 190, 34, '#3d2616', '#ffe8b0', ['PANDEQUESO · PANDEBONO', 'ROSCÓN · BUÑUELO · TINTO'], 11);
      P.clock(w - 30, 22, 12);
    }
    P.ao(w, h, 0.3);
  },
  drogueria(P, w, h, side) {
    const { rng } = P;
    P.wall('#f4f8fb', w, h);
    const meds = ['#ffffff', '#cfe8ff', '#8fd3a8', '#f2f2f2', '#6fa8dc', '#e9f5db', '#ffd6e0', '#fde68a'];
    P.shelves(8, 0.45 * M, w - 16, h - 0.95 * M, side ? 6 : 7, (px, base, maxH, room) => P.box(px, base, maxH * 0.9, meds, 5, 12, room), '#e8eef3', 'rgba(20,80,60,0.08)');
    if (!side) {
      // Cruz verde y aviso de inyectología.
      P.fill('#10a54a', w / 2 - 7, 3, 14, 34);
      P.fill('#10a54a', w / 2 - 17, 13, 34, 14);
      P.sign(24, 6, 110, 24, '#0b7a3b', '#ffffff', ['INYECTOLOGÍA'], 11);
      P.sign(w - 134, 6, 110, 24, '#ffffff', '#0b7a3b', ['DOMICILIOS'], 11);
    }
    P.ao(w, h, 0.22);
  },
  carniceria(P, w, h, side) {
    const { rng, ctx } = P;
    P.tiles(0, 0, w, h, '#f3f3f1', 12, 'rgba(0,0,0,0.1)');
    P.fill('#b00020', 0, 0.45 * M, w, 4);
    // Riel con ganchos y piezas colgadas.
    P.fill('#9a9a9a', 12, 0.55 * M, w - 24, 4);
    for (let x = 30; x < w - 20; x += side ? 40 : 46) {
      P.fill('#777', x, 0.55 * M, 2, 12);
      ctx.fillStyle = rng.pick(['#9b2226', '#ae2012', '#8f1d21', '#c9594b']);
      ctx.beginPath();
      ctx.ellipse(x + 1, 0.55 * M + 12 + 30, 12, 32, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,240,230,0.55)';
      ctx.fillRect(x - 6, 0.55 * M + 26, 4, 30);
    }
    if (!side) {
      P.sign(w - 170, 5, 150, 28, '#ffffff', '#b00020', ['RES · CERDO · POLLO'], 13);
      // Pesa digital.
      P.fill('#dcdcdc', 40, h - 1.2 * M, 36, 18);
      P.fill('#2d6a4f', 46, h - 1.2 * M + 4, 20, 7);
    }
    P.ao(w, h, 0.25);
  },
  fruteria(P, w, h, side) {
    const { rng, ctx } = P;
    P.wall('#dfe9c8', w, h);
    // Canastillas escalonadas de frutas.
    const rows = side ? 3 : 4;
    for (let r = 0; r < rows; r++) {
      const y = h - (r + 1) * 0.42 * M - 0.1 * M;
      for (let x = 6 + r * 6; x < w - 40; x += 56) {
        P.fill('#8b5a2b', x, y + 18, 50, 20);
        P.fill('rgba(0,0,0,0.25)', x, y + 34, 50, 4);
        const fc = rng.pick(['#f4d03f', '#e67e22', '#27ae60', '#c0392b', '#8e44ad', '#f39c12', '#6ab04c', '#ff7979']);
        for (let f = 0; f < 11; f++) {
          ctx.fillStyle = fc;
          ctx.beginPath();
          ctx.arc(x + 6 + (f % 6) * 8 + (f > 5 ? 4 : 0), y + 16 - (f > 5 ? 7 : 0), 5.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.fillRect(x + 4 + (f % 6) * 8 + (f > 5 ? 4 : 0), y + 12 - (f > 5 ? 7 : 0), 2, 2);
        }
      }
    }
    if (!side) {
      // Racimos de plátano colgados y tablero de precios.
      for (let k = 0; k < 4; k++) {
        const x = 60 + k * 110;
        P.fill('#5a4632', x, 0, 2, 20);
        for (let b = 0; b < 7; b++) {
          ctx.fillStyle = k % 2 ? '#5b8c2a' : '#f4d03f';
          ctx.beginPath();
          ctx.ellipse(x - 12 + b * 4, 32 + (b % 2) * 4, 3, 13, 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      P.sign(w - 120, 8, 100, 40, '#2b2b2b', '#f1faee', ['MANGO $3.000', 'LULO $4.500'], 10);
    }
    P.ao(w, h, 0.3);
  },
  peluqueria(P, w, h, side) {
    const { ctx } = P;
    P.wall(side ? '#2b2d31' : '#f1f1f1', w, h);
    if (!side) P.fill('#1f2024', 0, h * 0.62, w, h * 0.38);
    // Espejos con bombillos y repisa de productos.
    const n = side ? 2 : 3;
    for (let k = 0; k < n; k++) {
      const x = (w / n) * k + 14;
      const mw = w / n - 28;
      const g = ctx.createLinearGradient(x, 0.55 * M, x + mw, 1.8 * M);
      g.addColorStop(0, '#c9d6df');
      g.addColorStop(0.5, '#eef3f7');
      g.addColorStop(1, '#9fb3c2');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0.5 * M, mw, 1.05 * M);
      P.fill('rgba(255,255,255,0.5)', x + 8, 0.52 * M, 6, 1.0 * M);
      P.fill('#111', x - 3, 0.5 * M - 3, mw + 6, 3);
      P.fill('#111', x - 3, 1.55 * M, mw + 6, 5);
      for (let b = 0; b < 6; b++) P.fill('#fff8d0', x + 4 + b * ((mw - 8) / 5) - 2, 0.5 * M - 8, 5, 5);
      for (let b = 0; b < 5; b++) P.bottle(x + 6 + b * 11, 1.55 * M, 18, ['#1b998b', '#e71d36', '#f1faee', '#ff9f1c', '#2ec4b6'][b]);
    }
    if (!side) {
      // Cartel de cortes (siluetas) y franja de luz LED.
      P.fill('#e8e8e8', w / 2 - 40, 4, 80, 30);
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = '#333';
        ctx.beginPath();
        ctx.arc(w / 2 - 28 + k * 19, 22, 6, 0, Math.PI * 2);
        ctx.fill();
        P.fill('#111', w / 2 - 34 + k * 19, 13, 12, 3 + k * 1.5);
      }
      P.fill('#7bdff2', 0, h * 0.62 - 3, w, 3);
    }
    P.ao(w, h, 0.25);
  },
  ferreteria(P, w, h, side) {
    const { rng, ctx } = P;
    P.wall('#d8d4c8', w, h);
    // Tablero perforado con herramientas colgadas.
    const bx = 8;
    const by = 0.25 * M;
    const bw = w - 16;
    const bh = side ? 1.1 * M : 1.2 * M;
    P.fill('#c8a878', bx, by, bw, bh);
    ctx.fillStyle = 'rgba(60,40,20,0.35)';
    for (let y = by + 6; y < by + bh; y += 9) for (let x = bx + 6; x < bx + bw; x += 9) ctx.fillRect(x, y, 1.5, 1.5);
    for (let x = bx + 10; x < bx + bw - 16; x += rng.range(14, 22)) {
      const t = rng.int(0, 3);
      const y = by + rng.range(8, bh - 50);
      ctx.fillStyle = rng.pick(['#555', '#777', '#b22', '#1d4e89', '#e0a800', '#222']);
      if (t === 0) {
        ctx.fillRect(x + 3, y, 3, 36);
        ctx.fillRect(x - 2, y, 13, 7);
      } else if (t === 1) {
        ctx.fillRect(x + 3, y + 6, 3, 34);
        ctx.beginPath();
        ctx.arc(x + 4.5, y + 5, 6, 0, Math.PI * 2);
        ctx.fill();
      } else if (t === 2) {
        ctx.fillRect(x, y, 10, 24);
        ctx.fillStyle = '#ccc';
        ctx.fillRect(x + 2, y + 24, 6, 16);
      } else {
        ctx.fillRect(x, y, 4, 40);
        ctx.fillRect(x + 6, y, 4, 40);
      }
    }
    P.shelves(8, by + bh + 8, w - 16, h - by - bh - 14, 2, (px, base, maxH, room) => (rng.chance(0.6) ? P.can(px, base, maxH * 0.8, ['#c0392b', '#2980b9', '#f1c40f', '#ecf0f1', '#27ae60', '#7f8c8d']) + 3 : P.box(px, base, maxH, ['#6c757d', '#e9ecef', '#f77f00'], 10, 20, room)), '#6c6f73');
    if (!side) P.sign(w - 140, 2, 120, 22, '#ffd000', '#111', ['SE CORTAN LLAVES'], 11);
    P.ao(w, h, 0.3);
  },
  papeleria(P, w, h, side) {
    const { rng } = P;
    P.wall('#eef3f8', w, h);
    const note = ['#e63946', '#457b9d', '#f1c40f', '#2a9d8f', '#ffffff', '#6a4c93', '#ff6f91', '#8ac926'];
    P.shelves(8, 0.5 * M, w - 16, h - 1.05 * M, side ? 4 : 5, (px, base, maxH, room) => P.box(px, base, maxH, note, 3, 7, room), '#ced4da');
    if (!side) {
      P.sign(18, 4, 160, 36, '#1d3557', '#ffffff', ['FOTOCOPIAS · IMPRESIONES', 'MINUTOS · RECARGAS'], 10);
      P.sign(w - 130, 6, 110, 30, '#ffd166', '#111', ['PLASTIFICADO', 'ANILLADO'], 10);
      // Rollos de papel regalo.
      for (let k = 0; k < 7; k++) P.fill(rng.pick(note), 200 + k * 9, 6, 7, 40);
    }
    P.ao(w, h, 0.22);
  },
  heladeria(P, w, h, side) {
    const { rng, ctx } = P;
    P.wall('#ffe0ee', w, h);
    P.tiles(0, h - 1.0 * M, w, 1.0 * M, '#ffffff', 14);
    if (!side) {
      // Tablero de sabores y barquillo pintado.
      P.fill('#5a2a41', 30, 16, 190, 90);
      ['FRESA', 'MORA', 'CHOCOLATE', 'VAINILLA', 'LULO', 'RON CON PASAS'].forEach((t, i) => {
        P.text(t, 44 + (i % 2) * 92, 32 + Math.floor(i / 2) * 26, 11, '#fff3b0', 'left');
      });
      ctx.fillStyle = '#d4a373';
      ctx.beginPath();
      ctx.moveTo(w - 110, 60);
      ctx.lineTo(w - 70, 60);
      ctx.lineTo(w - 90, 128);
      ctx.fill();
      for (const [dx, dy, c] of [[-100, 52, '#ff9ecd'], [-80, 52, '#a3e635'], [-90, 36, '#8b5a2b']]) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(w + dx, dy, 14, 0, Math.PI * 2);
        ctx.fill();
      }
      P.sign(240, 20, 110, 28, '#e11d74', '#ffffff', ['CONOS · COPAS'], 12);
    } else {
      for (let k = 0; k < 3; k++) P.sign(20 + k * 76, 30, 60, 60, rng.pick(['#ff9ecd', '#7dd3fc', '#a3e635']), '#5a2a41', ['MALTEADA', '$6.000'], 9);
    }
    P.ao(w, h, 0.25);
  },
  cafeteria(P, w, h, side) {
    const { rng, ctx } = P;
    P.wall('#e9d2b0', w, h);
    P.tiles(0, h - 1.1 * M, w, 1.1 * M, '#a0522d', 14, 'rgba(255,255,255,0.18)');
    if (!side) {
      P.fill('#2d2d2d', 60, 14, 220, 96);
      P.fill('#6b4226', 56, 10, 228, 4);
      ['TINTO ........ $1.500', 'EMPANADA ..... $2.000', 'AREPA C/ QUESO $3.500', 'JUGO NATURAL . $4.000', 'CALDO ........ $6.000'].forEach((t, k) => P.text(t, 72, 28 + k * 18, 12, '#f5f5f5', 'left', 'bold'));
      // Greca / cafetera sobre el mesón de atrás.
      P.fill('#b7b7b7', w - 150, h - 1.45 * M, 46, 50);
      P.fill('#888', w - 146, h - 1.45 * M + 8, 38, 8);
      ctx.fillStyle = '#6b4226';
      for (let k = 0; k < 5; k++) ctx.fillRect(w - 90 + k * 12, h - 1.2 * M, 9, 11);
    } else {
      P.shelves(10, 0.6 * M, w - 20, 0.9 * M, 2, (px, base, maxH, room) => P.box(px, base, maxH * 0.6, ['#ffffff', '#f1faee', '#e63946'], 8, 12, room), '#6b4226');
    }
    P.ao(w, h, 0.3);
  },
  billares(P, w, h, side) {
    const { rng, ctx } = P;
    P.wall('#3b2f2a', w, h, 0.08);
    // Friso de madera y cuadros.
    P.fill('#5c3b24', 0, h - 1.1 * M, w, 1.1 * M);
    for (let x = 0; x < w; x += 24) P.fill('rgba(0,0,0,0.25)', x, h - 1.1 * M, 1.5, 1.1 * M);
    // Taquera con tacos.
    const tx = side ? 40 : 30;
    P.fill('#4a2c1a', tx - 4, 0.45 * M, 70, 6);
    for (let k = 0; k < 7; k++) P.fill(rng.pick(['#e9c46a', '#d4a373', '#bc6c25']), tx + k * 9, 0.45 * M + 6, 3, 1.35 * M);
    if (!side) {
      P.sign(w / 2 - 70, 12, 140, 34, '#101010', '#ff4d6d', ['CERVEZA FRÍA', 'PARQUÉS · DOMINÓ'], 11);
      P.fill('#e9d8a6', w - 140, 30, 110, 60);
      P.text('TABLA DE PUNTOS', w - 85, 42, 9, '#222');
      for (let r = 0; r < 3; r++) for (let k = 0; k < 8; k++) P.fill(['#c1121f', '#f1faee', '#1d3557'][r], w - 130 + k * 12, 55 + r * 11, 8, 8);
      // Póster de la selección (sin escudos, solo colores).
      P.fill('#f2c200', 150, 40, 40, 54);
      P.fill('#1f3f8f', 150, 76, 40, 9);
      P.fill('#c8102e', 150, 85, 40, 9);
    }
    P.ao(w, h, 0.45);
  },
  ropa(P, w, h, side) {
    const { rng, ctx } = P;
    P.wall('#f7f5f2', w, h);
    // Panel ranurado (slatwall) con prendas colgadas y gorras arriba.
    P.fill('#e4ded6', 6, 0.3 * M, w - 12, 1.9 * M);
    for (let y = 0.3 * M + 8; y < 2.2 * M; y += 10) P.fill('rgba(0,0,0,0.08)', 6, y, w - 12, 1.5);
    const cols = ROPA.filter((r) => r.slot === 'torso').map((r) => `#${r.color.toString(16).padStart(6, '0')}`);
    // Fila de gorras.
    for (let x = 22; x < w - 20; x += 26) P.cap(x, 0.3 * M + 20, 9, `#${rng.pick(ROPA.filter((r) => r.slot === 'cabeza')).color.toString(16).padStart(6, '0')}`, rng.chance(0.5));
    // Camisetas y busos en ganchos.
    for (let x = 30; x < w - 20; x += side ? 38 : 34) P.garment(x, 0.3 * M + 40, 30, 46, rng.pick(cols), true);
    // Pantalones doblados abajo.
    for (let x = 16; x < w - 30; x += 22) {
      const c = rng.pick(['#2b3a55', '#1b1b1d', '#5ab4e5', '#8a8d91', '#3d5a80']);
      for (let k = 0; k < 4; k++) P.fill(k % 2 ? c : 'rgba(0,0,0,0.25)', x, 1.75 * M + k * 5, 18, k % 2 ? 4 : 1);
    }
    if (!side) {
      P.sign(w / 2 - 80, 2, 160, 22, '#111111', '#ffd166', ['NUEVA COLECCIÓN'], 12);
      P.sign(w - 96, 2, 80, 22, '#e63946', '#ffffff', ['2 × $100'], 12);
    }
    P.ao(w, h, 0.18);
  },
};

// ------------------------------------------------------------------ casillas sueltas
const EXTRA_PAINT = {
  'piso-rojo'(P, w, h) {
    // Baldosa de cemento roja (la de toda casa vieja del barrio): 4 x 4 m, 30 cm.
    const s = w / 13;
    for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) P.fill(P.rng.pick(['#9c3b2a', '#a4422f', '#963626', '#aa4a36']), x, y, s - 1, s - 1);
    P.fill('rgba(255,255,255,0.08)', 0, 0, w, h);
  },
  'piso-granito'(P, w, h) {
    const s = w / 10;
    P.fill('#b9b4ab', 0, 0, w, h);
    for (let i = 0; i < 2600; i++) P.fill(P.rng.pick(['#6d6a65', '#e8e4dc', '#8f8a80', '#2f2d2a']), P.rng.next() * w, P.rng.next() * h, 1.6, 1.6);
    for (let y = 0; y < h; y += s) P.fill('rgba(0,0,0,0.15)', 0, y, w, 1);
    for (let x = 0; x < w; x += s) P.fill('rgba(0,0,0,0.15)', x, 0, 1, h);
  },
  'piso-ajedrez'(P, w, h) {
    const s = w / 12;
    for (let y = 0, r = 0; y < h; y += s, r++) for (let x = 0, k = 0; x < w; x += s, k++) P.fill((r + k) % 2 ? '#1f1f1f' : '#eeeeea', x, y, s, s);
  },
  techo(P, w, h) {
    P.wall('#f3f2ee', w, h, 0.03);
    P.tube(w * 0.15, h * 0.3, w * 0.7, 7);
    P.tube(w * 0.15, h * 0.68, w * 0.7, 7);
  },
  nevera(P, w, h) {
    const { rng, ctx } = P;
    P.fill('#0e1a24', 0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(210,235,255,0.25)');
    g.addColorStop(1, 'rgba(210,235,255,0.05)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (let r = 0; r < 5; r++) {
      const base = 44 + r * 48;
      for (let x = 10; x < w - 14; x += 12) {
        const c = rng.pick(['#e63946', '#f77f00', '#2a9d8f', '#ffd166', '#8ecae6', '#6a040f', '#f1faee', '#3a5a40']);
        P.fill(c, x, base - 36, 9, 36);
        P.fill(c, x + 3, base - 44, 3, 8);
        P.fill('rgba(255,255,255,0.35)', x + 1, base - 34, 1.5, 30);
      }
      P.fill('#b8c4cc', 4, base, w - 8, 3);
    }
    P.fill('rgba(255,255,255,0.18)', 8, 0, 26, h);
  },
  'tira-mecato'(P, w, h) {
    // Tiras de paquetes colgados (cuatro tiras por casilla).
    for (let k = 0; k < 4; k++) {
      const x = k * (w / 4);
      P.fill('#e0e0e0', x + w / 8 - 1, 0, 2, h);
      for (let y = 6; y < h - 20; y += 30) P.bag(x + 8, y + 28, 26, BRIGHT);
    }
  },
  espejo(P, w, h) {
    const { ctx } = P;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#9fb3c2');
    g.addColorStop(0.45, '#e8f0f6');
    g.addColorStop(0.55, '#c9d6df');
    g.addColorStop(1, '#7d93a3');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    P.fill('rgba(255,255,255,0.35)', w * 0.2, 0, 10, h);
    P.fill('rgba(255,255,255,0.2)', w * 0.3, 0, 4, h);
  },
  percha(P, w, h) {
    const cols = ROPA.filter((r) => r.slot === 'torso').map((r) => `#${r.color.toString(16).padStart(6, '0')}`);
    P.fill('#f4f2ee', 0, 0, w, h);
    for (let x = 18; x < w; x += 30) P.garment(x, 20, 30, h * 0.8, P.rng.pick(cols), true);
  },
  'gondola-mecato'(P, w, h) {
    P.shelves(4, 4, w - 8, h - 8, 5, (px, base, maxH) => P.bag(px, base, maxH), '#c7ccd1', 'rgba(0,0,0,0.3)');
  },
  'gondola-viveres'(P, w, h) {
    const { rng } = P;
    P.shelves(4, 4, w - 8, h - 8, 5, (px, base, maxH, room) => (rng.chance(0.3) ? P.bottle(px, base, maxH, rng.pick(BOTTLES)) : rng.chance(0.4) ? P.can(px, base, maxH) : P.box(px, base, maxH, BRIGHT, 8, 18, room)), '#c7ccd1', 'rgba(0,0,0,0.3)');
  },
  'gondola-drogas'(P, w, h) {
    const meds = ['#ffffff', '#cfe8ff', '#8fd3a8', '#f2f2f2', '#6fa8dc', '#e9f5db', '#ffd6e0'];
    P.shelves(4, 4, w - 8, h - 8, 6, (px, base, maxH, room) => P.box(px, base, maxH, meds, 6, 13, room), '#f0f3f5', 'rgba(0,40,30,0.15)');
  },
  // Frentes de vitrina: vidrio oscuro con reflejo y el producto adentro.
  'vitrina-pan'(P, w, h) {
    vitrina(P, w, h, (y0, y1) => {
      for (let r = 0; r < 2; r++) {
        let x = 6;
        const base = y0 + ((r + 1) * (y1 - y0)) / 2 - 4;
        P.fill('#c0c4c8', 4, base, w - 8, 3);
        while (x < w - 20) x += P.bread(x, base, (y1 - y0) / 2 - 6) + 2;
      }
    });
  },
  'vitrina-carne'(P, w, h) {
    vitrina(P, w, h, (y0, y1) => {
      P.fill('#e9ecef', 4, y1 - 20, w - 8, 18);
      for (let x = 8; x < w - 30; x += 34) {
        P.fill(P.rng.pick(['#9b2226', '#ae2012', '#c9594b', '#f4d6c6']), x, y1 - 40, 30, 22);
        P.fill('rgba(255,255,255,0.35)', x + 4, y1 - 36, 10, 4);
      }
    }, '#ff8f8f');
  },
  'vitrina-helado'(P, w, h) {
    vitrina(P, w, h, (y0, y1) => {
      for (let x = 6; x < w - 26; x += 30) {
        P.fill('#c9ccd1', x, y1 - 36, 28, 32);
        P.fill(P.rng.pick(['#ff9ecd', '#fff3b0', '#a3e635', '#7dd3fc', '#8b5a2b', '#f87171', '#fde68a']), x + 2, y1 - 40, 24, 12);
      }
    }, '#bfe9ff');
  },
  'vitrina-comida'(P, w, h) {
    const { ctx, rng } = P;
    vitrina(P, w, h, (y0, y1) => {
      for (let r = 0; r < 2; r++) {
        const base = y0 + ((r + 1) * (y1 - y0)) / 2 - 3;
        P.fill('#d9d9d9', 4, base, w - 8, 3);
        for (let x = 8; x < w - 16; x += 16) {
          ctx.fillStyle = rng.pick(['#e9a23b', '#d98e04', '#c96f1a', '#8c4a1c']);
          ctx.beginPath();
          ctx.ellipse(x + 6, base - 6, 7, 5, 0, Math.PI, 0);
          ctx.fill();
        }
      }
    }, '#ffe2b0');
  },
  'vitrina-dulces'(P, w, h) {
    vitrina(P, w, h, (y0, y1) => {
      for (let r = 0; r < 3; r++) {
        const base = y0 + ((r + 1) * (y1 - y0)) / 3 - 2;
        P.fill('#c9ccd1', 4, base, w - 8, 2);
        let x = 6;
        while (x < w - 14) x += P.box(x, base, (y1 - y0) / 3 - 5, BRIGHT, 5, 12) + 1;
      }
    });
  },
  'ropa-doblada'(P, w, h) {
    const { rng } = P;
    P.fill('#e8e2d9', 0, 0, w, h);
    for (let r = 0; r < 4; r++) {
      const base = ((r + 1) * h) / 4 - 3;
      P.fill('#b08968', 0, base, w, 4);
      for (let x = 6; x < w - 36; x += 40) {
        const c = rng.pick(['#2b3a55', '#1b1b1d', '#5ab4e5', '#8a8d91', '#f2f2ee', '#c8102e', '#0f7a3d', '#c9962b', '#6d1026']);
        for (let k = 0; k < 6; k++) {
          P.fill(c, x, base - 6 - k * 7, 34, 6);
          P.fill('rgba(0,0,0,0.25)', x, base - 1 - k * 7, 34, 1);
        }
      }
    }
  },
  herramientas(P, w, h) {
    KIND_PAINT.ferreteria(P, w, h, true);
  },
  pintura(P, w, h) {
    const { rng } = P;
    P.fill('#5c5f63', 0, 0, w, h);
    for (let r = 0; r < 4; r++) {
      const base = ((r + 1) * h) / 4 - 3;
      P.fill('#8a8d91', 0, base, w, 4);
      for (let x = 4; x < w - 24; x += 26) {
        P.fill('#dadde0', x, base - 40, 24, 40);
        P.fill(rng.pick(['#c0392b', '#2980b9', '#f1c40f', '#ecf0f1', '#27ae60', '#8e44ad', '#e67e22']), x, base - 30, 24, 14);
      }
    }
  },
  cuadernos(P, w, h) {
    KIND_PAINT.papeleria(P, w, h, true);
  },
  botellas(P, w, h) {
    const { rng } = P;
    P.shelves(4, 4, w - 8, h - 8, 4, (px, base, maxH) => P.bottle(px, base, maxH, rng.pick(BOTTLES)), '#6b4a2f', 'rgba(0,0,0,0.35)');
  },
  gorras(P, w, h) {
    P.fill('#e4ded6', 0, 0, w, h);
    const caps = ROPA.filter((r) => r.slot === 'cabeza');
    for (let r = 0; r < 5; r++) for (let x = 22; x < w - 10; x += 36) P.cap(x, 30 + r * 48, 12, `#${P.rng.pick(caps).color.toString(16).padStart(6, '0')}`, P.rng.chance(0.5));
  },
  tablero(P, w, h) {
    P.fill('#2d2d2d', 0, 0, w, h);
    ['TINTO', 'PERICO', 'AGUAPANELA', 'EMPANADA', 'PAPA RELLENA', 'BUÑUELO'].forEach((t, k) => P.text(t, 20, 26 + k * 36, 18, '#f5f5f5', 'left'));
  },
  canasta(P, w, h) {
    // Canasta plástica de cerveza vista de frente (se tiñe por vértice).
    P.fill('#dcdcdc', 0, 0, w, h);
    for (let x = 10; x < w - 10; x += 26) P.fill('rgba(0,0,0,0.35)', x, 30, 16, h - 60);
    P.fill('rgba(255,255,255,0.4)', 0, 0, w, 10);
  },
};

function vitrina(P, w, h, content, tint = '#dff3ff') {
  const { ctx } = P;
  P.fill('#1a2228', 0, 0, w, h);
  P.fill('rgba(255,255,255,0.08)', 0, 0, w, h);
  content(12, h - 10);
  // Vidrio: reflejo diagonal y luz interna.
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, 'rgba(255,255,255,0.22)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.02)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  P.fill(tint, 0, 0, w, 5);
  P.fill('#8d9399', 0, h - 6, w, 6);
}

// ------------------------------------------------------------------ utilería 3D
// Colores (lineales en el vértice; > 1 = luz propia).
const WOOD = [0.42, 0.28, 0.17];
const WOOD_L = [0.62, 0.45, 0.28];
const STEEL = [0.62, 0.64, 0.66];
const WHITE = [0.93, 0.93, 0.91];
const BLACK = [0.07, 0.07, 0.08];
const TUBE = [2.6, 2.6, 2.5];
const GLOW_COLD = [1.9, 2.1, 2.3];
const GLOW_WARM = [2.3, 1.9, 1.3];
const PLASTIC = [[0.93, 0.93, 0.9], [0.75, 0.1, 0.1], [0.12, 0.3, 0.6]];
const CRATES = [[0.78, 0.08, 0.08], [0.95, 0.72, 0.05], [0.1, 0.35, 0.7], [0.12, 0.45, 0.2]];
const hex = (n) => [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => v ** 2.2 * 1.1);

/**
 * Pone la utilería de un local de ancho `w` (m) y fondo `depth`.
 * api.box(u0, u1, v0, v1, d0, d1, color) — caja (d = metros hacia adentro)
 * api.front(name, u0, u1, v0, v1, d, tint) — cuadro del atlas mirando a la calle
 * api.side(name, u, v0, v1, d0, d1, dir, tint) — cuadro en el plano u (dir = +1 mira a +u)
 * u va de 0 a w (izquierda a derecha visto desde la calle).
 */
export function shopProps(api, kind, w, depth, rng) {
  const back = depth - 0.05;
  const B = api.box;
  // Tubos fluorescentes del cielo raso (luz propia).
  const nT = w > 3.6 ? 2 : 1;
  for (let k = 0; k < nT; k++) {
    const d = depth * (nT === 1 ? 0.55 : 0.35 + k * 0.4);
    B(w * 0.2, w * 0.8, 2.56, 2.6, d - 0.05, d + 0.05, [0.85, 0.85, 0.85]);
    B(w * 0.22, w * 0.78, 2.52, 2.56, d - 0.025, d + 0.025, TUBE);
  }
  const R = RECIPES[kind] ?? RECIPES.tienda;
  R(api, w, depth, back, rng);
}

/** Mostrador con vitrina de vidrio al frente (d0 = cara que da a la calle). */
function counter(api, u0, u1, d0, d1, face, top = WOOD, h = 1.0) {
  api.box(u0, u1, 0, 0.12, d0 + 0.04, d1, BLACK);
  api.box(u0, u1, 0.12, h - 0.05, d0 + 0.02, d1, top.map((v) => v * 0.8));
  api.front(face, u0 + 0.03, u1 - 0.03, 0.14, h - 0.07, d0, [1.25, 1.25, 1.25]);
  api.box(u0 - 0.02, u1 + 0.02, h - 0.05, h, d0 - 0.02, d1 + 0.02, top);
}

/** Nevera vertical de puerta de vidrio (encendida). */
function fridge(api, u0, d0, width = 0.72, rng = null, body = WHITE) {
  const u1 = u0 + width;
  api.box(u0, u1, 0, 1.95, d0, d0 + 0.65, body);
  api.front('nevera', u0 + 0.05, u1 - 0.05, 0.12, 1.72, d0 - 0.005, [1.7, 1.8, 1.9]);
  // Aviso de arriba (sin marca: franja de color con luz).
  api.box(u0, u1, 1.76, 1.95, d0 - 0.01, d0 + 0.02, rng ? [rng.pick([1.9, 0.3, 0.2]), rng.pick([0.3, 1.2, 0.2]), rng.pick([0.2, 0.4, 1.7])] : [1.8, 0.3, 0.2]);
}

/** Góndola (estantería) contra una pared lateral, mirando al centro del local. */
function sideShelf(api, u, dir, d0, d1, name, h = 2.0, deep = 0.4, frame = STEEL) {
  const a = dir > 0 ? u : u - deep;
  const b = dir > 0 ? u + deep : u;
  api.box(a, b, 0, 0.1, d0, d1, frame);
  api.box(a, b, h - 0.04, h, d0, d1, frame);
  api.box(a, b, 0, h, d0, d0 + 0.04, frame);
  api.side(name, dir > 0 ? b - 0.02 : a + 0.02, 0.1, h - 0.04, d0 + 0.04, d1, dir);
  for (let k = 1; k < 5; k++) {
    const v = (k / 5) * (h - 0.1) + 0.05;
    api.box(a, b + (dir > 0 ? 0.03 : 0), v - 0.02, v, d0, d1, frame);
  }
}

/** Estantería de frente a la calle (contra el fondo). */
function backShelf(api, u0, u1, back, name, h = 2.1, deep = 0.38, frame = STEEL) {
  api.box(u0, u1, h - 0.04, h, back - deep, back, frame);
  api.box(u0 - 0.04, u0, 0, h, back - deep, back, frame);
  api.box(u1, u1 + 0.04, 0, h, back - deep, back, frame);
  api.front(name, u0, u1, 0.08, h - 0.04, back - 0.06);
  for (let k = 1; k < 5; k++) {
    const v = (k / 5) * (h - 0.1) + 0.05;
    api.box(u0, u1, v - 0.02, v, back - deep, back - deep + 0.05, frame);
  }
}

/** Pila de canastas de cerveza (canastas plásticas con botellas cafés arriba). */
function crates(api, u, d, n, rng) {
  for (let k = 0; k < n; k++) {
    const c = rng.pick(CRATES);
    const du = rng.range(-0.03, 0.03);
    api.box(u + du, u + du + 0.44, k * 0.3, k * 0.3 + 0.28, d, d + 0.32, c);
    if (k === n - 1) for (let b = 0; b < 4; b++) api.box(u + du + 0.04 + b * 0.1, u + du + 0.1 + b * 0.1, k * 0.3 + 0.28, k * 0.3 + 0.36, d + 0.06, d + 0.26, [0.25, 0.12, 0.04]);
  }
}

/** Mesa y sillas plásticas (las de todo negocio paisa). */
function tableSet(api, u, d, rng, chairs = 2) {
  const col = rng.pick(PLASTIC);
  api.box(u - 0.4, u + 0.4, 0.7, 0.74, d - 0.4, d + 0.4, col);
  for (const [a, b] of [[-0.36, -0.36], [0.32, -0.36], [-0.36, 0.32], [0.32, 0.32]]) api.box(u + a, u + a + 0.04, 0, 0.7, d + b, d + b + 0.04, col);
  for (let k = 0; k < chairs; k++) {
    const s = k ? 1 : -1;
    const cu = u + s * 0.62;
    api.box(cu - 0.2, cu + 0.2, 0.42, 0.46, d - 0.2, d + 0.2, col);
    api.box(s > 0 ? cu + 0.17 : cu - 0.21, s > 0 ? cu + 0.21 : cu - 0.17, 0.46, 0.9, d - 0.2, d + 0.2, col);
    for (const b of [-0.18, 0.15]) api.box(cu - 0.18, cu - 0.14, 0, 0.42, d + b, d + b + 0.03, col), api.box(cu + 0.14, cu + 0.18, 0, 0.42, d + b, d + b + 0.03, col);
  }
}

/** Maniquí vestido con una pinta al azar del catálogo (cabeza sin cara). */
export function mannequin(api, u, d, rng, look = null) {
  const pick = (slot) => rng.pick(ROPA.filter((r) => r.slot === slot && r.color != null));
  const top = look?.torso ?? pick('torso');
  const legs = look?.piernas ?? pick('piernas');
  const cap = look?.cabeza ?? (rng.chance(0.6) ? pick('cabeza') : null);
  const shirt = hex(top.color ?? 0xf2f2ee);
  const pants = hex(legs.color ?? 0x2b3a55);
  const skin = [0.85, 0.85, 0.83];
  // Base y tubo.
  api.box(u - 0.18, u + 0.18, 0, 0.03, d - 0.18, d + 0.18, STEEL);
  api.box(u - 0.015, u + 0.015, 0.03, 0.2, d - 0.015, d + 0.015, STEEL);
  // Piernas.
  api.box(u - 0.16, u - 0.02, 0.2, 0.95, d - 0.08, d + 0.08, pants);
  api.box(u + 0.02, u + 0.16, 0.2, 0.95, d - 0.08, d + 0.08, pants);
  // Torso (camiseta o buso) con hombros más anchos.
  api.box(u - 0.18, u + 0.18, 0.95, 1.22, d - 0.1, d + 0.1, shirt);
  api.box(u - 0.22, u + 0.22, 1.22, 1.45, d - 0.11, d + 0.11, shirt);
  if (top.pattern === 'rayas') for (let k = -2; k <= 2; k += 2) api.box(u + k * 0.06 - 0.025, u + k * 0.06 + 0.025, 0.96, 1.44, d - 0.115, d - 0.105, hex(top.color2));
  if (top.pattern === 'franja') api.box(u - 0.22, u + 0.22, 1.25, 1.32, d - 0.117, d - 0.1, hex(top.color2));
  // Brazos (mangas largas si es buso).
  const arm = top.long ? shirt : skin;
  api.box(u - 0.29, u - 0.22, 0.95, 1.43, d - 0.05, d + 0.05, arm);
  api.box(u + 0.22, u + 0.29, 0.95, 1.43, d - 0.05, d + 0.05, arm);
  api.box(u - 0.29, u - 0.22, 1.2, 1.43, d - 0.06, d + 0.06, shirt);
  api.box(u + 0.22, u + 0.29, 1.2, 1.43, d - 0.06, d + 0.06, shirt);
  // Cuello y cabeza.
  api.box(u - 0.04, u + 0.04, 1.45, 1.52, d - 0.04, d + 0.04, skin);
  api.box(u - 0.09, u + 0.09, 1.52, 1.74, d - 0.1, d + 0.09, skin);
  if (top.type === 'buso') api.box(u - 0.15, u + 0.15, 1.38, 1.52, d + 0.05, d + 0.16, shirt);
  if (cap) {
    const cc = hex(cap.color);
    api.box(u - 0.1, u + 0.1, 1.7, 1.8, d - 0.1, d + 0.1, cc);
    api.box(u - 0.08, u + 0.08, 1.7, 1.72, d - 0.24, d - 0.1, cap.type === 'gorra-plana' ? cc : hex(cap.color2 ?? cap.color));
  }
}

/** Perchero cromado con prendas colgadas (de frente o de lado). */
function rack(api, u0, u1, d, rng, h = 1.5) {
  api.box(u0, u0 + 0.03, 0, h, d - 0.015, d + 0.015, STEEL);
  api.box(u1 - 0.03, u1, 0, h, d - 0.015, d + 0.015, STEEL);
  api.box(u0, u1, h - 0.03, h, d - 0.015, d + 0.015, STEEL);
  const tops = ROPA.filter((r) => r.slot === 'torso');
  for (let u = u0 + 0.08; u < u1 - 0.08; u += rng.range(0.07, 0.1)) {
    const it = rng.pick(tops);
    const c = hex(it.color);
    const long = it.long || rng.chance(0.3);
    api.box(u, u + 0.035, h - 0.72 - (long ? 0.1 : 0), h - 0.05, d - 0.24, d + 0.24, c);
  }
}

const RECIPES = {
  tienda(api, w, depth, back, rng) {
    // Mostrador con vitrina de dulces, tiras de mecato colgadas, nevera,
    // canastas de cerveza y una góndola de víveres a un lado.
    const c0 = w * 0.34;
    counter(api, c0, w - 0.1, 1.35, 1.9, 'vitrina-dulces', WOOD);
    // Balanza y frascos sobre el mostrador.
    api.box(c0 + 0.2, c0 + 0.5, 1.0, 1.1, 1.45, 1.7, [0.8, 0.8, 0.82]);
    for (let k = 0; k < 3; k++) api.box(w - 0.7 + k * 0.17, w - 0.58 + k * 0.17, 1.0, 1.22, 1.45, 1.6, [0.9, 0.85, 0.6]);
    for (let k = 0; k < Math.floor((w - c0) / 0.5); k++) api.front('tira-mecato', c0 + 0.1 + k * 0.5, c0 + 0.24 + k * 0.5, 1.45, 2.5, 1.25 + (k % 2) * 0.05);
    fridge(api, 0.12, 0.45, 0.72, rng);
    sideShelf(api, 0.02, 1, 1.3, back - 0.1, 'gondola-viveres', 2.0, 0.42);
    crates(api, w - 0.55, 0.6, rng.int(2, 4), rng);
    backShelf(api, c0 + 0.2, w - 0.15, back, 'botellas', 2.2, 0.3, WOOD);
  },
  panaderia(api, w, depth, back, rng) {
    counter(api, w * 0.25, w - 0.1, 1.3, 1.9, 'vitrina-pan', STEEL, 1.05);
    // Canasta de pan sobre la vitrina y registradora.
    api.box(w * 0.3, w * 0.3 + 0.5, 1.05, 1.18, 1.4, 1.75, [0.75, 0.55, 0.3]);
    api.box(w - 0.55, w - 0.2, 1.05, 1.25, 1.45, 1.75, [0.2, 0.2, 0.22]);
    // Bandejero de aluminio contra el fondo.
    backShelf(api, w * 0.3, w - 0.2, back, 'vitrina-pan', 2.0, 0.45, STEEL);
    if (w > 3) tableSet(api, 0.7, 0.9, rng, 1);
    else fridge(api, 0.12, 0.5, 0.65, rng);
  },
  drogueria(api, w, depth, back, rng) {
    counter(api, 0.25, w - 0.25, 1.1, 1.6, 'vitrina-dulces', WHITE);
    sideShelf(api, 0.02, 1, 1.7, back, 'gondola-drogas', 2.3, 0.35, WHITE);
    sideShelf(api, w - 0.02, -1, 1.7, back, 'gondola-drogas', 2.3, 0.35, WHITE);
    backShelf(api, 0.6, w - 0.6, back, 'gondola-drogas', 2.3, 0.32, WHITE);
    // Cruz verde encendida.
    api.box(w / 2 - 0.06, w / 2 + 0.06, 2.2, 2.5, back - 0.36, back - 0.33, [0.2, 1.8, 0.6]);
    api.box(w / 2 - 0.15, w / 2 + 0.15, 2.29, 2.41, back - 0.36, back - 0.33, [0.2, 1.8, 0.6]);
  },
  carniceria(api, w, depth, back, rng) {
    counter(api, 0.2, w - 0.2, 1.2, 1.9, 'vitrina-carne', WHITE, 1.1);
    // Riel con piezas colgadas encima del mesón de atrás.
    api.box(0.3, w - 0.3, 2.2, 2.24, back - 0.5, back - 0.46, STEEL);
    for (let u = 0.5; u < w - 0.4; u += rng.range(0.35, 0.55)) api.box(u, u + 0.2, 1.55, 2.15, back - 0.56, back - 0.42, rng.pick([[0.55, 0.08, 0.08], [0.62, 0.15, 0.1], [0.8, 0.45, 0.4]]));
    api.box(0.3, w - 0.3, 0, 0.9, back - 0.4, back, WHITE);
  },
  fruteria(api, w, depth, back, rng) {
    // Canastillas escalonadas al frente y a los lados, con fruta encima.
    const fruit = [[0.95, 0.8, 0.1], [0.9, 0.45, 0.05], [0.25, 0.6, 0.15], [0.75, 0.1, 0.1], [0.45, 0.15, 0.5], [0.95, 0.6, 0.1]];
    const stair = (u0, u1, d0) => {
      for (let s = 0; s < 3; s++) {
        const d = d0 + s * 0.35;
        const v = 0.35 + s * 0.3;
        api.box(u0, u1, 0, v, d, d + 0.35, WOOD_L);
        for (let u = u0 + 0.05; u < u1 - 0.3; u += 0.36) api.box(u, u + 0.32, v, v + 0.1, d + 0.04, d + 0.3, rng.pick(fruit));
      }
    };
    stair(0.2, w - 0.2, 0.6);
    api.box(0.2, w - 0.2, 0, 1.4, back - 0.5, back, WOOD);
    for (let u = 0.3; u < w - 0.3; u += 0.36) api.box(u, u + 0.3, 1.4, 1.52, back - 0.45, back - 0.1, rng.pick(fruit));
    // Racimos colgados.
    for (let u = 0.5; u < w - 0.4; u += 0.9) api.box(u, u + 0.16, 1.8, 2.3, 1.0, 1.12, [0.85, 0.75, 0.1]);
  },
  peluqueria(api, w, depth, back, rng) {
    // Espejos en las paredes laterales, sillas de barbero y sillas de espera.
    api.side('espejo', 0.03, 0.9, 2.0, 0.8, back - 0.3, 1);
    api.box(0.02, 0.3, 0.85, 0.9, 0.8, back - 0.3, [0.1, 0.1, 0.12]);
    api.box(0.02, 0.06, 2.05, 2.09, 0.8, back - 0.3, GLOW_COLD);
    const nChairs = w > 3.4 ? 2 : 1;
    for (let k = 0; k < nChairs; k++) {
      const d = 1.1 + k * 1.1;
      const u = 0.95;
      api.box(u - 0.2, u + 0.2, 0, 0.05, d - 0.2, d + 0.2, STEEL);
      api.box(u - 0.05, u + 0.05, 0.05, 0.45, d - 0.05, d + 0.05, STEEL);
      api.box(u - 0.28, u + 0.28, 0.45, 0.6, d - 0.26, d + 0.26, BLACK);
      api.box(u + 0.2, u + 0.3, 0.6, 1.3, d - 0.26, d + 0.26, BLACK);
      api.box(u - 0.28, u + 0.28, 0.66, 0.72, d - 0.3, d - 0.24, [0.3, 0.3, 0.32]);
      api.box(u - 0.28, u + 0.28, 0.66, 0.72, d + 0.24, d + 0.3, [0.3, 0.3, 0.32]);
      api.box(u - 0.55, u - 0.3, 0.12, 0.16, d - 0.15, d + 0.15, STEEL);
    }
    // Sillas de espera al otro lado.
    for (let d = 0.8; d < back - 0.5; d += 0.55) {
      api.box(w - 0.5, w - 0.05, 0.42, 0.48, d, d + 0.45, [0.6, 0.1, 0.12]);
      api.box(w - 0.1, w - 0.05, 0.48, 0.95, d, d + 0.45, [0.6, 0.1, 0.12]);
      api.box(w - 0.45, w - 0.41, 0, 0.42, d + 0.2, d + 0.24, STEEL);
    }
  },
  ferreteria(api, w, depth, back, rng) {
    counter(api, w * 0.3, w - 0.1, 1.5, 2.0, 'pintura', WOOD);
    sideShelf(api, 0.02, 1, 0.9, back, 'pintura', 2.2, 0.45, [0.35, 0.37, 0.4]);
    // Tubos de PVC y rollos de manguera.
    for (let k = 0; k < 5; k++) api.box(w * 0.3 + 0.1 + k * 0.08, w * 0.3 + 0.16 + k * 0.08, 0, 2.3, 0.9, 0.96, rng.pick([[0.9, 0.9, 0.88], [0.5, 0.5, 0.52], [0.9, 0.45, 0.1]]));
    api.box(w - 0.6, w - 0.15, 0, 0.3, 0.7, 1.1, [0.2, 0.5, 0.2]);
    api.box(w - 0.55, w - 0.2, 0.3, 0.55, 0.75, 1.05, [0.2, 0.5, 0.2]);
  },
  papeleria(api, w, depth, back, rng) {
    counter(api, 0.2, w * 0.7, 1.2, 1.7, 'vitrina-dulces', WHITE);
    // Fotocopiadora.
    const u = w - 0.9;
    api.box(u, u + 0.7, 0, 0.95, 1.4, 2.0, [0.82, 0.83, 0.85]);
    api.box(u + 0.05, u + 0.65, 0.95, 1.05, 1.45, 1.95, [0.25, 0.26, 0.28]);
    api.box(u + 0.1, u + 0.4, 0.6, 0.64, 1.35, 1.4, [0.95, 0.95, 0.95]);
    backShelf(api, 0.3, w - 0.3, back, 'cuadernos', 2.2, 0.35, [0.8, 0.82, 0.84]);
  },
  heladeria(api, w, depth, back, rng) {
    // Congelador con tapa de vidrio y vitrina de sabores.
    counter(api, w * 0.35, w - 0.15, 1.4, 2.0, 'vitrina-helado', WHITE, 1.05);
    api.box(w * 0.35 + 0.05, w - 0.2, 1.05, 1.08, 1.45, 1.95, GLOW_COLD);
    tableSet(api, 0.75, 0.9, rng, 2);
    if (w > 3.4) tableSet(api, 0.75, 2.2, rng, 1);
    api.front('tablero', w * 0.4, w - 0.3, 1.5, 2.3, back - 0.02);
  },
  cafeteria(api, w, depth, back, rng) {
    counter(api, w * 0.4, w - 0.1, 1.3, 1.85, 'vitrina-comida', STEEL, 1.05);
    api.box(w * 0.42, w - 0.12, 1.05, 1.35, 1.35, 1.8, [0.9, 0.95, 1.0].map((v) => v * 1.3));
    // Greca y mesón de atrás.
    api.box(w * 0.4, w - 0.1, 0, 0.95, back - 0.5, back, [0.35, 0.22, 0.14]);
    api.box(w - 0.7, w - 0.35, 0.95, 1.45, back - 0.4, back - 0.1, [0.7, 0.71, 0.73]);
    tableSet(api, 0.75, 1.0, rng, 2);
    if (w > 3.2) tableSet(api, 0.75, 2.3, rng, 1);
    else fridge(api, 0.12, 2.2, 0.62, rng);
  },
  billares(api, w, depth, back, rng) {
    // Mesa de billar con su lámpara colgada, barra y canastas.
    const u0 = Math.max(0.35, w / 2 - 1.3);
    const u1 = Math.min(w - 0.35, w / 2 + 1.3);
    const d0 = 1.05;
    const d1 = 2.35;
    for (const [a, b] of [[u0 + 0.1, d0 + 0.1], [u1 - 0.22, d0 + 0.1], [u0 + 0.1, d1 - 0.22], [u1 - 0.22, d1 - 0.22]]) api.box(a, a + 0.12, 0, 0.66, b, b + 0.12, [0.25, 0.14, 0.07]);
    api.box(u0, u1, 0.66, 0.8, d0, d1, [0.32, 0.18, 0.09]);
    api.box(u0 + 0.12, u1 - 0.12, 0.8, 0.82, d0 + 0.12, d1 - 0.12, [0.03, 0.32, 0.14]);
    api.box(u0, u1, 0.8, 0.86, d0, d0 + 0.12, [0.32, 0.18, 0.09]);
    api.box(u0, u1, 0.8, 0.86, d1 - 0.12, d1, [0.32, 0.18, 0.09]);
    api.box(u0, u0 + 0.12, 0.8, 0.86, d0, d1, [0.32, 0.18, 0.09]);
    api.box(u1 - 0.12, u1, 0.8, 0.86, d0, d1, [0.32, 0.18, 0.09]);
    for (let k = 0; k < 5; k++) api.box(u0 + 0.4 + k * 0.23, u0 + 0.46 + k * 0.23, 0.82, 0.88, d0 + 0.4 + (k % 2) * 0.3, d0 + 0.46 + (k % 2) * 0.3, rng.pick([[0.9, 0.9, 0.85], [0.8, 0.1, 0.1], [0.95, 0.75, 0.1], [0.1, 0.1, 0.1]]));
    // Lámpara verde con luz cálida.
    api.box(w / 2 - 0.6, w / 2 + 0.6, 1.72, 1.9, (d0 + d1) / 2 - 0.18, (d0 + d1) / 2 + 0.18, [0.05, 0.25, 0.1]);
    api.box(w / 2 - 0.55, w / 2 + 0.55, 1.7, 1.72, (d0 + d1) / 2 - 0.14, (d0 + d1) / 2 + 0.14, GLOW_WARM);
    api.box(w / 2 - 0.01, w / 2 + 0.01, 1.9, 2.6, (d0 + d1) / 2 - 0.01, (d0 + d1) / 2 + 0.01, BLACK);
    crates(api, 0.1, back - 0.4, rng.int(2, 4), rng);
    api.box(w - 0.9, w - 0.1, 0, 1.05, back - 0.55, back - 0.05, [0.3, 0.18, 0.1]);
    fridge(api, w - 0.85, back - 1.25, 0.7, rng, [0.6, 0.08, 0.08]);
  },
  ropa(api, w, depth, back, rng) {
    // Maniquíes en la vitrina, percheros a los lados, mesa de ropa doblada,
    // exhibidor de gorras y espejo.
    const n = w > 3.6 ? 2 : 1;
    for (let k = 0; k < n; k++) mannequin(api, n === 1 ? w * 0.3 : w * (0.22 + k * 0.56), 0.55, rng);
    rack(api, 0.1, 0.62, 1.5, rng);
    api.side('percha', 0.03, 0.4, 2.2, 1.0, back - 0.1, 1);
    rack(api, w - 0.62, w - 0.1, 1.7, rng);
    // Mesa con ropa doblada.
    const mu = w / 2;
    api.box(mu - 0.5, mu + 0.5, 0, 0.8, 1.8, 2.4, WOOD_L);
    for (let k = 0; k < 5; k++) api.box(mu - 0.45 + k * 0.19, mu - 0.3 + k * 0.19, 0.8, 0.8 + rng.range(0.08, 0.2), 1.9, 2.25, hex(rng.pick(ROPA.filter((r) => r.color != null)).color));
    backShelf(api, 0.3, w - 0.3, back, rng.chance(0.5) ? 'gorras' : 'ropa-doblada', 2.3, 0.3, [0.85, 0.85, 0.83]);
    api.side('espejo', w - 0.03, 0.3, 2.0, back - 0.8, back - 0.2, -1);
  },
};
