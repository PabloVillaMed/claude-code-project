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
- **`context7@claude-plugins-official`** — MCP remoto de Upstash para consultar
  documentación versionada de librerías. Sin Node local. Opcionalmente lee la
  variable de entorno `CONTEXT7_API_KEY` para subir los límites de uso.
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

## Estado conocido: context7

En la sesion donde se instalo, el servidor MCP de context7 no llego a conectar:
Claude Code reporto `AUTH_HEADER_REJECTED` (HTTP 401). El plugin manda
`Authorization: ${CONTEXT7_API_KEY:-}`, que sin la variable definida viaja vacia,
y Claude Code desactiva el fallback de OAuth en cuanto hay una cabecera
`Authorization` configurada.

No se pudo reproducir por HTTP directo: `initialize`, `tools/list` y `tools/call`
contra `https://mcp.context7.com/mcp` devuelven 200 de forma anonima, con la
cabecera vacia y sin ella. Asi que la causa exacta queda sin confirmar — puede ser
transitoria o especifica del cliente MCP.

Si vuelve a fallar, define `CONTEXT7_API_KEY` (cuenta gratuita en
https://context7.com); es la via fiable. Los demas plugins no dependen de esto.

## Comandos

```bash
claude plugin list                        # qué hay instalado
claude plugin marketplace list            # qué marketplaces están registrados
claude plugin marketplace update          # actualizar todos los marketplaces
claude plugin details <nombre>            # inventario y coste en tokens
claude plugin uninstall <nombre>@<market> # quitar uno
```
