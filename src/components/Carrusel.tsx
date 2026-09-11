import { useEffect, useRef, useState } from 'react'
import type { Parche } from '../types'
import { fotosDe } from '../data/fotos'
import { Ladera } from './Ladera'
import { familiaDe } from '../lib/etiquetas'
import { useIdioma } from '../i18n/contexto'

/** Paleta de las fachadas generadas, segun el tipo de plan. */
const PALETAS: Record<string, string[]> = {
  verde: ['#0B6E3F', '#148950', '#F0B310', '#0A5FA8', '#E0561C'],
  azul: ['#0A5FA8', '#1478C9', '#F0B310', '#C8226A', '#0B6E3F'],
  amarillo: ['#F0B310', '#E0561C', '#0B6E3F', '#0A5FA8', '#C8226A'],
  rosa: ['#C8226A', '#E0561C', '#F0B310', '#0A5FA8', '#0B6E3F'],
  naranja: ['#E0561C', '#F0B310', '#C8226A', '#0B6E3F', '#0A5FA8'],
}

interface CarruselProps {
  parche: Parche
  /** Con una sola foto no hay flechas ni puntos: no habria a donde ir. */
  interactivo?: boolean
}

/**
 * Las fotos del parche. Con varias se puede pasar de una a otra; sin ninguna
 * se dibuja una fachada generada a partir del id, nunca la foto de otro sitio.
 */
export function Carrusel({ parche, interactivo = true }: CarruselProps) {
  const { t } = useIdioma()
  const [indice, setIndice] = useState(0)
  const [rotas, setRotas] = useState<Set<string>>(() => new Set())
  const pista = useRef<HTMLDivElement>(null)

  const fotos = fotosDe(parche.id).filter((f) => !rotas.has(f.archivo))

  // Al cambiar de parche (el modal reutiliza el componente) se vuelve a la primera.
  useEffect(() => setIndice(0), [parche.id])

  if (fotos.length === 0) {
    return (
      <div className="marco-foto">
        <div className="imagen-parche imagen-parche--fachada">
          <Ladera
            clave={parche.id}
            ancho={320}
            alto={180}
            paso={30}
            minAlto={0.3}
            paleta={PALETAS[familiaDe(parche)]}
            className="fachada-svg"
          />
        </div>
      </div>
    )
  }

  const varias = interactivo && fotos.length > 1
  const actual = Math.min(indice, fotos.length - 1)

  function mover(paso: number) {
    const siguiente = (actual + paso + fotos.length) % fotos.length
    setIndice(siguiente)
    // La pista se desplaza sola: el scroll es la fuente de verdad de la posicion.
    pista.current?.scrollTo({ left: pista.current.clientWidth * siguiente, behavior: 'smooth' })
  }

  function irA(n: number) {
    setIndice(n)
    pista.current?.scrollTo({ left: pista.current.clientWidth * n, behavior: 'smooth' })
  }

  return (
    <div className="marco-foto">
      <div
        className="carrusel__pista"
        ref={pista}
        onScroll={(e) => {
          const caja = e.currentTarget
          const visible = Math.round(caja.scrollLeft / caja.clientWidth)
          if (visible !== actual) setIndice(visible)
        }}
      >
        {fotos.map((foto, i) => (
          <img
            key={foto.archivo}
            className="imagen-parche"
            src={foto.archivo}
            alt={t.parche.fotoDe(parche.nombre, parche.sector)}
            loading={i === 0 ? 'eager' : 'lazy'}
            width={640}
            height={360}
            onError={() => setRotas((previas) => new Set(previas).add(foto.archivo))}
          />
        ))}
      </div>

      {varias && (
        <>
          <button
            type="button"
            className="carrusel__flecha carrusel__flecha--atras"
            onClick={() => mover(-1)}
            aria-label={t.parche.fotoAnterior}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <button
            type="button"
            className="carrusel__flecha carrusel__flecha--adelante"
            onClick={() => mover(1)}
            aria-label={t.parche.fotoSiguiente}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <div className="carrusel__puntos">
            {fotos.map((foto, i) => (
              <button
                key={foto.archivo}
                type="button"
                className={i === actual ? 'carrusel__punto carrusel__punto--activo' : 'carrusel__punto'}
                onClick={() => irA(i)}
                aria-label={t.parche.irAFoto(i + 1, fotos.length)}
                aria-current={i === actual}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
