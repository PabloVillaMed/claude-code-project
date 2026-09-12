import type { Parche } from '../types'
import { estaAbierto } from '../lib/horarios'
import { ACCESOS, familiaDe } from '../lib/etiquetas'
import { useIdioma } from '../i18n/contexto'
import { Carrusel } from './Carrusel'
import { Estrellas } from './Estrellas'

interface TarjetaParcheProps {
  parche: Parche
  esFavorito: boolean
  puntuacion: number
  onFavorito: (id: string) => void
  onAbrirDetalle: (parche: Parche) => void
  ahora: Date
}

export function TarjetaParche({
  parche,
  esFavorito,
  puntuacion,
  onFavorito,
  onAbrirDetalle,
  ahora,
}: TarjetaParcheProps) {
  const { t } = useIdioma()
  const abierto = estaAbierto(parche, ahora)
  const accesos = ACCESOS.filter((clave) => parche.accesibilidad[clave]).slice(0, 3)

  return (
    <article className={`tarjeta tarjeta--${familiaDe(parche)}`}>
      <div className="tarjeta__cinta" />

      <div className="tarjeta__imagen">
        <Carrusel parche={parche} />
        <span className={abierto ? 'estado estado--abierto' : 'estado'}>
          {abierto ? t.parche.abierto : t.parche.cerrado}
        </span>
        <button
          type="button"
          className={esFavorito ? 'favorito favorito--activo' : 'favorito'}
          onClick={() => onFavorito(parche.id)}
          aria-label={
            esFavorito ? t.parche.quitarFavorito(parche.nombre) : t.parche.guardarFavorito(parche.nombre)
          }
          aria-pressed={esFavorito}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 20.6C6.8 16.4 3.4 13.4 3.4 9.6 3.4 6.9 5.5 5 8 5c1.7 0 3.2 1 4 2.4C12.8 6 14.3 5 16 5c2.5 0 4.6 1.9 4.6 4.6 0 3.8-3.4 6.8-8.6 11z" />
          </svg>
        </button>
      </div>

      <div className="tarjeta__cuerpo">
        <h3 className="tarjeta__titulo">{parche.nombre}</h3>
        <p className="tarjeta__lugar">
          {parche.sector}
          <span className="tarjeta__municipio">{t.municipios[parche.municipio]}</span>
        </p>

        <p className="tarjeta__precio">
          {t.presupuestos[parche.presupuesto]}
          <span className="tarjeta__tipo">{t.categorias[parche.categorias[0]]}</span>
        </p>

        <p className="tarjeta__descripcion">{parche.descripcion}</p>

        {(accesos.length > 0 || parche.toleranciaConsumo) && (
          <ul className="tarjeta__accesos">
            {parche.toleranciaConsumo && <li className="marca-tolerancia">{t.parche.tolerancia}</li>}
            {accesos.map((clave) => (
              <li key={clave}>{t.accesos[clave].corto}</li>
            ))}
          </ul>
        )}

        <div className="tarjeta__pie">
          {/* Sin puntuar no se dibujan cinco estrellas vacias en cada tarjeta:
              solo aparecen donde dicen algo. */}
          {puntuacion > 0 && <Estrellas valor={puntuacion} nombreParche={parche.nombre} />}
          <button type="button" className="boton boton--linea" onClick={() => onAbrirDetalle(parche)}>
            {t.parche.verDetalles}
          </button>
        </div>
      </div>
    </article>
  )
}
