import { useIdioma } from '../i18n/contexto'

interface EstrellasProps {
  valor: number
  /** Sin esta funcion las estrellas solo se muestran, no se pueden tocar. */
  onPuntuar?: (estrellas: number) => void
  nombreParche: string
  tamano?: 'normal' | 'grande'
}

// Estrella de cinco puntas dibujada a mano alzada: las puntas no son iguales,
// para que no se lea como el icono por defecto de cualquier libreria.
const ESTRELLA = 'M12 2.4 15 9l7.2.6-5.5 4.7 1.8 7-6.5-3.9-6.4 4.1 1.6-7.1L2 9.8 9.2 9z'

export function Estrellas({ valor, onPuntuar, nombreParche, tamano = 'normal' }: EstrellasProps) {
  const { t } = useIdioma()
  const interactivo = Boolean(onPuntuar)
  const clase = `estrellas estrellas--${tamano}${interactivo ? ' estrellas--interactivo' : ''}`

  if (!interactivo) {
    return (
      <div
        className={clase}
        role="img"
        aria-label={valor ? t.parche.puntuacionActual(valor) : t.parche.sinPuntuacion}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <svg key={n} viewBox="0 0 24 24" className={n <= valor ? 'estrella estrella--llena' : 'estrella'}>
            <path d={ESTRELLA} />
          </svg>
        ))}
      </div>
    )
  }

  return (
    <div className={clase}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={n <= valor ? 'estrella-boton estrella-boton--llena' : 'estrella-boton'}
          onClick={() => onPuntuar?.(n)}
          aria-label={valor === n ? t.parche.quitarPuntuacion(nombreParche) : t.parche.puntuarCon(nombreParche, n)}
          aria-pressed={n <= valor}
        >
          <svg viewBox="0 0 24 24" className="estrella">
            <path d={ESTRELLA} />
          </svg>
        </button>
      ))}
    </div>
  )
}
