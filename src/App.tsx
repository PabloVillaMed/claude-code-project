import { useCallback, useMemo, useState } from 'react'
import { PARCHES } from './data/parches'
import type { Parche } from './types'
import { filtrarParches, FILTROS_VACIOS, parcheAlAzar } from './lib/filtros'
import type { Filtros } from './lib/filtros'
import { ordenarParches, ORDENES } from './lib/orden'
import type { Orden } from './lib/orden'
import { guardarFavoritos, leerFavoritos } from './lib/favoritos'
import { aplicarPuntuacion, guardarPuntuaciones, leerPuntuaciones } from './lib/puntuaciones'
import type { Puntuaciones } from './lib/puntuaciones'
import { PanelFiltros } from './components/PanelFiltros'
import { TarjetaParche } from './components/TarjetaParche'
import { DetalleParche } from './components/DetalleParche'
import { Ladera } from './components/Ladera'

const PALETA_CABECERA = ['#0B6E3F', '#F0B310', '#0A5FA8', '#C8226A', '#E0561C']

export default function App() {
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS)
  const [orden, setOrden] = useState<Orden>('sugeridos')
  const [favoritos, setFavoritos] = useState<Set<string>>(() => leerFavoritos())
  const [puntuaciones, setPuntuaciones] = useState<Puntuaciones>(() => leerPuntuaciones())
  const [detalle, setDetalle] = useState<Parche | null>(null)
  const [panelAbierto, setPanelAbierto] = useState(false)

  // Se fija al montar para que "abierto ahora" no cambie a mitad de un render.
  const [ahora] = useState(() => new Date())

  const resultados = useMemo(() => {
    const filtrados = filtrarParches(PARCHES, filtros, { favoritos, ahora, puntuaciones })
    return ordenarParches(filtrados, orden, puntuaciones)
  }, [filtros, favoritos, ahora, puntuaciones, orden])

  const alternarFavorito = useCallback((id: string) => {
    setFavoritos((previos) => {
      const siguiente = new Set(previos)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      guardarFavoritos(siguiente)
      return siguiente
    })
  }, [])

  const puntuar = useCallback((id: string, estrellas: number) => {
    setPuntuaciones((previas) => {
      const siguiente = aplicarPuntuacion(previas, id, estrellas)
      guardarPuntuaciones(siguiente)
      return siguiente
    })
  }, [])

  function sorprendeme() {
    const elegido = parcheAlAzar(resultados)
    if (elegido) setDetalle(elegido)
  }

  const totalPuntuados = Object.keys(puntuaciones).length

  return (
    <div className="app">
      <header className="cabecera">
        <div className="cabecera__interior">
          <p className="cabecera__sobre">Valle de Aburrá y alrededores</p>
          <h1 className="logotipo">
            Parches<span>Medellín</span>
          </h1>
          <p className="cabecera__bajada">
            Dónde encontrarse, comer, caminar y bailar. Filtrado por lo que cuesta, por cómo se llega y por
            quién puede entrar.
          </p>

          <div className="buscador">
            <input
              type="search"
              className="buscador__campo"
              placeholder="Café, mirador, Sabaneta, gratis…"
              value={filtros.busqueda}
              onChange={(e) => setFiltros({ ...filtros, busqueda: e.target.value })}
              aria-label="Buscar parches"
            />
            <button type="button" className="boton boton--claro" onClick={sorprendeme} disabled={resultados.length === 0}>
              Sorpréndeme
            </button>
            <button
              type="button"
              className="boton boton--fantasma boton--panel"
              onClick={() => setPanelAbierto((v) => !v)}
              aria-expanded={panelAbierto}
            >
              {panelAbierto ? 'Ocultar filtros' : 'Filtros'}
            </button>
          </div>
        </div>

        <Ladera
          clave="cabecera-parches-medellin"
          ancho={1200}
          alto={78}
          paso={30}
          minAlto={0.22}
          paleta={PALETA_CABECERA}
          className="cabecera__ladera"
        />
      </header>

      <main className="contenido">
        <div className={panelAbierto ? 'panel__envoltura panel__envoltura--abierta' : 'panel__envoltura'}>
          <PanelFiltros
            filtros={filtros}
            onCambio={setFiltros}
            totalFavoritos={favoritos.size}
            totalPuntuados={totalPuntuados}
          />
        </div>

        <section className="resultados" aria-live="polite">
          <div className="resultados__barra">
            <p className="resultados__conteo">
              <b>{resultados.length}</b> de {PARCHES.length} {PARCHES.length === 1 ? 'parche' : 'parches'}
            </p>
            <label className="ordenar">
              Ordenar por
              <select value={orden} onChange={(e) => setOrden(e.target.value as Orden)}>
                {ORDENES.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.texto}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {resultados.length === 0 ? (
            <div className="vacio">
              <p className="vacio__titulo">Ningún parche cumple con eso.</p>
              <p>Suelta algún filtro y vuelve a mirar: el valle es grande.</p>
              <button type="button" className="boton" onClick={() => setFiltros(FILTROS_VACIOS)}>
                Limpiar filtros
              </button>
            </div>
          ) : (
            <div className="grilla">
              {resultados.map((parche) => (
                <TarjetaParche
                  key={parche.id}
                  parche={parche}
                  esFavorito={favoritos.has(parche.id)}
                  puntuacion={puntuaciones[parche.id] ?? 0}
                  onFavorito={alternarFavorito}
                  onAbrirDetalle={setDetalle}
                  ahora={ahora}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="pie">
        <p>
          Catálogo semilla de espacios públicos y sectores del Valle de Aburrá y el Oriente cercano. Horarios y
          precios son referenciales: confirma antes de salir.
        </p>
        <p>
          Fotografías de Wikimedia Commons, con licencia libre y crédito en el detalle de cada parche. Los
          lugares sin fotografía verificable llevan una fachada dibujada, no la foto de otro sitio.
        </p>
      </footer>

      {detalle && (
        <DetalleParche
          parche={detalle}
          esFavorito={favoritos.has(detalle.id)}
          puntuacion={puntuaciones[detalle.id] ?? 0}
          onFavorito={alternarFavorito}
          onPuntuar={puntuar}
          onCerrar={() => setDetalle(null)}
          ahora={ahora}
        />
      )}
    </div>
  )
}
