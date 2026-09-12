import type { Categoria, Municipio, Parche, Presupuesto, Ambiente, Momento } from '../types'
import type { ClaveAcceso } from './filtros'

/**
 * Estructura de la interfaz: en que orden se muestran las opciones y de que
 * color es cada tipo de plan. El texto de cada opcion vive en src/i18n.
 */

/** Familias de color. El orden es el de la paleta en el CSS. */
export type Familia = 'verde' | 'azul' | 'amarillo' | 'rosa' | 'naranja'

const FAMILIA_POR_CATEGORIA: Record<Categoria, Familia> = {
  parque: 'verde',
  naturaleza: 'verde',
  mirador: 'verde',
  cultura: 'azul',
  biblioteca: 'azul',
  coworking: 'azul',
  comida: 'amarillo',
  cafe: 'amarillo',
  mercado: 'amarillo',
  rumba: 'rosa',
  bohemio: 'rosa',
  deporte: 'naranja',
}

/** El color lo define la primera categoria, que es la que mejor describe el plan. */
export function familiaDe(parche: Parche): Familia {
  return FAMILIA_POR_CATEGORIA[parche.categorias[0]] ?? 'verde'
}

export const CATEGORIAS: Categoria[] = [
  'parque',
  'naturaleza',
  'mirador',
  'cultura',
  'biblioteca',
  'coworking',
  'comida',
  'cafe',
  'mercado',
  'rumba',
  'bohemio',
  'deporte',
]

export const MUNICIPIOS: Municipio[] = [
  'Medellin',
  'Bello',
  'Envigado',
  'Itagui',
  'Sabaneta',
  'La Estrella',
  'Caldas',
  'Copacabana',
  'Girardota',
  'Barbosa',
  'Santa Elena',
  'Rionegro',
  'Guarne',
]

export const PRESUPUESTOS: Presupuesto[] = ['gratis', '$', '$$', '$$$']

export const MOMENTOS: Momento[] = ['manana', 'tarde', 'noche', 'madrugada']

export const AMBIENTES: Ambiente[] = [
  'tranquilo',
  'familiar',
  'bailable',
  'romantico',
  'creativo',
  'estudiar',
  'deportivo',
  'turistico',
  'local',
  'al aire libre',
  'alternativo',
]

export const ACCESOS: ClaveAcceso[] = [
  'cercaAlMetro',
  'movilidadReducida',
  'aptoNinos',
  'petFriendly',
  'lgbtiqFriendly',
  'sinAlcohol',
]

/**
 * Nombre del municipio tal como se escribe en Colombia. No depende del idioma
 * de la interfaz: es lo que hay que buscar en un mapa y lo que entiende un
 * taxista.
 */
const MUNICIPIO_EN_MAPA: Record<Municipio, string> = {
  Medellin: 'Medellín',
  Bello: 'Bello',
  Envigado: 'Envigado',
  Itagui: 'Itagüí',
  Sabaneta: 'Sabaneta',
  'La Estrella': 'La Estrella',
  Caldas: 'Caldas',
  Copacabana: 'Copacabana',
  Girardota: 'Girardota',
  Barbosa: 'Barbosa',
  'Santa Elena': 'Santa Elena',
  Rionegro: 'Rionegro',
  Guarne: 'Guarne',
}

/** Enlace de busqueda en Google Maps a partir del texto del parche. */
export function enlaceMapa(consulta: string, municipio: Municipio): string {
  const q = encodeURIComponent(`${consulta}, ${MUNICIPIO_EN_MAPA[municipio]}, Antioquia, Colombia`)
  return `https://www.google.com/maps/search/?api=1&query=${q}`
}
