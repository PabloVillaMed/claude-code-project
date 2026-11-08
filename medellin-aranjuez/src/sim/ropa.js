// Ropa del jugador: el catálogo de los almacenes de la 92 y de Carabobo
// (gorras, busos, camisetas, jeans, sudaderas, tenis, chanclas, cadena,
// canguro y gafas) y de los de vestimenta paisa (sombrero aguadeño, poncho,
// carriel, alpargatas), qué se lleva puesto y cómo se guarda en la partida.
// Puro y sin three.js: render/outfit.js convierte la pinta en colores del
// avatar y mallas pegadas a los huesos.
//
// Nombres y diseños inventados: nada de marcas ni escudos de equipos (las
// camisetas "de fútbol" son solo colores y rayas).

/** Partes del cuerpo: cada una lleva a lo sumo una prenda. */
export const SLOTS = ['cabeza', 'torso', 'piernas', 'pies', 'cuello', 'cintura', 'ojos', 'hombro'];
/** Partes que pueden ir vacías (se pueden quitar). */
export const OPTIONAL = new Set(['cabeza', 'cuello', 'cintura', 'ojos', 'hombro']);

// Colores (0xRRGGBB).
const C = {
  blanco: 0xf2f2ee,
  negro: 0x1b1b1d,
  rojo: 0xc8102e,
  verde: 0x0f7a3d,
  azul: 0x1f3f8f,
  celeste: 0x5ab4e5,
  gris: 0x8a8d91,
  grisOscuro: 0x44474c,
  beige: 0xcdb58c,
  vinotinto: 0x6d1026,
  amarillo: 0xf2c200,
  naranja: 0xf06a1d,
  rosado: 0xf28cb8,
  morado: 0x5b2a86,
  dorado: 0xd8a93a,
  plata: 0xc9ccd1,
  mostaza: 0xc9962b,
  oliva: 0x5b6b35,
  paja: 0xeee2bf,
  cuero: 0x6b3f1f,
  cueroOscuro: 0x3a2312,
  crudo: 0xe9e2cf,
  fique: 0xd9c9a3,
  dril: 0xb9a27a,
};

/**
 * Catálogo. `slot`: parte del cuerpo; `type`: la forma (el render decide la
 * malla o el recoloreado); `color` / `color2`: colores; `pattern`: 'rayas'
 * verticales, 'franja' (banda en el pecho) o nada; `long`: mangas largas.
 */
export const ROPA = [
  // ---- gorras: plana (visera recta) o curva
  { id: 'gorra-plana-negra', slot: 'cabeza', type: 'gorra-plana', name: 'Gorra plana negra', desc: 'Visera recta, pa la foto', price: 90, color: C.negro, color2: C.dorado },
  { id: 'gorra-plana-blanca', slot: 'cabeza', type: 'gorra-plana', name: 'Gorra plana blanca', desc: 'Visera recta, bien limpia', price: 90, color: C.blanco, color2: C.negro },
  { id: 'gorra-plana-roja', slot: 'cabeza', type: 'gorra-plana', name: 'Gorra plana roja', desc: 'Visera recta con botón negro', price: 90, color: C.rojo, color2: C.negro },
  { id: 'gorra-curva-verde', slot: 'cabeza', type: 'gorra-curva', name: 'Gorra curva verde', desc: 'La de siempre del parche', price: 70, color: C.verde, color2: C.blanco },
  { id: 'gorra-curva-azul', slot: 'cabeza', type: 'gorra-curva', name: 'Gorra curva azul', desc: 'Visera curvita, pa el sol', price: 70, color: C.azul, color2: C.blanco },
  { id: 'gorra-curva-beige', slot: 'cabeza', type: 'gorra-curva', name: 'Gorra curva beige', desc: 'Tipo campesino moderno', price: 60, color: C.beige, color2: C.grisOscuro },
  { id: 'gorra-curva-negra', slot: 'cabeza', type: 'gorra-curva', name: 'Gorra curva negra', desc: 'No falla con nada', price: 60, color: C.negro, color2: C.negro },
  // ---- camisetas
  { id: 'camiseta-blanca', slot: 'torso', type: 'camiseta', name: 'Camiseta blanca', desc: 'La básica de algodón', price: 40, color: C.blanco },
  { id: 'camiseta-negra', slot: 'torso', type: 'camiseta', name: 'Camiseta negra', desc: 'Básica, cuello redondo', price: 40, color: C.negro },
  { id: 'camiseta-gris', slot: 'torso', type: 'camiseta', name: 'Camiseta gris', desc: 'Básica jaspeada', price: 35, color: C.gris },
  { id: 'camiseta-amarilla', slot: 'torso', type: 'camiseta', name: 'Camiseta amarilla', desc: 'Pa ver el partido de la Selección', price: 70, color: C.amarillo, color2: C.azul, pattern: 'franja' },
  { id: 'camiseta-verdiblanca', slot: 'torso', type: 'camiseta', name: 'Camiseta verdiblanca', desc: 'Rayas verdes y blancas, sin escudo', price: 110, color: C.verde, color2: C.blanco, pattern: 'rayas' },
  { id: 'camiseta-roja', slot: 'torso', type: 'camiseta', name: 'Camiseta roja de fútbol', desc: 'Roja con franja azul, sin escudo', price: 110, color: C.rojo, color2: C.azul, pattern: 'franja' },
  { id: 'camisa-rosada', slot: 'torso', type: 'camiseta', name: 'Camiseta tipo polo rosada', desc: 'Pa salir el viernes', price: 80, color: C.rosado },
  { id: 'camiseta-vinotinto', slot: 'torso', type: 'camiseta', name: 'Camiseta vinotinto', desc: 'Oversize, cae suelta', price: 60, color: C.vinotinto },
  // ---- busos (hoodies): mangas largas y capota
  { id: 'buso-negro', slot: 'torso', type: 'buso', name: 'Buso negro con capota', desc: 'Pa el frío de la madrugada', price: 180, color: C.negro, long: true },
  { id: 'buso-gris', slot: 'torso', type: 'buso', name: 'Buso gris con capota', desc: 'Afelpado por dentro', price: 170, color: C.gris, long: true },
  { id: 'buso-verde', slot: 'torso', type: 'buso', name: 'Buso verde oliva', desc: 'Con capota y bolsillo canguro', price: 190, color: C.oliva, long: true },
  { id: 'buso-rojo', slot: 'torso', type: 'buso', name: 'Buso rojo', desc: 'Con capota, del que se ve de lejos', price: 190, color: C.rojo, long: true },
  { id: 'buso-mostaza', slot: 'torso', type: 'buso', name: 'Buso mostaza', desc: 'El color de la temporada', price: 200, color: C.mostaza, long: true },
  // ---- piernas
  { id: 'jean-azul', slot: 'piernas', type: 'jean', name: 'Jean azul clásico', desc: 'Tiro medio, el de toda la vida', price: 120 },
  { id: 'jean-negro', slot: 'piernas', type: 'jean', name: 'Jean negro', desc: 'Entubado', price: 130, color: C.negro },
  { id: 'jean-claro', slot: 'piernas', type: 'jean', name: 'Jean prelavado claro', desc: 'Descaderado, bien paisa', price: 140, color: C.celeste },
  { id: 'sudadera-negra', slot: 'piernas', type: 'sudadera', name: 'Sudadera negra', desc: 'Jogger con puño en el tobillo', price: 90, color: C.negro, color2: C.blanco },
  { id: 'sudadera-gris', slot: 'piernas', type: 'sudadera', name: 'Sudadera gris', desc: 'Jogger de algodón', price: 85, color: C.gris, color2: C.blanco },
  { id: 'sudadera-azul', slot: 'piernas', type: 'sudadera', name: 'Sudadera azul oscura', desc: 'Con franja blanca a los lados', price: 95, color: C.azul, color2: C.blanco },
  // ---- pies
  { id: 'tenis-negros', slot: 'pies', type: 'tenis', name: 'Tenis negros', desc: 'Suela blanca, pa todo', price: 180 },
  { id: 'tenis-blancos', slot: 'pies', type: 'tenis', name: 'Tenis blancos', desc: 'Hay que cuidarlos del barro', price: 220, color: C.blanco },
  { id: 'tenis-rojos', slot: 'pies', type: 'tenis', name: 'Tenis rojos', desc: 'Llamativos', price: 210, color: C.rojo },
  { id: 'tenis-azules', slot: 'pies', type: 'tenis', name: 'Tenis azules', desc: 'De bota baja', price: 200, color: C.azul },
  { id: 'chanclas', slot: 'pies', type: 'chanclas', name: 'Chanclas con medias', desc: 'Medias blancas y chancla: el uniforme del domingo', price: 25, color: C.azul, color2: C.blanco },
  // ---- accesorios
  { id: 'cadena-dorada', slot: 'cuello', type: 'cadena', name: 'Cadena dorada', desc: 'Gruesa, que se vea', price: 250, color: C.dorado },
  { id: 'cadena-plateada', slot: 'cuello', type: 'cadena', name: 'Cadena plateada', desc: 'Delgadita, con dije', price: 160, color: C.plata },
  { id: 'canguro-negro', slot: 'cintura', type: 'canguro', name: 'Canguro negro', desc: 'Terciado al pecho, pa el celular y la plata', price: 80, color: C.negro, color2: C.grisOscuro },
  { id: 'canguro-camuflado', slot: 'cintura', type: 'canguro', name: 'Canguro verde', desc: 'Terciado, con cremallera', price: 80, color: C.oliva, color2: C.negro },
  { id: 'gafas-negras', slot: 'ojos', type: 'gafas', name: 'Gafas oscuras', desc: 'Pa el sol del mediodía', price: 70, color: C.negro },
  { id: 'gafas-espejo', slot: 'ojos', type: 'gafas', name: 'Gafas espejo', desc: 'Lente espejado azul', price: 95, color: C.celeste },
  // ---- vestimenta paisa (la del arriero, como se lleva hoy en la ciudad)
  { id: 'sombrero-aguadeno', slot: 'cabeza', type: 'sombrero', name: 'Sombrero aguadeño', desc: 'De paja de iraca, ala ancha y cinta negra', price: 160, color: C.paja, color2: C.negro },
  { id: 'sombrero-aguadeno-fino', slot: 'cabeza', type: 'sombrero', name: 'Aguadeño fino', desc: 'Tejido apretado, cinta café: pa las fiestas', price: 240, color: 0xf4ecd2, color2: C.cueroOscuro },
  { id: 'poncho-blanco', slot: 'hombro', type: 'poncho', name: 'Poncho blanco', desc: 'Al hombro, como buen paisa; rayitas negras en las puntas', price: 120, color: C.crudo, color2: C.negro },
  { id: 'poncho-rayas', slot: 'hombro', type: 'poncho', name: 'Poncho de rayas rojas', desc: 'Pa el sol, el frío y pa saludar', price: 130, color: C.crudo, color2: C.rojo },
  { id: 'carriel', slot: 'cintura', type: 'carriel', name: 'Carriel de cuero', desc: 'Terciado a la cadera, con sus bolsillos secretos', price: 280, color: C.cuero, color2: C.cueroOscuro },
  { id: 'carriel-negro', slot: 'cintura', type: 'carriel', name: 'Carriel negro', desc: 'Cuero curtido negro, hebillas de bronce', price: 300, color: 0x241c18, color2: C.dorado },
  { id: 'alpargatas', slot: 'pies', type: 'alpargatas', name: 'Alpargatas de fique', desc: 'Suela de fique y capellada de lona: frescas', price: 60, color: C.fique, color2: C.negro },
  { id: 'camisa-blanca-larga', slot: 'torso', type: 'camisa', name: 'Camisa blanca de manga larga', desc: 'La del arriero, arremangada pa trabajar', price: 90, color: C.blanco, long: true },
  { id: 'camisa-cuadros', slot: 'torso', type: 'camisa', name: 'Camisa de cuadros', desc: 'Manga larga, rayas rojas sobre crudo', price: 100, color: 0xb23a2c, color2: C.crudo, pattern: 'rayas', long: true },
  { id: 'pantalon-dril', slot: 'piernas', type: 'jean', name: 'Pantalón de dril', desc: 'Color caqui, el de la finca', price: 110, color: C.dril },
  // ---- ropa gastada de los habitantes de calle (no se vende: hidden)
  { id: 'harapo', slot: 'torso', type: 'harapo', name: 'Saco viejo', desc: '', price: 0, color: 0x4a4136, long: true, hidden: true },
  { id: 'harapo-gris', slot: 'torso', type: 'harapo', name: 'Buso viejo', desc: '', price: 0, color: 0x55524c, long: true, hidden: true },
  { id: 'pantalon-viejo', slot: 'piernas', type: 'pantalon-viejo', name: 'Pantalón viejo', desc: '', price: 0, color: 0x3b342b, hidden: true },
  { id: 'chanclas-viejas', slot: 'pies', type: 'chanclas', name: 'Chanclas viejas', desc: '', price: 0, color: 0x2b2b2b, color2: 0x8b8577, hidden: true },
  { id: 'cobija', slot: 'hombro', type: 'cobija', name: 'Cobija', desc: '', price: 0, color: 0x6e6253, color2: 0x3d352c, hidden: true },
  // ---- pinta de rumba de la gente de la 92 de noche (game/nightlife.js; no se vende: hidden)
  // Camisas de colores llamativos (ellos), blusas y vestidos del mismo color
  // (ellas: la falda es una malla pegada a la pelvis y `color2`, las medias),
  // jeans oscuros; la camisa negra del portero.
  { id: 'camisa-fiesta-fucsia', slot: 'torso', type: 'camiseta', name: 'Camisa fucsia', desc: '', price: 0, color: 0xd6247a, hidden: true },
  { id: 'camisa-fiesta-turquesa', slot: 'torso', type: 'camiseta', name: 'Camisa turquesa', desc: '', price: 0, color: 0x10a5a8, hidden: true },
  { id: 'camisa-fiesta-amarilla', slot: 'torso', type: 'camiseta', name: 'Camisa amarilla', desc: '', price: 0, color: 0xf3c614, hidden: true },
  { id: 'camisa-fiesta-blanca', slot: 'torso', type: 'camisa', name: 'Camisa blanca de salir', desc: '', price: 0, color: 0xf7f7f2, long: true, hidden: true },
  { id: 'camisa-fiesta-negra', slot: 'torso', type: 'camisa', name: 'Camisa negra de salir', desc: '', price: 0, color: 0x161618, long: true, hidden: true },
  { id: 'camisa-fiesta-roja', slot: 'torso', type: 'camisa', name: 'Camisa roja de salir', desc: '', price: 0, color: 0xc0122c, long: true, hidden: true },
  { id: 'camisa-fiesta-estampada', slot: 'torso', type: 'camiseta', name: 'Camisa estampada', desc: '', price: 0, color: 0x1d2f8f, color2: 0xf06a1d, pattern: 'rayas', hidden: true },
  { id: 'blusa-roja', slot: 'torso', type: 'blusa', name: 'Blusa roja', desc: '', price: 0, color: 0xd0102a, hidden: true },
  { id: 'blusa-negra', slot: 'torso', type: 'blusa', name: 'Blusa negra', desc: '', price: 0, color: 0x151416, hidden: true },
  { id: 'blusa-dorada', slot: 'torso', type: 'blusa', name: 'Blusa dorada', desc: '', price: 0, color: 0xd8a93a, hidden: true },
  { id: 'blusa-fucsia', slot: 'torso', type: 'blusa', name: 'Blusa fucsia', desc: '', price: 0, color: 0xe0247f, hidden: true },
  { id: 'blusa-plateada', slot: 'torso', type: 'blusa', name: 'Blusa plateada', desc: '', price: 0, color: 0xc9ccd1, hidden: true },
  { id: 'blusa-esmeralda', slot: 'torso', type: 'blusa', name: 'Blusa esmeralda', desc: '', price: 0, color: 0x0c8f5a, hidden: true },
  { id: 'blusa-azul-rey', slot: 'torso', type: 'blusa', name: 'Blusa azul rey', desc: '', price: 0, color: 0x1f4fd8, hidden: true },
  { id: 'blusa-blanca', slot: 'torso', type: 'blusa', name: 'Blusa blanca', desc: '', price: 0, color: 0xf4f2ee, hidden: true },
  { id: 'vestido-rojo', slot: 'piernas', type: 'vestido', name: 'Vestido rojo', desc: '', price: 0, color: 0xd0102a, color2: 0x2a1c1c, hidden: true },
  { id: 'vestido-negro', slot: 'piernas', type: 'vestido', name: 'Vestido negro', desc: '', price: 0, color: 0x151416, color2: 0x1d1719, hidden: true },
  { id: 'vestido-dorado', slot: 'piernas', type: 'vestido', name: 'Vestido dorado', desc: '', price: 0, color: 0xd8a93a, color2: 0x3a2a22, hidden: true },
  { id: 'vestido-fucsia', slot: 'piernas', type: 'vestido', name: 'Vestido fucsia', desc: '', price: 0, color: 0xe0247f, color2: 0x24181c, hidden: true },
  { id: 'vestido-plateado', slot: 'piernas', type: 'vestido', name: 'Vestido plateado', desc: '', price: 0, color: 0xc9ccd1, color2: 0x1f1a1c, hidden: true },
  { id: 'vestido-esmeralda', slot: 'piernas', type: 'vestido', name: 'Vestido esmeralda', desc: '', price: 0, color: 0x0c8f5a, color2: 0x1b1a1a, hidden: true },
  { id: 'vestido-azul-rey', slot: 'piernas', type: 'vestido', name: 'Vestido azul rey', desc: '', price: 0, color: 0x1f4fd8, color2: 0x1c1a22, hidden: true },
  { id: 'jean-oscuro', slot: 'piernas', type: 'jean', name: 'Jean oscuro', desc: '', price: 0, color: 0x1b2438, hidden: true },
  { id: 'camisa-portero', slot: 'torso', type: 'camisa', name: 'Camisa negra de portero', desc: '', price: 0, color: 0x0e0e10, long: true, hidden: true },
];

export const ROPA_BY_ID = Object.fromEntries(ROPA.map((r) => [r.id, r]));

/**
 * La pinta con la que arranca el jugador: paisa de ciudad, con camisa blanca
 * de manga larga, jean, tenis blancos, poncho al hombro y carriel.
 */
export const DEFAULT_OUTFIT = Object.freeze({ torso: 'camisa-blanca-larga', piernas: 'jean-azul', pies: 'tenis-blancos', hombro: 'poncho-blanco', cintura: 'carriel' });

/**
 * Almacenes de ropa: qué vende cada uno (por id o por tipo) y a qué precio
 * (`factor`: los remates venden más barato).
 */
export const ROPA_STORES = {
  modapaisa: { types: ['camiseta', 'buso', 'jean'], exclude: ['camiseta-verdiblanca', 'camiseta-roja', 'camiseta-amarilla'], factor: 1 },
  boutique92: { ids: ['camisa-rosada', 'camiseta-vinotinto', 'camiseta-negra', 'jean-negro', 'jean-claro', 'gafas-negras', 'gafas-espejo', 'cadena-dorada', 'cadena-plateada', 'canguro-negro'], factor: 1.15 },
  remates: { ids: ['camiseta-blanca', 'camiseta-negra', 'camiseta-gris', 'sudadera-negra', 'sudadera-gris', 'chanclas', 'gorra-curva-beige', 'gorra-curva-negra', 'canguro-camuflado', 'gafas-negras', 'jean-azul', 'tenis-negros'], factor: 0.7 },
  deportes: { types: ['sudadera', 'tenis'], ids: ['camiseta-verdiblanca', 'camiseta-roja', 'camiseta-amarilla', 'gorra-curva-verde', 'gorra-curva-azul', 'buso-negro', 'chanclas'], factor: 1 },
  gorras52: { types: ['gorra-plana', 'gorra-curva', 'tenis'], ids: ['cadena-dorada', 'gafas-negras'], factor: 1 },
  // Vestimenta paisa: el sombrero y el poncho donde El Arriero; el cuero en la
  // talabartería; de todo un poco (y más barato) en el puesto de artesanías.
  arriero: { types: ['sombrero', 'poncho', 'camisa'], ids: ['pantalon-dril', 'alpargatas'], factor: 1 },
  talabarteria: { types: ['carriel'], ids: ['canguro-negro', 'alpargatas', 'sombrero-aguadeno', 'sombrero-aguadeno-fino', 'pantalon-dril'], factor: 1.1 },
  silletera: { ids: ['sombrero-aguadeno', 'poncho-blanco', 'poncho-rayas', 'alpargatas', 'camisa-blanca-larga', 'camisa-cuadros', 'carriel'], factor: 0.85 },
};

/** Precio de una prenda en un almacén (redondeado a $5). */
export function priceIn(item, store) {
  const f = ROPA_STORES[store]?.factor ?? 1;
  return Math.max(5, Math.round((item.price * f) / 5) * 5);
}

/** Prendas que vende un almacén, en el orden del catálogo. */
export function storeCatalog(store) {
  const s = ROPA_STORES[store];
  if (!s) return [];
  const ids = new Set(s.ids ?? []);
  const types = new Set(s.types ?? []);
  const ex = new Set(s.exclude ?? []);
  return ROPA.filter((r) => !r.hidden && !ex.has(r.id) && (ids.has(r.id) || types.has(r.type))).map((r) => ({ ...r, price: priceIn(r, store) }));
}

/** Pinta nueva con la prenda puesta (reemplaza lo que hubiera en esa parte). */
export function wear(outfit, id) {
  const it = ROPA_BY_ID[id];
  if (!it) return { ...outfit };
  return { ...outfit, [it.slot]: id };
}

/** Pinta nueva sin nada en esa parte (solo las opcionales: no se sale sin camiseta). */
export function takeOff(outfit, slot) {
  if (!OPTIONAL.has(slot)) return { ...outfit };
  const o = { ...outfit };
  delete o[slot];
  return o;
}

/** Deja solo prendas que existen, cada una en su parte; completa lo obligatorio. */
export function sanitizeOutfit(raw) {
  const out = { ...DEFAULT_OUTFIT };
  if (raw && typeof raw === 'object') {
    let valid = 0;
    for (const slot of SLOTS) {
      const id = raw[slot];
      if (id === undefined) {
        // Lo opcional que no está se lo quitó (o nunca lo tuvo un guardado viejo).
        if (OPTIONAL.has(slot)) delete out[slot];
        continue;
      }
      const it = ROPA_BY_ID[id];
      if (it && it.slot === slot) {
        out[slot] = id;
        valid++;
      }
    }
    // Nada reconocible (guardado dañado): la pinta de siempre, completa.
    if (!valid) return { ...DEFAULT_OUTFIT };
  }
  return out;
}

/** Guardado: {outfit, owned}. */
export function serializeWardrobe(w) {
  return { outfit: { ...w.outfit }, owned: [...w.owned].filter((id) => ROPA_BY_ID[id]) };
}

/** Lee el guardado (o nada) y devuelve un guardarropa válido: lo puesto siempre es propio. */
export function deserializeWardrobe(raw) {
  const outfit = sanitizeOutfit(raw?.outfit);
  const owned = new Set(Object.values(DEFAULT_OUTFIT));
  for (const id of Array.isArray(raw?.owned) ? raw.owned : []) if (ROPA_BY_ID[id]) owned.add(id);
  for (const id of Object.values(outfit)) owned.add(id);
  return { outfit, owned };
}

/** Guardarropa de una partida nueva. */
export function newWardrobe() {
  return deserializeWardrobe(null);
}

/**
 * Comprar (o ponerse, si ya es suya) una prenda: devuelve
 * {ok, cost, wardrobe, reason}. No toca la plata: eso lo hace el juego.
 */
export function buyOrWear(wardrobe, item, money) {
  const owned = wardrobe.owned.has(item.id);
  if (!owned && money < item.price) return { ok: false, cost: 0, wardrobe, reason: 'plata' };
  const next = { outfit: wear(wardrobe.outfit, item.id), owned: new Set(wardrobe.owned).add(item.id) };
  return { ok: true, cost: owned ? 0 : item.price, wardrobe: next };
}
