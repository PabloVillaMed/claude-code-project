// Alumbrado público (lógica pura): qué luminaria lleva cada farol de calle y
// cada poste de redes, dónde queda su cabeza y de qué color alumbra.
//
// Así es en Medellín: en los barrios la luminaria va en un brazo metálico
// corto e inclinado, sujeto arriba del mismo poste de concreto que carga las
// redes (con red aérea, el alumbrado sigue la distancia entre esos postes),
// hacia la calzada y con el lente por debajo; la modernización de 2022-2025
// cambió casi todo el sodio (luz ámbar) por LED blanco neutro. En las
// avenidas, postes metálicos más altos con brazo largo; en los parques,
// postes bajos ornamentales (el farol de parque, aparte). Nada de faroles de
// estilo europeo en las calles ni postes en la calzada.
//
// Espacio de una luminaria: el poste en el origen, el brazo hacia −Z local
// (la calzada) y la base a la altura del andén; `rot` gira +Z local hacia
// (sen rot, cos rot), así que el brazo apunta hacia −(sen rot, cos rot).

const GRADO = Math.PI / 180;

// ------------------------------------------------------------------ ajustables
/** Clases de vía (OpenStreetMap) que se alumbran como avenida: poste metálico alto y luz LED. */
export const VIAS_AVENIDA = ['trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link'];

/**
 * Luminarias por tipo (m, rad). alto: el poste propio (0 = va en un poste de
 * redes que ya existe); brazoY: altura donde arranca el brazo; arranque:
 * distancia del eje del poste a la raíz del brazo (la abrazadera); brazo:
 * largo del brazo; inclinacion: cuánto sube el brazo hacia la calzada;
 * largo/ancho/grueso: la carcasa (el lente va por debajo); potencia: luz
 * relativa a la de groundLights.lampPower (cabezas más altas reparten la luz
 * en un charco más ancho y tenue).
 */
export const LUMINARIAS = {
  // Poste de concreto suelto (donde no hay redes) con su brazo.
  barrio: { alto: 8, brazoY: 7.6, arranque: 0.13, brazo: 1.35, inclinacion: 12 * GRADO, largo: 0.62, ancho: 0.27, grueso: 0.11, potencia: 1.45 },
  // Avenida: poste metálico alto, brazo largo, luminaria más grande.
  avenida: { alto: 10.5, brazoY: 10.2, arranque: 0.09, brazo: 2.1, inclinacion: 10 * GRADO, largo: 0.8, ancho: 0.34, grueso: 0.13, potencia: 2.2 },
  // En el poste de redes (9 m, radio ≈ 0,11 m a esa altura): entre los herrajes
  // de 7,2 m y las crucetas de 8 m, encima del cable de teléfono y del transformador.
  poste: { alto: 0, brazoY: 7.45, arranque: 0.15, brazo: 1.2, inclinacion: 12 * GRADO, largo: 0.62, ancho: 0.27, grueso: 0.11, potencia: 1.45 },
};
/** Lo que la carcasa monta sobre la punta del brazo (m). */
export const MONTE_CARCASA = 0.08;
/** Fondo (m) del lente que sobresale por debajo de la carcasa. */
export const FONDO_LENTE = 0.035;
/**
 * La luz (la puntual y la del piso) sale de un punto este tanto (m) por
 * debajo del lente y adelantado hacia la calzada: la luminaria alumbra hacia
 * abajo y una luz puntual pegada a ella quemaría los herrajes del poste.
 */
export const LUZ_BAJO_LENTE = 0.8;
export const LUZ_ADELANTE = 0.8;

/** Un farol suelto a menos de esto (m) de un poste de redes con luminaria de la misma calle sobra: esa cuadra ya la alumbra el poste. */
export const DIST_CUBIERTA = 20;
/** Y a menos de esto (m) de cualquier poste de redes, siempre sobra (nunca dos postes juntos). */
export const DIST_DUPLICADO = 3;
/** Metros delante del farol (hacia donde apunta el brazo) donde tiene que haber una vía; si no, sobra (en el corte del mapa miraban al vacío). */
export const FRENTE_CALZADA = 2.5;
/** Distancia máxima (m) del farol al borde de esa vía: más lejos no está en su andén (y sobra). */
export const ANDEN_MAX = 1.5;
/** Fracción de luminarias LED (blanco neutro) por tipo de vía; el resto, sodio (ámbar). */
export const FRACCION_LED = { barrio: 0.75, avenida: 1, parque: 1 };

// ------------------------------------------------------------------ geometría
/** Tipo de vía de una clase de OpenStreetMap: 'avenida' o 'barrio'. */
export function tipoDeVia(cls) {
  return VIAS_AVENIDA.includes(cls) ? 'avenida' : 'barrio';
}

/** Luminaria (de LUMINARIAS) de un objeto de la ciudad: farol de calle o poste de redes con luz; null si no tiene. */
export function luminariaDe(p) {
  if (p.type === 'lamp') return p.via === 'avenida' ? LUMINARIAS.avenida : LUMINARIAS.barrio;
  if (p.type === 'pole' && p.luzRot !== undefined) return LUMINARIAS.poste;
  return null;
}

/** Giro del brazo (ver el encabezado): el del farol, o el que le tocó al poste de redes. */
export function giroLuminaria(p) {
  return p.type === 'pole' ? p.luzRot : p.rot;
}

const _geo = new Map();
/**
 * Puntos del brazo y la carcasa en el espacio de la luminaria, en (u, y): u =
 * metros hacia la calzada desde el eje del poste (−Z local), y = altura sobre
 * la base. Raíz (u0, y0) y punta (u1, y1) del brazo; la carcasa empieza en
 * (cu, cy) y sigue la dirección del brazo (c, s); (nu, ny) es su normal hacia
 * abajo (el lente mira al piso, un poco hacia la calzada); `lente` es el
 * centro de la cara que alumbra.
 */
export function geometriaLuminaria(L) {
  let g = _geo.get(L);
  if (g) return g;
  const c = Math.cos(L.inclinacion);
  const s = Math.sin(L.inclinacion);
  const u0 = L.arranque;
  const y0 = L.brazoY;
  const u1 = u0 + L.brazo * c;
  const y1 = y0 + L.brazo * s;
  const cu = u1 - MONTE_CARCASA * c;
  const cy = y1 - MONTE_CARCASA * s;
  const nu = s;
  const ny = -c;
  const m = L.largo * 0.55; // el lente va un poco hacia la punta
  const k = L.grueso / 2 + FONDO_LENTE;
  g = { u0, y0, u1, y1, cu, cy, c, s, nu, ny, lente: { u: cu + c * m + nu * k, y: cy + s * m + ny * k } };
  _geo.set(L, g);
  return g;
}

/** Centro del lente en el mundo para la base del poste a la altura `baseY`; null si no tiene luminaria. */
export function cabezaFarol(p, baseY = 0, out = { x: 0, y: 0, z: 0 }) {
  const L = luminariaDe(p);
  if (!L) return null;
  const g = geometriaLuminaria(L);
  const rot = giroLuminaria(p);
  out.x = p.x - Math.sin(rot) * g.lente.u;
  out.y = baseY + g.lente.y;
  out.z = p.z - Math.cos(rot) * g.lente.u;
  return out;
}

/** Punto de donde sale la luz de la luminaria (ver LUZ_BAJO_LENTE); null si no tiene. */
export function fuenteDeLuz(p, baseY = 0, out = { x: 0, y: 0, z: 0 }) {
  if (!cabezaFarol(p, baseY, out)) return null;
  const rot = giroLuminaria(p);
  out.x -= Math.sin(rot) * LUZ_ADELANTE;
  out.z -= Math.cos(rot) * LUZ_ADELANTE;
  out.y -= LUZ_BAJO_LENTE;
  return out;
}

/** ¿LED (blanco) o sodio (ámbar)? Fijo por posición, con la fracción de FRACCION_LED de su tipo de vía. */
export function luzLed(p, via = p.via ?? 'barrio') {
  const k = Math.sin(Math.round(p.x) * 12.9898 + Math.round(p.z) * 78.233) * 43758.5453;
  return k - Math.floor(k) < (FRACCION_LED[via] ?? 1);
}

// ------------------------------------------------------------------ ciudad
/**
 * Última pasada de la generación (sim/cityLayout.js), cuando ya nada más se
 * coloca mirando la utilería: a cada farol de calle le da su tipo de vía y
 * quita los que sobran: los que no tienen calzada al frente, los que quedan
 * pegados a un poste de redes y los de una cuadra que ya alumbran los postes
 * de redes (que llevan su luminaria desde addPowerLines). Sus cajas de choque
 * se van con ellos. roadAt(x, z, margen, keep) es el de terrain.js; claseDe(edge)
 * y esCalzada(edge) dicen la clase y si es vía de carros (no un sendero).
 * Devuelve {quitados, sinCalzada, puntas (en la punta de una calle ciega o lejos de su andén), cubiertos}.
 */
export function ordenarAlumbrado(city, { roadAt, claseDe, esCalzada }) {
  const CS = 32;
  const cells = new Map();
  for (const p of city.props) {
    if (p.type !== 'pole') continue;
    const k = Math.floor(p.x / CS) * 65536 + Math.floor(p.z / CS);
    let c = cells.get(k);
    if (!c) cells.set(k, (c = []));
    c.push(p);
  }
  const cubierto = (l) => {
    const r = DIST_CUBIERTA;
    for (let i = Math.floor((l.x - r) / CS); i <= Math.floor((l.x + r) / CS); i++) {
      for (let j = Math.floor((l.z - r) / CS); j <= Math.floor((l.z + r) / CS); j++) {
        for (const p of cells.get(i * 65536 + j) ?? []) {
          const d = Math.hypot(p.x - l.x, p.z - l.z);
          if (d < DIST_DUPLICADO) return true;
          // Misma calle: los dos brazos paralelos (del mismo lado o enfrentados).
          if (d < r && p.luzRot !== undefined && Math.abs(Math.cos(p.luzRot - l.rot)) > 0.7) return true;
        }
      }
    }
    return false;
  };
  const quitar = new Set();
  let sinCalzada = 0;
  let puntas = 0;
  // Tramo de vía delante del farol a `d` m (sin los discos de los cruces, que
  // no tienen eje): primero una calzada; si no hay, un sendero (las
  // peatonales y escalas del barrio también tienen su luz).
  const calzada = (s) => s.l2 > 1e-6 && esCalzada(s.edge);
  const tramo = (s) => s.l2 > 1e-6;
  const delante = (p, d) => {
    const fx = p.x - Math.sin(p.rot) * d;
    const fz = p.z - Math.cos(p.rot) * d;
    return roadAt(fx, fz, 0.5, calzada) ?? roadAt(fx, fz, 0.5, tramo);
  };
  for (const p of city.props) {
    if (p.type !== 'lamp') continue;
    const r = delante(p, FRENTE_CALZADA);
    if (!r) {
      quitar.add(p);
      sinCalzada++;
      continue;
    }
    p.via = esCalzada(r.edge) ? tipoDeVia(claseDe(r.edge)) : 'barrio';
    // El brazo, perpendicular al eje del tramo junto al andén (el costado de
    // la manzana no siempre le es paralelo). Si el farol queda más allá de la
    // punta del tramo (el final de una calle ciega), sobra: no hay eje al
    // frente; si queda lejos del borde de esa vía, no está en su andén.
    const s = (delante(p, 1) ?? r).seg;
    const L2 = s.dx * s.dx + s.dz * s.dz;
    const t = ((p.x - s.ax) * s.dx + (p.z - s.az) * s.dz) / L2;
    const ux = s.ax + s.dx * t - p.x;
    const uz = s.az + s.dz * t - p.z;
    if (Math.max(-t, t - 1) * Math.sqrt(L2) > 0.3 || Math.hypot(ux, uz) > s.hw + ANDEN_MAX) {
      quitar.add(p);
      puntas++;
      continue;
    }
    if (ux * ux + uz * uz > 0.01) p.rot = Math.atan2(-ux, -uz);
    if (cubierto(p)) quitar.add(p);
  }
  if (quitar.size) {
    let w = 0;
    for (const p of city.props) if (!quitar.has(p)) city.props[w++] = p;
    city.props.length = w;
    // Sus cajas (addPropCollider: centradas en el farol, kind 'lamp').
    const sobran = new Set();
    const lugar = (x, z) => `${Math.round(x * 1000)}|${Math.round(z * 1000)}`;
    const quitarPorLugar = new Map();
    for (const p of quitar) quitarPorLugar.set(lugar(p.x, p.z), (quitarPorLugar.get(lugar(p.x, p.z)) ?? 0) + 1);
    for (const b of city.collision.boxes) {
      if (b.kind !== 'lamp' || b.obb) continue;
      const k = lugar((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
      const n = quitarPorLugar.get(k);
      if (!n) continue;
      quitarPorLugar.set(k, n - 1);
      sobran.add(b);
    }
    city.collision.purge(sobran);
  }
  return { quitados: quitar.size, sinCalzada, puntas, cubiertos: quitar.size - sinCalzada - puntas };
}
