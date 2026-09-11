import { useEffect, useRef } from 'react'
import type { Parche } from '../types'
import { estaAbierto, resumirHorarios } from '../lib/horarios'
import { ACCESOS, enlaceMapa, familiaDe } from '../lib/etiquetas'
import { fotosDe } from '../data/fotos'
import { useIdioma } from '../i18n/contexto'
import { Carrusel } from './Carrusel'
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
  const { t } = useIdioma()
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
  const creditos = fotosDe(parche.id)

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
          <Carrusel parche={parche} />
          <button
            type="button"
            className="modal__cerrar"
            onClick={onCerrar}
            aria-label={t.parche.cerrarDetalle}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 5l14 14M19 5L5 19" />
            </svg>
          </button>
        </div>

        <div className="modal__cuerpo">
          <h2 className="modal__titulo">{parche.nombre}</h2>
          <p className="tarjeta__lugar">
            {parche.sector}
            <span className="tarjeta__municipio">{t.municipios[parche.municipio]}</span>
          </p>

          <p className="modal__resumen">
            <span className={abierto ? 'estado estado--abierto estado--fijo' : 'estado estado--fijo'}>
              {abierto ? t.parche.abierto : t.parche.cerrado}
            </span>
            {t.presupuestos[parche.presupuesto]}
            <span className="tarjeta__tipo">
              {parche.categorias.map((c) => t.categorias[c]).join(', ')}
            </span>
          </p>

          <p className="modal__descripcion">{parche.descripcion}</p>

          <div className="puntuar">
            <p className="puntuar__titulo">{t.parche.tuPuntuacion}</p>
            <Estrellas
              valor={puntuacion}
              onPuntuar={(n) => onPuntuar(parche.id, n)}
              nombreParche={parche.nombre}
              tamano="grande"
            />
            <p className="puntuar__nota">
              {puntuacion ? t.parche.notaPuntuada : t.parche.notaSinPuntuar}
            </p>
          </div>

          <dl className="detalle">
            <dt>{t.parche.horarios}</dt>
            <dd>
              {resumirHorarios(parche.horarios, t.horario)}
              {parche.notaHorario && <span className="detalle__nota"> {parche.notaHorario}</span>}
            </dd>

            {parche.comoLlegar && (
              <>
                <dt>{t.parche.comoLlegar}</dt>
                <dd>{parche.comoLlegar}</dd>
              </>
            )}

            <dt>{t.parche.ambiente}</dt>
            <dd>{parche.ambiente.map((a) => t.ambientes[a]).join(', ')}</dd>

            <dt>{t.parche.accesoTitulo}</dt>
            <dd>
              <ul className="detalle__acceso">
                {ACCESOS.map((clave) => (
                  <li key={clave} className={parche.accesibilidad[clave] ? 'si' : 'no'}>
                    {t.accesos[clave].largo}
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
              {t.parche.abrirMapa}
            </a>
            {parche.web && (
              <a className="boton boton--linea" href={parche.web} target="_blank" rel="noreferrer noopener">
                {t.parche.sitioOficial}
              </a>
            )}
            <button type="button" className="boton boton--linea" onClick={() => onFavorito(parche.id)}>
              {esFavorito ? t.parche.quitarDeFavoritos : t.parche.guardarEnFavoritos}
            </button>
          </div>

          {creditos.length > 0 && (
            <ul className="credito">
              {creditos.map((foto) => (
                <li key={foto.archivo}>
                  {t.parche.credito(foto.autor)},{' '}
                  <a href={foto.licenciaUrl} target="_blank" rel="noreferrer noopener">
                    {foto.licencia}
                  </a>
                  ,{' '}
                  <a href={foto.pagina} target="_blank" rel="noreferrer noopener">
                    {t.parche.creditoVia}
                  </a>
                  .
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
