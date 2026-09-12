import { useEffect } from 'react'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { CAPAS } from './capas'

/**
 * Conecta el boton y el gesto de atras de Android con la pila de capas.
 *
 * Hace falta hacerlo a mano: sin un oyente en JS, el plugin de Capacitor se
 * come el evento y atras se queda sin efecto; y sin el plugin, Android cierra
 * la actividad, que es lo que hacia que el gesto sacara de la app aunque
 * hubiera un detalle abierto.
 */
export function useBotonAtras(): void {
  useEffect(() => {
    let quitar: (() => void) | undefined
    let vivo = true

    App.addListener('backButton', () => {
      if (CAPAS.hayAbiertas()) {
        // Retroceder en el historial cierra la capa de arriba.
        window.history.back()
      } else if (Capacitor.isNativePlatform()) {
        // Ya no queda nada encima: atras sale de la app, como se espera.
        App.exitApp()
      }
    }).then((oyente) => {
      if (vivo) quitar = () => oyente.remove()
      else oyente.remove()
    })

    return () => {
      vivo = false
      quitar?.()
    }
  }, [])
}
