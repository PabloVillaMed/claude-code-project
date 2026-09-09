import { useCallback, useMemo, useState } from 'react'
import { PARCHES } from './data/parches'
import type { Parche } from './types'
import { filtrarParches, FILTROS_VACIOS, parcheAlAzar } from './lib/filtros'
import type { Filtros } from './lib/filtros'
import { guardarFavoritos, leerFavoritos } from './lib/favoritos'
import { PanelFiltros } from './components/PanelFiltros'
import { TarjetaParche } from './components/TarjetaParche'
import { DetalleParche } from './components/DetalleParche'

export default function App() {
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS)
  const [favoritos, setFavoritos] = useState<Set<string>>(() => leerFavoritos())
  const [detalle, setDetalle] = useState<Parche | null>(null)
  const [panelAbierto, setPanelAbierto] = useState(false)

  // Se fija al montar para que "abierto ahora" no cambie a mitad de un render.
  const [ahora] = useState(() => new Date())

  const resultados = useMemo(
    () => filtrarParches(PARCHES, filtros, { favoritos, ahora }),
    [filtros, favoritos, ahora],
  )

  const alternarFavorito = useCallback((id: string) => {
    setFavoritos((previos) => {
      const siguiente = new Set(previos)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      guardarFavoritos(siguiente)
      return siguiente
    })
  }, [])

  function sorprendeme() {
    const elegido = parcheAlAzar(resultados)
    if (elegido) setDetalle(elegido)
  }

  return (
    <div className="app">
      <header className="encabezado">
        <div className="encabezado__marca">
          <h1>Parches Medellin</h1>
          <p>
            Lugares de encuentro, establecimientos y zonas de esparcimiento en Medellin y municipios cercanos.
            Filtrados por presupuesto, transporte y acceso, para que el plan alcance para todo el mundo.
          </p>
        </div>

        <div className="buscador">
          <input
            type="search"
            className="buscador__campo"
            placeholder="Busca un parche: cafe, mirador, Sabaneta, gratis..."
            value={filtros.busqueda}
            onChange={(e) => setFiltros({ ...filtros, busqueda: e.target.value })}
            aria-label="Buscar parches"
          />
          <button type="button" className="boton" onClick={sorprendeme} disabled={resultados.length === 0}>
            🎲 Sorprendeme
          </button>
          <button
            type="button"
            className="boton boton--secundario boton--panel"
            onClick={() => setPanelAbierto((v) => !v)}
            aria-expanded={panelAbierto}
          >
            {panelAbierto ? 'Ocultar filtros' : 'Filtros'}
          </button>
        </div>
      </header>

      <main className="contenido">
        <div className={panelAbierto ? 'panel__envoltura panel__envoltura--abierta' : 'panel__envoltura'}>
          <PanelFiltros filtros={filtros} onCambio={setFiltros} totalFavoritos={favoritos.size} />
        </div>

        <section className="resultados" aria-live="polite">
          <p className="resultados__conteo">
            {resultados.length} {resultados.length === 1 ? 'parche encontrado' : 'parches encontrados'} de{' '}
            {PARCHES.length}
          </p>

          {resultados.length === 0 ? (
            <div className="vacio">
              <p>No hay parches con esos filtros.</p>
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
          Catalogo semilla hecho con lugares publicos y sectores conocidos del Valle de Aburra y el Oriente cercano.
          Horarios y precios son referenciales: confirma antes de salir. Si conoces un parche que falta, agregalo al
          catalogo.
        </p>
      </footer>

      {detalle && (
        <DetalleParche
          parche={detalle}
          esFavorito={favoritos.has(detalle.id)}
          onFavorito={alternarFavorito}
          onCerrar={() => setDetalle(null)}
          ahora={ahora}
        />
      )}
    </div>
  )
}
