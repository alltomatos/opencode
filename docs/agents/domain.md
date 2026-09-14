# Domain

Map between this repo's domain concepts and the code that implements them. Extraído de `CONTEXT.md` (fonte canônica da linguagem de domínio) e da estrutura de packages.

## Projeto

OpenCode — AI-powered development tool. Fork `alltomatos/opencode` (upstream `anomalyco/opencode`), com extensões próprias: Batuta (orquestração de subagentes), provider nativo OmniRoute, app desktop Electron e mobile (ver `docs/prd/`).

## Linguagem de domínio (fonte: CONTEXT.md)

| Termo | Onde vive |
| --- | --- |
| System Context, Context Source, Context Epoch, Session History | `packages/opencode/src/system-context/` |
| Session Runtime, Session Drain, Provider Turn, Prompt Promotion | `packages/opencode/src/session/` (V2 Session Core, ver `AGENTS.md`) |
| V2 Session Core (admission durável separada da execução) | `packages/opencode/src/session/` |
| Model Tool Output, Managed Tool Output File | tool registry / shared tool-output dir |
| Batuta (orquestração de subagentes externos) | `docs/agents/batuta-external-agents.md`, `docs/research/external-agent-orchestration.md` |
| OmniRoute (provider nativo, não plugin npm — ADR 0002) | `docs/agents/omniroute-native-provider.md`, ADR `docs/adr/0002-*` |
| Combobox Worker exige skill instalada | ADR `docs/adr/0001-*` |

## Packages principais

- `packages/opencode` — core CLI/server (testes e typecheck rodam daqui, nunca da raiz)
- `packages/core` / `packages/schema` / `packages/protocol` / `packages/server` — dependência dirigida Schema → Core/Protocol → Server; Client nunca depende de Core/Server (ver `AGENTS.md`)
- `packages/client` / `sdk-next` — clientes
- `packages/desktop` — app desktop Electron
- `packages/sdk/js` — SDK legado (regenerar via `./packages/sdk/js/script/build.ts`)

## Convenções

- Branch default: `dev` (ref `main` local pode não existir)
- Branches curtas, até três palavras, sem slash/prefixo
- Commits/PRs: `type(scope): summary`
- Typecheck: `bun typecheck` a partir dos packages
