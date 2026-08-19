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
