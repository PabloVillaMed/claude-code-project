import type { Parche, Presupuesto } from '../types'
import type { Puntuaciones } from './puntuaciones'

export type Orden = 'sugeridos' | 'puntuacion' | 'nombre' | 'presupuesto'

export const ORDENES: { valor: Orden; texto: string }[] = [
  { valor: 'sugeridos', texto: 'Sugeridos' },
  { valor: 'puntuacion', texto: 'Tu puntuación' },
  { valor: 'nombre', texto: 'Nombre' },
  { valor: 'presupuesto', texto: 'Más barato primero' },
]

const ESCALA_PRECIO: Record<Presupuesto, number> = { gratis: 0, $: 1, $$: 2, $$$: 3 }

/**
 * Ordena los resultados. `sugeridos` respeta el orden del catalogo, que agrupa
 * por zona; los demas criterios desempatan siempre por nombre para que la lista
 * no baile entre renders.
 */
export function ordenarParches(parches: Parche[], orden: Orden, puntuaciones: Puntuaciones): Parche[] {
  if (orden === 'sugeridos') return parches

  const porNombre = (a: Parche, b: Parche) => a.nombre.localeCompare(b.nombre, 'es')

  return [...parches].sort((a, b) => {
    if (orden === 'nombre') return porNombre(a, b)
    if (orden === 'presupuesto') {
      return ESCALA_PRECIO[a.presupuesto] - ESCALA_PRECIO[b.presupuesto] || porNombre(a, b)
    }
    // Puntuacion: primero las tuyas mas altas, y los sin puntuar al final.
    return (puntuaciones[b.id] ?? 0) - (puntuaciones[a.id] ?? 0) || porNombre(a, b)
  })
}
