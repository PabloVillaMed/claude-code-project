import type { Parche } from '../types'
import { estaAbierto } from '../lib/horarios'
import { ACCESOS, CATEGORIAS, TEXTO_PRESUPUESTO } from '../lib/etiquetas'

interface TarjetaParcheProps {
  parche: Parche
  esFavorito: boolean
  onFavorito: (id: string) => void
  onAbrirDetalle: (parche: Parche) => void
  ahora: Date
}

export function TarjetaParche({ parche, esFavorito, onFavorito, onAbrirDetalle, ahora }: TarjetaParcheProps) {
  const abierto = estaAbierto(parche, ahora)
  const iconosAcceso = ACCESOS.filter((a) => parche.accesibilidad[a.valor])

  return (
    <article className="tarjeta">
      <header className="tarjeta__cabecera">
        <div>
          <h3 className="tarjeta__titulo">{parche.nombre}</h3>
          <p className="tarjeta__ubicacion">
            {parche.sector} · {parche.municipio}
          </p>
        </div>
        <button
          type="button"
          className={esFavorito ? 'favorito favorito--activo' : 'favorito'}
          onClick={() => onFavorito(parche.id)}
          aria-label={esFavorito ? `Quitar ${parche.nombre} de favoritos` : `Guardar ${parche.nombre} en favoritos`}
          aria-pressed={esFavorito}
        >
          {esFavorito ? '★' : '☆'}
        </button>
      </header>

      <p className="tarjeta__descripcion">{parche.descripcion}</p>

      <ul className="tarjeta__etiquetas">
        <li className={abierto ? 'etiqueta etiqueta--abierto' : 'etiqueta etiqueta--cerrado'}>
          {abierto ? 'Abierto ahora' : 'Cerrado ahora'}
        </li>
        <li className="etiqueta etiqueta--precio">{TEXTO_PRESUPUESTO[parche.presupuesto]}</li>
        {parche.categorias.map((c) => {
          const meta = CATEGORIAS.find((x) => x.valor === c)
          return (
            <li key={c} className="etiqueta">
              {meta ? `${meta.emoji} ${meta.texto}` : c}
            </li>
          )
        })}
      </ul>

      <footer className="tarjeta__pie">
        <div className="tarjeta__accesos" aria-label="Condiciones de acceso">
          {iconosAcceso.map((a) => (
            <span key={a.valor} title={a.texto} aria-label={a.texto}>
              {a.emoji}
            </span>
          ))}
        </div>
        <button type="button" className="boton boton--secundario" onClick={() => onAbrirDetalle(parche)}>
          Ver detalles
        </button>
      </footer>
    </article>
  )
}
