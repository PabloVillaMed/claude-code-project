// Íconos del HUD, la rueda de armas y la tienda: siluetas de las armas
// renderizadas desde sus modelos 3D (public/models/armas/iconos) e íconos de
// línea en SVG. Nada de emojis: se ven infantiles y cambian según el sistema.

const ICON_DIR = 'models/armas/iconos/';
const available = new Map(); // id -> true/false cuando se sabe si la imagen existe

/** Precarga las siluetas; las que falten se muestran solo con el nombre. */
export function preloadWeaponIcons(ids) {
  for (const id of ids) {
    if (available.has(id)) continue;
    available.set(id, false);
    const img = new Image();
    img.onload = () => available.set(id, true);
    img.src = `${ICON_DIR}${id}.png`;
  }
}

export function weaponIconHtml(id) {
  return available.get(id) ? `<img src="${ICON_DIR}${id}.png" alt="" draggable="false" />` : '';
}

const svg = (body, vb = '0 0 24 24') => `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const LINE_ICONS = {
  // Caja de munición.
  ammo: svg('<rect x="3" y="9" width="18" height="11" rx="1"/><path d="M3 13h18M7 9V5h2v4M11 9V4h2v5M15 9V5h2v4"/>'),
  // Chaleco.
  armor: svg('<path d="M8 3l-4 3v14h7v-5h2v5h7V6l-4-3-2 3h-4z"/><path d="M9 11h6"/>'),
  // Botiquín.
  health: svg('<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M9 6V4h6v2M12 10v6M9 13h6"/>'),
  // Plato con cubiertos.
  food: svg('<circle cx="12" cy="13" r="6"/><circle cx="12" cy="13" r="3"/><path d="M3 4v5a1.5 1.5 0 003 0V4M4.5 9v11M21 4c-2 1-2.5 3-2.5 6h2.5v10"/>'),
  // Encargo (paquete con cinta).
  mission: svg('<rect x="4" y="8" width="16" height="12" rx="1"/><path d="M4 12h16M12 8v12M12 8c-1-3-5-4-5-1s5 1 5 1zm0 0c1-3 5-4 5-1s-5 1-5 1z"/>'),
};

// Siluetas de ropa (tienda de ropa): se rellenan con el color de la prenda.
const ROPA_SHAPES = {
  gorra: '<path d="M4 15a8 7 0 0116 0z"/><path d="M14 15h8v1.6h-8z"/><circle cx="12" cy="8" r=".8"/>',
  camiseta: '<path d="M8 3l-5 3 2 4 2-1v12h10V9l2 1 2-4-5-3a4 3 0 01-8 0z"/>',
  buso: '<path d="M8 4l-5 3 1 14h3V10h10v11h3l1-14-5-3a4 4 0 01-8 0z"/><path d="M8.5 16h7v3h-7z"/>',
  pantalon: '<path d="M6 3h12l1 18h-5l-2-11-2 11H5z"/>',
  tenis: '<path d="M3 17v-5l5-1 3 2 6 1 4 2v2z"/><path d="M3 19h18" stroke-width="2.4"/>',
  chanclas: '<ellipse cx="8" cy="13" rx="3.5" ry="7"/><ellipse cx="16.5" cy="13" rx="3.5" ry="7"/>',
  cadena: '<path d="M5 4c0 9 3 12 7 12s7-3 7-12" fill="none" stroke-width="2.2"/><circle cx="12" cy="18" r="2.2"/>',
  canguro: '<rect x="4" y="9" width="16" height="9" rx="4"/><path d="M5 9L15 2" fill="none" stroke-width="1.6"/>',
  gafas: '<ellipse cx="7" cy="12" rx="4.5" ry="3.3"/><ellipse cx="17" cy="12" rx="4.5" ry="3.3"/><path d="M11 11h2" fill="none"/>',
};
const ROPA_SHAPE_OF = { 'gorra-plana': 'gorra', 'gorra-curva': 'gorra', camiseta: 'camiseta', buso: 'buso', jean: 'pantalon', sudadera: 'pantalon', tenis: 'tenis', chanclas: 'chanclas', cadena: 'cadena', canguro: 'canguro', gafas: 'gafas' };

/** Ícono de una prenda del catálogo (sim/ropa.js), con su color. */
export function ropaIconHtml(item) {
  const shape = ROPA_SHAPES[ROPA_SHAPE_OF[item.type]] ?? ROPA_SHAPES.camiseta;
  const hex = item.color ?? (item.type === 'jean' ? 0x3d5a80 : 0x222222);
  const fill = `#${hex.toString(16).padStart(6, '0')}`;
  return `<svg viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round">${shape}</svg>`;
}

/** Estrella de búsqueda en SVG (nítida a cualquier escala). */
export const STAR_SVG = (on) => `<svg class="${on ? 'on' : ''}" viewBox="0 0 24 24"><path d="M12 2.8l2.7 5.9 6.4.7-4.8 4.3 1.4 6.3L12 16.8 6.3 20l1.4-6.3L2.9 9.4l6.4-.7z"/></svg>`;
