import { useIdioma } from '../i18n/contexto'
import { IDIOMAS, NOMBRE_IDIOMA } from '../i18n/tipos'
import type { Idioma } from '../i18n/tipos'

/** Desplegable de idioma. Cada opción se lee en su propia lengua. */
export function SelectorIdioma() {
  const { idioma, t, cambiarIdioma } = useIdioma()

  return (
    <label className="idioma">
      <span className="idioma__etiqueta">{t.cabecera.elegirIdioma}</span>
      <select
        className="idioma__campo"
        value={idioma}
        onChange={(e) => cambiarIdioma(e.target.value as Idioma)}
      >
        {IDIOMAS.map((codigo) => (
          <option key={codigo} value={codigo}>
            {NOMBRE_IDIOMA[codigo]}
          </option>
        ))}
      </select>
    </label>
  )
}
