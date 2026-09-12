import { useEffect, useRef } from 'react'

/**
 * Pila de "capas": lo que se abre encima del listado, como el detalle de un
 * parche o el panel de filtros en el telefono.
 *
 * Cada capa abierta anade una entrada al historial. Asi el gesto de atras de
 * Android cierra la capa de arriba en vez de cerrar la app, y en el navegador
 * el boton de atras hace exactamente lo mismo.
 */

export interface HistorialMinimo {
  /** Anade una entrada al historial. */
  push: () => void
  /** Retrocede una entrada. */
  back: () => void
  /** Avisa cuando se retrocede, venga de donde venga. */
  escuchar: (alVolver: () => void) => void
}

export function crearPilaDeCapas(historial: HistorialMinimo) {
  const pila: { id: number; cerrar: () => void }[] = []
  let siguienteId = 1
  /**
   * Retrocesos que pidio la propia app al cerrar una capa por otra via (la X,
   * Escape, tocar el fondo). Hay que ignorarlos: si no, cerrarian tambien la
   * capa de abajo.
   */
  let programados = 0
  let escuchando = false

  function alVolver() {
    if (programados > 0) {
      programados--
      return
    }
    pila.pop()?.cerrar()
  }

  return {
    /** Abre una capa. Devuelve la funcion a llamar si se cierra por otra via. */
    abrir(cerrar: () => void): () => void {
      if (!escuchando) {
        historial.escuchar(alVolver)
        escuchando = true
      }
      const id = siguienteId++
      pila.push({ id, cerrar })
      historial.push()

      return () => {
        const i = pila.findIndex((c) => c.id === id)
        // Si ya no esta, la cerro el gesto de atras y su entrada ya se consumio.
        if (i === -1) return
        pila.splice(i, 1)
        programados++
        historial.back()
      }
    },
    hayAbiertas: () => pila.length > 0,
    profundidad: () => pila.length,
  }
}

const HISTORIAL_DEL_NAVEGADOR: HistorialMinimo = {
  push: () => window.history.pushState({ capa: true }, ''),
  back: () => window.history.back(),
  escuchar: (alVolver) => window.addEventListener('popstate', alVolver),
}

export const CAPAS = crearPilaDeCapas(HISTORIAL_DEL_NAVEGADOR)

/** Registra una capa mientras esté abierta. */
export function useCapa(abierta: boolean, cerrar: () => void): void {
  // En una ref para que la capa no se reabra cada vez que cambia la función.
  const cerrarRef = useRef(cerrar)
  cerrarRef.current = cerrar

  useEffect(() => {
    if (!abierta) return
    return CAPAS.abrir(() => cerrarRef.current())
  }, [abierta])
}
