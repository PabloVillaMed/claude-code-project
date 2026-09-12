import { describe, expect, it } from 'vitest'
import { crearPilaDeCapas } from './capas'
import type { HistorialMinimo } from './capas'

/** Historial de mentira: cuenta entradas y dispara el retroceso a mano. */
function historialFalso() {
  let entradas = 0
  let alVolver = () => {}
  const historial: HistorialMinimo = {
    push: () => {
      entradas++
    },
    back: () => {
      if (entradas > 0) entradas--
      alVolver()
    },
    escuchar: (f) => {
      alVolver = f
    },
  }
  return { historial, atras: () => historial.back(), entradas: () => entradas }
}

describe('pila de capas', () => {
  it('el gesto de atrás cierra la capa abierta', () => {
    const { historial, atras } = historialFalso()
    const pila = crearPilaDeCapas(historial)
    let cerrada = false
    pila.abrir(() => {
      cerrada = true
    })
    expect(pila.hayAbiertas()).toBe(true)
    atras()
    expect(cerrada).toBe(true)
    expect(pila.hayAbiertas()).toBe(false)
  })

  it('cierra de arriba abajo, una por cada atrás', () => {
    const { historial, atras } = historialFalso()
    const pila = crearPilaDeCapas(historial)
    const cerradas: string[] = []
    pila.abrir(() => cerradas.push('panel'))
    pila.abrir(() => cerradas.push('detalle'))

    atras()
    expect(cerradas).toEqual(['detalle'])
    atras()
    expect(cerradas).toEqual(['detalle', 'panel'])
    expect(pila.hayAbiertas()).toBe(false)
  })

  it('cerrar con la X no arrastra la capa de abajo', () => {
    const { historial, atras } = historialFalso()
    const pila = crearPilaDeCapas(historial)
    const cerradas: string[] = []
    pila.abrir(() => cerradas.push('panel'))
    const soltarDetalle = pila.abrir(() => cerradas.push('detalle'))

    // El detalle se cierra con la X: consume su entrada y nada más.
    soltarDetalle()
    expect(cerradas).toEqual([])
    expect(pila.profundidad()).toBe(1)

    // El siguiente atrás cierra el panel, que es lo que queda.
    atras()
    expect(cerradas).toEqual(['panel'])
  })

  it('no deja entradas sueltas en el historial', () => {
    const { historial, atras, entradas } = historialFalso()
    const pila = crearPilaDeCapas(historial)
    const soltar = pila.abrir(() => {})
    expect(entradas()).toBe(1)
    soltar()
    expect(entradas()).toBe(0)

    pila.abrir(() => {})
    atras()
    expect(entradas()).toBe(0)
  })

  it('sin capas abiertas no hay nada que cerrar', () => {
    const { historial } = historialFalso()
    const pila = crearPilaDeCapas(historial)
    expect(pila.hayAbiertas()).toBe(false)
    expect(pila.profundidad()).toBe(0)
  })
})
