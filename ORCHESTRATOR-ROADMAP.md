# Orchestrator Roadmap

## Epic: Evolução de UI/UX do OpenCode by Alltomatos

**Status:** Em andamento
**Owner:** Ronaldo Davi
**Repositório:** alltomatos/opencode (branch `dev`)
**Origem:** Auditoria feita via agentes Explore (skill `ui-ux-pro-max`) em 2026-08-19, cobrindo menus/dropdowns e telas inteiras do app desktop.

### Contexto

Este fork do OpenCode (packages/app + packages/desktop) tem dois sistemas de componentes coexistindo: um conjunto **legado** (`Button`, `IconButton`, `Icon`, `TextField`, `Switch` de `@opencode-ai/ui`) e um conjunto **v2** (`ButtonV2`, `IconButtonV2`, `IconV2`, `Field`+`TextInputV2`, `SwitchV2` de `@opencode-ai/ui/v2/*`). Telas mais recentes usam v2 consistentemente (ex: Servidores, Provedores, Modelos nas Configurações); telas mais antigas ainda usam só legado ou misturam os dois no mesmo arquivo.

Já implementamos como **padrão de referência** o menu de "Modos" do composer (`packages/app/src/components/prompt-input-mode.tsx`): ícone por item numa caixinha arredondada, ícone no botão-gatilho refletindo o modo atual, e a opção mais arriscada ("Ignorar permissões", que vale pro diretório inteiro) separada por divisor com cor de aviso.

### Já concluído (não reabrir)

- `dialog-connect-omniroute.tsx`: migrado 100% pra v2 (campos, botão, switch), testado no preview.
- `app-project-sidebar.tsx`: corrigido bug de ícone inválido (`IconV2 name="sidebar"` não existe, caía no fallback "+").
- `prompt-input-mode.tsx`: redesenhado (ícone por modo, ícone no gatilho, destaque do modo "bypass").
- Bug real corrigido: seleção do modo "Planejar" não trocava o agente de fato quando o seletor de agentes customizados estava escondido (`context/local.tsx`).

### Epics filhas / grupos de trabalho

1. **Menus com opção destrutiva → padrão "ícone + destaque de risco"**
   Aplicar o mesmo tratamento do menu de Modos nos menus que têm uma opção destrutiva (Excluir/Remover) misturada com opções seguras.

2. **Consistência visual legado → v2**
   Migrar diálogos e telas que ainda usam só o conjunto legado, ou misturam os dois, para v2 — começando pelos mais visitados.

3. **Polish de telas de Configurações**
   Ícones faltando em abas específicas, hierarquia visual entre ações seguras/destrutivas, empty states.

4. **Débito técnico descoberto na auditoria**
   Feature flags mortas, código construído mas nunca ativado.

### Processo de release

A partir de agora, mudanças de UI/UX se acumulam em `dev` e são publicadas em **lotes** (não uma versão por item). Números de versão podem pular (ex: v1.20.16 → v1.20.30) — o número em si não importa, só o conteúdo do release.

**Branches:**
- `dev` — branch de desenvolvimento. Todo o trabalho do dia a dia (features, correções, issues desta epic) é commitado aqui. Nada é publicado/lançado a partir daqui diretamente.
- `prod` — branch de produção. Só builds e releases do app desktop saem daqui. Fica parada até `dev` estar "maduro" o suficiente pra promover.

**Fluxo de promoção (dev → prod):**
1. Trabalhar e validar na `dev` (o app roda em modo dev com `OPENCODE_CHANNEL=dev`, sem afetar usuários).
2. Quando o conjunto de mudanças estiver maduro e testado, promover: `git checkout prod && git merge dev` (fast-forward, já que `prod` nunca diverge por conta própria) `&& git push origin prod`.
3. Buildar e publicar o release **a partir da branch `prod`** (`OPENCODE_CHANNEL=prod`), não da `dev`.
4. Isso garante que ninguém recebe update com trabalho pela metade — o auto-updater do app aponta pros releases do GitHub, que só devem ser criados depois da promoção.

Nota: o workflow de CI em `.github/workflows/publish.yml` é herdado do projeto original e só roda quando `github.repository == 'anomalyco/opencode'` — no nosso fork ele nunca dispara. Todo o processo de build/release atual é manual, feito localmente (`bun run build` + `bun run package:win -- --publish always` em `packages/desktop`), então esse gate de branch é uma disciplina nossa, não uma automação de CI.

### Rastreamento

Todas as issues foram publicadas em https://github.com/alltomatos/opencode/issues (labels `ui-ux`, mais `needs-decision` na #12). Nenhuma bloqueia a outra tecnicamente — podem ser trabalhadas em qualquer ordem ou em paralelo (worktrees isoladas, se for o caso).

| # | Issue | Grupo | Arquivo(s) |
|---|-------|-------|------------|
| 1 | [#1](https://github.com/alltomatos/opencode/issues/1) | Menus destrutivos | `message-timeline.tsx` (menu de ações da sessão) |
| 2 | [#2](https://github.com/alltomatos/opencode/issues/2) | Menus destrutivos | `dialog-select-server.tsx`, `server-row-menu.tsx`, `wsl/settings.tsx` (menu de servidor, 3 cópias) |
| 3 | [#3](https://github.com/alltomatos/opencode/issues/3) | Menus destrutivos | `home-projects-view.tsx` (menu de projeto, Home) |
| 4 | [#4](https://github.com/alltomatos/opencode/issues/4) | Menus destrutivos | `layout.tsx` (menu de projeto, sidebar legada) |
| 5 | [#5](https://github.com/alltomatos/opencode/issues/5) | Menus destrutivos | `sidebar-workspace.tsx` (menu de workspace) |
| 6 | [#6](https://github.com/alltomatos/opencode/issues/6) | Consistência v2 | `dialog-select-server.tsx` (migração completa) |
| 7 | [#7](https://github.com/alltomatos/opencode/issues/7) | Consistência v2 | `dialog-connect-provider.tsx` (migração completa) |
| 8 | [#8](https://github.com/alltomatos/opencode/issues/8) | Polish Configurações | `settings-v2/general.tsx` |
| 9 | [#9](https://github.com/alltomatos/opencode/issues/9) | Polish Configurações | `settings-v2/providers.tsx` (Desconectar vs Conectar) |
| 10 | [#10](https://github.com/alltomatos/opencode/issues/10) | Polish Configurações | `settings-v2/skills.tsx`, `settings-v2/mcp.tsx` |
| 11 | [#11](https://github.com/alltomatos/opencode/issues/11) | Polish Configurações | `home-sessions-view.tsx` (empty state) |
| 12 | [#12](https://github.com/alltomatos/opencode/issues/12) | Débito técnico | `home-sessions-view.tsx` (`SHOW_HOME_SESSION_ARCHIVE`) — **precisa decisão antes de codar** |

Recomendação de ordem, se for sequencial: 1 → 5 → 3 → 4 → 2 (menus, mais rápidos e independentes) → 11 → 9 → 8 → 10 (polish) → 6 → 7 (migrações grandes, por último, já com o padrão `Field`/`TextInputV2` maduro) → 12 (assim que a decisão de produto sair).

**Status: todas as 12 issues acima implementadas e na `dev`** (commits `6f109ea10`, `703b2df62`, `dcfeb8e3d`, `952c5a552`). Aguardando promoção `dev` → `prod` quando o lote for considerado maduro.

## Epic: Tamanho de arquivo / limite SRP (~250 linhas)

**Status:** Issues criadas, não iniciadas
**Origem:** discussão em 2026-08-19 sobre a técnica de manter arquivos abaixo de ~250 linhas por responsabilidade única, usada por outros projetos do orchestrator.

Regra registrada em `AGENTS.md` (seção "File Size (SRP boundary)"): arquivos novos devem mirar <250 linhas; arquivos existentes só são divididos oportunisticamente quando já estão sendo editados por outro motivo — não é uma tarefa dedicada de "quebrar tudo". Dados (i18n, gerado, fixtures) são isentos.

Piores ofensores do monorepo (`packages/app/src`, excluindo i18n/testes/gerado) mapeados em issues — nenhuma bloqueia a outra, trabalhar oportunisticamente:

| Issue | Arquivo | Linhas |
|---|---|---|
| [#13](https://github.com/alltomatos/opencode/issues/13) | `pages/layout.tsx` | 2427 |
| [#14](https://github.com/alltomatos/opencode/issues/14) | `pages/session.tsx` | 2404 |
| [#15](https://github.com/alltomatos/opencode/issues/15) | `pages/session/timeline/message-timeline.tsx` | 1933 |
| [#16](https://github.com/alltomatos/opencode/issues/16) | `components/prompt-input.tsx` | 1795 |
| [#17](https://github.com/alltomatos/opencode/issues/17) | `context/server-session.ts` | 1427 |
| [#18](https://github.com/alltomatos/opencode/issues/18) | `context/layout.tsx` | 1102 |
| [#19](https://github.com/alltomatos/opencode/issues/19) | `pages/session/session-side-panel.tsx` | 867 |
| [#20](https://github.com/alltomatos/opencode/issues/20) | `pages/session/file-tabs.tsx` | 800 |

## Epic: Melhorias de MCP

**Status:** Em andamento — persistência corrigida, resto planejado
**Origem:** análise de código em 2026-08-19 (agente Explore) do módulo `packages/opencode/src/mcp` + tela `settings-v2/mcp.tsx`.

Achado crítico já corrigido: servidor MCP adicionado pela UI/API só existia em memória (`MCP.Service.add`), sumindo ao reiniciar — o CLI (`opencode mcp add`) era o único caminho que persistia de verdade no `opencode.jsonc`. Corrigido no commit `f56dd9e2b` (`Config.Service.updateGlobal`, mesma mecânica usada em outros lugares do app).

Demais lacunas mapeadas em issues (nenhum TODO/gambiarra no código — é falta de superfície de UI/API pro que o backend já suporta):

| Issue | O quê | Depende de |
|---|---|---|
| [#21](https://github.com/alltomatos/opencode/issues/21) | Editar/remover servidor configurado (form completo: env, headers, cwd, timeout + endpoint DELETE) | — |
| [#22](https://github.com/alltomatos/opencode/issues/22) | Fluxo de OAuth funcional na UI (hoje trava em "beco sem saída" quando `needs_auth`) | — |
| [#23](https://github.com/alltomatos/opencode/issues/23) | Navegador de tools/prompts/resources de um servidor conectado (backend já expõe, falta rota HTTP + UI) | Recomendado depois de #21 |
| [#24](https://github.com/alltomatos/opencode/issues/24) | Catálogo de servidores conhecidos (Cloudflare, Gmail, Mercado Pago, Context7, GitHub Copilot) com conectar em 1 clique | #22 |

Decisão de produto sobre servidores pessoais/privados do usuário (`~/.claude.json` tem 12 configurados, incluindo endpoints internos e chaves): **não vão ser embutidos no fork**. Só os 5 públicos/conhecidos do #24 viram catálogo pré-configurado (sem segredo nenhum, só a URL pública); os privados continuam só via formulário manual.

## Epic: Build multi-plataforma na promoção `dev` → `prod`

**Status:** Solicitado em 2026-08-19, a ser implementado.

Hoje o processo de release só builda Windows (`bun run package:win`) manualmente. Objetivo: ao promover `dev` → `prod`, gerar também os artefatos de Mac (`.dmg`) e Linux (`.deb`, `.rpm`, ou outro formato universal) via electron-builder, para que o script de instalação cubra as três plataformas.
