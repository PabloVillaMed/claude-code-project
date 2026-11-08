// La rumba de la 92 (pura, sin three.js): qué locales hay (discotecas,
// salsotecas, bares y la fonda de sim/cityLayout.js LOCAL_SPOTS), cuánta
// gente sale según la hora y la calidad, dónde se para cada quien frente a
// cada local (portero en la puerta, fila corta, grupos charlando en el andén),
// por dónde caminan las parejas, la pinta de salir y el murmullo sintetizado.
// game/nightlife.js pone la gente en escena y game/radio.js la música.
//
// Todo sale de la ciudad generada y de semillas propias por local: la ciudad
// no cambia por agregar o quitar gente.

import { makeRng } from './rng.js';

// ------------------------------------------------------------------ configurables
/**
 * Nivel de la rumba según la hora [hora, nivel 0..1], interpolado (0 = todo
 * cerrado). Arranca a las 19:00, se llena de 22:00 a 1:00 y cierra a las 3:00.
 */
export const RUMBA_CURVA = [[0, 1], [1, 1], [3, 0.45], [3.5, 0], [18.5, 0], [19, 0.3], [22, 1], [24, 1]];
/** Bares y fonda: de día ponen música suave (este nivel mínimo entre `desde` y `hasta`). */
export const BAR_DIA = { desde: 11, hasta: 19, nivel: 0.12 };
/** Por debajo de este nivel no hay gente en la calle ni portero (el local está cerrado). */
export const NIVEL_ABIERTO = 0.05;
/** Gente quieta de rumba a la vez (grupos, filas y porteros) según el cupo de peatones del preset: [peds >=, cupo]. Ultra 32, Alta 24, Media 16, Baja 8 (v3.5: más gente en la 92; la lejana es barata: ANIM_LOD, sin sombra y sin accesorios chicos, game/nightlife.js). */
export const RUMBA_CUPO = [[56, 32], [44, 24], [34, 16], [0, 8]];
/** Parejas caminando a la vez entre locales (dos personas cada una), según el preset: Ultra 6, Alta 5, Media 3, Baja 1 (con el cupo de arriba: Ultra 44 personas, Alta 34, Media 22, Baja 10). */
export const PAREJAS_CUPO = [[56, 6], [44, 5], [34, 3], [0, 1]];
/** Puestos que todo local abierto cercano recibe antes de llenar el más cercano (portero y un grupo). */
export const BASE_POR_LOCAL = 3;
/** Personas en la fila de la puerta (como mucho). */
export const FILA_MAX = 4;
/** Grupos charlando en el andén por local, y su tamaño [mín, máx]. */
export const GRUPOS_POR_LOCAL = 2;
export const GRUPO_TAM = [2, 4];
/** Escala del portero (grande). */
export const PORTERO_ESCALA = 1.12;
/** Proporción de mujeres en la rumba y, de ellas, cuántas van de vestido. */
export const MUJERES = 0.5;
export const CON_VESTIDO = 0.65;
/** Música de los locales (game/radio.js): cuántos suenan a la vez, hasta dónde se oyen y a qué distancia suenan a todo. */
export const RUMBA_FUENTES = 2;
export const RUMBA_RADIO = 48;
export const RUMBA_REF = 5;
/** Filtro "desde adentro": en la puerta casi abierto (Hz) y de lejos solo el bajo; `caida`: metros en que se va cerrando. */
export const RUMBA_FILTRO = { puerta: 4200, lejos: 520, caida: 7 };

// ------------------------------------------------------------------ hora y cupo
/** Nivel 0..1 de la rumba a la hora `h` (0..24). */
export function nivelRumba(h) {
  const t = ((h % 24) + 24) % 24;
  const c = RUMBA_CURVA;
  for (let i = 1; i < c.length; i++) {
    const [h0, v0] = c[i - 1];
    const [h1, v1] = c[i];
    if (t <= h1) return h1 > h0 ? v0 + ((v1 - v0) * (t - h0)) / (h1 - h0) : v1;
  }
  return c[c.length - 1][1];
}

/** Tipo de local por su nombre: 'discoteca', 'salsoteca', 'bar' o 'fonda'. */
export function tipoLocal(name) {
  const n = name.toLowerCase();
  if (n.startsWith('salsoteca')) return 'salsoteca';
  if (n.startsWith('bar')) return 'bar';
  if (n.startsWith('fonda')) return 'fonda';
  return 'discoteca';
}

/** Volumen 0..1 de la música de un local a la hora `h` (los bares y la fonda suenan bajito de día). */
export function nivelMusica(tipo, h) {
  const n = nivelRumba(h);
  if (tipo !== 'bar' && tipo !== 'fonda') return n;
  const t = ((h % 24) + 24) % 24;
  return t >= BAR_DIA.desde && t < BAR_DIA.hasta ? Math.max(n, BAR_DIA.nivel) : n;
}

const porTabla = (tabla, peds) => (tabla.find(([min]) => peds >= min) ?? tabla[tabla.length - 1])[1];

/** Cupo de gente quieta de rumba para un preset con `peds` peatones, a nivel `nivel`. */
export function cupoRumba(peds, nivel) {
  if (!(nivel > NIVEL_ABIERTO)) return 0;
  return Math.round(porTabla(RUMBA_CUPO, peds) * Math.min(1, nivel));
}

/** Parejas caminando para un preset con `peds` peatones, a nivel `nivel` (de día, ninguna). */
export function parejasRumba(peds, nivel) {
  if (!(nivel > 0.25)) return 0;
  return Math.max(1, Math.round(porTabla(PAREJAS_CUPO, peds) * Math.min(1, nivel)));
}

// ------------------------------------------------------------------ locales
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/**
 * Locales de rumba de la ciudad: {id, name, tipo, musica, x, z (puerta en el
 * andén), fx, fz (frente de la fachada), nx, nz (hacia la calle), ux, uz (a
 * lo largo de la fachada)}.
 */
export function discotecasDe(city) {
  const out = [];
  for (const p of city?.pois ?? []) {
    if (p.type !== 'discoteca') continue;
    const b = city.buildings?.find((q) => q.local?.name === p.name);
    const f = b?.frame;
    if (!f) continue;
    out.push({ id: p.id, name: p.name, tipo: tipoLocal(p.name), musica: p.musica, x: p.x, z: p.z, fx: f.x + f.nx * f.hv, fz: f.z + f.nz * f.hv, nx: f.nx, nz: f.nz, ux: f.ux, uz: f.uz });
  }
  return out;
}

/**
 * Puestos de la gente frente a un local, en el orden en que se llenan:
 * portero, grupos y fila intercalados. Cada uno: {rol: 'portero'|'fila'|
 * 'grupo', grupo, x, z, yaw}. `blocked(x, z)`: si hay algo ahí (poste,
 * árbol, mesa), se corre un poco o se quita.
 */
export function puestosLocal(d, blocked = () => false) {
  const rng = makeRng(hash(d.id) || 1);
  const at = (s, u) => ({ x: d.fx + d.nx * s + d.ux * u, z: d.fz + d.nz * s + d.uz * u });
  const yawTo = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
  const free = (o) => {
    if (!blocked(o.x, o.z)) return o;
    for (const ds of [0.45, -0.3, 0.8]) {
      const q = { ...o, x: o.x + d.nx * ds, z: o.z + d.nz * ds };
      if (!blocked(q.x, q.z)) return q;
    }
    return null;
  };
  // Portero: junto a la puerta, mirando a la calle (un poco hacia la fila).
  const portero = { rol: 'portero', grupo: null, ...at(0.75, -0.95), yaw: Math.atan2(d.nx + d.ux * 0.35, d.nz + d.uz * 0.35) };
  // Fila: pegada a la fachada, mirando hacia la puerta.
  const fila = [];
  for (let k = 0; k < FILA_MAX; k++) {
    const p = at(0.62 + rng.range(-0.08, 0.08), 1.2 + k * 0.7 + rng.range(-0.06, 0.06));
    fila.push({ rol: 'fila', grupo: null, ...p, yaw: Math.atan2(-d.ux, -d.uz) + rng.range(-0.25, 0.25) });
  }
  // Grupos: en ronda en el andén, a un lado de la puerta y pasando la fila.
  const grupos = [];
  for (let g = 0; g < GRUPOS_POR_LOCAL; g++) {
    const n = rng.int(GRUPO_TAM[0], GRUPO_TAM[1]);
    const c = at(1.3 + rng.range(-0.1, 0.1), (g === 0 ? -3.4 : 5.3 + FILA_MAX * 0.25) + rng.range(-0.5, 0.5));
    const r = n === 2 ? 0.48 : 0.6;
    const a0 = rng.range(0, Math.PI * 2);
    const ms = [];
    for (let k = 0; k < n; k++) {
      const a = a0 + (k * Math.PI * 2) / n + rng.range(-0.2, 0.2);
      const p = { x: c.x + (Math.cos(a) * d.ux + Math.sin(a) * d.nx) * r, z: c.z + (Math.cos(a) * d.uz + Math.sin(a) * d.nz) * r };
      ms.push({ rol: 'grupo', grupo: g, ...p, yaw: yawTo(p, c) + rng.range(-0.3, 0.3) });
    }
    grupos.push(ms);
  }
  // Orden de llenado: portero, el primer grupo, la fila y el otro grupo intercalados.
  const order = [portero, grupos[0]?.[0], grupos[0]?.[1], fila[0], grupos[1]?.[0], grupos[1]?.[1], fila[1], grupos[0]?.[2], fila[2], grupos[1]?.[2], grupos[0]?.[3], fila[3], grupos[1]?.[3]];
  const out = [];
  for (const o of order) {
    if (!o) continue;
    const q = free(o);
    if (q) out.push(q);
  }
  return out;
}

/**
 * Reparte el cupo entre los locales abiertos a menos de `radio` de (x, z):
 * primero BASE_POR_LOCAL a cada uno (del más cercano al más lejano), luego el
 * resto al más cercano. `tam(d)`: cuántos puestos tiene cada local. Devuelve
 * Map(id -> n).
 */
export function repartir(locales, x, z, radio, cupo, tam) {
  const near = locales
    .map((d) => ({ d, r: Math.hypot(d.x - x, d.z - z) }))
    .filter((o) => o.r < radio)
    .sort((a, b) => a.r - b.r);
  const out = new Map(near.map((o) => [o.d.id, 0]));
  let left = Math.max(0, cupo);
  for (const o of near) {
    const k = Math.min(BASE_POR_LOCAL, tam(o.d), left);
    out.set(o.d.id, k);
    left -= k;
  }
  for (const o of near) {
    const k = Math.min(tam(o.d) - out.get(o.d.id), left);
    out.set(o.d.id, out.get(o.d.id) + k);
    left -= k;
  }
  return out;
}

/**
 * Paseo de una pareja: de la puerta de un local a la de su vecino del mismo
 * lado de la calle (por el andén, a `s` m de la fachada). Devuelve {from, to}
 * o null si el local está solo en su acera.
 */
export function paseoPareja(locales, d, rng, s = 1.15) {
  const side = Math.sign(d.nz) || 1;
  const along = (o) => o.fx * d.ux + o.fz * d.uz;
  const same = locales.filter((o) => o !== d && (Math.sign(o.nz) || 1) === side && Math.hypot(o.fx - d.fx, o.fz - d.fz) < 140);
  if (!same.length) return null;
  same.sort((a, b) => Math.abs(along(a) - along(d)) - Math.abs(along(b) - along(d)));
  const o = same[Math.min(same.length - 1, rng.chance(0.7) ? 0 : 1)];
  const p = (q) => ({ x: q.fx + q.nx * s, z: q.fz + q.nz * s });
  return rng.chance(0.5) ? { from: p(d), to: p(o) } : { from: p(o), to: p(d) };
}

// ------------------------------------------------------------------ música de los locales
/**
 * Locales que se oyen desde (x, z) a la hora `h`, del más cercano al más
 * lejano (como mucho `max`): [{p: local, d, nivel}]. De día solo los bares y
 * la fonda, y bajito.
 */
export function fuentesRumba(locales, x, z, h, max = RUMBA_FUENTES, radio = RUMBA_RADIO) {
  const out = [];
  for (const p of locales) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (!(d < radio)) continue;
    const nivel = nivelMusica(p.tipo, h);
    if (nivel > 0.01) out.push({ p, d, nivel });
  }
  out.sort((a, b) => a.d - b.d);
  if (out.length > max) out.length = max;
  return out;
}

/** Ganancia 0..1 de la música de un local a `d` m (cero en el borde del radio). */
export function gananciaRumba(d, radio = RUMBA_RADIO, ref = RUMBA_REF) {
  if (!(d < radio)) return 0;
  return Math.min(1, ref / Math.max(ref, d)) * (1 - (d / radio) ** 2);
}

/** Corte del filtro pasabajos (Hz) a `d` m de la puerta: suena "desde adentro" y se abre al pasar por ella. */
export function filtroRumba(d) {
  const f = RUMBA_FILTRO;
  return f.lejos + (f.puerta - f.lejos) * Math.exp(-Math.max(0, d - 2) / f.caida);
}

// ------------------------------------------------------------------ pinta de salir
const CAMISAS = ['camisa-fiesta-fucsia', 'camisa-fiesta-turquesa', 'camisa-fiesta-amarilla', 'camisa-fiesta-blanca', 'camisa-fiesta-negra', 'camisa-fiesta-roja', 'camisa-fiesta-estampada', 'camisa-rosada', 'camiseta-blanca', 'camiseta-negra'];
const JEANS = ['jean-oscuro', 'jean-negro', 'jean-oscuro', 'jean-claro'];
const VESTIDOS = [['vestido-rojo', 'blusa-roja'], ['vestido-negro', 'blusa-negra'], ['vestido-dorado', 'blusa-dorada'], ['vestido-fucsia', 'blusa-fucsia'], ['vestido-plateado', 'blusa-plateada'], ['vestido-esmeralda', 'blusa-esmeralda'], ['vestido-azul-rey', 'blusa-azul-rey']];
const BLUSAS = ['blusa-blanca', 'blusa-negra', 'blusa-fucsia', 'blusa-roja', 'blusa-dorada', 'blusa-plateada', 'blusa-esmeralda', 'blusa-azul-rey'];

/** Pinta de rumba (ids de sim/ropa.js para render/outfit.js applyOutfit). */
export function pintaRumba(rng, female) {
  if (female && rng.chance(CON_VESTIDO)) {
    // Vestido: la falda y la blusa del mismo color.
    const [vestido, blusa] = rng.pick(VESTIDOS);
    const o = { torso: blusa, piernas: vestido, pies: rng.chance(0.6) ? 'tenis-blancos' : 'tenis-negros' };
    if (rng.chance(0.4)) o.cuello = rng.chance(0.5) ? 'cadena-dorada' : 'cadena-plateada';
    return o;
  }
  if (female) {
    const o = { torso: rng.pick(BLUSAS), piernas: rng.chance(0.6) ? 'jean-negro' : 'jean-oscuro', pies: 'tenis-blancos' };
    if (rng.chance(0.35)) o.cuello = 'cadena-plateada';
    return o;
  }
  const o = { torso: rng.pick(CAMISAS), piernas: rng.pick(JEANS), pies: rng.chance(0.75) ? 'tenis-blancos' : 'tenis-negros' };
  // (Cada accesorio es una malla más por persona: con medida.)
  if (rng.chance(0.4)) o.cuello = rng.chance(0.6) ? 'cadena-dorada' : 'cadena-plateada';
  if (rng.chance(0.08)) o.cabeza = rng.pick(['gorra-plana-negra', 'gorra-plana-blanca']);
  return o;
}

/** El portero: todo de negro. */
export const PINTA_PORTERO = Object.freeze({ torso: 'camisa-portero', piernas: 'jean-negro', pies: 'tenis-negros' });

// ------------------------------------------------------------------ murmullo
/**
 * Murmullo de gente sintetizado (una vez): `voces` voces con su tono, sílabas
 * de 90 a 260 ms con pausas y dos formantes que cambian en cada sílaba (suena
 * a conversación que no se entiende). Devuelve un Float32Array de
 * `segundos` que da la vuelta sin salto (fundido de 60 ms entre el final y el
 * principio), normalizado a pico 0.9.
 */
export function murmullo(sampleRate, segundos = 4, voces = 7, semilla = 92) {
  const rng = makeRng(semilla);
  const L = Math.floor(sampleRate * segundos);
  const X = Math.floor(sampleRate * 0.06);
  const out = new Float32Array(L + X);
  const reso = (f, bw) => {
    const r = Math.exp((-Math.PI * bw) / sampleRate);
    return { a1: -2 * r * Math.cos((2 * Math.PI * f) / sampleRate), a2: r * r, g: 1 - r };
  };
  for (let v = 0; v < voces; v++) {
    const f0Base = rng.chance(0.5) ? rng.range(95, 140) : rng.range(180, 250);
    const amp = rng.range(0.5, 1);
    let i = Math.floor(rng.range(0, sampleRate * 0.4));
    let ph = 0;
    let y1 = 0;
    let y2 = 0;
    let z1 = 0;
    let z2 = 0;
    while (i < L + X) {
      const n = Math.floor(sampleRate * rng.range(0.09, 0.26));
      const f0 = f0Base * rng.range(0.9, 1.15);
      const F1 = reso(rng.range(320, 850), 90);
      const F2 = reso(rng.range(950, 2300), 140);
      const glide = rng.range(-0.2, 0.2);
      for (let k = 0; k < n && i < L + X; k++, i++) {
        const t = k / n;
        const env = Math.sin(Math.PI * t) ** 1.5;
        ph += (f0 * (1 + glide * t)) / sampleRate;
        if (ph >= 1) ph -= 1;
        const src = (ph * 2 - 1) * env * amp + (rng.next() - 0.5) * 0.12 * env;
        const y = F1.g * src - F1.a1 * y1 - F1.a2 * y2;
        y2 = y1;
        y1 = y;
        const z = F2.g * src - F2.a1 * z1 - F2.a2 * z2;
        z2 = z1;
        z1 = z;
        out[i] += y + z * 0.6;
      }
      // Pausa entre sílabas (y de vez en cuando, entre frases).
      i += Math.floor(sampleRate * (rng.chance(0.15) ? rng.range(0.3, 0.7) : rng.range(0.02, 0.08)));
    }
  }
  const res = new Float32Array(L);
  for (let i = 0; i < L; i++) res[i] = out[i];
  for (let i = 0; i < X; i++) res[i] = out[i] * (i / X) + out[L + i] * (1 - i / X);
  let peak = 0;
  for (let i = 0; i < L; i++) peak = Math.max(peak, Math.abs(res[i]));
  if (peak > 0) for (let i = 0; i < L; i++) res[i] *= 0.9 / peak;
  return res;
}
