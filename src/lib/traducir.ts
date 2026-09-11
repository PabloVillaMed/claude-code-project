import type { Parche } from '../types'
import { PARCHES_EN } from '../data/parches-en'
import type { Idioma } from '../i18n/tipos'

/**
 * Devuelve el catalogo en el idioma pedido. La traduccion solo cambia el texto
 * visible: el resto del parche (horarios, accesibilidad, categorias, el texto
 * con que se busca en el mapa) es el mismo objeto de siempre.
 *
 * Asi el filtrado, la ordenacion y las tarjetas siguen trabajando con `Parche`
 * sin enterarse de que hay idiomas.
 */
export function traducirParches(parches: Parche[], idioma: Idioma): Parche[] {
  if (idioma === 'es') return parches

  return parches.map((parche) => {
    const traduccion = PARCHES_EN[parche.id]
    if (!traduccion) return parche
    return {
      ...parche,
      nombre: traduccion.nombre,
      sector: traduccion.sector,
      descripcion: traduccion.descripcion,
      comoLlegar: traduccion.comoLlegar,
      notaHorario: traduccion.notaHorario,
    }
  })
}
