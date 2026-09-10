import type { Accesibilidad, Ambiente, Categoria, Momento, Municipio, Parche, Presupuesto } from '../types'
import { estaAbierto } from './horarios'
import type { Puntuaciones } from './puntuaciones'

export type ClaveAcceso = keyof Accesibilidad

export interface Filtros {
  /** Texto libre: busca en nombre, sector, descripcion y etiquetas. */
  busqueda: string
  municipios: Municipio[]
  categorias: Categoria[]
  presupuestos: Presupuesto[]
  momentos: Momento[]
  ambientes: Ambiente[]
  /** Requisitos de acceso que el parche debe cumplir todos. */
  accesos: ClaveAcceso[]
  /** Deja solo los parches abiertos en el momento de la consulta. */
  soloAbiertos: boolean
  /** Deja solo los parches marcados como favoritos. */
  soloFavoritos: boolean
  /** Minimo de estrellas que le pusiste al parche. 0 no filtra nada. */
  minEstrellas: number
}

export const FILTROS_VACIOS: Filtros = {
  busqueda: '',
  municipios: [],
  categorias: [],
  presupuestos: [],
  momentos: [],
  ambientes: [],
  accesos: [],
  soloAbiertos: false,
  soloFavoritos: false,
  minEstrellas: 0,
}

/** Normaliza texto para comparar sin tildes ni mayusculas. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/** Todo el texto de un parche sobre el que tiene sentido buscar. */
function textoBuscable(parche: Parche): string {
  return normalizar(
    [
      parche.nombre,
      parche.sector,
      parche.municipio,
      parche.descripcion,
      parche.comoLlegar ?? '',
      ...parche.categorias,
      ...parche.ambiente,
    ].join(' '),
  )
}

/** Cierto si el parche coincide con todos los criterios activos. */
export function coincide(
  parche: Parche,
  filtros: Filtros,
  opciones: { favoritos?: Set<string>; ahora?: Date; puntuaciones?: Puntuaciones } = {},
): boolean {
  const { favoritos = new Set<string>(), ahora = new Date(), puntuaciones = {} } = opciones

  const consulta = normalizar(filtros.busqueda)
  if (consulta && !textoBuscable(parche).includes(consulta)) return false

  if (filtros.municipios.length && !filtros.municipios.includes(parche.municipio)) return false

  if (filtros.categorias.length && !filtros.categorias.some((c) => parche.categorias.includes(c))) {
    return false
  }

  if (filtros.presupuestos.length && !filtros.presupuestos.includes(parche.presupuesto)) return false

  if (filtros.momentos.length && !filtros.momentos.some((m) => parche.momentos.includes(m))) return false

  if (filtros.ambientes.length && !filtros.ambientes.some((a) => parche.ambiente.includes(a))) return false

  // Los criterios de acceso son requisitos: se exigen todos, no cualquiera.
  if (filtros.accesos.length && !filtros.accesos.every((clave) => parche.accesibilidad[clave])) {
    return false
  }

  if (filtros.soloFavoritos && !favoritos.has(parche.id)) return false

  if (filtros.minEstrellas > 0 && (puntuaciones[parche.id] ?? 0) < filtros.minEstrellas) return false

  if (filtros.soloAbiertos && !estaAbierto(parche, ahora)) return false

  return true
}

/** Aplica los filtros sobre la lista completa. */
export function filtrarParches(
  parches: Parche[],
  filtros: Filtros,
  opciones: { favoritos?: Set<string>; ahora?: Date; puntuaciones?: Puntuaciones } = {},
): Parche[] {
  return parches.filter((parche) => coincide(parche, filtros, opciones))
}

/** Cuenta cuantos criterios estan activos, para mostrarlo en la interfaz. */
export function contarFiltrosActivos(filtros: Filtros): number {
  return (
    (filtros.busqueda.trim() ? 1 : 0) +
    filtros.municipios.length +
    filtros.categorias.length +
    filtros.presupuestos.length +
    filtros.momentos.length +
    filtros.ambientes.length +
    filtros.accesos.length +
    (filtros.soloAbiertos ? 1 : 0) +
    (filtros.soloFavoritos ? 1 : 0) +
    (filtros.minEstrellas > 0 ? 1 : 0)
  )
}

/** Agrega o quita un valor de una lista de filtro. */
export function alternar<T>(lista: T[], valor: T): T[] {
  return lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor]
}

/** Elige un parche al azar entre los resultados. Devuelve null si no hay ninguno. */
export function parcheAlAzar(parches: Parche[], aleatorio: () => number = Math.random): Parche | null {
  if (parches.length === 0) return null
  return parches[Math.floor(aleatorio() * parches.length)]
}
