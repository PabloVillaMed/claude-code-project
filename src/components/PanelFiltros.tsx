import { alternar, contarFiltrosActivos, FILTROS_VACIOS } from '../lib/filtros'
import type { Filtros } from '../lib/filtros'
import { ACCESOS, AMBIENTES, CATEGORIAS, MOMENTOS, MUNICIPIOS, PRESUPUESTOS } from '../lib/etiquetas'
import { useIdioma } from '../i18n/contexto'

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
  const { t } = useIdioma()
  const activos = contarFiltrosActivos(filtros)

  return (
    <aside className="panel" aria-label={t.panel.titulo}>
      <div className="panel__cabecera">
        <h2 className="panel__titulo">{t.panel.titulo}</h2>
        {activos > 0 && (
          <button type="button" className="enlace" onClick={() => onCambio(FILTROS_VACIOS)}>
            {t.panel.limpiar(activos)}
          </button>
        )}
      </div>

      <div className="panel__grupo panel__grupo--sueltas">
        <Opcion
          activo={filtros.soloAbiertos}
          onClick={() => onCambio({ ...filtros, soloAbiertos: !filtros.soloAbiertos })}
        >
          {t.panel.abiertoAhora}
        </Opcion>
        <Opcion
          activo={filtros.soloFavoritos}
          onClick={() => onCambio({ ...filtros, soloFavoritos: !filtros.soloFavoritos })}
        >
          {t.panel.favoritos} {totalFavoritos > 0 && <b>{totalFavoritos}</b>}
        </Opcion>
      </div>

      <fieldset className="panel__grupo">
        <legend>{t.panel.quePlan}</legend>
        <div className="opciones">
          {CATEGORIAS.map((c) => (
            <Opcion
              key={c}
              activo={filtros.categorias.includes(c)}
              onClick={() => onCambio({ ...filtros, categorias: alternar(filtros.categorias, c) })}
            >
              {t.categorias[c]}
            </Opcion>
          ))}
        </div>
      </fieldset>

      <fieldset className="panel__grupo">
        <legend>{t.panel.cuantoGastar}</legend>
        <div className="opciones">
          {PRESUPUESTOS.map((p) => (
            <Opcion
              key={p}
              activo={filtros.presupuestos.includes(p)}
              onClick={() => onCambio({ ...filtros, presupuestos: alternar(filtros.presupuestos, p) })}
            >
              {t.presupuestos[p]}
            </Opcion>
          ))}
        </div>
      </fieldset>

      <fieldset className="panel__grupo">
        <legend>{t.panel.acceso}</legend>
        <div className="opciones">
          {ACCESOS.map((clave) => (
            <Opcion
              key={clave}
              activo={filtros.accesos.includes(clave)}
              onClick={() => onCambio({ ...filtros, accesos: alternar(filtros.accesos, clave) })}
              titulo={t.panel.accesoAyuda}
            >
              {t.accesos[clave].largo}
            </Opcion>
          ))}
        </div>
      </fieldset>

      <fieldset className="panel__grupo">
        <legend>{t.panel.tolerancia}</legend>
        <div className="opciones">
          <Opcion
            activo={filtros.tolerancia === 'solo'}
            onClick={() =>
              onCambio({ ...filtros, tolerancia: filtros.tolerancia === 'solo' ? 'todos' : 'solo' })
            }
          >
            {t.panel.soloTolerancia}
          </Opcion>
          <Opcion
            activo={filtros.tolerancia === 'sin'}
            onClick={() =>
              onCambio({ ...filtros, tolerancia: filtros.tolerancia === 'sin' ? 'todos' : 'sin' })
            }
          >
            {t.panel.sinTolerancia}
          </Opcion>
        </div>
        <p className="panel__nota">{t.panel.toleranciaAyuda}</p>
      </fieldset>

      <fieldset className="panel__grupo">
        <legend>{t.panel.tuPuntuacion}</legend>
        <div className="opciones">
          {[3, 4, 5].map((n) => (
            <Opcion
              key={n}
              activo={filtros.minEstrellas === n}
              onClick={() => onCambio({ ...filtros, minEstrellas: filtros.minEstrellas === n ? 0 : n })}
            >
              {n === 5 ? t.panel.soloCinco : t.panel.minEstrellas(n)}
            </Opcion>
          ))}
        </div>
        <p className="panel__nota">
          {totalPuntuados > 0 ? t.panel.puntuados(totalPuntuados) : t.panel.sinPuntuar}
        </p>
      </fieldset>

      <fieldset className="panel__grupo">
        <legend>{t.panel.municipio}</legend>
        <div className="opciones">
          {MUNICIPIOS.map((m) => (
            <Opcion
              key={m}
              activo={filtros.municipios.includes(m)}
              onClick={() => onCambio({ ...filtros, municipios: alternar(filtros.municipios, m) })}
            >
              {t.municipios[m]}
            </Opcion>
          ))}
        </div>
      </fieldset>

      <fieldset className="panel__grupo">
        <legend>{t.panel.momento}</legend>
        <div className="opciones">
          {MOMENTOS.map((m) => (
            <Opcion
              key={m}
              activo={filtros.momentos.includes(m)}
              onClick={() => onCambio({ ...filtros, momentos: alternar(filtros.momentos, m) })}
            >
              {t.momentos[m]}
            </Opcion>
          ))}
        </div>
      </fieldset>

      <fieldset className="panel__grupo">
        <legend>{t.panel.ambiente}</legend>
        <div className="opciones">
          {AMBIENTES.map((a) => (
            <Opcion
              key={a}
              activo={filtros.ambientes.includes(a)}
              onClick={() => onCambio({ ...filtros, ambientes: alternar(filtros.ambientes, a) })}
            >
              {t.ambientes[a]}
            </Opcion>
          ))}
        </div>
      </fieldset>
    </aside>
  )
}
