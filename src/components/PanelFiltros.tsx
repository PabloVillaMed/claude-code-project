import { Chip } from './Chip'
import { alternar, contarFiltrosActivos, FILTROS_VACIOS } from '../lib/filtros'
import type { Filtros } from '../lib/filtros'
import { ACCESOS, AMBIENTES, CATEGORIAS, MOMENTOS, MUNICIPIOS, PRESUPUESTOS } from '../lib/etiquetas'

interface PanelFiltrosProps {
  filtros: Filtros
  onCambio: (filtros: Filtros) => void
  totalFavoritos: number
}

export function PanelFiltros({ filtros, onCambio, totalFavoritos }: PanelFiltrosProps) {
  const activos = contarFiltrosActivos(filtros)

  return (
    <aside className="panel" aria-label="Filtros de busqueda">
      <div className="panel__cabecera">
        <h2>Filtros</h2>
        {activos > 0 && (
          <button type="button" className="enlace" onClick={() => onCambio(FILTROS_VACIOS)}>
            Limpiar ({activos})
          </button>
        )}
      </div>

      <div className="panel__grupo">
        <div className="panel__interruptores">
          <Chip
            activo={filtros.soloAbiertos}
            onClick={() => onCambio({ ...filtros, soloAbiertos: !filtros.soloAbiertos })}
          >
            🕒 Abierto ahora
          </Chip>
          <Chip
            activo={filtros.soloFavoritos}
            onClick={() => onCambio({ ...filtros, soloFavoritos: !filtros.soloFavoritos })}
          >
            ⭐ Mis favoritos ({totalFavoritos})
          </Chip>
        </div>
      </div>

      <fieldset className="panel__grupo">
        <legend>Que plan buscas</legend>
        <div className="chips">
          {CATEGORIAS.map((c) => (
            <Chip
              key={c.valor}
              activo={filtros.categorias.includes(c.valor)}
              onClick={() => onCambio({ ...filtros, categorias: alternar(filtros.categorias, c.valor) })}
            >
              {c.emoji} {c.texto}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="panel__grupo">
        <legend>Presupuesto</legend>
        <div className="chips">
          {PRESUPUESTOS.map((p) => (
            <Chip
              key={p.valor}
              activo={filtros.presupuestos.includes(p.valor)}
              onClick={() => onCambio({ ...filtros, presupuestos: alternar(filtros.presupuestos, p.valor) })}
            >
              {p.texto}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="panel__grupo">
        <legend>Acceso para todos</legend>
        <div className="chips">
          {ACCESOS.map((a) => (
            <Chip
              key={a.valor}
              activo={filtros.accesos.includes(a.valor)}
              onClick={() => onCambio({ ...filtros, accesos: alternar(filtros.accesos, a.valor) })}
              titulo="Se exigen todos los criterios de acceso que marques"
            >
              {a.emoji} {a.texto}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="panel__grupo">
        <legend>Municipio</legend>
        <div className="chips">
          {MUNICIPIOS.map((m) => (
            <Chip
              key={m}
              activo={filtros.municipios.includes(m)}
              onClick={() => onCambio({ ...filtros, municipios: alternar(filtros.municipios, m) })}
            >
              {m}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="panel__grupo">
        <legend>Momento del dia</legend>
        <div className="chips">
          {MOMENTOS.map((m) => (
            <Chip
              key={m.valor}
              activo={filtros.momentos.includes(m.valor)}
              onClick={() => onCambio({ ...filtros, momentos: alternar(filtros.momentos, m.valor) })}
            >
              {m.emoji} {m.texto}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="panel__grupo">
        <legend>Ambiente</legend>
        <div className="chips">
          {AMBIENTES.map((a) => (
            <Chip
              key={a}
              activo={filtros.ambientes.includes(a)}
              onClick={() => onCambio({ ...filtros, ambientes: alternar(filtros.ambientes, a) })}
            >
              {a}
            </Chip>
          ))}
        </div>
      </fieldset>
    </aside>
  )
}
