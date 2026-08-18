# Pesquisa: Claude Code, Codex e Orca — rumo a um opencode orquestrador

> Documento de pesquisa/roadmap. Não é especificação final — serve de base para decidir a arquitetura da feature de "maestria" (orquestração de CLIs externos via worktrees) no fork.

## Contexto

Durante a sessão exploramos três produtos que resolvem "múltiplos agentes de IA trabalhando em código" de formas bem diferentes:

- **Claude Code** (`anthropics/claude-code`) — o motor é fechado; o repo público é só docs/CLI wrapper/plugins.
- **Codex** (`openai/codex`) — motor em Rust, majoritariamente open-source, com um protocolo de app-server documentado.
- **Orca** (app instalado localmente, `orca-cli` skill) — não é um agente de IA em si. É um orquestrador que controla **terminais reais rodando CLIs de agentes de terceiros** (Claude Code, Codex, etc) dentro de git worktrees gerenciados.

A ideia levantada: dar ao opencode desktop (nosso fork) uma capacidade parecida com a do Orca — orquestrar `claude`, `codex` e outros CLIs de agente em worktrees isolados, mas **nativamente**, sem depender de um app terceiro.

---

## 1. Claude Code — o que dá pra aprender

Repositório público não contém o motor (fechado). Mas o `CHANGELOG.md` revela bastante sobre a arquitetura de integração Desktop↔CLI:

- **Remote Control**: sessões abertas no Claude Code Desktop (ou VS Code) podem ser controladas/monitoradas de outros clientes (celular, claude.ai/code), com sync de modo de permissão, modelo/effort e progresso de tarefas em background.
- **Gateway `desktop:` overlay**: o Desktop define um overlay de configuração que o CLI valida no boot contra o schema do Desktop — ou seja, existe um mecanismo de **config gerenciada centralmente** pelo app desktop, sobrepondo o `settings.json` local.
- **MCP reservado**: os nomes "Claude Browser" e "Claude Preview" são reservados internamente — confirma que o painel de browser do Desktop é implementado como um servidor MCP interno (mesma ideia que implementamos no opencode, só que como tool nativa + bridge HTTP em vez de MCP).
- **`claude mcp add-from-claude-desktop`**: comando dedicado pra importar servidores MCP já configurados no Desktop para o CLI — evidência de que Desktop e CLI têm configs de MCP **separadas** que precisam de sincronização explícita.
- **`self-hosted-runner`**: `claude self-hosted-runner` transforma máquinas próprias em destino de execução para sessões vindas de web/mobile/desktop — arquitetura de "runner remoto" plugável.
- **Hooks com `terminalSequence`**: hooks do CLI conseguem emitir notificações/títulos de janela mesmo sem terminal controlador — sinal de que o Desktop roda a mesma lógica de hooks do CLI por baixo, sem reimplementar.

**Conclusão**: Desktop = wrapper fino sobre o mesmo motor CLI, com uma camada de config gerenciada e features de colaboração remota. Não há evidência de orquestração de *outros* CLIs de terceiros (Codex, etc) — o foco é multi-cliente do próprio Claude Code.

---

## 2. Codex — o mais transparente dos três

Diferente do Claude Code, o Codex é **majoritariamente open-source** (Rust, `codex-rs/`). Isso deu visibilidade real à arquitetura:

### `codex app-server` — o coração da integração

- Servidor **JSON-RPC 2.0** bidirecional (mesmo estilo do MCP), documentado em [`codex-rs/app-server/README.md`](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md).
- Transportes: stdio (padrão), WebSocket (experimental), Unix socket (controle local).
- É o que "alimenta interfaces ricas" — extensão VS Code e, por extensão, o app desktop.
- Suporta `--code-mode-host URL` para conectar a um host remoto em vez de rodar localmente — desacopla onde o agente roda de onde a UI roda.
- `app-server-daemon` gerencia ciclo de vida do processo (só Unix).

### `codex app` — o comando que abre o desktop

```
codex app [PATH]           # abre o workspace no app desktop, instalando se necessário
```

- **Windows**: distribuído via **Microsoft Store**, identidade de pacote estável `OpenAI.Codex_*` (mesma para builds "Codex" e "ChatGPT"-branded). Detecção via `Get-StartApps | Where AppID -Like 'OpenAI.Codex_*!App'`.
- **Abertura via URL scheme customizado**: `codex://threads/new?path=<workspace>` — o CLI só chama `Start-Process` nessa URL; quem trata é o handler de protocolo registrado pelo instalador.
- **macOS**: lógica similar (`desktop_app/mac.rs`), com fallback de instalação automática.
- **Sem Linux** — branch só compila para macOS/Windows (`#[cfg(target_os = ...)]`).

### "Apps" no app-server ≠ apps desktop

O app-server tem conceito de `app/list` / `app/installed` — mas isso é sobre **connectors do ChatGPT** (integrações de terceiros com branding/ícones, tipo plugins), não sobre múltiplas janelas/instâncias do desktop app.

**Conclusão**: Codex tem a integração CLI↔Desktop mais bem definida e documentada dos três — um protocolo JSON-RPC real, não HTTP REST ad-hoc. É a referência mais útil se quisermos evoluir a comunicação do opencode (hoje HTTP simples) para algo mais robusto no futuro.

---

## 3. Orca — orquestração real de múltiplos CLIs

Orca **não é um agente**. É uma camada de automação de terminal + git worktree por cima de CLIs de agentes já instalados (`claude`, `codex`, `omp`, `pi`, `grok`, etc). Arquitetura (via `orca-cli` skill, `ORCA skills get orca-cli`):

- **Worktree = unidade de trabalho**: cada tarefa vira um `git worktree` real (`orca worktree create --agent codex --prompt "..."`), com metadados, terminais e estado de UI próprios.
- **Terminal = onde o agente roda de verdade**: Orca abre um terminal (PTY) e literalmente digita o comando do CLI do agente (`codex`, `claude`, etc) nele — como se fosse um humano. Não há motor de LLM próprio; quem processa tool-calls é o CLI de terceiro rodando dentro do PTY.
- **Leitura por polling de terminal**: `orca terminal read` lê o que foi impresso no PTY; `orca terminal wait --for tui-idle` espera o agente ficar ocioso antes de mandar o próximo prompt.
- **Handoff entre agentes/worktrees**: "entregar" uma tarefa de um agente pra outro é criar um novo worktree e mandar o prompt pro CLI dele — sem estado compartilhado, é troca de processo.
- **Orquestração estruturada opcional** (`orca orchestration ...`): task DAGs, dispatch, inbox/reply entre agentes, coordenador aguardando conclusão — tudo ainda em cima de PTYs de CLIs externos.

**Conclusão**: o valor do Orca não é o LLM, é a **automação de terminal + worktree + supervisão**. É o modelo mais direto de replicar se quisermos orquestrar `claude`/`codex` de dentro do opencode, sem precisar reimplementar nada desses agentes.

---

## 4. Comparativo rápido

| | opencode (nosso fork) | Claude Code | Codex | Orca |
|---|---|---|---|---|
| Motor do agente | TS/Effect, HTTP server embutido | fechado | Rust, `app-server` JSON-RPC | **nenhum** — orquestra CLIs de terceiros |
| Desktop | Electron (este fork) | fechado, "gateway overlay" | MSIX/Store, launcher open | app próprio (não é IDE nem agente) |
| Protocolo app↔motor | HTTP REST | desconhecido | JSON-RPC 2.0 (documentado) | comandos CLI + leitura de PTY |
| Multi-agente/multi-CLI | não | não (só multi-cliente do próprio CC) | não (só multi-cliente do próprio Codex) | **sim** — é o produto inteiro |
| Unidade de isolamento | sessão (dir/worktree via `.opencode`) | sessão | thread | **git worktree** |

---

## 5. Roadmap: "Maestria" — orquestração de CLIs externos no opencode

Objetivo: dar ao opencode desktop a capacidade de **orquestrar `claude`, `codex` e outros CLIs de agente em git worktrees isolados**, no espírito do Orca, mas nativo no fork — sem depender de um app terceiro rodando por trás.

### Por que isso encaixa bem na arquitetura atual

O opencode já tem quase todas as peças que o Orca precisou construir do zero:

- **`packages/opencode/src/tool/task.ts`** já dispara subagents em sessões paralelas — é o análogo interno do "handoff" do Orca, só que hoje restrito a agentes opencode, não CLIs externos.
- **`packages/desktop/src/main/`** já sabe spawnar processos filhos gerenciados (o sidecar via `utilityProcess.fork`) e agora, depois desta sessão, já sabe criar uma `WebContentsView` controlável via bridge HTTP local (o painel de browser) — o mesmo padrão de "processo filho + bridge de comando" se aplica a controlar terminais.
- **Permission system** (`Permission.evaluate`) já é o ponto único de gate para tools — um novo tool `orchestrate`/`worktree` se encaixa no mesmo pipeline sem inventar nada novo.
- **Config schema** (`packages/core/src/v1/config/`) já tem precedente de listas/paths configuráveis (`skills.paths`, `skills.urls`) — um `orchestration.agents` (lista de CLIs externos conhecidos: `claude`, `codex`, comando, args) segue o mesmo molde.

### Peças que faltam (na ordem que provavelmente fariam sentido implementar)

1. **Gerenciador de worktree** (`packages/opencode/src/worktree/` — novo): criar/listar/remover `git worktree`, análogo ao `orca worktree create/list/rm`. Reaproveitar `git-utils`-like helpers se já existirem no core.
2. **PTY management no Electron main**: spawnar um terminal real (via `node-pty`, que já é dependência do projeto — vimos `@lydell/node-pty-*` nos `package.json` durante o empacotamento do `.exe`) rodando o CLI externo (`claude`, `codex`) dentro do worktree criado. Isso é o análogo do `orca terminal create --command`.
3. **Protocolo de leitura/escrita do PTY como tool**: um novo tool `external_agent` (nome a definir) com ações `spawn`, `send`, `read`, `wait_idle`, `kill` — mesmo padrão do `browser.ts` que acabamos de construir (bridge local + tool fino chamando a bridge), só que em vez de CDP é um PTY.
4. **Detecção de "idle"**: Orca usa heurística de TUI-idle (parar de imprimir por N ms, ou detectar prompt de input). Precisa de um detector similar — não tem API estruturada, é parsing de terminal.
5. **UI**: um painel novo (mesmo padrão do `session-side-panel.tsx` + a aba que criamos pro browser) mostrando os worktrees ativos, qual CLI está rodando em cada um, e um terminal embutido (xterm.js, já comum em apps Electron) pra visualizar/interagir manualmente quando quiser assumir o controle.
6. **Permissão dedicada**: `permission.orchestrate` — spawnar um CLI externo com acesso de escrita ao disco é uma ação de alto risco, deve pedir confirmação como qualquer `bash`/`write`.

### Diferenças de design a decidir cedo

- **Handoff vs. supervisão**: seguir o modelo do Orca (dois modos — "handoff e esquece" vs. "supervisiona com DAG/inbox") ou começar só com supervisão simples (um worktree, um CLI, o usuário acompanha)?
- **Onde roda o PTY**: no processo Electron main (mais simples, mas amarra ao desktop) ou no sidecar (mais consistente com o resto das tools, mas sidecar não tem PTY nativo hoje)?
- **CLI externo pré-instalado vs. gerenciado pelo opencode**: Orca assume que `claude`/`codex` já estão instalados e no PATH. Mais simples de replicar no v1; gerenciar instalação automática (como o `codex app` faz) é uma iteração futura.

### MVP sugerido (menor fatia útil)

1. Um tool `spawn_agent` (ação única: navigate igual ao browser tool fez com `navigate` primeiro) que cria um worktree, sobe um PTY rodando `codex` ou `claude` nele, manda um prompt inicial, e retorna a saída depois de esperar idle — sem UI de terminal ao vivo ainda, só request/response como o `task` tool já funciona hoje.
2. Painel de UI só depois, reaproveitando a infraestrutura de aba lateral que já existe.

---

## Referências

- Claude Code: https://github.com/anthropics/claude-code (ver `CHANGELOG.md`)
- Codex: https://github.com/openai/codex — em especial `codex-rs/app-server/README.md`, `codex-rs/cli/src/app_cmd.rs`, `codex-rs/cli/src/desktop_app/windows.rs`
- Orca: skill local `orca-cli` (`ORCA skills get orca-cli`), CLI `orca`/`orca-dev` instalado em `%LOCALAPPDATA%\Programs\orca`
