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
- **`context7@claude-plugins-official`** — MCP remoto para consultar
  documentación versionada de librerías. Sin Node local. **Requiere definir
  `CONTEXT7_API_KEY` para funcionar desde Claude Code on the web**; ver
  "Estado conocido" más abajo.
- **`mcp-server-dev@claude-plugins-official`** — construir servidores MCP.
- **`superpowers@superpowers-dev`** — 14 skills: TDD, depuración sistemática,
  `brainstorming`, `writing-plans`, `executing-plans`, worktrees, revisión de
  código. Instala un hook `SessionStart` que inyecta el contenido de
  `using-superpowers` en el contexto de cada sesión.

## Coste en contexto

`claude plugin details <nombre>` da el desglose. Suma siempre activa: **~2.4k tokens
por sesión** (el resto solo se carga al invocar la skill).

| Plugin | Always-on |
|---|---|
| `example-skills` | ~1.221 tok |
| `superpowers` | ~688 tok |
| `mcp-server-dev` | ~502 tok |
| `context7` | ~0 tok (los esquemas MCP se resuelven en runtime) |

## Decisiones

- **`document-skills` no se instala.** Sus cuatro skills (`docx`, `pdf`, `pptx`,
  `xlsx`) ya llegan sincronizadas desde la cuenta de claude.ai; instalarlas
  duplicaría cada entrada en el índice de skills.
- **`frontend-design@claude-plugins-official` no se instala.** Su `SKILL.md` es
  byte a byte idéntico al que ya trae `example-skills`.
- **`skill-creator@claude-plugins-official` no se instala.** Ya viene
  sincronizado desde la cuenta, y `example-skills` incluye otra copia.
- **Solapamiento aceptado:** `mcp-builder` (de `example-skills`) y
  `build-mcp-server` (de `mcp-server-dev`) cubren terreno parecido, pero son
  skills distintas con enfoques distintos; se dejan las dos.

## Estado conocido: context7 no conecta (401)

El servidor MCP de context7 no llega a conectar desde Claude Code on the web.
Claude Code reporta `AUTH_HEADER_REJECTED` (HTTP 401). Los otros tres plugins no
dependen de esto y funcionan con normalidad.

### Causa raiz

Son dos problemas encadenados.

**1. El endpoint rechaza el acceso anonimo desde este contenedor.** Contra
`https://mcp.context7.com/mcp`, medido directamente con curl:

| Cabecera `Authorization` | HTTP | Resultado |
|---|---|---|
| ausente | 401 | `Authentication required` |
| vacia | 401 | `Authentication required` |
| token inventado | 200 | la *tool* responde `Invalid API key... deben empezar por 'ctx7sk'` |
| clave `ctx7sk...` real | — | sin verificar (no hay clave disponible) |

El 401 llega con `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource"`,
es decir, el challenge estandar de OAuth para MCP. El endpoint expone OAuth
completo vias Clerk (`https://clerk.context7.com`), con registro dinamico de
clientes.

La documentacion de context7 dice que sin clave se cae a un "tier anonimo con
limites mas bajos". Ese tier se aplica por IP, y la IP de salida de este
contenedor (`160.79.106.134`) es un egress compartido de la nube de Anthropic,
usado por muchas sesiones a la vez. En la practica la cuota anonima esta
agotada de forma permanente. En un portatil con IP propia el plugin
probablemente si funciona sin clave — de ahi que la doc oficial no mencione
este 401.

**2. La configuracion del plugin bloquea el rescate por OAuth.** El plugin
declara:

```json
"headers": { "Authorization": "${CONTEXT7_API_KEY:-}" }
```

Sin la variable definida esa cabecera viaja vacia, lo que produce el 401. Y
Claude Code desactiva el fallback de OAuth en cuanto hay una cabecera
`Authorization` configurada, asi que no puede recuperarse por si solo. Callejon
sin salida: la cabecera causa el 401 y a la vez impide la unica via de
recuperacion automatica.

### Soluciones

**Opcion A — clave de API (recomendada).** Cuenta gratuita en
https://context7.com, crear una clave (`ctx7sk...`) y exportarla antes de
arrancar Claude Code:

```bash
export CONTEXT7_API_KEY="ctx7sk-..."
```

En Claude Code on the web se define como variable de entorno del *environment*.
Es la unica via que no depende de la cuota anonima compartida.

**Opcion B — OAuth.** Requiere que la cabecera `Authorization` no este fijada,
para que Claude Code siga el challenge del servidor. Implica no usar el plugin
tal cual y declarar el servidor a mano en un `.mcp.json` del proyecto:

```json
{
  "mcpServers": {
    "context7": { "type": "http", "url": "https://mcp.context7.com/mcp" }
  }
}
```

Despues, `/mcp` en Claude Code para completar el login. No se ha dejado activo
aqui porque duplicaria el servidor del plugin y el login es interactivo, asi
que no se ha podido verificar de extremo a extremo.

**No sirve** poner un valor cualquiera en la cabecera: pasa el 401 del
transporte pero la *tool* devuelve `Invalid API key`.

### Nota metodologica

Las primeras pruebas anonimas devolvieron 200 y luego pasaron a 401 de forma
consistente: la propia bateria de pruebas agoto lo que quedaba de cuota anonima
para esa IP. Cuidado al medir esto, el primer resultado puede enganar.

## Comandos

```bash
claude plugin list                        # qué hay instalado
claude plugin marketplace list            # qué marketplaces están registrados
claude plugin marketplace update          # actualizar todos los marketplaces
claude plugin details <nombre>            # inventario y coste en tokens
claude plugin uninstall <nombre>@<market> # quitar uno
```
