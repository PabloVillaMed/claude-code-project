// Geometría de las fachadas modeladas (a partir de sim/facades.js): muro con
// huecos reales, vanos con marco de aluminio, vidrio, alféizar, reja y
// cortinas; puertas metálicas, garajes y locales con cortina enrollable,
// interior iluminado, mostrador, nevera, aviso y toldo; vigas y columnas de
// concreto a la vista, zócalo enchapado, balcones y contador de energía.
// Las culatas y la parte de atrás quedan en ladrillo a la vista.
//
// Todo se acumula por material en zonas de 3x3 manzanas (pocas llamadas de
// dibujo y recorte por cámara); los detalles pequeños (marcos, rejas,
// cortinas, contadores) se ocultan más allá de quality.detailDraw.

import * as THREE from 'three';
import { GeoBuilder } from './geoBuilder.js';
import { photoMaterial, PHOTO_TEXTURES } from './photoMaterials.js';
import { CURTAIN_COLORS, FACADE, FRAME_COLORS, METAL_COLORS, SIGN_NAMES, ZOCALO_COLORS, faceFrame } from '../sim/facades.js';
import { MAP_MIN_X, MAP_MIN_Z } from '../sim/terrain.js';
import { makeRng } from '../sim/rng.js';
import { AWNING_SLOTS, DOOR_SLOTS, GRILLE_SLOTS, SIGN_COLS, SIGN_ROWS, awningAtlas, doorAtlas, grilleAtlas, signAtlas, slot, wallDirt } from './facadeTextures.js';
import { ATLAS, BACK_M, INTERIOR_KINDS, SIDE_M, interiorAtlas, shopProps } from './shopInteriors.js';

const CHUNK = 360; // m por lado de cada trozo (menos llamadas de dibujo en el mapa grande)
// Utilería de adentro de los locales: celdas más chicas, que solo se dibujan
// cerca (de lejos queda el cuarto pintado: fondo, paredes, piso y techo).
const CELL = 80;
// Materiales de detalle: se ocultan de lejos.
const DETAIL = new Set(['detail', 'grille']);
// Relieve de la fachada (jambas, vigas, columnas, balcones, toldos): a media
// distancia ya no se distingue y en el mapa real son millones de triángulos.
const MID = new Set(['trim', 'awning', 'railingBars']);
// Materiales que no proyectan sombra (planos finos o hundidos en el muro).
const NO_SHADOW = new Set(['glass', 'glassLit', 'grille', 'interior', 'shopProps', 'shopTex', 'sign', 'detail', 'gres', 'granito', 'door']);
const LIT_WARM = [1, 0.77, 0.5];
const LIT_COOL = [0.72, 0.82, 1];

const WALLS = {
  brick0: 'red_brick',
  brick1: 'large_red_bricks',
  brick2: 'brick_wall_07',
  plaster0: 'painted_plaster_wall',
  plaster1: 'beige_wall_001',
  paintedBrick: 'painted_brick',
  peeling: 'peeling_painted_wall',
};

const WHITE = [1, 1, 1];
const UP_ = [0, 1, 0];
const DOWN_ = [0, -1, 0];
// Piso de cada tipo de local (los demás: baldosa roja o granito al azar).
const FLOORS = { carniceria: 'piso-granito', drogueria: 'piso-granito', peluqueria: 'piso-ajedrez', heladeria: 'piso-ajedrez', ropa: 'piso-granito', billares: 'piso-rojo' };
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/** Cuadrilátero con la normal pedida (voltea el orden si hace falta). */
function face(g, pts, n, uvs, color = WHITE) {
  color ??= WHITE;
  _a.fromArray(pts[1]).sub(_b.fromArray(pts[0]));
  _c.fromArray(pts[2]).sub(_b);
  const cr = _a.cross(_c);
  if (cr.x * n[0] + cr.y * n[1] + cr.z * n[2] < 0) {
    g.quad(pts[0], pts[3], pts[2], pts[1], n, [uvs[0], uvs[3], uvs[2], uvs[1]], color);
  } else {
    g.quad(pts[0], pts[1], pts[2], pts[3], n, uvs, color);
  }
}

const lighten = (c, k = 1.1, add = 0.04) => c.map((v) => Math.min(1, v * k + add));

/**
 * Luz propia por vértice: el color hasta 1 tiñe (y se ilumina un poco con la
 * luz del local); lo que pase de 1 brilla (tubos, neveras, lámparas). Así la
 * utilería y los interiores van en un solo material cada uno.
 */
function selfLit(m, key) {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', 'vec3 litBase = min( vColor.rgb, vec3( 1.0 ) );\n  vec3 litGlow = max( vColor.rgb - 1.0, vec3( 0.0 ) );\n  diffuseColor.rgb *= litBase;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= litBase + litGlow * 2.0;');
  };
  m.customProgramCacheKey = () => key;
  return m;
}

export class FacadeBuilder {
  constructor(r) {
    this.r = r;
    this.quality = r.quality;
    this.groups = new Map();
    this.chunks = new Map(); // clave -> {minX,maxX,minZ,maxZ, detail: []}
    this.cells = new Map(); // celdas de utilería de los locales: clave -> {minX,maxX,minZ,maxZ, meshes: []}
    this.shops = []; // locales dibujados: nombre, tipo y frente (capturas y pruebas)
    this.mats = this._materials();
  }

  // ------------------------------------------------------------ materiales
  _materials() {
    const r = this.r;
    const dirt = wallDirt(9);
    const wall = (id) => {
      const m = photoMaterial(id, { uvMeters: 1, vertexColors: true, normalScale: 1.1 });
      if (!m) return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
      const k = (PHOTO_TEXTURES[id]?.m ?? 2) / 12;
      m.onBeforeCompile = (shader) => {
        shader.uniforms.dirtMap = { value: dirt };
        shader.uniforms.dirtScale = { value: k };
        shader.fragmentShader = `uniform sampler2D dirtMap;\nuniform float dirtScale;\n${shader.fragmentShader}`.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          vec4 dirtC = texture2D( dirtMap, vMapUv * dirtScale );
          diffuseColor.rgb = mix( diffuseColor.rgb, dirtC.rgb, dirtC.a );`,
        );
      };
      m.customProgramCacheKey = () => 'muro-sucio';
      return m;
    };
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const litGlass = () => {
      const g = std({ color: 0x3a4248, vertexColors: true, roughness: 0.08, metalness: 0.45, envMapIntensity: 2.2, emissive: 0xffffff, emissiveIntensity: 0 });
      g.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vColor.rgb;');
      };
      g.customProgramCacheKey = () => 'vidrio-encendido';
      return g;
    };
    const night = (m, max, base = 0) => {
      r.nightMaterials.push({ m, max, base });
      return m;
    };
    const interiorTex = interiorAtlas();
    const signTex = signAtlas();
    const m = {
      trim: photoMaterial('concrete_wall_008', { uvMeters: 1, vertexColors: true }) ?? std({ vertexColors: true, roughness: 0.9 }),
      // Vidrio: bastante reflectivo (refleja el cielo) y teñido por casa.
      glass: std({ vertexColors: true, roughness: 0.06, metalness: 0.5, envMapIntensity: 2.4 }),
      // Ventanas que se encienden de noche: la luz toma el color del vértice
      // (cálida o fría de televisor), así ambas van en una sola llamada.
      glassLit: night(litGlass(), 1.2),
      // Marcos, cortinas, mostradores, contadores, ropa, antenas: un material.
      detail: std({ vertexColors: true, metalness: 0.3, roughness: 0.6 }),
      grille: std({ vertexColors: true, alphaMap: grilleAtlas(), alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.35, roughness: 0.55 }),
      door: std({ map: doorAtlas(), vertexColors: true, metalness: 0.3, roughness: 0.5 }),
      shutter: photoMaterial('painted_metal_shutter', { uvMeters: 1, vertexColors: true, extra: { metalness: 0.35 } }) ?? std({ vertexColors: true, metalness: 0.4, roughness: 0.5 }),
      // Cuarto de cada local (atlas pintado) y la utilería de adentro; los
      // tubos del cielo raso los alumbran de día y de noche.
      interior: night(selfLit(std({ map: interiorTex, emissiveMap: interiorTex, vertexColors: true, emissive: 0xfff6ea, emissiveIntensity: 0.32, roughness: 0.8 }), 'interior-local'), 0.55, 0.32),
      shopProps: night(selfLit(std({ vertexColors: true, emissive: 0xfff6ea, emissiveIntensity: 0.22, roughness: 0.65, metalness: 0.1 }), 'utileria-local'), 0.4, 0.22),

      sign: night(std({ map: signTex, emissiveMap: signTex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.7 }), 0.45),
      awning: std({ map: awningAtlas(), side: THREE.DoubleSide, roughness: 0.92 }),
      gres: photoMaterial('dirty_tiles', { uvMeters: 1, roughness: 0.6 }) ?? std({ color: 0x8a3b22, roughness: 0.6 }),
      granito: photoMaterial('granite_tile', { uvMeters: 1, roughness: 0.5 }) ?? std({ color: 0x777777, roughness: 0.5 }),
      zinc: photoMaterial('corrugated_iron_02', { uvMeters: 1, vertexColors: true, extra: { metalness: 0.4, side: THREE.DoubleSide } }) ?? std({ vertexColors: true, metalness: 0.4, roughness: 0.6, side: THREE.DoubleSide }),
    };
    m.shopTex = m.interior;
    for (const [k, id] of Object.entries(WALLS)) m[k] = wall(id);
    return m;
  }

  // ------------------------------------------------------------ utilidades
  _chunkOf(b) {
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const ci = Math.max(0, Math.floor((cx - MAP_MIN_X) / CHUNK));
    const cj = Math.max(0, Math.floor((cz - MAP_MIN_Z) / CHUNK));
    const key = `${ci},${cj}`;
    let c = this.chunks.get(key);
    if (!c) this.chunks.set(key, (c = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, detail: [], mid: [] }));
    c.minX = Math.min(c.minX, b.minX);
    c.maxX = Math.max(c.maxX, b.maxX);
    c.minZ = Math.min(c.minZ, b.minZ);
    c.maxZ = Math.max(c.maxZ, b.maxZ);
    return key;
  }

  /** Celda de utilería de los locales que contiene el punto (x, z). */
  _cellOf(x, z) {
    const key = `c:${Math.floor((x - MAP_MIN_X) / CELL)},${Math.floor((z - MAP_MIN_Z) / CELL)}`;
    let c = this.cells.get(key);
    if (!c) this.cells.set(key, (c = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, meshes: [] }));
    c.minX = Math.min(c.minX, x - 4);
    c.maxX = Math.max(c.maxX, x + 4);
    c.minZ = Math.min(c.minZ, z - 4);
    c.maxZ = Math.max(c.maxZ, z + 4);
    return key;
  }

  _g(chunk, key) {
    const k = `${chunk}|${key}`;
    let g = this.groups.get(k);
    if (!g) this.groups.set(k, (g = new GeoBuilder()));
    return g;
  }

  // ------------------------------------------------------------ una casa
  /** Agrega la casa `b` con su distribución `L` (facadeLayout); `parapet` = muro de terraza. */
  add(b, L, parapet) {
    const chunk = this._chunkOf(b);
    const G = (key) => this._g(chunk, key);
    const f = L.face;
    const gy = b.groundY;
    const len = f.len;
    const top = L.height + parapet;
    const rng = makeRng(Math.floor((b.minX * 73 + b.minZ * 37) * 10));
    const P = (u, v, off = 0) => [f.x0 + f.rx * u + f.nx * off, gy + v, f.z0 + f.rz * u + f.nz * off];
    const N = [f.nx, 0, f.nz];
    const R = [f.rx, 0, f.rz];
    const L_ = [-f.rx, 0, -f.rz];
    const UP = [0, 1, 0];
    const DOWN = [0, -1, 0];
    const uOff = rng.range(0, 8);

    // Muro de la fachada principal y su color.
    const wallKey = L.wall === 'brick' ? `brick${L.variant}` : L.wall === 'plaster' ? `plaster${L.variant % 2}` : L.wall === 'tower' ? 'plaster0' : L.wall;
    const tint = rng.range(0.92, 1.05);
    const wallColor = L.wall === 'brick' ? [tint, tint * rng.range(0.95, 1), tint * rng.range(0.92, 1)] : b.color;
    const trimColor = L.wall === 'brick' || L.wall === 'tower' ? [0.74, 0.73, 0.7] : lighten(b.color, 1.02, 0.06);
    // Tinte del vidrio de la casa: gris oscuro, bronce, azul reflectivo o verdoso.
    const glassTint = rng.pick([[0.3, 0.34, 0.37], [0.42, 0.33, 0.24], [0.28, 0.38, 0.48], [0.3, 0.42, 0.38], [0.36, 0.38, 0.4]]);

    // Cuadrilátero plano sobre la fachada (u, v en metros; off hacia la calle).
    const fq = (g, u0, u1, v0, v1, off, uv, color) => face(g, [P(u0, v0, off), P(u1, v0, off), P(u1, v1, off), P(u0, v1, off)], N, uv ?? [[(uOff + u0), v0], [(uOff + u1), v0], [(uOff + u1), v1], [(uOff + u0), v1]], color);
    // Caja en coordenadas de fachada.
    // Caja orientada en coordenadas de fachada (u a lo largo, v alto, off hacia la calle).
    const fbox = (g, u0, u1, v0, v1, o0, o1, color, uvScale = 1) => {
      const k = 1 / uvScale;
      const du = (u1 - u0) * k;
      const dv = (v1 - v0) * k;
      const dd = (o1 - o0) * k;
      face(g, [P(u0, v0, o1), P(u1, v0, o1), P(u1, v1, o1), P(u0, v1, o1)], N, [[0, 0], [du, 0], [du, dv], [0, dv]], color);
      face(g, [P(u1, v0, o0), P(u0, v0, o0), P(u0, v1, o0), P(u1, v1, o0)], [-N[0], 0, -N[2]], [[0, 0], [du, 0], [du, dv], [0, dv]], color);
      face(g, [P(u1, v0, o1), P(u1, v0, o0), P(u1, v1, o0), P(u1, v1, o1)], R, [[0, 0], [dd, 0], [dd, dv], [0, dv]], color);
      face(g, [P(u0, v0, o0), P(u0, v0, o1), P(u0, v1, o1), P(u0, v1, o0)], L_, [[0, 0], [dd, 0], [dd, dv], [0, dv]], color);
      face(g, [P(u0, v1, o1), P(u1, v1, o1), P(u1, v1, o0), P(u0, v1, o0)], UP, [[0, 0], [du, 0], [du, dd], [0, dd]], color);
      face(g, [P(u0, v0, o0), P(u1, v0, o0), P(u1, v0, o1), P(u0, v0, o1)], DOWN, [[0, 0], [du, 0], [du, dd], [0, dd]], color);
    };
    // Muro con huecos: franjas verticales entre los bordes de los huecos.
    const wallWithHoles = (g, holes, vMin, vMax, off, color) => {
      const us = [0, len];
      for (const h of holes) us.push(Math.max(0, h.u0), Math.min(len, h.u1));
      us.sort((a, c) => a - c);
      for (let i = 0; i < us.length - 1; i++) {
        const ua = us[i];
        const ub = us[i + 1];
        if (ub - ua < 1e-4) continue;
        const mid = (ua + ub) / 2;
        const spans = holes.filter((h) => h.u0 < mid && h.u1 > mid).map((h) => [h.v0, h.v1]).sort((a, c) => a[0] - c[0]);
        let v = vMin;
        for (const [a, c] of spans) {
          if (a > v) fq(g, ua, ub, v, Math.min(a, vMax), off, null, color);
          v = Math.max(v, c);
          if (v >= vMax) break;
        }
        if (vMax > v) fq(g, ua, ub, v, vMax, off, null, color);
      }
    };
    // Jambas del vano (hacia adentro, profundidad D).
    const reveal = (o, D, color, bottom = true) => {
      const g = G('trim');
      face(g, [P(o.u0, o.v0, 0), P(o.u0, o.v0, -D), P(o.u0, o.v1, -D), P(o.u0, o.v1, 0)], R, [[0, o.v0], [D, o.v0], [D, o.v1], [0, o.v1]], color);
      face(g, [P(o.u1, o.v0, 0), P(o.u1, o.v0, -D), P(o.u1, o.v1, -D), P(o.u1, o.v1, 0)], L_, [[0, o.v0], [D, o.v0], [D, o.v1], [0, o.v1]], color);
      face(g, [P(o.u0, o.v1, 0), P(o.u1, o.v1, 0), P(o.u1, o.v1, -D), P(o.u0, o.v1, -D)], DOWN, [[o.u0, 0], [o.u1, 0], [o.u1, D], [o.u0, D]], color);
      if (bottom) face(g, [P(o.u0, o.v0, 0), P(o.u1, o.v0, 0), P(o.u1, o.v0, -D), P(o.u0, o.v0, -D)], UP, [[o.u0, 0], [o.u1, 0], [o.u1, D], [o.u0, D]], color);
    };
    // Rectángulo de un atlas mapeado a un cuadrilátero.
    const atlasUv = ([a0, b0, a1, b1]) => [[a0, b0], [a1, b0], [a1, b1], [a0, b1]];

    // ---- muro principal con los huecos, culatas y trasera en ladrillo
    wallWithHoles(G(wallKey), L.openings, 0, top, 0, wallColor);
    const sideKey = L.wall === 'tower' ? 'plaster0' : `brick${(L.variant + 1) % 3}`;
    const sideColor = L.wall === 'tower' ? b.color : [1, 1, 1];
    for (const side of ['N', 'S', 'W', 'E']) {
      if (side === L.side) continue;
      const s = faceFrame(b, side);
      G(sideKey).wall(s.x0, s.z0, s.nx, s.nz, s.len, gy, b.topY + parapet, 1, sideColor, rng.range(0, 5), gy);
    }

    // ---- vanos
    for (const o of L.openings) {
      if (o.kind === 'window' || o.kind === 'balconyDoor') {
        const D = 0.14;
        reveal(o, D, trimColor, true);
        if (o.lit) fq(G('glassLit'), o.u0, o.u1, o.v0, o.v1, -D + 0.01, [[0, 0], [1, 0], [1, 1], [0, 1]], o.cool ? LIT_COOL : LIT_WARM);
        else fq(G('glass'), o.u0, o.u1, o.v0, o.v1, -D + 0.01, [[0, 0], [1, 0], [1, 1], [0, 1]], glassTint);
        // Marco de aluminio con división central (corrediza).
        const fc = FRAME_COLORS[o.frame];
        const fw = 0.05;
        const fo = -D + 0.045;
        const fr = G('detail');
        fq(fr, o.u0, o.u1, o.v0, o.v0 + fw, fo, null, fc);
        fq(fr, o.u0, o.u1, o.v1 - fw, o.v1, fo, null, fc);
        fq(fr, o.u0, o.u0 + fw, o.v0, o.v1, fo, null, fc);
        fq(fr, o.u1 - fw, o.u1, o.v0, o.v1, fo, null, fc);
        const mid = (o.u0 + o.u1) / 2;
        if (o.u1 - o.u0 > 0.8) fq(fr, mid - 0.025, mid + 0.025, o.v0, o.v1, fo, null, fc);
        if (o.kind === 'balconyDoor') fq(fr, o.u0, o.u1, o.v0 + 0.95, o.v0 + 1.0, fo, null, fc);
        if (o.curtain) {
          const cw = (o.u1 - o.u0) * o.curtain.frac;
          const cu0 = o.curtain.left ? o.u0 + fw : o.u1 - fw - cw;
          fq(G('detail'), cu0, cu0 + cw, o.v0 + fw, o.v1 - fw, -D + 0.03, null, CURTAIN_COLORS[o.curtain.color]);
        }
        if (o.kind === 'window') {
          // Alféizar de concreto.
          fbox(G('trim'), o.u0 - 0.07, o.u1 + 0.07, o.v0 - 0.06, o.v0, -0.02, 0.06, trimColor);
          if (o.grille >= 0) {
            const uv = atlasUv(slot(o.grille, GRILLE_SLOTS, 1));
            fq(G('grille'), o.u0 - 0.04, o.u1 + 0.04, o.v0 - 0.02, o.v1 + 0.04, 0.035, uv, METAL_COLORS[L.metalColor]);
          }
        }
      } else if (o.kind === 'door' || o.kind === 'garage') {
        const D = o.kind === 'door' ? 0.16 : 0.12;
        reveal(o, D, trimColor, false);
        if (o.glass) {
          fq(G('glass'), o.u0, o.u1, o.v0, o.v1, -D + 0.01, [[0, 0], [1, 0], [1, 1], [0, 1]], glassTint);
          const fc = FRAME_COLORS[3];
          fq(G('detail'), (o.u0 + o.u1) / 2 - 0.03, (o.u0 + o.u1) / 2 + 0.03, o.v0, o.v1, -D + 0.04, null, fc);
        } else {
          const s = o.kind === 'garage' ? 5 : o.design % (DOOR_SLOTS - 1);
          fq(G('door'), o.u0, o.u1, o.v0, o.v1, -D + 0.01, atlasUv(slot(s, DOOR_SLOTS, 1)), METAL_COLORS[o.color]);
        }
        // Escalón de la puerta.
        if (o.kind === 'door') fbox(G('trim'), o.u0 - 0.05, o.u1 + 0.05, -0.02, 0.08, -D, 0.22, [0.62, 0.6, 0.57]);
      } else if (o.kind === 'shop') {
        this._shop(G, P, N, R, L_, fq, fbox, reveal, o, L, trimColor, rng);
      }
    }

    // ---- zócalo: enchape de gres o granito, o franja pintada de otro color
    if (L.zocalo) {
      const holes = L.openings.filter((o) => o.floor === 0 && o.v0 < L.zocalo.h);
      if (L.zocalo.kind === 'pintado') {
        const key = L.wall === 'brick' ? 'paintedBrick' : wallKey;
        wallWithHoles(G(key), holes, 0, L.zocalo.h, 0.008, ZOCALO_COLORS[L.zocalo.color]);
      } else {
        wallWithHoles(G(L.zocalo.kind === 'gres' ? 'gres' : 'granito'), holes, 0, L.zocalo.h, 0.014, null);
        fbox(G('trim'), 0, len, L.zocalo.h - 0.01, L.zocalo.h + 0.02, 0, 0.03, trimColor);
      }
    }

    // ---- tubería amarilla del gas: sube al contador y corre por la fachada
    if (L.gas) {
      const y = [0.93, 0.76, 0.08];
      const gp = G('detail');
      fbox(gp, 0.35, len - 0.35, L.gas.v - 0.025, L.gas.v + 0.025, 0.03, 0.08, y);
      fbox(gp, L.gas.u - 0.025, L.gas.u + 0.025, 0.05, L.gas.v + 0.025, 0.03, 0.08, y);
    }

    // ---- alero de teja de zinc sobre la fachada
    if (L.eave) {
      const zc = rng.pick([[0.78, 0.36, 0.25], [0.62, 0.64, 0.66], [0.52, 0.3, 0.2]]);
      const zk = G('zinc');
      face(zk, [P(-0.1, top, 0), P(len + 0.1, top, 0), P(len + 0.1, top - 0.16, 0.7), P(-0.1, top - 0.16, 0.7)], [f.nx * 0.22, 0.97, f.nz * 0.22], [[0, 0], [len + 0.2, 0], [len + 0.2, 0.72], [0, 0.72]], zc);
      fbox(G('trim'), -0.05, len + 0.05, top - 0.22, top - 0.16, 0.62, 0.7, [0.35, 0.3, 0.26]);
    }

    // ---- antena parabólica
    if (L.dish) {
      const { u, v } = L.dish;
      const col = L.dish.red ? [0.78, 0.12, 0.1] : [0.82, 0.83, 0.84];
      const g = G('detail');
      fbox(g, u - 0.03, u + 0.03, v - 0.3, v + 0.05, 0, 0.3, [0.4, 0.4, 0.42]);
      // Plato: octágono inclinado hacia arriba y hacia la calle.
      const c = P(u, v + 0.15, 0.42);
      const rad = 0.34;
      const up = 0.45;
      const pts = [];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const du = Math.cos(a) * rad;
        const dv = Math.sin(a) * rad;
        pts.push([c[0] + f.rx * du - f.nx * dv * up, c[1] + dv * 0.9, c[2] + f.rz * du - f.nz * dv * up]);
      }
      const dn = [f.nx * 0.9, 0.45, f.nz * 0.9];
      const back = [-dn[0], -dn[1], -dn[2]];
      for (let k = 0; k < 8; k++) {
        const a = pts[k];
        const b2 = pts[(k + 1) % 8];
        const cc = [c[0] - f.nx * 0.06, c[1], c[2] - f.nz * 0.06];
        g.tri(cc, a, b2, dn, [[0.5, 0.5], [0, 0], [1, 0]], col);
        g.tri(cc, b2, a, back, [[0.5, 0.5], [1, 0], [0, 0]], col);
      }
    }

    // ---- vigas de borde de placa y columnas de concreto a la vista
    if (L.frame) {
      const bc = L.wall === 'brick' ? [0.7, 0.69, 0.66] : trimColor;
      for (let fl = 1; fl <= L.floors; fl++) {
        const v = fl * L.floorH;
        fbox(G('trim'), 0, len, v - FACADE.band / 2, v + FACADE.band / 2, 0, 0.045, bc);
      }
      fbox(G('trim'), 0, FACADE.column, 0, top, 0, 0.035, bc);
      fbox(G('trim'), len - FACADE.column, len, 0, top, 0, 0.035, bc);
    }

    // ---- balcones
    for (const bal of L.balconies) {
      const depth = 0.95;
      fbox(G('trim'), bal.u0, bal.u1, bal.v - 0.14, bal.v + 0.03, 0, depth, trimColor);
      const hr = 1.0;
      const dark = [0.14, 0.15, 0.16];
      fbox(G('detail'), bal.u0, bal.u1, bal.v + hr - 0.05, bal.v + hr, depth - 0.05, depth, dark);
      fbox(G('detail'), bal.u0, bal.u0 + 0.05, bal.v + hr - 0.05, bal.v + hr, 0, depth, dark);
      fbox(G('detail'), bal.u1 - 0.05, bal.u1, bal.v + hr - 0.05, bal.v + hr, 0, depth, dark);
      const bars = G('railingBars');
      const nb = Math.round((bal.u1 - bal.u0) / 0.25);
      fq(bars, bal.u0, bal.u1, bal.v + 0.03, bal.v + hr, depth - 0.03, [[0, 0], [nb, 0], [nb, 1], [0, 1]]);
      const ns = Math.round(depth / 0.25);
      face(bars, [P(bal.u0 + 0.02, bal.v + 0.03, 0), P(bal.u0 + 0.02, bal.v + 0.03, depth), P(bal.u0 + 0.02, bal.v + hr, depth), P(bal.u0 + 0.02, bal.v + hr, 0)], L_, [[0, 0], [ns, 0], [ns, 1], [0, 1]]);
      face(bars, [P(bal.u1 - 0.02, bal.v + 0.03, 0), P(bal.u1 - 0.02, bal.v + 0.03, depth), P(bal.u1 - 0.02, bal.v + hr, depth), P(bal.u1 - 0.02, bal.v + hr, 0)], R, [[0, 0], [ns, 0], [ns, 1], [0, 1]]);
      // Ropa (toallas, sábanas) colgada sobre la baranda.
      if (L.laundry && rng.chance(0.7)) {
        let cu = bal.u0 + rng.range(0.1, 0.5);
        while (cu < bal.u1 - 0.5) {
          const cw = rng.range(0.35, 0.8);
          if (cu + cw > bal.u1 - 0.1) break;
          const drop = rng.range(0.35, 0.7);
          fq(G('detail'), cu, cu + cw, bal.v + hr - drop, bal.v + hr + 0.02, depth + 0.015, null, CURTAIN_COLORS[rng.int(0, CURTAIN_COLORS.length - 1)]);
          cu += cw + rng.range(0.15, 0.6);
        }
      }
    }

    // ---- contador de energía junto a la puerta
    if (L.meter) {
      const { u, v } = L.meter;
      fbox(G('detail'), u - 0.16, u + 0.16, v - 0.21, v + 0.21, 0, 0.13, [0.62, 0.64, 0.66]);
    }
  }

  /** Local comercial: cortina enrollable a medio subir, interior, mostrador, nevera, aviso y toldo. */
  _shop(G, P, N, R, L_, fq, fbox, reveal, o, L, trimColor, rng) {
    const shop = L.shop;
    const mid = P((o.u0 + o.u1) / 2, 0);
    this.shops.push({ name: shop.name, kind: shop.interior, x: mid[0], y: mid[1], z: mid[2], nx: N[0], nz: N[2], w: o.u1 - o.u0 });
    const D = 0.22;
    const depth = 3.2;
    const w = o.u1 - o.u0;
    const h = o.v1 - o.v0;
    reveal(o, D, trimColor, false);
    const kind = INTERIOR_KINDS.includes(shop.interior) ? shop.interior : 'tienda';
    const atlasUv = (r) => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
    // Recorte de una casilla: fracción `fu` del ancho (centrada o desde un lado) y `fv` del alto.
    const crop = (r, fu, fv = 1, from = 0.5) => {
      const du = (r[2] - r[0]) * Math.min(1, fu);
      const u0 = r[0] + (r[2] - r[0] - du) * from;
      return [u0, r[1], u0 + du, r[1] + (r[3] - r[1]) * Math.min(1, fv)];
    };
    // ---- el cuarto (siempre visible): fondo, paredes, piso y techo pintados
    const g = G('interior');
    const tint = rng.pick([[1, 1, 1], [1, 0.97, 0.9], [0.95, 1, 0.95], [0.94, 0.97, 1], [1, 0.95, 0.94]]);
    face(g, [P(o.u0, 0, -depth), P(o.u1, 0, -depth), P(o.u1, h, -depth), P(o.u0, h, -depth)], N, atlasUv(crop(ATLAS[`back:${kind}`], w / BACK_M)), tint);
    const fs = (depth - D) / SIDE_M;
    face(g, [P(o.u0, 0, -D), P(o.u0, 0, -depth), P(o.u0, h, -depth), P(o.u0, h, -D)], R, atlasUv(crop(ATLAS[`side:${kind}`], fs, 1, 0)), tint);
    const rs = crop(ATLAS[`side:${kind}`], fs, 1, 1);
    face(g, [P(o.u1, 0, -D), P(o.u1, 0, -depth), P(o.u1, h, -depth), P(o.u1, h, -D)], L_, atlasUv([rs[2], rs[1], rs[0], rs[3]]), tint);
    const floor = FLOORS[kind] ?? rng.pick(['piso-rojo', 'piso-granito']);
    face(g, [P(o.u0, 0.01, -D), P(o.u1, 0.01, -D), P(o.u1, 0.01, -depth), P(o.u0, 0.01, -depth)], [0, 1, 0], atlasUv(crop(ATLAS[floor], w / 4, (depth - D) / 4)));
    face(g, [P(o.u0, h, -D), P(o.u1, h, -D), P(o.u1, h, -depth), P(o.u0, h, -depth)], [0, -1, 0], atlasUv(ATLAS.techo));
    // ---- utilería 3D (solo de cerca): celdas propias
    const inner = P((o.u0 + o.u1) / 2, 0, -depth / 2);
    const cell = this._cellOf(inner[0], inner[2]);
    const GP = this._g(cell, 'shopProps');
    const GT = this._g(cell, 'shopTex');
    const X = o.u0;
    const FW = [N[0], 0, N[2]];
    const api = {
      // Caja sin cara de atrás ni de abajo (no se ven desde la calle).
      box: (u0, u1, v0, v1, d0, d1, c) => {
        const a = X + u0;
        const b = X + u1;
        face(GP, [P(a, v0, -d0), P(b, v0, -d0), P(b, v1, -d0), P(a, v1, -d0)], FW, [[0, 0], [1, 0], [1, 1], [0, 1]], c);
        face(GP, [P(b, v0, -d0), P(b, v0, -d1), P(b, v1, -d1), P(b, v1, -d0)], R, [[0, 0], [1, 0], [1, 1], [0, 1]], c);
        face(GP, [P(a, v0, -d1), P(a, v0, -d0), P(a, v1, -d0), P(a, v1, -d1)], L_, [[0, 0], [1, 0], [1, 1], [0, 1]], c);
        face(GP, [P(a, v1, -d0), P(b, v1, -d0), P(b, v1, -d1), P(a, v1, -d1)], UP_, [[0, 0], [1, 0], [1, 1], [0, 1]], c);
        if (v0 > 1.6) face(GP, [P(a, v0, -d0), P(b, v0, -d0), P(b, v0, -d1), P(a, v0, -d1)], DOWN_, [[0, 0], [1, 0], [1, 1], [0, 1]], c);
      },
      front: (name, u0, u1, v0, v1, d, c = WHITE) => fq(GT, X + u0, X + u1, v0, v1, -d, atlasUv(ATLAS[name]), c),
      side: (name, u, v0, v1, d0, d1, dir, c = WHITE) => {
        const r = ATLAS[name];
        const uv = dir > 0 ? atlasUv(r) : atlasUv([r[2], r[1], r[0], r[3]]);
        face(GT, [P(X + u, v0, -d0), P(X + u, v0, -d1), P(X + u, v1, -d1), P(X + u, v1, -d0)], dir > 0 ? R : L_, uv, c);
      },
    };
    shopProps(api, kind, w, depth, makeRng(Math.floor(Math.abs(inner[0] * 131 + inner[2] * 71))));
    // Cortina metálica: guías a los lados y la lámina enrollada a medio subir.
    const sc = METAL_COLORS[shop.shutterColor] ?? METAL_COLORS[4];
    const shutterTop = o.v1;
    const shutterBottom = o.v1 - Math.max(0.25, shop.shutter * h);
    fq(G('shutter'), o.u0, o.u1, shutterBottom, shutterTop, -0.05, null, lighten(sc, 1, 0.25));
    fbox(G('detail'), o.u0, o.u0 + 0.06, 0, o.v1, -0.09, -0.02, [0.3, 0.31, 0.33]);
    fbox(G('detail'), o.u1 - 0.06, o.u1, 0, o.v1, -0.09, -0.02, [0.3, 0.31, 0.33]);
    // Aviso con el nombre del negocio.
    const si = Math.max(0, SIGN_NAMES.findIndex(([n]) => n === shop.name));
    const uvS = slot(si, SIGN_COLS, SIGN_ROWS);
    const s0 = Math.max(0.1, o.u0 - 0.25);
    const s1 = Math.min(L.face.len - 0.1, o.u1 + 0.25);
    // Encima del toldo (que sale desde el borde del vano) y debajo de las ventanas del segundo piso.
    const sBot = o.v1 + 0.3;
    const sTop = Math.min(o.v1 + 1.05, L.floorH + 0.85);
    fq(G('sign'), s0, s1, sBot, sTop, 0.07, [[uvS[0], uvS[1]], [uvS[2], uvS[1]], [uvS[2], uvS[3]], [uvS[0], uvS[3]]]);
    fbox(G('detail'), s0, s1, sBot - 0.04, sBot, 0, 0.09, [0.2, 0.2, 0.2]);
    // Toldo de rayas (inclinado hacia la calle, con faldón al frente).
    if (shop.awning >= 0) {
      const [a0, b0, a1, b1] = slot(shop.awning, AWNING_SLOTS, 1);
      const bv = b0 + (b1 - b0) * 0.12;
      const t0 = o.v1 + 0.02;
      const t1 = o.v1 - 0.45;
      const out = 1.25;
      const u0 = o.u0 - 0.15;
      const u1 = o.u1 + 0.15;
      const slopeN = [N[0] * 0.34, 0.94, N[2] * 0.34];
      face(G('awning'), [P(u0, t0, 0.08), P(u1, t0, 0.08), P(u1, t1, out), P(u0, t1, out)], slopeN, [[a0, b1], [a1, b1], [a1, bv], [a0, bv]]);
      face(G('awning'), [P(u0, t1 - 0.25, out), P(u1, t1 - 0.25, out), P(u1, t1, out), P(u0, t1, out)], N, [[a0, b0], [a1, b0], [a1, bv], [a0, bv]]);
    }
  }

  // ------------------------------------------------------------ mallas
  build(root) {
    const out = [];
    for (const [k, g] of this.groups) {
      if (!g.idx.length) continue;
      const [chunk, key] = k.split('|');
      const mat = key === 'railingBars' ? this.r.materials.railingBars : this.mats[key];
      if (!mat) continue;
      const mesh = new THREE.Mesh(g.build(), mat);
      mesh.name = `fachadas-${key}`;
      mesh.castShadow = !NO_SHADOW.has(key) && !DETAIL.has(key);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      root.add(mesh);
      out.push(mesh);
      if (chunk.startsWith('c:')) this.cells.get(chunk)?.meshes.push(mesh);
      else if (DETAIL.has(key)) this.chunks.get(chunk)?.detail.push(mesh);
      else if (MID.has(key)) this.chunks.get(chunk)?.mid.push(mesh);
    }
    this.groups.clear();
    return out;
  }

  /** Detalles pequeños solo cerca de la cámara (por zona). */
  update(camPos) {
    const far = this.quality?.detailDraw ?? 150;
    const mid = Math.max(200, far * 1.6);
    for (const c of this.chunks.values()) {
      const dx = Math.max(c.minX - camPos.x, 0, camPos.x - c.maxX);
      const dz = Math.max(c.minZ - camPos.z, 0, camPos.z - c.maxZ);
      const d = Math.hypot(dx, dz);
      for (const m of c.detail) m.visible = d < far;
      for (const m of c.mid) m.visible = d < mid;
    }
    // Utilería de los locales: de cerca (de lejos queda el cuarto pintado).
    const near = this.quality?.shopDraw ?? Math.min(90, Math.max(35, far * 0.45));
    for (const c of this.cells.values()) {
      const dx = Math.max(c.minX - camPos.x, 0, camPos.x - c.maxX);
      const dz = Math.max(c.minZ - camPos.z, 0, camPos.z - c.maxZ);
      const on = Math.hypot(dx, dz) < near;
      for (const m of c.meshes) m.visible = on;
    }
  }
}
