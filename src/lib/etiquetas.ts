import type { Ambiente, Categoria, Momento, Municipio, Presupuesto } from '../types'
import type { ClaveAcceso } from './filtros'

/** Textos y emojis con los que se muestra cada valor del dominio. */

export const CATEGORIAS: { valor: Categoria; texto: string; emoji: string }[] = [
  { valor: 'parque', texto: 'Parques', emoji: '🌳' },
  { valor: 'naturaleza', texto: 'Naturaleza', emoji: '🥾' },
  { valor: 'cultura', texto: 'Cultura', emoji: '🎭' },
  { valor: 'mirador', texto: 'Miradores', emoji: '🌄' },
  { valor: 'comida', texto: 'Comida', emoji: '🍽️' },
  { valor: 'cafe', texto: 'Cafes', emoji: '☕' },
  { valor: 'rumba', texto: 'Rumba', emoji: '🎶' },
  { valor: 'deporte', texto: 'Deporte', emoji: '⚽' },
  { valor: 'mercado', texto: 'Mercados', emoji: '🧺' },
  { valor: 'biblioteca', texto: 'Bibliotecas', emoji: '📚' },
  { valor: 'coworking', texto: 'Para trabajar', emoji: '💻' },
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

export const PRESUPUESTOS: { valor: Presupuesto; texto: string }[] = [
  { valor: 'gratis', texto: 'Gratis' },
  { valor: '$', texto: '$ economico' },
  { valor: '$$', texto: '$$ medio' },
  { valor: '$$$', texto: '$$$ alto' },
]

export const MOMENTOS: { valor: Momento; texto: string; emoji: string }[] = [
  { valor: 'manana', texto: 'Manana', emoji: '🌅' },
  { valor: 'tarde', texto: 'Tarde', emoji: '☀️' },
  { valor: 'noche', texto: 'Noche', emoji: '🌙' },
  { valor: 'madrugada', texto: 'Madrugada', emoji: '🌃' },
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

export const ACCESOS: { valor: ClaveAcceso; texto: string; emoji: string }[] = [
  { valor: 'cercaAlMetro', texto: 'Cerca al Metro', emoji: '🚇' },
  { valor: 'movilidadReducida', texto: 'Movilidad reducida', emoji: '♿' },
  { valor: 'aptoNinos', texto: 'Con ninos', emoji: '🧒' },
  { valor: 'petFriendly', texto: 'Pet friendly', emoji: '🐕' },
  { valor: 'lgbtiqFriendly', texto: 'LGBTIQ+ friendly', emoji: '🏳️‍🌈' },
  { valor: 'sinAlcohol', texto: 'Plan sin alcohol', emoji: '🧃' },
]

export const TEXTO_PRESUPUESTO: Record<Presupuesto, string> = {
  gratis: 'Gratis',
  $: 'Economico',
  $$: 'Precio medio',
  $$$: 'Costoso',
}

/** Enlace de busqueda en Google Maps a partir del texto del parche. */
export function enlaceMapa(consulta: string, municipio: Municipio): string {
  const q = encodeURIComponent(`${consulta}, ${municipio}, Antioquia, Colombia`)
  return `https://www.google.com/maps/search/?api=1&query=${q}`
}
