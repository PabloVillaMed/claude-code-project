import { alternar, contarFiltrosActivos, FILTROS_VACIOS } from '../lib/filtros'
import type { Filtros } from '../lib/filtros'
import {
  ACCESOS,
  AMBIENTES,
  CATEGORIAS,
  MOMENTOS,
  MUNICIPIOS,
  PRESUPUESTOS,
  TEXTO_AMBIENTE,
  TEXTO_MUNICIPIO,
} from '../lib/etiquetas'

interface PanelFiltrosProps {
  filtros: Filtros
  onCambio: (filtros: Filtros) => void
  totalFavoritos: number
  totalPuntuados: number
}

interface OpcionProps {
  activo: boolean
  onClick: () => void
  children: React.ReactNode
  titulo?: string
}

function Opcion({ activo, onClick, children, titulo }: OpcionProps) {
  return (
    <button
      type="button"
      className={activo ? 'opcion opcion--activa' : 'opcion'}
      onClick={onClick}
      aria-pressed={activo}
      title={titulo}
    >
      {children}
    </button>
  )
}

export function PanelFiltros({ filtros, onCambio, totalFavoritos, totalPuntuados }: PanelFiltrosProps) {
  const activos = contarFiltrosActivos(filtros)

  return (
    <aside className="panel" aria-label="Filtros de búsqueda">
      <div className="panel__cabecera">
        <h2 className="panel__titulo">Filtros</h2>
        {activos > 0 && (
          <button type="button" className="enlace" onClick={() => onCambio(FILTROS_VACIOS)}>
            Limpiar {activos}
          </button>
        )}
      </div>

      <div className="panel__grupo panel__grupo--sueltas">
        <Opcion
          activo={filtros.soloAbiertos}
          onClick={() => onCambio({ ...filtros, soloAbiertos: !filtros.soloAbiertos })}
        >
          Abierto ahora
        </Opcion>
        <Opcion
          activo={filtros.soloFavoritos}
          onClick={() => onCambio({ ...filtros, soloFavoritos: !filtros.soloFavoritos })}
        >
          Favoritos {totalFavoritos > 0 && <b>{totalFavoritos}</b>}
        </Opcion>
      </div>

      <fieldset className="panel__grupo">
        <legend>Qué plan buscas</legend>
        <div className="opciones">
          {CATEGORIAS.map((c) => (
            <Opcion
              key={c.valor}
              activo={filtros.categorias.includes(c.valor)}
              onClick={() => onCambio({ ...filtros, categorias: alternar(filtros.categorias, c.valor) })}
            >
              {c.texto}
            </Opcion>
          ))}
        </div>
      </fieldset>

      <fieldset className="panel__grupo">
        <legend>Cuánto quieres gastar</legend>
        <div className="opciones">
          {PRESUPUESTOS.map((p) => (
            <Opcion
              key={p.valor}
              activo={filtros.presupuestos.includes(p.valor)}
              onClick={() => onCambio({ ...filtros, presupuestos: alternar(filtros.presupuestos, p.valor) })}
            >
              {p.texto}
            </Opcion>
          ))}
        </div>
      </fieldset>

      <fieldset className="panel__grupo">
        <legend>Que el plan alcance para todos</legend>
        <div className="opciones">
          {ACCESOS.map((a) => (
            <Opcion
              key={a.valor}
              activo={filtros.accesos.includes(a.valor)}
              onClick={() => onCambio({ ...filtros, accesos: alternar(filtros.accesos, a.valor) })}
              titulo="Se exigen todos los criterios de acceso que marques"
            >
              {a.texto}
            </Opcion>
          ))}
        </div>
      </fieldset>

      <fieldset className="panel__grupo">
        <legend>Tu puntuación</legend>
        <div className="opciones">
          {[3, 4, 5].map((n) => (
            <Opcion
              key={n}
              activo={filtros.minEstrellas === n}
              onClick={() => onCambio({ ...filtros, minEstrellas: filtros.minEstrellas === n ? 0 : n })}
            >
              {n === 5 ? 'Solo 5 estrellas' : `${n} estrellas o más`}
            </Opcion>
          ))}
        </div>
        <p className="panel__nota">
          {totalPuntuados > 0
            ? `Llevas ${totalPuntuados} ${totalPuntuados === 1 ? 'parche puntuado' : 'parches puntuados'}.`
            : 'Todavía no has puntuado ningún parche.'}
        </p>
      </fieldset>

      <fieldset className="panel__grupo">
        <legend>Municipio</legend>
        <div className="opciones">
          {MUNICIPIOS.map((m) => (
            <Opcion
              key={m}
              activo={filtros.municipios.includes(m)}
              onClick={() => onCambio({ ...filtros, municipios: alternar(filtros.municipios, m) })}
            >
              {TEXTO_MUNICIPIO[m]}
            </Opcion>
          ))}
        </div>
      </fieldset>

      <fieldset className="panel__grupo">
        <legend>Momento del día</legend>
        <div className="opciones">
          {MOMENTOS.map((m) => (
            <Opcion
              key={m.valor}
              activo={filtros.momentos.includes(m.valor)}
              onClick={() => onCambio({ ...filtros, momentos: alternar(filtros.momentos, m.valor) })}
            >
              {m.texto}
            </Opcion>
          ))}
        </div>
      </fieldset>

      <fieldset className="panel__grupo">
        <legend>Ambiente</legend>
        <div className="opciones">
          {AMBIENTES.map((a) => (
            <Opcion
              key={a}
              activo={filtros.ambientes.includes(a)}
              onClick={() => onCambio({ ...filtros, ambientes: alternar(filtros.ambientes, a) })}
            >
              {TEXTO_AMBIENTE[a]}
            </Opcion>
          ))}
        </div>
      </fieldset>
    </aside>
  )
}
