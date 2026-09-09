# Entorno de Claude Code

`settings.json` declara los marketplaces y plugins; `.mcp.json` (en la raíz)
declara los servidores MCP. Al abrir el repo, Claude Code pide confirmar la
confianza en cada marketplace la primera vez.

## Skills disponibles

**Flujo de desarrollo** — `superpowers` (14)

`brainstorming` · `writing-plans` · `executing-plans` ·
`subagent-driven-development` · `dispatching-parallel-agents` ·
`test-driven-development` · `systematic-debugging` ·
`verification-before-completion` · `requesting-code-review` ·
`receiving-code-review` · `using-git-worktrees` ·
`finishing-a-development-branch` · `writing-skills` · `using-superpowers`

Instala un hook `SessionStart` que inyecta `using-superpowers` en el contexto
de cada sesión. Se revisó: solo lee su propio `SKILL.md`, sin red ni escrituras.

**Producto e interfaz** — `example-skills` (12)

`frontend-design` · `web-artifacts-builder` · `webapp-testing` ·
`canvas-design` · `theme-factory` · `brand-guidelines` · `algorithmic-art` ·
`slack-gif-creator` · `doc-coauthoring` · `internal-comms` · `mcp-builder` ·
`skill-creator`

**Servidores MCP** — `mcp-server-dev` (3)

`build-mcp-server` · `build-mcpb` · `build-mcp-app`

**Ya en la cuenta**, sin instalar nada: `docx` · `pdf` · `pptx` · `xlsx` ·
`skill-creator` · `claude-api` · `dataviz` · `design` · `code-review` ·
`security-review` · `simplify` · `run` · `init`.

Coste añadido a cada sesión: **~2,4k tokens** (`example-skills` ~1.221,
`superpowers` ~688, `mcp-server-dev` ~502). El cuerpo de cada skill solo se
carga al invocarla. `claude plugin details <nombre>` da el desglose.

## Servidor MCP: context7

Documentación versionada de librerías, sin Node local. Ya pre-aprobado vía
`enabledMcpjsonServers`, conecta sin prompt.

Se declara a mano en `.mcp.json` en vez de usar el plugin oficial: la URL del
plugin lleva `?client=claude-code-plugin`, y context7 exige autenticación
justamente para ese identificador de cliente. La URL desnuda funciona de forma
anónima. Si algún día se prefiere el plugin, hace falta una clave `ctx7sk...`
en `CONTEXT7_API_KEY`.

`enabledMcpjsonServers` pre-aprueba **ese** servidor, no la lista entera: uno
nuevo en `.mcp.json` necesitará su propia entrada o su propia aprobación.

## No instalar (ya están cubiertos)

- `document-skills` — `docx`/`pdf`/`pptx`/`xlsx` llegan sincronizadas de la cuenta.
- `frontend-design@claude-plugins-official` — `SKILL.md` idéntico al de `example-skills`.
- `skill-creator@claude-plugins-official` — duplicado por partida doble.

## Marketplaces

| Marketplace | Repo |
|---|---|
| `anthropic-agent-skills` | `anthropics/skills` |
| `claude-plugins-official` | `anthropics/claude-plugins-official` |
| `claude-community` | `anthropics/claude-plugins-community` |
| `superpowers-dev` | `obra/superpowers` |

`claude-community` queda registrado sin nada activado, para explorarlo:
`claude plugin install <nombre>@claude-community`.

## Comandos

```bash
claude plugin list                        # qué hay instalado
claude mcp list                           # estado de los servidores MCP
claude plugin marketplace update          # actualizar marketplaces
claude plugin details <nombre>            # inventario y coste en tokens
claude plugin uninstall <nombre>@<market> # quitar uno
```
