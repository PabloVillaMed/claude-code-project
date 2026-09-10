import { useEffect, useRef } from 'react'
import type { Parche } from '../types'
import { estaAbierto, resumirHorarios } from '../lib/horarios'
import {
  ACCESOS,
  enlaceMapa,
  familiaDe,
  TEXTO_AMBIENTE,
  TEXTO_CATEGORIA,
  TEXTO_MUNICIPIO,
  TEXTO_PRESUPUESTO,
} from '../lib/etiquetas'
import { FOTOS } from '../data/fotos'
import { ImagenParche } from './ImagenParche'
import { Estrellas } from './Estrellas'

interface DetalleParcheProps {
  parche: Parche
  esFavorito: boolean
  puntuacion: number
  onFavorito: (id: string) => void
  onPuntuar: (id: string, estrellas: number) => void
  onCerrar: () => void
  ahora: Date
}

export function DetalleParche({
  parche,
  esFavorito,
  puntuacion,
  onFavorito,
  onPuntuar,
  onCerrar,
  ahora,
}: DetalleParcheProps) {
  const dialogo = useRef<HTMLDivElement>(null)

  // Cerrar con Escape y llevar el foco al dialogo al abrirlo.
  useEffect(() => {
    dialogo.current?.focus()
    function alTeclado(evento: KeyboardEvent) {
      if (evento.key === 'Escape') onCerrar()
    }
    document.addEventListener('keydown', alTeclado)
    return () => document.removeEventListener('keydown', alTeclado)
  }, [onCerrar])

  const abierto = estaAbierto(parche, ahora)
  const credito = FOTOS[parche.id]

  return (
    <div className="modal" onClick={onCerrar} role="presentation">
      <div
        className={`modal__contenido modal__contenido--${familiaDe(parche)}`}
        role="dialog"
        aria-modal="true"
        aria-label={parche.nombre}
        tabIndex={-1}
        ref={dialogo}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__imagen">
          <ImagenParche parche={parche} />
          <button type="button" className="modal__cerrar" onClick={onCerrar} aria-label="Cerrar detalle">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 5l14 14M19 5L5 19" />
            </svg>
          </button>
        </div>

        <div className="modal__cuerpo">
          <h2 className="modal__titulo">{parche.nombre}</h2>
          <p className="tarjeta__lugar">
            {parche.sector}
            <span className="tarjeta__municipio">{TEXTO_MUNICIPIO[parche.municipio]}</span>
          </p>

          <p className="modal__resumen">
            <span className={abierto ? 'estado estado--abierto estado--fijo' : 'estado estado--fijo'}>
              {abierto ? 'Abierto ahora' : 'Cerrado ahora'}
            </span>
            {TEXTO_PRESUPUESTO[parche.presupuesto]}
            <span className="tarjeta__tipo">
              {parche.categorias.map((c) => TEXTO_CATEGORIA[c]).join(', ')}
            </span>
          </p>

          <p className="modal__descripcion">{parche.descripcion}</p>

          <div className="puntuar">
            <p className="puntuar__titulo">Tu puntuación</p>
            <Estrellas
              valor={puntuacion}
              onPuntuar={(n) => onPuntuar(parche.id, n)}
              nombreParche={parche.nombre}
              tamano="grande"
            />
            <p className="puntuar__nota">
              {puntuacion
                ? 'Se guarda en este teléfono. Toca la misma estrella para quitarla.'
                : 'Guarda tu nota del lugar. Solo se queda en este teléfono.'}
            </p>
          </div>

          <dl className="detalle">
            <dt>Horarios</dt>
            <dd>
              {resumirHorarios(parche.horarios)}
              {parche.notaHorario && <span className="detalle__nota"> {parche.notaHorario}</span>}
            </dd>

            {parche.comoLlegar && (
              <>
                <dt>Cómo llegar</dt>
                <dd>{parche.comoLlegar}</dd>
              </>
            )}

            <dt>Ambiente</dt>
            <dd>{parche.ambiente.map((a) => TEXTO_AMBIENTE[a]).join(', ')}</dd>

            <dt>Acceso</dt>
            <dd>
              <ul className="detalle__acceso">
                {ACCESOS.map((a) => (
                  <li key={a.valor} className={parche.accesibilidad[a.valor] ? 'si' : 'no'}>
                    {a.texto}
                  </li>
                ))}
              </ul>
            </dd>
          </dl>

          <div className="modal__acciones">
            <a
              className="boton"
              href={enlaceMapa(parche.consultaMapa, parche.municipio)}
              target="_blank"
              rel="noreferrer noopener"
            >
              Abrir en Google Maps
            </a>
            {parche.web && (
              <a className="boton boton--linea" href={parche.web} target="_blank" rel="noreferrer noopener">
                Sitio oficial
              </a>
            )}
            <button type="button" className="boton boton--linea" onClick={() => onFavorito(parche.id)}>
              {esFavorito ? 'Quitar de favoritos' : 'Guardar en favoritos'}
            </button>
          </div>

          {credito && (
            <p className="credito">
              Foto de {credito.autor},{' '}
              <a href={credito.licenciaUrl} target="_blank" rel="noreferrer noopener">
                {credito.licencia}
              </a>
              , vía{' '}
              <a href={credito.pagina} target="_blank" rel="noreferrer noopener">
                Wikimedia Commons
              </a>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
