import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ProveedorIdioma } from './i18n/contexto'
import './styles.css'

const contenedor = document.getElementById('root')
if (!contenedor) throw new Error('No se encontro el elemento #root')

createRoot(contenedor).render(
  <StrictMode>
    <ProveedorIdioma>
      <App />
    </ProveedorIdioma>
  </StrictMode>,
)
