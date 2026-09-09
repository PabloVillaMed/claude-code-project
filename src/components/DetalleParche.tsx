import { useEffect, useRef } from 'react'
import type { Parche } from '../types'
import { estaAbierto, resumirHorarios } from '../lib/horarios'
import { ACCESOS, AMBIENTES, CATEGORIAS, enlaceMapa, TEXTO_PRESUPUESTO } from '../lib/etiquetas'

interface DetalleParcheProps {
  parche: Parche
  esFavorito: boolean
  onFavorito: (id: string) => void
  onCerrar: () => void
  ahora: Date
}

export function DetalleParche({ parche, esFavorito, onFavorito, onCerrar, ahora }: DetalleParcheProps) {
  const dialogo = useRef<HTMLDivElement>(null)

  // Cerrar con Escape y devolver el foco al contenido del modal al abrirlo.
  useEffect(() => {
    dialogo.current?.focus()
    function alTeclado(evento: KeyboardEvent) {
      if (evento.key === 'Escape') onCerrar()
    }
    document.addEventListener('keydown', alTeclado)
    return () => document.removeEventListener('keydown', alTeclado)
  }, [onCerrar])

  const abierto = estaAbierto(parche, ahora)

  return (
    <div className="modal" onClick={onCerrar} role="presentation">
      <div
        className="modal__contenido"
        role="dialog"
        aria-modal="true"
        aria-label={parche.nombre}
        tabIndex={-1}
        ref={dialogo}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="modal__cerrar" onClick={onCerrar} aria-label="Cerrar detalle">
          ✕
        </button>

        <h2>{parche.nombre}</h2>
        <p className="tarjeta__ubicacion">
          {parche.sector} · {parche.municipio}
        </p>

        <ul className="tarjeta__etiquetas">
          <li className={abierto ? 'etiqueta etiqueta--abierto' : 'etiqueta etiqueta--cerrado'}>
            {abierto ? 'Abierto ahora' : 'Cerrado ahora'}
          </li>
          <li className="etiqueta etiqueta--precio">{TEXTO_PRESUPUESTO[parche.presupuesto]}</li>
          {parche.categorias.map((c) => (
            <li key={c} className="etiqueta">
              {CATEGORIAS.find((x) => x.valor === c)?.texto ?? c}
            </li>
          ))}
        </ul>

        <p>{parche.descripcion}</p>

        <dl className="detalle">
          <dt>Horarios</dt>
          <dd>
            {resumirHorarios(parche.horarios)}
            {parche.notaHorario && <span className="detalle__nota"> {parche.notaHorario}</span>}
          </dd>

          {parche.comoLlegar && (
            <>
              <dt>Como llegar</dt>
              <dd>{parche.comoLlegar}</dd>
            </>
          )}

          <dt>Ambiente</dt>
          <dd>{parche.ambiente.filter((a) => AMBIENTES.includes(a)).join(' · ')}</dd>

          <dt>Acceso</dt>
          <dd>
            <ul className="detalle__acceso">
              {ACCESOS.map((a) => (
                <li key={a.valor} className={parche.accesibilidad[a.valor] ? 'si' : 'no'}>
                  {parche.accesibilidad[a.valor] ? '✅' : '⬜'} {a.texto}
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
            <a className="boton boton--secundario" href={parche.web} target="_blank" rel="noreferrer noopener">
              Sitio oficial
            </a>
          )}
          <button type="button" className="boton boton--secundario" onClick={() => onFavorito(parche.id)}>
            {esFavorito ? '★ Quitar de favoritos' : '☆ Guardar en favoritos'}
          </button>
        </div>
      </div>
    </div>
  )
}
