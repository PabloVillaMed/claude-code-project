// Techos de las casas según su tipo (ver sim/cityLayout.js pickRoof):
//  - terraza: plancha con muro perimetral, tanque y a veces el "cuarto útil".
//  - plancha: losa sin terminar, con varillas esperando el siguiente piso.
//  - dosAguas: teja de barro a dos aguas con culatas.
//  - cuatroAguas: teja de barro a cuatro aguas (las casas viejas de Aranjuez).
//  - zinc: teja de zinc o de fibrocemento a un agua, con piedras y llantas encima.
//  - torre: remate piramidal del campanario.
// Todo en el marco orientado de la casa (u a lo largo de la calle, v hacia ella).

import { orientedQuad, orientedTri } from './drape.js';

export const PARAPET = 0.75;

/** Colores de la teja de zinc: oxidada, galvanizada, fibrocemento gris, pintada. */
const ZINC_TINTS = [
  [0.72, 0.5, 0.36],
  [0.62, 0.42, 0.32],
  [0.85, 0.86, 0.87],
  [0.7, 0.71, 0.7],
  [0.55, 0.6, 0.62],
  [0.48, 0.6, 0.5],
];
const TILE_TINTS = [
  [1, 1, 1],
  [0.92, 0.86, 0.8],
  [1.05, 0.95, 0.9],
  [0.82, 0.76, 0.72],
];

/** Altura de muro sobre el techo (terraza) que la fachada debe cubrir. */
export function roofParapet(b) {
  if (b.style === 'muro') return 0;
  return b.roof === 'terraza' || b.roof === 'torre' ? (b.tower ? 0 : PARAPET) : 0;
}

/**
 * Construye el techo de `b`. `G(key)` devuelve el GeoBuilder del material
 * ('roof', 'concrete', 'tiles', 'zinc', 'gable'); `out` recoge tanques y varillas.
 */
export function buildRoof(b, G, rng, out) {
  const f = b.frame;
  const top = b.topY;
  // Local (u, v) → mundo.
  const W = (u, v, y) => [f.x + f.ux * u + f.nx * v, y, f.z + f.uz * u + f.nz * v];
  const N = (nu, ny, nv) => {
    const x = f.ux * nu + f.nx * nv;
    const z = f.uz * nu + f.nz * nv;
    const l = Math.hypot(x, ny, z) || 1;
    return [x / l, ny / l, z / l];
  };
  const { hu, hv } = f;
  const UP = [0, 1, 0];
  const wallColor = b.style === 'ladrillo' ? [0.72, 0.45, 0.32] : b.color;

  const flat = (y, h0 = hu, v0 = hv, key = 'roof') => {
    orientedQuad(G(key), [W(-h0, -v0, y), W(h0, -v0, y), W(h0, v0, y), W(-h0, v0, y)], UP, [
      [(-h0 + f.x) / 6, (-v0 + f.z) / 6],
      [(h0 + f.x) / 6, (-v0 + f.z) / 6],
      [(h0 + f.x) / 6, (v0 + f.z) / 6],
      [(-h0 + f.x) / 6, (v0 + f.z) / 6],
    ]);
  };
  // Caja orientada (u0..u1, v0..v1, y0..y1) sin cara inferior.
  const box = (g, u0, u1, v0, v1, y0, y1, color) => {
    const du = u1 - u0;
    const dv = v1 - v0;
    const dy = y1 - y0;
    orientedQuad(g, [W(u0, v1, y0), W(u1, v1, y0), W(u1, v1, y1), W(u0, v1, y1)], N(0, 0, 1), [[0, 0], [du / 3, 0], [du / 3, dy / 3], [0, dy / 3]], color);
    orientedQuad(g, [W(u1, v0, y0), W(u0, v0, y0), W(u0, v0, y1), W(u1, v0, y1)], N(0, 0, -1), [[0, 0], [du / 3, 0], [du / 3, dy / 3], [0, dy / 3]], color);
    orientedQuad(g, [W(u1, v1, y0), W(u1, v0, y0), W(u1, v0, y1), W(u1, v1, y1)], N(1, 0, 0), [[0, 0], [dv / 3, 0], [dv / 3, dy / 3], [0, dy / 3]], color);
    orientedQuad(g, [W(u0, v0, y0), W(u0, v1, y0), W(u0, v1, y1), W(u0, v0, y1)], N(-1, 0, 0), [[0, 0], [dv / 3, 0], [dv / 3, dy / 3], [0, dy / 3]], color);
    orientedQuad(g, [W(u0, v0, y1), W(u1, v0, y1), W(u1, v1, y1), W(u0, v1, y1)], UP, [[0, 0], [du / 3, 0], [du / 3, dv / 3], [0, dv / 3]], color);
  };
  const tank = (y) => {
    if (!b.tank) return;
    const u = rng.range(-hu + 1.2, Math.max(-hu + 1.3, hu - 1.2));
    const v = rng.range(-hv + 1.2, Math.max(-hv + 1.3, hv - 1.2));
    const [x, , z] = W(u, v, 0);
    out.tanks.push({ x, z, y, blue: rng.chance(0.35) });
  };
  const rebar = (y) => {
    for (const [cu, cv] of [
      [-hu + 0.25, -hv + 0.25],
      [hu - 0.25, -hv + 0.25],
      [-hu + 0.25, hv - 0.25],
      [hu - 0.25, hv - 0.25],
    ]) {
      for (let k = 0; k < 4; k++) {
        const [x, , z] = W(cu + (k % 2) * 0.1, cv + (k >> 1) * 0.1, 0);
        out.rebar.push(x, y, z, x + rng.range(-0.05, 0.05), y + rng.range(0.8, 1.4), z + rng.range(-0.05, 0.05));
      }
    }
  };

  switch (b.roof) {
    case 'torre': {
      if (b.tower) {
        // Pirámide del campanario.
        const h = 5;
        const pts = [W(-hu, -hv, top), W(hu, -hv, top), W(hu, hv, top), W(-hu, hv, top)];
        const apex = W(0, 0, top + h);
        const ns = [N(0, 0.6, -1), N(1, 0.6, 0), N(0, 0.6, 1), N(-1, 0.6, 0)];
        for (let k = 0; k < 4; k++) orientedTri(G('tiles'), [pts[k], pts[(k + 1) % 4], apex], ns[k], [[0, 0], [(2 * hu) / 3, 0], [hu / 3, h / 3]]);
        return;
      }
      // Edificio alto: terraza con muro.
    }
    // falls through
    case 'terraza': {
      flat(top);
      const t = 0.18;
      const p = top + PARAPET;
      const g = G('roof');
      // Caras internas del muro y remate.
      orientedQuad(g, [W(-hu + t, hv - t, top), W(hu - t, hv - t, top), W(hu - t, hv - t, p), W(-hu + t, hv - t, p)], N(0, 0, -1), [[0, 0], [hu / 1.5, 0], [hu / 1.5, 0.25], [0, 0.25]]);
      orientedQuad(g, [W(-hu + t, -hv + t, top), W(hu - t, -hv + t, top), W(hu - t, -hv + t, p), W(-hu + t, -hv + t, p)], N(0, 0, 1), [[0, 0], [hu / 1.5, 0], [hu / 1.5, 0.25], [0, 0.25]]);
      orientedQuad(g, [W(-hu + t, -hv + t, top), W(-hu + t, hv - t, top), W(-hu + t, hv - t, p), W(-hu + t, -hv + t, p)], N(1, 0, 0), [[0, 0], [hv / 1.5, 0], [hv / 1.5, 0.25], [0, 0.25]]);
      orientedQuad(g, [W(hu - t, -hv + t, top), W(hu - t, hv - t, top), W(hu - t, hv - t, p), W(hu - t, -hv + t, p)], N(-1, 0, 0), [[0, 0], [hv / 1.5, 0], [hv / 1.5, 0.25], [0, 0.25]]);
      const cap = [0.85, 0.85, 0.82];
      const c = G('concrete');
      orientedQuad(c, [W(-hu, hv - t, p), W(hu, hv - t, p), W(hu, hv, p), W(-hu, hv, p)], UP, [[0, 0], [1, 0], [1, 0.05], [0, 0.05]], cap);
      orientedQuad(c, [W(-hu, -hv, p), W(hu, -hv, p), W(hu, -hv + t, p), W(-hu, -hv + t, p)], UP, [[0, 0], [1, 0], [1, 0.05], [0, 0.05]], cap);
      orientedQuad(c, [W(-hu, -hv + t, p), W(-hu + t, -hv + t, p), W(-hu + t, hv - t, p), W(-hu, hv - t, p)], UP, [[0, 0], [1, 0], [1, 1], [0, 1]], cap);
      orientedQuad(c, [W(hu - t, -hv + t, p), W(hu, -hv + t, p), W(hu, hv - t, p), W(hu - t, hv - t, p)], UP, [[0, 0], [1, 0], [1, 1], [0, 1]], cap);
      // Cuarto útil / caja de la escalera con su techito de zinc.
      if (!b.tower && b.style !== 'torre' && hu > 3 && hv > 3.5 && rng.chance(0.35)) {
        const w = Math.min(1.4, hu - 1.2);
        const d = Math.min(1.6, hv - 1.5);
        const cu = rng.chance(0.5) ? -hu + t + w : hu - t - w;
        const cv = -hv + t + d;
        box(G('gable'), cu - w, cu + w, cv - d, cv + d, top, top + 2.4, wallColor);
        const z = G('zinc');
        const tint = ZINC_TINTS[rng.int(0, ZINC_TINTS.length - 1)];
        orientedQuad(z, [W(cu - w - 0.2, cv - d - 0.2, top + 2.6), W(cu + w + 0.2, cv - d - 0.2, top + 2.6), W(cu + w + 0.2, cv + d + 0.3, top + 2.35), W(cu - w - 0.2, cv + d + 0.3, top + 2.35)], N(0, 1, 0.1), [[0, 0], [(2 * w) / 3, 0], [(2 * w) / 3, (2 * d) / 3], [0, (2 * d) / 3]], tint);
      } else tank(top);
      if (b.floors <= 4 && b.style !== 'torre' && rng.chance(0.25)) rebar(p);
      return;
    }
    case 'plancha': {
      // Losa que sobresale un poco, con el borde a la vista.
      const o = 0.12;
      const y = top + 0.04;
      flat(y, hu + o, hv + o);
      const c = G('concrete');
      const edge = [0.78, 0.77, 0.74];
      for (const [nu, nv] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ]) {
        const au = nu ? nu * (hu + o) : -(hu + o);
        const bu = nu ? nu * (hu + o) : hu + o;
        const av = nv ? nv * (hv + o) : -(hv + o);
        const bv = nv ? nv * (hv + o) : hv + o;
        orientedQuad(c, [W(au, av, top - 0.16), W(bu, bv, top - 0.16), W(bu, bv, y), W(au, av, y)], N(nu, 0, nv), [[0, 0], [2, 0], [2, 0.05], [0, 0.05]], edge);
      }
      tank(y);
      // Muy de barrio: varillas esperando el próximo piso.
      if (rng.chance(0.65)) rebar(y);
      return;
    }
    case 'dosAguas':
    case 'cuatroAguas': {
      const hip = b.roof === 'cuatroAguas';
      // Cumbrera a lo largo del lado más largo.
      const alongU = hu >= hv;
      const L = alongU ? hu : hv; // medio largo
      const S = alongU ? hv : hu; // medio ancho
      const rise = Math.min(2.6, Math.max(0.9, S * 0.5));
      const o = 0.45;
      const drop = (rise * o) / S;
      const ye = top - drop; // altura del alero
      const yr = top + rise;
      // (a, s): a a lo largo de la cumbrera, s a través; → (u, v).
      const P = (a, s, y) => (alongU ? W(a, s, y) : W(s, a, y));
      const Nl = (na, ny, ns) => (alongU ? N(na, ny, ns) : N(ns, ny, na));
      const g = G('tiles');
      const tint = TILE_TINTS[rng.int(0, TILE_TINTS.length - 1)];
      const slope = Math.hypot(rise + drop, S + o);
      const ridge = hip ? Math.max(0, L - S) : L + o;
      const ea = L + o;
      const uvs = (w) => [[0, 0], [w / 3, 0], [w / 3, slope / 3], [0, slope / 3]];
      // Faldones largos (trapecios si es a cuatro aguas).
      for (const sgn of [1, -1]) {
        const n = Nl(0, S / rise, sgn);
        orientedQuad(g, [P(-ea, sgn * (S + o), ye), P(ea, sgn * (S + o), ye), P(ridge, 0, yr), P(-ridge, 0, yr)], n, uvs(2 * ea), tint);
      }
      if (hip) {
        for (const sgn of [1, -1]) {
          const n = Nl(sgn, S / rise, 0);
          orientedTri(g, [P(sgn * ea, -(S + o), ye), P(sgn * ea, S + o, ye), P(sgn * ridge, 0, yr)], n, [[0, 0], [(2 * (S + o)) / 3, 0], [(S + o) / 3, slope / 3]], tint);
        }
      } else {
        // Culatas triangulares del color de la casa.
        const gg = G('gable');
        for (const sgn of [1, -1]) {
          orientedTri(gg, [P(sgn * L, -S, top), P(sgn * L, S, top), P(sgn * L, 0, yr - 0.05)], Nl(sgn, 0, 0), [[0, 0], [(2 * S) / 3, 0], [S / 3, rise / 3]], wallColor);
        }
      }
      return;
    }
    case 'zinc': {
      // Un agua: alto atrás, bajo al frente (el agua cae a la calle).
      const o = 0.55;
      const rise = rng.range(0.5, 1.0);
      const yb = top + rise; // atrás
      const yf = top - 0.05; // frente
      const tint = ZINC_TINTS[rng.int(0, ZINC_TINTS.length - 1)];
      const slopeV = (yb - yf) / (2 * hv);
      const z = G('zinc');
      const len = Math.hypot(2 * hv + 2 * o, yb - yf);
      orientedQuad(z, [W(-hu - 0.15, -hv - 0.2, yb + slopeV * 0.2), W(hu + 0.15, -hv - 0.2, yb + slopeV * 0.2), W(hu + 0.15, hv + o, yf - slopeV * o), W(-hu - 0.15, hv + o, yf - slopeV * o)], N(0, 1, slopeV), [[0, 0], [(2 * hu) / 3, 0], [(2 * hu) / 3, len / 3], [0, len / 3]], tint);
      // Muro que cierra el hueco bajo la teja (culatas y trasera).
      const gg = G('gable');
      orientedTri(gg, [W(-hu, -hv, top), W(-hu, hv, top), W(-hu, -hv, yb)], N(-1, 0, 0), [[0, 0], [(2 * hv) / 3, 0], [0, rise / 3]], wallColor);
      orientedTri(gg, [W(hu, -hv, top), W(hu, hv, top), W(hu, -hv, yb)], N(1, 0, 0), [[0, 0], [(2 * hv) / 3, 0], [0, rise / 3]], wallColor);
      orientedQuad(gg, [W(-hu, -hv, top), W(hu, -hv, top), W(hu, -hv, yb), W(-hu, -hv, yb)], N(0, 0, -1), [[0, 0], [(2 * hu) / 3, 0], [(2 * hu) / 3, rise / 3], [0, rise / 3]], wallColor);
      // Piedras y llantas para que el viento no se lleve la teja.
      const n = rng.int(0, 4);
      const c = G('concrete');
      for (let k = 0; k < n; k++) {
        const u = rng.range(-hu + 0.6, hu - 0.6);
        const v = rng.range(-hv + 0.6, hv - 0.6);
        const y = yf + ((hv - v) / (2 * hv)) * (yb - yf);
        const s = rng.range(0.18, 0.3);
        box(c, u - s, u + s, v - s, v + s, y, y + s * (rng.chance(0.4) ? 0.6 : 1.1), rng.chance(0.4) ? [0.12, 0.12, 0.13] : [0.55, 0.53, 0.5]);
      }
      return;
    }
    default:
      flat(top);
  }
}
