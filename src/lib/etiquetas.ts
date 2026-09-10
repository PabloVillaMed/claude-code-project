import type { Ambiente, Categoria, Momento, Municipio, Parche, Presupuesto } from '../types'
import type { ClaveAcceso } from './filtros'

/**
 * Textos de la interfaz y, sobre todo, el color con que se marca cada tipo de
 * plan. El color aqui no decora: dice de que es el parche.
 */

/** Familias de color. El orden es el de la paleta en el CSS. */
export type Familia = 'verde' | 'azul' | 'amarillo' | 'rosa' | 'naranja'

export const FAMILIAS: Familia[] = ['verde', 'azul', 'amarillo', 'rosa', 'naranja']

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
  deporte: 'naranja',
}

/** La familia la define la primera categoria, que es la que mejor describe el plan. */
export function familiaDe(parche: Parche): Familia {
  return FAMILIA_POR_CATEGORIA[parche.categorias[0]] ?? 'verde'
}

export const CATEGORIAS: { valor: Categoria; texto: string }[] = [
  { valor: 'parque', texto: 'Parques' },
  { valor: 'naturaleza', texto: 'Naturaleza' },
  { valor: 'mirador', texto: 'Miradores' },
  { valor: 'cultura', texto: 'Cultura' },
  { valor: 'biblioteca', texto: 'Bibliotecas' },
  { valor: 'coworking', texto: 'Para trabajar' },
  { valor: 'comida', texto: 'Comida' },
  { valor: 'cafe', texto: 'Cafés' },
  { valor: 'mercado', texto: 'Mercados' },
  { valor: 'rumba', texto: 'Rumba' },
  { valor: 'deporte', texto: 'Deporte' },
]

export const TEXTO_CATEGORIA: Record<Categoria, string> = Object.fromEntries(
  CATEGORIAS.map((c) => [c.valor, c.texto]),
) as Record<Categoria, string>

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

/** Los municipios se guardan sin tildes; asi se escriben en pantalla. */
export const TEXTO_MUNICIPIO: Record<Municipio, string> = {
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

export const PRESUPUESTOS: { valor: Presupuesto; texto: string }[] = [
  { valor: 'gratis', texto: 'Gratis' },
  { valor: '$', texto: 'Económico' },
  { valor: '$$', texto: 'Precio medio' },
  { valor: '$$$', texto: 'Costoso' },
]

export const TEXTO_PRESUPUESTO: Record<Presupuesto, string> = {
  gratis: 'Gratis',
  $: 'Económico',
  $$: 'Precio medio',
  $$$: 'Costoso',
}

export const MOMENTOS: { valor: Momento; texto: string }[] = [
  { valor: 'manana', texto: 'Mañana' },
  { valor: 'tarde', texto: 'Tarde' },
  { valor: 'noche', texto: 'Noche' },
  { valor: 'madrugada', texto: 'Madrugada' },
]

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
]

export const TEXTO_AMBIENTE: Record<Ambiente, string> = {
  tranquilo: 'tranquilo',
  familiar: 'familiar',
  bailable: 'bailable',
  romantico: 'romántico',
  creativo: 'creativo',
  estudiar: 'para estudiar',
  deportivo: 'deportivo',
  turistico: 'turístico',
  local: 'de local',
  'al aire libre': 'al aire libre',
}

/** Criterios de acceso, con un texto corto para la tarjeta y uno largo para el detalle. */
export const ACCESOS: { valor: ClaveAcceso; corto: string; texto: string }[] = [
  { valor: 'cercaAlMetro', corto: 'Metro', texto: 'Se llega en Metro' },
  { valor: 'movilidadReducida', corto: 'Accesible', texto: 'Accesible en silla de ruedas' },
  { valor: 'aptoNinos', corto: 'Niños', texto: 'Apto para ir con niños' },
  { valor: 'petFriendly', corto: 'Mascotas', texto: 'Se puede entrar con mascota' },
  { valor: 'lgbtiqFriendly', corto: 'LGBTIQ+', texto: 'Espacio LGBTIQ+ friendly' },
  { valor: 'sinAlcohol', corto: 'Sin alcohol', texto: 'Hay plan sin alcohol' },
]

/** Enlace de busqueda en Google Maps a partir del texto del parche. */
export function enlaceMapa(consulta: string, municipio: Municipio): string {
  const q = encodeURIComponent(`${consulta}, ${TEXTO_MUNICIPIO[municipio]}, Antioquia, Colombia`)
  return `https://www.google.com/maps/search/?api=1&query=${q}`
}
