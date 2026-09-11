import { useCallback, useMemo, useState } from 'react'
import { PARCHES } from './data/parches'
import type { Parche } from './types'
import { filtrarParches, FILTROS_VACIOS, parcheAlAzar } from './lib/filtros'
import type { Filtros } from './lib/filtros'
import { ordenarParches, ORDENES } from './lib/orden'
import type { Orden } from './lib/orden'
import { traducirParches } from './lib/traducir'
import { guardarFavoritos, leerFavoritos } from './lib/favoritos'
import { aplicarPuntuacion, guardarPuntuaciones, leerPuntuaciones } from './lib/puntuaciones'
import type { Puntuaciones } from './lib/puntuaciones'
import { useIdioma } from './i18n/contexto'
import { PanelFiltros } from './components/PanelFiltros'
import { TarjetaParche } from './components/TarjetaParche'
import { DetalleParche } from './components/DetalleParche'
import { SelectorIdioma } from './components/SelectorIdioma'
import { Ladera } from './components/Ladera'

const PALETA_CABECERA = ['#0B6E3F', '#F0B310', '#0A5FA8', '#C8226A', '#E0561C']

export default function App() {
  const { idioma, t } = useIdioma()
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_VACIOS)
  const [orden, setOrden] = useState<Orden>('sugeridos')
  const [favoritos, setFavoritos] = useState<Set<string>>(() => leerFavoritos())
  const [puntuaciones, setPuntuaciones] = useState<Puntuaciones>(() => leerPuntuaciones())
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const [panelAbierto, setPanelAbierto] = useState(false)

  // Se fija al montar para que "abierto ahora" no cambie a mitad de un render.
  const [ahora] = useState(() => new Date())

  const catalogo = useMemo(() => traducirParches(PARCHES, idioma), [idioma])

  const resultados = useMemo(() => {
    const filtrados = filtrarParches(catalogo, filtros, { favoritos, ahora, puntuaciones })
    return ordenarParches(filtrados, orden, puntuaciones)
  }, [catalogo, filtros, favoritos, ahora, puntuaciones, orden])

  // El detalle se guarda por id, no por objeto: así al cambiar de idioma el
  // parche abierto se vuelve a leer traducido en vez de quedarse congelado.
  const detalle = useMemo(
    () => (detalleId ? (catalogo.find((p) => p.id === detalleId) ?? null) : null),
    [catalogo, detalleId],
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

  const puntuar = useCallback((id: string, estrellas: number) => {
    setPuntuaciones((previas) => {
      const siguiente = aplicarPuntuacion(previas, id, estrellas)
      guardarPuntuaciones(siguiente)
      return siguiente
    })
  }, [])

  function sorprendeme() {
    const elegido = parcheAlAzar(resultados)
    if (elegido) setDetalleId(elegido.id)
  }

  const totalPuntuados = Object.keys(puntuaciones).length

  return (
    <div className="app">
      <header className="cabecera">
        <div className="cabecera__interior">
          <div className="cabecera__barra">
            <p className="cabecera__sobre">{t.cabecera.sobre}</p>
            <SelectorIdioma />
          </div>

          <h1 className="logotipo">
            Parches<span>Medellín</span>
          </h1>
          <p className="cabecera__bajada">{t.cabecera.bajada}</p>

          <div className="buscador">
            <input
              type="search"
              className="buscador__campo"
              placeholder={t.cabecera.buscarPlaceholder}
              value={filtros.busqueda}
              onChange={(e) => setFiltros({ ...filtros, busqueda: e.target.value })}
              aria-label={t.cabecera.buscarEtiqueta}
            />
            <button
              type="button"
              className="boton boton--claro"
              onClick={sorprendeme}
              disabled={resultados.length === 0}
            >
              {t.cabecera.sorprendeme}
            </button>
            <button
              type="button"
              className="boton boton--fantasma boton--panel"
              onClick={() => setPanelAbierto((v) => !v)}
              aria-expanded={panelAbierto}
            >
              {panelAbierto ? t.cabecera.ocultarFiltros : t.cabecera.verFiltros}
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
              <b>{resultados.length}</b> {t.resultados.conteoResto(PARCHES.length)}
            </p>
            <label className="ordenar">
              {t.resultados.ordenarPor}
              <select value={orden} onChange={(e) => setOrden(e.target.value as Orden)}>
                {ORDENES.map((o) => (
                  <option key={o} value={o}>
                    {t.resultados.ordenes[o]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {resultados.length === 0 ? (
            <div className="vacio">
              <p className="vacio__titulo">{t.resultados.vacioTitulo}</p>
              <p>{t.resultados.vacioTexto}</p>
              <button type="button" className="boton" onClick={() => setFiltros(FILTROS_VACIOS)}>
                {t.resultados.limpiarFiltros}
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
                  onAbrirDetalle={(p: Parche) => setDetalleId(p.id)}
                  ahora={ahora}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="pie">
        <p>{t.pie.catalogo}</p>
        <p>{t.pie.fotos}</p>
      </footer>

      {detalle && (
        <DetalleParche
          parche={detalle}
          esFavorito={favoritos.has(detalle.id)}
          puntuacion={puntuaciones[detalle.id] ?? 0}
          onFavorito={alternarFavorito}
          onPuntuar={puntuar}
          onCerrar={() => setDetalleId(null)}
          ahora={ahora}
        />
      )}
    </div>
  )
}
