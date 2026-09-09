# Configuración de skills y plugins

`settings.json` declara los marketplaces y los plugins que se activan al abrir
este repo con Claude Code. La primera vez, Claude Code pide confirmación para
confiar en cada marketplace antes de clonarlo.

## Marketplaces registrados

| Marketplace | Repo | Qué es |
|---|---|---|
| `anthropic-agent-skills` | `anthropics/skills` | Skills oficiales de Anthropic (las mismas que corren en producción en Claude) |
| `claude-plugins-official` | `anthropics/claude-plugins-official` | Plugins internos y de partners revisados por Anthropic (~292) |
| `claude-community` | `anthropics/claude-plugins-community` | Marketplace comunitario para Claude Code y Cowork |
| `superpowers-dev` | `obra/superpowers` | Librería de skills de Jesse Vincent |

`claude-community` queda registrado pero sin plugins activados: sirve para
explorar con `claude plugin install <nombre>@claude-community`.

## Plugins activados

- **`example-skills@anthropic-agent-skills`** — 12 skills: `mcp-builder`,
  `skill-creator`, `frontend-design`, `webapp-testing`, `canvas-design`,
  `web-artifacts-builder`, `brand-guidelines`, `algorithmic-art`,
  `doc-coauthoring`, `internal-comms`, `slack-gif-creator`, `theme-factory`.
- **`mcp-server-dev@claude-plugins-official`** — construir servidores MCP.
- **`superpowers@superpowers-dev`** — 14 skills: TDD, depuración sistemática,
  `brainstorming`, `writing-plans`, `executing-plans`, worktrees, revisión de
  código. Instala un hook `SessionStart` que inyecta el contenido de
  `using-superpowers` en el contexto de cada sesión.

## Servidores MCP

`.mcp.json` declara **context7**, para documentación versionada de librerías sin
Node local. No se usa el plugin oficial; el porqué está más abajo. Requiere
aprobar el servidor la primera vez.

## Coste en contexto

`claude plugin details <nombre>` da el desglose. Suma siempre activa: **~2.4k tokens
por sesión** (el resto solo se carga al invocar la skill).

| Plugin | Always-on |
|---|---|
| `example-skills` | ~1.221 tok |
| `superpowers` | ~688 tok |
| `mcp-server-dev` | ~502 tok |

context7 no suma nada al arranque: sus esquemas MCP se resuelven en runtime.

## Decisiones

- **`document-skills` no se instala.** Sus cuatro skills (`docx`, `pdf`, `pptx`,
  `xlsx`) ya llegan sincronizadas desde la cuenta de claude.ai; instalarlas
  duplicaría cada entrada en el índice de skills.
- **`frontend-design@claude-plugins-official` no se instala.** Su `SKILL.md` es
  byte a byte idéntico al que ya trae `example-skills`.
- **`skill-creator@claude-plugins-official` no se instala.** Ya viene
  sincronizado desde la cuenta, y `example-skills` incluye otra copia.
- **`context7@claude-plugins-official` no se instala.** Su URL lleva un query
  param que context7 pone detrás de autenticación; se declara el servidor a mano
  en `.mcp.json`. Detalle más abajo.
- **Solapamiento aceptado:** `mcp-builder` (de `example-skills`) y
  `build-mcp-server` (de `mcp-server-dev`) cubren terreno parecido, pero son
  skills distintas con enfoques distintos; se dejan las dos.

## context7: por que no se usa el plugin

El plugin `context7@claude-plugins-official` **no se instala**. En su lugar el
servidor se declara a mano en el `.mcp.json` del repo. El plugin falla con
`AUTH_HEADER_REJECTED` (HTTP 401) y no puede recuperarse solo.

### Causa raiz

context7 **exige autenticacion solo para el identificador de cliente que usa el
plugin**. El plugin apunta a
`https://mcp.context7.com/mcp?client=claude-code-plugin`, y ese query param es
la variable que decide. Matriz medida con curl:

| URL | `Authorization` | HTTP |
|---|---|---|
| `/mcp` | ninguna | 200 |
| `/mcp` | vacia | 200 |
| `/mcp?client=claude-code-plugin` | ninguna | **401** |
| `/mcp?client=claude-code-plugin` | vacia | **401** |
| `/mcp?client=claude-code-plugin` | token inventado | 200 |
| `/mcp?client=otracosa` | ninguna | 200 |
| `/mcp?client=vscode` | ninguna | 200 |
| `/mcp?foo=bar` | ninguna | 200 |

Cualquier otro valor de `client`, o ninguno, funciona de forma anonima. Solo
`client=claude-code-plugin` esta detras de autenticacion, por politica del
servidor.

Encima, el plugin declara `"Authorization": "${CONTEXT7_API_KEY:-}"`, que sin la
variable definida viaja vacia. Y Claude Code desactiva el fallback de OAuth en
cuanto hay una cabecera `Authorization` configurada, asi que tampoco puede
autenticarse por su cuenta. El resultado es un callejon sin salida.

### La solucion aplicada

El `.mcp.json` del repo apunta a la URL desnuda, sin query param y sin cabecera:

```json
{
  "mcpServers": {
    "context7": { "type": "http", "url": "https://mcp.context7.com/mcp" }
  }
}
```

Verificado de extremo a extremo: `claude mcp list` reporta `Connected`, y una
llamada real a `resolve-library-id` devuelve documentacion. **Sin clave de API y
sin login OAuth.**

La primera vez, Claude Code pide aprobar el servidor del `.mcp.json` (`claude mcp
get context7` lo muestra como *Pending approval*). Para saltarse ese prompt se
puede anadir `"enabledMcpjsonServers": ["context7"]` a `settings.json`; se deja
fuera a proposito, para que la aprobacion sea una decision explicita de quien
clone el repo.

Si en algun momento se quiere el plugin oficial en vez de esto, hace falta una
clave real (`ctx7sk...`) en `CONTEXT7_API_KEY`; un valor cualquiera pasa el 401
del transporte pero la *tool* responde `Invalid API key`.

### Nota metodologica

Una version anterior de este documento atribuia el 401 a que la cuota del tier
anonimo estaba agotada para la IP de salida compartida del contenedor. **Era
incorrecto.** El sintoma que llevo a esa conclusion — pruebas anonimas que
devolvian 200 y despues 401 de forma consistente — se explica porque las
primeras usaban la URL desnuda y las siguientes la URL del plugin, con el query
param. La variable nunca fue el tiempo ni la IP.

## Comandos

```bash
claude plugin list                        # qué hay instalado
claude plugin marketplace list            # qué marketplaces están registrados
claude plugin marketplace update          # actualizar todos los marketplaces
claude plugin details <nombre>            # inventario y coste en tokens
claude plugin uninstall <nombre>@<market> # quitar uno
```
